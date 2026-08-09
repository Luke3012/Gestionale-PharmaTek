// Stati pagamento (dai colori della Legenda Excel). Lo stato effettivo è
// DERIVATO dai pagamenti (vedi backend), con override manuale per i casi che
// la derivazione non può dedurre (da_controllare, ecc.). Ognuno ha colore e
// icona per il riconoscimento a colpo d'occhio.
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconClockHour4,
  IconEye,
  IconGift,
  type Icon,
} from "@tabler/icons-react";

export interface StatoPagDef {
  value: string;
  label: string;
  color: string;
  Ico: Icon;
  /** Selezionabile come override manuale (gli altri sono solo derivati). */
  manuale: boolean;
}

export const STATI_PAGAMENTO: StatoPagDef[] = [
  { value: "da_saldare", label: "Da saldare", color: "red", Ico: IconAlertCircle, manuale: true },
  { value: "saldato", label: "Saldato", color: "teal", Ico: IconCircleCheck, manuale: true },
  { value: "saldato_da_verificare", label: "Da verificare", color: "lime", Ico: IconEye, manuale: true },
  { value: "da_controllare", label: "Da controllare", color: "orange", Ico: IconAlertTriangle, manuale: true },
  { value: "omaggio_sostituzione", label: "Omaggio / sostituzione", color: "cyan", Ico: IconGift, manuale: true },
  { value: "in_attesa_accredito", label: "In attesa accredito", color: "blue", Ico: IconClockHour4, manuale: true },
];

const DEF = new Map(STATI_PAGAMENTO.map((s) => [s.value, s]));

export function statoPagDef(value: string): StatoPagDef {
  return DEF.get(value) ?? STATI_PAGAMENTO[0];
}

// ---- Tipi di pagamento ----

export const TIPI_PAGAMENTO = [
  { value: "acconto", label: "Acconto" },
  { value: "saldo", label: "Saldo" },
  { value: "rata", label: "Rata" },
] as const;

export function tipoPagamentoLabel(value: string): string {
  return TIPI_PAGAMENTO.find((t) => t.value === value)?.label ?? value;
}
