import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creaDocumentoSchedaCliente, stampaDocumento } from "./rendererDocumenti";
import type { DocumentoA4 } from "./rendererDocumenti";

describe("stampaDocumento", () => {
  let createdIframes: any[] = [];
  let windowListeners: Record<string, Function[]> = {};

  beforeEach(() => {
    vi.useFakeTimers();
    createdIframes = [];
    windowListeners = {};

    (globalThis as any).URL = {
      createObjectURL: vi.fn().mockReturnValue("blob:fake-pdf-url"),
      revokeObjectURL: vi.fn(),
    };

    const mockWindow = {
      document: {} as any,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener: vi.fn((event: string, handler: Function) => {
        windowListeners[event] = windowListeners[event] || [];
        windowListeners[event].push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: Function) => {
        if (windowListeners[event]) {
          windowListeners[event] = windowListeners[event].filter((h) => h !== handler);
        }
      }),
    };

    const mockDocument = {
      body: {
        appendChild: vi.fn((el: any) => {
          createdIframes.push(el);
          return el;
        }),
      },
      querySelector: vi.fn((sel: string) => (sel === "iframe" ? (createdIframes[0] ?? null) : null)),
      querySelectorAll: vi.fn((sel: string) => (sel === "iframe" ? [...createdIframes] : [])),
      createElement: vi.fn((_tag: string) => {
        const listeners: Record<string, Function[]> = {};
        const contentWindowListeners: Record<string, Function[]> = {};
        const contentWindow = {
          focus: vi.fn(),
          print: vi.fn(),
          addEventListener: vi.fn((event: string, handler: Function) => {
            contentWindowListeners[event] = contentWindowListeners[event] || [];
            contentWindowListeners[event].push(handler);
          }),
          removeEventListener: vi.fn((event: string, handler: Function) => {
            if (contentWindowListeners[event]) {
              contentWindowListeners[event] = contentWindowListeners[event].filter((h) => h !== handler);
            }
          }),
        };

        const iframe = {
          tagName: "IFRAME",
          style: {},
          src: "",
          contentWindow,
          listeners,
          contentWindowListeners,
          addEventListener: vi.fn((event: string, handler: Function) => {
            listeners[event] = listeners[event] || [];
            listeners[event].push(handler);
          }),
          removeEventListener: vi.fn(),
          remove: vi.fn(() => {
            createdIframes = createdIframes.filter((x) => x !== iframe);
          }),
          dispatchEvent: (event: { type: string }) => {
            listeners[event.type]?.forEach((h) => h());
          },
        };
        return iframe;
      }),
    };
    mockWindow.document = mockDocument;

    (globalThis as any).window = mockWindow;
    (globalThis as any).document = mockDocument;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).URL;
  });

  const creaDocumentoValido = (): DocumentoA4 =>
    creaDocumentoSchedaCliente("2026-0001", {
      dataRicezione: "",
      pazienti: "",
      infoSpedizione: "",
      contatti: "",
      intestatarioNome: "",
      intestatarioCodiceFiscale: "",
      intestatarioDataNascita: "",
      intestatarioLuogoNascita: "",
      intestatarioIndirizzo: "",
      importoTotale: 0,
      importoAcconto: 0,
      dataContabileValuta: "",
      modalitaSaldo: "",
      note: "",
      preventivoWhatsapp: false,
      preventivoEmail: false,
      mantenimento: false,
      npp: false,
      pazienteNuovo: false,
    });

  it("rifiuta la stampa se il documento ha overflow", () => {
    const docConOverflow = {
      ...creaDocumentoValido(),
      overflow: ["Troppi elementi nella pagina"],
    };
    expect(() => stampaDocumento(docConOverflow)).toThrow(
      "Riduci i contenuti indicati prima di stampare.",
    );
  });

  it("non distrugge l'iframe dopo 15 secondi (nessun timeout forzato)", () => {
    const doc = creaDocumentoValido();
    const rilascia = stampaDocumento(doc);

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalled();

    // Avanza oltre i 15 secondi (vecchio bug)
    vi.advanceTimersByTime(30_000);

    // L'iframe deve essere ancora presente e l'URL non revocato
    expect(document.querySelector("iframe")).toBe(iframe);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    rilascia();
    expect(document.querySelector("iframe")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-pdf-url");
  });

  it("esegue la stampa all'evento load e pulisce dopo afterprint", () => {
    const doc = creaDocumentoValido();
    const onRilasciato = vi.fn();
    stampaDocumento(doc, onRilasciato);

    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();

    const mockFocus = vi.fn();
    const mockPrint = vi.fn();
    const mockContentWindow = {
      focus: mockFocus,
      print: mockPrint,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(iframe, "contentWindow", {
      value: mockContentWindow,
      writable: true,
    });

    // Simula evento load dell'iframe
    iframe.dispatchEvent(new Event("load"));

    expect(mockFocus).toHaveBeenCalled();
    expect(mockPrint).toHaveBeenCalled();
    expect(mockContentWindow.addEventListener).toHaveBeenCalledWith(
      "afterprint",
      expect.any(Function),
      { once: true },
    );

    // Simula trigger di afterprint
    const handlerAfterPrint = mockContentWindow.addEventListener.mock.calls.find(
      (call) => call[0] === "afterprint",
    )?.[1];
    expect(handlerAfterPrint).toBeDefined();
    handlerAfterPrint();

    // Prima del delay di 1 secondo lo spooler è ancora attivo
    expect(document.querySelector("iframe")).toBe(iframe);

    // Dopo 1000ms rilascia l'iframe e revoca l'URL
    vi.advanceTimersByTime(1000);
    expect(document.querySelector("iframe")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-pdf-url");
    expect(onRilasciato).toHaveBeenCalled();
  });

  it("pulisce automaticamente la sessione di stampa precedente quando se ne avvia una nuova", () => {
    const doc1 = creaDocumentoValido();
    const onRilasciato1 = vi.fn();
    stampaDocumento(doc1, onRilasciato1);

    const primoIframe = document.querySelector("iframe");
    expect(primoIframe).not.toBeNull();

    // Avvia una seconda stampa
    const doc2 = creaDocumentoValido();
    const onRilasciato2 = vi.fn();
    stampaDocumento(doc2, onRilasciato2);

    // Il primo iframe deve essere stato rimosso e onRilasciato1 invocato
    expect(onRilasciato1).toHaveBeenCalled();
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    const secondoIframe = document.querySelector("iframe");
    expect(secondoIframe).not.toBe(primoIframe);
  });
});
