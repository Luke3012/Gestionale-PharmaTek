import { describe, expect, it } from "vitest";
import { RITIRO_AUTO_RELOAD_MS, secondiRimanentiRitiro } from "./ritiroCountdown";

describe("conto alla rovescia del ritiro", () => {
  it("mostra dieci secondi e arriva a zero senza valori negativi", () => {
    const inizio = 50_000;
    const fine = inizio + RITIRO_AUTO_RELOAD_MS;

    expect(secondiRimanentiRitiro(fine, inizio)).toBe(10);
    expect(secondiRimanentiRitiro(fine, inizio + 1)).toBe(10);
    expect(secondiRimanentiRitiro(fine, inizio + 1_001)).toBe(9);
    expect(secondiRimanentiRitiro(fine, fine - 1)).toBe(1);
    expect(secondiRimanentiRitiro(fine, fine)).toBe(0);
    expect(secondiRimanentiRitiro(fine, fine + 5_000)).toBe(0);
  });
});
