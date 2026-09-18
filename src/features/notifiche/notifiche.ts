// Notifiche della campanella (FASE 6D). Le notifiche **non sono memorizzate**: si
// derivano al volo dallo stato corrente (pagamenti scaduti, promemoria in
// scadenza/scaduti, marcatori). L'unica cosa persistita è lo **stato «letto»
// per-utente**, event-sourced e idempotente: un record `notifica_letta` con id
// deterministico `stato-notifica-v2|<userId>|<notificaId>`. Il namespace v2 migra
// in modo sicuro le installazioni nelle quali una vecchia
// chiave `letta|…` era stata tombstonata troppo presto durante una sync parziale.
//
// Gli id delle notifiche sono **stabili** così che rileggere il log non duplichi né
// ri-mostri nulla, e lo «scaduto» di un promemoria **assorbe** la sua «in scadenza»
// (id diverso, derivato solo nello stato corrente → l'altra sparisce da sola).
import {
  IconAlertTriangle,
  IconBellRinging,
  IconBulb,
  IconClockExclamation,
  IconCoin,
  IconMessage,
  IconRefresh,
  IconSend,
  type Icon,
} from "@tabler/icons-react";
import {
  api,
  inTauri,
  type Comunicazione,
  type Identity,
  type OrdineDto,
  type PagamentoVista,
  type Suggerimento,
  type SuggerimentoCollegamento,
} from "../../lib/tauri";
import { oggiIso } from "../../lib/date";
import { formattaEuroCentesimi as euroCent } from "../../lib/money";
export { formattaEuroCentesimi as euroCent } from "../../lib/money";
import { inviaEventoConConferma, portaFinestraInPrimoPiano } from "../../lib/finestreTauri";
import { giorniTra, statoScadenza, type CollegatoTipo, type Promemoria } from "../promemoria/promemoria";
import { DEST_TUTTI, type Messaggio } from "./messaggi";

export type TipoNotifica =
  | "riepilogo"
  | "sollecito"
  | "promemoria_scadenza"
  | "promemoria_scaduto"
  | "marcatore"
  | "messaggio"
  | "comunicazione"
  | "suggerimento"
  | "aggiornamento";

/** Urgenza visiva (colore + ordinamento), allineata agli stati scadenza promemoria. */
export type UrgenzaNotifica = "scaduto" | "oggi" | "presto" | "info";

export const COLORE_URGENZA: Record<UrgenzaNotifica, string> = {
  scaduto: "red",
  oggi: "orange",
  presto: "yellow",
  info: "blue",
};

const PESO_URGENZA: Record<UrgenzaNotifica, number> = { scaduto: 3, oggi: 2, presto: 1, info: 0 };

// Le azioni della campanella sono scritture applicative vere e proprie. Le teniamo
// tracciate fino alla conferma del core, così la chiusura della finestra principale
// può aspettarle invece di troncarle mentre sono ancora in volo.
const scrittureStatoInCorso = new Set<Promise<unknown>>();

function tracciaScritturaStato<T>(scrittura: () => Promise<T>): Promise<T> {
  const promessa = scrittura();
  scrittureStatoInCorso.add(promessa);
  void promessa.then(
    () => scrittureStatoInCorso.delete(promessa),
    () => scrittureStatoInCorso.delete(promessa)
  );
  return promessa;
}

/** Attende le letture/scarti già richiesti prima dell'uscita dall'app. */
export async function attendiScrittureStatoNotifiche(): Promise<void> {
  // Il ciclo copre anche un'eventuale seconda azione accodata mentre attendiamo.
  while (scrittureStatoInCorso.size > 0) {
    await Promise.allSettled([...scrittureStatoInCorso]);
  }
}

export interface TipoNotificaDef {
  label: string;
  color: string;
  Ico: Icon;
}

export const TIPO_NOTIFICA: Record<TipoNotifica, TipoNotificaDef> = {
  riepilogo: { label: "Notifiche", color: "blue", Ico: IconBellRinging },
  sollecito: { label: "Sollecito", color: "red", Ico: IconCoin },
  promemoria_scaduto: { label: "Promemoria scaduto", color: "red", Ico: IconClockExclamation },
  promemoria_scadenza: { label: "Promemoria in scadenza", color: "yellow", Ico: IconBellRinging },
  marcatore: { label: "Segnalazione", color: "orange", Ico: IconAlertTriangle },
  messaggio: { label: "Messaggio", color: "grape", Ico: IconMessage },
  comunicazione: { label: "Comunicazione", color: "yellow", Ico: IconSend },
  suggerimento: { label: "Azione suggerita", color: "yellow", Ico: IconBulb },
  aggiornamento: { label: "Aggiornamento", color: "cyan", Ico: IconRefresh },
};

/** Entità da aprire al click su una notifica. */
export interface CollegamentoNotifica {
  tipo: CollegatoTipo;
  id: string;
  nome: string;
}

export interface Notifica {
  /** Id **stabile** (chiave del read-state per-utente). */
  id: string;
  tipo: TipoNotifica;
  titolo: string;
  dettaglio: string;
  urgenza: UrgenzaNotifica;
  /** ms epoch per l'ordinamento e l'etichetta «quando». */
  ts: number;
  collegato: CollegamentoNotifica | null;
  /** Se è la notifica di un promemoria: il suo id (al click si apre il promemoria). */
  promemoriaId?: string;
  /** Se è un messaggio 6E: dati del mittente, per la risposta inline. */
  mittenteId?: string;
  mittenteNome?: string;
  /** Comunicazione da mostrare ed evidenziare nel Centro comunicazioni. */
  comunicazioneId?: string;
  /** Deep-link generico FASE 14, già risolto dal motore autorevole. */
  suggerimento?: SuggerimentoCollegamento;
}

/** Bucket settimanale per il re-remind: un overdue ignorato ri-allerta ~ogni 7
 *  giorni (id diverso → torna non letto), senza essere invasivo. */
function bucketSettimanale(giorniScaduto: number): number {
  return Math.floor(Math.max(0, giorniScaduto) / 7);
}

export function idSollecitoContratto(id: string, giorni: number, soglia: number): string | null {
  if (giorni < soglia) return null;
  return `sollecito:${id}:${bucketSettimanale(giorni - soglia)}`;
}

export function idPromemoriaContratto(
  id: string,
  scadenza: string,
  giorni: number,
  avviso: number
): string | null {
  if (giorni > 0) return `promem-scaduto:${id}:${scadenza}:${bucketSettimanale(giorni)}`;
  if (giorni === 0 || (avviso > 0 && -giorni <= avviso)) return `promem-pre:${id}:${scadenza}`;
  return null;
}

function dataMs(iso: string): number {
  if (!iso) return 0;
  const t = new Date(iso + "T00:00:00").getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** «gg/mm/aaaa» da ISO. */
function formattaData(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// --- Derivazione ----------------------------------------------------------

/** Stati ordine senza credito esigibile: niente sollecito (potenziale o annullato). */
const STATI_SENZA_CREDITO = new Set(["Nuovo", "Rifiutato"]);

/** Solleciti: pagamenti attesi (non saldati) con scadenza raggiunta oltre la soglia. */
function derivaSolleciti(pagamenti: PagamentoVista[], soglia: number, oggi: string, ordiniVivi: Set<string>): Notifica[] {
  const out: Notifica[] = [];
  for (const p of pagamenti) {
    if (p.saldato || !p.scadenza) continue;
    if (p.ordineId && !ordiniVivi.has(p.ordineId)) continue;
    if (STATI_SENZA_CREDITO.has(p.ordineStato)) continue;
    const giorni = giorniTra(p.scadenza, oggi); // oggi − scadenza
    const id = idSollecitoContratto(p.id, giorni, soglia);
    if (!id) continue;
    const chi = p.clienteNome || p.medicoNome || p.ordineNumero || "Cliente";
    // Re-remind settimanale a partire da quando è scattato il sollecito.
    out.push({
      id,
      tipo: "sollecito",
      titolo: `Pagamento scaduto · ${chi}`,
      dettaglio: `${euroCent(p.importo)} · scad. ${formattaData(p.scadenza)}${p.ordineNumero ? ` · ord. ${p.ordineNumero}` : ""}`,
      urgenza: giorni > 0 ? "scaduto" : "oggi",
      ts: dataMs(p.scadenza),
      collegato: p.ordineId ? { tipo: "ordine", id: p.ordineId, nome: p.ordineNumero } : null,
    });
  }
  return out;
}

function collegatoPromemoria(p: Promemoria): CollegamentoNotifica | null {
  if (!p.collegatoTipo) return null;
  return { tipo: p.collegatoTipo, id: p.collegatoId, nome: p.collegatoNome };
}

/** Promemoria aperti con scadenza: una sola notifica per occorrenza, nello stato
 *  corrente. Scaduto e «in scadenza» hanno id diversi (`<id>:<scadenza>`): appena
 *  scatta lo scaduto, la «in scadenza» non viene più derivata → sparisce da sola. */
function derivaPromemoria(promemoria: Promemoria[], oggi: string, ordiniVivi: Set<string>): Notifica[] {
  const out: Notifica[] = [];
  for (const p of promemoria) {
    if (p.fatto || !p.scadenza) continue;
    if (p.collegatoTipo === "ordine" && p.collegatoId && !ordiniVivi.has(p.collegatoId)) continue;
    const stato = statoScadenza(p.scadenza, p.avvisoAnticipato, oggi);
    const id = idPromemoriaContratto(p.id, p.scadenza, giorniTra(p.scadenza, oggi), p.avvisoAnticipato);
    if (!id) continue;
    if (stato === "scaduto") {
      out.push({
        id,
        tipo: "promemoria_scaduto",
        titolo: p.testo || "Promemoria",
        dettaglio: `Scaduto · ${formattaData(p.scadenza)}${p.collegatoNome ? ` · ${p.collegatoNome}` : ""}`,
        urgenza: "scaduto",
        ts: dataMs(p.scadenza),
        collegato: collegatoPromemoria(p),
        promemoriaId: p.id,
      });
    } else if (stato === "oggi" || stato === "presto") {
      out.push({
        id,
        tipo: "promemoria_scadenza",
        titolo: p.testo || "Promemoria",
        dettaglio: `${stato === "oggi" ? "Oggi" : `Entro il ${formattaData(p.scadenza)}`}${p.collegatoNome ? ` · ${p.collegatoNome}` : ""}`,
        urgenza: stato === "oggi" ? "oggi" : "presto",
        ts: dataMs(p.scadenza),
        collegato: collegatoPromemoria(p),
        promemoriaId: p.id,
      });
    }
  }
  return out;
}

/** Marcatori urgente/anomalia → notifica azionabile (apre l'ordine). */
function derivaMarcatori(ordini: OrdineDto[]): Notifica[] {
  const out: Notifica[] = [];
  for (const o of ordini) {
    if (o.marcatore !== "urgente" && o.marcatore !== "anomalia" && o.marcatore !== "sollecito") continue;
    const urgente = o.marcatore === "urgente";
    out.push({
      id: `marcatore:${o.id}`,
      tipo: "marcatore",
      titolo: `${o.marcatore === "urgente" ? "Urgente" : o.marcatore === "anomalia" ? "Anomalia" : "Sollecito"} · ${o.numero}${o.clienteNome ? ` · ${o.clienteNome}` : ""}`,
      dettaglio: o.medicoNome || o.clienteCitta || "",
      urgenza: urgente ? "scaduto" : "presto",
      ts: dataMs(o.data),
      collegato: { tipo: "ordine", id: o.id, nome: o.numero },
    });
  }
  return out;
}

/** Messaggi tra PC (FASE 6E) indirizzati a me (o a "tutti"), non inviati da me →
 *  notifica con dati mittente per la risposta inline. Id = id del messaggio. */
function derivaMessaggi(messaggi: Messaggio[], userId: string, onboardingTime: number): Notifica[] {
  const out: Notifica[] = [];
  for (const m of messaggi) {
    if (m.ts < onboardingTime) continue; // skip old messages
    if (!m.mittenteId || m.mittenteId === userId) continue; // i miei non avvisano me
    if (m.destinatario !== DEST_TUTTI && m.destinatario !== userId) continue;
    out.push({
      id: m.id,
      tipo: "messaggio",
      titolo: m.mittenteNome ? `💬 ${m.mittenteNome}` : "Nuovo messaggio",
      dettaglio: m.testo,
      urgenza: "info",
      ts: m.ts,
      collegato: m.collegatoTipo
        ? { tipo: m.collegatoTipo, id: m.collegatoId, nome: m.collegatoNome }
        : null,
      mittenteId: m.mittenteId,
      mittenteNome: m.mittenteNome,
    });
  }
  return out;
}

/** Ordina i messaggi in cima (più recenti prima), poi le altre notifiche per
 * urgenza e anzianità. */
export function ordinaNotifiche(list: Notifica[]): Notifica[] {
  return [...list].sort((a, b) => {
    const aMessaggio = a.tipo === "messaggio";
    const bMessaggio = b.tipo === "messaggio";
    if (aMessaggio !== bMessaggio) return aMessaggio ? -1 : 1;
    if (aMessaggio && bMessaggio) return b.ts - a.ts;
    const w = PESO_URGENZA[b.urgenza] - PESO_URGENZA[a.urgenza];
    if (w) return w;
    return a.ts - b.ts;
  });
}

export interface DatiNotifiche {
  pagamenti: PagamentoVista[];
  promemoria: Promemoria[];
  ordini: OrdineDto[];
  /** Messaggi tra PC (FASE 6E). */
  messaggi?: Messaggio[];
  comunicazioni?: Comunicazione[];
  suggerimenti?: Suggerimento[];
  /** Utente corrente: i messaggi notificano solo lui (o "tutti"). */
  userId?: string;
  /** Giorni dopo la scadenza prima di sollecitare (0 = dal giorno stesso). */
  sogliaSolleciti: number;
  oggi?: string;
  onboardingTime?: number;
}

function derivaComunicazioni(
  comunicazioni: Comunicazione[],
): Notifica[] {
  return comunicazioni
    .filter((comunicazione) => comunicazione.stato === "fallito")
    .map((comunicazione) => {
      const canale =
        comunicazione.canale === "email" ? "E-mail" : "WhatsApp";
      return {
        id: `comunicazione:${comunicazione.id}`,
        tipo: "comunicazione" as const,
        titolo: "Invio non riuscito",
        dettaglio: `${canale} · ${comunicazione.recapito}`,
        urgenza: "scaduto" as const,
        ts:
          comunicazione.statoAggiornatoMs ||
          comunicazione.creataMs,
        collegato:
          comunicazione.destinatarioEntita === "cliente" ||
          comunicazione.destinatarioEntita === "medico"
            ? {
                tipo: comunicazione.destinatarioEntita,
                id: comunicazione.destinatarioId,
                nome: comunicazione.recapito,
              }
            : null,
        comunicazioneId: comunicazione.id,
      };
    });
}

export function derivaSuggerimenti(
  suggerimenti: Suggerimento[],
): Notifica[] {
  return suggerimenti.map((suggerimento) => ({
    id: suggerimento.id,
    tipo: "suggerimento",
    titolo: suggerimento.titolo,
    dettaglio: suggerimento.dettaglio,
    urgenza:
      suggerimento.priorita >= 90
        ? "scaduto"
        : suggerimento.priorita >= 75
          ? "oggi"
          : "info",
    ts: suggerimento.aggiornatoMs,
    collegato: null,
    suggerimento: suggerimento.collegamento,
  }));
}

/** Costruisce l'elenco completo delle notifiche correnti della campanella (ordinato). */
export function derivaNotifiche(d: DatiNotifiche): Notifica[] {
  const oggi = d.oggi ?? oggiIso();
  const ordiniVivi = new Set(d.ordini.map((o) => o.id));
  return ordinaNotifiche([
    ...derivaSolleciti(d.pagamenti, d.sogliaSolleciti, oggi, ordiniVivi),
    ...derivaPromemoria(d.promemoria, oggi, ordiniVivi),
    ...derivaMarcatori(d.ordini),
    ...derivaMessaggi(d.messaggi ?? [], d.userId ?? "", d.onboardingTime ?? 0),
    ...derivaComunicazioni(d.comunicazioni ?? []),
  ]).filter((n) => n.collegato?.tipo !== "ordine" || ordiniVivi.has(n.collegato.id));
}

// --- Read-state per-utente (event-sourced, idempotente) -------------------
//
// Due stati, entrambi nel record `notifica_letta` (id deterministico per coppia
// utente+notifica, upsert idempotente):
//  • **vista** = il record esiste (l'utente l'ha vista/letta) → non conta nel badge;
//  • **scartata** = campo `scartata=true` → rimossa dalla lista (dismiss).
// La sola esistenza del record vale come «vista» (retro-compatibile coi record vecchi).

const ENTITA_LETTA = "notifica_letta";
const EVENTO_OVERLAY_RIMUOVI = "pt:overlay-rimuovi-notifiche";
let ultimoTsRiattivazione = 0;

export interface StatiNotifiche {
  /** Id viste (lette o scartate): non contano nel badge. */
  viste: Set<string>;
  /** Id scartati: tolti dalla lista. */
  scartate: Set<string>;
}

/** Chiave deterministica del record (un record per coppia utente+notifica). */
function chiaveLetta(notificaId: string, userId: string): string {
  return `stato-notifica-v2|${userId}|${notificaId}`;
}

async function userIdStatoNotifiche(identity?: Identity): Promise<string> {
  const fornito = identity?.userId?.trim();
  if (fornito) return fornito;
  const corrente = await api.whoami();
  const userId = corrente?.userId?.trim();
  if (!userId) throw new Error("utente corrente non disponibile");
  return userId;
}

function prossimoTsRiattivazione(): number {
  const ora = Date.now();
  ultimoTsRiattivazione = Math.max(ora, ultimoTsRiattivazione + 1);
  return ultimoTsRiattivazione;
}

/** Stati delle notifiche **per questo utente** (viste + scartate). */
export async function caricaStati(userId: string): Promise<StatiNotifiche> {
  const recs = await api.recordsList(ENTITA_LETTA);
  const viste = new Set<string>();
  const scartate = new Set<string>();
  const piuRecenti = new Map<string, { ts: number; recordId: string; letta: boolean; scartata: boolean }>();
  for (const r of recs) {
    if (r.data.user_id !== userId || typeof r.data.notifica_id !== "string") continue;
    const id = r.data.notifica_id as string;
    const ts = typeof r.data.ts === "number" ? r.data.ts : 0;
    const precedente = piuRecenti.get(id);
    // Durante la migrazione possono convivere la vecchia chiave `letta|…` e la v2.
    // Vince l'azione più recente; a parità vince deterministicamente l'id v2.
    if (precedente && (precedente.ts > ts || (precedente.ts === ts && precedente.recordId > r.id))) continue;
    piuRecenti.set(id, {
      ts,
      recordId: r.id,
      letta: r.data.letta !== false,
      scartata: r.data.scartata === true,
    });
  }
  for (const [id, stato] of piuRecenti) {
    // `letta:false` = record «riattivato» (es. il promemoria è stato modificato):
    // torna NON vista e NON scartata. I record vecchi non hanno il campo → vista.
    if (!stato.letta) continue;
    viste.add(id);
    if (stato.scartata) scartate.add(id);
  }
  return { viste, scartate };
}

function salvaStatoVisto(
  notificaId: string,
  identity: Identity | undefined,
  syncOverlay: boolean,
  scartata: boolean
): Promise<void> {
  return tracciaScritturaStato(async () => {
    const userId = await userIdStatoNotifiche(identity);
    await api.recordCreateId(ENTITA_LETTA, chiaveLetta(notificaId, userId), {
      notifica_id: notificaId,
      user_id: userId,
      letta: true,
      ...(scartata ? { scartata: true } : {}),
      ts: Date.now(),
    });
    if (syncOverlay) await rimuoviDaOverlay([notificaId]);
  });
}

/** Segna una notifica come **letta/vista** (click): resta in lista, esce dal badge. */
export function segnaLetta(notificaId: string, identity?: Identity, syncOverlay = true): Promise<void> {
  return salvaStatoVisto(notificaId, identity, syncOverlay, false);
}

/** **Scarta** una notifica (dismiss): la toglie dalla lista (e dal badge). */
export function scarta(notificaId: string, identity?: Identity, syncOverlay = true): Promise<void> {
  return salvaStatoVisto(notificaId, identity, syncOverlay, true);
}

/** Scarta tutte le notifiche date (in parallelo). */
export async function scartaTutte(ids: string[], identity?: Identity): Promise<void> {
  await Promise.all(ids.map((id) => scarta(id, identity, false)));
  await rimuoviDaOverlay(ids);
}

/** Riporta una notifica stabile allo stato "non vista" per l'utente corrente.
 *  Serve quando lo stesso id rappresenta una nuova occorrenza logica, per esempio
 *  una segnalazione tolta e rimessa rapidamente sullo stesso ordine. */
export async function riattivaNotifica(notificaId: string, identity?: Identity): Promise<void> {
  const userId = await userIdStatoNotifiche(identity);
  await riattivaNotificaPerUser(notificaId, userId);
}

async function riattivaNotificaPerUser(
  notificaId: string,
  userId: string,
  origine?: "dashboard",
): Promise<void> {
  await api.recordCreateId(ENTITA_LETTA, chiaveLetta(notificaId, userId), {
    notifica_id: notificaId,
    user_id: userId,
    letta: false,
    scartata: false,
    ts: prossimoTsRiattivazione(),
    ...(origine ? { origine_riattivazione: origine } : {}),
  });
}

/** Riattiva una o più notifiche per utenti specifici. Gli id record restano
 *  deterministici (`stato-notifica-v2|utente|notifica`), quindi replay e snapshot non duplicano. */
export async function riattivaNotifichePerUtenti(notificaIds: string[], userIds: string[]): Promise<number> {
  const ids = [...new Set(notificaIds.filter(Boolean))];
  // Una selezione può restare aperta mentre un PC viene ritirato. Rivalidiamo al
  // momento della scrittura per non creare stati destinati a profili non più
  // raggiungibili o risorti da vecchi snapshot.
  await api.forceSync();
  const overview = await api.syncOverview();
  const attivi = new Set(overview.devices.map((device) => device.userId).filter(Boolean));
  const utenti = [...new Set(userIds.filter((userId) => !!userId && attivi.has(userId)))];
  await Promise.all(
    utenti.flatMap((userId) =>
      ids.map((id) => riattivaNotificaPerUser(id, userId, "dashboard")),
    ),
  );
  return utenti.length;
}

/** **Riattiva** le notifiche di un promemoria modificato: azzera lo stato letto/scartato
 *  delle sue notifiche (id `promem-pre:<id>:*` / `promem-scaduto:<id>:*`) così, se è ancora
 *  in scadenza/scaduto, torna a comparire. Senza questo, un promemoria già scartato resterebbe
 *  invisibile anche dopo una modifica (gli id sono stabili). */
export async function riattivaPromemoria(promemoriaId: string, identity?: Identity): Promise<void> {
  const userId = await userIdStatoNotifiche(identity);
  const recs = await api.recordsList(ENTITA_LETTA);
  const pre = `promem-pre:${promemoriaId}:`;
  const sca = `promem-scaduto:${promemoriaId}:`;
  const notificaIds = [
    ...new Set(
      recs.flatMap((r) => {
        if (r.data.user_id !== userId || typeof r.data.notifica_id !== "string") return [];
        const id = r.data.notifica_id as string;
        return id.startsWith(pre) || id.startsWith(sca) ? [id] : [];
      })
    ),
  ];
  await Promise.all(
    notificaIds.map((notificaId) =>
      api.recordCreateId(ENTITA_LETTA, chiaveLetta(notificaId, userId), {
        notifica_id: notificaId,
        user_id: userId,
        letta: false,
        scartata: false,
        ts: prossimoTsRiattivazione(),
      })
    )
  );
}

/** Quante NON viste (= non lette) tra `notifiche`: è il numero del badge. */
export function contaNonViste(notifiche: Notifica[], viste: Set<string>): number {
  return notifiche.reduce((n, x) => (viste.has(x.id) ? n : n + 1), 0);
}

/** Conteggio della campanella includendo gli stati operativi solo-locali. */
export function contaNonVisteConStatiLocali(
  notifiche: Notifica[],
  viste: Set<string>,
  scartate: Set<string>,
  visteComunicazioniLocali: Set<string>,
  scartateComunicazioniLocali: Set<string>,
): number {
  return notifiche.reduce((totale, notifica) => {
    if (scartate.has(notifica.id)) return totale;
    if (
      notifica.tipo === "comunicazione" &&
      scartateComunicazioniLocali.has(notifica.id)
    ) {
      return totale;
    }
    if (
      viste.has(notifica.id) ||
      (notifica.tipo === "comunicazione" &&
        visteComunicazioniLocali.has(notifica.id))
    ) {
      return totale;
    }
    return totale + 1;
  }, 0);
}

async function rimuoviDaOverlay(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("overlay", EVENTO_OVERLAY_RIMUOVI, ids);
  } catch {
    // Best effort: se l'overlay non esiste, la campanella resta comunque corretta.
  }
}

/** Nasconde i pop-up ordinari quando l'utente apre esplicitamente la campanella.
 * È un evento solo-locale e solo visivo: non crea read-state e non entra nella sync. */
export async function nascondiPopupDaCampanella(): Promise<void> {
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("overlay", "pt:overlay-pulisci");
  } catch {
    // Best effort: la campanella resta utilizzabile anche se l'overlay non esiste.
  }
}

/** Evento mirato alla shell principale per aprire il popover della campanella. */
export const EVENTO_APRI_POPOVER_NOTIFICHE = "pt:apri-popover-notifiche";
const TIMEOUT_APERTURA_POPOVER_MS = 2_000;

export interface RichiestaAperturaPopoverNotifiche {
  ack: string;
}

/** Risveglia la finestra principale e apre la campanella senza cambiare pagina né
 * segnare automaticamente le notifiche come lette. */
export async function apriPopoverNotifichePrincipale(): Promise<void> {
  if (!inTauri) {
    window.dispatchEvent(new CustomEvent(EVENTO_APRI_POPOVER_NOTIFICHE));
    return;
  }
  const [{ getAllWindows }, { emitTo, listen }] = await Promise.all([
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/event"),
  ]);
  const main = (await getAllWindows()).find((finestra) => finestra.label === "main");
  if (!main) throw new Error("Finestra principale non disponibile.");
  await portaFinestraInPrimoPiano(main);

  const ack = `pt:apri-popover-notifiche-ack:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await inviaEventoConConferma({
    ack,
    ascolta: (evento, callback) => listen(evento, callback),
    invia: () => emitTo("main", EVENTO_APRI_POPOVER_NOTIFICHE, {
      ack,
    } satisfies RichiestaAperturaPopoverNotifiche),
    timeoutMs: TIMEOUT_APERTURA_POPOVER_MS,
    messaggioTimeout: "La finestra principale non ha aperto le notifiche.",
  });
}
