import { describe, expect, it } from "vitest";
import type { ConfigurazioneDocumenti, RecordDto } from "../../lib/tauri";
import { preventivoDaBozza, type BozzaPreventivoDaZero } from "./bozzaPreventivo";

const configurazione: ConfigurazioneDocumenti = {
  denominazione: "PharmaTek",
  indirizzo: "",
  localita: "",
  telefono: "",
  email: "",
  sito: "",
  validitaDefaultGiorni: 30,
  condizioniDefault: "",
  revision: "cfg-1",
  esiste: true,
  aggiornataMs: 0,
  versioneModello: 7,
};

function record(id: string, data: Record<string, unknown>): RecordDto {
  return { id, data, revision: `${id}-1`, deleted: false };
}

describe("preventivoDaBozza", () => {
  it("crea lo snapshot locale convertendo prezzi e riferimenti", () => {
    const bozza: BozzaPreventivoDaZero = {
      data: "2026-08-18",
      linea: "Immunoterapia",
      clienteId: "cliente-1",
      medicoId: "medico-1",
      agenteId: "agente-1",
      note: "Nota bozza",
      righe: [{
        key: "riga-1",
        prodottoId: "prodotto-1",
        prodottoNome: "Prodotto",
        qta: 2,
        prezzo: 12.34,
        paziente: "",
        tipoTest: "",
        ml: "",
        codice: "",
        formulazione: "",
        posologia: "",
        numero: "",
        allergeni: ["A"],
      }],
    };

    const preventivo = preventivoDaBozza(
      bozza,
      configurazione,
      [record("cliente-1", {
        nome: "Cliente",
        indirizzo: "Via Roma 1",
        citta: "Napoli",
        cap: "80100",
        prov: "NA",
        cf: "ABC",
        telefono: "081",
        email: "demo@example.invalid",
      })],
      [record("medico-1", { nome: "Medico" })],
      [record("agente-1", { nome: "Agente" })],
    );

    expect(preventivo).toMatchObject({
      esiste: false,
      ordineData: "2026-08-18",
      clienteNome: "Cliente",
      spedizioneNome: "Cliente",
      medicoNome: "Medico",
      agenteNome: "Agente",
      validitaGiorni: 30,
      versioneModello: 7,
      totale: 2468,
      note: "Nota bozza",
    });
    expect(preventivo.righe).toEqual([
      expect.objectContaining({
        id: "riga-1",
        prezzo: 1234,
        qta: 2,
        categoria: "Immunoterapia",
        allergeni: ["A"],
      }),
    ]);
  });
});
