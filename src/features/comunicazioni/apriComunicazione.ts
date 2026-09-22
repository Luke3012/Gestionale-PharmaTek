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

export interface ComunicazioneTarget {
  /** Deduplica la consegna locale + Tauri della stessa apertura. */
  richiestaId?: string;
  destinatarioEntita: "cliente" | "medico" | "laboratorio_laboratorio";
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
  /** Limita il compositore ai canali ammessi dal flusso chiamante. */
  canaliConsentiti?: CanaleComunicazione[];
  /** Gli allegati preparati vanno rilasciati quando il compositore termina. */
  rilasciaAllegatiAllaChiusura?: boolean;
  /** Elimina subito dalla cache locale gli allegati rilasciati e non più referenziati. */
  eliminaAllegatiNonUsatiAllaChiusura?: boolean;
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

export type RiferimentoPagamento = {
  id?: string;
  tipo?: string;
  importo?: number;
  scadenza?: string;
  saldato?: boolean;
  contoId?: string;
  contoNome?: string;
  contoTipo?: string;
  ordineId?: string;
  ordineNumero?: string;
};

export interface OpzioniDatiPagamento {
  tuttiPagamenti?: RiferimentoPagamento[];
  includiRate?: boolean;
}

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
  conti: RecordDto[] = [],
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

  const infosAperti = pagamentiAperti.map((item) =>
    infoContoPagamento(item, conti),
  );
  const chiaviAperti = new Set(infosAperti.map((info) => info.chiave));
  const contiMisti = chiaviAperti.size > 1;

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
    const importoStr = `€ ${centsToEurStr(item.importo)}`;

    let extraMetodo = "";
    if (contiMisti) {
      const info = infoContoPagamento(item, conti);
      if (info.chiave === "contrassegno") {
        extraMetodo = " in contrassegno al corriere alla consegna";
      } else if (info.chiave === "assegno") {
        extraMetodo = " tramite assegno intestato a PharmaTek";
      } else if (info.chiave.startsWith("iban:")) {
        extraMetodo = " tramite bonifico bancario";
      } else if (info.dettaglioSuRiga) {
        extraMetodo = ` ${info.dettaglioSuRiga}`;
      }
    }

    return `- ${nome} ${statoData} ${dataPagamentoIt(item.scadenza)}: ${importoStr}${extraMetodo}`;
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

function infoContoPagamento(
  pagamento: RiferimentoPagamento,
  conti: RecordDto[],
) {
  const conto = conti.find((record) => record.id === pagamento.contoId);
  const tipo = (
    String(conto?.data.tipo ?? "") || pagamento.contoTipo || ""
  ).toLowerCase();
  const nome =
    String(conto?.data.nome ?? "").trim() || pagamento.contoNome?.trim() || "";
  const contoIban = String(conto?.data.iban ?? "").trim();

  if (tipo === "contrassegno") {
    return {
      chiave: "contrassegno",
      modalita: "contrassegno",
      bloccoCoordinate: "Pagamento in contrassegno al corriere.",
      dettaglioSuRiga: "in contrassegno al corriere alla consegna",
      iban: "",
    };
  }
  if (tipo === "assegno") {
    return {
      chiave: "assegno",
      modalita: "assegno",
      bloccoCoordinate:
        "Pagamento tramite assegno intestato a PharmaTek",
      dettaglioSuRiga:
        "tramite assegno intestato a PharmaTek",
      iban: "",
    };
  }
  if (contoIban) {
    const ibanNormalizzato = contoIban.replace(/\s+/g, "").toUpperCase();
    const intestatario =
      ibanNormalizzato.slice(5, 10) === "07601"
        ? "G.M. PHARMATEK S.R.L.S."
        : "PharmaTek";
    return {
      chiave: `iban:${ibanNormalizzato}`,
      modalita: "bonifico bancario",
      bloccoCoordinate: `Bonifico bancario\nIntestatario: ${intestatario}\nIBAN: ${contoIban}.`,
      dettaglioSuRiga: `tramite bonifico bancario su IBAN: ${contoIban} (Intestatario: ${intestatario})`,
      iban: contoIban,
    };
  }
  if (nome) {
    return {
      chiave: `nome:${nome.toLowerCase()}`,
      modalita: nome,
      bloccoCoordinate: `Pagamento su ${nome} secondo gli accordi.`,
      dettaglioSuRiga: `su conto ${nome}`,
      iban: "",
    };
  }
  return {
    chiave: "fallback",
    modalita: "come concordato",
    bloccoCoordinate: "Pagamento secondo gli accordi.",
    dettaglioSuRiga: "",
    iban: "",
  };
}

function bloccoCoordinateConRiferimento(
  bloccoBase: string,
  riferimenti: string[],
): string {
  if (!riferimenti.length) return bloccoBase;
  const rifStr =
    riferimenti.length === 1
      ? riferimenti[0]
      : `${riferimenti.slice(0, -1).join(", ")} e ${riferimenti[riferimenti.length - 1]}`;

  if (bloccoBase.startsWith("Bonifico bancario")) {
    return bloccoBase.replace(
      /^Bonifico bancario\s*/,
      `Bonifico bancario (per ${rifStr}):\n`,
    );
  }
  if (bloccoBase.startsWith("Pagamento tramite assegno")) {
    return `Pagamento tramite assegno (per ${rifStr}) intestato a PharmaTek`;
  }
  return `Per ${rifStr}:\n${bloccoBase}`;
}

/**
 * Compone le variabili di pagamento dai conti correnti: evita IBAN fissi nei
 * modelli e distingue banca, contrassegno e assegno anche nelle rate miste.
 */
export function datiPagamentoComunicazione(
  pagamenti: RiferimentoPagamento[],
  conti: RecordDto[],
  fallback = "Pagamento secondo gli accordi.",
  opzioni: OpzioniDatiPagamento = {},
) {
  const tutti = opzioni.tuttiPagamenti ?? pagamenti;
  const tutteLeRate = tutti
    .filter((p) => p.tipo === "rata")
    .sort((a, b) => {
      if (a.scadenza && b.scadenza) {
        return (
          a.scadenza.localeCompare(b.scadenza) ||
          (a.id || "").localeCompare(b.id || "")
        );
      }
      return 0;
    });

  const posizioneRata = new Map<string | RiferimentoPagamento, number>();
  tutteLeRate.forEach((r, idx) => {
    if (r.id) posizioneRata.set(r.id, idx + 1);
    posizioneRata.set(r, idx + 1);
  });

  const aperti = [...pagamenti]
    .filter((p) => !p.saldato)
    .sort((a, b) => {
      const posA =
        (a.id ? posizioneRata.get(a.id) : undefined) ??
        posizioneRata.get(a) ??
        999;
      const posB =
        (b.id ? posizioneRata.get(b.id) : undefined) ??
        posizioneRata.get(b) ??
        999;
      return posA - posB;
    });

  if (aperti.length === 0) {
    return {
      istruzioni_pagamento: fallback,
      modalita_pagamento: "come concordato",
      iban: "",
    };
  }

  const modalita = new Set<string>();
  const iban = new Set<string>();
  for (const p of aperti) {
    const info = infoContoPagamento(p, conti);
    if (info.modalita) modalita.add(info.modalita);
    if (info.iban) iban.add(info.iban);
  }

  const totaleRatePreviste = tutteLeRate.length;
  const haRate =
    (opzioni.includiRate ?? true) &&
    (totaleRatePreviste > 1 || aperti.length > 1) &&
    aperti.some((p) => p.importo != null || p.tipo === "rata");

  let istruzioni: string;

  if (haRate) {
    const infos = aperti.map((p) => infoContoPagamento(p, conti));
    const chiavi = new Set(infos.map((info) => info.chiave));
    const contoCondiviso = chiavi.size <= 1;

    const righeRate = aperti.map((item, idx) => {
      let nome = "Pagamento";
      if (item.tipo === "rata") {
        const num =
          (item.id ? posizioneRata.get(item.id) : undefined) ??
          posizioneRata.get(item) ??
          (totaleRatePreviste > 1 ? undefined : idx + 1);
        nome = num ? `Rata ${num}` : "Rata";
      } else if (item.tipo === "acconto") {
        nome = "Acconto";
      } else if (item.tipo === "saldo") {
        nome = "Saldo";
      }

      const importoStr =
        item.importo != null ? `: € ${centsToEurStr(item.importo)}` : "";
      const scadenzaStr = item.scadenza
        ? ` entro il ${formattaDataIsoLocale(item.scadenza)}`
        : "";

      if (contoCondiviso) {
        return `- ${nome}${importoStr}${scadenzaStr}`;
      }
      const info = infos[idx];
      const extraMetodo = info.dettaglioSuRiga ? ` ${info.dettaglioSuRiga}` : "";
      return `- ${nome}${importoStr}${scadenzaStr}${extraMetodo}`;
    });

    const intestazione = "Rate previste:";
    if (contoCondiviso) {
      const coordinate = infos[0]?.bloccoCoordinate || fallback;
      istruzioni = `${intestazione}\n${righeRate.join("\n")}\n\n${coordinate}`;
    } else {
      istruzioni = `${intestazione}\n${righeRate.join("\n")}`;
    }
  } else if (opzioni.includiRate === false) {
    const infos = aperti.map((p) => ({
      pagamento: p,
      info: infoContoPagamento(p, conti),
    }));
    const chiavi = new Set(infos.map((item) => item.info.chiave));
    const contoCondiviso = chiavi.size <= 1;

    if (contoCondiviso) {
      const righe = new Set<string>();
      for (const { info } of infos) {
        righe.add(info.bloccoCoordinate);
      }
      istruzioni = [...righe].join("\n") || fallback;
    } else {
      const perChiave = new Map<
        string,
        { blocco: string; riferimenti: string[] }
      >();
      for (const { pagamento, info } of infos) {
        if (info.chiave === "contrassegno") {
          continue;
        }
        let etichetta = "Pagamento";
        if (pagamento.tipo === "rata") {
          const num =
            (pagamento.id ? posizioneRata.get(pagamento.id) : undefined) ??
            posizioneRata.get(pagamento);
          etichetta = num ? `Rata ${num}` : "Rata";
        } else if (pagamento.tipo === "acconto") {
          etichetta = "Acconto";
        } else if (pagamento.tipo === "saldo") {
          etichetta = "Saldo";
        }

        const gruppo = perChiave.get(info.chiave) ?? {
          blocco: info.bloccoCoordinate,
          riferimenti: [],
        };
        if (!gruppo.riferimenti.includes(etichetta)) {
          gruppo.riferimenti.push(etichetta);
        }
        perChiave.set(info.chiave, gruppo);
      }

      if (perChiave.size === 0) {
        istruzioni = infos[0]?.info.bloccoCoordinate || fallback;
      } else {
        istruzioni = [...perChiave.values()]
          .map(({ blocco, riferimenti }) =>
            bloccoCoordinateConRiferimento(blocco, riferimenti),
          )
          .join("\n\n");
      }
    }
  } else {
    const righe = new Set<string>();
    for (const p of aperti) {
      const info = infoContoPagamento(p, conti);
      righe.add(info.bloccoCoordinate);
    }
    istruzioni = [...righe].join("\n") || fallback;
  }

  return {
    istruzioni_pagamento: istruzioni,
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
 * Apre il Centro comunicazioni dalla notifica: mostra sempre la barra laterale
 * a destra portando la finestra principale in primo piano.
 */
export async function apriCentroComunicazioniDaNotifica(
  comunicazioneId: string,
): Promise<boolean> {
  if (!comunicazioneId) return false;
  await apriCentroComunicazioni("laterale", comunicazioneId);
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
