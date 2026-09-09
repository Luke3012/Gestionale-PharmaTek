import type { RataInput } from "../../lib/tauri";
import { dataIsoLocale, isoLocale } from "../../lib/date";
export {
  aggiungiGiorniDaOggiIso as aggiungiGiorniRate,
  oggiIso as dataLocaleOggi,
} from "../../lib/date";
import { èContoTransito } from "./contoPreferito";

export type CadenzaRate = "mensile" | "giorni";

export function numeroRateSaldoPredefinito(categoria: string, valore: unknown): number {
  if (categoria !== "Immunoterapia") return 1;
  const numero = typeof valore === "number" && Number.isFinite(valore) ? Math.floor(valore) : 1;
  return Math.min(60, Math.max(1, numero));
}

export function differenzaGiorni(dataIso1: string, dataIso2: string): number {
  if (!dataIso1 || !dataIso2) return 0;
  const d1 = dataIsoLocale(dataIso1);
  const d2 = dataIsoLocale(dataIso2);
  return Math.round((d1.getTime() - d2.getTime()) / 86_400_000);
}

export function offsetSpedizione(contoTipo?: string): number {
  return èContoTransito(contoTipo) ? 30 : 7;
}

function scadenzaRata(inizio: string, i: number, cadenza: CadenzaRate, giorni: number): string {
  if (!inizio) return "";
  const base = dataIsoLocale(inizio);
  if (cadenza === "mensile") {
    return isoLocale(new Date(base.getFullYear(), base.getMonth() + i, base.getDate(), 12, 0, 0));
  }
  return isoLocale(new Date(base.getTime() + i * giorni * 86_400_000));
}

export function calcolaRate(
  totaleCents: number,
  n: number,
  inizio: string,
  cadenza: CadenzaRate = "mensile",
  giorni = 30
): RataInput[] {
  if (!Number.isInteger(n) || n <= 0 || totaleCents <= 0) return [];
  const base = Math.floor(totaleCents / n);
  const resto = totaleCents - base * n;
  return Array.from({ length: n }, (_, i) => ({
    importo: base + (i === n - 1 ? resto : 0),
    scadenza: scadenzaRata(inizio, i, cadenza, giorni),
  }));
}
