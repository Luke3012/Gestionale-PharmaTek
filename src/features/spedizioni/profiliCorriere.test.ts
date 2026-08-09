import { describe, expect, it } from "vitest";
import type { Spedizione } from "../../lib/tauri";
import {
  formattaNumeriLottoPerExport,
  normalizzaColliPesoCorriere,
  preparaRigheEsportazione,
} from "./profiliCorriere";

function spedizioneCorriereDemo(): Spedizione {
  return {
    id: "spedizione",
    lotto: "lotto",
    data: "2026-07-14",
    corriereId: "carrai",
    corriereNome: "CORRIERE_A",
    corriereProfilo: "carrai",
    numero: "LOT-1 + LOT-2 + LOT-3",
    colli: 3,
    peso: 3,
    servizi: "",
    preavviso: false,
    mezzo: "",
    contrassegno: 0,
    note: "",
    clienteId: "cliente",
    clienteNome: "Destinatario",
    medicoNome: "",
    agenteNome: "",
    indirizzo: "Via Roma 1",
    cap: "00100",
    citta: "Roma",
    prov: "RM",
    regione: "Lazio",
    telefono: "",
    email: "",
    unito: false,
    destinatariUniti: false,
    nRighe: 3,
    pagamenti: [],
    righe: [
      { rigaId: "r1", ordineId: "o", ordineNumero: "1", prodottoNome: "Vaccino A", qta: 1, prezzo: 1, clienteNome: "Destinatario", paziente: "Mario Rossi", numero: "LOT-1" },
      { rigaId: "r2", ordineId: "o", ordineNumero: "1", prodottoNome: "Vaccino B", qta: 1, prezzo: 1, clienteNome: "Destinatario", paziente: " mario   rossi ", numero: "LOT-2" },
      { rigaId: "r3", ordineId: "o", ordineNumero: "1", prodottoNome: "Vaccino C", qta: 1, prezzo: 1, clienteNome: "Destinatario", paziente: "Lucia Bianchi", numero: "LOT-3" },
    ],
  };
}

describe("numeri lotto nelle distinte corriere", () => {
  it("mantiene tutti i lotti per quantità in una singola cella compatibile", () => {
    expect(formattaNumeriLottoPerExport("5078989\n5078990")).toBe("5078989 + 5078990");
  });

  it("ignora righe vuote senza generare separatori doppi", () => {
    expect(formattaNumeriLottoPerExport("LOT-1\n\n LOT-3 ")).toBe("LOT-1 + LOT-3");
  });

  it("mantiene sempre colli e peso a 1 per Corriere A", () => {
    expect(normalizzaColliPesoCorriere("carrai", 8, 12)).toEqual({ colli: 1, peso: 1 });
    expect(normalizzaColliPesoCorriere("gls", 8, 12)).toEqual({ colli: 8, peso: 12 });
  });

  it("raggruppa in una riga Corriere A tutti i vaccini della stessa persona", () => {
    const righe = preparaRigheEsportazione([spedizioneCorriereDemo()], "carrai");

    expect(righe).toHaveLength(2);
    expect(righe.map((riga) => riga.numero)).toEqual(["LOT-1 + LOT-2", "LOT-3"]);
    expect(righe.every((riga) => riga.colli === 1 && riga.peso === 1)).toBe(true);
  });

  it("accorpa nella stessa riga Excel colli Corriere A distinti della stessa persona", () => {
    const prima = spedizioneCorriereDemo();
    prima.id = "spedizione-1";
    prima.righe = [{ ...prima.righe[0], numero: "5078989" }];
    const seconda = spedizioneCorriereDemo();
    seconda.id = "spedizione-2";
    seconda.righe = [{ ...seconda.righe[1], numero: "5078990" }];

    const righe = preparaRigheEsportazione([prima, seconda], "carrai");

    expect(righe).toHaveLength(1);
    expect(righe[0].numero).toBe("5078989 + 5078990");
    expect(righe[0].colli).toBe(1);
    expect(righe[0].peso).toBe(1);
  });

  it("mantiene la riga Corriere A della persona anche quando non ha numeri lotto", () => {
    const spedizione = spedizioneCorriereDemo();
    spedizione.righe = spedizione.righe.slice(0, 2).map((riga) => ({ ...riga, numero: "" }));

    const righe = preparaRigheEsportazione([spedizione], "carrai");

    expect(righe).toHaveLength(1);
    expect(righe[0].numero).toBe("");
    expect(righe[0].colli).toBe(1);
    expect(righe[0].peso).toBe(1);
  });

  it("usa il destinatario per accorpare righe Corriere A senza paziente", () => {
    const prima = spedizioneCorriereDemo();
    prima.id = "spedizione-1";
    prima.righe = [{ ...prima.righe[0], paziente: "", numero: "5078989" }];
    const seconda = spedizioneCorriereDemo();
    seconda.id = "spedizione-2";
    seconda.righe = [{ ...seconda.righe[1], paziente: "", numero: "5078990" }];

    const righe = preparaRigheEsportazione([prima, seconda], "carrai");

    expect(righe).toHaveLength(1);
    expect(righe[0].numero).toBe("5078989 + 5078990");
  });
});
