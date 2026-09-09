import { describe, expect, it } from "vitest";
import { opzioniRecordNome } from "./opzioniRecord";

describe("opzioniRecordNome", () => {
  it("usa il nome del record e il fallback richiesto", () => {
    const records = [
      { id: "1", data: { nome: "Primo" } },
      { id: "2", data: {} },
    ];

    expect(opzioniRecordNome(records)).toEqual([
      { value: "1", label: "Primo" },
      { value: "2", label: "(senza nome)" },
    ]);
    expect(opzioniRecordNome(records, "(conto)")[1]).toEqual({
      value: "2",
      label: "(conto)",
    });
  });
});
