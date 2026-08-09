import { describe, expect, it } from "vitest";
import {
  COLONNE_PREVENTIVI,
  normalizzaColonnePreventivi,
} from "./colonnePreventivi";

describe("preferenze colonne preventivi", () => {
  it("propone Agente e nasconde Stato e Prodotti per impostazione predefinita", () => {
    const stato = normalizzaColonnePreventivi();
    const nascoste = new Set(stato.nascoste);

    expect(stato.ordine).toEqual(
      COLONNE_PREVENTIVI.map((colonna) => colonna.key),
    );
    expect(nascoste.has("ordineStato")).toBe(true);
    expect(nascoste.has("prodotti")).toBe(true);
    expect(nascoste.has("creatoMs")).toBe(false);
    expect(nascoste.has("linee")).toBe(false);
    expect(nascoste.has("agenteNome")).toBe(false);
    expect(stato.ordine).not.toContain("ordineNumero");
    expect(stato.ordine).not.toContain("pazienti");
  });

  it("migra le preferenze locali precedenti conservando ordine e visibilità", () => {
    const ordinePrecedente = [
      "clienteNome",
      "numeroPreventivo",
      "creatoMs",
      "linee",
      "totale",
      "ultimoInvioMs",
    ];
    const stato = normalizzaColonnePreventivi({
      ordine: ordinePrecedente,
      nascoste: ["linee", "chiave-sconosciuta"],
    });

    expect(stato.ordine.slice(0, ordinePrecedente.length)).toEqual(
      ordinePrecedente,
    );
    expect(stato.nascoste).toContain("linee");
    expect(stato.nascoste).toContain("ordineStato");
    expect(stato.nascoste).not.toContain("chiave-sconosciuta");
    expect(new Set(stato.ordine).size).toBe(COLONNE_PREVENTIVI.length);
  });
});
