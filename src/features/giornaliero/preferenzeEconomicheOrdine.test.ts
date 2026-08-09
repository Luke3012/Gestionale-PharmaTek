import { describe, expect, it } from "vitest";
import type { RecordDto } from "../../lib/tauri";
import {
  accontoSuggeritoOrdine,
  PREFERENZE_ACCONTO_PRODOTTI_DEFAULT,
} from "./preferenzeEconomicheOrdine";

function record(id: string, data: Record<string, unknown>): RecordDto {
  return { id, revision: "1", data, deleted: false };
}

describe("accontoSuggeritoOrdine", () => {
  const righe = [
    { qta: 1, prezzo: 28_000, compilata: true },
    { qta: 2, prezzo: 32_000, compilata: true },
  ];

  it("usa la preferenza del medico per prodotto prima di quella dell'agente", () => {
    expect(
      accontoSuggeritoOrdine({
        categoria: "Immunoterapia",
        totale: 92_000,
        righe,
        medico: record("m", { acconto_default: 10_000 }),
        agente: record("a", { acconto_default: 9_000 }),
      }),
    ).toBe(20_000);
  });

  it("applica la regola globale per quantità quando non ci sono override", () => {
    expect(
      accontoSuggeritoOrdine({
        categoria: "Immunoterapia",
        totale: 92_000,
        righe,
        preferenze: PREFERENZE_ACCONTO_PRODOTTI_DEFAULT,
      }),
    ).toBe(32_000);
  });

  it("mantiene le eccezioni di linea del Giornaliero", () => {
    expect(
      accontoSuggeritoOrdine({
        categoria: "Diagnostica",
        totale: 30_000,
        righe,
      }),
    ).toBe(0);
    expect(
      accontoSuggeritoOrdine({
        categoria: "Keriba",
        totale: 30_000,
        righe,
      }),
    ).toBe(30_000);
  });
});
