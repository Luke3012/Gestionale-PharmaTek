import { describe, expect, it } from "vitest";
import type { RecordDto } from "../../lib/tauri";
import {
  adeguaRigheFormATotale,
  azzeraPrezziRigheForm,
  azzeraRigaForm,
  campiPersistenzaRigaForm,
  nuovaRiga,
  riduciRigheForm,
  mergeRigheOrdineRealtime,
  righeOrdineDaRecord,
  totaleRigheForm,
  type RigaForm,
} from "./righeOrdine";

function rigaSalvata(id: string, prezzo: number, paziente = "Mario"): RigaForm {
  return {
    key: id, id, prodottoId: "p", prodottoNome: "Prodotto", qta: 1, prezzo,
    paziente, tipoTest: "", ml: "", codice: "", formulazione: "", posologia: "",
    numero: "", allergeni: [],
  };
}

function riga(overrides: Partial<RigaForm> = {}): RigaForm {
  return {
    ...nuovaRiga(),
    prodottoNome: "Prodotto",
    prezzo: 1,
    ...overrides,
  };
}

describe("righe ordine", () => {
  it("azzera l'unica riga mantenendo la chiave usata dal nodo visivo", () => {
    const esistente = rigaSalvata("r1", 10);
    const azzerata = azzeraRigaForm(
      { ...esistente, formulazione: "spray", allergeni: ["cipresso"] },
      true,
    );

    expect(azzerata).toMatchObject({
      key: "r1",
      prodottoId: "",
      prodottoNome: "",
      prezzo: "",
      formulazione: "",
      allergeni: [],
      tipoTest: "PRICK TEST",
    });
    expect(azzerata.id).toBeUndefined();
  });

  it("calcola i totali in centesimi rispettando quantità e arrotondamento", () => {
    expect(totaleRigheForm([riga({ qta: 2, prezzo: 12.345 }), riga({ qta: 1, prezzo: "" })])).toBe(2470);
  });

  it("traduce una riga libera nei campi persistiti normalizzando testo e prezzo", () => {
    const allergeni = ["A", "B"];
    expect(campiPersistenzaRigaForm(riga({
      prodottoId: "",
      prodottoNome: "  Prodotto libero  ",
      qta: 0,
      prezzo: 12.345,
      paziente: "  Mario  ",
      tipoTest: " PRICK ",
      ml: " 2 ",
      codice: " C ",
      formulazione: " F ",
      posologia: " P ",
      numero: " N ",
      allergeni,
    }))).toEqual({
      prodotto_id: "",
      prodotto_nome: "Prodotto libero",
      qta: 0,
      prezzo: 1235,
      paziente: "Mario",
      tipo_test: "PRICK",
      ml: "2",
      codice_laboratorio: "C",
      formulazione: "F",
      posologia: "P",
      numero: "N",
      allergeni,
    });
  });

  it("non persiste il nome duplicato per un prodotto di catalogo", () => {
    expect(campiPersistenzaRigaForm(riga({
      prodottoId: "catalogo-1",
      prodottoNome: "Nome risolto",
      prezzo: "",
    }))).toMatchObject({ prodotto_id: "catalogo-1", prodotto_nome: "", prezzo: 0 });
  });

  it("azzera tutti i prezzi quando l'ordine diventa omaggio", () => {
    const righe = azzeraPrezziRigheForm([
      riga({ qta: 2, prezzo: 12.5 }),
      riga({ qta: 1, prezzo: "" }),
    ]);

    expect(righe.map((voce) => voce.prezzo)).toEqual([0, 0]);
    expect(totaleRigheForm(righe)).toBe(0);
  });

  it("riduce una quantità indivisibile senza perdere centesimi", () => {
    const ridotte = riduciRigheForm([riga({ id: "r1", qta: 3, prezzo: 1 })], 250);

    expect(ridotte.map(({ qta, prezzo }) => ({ qta, prezzo }))).toEqual([
      { qta: 1, prezzo: 0.84 },
      { qta: 2, prezzo: 0.83 },
    ]);
    expect(ridotte[0].id).toBe("r1");
    expect(ridotte[1].id).toBeUndefined();
    expect(totaleRigheForm(ridotte)).toBe(250);
  });

  it("alloca un aumento sull'ultima riga prodotto senza toccare righe vuote", () => {
    const prima = riga({ key: "prima", prezzo: 1 });
    const ultima = riga({ key: "ultima", prezzo: 2 });
    const vuota = riga({ key: "vuota", prodottoNome: "", prodottoId: "", prezzo: "" });

    const adeguate = adeguaRigheFormATotale([prima, ultima, vuota], 450);

    expect(adeguate.map((voce) => voce.prezzo)).toEqual([1, 3.5, ""]);
    expect(totaleRigheForm(adeguate)).toBe(450);
  });

  it("ricostruisce una riga privilegiando il nome del catalogo", () => {
    const record = {
      id: "r1",
      revision: "rev-r1",
      entity: "riga_ordine",
      deleted: false,
      data: { prodotto_id: "p1", prodotto_nome: "Storico", qta: 2, prezzo: 1234, allergeni: ["A"] },
    } as RecordDto;
    const prodotto = {
      id: "p1",
      revision: "rev-p1",
      entity: "prodotto",
      deleted: false,
      data: { nome: "Catalogo" },
    } as RecordDto;

    expect(righeOrdineDaRecord([record], [prodotto])[0]).toMatchObject({
      id: "r1",
      prodottoId: "p1",
      prodottoNome: "Catalogo",
      qta: 2,
      prezzo: 12.34,
      allergeni: ["A"],
    });
  });

  it("crea la riga diagnostica predefinita quando non esistono record", () => {
    expect(righeOrdineDaRecord([], [], true)[0].tipoTest).toBe("PRICK TEST");
  });

  it("fonde sulle righe i campi remoti diversi da quelli modificati localmente", () => {
    const base = rigaSalvata("r1", 10, "Mario");
    const locale = { ...base, prezzo: 12 };
    const remota = { ...base, paziente: "Luigi" };
    const merge = mergeRigheOrdineRealtime([base], [locale], [remota]);

    expect(merge.righe[0]).toMatchObject({ prezzo: 12, paziente: "Luigi" });
  });

  it("mantiene il campo locale anche se lo stesso campo è cambiato altrove", () => {
    const base = rigaSalvata("r1", 10);
    const merge = mergeRigheOrdineRealtime(
      [base],
      [{ ...base, prezzo: 12 }],
      [{ ...base, prezzo: 13 }]
    );
    expect(merge.righe[0].prezzo).toBe(12);
  });

  it("non ricrea una riga eliminata localmente quando arriva un refresh", () => {
    const base = rigaSalvata("r1", 10);
    expect(mergeRigheOrdineRealtime([base], [], [base]).righe).toEqual([]);
  });

  it("mantiene l'eliminazione locale anche se la riga è stata modificata altrove", () => {
    const base = rigaSalvata("r1", 10);
    const merge = mergeRigheOrdineRealtime([base], [], [{ ...base, prezzo: 11 }]);
    expect(merge.righe).toEqual([]);
  });
});
