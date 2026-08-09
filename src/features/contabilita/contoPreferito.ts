// Risoluzione del conto da proporre per un pagamento, con la stessa logica
// "più specifico vince" del listino: medico → agente → predefinito (acconti per
// gli acconti, altrimenti incassi) → primo conto bancario. Preferenze universali
// (campi sui record, condivise fra i PC).
import type { RecordDto } from "../../lib/tauri";

const TRANSITO = ["contrassegno", "assegno"];

export function risolviContoPreferito(args: {
  conti: RecordDto[];
  medico?: RecordDto | null;
  agente?: RecordDto | null;
  tipo: string; // acconto | saldo | rata
}): string {
  const { conti, medico, agente, tipo } = args;
  const esiste = (id?: unknown): id is string => typeof id === "string" && conti.some((c) => c.id === id);

  if (esiste(medico?.data.conto_saldo_id)) return medico!.data.conto_saldo_id as string;
  if (esiste(agente?.data.conto_saldo_id)) return agente!.data.conto_saldo_id as string;
  if (tipo === "acconto") {
    const pa = conti.find((c) => c.data.predefinito_acconti === true);
    if (pa) return pa.id;
  }
  const pi = conti.find((c) => c.data.predefinito_incassi === true);
  if (pi) return pi.id;
  const banca = conti.find((c) => !TRANSITO.includes((c.data.tipo as string) || ""));
  return (banca ?? conti[0])?.id ?? "";
}
