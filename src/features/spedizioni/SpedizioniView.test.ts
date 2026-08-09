import { describe, expect, it } from "vitest";
import type { Spedizione } from "../../lib/tauri";
import { numeroComunicazioniSpedizione } from "./SpedizioniView";

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
