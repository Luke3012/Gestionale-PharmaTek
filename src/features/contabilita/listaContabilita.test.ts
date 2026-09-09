import { describe, expect, it, vi } from "vitest";
import { aggiornaListaContabilita } from "./listaContabilita";

describe("aggiornaListaContabilita", () => {
  it("mostra il caricamento, aggiorna le righe e lo conclude nello stesso ordine", async () => {
    const eventi: string[] = [];

    await aggiornaListaContabilita(
      false,
      async () => { eventi.push("carica"); return [1, 2]; },
      (righe) => eventi.push(`righe:${righe.join(",")}`),
      (attivo) => eventi.push(`caricamento:${attivo}`),
      vi.fn()
    );

    expect(eventi).toEqual(["caricamento:true", "carica", "righe:1,2", "caricamento:false"]);
  });

  it("non riattiva l'indicatore durante un aggiornamento silenzioso", async () => {
    const stati: boolean[] = [];

    await aggiornaListaContabilita(true, async () => [], vi.fn(), (attivo) => stati.push(attivo), vi.fn());

    expect(stati).toEqual([false]);
  });

  it("segnala l'errore e conclude comunque il caricamento", async () => {
    const errore = new Error("non disponibile");
    const aggiorna = vi.fn();
    const segnalaErrore = vi.fn();
    const stati: boolean[] = [];

    await aggiornaListaContabilita(
      false,
      async () => { throw errore; },
      aggiorna,
      (attivo) => stati.push(attivo),
      segnalaErrore
    );

    expect(aggiorna).not.toHaveBeenCalled();
    expect(segnalaErrore).toHaveBeenCalledWith(errore);
    expect(stati).toEqual([true, false]);
  });
});
