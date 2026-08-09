import { describe, expect, it, vi } from "vitest";
import type { Bootstrap } from "./tauriTypes";
import {
  attendiConsegnaRipristino,
  eventoRichiedeBloccoRipristino,
  lockMantieneBloccoRipristino,
  ripristinoRemotoInCorso,
  statoConsegnaRipristino,
} from "./consegnaRipristino";

function boot(restoreStatus: Bootstrap["restoreStatus"], pendingRestore = restoreStatus === "ready"): Bootstrap {
  return {
    onboarded: true,
    deviceId: "PC-B",
    deviceNome: "Postazione B",
    dataDir: "C:/OneDrive/PharmaTek",
    dataDirStatus: "ok",
    identity: {
      userId: "U-B",
      nome: "Bruno",
      avatarTipo: "iniziali",
      avatarValore: "",
      deviceId: "PC-B",
      deviceNome: "Postazione B",
      dataDir: "C:/OneDrive/PharmaTek",
    },
    reconnectRequired: false,
    pendingRestore,
    restoreStatus,
  };
}

describe("consegna ripristino nella UI", () => {
  it("distingue attesa, pronto e assenza senza confondere il booleano legacy", () => {
    expect(statoConsegnaRipristino(boot("none"))).toBe("none");
    expect(statoConsegnaRipristino(boot("waiting"))).toBe("waiting");
    expect(statoConsegnaRipristino(boot("ready"))).toBe("ready");
    expect(statoConsegnaRipristino({ ...boot("none"), pendingRestore: true })).toBe("ready");
    expect(ripristinoRemotoInCorso(boot("waiting"))).toBe(true);
    expect(eventoRichiedeBloccoRipristino("restore-waiting")).toBe(true);
    expect(eventoRichiedeBloccoRipristino("restore")).toBe(true);
    expect(eventoRichiedeBloccoRipristino("snapshot")).toBe(false);
  });

  it("mantiene il blocco per preparazione, ripristino e ottimizzazione", () => {
    const lock = {
      active: true,
      own: false,
      deviceId: "PC-A",
      deviceNome: "Postazione A",
      utenteNome: "Anna",
      azione: "preparazione_ripristino",
      timestamp: 1,
      expiresInMs: 1_000,
    };
    expect(lockMantieneBloccoRipristino(lock)).toBe(true);
    expect(lockMantieneBloccoRipristino({ ...lock, azione: "ripristino_backup" })).toBe(true);
    expect(lockMantieneBloccoRipristino({ ...lock, azione: "ottimizzazione_database" })).toBe(true);
    expect(lockMantieneBloccoRipristino({ ...lock, azione: "importazione" })).toBe(false);
    expect(lockMantieneBloccoRipristino({ ...lock, active: false })).toBe(false);
    expect(lockMantieneBloccoRipristino(null)).toBe(false);
  });

  it("resta bloccata durante consegne parziali e restituisce soltanto lo stato ready", async () => {
    const stati = [boot("waiting"), boot("waiting"), boot("ready")];
    const bootstrap = vi.fn(async () => stati.shift()!);
    const onWaiting = vi.fn();
    const attendi = vi.fn(async () => {});

    const finale = await attendiConsegnaRipristino(boot("waiting"), {
      bootstrap,
      attivo: () => true,
      onWaiting,
      attendi,
      intervalloMs: 25,
    });

    expect(finale.restoreStatus).toBe("ready");
    expect(bootstrap).toHaveBeenCalledTimes(3);
    expect(onWaiting).toHaveBeenCalledTimes(3);
    expect(attendi).toHaveBeenNthCalledWith(1, 25);
  });

  it("esce senza ricostruire se il marker sparisce o la finestra viene smontata", async () => {
    const bootstrap = vi.fn(async () => boot("none"));
    expect(
      (await attendiConsegnaRipristino(boot("waiting"), {
        bootstrap,
        attivo: () => true,
        attendi: async () => {},
      })).restoreStatus
    ).toBe("none");

    let attivo = true;
    const invariato = await attendiConsegnaRipristino(boot("waiting"), {
      bootstrap: vi.fn(),
      attivo: () => attivo,
      attendi: async () => { attivo = false; },
    });
    expect(invariato.restoreStatus).toBe("waiting");
  });

  it("trasforma una consegna che non termina in un errore recuperabile", async () => {
    let ora = 0;
    const bootstrap = vi.fn(async () => boot("waiting"));

    await expect(
      attendiConsegnaRipristino(boot("waiting"), {
        bootstrap,
        attivo: () => true,
        attendi: async (ms) => {
          ora += ms;
        },
        intervalloMs: 50,
        timeoutMs: 100,
        ora: () => ora,
      })
    ).rejects.toThrow("OneDrive non ha completato");
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });
});
