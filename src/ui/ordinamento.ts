export type DirezioneOrdinamento = "asc" | "desc";
export type ValoreOrdinabile = string | number;

/** Ordina una copia senza mutare i dati sorgente, usando le regole comuni delle tabelle. */
export function ordinaCopia<T>(
  righe: readonly T[],
  valore: (riga: T) => ValoreOrdinabile,
  direzione: DirezioneOrdinamento,
  spareggio?: (a: T, b: T) => number,
): T[] {
  const ordinate = [...righe];
  ordinate.sort((a, b) => {
    const va = valore(a);
    const vb = valore(b);
    let confronto =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "it", { numeric: true });
    if (confronto === 0 && spareggio) confronto = spareggio(a, b);
    return direzione === "desc" ? -confronto : confronto;
  });
  return ordinate;
}
