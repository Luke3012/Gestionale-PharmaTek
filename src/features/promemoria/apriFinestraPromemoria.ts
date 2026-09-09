// Apre un promemoria in una finestra Tauri dedicata (FASE 6C/6D): «Nuovo» (anche
// pre-collegato a un'entità) oppure la **modifica di uno esistente** (`promemoriaId`),
// richiamata da ricerca globale, notifiche e bacheca. Piccola finestra centrata; il
// backend invalida le bacheche aperte dopo il salvataggio, poi la finestra si chiude.
import { inTauri, type Identity } from "../../lib/tauri";
import {
  apriFinestraTauri,
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
  const label = promemoriaId
    ? `promemoria-edit-${promemoriaId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`
    : collegato
      ? `promemoria-${collegato.tipo}-${collegato.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`
      : "promemoria-nuovo";
  const idp = queryIdentita(identity);
  const query = promemoriaId
    ? `promemoria=edit&pid=${encodeURIComponent(promemoriaId)}${idp}`
    : `promemoria=nuovo${
        collegato
          ? `&ctipo=${encodeURIComponent(collegato.tipo)}&cid=${encodeURIComponent(collegato.id)}&cnome=${encodeURIComponent(collegato.nome)}`
          : ""
      }${idp}`;
  return apriFinestraTauri({
    label,
    query,
    title: promemoriaId ? "Modifica promemoria" : "Nuovo promemoria",
    chiaveGeometria: "promemoria",
    geometria: GEOM_PROMEMORIA,
  });
}
