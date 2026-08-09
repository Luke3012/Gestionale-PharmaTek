import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ordine: [] as string[],
  check: vi.fn(),
  downloadAndInstall: vi.fn(),
  preparaVisibile: vi.fn(),
  preparaMinimizzato: vi.fn(),
  annulla: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: vi.fn(async () => {}),
  relaunch: mocks.relaunch,
}));

vi.mock("./lib/tauri", () => ({
  inTauri: true,
  api: {
    preparaRiavvioVisibile: mocks.preparaVisibile,
    preparaRiavvioMinimizzato: mocks.preparaMinimizzato,
    annullaRiavvioPreparato: mocks.annulla,
  },
}));

import { cercaAggiornamenti, installaAggiornamentoBackgroundMinimizzato } from "./updater";

describe("aggiornamento manuale dalla finestra Info", () => {
  beforeEach(() => {
    mocks.ordine.length = 0;
    mocks.check.mockReset();
    mocks.downloadAndInstall.mockReset();
    mocks.preparaVisibile.mockReset();
    mocks.preparaMinimizzato.mockReset();
    mocks.annulla.mockReset();
    mocks.relaunch.mockReset();
    vi.stubGlobal("localStorage", memoriaLocale());

    mocks.check.mockResolvedValue({
      version: "0.7.0",
      downloadAndInstall: mocks.downloadAndInstall,
    });
    mocks.preparaVisibile.mockImplementation(async () => { mocks.ordine.push("visibile"); });
    mocks.preparaMinimizzato.mockImplementation(async () => { mocks.ordine.push("minimizzato"); });
    mocks.downloadAndInstall.mockImplementation(async () => { mocks.ordine.push("installer"); });
    mocks.relaunch.mockImplementation(async () => { mocks.ordine.push("relaunch"); });
    mocks.annulla.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prepara la main visibile prima di consegnare il controllo all'installer", async () => {
    await cercaAggiornamenti();

    expect(mocks.ordine).toEqual(["visibile", "installer", "relaunch"]);
    expect(mocks.annulla).not.toHaveBeenCalled();
  });

  it("annulla l'intenzione visibile se il download fallisce", async () => {
    mocks.downloadAndInstall.mockRejectedValue(new Error("rete non disponibile"));

    await cercaAggiornamenti();

    expect(mocks.preparaVisibile).toHaveBeenCalledOnce();
    expect(mocks.annulla).toHaveBeenCalledOnce();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("non avvia un secondo controllo manuale mentre un update e gia in corso", async () => {
    localStorage.setItem("pt.aggiornando", "1");

    await cercaAggiornamenti();

    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.preparaVisibile).not.toHaveBeenCalled();
  });

  it("rilascia il blocco quando non esiste un aggiornamento", async () => {
    mocks.check.mockResolvedValue(null);

    await cercaAggiornamenti();

    expect(localStorage.getItem("pt.aggiornando")).toBeNull();
  });

  it("rivalida l'inattivita dopo il check background e prima dell'installer", async () => {
    const condizioniAncoraValide = vi.fn(async () => false);

    const risultato = await installaAggiornamentoBackgroundMinimizzato(
      condizioniAncoraValide
    );

    expect(condizioniAncoraValide).toHaveBeenCalledOnce();
    expect(mocks.preparaMinimizzato).not.toHaveBeenCalled();
    expect(mocks.downloadAndInstall).not.toHaveBeenCalled();
    expect(localStorage.getItem("pt.aggiornando")).toBeNull();
    expect(risultato).toBeNull();
  });

  it("prepara il riavvio background solo dopo la rivalidazione finale", async () => {
    const condizioniAncoraValide = vi.fn(async () => {
      mocks.ordine.push("rivalida");
      return true;
    });

    await installaAggiornamentoBackgroundMinimizzato(condizioniAncoraValide);

    expect(mocks.ordine).toEqual(["rivalida", "minimizzato", "installer", "relaunch"]);
  });
});

function memoriaLocale(): Storage {
  const valori = new Map<string, string>();
  return {
    get length() { return valori.size; },
    clear: () => valori.clear(),
    getItem: (chiave) => valori.get(chiave) ?? null,
    key: (indice) => [...valori.keys()][indice] ?? null,
    removeItem: (chiave) => { valori.delete(chiave); },
    setItem: (chiave, valore) => { valori.set(chiave, String(valore)); },
  };
}
