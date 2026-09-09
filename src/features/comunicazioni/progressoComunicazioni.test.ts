import { describe, expect, it } from "vitest";
import type { Comunicazione, StatoComunicazione } from "../../lib/tauri";
import {
  contaMessaggiLogici,
  riepilogaProgressoComunicazioni,
} from "./progressoComunicazioni";

const comunicazione = (stato: StatoComunicazione): Comunicazione =>
  ({ id: crypto.randomUUID(), stato } as Comunicazione);

describe("progresso notifiche comunicazioni", () => {
  it("considera a metà la comunicazione attualmente in invio", () => {
    const riepilogo = riepilogaProgressoComunicazioni([
      comunicazione("consegna_verificata"),
      comunicazione("in_invio"),
      comunicazione("in_coda"),
    ]);
    expect(riepilogo.progress).toBe(50);
    expect(riepilogo.terminale).toBe(false);
  });

  it("riassume gli esiti terminali", () => {
    const riepilogo = riepilogaProgressoComunicazioni([
      comunicazione("invio_azionato"),
      comunicazione("fallito"),
    ]);
    expect(riepilogo).toMatchObject({
      progress: 100,
      terminale: true,
      inviate: 1,
      fallite: 1,
    });
  });

  it("considera e-mail e WhatsApp dello stesso destinatario un solo messaggio", () => {
    const stessoCliente = {
      destinatarioEntita: "cliente",
      destinatarioId: "cliente-1",
      corpo: "Testo uguale",
    };
    expect(
      contaMessaggiLogici([
        { ...comunicazione("invio_azionato"), ...stessoCliente, canale: "email" },
        { ...comunicazione("invio_azionato"), ...stessoCliente, canale: "whatsapp" },
      ]),
    ).toBe(1);
  });

  it("conta separatamente i destinatari di una vera campagna", () => {
    expect(
      contaMessaggiLogici([
        {
          ...comunicazione("invio_azionato"),
          destinatarioEntita: "cliente",
          destinatarioId: "cliente-1",
        },
        {
          ...comunicazione("invio_azionato"),
          destinatarioEntita: "cliente",
          destinatarioId: "cliente-2",
        },
      ]),
    ).toBe(2);
  });
});
