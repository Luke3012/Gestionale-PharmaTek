import { afterEach, describe, expect, it, vi } from "vitest";
import { osservaRidimensionamento } from "./osservaRidimensionamento";

describe("osservaRidimensionamento", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("misura subito, osserva l'elemento e scollega l'observer", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(readonly callback: () => void) {}
      observe = observe;
      disconnect = disconnect;
    });
    const misura = vi.fn();
    const elemento = {} as Element;

    const scollega = osservaRidimensionamento(elemento, misura);
    expect(misura).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledWith(elemento);
    scollega();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
