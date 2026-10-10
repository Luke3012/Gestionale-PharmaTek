import { describe, expect, it } from "vitest";
import { inserisciDatoModello } from "./modelliComunicazione";

describe("inserimento dei dati nel modello", () => {
  it.each([0, 3, 6])("inserisce al cursore %i senza spazi aggiunti", (posizione) => {
    expect(inserisciDatoModello("abcdef", "nome_cliente", { inizio: posizione, fine: posizione }))
      .toEqual({ testo: "abcdef".slice(0, posizione) + "{{nome_cliente}}" + "abcdef".slice(posizione), cursore: posizione + 16 });
  });
  it("sostituisce la selezione conservando il testo circostante", () => {
    expect(inserisciDatoModello("Gentile cliente,", "nome_cliente", { inizio: 8, fine: 15 }))
      .toEqual({ testo: "Gentile {{nome_cliente}},", cursore: 24 });
  });
  it("prima di usare il campo o dopo il cambio modello inserisce alla fine", () => {
    expect(inserisciDatoModello("Nuovo", "iban", null)).toEqual({ testo: "Nuovo{{iban}}", cursore: 13 });
    expect(inserisciDatoModello("", "iban", null)).toEqual({ testo: "{{iban}}", cursore: 8 });
  });
  it("inserimenti consecutivi continuano dopo il dato appena inserito", () => {
    const primo = inserisciDatoModello("ab", "iban", { inizio: 1, fine: 1 });
    expect(inserisciDatoModello(primo.testo, "importo_residuo", { inizio: primo.cursore, fine: primo.cursore }))
      .toEqual({ testo: "a{{iban}}{{importo_residuo}}b", cursore: 28 });
  });
  it("limita una selezione precedente alla lunghezza corrente", () => {
    expect(inserisciDatoModello("a", "iban", { inizio: 10, fine: 20 }).testo).toBe("a{{iban}}");
  });
});
