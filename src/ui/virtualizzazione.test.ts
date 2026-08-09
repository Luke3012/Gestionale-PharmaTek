import { describe, expect, it } from "vitest";
import {
  calcolaLayoutVirtuale,
  calcolaRangeVirtuale,
  calcolaSogliaVirtualizzazione,
} from "./virtualizzazione";

describe("calcoli di virtualizzazione condivisi", () => {
  it("attiva la virtualizzazione in base alla capacità del viewport", () => {
    expect(calcolaSogliaVirtualizzazione(300, 58, 4, 2)).toBe(7);
    expect(calcolaSogliaVirtualizzazione(0, 0, 0, 2)).toBe(3);
  });

  it("usa altezze misurate, stime, gap e padding", () => {
    expect(calcolaLayoutVirtuale(["a", "b"], { a: 20 }, 40, 5, 10)).toEqual({
      offsets: [10, 35],
      totale: 85,
    });
  });

  it("mantiene almeno un elemento nel range visibile", () => {
    const layout = calcolaLayoutVirtuale(["a", "b", "c"], {}, 40, 5);
    expect(calcolaRangeVirtuale({
      numeroElementi: 3,
      chiavi: ["a", "b", "c"],
      offsets: layout.offsets,
      altezze: {},
      altezzaStimata: 40,
      overscan: 0,
      viewportTop: 200,
      viewportHeight: 0,
    })).toEqual({ start: 3, end: 3 });
  });

  it("include overscan prima e dopo il viewport", () => {
    const chiavi = ["a", "b", "c", "d"];
    const layout = calcolaLayoutVirtuale(chiavi, {}, 40, 0);
    expect(calcolaRangeVirtuale({
      numeroElementi: 4,
      chiavi,
      offsets: layout.offsets,
      altezze: {},
      altezzaStimata: 40,
      overscan: 1,
      viewportTop: 80,
      viewportHeight: 40,
    })).toEqual({ start: 0, end: 4 });
  });

  it("trova il range corretto in fondo a una lista lunga con altezze miste", () => {
    const chiavi = Array.from({ length: 10_000 }, (_, indice) => `riga-${indice}`);
    const altezze = { "riga-9": 80, "riga-9999": 25 };
    const layout = calcolaLayoutVirtuale(chiavi, altezze, 40, 5);
    const viewportTop = layout.offsets[9_990];

    expect(calcolaRangeVirtuale({
      numeroElementi: chiavi.length,
      chiavi,
      offsets: layout.offsets,
      altezze,
      altezzaStimata: 40,
      overscan: 0,
      viewportTop,
      viewportHeight: 90,
    })).toEqual({ start: 9_990, end: 9_992 });
  });

  it("mantiene gli stessi confini della scansione lineare con misure variabili", () => {
    const chiavi = Array.from({ length: 120 }, (_, indice) => `elemento-${indice}`);
    const altezze = Object.fromEntries(
      chiavi
        .filter((_, indice) => indice % 4 === 0)
        .map((chiave, indice) => [chiave, 24 + (indice % 7) * 9])
    );
    const altezzaStimata = 44;
    const layout = calcolaLayoutVirtuale(chiavi, altezze, altezzaStimata, 6);

    for (let viewportTop = 0; viewportTop <= layout.totale + 100; viewportTop += 37) {
      const minimo = Math.max(0, viewportTop - altezzaStimata * 2);
      const massimo = viewportTop + 180 + altezzaStimata * 2;
      let start = 0;
      while (
        start < chiavi.length
        && layout.offsets[start] + (altezze[chiavi[start]] ?? altezzaStimata) < minimo
      ) {
        start += 1;
      }
      let end = start;
      while (end < chiavi.length && layout.offsets[end] < massimo) end += 1;
      const atteso = {
        start,
        end: Math.min(chiavi.length, Math.max(end, start + 1)),
      };

      expect(calcolaRangeVirtuale({
        numeroElementi: chiavi.length,
        chiavi,
        offsets: layout.offsets,
        altezze,
        altezzaStimata,
        overscan: 2,
        viewportTop,
        viewportHeight: 180,
      })).toEqual(atteso);
    }
  });
});
