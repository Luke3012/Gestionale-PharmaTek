import type { RecordDto } from "../../lib/tauri";

function numeroAssegnato(riga: RecordDto): number {
  const numero = riga.data.numero_produzione;
  return typeof numero === "number" && Number.isSafeInteger(numero) && numero > 0
    ? numero
    : 0;
}

/** Stesso punto di partenza dell'export: massimo globale o base condivisa meno uno. */
export function ultimoNumeroProduzione(righe: readonly RecordDto[], base: number): number {
  let ultimo = base - 1;
  for (const riga of righe) ultimo = Math.max(ultimo, numeroAssegnato(riga));
  return ultimo;
}

/** Riusa il numero di una riga già esportata; altrimenti assegna il successivo. */
export function numeriAnteprimaProduzione(
  righeAnteprima: readonly RecordDto[],
  ultimoGlobale: number,
): number[] {
  let ultimo = ultimoGlobale;
  return righeAnteprima.map((riga) => numeroAssegnato(riga) || ++ultimo);
}
