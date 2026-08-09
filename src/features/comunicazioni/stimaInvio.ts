import type { CanaleComunicazione } from "../../lib/tauri";

export const STIMA_INVIO_SECONDI: Record<CanaleComunicazione, number> = {
  email: 2,
  whatsapp: 7,
};

export function stimaInvioSecondi(
  canali: readonly CanaleComunicazione[],
): number {
  return canali.reduce(
    (totale, canale) => totale + STIMA_INVIO_SECONDI[canale],
    0,
  );
}

export function formattaStimaInvio(secondi: number): string {
  const valore = Math.max(0, Math.ceil(secondi));
  if (valore < 60) return `≈ ${valore} s`;
  const minuti = Math.floor(valore / 60);
  const resto = valore % 60;
  return resto ? `≈ ${minuti} min ${resto} s` : `≈ ${minuti} min`;
}
