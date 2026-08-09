import { describe, expect, it } from "vitest";
import type { RecordDto } from "../../lib/tauri";
import { ultimoMedicoClienteValido } from "./medicoCliente";

function record(id: string, data: Record<string, unknown> = {}): RecordDto {
  return {
    id,
    data,
    revision: "1",
    deleted: false,
  };
}

describe("ultimoMedicoClienteValido", () => {
  it("riutilizza l'ultimo medico del cliente quando è ancora disponibile", () => {
    expect(
      ultimoMedicoClienteValido(
        "cliente-1",
        [record("cliente-1", { ultimo_medico_id: "medico-1" })],
        [record("medico-1")],
      ),
    ).toBe("medico-1");
  });

  it("non propone riferimenti mancanti o eliminati", () => {
    expect(
      ultimoMedicoClienteValido(
        "cliente-1",
        [record("cliente-1", { ultimo_medico_id: "medico-eliminato" })],
        [record("medico-1")],
      ),
    ).toBe("");
  });
});
