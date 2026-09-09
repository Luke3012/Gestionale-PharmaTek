// Apertura delle piccole finestre-pannello richiamabili dallo Spotlight (FASE 6D):
// «Notifiche» (il pop-over della campanella a finestra) e «Cestino». Label fisso
// per finestra → ri-aprire porta in primo piano quella già aperta invece di
// duplicarla. Riusa lo stesso `index.html` con un parametro nella query.
import { inTauri, type Identity } from "../lib/tauri";
import {
  apriFinestraTauri,
  portaFinestraInPrimoPiano,
  queryIdentita,
} from "../lib/finestreTauri";

export interface ComposeNotificaTarget {
  destId: string;
  destNome: string;
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

  return apriFinestraTauri({
    label: "notifiche",
    query: `notifiche=1${idp}${cp}`,
    title: "Notifiche",
    chiaveGeometria: "notifiche",
    geometria: { width: 420, height: 560, minWidth: 360, minHeight: 420 },
    mostraDopoCreazione: true,
  });
}

export async function apriFinestraCestino(): Promise<boolean> {
  return apriFinestraTauri({
    label: "cestino",
    query: "cestino=1",
    title: "Cestino",
    chiaveGeometria: "cestino",
    geometria: { width: 420, height: 560, minWidth: 360, minHeight: 420 },
    mostraDopoCreazione: true,
  });
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
  return apriFinestraTauri({
    label: "comunicazioni",
    query: `comunicazioni=1${
      evidenzia ? `&evidenzia=${encodeURIComponent(evidenzia)}` : ""
    }`,
    title: "Cronologia comunicazioni",
    chiaveGeometria: "comunicazioni",
    geometria: { width: 680, height: 600, minWidth: 520, minHeight: 440 },
    mostraDopoCreazione: true,
  });
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
  return apriFinestraTauri({
    label: "info",
    query,
    title: "Info — PharmaTek",
    chiaveGeometria: "info",
    geometria: { width: 600, height: 450, minWidth: 480, minHeight: 380 },
    mostraDopoCreazione: true,
  });
}
