import { describe, expect, it } from "vitest";
import { finestraBloccaAggiornamentoBackground } from "./autoAggiornamentoBackground";

describe("finestre che bloccano l'update automatico", () => {
  it("considera Spotlight e tutti i pannelli visibili come attivita utente", () => {
    expect(finestraBloccaAggiornamentoBackground("spotlight", false)).toBe(true);
    expect(finestraBloccaAggiornamentoBackground("info", false)).toBe(true);
    expect(finestraBloccaAggiornamentoBackground("ordine-1", false)).toBe(true);
  });

  it("ignora solo l'overlay mostrato dall'heartbeat nativo", () => {
    expect(finestraBloccaAggiornamentoBackground("overlay", true)).toBe(false);
    expect(finestraBloccaAggiornamentoBackground("spotlight", true)).toBe(true);
    expect(finestraBloccaAggiornamentoBackground("main", true)).toBe(false);
  });
});
