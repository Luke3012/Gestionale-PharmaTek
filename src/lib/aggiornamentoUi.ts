import type { ProgressoAggiornamento } from "../updater";

/** Titolo uniforme mostrato durante le diverse fasi di installazione. */
export function titoloProgressoAggiornamento(
  fase: ProgressoAggiornamento["fase"],
): string {
  if (fase === "scarico") return "Scarico l'aggiornamento";
  if (fase === "installo") return "Installo l'aggiornamento";
  if (fase === "riavvio") return "Riavvio in corso";
  return "Aggiornamento in corso";
}
