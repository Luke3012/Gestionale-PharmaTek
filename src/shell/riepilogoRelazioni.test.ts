import { describe, expect, it } from "vitest";
import type { RecordDto } from "../lib/tauri";
import { creaRelazioniRiepilogo } from "./riepilogoRelazioni";

function record(id: string, data: Record<string, unknown>, deleted = false): RecordDto {
  return { id, revision: "1-0-test", data, deleted };
}

describe("relazioni del riepilogo anagrafica", () => {
  it("mostra l'agente configurato sul medico", () => {
    const medico = record("M1", { nome: "Dott. Verdi", agente_id: "A1" });
    const agente = record("A1", { nome: "Anna Bianchi" });

    expect(creaRelazioniRiepilogo("medico", medico, null, agente)).toEqual([
      { label: "Agente di riferimento", tipo: "agente", id: "A1", nome: "Anna Bianchi" },
    ]);
  });

  it("mostra medico e relativo agente per il cliente", () => {
    const cliente = record("C1", { nome: "Mario Rossi", ultimo_medico_id: "M1" });
    const medico = record("M1", { nome: "Dott. Verdi", agente_id: "A1" });
    const agente = record("A1", { nome: "Anna Bianchi" });

    expect(creaRelazioniRiepilogo("cliente", cliente, medico, agente)).toEqual([
      { label: "Medico di riferimento", tipo: "medico", id: "M1", nome: "Dott. Verdi" },
      { label: "Agente di riferimento", tipo: "agente", id: "A1", nome: "Anna Bianchi" },
    ]);
  });

  it("non espone relazioni mancanti, incoerenti o eliminate", () => {
    const cliente = record("C1", { ultimo_medico_id: "M1" });
    const medicoDiverso = record("M2", { agente_id: "A1" });
    const agenteEliminato = record("A1", { nome: "Anna" }, true);

    expect(creaRelazioniRiepilogo("cliente", cliente, medicoDiverso, agenteEliminato)).toEqual([]);
  });
});
