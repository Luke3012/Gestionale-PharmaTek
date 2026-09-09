// Definizioni data-driven dei 6 registri anagrafici (UI-SPEC §7.5, MODELLO-DATI).
// Un'unica vista generica (RegistroView) li rende tutti.
import {
  IconBuildingBank,
  IconPackage,
  IconStethoscope,
  IconTruck,
  IconUser,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";
import type { RecordDto } from "../../lib/tauri";
import { CATEGORIE_PRODOTTO } from "./categorie";
export { CATEGORIE_PRODOTTO, categoriaDef, type CategoriaProdotto } from "./categorie";
export { centsToEurStr, eurToCents } from "../../lib/money";

export type CampoTipo =
  | "testo"
  | "email"
  | "tel"
  | "cap"
  | "cf"
  | "prov"
  | "eur"
  | "numero"
  | "select"
  | "segmented"
  | "textarea"
  | "sezione"; // intestazione di sezione (nessun dato), per raggruppare i campi

export interface Opzione {
  value: string;
  label: string;
}

export interface Campo {
  key: string;
  label: string;
  tipo: CampoTipo;
  required?: boolean;
  defaultValue?: string | number;
  min?: number;
  max?: number;
  integer?: boolean;
  placeholder?: string;
  /** Affianca al campo precedente (due per riga). */
  half?: boolean;
  /** Per i select che referenziano un'altra entità (es. medico → agente). */
  rifEntity?: string;
  /** Opzioni statiche per select/segmented. */
  opzioni?: Opzione[];
  /** Azione associata al campo (es. pulsante "Calcola CF" nel popover). */
  azione?: "calcola-cf";
  /** Comportamento auto-fill: 'cap' attiva il lookup CAP ↔ città/provincia/regione. */
  autoFill?: "cap";
}

/** Contesto passato alle colonne calcolate: opzioni dei rif + entità correlate caricate. */
export interface ColonnaCtx {
  rif: Record<string, Opzione[]>;
  correlate: Record<string, RecordDto[]>;
  rifMappe?: Record<string, Map<string, string>>;
  conteggi?: {
    mediciPerAgente?: Map<string, number>;
  };
}

export interface Colonna {
  key: string;
  label: string;
  tipo?: CampoTipo;
  rifEntity?: string;
  /** Valore calcolato (testo o numero) da dati propri + entità correlate; sovrascrive il grezzo. */
  calcola?: (rec: RecordDto, ctx: ColonnaCtx) => string | number;
  /** Rende il valore come Badge colorato: mappa valore→colore (es. { "Sì": "teal", "No": "gray" }). */
  badge?: Record<string, string>;
}

export interface Registro {
  entity: string;
  etichetta: string;
  singolare: string;
  Icon: Icon;
  campi: Campo[];
  colonne: Colonna[];
  /** Entità extra da caricare per le colonne calcolate (es. agente → medico). */
  correlate?: string[];
  /** Etichetta principale del record (per titoli, select, ricerca). */
  titolo: (data: Record<string, unknown>) => string;
}

/** Formatta la provvigione di un agente con l'unità giusta (es. "10%" o "€ 5"). */
function provvigioneFmt(rec: RecordDto): string {
  const v = typeof rec.data.provv_valore === "number" ? rec.data.provv_valore : 0;
  if (!v) return "";
  return rec.data.provv_tipo === "fisso" ? `€ ${v.toLocaleString("it-IT")}` : `${v}%`;
}

/** Etichetta del profilo distinta di un corriere. */
function profiloFmt(rec: RecordDto): string {
  const p = String(rec.data.profilo ?? "");
  if (p === "carrai") return "CORRIERE_A";
  if (p === "gls") return "CORRIERE_B";
  if (p === "mbe") return "CORRIERE_C";
  return p;
}

const TIPO_PROVVIGIONE: Opzione[] = [
  { value: "percentuale", label: "Percentuale" },
  { value: "fisso", label: "Fisso (€)" },
];

const MATURAZIONE_PROVVIGIONE: Opzione[] = [
  { value: "spedizione", label: "Alla spedizione" },
  { value: "chiuso", label: "A ordine chiuso" },
];

function nomeDi(data: Record<string, unknown>): string {
  return (data.nome as string) || "(senza nome)";
}

const CAMPI_RECAPITO_SPEDIZIONE: Campo[] = [
  { key: "indirizzo", label: "Indirizzo", tipo: "testo" },
  { key: "citta", label: "Città", tipo: "testo", half: true },
  { key: "prov", label: "Prov.", tipo: "prov", half: true },
  { key: "cap", label: "CAP", tipo: "cap", half: true, autoFill: "cap" },
  { key: "regione", label: "Regione", tipo: "testo", half: true },
  { key: "telefono", label: "Telefono", tipo: "tel", half: true },
  { key: "email", label: "Email", tipo: "email", half: true },
  { key: "cf", label: "Codice fiscale / P.IVA", tipo: "cf", azione: "calcola-cf" },
  { key: "note_spedizione", label: "Note di spedizione", tipo: "textarea" },
];

export const REGISTRI: Registro[] = [
  {
    entity: "agente",
    etichetta: "Agenti",
    singolare: "agente",
    Icon: IconUser,
    titolo: nomeDi,
    campi: [
      { key: "nome", label: "Nome", tipo: "testo", required: true },
      { key: "provv_tipo", label: "Tipo provvigione", tipo: "segmented", opzioni: TIPO_PROVVIGIONE, half: true },
      { key: "provv_valore", label: "Valore predefinito (% o €)", tipo: "numero", half: true },
      { key: "provv_maturazione", label: "La provvigione matura", tipo: "segmented", opzioni: MATURAZIONE_PROVVIGIONE },
      {
        key: "__sez_provv_linea",
        label: "Provvigione per linea",
        tipo: "sezione",
        placeholder: "Lascia vuoto per mantenere la stessa provvigione dell'Immunoterapia.",
      },
      { key: "provv_cat_diagnostica", label: "Diagnostica", tipo: "numero", half: true },
      { key: "provv_cat_keriba", label: "Keriba", tipo: "numero", half: true },
      {
        key: "__sez_altri",
        label: "Altro",
        tipo: "sezione",
      },
      { key: "acconto_default", label: "Acconto predefinito (per prodotto)", tipo: "eur", half: true },
      { key: "conto_saldo_id", label: "Conto di saldo preferito", tipo: "select", rifEntity: "conto", half: true },
    ],
    correlate: ["medico"],
    colonne: [
      { key: "nome", label: "Nome" },
      { key: "provv_valore", label: "Provvigione", calcola: provvigioneFmt },
      {
        key: "n_medici",
        label: "Medici",
        tipo: "numero",
        calcola: (rec, ctx) =>
          ctx.conteggi?.mediciPerAgente?.get(rec.id) ?? 0,
      },
    ],
  },
  {
    entity: "medico",
    etichetta: "Medici",
    singolare: "medico",
    Icon: IconStethoscope,
    titolo: nomeDi,
    campi: [
      { key: "nome", label: "Nome", tipo: "testo", required: true },
      { key: "agente_id", label: "Agente di riferimento", tipo: "select", rifEntity: "agente", required: true, half: true },
      { key: "prezzo_immuno_default", label: "Prezzo standard immunoterapia", tipo: "eur", half: true },
      { key: "acconto_default", label: "Acconto predefinito (per prodotto)", tipo: "eur", half: true },
      {
        key: "rate_saldo_default",
        label: "Rate del saldo predefinite",
        tipo: "numero",
        required: true,
        defaultValue: 1,
        min: 1,
        max: 60,
        integer: true,
        half: true,
      },
      { key: "conto_saldo_id", label: "Conto di saldo preferito", tipo: "select", rifEntity: "conto" },
      {
        key: "__sez_spedizione",
        label: "Indirizzo di spedizione",
        tipo: "sezione",
        placeholder: "Usato quando il medico è anche destinatario (es. Diagnostica).",
      },
      ...CAMPI_RECAPITO_SPEDIZIONE,
    ],
    colonne: [
      { key: "nome", label: "Nome" },
      { key: "agente_id", label: "Agente", rifEntity: "agente" },
      { key: "regione", label: "Regione" },
      { key: "prezzo_immuno_default", label: "Prezzo immuno", tipo: "eur" },
      { key: "acconto_default", label: "Acconto", tipo: "eur" },
    ],
  },
  {
    entity: "cliente",
    etichetta: "Clienti",
    singolare: "cliente",
    Icon: IconUsers,
    titolo: nomeDi,
    campi: [
      { key: "nome", label: "Nome / Ragione sociale", tipo: "testo", required: true },
      ...CAMPI_RECAPITO_SPEDIZIONE,
    ],
    colonne: [
      { key: "nome", label: "Nome" },
      { key: "citta", label: "Città" },
      { key: "regione", label: "Regione" },
      { key: "telefono", label: "Telefono" },
      {
        key: "ha_email",
        label: "E-mail",
        calcola: (rec) => (String(rec.data.email ?? "").trim() ? "Sì" : "No"),
        badge: { "Sì": "teal", No: "gray" },
      },
      {
        key: "ha_cf",
        label: "CF",
        calcola: (rec) => (String(rec.data.cf ?? "").trim() ? "Sì" : "No"),
        badge: { "Sì": "teal", No: "gray" },
      },
    ],
  },
  {
    entity: "prodotto",
    etichetta: "Prodotti",
    singolare: "prodotto",
    Icon: IconPackage,
    titolo: nomeDi,
    campi: [
      { key: "nome", label: "Nome prodotto", tipo: "testo", required: true },
      { key: "categoria", label: "Categoria", tipo: "select", opzioni: CATEGORIE_PRODOTTO, required: true, half: true },
      { key: "prezzo_base_default", label: "Prezzo base", tipo: "eur", half: true },
    ],
    colonne: [
      { key: "nome", label: "Nome" },
      { key: "categoria", label: "Categoria" },
      { key: "prezzo_base_default", label: "Prezzo base", tipo: "eur" },
    ],
  },
  {
    entity: "conto",
    etichetta: "Conti",
    singolare: "conto",
    Icon: IconBuildingBank,
    titolo: nomeDi,
    campi: [
      { key: "nome", label: "Nome conto", tipo: "testo", required: true },
      { key: "banca", label: "Banca", tipo: "testo" },
      { key: "iban", label: "IBAN", tipo: "testo" },
    ],
    colonne: [
      { key: "nome", label: "Nome" },
      { key: "banca", label: "Banca" },
      { key: "iban", label: "IBAN" },
    ],
  },
  {
    entity: "corriere",
    etichetta: "Corrieri",
    singolare: "corriere",
    Icon: IconTruck,
    titolo: nomeDi,
    campi: [
      { key: "nome", label: "Nome corriere", tipo: "testo", required: true },
      {
        key: "profilo",
        label: "Profilo distinta export",
        tipo: "select",
        opzioni: [
          { value: "gls", label: "CORRIERE_B (E-mail + Servizi 31,25)" },
          { value: "carrai", label: "CORRIERE_A (con preavviso)" },
          { value: "mbe", label: "CORRIERE_C (preavviso + contrassegno)" },
        ],
        half: true,
      },
      {
        key: "conto_incasso_id",
        label: "Conto di accredito contrassegni",
        tipo: "select",
        rifEntity: "conto",
        half: true,
      },
    ],
    colonne: [
      { key: "nome", label: "Nome" },
      { key: "profilo", label: "Profilo distinta", calcola: profiloFmt },
      { key: "conto_incasso_id", label: "Conto di saldo", rifEntity: "conto" },
    ],
  },
];

export const REGISTRO_CLIENTE = REGISTRI.find((registro) => registro.entity === "cliente")!;
export const REGISTRO_MEDICO = REGISTRI.find((registro) => registro.entity === "medico")!;

// ---- Validazione ----

export function validaCampo(campo: Campo, valore: unknown): string | null {
  const s = typeof valore === "string" ? valore.trim() : valore;
  const vuoto = s === undefined || s === null || s === "";

  if (campo.required && vuoto) return "Campo obbligatorio.";
  if (vuoto) return null; // i campi non obbligatori vuoti sono ok

  if (campo.tipo === "numero") {
    const numero = Number(s);
    if (!Number.isFinite(numero)) return "Numero non valido.";
    if (campo.integer && !Number.isInteger(numero)) return "Inserisci un numero intero.";
    if (campo.min != null && numero < campo.min) return `Il valore minimo è ${campo.min}.`;
    if (campo.max != null && numero > campo.max) return `Il valore massimo è ${campo.max}.`;
  }

  const str = String(s);
  switch (campo.tipo) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str) ? null : "Email non valida.";
    case "cap":
      return /^\d{5}$/.test(str) ? null : "Il CAP deve avere 5 cifre.";
    case "prov":
      return /^[A-Za-z]{2}$/.test(str) ? null : "Sigla provincia di 2 lettere (es. FI).";
    case "cf":
      return /^[A-Za-z0-9]{11,16}$/.test(str) ? null : "Codice fiscale/P.IVA non valido.";
    default:
      return null;
  }
}

export function validaCampi(
  campi: readonly Campo[],
  valori: Readonly<Record<string, unknown>>
): Record<string, string> {
  const errori: Record<string, string> = {};
  for (const campo of campi) {
    const errore = validaCampo(campo, valori[campo.key]);
    if (errore) errori[campo.key] = errore;
  }
  return errori;
}
