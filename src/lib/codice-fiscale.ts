// Calcolo e validazione del Codice Fiscale italiano (persone fisiche).
// Algoritmo standard: consonanti/vocali cognome-nome, codifica data,
// codice Belfiore del comune di nascita, carattere di controllo.
// Gestisce l'omocodia (sostituzione cifre → lettere).
// Offline, nessuna dipendenza di rete.

import { BELFIORE } from "../data/belfiore";

// ── Tabelle dell'algoritmo ──────────────────────────────────────────

const MESI = "ABCDEHLMPRST"; // A=gen … T=dic

/** Valori per le posizioni dispari (1,3,5…15) nel calcolo del check char. */
const DISPARI: Record<string, number> = {
  "0": 1,  "1": 0,  "2": 5,  "3": 7,  "4": 9,
  "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1,  B: 0,  C: 5,  D: 7,  E: 9,
  F: 13, G: 15, H: 17, I: 19, J: 21,
  K: 2,  L: 4,  M: 18, N: 20, O: 11,
  P: 3,  Q: 6,  R: 8,  S: 12, T: 14,
  U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

/** Valori per le posizioni pari (2,4,6…14). */
const PARI: Record<string, number> = {
  "0": 0,  "1": 1,  "2": 2,  "3": 3,  "4": 4,
  "5": 5,  "6": 6,  "7": 7,  "8": 8,  "9": 9,
  A: 0,  B: 1,  C: 2,  D: 3,  E: 4,
  F: 5,  G: 6,  H: 7,  I: 8,  J: 9,
  K: 10, L: 11, M: 12, N: 13, O: 14,
  P: 15, Q: 16, R: 17, S: 18, T: 19,
  U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
};

/** Lettere usate per la sostituzione omocodia (cifra 0–9 → lettera). */
const OMOCODIA_CIFRA_A_LETTERA = "LMNPQRSTUV";

/** Posizioni nel CF (0-indexed) dove può avvenire la sostituzione omocodia: 6,7,9,10,12,13,14. */
const OMOCODIA_POS = [6, 7, 9, 10, 12, 13, 14];

// ── Utility ─────────────────────────────────────────────────────────

function soloConsonanti(s: string): string {
  return s.replace(/[^BCDFGHJKLMNPQRSTVWXYZ]/g, "");
}

function soloVocali(s: string): string {
  return s.replace(/[^AEIOU]/g, "");
}

/** Normalizza un nome/cognome: uppercase, rimuove diacritici, solo lettere. */
function normalizza(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

/** Normalizza il nome di un comune per il lookup Belfiore (lowercase, senza diacritici). */
function normalizzaComune(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// ── Codifica parti del CF ───────────────────────────────────────────

function codificaCognome(cognome: string): string {
  const n = normalizza(cognome);
  const consonanti = soloConsonanti(n);
  const vocali = soloVocali(n);
  return (consonanti + vocali + "XXX").slice(0, 3);
}

function codificaNome(nome: string): string {
  const n = normalizza(nome);
  const consonanti = soloConsonanti(n);
  const vocali = soloVocali(n);
  // Se il nome ha ≥4 consonanti, si prendono la 1ª, 3ª e 4ª.
  if (consonanti.length >= 4) {
    return consonanti[0] + consonanti[2] + consonanti[3];
  }
  return (consonanti + vocali + "XXX").slice(0, 3);
}

function codificaData(data: Date, sesso: "M" | "F"): string {
  const anno = String(data.getFullYear()).slice(-2);
  const mese = MESI[data.getMonth()];
  let giorno = data.getDate();
  if (sesso === "F") giorno += 40;
  return anno + mese + String(giorno).padStart(2, "0");
}

function carattereControllo(primi15: string): string {
  let somma = 0;
  for (let i = 0; i < 15; i++) {
    const c = primi15[i];
    // Posizioni 1-indexed: dispari = i pari (0-indexed), pari = i dispari.
    somma += i % 2 === 0 ? (DISPARI[c] ?? 0) : (PARI[c] ?? 0);
  }
  return String.fromCharCode(65 + (somma % 26)); // A=0 … Z=25
}

// ── API pubblica ────────────────────────────────────────────────────

export interface InputCF {
  nome: string;
  cognome: string;
  dataNascita: Date;
  sesso: "M" | "F";
  comuneNascita: string;
}

export interface RisultatoCF {
  cf: string;
  /** Se il comune non è stato trovato nel dataset Belfiore. */
  comuneNonTrovato?: boolean;
}

/**
 * Calcola il Codice Fiscale da dati anagrafici.
 * Restituisce `null` se manca il codice Belfiore del comune.
 */
export function calcolaCodiceFiscale(input: InputCF): RisultatoCF | null {
  const { nome, cognome, dataNascita, sesso, comuneNascita } = input;
  if (!nome || !cognome || !dataNascita || !sesso || !comuneNascita) return null;

  const parteCognome = codificaCognome(cognome);
  const parteNome = codificaNome(nome);
  const parteData = codificaData(dataNascita, sesso);

  const chiaveComune = normalizzaComune(comuneNascita);
  const codiceBelfiore = BELFIORE[chiaveComune];
  if (!codiceBelfiore) {
    return { cf: "", comuneNonTrovato: true };
  }

  const primi15 = parteCognome + parteNome + parteData + codiceBelfiore;
  const check = carattereControllo(primi15);

  return { cf: primi15 + check };
}

// ── Validazione ─────────────────────────────────────────────────────

export interface RisultatoValidazione {
  valido: boolean;
  tipo?: "persona_fisica" | "partita_iva";
  errore?: string;
}

/**
 * Denormalizza un CF con omocodia: riporta le eventuali lettere
 * sostitutive alle cifre originali, per poter validare il check char.
 */
function denormalizzaOmocodia(cf: string): string {
  const chars = cf.toUpperCase().split("");
  for (const pos of OMOCODIA_POS) {
    const c = chars[pos];
    const idx = OMOCODIA_CIFRA_A_LETTERA.indexOf(c);
    if (idx !== -1) chars[pos] = String(idx);
  }
  return chars.join("");
}

/**
 * Valida un Codice Fiscale / Partita IVA.
 * - CF persona fisica: 16 caratteri alfanumerici con check char corretto.
 * - P.IVA: 11 cifre (validazione strutturale, non Luhn).
 */
export function validaCodiceFiscale(cf: string): RisultatoValidazione {
  const s = cf.trim().toUpperCase();

  if (!s) return { valido: false, errore: "Campo vuoto." };

  // P.IVA: 11 cifre
  if (/^\d{11}$/.test(s)) {
    return { valido: true, tipo: "partita_iva" };
  }

  // CF persona fisica: 16 alfanumerici
  if (!/^[A-Z0-9]{16}$/.test(s)) {
    return {
      valido: false,
      errore: `Lunghezza o caratteri non validi (${s.length} car.).`,
    };
  }

  // Denormalizza eventuali sostituzioni omocodia prima di calcolare il check.
  const denorm = denormalizzaOmocodia(s);
  const checkCalcolato = carattereControllo(denorm.slice(0, 15));
  if (denorm[15] !== checkCalcolato) {
    return { valido: false, errore: "Carattere di controllo errato." };
  }

  return { valido: true, tipo: "persona_fisica" };
}
