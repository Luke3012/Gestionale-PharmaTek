import { afterEach, describe, expect, it, vi } from "vitest";
import { creaPianificatoreRicarica, registraRicaricaSuEventi } from "./useRicaricaSuEventi";

afterEach(() => {
  vi.useRealTimers();
});

describe("creaPianificatoreRicarica", () => {
  it("inoltra ogni evento quando non è configurato un ritardo", async () => {
    const ricarica = vi.fn();
    const pianificatore = creaPianificatoreRicarica(ricarica);

    pianificatore.pianifica();
    pianificatore.pianifica();

    await Promise.resolve();
    await Promise.resolve();

    expect(ricarica).toHaveBeenCalledTimes(2);
  });

  it("accorpa gli eventi ravvicinati mantenendo il ritardo richiesto", () => {
    vi.useFakeTimers();
    const ricarica = vi.fn();
    const pianificatore = creaPianificatoreRicarica(ricarica, 160);

    pianificatore.pianifica();
    vi.advanceTimersByTime(100);
    pianificatore.pianifica();
    vi.advanceTimersByTime(159);
    expect(ricarica).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(ricarica).toHaveBeenCalledOnce();
  });

  it("annulla un refresh pendente allo smontaggio", () => {
    vi.useFakeTimers();
    const ricarica = vi.fn();
    const pianificatore = creaPianificatoreRicarica(ricarica, 180);

    pianificatore.pianifica();
    pianificatore.annulla();
    vi.runAllTimers();

    expect(ricarica).not.toHaveBeenCalled();
  });

  it("esegue subito senza attendere il debounce", () => {
    vi.useFakeTimers();
    const ricarica = vi.fn();
    const pianificatore = creaPianificatoreRicarica(ricarica, 180);

    pianificatore.pianifica();
    pianificatore.eseguiSubito();

    expect(ricarica).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(ricarica).toHaveBeenCalledOnce();
  });

  it("esegue un solo refresh finale se arrivano eventi durante un caricamento", async () => {
    let completaPrima!: () => void;
    const prima = new Promise<void>((resolve) => (completaPrima = resolve));
    const ricarica = vi.fn()
      .mockImplementationOnce(() => prima)
      .mockResolvedValue(undefined);
    const pianificatore = creaPianificatoreRicarica(ricarica);

    pianificatore.pianifica();
    pianificatore.pianifica();
    pianificatore.pianifica();
    expect(ricarica).toHaveBeenCalledOnce();

    completaPrima();
    await prima;
    await Promise.resolve();
    expect(ricarica).toHaveBeenCalledTimes(2);
  });
});

describe("registraRicaricaSuEventi", () => {
  it("preserva l'elenco eventi e disiscrive ogni listener una sola volta", async () => {
    const ricarica = vi.fn();
    const disiscrizioni = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const listen = vi.fn(async (_evento, _handler) => disiscrizioni[listen.mock.calls.length - 1]);
    const eventi = ["ordine:salvato", "pagamento:salvato", "cliente:salvato"] as const;

    const cleanup = await registraRicaricaSuEventi(eventi, ricarica, listen);

    expect(listen.mock.calls.map(([evento]) => evento)).toEqual([
      ...eventi,
      "pt:proiezione-ricostruita",
    ]);
    expect(listen.mock.calls.every(([, handler]) => handler === ricarica)).toBe(true);

    cleanup();
    cleanup();
    disiscrizioni.forEach((disiscrivi) => expect(disiscrivi).toHaveBeenCalledOnce());
  });

  it("pulisce i listener gia registrati se una sottoscrizione fallisce", async () => {
    const primaDisiscrizione = vi.fn();
    const listen = vi
      .fn()
      .mockResolvedValueOnce(primaDisiscrizione)
      .mockRejectedValueOnce(new Error("listener non disponibile"));

    await expect(
      registraRicaricaSuEventi(["ordine:salvato", "pagamento:salvato"], vi.fn(), listen)
    ).rejects.toThrow("listener non disponibile");
    expect(primaDisiscrizione).toHaveBeenCalledOnce();
  });
});
