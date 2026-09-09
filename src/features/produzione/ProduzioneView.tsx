// Pagina Produzione (FASE 5A/5B): ordini Immunoterapia verso Laboratorio, sul modello Spedizioni
// (una pagina, due viste via SegmentedControl) ma a **righe-tendina** (Paper + Collapse):
//  · «Da produrre»   → la coda: ordini Nuovo/Confermato, con in cima l'acconto incassato;
//                      selezione multipla → «Manda in produzione» (un invio = un LOTTO).
//  · «In lavorazione»→ ordini già In produzione / Arrivato IT, **raggruppati per lotto di invio**
//                      (come le spedizioni Effettuate): annulla singolo/lotto, Unisci/Separa
//                      lotti, «Segna arrivato IT» a lotto intero o sul singolo ordine; filtro
//                      per periodo sulla data di invio. L'export (5C) riguarderà il lotto intero.
// I pagamenti NON si toccano: l'acconto mancante è solo un avviso.
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Autocomplete,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Group,
  Menu,
  MultiSelect,
  Paper,
  SegmentedControl,
  Stack,
  TagsInput,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowBackUp,
  IconArrowMerge,
  IconArrowsSplit2,
  IconCalendar,
  IconChevronDown,
  IconChevronRight,
  IconClipboardList,
  IconFileExport,
  IconFlask2,
  IconHammer,
  IconPackageImport,
  IconPackages,
  IconPencil,
  IconSearch,
  IconTestPipe,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { useIntersection } from "@mantine/hooks";
import { api, type Campi, type Identity, type OrdineDto, type RecordDto } from "../../lib/tauri";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import { usePrefs } from "../../lib/prefs";
import { leggiBaseProduzione } from "./numeroProduzione";
import { Pagina, usePaginaPronta } from "../../pages/Pagina";
import { FiltriPopover } from "../../ui/FiltriPopover";
import { mostraFlourish } from "../../ui/monetina";
import { DebouncedInput } from "../../ui/DebouncedInput";
import { ContextMenuPuntuale, puntoDaEventoContextMenu } from "../../ui/ContextMenuTarget";
import { MenuAzioniRiga } from "../../ui/MenuAzioniRiga";
import { FiltroIntervalloDate } from "../../ui/FiltroIntervalloDate";
import { EsportaTabella, type ColonnaExport } from "../../ui/esporta/EsportaTabella";
import { categoriaDef } from "../anagrafiche/categorie";
import { centsToEurStr } from "../../lib/money";
import { setConToggle } from "../../lib/set";
import { statoDef } from "../giornaliero/stati";
import { OrdineEditor, type EditorTarget } from "../giornaliero/OrdineEditor";
import { apriFinestraOrdine } from "../giornaliero/apriFinestra";
import { useDeepLink } from "../../shell/navigazione";
import {
  campiDiagnostica,
  campiProduzione,
  diagnosticaIncompleta,
  nomeProdotto,
  rigaProduzioneCompleta,
  suggerimentiProduzione,
  type Suggerimenti,
} from "./datiProduzione";
import { gruppiRigheIncomplete } from "./gruppiProduzione";
import { CompilaProduzioneModal, type CompilaTarget } from "./CompilaProduzioneModal";
import { InProduzioneFlourish } from "./InProduzioneFlourish";
import { useCloseOnScroll } from "../../lib/closeOnScroll";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { estremiPeriodoIso, formattaDataFileItaliana, formattaDataSeparataItaliana as dataIt, oggiIso as oggi } from "../../lib/date";
import {
  DataConsegnaPrevistaModal,
  type DataConsegnaTarget,
  type RigaDataConsegnaPrevista,
} from "./DataConsegnaPrevistaModal";
import type { GruppoLotto } from "./tipiProduzione";

const LINEA = "Immunoterapia";
const DURATA_APERTURA_LOTTO_MS = 140;
const EASING_APERTURA_LOTTO = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const EVENTI_RICARICA = [
  "ordine:salvato",
  "pagamento:salvato",
  "prodotto:salvato",
  "prodotto_produzione:salvato",
  "cliente:salvato",
  "medico:salvato",
  "agente:salvato",
] as const;

/** Slot animato per le card di Produzione (coda e lotti): all'uscita dalla lista
 *  (ordine mandato in produzione, lotto arrivato/annullato) scivola a destra e collassa.
 *  NB: niente `layout` — il riassesto via layout di Framer, espandendo/comprimendo una
 *  card, ne scalava la larghezza (le card «si allargavano» in modo orribile). Le card
 *  rimaste si riassestano col normale flusso. Con «Riduci animazioni» resta un Box. */
function CardSlot({
  ridotte,
  entra = false,
  index = 0,
  children,
}: {
  ridotte: boolean;
  /** Entrata "a cascata" una volta sola al caricamento (stagger per `index`). Fuori da
   *  quella finestra resta `false`: filtri/invii non ri-animano l'ingresso (solo l'uscita). */
  entra?: boolean;
  index?: number;
  children: ReactNode;
}) {
  if (ridotte) return <Box>{children}</Box>;
  return (
    <motion.div
      // L'INGRESSO è CSS (`pt-card-anim` sul wrapper interno): leggero, niente spring JS per
      // card (era la causa del lag). L'USCITA resta framer (scivolata+collasso a card singola).
      initial={false}
      exit={{ opacity: 0, x: 48, height: 0, marginBottom: -8, transition: { duration: 0.28, ease: [0.2, 0.8, 0.2, 1] } }}
      style={{ overflow: "hidden" }}
    >
      {/* Wrapper SEMPRE presente (anche senza entrata) così spegnendo `entra` non si rimonta
          la card. Classe + delay solo durante la finestra d'entrata. */}
      <div
        className={entra ? "pt-card-anim" : undefined}
        style={entra ? { animationDelay: `${Math.min(index, 14) * 30}ms` } : undefined}
      >
        {children}
      </div>
    </motion.div>
  );
}

/** Virtualizzazione per «blocco» (un gruppo-data della coda o un lotto): l'altezza totale
 *  della lista è SEMPRE riservata (segnaposto di altezza stimata/misurata), così la scrollbar
 *  è corretta dall'inizio e non si deve «arrivare in fondo per caricare». Il contenuto vero è
 *  costruito SOLO quando il blocco è vicino al viewport (`children` è una funzione → pigro):
 *  fuori schermo resta un div vuoto dell'altezza giusta → DOM leggero anche con migliaia di
 *  ordini. Conserva l'animazione d'uscita (collasso) quando un blocco lascia la lista.
 *  `root:null` funziona perché la pagina scorre nel contenitore della Shell (come `TabellaChunk`). */
function CardVirtuale({
  altezzaStimata,
  ridotte,
  children,
}: {
  altezzaStimata: number;
  ridotte: boolean;
  children: () => ReactNode;
}) {
  const { ref, entry } = useIntersection({ root: null, rootMargin: "900px 0px 900px 0px", threshold: 0 });
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [altezza, setAltezza] = useState(altezzaStimata);
  const visibile = entry?.isIntersecting ?? false;
  // Misura l'altezza reale quando è visibile, così il segnaposto (quando tornerà fuori
  // schermo) ha l'altezza esatta e lo scroll non «salta».
  useLayoutEffect(() => {
    if (visibile && innerRef.current) {
      const h = innerRef.current.offsetHeight;
      if (h > 0 && Math.abs(h - altezza) > 0.5) setAltezza(h);
    }
  });
  const corpo = visibile ? (
    <div ref={innerRef}>{children()}</div>
  ) : (
    <div style={{ height: altezza }} aria-hidden />
  );
  if (ridotte) return <div ref={ref}>{corpo}</div>;
  return (
    <motion.div
      ref={ref}
      initial={false}
      exit={{ opacity: 0, height: 0, marginBottom: -8, transition: { duration: 0.28, ease: [0.2, 0.8, 0.2, 1] } }}
      style={{ overflow: "hidden" }}
    >
      {corpo}
    </motion.div>
  );
}

/** Un ordine è Diagnostica se la sua linea/categoria lo è (FASE 5D). Gli altri ordini di
 * produzione (Immunoterapia o senza categoria) seguono il flusso/export Laboratorio. */
function isDiagnostica(o: OrdineDto): boolean {
  return o.linee.includes("Diagnostica");
}

// --- Stato di produzione PER RIGA (FASE 7) ---
// Lo stato vive sulla riga; quello dell'ordine è derivato. `lotto_produzione` resta un
// indicatore legacy valido: evita che righe già agganciate a un lotto ricompaiano in coda.
const statoProdRiga = (r: RecordDto): string => (r.data.stato_produzione as string) || "";
const lottoRiga = (r: RecordDto): string => (r.data.lotto_produzione as string) || "";
const daProdurreRiga = (r: RecordDto): boolean => statoProdRiga(r) === "" && lottoRiga(r) === "";
const inLavorazioneRiga = (r: RecordDto): boolean =>
  statoProdRiga(r) === "in_produzione" || statoProdRiga(r) === "arrivato_it" || lottoRiga(r) !== "";
const daArrivareRiga = (r: RecordDto): boolean =>
  statoProdRiga(r) === "in_produzione" || (statoProdRiga(r) === "" && lottoRiga(r) !== "");
const arrivataRiga = (r: RecordDto): boolean => statoProdRiga(r) === "arrivato_it";

type Vista = "da_produrre" | "in_lavorazione";
type Periodo = "tutto" | "mese" | "scorso" | "custom";
const TAB_STORAGE = "pt.produzione.tab";


/** Una voce del resoconto (etichetta + valore), compatta. */
function Info({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={500} truncate maw={220}>
        {value || "—"}
      </Text>
    </Box>
  );
}

function BarraSelezione({
  etichetta,
  checked,
  indeterminate,
  onToggle,
  selezionati,
  onDeseleziona,
  children,
}: {
  etichetta: string;
  checked: boolean;
  indeterminate: boolean;
  onToggle: () => void;
  selezionati: number;
  onDeseleziona: () => void;
  children: ReactNode;
}) {
  return (
    <Paper withBorder p="xs" radius="md" bg="var(--mantine-color-default-hover)">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="md" wrap="nowrap">
          <Checkbox label={etichetta} checked={checked} indeterminate={indeterminate} onChange={onToggle} />
          {selezionati > 0 && <Button size="compact-xs" variant="subtle" color="gray" onClick={onDeseleziona}>Deseleziona ({selezionati})</Button>}
        </Group>
        {children}
      </Group>
    </Paper>
  );
}

/** Badge dello stato dell'acconto: incassato (verde + data), atteso, o nessuno. */
function AccontoBadge({ o }: { o: OrdineDto }) {
  if (o.accontoIncassato) {
    return (
      <Tooltip label={`Acconto incassato il ${dataIt(o.dataAcconto)}`} withArrow>
        <Badge color="teal" variant="light">
          Acconto incassato
        </Badge>
      </Tooltip>
    );
  }
  if (o.acconto > 0) {
    return (
      <Badge color="orange" variant="light">
        Acconto atteso € {centsToEurStr(o.acconto)}
      </Badge>
    );
  }
  return (
    <Badge color="gray" variant="light">
      Nessun acconto
    </Badge>
  );
}

function IdentitaOrdineProduzione({
  principale,
  colore,
  etichetta,
  secondario,
  prefissoSecondario,
}: {
  principale: string;
  colore: string;
  etichetta: string;
  secondario: string;
  prefissoSecondario: string;
}) {
  return (
    <>
      <Text fw={600} truncate>{principale}</Text>
      <Badge color={colore} variant="light" size="sm" style={{ flexShrink: 0 }}>{etichetta}</Badge>
      {secondario && <Text size="sm" c="dimmed" truncate>{prefissoSecondario}{secondario}</Text>}
    </>
  );
}

/** Riga d'ordine con i **dati di produzione** editabili (FASE 5B): formulazione, posologia,
 * allergeni/ceppi. Autocomplete dal catalogo canonico + storico. Salva onBlur/onChange. */
function RigaProduzione({
  riga,
  nome,
  sugg,
  onSaved,
}: {
  riga: RecordDto;
  nome: string;
  sugg: Suggerimenti;
  onSaved: () => void;
}) {
  const orig = riga.data;
  const [form, setForm] = useState((orig.formulazione as string) || "");
  const [pos, setPos] = useState((orig.posologia as string) || "");
  const [all, setAll] = useState<string[]>(Array.isArray(orig.allergeni) ? (orig.allergeni as string[]) : []);
  const paz = (orig.paziente as string) || "";
  const qta = typeof orig.qta === "number" ? orig.qta : 1;

  async function salva(patch: Campi) {
    try {
      await api.recordUpdate("riga_ordine", riga.id, patch);
      onSaved();
    } catch (e) {
      toast.error(`Salvataggio non riuscito: ${e}`);
    }
  }

  return (
    <Paper withBorder p="xs" radius="sm" bg="var(--mantine-color-body)">
      <Group justify="space-between" wrap="nowrap" mb={6}>
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm" fw={600} truncate>
            {nome}
          </Text>
          <Text size="xs" c="dimmed">
            ×{qta}
          </Text>
        </Group>
        {paz && (
          <Badge variant="light" color="gray" size="sm">
            Paz. {paz}
          </Badge>
        )}
      </Group>
      <Group grow gap="xs" wrap="nowrap" align="flex-start">
        <Autocomplete
          label="Formulazione"
          placeholder="—"
          size="xs"
          data={sugg.formulazioni}
          value={form}
          onChange={setForm}
          onBlur={() => {
            if (form !== ((orig.formulazione as string) || "")) salva({ formulazione: form });
          }}
          comboboxProps={{ withinPortal: false }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && form) {
              const t = form.toLowerCase();
              const first = sugg.formulazioni.find(x => x.toLowerCase().includes(t));
              if (first) {
                setForm(first);
                if (first !== ((orig.formulazione as string) || "")) salva({ formulazione: first });
              }
            }
          }}
        />
        <Autocomplete
          label="Posologia"
          placeholder="—"
          size="xs"
          data={sugg.posologie}
          value={pos}
          onChange={setPos}
          onBlur={() => {
            if (pos !== ((orig.posologia as string) || "")) salva({ posologia: pos });
          }}
          comboboxProps={{ withinPortal: false }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && pos) {
              const t = pos.toLowerCase();
              const first = sugg.posologie.find(x => x.toLowerCase().includes(t));
              if (first) {
                setPos(first);
                if (first !== ((orig.posologia as string) || "")) salva({ posologia: first });
              }
            }
          }}
        />
      </Group>
      <TagsInput
        label="Allergeni / ceppi (max 10)"
        placeholder={all.length === 0 ? "Aggiungi…" : undefined}
        size="xs"
        mt="xs"
        maxTags={10}
        data={sugg.allergeni}
        value={all}
        onChange={(v) => {
          setAll(v);
          salva({ allergeni: v });
        }}
        comboboxProps={{ withinPortal: false }}
      />
    </Paper>
  );
}

/** Un lotto di produzione (sessione di invio) raggruppa le RIGHE mandate insieme (FASE 7),
 *  presentate per ordine. `righeLotto` = per ogni ordine, solo le sue righe di questo lotto. */
/** Nome file di export di un lotto: prefisso + data invio (gg-mm-aaaa) + conteggio righe del
 *  file (`n unita`, es. «set» per Laboratorio, «test» per Diagnostica) + eventuale "unito".
 *  Es. «Laboratorio 01-04-2026 23 set». Il conteggio è quello delle righe reali, non degli ordini. */
function nomeFileLotto(prefisso: string, g: GruppoLotto, n: number, unita: string): string {
  const data = formattaDataFileItaliana(g.dataInvio);
  return [prefisso, data, n > 0 ? `${n} ${unita}` : "", g.unito ? "unito" : ""]
    .filter(Boolean)
    .join(" ");
}

// ---- Export per linea (FASE 5C/5D) ----------------------------------------------------
// L'export riusa il **modale globale** `EsportaTabella` (anteprima + scelta path/orientamento):
// le colonne sotto descrivono l'anteprima, mentre il file vero lo scrive il backend dedicato
// (`laboratorioExport`/`diagnosticaExport`) via `salvaCustom`, così resta il formato Laboratorio (col C
// sommata + n° produzione persistito) e quello Diagnostica. La «linea» è l'analogo del corriere
// delle Spedizioni: lotto a una linea → bottone diretto; lotto misto → menu con le due voci.

/** Una riga d'anteprima Laboratorio (un set di fiale per paziente). Importi in **centesimi**. */
interface RigaLaboratorioPreview {
  acconto: number | "";
  numero: number | "";
  dataInvio: string;
  agente: string;
  medico: string;
  paziente: string;
  valore: number | "";
  dataPrevista: string;
  formulazione: string;
  posologia: string;
  allergeni: string;
}

/** Una riga d'anteprima Diagnostica (un allergene/test). */
interface RigaDiagPreview {
  numero: string;
  cliente: string;
  allergene: string;
  tipoTest: string;
  ml: string;
  qta: number;
  valore: number | "";
}

const COL_LABORATORIO: ColonnaExport<RigaLaboratorioPreview>[] = [
  { key: "acconto", label: "Acconto", tipo: "euro", totale: true, valore: (r) => r.acconto },
  { key: "numero", label: "N° prod.", tipo: "numero", valore: (r) => r.numero },
  { key: "dataInvio", label: "Data invio", tipo: "data", valore: (r) => r.dataInvio },
  { key: "agente", label: "Agente", valore: (r) => r.agente },
  { key: "medico", label: "Medico", valore: (r) => r.medico },
  { key: "paziente", label: "Paziente", valore: (r) => r.paziente },
  { key: "valore", label: "Valore", tipo: "euro", totale: true, valore: (r) => r.valore },
  { key: "dataPrevista", label: "Data prevista", valore: (r) => r.dataPrevista },
  { key: "formulazione", label: "Formulazione", valore: (r) => r.formulazione },
  { key: "posologia", label: "Posologia", valore: (r) => r.posologia },
  { key: "allergeni", label: "Allergeni", valore: (r) => r.allergeni },
];

const COL_DIAG: ColonnaExport<RigaDiagPreview>[] = [
  { key: "numero", label: "Ordine", valore: (r) => r.numero },
  { key: "cliente", label: "Cliente", valore: (r) => r.cliente },
  { key: "allergene", label: "Allergene", valore: (r) => r.allergene },
  { key: "tipoTest", label: "Tipo test", valore: (r) => r.tipoTest },
  { key: "ml", label: "ML", valore: (r) => r.ml },
  { key: "qta", label: "Q.tà", tipo: "numero", valore: (r) => r.qta },
  { key: "valore", label: "Valore", tipo: "euro", totale: true, valore: (r) => r.valore },
];

/** Quale file generare per un lotto. */
type LineaExport = "immuno" | "diag";

export function ProduzioneView({ identity }: { identity: Identity }) {
  const [vista, setVista] = useState<Vista>(() => {
    const saved = localStorage.getItem(TAB_STORAGE);
    return saved === "in_lavorazione" || saved === "da_produrre" ? saved : "da_produrre";
  });
  const [ordini, setOrdini] = useState<OrdineDto[]>([]);
  const [righe, setRighe] = useState<RecordDto[]>([]);
  const [prodMap, setProdMap] = useState<Map<string, string>>(new Map());
  const [catalogo, setCatalogo] = useState<RecordDto[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [cerca, setCerca] = useState("");
  const cercaDifferita = useDeferredValue(cerca);
  const [filtroAgenti, setFiltroAgenti] = useState<string[]>([]);
  const [filtroAcconto, setFiltroAcconto] = useState<"tutti" | "incassato" | "atteso">("tutti");
  const [periodo, setPeriodo] = useState<Periodo>("tutto");
  const [da, setDa] = useState("");
  const [a, setA] = useState("");

  const [selezione, setSelezione] = useState<Set<string>>(new Set()); // ordini (Da produrre)
  const [selLotti, setSelLotti] = useState<Set<string>>(new Set()); // lotti (In lavorazione)
  const [espansi, setEspansi] = useState<Set<string>>(new Set()); // ordini espansi
  const [lottiEspansi, setLottiEspansi] = useState<Set<string>>(new Set()); // lotti espansi
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [ordineGenericoDaCompletare, setOrdineGenericoDaCompletare] = useState<string | null>(null);
  const [compila, setCompila] = useState<CompilaTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; order: OrdineDto; contesto: "coda" | "lotto"; rows: RecordDto[]; lotto?: GruppoLotto } | null>(null);
  // Export via modale globale: lotto + linea + fallback temporaneo (col J Laboratorio) da usare.
  const [esporta, setEsporta] = useState<{ g: GruppoLotto; linea: LineaExport; dataPrev: string } | null>(null);
  const [dataConsegna, setDataConsegna] = useState<DataConsegnaTarget | null>(null);

  const [lottoInviato, setLottoInviato] = useState<string | null>(null);
  const [inProduzione, setInProduzione] = useState(false);
  const [esportaLotto, setEsportaLotto] = useState<GruppoLotto | null>(null);

  const { ordineFinestra, anno, ridurreAnimazioni } = usePrefs();
  useCloseOnScroll(!!contextMenu, (v) => {
    if (!v) setContextMenu(null);
  });
  // Seme del N° produzione: ora condiviso fra i PC (modello dati), non più per-PC.
  const [numeroProduzioneBase, setNumeroProduzioneBase] = useState(1);
  useEffect(() => {
    leggiBaseProduzione().then(setNumeroProduzioneBase).catch(() => {});
  }, []);
  usePaginaPronta(caricamento);

  function cambiaVista(v: Vista) {
    setVista(v);
    localStorage.setItem(TAB_STORAGE, v);
  }

  const { link: deepLink, consuma } = useDeepLink("/produzione");
  useEffect(() => {
    if (!deepLink) return;
    if (deepLink.tab === "in_lavorazione" || deepLink.tab === "da_produrre") {
      cambiaVista(deepLink.tab);
    }
    setCerca(deepLink.cerca ?? "");
    setFiltroAgenti(deepLink.agenteIds ?? []);
    setFiltroAcconto(deepLink.produzioneAcconto ?? "tutti");
    if (deepLink.dal || deepLink.al) {
      setPeriodo("custom");
      setDa(deepLink.dal ?? "");
      setA(deepLink.al ?? "");
    } else {
      setPeriodo("tutto");
      setDa("");
      setA("");
    }
    consuma();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink]);

  // Entrata "a cascata" delle card: una finestra breve in cui le card entrano scaglionate,
  // poi si spegne (filtri/invii successivi non ri-animano l'ingresso, solo l'uscita). Si
  // (ri)arma al primo caricamento e ad ogni cambio vista (coda ↔ lavorazione = lista nuova).
  // Parte già attiva → niente frame "piatto" prima. Con «Riduci animazioni» niente entrata.
  const [entrata, setEntrata] = useState(true);
  useEffect(() => {
    if (ridurreAnimazioni) {
      setEntrata(false);
      return;
    }
    if (caricamento) return;
    setEntrata(true);
    const t = setTimeout(() => setEntrata(false), 1300);
    return () => clearTimeout(t);
  }, [caricamento, ridurreAnimazioni]);

  // Cambiando vista, azzero le selezioni (le azioni sono diverse per vista).
  useEffect(() => {
    setSelezione(new Set());
    setSelLotti(new Set());
  }, [vista]);

  const carica = useCallback(async () => {
    try {
      const [o, rg, pr, cat] = await Promise.all([
        api.ordiniLista(),
        api.recordsList("riga_ordine"),
        api.recordsList("prodotto"),
        api.recordsList("prodotto_produzione"),
      ]);
      // Immunoterapia e Diagnostica (vanno nello stesso file/lotti Laboratorio, FASE 5D);
      // esclusi i rifiutati e Keriba (canale informale, non va a Laboratorio).
      setOrdini(
        o.filter(
          (x) =>
            x.stato !== "Rifiutato" &&
            (x.linee.includes(LINEA) || x.linee.includes("Diagnostica"))
        )
      );
      setRighe(rg);
      setProdMap(new Map(pr.map((p) => [p.id, (p.data.nome as string) || ""])));
      setCatalogo(cat);
    } catch (e) {
      toast.error(`Caricamento non riuscito: ${e}`);
    } finally {
      setCaricamento(false);
    }
  }, []);

  useEffect(() => {
    carica();
    const iv = setInterval(carica, 8000);
    return () => clearInterval(iv);
  }, [carica]);
  useRicaricaSuEventi(EVENTI_RICARICA, carica, 160);

  // Righe di prodotto per ordine (per le card espanse) + pazienti distinti per resoconto.
  const righePerOrdine = useMemo(() => {
    const m = new Map<string, RecordDto[]>();
    for (const r of righe) {
      const oid = (r.data.ordine_id as string) || "";
      if (!oid) continue;
      (m.get(oid) ?? m.set(oid, []).get(oid)!).push(r);
    }
    return m;
  }, [righe]);

  // Suggerimenti dati produzione = valori canonici (catalogo) + storico già compilato sulle
  // righe (così l'autocompletamento impara da ciò che si è già scritto). FASE 5B (A + C).
  // Stessa logica usata anche nell'editor ordine (auto-compilazione coerente).
  const sugg = useMemo<Suggerimenti>(() => suggerimentiProduzione(catalogo, righe), [catalogo, righe]);

  const ordineById = useMemo(() => new Map(ordini.map((o) => [o.id, o])), [ordini]);

  const pazientiByOrdine = useMemo(() => {
    const map = new Map<string, string>();
    for (const [ordineId, rows] of righePerOrdine) {
      const pazienti = rows
        .map((r) => (r.data.paziente as string) || "")
        .filter((p) => p.trim());
      map.set(ordineId, [...new Set(pazienti)].join(", "));
    }
    return map;
  }, [righePerOrdine]);

  function pazientiDi(o: OrdineDto): string {
    return pazientiByOrdine.get(o.id) ?? "";
  }

  const ricercaProduzione = cercaDifferita.trim().toLowerCase();
  const testoRicercaOrdine = useCallback(
    (o: OrdineDto, rows: RecordDto[] = righePerOrdine.get(o.id) ?? []) =>
      [
        o.numero,
        o.clienteNome,
        o.medicoNome,
        o.clienteCitta,
        o.clienteTelefono,
        o.clienteTelefono?.replace(/\D/g, ""),
        o.agenteNome,
        pazientiByOrdine.get(o.id) ?? "",
        ...(o.numeriLotto ?? []),
        o.data,
        dataIt(o.data),
        o.dataProduzione || "",
        o.dataProduzione ? dataIt(o.dataProduzione) : "",
        ...rows.map((r) =>
          [
            nomeProdotto(prodMap, r),
            r.data.paziente,
            r.data.formulazione,
            r.data.posologia,
            r.data.numero,
            Array.isArray(r.data.allergeni) ? (r.data.allergeni as string[]).join(" ") : "",
            r.data.tipo_test,
            r.data.codice_laboratorio,
          ].join(" ")
        ),
      ]
        .join(" ")
        .toLowerCase(),
    [pazientiByOrdine, prodMap, righePerOrdine]
  );
  const ordineCorrispondeRicerca = useCallback(
    (o: OrdineDto, rows?: RecordDto[]) => !ricercaProduzione || testoRicercaOrdine(o, rows).includes(ricercaProduzione),
    [ricercaProduzione, testoRicercaOrdine]
  );

  // Conteggi per le etichette del SegmentedControl: in «Da produrre» rientrano anche gli
  // ordini ancora senza prodotto, così il badge coincide con le card realmente visibili.
  const nDaProdurre = useMemo(
    () =>
      ordini.filter(
        (o) => {
          const rows = righePerOrdine.get(o.id) ?? [];
          return !["Spedito", "Chiuso", "Rifiutato"].includes(o.stato) &&
            (rows.length === 0 || rows.some(daProdurreRiga));
        }
      ).length,
    [ordini, righePerOrdine]
  );
  const nInLavorazione = useMemo(
    () => ordini.filter((o) => (righePerOrdine.get(o.id) ?? []).some(inLavorazioneRiga)).length,
    [ordini, righePerOrdine]
  );

  // Agenti presenti fra gli ordini Immunoterapia (per il filtro).
  const opzioniAgenti = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of ordini) if (o.agenteId) m.set(o.agenteId, o.agenteNome || "—");
    return [...m.entries()].map(([value, label]) => ({ value, label }));
  }, [ordini]);

  const filtroAgentiSet = useMemo(() => new Set(filtroAgenti), [filtroAgenti]);

  // Filtro per-ordine per costruire le viste. In «In lavorazione» agente, acconto e
  // ricerca NON vanno applicati qui: prima si costruiscono gli invii completi e poi si
  // decide quali mostrare con una corrispondenza esistenziale sul lotto.
  const filtrati = useMemo(() => {
    return ordini.filter((o) => {
      // Vista per PRESENZA di righe (FASE 7): «Da produrre» = l'ordine ha ≥1 riga da produrre
      // (e non è già spedito/chiuso/rifiutato); «In lavorazione» = ha ≥1 riga in lavorazione.
      // Un ordine con righe in entrambi gli stati compare in ENTRACORRIERE_C le viste (righe filtrate).
      const rgh = righePerOrdine.get(o.id) ?? [];
      if (vista === "da_produrre") {
        if (["Spedito", "Chiuso", "Rifiutato"].includes(o.stato)) return false;
        // Un ordine senza righe prodotto è lavoro da completare, quindi deve essere
        // visibile nella coda anche prima che qualcuno lo cerchi.
        if (rgh.length > 0 && !rgh.some(daProdurreRiga)) return false;
      } else {
        if (!rgh.some(inLavorazioneRiga)) return false;
      }
      if (anno !== 0 && Number(o.data.slice(0, 4)) !== anno) return false;
      if (vista === "in_lavorazione") return true;
      if (filtroAgentiSet.size > 0 && !filtroAgentiSet.has(o.agenteId)) return false;
      if (filtroAcconto === "incassato" && !o.accontoIncassato) return false;
      if (filtroAcconto === "atteso" && o.accontoIncassato) return false;
      return ordineCorrispondeRicerca(o);
    });
  }, [ordini, vista, filtroAgentiSet, filtroAcconto, anno, righePerOrdine, ricercaProduzione, ordineCorrispondeRicerca]);

  // ---- «Da produrre»: lista piatta ordinata (Confermato prima, dal più vecchio al più nuovo) ----
  const codaOrdinata = useMemo(() => {
    const arr = [...filtrati];
    arr.sort((a, b) => {
      const isConfA = a.stato === "Confermato";
      const isConfB = b.stato === "Confermato";
      if (isConfA !== isConfB) return isConfA ? -1 : 1;
      const cmpData = a.data.localeCompare(b.data);
      if (cmpData !== 0) return cmpData;
      return a.numero.localeCompare(b.numero, "it", { numeric: true });
    });
    return arr;
  }, [filtrati]);

  // Coda raggruppata per stato confermato + data ordine (dal più vecchio al più nuovo)
  const codaGruppiData = useMemo(() => {
    const m = new Map<string, { isConfermato: boolean; data: string; ordini: OrdineDto[] }>();
    for (const o of filtrati) {
      const isConfermato = o.stato === "Confermato";
      const key = `${isConfermato ? "conf" : "altro"}_${o.data}`;
      if (!m.has(key)) {
        m.set(key, { isConfermato, data: o.data, ordini: [] });
      }
      m.get(key)!.ordini.push(o);
    }
    const gs = [...m.values()].map((g) => ({
      ...g,
      ordini: g.ordini.sort((a, b) => {
        return a.numero.localeCompare(b.numero, "it", { numeric: true });
      }),
    }));
    gs.sort((a, b) => {
      if (a.isConfermato !== b.isConfermato) return a.isConfermato ? -1 : 1;
      return a.data.localeCompare(b.data);
    });
    return gs;
  }, [filtrati]);

  const ordiniGlobalIdx = useMemo(() => {
    const idxs = new Map<string, number>();
    let count = 0;
    for (const grp of codaGruppiData) {
      for (const o of grp.ordini) {
        idxs.set(o.id, count++);
      }
    }
    return idxs;
  }, [codaGruppiData]);

  // ---- «In lavorazione»: raggruppa per lotto di invio, poi filtra per periodo ----
  const bounds = estremiPeriodoIso(periodo, da, a);
  const gruppi = useMemo(() => {
    if (vista !== "in_lavorazione") return [] as GruppoLotto[];
    const map = new Map<string, GruppoLotto>();
    for (const o of filtrati) {
      // Righe in lavorazione di questo ordine, raggruppate per LOTTO (FASE 7): lo stesso
      // ordine può comparire sotto più lotti (invii parziali in momenti diversi).
      const perLotto = new Map<string, RecordDto[]>();
      for (const r of (righePerOrdine.get(o.id) ?? []).filter(inLavorazioneRiga)) {
        const l = lottoRiga(r) || `_${o.id}`;
        (perLotto.get(l) ?? perLotto.set(l, []).get(l)!).push(r);
      }
      for (const [l, rows] of perLotto) {
        // Data di invio del lotto: dalla data salvata SULLA RIGA all'invio (la data reale,
        // odierna), con fallback alla testata dell'ordine per i lotti vecchi (pre-FASE 7).
        const dataLottoRiga =
          rows.map((r) => (r.data.data_produzione as string) || "").filter(Boolean).sort()[0] ||
          o.dataProduzione;
        let g = map.get(l);
        if (!g) {
          g = {
            lotto: l,
            ordini: [],
            righeLotto: new Map(),
            dataInvio: dataLottoRiga,
            totale: 0,
            nInProd: 0,
            nArrivati: 0,
            unito: false,
          };
          map.set(l, g);
        }
        g.ordini.push(o);
        g.righeLotto.set(o.id, rows);
        for (const r of rows) {
          g.totale += typeof r.data.prezzo === "number" ? (r.data.prezzo as number) : 0;
          if (arrivataRiga(r)) g.nArrivati += 1;
          else g.nInProd += 1;
          if (((r.data.lotto_produzione_pre as string) || "") !== "") g.unito = true;
        }
        if (dataLottoRiga && (!g.dataInvio || dataLottoRiga < g.dataInvio)) g.dataInvio = dataLottoRiga;
      }
    }
    let arr = [...map.values()];
    if (bounds) arr = arr.filter((g) => g.dataInvio >= bounds[0] && g.dataInvio <= bounds[1]);
    // I filtri della vista «In lavorazione» selezionano INVII, non singoli ordini:
    // basta una corrispondenza e il lotto resta visibile per intero.
    if (filtroAgentiSet.size > 0) {
      arr = arr.filter((g) => g.ordini.some((o) => filtroAgentiSet.has(o.agenteId)));
    }
    if (filtroAcconto !== "tutti") {
      const richiedeIncassato = filtroAcconto === "incassato";
      arr = arr.filter((g) => g.ordini.some((o) => o.accontoIncassato === richiedeIncassato));
    }
    if (ricercaProduzione) {
      arr = arr.filter(
        (g) =>
          [g.lotto, g.dataInvio, dataIt(g.dataInvio)].join(" ").toLowerCase().includes(ricercaProduzione) ||
          g.ordini.some((o) => ordineCorrispondeRicerca(o, g.righeLotto.get(o.id) ?? []))
      );
    }
    arr.sort((a, b) => (b.dataInvio || "").localeCompare(a.dataInvio || ""));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    vista,
    filtrati,
    periodo,
    da,
    a,
    righePerOrdine,
    filtroAgentiSet,
    filtroAcconto,
    ricercaProduzione,
    ordineCorrispondeRicerca,
  ]);


  // Quando arriva il nuovo lotto dopo l'invio, mostra il popup InProduzioneFlourish
  useEffect(() => {
    if (lottoInviato && gruppi.length > 0) {
      const g = gruppi.find((x) => x.lotto === lottoInviato);
      if (g) {
        setEsportaLotto(g);
        setInProduzione(true);
        // Mostra il lotto appena creato già aperto, ma lascia compatti gli ordini al suo
        // interno: durante la selezione in coda potevano essere rimasti espansi.
        setLottiEspansi((s) => new Set(s).add(g.lotto));
        setEspansi((s) => {
          const n = new Set(s);
          g.ordini.forEach((o) => n.delete(o.id));
          return n;
        });
        setLottoInviato(null);
      }
    }
  }, [gruppi, lottoInviato]);

  const nFiltri =
    (filtroAgenti.length > 0 ? 1 : 0) +
    (filtroAcconto !== "tutti" ? 1 : 0) +
    (vista === "in_lavorazione" && periodo !== "tutto" ? 1 : 0);

  function azzeraFiltri() {
    setFiltroAgenti([]);
    setFiltroAcconto("tutti");
    setPeriodo("tutto");
    setDa("");
    setA("");
  }

  const haFiltri = !!cerca || nFiltri > 0;

  // ---- Selezione «Da produrre» (RIGHE, non ordini — FASE 7) ----
  // `selezione` contiene rigaId di righe «da produrre». L'invio crea un lotto con QUESTE righe.
  const righeDaProdDi = useCallback(
    (oid: string) => (righePerOrdine.get(oid) ?? []).filter(daProdurreRiga),
    [righePerOrdine]
  );
  const righeDaProdVisibili = useMemo(() => {
    const ids: string[] = [];
    for (const o of codaOrdinata) for (const r of righeDaProdDi(o.id)) ids.push(r.id);
    return ids;
  }, [codaOrdinata, righeDaProdDi]);
  const setVisibili = useMemo(() => new Set(righeDaProdVisibili), [righeDaProdVisibili]);
  const selVisibili = useMemo(
    () => [...selezione].filter((id) => setVisibili.has(id)),
    [selezione, setVisibili]
  );
  // La ricerca cambia soltanto ciò che si vede: le righe già spuntate restano nella
  // selezione operativa finché sono ancora realmente «da produrre».
  const righeDaProdurreSet = useMemo(
    () => new Set(righe.filter(daProdurreRiga).map((r) => r.id)),
    [righe]
  );
  const selezionateDaProdurre = useMemo(
    () => [...selezione].filter((id) => righeDaProdurreSet.has(id)),
    [selezione, righeDaProdurreSet]
  );
  const tuttiSelezionati =
    righeDaProdVisibili.length > 0 && selVisibili.length === righeDaProdVisibili.length;

  useEffect(() => {
    if (!ordineGenericoDaCompletare) return;
    const nuove = righeDaProdDi(ordineGenericoDaCompletare);
    if (nuove.length === 0) return;
    setSelezione((corrente) => {
      const next = new Set(corrente);
      nuove.forEach((r) => next.add(r.id));
      return next;
    });
    setEspansi((corrente) => new Set(corrente).add(ordineGenericoDaCompletare));
    setOrdineGenericoDaCompletare(null);
  }, [ordineGenericoDaCompletare, righeDaProdDi]);

  // Spuntare la riga singola.
  function toggleRiga(rigaId: string, checked: boolean) {
    setSelezione((s) => {
      const n = new Set(s);
      checked ? n.add(rigaId) : n.delete(rigaId);
      return n;
    });
  }

  // Checkbox dell'ordine: spunta/togli TUTTE le sue righe da produrre **e** lo espande, così
  // l'utente compila i dati senza un click in più.
  function selezionaCoda(o: OrdineDto, checked: boolean) {
    const ids = righeDaProdDi(o.id).map((r) => r.id);
    if (checked && ids.length === 0) {
      void completaOrdineGenerico(o);
      return;
    }
    setSelezione((s) => {
      const n = new Set(s);
      ids.forEach((id) => (checked ? n.add(id) : n.delete(id)));
      return n;
    });
    setEspansi((s) => {
      const n = new Set(s);
      checked ? n.add(o.id) : n.delete(o.id);
      return n;
    });
  }

  function toggleTutti() {
    setSelezione((s) => {
      const n = new Set(s);
      if (tuttiSelezionati) righeDaProdVisibili.forEach((id) => n.delete(id));
      else righeDaProdVisibili.forEach((id) => n.add(id));
      return n;
    });
  }

  // ---- Selezione «In lavorazione» (lotti, per Unisci) ----
  const lottiVisibili = useMemo(() => new Set(gruppi.map((g) => g.lotto)), [gruppi]);
  const selLottiVis = useMemo(
    () => [...selLotti].filter((l) => lottiVisibili.has(l)),
    [selLotti, lottiVisibili]
  );
  const tuttiLottiSel = gruppi.length > 0 && selLottiVis.length === gruppi.length;

  function toggleSelLotto(lotto: string) {
    setSelLotti((corrente) => setConToggle(corrente, lotto));
  }

  function toggleTuttiLotti() {
    setSelLotti(tuttiLottiSel ? new Set() : new Set(gruppi.map((g) => g.lotto)));
  }

  function toggleEspandi(id: string) {
    setEspansi((corrente) => setConToggle(corrente, id));
  }

  function toggleEspandiLotto(lotto: string) {
    setLottiEspansi((corrente) => setConToggle(corrente, lotto));
  }

  async function apri(
    ordineId: string | null,
    numero?: string,
    categoria?: string,
    focus?: EditorTarget["focus"]
  ) {
    const usaFinestra = ordineFinestra === "sempre" || (ordineFinestra === "modifica" && ordineId !== null);
    if (usaFinestra && (await apriFinestraOrdine(ordineId, numero, identity, categoria, undefined, focus))) return;
    setEditor({ ordineId, numero, categoria, focus });
  }

  async function completaOrdineGenerico(o: OrdineDto) {
    setOrdineGenericoDaCompletare(o.id);
    await apri(o.id, o.numero, undefined, { sezione: "prodotti" });
  }

  // Esegue un'operazione asincrona con feedback standard + ricarica.
  async function esegui(fn: () => Promise<unknown>, ok: string, animato = false) {
    setSalvando(true);
    try {
      await fn();
      // Se è già partita una fioritura inline (es. pacco «arrivato»), niente toast.
      if (!animato) toast.success(ok);
      setSelezione(new Set());
      setSelLotti(new Set());
      carica();
    } catch (e) {
      toast.error(`Operazione non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  // ---- Export per linea (modale globale EsportaTabella) ----
  // Le anteprime usano SOLO le righe del lotto (FASE 7: invio per riga), via `g.righeLotto`.

  /** Righe d'anteprima Laboratorio del lotto (una per riga del lotto; acconto/valore solo sulla
   * 1ª riga di ciascun ordine). I numeri di produzione qui sono provvisori: quelli definitivi
   * vengono assegnati e persistiti dal backend al salvataggio del file. */
  function rowsLaboratorio(g: GruppoLotto, dataPrev: string): RigaLaboratorioPreview[] {
    const out: RigaLaboratorioPreview[] = [];
    let n = numeroProduzioneBase;
    for (const o of g.ordini.filter((x) => !isDiagnostica(x))) {
      const rgh = g.righeLotto.get(o.id) ?? [];
      rgh.forEach((r, i) => {
        const all = Array.isArray(r.data.allergeni) ? (r.data.allergeni as string[]) : [];
        out.push({
          acconto: i === 0 ? o.acconto : "",
          numero: n++,
          dataInvio: ((r.data.data_produzione as string) || "").trim() || o.dataProduzione || g.dataInvio,
          agente: o.agenteNome,
          medico: o.medicoNome || o.clienteNome,
          paziente: (r.data.paziente as string) || "",
          valore: i === 0 ? o.totale : "",
          dataPrevista: ((r.data.data_prevista as string) || "").trim() || (o.dataPrevista && o.dataPrevista.trim()) || dataPrev,
          formulazione: (r.data.formulazione as string) || "",
          posologia: (r.data.posologia as string) || "",
          allergeni: all.join(", "),
        });
      });
    }
    return out;
  }

  /** Righe d'anteprima Diagnostica del lotto (una per allergene/test del lotto). */
  function rowsDiag(g: GruppoLotto): RigaDiagPreview[] {
    const out: RigaDiagPreview[] = [];
    for (const o of g.ordini.filter(isDiagnostica)) {
      for (const r of g.righeLotto.get(o.id) ?? []) {
        const c = campiDiagnostica(r.data);
        out.push({
          numero: o.numero,
          cliente: o.medicoNome || o.clienteNome,
          allergene: nomeProdotto(prodMap, r),
          tipoTest: c.tipoTest,
          ml: c.ml,
          qta: c.qta,
          valore: typeof r.data.prezzo === "number" ? (r.data.prezzo as number) : "",
        });
      }
    }
    return out;
  }

  function dataConsegnaRiga(r: RecordDto, o: OrdineDto): string {
    return ((r.data.data_prevista as string) || "").trim() || (o.dataPrevista || "").trim();
  }

  function righeDataConsegna(g: GruppoLotto, soloOrdineId?: string): RigaDataConsegnaPrevista[] {
    const out: RigaDataConsegnaPrevista[] = [];
    for (const o of g.ordini) {
      if (isDiagnostica(o)) continue;
      if (soloOrdineId && o.id !== soloOrdineId) continue;
      for (const r of g.righeLotto.get(o.id) ?? []) {
        out.push({
          id: r.id,
          ordineNumero: o.numero,
          descrizione: nomeProdotto(prodMap, r),
          paziente: ((r.data.paziente as string) || "").trim(),
          dataIniziale: dataConsegnaRiga(r, o),
        });
      }
    }
    return out;
  }

  function lottoConDate(g: GruppoLotto, valori: Record<string, string>): GruppoLotto {
    const ids = new Set(Object.keys(valori));
    const righeLotto = new Map<string, RecordDto[]>();
    for (const [ordineId, rows] of g.righeLotto) {
      righeLotto.set(
        ordineId,
        rows.map((r) =>
          ids.has(r.id)
            ? { ...r, data: { ...r.data, data_prevista: valori[r.id] ?? "" } }
            : r
        )
      );
    }
    return { ...g, righeLotto };
  }

  function apriDataConsegnaLotto(g: GruppoLotto) {
    const righeTarget = righeDataConsegna(g);
    if (righeTarget.length === 0) {
      toast.warning("Nessuna riga Immunoterapia in questo lotto.");
      return;
    }
    setDataConsegna({
      modo: "gestione",
      scope: `Lotto del ${dataIt(g.dataInvio)} · ${righeTarget.length} prodotti Immunoterapia`,
      righe: righeTarget,
    });
  }

  function apriDataConsegnaOrdine(g: GruppoLotto, o: OrdineDto, rows: RecordDto[]) {
    if (isDiagnostica(o)) return;
    const righeTarget = righeDataConsegna({ ...g, ordini: [o], righeLotto: new Map([[o.id, rows]]) }, o.id);
    if (righeTarget.length === 0) return;
    setDataConsegna({
      modo: "gestione",
      scope: `Ordine ${o.numero} · ${o.medicoNome || o.clienteNome || "—"}`,
      righe: righeTarget,
    });
  }

  async function dataConsegnaSalvata(valori: Record<string, string>, target: DataConsegnaTarget) {
    setDataConsegna(null);
    if (target.modo === "export") {
      setEsporta({ g: lottoConDate(target.g, valori), linea: "immuno", dataPrev: "" });
      await carica();
      return;
    }
    toast.success("Data di consegna prevista aggiornata.");
    await carica();
  }

  function continuaExportSenzaData(target: Extract<DataConsegnaTarget, { modo: "export" }>) {
    setDataConsegna(null);
    setEsporta({ g: target.g, linea: "immuno", dataPrev: "" });
  }

  /** Apre l'anteprima di export per un lotto+linea. L'export manuale Laboratorio suggerisce la
   * data di consegna prevista se manca, ma permette di procedere lasciandola vuota. */
  function apriEsporta(g: GruppoLotto, linea: LineaExport, chiediSeManca = true) {
    if (linea === "immuno" && chiediSeManca) {
      const righeTarget = righeDataConsegna(g);
      if (righeTarget.some((r) => !r.dataIniziale.trim())) {
        setDataConsegna({
          modo: "export",
          scope: `Lotto del ${dataIt(g.dataInvio)} · proposta automatica +25 giorni lavorativi`,
          righe: righeTarget,
          g,
        });
        return;
      }
    }
    setEsporta({ g, linea, dataPrev: "" });
  }

  /** Invia in produzione le RIGHE indicate (un lotto) + toast + ricarica (FASE 7). L'export
   * si genera poi dal lotto, in «In lavorazione», col pulsante «Esporta». */
  async function inviaRighe(rigaIds: string[]): Promise<string | null> {
    if (rigaIds.length === 0) return null;
    setSalvando(true);
    try {
      // I dati produzione sono già stati salvati dal modale di preparazione. La data di
      // consegna prevista Laboratorio si imposta dopo, da «In lavorazione».
      const lotto = await api.produzioneInviaRighe(rigaIds, oggi(), "");
      setLottoInviato(lotto);
      setCerca("");
      cambiaVista("in_lavorazione");
      setSelezione(new Set());
      await carica();
      return lotto;
    } catch (e) {
      toast.error(`Operazione non riuscita: ${e}`);
      return null;
    } finally {
      setSalvando(false);
    }
  }

  /** Bottone/menu «Esporta» di un lotto (per linea), specchio di `DistintaGruppo` (Spedizioni).
   *  `onPick` (opzionale) viene chiamato quando si sceglie una linea: serve a chi mostra il
   *  bottone dentro un overlay (la fioritura «Lotto creato!») per chiuderlo al momento giusto,
   *  invece di farlo a OGNI click (così aprire il menù a tendina non chiude più l'overlay). */
  function renderEsporta(g: GruppoLotto, onPick?: () => void, chiediDataMancante = true) {
    const hasImmuno = g.ordini.some((o) => !isDiagnostica(o));
    const hasDiag = g.ordini.some(isDiagnostica);
    if (!hasImmuno && !hasDiag) return null;
    const scegli = (linea: LineaExport) => {
      onPick?.();
      apriEsporta(g, linea, chiediDataMancante);
    };
    if (hasImmuno !== hasDiag) {
      const linea: LineaExport = hasImmuno ? "immuno" : "diag";
      return (
        <Button
          size="compact-sm"
          variant="light"
          color="teal"
          className="pt-azione-adattiva"
          leftSection={<IconFileExport size={15} />}
          onClick={() => scegli(linea)}
          aria-label={hasImmuno ? "Esporta Laboratorio" : "Esporta Diagnostica"}
        >
          <span className="pt-azione-adattiva-label">
            {hasImmuno ? "Esporta Laboratorio" : "Esporta Diagnostica"}
          </span>
        </Button>
      );
    }
    return (
      // zIndex sopra l'overlay della fioritura (1500): senza, la tendina compariva DIETRO
      // lo sfondo scuro e non era cliccabile.
      <Menu position="bottom-end" withArrow zIndex={1600} withinPortal>
        <Menu.Target>
          <Button
            size="compact-sm"
            variant="light"
            color="teal"
            className="pt-azione-adattiva"
            leftSection={<IconFileExport size={15} />}
            rightSection={<IconChevronDown size={14} />}
            aria-label="Esporta"
          >
            <span className="pt-azione-adattiva-label">Esporta</span>
          </Button>
        </Menu.Target>
        <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
          <Menu.Label>Quale file generare?</Menu.Label>
          <Menu.Item onClick={() => scegli("immuno")}>Immunoterapia (Laboratorio)</Menu.Item>
          <Menu.Item onClick={() => scegli("diag")}>Diagnostica</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    );
  }

  // «Manda in produzione» = crea UN lotto con le RIGHE selezionate (vista «Da produrre», FASE 7).
  // Immunoterapia: dati produzione **obbligatori** → modale di compilazione se incompleti.
  // Diagnostica: campi **facoltativi** → il modale li propone se mancano ML/quantità,
  // senza renderli bloccanti.
  // L'acconto manca solo per gli Immuno (la Diagnostica non ne ha): avviso, mai blocco.
  // I pagamenti NON si toccano mai.
  async function mandaInProduzione() {
    await preparaEInvia(selezionateDaProdurre);
  }

  // Prepara l'invio di un insieme di RIGHE (rigaId): se mancano dati di produzione apre il
  // modale; altrimenti solo avvisi gentili → invio. Le righe sono raggruppate
  // per ordine per gli avvisi/compilazione (contesto), ma si invia esattamente quelle scelte.
  async function preparaEInvia(rigaIds: string[]) {
    if (rigaIds.length === 0) return;
    const sel = new Set(rigaIds);
    const perOrd = new Map<string, RecordDto[]>();
    for (const r of righe) {
      if (!sel.has(r.id)) continue;
      const oid = (r.data.ordine_id as string) || "";
      if (oid) (perOrd.get(oid) ?? perOrd.set(oid, []).get(oid)!).push(r);
    }
    const ordineDi = (oid: string) => ordineById.get(oid);
    const immunoOrds = [...perOrd.keys()]
      .map(ordineDi)
      .filter((o): o is OrdineDto => !!o && !isDiagnostica(o));
    const diagOrds = [...perOrd.keys()]
      .map(ordineDi)
      .filter((o): o is OrdineDto => !!o && isDiagnostica(o));

    // Immuno: dati produzione obbligatori SOLO sulle righe selezionate e incomplete.
    const gruppi = gruppiRigheIncomplete(
      immunoOrds,
      perOrd,
      (riga) => !rigaProduzioneCompleta(campiProduzione(riga.data))
    );

    // Acconto immuno: avviso soft. Diagnostica senza ML/quantità: compilazione facoltativa
    // nello stesso modale dei dati Immunoterapia.
    const senza = immunoOrds.filter((o) => !o.accontoIncassato);
    const gruppiDiagnostica = gruppiRigheIncomplete(
      diagOrds,
      perOrd,
      (riga) => diagnosticaIncompleta(campiDiagnostica(riga.data))
    );
    const invia = () => inviaRighe(rigaIds);

    // Dati Immunoterapia obbligatori o Diagnostica facoltativi incompleti → unico modale di
    // preparazione. La data prevista si gestisce dopo, in «In lavorazione».
    if (gruppi.length > 0 || gruppiDiagnostica.length > 0) {
      setCompila({
        gruppi,
        gruppiDiagnostica,
        senzaAcconto: senza,
        righeDaInviare: rigaIds.map((id) => {
          const riga = righe.find((r) => r.id === id)!;
          const ordineId = (riga?.data.ordine_id as string) || "";
          const ordine = ordineById.get(ordineId);
          const righeOrdine = perOrd.get(ordineId) ?? [];
          return {
            id,
            ordineNumero: ordine?.numero || "—",
            rigaNumero: Math.max(1, righeOrdine.findIndex((x) => x.id === id) + 1),
            prodottoNome: riga ? nomeProdotto(prodMap, riga) : "Riga",
          };
        }),
      });
      return;
    }
    // Solo avviso gentile per l'acconto Immunoterapia, poi invio.
    if (senza.length > 0) {
      const ok = await dialog.confirm(
        "Tutto pronto? Un paio di cose da sapere",
        <Stack gap="sm">
          {senza.length > 0 && (
            <Box>
              <Text size="sm" fw={600}>
                Acconto non ancora registrato
              </Text>
              <Text size="xs" c="dimmed" mb={4}>
                Puoi procedere lo stesso — i pagamenti non vengono modificati.
              </Text>
              <Stack gap={2}>
                {senza.map((o) => (
                  <Text key={o.id} size="sm">
                    • <b>{o.numero}</b> — {o.medicoNome || o.clienteNome || "—"}
                  </Text>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>,
        { conferma: "Manda in produzione", annulla: "Annulla" }
      );
      if (!ok) return;
    }
    await invia();
  }

  // Manda in produzione un singolo ordine dal menu ⋯ (coda): se ha righe **spuntate**, invia
  // solo quelle; altrimenti tutte le sue righe da produrre. FASE 7.
  async function mandaUno(o: OrdineDto) {
    const rows = righeDaProdDi(o.id).map((r) => r.id);
    const selezionate = rows.filter((id) => selezione.has(id));
    await preparaEInvia(selezionate.length > 0 ? selezionate : rows);
  }

  // «Arrivato in Italia» per un insieme di RIGHE (singola riga, ordine intero o lotto).
  async function segnaArrivati(rigaIds: string[], etichetta: string) {
    if (rigaIds.length === 0) {
      toast.warning("Nessun prodotto «In produzione» da segnare.");
      return;
    }
    // Pacco «arrivato in Italia» inline (FASE 7C); se parte, salta il toast.
    const animato = mostraFlourish("pacco");
    await esegui(() => api.produzioneRigheStato(rigaIds, "arrivato_it", oggi()), etichetta, animato);
  }

  // Riporta una singola riga in coda «Da produrre» (esce dal lotto).
  async function annullaRiga(rigaId: string, nome: string) {
    const ok = await dialog.confirm(
      "Riportare il prodotto in coda?",
      `«${nome}» torna fra quelli «Da produrre» ed esce dal lotto. I pagamenti non vengono toccati.`,
      { conferma: "Riporta in coda", annulla: "Annulla" }
    );
    if (!ok) return;
    await esegui(() => api.produzioneRigaAnnulla(rigaId), `«${nome}» riportato in coda.`);
  }

  // Riporta in coda TUTTE le righe di un ordine in questo lotto (menu ⋯ della card in lavorazione).
  async function riportaOrdineInCoda(o: OrdineDto, rows: RecordDto[]) {
    if (rows.length === 0) return;
    const ok = await dialog.confirm(
      "Riportare l'ordine in coda?",
      `I prodotti dell'ordine ${o.numero} in questo lotto tornano fra quelli «Da produrre». I pagamenti non vengono toccati.`,
      { conferma: "Riporta in coda", annulla: "Annulla" }
    );
    if (!ok) return;
    await esegui(async () => {
      for (const r of rows) await api.produzioneRigaAnnulla(r.id);
    }, `Ordine ${o.numero} riportato in coda.`);
  }

  async function annullaLotto(g: GruppoLotto) {
    const ok = await dialog.confirm(
      "Annullare tutto il lotto?",
      `Tutti i prodotti del lotto tornano fra quelli «Da produrre». I pagamenti non vengono toccati.`,
      { conferma: "Annulla lotto", annulla: "Indietro" }
    );
    if (!ok) return;
    await esegui(() => api.produzioneLottoRigheAnnulla(g.lotto), "Lotto annullato.");
  }

  async function unisciLotti() {
    if (selLottiVis.length < 2) return;
    const ok = await dialog.confirm(
      "Unire i lotti selezionati?",
      `I ${selLottiVis.length} lotti diventeranno un unico lotto, anche se di giorni diversi. ` +
        "Serve per l'export unico e l'organizzazione; è reversibile (Separa).",
      { conferma: "Unisci", annulla: "Annulla" }
    );
    if (!ok) return;
    await esegui(() => api.produzioneLottoRigheUnisci(selLottiVis), "Lotti uniti.");
  }

  async function separaLotto(g: GruppoLotto) {
    await esegui(() => api.produzioneLottoRigheSepara(g.lotto), "Lotto separato.");
  }

  // Righe d'ordine (resoconto) per la card espansa. Diagnostica e Immunoterapia mostrano
  // dati diversi (la Diagnostica non ha formulazione/posologia/allergeni immunoterapici).
  // Contenuto di una singola riga (Diagnostica = scheda compatta; Immuno = editor dati prod.).
  function rigaContenuto(o: OrdineDto, r: RecordDto) {
    if (isDiagnostica(o)) {
      const c = campiDiagnostica(r.data);
      const incompleta = diagnosticaIncompleta(c);
      return (
        <Paper withBorder p={6} radius="sm" bg="var(--mantine-color-body)">
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} truncate>
                {nomeProdotto(prodMap, r)}
              </Text>
              {c.tipoTest && (
                <Badge size="sm" variant="light" color="teal">
                  {c.tipoTest}
                </Badge>
              )}
              {c.codice && (
                <Text size="xs" c="dimmed">
                  {c.codice}
                </Text>
              )}
            </Group>
            <Group gap={10} wrap="nowrap" style={{ flexShrink: 0 }}>
              <Text size="xs" c={c.ml ? undefined : "orange"}>
                {c.ml ? `${c.ml} ml` : "ml —"}
              </Text>
              <Text size="xs" c={c.qta > 0 ? undefined : "orange"}>
                ×{c.qta || "—"}
              </Text>
              {typeof r.data.prezzo === "number" && r.data.prezzo > 0 && (
                <Text size="xs" className="tabular">
                  € {centsToEurStr(r.data.prezzo as number)}
                </Text>
              )}
            </Group>
          </Group>
          {incompleta && (
            <Text size="xs" c="orange" mt={2}>
              Manca ML o quantità (facoltativo): aprila per completarla.
            </Text>
          )}
        </Paper>
      );
    }
    return <RigaProduzione riga={r} nome={nomeProdotto(prodMap, r)} sugg={sugg} onSaved={carica} />;
  }

  // Contenuto espanso di un ordine: l'intestazione (medico/agente/date) + SOLO le righe del
  // contesto (FASE 7): in «Da produrre» le righe da produrre con la spunta di selezione; in
  // «In lavorazione» le righe del lotto con stato + azioni per riga. Le righe entrano/escono
  // con un'animazione (passaggio da-produrre ↔ in-lavorazione).
  function righeOrdine(o: OrdineDto, rows: RecordDto[], contesto: "coda" | "lotto") {
    const diag = isDiagnostica(o);
    return (
      <Box pl={contestoPadding}>
        <Group gap="xl" mb="sm" wrap="wrap">
          <Info label={diag ? "Medico / Azienda" : "Medico"} value={o.medicoNome || o.clienteNome} />
          {!diag && <Info label="Cliente" value={[o.clienteNome, o.clienteCitta].filter(Boolean).join(" · ")} />}
          <Info label="Agente" value={o.agenteNome} />
          {!diag && <Info label="Pazienti" value={pazientiDi(o)} />}
          <Info label="Data ordine" value={dataIt(o.data)} />
          {o.accontoIncassato && <Info label="Acconto incassato il" value={dataIt(o.dataAcconto)} />}
          {o.dataProduzione && <Info label="In produzione dal" value={dataIt(o.dataProduzione)} />}
          {o.dataArrivoIt && <Info label="Arrivato in Italia il" value={dataIt(o.dataArrivoIt)} />}
        </Group>
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={6}>
          {diag ? "Allergeni / test (Diagnostica)" : "Dati di produzione (per riga)"}
        </Text>
        {rows.length === 0 ? (
          <Paper withBorder p="sm" radius="md" bg="orange.0">
            <Group justify="space-between" gap="sm" wrap="wrap">
              <Box>
                <Text size="sm" fw={700} c="orange.9">
                  Inserisci prima il prodotto mancante
                </Text>
                <Text size="xs" c="dimmed">
                  Si aprirà l'ordine direttamente sui prodotti, con i dati di produzione facoltativi visibili.
                </Text>
              </Box>
              <Button
                size="xs"
                color="orange"
                leftSection={<IconPencil size={14} />}
                onClick={() => completaOrdineGenerico(o)}
              >
                Inserisci prodotto
              </Button>
            </Group>
          </Paper>
        ) : (
          <Stack gap={6}>
            <AnimatePresence initial={false}>
              {rows.map((r) => (
                <motion.div
                  key={r.id}
                  initial={ridurreAnimazioni ? false : { opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={ridurreAnimazioni ? { opacity: 0 } : { opacity: 0, x: 12 }}
                  transition={{ duration: ridurreAnimazioni ? 0 : 0.18 }}
                >
                  {contesto === "coda" ? (
                    <Group wrap="nowrap" align="flex-start" gap="xs">
                      <Checkbox
                        mt={6}
                        checked={selezione.has(r.id)}
                        onChange={(e) => toggleRiga(r.id, e.currentTarget.checked)}
                        aria-label="Seleziona prodotto da mandare in produzione"
                      />
                      <Box style={{ flex: 1, minWidth: 0 }}>{rigaContenuto(o, r)}</Box>
                    </Group>
                  ) : (
                    <Box>
                      <Group justify="space-between" wrap="nowrap" gap="xs" mb={4}>
                        <Badge size="sm" variant="light" color={arrivataRiga(r) ? "cyan" : "yellow"}>
                          {arrivataRiga(r) ? "Arrivato in Italia" : "In produzione"}
                        </Badge>
                        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                          {!arrivataRiga(r) && (
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="cyan"
                              leftSection={<IconPackageImport size={13} />}
                              onClick={() =>
                                segnaArrivati([r.id], "Prodotto segnato Arrivato in Italia.")
                              }
                            >
                              Arrivato
                            </Button>
                          )}
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            color="orange"
                            leftSection={<IconArrowBackUp size={13} />}
                            onClick={() => annullaRiga(r.id, nomeProdotto(prodMap, r))}
                          >
                            Riporta in coda
                          </Button>
                        </Group>
                      </Group>
                      {rigaContenuto(o, r)}
                    </Box>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </Stack>
        )}
        <Text size="xs" c="dimmed" mt="sm">
          {diag
            ? "Modifica allergeni, ML e quantità con «Apri / modifica». Il file Diagnostica si genera dal lotto, in «In lavorazione», col pulsante «Esporta»."
            : "I suggerimenti vengono dal catalogo produzione e da ciò che hai già compilato. Il file Laboratorio si genera dal lotto, in «In lavorazione», col pulsante «Esporta»."}
        </Text>
      </Box>
    );
  }

  const contestoPadding = 56;

  // Card ordine. `contesto`: "coda" (Da produrre: spunta che seleziona le sue righe + Manda in
  // produzione) o "lotto" (In lavorazione: le sue righe del lotto, con azioni per riga). `rows`
  // = le righe da mostrare in questo contesto (da produrre, o del lotto). FASE 7.
  function renderCard(o: OrdineDto, contesto: "coda" | "lotto", rows: RecordDto[], lotto?: GruppoLotto) {
    const aperto = espansi.has(o.id);
    const generico = contesto === "coda" && rows.length === 0;
    const diagnostica = isDiagnostica(o);
    const def = statoDef(o.stato);
    const tutteSel = contesto === "coda" && rows.length > 0 && rows.every((r) => selezione.has(r.id));
    const alcuneSel = contesto === "coda" && rows.some((r) => selezione.has(r.id));
    const daArrivare = rows.filter(daArrivareRiga).map((r) => r.id);
    // Nella coda «Da produrre» la ricerca filtra già le card: il fondo giallo non aggiunge
    // informazione. Nei lotti, invece, resta utile per distinguere l'ordine trovato.
    const evidenziata = contesto === "lotto" && !!ricercaProduzione && ordineCorrispondeRicerca(o, rows);
    const agenteEvidenziato =
      contesto === "lotto" && filtroAgentiSet.size > 0 && filtroAgentiSet.has(o.agenteId);
    return (
      <Paper
        key={o.id}
        className={[
          evidenziata ? "pt-search-match-card" : "",
          agenteEvidenziato ? "pt-production-agent-match" : "",
        ].filter(Boolean).join(" ") || undefined}
        withBorder={contesto === "coda"}
        p="sm"
        radius="md"
        bg={contesto === "lotto" && !evidenziata ? "transparent" : undefined}
        onContextMenu={(event) => {
          setContextMenu({
            ...puntoDaEventoContextMenu(event),
            order: o,
            contesto,
            rows,
            lotto,
          });
        }}
      >
        {/* L'intera intestazione apre/chiude la tendina (l'icona-mano ora "fa qualcosa").
            I controlli interni (spunta, chevron, menu ⋯) fermano la propagazione per
            conservare la loro azione. Il contenuto espanso sta fuori da questo Group. */}
        <Group
          wrap="nowrap"
          align="flex-start"
          gap="sm"
          style={{ cursor: "pointer" }}
          onClick={() => toggleEspandi(o.id)}
        >
          {contesto === "coda" && (
            <Checkbox
              checked={tutteSel}
              indeterminate={alcuneSel && !tutteSel}
              onChange={(e) => selezionaCoda(o, e.currentTarget.checked)}
              onClick={(e) => e.stopPropagation()}
              color={generico ? "orange" : undefined}
              aria-label={generico ? "Completa l'ordine inserendo un prodotto" : "Seleziona ordine per la produzione"}
              mt={2}
            />
          )}
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={(e) => {
              e.stopPropagation();
              toggleEspandi(o.id);
            }}
            aria-label={aperto ? "Comprimi" : "Espandi"}
          >
            <IconChevronRight
              size={18}
              style={{ transform: aperto ? "rotate(90deg)" : "none", transition: "transform .15s" }}
            />
          </ActionIcon>
          {(() => {
            // Icona-categoria a colpo d'occhio: Immunoterapia (vaccino/blu) vs Diagnostica
            // (provetta/teal). Sostituisce il vecchio badge testuale «Diagnostica».
            const cd = categoriaDef(diagnostica ? "Diagnostica" : "Immunoterapia");
            return (
              <Tooltip label={cd.label} withArrow>
                <ThemeIcon variant="light" color={cd.color} size="lg" radius="md">
                  <cd.Ico size={18} />
                </ThemeIcon>
              </Tooltip>
            );
          })()}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Group gap={8} wrap="wrap" style={{ minWidth: 0 }}>
                <Text fw={700} className="tabular" style={{ flexShrink: 0 }}>
                  {o.numero}
                </Text>
                {generico && (
                  <Badge color="orange" variant="light" size="sm" style={{ flexShrink: 0 }}>
                    Prodotto mancante
                  </Badge>
                )}
                <IdentitaOrdineProduzione
                  principale={diagnostica ? o.medicoNome || o.clienteNome || "—" : pazientiDi(o) || o.clienteNome || "—"}
                  colore={def.color}
                  etichetta={def.label}
                  secondario={diagnostica ? o.agenteNome : o.medicoNome}
                  prefissoSecondario={diagnostica ? "Ag. " : "Dr. "}
                />
              </Group>
              <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
                <Text size="sm" fw={600} className="tabular">
                  € {centsToEurStr(o.totale)}
                </Text>
                {!diagnostica && <AccontoBadge o={o} />}
                <MenuAzioniRiga>
                    <Menu.Item
                      leftSection={<IconPencil size={15} />}
                      onClick={() => generico ? completaOrdineGenerico(o) : apri(o.id, o.numero)}
                    >
                      {generico ? "Inserisci prodotto" : "Apri / modifica"}
                    </Menu.Item>
                    <Menu.Divider />
                    {contesto === "coda" && !generico && (
                      <Menu.Item leftSection={<IconHammer size={15} />} onClick={() => mandaUno(o)}>
                        Manda in produzione
                      </Menu.Item>
                    )}
                    {contesto === "lotto" && daArrivare.length > 0 && (
                      <Menu.Item
                        leftSection={<IconPackageImport size={15} />}
                        onClick={() =>
                          segnaArrivati(daArrivare, `Ordine ${o.numero} segnato Arrivato in Italia.`)
                        }
                      >
                        Segna arrivato in Italia
                      </Menu.Item>
                    )}
                    {contesto === "lotto" && lotto && !diagnostica && (
                      <Menu.Item
                        leftSection={<IconCalendar size={15} />}
                        onClick={() => apriDataConsegnaOrdine(lotto, o, rows)}
                      >
                        Data di consegna prevista
                      </Menu.Item>
                    )}
                    {contesto === "lotto" && (
                      <Menu.Item
                        leftSection={<IconArrowBackUp size={15} />}
                        color="orange"
                        onClick={() => riportaOrdineInCoda(o, rows)}
                      >
                        Riporta in coda
                      </Menu.Item>
                    )}
                </MenuAzioniRiga>
              </Group>
            </Group>
          </Box>
        </Group>

        {/* Montaggio pigro: i contenuti pesanti (Autocomplete/TagsInput di RigaProduzione)
            si montano solo quando la tendina è aperta, non per ogni ordine all'avvio. */}
        <Collapse expanded={aperto}>
          {aperto && (
            <>
              <Divider my="sm" />
              {righeOrdine(o, rows, contesto)}
            </>
          )}
        </Collapse>
      </Paper>
    );
  }

  // Card lotto (vista «In lavorazione»): header con data invio + conteggi + azioni; il corpo
  // espande gli ordini del lotto (solo le loro righe DI QUESTO lotto).
  function renderLotto(g: GruppoLotto) {
    const aperto = lottiEspansi.has(g.lotto);
    const righeConsegna = righeDataConsegna(g);
    // Righe del lotto ancora «In produzione» (da segnare arrivate), su tutti gli ordini.
    const inProdIds = g.ordini
      .flatMap((o) => g.righeLotto.get(o.id) ?? [])
      .filter(daArrivareRiga)
      .map((r) => r.id);
    return (
      <Paper
        key={g.lotto}
        className="pt-lotto-produzione"
        withBorder
        p="sm"
        radius="md"
        style={{ containerType: "inline-size" }}
      >
        <Group wrap="nowrap" align="center" gap="sm">
          <Checkbox checked={selLotti.has(g.lotto)} onChange={() => toggleSelLotto(g.lotto)} />
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => toggleEspandiLotto(g.lotto)}
            aria-label={aperto ? "Comprimi" : "Espandi"}
          >
            <IconChevronRight
              size={18}
              style={{
                transform: aperto ? "rotate(90deg)" : "none",
                transition: `transform ${DURATA_APERTURA_LOTTO_MS}ms ${EASING_APERTURA_LOTTO}`,
              }}
            />
          </ActionIcon>
          <ThemeIcon variant="light" color="yellow" size="lg" radius="md">
            <IconPackages size={18} />
          </ThemeIcon>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group justify="space-between" align="center" gap="sm" wrap="wrap">
              <Group gap={8} wrap="wrap" style={{ minWidth: 0 }}>
                <Text fw={700} style={{ whiteSpace: "nowrap" }}>Invio del {dataIt(g.dataInvio)}</Text>
                <Badge variant="light" color="gray" size="sm" style={{ flexShrink: 0 }}>
                  {g.ordini.length} {g.ordini.length === 1 ? "ordine" : "ordini"}
                </Badge>
                {g.nInProd > 0 && (
                  <Badge variant="light" color="yellow" size="sm" style={{ flexShrink: 0 }}>
                    {g.nInProd} in produzione
                  </Badge>
                )}
                {g.nArrivati > 0 && (
                  <Badge variant="light" color="cyan" size="sm" style={{ flexShrink: 0 }}>
                    {g.nArrivati} arrivati
                  </Badge>
                )}
                {g.unito && (
                  <Badge variant="outline" color="grape" size="sm" style={{ flexShrink: 0 }}>
                    Unito
                  </Badge>
                )}
              </Group>
              <Group className="pt-azioni-produzione" gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
            <Text size="sm" fw={600} className="tabular">
              € {centsToEurStr(g.totale)}
            </Text>
            {renderEsporta(g)}
            {inProdIds.length > 0 && (
              <Button
                size="compact-sm"
                variant="light"
                color="cyan"
                className="pt-azione-adattiva"
                leftSection={<IconPackageImport size={15} />}
                loading={salvando}
                onClick={() => segnaArrivati(inProdIds, "Lotto segnato Arrivato in Italia.")}
                aria-label="Arrivato in Italia"
              >
                <span className="pt-azione-adattiva-label">Arrivato in Italia</span>
              </Button>
            )}
            <MenuAzioniRiga>
                {righeConsegna.length > 0 && (
                  <Menu.Item leftSection={<IconCalendar size={15} />} onClick={() => apriDataConsegnaLotto(g)}>
                    Data di consegna prevista
                  </Menu.Item>
                )}
                {g.unito && (
                  <Menu.Item leftSection={<IconArrowsSplit2 size={15} />} onClick={() => separaLotto(g)}>
                    Separa lotto
                  </Menu.Item>
                )}
                <Menu.Item
                  leftSection={<IconArrowBackUp size={15} />}
                  color="orange"
                  onClick={() => annullaLotto(g)}
                >
                  Annulla lotto (torna in coda)
                </Menu.Item>
            </MenuAzioniRiga>
          </Group>
        </Group>
      </Box>
    </Group>

        {/* Le sole intestazioni leggere restano montate mentre il lotto è nel viewport: il
            Collapse può così partire da una misura già stabile, senza lo scatto del montaggio
            al clic. I dettagli pesanti delle singole card restano invece montati in modo pigro. */}
        <Collapse
          expanded={aperto}
          transitionDuration={DURATA_APERTURA_LOTTO_MS}
          transitionTimingFunction={EASING_APERTURA_LOTTO}
          animateOpacity={false}
        >
          <Divider my="sm" />
          <Stack gap={4}>
            {g.ordini.map((o) => {
              const rows = g.righeLotto.get(o.id) ?? [];
              return <Box key={`${g.lotto}:${o.id}`}>{renderCard(o, "lotto", rows, g)}</Box>;
            })}
          </Stack>
        </Collapse>
      </Paper>
    );
  }

  // Barra persistente: «Seleziona tutti» + azione contestuale, sempre visibile.
  const barra =
    vista === "da_produrre"
      ? codaOrdinata.length === 0 && selezionateDaProdurre.length === 0
        ? null
        : (() => {
            const nSel = selezionateDaProdurre.length;
            return (
              <BarraSelezione etichetta="Seleziona tutti" checked={tuttiSelezionati}
                indeterminate={selVisibili.length > 0 && !tuttiSelezionati} onToggle={toggleTutti}
                selezionati={nSel} onDeseleziona={() => setSelezione(new Set())}>
                <Button size="xs" color="accent" leftSection={<IconHammer size={15} />}
                  disabled={nSel === 0} loading={salvando} onClick={mandaInProduzione}>
                  Manda in produzione{nSel > 0 ? ` (${nSel})` : ""}
                </Button>
              </BarraSelezione>
            );
          })()
      : gruppi.length === 0
        ? null
        : (() => {
            const nSel = selLottiVis.length;
            return (
              <BarraSelezione etichetta="Seleziona tutti i lotti" checked={tuttiLottiSel}
                indeterminate={nSel > 0 && !tuttiLottiSel} onToggle={toggleTuttiLotti}
                selezionati={nSel} onDeseleziona={() => setSelLotti(new Set())}>
                <Button size="xs" variant="light" color="grape" leftSection={<IconArrowMerge size={15} />}
                  disabled={nSel < 2} loading={salvando} onClick={unisciLotti}>
                  Unisci lotti{nSel >= 2 ? ` (${nSel})` : ""}
                </Button>
              </BarraSelezione>
            );
          })();

  const vuoto = vista === "da_produrre" ? codaOrdinata.length === 0 : gruppi.length === 0;

  return (
    <Pagina
      titolo="Produzione"
      differita
      azioni={
        vista === "da_produrre" ? (
          <Button
            color="teal"
            leftSection={<IconTestPipe size={16} />}
            onClick={() => {
              setEditor({ ordineId: null, categoria: "Diagnostica", categoriaBloccata: true });
            }}
          >
            Nuovo ordine Diagnostica
          </Button>
        ) : undefined
      }
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group
          className="pt-produzione-toolbar"
          gap="sm"
          style={{
            display: "grid",
            gridTemplateColumns: "max-content minmax(0, 1fr)",
            alignItems: "end",
            width: "100%",
          }}
        >
          <SegmentedControl
            value={vista}
            onChange={(v) => cambiaVista(v as Vista)}
            data={[
              {
                value: "da_produrre",
                label: (
                  <Group gap={6} wrap="nowrap">
                    <IconClipboardList size={15} />
                    <span>Da produrre{nDaProdurre ? ` (${nDaProdurre})` : ""}</span>
                  </Group>
                ),
              },
              {
                value: "in_lavorazione",
                label: (
                  <Group gap={6} wrap="nowrap">
                    <IconHammer size={15} />
                    <span>In lavorazione{nInLavorazione ? ` (${nInLavorazione})` : ""}</span>
                  </Group>
                ),
              },
            ]}
          />
          <Group
            gap="sm"
            wrap="nowrap"
            align="flex-end"
            justify="flex-end"
            style={{ minWidth: 0, width: "100%" }}
          >
            <DebouncedInput
              placeholder="Cerca numero, medico, cliente, telefono o lotto…"
              leftSection={<IconSearch size={16} />}
              value={cerca}
              onChange={setCerca}
              style={{ flex: "0 1 320px", width: 320, minWidth: 170, maxWidth: 320 }}
            />
            <FiltriPopover
              attivi={nFiltri}
              onAzzera={azzeraFiltri}
              allineaDestra
              width={340}
              filtri={[
                {
                  chiave: "agente",
                  larghezza: 200,
                  nodo: (
                    <MultiSelect
                      label="Agente"
                      placeholder={filtroAgenti.length === 0 ? "Tutti gli agenti" : undefined}
                      data={opzioniAgenti}
                      value={filtroAgenti}
                      onChange={setFiltroAgenti}
                      clearable
                      searchable
                      comboboxProps={{ withinPortal: false }}
                    />
                  ),
                },
                {
                  chiave: "acconto",
                  larghezza: 220,
                  nodo: (
                    <Box>
                      <Text size="sm" fw={500} mb={4}>
                        Acconto
                      </Text>
                      <SegmentedControl
                        fullWidth
                        value={filtroAcconto}
                        onChange={(v) => setFiltroAcconto(v as "tutti" | "incassato" | "atteso")}
                        data={[
                          { value: "tutti", label: "Tutti" },
                          { value: "incassato", label: "Incassato" },
                          { value: "atteso", label: "Atteso" },
                        ]}
                      />
                    </Box>
                  ),
                },
                ...(vista === "in_lavorazione"
                  ? [
                      {
                        chiave: "periodo",
                        larghezza: 280,
                        nodo: (
                          <Box>
                            <Text size="sm" fw={500} mb={4}>
                              Periodo (data invio)
                            </Text>
                            <SegmentedControl
                              fullWidth
                              value={periodo}
                              onChange={(v) => setPeriodo(v as Periodo)}
                              data={[
                                { value: "tutto", label: "Tutto" },
                                { value: "mese", label: "Questo mese" },
                                { value: "scorso", label: "Mese scorso" },
                                { value: "custom", label: "Da–a" },
                              ]}
                            />
                            {periodo === "custom" && (
                              <FiltroIntervalloDate dal={da} al={a} onDalChange={setDa} onAlChange={setA} gap="xs" mt="xs" />
                            )}
                          </Box>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Group>
        </Group>

        {/* Barra azioni SEMPRE visibile: la pagina scorre nel contenitore esterno della
            Shell (gli antenati usano min-height:100%), quindi una barra "normale" sparirebbe
            scrollando. La fissiamo (sticky) col proprio sfondo opaco così «Manda in
            produzione» resta a portata di clic mentre si scorre la lista. */}
        {barra && (
          <Box style={{ position: "sticky", top: 0, zIndex: 3, background: "var(--bg)" }}>
            {barra}
          </Box>
        )}

        <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {vuoto ? (
            caricamento ? (
              <Box />
            ) : (
              <Stack align="center" gap="xs" py={40}>
                <ThemeIcon size={48} radius="xl" variant="light" color="gray">
                  <IconFlask2 size={24} />
                </ThemeIcon>
                <Text c="dimmed" size="sm">
                  {haFiltri
                    ? "Nessun ordine per i filtri."
                    : vista === "da_produrre"
                      ? "Nessun ordine Immunoterapia da produrre."
                      : "Nessun lotto in lavorazione."}
                </Text>
              </Stack>
            )
          ) : vista === "da_produrre" ? (
            // Animazione lista (FASE 7C): le card escono con scivolata+collasso quando
            // l'ordine lascia la coda (mandato in produzione) — anche selezionando tutto il
            // lotto. `key` distinta per vista: cambiando «Da produrre»↔«In lavorazione» React
            // smonta del tutto il ramo invece di riusare l'AnimatePresence (che altrimenti
            // farebbe uscire in slide TUTTE le card al cambio di tabella).
            <Stack gap="lg" key="coda">
              {/* Virtualizzato per gruppo-data: l'altezza totale è riservata da subito
                  (segnaposto), il contenuto del gruppo si costruisce solo vicino al viewport. */}
              <AnimatePresence initial={false}>
                {codaGruppiData.map((grp) => (
                  <CardVirtuale
                    key={`${grp.isConfermato ? "conf" : "altro"}_${grp.data}`}
                    ridotte={ridurreAnimazioni}
                    altezzaStimata={36 + grp.ordini.length * 74}
                  >
                    {() => (
                      <>
                        {/* Intestazione di data sopra ogni gruppo di ordini «Da produrre». */}
                        <Group gap="xs" mb={8} align="center" wrap="nowrap">
                          <IconCalendar size={15} style={{ flexShrink: 0, opacity: 0.6 }} />
                          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ flexShrink: 0 }}>
                            {dataIt(grp.data)} {grp.isConfermato ? "· CONFERMATI" : "· NUOVI / ALTRI"}
                          </Text>
                          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                            · {grp.ordini.length} ordine/i
                          </Text>
                          <Divider style={{ flex: 1 }} />
                        </Group>
                        <Stack gap="xs">
                          <AnimatePresence>
                            {grp.ordini.map((o) => (
                              <CardSlot key={o.id} ridotte={ridurreAnimazioni} entra={entrata && (ordiniGlobalIdx.get(o.id) ?? 0) < 12} index={ordiniGlobalIdx.get(o.id) ?? 0}>
                                {renderCard(o, "coda", righeDaProdDi(o.id))}
                              </CardSlot>
                            ))}
                          </AnimatePresence>
                        </Stack>
                      </>
                    )}
                  </CardVirtuale>
                ))}
              </AnimatePresence>
            </Stack>
          ) : (
            <Stack gap="xs" key="lotti">
              <AnimatePresence>
                {gruppi.map((g, i) => (
                  <CardVirtuale key={g.lotto} ridotte={ridurreAnimazioni} altezzaStimata={76}>
                    {() => (
                      <div
                        className={entrata && !ridurreAnimazioni && i < 12 ? "pt-card-anim" : undefined}
                        style={entrata && !ridurreAnimazioni && i < 12 ? { animationDelay: `${Math.min(i, 14) * 30}ms` } : undefined}
                      >
                        {renderLotto(g)}
                      </div>
                    )}
                  </CardVirtuale>
                ))}
              </AnimatePresence>
            </Stack>
          )}
        </Box>
      </Stack>

      <OrdineEditor
        editor={editor}
        identity={identity}
        onClose={() => {
          setEditor(null);
        }}
        onSaved={() => {
          setEditor(null);
          carica();
          // L'ordine creato compare nella coda «Da produrre»: lo si manda in produzione (per
          // riga) e si esporta dal lotto, in «In lavorazione» (FASE 7).
        }}
      />

      <CompilaProduzioneModal
        target={compila}
        prodMap={prodMap}
        sugg={sugg}
        onClose={() => setCompila(null)}
        onConfirm={async (righeIds) => (await inviaRighe(righeIds)) !== null}
      />

      {contextMenu && (
        <ContextMenuPuntuale punto={contextMenu} onClose={() => setContextMenu(null)}>
            <Menu.Item
              leftSection={<IconPencil size={15} />}
              onClick={() => {
                apri(contextMenu.order.id, contextMenu.order.numero);
                setContextMenu(null);
              }}
            >
              Apri / modifica
            </Menu.Item>
            <Menu.Divider />
            {contextMenu.contesto === "coda" && (
              <Menu.Item
                leftSection={<IconHammer size={15} />}
                onClick={() => {
                  mandaUno(contextMenu.order);
                  setContextMenu(null);
                }}
              >
                Manda in produzione
              </Menu.Item>
            )}
            {contextMenu.contesto === "lotto" && (
              <>
                {contextMenu.rows.filter(daArrivareRiga).length > 0 && (
                  <Menu.Item
                    leftSection={<IconPackageImport size={15} />}
                    onClick={() => {
                      const daArrivare = contextMenu.rows.filter(daArrivareRiga).map((r) => r.id);
                      segnaArrivati(daArrivare, `Ordine ${contextMenu.order.numero} segnato Arrivato in Italia.`);
                      setContextMenu(null);
                    }}
                  >
                    Segna arrivato in Italia
                  </Menu.Item>
                )}
                {contextMenu.lotto && !isDiagnostica(contextMenu.order) && (
                  <Menu.Item
                    leftSection={<IconCalendar size={15} />}
                    onClick={() => {
                      apriDataConsegnaOrdine(contextMenu.lotto!, contextMenu.order, contextMenu.rows);
                      setContextMenu(null);
                    }}
                  >
                    Data di consegna prevista
                  </Menu.Item>
                )}
                <Menu.Item
                  leftSection={<IconArrowBackUp size={15} />}
                  color="orange"
                  onClick={() => {
                    riportaOrdineInCoda(contextMenu.order, contextMenu.rows);
                    setContextMenu(null);
                  }}
                >
                  Riporta in coda
                </Menu.Item>
              </>
            )}
        </ContextMenuPuntuale>
      )}

      <DataConsegnaPrevistaModal
        target={dataConsegna}
        onClose={() => setDataConsegna(null)}
        onSave={dataConsegnaSalvata}
        onContinueWithoutSave={continuaExportSenzaData}
      />

      {/* Export via modale globale (anteprima): Laboratorio (Immunoterapia) e Diagnostica. */}
      <EsportaTabella<RigaLaboratorioPreview>
        senzaTrigger
        colonneFisse
        nomeCompleto
        orientamentoFisso="orizzontale"
        aperto={esporta?.linea === "immuno"}
        onApertoChange={(v) => {
          if (!v) setEsporta(null);
        }}
        nomeBase={esporta?.linea === "immuno" ? nomeFileLotto("Laboratorio", esporta.g, rowsLaboratorio(esporta.g, esporta.dataPrev).length, "set") : "Laboratorio"}
        foglio="Produzione"
        titolo="PRODUZIONE LABORATORIO"
        titoloModale="Esporta file Laboratorio (Immunoterapia)"
        colonne={COL_LABORATORIO}
        righe={esporta?.linea === "immuno" ? rowsLaboratorio(esporta.g, esporta.dataPrev) : []}
        salvaCustom={async (path) => {
          if (!esporta) return;
          // Legge il seme condiviso più fresco al momento dell'export (per-PC eliminato).
          const base = await leggiBaseProduzione();
          await api.laboratorioExport(esporta.g.lotto, path, base, esporta.dataPrev);
          carica();
        }}
      />
      <EsportaTabella<RigaDiagPreview>
        senzaTrigger
        colonneFisse
        nomeCompleto
        orientamentoFisso="orizzontale"
        aperto={esporta?.linea === "diag"}
        onApertoChange={(v) => {
          if (!v) setEsporta(null);
        }}
        nomeBase={esporta?.linea === "diag" ? nomeFileLotto("Diagnostica", esporta.g, rowsDiag(esporta.g).length, "test") : "Diagnostica"}
        foglio="Diagnostica"
        titolo="DIAGNOSTICA"
        titoloModale="Esporta file Diagnostica"
        colonne={COL_DIAG}
        righe={esporta?.linea === "diag" ? rowsDiag(esporta.g) : []}
        salvaCustom={async (path) => {
          if (!esporta) return;
          await api.diagnosticaExport(esporta.g.lotto, path);
          carica();
        }}
      />

      <InProduzioneFlourish
        attivo={inProduzione}
        onFine={() => {
          setInProduzione(false);
          setEsportaLotto(null);
        }}
        distinta={
          esportaLotto
            ? renderEsporta(esportaLotto, () => {
                setInProduzione(false);
                setEsportaLotto(null);
              }, false)
            : undefined
        }
      />
    </Pagina>
  );
}
