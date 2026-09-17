import { describe, expect, it } from "vitest";
import type { BollettazioneMatch, BollettazioneRow } from "../../lib/tauri";
import {
  bollettazioneAcceptedFields,
  bollettazioneConflictIsOperational,
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

  it("preseleziona i conflitti non bloccanti senza sostituire il prodotto storico", () => {
    const productConflictMatch: BollettazioneMatch = {
      ...match,
      productName: "Polimerizzato 1 fiala",
      proposedFields: {
        ...match.proposedFields,
        prodotto_nome: "Polimerizzato 2 fiale",
      },
      conflicts: [
        {
          field: "prodotto_id",
          label: "Prodotto",
          current: "product-1",
          proposed: "product-2",
          currentDisplay: "Polimerizzato 1 fiala",
          proposedDisplay: "Polimerizzato 2 fiale",
          blocking: false,
        },
      ],
    };
    const reviewRow = {
      ...row,
      status: "da_controllare",
      reason: "I prodotti non corrispondono",
      selectedMatch: productConflictMatch,
    } as BollettazioneRow;
    const resolution = initialBollettazioneResolution(reviewRow);

    expect(resolution.confirmed).toBe(false);
    expect(resolution.match?.rowId).toBe("row-1");
    expect(bollettazioneAcceptedFields(resolution).prodotto_id).toBe("product-1");

    resolution.conflictChoices.prodotto_id = "file";
    expect(bollettazioneAcceptedFields(resolution).prodotto_id).toBe("product-2");
  });

  it("nasconde il marcatore di mercato ITA dal trattamento", () => {
    expect(
      trattamentoBollettazioneLabel("BELTAORAL DUO Spray 2,2 (ITA)"),
    ).toBe("BELTAORAL DUO Spray 2,2");
    expect(trattamentoBollettazioneLabel("BELTAVAC 3")).toBe("BELTAVAC 3");
  });

  it("invia il riferimento normalizzato lasciando visibile l'originale", () => {
    const normalizedRow = {
      ...row,
      reference: "5081348",
      rawReference: "0581348",
      referenceWarning: "Riferimento normalizzato: 0581348 → 5081348",
    } as BollettazioneRow;
    const resolution = initialBollettazioneResolution(normalizedRow);
    expect(bollettazioneConfirmation(normalizedRow, resolution)?.sourceReference).toBe(
      "5081348",
    );
    expect(normalizedRow.rawReference).toBe("0581348");
  });

  it("ignora i dettagli di produzione nella conferma della bollettazione", () => {
    const matchWithProductionDetails: BollettazioneMatch = {
      ...match,
      proposedFields: {
        ...match.proposedFields,
        formulazione: "spray",
        posologia: "2+2",
        allergeni: ["d.farinae"],
      },
      conflicts: [
        ...match.conflicts,
        {
          field: "formulazione",
          label: "Formulazione",
          current: "gocce",
          proposed: "spray",
          blocking: false,
        },
        {
          field: "posologia",
          label: "Posologia",
          current: "1+1",
          proposed: "2+2",
          blocking: false,
        },
        {
          field: "allergeni",
          label: "Allergeni / ceppi",
          current: ["parietaria"],
          proposed: ["d.farinae"],
          blocking: false,
        },
      ],
    };
    const resolution = initialBollettazioneResolution({
      ...row,
      selectedMatch: matchWithProductionDetails,
    } as BollettazioneRow);

    expect(bollettazioneAcceptedFields(resolution)).toEqual({
      numero: "GEST-001",
      prodotto_id: "product-1",
    });
    expect(bollettazioneConflictIsOperational("numero")).toBe(true);
    expect(bollettazioneConflictIsOperational("prodotto_id")).toBe(true);
    expect(bollettazioneConflictIsOperational("formulazione")).toBe(false);
    expect(bollettazioneConflictIsOperational("posologia")).toBe(false);
    expect(bollettazioneConflictIsOperational("allergeni")).toBe(false);
  });
});
