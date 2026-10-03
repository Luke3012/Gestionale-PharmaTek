import { describe, expect, it } from "vitest";
import type { Pagamento, Preventivo, RecordDto } from "../../lib/tauri";
import {
  applicaPatchPagamentoVirtuale,
  campiContoPagamentoVirtuale,
  giorniTraScadenze,
  ratePreventivoDaSalvare,
  riallineaScadenzarioPreventivo,
  righeDaPreventivo,
  snapshotPreventivoEditor,
  testataDaPreventivo,
} from "./preventivoEditorModel";

const preventivo = {
  revision: "preventivo-1",
  validitaGiorni: 45,
  condizioniPagamento: "Bonifico",
  introduzione: "Introduzione",
  note: "Note",
  scontoPercentuale: 5,
  acconto: 1000,
  linee: ["Diagnostica"],
  righe: [{
    id: "riga-1",
    revision: "riga-rev-1",
    prodottoId: "prodotto-1",
    prodottoNome: "Prodotto",
    categoria: "Diagnostica",
    qta: 2,
    prezzo: 1234,
    paziente: "Paziente",
    tipoTest: "PRICK TEST",
    ml: "",
    codice: "C",
    formulazione: "F",
    posologia: "P",
    numero: "N",
    allergeni: ["A"],
  }],
} as Preventivo;

describe("modello editor preventivo", () => {
  const voce = (tipo: Pagamento["tipo"], importo: number, extra: Partial<Pagamento> = {}): Pagamento => ({
    id: `${tipo}-${importo}`, ordineId: "ordine-1", tipo, importo,
    saldato: false, scadenza: "", scadDaSpedizione: tipo !== "acconto",
    scadRelGiorni: 0, ...campiContoPagamentoVirtuale("banca"), ...extra,
  });
  const creaAcconto = (importo: number) => voce("acconto", importo);

  it("riserva l'acconto prima di riallineare le due rate preferite del nuovo preventivo", () => {
    const piano = [voce("rata", 8000), voce("rata", 8000, { id: "rata-2", scadRelGiorni: 31 })];
    const preview = riallineaScadenzarioPreventivo(piano, 25000, 9000, true, creaAcconto);
    expect(preview.map((p) => [p.tipo, p.importo])).toEqual([
      ["rata", 8000], ["rata", 8000], ["acconto", 9000],
    ]);
    expect(piano).toHaveLength(2);
    expect(ratePreventivoDaSalvare(preview.filter((p) => p.tipo === "rata"), "2026-10-03"))
      .toEqual([{ importo: 8000, scadenza: "2026-10-10" }, { importo: 8000, scadenza: "2026-11-10" }]);
  });

  it("ricalcola il saldo quando cambiano acconto e totale senza duplicare l'acconto", () => {
    const piano = [creaAcconto(9000), voce("rata", 8000), voce("rata", 8000)];
    expect(riallineaScadenzarioPreventivo(piano, 30000, 10000, true, creaAcconto)
      .map((p) => p.importo)).toEqual([10000, 10000, 10000]);
    expect(riallineaScadenzarioPreventivo(piano, 25000, 0, true, creaAcconto)
      .map((p) => [p.tipo, p.importo])).toEqual([["rata", 12500], ["rata", 12500]]);
    expect(riallineaScadenzarioPreventivo(piano, 25000, 25000, true, creaAcconto)
      .map((p) => [p.tipo, p.importo])).toEqual([["acconto", 25000]]);
  });

  it("preserva i pagamenti incassati e sottrae le quote fisse dal saldo", () => {
    const piano = [voce("acconto", 9000, { saldato: true }), voce("rata", 8000), voce("rata", 8000)];
    expect(riallineaScadenzarioPreventivo(piano, 25000, 12000, true, creaAcconto)
      .map((p) => p.importo)).toEqual([9000, 8000, 8000]);
    expect(riallineaScadenzarioPreventivo([voce("saldo", 25000, { saldato: true })], 25000, 9000, true, creaAcconto))
      .toHaveLength(1);
  });

  it("conserva le date fisse e gli intervalli personalizzati delle rate da spedizione", () => {
    expect(ratePreventivoDaSalvare([
      voce("rata", 8000, { scadDaSpedizione: false, scadenza: "2026-12-01" }),
      voce("rata", 8000, { scadRelGiorni: 45 }),
    ], "2026-10-03")).toEqual([
      { importo: 8000, scadenza: "2026-12-01" },
      { importo: 8000, scadenza: "2026-11-24" },
    ]);
  });

  it("mantiene la distanza arrotondata e non negativa tra le scadenze", () => {
    expect(giorniTraScadenze("2026-08-01", "2026-08-31")).toBe(30);
    expect(giorniTraScadenze("2026-08-31", "2026-08-01")).toBe(0);
    expect(giorniTraScadenze("data-non-valida", "2026-08-31")).toBeNaN();
  });

  it("converte testata e righe persistite nel formato dell'editor", () => {
    expect(testataDaPreventivo(preventivo)).toEqual({
      validita: 45,
      condizioni: "Bonifico",
      introduzione: "Introduzione",
      note: "Note",
      scontoPercentuale: 5,
      acconto: 1000,
      linea: "Diagnostica",
      fatturazioneDiversa: false,
      fatturazione: {
        ragione_sociale: "",
        indirizzo: "",
        citta: "",
        prov: "",
        cap: "",
        piva: "",
      },
    });
    expect(righeDaPreventivo(preventivo)).toEqual([
      expect.objectContaining({
        key: "riga-1",
        revision: "riga-rev-1",
        prezzo: 12.34,
        qta: 2,
      }),
    ]);
  });

  it("crea Preparazione 1 quando il preventivo non contiene prodotti", () => {
    const righe = righeDaPreventivo({ ...preventivo, righe: [] });
    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatchObject({
      prodottoId: "",
      prodottoNome: "",
      qta: 1,
      prezzo: "",
      tipoTest: "PRICK TEST",
    });
  });

  it("esclude la chiave React dalla firma delle modifiche", () => {
    const [riga] = righeDaPreventivo(preventivo);
    const fatturazione = { ragione_sociale: "", indirizzo: "", citta: "", prov: "", cap: "", piva: "" };
    const prima = snapshotPreventivoEditor(preventivo, [riga], 45, "Bonifico", "Introduzione", "Note", 5, 1000, "Diagnostica", false, fatturazione);
    const seconda = snapshotPreventivoEditor(preventivo, [{ ...riga, key: "altra-key" }], 45, "Bonifico", "Introduzione", "Note", 5, 1000, "Diagnostica", false, fatturazione);

    expect(seconda).toBe(prima);
  });

  it("applica la patch soltanto al pagamento scelto e aggiorna i dati del conto", () => {
    const pagamento = { id: "pagamento-1", contoNome: "Vecchio" } as Pagamento;
    const conto: RecordDto = {
      id: "conto-1",
      revision: "conto-rev-1",
      deleted: false,
      data: { nome: "Banca", tipo: "banca", iban: "IT00" },
    };

    expect(applicaPatchPagamentoVirtuale(pagamento, "altro", {}, new Map())).toBe(pagamento);
    expect(applicaPatchPagamentoVirtuale(
      pagamento,
      pagamento.id,
      { contoId: conto.id, scadenza: "2026-09-01" },
      new Map([[conto.id, conto]]),
    )).toMatchObject({
      id: "pagamento-1",
      contoId: "conto-1",
      contoNome: "Banca",
      contoTipo: "banca",
      contoIban: "IT00",
      scadenza: "2026-09-01",
    });
  });

  it("costruisce i campi conto vuoti preservando l'id esplicito", () => {
    expect(campiContoPagamentoVirtuale("conto-non-caricato")).toEqual({
      contoId: "conto-non-caricato",
      contoNome: "",
      contoTipo: "",
      contoIban: "",
      data: "",
      verificato: false,
      distintaId: "",
      contoAccreditoNome: "",
      note: "",
    });
  });
});
