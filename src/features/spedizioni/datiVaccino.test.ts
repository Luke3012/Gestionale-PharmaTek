import { describe, expect, it } from "vitest";
import { categoriaHaDatiVaccino, spedizioneHaDatiVaccino } from "./datiVaccino";

describe("dati vaccino nelle spedizioni", () => {
  it("li abilita soltanto per Immunoterapia", () => {
    expect(categoriaHaDatiVaccino("Immunoterapia")).toBe(true);
    expect(categoriaHaDatiVaccino("Diagnostica")).toBe(false);
    expect(categoriaHaDatiVaccino("Keriba")).toBe(false);
  });

  it("gestisce spedizioni con righe di più ordini", () => {
    expect(spedizioneHaDatiVaccino({ righe: [{ categoria: "Diagnostica" }] } as never)).toBe(false);
    expect(
      spedizioneHaDatiVaccino({
        righe: [{ categoria: "Keriba" }, { categoria: "Immunoterapia" }],
      } as never),
    ).toBe(true);
  });
});
