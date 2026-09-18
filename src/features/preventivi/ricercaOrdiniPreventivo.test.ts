import { describe, expect, it } from "vitest";
import type { Preventivo } from "../../lib/tauri";
import {
  corrispondeRicercaOrdine,
  ordiniVisibiliPerPreventivo,
} from "./ricercaOrdiniPreventivo";

function ordine(
  id: string,
  data: string,
  clienteNome: string,
  medicoNome: string,
): Preventivo {
  return {
    ordineId: id,
    ordineNumero: id,
    ordineData: data,
    clienteNome,
    medicoNome,
  } as Preventivo;
}

describe("ricerca ordini per nuovo preventivo", () => {
  const ordini = [
    ordine("2026-10", "2026-09-17", "Mario Rossi", "Dott. Bianchi"),
    ordine("2025-22", "2025-05-10", "Menegon Orietta", "Dr. Crescioli"),
  ];

  it("a ricerca vuota rispetta l'anno selezionato", () => {
    expect(ordiniVisibiliPerPreventivo(ordini, 2026, "").map((o) => o.ordineId))
      .toEqual(["2026-10"]);
  });

  it("cerca cliente, medico e numero in tutti gli anni", () => {
    expect(ordiniVisibiliPerPreventivo(ordini, 2026, "menegon")[0]?.ordineId)
      .toBe("2025-22");
    expect(ordiniVisibiliPerPreventivo(ordini, 2026, "crescioli")[0]?.ordineId)
      .toBe("2025-22");
    expect(ordiniVisibiliPerPreventivo(ordini, 2026, "2025-22")[0]?.ordineId)
      .toBe("2025-22");
  });

  it("limita il rendering dopo aver cercato nell'intero dominio", () => {
    expect(ordiniVisibiliPerPreventivo(ordini, 0, "", 1)).toHaveLength(1);
  });

  it("verifica puntualmente corrispondeRicercaOrdine con normalizzazione", () => {
    const o = ordine("ORD-99", "2026-03-01", "Oriétta Mènegon", "Dr. Crèscioli");
    expect(corrispondeRicercaOrdine(o, "menegon")).toBe(true);
    expect(corrispondeRicercaOrdine(o, "crescioli")).toBe(true);
    expect(corrispondeRicercaOrdine(o, "ord-99")).toBe(true);
    expect(corrispondeRicercaOrdine(o, "sconosciuto")).toBe(false);
  });
});
