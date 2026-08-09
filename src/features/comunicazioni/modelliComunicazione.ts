const SEGNAPOSTO = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

export function risolviModello(
  testo: string,
  variabili: Record<string, string>,
): { testo: string; mancanti: string[] } {
  const mancanti = new Set<string>();
  const risolto = testo.replace(SEGNAPOSTO, (_intero, chiave: string) => {
    const valore = variabili[chiave]?.trim();
    if (!valore) {
      mancanti.add(chiave);
      return `{{${chiave}}}`;
    }
    return valore;
  });
  return { testo: risolto, mancanti: [...mancanti] };
}

export function variabiliMancantiNeiTesti(testi: string[]): string[] {
  const mancanti = new Set<string>();
  for (const testo of testi) {
    for (const match of testo.matchAll(SEGNAPOSTO)) mancanti.add(match[1]);
  }
  return [...mancanti];
}
