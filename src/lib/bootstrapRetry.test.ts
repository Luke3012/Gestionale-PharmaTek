import { describe, expect, it, vi } from "vitest";
import { bootstrapConRetry } from "./bootstrapRetry";
import type { Bootstrap } from "./tauriTypes";

function boot(patch: Partial<Bootstrap> = {}): Bootstrap {
  return {
    onboarded: true,
    deviceId: "pc-1",
    deviceNome: "PC 1",
    dataDir: "C:/OneDrive/PharmaTek",
    dataDirStatus: "ok",
    identity: null,
    reconnectRequired: false,
    pendingRestore: false,
    restoreStatus: "none",
    ...patch,
  };
}

describe("bootstrap con attesa OneDrive limitata", () => {
  it("non resta sul loader se la cartella continua a essere vuota", async () => {
    const mancante = boot({ dataDirStatus: "missing_or_empty" });
    const bootstrap = vi.fn(async () => mancante);
    const attendi = vi.fn(async () => {});
    const onAttesa = vi.fn();

    await expect(bootstrapConRetry({ bootstrap, attendi, onAttesa })).resolves.toBe(mancante);
    expect(bootstrap).toHaveBeenCalledTimes(6);
    expect(onAttesa).toHaveBeenCalledTimes(5);
    expect(attendi.mock.calls.flat()).toEqual([700, 1050, 1400, 1750, 2000]);
  });

  it("esce appena OneDrive consegna un dataset valido", async () => {
    const valido = boot();
    const bootstrap = vi
      .fn<() => Promise<Bootstrap>>()
      .mockResolvedValueOnce(boot({ dataDirStatus: "missing_or_empty" }))
      .mockResolvedValue(valido);

    await expect(bootstrapConRetry({ bootstrap, attendi: async () => {} })).resolves.toBe(valido);
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it("ritenta solo gli errori tecnici transitori", async () => {
    const bootstrap = vi
      .fn<() => Promise<Bootstrap>>()
      .mockRejectedValueOnce(new Error("snapshot non ancora disponibile"))
      .mockResolvedValue(boot());
    await expect(bootstrapConRetry({ bootstrap, attendi: async () => {} })).resolves.toMatchObject({
      dataDirStatus: "ok",
    });

    await expect(bootstrapConRetry({
      bootstrap: async () => { throw new Error("permesso negato"); },
      attendi: async () => {},
    })).rejects.toThrow("permesso negato");
  });
});
