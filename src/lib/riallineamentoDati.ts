type StatoRiallineamentoDati = {
  inCorso: boolean;
  ripristinoBloccante: boolean;
  ultimoAvvio: number;
};

const TENTATIVI_RICOSTRUZIONE = 6;

type GestoreApp = () => boolean;
const gestoriApp = new Map<symbol, GestoreApp>();

declare global {
  interface Window {
    __ptRiallineamentoDati?: StatoRiallineamentoDati;
  }
}

function stato(): StatoRiallineamentoDati {
  if (!window.__ptRiallineamentoDati) {
    window.__ptRiallineamentoDati = {
      inCorso: false,
      ripristinoBloccante: false,
      ultimoAvvio: 0,
    };
  }
  return window.__ptRiallineamentoDati;
}

/**
 * Guardia condivisa fra il listener di boot e quello di App.tsx: se un evento
 * `pt:data-wiped` arriva nel passaggio bootscreen → app montata, solo un percorso
 * può ricostruire la proiezione locale.
 */
export function iniziaRiallineamentoDati(): boolean {
  const s = stato();
  if (s.inCorso) return false;
  s.inCorso = true;
  s.ultimoAvvio = Date.now();
  return true;
}

export function terminaRiallineamentoDati(): void {
  const s = stato();
  s.inCorso = false;
}

export function riallineamentoDatiInCorso(): boolean {
  return stato().inCorso;
}

/**
 * App registra la propria capacita' di gestire `pt:data-wiped` soltanto dopo
 * l'attivazione del listener Tauri. Root puo' cosi' cederle l'evento senza una
 * finestra cieca. Il token rende il cleanup sicuro nel replay di StrictMode.
 */
export function registraGestoreRiallineamentoApp(puoGestire: GestoreApp): () => void {
  const token = Symbol("gestore-riallineamento-app");
  gestoriApp.set(token, puoGestire);
  return () => {
    gestoriApp.delete(token);
  };
}

export function appPuoGestireRiallineamentoDati(): boolean {
  return [...gestoriApp.values()].some((puoGestire) => {
    try {
      return puoGestire();
    } catch {
      return false;
    }
  });
}

export function attivaRipristinoBloccante(): void {
  stato().ripristinoBloccante = true;
}

export function disattivaRipristinoBloccante(): void {
  stato().ripristinoBloccante = false;
}

export function ripristinoBloccanteAttivo(): boolean {
  return stato().ripristinoBloccante;
}

export function messaggioRiallineamentoDati(reason?: string): string {
  return reason === "snapshot" ? "Sincronizzo i dati più recenti…" : "Sto riallineando i dati locali…";
}

export function messaggioRiallineamentoDatiCompletato(reason?: string): string {
  return reason === "snapshot" ? "Dati sincronizzati e riallineati." : "Dati locali riallineati.";
}

export function messaggioRiallineamentoDatiFallito(error: unknown): string {
  return `Riallineamento dati non riuscito: ${error}`;
}

/**
 * La rimozione dell'identita' o della postazione corrente non e' un normale
 * aggiornamento della dashboard. Le viste operative vanno coperte mentre il core
 * rilegge lo stato autorevole e poi sostituite dalla schermata di riconnessione.
 */
export function eventoRichiedeRiconvalidaSessione(reason?: string): boolean {
  return reason === "identity" || reason === "device";
}

/**
 * Ricostruisce la proiezione locale tollerando i ritardi di consegna di
 * log/snapshot da parte di OneDrive. La presentazione del retry resta al
 * chiamante: bootscreen e app montata hanno lifecycle UI differenti.
 */
export async function ricostruisciProiezioneConRetry(onRetry?: () => void): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  let ultimoErrore: unknown;
  for (let i = 0; i < TENTATIVI_RICOSTRUZIONE; i += 1) {
    try {
      await invoke("ricostruisci_proiezione_locale");
      return;
    } catch (err) {
      ultimoErrore = err;
      if (i < TENTATIVI_RICOSTRUZIONE - 1) {
        onRetry?.();
        await new Promise((resolve) => setTimeout(resolve, Math.min(800 + i * 700, 4_000)));
      }
    }
  }
  throw ultimoErrore;
}
