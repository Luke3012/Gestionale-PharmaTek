import { beforeEach, describe, expect, it } from "vitest";
import type { SpedizioneRiepilogo } from "../../lib/tauri";
import { clearRiepilogoCache, conservaRiepiloghiLotti, memorizzaRiepilogo, riepilogoMemorizzato } from "./cacheRiepilogo";

const riepilogo: SpedizioneRiepilogo = {
  giaIncassato: 100, daIncassare: 200, totale: 300, perConto: [], perAgente: [],
};

describe("cache del riepilogo contabile delle spedizioni", () => {
  beforeEach(clearRiepilogoCache);

  it("elimina solo i lotti usciti dall'elenco completo, senza dipendere dai filtri", () => {
    memorizzaRiepilogo("visibile", "firma", riepilogo);
    memorizzaRiepilogo("nascosto", "firma", riepilogo);
    memorizzaRiepilogo("eliminato", "firma", riepilogo);
    conservaRiepiloghiLotti(new Set(["visibile", "nascosto"]));
    expect(riepilogoMemorizzato("visibile", "firma")).toBe(riepilogo);
    expect(riepilogoMemorizzato("nascosto", "firma")).toBe(riepilogo);
    expect(riepilogoMemorizzato("eliminato", "firma")).toBeNull();
  });

  it("riusa il riepilogo quando i dati contabili del lotto non cambiano", () => {
    memorizzaRiepilogo("lotto", "contabilita-1", riepilogo);
    expect(riepilogoMemorizzato("lotto", "contabilita-1")).toBe(riepilogo);
    expect(riepilogoMemorizzato("altro-lotto", "contabilita-1")).toBeNull();
  });

  it("invalida solo il lotto cambiato e sostituisce la sua versione precedente", () => {
    memorizzaRiepilogo("lotto", "contabilita-1", riepilogo);
    memorizzaRiepilogo("altro", "contabilita-1", riepilogo);
    expect(riepilogoMemorizzato("lotto", "contabilita-2")).toBeNull();
    expect(riepilogoMemorizzato("altro", "contabilita-1")).toBe(riepilogo);
    const aggiornato = { ...riepilogo, totale: 400 };
    memorizzaRiepilogo("lotto", "contabilita-2", aggiornato);
    expect(riepilogoMemorizzato("lotto", "contabilita-1")).toBeNull();
    expect(riepilogoMemorizzato("lotto", "contabilita-2")).toBe(aggiornato);
    clearRiepilogoCache();
    expect(riepilogoMemorizzato("lotto", "contabilita-2")).toBeNull();
  });
});
