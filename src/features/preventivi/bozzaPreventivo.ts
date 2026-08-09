import type { RigaForm } from "../giornaliero/righeOrdine";

/** Dati mantenuti soltanto nel renderer finché l'utente non conferma
 *  "Salva e visualizza". Non corrispondono ancora a un ordine sincronizzato. */
export interface BozzaPreventivoDaZero {
  data: string;
  linea: string;
  clienteId: string;
  medicoId: string;
  agenteId: string;
  note: string;
  righe: RigaForm[];
}
