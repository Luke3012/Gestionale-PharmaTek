// Tab Crediti (FASE 3): vista UNICA dei pagamenti — attesi e saldati insieme — con
// numero ordine, tipo, importo, scadenza/incasso, stato e verifica. Filtri (agente,
// conto, periodo, stato), colonne ordinabili/configurabili come il Giornaliero.
// Spuntare "verificato" o cliccare una riga / "Salda" apre la modale pagamento.
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Indicator,
  MultiSelect,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconMessage,
  IconReceiptRefund,
  IconSearch,
  IconWallet,
} from "@tabler/icons-react";
import {
  api,
  type PagamentoVista,
  type RecordDto,
  type Rimborso,
  type Spedizione,
} from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { CATEGORIE_PRODOTTO } from "../anagrafiche/categorie";
import { centsToEurStr } from "../../lib/money";
import {
  Tabella,
  type DataTableColumn,
  type DataTableSortStatus,
} from "../../ui/Tabella";
import { FiltriPopover } from "../../ui/FiltriPopover";
import { DebouncedInput } from "../../ui/DebouncedInput";
import { usePaginaPronta } from "../../pages/Pagina";
import { ColonneMenu } from "../giornaliero/ColonneMenu";
import {
  EsportaTabella,
  useColonneEsportabili,
} from "../../ui/esporta/EsportaTabella";
import { useColonneCrediti, scaduta, potenziale } from "./colonneCrediti";
import { PagamentoModal, type PagamentoModalTarget } from "./PagamentoModal";
import { RimborsoModal, type RimborsoModalTarget } from "./RimborsoModal";
import { mappaRimborsiExtra, statoRimborsoDef } from "./statiRimborso";
import { isSpedito } from "../giornaliero/stati";
import { usePrefs } from "../../lib/prefs";
import { VistaTabellaParallela } from "../../ui/VistaTabellaParallela";
import {
  mappaLottiPerOrdine,
  opzioniLottiSpedizione,
} from "../spedizioni/filtriSpedizione";
import { FiltroStatoSpedizione } from "../spedizioni/FiltroStatoSpedizione";
import { opzioniConti } from "./contoPreferito";
import { FiltroIntervalloDate } from "../../ui/FiltroIntervalloDate";
import { opzioniRecordNome } from "../../lib/opzioniRecord";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import {
  PremiumAction,
  canRunPremiumAction,
} from "../../premium/PremiumAction";
import { usePremiumAccess } from "../../premium/PremiumAccess";
import {
  apriCampagnaComunicazioni,
  apriComunicazione,
  datiPagamentoComunicazione,
  riepilogoSollecitoPagamenti,
  variabiliNomeDestinatario,
} from "../comunicazioni/apriComunicazione";
import { pagamentoDaVista } from "./pagamentoDaVista";
import { ordinaCopia } from "../../ui/ordinamento";
import { colonneTabellaConfigurabili } from "../../ui/colonneConfigurabili";

// Oltre N righe si impagina: sostituita da Cluster Virtualization in Tabella.tsx

const STATI = [
  { value: "potenziale", label: "Potenziali" },
  { value: "atteso", label: "Attesi" },
  { value: "scaduto", label: "Scaduti" },
  { value: "saldato", label: "Incassati" },
  { value: "da_verificare", label: "Da verificare" },
];

const EVENTI_RICARICA = [
  "pagamento:salvato",
  "ordine:salvato",
  "rimborso:salvato",
  "distinta:salvato",
  "spedizione:salvato",
  "cliente:salvato",
  "medico:salvato",
  "agente:salvato",
  "conto:salvato",
  "prodotto:salvato",
] as const;

function aggiungiSetteGiorni(dataIso: string) {
  const data = new Date(`${dataIso}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + 7);
  return data.toISOString().slice(0, 10);
}

/** Tag di stato di una riga (per il filtro multiplo). */
function statiDi(r: PagamentoVista): string[] {
  if (!r.saldato) {
    if (potenziale(r)) return ["potenziale"];
    return scaduta(r) ? ["atteso", "scaduto"] : ["atteso"];
  }
  return r.verificato ? ["saldato"] : ["saldato", "da_verificare"];
}

export interface FiltroPagamentiIniziale {
  nonce: number;
  cerca?: string;
  stati?: string[];
  spedito?: "spediti" | "non";
  conto?: { id?: string; nome?: string };
  contoIds?: string[];
  spedizioneLotti?: string[];
  agenteIds?: string[];
  medicoIds?: string[];
  linee?: string[];
  dal?: string;
  al?: string;
}

export function PagamentiView({
  filtroIniziale,
  attiva = true,
}: {
  attiva?: boolean;
  /** Deep-link completo: il nonce riapplica il filtro anche se si ripete lo stesso comando. */
  filtroIniziale?: FiltroPagamentiIniziale;
}) {
  const { anno, ridurreAnimazioni } = usePrefs();
  const premium = usePremiumAccess();
  const [agenti, setAgenti] = useState<RecordDto[]>([]);
  const [medici, setMedici] = useState<RecordDto[]>([]);
  const [clienti, setClienti] = useState<RecordDto[]>([]);
  const [conti, setConti] = useState<RecordDto[]>([]);
  const [cerca, setCerca] = useState("");
  const cercaDifferita = useDeferredValue(cerca);

  const [agentiSel, setAgentiSel] = useState<string[]>([]);
  const [mediciSel, setMediciSel] = useState<string[]>([]);
  const [contiSel, setContiSel] = useState<string[]>([]);
  const [statiSel, setStatiSel] = useState<string[]>([]);
  const [lineeSel, setLineeSel] = useState<string[]>([]);
  const [spedizioniSel, setSpedizioniSel] = useState<string[]>([]);
  const [speditoSel, setSpeditoSel] = useState<"tutti" | "spediti" | "non">(
    "tutti",
  );
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");
  const [righe, setRighe] = useState<PagamentoVista[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  // Default: per stato, da scaduto a saldato (i crediti più urgenti in cima).
  const [sort, setSort] = useState<DataTableSortStatus<PagamentoVista>>({
    columnAccessor: "stato",
    direction: "asc",
  });
  const [target, setTarget] = useState<PagamentoModalTarget | null>(null);
  const [rimborsoExtra, setRimborsoExtra] =
    useState<RimborsoModalTarget | null>(null);
  // Mappa ordineId → residuo (negativo = pagato in eccesso, candidabile a rimborso extra).
  const [residuoByOrder, setResiduoByOrder] = useState<Map<string, number>>(
    new Map(),
  );
  const [annoByOrder, setAnnoByOrder] = useState<Map<string, number>>(
    new Map(),
  );
  const [spedizioni, setSpedizioni] = useState<Spedizione[]>([]);
  // Rimborsi "extra" già esistenti per ordine: per tracciarne lo stato e non duplicarli.
  const [rimborsiExtra, setRimborsiExtra] = useState<Map<string, Rimborso>>(
    new Map(),
  );
  const colonne = useColonneCrediti();
  // Per il primo reveal servono tabella e totali. I riferimenti accessori dei filtri
  // e dei rimborsi possono completarsi in parallelo senza tenere nascosta la pagina.
  usePaginaPronta(caricamento);

  // Riferimenti per il rimborso extra: residuo per ordine + rimborsi esistenti.
  const caricaRiferimenti = useCallback(async () => {
    const [os, rs, ss, cs] = await Promise.all([
      api.ordiniLista().catch(() => null),
      api.rimborsiLista().catch(() => null),
      api.spedizioniLista().catch(() => null),
      api.recordsList("cliente").catch(() => null),
    ]);
    if (os) {
      setResiduoByOrder(new Map(os.map((o) => [o.id, o.residuo])));
      setAnnoByOrder(
        new Map(os.map((o) => [o.id, Number(o.data.slice(0, 4))])),
      );
    }
    if (rs) setRimborsiExtra(mappaRimborsiExtra(rs));
    if (ss) setSpedizioni(ss);
    if (cs) setClienti(cs);
  }, []);

  useEffect(() => {
    let attivo = true;
    Promise.all([
      api.recordsList("agente").catch(() => []),
      api.recordsList("medico").catch(() => []),
      api.recordsList("conto").catch(() => []),
      caricaRiferimenti(),
    ])
      .then(([as, ms, cs]) => {
        if (!attivo) return;
        setAgenti(as);
        setMedici(ms);
        setConti(cs);
      })
      .catch(() => {});
    return () => {
      attivo = false;
    };
  }, [caricaRiferimenti]);

  // Carica TUTTI i pagamenti; i filtri (multipli) si applicano lato client.
  const carica = useCallback(async (silente = false) => {
    if (!silente) setCaricamento(true);
    try {
      setRighe(await api.pagamentiVista());
    } catch (e) {
      toast.error(`Caricamento crediti non riuscito: ${e}`);
    } finally {
      setCaricamento(false);
    }
  }, []);

  useEffect(() => {
    carica(false);
  }, [carica]);

  // Aggiornamento quando cambia una qualsiasi dipendenza della vista crediti.
  useRicaricaSuEventi(
    EVENTI_RICARICA,
    () => {
      void carica(true);
      void caricaRiferimenti();
    },
    160,
  );

  // Deep-link da Spotlight/Dashboard. È uno snapshot completo: azzera i filtri non
  // richiesti, evitando che una selezione precedente renda il risultato incomprensibile.
  useEffect(() => {
    if (!filtroIniziale) return;
    setCerca(filtroIniziale.cerca ?? "");
    setStatiSel(filtroIniziale.stati ?? []);
    setSpeditoSel(filtroIniziale.spedito ?? "tutti");
    setDal(filtroIniziale.dal ?? "");
    setAl(filtroIniziale.al ?? "");
    setAgentiSel(filtroIniziale.agenteIds ?? []);
    setMediciSel(filtroIniziale.medicoIds ?? []);
    setLineeSel(filtroIniziale.linee ?? []);
    setSpedizioniSel(filtroIniziale.spedizioneLotti ?? []);
  }, [filtroIniziale]);
  useEffect(() => {
    if (!filtroIniziale) return;
    const conto = filtroIniziale.conto;
    if (filtroIniziale.contoIds) {
      setContiSel(filtroIniziale.contoIds);
      return;
    }
    if (!conto) {
      setContiSel([]);
      return;
    }
    if (conto.id) {
      setContiSel([conto.id]);
      return;
    }
    const nome = conto.nome?.toLowerCase().trim();
    if (!nome) {
      setContiSel([]);
      return;
    }
    const trovato = conti.find((c) =>
      String(c.data.nome ?? "")
        .toLowerCase()
        .includes(nome),
    );
    setContiSel(trovato ? [trovato.id] : []);
  }, [filtroIniziale, conti]);

  async function verifica(r: PagamentoVista, value: boolean) {
    setRighe((rs) =>
      rs.map((x) => (x.id === r.id ? { ...x, verificato: value } : x)),
    );
    try {
      await api.recordUpdate("pagamento", r.id, { verificato: value });
    } catch (e) {
      toast.error(`Aggiornamento non riuscito: ${e}`);
      carica();
    }
  }

  async function apriPagamento(
    r: PagamentoVista,
    saldaSubito = false,
    fromPos?: { x: number; y: number },
  ) {
    try {
      const rec = await api.recordGet("pagamento", r.id);
      const pagamento = pagamentoDaVista(r, rec);
      setTarget({ pagamento, saldaSubito, fromPos });
    } catch (e) {
      toast.error(`Apertura non riuscita: ${e}`);
    }
  }

  async function apriSollecito(r: PagamentoVista) {
    try {
      const riepilogo = riepilogoSollecitoPagamenti([r], righe);
      if (!riepilogo.pagamentiScaduti.length) {
        toast.info("Non risultano pagamenti scaduti per questo ordine.");
        return;
      }
      const cliente = await api.recordGet("cliente", r.clienteId);
      if (!cliente) {
        toast.error("Cliente non trovato.");
        return;
      }
      const datiPagamento = datiPagamentoComunicazione(
        riepilogo.pagamentiAperti,
        conti,
      );
      await apriComunicazione({
        destinatarioEntita: "cliente",
        destinatarioId: cliente.id,
        destinatarioNome: r.clienteNome,
        email: String(cliente.data.email ?? ""),
        telefono: String(cliente.data.telefono ?? ""),
        tipo: "sollecito_pagamento",
        origineEntita: "ordine",
        origineId: r.ordineId,
        variabili: {
          ...variabiliNomeDestinatario(r.clienteNome),
          nome_medico: r.medicoNome,
          nome_agente: r.agenteNome,
          riferimento_ordine: riepilogo.riferimento_ordine,
          totale_scaduto: riepilogo.totale_scaduto,
          dettaglio_rate: riepilogo.dettaglio_rate,
          ...datiPagamento,
        },
      });
    } catch (error) {
      toast.error(`Apertura del sollecito non riuscita: ${error}`);
    }
  }

  // Il DTO porta il nome agente/medico; risolviamo l'id dall'anagrafica per il filtro.
  const agenteIdByNome = useMemo(() => {
    const m = new Map<string, string>();
    agenti.forEach((a) => m.set((a.data.nome as string) || "", a.id));
    return m;
  }, [agenti]);
  const medicoIdByNome = useMemo(() => {
    const m = new Map<string, string>();
    medici.forEach((md) => m.set((md.data.nome as string) || "", md.id));
    return m;
  }, [medici]);

  const agentiSet = useMemo(() => new Set(agentiSel), [agentiSel]);
  const mediciSet = useMemo(() => new Set(mediciSel), [mediciSel]);
  const contiSet = useMemo(() => new Set(contiSel), [contiSel]);
  const statiSet = useMemo(() => new Set(statiSel), [statiSel]);
  const lineeSet = useMemo(() => new Set(lineeSel), [lineeSel]);
  const spedizioniSet = useMemo(() => new Set(spedizioniSel), [spedizioniSel]);
  const lottiPerOrdine = useMemo(
    () => mappaLottiPerOrdine(spedizioni),
    [spedizioni],
  );
  const telefonoPerAnagrafica = useMemo(() => {
    const mappa = new Map<string, string>();
    for (const record of [...clienti, ...medici]) {
      mappa.set(record.id, String(record.data.telefono ?? ""));
    }
    return mappa;
  }, [clienti, medici]);
  const numeriProdottoPerOrdine = useMemo(() => {
    const mappa = new Map<string, Set<string>>();
    for (const spedizione of spedizioni) {
      for (const riga of spedizione.righe) {
        const numeri = String(riga.numero ?? "")
          .split(/\r?\n/)
          .map((numero) => numero.trim())
          .filter(Boolean);
        if (numeri.length === 0) continue;
        const insieme = mappa.get(riga.ordineId) ?? new Set<string>();
        numeri.forEach((numero) => insieme.add(numero));
        mappa.set(riga.ordineId, insieme);
      }
    }
    return mappa;
  }, [spedizioni]);

  const righeConBlob = useMemo(() => {
    return righe.map((r) => {
      const telefono =
        telefonoPerAnagrafica.get(r.clienteId) ??
        telefonoPerAnagrafica.get(r.medicoId) ??
        "";
      return {
        ...r,
        _searchBlob: [
          r.clienteNome,
          r.medicoNome,
          r.agenteNome,
          r.ordineNumero,
          telefono,
          telefono.replace(/\D/g, ""),
          ...(numeriProdottoPerOrdine.get(r.ordineId) ?? []),
        ]
          .join(" ")
          .toLowerCase(),
      };
    });
  }, [righe, telefonoPerAnagrafica, numeriProdottoPerOrdine]);

  // Filtri MULTIPLI simultanei (client-side): ricerca testuale, agenti, conti, stati, periodo.
  const filtrateFinali = useMemo(() => {
    const q = cercaDifferita.trim().toLowerCase();
    return righeConBlob.filter((r) => {
      if (q && !r._searchBlob.includes(q)) return false;
      if (anno !== 0 && annoByOrder.get(r.ordineId) !== anno) return false;
      if (
        agentiSet.size > 0 &&
        !agentiSet.has(agenteIdByNome.get(r.agenteNome) ?? "")
      )
        return false;
      if (
        mediciSet.size > 0 &&
        !mediciSet.has(medicoIdByNome.get(r.medicoNome) ?? "")
      )
        return false;
      if (contiSet.size > 0 && !contiSet.has(r.contoId)) return false;
      if (statiSet.size > 0 && !statiDi(r).some((s) => statiSet.has(s)))
        return false;
      if (lineeSet.size > 0 && !(r.linee ?? []).some((l) => lineeSet.has(l)))
        return false;
      if (
        spedizioniSet.size > 0 &&
        ![...(lottiPerOrdine.get(r.ordineId) ?? [])].some((lotto) =>
          spedizioniSet.has(lotto),
        )
      )
        return false;
      if (speditoSel === "spediti" && !isSpedito(r.ordineStato)) return false;
      if (speditoSel === "non" && isSpedito(r.ordineStato)) return false;
      // I Crediti seguono l'anno di lavoro come le altre viste operative; Dal/Al
      // restringono ulteriormente la data di scadenza/incasso nel medesimo insieme.
      const ril = r.saldato ? r.data : r.scadenza;
      if (dal && (!ril || ril < dal)) return false;
      if (al && (!ril || ril > al)) return false;
      return true;
    });
  }, [
    righeConBlob,
    cercaDifferita,
    anno,
    annoByOrder,
    agentiSet,
    mediciSet,
    contiSet,
    statiSet,
    lineeSet,
    spedizioniSet,
    lottiPerOrdine,
    speditoSel,
    dal,
    al,
    agenteIdByNome,
    medicoIdByNome,
  ]);

  const ordinate = useMemo(() => {
    const def = colonne.visibili.find((c) => c.key === sort.columnAccessor);
    const getter = def?.sortAccessor;
    if (!getter) return filtrateFinali;
    return ordinaCopia(filtrateFinali, getter, sort.direction);
  }, [filtrateFinali, sort, colonne.visibili]);

  const scadutiFiltrati = useMemo(
    () => filtrateFinali.filter(scaduta),
    [filtrateFinali],
  );
  const clientiScaduti = useMemo(
    () => new Set(scadutiFiltrati.map((item) => item.clienteId)).size,
    [scadutiFiltrati],
  );

  async function apriCampagnaSolleciti() {
    try {
      const clienti = await api.recordsList("cliente");
      const clientiPerId = new Map(
        clienti.map((cliente) => [cliente.id, cliente]),
      );
      const perCliente = new Map<string, PagamentoVista[]>();
      for (const pagamento of scadutiFiltrati) {
        const gruppo = perCliente.get(pagamento.clienteId) ?? [];
        gruppo.push(pagamento);
        perCliente.set(pagamento.clienteId, gruppo);
      }
      const targets = [...perCliente.entries()].map(
        ([clienteId, pagamenti]) => {
          const cliente = clientiPerId.get(clienteId);
          const riepilogo = riepilogoSollecitoPagamenti(
            pagamenti,
            righe.filter((item) => item.clienteId === clienteId),
          );
          const ordinati = riepilogo.pagamentiScaduti;
          const aperti = riepilogo.pagamentiAperti;
          const datiPagamento = datiPagamentoComunicazione(aperti, conti);
          return {
            destinatarioEntita: "cliente" as const,
            destinatarioId: clienteId,
            destinatarioNome: ordinati[0].clienteNome,
            email: String(cliente?.data.email ?? ""),
            telefono: String(cliente?.data.telefono ?? ""),
            tipo: "sollecito_pagamento" as const,
            snapshot: [
              ...aperti.map((item) => ({
                entita: "pagamento",
                id: item.id,
                revision: item.revision,
              })),
              ...(cliente
                ? [
                    {
                      entita: "cliente",
                      id: cliente.id,
                      revision: cliente.revision,
                    },
                  ]
                : []),
            ],
            proroga: ordinati.map((item) => ({
              id: item.id,
              revision: item.revision,
              vecchiaScadenza: item.scadenza,
              nuovaScadenza: aggiungiSetteGiorni(item.scadenza),
              importo: item.importo,
              contoId: item.contoId,
            })),
            variabili: {
              ...variabiliNomeDestinatario(ordinati[0].clienteNome),
              nome_medico: [
                ...new Set(
                  ordinati.map((item) => item.medicoNome).filter(Boolean),
                ),
              ].join(", "),
              nome_agente: [
                ...new Set(
                  ordinati.map((item) => item.agenteNome).filter(Boolean),
                ),
              ].join(", "),
              riferimento_ordine: riepilogo.riferimento_ordine,
              totale_scaduto: riepilogo.totale_scaduto,
              dettaglio_rate: riepilogo.dettaglio_rate,
              ...datiPagamento,
            },
          };
        },
      );
      if (!(await apriCampagnaComunicazioni(targets))) {
        toast.info("Nessun sollecito da preparare.");
      }
    } catch (error) {
      toast.error(`Preparazione dei solleciti non riuscita: ${error}`);
    }
  }

  // Riga "in eccesso" per ogni ordine pagato in eccedenza: una sola, l'ultimo pagamento
  // saldato (quello che ha superato il totale). Solo lì proponiamo "Rimborsa extra".
  const righeEccesso = useMemo(() => {
    const ultimoSaldato = new Map<string, PagamentoVista>();
    for (const r of righe) {
      if (!r.saldato) continue;
      if ((residuoByOrder.get(r.ordineId) ?? 0) >= 0) continue;
      const prev = ultimoSaldato.get(r.ordineId);
      // "più recente" = data maggiore, a parità id maggiore (ULID ~ ordine di creazione).
      if (
        !prev ||
        r.data > prev.data ||
        (r.data === prev.data && r.id > prev.id)
      ) {
        ultimoSaldato.set(r.ordineId, r);
      }
    }
    return new Set([...ultimoSaldato.values()].map((r) => r.id));
  }, [righe, residuoByOrder]);

  // Tre secchi: potenziale (preventivi Nuovo), atteso (credito reale, ordine impegnato),
  // incassato (saldati). I Rifiutati sono già esclusi a monte dalla vista.
  const totali = useMemo(() => {
    let pot = 0;
    let att = 0;
    let inc = 0;
    for (const r of filtrateFinali) {
      if (r.saldato) inc += r.importo;
      else if (potenziale(r)) pot += r.importo;
      else att += r.importo;
    }
    return { potenziale: pot, atteso: att, incassato: inc };
  }, [filtrateFinali]);

  const datiAgenti = useMemo(
    () =>
      opzioniRecordNome(agenti, "(agente)"),
    [agenti],
  );
  const datiMedici = useMemo(
    () =>
      opzioniRecordNome(medici, "(medico)"),
    [medici],
  );
  const datiConti = useMemo(() => opzioniConti(conti), [conti]);
  const datiSpedizioni = useMemo(
    () => opzioniLottiSpedizione(spedizioni, anno),
    [spedizioni, anno],
  );

  // Numero di filtri attivi (per il badge del popover) e reset complessivo.
  const nFiltri =
    (agentiSel.length > 0 ? 1 : 0) +
    (mediciSel.length > 0 ? 1 : 0) +
    (contiSel.length > 0 ? 1 : 0) +
    (statiSel.length > 0 ? 1 : 0) +
    (lineeSel.length > 0 ? 1 : 0) +
    (spedizioniSel.length > 0 ? 1 : 0) +
    (speditoSel !== "tutti" ? 1 : 0) +
    (dal ? 1 : 0) +
    (al ? 1 : 0);

  function azzeraFiltri() {
    setAgentiSel([]);
    setMediciSel([]);
    setContiSel([]);
    setStatiSel([]);
    setLineeSel([]);
    setSpedizioniSel([]);
    setSpeditoSel("tutti");
    setDal("");
    setAl("");
  }

  const colonneExport = useColonneEsportabili(colonne);

  const columns = useMemo<DataTableColumn<PagamentoVista>[]>(() => {
    const dati = colonneTabellaConfigurabili<PagamentoVista>(colonne.visibili);
    const azione: DataTableColumn<PagamentoVista> = {
      accessor: "azione",
      title: "",
      width: 116,
      textAlign: "center",
      render: (r) => {
        // Solo sulla riga in eccesso (l'ultimo pagamento che ha superato il totale)
        // proponiamo il rimborso; se ne esiste già uno ne mostriamo lo stato.
        if (righeEccesso.has(r.id)) {
          const esistente = rimborsiExtra.get(r.ordineId);
          const statoRimborso = esistente
            ? statoRimborsoDef(esistente.stato)
            : null;
          return (
            <Group
              justify="center"
              gap={4}
              onClick={(e) => e.stopPropagation()}
            >
              {esistente && statoRimborso ? (
                <Button
                  size="compact-xs"
                  variant="light"
                  color={statoRimborso.color}
                  leftSection={<statoRimborso.Ico size={13} />}
                  onClick={() => setRimborsoExtra({ rimborso: esistente })}
                >
                  {esistente.stato === "effettuato"
                    ? "Rimborso emesso"
                    : "Rimborso richiesto"}
                </Button>
              ) : (
              <Button
                size="compact-xs"
                variant="light"
                color="grape"
                leftSection={<IconReceiptRefund size={13} />}
                onClick={() =>
                  setRimborsoExtra({
                    nuovoExtra: {
                      ordineId: r.ordineId,
                      numero: r.ordineNumero,
                    },
                  })
                }
              >
                Rimborsa extra
              </Button>
              )}
            </Group>
          );
        }
        return (
          <Group justify="center" gap={4} onClick={(e) => e.stopPropagation()}>
            {r.saldato ? (
              <Checkbox
                checked={r.verificato}
                onChange={(e) => verifica(r, e.currentTarget.checked)}
                color="teal"
                aria-label="Verificato in prima nota"
                title="Verificato in prima nota"
              />
            ) : (
              <>
                {scaduta(r) && canRunPremiumAction(premium) && (
                  <Tooltip label="Sollecita" withArrow openDelay={350}>
                    <Box>
                      <PremiumAction
                        ariaLabel="Sollecita"
                        iconOnly
                        leftSection={<IconMessage size={15} />}
                        style={{
                          background: "var(--mantine-color-gray-light)",
                          borderColor: "transparent",
                          height: 26,
                          minHeight: 26,
                          padding: 0,
                          width: 26,
                        }}
                        onAction={() => void apriSollecito(r)}
                      >
                        Sollecita
                      </PremiumAction>
                    </Box>
                  </Tooltip>
                )}
                <Button
                  size="compact-xs"
                  variant="light"
                  color="accent"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const fromPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                    apriPagamento(r, true, fromPos);
                  }}
                >
                  Salda
                </Button>
              </>
            )}
          </Group>
        );
      },
    };
    return [...dati, azione];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    colonne.visibili,
    righeEccesso,
    rimborsiExtra,
    conti,
    premium.loaded,
    premium.enabled,
  ]);

  const tabellaCrediti = useMemo(() => (
    <Tabella<PagamentoVista>
      height="100%"
      columns={columns}
      records={ordinate}
      caricamentoIniziale={caricamento}
      ridimensionamentoSenzaSfumaturaKey={cercaDifferita}
      idAccessor="id"
      storeColumnsKey="contabilita-crediti-v3"
      memorizzaLarghezze
      minColumnWidths={{ stato: 100, tipo: 82, azione: 108 }}
      sortStatus={sort}
      onSortStatusChange={setSort}
      onRowClick={({ record }) => apriPagamento(record)}
      rowStyle={(r) => (scaduta(r) ? { cursor: "pointer", background: "var(--mantine-color-red-light)" } : { cursor: "pointer" })}
      emptyState={
        caricamento ? (
          <Box />
        ) : (
          <Stack align="center" gap="xs" maw={420} ta="center" py={40}>
            <ThemeIcon size={48} radius="xl" variant="light" color="gray">
              <IconWallet size={24} />
            </ThemeIcon>
            <Text c="dimmed" size="sm">
              Nessun credito per i filtri scelti. Lo scadenzario si crea salvando un ordine con un
              importo (acconto + saldo).
            </Text>
          </Stack>
        )
      }
    />
    // Memoizziamo la tabella: apertura/chiusura modali e target pagamento non devono ridisegnare
    // tutte le righe dei crediti quando il dataset e i filtri sono invariati.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [columns, ordinate, sort, caricamento, cercaDifferita]);

  return (
    <VistaTabellaParallela
      nascosta={!attiva || (caricamento && righe.length === 0)}
      ridurreAnimazioni={ridurreAnimazioni}
    >
      <Group
        className="pt-crediti-toolbar"
        gap="sm"
        wrap="nowrap"
        align="flex-end"
      >
        <DebouncedInput
          className="pt-crediti-ricerca"
          placeholder="Cerca cliente, telefono, n° ordine o lotto…"
          leftSection={<IconSearch size={16} />}
          value={cerca}
          onChange={setCerca}
          style={{ flex: "1 1 200px", maxWidth: 300 }}
        />
        <Box className="pt-crediti-filtri">
          <FiltriPopover
            attivi={nFiltri}
            onAzzera={azzeraFiltri}
            width={320}
            filtri={[
            {
              chiave: "agenti",
              larghezza: 180,
              nodo: (
                <MultiSelect
                  label="Agenti"
                  placeholder={agentiSel.length ? "" : "Tutti"}
                  data={datiAgenti}
                  value={agentiSel}
                  onChange={setAgentiSel}
                  clearable
                  searchable
                  comboboxProps={{ withinPortal: false }}
                />
              ),
            },
            {
              chiave: "medici",
              larghezza: 180,
              nodo: (
                <MultiSelect
                  label="Medici"
                  placeholder={mediciSel.length ? "" : "Tutti"}
                  data={datiMedici}
                  value={mediciSel}
                  onChange={setMediciSel}
                  clearable
                  searchable
                  comboboxProps={{ withinPortal: false }}
                />
              ),
            },
            {
              chiave: "conti",
              larghezza: 180,
              nodo: (
                <MultiSelect
                  label="Conti"
                  placeholder={contiSel.length ? "" : "Tutti"}
                  data={datiConti}
                  value={contiSel}
                  onChange={setContiSel}
                  clearable
                  searchable
                  comboboxProps={{ withinPortal: false }}
                />
              ),
            },
            {
              chiave: "stato",
              larghezza: 170,
              nodo: (
                <MultiSelect
                  label="Stato"
                  placeholder={statiSel.length ? "" : "Tutti"}
                  data={STATI}
                  value={statiSel}
                  onChange={setStatiSel}
                  clearable
                  comboboxProps={{ withinPortal: false }}
                />
              ),
            },
            {
              chiave: "linee",
              larghezza: 170,
              nodo: (
                <MultiSelect
                  label="Linee"
                  placeholder={lineeSel.length ? "" : "Tutte"}
                  data={CATEGORIE_PRODOTTO}
                  value={lineeSel}
                  onChange={setLineeSel}
                  clearable
                  comboboxProps={{ withinPortal: false }}
                />
              ),
            },
            {
              chiave: "spedizioni",
              larghezza: 260,
              nodo: (
                <MultiSelect
                  label="Spedizioni"
                  placeholder={spedizioniSel.length ? "" : "Tutte"}
                  data={datiSpedizioni}
                  value={spedizioniSel}
                  onChange={setSpedizioniSel}
                  clearable
                  searchable
                  comboboxProps={{ withinPortal: false }}
                />
              ),
            },
            {
              chiave: "spedito",
              larghezza: 240,
              nodo: (
                <FiltroStatoSpedizione value={speditoSel} onChange={setSpeditoSel} />
              ),
            },
            {
              chiave: "periodo",
              larghezza: 260,
              nodo: (
                <FiltroIntervalloDate dal={dal} al={al} onDalChange={setDal} onAlChange={setAl} />
              ),
            },
            ]}
          />
        </Box>
        {clientiScaduti > 0 && (
          <PremiumAction
            ariaLabel={`Sollecita ${clientiScaduti} clienti`}
            className="pt-crediti-sollecita"
            leftSection={
              <Indicator
                className="pt-crediti-sollecita-indicatore"
                label={clientiScaduti > 99 ? "99+" : clientiScaduti}
                size={14}
                offset={2}
                color="red"
              >
                <IconMessage size={17} />
              </Indicator>
            }
            buttonVariant="default"
            lockedPresentation="modal"
            showLock={false}
            title="Funzionalità extra"
            message="La preparazione e l’invio coordinato dei solleciti a più clienti è disponibile tra le funzionalità extra."
            style={{ whiteSpace: "nowrap" }}
            onAction={() => void apriCampagnaSolleciti()}
          >
            <span className="pt-crediti-label-estesa">Sollecita</span>
            <span className="pt-crediti-label-compatta">Sollecita</span>
          </PremiumAction>
        )}
        <EsportaTabella
          nomeBase="crediti"
          foglio="Crediti"
          titolo="Crediti"
          colonne={colonneExport}
          righe={ordinate}
          adattivo
          etichettaCompatta="Esporta"
        />
        <ColonneMenu
          ordineKeys={colonne.ordineKeys}
          tutte={colonne.tutte}
          riordina={colonne.riordina}
          toggle={colonne.toggle}
          reset={colonne.reset}
          adattivo
        />
      </Group>

      <Card withBorder radius="md" p="md" bg="var(--bg)">
        <Group justify="space-between" wrap="wrap">
          <Group gap="sm">
            <ThemeIcon size={40} radius="md" variant="light" color="blue">
              <IconWallet size={22} />
            </ThemeIcon>
            <Box>
              <Text size="xs" c="dimmed">
                Atteso (da incassare)
              </Text>
              <Text fw={700} fz={24} c="blue" className="tabular">
                € {centsToEurStr(totali.atteso)}
              </Text>
            </Box>
          </Group>
          <Group gap={48} wrap="wrap">
            <Box ta="right">
              <Text size="xs" c="dimmed">
                Incassato
              </Text>
              <Text fw={700} fz="lg" c="teal" className="tabular">
                € {centsToEurStr(totali.incassato)}
              </Text>
            </Box>
            <Box ta="right">
              <Text size="xs" c="dimmed">
                Potenziale (preventivi)
              </Text>
              <Text fw={600} fz="lg" c="dimmed" className="tabular">
                € {centsToEurStr(totali.potenziale)}
              </Text>
            </Box>
          </Group>
        </Group>
      </Card>

      <Box style={{ flex: 1, minHeight: 0 }}>{tabellaCrediti}</Box>

      <PagamentoModal
        target={target}
        onClose={() => setTarget(null)}
        onChanged={() => {
          setTarget(null);
          carica();
        }}
      />

      <RimborsoModal
        target={rimborsoExtra}
        onClose={() => setRimborsoExtra(null)}
        onChanged={() => {
          setRimborsoExtra(null);
          caricaRiferimenti();
        }}
      />
    </VistaTabellaParallela>
  );
}
