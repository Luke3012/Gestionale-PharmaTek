import { describe, expect, it } from "vitest";
import {
  eccedenzaOrdineNonSalvata,
  impattoRimborsoDopoIncasso,
  riepilogaRimborsiExtraOrdine,
  rimborsoCopreEccedenzaScadenzario,
} from "./statiRimborso";
import type { Rimborso } from "../../lib/tauri";

function rimborso(
  id: string,
  importo: number,
  stato: "richiesto" | "effettuato"
): Rimborso {
  return {
    id,
    importo,
    stato,
    dataRichiesta: "2026-07-16",
    dataRimborso: stato === "effettuato" ? "2026-07-16" : "",
    ragioneSociale: "Cliente",
    motivo: "Soldi in eccesso",
    iban: "",
    contoId: "",
    contoNome: "",
    note: "",
    ordineId: "ordine-1",
    ordineNumero: "1",
    clienteId: "cliente-1",
    origine: "extra",
  };
}

describe("rimborso collegato a un ordine in modifica", () => {
  it("richiede prima il salvataggio quando l'eccedenza mostrata è diversa", () => {
    expect(eccedenzaOrdineNonSalvata(22500, 22000)).toBe(true);
  });

  it("consente l'apertura quando bozza e ordine salvato coincidono", () => {
    expect(eccedenzaOrdineNonSalvata(22500, 22500)).toBe(false);
  });

  it("non blocca mentre il valore salvato non è ancora disponibile", () => {
    expect(eccedenzaOrdineNonSalvata(22500, null)).toBe(false);
  });

  it("non richiede adeguamenti quando il rimborso richiesto copre già tutto l'extra", () => {
    expect(
      rimborsoCopreEccedenzaScadenzario({
        totale: 30_000,
        coperto: 50_500,
        eccedenza: 20_500,
        rimborsoRichiesto: 20_500,
        rimborsiEffettuati: 0,
      })
    ).toBe(true);
  });

  it("mantiene il controllo se oltre all'extra esistono altre rate aperte", () => {
    expect(
      rimborsoCopreEccedenzaScadenzario({
        totale: 30_000,
        coperto: 51_000,
        eccedenza: 20_500,
        rimborsoRichiesto: 20_500,
        rimborsiEffettuati: 0,
      })
    ).toBe(false);
  });

  it("considera anche quanto è già stato rimborsato", () => {
    expect(
      rimborsoCopreEccedenzaScadenzario({
        totale: 30_000,
        coperto: 50_500,
        eccedenza: 20_500,
        rimborsoRichiesto: 15_500,
        rimborsiEffettuati: 5_000,
      })
    ).toBe(true);
  });

  it("riconosce un'eccedenza coperta interamente da un rimborso già effettuato", () => {
    const riepilogo = riepilogaRimborsiExtraOrdine(
      [rimborso("emesso", 20_500, "effettuato")],
      "ordine-1"
    );

    expect(riepilogo.richiesto).toBeNull();
    expect(
      rimborsoCopreEccedenzaScadenzario({
        totale: 30_000,
        coperto: 50_500,
        eccedenza: 20_500,
        rimborsoRichiesto: riepilogo.richiesto?.importo ?? 0,
        rimborsiEffettuati: riepilogo.importoEffettuato,
      })
    ).toBe(true);
  });

  it("isola i rimborsi extra dell'ordine da manuali e rimborsi di altri ordini", () => {
    const manuale = { ...rimborso("manuale", 9_000, "effettuato"), origine: "manuale" as const };
    const altroOrdine = {
      ...rimborso("altro", 8_000, "richiesto"),
      ordineId: "ordine-2",
    };
    const richiesto = rimborso("aperto", 15_500, "richiesto");
    const effettuato = rimborso("emesso", 5_000, "effettuato");

    const riepilogo = riepilogaRimborsiExtraOrdine(
      [manuale, altroOrdine, richiesto, effettuato],
      "ordine-1"
    );

    expect(riepilogo.esistente?.id).toBe("aperto");
    expect(riepilogo.richiesto?.id).toBe("aperto");
    expect(riepilogo.importoEffettuato).toBe(5_000);
  });

  it("non considera coperta un'eccedenza se il rimborso ha un importo diverso", () => {
    const riepilogo = riepilogaRimborsiExtraOrdine(
      [rimborso("aperto", 5_000, "richiesto")],
      "ordine-1"
    );

    expect(
      rimborsoCopreEccedenzaScadenzario({
        totale: 81_000,
        coperto: 81_500,
        eccedenza: 500,
        rimborsoRichiesto: riepilogo.richiesto?.importo ?? 0,
        rimborsiEffettuati: riepilogo.importoEffettuato,
      })
    ).toBe(false);
  });

  it("mostra l'aggiornamento del rimborso richiesto senza riscrivere quelli effettuati", () => {
    expect(
      impattoRimborsoDopoIncasso({
        ordineId: "ordine-1",
        totale: 30_000,
        incassatoPrima: 50_000,
        nuovoIncasso: 500,
        rimborsi: [rimborso("emesso", 5_000, "effettuato"), rimborso("aperto", 15_000, "richiesto")],
      })
    ).toEqual({ importoAttuale: 15_000, importoDopo: 15_500, esistente: true });
  });

  it("usa lo stesso riepilogo per isolare ordine, origine e rimborso richiesto più recente", () => {
    const vecchio = { ...rimborso("vecchio", 10_000, "richiesto"), dataRichiesta: "2026-07-15" };
    const recente = { ...rimborso("recente", 15_000, "richiesto"), dataRichiesta: "2026-07-17" };
    const manuale = { ...rimborso("manuale", 30_000, "effettuato"), origine: "manuale" as const };
    const altroOrdine = { ...rimborso("altro", 30_000, "effettuato"), ordineId: "ordine-2" };

    expect(
      impattoRimborsoDopoIncasso({
        ordineId: "ordine-1",
        totale: 30_000,
        incassatoPrima: 50_000,
        nuovoIncasso: 500,
        rimborsi: [vecchio, manuale, rimborso("emesso", 5_000, "effettuato"), altroOrdine, recente],
      })
    ).toEqual({ importoAttuale: 15_000, importoDopo: 15_500, esistente: true });
  });
});
