import { beforeEach, describe, expect, it, vi } from "vitest";
import { novitaDaMostrare, segnaVista, versioneVista, VERSIONI } from "./changelog";

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

describe("changelog", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoriaLocale());
  });

  it("non mostra nulla al primo avvio assoluto se nessuna versione e' stata ancora vista", () => {
    expect(versioneVista()).toBeNull();
    expect(novitaDaMostrare("0.7.5")).toBeNull();
  });

  it("non mostra nulla se la versione corrente e' gia' stata vista", () => {
    segnaVista("0.7.5");
    expect(versioneVista()).toBe("0.7.5");
    expect(novitaDaMostrare("0.7.5")).toBeNull();
  });

  it("mostra le versioni intermedie non viste dopo un aggiornamento", () => {
    if (VERSIONI.length >= 2) {
      const piuRecente = VERSIONI[0].versione;
      const precedente = VERSIONI[1].versione;
      segnaVista(precedente);

      const daMostrare = novitaDaMostrare(piuRecente);
      expect(daMostrare).not.toBeNull();
      expect(daMostrare![0].versione).toBe(piuRecente);
    }
  });
});
