import type { Pagamento, PagamentoVista, RecordDto } from "../../lib/tauri";

type RecordPagamento = Pick<RecordDto, "revision" | "data">;

/** Completa una riga della vista Crediti con i campi tecnici del record persistito. */
export function pagamentoDaVista(
  vista: PagamentoVista,
  record?: RecordPagamento | null,
): Pagamento {
  return {
    id: vista.id,
    revision: record?.revision || vista.revision,
    ordineId: vista.ordineId,
    tipo: vista.tipo as Pagamento["tipo"],
    importo: vista.importo,
    saldato: vista.saldato,
    scadenza: vista.scadenza,
    contoId: vista.contoId,
    contoNome: vista.contoNome,
    contoTipo: vista.contoTipo,
    data: vista.data,
    verificato: vista.verificato,
    distintaId: (record?.data.distinta_id as string) || "",
    contoAccreditoNome: vista.contoAccreditoNome,
    note: (record?.data.note as string) || "",
    scadDaSpedizione: (record?.data.scad_da_spedizione as boolean) || false,
    scadRelGiorni: (record?.data.scad_rel_giorni as number) || 0,
  };
}
