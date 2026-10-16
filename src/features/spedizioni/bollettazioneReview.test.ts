import { describe, expect, it } from "vitest";
import type { BollettazioneMatch, BollettazioneRow } from "../../lib/tauri";
import {
  bollettazioneActiveRows,
  bollettazioneProductGroups,
  bollettazioneProductKey,
  bollettazioneRowKey,
  bollettazioneReviewChanged,
  bollettazioneSelectedRowCounts,
  bollettazioneAcceptedFields,
  bollettazioneConflictIsOperational,
  bollettazioneConfirmation,
  bollettazioneReviewIssue,
  bollettazioneReviewConflicts,
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

describe("esclusioni prodotti e modifiche della revisione", () => {
  const makeRow = (reference: string, treatment: string, productFamily = "beltavac"): BollettazioneRow => ({
    ...row, source: "test.xlsx", sourceRow: Number(reference), reference, treatment, productFamily,
    status: "pronto", selectedMatch: { ...match, conflicts: [] }, alternatives: [], conflicts: [], quantityIssue: false,
  });
  it("raggruppa solo trattamenti importabili e accorpa spazi, accenti, maiuscole e suffisso mercato", () => {
    const rows = [makeRow("1", "BÉLTAVAC Polimerizado 3 (ITA)"), makeRow("2", "beltavac  polimerizado 3"),
      makeRow("3", "BELTAVAC Polimerizado PRO2 1 Vial"), makeRow("4", "BELTAORAL DUO 2,2", "beltaoral"),
      makeRow("5", "VEB Sublinguale 3,3", "veb"), makeRow("6", "Insolito", ""),
      { ...makeRow("7", "Solo registrato"), status: "gia_registrato" as const }];
    const groups = bollettazioneProductGroups(rows);
    expect(groups.map((group) => [group.label, group.variants.length])).toEqual([
      ["Polimerizzati", 2], ["Sublinguali", 1], ["Lisati", 1], ["Altri", 1],
    ]);
    expect(bollettazioneProductKey(rows[0])).toBe(bollettazioneProductKey(rows[1]));
    expect(bollettazioneProductKey(rows[0])).not.toBe(bollettazioneProductKey(rows[2]));
  });
  it("preserva formulazioni, dosaggi e varianti PRO", () => {
    const rows = ["VEB Spray 3,3", "VEB Sublinguale 3,3", "VEB Sublinguale 2,2"].map(
      (name, i) => makeRow(String(i), name, "veb"));
    expect(bollettazioneProductGroups(rows)[0].variants).toHaveLength(3);
  });
  it("esclude anche non trovati, conserva già registrati e recupera le risoluzioni alla reinclusione", () => {
    const a = makeRow("1", "BELTAVAC Polimerizado 3");
    const b = { ...makeRow("2", "BELTAORAL DUO", "beltaoral"), status: "non_trovato" as const };
    const c = { ...a, reference: "3", status: "gia_registrato" as const };
    const rows = [a, b, c];
    const resolutions = Object.fromEntries(rows.map((r) => [bollettazioneRowKey(r), initialBollettazioneResolution(r)]));
    const excluded = new Set([bollettazioneProductKey(b)]);
    const active = bollettazioneActiveRows(rows, excluded);
    const counts = bollettazioneSelectedRowCounts(active, resolutions);
    expect(active).toEqual([a, c]);
    expect(counts.get(match.rowId)).toBe(1);
    expect(active.flatMap((r) => bollettazioneConfirmation(r, resolutions[bollettazioneRowKey(r)], counts.get(match.rowId)) ?? [])).toHaveLength(1);
    expect(bollettazioneSelectedRowCounts(rows, resolutions).get(match.rowId)).toBe(2);
    expect(bollettazioneActiveRows(rows, new Set())).toEqual(rows);
    expect(resolutions[bollettazioneRowKey(b)].match).toBe(b.selectedMatch);
    expect(bollettazioneActiveRows(rows, new Set(rows.map(bollettazioneProductKey)))).toEqual([c]);
  });
  it("rivaluta i conflitti dopo reinclusione ed ignora le righe saltate nei duplicati", () => {
    const rows = [makeRow("1", "BELTAVAC 3"), makeRow("2", "BELTAORAL 2", "beltaoral")];
    const resolutions = Object.fromEntries(rows.map((r) => [bollettazioneRowKey(r), initialBollettazioneResolution(r)]));
    expect(bollettazioneReviewIssue(rows[0], resolutions[bollettazioneRowKey(rows[0])], 2)).toContain("più riferimenti");
    resolutions[bollettazioneRowKey(rows[1])].skipped = true;
    expect(bollettazioneSelectedRowCounts(rows, resolutions).get(match.rowId)).toBe(1);
  });
  it("rileva ogni modifica effettiva e torna pulito ripristinando lo stato iniziale", () => {
    const rows = [makeRow("1", "BELTAVAC 3")];
    const key = bollettazioneRowKey(rows[0]);
    const initial = initialBollettazioneResolution(rows[0]);
    const changed = (resolution = initial, excluded = new Set<string>(), date = "2026-10-16") =>
      bollettazioneReviewChanged(rows, { [key]: resolution }, excluded, date, "2026-10-16");
    expect(changed()).toBe(false);
    expect(changed({ ...initial, match: { ...initial.match!, rowId: "other" } })).toBe(true);
    expect(changed({ ...initial, confirmed: false })).toBe(true);
    expect(changed({ ...initial, skipped: true })).toBe(true);
    expect(changed({ ...initial, conflictChoices: { prodotto: "file" } })).toBe(true);
    expect(changed(initial, new Set(["excluded"]))).toBe(true);
    expect(changed(initial, new Set(), "2026-10-17")).toBe(true);
    expect(changed({ ...initial, match: { ...initial.match! }, conflictChoices: {} }, new Set())).toBe(false);
  });
});

describe("revisione bollettazione", () => {
  it("mantiene il valore gestionale finché l'operatore non sceglie il file", () => {
    const resolution = initialBollettazioneResolution(row);
    expect(bollettazioneAcceptedFields(resolution).numero).toBe(
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

    resolution.conflictChoices.prodotto = "file";
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
    resolution.conflictChoices.numero = "current";
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

describe("stato effettivo della revisione", () => {
  it.each(["current", "file"] as const)("una sola scelta %s aggiorna ID e nome prodotto insieme", (choice) => {
    const productMatch: BollettazioneMatch = {
      ...match,
      productName: "Polimerizzato 2 fiale",
      conflicts: [
        { field: "prodotto_id", label: "Prodotto", current: "standard", proposed: "pro", currentDisplay: "Polimerizzato 2 fiale", proposedDisplay: "Polimerizzato PRO", blocking: false },
        { field: "prodotto_nome", label: "Nome prodotto", current: "Polimerizzato 2 fiale", proposed: "Polimerizzato PRO", blocking: false },
      ],
    };
    const resolution = { ...initialBollettazioneResolution(row), match: productMatch };
    expect(bollettazioneReviewConflicts(productMatch)).toHaveLength(1);
    expect(bollettazioneReviewIssue(row, resolution)).not.toBeNull();
    resolution.conflictChoices.prodotto = choice;
    expect(bollettazioneReviewIssue(row, resolution)).toBeNull();
    expect(bollettazioneAcceptedFields(resolution)).toMatchObject(choice === "file"
      ? { prodotto_id: "pro", prodotto_nome: "Polimerizzato PRO" }
      : { prodotto_id: "standard", prodotto_nome: "Polimerizzato 2 fiale" });
  });

  it("il nome segue la scelta del prodotto anche senza un secondo conflitto", () => {
    const productMatch = { ...match, conflicts: [{ field: "prodotto_id", label: "Prodotto", current: "a", proposed: "b", currentDisplay: "Prodotto A", proposedDisplay: "Prodotto B", blocking: false }] };
    const resolution = { ...initialBollettazioneResolution(row), match: productMatch };
    resolution.conflictChoices.prodotto = "file";
    expect(bollettazioneAcceptedFields(resolution)).toMatchObject({ prodotto_id: "b", prodotto_nome: "Prodotto B" });
    resolution.conflictChoices.prodotto = "current";
    expect(bollettazioneAcceptedFields(resolution)).toMatchObject({ prodotto_id: "a", prodotto_nome: "Prodotto A" });
  });

  it.each(["current", "file"] as const)("la scelta %s completa la revisione senza un secondo Associa", (choice) => {
    const resolution = initialBollettazioneResolution(row);
    expect(bollettazioneReviewIssue(row, resolution)).toContain("ciascuna differenza");
    expect(bollettazioneConfirmation(row, resolution)).toBeNull();
    resolution.conflictChoices.numero = choice;
    expect(resolution.confirmed).toBe(false);
    expect(bollettazioneReviewIssue(row, resolution)).toBeNull();
    expect(bollettazioneConfirmation(row, resolution)?.acceptedFields.numero).toBe(choice === "file" ? "LAB-001" : "GEST-001");
  });

  it("non basta risolvere soltanto una delle differenze", () => {
    const resolution = initialBollettazioneResolution(row);
    resolution.match = { ...match, conflicts: [...match.conflicts, { ...match.conflicts[0], field: "prodotto_id" }] };
    resolution.conflictChoices.numero = "current";
    expect(bollettazioneReviewIssue(row, resolution)).toContain("ciascuna differenza");
  });

  it("mantiene i blocchi reali anche dopo le scelte", () => {
    const resolution = initialBollettazioneResolution(row);
    resolution.conflictChoices.numero = "file";
    expect(bollettazioneReviewIssue(row, resolution, 2)).toContain("più riferimenti");
    expect(bollettazioneConfirmation(row, resolution, 2)).toBeNull();
    expect(bollettazioneReviewIssue({ ...row, quantityIssue: true }, resolution)).toContain("quantità");
    expect(bollettazioneReviewIssue({ ...row, reason: "Duplicato reale", conflicts: [{ ...match.conflicts[0], blocking: true }] }, resolution)).toContain("Duplicato reale");
  });

  it("richiede Associa se non ci sono differenze e non usa scelte di un'altra associazione", () => {
    const resolution: ReturnType<typeof initialBollettazioneResolution> = { ...initialBollettazioneResolution(row), match: { ...match, conflicts: [] }, conflictChoices: {} };
    expect(bollettazioneReviewIssue(row, resolution)).toContain("Associa");
    resolution.confirmed = true;
    expect(bollettazioneReviewIssue(row, resolution)).toBeNull();
    resolution.match = match;
    expect(bollettazioneReviewIssue(row, resolution)).toContain("ciascuna differenza");
  });

  it("non include le righe già registrate o saltate", () => {
    const resolution = { ...initialBollettazioneResolution(row), confirmed: true };
    expect(bollettazioneConfirmation({ ...row, status: "gia_registrato" }, resolution)).toBeNull();
    expect(bollettazioneReviewIssue(row, { ...resolution, skipped: true }, 2)).toBeNull();
  });
});
