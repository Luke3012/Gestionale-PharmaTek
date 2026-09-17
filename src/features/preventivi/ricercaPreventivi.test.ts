import { describe, expect, it } from "vitest";
import type { Preventivo } from "../../lib/tauri";
import { testoRicercaPreventivo } from "./ricercaPreventivi";

describe("ricerca preventivi", () => {
  it("indicizza i numeri lotto presenti sulle preparazioni", () => {
    const preventivo = {
      numeroPreventivo: "P-2026-0128",
      ordineNumero: "2026-0128",
      clienteNome: "Luca Tartaglia",
      medicoNome: "",
      agenteNome: "",
      email: "",
      telefono: "",
      righe: [
        {
          prodottoNome: "Polimerizzato 1 fiala",
          paziente: "",
          formulazione: "",
          posologia: "",
          numero: "508245",
          codice: "",
          tipoTest: "",
          allergeni: [],
        },
      ],
    } as unknown as Preventivo;

    expect(testoRicercaPreventivo(preventivo)).toContain("508245");
  });

  it("mantiene ricercabili telefono, prodotto e paziente", () => {
    const preventivo = {
      numeroPreventivo: "P-1",
      ordineNumero: "1",
      clienteNome: "Cliente",
      medicoNome: "Medico",
      agenteNome: "Agente",
      email: "demo@example.invalid",
      telefono: "+39 333 123 4567",
      righe: [
        {
          prodottoNome: "Prodotto",
          paziente: "Paziente Uno",
          formulazione: "",
          posologia: "",
          numero: "",
          codice: "",
          tipoTest: "",
          allergeni: [],
        },
      ],
    } as unknown as Preventivo;

    const testo = testoRicercaPreventivo(preventivo);
    expect(testo).toContain("3331234567");
    expect(testo).toContain("prodotto");
    expect(testo).toContain("paziente uno");
  });
});
