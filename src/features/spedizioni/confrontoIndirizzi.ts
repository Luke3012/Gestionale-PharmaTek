/**
 * Utility per il confronto, la normalizzazione e l'aggregazione di indirizzi
 * e note di spedizione in «Crea spedizione» ed «Effettuate».
 *
 * Le funzioni di parsing strutturato (estrazione civico, odonomastico, confronto
 * rigoroso) sono nel modulo condiviso `indirizzoUtils` e vengono re-esportate qui
 * per compatibilità con tutti i consumer esistenti.
 */
import {
  type DatiIndirizzoConfronto,
  estraiCivico,
  estraiOdonomastico,
  sonoIndirizziCompatibili,
  normalizzaIndirizzo,
  pulisciCap,
  testoConfronto,
} from "../anagrafiche/indirizzoUtils";

export {
  type DatiIndirizzoConfronto,
  estraiCivico,
  estraiOdonomastico,
  sonoIndirizziCompatibili,
  normalizzaIndirizzo,
  pulisciCap,
  testoConfronto,
};

/**
 * Genera una chiave canonica di confronto per un indirizzo di spedizione.
 * Indirizzi equivalenti allo stesso civico (es. "VIA ANGELO POLIZIANO 60" e "Via Poliziano, 60")
 * producono la medesima chiave canonica, mentre civici diversi (es. 38 e 6) generano chiavi distinte.
 */
export function chiaveIndirizzoConfronto(dati: DatiIndirizzoConfronto): string {
  const citta = testoConfronto(dati.citta || "");
  if (!citta || !dati.indirizzo?.trim()) return "";

  const cap = pulisciCap(dati.cap || "");
  const { numeroBase } = estraiCivico(dati.indirizzo);
  const { coreToken } = estraiOdonomastico(dati.indirizzo);

  if (!coreToken) {
    return `${citta}|${cap}|${testoConfronto(dati.indirizzo)}`;
  }

  return `${citta}|${cap}|civ:${numeroBase}|${coreToken}`;
}

/**
 * Raggruppa una lista di elementi per indirizzo compatibile (clustering di somiglianza).
 */
export function raggruppaPerIndirizzoCompatibile<T>(
  items: T[],
  getDati: (item: T) => DatiIndirizzoConfronto
): T[][] {
  const gruppi: { sample: DatiIndirizzoConfronto; items: T[] }[] = [];

  for (const item of items) {
    const dati = getDati(item);
    if (!dati.indirizzo?.trim() || !dati.citta?.trim()) continue;

    let trovato = false;
    for (const g of gruppi) {
      if (sonoIndirizziCompatibili(dati, g.sample)) {
        g.items.push(item);
        if ((dati.indirizzo || "").length > (g.sample.indirizzo || "").length) {
          g.sample = dati;
        }
        trovato = true;
        break;
      }
    }

    if (!trovato) {
      gruppi.push({ sample: dati, items: [item] });
    }
  }

  return gruppi.map((g) => g.items);
}

/**
 * Unisce una lista di note di spedizione rimuovendo testi vuoti e duplicati.
 */
export function unisciNoteSpedizione(noteList: (string | undefined | null)[]): string {
  const noteUniche: string[] = [];
  const visti = new Set<string>();

  for (const raw of noteList) {
    const nota = (raw || "").trim();
    if (!nota) continue;
    const chiave = testoConfronto(nota);
    if (!visti.has(chiave)) {
      visti.add(chiave);
      noteUniche.push(nota);
    }
  }

  return noteUniche.join(" - ");
}

/**
 * Restituisce una rappresentazione sintetica dell'indirizzo su riga singola: «Via Roma 12 · 81034 Mondragone (CE)».
 */
export function formattaIndirizzoSintetico(dati: DatiIndirizzoConfronto): string {
  const parteVia = (dati.indirizzo || "").trim();
  const parteCitta = [pulisciCap(dati.cap || "") || (dati.cap || "").trim(), (dati.citta || "").trim()]
    .filter(Boolean)
    .join(" ");
  const provTrim = (dati.prov || "").trim();
  const parteProv = provTrim ? `(${provTrim})` : "";
  const luogo = [parteCitta, parteProv].filter(Boolean).join(" ");

  return [parteVia, luogo].filter(Boolean).join(" · ") || "Indirizzo mancante";
}
