import {
  inTauri,
  type AllegatoComunicazioneInput,
  type CanaleComunicazione,
  type PagamentoVista,
  type Preventivo,
  type RecordDto,
  type TipoModelloComunicazione,
} from "../../lib/tauri";
import { centsToEurStr } from "../../lib/money";
import { formattaDataIsoLocale, oggiIso } from "../../lib/date";
import { creaIdCasuale } from "../../lib/idCasuale";
import {
  apriFinestraTauri,
  portaFinestraInPrimoPiano,
} from "../../lib/finestreTauri";
import {
  CHIAVI_PREFERENZE,
  type OrdineFinestra,
} from "../../lib/prefs";
import { apriFinestraCentroComunicazioni } from "../../shell/apriPannelli";

export interface ComunicazioneTarget {
  /** Deduplica la consegna locale + Tauri della stessa apertura. */
  richiestaId?: string;
  destinatarioEntita: "cliente" | "medico";
  destinatarioId: string;
  destinatarioNome: string;
  email?: string;
  telefono?: string;
  tipo?: TipoModelloComunicazione;
  origineEntita?: string;
  origineId?: string;
  origineRevision?: string;
  origineFingerprint?: string;
  /** Altre origini coperte dallo stesso messaggio batch, con fingerprint proprio. */
  originiCorrelate?: Array<{ id: string; fingerprint: string }>;
  origineSnapshot?: unknown;
  /** Dati già revisionati: gli artefatti vengono generati soltanto al conferma. */
  documentoPreventivo?: Preventivo;
  allegatiPerCanale?: Partial<
    Record<CanaleComunicazione, AllegatoComunicazioneInput[]>
  >;
  variabili?: Record<string, string>;
}

/** Alias del nome destinatario usati da tutti i modelli di comunicazione. */
export function variabiliNomeDestinatario(nome: string) {
  return { nome_cliente: nome, ragione_sociale: nome };
}

/** Nome e recapiti derivati da un'anagrafica aggiornata in tempo reale. */
export function datiDestinatarioDaRecord(
  record: RecordDto,
  nomeFallback: string,
) {
  const valore = (campo: string) =>
    typeof record.data[campo] === "string"
      ? String(record.data[campo]).trim()
      : "";
  return {
    nome:
      valore("ragione_sociale") ||
      valore("denominazione") ||
      valore("nome_completo") ||
      `${valore("nome")} ${valore("cognome")}`.trim() ||
      nomeFallback,
    email: valore("email"),
    telefono: valore("telefono"),
  };
}

export interface CampagnaComunicazioneTarget extends ComunicazioneTarget {
  /** Versioni dei dati usati nell'anteprima: se cambiano, la revisione va rigenerata. */
  snapshot?: Array<{ entita: string; id: string; revision: string }>;
  proroga?: Array<{
    id: string;
    revision: string;
    vecchiaScadenza: string;
    nuovaScadenza: string;
    importo: number;
    contoId: string;
  }>;
}

export const EVENTO_APRI_COMUNICAZIONE = "pt:apri-comunicazione";
export const EVENTO_APRI_CENTRO_COMUNICAZIONI = "pt:apri-centro-comunicazioni";
export const EVENTO_APRI_CAMPAGNA_COMUNICAZIONI =
  "pt:apri-campagna-comunicazioni";
export const CHIAVE_GEOMETRIA_COMUNICAZIONE = "comunicazione";
export const CHIAVE_GEOMETRIA_COMUNICAZIONE_BATCH = "comunicazione-batch";

async function portaMainInPrimoPianoSeNecessario(): Promise<void> {
  const { getAllWindows, getCurrentWindow } =
    await import("@tauri-apps/api/window");
  if (getCurrentWindow().label === "main") return;
  const main = (await getAllWindows()).find(
    (finestra) => finestra.label === "main",
  );
  if (main) await portaFinestraInPrimoPiano(main);
}

const GEOMETRIA_COMUNICAZIONE = {
  width: 680,
  height: 600,
  minWidth: 540,
  minHeight: 440,
  precedentiDefault: [{ width: 900, height: 720 }],
} as const;

const GEOMETRIA_COMUNICAZIONE_BATCH = {
  width: 760,
  height: 640,
  minWidth: 620,
  minHeight: 480,
  precedentiDefault: [{ width: 980, height: 760 }],
} as const;

export interface AperturaCampagnaComunicazioni {
  targets: CampagnaComunicazioneTarget[];
  richiestaId: string;
}

interface OpzioniAperturaComunicazione {
  forzaFinestra?: boolean;
}

export type PresentazioneCentroComunicazioni = "laterale" | "modale";

export interface AperturaCentroComunicazioni {
  presentazione?: PresentazioneCentroComunicazioni;
  comunicazioneId?: string;
  richiestaId?: string;
}

type RiferimentoPagamento = {
  contoId?: string;
  contoNome?: string;
  contoTipo?: string;
};

export interface RiepilogoSollecitoPagamento {
  pagamentiScaduti: PagamentoVista[];
  pagamentiAperti: PagamentoVista[];
  riferimento_ordine: string;
  totale_scaduto: string;
  dettaglio_rate: string;
}

function dataPagamentoIt(dataIso: string): string {
  return formattaDataIsoLocale(dataIso, "da concordare");
}

/**
 * Prepara un solo riepilogo per il sollecito. Gli elementi selezionati servono
 * soltanto a individuare gli ordini interessati; per quegli ordini rileggiamo
 * tutti i pagamenti aperti, così rate e importi futuri non vengono dimenticati.
 */
export function riepilogoSollecitoPagamenti(
  selezionati: PagamentoVista[],
  tutti: PagamentoVista[],
  oggi = oggiIso(),
): RiepilogoSollecitoPagamento {
  const ordini = new Set(selezionati.map((item) => item.ordineId));
  const unici = new Map<string, PagamentoVista>();
  for (const pagamento of tutti) {
    if (
      ordini.has(pagamento.ordineId) &&
      !pagamento.saldato &&
      pagamento.ordineStato !== "Nuovo"
    ) {
      unici.set(pagamento.id, pagamento);
    }
  }
  // Protegge l'anteprima da un refresh concorrente: il pagamento cliccato resta
  // rappresentato anche se l'elenco generale non è ancora stato aggiornato.
  for (const pagamento of selezionati) {
    if (!pagamento.saldato) unici.set(pagamento.id, pagamento);
  }

  const ordineTipo = (tipo: string) =>
    tipo === "acconto" ? 0 : tipo === "rata" ? 1 : 2;
  const pagamentiAperti = [...unici.values()].sort(
    (a, b) =>
      a.ordineNumero.localeCompare(b.ordineNumero, "it", { numeric: true }) ||
      (a.scadenza || "9999-99-99").localeCompare(
        b.scadenza || "9999-99-99",
      ) ||
      ordineTipo(a.tipo) - ordineTipo(b.tipo) ||
      a.id.localeCompare(b.id),
  );
  const pagamentiScaduti = pagamentiAperti.filter(
    (item) => !!item.scadenza && item.scadenza <= oggi,
  );
  const idsScaduti = new Set(pagamentiScaduti.map((item) => item.id));
  const altriAperti = pagamentiAperti.filter(
    (item) => !idsScaduti.has(item.id),
  );
  const numeriOrdine = [
    ...new Set(pagamentiAperti.map((item) => item.ordineNumero).filter(Boolean)),
  ];
  const mostraOrdine = numeriOrdine.length > 1;

  const posizioneRata = new Map<string, { indice: number; totale: number }>();
  for (const ordineId of ordini) {
    const rate = tutti
      .filter((item) => item.ordineId === ordineId && item.tipo === "rata")
      .sort(
        (a, b) =>
          (a.scadenza || "9999-99-99").localeCompare(
            b.scadenza || "9999-99-99",
          ) || a.id.localeCompare(b.id),
      );
    rate.forEach((rata, indice) =>
      posizioneRata.set(rata.id, { indice: indice + 1, totale: rate.length }),
    );
  }

  const riga = (item: PagamentoVista, scaduto: boolean) => {
    const posizione = posizioneRata.get(item.id);
    const nome =
      item.tipo === "acconto"
        ? "Acconto"
        : item.tipo === "saldo"
          ? "Saldo"
          : posizione && posizione.totale > 1
            ? `Rata ${posizione.indice} di ${posizione.totale}`
            : "Rata";
    const statoData = scaduto
      ? item.tipo === "rata"
        ? "scaduta il"
        : "scaduto il"
      : "con scadenza";
    const ordine = mostraOrdine ? `Ordine ${item.ordineNumero} · ` : "";
    return `- ${ordine}${nome} ${statoData} ${dataPagamentoIt(item.scadenza)}: € ${centsToEurStr(item.importo)}`;
  };

  const blocchi: string[] = [];
  if (pagamentiScaduti.length) {
    blocchi.push(
      `${pagamentiScaduti.length === 1 ? "Pagamento scaduto" : "Pagamenti scaduti"}:\n${pagamentiScaduti
        .map((item) => riga(item, true))
        .join("\n")}`,
    );
  }
  if (altriAperti.length) {
    blocchi.push(
      `Altri pagamenti ancora da saldare:\n${altriAperti
        .map((item) => riga(item, false))
        .join("\n")}`,
    );
  }

  return {
    pagamentiScaduti,
    pagamentiAperti,
    riferimento_ordine: numeriOrdine.join(", "),
    totale_scaduto: `€ ${centsToEurStr(
      pagamentiScaduti.reduce((totale, item) => totale + item.importo, 0),
    )}`,
    dettaglio_rate: blocchi.join("\n\n"),
  };
}

/**
 * Compone le variabili di pagamento dai conti correnti: evita IBAN fissi nei
 * modelli e distingue banca, contrassegno e assegno anche nelle rate miste.
 */
export function datiPagamentoComunicazione(
  pagamenti: RiferimentoPagamento[],
  conti: RecordDto[],
  fallback = "Pagamento secondo gli accordi.",
) {
  const righe = new Set<string>();
  const modalita = new Set<string>();
  const iban = new Set<string>();
  for (const pagamento of pagamenti) {
    const conto = conti.find((record) => record.id === pagamento.contoId);
    const nome =
      pagamento.contoNome?.trim() || String(conto?.data.nome ?? "").trim();
    const tipo = (
      pagamento.contoTipo || String(conto?.data.tipo ?? "")
    ).toLowerCase();
    const contoIban = String(conto?.data.iban ?? "").trim();
    if (tipo === "contrassegno") {
      modalita.add("contrassegno");
      righe.add("Pagamento in contrassegno al corriere.");
    } else if (tipo === "assegno") {
      modalita.add("assegno");
      righe.add(
        "Pagamento tramite assegno intestato a PharmaTek",
      );
    } else if (contoIban) {
      const ibanNormalizzato = contoIban.replace(/\s+/g, "").toUpperCase();
      const intestatario =
        ibanNormalizzato.slice(5, 10) === "07601"
          ? "G.M. PHARMATEK S.R.L.S."
          : "PharmaTek";
      modalita.add("bonifico bancario");
      iban.add(contoIban);
      righe.add(
        `Bonifico bancario\nIntestatario: ${intestatario}\nIBAN: ${contoIban}.`,
      );
    } else if (nome) {
      modalita.add(nome);
      righe.add(`Pagamento su ${nome} secondo gli accordi.`);
    }
  }
  return {
    istruzioni_pagamento: [...righe].join("\n") || fallback,
    modalita_pagamento: [...modalita].join(", ") || "come concordato",
    iban: [...iban].join(", "),
  };
}

/** Evita testi fuorvianti come “€ 0,00” o importi negativi negli avvisi. */
export function importoResiduoComunicazione(importo: number): string {
  return importo > 0
    ? `€ ${centsToEurStr(importo)}`
    : "nessun importo da saldare";
}

export async function apriCentroComunicazioni(
  presentazione: PresentazioneCentroComunicazioni = "laterale",
  comunicazioneId?: string,
) {
  const richiesta: AperturaCentroComunicazioni = {
    presentazione,
    comunicazioneId,
    richiestaId: creaIdCasuale(),
  };
  window.dispatchEvent(
    new CustomEvent(EVENTO_APRI_CENTRO_COMUNICAZIONI, {
      detail: richiesta,
    }),
  );
  if (inTauri) {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(EVENTO_APRI_CENTRO_COMUNICAZIONI, richiesta);
  }
}

/**
 * Apre una comunicazione dalla campanella: una voce già esistente è assimilata
 * alla modifica, quindi "Solo in modifica" usa la finestra separata.
 */
export async function apriCentroComunicazioniDaNotifica(
  comunicazioneId: string,
): Promise<boolean> {
  if (!comunicazioneId) return false;
  const preferenza = preferenzaFinestraCorrente();
  if (
    preferenza !== "mai" &&
    (await apriFinestraCentroComunicazioni(comunicazioneId))
  ) {
    return true;
  }

  await apriCentroComunicazioni("modale", comunicazioneId);
  if (inTauri) {
    await portaMainInPrimoPianoSeNecessario();
  }
  return true;
}

/** Punto unico per aprire il compositore nella finestra principale. */
export async function apriComunicazione(
  target: ComunicazioneTarget,
  opzioni: OpzioniAperturaComunicazione = {},
): Promise<boolean> {
  if (!target.destinatarioId || !target.destinatarioNome) return false;
  const richiestaId = creaIdCasuale();
  const richiesta = { ...target, richiestaId };
  const manuale = !target.origineId && !target.tipo;
  if (opzioni.forzaFinestra) {
    return apriFinestraComunicazione(richiesta);
  }
  if (
    manuale &&
    preferenzaFinestraCorrente() !== "mai" &&
    (await apriFinestraComunicazione(richiesta))
  ) {
    return true;
  }
  window.dispatchEvent(
    new CustomEvent(EVENTO_APRI_COMUNICAZIONE, { detail: richiesta }),
  );
  if (inTauri) {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(EVENTO_APRI_COMUNICAZIONE, richiesta);
    await portaMainInPrimoPianoSeNecessario();
  }
  return true;
}

function preferenzaFinestraCorrente(): OrdineFinestra {
  try {
    const valore = localStorage.getItem(CHIAVI_PREFERENZE.ordineFinestra);
    if (valore === "mai" || valore === "modifica" || valore === "sempre") {
      return valore;
    }
  } catch {
    // In ambienti senza storage resta il comportamento in modale.
  }
  return "mai";
}

async function apriFinestraComunicazione(
  target: ComunicazioneTarget,
): Promise<boolean> {
  if (!inTauri) return false;
  const suffisso = `${target.destinatarioEntita}-${target.destinatarioId}`
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 28);
  return apriFinestraTauri({
    label: `comunicazione-${suffisso}`,
    query: `componiComunicazione=1&payload=${encodeURIComponent(JSON.stringify(target))}`,
    title: `Comunicazione — ${target.destinatarioNome}`,
    chiaveGeometria: CHIAVE_GEOMETRIA_COMUNICAZIONE,
    geometria: GEOMETRIA_COMUNICAZIONE,
  });
}

export async function apriCampagnaComunicazioni(
  targets: CampagnaComunicazioneTarget[],
  opzioni: OpzioniAperturaComunicazione = {},
): Promise<boolean> {
  const validi = targets.filter(
    (target) => target.destinatarioId && target.destinatarioNome,
  );
  if (!validi.length) return false;
  const richiesta: AperturaCampagnaComunicazioni = {
    targets: validi,
    richiestaId: creaIdCasuale(),
  };
  if (opzioni.forzaFinestra) {
    return apriFinestraCampagnaComunicazioni(richiesta);
  }
  window.dispatchEvent(
    new CustomEvent(EVENTO_APRI_CAMPAGNA_COMUNICAZIONI, {
      detail: richiesta,
    }),
  );
  if (inTauri) {
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit(EVENTO_APRI_CAMPAGNA_COMUNICAZIONI, richiesta);
    } catch {
      // La consegna locale resta sufficiente nella finestra principale.
    }
  }
  return true;
}

async function apriFinestraCampagnaComunicazioni(
  richiesta: AperturaCampagnaComunicazioni,
): Promise<boolean> {
  if (!inTauri) return false;
  const label = "comunicazione-batch";
  return apriFinestraTauri({
    label,
    query: `campagnaComunicazioni=1&payload=${encodeURIComponent(JSON.stringify(richiesta))}`,
    title: "Nuova comunicazione",
    chiaveGeometria: CHIAVE_GEOMETRIA_COMUNICAZIONE_BATCH,
    geometria: GEOMETRIA_COMUNICAZIONE_BATCH,
    primaDiRiutilizzare: async () => {
      const { emitTo } = await import("@tauri-apps/api/event");
      await emitTo(
        label,
        EVENTO_APRI_CAMPAGNA_COMUNICAZIONI,
        richiesta,
      );
    },
  });
}
