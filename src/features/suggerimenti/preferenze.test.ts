import { describe, expect, it } from "vitest";
import {
  normalizzaPreferenzeSuggerimenti,
  PREFERENZE_SUGGERIMENTI_DEFAULT,
  TIPI_SUGGERIMENTO,
} from "./preferenze";

describe("preferenze locali azioni suggerite", () => {
  it("usa default completi per dati assenti o non validi", () => {
    expect(normalizzaPreferenzeSuggerimenti(null)).toEqual(
      PREFERENZE_SUGGERIMENTI_DEFAULT,
    );
  });

  it("scarta categorie sconosciute e limita i giorni a 0..90", () => {
    const value = normalizzaPreferenzeSuggerimenti({
      tipiAbilitati: ["rimborso", "sconosciuto"],
      notificheAttive: false,
      giorniAvviso: {
        rimborso: -5,
        distinta: 200,
        provvigione: 2.7,
      },
    });
    expect(value.tipiAbilitati).toEqual(["rimborso"]);
    expect(value.notificheAttive).toBe(false);
    expect(value.giorniAvviso.rimborso).toBe(0);
    expect(value.giorniAvviso.distinta).toBe(90);
    expect(value.giorniAvviso.provvigione).toBe(3);
    expect(Object.keys(value.giorniAvviso)).toHaveLength(
      TIPI_SUGGERIMENTO.length,
    );
  });
});
