import { describe, expect, it, vi } from "vitest";
import {
  applicaPreferenzeSuggerimenti,
  bundleDopoRipristino,
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

describe("salvataggio delle preferenze suggerimenti", () => {
  it("passa da preferenze modificate ai default soltanto dopo il ripristino backend", async () => {
    const modificate = { ...PREFERENZE_SUGGERIMENTI_DEFAULT, notificheAttive: false };
    let persistite = modificate;
    const ripristina = vi.fn(async () => {
      expect(persistite).toEqual(modificate);
    });
    await applicaPreferenzeSuggerimenti(
      PREFERENZE_SUGGERIMENTI_DEFAULT, 2026, true, ripristina,
      (value) => { persistite = value; },
    );
    expect(ripristina).toHaveBeenCalledOnce();
    expect(persistite).toEqual(PREFERENZE_SUGGERIMENTI_DEFAULT);
  });

  it("ripristina al Salva anche con valori già predefiniti", async () => {
    const ripristina = vi.fn(async () => {});
    const salva = vi.fn();
    await applicaPreferenzeSuggerimenti(
      PREFERENZE_SUGGERIMENTI_DEFAULT, 2026, true, ripristina, salva,
    );
    expect(ripristina).toHaveBeenCalledWith({
      ...PREFERENZE_SUGGERIMENTI_DEFAULT, anno: 2026,
    });
    expect(salva).toHaveBeenCalledWith(PREFERENZE_SUGGERIMENTI_DEFAULT);
  });

  it("salva una modifica ordinaria senza ripristinare i timer", async () => {
    const ripristina = vi.fn(async () => {});
    const salva = vi.fn();
    const modificate = { ...PREFERENZE_SUGGERIMENTI_DEFAULT, notificheAttive: false };
    await applicaPreferenzeSuggerimenti(modificate, 2026, false, ripristina, salva);
    expect(ripristina).not.toHaveBeenCalled();
    expect(salva).toHaveBeenCalledWith(modificate);
  });

  it("un errore backend non persiste la bozza", async () => {
    const ripristina = vi.fn(async () => { throw new Error("backend"); });
    const salva = vi.fn();
    await expect(applicaPreferenzeSuggerimenti(
      PREFERENZE_SUGGERIMENTI_DEFAULT, 2026, true, ripristina, salva,
    )).rejects.toThrow("backend");
    expect(salva).not.toHaveBeenCalled();
  });

  it("riattiva subito le schede dopo il ripristino riuscito", () => {
    expect(bundleDopoRipristino({
      suggerimenti: [], nascosti: ["s14:rimborso:x"], tipiInPausa: ["rimborso"],
    })).toEqual({ suggerimenti: [], nascosti: [], tipiInPausa: [] });
  });
});
