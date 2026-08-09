// Apre il "Dettaglio pagamento" in una finestra Tauri dedicata (richiamata dalla
// ricerca globale per saldare rapidamente un credito). Label deterministico per id:
// ri-aprire lo stesso pagamento porta in primo piano la finestra già aperta.
import { inTauri, type Identity } from "../../lib/tauri";
import { opzioniGeometria } from "../../lib/geometriaFinestre";
import {
  attendiCreazioneFinestra,
  portaFinestraInPrimoPiano,
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
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = `pagamento-${pagamentoId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 14)}`;
    const esistente = await WebviewWindow.getByLabel(label);
    if (esistente) {
      await portaFinestraInPrimoPiano(esistente);
      return true;
    }
    const idp = queryIdentita(identity);
    const qs = `pagamento=${encodeURIComponent(pagamentoId)}${salda ? "&salda=1" : ""}${idp}`;
    const w = new WebviewWindow(label, {
      url: `index.html?${qs}`,
      title: "Dettaglio pagamento",
      minWidth: GEOM_PAGAMENTO.minWidth,
      minHeight: GEOM_PAGAMENTO.minHeight,
      ...(await opzioniGeometria(GEOM_KEY_PAGAMENTO, GEOM_PAGAMENTO)),
      visible: false,
    });
    return await attendiCreazioneFinestra(w);
  } catch {
    return false;
  }
}
