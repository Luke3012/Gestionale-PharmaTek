import type { RecordDto } from "../../lib/tauri";
import { eurToCents } from "../../lib/money";
import type { Registro } from "./registri";

type ValoriAnagrafica = Record<string, string | number>;

export function valoriAnagrafica(
  registro: Registro,
  record?: RecordDto | null,
): ValoriAnagrafica {
  const valori: ValoriAnagrafica = {};
  for (const campo of registro.campi) {
    const raw = record?.data[campo.key] ?? campo.defaultValue;
    if (campo.tipo === "eur") {
      valori[campo.key] = typeof raw === "number" ? raw / 100 : "";
    } else if (campo.tipo === "numero") {
      valori[campo.key] = typeof raw === "number" ? raw : "";
    } else if (campo.tipo === "segmented") {
      valori[campo.key] = raw != null ? String(raw) : campo.opzioni?.[0]?.value ?? "";
    } else {
      valori[campo.key] = raw != null ? String(raw) : "";
    }
  }
  return valori;
}

export function preparaPatchAnagrafica(
  registro: Registro,
  valori: Readonly<ValoriAnagrafica>,
  record?: RecordDto | null,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const campo of registro.campi) {
    const valore = valori[campo.key];
    let stored: unknown;
    if (campo.tipo === "eur") {
      stored = valore === "" || valore == null ? undefined : eurToCents(Number(valore));
    } else if (campo.tipo === "numero") {
      stored = valore === "" || valore == null ? undefined : Number(valore);
    } else {
      const testo = String(valore ?? "").trim();
      const normalizzato = campo.tipo === "cf" ? testo.toUpperCase() : testo;
      stored = normalizzato === "" ? undefined : normalizzato;
    }

    if (!record) {
      if (stored !== undefined) fields[campo.key] = stored;
      continue;
    }

    const originale = record.data[campo.key];
    if (stored === undefined) {
      if (originale != null && originale !== "") fields[campo.key] = "";
    } else if (!Object.is(stored, originale)) {
      fields[campo.key] = stored;
    }
  }
  return fields;
}

/** Campi completi usati dall'anagrafica rapida dell'ordine, inclusi i valori vuoti. */
export function preparaCampiAnagraficaCompleti(
  registro: Registro,
  valori: Readonly<ValoriAnagrafica>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const campo of registro.campi) {
    const valore = valori[campo.key];
    if (campo.tipo === "eur") fields[campo.key] = valore === "" ? 0 : eurToCents(Number(valore));
    else if (campo.tipo === "numero") fields[campo.key] = valore === "" ? undefined : Number(valore);
    else fields[campo.key] = String(valore ?? "").trim();
  }
  return fields;
}
