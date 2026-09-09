import { describe, expect, it } from "vitest";
import type { Pagamento, Preventivo, RecordDto } from "../../lib/tauri";
import {
  applicaPatchPagamentoVirtuale,
  campiContoPagamentoVirtuale,
  giorniTraScadenze,
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

  it("esclude la chiave React dalla firma delle modifiche", () => {
    const [riga] = righeDaPreventivo(preventivo);
    const prima = snapshotPreventivoEditor(preventivo, [riga], 45, "Bonifico", "Introduzione", "Note", 5, 1000, "Diagnostica");
    const seconda = snapshotPreventivoEditor(preventivo, [{ ...riga, key: "altra-key" }], 45, "Bonifico", "Introduzione", "Note", 5, 1000, "Diagnostica");

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
