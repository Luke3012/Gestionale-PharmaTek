import { describe, expect, it } from "vitest";
import { registraPressioneReset, STATO_SEQUENZA_RESET_INIZIALE } from "./sequenzaReset";

describe("sequenza reset", () => {
  it("si attiva alla quinta pressione consecutiva", () => {
    let stato = STATO_SEQUENZA_RESET_INIZIALE;
    for (let i = 0; i < 4; i += 1) {
      const esito = registraPressioneReset(stato, 1_000 + i * 100);
      stato = esito.stato;
      expect(esito.attiva).toBe(false);
    }
    expect(registraPressioneReset(stato, 1_400).attiva).toBe(true);
  });

  it("azzera la sequenza dopo il timeout", () => {
    const primo = registraPressioneReset(STATO_SEQUENZA_RESET_INIZIALE, 1_000);
    const secondo = registraPressioneReset(primo.stato, 2_501);
    expect(secondo).toEqual({
      stato: { conteggio: 1, ultimaPressioneMs: 2_501 },
      attiva: false,
    });
  });

  it("combina qualunque sorgente perché il contatore è unico", () => {
    let stato = STATO_SEQUENZA_RESET_INIZIALE;
    const sorgenti = ["cestino", "Canc", "cestino", "Canc", "cestino"];
    const esiti = sorgenti.map((_, indice) => {
      const esito = registraPressioneReset(stato, 5_000 + indice * 150);
      stato = esito.stato;
      return esito.attiva;
    });
    expect(esiti).toEqual([false, false, false, false, true]);
  });
});
