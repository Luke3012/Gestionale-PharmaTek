import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configurazioneDocumentiGet: vi.fn(),
  creaDocumentoPreventivo: vi.fn(),
  creaDocumentoSchedaCliente: vi.fn(),
  schedaClienteGet: vi.fn(),
  stampaDocumento: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  api: {
    configurazioneDocumentiGet: mocks.configurazioneDocumentiGet,
    schedaClienteGet: mocks.schedaClienteGet,
  },
}));

vi.mock("./rendererDocumenti", () => ({
  creaDocumentoPreventivo: mocks.creaDocumentoPreventivo,
  creaDocumentoSchedaCliente: mocks.creaDocumentoSchedaCliente,
  stampaDocumento: mocks.stampaDocumento,
}));

import {
  stampaPreventivoDiretta,
  stampaSchedaClienteDiretta,
} from "./stampaDiretta";

describe("stampa diretta dai menu contestuali", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("manda il preventivo direttamente al renderer di stampa", () => {
    const preventivo = { id: "preventivo-1" };
    const config = { logoDataUrl: "logo" };
    const documento = { titolo: "Preventivo" };
    const pulizia = vi.fn();
    mocks.creaDocumentoPreventivo.mockReturnValue(documento);
    mocks.stampaDocumento.mockReturnValue(pulizia);

    expect(
      stampaPreventivoDiretta(preventivo as never, config as never),
    ).toBe(pulizia);
    expect(mocks.creaDocumentoPreventivo).toHaveBeenCalledWith(
      preventivo,
      config,
    );
    expect(mocks.stampaDocumento).toHaveBeenCalledWith(documento);
  });

  it("carica la scheda e apre direttamente il dialogo di stampa", async () => {
    const scheda = {
      ordineNumero: "2026-0042",
      medicoNome: "Dott. Rossi",
      agenteNome: "Agente Bianchi",
    };
    const config = { logoDataUrl: "logo" };
    const documento = { titolo: "Scheda cliente" };
    const pulizia = vi.fn();
    mocks.schedaClienteGet.mockResolvedValue(scheda);
    mocks.configurazioneDocumentiGet.mockResolvedValue(config);
    mocks.creaDocumentoSchedaCliente.mockReturnValue(documento);
    mocks.stampaDocumento.mockReturnValue(pulizia);

    await expect(
      stampaSchedaClienteDiretta("ordine-42", "fallback"),
    ).resolves.toBe(pulizia);
    expect(mocks.creaDocumentoSchedaCliente).toHaveBeenCalledWith(
      "2026-0042",
      scheda,
      config,
      {
        medicoNome: "Dott. Rossi",
        agenteNome: "Agente Bianchi",
      },
    );
    expect(mocks.stampaDocumento).toHaveBeenCalledWith(documento);
  });
});
