// Tabella universale del progetto: wrapper attorno a mantine-datatable con lo
// stile dell'app (bordo arrotondato, header sticky, hover) + funzioni pronte per
// tutte le liste: resize colonne (con persistenza), sort cliccando l'header,
// riempimento dell'altezza disponibile (header/filtri di pagina restano fissi e
// solo il corpo scrolla), impaginazione quando i dati sono tanti.
//
// USO CLUSTER VIRTUALIZATION (CHUNKING)
// Se i records superano la soglia (CHUNK_SIZE), la tabella viene automaticamente spezzettata
// in sottotabelle e solo quelle visibili a schermo vengono montate da React, per evitare lag.
//
// CONVENZIONE EMPTY-STATE (regola del progetto, vale per OGNI tabella) -> fetch-then-render:
//   - finché `caricamento` è in corso si passa un `emptyState={<Box/>}` VUOTO (niente messaggio,
//     niente spinner): i dati locali sono immediati e non deve "lampeggiare" un falso vuoto;
//   - finito il caricamento, se non ci sono righe si mostra un `emptyState` DEDICATO e parlante
//     (icona + frase specifica della vista, es. «Nessun credito», «Nessun rimborso»), che
//     distingue "nessun dato in assoluto" da "nessun risultato per i filtri" quando utile.
import { useLayoutEffect, useMemo, useRef, useState, startTransition, useEffect, useId, useContext } from "react";
import { Box } from "@mantine/core";
import { useIntersection } from "@mantine/hooks";
import { DataTable, type DataTableProps } from "mantine-datatable";
import { usePrefs } from "../lib/prefs";
import { RivelazionePagina } from "../pages/Pagina";

export type { DataTableColumn, DataTableSortStatus } from "mantine-datatable";

const CHUNK_SIZE = 30;
const ROOT_MARGIN_CHUNK = "1200px 0px 1200px 0px";
// Quante righe entrano "a cascata" all'apertura (le altre compaiono subito): cap a 40
// così su schermi grandi l'animazione copre l'intera view iniziale.
const CAP_RIGHE_ANIM = 40;
const PASSO_ANIM_MS = 24;
// Quanto dopo il reveal della pagina una tabella è ancora considerata "iniziale" (e quindi
// anima). Le tabelle che compaiono scrollando ben oltre questa finestra NON animano.
const FINESTRA_REVEAL_MS = 800;
const SELETTORE_CONTROLLI_INTERATTIVI =
  'button, a, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"], ' +
  ".mantine-Menu-dropdown, .mantine-Popover-dropdown";

/** I dropdown Mantine sono renderizzati in un portal, ma gli eventi React continuano
 *  a risalire fino alla riga che contiene il relativo trigger. Un click destro su un
 *  comando del dropdown non deve quindi essere interpretato come click destro sulla riga. */
function provieneDaControlloInterattivo(event: React.MouseEvent): boolean {
  const target = event.target;
  return (
    target instanceof Element &&
    target.closest(SELETTORE_CONTROLLI_INTERATTIVI) !== null
  );
}

// GUARD resize↔ordinamento: trascinando l'handle di ridimensionamento di una colonna OLTRE il
// minimo, il gesto termina come un click sull'header → mantine lo interpreta come ordinamento
// (bug). Qui, dopo un drag iniziato su un handle di resize, "mangiamo" il click sull'header che
// arriva subito dopo. Installato UNA sola volta a livello di documento (vale per OGNI Tabella).
let guardInstallato = false;
export let globalIsResizing = false;

function installaGuardResizeSort() {
  if (guardInstallato || typeof document === "undefined") return;
  guardInstallato = true;
  let resizing = false;
  let bloccaFinoA = 0;
  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".mantine-datatable-header-resizable-handle")) {
        resizing = true;
        globalIsResizing = true;
      }
    },
    true
  );
  document.addEventListener(
    "pointerup",
    () => {
      if (resizing) {
        resizing = false;
        globalIsResizing = false;
        // Il click parassita scatta subito dopo il pointerup: breve finestra di blocco.
        bloccaFinoA = Date.now() + 250;
      }
    },
    true
  );
  document.addEventListener(
    "click",
    (e) => {
      if (Date.now() >= bloccaFinoA) return;
      bloccaFinoA = 0;
      // Blocca solo il click sull'header (l'ordinamento): non tocca i click sulle righe.
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("th")) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true
  );
}

// Sotto-componente per il singolo blocco virtualizzato
function TabellaChunk<T>({
  chunkProps,
  index,
  totalRecords,
  globalSelectedRecords,
  onGlobalSelectedRecordsChange,
  idAccessor,
  scrollLeftRef,
  estimatedHeight,
}: {
  chunkProps: DataTableProps<T>;
  index: number;
  totalRecords: T[];
  globalSelectedRecords: T[] | undefined;
  onGlobalSelectedRecordsChange: ((records: T[]) => void) | undefined;
  idAccessor: any;
  scrollLeftRef: React.MutableRefObject<number>;
  estimatedHeight: number;
}) {
  const { ref, entry } = useIntersection({
    root: null,
    rootMargin: ROOT_MARGIN_CHUNK,
    threshold: 0,
  });

  const [height, setHeight] = useState<number | undefined>(undefined);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cattura l'altezza esatta della tabella in tempo reale
  useLayoutEffect(() => {
    if (mounted && containerRef.current) {
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          setHeight(e.contentRect.height);
        }
      });
      ro.observe(containerRef.current);
      return () => ro.disconnect();
    }
  }, [mounted]);

  // Riallinea istantaneamente lo scroll orizzontale al montaggio (prima del repaint)
  // e nei frame successivi per prevenire sovrascritture durante l'init interno di Mantine.
  useLayoutEffect(() => {
    if (mounted && containerRef.current) {
      const riallinea = () => {
        const wrapper = containerRef.current?.querySelector(".mantine-ScrollArea-viewport");
        if (wrapper) {
          const left = scrollLeftRef.current;
          if (wrapper.scrollLeft !== left) {
            wrapper.scrollLeft = left;
          }
        }
      };
      riallinea();
      const frame = requestAnimationFrame(riallinea);
      const timer = setTimeout(riallinea, 50); // Sicurezza contro init asincroni tardivi
      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
      };
    }
  }, [mounted, scrollLeftRef]);

  // Montaggio ASINCRONO: quando la tabella entra a schermo, la montiamo usando
  // startTransition di React 18. Questo impedisce al pesante render di DataTable
  // di bloccare il thread principale, rendendo lo scorrimento fluido (nessuno scatto).
  useEffect(() => {
    startTransition(() => {
      setMounted(!!entry?.isIntersecting);
    });
  }, [entry?.isIntersecting]);

  const getId = (r: T) =>
    typeof idAccessor === "function" ? idAccessor(r) : (r as any)[idAccessor as string];

  // Gestione selezioni: fondiamo le selezioni del chunk col totale globale
  const handleChunkSelectionChange = (newChunkSelection: T[]) => {
    if (!onGlobalSelectedRecordsChange) return;

    const globalSelection = globalSelectedRecords || [];
    const newGlobalMap = new Map<string, T>();

    // 1. Partiamo da tutto ciò che è attualmente selezionato globalmente
    globalSelection.forEach((r) => newGlobalMap.set(getId(r), r));
    // 2. Rimuoviamo i record di questo specifico blocco
    chunkProps.records?.forEach((r) => newGlobalMap.delete(getId(r)));
    // 3. Riapplichiamo solo quelli spuntati ora nel blocco
    newChunkSelection.forEach((r) => newGlobalMap.set(getId(r), r));

    onGlobalSelectedRecordsChange(Array.from(newGlobalMap.values()));
  };

  const isChecked =
    totalRecords.length > 0 && globalSelectedRecords?.length === totalRecords.length;
  const isIndeterminate =
    (globalSelectedRecords?.length || 0) > 0 &&
    (globalSelectedRecords?.length || 0) < totalRecords.length;

  // Se è fuori schermo (ed è stata già calcolata un'altezza), smontiamo la tabella
  // e rilasciamo la memoria (addio Tooltip e Badge invisibili!) lasciando un fantasma.
  // IMPORTANTE: Il chunk 0 (quello con l'header) NON viene mai smontato. Deve restare
  // nel DOM per far sì che il nostro script di sincronizzazione delle colonne trovi
  // sempre le larghezze originali da copiare ai chunk successivi.
  if (!mounted && index > 0) {
    return <Box ref={ref} style={{ height: height ?? estimatedHeight }} />;
  }

  return (
    <Box ref={ref} className={index > 0 ? "pt-chunk-follower" : ""}>
      <Box ref={containerRef}>
        <DataTable
          {...chunkProps}
          // Disattiviamo lo storeColumnsKey interno di DataTable per evitare che mantine-datatable
          // gestisca autonomamente (e in conflitto con noi) l'ordine e la visibilità delle colonne.
          storeColumnsKey={undefined}
          noHeader={index > 0} // Nascondiamo le testate dai blocchi successivi
          selectedRecords={globalSelectedRecords}
          onSelectedRecordsChange={onGlobalSelectedRecordsChange ? handleChunkSelectionChange : undefined}
          allRecordsSelectionCheckboxProps={
            index === 0 && onGlobalSelectedRecordsChange
              ? {
                  checked: isChecked,
                  indeterminate: isIndeterminate,
                  onChange: (e: any) => {
                    if (e.currentTarget.checked) {
                      onGlobalSelectedRecordsChange(totalRecords);
                    } else {
                      onGlobalSelectedRecordsChange([]);
                    }
                  },
                }
              : undefined
          }
        />
      </Box>
    </Box>
  );
}

export type TabellaProps<T> = DataTableProps<T> & {
  memorizzaLarghezze?: boolean;
  /** Minimi in pixel per le colonne che devono conservare integralmente il contenuto. */
  minColumnWidths?: Record<string, number>;
  /** Colonne corte che non devono assorbire lo spazio avanzato (ma possono restringersi). */
  fixedColumnWidths?: string[];
  /** Finché è true i riadattamenti appartengono al primo caricamento e avvengono senza fade. */
  caricamentoIniziale?: boolean;
  /** Un cambio di chiave riadatta la tabella senza fade (es. apertura/chiusura di una row). */
  ridimensionamentoSenzaSfumaturaKey?: string | number;
};

const eventoResetLarghezze = "pt:tabella-reset-larghezze";

export function chiaveLarghezzeTabella(storeColumnsKey: string): string {
  return `pt.tabella.${storeColumnsKey}.columns-width.v2`;
}

export function resetLarghezzeTabella(storeColumnsKey: string) {
  localStorage.removeItem(chiaveLarghezzeTabella(storeColumnsKey));
  // Pulisce anche il formato storico di mantine-datatable.
  localStorage.removeItem(`${storeColumnsKey}-columns-width`);
  window.dispatchEvent(new CustomEvent(eventoResetLarghezze, { detail: storeColumnsKey }));
}

export function Tabella<T>(props: TabellaProps<T>) {
  const {
    memorizzaLarghezze = true,
    minColumnWidths,
    fixedColumnWidths,
    caricamentoIniziale = false,
    ridimensionamentoSenzaSfumaturaKey,
    ...dataTableProps
  } = props;
  const { densitaTabelle, ridurreAnimazioni, sidebar } = usePrefs();
  const fadeTimerRef = useRef<any>(null);
  const lastWidthRef = useRef(0);
  const deveAnimareRef = useRef(false);
  const debounceTimerRef = useRef<any>(null);
  const soppressioneTimerRef = useRef<any>(null);
  const sopprimiSfumaturaRef = useRef(caricamentoIniziale);
  const caricamentoPrecedenteRef = useRef(caricamentoIniziale);
  const chiaveSilenziosaPrecedenteRef = useRef(ridimensionamentoSenzaSfumaturaKey);
  const moRef = useRef<MutationObserver | null>(null);
  const applicaSeNecessarioRef = useRef<((conAnimazione?: boolean) => void) | null>(null);

  useEffect(() => installaGuardResizeSort(), []);

  const reactId = useId();
  const uniqueId = useMemo(() => reactId.replace(/:/g, ""), [reactId]);
  const containerId = `tabella-cluster-${uniqueId}`;
  const styleId = `style-cluster-${uniqueId}`;
  const sel = `#${containerId} .pt-chunk-follower .mantine-datatable-table`;
  const shellRef = useRef<HTMLDivElement>(null);
  const globalScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [clientWidth, setClientWidth] = useState(0);
  const resizeManualeRef = useRef(false);

  const sopprimiProssimoRiadattamento = () => {
    sopprimiSfumaturaRef.current = true;
    deveAnimareRef.current = false;
    const shell = shellRef.current;
    shell?.classList.remove("pt-tabella-pre-fade", "pt-tabella-fade-in");
    window.clearTimeout(debounceTimerRef.current);
    window.clearTimeout(soppressioneTimerRef.current);
    requestAnimationFrame(() => applicaSeNecessarioRef.current?.(false));
    soppressioneTimerRef.current = window.setTimeout(() => {
      sopprimiSfumaturaRef.current = false;
    }, 360);
  };

  // Il passaggio caricamento -> dati può cambiare scrollbar e larghezza disponibile: è ancora
  // inizializzazione, quindi lo assorbiamo senza la sfumatura riservata ai resize reali.
  useLayoutEffect(() => {
    const prima = caricamentoPrecedenteRef.current;
    caricamentoPrecedenteRef.current = caricamentoIniziale;
    if (caricamentoIniziale) {
      sopprimiProssimoRiadattamento();
    } else if (prima) {
      sopprimiProssimoRiadattamento();
    }
    // La funzione usa soltanto ref intenzionalmente: non deve ricreare observer o timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caricamentoIniziale]);

  // Le variazioni dichiarate dal chiamante (row expansion/collapse) possono far comparire la
  // scrollbar verticale e quindi cambiare la larghezza di pochi pixel, ma non sono resize della
  // view: manteniamo il riadattamento immediato e silenzioso.
  useLayoutEffect(() => {
    const prima = chiaveSilenziosaPrecedenteRef.current;
    chiaveSilenziosaPrecedenteRef.current = ridimensionamentoSenzaSfumaturaKey;
    if (prima !== ridimensionamentoSenzaSfumaturaKey) sopprimiProssimoRiadattamento();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ridimensionamentoSenzaSfumaturaKey]);

  // Offset di scroll orizzontale CONDIVISO da tutti i chunk: lo aggiorna chi scrolla e lo
  // ri-applica il loop di sync ai chunk (anche a quelli appena montati durante lo scroll
  // verticale, che altrimenti ripartirebbero da 0 → disallineati dagli altri).
  const scrollLeftRef = useRef(0);

  const vuota = !props.records || props.records.length === 0;

  const totalRecords = props.records || [];
  const estimatedRowHeight = densitaTabelle === "compatta" ? 37 : 53;
  
  // Dividiamo i records in chunk solo se non c'è già una paginazione forzata a blocchi piccoli
  const chunks = useMemo(() => {
    if (totalRecords.length <= CHUNK_SIZE) return [totalRecords];
    const res = [];
    for (let i = 0; i < totalRecords.length; i += CHUNK_SIZE) {
      res.push(totalRecords.slice(i, i + CHUNK_SIZE));
    }
    return res;
  }, [totalRecords]);

  // Entrata "a cascata" delle prime righe, UNA volta sola appena la tabella ha dati
  // (fetch-then-render: niente animazione sul vuoto iniziale). Dopo la finestra il flag
  // torna false, così filtri/ordinamenti successivi non ri-animano e le rowClassName
  // originali dei chiamanti (talvolta memoizzate apposta) tornano referenzialmente stabili.
  const rivelatoMs = useContext(RivelazionePagina);
  const montatoMs = useRef(Date.now()); // istante di mount della tabella (1ª render)
  const [animaRighe, setAnimaRighe] = useState(false);
  const giaAnimato = useRef(false);
  // useLayoutEffect (non useEffect): applica la classe d'entrata PRIMA del paint, così le
  // righe non vengono mai disegnate "piene" per un frame e poi ri-animate (lo scatto brutto).
  useLayoutEffect(() => {
    if (giaAnimato.current || ridurreAnimazioni || totalRecords.length === 0) return;
    // Dentro una Pagina: anima solo le tabelle che erano già montate AL REVEAL (o subito
    // dopo). Gating sul MOUNT, non sull'arrivo dati: così le tabelle "iniziali" animano anche
    // se i dati arrivano lenti (es. Crediti, dove il reveal della Pagina-hub può precedere i
    // dati), mentre le tabelle che compaiono SCROLLANDO ben dopo il reveal (Provvigioni) NO.
    // La cascata parte comunque al reveal (la pagina prima è nascosta): niente "solo la fine".
    if (rivelatoMs !== null) {
      if (rivelatoMs === 0) return; // pagina non ancora rivelata: aspetta
      if (montatoMs.current > rivelatoMs + FINESTRA_REVEAL_MS) return; // montata scrollando
    }
    giaAnimato.current = true;
    setAnimaRighe(true);
    const durata = Math.min(totalRecords.length, CAP_RIGHE_ANIM) * PASSO_ANIM_MS + 280;
    const t = setTimeout(() => setAnimaRighe(false), durata + 120);
    return () => clearTimeout(t);
  }, [ridurreAnimazioni, totalRecords.length, rivelatoMs]);

  // rowClassName/rowStyle del chiamante + cascata: le PRIME N righe ricevono la classe e
  // un animation-delay crescente (per indice). Solo mentre `animaRighe` è attivo; fuori da
  // quella finestra restituiamo gli originali del chiamante (identità stabile).
  const rowClassNameUtente = props.rowClassName as
    | string
    | ((r: T, idx: number) => string | undefined)
    | undefined;
  const rowStyleUtente = props.rowStyle as ((r: T, idx: number) => Record<string, unknown> | undefined) | undefined;
  const classeRiga = (record: T, i: number): string | undefined => {
    const base = typeof rowClassNameUtente === "function" ? rowClassNameUtente(record, i) : rowClassNameUtente;
    const anim = i < CAP_RIGHE_ANIM ? "pt-riga-anim" : undefined;
    return [base, anim].filter(Boolean).join(" ") || undefined;
  };
  const stileRiga = (record: T, i: number) => {
    const base = typeof rowStyleUtente === "function" ? rowStyleUtente(record, i) : undefined;
    return i < CAP_RIGHE_ANIM ? { ...(base || {}), animationDelay: `${i * PASSO_ANIM_MS}ms` } : base;
  };
  // Da fondere SOLO sulla prima tabella visibile (singolo chunk o chunk 0): i chunk
  // successivi si montano scrollando → non devono ri-animare. Tipizzato "lasco" (any al
  // punto di spread) per non far esplodere il type-checker sull'unione DataTableProps.
  const animRowProps: Record<string, unknown> = animaRighe
    ? { rowClassName: classeRiga, rowStyle: stileRiga }
    : {};

  const baseProps = {
    withTableBorder: true,
    borderRadius: "md",
    highlightOnHover: true,
    verticalSpacing: densitaTabelle === "compatta" ? 4 : 8,
    horizontalSpacing: densitaTabelle === "compatta" ? 6 : 8,
    fetching: false,
    noRecordsText: "Nessun dato",
    ...dataTableProps,
    onRowContextMenu: dataTableProps.onRowContextMenu
      ? (args: any) => {
          if (provieneDaControlloInterattivo(args.event)) {
            args.event.preventDefault();
            args.event.stopPropagation();
            return;
          }
          dataTableProps.onRowContextMenu?.(args);
        }
      : undefined,
  } as DataTableProps<T>;

  // Resize proprietario e responsivo. Le preferenze salvano PESI per questa singola tabella;
  // a ogni variazione della view vengono ridistribuiti nello spazio corrente rispettando i
  // minimi. In questo modo una misura presa su una finestra grande non resta rigida su una
  // finestra piccola e il reset si adatta subito alla view presente.
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const chiaveBase = props.storeColumnsKey;
    if (!shell || !chiaveBase) return;

    const trova = () => {
      const table = Array.from(shell.querySelectorAll(".mantine-datatable-table"))
        .find((candidata) => candidata.querySelector("thead")) as HTMLElement | undefined;
      // La selezione e' una colonna tecnica gestita separatamente da Mantine (44 px).
      // Includerla qui la farebbe contare due volte in `applicaRigido`: durante il drag la
      // tabella si allargherebbe temporaneamente e l'ultima azione scivolerebbe fuori vista.
      const ths = table ? Array.from(table.querySelectorAll(
        'thead tr:last-child th[data-accessor]:not([data-accessor="__selection__"])'
      )) as HTMLElement[] : [];
      return table && ths.length ? { table, ths } : null;
    };

    const minimo = (th: HTMLElement) => {
      const acc = th.dataset.accessor;
      const esplicito = acc ? minColumnWidths?.[acc] : undefined;
      if (esplicito) return esplicito;
      if (acc === "azioni" || acc === "azione" || acc === "__azioni") {
        if (acc === "__azioni") return 40;
        return acc === "azioni" ? 36 : 68;
      }
      if (acc === "data" || acc === "scadenza" || acc === "incasso") return 68;
      if (acc === "numero" || acc === "ordine" || acc === "righe") return 56;
      return 64;
    };

    const fissa = (th: HTMLElement) => {
      const acc = th.dataset.accessor;
      return acc === "azioni" || acc === "azione" || acc === "__azioni" || (!!acc && (fixedColumnWidths?.includes(acc) ?? false));
    };

    const distribuisci = (preferite: number[], minimi: number[], fisse: boolean[], spazio: number) => {
      const minimoTotale = minimi.reduce((a, b) => a + b, 0);
      const target = Math.max(minimoTotale, spazio);
      const basi = preferite.map((v, i) => Math.max(minimi[i], Number.isFinite(v) ? v : minimi[i]));
      const baseTotale = basi.reduce((a, b) => a + b, 0);
      if (baseTotale === target) return basi;
      if (target > baseTotale) {
        const extra = target - baseTotale;
        const flessibili = fisse.filter((v) => !v).length || 1;
        // Lo spazio avanzato va a TUTTE le colonne flessibili in parti uguali. Usare
        // la larghezza corrente come peso faceva diventare enorme la colonna già più
        // larga (tipicamente Pagamento), lasciando le altre compresse.
        return basi.map((v, i) => v + (fisse[i] ? 0 : extra / flessibili));
      }
      const margini = basi.map((v, i) => Math.max(0, v - minimi[i]));
      const margineTotale = margini.reduce((a, b) => a + b, 0);
      if (!margineTotale) return minimi;
      const disponibileOltreMinimo = target - minimoTotale;
      return minimi.map((m, i) => m + disponibileOltreMinimo * (margini[i] / margineTotale));
    };

    const larghezzaSelezione = (table: HTMLElement) =>
      (table.querySelector(".mantine-datatable-header-selector-cell") as HTMLElement | null)
        ?.getBoundingClientRect().width ?? 0;

    const applicaLarghezzeColonne = (ths: HTMLElement[], larghezze: number[]) => {
      ths.forEach((th, i) => {
        const width = `${Math.round(larghezze[i])}px`;
        if (th.style.width !== width) {
          th.style.width = width;
          th.style.minWidth = width;
          th.style.maxWidth = width;
        }
      });
    };

    const applicaFluido = (table: HTMLElement, ths: HTMLElement[], preferite: number[], conAnimazione = false) => {
      const viewport = table.closest(".mantine-ScrollArea-viewport") as HTMLElement | null;
      const disponibile = viewport?.clientWidth || shell.clientWidth || table.getBoundingClientRect().width;
      const selezione = larghezzaSelezione(table);
      const minimi = ths.map(minimo);
      const larghezze = distribuisci(preferite, minimi, ths.map(fissa), Math.max(0, disponibile - selezione));
      const totale = larghezze.reduce((a, b) => a + b, 0) + selezione;
      table.style.tableLayout = "fixed";
      const newTableWidth = `${Math.ceil(Math.max(disponibile, totale))}px`;
      if (table.style.width !== newTableWidth) {
        table.style.width = newTableWidth;
      }
      applicaLarghezzeColonne(ths, larghezze);

      if (conAnimazione && !ridurreAnimazioni) {
        shell.classList.remove("pt-tabella-pre-fade");
        shell.classList.add("pt-tabella-fade-in");
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = setTimeout(() => {
          shell.classList.remove("pt-tabella-fade-in");
        }, 250);
      } else {
        shell.classList.remove("pt-tabella-pre-fade", "pt-tabella-fade-in");
      }
    };

    const applicaRigido = (table: HTMLElement, ths: HTMLElement[], larghezze: number[], totale: number) => {
      table.style.tableLayout = "fixed";
      const newTableWidth = `${Math.round(totale + larghezzaSelezione(table))}px`;
      if (table.style.width !== newTableWidth) {
        table.style.width = newTableWidth;
      }
      applicaLarghezzeColonne(ths, larghezze);
    };

    const salva = (ths: HTMLElement[], larghezze: number[]) => {
      if (!memorizzaLarghezze) return;
      const chiave = chiaveLarghezzeTabella(chiaveBase);
      const precedente = localStorage.getItem(chiave);
      const valore = JSON.stringify(ths.map((th, i) => ({ [th.dataset.accessor!]: `${Math.round(larghezze[i])}px` })));
      localStorage.setItem(chiave, valore);
      window.dispatchEvent(new StorageEvent("storage", {
        key: chiave,
        oldValue: precedente,
        newValue: valore,
        storageArea: localStorage,
      }));
    };

    const applicaSeNecessario = (conAnimazione = false) => {
      const dati = trova();
      if (!dati) return;
      const { table, ths } = dati;

      // Disconnettiamo temporaneamente l'observer durante la scrittura degli stili
      // per evitare feedback loops ricorsivi.
      if (moRef.current) moRef.current.disconnect();

      const chiave = chiaveLarghezzeTabella(chiaveBase);
      const salvateRaw = localStorage.getItem(chiave);
      if (!salvateRaw) {
        // Fotografia naturale iniziale, poi subito adattata allo spazio corrente.
        const definite = new Map(
          (props.columns ?? []).map((col: any) => [String(col.accessor), typeof col.width === "number" ? col.width : undefined])
        );
        const naturali = ths.map((th) => {
          const definita = definite.get(th.dataset.accessor || "");
          return Math.max(minimo(th), definita ?? (th.getBoundingClientRect().width || 100));
        });
        applicaFluido(table, ths, naturali, conAnimazione);
        if (moRef.current) moRef.current.observe(shell, { childList: true, subtree: true });
        return;
      }

      try {
        const parsed = JSON.parse(salvateRaw);
        if (Array.isArray(parsed)) {
          const map = new Map<string, number>();
          for (const item of parsed) {
            if (item && typeof item === "object") {
              const keys = Object.keys(item);
              if (keys.length > 0) {
                map.set(keys[0], parseFloat(item[keys[0]]) || 0);
              }
            }
          }
          const larghezze = ths.map((th) => {
            const accessor = th.dataset.accessor;
            const salvata = accessor ? map.get(accessor) : undefined;
            return salvata !== undefined ? Math.max(minimo(th), salvata) : (th.getBoundingClientRect().width || 100);
          });
          applicaFluido(table, ths, larghezze, conAnimazione);
        }
      } catch (e) {
        console.error("Errore nell'applicazione delle larghezze salvate:", e);
      }

      if (moRef.current) moRef.current.observe(shell, { childList: true, subtree: true });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const handle = (e.target as HTMLElement).closest(".mantine-datatable-header-resizable-handle") as HTMLElement | null;
      const dati = trova();
      if (!handle || !dati || !dati.table.contains(handle)) return;
      const corrente = handle.closest("th[data-accessor]") as HTMLElement | null;
      const indice = corrente ? dati.ths.indexOf(corrente) : -1;
      if (indice < 0 || indice >= dati.ths.length - 1) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      resizeManualeRef.current = true;
      shell.setPointerCapture(e.pointerId);
      const { table, ths } = dati;
      let larghezze = ths.map((th) => th.getBoundingClientRect().width);
      const minimi = ths.map(minimo);
      const fisse = ths.map(fissa);
      const totale = larghezze.reduce((a, b) => a + b, 0);

      // Durante il drag congeliamo la tabella su dimensioni rigide per massima precisione
      applicaRigido(table, ths, larghezze, totale);

      const startX = e.clientX;
      const iniziali = [...larghezze];
      const inizialeA = iniziali[indice];

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== e.pointerId) return;
        const delta = move.clientX - startX;
        larghezze = [...iniziali];
        if (delta >= 0) {
          // Per allargare una colonna raccogliamo spazio da TUTTE quelle successive,
          // non soltanto dalla vicina. Una colonna già al minimo non blocca più il gesto.
          const margini = iniziali.map((v, i) =>
            i > indice && !fisse[i] ? Math.max(0, v - minimi[i]) : 0
          );
          const disponibile = margini.reduce((a, b) => a + b, 0);
          const preso = Math.min(delta, disponibile);
          larghezze[indice] = inizialeA + preso;
          if (disponibile > 0) {
            for (let i = indice + 1; i < larghezze.length; i++) {
              larghezze[i] = iniziali[i] - preso * (margini[i] / disponibile);
            }
          }
        } else {
          // Lo spazio liberato viene ripartito in avanti, evitando un nuovo accumulo
          // sproporzionato nella sola colonna adiacente.
          const destinatarie = larghezze
            .map((_, i) => i)
            .filter((i) => i > indice && !fisse[i]);
          const ceduto = destinatarie.length > 0
            ? Math.min(-delta, Math.max(0, inizialeA - minimi[indice]))
            : 0;
          larghezze[indice] = inizialeA - ceduto;
          for (const i of destinatarie) {
            larghezze[i] = iniziali[i] + ceduto / destinatarie.length;
          }
        }
        applicaRigido(table, ths, larghezze, totale);
      };

      const onUp = (up: PointerEvent) => {
        if (up.pointerId !== e.pointerId) return;
        resizeManualeRef.current = false;
        salva(ths, larghezze);

        applicaFluido(table, ths, larghezze);

        if (shell.hasPointerCapture(e.pointerId)) shell.releasePointerCapture(e.pointerId);
        shell.removeEventListener("pointermove", onMove, true);
        shell.removeEventListener("pointerup", onUp, true);
        shell.removeEventListener("pointercancel", onUp, true);
      };

      shell.addEventListener("pointermove", onMove, true);
      shell.addEventListener("pointerup", onUp, true);
      shell.addEventListener("pointercancel", onUp, true);
    };

    const onReset = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== chiaveBase) return;
      requestAnimationFrame(() => applicaSeNecessario(true));
    };

    const schedulaApplica = (anim = false) => {
      const animaDavvero = anim && !sopprimiSfumaturaRef.current;
      if (animaDavvero) {
        if (!deveAnimareRef.current && !ridurreAnimazioni) {
          // All'inizio dell'azione (es. trascinamento finestra o clic sidebar),
          // sfumiamo subito la tabella per nascondere i frame di adattamento.
          shell.classList.remove("pt-tabella-fade-in");
          shell.classList.add("pt-tabella-pre-fade");
        }
        deveAnimareRef.current = true;
      }
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(() => {
        const runAnim = deveAnimareRef.current && !sopprimiSfumaturaRef.current;
        deveAnimareRef.current = false; // Reset accumulatore
        applicaSeNecessario(runAnim);
      }, 200);
    };

    // Osserva soltanto cambi STRUTTURALI della DataTable (mount/sostituzione della tabella
    // o dell'header). Osservare ogni childList interno faceva ripartire il calcolo anche al
    // semplice hover: tooltip e contenuti interattivi delle celle montano/smontano nodi,
    // causando una sequenza visibile di riassestamenti prima della stabilizzazione.
    const contieneHeaderMaster = (node: Node) => {
      if (!(node instanceof HTMLElement)) return false;
      // I chunk follower non hanno thead: il loro mount virtualizzato non deve ricalcolare
      // il master, perché possiedono già la sincronizzazione colonne dedicata più sotto.
      return node.matches("thead, th[data-accessor]")
        || !!node.querySelector("thead, th[data-accessor]");
    };
    const mo = new MutationObserver((mutations) => {
      const strutturale = mutations.some((mutation) =>
        [...mutation.addedNodes, ...mutation.removedNodes].some(contieneHeaderMaster)
      );
      if (strutturale) schedulaApplica(false);
    });
    moRef.current = mo;
    mo.observe(shell, { childList: true, subtree: true });
    const ro = new ResizeObserver((entries) => {
      if (resizeManualeRef.current) return;
      for (const entry of entries) {
        const w = entry.contentRect.width;
        // Soglia di 1px: ignora le micro-variazioni e gli errori di arrotondamento decimali
        // (sub-pixel routing) che causavano cicli continui di aggiustamento anche a riposo.
        if (Math.abs(w - lastWidthRef.current) >= 1) {
          const isFirstMeasure = lastWidthRef.current === 0;
          lastWidthRef.current = w;
          // Il layout effect ha già applicato la misura iniziale: non accodiamo un secondo
          // assestamento a 200 ms. I passaggi successivi restano riservati a veri cambi di view.
          if (!isFirstMeasure) schedulaApplica(true);
        }
      }
    });
    ro.observe(shell);

    shell.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener(eventoResetLarghezze, onReset);
    applicaSeNecessario(false);
    applicaSeNecessarioRef.current = applicaSeNecessario;

    return () => {
      window.clearTimeout(debounceTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      mo.disconnect();
      ro.disconnect();
      shell.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener(eventoResetLarghezze, onReset);
      applicaSeNecessarioRef.current = null;
    };
  }, [chunks.length, props.columns, props.storeColumnsKey, memorizzaLarghezze, minColumnWidths, fixedColumnWidths, ridurreAnimazioni]);

  useEffect(() => () => window.clearTimeout(soppressioneTimerRef.current), []);

  // Avvia lo sbiadimento istantaneo quando cambia la sidebar (prima che parta la transizione del layout),
  // così la tabella è già sfumata e non mostra scatti intermedi durante l'animazione fisica della barra.
  useLayoutEffect(() => {
    if (lastWidthRef.current === 0) return;
    if (ridurreAnimazioni) return;

    const shell = shellRef.current;
    if (!shell) return;

    // Controlliamo se la tabella è attualmente visibile nello schermo
    const rect = shell.getBoundingClientRect();
    const visibile = rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
    if (!visibile) return;

    shell.classList.remove("pt-tabella-fade-in");
    shell.classList.add("pt-tabella-pre-fade");

    deveAnimareRef.current = true;
    window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      deveAnimareRef.current = false;
      applicaSeNecessarioRef.current?.(true);
    }, 200);

    return () => {
      window.clearTimeout(debounceTimerRef.current);
    };
  }, [sidebar, ridurreAnimazioni]);

  // Caso Cluster Virtualization: più blocchi fusi insieme
  const idAccessor = props.idAccessor || "id";

  // Effetto che sincronizza a ~30fps le larghezze delle colonne dal PRIMO blocco (il master,
  // l'unico con l'header) verso tutti i blocchi successivi, tramite CSS (evita inline style
  // thrashing).
  useLayoutEffect(() => {
    if (chunks.length <= 1) return;

    let styleEl = document.getElementById(styleId) as HTMLStyleElement;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    const container = document.getElementById(containerId);
    if (!container) return;

    const masterTable = container.querySelector(".mantine-datatable-table");
    if (!masterTable) return;

    let frame = 0;

    const syncColonne = () => {
      if (globalIsResizing) return;

      const tables = container.querySelectorAll(".mantine-datatable-table");
      if (tables.length < 2) return;

      const currentMaster = Array.from(tables).find(t => t.querySelector("thead"));
      if (!currentMaster) return;

      const masterCells = currentMaster.querySelectorAll("thead tr:last-child th");
      if (!masterCells.length) return;

      const totale = (currentMaster as HTMLElement).getBoundingClientRect().width;
      const widths = Array.from(masterCells).map((cell) => (cell as HTMLElement).getBoundingClientRect().width);

      let css = `${sel} { width: ${totale}px !important; min-width: ${totale}px !important; table-layout: fixed !important; }\n`;
      widths.forEach((w, i) => {
        if (!w) return;
        css += `${sel} tbody tr > td:nth-child(${i + 1}):not([colspan]) { width: ${w}px !important; min-width: ${w}px !important; max-width: ${w}px !important; box-sizing: border-box; }\n`;
      });

      if (styleEl.textContent !== css) {
        styleEl.textContent = css;
      }
    };

    const scheduleSyncColonne = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncColonne);
    };

    // Esegui una sincronizzazione immediata al mount/aggiornamento
    scheduleSyncColonne();

    // Osserva il master e anche i mount/smount dei chunk follower: se un follower entra
    // dopo la prima misura, deve ricevere subito lo stesso schema colonne.
    const ro = new ResizeObserver(scheduleSyncColonne);
    ro.observe(masterTable);
    const mo = new MutationObserver(scheduleSyncColonne);
    mo.observe(container, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    };
  }, [chunks.length, containerId, styleId, sel]);

  // Sincronizzazione fluida dello SCROLL ORIZZONTALE tra tutti i chunk
  useLayoutEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target === globalScrollRef.current) {
        scrollLeftRef.current = target.scrollLeft;
        const wrappers = container.querySelectorAll(".mantine-ScrollArea-viewport");
        wrappers.forEach(w => {
          if ((w as HTMLElement).scrollLeft !== target.scrollLeft) {
            (w as HTMLElement).scrollLeft = target.scrollLeft;
          }
        });
        return;
      }
      // Controlla se a scrollare è il wrapper di una datatable (usando closest)
      const wrapper = target.closest(".mantine-ScrollArea-viewport") as HTMLElement | null;
      if (wrapper) {
        scrollLeftRef.current = wrapper.scrollLeft;
        if (globalScrollRef.current && globalScrollRef.current.scrollLeft !== wrapper.scrollLeft) {
          globalScrollRef.current.scrollLeft = wrapper.scrollLeft;
        }
        const wrappers = container.querySelectorAll(".mantine-ScrollArea-viewport");
        wrappers.forEach(w => {
          if (w !== wrapper && (w as HTMLElement).scrollLeft !== wrapper.scrollLeft) {
            (w as HTMLElement).scrollLeft = wrapper.scrollLeft;
          }
        });
      }
    };

    // Usa capture phase per prendere lo scroll (non fa bubbling)
    container.addEventListener("scroll", handleScroll, true);
    const globalScroll = globalScrollRef.current;
    globalScroll?.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll, true);
      globalScroll?.removeEventListener("scroll", handleScroll);
    };
  }, [chunks.length, containerId]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    let frame = 0;
    const misura = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const wrapper = shell.querySelector(".mantine-ScrollArea-viewport") as HTMLElement | null;
        if (!wrapper) {
          setScrollWidth(0);
          setClientWidth(0);
          return;
        }
        setScrollWidth(wrapper.scrollWidth);
        setClientWidth(wrapper.clientWidth);
        if (globalScrollRef.current && globalScrollRef.current.scrollLeft !== scrollLeftRef.current) {
          globalScrollRef.current.scrollLeft = scrollLeftRef.current;
        }
      });
    };

    misura();
    const ro = new ResizeObserver(misura);
    ro.observe(shell);
    const wrappers = shell.querySelectorAll(".mantine-ScrollArea-viewport");
    wrappers.forEach((w) => ro.observe(w));
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [chunks.length, props.columns]);

  const overflowX = scrollWidth > clientWidth + 2;
  const scrollbar = (
    <div
      ref={globalScrollRef}
      className="pt-tabella-scrollbar"
      style={{ display: overflowX ? "block" : "none" }}
      aria-hidden
    >
      <div style={{ width: scrollWidth, height: 1 }} />
    </div>
  );



  return (
    <Box
      ref={shellRef}
      id={containerId}
      className={`pt-tabella-shell ${props.height ? "pt-tabella-altezza-fissa" : ""} ${animaRighe ? "pt-tabella-animating" : ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        height: props.height ? "100%" : undefined,
        minHeight: 0,
        minWidth: 0, // Consente il restringimento del flex item
        position: "relative",
      }}
    >
      <Box
        style={{
          display: "flex",
          flexDirection: "column",
          flex: props.height ? 1 : undefined,
          minHeight: 0,
          minWidth: 0, // Consente il restringimento del flex item
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: "var(--mantine-radius-md)",
          overflow: "hidden", // Arrotonda gli spigoli esterni
        }}
      >
        <style>{`
          /* Il MASTER usa il layout auto (styles.css) così rispetta i minimi-contenuto delle
             colonne. I FOLLOWER invece vanno a layout fisso: non hanno header e devono solo
             COPIARE le larghezze del master (le pinna il sync, useLayoutEffect sopra) — altrimenti
             ogni chunk si dimensionerebbe sul proprio contenuto e le colonne non sarebbero allineate. */
          #${containerId} .pt-chunk-follower .mantine-datatable-table {
            table-layout: fixed !important;
          }
          /* Nascondi le scrollbar dei chunk successivi al primo per pulizia visiva */
          #${containerId} .pt-chunk-follower .mantine-ScrollArea-viewport::-webkit-scrollbar {
            display: none;
          }
          #${containerId} .pt-chunk-follower .mantine-ScrollArea-viewport {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
          /* Sfuma preventivamente all'inizio dell'adattamento (finestra/sidebar) */
          #${containerId}.pt-tabella-pre-fade .mantine-datatable-table {
            opacity: 0.45;
            transition: opacity 0.15s ease-out;
          }
          /* Dissolvenza in entrata a riadattamento completato */
          #${containerId}.pt-tabella-fade-in .mantine-datatable-table {
            animation: ptTabellaFadeIn 0.25s ease-out forwards;
          }
          @keyframes ptTabellaFadeIn {
            0% { opacity: 0.45; }
            100% { opacity: 1; }
          }
        `}</style>
        {chunks.map((chunk, index) => (
          <TabellaChunk
            key={index}
            index={index}
            totalRecords={totalRecords}
            globalSelectedRecords={props.selectedRecords}
            onGlobalSelectedRecordsChange={props.onSelectedRecordsChange}
            idAccessor={idAccessor}
            scrollLeftRef={scrollLeftRef}
            estimatedHeight={Math.max(1, chunk.length) * estimatedRowHeight}
            chunkProps={{
              ...baseProps,
              // Solo il primo blocco (righe già a schermo) entra a cascata: gli altri si
              // montano scrollando e ri-animarli sarebbe sbagliato.
              ...(index === 0 ? (animRowProps as object) : {}),
              records: chunk,
              minHeight: vuota && index === 0 ? 240 : undefined,
              // Rimuoviamo i bordi per fondere i blocchi senza creare righe spesse
              withTableBorder: false,
              borderRadius: 0,
            }}
          />
        ))}
      </Box>
      {scrollbar}
    </Box>
  );
}
