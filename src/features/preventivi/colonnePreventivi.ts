import { useMemo } from "react";
import { resetLarghezzeTabella } from "../../ui/Tabella";
import {
  normalizzaStatoColonne,
  useColonneConfigurabili,
} from "../../ui/colonneConfigurabili";

export const COLONNE_PREVENTIVI = [
  { key: "numeroPreventivo", label: "Preventivo", defaultVisible: true },
  { key: "creatoMs", label: "Data creazione", defaultVisible: true },
  { key: "clienteNome", label: "Cliente / destinatario", defaultVisible: true },
  { key: "agenteNome", label: "Agente", defaultVisible: true },
  { key: "prodotti", label: "Prodotti", defaultVisible: false },
  { key: "linee", label: "Linea", defaultVisible: true },
  { key: "ordineStato", label: "Stato", defaultVisible: false },
  { key: "totale", label: "Totale", defaultVisible: true },
  { key: "acconto", label: "Acconto", defaultVisible: false },
  { key: "email", label: "E-mail", defaultVisible: false },
  { key: "telefono", label: "Telefono", defaultVisible: false },
  { key: "spedizione", label: "Spedizione", defaultVisible: false },
  { key: "fatturazione", label: "Fatturazione", defaultVisible: false },
  { key: "ultimoInvioMs", label: "Stato invio", defaultVisible: true },
] as const;

export type ChiaveColonnaPreventivi = (typeof COLONNE_PREVENTIVI)[number]["key"];

const STORAGE = "pt.preventivi.colonne.v2";
const STORAGE_PRECEDENTE = "pt.preventivi.colonne.v1";
export const STORE_LARGHEZZE_PREVENTIVI = "preventivi-v2";

export interface StatoColonnePreventivi {
  ordine: ChiaveColonnaPreventivi[];
  nascoste: ChiaveColonnaPreventivi[];
}

export function normalizzaColonnePreventivi(salvato?: {
  ordine?: string[];
  nascoste?: string[];
}): StatoColonnePreventivi {
  return normalizzaStatoColonne(COLONNE_PREVENTIVI, salvato, {
    nascondiNuoveOpzionali: true,
    deduplicaNascoste: true,
  });
}

export function useColonnePreventivi() {
  const colonne = useColonneConfigurabili(COLONNE_PREVENTIVI, {
    storage: STORAGE,
    storagePrecedenti: [STORAGE_PRECEDENTE],
    normalizza: normalizzaColonnePreventivi,
    validaChiavi: true,
    onReset: resetColonnePreventivi,
  });
  const visibili = useMemo(
    () => colonne.visibili.map((colonna) => colonna.key),
    [colonne.visibili],
  );
  return {
    ...colonne,
    visibili,
  };
}

function resetColonnePreventivi(): void {
  resetLarghezzeTabella(STORE_LARGHEZZE_PREVENTIVI);
}
