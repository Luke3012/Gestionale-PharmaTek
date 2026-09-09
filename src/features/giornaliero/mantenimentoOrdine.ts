import type { RecordDto } from "../../lib/tauri";
import type { RigaForm } from "./righeOrdine";

export interface StoricoMantenimentoRiga {
  attivo: boolean;
  clienteId: string;
  ordineId: string | null;
  ordini: RecordDto[];
  righe: RecordDto[];
  nomiProdotti: ReadonlyMap<string, string>;
}

function normalizzaTesto(valore: string): string {
  return valore.trim().toLowerCase();
}

function nomeProdottoStorico(riga: RecordDto, nomiProdotti: ReadonlyMap<string, string>): string {
  const prodottoId = (riga.data.prodotto_id as string) || "";
  return (prodottoId && nomiProdotti.get(prodottoId)) || (riga.data.prodotto_nome as string) || "";
}

function stessoProdottoStorico(
  riga: RigaForm,
  storica: RecordDto,
  nomiProdotti: ReadonlyMap<string, string>
): boolean {
  const storicoId = (storica.data.prodotto_id as string) || "";
  if (riga.prodottoId && storicoId && riga.prodottoId === storicoId) return true;
  return !!riga.prodottoNome.trim() && normalizzaTesto(riga.prodottoNome) === normalizzaTesto(nomeProdottoStorico(storica, nomiProdotti));
}

/** Precompila i dati di produzione dall'uso più recente dello stesso prodotto per il cliente. */
export function precompilaMantenimentoRiga(riga: RigaForm, storico: StoricoMantenimentoRiga): RigaForm {
  if (!storico.attivo || !storico.clienteId || (!riga.prodottoId && !riga.prodottoNome.trim())) return riga;

  const ordiniById = new Map(storico.ordini.map((ordine) => [ordine.id, ordine]));
  const match = storico.righe
    .filter((candidata) => {
      if (candidata.id === riga.id) return false;
      const ordineId = (candidata.data.ordine_id as string) || "";
      if (storico.ordineId && ordineId === storico.ordineId) return false;
      const ordine = ordiniById.get(ordineId);
      if (!ordine || ((ordine.data.cliente_id as string) || "") !== storico.clienteId) return false;
      if (!stessoProdottoStorico(riga, candidata, storico.nomiProdotti)) return false;
      return !!String(candidata.data.formulazione ?? "").trim() || !!String(candidata.data.posologia ?? "").trim() || (Array.isArray(candidata.data.allergeni) && candidata.data.allergeni.length > 0);
    })
    .map((candidata) => ({ riga: candidata, data: ((ordiniById.get((candidata.data.ordine_id as string) || "")?.data.data as string) || "") }))
    .sort((a, b) => b.data.localeCompare(a.data))[0]?.riga;

  if (!match) return riga;
  return {
    ...riga,
    formulazione: riga.formulazione.trim() ? riga.formulazione : (match.data.formulazione as string) || "",
    posologia: riga.posologia.trim() ? riga.posologia : (match.data.posologia as string) || "",
    allergeni: riga.allergeni.length > 0 ? riga.allergeni : Array.isArray(match.data.allergeni) ? (match.data.allergeni as string[]) : [],
  };
}
