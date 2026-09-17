import type { OrdineDto, RecordDto } from "../../lib/tauri";
import { dataEntroAnnoDiLavoro } from "../../lib/annoLavoro";
import { estremiPeriodoIso } from "../../lib/date";

export type PeriodoProduzione = "tutto" | "mese" | "scorso" | "custom";

export function estremiPeriodoProduzione(
  periodo: PeriodoProduzione,
  da: string,
  a: string,
  anno: number,
  oggi = new Date(),
): [string, string] | null {
  return periodo === "tutto"
    ? null
    : estremiPeriodoIso(periodo, da, a, anno, oggi);
}

export const statoProduzioneRiga = (riga: RecordDto): string =>
  (riga.data.stato_produzione as string) || "";

export const lottoProduzioneRiga = (riga: RecordDto): string =>
  (riga.data.lotto_produzione as string) || "";

export const rigaDaProdurre = (riga: RecordDto): boolean =>
  statoProduzioneRiga(riga) === "" && lottoProduzioneRiga(riga) === "";

export const rigaInLavorazione = (riga: RecordDto): boolean =>
  statoProduzioneRiga(riga) === "in_produzione" ||
  statoProduzioneRiga(riga) === "arrivato_it" ||
  lottoProduzioneRiga(riga) !== "";

export function ordineDiProduzione(ordine: OrdineDto): boolean {
  return (
    ordine.stato !== "Rifiutato" &&
    (ordine.linee.includes("Immunoterapia") || ordine.linee.includes("Diagnostica"))
  );
}

export function ordineDaProdurre(ordine: OrdineDto, righe: RecordDto[]): boolean {
  return (
    !["Spedito", "Chiuso", "Rifiutato"].includes(ordine.stato) &&
    (righe.length === 0 || righe.some(rigaDaProdurre))
  );
}

export function ordineInLavorazione(righe: RecordDto[]): boolean {
  return righe.some(rigaInLavorazione);
}

/** Regola condivisa da Produzione e Spotlight per gli ordini operativi ricercabili. */
export function ordineOperativoDiProduzione(
  ordine: OrdineDto,
  righe: RecordDto[],
  anno: number,
): boolean {
  return (
    ordineDiProduzione(ordine) &&
    dataEntroAnnoDiLavoro(ordine.data, anno) &&
    (ordineDaProdurre(ordine, righe) || ordineInLavorazione(righe))
  );
}

/** Variante leggera per chi usa `OrdineDto` senza caricare le righe (Spotlight). */
export function ordineOperativoDiProduzioneIndicizzato(
  ordine: OrdineDto,
  anno: number,
): boolean {
  return ordine.produzioneOperativa && dataEntroAnnoDiLavoro(ordine.data, anno);
}
