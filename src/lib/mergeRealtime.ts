export interface RisultatoMergeRealtime<T extends Record<string, unknown>> {
  valori: T;
  aggiornati: string[];
}

function uguali(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Fonde un aggiornamento remoto in un form aperto:
 * - i campi non toccati localmente seguono il remoto;
 * - quelli modificati localmente restano invariati e, se salvati dopo, vincono
 *   soltanto su quel campo.
 */
export function mergeRealtimeSelettivo<T extends Record<string, unknown>>(
  baseline: T,
  locale: T,
  remoto: T
): RisultatoMergeRealtime<T> {
  const valori = { ...locale };
  const aggiornati: string[] = [];

  for (const key of Object.keys(remoto)) {
    const localeModificato = !uguali(locale[key], baseline[key]);
    if (!localeModificato) {
      if (!uguali(locale[key], remoto[key])) aggiornati.push(key);
      valori[key as keyof T] = remoto[key] as T[keyof T];
    }
  }

  return { valori, aggiornati };
}
