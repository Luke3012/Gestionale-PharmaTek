import { describe, expect, it } from "vitest";
import type { Spedizione } from "../../lib/tauri";
import { applicaDatiSpedizioneSalvati } from "./datiSpedizione";

describe("salvataggio logistico dopo aggiornamenti remoti", () => {
  it("preserva contabilità, note e composizione aggiornata senza ripristinare righe eliminate", () => {
    const precedente = {
      id: "s", lotto: "lotto", riepilogoFingerprint: "precedente", note: "vecchie",
      nRighe: 2, pagamenti: [{ id: "p", importo: 100, saldato: false }],
      righe: [{ rigaId: "r1", prezzo: 100, numero: "1" }, { rigaId: "rimossa", numero: "2" }],
    } as Spedizione;
    const attuale = {
      ...precedente, riepilogoFingerprint: "nuova", note: "nota remota", agenteNome: "Nuovo agente",
      contrassegno: 200, pagamenti: [{ id: "p", importo: 200, saldato: true }],
      righe: [{ rigaId: "r1", prezzo: 200, numero: "3" }, { rigaId: "aggiunta", prezzo: 50, numero: "4" }],
    } as Spedizione;
    const salvata = { ...precedente, indirizzo: "Nuovo indirizzo", colliExport: 3, pesoExport: 7,
      righe: precedente.righe.map((r) => ({ ...r, numero: "numero salvato" })),
    };
    const risultato = applicaDatiSpedizioneSalvati(attuale, salvata);
    expect(risultato.indirizzo).toBe("Nuovo indirizzo");
    expect([risultato.colliExport, risultato.pesoExport]).toEqual([3, 7]);
    expect(risultato.riepilogoFingerprint).toBe("nuova");
    expect(risultato.pagamenti).toBe(attuale.pagamenti);
    expect(risultato.note).toBe("nota remota");
    expect(risultato.agenteNome).toBe("Nuovo agente");
    expect(risultato.contrassegno).toBe(200);
    expect(risultato.numero).toBe("numero salvato + 4");
    expect(risultato.righe.map((r) => [r.rigaId, r.prezzo, r.numero])).toEqual([
      ["r1", 200, "numero salvato"], ["aggiunta", 50, "4"],
    ]);
  });
});
