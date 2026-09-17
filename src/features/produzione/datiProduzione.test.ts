import { describe, expect, it } from "vitest";
import { pazienteEffettivoProduzione } from "./datiProduzione";

describe("pazienteEffettivoProduzione", () => {
  it("restituisce il paziente specificato nella riga se presente", () => {
    expect(pazienteEffettivoProduzione("Mario Rossi", "Farmacia San Carlo")).toBe("Mario Rossi");
  });

  it("fa il trim del paziente ed ignora spazi vuoti all'inizio e alla fine", () => {
    expect(pazienteEffettivoProduzione("  Luigi Verdi  ", "Farmacia San Carlo")).toBe("Luigi Verdi");
  });

  it("ricade sulla ragione sociale del cliente se il paziente è stringa vuota", () => {
    expect(pazienteEffettivoProduzione("", "Farmacia San Carlo")).toBe("Farmacia San Carlo");
  });

  it("ricade sulla ragione sociale del cliente se il paziente è composto solo da spazi", () => {
    expect(pazienteEffettivoProduzione("   ", "Farmacia San Carlo")).toBe("Farmacia San Carlo");
  });

  it("ricade sulla ragione sociale del cliente se il paziente è undefined o null", () => {
    expect(pazienteEffettivoProduzione(undefined, "Farmacia San Carlo")).toBe("Farmacia San Carlo");
    expect(pazienteEffettivoProduzione(null, "Farmacia San Carlo")).toBe("Farmacia San Carlo");
  });

  it("restituisce stringa vuota se sia il paziente che il cliente sono vuoti", () => {
    expect(pazienteEffettivoProduzione("", "")).toBe("");
    expect(pazienteEffettivoProduzione(undefined, undefined)).toBe("");
  });
});
