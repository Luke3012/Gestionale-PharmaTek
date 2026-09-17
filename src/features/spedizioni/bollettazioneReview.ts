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
      resolution.conflictChoices[conflict.field] === "file"
        ? conflict.proposed
        : conflict.current;
  }
  return fields;
}

export function bollettazioneConfirmation(
  row: BollettazioneRow,
  resolution: BollettazioneResolution,
): BollettazioneConfermaRiga | null {
  const match = resolution.match;
  if (!match || resolution.skipped) return null;
  return {
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
