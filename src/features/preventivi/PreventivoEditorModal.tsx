import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconFileInvoice,
  IconPencil,
  IconSend,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { setConToggle } from "../../lib/set";
import {
  api,
  type Preventivo,
  type PreventivoRigaSalvaInput,
  type Pagamento,
  type RecordDto,
} from "../../lib/tauri";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import { ProdottiOrdinePanel } from "../giornaliero/ProdottiOrdinePanel";
import {
  azzeraRigaForm,
  mergeRigheOrdineRealtime,
  totaleRigheForm,
} from "../giornaliero/righeOrdine";
import { SelettoreCategoriaNuovoOrdine } from "../giornaliero/categoriaOrdine";
import {
  suggerimentiDiagnostica,
  suggerimentiProduzione,
} from "../produzione/datiProduzione";
import { StatoInvioPreventivoBadge } from "../giornaliero/colonne";
import { mergeRealtimeSelettivo } from "../../lib/mergeRealtime";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import {
  RateizzaModal,
  type RateizzaTarget,
} from "../contabilita/RateizzaModal";
import {
  PagamentoModal,
  type PagamentoModalTarget,
} from "../contabilita/PagamentoModal";
import {
  PagamentoScadenzarioPanel,
  type RigaScadenzarioEditor,
} from "../giornaliero/PagamentoScadenzarioPanel";
import {
  confrontaPagamentiAperti,
  confrontaRigheScadenzario,
  pagamentoApertoDaSaldare,
  pagamentoApertoSaldoRata,
  pagamentoPreviewLocale,
  proponiPagamentoAggiuntivo,
} from "../giornaliero/ordineScadenzario";
import { importoCoperto } from "../contabilita/coperturaScadenzario";
import { riallineaVociAperteLocali } from "../contabilita/riallineaSaldo";
import { risolviContoPreferito } from "../contabilita/contoPreferito";
import {
  aggiungiGiorniRate,
  calcolaRate,
  dataLocaleOggi,
  numeroRateSaldoPredefinito,
  offsetSpedizione,
} from "../contabilita/rateizzazione";
import { AnagraficaEditorModal } from "../anagrafiche/AnagraficaEditorModal";
import { REGISTRO_CLIENTE } from "../anagrafiche/registri";
import {
  accontoSuggeritoOrdine,
  preferenzeAccontoProdottiDaRecord,
} from "../giornaliero/preferenzeEconomicheOrdine";
import { oggiIso } from "../../lib/date";
import { preventivoDaBozza, type BozzaPreventivoDaZero } from "./bozzaPreventivo";
import {
  applicaPatchPagamentoVirtuale,
  campiContoPagamentoVirtuale,
  giorniTraScadenze,
  rigaVuotaPreventivo as rigaVuota,
  righeDaPreventivo,
  snapshotPreventivoEditor as snapshot,
  testataDaPreventivo,
  type PatchPagamentoVirtuale,
  type RigaDraftPreventivo as RigaDraft,
  type TestataDraftPreventivo as TestataDraft,
} from "./preventivoEditorModel";
import { avviaInvioRapidoPreventivo } from "./invioRapidoPreventivo";

const EVENTI_PREVENTIVO_APERTO = [
  "preventivo:salvato",
  "ordine:salvato",
  "riga_ordine:salvato",
  "pagamento:salvato",
] as const;
const EVENTI_RIFERIMENTI_PREVENTIVO = [
  "cliente:salvato",
  "medico:salvato",
  "agente:salvato",
  "prodotto:salvato",
  "prodotto_produzione:salvato",
  "conto:salvato",
] as const;
interface PianoRateVirtuale {
  modalita: "sostituisci" | "aggiungi";
  righe: Pagamento[];
}

export function PreventivoEditorModal({
  ordineId,
  numero,
  bozzaIniziale,
  opened,
  onClose,
  onSaved,
  dentroFinestra = false,
}: {
  ordineId: string | null;
  numero?: string;
  bozzaIniziale?: BozzaPreventivoDaZero | null;
  opened: boolean;
  onClose: () => void;
  onSaved: (preventivo: Preventivo) => void;
  /** Nella Webview dedicata usa lo stesso layout a pagina dell'editor Giornaliero. */
  dentroFinestra?: boolean;
}) {
  const [preventivo, setPreventivo] = useState<Preventivo | null>(null);
  const [prodotti, setProdotti] = useState<RecordDto[]>([]);
  const [medici, setMedici] = useState<RecordDto[]>([]);
  const [agenti, setAgenti] = useState<RecordDto[]>([]);
  const [catalogoProduzione, setCatalogoProduzione] = useState<RecordDto[]>([]);
  const [storicoRighe, setStoricoRighe] = useState<RecordDto[]>([]);
  const [conti, setConti] = useState<RecordDto[]>([]);
  const [righe, setRighe] = useState<RigaDraft[]>([]);
  const [validita, setValidita] = useState(30);
  const [condizioni, setCondizioni] = useState("");
  const [introduzione, setIntroduzione] = useState("");
  const [note, setNote] = useState("");
  const [scontoPercentuale, setScontoPercentuale] = useState(0);
  const [acconto, setAcconto] = useState(0);
  const [linea, setLinea] = useState("Immunoterapia");
  const [baseline, setBaseline] = useState("");
  const [caricamento, setCaricamento] = useState(false);
  const [azioneSalvataggio, setAzioneSalvataggio] = useState<
    "visualizza" | "invia" | null
  >(null);
  const salvando = azioneSalvataggio !== null;
  const [datiProduzioneAperti, setDatiProduzioneAperti] = useState<Set<string>>(
    new Set(),
  );
  const [pagamenti, setPagamenti] = useState<Pagamento[]>([]);
  const [patchPagamentiVirtuali, setPatchPagamentiVirtuali] = useState<
    Record<string, PatchPagamentoVirtuale>
  >({});
  const [pianoRateVirtuale, setPianoRateVirtuale] =
    useState<PianoRateVirtuale | null>(null);
  const [pagamentiVirtualiAggiunti, setPagamentiVirtualiAggiunti] = useState<
    Pagamento[]
  >([]);
  const [pagamentoTarget, setPagamentoTarget] =
    useState<PagamentoModalTarget | null>(null);
  const [rateizzaTarget, setRateizzaTarget] = useState<RateizzaTarget | null>(null);
  const [clienteDaModificare, setClienteDaModificare] =
    useState<RecordDto | null>(null);
  const [caricandoCliente, setCaricandoCliente] = useState(false);
  const prodottiRef = useRef<HTMLDivElement>(null);
  const pagamentiRef = useRef<HTMLDivElement>(null);
  const baselineTestataRef = useRef<TestataDraft | null>(null);
  const baselineRigheRef = useRef<RigaDraft[]>([]);
  const richiestePrezzoRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!opened || (!ordineId && !bozzaIniziale)) return;
    let attivo = true;
    setCaricamento(true);
    setPatchPagamentiVirtuali({});
    setPianoRateVirtuale(null);
    setPagamentiVirtualiAggiunti([]);
    setCatalogoProduzione([]);
    setStoricoRighe([]);

    // Catalogo di dettaglio e storico prezzi sono utili durante la compilazione,
    // ma non devono tenere il form dietro al loader iniziale.
    void Promise.all([
      api.recordsList("prodotto_produzione").catch(() => []),
      api.recordsList("riga_ordine").catch(() => []),
    ]).then(([produzione, righeStoriche]) => {
      if (!attivo) return;
      setCatalogoProduzione(produzione);
      setStoricoRighe(righeStoriche);
    });

    Promise.all([
      ordineId ? api.preventivoGet(ordineId) : Promise.resolve(null),
      api.recordsList("prodotto"),
      api.recordsList("medico"),
      api.recordsList("agente"),
      api.recordsList("conto"),
      ordineId ? api.pagamentiOrdine(ordineId) : Promise.resolve([]),
      api.recordGet("parametri_globali", "prodotti").catch(() => null),
      bozzaIniziale ? api.recordsList("cliente") : Promise.resolve([]),
      bozzaIniziale
        ? api.configurazioneDocumentiGet()
        : Promise.resolve(null),
    ])
      .then(([
        documentoCaricato,
        catalogo,
        mediciCaricati,
        agentiCaricati,
        contiCaricati,
        pagamentiCaricati,
        parametriProdotti,
        clientiCaricati,
        configurazione,
      ]) => {
        if (!attivo) return;
        const documento =
          documentoCaricato ??
          (bozzaIniziale && configurazione
            ? preventivoDaBozza(
                bozzaIniziale,
                configurazione,
                clientiCaricati,
                mediciCaricati,
                agentiCaricati,
              )
            : null);
        if (!documento) {
          throw new Error("bozza del preventivo non disponibile");
        }
        const righeIniziali = bozzaIniziale
          ? bozzaIniziale.righe.map((riga) => ({
              ...riga,
              allergeni: [...riga.allergeni],
            }))
          : righeDaPreventivo(documento);
        const medico = mediciCaricati.find(
          (record) => record.id === documento.medicoId,
        );
        const agente = agentiCaricati.find(
          (record) => record.id === documento.agenteId,
        );
        const accontoIniziale =
          !documento.esiste &&
          documento.acconto === 0 &&
          pagamentiCaricati.length === 0
            ? (accontoSuggeritoOrdine({
                categoria: documento.linee[0] || "Immunoterapia",
                totale: documento.totale,
                righe: documento.righe.map((riga) => ({
                  qta: riga.qta,
                  prezzo: riga.prezzo,
                  compilata: Boolean(
                    riga.prodottoId || riga.prodottoNome.trim(),
                  ),
                })),
                medico,
                agente,
                preferenze:
                  preferenzeAccontoProdottiDaRecord(parametriProdotti),
              }) ?? 0)
            : documento.acconto;
        const lineaIniziale = documento.linee[0] || "Immunoterapia";
        const usaPreferenzeAnagrafiche = lineaIniziale !== "Keriba";
        const contoSaldoId = risolviContoPreferito({
          conti: contiCaricati,
          medico: usaPreferenzeAnagrafiche ? medico : null,
          agente: usaPreferenzeAnagrafiche ? agente : null,
          tipo: "saldo",
        });
        const contoSaldo = contiCaricati.find(
          (record) => record.id === contoSaldoId,
        );
        const numeroRate = numeroRateSaldoPredefinito(
          lineaIniziale,
          medico?.data.rate_saldo_default,
        );
        const saldoIniziale = Math.max(
          0,
          documento.totale - accontoIniziale,
        );
        if (
          !documento.esiste &&
          pagamentiCaricati.length === 0 &&
          numeroRate > 1 &&
          saldoIniziale > 0
        ) {
          const inizio = aggiungiGiorniRate(
            dataLocaleOggi(),
            offsetSpedizione(String(contoSaldo?.data.tipo ?? "")),
          );
          const timestamp = Date.now();
          setPianoRateVirtuale({
            modalita: "sostituisci",
            righe: calcolaRate(saldoIniziale, numeroRate, inizio).map(
              (rata, indice) => ({
                id: `__local_pagamento__preventivo-default-${timestamp}-${indice}`,
                ordineId: documento.ordineId,
                tipo: "rata",
                importo: rata.importo,
                saldato: false,
                scadenza: rata.scadenza,
                contoId: contoSaldoId,
                contoNome: String(contoSaldo?.data.nome ?? ""),
                contoTipo: String(contoSaldo?.data.tipo ?? ""),
                contoIban: String(contoSaldo?.data.iban ?? ""),
                data: "",
                verificato: false,
                distintaId: "",
                contoAccreditoNome: "",
                note: "",
                scadDaSpedizione: true,
                scadRelGiorni:
                  indice === 0 ? 0 : giorniTraScadenze(inizio, rata.scadenza),
              }),
            ),
          });
        }
        setPreventivo(documento);
        setProdotti(catalogo);
        setMedici(mediciCaricati);
        setAgenti(agentiCaricati);
        setConti(contiCaricati);
        setPagamenti(pagamentiCaricati);
        setRighe(righeIniziali);
        setValidita(documento.validitaGiorni);
        setCondizioni(documento.condizioniPagamento);
        setIntroduzione(documento.introduzione);
        setNote(documento.note);
        setScontoPercentuale(documento.scontoPercentuale);
        setAcconto(accontoIniziale);
        setLinea(lineaIniziale);
        setDatiProduzioneAperti(
          new Set(
            righeIniziali
              .filter(
                (riga) =>
                  riga.formulazione ||
                  riga.posologia ||
                  riga.numero ||
                  riga.allergeni.length > 0,
              )
              .map((riga) => riga.key),
          ),
        );
        setBaseline(
          snapshot(
            documento,
            righeIniziali,
            documento.validitaGiorni,
            documento.condizioniPagamento,
            documento.introduzione,
            documento.note,
            documento.scontoPercentuale,
            accontoIniziale,
            lineaIniziale,
          ),
        );
        baselineTestataRef.current = {
          ...testataDaPreventivo(documento),
          acconto: accontoIniziale,
        };
        baselineRigheRef.current = righeIniziali;
      })
      .catch((error) => {
        if (attivo) toast.error(`Caricamento preventivo non riuscito: ${error}`);
      })
      .finally(() => {
        if (attivo) setCaricamento(false);
      });
    return () => {
      attivo = false;
    };
  }, [bozzaIniziale, opened, ordineId]);

  const totale = useMemo(() => totaleRigheForm(righe), [righe]);
  const totalePersistito = useMemo(
    () =>
      preventivo?.righe.reduce(
        (somma, riga) => somma + riga.qta * riga.prezzo,
        0,
      ) ?? 0,
    [preventivo],
  );
  const righeCompilate = useMemo(
    () =>
      righe.some(
        (riga) =>
          Boolean(riga.prodottoId) ||
          riga.prodottoNome.trim() !== "" ||
          Number(riga.prezzo || 0) > 0 ||
          Number(riga.qta || 1) !== 1 ||
          riga.paziente.trim() !== "" ||
          riga.tipoTest.trim() !== "" ||
          riga.ml.trim() !== "" ||
          riga.codice.trim() !== "" ||
          riga.formulazione.trim() !== "" ||
          riga.posologia.trim() !== "" ||
          riga.numero.trim() !== "" ||
          riga.allergeni.length > 0,
      ),
    [righe],
  );
  const totalePrimaSconto =
    scontoPercentuale > 0
      ? Math.round(totale / (1 - scontoPercentuale / 100))
      : totale;
  const dirty =
    !!preventivo &&
    (bozzaIniziale !== null && bozzaIniziale !== undefined
      ? true
      :
      snapshot(
        preventivo,
        righe,
        validita,
        condizioni,
        introduzione,
        note,
        scontoPercentuale,
        acconto,
        linea,
      ) !== baseline ||
      Object.keys(patchPagamentiVirtuali).length > 0 ||
      pianoRateVirtuale !== null ||
      pagamentiVirtualiAggiunti.length > 0);

  async function ricaricaPreventivoAperto() {
    if (!opened || !ordineId || salvando || caricamento) return;
    const baseTestata = baselineTestataRef.current;
    if (!baseTestata) return;
    try {
      const [remoto, pagamentiRemoti] = await Promise.all([
        api.preventivoGet(ordineId),
        api.pagamentiOrdine(ordineId),
      ]);
      setPagamenti(pagamentiRemoti);
      if (preventivo?.esiste && !remoto.esiste) {
        toast.warning(
          "Il preventivo è stato spostato nel Cestino da un’altra postazione.",
        );
        onClose();
        return;
      }
      if (
        preventivo?.revision === remoto.revision &&
        preventivo?.ordineRevision === remoto.ordineRevision &&
        preventivo?.fingerprintCorrente === remoto.fingerprintCorrente &&
        baselineRigheRef.current.every(
          (riga, indice) => riga.revision === remoto.righe[indice]?.revision,
        ) &&
        baselineRigheRef.current.length === remoto.righe.length
      ) {
        return;
      }
      const righeRemote = righeDaPreventivo(remoto);
      const testataRemota = testataDaPreventivo(remoto);
      const testataLocale: TestataDraft = {
        validita,
        condizioni,
        introduzione,
        note,
        scontoPercentuale,
        acconto,
        linea,
      };
      const mergeTestata = mergeRealtimeSelettivo(
        baseTestata,
        testataLocale,
        testataRemota,
      );
      const mergeRighe = mergeRigheOrdineRealtime(
        baselineRigheRef.current,
        righe,
        righeRemote,
      );
      const righeUnite = mergeRighe.righe as RigaDraft[];

      setPreventivo(remoto);
      setValidita(mergeTestata.valori.validita);
      setCondizioni(mergeTestata.valori.condizioni);
      setIntroduzione(mergeTestata.valori.introduzione);
      setNote(mergeTestata.valori.note);
      setScontoPercentuale(mergeTestata.valori.scontoPercentuale);
      setAcconto(mergeTestata.valori.acconto);
      setLinea(mergeTestata.valori.linea);
      setRighe(righeUnite);
      baselineTestataRef.current = testataRemota;
      baselineRigheRef.current = righeRemote;
      setBaseline(
        snapshot(
          remoto,
          righeRemote,
          testataRemota.validita,
          testataRemota.condizioni,
          testataRemota.introduzione,
          testataRemota.note,
          testataRemota.scontoPercentuale,
          testataRemota.acconto,
          testataRemota.linea,
        ),
      );
      if (mergeTestata.aggiornati.length > 0 || mergeRighe.aggiornate.length > 0) {
        toast.info("Preventivo aggiornato con le modifiche arrivate da un’altra postazione.");
      }
    } catch (error) {
      if (String(error).toLocaleLowerCase("it").includes("ordine non disponibile")) {
        toast.warning(
          "L’ordine collegato non è più disponibile: l’editor verrà chiuso.",
        );
        onClose();
      }
      // Un salvataggio concorrente resta comunque protetto dalle revisioni atomiche.
    }
  }

  useRicaricaSuEventi(EVENTI_PREVENTIVO_APERTO, ricaricaPreventivoAperto, 100);
  useRicaricaSuEventi(EVENTI_RIFERIMENTI_PREVENTIVO, async () => {
    if (!opened || salvando || caricamento) return;
    const [catalogo, mediciAggiornati, agentiAggiornati, contiAggiornati, produzione] =
      await Promise.all([
        api.recordsList("prodotto"),
        api.recordsList("medico"),
        api.recordsList("agente"),
        api.recordsList("conto"),
        api.recordsList("prodotto_produzione").catch(() => []),
      ]);
    setProdotti(catalogo);
    setMedici(mediciAggiornati);
    setAgenti(agentiAggiornati);
    setConti(contiAggiornati);
    setCatalogoProduzione(produzione);
    await ricaricaPreventivoAperto();
  }, 100);

  const opzioniProdotti = useMemo(
    () =>
      prodotti
        .filter((record) => String(record.data.categoria ?? "") === linea)
        .map((record) => ({
          value: record.id,
          label: String(record.data.nome ?? "(senza nome)"),
          categoria: String(record.data.categoria ?? ""),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" })),
    [linea, prodotti],
  );
  const prodottiById = useMemo(
    () => new Map(prodotti.map((record) => [record.id, record])),
    [prodotti],
  );
  const nomiProdotti = useMemo(
    () => opzioniProdotti.map((prodotto) => prodotto.label),
    [opzioniProdotti],
  );
  const diagnostica = linea === "Diagnostica";
  const immunoterapia = linea === "Immunoterapia";
  const contiById = useMemo(
    () => new Map(conti.map((conto) => [conto.id, conto])),
    [conti],
  );
  const optionsConti = useMemo(
    () =>
      conti.map((conto) => ({
        value: conto.id,
        label: String(conto.data.nome || "(conto)"),
      })),
    [conti],
  );
  const pagamentiPreview = useMemo(() => {
    let prossimi = pagamenti
      .filter(
        (pagamento) =>
          pianoRateVirtuale?.modalita !== "sostituisci" ||
          !pagamentoApertoSaldoRata(pagamento),
      )
      .map((pagamento) => ({ ...pagamento }));
    prossimi.push(
      ...pagamentiVirtualiAggiunti.map((pagamento) => ({ ...pagamento })),
    );
    if (pianoRateVirtuale) {
      prossimi.push(
        ...pianoRateVirtuale.righe.map((pagamento) => ({ ...pagamento })),
      );
    }
    const haAccontoSaldato = prossimi.some(
      (pagamento) => pagamento.tipo === "acconto" && pagamento.saldato,
    );
    if (!haAccontoSaldato) {
      const indiceAcconto = prossimi.findIndex(
        (pagamento) => pagamento.tipo === "acconto" && !pagamento.saldato,
      );
      if (indiceAcconto >= 0) {
        if (acconto > 0) {
          prossimi[indiceAcconto] = {
            ...prossimi[indiceAcconto],
            importo: acconto,
          };
        } else {
          prossimi.splice(indiceAcconto, 1);
        }
      }
    }
    if (
      totale !== totalePersistito ||
      acconto !== (preventivo?.acconto ?? acconto) ||
      pianoRateVirtuale !== null
    ) {
      prossimi = riallineaVociAperteLocali(prossimi, totale);
    }

    const creaAnteprima = (
      tipo: "acconto" | "saldo",
      importo: number,
    ): Pagamento => {
      const id = `__preview_scadenzario__${tipo}`;
      const patch = patchPagamentiVirtuali[id];
      const esistente = prossimi.find(
        (pagamento) => pagamento.tipo === tipo,
      );
      const usaPreferenzeAnagrafiche = linea !== "Keriba";
      const contoPreferitoId = risolviContoPreferito({
        conti,
        medico: usaPreferenzeAnagrafiche
          ? medici.find((record) => record.id === preventivo?.medicoId)
          : null,
        agente: usaPreferenzeAnagrafiche
          ? agenti.find((record) => record.id === preventivo?.agenteId)
          : null,
        tipo,
      });
      const conto =
        (patch?.contoId && contiById.get(patch.contoId)) ||
        (esistente?.contoId && contiById.get(esistente.contoId)) ||
        contiById.get(contoPreferitoId) ||
        conti[0];
      return {
        id,
        ordineId: preventivo?.ordineId || ordineId || "",
        tipo,
        importo,
        saldato: false,
        scadenza:
          patch?.scadenza ??
          (tipo === "acconto" ? preventivo?.ordineData || "" : ""),
        ...campiContoPagamentoVirtuale(conto?.id || "", conto),
        scadDaSpedizione:
          patch?.scadDaSpedizione ?? (tipo === "saldo"),
        scadRelGiorni: 0,
      };
    };

    let coperto = importoCoperto(prossimi);
    const haAccontoAperto = prossimi.some(
      (pagamento) => pagamento.tipo === "acconto" && !pagamento.saldato,
    );
    if (!haAccontoSaldato && !haAccontoAperto && acconto > 0 && coperto < totale) {
      const importo = Math.min(acconto, totale - coperto);
      prossimi.push(creaAnteprima("acconto", importo));
      coperto += importo;
    }
    if (
      coperto < totale &&
      !prossimi.some((pagamento) => pagamentoApertoSaldoRata(pagamento))
    ) {
      prossimi.push(creaAnteprima("saldo", totale - coperto));
    }
    return prossimi;
  }, [
    acconto,
    agenti,
    conti,
    contiById,
    linea,
    medici,
    ordineId,
    pagamenti,
    pagamentiVirtualiAggiunti,
    patchPagamentiVirtuali,
    pianoRateVirtuale,
    preventivo,
    totale,
    totalePersistito,
  ]);
  const incassato = pagamentiPreview
    .filter((pagamento) => pagamento.saldato)
    .reduce((somma, pagamento) => somma + pagamento.importo, 0);
  const residuo = totale - incassato;
  const saldoAttesoCorrente = pagamentiPreview
    .filter(pagamentoApertoSaldoRata)
    .reduce((somma, pagamento) => somma + pagamento.importo, 0);
  const scopertoScadenzario = Math.max(
    0,
    totale - importoCoperto(pagamentiPreview),
  );
  const prossimaRataDaSaldare =
    [...pagamentiPreview]
      .filter(
        (pagamento) =>
          !pagamentoPreviewLocale(pagamento) &&
          pagamentoApertoDaSaldare(pagamento),
      )
      .sort(confrontaPagamentiAperti)[0] ?? null;
  const propostaPagamento = proponiPagamentoAggiuntivo({
    pagamentiPreview,
    residuo,
    accontoPrevisto: acconto,
    scopertoScadenzario,
  });
  const azioneAggiungiPagamento: PagamentoModalTarget | null = preventivo
    ? {
        nuovo: {
          ordineId: preventivo.ordineId,
          numero: preventivo.ordineNumero,
          tipo: propostaPagamento.tipo,
          importo: propostaPagamento.importo,
          saldato: residuo <= 0,
          rimandaRiallineamento: !preventivo.ordineId,
        },
      }
    : null;
  const righeScadenzario: RigaScadenzarioEditor[] = pagamentiPreview
    .map((pagamento) => ({
      key: pagamento.id,
      tipo: pagamento.tipo,
      importo: pagamento.importo,
      saldato: pagamento.saldato,
      scadenza: pagamento.scadenza,
      data: pagamento.data,
      verificato: pagamento.verificato,
      contoNome: pagamento.contoNome,
      contoId: pagamento.contoId,
      contoTipo: pagamento.contoTipo,
      scadDaSpedizione: pagamento.scadDaSpedizione,
      scadRelGiorni: pagamento.scadRelGiorni,
      bozza: pagamentoPreviewLocale(pagamento),
      pagamento: pagamentoPreviewLocale(pagamento) ? null : pagamento,
    }))
    .sort(confrontaRigheScadenzario);
  const suggerimentiDiag = useMemo(
    () => suggerimentiDiagnostica(storicoRighe),
    [storicoRighe],
  );
  const nomiAllergeni = useMemo(
    () => [...new Set([...nomiProdotti, ...suggerimentiDiag.allergeni])],
    [nomiProdotti, suggerimentiDiag.allergeni],
  );
  const suggerimentiProd = useMemo(
    () => suggerimentiProduzione(catalogoProduzione, storicoRighe),
    [catalogoProduzione, storicoRighe],
  );
  const prodottiDellaLineaByNome = useMemo(
    () =>
      new Map(
        prodotti
          .filter((record) => String(record.data.categoria ?? "") === linea)
          .map((record) => [
            String(record.data.nome ?? "").trim().toLocaleLowerCase("it"),
            record,
          ]),
      ),
    [linea, prodotti],
  );
  const prodottoDellaLinea = (nome: string) =>
    prodottiDellaLineaByNome.get(nome.trim().toLocaleLowerCase("it"));

  function patchRiga(key: string, patch: Partial<RigaDraft>) {
    setRighe((correnti) =>
      correnti.map((riga) => (riga.key === key ? { ...riga, ...patch } : riga)),
    );
  }

  function digitaProdotto(key: string, nome: string) {
    const record = prodottoDellaLinea(nome);
    const corrente = righe.find((riga) => riga.key === key);
    patchRiga(key, {
      prodottoNome: nome,
      prodottoId: record?.id ?? "",
    });
    if (record && (!corrente || Number(corrente.prezzo || 0) <= 0)) {
      void proponiPrezzoRiga(key, record.id, { soloSeVuoto: true });
    }
  }

  function segnaRichiestaPrezzo(key: string): number {
    const prossima = (richiestePrezzoRef.current.get(key) || 0) + 1;
    richiestePrezzoRef.current.set(key, prossima);
    return prossima;
  }

  async function prezzoAutomaticoCents(prodottoId: string): Promise<number | null> {
    if (!prodottoId || !preventivo) return null;
    const suggerito = await api.prezzoSuggerito(
      prodottoId,
      preventivo.medicoId || null,
    );
    if (linea === "Immunoterapia" && suggerito.fonte === "default") {
      const medico = medici.find((record) => record.id === preventivo.medicoId);
      const personale = Number(medico?.data.prezzo_immuno_default) || 0;
      if (personale > 0) return personale;
    }
    return suggerito.prezzo;
  }

  async function proponiPrezzoRiga(
    key: string,
    prodottoId: string,
    opzioni: { soloSeVuoto?: boolean; sovrascrivi?: boolean } = {},
  ) {
    const token = segnaRichiestaPrezzo(key);
    try {
      const prezzo = await prezzoAutomaticoCents(prodottoId);
      if (prezzo === null || richiestePrezzoRef.current.get(key) !== token) return;
      setRighe((correnti) =>
        correnti.map((riga) => {
          if (riga.key !== key || riga.prodottoId !== prodottoId) return riga;
          if (opzioni.soloSeVuoto && Number(riga.prezzo || 0) > 0) return riga;
          if (!opzioni.sovrascrivi && Number(riga.prezzo || 0) > 0) return riga;
          return { ...riga, prezzo: prezzo / 100 };
        }),
      );
    } catch {
      // Il prezzo manuale resta sempre disponibile.
    }
  }

  async function proponiPrezzoDopoCambio(
    key: string,
    vecchioProdottoId: string,
    nuovoProdottoId: string,
  ) {
    const token = segnaRichiestaPrezzo(key);
    try {
      const [vecchio, nuovo] = await Promise.all([
        prezzoAutomaticoCents(vecchioProdottoId),
        prezzoAutomaticoCents(nuovoProdottoId),
      ]);
      if (nuovo === null || richiestePrezzoRef.current.get(key) !== token) return;
      setRighe((correnti) =>
        correnti.map((riga) => {
          if (riga.key !== key || riga.prodottoId !== nuovoProdottoId) return riga;
          const attuale = Math.round(Number(riga.prezzo || 0) * 100);
          if (attuale > 0 && (vecchio === null || attuale !== vecchio)) return riga;
          return { ...riga, prezzo: nuovo / 100 };
        }),
      );
    } catch {
      // Il prezzo manuale resta sempre disponibile.
    }
  }

  function scegliProdotto(key: string, nome: string) {
    const record = prodottoDellaLinea(nome);
    const corrente = righe.find((riga) => riga.key === key);
    const cambiato = !!record && corrente?.prodottoId !== record.id;
    patchRiga(key, {
      prodottoNome: nome,
      prodottoId: record?.id ?? "",
      prezzo: corrente?.prezzo ?? "",
      codice:
        diagnostica && record
          ? corrente?.codice || String(record.data.codice_laboratorio ?? "")
          : corrente?.codice ?? "",
    });
    if (!record) return;
    if (!corrente || Number(corrente.prezzo || 0) <= 0) {
      void proponiPrezzoRiga(key, record.id, { sovrascrivi: true });
    } else if (cambiato && corrente.prodottoId) {
      void proponiPrezzoDopoCambio(key, corrente.prodottoId, record.id);
    }
  }

  function toggleDatiProduzione(key: string) {
    setDatiProduzioneAperti((correnti) => setConToggle(correnti, key));
  }

  function cambiaLinea(prossima: string) {
    if (prossima === linea) return;
    setLinea(prossima);
    setRighe([rigaVuota(prossima)]);
    setDatiProduzioneAperti(new Set());
  }

  async function ricaricaPagamenti() {
    if (!ordineId) return;
    try {
      setPagamenti(await api.pagamentiOrdine(ordineId));
    } catch (error) {
      toast.error(`Aggiornamento scadenziario non riuscito: ${error}`);
    }
  }

  function aggiornaPagamentoVirtuale(
    key: string,
    patch: PatchPagamentoVirtuale,
  ) {
    if (key.startsWith("__local_pagamento__")) {
      setPianoRateVirtuale((corrente) => {
        if (!corrente) return corrente;
        return {
          ...corrente,
          righe: corrente.righe.map((pagamento) =>
            applicaPatchPagamentoVirtuale(pagamento, key, patch, contiById)
          ),
        };
      });
      setPagamentiVirtualiAggiunti((correnti) =>
        correnti.map((pagamento) =>
          applicaPatchPagamentoVirtuale(pagamento, key, patch, contiById)
        ),
      );
      return;
    }
    if (!key.startsWith("__preview_scadenzario__")) return;
    setPatchPagamentiVirtuali((correnti) => ({
      ...correnti,
      [key]: { ...correnti[key], ...patch },
    }));
  }

  function apriRateizzazione(
    importo: number,
    modalita: NonNullable<RateizzaTarget["modalita"]> = "sostituisci",
  ) {
    if (!preventivo || importo <= 0) return;
    const piano = [...pagamentiPreview]
      .filter(pagamentoApertoSaldoRata)
      .sort(confrontaPagamentiAperti);
    setRateizzaTarget({
      ordineId: preventivo.ordineId,
      numero: preventivo.ordineNumero,
      modalita,
      importo,
      numeroRateIniziale:
        modalita === "sostituisci"
          ? piano.filter((pagamento) => pagamento.tipo === "rata").length ||
            undefined
          : undefined,
      accontoData:
        pagamentiPreview.find((pagamento) => pagamento.tipo === "acconto")
          ?.data ||
        preventivo.ordineData,
      contoTipo: piano[0]?.contoTipo || "",
      rimandaRiallineamento: true,
    });
  }

  function applicaRateizzazioneVirtuale(
    rate: Array<{ importo: number; scadenza: string }>,
    daSpedizione: boolean,
  ) {
    if (!preventivo || !rateizzaTarget) return;
    const modalita = rateizzaTarget.modalita ?? "sostituisci";
    const pianoCorrente = [...pagamentiPreview]
      .filter(pagamentoApertoSaldoRata)
      .sort(confrontaPagamentiAperti);
    const contoId = pianoCorrente[0]?.contoId || conti[0]?.id || "";
    const conto = contiById.get(contoId);
    const timestamp = Date.now();
    const nuoveRate: Pagamento[] = rate.map((rata, indice) => ({
      id: `__local_pagamento__preventivo-rata-${timestamp}-${indice}`,
      ordineId: preventivo.ordineId,
      tipo: "rata",
      importo: rata.importo,
      saldato: false,
      scadenza: rata.scadenza,
      ...campiContoPagamentoVirtuale(contoId, conto),
      scadDaSpedizione: daSpedizione,
      scadRelGiorni:
        indice === 0
          ? 0
          : giorniTraScadenze(rate[0]?.scadenza || rata.scadenza, rata.scadenza),
    }));
    setPianoRateVirtuale((corrente) => ({
      modalita:
        modalita === "sostituisci" || corrente?.modalita === "sostituisci"
          ? "sostituisci"
          : "aggiungi",
      righe:
        modalita === "aggiungi" && corrente
          ? [...corrente.righe, ...nuoveRate]
          : nuoveRate,
    }));
    setRateizzaTarget(null);
    toast.success(
      "Rate aggiornate nello scadenzario. Salva il preventivo per confermarle.",
    );
  }

  async function persistiScadenzarioVirtuale(ordineIdSalvato: string) {
    const piano = pianoRateVirtuale;
    if (
      !piano &&
      Object.keys(patchPagamentiVirtuali).length === 0 &&
      pagamentiVirtualiAggiunti.length === 0
    ) {
      return;
    }
    let pagamentiAggiornati = await api.pagamentiOrdine(ordineIdSalvato);

    for (const pagamento of pagamentiVirtualiAggiunti) {
      const creato = await api.pagamentoRegistra({
        ordineId: ordineIdSalvato,
        tipo: pagamento.tipo,
        importo: pagamento.importo,
        saldato: pagamento.saldato,
        scadenza: pagamento.scadenza,
        contoId: pagamento.contoId,
        data: pagamento.data,
        verificato: pagamento.verificato,
        note: pagamento.note || null,
      });
      if (
        !pagamento.saldato &&
        pagamento.scadDaSpedizione &&
        (pagamento.tipo === "saldo" || pagamento.tipo === "rata")
      ) {
        await api.recordUpdate("pagamento", creato.id, {
          scad_da_spedizione: true,
          scad_rel_giorni: pagamento.scadRelGiorni,
          scadenza: "",
        });
      }
    }
    if (pagamentiVirtualiAggiunti.length > 0) {
      pagamentiAggiornati =
        await api.pagamentiRiallineaAperti(ordineIdSalvato);
    }

    if (piano && piano.righe.length > 0) {
      const righePianoFinali = piano.righe.map(
        (virtuale) =>
          pagamentiPreview.find(
            (pagamento) => pagamento.id === virtuale.id,
          ) ?? virtuale,
      );
      if (piano.modalita === "aggiungi") {
        const apertiPrimaDelSalvataggio = pagamenti.filter(
          pagamentoApertoSaldoRata,
        );
        await Promise.all(
          apertiPrimaDelSalvataggio.map((precedente) => {
            const corrente = pagamentiAggiornati.find(
              (pagamento) => pagamento.id === precedente.id,
            );
            if (!corrente || corrente.importo === precedente.importo) {
              return Promise.resolve();
            }
            return api
              .recordUpdate("pagamento", corrente.id, {
                importo: precedente.importo,
              })
              .then(() => undefined);
          }),
        );
        pagamentiAggiornati = await api.pagamentiOrdine(ordineIdSalvato);
      }
      const idsPrima = new Set(
        pagamentiAggiornati.map((pagamento) => pagamento.id),
      );
      const rate = righePianoFinali.map((pagamento) => ({
        importo: pagamento.importo,
        scadenza: pagamento.scadenza,
      }));
      const tutteDaSpedizione = righePianoFinali.every(
        (pagamento) => pagamento.scadDaSpedizione,
      );
      if (piano.modalita === "aggiungi") {
        await api.pagamentiAggiungiRate(
          ordineIdSalvato,
          rate,
          tutteDaSpedizione,
        );
      } else {
        await api.pagamentiRateizza(
          ordineIdSalvato,
          rate,
          tutteDaSpedizione,
        );
      }
      pagamentiAggiornati = await api.pagamentiOrdine(ordineIdSalvato);
      const ratePersistite = pagamentiAggiornati
        .filter(
          (pagamento) =>
            pagamento.tipo === "rata" &&
            !pagamento.saldato &&
            (piano.modalita === "sostituisci" || !idsPrima.has(pagamento.id)),
        )
        .sort(confrontaPagamentiAperti);
      const rateVirtuali = [...righePianoFinali].sort(
        confrontaPagamentiAperti,
      );
      await Promise.all(
        rateVirtuali.map((virtuale, indice) => {
          const persistita = ratePersistite[indice];
          if (!persistita) return Promise.resolve();
          return api.recordUpdate("pagamento", persistita.id, {
            conto_id: virtuale.contoId,
            scadenza: virtuale.scadDaSpedizione ? "" : virtuale.scadenza,
            scad_da_spedizione: virtuale.scadDaSpedizione,
            scad_rel_giorni: virtuale.scadRelGiorni,
          }).then(() => undefined);
        }),
      );
      pagamentiAggiornati = await api.pagamentiOrdine(ordineIdSalvato);
    }

    const patchDaApplicare = Object.entries(patchPagamentiVirtuali);
    await Promise.all(
      patchDaApplicare.map(([key, patch]) => {
        const tipo = key.endsWith("__acconto") ? "acconto" : "saldo";
        const pagamento = pagamentiAggiornati.find(
          (corrente) => corrente.tipo === tipo && !corrente.saldato,
        );
        if (!pagamento) return Promise.resolve();
        const fields: Record<string, string | number | boolean> = {};
        if (patch.contoId) fields.conto_id = patch.contoId;
        if (patch.scadenza !== undefined) fields.scadenza = patch.scadenza;
        if (patch.scadDaSpedizione !== undefined) {
          fields.scad_da_spedizione = patch.scadDaSpedizione;
          fields.scad_rel_giorni = 0;
          if (patch.scadDaSpedizione) fields.scadenza = "";
        }
        if (Object.keys(fields).length === 0) return Promise.resolve();
        return api
          .recordUpdate("pagamento", pagamento.id, fields)
          .then(() => undefined);
      }),
    );
  }

  async function salva(inviaDopo = false) {
    if (!preventivo || salvando) return;
    const valide = righe.filter((riga) => riga.prodottoId || riga.prodottoNome.trim());
    if (valide.length === 0) {
      toast.warning("Inserisci almeno un prodotto.");
      return;
    }
    if (
      valide.some(
        (riga) =>
          riga.qta <= 0 ||
          riga.prezzo === "" ||
          Number(riga.prezzo) < 0,
      )
    ) {
      toast.warning("Controlla quantità e prezzi delle righe.");
      return;
    }
    if (
      valide.some((riga) => {
        if (!riga.prodottoId) return false;
        return String(prodottiById.get(riga.prodottoId)?.data.categoria ?? "") !== linea;
      })
    ) {
      toast.warning(`Tutti i prodotti devono appartenere alla linea ${linea}.`);
      return;
    }
    if (acconto < 0 || acconto > totale) {
      toast.warning("L’acconto deve essere compreso fra zero e il totale.");
      return;
    }
    setAzioneSalvataggio(inviaDopo ? "invia" : "visualizza");
    let ordineCreatoDaBozza: string | null = null;
    let preventivoPersistito = false;
    try {
      const materializzaBozza =
        !!bozzaIniziale && !preventivo.ordineId;
      const inputRighe: PreventivoRigaSalvaInput[] = valide.map((riga) => ({
        id: materializzaBozza ? undefined : riga.id,
        revision: materializzaBozza
          ? undefined
          : riga.revision || undefined,
        prodottoId: riga.prodottoId || undefined,
        prodottoNome: riga.prodottoId ? "" : riga.prodottoNome.trim(),
        qta: riga.qta,
        prezzo: Math.max(0, Math.round(Number(riga.prezzo || 0) * 100)),
        paziente: riga.paziente.trim(),
        tipoTest: riga.tipoTest.trim(),
        ml: riga.ml.trim(),
        codice: riga.codice.trim(),
        formulazione: riga.formulazione.trim(),
        posologia: riga.posologia.trim(),
        numero: riga.numero.trim(),
        allergeni: riga.allergeni.map((valore) => valore.trim()).filter(Boolean),
      }));
      let ordineIdSalvataggio = preventivo.ordineId;
      let ordineRevisionSalvataggio = preventivo.ordineRevision;
      if (materializzaBozza) {
        const ordine = await api.ordineSalvaBase({
          expectedRighe: [],
          fields: {
            data: preventivo.ordineData || oggiIso(),
            categoria: linea,
            medico_id: bozzaIniziale.medicoId,
            agente_id: bozzaIniziale.agenteId,
            cliente_id: bozzaIniziale.clienteId,
            stato: "Nuovo",
            marcatore: "",
            note: note.trim(),
            acconto,
            omaggio: false,
            provvisorio: !navigator.onLine,
          },
          // Le righe entrano insieme al preventivo nel batch successivo; fino
          // al click corrente non è esistito alcun ordine nel Giornaliero.
          righe: [],
        });
        ordineCreatoDaBozza = ordine.id;
        ordineIdSalvataggio = ordine.id;
        ordineRevisionSalvataggio = ordine.ordine.revision;
      }
      const salvato = await api.preventivoSalva({
        ordineId: ordineIdSalvataggio,
        ordineRevision: ordineRevisionSalvataggio,
        preventivoRevision: materializzaBozza
          ? undefined
          : preventivo.revision || undefined,
        linea,
        validitaGiorni: validita,
        condizioniPagamento: condizioni.trim(),
        introduzione: introduzione.trim(),
        note: note.trim(),
        scontoPercentuale,
        acconto,
        righe: inputRighe,
      });
      preventivoPersistito = true;
      // Se un'operazione accessoria sullo scadenziario fallisse, un nuovo
      // tentativo riparte dal preventivo appena creato senza generare un altro ordine.
      setPreventivo(salvato);
      setRighe(righeDaPreventivo(salvato));
      await persistiScadenzarioVirtuale(salvato.ordineId);
      // Lo scadenziario può essere stato rateizzato o avere conti modificati:
      // l'anteprima riceve lo snapshot finale, non quello precedente alle rate.
      const finale = await api.preventivoGet(salvato.ordineId);
      const righeSalvate = righeDaPreventivo(finale);
      setPreventivo(finale);
      setRighe(righeSalvate);
      setLinea(finale.linee[0] || linea);
      setBaseline(
        snapshot(
          finale,
          righeSalvate,
          finale.validitaGiorni,
          finale.condizioniPagamento,
          finale.introduzione,
          finale.note,
          finale.scontoPercentuale,
          finale.acconto,
          finale.linee[0] || linea,
        ),
      );
      baselineTestataRef.current = testataDaPreventivo(finale);
      baselineRigheRef.current = righeSalvate;
      setPatchPagamentiVirtuali({});
      setPianoRateVirtuale(null);
      setPagamentiVirtualiAggiunti([]);
      toast.success(preventivo.esiste ? "Preventivo salvato." : "Preventivo creato.");
      if (dentroFinestra) {
        // Nella Webview dedicata l'editor resta visibile finché il documento è
        // pronto: il contenitore passa direttamente all'anteprima senza lasciare
        // per qualche istante una finestra bianca.
        onSaved(finale);
      } else {
        // Nella main rispetta la transizione della modale prima dell'anteprima.
        onClose();
        window.setTimeout(() => onSaved(finale), 190);
      }
      if (inviaDopo) void avviaInvioRapidoPreventivo(finale);
    } catch (error) {
      if (ordineCreatoDaBozza && !preventivoPersistito) {
        const preventivoEsiste = await api
          .preventivoGet(ordineCreatoDaBozza)
          .then((corrente) => corrente.esiste)
          .catch(() => false);
        if (!preventivoEsiste) {
          await api.recordPurge("ordine", ordineCreatoDaBozza).catch(() => {});
        }
      }
      toast.error(`Salvataggio preventivo non riuscito: ${error}`);
    } finally {
      setAzioneSalvataggio(null);
    }
  }

  async function richiediChiusura() {
    if (dirty) {
      const conferma = await dialog.confirm(
        "Uscire senza salvare?",
        bozzaIniziale && !preventivo?.ordineId
          ? "La bozza verrà scartata: nel Giornaliero non è stato ancora creato alcun ordine."
          : "Le modifiche al preventivo e all’ordine sorgente andranno perse.",
        { conferma: "Esci comunque", annulla: "Resta" },
      );
      if (!conferma) return;
    }
    onClose();
  }

  async function apriModificaCliente() {
    const clienteId = preventivo?.clienteId;
    if (!clienteId || caricandoCliente) return;
    setCaricandoCliente(true);
    try {
      const cliente = await api.recordGet("cliente", clienteId);
      if (!cliente || cliente.deleted) {
        toast.warning("Il cliente non è più disponibile.");
        return;
      }
      setClienteDaModificare(cliente);
    } catch (error) {
      toast.error(`Apertura cliente non riuscita: ${error}`);
    } finally {
      setCaricandoCliente(false);
    }
  }

  const modaleAnnidato =
    !!clienteDaModificare || !!pagamentoTarget || !!rateizzaTarget;

  const titoloEditor = (
    <Group gap="sm" wrap="nowrap">
      <ThemeIcon variant="light" color="yellow" radius="xl">
        <IconFileInvoice size={19} />
      </ThemeIcon>
      <Stack gap={0} miw={330} maw={420}>
        <Text fw={700} style={{ whiteSpace: "nowrap" }}>
          {preventivo
            ? preventivo.esiste
              ? "Preventivo"
              : "Nuovo preventivo"
            : ordineId
              ? "Preventivo"
              : "Nuovo preventivo"}{" "}
          {preventivo?.numeroPreventivo ?? numero ?? ""}
        </Text>
        {preventivo && (
          <Text size="xs" c="dimmed" truncate>
            {preventivo.ordineNumero
              ? `Ordine ${preventivo.ordineNumero} · `
              : ""}
            {preventivo.clienteNome || preventivo.medicoNome}
          </Text>
        )}
      </Stack>
    </Group>
  );

  const contenutoEditor = (
        <Box
          className="pt-modal-shell"
          style={
            dentroFinestra
              ? undefined
              : { minHeight: "min(760px, calc(100vh - 150px))" }
          }
        >
          <Box className="pt-modal-scroll">
            {caricamento || !preventivo ? (
              <Group justify="center" mih={360}>
                <Loader />
              </Group>
            ) : (
              <Stack gap="md" p="md">
                <Paper withBorder radius="md" p="md">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={3}>
                      <Text size="xs" c="dimmed" fw={700}>
                        DESTINATARIO
                      </Text>
                      <Group gap={6} wrap="nowrap">
                        <Text fw={700}>
                          {preventivo.clienteNome || preventivo.medicoNome || "—"}
                        </Text>
                        {preventivo.clienteId && (
                          <Tooltip label="Modifica dati cliente" withArrow>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="gray"
                              aria-label="Modifica dati anagrafici del cliente"
                              loading={caricandoCliente}
                              onClick={() => void apriModificaCliente()}
                            >
                              <IconPencil size={14} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                      <Text size="sm" c="dimmed">
                        {[preventivo.telefono, preventivo.email].filter(Boolean).join(" · ") || "Nessun recapito"}
                      </Text>
                    </Stack>
                    {!preventivo.esiste && (
                    <Box>
                      <SelettoreCategoriaNuovoOrdine
                        value={linea}
                        onChange={(value) => void cambiaLinea(value)}
                        haContenuto={righeCompilate}
                        tipo="preventivo"
                      />
                    </Box>
                    )}
                  </Group>
                </Paper>

                <SimpleGrid
                  cols={{ base: 1, sm: 3 }}
                  style={{ alignItems: "end" }}
                >
                  <NumberInput
                    label="Validità"
                    suffix=" giorni"
                    min={1}
                    max={365}
                    value={validita}
                    onChange={(value) => setValidita(Math.max(1, Number(value || 1)))}
                  />
                  <TextInput
                    label="Accordi aggiuntivi (facoltativi)"
                    value={condizioni}
                    onChange={(event) => setCondizioni(event.currentTarget.value)}
                    style={{ gridColumn: "span 2" }}
                  />
                </SimpleGrid>
                <Group justify="space-between" align="center" wrap="wrap">
                  <Stack gap={2}>
                    <Text size="sm" fw={600}>
                      Sconto commerciale
                    </Text>
                    <Text size="xs" c="dimmed">
                      Facoltativo: indicalo soltanto quando è realmente riconosciuto.
                    </Text>
                  </Stack>
                  <Group gap="xs" align="center" wrap="wrap">
                    <SegmentedControl
                      size="xs"
                      color="yellow"
                      value={
                        [0, 10, 25, 50, 75].includes(scontoPercentuale)
                          ? String(scontoPercentuale)
                          : ""
                      }
                      onChange={(value) => setScontoPercentuale(Number(value))}
                      data={[0, 10, 25, 50, 75].map((value) => ({
                        value: String(value),
                        label: `${value}%`,
                      }))}
                    />
                    <NumberInput
                      aria-label="Sconto personalizzato"
                      placeholder="Custom"
                      suffix="%"
                      min={0}
                      max={90}
                      allowDecimal={false}
                      clampBehavior="strict"
                      value={scontoPercentuale}
                      onChange={(value) =>
                        setScontoPercentuale(
                          Math.min(90, Math.max(0, Number(value || 0))),
                        )
                      }
                      hideControls
                      w={90}
                      size="xs"
                    />
                    <Paper
                      withBorder
                      radius="xl"
                      px="sm"
                      py={5}
                      bg="var(--mantine-color-yellow-light)"
                    >
                      <Group gap={7} wrap="nowrap">
                        {scontoPercentuale > 0 && (
                          <Text size="xs" c="dimmed" td="line-through">
                            {(totalePrimaSconto / 100).toLocaleString("it-IT", {
                              style: "currency",
                              currency: "EUR",
                            })}
                          </Text>
                        )}
                        <Text size="sm" fw={800}>
                          {(totale / 100).toLocaleString("it-IT", {
                            style: "currency",
                            currency: "EUR",
                          })}
                        </Text>
                        {scontoPercentuale > 0 && (
                          <Badge size="xs" color="yellow" variant="filled">
                            −{scontoPercentuale}%
                          </Badge>
                        )}
                      </Group>
                    </Paper>
                  </Group>
                </Group>
                <Textarea
                  label="Testo introduttivo"
                  minRows={2}
                  autosize
                  maxRows={3}
                  value={introduzione}
                  onChange={(event) => setIntroduzione(event.currentTarget.value)}
                />

                <ProdottiOrdinePanel
                  containerRef={prodottiRef}
                  righe={righe}
                  isAllergene={diagnostica}
                  isDiagnostica={diagnostica}
                  isImmunoterapia={immunoterapia}
                  evidenziato={false}
                  attentionStyle={{}}
                  nomiProdotti={nomiProdotti}
                  nomiAllergeni={nomiAllergeni}
                  tipiTest={suggerimentiDiag.tipiTest}
                  suggerimentiProduzione={suggerimentiProd}
                  datiProduzioneAperti={datiProduzioneAperti}
                  onDigitaProdotto={digitaProdotto}
                  onScegliProdotto={scegliProdotto}
                  onAggiornaRiga={patchRiga}
                  onToggleDatiProduzione={toggleDatiProduzione}
                  onRimuoviRiga={(key) => {
                    setDatiProduzioneAperti((correnti) => {
                      if (!correnti.has(key)) return correnti;
                      const prossimi = new Set(correnti);
                      prossimi.delete(key);
                      return prossimi;
                    });
                    setRighe((correnti) =>
                      correnti.length === 1
                        ? correnti.map((riga) =>
                            riga.key === key
                              ? azzeraRigaForm(riga, diagnostica)
                              : riga,
                          )
                        : correnti.filter((riga) => riga.key !== key),
                    );
                  }}
                  onAggiungiRiga={() =>
                    setRighe((correnti) => [...correnti, rigaVuota(linea)])
                  }
                />

                <Textarea
                  label="Note commerciali"
                  minRows={2}
                  autosize
                  maxRows={4}
                  value={note}
                  onChange={(event) => setNote(event.currentTarget.value)}
                />

                <PagamentoScadenzarioPanel
                  containerRef={pagamentiRef}
                  evidenziato={false}
                  ordineId={preventivo.ordineId}
                  categoria={linea}
                  codTutto={false}
                  acconto={acconto / 100}
                  accontoIncassato={false}
                  accontoData=""
                  totale={totale}
                  incassato={incassato}
                  residuo={residuo}
                  righe={righeScadenzario}
                  optionsConti={optionsConti}
                  importoRateizzabile={Math.max(0, saldoAttesoCorrente)}
                  saldoAttesoCorrente={saldoAttesoCorrente}
                  scopertoScadenzario={scopertoScadenzario}
                  prossimaRataDaSaldare={prossimaRataDaSaldare}
                  azioneAggiungiPagamento={azioneAggiungiPagamento}
                  rimborsoLabel={null}
                  onAccontoChange={(value) =>
                    setAcconto(
                      Math.max(0, Math.round(Number(value || 0) * 100)),
                    )
                  }
                  onAccontoFocus={() => {}}
                  onToggleCod={() => {}}
                  onAccontoIncassatoChange={() => {}}
                  onAccontoDataChange={() => {}}
                  onApriPagamento={setPagamentoTarget}
                  onAggiornaContoBozza={(key, contoId) =>
                    aggiornaPagamentoVirtuale(key, { contoId })
                  }
                  onAggiornaScadenzaBozza={(key, scadenza) =>
                    aggiornaPagamentoVirtuale(key, { scadenza })
                  }
                  onAggiornaScadDaSpedizioneBozza={(key, scadDaSpedizione) =>
                    aggiornaPagamentoVirtuale(key, { scadDaSpedizione })
                  }
                  onApriRateizzazione={apriRateizzazione}
                  onApriRimborso={() => {}}
                />
              </Stack>
            )}
          </Box>
          <div
            className="pt-modal-footer"
            style={{
              justifyContent: preventivo?.esiste ? "space-between" : "flex-end",
            }}
          >
            {preventivo?.esiste && (
              <StatoInvioPreventivoBadge
                stato={preventivo.indicazioneInvio}
              />
            )}
            <div className="pt-modal-actions">
              <Button variant="default" onClick={() => void richiediChiusura()} disabled={salvando}>
                Chiudi
              </Button>
              {preventivo && (
                <>
                  <Button
                    variant="default"
                    onClick={() => void salva()}
                    loading={azioneSalvataggio === "visualizza"}
                    disabled={salvando}
                  >
                    Salva e visualizza
                  </Button>
                  <Button
                    color="accent"
                    leftSection={<IconSend size={16} />}
                    onClick={() => void salva(true)}
                    loading={azioneSalvataggio === "invia"}
                    disabled={salvando}
                  >
                    Salva e invia
                  </Button>
                </>
              )}
            </div>
          </div>
        </Box>
  );

  const presentazioneEditor = dentroFinestra ? (
    opened ? (
      <Box
        p="lg"
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        <Box mb="md" style={{ flex: "0 0 auto" }}>
          {titoloEditor}
        </Box>
        <Box className="pt-window-form">{contenutoEditor}</Box>
      </Box>
    ) : null
  ) : (
    <Modal
      opened={opened}
      onClose={() => void richiediChiusura()}
      size="min(1280px, calc(100vw - 48px))"
      closeOnEscape={!modaleAnnidato}
      closeOnClickOutside={!modaleAnnidato}
      transitionProps={{ transition: "fade", duration: 200 }}
      title={titoloEditor}
    >
      {contenutoEditor}
    </Modal>
  );

  return (
    <>
      {presentazioneEditor}
      <RateizzaModal
        target={rateizzaTarget}
        onClose={() => setRateizzaTarget(null)}
        onSaved={() => {
          setRateizzaTarget(null);
          void ricaricaPagamenti();
        }}
        onLocalSave={applicaRateizzazioneVirtuale}
      />
      <PagamentoModal
        target={pagamentoTarget}
        onClose={() => setPagamentoTarget(null)}
        onChanged={() => {
          setPagamentoTarget(null);
          void ricaricaPagamenti();
        }}
        onLocalSave={(pagamento) => {
          setPagamentiVirtualiAggiunti((correnti) => [
            ...correnti,
            pagamento,
          ]);
          setPagamentoTarget(null);
        }}
      />
      <AnagraficaEditorModal
        opened={!!clienteDaModificare}
        registro={REGISTRO_CLIENTE}
        record={clienteDaModificare}
        onClose={() => setClienteDaModificare(null)}
        onSaved={() => {
          setClienteDaModificare(null);
          if (!ordineId) return;
          void api
            .preventivoGet(ordineId)
            .then(setPreventivo)
            .catch((error) =>
              toast.error(`Aggiornamento destinatario non riuscito: ${error}`),
            );
        }}
        onInvalidated={() => setClienteDaModificare(null)}
      />
    </>
  );
}
