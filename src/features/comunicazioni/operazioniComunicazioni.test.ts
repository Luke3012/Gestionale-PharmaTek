import { describe, expect, it, vi } from "vitest";
import type { Comunicazione } from "../../lib/tauri";
import { accodaBozzeComunicazione } from "./operazioniComunicazioni";

describe("accodaBozzeComunicazione", () => {
  it("mantiene l'ordine e ignora le comunicazioni non più accodabili", async () => {
    const accoda = vi.fn(async () => undefined);
    const comunicazioni = [
      { id: "prima", stato: "bozza" },
      { id: "inviata", stato: "inviata" },
      { id: "seconda", stato: "da_revisionare" },
    ] as Comunicazione[];

    await accodaBozzeComunicazione(comunicazioni, accoda);

    expect(accoda.mock.calls).toEqual([["prima"], ["seconda"]]);
  });
});
