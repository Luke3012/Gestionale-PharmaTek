import { describe, expect, it } from "vitest";

import type { Comunicazione, Suggerimento } from "../../lib/tauri";
import {
  contaNonVisteConStatiLocali,
  derivaNotifiche,
  idPromemoriaContratto,
  idSollecitoContratto,
} from "./notifiche";

const contratto = {
  solleciti: [
    { id: "p1", giorni: -1, soglia: 0, atteso: null },
    { id: "p1", giorni: 0, soglia: 0, atteso: "sollecito:p1:0" },
    { id: "p1", giorni: 6, soglia: 0, atteso: "sollecito:p1:0" },
    { id: "p1", giorni: 7, soglia: 0, atteso: "sollecito:p1:1" },
    { id: "p2", giorni: 10, soglia: 3, atteso: "sollecito:p2:1" },
  ],
  promemoria: [
    { id: "r1", scadenza: "2026-07-01", giorni: 8, avviso: 0, atteso: "promem-scaduto:r1:2026-07-01:1" },
    { id: "r1", scadenza: "2026-07-01", giorni: 0, avviso: 0, atteso: "promem-pre:r1:2026-07-01" },
    { id: "r2", scadenza: "2026-07-20", giorni: -2, avviso: 3, atteso: "promem-pre:r2:2026-07-20" },
    { id: "r2", scadenza: "2026-07-20", giorni: -4, avviso: 3, atteso: null },
  ],
} as const;

describe("contratto condiviso derivazione notifiche", () => {
  it("mantiene soglie e bucket dei solleciti allineati al backend", () => {
    for (const caso of contratto.solleciti) {
      expect(idSollecitoContratto(caso.id, caso.giorni, caso.soglia)).toBe(caso.atteso);
    }
  });

  it("mantiene gli id dei promemoria allineati al backend", () => {
    for (const caso of contratto.promemoria) {
      expect(idPromemoriaContratto(caso.id, caso.scadenza, caso.giorni, caso.avviso)).toBe(caso.atteso);
    }
  });

  it("porta nella campanella solo gli invii falliti", () => {
    const base = {
      revision: "1",
      canale: "whatsapp",
      destinatarioEntita: "cliente",
      destinatarioId: "cliente-1",
      recapito: ["+39", "328", "188", "3355"].join(""),
      oggetto: "",
      corpo: "Test",
      modelloId: "",
      modelloVersioneId: "",
      modelloVersione: 0,
      origineEntita: "",
      origineId: "",
      origineFingerprint: "",
      tipoModello: "",
      campagnaId: "",
      reinvioDi: "",
      allegati: [],
      tentativi: 1,
      ultimoErrore: "",
      esitoAmbiguo: false,
      proprietarioUtenteId: "u1",
      proprietarioUtenteNome: "Luca",
      proprietarioDispositivoId: "pc1",
      proprietarioDispositivoNome: "PC 1",
      inviataMs: 0,
      riferimentoEsterno: "",
      copiaPostaInviata: false,
      creataMs: 100,
      statoAggiornatoMs: 200,
    } satisfies Omit<Comunicazione, "id" | "stato">;
    const comunicazioni: Comunicazione[] = [
      { ...base, id: "fallita", stato: "fallito" },
      { ...base, id: "attiva", stato: "in_invio" },
      { ...base, id: "inviata", stato: "invio_azionato" },
    ];

    const notifiche = derivaNotifiche({
      pagamenti: [],
      promemoria: [],
      ordini: [],
      comunicazioni,
      sogliaSolleciti: 0,
    });

    expect(notifiche.map((notifica) => notifica.id)).toEqual([
      "comunicazione:fallita",
    ]);
    expect(notifiche[0]?.comunicazioneId).toBe("fallita");
    expect(
      contaNonVisteConStatiLocali(
        notifiche,
        new Set(),
        new Set(),
        new Set(),
        new Set(),
      ),
    ).toBe(1);
    expect(
      contaNonVisteConStatiLocali(
        notifiche,
        new Set(),
        new Set(),
        new Set(["comunicazione:fallita"]),
        new Set(),
      ),
    ).toBe(0);
    expect(
      contaNonVisteConStatiLocali(
        notifiche,
        new Set(),
        new Set(),
        new Set(),
        new Set(["comunicazione:fallita"]),
      ),
    ).toBe(0);
  });

  it("porta le azioni mature nel normale flusso con il deep-link completo", () => {
    const suggerimento: Suggerimento = {
      id: "s14:provvigione:agente-1:rev-7",
      tipo: "provvigione",
      titolo: "Provvigioni da liquidare",
      dettaglio: "Mario Rossi · € 125,00 maturati",
      azioneLabel: "Apri provvigioni",
      priorita: 82,
      riferimentoData: "2026-07-01",
      aggiornatoMs: 1_754_000_000_000,
      collegamento: {
        path: "/contabilita",
        tab: "provvigioni",
        agenteId: "agente-1",
        provvigioniOrdina: "maturato",
      },
    };

    const notifiche = derivaNotifiche({
      pagamenti: [],
      promemoria: [],
      ordini: [],
      suggerimenti: [suggerimento],
      sogliaSolleciti: 0,
    });

    expect(notifiche).toHaveLength(1);
    expect(notifiche[0]).toMatchObject({
      id: suggerimento.id,
      tipo: "suggerimento",
      urgenza: "oggi",
      ts: suggerimento.aggiornatoMs,
      suggerimento: suggerimento.collegamento,
    });
  });
});
