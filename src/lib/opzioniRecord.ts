import type { RecordDto } from "./tauri";

export function opzioniRecordNome(
  records: Array<Pick<RecordDto, "id" | "data">>,
  fallback = "(senza nome)",
) {
  return records.map((record) => ({
    value: record.id,
    label: (record.data.nome as string) || fallback,
  }));
}
