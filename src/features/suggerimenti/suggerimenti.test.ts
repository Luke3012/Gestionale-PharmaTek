import { describe, expect, it } from "vitest";
import type {
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
  suggerimentoHaRaggiuntoSoglia,
} from "./suggerimenti";

function voce(id: string, priorita: number, riferimentoData = "2026-08-01"): Suggerimento {
  return {
    id,
    tipo: "rimborso",
    titolo: id,
    dettaglio: "",
    azioneLabel: "",
    priorita,
    collegamento: { path: "/" },
    riferimentoData,
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

  it("invalida fotografie e richieste manuali quando cambia l'anno di lavoro", async () => {
    invalidaControlloManualeSuggerimenti();
    statoControlloManualeSuggerimenti(2025);
    let completa!: (bundle: SuggerimentiBundle) => void;
    const richiesta = avviaControlloManualeSuggerimenti(
      () =>
        new Promise<SuggerimentiBundle>((resolve) => {
          completa = resolve;
        }),
    );

    expect(statoControlloManualeSuggerimenti(2026).inCorso).toBeNull();
    completa({
      suggerimenti: [voce("s14:rimborso:2025", 90)],
      nascosti: [],
      tipiInPausa: [],
    });

    await expect(richiesta).resolves.toBeNull();
    expect(statoControlloManualeSuggerimenti(2026).bundle).toBeNull();
    invalidaControlloManualeSuggerimenti();
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
        ["rimborso"],
      ).map((item) => item.id),
    ).toEqual([bassa.id]);
  });

  it("filtra le card nella Dashboard se non hanno ancora raggiunto i giorni di soglia", () => {
    const oggi = "2026-09-16";
    const recente = voce("s14:rimborso:recente", 90, "2026-09-15"); // 1 giorno fa
    const matura = voce("s14:rimborso:matura", 92, "2026-09-10"); // 6 giorni fa

    expect(suggerimentoHaRaggiuntoSoglia(recente, 3, oggi)).toBe(false);
    expect(suggerimentoHaRaggiuntoSoglia(matura, 3, oggi)).toBe(true);

    const risultato = combinaSuggerimenti(
      {
        suggerimenti: [recente, matura],
        nascosti: [],
        tipiInPausa: [],
      },
      ["rimborso"],
      { rimborso: 3 },
      new Set(),
      oggi,
    );
    expect(risultato.map((item) => item.id)).toEqual([matura.id]);
  });

  it("mostra comunque le card sotto soglia se forzate dal click Controlla ora (temporanei)", () => {
    const oggi = "2026-09-16";
    const recente = voce("s14:rimborso:recente", 90, "2026-09-15"); // 1 giorno fa
    const temporanei = new Set([recente.id]);

    const risultato = combinaSuggerimenti(
      {
        suggerimenti: [recente],
        nascosti: [],
        tipiInPausa: [],
      },
      ["rimborso"],
      { rimborso: 3 },
      temporanei,
      oggi,
    );
    expect(risultato.map((item) => item.id)).toEqual([recente.id]);
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
        ["rimborso"],
      ),
    ).toEqual([]);
  });
});
