import { describe, expect, it, vi } from "vitest";
import type {
  CanaleComunicazione,
  Comunicazione,
  ComunicazioneCreaInput,
  ModelloComunicazione,
  Preventivo,
} from "../../lib/tauri";
import {
  avviaInvioRapidoPreventivo,
  inviaPreventivoRapido,
  type DipendenzeInvioRapidoPreventivo,
} from "./invioRapidoPreventivo";
import type { AllegatiPreventivoPerCanale } from "./allegatiPreventivo";
import { toast } from "../../ui/toast/store";

function preventivo(overrides: Partial<Preventivo> = {}): Preventivo {
  return {
    id: "preventivo-1",
    revision: "rev-1",
    fingerprintCorrente: "fingerprint-1",
    numeroPreventivo: "P-42",
    ordineId: "ordine-1",
    ordineNumero: "42",
    clienteId: "cliente-1",
    clienteNome: "Mario Rossi",
    medicoId: "medico-1",
    medicoNome: "Dott. Bianchi",
    agenteNome: "Agente",
    linee: ["Immunoterapia"],
    email: "demo@example.invalid",
    telefono: "3331234567",
    creatoMs: Date.UTC(2026, 6, 30),
    totale: 12_300,
    ...overrides,
  } as Preventivo;
}

function modello(): ModelloComunicazione {
  return {
    id: "preventivo-base",
    versioneId: "versione-2",
    versione: 2,
    tipo: "preventivo",
    predefinito: true,
    attivo: true,
    oggetto: "Preventivo {{numero_preventivo}}",
    corpo: "Gentile {{nome_cliente}}, ordine {{riferimento_ordine}}.",
  } as ModelloComunicazione;
}

function comunicazione(
  id: string,
  canale: "email" | "whatsapp",
): Comunicazione {
  return { id, canale, stato: "bozza" } as Comunicazione;
}

function dipendenze() {
  const creaBozza = vi.fn(async (input: ComunicazioneCreaInput) =>
    comunicazione(`com-${input.canale}`, input.canale),
  );
  const mettiInCoda = vi.fn(
    async (id: string): Promise<Comunicazione> =>
      ({
        ...comunicazione(id, id.endsWith("email") ? "email" : "whatsapp"),
        stato: "in_coda",
      }) as Comunicazione,
  );
  const rilasciaAllegati = vi.fn(async () => {});
  const valore: DipendenzeInvioRapidoPreventivo = {
    listaModelli: vi.fn(async () => [modello()]),
    preparaAllegati: vi.fn(
      async (_preventivo: Preventivo, canali: readonly CanaleComunicazione[]) =>
        Object.fromEntries(
          canali.map((canale) => [
            canale,
            [
              {
                nome: `${canale}.pdf`,
                mime: "application/pdf",
                dimensione: 1,
                riferimento: `pt-cache://${canale}`,
                sha256: canale,
              },
            ],
          ]),
        ),
    ),
    rilasciaAllegati,
    creaBozza,
    mettiInCoda,
    creaChiaveIntento: () => "rapido:test",
  };
  return { valore, creaBozza, mettiInCoda, rilasciaAllegati };
}

describe("inviaPreventivoRapido", () => {
  it("prepara e accoda e-mail e WhatsApp come un'unica intenzione", async () => {
    const deps = dipendenze();
    const esito = await inviaPreventivoRapido(preventivo(), deps.valore);

    expect(esito.canali).toEqual(["email", "whatsapp"]);
    expect(deps.creaBozza).toHaveBeenCalledTimes(2);
    expect(deps.mettiInCoda).toHaveBeenCalledTimes(2);
    expect(deps.rilasciaAllegati).toHaveBeenCalledTimes(1);
    expect(deps.creaBozza.mock.calls[0][0]).toMatchObject({
      idempotencyKey: "rapido:test:email",
      campagnaId: "rapido:test",
      oggetto: "Preventivo P-42",
      corpo: "Gentile Mario Rossi, ordine ordine 42.",
      tipoModello: "preventivo",
    });
  });

  it.each([
    {
      nome: "sola e-mail",
      patch: { telefono: "" },
      canale: "email",
    },
    {
      nome: "solo WhatsApp",
      patch: { email: "" },
      canale: "whatsapp",
    },
  ])(
    "invia silenziosamente sul canale disponibile: $nome",
    async ({ patch, canale }) => {
      const deps = dipendenze();
      const esito = await inviaPreventivoRapido(preventivo(patch), deps.valore);
      expect(esito.canali).toEqual([canale]);
      expect(deps.creaBozza).toHaveBeenCalledTimes(1);
      expect(deps.creaBozza.mock.calls[0][0].campagnaId).toBe("");
    },
  );

  it("non crea bozze quando entrambi i recapiti sono inutilizzabili", async () => {
    const deps = dipendenze();
    await expect(
      inviaPreventivoRapido(
        preventivo({ email: "errata", telefono: "123" }),
        deps.valore,
      ),
    ).rejects.toThrow("non ha un indirizzo e-mail o un numero WhatsApp valido");
    expect(deps.creaBozza).not.toHaveBeenCalled();
  });

  it("propaga gli errori di preparazione senza accodare comunicazioni", async () => {
    const deps = dipendenze();
    deps.valore.preparaAllegati = vi.fn(async () => {
      throw new Error("documento in overflow");
    });
    await expect(
      inviaPreventivoRapido(preventivo(), deps.valore),
    ).rejects.toThrow("documento in overflow");
    expect(deps.creaBozza).not.toHaveBeenCalled();
  });

  it("mostra il messaggio di errore nel toast senza il prefisso tecnico", async () => {
    const deps = dipendenze();
    deps.valore.preparaAllegati = vi.fn(async () => {
      throw new Error("documento in overflow");
    });
    const toastErrore = vi
      .spyOn(toast, "error")
      .mockImplementation(() => "toast-test");

    expect(await avviaInvioRapidoPreventivo(preventivo(), deps.valore)).toBe(
      false,
    );
    expect(toastErrore).toHaveBeenCalledWith(
      "Invio preventivo non riuscito: documento in overflow",
    );
  });

  it("ignora un secondo click finché lo stesso preventivo è in preparazione", async () => {
    const deps = dipendenze();
    let completaPreparazione!: () => void;
    deps.valore.preparaAllegati = vi.fn(
      () =>
        new Promise<AllegatiPreventivoPerCanale>((resolve) => {
          completaPreparazione = () => resolve({});
        }),
    );

    const primo = avviaInvioRapidoPreventivo(preventivo(), deps.valore);
    const secondo = await avviaInvioRapidoPreventivo(preventivo(), deps.valore);
    expect(secondo).toBe(false);
    expect(deps.valore.preparaAllegati).toHaveBeenCalledTimes(1);

    completaPreparazione();
    expect(await primo).toBe(true);
  });
});
