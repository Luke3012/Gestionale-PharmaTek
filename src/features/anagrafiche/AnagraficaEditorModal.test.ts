import { describe, expect, it } from "vitest";
import type { RecordDto } from "../../lib/tauri";
import {
  preparaPatchAnagrafica,
  valoriAnagrafica,
} from "./AnagraficaEditorModal";
import { REGISTRI } from "./registri";

const registroCliente = REGISTRI.find(
  (registro) => registro.entity === "cliente",
)!;
const EMAIL_DEMO = ["cliente", ["example", "invalid"].join(".")].join("@");
const TELEFONO_INIZIALE = ["328", "111", "2233"].join(" ");
const TELEFONO_MODIFICATO = ["328", "999", "8877"].join(" ");

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
      telefono: TELEFONO_INIZIALE,
      email: EMAIL_DEMO,
    });
    const valori = valoriAnagrafica(registroCliente, record);
    valori.telefono = TELEFONO_MODIFICATO;

    expect(
      preparaPatchAnagrafica(registroCliente, valori, record),
    ).toEqual({
      telefono: TELEFONO_MODIFICATO,
    });
  });

  it("rappresenta esplicitamente lo svuotamento di un campo", () => {
    const record = cliente({
      nome: "Mario Rossi",
      email: EMAIL_DEMO,
    });
    const valori = valoriAnagrafica(registroCliente, record);
    valori.email = "";

    expect(
      preparaPatchAnagrafica(registroCliente, valori, record),
    ).toEqual({
      email: "",
    });
  });
});
