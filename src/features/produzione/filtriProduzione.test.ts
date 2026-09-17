import { describe, expect, it } from "vitest";
import type { OrdineDto, RecordDto } from "../../lib/tauri";
import {
  estremiPeriodoProduzione,
  ordineOperativoDiProduzione,
} from "./filtriProduzione";

const ordine = (data: string, stato = "Confermato") =>
  ({ data, stato, linee: ["Immunoterapia"] }) as OrdineDto;

describe("anno delle code Produzione", () => {
  it("lascia Tutto senza limiti e sposta i preset nell'anno scelto", () => {
    const oggi = new Date(2026, 8, 17);
    expect(estremiPeriodoProduzione("tutto", "", "", 2025, oggi)).toBeNull();
    expect(estremiPeriodoProduzione("mese", "", "", 2025, oggi)).toEqual([
      "2025-09-01",
      "2025-09-30",
    ]);
  });

  it("include gli arretrati ed esclude il futuro", () => {
    expect(ordineOperativoDiProduzione(ordine("2024-02-01"), [], 2025)).toBe(true);
    expect(ordineOperativoDiProduzione(ordine("2025-02-01"), [], 2025)).toBe(true);
    expect(ordineOperativoDiProduzione(ordine("2026-02-01"), [], 2025)).toBe(false);
  });

  it("non allarga le regole operative della coda", () => {
    expect(ordineOperativoDiProduzione(ordine("2024-02-01", "Chiuso"), [], 2025)).toBe(false);
    const riga = {
      data: { stato_produzione: "in_produzione", lotto_produzione: "lotto-1" },
    } as unknown as RecordDto;
    expect(ordineOperativoDiProduzione(ordine("2024-02-01", "Chiuso"), [riga], 2025)).toBe(true);
  });
});
