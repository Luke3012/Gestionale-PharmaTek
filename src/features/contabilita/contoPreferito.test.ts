import { describe, expect, it } from "vitest";
import { èContoTransito, opzioniContiConTransito, risolviContoPreferito } from "./contoPreferito";

const conti = [
  { id: "banca", data: { nome: "Banca", tipo: "banca", predefinito_incassi: true }, deleted: false, revision: "" },
  { id: "acconti", data: { nome: "Acconti", tipo: "banca", predefinito_acconti: true }, deleted: false, revision: "" },
];

describe("conti di transito", () => {
  it("riconosce soltanto contrassegno e assegno", () => {
    expect(èContoTransito("contrassegno")).toBe(true);
    expect(èContoTransito("assegno")).toBe(true);
    expect(èContoTransito("banca")).toBe(false);
    expect(èContoTransito(undefined)).toBe(false);
  });

  it("marca nell'etichetta soltanto i conti di transito", () => {
    expect(opzioniContiConTransito([
      { id: "b", data: { nome: "Banca", tipo: "banca" }, deleted: false, revision: "" },
      { id: "c", data: { nome: "Contrassegno", tipo: "contrassegno" }, deleted: false, revision: "" },
      { id: "a", data: { tipo: "assegno" }, deleted: false, revision: "" },
    ])).toEqual([
      { value: "b", label: "Banca" },
      { value: "c", label: "Contrassegno (transito)" },
      { value: "a", label: "(conto) (transito)" },
    ]);
  });

  it("rispetta la precedenza medico, agente e predefinito per tipo", () => {
    const medico = { id: "m", data: { conto_saldo_id: "banca" }, deleted: false, revision: "" };
    const agente = { id: "a", data: { conto_saldo_id: "acconti" }, deleted: false, revision: "" };

    expect(risolviContoPreferito({ conti, medico, agente, tipo: "acconto" })).toBe("banca");
    expect(risolviContoPreferito({ conti, agente, tipo: "saldo" })).toBe("acconti");
    expect(risolviContoPreferito({ conti, tipo: "acconto" })).toBe("acconti");
    expect(risolviContoPreferito({ conti, tipo: "saldo" })).toBe("banca");
  });

  it("ignora una preferenza che non corrisponde a un conto esistente", () => {
    const medico = { id: "m", data: { conto_saldo_id: "rimosso" }, deleted: false, revision: "" };
    expect(risolviContoPreferito({ conti, medico, tipo: "saldo" })).toBe("banca");
  });
});
