import { describe, expect, it } from "vitest";
import type { DedupClientiAutoPlan } from "../anagrafiche/deduplicazione";
import type {
  RecordDto,
  Suggerimento,
  SuggerimentiBundle,
} from "../../lib/tauri";
import {
  avviaControlloManualeSuggerimenti,
  combinaSuggerimenti,
  invalidaControlloManualeSuggerimenti,
  ordinaSuggerimenti,
  riconciliaControlloManualeSuggerimenti,
  statoControlloManualeSuggerimenti,
  suggerimentoDuplicatiDaPiano,
} from "./suggerimenti";

function record(id: string, revision = "1"): RecordDto {
  return { id, revision, data: { nome: id }, deleted: false };
}

function voce(id: string, priorita: number): Suggerimento {
  return {
    id,
    tipo: "rimborso",
    titolo: id,
    dettaglio: "",
    azioneLabel: "",
    priorita,
    collegamento: { path: "/" },
    riferimentoData: "2026-08-01",
    aggiornatoMs: 1,
  };
}

describe("suggerimenti FASE 14", () => {
  it("mantiene il controllo manuale tra due montaggi senza duplicare il calcolo", async () => {
    invalidaControlloManualeSuggerimenti();
    let completa!: (bundle: SuggerimentiBundle) => void;
    let caricamenti = 0;
    const caricamento = () => {
      caricamenti += 1;
      return new Promise<SuggerimentiBundle>((resolve) => {
        completa = resolve;
      });
    };

    const primaVista = avviaControlloManualeSuggerimenti(caricamento);
    const secondaVista = statoControlloManualeSuggerimenti().inCorso;
    expect(secondaVista).toBe(primaVista);
    expect(avviaControlloManualeSuggerimenti(caricamento)).toBe(primaVista);
    expect(caricamenti).toBe(1);

    const bundle: SuggerimentiBundle = {
      suggerimenti: [voce("s14:rimborso:manuale", 90)],
      nascosti: [],
      tipiInPausa: [],
    };
    completa(bundle);
    await expect(secondaVista!).resolves.toBe(bundle);
    expect(statoControlloManualeSuggerimenti().bundle).toBe(bundle);
    expect([
      ...statoControlloManualeSuggerimenti().temporanei,
    ]).toEqual(["s14:rimborso:manuale"]);
    expect(statoControlloManualeSuggerimenti().inCorso).toBeNull();
    invalidaControlloManualeSuggerimenti();
  });

  it("non pubblica un controllo manuale superato da nuovi dati", async () => {
    invalidaControlloManualeSuggerimenti();
    let completa!: (bundle: SuggerimentiBundle) => void;
    const richiesta = avviaControlloManualeSuggerimenti(
      () =>
        new Promise<SuggerimentiBundle>((resolve) => {
          completa = resolve;
        }),
    );
    invalidaControlloManualeSuggerimenti();
    completa({ suggerimenti: [], nascosti: [], tipiInPausa: [] });

    await expect(richiesta).resolves.toBeNull();
    expect(statoControlloManualeSuggerimenti()).toEqual({
      bundle: null,
      temporanei: new Set(),
      inCorso: null,
    });
  });

  it("sostituisce soltanto le categorie ordinarie appena arrivate", async () => {
    invalidaControlloManualeSuggerimenti();
    const rimborsoTemporaneo = voce("s14:rimborso:temporaneo", 90);
    const spedizioneTemporanea: Suggerimento = {
      ...voce("s14:spedizione:temporanea", 80),
      tipo: "spedizione",
    };
    await avviaControlloManualeSuggerimenti(async () => ({
      suggerimenti: [rimborsoTemporaneo, spedizioneTemporanea],
      nascosti: [],
      tipiInPausa: [],
    }));

    const rimborsoNuovo = voce("s14:rimborso:nuovo", 95);
    const riconciliati = riconciliaControlloManualeSuggerimenti({
      suggerimenti: [rimborsoNuovo],
      nascosti: [],
      tipiInPausa: [],
    });

    expect(riconciliati.suggerimenti.map((item) => item.id)).toEqual([
      rimborsoNuovo.id,
      spedizioneTemporanea.id,
    ]);
    expect([...statoControlloManualeSuggerimenti().temporanei]).toEqual([
      spedizioneTemporanea.id,
    ]);
    invalidaControlloManualeSuggerimenti();
  });

  it("riusa il piano dedup e cambia id quando cambia una sorgente", () => {
    const piano = (revision: string): DedupClientiAutoPlan => ({
      merges: [
        {
          canonico: record("c1", revision),
          duplicati: [record("c2")],
          fields: {},
          motivo: "cf",
        },
      ],
      sospetti: 0,
      protetti: 0,
    });
    const prima = suggerimentoDuplicatiDaPiano(piano("1"));
    const stessa = suggerimentoDuplicatiDaPiano(piano("1"));
    const cambiata = suggerimentoDuplicatiDaPiano(piano("2"));
    expect(prima?.id).toBe(stessa?.id);
    expect(prima?.id).not.toBe(cambiata?.id);
    expect(prima?.dettaglio).toContain("2 anagrafiche");
  });

  it("ordina per priorità e non duplica o ripropone uno stato nascosto", () => {
    const alta = voce("s14:rimborso:a", 90);
    const bassa = voce("s14:rimborso:b", 20);
    expect(ordinaSuggerimenti([bassa, alta]).map((item) => item.id)).toEqual([
      alta.id,
      bassa.id,
    ]);
    expect(
      combinaSuggerimenti(
        {
          suggerimenti: [alta, alta, bassa],
          nascosti: [alta.id],
          tipiInPausa: [],
        },
        null,
        ["rimborso"],
      ).map((item) => item.id),
    ).toEqual([bassa.id]);
  });

  it("applica le categorie locali anche al suggerimento duplicati", () => {
    const rimborso = voce("s14:rimborso:a", 90);
    const duplicati: Suggerimento = {
      ...voce("s14:duplicati:a", 50),
      tipo: "duplicati",
    };
    expect(
      combinaSuggerimenti(
        {
          suggerimenti: [rimborso],
          nascosti: [],
          tipiInPausa: [],
        },
        duplicati,
        ["rimborso"],
      ).map((item) => item.id),
    ).toEqual([rimborso.id]);
  });

  it("non ripropone subito nuove fotografie della categoria ignorata", () => {
    const nuovaFotografia = voce("s14:rimborso:nuova-fotografia", 95);
    expect(
      combinaSuggerimenti(
        {
          suggerimenti: [nuovaFotografia],
          nascosti: [],
          tipiInPausa: ["rimborso"],
        },
        null,
        ["rimborso"],
      ),
    ).toEqual([]);
  });
});
