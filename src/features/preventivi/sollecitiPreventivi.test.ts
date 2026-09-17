import { describe, expect, it } from "vitest";
import { classificaSollecitiPreventivi } from "./sollecitiPreventivi";

const GIORNO_MS = 24 * 60 * 60 * 1_000;
const OGGI = Date.UTC(2026, 6, 26, 12);

function preventivo(
  overrides: Partial<{
    id: string;
    ordineStato: string;
    ordineMarcatore?: string;
    indicazioneInvio: string;
    ultimoInvioMs: number;
    ultimoSollecitoMs: number;
    creatoMs: number;
    ultimaModificaMs: number;
  }> = {},
) {
  return {
    id: "p1",
    ordineStato: "Nuovo",
    indicazioneInvio: "inviato",
    ultimoInvioMs: OGGI - 8 * GIORNO_MS,
    ultimoSollecitoMs: 0,
    creatoMs: OGGI - 10 * GIORNO_MS,
    ultimaModificaMs: 0,
    ...overrides,
  };
}

describe("classificaSollecitiPreventivi", () => {
  it("considera la soglia in giorni civili e non in intervalli esatti di 24 ore", () => {
    const adesso = new Date(2026, 8, 16, 9).getTime();
    const setteGiorniFaDiSera = new Date(2026, 8, 9, 18).getTime();
    const risultato = classificaSollecitiPreventivi(
      [
        preventivo({
          indicazioneInvio: "mai_inviato",
          ultimoInvioMs: 0,
          creatoMs: setteGiorniFaDiSera,
        }),
      ],
      7,
      adesso,
    );
    expect(risultato.daInviare).toHaveLength(1);
  });

  it("con soglia zero rende immediatamente candidabili i preventivi", () => {
    const risultato = classificaSollecitiPreventivi(
      [
        preventivo({
          indicazioneInvio: "mai_inviato",
          ultimoInvioMs: 0,
          creatoMs: OGGI,
        }),
      ],
      0,
      OGGI,
    );
    expect(risultato.daInviare).toHaveLength(1);
  });

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

  it("esclude ordini che hanno una segnalazione attiva", () => {
    const candidati = classificaSollecitiPreventivi(
      [
        preventivo({ id: "urgente", ordineMarcatore: "urgente" }),
        preventivo({ id: "anomalia", ordineMarcatore: "anomalia" }),
        preventivo({ id: "sollecito", ordineMarcatore: "sollecito" }),
      ],
      7,
      OGGI,
    );
    expect(candidati.daSollecitare).toEqual([]);
    expect(candidati.daInviare).toEqual([]);
    expect(candidati.totale).toBe(0);
  });

  it("include mai inviati e modificati solo se hanno raggiunto la soglia e per ordini Nuovi", () => {
    const risultato = classificaSollecitiPreventivi(
      [
        preventivo({
          id: "nuovo-maturo",
          indicazioneInvio: "mai_inviato",
          creatoMs: OGGI - 8 * GIORNO_MS,
          ultimoInvioMs: 0,
        }),
        preventivo({
          id: "nuovo-recente",
          indicazioneInvio: "mai_inviato",
          creatoMs: OGGI - 2 * GIORNO_MS,
          ultimoInvioMs: 0,
        }),
        preventivo({
          id: "modificato-maturo",
          indicazioneInvio: "modificato_dopo_invio",
          ultimaModificaMs: OGGI - 9 * GIORNO_MS,
        }),
        preventivo({
          id: "modificato-non-nuovo",
          ordineStato: "In produzione",
          indicazioneInvio: "modificato_dopo_invio",
          ultimaModificaMs: OGGI - 10 * GIORNO_MS,
        }),
      ],
      7,
      OGGI,
    );
    expect(risultato.daInviare.map((item) => item.id)).toEqual([
      "nuovo-maturo",
      "modificato-maturo",
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
