import { describe, expect, it } from "vitest";
import { calcolaImportoSpedizione } from "./CreaSpedizioneModal";
import type { OrdineDaSpedire } from "../../lib/tauri";

function creaOrdine(patch: Partial<OrdineDaSpedire>): OrdineDaSpedire {
  return {
    ordineId: "ord-1",
    numero: "2026-0001",
    data: "2026-06-01",
    stato: "Confermato",
    clienteId: "cli-1",
    clienteNome: "Mario Rossi",
    medicoNome: "",
    agenteNome: "",
    indirizzo: "Via Roma 1",
    cap: "00100",
    citta: "Roma",
    prov: "RM",
    regione: "Lazio",
    telefono: "123456",
    email: "",
    noteSpedizione: "",
    colli: 1,
    categoria: "Immunoterapia",
    dataProduzione: "",
    acconto: 0,
    residuo: 45000,
    codMezzo: "contrassegno",
    codImporto: 22500,
    righe: [
      { rigaId: "r1", prodottoId: "p1", prodottoNome: "Vaccino 1", qta: 1, prezzo: 22500, paziente: "", numero: "" },
      { rigaId: "r2", prodottoId: "p2", prodottoNome: "Vaccino 2", qta: 1, prezzo: 22500, paziente: "", numero: "" },
    ],
    ...patch,
  };
}

describe("contrassegno spedizione", () => {
  it("calcolaImportoSpedizione calcola il valore merci meno quota acconto", () => {
    const o = creaOrdine({ acconto: 5000 });
    // Spedizione totale
    expect(calcolaImportoSpedizione([o], { r1: true, r2: true })).toBe(40000);
    // Spedizione parziale (1 sola riga da 225€)
    expect(calcolaImportoSpedizione([o], { r1: true, r2: false })).toBe(20000);
  });

  it("la logica di default del collo seleziona codImporto della rata anziché l'intero totale", () => {
    const o = creaOrdine({ residuo: 45000, codImporto: 22500 });
    const righeCheck = { r1: true, r2: true };

    const calcolaCents = (ordini: OrdineDaSpedire[], checks: Record<string, boolean>) =>
      ordini.reduce((tot, ord) => {
        if (ord.codImporto && ord.codImporto > 0) return tot + ord.codImporto;
        if (ord.residuo && ord.residuo > 0) return tot + ord.residuo;
        return tot + calcolaImportoSpedizione([ord], checks);
      }, 0);

    // Con codImporto impostato a 225€, il contrassegno è 225€ (non 450€)
    expect(calcolaCents([o], righeCheck)).toBe(22500);

    // Anche deselezionando una riga (spedizione parziale), mantiene la rata individuata
    const righeCheckParziale = { r1: true, r2: false };
    expect(calcolaCents([o], righeCheckParziale)).toBe(22500);
  });

  it("somma le rate di contrassegno se più ordini con COD sono uniti nello stesso collo", () => {
    const o1 = creaOrdine({ ordineId: "ord-1", codImporto: 22500 });
    const o2 = creaOrdine({ ordineId: "ord-2", codImporto: 13000 });

    const calcolaCents = (ordini: OrdineDaSpedire[]) =>
      ordini.reduce((tot, ord) => {
        if (ord.codImporto && ord.codImporto > 0) return tot + ord.codImporto;
        if (ord.residuo && ord.residuo > 0) return tot + ord.residuo;
        return tot;
      }, 0);

    expect(calcolaCents([o1, o2])).toBe(35500);
  });
});
