import type { Comunicazione } from "../../lib/tauri";

type BozzaAccodabile = Pick<Comunicazione, "id" | "stato">;

/** Accoda in sequenza soltanto gli stati che il backend considera ancora bozze. */
export async function accodaBozzeComunicazione(
  comunicazioni: BozzaAccodabile[],
  accoda: (id: string) => Promise<unknown>,
): Promise<void> {
  for (const comunicazione of comunicazioni) {
    if (
      comunicazione.stato === "bozza" ||
      comunicazione.stato === "da_revisionare"
    ) {
      await accoda(comunicazione.id);
    }
  }
}
