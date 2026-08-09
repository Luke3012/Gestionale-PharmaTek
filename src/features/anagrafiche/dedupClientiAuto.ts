import {
  api,
  type DedupClienteMergeInput,
} from "../../lib/tauri";
import { pianificaDedupClientiAuto } from "./deduplicazione";

export interface DedupClientiPreparazione {
  merges: DedupClienteMergeInput[];
  sospetti: number;
  protetti: number;
}

export interface DedupAutoResult {
  gruppi: number;
  clientiUniti: number;
  ordiniRiassegnati: number;
  campiCompletati: number;
  sospetti: number;
  protetti: number;
  saltati: number;
}

/** Costruisce il piano verificabile usato sia dall'import sia dall'ottimizzazione. */
export async function preparaDedupClientiAuto(): Promise<DedupClientiPreparazione> {
  const [clienti, ordini, ...altriRecord] = await Promise.all([
    api.recordsList("cliente"),
    api.recordsList("ordine"),
    api.recordsList("promemoria").catch(() => []),
    api.recordsList("spedizione").catch(() => []),
    api.recordsList("pagamento").catch(() => []),
    api.recordsList("riga_ordine").catch(() => []),
    api.recordsList("provv_pagamento").catch(() => []),
    api.recordsList("notifica").catch(() => []),
  ]);
  const plan = pianificaDedupClientiAuto(clienti, ordini, altriRecord.flat());
  return {
    merges: plan.merges.map((merge) => ({
      canonicoId: merge.canonico.id,
      duplicatiIds: merge.duplicati.map((duplicato) => duplicato.id),
      fields: merge.fields,
      snapshots: Object.fromEntries(
        [merge.canonico, ...merge.duplicati].map((cliente) => [cliente.id, cliente.data])
      ),
    })),
    sospetti: plan.sospetti,
    protetti: plan.protetti,
  };
}

/** Pianifica e applica la deduplica completa usata al termine dell'importazione. */
export async function eseguiDedupClientiAuto(): Promise<DedupAutoResult> {
  const preparazione = await preparaDedupClientiAuto();
  const applicato = await api.clientiDeduplicaApplica(preparazione.merges);
  return {
    gruppi: applicato.gruppi,
    clientiUniti: applicato.clientiPurgati,
    ordiniRiassegnati: applicato.riferimentiRiassegnati,
    campiCompletati: applicato.campiCompletati,
    sospetti: preparazione.sospetti,
    protetti: preparazione.protetti,
    saltati: applicato.mergeSaltati,
  };
}
