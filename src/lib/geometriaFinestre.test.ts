import { afterEach, describe, expect, it, vi } from "vitest";
import { leggiGeometria } from "./geometriaFinestre";

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

describe("geometria finestre", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("migra soltanto una vecchia dimensione predefinita", () => {
    const storage = storageFinto({
      "pt.geom.comunicazione": JSON.stringify({
        width: 900,
        height: 720,
        x: 120,
        y: 80,
      }),
    });
    vi.stubGlobal("localStorage", storage);

    expect(
      leggiGeometria("comunicazione", {
        width: 680,
        height: 600,
        minWidth: 540,
        minHeight: 440,
        precedentiDefault: [{ width: 900, height: 720 }],
      }),
    ).toEqual({ width: 680, height: 600, x: 120, y: 80 });
    expect(JSON.parse(storage.getItem("pt.geom.comunicazione") ?? "{}")).toMatchObject({
      width: 680,
      height: 600,
      x: 120,
      y: 80,
    });
  });

  it("conserva una dimensione scelta dall'utente", () => {
    const storage = storageFinto({
      "pt.geom.comunicazione": JSON.stringify({
        width: 735,
        height: 655,
        x: 40,
        y: 30,
      }),
    });
    vi.stubGlobal("localStorage", storage);

    expect(
      leggiGeometria("comunicazione", {
        width: 680,
        height: 600,
        minWidth: 540,
        minHeight: 440,
        precedentiDefault: [{ width: 900, height: 720 }],
      }),
    ).toEqual({ width: 735, height: 655, x: 40, y: 30 });
  });
});
