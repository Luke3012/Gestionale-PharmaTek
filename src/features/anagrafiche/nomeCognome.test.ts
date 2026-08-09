import { describe, expect, it } from "vitest";
import {
  dividiNomeCognomeIntelligente,
  riconosciNomeCognome,
  riordinaNomeCognome,
} from "./nomeCognome";

describe("riconoscimento condiviso nome e cognome", () => {
  it("riconosce entrambi gli ordini", () => {
    expect(dividiNomeCognomeIntelligente("Mario Rossi")).toEqual({
      nome: "Mario",
      cognome: "Rossi",
    });
    expect(dividiNomeCognomeIntelligente("Rossi Mario")).toEqual({
      nome: "Mario",
      cognome: "Rossi",
    });
  });

  it("preserva nomi e cognomi composti", () => {
    expect(dividiNomeCognomeIntelligente("De Luca Mario")).toEqual({
      nome: "Mario",
      cognome: "De Luca",
    });
    expect(dividiNomeCognomeIntelligente("Maria Grazia De Luca")).toEqual({
      nome: "Maria Grazia",
      cognome: "De Luca",
    });
  });

  it("usa virgola e dizionari dell'import senza una seconda euristica", () => {
    expect(riordinaNomeCognome("Rossi, Mario")).toBe("Mario Rossi");
    expect(
      riconosciNomeCognome("Verdi Alex", new Set(["Alex"]), new Set(["Verdi"])),
    ).toMatchObject({ nome: "Alex", cognome: "Verdi" });
  });
});
