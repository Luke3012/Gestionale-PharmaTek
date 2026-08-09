import type { RataInput } from "../../lib/tauri";

export type CadenzaRate = "mensile" | "giorni";

export function numeroRateSaldoPredefinito(categoria: string, valore: unknown): number {
  if (categoria !== "Immunoterapia") return 1;
  const numero = typeof valore === "number" && Number.isFinite(valore) ? Math.floor(valore) : 1;
  return Math.min(60, Math.max(1, numero));
}

export function dataLocaleOggi(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseData(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const g = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${g}`;
}

export function aggiungiGiorniRate(iso: string, giorni: number): string {
  const d = parseData(iso || dataLocaleOggi());
  d.setDate(d.getDate() + giorni);
  return toIso(d);
}

export function differenzaGiorni(dataIso1: string, dataIso2: string): number {
  if (!dataIso1 || !dataIso2) return 0;
  const d1 = parseData(dataIso1);
  const d2 = parseData(dataIso2);
  return Math.round((d1.getTime() - d2.getTime()) / 86_400_000);
}

export function offsetSpedizione(contoTipo?: string): number {
  return contoTipo === "contrassegno" || contoTipo === "assegno" ? 30 : 7;
}

function scadenzaRata(inizio: string, i: number, cadenza: CadenzaRate, giorni: number): string {
  if (!inizio) return "";
  const base = parseData(inizio);
  if (cadenza === "mensile") {
    return toIso(new Date(base.getFullYear(), base.getMonth() + i, base.getDate(), 12, 0, 0));
  }
  return toIso(new Date(base.getTime() + i * giorni * 86_400_000));
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
