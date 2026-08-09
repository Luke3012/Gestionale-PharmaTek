import { describe, expect, it } from "vitest";
import type { DedupClientiAutoPlan } from "../anagrafiche/deduplicazione";
import type { RecordDto, Suggerimento } from "../../lib/tauri";
import {
  combinaSuggerimenti,
  ordinaSuggerimenti,
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
        },
        duplicati,
        ["rimborso"],
      ).map((item) => item.id),
    ).toEqual([rimborso.id]);
  });
});
