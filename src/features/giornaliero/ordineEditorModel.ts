import type { RecordDto } from "../../lib/tauri";
import { eurToCents } from "../../lib/money";
import { REGISTRI } from "../anagrafiche/registri";
import { CATEGORIA_DEFAULT } from "./categoriaOrdine";

export type CampiOrdineRealtime = Record<string, unknown>;

export function campiOrdineRealtime(data: Record<string, unknown>): CampiOrdineRealtime {
  return {
    categoria: String(data.categoria ?? CATEGORIA_DEFAULT),
    data: String(data.data ?? ""),
    medicoId: String(data.medico_id ?? ""),
    agenteId: String(data.agente_id ?? ""),
    clienteId: String(data.cliente_id ?? ""),
    stato: String(data.stato ?? "Nuovo"),
    marcatore: String(data.marcatore ?? ""),
    note: String(data.note ?? ""),
    acconto: typeof data.acconto === "number" ? data.acconto : 0,
    motivoRifiuto: String(data.motivo_rifiuto ?? ""),
    omaggio: data.omaggio === true,
    fattRagioneSociale: String(data.fatt_ragione_sociale ?? ""),
    fattIndirizzo: String(data.fatt_indirizzo ?? ""),
    fattCitta: String(data.fatt_citta ?? ""),
    fattProv: String(data.fatt_prov ?? ""),
    fattCap: String(data.fatt_cap ?? ""),
    fattPiva: String(data.fatt_piva ?? "").toUpperCase(),
  };
}

/** Riga locale dello scadenzario per un ordine non ancora salvato. */
export interface Bozza {
  key: string;
  tipo: "acconto" | "saldo" | "rata";
  importo: number;
  saldato: boolean;
  scadenza: string;
  contoId: string;
  data: string;
  verificato: boolean;
  scadDaSpedizione?: boolean;
  scadRelGiorni?: number;
}

export const CLIENTE_REG = REGISTRI.find((registro) => registro.entity === "cliente")!;
export const MEDICO_REG = REGISTRI.find((registro) => registro.entity === "medico")!;

export function valoriClienteVuoti(): Record<string, string | number> {
  return Object.fromEntries(CLIENTE_REG.campi.map((campo) => [campo.key, ""]));
}

export function valoriMedicoVuoti(): Record<string, string | number> {
  return Object.fromEntries(MEDICO_REG.campi.map((campo) => [campo.key, campo.defaultValue ?? ""]));
}

export function opzioni(records: RecordDto[]) {
  return records.map((record) => ({
    value: record.id,
    label: (record.data.nome as string) || "(senza nome)",
  }));
}

export function centsDi(euro: number | ""): number {
  return euro === "" ? 0 : eurToCents(Number(euro));
}
