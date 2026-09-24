// Lookup bidirezionale CAP ↔ comune/provincia/regione.
// Usa il dataset bundlato in cap-db.ts (offline, nessuna rete).
// Espone ricerche per CAP → indirizzo e per nome città → CAP/indirizzo.

import { CAP_TO_COMUNI, COMUNE_TO_INFO, type ComuneInfo } from "../data/cap-db";

export type { ComuneInfo } from "../data/cap-db";

export interface RisultatoCAP {
  /** Match univoco: un solo comune per quel CAP. */
  univoco: boolean;
  /** Lista comuni corrispondenti (1 se univoco, N se ambiguo, 0 se ignoto). */
  comuni: ComuneInfo[];
}

/**
 * Cerca i comuni corrispondenti a un CAP (5 cifre).
 * - Se il CAP non è nel dataset → `null` (nessun blocco, l'utente può scrivere quello che vuole).
 * - Se match univoco → `{ univoco: true, comuni: [info] }`.
 * - Se match multiplo → `{ univoco: false, comuni: [...] }` (suggerimenti).
 */
export function cercaPerCAP(cap: string): RisultatoCAP | null {
  if (!/^\d{5}$/.test(cap)) return null;
  const comuni = CAP_TO_COMUNI[cap];
  if (!comuni || comuni.length === 0) return null;
  return {
    univoco: comuni.length === 1,
    comuni,
  };
}

/**
 * Distingue un CAP ancora incompleto (`undefined`) da uno completo ma ignoto (`null`).
 * I form usano questa differenza per chiudere i suggerimenti soltanto mentre si digita.
 */
export function cercaCAPDigitato(cap: string): RisultatoCAP | null | undefined {
  return /^\d{5}$/.test(cap) ? cercaPerCAP(cap) : undefined;
}

/**
 * Cerca comuni il cui nome inizia con o contiene la query (case-insensitive).
 * Restituisce max `limite` risultati, ordinati per rilevanza:
 * 1. Nomi che iniziano con la query (priorità)
 * 2. Nomi che contengono la query
 * Dentro ogni gruppo, ordine alfabetico.
 */
function cercaPerCitta(query: string, limite = 10): ComuneInfo[] {
  const q = query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (q.length < 2) return [];

  const iniziaCon: ComuneInfo[] = [];
  const contiene: ComuneInfo[] = [];

  for (const [chiave, info] of Object.entries(COMUNE_TO_INFO)) {
    if (chiave.startsWith(q)) {
      iniziaCon.push(info);
    } else if (chiave.includes(q)) {
      contiene.push(info);
    }
    // Ottimizzazione: se abbiamo già abbastanza risultati "inizia con", saltiamo.
    if (iniziaCon.length >= limite) break;
  }

  // Ordina alfabeticamente dentro ogni gruppo.
  const ordina = (a: ComuneInfo, b: ComuneInfo) => a.nome.localeCompare(b.nome, "it");
  iniziaCon.sort(ordina);
  contiene.sort(ordina);

  return [...iniziaCon, ...contiene].slice(0, limite);
}

/** Etichette condivise dagli autocomplete città. */
export function nomiCittaSuggeriti(query: string, limite = 10): string[] {
  return cercaPerCitta(query, limite).map((comune) => comune.nome);
}

/** Mantiene la stessa risoluzione usata alla selezione di un suggerimento. */
export function cercaCittaSelezionata(nome: string): ComuneInfo | undefined {
  return cercaPerCitta(nome, 1).find(
    (comune) => comune.nome.toLowerCase() === nome.toLowerCase(),
  );
}

/**
 * Dato un nome di comune esatto (case-insensitive), restituisce le info complete.
 */
export function infoCitta(nome: string): ComuneInfo | null {
  const chiave = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return COMUNE_TO_INFO[chiave] ?? null;
}
