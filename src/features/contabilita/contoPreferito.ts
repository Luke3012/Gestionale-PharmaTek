// Risoluzione del conto da proporre per un pagamento, con la stessa logica
// "più specifico vince" del listino: medico → agente → predefinito (acconti per
// gli acconti, altrimenti incassi) → primo conto bancario. Preferenze universali
// (campi sui record, condivise fra i PC).
import type { RecordDto } from "../../lib/tauri";

export function èContoTransito(tipo: unknown): boolean {
  return tipo === "contrassegno" || tipo === "assegno";
}

function opzioneConto(conto: RecordDto) {
  return {
    value: conto.id,
    label: (conto.data.nome as string) || "(conto)",
  };
}

export function opzioniConti(conti: RecordDto[]) {
  return conti.map(opzioneConto);
}

export function opzioniContiConTransito(conti: RecordDto[]) {
  return conti.map((conto) => {
    const opzione = opzioneConto(conto);
    return {
      ...opzione,
      label: opzione.label + (èContoTransito(conto.data.tipo) ? " (transito)" : ""),
    };
  });
}

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
  const banca = conti.find((c) => !èContoTransito(c.data.tipo));
  return (banca ?? conti[0])?.id ?? "";
}
