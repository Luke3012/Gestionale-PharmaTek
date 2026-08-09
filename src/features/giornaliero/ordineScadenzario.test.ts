import { describe, expect, it } from "vitest";
import type { Pagamento } from "../../lib/tauri";
import {
  aggiungiGiorniScadenzario,
  confrontaPagamentiAperti,
  confrontaRigheScadenzario,
  firmaScadenzario,
  formatDataScadenzario,
  giorniTra,
  offsetScadenzaDaSpedizione,
  pagamentoApertoDaSaldare,
  pagamentoApertoSaldoRata,
  pagamentoPersistitoConImportoPreview,
  pagamentoPreviewLocale,
  proponiPagamentoAggiuntivo,
} from "./ordineScadenzario";

function pagamento(patch: Partial<Pagamento>): Pagamento {
  return {
    id: "p",
    tipo: "saldo",
    importo: 100,
    saldato: false,
    scadenza: "2026-07-20",
    data: "",
    contoId: "conto",
    ...patch,
  } as Pagamento;
}

describe("scadenzario ordine", () => {
  it("mantiene filtri, preview e priorità storiche", () => {
    expect(pagamentoApertoSaldoRata(pagamento({ tipo: "rata" }))).toBe(true);
    expect(pagamentoApertoSaldoRata(pagamento({ tipo: "acconto" }))).toBe(false);
    expect(pagamentoApertoDaSaldare(pagamento({ tipo: "acconto" }))).toBe(true);
    expect(pagamentoPreviewLocale({ id: "__local_pagamento__1" })).toBe(true);

    const ordinati = [
      pagamento({ id: "saldo", tipo: "saldo", scadenza: "2026-07-01" }),
      pagamento({ id: "acconto", tipo: "acconto", scadenza: "2026-08-01" }),
    ].sort(confrontaPagamentiAperti);
    expect(ordinati.map((p) => p.id)).toEqual(["acconto", "saldo"]);
  });

  it("firma senza mutare l'ordine ricevuto", () => {
    const pagamenti = [pagamento({ id: "b" }), pagamento({ id: "a" })];
    expect(firmaScadenzario(pagamenti)).toContain("a:saldo:100:0");
    expect(pagamenti.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it.each([
    ["acconto", 9_000, 11_500],
    ["saldo", 19_000, 16_500],
    ["rata", 9_500, 8_250],
  ] as const)(
    "separa l'importo preview dalla baseline persistita per un %s",
    (tipo, importoPersistito, importoPreview) => {
      const persistito = pagamento({
        id: `persistito-${tipo}`,
        tipo,
        importo: importoPersistito,
        note: "baseline reale",
      });
      const preview = { ...persistito, importo: importoPreview };
      const risultato = pagamentoPersistitoConImportoPreview(preview, [persistito]);

      expect(risultato).toEqual({
        pagamento: persistito,
        importoProposto: importoPreview,
      });
      expect(risultato.pagamento).toBe(persistito);
      expect(persistito.importo).toBe(importoPersistito);
    }
  );

  it("lascia invariati pagamento ordinario, nuovo e locale quando non esiste una preview divergente", () => {
    const persistito = pagamento({ id: "rata-esistente", tipo: "rata", importo: 8_000 });
    const locale = pagamento({
      id: "__local_pagamento__rata",
      tipo: "rata",
      importo: 4_000,
    });

    expect(pagamentoPersistitoConImportoPreview(persistito, [persistito])).toEqual({
      pagamento: persistito,
    });
    expect(pagamentoPersistitoConImportoPreview(locale, [persistito])).toEqual({
      pagamento: locale,
    });
  });

  it("ordina le righe legate alla spedizione per offset e chiave", () => {
    const righe = [
      { key: "b", tipo: "rata", scadDaSpedizione: true, scadRelGiorni: 30 },
      { key: "a", tipo: "rata", scadDaSpedizione: true, scadRelGiorni: 7 },
      { key: "c", tipo: "acconto", scadenza: "2026-12-01" },
    ].sort(confrontaRigheScadenzario);
    expect(righe.map((r) => r.key)).toEqual(["c", "a", "b"]);
  });

  it("mantiene calcoli e formattazione delle date", () => {
    expect(aggiungiGiorniScadenzario("2026-01-31", 1)).toBe("2026-02-01");
    expect(giorniTra("2026-07-01", "2026-07-08")).toBe(7);
    expect(giorniTra(undefined, "2026-07-08")).toBe(0);
    expect(formatDataScadenzario("2026-07-12")).toBe("12/07/2026");
    expect(offsetScadenzaDaSpedizione("contrassegno", 7)).toBe(37);
    expect(offsetScadenzaDaSpedizione("bonifico", 7)).toBe(14);
  });

  it("propone il saldo ricreato dopo aver eliminato la rata con acconto già incassato", () => {
    const proposta = proponiPagamentoAggiuntivo({
      pagamentiPreview: [
        pagamento({ id: "acconto-incassato", tipo: "acconto", importo: 9_000, saldato: true }),
        pagamento({ id: "__preview_scadenzario__saldo", tipo: "saldo", importo: 19_000 }),
      ],
      residuo: 19_000,
      accontoPrevisto: 9_000,
      scopertoScadenzario: 0,
    });

    expect(proposta).toEqual({ tipo: "saldo", importo: 19_000 });
  });

  it("non duplica l'acconto quando acconto e saldo sono stati ricreati come provvisori", () => {
    const proposta = proponiPagamentoAggiuntivo({
      pagamentiPreview: [
        pagamento({ id: "__preview_scadenzario__acconto", tipo: "acconto", importo: 9_000 }),
        pagamento({ id: "__preview_scadenzario__saldo", tipo: "saldo", importo: 19_000 }),
      ],
      residuo: 28_000,
      accontoPrevisto: 9_000,
      scopertoScadenzario: 0,
    });

    expect(proposta).toEqual({ tipo: "saldo", importo: 19_000 });
  });

  it("mantiene la proposta acconto quando lo scadenzario è davvero vuoto", () => {
    const proposta = proponiPagamentoAggiuntivo({
      pagamentiPreview: [],
      residuo: 28_000,
      accontoPrevisto: 9_000,
      scopertoScadenzario: 28_000,
    });

    expect(proposta).toEqual({ tipo: "acconto", importo: 9_000 });
  });

  it("mantiene l'acconto quando è l'unica voce automatica e copre tutto l'ordine", () => {
    const proposta = proponiPagamentoAggiuntivo({
      pagamentiPreview: [
        pagamento({ id: "__preview_scadenzario__acconto", tipo: "acconto", importo: 28_000 }),
      ],
      residuo: 28_000,
      accontoPrevisto: 28_000,
      scopertoScadenzario: 0,
    });

    expect(proposta).toEqual({ tipo: "acconto", importo: 28_000 });
  });

});
