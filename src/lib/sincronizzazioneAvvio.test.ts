import { describe, expect, it, vi } from "vitest";
import type { Bootstrap } from "./tauriTypes";
import {
  bootstrapSincronizzabile,
  pollingMainAttivo,
  sincronizzaPrimaDelleViste,
} from "./sincronizzazioneAvvio";

function boot(patch: Partial<Bootstrap> = {}): Bootstrap {
  return {
    onboarded: true,
    deviceId: "pc-1",
    deviceNome: "PC 1",
    dataDir: "C:/OneDrive/PharmaTek-Data",
    dataDirStatus: "ok",
    identity: {
      userId: "u-1",
      nome: "Mario",
      avatarTipo: "iniziali",
      avatarValore: "",
      deviceId: "pc-1",
      deviceNome: "PC 1",
      dataDir: "C:/OneDrive/PharmaTek-Data",
    },
    reconnectRequired: false,
    pendingRestore: false,
    restoreStatus: "none",
    ...patch,
  };
}

describe("sincronizzazione prima delle viste", () => {
  it("lascia il polling alla main solo quando è visibile e a fuoco", () => {
    expect(pollingMainAttivo("visible", true)).toBe(true);
    expect(pollingMainAttivo("visible", false)).toBe(false);
    expect(pollingMainAttivo("hidden", true)).toBe(false);
    expect(pollingMainAttivo("hidden", false)).toBe(false);
  });

  it("salta configurazioni mancanti, reset, ricollegamenti e restore pendenti", async () => {
    const forceSync = vi.fn(async () => 0);
    const bootstrap = vi.fn(async () => boot());
    const casi = [
      boot({ onboarded: false, identity: null }),
      boot({ dataDir: null, dataDirStatus: "not_configured" }),
      boot({ dataDirStatus: "missing_or_empty" }),
      boot({ reconnectRequired: true }),
      boot({ pendingRestore: true }),
      boot({ restoreStatus: "waiting" }),
    ];

    for (const data of casi) {
      expect(bootstrapSincronizzabile(data)).toBe(false);
      expect(await sincronizzaPrimaDelleViste(data, { forceSync, bootstrap })).toBe(data);
    }
    expect(forceSync).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("completa la sync prima di rileggere identità e configurazione", async () => {
    const ordine: string[] = [];
    const aggiornato = boot({ reconnectRequired: true, identity: null, onboarded: false });
    const result = await sincronizzaPrimaDelleViste(boot(), {
      forceSync: async () => {
        ordine.push("sync");
        return 3;
      },
      bootstrap: async () => {
        ordine.push("bootstrap");
        return aggiornato;
      },
    });

    expect(ordine).toEqual(["sync", "bootstrap"]);
    expect(result).toBe(aggiornato);
  });

  it("ritenta gli errori transitori senza duplicare il bootstrap finale", async () => {
    const forceSync = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("snapshot non ancora disponibile"))
      .mockResolvedValue(2);
    const bootstrap = vi.fn(async () => boot());
    const onRetry = vi.fn();
    const attendi = vi.fn(async () => {});

    await sincronizzaPrimaDelleViste(boot(), { forceSync, bootstrap, onRetry, attendi });

    expect(forceSync).toHaveBeenCalledTimes(2);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(attendi).toHaveBeenCalledTimes(1);
  });
});
