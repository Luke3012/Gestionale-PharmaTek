// Apre un promemoria in una finestra Tauri dedicata (FASE 6C/6D): «Nuovo» (anche
// pre-collegato a un'entità) oppure la **modifica di uno esistente** (`promemoriaId`),
// richiamata da ricerca globale, notifiche e bacheca. Piccola finestra centrata; il
// backend invalida le bacheche aperte dopo il salvataggio, poi la finestra si chiude.
import { inTauri, type Identity } from "../../lib/tauri";
import { opzioniGeometria } from "../../lib/geometriaFinestre";
import {
  attendiCreazioneFinestra,
  portaFinestraInPrimoPiano,
  queryIdentita,
} from "../../lib/finestreTauri";
import type { Collegato } from "./promemoria";

const GEOM_PROMEMORIA = {
  width: 500,
  height: 420,
  minWidth: 420,
  minHeight: 320,
} as const;

export async function apriFinestraPromemoria(
  identity?: Identity,
  /** Pre-collegamento opzionale per un NUOVO promemoria (es. da una scheda entità). */
  collegato?: Collegato,
  /** Se valorizzato, apre in MODIFICA il promemoria con questo id. */
  promemoriaId?: string
): Promise<boolean> {
  if (!inTauri) return false;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = promemoriaId
      ? `promemoria-edit-${promemoriaId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`
      : collegato
        ? `promemoria-${collegato.tipo}-${collegato.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`
        : "promemoria-nuovo";
    const esistente = await WebviewWindow.getByLabel(label);
    if (esistente) {
      await portaFinestraInPrimoPiano(esistente);
      return true;
    }
    const idp = queryIdentita(identity);
    const qs = promemoriaId
      ? `promemoria=edit&pid=${encodeURIComponent(promemoriaId)}${idp}`
      : `promemoria=nuovo${
          collegato
            ? `&ctipo=${encodeURIComponent(collegato.tipo)}&cid=${encodeURIComponent(collegato.id)}&cnome=${encodeURIComponent(collegato.nome)}`
            : ""
        }${idp}`;
    const w = new WebviewWindow(label, {
      url: `index.html?${qs}`,
      title: promemoriaId ? "Modifica promemoria" : "Nuovo promemoria",
      minWidth: GEOM_PROMEMORIA.minWidth,
      minHeight: GEOM_PROMEMORIA.minHeight,
      ...(await opzioniGeometria("promemoria", GEOM_PROMEMORIA)),
      visible: false,
    });
    return await attendiCreazioneFinestra(w);
  } catch {
    return false;
  }
}
