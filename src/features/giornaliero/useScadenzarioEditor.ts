import { useCallback, useMemo, useState } from "react";
import type { RecordDto } from "../../lib/tauri";
import { api } from "../../lib/tauri";
import {
  èContoTransito,
  opzioniConti,
  opzioniContiConTransito,
} from "../contabilita/contoPreferito";
import type { PagamentoModalTarget } from "../contabilita/PagamentoModal";
import type { RateizzaTarget } from "../contabilita/RateizzaModal";

export interface UseScadenzarioEditorOptions {
  conti: RecordDto[];
  categoria: string;
  totale: number;
  onCodTuttoAttivato?: () => void;
  onCodTuttoDisattivato?: () => void;
}

export function calcolaValoreToggleCod(
  attivoCorrente: boolean,
  categoria: string,
  totale: number,
): { prossimoCod: boolean; prossimoAcconto: number | "" } {
  const prossimoCod = !attivoCorrente;
  if (prossimoCod) {
    return { prossimoCod, prossimoAcconto: "" };
  }
  return {
    prossimoCod,
    prossimoAcconto: categoria === "Keriba" ? (totale > 0 ? totale / 100 : "") : "",
  };
}

export function useScadenzarioEditor({
  conti,
  categoria,
  totale,
  onCodTuttoAttivato,
  onCodTuttoDisattivato,
}: UseScadenzarioEditorOptions) {
  const [codTutto, setCodTutto] = useState(false);
  const [pagTarget, setPagTarget] = useState<PagamentoModalTarget | null>(null);
  const [rateizzaTarget, setRateizzaTarget] = useState<RateizzaTarget | null>(null);

  const contrassegnoContoId = useMemo(
    () => conti.find((c) => èContoTransito(c.data.tipo))?.id || "",
    [conti],
  );

  const optionsConti = useMemo(() => opzioniContiConTransito(conti), [conti]);

  const optionsContiAcconto = useMemo(
    () => opzioniConti(conti.filter((c) => !èContoTransito(c.data.tipo))),
    [conti],
  );

  const toggleCod = useCallback(
    (impostaAcconto?: (valore: number | "") => void) => {
      setCodTutto((v) => {
        const { prossimoCod, prossimoAcconto } = calcolaValoreToggleCod(
          v,
          categoria,
          totale,
        );
        if (impostaAcconto) {
          impostaAcconto(prossimoAcconto);
        }
        if (prossimoCod) {
          onCodTuttoAttivato?.();
        } else {
          onCodTuttoDisattivato?.();
        }
        return prossimoCod;
      });
    },
    [categoria, onCodTuttoAttivato, onCodTuttoDisattivato, totale],
  );

  return {
    codTutto,
    setCodTutto,
    toggleCod,
    pagTarget,
    setPagTarget,
    rateizzaTarget,
    setRateizzaTarget,
    contrassegnoContoId,
    optionsConti,
    optionsContiAcconto,
  };
}

/**
 * Calcola la distanza progressiva in giorni dalla prima spedizione (+0, +30, +60, +90...).
 * Se la riga possiede già un rel valido e maggiore di zero, viene conservato.
 */
export function calcolaScadRelGiorni(
  idxSpediz: number,
  offsetBase: number,
  relEsistente?: number,
): number {
  return relEsistente !== undefined && relEsistente > 0
    ? relEsistente
    : (offsetBase + (idxSpediz >= 0 ? idxSpediz : 0)) * 30;
}

/**
 * Persiste la configurazione "Salda tutto alla consegna":
 * rimuove eventuali acconti attesi e rate aperte superflue,
 * impostando un unico saldo in contrassegno collegato alla spedizione.
 */
export async function persistiCodTutto(
  ordineId: string,
  totale: number,
  contrassegnoContoId: string,
): Promise<void> {
  let pagamenti = await api.pagamentiOrdine(ordineId);
  const accontoAtteso = pagamenti.find((p) => p.tipo === "acconto" && !p.saldato);
  if (accontoAtteso) {
    await api.pagamentoElimina(accontoAtteso.id);
  }
  const rateAperte = pagamenti.filter((p) => p.tipo === "rata" && !p.saldato);
  for (const r of rateAperte) {
    await api.pagamentoElimina(r.id);
  }
  pagamenti = await api.pagamentiOrdine(ordineId);
  const saldoAtteso = pagamenti.find((p) => p.tipo === "saldo" && !p.saldato);
  if (saldoAtteso) {
    await api.recordUpdate("pagamento", saldoAtteso.id, {
      conto_id: contrassegnoContoId,
      importo: totale,
      scad_da_spedizione: true,
      scad_rel_giorni: 0,
      scadenza: "",
    });
  } else {
    const pag = await api.pagamentoRegistra({
      ordineId,
      tipo: "saldo",
      importo: totale,
      saldato: false,
      scadenza: "",
      contoId: contrassegnoContoId,
      data: "",
      verificato: false,
    });
    await api.recordUpdate("pagamento", pag.id, {
      scad_da_spedizione: true,
      scad_rel_giorni: 0,
    });
  }
}
