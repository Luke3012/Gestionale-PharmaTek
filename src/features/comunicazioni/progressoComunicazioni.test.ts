import { describe, expect, it } from "vitest";
import type { Comunicazione, StatoComunicazione } from "../../lib/tauri";
import {
  contaMessaggiLogici,
  riepilogaProgressoComunicazioni,
} from "./progressoComunicazioni";

const comunicazione = (stato: StatoComunicazione): Comunicazione =>
  ({ id: crypto.randomUUID(), stato } as Comunicazione);

describe("progresso notifiche comunicazioni", () => {
  it("avanza soltanto per le comunicazioni concluse", () => {
    const riepilogo = riepilogaProgressoComunicazioni([
      comunicazione("consegna_verificata"),
      comunicazione("in_invio"),
      comunicazione("in_coda"),
    ]);
    expect(riepilogo.progress).toBe(33);
    expect(riepilogo.terminale).toBe(false);
  });

  it("mostra la mail conclusa al 50% mentre WhatsApp aspetta il PC", () => {
    const riepilogo = riepilogaProgressoComunicazioni([
      { ...comunicazione("invio_azionato"), canale: "email" },
      { ...comunicazione("in_coda"), canale: "whatsapp", motivoAttesa: "pc_occupato" },
    ]);
    expect(riepilogo).toMatchObject({ progress: 50, completate: 1, inviate: 1, terminale: false });
    expect(riepilogo.messaggio).toContain("PC è libero");
  });

  it("distingue il retry tecnico dai successi e dai fallimenti", () => {
    const riepilogo = riepilogaProgressoComunicazioni([
      comunicazione("fallito"),
      { ...comunicazione("in_coda"), motivoAttesa: "errore_tecnico", prossimoRetryMs: Date.now() + 2000 },
    ]);
    expect(riepilogo.progress).toBe(50);
    expect(riepilogo.messaggio).toContain("1 fallita");
    expect(riepilogo.messaggio).toContain("tentativo automatico");
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
