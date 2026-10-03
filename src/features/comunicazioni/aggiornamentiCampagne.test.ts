import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creaAggiornamentiCampagne, filtraSnapshotIniziale } from "./aggiornamentiCampagne";

function differita<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, ko) => { resolve = ok; reject = ko; });
  return { promise, resolve, reject };
}

describe("aggiornamenti accorpati delle campagne", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("accorpa 50 eventi e più campagne in una sola lettura", async () => {
    const leggi = vi.fn().mockResolvedValue(["snapshot"]);
    const applica = vi.fn();
    const aggiornamenti = creaAggiornamentiCampagne(leggi, applica);
    for (let i = 0; i < 50; i++) aggiornamenti.richiedi("A");
    aggiornamenti.richiedi("B");
    expect(leggi).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(leggi).toHaveBeenCalledTimes(1);
    expect(applica.mock.calls).toEqual([["A", ["snapshot"]], ["B", ["snapshot"]]]);
  });

  it("non sovrappone letture e recupera l'evento arrivato durante la richiesta", async () => {
    const prima = differita<string>();
    const seconda = differita<string>();
    const leggi = vi.fn().mockReturnValueOnce(prima.promise).mockReturnValueOnce(seconda.promise);
    const applica = vi.fn();
    const aggiornamenti = creaAggiornamentiCampagne(leggi, applica);
    aggiornamenti.richiedi("A");
    aggiornamenti.richiedi("B");
    await vi.advanceTimersByTimeAsync(100);
    aggiornamenti.richiedi("A");
    await vi.advanceTimersByTimeAsync(1000);
    expect(leggi).toHaveBeenCalledTimes(1);
    prima.resolve("vecchio");
    await vi.advanceTimersByTimeAsync(0);
    expect(applica.mock.calls).toEqual([["B", "vecchio"]]);
    await vi.advanceTimersByTimeAsync(100);
    expect(leggi).toHaveBeenCalledTimes(2);
    seconda.resolve("aggiornato");
    await vi.advanceTimersByTimeAsync(0);
    expect(applica.mock.calls).toEqual([["B", "vecchio"], ["A", "aggiornato"]]);
  });

  it("recupera pausa, annullamento e ripresa senza applicare lo stato superato", async () => {
    const prima = differita<string>();
    const leggi = vi.fn().mockReturnValueOnce(prima.promise).mockResolvedValue("in_coda");
    const applica = vi.fn();
    const aggiornamenti = creaAggiornamentiCampagne(leggi, applica);
    aggiornamenti.richiedi("A"); // invio in corso
    await vi.advanceTimersByTimeAsync(100);
    aggiornamenti.richiedi("A"); // pausa
    aggiornamenti.richiedi("A"); // annullamento
    aggiornamenti.richiedi("A"); // ripresa
    prima.resolve("in_invio");
    await vi.advanceTimersByTimeAsync(0);
    expect(applica).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(applica.mock.calls).toEqual([["A", "in_coda"]]);
    expect(leggi).toHaveBeenCalledTimes(2);
  });

  it("serializza il caricamento iniziale e segnala le campagne già cambiate", async () => {
    const prima = differita<string>();
    const leggi = vi.fn().mockReturnValueOnce(prima.promise).mockResolvedValue("nuovo");
    const applica = vi.fn();
    const iniziale = vi.fn();
    const aggiornamenti = creaAggiornamentiCampagne(leggi, applica);
    const caricamento = aggiornamenti.caricaIniziale(iniziale);
    aggiornamenti.richiedi("A");
    await vi.advanceTimersByTimeAsync(1000);
    expect(leggi).toHaveBeenCalledTimes(1);
    prima.resolve("iniziale");
    await caricamento;
    expect(iniziale).toHaveBeenCalledWith("iniziale", new Set(["A"]));
    await vi.advanceTimersByTimeAsync(100);
    expect(applica).toHaveBeenCalledWith("A", "nuovo");
    expect(leggi).toHaveBeenCalledTimes(2);
  });

  it("non cancella il riepilogo su errore e recupera agli eventi successivi", async () => {
    const leggi = vi.fn().mockRejectedValueOnce(new Error("outbox indisponibile")).mockResolvedValue("ok");
    const applica = vi.fn();
    const aggiornamenti = creaAggiornamentiCampagne(leggi, applica);
    aggiornamenti.richiedi("A");
    await vi.advanceTimersByTimeAsync(100);
    expect(applica).not.toHaveBeenCalled();
    aggiornamenti.richiedi("A");
    await vi.advanceTimersByTimeAsync(100);
    expect(applica).toHaveBeenCalledWith("A", "ok");
  });

  it("recupera gli eventi anche se il caricamento iniziale fallisce", async () => {
    const leggi = vi.fn().mockRejectedValueOnce(new Error("iniziale fallita")).mockResolvedValue("ok");
    const applica = vi.fn();
    const aggiornamenti = creaAggiornamentiCampagne(leggi, applica);
    const caricamento = aggiornamenti.caricaIniziale(vi.fn());
    aggiornamenti.richiedi("A");
    await caricamento;
    await vi.advanceTimersByTimeAsync(100);
    expect(applica).toHaveBeenCalledWith("A", "ok");
  });

  it("non aggiorna dopo la chiusura con una lettura ancora pendente", async () => {
    const prima = differita<string>();
    const leggi = vi.fn().mockReturnValue(prima.promise);
    const applica = vi.fn();
    const aggiornamenti = creaAggiornamentiCampagne(leggi, applica);
    aggiornamenti.richiedi("A");
    await vi.advanceTimersByTimeAsync(100);
    aggiornamenti.richiedi("A");
    aggiornamenti.chiudi();
    prima.resolve("tardivo");
    await vi.advanceTimersByTimeAsync(1000);
    expect(applica).not.toHaveBeenCalled();
    expect(leggi).toHaveBeenCalledTimes(1);
  });

  it("cancella la richiesta programmata alla chiusura", async () => {
    const leggi = vi.fn();
    const aggiornamenti = creaAggiornamentiCampagne(leggi, vi.fn());
    aggiornamenti.richiedi("A");
    aggiornamenti.chiudi();
    aggiornamenti.richiedi("B");
    await vi.advanceTimersByTimeAsync(1000);
    expect(leggi).not.toHaveBeenCalled();
  });
});

describe("protezione del riepilogo iniziale dell'overlay", () => {
  const snapshot = [
    { id: "mail", campagnaId: "A", stato: "in_coda" },
    { id: "whatsapp", campagnaId: "A", stato: "in_coda" },
    { id: "altro", campagnaId: "B", stato: "sospeso" },
    { id: "singolo", campagnaId: "", stato: "in_coda" },
  ];
  it("non ripristina una campagna superata neppure per i canali senza nuovo evento", () => {
    expect(filtraSnapshotIniziale(snapshot, new Set(["mail"]), new Set(["A"]), new Set()))
      .toEqual(snapshot.slice(2));
  });
  it("non ripristina un singolo invio già concluso durante la lettura", () => {
    expect(filtraSnapshotIniziale(snapshot, new Set(["singolo"]), new Set(), new Set()))
      .toEqual(snapshot.slice(0, 3));
  });
  it("non ripristina campagne silenziate dall'annullamento", () => {
    expect(filtraSnapshotIniziale(snapshot, new Set(), new Set(), new Set(["A"])))
      .toEqual(snapshot.slice(2));
  });
  it("preserva lo snapshot quando non ci sono eventi concorrenti", () => {
    expect(filtraSnapshotIniziale(snapshot, new Set(), new Set(), new Set())).toEqual(snapshot);
  });
});
