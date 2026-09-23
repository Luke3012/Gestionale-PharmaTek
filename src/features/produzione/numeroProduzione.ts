// Base condivisa della numerazione Laboratorio. Il default è 1; le letture non
// inizializzano record e non recuperano vecchie preferenze locali del PC.
import { api } from "../../lib/tauri";

const ENTITA = "impostazioni";
const ID = "__app__";
const CAMPO = "numero_produzione_base";

export async function leggiBaseProduzione(): Promise<number> {
  const rec = await api.recordGet(ENTITA, ID);
  const valore = rec?.data?.[CAMPO];
  return typeof valore === "number" && Number.isSafeInteger(valore) && valore >= 1
    ? valore
    : 1;
}

/** Confronta il valore letto prima della conferma con quello condiviso corrente. */
export async function salvaBaseProduzione(atteso: number, nuovo: number): Promise<void> {
  if (!Number.isSafeInteger(atteso) || atteso < 1 || !Number.isSafeInteger(nuovo) || nuovo < 1) {
    throw new Error("Inserisci un numero intero positivo.");
  }
  await api.salvaBaseProduzione(atteso, nuovo);
}
