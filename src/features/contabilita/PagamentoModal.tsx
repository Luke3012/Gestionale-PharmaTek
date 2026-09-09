// Modale unica per i pagamenti (FASE 3): crea un nuovo pagamento (atteso o
// incassato), oppure modifica/salda/annulla uno esistente. Sostituisce le vecchie
// SaldaModal + PagamentoDettaglioModal. Un pagamento "atteso" ha una scadenza; uno
// "incassato" ha conto + data + verifica. "Salda" = passare da atteso a incassato.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { api, type Pagamento, type RecordDto, type Rimborso } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { EuroInput } from "../../ui/EuroInput";
import { OverlaySalvataggioFinestra } from "../../ui/OverlaySalvataggioFinestra";
import { aggiungiGiorniDaOggiIso as aggiungiGiorni, oggiIso as oggi } from "../../lib/date";
import { mostraMonetina } from "../../ui/monetina";
import { dialog } from "../../ui/dialog/store";
import { useAnimazioniRidotte } from "../../ui/motion";
import { centsToEurStr, eurToCents } from "../../lib/money";
import { TIPI_PAGAMENTO } from "./statiPagamento";
import { impattoRimborsoDopoIncasso, mappaRimborsiExtra } from "./statiRimborso";
import { èContoTransito, opzioniContiConTransito, risolviContoPreferito } from "./contoPreferito";
import { offsetScadenzaDaSpedizione } from "../giornaliero/ordineScadenzario";
import { riallineaPagamentiAperti } from "./riallineaSaldo";
import {
  chiediCoperturaScadenzario,
  adeguaTotaleOrdine,
  deveMostrareAdeguamentoImporto,
  importoCoperto,
  totaleOrdineCents,
  accontoPrevistoDopoModifica,
  calcolaAdeguamentoAltreRate,
  type VoceCopertura,
} from "./coperturaScadenzario";
import { focusInvalidField } from "../../ui/focusInvalid";
import { mergeRealtimeSelettivo } from "../../lib/mergeRealtime";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";

const EVENTI_PAGAMENTO_APERTO = ["pagamento:salvato", "ordine:salvato"] as const;
const EVENTI_CONTI_PAGAMENTO = ["conto:salvato"] as const;

type CampoPagamentoRealtime =
  | "tipo"
  | "importo"
  | "saldato"
  | "scadenza"
  | "contoId"
  | "data"
  | "verificato"
  | "scadDaSpedizione"
  | "note";
type CampiPagamentoRealtime = Record<CampoPagamentoRealtime, unknown>;

function campiPagamentoRealtime(p: Pagamento): CampiPagamentoRealtime {
  return {
    tipo: p.tipo,
    importo: p.importo,
    saldato: p.saldato,
    scadenza: p.scadenza || oggi(),
    contoId: p.contoId,
    data: p.data || oggi(),
    verificato: p.verificato,
    scadDaSpedizione: p.scadDaSpedizione,
    note: p.note,
  };
}

export interface PagamentoModalTarget {
  /** Modifica/salda un pagamento esistente. */
  pagamento?: Pagamento;
  /** Importo ricalcolato dalla preview dell'ordine, distinto dalla baseline
   * persistita usata per determinare i campi da aggiornare. */
  importoProposto?: number;
  /** Crea un nuovo pagamento per quest'ordine. */
  nuovo?: {
    ordineId: string;
    numero?: string;
    tipo?: "acconto" | "saldo" | "rata";
    importo?: number; // centesimi
    saldato?: boolean;
    /** L'editor ordine ha righe/importi non ancora salvati: il pagamento resta
     * locale al form e viene materializzato al salvataggio effettivo dell'ordine. */
    rimandaRiallineamento?: boolean;
  };
  /** Apri già in modalità "incassato" (pulsante Salda su una riga attesa). */
  saldaSubito?: boolean;
  /** Posizione del clic che ha aperto il form (per l'animazione monetina). */
  fromPos?: { x: number; y: number };
}

export type PagamentoDraft = Pagamento;

export type PagamentoChangedInfo = {
  prodottiAggiornati?: boolean;
};

async function dataSpedizioneOrdine(ordineId: string): Promise<string> {
  if (!ordineId) return "";
  const [righe, spedizioni] = await Promise.all([
    api.recordsList("riga_ordine"),
    api.recordsList("spedizione"),
  ]);
  const dateSped = new Map(
    spedizioni.map((s) => [s.id, ((s.data.data as string) || "")])
  );
  let data = "";
  for (const r of righe) {
    if (r.data.ordine_id !== ordineId) continue;
    const sid = (r.data.spedizione_id as string) || "";
    const d = sid ? dateSped.get(sid) || "" : "";
    if (d > data) data = d;
  }
  return data;
}

export function PagamentoModal({
  target,
  onClose,
  onChanged,
  onDraftChange,
  onLocalSave,
}: {
  target: PagamentoModalTarget | null;
  onClose: () => void;
  onChanged: (info?: PagamentoChangedInfo) => void;
  onDraftChange?: (draft: PagamentoDraft | null) => void;
  onLocalSave?: (draft: PagamentoDraft) => void;
}) {
  const [mostrato, setMostrato] = useState<PagamentoModalTarget | null>(target);
  useEffect(() => {
    if (target) {
      (window as any).eliminatoDaMe = false;
      setMostrato(target);
    }
  }, [target]);

  // Anche le modali aperte dalle tabelle (non soltanto la finestra dedicata)
  // ricevono lo snapshot più recente. Il PagamentoForm applica poi il merge
  // selettivo campo per campo senza rimontarsi né perdere le modifiche locali.
  useRicaricaSuEventi(EVENTI_PAGAMENTO_APERTO, async () => {
    const aperto = mostrato?.pagamento;
    if (!aperto || (window as any).eliminatoDaMe) return;
    try {
      const aggiornato = (await api.pagamentiOrdine(aperto.ordineId)).find((p) => p.id === aperto.id);
      if (!aggiornato) {
        toast.warning("Il pagamento è stato eliminato da un'altra postazione.");
        onClose();
        return;
      }
      setMostrato((corrente) =>
        corrente?.pagamento?.id === aggiornato.id
          ? { ...corrente, pagamento: aggiornato }
          : corrente
      );
    } catch {
      // Il controllo periodico successivo ritenterà; il salvataggio conserva
      // comunque il preflight bloccante sul pagamento corrente.
    }
  }, 80);

  const titolo = mostrato?.pagamento
    ? mostrato.saldaSubito
      ? "Salda pagamento"
      : "Dettaglio pagamento"
    : "Registra pagamento";

  return (
    <Modal
      opened={!!target}
      onClose={onClose}
      size="md"
      zIndex={1300}
      title={
        <Group gap="sm">
          <Text fw={700}>{titolo}</Text>
          {mostrato?.nuovo?.numero && (
            <Badge variant="light" color="gray">
              Ordine {mostrato.nuovo.numero}
            </Badge>
          )}
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180, onExited: () => setMostrato(null) }}
    >
      {mostrato && (
        <PagamentoForm
          key={mostrato.pagamento?.id || "nuovo"}
          target={mostrato}
          onClose={onClose}
          onChanged={onChanged}
          onDraftChange={onDraftChange}
          onLocalSave={onLocalSave}
        />
      )}
    </Modal>
  );
}

/** Corpo del form pagamento, riusato sia nella modale sia nella finestra dedicata
 *  (Dettaglio pagamento aperto dalla ricerca globale per saldare rapidamente). */
export function PagamentoForm({
  target,
  onClose,
  onChanged,
  onDraftChange,
  onLocalSave,
  dentroFinestra,
}: {
  target: PagamentoModalTarget;
  onClose: () => void;
  onChanged: (info?: PagamentoChangedInfo) => void;
  onDraftChange?: (draft: PagamentoDraft | null) => void;
  onLocalSave?: (draft: PagamentoDraft) => void;
  dentroFinestra?: boolean;
}) {
  // Ricorda la posizione del clic di apertura per l'animazione monetina.
  const fromPosRef = useRef(target.fromPos);
  const p = target.pagamento;
  const isEdit = !!p;
  const bloccatoDaDistinta = !!p?.distintaId;
  const [conti, setConti] = useState<RecordDto[]>([]);
  const [tipo, setTipo] = useState<string>(p?.tipo ?? target.nuovo?.tipo ?? "saldo");
  const importoInizialeCent =
    target.importoProposto ?? p?.importo ?? target.nuovo?.importo ?? 0;
  const [importo, setImporto] = useState<number | "">(
    importoInizialeCent > 0 ? importoInizialeCent / 100 : ""
  );
  const [saldato, setSaldato] = useState<boolean>(
    target.saldaSubito ? true : p ? p.saldato : target.nuovo?.saldato ?? true
  );
  const [scadenza, setScadenza] = useState(p?.scadenza || oggi());
  const [contoId, setContoId] = useState(p?.contoId || "");
  const [data, setData] = useState(p?.data || oggi());
  const [verificato, setVerificato] = useState(p?.verificato ?? false);
  const [scadDaSpedizione, setScadDaSpedizione] = useState(
    p
      ? p.scadDaSpedizione
      : target.nuovo?.importo === 0
        ? false
        : true
  );
  const [note, setNote] = useState(p?.note ?? "");
  const [salvando, setSalvando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const animazioniRidotte = useAnimazioniRidotte();
  const baselineRealtimeRef = useRef<CampiPagamentoRealtime | null>(
    p ? campiPagamentoRealtime(p) : null
  );

  const campiLocaliRealtime: CampiPagamentoRealtime = {
    tipo,
    importo: importo === "" ? 0 : eurToCents(Number(importo)),
    saldato,
    scadenza,
    contoId,
    data,
    verificato,
    scadDaSpedizione,
    note,
  };
  const campiLocaliRealtimeRef = useRef(campiLocaliRealtime);
  campiLocaliRealtimeRef.current = campiLocaliRealtime;

  const firmaPagamentoRemoto = p ? JSON.stringify(campiPagamentoRealtime(p)) : "";
  useEffect(() => {
    if (!p) return;
    const remoto = campiPagamentoRealtime(p);
    const baseline = baselineRealtimeRef.current ?? remoto;
    const merge = mergeRealtimeSelettivo(
      baseline,
      campiLocaliRealtimeRef.current,
      remoto
    );

    const v = merge.valori;
    setTipo(v.tipo as string);
    setImporto(Number(v.importo) > 0 ? Number(v.importo) / 100 : "");
    setSaldato(Boolean(v.saldato));
    setScadenza(String(v.scadenza ?? ""));
    setContoId(String(v.contoId ?? ""));
    setData(String(v.data ?? ""));
    setVerificato(Boolean(v.verificato));
    setScadDaSpedizione(Boolean(v.scadDaSpedizione));
    setNote(String(v.note ?? ""));
    baselineRealtimeRef.current = remoto;
    // La firma cambia soltanto quando arriva una nuova versione del pagamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaPagamentoRemoto]);

  const ordineId = p?.ordineId ?? target.nuovo?.ordineId ?? "";
  const contoSelezionato = useMemo(
    () => conti.find((c) => c.id === contoId),
    [conti, contoId]
  );
  const contoTipoSelezionato = ((contoSelezionato?.data.tipo as string) || p?.contoTipo || "");
  const scadenzaDaSpedizione = !saldato && (tipo === "saldo" || tipo === "rata") && scadDaSpedizione;
  const offsetSpedizione = offsetScadenzaDaSpedizione(contoTipoSelezionato, p?.scadRelGiorni ?? 0);
  const draftPagamento = useMemo<PagamentoDraft | null>(() => {
    if (!ordineId) return null;
    const cents = importo === "" ? 0 : eurToCents(Number(importo));
    return {
      id: p?.id ?? "__nuovo_pagamento__",
      ordineId,
      tipo: tipo as Pagamento["tipo"],
      importo: cents,
      saldato,
      scadenza: saldato || scadenzaDaSpedizione ? "" : scadenza,
      contoId,
      contoNome: ((contoSelezionato?.data.nome as string) || p?.contoNome || ""),
      contoTipo: contoTipoSelezionato,
      data: saldato ? data : "",
      verificato: saldato ? verificato : false,
      distintaId: p?.distintaId ?? "",
      contoAccreditoNome: p?.contoAccreditoNome ?? "",
      note,
      scadDaSpedizione: (tipo === "saldo" || tipo === "rata") ? scadDaSpedizione : false,
      scadRelGiorni: p?.scadRelGiorni ?? 0,
    };
  }, [contoId, contoSelezionato, contoTipoSelezionato, data, importo, note, ordineId, p, saldato, scadDaSpedizione, scadenza, scadenzaDaSpedizione, tipo, verificato]);

  useEffect(() => {
    onDraftChange?.(draftPagamento);
  }, [draftPagamento, onDraftChange]);

  useEffect(() => () => onDraftChange?.(null), [onDraftChange]);

  useEffect(() => {
    (async () => {
      const cs = await api.recordsList("conto");
      setConti(cs);
      if (contoId) return;
      // Conto proposto: medico → agente → predefinito (acconti/incassi) → banca.
      const oid = p?.ordineId ?? target.nuovo?.ordineId;
      let medico = null;
      let agente = null;
      if (oid) {
        const ord = await api.recordGet("ordine", oid);
        const mid = ord?.data.medico_id as string | undefined;
        const aid = ord?.data.agente_id as string | undefined;
        if (mid) medico = await api.recordGet("medico", mid);
        if (aid) agente = await api.recordGet("agente", aid);
      }
      setContoId(risolviContoPreferito({ conti: cs, medico, agente, tipo }));
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRicaricaSuEventi(EVENTI_CONTI_PAGAMENTO, async () => {
    setConti(await api.recordsList("conto"));
  }, 120);

  const datiConti = useMemo(() => opzioniContiConTransito(conti), [conti]);

  async function preparaCopertura(cents: number): Promise<{
    ok: boolean;
    importo: number;
    adeguamentoRate?: {
      aggiornamenti: Array<{ id: string; importo: number }>;
      eliminazioni: string[];
    };
    totaleProdottiAdeguato?: { ordineId: string; importo: number };
    residuoDaCreare?: { importo: number; scadenza: string };
    creaRimborsoExtra?: boolean;
  }> {
    const ordineId = p?.ordineId ?? target.nuovo?.ordineId;
    if (!ordineId) return { ok: true, importo: cents };

    const [pagamenti, totale] = await Promise.all([api.pagamentiOrdine(ordineId), totaleOrdineCents(ordineId)]);
    const currentId = p?.id ?? "__nuovo_pagamento__";
    const voci: VoceCopertura[] = pagamenti.map((pag) =>
      pag.id === p?.id
        ? { id: pag.id, tipo: tipo as "acconto" | "saldo" | "rata", importo: cents, saldato, scadenza }
        : { id: pag.id, tipo: pag.tipo, importo: pag.importo, saldato: pag.saldato, scadenza: pag.scadenza }
    );
    if (!isEdit) {
      voci.push({
        id: currentId,
        tipo: tipo as "acconto" | "saldo" | "rata",
        importo: cents,
        saldato,
        scadenza,
      });
    }

    const coperto = importoCoperto(voci);
    const staRegistrandoIncasso = saldato && (!p || !p.saldato);
    if (staRegistrandoIncasso) {
      const incassatoPrima = pagamenti
        .filter((pag) => pag.saldato && pag.id !== p?.id)
        .reduce((sum, pag) => sum + Math.max(0, pag.importo), 0);
      const rimanenzaPrima = Math.max(0, totale - incassatoPrima);
      if (!deveMostrareAdeguamentoImporto({
        totale,
        coperto,
        incasso: { importo: cents, rimanenza: rimanenzaPrima },
      })) {
        // Il pagamento viene assorbito automaticamente dal piano esistente: dopo il
        // saldo il riallineamento proporzionale ridistribuisce il residuo sulle rate aperte.
        return { ok: true, importo: cents };
      }
      const rimborsi = await api.rimborsiLista().catch(() => []);
      const impattoRimborso = impattoRimborsoDopoIncasso({
        ordineId,
        totale,
        incassatoPrima,
        nuovoIncasso: cents,
        rimborsi,
      });
      const scelta = await chiediCoperturaScadenzario({
        totale,
        coperto,
        puoDilazionare: false,
        incasso: {
          importo: cents,
          rimanenza: rimanenzaPrima,
          rimborso: impattoRimborso,
        },
      });
      if (scelta === null) return { ok: false, importo: cents };
      if (scelta === "correggi") {
        if (rimanenzaPrima <= 0) {
          toast.warning("L'ordine risulta già interamente saldato: non c'è un residuo da registrare.");
          return { ok: false, importo: cents };
        }
        return { ok: true, importo: rimanenzaPrima };
      }
      if (scelta === "rimborso") return { ok: true, importo: cents, creaRimborsoExtra: true };
      return {
        ok: true,
        importo: cents,
        totaleProdottiAdeguato: { ordineId, importo: incassatoPrima + cents },
      };
    }
    const primoAccontoParziale =
      !isEdit && tipo === "acconto" && pagamenti.length === 0 && totale > 0 && cents < totale;
    if (!deveMostrareAdeguamentoImporto({ totale, coperto, primoAccontoParziale })) {
      return { ok: true, importo: cents };
    }

    const adeguamentoRate = calcolaAdeguamentoAltreRate(voci, currentId, totale);
    const scelta = await chiediCoperturaScadenzario({
      totale,
      coperto,
      puoDilazionare: adeguamentoRate !== null,
    });
    if (scelta === null) return { ok: false, importo: cents };
    if (scelta === "ignora") {
      return {
        ok: true,
        importo: cents,
        residuoDaCreare: {
          importo: totale - coperto,
          scadenza: aggiungiGiorni(saldato ? data : scadenza, 30),
        },
      };
    }
    if (scelta === "dilaziona" && adeguamentoRate) {
      return { ok: true, importo: cents, adeguamentoRate };
    }
    return { ok: true, importo: cents, totaleProdottiAdeguato: { ordineId, importo: coperto } };
  }

  async function scadenzaEffettivaDaSalvare(): Promise<string> {
    if (saldato || !scadenzaDaSpedizione) return saldato ? "" : scadenza;
    const speditaIl = await dataSpedizioneOrdine(ordineId);
    return speditaIl ? aggiungiGiorni(speditaIl, offsetSpedizione) : "";
  }

  async function salva() {
    let cents = importo === "" ? 0 : eurToCents(Number(importo));
    if (cents <= 0) {
      toast.warning("Inserisci un importo maggiore di zero.");
      focusInvalidField('[data-pt-field="pagamento-importo"]');
      return;
    }
    if (saldato && !contoId) {
      toast.warning("Scegli un conto per l'incasso.");
      focusInvalidField('[data-pt-field="pagamento-conto"]');
      return;
    }
    if (saldato) {
      const sel = conti.find((c) => c.id === contoId);
      if (èContoTransito(sel?.data.tipo)) {
        const ok = await dialog.confirm(
          "Incasso su conto di transito",
          "Contrassegno e Assegno di solito si accreditano con la distinta del corriere: " +
            "resteranno «in attesa di accredito». Registrare comunque l'incasso a mano?",
          { conferma: "Registra comunque", annulla: "Annulla" }
        );
        if (!ok) return;
      }
    }
    if (!isEdit && target.nuovo?.rimandaRiallineamento && draftPagamento) {
      const scadenzaSalvata = await scadenzaEffettivaDaSalvare();
      onLocalSave?.({
        ...draftPagamento,
        id: `__local_pagamento__${Date.now()}`,
        importo: cents,
        scadenza: saldato ? "" : scadenzaSalvata,
        data: saldato ? data : "",
        verificato: saldato ? verificato : false,
        note: note.trim(),
        scadDaSpedizione: !saldato && (tipo === "saldo" || tipo === "rata") ? scadDaSpedizione : false,
      });
      toast.success("Pagamento aggiunto allo scadenzario. Salva l'ordine per confermarlo.");
      onClose();
      return;
    }
    const copertura = await preparaCopertura(cents);
    if (!copertura.ok) return;
    cents = copertura.importo;
    let riallineaApertiDopoSalvataggio: string | null = null;
    let prodottiAggiornati = false;
    let rimborsoAutomatico: "creato" | "aggiornato" | null = null;
    setSalvando(true);
    try {
      const scadenzaSalvata = await scadenzaEffettivaDaSalvare();
      if (!isEdit) {
        const pag = await api.pagamentoRegistra({
          ordineId: target.nuovo!.ordineId,
          tipo,
          importo: cents,
          saldato,
          scadenza: scadenzaSalvata,
          // Il conto destinazione si registra anche per gli attesi (non solo al saldo).
          contoId,
          data: saldato ? data : "",
          verificato: saldato ? verificato : false,
          note: note.trim() || null,
        });
        if (tipo === "acconto") {
          await api.recordUpdate("ordine", target.nuovo!.ordineId, { acconto: cents });
          if (!target.nuovo!.rimandaRiallineamento) {
            riallineaApertiDopoSalvataggio = target.nuovo!.ordineId;
          }
        }
        if (!saldato && scadDaSpedizione && (tipo === "saldo" || tipo === "rata")) {
          await api.recordUpdate("pagamento", pag.id, { scad_da_spedizione: true, scad_rel_giorni: 0 });
        }
      } else if (saldato) {
        // Eventuali modifiche ai campi non legati al saldo.
        const fields: Record<string, unknown> = {};
        if (tipo !== p!.tipo) fields.tipo = tipo;
        if (cents !== p!.importo) fields.importo = cents;
        if (note.trim() !== p!.note) fields.note = note.trim();
        if (p!.saldato) {
          if (contoId !== p!.contoId) fields.conto_id = contoId;
          if (data !== p!.data) fields.data = data;
          if (verificato !== p!.verificato) fields.verificato = verificato;
          if (Object.keys(fields).length > 0) {
            await api.recordUpdate("pagamento", p!.id, fields);
          }
        } else {
          await api.pagamentoSalda({
            id: p!.id,
            contoId,
            data,
            verificato,
            fields,
          });
        }
      } else {
        // Resta/torna atteso: aggiorna tutti i campi rilevanti. Il conto destinazione
        // si conserva (dove arriveranno i soldi), si azzerano solo data/verifica reali.
        const desiderati: Record<string, unknown> = {
          tipo,
          importo: cents,
          saldato: false,
          scadenza: scadenzaSalvata,
          conto_id: contoId,
          data: "",
          verificato: false,
          note: note.trim(),
          scad_da_spedizione: (tipo === "saldo" || tipo === "rata") ? scadDaSpedizione : false,
        };
        const correnti: Record<string, unknown> = {
          tipo: p!.tipo,
          importo: p!.importo,
          saldato: p!.saldato,
          scadenza: p!.scadenza,
          conto_id: p!.contoId,
          data: p!.data,
          verificato: p!.verificato,
          note: p!.note,
          scad_da_spedizione: p!.scadDaSpedizione,
        };
        const fields = Object.fromEntries(
          Object.entries(desiderati).filter(([campo, valore]) =>
            JSON.stringify(valore) !== JSON.stringify(correnti[campo])
          )
        );
        if (Object.keys(fields).length > 0) {
          await api.recordUpdate("pagamento", p!.id, fields);
        }
      }
      // L'acconto atteso e il valore previsto sulla testata sono un unico dato di
      // dominio. Gli acconti già incassati restano invece storico immutabile.
      if (isEdit) {
        const accontoPrevisto = accontoPrevistoDopoModifica({
          tipoPrima: p!.tipo,
          saldatoPrima: p!.saldato,
          tipoDopo: tipo as VoceCopertura["tipo"],
          importoDopo: cents,
        });
        if (accontoPrevisto !== null) {
          await api.recordUpdate("ordine", ordineId, { acconto: accontoPrevisto });
        }
      }
      if (saldato) {
        riallineaApertiDopoSalvataggio = ordineId;
      }
      if (copertura.adeguamentoRate) {
        for (const aggiornamento of copertura.adeguamentoRate.aggiornamenti) {
          await api.recordUpdate("pagamento", aggiornamento.id, { importo: aggiornamento.importo });
        }
        for (const id of copertura.adeguamentoRate.eliminazioni) {
          await api.pagamentoElimina(id);
        }
      }
      if (copertura.totaleProdottiAdeguato) {
        prodottiAggiornati = await adeguaTotaleOrdine(
          copertura.totaleProdottiAdeguato.ordineId,
          copertura.totaleProdottiAdeguato.importo
        );
        riallineaApertiDopoSalvataggio = copertura.totaleProdottiAdeguato.ordineId;
      }
      if (copertura.residuoDaCreare && copertura.residuoDaCreare.importo > 0) {
        await api.pagamentoRegistra({
          ordineId,
          tipo: "rata",
          importo: copertura.residuoDaCreare.importo,
          saldato: false,
          scadenza: copertura.residuoDaCreare.scadenza,
          contoId,
          note: "Rimanenza concordata",
        });
      }
      if (copertura.creaRimborsoExtra) {
        const [precompilato, rimborsi] = await Promise.all([
          api.rimborsoExtraPrecompila(ordineId),
          api.rimborsiLista(),
        ]);
        const collegati = rimborsi.filter((r) => r.origine === "extra" && r.ordineId === ordineId);
        const giaEffettuato = collegati
          .filter((r) => r.stato === "effettuato")
          .reduce((sum, r) => sum + Math.max(0, r.importo), 0);
        const ancoraDaRichiedere = Math.max(0, precompilato.importo - giaEffettuato);
        const richiesto = collegati
          .filter((r) => r.stato === "richiesto")
          .sort((a, b) => b.dataRichiesta.localeCompare(a.dataRichiesta) || b.id.localeCompare(a.id))[0];
        if (ancoraDaRichiedere > 0) {
          await api.rimborsoSalva({
            id: richiesto?.id,
            dataRichiesta: richiesto?.dataRichiesta || oggi(),
            importo: ancoraDaRichiedere,
            ragioneSociale: richiesto?.ragioneSociale || precompilato.ragioneSociale,
            motivo: richiesto?.motivo || "Soldi in eccesso",
            iban: richiesto?.iban || precompilato.iban,
            contoId: richiesto?.contoId || "",
            dataRimborso: "",
            note: richiesto?.note || "Rimborso creato automaticamente dall'eccedenza del pagamento.",
            ordineId,
            origine: "extra",
          });
          rimborsoAutomatico = richiesto ? "aggiornato" : "creato";
        }
      }
      if (riallineaApertiDopoSalvataggio) {
        await riallineaPagamentiAperti(riallineaApertiDopoSalvataggio);
      }
      // Soldi incassati → monetina (FASE 7C). Solo quando l'incasso è effettivo (saldato).
      // Se la monetina parte è già esplicativa → niente toast (che la coprirebbe).
      // Usa fromPos (punto dove l'utente ha cliccato "Salda" nella tabella) come origine.
      const animato = saldato && mostraMonetina(fromPosRef.current);
      if (animato) {
        // Lascia percepire il riscontro prima che la modale si chiuda e la riga
        // raggiunga il nuovo gruppo della tabella, senza rallentare il flusso.
        await new Promise((resolve) => window.setTimeout(resolve, 420));
      }
      if (rimborsoAutomatico) {
        toast.success(`Pagamento registrato e rimborso ${rimborsoAutomatico}.`);
      } else if (!animato) {
        toast.success(isEdit ? "Pagamento aggiornato." : "Pagamento registrato.");
      }
      onChanged({ prodottiAggiornati });
    } catch (e) {
      const messaggio = String(e);
      toast.error(`Operazione non riuscita: ${messaggio}`);
    } finally {
      setSalvando(false);
    }
  }

  async function elimina() {
    if (!p) return;
    // Se l'ordine ha un rimborso "extra" associato (richiesto o emesso), annullare il
    // pagamento ne invalida il presupposto: avvisiamo e annulliamo anche il rimborso.
    let rimborso: Rimborso | undefined;
    try {
      rimborso = mappaRimborsiExtra(await api.rimborsiLista()).get(p.ordineId);
    } catch {
      /* se non riusciamo a leggerli, procediamo con la sola eliminazione del pagamento */
    }
    if (rimborso) {
      const emesso = rimborso.stato === "effettuato";
      const ok = await dialog.confirmDanger(
        "Annullare pagamento e rimborso?",
        `Per questo ordine è registrato un rimborso ${emesso ? "già EMESSO" : "richiesto"} di ` +
          `€ ${centsToEurStr(rimborso.importo)}. Annullando il pagamento verrà annullato anche il ` +
          `rimborso associato (finirà nel Cestino, ripristinabile).`,
        { conferma: emesso ? "Annulla pagamento e rimborso emesso" : "Annulla pagamento e rimborso" }
      );
      if (!ok) return;
    } else {
      const ok = await dialog.confirmDanger(
        "Annullare il pagamento?",
        "Il pagamento verrà rimosso dallo scadenzario. Incassato, residuo e stato si ricalcolano da soli.",
        { conferma: "Annulla pagamento" }
      );
      if (!ok) return;
    }
    (window as any).eliminatoDaMe = true;
    setEliminando(true);
    setSalvando(true);
    try {
      await Promise.all([
        (async () => {
          await api.pagamentoElimina(p.id);
          if (rimborso) await api.recordDelete("rimborso", rimborso.id);
        })(),
        animazioniRidotte
          ? Promise.resolve()
          : new Promise<void>((resolve) => window.setTimeout(resolve, 340)),
      ]);
      toast.success(
        rimborso
          ? "Pagamento eliminato e rimborso annullato."
          : "Pagamento eliminato."
      );
      onChanged();
    } catch (e) {
      setEliminando(false);
      toast.error(`Eliminazione non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="pt-modal-shell" style={{ position: "relative" }}>
      <OverlaySalvataggioFinestra visibile={!!dentroFinestra && salvando && !eliminando} />
      <div className="pt-modal-scroll">
        <fieldset
          disabled={bloccatoDaDistinta}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <Stack gap="sm">
          <Group className="pt-payment-form-row" grow>
            <Select
              label="Tipo"
              data={TIPI_PAGAMENTO as unknown as { value: string; label: string }[]}
              value={tipo}
              onChange={(v) => setTipo(v ?? "saldo")}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true, zIndex: 1400 }}
            />
            <div data-pt-field="pagamento-importo">
              <EuroInput
                label="Importo"
                value={importo}
                onChange={(v) => setImporto(v === "" ? "" : Number(v))}
                min={0}
              />
            </div>
          </Group>

          <div>
            <Text size="sm" fw={500} mb={4}>
              Stato
            </Text>
            <SegmentedControl
              fullWidth
              value={saldato ? "saldato" : "atteso"}
              onChange={(v) => setSaldato(v === "saldato")}
              data={[
                { value: "atteso", label: "Atteso" },
                { value: "saldato", label: "Incassato" },
              ]}
            />
          </div>

          <Group className="pt-payment-form-row" grow>
            <div data-pt-field="pagamento-conto">
              <Select
                label={saldato ? "Conto" : "Conto previsto"}
                placeholder="Scegli…"
                data={datiConti}
                value={contoId || null}
                onChange={(v) => setContoId(v ?? "")}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true, zIndex: 1400 }}
              />
            </div>
            {saldato ? (
              <TextInput label="Data incasso" type="date" value={data} onChange={(e) => setData(e.currentTarget.value)} />
            ) : scadenzaDaSpedizione ? (
              <TextInput
                label="Scadenza prevista"
                value={`≈ spedizione + ${offsetSpedizione}gg`}
                disabled
              />
            ) : (
              <TextInput
                label="Scadenza prevista"
                type="date"
                value={scadenza}
                onChange={(e) => setScadenza(e.currentTarget.value)}
              />
            )}
          </Group>
          {saldato && (
            <Checkbox
              checked={verificato}
              onChange={(e) => setVerificato(e.currentTarget.checked)}
              label="Verificato in prima nota"
            />
          )}
          {!saldato && (tipo === "saldo" || tipo === "rata") && (
            <Checkbox
              checked={scadDaSpedizione}
              onChange={(e) => setScadDaSpedizione(e.currentTarget.checked)}
              label="Collega la scadenza alla data di spedizione"
              description="Alla spedizione, la scadenza si fissa a +7 giorni (i conti contrassegno/assegno a +30)."
              styles={{ description: { fontSize: '11px', paddingLeft: '4px' } }}
            />
          )}

            <Textarea label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={1} />
          </Stack>
        </fieldset>
      </div>

      <div className="pt-modal-footer">
        {bloccatoDaDistinta ? (
          <Badge variant="light" color="blue">
            Incluso in distinta · sola lettura
          </Badge>
        ) : isEdit ? (
          <Button
            variant="subtle"
            color="red"
            leftSection={
              <motion.span
                animate={
                  eliminando
                    ? {
                        rotate: [0, -12, 10, 0],
                        scale: [1, 1.16, 0.82, 1],
                        opacity: [1, 0.82, 0.55, 1],
                      }
                    : undefined
                }
                transition={{ duration: 0.32, ease: "easeOut" }}
                style={{ display: "inline-flex" }}
              >
                <IconTrash size={16} />
              </motion.span>
            }
            onClick={() => void elimina()}
            disabled={salvando}
          >
            Annulla pagamento
          </Button>
        ) : (
          <span />
        )}
        <div className="pt-modal-actions">
          <Button variant="default" onClick={onClose} disabled={salvando}>
            Chiudi
          </Button>
          {!bloccatoDaDistinta && (
            <Button color="accent" onClick={salva} loading={salvando}>
              {isEdit ? "Salva" : saldato ? "Registra" : "Aggiungi atteso"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
