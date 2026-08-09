export function centsToEurStr(c: unknown): string {
  const n = typeof c === "number" ? c : 0;
  return (n / 100).toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function eurToCents(euro: number): number {
  return Math.round(euro * 100);
}
