import type { Bootstrap } from "./tauriTypes";

const TENTATIVI_BOOTSTRAP = 6;

export interface DipendenzeBootstrapRetry {
  bootstrap: () => Promise<Bootstrap>;
  onAttesa?: () => void;
  attendi?: (ms: number) => Promise<void>;
}

function statoTemporaneamenteNonPronto(error: unknown): boolean {
  const messaggio = String(error);
  return (
    messaggio.includes("state not managed") ||
    messaggio.includes("Stato app non ancora pronto") ||
    messaggio.includes("Gap rilevato all'avvio") ||
    messaggio.includes("snapshot non ancora disponibile")
  );
}

/**
 * Concede a OneDrive una breve finestra per consegnare una cartella appena montata.
 * Dopo circa sette secondi restituisce comunque lo stato recuperabile alla UI:
 * un nuovo tentativo non deve sembrare un loader permanente.
 */
export async function bootstrapConRetry({
  bootstrap,
  onAttesa,
  attendi = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: DipendenzeBootstrapRetry): Promise<Bootstrap> {
  let ultimoErrore: unknown;
  for (let i = 0; i < TENTATIVI_BOOTSTRAP; i += 1) {
    try {
      const data = await bootstrap();
      const cartellaInAttesa = !!data.dataDir && data.dataDirStatus === "missing_or_empty";
      if (!cartellaInAttesa || i === TENTATIVI_BOOTSTRAP - 1) return data;
    } catch (error) {
      if (!statoTemporaneamenteNonPronto(error)) throw error;
      ultimoErrore = error;
      if (i === TENTATIVI_BOOTSTRAP - 1) break;
    }
    onAttesa?.();
    await attendi(Math.min(700 + i * 350, 2_000));
  }
  throw ultimoErrore;
}
