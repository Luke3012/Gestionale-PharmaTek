import { describe, expect, it, vi } from "vitest";
import {
  attendiCreazioneFinestra,
  nascondiInTraySeAttiva,
  portaFinestraInPrimoPiano,
  queryIdentita,
  èPannelloUtente,
} from "./finestreTauri";

describe("helper finestre Tauri", () => {
  it("mantiene ordine e attese nel ripristino di una finestra", async () => {
    const chiamate: string[] = [];
    const finestra = {
      show: vi.fn(async () => { chiamate.push("show"); }),
      unminimize: vi.fn(async () => { chiamate.push("unminimize"); }),
      setFocus: vi.fn(async () => { chiamate.push("focus"); }),
    };

    await portaFinestraInPrimoPiano(finestra);

    expect(chiamate).toEqual(["show", "unminimize", "focus"]);
  });

  it("serializza l'identità come i precedenti opener", () => {
    expect(queryIdentita()).toBe("");
    expect(queryIdentita({
      userId: "utente 1",
      nome: "Luca & Co",
      deviceId: "pc/ufficio",
    } as never)).toBe("&uid=utente%201&nome=Luca%20%26%20Co&dev=pc%2Fufficio");
  });

  it("converte gli eventi di creazione nello stesso esito booleano", async () => {
    const callbacks = new Map<string, () => void>();
    const finestra = {
      label: "preventivo-1",
      once: vi.fn(async (evento: string, callback: () => void) => {
        callbacks.set(evento, callback);
        return () => {};
      }),
    };

    const creata = attendiCreazioneFinestra(finestra as never);
    callbacks.get("tauri://created")?.();
    await expect(creata).resolves.toBe(true);

    const errore = attendiCreazioneFinestra(finestra as never);
    callbacks.get("tauri://error")?.();
    await expect(errore).resolves.toBe(false);
  });

  it("non lascia il bootstrap sospeso se Tauri non emette alcun esito", async () => {
    vi.useFakeTimers();
    const scollega = vi.fn();
    const finestra = {
      label: "preventivo-2",
      once: vi.fn(async () => scollega),
    };

    const esito = attendiCreazioneFinestra(finestra as never, 250, async () => false);
    await vi.advanceTimersByTimeAsync(250);

    await expect(esito).resolves.toBe(false);
    expect(scollega).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("riconosce una finestra già creata se l'evento è arrivato prima dei listener", async () => {
    const finestra = {
      label: "preventivo-nuovo",
      once: vi.fn(async () => () => {}),
    };
    const verifica = vi.fn(async (label: string) => label === "preventivo-nuovo");

    await expect(
      attendiCreazioneFinestra(finestra as never, 250, verifica),
    ).resolves.toBe(true);
    expect(verifica).toHaveBeenCalledWith("preventivo-nuovo");
  });

  it("applica la stessa regola tray anche prima del mount della Shell", async () => {
    const hide = vi.fn(async () => {});

    await expect(nascondiInTraySeAttiva({ hide } as never, async () => true)).resolves.toBe(true);
    expect(hide).toHaveBeenCalledOnce();

    hide.mockClear();
    await expect(nascondiInTraySeAttiva({ hide } as never, async () => false)).resolves.toBe(false);
    expect(hide).not.toHaveBeenCalled();
  });

  it("non trasforma un errore di hide tray in un'uscita completa", async () => {
    const hide = vi.fn(async () => { throw new Error("Windows non disponibile"); });
    await expect(nascondiInTraySeAttiva({ hide } as never, async () => true)).resolves.toBe(true);
  });

  it("distingue pannelli utente e finestre di servizio nell'uscita", () => {
    expect(["ordine-1", "riepilogo-cliente-1", "pagamento-1", "promemoria-nuovo", "notifiche", "comunicazioni", "comunicazione-cliente-1", "comunicazione-batch", "cestino"]
      .every(èPannelloUtente)).toBe(true);
    expect(["main", "spotlight", "overlay", "info"].some(èPannelloUtente)).toBe(false);
  });
});
