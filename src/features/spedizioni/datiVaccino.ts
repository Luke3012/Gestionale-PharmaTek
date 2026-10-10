import type {
  OrdineDaSpedire,
  Spedizione,
  SpedizioneRiga,
} from "../../lib/tauri";

export function categoriaHaDatiVaccino(categoria: string | null | undefined): boolean {
  const normalizzata = (categoria ?? "").trim().toLocaleLowerCase("it");
  // Gli ordini legacy senza categoria precedono l'introduzione delle linee e sono
  // storicamente Immunoterapia; le categorie moderne devono invece essere esplicite.
  return normalizzata === "" || normalizzata === "immunoterapia";
}

export function ordineHaDatiVaccino(ordine: Pick<OrdineDaSpedire, "categoria">): boolean {
  return categoriaHaDatiVaccino(ordine.categoria);
}

export function rigaHaDatiVaccino(riga: Pick<SpedizioneRiga, "categoria">): boolean {
  return categoriaHaDatiVaccino(riga.categoria);
}

export function spedizioneHaDatiVaccino(
  spedizione: Pick<Spedizione, "righe">,
): boolean {
  return spedizione.righe.some(rigaHaDatiVaccino);
}

/** Colli effettivamente affidati al corriere: stesso valore del popover e della
 * distinta, default 1. Il numero di vaccini contenuti non aumenta il conteggio. */
export function colliSpedizioneEffettuata(
  spedizione: Pick<Spedizione, "colliExport">,
): number {
  return Math.max(1, spedizione.colliExport || 1);
}
