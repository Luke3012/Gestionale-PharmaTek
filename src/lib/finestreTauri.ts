import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api, inTauri, type Identity } from "./tauri";

type FinestraAttivabile = Pick<WebviewWindow, "show" | "unminimize" | "setFocus">;
type FinestraInCreazione = Pick<WebviewWindow, "label" | "once">;
type FinestraNascondibile = Pick<WebviewWindow, "hide">;

async function finestraRegistrata(label: string): Promise<boolean> {
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return !!(await WebviewWindow.getByLabel(label));
  } catch {
    return false;
  }
}

/** Applica la regola globale della X: con autostart attivo la main resta nella tray. */
export async function nascondiInTraySeAttiva(
  finestra: FinestraNascondibile,
  verifica = async () => {
    const autostart = await (await import("@tauri-apps/plugin-autostart")).isEnabled();
    return autostart && await api.trayDisponibile();
  }
): Promise<boolean> {
  try {
    if (!(await verifica())) return false;
  } catch {
    return false;
  }
  // Se Windows rifiuta momentaneamente hide, non trasformare una richiesta di
  // riduzione in tray in un'uscita completa e inattesa.
  await finestra.hide().catch(() => {});
  return true;
}

/** Finestre utente che richiedono conferma prima dell'uscita completa. */
export function èPannelloUtente(label: string): boolean {
  return /^(ordine-|preventivo-|riepilogo-|pagamento-|promemoria-)/.test(label) ||
    label.startsWith("comunicazione-") ||
    label === "notifiche" || label === "comunicazioni" || label === "cestino";
}

/** Riporta davanti una finestra già esistente mantenendo l'ordine operativo storico. */
export async function portaFinestraInPrimoPiano(finestra: FinestraAttivabile): Promise<void> {
  await finestra.show();
  await finestra.unminimize();
  await finestra.setFocus();
}

/** Parametri condivisi dalle finestre secondarie per evitare un secondo `whoami`. */
export function queryIdentita(identity?: Identity): string {
  return identity
    ? `&uid=${encodeURIComponent(identity.userId)}&nome=${encodeURIComponent(identity.nome)}&dev=${encodeURIComponent(identity.deviceId)}`
    : "";
}

/** Traduce gli eventi Tauri di creazione nello stesso esito booleano usato dai chiamanti. */
export function attendiCreazioneFinestra(
  finestra: FinestraInCreazione,
  timeoutMs = 5_000,
  verificaEsistenza: (label: string) => Promise<boolean> = finestraRegistrata,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let conclusa = false;
    const off: Array<() => void> = [];
    const timer = setTimeout(() => termina(false), timeoutMs);

    const termina = (creata: boolean) => {
      if (conclusa) return;
      conclusa = true;
      clearTimeout(timer);
      off.splice(0).forEach((scollega) => scollega());
      resolve(creata);
    };

    const registra = async (evento: "tauri://created" | "tauri://error", esito: boolean) => {
      try {
        const scollega = await finestra.once(evento, () => termina(esito));
        if (conclusa) scollega();
        else off.push(scollega);
      } catch {
        termina(false);
      }
    };

    // `WebviewWindow` avvia la creazione già nel costruttore: su macchine veloci
    // `tauri://created` può arrivare mentre `once` sta ancora registrando i listener.
    // Dopo averli agganciati verifichiamo quindi anche il registro Tauri; in questo
    // modo una finestra creata non resta nascosta in attesa di un secondo clic.
    void Promise.all([
      registra("tauri://created", true),
      registra("tauri://error", false),
    ]).then(async () => {
      if (conclusa) return;
      try {
        if (await verificaEsistenza(finestra.label)) termina(true);
      } catch {
        // Il listener resta attivo fino all'evento o al timeout.
      }
    });
  });
}

export async function chiudiFinestraCorrente(): Promise<void> {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}
