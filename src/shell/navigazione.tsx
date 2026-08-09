// Navigazione tra finestre (FASE 6A). La barra Spotlight e i Riepiloghi sono
// finestre Tauri separate: per "portare" l'utente in un punto della finestra
// principale comunicano via evento `pt:naviga`, che la Shell ascolta per
// navigare la rotta e applicare un eventuale filtro (deep-link).
import { createContext, useContext } from "react";
import { inTauri } from "../lib/tauri";

/** Destinazione dentro la finestra principale + eventuale stato da applicare. */
export interface DeepLink {
  /** Rotta del MemoryRouter, es. "/giornaliero". */
  path: string;
  /** Prefill della ricerca testuale (Giornaliero, Crediti, Distinte, Spedizioni). */
  cerca?: string;
  /** Tab/registro/vista da aprire (Contabilità: "pagamenti"/"distinte" · Anagrafiche:
   *  entity · Spedizioni: "da_spedire"/"effettuate"). */
  tab?: string;
  /** Record da aprire/evidenziare nella vista di arrivo (Anagrafiche, Spedizioni). */
  apriId?: string;
  /** Filtro periodo (Spedizioni effettuate, Giornaliero, Provvigioni): dal/al YYYY-MM-DD. */
  dal?: string;
  al?: string;
  // --- Filtri di click-through dalla dashboard (FASE 6B) ---
  /** Giornaliero: filtra per stato/i ordine (es. ["Spedito"]). */
  stati?: string[];
  /** Giornaliero + Crediti: solo spediti / solo non spediti. */
  spedito?: "spediti" | "non";
  /** Crediti: tag di stato pagamento (es. ["atteso"] = non saldati). */
  statiPagamento?: string[];
  /** Giornaliero: filtra per regione cliente ("Altre zone" = senza regione). */
  regione?: string;
  /** Giornaliero: filtra per nome agente. */
  agente?: string;
  /** Giornaliero: filtra per segnalazioni operative. */
  marcatori?: string[];
  /** Giornaliero: filtro operativo OR fra segnalazioni e pagamenti critici. */
  critici?: boolean;
  /** Provvigioni: filtra per agente (id). */
  agenteId?: string;
  /** Crediti: filtra per conto previsto. */
  contoId?: string;
  contoNome?: string;
  contoIds?: string[];
  /** Crediti: filtra per uno o più lotti/sessioni di spedizione. */
  spedizioneLotti?: string[];
  agenteIds?: string[];
  medicoIds?: string[];
  linee?: string[];
  corriereNomi?: string[];
  rimborsoStati?: string[];
  rimborsoOrigini?: string[];
  produzioneAcconto?: "incassato" | "atteso";
  mostraAltreSpedizioni?: boolean;
  provvigioniOrdina?: "maturato" | "potenziale" | "nome";
  /** Azione da eseguire all'arrivo (es. aprire una modale di creazione). */
  azione?:
    | "nuovo_rimborso"
    | "nuova_distinta"
    | "importa_giornaliero"
    | "esporta_aruba"
    | "pulizia_dati"
    | "bollettazione_automatica"
    | "ottimizza_database";
}

const EVENTO_NAVIGA = "pt:naviga";
const TIMEOUT_CONSEGNA_NAVIGAZIONE_MS = 2_000;

interface RichiestaNavigazione {
  link: DeepLink;
  ack: string;
}

function richiestaNavigazione(payload: DeepLink | RichiestaNavigazione): RichiestaNavigazione | null {
  if (
    payload &&
    typeof payload === "object" &&
    "link" in payload &&
    "ack" in payload &&
    typeof payload.ack === "string"
  ) {
    return payload as RichiestaNavigazione;
  }
  return null;
}

/** Porta la finestra principale in primo piano e le chiede di navigare al deep-link. */
export async function vaiAllaPrincipale(link: DeepLink): Promise<void> {
  if (!inTauri) return;
  const [{ getAllWindows }, { emitTo, listen }] = await Promise.all([
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/event"),
  ]);
  const main = (await getAllWindows()).find((w) => w.label === "main");
  if (!main) throw new Error("Finestra principale non disponibile.");

  // Prima risvegliamo la main, poi consegniamo il deep-link. L'ack evita che una
  // finestra chiamante si chiuda mentre WebView2 e' ancora sospeso o la Shell non
  // ha ancora registrato il listener.
  await main.show();
  await main.unminimize();
  await main.setFocus();

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ack = `pt:naviga-ack:${id}`;
  let conferma!: () => void;
  const ricevuta = new Promise<void>((resolve) => {
    conferma = resolve;
  });
  const off = await listen(ack, conferma);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await emitTo("main", EVENTO_NAVIGA, { link, ack } satisfies RichiestaNavigazione);
    await Promise.race([
      ricevuta,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("La finestra principale non ha confermato la navigazione.")),
          TIMEOUT_CONSEGNA_NAVIGAZIONE_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    off();
  }
}

/** La finestra principale registra l'ascolto delle richieste di navigazione. */
export async function ascoltaNavigazione(
  cb: (link: DeepLink) => void | boolean
): Promise<() => void> {
  const { emit, listen } = await import("@tauri-apps/api/event");
  return listen<DeepLink | RichiestaNavigazione>(EVENTO_NAVIGA, (e) => {
    const richiesta = richiestaNavigazione(e.payload);
    const gestita = cb(richiesta?.link ?? (e.payload as DeepLink));
    if (richiesta && gestita !== false) void emit(richiesta.ack);
  });
}

// ---- Scorciatoia globale (registrazione idempotente) ----
// La registrazione va serializzata e resa idempotente: in dev React StrictMode
// (ed eventuale HMR) esegue l'effetto due volte e, senza queste cautele, la
// seconda `register` trova la combo già registrata e lancia un falso errore.

let comboRegistrata: string | null = null;
let codaHotkey: Promise<unknown> = Promise.resolve();

function serializzaHotkey<T>(fn: () => Promise<T>): Promise<T> {
  const next = codaHotkey.then(fn, fn);
  codaHotkey = next.catch(() => {});
  return next;
}

/** Registra (o riassegna) la scorciatoia globale. Ritorna false solo se la combo
 *  è davvero indisponibile (occupata da un altro programma). */
export async function registraHotkeyGlobale(
  combo: string,
  onPressed: () => void
): Promise<boolean> {
  if (!inTauri) return true;
  return serializzaHotkey(async () => {
    try {
      const gs = await import("@tauri-apps/plugin-global-shortcut");
      if (comboRegistrata && comboRegistrata !== combo) {
        await gs.unregister(comboRegistrata).catch(() => {});
      }
      // Se già registrata (StrictMode/HMR/avvio precedente) la rimuoviamo prima,
      // così ri-registrare aggiorna l'handler senza lanciare "already registered".
      if (await gs.isRegistered(combo)) {
        await gs.unregister(combo).catch(() => {});
      }
      await gs.register(combo, (e) => {
        if (e.state === "Pressed") onPressed();
      });
      comboRegistrata = combo;
      return true;
    } catch {
      comboRegistrata = null;
      return false;
    }
  });
}

/** Combo configurata → etichetta leggibile (es. "CommandOrControl+Alt+P" → "Ctrl Alt P"). */
export function etichettaHotkey(combo: string): string {
  return combo
    .replace(/CommandOrControl|CmdOrCtrl|Control/gi, "Ctrl")
    .replace(/Super|Meta/gi, "Win")
    .replace(/\+/g, " ");
}

/** Mostra/nasconde la barra di ricerca Spotlight (finestra a sé), senza toccare la
 *  principale. Premere di nuovo la scorciatoia mentre è aperta la chiude (toggle). */
export async function assicuraFinestraSpotlight(): Promise<any | null> {
  if (!inTauri) return;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const esistente = await WebviewWindow.getByLabel("spotlight");
    if (esistente) return esistente;
    return new WebviewWindow("spotlight", {
      url: "index.html?spotlight",
      title: "Cerca - PharmaTek",
      width: 640,
      height: 460,
      visible: false,
      focus: false,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      center: true,
      shadow: false,
    });
  } catch {
    return null;
  }
}

export async function mostraSpotlight(): Promise<void> {
  if (!inTauri) return;
  const spot = await assicuraFinestraSpotlight();
  if (!spot) return;
  try {
    if (await spot.isVisible()) {
      await spot.hide();
      return;
    }
  } catch {
    /* se lo stato non è leggibile, procediamo a mostrarla */
  }
  try {
    await spot.center();
  } catch {
    /* best-effort: se non centrabile, mostra dov'è */
  }
  await spot.show();
  await spot.setFocus();
}

/** Nasconde la finestra corrente (Spotlight: resta viva e pronta al prossimo uso). */
export async function nascondiFinestraCorrente(): Promise<void> {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

// ---- Deep-link lato React (consumato dalle viste della Shell) ----

interface DeepLinkCtxValue {
  link: DeepLink | null;
  consuma: () => void;
}

export const DeepLinkCtx = createContext<DeepLinkCtxValue>({ link: null, consuma: () => {} });

/** Restituisce il deep-link pendente se è per `path`, con `consuma()` per azzerarlo. */
export function useDeepLink(path: string): DeepLinkCtxValue {
  const ctx = useContext(DeepLinkCtx);
  if (ctx.link && ctx.link.path === path) return ctx;
  return { link: null, consuma: ctx.consuma };
}
