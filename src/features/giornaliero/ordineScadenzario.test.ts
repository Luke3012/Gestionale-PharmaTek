import { describe, expect, it } from "vitest";
import type { Pagamento } from "../../lib/tauri";
import {
  aggiungiGiorniScadenzario,
  calcolaOffsetSpedizRighe,
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
  selezionaProssimoPagamentoDaSaldare,
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
    expect(offsetScadenzaDaSpedizione("bonifico", 0)).toBe(7);
    expect(offsetScadenzaDaSpedizione("bonifico", 30)).toBe(37);
    expect(offsetScadenzaDaSpedizione("bonifico", 60)).toBe(67);
    expect(offsetScadenzaDaSpedizione("contrassegno", 0)).toBe(30);
    expect(offsetScadenzaDaSpedizione("contrassegno", 30)).toBe(60);
  });

  it("calcola l'offset per ciascuna riga in base al proprio conto (30 per contrassegno, 7 + cadenza per banca)", () => {
    const righeContrassegnoEBanca = [
      { key: "saldo", contoTipo: "contrassegno", scadDaSpedizione: true },
      { key: "rata-1", contoTipo: "banca", scadDaSpedizione: true },
      { key: "rata-2", contoTipo: "banca", scadDaSpedizione: true },
    ];
    const offsetMisto = calcolaOffsetSpedizRighe(righeContrassegnoEBanca);
    expect(offsetMisto.get("saldo")).toBe(30);
    expect(offsetMisto.get("rata-1")).toBe(37);
    expect(offsetMisto.get("rata-2")).toBe(67);

    const righeTuttoContrassegno = [
      { key: "saldo", contoTipo: "contrassegno", scadDaSpedizione: true },
      { key: "rata-1", contoTipo: "contrassegno", scadDaSpedizione: true },
      { key: "rata-2", contoTipo: "contrassegno", scadDaSpedizione: true },
    ];
    const offsetCod = calcolaOffsetSpedizRighe(righeTuttoContrassegno);
    expect(offsetCod.get("saldo")).toBe(30);
    expect(offsetCod.get("rata-1")).toBe(60);
    expect(offsetCod.get("rata-2")).toBe(90);

    const righeBanca = [
      { key: "saldo", contoTipo: "banca", scadDaSpedizione: true },
      { key: "rata-1", contoTipo: "banca", scadDaSpedizione: true },
      { key: "rata-2", contoTipo: "banca", scadDaSpedizione: true },
    ];
    const offsetBanca = calcolaOffsetSpedizRighe(righeBanca);
    expect(offsetBanca.get("saldo")).toBe(7);
    expect(offsetBanca.get("rata-1")).toBe(37);
    expect(offsetBanca.get("rata-2")).toBe(67);
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

  it("non propone acconto se il residuo è coperto e non c'è acconto previsto", () => {
    const proposta = proponiPagamentoAggiuntivo({
      pagamentiPreview: [
        pagamento({ id: "saldo-saldato", tipo: "saldo", importo: 9_000, saldato: true }),
        pagamento({ id: "__preview_scadenzario__saldo", tipo: "saldo", importo: 19_000 }),
      ],
      residuo: 19_000,
      accontoPrevisto: 0,
      scopertoScadenzario: 0,
    });

    expect(proposta).toEqual({ tipo: "saldo", importo: 19_000 });
  });

  describe("selezionaProssimoPagamentoDaSaldare", () => {
    it("privilegia la rata su conto bancario rispetto al contrassegno anche se il contrassegno scade prima", () => {
      const contrassegno = pagamento({
        id: "p-contrassegno",
        tipo: "rata",
        contoTipo: "contrassegno",
        scadenza: "2026-09-10",
        importo: 22_500,
      });
      const banca = pagamento({
        id: "p-banca",
        tipo: "rata",
        contoTipo: "banca",
        scadenza: "2026-09-25",
        importo: 22_500,
      });

      const scelto = selezionaProssimoPagamentoDaSaldare([contrassegno, banca]);
      expect(scelto?.id).toBe("p-banca");
    });

    it("propone il contrassegno se è l'unica voce aperta rimasta", () => {
      const bancaGiaSaldato = pagamento({
        id: "p-banca",
        tipo: "rata",
        contoTipo: "banca",
        scadenza: "2026-09-01",
        importo: 22_500,
        saldato: true,
      });
      const contrassegno = pagamento({
        id: "p-contrassegno",
        tipo: "rata",
        contoTipo: "contrassegno",
        scadenza: "2026-09-15",
        importo: 22_500,
        saldato: false,
      });

      const scelto = selezionaProssimoPagamentoDaSaldare([bancaGiaSaldato, contrassegno]);
      expect(scelto?.id).toBe("p-contrassegno");
    });

    it("privilegia sempre l'acconto rispetto a qualsiasi altra rata o saldo", () => {
      const acconto = pagamento({
        id: "p-acconto",
        tipo: "acconto",
        contoTipo: "banca",
        scadenza: "2026-09-05",
        importo: 9_000,
      });
      const rataBanca = pagamento({
        id: "p-rata-banca",
        tipo: "rata",
        contoTipo: "banca",
        scadenza: "2026-09-01",
        importo: 10_000,
      });
      const rataCod = pagamento({
        id: "p-rata-cod",
        tipo: "rata",
        contoTipo: "contrassegno",
        scadenza: "2026-09-02",
        importo: 10_000,
      });

      const scelto = selezionaProssimoPagamentoDaSaldare([rataCod, rataBanca, acconto]);
      expect(scelto?.id).toBe("p-acconto");
    });

    it("tra più rate bancarie sceglie quella con scadenza più vicina", () => {
      const bancaSeconda = pagamento({
        id: "p-banca-2",
        tipo: "rata",
        contoTipo: "banca",
        scadenza: "2026-10-15",
        importo: 10_000,
      });
      const bancaPrima = pagamento({
        id: "p-banca-1",
        tipo: "rata",
        contoTipo: "banca",
        scadenza: "2026-09-15",
        importo: 10_000,
      });
      const cod = pagamento({
        id: "p-cod",
        tipo: "rata",
        contoTipo: "contrassegno",
        scadenza: "2026-09-01",
        importo: 10_000,
      });

      const scelto = selezionaProssimoPagamentoDaSaldare([bancaSeconda, cod, bancaPrima]);
      expect(scelto?.id).toBe("p-banca-1");
    });

    it("ignora le preview locali e restituisce null se non ci sono pagamenti aperti", () => {
      const preview = pagamento({
        id: "__preview_scadenzario__saldo",
        tipo: "saldo",
        importo: 10_000,
        saldato: false,
      });
      const saldato = pagamento({
        id: "p-saldato",
        tipo: "saldo",
        importo: 10_000,
        saldato: true,
      });

      expect(selezionaProssimoPagamentoDaSaldare([preview, saldato])).toBeNull();
    });
  });

  describe("calcolaOffsetSpedizRighe con contrassegno e banca", () => {
    it("se la 1ª rata è contrassegno (+30gg) e la 2ª è banca, calcola +30gg e +37gg", () => {
      const righe = [
        { key: "rata-1", contoTipo: "contrassegno", scadDaSpedizione: true, scadRelGiorni: 0 },
        { key: "rata-2", contoTipo: "banca", scadDaSpedizione: true, scadRelGiorni: 30 },
      ];
      const offsets = calcolaOffsetSpedizRighe(righe);
      expect(offsets.get("rata-1")).toBe(30);
      expect(offsets.get("rata-2")).toBe(37);
    });

    it("se la 1ª rata è banca, ancora a +7gg e calcola la 2ª a +37gg", () => {
      const righe = [
        { key: "rata-1", contoTipo: "banca", scadDaSpedizione: true, scadRelGiorni: 0 },
        { key: "rata-2", contoTipo: "banca", scadDaSpedizione: true, scadRelGiorni: 30 },
      ];
      const offsets = calcolaOffsetSpedizRighe(righe);
      expect(offsets.get("rata-1")).toBe(7);
      expect(offsets.get("rata-2")).toBe(37);
    });
  });

  describe("stabilita ordinamento rate collegate alla spedizione", () => {
    it("confrontaPagamentiAperti ordina per scadRelGiorni anche se gli ID sono in ordine inverso", () => {
      const r1 = pagamento({
        id: "z-rata-cod",
        tipo: "rata",
        scadDaSpedizione: true,
        scadRelGiorni: 0,
        scadenza: "",
      });
      const r2 = pagamento({
        id: "a-rata-banca",
        tipo: "rata",
        scadDaSpedizione: true,
        scadRelGiorni: 30,
        scadenza: "",
      });
      const sorted = [r2, r1].sort(confrontaPagamentiAperti);
      expect(sorted[0].id).toBe("z-rata-cod");
      expect(sorted[1].id).toBe("a-rata-banca");
    });

    it("confrontaRigheScadenzario ordina per scadRelGiorni preservando la sequenza delle rate", () => {
      const riga1 = {
        key: "z-riga-cod",
        tipo: "rata" as const,
        scadDaSpedizione: true,
        scadRelGiorni: 0,
        contoTipo: "contrassegno",
      };
      const riga2 = {
        key: "a-riga-banca",
        tipo: "rata" as const,
        scadDaSpedizione: true,
        scadRelGiorni: 30,
        contoTipo: "banca",
      };
      const sorted = [riga2, riga1].sort(confrontaRigheScadenzario);
      expect(sorted[0].key).toBe("z-riga-cod");
      expect(sorted[1].key).toBe("a-riga-banca");
    });
  });
});
