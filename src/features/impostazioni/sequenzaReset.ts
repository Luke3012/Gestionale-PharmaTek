const PRESSIONI_RESET = 5;
const FINESTRA_RESET_MS = 1_500;

export type StatoSequenzaReset = {
  conteggio: number;
  ultimaPressioneMs: number;
};

export const STATO_SEQUENZA_RESET_INIZIALE: StatoSequenzaReset = {
  conteggio: 0,
  ultimaPressioneMs: 0,
};

export function registraPressioneReset(
  stato: StatoSequenzaReset,
  oraMs: number,
  finestraMs = FINESTRA_RESET_MS
): { stato: StatoSequenzaReset; attiva: boolean } {
  const scaduta = stato.ultimaPressioneMs === 0 || oraMs - stato.ultimaPressioneMs > finestraMs;
  const conteggio = (scaduta ? 0 : stato.conteggio) + 1;
  if (conteggio >= PRESSIONI_RESET) {
    return {
      stato: { conteggio: 0, ultimaPressioneMs: oraMs },
      attiva: true,
    };
  }
  return {
    stato: { conteggio, ultimaPressioneMs: oraMs },
    attiva: false,
  };
}
