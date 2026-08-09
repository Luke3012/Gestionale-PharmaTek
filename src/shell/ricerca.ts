// Motore della ricerca globale (FASE 6A). Condiviso dalla barra Spotlight.
// Carica una volta i dati (ordini + anagrafiche + distinte + spedizioni) e
// costruisce le voci di risultato a partire dalla query. Ogni voce porta un
// "bersaglio" azionabile che la finestra Spotlight sa eseguire.
//
// Ricerca a PIÙ TERMINI (AND): "gls 10/04/2025" e "10/04/2025 gls" trovano le
// stesse cose (tutti i termini devono comparire). Le date si riconoscono sia in
// formato ISO (2025-04-10) sia italiano (10/04/2025): basta che il termine
// compaia nel "blob" dell'elemento, che include entrambe le forme.
import {
  IconAddressBook,
  IconBell,
  IconBellPlus,
  IconCashBanknote,
  IconCalendarDue,
  IconClipboardList,
  IconDeviceGamepad2,
  IconDownload,
  IconFileInvoice,
  IconFileSpreadsheet,
  IconInfoCircle,
  IconLayoutDashboard,
  IconLeaf,
  IconMessage,
  IconSend,
  IconPackage,
  IconReceiptRefund,
  IconRefresh,
  IconSettings,
  IconStethoscope,
  IconTestPipe,
  IconTruck,
  IconTruckDelivery,
  IconTrash,
  IconTruckLoading,
  IconUser,
  IconUsers,
  IconVaccine,
  IconWallet,
  type Icon,
} from "@tabler/icons-react";
import { api, type Distinta, type OrdineDaSpedire, type OrdineDto, type PagamentoVista, type Preventivo, type RecordDto, type Spedizione, type UserDto } from "../lib/tauri";
import { oggiIso } from "../lib/date";
import { statoDef } from "../features/giornaliero/stati";
import { listaPromemoria, type Promemoria } from "../features/promemoria/promemoria";
import { DEST_TUTTI, listaDestinatariMessaggi } from "../features/notifiche/messaggi";
import { chiaviTop } from "./frecency";
import { testoRicercaPreventivo } from "../features/preventivi/ricercaPreventivi";

/** Azione collegata a un risultato: la Spotlight la esegue al click/Invio. */
export type Bersaglio =
  | {
      t: "naviga";
      path: string;
      tab?: string;
      cerca?: string;
      apriId?: string;
      dal?: string;
      al?: string;
      stati?: string[];
      spedito?: "spediti" | "non";
      regione?: string;
      agente?: string;
      marcatori?: string[];
      statiPagamento?: string[];
      contoId?: string;
      contoNome?: string;
      contoIds?: string[];
      spedizioneLotti?: string[];
      agenteIds?: string[];
      medicoIds?: string[];
      linee?: string[];
      corriereNomi?: string[];
      rimborsoStati?: string[];
      rimborsoOrigini?: string[];
      produzioneAcconto?: "incassato" | "atteso";
      mostraAltreSpedizioni?: boolean;
      provvigioniOrdina?: "maturato" | "potenziale" | "nome";
      agenteId?: string;
      critici?: boolean;
      azione?:
        | "nuovo_rimborso"
        | "nuova_distinta"
        | "importa_giornaliero"
        | "esporta_aruba"
        | "pulizia_dati"
        | "bollettazione_automatica";
    }
  | { t: "sync" }
  | { t: "promemoria" }
  | { t: "promemoria_apri"; id: string }
  | { t: "ordine_nuovo" }
  | { t: "preventivo_nuovo" }
  | { t: "preventivo"; ordineId: string; numero: string }
  | { t: "notifiche" }
  | { t: "cestino" }
  | { t: "ordine"; id: string; numero: string; focus?: { sezione?: "pagamenti"; pagamentoId?: string } }
  | { t: "pagamento"; id: string }
  | { t: "entita"; tipo: "cliente" | "medico" | "agente"; id: string; nome: string }
  | { t: "info"; target?: "gioco" | "aggiornamenti" | "novita" }
  | { t: "centro_comunicazioni" }
  | { t: "messaggio_compose"; destinatario: string; destinatarioNome: string }
  | { t: "messaggio_invia"; destinatario: string; destinatarioNome: string; testo: string };

export interface VoceRicerca {
  id: string;
  gruppo: string;
  label: string;
  sub?: string;
  dettagli?: string[];
  completion?: string;
  /** Riga solo informativa: non esegue azioni con click o Invio. */
  disabled?: boolean;
  dedupeKey?: string;
  Ico: Icon;
  bersaglio: Bersaglio;
}

export interface DatiRicerca {
  ordini: OrdineDto[];
  preventivi: Preventivo[];
  cliente: RecordDto[];
  medico: RecordDto[];
  agente: RecordDto[];
  prodotto: RecordDto[];
  corriere: RecordDto[];
  conto: RecordDto[];
  distinte: Distinta[];
  spedizioni: Spedizione[];
  daSpedire: OrdineDaSpedire[];
  pagamenti: PagamentoVista[];
  promemoria: Promemoria[];
  utenti: UserDto[];
}

type Indicizzato<T> = T & { _ricerca?: string };

export const DATI_VUOTI: DatiRicerca = {
  ordini: [],
  preventivi: [],
  cliente: [],
  medico: [],
  agente: [],
  prodotto: [],
  corriere: [],
  conto: [],
  distinte: [],
  spedizioni: [],
  daSpedire: [],
  pagamenti: [],
  promemoria: [],
  utenti: [],
};

/** Carica i dati ricercabili. Resiliente: ciò che non risponde resta vuoto. 
 *  I dati storici (ordini, distinte, spedizioni) vengono filtrati per l'anno passato in input se diverso da 0.
*/
export async function caricaDatiRicerca(annoG: number = 0): Promise<DatiRicerca> {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
  const [ordini, preventivi, cliente, medico, agente, prodotto, corriere, conto, distinte, spedizioni, daSpedire, pagamenti, promemoria, utenti] = await Promise.all([
    safe(api.ordiniLista(), [] as OrdineDto[]),
    safe(api.preventiviLista(), [] as Preventivo[]),
    safe(api.recordsList("cliente"), [] as RecordDto[]),
    safe(api.recordsList("medico"), [] as RecordDto[]),
    safe(api.recordsList("agente"), [] as RecordDto[]),
    safe(api.recordsList("prodotto"), [] as RecordDto[]),
    safe(api.recordsList("corriere"), [] as RecordDto[]),
    safe(api.recordsList("conto"), [] as RecordDto[]),
    safe(api.distinteLista(), [] as Distinta[]),
    safe(api.spedizioniLista(), [] as Spedizione[]),
    safe(api.righeDaSpedire(), [] as OrdineDaSpedire[]),
    safe(api.pagamentiVista(), [] as PagamentoVista[]),
    safe(listaPromemoria(), [] as Promemoria[]),
    safe(listaDestinatariMessaggi(), [] as UserDto[]),
  ]);

  let ordiniFiltrati = ordini;
  let preventiviFiltrati = preventivi;
  let distinteFiltrate = distinte;
  let spedizioniFiltrate = spedizioni;
  let daSpedireFiltrati = daSpedire;
  let pagamentiFiltrati = pagamenti;
  let promemoriaFiltrati = promemoria;

  if (annoG !== 0) {
    ordiniFiltrati = ordini.filter((o) => Number(o.data.slice(0, 4)) === annoG);
    preventiviFiltrati = preventivi.filter(
      (preventivo) =>
        new Date(preventivo.creatoMs).getFullYear() === annoG,
    );
    const ordiniAnno = new Set(ordiniFiltrati.map((o) => o.id));
    distinteFiltrate = distinte.filter((d) => Number(d.dataDistinta.slice(0, 4)) === annoG);
    spedizioniFiltrate = spedizioni.filter((s) => Number(s.data.slice(0, 4)) === annoG);
    daSpedireFiltrati = daSpedire.filter((o) => Number(o.data.slice(0, 4)) === annoG);
    pagamentiFiltrati = pagamenti.filter((p) => ordiniAnno.has(p.ordineId));
    promemoriaFiltrati = promemoria.filter((p) => !p.scadenza || Number(p.scadenza.slice(0, 4)) === annoG);
  }

  const telefonoPerAnagrafica = new Map(
    [...cliente, ...medico, ...agente].map((record) => [
      record.id,
      blobTelefono(record.data.telefono),
    ]),
  );
  const ordinePerId = new Map(ordiniFiltrati.map((ordine) => [ordine.id, ordine]));

  return {
    ordini: ordiniFiltrati.map((o) =>
      indicizza(o, `${o.numero} ${blobData(o.data)} ${o.clienteNome} ${o.medicoNome} ${o.agenteNome} ${blobTelefono(o.clienteTelefono)} ${blobLottiOrdine(o)}`)
    ),
    preventivi: preventiviFiltrati.map((preventivo) =>
      indicizza(
        preventivo,
        `preventivo ${preventivo.linee.join(" ")} ${testoRicercaPreventivo(preventivo)}`,
      ),
    ),
    cliente: cliente.map((r) => indicizza(r, `${nomeDi(r)} ${r.data.citta ?? ""} ${r.data.regione ?? ""} ${blobTelefono(r.data.telefono)}`)),
    medico: medico.map((r) => indicizza(r, `${nomeDi(r)} ${r.data.regione ?? ""} ${blobTelefono(r.data.telefono)}`)),
    agente: agente.map((r) => indicizza(r, `${nomeDi(r)} ${blobTelefono(r.data.telefono)}`)),
    prodotto: prodotto.map((r) => indicizza(r, `${nomeDi(r)} ${r.data.categoria ?? ""}`)),
    corriere: corriere.map((r) => indicizza(r, nomeDi(r))),
    conto: conto.map((r) => indicizza(r, nomeDi(r))),
    distinte: distinteFiltrate.map((d) => indicizza(d, `${d.corriereNome} ${blobData(d.dataDistinta)} ${blobData(d.dataAccredito)}`)),
    spedizioni: spedizioniFiltrate.map((s) =>
      indicizza(
        s,
        `${s.lotto} ${s.corriereNome} ${blobData(s.data)} ${s.clienteNome} ${s.numero} ${blobTelefono(s.telefono)} ${s.righe
          .map((r) => `${r.ordineNumero} ${r.clienteNome} ${r.prodottoNome} ${r.numero}`)
          .join(" ")}`
      )
    ),
    daSpedire: daSpedireFiltrati.map((o) =>
      indicizza(o, `${o.numero} ${blobData(o.data)} ${o.clienteNome} ${o.medicoNome} ${o.agenteNome} ${o.citta} ${o.regione} ${blobTelefono(o.telefono)}`)
    ),
    pagamenti: pagamentiFiltrati.map((p) => {
      const ordine = ordinePerId.get(p.ordineId);
      const telefono =
        telefonoPerAnagrafica.get(p.clienteId) ??
        telefonoPerAnagrafica.get(p.medicoId) ??
        "";
      return indicizza(p, `${p.ordineNumero} ${p.clienteNome} ${p.medicoNome} ${p.contoNome} ${blobData(p.scadenza)} ${telefono} ${ordine ? blobLottiOrdine(ordine) : ""}`);
    }),
    promemoria: promemoriaFiltrati.map((p) => indicizza(p, `${p.testo} ${p.collegatoNome ?? ""}`)),
    utenti,
  };
}

function indicizza<T>(item: T, blob: string): T {
  return Object.assign(item as object, { _ricerca: blob.toLowerCase() }) as T;
}

function blobIndicizzato(item: unknown, fallback: () => string): string {
  return (item as Indicizzato<unknown>)._ricerca ?? fallback().toLowerCase();
}

function nomeDi(r: RecordDto): string {
  return (r.data.nome as string) || "(senza nome)";
}

function blobTelefono(valore: unknown): string {
  const telefono = String(valore ?? "");
  return `${telefono} ${telefono.replace(/\D/g, "")}`;
}

const EUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
function euro(cent: number): string {
  return EUR.format((cent || 0) / 100);
}

/** Date in formato italiano dd/mm/yyyy (per mostrarle nei risultati). */
function dataIt(iso: string): string {
  if (!iso || iso.length < 10) return iso || "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Forme cercabili di una data ISO: sia "2025-04-10" sia "10/04/2025" (così un
 *  termine in uno dei due formati combacia). */
function blobData(iso: string): string {
  if (!iso) return "";
  return `${iso} ${dataIt(iso)}`;
}

function blobLottiOrdine(o: OrdineDto): string {
  return (o.numeriLotto ?? []).join(" ");
}

function estremiSettimana(): { dal: string; al: string } {
  const d = new Date();
  const giorno = (d.getDay() + 6) % 7;
  const lunedi = new Date(d);
  lunedi.setDate(d.getDate() - giorno);
  const domenica = new Date(lunedi);
  domenica.setDate(lunedi.getDate() + 6);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { dal: iso(lunedi), al: iso(domenica) };
}

function pagamentoPotenziale(p: PagamentoVista): boolean {
  return !p.saldato && p.ordineStato === "Nuovo";
}

function statoTemporalePagamento(p: PagamentoVista, oggi = oggiIso()): string {
  if (p.saldato) return p.verificato ? "Saldato" : "Da verificare";
  if (pagamentoPotenziale(p)) return "Potenziale";
  if (!p.scadenza) return "Atteso";
  if (p.scadenza < oggi) return "Scaduto";
  if (p.scadenza === oggi) return "Oggi";
  const giorni = Math.round((new Date(p.scadenza + "T00:00:00").getTime() - new Date(oggi + "T00:00:00").getTime()) / 86_400_000);
  return `Tra ${giorni} ${giorni === 1 ? "giorno" : "giorni"}`;
}

export function chiaveBersaglio(b: Bersaglio): string {
  switch (b.t) {
    case "naviga":
      return `nav:${b.path}:${b.tab ?? ""}:${b.cerca ?? ""}:${b.apriId ?? ""}:${b.dal ?? ""}:${b.al ?? ""}:${b.azione ?? ""}:${b.contoId ?? b.contoNome ?? ""}:${(b.contoIds ?? []).join(",")}:${(b.spedizioneLotti ?? []).join(",")}:${(b.agenteIds ?? []).join(",")}:${(b.medicoIds ?? []).join(",")}:${(b.linee ?? []).join(",")}:${(b.corriereNomi ?? []).join(",")}:${b.critici ? "critici" : ""}:${(b.statiPagamento ?? []).join(",")}:${(b.marcatori ?? []).join(",")}`;
    case "ordine":
      return `ordine:${b.id}`;
    case "preventivo":
      return `preventivo:${b.ordineId}`;
    case "pagamento":
      return `pagamento:${b.id}`;
    case "entita":
      return `entita:${b.tipo}:${b.id}`;
    case "info":
      return `info:${b.target ?? ""}`;
    case "centro_comunicazioni":
      return "centro-comunicazioni";
    case "messaggio_compose":
      return `msg-compose:${b.destinatario}`;
    case "messaggio_invia":
      return `msg-invia:${b.destinatario}:${b.testo}`;
    default:
      return b.t;
  }
}

function conDedupe(v: VoceRicerca): VoceRicerca {
  return { ...v, dedupeKey: v.dedupeKey ?? chiaveBersaglio(v.bersaglio) };
}

/** Icona del prodotto secondo la categoria (coerente con i registri). */
function icoProdotto(r: RecordDto): Icon {
  const c = String(r.data.categoria ?? "");
  if (c === "Diagnostica") return IconTestPipe;
  if (c === "Keriba") return IconLeaf;
  return IconVaccine;
}

interface ComandoRicerca {
  id: string;
  label: string;
  Ico: Icon;
  bersaglio: Bersaglio | ((oggi: string) => Bersaglio);
  sub?: string;
  completion?: string;
  dedupeKey?: string;
  gruppo?: string;
}

const COMANDI: ComandoRicerca[] = [
  { id: "c-messaggio", gruppo: "Comandi rapidi", label: "Messaggio", sub: "Scrivi a un utente", completion: "messaggio ", Ico: IconMessage, bersaglio: { t: "messaggio_compose", destinatario: DEST_TUTTI, destinatarioNome: "Tutti" }, dedupeKey: "msg-completa-prefisso" },
  { id: "smart-promemoria", gruppo: "Comandi rapidi", label: "Promemoria", sub: "Filtra per giorno o periodo", completion: "promemoria ", Ico: IconBell, bersaglio: { t: "notifiche" }, dedupeKey: "promemoria-completa-prefisso" },
  { id: "smart-pagamenti", gruppo: "Comandi rapidi", label: "Pagamenti", sub: "Combina stato, linea, conto, medico e agente", completion: "pagamenti ", Ico: IconCashBanknote, bersaglio: { t: "naviga", path: "/contabilita", tab: "pagamenti" }, dedupeKey: "pagamenti-completa-prefisso" },
  { id: "smart-spedizioni", gruppo: "Comandi rapidi", label: "Spedizioni", sub: "Filtra le effettuate per giorno o periodo", completion: "spedizioni ", Ico: IconTruckLoading, bersaglio: { t: "naviga", path: "/evasione", tab: "effettuate" }, dedupeKey: "spedizioni-completa-prefisso" },
  { id: "c-nuovo", label: "Nuovo ordine", Ico: IconClipboardList, bersaglio: { t: "ordine_nuovo" } },
  { id: "c-nuovo-rimborso", label: "Nuovo rimborso", Ico: IconReceiptRefund, bersaglio: { t: "naviga", path: "/contabilita", tab: "rimborsi", azione: "nuovo_rimborso" } },
  { id: "c-nuova-distinta", label: "Nuova distinta corriere", Ico: IconTruckDelivery, bersaglio: { t: "naviga", path: "/contabilita", tab: "distinte", azione: "nuova_distinta" } },
  { id: "c-nuovo-promemoria", label: "Nuovo promemoria", Ico: IconBellPlus, bersaglio: { t: "promemoria" } },
  { id: "c-notifiche", label: "Visualizza notifiche", Ico: IconBell, bersaglio: { t: "notifiche" } },
  { id: "c-cestino", label: "Apri il Cestino", Ico: IconTrash, bersaglio: { t: "cestino" } },
  { id: "c-dash", label: "Vai a Dashboard", Ico: IconLayoutDashboard, bersaglio: { t: "naviga", path: "/" } },
  { id: "c-gior", label: "Vai a Giornaliero", Ico: IconClipboardList, bersaglio: { t: "naviga", path: "/giornaliero" } },
  { id: "c-prod", label: "Vai a Produzione", Ico: IconPackage, bersaglio: { t: "naviga", path: "/produzione" } },
  { id: "c-evas", label: "Vai a Spedizioni", Ico: IconTruck, bersaglio: { t: "naviga", path: "/evasione" } },
  { id: "c-cont", label: "Vai a Contabilità", Ico: IconWallet, bersaglio: { t: "naviga", path: "/contabilita" } },
  { id: "c-cred", label: "Vai a Crediti", Ico: IconWallet, bersaglio: { t: "naviga", path: "/contabilita", tab: "pagamenti" } },
  { id: "c-dist", gruppo: "Comandi rapidi", label: "Distinte corrieri", sub: "Filtra per corriere", completion: "distinte ", Ico: IconTruckDelivery, bersaglio: { t: "naviga", path: "/contabilita", tab: "distinte" } },
  { id: "c-provv", gruppo: "Comandi rapidi", label: "Provvigioni", sub: "Filtra per agente, periodo o ordinamento", completion: "provvigioni ", Ico: IconCashBanknote, bersaglio: { t: "naviga", path: "/contabilita", tab: "provvigioni" } },
  { id: "c-rimborsi", gruppo: "Comandi rapidi", label: "Rimborsi", sub: "Filtra per stato, origine o periodo", completion: "rimborsi ", Ico: IconReceiptRefund, bersaglio: { t: "naviga", path: "/contabilita", tab: "rimborsi" } },
  { id: "c-fornitore-lavorazione", gruppo: "Comandi rapidi", label: "Laboratorio — ordini in lavorazione", sub: "Filtra per agente, acconto o periodo", completion: "fornitore ", Ico: IconTestPipe, bersaglio: { t: "naviga", path: "/produzione", tab: "in_lavorazione" } },
  { id: "c-anag", label: "Vai a Anagrafiche", Ico: IconAddressBook, bersaglio: { t: "naviga", path: "/anagrafiche" } },
  { id: "c-impo", label: "Vai a Impostazioni", Ico: IconSettings, bersaglio: { t: "naviga", path: "/impostazioni" } },
  { id: "c-sync", label: "Forza sincronizzazione", Ico: IconRefresh, bersaglio: { t: "sync" } },
  { id: "c-importa-storici", label: "Importa clienti storici", Ico: IconDownload, bersaglio: { t: "naviga", path: "/impostazioni", azione: "importa_giornaliero" } },
  { id: "c-esporta-aruba", label: "Esporta clienti Aruba", Ico: IconDownload, bersaglio: { t: "naviga", path: "/impostazioni", azione: "esporta_aruba" } },
  { id: "c-pulizia-dati", label: "Mostra Pulizia dati", Ico: IconTrash, bersaglio: { t: "naviga", path: "/impostazioni", azione: "pulizia_dati" } },
  { id: "c-flappy", label: "Gioca a Flappy Utente Demo", Ico: IconDeviceGamepad2, bersaglio: { t: "info", target: "gioco" } },
  { id: "c-check-agg", label: "Controlla aggiornamenti", Ico: IconDownload, bersaglio: { t: "info", target: "aggiornamenti" } },
  { id: "c-novita", label: "Novità di questa versione", Ico: IconInfoCircle, bersaglio: { t: "info", target: "novita" } },
];

const MAX_PER_GRUPPO = 8;
const MAX_TOTALE = 50;

/** Definizione dei gruppi anagrafici cercabili (riusata da ricerca e suggeriti). */
interface GruppoEntita {
  entity: "cliente" | "medico" | "agente";
  gruppo: string;
  Ico: Icon;
  blob: (r: RecordDto) => string;
  sub?: (r: RecordDto) => string | undefined;
  bersaglio: (r: RecordDto) => Bersaglio;
}

const GRUPPI_ENTITA: GruppoEntita[] = [
  {
    entity: "cliente",
    gruppo: "Clienti",
    Ico: IconUsers,
    blob: (r) => `${nomeDi(r)} ${r.data.citta ?? ""} ${r.data.regione ?? ""} ${blobTelefono(r.data.telefono)}`,
    sub: (r) => [r.data.citta, r.data.regione].filter(Boolean).join(", ") || undefined,
    bersaglio: (r) => ({ t: "entita", tipo: "cliente", id: r.id, nome: nomeDi(r) }),
  },
  {
    entity: "medico",
    gruppo: "Medici",
    Ico: IconStethoscope,
    blob: (r) => `${nomeDi(r)} ${r.data.regione ?? ""} ${blobTelefono(r.data.telefono)}`,
    sub: (r) => (r.data.regione as string) || undefined,
    bersaglio: (r) => ({ t: "entita", tipo: "medico", id: r.id, nome: nomeDi(r) }),
  },
  {
    entity: "agente",
    gruppo: "Agenti",
    Ico: IconUser,
    blob: (r) => `${nomeDi(r)} ${blobTelefono(r.data.telefono)}`,
    bersaglio: (r) => ({ t: "entita", tipo: "agente", id: r.id, nome: nomeDi(r) }),
  },
];

/** Voce di ricerca per un ordine (riusata da ricerca e suggeriti). */
function voceOrdine(o: OrdineDto): VoceRicerca {
  const sub = [dataIt(o.data), statoDef(o.stato).label].filter(Boolean);
  const lotti = (o.numeriLotto ?? []).filter(Boolean);
  if (o.residuo > 0) sub.push(`da saldare ${euro(o.residuo)}`);
  const dettagli = [o.medicoNome && `Medico ${o.medicoNome}`, o.agenteNome && `Agente ${o.agenteNome}`].filter(Boolean) as string[];
  if (o.totale > 0) dettagli.push(`${euro(o.totale)} totali · ${euro(o.incassato)} incassati`);
  if (lotti.length > 0) dettagli.push(`Lotti ${lotti.slice(0, 4).join(", ")}${lotti.length > 4 ? "…" : ""}`);
  return conDedupe({
    id: `o-${o.id}`,
    gruppo: "Ordini",
    label: `${o.numero} · ${o.clienteNome || "—"}`,
    sub: sub.slice(0, 2).join(" · "),
    dettagli,
    Ico: IconClipboardList,
    bersaglio: { t: "ordine", id: o.id, numero: o.numero },
  });
}

function vocePreventivo(preventivo: Preventivo): VoceRicerca {
  const dataCreazione = preventivo.creatoMs
    ? new Date(preventivo.creatoMs).toLocaleDateString("it-IT")
    : "";
  return conDedupe({
    id: `preventivo-${preventivo.id}`,
    gruppo: "Preventivi",
    label: `${preventivo.numeroPreventivo} · ${preventivo.clienteNome || "—"}`,
    sub: [dataCreazione, preventivo.linee[0]].filter(Boolean).join(" · "),
    dettagli: [
      `Ordine ${preventivo.ordineNumero}`,
      preventivo.totale > 0 ? euro(preventivo.totale) : "",
    ].filter(Boolean),
    Ico: IconFileInvoice,
    bersaglio: {
      t: "preventivo",
      ordineId: preventivo.ordineId,
      numero: preventivo.numeroPreventivo,
    },
  });
}

/** Voce di ricerca per un'anagrafica. */
function voceEntita(g: GruppoEntita, r: RecordDto): VoceRicerca {
  return conDedupe({ id: `${g.entity}-${r.id}`, gruppo: g.gruppo, label: nomeDi(r), sub: g.sub?.(r), Ico: g.Ico, bersaglio: g.bersaglio(r) });
}

/** Voce «salda rapido» per un credito non ancora incassato. */
function vocePagamento(p: PagamentoVista): VoceRicerca {
  const tipo = p.tipo ? p.tipo.charAt(0).toUpperCase() + p.tipo.slice(1) : "Pagamento";
  const stato = statoTemporalePagamento(p);
  const sub = [stato, euro(p.importo)].filter(Boolean).join(" · ");
  return conDedupe({
    id: `pag-${p.id}`,
    gruppo: "Salda crediti",
    label: `${p.ordineNumero || "Pagamento"} · ${p.clienteNome || "—"}`,
    sub,
    dettagli: [tipo, p.scadenza ? `Scadenza ${dataIt(p.scadenza)}` : "", p.contoNome ? `Conto ${p.contoNome}` : ""].filter(Boolean),
    Ico: IconCashBanknote,
    bersaglio: { t: "pagamento", id: p.id },
  });
}

/** Voci «di interesse» (frecency): mostrate in cima a barra vuota, ricostruite dai
 *  dati correnti così restano valide (salta ciò che nel frattempo è stato eliminato). */
export function costruisciSuggeriti(dati: DatiRicerca): VoceRicerca[] {
  const out: VoceRicerca[] = [];
  const oggi = oggiIso();
  for (const k of chiaviTop(6)) {
    if (k.startsWith("c-")) {
      const c = COMANDI.find((x) => x.id === k);
      if (c) out.push(voceComando(c, "", oggi, "Suggeriti"));
    } else if (k.startsWith("o-")) {
      const o = dati.ordini.find((x) => `o-${x.id}` === k);
      if (o) out.push({ ...voceOrdine(o), gruppo: "Suggeriti" });
    } else {
      const g = GRUPPI_ENTITA.find((gg) => k.startsWith(`${gg.entity}-`));
      if (g) {
        const r = (dati[g.entity] as RecordDto[]).find((x) => x.id === k.slice(g.entity.length + 1));
        if (r) out.push({ ...voceEntita(g, r), gruppo: "Suggeriti" });
      }
    }
  }
  return applicaContesto(out, dati);
}

/** Vero se l'id di una voce va tracciato per i suggeriti (ordini/anagrafiche/comandi). */
export function tracciabile(id: string): boolean {
  return (
    id.startsWith("c-") ||
    id.startsWith("o-") ||
    GRUPPI_ENTITA.some((g) => id.startsWith(`${g.entity}-`))
  );
}

function applicaContesto(voci: VoceRicerca[], dati: DatiRicerca): VoceRicerca[] {
  if (voci.length === 0) return voci;
  const ordiniPerEntita = new Map<string, { n: number; ultimo: string; credito: number }>();
  const addEntita = (key: string, o: OrdineDto) => {
    const cur = ordiniPerEntita.get(key) ?? { n: 0, ultimo: "", credito: 0 };
    cur.n += 1;
    if (o.data > cur.ultimo) cur.ultimo = o.data;
    cur.credito += Math.max(0, o.residuo || 0);
    ordiniPerEntita.set(key, cur);
  };
  for (const o of dati.ordini) {
    if (o.clienteId) addEntita(`cliente:${o.clienteId}`, o);
    if (o.medicoId) addEntita(`medico:${o.medicoId}`, o);
    if (o.agenteId) addEntita(`agente:${o.agenteId}`, o);
  }

  return voci.map((v) => {
    if (v.bersaglio.t === "entita") {
      const agg = ordiniPerEntita.get(`${v.bersaglio.tipo}:${v.bersaglio.id}`);
      if (!agg) return v;
      const dettagli = [
        `${agg.n} ${agg.n === 1 ? "ordine" : "ordini"}`,
        agg.ultimo ? `ultimo ${dataIt(agg.ultimo)}` : "",
        agg.credito > 0 ? `credito ${euro(agg.credito)}` : "",
      ].filter(Boolean) as string[];
      return { ...v, dettagli: [...(v.dettagli ?? []), ...dettagli].slice(0, 3) };
    }
    return v;
  });
}

function voceSmart(args: Omit<VoceRicerca, "gruppo" | "dedupeKey"> & { dedupeKey: string }): VoceRicerca {
  return conDedupe({ ...args, gruppo: "Comandi rapidi" });
}

function normalizzaTesto(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const PREFISSI_MESSAGGIO = ["messaggio", "scrivi", "scrivi a", "invia messaggio", "invia messaggio a"];
const ALIAS_MESSAGGIO = ["msg"];
const PREFISSO_PROMEMORIA = "promemoria";
const ALIAS_PROMEMORIA = ["prom"];

type QueryMessaggio =
  | { tipo: "completa_prefisso"; completion: string }
  | { tipo: "attiva"; resto: string };

function completaParola(query: string, target: string): string {
  const trimmedEnd = query.trimEnd();
  const parts = target.split(/\s+/);
  const current = normalizzaTesto(trimmedEnd);
  const targetNorm = normalizzaTesto(target);
  if (current === targetNorm) return `${target} `;
  for (let i = 0; i < parts.length; i++) {
    const partial = parts.slice(0, i + 1).join(" ");
    if (normalizzaTesto(partial).startsWith(current)) return `${partial} `;
  }
  return `${target} `;
}

function bersaglioComando(c: ComandoRicerca, oggi: string): Bersaglio {
  return typeof c.bersaglio === "function" ? c.bersaglio(oggi) : c.bersaglio;
}

function completionComando(query: string, c: ComandoRicerca): string | undefined {
  if (c.completion && query.trim() === "") return c.completion;
  if (query.trim() === "") return undefined;
  const target = (c.completion ?? c.label).trim();
  if (normalizzaTesto(query.trimEnd()) === normalizzaTesto(target)) return undefined;
  return completaParola(query, target);
}

function voceComando(c: ComandoRicerca, query: string, oggi: string, gruppo = c.gruppo ?? "Comandi"): VoceRicerca {
  return conDedupe({
    id: c.id,
    gruppo,
    label: c.label,
    sub: c.sub,
    completion: completionComando(query, c),
    Ico: c.Ico,
    bersaglio: bersaglioComando(c, oggi),
    dedupeKey: c.dedupeKey,
  });
}

function queryMessaggio(query: string): QueryMessaggio | null {
  const raw = query.trimStart();
  const q = normalizzaTesto(raw);
  const finisceConSpazio = /\s$/.test(raw);
  if (!q) return null;

  if (ALIAS_MESSAGGIO.includes(q) && finisceConSpazio) return { tipo: "attiva", resto: "" };
  if (ALIAS_MESSAGGIO.includes(q)) return { tipo: "completa_prefisso", completion: "messaggio " };

  const prefissoEsatto = PREFISSI_MESSAGGIO
    .filter((p) => q === p)
    .sort((a, b) => b.length - a.length)[0];
  if (prefissoEsatto && finisceConSpazio) return { tipo: "attiva", resto: "" };

  const attivo = PREFISSI_MESSAGGIO
    .filter((p) => q.startsWith(`${p} `))
    .sort((a, b) => b.length - a.length)[0];
  if (attivo) return { tipo: "attiva", resto: raw.slice(attivo.length).trimStart() };

  const prefisso = PREFISSI_MESSAGGIO
    .filter((p) => normalizzaTesto(p).startsWith(q))
    .sort((a, b) => a.length - b.length)[0];
  if (prefisso) return { tipo: "completa_prefisso", completion: completaParola(raw, prefisso) };

  return null;
}

type QueryPromemoria =
  | { tipo: "completa_prefisso"; completion: string }
  | { tipo: "attiva"; resto: string };

function queryPromemoria(query: string): QueryPromemoria | null {
  const raw = query.trimStart();
  const q = normalizzaTesto(raw);
  const finisceConSpazio = /\s$/.test(raw);
  if (!q) return null;
  if (ALIAS_PROMEMORIA.includes(q) && finisceConSpazio) return { tipo: "attiva", resto: "" };
  if (ALIAS_PROMEMORIA.includes(q)) return { tipo: "completa_prefisso", completion: "promemoria " };
  if (q === PREFISSO_PROMEMORIA && finisceConSpazio) return { tipo: "attiva", resto: "" };
  if (q.startsWith(`${PREFISSO_PROMEMORIA} `)) return { tipo: "attiva", resto: raw.slice(PREFISSO_PROMEMORIA.length).trimStart() };
  if (PREFISSO_PROMEMORIA.startsWith(q)) return { tipo: "completa_prefisso", completion: completaParola(raw, PREFISSO_PROMEMORIA) };
  return null;
}

function isoLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function aggiungiGiorni(iso: string, giorni: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + giorni);
  return isoLocalDate(d);
}

function estremiMese(): { dal: string; al: string } {
  const d = new Date();
  const dal = new Date(d.getFullYear(), d.getMonth(), 1);
  const al = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { dal: isoLocalDate(dal), al: isoLocalDate(al) };
}

function dataItDaIso(iso: string): string {
  return dataIt(iso);
}

function parseDataPromemoria(raw: string): string | null {
  const v = raw.trim();
  const iso = v.match(/^((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})$/);
  const valida = (anno: string, mese: string, giorno: string) => {
    const out = `${anno}-${mese.padStart(2, "0")}-${giorno.padStart(2, "0")}`;
    const d = new Date(`${out}T00:00:00`);
    return isoLocalDate(d) === out ? out : null;
  };
  if (iso) return valida(iso[1], iso[2], iso[3]);
  const it = v.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-]((?:19|20)\d{2}))?$/);
  if (!it) return null;
  const anno = it[3] ?? String(new Date().getFullYear());
  return valida(anno, it[2], it[1]);
}

interface PromemoriaPeriodo {
  id: string;
  label: string;
  sub: string;
  completion?: string;
  dal: string;
  al: string;
}

function periodiPromemoria(oggi: string): PromemoriaPeriodo[] {
  const settimana = estremiSettimana();
  const mese = estremiMese();
  return [
    { id: "oggi", label: "Oggi", sub: dataItDaIso(oggi), completion: "promemoria oggi", dal: oggi, al: oggi },
    { id: "ieri", label: "Ieri", sub: dataItDaIso(aggiungiGiorni(oggi, -1)), completion: "promemoria ieri", dal: aggiungiGiorni(oggi, -1), al: aggiungiGiorni(oggi, -1) },
    { id: "domani", label: "Domani", sub: dataItDaIso(aggiungiGiorni(oggi, 1)), completion: "promemoria domani", dal: aggiungiGiorni(oggi, 1), al: aggiungiGiorni(oggi, 1) },
    { id: "settimana", label: "Questa settimana", sub: `${dataItDaIso(settimana.dal)} - ${dataItDaIso(settimana.al)}`, completion: "promemoria questa settimana", dal: settimana.dal, al: settimana.al },
    { id: "mese", label: "Questo mese", sub: `${dataItDaIso(mese.dal)} - ${dataItDaIso(mese.al)}`, completion: "promemoria questo mese", dal: mese.dal, al: mese.al },
  ];
}

function periodoDaTestoPromemoria(resto: string, oggi: string): PromemoriaPeriodo | null {
  const q = normalizzaTesto(resto);
  const periodo = periodiPromemoria(oggi).find((p) => normalizzaTesto(p.completion?.replace(/^promemoria\s+/, "") ?? p.label) === q);
  if (periodo) return periodo;
  const data = parseDataPromemoria(resto);
  if (!data) return null;
  return { id: `data-${data}`, label: `Il ${dataItDaIso(data)}`, sub: "Data specifica", dal: data, al: data };
}

type TipoFiltroTemporale = "pagamenti" | "spedizioni";

type QueryTemporale =
  | { tipo: "completa_prefisso"; completion: string; ambito: TipoFiltroTemporale }
  | { tipo: "attiva"; resto: string; ambito: TipoFiltroTemporale };

const PREFISSI_TEMPORALI: Array<{ ambito: TipoFiltroTemporale; nomi: string[] }> = [
  { ambito: "spedizioni", nomi: ["spedizioni", "spedizione"] },
];

function queryTemporale(query: string): QueryTemporale | null {
  const raw = query.trimStart();
  const q = normalizzaTesto(raw);
  const finisceConSpazio = /\s$/.test(raw);
  if (!q) return null;
  for (const { ambito, nomi } of PREFISSI_TEMPORALI) {
    const canonico = ambito;
    if (nomi.includes(q)) {
      return finisceConSpazio
        ? { tipo: "attiva", resto: "", ambito }
        : { tipo: "completa_prefisso", completion: `${canonico} `, ambito };
    }
    const attivo = nomi.find((nome) => q.startsWith(`${nome} `));
    if (attivo) return { tipo: "attiva", resto: raw.slice(attivo.length).trimStart(), ambito };
    if (nomi.some((nome) => nome.startsWith(q))) {
      return { tipo: "completa_prefisso", completion: completaParola(raw, canonico), ambito };
    }
  }
  return null;
}

function aggiungiMesi(iso: string, mesi: number): string {
  const d = new Date(`${iso}T00:00:00`);
  const giorno = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + mesi);
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(giorno, ultimo));
  return isoLocalDate(d);
}

function estremiSettimanaDi(iso: string): { dal: string; al: string } {
  const d = new Date(`${iso}T00:00:00`);
  const giorno = (d.getDay() + 6) % 7;
  const dal = aggiungiGiorni(iso, -giorno);
  return { dal, al: aggiungiGiorni(dal, 6) };
}

function estremiMeseDi(iso: string, offset = 0): { dal: string; al: string } {
  const d = new Date(`${iso}T00:00:00`);
  const dal = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const al = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
  return { dal: isoLocalDate(dal), al: isoLocalDate(al) };
}

function periodiTemporali(prefisso: TipoFiltroTemporale, oggi: string): PromemoriaPeriodo[] {
  const domani = aggiungiGiorni(oggi, 1);
  const settimana = estremiSettimanaDi(oggi);
  const prossimaSettimana = {
    dal: aggiungiGiorni(settimana.dal, 7),
    al: aggiungiGiorni(settimana.al, 7),
  };
  const mese = estremiMeseDi(oggi);
  const prossimoMese = estremiMeseDi(oggi, 1);
  const voce = (id: string, label: string, dal: string, al = dal): PromemoriaPeriodo => ({
    id,
    label,
    sub: dal === al ? dataItDaIso(dal) : `${dataItDaIso(dal)} - ${dataItDaIso(al)}`,
    completion: `${prefisso} ${label.toLowerCase()}`,
    dal,
    al,
  });
  return [
    voce("oggi", "Oggi", oggi),
    voce("domani", "Domani", domani),
    voce("settimana", "Questa settimana", settimana.dal, settimana.al),
    voce("prossima-settimana", "Prossima settimana", prossimaSettimana.dal, prossimaSettimana.al),
    voce("mese", "Questo mese", mese.dal, mese.al),
    voce("prossimo-mese", "Prossimo mese", prossimoMese.dal, prossimoMese.al),
    voce("tra-7-giorni", "Tra 7 giorni", aggiungiGiorni(oggi, 7)),
  ];
}

function periodoRelativo(resto: string, oggi: string): PromemoriaPeriodo | null {
  const q = normalizzaTesto(resto);
  const tra = q.match(/^tra\s+(\d+)\s+(giorn[oi]|settiman[ae]|mes[ei])$/);
  if (tra) {
    const n = Number(tra[1]);
    if (!Number.isFinite(n) || n < 0 || n > 3650) return null;
    const unita = tra[2];
    const data = unita.startsWith("giorn")
      ? aggiungiGiorni(oggi, n)
      : unita.startsWith("settiman")
        ? aggiungiGiorni(oggi, n * 7)
        : aggiungiMesi(oggi, n);
    return { id: `tra-${n}-${unita}`, label: `Tra ${n} ${unita}`, sub: dataItDaIso(data), dal: data, al: data };
  }
  const prossimi = q.match(/^prossim[io]\s+(\d+)\s+giorni$/);
  if (prossimi) {
    const n = Number(prossimi[1]);
    if (!Number.isFinite(n) || n < 1 || n > 3650) return null;
    return {
      id: `prossimi-${n}-giorni`,
      label: `Prossimi ${n} giorni`,
      sub: `${dataItDaIso(oggi)} - ${dataItDaIso(aggiungiGiorni(oggi, n))}`,
      dal: oggi,
      al: aggiungiGiorni(oggi, n),
    };
  }
  return null;
}

function periodoDaTestoTemporale(resto: string, ambito: TipoFiltroTemporale, oggi: string): PromemoriaPeriodo | null {
  const q = normalizzaTesto(resto);
  const periodo = periodiTemporali(ambito, oggi).find((p) => normalizzaTesto(p.label) === q);
  if (periodo) return periodo;
  const relativo = periodoRelativo(resto, oggi);
  if (relativo) return relativo;
  const data = parseDataPromemoria(resto);
  return data ? { id: `data-${data}`, label: `Il ${dataItDaIso(data)}`, sub: "Data specifica", dal: data, al: data } : null;
}

function costruisciFiltriTemporali(query: string, dati: DatiRicerca): VoceRicerca[] {
  const stato = queryTemporale(query);
  if (!stato) return [];
  const oggi = oggiIso();
  const { ambito } = stato;
  const Ico = ambito === "spedizioni" ? IconTruckLoading : IconCalendarDue;

  if (stato.tipo === "completa_prefisso") {
    return [voceSmart({
      id: `${ambito}-completa-prefisso`,
      label: ambito[0].toUpperCase() + ambito.slice(1),
      sub: "Completa e scegli giorno o periodo",
      completion: stato.completion,
      Ico,
      bersaglio: ambito === "spedizioni"
        ? { t: "naviga", path: "/evasione", tab: "effettuate" }
        : { t: "naviga", path: "/contabilita", tab: "pagamenti" },
      dedupeKey: `${ambito}-completa-prefisso`,
    })];
  }

  const creaVoce = (p: PromemoriaPeriodo): VoceRicerca => {
    const n = ambito === "spedizioni"
      ? dati.spedizioni.filter((s) => s.data >= p.dal && s.data <= p.al).length
      : dati.pagamenti.filter((pag) => !pag.saldato && !pagamentoPotenziale(pag) && pag.scadenza >= p.dal && pag.scadenza <= p.al).length;
    return voceSmart({
      id: `${ambito}-periodo-${p.id}`,
      label: p.label,
      sub: `${p.sub} · ${n} ${ambito === "spedizioni" ? "spedizioni" : "scadenze"}`,
      completion: p.completion,
      Ico,
      bersaglio: ambito === "spedizioni"
        ? { t: "naviga", path: "/evasione", tab: "effettuate", cerca: "", dal: p.dal, al: p.al }
        : { t: "naviga", path: "/contabilita", tab: "pagamenti", cerca: "", statiPagamento: ["atteso"], dal: p.dal, al: p.al },
      dedupeKey: `${ambito}-periodo:${p.id}`,
    });
  };

  const restoNorm = normalizzaTesto(stato.resto);
  if (!restoNorm) {
    return periodiTemporali(ambito, oggi).map(creaVoce);
  }

  const periodo = periodoDaTestoTemporale(stato.resto, ambito, oggi);
  if (periodo) return [creaVoce(periodo)];

  const relativoParziale = restoNorm.match(/^tra\s+(\d+)(?:\s+([a-z]*))?$/);
  if (relativoParziale) {
    const n = Number(relativoParziale[1]);
    const frammento = relativoParziale[2] ?? "";
    return [
      { unita: n === 1 ? "giorno" : "giorni", data: aggiungiGiorni(oggi, n) },
      { unita: n === 1 ? "settimana" : "settimane", data: aggiungiGiorni(oggi, n * 7) },
      { unita: n === 1 ? "mese" : "mesi", data: aggiungiMesi(oggi, n) },
    ]
      .filter(({ unita }) => unita.startsWith(frammento))
      .map(({ unita, data }) =>
        creaVoce({
          id: `tra-${n}-${unita}`,
          label: `Tra ${n} ${unita}`,
          sub: dataItDaIso(data),
          completion: `${ambito} tra ${n} ${unita}`,
          dal: data,
          al: data,
        })
      );
  }

  return periodiTemporali(ambito, oggi)
    .filter((p) => normalizzaTesto(p.label).includes(restoNorm))
    .map(creaVoce);
}

function anteprimaMessaggio(testo: string): string {
  const t = testo.trim();
  return t.length > 70 ? `${t.slice(0, 67)}...` : t;
}

function costruisciMessaggiDinamici(query: string, dati: DatiRicerca): VoceRicerca[] {
  const stato = queryMessaggio(query);
  if (!stato) return [];

  if (stato.tipo === "completa_prefisso") {
    return [
      voceSmart({
        id: "msg-completa-prefisso",
        label: "Messaggio",
        sub: "Completa il comando e scegli il destinatario",
        completion: stato.completion,
        Ico: IconMessage,
        bersaglio: { t: "messaggio_compose", destinatario: DEST_TUTTI, destinatarioNome: "Tutti" },
        dedupeKey: "msg-completa-prefisso",
      }),
    ];
  }

  const destinatari = [
    { id: DEST_TUTTI, nome: "Tutti" },
    ...dati.utenti.map((u) => ({ id: u.id, nome: u.nome })),
  ];
  const resto = stato.resto;
  const restoNorm = normalizzaTesto(resto);
  const out: VoceRicerca[] = [];

  if (!restoNorm) {
    for (const d of destinatari.slice(0, MAX_PER_GRUPPO)) {
      out.push(voceSmart({
        id: `msg-compose-${d.id}`,
        label: d.nome,
        sub: d.id === DEST_TUTTI ? "Messaggio a tutti gli utenti" : "Messaggio utente",
        completion: `messaggio ${d.nome} `,
        Ico: IconMessage,
        bersaglio: { t: "messaggio_compose", destinatario: d.id, destinatarioNome: d.nome },
        dedupeKey: `msg-compose:${d.id}`,
      }));
    }
    return out;
  }

  const matchCompleto = destinatari
    .map((d) => ({ d, nomeNorm: normalizzaTesto(d.nome) }))
    .filter(({ nomeNorm }) => restoNorm === nomeNorm || restoNorm.startsWith(`${nomeNorm} `))
    .sort((a, b) => b.nomeNorm.length - a.nomeNorm.length)[0];

  if (matchCompleto) {
    const testo = resto.slice(matchCompleto.d.nome.length).trim();
    const pronto = testo.length > 0;
    out.push(voceSmart({
      id: pronto ? `msg-send-${matchCompleto.d.id}` : `msg-compose-${matchCompleto.d.id}`,
      label: pronto ? `Invia a ${matchCompleto.d.nome}` : matchCompleto.d.nome,
      sub: pronto ? anteprimaMessaggio(testo) : "Completa con il testo del messaggio",
      completion: pronto ? undefined : `messaggio ${matchCompleto.d.nome} `,
      Ico: pronto ? IconSend : IconMessage,
      bersaglio: pronto
        ? { t: "messaggio_invia", destinatario: matchCompleto.d.id, destinatarioNome: matchCompleto.d.nome, testo }
        : { t: "messaggio_compose", destinatario: matchCompleto.d.id, destinatarioNome: matchCompleto.d.nome },
      dedupeKey: pronto ? `msg-send:${matchCompleto.d.id}:${testo}` : `msg-compose:${matchCompleto.d.id}`,
    }));
    return out;
  }

  const candidati = destinatari.filter((d) => normalizzaTesto(d.nome).includes(restoNorm)).slice(0, MAX_PER_GRUPPO);
  for (const d of candidati) {
    out.push(voceSmart({
      id: `msg-compose-${d.id}`,
      label: d.nome,
      sub: "Tab completa il destinatario",
      completion: `messaggio ${d.nome} `,
      Ico: IconMessage,
      bersaglio: { t: "messaggio_compose", destinatario: d.id, destinatarioNome: d.nome },
      dedupeKey: `msg-compose:${d.id}`,
    }));
  }
  return out;
}

function costruisciPromemoriaDinamici(query: string, dati: DatiRicerca): VoceRicerca[] {
  const stato = queryPromemoria(query);
  if (!stato) return [];
  const oggi = oggiIso();

  if (stato.tipo === "completa_prefisso") {
    return [
      voceSmart({
        id: "promemoria-completa-prefisso",
        label: "Promemoria",
        sub: "Completa e scegli giorno o periodo",
        completion: stato.completion,
        Ico: IconBell,
        bersaglio: { t: "notifiche" },
        dedupeKey: "promemoria-completa-prefisso",
      }),
    ];
  }

  const restoNorm = normalizzaTesto(stato.resto);
  const faccette: FaccettaSmart[] = [
    ...periodiPromemoria(oggi).map((p) => ({
      tipo: "periodo" as const,
      valore: p.id,
      label: p.label,
      sub: p.sub,
      canonico: p.label.toLowerCase(),
      alias: [p.label],
      dal: p.dal,
      al: p.al,
    })),
    ...(["alta", "media", "bassa"] as const).map((priorita) => ({
      tipo: "priorita" as TipoFaccetta,
      valore: priorita,
      label: `Priorità ${priorita}`,
      canonico: `priorita ${priorita}`,
      alias: [`priorità ${priorita}`],
    })),
    ...[
      { valore: "aperti", label: "Aperti" },
      { valore: "completati", label: "Completati" },
    ].map((s) => ({
      tipo: "stato_promemoria" as TipoFaccetta,
      valore: s.valore,
      label: s.label,
      canonico: `stato ${s.valore}`,
      alias: [s.label],
    })),
  ];
  const tipiSingoli = new Set<TipoFaccetta>(["periodo", "stato_promemoria"]);
  const analisi = analizzaFaccette(stato.resto, faccette, tipiSingoli);
  if (analisi.selezionate.length > 0 || analisi.residuo) {
    const periodoScelto = analisi.selezionate.find((f) => f.tipo === "periodo");
    const priorita = new Set(analisi.selezionate.filter((f) => f.tipo === "priorita").map((f) => f.valore));
    const stati = new Set(analisi.selezionate.filter((f) => f.tipo === "stato_promemoria").map((f) => f.valore));
    const risultati = analisi.residuo
      ? []
      : dati.promemoria
          .filter((p) => !periodoScelto || (!!p.scadenza && p.scadenza >= (periodoScelto.dal ?? "") && p.scadenza <= (periodoScelto.al ?? "")))
          .filter((p) => priorita.size === 0 || priorita.has(p.priorita))
          .filter((p) => stati.size === 0 || (stati.has("aperti") && !p.fatto) || (stati.has("completati") && p.fatto))
          .slice(0, MAX_PER_GRUPPO)
          .map((p) =>
            conDedupe({
              id: `smart-promem-${p.id}`,
              gruppo: "Promemoria",
              label: p.testo || "Promemoria",
              sub: [p.scadenza ? `scad. ${dataIt(p.scadenza)}` : undefined, p.collegatoNome || undefined, `priorità ${p.priorita}`].filter(Boolean).join(" · "),
              Ico: IconBell,
              bersaglio: { t: "promemoria_apri", id: p.id },
              dedupeKey: `promemoria:${p.id}`,
            })
          );
    const suggerimenti = suggerimentiFaccette(
      "promemoria",
      analisi.selezionate,
      analisi.residuo,
      faccette,
      IconBell,
      { t: "notifiche" },
      tipiSingoli
    );
    if (risultati.length === 0 && !analisi.residuo) {
      risultati.push(voceSmart({
        id: "promemoria-filtri-vuoti",
        label: "Nessun promemoria",
        sub: analisi.selezionate.map((f) => f.label).join(" · "),
        disabled: true,
        Ico: IconBell,
        bersaglio: { t: "notifiche" },
        dedupeKey: `promemoria-vuoti:${analisi.selezionate.map((f) => f.valore).sort().join("|")}`,
      }));
    }
    return [...risultati, ...suggerimenti];
  }

  if (!restoNorm) {
    return faccette.slice(0, MAX_PER_GRUPPO).map((p) =>
      voceSmart({
        id: `promemoria-faccetta-${p.tipo}-${p.valore}`,
        label: p.label,
        sub: p.sub,
        completion: `promemoria ${p.canonico}`,
        Ico: IconBell,
        bersaglio: { t: "notifiche" },
        dedupeKey: `promemoria-faccetta:${p.tipo}:${p.valore}`,
      })
    );
  }

  const periodo = periodoDaTestoPromemoria(stato.resto, oggi);
  if (!periodo) {
    return periodiPromemoria(oggi)
      .filter((p) => normalizzaTesto(p.completion?.replace(/^promemoria\s+/, "") ?? p.label).includes(restoNorm))
      .map((p) =>
        voceSmart({
          id: `promemoria-periodo-${p.id}`,
          label: p.label,
          sub: p.sub,
          completion: p.completion,
          Ico: IconBell,
          bersaglio: { t: "notifiche" },
          dedupeKey: `promemoria-periodo:${p.id}`,
        })
      );
  }

  const prom = dati.promemoria
    .filter((p) => !p.fatto && p.scadenza && p.scadenza >= periodo.dal && p.scadenza <= periodo.al)
    .slice(0, MAX_PER_GRUPPO);
  if (prom.length === 0) {
    return [
      voceSmart({
        id: `promemoria-vuoto-${periodo.id}`,
        label: `Promemoria ${periodo.label.toLowerCase()}`,
        sub: "Nessun promemoria aperto",
        disabled: true,
        Ico: IconBell,
        bersaglio: { t: "notifiche" },
        dedupeKey: `promemoria-vuoto:${periodo.id}`,
      }),
    ];
  }
  return prom.map((p) =>
    conDedupe({
      id: `smart-promem-${p.id}`,
      gruppo: "Promemoria",
      label: p.testo || "Promemoria",
      sub: [p.scadenza ? `scad. ${dataIt(p.scadenza)}` : undefined, p.collegatoNome || undefined].filter(Boolean).join(" · ") || undefined,
      Ico: IconBell,
      bersaglio: { t: "promemoria_apri", id: p.id },
      dedupeKey: `promemoria:${p.id}`,
    })
  );
}

type TipoFaccetta =
  | "stato"
  | "linea"
  | "conto"
  | "medico"
  | "agente"
  | "corriere"
  | "periodo"
  | "priorita"
  | "stato_promemoria"
  | "origine"
  | "acconto"
  | "vista"
  | "spedizione_stato"
  | "spedizione_lotto"
  | "altre_linee"
  | "ordinamento";

interface FaccettaSmart {
  tipo: TipoFaccetta;
  valore: string;
  label: string;
  canonico: string;
  alias: string[];
  sub?: string;
  dal?: string;
  al?: string;
}

function contieneFrase(testo: string, frase: string): boolean {
  return (` ${testo} `).includes(` ${frase} `);
}

function analizzaFaccette(resto: string, faccette: FaccettaSmart[], tipiSingoli: ReadonlySet<TipoFaccetta> = new Set()) {
  let residuo = normalizzaTesto(resto).replace(/\s+/g, " ").trim();
  const selezionate: FaccettaSmart[] = [];
  const lunghezzaMax = (f: FaccettaSmart) => Math.max(f.canonico.length, ...f.alias.map((x) => x.length));
  const ordinate = [...faccette].sort((a, b) => lunghezzaMax(b) - lunghezzaMax(a));
  for (const f of ordinate) {
    if (tipiSingoli.has(f.tipo) && selezionate.some((s) => s.tipo === f.tipo)) continue;
    const alias = [f.canonico, ...f.alias]
      .map(normalizzaTesto)
      .sort((a, b) => b.length - a.length)
      .find((a) => contieneFrase(residuo, a));
    if (!alias) continue;
    selezionate.push(f);
    residuo = (` ${residuo} `).replace(` ${alias} `, " ").replace(/\s+/g, " ").trim();
  }
  return { selezionate, residuo };
}

function suggerimentiFaccette(
  prefisso: string,
  selezionate: FaccettaSmart[],
  residuo: string,
  tutte: FaccettaSmart[],
  Ico: Icon,
  bersaglioBase: Bersaglio,
  tipiSingoli: ReadonlySet<TipoFaccetta> = new Set()
): VoceRicerca[] {
  const scelte = new Set(selezionate.map((f) => `${f.tipo}:${f.valore}`));
  const tipiGiaScelti = new Set(selezionate.map((f) => f.tipo));
  const filtro = normalizzaTesto(residuo);
  return tutte
    .filter((f) => !scelte.has(`${f.tipo}:${f.valore}`))
    .filter((f) => !tipiSingoli.has(f.tipo) || !tipiGiaScelti.has(f.tipo))
    .filter((f) => !filtro || [f.label, f.canonico, ...f.alias].some((x) => normalizzaTesto(x).includes(filtro)))
    .slice(0, MAX_PER_GRUPPO)
    .map((f) =>
      voceSmart({
        id: `${prefisso}-suggerisci-${f.tipo}-${f.valore}`,
        label: f.label,
        sub: `Aggiungi filtro ${f.tipo}`,
        completion: `${prefisso} ${[...selezionate.map((s) => s.canonico), f.canonico].join(" ")}`,
        Ico,
        bersaglio: bersaglioBase,
        dedupeKey: `${prefisso}-suggerimento:${f.tipo}:${f.valore}`,
      })
    );
}

function faccettePeriodo(oggi: string): FaccettaSmart[] {
  return periodiTemporali("pagamenti", oggi).slice(0, 6).map((p) => ({
    tipo: "periodo",
    valore: p.id,
    label: p.label,
    canonico: p.label.toLowerCase(),
    alias: [p.label],
    dal: p.dal,
    al: p.al,
  }));
}

function costruisciPagamentiSmart(query: string, dati: DatiRicerca): VoceRicerca[] {
  const raw = query.trimStart();
  const q = normalizzaTesto(raw);
  const prefisso = q === "crediti" || q.startsWith("crediti ") ? "crediti" : "pagamenti";
  if (q !== prefisso && !q.startsWith(`${prefisso} `)) return [];
  const resto = raw.slice(prefisso.length).trim();
  const oggi = oggiIso();
  const spedizioniPerLotto = new Map<string, Spedizione[]>();
  for (const spedizione of dati.spedizioni) {
    const gruppo = spedizioniPerLotto.get(spedizione.lotto) ?? [];
    gruppo.push(spedizione);
    spedizioniPerLotto.set(spedizione.lotto, gruppo);
  }
  const faccette: FaccettaSmart[] = [
    ...[
      ["potenziale", "Potenziali"],
      ["atteso", "Attesi"],
      ["scaduto", "Scaduti"],
      ["da_verificare", "Da verificare"],
    ].map(([valore, label]) => ({
      tipo: "stato" as const,
      valore,
      label,
      canonico: `stato ${normalizzaTesto(label)}`,
      alias: [label, valore.replace("_", " ")],
    })),
    ...["Immunoterapia", "Diagnostica", "Keriba"].map((linea) => ({
      tipo: "linea" as const,
      valore: linea,
      label: linea,
      canonico: `linea ${linea.toLowerCase()}`,
      alias: [linea],
    })),
    { tipo: "spedizione_stato", valore: "spediti", label: "Ordini spediti", canonico: "ordini spediti", alias: ["spediti"] },
    { tipo: "spedizione_stato", valore: "non", label: "Ordini non spediti", canonico: "ordini non spediti", alias: ["non spediti"] },
    ...[...spedizioniPerLotto.entries()].map(([lotto, gruppo]) => {
      const date = gruppo.map((s) => s.data).sort();
      const data = date[date.length - 1] ?? "";
      const corrieri = [...new Set(gruppo.map((s) => s.corriereNome).filter(Boolean))].join(" / ") || "spedizione";
      const colli = gruppo.reduce((totale, s) => totale + Math.max(1, s.colli || 0), 0);
      const breve = lotto.slice(-6);
      return {
        tipo: "spedizione_lotto" as const,
        valore: lotto,
        label: `Spedizione ${dataIt(data)} · ${corrieri} · ${colli} ${colli === 1 ? "collo" : "colli"}`,
        canonico: `spedizione ${dataIt(data)} ${corrieri} lotto ${breve}`,
        alias: [`lotto ${breve}`, `spedizione ${lotto}`],
      };
    }),
    ...dati.conto.map((r) => ({
      tipo: "conto" as const,
      valore: r.id,
      label: nomeDi(r),
      canonico: `conto ${nomeDi(r)}`,
      alias: [],
    })),
    ...dati.medico.map((r) => ({
      tipo: "medico" as const,
      valore: r.id,
      label: nomeDi(r),
      canonico: `medico ${nomeDi(r)}`,
      alias: [],
    })),
    ...dati.agente.map((r) => ({
      tipo: "agente" as const,
      valore: r.id,
      label: nomeDi(r),
      canonico: `agente ${nomeDi(r)}`,
      alias: [],
    })),
    ...faccettePeriodo(oggi),
  ];
  const tipiSingoli = new Set<TipoFaccetta>(["periodo", "spedizione_stato"]);
  const { selezionate, residuo } = analizzaFaccette(resto, faccette, tipiSingoli);
  const stati = selezionate.filter((f) => f.tipo === "stato").map((f) => f.valore);
  const periodo = selezionate.find((f) => f.tipo === "periodo");
  const bersaglio: Bersaglio = {
    t: "naviga",
    path: "/contabilita",
    tab: "pagamenti",
    cerca: "",
    statiPagamento: stati,
    contoIds: selezionate.filter((f) => f.tipo === "conto").map((f) => f.valore),
    spedizioneLotti: selezionate.filter((f) => f.tipo === "spedizione_lotto").map((f) => f.valore),
    medicoIds: selezionate.filter((f) => f.tipo === "medico").map((f) => f.valore),
    agenteIds: selezionate.filter((f) => f.tipo === "agente").map((f) => f.valore),
    linee: selezionate.filter((f) => f.tipo === "linea").map((f) => f.valore),
    spedito: selezionate.find((f) => f.tipo === "spedizione_stato")?.valore as "spediti" | "non" | undefined,
    dal: periodo?.dal ?? "",
    al: periodo?.al ?? "",
  };
  const out: VoceRicerca[] = [];
  if (selezionate.length > 0 && !residuo) {
    out.push(voceSmart({
      id: "pagamenti-applica",
      label: "Mostra crediti",
      sub: selezionate.map((f) => f.label).join(" · "),
      Ico: IconCashBanknote,
      bersaglio,
      dedupeKey: `pagamenti-applica:${selezionate.map((f) => `${f.tipo}:${f.valore}`).sort().join("|")}`,
    }));
  }
  out.push(...suggerimentiFaccette(prefisso, selezionate, residuo, faccette, IconCashBanknote, bersaglio, tipiSingoli));
  return out;
}

function costruisciSpedizioniSmart(query: string, dati: DatiRicerca): VoceRicerca[] {
  const raw = query.trimStart();
  const q = normalizzaTesto(raw);
  if (q !== "spedizioni" && !q.startsWith("spedizioni ")) return [];
  const resto = raw.slice("spedizioni".length).trim();
  const viste: FaccettaSmart[] = [
    { tipo: "vista", valore: "effettuate", label: "Effettuate", canonico: "vista effettuate", alias: ["effettuate"] },
    { tipo: "vista", valore: "da_spedire", label: "Da spedire", canonico: "vista da spedire", alias: ["da spedire"] },
  ];
  const richiestaDaSpedire = ["vista da spedire", "da spedire"].some((frase) =>
    contieneFrase(normalizzaTesto(resto), frase)
  );
  const faccette: FaccettaSmart[] = richiestaDaSpedire
    ? [
        ...viste,
        {
          tipo: "altre_linee",
          valore: "mostra",
          label: "Mostra anche Diagnostica e Keriba",
          canonico: "mostra altre linee",
          alias: ["diagnostica e keriba", "altre linee"],
        },
      ]
    : [
    ...viste,
    ...dati.corriere.map((r) => ({
      tipo: "corriere" as const,
      valore: r.id,
      label: nomeDi(r),
      canonico: `corriere ${nomeDi(r)}`,
      alias: [],
    })),
    ...faccettePeriodo(oggiIso()),
  ];
  const tipiSingoli = new Set<TipoFaccetta>(["periodo", "vista"]);
  const { selezionate, residuo } = analizzaFaccette(resto, faccette, tipiSingoli);
  const periodo = selezionate.find((f) => f.tipo === "periodo");
  const vista = selezionate.find((f) => f.tipo === "vista")?.valore ?? "effettuate";
  const bersaglio: Bersaglio = {
    t: "naviga",
    path: "/evasione",
    tab: vista,
    cerca: "",
    corriereNomi: vista === "effettuate" ? selezionate.filter((f) => f.tipo === "corriere").map((f) => f.label) : [],
    dal: vista === "effettuate" ? periodo?.dal ?? "" : "",
    al: vista === "effettuate" ? periodo?.al ?? "" : "",
    mostraAltreSpedizioni: vista === "da_spedire" && selezionate.some((f) => f.tipo === "altre_linee"),
  };
  const out: VoceRicerca[] = [];
  if (selezionate.length > 0 && !residuo) {
    out.push(voceSmart({
      id: "spedizioni-applica",
      label: "Mostra spedizioni",
      sub: selezionate.map((f) => f.label).join(" · "),
      Ico: IconTruckLoading,
      bersaglio,
      dedupeKey: selezionate.length === 1 && selezionate[0].tipo === "periodo"
        ? `spedizioni-periodo:${selezionate[0].valore}`
        : `spedizioni-applica:${selezionate.map((f) => `${f.tipo}:${f.valore}`).sort().join("|")}`,
    }));
  }
  out.push(...suggerimentiFaccette("spedizioni", selezionate, residuo, faccette, IconTruckLoading, bersaglio, tipiSingoli));
  return out;
}

function restoComandoSmart(query: string, prefisso: string): string | null {
  const raw = query.trimStart();
  const q = normalizzaTesto(raw);
  if (q === prefisso) return "";
  if (q.startsWith(`${prefisso} `)) return raw.slice(prefisso.length).trim();
  return null;
}

function costruisciComandoAFaccette(
  query: string,
  prefisso: string,
  labelAzione: string,
  Ico: Icon,
  faccette: FaccettaSmart[],
  bersaglio: (selezionate: FaccettaSmart[]) => Bersaglio,
  tipiSingoli: ReadonlySet<TipoFaccetta> = new Set()
): VoceRicerca[] {
  const resto = restoComandoSmart(query, prefisso);
  if (resto === null) return [];
  const { selezionate, residuo } = analizzaFaccette(resto, faccette, tipiSingoli);
  const target = bersaglio(selezionate);
  const out: VoceRicerca[] = [];
  if (selezionate.length > 0 && !residuo) {
    out.push(voceSmart({
      id: `${prefisso}-applica`,
      label: labelAzione,
      sub: selezionate.map((f) => f.label).join(" · "),
      Ico,
      bersaglio: target,
      dedupeKey: `${prefisso}-applica:${selezionate.map((f) => `${f.tipo}:${f.valore}`).sort().join("|")}`,
    }));
  }
  out.push(...suggerimentiFaccette(prefisso, selezionate, residuo, faccette, Ico, target, tipiSingoli));
  return out;
}

function faccetteAnagrafiche(tipo: "agente" | "corriere" | "conto", righe: RecordDto[]): FaccettaSmart[] {
  return righe.map((r) => ({
    tipo,
    valore: r.id,
    label: nomeDi(r),
    canonico: `${tipo} ${nomeDi(r)}`,
    alias: [],
  }));
}

function costruisciDistinteSmart(query: string, dati: DatiRicerca): VoceRicerca[] {
  const faccette = faccetteAnagrafiche("corriere", dati.corriere);
  return costruisciComandoAFaccette(
    query,
    "distinte",
    "Mostra distinte",
    IconTruckDelivery,
    faccette,
    (selezionate) => ({
      t: "naviga",
      path: "/contabilita",
      tab: "distinte",
      cerca: selezionate.map((f) => f.label).join(" "),
    }),
    new Set<TipoFaccetta>(["corriere"])
  );
}

function costruisciProvvigioniSmart(query: string, dati: DatiRicerca): VoceRicerca[] {
  const faccette: FaccettaSmart[] = [
    ...faccetteAnagrafiche("agente", dati.agente),
    ...faccettePeriodo(oggiIso()),
    { tipo: "ordinamento", valore: "maturato", label: "Maturato (più alto)", canonico: "ordina maturato", alias: ["maturato"] },
    { tipo: "ordinamento", valore: "potenziale", label: "Potenziale (più alto)", canonico: "ordina potenziale", alias: ["potenziale"] },
    { tipo: "ordinamento", valore: "nome", label: "Nome (A–Z)", canonico: "ordina nome", alias: ["nome"] },
  ];
  return costruisciComandoAFaccette(
    query,
    "provvigioni",
    "Mostra provvigioni",
    IconCashBanknote,
    faccette,
    (selezionate) => {
      const periodo = selezionate.find((f) => f.tipo === "periodo");
      return {
        t: "naviga",
        path: "/contabilita",
        tab: "provvigioni",
        agenteId: selezionate.find((f) => f.tipo === "agente")?.valore,
        provvigioniOrdina: selezionate.find((f) => f.tipo === "ordinamento")?.valore as "maturato" | "potenziale" | "nome" | undefined,
        dal: periodo?.dal ?? "",
        al: periodo?.al ?? "",
      };
    },
    new Set<TipoFaccetta>(["agente", "periodo", "ordinamento"])
  );
}

function costruisciRimborsiSmart(query: string): VoceRicerca[] {
  const faccette: FaccettaSmart[] = [
    { tipo: "stato", valore: "richiesto", label: "Richiesti", canonico: "stato richiesti", alias: ["richiesti"] },
    { tipo: "stato", valore: "effettuato", label: "Effettuati", canonico: "stato effettuati", alias: ["effettuati"] },
    { tipo: "origine", valore: "manuale", label: "Manuali", canonico: "origine manuale", alias: ["manuali"] },
    { tipo: "origine", valore: "extra", label: "Eccessi", canonico: "origine eccessi", alias: ["extra", "eccessi"] },
    ...faccettePeriodo(oggiIso()),
  ];
  return costruisciComandoAFaccette(
    query,
    "rimborsi",
    "Mostra rimborsi",
    IconReceiptRefund,
    faccette,
    (selezionate) => {
      const periodo = selezionate.find((f) => f.tipo === "periodo");
      return {
        t: "naviga",
        path: "/contabilita",
        tab: "rimborsi",
        rimborsoStati: selezionate.filter((f) => f.tipo === "stato").map((f) => f.valore),
        rimborsoOrigini: selezionate.filter((f) => f.tipo === "origine").map((f) => f.valore),
        dal: periodo?.dal ?? "",
        al: periodo?.al ?? "",
      };
    },
    new Set<TipoFaccetta>(["periodo"])
  );
}

function costruisciLaboratorioSmart(query: string, dati: DatiRicerca): VoceRicerca[] {
  const faccette: FaccettaSmart[] = [
    ...faccetteAnagrafiche("agente", dati.agente),
    { tipo: "acconto", valore: "incassato", label: "Acconto incassato", canonico: "acconto incassato", alias: ["incassato"] },
    { tipo: "acconto", valore: "atteso", label: "Acconto atteso", canonico: "acconto atteso", alias: ["atteso"] },
    ...faccettePeriodo(oggiIso()),
  ];
  return costruisciComandoAFaccette(
    query,
    "fornitore",
    "Mostra ordini Laboratorio",
    IconTestPipe,
    faccette,
    (selezionate) => {
      const periodo = selezionate.find((f) => f.tipo === "periodo");
      return {
        t: "naviga",
        path: "/produzione",
        tab: "in_lavorazione",
        agenteIds: selezionate.filter((f) => f.tipo === "agente").map((f) => f.valore),
        produzioneAcconto: selezionate.find((f) => f.tipo === "acconto")?.valore as "incassato" | "atteso" | undefined,
        dal: periodo?.dal ?? "",
        al: periodo?.al ?? "",
      };
    },
    new Set<TipoFaccetta>(["acconto", "periodo"])
  );
}

function costruisciComandiDinamici(query: string, dati: DatiRicerca): VoceRicerca[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: VoceRicerca[] = [
    ...costruisciMessaggiDinamici(query, dati),
    ...costruisciPromemoriaDinamici(query, dati),
    ...costruisciFiltriTemporali(query, dati),
    ...costruisciPagamentiSmart(query, dati),
    ...costruisciSpedizioniSmart(query, dati),
    ...costruisciDistinteSmart(query, dati),
    ...costruisciProvvigioniSmart(query, dati),
    ...costruisciRimborsiSmart(query),
    ...costruisciLaboratorioSmart(query, dati),
  ];

  const contoMatch = q.match(/^crediti\s+(.+)$/);
  if (contoMatch) {
    const nome = contoMatch[1].trim();
    const conto = dati.pagamenti.find((p) => p.contoNome.toLowerCase().includes(nome));
    if (conto) {
      out.push(voceSmart({
        id: `smart-crediti-conto-${conto.contoId || nome}`,
        label: `Crediti ${conto.contoNome}`,
        sub: "Contabilità → Crediti",
        dettagli: ["Filtra per conto previsto"],
        completion: `crediti ${conto.contoNome}`,
        Ico: IconWallet,
        bersaglio: { t: "naviga", path: "/contabilita", tab: "pagamenti", contoId: conto.contoId, contoNome: conto.contoNome } as Bersaglio,
        dedupeKey: `smart:crediti-conto:${conto.contoId || conto.contoNome}`,
      }));
    }
  }

  const ordiniAnno = q.match(/^ordini\s+(.+)\s+((?:19|20)\d{2})$/);
  if (ordiniAnno) {
    const nome = ordiniAnno[1].trim();
    const anno = ordiniAnno[2];
    out.push(voceSmart({
      id: `smart-ordini-${nome}-${anno}`,
      label: `Ordini ${nome} ${anno}`,
      sub: "Giornaliero filtrato",
      dettagli: [`Dal 01/01/${anno} al 31/12/${anno}`],
      completion: `ordini ${nome} ${anno}`,
      Ico: IconClipboardList,
      bersaglio: { t: "naviga", path: "/giornaliero", cerca: nome, dal: `${anno}-01-01`, al: `${anno}-12-31` },
      dedupeKey: `smart:ordini-anno:${nome}:${anno}`,
    }));
  }

  return out;
}

function deduplica(voci: VoceRicerca[]): VoceRicerca[] {
  const viste = new Set<string>();
  const out: VoceRicerca[] = [];
  for (const v of voci) {
    const k = v.dedupeKey ?? chiaveBersaglio(v.bersaglio) ?? v.id;
    if (viste.has(k)) continue;
    viste.add(k);
    out.push({ ...v, dedupeKey: k });
  }
  return out;
}

/** Costruisce l'elenco dei risultati per la query corrente. */
export function costruisciVoci(
  query: string,
  dati: DatiRicerca,
  opzioni: {
    preventiviAbilitati?: boolean;
    bollettazioneAbilitata?: boolean;
  } = {},
): VoceRicerca[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out: VoceRicerca[] = [];
  const oggi = oggiIso();
  // Tutti i termini devono comparire nel blob (AND): ordine dei termini irrilevante.
  const okLower = (blob: string) => tokens.every((t) => blob.includes(t));
  const ok = (blob: string) => okLower(blob.toLowerCase());

  // Comandi rapidi (sempre, filtrati per testo).
  out.push(...costruisciComandiDinamici(query, dati));
  if (
    queryMessaggio(query) != null ||
    queryPromemoria(query) != null ||
    queryTemporale(query) != null ||
    ["pagamenti", "distinte", "provvigioni", "rimborsi", "fornitore"].some((p) =>
      normalizzaTesto(query).startsWith(p)
    )
  ) {
    return deduplica(out).slice(0, MAX_TOTALE);
  }
  for (const c of COMANDI) {
    if (tokens.length === 0 || ok(c.label)) {
      out.push(voceComando(c, query, oggi));
    }
  }
  if (
    opzioni.bollettazioneAbilitata &&
    (tokens.length === 0 || ok("Bollettazione automatica"))
  ) {
    const voceBollettazione: VoceRicerca = {
      id: "c-bollettazione-automatica",
      gruppo: "Comandi",
      label: "Bollettazione automatica",
      Ico: IconFileSpreadsheet,
      bersaglio: {
        t: "naviga",
        path: "/evasione",
        tab: "da_spedire",
        azione: "bollettazione_automatica",
      },
    };
    const indiceSpedizioni = out.findIndex(
      (voce) => voce.id === "c-evas",
    );
    out.splice(
      indiceSpedizioni >= 0 ? indiceSpedizioni + 1 : out.length,
      0,
      voceBollettazione,
    );
  }

  if (tokens.length === 0) return deduplica(out).slice(0, MAX_TOTALE);

  // Anagrafiche PRIMA degli ordini → riepilogo entità (cliente/medico/agente):
  // cercando "alessandro vitale" si vuole vedere prima la scheda della persona, poi
  // i suoi ordini.
  for (const g of GRUPPI_ENTITA) {
    let m = 0;
    for (const r of dati[g.entity] as RecordDto[]) {
      if (m >= MAX_PER_GRUPPO) break;
      if (!okLower(blobIndicizzato(r, () => g.blob(r)))) continue;
      m++;
      out.push(voceEntita(g, r));
    }
  }

  // Ordini: per numero/codice, data o NOME (cliente/medico/agente). La riga mostra
  // cliente (una volta), data, medico, agente.
  let n = 0;
  for (const o of dati.ordini) {
    if (n >= MAX_PER_GRUPPO) break;
    if (!okLower(blobIndicizzato(o, () => `${o.numero} ${blobData(o.data)} ${o.clienteNome} ${o.medicoNome} ${o.agenteNome} ${blobLottiOrdine(o)}`))) continue;
    n++;
    out.push(voceOrdine(o));
  }

  if (opzioni.preventiviAbilitati !== false) {
    let nPreventivi = 0;
    for (const preventivo of dati.preventivi) {
      if (nPreventivi >= MAX_PER_GRUPPO) break;
      if (
        !okLower(
          blobIndicizzato(
            preventivo,
            () =>
              `preventivo ${preventivo.linee.join(" ")} ${testoRicercaPreventivo(preventivo)}`,
          ),
        )
      ) {
        continue;
      }
      nPreventivi += 1;
      out.push(vocePreventivo(preventivo));
    }
  }

  // Prodotti → apre la scheda (Anagrafiche → Prodotti, modale di quel prodotto).
  let nP = 0;
  for (const r of dati.prodotto) {
    if (nP >= MAX_PER_GRUPPO) break;
    if (!okLower(blobIndicizzato(r, () => `${nomeDi(r)} ${r.data.categoria ?? ""}`))) continue;
    nP++;
    out.push(conDedupe({
      id: `prodotto-${r.id}`,
      gruppo: "Prodotti",
      label: nomeDi(r),
      sub: (r.data.categoria as string) || undefined,
      Ico: icoProdotto(r),
      bersaglio: { t: "naviga", path: "/anagrafiche", tab: "prodotto", apriId: r.id },
    }));
  }

  // Promemoria → per titolo (e nome dell'entità collegata): aprono il promemoria in finestra.
  let nProm = 0;
  for (const p of dati.promemoria) {
    if (nProm >= MAX_PER_GRUPPO) break;
    if (p.fatto) continue;
    if (!okLower(blobIndicizzato(p, () => `${p.testo} ${p.collegatoNome ?? ""}`))) continue;
    nProm++;
    out.push(conDedupe({
      id: `promem-${p.id}`,
      gruppo: "Promemoria",
      label: p.testo || "Promemoria",
      sub: [p.scadenza ? `scad. ${dataIt(p.scadenza)}` : undefined, p.collegatoNome || undefined].filter(Boolean).join(" · ") || undefined,
      Ico: IconBell,
      bersaglio: { t: "promemoria_apri", id: p.id },
    }));
  }

  // Corrieri → due scorciatoie: le sue distinte (Contabilità) e le sue spedizioni (Evasione).
  let nCor = 0;
  for (const r of dati.corriere) {
    if (nCor >= MAX_PER_GRUPPO) break;
    const nome = nomeDi(r);
    if (!okLower(blobIndicizzato(r, () => nome))) continue;
    nCor++;
    out.push(conDedupe({
      id: `corriere-dist-${r.id}`,
      gruppo: "Corrieri",
      label: `Distinte ${nome}`,
      sub: "Contabilità → Distinte",
      Ico: IconTruckDelivery,
      bersaglio: { t: "naviga", path: "/contabilita", tab: "distinte", cerca: nome },
    }));
    out.push(conDedupe({
      id: `corriere-sped-${r.id}`,
      gruppo: "Corrieri",
      label: `Spedizioni ${nome}`,
      sub: "Spedizioni → Effettuate",
      Ico: IconTruckLoading,
      bersaglio: { t: "naviga", path: "/evasione", tab: "effettuate", cerca: nome },
    }));
  }

  // Distinte corrieri (per nome corriere o data) → Distinte filtrate sul corriere.
  let nD = 0;
  for (const d of dati.distinte) {
    if (nD >= MAX_PER_GRUPPO) break;
    if (!okLower(blobIndicizzato(d, () => `${d.corriereNome} ${blobData(d.dataDistinta)} ${blobData(d.dataAccredito)}`))) continue;
    nD++;
    out.push(conDedupe({
      id: `distinta-${d.id}`,
      gruppo: "Distinte",
      label: `${d.corriereNome || "Versamento assegni"} · ${dataIt(d.dataDistinta)}`,
      sub: `${d.nPagamenti} pagamenti · ${euro(d.importo)}`,
      Ico: IconTruckDelivery,
      bersaglio: { t: "naviga", path: "/contabilita", tab: "distinte", cerca: d.corriereNome },
    }));
  }

  // Spedizioni (corriere/data/cliente/numero/lotto) → Evasione con il gruppo del collo aperto.
  let nS = 0;
  for (const s of dati.spedizioni) {
    if (nS >= MAX_PER_GRUPPO) break;
    if (
      !okLower(
        blobIndicizzato(
          s,
          () =>
            `${s.lotto} ${s.corriereNome} ${blobData(s.data)} ${s.clienteNome} ${s.numero} ${s.righe
              .map((r) => `${r.ordineNumero} ${r.clienteNome} ${r.prodottoNome} ${r.numero}`)
              .join(" ")}`
        )
      )
    )
      continue;
    nS++;
    out.push(conDedupe({
      id: `sped-${s.id}`,
      gruppo: "Spedizioni",
      label: `${s.corriereNome || "Spedizione"} · ${dataIt(s.data)}`,
      sub: [s.clienteNome, s.numero && `n° ${s.numero}`].filter(Boolean).join(" · ") || undefined,
      Ico: IconTruckLoading,
      bersaglio: { t: "naviga", path: "/evasione", tab: "effettuate", apriId: s.id },
    }));
  }

  // Salda crediti IN FONDO: i pagamenti da incassare (per n° ordine, cliente, medico o
  // scadenza) → aprono il Dettaglio pagamento in finestra dedicata (salda rapido). In coda
  // perché è un'azione, non l'oggetto cercato: in cima resta il risultato più pertinente.
  let nPag = 0;
  for (const p of dati.pagamenti) {
    if (nPag >= MAX_PER_GRUPPO) break;
    if (p.saldato) continue;
    if (!okLower(blobIndicizzato(p, () => `${p.ordineNumero} ${p.clienteNome} ${p.medicoNome} ${blobData(p.scadenza)}`))) continue;
    nPag++;
    out.push(vocePagamento(p));
  }

  return applicaContesto(deduplica(out), dati).slice(0, MAX_TOTALE);
}
