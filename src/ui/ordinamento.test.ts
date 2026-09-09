import { describe, expect, it } from "vitest";
import { ordinaCopia } from "./ordinamento";

describe("ordinamento tabellare", () => {
  it("ordina numeri senza mutare la sorgente", () => {
    const sorgente = [{ valore: 2 }, { valore: 1 }];
    expect(ordinaCopia(sorgente, (riga) => riga.valore, "asc")).toEqual([
      { valore: 1 },
      { valore: 2 },
    ]);
    expect(sorgente).toEqual([{ valore: 2 }, { valore: 1 }]);
  });

  it("usa confronto italiano numerico, direzione e spareggio", () => {
    const sorgente = [
      { gruppo: "A2", ordine: "b" },
      { gruppo: "A10", ordine: "a" },
      { gruppo: "A2", ordine: "a" },
    ];
    expect(
      ordinaCopia(
        sorgente,
        (riga) => riga.gruppo,
        "desc",
        (a, b) => a.ordine.localeCompare(b.ordine, "it"),
      ),
    ).toEqual([
      { gruppo: "A10", ordine: "a" },
      { gruppo: "A2", ordine: "b" },
      { gruppo: "A2", ordine: "a" },
    ]);
  });
});
