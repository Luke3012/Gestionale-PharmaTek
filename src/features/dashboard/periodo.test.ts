import { describe, expect, it } from "vitest";
import { descrizionePeriodo, intervalloPeriodo } from "./periodo";

describe("periodi dashboard e anno di lavoro", () => {
  const oggi = new Date(2026, 8, 16);

  it("sposta i preset nel contesto dell'anno selezionato", () => {
    expect(intervalloPeriodo("giorno", oggi, 2024)).toEqual({
      dal: "2024-09-16",
      al: "2024-09-16",
    });
    expect(intervalloPeriodo("mese", oggi, 2024)).toEqual({
      dal: "2024-09-01",
      al: "2024-09-30",
    });
  });

  it("interpreta Tutto come tutto l'anno di lavoro, non tutto l'archivio", () => {
    expect(intervalloPeriodo("tutto", oggi, 2024)).toEqual({
      dal: "2024-01-01",
      al: "2024-12-31",
    });
    expect(intervalloPeriodo("tutto", oggi, 0)).toEqual({ dal: null, al: null });
    expect(descrizionePeriodo("tutto", 2024)).toBe("2024");
    expect(descrizionePeriodo("tutto", 0)).toBe("sempre");
  });
});
