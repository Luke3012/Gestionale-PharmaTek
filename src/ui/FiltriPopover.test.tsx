import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { FiltriPopover, type FiltroDef } from "./FiltriPopover";
import { PrefsProvider } from "../lib/prefs";

const FILTRI_PROVA: FiltroDef[] = [
  {
    chiave: "agente",
    larghezza: 180,
    nodo: <div data-testid="filtro-agente">Agente</div>,
  },
  {
    chiave: "stato",
    larghezza: 170,
    nodo: <div data-testid="filtro-stato">Stato</div>,
  },
  {
    chiave: "periodo",
    larghezza: 260,
    nodo: <div data-testid="filtro-periodo">Periodo</div>,
  },
];

describe("FiltriPopover responsive e modalità espansi", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    const mockStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    };
    vi.stubGlobal("localStorage", mockStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("in modalità espansi renderizza tutti i filtri con display: contents e larghezze elastiche", () => {
    localStorage.setItem("pt.filtriModo", JSON.stringify("espansi"));

    const html = renderToStaticMarkup(
      <MantineProvider>
        <PrefsProvider>
          <FiltriPopover
            attivi={1}
            onAzzera={vi.fn()}
            filtri={FILTRI_PROVA}
          />
        </PrefsProvider>
      </MantineProvider>
    );

    // Tutti i filtri devono essere presenti direttamente nel markup
    expect(html).toContain('data-testid="filtro-agente"');
    expect(html).toContain('data-testid="filtro-stato"');
    expect(html).toContain('data-testid="filtro-periodo"');

    // Il contenitore deve avere display: contents per partecipare al flex wrap genitore
    expect(html).toContain("display:contents");

    // Deve essere presente il pulsante Azzera quando ci sono filtri attivi
    expect(html).toContain("Azzera");
  });

  it("in modalità compatti renderizza il pulsante menu Filtri", () => {
    localStorage.setItem("pt.filtriModo", JSON.stringify("compatti"));

    const html = renderToStaticMarkup(
      <MantineProvider>
        <PrefsProvider>
          <FiltriPopover
            attivi={0}
            onAzzera={vi.fn()}
            filtri={FILTRI_PROVA}
          />
        </PrefsProvider>
      </MantineProvider>
    );

    // I filtri non devono essere renderizzati inline
    expect(html).not.toContain('data-testid="filtro-agente"');
    // Deve contenere il pulsante Filtri
    expect(html).toContain("Filtri");
  });
});
