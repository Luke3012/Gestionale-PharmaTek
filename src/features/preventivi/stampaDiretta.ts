import {
  api,
  type ConfigurazioneDocumenti,
  type Preventivo,
} from "../../lib/tauri";
import {
  creaDocumentoPreventivo,
  creaDocumentoSchedaCliente,
  stampaDocumento,
} from "./rendererDocumenti";

/** Stampa un preventivo senza passare dal modale di anteprima. */
export function stampaPreventivoDiretta(
  preventivo: Preventivo,
  configDocumenti?: ConfigurazioneDocumenti | null,
): () => void {
  return stampaDocumento(
    creaDocumentoPreventivo(preventivo, configDocumenti ?? undefined),
  );
}

/**
 * Carica e stampa una scheda cliente senza aprire l'anteprima in-app.
 * Restituisce la funzione di pulizia creata dal renderer di stampa.
 */
export async function stampaSchedaClienteDiretta(
  ordineId: string,
  ordineNumero?: string,
  configDocumenti?: ConfigurazioneDocumenti | null,
): Promise<() => void> {
  const [scheda, config] = await Promise.all([
    api.schedaClienteGet(ordineId),
    configDocumenti
      ? Promise.resolve(configDocumenti)
      : api.configurazioneDocumentiGet(),
  ]);
  const documento = creaDocumentoSchedaCliente(
    scheda.ordineNumero || ordineNumero || "",
    scheda,
    config,
    {
      medicoNome: scheda.medicoNome,
      agenteNome: scheda.agenteNome,
    },
  );
  return stampaDocumento(documento);
}
