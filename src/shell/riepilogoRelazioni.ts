import type { RecordDto } from "../lib/tauri";
import type { TipoRiepilogo } from "./apriRiepilogo";

export interface RelazioneRiepilogo {
  label: string;
  tipo: "medico" | "agente";
  id: string;
  nome: string;
}

function valore(record: RecordDto | null, campo: string): string {
  const value = record?.data[campo];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function recordVivo(record: RecordDto | null, id: string): record is RecordDto {
  return !!record && !record.deleted && !!id && record.id === id;
}

export function creaRelazioniRiepilogo(
  tipo: TipoRiepilogo,
  soggetto: RecordDto | null,
  medico: RecordDto | null,
  agente: RecordDto | null
): RelazioneRiepilogo[] {
  if (!soggetto || soggetto.deleted || tipo === "agente") return [];

  const medicoId = tipo === "cliente" ? valore(soggetto, "ultimo_medico_id") : soggetto.id;
  const medicoCorrente = tipo === "medico" ? soggetto : medico;
  const agenteId = valore(medicoCorrente, "agente_id");
  const relazioni: RelazioneRiepilogo[] = [];

  if (tipo === "cliente" && recordVivo(medicoCorrente, medicoId)) {
    relazioni.push({
      label: "Medico di riferimento",
      tipo: "medico",
      id: medicoCorrente.id,
      nome: valore(medicoCorrente, "nome") || "(senza nome)",
    });
  }
  if (recordVivo(agente, agenteId)) {
    relazioni.push({
      label: "Agente di riferimento",
      tipo: "agente",
      id: agente.id,
      nome: valore(agente, "nome") || "(senza nome)",
    });
  }

  return relazioni;
}
