import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { exit, relaunch } from "@tauri-apps/plugin-process";
import { api, inTauri } from "./lib/tauri";
import { installaConRiavvioPreparato } from "./lib/flussoAggiornamento";

// Il repository delle release è PRIVATO: gli URL pubblici di GitHub
// (releases/.../download/...) restituiscono 404 in anonimo. Servono richieste autenticate, e
// poiché un token *fine-grained* è garantito solo su `api.github.com`, usiamo l'API per
// ENTRACORRIERE_C le risorse (niente raw.githubusercontent):
//   • manifest  → endpoint Contents API `.../contents/.updater/latest.json` con
//                 `Accept: application/vnd.github.raw` (restituisce il file grezzo);
//   • installer → URL API dell'asset (`.../releases/assets/<id>`) con
//                 `Accept: application/octet-stream` (restituisce i byte).
// I due `Accept` sono INCOMPATIBILI in un'unica richiesta (un header combinato fa restituire
// all'asset i metadati JSON invece dei byte), ma `check()` e `downloadAndInstall()` sono due
// chiamate distinte → passiamo a ciascuna il proprio set di header.
// Il token (sola lettura del solo repo, Contents:read) è iniettato a build-time in
// `VITE_DEMO_UPDATER_DISABLED` (vedi scripts/build.ps1) e finisce nel bundle: tienilo a privilegi
// minimi. Vedi docs/AGGIORNAMENTI.md.
const TOKEN = ((import.meta.env as Record<string, string | undefined>).VITE_DEMO_UPDATER_DISABLED ?? "").trim();

function conAuth(accept: string) {
  if (!TOKEN) return undefined;
  return { headers: { Authorization: `token ${TOKEN}`, Accept: accept } };
}
/** Opzioni per `check()`: scarica il manifest dalla Contents API (file grezzo). */
function opzioniManifest() {
  return conAuth("application/vnd.github.raw");
}
/** Opzioni per `downloadAndInstall()`: scarica l'asset installer (byte). Vanno passate al
 *  download: gli header del `check()` NON si propagano da soli. */
function opzioniAsset() {
  return conAuth("application/octet-stream");
}

/** Chiave localStorage: versione appena installata, da confermare con un toast al riavvio. */
export const CHIAVE_AGGIORNAMENTO_APPLICATO = "pt.aggiornamentoApplicato";
export const INTERVALLO_CONTROLLO_AGGIORNAMENTI_MS = 6 * 60 * 60 * 1000;
const CHIAVE_AGGIORNAMENTO_AVVISATO = "pt.aggiornamentoAvvisato";
const CHIAVE_VERSIONE_APP_DEDUP = "pt.aggiornamentoVersioneApp";
const DEDUP_AVVISO_AGGIORNAMENTO_MS = INTERVALLO_CONTROLLO_AGGIORNAMENTI_MS;

/** Segna che stiamo per riavviare per applicare `versione`: al riavvio mostriamo il toast
 *  «Aggiornamento completato» una sola volta (vedi `useAggiornamenti`). */
function segnaAggiornamentoApplicato(versione: string) {
  try {
    localStorage.setItem(CHIAVE_AGGIORNAMENTO_APPLICATO, versione);
  } catch {
    /* localStorage non disponibile: il toast post-riavvio semplicemente non comparirà */
  }
}

function preparaRiavvioDopoInstallazione(versione: string, onProgress?: OnProgressoAggiornamento) {
  segnaAggiornamentoApplicato(versione);
  onProgress?.({ fase: "riavvio", messaggio: "Riavvio il gestionale...", percentuale: 100 });
}

/** Prenota l'avviso per una versione: evita doppioni tra toast della main e overlay custom. */
export function prenotaAvvisoAggiornamento(versione: string): boolean {
  try {
    const raw = localStorage.getItem(CHIAVE_AGGIORNAMENTO_AVVISATO);
    const visto = raw ? JSON.parse(raw) as { versione?: string; ts?: number } : null;
    if (
      visto?.versione === versione &&
      typeof visto.ts === "number" &&
      Date.now() - visto.ts < DEDUP_AVVISO_AGGIORNAMENTO_MS
    ) {
      return false;
    }
    localStorage.setItem(CHIAVE_AGGIORNAMENTO_AVVISATO, JSON.stringify({ versione, ts: Date.now() }));
    return true;
  } catch {
    return true;
  }
}

/** Se l'app cambia versione (anche downgrade manuale), il dedup dell'avviso update non è
 *  più affidabile: altrimenti una 0.4.2 reinstallata potrebbe ricordare "ho già avvisato
 *  della 0.4.3" e non mostrare subito il pop-up automatico. */
export async function riallineaDedupVersioneInstallata(): Promise<void> {
  if (!inTauri) return;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    const versione = await getVersion();
    const precedente = localStorage.getItem(CHIAVE_VERSIONE_APP_DEDUP);
    if (precedente && precedente !== versione) {
      localStorage.removeItem(CHIAVE_AGGIORNAMENTO_AVVISATO);
      ultimoUpdate = null;
    }
    localStorage.setItem(CHIAVE_VERSIONE_APP_DEDUP, versione);
  } catch {
    /* best-effort: se fallisce, resta il vecchio dedup temporale */
  }
}

/** Dimentica il dedup dell'avviso: utile dopo un download/installazione falliti,
 *  così la versione torna proponibile al prossimo controllo o riavvio. */
export function dimenticaAvvisoAggiornamento(versione?: string): void {
  try {
    if (!versione) {
      localStorage.removeItem(CHIAVE_AGGIORNAMENTO_AVVISATO);
      return;
    }
    const raw = localStorage.getItem(CHIAVE_AGGIORNAMENTO_AVVISATO);
    const visto = raw ? JSON.parse(raw) as { versione?: string } : null;
    if (!visto || visto.versione === versione) localStorage.removeItem(CHIAVE_AGGIORNAMENTO_AVVISATO);
  } catch {
    /* se localStorage non è disponibile, non c'è nulla da pulire */
  }
}

export type StatoUpdate =
  | { stato: "inattivo" }
  | { stato: "controllo" }
  | { stato: "nessuno" }
  | { stato: "installazione" }
  | { stato: "errore"; messaggio: string };

/** Aggiornamento trovato dal controllo silenzioso, pronto da installare. */
export interface AggiornamentoDisponibile {
  versione: string;
  note: string;
}

export interface ProgressoAggiornamento {
  fase: "preparo" | "scarico" | "installo" | "riavvio";
  messaggio: string;
  percentuale?: number;
}

export type OnProgressoAggiornamento = (p: ProgressoAggiornamento) => void;

// L'oggetto Update dell'ultimo controllo: lo riusiamo per installare senza
// rifare la richiesta (e per non ricreare il download).
let ultimoUpdate: Update | null = null;

function progressDownload(onProgress?: OnProgressoAggiornamento) {
  let totale = 0;
  let scaricato = 0;
  return (ev: DownloadEvent) => {
    if (ev.event === "Started") {
      totale = ev.data.contentLength ?? 0;
      scaricato = 0;
      onProgress?.({
        fase: "scarico",
        messaggio: "Scarico l'aggiornamento...",
        percentuale: totale > 0 ? 0 : undefined,
      });
      return;
    }
    if (ev.event === "Progress") {
      scaricato += ev.data.chunkLength;
      onProgress?.({
        fase: "scarico",
        messaggio: "Scarico l'aggiornamento...",
        percentuale: totale > 0 ? Math.min(95, Math.round((scaricato / totale) * 95)) : undefined,
      });
      return;
    }
    onProgress?.({
      fase: "installo",
      messaggio: "Installo l'aggiornamento...",
      percentuale: 96,
    });
  };
}

/** Installa l'installer indicato dal manifest più recente, anche se la versione è uguale
 *  a quella già installata. È usato dal test nascosto della finestra Info. */
export async function installaUltimaVersione(
  onProgress?: OnProgressoAggiornamento
): Promise<string> {
  if (!inTauri) return "";
  if (!TOKEN) throw new Error("Token updater mancante: impossibile installare da repo privata.");
  onProgress?.({ fase: "preparo", messaggio: "Leggo l'ultima versione disponibile...", percentuale: 3 });
  onProgress?.({ fase: "scarico", messaggio: "Scarico l'aggiornamento...", percentuale: 20 });
  const result = await installaConRiavvioPreparato({
    preparaRiavvio: api.preparaRiavvioVisibile,
    installa: async () => {
      const installato = await api.installaUltimaVersione(TOKEN);
      onProgress?.({ fase: "installo", messaggio: "Installo l'aggiornamento...", percentuale: 96 });
      preparaRiavvioDopoInstallazione(installato.version, onProgress);
      return installato;
    },
    riavvia: () => exit(0),
    annullaRiavvio: api.annullaRiavvioPreparato,
  });
  return result.version;
}

/**
 * Controlla la presenza di aggiornamenti. Se ne trova uno: scarica, installa in
 * modo silenzioso e riavvia l'app.
 * - dal pulsante "Cerca aggiornamenti" (controllo manuale, installa subito).
 *
 * Funziona solo dentro la finestra desktop di Tauri (non nel browser).
 */
export async function cercaAggiornamenti(
  onStato?: (s: StatoUpdate) => void
): Promise<void> {
  if (!inTauri) {
    onStato?.({ stato: "nessuno" });
    return;
  }
  if (localStorage.getItem("pt.aggiornando") === "1") {
    onStato?.({ stato: "errore", messaggio: "Un aggiornamento è già in corso." });
    return;
  }
  localStorage.setItem("pt.aggiornando", "1");
  try {
    onStato?.({ stato: "controllo" });
    const update = await check(opzioniManifest());
    if (!update) {
      localStorage.removeItem("pt.aggiornando");
      onStato?.({ stato: "nessuno" });
      return;
    }
    onStato?.({ stato: "installazione" });
    await installaConRiavvioPreparato({
      // Deve precedere l'installer: NSIS puo' terminare il processo prima che
      // downloadAndInstall restituisca il controllo a JavaScript.
      preparaRiavvio: api.preparaRiavvioVisibile,
      installa: async () => {
        await update.downloadAndInstall(undefined, opzioniAsset());
        preparaRiavvioDopoInstallazione(update.version);
      },
      riavvia: relaunch,
      annullaRiavvio: api.annullaRiavvioPreparato,
    });
  } catch (e) {
    localStorage.removeItem("pt.aggiornando");
    onStato?.({ stato: "errore", messaggio: String(e) });
  }
}

/**
 * Controllo SILENZIOSO (avvio + periodico): verifica se c'è un aggiornamento
 * SENZA scaricarlo né installarlo. Ritorna i dati per avvisare l'utente, oppure
 * `null` (già aggiornato, offline o fuori da Tauri). Non lancia mai.
 */
export async function controllaAggiornamento(): Promise<AggiornamentoDisponibile | null> {
  if (!inTauri) return null;
  try {
    const update = await check(opzioniManifest());
    if (!update) {
      ultimoUpdate = null;
      return null;
    }
    ultimoUpdate = update;
    return { versione: update.version, note: update.body ?? "" };
  } catch {
    return null; // offline / endpoint non raggiungibile: silenzioso
  }
}

/**
 * Installa l'aggiornamento trovato dall'ultimo `controllaAggiornamento` (o ne
 * cerca uno al volo se non in cache), poi riavvia. Usato dall'azione della
 * notifica «Aggiorna ora».
 */
export async function installaAggiornamento(
  onStato?: (s: StatoUpdate) => void,
  onProgress?: OnProgressoAggiornamento
): Promise<void> {
  if (!inTauri) return;
  let versione: string | undefined;
  try {
    onProgress?.({ fase: "preparo", messaggio: "Preparo l'aggiornamento...", percentuale: 3 });
    const update = ultimoUpdate ?? (await check(opzioniManifest()));
    if (!update) {
      onStato?.({ stato: "nessuno" });
      return;
    }
    versione = update.version;
    onStato?.({ stato: "installazione" });
    await installaConRiavvioPreparato({
      preparaRiavvio: api.preparaRiavvioVisibile,
      installa: async () => {
        await update.downloadAndInstall(progressDownload(onProgress), opzioniAsset());
        preparaRiavvioDopoInstallazione(update.version, onProgress);
      },
      riavvia: relaunch,
      annullaRiavvio: api.annullaRiavvioPreparato,
    });
  } catch (e) {
    dimenticaAvvisoAggiornamento(versione);
    onStato?.({ stato: "errore", messaggio: String(e) });
    throw e;
  }
}

/**
 * Installa in modo completamente silenzioso l'ultimo update disponibile e chiede al
 * prossimo avvio di restare nascosto nella tray. Usato solo dal controllo automatico
 * quando l'app è già nascosta e inattiva: rifà sempre `check()` prima del download,
 * così usa il manifest/link più recente invece dell'eventuale cache del toast.
 */
export async function installaAggiornamentoBackgroundMinimizzato(
  condizioniAncoraValide?: () => Promise<boolean>
): Promise<string | null> {
  if (!inTauri) return null;
  let versione: string | undefined;
  let bloccoLocaleAcquisito = false;
  if (localStorage.getItem("pt.aggiornando") === "1") return null;
  try {
    const update = await check(opzioniManifest());
    if (!update) {
      ultimoUpdate = null;
      return null;
    }
    // Il secondo check di rete e' volutamente dentro questa funzione. Prima di
    // preparare il riavvio rivalidiamo quindi lo stato delle finestre un'ultima
    // volta, senza lasciare un intervallo di rete dopo il controllo di inattivita'.
    if (condizioniAncoraValide && !(await condizioniAncoraValide())) return null;
    if (localStorage.getItem("pt.aggiornando") === "1") return null;
    localStorage.setItem("pt.aggiornando", "1");
    bloccoLocaleAcquisito = true;
    versione = update.version;
    await installaConRiavvioPreparato({
      preparaRiavvio: api.preparaRiavvioMinimizzato,
      installa: async () => {
        await update.downloadAndInstall(undefined, opzioniAsset());
        preparaRiavvioDopoInstallazione(update.version);
      },
      riavvia: relaunch,
      annullaRiavvio: api.annullaRiavvioPreparato,
    });
    return update.version;
  } catch (e) {
    if (bloccoLocaleAcquisito) localStorage.removeItem("pt.aggiornando");
    dimenticaAvvisoAggiornamento(versione);
    throw e;
  }
}
