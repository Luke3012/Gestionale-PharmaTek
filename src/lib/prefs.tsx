// Preferenze UI persistite (stato sidebar, riduci animazioni, densità).
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { inTauri } from "./tauri";
import {
  normalizzaPreferenzeSuggerimenti,
  PREFERENZE_SUGGERIMENTI_DEFAULT,
  type PreferenzeSuggerimenti,
} from "../features/suggerimenti/preferenze";

export type StatoSidebar = "esteso" | "icone" | "nascosto";
/** Quando aprire l'ordine in finestra separata invece che in modale. */
export type OrdineFinestra = "mai" | "modifica" | "sempre";
/** Finestra temporale dei widget della dashboard con mini-filtro (FASE 6B). */
export type PeriodoDash = "giorno" | "settimana" | "mese" | "anno" | "tutto";
/** Come disporre i filtri di una lista: tutti nel menu «Filtri» (compatti), in linea quando
 *  c'è spazio col resto in «Altri filtri» (auto), oppure tutti in linea (espansi). */
export type FiltriModo = "compatti" | "auto" | "espansi";
/** Densità delle tabelle globali. */
export type DensitaTabelle = "compatta" | "standard";

export const ZOOM_UI_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
export const ZOOM_UI_OPTIONS = ZOOM_UI_STEPS.map((value) => ({
  value: String(value),
  label: value === 1 ? "100% (predefinito)" : `${Math.round(value * 100)}%`,
}));

export function prossimoZoomUI(attuale: number, direzione: 1 | -1): number {
  const corrente = Number.isFinite(attuale) && attuale > 0 ? attuale : 1;
  if (direzione > 0) {
    return ZOOM_UI_STEPS.find((step) => step > corrente + 0.001) ?? ZOOM_UI_STEPS[ZOOM_UI_STEPS.length - 1];
  }
  return [...ZOOM_UI_STEPS].reverse().find((step) => step < corrente - 0.001) ?? ZOOM_UI_STEPS[0];
}

interface Prefs {
  sidebar: StatoSidebar;
  setSidebar: (s: StatoSidebar) => void;
  ridurreAnimazioni: boolean;
  setRidurreAnimazioni: (v: boolean) => void;
  /** Zoom dell'interfaccia (1 = 100%). */
  zoomUI: number;
  setZoomUI: (v: number) => void;
  ordineFinestra: OrdineFinestra;
  setOrdineFinestra: (v: OrdineFinestra) => void;
  /** Anno di lavoro: 0 = tutti gli anni, altrimenti l'anno selezionato. */
  anno: number;
  setAnno: (v: number) => void;
  /** Giorni dopo i quali il Cestino si svuota da solo (0 = mai). */
  cestinoGiorni: number;
  setCestinoGiorni: (v: number) => void;
  /** Backup automatico all'avvio se l'ultimo è più vecchio di N giorni (0 = mai). */
  backupAuto: number;
  setBackupAuto: (v: number) => void;
  /** Periodo predefinito dei widget dashboard con mini-filtro (default: anno corrente). */
  dashboardPeriodo: PeriodoDash;
  setDashboardPeriodo: (v: PeriodoDash) => void;
  /** Disposizione dei filtri delle liste (compatti / auto / espansi). Default: auto. */
  filtriModo: FiltriModo;
  setFiltriModo: (v: FiltriModo) => void;
  /** Spaziatura verticale delle tabelle globali. */
  densitaTabelle: DensitaTabelle;
  setDensitaTabelle: (v: DensitaTabelle) => void;
  /** Scorciatoia globale (di sistema) che apre la ricerca PharmaTek. */
  hotkeyGlobale: string;
  setHotkeyGlobale: (v: string) => void;
  /** Se mostrare l'avviso "ridotto nella tray" alla chiusura (una sola volta). */
  avvisoTrayMostrato: boolean;
  setAvvisoTrayMostrato: (v: boolean) => void;
  /** Giorni dopo la scadenza prima di sollecitare un pagamento (0 = dal giorno stesso). */
  sogliaSolleciti: number;
  setSogliaSolleciti: (v: number) => void;
  /** Giorni tra invio preventivo e proposta di sollecito (default 7). */
  giorniSollecitoPreventivi: number;
  setGiorniSollecitoPreventivi: (v: number) => void;
  /** Giorni di avviso anticipato proposti di default per i nuovi promemoria. */
  anticipoPromemoria: number;
  setAnticipoPromemoria: (v: number) => void;
  /** Mostrare l'overlay custom per le notifiche nuove in background. */
  balloonAttivo: boolean;
  setBalloonAttivo: (v: boolean) => void;
  /** Mostrare i pop-up notifiche anche quando l'app è in primo piano (non solo in background). */
  notifichePrimoPiano: boolean;
  setNotifichePrimoPiano: (v: boolean) => void;
  /** Id del suono di notifica (vedi features/notifiche/suoni); "nessuno" = muto. */
  suonoNotifica: string;
  setSuonoNotifica: (v: string) => void;
  /** Suoni del gioco "Flappy Livio" disattivati (FASE 7B). */
  giocoMuto: boolean;
  setGiocoMuto: (v: boolean) => void;
  /** In Spedizioni > Da spedire, mostrare anche gli ordini Diagnostica e Keriba. */
  spedizioniMostraAltre: boolean;
  setSpedizioniMostraAltre: (v: boolean) => void;
  /** Configurazione locale delle azioni suggerite; non entra nel log condiviso. */
  preferenzeSuggerimenti: PreferenzeSuggerimenti;
  setPreferenzeSuggerimenti: (v: PreferenzeSuggerimenti) => void;
}

const PrefsContext = createContext<Prefs | null>(null);

export const EVENTO_PREFERENZE_CAMBIATE = "pt:preferenze-cambiate";

export type ValorePreferenza =
  | string
  | number
  | boolean
  | PreferenzeSuggerimenti;
export type SnapshotPreferenze = Record<string, ValorePreferenza>;

export interface CambioPreferenza {
  source: string;
  key: string;
  value: ValorePreferenza;
}

export const CHIAVI_PREFERENZE = {
  sidebar: "pt.sidebar",
  ridurreAnimazioni: "pt.ridurreAnimazioni",
  zoomUI: "pt.zoomUI",
  ordineFinestra: "pt.ordineFinestra",
  anno: "pt.anno",
  cestinoGiorni: "pt.cestinoGiorni",
  backupAuto: "pt.backupAuto",
  dashboardPeriodo: "pt.dashboardPeriodo",
  filtriModo: "pt.filtriModo",
  densitaTabelle: "pt.densitaTabelle",
  hotkeyGlobale: "pt.hotkeyGlobale",
  avvisoTrayMostrato: "pt.avvisoTrayMostrato",
  sogliaSolleciti: "pt.sogliaSolleciti",
  giorniSollecitoPreventivi: "pt.giorniSollecitoPreventivi",
  anticipoPromemoria: "pt.anticipoPromemoria",
  balloonAttivo: "pt.balloonAttivo",
  notifichePrimoPiano: "pt.notifichePrimoPiano",
  suonoNotifica: "pt.suonoNotifica",
  giocoMuto: "pt.giocoMuto",
  spedizioniMostraAltre: "pt.spedizioniMostraAltre",
  preferenzeSuggerimenti: "pt.preferenzeSuggerimenti",
} as const;

const CHIAVI_PREFERENZE_VALIDE = new Set<string>(Object.values(CHIAVI_PREFERENZE));

export function calcolaCambiPreferenze(
  precedente: SnapshotPreferenze | null,
  corrente: SnapshotPreferenze,
  valoriRemoti: Map<string, string>,
  source: string
): CambioPreferenza[] {
  if (precedente === null) return [];
  const cambi: CambioPreferenza[] = [];
  for (const [key, value] of Object.entries(corrente)) {
    if (Object.is(precedente[key], value)) continue;
    const serializzato = JSON.stringify(value);
    if (precedente[key] !== undefined && JSON.stringify(precedente[key]) === serializzato) continue;
    const remotoAtteso = valoriRemoti.get(key);
    valoriRemoti.delete(key);
    if (remotoAtteso !== serializzato) cambi.push({ source, key, value });
  }
  return cambi;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [sidebar, setSidebar] = useState<StatoSidebar>(() =>
    load("pt.sidebar", "esteso")
  );
  const [ridurreAnimazioni, setRidurreAnimazioni] = useState<boolean>(() =>
    load("pt.ridurreAnimazioni", false)
  );
  const [zoomUI, setZoomUI] = useState<number>(() => load("pt.zoomUI", 1));
  const [ordineFinestra, setOrdineFinestra] = useState<OrdineFinestra>(() =>
    load("pt.ordineFinestra", "mai")
  );
  const [anno, setAnno] = useState<number>(() => load("pt.anno", new Date().getFullYear()));
  const [cestinoGiorni, setCestinoGiorni] = useState<number>(() => load("pt.cestinoGiorni", 90));
  const [backupAuto, setBackupAuto] = useState<number>(() => load("pt.backupAuto", 7));
  const [dashboardPeriodo, setDashboardPeriodo] = useState<PeriodoDash>(() => load("pt.dashboardPeriodo", "anno"));
  const [filtriModo, setFiltriModo] = useState<FiltriModo>(() => load("pt.filtriModo", "auto"));
  const [densitaTabelle, setDensitaTabelle] = useState<DensitaTabelle>(() => load("pt.densitaTabelle", "standard"));
  const [hotkeyGlobale, setHotkeyGlobale] = useState<string>(() => load("pt.hotkeyGlobale", "Alt+P"));
  const [avvisoTrayMostrato, setAvvisoTrayMostrato] = useState<boolean>(() => load("pt.avvisoTrayMostrato", false));
  const [sogliaSolleciti, setSogliaSolleciti] = useState<number>(() => load("pt.sogliaSolleciti", 0));
  const [giorniSollecitoPreventivi, setGiorniSollecitoPreventivi] = useState<number>(() =>
    load("pt.giorniSollecitoPreventivi", 7)
  );
  const [anticipoPromemoria, setAnticipoPromemoria] = useState<number>(() => load("pt.anticipoPromemoria", 0));
  const [balloonAttivo, setBalloonAttivo] = useState<boolean>(() => load("pt.balloonAttivo", true));
  const [notifichePrimoPiano, setNotifichePrimoPiano] = useState<boolean>(() => load("pt.notifichePrimoPiano", true));
  const [suonoNotifica, setSuonoNotifica] = useState<string>(() => {
    const v = load<string>("pt.suonoNotifica", "campanello");
    // Migrazione dai primi id (giro 1) al nuovo catalogo suoni.
    if (v === "ding") return "campanello";
    if (v === "pop") return "bolla";
    return v;
  });
  const [giocoMuto, setGiocoMuto] = useState<boolean>(() => load("pt.giocoMuto", false));
  const [spedizioniMostraAltre, setSpedizioniMostraAltre] = useState<boolean>(() =>
    load("pt.spedizioniMostraAltre", false)
  );
  const [preferenzeSuggerimenti, setPreferenzeSuggerimenti] =
    useState<PreferenzeSuggerimenti>(() =>
      normalizzaPreferenzeSuggerimenti(
        load("pt.preferenzeSuggerimenti", PREFERENZE_SUGGERIMENTI_DEFAULT),
      ),
    );

  const snapshot = useMemo<SnapshotPreferenze>(() => ({
    [CHIAVI_PREFERENZE.sidebar]: sidebar,
    [CHIAVI_PREFERENZE.ridurreAnimazioni]: ridurreAnimazioni,
    [CHIAVI_PREFERENZE.zoomUI]: zoomUI,
    [CHIAVI_PREFERENZE.ordineFinestra]: ordineFinestra,
    [CHIAVI_PREFERENZE.anno]: anno,
    [CHIAVI_PREFERENZE.cestinoGiorni]: cestinoGiorni,
    [CHIAVI_PREFERENZE.backupAuto]: backupAuto,
    [CHIAVI_PREFERENZE.dashboardPeriodo]: dashboardPeriodo,
    [CHIAVI_PREFERENZE.filtriModo]: filtriModo,
    [CHIAVI_PREFERENZE.densitaTabelle]: densitaTabelle,
    [CHIAVI_PREFERENZE.hotkeyGlobale]: hotkeyGlobale,
    [CHIAVI_PREFERENZE.avvisoTrayMostrato]: avvisoTrayMostrato,
    [CHIAVI_PREFERENZE.sogliaSolleciti]: sogliaSolleciti,
    [CHIAVI_PREFERENZE.giorniSollecitoPreventivi]: giorniSollecitoPreventivi,
    [CHIAVI_PREFERENZE.anticipoPromemoria]: anticipoPromemoria,
    [CHIAVI_PREFERENZE.balloonAttivo]: balloonAttivo,
    [CHIAVI_PREFERENZE.notifichePrimoPiano]: notifichePrimoPiano,
    [CHIAVI_PREFERENZE.suonoNotifica]: suonoNotifica,
    [CHIAVI_PREFERENZE.giocoMuto]: giocoMuto,
    [CHIAVI_PREFERENZE.spedizioniMostraAltre]: spedizioniMostraAltre,
    [CHIAVI_PREFERENZE.preferenzeSuggerimenti]: preferenzeSuggerimenti,
  }), [
    sidebar,
    ridurreAnimazioni,
    zoomUI,
    ordineFinestra,
    anno,
    cestinoGiorni,
    backupAuto,
    dashboardPeriodo,
    filtriModo,
    densitaTabelle,
    hotkeyGlobale,
    avvisoTrayMostrato,
    sogliaSolleciti,
    giorniSollecitoPreventivi,
    anticipoPromemoria,
    balloonAttivo,
    notifichePrimoPiano,
    suonoNotifica,
    giocoMuto,
    spedizioniMostraAltre,
    preferenzeSuggerimenti,
  ]);

  const sourceRef = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `prefs-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const precedenteRef = useRef<SnapshotPreferenze | null>(null);
  const valoriRemotiRef = useRef(new Map<string, string>());

  const applicaPreferenza = useCallback((key: string, value: unknown) => {
    switch (key) {
      case CHIAVI_PREFERENZE.sidebar:
        if (value === "esteso" || value === "icone" || value === "nascosto") setSidebar(value);
        break;
      case CHIAVI_PREFERENZE.ridurreAnimazioni:
        if (typeof value === "boolean") setRidurreAnimazioni(value);
        break;
      case CHIAVI_PREFERENZE.zoomUI:
        if (typeof value === "number" && Number.isFinite(value) && value > 0) setZoomUI(value);
        break;
      case CHIAVI_PREFERENZE.ordineFinestra:
        if (value === "mai" || value === "modifica" || value === "sempre") setOrdineFinestra(value);
        break;
      case CHIAVI_PREFERENZE.anno:
        if (typeof value === "number" && Number.isFinite(value)) setAnno(value);
        break;
      case CHIAVI_PREFERENZE.cestinoGiorni:
        if (typeof value === "number" && Number.isFinite(value)) setCestinoGiorni(value);
        break;
      case CHIAVI_PREFERENZE.backupAuto:
        if (typeof value === "number" && Number.isFinite(value)) setBackupAuto(value);
        break;
      case CHIAVI_PREFERENZE.dashboardPeriodo:
        if (["giorno", "settimana", "mese", "anno", "tutto"].includes(String(value))) {
          setDashboardPeriodo(value as PeriodoDash);
        }
        break;
      case CHIAVI_PREFERENZE.filtriModo:
        if (value === "compatti" || value === "auto" || value === "espansi") setFiltriModo(value);
        break;
      case CHIAVI_PREFERENZE.densitaTabelle:
        if (value === "compatta" || value === "standard") setDensitaTabelle(value);
        break;
      case CHIAVI_PREFERENZE.hotkeyGlobale:
        if (typeof value === "string") setHotkeyGlobale(value);
        break;
      case CHIAVI_PREFERENZE.avvisoTrayMostrato:
        if (typeof value === "boolean") setAvvisoTrayMostrato(value);
        break;
      case CHIAVI_PREFERENZE.sogliaSolleciti:
        if (typeof value === "number" && Number.isFinite(value)) setSogliaSolleciti(value);
        break;
      case CHIAVI_PREFERENZE.giorniSollecitoPreventivi:
        if (typeof value === "number" && Number.isFinite(value)) {
          setGiorniSollecitoPreventivi(Math.max(1, Math.min(90, Math.round(value))));
        }
        break;
      case CHIAVI_PREFERENZE.anticipoPromemoria:
        if (typeof value === "number" && Number.isFinite(value)) setAnticipoPromemoria(value);
        break;
      case CHIAVI_PREFERENZE.balloonAttivo:
        if (typeof value === "boolean") setBalloonAttivo(value);
        break;
      case CHIAVI_PREFERENZE.notifichePrimoPiano:
        if (typeof value === "boolean") setNotifichePrimoPiano(value);
        break;
      case CHIAVI_PREFERENZE.suonoNotifica:
        if (typeof value === "string") setSuonoNotifica(value);
        break;
      case CHIAVI_PREFERENZE.giocoMuto:
        if (typeof value === "boolean") setGiocoMuto(value);
        break;
      case CHIAVI_PREFERENZE.spedizioniMostraAltre:
        if (typeof value === "boolean") setSpedizioniMostraAltre(value);
        break;
      case CHIAVI_PREFERENZE.preferenzeSuggerimenti:
        setPreferenzeSuggerimenti((prev) => {
          const next = normalizzaPreferenzeSuggerimenti(value);
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
        break;
    }
  }, []);

  useEffect(() => {
    const precedente = precedenteRef.current;
    for (const [key, value] of Object.entries(snapshot)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
    const cambi = calcolaCambiPreferenze(
      precedente,
      snapshot,
      valoriRemotiRef.current,
      sourceRef.current
    );
    precedenteRef.current = snapshot;
    if (!inTauri || cambi.length === 0) return;
    void import("@tauri-apps/api/event")
      .then(({ emit }) => Promise.all(cambi.map((cambio) => emit(EVENTO_PREFERENZE_CAMBIATE, cambio))))
      .catch(() => {});
  }, [snapshot]);

  useEffect(() => {
    const handleZoomShortcut = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const direzione =
        e.key === "+" || e.key === "=" || e.key === "Add"
          ? 1
          : e.key === "-" || e.key === "_" || e.key === "Subtract"
            ? -1
            : 0;
      if (direzione === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setZoomUI((attuale) => prossimoZoomUI(attuale, direzione));
    };
    window.addEventListener("keydown", handleZoomShortcut, true);
    return () => window.removeEventListener("keydown", handleZoomShortcut, true);
  }, []);

  useEffect(() => {
    const ricevi = (key: string, value: unknown) => {
      if (!CHIAVI_PREFERENZE_VALIDE.has(key)) return;
      valoriRemotiRef.current.set(key, JSON.stringify(value));
      applicaPreferenza(key, value);
    };
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.newValue === null) return;
      try {
        ricevi(e.key, JSON.parse(e.newValue));
      } catch {}
    };
    window.addEventListener("storage", handleStorage);

    let off: (() => void) | undefined;
    if (inTauri) {
      void import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen<CambioPreferenza>(EVENTO_PREFERENZE_CAMBIATE, ({ payload }) => {
            if (!payload || payload.source === sourceRef.current) return;
            ricevi(payload.key, payload.value);
          })
        )
        .then((unlisten) => { off = unlisten; })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener("storage", handleStorage);
      off?.();
    };
  }, [applicaPreferenza]);

  const value = useMemo(
    () => ({
      sidebar,
      setSidebar,
      ridurreAnimazioni,
      setRidurreAnimazioni,
      zoomUI,
      setZoomUI,
      ordineFinestra,
      setOrdineFinestra,
      anno,
      setAnno,
      cestinoGiorni,
      setCestinoGiorni,
      backupAuto,
      setBackupAuto,
      dashboardPeriodo,
      setDashboardPeriodo,
      filtriModo,
      setFiltriModo,
      densitaTabelle,
      setDensitaTabelle,
      hotkeyGlobale,
      setHotkeyGlobale,
      avvisoTrayMostrato,
      setAvvisoTrayMostrato,
      sogliaSolleciti,
      setSogliaSolleciti,
      giorniSollecitoPreventivi,
      setGiorniSollecitoPreventivi,
      anticipoPromemoria,
      setAnticipoPromemoria,
      balloonAttivo,
      setBalloonAttivo,
      notifichePrimoPiano,
      setNotifichePrimoPiano,
      suonoNotifica,
      setSuonoNotifica,
      giocoMuto,
      setGiocoMuto,
      spedizioniMostraAltre,
      setSpedizioniMostraAltre,
      preferenzeSuggerimenti,
      setPreferenzeSuggerimenti: (value: PreferenzeSuggerimenti) =>
        setPreferenzeSuggerimenti((prev) => {
          const next = normalizzaPreferenzeSuggerimenti(value);
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        }),
    }),
    [sidebar, ridurreAnimazioni, zoomUI, ordineFinestra, anno, cestinoGiorni, backupAuto, dashboardPeriodo, filtriModo, densitaTabelle, hotkeyGlobale, avvisoTrayMostrato, sogliaSolleciti, giorniSollecitoPreventivi, anticipoPromemoria, balloonAttivo, notifichePrimoPiano, suonoNotifica, giocoMuto, spedizioniMostraAltre, preferenzeSuggerimenti]
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs deve stare dentro <PrefsProvider>");
  return ctx;
}
