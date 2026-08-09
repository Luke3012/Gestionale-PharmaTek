import type { Bootstrap, OperationLockStatus } from "./tauriTypes";

export type StatoConsegnaRipristino = "none" | "waiting" | "ready";

const ATTESA_MASSIMA_RIPRISTINO_MS = 120_000;
const AZIONI_CHE_BLOCCANO_IL_RIPRISTINO = new Set([
  "preparazione_ripristino",
  "ripristino_backup",
  "ottimizzazione_database",
]);

/** Compatibilità con bootstrap prodotti da backend precedenti. */
export function statoConsegnaRipristino(data: Bootstrap): StatoConsegnaRipristino {
  if (data.restoreStatus === "waiting" || data.restoreStatus === "ready") {
    return data.restoreStatus;
  }
  return data.pendingRestore ? "ready" : "none";
}

export function ripristinoRemotoInCorso(data: Bootstrap): boolean {
  return statoConsegnaRipristino(data) !== "none";
}

export function eventoRichiedeBloccoRipristino(reason?: string): boolean {
  return reason === "restore" || reason === "restore-waiting";
}

export function lockMantieneBloccoRipristino(
  lock: OperationLockStatus | null
): lock is OperationLockStatus {
  return Boolean(lock?.active && AZIONI_CHE_BLOCCANO_IL_RIPRISTINO.has(lock.azione));
}

interface DipendenzeAttesaRipristino {
  bootstrap: () => Promise<Bootstrap>;
  attivo: () => boolean;
  onWaiting?: () => void;
  attendi?: (ms: number) => Promise<void>;
  intervalloMs?: number;
  timeoutMs?: number;
  ora?: () => number;
}

/**
 * Mantiene la UI bloccata finché il marker è privo del payload completo. Non
 * invoca mai la ricostruzione: il chiamante può farlo soltanto dopo `ready`.
 * Se OneDrive non converge entro il limite, restituisce un errore recuperabile
 * invece di lasciare per sempre una schermata di caricamento.
 */
export async function attendiConsegnaRipristino(
  iniziale: Bootstrap,
  dipendenze: DipendenzeAttesaRipristino
): Promise<Bootstrap> {
  const attendi = dipendenze.attendi ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const intervallo = dipendenze.intervalloMs ?? 1_000;
  const timeout = dipendenze.timeoutMs ?? ATTESA_MASSIMA_RIPRISTINO_MS;
  const ora = dipendenze.ora ?? Date.now;
  const iniziataAlle = ora();
  let corrente = iniziale;

  while (dipendenze.attivo() && statoConsegnaRipristino(corrente) === "waiting") {
    if (ora() - iniziataAlle >= timeout) {
      throw new Error(
        "OneDrive non ha completato la consegna del ripristino. Verifica la sincronizzazione e premi “Riprova”."
      );
    }
    dipendenze.onWaiting?.();
    await attendi(intervallo);
    if (!dipendenze.attivo()) return corrente;
    corrente = await dipendenze.bootstrap();
  }
  return corrente;
}
