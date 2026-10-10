import { describe, expect, it } from "vitest";
import { ordiniPerRiepilogo } from "./riepilogoOrdini";

const ordini = [
  { id: "vecchio-aperto", data: "2025-12-31", stato: "Confermato" },
  { id: "vecchio-chiuso", data: "2025-10-09", stato: "Chiuso" },
  { id: "aperto", data: "2026-01-01", stato: "Confermato" },
  { id: "chiuso", data: "2026-10-09", stato: "Chiuso" },
  { id: "chiuso-prima", data: "2026-02-01", stato: "Chiuso" },
  { id: "aperto-recente", data: "2026-12-31", stato: "Spedito" },
  { id: "rifiutato", data: "2026-03-01", stato: "Rifiutato" },
  { id: "futuro", data: "2027-01-01", stato: "Chiuso" },
  { id: "senza-data", data: "", stato: "Chiuso" },
];

describe("ordini del riepilogo", () => {
  it("mostra aperti e chiusi solo dell'anno richiesto, dai più recenti", () => {
    const risultato = ordiniPerRiepilogo(ordini, 2026);
    expect(risultato.inAttesa.map((o) => o.id)).toEqual(["aperto-recente", "aperto"]);
    expect(risultato.chiusi.map((o) => o.id)).toEqual(["chiuso", "chiuso-prima"]);
  });

  it("conserva la coda senza limite di anno per medici e agenti", () => {
    const risultato = ordiniPerRiepilogo(ordini);
    expect(risultato.inAttesa.map((o) => o.id)).toEqual(["aperto-recente", "aperto", "vecchio-aperto"]);
    expect(risultato.chiusi).toEqual([]);
  });

  it("gestisce elenchi vuoti senza modificare l'ordine originale", () => {
    const prima = structuredClone(ordini);
    expect(ordiniPerRiepilogo([], 2026)).toEqual({ inAttesa: [], chiusi: [] });
    ordiniPerRiepilogo(ordini, 2026);
    expect(ordini).toEqual(prima);
  });
});
