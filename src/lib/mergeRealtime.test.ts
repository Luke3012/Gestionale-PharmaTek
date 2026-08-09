import { describe, expect, it } from "vitest";
import { mergeRealtimeSelettivo } from "./mergeRealtime";

describe("merge real-time selettivo", () => {
  const base = { importo: 100, note: "iniziali" };

  it("aggiorna i campi non toccati e conserva quelli locali", () => {
    expect(
      mergeRealtimeSelettivo(
        base,
        { importo: 120, note: "iniziali" },
        { importo: 100, note: "remote" }
      )
    ).toMatchObject({
      valori: { importo: 120, note: "remote" },
      aggiornati: ["note"],
    });
  });

  it("conserva il valore locale sullo stesso campo per il successivo last-save-wins", () => {
    expect(
      mergeRealtimeSelettivo(
        base,
        { importo: 120, note: "iniziali" },
        { importo: 130, note: "iniziali" }
      ).valori
    ).toEqual({ importo: 120, note: "iniziali" });
  });
});
