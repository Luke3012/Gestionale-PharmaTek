import { describe, expect, it } from "vitest";
import type { RecordDto } from "../../lib/tauri";
import {
  preparaCampiAnagraficaCompleti,
  preparaPatchAnagrafica,
  valoriAnagrafica,
} from "./modelloAnagrafica";
import { REGISTRI } from "./registri";

const registroCliente = REGISTRI.find(
  (registro) => registro.entity === "cliente",
)!;
const registroMedico = REGISTRI.find((registro) => registro.entity === "medico")!;

function cliente(data: Record<string, unknown>): RecordDto {
  return {
    id: "cliente-1",
    revision: "rev-1",
    data,
    deleted: false,
  };
}

describe("editor anagrafica condiviso", () => {
  it("salva a patch senza riscrivere i campi non modificati", () => {
    const record = cliente({
      nome: "Mario Rossi",
      telefono: "328 111 2233",
      email: "",
    });
    const valori = valoriAnagrafica(registroCliente, record);
    valori.telefono = "328 999 8877";

    expect(
      preparaPatchAnagrafica(registroCliente, valori, record),
    ).toEqual({
      telefono: "328 999 8877",
    });
  });

  it("rappresenta esplicitamente lo svuotamento di un campo", () => {
    const record = cliente({
      nome: "Mario Rossi",
      email: "",
    });
    const valori = valoriAnagrafica(registroCliente, record);
    valori.email = "";

    expect(
      preparaPatchAnagrafica(registroCliente, valori, record),
    ).toEqual({
      email: "",
    });
  });

  it("prepara i campi completi dell'editor rapido con le conversioni storiche", () => {
    const valori = valoriAnagrafica(registroMedico);
    valori.nome = "  Dott. Rossi  ";
    valori.prezzo_immuno_default = "";
    valori.rate_saldo_default = "";
    valori.cf = "abc12345678";

    expect(preparaCampiAnagraficaCompleti(registroMedico, valori)).toMatchObject({
      nome: "Dott. Rossi",
      prezzo_immuno_default: 0,
      rate_saldo_default: undefined,
      cf: "abc12345678",
      email: "",
    });
  });
});
