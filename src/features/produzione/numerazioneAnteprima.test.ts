import { describe, expect, it } from "vitest";
import type { RecordDto } from "../../lib/tauri";
import { numeriAnteprimaProduzione, ultimoNumeroProduzione } from "./numerazioneAnteprima";

function riga(id: string, numero?: number): RecordDto {
  return {
    id,
    revision: "1",
    deleted: false,
    data: numero === undefined ? {} : { numero_produzione: numero },
  };
}

describe("numerazione dell'anteprima Laboratorio", () => {
  it("continua dopo il massimo globale già assegnato", () => {
    const precedenti = Array.from({ length: 12 }, (_, i) => riga(String(i + 1), i + 1));
    const nuova = riga("nuova");
    const ultimo = ultimoNumeroProduzione([...precedenti, nuova], 1);
    expect(numeriAnteprimaProduzione([nuova], ultimo)).toEqual([13]);
  });

  it("riusa i numeri esistenti e applica la base solo alle nuove righe", () => {
    const giaNumerata = riga("vecchia", 11);
    const prima = riga("prima");
    const seconda = riga("seconda");
    const ultimo = ultimoNumeroProduzione([giaNumerata, prima, seconda], 20);
    expect(numeriAnteprimaProduzione([giaNumerata, prima, seconda], ultimo))
      .toEqual([11, 20, 21]);
  });

  it("non modifica i record letti per mostrare l'anteprima", () => {
    const nuova = riga("nuova");
    expect(numeriAnteprimaProduzione([nuova], ultimoNumeroProduzione([nuova], 1))).toEqual([1]);
    expect(nuova.data).toEqual({});
  });
});
