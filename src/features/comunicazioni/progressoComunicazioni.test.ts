import { describe, expect, it } from "vitest";
import type { Comunicazione, StatoComunicazione } from "../../lib/tauri";
import { riepilogaProgressoComunicazioni } from "./progressoComunicazioni";

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
});
