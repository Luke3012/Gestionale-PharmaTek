import { describe, expect, it } from "vitest";
import type { Spedizione } from "../../lib/tauri";
import {
  colonneProfilo,
  formattaNumeriLottoPerExport,
  normalizzaColliPesoCorriere,
  preparaRigheEsportazione,
} from "./profiliCorriere";

function spedizioneCorriereA(): Spedizione {
  return {
    id: "spedizione",
    lotto: "lotto",
    data: "2026-07-14",
    corriereId: "corriere_a",
    corriereNome: "CORRIERE_A",
    corriereProfilo: "corriere_a",
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
  it("mantiene ordine ed etichette dei profili di esportazione", () => {
    expect(colonneProfilo("gls").map((colonna) => colonna.label)).toEqual([
      "Data Fattura", "Num fattura", "Cliente", "Ind Dest", "Cap", "Città",
      "Provincia", "REGIONE", "Colli", "Peso", "telefono", "€", "NOTE",
      "E-mail", "Servizi",
    ]);
    expect(colonneProfilo("mbe").map((colonna) => colonna.label)).toEqual([
      "Data distinta", "Lotto", "Cliente", "Ind Dest", "Cap", "Città",
      "Provincia", "Colli", "Peso", "telefono", "email",
      "PREAVVISO TELEFONICO", "CONTRASSEGNO",
    ]);
  });

  it("mantiene tutti i lotti per quantità in una singola cella compatibile", () => {
    expect(formattaNumeriLottoPerExport("5078989\n5078990")).toBe("5078989 + 5078990");
  });

  it("ignora righe vuote senza generare separatori doppi", () => {
    expect(formattaNumeriLottoPerExport("LOT-1\n\n LOT-3 ")).toBe("LOT-1 + LOT-3");
  });

  it("mantiene sempre colli e peso a 1 per Corriere A", () => {
    expect(normalizzaColliPesoCorriere("corriere_a", 8, 12)).toEqual({ colli: 1, peso: 1 });
    expect(normalizzaColliPesoCorriere("gls", 8, 12)).toEqual({ colli: 8, peso: 12 });
  });

  it("raggruppa in una singola riga Corriere A tutti i lotti del collo, senza separare per paziente", () => {
    const righe = preparaRigheEsportazione([spedizioneCorriereA()], "corriere_a");

    expect(righe).toHaveLength(1);
    expect(righe[0].numero).toBe("LOT-1 + LOT-2 + LOT-3");
    expect(righe[0].colli).toBe(1);
    expect(righe[0].peso).toBe(1);
  });

  it("mantiene righe distinte per colli Corriere A distinti anche se per lo stesso destinatario", () => {
    const prima = spedizioneCorriereA();
    prima.id = "spedizione-1";
    prima.righe = [{ ...prima.righe[0], numero: "5078989" }];
    const seconda = spedizioneCorriereA();
    seconda.id = "spedizione-2";
    seconda.righe = [{ ...seconda.righe[1], numero: "5078990" }];

    const righe = preparaRigheEsportazione([prima, seconda], "corriere_a");

    expect(righe).toHaveLength(2);
    expect(righe[0].numero).toBe("5078989");
    expect(righe[1].numero).toBe("5078990");
    expect(righe.every((riga) => riga.colli === 1 && riga.peso === 1)).toBe(true);
  });

  it("mantiene la riga Corriere A del collo anche quando non ha numeri lotto", () => {
    const spedizione = spedizioneCorriereA();
    spedizione.righe = spedizione.righe.slice(0, 2).map((riga) => ({ ...riga, numero: "" }));
    spedizione.numero = "";

    const righe = preparaRigheEsportazione([spedizione], "corriere_a");

    expect(righe).toHaveLength(1);
    expect(righe[0].numero).toBe("");
    expect(righe[0].colli).toBe(1);
    expect(righe[0].peso).toBe(1);
  });

  it("usa il numero aggregato come fallback se le righe esistono ma non hanno numeri", () => {
    const spedizione = spedizioneCorriereA();
    spedizione.righe = spedizione.righe.map((riga) => ({ ...riga, numero: "  \n " }));
    spedizione.numero = "5081999\n5081997\n5081999\n5081998";

    const righe = preparaRigheEsportazione([spedizione], "corriere_a");

    expect(righe).toHaveLength(1);
    expect(righe[0].numero).toBe("5081997 + 5081998 + 5081999");
  });

  it("non modifica il formato aggregato fornito a CORRIERE_B e CORRIERE_C", () => {
    const spedizione = spedizioneCorriereA();
    spedizione.numero = "5081997/8/9";

    expect(preparaRigheEsportazione([spedizione], "gls")[0].numero).toBe("5081997/8/9");
    expect(preparaRigheEsportazione([spedizione], "mbe")[0].numero).toBe("5081997/8/9");
    expect(preparaRigheEsportazione([spedizione], "gls")[0].colli).toBe(3);
    expect(preparaRigheEsportazione([spedizione], "mbe")[0].peso).toBe(3);
  });

  it.each(["gls", "mbe"])("%s unisce i colli dello stesso indirizzo e somma i dati logistici", (profilo) => {
    const prima = spedizioneCorriereA();
    prima.id = "spedizione-1";
    prima.corriereProfilo = profilo;
    prima.corriereId = profilo;
    prima.corriereNome = profilo.toUpperCase();
    prima.indirizzo = "VIA ANGELO POLIZIANO 60";
    prima.citta = "Fonte Nuova";
    prima.cap = "00013";
    prima.righe = [{ ...prima.righe[0], numero: "5081997" }];
    prima.numero = "5081997";
    prima.colli = 2;
    prima.peso = 3;
    prima.mezzo = "contrassegno";
    prima.contrassegno = 1200;
    prima.note = "Citofonare";

    const seconda = spedizioneCorriereA();
    seconda.id = "spedizione-2";
    seconda.corriereProfilo = profilo;
    seconda.corriereId = profilo;
    seconda.corriereNome = profilo.toUpperCase();
    seconda.clienteId = "altro-cliente";
    seconda.clienteNome = "Altro destinatario";
    seconda.indirizzo = "Via Poliziano, 60";
    seconda.citta = "Fonte Nuova";
    seconda.cap = "00013";
    seconda.righe = [{ ...seconda.righe[1], numero: "5081998" }];
    seconda.numero = "5081998";
    seconda.colli = 1;
    seconda.peso = 2;
    seconda.mezzo = "contrassegno";
    seconda.contrassegno = 800;
    seconda.note = "Citofonare";

    const righe = preparaRigheEsportazione([prima, seconda], profilo);

    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatchObject({
      numero: "5081997/8",
      cliente: "Destinatario",
      colli: 3,
      peso: 5,
      importo: 2000,
      note: "Citofonare",
    });
  });

  it.each(["gls", "mbe"])("%s lascia separate date, corrieri e indirizzi distinti", (profilo) => {
    const base = spedizioneCorriereA();
    base.corriereProfilo = profilo;
    base.corriereId = profilo;
    base.numero = "5081997";
    const civicoDiverso = { ...base, id: "civico", indirizzo: "Via Roma 2", numero: "5081998" };
    const altroGiorno = { ...base, id: "giorno", data: "2026-07-15", numero: "5081999" };
    const altroCorriere = { ...base, id: "corriere", corriereId: "altro", numero: "5082000" };
    const senzaIndirizzo = { ...base, id: "vuoto", indirizzo: "", numero: "5082001" };

    expect(preparaRigheEsportazione([base, civicoDiverso, altroGiorno, altroCorriere, senzaIndirizzo], profilo)).toHaveLength(5);
  });

  it("ordina i lotti in modo naturale crescente e rimuove duplicati", () => {
    const spedizione = spedizioneCorriereA();
    spedizione.righe = [
      { ...spedizione.righe[0], paziente: "Sofia Turturo", numero: "5081997" },
      { ...spedizione.righe[1], paziente: "Mattia Turturo", numero: "5081999" },
      { ...spedizione.righe[2], paziente: "Mattia Turturo", numero: "5081998" },
      { ...spedizione.righe[0], rigaId: "r4", paziente: "Mattia Turturo", numero: "5081997" },
    ];

    const righe = preparaRigheEsportazione([spedizione], "corriere_a");

    expect(righe).toHaveLength(1);
    expect(righe[0].numero).toBe("5081997 + 5081998 + 5081999");
  });
});
