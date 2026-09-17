import { describe, expect, it } from "vitest";
import {
  calcolaScadRelGiorni,
  calcolaValoreToggleCod,
} from "./useScadenzarioEditor";

describe("useScadenzarioEditor", () => {
  describe("calcolaValoreToggleCod", () => {
    it("quando viene attivato, azzera l'acconto", () => {
      const res = calcolaValoreToggleCod(false, "Keriba", 50_000);
      expect(res.prossimoCod).toBe(true);
      expect(res.prossimoAcconto).toBe("");
    });

    it("quando viene disattivato su Keriba, ripristina l'acconto pari al totale", () => {
      const res = calcolaValoreToggleCod(true, "Keriba", 50_000);
      expect(res.prossimoCod).toBe(false);
      expect(res.prossimoAcconto).toBe(500);
    });

    it("quando viene disattivato su altra linea, imposta acconto vuoto", () => {
      const res = calcolaValoreToggleCod(true, "Immunoterapia", 50_000);
      expect(res.prossimoCod).toBe(false);
      expect(res.prossimoAcconto).toBe("");
    });
  });

  describe("calcolaScadRelGiorni", () => {
    it("assegna la corretta progressione a passi di 30 giorni", () => {
      expect(calcolaScadRelGiorni(0, 0)).toBe(0);
      expect(calcolaScadRelGiorni(1, 0)).toBe(30);
      expect(calcolaScadRelGiorni(2, 0)).toBe(60);
    });

    it("rispetta l'offset base dei pagamenti già presenti sull'ordine", () => {
      expect(calcolaScadRelGiorni(0, 1)).toBe(30);
      expect(calcolaScadRelGiorni(1, 1)).toBe(60);
      expect(calcolaScadRelGiorni(0, 2)).toBe(60);
    });

    it("preserva il relEsistente se già valido e maggiore di zero", () => {
      expect(calcolaScadRelGiorni(0, 0, 90)).toBe(90);
      expect(calcolaScadRelGiorni(1, 2, 45)).toBe(45);
    });
  });
});
