// Profili di esportazione "distinta corriere" (FASE 4B): CORRIERE_B e CORRIERE_A come due profili
// di DEFAULT dell'applicativo, IDENTICI al vecchio "File GENERALE" (macro GeneraListe).
// NON deve cambiare una virgola nel modo in cui viene esportato l'Excel:
// - CORRIERE_A = colonne A:M (Data Fattura · Num fattura · Cliente · Ind Dest · Cap · Città ·
//   Provincia · REGIONE · Colli · Peso · telefono · € · NOTE).
// - CORRIERE_B = le stesse + N "E-mail" + O "Servizi" (costante "31,25"); numero senza suffisso.
// La colonna € resta vuota se prepagato (solo contrassegno/assegno la valorizzano).
// La colonna NOTE compone: PREAVVISO TELEFONICO <tel> (se preavviso) + note di spedizione
// + "PAGAMENTO IN ASSEGNO" (se assegno).
import type { Spedizione } from "../../lib/tauri";
import type { ColonnaExport } from "../../ui/esporta/EsportaTabella";

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
  return String(numero || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((valore) => valore.trim())
    .filter(Boolean)
    .join(" + ");
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

function normalizzaChiave(value: string): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("it-IT")
    .replace(/\s+/g, " ");
}

function chiaveDestinazione(riga: RigaCorriere, fallback: string): string {
  const chiave = [riga.cliente, riga.indirizzo, riga.cap, riga.citta, riga.prov]
    .map(normalizzaChiave)
    .join("|");
  return chiave.replace(/\|/g, "") ? chiave : `spedizione:${fallback}`;
}

function unisciTestoSenzaDuplicati(a: string, b: string): string {
  if (!a) return b;
  if (!b || a === b) return a;
  return `${a} - ${b}`;
}

interface GruppoCorriereA {
  riga: RigaCorriere;
  numeri: string[];
}

function preparaRigheCorriereA(spedizioni: Spedizione[]): RigaCorriere[] {
  const gruppi = new Map<string, GruppoCorriereA>();

  const aggiungi = (s: Spedizione, persona: string, numeri: string[]) => {
    const riga = rigaCorriere(s);
    const destinatario = chiaveDestinazione(riga, s.id);
    // Il paziente distingue persone diverse spedite allo stesso indirizzo. Nei dati
    // senza paziente, il destinatario stesso è la persona di riferimento.
    const personaNormalizzata = normalizzaChiave(persona) || normalizzaChiave(riga.cliente);
    const chiave = `${destinatario}|persona:${personaNormalizzata}`;
    const esistente = gruppi.get(chiave);

    if (!esistente) {
      riga.colli = 1;
      riga.peso = 1;
      gruppi.set(chiave, { riga, numeri: [...numeri] });
      return;
    }

    esistente.numeri.push(...numeri);
    if (typeof riga.importo === "number") {
      esistente.riga.importo =
        (typeof esistente.riga.importo === "number" ? esistente.riga.importo : 0) + riga.importo;
    }
    esistente.riga.note = unisciTestoSenzaDuplicati(esistente.riga.note, riga.note);
    esistente.riga.preavvisoTel ||= riga.preavvisoTel;
    esistente.riga.telefono ||= riga.telefono;
    esistente.riga.email ||= riga.email;
  };

  for (const s of spedizioni) {
    if (s.righe.length === 0) {
      aggiungi(s, s.clienteNome, [s.numero]);
      continue;
    }

    // Prima evita di duplicare importo/note della stessa spedizione quando una
    // persona ha più vaccini; poi l'unione globale accorpa anche colli distinti.
    const perPersona = new Map<string, { persona: string; numeri: string[] }>();
    for (const riga of s.righe) {
      const persona = String(riga.paziente || "").trim() || s.clienteNome;
      const chiave = normalizzaChiave(persona);
      const gruppo = perPersona.get(chiave);
      if (gruppo) gruppo.numeri.push(riga.numero || "");
      else perPersona.set(chiave, { persona, numeri: [riga.numero || ""] });
    }
    for (const gruppo of perPersona.values()) aggiungi(s, gruppo.persona, gruppo.numeri);
  }

  return Array.from(gruppi.values(), ({ riga, numeri }) => ({
    ...riga,
    numero: formattaNumeriLottoPerExport(numeri.join("\n")),
    colli: 1,
    peso: 1,
  }));
}

/** Prepara l'elenco delle righe per l'esportazione:
 *  - CORRIERE_B ed CORRIERE_C: una sola riga unita per spedizione (con lotti tipo "508213/34" forniti dal backend).
 *  - CORRIERE_A: una riga per persona; più vaccini dello stesso paziente condividono la cella numero
 *    (es. `5078989 + 5078990`). Se i numeri mancano, la riga resta presente con cella vuota.
 *    Le righe senza paziente restano distinte, perché non è sicuro presumere che appartengano
 *    alla stessa persona.
 *  Tutte le righe hanno sempre colli = 1 e peso = 1.
 */
export function preparaRigheEsportazione(spedizioni: Spedizione[], profilo: string): RigaCorriere[] {
  if (profilo === "corriere_a") return preparaRigheCorriereA(spedizioni);

  // CORRIERE_B / CORRIERE_C / Altro: una riga per spedizione.
  return spedizioni.map((s) => {
    const riga = rigaCorriere(s);
    riga.colli = 1;
    riga.peso = 1;
    return riga;
  });
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
