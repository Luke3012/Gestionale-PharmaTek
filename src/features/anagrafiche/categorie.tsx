import { IconLeaf, IconPackage, IconTestPipe, IconVaccine, type Icon } from "@tabler/icons-react";
import type { Opzione } from "./registri";

/** Categoria/linea di prodotto, con colore e icona per i badge e i titoli. */
export interface CategoriaProdotto extends Opzione {
  color: string;
  Ico: Icon;
}

export const CATEGORIE_PRODOTTO: CategoriaProdotto[] = [
  { value: "Immunoterapia", label: "Immunoterapia", color: "blue", Ico: IconVaccine },
  { value: "Diagnostica", label: "Diagnostica", color: "teal", Ico: IconTestPipe },
  { value: "Keriba", label: "Keriba", color: "grape", Ico: IconLeaf },
];

/** Definizione di una categoria (con fallback grigio + pacco per linee non note). */
export function categoriaDef(value: string): CategoriaProdotto {
  return (
    CATEGORIE_PRODOTTO.find((c) => c.value === value) ?? {
      value,
      label: value || "-",
      color: "gray",
      Ico: IconPackage,
    }
  );
}
