import { describe, expect, it } from "vitest";
import {
  leggiNumeriLotto,
  serializzaNumeriLotto,
} from "./NumeriLottoInput";

describe("numeri lotto per quantità", () => {
  it("mantiene compatibile il lotto singolo storico", () => {
    expect(leggiNumeriLotto("LOT-1", 2)).toEqual(["LOT-1", ""]);
  });

  it("conserva la corrispondenza anche con un lotto intermedio vuoto", () => {
    const valore = serializzaNumeriLotto(["LOT-1", "", "LOT-3"]);
    expect(leggiNumeriLotto(valore, 3)).toEqual(["LOT-1", "", "LOT-3"]);
  });

  it("la lettura per una quantità minore non modifica il valore persistito", () => {
    const persistito = "LOT-1\nLOT-2\nLOT-3";
    expect(leggiNumeriLotto(persistito, 2)).toEqual(["LOT-1", "LOT-2"]);
    expect(persistito).toBe("LOT-1\nLOT-2\nLOT-3");
  });
});
