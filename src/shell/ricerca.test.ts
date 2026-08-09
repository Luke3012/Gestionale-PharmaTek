import { describe, expect, it } from "vitest";
import type { Preventivo, Spedizione } from "../lib/tauri";
import { DATI_VUOTI, chiaveBersaglio, costruisciVoci, type DatiRicerca } from "./ricerca";

function spedizione(lotto: string): Spedizione {
  return {
    id: "sped-1",
    lotto,
    data: "2026-07-10",
    corriereId: "gls",
    corriereNome: "CORRIERE_B",
    numero: "",
    colli: 2,
    peso: 0,
    servizi: "",
    preavviso: false,
    mezzo: "",
    contrassegno: 0,
    note: "",
    clienteId: "cliente-1",
    clienteNome: "Cliente",
    medicoNome: "",
    agenteNome: "",
    indirizzo: "",
    cap: "",
    citta: "",
    prov: "",
    regione: "",
    telefono: "",
    email: "",
    corriereProfilo: "gls",
    unito: false,
    destinatariUniti: false,
    nRighe: 1,
    righe: [{
      rigaId: "riga-1",
      ordineId: "ordine-1",
      ordineNumero: "2026/1",
      prodottoNome: "Prodotto",
      qta: 1,
      prezzo: 1000,
      clienteNome: "Cliente",
      paziente: "",
      numero: "",
    }],
    pagamenti: [],
  };
}

describe("Spotlight crediti per spedizione", () => {
  it("trova una spedizione anche tramite il suo lotto di gruppo", () => {
    const lotto = "01JZLOTTO123456";
    const dati: DatiRicerca = { ...DATI_VUOTI, spedizioni: [spedizione(lotto)] };

    expect(
      costruisciVoci(lotto, dati).some(
        (voce) => voce.id === "sped-sped-1",
      ),
    ).toBe(true);
  });

  it("propone il lotto e produce il deep-link filtrato", () => {
    const lotto = "01JZLOTTO123456";
    const dati: DatiRicerca = { ...DATI_VUOTI, spedizioni: [spedizione(lotto)] };
    const suggerimento = costruisciVoci("crediti spedizione", dati)
      .find((voce) => voce.completion?.includes("CORRIERE_B"));

    expect(suggerimento?.completion).toBeTruthy();
    const applica = costruisciVoci(suggerimento!.completion!, dati)
      .find((voce) => voce.label === "Mostra crediti");

    expect(applica?.bersaglio).toMatchObject({
      t: "naviga",
      path: "/contabilita",
      tab: "pagamenti",
      spedizioneLotti: [lotto],
    });
  });

  it("considera il lotto nella deduplicazione dei deep-link", () => {
    const base = { t: "naviga" as const, path: "/contabilita", tab: "pagamenti" };
    expect(chiaveBersaglio({ ...base, spedizioneLotti: ["lotto-a"] }))
      .not.toBe(chiaveBersaglio({ ...base, spedizioneLotti: ["lotto-b"] }));
  });
});

describe("Spotlight provvigioni per agente", () => {
  it("mantiene l'id dell'agente nel deep-link anche se non ha provvigioni", () => {
    const dati: DatiRicerca = {
      ...DATI_VUOTI,
      agente: [{ id: "agente-senza-provv", revision: "test", deleted: false, data: { nome: "Mario Rossi" } }],
    };

    const applica = costruisciVoci("provvigioni agente Mario Rossi", dati)
      .find((voce) => voce.label === "Mostra provvigioni");

    expect(applica?.bersaglio).toMatchObject({
      t: "naviga",
      path: "/contabilita",
      tab: "provvigioni",
      agenteId: "agente-senza-provv",
    });
  });
});

describe("Spotlight preventivi Premium", () => {
  const preventivo = {
    id: "preventivo/ordine-1",
    ordineId: "ordine-1",
    ordineNumero: "2026-0012",
    numeroPreventivo: "P-2026-0012",
    clienteNome: "Chiara Fontana",
    medicoNome: "",
    linee: ["Immunoterapia"],
    totale: 81_000,
    creatoMs: new Date("2026-07-28T10:00:00+02:00").getTime(),
    righe: [],
  } as unknown as Preventivo;

  it("apre il singolo preventivo come risultato dedicato", () => {
    const dati: DatiRicerca = {
      ...DATI_VUOTI,
      preventivi: [preventivo],
    };
    const voce = costruisciVoci("P-2026-0012 Chiara", dati, {
      preventiviAbilitati: true,
    }).find((risultato) => risultato.gruppo === "Preventivi");

    expect(voce?.bersaglio).toEqual({
      t: "preventivo",
      ordineId: "ordine-1",
      numero: "P-2026-0012",
    });
  });

  it("trova il preventivo tramite il numero lotto della preparazione", () => {
    const dati: DatiRicerca = {
      ...DATI_VUOTI,
      preventivi: [
        {
          ...preventivo,
          righe: [{ numero: "508245", allergeni: [] }],
        } as unknown as Preventivo,
      ],
    };

    expect(
      costruisciVoci("508245", dati, { preventiviAbilitati: true }).some(
        (voce) => voce.gruppo === "Preventivi",
      ),
    ).toBe(true);
  });

  it("non espone i preventivi se Premium non è abilitato", () => {
    const dati: DatiRicerca = {
      ...DATI_VUOTI,
      preventivi: [preventivo],
    };
    expect(
      costruisciVoci("P-2026-0012", dati, {
        preventiviAbilitati: false,
      }).some((risultato) => risultato.gruppo === "Preventivi"),
    ).toBe(false);
  });
});

describe("Spotlight bollettazione Premium", () => {
  it("espone il comando e il deep-link soltanto con Premium abilitato", () => {
    expect(
      costruisciVoci("bollettazione automatica", DATI_VUOTI, {
        bollettazioneAbilitata: false,
      }).some((voce) => voce.id === "c-bollettazione-automatica"),
    ).toBe(false);

    const voce = costruisciVoci("bollettazione automatica", DATI_VUOTI, {
      bollettazioneAbilitata: true,
    }).find((risultato) => risultato.id === "c-bollettazione-automatica");

    expect(voce?.gruppo).toBe("Comandi");
    expect(voce?.bersaglio).toEqual({
      t: "naviga",
      path: "/evasione",
      tab: "da_spedire",
      azione: "bollettazione_automatica",
    });

    const voci = costruisciVoci("", DATI_VUOTI, {
      bollettazioneAbilitata: true,
    });
    expect(voci.findIndex((item) => item.id === "c-bollettazione-automatica"))
      .toBe(voci.findIndex((item) => item.id === "c-evas") + 1);
  });
});
