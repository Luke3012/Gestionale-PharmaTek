// Apre l'editor ordine in una finestra Tauri separata (più ordini diversi affiancabili).
// Ritorna true se la finestra si è aperta; false → la UI ricade sulla modale.
import { inTauri, type Identity } from "../../lib/tauri";
import { opzioniGeometria } from "../../lib/geometriaFinestre";
import {
  attendiCreazioneFinestra,
  portaFinestraInPrimoPiano,
  queryIdentita,
} from "../../lib/finestreTauri";

/** Geometria ricordata delle finestre Ordine (migra la vecchia chiave `pt.ordineWin`). */
const GEOM_ORDINE = {
  width: 900,
  height: 620,
  minWidth: 760,
  minHeight: 520,
  legacyKey: "pt.ordineWin",
} as const;

// Guard anti-doppia-apertura: prima che Tauri registri la nuova finestra, due click
// ravvicinati possono ancora arrivare in parallelo. Ignoriamo una seconda apertura
// della stessa "chiave" entro 800ms.
const ultimaApertura = new Map<string, number>();
function aperturaRavvicinata(key: string): boolean {
  const ora = Date.now();
  const prec = ultimaApertura.get(key) ?? 0;
  ultimaApertura.set(key, ora);
  return ora - prec < 800;
}

export async function apriFinestraOrdine(
  ordineId: string | null,
  numero?: string,
  identity?: Identity,
  categoria?: string,
  /** Precompilazione per i NUOVI ordini (es. «Nuovo ordine» dal Riepilogo cliente/medico). */
  pre?: { cliente?: string; medico?: string },
  /** Focus iniziale per aperture contestuali (es. sollecito pagamento scaduto). */
  focus?: { sezione?: "pagamenti" | "prodotti"; pagamentoId?: string }
): Promise<boolean> {
  if (!inTauri) return false;
  // Doppio click accidentale → una sola finestra. Restituisce `true` (gestito) così
  // il chiamante non ricade sulla modale.
  if (aperturaRavvicinata(ordineId ?? "new")) return true;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = ordineId
      ? `ordine-${ordineId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`
      : `ordine-new-${crypto.randomUUID().slice(0, 8)}`;
    if (ordineId) {
      const esistente = await WebviewWindow.getByLabel(label);
      if (esistente) {
        await portaFinestraInPrimoPiano(esistente);
        return true;
      }
    }
    // Passa l'identità via URL: la finestra evita un round-trip `whoami` all'avvio.
    const id = queryIdentita(identity);
    const cat = !ordineId && categoria ? `&categoria=${encodeURIComponent(categoria)}` : "";
    // Precompilazione (solo nuovi ordini): cliente o medico già selezionato.
    const pc = !ordineId && pre?.cliente ? `&precli=${encodeURIComponent(pre.cliente)}` : "";
    const pm = !ordineId && pre?.medico ? `&premed=${encodeURIComponent(pre.medico)}` : "";
    const focusQs = focus?.sezione ? `&focus=${encodeURIComponent(focus.sezione)}` : "";
    const pagamentoQs = focus?.pagamentoId ? `&pagamento=${encodeURIComponent(focus.pagamentoId)}` : "";
    const qs = `ordine=${ordineId ?? "new"}${numero ? `&numero=${encodeURIComponent(numero)}` : ""}${cat}${pc}${pm}${focusQs}${pagamentoQs}${id}`;
    const w = new WebviewWindow(label, {
      url: `index.html?${qs}`,
      title: ordineId ? `Ordine ${numero ?? ""}` : "Nuovo ordine",
      minWidth: GEOM_ORDINE.minWidth,
      minHeight: GEOM_ORDINE.minHeight,
      // Riapre dov'era l'ultima volta (misura + posizione); altrimenti centra.
      ...(await opzioniGeometria("ordine", GEOM_ORDINE)),
      visible: false,
    });
    return await attendiCreazioneFinestra(w);
  } catch {
    return false;
  }
}
