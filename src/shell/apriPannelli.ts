// Apertura delle piccole finestre-pannello richiamabili dallo Spotlight (FASE 6D):
// «Notifiche» (il pop-over della campanella a finestra) e «Cestino». Label fisso
// per finestra → ri-aprire porta in primo piano quella già aperta invece di
// duplicarla. Riusa lo stesso `index.html` con un parametro nella query.
import { inTauri, type Identity } from "../lib/tauri";
import { opzioniGeometria } from "../lib/geometriaFinestre";
import {
  attendiCreazioneFinestra,
  portaFinestraInPrimoPiano,
  queryIdentita,
} from "../lib/finestreTauri";

export interface ComposeNotificaTarget {
  destId: string;
  destNome: string;
}

async function apriFinestraSemplice(
  label: string,
  query: string,
  title: string,
  /** Chiave di geometria ricordata (= il "tipo" di finestra). */
  chiave: string,
  width: number,
  height: number,
  minWidth = 360,
  minHeight = 420
): Promise<boolean> {
  if (!inTauri) return false;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const esistente = await WebviewWindow.getByLabel(label);
    if (esistente) {
      // Già aperta: la portiamo in primo piano senza toccarne misura/posizione
      // (rispetta dove e come l'utente l'aveva lasciata).
      await portaFinestraInPrimoPiano(esistente);
      return true;
    }
    const w = new WebviewWindow(label, {
      url: `index.html?${query}`,
      title,
      minWidth,
      minHeight,
      ...(await opzioniGeometria(chiave, { width, height, minWidth, minHeight })),
      visible: false,
    });
    const creata = await attendiCreazioneFinestra(w);
    if (!creata) return false;
    // La prima apertura non deve dipendere dal timing del mount React nella
    // nuova webview: appena Tauri conferma la creazione la rendiamo visibile.
    await portaFinestraInPrimoPiano(w);
    return true;
  } catch {
    return false;
  }
}

export async function apriFinestraNotifiche(identity?: Identity, compose?: ComposeNotificaTarget): Promise<boolean> {
  const idp = queryIdentita(identity);
  const cp = compose
    ? `&composeDest=${encodeURIComponent(compose.destId)}&composeNome=${encodeURIComponent(compose.destNome)}`
    : "";

  if (compose && inTauri) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const esistente = await WebviewWindow.getByLabel("notifiche");
      if (esistente) {
        await portaFinestraInPrimoPiano(esistente);
        const { emitTo } = await import("@tauri-apps/api/event");
        await emitTo("notifiche", "pt:notifiche-componi", compose).catch(() => {});
        return true;
      }
    } catch {
      // Se la finestra non risponde, usiamo il normale percorso di apertura.
    }
  }

  return apriFinestraSemplice("notifiche", `notifiche=1${idp}${cp}`, "Notifiche", "notifiche", 420, 560);
}

export async function apriFinestraCestino(): Promise<boolean> {
  return apriFinestraSemplice("cestino", "cestino=1", "Cestino", "cestino", 420, 560);
}

export async function apriFinestraCentroComunicazioni(
  comunicazioneId?: string,
): Promise<boolean> {
  const evidenzia = comunicazioneId?.trim();
  if (evidenzia && inTauri) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const esistente = await WebviewWindow.getByLabel("comunicazioni");
      if (esistente) {
        await portaFinestraInPrimoPiano(esistente);
        const { emitTo } = await import("@tauri-apps/api/event");
        await emitTo("comunicazioni", "pt:apri-centro-comunicazioni", {
          comunicazioneId: evidenzia,
          richiestaId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }).catch(() => {});
        return true;
      }
    } catch {
      // Se la finestra non risponde, la ricreiamo col normale percorso.
    }
  }
  return apriFinestraSemplice(
    "comunicazioni",
    `comunicazioni=1${
      evidenzia ? `&evidenzia=${encodeURIComponent(evidenzia)}` : ""
    }`,
    "Cronologia comunicazioni",
    "comunicazioni",
    680,
    600,
    520,
    440
  );
}

export async function apriFinestraInfo(target?: string): Promise<boolean> {
  // Se la finestra esiste già, proviamo comunque a fargli cambiare tab via evento
  if (inTauri && target) {
    import("@tauri-apps/api/webviewWindow").then(async ({ WebviewWindow }) => {
      const esistente = await WebviewWindow.getByLabel("info");
      if (esistente) {
        const { emit } = await import("@tauri-apps/api/event");
        await emit("info:navigate", target);
      }
    }).catch(() => {});
  }
  const query = target ? `info=1&target=${encodeURIComponent(target)}` : "info=1";
  return apriFinestraSemplice("info", query, "Info — PharmaTek", "info", 600, 450, 480, 380);
}
