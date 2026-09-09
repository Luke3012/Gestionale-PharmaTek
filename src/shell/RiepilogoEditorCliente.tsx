import type { RecordDto } from "../lib/tauri";
import { AnagraficaEditorModal } from "../features/anagrafiche/AnagraficaEditorModal";
import { REGISTRO_CLIENTE } from "../features/anagrafiche/registri";

export function RiepilogoEditorCliente({ record, onClose }: { record: RecordDto | null; onClose: () => void }) {
  return <AnagraficaEditorModal opened={!!record} registro={REGISTRO_CLIENTE} record={record} onClose={onClose} />;
}
