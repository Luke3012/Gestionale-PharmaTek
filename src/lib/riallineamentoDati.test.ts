import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  appPuoGestireRiallineamentoDati,
  eventoRichiedeRiconvalidaSessione,
  iniziaRiallineamentoDati,
  messaggioRiallineamentoDati,
  messaggioRiallineamentoDatiCompletato,
  messaggioRiallineamentoDatiFallito,
  registraGestoreRiallineamentoApp,
  ricostruisciProiezioneConRetry,
  riallineamentoDatiInCorso,
  terminaRiallineamentoDati,
} from "./riallineamentoDati";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("feedback del riallineamento", () => {
  it("mantiene il toast specifico quando il watcher richiede uno snapshot", () => {
    expect(messaggioRiallineamentoDati("snapshot")).toBe("Sincronizzo i dati più recenti…");
    expect(messaggioRiallineamentoDatiCompletato("snapshot")).toBe(
      "Dati sincronizzati e riallineati."
    );
  });

  it("distingue il normale rebuild locale dal recupero snapshot", () => {
    expect(messaggioRiallineamentoDati("reset")).toBe("Sto riallineando i dati locali…");
    expect(messaggioRiallineamentoDatiCompletato("reset")).toBe("Dati locali riallineati.");
  });

  it("mantiene visibile il dettaglio quando tutti i retry falliscono", () => {
    expect(messaggioRiallineamentoDatiFallito(new Error("snapshot corrotto"))).toContain(
      "snapshot corrotto"
    );
  });
});

describe("riallineamenti che invalidano la sessione", () => {
  it("riserva identita e postazione al flusso bloccante di Root", () => {
    expect(eventoRichiedeRiconvalidaSessione("identity")).toBe(true);
    expect(eventoRichiedeRiconvalidaSessione("device")).toBe(true);
    expect(eventoRichiedeRiconvalidaSessione("snapshot")).toBe(false);
    expect(eventoRichiedeRiconvalidaSessione("reset")).toBe(false);
  });
});

describe("ricostruisciProiezioneConRetry", () => {
  let ritardi: number[];

  beforeEach(() => {
    ritardi = [];
    invokeMock.mockReset();
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler, delay?: number) => {
      ritardi.push(Number(delay));
      queueMicrotask(() => {
        if (typeof callback === "function") callback();
      });
      return 0;
    }) as typeof setTimeout);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("termina al primo successo senza notificare retry", async () => {
    const onRetry = vi.fn();
    invokeMock.mockResolvedValue(undefined);

    await ricostruisciProiezioneConRetry(onRetry);

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("ricostruisci_proiezione_locale");
    expect(onRetry).not.toHaveBeenCalled();
    expect(ritardi).toEqual([]);
  });

  it("mantiene tentativi, callback e backoff originali", async () => {
    const onRetry = vi.fn();
    invokeMock
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockRejectedValueOnce(new Error("3"))
      .mockRejectedValueOnce(new Error("4"))
      .mockRejectedValueOnce(new Error("5"))
      .mockResolvedValue(undefined);

    await ricostruisciProiezioneConRetry(onRetry);

    expect(invokeMock).toHaveBeenCalledTimes(6);
    expect(onRetry).toHaveBeenCalledTimes(5);
    expect(ritardi).toEqual([800, 1500, 2200, 2900, 3600]);
  });

  it("propaga l'ultimo errore senza callback dopo il sesto tentativo", async () => {
    const onRetry = vi.fn();
    const ultimoErrore = new Error("ultimo");
    invokeMock
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockRejectedValueOnce(new Error("3"))
      .mockRejectedValueOnce(new Error("4"))
      .mockRejectedValueOnce(new Error("5"))
      .mockRejectedValueOnce(ultimoErrore);

    await expect(ricostruisciProiezioneConRetry(onRetry)).rejects.toBe(ultimoErrore);

    expect(invokeMock).toHaveBeenCalledTimes(6);
    expect(onRetry).toHaveBeenCalledTimes(5);
    expect(ritardi).toEqual([800, 1500, 2200, 2900, 3600]);
  });
});

describe("guardia globale del riallineamento", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.spyOn(Date, "now").mockReturnValue(10_000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("esclude un secondo riallineamento concorrente", () => {
    expect(iniziaRiallineamentoDati()).toBe(true);
    expect(riallineamentoDatiInCorso()).toBe(true);
    expect(iniziaRiallineamentoDati()).toBe(false);
  });

  it("rilascia subito la guardia per non perdere un nuovo evento reale", () => {
    expect(iniziaRiallineamentoDati()).toBe(true);
    terminaRiallineamentoDati();
    expect(riallineamentoDatiInCorso()).toBe(false);
    expect(iniziaRiallineamentoDati()).toBe(true);
  });

  it("cede l'evento ad App solo finche il suo listener attivo puo gestirlo", () => {
    let faseGestibile = true;
    const scollega = registraGestoreRiallineamentoApp(() => faseGestibile);

    expect(appPuoGestireRiallineamentoDati()).toBe(true);
    faseGestibile = false;
    expect(appPuoGestireRiallineamentoDati()).toBe(false);
    scollega();
    expect(appPuoGestireRiallineamentoDati()).toBe(false);
  });

  it("il cleanup di un replay StrictMode non scollega il gestore nuovo", () => {
    const scollegaVecchio = registraGestoreRiallineamentoApp(() => true);
    const scollegaNuovo = registraGestoreRiallineamentoApp(() => true);

    scollegaVecchio();
    expect(appPuoGestireRiallineamentoDati()).toBe(true);
    scollegaNuovo();
    expect(appPuoGestireRiallineamentoDati()).toBe(false);
  });
});
