import { describe, expect, it } from "vitest";
import {
  chiaveIndirizzoConfronto,
  estraiCivico,
  estraiOdonomastico,
  formattaIndirizzoSintetico,
  normalizzaIndirizzo,
  pulisciCap,
  raggruppaPerIndirizzoCompatibile,
  sonoIndirizziCompatibili,
  testoConfronto,
  unisciNoteSpedizione,
} from "./confrontoIndirizzi";

describe("confrontoIndirizzi", () => {
  describe("normalizzaIndirizzo e testoConfronto", () => {
    it("rimuove punteggiatura, uniforma spazi e rimuove accenti", () => {
      expect(normalizzaIndirizzo("  Via  Roma, 10/A. ")).toBe("VIA ROMA 10/A");
      expect(normalizzaIndirizzo("Corso Vittorio Emanuele II; 45")).toBe("CORSO VITTORIO EMANUELE II 45");
      expect(testoConfronto("Città")).toBe("CITTA");
    });
  });

  describe("pulisciCap", () => {
    it("estrae solo i caratteri numerici, gestisce i float di Excel e formatta a 5 cifre", () => {
      expect(pulisciCap(" 80100 ")).toBe("80100");
      expect(pulisciCap("96100.0")).toBe("96100");
      expect(pulisciCap("100")).toBe("00100");
    });
  });

  describe("estrazione civico e odonomastico", () => {
    it("estrae correttamente il civico e la sua base numerica", () => {
      expect(estraiCivico("VIA ANGELO POLIZIANO 60")).toEqual({ civico: "60", numeroBase: "60" });
      expect(estraiCivico("Via Poliziano, 60")).toEqual({ civico: "60", numeroBase: "60" });
      expect(estraiCivico("Via Roma 10/A")).toEqual({ civico: "10/A", numeroBase: "10" });
      expect(estraiCivico("Via Garibaldi n. 5 scala B")).toEqual({ civico: "5", numeroBase: "5" });
      expect(estraiCivico("Contrada Cerreto SNC")).toEqual({ civico: "SNC", numeroBase: "SNC" });
      expect(estraiCivico("Via della fonte 6 c/o Stadio del Nuoto")).toEqual({ civico: "6", numeroBase: "6" });
      expect(estraiCivico("Via della Fonte, 38")).toEqual({ civico: "38", numeroBase: "38" });
      expect(estraiCivico("Via 24 Maggio 15")).toEqual({ civico: "15", numeroBase: "15" });
    });

    it("estrae il toponimo principale della via", () => {
      expect(estraiOdonomastico("VIA ANGELO POLIZIANO 60").coreToken).toBe("POLIZIANO");
      expect(estraiOdonomastico("Via Poliziano, 60").coreToken).toBe("POLIZIANO");
      expect(estraiOdonomastico("Via A. Poliziano 60").coreToken).toBe("POLIZIANO");
      expect(estraiOdonomastico("Via Giuseppe Garibaldi 12").coreToken).toBe("GARIBALDI");
      expect(estraiOdonomastico("Via G. Garibaldi 12").coreToken).toBe("GARIBALDI");
      expect(estraiOdonomastico("Via Garibaldi 12").coreToken).toBe("GARIBALDI");
      expect(estraiOdonomastico("Corso Vittorio Emanuele 5").coreToken).toBe("EMANUELE");
    });
  });

  describe("sonoIndirizziCompatibili (somiglianza toponomastica)", () => {
    it("riconosce come compatibili 'VIA ANGELO POLIZIANO 60' e 'Via Poliziano, 60' (caso utente)", () => {
      const a = { indirizzo: "VIA ANGELO POLIZIANO 60", cap: "00013", citta: "Fonte Nuova", prov: "RM" };
      const b = { indirizzo: "Via Poliziano, 60", cap: "00013", citta: "Fonte Nuova", prov: "RM" };
      expect(sonoIndirizziCompatibili(a, b)).toBe(true);
    });

    it("riconosce varianti con nome completo o solo cognome / iniziale", () => {
      const a = { indirizzo: "Via Giuseppe Garibaldi 12", cap: "00100", citta: "Roma" };
      const b = { indirizzo: "Via G. Garibaldi, 12", cap: "00100", citta: "Roma" };
      const c = { indirizzo: "Via Garibaldi 12", cap: "00100", citta: "Roma" };
      expect(sonoIndirizziCompatibili(a, b)).toBe(true);
      expect(sonoIndirizziCompatibili(b, c)).toBe(true);
      expect(sonoIndirizziCompatibili(a, c)).toBe(true);
    });

    it("accetta sub-civico (es. 60 e 60/A)", () => {
      const a = { indirizzo: "Via Poliziano 60", cap: "00013", citta: "Fonte Nuova" };
      const b = { indirizzo: "Via Poliziano 60/A", cap: "00013", citta: "Fonte Nuova" };
      expect(sonoIndirizziCompatibili(a, b)).toBe(true);
    });

    it("rifiuta numeri civici diversi sulla stessa via (es. 60 vs 62)", () => {
      const a = { indirizzo: "VIA ANGELO POLIZIANO 60", cap: "00013", citta: "Fonte Nuova" };
      const b = { indirizzo: "Via Poliziano, 62", cap: "00013", citta: "Fonte Nuova" };
      expect(sonoIndirizziCompatibili(a, b)).toBe(false);
    });

    it("rifiuta civici diversi sulla stessa via anche con c/o o note accessorie (caso Fonte 38 vs Fonte 6 c/o Stadio)", () => {
      const a = { indirizzo: "Via della Fonte, 38", cap: "00015", citta: "Monterotondo", prov: "RM" };
      const b = { indirizzo: "Via della fonte 6 c/o Stadio del Nuoto", cap: "00015", citta: "Monterotondo", prov: "RM" };
      expect(sonoIndirizziCompatibili(a, b)).toBe(false);
      expect(chiaveIndirizzoConfronto(a)).not.toBe(chiaveIndirizzoConfronto(b));
    });

    it("rifiuta vie diverse nella stessa città con lo stesso civico", () => {
      const a = { indirizzo: "Via Roma 10", cap: "00013", citta: "Fonte Nuova" };
      const b = { indirizzo: "Via Milano 10", cap: "00013", citta: "Fonte Nuova" };
      expect(sonoIndirizziCompatibili(a, b)).toBe(false);
    });

    it("rifiuta date diverse nel nome della via (es. 24 Maggio vs 1 Maggio)", () => {
      const a = { indirizzo: "Via 24 Maggio 10", cap: "00100", citta: "Roma" };
      const b = { indirizzo: "Via 1 Maggio 10", cap: "00100", citta: "Roma" };
      expect(sonoIndirizziCompatibili(a, b)).toBe(false);
    });
  });

  describe("chiaveIndirizzoConfronto", () => {
    it("genera la stessa chiave canonica per 'VIA ANGELO POLIZIANO 60' e 'Via Poliziano, 60'", () => {
      const a = { indirizzo: "VIA ANGELO POLIZIANO 60", cap: "00013", citta: "Fonte Nuova" };
      const b = { indirizzo: "Via Poliziano, 60", cap: "00013", citta: "Fonte Nuova" };
      expect(chiaveIndirizzoConfronto(a)).toBe(chiaveIndirizzoConfronto(b));
    });

    it("genera la stessa chiave per indirizzi equivalenti formattati diversamente", () => {
      const a = { indirizzo: "Via Dante, 12", cap: "20121", citta: "Milano" };
      const b = { indirizzo: "via dante 12", cap: "20121", citta: "MILANO" };
      expect(chiaveIndirizzoConfronto(a)).toBe(chiaveIndirizzoConfronto(b));
    });

    it("differenzia numeri civici diversi", () => {
      const a = { indirizzo: "Via Dante, 12", cap: "20121", citta: "Milano" };
      const b = { indirizzo: "Via Dante, 14", cap: "20121", citta: "Milano" };
      expect(chiaveIndirizzoConfronto(a)).not.toBe(chiaveIndirizzoConfronto(b));
    });

    it("restituisce stringa vuota se l'indirizzo o la città mancano", () => {
      expect(chiaveIndirizzoConfronto({ indirizzo: "", cap: "20121", citta: "Milano" })).toBe("");
      expect(chiaveIndirizzoConfronto({ indirizzo: "Via Dante 12", cap: "20121", citta: "" })).toBe("");
      expect(chiaveIndirizzoConfronto({})).toBe("");
    });
  });

  describe("unisciNoteSpedizione", () => {
    it("unisce le note deduplicando quelle equivalenti", () => {
      const note = ["Citofonare piano 2", "Citofonare Piano 2", "Lasciare al portiere", ""];
      expect(unisciNoteSpedizione(note)).toBe("Citofonare piano 2 - Lasciare al portiere");
    });

    it("restituisce stringa vuota se non ci sono note valide", () => {
      expect(unisciNoteSpedizione([undefined, null, "   ", ""])).toBe("");
    });
  });

  describe("formattaIndirizzoSintetico", () => {
    it("compone correttamente via, cap, città e provincia", () => {
      expect(
        formattaIndirizzoSintetico({
          indirizzo: "Via Garibaldi 5",
          cap: "80100",
          citta: "Napoli",
          prov: "NA",
        }),
      ).toBe("Via Garibaldi 5 · 80100 Napoli (NA)");
    });

    it("restituisce 'Indirizzo mancante' se vuoto", () => {
      expect(formattaIndirizzoSintetico({})).toBe("Indirizzo mancante");
    });
  });

  describe("raggruppaPerIndirizzoCompatibile", () => {
    it("raggruppa ordini con varianti di indirizzo compatibili (es. Licia Bidenti e Silvio Monaco)", () => {
      const ordini = [
        { ordineId: "1", clienteId: "cli-1", clienteNome: "Licia Bidenti", indirizzo: "VIA ANGELO POLIZIANO 60", cap: "00013", citta: "Fonte Nuova" },
        { ordineId: "2", clienteId: "cli-2", clienteNome: "Silvio Monaco", indirizzo: "Via Poliziano, 60", cap: "00013", citta: "Fonte Nuova" },
        { ordineId: "3", clienteId: "cli-3", clienteNome: "Altro Cliente", indirizzo: "Via Roma 1", cap: "00013", citta: "Fonte Nuova" },
      ];

      const gruppi = raggruppaPerIndirizzoCompatibile(ordini, (o) => o);
      expect(gruppi.length).toBe(2);

      const gruppoPoliziano = gruppi.find((g) => g.some((o) => o.clienteNome === "Licia Bidenti"))!;
      expect(gruppoPoliziano.length).toBe(2);
      expect(gruppoPoliziano.map((o) => o.clienteNome)).toContain("Licia Bidenti");
      expect(gruppoPoliziano.map((o) => o.clienteNome)).toContain("Silvio Monaco");
    });
  });
});
