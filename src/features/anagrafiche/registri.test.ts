import { describe, expect, it } from "vitest";
import { validaCampi, type Campo } from "./registri";

const CAMPI: Campo[] = [
  { key: "nome", label: "Nome", tipo: "testo", required: true },
  { key: "email", label: "Email", tipo: "email" },
  { key: "provincia", label: "Provincia", tipo: "prov" },
];

describe("validaCampi", () => {
  it("raccoglie gli errori mantenendo l'ordine dei campi", () => {
    const errori = validaCampi(CAMPI, { nome: "", email: "errata", provincia: "F" });

    expect(errori).toEqual({
      nome: "Campo obbligatorio.",
      email: "Email non valida.",
      provincia: "Sigla provincia di 2 lettere (es. FI).",
    });
    expect(Object.keys(errori)).toEqual(["nome", "email", "provincia"]);
  });

  it("ignora i campi validi e quelli opzionali vuoti", () => {
    expect(validaCampi(CAMPI, { nome: "Mario", email: "", provincia: "FI" })).toEqual({});
  });
});
