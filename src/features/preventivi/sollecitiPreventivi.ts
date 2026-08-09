export interface PreventivoSollecitabile {
  ordineStato: string;
  indicazioneInvio: string;
  ultimoInvioMs: number;
  ultimoSollecitoMs: number;
}

export type GruppoSollecitiPreventivi = "da_inviare" | "da_sollecitare";

export interface ClassificazioneSollecitiPreventivi<T> {
  daInviare: T[];
  daSollecitare: T[];
  totale: number;
}

const GIORNO_MS = 24 * 60 * 60 * 1_000;

export function classificaSollecitiPreventivi<T extends PreventivoSollecitabile>(
  preventivi: readonly T[],
  giorni: number,
  adessoMs = Date.now(),
): ClassificazioneSollecitiPreventivi<T> {
  const giorniNormalizzati = Math.max(1, Math.trunc(giorni) || 1);
  const soglia = adessoMs - giorniNormalizzati * GIORNO_MS;
  const daInviare: T[] = [];
  const daSollecitare: T[] = [];

  for (const preventivo of preventivi) {
    if (
      preventivo.indicazioneInvio === "mai_inviato" ||
      preventivo.indicazioneInvio === "modificato_dopo_invio"
    ) {
      daInviare.push(preventivo);
      continue;
    }
    if (
      preventivo.ordineStato === "Nuovo" &&
      preventivo.indicazioneInvio === "inviato" &&
      preventivo.ultimoInvioMs > 0 &&
      Math.max(preventivo.ultimoInvioMs, preventivo.ultimoSollecitoMs) <= soglia
    ) {
      daSollecitare.push(preventivo);
    }
  }

  return {
    daInviare,
    daSollecitare,
    totale: daInviare.length + daSollecitare.length,
  };
}
