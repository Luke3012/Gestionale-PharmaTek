import type { RecordDto } from "../../lib/tauri";

export interface PreferenzeAccontoProdotti {
  soglia_prezzo: number;
  acconto_prezzo_basso: number;
  acconto_prezzo_alto: number;
}

export const PREFERENZE_ACCONTO_PRODOTTI_DEFAULT: PreferenzeAccontoProdotti = {
  soglia_prezzo: 30_000,
  acconto_prezzo_basso: 9_000,
  acconto_prezzo_alto: 11_500,
};

export interface RigaEconomicaOrdine {
  qta: number;
  prezzo: number;
  compilata: boolean;
}

/**
 * Regola unica per Giornaliero e Preventivi.
 *
 * Gli importi sono sempre in centesimi. La preferenza medico prevale
 * sull'agente; in assenza di override si applicano le soglie prodotto globali.
 */
export function accontoSuggeritoOrdine(args: {
  categoria: string;
  totale: number;
  righe: RigaEconomicaOrdine[];
  medico?: RecordDto | null;
  agente?: RecordDto | null;
  preferenze?: PreferenzeAccontoProdotti;
  saldoInteramenteAllaConsegna?: boolean;
}): number | null {
  const {
    categoria,
    totale,
    righe,
    medico,
    agente,
    preferenze = PREFERENZE_ACCONTO_PRODOTTI_DEFAULT,
    saldoInteramenteAllaConsegna = false,
  } = args;
  if (saldoInteramenteAllaConsegna) return null;
  if (totale <= 0) return 0;
  if (categoria === "Keriba") return totale;
  if (categoria === "Diagnostica") return 0;

  const numeroProdotti = righe.filter((riga) => riga.compilata).length;
  const accontoMedico = Number(medico?.data.acconto_default) || 0;
  const accontoAgente = Number(agente?.data.acconto_default) || 0;
  const override = accontoMedico || accontoAgente;
  if (override > 0) {
    return Math.min(override * numeroProdotti, totale);
  }

  const sommaRegola = righe.reduce((somma, riga) => {
    if (!riga.compilata) return somma;
    const quota =
      riga.prezzo >= preferenze.soglia_prezzo
        ? preferenze.acconto_prezzo_alto
        : preferenze.acconto_prezzo_basso;
    return somma + quota * Math.max(0, riga.qta || 0);
  }, 0);
  return Math.min(sommaRegola, totale);
}

export function preferenzeAccontoProdottiDaRecord(
  record: RecordDto | null | undefined,
): PreferenzeAccontoProdotti {
  return {
    soglia_prezzo:
      typeof record?.data.soglia_prezzo === "number"
        ? record.data.soglia_prezzo
        : PREFERENZE_ACCONTO_PRODOTTI_DEFAULT.soglia_prezzo,
    acconto_prezzo_basso:
      typeof record?.data.acconto_prezzo_basso === "number"
        ? record.data.acconto_prezzo_basso
        : PREFERENZE_ACCONTO_PRODOTTI_DEFAULT.acconto_prezzo_basso,
    acconto_prezzo_alto:
      typeof record?.data.acconto_prezzo_alto === "number"
        ? record.data.acconto_prezzo_alto
        : PREFERENZE_ACCONTO_PRODOTTI_DEFAULT.acconto_prezzo_alto,
  };
}
