import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity, SyncOverview, UserDto } from "../../lib/tauri";

const mock = vi.hoisted(() => ({
  getUsers: vi.fn(),
  forceSync: vi.fn(),
  syncOverview: vi.fn(),
  whoami: vi.fn(),
  recordCreateId: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  api: {
    getUsers: mock.getUsers,
    forceSync: mock.forceSync,
    syncOverview: mock.syncOverview,
    whoami: mock.whoami,
    recordCreateId: mock.recordCreateId,
  },
}));

import { filtraDestinatariMessaggi, inviaMessaggio } from "./messaggi";

const utenti: UserDto[] = [
  { id: "corrente", nome: "Io", avatarTipo: "iniziali", avatarValore: "" },
  { id: "attivo", nome: "PC attivo", avatarTipo: "iniziali", avatarValore: "" },
  { id: "orfano", nome: "PC che non c'è", avatarTipo: "iniziali", avatarValore: "" },
];

const overview: SyncOverview = {
  devices: [
    {
      deviceId: "device-corrente",
      nome: "Questo PC",
      userId: "corrente",
      userNome: "Io",
      avatarTipo: "iniziali",
      avatarValore: "",
      lastMs: 1,
      isCurrent: true,
    },
    {
      deviceId: "device-attivo",
      nome: "Altro PC",
      userId: "attivo",
      userNome: "PC attivo",
      avatarTipo: "iniziali",
      avatarValore: "",
      lastMs: 1,
      isCurrent: false,
    },
  ],
  lastEventMs: 1,
  dataDir: "C:/dati",
};

describe("destinatari messaggi", () => {
  beforeEach(() => {
    mock.getUsers.mockReset().mockResolvedValue(utenti);
    mock.forceSync.mockReset().mockResolvedValue(0);
    mock.syncOverview.mockReset().mockResolvedValue(overview);
    mock.whoami.mockReset();
    mock.recordCreateId.mockReset().mockResolvedValue({});
  });

  it("usa soltanto gli utenti presenti nel pannello sincronizzazione", () => {
    expect(filtraDestinatariMessaggi(utenti, overview, "corrente").map((u) => u.id)).toEqual([
      "attivo",
    ]);
  });

  it("rivalida il destinatario al momento dell'invio", async () => {
    const identity: Identity = {
      userId: "corrente",
      nome: "Io",
      deviceId: "device-corrente",
      deviceNome: "Questo PC",
      dataDir: "C:/dati",
      avatarTipo: "iniziali",
      avatarValore: "",
    };

    await expect(
      inviaMessaggio(
        { destinatario: "orfano", destinatarioNome: "PC ritirato", testo: "Ciao" },
        identity
      )
    ).rejects.toThrow("non ha più una postazione attiva");
    expect(mock.recordCreateId).not.toHaveBeenCalled();

    await inviaMessaggio(
      { destinatario: "attivo", destinatarioNome: "PC attivo", testo: "Ciao" },
      identity
    );
    expect(mock.recordCreateId).toHaveBeenCalledOnce();
  });
});
