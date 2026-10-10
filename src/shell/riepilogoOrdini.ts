import { dataNellAnno } from "../lib/annoLavoro";
import type { OrdineDto } from "../lib/tauri";

/** Il cliente mostra il lavoro e lo storico dell'anno solare corrente.
 * Medici e agenti conservano la coda operativa senza limite di anno. */
export function ordiniPerRiepilogo<T extends Pick<OrdineDto, "data" | "stato">>(ordini: T[], annoCliente?: number) {
  const dellAnno = annoCliente === undefined
    ? ordini
    : ordini.filter((ordine) => dataNellAnno(ordine.data, annoCliente));
  const recentiPrima = (a: T, b: T) => b.data.localeCompare(a.data);
  return {
    inAttesa: dellAnno.filter((ordine) => ordine.stato !== "Chiuso" && ordine.stato !== "Rifiutato").sort(recentiPrima),
    chiusi: annoCliente === undefined ? [] : dellAnno.filter((ordine) => ordine.stato === "Chiuso").sort(recentiPrima),
  };
}
