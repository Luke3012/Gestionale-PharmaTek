/**
 * Utility condivise per il parsing strutturato, il confronto e la normalizzazione
 * di indirizzi italiani. Usate sia dalla deduplicazione anagrafiche sia dall'unione
 * spedizioni.
 *
 * Supporta la somiglianza toponomastica (es. "VIA ANGELO POLIZIANO 60" vs "Via Poliziano, 60"),
 * estraendo comune, CAP, numero civico rigoroso e toponimo fondamentale per unire colli
 * o anagrafiche destinate allo stesso esatto edificio, impedendo categoricamente l'unione di
 * civici differenti (es. "Via della Fonte 38" vs "Via della Fonte 6 c/o Stadio del Nuoto").
 */

export interface DatiIndirizzoConfronto {
  indirizzo?: string;
  cap?: string;
  citta?: string;
  prov?: string;
}

/** Rimuove accenti, uniforma gli spazi e converte in maiuscolo. */
export function testoConfronto(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** Normalizza una stringa indirizzo rimuovendo punteggiatura e spazi ridondanti. */
export function normalizzaIndirizzo(s: string): string {
  return testoConfronto(s)
    .replace(/[.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalizza il CAP a 5 cifre gestendo anche float (es. 96100.0). */
export function pulisciCap(c: string): string {
  let s = c.trim().split(".")[0];
  s = s.replace(/\D/g, "");
  if (s.length > 0) {
    return s.padStart(5, "0").slice(-5);
  }
  return "";
}

/**
 * Calcola la distanza di Levenshtein tra due stringhe per gestire lievi refusi nei toponimi.
 */
function distanzaLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function tokenCompatibile(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 6 && b.length >= 6 && distanzaLevenshtein(a, b) <= 1) return true;
  return false;
}

/**
 * Pulisce clausole accessorie come c/o, presso, scala, piano, interno, ecc.
 */
function pulisciDettagliAccessori(s: string): string {
  return s
    .replace(/\b(?:C\/O|C\.O\.|C\s*\/\s*O|PRESSO)\b.*$/i, " ")
    .replace(/\b(?:SCALA|SC|PIANO|P|INT|INTERNO|PAL|PALAZZINA|EDIFICIO|LOTTO|ISOLA|IS|BOX|CAPANNONE)\b.*$/i, " ")
    .trim();
}

/**
 * Estrae il numero civico e la sua base numerica da una stringa indirizzo.
 * Esempi:
 *  - "VIA ANGELO POLIZIANO 60"                      -> { civico: "60", numeroBase: "60" }
 *  - "Via Poliziano, 60"                             -> { civico: "60", numeroBase: "60" }
 *  - "Via della Fonte, 38"                           -> { civico: "38", numeroBase: "38" }
 *  - "Via della fonte 6 c/o Stadio del Nuoto"        -> { civico: "6", numeroBase: "6" }
 *  - "Via Roma 10/A"                                 -> { civico: "10/A", numeroBase: "10" }
 *  - "C.da Cerreto SNC"                              -> { civico: "SNC", numeroBase: "SNC" }
 */
export function estraiCivico(indirizzo: string): { civico: string; numeroBase: string } {
  if (!indirizzo) return { civico: "", numeroBase: "" };
  const s = pulisciDettagliAccessori(testoConfronto(indirizzo));

  if (/\b(?:SNC|S\.N\.C\.|SENZA\s+NUMERO|SENZA\s+CIVICO)\b/i.test(s)) {
    return { civico: "SNC", numeroBase: "SNC" };
  }

  // 1. Cerca con prefisso esplicito "N.", "N", "CIVICO", "NUMERO"
  const matchPrefisso = s.match(/\b(?:N|NRO|NUMERO|CIVICO)\.?\s*(\d+)\s*([A-Z]|\/[A-Z0-9]+)?\b/i);
  if (matchPrefisso) {
    const numeroBase = matchPrefisso[1];
    const intero = (numeroBase + (matchPrefisso[2] || "")).trim();
    return { civico: intero, numeroBase };
  }

  // 2. Se c'è una virgola, cerca numero subito dopo la virgola (es. "Via della Fonte, 38")
  const partiVirgola = s.split(",");
  if (partiVirgola.length > 1) {
    for (let i = partiVirgola.length - 1; i >= 1; i--) {
      const matchVirgola = partiVirgola[i].trim().match(/^(\d+)\s*([A-Z]|\/[A-Z0-9]+)?\b/i);
      if (matchVirgola) {
        const numeroBase = matchVirgola[1];
        const intero = (numeroBase + (matchVirgola[2] || "")).trim();
        return { civico: intero, numeroBase };
      }
    }
  }

  // 3. Cerca numero a fine stringa (es. "Via della fonte 6", "VIA ANGELO POLIZIANO 60")
  const matchFine = s.match(/\b(\d+)\s*([A-Z]|\/[A-Z0-9]+)?\s*$/i);
  if (matchFine) {
    const numeroBase = matchFine[1];
    const intero = (numeroBase + (matchFine[2] || "")).trim();
    return { civico: intero, numeroBase };
  }

  return { civico: "", numeroBase: "" };
}

/**
 * Estrae l'odonomastico (nome della via pulito da prefissi di specie, civico, articoli, iniziali).
 */
export function estraiOdonomastico(indirizzo: string): {
  specie: string;
  base: string;
  tokens: string[];
  coreToken: string;
} {
  if (!indirizzo) return { specie: "", base: "", tokens: [], coreToken: "" };
  let s = pulisciDettagliAccessori(testoConfronto(indirizzo))
    .replace(/[.,;:/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Estrae e rimuove la specie iniziale (VIA, VIALE, CORSO, PIAZZA, ecc.)
  let specie = "";
  const matchSpecie = s.match(
    /^(VIA|VIALE|VICOLO|VICO|PIAZZA|PZA|PZZA|PIAZZALE|PLE|CORSO|CSO|LARGO|LGO|STRADA|STRADONE|TRAVERSA|TRAV|CONTRADA|CDA|LOCALITA|LOC|FRAZIONE|FRAZ|BORGO|BGO|GALLERIA)\b/i
  );
  if (matchSpecie) {
    specie = matchSpecie[1].toUpperCase();
    s = s.slice(matchSpecie[0].length).trim();
  }

  // Rimuove civico con prefisso
  s = s.replace(/\b(?:N|NRO|NUMERO|CIVICO)\s*\d+[A-Z]?(?:\/[A-Z0-9]+)?\b/gi, " ");
  s = s.replace(/\b(?:SNC|S\.N\.C\.|SENZA\s+NUMERO|SENZA\s+CIVICO)\b/gi, " ");

  // Rimuove l'ultimo numero se a fine stringa (civico)
  s = s.replace(/\b\d+[A-Z]?(?:\/[A-Z0-9]+)?\s*$/i, " ").trim();

  // Rimuove articoli, preposizioni, onorificenze e iniziali singole
  const parole = s
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(?:DEI|DELLE|DEGLI|DEL|DELLO|DELLA|DI|DA|IN|D|SAN|SANTA|SANT|S|DON|PADRE|FRATE|DOTT|PROF|ING|AVV|COMM|CAV)$/i.test(w))
    .filter((w) => !/^[A-Z]$/i.test(w)); // esclude iniziali singole

  const base = parole.join(" ");
  const coreToken = parole.length > 0 ? parole[parole.length - 1] : "";

  return { specie, base, tokens: parole, coreToken };
}

/**
 * Verifica se due indirizzi sono compatibili / corrispondenti alla stessa destinazione fisica.
 * Regole rigorose:
 * 1. Stessa località geografica: se entrambe hanno città devono coincidere; se entrambi hanno CAP
 *    devono coincidere. Almeno un riferimento geografico (città o CAP) deve essere presente e compatibile.
 * 2. Stesso numero civico obbligatorio: 38 e 6 non possono MAI essere uniti.
 * 3. Stessa specie (Via vs Piazza) e stesso toponimo (es. "Angelo Poliziano" compatibile con "Poliziano").
 */
export function sonoIndirizziCompatibili(
  a: DatiIndirizzoConfronto,
  b: DatiIndirizzoConfronto
): boolean {
  if (!a.indirizzo?.trim() || !b.indirizzo?.trim()) return false;

  const aCitta = testoConfronto(a.citta || "");
  const bCitta = testoConfronto(b.citta || "");
  const aCap = pulisciCap(a.cap || "");
  const bCap = pulisciCap(b.cap || "");

  // Se entrambe hanno il CAP e non coincidono, non sono compatibili
  if (aCap && bCap && aCap !== bCap) return false;

  // Se entrambe hanno la città e non coincidono, non sono compatibili
  if (aCitta && bCitta && aCitta !== bCitta && !aCitta.includes(bCitta) && !bCitta.includes(aCitta)) {
    return false;
  }

  // Almeno un riferimento geografico compatibile deve essere presente (stessa città o stesso CAP)
  const haRiferimentoGeografico = (aCitta && bCitta) || (aCap && bCap);
  if (!haRiferimentoGeografico) return false;

  const civicoA = estraiCivico(a.indirizzo);
  const civicoB = estraiCivico(b.indirizzo);

  // Il civico è FONDAMENTALE per l'unione:
  // Se almeno uno ha un numero civico, entrambi DEVONO averlo e deve coincidere esattamente (base numerica).
  // Es: 38 vs 6 -> FALSE categorico!
  if (civicoA.numeroBase || civicoB.numeroBase) {
    if (!civicoA.numeroBase || !civicoB.numeroBase || civicoA.numeroBase !== civicoB.numeroBase) {
      return false;
    }
  }

  const odoA = estraiOdonomastico(a.indirizzo);
  const odoB = estraiOdonomastico(b.indirizzo);

  if (!odoA.tokens.length || !odoB.tokens.length) {
    const baseA = normalizzaIndirizzo(a.indirizzo);
    const baseB = normalizzaIndirizzo(b.indirizzo);
    return !!(baseA && baseB && (baseA.includes(baseB) || baseB.includes(baseA)));
  }

  // Se i tipi di specie sono entrambi indicati ed esplicitamente diversi (es. VIA vs PIAZZA)
  if (odoA.specie && odoB.specie && odoA.specie !== odoB.specie) {
    return false;
  }

  // Se c'è un numero nel nome della via (es. 24 Maggio vs 1 Maggio), deve coincidere
  const numeriA = odoA.tokens.filter((t) => /^\d+$/.test(t));
  const numeriB = odoB.tokens.filter((t) => /^\d+$/.test(t));
  if (numeriA.length > 0 && numeriB.length > 0 && numeriA[0] !== numeriB[0]) {
    return false;
  }

  // 1. Uguaglianza toponimo base
  if (odoA.base === odoB.base) {
    return true;
  }

  // 2. Se una base contiene l'altra come parole complete (es. "ANGELO POLIZIANO" contiene "POLIZIANO")
  if (odoA.base && odoB.base) {
    const regexA = new RegExp(`\\b${odoB.base}\\b`);
    const regexB = new RegExp(`\\b${odoA.base}\\b`);
    if (regexA.test(odoA.base) || regexB.test(odoB.base)) {
      return true;
    }
  }

  // 3. Se tutti i token del toponimo più corto sono presenti nel toponimo più lungo
  // (es. "A. POLIZIANO" -> ["POLIZIANO"] presente in ["ANGELO", "POLIZIANO"])
  const [corto, lungo] = odoA.tokens.length <= odoB.tokens.length ? [odoA.tokens, odoB.tokens] : [odoB.tokens, odoA.tokens];
  const tuttiPresenti = corto.every((cTok) =>
    lungo.some((lTok) => tokenCompatibile(cTok, lTok))
  );

  return tuttiPresenti;
}

/**
 * Confronto semplificato solo tra stringhe di indirizzo (senza cap/città/prov).
 * Usa il parsing strutturato del civico per evitare falsi positivi.
 * Usata come gate nella deduplicazione quando il luogo è già verificato separatamente.
 */
export function indirizzoStrutturatoCompatibile(a: string, b: string): boolean {
  const A = normalizzaIndirizzo(a);
  const B = normalizzaIndirizzo(b);
  if (!A || !B) return true; // se uno è vuoto, non bloccante
  if (A === B) return true;

  // Gate civico: se entrambi hanno un civico e non coincide, incompatibili
  const civicoA = estraiCivico(a);
  const civicoB = estraiCivico(b);
  if (civicoA.numeroBase && civicoB.numeroBase && civicoA.numeroBase !== civicoB.numeroBase) {
    return false;
  }

  // Contenimento diretto (gestisce abbreviazioni semplici)
  if (A.includes(B) || B.includes(A)) return true;

  // Confronto odonomastico strutturato
  const odoA = estraiOdonomastico(a);
  const odoB = estraiOdonomastico(b);

  if (!odoA.tokens.length || !odoB.tokens.length) return true;

  // Specie diverse → incompatibili
  if (odoA.specie && odoB.specie && odoA.specie !== odoB.specie) return false;

  // Numeri nel toponimo devono coincidere (es. 24 Maggio vs 1 Maggio)
  const numeriA = odoA.tokens.filter((t) => /^\d+$/.test(t));
  const numeriB = odoB.tokens.filter((t) => /^\d+$/.test(t));
  if (numeriA.length > 0 && numeriB.length > 0 && numeriA[0] !== numeriB[0]) return false;

  // Token overlap
  if (odoA.base === odoB.base) return true;

  if (odoA.base && odoB.base) {
    const regexA = new RegExp(`\\b${odoB.base}\\b`);
    const regexB = new RegExp(`\\b${odoA.base}\\b`);
    if (regexA.test(odoA.base) || regexB.test(odoB.base)) return true;
  }

  const [corto, lungo] = odoA.tokens.length <= odoB.tokens.length ? [odoA.tokens, odoB.tokens] : [odoB.tokens, odoA.tokens];
  return corto.every((cTok) => lungo.some((lTok) => tokenCompatibile(cTok, lTok)));
}
