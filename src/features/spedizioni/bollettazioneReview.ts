import type {
  BollettazioneConfermaRiga,
  BollettazioneMatch,
  BollettazioneRow,
} from "../../lib/tauri";

export interface BollettazioneResolution {
  match: BollettazioneMatch | null;
  skipped: boolean;
  confirmed: boolean;
  conflictChoices: Record<string, "current" | "file">;
}

export function bollettazioneRowKey(row: BollettazioneRow): string {
  return `${row.source}\u0000${row.sourceRow}\u0000${row.reference}`;
}

export function bollettazioneProductKey(row: BollettazioneRow): string {
  const treatment = trattamentoBollettazioneLabel(row.treatment)
    .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, "");
  return `${row.productFamily ?? ""}\u0000${treatment}`;
}

const PRODUCT_FAMILIES = [
  ["beltavac", "Polimerizzati"],
  ["beltaoral", "Sublinguali"],
  ["veb", "Lisati"],
  ["", "Altri"],
] as const;

export function bollettazioneProductGroups(rows: BollettazioneRow[]) {
  return PRODUCT_FAMILIES.map(([family, label]) => {
    const variants = new Map<string, string>();
    for (const row of rows) {
      if (row.status === "gia_registrato") continue;
      const rowFamily = PRODUCT_FAMILIES.some(([key]) => key === row.productFamily)
        ? row.productFamily : "";
      if (rowFamily !== family) continue;
      variants.set(bollettazioneProductKey(row),
        trattamentoBollettazioneLabel(row.treatment) || "Trattamento non indicato");
    }
    return { family, label, variants: Array.from(variants, ([key, name]) => ({ key, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label, "it")) };
  }).filter((group) => group.variants.length > 0);
}

/** Le esclusioni non alterano le risoluzioni: una reinclusione recupera le scelte. */
export function bollettazioneActiveRows(rows: BollettazioneRow[], excluded: ReadonlySet<string>) {
  return rows.filter((row) => row.status === "gia_registrato" || !excluded.has(bollettazioneProductKey(row)));
}

export function bollettazioneSelectedRowCounts(
  rows: BollettazioneRow[], resolutions: Record<string, BollettazioneResolution>,
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "gia_registrato") continue;
    const resolution = resolutions[bollettazioneRowKey(row)] ?? initialBollettazioneResolution(row);
    if (!resolution.match || resolution.skipped) continue;
    counts.set(resolution.match.rowId, (counts.get(resolution.match.rowId) ?? 0) + 1);
  }
  return counts;
}

export function bollettazioneReviewChanged(
  rows: BollettazioneRow[], resolutions: Record<string, BollettazioneResolution>,
  excluded: ReadonlySet<string>, arrivalDate: string, initialArrivalDate: string,
): boolean {
  if (excluded.size || arrivalDate !== initialArrivalDate) return true;
  return rows.some((row) => {
    const initial = initialBollettazioneResolution(row);
    const current = resolutions[bollettazioneRowKey(row)] ?? initial;
    return current.match?.rowId !== initial.match?.rowId
      || current.skipped !== initial.skipped || current.confirmed !== initial.confirmed
      || Object.keys(current.conflictChoices).some((key) => current.conflictChoices[key] !== initial.conflictChoices[key]);
  });
}

const BOLLETTAZIONE_OPERATIONAL_FIELDS = new Set([
  "numero",
  "prodotto_id",
  "prodotto_nome",
]);

export function bollettazioneConflictIsOperational(field: string): boolean {
  return BOLLETTAZIONE_OPERATIONAL_FIELDS.has(field);
}

export function initialBollettazioneResolution(
  row: BollettazioneRow,
): BollettazioneResolution {
  return {
    match: row.selectedMatch ?? null,
    skipped: false,
    confirmed: row.status === "pronto",
    conflictChoices: {},
  };
}

/** ID e nome descrivono un solo prodotto e richiedono una sola decisione. */
export function bollettazioneReviewConflicts(match: BollettazioneMatch) {
  const operational = match.conflicts.filter((conflict) =>
    bollettazioneConflictIsOperational(conflict.field),
  );
  const product = operational.find((conflict) => conflict.field === "prodotto_id")
    ?? operational.find((conflict) => conflict.field === "prodotto_nome");
  return operational.filter((conflict) => !conflict.field.startsWith("prodotto_")).concat(
    product ? [{ ...product, field: "prodotto", label: "Prodotto" }] : [],
  );
}

/** Unica valutazione usata dal riepilogo e dalla raccolta delle conferme. */
export function bollettazioneReviewIssue(
  row: BollettazioneRow,
  resolution: BollettazioneResolution,
  selectedRowCount = 1,
): string | null {
  if (row.status === "gia_registrato" || resolution.skipped) return null;
  if (row.quantityIssue) return "La quantità richiede più riferimenti: salta la riga e verifica il file.";
  const blocking = row.conflicts?.find(
    (conflict) => bollettazioneConflictIsOperational(conflict.field) && conflict.blocking,
  );
  if (blocking) return `${blocking.label}: ${row.reason}`;
  if (!resolution.match) return "Scegli una riga ordine oppure salta questa riga.";
  if (selectedRowCount > 1) return "La stessa riga ordine è associata a più riferimenti: cambia associazione o salta una riga.";
  if (row.reuseShippedReference && !resolution.confirmed) {
    return "Lotto già spedito: conferma la sostituzione con Associa oppure salta questa riga.";
  }
  const conflicts = bollettazioneReviewConflicts(resolution.match);
  if (conflicts.some((conflict) => !resolution.conflictChoices[conflict.field])) {
    return "Scegli quale valore mantenere per ciascuna differenza.";
  }
  // Le scelte esplicite completano anche la conferma dell'associazione preselezionata.
  if (row.status !== "pronto" && !resolution.confirmed && conflicts.length === 0) {
    return "Conferma l'associazione con Associa oppure salta questa riga.";
  }
  return null;
}

export function bollettazioneAcceptedFields(
  resolution: BollettazioneResolution,
): Record<string, unknown> {
  const match = resolution.match;
  if (!match) return {};
  const fields = Object.fromEntries(
    Object.entries(match.proposedFields).filter(([field]) =>
      bollettazioneConflictIsOperational(field),
    ),
  );
  for (const conflict of match.conflicts) {
    if (!bollettazioneConflictIsOperational(conflict.field)) continue;
    fields[conflict.field] =
      resolution.conflictChoices[conflict.field.startsWith("prodotto_") ? "prodotto" : conflict.field] === "file"
        ? conflict.proposed
        : conflict.current;
  }
  const productConflict = match.conflicts.find((conflict) => conflict.field === "prodotto_id");
  if (productConflict && !match.conflicts.some((conflict) => conflict.field === "prodotto_nome")) {
    // Anche quando il nome non genera un secondo conflitto, segue la scelta dell'ID.
    const name = resolution.conflictChoices.prodotto === "file"
      ? productConflict.proposedDisplay
      : productConflict.currentDisplay ?? match.productName;
    if (name) fields.prodotto_nome = name;
  }
  return fields;
}

export function bollettazioneConfirmation(
  row: BollettazioneRow,
  resolution: BollettazioneResolution,
  selectedRowCount = 1,
): BollettazioneConfermaRiga | null {
  const match = resolution.match;
  if (!match || resolution.skipped || row.status === "gia_registrato"
    || bollettazioneReviewIssue(row, resolution, selectedRowCount)) return null;
  return {
    ...(row.reuseShippedReference ? { reuseShippedReference: true } : {}),
    sourceReference: row.reference,
    rowId: match.rowId,
    orderId: match.orderId,
    expectedRowRevision: match.expectedRowRevision,
    expectedOrderRevision: match.expectedOrderRevision,
    acceptedFields: bollettazioneAcceptedFields(resolution),
  };
}

/** Il suffisso del tracciato laboratorio indica il mercato del listino, non fa
 * parte del nome del trattamento e non è utile all'operatore. */
export function trattamentoBollettazioneLabel(value: string): string {
  return value.replace(/\s*\(ITA\)\s*$/iu, "").trim();
}
