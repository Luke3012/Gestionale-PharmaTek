import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  avatarOnboardingCambiato,
  calcolaPassiOnboarding,
  passoVisibileOnboarding,
  selezioneDopoModificaNome,
} from "./Onboarding";
import {
  CHIAVE_SETUP_IMPOSTAZIONI_COMPLETATO,
  impostazioniInizialiDaProporre,
} from "../lib/prefs";
import {
  LISTA_IMPOSTAZIONI_CONSIGLIATE,
  valoriImpostazioniIniziali,
} from "./ImpostazioniConsigliateStep";

function memoriaLocale(): Storage {
  const valori = new Map<string, string>();
  return {
    get length() { return valori.size; },
    clear: () => valori.clear(),
    getItem: (chiave) => valori.get(chiave) ?? null,
    key: (indice) => [...valori.keys()][indice] ?? null,
    removeItem: (chiave) => { valori.delete(chiave); },
    setItem: (chiave, valore) => { valori.set(chiave, String(valore)); },
  };
}

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

  it("Usa questo utente aggiorna l'avatar solo se viene cambiato", () => {
    const originale = { avatarTipo: "preset" as const, avatarValore: "p1" };
    expect(avatarOnboardingCambiato("use", originale, "preset", "p1", false)).toBe(false);
    expect(avatarOnboardingCambiato("use", originale, "preset", "p2", false)).toBe(true);
    expect(avatarOnboardingCambiato("use", originale, "custom", "utente-1.png", true)).toBe(true);
    expect(avatarOnboardingCambiato("create", originale, "preset", "p2", false)).toBe(false);
    expect(avatarOnboardingCambiato("reconfigure", originale, "preset", "p2", false)).toBe(false);
    expect(avatarOnboardingCambiato("use", { avatarTipo: "custom", avatarValore: "utente-1.png" }, "custom", "utente-1.png", true)).toBe(true);
  });
});

describe("passi e impostazioni consigliate dell'onboarding", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoriaLocale());
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calcola correttamente la sequenza dei passi con e senza lo step impostazioni", () => {
    expect(calcolaPassiOnboarding(true)).toEqual([
      "Cartella",
      "Utente",
      "Avatar",
      "Impostazioni",
      "Riepilogo",
    ]);
    expect(calcolaPassiOnboarding(false)).toEqual([
      "Cartella",
      "Utente",
      "Avatar",
      "Riepilogo",
    ]);
    expect(passoVisibileOnboarding("Impostazioni", calcolaPassiOnboarding(false))).toBe("Riepilogo");
    expect(passoVisibileOnboarding("Riepilogo", calcolaPassiOnboarding(false))).toBe("Riepilogo");
  });

  it("propone le impostazioni consigliate solo se le preferenze sono ai valori di fabbrica", () => {
    expect(
      impostazioniInizialiDaProporre({
        zoomUI: 1,
        ordineFinestra: "mai",
        sogliaSolleciti: 0,
      })
    ).toBe(true);

    // Non propone se zoom già modificato
    expect(
      impostazioniInizialiDaProporre({
        zoomUI: 1.1,
        ordineFinestra: "mai",
        sogliaSolleciti: 0,
      })
    ).toBe(false);

    // Non propone se finestra già modificata
    expect(
      impostazioniInizialiDaProporre({
        zoomUI: 1,
        ordineFinestra: "modifica",
        sogliaSolleciti: 0,
      })
    ).toBe(false);

    // Non propone se solleciti già modificati
    expect(
      impostazioniInizialiDaProporre({
        zoomUI: 1,
        ordineFinestra: "mai",
        sogliaSolleciti: 7,
      })
    ).toBe(false);

    // Non propone se autostart attivo
    expect(
      impostazioniInizialiDaProporre(
        { zoomUI: 1, ordineFinestra: "mai", sogliaSolleciti: 0 },
        true
      )
    ).toBe(false);

    // Non propone se il setup iniziale è già stato completato/registrato
    localStorage.setItem(CHIAVE_SETUP_IMPOSTAZIONI_COMPLETATO, "true");
    expect(
      impostazioniInizialiDaProporre({
        zoomUI: 1,
        ordineFinestra: "mai",
        sogliaSolleciti: 0,
      })
    ).toBe(false);
  });

  it("include le 4 impostazioni specifiche richieste nel riquadro", () => {
    const ids = LISTA_IMPOSTAZIONI_CONSIGLIATE.map((item) => item.id);
    expect(ids).toEqual(["autostart", "zoom", "finestra", "solleciti"]);

    const autostart = LISTA_IMPOSTAZIONI_CONSIGLIATE.find((i) => i.id === "autostart")!;
    expect(autostart.valoreConsigliato).toBe("Attivo");

    const zoom = LISTA_IMPOSTAZIONI_CONSIGLIATE.find((i) => i.id === "zoom")!;
    expect(zoom.valoreConsigliato).toBe("110%");

    const finestra = LISTA_IMPOSTAZIONI_CONSIGLIATE.find((i) => i.id === "finestra")!;
    expect(finestra.valoreConsigliato).toBe("Solo in modifica");

    const solleciti = LISTA_IMPOSTAZIONI_CONSIGLIATE.find((i) => i.id === "solleciti")!;
    expect(solleciti.valoreConsigliato).toBe("Dopo 7 giorni");
  });

  it("traduce indipendentemente le quattro scelte nei valori applicati", () => {
    expect(valoriImpostazioniIniziali({
      autostart: false,
      zoom: true,
      finestra: false,
      solleciti: true,
    })).toEqual({
      autostart: false,
      zoomUI: 1.1,
      ordineFinestra: "mai",
      sogliaSolleciti: 7,
    });
    expect(valoriImpostazioniIniziali({
      autostart: true,
      zoom: false,
      finestra: true,
      solleciti: false,
    })).toEqual({
      autostart: true,
      zoomUI: 1,
      ordineFinestra: "modifica",
      sogliaSolleciti: 0,
    });
  });
});
