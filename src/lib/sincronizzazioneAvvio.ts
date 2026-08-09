import type { Bootstrap } from "./tauriTypes";
import { ripristinoRemotoInCorso } from "./consegnaRipristino";

const TENTATIVI_SYNC_AVVIO = 6;

export interface DipendenzeSyncAvvio {
  forceSync: () => Promise<number>;
  bootstrap: () => Promise<Bootstrap>;
  onRetry?: () => void;
  attendi?: (ms: number) => Promise<void>;
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
