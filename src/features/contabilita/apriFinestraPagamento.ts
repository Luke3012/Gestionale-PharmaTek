// Apre il "Dettaglio pagamento" in una finestra Tauri dedicata (richiamata dalla
// ricerca globale per saldare rapidamente un credito). Label deterministico per id:
// ri-aprire lo stesso pagamento porta in primo piano la finestra già aperta.
import { inTauri, type Identity } from "../../lib/tauri";
import {
  apriFinestraTauri,
  queryIdentita,
} from "../../lib/finestreTauri";

const GEOM_PAGAMENTO = {
  width: 390,
  height: 500,
  minWidth: 320,
  minHeight: 360,
} as const;
const GEOM_KEY_PAGAMENTO = "pagamento-dettaglio";

export async function apriFinestraPagamento(
  pagamentoId: string,
  identity?: Identity,
  /** Apri già in modalità "incassato" (salda rapido). */
  salda = true
): Promise<boolean> {
  if (!inTauri) return false;
  return apriFinestraTauri({
    label: `pagamento-${pagamentoId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 14)}`,
    query: `pagamento=${encodeURIComponent(pagamentoId)}${salda ? "&salda=1" : ""}${queryIdentita(identity)}`,
    title: "Dettaglio pagamento",
    chiaveGeometria: GEOM_KEY_PAGAMENTO,
    geometria: GEOM_PAGAMENTO,
  });
}
