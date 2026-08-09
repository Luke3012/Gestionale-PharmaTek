import { afterEach, describe, expect, it, vi } from "vitest";
import { pulisciStatoNotificheComunicazioniLocale } from "./statoComunicazioniLocale";

function storageFinto(valori: Record<string, string>): Storage {
  const dati = new Map(Object.entries(valori));
  return {
    get length() {
      return dati.size;
    },
    clear: () => dati.clear(),
    getItem: (chiave) => dati.get(chiave) ?? null,
    key: (indice) => [...dati.keys()][indice] ?? null,
    removeItem: (chiave) => {
      dati.delete(chiave);
    },
    setItem: (chiave, valore) => {
      dati.set(chiave, valore);
    },
  };
}

describe("stato locale notifiche comunicazioni", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pulisce ogni identità senza toccare le altre preferenze locali", () => {
    const storage = storageFinto({
      "pt.notifiche-comunicazioni-locali.v1:utente-a": "{}",
      "pt.notifiche-comunicazioni-locali.v1:utente-b": "{}",
      "pt.onboardingTime": "123",
      "pt.preferenza": "conserva",
    });
    vi.stubGlobal("localStorage", storage);

    expect(pulisciStatoNotificheComunicazioniLocale()).toBe(2);
    expect(storage.getItem("pt.notifiche-comunicazioni-locali.v1:utente-a")).toBeNull();
    expect(storage.getItem("pt.notifiche-comunicazioni-locali.v1:utente-b")).toBeNull();
    expect(storage.getItem("pt.onboardingTime")).toBe("123");
    expect(storage.getItem("pt.preferenza")).toBe("conserva");
  });

  it("è idempotente quando lo storage è già stato azzerato dall'onboarding", () => {
    const storage = storageFinto({});
    vi.stubGlobal("localStorage", storage);

    expect(pulisciStatoNotificheComunicazioniLocale()).toBe(0);
    expect(pulisciStatoNotificheComunicazioniLocale()).toBe(0);
  });
});
