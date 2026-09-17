import { describe, expect, it } from "vitest";
import type { Spedizione } from "../../lib/tauri";
import { isModalitaRicerca, numeroComunicazioniSpedizione } from "./SpedizioniView";
import { contaLottiSpedizionePerAnno } from "./filtriSpedizione";

const spedizione = (id: string, clienteId: string) =>
  ({ id, clienteId }) as Spedizione;

describe("azioni comunicazioni delle spedizioni", () => {
  it("conta una comunicazione per cliente e non una per lotto selezionato", () => {
    expect(
      numeroComunicazioniSpedizione([
        spedizione("collo-1", "cliente-1"),
        spedizione("collo-2", "cliente-1"),
        spedizione("collo-3", "cliente-2"),
        spedizione("collo-senza-cliente", ""),
      ]),
    ).toBe(2);
  });
});

describe("isModalitaRicerca", () => {
  it("riconosce quando la ricerca è attiva o vuota", () => {
    expect(isModalitaRicerca("")).toBe(false);
    expect(isModalitaRicerca("   ")).toBe(false);
    expect(isModalitaRicerca("Mario")).toBe(true);
    expect(isModalitaRicerca("", "Rossi")).toBe(true);
    expect(isModalitaRicerca("  ", "  ")).toBe(false);
  });
});

describe("conteggio lotti di spedizione per anno", () => {
  it("conta i gruppi visivi e non le singole spedizioni", () => {
    const spedizioni = [
      { id: "s1", data: "2026-01-10", lotto: "lotto-a" },
      { id: "s2", data: "2026-01-11", lotto: "lotto-a" },
      { id: "s3", data: "2025-12-20", lotto: "lotto-b" },
    ] as Spedizione[];

    expect(contaLottiSpedizionePerAnno(spedizioni, 2026)).toBe(1);
    expect(contaLottiSpedizionePerAnno(spedizioni, 2025)).toBe(1);
    expect(contaLottiSpedizionePerAnno(spedizioni, 0)).toBe(2);
  });
});
