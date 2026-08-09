import { describe, expect, it, vi } from "vitest";
import { installaConRiavvioPreparato } from "./flussoAggiornamento";

describe("installazione con intenzione di riavvio", () => {
  it("prepara la visibilita prima di avviare l'installer", async () => {
    const ordine: string[] = [];

    await installaConRiavvioPreparato({
      preparaRiavvio: async () => { ordine.push("prepara"); },
      installa: async () => { ordine.push("installa"); return "0.7.0"; },
      riavvia: async () => { ordine.push("riavvia"); },
      annullaRiavvio: async () => { ordine.push("annulla"); },
    });

    expect(ordine).toEqual(["prepara", "installa", "riavvia"]);
  });

  it("annulla il marker se download o installazione falliscono", async () => {
    const errore = new Error("download fallito");
    const annulla = vi.fn(async () => {});

    await expect(
      installaConRiavvioPreparato({
        preparaRiavvio: async () => {},
        installa: async () => { throw errore; },
        riavvia: async () => {},
        annullaRiavvio: annulla,
      })
    ).rejects.toBe(errore);
    expect(annulla).toHaveBeenCalledOnce();
  });

  it("non avvia l'installer se non riesce a preparare il riavvio", async () => {
    const installa = vi.fn(async () => "0.7.0");

    await expect(
      installaConRiavvioPreparato({
        preparaRiavvio: async () => { throw new Error("marker non scrivibile"); },
        installa,
        riavvia: async () => {},
        annullaRiavvio: async () => {},
      })
    ).rejects.toThrow("marker non scrivibile");
    expect(installa).not.toHaveBeenCalled();
  });

  it("conserva il marker se l'installazione riesce ma il relaunch fallisce", async () => {
    const annulla = vi.fn(async () => {});

    await expect(
      installaConRiavvioPreparato({
        preparaRiavvio: async () => {},
        installa: async () => "0.7.0",
        riavvia: async () => { throw new Error("relaunch fallito"); },
        annullaRiavvio: annulla,
      })
    ).rejects.toThrow("relaunch fallito");
    expect(annulla).not.toHaveBeenCalled();
  });
});
