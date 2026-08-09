// Marcatori di triage dell'ordine (FASE 4E): una segnalazione manuale, mostrata
// sotto lo stato. NON sono i vecchi simboli !/?/ok dell'Excel (servivano solo per
// cercare): qui sono due stati chiari. I messaggi/incident veri → FASE 6.
import { IconAlertTriangle, IconFlagFilled, IconClockExclamation, type Icon } from "@tabler/icons-react";

export interface MarcatoreDef {
  value: string;
  label: string;
  color: string;
  Ico: Icon;
}

export const MARCATORI: MarcatoreDef[] = [
  { value: "urgente", label: "Urgente", color: "red", Ico: IconFlagFilled },
  { value: "anomalia", label: "Anomalia", color: "yellow", Ico: IconAlertTriangle },
  { value: "sollecito", label: "Da sollecitare", color: "orange", Ico: IconClockExclamation },
];

/** Definizione di un marcatore, o `null` se nessuno/sconosciuto. */
export function marcatoreDef(value: string): MarcatoreDef | null {
  return MARCATORI.find((m) => m.value === value) ?? null;
}
