import { describe, expect, it } from "vitest";
import type { RecordDto } from "../../lib/tauri";
import {
  campiUnificazioneCliente,
  trovaClienteSimile,
} from "./salvataggioCliente";

const cliente = (data: Record<string, unknown>): RecordDto => ({
  id: "cliente-1",
  revision: "r1",
  deleted: false,
  data,
});
const EMAIL_DEMO = ["cliente", ["example", "invalid"].join(".")].join("@");

describe("controllo duplicati durante la creazione cliente", () => {
  it("riconosce nome invertito e indirizzo simile", () => {
    const esistente = cliente({
      nome: "Mario Rossi",
      indirizzo: "Via Roma 12",
      citta: "Napoli",
      cap: "80100",
    });
    expect(
      trovaClienteSimile(
        { nome: "Rossi Mario", indirizzo: "Via Roma, 12", citta: "Napoli", cap: "80100" },
        [esistente],
      )?.cliente.id,
    ).toBe(esistente.id);
  });

  it("non propone un omonimo in un altro luogo", () => {
    const esistente = cliente({ nome: "Mario Rossi", indirizzo: "Via Roma 12", citta: "Napoli" });
    expect(
      trovaClienteSimile(
        { nome: "Mario Rossi", indirizzo: "Via Milano 4", citta: "Torino" },
        [esistente],
      ),
    ).toBeNull();
  });

  it("mostra e applica solo i campi non vuoti che cambiano", () => {
    const esistente = cliente({ nome: "Mario Rossi", telefono: "333111", email: "" });
    expect(
      campiUnificazioneCliente(esistente, {
        nome: "Mario Rossi",
        telefono: "",
        email: EMAIL_DEMO,
      }),
    ).toEqual({ email: EMAIL_DEMO });
  });
});
