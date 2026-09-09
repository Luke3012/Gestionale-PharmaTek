import type { RecordDto } from "../../lib/tauri";

export function gruppiRigheIncomplete<T extends { id: string }>(
  ordini: T[],
  righePerOrdine: ReadonlyMap<string, RecordDto[]>,
  incompleta: (riga: RecordDto) => boolean
) {
  return ordini
    .map((ordine) => ({ ordine, righe: (righePerOrdine.get(ordine.id) ?? []).filter(incompleta) }))
    .filter((gruppo) => gruppo.righe.length > 0);
}
