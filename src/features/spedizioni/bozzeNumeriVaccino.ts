import type { OrdineDaSpedire } from "../../lib/tauri";

/** Solo modifiche locali: anche una stringa vuota è una bozza esplicita. */
export type BozzeNumeriVaccino = ReadonlyMap<string, string>;

export function conservaBozzeNumeriVaccino(
  bozze: BozzeNumeriVaccino,
  ordini: OrdineDaSpedire[],
  precedenti: OrdineDaSpedire[] = [],
): BozzeNumeriVaccino {
  if (bozze.size === 0) return bozze;
  const numeriPrima = new Map(precedenti.flatMap((o) =>
    o.righe.map((r) => [r.rigaId, r.numero ?? ""] as const),
  ));
  const numeriOra = new Map(ordini.flatMap((o) =>
    o.righe.map((r) => [r.rigaId, r.numero ?? ""] as const),
  ));
  // Un refresh invariato conserva la bozza; una modifica salvata altrove prevale.
  const rimaste = new Map([...bozze].filter(([id]) =>
    numeriOra.has(id) && (!numeriPrima.has(id) || numeriPrima.get(id) === numeriOra.get(id)),
  ));
  return rimaste.size === bozze.size ? bozze : rimaste;
}

export function applicaBozzeNumeriVaccino(
  ordini: OrdineDaSpedire[],
  bozze: BozzeNumeriVaccino,
): OrdineDaSpedire[] {
  if (bozze.size === 0) return ordini;
  return ordini.map((ordine) => {
    if (!ordine.righe.some((r) => bozze.has(r.rigaId))) return ordine;
    return {
      ...ordine,
      righe: ordine.righe.map((r) =>
        bozze.has(r.rigaId) ? { ...r, numero: bozze.get(r.rigaId)! } : r,
      ),
    };
  });
}
