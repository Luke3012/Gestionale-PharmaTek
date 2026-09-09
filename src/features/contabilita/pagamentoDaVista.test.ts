import { describe, expect, it } from "vitest";
import type { PagamentoVista, RecordDto } from "../../lib/tauri";
import { pagamentoDaVista } from "./pagamentoDaVista";

const VISTA = {
  id: "pag-1",
  revision: "rev-vista",
  ordineId: "ordine-1",
  tipo: "saldo",
  importo: 12_345,
  saldato: false,
  scadenza: "2026-09-30",
  contoId: "conto-1",
  contoNome: "Banca",
  contoTipo: "banca",
  data: "",
  verificato: false,
  contoAccreditoNome: "",
} as PagamentoVista;

describe("pagamento dalla vista Crediti", () => {
  it("unisce i campi visibili con quelli tecnici del record", () => {
    const record = {
      revision: "rev-record",
      data: {
        distinta_id: "distinta-1",
        note: "Nota",
        scad_da_spedizione: true,
        scad_rel_giorni: 14,
      },
    } as Pick<RecordDto, "revision" | "data">;

    expect(pagamentoDaVista(VISTA, record)).toMatchObject({
      id: "pag-1",
      revision: "rev-record",
      tipo: "saldo",
      importo: 12_345,
      distintaId: "distinta-1",
      note: "Nota",
      scadDaSpedizione: true,
      scadRelGiorni: 14,
    });
  });

  it("mantiene revisione e fallback precedenti senza record", () => {
    expect(pagamentoDaVista(VISTA)).toMatchObject({
      revision: "rev-vista",
      distintaId: "",
      note: "",
      scadDaSpedizione: false,
      scadRelGiorni: 0,
    });
  });
});
