import { describe, expect, it } from "vitest";
import {
  destinazioneComunicazioneDaRiepilogo,
  destinazioneRiepilogo,
} from "./apriRiepilogo";

describe("politica apertura riepiloghi", () => {
  it("usa il modale quando le finestre separate sono disattivate", () => {
    expect(destinazioneRiepilogo("mai")).toBe("modale");
  });

  it.each(["modifica", "sempre"] as const)("usa la finestra con preferenza %s", (preferenza) => {
    expect(destinazioneRiepilogo(preferenza)).toBe("finestra");
  });

  it("mantiene in finestra le comunicazioni avviate da un riepilogo esterno", () => {
    expect(destinazioneComunicazioneDaRiepilogo(true)).toBe("finestra");
    expect(destinazioneComunicazioneDaRiepilogo(false)).toBe("modale");
  });
});
