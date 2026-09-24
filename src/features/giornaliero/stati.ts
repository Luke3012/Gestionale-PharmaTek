// Stati dell'ordine (MODELLO-DATI). Ognuno ha colore e icona per il riconoscimento
// a colpo d'occhio. L'avanzamento automatico (acconto→produzione, spedito→…) è una
// direzione futura: dipende da contabilità (FASE 3) e spedizioni (FASE 4).
import {
  IconArchive,
  IconBan,
  IconCircleCheck,
  IconCircleDashed,
  IconHammer,
  IconPackageImport,
  IconTruckDelivery,
  type Icon,
} from "@tabler/icons-react";

export interface StatoDef {
  value: string;
  label: string;
  /** Etichetta breve per le viste strette (es. Giornaliero): «Arrivato» invece di
   * «Arrivato in Italia». Dove assente vale `label`. La Produzione usa sempre `label`. */
  labelBreve?: string;
  color: string;
  Ico: Icon;
}

export const STATI_ORDINE: StatoDef[] = [
  { value: "Nuovo", label: "Nuovo", color: "gray", Ico: IconCircleDashed },
  { value: "Confermato", label: "Confermato", color: "blue", Ico: IconCircleCheck },
  { value: "In produzione", label: "In produzione", color: "yellow", Ico: IconHammer },
  { value: "Arrivato IT", label: "Arrivato in Italia", labelBreve: "Arrivato", color: "cyan", Ico: IconPackageImport },
  { value: "Spedito", label: "Spedito", color: "indigo", Ico: IconTruckDelivery },
  { value: "Chiuso", label: "Chiuso", color: "dark", Ico: IconArchive },
  { value: "Rifiutato", label: "Rifiutato", color: "red", Ico: IconBan },
];

export function statoDef(stato: string): StatoDef {
  return STATI_ORDINE.find((s) => s.value === stato) ?? STATI_ORDINE[0];
}

// Stati che contano come "spedito" per il filtro Spediti/Non spediti (FASE 4E):
// l'ordine è uscito (incl. Chiuso, che è spedito + archiviato). Le spedizioni parziali
// non hanno più uno stato dedicato: l'ordine diventa Spedito solo a evasione completa.
const STATI_SPEDITI = new Set(["Spedito", "Chiuso"]);

/** L'ordine è (almeno parzialmente) spedito? Base del filtro Spediti/Non spediti. */
export function isSpedito(stato: string): boolean {
  return STATI_SPEDITI.has(stato);
}
