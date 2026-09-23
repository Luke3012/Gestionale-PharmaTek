import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordGet: vi.fn(),
  salvaBaseProduzione: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({ api: mocks }));

import { leggiBaseProduzione, salvaBaseProduzione } from "./numeroProduzione";

describe("base condivisa della produzione", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "999"),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("legge il default senza migrare il vecchio valore locale o scrivere eventi", async () => {
    mocks.recordGet.mockResolvedValue(null);
    expect(await leggiBaseProduzione()).toBe(1);
    expect(await leggiBaseProduzione()).toBe(1);
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(mocks.salvaBaseProduzione).not.toHaveBeenCalled();
  });

  it("conserva il valore condiviso e propaga gli errori di lettura", async () => {
    mocks.recordGet.mockResolvedValueOnce({ data: { numero_produzione_base: 42 } });
    expect(await leggiBaseProduzione()).toBe(42);
    mocks.recordGet.mockRejectedValueOnce(new Error("motore non disponibile"));
    await expect(leggiBaseProduzione()).rejects.toThrow("motore non disponibile");
    expect(mocks.salvaBaseProduzione).not.toHaveBeenCalled();
  });

  it("invia una sola richiesta per una modifica valida e rifiuta valori non interi", async () => {
    mocks.salvaBaseProduzione.mockResolvedValue(undefined);
    await salvaBaseProduzione(1, 42);
    expect(mocks.salvaBaseProduzione).toHaveBeenCalledExactlyOnceWith(1, 42);
    await expect(salvaBaseProduzione(42, 1.5)).rejects.toThrow();
    expect(mocks.salvaBaseProduzione).toHaveBeenCalledTimes(1);
  });
});
