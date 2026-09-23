import { describe, expect, it } from "vitest";
import { destinazioneBootstrap } from "./destinazioneBootstrap";
import type { Bootstrap } from "./tauriTypes";

function boot(overrides: Partial<Bootstrap> = {}): Bootstrap {
  return {
    onboarded: true,
    deviceId: "PC-A",
    deviceNome: "Postazione A",
    dataDir: "C:/PharmaTek-Data",
    dataDirStatus: "ok",
    identity: {
      userId: "utente-a",
      nome: "Anna",
      avatarTipo: "iniziali",
      avatarValore: "",
      deviceId: "PC-A",
      deviceNome: "Postazione A",
      dataDir: "C:/PharmaTek-Data",
    },
    reconnectRequired: false,
    pendingRestore: false,
    restoreStatus: "none",
    ...overrides,
  };
}

describe("schermata scelta dal bootstrap", () => {
  it("mostra la sessione revocata anche se il ritiro ha già cancellato la cartella locale", () => {
    expect(destinazioneBootstrap(boot({
      onboarded: false,
      identity: null,
      dataDir: null,
      dataDirStatus: "not_configured",
      reconnectRequired: true,
    }))).toBe("reconnect");
  });

  it("distingue cartella irraggiungibile, onboarding e sessione valida", () => {
    expect(destinazioneBootstrap(boot({ dataDirStatus: "missing_or_empty" }))).toBe("dataProblem");
    expect(destinazioneBootstrap(boot({
      onboarded: false,
      identity: null,
      dataDir: null,
      dataDirStatus: "not_configured",
    }))).toBe("onboarding");
    expect(destinazioneBootstrap(boot())).toBe("pronto");
  });

  it("mantiene la richiesta locale di ricollegamento durante il nuovo onboarding", () => {
    expect(destinazioneBootstrap(boot({
      onboarded: false,
      identity: null,
      dataDir: null,
      dataDirStatus: "not_configured",
    }), true)).toBe("reconnect");
  });

  it("non propone un nuovo onboarding se una configurazione attende l'allineamento", () => {
    expect(destinazioneBootstrap(boot({
      onboarded: false,
      identity: null,
      dataDirStatus: "ok",
    }))).toBe("dataProblem");
  });
});
