import { describe, expect, it } from "vitest";
import {
  applicaToastPrincipale,
  durataToastAutomatica,
  toastStore,
  type ToastItem,
} from "./store";

describe("inoltro toast alla finestra principale", () => {
  it("mostra, aggiorna e chiude un toast ricevuto da una Webview", () => {
    const snapshots: ToastItem[][] = [];
    const off = toastStore.subscribe((items) => snapshots.push(items));
    const id = `secondaria:${crypto.randomUUID()}`;

    applicaToastPrincipale({
      operazione: "mostra",
      item: {
        id,
        tipo: "loading",
        messaggio: "Invio in corso",
        durata: 0,
      },
    });
    expect(
      snapshots[snapshots.length - 1]?.find((item) => item.id === id)?.tipo,
    ).toBe("loading");

    applicaToastPrincipale({
      operazione: "aggiorna",
      id,
      patch: { tipo: "success", messaggio: "Invio avviato", durata: 4_000 },
    });
    expect(
      snapshots[snapshots.length - 1]?.find((item) => item.id === id),
    ).toMatchObject({
      tipo: "success",
      messaggio: "Invio avviato",
    });

    applicaToastPrincipale({ operazione: "chiudi", id });
    expect(
      snapshots[snapshots.length - 1]?.some((item) => item.id === id),
    ).toBe(false);
    off();
  });
});

describe("durata leggibile dei toast", () => {
  it("lascia più tempo a warning ed errori", () => {
    expect(durataToastAutomatica("info", "Messaggio breve")).toBe(7_000);
    expect(durataToastAutomatica("warning", "Messaggio breve")).toBe(10_000);
    expect(durataToastAutomatica("error", "Messaggio breve")).toBe(20_000);
  });

  it("adatta la durata ai testi lunghi e rende persistenti le azioni", () => {
    const lungo = Array.from({ length: 50 }, () => "parola").join(" ");
    expect(durataToastAutomatica("info", lungo)).toBeGreaterThan(7_000);
    expect(
      durataToastAutomatica("warning", "Serve una scelta", {
        azioni: [{ label: "Controlla", onClick: () => {} }],
      }),
    ).toBe(0);
    expect(
      durataToastAutomatica("error", "Errore", { durata: 1_234 }),
    ).toBe(1_234);
  });
});
