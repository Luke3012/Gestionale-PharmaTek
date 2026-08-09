import { describe, expect, it } from "vitest";
import type { BollettazioneMatch, BollettazioneRow } from "../../lib/tauri";
import {
  bollettazioneConfirmation,
  initialBollettazioneResolution,
  trattamentoBollettazioneLabel,
} from "./bollettazioneReview";

const match: BollettazioneMatch = {
  rowId: "row-1",
  orderId: "order-1",
  orderNumber: "2026-001",
  orderDate: "2026-08-03",
  patient: "Paziente",
  doctor: "Medico",
  productName: "Polimerizzato 1 fiala",
  score: 0.95,
  reason: "corrispondenza",
  expectedRowRevision: "row-revision",
  expectedOrderRevision: "order-revision",
  proposedFields: {
    numero: "GEST-001",
    prodotto_id: "product-1",
  },
  conflicts: [
    {
      field: "numero",
      label: "Numero lotto",
      current: "GEST-001",
      proposed: "LAB-001",
      blocking: false,
    },
  ],
};

const row = {
  reference: "LAB-001",
  status: "da_controllare",
  selectedMatch: match,
} as BollettazioneRow;

describe("revisione bollettazione", () => {
  it("mantiene il valore gestionale finché l'operatore non sceglie il file", () => {
    const resolution = initialBollettazioneResolution(row);
    expect(bollettazioneConfirmation(row, resolution)?.acceptedFields.numero).toBe(
      "GEST-001",
    );

    resolution.conflictChoices.numero = "file";
    expect(bollettazioneConfirmation(row, resolution)?.acceptedFields.numero).toBe(
      "LAB-001",
    );
  });

  it("non prepara una riga saltata", () => {
    const resolution = {
      ...initialBollettazioneResolution(row),
      skipped: true,
    };
    expect(bollettazioneConfirmation(row, resolution)).toBeNull();
  });

  it("nasconde il marcatore di mercato ITA dal trattamento", () => {
    expect(
      trattamentoBollettazioneLabel("BELTAORAL DUO Spray 2,2 (ITA)"),
    ).toBe("BELTAORAL DUO Spray 2,2");
    expect(trattamentoBollettazioneLabel("BELTAVAC 3")).toBe("BELTAVAC 3");
  });
});
