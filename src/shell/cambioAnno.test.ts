import { describe, expect, it } from "vitest";
import { deveProporreCambioAnno } from "./cambioAnno";

describe("richiesta cambio anno", () => {
  it("propone il passaggio da un anno passato a quello corrente", () => {
    expect(deveProporreCambioAnno(2025, 2026, null)).toBe(true);
  });

  it("non lo propone per tutti gli anni, l'anno corrente o un anno futuro", () => {
    expect(deveProporreCambioAnno(0, 2026, null)).toBe(false);
    expect(deveProporreCambioAnno(2026, 2026, null)).toBe(false);
    expect(deveProporreCambioAnno(2027, 2026, null)).toBe(false);
  });

  it("non lo ripropone dopo che il passaggio e stato completato nello stesso anno", () => {
    expect(deveProporreCambioAnno(2025, 2026, "2026")).toBe(false);
  });
});
