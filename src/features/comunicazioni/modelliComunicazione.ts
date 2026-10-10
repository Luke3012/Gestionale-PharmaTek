const SEGNAPOSTO = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

export interface SelezioneTestoModello {
  inizio: number;
  fine: number;
}

/** Senza una selezione precedente, il dato viene inserito alla fine. */
export function inserisciDatoModello(
  testo: string,
  chiave: string,
  selezione: SelezioneTestoModello | null,
): { testo: string; cursore: number } {
  const inizio = Math.max(0, Math.min(selezione?.inizio ?? testo.length, testo.length));
  const fine = Math.max(inizio, Math.min(selezione?.fine ?? inizio, testo.length));
  const dato = `{{${chiave}}}`;
  return {
    testo: testo.slice(0, inizio) + dato + testo.slice(fine),
    cursore: inizio + dato.length,
  };
}

/** Rende nuovamente il modello solo se l'operatore non ha modificato il testo. */
export function aggiornaTestoModelloNonModificato(
  corrente: string,
  modello: string,
  precedenti: Record<string, string>,
  aggiornate: Record<string, string>,
): string {
  return corrente === risolviModello(modello, precedenti).testo
    ? risolviModello(modello, aggiornate).testo
    : corrente;
}

export function risolviModello(
  testo: string,
  variabili: Record<string, string>,
): { testo: string; mancanti: string[] } {
  const mancanti = new Set<string>();
  const risolto = testo.replace(SEGNAPOSTO, (_intero, chiave: string) => {
    const valore = variabili[chiave]?.trim();
    if (chiave === "indirizzo_consegna" && variabili[chiave] === "") return "";
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
