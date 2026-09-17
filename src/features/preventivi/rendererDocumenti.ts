import { api, inTauri, type Preventivo, type SchedaClienteCampi } from "../../lib/tauri";
import { formattaDataLocale, formattaDataSeparataItaliana as dataIt } from "../../lib/date";
import { formattaEuroCentesimi as euro } from "../../lib/money";
import {
  PHARMATEK_LOGO_CROP_HEIGHT,
  PHARMATEK_LOGO_CROP_Y,
  PHARMATEK_LOGO_PNG_BASE64,
  PHARMATEK_LOGO_RGB_RLE_BASE64,
  PHARMATEK_LOGO_SOURCE_HEIGHT,
  PHARMATEK_LOGO_SOURCE_WIDTH,
} from "./pharmatekLogoAsset";

export const A4_WIDTH = 794;
export const A4_HEIGHT = 1123;

type Align = "left" | "center" | "right";

interface BaseNode {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface RectNode extends BaseNode {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

export interface LineNode extends BaseNode {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PolygonNode extends BaseNode {
  kind: "polygon";
  points: Array<[number, number]>;
}

export interface TextNode extends BaseNode {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  weight?: 400 | 600 | 700 | 800;
  align?: Align;
  letterSpacing?: number;
  fontFamily?: "ui" | "arial";
}

export interface LogoNode extends BaseNode {
  kind: "logo";
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DocumentoNode = RectNode | LineNode | PolygonNode | TextNode | LogoNode;

export interface DocumentoA4 {
  titolo: string;
  nomeFile: string;
  nodes: DocumentoNode[];
  /** Pagine successive alla prima. `nodes` resta la prima pagina per compatibilità. */
  pagine?: DocumentoNode[][];
  overflow: string[];
}

export interface ConfigurazioneDocumento {
  denominazione: string;
  indirizzo: string;
  localita: string;
  telefono: string;
  email: string;
  sito: string;
}

export const CONFIGURAZIONE_DOCUMENTO_DEFAULT: ConfigurazioneDocumento = {
  denominazione: "PharmaTek",
  indirizzo: "",
  localita: "",
  telefono: "",
  email: "demo@example.invalid",
  sito: "example.invalid",
};

const COLORI = {
  navy: "#111111",
  navySoft: "#171717",
  yellow: "#f4c542",
  yellowSoft: "#fff6d8",
  ink: "#182033",
  muted: "#657087",
  line: "#d7dce5",
  pale: "#f5f7fa",
  white: "#ffffff",
  green: "#157f65",
};

const SCHEDA_NERO = "#111111";
const SCHEDA_GIALLO = "#f4c542";
const TELEFONO_AZIENDA = "";
const WHATSAPP_AZIENDA = "";
const IBAN_AZIENDA = "IT00 X000 00DE MO";

function testo(
  nodes: DocumentoNode[],
  x: number,
  y: number,
  value: string,
  size: number,
  options: Partial<Omit<TextNode, "kind" | "x" | "y" | "text" | "size">> = {},
) {
  nodes.push({ kind: "text", x, y, text: value, size, fill: COLORI.ink, ...options });
}

function testoScheda(
  nodes: DocumentoNode[],
  x: number,
  y: number,
  value: string,
  size: number,
  options: Partial<Omit<TextNode, "kind" | "x" | "y" | "text" | "size">> = {},
) {
  testo(nodes, x, y, value, size, {
    fill: SCHEDA_NERO,
    fontFamily: "arial",
    ...options,
  });
}

function rect(
  nodes: DocumentoNode[],
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<Omit<RectNode, "kind" | "x" | "y" | "width" | "height">> = {},
) {
  nodes.push({ kind: "rect", x, y, width, height, ...options });
}

function polygon(
  nodes: DocumentoNode[],
  points: Array<[number, number]>,
  options: Partial<Omit<PolygonNode, "kind" | "points">> = {},
) {
  nodes.push({ kind: "polygon", points, ...options });
}

function line(
  nodes: DocumentoNode[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke = COLORI.line,
  strokeWidth = 1,
) {
  nodes.push({ kind: "line", x1, y1, x2, y2, stroke, strokeWidth });
}

function stimaLarghezza(value: string, size: number, weight = 400): number {
  const fattore = weight >= 700 ? 0.57 : 0.52;
  return [...value].reduce((totale, carattere) => {
    if ("ilI1.,:;'".includes(carattere)) return totale + size * 0.28;
    if ("mwMW@%".includes(carattere)) return totale + size * 0.82;
    return totale + size * fattore;
  }, 0);
}

const HELVETICA_BOLD_WIDTHS: Record<string, number> = {
  " ": 278,
  "/": 278,
  "0": 556,
  "1": 556,
  "2": 556,
  "3": 556,
  "4": 556,
  "5": 556,
  "6": 556,
  "7": 556,
  "8": 556,
  "9": 556,
  A: 722,
  B: 722,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 556,
  K: 722,
  L: 611,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
};

function larghezzaTestoPdf(value: string, size: number, weight = 400): number {
  if (weight < 600) return stimaLarghezza(value, size, weight);
  return [...value].reduce((totale, carattere) => {
    const width = HELVETICA_BOLD_WIDTHS[carattere];
    return totale + (width === undefined ? stimaLarghezza(carattere, size, weight) : (width / 1000) * size);
  }, 0);
}

function logoPharmaTek(
  nodes: DocumentoNode[],
  x: number,
  y: number,
  width: number,
  height = 54,
) {
  nodes.push({ kind: "logo", x, y, width, height });
}

function troncaTesto(
  value: string,
  maxWidth: number,
  size: number,
  weight = 400,
): string {
  if (stimaLarghezza(value, size, weight) <= maxWidth) return value;
  let visibile = value;
  while (
    visibile &&
    stimaLarghezza(`${visibile.trimEnd()}…`, size, weight) > maxWidth
  ) {
    visibile = visibile.slice(0, -1);
  }
  return `${visibile.trimEnd()}…`;
}

export function avvolgiTesto(
  value: string,
  maxWidth: number,
  size: number,
  weight = 400,
): string[] {
  const paragrafi = value.replace(/\r/g, "").split("\n");
  const result: string[] = [];
  for (const paragrafo of paragrafi) {
    const parole = paragrafo.trim().split(/\s+/).filter(Boolean);
    if (parole.length === 0) {
      result.push("");
      continue;
    }
    let corrente = "";
    for (const parola of parole) {
      const candidata = corrente ? `${corrente} ${parola}` : parola;
      if (stimaLarghezza(candidata, size, weight) <= maxWidth) {
        corrente = candidata;
      } else if (!corrente) {
        let frammento = "";
        for (const carattere of parola) {
          if (stimaLarghezza(frammento + carattere, size, weight) > maxWidth && frammento) {
            result.push(frammento);
            frammento = carattere;
          } else {
            frammento += carattere;
          }
        }
        corrente = frammento;
      } else {
        result.push(corrente);
        corrente = parola;
      }
    }
    if (corrente) result.push(corrente);
  }
  return result;
}

function testoMultilinea(
  nodes: DocumentoNode[],
  x: number,
  y: number,
  value: string,
  maxWidth: number,
  size: number,
  maxLines: number,
  options: Partial<Omit<TextNode, "kind" | "x" | "y" | "text" | "size">> = {},
): { lines: number; overflow: boolean } {
  const righe = avvolgiTesto(value || "—", maxWidth, size, options.weight ?? 400);
  const visibili = righe.slice(0, maxLines);
  const overflow = righe.length > maxLines;
  if (overflow && visibili.length > 0) {
    const ultima = visibili.length - 1;
    let troncata = visibili[ultima];
    while (troncata && stimaLarghezza(`${troncata}…`, size, options.weight) > maxWidth) {
      troncata = troncata.slice(0, -1);
    }
    visibili[ultima] = `${troncata.trimEnd()}…`;
  }
  visibili.forEach((riga, index) =>
    testo(nodes, x, y + index * size * 1.28, riga, size, options),
  );
  return { lines: visibili.length, overflow };
}

function ibanVisuale(value: string): string {
  return value
    .replace(/\s+/g, "")
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join(" ") ?? value;
}

export function creaDocumentoPreventivo(
  preventivo: Preventivo,
  config = CONFIGURAZIONE_DOCUMENTO_DEFAULT,
): DocumentoA4 {
  const overflow: string[] = [];
  const pagine: DocumentoNode[][] = [];
  const limiteContenuto = 1058;
  const compattoTreProdotti = preventivo.righe.length === 3;
  let nodes: DocumentoNode[] = [];
  let y = 138;

  const creaTestata = (pagina: DocumentoNode[], continuazione: boolean) => {
    polygon(
      pagina,
      [
        [404, 0],
        [A4_WIDTH, 0],
        [A4_WIDTH, 112],
        [454, 112],
      ],
      { fill: COLORI.navy },
    );
    polygon(
      pagina,
      [
        [385, 0],
        [404, 0],
        [454, 112],
        [435, 112],
      ],
      { fill: COLORI.yellow },
    );
    logoPharmaTek(pagina, 48, 17, 252, 52);
    testo(pagina, 48, 96, continuazione ? "PREVENTIVO · SEGUE" : "PREVENTIVO", 11, {
      weight: 800,
      fill: COLORI.navy,
      letterSpacing: 1.7,
    });
    const centroContatti = 625;
    testo(pagina, centroContatti, 27, config.indirizzo, 8.1, {
      align: "center",
      fill: COLORI.white,
      weight: 600,
    });
    testo(pagina, centroContatti, 42, config.localita, 8.1, {
      align: "center",
      fill: COLORI.white,
    });
    testo(pagina, centroContatti, 59, `Fisso ${TELEFONO_AZIENDA}`, 8.1, {
      align: "center",
      fill: COLORI.white,
    });
    testo(pagina, centroContatti, 75, `WhatsApp ${WHATSAPP_AZIENDA}`, 8.1, {
      align: "center",
      fill: COLORI.yellow,
      weight: 700,
    });
    testo(pagina, centroContatti, 91, troncaTesto(`${config.email} · ${config.sito}`, 310, 8.1), 8.1, {
      align: "center",
      fill: COLORI.white,
    });
  };

  const nuovaPagina = () => {
    nodes = [];
    pagine.push(nodes);
    creaTestata(nodes, pagine.length > 1);
    y = 138;
  };
  const assicuratiSpazio = (height: number) => {
    if (y + height <= limiteContenuto) return false;
    nuovaPagina();
    return true;
  };
  nuovaPagina();

  const dataPreventivo = preventivo.creatoMs
    ? formattaDataLocale(preventivo.creatoMs)
    : dataIt(preventivo.ordineData);
  rect(nodes, 48, y, 698, 54, {
    radius: 8,
    fill: COLORI.yellow,
    stroke: COLORI.navy,
    strokeWidth: 1,
  });
  testo(nodes, 66, y + 19, "PROPOSTA COMMERCIALE", 8, {
    weight: 800,
    fill: COLORI.navy,
    letterSpacing: 1.05,
  });
  testo(nodes, 66, y + 39, preventivo.numeroPreventivo, 15, {
    weight: 800,
    fill: COLORI.navy,
  });
  const dataHeaderX = 712;
  testo(nodes, dataHeaderX, y + 20, "DATA DI CREAZIONE", 7.3, {
    weight: 800,
    fill: COLORI.navy,
    align: "right",
    letterSpacing: 0.7,
  });
  testo(nodes, dataHeaderX, y + 40, dataPreventivo, 11, {
    weight: 700,
    fill: COLORI.navy,
    align: "right",
  });
  y += compattoTreProdotti ? 66 : 68;

  const localita = (cap: string, citta: string, prov: string) =>
    [[cap, citta].filter(Boolean).join(" "), prov ? `(${prov})` : ""]
      .filter(Boolean)
      .join(" ");

  type DatiDocumento = {
    nome: string;
    indirizzo: string;
    citta: string;
    cap: string;
    prov: string;
    codiceFiscale: string;
    piva: string;
    telefono: string;
    email: string;
    note: string;
  };
  const datiCliente: DatiDocumento = {
    nome: preventivo.clienteNome,
    indirizzo: preventivo.clienteIndirizzo,
    citta: preventivo.clienteCitta,
    cap: preventivo.clienteCap,
    prov: preventivo.clienteProv,
    codiceFiscale: "",
    piva: "",
    telefono: preventivo.telefono,
    email: preventivo.email,
    note: "",
  };
  const completaDati = (
    principali: DatiDocumento,
    fallback: DatiDocumento,
  ): DatiDocumento => ({
    nome: principali.nome || fallback.nome,
    indirizzo: principali.indirizzo || fallback.indirizzo,
    citta: principali.citta || fallback.citta,
    cap: principali.cap || fallback.cap,
    prov: principali.prov || fallback.prov,
    codiceFiscale: principali.codiceFiscale || fallback.codiceFiscale,
    piva: principali.piva || fallback.piva,
    telefono: principali.telefono || fallback.telefono,
    email: principali.email || fallback.email,
    note: principali.note,
  });
  const datiPresenti = (dati: DatiDocumento) =>
    [
      dati.nome,
      dati.indirizzo,
      dati.citta,
      dati.cap,
      dati.prov,
      dati.codiceFiscale,
      dati.piva,
    ].some((valore) => valore.trim());
  let spedizione: DatiDocumento = {
    nome: preventivo.spedizioneNome,
    indirizzo: preventivo.spedizioneIndirizzo,
    citta: preventivo.spedizioneCitta,
    cap: preventivo.spedizioneCap,
    prov: preventivo.spedizioneProv,
    codiceFiscale: preventivo.spedizioneCodiceFiscale,
    piva: "",
    telefono: preventivo.spedizioneTelefono,
    email: preventivo.spedizioneEmail,
    note: preventivo.spedizioneNote,
  };
  let fatturazione: DatiDocumento = {
    nome: preventivo.fatturazioneNome,
    indirizzo: preventivo.fatturazioneIndirizzo,
    citta: preventivo.fatturazioneCitta,
    cap: preventivo.fatturazioneCap,
    prov: preventivo.fatturazioneProv,
    codiceFiscale: preventivo.fatturazioneCodiceFiscale,
    piva: preventivo.fatturazionePiva,
    telefono: "",
    email: "",
    note: "",
  };
  if (!datiPresenti(spedizione) && datiPresenti(fatturazione)) {
    spedizione = { ...fatturazione };
  }
  if (!datiPresenti(fatturazione) && datiPresenti(spedizione)) {
    fatturazione = { ...spedizione };
  }
  spedizione = completaDati(spedizione, datiCliente);
  fatturazione = completaDati(fatturazione, datiCliente);

  const identificativiFiscali = (dati: DatiDocumento) => {
    const normalizza = (valore: string) => valore.replace(/[\s.-]/g, "").toUpperCase();
    const codiceFiscale = normalizza(dati.codiceFiscale);
    const piva = normalizza(dati.piva);
    const pivaSembraCf = /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(piva);
    return [
      dati.piva ? `${pivaSembraCf ? "C.F." : "P. IVA"} ${dati.piva}` : "",
      dati.codiceFiscale && codiceFiscale !== piva
        ? `C.F. ${dati.codiceFiscale}`
        : "",
    ].filter(Boolean);
  };
  const righeSpedizione = [
    spedizione.nome || "—",
    [
      spedizione.indirizzo,
      localita(spedizione.cap, spedizione.citta, spedizione.prov),
    ]
      .filter(Boolean)
      .join(", "),
    [spedizione.telefono, spedizione.email]
      .filter(Boolean)
      .join(" · "),
    spedizione.note,
  ].filter(Boolean);
  const righeFatturazione = [
    fatturazione.nome || "—",
    [
      fatturazione.indirizzo,
      localita(fatturazione.cap, fatturazione.citta, fatturazione.prov),
    ]
      .filter(Boolean)
      .join(", "),
    ...identificativiFiscali(fatturazione),
  ].filter(Boolean);
  const preparaRigheCard = (valori: string[], width: number) =>
    valori.flatMap((valore, index) =>
      avvolgiTesto(valore, width, index === 0 ? 10.8 : 8.6, index === 0 ? 700 : 400).map(
        (linea) => ({ linea, principale: index === 0 }),
      ),
    );
  const contenutoSpedizione = preparaRigheCard(righeSpedizione, 298);
  const contenutoFatturazione = preparaRigheCard(righeFatturazione, 298);
  const cardLineStep = compattoTreProdotti ? 11 : 12;
  const cardHeight = Math.max(
    compattoTreProdotti ? 112 : 120,
    (compattoTreProdotti ? 57 : 60) +
      Math.max(contenutoSpedizione.length, contenutoFatturazione.length) *
        cardLineStep,
  );
  const card = (
    x: number,
    titolo: string,
    indice: string,
    contenuto: Array<{ linea: string; principale: boolean }>,
  ) => {
    rect(nodes, x, y, 339, cardHeight, {
      radius: 11,
      fill: COLORI.white,
      stroke: COLORI.line,
      strokeWidth: 0.85,
    });
    rect(nodes, x, y + 13, 4, cardHeight - 26, { radius: 2, fill: COLORI.yellow });
    rect(nodes, x + 17, y + 13, 24, 24, { radius: 12, fill: COLORI.yellowSoft });
    testo(nodes, x + 29, y + 29, indice, 7.2, {
      align: "center",
      weight: 800,
      fill: COLORI.navy,
    });
    testo(nodes, x + 51, y + 29, titolo, 8.2, {
      weight: 800,
      fill: COLORI.ink,
      letterSpacing: 0.75,
    });
    line(nodes, x + 17, y + 46, x + 322, y + 46, COLORI.line, 0.7);
    let lineY = y + (compattoTreProdotti ? 60 : 64);
    contenuto.forEach(({ linea: valore, principale }) => {
      testo(nodes, x + 17, lineY, valore, principale ? 10.8 : 8.6, {
        weight: principale ? 700 : 400,
        fill: principale ? COLORI.ink : COLORI.muted,
      });
      lineY += cardLineStep;
    });
  };
  card(48, "DATI DI SPEDIZIONE", "01", contenutoSpedizione);
  card(407, "DATI DI FATTURAZIONE", "02", contenutoFatturazione);
  y += cardHeight + (compattoTreProdotti ? 10 : 17);

  if (preventivo.introduzione.trim()) {
    const introLines = avvolgiTesto(preventivo.introduzione, 698, 9.2);
    assicuratiSpazio(introLines.length * 12 + 12);
    introLines.forEach((riga, index) =>
      testo(nodes, 48, y + 9 + index * 12, riga, 9.2, { fill: COLORI.muted }),
    );
    y += introLines.length * 12 + (compattoTreProdotti ? 9 : 18);
  }

  const soloImmunoterapia =
    preventivo.righe.length > 0
      ? preventivo.righe.every((riga) => riga.categoria === "Immunoterapia")
      : preventivo.linee.length === 1 &&
        preventivo.linee[0] === "Immunoterapia";
  const larghezzaDettagliProdotto = soloImmunoterapia ? 450 : 390;
  const dettagliRiga = (riga: Preventivo["righe"][number]) => {
    const dettagli: string[] = [];
    if (riga.paziente) dettagli.push(`Paziente: ${riga.paziente}`);
    const specifiche = [
      riga.formulazione ? `Formulazione: ${riga.formulazione}` : "",
      riga.posologia ? `Posologia: ${riga.posologia}` : "",
      riga.numero ? `Numero lotto: ${riga.numero}` : "",
    ].filter(Boolean);
    if (specifiche.length) dettagli.push(specifiche.join(" · "));
    if (riga.allergeni.length) dettagli.push(`Allergeni: ${riga.allergeni.join(", ")}`);
    const diagnostica = [
      riga.tipoTest ? `Test ${riga.tipoTest}` : "",
      riga.ml ? `${riga.ml} ml` : "",
      riga.codice ? `Cod. ${riga.codice}` : "",
    ].filter(Boolean);
    if (diagnostica.length) dettagli.push(`Diagnostica: ${diagnostica.join(" · ")}`);
    return dettagli.flatMap((dettaglio) =>
      avvolgiTesto(dettaglio, larghezzaDettagliProdotto, 7.15, 400),
    );
  };
  const intestazioneProdotti = () => {
    const centroQta = 497;
    const centroPrezzo = 584;
    const centroTotale = 688;
    rect(nodes, 48, y, 698, 30, {
      radius: 7,
      fill: COLORI.navy,
      stroke: COLORI.navy,
      strokeWidth: 0.8,
    });
    const colonne: Array<[number, string, Align]> = [
      [64, "PRODOTTI E DATI TECNICI", "left"],
      ...(soloImmunoterapia
        ? []
        : ([[centroQta, "Q.TÀ", "center"]] as Array<[number, string, Align]>)),
      [centroPrezzo, "PREZZO", "center"],
      [centroTotale, "TOTALE", "center"],
    ];
    for (const [x, label, align] of colonne) {
      testo(nodes, x, y + 20, label, 7.8, {
        fill: align === "left" ? COLORI.yellow : COLORI.white,
        weight: 800,
        align,
        letterSpacing: align === "left" ? 0.65 : 0,
      });
    }
    y += 30;
  };
  assicuratiSpazio(82);
  intestazioneProdotti();
  if (preventivo.righe.length === 0) {
    rect(nodes, 48, y, 698, 44, { fill: COLORI.white, stroke: COLORI.line });
    testo(nodes, 64, y + 27, "Nessun prodotto inserito.", 9, { fill: COLORI.muted });
    y += 44;
  } else {
    preventivo.righe.forEach((riga, index) => {
      const nomeLines = avvolgiTesto(
        riga.prodottoNome || "Prodotto",
        larghezzaDettagliProdotto,
        9.2,
        700,
      );
      const detailLines = dettagliRiga(riga);
      const nomeStep = compattoTreProdotti ? 11 : 12;
      const detailStep = compattoTreProdotti ? 8.6 : 9.4;
      const rowHeight = Math.max(
        compattoTreProdotti ? 44 : 48,
        (compattoTreProdotti ? 18 : 21) +
          nomeLines.length * nomeStep +
          detailLines.length * detailStep,
      );
      if (y + rowHeight > limiteContenuto) {
        nuovaPagina();
        intestazioneProdotti();
      }
      rect(nodes, 48, y, 698, rowHeight, {
        fill: index % 2 === 0 ? COLORI.white : "#fffbee",
        stroke: COLORI.line,
        strokeWidth: 0.65,
      });
      if (!soloImmunoterapia) {
        line(nodes, 466, y, 466, y + rowHeight, COLORI.line, 0.45);
      }
      line(nodes, 528, y, 528, y + rowHeight, COLORI.line, 0.45);
      line(nodes, 640, y, 640, y + rowHeight, COLORI.line, 0.45);
      nomeLines.forEach((valore, lineIndex) =>
        testo(
          nodes,
          64,
          y + (compattoTreProdotti ? 17 : 19) + lineIndex * nomeStep,
          valore,
          9.2,
          {
          weight: 700,
          fill: COLORI.ink,
          },
        ),
      );
      const detailStart =
        y + (compattoTreProdotti ? 17 : 19) + nomeLines.length * nomeStep;
      detailLines.forEach((valore, lineIndex) =>
        testo(nodes, 64, detailStart + lineIndex * detailStep, valore, 7.15, {
          fill: COLORI.muted,
        }),
      );
      if (!soloImmunoterapia) {
        testo(
          nodes,
          497,
          y + (compattoTreProdotti ? 23 : 25),
          String(riga.qta),
          9,
          {
            align: "center",
            weight: 700,
          },
        );
      }
      testo(nodes, 584, y + (compattoTreProdotti ? 23 : 25), euro(riga.prezzo), 8.6, {
        align: "center",
      });
      testo(nodes, 688, y + (compattoTreProdotti ? 23 : 25), euro(riga.qta * riga.prezzo), 9, {
        align: "center",
        weight: 800,
      });
      y += rowHeight;
    });
  }
  y += compattoTreProdotti ? 4 : 8;

  const imponibile = Math.round(preventivo.totale / 1.1);
  const iva = preventivo.totale - imponibile;
  const scontoPercentuale = Math.min(90, Math.max(0, preventivo.scontoPercentuale || 0));
  const totalePrimaSconto =
    scontoPercentuale > 0
      ? Math.round(preventivo.totale / (1 - scontoPercentuale / 100))
      : preventivo.totale;
  const valoreSconto = Math.max(0, totalePrimaSconto - preventivo.totale);
  const accontoIncassato = preventivo.pagamenti?.some(
    (pagamento) => pagamento.tipo === "acconto" && pagamento.saldato,
  );
  const riepilogo = scontoPercentuale > 0
    ? [
        ["Valore originale", euro(totalePrimaSconto)],
        [`Sconto ${scontoPercentuale}%`, `- ${euro(valoreSconto)}`],
        ["Imponibile", euro(imponibile)],
        ["IVA 10%", euro(iva)],
        ["Totale IVA inclusa", euro(preventivo.totale)],
      ]
    : [
        ["Imponibile", euro(imponibile)],
        ["IVA 10%", euro(iva)],
        ["Totale IVA inclusa", euro(preventivo.totale)],
      ];
  const riepilogoConSconto = scontoPercentuale > 0;
  const totaleIndex = riepilogo.length - 1;

  type PagamentoDocumento = {
    tipo: string;
    importo: number;
    saldato: boolean;
    scadenza: string;
    data: string;
    contoNome: string;
    contoTipo: string;
    contoIban?: string;
    scadDaSpedizione: boolean;
    scadRelGiorni?: number;
  };
  const confrontaPagamentiDocumento = (
    a: PagamentoDocumento,
    b: PagamentoDocumento,
  ): number => {
    const prioritaA = a.tipo === "acconto" ? 0 : 1;
    const prioritaB = b.tipo === "acconto" ? 0 : 1;
    if (prioritaA !== prioritaB) return prioritaA - prioritaB;

    if (a.scadDaSpedizione && b.scadDaSpedizione) {
      const relA = a.scadRelGiorni ?? 0;
      const relB = b.scadRelGiorni ?? 0;
      if (relA !== relB) return relA - relB;
    }

    const dataChiave = (p: PagamentoDocumento) => {
      if (p.scadDaSpedizione) {
        return `spedizione:${String(p.scadRelGiorni ?? 0).padStart(5, "0")}`;
      }
      return p.scadenza || p.data || "9999-12-31";
    };

    const comp = dataChiave(a).localeCompare(dataChiave(b));
    if (comp !== 0) return comp;

    const tipoPriorita = (tipo: string) => {
      if (tipo === "saldo") return 0;
      if (tipo === "rata") return 1;
      return 2;
    };
    return tipoPriorita(a.tipo) - tipoPriorita(b.tipo);
  };

  const pagamenti: PagamentoDocumento[] = (
    preventivo.pagamenti?.length
      ? [...preventivo.pagamenti]
      : [
          ...(preventivo.acconto > 0
            ? [{
                tipo: "acconto",
                importo: preventivo.acconto,
                saldato: false,
                scadenza: "",
                data: "",
                contoNome: "Bonifico",
                contoTipo: "banca",
                contoIban: IBAN_AZIENDA,
                scadDaSpedizione: false,
                scadRelGiorni: 0,
              }]
            : []),
          {
            tipo: "saldo",
            importo: Math.max(0, preventivo.totale - preventivo.acconto),
            saldato: false,
            scadenza: "",
            data: "",
            contoNome: "Bonifico",
            contoTipo: "banca",
            contoIban: IBAN_AZIENDA,
            scadDaSpedizione: true,
            scadRelGiorni: 0,
          },
        ]
  )
    .filter((pagamento) => pagamento.importo > 0)
    .sort(confrontaPagamentiDocumento);
  let numeroRata = 0;
  const etichettaPagamento = (tipo: string) => {
    if (tipo === "acconto") return "Acconto";
    if (tipo === "saldo") return "Saldo";
    numeroRata += 1;
    return `${numeroRata}ª rata`;
  };
  const headerRiepilogoHeight = compattoTreProdotti ? 29 : 31;
  const rataHeight = compattoTreProdotti ? 32 : 35;
  const riepilogoFooterHeight = compattoTreProdotti ? 64 : 70;
  const intestazioneRiepilogo = () => {
    const baseline = compattoTreProdotti ? 19 : 20;
    rect(nodes, 48, y, 698, headerRiepilogoHeight, { radius: 7, fill: COLORI.navy });
    testo(nodes, 64, y + baseline, "RIEPILOGO ECONOMICO", 8, {
      weight: 800,
      fill: COLORI.yellow,
      letterSpacing: 0.9,
    });
    testo(nodes, 350, y + baseline, "DATA / SCADENZA", 7.3, {
      align: "center",
      weight: 700,
      fill: COLORI.white,
    });
    testo(nodes, 562, y + baseline, "IBAN", 7.3, {
      align: "center",
      weight: 700,
      fill: COLORI.white,
    });
    testo(nodes, 695, y + baseline, "IMPORTO", 7.3, {
      align: "center",
      weight: 700,
      fill: COLORI.white,
    });
    y += headerRiepilogoHeight;
  };
  const righePagamentoHeight = pagamenti.length > 0 ? pagamenti.length * rataHeight : 35;
  assicuratiSpazio(headerRiepilogoHeight + righePagamentoHeight + riepilogoFooterHeight);
  intestazioneRiepilogo();
  if (pagamenti.length === 0) {
    rect(nodes, 48, y, 698, 35, { fill: COLORI.white, stroke: COLORI.line });
    testo(nodes, 64, y + 23, "Nessuna scadenza prevista.", 8.5, { fill: COLORI.muted });
    y += 35;
  } else {
    pagamenti.forEach((pagamento, index) => {
      const baseline = compattoTreProdotti ? 20 : 22;
      if (y + rataHeight + 1 > limiteContenuto) {
        nuovaPagina();
        intestazioneRiepilogo();
      }
      const rel = pagamento.scadRelGiorni ?? 0;
      const dataPagamento = pagamento.saldato
        ? pagamento.data
          ? `Incassato il ${dataIt(pagamento.data)}`
          : "Incassato"
        : pagamento.scadDaSpedizione && !pagamento.scadenza
          ? (rel > 0 ? `Consegna + ${rel} gg` : "All'affidamento al corriere")
          : pagamento.tipo === "acconto" && !pagamento.scadenza
            ? "Alla conferma dell'ordine"
          : pagamento.scadenza
            ? dataIt(pagamento.scadenza)
            : "Da definire";
      const iban = pagamento.contoIban?.trim()
        ? ibanVisuale(pagamento.contoIban)
        : "—";
      rect(nodes, 48, y, 698, rataHeight, {
        fill: index % 2 === 0 ? COLORI.white : COLORI.pale,
        stroke: COLORI.line,
        strokeWidth: 0.6,
      });
      line(nodes, 250, y, 250, y + rataHeight, COLORI.line, 0.45);
      line(nodes, 452, y, 452, y + rataHeight, COLORI.line, 0.45);
      line(nodes, 652, y, 652, y + rataHeight, COLORI.line, 0.45);
      testo(nodes, 64, y + baseline, etichettaPagamento(pagamento.tipo), 8.7, {
        weight: 700,
      });
      if (pagamento.saldato) {
        const saldatoY = y + (compattoTreProdotti ? 6 : 7.5);
        rect(nodes, 146, saldatoY, 62, 20, {
          radius: 10,
          fill: "#dff6ec",
        });
        testo(nodes, 177, saldatoY + 12.3, "SALDATO", 6.6, {
          align: "center",
          weight: 800,
          fill: COLORI.green,
        });
      }
      testo(nodes, 350, y + baseline, dataPagamento, 8.1, {
        align: "center",
        fill: COLORI.muted,
      });
      testo(nodes, 552, y + baseline, troncaTesto(iban, 178, 7.5), 7.5, {
        align: "center",
        fill: COLORI.muted,
      });
      testo(nodes, 695, y + baseline, euro(pagamento.importo), 8.8, {
        align: "center",
        weight: 800,
      });
      y += rataHeight;
    });
  }
  if (y + riepilogoFooterHeight > limiteContenuto) {
    nuovaPagina();
    intestazioneRiepilogo();
  }
  rect(nodes, 48, y, 698, riepilogoFooterHeight, {
    fill: COLORI.white,
    stroke: COLORI.line,
    strokeWidth: 0.75,
  });
  riepilogo.forEach(([label, value], index) => {
    const colWidth = riepilogoConSconto ? 132 : 118;
    const x = 66 + index * colWidth;
    if (index === totaleIndex) {
      rect(nodes, x - 10, y + 8, colWidth - 4, riepilogoFooterHeight - 16, {
        radius: 7,
        fill: COLORI.yellowSoft,
      });
    }
    if (index > 0) {
      line(nodes, x - 10, y + 12, x - 10, y + riepilogoFooterHeight - 12, COLORI.line, 0.55);
    }
    testo(nodes, x, y + (compattoTreProdotti ? 23 : 25), label.toLocaleUpperCase("it"), 6.8, {
      weight: 800,
      fill: index === totaleIndex ? COLORI.navy : COLORI.muted,
      letterSpacing: 0.35,
    });
    testo(nodes, x, y + (compattoTreProdotti ? 46 : 50), value, index === totaleIndex ? 11 : 9.2, {
      weight: index === totaleIndex ? 800 : 600,
      fill: COLORI.navy,
    });
  });
  if (!riepilogoConSconto) {
    rect(nodes, 430, y + 8, 296, riepilogoFooterHeight - 16, {
      radius: 9,
      fill: accontoIncassato ? "#e8f7f1" : COLORI.yellowSoft,
    });
    testo(nodes, 448, y + (compattoTreProdotti ? 23 : 25), "STATO DELLA PROPOSTA", 6.8, {
      weight: 800,
      fill: accontoIncassato ? COLORI.green : COLORI.muted,
      letterSpacing: 0.45,
    });
    testo(
      nodes,
      448,
      y + (compattoTreProdotti ? 45 : 49),
      accontoIncassato
        ? "Il suo ordine è confermato"
        : "In attesa della sua conferma dell'ordine",
      9.4,
      {
        weight: 800,
        fill: accontoIncassato ? COLORI.green : COLORI.ink,
      },
    );
  }
  y += riepilogoFooterHeight;
  y += compattoTreProdotti ? 4 : 8;

  assicuratiSpazio(compattoTreProdotti ? 90 : 96);
  line(nodes, 48, y, 746, y, COLORI.yellow, 2.4);
  rect(nodes, 48, y + 13, 31, 31, { radius: 16, fill: COLORI.yellow });
  rect(nodes, 61, y + 20, 5, 17, { radius: 1.5, fill: COLORI.navy });
  rect(nodes, 55, y + 26, 17, 5, { radius: 1.5, fill: COLORI.navy });
  testo(nodes, 93, y + 26, "INFORMAZIONI TECNICHE DEL FARMACO INDIVIDUALIZZATO PER ALLERGIA", 8.4, {
    weight: 800,
    fill: COLORI.ink,
    letterSpacing: 0.25,
  });

  const technicalOffset = compattoTreProdotti ? 46 : 50;
  rect(nodes, 115, y + technicalOffset, 29, 29, { radius: 15, fill: COLORI.yellowSoft });
  rect(nodes, 121, y + technicalOffset + 6, 17, 17, {
    radius: 9,
    fill: "none",
    stroke: COLORI.navy,
    strokeWidth: 1.5,
  });
  line(nodes, 129.5, y + technicalOffset + 14.5, 129.5, y + technicalOffset + 9.5, COLORI.navy, 1.4);
  line(nodes, 129.5, y + technicalOffset + 14.5, 134, y + technicalOffset + 17, COLORI.navy, 1.4);
  testo(nodes, 156, y + technicalOffset + 11, "PRODUZIONE DEL FARMACO", 7.2, {
    weight: 700,
    fill: COLORI.muted,
    letterSpacing: 0.35,
  });
  testo(nodes, 156, y + technicalOffset + 28, "30 GIORNI", 10, {
    weight: 800,
    fill: COLORI.ink,
  });

  line(nodes, 397, y + technicalOffset, 397, y + technicalOffset + 31, COLORI.line, 0.8);
  rect(nodes, 433, y + technicalOffset, 29, 29, { radius: 15, fill: COLORI.yellowSoft });
  rect(nodes, 439, y + technicalOffset + 8, 12, 9, {
    radius: 2,
    fill: "none",
    stroke: COLORI.navy,
    strokeWidth: 1.4,
  });
  polygon(
    nodes,
    [
      [451, y + technicalOffset + 11],
      [456, y + technicalOffset + 11],
      [460, y + technicalOffset + 16],
      [460, y + technicalOffset + 20],
      [451, y + technicalOffset + 20],
    ],
    { fill: "none", stroke: COLORI.navy, strokeWidth: 1.4 },
  );
  rect(nodes, 442, y + technicalOffset + 17, 5, 5, {
    radius: 3,
    fill: COLORI.white,
    stroke: COLORI.navy,
    strokeWidth: 1.3,
  });
  rect(nodes, 454, y + technicalOffset + 17, 5, 5, {
    radius: 3,
    fill: COLORI.white,
    stroke: COLORI.navy,
    strokeWidth: 1.3,
  });
  testo(nodes, 474, y + technicalOffset + 11, "LOGISTICA / SPEDIZIONE", 7.2, {
    weight: 700,
    fill: COLORI.muted,
    letterSpacing: 0.35,
  });
  testo(nodes, 474, y + technicalOffset + 28, "7 GIORNI", 10, {
    weight: 800,
    fill: COLORI.ink,
  });
  y += compattoTreProdotti ? 86 : 94;

  const pagamentoAcconto = pagamenti.find((pagamento) => pagamento.tipo === "acconto");
  const primoPagamentoBancario = pagamenti.find(
    (pagamento) => pagamento.contoTipo === "banca" && pagamento.contoIban?.trim(),
  );
  const ibanPagamento =
    pagamentoAcconto?.contoIban?.trim() ||
    primoPagamentoBancario?.contoIban?.trim() ||
    IBAN_AZIENDA;
  const saldoLines = avvolgiTesto(
    "Da effettuare tramite bonifico nel momento in cui l'ordine viene affidato al corriere.",
    566,
    8,
    600,
  );
  const confermaLines = avvolgiTesto(
    "Restiamo in attesa della copia del pagamento come forma di conferma del preventivo.",
    648,
    7.7,
    600,
  );
  const accordi = preventivo.condizioniPagamento.trim();
  const accordiLines = accordi
    ? avvolgiTesto(accordi, 555, 7.6, 400)
    : [];
  const condizioniHeight =
    145 +
    Math.max(0, saldoLines.length - 1) * 9 +
    Math.max(0, confermaLines.length - 1) * 9 +
    (accordiLines.length ? 24 + accordiLines.length * 9 : 0);
  assicuratiSpazio(condizioniHeight);
  rect(nodes, 48, y, 698, condizioniHeight, {
    radius: 9,
    fill: COLORI.white,
    stroke: COLORI.navy,
    strokeWidth: 1,
  });
  rect(nodes, 48, y, 698, 34, { radius: 9, fill: COLORI.yellow });
  testo(nodes, 66, y + 23, "CONDIZIONI DI PAGAMENTO", 9, {
    weight: 800,
    fill: COLORI.navy,
    letterSpacing: 0.9,
  });
  testo(nodes, 66, y + 53, "ACCONTO ALLA CONFERMA", 7.1, {
    weight: 800,
    fill: COLORI.muted,
    letterSpacing: 0.45,
  });
  testo(
    nodes,
    66,
    y + 75,
    preventivo.acconto > 0
      ? euro(preventivo.acconto)
      : "Nessun acconto richiesto",
    preventivo.acconto > 0 ? 14 : 10,
    { weight: 800, fill: COLORI.ink },
  );
  line(nodes, 238, y + 47, 238, y + 91, COLORI.line, 0.8);
  testo(nodes, 258, y + 53, "COORDINATE PER IL BONIFICO", 7.1, {
    weight: 800,
    fill: COLORI.muted,
    letterSpacing: 0.45,
  });
  testo(nodes, 258, y + 69, "PHARMATEK", 7.8, {
    weight: 700,
    fill: COLORI.ink,
  });
  testo(nodes, 258, y + 83, `IBAN ${ibanVisuale(ibanPagamento)}`, 8.3, {
    weight: 800,
    fill: COLORI.ink,
  });
  testo(
    nodes,
    258,
    y + 96,
    `Copia del pagamento: ${config.email.toLocaleUpperCase("it")} · WhatsApp `,
    7.4,
    { fill: COLORI.muted },
  );
  line(nodes, 66, y + 102, 728, y + 102, COLORI.line, 0.8);
  testo(nodes, 66, y + 118, "SALDO", 7.1, {
    weight: 800,
    fill: COLORI.muted,
    letterSpacing: 0.45,
  });
  saldoLines.forEach((valore, index) =>
    testo(nodes, 123, y + 118 + index * 9, valore, 8, {
      weight: 600,
      fill: COLORI.ink,
    }),
  );
  const confermaY = y + 136 + Math.max(0, saldoLines.length - 1) * 9;
  confermaLines.forEach((valore, index) =>
    testo(nodes, 66, confermaY + index * 9, valore, 7.7, {
      weight: 600,
      fill: COLORI.ink,
    }),
  );
  if (accordiLines.length) {
    const accordiY =
      y +
      145 +
      Math.max(0, saldoLines.length - 1) * 9 +
      Math.max(0, confermaLines.length - 1) * 9;
    const accordiHeight = 21 + accordiLines.length * 9;
    const accordiCenterY = accordiY + accordiHeight / 2;
    const accordiFirstBaseline =
      accordiCenterY - ((accordiLines.length - 1) * 9) / 2 + 2.5;
    rect(nodes, 66, accordiY, 662, accordiHeight, {
      radius: 7,
      fill: COLORI.pale,
    });
    testo(nodes, 80, accordiCenterY + 2.4, "ACCORDI AGGIUNTIVI", 6.9, {
      weight: 800,
      fill: COLORI.muted,
      letterSpacing: 0.35,
    });
    accordiLines.forEach((valore, index) =>
      testo(nodes, 173, accordiFirstBaseline + index * 9, valore, 7.6, {
        fill: COLORI.ink,
      }),
    );
  }
  y += condizioniHeight + 4;

  if (preventivo.note.trim()) {
    const noteLines = avvolgiTesto(preventivo.note, 662, 8.3);
    const noteHeight = Math.max(36, 20 + noteLines.length * 10);
    assicuratiSpazio(noteHeight);
    rect(nodes, 48, y, 698, noteHeight, {
      radius: 8,
      fill: COLORI.yellowSoft,
      stroke: COLORI.yellow,
    });
    rect(nodes, 48, y, 86, noteHeight, {
      radius: 8,
      fill: COLORI.yellow,
    });
    testo(nodes, 91, y + noteHeight / 2 + 2.6, "NOTE", 7.6, {
      align: "center",
      weight: 800,
      fill: COLORI.navy,
      letterSpacing: 0.7,
    });
    noteLines.forEach((valore, index) =>
      testo(
        nodes,
        151,
        y + (noteHeight - noteLines.length * 10) / 2 + 8 + index * 10,
        valore,
        8.3,
        { fill: COLORI.ink },
      ),
    );
    y += noteHeight;
  }

  const numeroPagine = pagine.length;
  pagine.forEach((pagina, index) => {
    line(pagina, 48, 1074, 746, 1074, COLORI.navy, 0.8);
    testo(
      pagina,
      48,
      1096,
      troncaTesto(
        `${config.denominazione} · ${config.indirizzo}, ${config.localita}`,
        370,
        7.8,
        600,
      ),
      7.8,
      { fill: COLORI.muted, weight: 600 },
    );
    testo(
      pagina,
      746,
      1096,
      `Fisso ${TELEFONO_AZIENDA} · WhatsApp ${WHATSAPP_AZIENDA} · Pagina ${index + 1} di ${numeroPagine}`,
      7.8,
      { fill: COLORI.muted, align: "right" },
    );
  });
  return {
    titolo: `Preventivo ${preventivo.numeroPreventivo}`,
    nomeFile: `Preventivo ${preventivo.numeroPreventivo || preventivo.ordineNumero}.pdf`,
    nodes: pagine[0],
    pagine: pagine.slice(1),
    overflow,
  };
}

function testataSchedaCartacea(
  nodes: DocumentoNode[],
  ordineNumero: string,
  config: ConfigurazioneDocumento,
) {
  nodes.push({
    kind: "polygon",
    points: [
      [338, 16],
      [746, 16],
      [746, 208],
      [614, 166],
    ],
    fill: SCHEDA_GIALLO,
  });
  logoPharmaTek(nodes, 48, 54, 268, 58);
  testoScheda(nodes, 724, 54, config.indirizzo, 11, {
    align: "right",
    weight: 700,
  });
  testoScheda(nodes, 724, 72, config.localita, 11, { align: "right" });
  testoScheda(nodes, 724, 90, `Tel.: ${config.telefono}`, 11, { align: "right" });
  testoScheda(nodes, 724, 108, config.email, 11, { align: "right" });
  testoScheda(nodes, 724, 126, config.sito, 11, {
    align: "right",
    weight: 700,
  });
  testoScheda(nodes, 724, 158, `SCHEDA CLIENTE · ORDINE ${ordineNumero}`, 10.5, {
    align: "right",
    weight: 800,
    letterSpacing: 0.45,
  });
}

function campoCartaceo(
  nodes: DocumentoNode[],
  overflow: string[],
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  labelWidth: number,
  righe = 1,
) {
  testoScheda(nodes, x, y, label.toLocaleUpperCase("it"), 12.5, {
    weight: 800,
  });
  for (let index = 0; index < righe; index += 1) {
    line(nodes, x, y + 14 + index * 28, x + width, y + 14 + index * 28, SCHEDA_NERO, 1);
  }
  if (!value.trim()) return;
  const testoValore = testoMultilinea(
    nodes,
    x + labelWidth,
    y,
    value,
    width - labelWidth - 4,
    13,
    righe,
    { weight: 600, fontFamily: "arial", fill: SCHEDA_NERO },
  );
  if (testoValore.overflow) {
    overflow.push(
      `${label} il contenuto supera ${righe === 1 ? "la riga disponibile" : "le righe disponibili"}.`,
    );
  }
}

function casella(nodes: DocumentoNode[], x: number, y: number, checked: boolean) {
  rect(nodes, x, y, 18, 18, {
    fill: checked ? SCHEDA_NERO : COLORI.white,
    stroke: SCHEDA_NERO,
    strokeWidth: 1.1,
  });
  if (!checked) return;
  line(nodes, x + 4, y + 10, x + 8, y + 14, COLORI.white, 1.8);
  line(nodes, x + 8, y + 14, x + 15, y + 5, COLORI.white, 1.8);
}

function tabellaValori(
  nodes: DocumentoNode[],
  x: number,
  y: number,
  width: number,
  rows: Array<[string, string]>,
) {
  const rowHeight = 40;
  const labelWidth = Math.round(width * 0.58);
  rect(nodes, x, y, width, rowHeight * rows.length, {
    fill: COLORI.white,
    stroke: SCHEDA_NERO,
    strokeWidth: 1.1,
  });
  line(
    nodes,
    x + labelWidth,
    y,
    x + labelWidth,
    y + rowHeight * rows.length,
    SCHEDA_NERO,
    1.1,
  );
  rows.forEach(([label, value], index) => {
    const top = y + index * rowHeight;
    if (index > 0) line(nodes, x, top, x + width, top, SCHEDA_NERO, 1.1);
    const labelSize = 11.3;
    const labelLines = Math.min(
      2,
      avvolgiTesto(label.toLocaleUpperCase("it"), labelWidth - 24, labelSize, 800).length,
    );
    const labelY =
      top +
      (rowHeight - (labelLines - 1) * labelSize * 1.28) / 2 +
      labelSize * 0.35;
    testoMultilinea(
      nodes,
      x + 14,
      labelY,
      label.toLocaleUpperCase("it"),
      labelWidth - 24,
      labelSize,
      2,
      { weight: 800, fontFamily: "arial", fill: SCHEDA_NERO },
    );
    if (value) {
      testoScheda(nodes, x + labelWidth + 12, top + 26, value, 13, {
        weight: 600,
      });
    }
  });
}

function tabellaCaselle(
  nodes: DocumentoNode[],
  x: number,
  y: number,
  width: number,
  rows: Array<[string, boolean]>,
  header?: string,
) {
  const headerHeight = header ? 28 : 0;
  const rowHeight = 34;
  const height = headerHeight + rowHeight * rows.length;
  const checkColumn = 52;
  rect(nodes, x, y, width, height, {
    fill: COLORI.white,
    stroke: SCHEDA_NERO,
    strokeWidth: 1.1,
  });
  if (header) {
    rect(nodes, x, y, width, headerHeight, {
      fill: SCHEDA_GIALLO,
      stroke: SCHEDA_NERO,
      strokeWidth: 1.1,
    });
    testoScheda(nodes, x + 14, y + 20, header.toLocaleUpperCase("it"), 12, {
      weight: 800,
    });
  }
  const bodyTop = y + headerHeight;
  line(
    nodes,
    x + width - checkColumn,
    bodyTop,
    x + width - checkColumn,
    y + height,
    SCHEDA_NERO,
    1.1,
  );
  rows.forEach(([label, checked], index) => {
    const top = bodyTop + index * rowHeight;
    if (index > 0) line(nodes, x, top, x + width, top, SCHEDA_NERO, 1.1);
    testoScheda(nodes, x + 14, top + 23, label.toLocaleUpperCase("it"), 11.5, {
      weight: 700,
    });
    casella(nodes, x + width - 35, top + 8, checked);
  });
}

export function creaDocumentoSchedaCliente(
  ordineNumero: string,
  campi: SchedaClienteCampi,
  config = CONFIGURAZIONE_DOCUMENTO_DEFAULT,
  opzioni: {
    nascondiValoriEditabili?: boolean;
    medicoNome?: string;
    agenteNome?: string;
  } = {},
): DocumentoA4 {
  const nodes: DocumentoNode[] = [];
  const overflow: string[] = [];
  const valore = (testo: string) =>
    opzioni.nascondiValoriEditabili ? "" : testo;
  testataSchedaCartacea(nodes, ordineNumero, config);

  campoCartaceo(
    nodes,
    overflow,
    48,
    186,
    650,
    "Data ricezione:",
    valore(campi.dataRicezione ? dataIt(campi.dataRicezione) : ""),
    150,
  );
  campoCartaceo(nodes, overflow, 48, 226, 650, "Nome paziente:", valore(campi.pazienti), 150);
  campoCartaceo(
    nodes,
    overflow,
    48,
    300,
    698,
    "Info spedizione:",
    valore(campi.infoSpedizione),
    150,
    2,
  );
  campoCartaceo(nodes, overflow, 48, 390, 698, "Contatti:", valore(campi.contatti), 88);

  testoScheda(nodes, 48, 466, "INFO INTESTATARIO FATTURA", 13, {
    weight: 800,
    letterSpacing: 0.5,
  });
  campoCartaceo(
    nodes,
    overflow,
    48,
    505,
    698,
    "Nome e cognome:",
    valore(campi.intestatarioNome),
    170,
  );
  campoCartaceo(
    nodes,
    overflow,
    48,
    545,
    698,
    "Codice fiscale:",
    valore(campi.intestatarioCodiceFiscale),
    226,
  );
  campoCartaceo(
    nodes,
    overflow,
    48,
    585,
    698,
    "Indirizzo di residenza:",
    valore(campi.intestatarioIndirizzo),
    220,
  );

  tabellaValori(nodes, 48, 640, 365, [
    ["Importo totale", valore(campi.importoTotale > 0 ? euro(campi.importoTotale) : "")],
    ["Importo acconto", campi.importoAcconto > 0 ? euro(campi.importoAcconto) : ""],
    [
      "Data contabile / valuta",
      campi.dataContabileValuta ? dataIt(campi.dataContabileValuta) : "",
    ],
  ]);
  tabellaCaselle(
    nodes,
    449,
    640,
    297,
    [
      ["Bonifico", campi.modalitaSaldo === "bonifico"],
      ["Contrassegno", campi.modalitaSaldo === "contrassegno"],
      ["Assegno", campi.modalitaSaldo === "assegno"],
    ],
    "Saldo",
  );

  testoScheda(nodes, 48, 804, "NOTE:", 14, {
    weight: 800,
  });
  [822, 852, 882].forEach((y) => line(nodes, 48, y, 746, y, SCHEDA_NERO, 0.9));
  const noteComplete = [
    campi.note.trim(),
    opzioni.medicoNome?.trim() ? `Medico: ${opzioni.medicoNome.trim()}` : "",
    opzioni.agenteNome?.trim() ? `Agente: ${opzioni.agenteNome.trim()}` : "",
  ].filter(Boolean).join(" · ");
  if (noteComplete && !opzioni.nascondiValoriEditabili) {
    const note = testoMultilinea(nodes, 52, 817, noteComplete, 690, 12.8, 3, {
      weight: 600,
      fontFamily: "arial",
      fill: SCHEDA_NERO,
    });
    if (note.overflow) overflow.push("Le note superano tre righe.");
  }

  tabellaCaselle(nodes, 48, 920, 360, [
    ["Prev. su WhatsApp", campi.preventivoWhatsapp],
    ["Prev. su email", campi.preventivoEmail],
  ]);
  tabellaCaselle(nodes, 440, 920, 306, [
    ["Mantenimento", campi.mantenimento],
    ["NPP", campi.npp],
    ["Paziente nuovo", campi.pazienteNuovo],
  ]);

  line(nodes, 48, 1064, 746, 1064, SCHEDA_NERO, 1);
  testoScheda(nodes, 48, 1086, `Ordine ${ordineNumero}`, 10, {
    weight: 700,
    fill: "#555555",
  });
  testoScheda(
    nodes,
    397,
    1086,
    `${config.denominazione} · ${config.indirizzo}, ${config.localita}`,
    10,
    { align: "center", fill: "#555555", weight: 600 },
  );
  testoScheda(nodes, 746, 1086, `${config.telefono} · ${config.email}`, 10, {
    align: "right",
    fill: "#555555",
  });
  return {
    titolo: `Scheda cliente ordine ${ordineNumero}`,
    nomeFile: `scheda-cliente-${ordineNumero}.pdf`,
    nodes,
    overflow,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function pagineDocumento(documento: DocumentoA4): DocumentoNode[][] {
  return [documento.nodes, ...(documento.pagine ?? [])];
}

export function documentoSvg(documento: DocumentoA4, pagina = 0): string {
  const nodes = pagineDocumento(documento)[pagina] ?? documento.nodes;
  const body = nodes
    .map((node) => {
      const fill = node.fill ?? "none";
      const stroke = node.stroke ?? "none";
      const strokeWidth = node.strokeWidth ?? 0;
      if (node.kind === "logo") {
        return `<svg x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" viewBox="0 ${PHARMATEK_LOGO_CROP_Y} ${PHARMATEK_LOGO_SOURCE_WIDTH} ${PHARMATEK_LOGO_CROP_HEIGHT}" preserveAspectRatio="none" overflow="hidden"><image x="0" y="0" width="${PHARMATEK_LOGO_SOURCE_WIDTH}" height="${PHARMATEK_LOGO_SOURCE_HEIGHT}" href="data:image/png;base64,${PHARMATEK_LOGO_PNG_BASE64}"/></svg>`;
      }
      if (node.kind === "rect") {
        return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.radius ?? 0}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
      }
      if (node.kind === "line") {
        return `<line x1="${node.x1}" y1="${node.y1}" x2="${node.x2}" y2="${node.y2}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
      }
      if (node.kind === "polygon") {
        return `<polygon points="${node.points.map(([x, y]) => `${x},${y}`).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
      }
      const anchor = node.align === "center" ? "middle" : node.align === "right" ? "end" : "start";
      const fontFamily =
        node.fontFamily === "arial"
          ? "Arial,Helvetica,sans-serif"
          : "Inter,Segoe UI,Arial,sans-serif";
      return `<text x="${node.x}" y="${node.y}" fill="${fill}" font-family="${fontFamily}" font-size="${node.size}" font-weight="${node.weight ?? 400}" text-anchor="${anchor}"${node.letterSpacing ? ` letter-spacing="${node.letterSpacing}"` : ""}>${escapeXml(node.text)}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${A4_WIDTH} ${A4_HEIGHT}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
}

const CP1252: Record<string, number> = {
  "€": 0x80,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "…": 0x85,
};

function pdfString(value: string): string {
  let result = "";
  for (const carattere of value) {
    const code = CP1252[carattere] ?? carattere.charCodeAt(0);
    if (code === 40 || code === 41 || code === 92) {
      result += `\\${String.fromCharCode(code)}`;
    } else if (code < 32 || code > 126) {
      const byte = code <= 255 ? code : 63;
      result += `\\${byte.toString(8).padStart(3, "0")}`;
    } else {
      result += carattere;
    }
  }
  return result;
}

function rgb(hex: string | undefined): [number, number, number] {
  const value = (hex ?? "#000000").replace("#", "");
  const normalized =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value.padEnd(6, "0").slice(0, 6);
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

function fmt(value: number): string {
  return Number(value.toFixed(3)).toString();
}

let logoRgbHexCache = "";

function logoRgbHex(): string {
  if (logoRgbHexCache) return logoRgbHexCache;
  const binary = atob(PHARMATEK_LOGO_RGB_RLE_BASE64);
  const hex: string[] = [];
  for (let index = 0; index + 4 < binary.length; index += 5) {
    const count = (binary.charCodeAt(index) << 8) | binary.charCodeAt(index + 1);
    const pixel = [2, 3, 4]
      .map((offset) => binary.charCodeAt(index + offset).toString(16).padStart(2, "0"))
      .join("");
    hex.push(pixel.repeat(count));
  }
  logoRgbHexCache = hex.join("");
  return logoRgbHexCache;
}

/** Generatore PDF vettoriale minimale: usa lo stesso albero di primitive SVG,
 * senza librerie o font binari aggiuntivi. */
export function documentoPdfBytes(documento: DocumentoA4): Uint8Array {
  const pageW = 595.276;
  const pageH = 841.89;
  const sx = pageW / A4_WIDTH;
  const sy = pageH / A4_HEIGHT;
  const px = (value: number) => value * sx;
  const py = (value: number) => pageH - value * sy;
  const operatoreForma = (hasFill: boolean, hasStroke: boolean) =>
    hasFill && hasStroke ? "B" : hasFill ? "f" : "S";
  const rettangoloArrotondato = (node: RectNode) => {
    const x0 = px(node.x);
    const y0 = py(node.y + node.height);
    const x1 = px(node.x + node.width);
    const y1 = py(node.y);
    const radius = Math.max(
      0,
      Math.min(
        node.radius ?? 0,
        node.width / 2,
        node.height / 2,
      ),
    );
    const rx = px(radius);
    const ry = radius * sy;
    const k = 0.55228475;
    return [
      `${fmt(x0 + rx)} ${fmt(y0)} m`,
      `${fmt(x1 - rx)} ${fmt(y0)} l`,
      `${fmt(x1 - rx + rx * k)} ${fmt(y0)} ${fmt(x1)} ${fmt(y0 + ry - ry * k)} ${fmt(x1)} ${fmt(y0 + ry)} c`,
      `${fmt(x1)} ${fmt(y1 - ry)} l`,
      `${fmt(x1)} ${fmt(y1 - ry + ry * k)} ${fmt(x1 - rx + rx * k)} ${fmt(y1)} ${fmt(x1 - rx)} ${fmt(y1)} c`,
      `${fmt(x0 + rx)} ${fmt(y1)} l`,
      `${fmt(x0 + rx - rx * k)} ${fmt(y1)} ${fmt(x0)} ${fmt(y1 - ry + ry * k)} ${fmt(x0)} ${fmt(y1 - ry)} c`,
      `${fmt(x0)} ${fmt(y0 + ry)} l`,
      `${fmt(x0)} ${fmt(y0 + ry - ry * k)} ${fmt(x0 + rx - rx * k)} ${fmt(y0)} ${fmt(x0 + rx)} ${fmt(y0)} c`,
      "h",
    ];
  };
  const streamPagina = (nodes: DocumentoNode[]) => {
    const commands: string[] = [
      "q",
      "1 J",
      "1 j",
      "1 1 1 rg",
      `0 0 ${fmt(pageW)} ${fmt(pageH)} re f`,
    ];
    for (const node of nodes) {
      if (node.kind === "logo") {
        commands.push(
          "q",
          `${fmt(px(node.width))} 0 0 ${fmt(node.height * sy)} ${fmt(px(node.x))} ${fmt(py(node.y + node.height))} cm`,
          `BI /W ${PHARMATEK_LOGO_SOURCE_WIDTH} /H ${PHARMATEK_LOGO_CROP_HEIGHT} /CS /RGB /BPC 8 /F /AHx ID`,
          `${logoRgbHex()}>`,
          "EI",
          "Q",
        );
        continue;
      }
      const [fr, fg, fb] = rgb(node.fill);
      const [sr, sg, sb] = rgb(node.stroke);
      if (node.kind === "text") {
        const font = (node.weight ?? 400) >= 600 ? "F2" : "F1";
        const glyphWidth = larghezzaTestoPdf(node.text, node.size, node.weight) * sy;
        const letterSpacingWidth =
          Math.max(0, node.text.length - 1) * (node.letterSpacing ?? 0) * sx;
        const approximateWidth = glyphWidth + letterSpacingWidth;
        const x =
          node.align === "right"
            ? px(node.x) - approximateWidth
            : node.align === "center"
              ? px(node.x) - approximateWidth / 2
              : px(node.x);
        commands.push(
          `${fmt(fr)} ${fmt(fg)} ${fmt(fb)} rg`,
          "BT",
          `/${font} ${fmt(node.size * sy)} Tf`,
          node.letterSpacing ? `${fmt(node.letterSpacing * sx)} Tc` : "0 Tc",
          `1 0 0 1 ${fmt(x)} ${fmt(py(node.y))} Tm`,
          `(${pdfString(node.text)}) Tj`,
          "ET",
        );
        continue;
      }
      const hasFill = !!node.fill && node.fill !== "none";
      const hasStroke = !!node.stroke && node.stroke !== "none" && (node.strokeWidth ?? 0) > 0;
      if (hasFill) commands.push(`${fmt(fr)} ${fmt(fg)} ${fmt(fb)} rg`);
      if (hasStroke) {
        commands.push(
          `${fmt(sr)} ${fmt(sg)} ${fmt(sb)} RG`,
          `${fmt((node.strokeWidth ?? 1) * sx)} w`,
        );
      }
      if (node.kind === "rect") {
        if ((node.radius ?? 0) > 0) {
          commands.push(
            ...rettangoloArrotondato(node),
            operatoreForma(hasFill, hasStroke),
          );
        } else {
          commands.push(
            `${fmt(px(node.x))} ${fmt(py(node.y + node.height))} ${fmt(px(node.width))} ${fmt(node.height * sy)} re ${operatoreForma(hasFill, hasStroke)}`,
          );
        }
      } else if (node.kind === "line") {
        commands.push(
          `${fmt(px(node.x1))} ${fmt(py(node.y1))} m ${fmt(px(node.x2))} ${fmt(py(node.y2))} l S`,
        );
      } else {
        const [primo, ...altri] = node.points;
        commands.push(`${fmt(px(primo[0]))} ${fmt(py(primo[1]))} m`);
        for (const [x, y] of altri) commands.push(`${fmt(px(x))} ${fmt(py(y))} l`);
        commands.push(`h ${operatoreForma(hasFill, hasStroke)}`);
      }
    }
    commands.push("Q");
    return commands.join("\n");
  };
  const streams = pagineDocumento(documento).map(streamPagina);
  const kids = streams.map((_, index) => `${5 + index * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${streams.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  streams.forEach((stream, index) => {
    const pageId = 5 + index * 2;
    const streamId = pageId + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageW)} ${fmt(pageH)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  let pdf = "%PDF-1.4\n%PharmaTek\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${offsets[index].toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export async function documentoPngBlob(
  documento: DocumentoA4,
  scale = 2.5,
): Promise<Blob> {
  const pagine = pagineDocumento(documento);
  const gap = pagine.length > 1 ? 24 : 0;
  const urls = pagine.map((_, index) =>
    URL.createObjectURL(
      new Blob([documentoSvg(documento, index)], { type: "image/svg+xml;charset=utf-8" }),
    ),
  );
  try {
    const images = await Promise.all(
      urls.map(async (url) => {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        await image.decode();
        return image;
      }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(A4_WIDTH * scale);
    canvas.height = Math.round((A4_HEIGHT * pagine.length + gap * (pagine.length - 1)) * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas non disponibile.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach((image, index) => {
      context.drawImage(
        image,
        0,
        Math.round(index * (A4_HEIGHT + gap) * scale),
        canvas.width,
        Math.round(A4_HEIGHT * scale),
      );
    });
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Generazione PNG non riuscita."))),
        "image/png",
        0.96,
      );
    });
  } finally {
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}

export function documentoPdfBlob(documento: DocumentoA4): Blob {
  const bytes = documentoPdfBytes(documento);
  return new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" });
}

export function scaricaBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/** Salva sempre passando dal selettore di percorso. Il fallback browser usa il
 * file picker nativo quando disponibile e non cambia il comportamento desktop. */
export async function salvaBlobConPercorso(
  blob: Blob,
  nome: string,
  opzioni: { richiedePremium?: boolean } = {},
): Promise<boolean> {
  const estensione = nome.split(".").pop()?.toLowerCase() || "";
  const mime = blob.type || (estensione === "png" ? "image/png" : "application/pdf");
  if (inTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: nome,
      filters: [{ name: estensione === "png" ? "Immagine PNG" : "Documento PDF", extensions: [estensione] }],
    });
    if (!path) return false;
    const datiBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("Lettura documento non riuscita."));
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
      reader.readAsDataURL(blob);
    });
    if (opzioni.richiedePremium) {
      await api.documentoPreventivoSalva(path, datiBase64);
    } else {
      await api.documentoSalva(path, datiBase64);
    }
    return true;
  }
  const picker = (
    window as typeof window & {
      showSaveFilePicker?: (options: unknown) => Promise<{
        createWritable: () => Promise<{ write: (value: Blob) => Promise<void>; close: () => Promise<void> }>;
      }>;
    }
  ).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: nome,
        types: [{ description: estensione === "png" ? "Immagine PNG" : "Documento PDF", accept: { [mime]: [`.${estensione}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      throw error;
    }
  }
  scaricaBlob(blob, nome);
  return true;
}

let ultimaPuliziaStampa: (() => void) | null = null;

export function stampaDocumento(
  documento: DocumentoA4,
  onRilasciato?: () => void,
): () => void {
  if (documento.overflow.length > 0) {
    throw new Error("Riduci i contenuti indicati prima di stampare.");
  }
  if (typeof window === "undefined" || !window.document) {
    return () => {};
  }

  // Se c'era una sessione di stampa precedente ancora in corso/attesa, rilasciala prima di avviare la nuova
  if (ultimaPuliziaStampa) {
    try {
      ultimaPuliziaStampa();
    } catch {
      // Ignora errori di pulizia precedente
    }
  }

  const blob = documentoPdfBlob(documento);
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.src = url;
  let rilasciato = false;
  let timeoutChiusura: number | null = null;
  let rimuoviAscoltatori = () => {};

  const rilascia = () => {
    if (rilasciato) return;
    rilasciato = true;
    if (timeoutChiusura !== null) {
      window.clearTimeout(timeoutChiusura);
      timeoutChiusura = null;
    }
    if (ultimaPuliziaStampa === rilascia) {
      ultimaPuliziaStampa = null;
    }
    rimuoviAscoltatori();
    iframe.remove();
    URL.revokeObjectURL(url);
    onRilasciato?.();
  };

  ultimaPuliziaStampa = rilascia;
  document.body.appendChild(iframe);

  iframe.addEventListener("error", rilascia, { once: true });
  iframe.addEventListener(
    "load",
    () => {
      const finestraStampa = iframe.contentWindow;
      const onAfterPrint = () => {
        // Breve delay per consentire allo spooler/driver di completare l'invio
        timeoutChiusura = window.setTimeout(rilascia, 1000);
      };

      finestraStampa?.addEventListener("afterprint", onAfterPrint, { once: true });
      window.addEventListener("afterprint", onAfterPrint, { once: true });
      rimuoviAscoltatori = () => {
        finestraStampa?.removeEventListener("afterprint", onAfterPrint);
        window.removeEventListener("afterprint", onAfterPrint);
      };

      finestraStampa?.focus();
      finestraStampa?.print();
    },
    { once: true },
  );
  return rilascia;
}
