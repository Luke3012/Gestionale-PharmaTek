import { describe, expect, it, vi } from "vitest";
import { collegaDisiscrizioneAsincrona } from "./disiscrizioneAsincrona";

function promessaDifferita<T>() {
  let risolvi!: (valore: T) => void;
  const promessa = new Promise<T>((resolve) => {
    risolvi = resolve;
  });
  return { promessa, risolvi };
}

describe("collegaDisiscrizioneAsincrona", () => {
  it("disiscrive dopo il cleanup quando la registrazione è già terminata", async () => {
    const disiscrivi = vi.fn();
    const cleanup = collegaDisiscrizioneAsincrona(Promise.resolve(disiscrivi));

    await Promise.resolve();
    cleanup();

    expect(disiscrivi).toHaveBeenCalledOnce();
  });

  it("disiscrive appena termina una registrazione risolta dopo il cleanup", async () => {
    const differita = promessaDifferita<() => void>();
    const disiscrivi = vi.fn();
    const cleanup = collegaDisiscrizioneAsincrona(differita.promessa);

    cleanup();
    differita.risolvi(disiscrivi);
    await Promise.resolve();

    expect(disiscrivi).toHaveBeenCalledOnce();
  });

  it("assorbe gli errori di registrazione", async () => {
    const cleanup = collegaDisiscrizioneAsincrona(
      Promise.reject(new Error("listener non disponibile")),
    );

    await Promise.resolve();
    expect(cleanup).not.toThrow();
  });
});
