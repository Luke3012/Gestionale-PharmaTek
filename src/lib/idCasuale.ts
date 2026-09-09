/** ID per richieste UI: usa UUID quando disponibile e mantiene il fallback storico. */
export function creaIdCasuale(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
