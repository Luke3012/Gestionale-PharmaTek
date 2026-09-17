import { api, type Preventivo } from "../../lib/tauri";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";

/**
 * Propone la marcatura soltanto dopo un'esportazione file riuscita.
 * Restituisce il DTO aggiornato, così ogni vista può riallineare il proprio stato
 * senza introdurre ricaricamenti o una seconda implementazione del flusso.
 */
export async function confermaInvioManualeDopoEsportazione(
  preventivo: Preventivo,
): Promise<Preventivo | null> {
  if (preventivo.indicazioneInvio === "inviato") return null;
  const confermato = await dialog.confirm(
    "Contrassegnare come inviato?",
    "Vuoi segnare questo preventivo come inviato manualmente al cliente? In questo modo verranno programmati i solleciti di risposta dopo i giorni stabiliti.",
    { conferma: "Segna come inviato", annulla: "Non ora" },
  );
  if (!confermato) return null;

  try {
    const aggiornato = await api.preventivoMarcaInviatoManuale(
      preventivo.ordineId,
      preventivo.revision,
    );
    toast.success("Preventivo contrassegnato come inviato.");
    return aggiornato;
  } catch (error) {
    toast.error(`Impossibile contrassegnare come inviato: ${error}`);
    return null;
  }
}
