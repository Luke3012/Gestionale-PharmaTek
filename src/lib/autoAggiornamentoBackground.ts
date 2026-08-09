import { api, inTauri } from "./tauri";
import {
  controllaAggiornamento,
  installaAggiornamentoBackgroundMinimizzato,
  riallineaDedupVersioneInstallata,
} from "../updater";

const CHIAVE_ULTIMA_MAIN_VISIBILE = "pt.mainUltimaVisibileMs";
export const ATTESA_MAIN_NASCOSTA_MS = 30 * 60 * 1000;

let controlloOInstallazioneInCorso = false;

export function segnaMainVisibileOra() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CHIAVE_ULTIMA_MAIN_VISIBILE, String(Date.now()));
  } catch {}
}

function ultimaMainVisibileMs(): number {
  try {
    const raw = localStorage.getItem(CHIAVE_ULTIMA_MAIN_VISIBILE);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch {}
  segnaMainVisibileOra();
  return Date.now();
}

export function finestraBloccaAggiornamentoBackground(
  label: string,
  ignoraOverlayDiManutenzione: boolean
): boolean {
  if (label === "main") return false;
  return !(ignoraOverlayDiManutenzione && label === "overlay");
}

async function appNascostaSenzaPannelliUtente(
  ignoraOverlayDiManutenzione: boolean
): Promise<boolean> {
  const { getAllWindows } = await import("@tauri-apps/api/window");
  const finestre = await getAllWindows();
  const main = finestre.find((w) => w.label === "main");
  if (!main) return false;

  const mainVisibile = await main.isVisible().catch(() => true);
  if (mainVisibile) {
    segnaMainVisibileOra();
    return false;
  }

  // Qualunque altra finestra visibile indica attivita' dell'utente. In particolare
  // Spotlight e lo stesso overlay diventano interattivi quando sono mostrati: non
  // dobbiamo riavviare l'app mentre l'utente li sta usando.
  const pannelliUtente = finestre.filter((w) =>
    finestraBloccaAggiornamentoBackground(w.label, ignoraOverlayDiManutenzione)
  );
  const visibilita = await Promise.all(
    pannelliUtente.map((w) => w.isVisible().catch(() => true))
  );
  return visibilita.every((visibile) => !visibile);
}

async function nessunaOperazioneImportante(): Promise<boolean> {
  if (localStorage.getItem("pt.aggiornando") === "1") return false;
  const lock = await api.operationLockStatus().catch(() => null);
  return !lock?.active;
}

async function condizioniBackgroundAncoraValide(
  ignoraOverlayDiManutenzione: boolean,
  condizioneLocale?: () => boolean
): Promise<boolean> {
  if (condizioneLocale && !condizioneLocale()) return false;
  if (!(await appNascostaSenzaPannelliUtente(ignoraOverlayDiManutenzione))) return false;
  if (Date.now() - ultimaMainVisibileMs() < ATTESA_MAIN_NASCOSTA_MS) return false;
  return nessunaOperazioneImportante();
}

export async function provaAggiornamentoAutomaticoBackground(
  ignoraOverlayDiManutenzione = false,
  condizioneLocale?: () => boolean
): Promise<boolean> {
  if (!inTauri || controlloOInstallazioneInCorso) return false;
  controlloOInstallazioneInCorso = true;
  try {
    // L'autostart decide soltanto se l'app parte con Windows. Se il processo è già
    // aperto, nascosto e inattivo, non deve impedire l'aggiornamento silenzioso.
    if (
      !(await condizioniBackgroundAncoraValide(ignoraOverlayDiManutenzione, condizioneLocale))
    ) return false;

    const remoto = await import("../remoteControl")
      .then(({ controllaDisattivazioneRemota }) => controllaDisattivazioneRemota())
      .catch(() => null);
    if (remoto?.disabled) {
      await api.notificheDisattivaSessione().catch(() => {});
      return false;
    }

    await riallineaDedupVersioneInstallata();
    const trovato = await controllaAggiornamento();
    if (!trovato) return false;

    // Il controllo remoto e la richiesta del manifest possono richiedere diversi
    // secondi. L'utente potrebbe aver riaperto main, Spotlight o un pannello nel
    // frattempo: rivalidiamo subito prima di consegnare il controllo all'installer.
    if (
      !(await condizioniBackgroundAncoraValide(ignoraOverlayDiManutenzione, condizioneLocale))
    ) return false;

    // `installaAggiornamentoBackgroundMinimizzato` rifà comunque `check()` prima di
    // scaricare: qui il controllo serve solo a non aprire il flusso se non c'è nulla.
    const versioneInstallata = await installaAggiornamentoBackgroundMinimizzato(() =>
      condizioniBackgroundAncoraValide(ignoraOverlayDiManutenzione, condizioneLocale)
    );
    return versioneInstallata !== null;
  } finally {
    controlloOInstallazioneInCorso = false;
  }
}
