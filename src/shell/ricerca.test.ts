import { describe, expect, it } from "vitest";
import type { OrdineDaSpedire, OrdineDto, Preventivo, Spedizione } from "../lib/tauri";
import type { Promemoria } from "../features/promemoria/promemoria";
import {
  DATI_VUOTI,
  chiaveBersaglio,
  costruisciVoci,
  preventivoNellAnnoRicerca,
  selezionaOrdiniRicerca,
  type DatiRicerca,
} from "./ricerca";

const ordineRicerca = (id: string, data: string, stato = "Confermato") =>
  ({ id, data, stato, linee: [], produzioneOperativa: false }) as unknown as OrdineDto;

describe("anno di lavoro di Spotlight", () => {
  it("unisce lo storico annuale agli arretrati realmente operativi", () => {
    const anno = ordineRicerca("anno", "2025-03-01", "Chiuso");
    const arretratoSpedizione = ordineRicerca("sped", "2024-03-01");
    const arretratoProduzione = {
      ...ordineRicerca("produzione", "2024-04-01"),
      produzioneOperativa: true,
    };
    const arretratoChiuso = ordineRicerca("chiuso", "2024-03-01", "Chiuso");
    const futuro = {
      ...ordineRicerca("futuro", "2026-03-01"),
      produzioneOperativa: true,
    };
    const daSpedire = [{
      ordineId: arretratoSpedizione.id,
      data: arretratoSpedizione.data,
      stato: arretratoSpedizione.stato,
    }] as OrdineDaSpedire[];

    expect(
      selezionaOrdiniRicerca(
        [anno, arretratoSpedizione, arretratoProduzione, arretratoChiuso, futuro],
        daSpedire,
        2025,
      ).map((ordine) => ordine.id),
    ).toEqual(["anno", "sped", "produzione"]);
  });

  it("classifica i preventivi con la data dell'ordine", () => {
    const preventivo = {
      ordineData: "2025-12-20",
      creatoMs: new Date("2026-01-10T10:00:00+01:00").getTime(),
    } as Preventivo;
    expect(preventivoNellAnnoRicerca(preventivo, 2025)).toBe(true);
    expect(preventivoNellAnnoRicerca(preventivo, 2026)).toBe(false);
    expect(preventivoNellAnnoRicerca(preventivo, 0)).toBe(true);
  });
});

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

function promemoria(): Promemoria {
  return {
    id: "prom-1",
    testo: "Rinnova polizza",
    scadenza: "2026-12-31",
    priorita: "alta",
    ricorrenza: "nessuna",
    avvisoAnticipato: 0,
    collegatoTipo: "cliente",
    collegatoId: "cliente-1",
    collegatoNome: "Cliente Alfa",
    serie: "",
    fatto: false,
    fattoDa: "",
    fattoDaNome: "",
    fattoTs: 0,
    creatoDa: "utente-1",
    creatoDaNome: "Anna",
  };
}

describe("Spotlight promemoria", () => {
  const dati: DatiRicerca = { ...DATI_VUOTI, promemoria: [promemoria()] };

  it("mantiene il formato completo nella ricerca smart", () => {
    const voce = costruisciVoci("promemoria priorità alta aperti", dati)
      .find((risultato) => risultato.id === "smart-promem-prom-1");

    expect(voce).toMatchObject({
      label: "Rinnova polizza",
      sub: "scad. 31/12/2026 · Cliente Alfa · priorità alta",
      dedupeKey: "promemoria:prom-1",
      bersaglio: { t: "promemoria_apri", id: "prom-1" },
    });
  });

  it("mantiene id e deduplicazione storici nella ricerca libera", () => {
    const voce = costruisciVoci("Rinnova polizza", dati)
      .find((risultato) => risultato.id === "promem-prom-1");

    expect(voce).toMatchObject({
      sub: "scad. 31/12/2026 · Cliente Alfa",
      dedupeKey: "promemoria_apri",
      bersaglio: { t: "promemoria_apri", id: "prom-1" },
    });
  });
});

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

describe("Spotlight preventivi", () => {
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

  it("espone i preventivi anche senza Premium", () => {
    const dati: DatiRicerca = {
      ...DATI_VUOTI,
      preventivi: [preventivo],
    };
    expect(
      costruisciVoci("P-2026-0012", dati).some(
        (risultato) => risultato.gruppo === "Preventivi",
      ),
    ).toBe(true);
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
