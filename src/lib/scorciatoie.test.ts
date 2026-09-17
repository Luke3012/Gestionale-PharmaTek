import { describe, expect, it, vi } from "vitest";
import { bloccaScorciatoiaStampa, eScorciatoiaStampa } from "./scorciatoie";

describe("blocco scorciatoia stampa", () => {
  it("riconosce Ctrl+P e Cmd+P ma non Alt+P", () => {
    expect(eScorciatoiaStampa({ key: "p", ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(eScorciatoiaStampa({ key: "P", ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
    expect(eScorciatoiaStampa({ key: "p", ctrlKey: true, metaKey: false, altKey: true })).toBe(false);
    expect(eScorciatoiaStampa({ key: "k", ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
  });

  it("annulla e interrompe la scorciatoia senza toccare altri tasti", () => {
    const event = {
      key: "p",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    bloccaScorciatoiaStampa(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });
});
