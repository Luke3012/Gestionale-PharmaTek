import { describe, expect, it } from "vitest";
import type { RecordDto } from "../../lib/tauri";
import { nuovaRiga, type RigaForm } from "./righeOrdine";
import { precompilaMantenimentoRiga } from "./mantenimentoOrdine";

function record(id: string, data: Record<string, unknown>): RecordDto {
  return { id, revision: "1", data, deleted: false };
}

function riga(overrides: Partial<RigaForm> = {}): RigaForm {
  return { ...nuovaRiga(), prodottoNome: "Prodotto", prezzo: 1, ...overrides };
}

describe("mantenimento ordine", () => {
  it("usa l'ordine più recente senza sovrascrivere i campi compilati", () => {
    const corrente = riga({ id: "riga-corrente", prodottoId: "p1", formulazione: "manuale" });
    const risultato = precompilaMantenimentoRiga(corrente, {
      attivo: true,
      clienteId: "cliente-1",
      ordineId: "ordine-corrente",
      ordini: [
        record("ordine-vecchio", { cliente_id: "cliente-1", data: "2025-01-01" }),
        record("ordine-recente", { cliente_id: "cliente-1", data: "2025-06-01" }),
        record("ordine-corrente", { cliente_id: "cliente-1", data: "2026-01-01" }),
        record("ordine-altro", { cliente_id: "cliente-2", data: "2027-01-01" }),
      ],
      righe: [
        record("vecchia", { ordine_id: "ordine-vecchio", prodotto_id: "p1", formulazione: "gocce", posologia: "mattina" }),
        record("recente", { ordine_id: "ordine-recente", prodotto_id: "p1", formulazione: "spray", posologia: "sera", allergeni: ["graminacee"] }),
        record("stesso-ordine", { ordine_id: "ordine-corrente", prodotto_id: "p1", posologia: "da ignorare" }),
        record("altro-cliente", { ordine_id: "ordine-altro", prodotto_id: "p1", posologia: "da ignorare" }),
      ],
      nomiProdotti: new Map([["p1", "Prodotto"]]),
    });

    expect(risultato).not.toBe(corrente);
    expect(risultato).toMatchObject({ formulazione: "manuale", posologia: "sera", allergeni: ["graminacee"] });
  });

  it("riconosce per nome un prodotto storico anche senza id di catalogo", () => {
    const risultato = precompilaMantenimentoRiga(riga({ prodottoId: "", prodottoNome: "  PRODOTTO  " }), {
      attivo: true,
      clienteId: "cliente",
      ordineId: null,
      ordini: [record("ordine", { cliente_id: "cliente", data: "2025-01-01" })],
      righe: [record("storica", { ordine_id: "ordine", prodotto_id: "p1", formulazione: "sublinguale" })],
      nomiProdotti: new Map([["p1", "Prodotto"]]),
    });

    expect(risultato.formulazione).toBe("sublinguale");
  });

  it("mantiene la stessa riga quando il recupero dallo storico non è applicabile", () => {
    const corrente = riga({ prodottoId: "p1" });
    expect(precompilaMantenimentoRiga(corrente, {
      attivo: false,
      clienteId: "cliente",
      ordineId: null,
      ordini: [],
      righe: [],
      nomiProdotti: new Map(),
    })).toBe(corrente);
  });
});
