import type { RecordDto } from "../../lib/tauri";

/**
 * Restituisce l'ultimo medico associato al cliente soltanto se è ancora
 * presente nell'anagrafica. È la regola condivisa da Giornaliero e Preventivi.
 */
export function ultimoMedicoClienteValido(
  clienteId: string,
  clienti: RecordDto[],
  medici: RecordDto[],
): string {
  const ultimoMedicoId = String(
    clienti.find((cliente) => cliente.id === clienteId)?.data
      .ultimo_medico_id ?? "",
  );
  return medici.some((medico) => medico.id === ultimoMedicoId)
    ? ultimoMedicoId
    : "";
}
