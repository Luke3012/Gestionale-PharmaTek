import type { SpedizioneRiepilogo } from "../../lib/tauri";

// Una sola voce per lotto: le firme obsolete vengono sostituite, non accumulate.
const cache = new Map<string, { firma: string; riepilogo: SpedizioneRiepilogo }>();

export function riepilogoMemorizzato(lotto: string, firma: string) {
  const voce = cache.get(lotto);
  return voce?.firma === firma ? voce.riepilogo : null;
}

export function memorizzaRiepilogo(lotto: string, firma: string, riepilogo: SpedizioneRiepilogo) {
  cache.set(lotto, { firma, riepilogo });
}

export function clearRiepilogoCache() {
  cache.clear();
}

export function conservaRiepiloghiLotti(lotti: ReadonlySet<string>) {
  for (const lotto of cache.keys()) {
    if (!lotti.has(lotto)) cache.delete(lotto);
  }
}
