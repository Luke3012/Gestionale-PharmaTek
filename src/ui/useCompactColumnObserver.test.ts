import { describe, expect, it } from "vitest";
import { richiedeColonnaCompatta } from "./useCompactColumnObserver";

describe("misurazione colonne compatte", () => {
  it("sottrae il padding e conserva un pixel di tolleranza", () => {
    expect(richiedeColonnaCompatta(81, 100, 20)).toBe(false);
    expect(richiedeColonnaCompatta(82, 100, 20)).toBe(true);
  });
});
