import { describe, expect, it } from "vitest";
import {
  profiloOnboardingModificabile,
  selezioneDopoModificaNome,
} from "./Onboarding";

describe("scelte utente dell'onboarding", () => {
  it("mantiene utente e modalità quando Riconfiguralo cambia nome", () => {
    expect(selezioneDopoModificaNome("reconfigure", "utente-1")).toEqual({
      mode: "reconfigure",
      userId: "utente-1",
    });
  });

  it("una modifica libera del nome resta nel percorso di creazione", () => {
    expect(selezioneDopoModificaNome("create", null)).toEqual({
      mode: "create",
      userId: null,
    });
  });

  it("Usa questo utente non espone modifiche al profilo", () => {
    expect(profiloOnboardingModificabile("use")).toBe(false);
    expect(profiloOnboardingModificabile("reconfigure")).toBe(true);
    expect(profiloOnboardingModificabile("create")).toBe(true);
  });
});
