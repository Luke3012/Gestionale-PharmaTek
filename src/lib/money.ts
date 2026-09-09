const EURO = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

/** Formatta centesimi senza normalizzare valori non finiti o falsy. */
export function formattaEuroCentesimi(cents: number): string {
  return EURO.format(cents / 100);
}

export function formattaEuro(cents: number): string {
  return formattaEuroCentesimi(cents || 0);
}

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
