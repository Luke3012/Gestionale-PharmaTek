import { describe, expect, it } from "vitest";
import {
  aggiungiGiorniRate,
  calcolaRate,
  differenzaGiorni,
  numeroRateSaldoPredefinito,
  offsetSpedizione,
} from "./rateizzazione";
import { riallineaVociAperteLocali } from "./riallineaSaldo";

describe("rateizzazione", () => {
  it("divide equamente e mette il resto sull'ultima rata", () => {
    expect(calcolaRate(10_001, 2, "2026-01-15")).toEqual([
      { importo: 5_000, scadenza: "2026-01-15" },
      { importo: 5_001, scadenza: "2026-02-15" },
    ]);
  });

  it("mantiene la cadenza mensile sulle date di calendario", () => {
    expect(calcolaRate(9_000, 3, "2026-02-07").map((r) => r.scadenza)).toEqual([
      "2026-02-07",
      "2026-03-07",
      "2026-04-07",
    ]);
  });

  it("usa gli stessi offset del rateizzo legato alla spedizione", () => {
    expect(offsetSpedizione("banca")).toBe(7);
    expect(offsetSpedizione("contrassegno")).toBe(30);
    expect(offsetSpedizione("assegno")).toBe(30);
    expect(aggiungiGiorniRate("2026-07-09", 7)).toBe("2026-07-16");
    expect(differenzaGiorni("2026-08-16", "2026-07-16")).toBe(31);
  });

  it("applica la preferenza soltanto all'Immunoterapia", () => {
    expect(numeroRateSaldoPredefinito("Immunoterapia", 2)).toBe(2);
    expect(numeroRateSaldoPredefinito("Immunoterapia", undefined)).toBe(1);
    expect(numeroRateSaldoPredefinito("Diagnostica", 2)).toBe(1);
    expect(numeroRateSaldoPredefinito("Keriba", 2)).toBe(1);
  });

  it("ridistribuisce sulle rate successive un incasso diverso dalla rata prevista", () => {
    expect(
      riallineaVociAperteLocali(
        [
          { tipo: "acconto" as const, importo: 5_000, saldato: true },
          { tipo: "rata" as const, importo: 8_000, saldato: false },
          { tipo: "rata" as const, importo: 8_000, saldato: false },
        ],
        25_000
      ).map((p) => p.importo)
    ).toEqual([5_000, 10_000, 10_000]);

    expect(
      riallineaVociAperteLocali(
        [
          { tipo: "acconto" as const, importo: 22_400, saldato: true },
          { tipo: "rata" as const, importo: 8_000, saldato: false },
          { tipo: "rata" as const, importo: 8_000, saldato: false },
        ],
        25_000
      ).map((p) => p.importo)
    ).toEqual([22_400, 1_300, 1_300]);
  });

  it("elimina le rate che arrotonderebbero a zero centesimi", () => {
    expect(
      riallineaVociAperteLocali(
        [
          { tipo: "rata" as const, importo: 100, saldato: false },
          { tipo: "rata" as const, importo: 100, saldato: false },
        ],
        1
      ).map((p) => p.importo)
    ).toEqual([1]);
  });

});
