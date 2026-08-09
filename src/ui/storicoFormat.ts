import { formattaDataItaliana } from "../lib/date";

const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATA_ORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

const FORMATO_DATA_ORA = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Data/ora di un evento dello storico, sempre con anno a quattro cifre. */
export function formattaDataOraStorico(ms: number): string {
  const data = new Date(ms);
  return Number.isNaN(data.getTime()) ? "—" : FORMATO_DATA_ORA.format(data);
}

/** Rende leggibili i valori data senza modificare il valore grezzo usato dal revert. */
export function formattaValoreStorico(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(vuoto)";
  if (typeof v === "string") {
    if (ISO_DATA.test(v)) return formattaDataItaliana(v);
    if (ISO_DATA_ORA.test(v)) {
      const data = new Date(v);
      if (!Number.isNaN(data.getTime())) return FORMATO_DATA_ORA.format(data);
    }
    return v;
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Etichetta umana dei campi tecnici event-sourced (`esportato_il` → `Esportato il`). */
export function etichettaCampoStorico(field: string): string {
  const leggibile = field.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return leggibile ? leggibile.charAt(0).toUpperCase() + leggibile.slice(1) : field;
}
