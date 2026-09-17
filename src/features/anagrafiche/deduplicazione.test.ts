import { describe, expect, it } from "vitest";
import {
  normalizzaNome,
  normalizzaIndirizzo,
  pulisciCap,
  pulisciTelefono,
  pianificaDedupClientiAuto,
} from "./deduplicazione";
import type { RecordDto } from "../../lib/tauri";

function fakeCliente(
  id: string,
  data: Record<string, unknown>,
): RecordDto {
  return {
    id,
    revision: "0",
    data: {
      nome: "",
      indirizzo: "",
      citta: "",
      prov: "",
      cap: "",
      regione: "",
      telefono: "",
      email: "",
      cf: "",
      note_spedizione: "",
      ...data,
    },
    deleted: false,
  };
}

describe("deduplicazione", () => {
  describe("normalizzaNome", () => {
    it("normalizza accenti, titoli e ordina le parole", () => {
      expect(normalizzaNome("Dott Mario Rossi")).toBe("MARIO ROSSI");
      expect(normalizzaNome("rossi mario")).toBe("MARIO ROSSI");
      expect(normalizzaNome("Città di Napoli")).toBe("CITTA DI NAPOLI");
    });
  });

  describe("normalizzaIndirizzo", () => {
    it("rimuove punteggiatura e uniforma spazi", () => {
      expect(normalizzaIndirizzo("  Via  Roma, 10/A. ")).toBe("VIA ROMA 10/A");
    });
  });

  describe("pulisciCap", () => {
    it("gestisce float Excel e padding", () => {
      expect(pulisciCap("96100.0")).toBe("96100");
      expect(pulisciCap("100")).toBe("00100");
    });
  });

  describe("pulisciTelefono", () => {
    it("rimuove prefisso internazionale e spazi", () => {
      expect(pulisciTelefono("+39 333 1234567")).toBe("3331234567");
      expect(pulisciTelefono("0039 06 12345678")).toBe("0612345678");
    });
  });

  describe("pianificaDedupClientiAuto — matching indirizzi strutturato", () => {
    it("NON unisce clienti con civici diversi sulla stessa via (risoluzione del bug dei civici diversi)", () => {
      const clienti = [
        fakeCliente("c1", { nome: "Mario Rossi", indirizzo: "Via Roma 10", citta: "Milano", cap: "20100" }),
        fakeCliente("c2", { nome: "Mario Rossi", indirizzo: "Via Roma 50", citta: "Milano", cap: "20100" }),
      ];
      const plan = pianificaDedupClientiAuto(clienti, []);
      // In assenza di telefono o email coincidenti, civici diversi (10 != 50) non devono essere uniti
      expect(plan.merges.length).toBe(0);
    });

    it("unisce per telefono due clienti con stesso nome anche se hanno civici diversi (es. aggiornamento domicilio)", () => {
      const clienti = [
        fakeCliente("c1", { nome: "Mario Rossi", indirizzo: "Via Roma 10", citta: "Milano", cap: "20100", telefono: "3331234567" }),
        fakeCliente("c2", { nome: "Mario Rossi", indirizzo: "Via Roma 50", citta: "Milano", cap: "20100", telefono: "3331234567" }),
      ];
      const plan = pianificaDedupClientiAuto(clienti, []);
      // Telefono identico nello stesso comune -> unione legittima per telefono
      expect(plan.merges.length).toBe(1);
      expect(plan.merges[0].motivo).toBe("telefono");
    });

    it("unisce clienti con varianti di indirizzo compatibili (come nelle spedizioni)", () => {
      const clienti = [
        fakeCliente("c1", { nome: "Licia Bidenti", indirizzo: "VIA ANGELO POLIZIANO 60", citta: "Fonte Nuova", cap: "00013" }),
        fakeCliente("c2", { nome: "Licia Bidenti", indirizzo: "Via Poliziano, 60", citta: "Fonte Nuova", cap: "00013" }),
      ];
      const plan = pianificaDedupClientiAuto(clienti, []);
      expect(plan.merges.length).toBe(1);
      expect(plan.merges[0].motivo).toBe("indirizzo");
    });

    it("unisce clienti con stesso indirizzo e stesso CAP anche se uno ha la città omessa nel record", () => {
      const clienti = [
        fakeCliente("c1", { nome: "Licia Bidenti", indirizzo: "VIA ANGELO POLIZIANO 60", citta: "Fonte Nuova", cap: "00013" }),
        fakeCliente("c2", { nome: "Licia Bidenti", indirizzo: "Via Poliziano, 60", citta: "", cap: "00013" }),
      ];
      const plan = pianificaDedupClientiAuto(clienti, []);
      expect(plan.merges.length).toBe(1);
      expect(plan.merges[0].motivo).toBe("indirizzo");
    });

    it("NON unisce civici diversi con c/o (es. Fonte 38 vs Fonte 6 c/o Stadio)", () => {
      const clienti = [
        fakeCliente("c1", { nome: "Anna Verdi", indirizzo: "Via della Fonte, 38", citta: "Monterotondo", cap: "00015" }),
        fakeCliente("c2", { nome: "Anna Verdi", indirizzo: "Via della fonte 6 c/o Stadio del Nuoto", citta: "Monterotondo", cap: "00015" }),
      ];
      const plan = pianificaDedupClientiAuto(clienti, []);
      // Civici 38 vs 6 -> non devono essere uniti
      expect(plan.merges.length).toBe(0);
    });

    it("NON unisce omonimi su vie diverse nella stessa città", () => {
      const clienti = [
        fakeCliente("c1", { nome: "Luigi Bianchi", indirizzo: "Via Roma 10", citta: "Roma", cap: "00100" }),
        fakeCliente("c2", { nome: "Luigi Bianchi", indirizzo: "Via Milano 10", citta: "Roma", cap: "00100" }),
      ];
      const plan = pianificaDedupClientiAuto(clienti, []);
      // Senza telefono, email o CF in comune, non devono essere uniti
      expect(plan.merges.length).toBe(0);
    });

    it("unisce per CF identico anche con indirizzi diversi", () => {
      const clienti = [
        fakeCliente("c1", { nome: "Mario Rossi", cf: "RSSMRA80A01H501Z", indirizzo: "Via Roma 10", citta: "Roma" }),
        fakeCliente("c2", { nome: "Mario Rossi", cf: "RSSMRA80A01H501Z", indirizzo: "Via Milano 5", citta: "Roma" }),
      ];
      const plan = pianificaDedupClientiAuto(clienti, []);
      expect(plan.merges.length).toBe(1);
      expect(plan.merges[0].motivo).toBe("cf");
    });

    it("NON unisce per CF diversi", () => {
      const clienti = [
        fakeCliente("c1", { nome: "Mario Rossi", cf: "RSSMRA80A01H501Z", indirizzo: "Via Roma 10", citta: "Roma" }),
        fakeCliente("c2", { nome: "Mario Rossi", cf: "RSSMRA90B02H501X", indirizzo: "Via Roma 10", citta: "Roma" }),
      ];
      const plan = pianificaDedupClientiAuto(clienti, []);
      expect(plan.merges.length).toBe(0);
    });

    it("unisce per email identica anche senza indirizzo", () => {
      const clienti = [
        fakeCliente("c1", { nome: "Giulia Neri", email: "demo@example.invalid" }),
        fakeCliente("c2", { nome: "Giulia Neri", email: "demo@example.invalid" }),
      ];
      const plan = pianificaDedupClientiAuto(clienti, []);
      expect(plan.merges.length).toBe(1);
      expect(plan.merges[0].motivo).toBe("email");
    });
  });
});
