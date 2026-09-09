import { describe, expect, it } from "vitest";
import { centsToEurStr, eurToCents, formattaEuro, formattaEuroCentesimi } from "./money";

describe("valori monetari", () => {
  it("converte e formatta i centesimi senza cambiare unità", () => {
    expect(eurToCents(12.34)).toBe(1234);
    expect(centsToEurStr(1234)).toBe("12,34");
    expect(formattaEuro(1234)).toBe(
      new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(12.34),
    );
    expect(formattaEuroCentesimi(1234)).toBe(formattaEuro(1234));
  });

  it("preserva la formattazione nativa dei valori non finiti", () => {
    const formato = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
    expect(formattaEuroCentesimi(Number.NaN)).toBe(formato.format(Number.NaN));
  });
});
