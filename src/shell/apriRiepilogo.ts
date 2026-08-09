// Apre la finestra "Riepilogo" di un'entità (cliente/medico/agente) in una
// finestra Tauri separata (FASE 6A): elenca i suoi ordini in attesa, da cui si
// apre l'ordine o si va ai crediti. Riusa la stessa logica delle finestre Ordine.
import { inTauri, type Identity } from "../lib/tauri";
import { opzioniGeometria } from "../lib/geometriaFinestre";
import {
  attendiCreazioneFinestra,
  portaFinestraInPrimoPiano,
  queryIdentita,
} from "../lib/finestreTauri";
import { CHIAVI_PREFERENZE, type OrdineFinestra } from "../lib/prefs";

export type TipoRiepilogo = "cliente" | "medico" | "agente";
export interface RiepilogoTarget {
  tipo: TipoRiepilogo;
  id: string;
  nome: string;
}

export const EVENTO_APRI_RIEPILOGO = "pt:apri-riepilogo";

export function destinazioneRiepilogo(preferenza: OrdineFinestra): "modale" | "finestra" {
  return preferenza === "mai" ? "modale" : "finestra";
}

/** Un'azione avviata da un riepilogo già esterno resta nel flusso a finestre. */
export function destinazioneComunicazioneDaRiepilogo(
  dentroFinestra: boolean,
): "modale" | "finestra" {
  return dentroFinestra ? "finestra" : "modale";
}

function preferenzaCorrente(): OrdineFinestra {
  try {
    const valore = localStorage.getItem(CHIAVI_PREFERENZE.ordineFinestra);
    if (valore === "mai" || valore === "modifica" || valore === "sempre") return valore;
  } catch {}
  return "mai";
}

async function richiediModalePrincipale(target: RiepilogoTarget): Promise<void> {
  // Nella main la consegna DOM è sincrona (anche durante il primissimo mount); nelle
  // webview secondarie l'evento Tauri sottostante recapita la stessa richiesta alla main.
  window.dispatchEvent(new CustomEvent(EVENTO_APRI_RIEPILOGO, { detail: target }));
  if (!inTauri) {
    return;
  }
  const [{ emit }, { getAllWindows }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/window"),
  ]);
  await emit(EVENTO_APRI_RIEPILOGO, target);
  const main = (await getAllWindows()).find((w) => w.label === "main");
  if (main) await portaFinestraInPrimoPiano(main);
}

/** Punto unico per tutte le aperture: applica la preferenza e ricade sul modale principale. */
export async function apriRiepilogo(
  tipo: TipoRiepilogo,
  id: string,
  nome: string,
  identity?: Identity
): Promise<boolean> {
  if (!id) return false;
  const target = { tipo, id, nome } satisfies RiepilogoTarget;
  if (destinazioneRiepilogo(preferenzaCorrente()) === "finestra") {
    if (await apriFinestraRiepilogo(tipo, id, nome, identity)) return true;
  }
  await richiediModalePrincipale(target);
  return true;
}

export async function apriFinestraRiepilogo(
  tipo: TipoRiepilogo,
  id: string,
  nome: string,
  identity?: Identity
): Promise<boolean> {
  if (!inTauri) return false;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    // Label deterministico: ri-aprire la stessa entità porta in primo piano la
    // finestra già aperta invece di duplicarla.
    const label = `riepilogo-${tipo}-${id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
    const esistente = await WebviewWindow.getByLabel(label);
    if (esistente) {
      await portaFinestraInPrimoPiano(esistente);
      return true;
    }
    const idp = queryIdentita(identity);
    const qs = `riepilogo=${tipo}&id=${encodeURIComponent(id)}&ent=${encodeURIComponent(nome)}${idp}`;
    const w = new WebviewWindow(label, {
      url: `index.html?${qs}`,
      title: nome || "Riepilogo",
      minWidth: 560,
      minHeight: 420,
      ...(await opzioniGeometria("riepilogo", { width: 760, height: 620, minWidth: 560, minHeight: 420 })),
      visible: false,
    });
    return await attendiCreazioneFinestra(w);
  } catch {
    return false;
  }
}
