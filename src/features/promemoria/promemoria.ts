// Promemoria condivisi del team (FASE 6C). Entità generica `promemoria` (record CRUD):
// testo, scadenza, priorità, ricorrenza, avviso anticipato, entità collegata opzionale.
// Sempre condivisi (bacheca comune); alla chiusura di uno ricorrente si rigenera
// l'occorrenza successiva. Vedi docs/MODELLO-DATI.md §Promemoria.
import { api, type Identity, type RecordDto } from "../../lib/tauri";
import { isoLocale, oggiIso } from "../../lib/date";
import {
  IconStethoscope,
  IconUser,
  IconUsers,
  IconClipboardList,
  type Icon,
} from "@tabler/icons-react";

// Ri-esportati per i consumatori del modulo promemoria (es. BachecaPromemoria).
export { isoLocale };

export type Priorita = "alta" | "media" | "bassa";
export type RicorrenzaTipo = "nessuna" | "settimanale" | "mensile" | "annuale";
export type CollegatoTipo = "cliente" | "medico" | "agente" | "ordine";

export interface PrioritaDef {
  value: Priorita;
  label: string;
  color: string;
  /** Ordinamento: più alto = più urgente (in cima). */
  peso: number;
}

/** Priorità in ordine decrescente di urgenza. */
export const PRIORITA: PrioritaDef[] = [
  { value: "alta", label: "Alta", color: "red", peso: 3 },
  { value: "media", label: "Media", color: "yellow", peso: 2 },
  { value: "bassa", label: "Bassa", color: "gray", peso: 1 },
];

export function prioritaDef(value: string): PrioritaDef {
  return PRIORITA.find((p) => p.value === value) ?? PRIORITA[1];
}

export interface RicorrenzaDef {
  value: RicorrenzaTipo;
  label: string;
}

export const RICORRENZE: RicorrenzaDef[] = [
  { value: "nessuna", label: "Non si ripete" },
  { value: "settimanale", label: "Ogni settimana" },
  { value: "mensile", label: "Ogni mese" },
  { value: "annuale", label: "Ogni anno" },
];

export function ricorrenzaDef(value: string): RicorrenzaDef {
  return RICORRENZE.find((r) => r.value === value) ?? RICORRENZE[0];
}

/** Metadati per tipo di entità collegata (icona/colore/etichetta). */
export const COLLEGATO_META: Record<CollegatoTipo, { label: string; color: string; Ico: Icon }> = {
  cliente: { label: "Cliente", color: "blue", Ico: IconUsers },
  medico: { label: "Medico", color: "teal", Ico: IconStethoscope },
  agente: { label: "Agente", color: "grape", Ico: IconUser },
  ordine: { label: "Ordine", color: "accent", Ico: IconClipboardList },
};

export interface Collegato {
  tipo: CollegatoTipo;
  id: string;
  nome: string;
}

export interface Promemoria {
  id: string;
  testo: string;
  /** YYYY-MM-DD, "" se senza scadenza. */
  scadenza: string;
  priorita: Priorita;
  ricorrenza: RicorrenzaTipo;
  /** Giorni di anticipo dell'avviso (0 = nessuno). Usato dalle notifiche (6D). */
  avvisoAnticipato: number;
  collegatoTipo: CollegatoTipo | "";
  collegatoId: string;
  collegatoNome: string;
  /** Identificativo della "serie" ricorrente: tutte le occorrenze lo condividono, così le
   *  occorrenze rigenerate hanno un id deterministico e non si duplicano in concorrenza.
   *  Vuoto sul primo promemoria (ricade sul suo stesso id). */
  serie: string;
  fatto: boolean;
  fattoDa: string;
  fattoDaNome: string;
  fattoTs: number;
  creatoDa: string;
  creatoDaNome: string;
}

/** Mappa un record grezzo in un Promemoria tipizzato (campi con default robusti). */
export function leggiPromemoria(rec: RecordDto): Promemoria {
  const d = rec.data;
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : 0);
  return {
    id: rec.id,
    testo: s("testo"),
    scadenza: s("scadenza"),
    priorita: (["alta", "media", "bassa"].includes(s("priorita")) ? s("priorita") : "media") as Priorita,
    ricorrenza: (RICORRENZE.some((r) => r.value === s("ricorrenza")) ? s("ricorrenza") : "nessuna") as RicorrenzaTipo,
    avvisoAnticipato: n("avviso_anticipato"),
    collegatoTipo: (["cliente", "medico", "agente", "ordine"].includes(s("collegato_tipo")) ? s("collegato_tipo") : "") as CollegatoTipo | "",
    collegatoId: s("collegato_id"),
    collegatoNome: s("collegato_nome"),
    serie: s("serie"),
    fatto: d.fatto === true,
    fattoDa: s("fatto_da"),
    fattoDaNome: s("fatto_da_nome"),
    fattoTs: n("fatto_ts"),
    creatoDa: s("creato_da"),
    creatoDaNome: s("creato_da_nome"),
  };
}

export type StatoScadenza = "scaduto" | "oggi" | "presto" | "futuro" | "nessuna";


/** Differenza in giorni civili tra due date ISO (b − a). */
export function giorniTra(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  return Math.round((db - da) / 86_400_000);
}

/** Classifica una scadenza rispetto a oggi (con finestra «presto» = avviso anticipato). */
export function statoScadenza(scadenza: string, avvisoAnticipato = 0, oggi = oggiIso()): StatoScadenza {
  if (!scadenza) return "nessuna";
  if (scadenza < oggi) return "scaduto";
  if (scadenza === oggi) return "oggi";
  if (avvisoAnticipato > 0 && giorniTra(oggi, scadenza) <= avvisoAnticipato) return "presto";
  return "futuro";
}

/** Calcola l'occorrenza successiva di una scadenza data la ricorrenza ("" se non ricorre). */
export function prossimaData(scadenza: string, ric: RicorrenzaTipo): string {
  if (!scadenza || ric === "nessuna") return "";
  const d = new Date(scadenza + "T00:00:00");
  if (ric === "settimanale") d.setDate(d.getDate() + 7);
  else if (ric === "mensile") d.setMonth(d.getMonth() + 1);
  else if (ric === "annuale") d.setFullYear(d.getFullYear() + 1);
  return isoLocale(d);
}

/** Ordina i promemoria aperti: prima per scadenza (senza scadenza in fondo), poi per priorità. */
export function ordinaPromemoria(list: Promemoria[]): Promemoria[] {
  return [...list].sort((a, b) => {
    // Le scadenze prima (in ordine), i senza-scadenza in coda.
    if (a.scadenza && b.scadenza && a.scadenza !== b.scadenza) return a.scadenza.localeCompare(b.scadenza);
    if (!!a.scadenza !== !!b.scadenza) return a.scadenza ? -1 : 1;
    return prioritaDef(b.priorita).peso - prioritaDef(a.priorita).peso;
  });
}

interface CampiPromemoria {
  testo: string;
  scadenza: string;
  priorita: Priorita;
  ricorrenza: RicorrenzaTipo;
  avvisoAnticipato: number;
  collegato?: Collegato | null;
}

function fields(c: CampiPromemoria): Record<string, unknown> {
  return {
    testo: c.testo,
    scadenza: c.scadenza,
    priorita: c.priorita,
    ricorrenza: c.ricorrenza,
    avviso_anticipato: c.avvisoAnticipato,
    collegato_tipo: c.collegato?.tipo ?? "",
    collegato_id: c.collegato?.id ?? "",
    collegato_nome: c.collegato?.nome ?? "",
  };
}

/** Elenco di tutti i promemoria del team (anche i completati). */
export async function listaPromemoria(): Promise<Promemoria[]> {
  const recs = await api.recordsList("promemoria");
  return recs.map(leggiPromemoria);
}

/** Crea un nuovo promemoria (condiviso). `creato_da` dall'identità corrente. */
export async function creaPromemoria(c: CampiPromemoria, identity?: Identity): Promise<RecordDto> {
  return api.recordCreate("promemoria", {
    ...fields(c),
    fatto: false,
    creato_da: identity?.userId ?? "",
    creato_da_nome: identity?.nome ?? "",
  });
}

/** Aggiorna i campi di un promemoria esistente. */
export async function aggiornaPromemoria(id: string, c: CampiPromemoria): Promise<RecordDto> {
  return api.recordUpdate("promemoria", id, fields(c));
}

/** Posticipa (snooze) la scadenza di un promemoria. */
export async function posticipaPromemoria(id: string, nuovaScadenza: string): Promise<void> {
  await api.recordUpdate("promemoria", id, { scadenza: nuovaScadenza });
}

/** Marca un promemoria come fatto; se ricorrente, rigenera l'occorrenza successiva.
 *  L'occorrenza rigenerata ha un **id deterministico** `prom-<serie>-<dataOcc>`: due
 *  dispositivi che completano in concorrenza lo stesso ricorrente creano lo **stesso**
 *  record (la proiezione è idempotente sul Created + LWW per-campo) → niente duplicati.
 *  Ritorna il record rigenerato, se creato. */
export async function completaPromemoria(p: Promemoria, identity?: Identity): Promise<RecordDto | null> {
  await api.recordUpdate("promemoria", p.id, {
    fatto: true,
    fatto_da: identity?.userId ?? "",
    fatto_da_nome: identity?.nome ?? "",
    fatto_ts: Date.now(),
  });
  if (p.ricorrenza !== "nessuna" && p.scadenza) {
    const prossima = prossimaData(p.scadenza, p.ricorrenza);
    if (prossima) {
      // Serie stabile: quella ereditata, o (prima occorrenza) l'id stesso del promemoria.
      const serie = p.serie || p.id;
      const nuovoId = `prom-${serie}-${prossima}`;
      const ric = await api.recordCreateId("promemoria", nuovoId, {
        ...fields({
          testo: p.testo,
          scadenza: prossima,
          priorita: p.priorita,
          ricorrenza: p.ricorrenza,
          avvisoAnticipato: p.avvisoAnticipato,
          collegato: p.collegatoTipo ? { tipo: p.collegatoTipo, id: p.collegatoId, nome: p.collegatoNome } : null,
        }),
        serie,
        fatto: false,
        creato_da: p.creatoDa || identity?.userId || "",
        creato_da_nome: p.creatoDaNome || identity?.nome || "",
      });
      return ric;
    }
  }
  return null;
}

export async function eliminaPromemoria(id: string): Promise<void> {
  await api.recordDelete("promemoria", id);
}

/** Riapre un promemoria completato (annulla il «fatto»). */
export async function riapriPromemoria(id: string): Promise<void> {
  await api.recordUpdate("promemoria", id, { fatto: false, fatto_da: "", fatto_da_nome: "", fatto_ts: 0 });
}
