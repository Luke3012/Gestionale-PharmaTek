// Form ordine (testata + prodotti), riusabile in modale o in finestra separata.
// Layout a colonna unica e compatta: identità in alto, prodotti al centro,
// pagamento in fondo. L'acconto si auto-applica dalla preferenza del medico
// (per prodotto), resta editabile e non supera mai il totale.
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { setConToggle } from "../../lib/set";
import {
  Badge,
  Alert,
  Box,
  Button,
  Center,
  Checkbox,
  Collapse,
  Group,
  Input,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBell,
  IconChevronDown,
  IconChevronRight,
  IconArrowLeft,
  IconEdit,
  IconFileInvoice,
  IconPrinter,
  IconSend,
} from "@tabler/icons-react";
import { api, inTauri, type Identity, type Pagamento, type Preventivo, type RataInput, type RecordDto, type Rimborso } from "../../lib/tauri";
import { oggiIso as oggi } from "../../lib/date";
import { toast } from "../../ui/toast/store";
import { dialog } from "../../ui/dialog/store";
import { validaCampi } from "../anagrafiche/registri";
import { categoriaDef } from "../anagrafiche/categorie";
import { salvaNuovoClienteConControllo } from "../anagrafiche/salvataggioCliente";
import { preparaCampiAnagraficaCompleti, valoriAnagrafica } from "../anagrafiche/modelloAnagrafica";
import { ultimoMedicoClienteValido } from "../anagrafiche/medicoCliente";
import { centsToEurStr, eurToCents } from "../../lib/money";
import { suggerimentiDiagnostica, suggerimentiProduzione, type Suggerimenti } from "../produzione/datiProduzione";
import { PipelineStato } from "./PipelineStato";
import { AnagraficaRapidaModal } from "./AnagraficaRapidaModal";
import { DatiFatturazionePanel, type DatiFatturazione } from "./DatiFatturazionePanel";
import { PagamentoScadenzarioPanel } from "./PagamentoScadenzarioPanel";
import { ProdottiOrdinePanel } from "./ProdottiOrdinePanel";
import {
  CLIENTE_REG,
  MEDICO_REG,
  campiOrdineRealtime,
  centsDi,
  opzioni,
  valoriClienteVuoti,
  valoriMedicoVuoti,
  type Bozza,
  type CampiOrdineRealtime,
} from "./ordineEditorModel";

import { MARCATORI } from "./marcatori";
import { riattivaNotifichePerUtenti, scarta } from "../notifiche/notifiche";
import { PagamentoModal, type PagamentoDraft, type PagamentoModalTarget } from "../contabilita/PagamentoModal";
import { RimborsoModal, type RimborsoModalTarget } from "../contabilita/RimborsoModal";
import {
  eccedenzaOrdineNonSalvata,
  riepilogaRimborsiExtraOrdine,
  rimborsoCopreEccedenzaScadenzario,
  statoRimborsoDef,
} from "../contabilita/statiRimborso";
import { RateizzaModal, type RateizzaTarget } from "../contabilita/RateizzaModal";
import {
  calcolaScadRelGiorni,
  useScadenzarioEditor,
} from "./useScadenzarioEditor";
import {
  aggiungiGiorniRate,
  calcolaRate,
  dataLocaleOggi,
  numeroRateSaldoPredefinito,
  offsetSpedizione,
} from "../contabilita/rateizzazione";
import {
  èContoTransito,
  risolviContoPreferito,
} from "../contabilita/contoPreferito";
import {
  accontoSuggeritoOrdine,
  PREFERENZE_ACCONTO_PRODOTTI_DEFAULT,
  preferenzeAccontoProdottiDaRecord,
} from "./preferenzeEconomicheOrdine";
import { riallineaPagamentiAperti, riallineaVociAperteLocali } from "../contabilita/riallineaSaldo";
import {
  chiediCoperturaScadenzario,
  deveMostrareAdeguamentoImporto,
  importoCoperto,
  ultimaRataAperta,
  type VoceCopertura,
} from "../contabilita/coperturaScadenzario";
import { BachecaPromemoria } from "../promemoria/BachecaPromemoria";
import { focusInvalidField } from "../../ui/focusInvalid";
import { mergeRealtimeSelettivo } from "../../lib/mergeRealtime";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import {
  azzeraPrezziRigheForm,
  azzeraRigaForm,
  adeguaRigheFormATotale,
  campiPersistenzaRigaForm,
  firmaRigheOrdineRealtime,
  mergeRigheOrdineRealtime,
  nuovaRiga,
  riduciRigheForm,
  righeOrdineDaRecord,
  totaleRigheForm,
  type RigaForm,
} from "./righeOrdine";
import { precompilaMantenimentoRiga } from "./mantenimentoOrdine";
import { applicaPrezzoAutomaticoRiga } from "./prezziOrdine";
import {
  CATEGORIA_DEFAULT,
  IconaCategoria,
  SelettoreCategoriaNuovoOrdine,
} from "./categoriaOrdine";
import { SelectConNuovo } from "./SelectConNuovo";
import {
  aggiungiGiorniScadenzario as aggiungiGiorni,
  confrontaPagamentiAperti,
  confrontaRigheScadenzario,
  firmaScadenzario,
  giorniTra,
  pagamentoApertoDaSaldare,
  pagamentoApertoSaldoRata,
  pagamentoPersistitoConImportoPreview,
  pagamentoPreviewLocale,
  proponiPagamentoAggiuntivo,
  selezionaProssimoPagamentoDaSaldare,
} from "./ordineScadenzario";
import { usePrefs } from "../../lib/prefs";
import { PreventivoEditorModal } from "../preventivi/PreventivoEditorModal";
import { DocumentoPreviewModal } from "../preventivi/DocumentoPreviewModal";
import {
  creaDocumentoPreventivo,
  type DocumentoA4,
} from "../preventivi/rendererDocumenti";
import { avviaInvioRapidoPreventivo } from "../preventivi/invioRapidoPreventivo";
import { PremiumAction } from "../../premium/PremiumAction";
import { confermaInvioManualeDopoEsportazione } from "../preventivi/invioManualePreventivo";
import { apriFinestraPreventivo } from "../preventivi/apriFinestraPreventivo";
import { useModalSnapshot } from "../../ui/useModalSnapshot";
import { OverlaySalvataggioFinestra } from "../../ui/OverlaySalvataggioFinestra";

export { CATEGORIA_DEFAULT, SelettoreCategoriaNuovoOrdine } from "./categoriaOrdine";

const SchedaClienteModalLazy = lazy(() =>
  import("../preventivi/SchedaClienteModal").then((m) => ({
    default: m.SchedaClienteModal,
  }))
);

export interface OrdineFormProps {
  ordineId: string | null;
  numero?: string;
  /** Categoria per i NUOVI ordini (scelta dal pulsante). Ignorata in modifica
   * (si legge dal record). Default Immunoterapia. */
  categoria?: string;
  /** Precompilazione (solo nuovi ordini): cliente o medico già selezionato (Riepilogo). */
  clientePre?: string;
  medicoPre?: string;
  identity: Identity;
  /** Focus iniziale per aperture contestuali da notifiche/ricerca/Produzione. */
  focus?: { sezione: "pagamenti" | "prodotti"; pagamentoId?: string };
  onClose: () => void;
  /** Chiamata dopo il salvataggio; riceve l'id dell'ordine (utile per nuovi ordini). */
  onSaved: (ordineId?: string) => void;
  /** Notifica al wrapper se una sotto-modale (nuovo cliente) è aperta. */
  onNested?: (open: boolean) => void;
  /** Riporta al wrapper la categoria effettiva (per il badge nel titolo, anche in modifica). */
  onCategoria?: (categoria: string) => void;
  /** Comunica se il form differisce dallo stato iniziale caricato. */
  onDirtyChange?: (dirty: boolean) => void;
  dentroFinestra?: boolean;
  /** Chiede al contenitore di chiudere prima l'ordine e poi aprire il preventivo. */
  onApriPreventivo?: (
    ordineId: string,
    vista: "editor" | "anteprima",
  ) => void;
}

/** Bersaglio dell'editor: nuovo ordine (con categoria) o modifica di uno esistente. */
export interface EditorTarget {
  ordineId: string | null;
  numero?: string;
  categoria?: string;
  /** Precompilazione del nuovo ordine aperto da un riepilogo soggetto. */
  clientePre?: string;
  medicoPre?: string;
  /** Nasconde il cambio linea per gli ingressi che creano un ordine già vincolato
   *  a una categoria precisa (al momento: Diagnostica dalla Produzione). */
  categoriaBloccata?: boolean;
  focus?: OrdineFormProps["focus"];
}

const EVENTI_ORDINE_APERTO = ["ordine:salvato", "pagamento:salvato"] as const;
const EVENTI_RIFERIMENTI_ORDINE = [
  "cliente:salvato",
  "medico:salvato",
  "agente:salvato",
  "prodotto:salvato",
  "conto:salvato",
] as const;
const CAMPI_PAGAMENTO_LOCALE = {
  data: "",
  verificato: false,
  distintaId: "",
  contoAccreditoNome: "",
  note: "",
} as const;

function richiesteRiferimentiOrdine() {
  return [
    api.recordsList("medico"),
    api.recordsList("cliente"),
    api.recordsList("prodotto"),
    api.recordsList("agente"),
    api.recordsList("conto"),
  ] as const;
}

function campiContoLocale(conti: RecordDto[], contoId: string) {
  const conto = conti.find((record) => record.id === contoId);
  return {
    contoId,
    contoNome: ((conto?.data.nome as string) || ""),
    contoTipo: ((conto?.data.tipo as string) || ""),
  };
}

/** Wrapper modale (nuovi ordini o fallback alla finestra). Resta montato così la
 * modale anima in entrata/uscita; il contenuto resta visibile durante l'uscita. */
export function OrdineEditor({
  editor,
  identity,
  onClose,
  onSaved,
}: {
  editor: EditorTarget | null;
  identity: Identity;
  onClose: () => void;
  onSaved: (ordineId?: string) => void;
}) {
  const [mostrato, clearMostrato] = useModalSnapshot(editor);
  const [nested, setNested] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preventivoEditorId, setPreventivoEditorId] = useState<string | null>(null);
  const [preventivoDocumento, setPreventivoDocumento] =
    useState<DocumentoA4 | null>(null);
  const [preventivoAnteprima, setPreventivoAnteprima] =
    useState<Preventivo | null>(null);
  const [ritornoAnteprima, setRitornoAnteprima] =
    useState<"ordine" | "preventivo" | null>(null);
  const [preventivoInApertura, setPreventivoInApertura] = useState(false);
  const [invioPreventivoInCorso, setInvioPreventivoInCorso] = useState(false);
  // Categoria mostrata nel titolo: per i nuovi ordini è nota subito (dal pulsante),
  // in modifica la riporta il form dopo aver caricato il record (fetch-then-render).
  const [catTitolo, setCatTitolo] = useState(
    editor?.ordineId === null ? editor.categoria || CATEGORIA_DEFAULT : editor?.categoria
  );
  useEffect(() => {
    if (editor) {
      setCatTitolo(editor.ordineId === null ? editor.categoria || CATEGORIA_DEFAULT : editor.categoria);
      setDirty(false);
    }
  }, [editor]);

  const richiediChiusura = useCallback(() => {
    onClose();
  }, [onClose]);

  const apriPreventivoDopoOrdine = useCallback(
    (ordineId: string, vista: "editor" | "anteprima") => {
      setPreventivoInApertura(true);
      window.setTimeout(() => {
        if (vista === "editor") {
          setPreventivoEditorId(ordineId);
          setPreventivoInApertura(false);
          return;
        }
        void Promise.all([
          api.preventivoGet(ordineId),
          api.configurazioneDocumentiGet(),
        ])
          .then(([preventivo, config]) => {
            setPreventivoAnteprima(preventivo);
            setPreventivoDocumento(creaDocumentoPreventivo(preventivo, config));
            setRitornoAnteprima("ordine");
            setPreventivoInApertura(false);
          })
          .catch((error) => {
            setPreventivoInApertura(false);
            toast.error(`Apertura preventivo non riuscita: ${error}`);
          });
      }, 210);
    },
    [],
  );

  return (
    <>
      <Modal
        keepMounted
        opened={
          !!editor &&
          !preventivoInApertura &&
          !preventivoEditorId &&
          !preventivoDocumento
        }
        onClose={richiediChiusura}
        size="min(1280px, calc(100vw - 48px))"
        closeOnEscape={!nested}
        closeOnClickOutside={!nested}
        transitionProps={{
          transition: "fade",
          duration: 200,
          onExited: () => {
            if (!editor) clearMostrato();
          },
        }}
        title={
          mostrato ? (
            <Box
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(180px, 1fr) auto",
                alignItems: "center",
                columnGap: 16,
                width: "100%",
              }}
            >
              <Group gap="sm" wrap="nowrap">
                {catTitolo && <IconaCategoria categoria={catTitolo} grande />}
                <Text fw={700} style={{ whiteSpace: "nowrap" }}>
                  {mostrato.ordineId ? `Ordine ${mostrato.numero ?? ""}` : "Nuovo ordine"}
                </Text>
              </Group>
              <Group gap="xs" justify="flex-end" wrap="nowrap">
                {!mostrato.ordineId && !mostrato.categoriaBloccata && (
                  <SelettoreCategoriaNuovoOrdine
                    value={catTitolo || CATEGORIA_DEFAULT}
                    onChange={setCatTitolo}
                    haContenuto={dirty}
                  />
                )}
                {mostrato.ordineId && catTitolo && (
                  <Badge color={categoriaDef(catTitolo).color} variant="light">
                    {catTitolo}
                  </Badge>
                )}
                {!navigator.onLine && !mostrato.ordineId && (
                  <Badge color="yellow" variant="light">
                    numero provvisorio
                  </Badge>
                )}
              </Group>
            </Box>
          ) : undefined
        }
      >
        {mostrato && (
          <OrdineForm
            key={mostrato.ordineId ?? "new"}
            ordineId={mostrato.ordineId}
            numero={mostrato.numero}
            categoria={mostrato.ordineId ? mostrato.categoria : catTitolo}
            clientePre={mostrato.clientePre}
            medicoPre={mostrato.medicoPre}
            focus={mostrato.focus}
            identity={identity}
            onClose={richiediChiusura}
            onSaved={onSaved}
            onNested={setNested}
            onCategoria={setCatTitolo}
            onDirtyChange={setDirty}
            onApriPreventivo={apriPreventivoDopoOrdine}
          />
        )}
      </Modal>
      <PreventivoEditorModal
        ordineId={preventivoEditorId}
        opened={!!preventivoEditorId}
        onClose={() => {
          setPreventivoInApertura(true);
          setPreventivoEditorId(null);
          window.setTimeout(() => setPreventivoInApertura(false), 210);
        }}
        onSaved={(preventivo) => {
          setPreventivoInApertura(true);
          setPreventivoEditorId(null);
          void api
            .configurazioneDocumentiGet()
            .then((config) => {
              setPreventivoAnteprima(preventivo);
              setPreventivoDocumento(creaDocumentoPreventivo(preventivo, config));
              setRitornoAnteprima("preventivo");
              setPreventivoInApertura(false);
            })
            .catch((error) => {
              setPreventivoInApertura(false);
              toast.error(`Generazione preventivo non riuscita: ${error}`);
            });
        }}
      />
      <DocumentoPreviewModal
        opened={!!preventivoDocumento}
        documento={preventivoDocumento}
        azioniPremium
        azioniAffollate={!!ritornoAnteprima}
        onFileEsportato={async () => {
          if (!preventivoAnteprima) return;
          const aggiornato = await confermaInvioManualeDopoEsportazione(
            preventivoAnteprima,
          );
          if (aggiornato) setPreventivoAnteprima(aggiornato);
        }}
        onClose={() => {
          setPreventivoInApertura(true);
          setPreventivoDocumento(null);
          setPreventivoAnteprima(null);
          setRitornoAnteprima(null);
          window.setTimeout(() => setPreventivoInApertura(false), 210);
        }}
        azioniExtra={
          preventivoAnteprima ? (
            <Group gap="sm">
              {ritornoAnteprima && (
                <Button
                  variant="default"
                  leftSection={
                    ritornoAnteprima === "ordine"
                      ? <IconArrowLeft size={16} />
                      : <IconEdit size={16} />
                  }
                  onClick={() => {
                    setPreventivoInApertura(true);
                    setPreventivoDocumento(null);
                    setRitornoAnteprima(null);
                    if (ritornoAnteprima === "preventivo") {
                      window.setTimeout(() => {
                        setPreventivoEditorId(preventivoAnteprima.ordineId);
                        setPreventivoInApertura(false);
                      }, 210);
                    } else {
                      setPreventivoAnteprima(null);
                      window.setTimeout(() => setPreventivoInApertura(false), 210);
                    }
                  }}
                >
                  {ritornoAnteprima === "ordine"
                    ? "Torna all’ordine"
                    : "Modifica preventivo"}
                </Button>
              )}
              <PremiumAction
                buttonVariant="default"
                leftSection={<IconSend size={16} />}
                title="Invia preventivo"
                message="Invia il preventivo direttamente al cliente via email o messaggio. Funzionalità disponibile con Premium."
                lockedPresentation="modal"
                loading={invioPreventivoInCorso}
                disabled={!!preventivoDocumento?.overflow.length}
                onAction={() => {
                  if (invioPreventivoInCorso) return;
                  setInvioPreventivoInCorso(true);
                  void avviaInvioRapidoPreventivo(preventivoAnteprima).finally(
                    () => setInvioPreventivoInCorso(false),
                  );
                }}
              >
                Invia preventivo
              </PremiumAction>
            </Group>
          ) : null
        }
      />
    </>
  );
}

/** Contenuto del form (senza chrome). */
export function OrdineForm({
  ordineId,
  numero,
  categoria: categoriaProp,
  clientePre,
  medicoPre,
  identity,
  focus,
  onClose,
  onSaved,
  onNested,
  onCategoria,
  onDirtyChange,
  dentroFinestra,
  onApriPreventivo,
}: OrdineFormProps) {
  const [caricamento, setCaricamento] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const pagamentiRef = useRef<HTMLDivElement>(null);
  const prodottiRef = useRef<HTMLDivElement>(null);
  const focusProdottiGestito = useRef(false);
  const richiestePrezzoRef = useRef(new Map<string, number>());
  const formModificatoRef = useRef(false);
  const riallineaFirmaDopoRealtimeRef = useRef(false);
  const [evidenziaPagamenti, setEvidenziaPagamenti] = useState(false);
  const [evidenziaProdotti, setEvidenziaProdotti] = useState(false);

  const [medici, setMedici] = useState<RecordDto[]>([]);
  const [clienti, setClienti] = useState<RecordDto[]>([]);
  const [prodotti, setProdotti] = useState<RecordDto[]>([]);
  const [agenti, setAgenti] = useState<RecordDto[]>([]);
  // Categoria/linea dell'ordine: dal pulsante (nuovo) o dal record (modifica).
  const [categoria, setCategoria] = useState(categoriaProp || CATEGORIA_DEFAULT);

  const [data, setData] = useState(oggi());
  const [medicoId, setMedicoId] = useState("");
  const [agenteId, setAgenteId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [stato, setStato] = useState("Nuovo");
  // Stato come salvato nel DB: se è "Rifiutato" lo stato è immutabile (FASE 5E).
  const [statoIniziale, setStatoIniziale] = useState("Nuovo");
  const [marcatore, setMarcatore] = useState("");
  const [marcatoreIniziale, setMarcatoreIniziale] = useState("");
  const [note, setNote] = useState("");
  const [acconto, setAcconto] = useState<number | "">("");
  const [accontoIniziale, setAccontoIniziale] = useState(0);
  const accontoTocco = useRef(false);
  const [righe, setRighe] = useState<RigaForm[]>([nuovaRiga()]);
  const prodottiPrecedentiRef = useRef(0);
  const prodottiCaricatiRef = useRef(false);
  const applicaRateDefaultAlProdottoRef = useRef(false);
  const [pagamenti, setPagamenti] = useState<Pagamento[]>([]);
  const [pagamentiLocali, setPagamentiLocali] = useState<Pagamento[]>([]);
  const [pagamentiSospesiLocalmente, setPagamentiSospesiLocalmente] = useState<Set<string>>(() => new Set());
  const [pagamentoDraft, setPagamentoDraft] = useState<PagamentoDraft | null>(null);
  const [totaleSalvato, setTotaleSalvato] = useState<number | null>(null);
  const [conti, setConti] = useState<RecordDto[]>([]);
  const [accontoIncassato, setAccontoIncassato] = useState(false);
  const [accontoData, setAccontoData] = useState(oggi());
  // Scadenzario locale (solo nuovo ordine): si materializza al salvataggio.
  const [bozze, setBozze] = useState<Bozza[]>([]);
  const bozzeToccate = useRef(false);
  const totale = useMemo(
    () => totaleRigheForm(righe),
    [righe],
  );
  const {
    codTutto,
    setCodTutto,
    toggleCod: toggleCodHook,
    pagTarget,
    setPagTarget,
    rateizzaTarget,
    setRateizzaTarget,
    contrassegnoContoId,
    optionsConti,
    optionsContiAcconto,
  } = useScadenzarioEditor({
    conti,
    categoria,
    totale,
    onCodTuttoAttivato: () => {
      bozzeToccate.current = false;
      accontoTocco.current = true;
      setAccontoIncassato(false);
    },
    onCodTuttoDisattivato: () => {
      bozzeToccate.current = false;
      accontoTocco.current = false;
      setAccontoIncassato(false);
    },
  });
  const ricaricaPagamentoInCorso = useRef<Promise<void> | null>(null);
  const [rimborsoExtra, setRimborsoExtra] = useState<RimborsoModalTarget | null>(null);
  const [rimborsoEsistente, setRimborsoEsistente] = useState<Rimborso | null>(null);
  const [rimborsoRichiesto, setRimborsoRichiesto] = useState<Rimborso | null>(null);
  const [rimborsiEffettuati, setRimborsiEffettuati] = useState(0);
  const [schedaCliente, setSchedaCliente] = useState<{
    ordineId: string;
    numero?: string;
    chiudiOrdineDopo: boolean;
  } | null>(null);
  const { ordineFinestra } = usePrefs();
  const [preventivoEsistente, setPreventivoEsistente] = useState(false);

  const caricaStatoPreventivo = useCallback(() => {
    if (!ordineId) {
      setPreventivoEsistente(false);
      return Promise.resolve();
    }
    return api
      .preventivoGet(ordineId)
      .then((preventivo) => setPreventivoEsistente(preventivo.esiste))
      .catch(() => setPreventivoEsistente(false));
  }, [ordineId]);

  useEffect(() => {
    void caricaStatoPreventivo();
  }, [caricaStatoPreventivo]);
  useRicaricaSuEventi(["preventivo:salvato"], caricaStatoPreventivo, 100);

  const apriPreventivoCollegato = useCallback(
    async (id: string, vista: "editor" | "anteprima") => {
      const usaFinestra =
        !!dentroFinestra ||
        ordineFinestra !== "mai";
      if (
        usaFinestra &&
        (await apriFinestraPreventivo(
          id,
          numero,
          identity,
          vista,
          vista === "anteprima" || dentroFinestra ? "ordine" : undefined,
        ))
      ) {
        // Durante la sola anteprima l'ordine resta aperto dietro la nuova
        // finestra: il pulsante di ritorno può quindi ripristinarlo intatto.
        if (vista !== "anteprima" && !dentroFinestra) onSaved(id);
        return;
      }
      if (onApriPreventivo) {
        onApriPreventivo(id, vista);
        return;
      }
      toast.warning("Non è stato possibile aprire il preventivo.");
    },
    [
      dentroFinestra,
      identity,
      numero,
      onApriPreventivo,
      onSaved,
      ordineFinestra,
    ],
  );

  const chiudiPagamento = useCallback(() => {
    setPagTarget(null);
    setPagamentoDraft(null);
  }, []);

  const aggiornaDraftPagamento = useCallback((draft: PagamentoDraft | null) => {
    setPagamentoDraft(draft);
  }, []);

  const salvaPagamentoLocale = useCallback((draft: PagamentoDraft) => {
    setPagamentoDraft(null);
    setPagamentiLocali((correnti) => [...correnti, draft]);
    if (draft.tipo === "acconto") {
      accontoTocco.current = true;
      setAcconto(draft.importo / 100);
    }
  }, []);

  const apriPagamento = useCallback(
    (target: PagamentoModalTarget) => {
      setPagamentoDraft(null);
      setPagTarget(
        target.pagamento
          ? {
              ...target,
              ...pagamentoPersistitoConImportoPreview(
                target.pagamento,
                pagamenti,
              ),
            }
          : target,
      );
    },
    [pagamenti],
  );

  const [prefProdotti, setPrefProdotti] = useState<{
    soglia_prezzo: number;
    acconto_prezzo_basso: number;
    acconto_prezzo_alto: number;
  }>(PREFERENZE_ACCONTO_PRODOTTI_DEFAULT);

  const [motivoRifiuto, setMotivoRifiuto] = useState("");
  const [omaggio, setOmaggio] = useState(false);
  const [fattDiversa, setFattDiversa] = useState(false);
  const [fatt, setFatt] = useState<DatiFatturazione>({
    ragione_sociale: "",
    indirizzo: "",
    citta: "",
    prov: "",
    cap: "",
    piva: "",
  });
  // Promemoria collegati all'ordine (accesso discreto: collassato di default).
  const [promemAperti, setPromemAperti] = useState(false);

  // Nuovo cliente al volo (oggetto sempre presente: la modale anima correttamente
  // anche in chiusura, senza "collassare" su un componente vuoto).
  const [nuovoCliApri, setNuovoCliApri] = useState(false);
  const [nuovoCliVal, setNuovoCliVal] = useState<Record<string, string | number>>(valoriClienteVuoti);
  const [nuovoCliErr, setNuovoCliErr] = useState<Record<string, string>>({});
  const [creandoCli, setCreandoCli] = useState(false);
  // Se valorizzato, la modale cliente è in modifica (id del cliente), non creazione.
  const [cliEditId, setCliEditId] = useState<string | null>(null);

  // Nuovo/modifica medico al volo (Diagnostica: il destinatario È il medico).
  const [nuovoMedApri, setNuovoMedApri] = useState(false);
  const [nuovoMedVal, setNuovoMedVal] = useState<Record<string, string | number>>(valoriMedicoVuoti);
  const [nuovoMedErr, setNuovoMedErr] = useState<Record<string, string>>({});
  const [creandoMed, setCreandoMed] = useState(false);
  const [medEditId, setMedEditId] = useState<string | null>(null);

  const [patchPagamentiVirtuali, setPatchPagamentiVirtuali] = useState<
    Record<string, { contoId?: string; scadenza?: string; scadDaSpedizione?: boolean }>
  >({});
  const baselineOrdineRealtimeRef = useRef<CampiOrdineRealtime | null>(null);
  const baselineRigheRealtimeRef = useRef<RigaForm[]>([]);
  const campiOrdineLocaliRef = useRef<CampiOrdineRealtime>({});
  const righeLocaliRef = useRef<RigaForm[]>(righe);
  campiOrdineLocaliRef.current = {
    categoria,
    data,
    medicoId,
    agenteId,
    clienteId,
    stato,
    marcatore,
    note,
    acconto: acconto === "" ? 0 : eurToCents(Number(acconto)),
    motivoRifiuto,
    omaggio,
    fattRagioneSociale: fattDiversa ? fatt.ragione_sociale : "",
    fattIndirizzo: fattDiversa ? fatt.indirizzo : "",
    fattCitta: fattDiversa ? fatt.citta : "",
    fattProv: fattDiversa ? fatt.prov : "",
    fattCap: fattDiversa ? fatt.cap : "",
    fattPiva: fattDiversa ? fatt.piva.toUpperCase() : "",
  };
  righeLocaliRef.current = righe;

  function applicaAggiornamentoOrdineRealtime(ord: RecordDto, recordsRighe: RecordDto[]): void {
    const remoto = campiOrdineRealtime(ord.data);
    const baseline = baselineOrdineRealtimeRef.current ?? remoto;
    const mergeTestata = mergeRealtimeSelettivo(
      baseline,
      campiOrdineLocaliRef.current,
      remoto
    );
    const v = mergeTestata.valori;
    setCategoria(String(v.categoria));
    setData(String(v.data));
    setMedicoId(String(v.medicoId));
    setAgenteId(String(v.agenteId));
    setClienteId(String(v.clienteId));
    setStato(String(v.stato));
    setStatoIniziale(String(remoto.stato));
    setMarcatore(String(v.marcatore));
    setMarcatoreIniziale(String(remoto.marcatore));
    setNote(String(v.note));
    setAcconto(Number(v.acconto) > 0 ? Number(v.acconto) / 100 : "");
    setAccontoIniziale(Number(remoto.acconto));
    setMotivoRifiuto(String(v.motivoRifiuto));
    setOmaggio(Boolean(v.omaggio));
    const fattAggiornata = {
      ragione_sociale: String(v.fattRagioneSociale),
      indirizzo: String(v.fattIndirizzo),
      citta: String(v.fattCitta),
      prov: String(v.fattProv),
      cap: String(v.fattCap),
      piva: String(v.fattPiva),
    };
    setFatt(fattAggiornata);
    setFattDiversa(Object.values(fattAggiornata).some((valore) => valore.trim() !== ""));

    const righeRemote = righeOrdineDaRecord(
      recordsRighe,
      prodotti,
      String(remoto.categoria) === "Diagnostica"
    );
    const datiRemotiCambiati =
      JSON.stringify(baseline) !== JSON.stringify(remoto) ||
      firmaRigheOrdineRealtime(baselineRigheRealtimeRef.current) !== firmaRigheOrdineRealtime(righeRemote);
    if (!formModificatoRef.current && datiRemotiCambiati) {
      riallineaFirmaDopoRealtimeRef.current = true;
    }
    const mergeRighe = mergeRigheOrdineRealtime(
      baselineRigheRealtimeRef.current,
      righeLocaliRef.current,
      righeRemote
    );
    setRighe(mergeRighe.righe);
    setTotaleSalvato(totaleRigheForm(righeRemote));

    baselineOrdineRealtimeRef.current = remoto;
    baselineRigheRealtimeRef.current = righeRemote;
  }

  // Avvisa il wrapper quando una sotto-modale è aperta (per non chiudere l'ordine con Esc).
  useEffect(() => {
    onNested?.(
      nuovoCliApri ||
        nuovoMedApri ||
        pagTarget !== null ||
        rateizzaTarget !== null ||
        rimborsoExtra !== null ||
        schedaCliente !== null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nuovoCliApri, nuovoMedApri, pagTarget, rateizzaTarget, rimborsoExtra, schedaCliente]);

  // Dopo un pagamento: ricarica lo scadenzario e lo stato (può passare a Confermato).
  // Rimborso "extra" già esistente per quest'ordine (per non duplicarlo e mostrarne lo stato).
  const caricaRimborso = useCallback(() => {
    if (!ordineId) {
      setRimborsoEsistente(null);
      setRimborsoRichiesto(null);
      setRimborsiEffettuati(0);
      return;
    }
    api
      .rimborsiLista()
      .then((rs) => {
        const riepilogo = riepilogaRimborsiExtraOrdine(rs, ordineId);
        setRimborsoEsistente(riepilogo.esistente);
        setRimborsoRichiesto(riepilogo.richiesto);
        setRimborsiEffettuati(riepilogo.importoEffettuato);
      })
      .catch(() => {});
  }, [ordineId]);

  useEffect(() => {
    caricaRimborso();
  }, [caricaRimborso]);

  function ricaricaDopoPagamento(
    opts: { preservaRighe?: boolean; sincronizzaAcconto?: boolean; chiudiSottomodali?: boolean } = {}
  ): Promise<void> {
    // La chiusura è un effetto UI immediato e non va deduplicata insieme al fetch.
    // Un evento `pagamento:salvato` può infatti aver già avviato una ricarica: in quel
    // caso riusiamo la richiesta di rete, ma il modale deve chiudersi comunque.
    if (opts.chiudiSottomodali) {
      setPagTarget(null);
      setPagamentoDraft(null);
      setRateizzaTarget(null);
    }
    if (ricaricaPagamentoInCorso.current) {
      const corrente = ricaricaPagamentoInCorso.current;
      const richiedeRicaricaMirata =
        opts.preservaRighe !== undefined || opts.sincronizzaAcconto === true;
      if (!richiedeRicaricaMirata) return corrente;
      // Il refresh partito dall'evento non conosce le garanzie richieste dal
      // salvataggio locale (es. preservare righe o sincronizzare l'acconto).
      // Ne eseguiamo quindi uno mirato subito dopo, senza riaprire i sottomodali.
      return corrente.then(() => {
        if (ricaricaPagamentoInCorso.current === corrente) {
          ricaricaPagamentoInCorso.current = null;
        }
        return ricaricaDopoPagamento({ ...opts, chiudiSottomodali: false });
      });
    }
    const task = (async () => {
      if (!ordineId) return;
      try {
        const [pags, ord, tutteRighe] = await Promise.all([
          api.pagamentiOrdine(ordineId),
          api.recordGet("ordine", ordineId),
          api.recordsList("riga_ordine"),
        ]);
        const mie = tutteRighe.filter((r) => r.data.ordine_id === ordineId);
        if (!ord || ord.deleted) {
          toast.warning("L'ordine è stato eliminato o annullato da un'altra postazione.");
          onClose();
          return;
        }
        const preservaRighe = opts.preservaRighe ?? formModificatoRef.current;
        if (
          !formModificatoRef.current &&
          firmaScadenzario(pagamenti) !== firmaScadenzario(pags)
        ) {
          riallineaFirmaDopoRealtimeRef.current = true;
        }
        setPagamenti(pags);
        if (!opts.chiudiSottomodali) {
          setPagTarget((corrente) => {
            if (!corrente?.pagamento) return corrente;
            const aggiornato = pags.find((pagamento) => pagamento.id === corrente.pagamento!.id);
            return aggiornato ? { ...corrente, pagamento: aggiornato } : null;
          });
        }
        applicaAggiornamentoOrdineRealtime(ord, mie);
        if (!preservaRighe) {
          setPagamentiLocali([]);
          setPagamentiSospesiLocalmente(new Set());
        }
        if (typeof ord.data.acconto === "number" && opts.sincronizzaAcconto) {
          const haAccontoNeiPagamenti = pags.some((p) => p.tipo === "acconto");
          const accontoEffettivo = haAccontoNeiPagamenti ? ord.data.acconto : 0;
          setAcconto(accontoEffettivo > 0 ? accontoEffettivo / 100 : "");
          setAccontoIniziale(accontoEffettivo);
        }
      } catch {
        /* lista già aggiornata altrove */
      }
    })();
    ricaricaPagamentoInCorso.current = task;
    void task.finally(() => {
      if (ricaricaPagamentoInCorso.current === task) ricaricaPagamentoInCorso.current = null;
    });
    return task;
  }

  // Materializza lo scadenzario locale (bozze) sull'ordine appena creato.
  async function persistiBozze(id: string, bozzeDaSalvare = bozze) {
    const bozzeSpediz = bozzeDaSalvare.filter((b) => b.scadDaSpedizione && (b.tipo === "saldo" || b.tipo === "rata"));
    for (const b of bozzeDaSalvare) {
      const pag = await api.pagamentoRegistra({
        ordineId: id,
        tipo: b.tipo,
        importo: b.importo,
        saldato: b.saldato,
        scadenza: b.saldato || b.scadDaSpedizione ? "" : b.scadenza,
        // Il conto destinazione si registra anche per gli attesi (non solo al saldo).
        contoId: b.contoId,
        data: b.saldato ? b.data : "",
        verificato: b.verificato,
      });
      // Scadenza legata alla spedizione (saldo/rate): si marca così alla prima spedizione il
      // backend la riallinea a «spedizione + 7gg» (contrassegno/assegno +30). FASE 7.
      if (b.scadDaSpedizione && (b.tipo === "saldo" || b.tipo === "rata")) {
        const idxSpediz = bozzeSpediz.indexOf(b);
        await api.recordUpdate("pagamento", pag.id, {
          scad_da_spedizione: true,
          scad_rel_giorni: calcolaScadRelGiorni(idxSpediz, 0, b.scadRelGiorni),
        });
      }
    }
  }

  function aggiornaScadenzaBozza(key: string, val: string) {
    if (ordineId) {
      if (key.startsWith("__local_pagamento__")) {
        setPagamentiLocali((correnti) =>
          correnti.map((p) => (p.id === key ? { ...p, scadenza: val } : p))
        );
        return;
      }
      if (key.startsWith("__preview_scadenzario__")) {
        setPatchPagamentiVirtuali((correnti) => ({
          ...correnti,
          [key]: { ...correnti[key], scadenza: val },
        }));
        return;
      }
    }
    setBozze((bs) => bs.map((b) => (b.key === key ? { ...b, scadenza: val } : b)));
  }

  function aggiornaContoBozza(key: string, contoId: string) {
    if (ordineId) {
      if (key.startsWith("__local_pagamento__")) {
        setPagamentiLocali((correnti) =>
          correnti.map((p) =>
            p.id === key ? { ...p, ...campiContoLocale(conti, contoId), contoId } : p
          )
        );
        return;
      }
      if (key.startsWith("__preview_scadenzario__")) {
        const cTipo = ((conti.find((c) => c.id === contoId)?.data.tipo as string) || "");
        const èTransito = èContoTransito(cTipo);
        setPatchPagamentiVirtuali((correnti) => ({
          ...correnti,
          [key]: {
            ...correnti[key],
            contoId,
            ...(èTransito ? { scadDaSpedizione: true } : {}),
          },
        }));
        return;
      }
    }
    setBozze((bs) => bs.map((b) => (b.key === key ? { ...b, contoId } : b)));
  }

  function aggiornaScadDaSpedizioneBozza(key: string, val: boolean) {
    if (ordineId) {
      if (key.startsWith("__local_pagamento__")) {
        setPagamentiLocali((correnti) =>
          correnti.map((p) => (p.id === key ? { ...p, scadDaSpedizione: val } : p))
        );
        return;
      }
      if (key.startsWith("__preview_scadenzario__")) {
        setPatchPagamentiVirtuali((correnti) => ({
          ...correnti,
          [key]: { ...correnti[key], scadDaSpedizione: val },
        }));
        return;
      }
    }
    setBozze((bs) => bs.map((b) => (b.key === key ? { ...b, scadDaSpedizione: val } : b)));
  }

  // Rateizza il saldo localmente (nuovo ordine): sostituisce saldo/rata con N rate.
  // `daSpedizione`: le rate sono legate alla spedizione (prima a «spedizione + 7gg»), con la
  // spaziatura (rel giorni) calcolata dalle scadenze in anteprima rispetto alla prima rata.
  function applicaRateizzoBozze(rate: RataInput[], daSpedizione: boolean) {
    bozzeToccate.current = true;
    const ancora = rate[0]?.scadenza;
    setBozze((bs) => {
      const acconto = bs.filter((b) => b.tipo === "acconto");
      // Le rate ereditano il conto destinazione del saldo che sostituiscono.
      const contoRate =
        bs.find((b) => b.tipo === "saldo")?.contoId ||
        bs.find((b) => b.tipo === "rata")?.contoId ||
        contoSaldoResolved;
      const contoRateTipo = ((conti.find((c) => c.id === contoRate)?.data.tipo as string) || "");
      const contoRateSuccessive = èContoTransito(contoRateTipo)
        ? contoSaldoResolved || contoRate
        : contoRate;
      const rateBozze: Bozza[] = rate.map((r, i) => ({
        key: `rata-${i}-${Date.now()}`,
        tipo: "rata",
        importo: r.importo,
        saldato: false,
        scadenza: r.scadenza,
        contoId: i === 0 ? contoRate : contoRateSuccessive,
        data: "",
        verificato: false,
        scadDaSpedizione: daSpedizione,
        scadRelGiorni: daSpedizione ? giorniTra(ancora, r.scadenza) : 0,
      }));
      return [...acconto, ...rateBozze];
    });
  }

  function applicaRateizzoPagamentiLocali(rate: RataInput[], daSpedizione: boolean) {
    if (!ordineId || !rateizzaTarget) return;

    const modalita = rateizzaTarget.modalita ?? "sostituisci";
    const apertiSaldoRata = [...pagamentiPreview].filter((p) => !pagamentoPreviewLocale(p) && pagamentoApertoSaldoRata(p));
    const sospesi = modalita === "sostituisci" ? apertiSaldoRata.map((p) => p.id) : [];
    const contoPrimaRata = apertiSaldoRata[0]?.contoId || contoSaldoResolved;
    const contoPrimaTipo =
      apertiSaldoRata[0]?.contoTipo || ((conti.find((c) => c.id === contoPrimaRata)?.data.tipo as string) || "");
    const contoSuccessive =
      èContoTransito(contoPrimaTipo)
        ? contoSaldoResolved || contoPrimaRata
        : contoPrimaRata;
    const ancora = rate[0]?.scadenza;
    const timestamp = Date.now();
    const rateLocali: Pagamento[] = rate.map((r, i) => {
      const contoId = i === 0 ? contoPrimaRata : contoSuccessive;
      return {
        id: `__local_pagamento__rata-${timestamp}-${i}`,
        ordineId,
        tipo: "rata",
        importo: r.importo,
        saldato: false,
        scadenza: r.scadenza,
        ...campiContoLocale(conti, contoId),
        ...CAMPI_PAGAMENTO_LOCALE,
        scadDaSpedizione: daSpedizione,
        scadRelGiorni: daSpedizione ? giorniTra(ancora, r.scadenza) : 0,
      };
    });

    setPagamentiSospesiLocalmente((correnti) => {
      const next = new Set(correnti);
      for (const id of sospesi) next.add(id);
      return next;
    });
    setPagamentiLocali((correnti) => {
      const accontoDaAggiungere = pagamenti.length === 0 && correnti.length === 0
        ? pagamentiPreview.filter((p) => p.tipo === "acconto")
        : [];
      return [
        ...correnti.filter((p) => modalita === "aggiungi" || !pagamentoApertoSaldoRata(p)),
        ...accontoDaAggiungere,
        ...rateLocali,
      ];
    });
    toast.success("Rate aggiornate nello scadenzario. Salva l'ordine per confermarle.");
  }

  const agenteNome = useMemo(
    () => agenti.find((a) => a.id === agenteId)?.data.nome as string | undefined,
    [agenti, agenteId]
  );


  const numProdotti = useMemo(
    () => righe.filter((r) => r.prodottoId || r.prodottoNome.trim()).length,
    [righe]
  );
  useEffect(() => {
    if (caricamento) {
      prodottiCaricatiRef.current = false;
      return;
    }
    if (!prodottiCaricatiRef.current) {
      prodottiPrecedentiRef.current = numProdotti;
      prodottiCaricatiRef.current = true;
      return;
    }
    if (numProdotti > prodottiPrecedentiRef.current) {
      applicaRateDefaultAlProdottoRef.current = true;
    } else if (numProdotti === 0) {
      applicaRateDefaultAlProdottoRef.current = false;
    }
    prodottiPrecedentiRef.current = numProdotti;
  }, [caricamento, numProdotti]);
  const pagamentoDraftOrdine = useMemo(
    () => (ordineId && pagamentoDraft?.ordineId === ordineId ? pagamentoDraft : null),
    [ordineId, pagamentoDraft]
  );
  const draftHaConvertitoAcconto =
    pagTarget?.pagamento?.tipo === "acconto" &&
    pagamentoDraftOrdine != null &&
    pagamentoDraftOrdine.tipo !== "acconto";
  const accontoCentsCorrente = draftHaConvertitoAcconto
    ? 0
    : Math.min(centsDi(acconto), totale);
  const haPagamentiProtetti = useMemo(
    () => [...pagamenti, ...pagamentiLocali].some((pag) => pag.saldato || pag.verificato),
    [pagamenti, pagamentiLocali]
  );
  const pagamentiEffettivi = useMemo(
    () => pagamenti.filter((pag) => !pagamentiSospesiLocalmente.has(pag.id)),
    [pagamenti, pagamentiSospesiLocalmente]
  );

  // Le preferenze di conto/acconto del medico/agente valgono per Immunoterapia e Diagnostica:
  // per Keriba si usano i conti predefiniti dell'app, non quelli preferiti.
  const usaPrefMedAg = categoria !== "Keriba";

  // Conti proposti per acconto e saldo/rate (medico → agente → predefinito → banca).
  const [contoAccontoResolved, contoSaldoResolved] = useMemo(() => {
    const medico = usaPrefMedAg ? medici.find((record) => record.id === medicoId) ?? null : null;
    const agente = usaPrefMedAg ? agenti.find((record) => record.id === agenteId) ?? null : null;
    const risolvi = (tipo: "acconto" | "saldo") => risolviContoPreferito({ conti, medico, agente, tipo });
    return [risolvi("acconto"), risolvi("saldo")] as const;
  }, [conti, medici, agenti, medicoId, agenteId, usaPrefMedAg]);
  const numeroRateSaldoDefault = useMemo(() => {
    const raw = medici.find((m) => m.id === medicoId)?.data.rate_saldo_default;
    return numeroRateSaldoPredefinito(categoria, raw);
  }, [categoria, medicoId, medici]);
  const pagamentiPreview = useMemo(() => {
    if (!ordineId) return pagamenti;

    let next = [...pagamentiEffettivi, ...pagamentiLocali].map((pag) => ({ ...pag }));
    let deveRiallineareAperti = totaleSalvato !== null && totale !== totaleSalvato;

    if (accontoCentsCorrente !== accontoIniziale) {
      const haAccontoSaldato = next.some((pag) => pag.tipo === "acconto" && pag.saldato);
      let accontoAttesoAggiornato = false;
      if (!haAccontoSaldato) {
        next = next.flatMap((pag) => {
          if (pag.tipo === "acconto" && !pag.saldato && !accontoAttesoAggiornato) {
            accontoAttesoAggiornato = true;
            return accontoCentsCorrente > 0 ? [{ ...pag, importo: accontoCentsCorrente }] : [];
          }
          return [pag];
        });
        if (accontoAttesoAggiornato) {
          deveRiallineareAperti = true;
        }
      }
    }

    if (pagamentoDraftOrdine) {
      const idx = next.findIndex((pag) => pag.id === pagamentoDraftOrdine.id);
      const precedente = idx >= 0 ? next[idx] : null;
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...pagamentoDraftOrdine };
      } else {
        next = [...next, pagamentoDraftOrdine];
      }
      if (
        precedente &&
        pagamentoDraftOrdine.saldato &&
        (!precedente.saldato || precedente.importo !== pagamentoDraftOrdine.importo)
      ) {
        deveRiallineareAperti = true;
      }
    }

    const incassatoPreview = next.filter((pag) => pag.saldato).reduce((s, pag) => s + pag.importo, 0);
    if (pagamentoDraftOrdine?.saldato && totale > 0 && incassatoPreview >= totale) {
      return next.filter((pag) => pag.saldato);
    }

    if (deveRiallineareAperti) {
      next = riallineaVociAperteLocali(next, totale);
    }

    if (totale > 0) {
      const creaPreview = (tipo: "acconto" | "saldo", importo: number): Pagamento => {
        const id = `__preview_scadenzario__${tipo}`;
        const patch = patchPagamentiVirtuali[id];
        const defaultContoId = tipo === "acconto" ? contoAccontoResolved : contoSaldoResolved;
        const cId = patch?.contoId || defaultContoId;
        const cTipo = (conti.find((c) => c.id === cId)?.data.tipo as string) || "";
        const transito = èContoTransito(cTipo);
        const daSped = patch?.scadDaSpedizione !== undefined
          ? patch.scadDaSpedizione
          : (tipo === "saldo" || transito);
        const scad = patch?.scadenza !== undefined
          ? patch.scadenza
          : (tipo === "acconto" ? data : "");
        return {
          id,
          ordineId,
          tipo,
          importo,
          saldato: false,
          scadenza: daSped ? "" : scad,
          ...campiContoLocale(conti, cId),
          ...CAMPI_PAGAMENTO_LOCALE,
          scadDaSpedizione: daSped,
          scadRelGiorni: 0,
        };
      };
      let coperto = importoCoperto(next);
      const haAccontoSaldato = next.some((pag) => pag.tipo === "acconto" && pag.saldato);
      const haAccontoAperto = next.some((pag) => pag.tipo === "acconto" && !pag.saldato);
      const haSaldoRataAperta = next.some((pag) => pagamentoApertoSaldoRata(pag));
      if (!haAccontoSaldato && !haAccontoAperto && accontoCentsCorrente > 0 && coperto < totale) {
        const importoAcconto = Math.min(accontoCentsCorrente, totale - coperto);
        next = [...next, creaPreview("acconto", importoAcconto)];
        coperto += importoAcconto;
      }
      if (!haSaldoRataAperta && coperto < totale) {
        next = [...next, creaPreview("saldo", totale - coperto)];
      }
    }

    return next;
  }, [
    accontoCentsCorrente,
    accontoIniziale,
    data,
    ordineId,
    pagamentoDraftOrdine,
    pagamentiEffettivi,
    pagamentiLocali,
    patchPagamentiVirtuali,
    totale,
    totaleSalvato,
    contoAccontoResolved,
    contoSaldoResolved,
    conti,
  ]);
  // Incassato = solo i pagamenti saldati; gli attesi sono crediti, non incassi.
  const incassato = useMemo(() => {
    if (ordineId) {
      return pagamentiPreview.filter((p) => p.saldato).reduce((s, p) => s + p.importo, 0);
    } else {
      return bozze.filter((b) => b.saldato).reduce((s, b) => s + b.importo, 0);
    }
  }, [ordineId, pagamentiPreview, bozze]);
  const residuo = totale - incassato;
  const eccedenzaSalvata = useMemo(() => {
    if (totaleSalvato === null) return null;
    const incassatoSalvato = pagamenti
      .filter((pagamento) => pagamento.saldato)
      .reduce((somma, pagamento) => somma + pagamento.importo, 0);
    return Math.max(0, incassatoSalvato - totaleSalvato);
  }, [pagamenti, totaleSalvato]);
  const eccedenzaInBozza = Math.max(0, -residuo);
  // Saldo ancora atteso (per il pulsante Rateizza): somma degli attesi saldo/rata.
  const saldoAtteso = useMemo(
    () => pagamentiPreview.filter((p) => pagamentoApertoSaldoRata(p)).reduce((s, p) => s + p.importo, 0),
    [pagamentiPreview]
  );
  const scopertoScadenzario = useMemo(() => {
    if (!ordineId) return 0;
    return Math.max(0, totale - importoCoperto(pagamentiPreview));
  }, [ordineId, pagamentiPreview, totale]);
  const scadenzarioInBozza = !!ordineId && (
    (totaleSalvato !== null && totale !== totaleSalvato) ||
    accontoCentsCorrente !== accontoIniziale ||
    pagamentiLocali.length > 0 ||
    pagamentiSospesiLocalmente.size > 0 ||
    Object.keys(patchPagamentiVirtuali).length > 0 ||
    pagamenti.length === 0
  );
  const prossimaRataDaSaldare = useMemo(() => {
    if (!ordineId || scopertoScadenzario > 0) return null;
    return selezionaProssimoPagamentoDaSaldare(pagamentiPreview, conti);
  }, [ordineId, pagamentiPreview, scopertoScadenzario, conti]);
  const azioneAggiungiPagamento = useMemo<PagamentoModalTarget | null>(() => {
    if (!ordineId) return null;
    const ordineGiaSaldato = residuo <= 0;
    const proposta = proponiPagamentoAggiuntivo({
      pagamentiPreview,
      residuo,
      accontoPrevisto: accontoCentsCorrente,
      scopertoScadenzario,
    });
    return {
      nuovo: {
        ordineId,
        numero,
        tipo: proposta.tipo,
        importo: proposta.importo,
        saldato: ordineGiaSaldato,
        rimandaRiallineamento: scadenzarioInBozza,
      },
    };
  }, [accontoCentsCorrente, ordineId, numero, pagamentiPreview, residuo, scadenzarioInBozza, scopertoScadenzario]);

  useEffect(() => {
    (async () => {
      try {
        const [m, c, p, a, co, pr] = await Promise.all([
          ...richiesteRiferimentiOrdine(),
          api.recordGet("parametri_globali", "prodotti").catch(() => null),
        ]);
        setMedici(m);
        setConti(co);
        setClienti(c);
        setProdotti(p);
        setAgenti(a);
        setPrefProdotti(preferenzeAccontoProdottiDaRecord(pr));

        if (ordineId) {
          const ord = await api.recordGet("ordine", ordineId);
          if (ord) {
            const d = ord.data;
            setData((d.data as string) || oggi());
            setMedicoId((d.medico_id as string) || "");
            setAgenteId((d.agente_id as string) || "");
            setClienteId((d.cliente_id as string) || "");
            setStato((d.stato as string) || "Nuovo");
            setStatoIniziale((d.stato as string) || "Nuovo");
            const marcatoreSalvato = (d.marcatore as string) || "";
            setMarcatore(marcatoreSalvato);
            setMarcatoreIniziale(marcatoreSalvato);
            setNote((d.note as string) || "");
            if (typeof d.acconto === "number") {
              setAcconto(d.acconto / 100);
              setAccontoIniziale(d.acconto);
              accontoTocco.current = true; // valore salvato: non sovrascriverlo
            }
            setMotivoRifiuto((d.motivo_rifiuto as string) || "");
            setOmaggio(d.omaggio === true);
            const f = {
              ragione_sociale: (d.fatt_ragione_sociale as string) || "",
              indirizzo: (d.fatt_indirizzo as string) || "",
              citta: (d.fatt_citta as string) || "",
              prov: (d.fatt_prov as string) || "",
              cap: (d.fatt_cap as string) || "",
              piva: (d.fatt_piva as string) || "",
            };
            setFatt(f);
            setFattDiversa(Object.values(f).some((v) => v.trim() !== ""));
            baselineOrdineRealtimeRef.current = campiOrdineRealtime(d);
          }
          const tutte = await api.recordsList("riga_ordine");
          const mie = tutte.filter((r) => r.data.ordine_id === ordineId);
          // Categoria dell'ordine: dal record; per gli ordini vecchi senza il campo,
          // si deduce dal primo prodotto delle righe, con fallback Immunoterapia.
          const catRecord = (ord?.data.categoria as string) || "";
          const catDaRighe = mie
            .map((r) => p.find((x) => x.id === r.data.prodotto_id)?.data.categoria as string | undefined)
            .find((x) => !!x);
          const categoriaEffettiva = catRecord || catDaRighe || CATEGORIA_DEFAULT;
          const righeCaricate = righeOrdineDaRecord(mie, p, categoriaEffettiva === "Diagnostica");
          setRighe(righeCaricate);
          baselineRigheRealtimeRef.current = righeCaricate;
          setTotaleSalvato(totaleRigheForm(righeCaricate));
          setCategoria(categoriaEffettiva);
          const pagamentiCaricati = await api.pagamentiOrdine(ordineId);
          setPagamenti(pagamentiCaricati);
          // Un ordine salvato ancora vuoto non ha davvero "fissato" un acconto a zero:
          // quando arriva il primo prodotto riattiviamo la stessa proposta automatica
          // usata in creazione.
          if (mie.length === 0 && pagamentiCaricati.length === 0) {
            accontoTocco.current = false;
            setAcconto("");
            setAccontoIniziale(0);
          } else if (
            pagamentiCaricati.length > 0 &&
            !pagamentiCaricati.some((pag) => pag.tipo === "acconto")
          ) {
            setAcconto("");
            setAccontoIniziale(0);
          }
        } else if (medicoPre) {
          // Nuovo ordine precompilato dal Riepilogo medico: medico → agente derivato.
          setMedicoId(medicoPre);
          setAgenteId((m.find((x) => x.id === medicoPre)?.data.agente_id as string) || "");
        } else if (clientePre) {
          // Nuovo ordine precompilato dal Riepilogo cliente: cliente → ultimo medico → agente.
          setClienteId(clientePre);
          const ultimo = ultimoMedicoClienteValido(clientePre, c, m);
          if (ultimo) {
            setMedicoId(ultimo);
            setAgenteId((m.find((x) => x.id === ultimo)?.data.agente_id as string) || "");
          }
        }
      } catch (e) {
        toast.error(`Caricamento non riuscito: ${e}`);
      } finally {
        setCaricamento(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordineId]);

  // Il callback più recente evita closure obsolete del form; il pianificatore centrale
  // serializza gli eventi ravvicinati e garantisce un ultimo refresh dopo quello in corso.
  useRicaricaSuEventi(
    EVENTI_ORDINE_APERTO,
    () => ordineId ? ricaricaDopoPagamento() : undefined,
    80
  );
  useRicaricaSuEventi(EVENTI_RIFERIMENTI_ORDINE, async () => {
    const [m, c, p, a, co] = await Promise.all(richiesteRiferimentiOrdine());
    setMedici(m);
    setClienti(c);
    setProdotti(p);
    setAgenti(a);
    setConti(co);
  }, 120);

  // Acconto suggerito, per categoria:
  //  · Keriba       → l'acconto = costo dei prodotti (intero totale), modificabile;
  //  · Diagnostica  → nessun acconto automatico (no preferenze medico/agente);
  //  · Immunoterapia→ preferenza medico → agente → regola prodotti, mai oltre il totale.
  // È un valore derivato condiviso anche con la creazione automatica dello scadenzario:
  // così acconto e rate nascono nello stesso passaggio, senza dipendere dall'ordine degli effect.
  const accontoSuggeritoCents = useMemo(() => {
    return accontoSuggeritoOrdine({
      categoria,
      totale,
      righe: righe.map((riga) => ({
        qta: riga.qta || 0,
        prezzo:
          riga.prezzo === "" ? 0 : Math.round(Number(riga.prezzo) * 100),
        compilata: Boolean(riga.prodottoId || riga.prodottoNome.trim()),
      })),
      medico: medici.find((record) => record.id === medicoId),
      agente: agenti.find((record) => record.id === agenteId),
      preferenze: prefProdotti,
      saldoInteramenteAllaConsegna: codTutto,
    });
  }, [medicoId, agenteId, totale, medici, agenti, categoria, righe, prefProdotti, codTutto]);

  useEffect(() => {
    if (accontoTocco.current || accontoSuggeritoCents == null) return;
    const sugg = accontoSuggeritoCents;
    setAcconto(sugg <= 0 ? "" : sugg / 100);
  }, [accontoSuggeritoCents]);

  // Se l'ordine torna davvero senza prodotti e non ci sono incassi/verifiche storiche,
  // anche l'acconto previsto torna "non stabilito": niente residui fantasma nello
  // scadenzario mentre l'utente sta rifacendo l'ordine da zero.
  useEffect(() => {
    if (numProdotti > 0 || totale > 0 || haPagamentiProtetti) return;
    accontoTocco.current = false;
    setAcconto((corrente) => (corrente === "" ? corrente : ""));
    setAccontoIncassato(false);
    setPagamentiLocali((correnti) => (correnti.length === 0 ? correnti : []));
    setPagamentiSospesiLocalmente((correnti) => (correnti.size === 0 ? correnti : new Set()));
    if (!ordineId) {
      bozzeToccate.current = false;
      setBozze((correnti) => (correnti.length === 0 ? correnti : []));
    }
  }, [haPagamentiProtetti, numProdotti, ordineId, totale]);

  // Riporta la categoria effettiva al wrapper (badge nel titolo) solo a dati pronti:
  // così in modifica non si mostra il default «Immunoterapia» prima del caricamento.
  useEffect(() => {
    if (!caricamento) onCategoria?.(categoria);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria, caricamento]);

  useEffect(() => {
    if (focus?.sezione !== "pagamenti" || caricamento) return;
    const scrollId = window.setTimeout(() => {
      pagamentiRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setEvidenziaPagamenti(true);
    }, 120);
    const glowId = window.setTimeout(() => setEvidenziaPagamenti(false), 2600);
    return () => {
      window.clearTimeout(scrollId);
      window.clearTimeout(glowId);
    };
  }, [focus?.sezione, focus?.pagamentoId, caricamento]);



  // Scadenzario LIVE per il nuovo ordine: acconto + saldo si ricalcolano mentre si
  // inseriscono i prezzi. Le scadenze già ritoccate a mano si conservano; dopo un
  // "Rateizza" si conserva il piano e si ridistribuisce solo l'importo aperto.
  useEffect(() => {
    if (ordineId) return;
    // Keriba "salda tutto alla consegna": unico saldo in contrassegno, scad. +30gg.
    if (codTutto && contrassegnoContoId) {
      setBozze((prev) => {
        if (totale <= 0) return [];
        const old = new Map(prev.map((b) => [b.key, b]));
        return [
          {
            key: "saldo",
            tipo: "saldo",
            importo: totale,
            saldato: false,
            scadenza: old.get("saldo")?.scadenza || aggiungiGiorni(data, 30),
            contoId: contrassegnoContoId,
            data: "",
            verificato: false,
            // Contrassegno: alla spedizione la scadenza si fissa a «spedizione + 30gg».
            scadDaSpedizione: true,
            scadRelGiorni: 0,
          },
        ];
      });
      return;
    }
    const accontoC = Math.min(
      accontoTocco.current
        ? centsDi(acconto)
        : accontoSuggeritoCents ?? centsDi(acconto),
      totale
    );
    setBozze((prev) => {
      const old = new Map(prev.map((b) => [b.key, b]));
      const next: Bozza[] = [];
      if (accontoC > 0) {
        next.push({
          key: "acconto",
          tipo: "acconto",
          importo: accontoC,
          saldato: accontoIncassato,
          scadenza: accontoIncassato ? "" : old.get("acconto")?.scadenza || data,
          // Conto destinazione fissato sin da subito (anche se ancora atteso).
          contoId: old.get("acconto")?.contoId || contoAccontoResolved,
          data: accontoIncassato ? accontoData : "",
          verificato: false,
        });
      }
      if (bozzeToccate.current) {
        const apertiPersonalizzati = prev
          .filter((b) => b.tipo === "saldo" || b.tipo === "rata")
          .map((b) => ({
            ...b,
            scadenza: b.scadenza || aggiungiGiorni(data, 30),
            contoId: b.contoId || contoSaldoResolved,
          }));
        if (apertiPersonalizzati.length > 0) {
          return riallineaVociAperteLocali([...next, ...apertiPersonalizzati], totale);
        }
      }
      const saldoC = totale - accontoC;
      if (saldoC > 0) {
        if (numeroRateSaldoDefault > 1) {
          const contoTipo = (conti.find((c) => c.id === contoSaldoResolved)?.data.tipo as string) || "";
          const inizio = aggiungiGiorniRate(dataLocaleOggi(), offsetSpedizione(contoTipo));
          const rate = calcolaRate(saldoC, numeroRateSaldoDefault, inizio);
          for (let i = 0; i < rate.length; i += 1) {
            const rata = rate[i];
            const key = `rata-default-${i}`;
            const precedente = old.get(key);
            next.push({
              key,
              tipo: "rata",
              importo: rata.importo,
              saldato: false,
              scadenza: precedente?.scadenza || rata.scadenza,
              contoId: precedente?.contoId || contoSaldoResolved,
              data: "",
              verificato: false,
              scadDaSpedizione: precedente ? !!precedente.scadDaSpedizione : true,
              scadRelGiorni: precedente?.scadRelGiorni ?? giorniTra(inizio, rata.scadenza),
            });
          }
        } else {
          next.push({
            key: "saldo",
            tipo: "saldo",
            importo: saldoC,
            saldato: false,
            scadenza: old.get("saldo")?.scadenza || aggiungiGiorni(data, 30),
            contoId: old.get("saldo")?.contoId || contoSaldoResolved,
            data: "",
            verificato: false,
            // Saldo unico: alla spedizione la scadenza si fissa a «spedizione + 7gg».
            scadDaSpedizione: old.has("saldo") ? !!old.get("saldo")?.scadDaSpedizione : true,
            scadRelGiorni: old.get("saldo")?.scadRelGiorni ?? 0,
          });
        }
      }
      return next;
    });
  }, [ordineId, totale, acconto, accontoSuggeritoCents, accontoIncassato, accontoData, data, contoAccontoResolved, contoSaldoResolved, codTutto, contrassegnoContoId, conti, numeroRateSaldoDefault]);

  // Su un ordine esistente il default rate si propone soltanto in risposta
  // all'aggiunta di un prodotto. Svuotare/annullare i pagamenti, da solo, non deve
  // riattivarlo: in quel caso resta la normale proposta acconto + saldo.
  useEffect(() => {
    if (
      !ordineId ||
      caricamento ||
      categoria !== "Immunoterapia" ||
      numeroRateSaldoDefault <= 1 ||
      !applicaRateDefaultAlProdottoRef.current
    ) {
      return;
    }
    // Il prezzo può arrivare asincronicamente dopo la selezione: conserva il trigger
    // finché esiste davvero un saldo su cui costruire il piano.
    if (totale <= 0 || numProdotti <= 0) return;
    // Il trigger si consuma quando lo scadenzario del momento non è eleggibile:
    // una cancellazione successiva dei pagamenti non deve far ricomparire le rate.
    if (
      pagamenti.length > 0 ||
      pagamentiLocali.length > 0 ||
      pagamentiSospesiLocalmente.size > 0
    ) {
      applicaRateDefaultAlProdottoRef.current = false;
      return;
    }

    const accontoC = Math.min(
      accontoTocco.current
        ? centsDi(acconto)
        : accontoSuggeritoCents ?? centsDi(acconto),
      totale
    );
    const saldoC = totale - accontoC;
    if (saldoC <= 0) {
      applicaRateDefaultAlProdottoRef.current = false;
      return;
    }

    const contoTipo = (conti.find((c) => c.id === contoSaldoResolved)?.data.tipo as string) || "";
    const inizio = aggiungiGiorniRate(dataLocaleOggi(), offsetSpedizione(contoTipo));
    const rate = calcolaRate(saldoC, numeroRateSaldoDefault, inizio);
    const timestamp = Date.now();
    const locali: Pagamento[] = [];

    if (accontoC > 0) {
      locali.push({
        id: `__local_pagamento__acconto-default-${timestamp}`,
        ordineId,
        tipo: "acconto",
        importo: accontoC,
        saldato: false,
        scadenza: data,
        ...campiContoLocale(conti, contoAccontoResolved),
        ...CAMPI_PAGAMENTO_LOCALE,
        scadDaSpedizione: false,
        scadRelGiorni: 0,
      });
    }

    for (let i = 0; i < rate.length; i += 1) {
      const rata = rate[i];
      locali.push({
        id: `__local_pagamento__rata-default-${timestamp}-${i}`,
        ordineId,
        tipo: "rata",
        importo: rata.importo,
        saldato: false,
        scadenza: rata.scadenza,
        ...campiContoLocale(conti, contoSaldoResolved),
        ...CAMPI_PAGAMENTO_LOCALE,
        scadDaSpedizione: true,
        scadRelGiorni: giorniTra(inizio, rata.scadenza),
      });
    }
    applicaRateDefaultAlProdottoRef.current = false;
    setPagamentiLocali(locali);
  }, [
    acconto,
    accontoSuggeritoCents,
    caricamento,
    categoria,
    contoAccontoResolved,
    contoSaldoResolved,
    conti,
    data,
    numProdotti,
    numeroRateSaldoDefault,
    ordineId,
    pagamenti.length,
    pagamentiLocali.length,
    pagamentiSospesiLocalmente.size,
    totale,
  ]);

  // Righe dello scadenzario da mostrare: bozze (nuovo) o preview dei pagamenti reali (esistente).
  const nomeConto = (id: string) => (conti.find((c) => c.id === id)?.data.nome as string) || "";
  const righeScad = (
    ordineId
      ? pagamentiPreview.map((p) => ({
          key: p.id,
          tipo: p.tipo,
          importo: p.importo,
          saldato: p.saldato,
          scadenza: p.scadenza,
          data: p.data,
          verificato: p.verificato,
          contoNome: p.contoNome,
          contoId: p.contoId,
          contoTipo: p.contoTipo,
          scadDaSpedizione: p.scadDaSpedizione,
          scadRelGiorni: p.scadRelGiorni,
          bozza: pagamentoPreviewLocale(p),
          pagamento: pagamentoPreviewLocale(p) ? null : p,
        }))
      : bozze.map((b) => ({
          key: b.key,
          tipo: b.tipo,
          importo: b.importo,
          saldato: b.saldato,
          scadenza: b.scadenza,
          data: b.data,
          verificato: b.verificato,
          contoNome: nomeConto(b.contoId),
          contoId: b.contoId,
          contoTipo: ((conti.find((c) => c.id === b.contoId)?.data.tipo as string) || ""),
          scadDaSpedizione: b.scadDaSpedizione,
          scadRelGiorni: b.scadRelGiorni,
          bozza: true as const,
          pagamento: null,
        }))
  ).sort(confrontaRigheScadenzario);
  const saldoAttesoCorrente = ordineId
    ? saldoAtteso
    : bozze.filter((b) => !b.saldato && b.tipo !== "acconto").reduce((s, b) => s + b.importo, 0);
  // "Rateizza saldo" lavora solo su saldo/rate attesi: l'acconto, anche se atteso,
  // resta una voce separata e non deve finire nel piano rate.
  const importoRateizzabile = Math.max(0, saldoAttesoCorrente);

  const firmaFormCorrente = JSON.stringify({
    categoria,
    data,
    medicoId,
    agenteId,
    clienteId,
    stato,
    marcatore,
    note,
    motivoRifiuto,
    acconto,
    righe,
    omaggio,
    fattDiversa,
    fatt,
    codTutto,
    accontoIncassato,
    accontoData,
    bozze,
    pagamenti: firmaScadenzario(pagamenti),
    pagamentiLocali: firmaScadenzario(pagamentiLocali),
    pagamentiSospesiLocalmente: [...pagamentiSospesiLocalmente].sort(),
    patchPagamentiVirtuali,
  });
  const [firmaFormIniziale, setFirmaFormIniziale] = useState("");
  const formModificato =
    !caricamento && firmaFormIniziale !== "" && firmaFormCorrente !== firmaFormIniziale;
  formModificatoRef.current = formModificato;

  // Aspetta che gli effetti di inizializzazione abbiano stabilizzato valori automatici e bozze.
  useEffect(() => {
    if (caricamento || firmaFormIniziale) return;
    const timer = window.setTimeout(() => setFirmaFormIniziale(firmaFormCorrente), 0);
    return () => window.clearTimeout(timer);
  }, [caricamento, firmaFormCorrente, firmaFormIniziale]);

  // Un refresh remoto su un form prima pulito non deve essere scambiato per lavoro
  // locale non salvato. Se invece l'utente aveva già modificato qualcosa, la firma
  // iniziale resta invariata e l'avviso di chiusura continua a proteggerlo.
  useEffect(() => {
    if (caricamento || !riallineaFirmaDopoRealtimeRef.current) return;
    riallineaFirmaDopoRealtimeRef.current = false;
    setFirmaFormIniziale(firmaFormCorrente);
  }, [caricamento, firmaFormCorrente]);

  useEffect(() => {
    onDirtyChange?.(formModificato);
    return () => onDirtyChange?.(false);
  }, [formModificato, onDirtyChange]);

  // Nel solo nuovo ordine il selettore nel titolo può cambiare linea finché la
  // bozza è vuota. Ricreiamo l'unica riga vuota con i default della nuova linea
  // (es. PRICK TEST per Diagnostica) e ristabiliamo la baseline non modificata.
  useEffect(() => {
    if (ordineId || !categoriaProp || categoriaProp === categoria) return;
    setCategoria(categoriaProp);
    setRighe([nuovaRiga(categoriaProp === "Diagnostica")]);
    accontoTocco.current = false;
    setAcconto("");
    setAccontoIncassato(false);
    setCodTutto(false);
    setBozze([]);
    setPagamentiLocali([]);
    setPagamentiSospesiLocalmente(new Set());
    setFirmaFormIniziale("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriaProp, ordineId]);

  // Data dell'acconto, per la rateizzazione «fissa» (acconto + 30gg) quando si toglie la
  // spunta «dopo la spedizione». Ordine salvato: dal pagamento acconto; nuovo: incasso o data.
  const accontoDataEff = useMemo(() => {
    if (ordineId) {
      const a = pagamentiPreview.find((p) => p.tipo === "acconto");
      return a?.data || a?.scadenza || data;
    }
    return accontoIncassato ? accontoData : data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordineId, pagamentiPreview, accontoIncassato, accontoData, data]);

  function apriRateizzazione(
    importo: number,
    modalita: NonNullable<RateizzaTarget["modalita"]> = "sostituisci"
  ) {
    const pianoSalvato = ordineId
      ? [...pagamentiPreview].filter(pagamentoApertoSaldoRata).sort(confrontaPagamentiAperti)
      : [];
    const pianoBozza = !ordineId
      ? bozze
          .filter((b) => !b.saldato && (b.tipo === "saldo" || b.tipo === "rata"))
          .sort((a, b) => confrontaRigheScadenzario(a, b))
      : [];
    const corrente = ordineId
      ? pianoSalvato[0]
      : undefined;
    const correnteBozza = !ordineId
      ? pianoBozza[0]
      : undefined;
    const contoBozza = correnteBozza
      ? conti.find((c) => c.id === correnteBozza.contoId)
      : undefined;
    const contoTipo = corrente
      ? corrente.contoTipo
      : (contoBozza?.data.tipo as string) || "";
    const contoRateSuccessiveTipo =
      ((conti.find((c) => c.id === contoSaldoResolved)?.data.tipo as string) || "");
    const numeroRateIniziale =
      modalita === "sostituisci"
        ? (ordineId ? pianoSalvato : pianoBozza).filter((r) => r.tipo === "rata").length || undefined
        : undefined;

    setRateizzaTarget({
      ordineId: ordineId ?? undefined,
      numero: numero ?? undefined,
      modalita,
      importo,
      rimandaRiallineamento: scadenzarioInBozza,
      accontoData: accontoDataEff,
      contoTipo,
      contoRateSuccessiveTipo,
      numeroRateIniziale,
    });
  }

  function creaNuovaBozzaPerResto(
    totale: number,
    coperto: number,
    ultima: VoceCopertura | null | undefined,
    contoSaldoResolved: string,
    data: string,
    bozze: Bozza[]
  ): Bozza {
    const diff = totale - coperto;
    const ultimaBozza = ultima ? bozze.find((b) => b.key === ultima.id) : undefined;
    const contoId = ultimaBozza?.contoId || contoSaldoResolved;
    const tipo = ultimaBozza?.tipo === "acconto" ? "saldo" : "rata";
    const scadDaSpedizione = true;
    const baseScadenza = ultima?.scadenza || data;
    const nuovaScadenza = aggiungiGiorni(baseScadenza, 30);
    const bozzeSpediz = bozze.filter((b) => b.scadDaSpedizione && (b.tipo === "saldo" || b.tipo === "rata"));
    const scadRelGiorni = bozzeSpediz.length * 30;

    return {
      key: `__bozza_resto-${Date.now()}`,
      tipo,
      importo: diff,
      saldato: false,
      scadenza: scadDaSpedizione ? "" : nuovaScadenza,
      contoId,
      scadDaSpedizione,
      scadRelGiorni,
      data: "",
      verificato: false,
    };
  }

  function creaNuovaRataPerResto(
    ordineId: string | null,
    totale: number,
    coperto: number,
    ultima: VoceCopertura | null | undefined,
    contoSaldoResolved: string,
    data: string,
    pagamenti: Pagamento[]
  ): Pagamento {
    const diff = totale - coperto;
    const ultimoReal = ultima ? pagamenti.find((p) => p.id === ultima.id) : undefined;
    const contoId = ultimoReal?.contoId || contoSaldoResolved;
    const tipo = ultimoReal?.tipo === "acconto" ? "saldo" : "rata";
    const scadDaSpedizione = true;
    const baseScadenza = ultima?.scadenza || data;
    const nuovaScadenza = aggiungiGiorni(baseScadenza, 30);
    const pagSpediz = pagamenti.filter((p) => p.scadDaSpedizione && (p.tipo === "saldo" || p.tipo === "rata"));
    const scadRelGiorni = pagSpediz.length * 30;

    return {
      id: `__local_pagamento__resto-${Date.now()}`,
      ordineId: ordineId || "",
      tipo,
      importo: diff,
      saldato: false,
      scadenza: scadDaSpedizione ? "" : nuovaScadenza,
      ...campiContoLocale(conti, contoId),
      ...CAMPI_PAGAMENTO_LOCALE,
      scadDaSpedizione,
      scadRelGiorni,
    };
  }

  async function preparaCoperturaBozze(): Promise<{ bozze: Bozza[]; righe?: RigaForm[] } | null> {
    const voci: VoceCopertura[] = bozze.map((b) => ({
      id: b.key,
      tipo: b.tipo,
      importo: b.importo,
      saldato: b.saldato,
      scadenza: b.scadenza,
    }));
    const coperto = importoCoperto(voci);
    if (!deveMostrareAdeguamentoImporto({ totale, coperto })) return { bozze };
    const ultima = ultimaRataAperta(voci);
    const scelta = await chiediCoperturaScadenzario({ totale, coperto, puoDilazionare: !!ultima });
    if (scelta === null) return null;
    if (scelta === "ignora") {
      const diff = totale - coperto;
      if (diff > 0) {
        const nuovaBozza = creaNuovaBozzaPerResto(totale, coperto, ultima, contoSaldoResolved, data, bozze);
        return { bozze: [...bozze, nuovaBozza] };
      }
      return { bozze };
    }
    if (coperto > totale) {
      if (scelta === "dilaziona" && ultima) {
        return { bozze: riallineaVociAperteLocali(bozze, totale) };
      }
      return { bozze, righe: adeguaRigheFormATotale(righe, coperto) };
    }
    if (scelta === "dilaziona" && ultima) {
      const diff = totale - coperto;
      return { bozze: bozze.map((b) => (b.key === ultima.id ? { ...b, importo: b.importo + diff } : b)) };
    }
    return { bozze, righe: riduciRigheForm(righe, coperto) };
  }

  async function preparaCoperturaEsistente(
    localiAttuali: Pagamento[],
    sospesiAttuali: Set<string>
  ): Promise<{
    righe?: RigaForm[];
    pagamentiLocali?: Pagamento[];
    pagamentiSospesiLocalmente?: Set<string>;
    saltaRiallineamento?: boolean;
    forzaRiallineamento?: boolean;
    rimborsoDaAdeguare?: { id: string; importo: number };
  } | null> {
    const voci: VoceCopertura[] = pagamentiPreview.map((p) => ({
      id: p.id,
      tipo: p.tipo,
      importo: p.importo,
      saldato: p.saldato,
      scadenza: p.scadenza,
    }));
    const coperto = importoCoperto(voci);
    // Il cambio prezzo riallinea prima, in modo sicuro, solo saldo/rate ancora
    // aperti. Il modale resta obbligatorio se dopo l'automazione permane una
    // discrepanza; a totale zero si conserva il flusso automatico storico.
    if (totale <= 0 || !deveMostrareAdeguamentoImporto({ totale, coperto })) return {};
    const ultima = ultimaRataAperta(voci);
    const ordineIdAttuale = ordineId;
    if (!ordineIdAttuale) return {};
    // Rileggiamo qui i rimborsi: subito dopo la creazione il relativo setState può
    // non essere ancora arrivato, mentre il salvataggio deve già riconoscere l'extra
    // coperto e comportarsi come «Lascia così».
    const riepilogoRimborsi = await api
      .rimborsiLista()
      .then((rimborsi) => riepilogaRimborsiExtraOrdine(rimborsi, ordineIdAttuale))
      .catch(() => ({
        esistente: rimborsoEsistente,
        richiesto: rimborsoRichiesto,
        importoEffettuato: rimborsiEffettuati,
      }));
    const rimborsoRichiestoAttuale = riepilogoRimborsi.richiesto;
    const rimborsiEffettuatiAttuali = riepilogoRimborsi.importoEffettuato;
    const importoRimborsoRichiestoDopo = Math.max(
      0,
      eccedenzaInBozza - rimborsiEffettuatiAttuali
    );
    if (
      rimborsoCopreEccedenzaScadenzario({
        totale,
        coperto,
        eccedenza: eccedenzaInBozza,
        rimborsoRichiesto: rimborsoRichiestoAttuale?.importo ?? 0,
        rimborsiEffettuati: rimborsiEffettuatiAttuali,
      })
    ) {
      return { saltaRiallineamento: true };
    }
    const rimborsoDaAdeguare =
      rimborsoRichiestoAttuale &&
      localiAttuali.length === 0 &&
      sospesiAttuali.size === 0 &&
      !pagamentoDraft &&
      importoRimborsoRichiestoDopo > 0 &&
      rimborsoRichiestoAttuale.importo !== importoRimborsoRichiestoDopo
        ? {
            importoAttuale: rimborsoRichiestoAttuale.importo,
            importoDopo: importoRimborsoRichiestoDopo,
          }
        : undefined;
    const scelta = await chiediCoperturaScadenzario({
      totale,
      coperto,
      puoDilazionare: !!ultima,
      rimborsoDaAdeguare,
    });
    if (scelta === null) return null;

    function dilazionaUltimaRata(
      rata: NonNullable<typeof ultima>,
      nuovoImporto: number,
    ) {
      const nextSospesi = new Set(sospesiAttuali);
      let nextLocali = [...localiAttuali];
      const isLocale = localiAttuali.some((pagamento) => pagamento.id === rata.id);
      if (isLocale) {
        nextLocali = nextLocali.map((pagamento) =>
          pagamento.id === rata.id
            ? {
                ...pagamento,
                importo: nuovoImporto,
                scadDaSpedizione: pagamento.scadDaSpedizione ?? true,
                scadenza: (pagamento.scadDaSpedizione ?? true) && !pagamento.saldato ? "" : pagamento.scadenza,
              }
            : pagamento
        );
      } else {
        nextSospesi.add(rata.id);
        const pagamentoReale = pagamenti.find((pagamento) => pagamento.id === rata.id);
        const daSped = pagamentoReale ? (pagamentoReale.scadDaSpedizione ?? true) : true;
        nextLocali.push({
          id: `__local_pagamento__adegua-${Date.now()}`,
          ordineId: ordineId!,
          tipo: rata.tipo,
          importo: nuovoImporto,
          saldato: rata.saldato,
          scadenza: daSped && !rata.saldato ? "" : (rata.scadenza || ""),
          contoId: pagamentoReale?.contoId || "",
          contoNome: pagamentoReale?.contoNome || "",
          contoTipo: pagamentoReale?.contoTipo || "",
          ...CAMPI_PAGAMENTO_LOCALE,
          note: pagamentoReale?.note || "",
          scadDaSpedizione: daSped,
          scadRelGiorni: pagamentoReale?.scadRelGiorni ?? 0,
        });
      }
      return { pagamentiLocali: nextLocali, pagamentiSospesiLocalmente: nextSospesi };
    }

    if (scelta === "rimborso" && rimborsoRichiestoAttuale && rimborsoDaAdeguare) {
      return {
        saltaRiallineamento: true,
        rimborsoDaAdeguare: {
          id: rimborsoRichiestoAttuale.id,
          importo: importoRimborsoRichiestoDopo,
        },
      };
    }
    if (scelta === "ignora") {
      const diff = totale - coperto;
      if (diff > 0) {
        const nuovaRata = creaNuovaRataPerResto(
          ordineId,
          totale,
          coperto,
          ultima,
          contoSaldoResolved,
          data,
          pagamentiPreview
        );
        const nextLocali = [...localiAttuali, nuovaRata];
        return { pagamentiLocali: nextLocali };
      }
      return { saltaRiallineamento: true };
    }
    if (coperto > totale) {
      if (scelta === "dilaziona" && ultima) {
        const diff = coperto - totale;
        const nuovoImporto = ultima.importo - diff;
        // Se l'ultima rata da sola non può assorbire la riduzione, il backend
        // applicherà il riallineamento proporzionale a tutte le rate aperte.
        // Creare qui una sostituzione negativa renderebbe invalido il libro mastro.
        if (nuovoImporto <= 0) return { forzaRiallineamento: true };
        return dilazionaUltimaRata(ultima, nuovoImporto);
      }
      return { righe: adeguaRigheFormATotale(righe, coperto) };
    }
    if (coperto < totale) {
      if (scelta === "dilaziona" && ultima) {
        const diff = totale - coperto;
        const nuovoImporto = ultima.importo + diff;
        return dilazionaUltimaRata(ultima, nuovoImporto);
      }
      return { righe: riduciRigheForm(righe, coperto) };
    }
    return {};
  }

  // Nomi suggeriti nel campo prodotto = catalogo della categoria dell'ordine. Il campo
  // resta a testo libero: si può scrivere un prodotto non in lista (resta «non
  // categorizzato», senza listino, ma conta nel totale e nelle provvigioni dell'ordine).
  const nomiProdotti = useMemo(
    () =>
      prodotti
        .filter((p) => (p.data.categoria as string) === categoria)
        .map((p) => (p.data.nome as string) || "")
        .filter(Boolean),
    [prodotti, categoria]
  );

  // Diagnostica: il cliente è il medico stesso → niente cliente separato.
  const isDiag = categoria === "Diagnostica";
  // Per la Diagnostica i "prodotti" sono allergeni → nelle etichette scriviamo «Allergene».
  // Per l'Immunoterapia il prodotto è la **preparazione** (tipo × fiale, es. «Polimerizzato 2
  // fiale»): si sceglie dal listino, mentre gli allergeni/ceppi si inseriscono in produzione.
  const isAllergene = isDiag;
  const coloreCategoria = categoriaDef(categoria).color;
  const prodottoAttentionStyle = useMemo(
    () =>
      ({
        "--pt-product-attention": `var(--mantine-color-${coloreCategoria}-5)`,
        "--pt-product-attention-soft": `var(--mantine-color-${coloreCategoria}-0)`,
      }) as CSSProperties,
    [coloreCategoria]
  );

  // Suggerimenti Diagnostica (FASE 5D): allergeni e tipi-test già usati (storico locale),
  // con quelli del medico/azienda selezionato in cima. Caricati pigramente solo per la
  // Diagnostica; nessuna entità sincronizzata (resta "personale").
  const [diagRighe, setDiagRighe] = useState<RecordDto[]>([]);
  const [diagOrdini, setDiagOrdini] = useState<RecordDto[]>([]);
  useEffect(() => {
    if (!isDiag || diagRighe.length > 0) return;
    Promise.all([api.recordsList("riga_ordine"), api.recordsList("ordine")])
      .then(([rg, ord]) => {
        setDiagRighe(rg);
        setDiagOrdini(ord);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDiag]);
  const diagSugg = useMemo(() => {
    const ids = new Set(
      diagOrdini.filter((o) => (o.data.medico_id as string) === medicoId).map((o) => o.id)
    );
    return suggerimentiDiagnostica(diagRighe, ids);
  }, [diagRighe, diagOrdini, medicoId]);
  const nomiAllergeni = useMemo(
    () => [...new Set([...nomiProdotti, ...diagSugg.allergeni])],
    [nomiProdotti, diagSugg]
  );

  // Dati di produzione opzionali nell'ordine Immunoterapia (FASE 7): si possono precompilare
  // qui formulazione/posologia/allergeni — la pagina Produzione li riprende così com'è già la
  // sua auto-compilazione. Suggerimenti = catalogo `prodotto_produzione` + storico righe,
  // STESSA logica della pagina Produzione (`suggerimentiProduzione`). Caricati pigramente
  // solo per l'Immunoterapia, una volta sola.
  const isImmuno = categoria === "Immunoterapia";
  const [prodProdCat, setProdProdCat] = useState<RecordDto[]>([]);
  const [tutteRighe, setTutteRighe] = useState<RecordDto[]>([]);
  const [tuttiOrdini, setTuttiOrdini] = useState<RecordDto[]>([]);
  const [prodCaricato, setProdCaricato] = useState(false);
  const mantenimentiAutoRef = useRef(false);
  useEffect(() => {
    if (!isImmuno || prodCaricato) return;
    Promise.all([api.recordsList("prodotto_produzione"), api.recordsList("riga_ordine"), api.recordsList("ordine")])
      .then(([cat, rg, ord]) => {
        setProdProdCat(cat);
        setTutteRighe(rg);
        setTuttiOrdini(ord);
        setProdCaricato(true);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImmuno]);
  const suggProd = useMemo<Suggerimenti>(
    () => suggerimentiProduzione(prodProdCat, tutteRighe),
    [prodProdCat, tutteRighe]
  );
  const nomeProdottoById = useMemo(
    () => new Map(prodotti.map((p) => [p.id, ((p.data.nome as string) || "").trim()])),
    [prodotti]
  );
  // Righe dell'ordine con il pannello «dati di produzione» aperto (chiave riga).
  const [datiProdAperti, setDatiProdAperti] = useState<Set<string>>(new Set());
  const toggleDatiProd = (key: string) =>
    setDatiProdAperti((correnti) => setConToggle(correnti, key));
  useEffect(() => {
    if (focus?.sezione !== "prodotti" || caricamento || focusProdottiGestito.current) return;
    focusProdottiGestito.current = true;
    setDatiProdAperti(new Set(righe.map((r) => r.key)));
    const scrollId = window.setTimeout(() => {
      prodottiRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setEvidenziaProdotti(true);
      toast.info("Inserisci prima il prodotto mancante; puoi compilare qui anche i dati di produzione.");
      const input = prodottiRef.current?.querySelector<HTMLInputElement>('[data-pt-field="prodotto"] input');
      input?.focus();
      window.setTimeout(() => prodottiRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }, 140);
    const glowId = window.setTimeout(() => setEvidenziaProdotti(false), 3000);
    return () => {
      window.clearTimeout(scrollId);
      window.clearTimeout(glowId);
    };
  }, [focus?.sezione, caricamento, righe]);
  // Opzioni per i select referenziati della modale medico (agente, conto).
  const medRif = useMemo(
    () => ({
      agente: agenti.map((a) => ({ value: a.id, label: (a.data.nome as string) || a.id })),
      conto: conti.map((c) => ({ value: c.id, label: (c.data.nome as string) || c.id })),
    }),
    [agenti, conti]
  );

  async function prezzoAutomaticoProdottoCents(prodottoId: string, targetMedicoId: string): Promise<number | null> {
    if (!prodottoId) return null;
    const sugg = await api.prezzoSuggerito(prodottoId, targetMedicoId || null);
    const med = medici.find((m) => m.id === targetMedicoId);
    const pim = categoria === "Immunoterapia" ? Number(med?.data.prezzo_immuno_default) || 0 : 0;
    if (pim > 0 && sugg.fonte === "default") return pim;
    return sugg.prezzo;
  }

  function prezzoRigaCents(r: RigaForm | undefined): number {
    if (!r) return 0;
    return centsDi(r.prezzo);
  }

  function segnaRichiestaPrezzo(key: string): number {
    const next = (richiestePrezzoRef.current.get(key) || 0) + 1;
    richiestePrezzoRef.current.set(key, next);
    return next;
  }

  async function proponiPrezzoRiga(
    key: string,
    prodottoId: string,
    targetMedicoId: string,
    opts: { soloSeVuoto?: boolean; sovrascrivi?: boolean } = {}
  ) {
    if (omaggio) return;
    const token = segnaRichiestaPrezzo(key);
    try {
      const prezzo = await prezzoAutomaticoProdottoCents(prodottoId, targetMedicoId);
      if (prezzo === null || richiestePrezzoRef.current.get(key) !== token) return;
      setRighe((rs) =>
        rs.map((r) => {
          if (r.key !== key || r.prodottoId !== prodottoId) return r;
          return applicaPrezzoAutomaticoRiga(r, prezzo, opts);
        })
      );
    } catch {
      /* il prezzo resta modificabile a mano */
    }
  }

  async function proponiPrezzoDopoCambioProdotto(
    key: string,
    vecchioProdottoId: string,
    nuovoProdottoId: string,
    targetMedicoId: string
  ) {
    if (omaggio) return;
    const token = segnaRichiestaPrezzo(key);
    try {
      const [vecchio, nuovo] = await Promise.all([
        vecchioProdottoId ? prezzoAutomaticoProdottoCents(vecchioProdottoId, targetMedicoId) : Promise.resolve(null),
        prezzoAutomaticoProdottoCents(nuovoProdottoId, targetMedicoId),
      ]);
      if (nuovo === null || richiestePrezzoRef.current.get(key) !== token) return;
      setRighe((rs) =>
        rs.map((r) => {
          if (r.key !== key || r.prodottoId !== nuovoProdottoId) return r;
          return applicaPrezzoAutomaticoRiga(r, nuovo, { prezzoPrecedente: vecchio });
        })
      );
    } catch {
      /* il prezzo resta modificabile a mano */
    }
  }

  function ricalcolaPrezziRighe(newMedicoId: string, oldMedicoId: string) {
    if (omaggio) return;
    const righeConProdotto = righe.filter((r) => r.prodottoId);
    if (righeConProdotto.length === 0) return;
    Promise.all(
      righeConProdotto.map(async (r) => {
        const token = segnaRichiestaPrezzo(r.key);
        try {
          const [vecchio, nuovo] = await Promise.all([
            oldMedicoId ? prezzoAutomaticoProdottoCents(r.prodottoId, oldMedicoId) : Promise.resolve(null),
            prezzoAutomaticoProdottoCents(r.prodottoId, newMedicoId),
          ]);
          return { key: r.key, prodottoId: r.prodottoId, token, vecchio, nuovo };
        } catch {
          return { key: r.key, prodottoId: r.prodottoId, token, vecchio: null, nuovo: null };
        }
      })
    )
      .then((risultati) => {
        setRighe((rs) =>
          rs.map((r) => {
            const ris = risultati.find((res) => res.key === r.key);
            if (!ris || richiestePrezzoRef.current.get(r.key) !== ris.token || r.prodottoId !== ris.prodottoId || ris.nuovo === null) {
              return r;
            }
            return applicaPrezzoAutomaticoRiga(r, ris.nuovo, { prezzoPrecedente: ris.vecchio });
          })
        );
      })
      .catch(() => {});
  }

  function scegliMedico(id: string) {
    const oldMedicoId = medicoId;
    setMedicoId(id);
    const med = medici.find((m) => m.id === id);
    setAgenteId((med?.data.agente_id as string) || "");

    ricalcolaPrezziRighe(id, oldMedicoId);

    // Immunoterapia: il prezzo è di fatto per-medico. Propongo il suo «prezzo standard
    // immunoterapia» sulle righe ancora senza prezzo (senza sovrascrivere quanto digitato).
    if (!omaggio && categoria === "Immunoterapia") {
      const pim = Number(med?.data.prezzo_immuno_default) || 0;
      if (pim > 0) {
        setRighe((rs) => rs.map((r) => (r.prezzo === "" || r.prezzo === 0 ? { ...r, prezzo: pim / 100 } : r)));
      }
    }
  }

  function scegliCliente(id: string) {
    setClienteId(id);
    // Ogni cliente ricorda l'ultimo medico usato: auto-compila medico (→ agente).
    const ultimo = ultimoMedicoClienteValido(id, clienti, medici);
    if (ultimo) scegliMedico(ultimo);
    setRighe((rs) => rs.map((r) => applicaMantenimentoSeVuoto(r, id)));
  }

  /** Match esatto (case-insensitive) del testo su un prodotto di catalogo. */
  function prodottoDaNome(nome: string): RecordDto | undefined {
    const n = nome.trim().toLowerCase();
    return n ? prodotti.find((p) => ((p.data.nome as string) || "").toLowerCase() === n) : undefined;
  }

  const normalizzaTesto = (valore: string) => valore.trim().toLowerCase();

  function applicaMantenimentoSeVuoto(r: RigaForm, clienteTarget = clienteId): RigaForm {
    return precompilaMantenimentoRiga(r, {
      attivo: isImmuno,
      clienteId: clienteTarget,
      ordineId,
      ordini: tuttiOrdini,
      righe: tutteRighe,
      nomiProdotti: nomeProdottoById,
    });
  }

  useEffect(() => {
    if (ordineId || !isImmuno || !prodCaricato || !clienteId || mantenimentiAutoRef.current) return;
    setRighe((rs) => {
      let cambiato = false;
      const next = rs.map((r) => {
        if (!r.prodottoId && !r.prodottoNome.trim()) return r;
        const aggiornata = applicaMantenimentoSeVuoto(r);
        if (aggiornata !== r) cambiato = true;
        return aggiornata;
      });
      if (cambiato) mantenimentiAutoRef.current = true;
      return cambiato ? next : rs;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordineId, isImmuno, prodCaricato, clienteId]);

  /** Patch parziale di una riga prodotto (per i campi dati-produzione e simili). */
  function aggiornaRiga(key: string, patch: Partial<RigaForm>) {
    setRighe((rs) =>
      rs.map((r) =>
        r.key === key
          ? { ...r, ...patch, ...(omaggio && "prezzo" in patch ? { prezzo: 0 } : {}) }
          : r
      )
    );
  }

  function cambiaOmaggio(attivo: boolean) {
    setOmaggio(attivo);
    if (!attivo) return;
    for (const riga of righe) segnaRichiestaPrezzo(riga.key);
    setRighe(azzeraPrezziRigheForm);
    accontoTocco.current = false;
    setAcconto("");
    setCodTutto(false);
  }

  // Digitazione nel campo prodotto: aggiorna il testo e risolve il prodotto di catalogo
  // se il nome combacia, altrimenti resta libero (prodottoId vuoto). Se il match di
  // catalogo arriva digitando a mano, proponiamo il listino solo su prezzo ancora vuoto.
  function digitaProdotto(key: string, nome: string) {
    const prodottoId = prodottoDaNome(nome)?.id ?? "";
    const precedente = righe.find((r) => r.key === key);
    setRighe((rs) => rs.map((r) => (r.key === key ? { ...r, prodottoNome: nome, prodottoId } : r)));
    if (prodottoId && precedente?.prodottoId !== prodottoId && prezzoRigaCents(precedente) <= 0) {
      void proponiPrezzoRiga(key, prodottoId, medicoId, { soloSeVuoto: true });
    }
  }

  // Scelta esplicita dall'elenco: imposta il prodotto e propone il prezzo di listino.
  // Non riscrive una riga gia' prezzata se l'utente ha solo riconfermato lo stesso prodotto.
  async function scegliProdotto(key: string, nome: string) {
    const prod = prodottoDaNome(nome);
    const prodottoId = prod?.id ?? "";
    const precedente = righe.find((r) => r.key === key);
    const prodottoCambiato = precedente?.prodottoId !== prodottoId || normalizzaTesto(precedente?.prodottoNome || "") !== normalizzaTesto(nome);
    // Diagnostica: precompila il codice Laboratorio del catalogo (solo se il campo è vuoto).
    const codiceCat = isDiag ? (prod?.data.codice_laboratorio as string) || "" : "";
    setRighe((rs) =>
      rs.map((r) =>
        r.key === key
          ? applicaMantenimentoSeVuoto({ ...r, prodottoNome: nome, prodottoId, codice: r.codice || codiceCat })
          : r
      )
    );
    if (!prodottoId) return; // prodotto libero: prezzo a mano
    const prezzoVuoto = !precedente || prezzoRigaCents(precedente) <= 0;
    if (prezzoVuoto) {
      void proponiPrezzoRiga(key, prodottoId, medicoId, { sovrascrivi: true });
    } else if (prodottoCambiato && precedente?.prodottoId) {
      void proponiPrezzoDopoCambioProdotto(key, precedente.prodottoId, prodottoId, medicoId);
    }
  }

  function setAccontoManuale(v: number | "") {
    if (v === "") return setAcconto("");
    setAcconto(Math.min(Number(v), totale / 100)); // mai oltre il totale
  }

  /** Apre la modale cliente in MODIFICA: precompila i campi dal record selezionato. */
  function apriModificaCliente(id: string) {
    const rec = clienti.find((c) => c.id === id);
    if (!rec) return;
    setNuovoCliVal(valoriAnagrafica(CLIENTE_REG, rec));
    setNuovoCliErr({});
    setCliEditId(id);
    setNuovoCliApri(true);
  }

  /** Crea un nuovo cliente o salva le modifiche a quello in `cliEditId`. */
  async function creaCliente() {
    // Stessa validazione dell'anagrafica cliente (campi condivisi).
    const errs = validaCampi(CLIENTE_REG.campi, nuovoCliVal);
    if (Object.keys(errs).length > 0) {
      setNuovoCliErr(errs);
      return;
    }
    setCreandoCli(true);
    try {
      const fields = preparaCampiAnagraficaCompleti(CLIENTE_REG, nuovoCliVal);
      if (cliEditId) {
        await api.recordUpdate("cliente", cliEditId, fields);
        setClienti((cs) =>
          cs.map((c) => (c.id === cliEditId ? { ...c, data: { ...c.data, ...fields } } : c))
        );
        setNuovoCliApri(false);
        toast.success("Cliente aggiornato.");
      } else {
        const risultato = await salvaNuovoClienteConControllo(fields);
        if (!risultato) return;
        setClienti((correnti) => {
          const presente = correnti.some((cliente) => cliente.id === risultato.record.id);
          return presente
            ? correnti.map((cliente) =>
                cliente.id === risultato.record.id ? risultato.record : cliente,
              )
            : [...correnti, risultato.record];
        });
        setClienteId(risultato.record.id);
        setNuovoCliApri(false);
      }
    } catch (e) {
      toast.error(`Salvataggio cliente non riuscito: ${e}`);
    } finally {
      setCreandoCli(false);
    }
  }

  /** Apre la modale medico in MODIFICA: precompila i campi dal record selezionato. */
  function apriModificaMedico(id: string) {
    const rec = medici.find((m) => m.id === id);
    if (!rec) return;
    setNuovoMedVal(valoriAnagrafica(MEDICO_REG, rec));
    setNuovoMedErr({});
    setMedEditId(id);
    setNuovoMedApri(true);
  }

  /** Crea un nuovo medico o salva le modifiche a quello in `medEditId`. */
  async function creaMedico() {
    const errs = validaCampi(MEDICO_REG.campi, nuovoMedVal);
    if (Object.keys(errs).length > 0) {
      setNuovoMedErr(errs);
      return;
    }
    setCreandoMed(true);
    try {
      const fields = preparaCampiAnagraficaCompleti(MEDICO_REG, nuovoMedVal);
      if (medEditId) {
        await api.recordUpdate("medico", medEditId, fields);
        setMedici((ms) =>
          ms.map((m) => (m.id === medEditId ? { ...m, data: { ...m.data, ...fields } } : m))
        );
        // Se è il medico selezionato, riallinea l'agente derivato.
        if (medEditId === medicoId) setAgenteId((fields.agente_id as string) || "");
        setNuovoMedApri(false);
        toast.success("Medico aggiornato.");
      } else {
        const creato = await api.recordCreate("medico", fields);
        setMedici((ms) => [...ms, creato]);
        setMedicoId(creato.id);
        setAgenteId((creato.data.agente_id as string) || "");
        ricalcolaPrezziRighe(creato.id, medicoId);
        setNuovoMedApri(false);
        toast.success("Medico creato.");
      }
    } catch (e) {
      toast.error(`Salvataggio medico non riuscito: ${e}`);
    } finally {
      setCreandoMed(false);
    }
  }

  /** Apre/chiude «Dati di fatturazione diversi»: resta vuota finché l'utente non la compila.
   * Gli ordini già salvati con dati fattura la aprono automaticamente al caricamento. */
  /** Keriba: attiva/disattiva "salda tutto alla consegna" (contrassegno + 30gg). */
  function toggleCod() {
    toggleCodHook(setAcconto);
  }

  async function salva(
    stampaSchedaDopo = false,
    generaPreventivoDopo = false,
  ) {
    if (ordineId) {
      try {
        const corrente = await api.recordGet("ordine", ordineId);
        if (!corrente || corrente.deleted) {
          toast.warning("L'ordine è stato eliminato o annullato da un'altra postazione.");
          onClose();
          return;
        }
      } catch (e) {
        toast.error(`Controllo dell'ordine non riuscito: ${e}`);
        return;
      }
    }
    const campoAnagraficaMancante = isDiag ? (!medicoId ? "medico" : "") : !clienteId ? "cliente" : !medicoId ? "medico" : "";
    if (campoAnagraficaMancante) {
      toast.warning(isDiag ? "Serve il medico (è il destinatario)." : "Servono almeno il medico e il cliente.");
      focusInvalidField(`[data-pt-field="${campoAnagraficaMancante}"]`);
      return;
    }
    // Una riga vale se ha un prodotto (catalogo o testo libero). Una riga con prezzo o
    // paziente ma SENZA nome va bloccata: altrimenti sparirebbe al salvataggio lasciando
    // l'acconto (calcolato dal prezzo) su un ordine senza righe → totale e residuo 0€.
    const senzaNome = righe.filter(
      (r) => !r.prodottoId && !r.prodottoNome.trim() && (r.prezzo !== "" || r.paziente.trim() !== "")
    );
    if (senzaNome.length > 0) {
      toast.warning("Dai un nome al prodotto (scegline uno o scrivilo) per ogni riga compilata.");
      focusInvalidField(`[data-pt-row="${senzaNome[0].key}"] [data-pt-field="prodotto"]`);
      return;
    }

    const righeConProdotto = righe.filter((r) => r.prodottoId || r.prodottoNome.trim());
    if (righeConProdotto.length === 0) {
      const ok = await dialog.confirm(
        "Salvare l'ordine senza prodotti?",
        "L'ordine resterà generico e non avrà importi né scadenze. In Produzione potrai ritrovarlo con la ricerca e completarlo prima dell'invio.",
        { conferma: "Salva comunque", annulla: "Inserisci prodotto" }
      );
      if (!ok) {
        prodottiRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        setEvidenziaProdotti(true);
        window.setTimeout(() => setEvidenziaProdotti(false), 2400);
        return;
      }
    }

    // Prodotti liberi NUOVI (riga non ancora salvata, senza id): conferma esplicita prima
    // di crearli. Sono fuori catalogo → «non categorizzati», senza listino. Non si rinfaccia
    // sui prodotti liberi già salvati (hanno id): si avvisa solo al loro primo inserimento.
    const nuoviLiberi = righe.filter((r) => !r.id && !r.prodottoId && r.prodottoNome.trim());
    if (nuoviLiberi.length > 0) {
      const nomi = nuoviLiberi.map((r) => `«${r.prodottoNome.trim()}»`).join(", ");
      const uno = nuoviLiberi.length === 1;
      const ok = await dialog.confirm(
        uno ? "Prodotto non in catalogo" : "Prodotti non in catalogo",
        `${nomi} ${uno ? "non è presente" : "non sono presenti"} nel listino prodotti: ${
          uno ? "verrà salvato" : "verranno salvati"
        } come prodotto libero (non categorizzato, senza listino). Procedere?`,
        { conferma: "Salva comunque", annulla: "Torna indietro" }
      );
      if (!ok) return;
    }

    // Ordine rifiutato: al salvataggio si propone di RIPRISTINARLO. Se accetta torna attivo
    // come Nuovo (o Confermato se ha già un incasso saldato) e rientra nei conteggi; se
    // rifiuta resta rifiutato. (Lo srifiuto avviene solo da qui o dal menu del Giornaliero.)
    let statoFinale = stato;
    let ripristinato = false;
    if (statoIniziale === "Rifiutato") {
      const target = pagamenti.some((p) => p.saldato) ? "Confermato" : "Nuovo";
      const ok = await dialog.confirm(
        "Ripristinare l'ordine?",
        `Questo ordine è rifiutato. Vuoi ripristinarlo? Tornerà attivo come «${target}» e rientrerà nei conteggi (provvigioni, spedizioni, crediti).`,
        { conferma: `Ripristina come ${target}`, annulla: "Lascia rifiutato" }
      );
      if (ok) {
        statoFinale = target;
        ripristinato = true;
      }
    }

    const accontoCents = Math.min(centsDi(acconto), totale);
    const importiOrdineToccati = totaleSalvato === null || totale !== totaleSalvato;
    const coperturaScadenzarioSalvato = ordineId ? importoCoperto(pagamenti) : 0;
    const scadenzarioDaMaterializzare =
      !!ordineId &&
      totale > 0 &&
      coperturaScadenzarioSalvato < totale &&
      !pagamenti.some((p) => !p.saldato && pagamentoApertoSaldoRata(p));
    const scadenzarioDaSvuotare =
      !!ordineId &&
      totale === 0 &&
      pagamenti.some(pagamentoApertoDaSaldare);
    const deveRiconciliareScadenzario =
      importiOrdineToccati ||
      accontoCents !== accontoIniziale ||
      scadenzarioDaMaterializzare ||
      scadenzarioDaSvuotare ||
      pagamentiLocali.length > 0 ||
      pagamentiSospesiLocalmente.size > 0 ||
      Object.keys(patchPagamentiVirtuali).length > 0;
    let bozzeDaSalvare = bozze;
    let righeDaSalvare = righe;
    let totaleDopoSalvataggio = totale;
    let pagamentiLocaliDaSalvare = pagamentiLocali;
    let pagamentiSospesiDaSalvare = pagamentiSospesiLocalmente;
    let saltaRiallineamento = false;
    let forzaRiallineamento = false;
    let rimborsoDaAdeguare: { id: string; importo: number } | undefined;

    if (!ordineId) {
      const preparate = await preparaCoperturaBozze();
      if (!preparate) return;
      bozzeDaSalvare = preparate.bozze;
      righeDaSalvare = preparate.righe ?? righe;
      if (preparate.bozze !== bozze) setBozze(preparate.bozze);
      if (preparate.righe) setRighe(preparate.righe);
    } else {
      const preparate = await preparaCoperturaEsistente(pagamentiLocali, pagamentiSospesiLocalmente);
      if (!preparate) return;
      if (preparate.saltaRiallineamento) {
        saltaRiallineamento = true;
      }
      if (preparate.forzaRiallineamento) {
        forzaRiallineamento = true;
      }
      rimborsoDaAdeguare = preparate.rimborsoDaAdeguare;
      if (preparate.righe) {
        righeDaSalvare = preparate.righe;
        totaleDopoSalvataggio = importoCoperto(pagamentiPreview);
        setRighe(preparate.righe);
      }
      if (preparate.pagamentiLocali) {
        pagamentiLocaliDaSalvare = preparate.pagamentiLocali;
        setPagamentiLocali(preparate.pagamentiLocali);
      }
      if (preparate.pagamentiSospesiLocalmente) {
        pagamentiSospesiDaSalvare = preparate.pagamentiSospesiLocalmente;
        setPagamentiSospesiLocalmente(preparate.pagamentiSospesiLocalmente);
      }
    }

    setSalvando(true);
    try {
      let fields: Record<string, unknown> = {
        data,
        categoria,
        medico_id: medicoId,
        agente_id: agenteId,
        cliente_id: clienteId,
        stato: statoFinale,
        marcatore,
        note: note.trim(),
        acconto: accontoCents,
        omaggio,
        motivo_rifiuto: statoFinale === "Rifiutato" ? motivoRifiuto.trim() : "",
        fatt_ragione_sociale: fattDiversa ? fatt.ragione_sociale.trim() : "",
        fatt_indirizzo: fattDiversa ? fatt.indirizzo.trim() : "",
        fatt_citta: fattDiversa ? fatt.citta.trim() : "",
        fatt_prov: fattDiversa ? fatt.prov.trim() : "",
        fatt_cap: fattDiversa ? fatt.cap.trim() : "",
        fatt_piva: fattDiversa ? fatt.piva.trim().toUpperCase() : "",
      };
      // Sugli ordini esistenti inviamo soltanto i campi cambiati in questo form.
      // Se lo stesso campo è cambiato altrove, questo salvataggio è l'ultimo e vince;
      // tutti gli altri campi remoti restano intatti.
      const baselineOrdine = baselineOrdineRealtimeRef.current;
      if (ordineId && baselineOrdine) {
        const finali: CampiOrdineRealtime = {
          ...campiOrdineLocaliRef.current,
          stato: statoFinale,
          acconto: accontoCents,
          motivoRifiuto: statoFinale === "Rifiutato" ? motivoRifiuto : "",
        };
        const campoFormPerPersistenza: Record<string, string> = {
          data: "data",
          categoria: "categoria",
          medico_id: "medicoId",
          agente_id: "agenteId",
          cliente_id: "clienteId",
          stato: "stato",
          marcatore: "marcatore",
          note: "note",
          acconto: "acconto",
          omaggio: "omaggio",
          motivo_rifiuto: "motivoRifiuto",
          fatt_ragione_sociale: "fattRagioneSociale",
          fatt_indirizzo: "fattIndirizzo",
          fatt_citta: "fattCitta",
          fatt_prov: "fattProv",
          fatt_cap: "fattCap",
          fatt_piva: "fattPiva",
        };
        fields = Object.fromEntries(
          Object.entries(fields).filter(([campo]) => {
            const campoForm = campoFormPerPersistenza[campo];
            return JSON.stringify(finali[campoForm]) !== JSON.stringify(baselineOrdine[campoForm]);
          })
        );
      }
      // Srifiutato: pulisce anche i restanti campi del rifiuto.
      if (ripristinato) {
        fields.data_rifiuto = "";
        fields.stato_pre_rifiuto = "";
      }

      if (!ordineId) {
        fields.provvisorio = !navigator.onLine;
        fields.creato_da_device = identity.deviceId;
      }
      if (marcatore !== marcatoreIniziale) {
        // Persistito nello stesso batch del marcatore: il notificatore del PC
        // sorgente può escluderlo prima di produrre suono o popup.
        fields.marcatore_origine_device = marcatore ? identity.deviceId : "";
      }

      const valide = righeDaSalvare.filter((r) => r.prodottoId || r.prodottoNome.trim());
      const baselineRigheById = new Map(
        baselineRigheRealtimeRef.current.filter((r): r is RigaForm & { id: string } => !!r.id).map((r) => [r.id, r])
      );
      const righeInput = valide.map((r) => {
        const rf = campiPersistenzaRigaForm(r);
        const baselineRiga = r.id ? baselineRigheById.get(r.id) : undefined;
        if (!baselineRiga) return { id: r.id, fields: rf };
        const persistitaBaseline = campiPersistenzaRigaForm(baselineRiga);
        return {
          id: r.id,
          fields: Object.fromEntries(
            Object.entries(rf).filter(([campo, valore]) =>
              JSON.stringify(valore) !== JSON.stringify(persistitaBaseline[campo])
            )
          ),
        };
      });
      const salvataggioBase = await api.ordineSalvaBase({
        id: ordineId ?? undefined,
        rimborsoExtra: rimborsoDaAdeguare,
        expectedRighe: baselineRigheRealtimeRef.current
          .filter((riga): riga is RigaForm & { id: string } => !!riga.id)
          .map((riga) => ({ id: riga.id })),
        fields,
        righe: righeInput,
      });
      const id = salvataggioBase.id;

      for (const idSospeso of pagamentiSospesiDaSalvare) {
        const pag = pagamenti.find((p) => p.id === idSospeso);
        if (pag && !pag.saldato && !pag.verificato && pagamentoApertoSaldoRata(pag)) {
          await api.pagamentoElimina(idSospeso);
        }
      }

      const localiSpediz = pagamentiLocaliDaSalvare.filter((p) => p.scadDaSpedizione && (p.tipo === "saldo" || p.tipo === "rata"));
      for (const pLocale of pagamentiLocaliDaSalvare) {
        const pag = await api.pagamentoRegistra({
          ordineId: id!,
          tipo: pLocale.tipo,
          importo: pLocale.importo,
          saldato: pLocale.saldato,
          scadenza: pLocale.saldato || pLocale.scadDaSpedizione ? "" : pLocale.scadenza,
          contoId: pLocale.contoId,
          data: pLocale.saldato ? pLocale.data : "",
          verificato: pLocale.saldato ? pLocale.verificato : false,
          note: pLocale.note?.trim() || null,
        });
        if (pLocale.scadDaSpedizione && (pLocale.tipo === "saldo" || pLocale.tipo === "rata")) {
          const idxLoc = localiSpediz.indexOf(pLocale);
          const offsetBase = pagamenti.filter(
            (p) => !pagamentiSospesiDaSalvare.has(p.id) && p.scadDaSpedizione && (p.tipo === "saldo" || p.tipo === "rata")
          ).length;
          const relGiorni = calcolaScadRelGiorni(idxLoc, offsetBase, pLocale.scadRelGiorni);
          await api.recordUpdate("pagamento", pag.id, {
            scad_da_spedizione: true,
            scad_rel_giorni: relGiorni,
          });
        }
      }

      const haAccontoLocale = pagamentiLocaliDaSalvare.some((p) => p.tipo === "acconto");
      if (ordineId && accontoCents !== accontoIniziale && !haAccontoLocale) {
        // L'acconto previsto può cambiare, l'incasso storico no. Aggiorniamo quindi
        // soltanto l'eventuale voce ancora attesa; se l'acconto è già stato riscosso,
        // resta esattamente com'era e il residuo viene assorbito da saldo/rate.
        const haAccontoSaldato = pagamenti.some((p) => p.tipo === "acconto" && p.saldato);
        if (!haAccontoSaldato) {
          const accontoAtteso = pagamenti.find((p) => p.tipo === "acconto" && !p.saldato);
          if (accontoAtteso && accontoCents === 0) {
            await api.pagamentoElimina(accontoAtteso.id);
          } else if (accontoAtteso && accontoAtteso.importo !== accontoCents) {
            await api.recordUpdate("pagamento", accontoAtteso.id, { importo: accontoCents });
          } else if (!accontoAtteso && accontoCents > 0) {
            await api.pagamentoRegistra({
              ordineId: id!,
              tipo: "acconto",
              importo: accontoCents,
              saldato: false,
              scadenza: data,
              contoId: contoAccontoResolved,
            });
          }
        }
        setAccontoIniziale(accontoCents);
      }
      if (ordineId && haAccontoLocale) {
        setAccontoIniziale(accontoCents);
      }

      // Il cliente ricorda l'ultimo medico usato.
      if (clienteId && medicoId) {
        await api.recordUpdate("cliente", clienteId, { ultimo_medico_id: medicoId });
      }

      // Materializza lo scadenzario locale (acconto + saldo/rate) al PRIMO salvataggio.
      if (!ordineId) {
        await persistiBozze(id!, bozzeDaSalvare);
      }

      if (id) {
        let pagamentiAggiornati = !ordineId || ((deveRiconciliareScadenzario || forzaRiallineamento) && !saltaRiallineamento)
          ? await riallineaPagamentiAperti(id)
          : await api.pagamentiOrdine(id);
        const patchDaApplicare = Object.entries(patchPagamentiVirtuali);
        if (patchDaApplicare.length > 0) {
          await Promise.all(
            patchDaApplicare.map(([key, patch]) => {
              const tipo = key.endsWith("__acconto") ? "acconto" : "saldo";
              const pagamento = pagamentiAggiornati.find(
                (corrente) => corrente.tipo === tipo && !corrente.saldato,
              );
              if (!pagamento) return Promise.resolve();
              const fields: Record<string, unknown> = {};
              if (patch.contoId) fields.conto_id = patch.contoId;
              if (patch.scadenza !== undefined) fields.scadenza = patch.scadenza;
              if (patch.scadDaSpedizione !== undefined) {
                fields.scad_da_spedizione = patch.scadDaSpedizione;
                fields.scad_rel_giorni = 0;
                if (patch.scadDaSpedizione) fields.scadenza = "";
              }
              if (Object.keys(fields).length === 0) return Promise.resolve();
              return api.recordUpdate("pagamento", pagamento.id, fields);
            }),
          );
          pagamentiAggiornati = await api.pagamentiOrdine(id);
          setPatchPagamentiVirtuali({});
        }

        const apertiDaSpediz = pagamentiAggiornati
          .filter((p) => p.scadDaSpedizione && !p.saldato && (p.tipo === "saldo" || p.tipo === "rata"))
          .sort(confrontaPagamentiAperti);
        for (let idx = 0; idx < apertiDaSpediz.length; idx += 1) {
          const targetRel = idx * 30;
          if (apertiDaSpediz[idx].scadRelGiorni !== targetRel) {
            await api.recordUpdate("pagamento", apertiDaSpediz[idx].id, { scad_rel_giorni: targetRel });
            apertiDaSpediz[idx].scadRelGiorni = targetRel;
          }
        }

        if (ordineId) {
          setPagamenti(pagamentiAggiornati);
          setPagamentiLocali([]);
          setPagamentiSospesiLocalmente(new Set());
          setTotaleSalvato(totaleDopoSalvataggio);
        }
      }

      if (id && marcatore && marcatore !== marcatoreIniziale) {
        const notificaId = `marcatore:${id}`;
        await scarta(notificaId, identity).catch(() => {});
        const altriUtenti = await api
          .getUsers()
          .then((users) => users.map((u) => u.id).filter((uid) => uid && uid !== identity.userId))
          .catch(() => []);
        if (altriUtenti.length > 0) {
          await riattivaNotifichePerUtenti([notificaId], altriUtenti).catch(() => {});
        }
      }
      setMarcatoreIniziale(marcatore);
      toast.success(ordineId ? "Ordine salvato." : "Ordine creato.");
      if (inTauri) void api.notificheCheck().catch(() => {});
      if (generaPreventivoDopo && id) {
        await apriPreventivoCollegato(id, "editor");
      } else if (stampaSchedaDopo && id) {
        setSchedaCliente({
          ordineId: id,
          numero: numero ?? undefined,
          chiudiOrdineDopo: true,
        });
      } else {
        onSaved(id ?? undefined);
      }
    } catch (e) {
      const messaggio = String(e);
      toast.error(`Salvataggio non riuscito: ${messaggio}`);
    } finally {
      setSalvando(false);
    }
  }



  // Fetch-then-render: niente campi vuoti che si popolano "dopo". Finché i dati
  // (anagrafiche + ordine) non sono pronti mostriamo un loader; poi il form
  // compare già compilato (in finestra: niente flash prima dell'apertura).
  if (caricamento) {
    return (
      <Center style={{ minHeight: 320 }}>
        <Loader />
      </Center>
    );
  }

  const selettoreMedico = (diagnostica: boolean) => (
    <Box data-pt-field="medico">
      <SelectConNuovo
        label={diagnostica ? "Medico o azienda (cliente e destinatario)" : "Medico"}
        placeholder={diagnostica ? "Medico oppure ospedale/struttura…" : "Scegli…"}
        data={opzioni(medici)}
        value={medicoId}
        onChange={scegliMedico}
        entita={diagnostica ? "il medico/azienda" : "il medico"}
        withAsterisk
        onModifica={() => apriModificaMedico(medicoId)}
        modificaTitle="Modifica indirizzo e dati del medico"
        onNuovo={(nome) => { setNuovoMedVal({ ...valoriMedicoVuoti(), nome }); setNuovoMedErr({}); setMedEditId(null); setNuovoMedApri(true); }}
      />
    </Box>
  );

  return (
    <>
      <Box className="pt-modal-shell" style={{ position: "relative" }}>
        <OverlaySalvataggioFinestra visibile={!!dentroFinestra && salvando} />
        <Box className="pt-modal-scroll">
          <Stack gap="sm">
            {stato === "Rifiutato" && (
          <Alert color="red" title="ORDINE RIFIUTATO" icon={<IconAlertTriangle size={20} />} variant="light">
            <Text fw={700} size="sm" c="red.8">
              Motivo del rifiuto:
            </Text>
            <Text size="md" fw={500} mt={4}>
              {motivoRifiuto || "Nessun motivo specificato."}
            </Text>
          </Alert>
        )}
        <Group align="flex-end" w="100%" wrap="nowrap">
          <TextInput label="Data" type="date" value={data} onChange={(e) => setData(e.currentTarget.value)} style={{ width: 140 }} />
          <Input.Wrapper label="Segnalazione" style={{ flex: 1 }}>
            <Group gap="xs" wrap="nowrap" grow style={{ width: "100%" }}>
              {MARCATORI.map((m) => (
                <Button
                  key={m.value}
                  size="sm"
                  px={8}
                  variant={marcatore === m.value ? "filled" : "light"}
                  color={m.color}
                  leftSection={<m.Ico size={16} />}
                  onClick={() => setMarcatore(marcatore === m.value ? "" : m.value)}
                >
                  {m.label}
                </Button>
              ))}
            </Group>
          </Input.Wrapper>
        </Group>

        {/* Pipeline dello stato (FASE 7C): l'anello scorre sulla tappa attiva quando l'ordine
            avanza. Cliccabile = imposta lo stato. */}
        <Box mt={4} style={{ paddingInline: 4, paddingRight: 14 }}>
          <Text size="sm" fw={500} mb={8}>
            Stato
          </Text>
          <PipelineStato
            stato={stato}
            onSel={(v) => setStato(v)}
            disabled={statoIniziale === "Rifiutato"}
          />
        </Box>

        {isDiag ? (
          // Diagnostica: il destinatario È il medico → niente cliente separato.
          <>
            {selettoreMedico(true)}
            <TextInput label="Agente (automatico)" value={agenteNome ?? "—"} readOnly variant="filled" />
          </>
        ) : (
          <>
            <Box data-pt-field="cliente">
              <SelectConNuovo
                label="Cliente"
                placeholder="Scegli…"
                data={opzioni(clienti)}
                value={clienteId}
                onChange={scegliCliente}
                entita="il cliente"
                withAsterisk
                onModifica={() => apriModificaCliente(clienteId)}
                modificaTitle="Modifica indirizzo e dati del cliente"
                onNuovo={(nome) => { setNuovoCliVal({ ...valoriClienteVuoti(), nome }); setNuovoCliErr({}); setCliEditId(null); setNuovoCliApri(true); }}
              />
            </Box>

            {selettoreMedico(false)}
            <TextInput label="Agente (automatico)" value={agenteNome ?? "—"} readOnly variant="filled" />
          </>
        )}

        {stato === "Rifiutato" && (
          <Textarea label="Motivo del rifiuto" value={motivoRifiuto} onChange={(e) => setMotivoRifiuto(e.currentTarget.value)} autosize minRows={2} placeholder="Perché l'ordine è stato rifiutato" />
        )}

        <Checkbox
          checked={omaggio}
          onChange={(e) => cambiaOmaggio(e.currentTarget.checked)}
          label="Omaggio / sostituzione (escluso dalle provvigioni)"
        />

        <ProdottiOrdinePanel
          containerRef={prodottiRef}
          titolo="Prodotti"
          terminologiaProdotto
          righe={righe}
          isAllergene={isAllergene}
          isDiagnostica={isDiag}
          isImmunoterapia={isImmuno}
          evidenziato={evidenziaProdotti}
          attentionStyle={prodottoAttentionStyle}
          nomiProdotti={nomiProdotti}
          nomiAllergeni={nomiAllergeni}
          tipiTest={diagSugg.tipiTest}
          suggerimentiProduzione={suggProd}
          datiProduzioneAperti={datiProdAperti}
          prezziDisabilitati={omaggio}
          onDigitaProdotto={digitaProdotto}
          onScegliProdotto={scegliProdotto}
          onAggiornaRiga={aggiornaRiga}
          onToggleDatiProduzione={toggleDatiProd}
          onRimuoviRiga={(key) => {
            setDatiProdAperti((correnti) => {
              if (!correnti.has(key)) return correnti;
              const prossimi = new Set(correnti);
              prossimi.delete(key);
              return prossimi;
            });
            setRighe((correnti) =>
              correnti.length > 1
                ? correnti.filter((riga) => riga.key !== key)
                : correnti.map((riga) =>
                    riga.key === key
                      ? { ...azzeraRigaForm(riga, isDiag), prezzo: omaggio ? 0 : "" }
                      : riga,
                  ),
            );
          }}
          onAggiungiRiga={() =>
            setRighe((correnti) => [
              ...correnti,
              { ...nuovaRiga(isDiag), prezzo: omaggio ? 0 : "" },
            ])
          }
        />

        <PagamentoScadenzarioPanel
          containerRef={pagamentiRef}
          evidenziato={evidenziaPagamenti}
          ordineId={ordineId}
          categoria={categoria}
          codTutto={codTutto}
          acconto={acconto}
          accontoIncassato={accontoIncassato}
          accontoData={accontoData}
          totale={totale}
          incassato={incassato}
          residuo={residuo}
          righe={righeScad}
          optionsConti={optionsConti}
          optionsContiAcconto={optionsContiAcconto}
          importoRateizzabile={importoRateizzabile}
          saldoAttesoCorrente={saldoAttesoCorrente}
          scopertoScadenzario={scopertoScadenzario}
          prossimaRataDaSaldare={prossimaRataDaSaldare}
          azioneAggiungiPagamento={azioneAggiungiPagamento}
          rimborsoLabel={
            ordineId && (residuo < 0 || rimborsoEsistente)
              ? rimborsoEsistente
                ? `Rimborso ${statoRimborsoDef(rimborsoEsistente.stato).label.toLowerCase()}`
                : "Rimborso differenza"
              : null
          }
          onAccontoChange={(value) => {
            if (accontoTocco.current) setAccontoManuale(value);
          }}
          onAccontoFocus={() => {
            accontoTocco.current = true;
          }}
          onToggleCod={toggleCod}
          onAccontoIncassatoChange={setAccontoIncassato}
          onAccontoDataChange={setAccontoData}
          onApriPagamento={apriPagamento}
          onAggiornaContoBozza={aggiornaContoBozza}
          onAggiornaScadenzaBozza={aggiornaScadenzaBozza}
          onAggiornaScadDaSpedizioneBozza={aggiornaScadDaSpedizioneBozza}
          onApriRateizzazione={apriRateizzazione}
          onApriRimborso={() => {
            if (!ordineId) return;
            if (eccedenzaOrdineNonSalvata(eccedenzaInBozza, eccedenzaSalvata)) {
              toast.warning(
                `L'ordine mostra € ${centsToEurStr(eccedenzaInBozza)} di eccedenza, ma ne risultano salvati € ${centsToEurStr(eccedenzaSalvata)}. Salva prima l'ordine per modificare il rimborso.`
              );
              return;
            }
            setRimborsoExtra(
              rimborsoEsistente
                ? { rimborso: rimborsoEsistente }
                : { nuovoExtra: { ordineId, numero: numero ?? undefined } }
            );
          }}
        />

        <DatiFatturazionePanel
          expanded={fattDiversa}
          value={fatt}
          onToggle={() => setFattDiversa((aperto) => !aperto)}
          onChange={setFatt}
        />

        <Textarea label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={1} />

        {/* Promemoria collegati all'ordine (FASE 6C): accesso discreto, solo per
            ordini già salvati (serve un id da collegare). */}
        {ordineId && (
          <Box>
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              leftSection={<IconBell size={16} />}
              rightSection={promemAperti ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
              onClick={() => setPromemAperti((v) => !v)}
            >
              Promemoria collegati
            </Button>
            <Collapse expanded={promemAperti}>
              <Box mt="xs">
                <BachecaPromemoria
                  identity={identity}
                  collegato={{ tipo: "ordine", id: ordineId, nome: numero ?? "" }}
                  compatta
                />
              </Box>
            </Collapse>
          </Box>
        )}
          </Stack>
        </Box>

        <div className="pt-modal-footer" style={{ justifyContent: "space-between" }}>
          <div className="pt-modal-actions">
            <Button
              variant={preventivoEsistente ? "light" : "default"}
              leftSection={<IconFileInvoice size={16} />}
              disabled={salvando || caricamento}
              onClick={() => {
                if (ordineId && preventivoEsistente) {
                  void apriPreventivoCollegato(ordineId, "anteprima");
                } else if (ordineId && !formModificato) {
                  void apriPreventivoCollegato(ordineId, "editor");
                } else {
                  void salva(false, true);
                }
              }}
            >
              {!ordineId
                ? "Salva e genera preventivo"
                : preventivoEsistente
                  ? "Visualizza preventivo"
                  : "Genera preventivo"}
            </Button>
          </div>
          <div className="pt-modal-actions">
            <Button
              variant="default"
              onClick={async () => {
                if (formModificato) {
                  const ok = await dialog.confirm(
                    "Uscire senza salvare?",
                    "Ci sono modifiche non salvate all'ordine o allo scadenzario. Le modifiche andranno perse.",
                    { conferma: "Esci comunque", annulla: "Resta" }
                  );
                  if (!ok) return;
                }
                onClose();
              }}
              disabled={salvando}
            >
              Annulla
            </Button>
            {ordineId ? (
              <Button
                variant="default"
                leftSection={<IconPrinter size={16} />}
                disabled={salvando || caricamento}
                onClick={() =>
                  setSchedaCliente({
                    ordineId,
                    numero,
                    chiudiOrdineDopo: false,
                  })
                }
              >
                Stampa
              </Button>
            ) : (
              <Button
                variant="default"
                leftSection={<IconPrinter size={16} />}
                onClick={() => void salva(true)}
                loading={salvando || caricamento}
              >
                Salva e stampa
              </Button>
            )}
            <Button
              color="accent"
              onClick={() => void salva(false)}
              loading={salvando || caricamento}
            >
              Salva
            </Button>
          </div>
        </div>
      </Box>

      <AnagraficaRapidaModal
        opened={nuovoCliApri}
        entityLabel="cliente"
        editMode={!!cliEditId}
        registro={CLIENTE_REG}
        valori={nuovoCliVal}
        errori={nuovoCliErr}
        loading={creandoCli}
        onClose={() => setNuovoCliApri(false)}
        onExited={() => setCliEditId(null)}
        onSubmit={creaCliente}
        setValori={setNuovoCliVal}
        setErrori={setNuovoCliErr}
      />

      <AnagraficaRapidaModal
        opened={nuovoMedApri}
        entityLabel="medico"
        editMode={!!medEditId}
        registro={MEDICO_REG}
        valori={nuovoMedVal}
        errori={nuovoMedErr}
        rifOpzioni={medRif}
        loading={creandoMed}
        onClose={() => setNuovoMedApri(false)}
        onExited={() => setMedEditId(null)}
        onSubmit={creaMedico}
        setValori={setNuovoMedVal}
        setErrori={setNuovoMedErr}
      />

      <PagamentoModal
        target={pagTarget}
        onClose={chiudiPagamento}
        onChanged={(info) =>
          ricaricaDopoPagamento({
            preservaRighe: !info?.prodottiAggiornati,
            sincronizzaAcconto: true,
            chiudiSottomodali: true,
          })
        }
        onDraftChange={aggiornaDraftPagamento}
        onLocalSave={salvaPagamentoLocale}
      />

      <RateizzaModal
        target={rateizzaTarget}
        onClose={() => setRateizzaTarget(null)}
        onSaved={() => ricaricaDopoPagamento({ preservaRighe: true, chiudiSottomodali: true })}
        onLocalSave={(rate, daSpedizione) => {
          if (rateizzaTarget?.ordineId) {
            applicaRateizzoPagamentiLocali(rate, daSpedizione);
          } else {
            applicaRateizzoBozze(rate, daSpedizione);
          }
          setRateizzaTarget(null);
        }}
      />

      <RimborsoModal
        target={rimborsoExtra}
        onClose={() => setRimborsoExtra(null)}
        onChanged={() => {
          setRimborsoExtra(null);
          caricaRimborso();
        }}
      />

      {schedaCliente && (
        <Suspense fallback={null}>
          <SchedaClienteModalLazy
            ordineId={schedaCliente.ordineId}
            ordineNumero={schedaCliente.numero}
            opened
            onClose={() => {
              const target = schedaCliente;
              setSchedaCliente(null);
              if (target.chiudiOrdineDopo) onSaved(target.ordineId);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
