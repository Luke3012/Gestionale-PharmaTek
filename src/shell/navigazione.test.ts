import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  ordine: [] as string[],
  eventiEmessi: [] as string[],
  main: {
    label: "main",
    show: vi.fn(async () => { mocks.ordine.push("show"); }),
    unminimize: vi.fn(async () => { mocks.ordine.push("unminimize"); }),
    setFocus: vi.fn(async () => { mocks.ordine.push("focus"); }),
  },
}));

vi.mock("../lib/tauri", () => ({ inTauri: true }));

vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: vi.fn(async () => [mocks.main]),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (nome: string, cb: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(nome, cb);
    return () => mocks.listeners.delete(nome);
  }),
  emitTo: vi.fn(async (_label: string, nome: string, payload: unknown) => {
    mocks.ordine.push("emit");
    mocks.listeners.get(nome)?.({ payload });
  }),
  emit: vi.fn(async (nome: string, payload?: unknown) => {
    mocks.eventiEmessi.push(nome);
    mocks.listeners.get(nome)?.({ payload });
  }),
}));

import { ascoltaNavigazione, vaiAllaPrincipale } from "./navigazione";

describe("consegna navigazione alla main", () => {
  beforeEach(() => {
    mocks.listeners.clear();
    mocks.ordine.length = 0;
    mocks.eventiEmessi.length = 0;
    vi.clearAllMocks();
  });

  it("risveglia la main, consegna il link e attende la conferma", async () => {
    const ricevuto = vi.fn();
    const off = await ascoltaNavigazione(ricevuto);

    await vaiAllaPrincipale({ path: "/contabilita", tab: "pagamenti" });

    expect(mocks.ordine).toEqual(["show", "unminimize", "focus", "emit"]);
    expect(ricevuto).toHaveBeenCalledWith({ path: "/contabilita", tab: "pagamenti" });
    expect([...mocks.listeners.keys()]).toEqual(["pt:naviga"]);
    off();
  });

  it("un listener in cleanup non conferma una navigazione non gestita", async () => {
    const off = await ascoltaNavigazione(() => false);

    mocks.listeners.get("pt:naviga")?.({
      payload: { link: { path: "/giornaliero" }, ack: "pt:naviga-ack:test" },
    });
    await Promise.resolve();

    expect(mocks.eventiEmessi).not.toContain("pt:naviga-ack:test");
    off();
  });
});
