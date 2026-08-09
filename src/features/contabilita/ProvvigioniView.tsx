// Tab Provvigioni (FASE 2): riepilogo per agente/periodo con export Excel.
// Calcolo, maturazione (per-agente) ed esclusioni (rifiutati/omaggio) sono nel core;
// qui si filtra (agente + periodo), si ordina e si mostra il maturato vs il potenziale.
// Gli agenti senza provvigioni nel periodo (potenziale 0) finiscono in fondo, collassati.
// Da ogni card si saldano le provvigioni (PagaProvvigioniModal → record `provv_pagamento`,
// che il report poi esclude) e si consulta lo storico per-agente (StoricoProvvigioniModal).
import { createContext, forwardRef, startTransition, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIntersection } from "@mantine/hooks";
import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCircleDashed,
  IconCoin,
  IconHistory,
} from "@tabler/icons-react";
import {
  api,
  type ProvvigioneAgente,
  type ProvvigioneOrdine,
  type ProvvigioniReport,
  type RecordDto,
} from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { centsToEurStr } from "../../lib/money";
import {
  useCompactColumnObserver,
  type LeggiColonnaCompatta,
} from "../../ui/useCompactColumnObserver";
import { statoDef } from "../giornaliero/stati";
import { FiltriPopover } from "../../ui/FiltriPopover";
import { EsportaTabella, type ColonnaExport } from "../../ui/esporta/EsportaTabella";
import { PagaProvvigioniModal } from "./PagaProvvigioniModal";
import { StoricoProvvigioniModal } from "./StoricoProvvigioniModal";
import { EsportaProvvigioni, type PagamentoProvv } from "./provvigioniExport";
import { dialog } from "../../ui/dialog/store";
import { Tabella, type DataTableColumn } from "../../ui/Tabella";
import { usePrefs } from "../../lib/prefs";
import { durataSwitchTabelleMs } from "../../ui/motion";
import { formattaDataItaliana } from "../../lib/date";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { RiepilogoLink } from "../../shell/RiepilogoLink";

const EVENTI_RICARICA = [
  "ordine:salvato",
  "pagamento:salvato",
  "agente:salvato",
  "medico:salvato",
  "cliente:salvato",
  "provv_pagamento:salvato",
  "parametri_globali:salvato",
] as const;

const MOSTRA_VUOTI_SESSION_KEY = "pt.contabilita.provvigioni.mostra-vuoti";

function mostraVuotiSalvato(): boolean {
  try {
    return sessionStorage.getItem(MOSTRA_VUOTI_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Riga piatta per l'export/stampa: un ordine + il nome dell'agente. */
interface RigaProvv extends ProvvigioneOrdine {
  agenteNome: string;
}

const COLONNE_EXPORT_PROVV: ColonnaExport<RigaProvv>[] = [
  { key: "agente", label: "Agente", valore: (r) => r.agenteNome },
  { key: "numero", label: "N°", valore: (r) => r.numero },
  { key: "data", label: "Data", tipo: "data", valore: (r) => r.data },
  { key: "cliente", label: "Cliente", valore: (r) => r.clienteNome },
  { key: "stato", label: "Stato", valore: (r) => r.stato },
  { key: "base", label: "Importo", tipo: "euro", totale: true, valore: (r) => r.base },
  { key: "provvigione", label: "Provvigione", tipo: "euro", totale: true, valore: (r) => r.provvigione },
  { key: "maturato", label: "Maturato", valore: (r) => (r.maturato ? "Sì" : "No") },
];

function etichettaMaturazione(m: string): string {
  return m === "chiuso" ? "matura a ordine chiuso" : "matura alla spedizione";
}

function etichettaTipo(tipo: string, valore: number): string {
  return tipo === "fisso"
    ? `€ ${valore.toLocaleString("it-IT")} fissi/ordine`
    : `${valore}% sull'importo`;
}

// ---- Periodo: preset rapidi + intervallo personalizzato (estremi ISO inclusi) ----
type Periodo = "tutto" | "mese" | "scorso" | "trimestre" | "anno" | "custom";

const pad = (n: number) => String(n).padStart(2, "0");
const isoPrimo = (y: number, m0: number) => `${y}-${pad(m0 + 1)}-01`;
const isoUltimo = (y: number, m0: number) =>
  `${y}-${pad(m0 + 1)}-${pad(new Date(y, m0 + 1, 0).getDate())}`;

/** Estremi [dal, al] (inclusi, ISO) del periodo scelto, o null per "tutto". */
function periodoBounds(periodo: Periodo, da: string, a: string, annoG: number): [string, string] | null {
  if (periodo === "tutto") return null;
  if (periodo === "custom") return [da || "0000-01-01", a || "9999-12-31"];
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (periodo === "mese") return [isoPrimo(y, m), isoUltimo(y, m)];
  if (periodo === "scorso") {
    const py = m === 0 ? y - 1 : y;
    const pm = m === 0 ? 11 : m - 1;
    return [isoPrimo(py, pm), isoUltimo(py, pm)];
  }
  if (periodo === "trimestre") {
    // Ultimi 3 mesi incluso quello corrente: dal 1° del mese di 2 mesi fa a fine mese corrente.
    const d = new Date(y, m - 2, 1);
    return [isoPrimo(d.getFullYear(), d.getMonth()), isoUltimo(y, m)];
  }
  const annoBase = annoG !== 0 ? annoG : y;
  return [`${annoBase}-01-01`, `${annoBase}-12-31`]; // anno corrente o selezionato
}

const OPZIONI_PERIODO = [
  { value: "tutto", label: "Tutto" },
  { value: "mese", label: "Questo mese" },
  { value: "scorso", label: "Mese scorso" },
  { value: "trimestre", label: "Ultimo trimestre" },
  { value: "anno", label: "Quest'anno" },
  { value: "custom", label: "Personalizzato…" },
];

type Ordina = "maturato" | "potenziale" | "nome";
const OPZIONI_ORDINA = [
  { value: "maturato", label: "Maturato (più alto)" },
  { value: "potenziale", label: "Potenziale (più alto)" },
  { value: "nome", label: "Nome (A–Z)" },
];

// --- Compact context: decide UNA volta per colonna se mostrare testo o sola icona ----------
// Pattern identico a ColonneDominioProvider del Giornaliero (colonne.tsx): un ghost span
// misura la larghezza naturale del badge più largo; un ResizeObserver rileva quando la cella
// è troppo stretta. La decisione è uniforme su tutte le righe di tutte le card.

interface ProvvCompact { compactStato: boolean; compactMaturato: boolean; }
const ProvvCompactCtx = createContext<ProvvCompact>({ compactStato: false, compactMaturato: false });

/** Avvolge la lista card: misura una volta sola se Stato/Maturato devono comprimersi. */
function ProvvColonneDominioProvider({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ghostStato = useRef<HTMLSpanElement>(null);
  const ghostMaturato = useRef<HTMLSpanElement>(null);
  const [compactStato, setCompactStato] = useState(false);
  const [compactMaturato, setCompactMaturato] = useState(false);

  const misuraColonne = useCallback((leggi: LeggiColonnaCompatta) => {
    const stato = leggi('[data-ptcol="provv-stato"]', ghostStato.current);
    if (stato !== null) setCompactStato(stato);
    const maturato = leggi('[data-ptcol="provv-maturato"]', ghostMaturato.current);
    if (maturato !== null) setCompactMaturato(maturato);
  }, []);
  useCompactColumnObserver(rootRef, misuraColonne);

  // Ghost style: dimensione zero, non impatta il layout
  const ghostWrap: React.CSSProperties = { position: "relative", width: 0, height: 0, overflow: "hidden" };
  const ghostEl: React.CSSProperties = {
    position: "absolute", left: 0, top: 0,
    width: "max-content", maxWidth: "none",
    visibility: "hidden", pointerEvents: "none", whiteSpace: "nowrap",
  };

  return (
    <ProvvCompactCtx.Provider value={{ compactStato, compactMaturato }}>
      <div ref={rootRef} style={{ width: "100%" }}>
        {/* Ghost misuratori: determinano la larghezza naturale del badge più largo */}
        <div style={ghostWrap} aria-hidden>
          <span ref={ghostStato} style={ghostEl}>
            {/* «In produzione» è lo stato con etichetta più lunga */}
            <Badge variant="light" leftSection={<IconCircleDashed size={12} />}>In produzione</Badge>
          </span>
          <span ref={ghostMaturato} style={ghostEl}>
            {/* «In attesa» è il testo maturato più lungo */}
            <Badge variant="light" leftSection={<IconCircleDashed size={12} />}>In attesa</Badge>
          </span>
        </div>
        {children}
      </div>
    </ProvvCompactCtx.Provider>
  );
}

/** Genera le definizioni colonna in base ai flag compact correnti. */
function buildColonneProvv(compactStato: boolean, compactMaturato: boolean): DataTableColumn<ProvvigioneOrdine>[] {
  return [
    { accessor: "numero", title: "N°", cellsClassName: "tabular fw-600" },
    { accessor: "data", title: "Data", cellsClassName: "tabular", render: (r) => formattaDataItaliana(r.data) },
    { accessor: "clienteNome", title: "Cliente", render: (r) => <RiepilogoLink tipo="cliente" id={r.clienteId} nome={r.clienteNome} /> },
    {
      accessor: "stato",
      title: "Stato",
      textAlign: "center",
      render: (r) => {
        const sd = statoDef(r.stato);
        const badge = compactStato ? (
          <Badge variant="light" color={sd.color} px={6} aria-label={sd.label}>
            <sd.Ico size={14} style={{ display: "block" }} />
          </Badge>
        ) : (
          <Badge variant="light" color={sd.color} leftSection={<sd.Ico size={12} />} aria-label={sd.label}>
            {r.stato || "—"}
          </Badge>
        );
        return (
          <Tooltip label={sd.label} withArrow>
            <div data-ptcol="provv-stato" style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              {badge}
            </div>
          </Tooltip>
        );
      },
    },
    {
      accessor: "base",
      title: "Importo",
      textAlign: "right",
      cellsClassName: "tabular",
      render: (r) => `€ ${centsToEurStr(r.base)}`,
    },
    {
      accessor: "provvigione",
      title: "Provvigione",
      textAlign: "right",
      cellsClassName: "tabular fw-600",
      render: (r) => `€ ${centsToEurStr(r.provvigione)}`,
    },
    {
      accessor: "maturato",
      title: "Maturato",
      textAlign: "center",
      render: (r) => {
        const label = r.maturato ? "Sì" : "In attesa";
        const Ico = r.maturato ? IconCircleCheck : IconCircleDashed;
        const badge = compactMaturato ? (
          <Badge color={r.maturato ? "teal" : "gray"} variant="light" px={6} aria-label={label}>
            <Ico size={14} style={{ display: "block" }} />
          </Badge>
        ) : (
          <Badge color={r.maturato ? "teal" : "gray"} variant="light" leftSection={<Ico size={12} />} aria-label={label}>
            {label}
          </Badge>
        );
        return (
          <Tooltip label={label} withArrow>
            <div data-ptcol="provv-maturato" style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              {badge}
            </div>
          </Tooltip>
        );
      },
    },
  ];
}

/** Card di un agente: componente autonomo (fuori da ProvvigioniView) così useContext/useMemo
 *  rispettano le regole degli hook — i callback sono passati come props. */
function AgentCard({
  ag,
  onPaga,
  onStorico,
  virtualizza = true,
}: {
  ag: ProvvigioneAgente;
  onPaga: (ag: ProvvigioneAgente) => void;
  onStorico: (ag: ProvvigioneAgente) => void;
  virtualizza?: boolean;
}) {
  // Pagabile = c'è almeno un ordine maturato o (anche solo) con acconto incassato.
  const hasPagabili = ag.ordini.some((o) => o.maturato || o.accontoIncassato);
  // Legge i flag compact dall'unico ResizeObserver del ProvvColonneDominioProvider
  // esterno: tutte le card usano la stessa decisione, garantendo uniformità visiva.
  const { compactStato, compactMaturato } = useContext(ProvvCompactCtx);
  const colonne = useMemo(
    () => buildColonneProvv(compactStato, compactMaturato),
    [compactStato, compactMaturato]
  );
  const contenuto = (
    <Card withBorder radius="md" p="md">
        <Group justify="space-between" mb="xs" wrap="wrap">
          <Group gap="sm">
            <Text fw={700} fz="lg">
              <RiepilogoLink tipo="agente" id={ag.agenteId} nome={ag.agenteNome} />
            </Text>
            <Badge variant="light" color="gray">
              {etichettaTipo(ag.provvTipo, ag.provvValore)}
            </Badge>
            <Badge variant="light" color="blue">
              {etichettaMaturazione(ag.maturazione)}
            </Badge>
          </Group>
          <Group gap="lg" wrap="nowrap">
            <Box ta="right">
              <Text size="xs" c="dimmed">
                Maturato
              </Text>
              <Text fw={700} className="tabular">
                € {centsToEurStr(ag.totaleMaturato)}
              </Text>
            </Box>
            <Box ta="right">
              <Text size="xs" c="dimmed">
                Potenziale
              </Text>
              <Text fw={500} c="dimmed" className="tabular">
                € {centsToEurStr(ag.totalePotenziale)}
              </Text>
            </Box>
            <Group gap="xs" wrap="nowrap">
              <Button
                size="xs"
                color="accent"
                leftSection={<IconCoin size={15} />}
                disabled={!hasPagabili}
                onClick={() => onPaga(ag)}
              >
                Paga provvigioni
              </Button>
              <Button
                size="xs"
                variant="default"
                leftSection={<IconHistory size={15} />}
                onClick={() => onStorico(ag)}
              >
                Storico
              </Button>
            </Group>
          </Group>
        </Group>

        {/* Tabella ordini fluida, con altezza massima per attivare lo scorrimento se ci sono troppe righe */}
        <Box style={{ maxHeight: 340, overflowY: "auto" }}>
          <Tabella
            records={ag.ordini}
            columns={colonne}
            fetching={false}
            emptyState={<Box />}
            idAccessor="ordineId"
            storeColumnsKey="contabilita-provvigioni"
            verticalSpacing="xs"
            highlightOnHover
          />
        </Box>
    </Card>
  );
  const id = `provv-agente-${ag.agenteId}`;
  return virtualizza ? <VirtualCard id={id}>{contenuto}</VirtualCard> : <div id={id}>{contenuto}</div>;
}

function VirtualCard({ id, children }: { id?: string; children: React.ReactNode }) {
  const { ref, entry } = useIntersection({
    root: null,
    rootMargin: "1500px 0px 1500px 0px", // Margine invisibile gigante per non far notare nulla
    threshold: 0,
  });

  const [height, setHeight] = useState<number | undefined>(undefined);
  const [mounted, setMounted] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Misura costantemente l'altezza quando è montato
  useLayoutEffect(() => {
    if (mounted && containerRef.current) {
      const ro = new ResizeObserver((entries) => {
        if (entries[0]) {
          setHeight(entries[0].borderBoxSize[0]?.blockSize ?? entries[0].contentRect.height);
        }
      });
      ro.observe(containerRef.current);
      return () => ro.disconnect();
    }
  }, [mounted]);

  // Aggiorna lo stato di montaggio senza bloccare lo scorrimento
  useEffect(() => {
    startTransition(() => {
      if (entry) setMounted(entry.isIntersecting);
    });
  }, [entry?.isIntersecting]);

  // NON smontiamo MAI finché non abbiamo un'altezza esatta
  const showReal = mounted || height === undefined;

  return (
    <div id={id} ref={ref} style={{ width: "100%", minHeight: height ? `${height}px` : undefined }}>
      {showReal ? (
        <div ref={containerRef}>{children}</div>
      ) : (
        <Box h={height} /> // Segnaposto: preserva lo scroll senza renderizzare il DOM
      )}
    </div>
  );
}

interface SezioneAgentiSenzaProvvigioniHandle {
  apri: () => void;
}

const SezioneAgentiSenzaProvvigioni = forwardRef<
  SezioneAgentiSenzaProvvigioniHandle,
  {
    agenti: ProvvigioneAgente[];
    onPaga: (ag: ProvvigioneAgente) => void;
    onStorico: (ag: ProvvigioneAgente) => void;
  }
>(function SezioneAgentiSenzaProvvigioni({ agenti, onPaga, onStorico }, ref) {
  // Stato isolato: aprire questa sezione non ridisegna le tabelle degli agenti
  // con provvigioni e non ne riavvia l'animazione d'ingresso.
  const [aperto, setAperto] = useState(mostraVuotiSalvato);
  const contenutoRef = useRef<HTMLDivElement>(null);
  // Lo stato può nascere già aperto perché ricordato nella sessione: questo NON è
  // un'intenzione di navigazione e non deve spostare lo scroll al rimontaggio del tab.
  const scorriAllaProssimaAperturaRef = useRef(false);
  const impostaAperto = useCallback((value: boolean, scorri = false) => {
    scorriAllaProssimaAperturaRef.current = value && scorri;
    try {
      sessionStorage.setItem(MOSTRA_VUOTI_SESSION_KEY, value ? "1" : "0");
    } catch {
      // WebView senza storage: il toggle locale continua comunque a funzionare.
    }
    setAperto(value);
  }, []);

  useImperativeHandle(ref, () => ({ apri: () => impostaAperto(true) }), [impostaAperto]);

  useLayoutEffect(() => {
    if (!aperto || !scorriAllaProssimaAperturaRef.current) return;
    scorriAllaProssimaAperturaRef.current = false;
    const frame = requestAnimationFrame(() => {
      const primaCard = contenutoRef.current?.firstElementChild as HTMLElement | null;
      primaCard?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [aperto]);

  return (
    <Box>
      <Button
        type="button"
        variant="subtle"
        color="gray"
        size="sm"
        aria-expanded={aperto}
        aria-controls="provv-agenti-senza-provvigioni"
        leftSection={aperto ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        onClick={() => impostaAperto(!aperto, !aperto)}
      >
        {aperto ? "Nascondi" : "Mostra"} {agenti.length}{" "}
        {agenti.length === 1 ? "agente senza provvigioni" : "agenti senza provvigioni"}
      </Button>
      {aperto && (
        <Stack ref={contenutoRef} id="provv-agenti-senza-provvigioni" gap="lg" mt="sm">
          {agenti.map((ag) => (
            <AgentCard
              key={ag.agenteId}
              ag={ag}
              onPaga={onPaga}
              onStorico={onStorico}
              virtualizza={false}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
});

export function ProvvigioniView({
  filtroIniziale,
  attiva = true,
}: {
  attiva?: boolean;
  /** Deep-link dashboard: periodo (dal/al) e agente da pre-applicare. */
  filtroIniziale?: { nonce?: number; dal?: string; al?: string; agenteId?: string; ordina?: "maturato" | "potenziale" | "nome" };
} = {}) {
  const { anno, ridurreAnimazioni } = usePrefs();
  const [agenti, setAgenti] = useState<RecordDto[]>([]);
  const [agenteId, setAgenteId] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>("tutto");
  const [da, setDa] = useState("");
  const [al, setAl] = useState("");
  const [ordina, setOrdina] = useState<Ordina>("maturato");
  const [report, setReport] = useState<ProvvigioniReport | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  // Modali per-agente: saldo provvigioni e storico dei pagamenti.
  const [pagaAgente, setPagaAgente] = useState<ProvvigioneAgente | null>(null);
  const [storicoAgente, setStoricoAgente] = useState<Pick<ProvvigioneAgente, "agenteId" | "agenteNome"> | null>(null);
  // Pagamento da esportare/stampare (dopo il saldo o da una voce dello storico).
  const [esportaPag, setEsportaPag] = useState<PagamentoProvv | null>(null);
  // Agente verso cui scorrere dopo un pagamento o un deep-link esplicito da Spotlight.
  // Non viene mai valorizzato dal semplice rimontaggio/ritorno al tab.
  const [scrollAgente, setScrollAgente] = useState<string | null>(null);
  const sezioneSenzaProvvigioniRef = useRef<SezioneAgentiSenzaProvvigioniHandle>(null);

  useEffect(() => {
    api.recordsList("agente").then(setAgenti).catch(() => {});
  }, []);

  // Deep-link dashboard: periodo personalizzato (dal/al) e/o agente.
  useEffect(() => {
    if (!filtroIniziale) return;
    setAgenteId(filtroIniziale.agenteId ?? null);
    if (filtroIniziale.agenteId) setScrollAgente(filtroIniziale.agenteId);
    setOrdina(filtroIniziale.ordina ?? "maturato");
    if (filtroIniziale.dal || filtroIniziale.al) {
      setPeriodo("custom");
      setDa(filtroIniziale.dal ?? "");
      setAl(filtroIniziale.al ?? "");
    } else {
      setPeriodo("tutto");
      setDa("");
      setAl("");
    }
  }, [filtroIniziale]);

  const carica = useCallback(async (silente = false) => {
    if (!silente) setCaricamento(true);
    try {
      const b = periodoBounds(periodo, da, al, anno);
      setReport(await api.provvigioniReport(b?.[0] ?? null, b?.[1] ?? null, agenteId));
    } catch (e) {
      toast.error(`Caricamento provvigioni non riuscito: ${e}`);
    } finally {
      setCaricamento(false);
    }
  }, [periodo, da, al, agenteId, anno]);

  useEffect(() => {
    carica(false);
  }, [carica]);
  useRicaricaSuEventi(EVENTI_RICARICA, () => carica(true), 160);

  // Scroll verso l'agente richiesto esplicitamente, una volta che il report corretto è
  // caricato e la card è renderizzata. Un report precedente non deve consumare la richiesta.
  useEffect(() => {
    if (!attiva || !scrollAgente || caricamento || !report?.agenti.some((ag) => ag.agenteId === scrollAgente)) return;
    const id = window.requestAnimationFrame(() => {
      const el = document.getElementById(`provv-agente-${scrollAgente}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setScrollAgente(null);
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [attiva, scrollAgente, caricamento, report]);

  const datiAgenti = useMemo(
    () => agenti.map((a) => ({ value: a.id, label: (a.data.nome as string) || "(senza nome)" })),
    [agenti]
  );

  const vuoto = !report || report.agenti.length === 0;

  // Ordina e separa: agenti CON provvigioni nel periodo (in alto, ordinati) vs SENZA
  // (potenziale 0 → in fondo, collassati). Così la vista resta concentrata su chi conta.
  const { conProvv, senzaProvv } = useMemo(() => {
    if (!report) return { conProvv: [] as ProvvigioneAgente[], senzaProvv: [] as ProvvigioneAgente[] };
    const con = report.agenti.filter((ag) => ag.totalePotenziale > 0);
    const senza = report.agenti.filter((ag) => ag.totalePotenziale <= 0);
    const perNome = (x: ProvvigioneAgente, y: ProvvigioneAgente) =>
      x.agenteNome.localeCompare(y.agenteNome, "it");
    con.sort((x, y) => {
      if (ordina === "nome") return perNome(x, y);
      if (ordina === "potenziale")
        return y.totalePotenziale - x.totalePotenziale || y.totaleMaturato - x.totaleMaturato;
      return y.totaleMaturato - x.totaleMaturato || y.totalePotenziale - x.totalePotenziale;
    });
    senza.sort(perNome);
    return { conProvv: con, senzaProvv: senza };
  }, [report, ordina]);

  // Righe piatte per l'export/stampa universale (un ordine per riga, col nome agente).
  // Rispetta i filtri perché il report è già calcolato su agente + periodo scelti.
  const righeExport = useMemo<RigaProvv[]>(
    () =>
      report
        ? report.agenti.flatMap((ag) => ag.ordini.map((o) => ({ ...o, agenteNome: ag.agenteNome })))
        : [],
    [report]
  );

  const nFiltri = (agenteId ? 1 : 0) + (periodo !== "tutto" ? 1 : 0);

  function azzeraFiltri() {
    setAgenteId(null);
    setPeriodo("tutto");
    setDa("");
    setAl("");
  }

  // Dopo un saldo: ricarica e propone storico oppure export/stampa del pagamento appena fatto.
  async function handlePagato(pagato: PagamentoProvv) {
    await carica();
    // Se ora è senza provvigioni residue, finisce nella sezione collassata: aprila così la
    // card è visibile, poi ci scorriamo sopra.
    try {
      sessionStorage.setItem(MOSTRA_VUOTI_SESSION_KEY, "1");
    } catch {
      // La ref apre comunque la sezione nella WebView corrente.
    }
    sezioneSenzaProvvigioniRef.current?.apri();
    requestAnimationFrame(() => sezioneSenzaProvvigioniRef.current?.apri());
    setScrollAgente(pagato.agenteId ?? null);
    const scelta = await dialog.open<"storico" | "stampa" | null>({
      tipo: "question",
      titolo: "Provvigioni pagate",
      contenuto: (
        <Text size="sm">
          Hai saldato {pagato.righe.length} {pagato.righe.length === 1 ? "ordine" : "ordini"} di{" "}
          <b>{pagato.agenteNome}</b>. Vuoi aprire lo storico dell'agente oppure stampare le
          provvigioni appena pagate?
        </Text>
      ),
      valoreAnnulla: null,
      bottoni: [
        { label: "Chiudi", variante: "secondario", value: null },
        { label: "Mostra storico", variante: "informativo", value: "storico" },
        { label: "Stampa provvigioni", variante: "primario", value: "stampa", autofocus: true },
      ],
    });
    if (scelta === "storico" && pagato.agenteId) {
      setStoricoAgente({ agenteId: pagato.agenteId, agenteNome: pagato.agenteNome });
    } else if (scelta === "stampa") {
      setEsportaPag(pagato);
    }
  }


  const nascosta = !attiva || (caricamento && report === null);

  return (
    <Stack
      gap="md"
      style={{
        height: "100%",
        opacity: nascosta ? 0 : 1,
        visibility: nascosta ? "hidden" : "visible",
        transition: ridurreAnimazioni ? "none" : `opacity ${durataSwitchTabelleMs}ms ease-out`,
      }}
    >
      {/* Barra filtri + export */}
      <Group gap="sm" wrap="nowrap" align="flex-end">
        <FiltriPopover
          attivi={nFiltri}
          onAzzera={azzeraFiltri}
          width={320}
          filtri={[
            {
              chiave: "agente",
              larghezza: 200,
              nodo: (
                <Select
                  label="Agente"
                  placeholder="Tutti gli agenti"
                  data={datiAgenti}
                  value={agenteId}
                  onChange={setAgenteId}
                  clearable
                  searchable
                  comboboxProps={{ withinPortal: false }}
                />
              ),
            },
            {
              chiave: "periodo",
              larghezza: 180,
              nodo: (
                <Select
                  label="Periodo"
                  data={OPZIONI_PERIODO}
                  value={periodo}
                  onChange={(v) => setPeriodo((v as Periodo) ?? "tutto")}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: false }}
                />
              ),
            },
            ...(periodo === "custom"
              ? [
                  {
                    chiave: "date",
                    larghezza: 260,
                    nodo: (
                      <Group gap="xs" grow>
                        <TextInput label="Dal" type="date" value={da} onChange={(e) => setDa(e.currentTarget.value)} />
                        <TextInput label="Al" type="date" value={al} onChange={(e) => setAl(e.currentTarget.value)} />
                      </Group>
                    ),
                  },
                ]
              : []),
            {
              chiave: "ordina",
              larghezza: 180,
              nodo: (
                <Select
                  label="Ordina per"
                  data={OPZIONI_ORDINA}
                  value={ordina}
                  onChange={(v) => setOrdina((v as Ordina) ?? "maturato")}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: false }}
                />
              ),
            },
          ]}
        />
        <EsportaTabella
          nomeBase="provvigioni"
          foglio="Provvigioni"
          titolo="Provvigioni agenti"
          colonne={COLONNE_EXPORT_PROVV}
          righe={righeExport}
          disabled={vuoto}
        />
      </Group>

      {/* Totale generale */}
      {report && !vuoto && (
        <Card withBorder radius="md" p="md" bg="var(--bg)">
          <Group justify="space-between" wrap="wrap">
            <Group gap="sm">
              <ThemeIcon size={40} radius="md" variant="light" color="accent">
                <IconCoin size={22} />
              </ThemeIcon>
              <Box>
                <Text size="xs" c="dimmed">
                  Totale maturato (da pagare)
                </Text>
                <Text fw={700} fz={24} className="tabular">
                  € {centsToEurStr(report.totaleMaturato)}
                </Text>
              </Box>
            </Group>
            <Group gap="xl" wrap="nowrap">
              <Box ta="right">
                <Text size="xs" c="dimmed">
                  Già pagate (escluse)
                </Text>
                <Text fw={600} fz="lg" c="teal" className="tabular">
                  € {centsToEurStr(report.totalePagato)}
                </Text>
              </Box>
              <Box ta="right">
                <Text size="xs" c="dimmed">
                  Potenziale (incl. non ancora maturato)
                </Text>
                <Text fw={600} fz="lg" c="dimmed" className="tabular">
                  € {centsToEurStr(report.totalePotenziale)}
                </Text>
              </Box>
            </Group>
          </Group>
        </Card>
      )}

      <Box
        style={{
          flex: 1,
          minHeight: 0,
          overflowX: "auto",
          overflowY: "scroll",
          scrollbarGutter: "stable",
        }}
      >
        {/* Niente spinner: i dati sono locali e immediati; durante il primo
            caricamento non mostriamo nulla per non far lampeggiare lo schermo. */}
        {caricamento ? null : vuoto ? (
          <Center style={{ height: "100%", minHeight: 240 }}>
            <Stack align="center" gap="xs" maw={420} ta="center">
              <ThemeIcon size={48} radius="xl" variant="light" color="gray">
                <IconCoin size={24} />
              </ThemeIcon>
              <Text c="dimmed" size="sm">
                Nessuna provvigione per i filtri scelti. Gli ordini rifiutati e gli omaggi sono
                esclusi; controlla il periodo e l'agente.
              </Text>
            </Stack>
          </Center>
        ) : (
          <ProvvColonneDominioProvider>
            <Stack gap="lg">
              {conProvv.map((ag) => (
                <AgentCard key={ag.agenteId} ag={ag} onPaga={setPagaAgente} onStorico={setStoricoAgente} />
              ))}

              {senzaProvv.length > 0 &&
                // Se si è filtrato un agente specifico (dai filtri o dal deep-link
                // anagrafica), mostralo SUBITO anche se non ha provvigioni: nasconderlo
                // dietro «Mostra agenti senza provvigioni» sarebbe disorientante.
                (agenteId ? (
                  <Stack gap="lg">
                    {senzaProvv.map((ag) => (
                      <AgentCard key={ag.agenteId} ag={ag} onPaga={setPagaAgente} onStorico={setStoricoAgente} />
                    ))}
                  </Stack>
                ) : (
                  <SezioneAgentiSenzaProvvigioni
                    ref={sezioneSenzaProvvigioniRef}
                    agenti={senzaProvv}
                    onPaga={setPagaAgente}
                    onStorico={setStoricoAgente}
                  />
                ))}
            </Stack>
          </ProvvColonneDominioProvider>
        )}
      </Box>

      <PagaProvvigioniModal
        agente={pagaAgente}
        onClose={() => setPagaAgente(null)}
        onPagato={handlePagato}
      />
      <StoricoProvvigioniModal
        agenteId={storicoAgente?.agenteId ?? null}
        agenteNome={storicoAgente?.agenteNome ?? ""}
        onClose={() => setStoricoAgente(null)}
        onAnnullato={carica}
        onEsporta={setEsportaPag}
        bloccaChiusura={!!esportaPag}
      />
      <EsportaProvvigioni pagamento={esportaPag} onClose={() => setEsportaPag(null)} />
    </Stack>
  );
}
