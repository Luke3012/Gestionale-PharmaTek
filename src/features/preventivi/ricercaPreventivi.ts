import type { Preventivo } from "../../lib/tauri";

/**
 * Testo indicizzato condiviso da elenco preventivi, solleciti e ricerca globale.
 * Include il numero/lotto salvato sulla singola preparazione senza richiedere
 * caricamenti aggiuntivi: le righe sono gia presenti nel DTO del preventivo.
 */
export function testoRicercaPreventivo(preventivo: Preventivo): string {
  return [
    preventivo.numeroPreventivo,
    preventivo.ordineNumero,
    preventivo.clienteNome,
    preventivo.medicoNome,
    preventivo.agenteNome,
    preventivo.email,
    preventivo.telefono,
    preventivo.telefono?.replace(/\D/g, ""),
    ...preventivo.righe.flatMap((riga) => [
      riga.prodottoNome,
      riga.paziente,
      riga.formulazione,
      riga.posologia,
      riga.numero,
      riga.codice,
      riga.tipoTest,
      ...riga.allergeni,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("it");
}
