import { describe, expect, it } from "vitest";
import { dialogStore, type DialogAttivo } from "../../ui/dialog/store";
import { riallineaVociAperteLocali } from "./riallineaSaldo";
import {
  accontoPrevistoDopoModifica,
  calcolaAdeguamentoAltreRate,
  deveMostrareAdeguamentoImporto,
  chiediCoperturaScadenzario,
  type VoceCopertura,
} from "./coperturaScadenzario";

function rata(id: string, importo: number, scadenza: string): VoceCopertura {
  return { id, tipo: "rata", importo, saldato: false, scadenza };
}

describe("copertura dello scadenzario", () => {
  it("riconosce ogni discrepanza residua fra totale e scadenzario", () => {
    expect(deveMostrareAdeguamentoImporto({ totale: 10_000, coperto: 9_999 })).toBe(true);
    expect(deveMostrareAdeguamentoImporto({ totale: 10_000, coperto: 10_001 })).toBe(true);
    expect(deveMostrareAdeguamentoImporto({ totale: 0, coperto: 1_000 })).toBe(true);
    expect(deveMostrareAdeguamentoImporto({ totale: 10_000, coperto: 10_000 })).toBe(false);
    expect(deveMostrareAdeguamentoImporto({ totale: 0, coperto: 0 })).toBe(false);
  });

  it("mantiene soltanto le eccezioni contabili previste durante l'impostazione dei saldi", () => {
    expect(deveMostrareAdeguamentoImporto({
      totale: 10_000,
      coperto: 3_000,
      primoAccontoParziale: true,
    })).toBe(false);
    expect(deveMostrareAdeguamentoImporto({
      totale: 10_000,
      coperto: 13_000,
      incasso: { importo: 3_000, rimanenza: 4_000 },
    })).toBe(false);
    expect(deveMostrareAdeguamentoImporto({
      totale: 10_000,
      coperto: 15_000,
      incasso: { importo: 5_000, rimanenza: 4_000 },
    })).toBe(true);
  });

  it("saldando l'acconto modificato non chiede decisioni se resta entro il residuo", () => {
    expect(deveMostrareAdeguamentoImporto({
      totale: 30_000,
      // Gli altri importi possono essere ancora quelli persistiti: dopo l'incasso
      // verranno riallineati. Questo scarto non deve aprire il modale di dilazione.
      coperto: 32_500,
      incasso: { importo: 11_500, rimanenza: 30_000 },
    })).toBe(false);

    expect(
      riallineaVociAperteLocali(
        [
          { id: "acconto", tipo: "acconto" as const, importo: 11_500, saldato: true },
          rata("prima", 10_500, "2026-08-01"),
          rata("seconda", 10_500, "2026-09-01"),
        ],
        30_000
      ).map((voce) => [voce.id, voce.importo, voce.saldato])
    ).toEqual([
      ["acconto", 11_500, true],
      ["prima", 9_250, false],
      ["seconda", 9_250, false],
    ]);
  });

  it("mantiene la protezione sul vero sovrappagamento dell'acconto modificato", () => {
    expect(deveMostrareAdeguamentoImporto({
      totale: 30_000,
      coperto: 51_000,
      incasso: { importo: 31_000, rimanenza: 30_000 },
    })).toBe(true);
  });

  it("lascia lavorare l'automazione sul cambio prezzo e apre il modale solo se resta uno scarto", () => {
    const piano = riallineaVociAperteLocali(
      [
        { id: "incasso", tipo: "acconto" as const, importo: 1_000, saldato: true, scadenza: "" },
        rata("prima", 3_000, "2026-08-01"),
        rata("seconda", 6_000, "2026-09-01"),
      ],
      19_000
    );

    expect(piano.map((voce) => [voce.id, voce.importo])).toEqual([
      ["incasso", 1_000],
      ["prima", 6_000],
      ["seconda", 12_000],
    ]);
    expect(deveMostrareAdeguamentoImporto({
      totale: 19_000,
      coperto: piano.reduce((somma, voce) => somma + voce.importo, 0),
    })).toBe(false);
    expect(deveMostrareAdeguamentoImporto({ totale: 19_000, coperto: 1_000 })).toBe(true);
  });

  it("mantiene nel modale le azioni di adeguamento richieste dai due flussi", async () => {
    let attivo: DialogAttivo | null = null;
    const unsubscribe = dialogStore.subscribe((dialogo) => {
      attivo = dialogo;
    });
    try {
      const salvataggioOrdine = chiediCoperturaScadenzario({
        totale: 10_000,
        coperto: 9_000,
        puoDilazionare: true,
      });
      const dialogoOrdine = attivo as DialogAttivo | null;
      expect(dialogoOrdine?.titolo).toBe("Scadenzario incompleto");
      expect(dialogoOrdine?.bottoni.map((b) => b.label)).toEqual(expect.arrayContaining([
        "Adegua importo prodotti",
        "Dilaziona sulle rate",
        "Crea rata per il resto",
      ]));
      if (!dialogoOrdine) throw new Error("modale ordine non aperto");
      dialogStore.close(dialogoOrdine.id, null);
      await salvataggioOrdine;

      const adeguamentoRimborso = chiediCoperturaScadenzario({
        totale: 30_000,
        coperto: 50_500,
        rimborsoDaAdeguare: { importoAttuale: 22_000, importoDopo: 20_500 },
      });
      const dialogoRimborso = attivo as DialogAttivo | null;
      expect(dialogoRimborso?.bottoni.map((b) => b.label)).toContain("Adegua rimborso attuale");
      if (!dialogoRimborso) throw new Error("modale rimborso non aperto");
      dialogStore.close(dialogoRimborso.id, "rimborso");
      await expect(adeguamentoRimborso).resolves.toBe("rimborso");

      const incassoConRimborso = chiediCoperturaScadenzario({
        totale: 30_000,
        coperto: 50_500,
        incasso: {
          importo: 500,
          rimanenza: 0,
          rimborso: { importoAttuale: 20_000, importoDopo: 20_500, esistente: true },
        },
      });
      const dialogoIncassoConRimborso = attivo as DialogAttivo | null;
      expect(dialogoIncassoConRimborso?.bottoni.map((b) => b.label)).toContain(
        "Aggiorna il rimborso richiesto"
      );
      expect(dialogoIncassoConRimborso?.bottoni.map((b) => b.label)).not.toContain(
        "Correggi al residuo"
      );
      if (!dialogoIncassoConRimborso) throw new Error("modale incasso con rimborso non aperto");
      dialogStore.close(dialogoIncassoConRimborso.id, null);
      await incassoConRimborso;

      const saldoEccedente = chiediCoperturaScadenzario({
        totale: 10_000,
        coperto: 11_000,
        incasso: { importo: 5_000, rimanenza: 4_000 },
      });
      const dialogoSaldo = attivo as DialogAttivo | null;
      expect(dialogoSaldo?.titolo).toBe("Incasso superiore al residuo");
      expect(dialogoSaldo?.bottoni.map((b) => b.label)).toEqual(expect.arrayContaining([
        "Aumenta prezzo finale",
        "Mantieni e crea rimborso",
        "Correggi al residuo",
      ]));
      if (!dialogoSaldo) throw new Error("modale saldo non aperto");
      dialogStore.close(dialogoSaldo.id, null);
      await saldoEccedente;
    } finally {
      unsubscribe();
    }
  });

  it("mantiene la rata modificata e ripartisce il residuo su tutte le altre", () => {
    const piano = calcolaAdeguamentoAltreRate(
      [
        { id: "incassato", tipo: "acconto", importo: 2_000, saldato: true, scadenza: "" },
        rata("prima", 3_000, "2026-08-01"),
        rata("seconda", 2_000, "2026-09-01"),
        rata("modificata", 6_000, "2026-10-01"),
      ],
      "modificata",
      12_000
    );

    expect(piano).toEqual({
      aggiornamenti: [
        { id: "prima", importo: 2_400 },
        { id: "seconda", importo: 1_600 },
      ],
      eliminazioni: [],
    });
  });

  it("non propone la dilazione quando si modifica l'unica rata aperta", () => {
    expect(
      calcolaAdeguamentoAltreRate(
        [
          { id: "incassato", tipo: "acconto", importo: 2_000, saldato: true, scadenza: "" },
          rata("unica", 8_000, "2026-08-01"),
        ],
        "unica",
        10_000
      )
    ).toBeNull();
  });

  it("elimina le altre rate quando la rata modificata copre esattamente il totale", () => {
    const piano = calcolaAdeguamentoAltreRate(
      [rata("prima", 5_000, "2026-08-01"), rata("modificata", 10_000, "2026-09-01")],
      "modificata",
      10_000
    );
    expect(piano).toEqual({ aggiornamenti: [], eliminazioni: ["prima"] });
  });

  it("non consente adeguamenti che richiederebbero rate negative", () => {
    expect(
      calcolaAdeguamentoAltreRate(
        [rata("prima", 5_000, "2026-08-01"), rata("modificata", 11_000, "2026-09-01")],
        "modificata",
        10_000
      )
    ).toBeNull();
  });

  it("esclude sempre la voce nuova fittizia dal piano di aggiornamento", () => {
    const piano = calcolaAdeguamentoAltreRate(
      [rata("esistente", 8_000, "2026-08-01"), rata("__nuovo_pagamento__", 3_000, "2026-09-01")],
      "__nuovo_pagamento__",
      10_000
    );
    expect(piano).toEqual({
      aggiornamenti: [{ id: "esistente", importo: 7_000 }],
      eliminazioni: [],
    });
  });

  it("sincronizza l'acconto atteso con la testata ma non riscrive lo storico saldato", () => {
    expect(accontoPrevistoDopoModifica({
      tipoPrima: "acconto",
      saldatoPrima: false,
      tipoDopo: "acconto",
      importoDopo: 4_500,
    })).toBe(4_500);
    expect(accontoPrevistoDopoModifica({
      tipoPrima: "acconto",
      saldatoPrima: false,
      tipoDopo: "rata",
      importoDopo: 4_500,
    })).toBe(0);
    expect(accontoPrevistoDopoModifica({
      tipoPrima: "acconto",
      saldatoPrima: true,
      tipoDopo: "acconto",
      importoDopo: 4_500,
    })).toBeNull();
  });
});
