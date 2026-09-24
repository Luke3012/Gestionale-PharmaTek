// Aspetto delle categorie del changelog (etichetta, colore Mantine, icona). Condiviso
// tra il pannello «Novità» e lo storico nella finestra Info.
import { IconSparkles, IconBug, IconAdjustmentsHorizontal, type IconProps } from "@tabler/icons-react";
import type { Categoria, VoceChangelog } from "./changelog";

export interface CategoriaMeta {
  label: string;
  /** Colore Mantine (per badge/ThemeIcon). */
  color: string;
  Ico: React.ComponentType<IconProps>;
}

/** Ordine di presentazione: prima le novità, poi le correzioni, infine il resto. */
const ORDINE_CATEGORIE: Categoria[] = ["novita", "correzioni", "altro"];

export const CATEGORIE: Record<Categoria, CategoriaMeta> = {
  novita: { label: "Novità", color: "accent", Ico: IconSparkles },
  correzioni: { label: "Correzioni", color: "orange", Ico: IconBug },
  altro: { label: "Altro", color: "grape", Ico: IconAdjustmentsHorizontal },
};

export function vociPerCategoria(voci: VoceChangelog[]): Array<{ categoria: Categoria; voci: VoceChangelog[] }> {
  return ORDINE_CATEGORIE.map((categoria) => ({
    categoria,
    voci: voci.filter((v) => v.categoria === categoria),
  })).filter((gruppo) => gruppo.voci.length > 0);
}

/** Formatta una data ISO `yyyy-mm-dd` in italiano (es. «21 giugno 2026»). */
export function dataEstesa(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
}
