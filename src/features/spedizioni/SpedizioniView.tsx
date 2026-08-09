// Schermata unica Spedizioni (FASE 4A), sotto Evasione. Una sola pagina con due viste
// (SegmentedControl): "Da spedire" e "Effettuate", entrambe a righe grandi espandibili
// sul modello tabellare universale (mantine-datatable / Tabella) con ricerca per nome.
//
// - Da spedire: un ordine per riga (data, destinatario, regione, colli, stato). Ordine di
//   default: prima i pronti (Confermato/In produzione…), i Nuovo per ultimi, i più vecchi
//   prima. Espandendo si vedono medico, agente e le righe da spedire. Si selezionano uno o
//   più ordini ("seleziona tutto") e si crea la spedizione (anche parziale). Da ogni riga si
//   può aprire l'ordine (per correggere indirizzo/anagrafica/pagamento).
// - Effettuate: RAGGRUPPATE per **lotto** (sessione di creazione). Ogni gruppo si espande e
//   mostra le sue spedizioni (collo, destinatario, numero, contrassegno) con le righe incluse;
//   ogni spedizione si può annullare (le righe tornano da spedire; niente Cestino).
//
// Export CORRIERE_B/CORRIERE_A in 4B.
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Menu,
  MultiSelect,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowMerge,
  IconChevronDown,
  IconExternalLink,
  IconFileExport,
  IconFileSpreadsheet,
  IconMessage,
  IconPackageOff,
  IconSearch,
  IconTrash,
  IconTruck,
  IconTruckDelivery,
  IconTruckLoading,
} from "@tabler/icons-react";
import {
  api,
  type BollettazioneAnalisi,
  type BollettazioneConfermaRiga,
  type Identity,
  type OrdineDaSpedire,
  type Spedizione,
} from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { dialog } from "../../ui/dialog/store";
import { useDeepLink } from "../../shell/navigazione";
import { centsToEurStr } from "../../lib/money";
import {
  Tabella,
  type DataTableColumn,
  type DataTableSortStatus,
} from "../../ui/Tabella";
import { NumeriLottoInput } from "../../ui/NumeriLottoInput";
import { Pagina, usePaginaPronta } from "../../pages/Pagina";
import { DebouncedInput } from "../../ui/DebouncedInput";
import { statoDef } from "../giornaliero/stati";
import { OrdineEditor } from "../giornaliero/OrdineEditor";
import { CreaSpedizioneModal, type BozzaRiga } from "./CreaSpedizioneModal";
import {
  BollettazioneReviewModal,
  type BollettazionePreparazione,
} from "./BollettazioneReviewModal";
import {
  GruppoSpedDettaglio,
  clearRiepilogoCache,
} from "./GruppoSpedDettaglio";
import { EsportaTabella } from "../../ui/esporta/EsportaTabella";
import {
  colonneProfilo,
  preparaRigheEsportazione,
  rigaCorriere,
} from "./profiliCorriere";
import { SpeditoFlourish } from "./SpeditoFlourish";
import { usePrefs } from "../../lib/prefs";
import { DataAdattiva } from "../../ui/DataAdattiva";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { PremiumAction } from "../../premium/PremiumAction";
import {
  ordineHaDatiVaccino,
  spedizioneHaDatiVaccino,
} from "./datiVaccino";
import {
  apriCampagnaComunicazioni,
  datiPagamentoComunicazione,
  importoResiduoComunicazione,
} from "../comunicazioni/apriComunicazione";

type Vista = "da_spedire" | "effettuate";
const TAB_STORAGE = "pt.spedizioni.tab";
const EVENTI_RICARICA = [
  "ordine:salvato",
  "spedizione:salvato",
  "pagamento:salvato",
  "cliente:salvato",
  "medico:salvato",
  "agente:salvato",
  "corriere:salvato",
  "prodotto:salvato",
  "conto:salvato",
] as const;

/** Un gruppo della vista Effettuate = una sessione di creazione (lotto). */
interface GruppoSped {
  lotto: string;
  data: string;
  corriereNome: string;
  spedizioni: Spedizione[];
  /** Da incassare alla consegna, in centesimi, per mezzo. */
  contrassegnoTot: number;
  assegnoTot: number;
  /** True se il gruppo è frutto di un'unione di lotti (separabile). */
  unito: boolean;
  /** Spedizioni che corrispondono alla ricerca corrente; il gruppo resta completo. */
  matchIds: Set<string>;
}

/** Una distinta = le spedizioni di un corriere (con profilo di export). */
interface Distinta {
  nome: string;
  profilo: string;
  sped: Spedizione[];
}

/** Raggruppa spedizioni per corriere → una distinta per corriere (ordinate per nome). */
function distintePerCorriere(sped: Spedizione[]): Distinta[] {
  const map = new Map<string, { profilo: string; sped: Spedizione[] }>();
  for (const s of sped) {
    const nome = s.corriereNome || "—";
    let e = map.get(nome);
    if (!e) {
      e = { profilo: s.corriereProfilo || "gls", sped: [] };
      map.set(nome, e);
    }
    e.sped.push(s);
  }
  return [...map.entries()]
    .map(([nome, v]) => ({ nome, ...v }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
}

/** Un avviso di spedizione genera una comunicazione per cliente, anche quando la
 * selezione contiene più colli, corrieri o lotti destinati alla stessa persona. */
export function numeroComunicazioniSpedizione(spedizioni: Spedizione[]): number {
  return new Set(
    spedizioni
      .map((spedizione) => spedizione.clienteId)
      .filter(Boolean),
  ).size;
}

// Categorie escluse di default da «Da spedire»: Diagnostica e Keriba viaggiano per canali
// diversi e non si spediscono col flusso ordinario. Si mostrano con lo switch. FASE 5E.
const CAT_NON_DEFAULT = new Set(["diagnostica", "keriba"]);
/** True se l'ordine è visibile di default (Immunoterapia o categoria non impostata). */
const ordinarioDaSpedire = (o: OrdineDaSpedire) =>
  !CAT_NON_DEFAULT.has((o.categoria || "").trim().toLowerCase());

/** Empty-state dedicato (fetch-then-render). Reso a parte perché mantine-datatable non
 * mostra il proprio `emptyState` quando è attivo `rowExpansion`. */
function Vuoto({
  Ico,
  children,
}: {
  Ico: typeof IconPackageOff;
  children: React.ReactNode;
}) {
  return (
    <Box
      style={{
        height: "100%",
        minHeight: 240,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-md)",
      }}
    >
      <Stack align="center" gap="xs" maw={460} ta="center" py={40}>
        <ThemeIcon size={48} radius="xl" variant="light" color="gray">
          <Ico size={24} />
        </ThemeIcon>
        <Text c="dimmed" size="sm">
          {children}
        </Text>
      </Stack>
    </Box>
  );
}

/** Bottone «Crea distinta corriere» per un gruppo. Con **più corrieri** (gruppo unito) apre
 * un menu per scegliere quale distinta generare; con uno solo è un bottone diretto. */
function DistintaGruppo({
  corrieri,
  compatto,
}: {
  corrieri: Distinta[];
  compatto: boolean;
}) {
  const [scelta, setScelta] = useState<string | null>(null);
  if (corrieri.length === 0) return null;

  const esporta = (d: Distinta, controllata: boolean) => (
    <EsportaTabella<ReturnType<typeof rigaCorriere>>
      key={d.nome}
      variante={compatto ? "icona" : "bottone"}
      etichetta="Crea distinta"
      adattivo
      size="compact-sm"
      senzaTrigger={controllata}
      aperto={controllata ? scelta === d.nome : undefined}
      onApertoChange={
        controllata
          ? (v) => {
              if (!v) setScelta(null);
            }
          : undefined
      }
      colonneFisse
      orientamentoFisso="orizzontale"
      nomeBase={`Spedizione ${d.nome}`.trim()}
      foglio={`Spedizioni ${d.nome}`.trim().slice(0, 31)}
      titolo={`SPEDIZIONI ${d.nome.toUpperCase()}`.trim()}
      colonne={colonneProfilo(d.profilo)}
      righe={preparaRigheEsportazione(d.sped, d.profilo)}
    />
  );

  if (corrieri.length === 1) return esporta(corrieri[0], false);

  // Più corrieri nello stesso gruppo (unito): si sceglie quale distinta generare.
  return (
    <>
      <Tooltip label="Crea distinta" withArrow>
        <Box style={{ display: "inline-block" }}>
          <Menu position="bottom-end" withinPortal shadow="md">
            <Menu.Target>
              {compatto ? (
                <ActionIcon
                  size={36}
                  variant="light"
                  color="accent"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Crea distinta"
                >
                  <IconFileExport size={18} />
                </ActionIcon>
              ) : (
                <Button
                  size="compact-sm"
                  variant="light"
                  color="accent"
                  className="pt-azione-adattiva"
                  leftSection={<IconFileExport size={16} />}
                  rightSection={<IconChevronDown size={14} />}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Crea distinta"
                >
                  <span className="pt-azione-adattiva-label">
                    Crea distinta
                  </span>
                </Button>
              )}
            </Menu.Target>
            <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
              <Menu.Label>Quale distinta generare?</Menu.Label>
              {corrieri.map((d) => (
                <Menu.Item key={d.nome} onClick={() => setScelta(d.nome)}>
                  Distinta {d.nome} ({d.sped.length})
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </Box>
      </Tooltip>
      {corrieri.map((d) => esporta(d, true))}
    </>
  );
}

/** Offerta di distinte nella fioritura «Spedito!»: un bottone per corriere (o uno solo).
 * Alla scelta chiama `onPick(d)`: il chiamante chiude la card e apre il modale di export a
 * livello di PAGINA (così non viene smontato chiudendo la card e non finisce dietro l'overlay). */
function OffriDistinte({
  corrieri,
  onPick,
}: {
  corrieri: Distinta[];
  onPick: (d: Distinta) => void;
}) {
  if (corrieri.length === 0) return null;
  return (
    <Group gap="xs" justify="flex-end">
      {corrieri.map((d) => (
        <Button
          key={d.nome}
          size="compact-sm"
          variant="light"
          color="accent"
          leftSection={<IconFileExport size={16} />}
          onClick={() => onPick(d)}
        >
          {corrieri.length === 1 ? "Crea distinta" : `Distinta ${d.nome}`}
          {corrieri.length > 1 ? ` (${d.sped.length})` : ""}
        </Button>
      ))}
    </Group>
  );
}

const DistintaGruppoLotto = memo(function DistintaGruppoLotto({
  spedizioni,
  compatto,
}: {
  spedizioni: Spedizione[];
  compatto: boolean;
}) {
  const corrieri = useMemo(() => distintePerCorriere(spedizioni), [spedizioni]);
  return <DistintaGruppo corrieri={corrieri} compatto={compatto} />;
});

function spedizioneCorrisponde(s: Spedizione, q: string): boolean {
  if (!q) return true;
  if (s.lotto.toLowerCase().includes(q)) return true;
  const campi = [
    s.clienteNome,
    s.medicoNome,
    s.agenteNome,
    s.indirizzo,
    s.citta,
    s.regione,
    s.telefono,
    s.telefono?.replace(/\D/g, ""),
    s.corriereNome,
    s.numero,
  ];
  if (campi.some((x) => x && x.toLowerCase().includes(q))) return true;
  return s.righe.some((r) =>
    [r.clienteNome, r.ordineNumero, r.prodottoNome, r.numero].some(
      (x) => x && x.toLowerCase().includes(q),
    ),
  );
}

export function SpedizioniView({ identity }: { identity: Identity }) {
  const {
    anno,
    spedizioniMostraAltre: mostraAltre,
    setSpedizioniMostraAltre: setMostraAltre,
  } = usePrefs();

  const [vista, setVista] = useState<Vista>(() => {
    const saved = localStorage.getItem(TAB_STORAGE);
    return saved === "effettuate" || saved === "da_spedire"
      ? saved
      : "da_spedire";
  });
  const [daSpedire, setDaSpedire] = useState<OrdineDaSpedire[]>([]);
  const [effettuate, setEffettuate] = useState<Spedizione[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [cerca, setCerca] = useState("");
  const cercaDifferita = useDeferredValue(cerca);

  // Mostra anche Diagnostica/Keriba fra gli ordini da spedire. È una preferenza locale:
  // il valore scelto resta valido alle visite successive su questa postazione. FASE 5E.
  const [selezione, setSelezione] = useState<OrdineDaSpedire[]>([]);
  // Effettuate: filtri corriere/periodo + selezione gruppi per la distinta "unita".
  const [corriereFiltro, setCorriereFiltro] = useState<string[]>([]);
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");
  const [selezioneEff, setSelezioneEff] = useState<GruppoSped[]>([]);
  const [creaTarget, setCreaTarget] = useState<OrdineDaSpedire[] | null>(null);
  const [analisiBollettazione, setAnalisiBollettazione] =
    useState<BollettazioneAnalisi | null>(null);
  const [analisiBollettazioneInCorso, setAnalisiBollettazioneInCorso] =
    useState(false);
  const [righeBollettazioneSpedizione, setRigheBollettazioneSpedizione] =
    useState<BollettazioneConfermaRiga[] | null>(null);
  const [
    dataArrivoBollettazioneSpedizione,
    setDataArrivoBollettazioneSpedizione,
  ] = useState<string | undefined>();
  const [bozzeBollettazione, setBozzeBollettazione] = useState<
    Record<string, BozzaRiga> | undefined
  >();
  // Espansione inline «Da spedire» (FASE 7): il numero/lotto vive sulle righe di `daSpedire`
  // (così un salvataggio dall'editor lo ri-allinea col backend), mentre qui teniamo solo i
  // prodotti **esclusi** dalla spedizione (default = tutti inclusi). Tutto si trasporta nel modale.
  const [esclusi, setEsclusi] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<{
    ordineId: string | null;
    numero?: string;
  } | null>(null);
  // Sort utente (default = ordine standard: pronti + più vecchi).
  const [sort, setSort] = useState<DataTableSortStatus<OrdineDaSpedire>>({
    columnAccessor: "numero",
    direction: "asc",
  });
  const [sortG, setSortG] = useState<DataTableSortStatus<GruppoSped>>({
    columnAccessor: "",
    direction: "asc",
  });
  // FASE 7C — fioritura "Spedito!" dopo la creazione + flash del nuovo gruppo in Effettuate.
  const [spedito, setSpedito] = useState(false);
  // Corrieri della spedizione appena creata: alimentano il bottone «crea distinta» dentro
  // la fioritura «Spedito!» (così la si può stampare subito, seguendo il flusso esistente).
  const [distintaSpedito, setDistintaSpedito] = useState<Distinta[]>([]);
  // Distinta scelta dalla fioritura «Spedito!»: il suo modale di export vive a livello di
  // PAGINA (non dentro la card), così sopravvive alla chiusura della card e non resta dietro
  // l'overlay della fioritura.
  const [distintaFlourish, setDistintaFlourish] = useState<Distinta | null>(
    null,
  );
  const [nuoviLotti, setNuoviLotti] = useState<Set<string>>(new Set());
  // Lotti espansi nelle «Effettuate» (controllato): così, dopo una creazione, il nuovo
  // gruppo si apre da solo mostrando i colli/righe risultanti, come in Produzione.
  const [espansiEff, setEspansiEff] = useState<string[]>([]);
  const [spedizioneDaAprire, setSpedizioneDaAprire] = useState<string | null>(
    null,
  );
  const lottiPrimaRef = useRef<Set<string>>(new Set());
  const attesaNuoviRef = useRef(false);
  usePaginaPronta(caricamento);

  function cambiaVista(v: Vista) {
    setVista(v);
    localStorage.setItem(TAB_STORAGE, v);
  }

  // Quando, dopo una creazione, arrivano le Effettuate fresche, individua i lotti nuovi
  // (non presenti prima) e li fa lampeggiare brevemente in elenco.
  useEffect(() => {
    if (!attesaNuoviRef.current || caricamento) return;
    attesaNuoviRef.current = false;
    const spedNuove = effettuate.filter(
      (s) => !lottiPrimaRef.current.has(s.lotto),
    );
    if (spedNuove.length === 0) return;
    const lottiNuovi = [...new Set(spedNuove.map((s) => s.lotto))];
    setNuoviLotti(new Set(lottiNuovi));
    // Apri (espandi) il/i gruppo/i appena creati così si vedono subito i colli risultanti.
    setEspansiEff(lottiNuovi);
    // Distinta(e) per corriere della spedizione appena creata → offerta nella fioritura.
    // La fioritura «Spedito!» si mostra QUI, INSIEME alla distinta (come Produzione con
    // `inProduzione`+`esportaLotto`): così appare già interattiva e il suo timer di
    // auto-chiusura (1,5s, solo per la versione senza distinta) non parte mai. Mostrarla
    // prima — in `onDone`, mentre `carica()` è ancora in corso — la rendeva non interattiva
    // e la faceva sparire da sola dopo ~2-3s su archivi grandi (carica lento).
    setDistintaSpedito(distintePerCorriere(spedNuove));
    setSpedito(true);
    const t = window.setTimeout(() => setNuoviLotti(new Set()), 2400);
    return () => window.clearTimeout(t);
  }, [effettuate, caricamento]);

  const carica = useCallback(async (silente = false) => {
    if (!silente) setCaricamento(true);
    clearRiepilogoCache(); // i dati cambiano: il riepilogo lazy va ricalcolato
    try {
      const [d, e] = await Promise.all([
        api.righeDaSpedire(),
        api.spedizioniLista(),
      ]);
      setDaSpedire(d);
      setEffettuate(e);
      setSelezione((sel) =>
        sel.filter((s) => d.some((o) => o.ordineId === s.ordineId)),
      );
      setSelezioneEff((sel) =>
        sel.filter((g) => e.some((s) => s.lotto === g.lotto)),
      );
    } catch (err) {
      toast.error(`Caricamento spedizioni non riuscito: ${err}`);
    } finally {
      setCaricamento(false);
    }
  }, []);

  useEffect(() => {
    carica(false);
  }, [carica]);
  useRicaricaSuEventi(EVENTI_RICARICA, () => carica(true), 160);

  const toggleIncluso = useCallback(
    (rigaId: string, incluso: boolean) =>
      setEsclusi((s) => {
        const n = new Set(s);
        if (incluso) n.delete(rigaId);
        else n.add(rigaId);
        return n;
      }),
    [],
  );

  // Edit inline del numero/lotto: aggiorna direttamente la riga in `daSpedire` (fonte unica,
  // ri-allineata dal backend a ogni `carica`).
  const setRigaNumero = useCallback(
    (rigaId: string, numero: string) =>
      setDaSpedire((ds) =>
        ds.map((o) => ({
          ...o,
          righe: o.righe.map((r) =>
            r.rigaId === rigaId ? { ...r, numero } : r,
          ),
        })),
      ),
    [],
  );

  // Bozze passate al modale «Crea spedizione»: numero dalle righe + incluso dal set esclusi.
  const bozzeModal = useMemo(() => {
    const m: Record<string, BozzaRiga> = {};
    for (const o of daSpedire)
      for (const r of o.righe)
        m[r.rigaId] = {
          numero: ordineHaDatiVaccino(o) ? r.numero || "" : "",
          incluso: !esclusi.has(r.rigaId),
        };
    return m;
  }, [daSpedire, esclusi]);

  const avviaBollettazione = useCallback(async () => {
    if (analisiBollettazioneInCorso) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selection = await open({
        multiple: true,
        directory: false,
        filters: [{ name: "File Excel del laboratorio", extensions: ["xlsx"] }],
      });
      if (!selection) return;
      const paths = Array.isArray(selection) ? selection : [selection];
      if (paths.length === 0) return;
      setAnalisiBollettazioneInCorso(true);
      const analysis = await api.bollettazioneAnalizza(paths);
      setAnalisiBollettazione(analysis);
      if (analysis.totals.failedFiles > 0) {
        toast.warning(
          `${analysis.totals.failedFiles} file non leggibili; le altre righe sono disponibili.`,
        );
      }
    } catch (error) {
      toast.error(`Analisi dei file non riuscita: ${error}`);
    } finally {
      setAnalisiBollettazioneInCorso(false);
    }
  }, [analisiBollettazioneInCorso]);

  const preparaSpedizioneBollettazione = useCallback(
    ({ rows, dataArrivo }: BollettazionePreparazione) => {
      const byRow = new Map(rows.map((row) => [row.rowId, row]));
      const target = daSpedire
        .filter((order) => order.righe.some((row) => byRow.has(row.rigaId)))
        .map((order) => ({
          ...order,
          righe: order.righe
            .filter((row) => byRow.has(row.rigaId))
            .map((row) => {
              const prepared = byRow.get(row.rigaId)!;
              const productId = String(
                prepared.acceptedFields.prodotto_id ?? row.prodottoId,
              );
              const productName = String(
                prepared.acceptedFields.prodotto_nome ?? row.prodottoNome,
              );
              const number = String(
                prepared.acceptedFields.numero ?? prepared.sourceReference,
              );
              return {
                ...row,
                prodottoId: productId,
                prodottoNome: productName,
                numero: number,
              };
            }),
        }));
      if (target.length === 0) {
        toast.error(
          "Le righe revisionate non sono più disponibili: ricarica i file.",
        );
        return;
      }
      setBozzeBollettazione(
        Object.fromEntries(
          rows.map((row) => [
            row.rowId,
            {
              numero: String(
                row.acceptedFields.numero ?? row.sourceReference,
              ),
              incluso: true,
            },
          ]),
        ),
      );
      setRigheBollettazioneSpedizione(rows);
      setDataArrivoBollettazioneSpedizione(dataArrivo);
      setAnalisiBollettazione(null);
      setCreaTarget(target);
    },
    [daSpedire],
  );

  // Deep-link da Spotlight (corriere/spedizione → Effettuate filtrate su corriere + giorno).
  const { link: deepLink, consuma } = useDeepLink("/evasione");
  useEffect(() => {
    if (!deepLink) return;
    if (deepLink.apriId) {
      cambiaVista("effettuate");
      setSpedizioneDaAprire(deepLink.apriId);
      setCreaTarget(null);
      setEditor(null);
      setDistintaFlourish(null);
      setSpedito(false);
      setCerca("");
      setDal("");
      setAl("");
      setCorriereFiltro(deepLink.corriereNomi ?? []);
    } else {
      if (deepLink.tab === "effettuate" || deepLink.tab === "da_spedire")
        cambiaVista(deepLink.tab);
      // Il deep-link descrive il filtro completo: non conservare corriere/periodo di
      // una visita precedente, altrimenti "Spedizioni oggi" può risultare vuoto.
      setCerca(deepLink.cerca ?? "");
      setDal(deepLink.dal ?? "");
      setAl(deepLink.al ?? "");
      setCorriereFiltro([]);
      if (
        deepLink.tab === "da_spedire" &&
        typeof deepLink.mostraAltreSpedizioni === "boolean"
      ) {
        setMostraAltre(deepLink.mostraAltreSpedizioni);
      }
      if (
        deepLink.tab === "da_spedire" &&
        deepLink.azione === "bollettazione_automatica"
      ) {
        window.setTimeout(() => void avviaBollettazione(), 0);
      }
    }
    consuma();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink, avviaBollettazione]);

  const annulla = useCallback(
    async (s: Spedizione) => {
      const ok = await dialog.confirmDanger(
        "Annullare la spedizione?",
        `Le ${s.nRighe} righe torneranno fra quelle da spedire e gli ordini coinvolti rivedranno lo stato di evasione. La spedizione NON va nel Cestino.`,
        { conferma: "Annulla spedizione" },
      );
      if (!ok) return;
      try {
        await api.spedizioneAnnulla(s.id);
        toast.success("Spedizione annullata.");
        setEffettuate((cur) => cur.filter((x) => x.id !== s.id));
        carica(true);
      } catch (err) {
        toast.error(`Annullamento non riuscito: ${err}`);
      }
    },
    [carica],
  );

  const annullaLotto = useCallback(
    async (g: GruppoSped) => {
      const tot = g.spedizioni.reduce((n, s) => n + s.nRighe, 0);
      const usaColli = g.spedizioni.some(spedizioneHaDatiVaccino);
      const ok = await dialog.confirmDanger(
        "Annullare tutta la spedizione?",
        `${usaColli ? `Verranno annullati tutti i ${g.spedizioni.length} colli` : `Verranno annullate tutte le ${g.spedizioni.length} spedizioni`} (${tot} righe): torneranno fra quelli da spedire e gli ordini coinvolti rivedranno lo stato. Non vanno nel Cestino.`,
        { conferma: "Annulla tutto" },
      );
      if (!ok) return;
      try {
        await api.lottoAnnulla(g.lotto);
        toast.success("Spedizione annullata.");
        setEffettuate((cur) => cur.filter((s) => s.lotto !== g.lotto));
        setEspansiEff((cur) => cur.filter((lotto) => lotto !== g.lotto));
        carica(true);
      } catch (err) {
        toast.error(`Annullamento non riuscito: ${err}`);
      }
    },
    [carica],
  );

  const unisciSelezionati = useCallback(async () => {
    if (selezioneEff.length < 2) return;
    const ok = await dialog.confirm(
      "Unire i gruppi selezionati?",
      `I ${selezioneEff.length} gruppi diventeranno un'unica spedizione (un solo gruppo), anche se di giorni o corrieri diversi. ` +
        "Le distinte restano divise per corriere e gli incassi restano per conto/agente. Serve per i calcoli e l'organizzazione.",
      { conferma: "Unisci" },
    );
    if (!ok) return;
    try {
      await api.lottoUnisci(selezioneEff.map((g) => g.lotto));
      toast.success("Gruppi uniti.");
      setSelezioneEff([]);
      carica(true);
    } catch (err) {
      toast.error(`Unione non riuscita: ${err}`);
    }
  }, [selezioneEff, carica]);

  const separaGruppo = useCallback(
    async (lotto: string) => {
      try {
        await api.lottoSepara(lotto);
        toast.success("Gruppi separati.");
        setSelezioneEff([]);
        carica(true);
      } catch (err) {
        toast.error(`Separazione non riuscita: ${err}`);
      }
    },
    [carica],
  );

  const aggiornaSpedizioneEffettuata = useCallback(
    (spedizione?: Spedizione) => {
      clearRiepilogoCache();
      if (!spedizione) {
        carica(true);
        return;
      }
      setEffettuate((cur) =>
        cur.map((s) => (s.id === spedizione.id ? spedizione : s)),
      );
    },
    [carica],
  );

  // Ordini visibili nella vista «Da spedire»: di default solo gli ordinari (Immunoterapia);
  // con lo switch entrano anche Diagnostica/Keriba. Base anche per il badge di conteggio.
  const daSpedireVisibili = useMemo(
    () => (mostraAltre ? daSpedire : daSpedire.filter(ordinarioDaSpedire)),
    [daSpedire, mostraAltre],
  );

  // Se nascondo Diagnostica/Keriba, tolgo dalla selezione gli ordini non più visibili.
  useEffect(() => {
    if (mostraAltre) return;
    setSelezione((sel) => sel.filter(ordinarioDaSpedire));
  }, [mostraAltre]);

  const daSpedireConBlob = useMemo(() => {
    return daSpedireVisibili.map((o) => ({
      ...o,
      _searchBlob: [
        o.clienteNome,
        o.numero,
        o.citta,
        o.regione,
        o.medicoNome,
        o.agenteNome,
        o.telefono,
        o.telefono?.replace(/\D/g, ""),
        ...o.righe.map((r) => `${r.prodottoNome} ${r.paziente} ${r.numero}`),
      ]
        .join(" ")
        .toLowerCase(),
    }));
  }, [daSpedireVisibili]);

  // ---- Da spedire: ricerca + sort utente (default = ordine backend) ----
  const daSpedireFiltrati = useMemo(() => {
    const q = cercaDifferita.trim().toLowerCase();
    let arr = daSpedireConBlob.filter((o) => {
      // Filtro Anno: i "Nuovo" (spesso preventivi) di anni passàti vengono nascosti
      if (
        o.stato === "Nuovo" &&
        anno !== 0 &&
        Number(o.data.slice(0, 4)) !== anno
      )
        return false;
      return true;
    });
    if (q) {
      arr = arr.filter((o) => o._searchBlob.includes(q));
    }
    if (!sort.columnAccessor) return arr;
    const rankStatoSpedizione = (stato: string) => {
      switch (stato) {
        case "In produzione":
          return 0;
        case "Confermato":
          return 1;
        case "Arrivato IT":
          return 2;
        case "Nuovo":
          return 4;
        default:
          return 3;
      }
    };
    const get = (o: OrdineDaSpedire): string | number => {
      switch (sort.columnAccessor) {
        case "data":
          return o.data;
        case "clienteNome":
          return o.clienteNome;
        case "regione":
          return o.regione;
        case "colli":
          return o.colli;
        case "stato":
          return o.stato;
        default:
          return o.numero;
      }
    };
    const out = [...arr];
    out.sort((a, b) => {
      if (sort.columnAccessor === "numero") {
        const rankA = rankStatoSpedizione(a.stato);
        const rankB = rankStatoSpedizione(b.stato);
        if (rankA !== rankB) {
          return sort.direction === "desc" ? rankB - rankA : rankA - rankB;
        }
        const dataA = a.dataProduzione || a.data;
        const dataB = b.dataProduzione || b.data;
        const cmpData = dataA.localeCompare(dataB);
        if (cmpData !== 0) {
          return sort.direction === "desc" ? -cmpData : cmpData;
        }
        const cmpNum = a.numero.localeCompare(b.numero, "it", {
          numeric: true,
        });
        return sort.direction === "desc" ? -cmpNum : cmpNum;
      }

      const va = get(a);
      const vb = get(b);
      let cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "it", { numeric: true });
      if (cmp === 0) {
        cmp = a.numero.localeCompare(b.numero, "it", { numeric: true });
      }
      return sort.direction === "desc" ? -cmp : cmp;
    });
    return out;
  }, [daSpedireConBlob, cercaDifferita, sort, anno]);

  // Quanti ordini Diagnostica/Keriba restano nascosti (per l'etichetta dello switch).
  const nNascosti = useMemo(
    () => daSpedire.filter((o) => !ordinarioDaSpedire(o)).length,
    [daSpedire],
  );

  // ---- Effettuate: raggruppa per lotto (sessione di creazione) + ricerca/filtri ----
  const gruppi = useMemo<GruppoSped[]>(() => {
    const q = cercaDifferita.trim().toLowerCase();
    const corrieri = new Set(corriereFiltro);
    const filtrate = effettuate.filter((s) => {
      // Filtro Anno: archivio storico, filtra per anno in cui è stata creata la spedizione
      if (anno !== 0 && Number(s.data.slice(0, 4)) !== anno) return false;

      if (corrieri.size > 0 && !corrieri.has(s.corriereNome)) return false;
      if (dal && s.data < dal) return false;
      if (al && s.data > al) return false;
      if (q && !spedizioneCorrisponde(s, q)) return false;
      return true;
    });
    const map = new Map<string, GruppoSped>();
    for (const s of filtrate) {
      let g = map.get(s.lotto);
      if (!g) {
        g = {
          lotto: s.lotto,
          data: s.data,
          corriereNome: s.corriereNome,
          spedizioni: [],
          contrassegnoTot: 0,
          assegnoTot: 0,
          unito: false,
          matchIds: new Set<string>(),
        };
        map.set(s.lotto, g);
      }
      g.spedizioni.push(s);
      if (q) g.matchIds.add(s.id);
      if (spedizioneDaAprire === s.id) g.matchIds.add(s.id);
      if (s.unito) g.unito = true;
      if (s.mezzo === "contrassegno") g.contrassegnoTot += s.contrassegno;
      else if (s.mezzo === "assegno") g.assegnoTot += s.contrassegno;
    }
    // Già ordinate per data desc dal backend → i gruppi mantengono quell'ordine.
    return [...map.values()].filter((g) => !q || g.matchIds.size > 0);
  }, [
    effettuate,
    cercaDifferita,
    corriereFiltro,
    dal,
    al,
    anno,
    spedizioneDaAprire,
  ]);

  const gruppiOrdinati = useMemo(() => {
    if (!sortG.columnAccessor) return gruppi;
    const get = (g: GruppoSped): string | number => {
      switch (sortG.columnAccessor) {
        case "corriereNome":
          return g.corriereNome;
        case "daIncassare":
          return g.contrassegnoTot + g.assegnoTot;
        default:
          return g.data;
      }
    };
    const out = [...gruppi];
    out.sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "it", { numeric: true });
      return sortG.direction === "desc" ? -cmp : cmp;
    });
    return out;
  }, [gruppi, sortG]);

  useEffect(() => {
    if (!spedizioneDaAprire || caricamento) return;
    const target = effettuate.find((s) => s.id === spedizioneDaAprire);
    if (!target) return;
    setEspansiEff((cur) =>
      cur.includes(target.lotto) ? cur : [...cur, target.lotto],
    );
  }, [spedizioneDaAprire, caricamento, effettuate]);

  // Colli mostrati nelle Effettuate dopo i filtri (per il badge del tab, coerente con la lista).
  const effettuateMostrate = useMemo(
    () => gruppi.reduce((n, g) => n + g.spedizioni.length, 0),
    [gruppi],
  );

  // Opzioni del filtro corriere (nomi distinti presenti nelle effettuate).
  const corriereOpzioni = useMemo(() => {
    const nomi = new Set(effettuate.map((s) => s.corriereNome).filter(Boolean));
    return [...nomi].sort().map((n) => ({ value: n, label: n }));
  }, [effettuate]);

  // Gruppi selezionati (oggetti FRESCHI dalla lista filtrata, per lotto) e relative
  // distinte per corriere: una distinta per corriere presente nella selezione (più
  // giorni/lotti uniti). Base anche per provvigioni/contabilità spedizioni (fasi dopo).
  const selezionati = useMemo(() => {
    const lotti = new Set(selezioneEff.map((g) => g.lotto));
    return gruppiOrdinati.filter((g) => lotti.has(g.lotto));
  }, [gruppiOrdinati, selezioneEff]);

  const distinte = useMemo(
    () => distintePerCorriere(selezionati.flatMap((g) => g.spedizioni)),
    [selezionati]
  );
  const numeroComunicazioni = useMemo(
    () =>
      numeroComunicazioniSpedizione(
        selezionati.flatMap((gruppo) => gruppo.spedizioni),
      ),
    [selezionati],
  );

  const avvisaSpedizioni = useCallback(async (
    spedizioniDaAvvisare: Spedizione[],
  ) => {
    try {
      const conti = await api.recordsList("conto");
      const perCliente = new Map<string, Spedizione[]>();
      for (const spedizione of spedizioniDaAvvisare) {
        if (!spedizione.clienteId) continue;
        const gruppo = perCliente.get(spedizione.clienteId) ?? [];
        gruppo.push(spedizione);
        perCliente.set(spedizione.clienteId, gruppo);
      }
      const targets = [...perCliente.entries()].map(([clienteId, spedizioniCliente]) => {
        const prima = spedizioniCliente[0];
        const pagamenti = spedizioniCliente
          .flatMap((spedizione) => spedizione.pagamenti)
          .filter((pagamento) => !pagamento.saldato);
        const ordini = [
          ...new Set(
            spedizioniCliente.flatMap((spedizione) =>
              spedizione.righe.map((riga) => riga.ordineNumero).filter(Boolean)
            )
          ),
        ];
        const date = [
          ...new Set(
            spedizioniCliente
              .map((spedizione) => spedizione.data)
              .filter(Boolean)
              .map((data) =>
                new Intl.DateTimeFormat("it-IT").format(
                  new Date(`${data}T12:00:00`)
                )
              )
          ),
        ];
        const corrieri = [
          ...new Set(
            spedizioniCliente
              .map((spedizione) => spedizione.corriereNome)
              .filter(Boolean)
          ),
        ];
        const tracking = spedizioniCliente
          .map((spedizione) => spedizione.numero)
          .filter(Boolean)
          .join(", ");
        return {
          destinatarioEntita: "cliente" as const,
          destinatarioId: clienteId,
          destinatarioNome: prima.clienteNome,
          email: prima.email,
          telefono: prima.telefono,
          tipo: "preavviso_spedizione" as const,
          origineEntita: "spedizione",
          origineId: prima.id,
          origineFingerprint: prima.comunicazioneFingerprint ?? "",
          originiCorrelate: spedizioniCliente.slice(1).map((spedizione) => ({
            id: spedizione.id,
            fingerprint: spedizione.comunicazioneFingerprint ?? "",
          })),
          variabili: {
            nome_cliente: prima.clienteNome,
            ragione_sociale: prima.clienteNome,
            nome_medico: prima.medicoNome,
            nome_agente: prima.agenteNome,
            riferimento_ordine: ordini.join(", "),
            data_spedizione: date.join(", "),
            data_spedizione_iso: prima.data,
            corriere: corrieri.join(", "),
            tracking: tracking || "sarà comunicato dal corriere",
            importo_residuo: importoResiduoComunicazione(
              pagamenti.reduce(
                (totale, pagamento) => totale + pagamento.importo,
                0
              ),
            ),
            ...datiPagamentoComunicazione(
              pagamenti,
              conti,
              "Nessun pagamento richiesto alla consegna."
            ),
          },
        };
      });
      if (!(await apriCampagnaComunicazioni(targets))) {
        toast.warning("Nessun cliente utilizzabile nella selezione.");
      }
    } catch (error) {
      toast.error(`Preparazione degli avvisi non riuscita: ${error}`);
    }
  }, []);

  const avvisaSelezionati = useCallback(
    () =>
      avvisaSpedizioni(
        selezionati.flatMap((gruppo) => gruppo.spedizioni),
      ),
    [avvisaSpedizioni, selezionati],
  );

  // Memoizza la rowExpansion per «Effettuate» in modo che l'oggetto resti stabile tra
  // un render e l'altro: annulla/separaGruppo/carica sono useCallback stabili, quindi
  // la referenza non cambia mai → mantine-datatable non rinvalida l'espansione al render.
  const rowExpansionEffettuate = useMemo(
    () => ({
      allowMultiple: true,
      // Controllato: dopo una creazione apriamo il nuovo gruppo via `espansiEff`; il click
      // dell'utente continua a espandere/comprimere tramite `onRecordIdsChange`.
      expanded: { recordIds: espansiEff, onRecordIdsChange: setEspansiEff },
      // Evita di animare l'altezza del <tr>: dentro una <table> causa reflow a ogni
      // frame. L'ingresso visivo lo fa GruppoSpedDettaglio con transform/opacity.
      collapseProps: { transitionDuration: 0 },
      content: ({ record }: { record: GruppoSped }) => (
        <GruppoSpedDettaglio
          lotto={record.lotto}
          spedizioni={record.spedizioni}
          unito={record.unito}
          onAnnullaCollo={annulla}
          onSepara={separaGruppo}
          onModificato={aggiornaSpedizioneEffettuata}
          onAvvisaGruppo={avvisaSpedizioni}
          matchIds={record.matchIds}
        />
      ),
    }),
    [
      annulla,
      separaGruppo,
      aggiornaSpedizioneEffettuata,
      avvisaSpedizioni,
      espansiEff,
    ],
  );

  // Memoizza la rowExpansion per «Da spedire» (dipende da esclusi e setRigaNumero stabili).
  const rowExpansionDaSpedire = useMemo(
    () => ({
      trigger: "never" as const,
      allowMultiple: true,
      expanded: { recordIds: selezione.map((o) => o.ordineId) },
      // Stessa regola delle Effettuate: niente animazione dell'altezza del <tr>.
      // Il pannello interno entra con transform/opacity via CSS.
      collapseProps: { transitionDuration: 0 },
      content: ({ record }: { record: OrdineDaSpedire }) => (
        <Box className="pt-spedizione-expanded" px="lg" py="xs" bg="var(--bg)">
          <Group gap="lg" wrap="wrap" mb={6} style={{ rowGap: 4 }}>
            <Text size="xs" c="dimmed">
              Medico:{" "}
              <Text span fw={600} c="bright">
                {record.medicoNome || "—"}
              </Text>
            </Text>
            <Text size="xs" c="dimmed">
              Agente:{" "}
              <Text span fw={600} c="bright">
                {record.agenteNome || "—"}
              </Text>
            </Text>
          </Group>
          <Text size="xs" c="dimmed" mb={4}>
            {ordineHaDatiVaccino(record)
              ? "Prodotti pronti per la spedizione — spunta e conferma il numero/lotto:"
              : "Prodotti pronti per la spedizione — scegli quelli da includere:"}
          </Text>
          <Stack gap={4}>
            {record.righe.map((r) => {
              const incluso = !esclusi.has(r.rigaId);
              return (
                <Group key={r.rigaId} gap="xs" wrap="nowrap" align="center">
                  <Checkbox
                    size="xs"
                    checked={incluso}
                    onChange={(e) =>
                      toggleIncluso(r.rigaId, e.currentTarget.checked)
                    }
                    style={{ flex: 1, minWidth: 0 }}
                    label={
                      <Text
                        size="sm"
                        truncate
                        c={incluso ? undefined : "dimmed"}
                      >
                        {r.prodottoNome || "(prodotto)"}
                        {r.qta > 1 ? ` ×${r.qta}` : ""}
                        {r.paziente ? (
                          <Text span c="dimmed">
                            {" "}
                            · {r.paziente}
                          </Text>
                        ) : null}
                      </Text>
                    }
                  />
                  {ordineHaDatiVaccino(record) && (
                    <NumeriLottoInput
                      size="xs"
                      w={120}
                      placeholder="N. vaccino"
                      aria-label={`Numero/lotto di ${r.prodottoNome || "prodotto"}`}
                      leftSection={
                        <Text size="xs" c="dimmed">
                          №
                        </Text>
                      }
                      disabled={!incluso}
                      value={r.numero ?? ""}
                      quantita={r.qta}
                      onChange={(numero) => setRigaNumero(r.rigaId, numero)}
                      style={{ flexShrink: 0 }}
                    />
                  )}
                </Group>
              );
            })}
          </Stack>
        </Box>
      ),
    }),
    // esclusi cambia ad ogni toggle → il content deve aggiornarsi; selezione per le recordIds
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selezione, esclusi, toggleIncluso, setRigaNumero],
  );

  // rowClassName stabile: cambia solo quando c'e' un flash post-creazione o un deep-link.
  const rowClassNameEff = useCallback(
    (g: GruppoSped) =>
      nuoviLotti.has(g.lotto) ||
      g.spedizioni.some((s) => s.id === spedizioneDaAprire)
        ? "pt-riga-nuova"
        : undefined,
    [nuoviLotti, spedizioneDaAprire],
  );

  const colDaSpedire = useMemo<DataTableColumn<OrdineDaSpedire>[]>(
    () => [
      {
        accessor: "numero",
        title: "Ordine",
        width: 88,
        sortable: true,
        resizable: true,
        render: (o) => (
          <Badge variant="light" size="sm">
            {o.numero || "—"}
          </Badge>
        ),
      },
      {
        accessor: "data",
        title: "Data",
        width: 86,
        sortable: true,
        resizable: true,
        render: (o) => <DataAdattiva iso={o.data} compatta={false} />,
      },
      {
        accessor: "clienteNome",
        title: "Destinatario",
        width: 260,
        sortable: true,
        resizable: true,
        noWrap: true,
        render: (o) => (
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text fw={600} size="sm" truncate>
              {o.clienteNome || "(cliente)"}
            </Text>
            {!ordinarioDaSpedire(o) && (
              <Badge
                size="xs"
                variant="light"
                color="orange"
                style={{ flexShrink: 0 }}
              >
                {o.categoria}
              </Badge>
            )}
            {o.citta && (
              <Text size="xs" c="dimmed" truncate>
                · {o.citta}
              </Text>
            )}
          </Group>
        ),
      },
      {
        accessor: "regione",
        title: "Regione",
        width: 110,
        sortable: true,
        resizable: true,
        render: (o) => o.regione || "—",
      },
      {
        accessor: "righe",
        title: "Prodotti",
        width: 74,
        resizable: true,
        textAlign: "center",
        render: (o) => <Text size="sm">{o.righe.length}</Text>,
      },
      {
        accessor: "stato",
        title: "Stato",
        textAlign: "center",
        width: 118,
        sortable: true,
        resizable: true,
        render: (o) => {
          const d = statoDef(o.stato);
          return (
            <Tooltip label={d.label} withArrow>
              <Box className="pt-badge-adattivo">
                <Badge
                  size="sm"
                  variant="light"
                  color={d.color}
                  leftSection={<d.Ico size={12} />}
                  aria-label={d.label}
                >
                  <span className="pt-badge-adattivo-label">{d.label}</span>
                </Badge>
              </Box>
            </Tooltip>
          );
        },
      },
      {
        accessor: "azione",
        title: "",
        width: 48,
        textAlign: "center",
        render: (o) => (
          <Tooltip label="Apri ordine" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Apri ordine"
              onClick={(e) => {
                e.stopPropagation();
                setEditor({ ordineId: o.ordineId, numero: o.numero });
              }}
            >
              <IconExternalLink size={16} />
            </ActionIcon>
          </Tooltip>
        ),
      },
    ],
    [],
  );

  // ---- Colonne "Effettuate" (riga = gruppo/lotto) ----
  const colEffettuate = useMemo<DataTableColumn<GruppoSped>[]>(
    () => [
      {
        accessor: "data",
        title: "Data",
        width: 96,
        sortable: true,
        resizable: true,
        render: (g) => <DataAdattiva iso={g.data} compatta={false} />,
      },
      {
        accessor: "corriereNome",
        title: "Spedizione",
        sortable: true,
        render: (g) => {
          const nomi = [
            ...new Set(g.spedizioni.map((s) => s.corriereNome).filter(Boolean)),
          ];
          const nColli = g.spedizioni.reduce(
            (tot, s) => tot + Math.max(1, s.colli || 0),
            0,
          );
          const mostraColli = g.spedizioni.some(spedizioneHaDatiVaccino);
          return (
            <Group gap={6} wrap="wrap" style={{ minWidth: 0 }}>
              {(nomi.length ? nomi : ["—"]).map((n) => (
                <Badge key={n} size="sm" variant="light" color="indigo">
                  {n}
                </Badge>
              ))}
              <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                {mostraColli
                  ? `${nColli} ${nColli === 1 ? "collo" : "colli"}`
                  : `${g.spedizioni.length} ${g.spedizioni.length === 1 ? "spedizione" : "spedizioni"}`}
              </Text>
              {g.unito && (
                <Badge size="sm" variant="light" color="accent">
                  unito
                </Badge>
              )}
            </Group>
          );
        },
      },
      {
        accessor: "daIncassare",
        title: "Alla consegna",
        width: 185,
        render: (g) =>
          g.contrassegnoTot === 0 && g.assegnoTot === 0 ? (
            <Text
              size="sm"
              c="dimmed"
              title="Apri per il riepilogo incassi per conto/agente"
            >
              —
            </Text>
          ) : (
            <Group gap={6} wrap="wrap">
              {g.contrassegnoTot > 0 && (
                <Badge
                  className="pt-badge-multiriga"
                  size="sm"
                  variant="light"
                  color="grape"
                >
                  Contrassegno € {centsToEurStr(g.contrassegnoTot)}
                </Badge>
              )}
              {g.assegnoTot > 0 && (
                <Badge
                  className="pt-badge-multiriga"
                  size="sm"
                  variant="light"
                  color="violet"
                >
                  Assegno € {centsToEurStr(g.assegnoTot)}
                </Badge>
              )}
            </Group>
          ),
      },
      {
        accessor: "azione",
        title: "",
        width: 170,
        textAlign: "right",
        render: (g) => (
          <Group
            className="pt-cella-azioni-adattive"
            gap="xs"
            wrap="nowrap"
            justify="flex-end"
            onClick={(e) => e.stopPropagation()}
          >
            <DistintaGruppoLotto spedizioni={g.spedizioni} compatto={false} />
            <Tooltip label="Annulla tutto (ripristina da spedire)" withArrow>
              <ActionIcon
                variant="light"
                color="red"
                size={30}
                onClick={() => annullaLotto(g)}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        ),
      },
    ],
    [annullaLotto],
  );

  const azioni =
    vista === "da_spedire" ? (
      <Group
        className="pt-spedizioni-crea-header"
        justify="flex-end"
        wrap="nowrap"
        style={{
          width: "fit-content",
          maxWidth: "100%",
          minWidth: 0,
          marginLeft: "auto",
        }}
      >
        <PremiumAction
          className="pt-bollettazione-action"
          leftSection={<IconFileSpreadsheet size={16} />}
          lockedPresentation="modal"
          buttonVariant="default"
          title="Bollettazione automatica"
          message="L’analisi guidata dei file del laboratorio è disponibile tra le funzionalità extra."
          onAction={() => void avviaBollettazione()}
        >
          {analisiBollettazioneInCorso
            ? "Analisi in corso…"
            : "Bollettazione automatica"}
        </PremiumAction>
        <Button
          color="accent"
          leftSection={<IconTruck size={16} />}
          disabled={selezione.length === 0}
          onClick={() => {
            setRigheBollettazioneSpedizione(null);
            setDataArrivoBollettazioneSpedizione(undefined);
            setBozzeBollettazione(undefined);
            setCreaTarget(selezione);
          }}
        >
          Crea spedizione{selezione.length > 0 ? ` (${selezione.length})` : ""}
        </Button>
      </Group>
    ) : selezioneEff.length > 0 ? (
      // Sulla selezione: «Unisci» (≥2 gruppi → un solo lotto) + una distinta per corriere
      // presente (anche di più giorni/lotti).
      <Group
        className="pt-spedizioni-azioni-header"
        gap="xs"
        wrap="nowrap"
        justify="flex-end"
        style={{ width: "min(100%, 1160px)", minWidth: 0 }}
      >
        <Tooltip
          label={`Avvisa clienti (${numeroComunicazioni})`}
          withArrow
        >
          <Box className="pt-azione-adattiva-wrap">
            <PremiumAction
              className="pt-azione-adattiva"
              leftSection={<IconMessage size={16} />}
              buttonVariant="light"
              buttonColor="accent"
              lockedPresentation="modal"
              title="Funzionalità extra"
              message="La preparazione e l’invio coordinato degli avvisi a più clienti è disponibile tra le funzionalità extra."
              style={{ minHeight: 36, whiteSpace: "nowrap", width: "100%" }}
              onAction={avvisaSelezionati}
            >
              <span className="pt-azione-adattiva-label">
                Avvisa clienti ({numeroComunicazioni})
              </span>
              <span className="pt-azione-adattiva-label-compatta">
                Avvisa
              </span>
            </PremiumAction>
          </Box>
        </Tooltip>
        {selezioneEff.length >= 2 && (
          <Tooltip label={`Unisci (${selezioneEff.length})`} withArrow>
            <Box className="pt-azione-adattiva-wrap">
              <Button
                variant="light"
                color="accent"
                className="pt-azione-adattiva"
                leftSection={<IconArrowMerge size={16} />}
                onClick={unisciSelezionati}
              >
                <span className="pt-azione-adattiva-label">
                  Unisci ({selezioneEff.length})
                </span>
                <span className="pt-azione-adattiva-label-compatta">
                  Unisci
                </span>
              </Button>
            </Box>
          </Tooltip>
        )}
        {distinte.map((d) => (
          <EsportaTabella<ReturnType<typeof rigaCorriere>>
            key={d.nome}
            variante="bottone"
            etichetta={`Distinta ${d.nome} (${d.sped.length})`}
            etichettaCompatta={d.nome}
            adattivo
            colonneFisse
            orientamentoFisso="orizzontale"
            nomeBase={`Spedizione ${d.nome}`.trim()}
            foglio={`Spedizioni ${d.nome}`.trim().slice(0, 31)}
            titolo={`SPEDIZIONI ${d.nome.toUpperCase()}`.trim()}
            colonne={colonneProfilo(d.profilo)}
            righe={preparaRigheEsportazione(d.sped, d.profilo)}
          />
        ))}
      </Group>
    ) : null;

  return (
    <Pagina titolo="Spedizioni" differita azioni={azioni} azioniSticky>
      <Stack gap="md" style={{ height: "100%", position: "relative" }}>
        <SpeditoFlourish
          attivo={spedito}
          onFine={() => {
            setSpedito(false);
            setDistintaSpedito([]);
          }}
          distinta={
            distintaSpedito.length > 0 ? (
              <OffriDistinte
                corrieri={distintaSpedito}
                onPick={(d) => {
                  // Chiudi la card e apri il modale di export a livello di pagina.
                  setSpedito(false);
                  setDistintaSpedito([]);
                  setDistintaFlourish(d);
                }}
              />
            ) : undefined
          }
        />

        {/* Modale di export della distinta scelta dalla fioritura (a livello di pagina). */}
        {distintaFlourish && (
          <EsportaTabella<ReturnType<typeof rigaCorriere>>
            key={distintaFlourish.nome}
            senzaTrigger
            aperto
            onApertoChange={(v) => {
              if (!v) setDistintaFlourish(null);
            }}
            colonneFisse
            orientamentoFisso="orizzontale"
            nomeBase={`Spedizione ${distintaFlourish.nome}`.trim()}
            foglio={`Spedizioni ${distintaFlourish.nome}`.trim().slice(0, 31)}
            titolo={`SPEDIZIONI ${distintaFlourish.nome.toUpperCase()}`.trim()}
            colonne={colonneProfilo(distintaFlourish.profilo)}
            righe={preparaRigheEsportazione(
              distintaFlourish.sped,
              distintaFlourish.profilo,
            )}
          />
        )}
        <Group
          className={`pt-toolbar-responsive ${vista === "effettuate" ? "pt-spedizioni-toolbar-effettuate" : ""}`}
          justify="space-between"
          wrap="wrap"
          gap="sm"
        >
          <Group
            className={`pt-toolbar-responsive-principale ${vista === "da_spedire" ? "pt-spedizioni-da-spedire-toolbar" : ""}`}
            gap="sm"
            wrap="nowrap"
            align="center"
            style={{
              flex: vista === "da_spedire" ? "1 1 auto" : "0 0 auto",
              minWidth: 0,
            }}
          >
            <SegmentedControl
              value={vista}
              onChange={(v) => cambiaVista(v as Vista)}
              data={[
                {
                  value: "da_spedire",
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <IconTruckLoading size={15} />
                      <span>
                        Da spedire
                        {daSpedireFiltrati.length
                          ? ` (${daSpedireFiltrati.length})`
                          : ""}
                      </span>
                    </Group>
                  ),
                },
                {
                  value: "effettuate",
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <IconTruckDelivery size={15} />
                      <span>
                        Effettuate
                        {effettuateMostrate ? ` (${effettuateMostrate})` : ""}
                      </span>
                    </Group>
                  ),
                },
              ]}
            />
            {vista === "da_spedire" && (nNascosti > 0 || mostraAltre) && (
              <Tooltip
                label="Diagnostica e Keriba di norma non si spediscono col flusso ordinario"
                withArrow
                multiline
                w={240}
              >
                <Switch
                  label={
                    <span className="pt-spedizioni-switch-label">
                      Mostra anche la diagnostica e i keriba
                    </span>
                  }
                  checked={mostraAltre}
                  onChange={(e) => setMostraAltre(e.currentTarget.checked)}
                />
              </Tooltip>
            )}
            {vista === "da_spedire" && (
              <DebouncedInput
                placeholder="Cerca destinatario, ordine, telefono o lotto…"
                leftSection={<IconSearch size={16} />}
                value={cerca}
                onChange={setCerca}
                style={{ flex: "1 1 180px", width: "clamp(140px, 24vw, 340px)", maxWidth: 340, minWidth: 140, marginLeft: "auto" }}
              />
            )}
          </Group>
          {vista === "effettuate" && <Group
            className="pt-toolbar-responsive-controls"
            gap="sm"
            wrap="nowrap"
            justify="flex-end"
            style={{ flex: "1 1 480px", width: "100%", minWidth: 0, marginLeft: "auto" }}
          >
            {vista === "effettuate" && (
              <>
                <MultiSelect
                  placeholder={corriereFiltro.length ? undefined : "Corriere"}
                  data={corriereOpzioni}
                  value={corriereFiltro}
                  onChange={setCorriereFiltro}
                  clearable
                  style={{ flex: "0 1 150px", width: "clamp(100px, 13vw, 150px)", minWidth: 100 }}
                  comboboxProps={{ withinPortal: true }}
                />
                <TextInput
                  type="date"
                  aria-label="Dal"
                  value={dal}
                  onChange={(e) => setDal(e.currentTarget.value)}
                  style={{ flex: "0 1 124px", width: "clamp(108px, 11vw, 124px)", minWidth: 108 }}
                />
                <TextInput
                  type="date"
                  aria-label="Al"
                  value={al}
                  onChange={(e) => setAl(e.currentTarget.value)}
                  style={{ flex: "0 1 124px", width: "clamp(108px, 11vw, 124px)", minWidth: 108 }}
                />
              </>
            )}
            <DebouncedInput
              placeholder="Cerca destinatario, ordine, telefono o lotto…"
              leftSection={<IconSearch size={16} />}
              value={cerca}
              onChange={setCerca}
              style={{ flex: "0 1 280px", width: "clamp(130px, 24vw, 280px)", minWidth: 130 }}
            />
          </Group>}
        </Group>

        <Box style={{ flex: 1, minHeight: 0 }}>
          {/* Passaggio fra «Da spedire» ed «Effettuate»: nessuna animazione (il
              crossfade rendeva «pesante» lo switch di tabella). Si mostra solo la vista attiva. */}
          <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          {caricamento ? (
            <Box />
          ) : vista === "da_spedire" ? (
            daSpedireFiltrati.length === 0 ? (
              <Vuoto Ico={IconPackageOff}>
                {cerca
                  ? "Nessun ordine da spedire per questa ricerca."
                  : "Niente da spedire. Gli ordini con prodotti da spedire compaiono qui: seleziona, scegli il corriere e crea la spedizione."}
              </Vuoto>
            ) : (
            <Tabella<OrdineDaSpedire>
              key="da-spedire"
              columns={colDaSpedire}
              records={daSpedireFiltrati}
              caricamentoIniziale={caricamento}
              ridimensionamentoSenzaSfumaturaKey={cercaDifferita}
              idAccessor="ordineId"
              storeColumnsKey="spedizioni-da-spedire"
              minColumnWidths={{ data: 86, stato: 86, azione: 48 }}
              fixedColumnWidths={["azione"]}
              sortStatus={sort}
              onSortStatusChange={setSort}
              selectedRecords={selezione}
              onSelectedRecordsChange={setSelezione}
              selectionColumnStyle={{ width: 40, minWidth: 40, maxWidth: 40 }}
              rowExpansion={rowExpansionDaSpedire}
            />
            )
          ) : gruppi.length === 0 ? (
            <Vuoto Ico={IconTruckDelivery}>
              {cerca || corriereFiltro.length || dal || al
                ? "Nessuna spedizione per questi filtri."
                : "Nessuna spedizione effettuata. Quando crei una spedizione dalla vista «Da spedire» la trovi qui, raggruppata per sessione."}
            </Vuoto>
          ) : (
            <Tabella<GruppoSped>
              key="effettuate"
              className="pt-spedizioni-effettuate"
              columns={colEffettuate}
              records={gruppiOrdinati}
              caricamentoIniziale={caricamento}
              ridimensionamentoSenzaSfumaturaKey={`${cercaDifferita}\u0000${espansiEff.join("|")}`}
              idAccessor="lotto"
              storeColumnsKey="spedizioni-effettuate-v10"
              minColumnWidths={{ data: 86, azione: 92 }}
              fixedColumnWidths={["data"]}
              // Flash della riga appena creata (FASE 7C): evidenzia il nuovo lotto pochi secondi.
              rowClassName={rowClassNameEff}
              sortStatus={sortG}
              onSortStatusChange={setSortG}
              selectedRecords={selezioneEff}
              onSelectedRecordsChange={setSelezioneEff}
              selectionColumnStyle={{ width: 40, minWidth: 40, maxWidth: 40 }}
              rowExpansion={rowExpansionEffettuate}
            />
          )}
          </Box>
        </Box>
      </Stack>

      <CreaSpedizioneModal
        ordini={creaTarget}
        bozze={bozzeBollettazione ?? bozzeModal}
        bollettazioneRows={righeBollettazioneSpedizione ?? undefined}
        bollettazioneDataArrivo={dataArrivoBollettazioneSpedizione}
        // Mentre l'editor è aperto sopra, il modale resta vivo ma sospeso (vd. «correggi
        // indirizzo»): non lo chiudiamo, così la lavorazione (corriere, colli, unioni) non va persa.
        sospeso={!!editor && !!creaTarget}
        onClose={() => {
          setCreaTarget(null);
          setRigheBollettazioneSpedizione(null);
          setDataArrivoBollettazioneSpedizione(undefined);
          setBozzeBollettazione(undefined);
        }}
        onApriOrdine={(ordineId) => {
          const o = (creaTarget ?? []).find((x) => x.ordineId === ordineId);
          setEditor({ ordineId, numero: o?.numero });
        }}
        onDone={() => {
          // Snapshot dei lotti correnti per riconoscere quello appena creato, poi mostra
          // la fioritura e porta l'utente sulle Effettuate dove la nuova spedizione appare.
          lottiPrimaRef.current = new Set(effettuate.map((s) => s.lotto));
          attesaNuoviRef.current = true;
          setCreaTarget(null);
          setRigheBollettazioneSpedizione(null);
          setDataArrivoBollettazioneSpedizione(undefined);
          setBozzeBollettazione(undefined);
          setSelezione([]);
          setCerca("");
          cambiaVista("effettuate");
          // `setSpedito(true)` NON qui: la fioritura si accende quando arrivano le Effettuate
          // fresche, già con la distinta (vedi l'effetto sopra), così non si auto-chiude.
          carica(true);
        }}
      />

      <BollettazioneReviewModal
        analysis={analisiBollettazione}
        onClose={() => setAnalisiBollettazione(null)}
        onPrepareShipment={preparaSpedizioneBollettazione}
        onArrived={() => {
          setAnalisiBollettazione(null);
          setSelezione([]);
          carica(true);
        }}
      />

      <OrdineEditor
        editor={editor}
        identity={identity}
        onClose={() => setEditor(null)}
        onSaved={async () => {
          setEditor(null);
          // Se stavamo correggendo un ordine dal modale "Crea spedizione" sospeso, aggiorna
          // solo lo snapshot degli ordini (indirizzo corretto) e riapri il modale com'era.
          if (creaTarget) {
            try {
              const fresh = await api.righeDaSpedire();
              setDaSpedire(fresh);
              setCreaTarget((cur) =>
                cur
                  ? cur.map(
                      (c) => fresh.find((f) => f.ordineId === c.ordineId) ?? c,
                    )
                  : cur,
              );
            } catch (err) {
              toast.error(`Aggiornamento ordine non riuscito: ${err}`);
            }
          } else {
            carica(true);
          }
        }}
      />
    </Pagina>
  );
}
