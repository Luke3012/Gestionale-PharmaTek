import type { Bootstrap } from "./tauriTypes";
import { ripristinoRemotoInCorso } from "./consegnaRipristino";

const TENTATIVI_SYNC_AVVIO = 6;

export interface DipendenzeSyncAvvio {
  forceSync: () => Promise<number>;
  bootstrap: () => Promise<Bootstrap>;
  onRetry?: () => void;
  attendi?: (ms: number) => Promise<void>;
}

export interface DipendenzeAperturaSpotlight {
  avvioInCorso: Promise<unknown> | null;
  bootstrapCorrente: () => Bootstrap | null;
  aperturaBloccata: () => boolean;
  apri: () => Promise<void>;
}

/**
 * Stabilisce se il primo rendering completo avviene mentre la main deve restare
 * invisibile. Al primo mount conta l'intenzione nativa (`--minimized` o relaunch
 * automatico); dopo un reload del WebView conta invece la visibilita' effettiva,
 * per non riprodurre intro e transizioni quando la main e' ancora nella tray.
 */
export function renderingInizialeNascosto(
  primoMountProcesso: boolean,
  avvioMinimizzato: boolean,
  mainVisibile: boolean
): boolean {
  return primoMountProcesso ? avvioMinimizzato : !mainVisibile;
}

/**
 * La proiezione va riallineata prima che le viste inizino le loro prime letture.
 * Configurazioni incomplete, reset, cartelle mancanti e sessioni scollegate devono
 * invece restare nei rispettivi flussi di recupero senza tentare una sync.
 */
export function bootstrapSincronizzabile(data: Bootstrap): boolean {
  return (
    data.onboarded &&
    !!data.identity &&
    !data.reconnectRequired &&
    data.dataDirStatus === "ok" &&
    !ripristinoRemotoInCorso(data)
  );
}

/**
 * Il polling incrementale del renderer principale è utile soltanto mentre la
 * finestra è realmente in uso. Quando è nascosta o perde il focus, il
 * notificatore nativo mantiene l'ingest attivo senza duplicare I/O.
 */
export function pollingMainAttivo(
  visibilityState: DocumentVisibilityState,
  hasFocus: boolean
): boolean {
  return visibilityState === "visible" && hasFocus;
}

/**
 * La scorciatoia desktop/globale non avvia un secondo bootstrap: attende quello
 * gia' coordinato da Root e apre Spotlight soltanto se lo stato risultante e'
 * utilizzabile e nessun restore/reset/blocco e' in corso.
 */
export async function apriSpotlightDopoAvvio(
  dipendenze: DipendenzeAperturaSpotlight
): Promise<boolean> {
  try {
    await dipendenze.avvioInCorso;
  } catch {
    return false;
  }

  if (dipendenze.aperturaBloccata()) return false;
  const data = dipendenze.bootstrapCorrente();
  if (!data || !bootstrapSincronizzabile(data)) return false;

  await dipendenze.apri();
  return true;
}

/**
 * Esegue un ingest idempotente prima del montaggio (o della riattivazione) delle
 * viste e rilegge sempre il bootstrap: la sync può aver ricevuto il ritiro del PC,
 * la rimozione dell'utente o un reset remoto.
 */
export async function sincronizzaPrimaDelleViste(
  data: Bootstrap,
  dipendenze: DipendenzeSyncAvvio
): Promise<Bootstrap> {
  if (!bootstrapSincronizzabile(data)) return data;

  const attendi = dipendenze.attendi ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let ultimoErrore: unknown;
  for (let i = 0; i < TENTATIVI_SYNC_AVVIO; i += 1) {
    try {
      await dipendenze.forceSync();
      return await dipendenze.bootstrap();
    } catch (errore) {
      ultimoErrore = errore;
      if (i < TENTATIVI_SYNC_AVVIO - 1) {
        dipendenze.onRetry?.();
        await attendi(Math.min(600 + i * 600, 3_000));
      }
    }
  }
  throw ultimoErrore;
}
