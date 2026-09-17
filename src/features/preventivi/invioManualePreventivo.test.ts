import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  marca: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  api: { preventivoMarcaInviatoManuale: mocks.marca },
}));
vi.mock("../../ui/dialog/store", () => ({
  dialog: { confirm: mocks.confirm },
}));
vi.mock("../../ui/toast/store", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

import type { Preventivo } from "../../lib/tauri";
import { confermaInvioManualeDopoEsportazione } from "./invioManualePreventivo";

const preventivo = {
  id: "preventivo/ordine-1",
  ordineId: "ordine-1",
  revision: "rev-1",
  indicazioneInvio: "mai_inviato",
} as Preventivo;

describe("confermaInvioManualeDopoEsportazione", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marca e restituisce il DTO aggiornato dopo la conferma", async () => {
    const aggiornato = { ...preventivo, indicazioneInvio: "inviato" } as Preventivo;
    mocks.confirm.mockResolvedValue(true);
    mocks.marca.mockResolvedValue(aggiornato);

    await expect(
      confermaInvioManualeDopoEsportazione(preventivo),
    ).resolves.toBe(aggiornato);
    expect(mocks.marca).toHaveBeenCalledWith("ordine-1", "rev-1");
  });

  it("non scrive quando il dialog viene annullato", async () => {
    mocks.confirm.mockResolvedValue(false);
    await expect(
      confermaInvioManualeDopoEsportazione(preventivo),
    ).resolves.toBeNull();
    expect(mocks.marca).not.toHaveBeenCalled();
  });

  it("non ripropone la marcatura per un preventivo già inviato", async () => {
    await expect(
      confermaInvioManualeDopoEsportazione({
        ...preventivo,
        indicazioneInvio: "inviato",
      } as Preventivo),
    ).resolves.toBeNull();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
