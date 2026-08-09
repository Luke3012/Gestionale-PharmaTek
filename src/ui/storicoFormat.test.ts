import { describe, expect, it } from "vitest";
import { etichettaCampoStorico, formattaDataOraStorico, formattaValoreStorico } from "./storicoFormat";

describe("formattazione storico", () => {
  it("mostra le date ISO italiane con anno completo", () => {
    expect(formattaValoreStorico("2026-07-14")).toBe("14/07/2026");
  });

  it("rende leggibile un timestamp ISO senza esporre T, millisecondi e Z", () => {
    const valore = formattaValoreStorico("2026-07-14T13:45:49.619Z");
    expect(valore).toContain("14/07/2026");
    expect(valore).not.toMatch(/[TZ]/);
    expect(valore).not.toContain(".619");
  });

  it("usa l'anno completo anche nella data dell'evento", () => {
    const valore = formattaDataOraStorico(new Date(2026, 6, 14, 15, 46).getTime());
    expect(valore).toContain("14/07/2026");
    expect(valore).toContain("15:46");
  });

  it("non altera testi normali e rende leggibili i nomi campo", () => {
    expect(formattaValoreStorico("Postazione 3")).toBe("Postazione 3");
    expect(etichettaCampoStorico("aruba_esportato_il")).toBe("Aruba esportato il");
  });
});
