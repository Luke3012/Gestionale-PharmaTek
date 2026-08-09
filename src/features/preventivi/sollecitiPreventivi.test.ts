import { describe, expect, it } from "vitest";
import { classificaSollecitiPreventivi } from "./sollecitiPreventivi";

const GIORNO_MS = 24 * 60 * 60 * 1_000;
const OGGI = Date.UTC(2026, 6, 26, 12);

function preventivo(
  overrides: Partial<{
    id: string;
    ordineStato: string;
    indicazioneInvio: string;
    ultimoInvioMs: number;
    ultimoSollecitoMs: number;
  }> = {},
) {
  return {
    id: "p1",
    ordineStato: "Nuovo",
    indicazioneInvio: "inviato",
    ultimoInvioMs: OGGI - 8 * GIORNO_MS,
    ultimoSollecitoMs: 0,
    ...overrides,
  };
}

describe("classificaSollecitiPreventivi", () => {
  it("include il preventivo inviato che ha raggiunto la soglia", () => {
    const risultato = classificaSollecitiPreventivi([preventivo()], 7, OGGI);
    expect(risultato.daSollecitare).toHaveLength(1);
    expect(risultato.totale).toBe(1);
  });

  it("esclude dai solleciti ordini non Nuovi e invii troppo recenti", () => {
    const candidati = classificaSollecitiPreventivi(
      [
        preventivo({ id: "non-nuovo", ordineStato: "In lavorazione" }),
        preventivo({ id: "recente", ultimoInvioMs: OGGI - 6 * GIORNO_MS }),
      ],
      7,
      OGGI,
    );
    expect(candidati.daSollecitare).toEqual([]);
    expect(candidati.totale).toBe(0);
  });

  it("include subito mai inviati e modificati anche per ordini avanzati", () => {
    const risultato = classificaSollecitiPreventivi(
      [
        preventivo({
          id: "nuovo",
          indicazioneInvio: "mai_inviato",
          ultimoInvioMs: 0,
        }),
        preventivo({
          id: "modificato",
          ordineStato: "In produzione",
          indicazioneInvio: "modificato_dopo_invio",
        }),
      ],
      7,
      OGGI,
    );
    expect(risultato.daInviare.map((item) => item.id)).toEqual([
      "nuovo",
      "modificato",
    ]);
    expect(risultato.daSollecitare).toEqual([]);
    expect(risultato.totale).toBe(2);
  });

  it("fa ripartire la soglia dall'ultimo sollecito positivo", () => {
    const voce = preventivo({ ultimoSollecitoMs: OGGI - 2 * GIORNO_MS });
    expect(
      classificaSollecitiPreventivi([voce], 7, OGGI).daSollecitare,
    ).toEqual([]);
    expect(
      classificaSollecitiPreventivi(
        [{ ...voce, ultimoSollecitoMs: OGGI - 8 * GIORNO_MS }],
        7,
        OGGI,
      ).daSollecitare,
    ).toHaveLength(1);
  });
});
