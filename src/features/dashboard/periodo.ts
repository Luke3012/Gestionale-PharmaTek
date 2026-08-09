// Periodi della dashboard (FASE 6B). I widget con mini-filtro hanno la propria
// finestra temporale; qui la convertiamo in `[dal, al]` (YYYY-MM-DD) per il backend.
import type { PeriodoDash } from "../../lib/prefs";

const ISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface Intervallo {
  dal: string | null;
  al: string | null;
}

/** Converte un periodo nella finestra `[dal, al]` (inclusiva) rispetto a oggi. */
export function intervalloPeriodo(p: PeriodoDash, oggi = new Date(), annoG = 0): Intervallo {
  const y = oggi.getFullYear();
  switch (p) {
    case "giorno":
      return { dal: ISO(oggi), al: ISO(oggi) };
    case "settimana": {
      // Settimana lun–dom (getDay: 0=dom).
      const g = oggi.getDay();
      const lun = new Date(oggi);
      lun.setDate(oggi.getDate() - ((g + 6) % 7));
      const dom = new Date(lun);
      dom.setDate(lun.getDate() + 6);
      return { dal: ISO(lun), al: ISO(dom) };
    }
    case "mese":
      return { dal: ISO(new Date(y, oggi.getMonth(), 1)), al: ISO(new Date(y, oggi.getMonth() + 1, 0)) };
    case "anno": {
      const a = annoG !== 0 ? annoG : y;
      return { dal: `${a}-01-01`, al: `${a}-12-31` };
    }
    case "tutto":
      return { dal: null, al: null };
  }
}

export const ETICHETTE_PERIODO: Record<PeriodoDash, string> = {
  giorno: "Giorno",
  settimana: "Settimana",
  mese: "Mese",
  anno: "Anno",
  tutto: "Tutto",
};

/** Frase descrittiva del periodo corrente (sottotitolo card/grafico). */
export function descrizionePeriodo(p: PeriodoDash, annoG = 0): string {
  switch (p) {
    case "giorno":
      return "oggi";
    case "settimana":
      return "questa settimana";
    case "mese":
      return "questo mese";
    case "anno":
      return `${annoG !== 0 ? annoG : new Date().getFullYear()}`;
    case "tutto":
      return "sempre";
  }
}

/** Opzioni per i mini-selettori (SegmentedControl/Select). */
export const OPZIONI_PERIODO: { value: PeriodoDash; label: string }[] = (
  ["giorno", "settimana", "mese", "anno", "tutto"] as PeriodoDash[]
).map((value) => ({ value, label: ETICHETTE_PERIODO[value] }));
