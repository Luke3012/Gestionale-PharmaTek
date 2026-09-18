import { aggiungiGiorniIso, isoLocale } from "../../lib/date";

export interface PreventivoSollecitabile {
  ordineAttivo?: boolean;
  ordineData?: string;
  ordineStato: string;
  ordineMarcatore?: string;
  indicazioneInvio: string;
  ultimoInvioMs: number;
  ultimoSollecitoMs: number;
  creatoMs?: number;
  ultimaModificaMs?: number;
}

export type GruppoSollecitiPreventivi = "da_inviare" | "da_sollecitare";

export interface ClassificazioneSollecitiPreventivi<T> {
  daInviare: T[];
  daSollecitare: T[];
  totale: number;
}

export function classificaSollecitiPreventivi<T extends PreventivoSollecitabile>(
  preventivi: readonly T[],
  giorni: number,
  adessoMs = Date.now(),
): ClassificazioneSollecitiPreventivi<T> {
  const giorniNormalizzati = Math.max(0, Math.trunc(giorni) || 0);
  const oggi = isoLocale(new Date(adessoMs));
  const daInviare: T[] = [];
  const daSollecitare: T[] = [];

  for (const preventivo of preventivi) {
    // Solo ordini Nuovi e senza segnalazioni manuali attive (urgente, anomalia, sollecito)
    if (preventivo.ordineAttivo === false) continue;
    if (preventivo.ordineStato !== "Nuovo") continue;
    if (preventivo.ordineMarcatore && preventivo.ordineMarcatore.trim() !== "") {
      continue;
    }

    if (
      preventivo.indicazioneInvio === "mai_inviato" ||
      preventivo.indicazioneInvio === "modificato_dopo_invio"
    ) {
      const riferimento = Math.max(
        preventivo.ultimaModificaMs ?? 0,
        preventivo.creatoMs ?? 0,
      );
      const dataRiferimento = riferimento > 0
        ? isoLocale(new Date(riferimento))
        : preventivo.ordineData?.trim() ?? "";
      if (
        !dataRiferimento ||
        aggiungiGiorniIso(dataRiferimento, giorniNormalizzati) <= oggi
      ) {
        daInviare.push(preventivo);
      }
      continue;
    }
    if (
      preventivo.indicazioneInvio === "inviato" &&
      preventivo.ultimoInvioMs > 0 &&
      aggiungiGiorniIso(
        isoLocale(
          new Date(
            Math.max(preventivo.ultimoInvioMs, preventivo.ultimoSollecitoMs),
          ),
        ),
        giorniNormalizzati,
      ) <= oggi
    ) {
      daSollecitare.push(preventivo);
    }
  }

  return {
    daInviare,
    daSollecitare,
    totale: daInviare.length + daSollecitare.length,
  };
}
