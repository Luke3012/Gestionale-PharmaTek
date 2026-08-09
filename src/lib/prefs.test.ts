import { describe, expect, it } from "vitest";
import {
  CHIAVI_PREFERENZE,
  calcolaCambiPreferenze,
  type SnapshotPreferenze,
} from "./prefs";

describe("sincronizzazione preferenze", () => {
  const precedente: SnapshotPreferenze = {
    [CHIAVI_PREFERENZE.ridurreAnimazioni]: false,
    [CHIAVI_PREFERENZE.densitaTabelle]: "standard",
  };

  it("propaga ogni modifica locale", () => {
    const corrente = {
      ...precedente,
      [CHIAVI_PREFERENZE.ridurreAnimazioni]: true,
      [CHIAVI_PREFERENZE.densitaTabelle]: "compatta",
    };
    expect(calcolaCambiPreferenze(precedente, corrente, new Map(), "main")).toEqual([
      {
        source: "main",
        key: CHIAVI_PREFERENZE.ridurreAnimazioni,
        value: true,
      },
      {
        source: "main",
        key: CHIAVI_PREFERENZE.densitaTabelle,
        value: "compatta",
      },
    ]);
  });

  it("non rimanda al mittente un valore appena ricevuto", () => {
    const corrente = { ...precedente, [CHIAVI_PREFERENZE.ridurreAnimazioni]: true };
    const remoti = new Map([[CHIAVI_PREFERENZE.ridurreAnimazioni, "true"]]);
    expect(calcolaCambiPreferenze(precedente, corrente, remoti, "info")).toEqual([]);
    expect(remoti.size).toBe(0);
  });

  it("non considera il primo caricamento una modifica", () => {
    expect(calcolaCambiPreferenze(null, precedente, new Map(), "ordine")).toEqual([]);
  });
});
