import { afterEach, describe, expect, it, vi } from "vitest";
import type { PagamentoVista } from "../../lib/tauri";
import { scaduta, statoCreditoLabel } from "./colonneCrediti";

function credito(scadenza: string): PagamentoVista {
  return {
    id: "pagamento-1",
    revision: "rev-1",
    ordineId: "ordine-1",
    ordineNumero: "2026-001",
    clienteId: "cliente-1",
    clienteNome: "Cliente",
    medicoId: "",
    medicoNome: "",
    agenteId: "",
    agenteNome: "",
    tipo: "saldo",
    importo: 10_000,
    saldato: false,
    scadenza,
    data: "",
    contoId: "",
    contoNome: "",
    contoTipo: "",
    contoAccreditoNome: "",
    ordineStato: "Confermato",
    linee: [],
    verificato: false,
  };
}

describe("stato scadenza crediti", () => {
  afterEach(() => vi.useRealTimers());

  it("considera scaduto anche il credito che scade oggi", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00"));

    const pagamento = credito("2026-08-03");
    expect(scaduta(pagamento)).toBe(true);
    expect(statoCreditoLabel(pagamento)).toBe("Scaduto");
  });

  it("lascia atteso un credito con scadenza futura", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00"));

    expect(scaduta(credito("2026-08-04"))).toBe(false);
  });
});
