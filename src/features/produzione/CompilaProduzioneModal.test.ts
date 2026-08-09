import { describe, expect, it } from "vitest";
import {
  patchProduzione,
  rilevaRigheNonValide,
} from "./CompilaProduzioneModal";
import type { RecordDto } from "../../lib/tauri";

describe("salvataggio concorrente della produzione", () => {
  const iniziale = {
    formulazione: "Formula A",
    posologia: "1 al giorno",
    allergeni: ["A"],
  };

  it("scrive soltanto i campi realmente modificati dall'utente", () => {
    expect(
      patchProduzione(iniziale, { ...iniziale, posologia: "2 al giorno" })
    ).toEqual({ posologia: "2 al giorno" });
  });

  it("la patch dell'ultimo salvataggio contiene il campo locale modificato", () => {
    expect(
      patchProduzione(iniziale, { ...iniziale, posologia: "2 al giorno" })
    ).toEqual({ posologia: "2 al giorno" });
  });

  it("segnala insieme righe eliminate, spedite e già lavorate", () => {
    const riga = (id: string, data: Record<string, unknown>, deleted = false): RecordDto => ({
      id,
      revision: "1",
      data,
      deleted,
    });
    expect(
      rilevaRigheNonValide(
        ["ok", "mancante", "eliminata", "spedita", "spedizione", "lavorata", "lotto"],
        [
          riga("ok", {}),
          riga("eliminata", {}, true),
          riga("spedita", { stato_riga: "spedita" }),
          riga("spedizione", { spedizione_id: "s1" }),
          riga("lavorata", { stato_produzione: "in_produzione" }),
          riga("lotto", { lotto_produzione: "l1" }),
        ]
      )
    ).toEqual([
      { id: "mancante", motivo: "eliminata" },
      { id: "eliminata", motivo: "eliminata" },
      { id: "spedita", motivo: "spedita" },
      { id: "spedizione", motivo: "spedita" },
      { id: "lavorata", motivo: "lavorata" },
      { id: "lotto", motivo: "lavorata" },
    ]);
  });
});
