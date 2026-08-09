import { describe, expect, it, vi } from "vitest";
import { inizializzaDateConsegna, type DataConsegnaTarget } from "./DataConsegnaPrevistaModal";

const righe = [
  { id: "esistente", ordineNumero: "1", descrizione: "A", paziente: "", dataIniziale: "15/08/2026" },
  { id: "vuota", ordineNumero: "2", descrizione: "B", paziente: "", dataIniziale: "" },
];

describe("inizializzazione date consegna", () => {
  it("non propone date nuove nella gestione manuale", () => {
    const target: DataConsegnaTarget = { modo: "gestione", scope: "lotto", righe };
    expect(inizializzaDateConsegna(target)).toEqual({
      esistente: "15/08/2026",
      vuota: "",
    });
  });

  it("mantiene le date esistenti e propone il default durante l'export", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 13, 12));
    const target = {
      modo: "export",
      scope: "lotto",
      righe,
      g: {} as never,
    } satisfies DataConsegnaTarget;
    const valori = inizializzaDateConsegna(target);
    expect(valori.esistente).toBe("15/08/2026");
    expect(valori.vuota).toMatch(/^\d{2}\/\d{2}\/2026$/);
    vi.useRealTimers();
  });
});
