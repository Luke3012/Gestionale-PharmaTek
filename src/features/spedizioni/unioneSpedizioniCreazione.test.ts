import { describe, expect, it } from "vitest";
import {
  preparaColliSpedizioni,
  preparaPianificazioneSpedizioni,
  type Collo,
  type PerCollo,
} from "./CreaSpedizioneModal";
import type { OrdineDaSpedire } from "../../lib/tauri";
import { chiaveIndirizzoConfronto } from "./confrontoIndirizzi";

function creaOrdine(patch: Partial<OrdineDaSpedire>): OrdineDaSpedire {
  return {
    ordineId: "ord-1",
    numero: "2026-0001",
    data: "2026-06-01",
    stato: "Confermato",
    clienteId: "cli-1",
    clienteNome: "Lucilla Ostilli",
    medicoNome: "",
    agenteNome: "",
    indirizzo: "Via Monti Lucretili 29",
    cap: "00015",
    citta: "Monterotondo",
    prov: "RM",
    regione: "Lazio",
    telefono: "123456",
    email: "",
    noteSpedizione: "",
    colli: 1,
    categoria: "Immunoterapia",
    dataProduzione: "",
    acconto: 0,
    residuo: 25000,
    codMezzo: "contrassegno",
    codImporto: 25000,
    righe: [
      {
        rigaId: "r1",
        prodottoId: "p1",
        prodottoNome: "Vaccino A",
        qta: 1,
        prezzo: 25000,
        paziente: "",
        numero: "111",
      },
    ],
    ...patch,
  };
}

describe("preparaPianificazioneSpedizioni", () => {
  it("non ripete ordini quando sono attive le unioni per cliente e indirizzo sovrapposte", () => {
    const a1 = creaOrdine({ ordineId: "a1", clienteId: "a", clienteNome: "Cliente A" });
    const b1 = creaOrdine({
      ordineId: "b1", clienteId: "b", clienteNome: "Cliente B",
      righe: [{ ...a1.righe[0], rigaId: "r2" }],
    });
    const a2 = creaOrdine({
      ordineId: "a2", clienteId: "a", clienteNome: "Cliente A",
      indirizzo: "Via Seconda 10",
      righe: [{ ...a1.righe[0], rigaId: "r3" }],
    });
    const indirizzo = chiaveIndirizzoConfronto(a1);
    const colli = preparaColliSpedizioni(
      [a1, b1, a2],
      new Set([`cli:a`, `ind:${indirizzo}`]),
    );

    expect(colli.map((collo) => collo.ordini.map((ordine) => ordine.ordineId))).toEqual([
      ["a1", "b1"],
      ["a2"],
    ]);
    expect(colli.flatMap((collo) => collo.ordini.map((ordine) => ordine.ordineId))).toHaveLength(3);
  });

  it("pianifica un ordine singolo senza unioni", () => {
    const ord = creaOrdine({});
    const collo: Collo = {
      key: "ord:ord-1",
      clienteId: ord.clienteId,
      clienteNome: ord.clienteNome,
      ordini: [ord],
      unito: false,
    };
    const ps: PerCollo = {
      colli: 1,
      colliAuto: true,
      mezzo: "contrassegno",
      importo: 250,
      importoAuto: true,
      preavviso: true,
      note: "Consegna ore pasti",
      incluse: 1,
      righeCheck: { r1: true },
      numeri: { r1: "111" },
    };

    const res = preparaPianificazioneSpedizioni({
      data: "2026-10-01",
      corriereId: "corr-1",
      profiloCorriere: "gls",
      colli: [collo],
      stato: { [collo.key]: ps },
    });

    expect(res.lavoriCount).toBe(1);
    expect(res.flatShipments).toHaveLength(1);
    expect(res.flatShipments[0].rowIds).toEqual(["r1"]);
    expect(res.flatShipments[0].contrassegno).toBe(25000);
    expect(res.flatShipments[0].preavviso).toBe(true);
    expect(res.flatShipments[0].gruppiDestinatari).toEqual([]);
  });

  it("pianifica un collo unito con tutte le righe e i gruppi per la separazione", () => {
    const ord1 = creaOrdine({
      ordineId: "ord-1",
      clienteId: "cli-1",
      clienteNome: "Lucilla Ostilli",
      righe: [
        {
          rigaId: "r1",
          prodottoId: "p1",
          prodottoNome: "Vaccino 1",
          qta: 1,
          prezzo: 25000,
          paziente: "",
          numero: "111",
        },
      ],
    });
    const ord2 = creaOrdine({
      ordineId: "ord-2",
      clienteId: "cli-2",
      clienteNome: "Antonio Rea",
      righe: [
        {
          rigaId: "r2",
          prodottoId: "p2",
          prodottoNome: "Vaccino 2",
          qta: 1,
          prezzo: 30000,
          paziente: "",
          numero: "222",
        },
      ],
    });

    const collo: Collo = {
      key: "ind:via monti lucretili 29",
      clienteId: ord1.clienteId,
      clienteNome: ord1.clienteNome,
      ordini: [ord1, ord2],
      unito: true,
      unitoPer: "indirizzo",
    };

    const ps: PerCollo = {
      colli: 1,
      colliAuto: true,
      mezzo: "contrassegno",
      importo: 550,
      importoAuto: true,
      preavviso: false,
      note: "Unione clienti diversi",
      incluse: 2,
      righeCheck: { r1: true, r2: true },
      numeri: { r1: "111", r2: "222" },
      primarioClienteId: "cli-2",
    };

    const res = preparaPianificazioneSpedizioni({
      data: "2026-10-01",
      corriereId: "corr-1",
      profiloCorriere: "gls",
      colli: [collo],
      stato: { [collo.key]: ps },
    });

    expect(res.lavoriCount).toBe(1);
    expect(res.flatShipments).toHaveLength(1);

    expect(res.flatShipments[0].rowIds).toEqual(["r2", "r1"]);
    expect(res.flatShipments[0].contrassegno).toBe(55000);
    expect(res.flatShipments[0].note).toBe("Unione clienti diversi");
    expect(res.flatShipments[0].gruppiDestinatari).toEqual([
      { ordineId: "ord-2", rowIds: ["r2"] },
      { ordineId: "ord-1", rowIds: ["r1"] },
    ]);
  });

  it("non applica unione se uno dei due ordini ha tutte le righe escluse", () => {
    const ord1 = creaOrdine({
      ordineId: "ord-1",
      clienteId: "cli-1",
      righe: [
        {
          rigaId: "r1",
          prodottoId: "p1",
          prodottoNome: "Vaccino 1",
          qta: 1,
          prezzo: 25000,
          paziente: "",
          numero: "111",
        },
      ],
    });
    const ord2 = creaOrdine({
      ordineId: "ord-2",
      clienteId: "cli-2",
      righe: [
        {
          rigaId: "r2",
          prodottoId: "p2",
          prodottoNome: "Vaccino 2",
          qta: 1,
          prezzo: 30000,
          paziente: "",
          numero: "222",
        },
      ],
    });

    const collo: Collo = {
      key: "ind:via monti lucretili 29",
      clienteId: ord1.clienteId,
      clienteNome: ord1.clienteNome,
      ordini: [ord1, ord2],
      unito: true,
      unitoPer: "indirizzo",
    };

    const ps: PerCollo = {
      colli: 1,
      colliAuto: true,
      mezzo: "prepagato",
      importo: "",
      importoAuto: true,
      preavviso: false,
      note: "",
      incluse: 1,
      righeCheck: { r1: true, r2: false },
      numeri: { r1: "111", r2: "" },
    };

    const res = preparaPianificazioneSpedizioni({
      data: "2026-10-01",
      corriereId: "corr-1",
      profiloCorriere: "gls",
      colli: [collo],
      stato: { [collo.key]: ps },
    });

    expect(res.lavoriCount).toBe(1);
    expect(res.flatShipments).toHaveLength(1);
    expect(res.flatShipments[0].rowIds).toEqual(["r1"]);
    expect(res.flatShipments[0].gruppiDestinatari).toEqual([]);
  });
});
