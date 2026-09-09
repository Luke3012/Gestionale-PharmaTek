import { afterEach, describe, expect, it, vi } from "vitest";
import { creaIdCasuale } from "./idCasuale";

describe("ID casuale", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("usa randomUUID quando disponibile", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-controllato" });
    expect(creaIdCasuale()).toBe("uuid-controllato");
  });

  it("mantiene il fallback basato su timestamp e parte casuale", () => {
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Date, "now").mockReturnValue(123);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(creaIdCasuale()).toBe(`123-${(0.5).toString(36).slice(2)}`);
  });
});
