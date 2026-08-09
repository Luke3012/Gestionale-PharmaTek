import { formattaDataItaliana } from "../../lib/date";
import type { Spedizione } from "../../lib/tauri";

/** Relazione condivisa ordine → lotti di spedizione, usata da Crediti e Giornaliero. */
export function mappaLottiPerOrdine(spedizioni: Spedizione[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const spedizione of spedizioni) {
    for (const riga of spedizione.righe) {
      const lotti = map.get(riga.ordineId) ?? new Set<string>();
      lotti.add(spedizione.lotto);
      map.set(riga.ordineId, lotti);
    }
  }
  return map;
}

/** Opzioni leggibili dei lotti, con la stessa etichetta in tutti i filtri. */
export function opzioniLottiSpedizione(spedizioni: Spedizione[], anno: number) {
  const gruppi = new Map<string, { data: string; corrieri: Set<string>; colli: number }>();
  for (const spedizione of spedizioni) {
    if (anno !== 0 && Number(spedizione.data.slice(0, 4)) !== anno) continue;
    const gruppo = gruppi.get(spedizione.lotto) ?? {
      data: spedizione.data,
      corrieri: new Set<string>(),
      colli: 0,
    };
    if (spedizione.corriereNome) gruppo.corrieri.add(spedizione.corriereNome);
    gruppo.colli += Math.max(1, spedizione.colli || 0);
    gruppi.set(spedizione.lotto, gruppo);
  }
  return [...gruppi.entries()]
    .sort((a, b) => b[1].data.localeCompare(a[1].data) || b[0].localeCompare(a[0]))
    .map(([lotto, gruppo]) => ({
      value: lotto,
      label: `${formattaDataItaliana(gruppo.data)} · ${[...gruppo.corrieri].join(" / ") || "Spedizione"} · ${gruppo.colli} ${gruppo.colli === 1 ? "collo" : "colli"}`,
    }));
}
