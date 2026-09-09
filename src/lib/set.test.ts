import { describe, expect, it } from "vitest";
import { setConToggle } from "./set";

describe("setConToggle", () => {
  it("aggiunge un valore assente senza mutare l'insieme originale", () => {
    const originale = new Set(["a"]);
    expect([...setConToggle(originale, "b")]).toEqual(["a", "b"]);
    expect([...originale]).toEqual(["a"]);
  });

  it("rimuove un valore presente e accetta qualsiasi iterabile", () => {
    expect([...setConToggle(["a", "b"], "a")]).toEqual(["b"]);
  });
});
