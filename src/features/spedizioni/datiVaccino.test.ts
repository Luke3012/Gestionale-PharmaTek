import { describe, expect, it } from "vitest";
import { categoriaHaDatiVaccino, colliSpedizioneEffettuata, spedizioneHaDatiVaccino } from "./datiVaccino";

describe("dati vaccino nelle spedizioni", () => {
  it("conta un collo anche con più vaccini uniti e vecchi conteggi maggiori", () => {
    const spedizione = { colliExport: null, colli: 99, righe: [
      { categoria: "Immunoterapia", qta: 1 },
      { categoria: "Immunoterapia", qta: 1 },
      { categoria: "Immunoterapia", qta: 5 },
    ] };
    expect(colliSpedizioneEffettuata(spedizione)).toBe(1);
  });

  it("rispetta il numero di colli impostato nel popover, incluso il ritorno a uno", () => {
    expect(colliSpedizioneEffettuata({ colliExport: 5 })).toBe(5);
    expect(colliSpedizioneEffettuata({ colliExport: 1 })).toBe(1);
    expect(colliSpedizioneEffettuata({ colliExport: null })).toBe(1);
  });

  it("usa il default per record precedenti e valori non positivi", () => {
    expect(colliSpedizioneEffettuata({})).toBe(1);
    expect(colliSpedizioneEffettuata({ colliExport: 0 })).toBe(1);
    expect(colliSpedizioneEffettuata({ colliExport: -2 })).toBe(1);
  });
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
