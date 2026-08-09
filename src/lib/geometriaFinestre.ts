// Memoria di posizione + dimensione delle finestre secondarie (Tauri).
//
// Ogni "tipo" di finestra (ordine, promemoria, riepilogo, pagamento, notifiche,
// cestino, info…) ricorda l'ultima geometria scelta dall'utente: alla riapertura
// la finestra torna dov'era e della misura che aveva. La granularità è per TIPO,
// non per singola istanza (l'ultima finestra di quel tipo detta la geometria per
// le successive) — coerente col comportamento storico delle finestre Ordine.
//
// Persistenza: localStorage `pt.geom.<chiave>` (condiviso fra tutte le webview,
// stessa origin). Sta "tra le preferenze" come le altre impostazioni UI.
import { useEffect, useRef } from "react";
import { inTauri } from "./tauri";

const PREFISSO = "pt.geom.";

export interface GeometriaFinestra {
  width: number;
  height: number;
  /** Posizione logica (può mancare: prima apertura → centratura). */
  x?: number;
  y?: number;
  /** L'utente l'aveva lasciata massimizzata. width/height/x/y restano i valori
   *  "fluttuanti" (pre-massimizzazione): de-massimizzando si torna a quelli. */
  maximized?: boolean;
}

export interface DefaultGeometria {
  /** Misura di partenza se non c'è nulla di salvato. */
  width: number;
  height: number;
  /** Misure minime accettate: scartano valori salvati corrotti/assurdi. */
  minWidth?: number;
  minHeight?: number;
  /** Non ricordare la posizione, solo la dimensione (la finestra resta centrata). */
  soloDimensione?: boolean;
  /** Vecchia chiave localStorage da migrare una volta (es. `pt.ordineWin`). */
  legacyKey?: string;
  /** Dimensioni che in passato erano il default: vengono portate al nuovo
   * default compatto senza modificare misure realmente personalizzate. */
  precedentiDefault?: ReadonlyArray<{ width: number; height: number }>;
}

/** Legge la geometria salvata per `chiave`, con fallback ai default. */
export function leggiGeometria(chiave: string, def: DefaultGeometria): GeometriaFinestra {
  const minW = def.minWidth ?? 200;
  const minH = def.minHeight ?? 200;
  let grezzo = leggiGrezzo(chiave) ?? migraLegacy(chiave, def.legacyKey);
  if (
    grezzo &&
    def.precedentiDefault?.some(
      (precedente) =>
        grezzo?.width === precedente.width &&
        grezzo?.height === precedente.height,
    )
  ) {
    grezzo = { ...grezzo, width: def.width, height: def.height };
    aggiorna(chiave, grezzo);
  }
  if (
    grezzo &&
    typeof grezzo.width === "number" &&
    typeof grezzo.height === "number" &&
    grezzo.width >= minW &&
    grezzo.height >= minH
  ) {
    const pos =
      !def.soloDimensione && typeof grezzo.x === "number" && typeof grezzo.y === "number"
        ? { x: grezzo.x, y: grezzo.y }
        : {};
    const max = grezzo.maximized === true ? { maximized: true as const } : {};
    return { width: grezzo.width, height: grezzo.height, ...pos, ...max };
  }
  return { width: def.width, height: def.height };
}

/**
 * Opzioni di geometria da passare a `new WebviewWindow(...)`: `width`/`height`
 * ricordati e, se nota, la `x`/`y` dell'ultima volta; altrimenti `center: true`.
 * Se la posizione salvata cadrebbe FUORI da ogni monitor collegato (es. il monitor
 * dov'era stata lasciata non c'è più), si ricade sulla centratura invece di aprire
 * la finestra fuori schermo. Se era massimizzata aggiunge `maximized: true` (Tauri
 * apre alle width/height "fluttuanti" e poi massimizza). Async perché interroga i
 * monitor (`availableMonitors`).
 */
export async function opzioniGeometria(
  chiave: string,
  def: DefaultGeometria
): Promise<
  { width: number; height: number; maximized?: boolean } & ({ x: number; y: number } | { center: true })
> {
  const g = leggiGeometria(chiave, def);
  const haPos = g.x != null && g.y != null;
  const pos = haPos && (await posizioneVisibile(g)) ? { x: g.x!, y: g.y! } : { center: true as const };
  const max = g.maximized ? { maximized: true as const } : {};
  return { width: g.width, height: g.height, ...max, ...pos };
}

/**
 * La finestra, posizionata in `g`, avrebbe una porzione utile della barra del
 * titolo su almeno un monitor collegato? (così l'utente può comunque spostarla).
 * In assenza di info sui monitor / errori non penalizza (ritorna true).
 */
async function posizioneVisibile(g: GeometriaFinestra): Promise<boolean> {
  if (!inTauri || g.x == null || g.y == null) return true;
  try {
    const { availableMonitors } = await import("@tauri-apps/api/window");
    const monitors = await availableMonitors();
    if (!monitors.length) return true;
    const stripH = Math.min(g.height, 32); // la barra del titolo, in alto
    const MIN_VIS_W = 80; // quanto della barra dev'essere afferrabile
    for (const m of monitors) {
      // I monitor riportano coordinate FISICHE: le riportiamo a logiche (come la
      // geometria salvata) col loro fattore di scala.
      const f = m.scaleFactor || 1;
      const mx = m.position.x / f;
      const my = m.position.y / f;
      const mw = m.size.width / f;
      const mh = m.size.height / f;
      const ovX = Math.min(g.x + g.width, mx + mw) - Math.max(g.x, mx);
      const ovY = Math.min(g.y + stripH, my + mh) - Math.max(g.y, my);
      if (ovX >= MIN_VIS_W && ovY >= 4) return true;
    }
    return false;
  } catch {
    return true; // best-effort: in caso di problemi non bloccare la posizione
  }
}

/**
 * Applica alla finestra CORRENTE la geometria salvata per `chiave` (misura +,
 * se valida e visibile su un monitor, posizione; altrimenti centra). Usata per la
 * finestra principale, creata da `tauri.conf.json`: la richiamiamo mentre è ancora
 * nascosta, prima di mostrarla, così non c'è salto/flash. Se era massimizzata,
 * imposta prima la misura "fluttuante" e poi massimizza (de-massimizzando si torna a
 * quella). No-op fuori da Tauri.
 */
export async function applicaGeometria(chiave: string, def: DefaultGeometria): Promise<void> {
  if (!inTauri) return;
  const g = leggiGeometria(chiave, def);
  try {
    const [{ getCurrentWindow }, { LogicalSize, LogicalPosition }] = await Promise.all([
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/dpi"),
    ]);
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(g.width, g.height));
    if (g.x != null && g.y != null && (await posizioneVisibile(g))) {
      await win.setPosition(new LogicalPosition(g.x, g.y));
    } else {
      await win.center();
    }
    if (g.maximized) await win.maximize();
  } catch {
    /* best-effort: in caso di errore la finestra resta alla geometria di config */
  }
}

/**
 * Hook da montare nel componente della finestra: registra (con debounce) la
 * dimensione e la posizione mentre l'utente ridimensiona/sposta la finestra, così
 * la prossima apertura le riusa. Ricorda anche se è MASSIMIZZATA (senza sovrascrivere
 * la misura "fluttuante", che resta per il de-massimizza). Ignora lo stato minimizzato
 * (misure/coordinate spurie). No-op fuori da Tauri.
 */
export function useRicordaGeometria(
  chiave: string,
  opts?: { soloDimensione?: boolean }
) {
  const soloDimensione = opts?.soloDimensione ?? false;
  const soloDimensioneRef = useRef(soloDimensione);
  soloDimensioneRef.current = soloDimensione;

  useEffect(() => {
    if (!inTauri) return;
    let offResize: (() => void) | undefined;
    let tR: ReturnType<typeof setTimeout> | undefined;
    let intervallo: ReturnType<typeof setInterval> | undefined;
    let annullato = false;

    async function salvaCorrente() {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        if (await win.isMinimized().catch(() => false)) return;

        if (await win.isMaximized().catch(() => false)) {
          aggiorna(chiave, { maximized: true });
          return;
        }

        const factor = await win.scaleFactor();
        const sz = await win.innerSize();
        const patch: Partial<GeometriaFinestra> = {
          width: Math.round(sz.width / factor),
          height: Math.round(sz.height / factor),
          maximized: false,
        };

        if (!soloDimensioneRef.current) {
          const pos = await win.outerPosition();
          patch.x = Math.round(pos.x / factor);
          patch.y = Math.round(pos.y / factor);
        }

        aggiornaSeCambiata(chiave, patch);
      } catch {
        /* best-effort */
      }
    }

    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      if (annullato) return;
      const win = getCurrentWindow();
      offResize = await win.onResized(() => {
        if (tR) clearTimeout(tR);
        tR = setTimeout(() => void salvaCorrente(), 300);
      });

      // Non ascoltiamo `onMoved`: su Windows può arrivare a raffica durante il drag e
      // saturare il renderer. Un campionamento lento conserva la geometria senza scatti.
      intervallo = setInterval(() => void salvaCorrente(), 2000);
    })();

    window.addEventListener("beforeunload", salvaCorrente);

    return () => {
      annullato = true;
      offResize?.();
      if (tR) clearTimeout(tR);
      if (intervallo) clearInterval(intervallo);
      window.removeEventListener("beforeunload", salvaCorrente);
      void salvaCorrente();
    };
  }, [chiave]);
}

// --- interni ---------------------------------------------------------------

function leggiGrezzo(chiave: string): Partial<GeometriaFinestra> | null {
  try {
    const raw = localStorage.getItem(PREFISSO + chiave);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && typeof d.width === "number" && typeof d.height === "number") return d;
  } catch {
    /* corrotto → ignora */
  }
  return null;
}

/** Una volta sola: copia la vecchia chiave (formato compatibile) nella nuova. */
function migraLegacy(chiave: string, legacyKey?: string): Partial<GeometriaFinestra> | null {
  if (!legacyKey) return null;
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && typeof d.width === "number" && typeof d.height === "number") {
      localStorage.setItem(PREFISSO + chiave, raw);
      localStorage.removeItem(legacyKey);
      return d;
    }
  } catch {
    /* ignora */
  }
  return null;
}

function aggiorna(chiave: string, patch: Partial<GeometriaFinestra>) {
  try {
    const attuale = leggiGrezzo(chiave) ?? {};
    localStorage.setItem(PREFISSO + chiave, JSON.stringify({ ...attuale, ...patch }));
  } catch {
    /* best-effort */
  }
}

function aggiornaSeCambiata(chiave: string, patch: Partial<GeometriaFinestra>) {
  const attuale = leggiGrezzo(chiave) ?? {};
  for (const [k, v] of Object.entries(patch)) {
    if ((attuale as Record<string, unknown>)[k] !== v) {
      aggiorna(chiave, patch);
      return;
    }
  }
}
