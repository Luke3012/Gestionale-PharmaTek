import { describe, expect, it } from "vitest";
import { aggiornaBozzaProduzione, campiProduzione, pazienteEffettivoProduzione, stessiCampiProduzione } from "./datiProduzione";

describe("aggiornamento dei campi inline di produzione", () => {
  const salvati = { formulazione: "Fiale", posologia: "Settimanale", allergeni: ["Betulla"] };

  it("conserva digitazione e svuotamenti locali durante refresh invariati", () => {
    const bozza = { formulazione: "Nuova formulazione", posologia: "", allergeni: [] };
    expect(aggiornaBozzaProduzione(bozza, salvati, structuredClone(salvati))).toBe(bozza);
  });

  it("recepisce solo il campo modificato altrove anche in presenza di una bozza", () => {
    const bozza = { formulazione: "Bozza", posologia: "Bozza posologia", allergeni: ["Graminacee"] };
    const ricevuti = { ...salvati, formulazione: "Gocce" };
    const aggiornati = aggiornaBozzaProduzione(bozza, salvati, ricevuti);
    expect(aggiornati).toEqual({ ...bozza, formulazione: "Gocce" });
    expect(aggiornaBozzaProduzione(aggiornati, ricevuti, structuredClone(ricevuti))).toBe(aggiornati);
  });

  it("recepisce gli svuotamenti salvati e allergeni multipli", () => {
    const ricevuti = { formulazione: "", posologia: "", allergeni: ["Acari", "Olivo"] };
    expect(aggiornaBozzaProduzione(salvati, salvati, ricevuti)).toEqual(ricevuti);
    expect(aggiornaBozzaProduzione(ricevuti, ricevuti, campiProduzione({}))).toEqual(campiProduzione({}));
  });

  it("confronta il contenuto degli allergeni anziché il riferimento dell'array", () => {
    expect(stessiCampiProduzione(salvati, structuredClone(salvati))).toBe(true);
    expect(stessiCampiProduzione(salvati, { ...salvati, allergeni: ["Olivo"] })).toBe(false);
    expect(stessiCampiProduzione(salvati, { ...salvati, allergeni: ["Betulla", "Olivo"] })).toBe(false);
  });
});

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
