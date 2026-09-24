// Messaggi leggeri tra PC (FASE 6E) — "un giochino". Un messaggio è un record
// dell'entità `notifica` (id stabile `msg:<ulid>`): mittente, destinatario (un utente
// o "tutti"), testo, eventuale `parent` (è una risposta). Compaiono come notifiche nel
// destinatario (campanella + pop-up custom) e si rispondono inline. **Nessuna cronologia**:
// una volta letti/scartati seguono il read-state `notifica_letta` come le altre notifiche
// (idempotente, per-utente). La derivazione in notifica vive in `notifiche.ts`.
import { api, type Identity, type SyncOverview, type UserDto } from "../../lib/tauri";
import type { CollegatoTipo } from "../promemoria/promemoria";

/** I messaggi riusano l'entità `notifica` prevista in FASE 6E. */
const ENTITA_MESSAGGIO = "notifica";
/** Destinatario "broadcast": tutti gli utenti del team (tranne il mittente). */
export const DEST_TUTTI = "tutti";

/** Evento UI (FASE 7C): «apri la campanella e scrivi a questa persona». Lanciato dal box
 *  sincronizzazione in topbar, ascoltato da `CampanellaPopover`. */
export const EVENTO_COMPONI = "pt:componi-messaggio";
export interface ComponiTarget {
  destId: string;
  destNome: string;
}
export function componiMessaggio(destId: string, destNome: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO_COMPONI, { detail: { destId, destNome } }));
}

/** Destinatari realmente raggiungibili: il registro `user` può conservare profili
 * orfani, mentre `syncOverview` contiene soltanto i PC ancora attivi. */
export function filtraDestinatariMessaggi(
  utenti: UserDto[],
  overview: SyncOverview,
  userIdCorrente = ""
): UserDto[] {
  const utentiAttivi = new Set(
    overview.devices.map((device) => device.userId).filter((userId) => userId.length > 0)
  );
  return utenti.filter(
    (utente) => utente.id !== userIdCorrente && utentiAttivi.has(utente.id)
  );
}

/** Elenco condiviso da composer e Spotlight, allineato al pannello sincronizzazione. */
export async function listaDestinatariMessaggi(userIdCorrente?: string): Promise<UserDto[]> {
  // Riduce al minimo la gara con un ritiro appena consegnato da OneDrive: le
  // letture successive devono usare la proiezione aggiornata, non una cache stale.
  await api.forceSync();
  const [utenti, overview, identity] = await Promise.all([
    api.getUsers(),
    api.syncOverview(),
    userIdCorrente ? Promise.resolve(null) : api.whoami(),
  ]);
  return filtraDestinatariMessaggi(
    utenti,
    overview,
    userIdCorrente ?? identity?.userId ?? ""
  );
}

export interface Messaggio {
  /** Id stabile `msg:<ulid>` (anche chiave del read-state per-utente). */
  id: string;
  mittenteId: string;
  mittenteNome: string;
  /** userId del destinatario, oppure `"tutti"`. */
  destinatario: string;
  destinatarioNome: string;
  testo: string;
  /** Id del messaggio a cui si risponde ("" se è un messaggio nuovo). */
  parent: string;
  collegatoTipo: CollegatoTipo | "";
  collegatoId: string;
  collegatoNome: string;
  /** ms epoch dell'invio. */
  ts: number;
}

/** ULID-lite: ordinabile nel tempo + parte casuale (univocità sufficiente, no dipendenze). */
function ulid(): string {
  const t = Date.now().toString(36).padStart(9, "0");
  const r = Array.from({ length: 12 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
  return (t + r).toUpperCase();
}

function s(data: Record<string, unknown>, k: string): string {
  const v = data[k];
  return typeof v === "string" ? v : "";
}

/** Tutti i messaggi (record `notifica` non cancellati). */
export async function listaMessaggi(): Promise<Messaggio[]> {
  const recs = await api.recordsList(ENTITA_MESSAGGIO);
  return recs.map((r) => ({
    id: r.id,
    mittenteId: s(r.data, "mittente_id"),
    mittenteNome: s(r.data, "mittente_nome"),
    destinatario: s(r.data, "destinatario"),
    destinatarioNome: s(r.data, "destinatario_nome"),
    testo: s(r.data, "testo"),
    parent: s(r.data, "parent"),
    collegatoTipo: (s(r.data, "collegato_tipo") || "") as CollegatoTipo | "",
    collegatoId: s(r.data, "collegato_id"),
    collegatoNome: s(r.data, "collegato_nome"),
    ts: typeof r.data.ts === "number" ? (r.data.ts as number) : 0,
  }));
}

export interface NuovoMessaggio {
  destinatario: string;
  destinatarioNome: string;
  testo: string;
  parent?: string;
  collegatoTipo?: CollegatoTipo | "";
  collegatoId?: string;
  collegatoNome?: string;
}

/** Invia un messaggio (o una risposta, se `parent` è valorizzato). */
export async function inviaMessaggio(m: NuovoMessaggio, identity?: Identity): Promise<Messaggio> {
  if (m.destinatario !== DEST_TUTTI) {
    const raggiungibili = await listaDestinatariMessaggi(identity?.userId);
    if (!raggiungibili.some((utente) => utente.id === m.destinatario)) {
      throw new Error("Il destinatario non ha più una postazione attiva.");
    }
  }
  const id = `msg:${ulid()}`;
  await api.recordCreateId(ENTITA_MESSAGGIO, id, {
    mittente_id: identity?.userId ?? "",
    mittente_nome: identity?.nome ?? "",
    destinatario: m.destinatario,
    destinatario_nome: m.destinatarioNome,
    testo: m.testo.trim(),
    parent: m.parent ?? "",
    collegato_tipo: m.collegatoTipo ?? "",
    collegato_id: m.collegatoId ?? "",
    collegato_nome: m.collegatoNome ?? "",
    ts: Date.now(),
  });
  return {
    id,
    mittenteId: identity?.userId ?? "",
    mittenteNome: identity?.nome ?? "",
    destinatario: m.destinatario,
    destinatarioNome: m.destinatarioNome,
    testo: m.testo.trim(),
    parent: m.parent ?? "",
    collegatoTipo: m.collegatoTipo ?? "",
    collegatoId: m.collegatoId ?? "",
    collegatoNome: m.collegatoNome ?? "",
    ts: Date.now(),
  };
}
