import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  recordCreateId: vi.fn(),
  recordsList: vi.fn(),
  whoami: vi.fn(),
  forceSync: vi.fn(),
  syncOverview: vi.fn(),
  emitTo: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  api: {
    recordCreateId: mock.recordCreateId,
    recordsList: mock.recordsList,
    whoami: mock.whoami,
    forceSync: mock.forceSync,
    syncOverview: mock.syncOverview,
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: mock.emitTo,
}));

import {
  attendiScrittureStatoNotifiche,
  caricaStati,
  nascondiPopupDaCampanella,
  riattivaNotifichePerUtenti,
  scarta,
  segnaLetta,
} from "./notifiche";

describe("persistenza stato notifiche", () => {
  beforeEach(async () => {
    await attendiScrittureStatoNotifiche();
    mock.recordCreateId.mockReset();
    mock.recordsList.mockReset();
    mock.whoami.mockReset();
    mock.forceSync.mockReset().mockResolvedValue(0);
    mock.syncOverview.mockReset().mockResolvedValue({ devices: [] });
    mock.emitTo.mockReset().mockResolvedValue(undefined);
    mock.recordCreateId.mockResolvedValue({});
    mock.recordsList.mockResolvedValue([]);
  });

  it("non riattiva notifiche per utenti rimasti senza postazioni attive", async () => {
    expect(await riattivaNotifichePerUtenti(["promemoria:1"], ["ritirato"])).toBe(0);
    expect(mock.recordCreateId).not.toHaveBeenCalled();

    mock.syncOverview.mockResolvedValue({ devices: [{ userId: "attivo" }] });
    expect(await riattivaNotifichePerUtenti(["promemoria:1"], ["ritirato", "attivo"])).toBe(1);
    expect(mock.recordCreateId).toHaveBeenCalledOnce();
  });

  it("salva lo scarto con chiave deterministica e utente esplicito", async () => {
    await scarta(
      "msg:01ABC",
      {
        userId: "utente-1",
        nome: "Anna",
        deviceId: "pc-1",
        deviceNome: "PC 1",
        dataDir: "",
        avatarTipo: "iniziali",
        avatarValore: "",
      },
      false
    );

    expect(mock.recordCreateId).toHaveBeenCalledWith(
      "notifica_letta",
      "stato-notifica-v2|utente-1|msg:01ABC",
      expect.objectContaining({
        notifica_id: "msg:01ABC",
        user_id: "utente-1",
        letta: true,
        scartata: true,
      })
    );
    expect(mock.whoami).not.toHaveBeenCalled();
  });

  it("recupera l'identità corrente se una finestra non l'ha ricevuta", async () => {
    mock.whoami.mockResolvedValue({ userId: "utente-corrente" });

    await segnaLetta("msg:02DEF", undefined, false);

    expect(mock.recordCreateId).toHaveBeenCalledWith(
      "notifica_letta",
      "stato-notifica-v2|utente-corrente|msg:02DEF",
      expect.objectContaining({ user_id: "utente-corrente", letta: true })
    );
  });

  it("la chiusura può attendere una scrittura ancora in volo", async () => {
    let completa!: (value: unknown) => void;
    mock.recordCreateId.mockImplementationOnce(
      () => new Promise((resolve) => {
        completa = resolve;
      })
    );

    const scrittura = scarta(
      "msg:03GHI",
      {
        userId: "utente-1",
        nome: "Anna",
        deviceId: "pc-1",
        deviceNome: "PC 1",
        dataDir: "",
        avatarTipo: "iniziali",
        avatarValore: "",
      },
      false
    );
    let attesaConclusa = false;
    const attesa = attendiScrittureStatoNotifiche().then(() => {
      attesaConclusa = true;
    });

    await Promise.resolve();
    expect(attesaConclusa).toBe(false);

    completa({});
    await scrittura;
    await attesa;
    expect(attesaConclusa).toBe(true);
  });

  it("aprire la campanella pulisce solo l'overlay locale", async () => {
    await nascondiPopupDaCampanella();

    expect(mock.emitTo).toHaveBeenCalledWith("overlay", "pt:overlay-pulisci");
    expect(mock.recordCreateId).not.toHaveBeenCalled();
  });

  it("durante la migrazione usa soltanto lo stato più recente", async () => {
    const vecchio = {
      id: "letta|utente-1|msg:migrazione",
      deleted: false,
      data: {
        user_id: "utente-1",
        notifica_id: "msg:migrazione",
        letta: true,
        scartata: true,
        ts: 100,
      },
    };
    mock.recordsList.mockResolvedValue([
      vecchio,
      {
        id: "stato-notifica-v2|utente-1|msg:migrazione",
        deleted: false,
        data: {
          user_id: "utente-1",
          notifica_id: "msg:migrazione",
          letta: false,
          scartata: false,
          ts: 200,
        },
      },
    ]);

    const riattivato = await caricaStati("utente-1");
    expect(riattivato.viste.has("msg:migrazione")).toBe(false);
    expect(riattivato.scartate.has("msg:migrazione")).toBe(false);

    mock.recordsList.mockResolvedValue([
      vecchio,
      {
        id: "stato-notifica-v2|utente-1|msg:migrazione",
        deleted: false,
        data: {
          user_id: "utente-1",
          notifica_id: "msg:migrazione",
          letta: true,
          scartata: true,
          ts: 300,
        },
      },
    ]);
    const scartato = await caricaStati("utente-1");
    expect(scartato.viste.has("msg:migrazione")).toBe(true);
    expect(scartato.scartate.has("msg:migrazione")).toBe(true);
  });
});
