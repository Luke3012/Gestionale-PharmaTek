// Profili di esportazione "distinta corriere" (FASE 4B): CORRIERE_B e CORRIERE_A come due profili
// di DEFAULT dell'applicativo. Le colonne seguono il vecchio "File GENERALE"
// (macro GeneraListe); l'aggregazione dei colli è definita per ciascun profilo:
// - CORRIERE_A = colonne A:M (Data Fattura · Num fattura · Cliente · Ind Dest · Cap · Città ·
//   Provincia · REGIONE · Colli · Peso · telefono · € · NOTE).
// - CORRIERE_B = le stesse + N "E-mail" + O "Servizi" (costante "31,25"); numero senza suffisso.
// La colonna € resta vuota se prepagato (solo contrassegno/assegno la valorizzano).
// La colonna NOTE compone: PREAVVISO TELEFONICO <tel> (se preavviso) + note di spedizione
// + "PAGAMENTO IN ASSEGNO" (se assegno).
import type { Spedizione } from "../../lib/tauri";
import type { ColonnaExport } from "../../ui/esporta/EsportaTabella";
import { raggruppaPerIndirizzoCompatibile, unisciNoteSpedizione } from "./confrontoIndirizzi";

/** Riga "piatta" della distinta corriere, costruita da una spedizione (collo). */
export interface RigaCorriere {
  data: string; // ISO yyyy-mm-dd (la colonna "data" la formatta in gg/mm/aaaa)
  numero: string;
  cliente: string;
  indirizzo: string;
  cap: string;
  citta: string;
  prov: string;
  regione: string;
  colli: number;
  peso: number;
  telefono: string;
  importo: number | ""; // centesimi se contrassegno/assegno, "" se prepagato (cella vuota)
  note: string;
  email: string;
  preavvisoTel: string; // telefono se è richiesto il preavviso (colonna dedicata CORRIERE_C), altrimenti ""
}

export function formattaNumeriLottoPerExport(numero: string): string {
  const lotti = String(numero || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((valore) => valore.trim())
    .filter(Boolean);
  const univoci = Array.from(new Set(lotti));
  univoci.sort((a, b) => a.localeCompare(b, "it", { numeric: true, sensitivity: "base" }));
  return univoci.join(" + ");
}

/** Regola unica colli/peso del profilo. CORRIERE_A richiede sempre 1/1, anche
 * quando la spedizione contiene più persone o più vaccini. */
export function normalizzaColliPesoCorriere(
  profilo: string,
  colli: number,
  peso: number = colli
): { colli: number; peso: number } {
  if (profilo === "corriere_a") return { colli: 1, peso: 1 };
  return { colli: Math.max(1, colli), peso: Math.max(1, peso) };
}

/** Costruisce la riga della distinta da una spedizione effettuata. */
export function rigaCorriere(s: Spedizione): RigaCorriere {
  const preavviso = s.preavviso
    ? `PREAVVISO TELEFONICO${s.telefono ? ` ${s.telefono}` : ""}`
    : "";
  const note = [preavviso, s.note, s.mezzo === "assegno" ? "PAGAMENTO IN ASSEGNO" : ""]
    .filter(Boolean)
    .join(" - ");
  return {
    data: s.data,
    numero: s.numero,
    cliente: s.clienteNome,
    indirizzo: s.indirizzo,
    cap: s.cap,
    citta: s.citta,
    prov: s.prov,
    regione: s.regione,
    colli: 1,
    peso: 1,
    telefono: s.telefono,
    importo: s.mezzo ? s.contrassegno : "",
    note,
    email: s.email,
    preavvisoTel: s.preavviso ? s.telefono : "",
  };
}

/** Estrae tutti i numeri lotto della spedizione: da s.righe (se presenti) o da s.numero,
 * deduplicati e ordinati naturalmente in senso crescente. */
function estraiNumeriLottoSpedizione(s: Spedizione): string[] {
  const estrai = (valori: string[]): string[] =>
    valori.flatMap((item) =>
      String(item || "")
        .replace(/\r/g, "")
        .split("\n")
        .map((val) => val.trim())
        .filter(Boolean)
    );

  let lotti: string[] = [];
  if (s.righe && s.righe.length > 0) {
    lotti = estrai(s.righe.map((riga) => riga.numero));
  }
  if (lotti.length === 0) {
    lotti = estrai([s.numero]);
  }
  const univoci = Array.from(new Set(lotti));
  univoci.sort((a, b) => a.localeCompare(b, "it", { numeric: true, sensitivity: "base" }));
  return univoci;
}

/** Prepara le righe per la distinta CORRIERE_A: 1 riga per ogni collo/spedizione presente
 * nel gestionale, con tutti i lotti del collo uniti con " + " e ordinati in modo naturale,
 * senza separare per paziente. Colli e peso sono sempre impostati a 1. */
function preparaRigheCorriereA(spedizioni: Spedizione[]): RigaCorriere[] {
  return spedizioni.map((s) => {
    const riga = rigaCorriere(s);
    riga.colli = 1;
    riga.peso = 1;
    const lotti = estraiNumeriLottoSpedizione(s);
    riga.numero = lotti.join(" + ");
    return riga;
  });
}

/** Stessa compressione dei numeri usata dalla vista Effettuate per un collo. */
function comprimiNumeriLotto(numeri: string[]): string {
  const lotti = numeri.flatMap((numero) =>
    String(numero || "").replace(/\r/g, "").split("\n").map((valore) => valore.trim()).filter(Boolean)
  );
  if (lotti.length < 2) return lotti[0] ?? "";
  let prefisso = lotti[0];
  for (const lotto of lotti.slice(1)) {
    let i = 0;
    while (i < prefisso.length && i < lotto.length && prefisso[i] === lotto[i]) i++;
    prefisso = prefisso.slice(0, i);
  }
  return lotti[0] + lotti.slice(1).map((lotto) => `/${prefisso && lotto.length > prefisso.length ? lotto.slice(prefisso.length) : lotto}`).join("");
}

function numeriNonCompressi(s: Spedizione): string[] {
  const numeri = s.righe.flatMap((riga) =>
    String(riga.numero || "").replace(/\r/g, "").split("\n").map((valore) => valore.trim()).filter(Boolean)
  );
  return numeri.length > 0 ? numeri : [s.numero];
}

/** Combina solo le spedizioni selezionate dello stesso corriere, giorno e indirizzo.
 * Senza indirizzo completo, ogni collo resta una riga autonoma. */
function preparaRigheGlsMbe(spedizioni: Spedizione[]): RigaCorriere[] {
  const perGiornoCorriere = new Map<string, Spedizione[]>();
  for (const s of spedizioni) {
    const key = JSON.stringify([s.data, s.corriereId || s.corriereNome]);
    const gruppo = perGiornoCorriere.get(key) ?? [];
    gruppo.push(s);
    perGiornoCorriere.set(key, gruppo);
  }

  const perIndirizzo = new Map<Spedizione, Spedizione[]>();
  for (const spedizioniCorriere of perGiornoCorriere.values()) {
    for (const gruppo of raggruppaPerIndirizzoCompatibile(spedizioniCorriere, (s) => s)) {
      for (const s of gruppo) perIndirizzo.set(s, gruppo);
    }
  }

  const viste = new Set<Spedizione>();
  const righe: RigaCorriere[] = [];
  for (const s of spedizioni) {
    if (viste.has(s)) continue;
    const gruppo = perIndirizzo.get(s) ?? [s];
    gruppo.forEach((collo) => viste.add(collo));
    const riga = rigaCorriere(s);
    riga.colli = gruppo.reduce((somma, collo) => somma + Math.max(1, collo.colli || 0), 0);
    riga.peso = gruppo.reduce((somma, collo) => somma + Math.max(1, collo.peso || 0), 0);
    if (gruppo.length > 1) {
      riga.numero = comprimiNumeriLotto(gruppo.flatMap(numeriNonCompressi));
      riga.importo = gruppo.some((collo) => !!collo.mezzo)
        ? gruppo.reduce((somma, collo) => somma + (collo.mezzo ? collo.contrassegno : 0), 0)
        : "";
      riga.note = unisciNoteSpedizione(gruppo.map((collo) => rigaCorriere(collo).note));
      riga.telefono = gruppo.map((collo) => collo.telefono).find(Boolean) ?? "";
      riga.email = gruppo.map((collo) => collo.email).find(Boolean) ?? "";
      riga.preavvisoTel = gruppo.find((collo) => collo.preavviso && collo.telefono)?.telefono ?? "";
    }
    righe.push(riga);
  }
  return righe;
}

/** Prepara l'elenco delle righe per l'esportazione:
 *  - CORRIERE_B ed CORRIERE_C: una riga per indirizzo compatibile dello stesso giorno/corriere,
 *    con numeri compressi usando "/" come nella vista Effettuate.
 *  - CORRIERE_A: una riga per collo/spedizione del gestionale; tutti i vaccini del collo condividono la
 *    cella numero uniti con " + " in ordine naturale (es. `5081997 + 5081998 + 5081999`),
 *    senza separazione per paziente. Se i numeri mancano, la riga resta presente con cella vuota.
 *  Per CORRIERE_A colli e peso sono sempre 1; CORRIERE_B/CORRIERE_C conservano o sommano i valori dei colli.
 */
export function preparaRigheEsportazione(spedizioni: Spedizione[], profilo: string): RigaCorriere[] {
  if (profilo === "corriere_a") return preparaRigheCorriereA(spedizioni);

  if (profilo === "gls" || profilo === "mbe") return preparaRigheGlsMbe(spedizioni);
  return spedizioni.map(rigaCorriere);
}

const COLONNE_DESTINATARIO: ColonnaExport<RigaCorriere>[] = [
  { key: "cliente", label: "Cliente", valore: (r) => r.cliente },
  { key: "indirizzo", label: "Ind Dest", valore: (r) => r.indirizzo },
  { key: "cap", label: "Cap", valore: (r) => r.cap },
  { key: "citta", label: "Città", valore: (r) => r.citta },
  { key: "prov", label: "Provincia", valore: (r) => r.prov },
];
const COLONNE_MOVIMENTAZIONE: ColonnaExport<RigaCorriere>[] = [
  { key: "colli", label: "Colli", tipo: "numero", valore: (r) => r.colli },
  { key: "peso", label: "Peso", tipo: "numero", valore: (r) => r.peso },
  { key: "telefono", label: "telefono", valore: (r) => r.telefono },
];

const COMUNI: ColonnaExport<RigaCorriere>[] = [
  { key: "data", label: "Data Fattura", tipo: "data", valore: (r) => r.data },
  { key: "numero", label: "Num fattura", valore: (r) => r.numero },
  ...COLONNE_DESTINATARIO,
  { key: "regione", label: "REGIONE", valore: (r) => r.regione },
  ...COLONNE_MOVIMENTAZIONE,
  { key: "importo", label: "€", tipo: "euro", valore: (r) => r.importo },
  { key: "note", label: "NOTE", valore: (r) => r.note },
];

const PROFILO_CORRIERE_A: ColonnaExport<RigaCorriere>[] = COMUNI;
const PROFILO_CORRIERE_B: ColonnaExport<RigaCorriere>[] = [
  ...COMUNI,
  { key: "email", label: "E-mail", valore: (r) => r.email },
  { key: "servizi", label: "Servizi", valore: () => "31,25" },
];

// Profilo CORRIERE_C — tracciato proprio dei file «Spedizione CORRIERE_C …» (rif. «Spedizione CORRIERE_C
// 26-05-2026.xlsx»): colonne A–M = Data distinta · Lotto · Cliente · Ind Dest · Cap · Città ·
// Provincia · Colli · Peso · telefono · email · PREAVVISO TELEFONICO · CONTRASSEGNO.
// Differenze da CORRIERE_B/CORRIERE_A: NIENTE «REGIONE» e NIENTE colonna «NOTE»; il preavviso e il
// contrassegno hanno colonne dedicate (non finiscono nelle note). La colonna «Lotto» porta
// il numero della spedizione (il nostro `numero`); «PREAVVISO TELEFONICO» = il telefono solo
// se richiesto il preavviso; «CONTRASSEGNO» = importo da incassare (vuoto se prepagato).
const PROFILO_CORRIERE_C: ColonnaExport<RigaCorriere>[] = [
  { key: "data", label: "Data distinta", tipo: "data", valore: (r) => r.data },
  { key: "numero", label: "Lotto", valore: (r) => r.numero },
  ...COLONNE_DESTINATARIO,
  ...COLONNE_MOVIMENTAZIONE,
  { key: "email", label: "email", valore: (r) => r.email },
  { key: "preavviso", label: "PREAVVISO TELEFONICO", valore: (r) => r.preavvisoTel },
  { key: "importo", label: "CONTRASSEGNO", tipo: "euro", valore: (r) => r.importo },
];

/** Colonne del profilo del corriere (default CORRIERE_B se non riconosciuto). */
export function colonneProfilo(profilo: string): ColonnaExport<RigaCorriere>[] {
  if (profilo === "corriere_a") return PROFILO_CORRIERE_A;
  if (profilo === "mbe") return PROFILO_CORRIERE_C;
  return PROFILO_CORRIERE_B;
}
