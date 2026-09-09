import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const stato = vi.hoisted(() => ({
  esistente: null as FinestraFinta | null,
  create: [] as FinestraFinta[],
}));

class FinestraFinta {
  static async getByLabel() {
    return stato.esistente;
  }

  readonly chiamate: string[] = [];

  constructor(
    readonly label: string,
    readonly options?: Record<string, unknown>,
  ) {
    stato.create.push(this);
  }

  async show() { this.chiamate.push("show"); }
  async unminimize() { this.chiamate.push("unminimize"); }
  async setFocus() { this.chiamate.push("focus"); }
  async once(evento: string, callback: () => void) {
    if (evento === "tauri://created") queueMicrotask(callback);
    return () => {};
  }
}

vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: FinestraFinta }));

describe("apertura finestra Tauri", () => {
  beforeAll(() => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("riattiva una finestra esistente senza ricrearla", async () => {
    const { apriFinestraTauri } = await import("./finestreTauri");
    stato.esistente = new FinestraFinta("ordine-1");
    stato.create.length = 0;

    await expect(apriFinestraTauri({
      label: "ordine-1",
      query: "ordine=1",
      title: "Ordine 1",
      chiaveGeometria: "ordine",
      geometria: { width: 900, height: 620, minWidth: 760, minHeight: 520 },
    })).resolves.toBe(true);

    expect(stato.create).toHaveLength(0);
    expect(stato.esistente.chiamate).toEqual(["show", "unminimize", "focus"]);
  });

  it("consegna l'aggiornamento prima di riattivare una finestra esistente", async () => {
    const { apriFinestraTauri } = await import("./finestreTauri");
    stato.esistente = new FinestraFinta("comunicazione-batch");
    stato.create.length = 0;
    const consegna = vi.fn(async () => {
      expect(stato.esistente?.chiamate).toEqual([]);
    });

    await expect(apriFinestraTauri({
      label: "comunicazione-batch",
      query: "campagnaComunicazioni=1",
      title: "Nuova comunicazione",
      chiaveGeometria: "comunicazione-batch",
      geometria: { width: 760, height: 640, minWidth: 620, minHeight: 480 },
      primaDiRiutilizzare: consegna,
    })).resolves.toBe(true);

    expect(consegna).toHaveBeenCalledOnce();
    expect(stato.esistente.chiamate).toEqual(["show", "unminimize", "focus"]);
  });

  it("mantiene distinta la creazione nascosta da quella mostrata subito", async () => {
    const { apriFinestraTauri } = await import("./finestreTauri");
    stato.esistente = null;
    stato.create.length = 0;
    const base = {
      query: "notifiche=1",
      title: "Notifiche",
      chiaveGeometria: "notifiche",
      geometria: { width: 420, height: 560, minWidth: 360, minHeight: 420 },
    };

    await expect(apriFinestraTauri({ ...base, label: "nascosta" })).resolves.toBe(true);
    await expect(apriFinestraTauri({
      ...base,
      label: "visibile",
      mostraDopoCreazione: true,
    })).resolves.toBe(true);

    expect(stato.create[0].chiamate).toEqual([]);
    expect(stato.create[1].chiamate).toEqual(["show", "unminimize", "focus"]);
    expect(stato.create[1].options).toMatchObject({
      url: "index.html?notifiche=1",
      visible: false,
      minWidth: 360,
      minHeight: 420,
    });
  });

  it("registra la conferma prima dell'invio e scollega il listener", async () => {
    const { inviaEventoConConferma } = await import("./finestreTauri");
    const ordine: string[] = [];
    let conferma: (() => void) | undefined;

    await inviaEventoConConferma({
      ack: "ack-test",
      ascolta: async (_evento, callback) => {
        ordine.push("listen");
        conferma = callback;
        return () => ordine.push("off");
      },
      invia: async () => {
        ordine.push("emit");
        conferma?.();
      },
      timeoutMs: 100,
      messaggioTimeout: "timeout",
    });

    expect(ordine).toEqual(["listen", "emit", "off"]);
  });

  it("propaga il timeout specifico e scollega comunque il listener", async () => {
    const { inviaEventoConConferma } = await import("./finestreTauri");
    let scollegato = false;

    await expect(inviaEventoConConferma({
      ack: "ack-timeout",
      ascolta: async () => () => { scollegato = true; },
      invia: async () => {},
      timeoutMs: 1,
      messaggioTimeout: "conferma assente",
    })).rejects.toThrow("conferma assente");
    expect(scollegato).toBe(true);
  });
});
