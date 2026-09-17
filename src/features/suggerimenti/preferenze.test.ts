import { describe, expect, it } from "vitest";
import {
  normalizzaPreferenzeSuggerimenti,
  PREFERENZE_SUGGERIMENTI_DEFAULT,
  TIPI_SUGGERIMENTO,
} from "./preferenze";

describe("preferenze locali azioni suggerite", () => {
  it("usa default completi per dati assenti o non validi con le nuove soglie", () => {
    expect(normalizzaPreferenzeSuggerimenti(null)).toEqual(
      PREFERENZE_SUGGERIMENTI_DEFAULT,
    );
    expect(PREFERENZE_SUGGERIMENTI_DEFAULT.tipiAbilitati).toEqual([
      "rimborso",
      "distinta",
      "produzione",
      "spedizione",
    ]);
    expect(PREFERENZE_SUGGERIMENTI_DEFAULT.giorniAvviso).toEqual({
      rimborso: 3,
      distinta: 20,
      provvigione: 7,
      produzione: 3,
      spedizione: 3,
      preventivo: 7,
    });
  });

  it("scarta categorie sconosciute e duplicati, e limita i giorni a 0..90", () => {
    const value = normalizzaPreferenzeSuggerimenti({
      tipiAbilitati: ["rimborso", "duplicati", "sconosciuto"],
      notificheAttive: false,
      giorniAvviso: {
        rimborso: -5,
        distinta: 200,
        provvigione: 2.7,
        duplicati: 15,
      },
    });
    expect(value.tipiAbilitati).toEqual(["rimborso"]);
    expect(value.notificheAttive).toBe(false);
    expect(value.giorniAvviso.rimborso).toBe(0);
    expect(value.giorniAvviso.distinta).toBe(90);
    expect(value.giorniAvviso.provvigione).toBe(3);
    expect((value.giorniAvviso as Record<string, unknown>).duplicati).toBeUndefined();
    expect(Object.keys(value.giorniAvviso)).toHaveLength(
      TIPI_SUGGERIMENTO.length,
    );
  });
});
