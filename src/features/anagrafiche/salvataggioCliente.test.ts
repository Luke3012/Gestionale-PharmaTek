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

  it("esclude categoricamente candidati con Codice Fiscale valido diverso anche se con stesso nome", () => {
    const esistente = cliente({
      nome: "Mario Rossi",
      cf: "RSSMRA80A01F205X",
      indirizzo: "Via Roma 12",
      citta: "Napoli",
    });
    expect(
      trovaClienteSimile(
        {
          nome: "Mario Rossi",
          cf: "RSSMRA85M01H501Z", // CF diverso e valido
          indirizzo: "Via Roma 12",
          citta: "Napoli",
        },
        [esistente],
      ),
    ).toBeNull();
  });

  it("completa i campi vuoti preservando quelli già valorizzati", () => {
    const esistente = cliente({
      nome: "Mario Rossi",
      telefono: "081123456",
      citta: "Napoli",
      email: "",
    });
    const patch = campiUnificazioneCliente(esistente, {
      nome: "Mario Rossi",
      telefono: "081123456",
      citta: "Napoli",
      email: "demo@example.invalid",
      prov: "NA",
    });
    expect(patch).toEqual({
      email: "demo@example.invalid",
      prov: "NA",
    });
  });

  it("sceglie l'indirizzo più completo quando compatibile", () => {
    const esistente = cliente({
      nome: "Mario Rossi",
      indirizzo: "Via Roma 12",
      citta: "Napoli",
    });
    const patch = campiUnificazioneCliente(esistente, {
      nome: "Mario Rossi",
      indirizzo: "Via Roma 12, Scala B, Int. 4",
      citta: "Napoli",
    });
    expect(patch).toEqual({
      indirizzo: "Via Roma 12, Scala B, Int. 4",
    });
  });

  it("aggiorna il codice fiscale se quello esistente è assente o non valido", () => {
    const esistente = cliente({
      nome: "Mario Rossi",
      cf: "",
    });
    const patch = campiUnificazioneCliente(esistente, {
      nome: "Mario Rossi",
      cf: "RSSMRA80A01F205X",
    });
    expect(patch.cf).toBe("RSSMRA80A01F205X");
  });
});
