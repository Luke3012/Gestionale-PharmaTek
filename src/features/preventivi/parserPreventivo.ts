interface ProdottoParserPreventivo {
  id: string;
  nome: string;
  categoria?: string;
  alias?: string[];
  prezzoSuggerito?: number | null;
  usiCliente?: number;
  usiMedico?: number;
}

export interface ContestoParserPreventivo {
  prodotti: ProdottoParserPreventivo[];
  lineeOrdine?: string[];
  dettagliProduzione?: {
    formulazioni?: string[];
    posologie?: string[];
    allergeni?: string[];
  };
}

type LivelloConfidenza = "alta" | "media" | "bassa";

interface AlternativaProdottoPreventivo {
  id: string;
  nome: string;
  categoria: string;
  punteggio: number;
  motivazione: string;
}

export interface RigaInterpretataPreventivo {
  segmento: string;
  prodottoId: string;
  prodottoNome: string;
  qta: number;
  prezzo: number | null;
  prezzoEsplicito: boolean;
  paziente: string;
  formulazione: string;
  posologia: string;
  allergeni: string[];
  testoLibero: string;
  confidenza: number;
  livello: LivelloConfidenza;
  motivazioni: string[];
  alternative: AlternativaProdottoPreventivo[];
  richiedeRevisione: boolean;
}

export interface RisultatoParserPreventivo {
  righe: RigaInterpretataPreventivo[];
  note: string;
  ambigue: number;
}

interface Candidato {
  prodotto: ProdottoParserPreventivo;
  punteggio: number;
  motivazione: string;
}

const PAROLE_NUMERO: Record<string, number> = {
  uno: 1,
  una: 1,
  un: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
  undici: 11,
  dodici: 12,
  tredici: 13,
  quattordici: 14,
  quindici: 15,
  sedici: 16,
  diciassette: 17,
  diciotto: 18,
  diciannove: 19,
  venti: 20,
  trenta: 30,
  quaranta: 40,
  cinquanta: 50,
  sessanta: 60,
  settanta: 70,
  ottanta: 80,
  novanta: 90,
};

const STOP_WORDS = new Set([
  "a",
  "al",
  "alla",
  "con",
  "da",
  "del",
  "della",
  "di",
  "e",
  "euro",
  "il",
  "in",
  "la",
  "le",
  "lo",
  "per",
  "prezzo",
  "pz",
  "qta",
  "quantita",
  "su",
  "x",
]);

export function normalizzaTestoPreventivo(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’`´]/g, "'")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9€+.,:'/%\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizza(value: string): string[] {
  return normalizzaTestoPreventivo(value)
    .split(/[\s,.;:/()[\]{}\-]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function trigrammi(value: string): Set<string> {
  const testo = `  ${normalizzaTestoPreventivo(value)}  `;
  const result = new Set<string>();
  for (let index = 0; index <= testo.length - 3; index += 1) {
    result.add(testo.slice(index, index + 3));
  }
  return result;
}

function similaritaTrigrammi(a: string, b: string): number {
  const sinistra = trigrammi(a);
  const destra = trigrammi(b);
  if (sinistra.size === 0 && destra.size === 0) return 1;
  let comuni = 0;
  for (const elemento of sinistra) {
    if (destra.has(elemento)) comuni += 1;
  }
  return (2 * comuni) / (sinistra.size + destra.size);
}

/** Distanza Damerau-Levenshtein "optimal string alignment", sufficiente per
 * refusi locali e trasposizioni senza introdurre euristiche non spiegabili. */
export function distanzaDamerauLevenshtein(a: string, b: string): number {
  const sinistra = normalizzaTestoPreventivo(a);
  const destra = normalizzaTestoPreventivo(b);
  const righe = sinistra.length + 1;
  const colonne = destra.length + 1;
  const matrice = Array.from({ length: righe }, () => Array<number>(colonne).fill(0));
  for (let i = 0; i < righe; i += 1) matrice[i][0] = i;
  for (let j = 0; j < colonne; j += 1) matrice[0][j] = j;
  for (let i = 1; i < righe; i += 1) {
    for (let j = 1; j < colonne; j += 1) {
      const costo = sinistra[i - 1] === destra[j - 1] ? 0 : 1;
      matrice[i][j] = Math.min(
        matrice[i - 1][j] + 1,
        matrice[i][j - 1] + 1,
        matrice[i - 1][j - 1] + costo,
      );
      if (
        i > 1 &&
        j > 1 &&
        sinistra[i - 1] === destra[j - 2] &&
        sinistra[i - 2] === destra[j - 1]
      ) {
        matrice[i][j] = Math.min(matrice[i][j], matrice[i - 2][j - 2] + costo);
      }
    }
  }
  return matrice[sinistra.length][destra.length];
}

function numeroItaliano(token: string): number | null {
  const normalizzato = normalizzaTestoPreventivo(token);
  if (/^\d+$/.test(normalizzato)) return Number(normalizzato);
  if (PAROLE_NUMERO[normalizzato] !== undefined) return PAROLE_NUMERO[normalizzato];
  for (const [decina, valore] of Object.entries(PAROLE_NUMERO).filter(([, n]) => n >= 20)) {
    if (!normalizzato.startsWith(decina)) continue;
    const resto = normalizzato.slice(decina.length);
    if (!resto) return valore;
    const unita = PAROLE_NUMERO[resto];
    if (unita && unita < 10) return valore + unita;
  }
  return null;
}

export function interpretaImportoItaliano(value: string): number | null {
  const pulito = value
    .trim()
    .replace(/[€\s]/g, "")
    .replace(/[^\d.,-]/g, "");
  if (!pulito || pulito === "-") return null;
  let normalizzato = pulito;
  const ultimaVirgola = pulito.lastIndexOf(",");
  const ultimoPunto = pulito.lastIndexOf(".");
  const separatoreDecimale = Math.max(ultimaVirgola, ultimoPunto);
  if (separatoreDecimale >= 0) {
    const decimali = pulito.length - separatoreDecimale - 1;
    if (decimali === 1 || decimali === 2) {
      normalizzato =
        pulito.slice(0, separatoreDecimale).replace(/[.,]/g, "") +
        "." +
        pulito.slice(separatoreDecimale + 1);
    } else {
      normalizzato = pulito.replace(/[.,]/g, "");
    }
  }
  const numero = Number(normalizzato);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return Math.round(numero * 100);
}

function estraiQuantita(segmento: string): { qta: number; residuo: string } {
  const inizio = segmento.match(
    /^\s*(?:q(?:uan)?t(?:ita)?\.?\s*)?(\d+|[A-Za-zÀ-ÿ]+)\s*(?:x|pz\.?|pezzi?|confezioni?|flaconi?)?\b/i,
  );
  if (inizio) {
    const numero = numeroItaliano(inizio[1]);
    if (numero !== null && numero > 0 && numero <= 999) {
      return { qta: numero, residuo: segmento.slice(inizio[0].length).trim() };
    }
  }
  const finale = segmento.match(
    /\b(?:x|q(?:uan)?t(?:ita)?\.?)\s*(\d+|[A-Za-zÀ-ÿ]+)\s*$/i,
  );
  if (finale) {
    const numero = numeroItaliano(finale[1]);
    if (numero !== null && numero > 0 && numero <= 999) {
      return {
        qta: numero,
        residuo: `${segmento.slice(0, finale.index).trim()} ${segmento
          .slice((finale.index ?? 0) + finale[0].length)
          .trim()}`.trim(),
      };
    }
  }
  return { qta: 1, residuo: segmento.trim() };
}

function estraiPrezzo(segmento: string): {
  prezzo: number | null;
  esplicito: boolean;
  residuo: string;
} {
  const patterns = [
    /(?:€\s*\d[\d.,]*|\d[\d.,]*\s*(?:€|euro|eur))\b/i,
    /\b(?:prezzo|a)\s*:?\s*(\d[\d.,]*)\b/i,
  ];
  for (const pattern of patterns) {
    const match = segmento.match(pattern);
    if (!match || match.index === undefined) continue;
    const prezzo = interpretaImportoItaliano(match[1] ?? match[0]);
    if (prezzo === null) continue;
    return {
      prezzo,
      esplicito: true,
      residuo: `${segmento.slice(0, match.index)} ${segmento.slice(match.index + match[0].length)}`
        .replace(/\s+/g, " ")
        .trim(),
    };
  }
  return { prezzo: null, esplicito: false, residuo: segmento.trim() };
}

function estraiPaziente(segmento: string): { paziente: string; residuo: string } {
  const esplicito = segmento.match(
    /\b(?:paziente|paz\.?|intestat[oa])\s*:?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{2,}?)(?=\s+(?:allergeni?|ceppi?)\s*:|$)/i,
  );
  const implicito = segmento.match(
    /\bper\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ']+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ']+){1,3}?)(?=\s+(?:allergeni?|ceppi?)\s*:|$)/u,
  );
  const match = esplicito ?? implicito;
  if (!match || match.index === undefined) {
    return { paziente: "", residuo: segmento.trim() };
  }
  return {
    paziente: match[1].trim(),
    residuo: `${segmento.slice(0, match.index)} ${segmento.slice(match.index + match[0].length)}`
      .replace(/\s+/g, " ")
      .trim(),
  };
}

function valoreCanonico(
  valore: string,
  candidati: readonly string[],
): string | null {
  const cercato = normalizzaTestoPreventivo(valore);
  if (!cercato) return null;
  const esatto = candidati.find(
    (candidato) => normalizzaTestoPreventivo(candidato) === cercato,
  );
  if (esatto) return esatto;
  if (cercato.length < 3) return null;
  const compatibili = candidati.filter((candidato) => {
    const normalizzato = normalizzaTestoPreventivo(candidato);
    return normalizzato.startsWith(cercato) || cercato.startsWith(normalizzato);
  });
  return compatibili.length === 1 ? compatibili[0] : null;
}

function unisciDettagli(valori: string[]): string[] {
  const visti = new Set<string>();
  return valori
    .map((valore) => valore.trim())
    .filter((valore) => {
      const chiave = normalizzaTestoPreventivo(valore);
      if (!chiave || visti.has(chiave)) return false;
      visti.add(chiave);
      return true;
    })
    .slice(0, 10);
}

function estraiAllergeni(
  segmento: string,
  suggerimenti: readonly string[] = [],
): {
  allergeni: string[];
  residuo: string;
} {
  const match = segmento.match(
    /\b(?:allergeni?|ceppi?)\s*:?\s*(.+)$/i,
  );
  if (!match || match.index === undefined) {
    return { allergeni: [], residuo: segmento.trim() };
  }
  const allergeni = unisciDettagli(
    match[1]
      .split(/\s*(?:,|\+|\||\/|\be\b)\s*/i)
    .map((valore) => valore.trim().replace(/[.;]+$/g, ""))
      .filter(Boolean)
      .map((valore) => valoreCanonico(valore, suggerimenti) ?? valore),
  );
  return {
    allergeni,
    residuo: `${segmento.slice(0, match.index)} ${segmento.slice(
      match.index + match[0].length,
    )}`
      .replace(/\s+/g, " ")
      .trim(),
  };
}

function estraiDettagliLiberi(
  segmento: string,
  dettagli: NonNullable<ContestoParserPreventivo["dettagliProduzione"]>,
): {
  residuo: string;
  formulazione: string;
  posologia: string;
  allergeni: string[];
} {
  const parti = segmento
    .split(/,(?!\d)/)
    .map((parte) => parte.trim())
    .filter(Boolean);
  if (parti.length < 2) {
    return {
      residuo: segmento.trim(),
      formulazione: "",
      posologia: "",
      allergeni: [],
    };
  }
  let formulazione = "";
  let posologia = "";
  const allergeni: string[] = [];
  for (const parte of parti.slice(1)) {
    const formulazioneRiconosciuta = valoreCanonico(
      parte,
      dettagli.formulazioni ?? [],
    );
    if (formulazioneRiconosciuta && !formulazione) {
      formulazione = formulazioneRiconosciuta;
      continue;
    }
    const posologiaRiconosciuta = valoreCanonico(
      parte,
      dettagli.posologie ?? [],
    );
    if (posologiaRiconosciuta && !posologia) {
      posologia = posologiaRiconosciuta;
      continue;
    }
    allergeni.push(
      valoreCanonico(parte, dettagli.allergeni ?? []) ?? parte,
    );
  }
  return {
    residuo: parti[0],
    formulazione,
    posologia,
    allergeni: unisciDettagli(allergeni),
  };
}

function estraiValoreInline(
  segmento: string,
  candidati: readonly string[],
): { valore: string; residuo: string } {
  const ordinati = [...candidati]
    .filter((candidato) => candidato.trim())
    .sort((a, b) => b.length - a.length);
  for (const candidato of ordinati) {
    const patternCandidato = candidato
      .trim()
      .split(/\s+/)
      .map((parte) => parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const pattern = new RegExp(
      `(^|[\\s,;])${patternCandidato}(?=$|[\\s,;])`,
      "i",
    );
    if (!pattern.test(segmento)) continue;
    return {
      valore: candidato,
      residuo: segmento
        .replace(pattern, "$1")
        .replace(/\s+/g, " ")
        .trim(),
    };
  }
  return { valore: "", residuo: segmento.trim() };
}

function estraiDettagliInline(
  segmento: string,
  dettagli: NonNullable<ContestoParserPreventivo["dettagliProduzione"]>,
): {
  residuo: string;
  formulazione: string;
  posologia: string;
  allergeni: string[];
} {
  const conFormulazione = estraiValoreInline(
    segmento,
    dettagli.formulazioni ?? [],
  );
  const conPosologia = estraiValoreInline(
    conFormulazione.residuo,
    dettagli.posologie ?? [],
  );
  let residuo = conPosologia.residuo;
  const allergeni: string[] = [];
  while (allergeni.length < 10) {
    const estratto = estraiValoreInline(
      residuo,
      (dettagli.allergeni ?? []).filter(
        (allergene) =>
          !allergeni.some(
            (corrente) =>
              normalizzaTestoPreventivo(corrente) ===
              normalizzaTestoPreventivo(allergene),
          ),
      ),
    );
    if (!estratto.valore) break;
    allergeni.push(estratto.valore);
    residuo = estratto.residuo;
  }
  return {
    residuo,
    formulazione: conFormulazione.valore,
    posologia: conPosologia.valore,
    allergeni,
  };
}

function similaritaToken(segmento: string, nome: string): number {
  const a = new Set(tokenizza(segmento));
  const b = new Set(tokenizza(nome));
  if (a.size === 0 || b.size === 0) return 0;
  let comuni = 0;
  for (const token of b) {
    if (a.has(token)) comuni += 1;
  }
  return comuni / Math.max(a.size, b.size);
}

function classificaProdotto(
  segmento: string,
  prodotto: ProdottoParserPreventivo,
  linee: Set<string>,
): Candidato {
  const testo = normalizzaTestoPreventivo(segmento);
  const nome = normalizzaTestoPreventivo(prodotto.nome);
  const aliases = (prodotto.alias ?? []).map(normalizzaTestoPreventivo).filter(Boolean);
  let punteggio = 0;
  let motivazione = "somiglianza debole";
  if (testo === nome) {
    punteggio = 1;
    motivazione = "nome esatto";
  } else if (aliases.includes(testo)) {
    punteggio = 0.99;
    motivazione = "alias confermato";
  } else if (testo.includes(nome) && nome.length >= 3) {
    punteggio = 0.95;
    motivazione = "nome completo nel testo";
  } else {
    const aliasIncluso = aliases.find((alias) => alias.length >= 3 && testo.includes(alias));
    if (aliasIncluso) {
      punteggio = 0.93;
      motivazione = `alias «${aliasIncluso}» nel testo`;
    } else {
      const confronti = [nome, ...aliases];
      const miglioreConfronto = confronti
        .map((valore) => {
          const distanza = distanzaDamerauLevenshtein(testo, valore);
          const scala = Math.max(testo.length, valore.length, 1);
          return {
            valore,
            distanza,
            token: similaritaToken(testo, valore),
            trigrammi: similaritaTrigrammi(testo, valore),
            fuzzy: 1 - distanza / scala,
          };
        })
        .sort(
          (a, b) =>
            Math.max(b.token * 0.9, b.trigrammi * 0.78, b.fuzzy * 0.82) -
            Math.max(a.token * 0.9, a.trigrammi * 0.78, a.fuzzy * 0.82),
        )[0];
      const { token, trigrammi, distanza, fuzzy, valore } = miglioreConfronto;
      punteggio = Math.max(token * 0.9, trigrammi * 0.78, fuzzy * 0.82);
      if (distanza <= Math.max(1, Math.floor(valore.length * 0.22))) {
        motivazione = `refuso compatibile (${distanza} ${distanza === 1 ? "correzione" : "correzioni"})`;
      } else if (token >= trigrammi && token >= fuzzy) {
        motivazione = "parole caratteristiche coincidenti";
      } else {
        motivazione = "somiglianza del nome";
      }
    }
  }
  if (prodotto.categoria && linee.has(normalizzaTestoPreventivo(prodotto.categoria))) {
    punteggio += 0.045;
    motivazione += ", stessa linea dell'ordine";
  }
  if ((prodotto.usiCliente ?? 0) > 0) {
    punteggio += Math.min(0.035, Math.log2((prodotto.usiCliente ?? 0) + 1) * 0.01);
    motivazione += ", già usato dal cliente";
  }
  if ((prodotto.usiMedico ?? 0) > 0) {
    punteggio += Math.min(0.025, Math.log2((prodotto.usiMedico ?? 0) + 1) * 0.008);
    motivazione += ", già usato dal medico";
  }
  return { prodotto, punteggio: Math.min(1, punteggio), motivazione };
}

function segmenta(
  input: string,
  prodotti: ProdottoParserPreventivo[],
): { segmenti: string[]; note: string } {
  const righeBase = input
    .replace(/[•▪◦]/g, "\n")
    .replace(/\r\n?/g, "\n")
    .split(/\n+|;+/)
    .map((parte) => parte.trim())
    .filter(Boolean);
  const nomi = prodotti
    .flatMap((prodotto) => [prodotto.nome, ...(prodotto.alias ?? [])])
    .map(normalizzaTestoPreventivo)
    .filter((nome) => nome.length >= 3);
  const iniziaComeRiga = (value: string) => {
    const normalizzato = normalizzaTestoPreventivo(value);
    const primo = normalizzato.split(" ")[0];
    return numeroItaliano(primo) !== null || nomi.some((nome) => normalizzato.startsWith(nome));
  };
  const segmenti: string[] = [];
  const note: string[] = [];
  for (const riga of righeBase) {
    if (/^\s*(?:nota|note)\s*:/i.test(riga)) {
      note.push(riga.replace(/^\s*(?:nota|note)\s*:\s*/i, "").trim());
      continue;
    }
    const partiVirgola = riga.split(/,(?!\d)/);
    let corrente = "";
    for (const parte of partiVirgola) {
      const sottoParti = parte.split(/\s+e\s+(?=(?:\d+|[A-Za-zÀ-ÿ]+)\s+)/i);
      for (const sottoParte of sottoParti) {
        const pulita = sottoParte.trim();
        if (!pulita) continue;
        if (corrente && iniziaComeRiga(pulita)) {
          segmenti.push(corrente);
          corrente = pulita;
        } else {
          corrente = [corrente, pulita].filter(Boolean).join(", ");
        }
      }
    }
    if (corrente) segmenti.push(corrente);
  }
  return { segmenti, note: note.join("\n") };
}

function livello(confidenza: number, margine: number): LivelloConfidenza {
  if (confidenza >= 0.8 && margine >= 0.08) return "alta";
  if (confidenza >= 0.6 && margine >= 0.035) return "media";
  return "bassa";
}

export function interpretaPreventivo(
  input: string,
  contesto: ContestoParserPreventivo,
): RisultatoParserPreventivo {
  const { segmenti, note } = segmenta(input, contesto.prodotti);
  const linee = new Set((contesto.lineeOrdine ?? []).map(normalizzaTestoPreventivo));
  const righe = segmenti.map<RigaInterpretataPreventivo>((segmento) => {
    const conQuantita = estraiQuantita(segmento);
    const conPrezzo = estraiPrezzo(conQuantita.residuo);
    const conPaziente = estraiPaziente(conPrezzo.residuo);
    const dettagliProduzione = contesto.dettagliProduzione ?? {};
    const conAllergeni = estraiAllergeni(
      conPaziente.residuo,
      dettagliProduzione.allergeni,
    );
    const conDettagli = estraiDettagliLiberi(
      conAllergeni.residuo,
      dettagliProduzione,
    );
    const conDettagliInline = estraiDettagliInline(
      conDettagli.residuo,
      dettagliProduzione,
    );
    const allergeni = unisciDettagli([
      ...conAllergeni.allergeni,
      ...conDettagli.allergeni,
      ...conDettagliInline.allergeni,
    ]);
    const candidati = contesto.prodotti
      .map((prodotto) =>
        classificaProdotto(conDettagliInline.residuo, prodotto, linee),
      )
      .sort(
        (a, b) =>
          b.punteggio - a.punteggio ||
          a.prodotto.nome.localeCompare(b.prodotto.nome, "it", { sensitivity: "base" }),
      );
    const migliore = candidati[0];
    const secondo = candidati[1];
    const confidenza = migliore?.punteggio ?? 0;
    const margine = confidenza - (secondo?.punteggio ?? 0);
    const livelloConfidenza = livello(confidenza, margine);
    const prodottoRiconosciuto = !!migliore && confidenza >= 0.46;
    const formulazione =
      conDettagli.formulazione ||
      conDettagliInline.formulazione ||
      (prodottoRiconosciuto &&
      normalizzaTestoPreventivo(migliore.prodotto.nome).startsWith(
        "sublinguale",
      )
        ? valoreCanonico(
            "spray",
            dettagliProduzione.formulazioni ?? [],
          ) ?? "spray"
        : "");
    const posologia =
      conDettagli.posologia || conDettagliInline.posologia;
    const prezzo =
      conPrezzo.prezzo ??
      (prodottoRiconosciuto ? migliore.prodotto.prezzoSuggerito ?? null : null);
    const alternative = candidati
      .filter((candidato) => candidato.punteggio >= Math.max(0.35, confidenza - 0.22))
      .slice(0, 3)
      .map<AlternativaProdottoPreventivo>((candidato) => ({
        id: candidato.prodotto.id,
        nome: candidato.prodotto.nome,
        categoria: candidato.prodotto.categoria ?? "",
        punteggio: Number(candidato.punteggio.toFixed(3)),
        motivazione: candidato.motivazione,
      }));
    const motivazioni = [
      migliore?.motivazione ?? "nessun prodotto sufficientemente simile",
      conQuantita.qta !== 1 ? `quantità ${conQuantita.qta} rilevata` : "quantità predefinita 1",
      conPrezzo.esplicito
        ? "prezzo esplicito nel testo"
        : prezzo !== null
          ? "prezzo suggerito dalle regole condivise"
          : "prezzo da verificare",
      conPaziente.paziente ? "paziente riconosciuto" : "",
      formulazione
        ? `formulazione ${formulazione} riconosciuta`
        : "",
      posologia
        ? `posologia ${posologia} riconosciuta`
        : "",
      allergeni.length
        ? `${allergeni.length} ${
            allergeni.length === 1
              ? "allergene o ceppo riconosciuto"
              : "allergeni o ceppi riconosciuti"
          }`
        : "",
    ].filter(Boolean);
    return {
      segmento,
      prodottoId: prodottoRiconosciuto ? migliore.prodotto.id : "",
      prodottoNome: prodottoRiconosciuto
        ? migliore.prodotto.nome
        : conDettagli.residuo.trim(),
      qta: conQuantita.qta,
      prezzo,
      prezzoEsplicito: conPrezzo.esplicito,
      paziente: conPaziente.paziente,
      formulazione,
      posologia,
      allergeni,
      testoLibero: prodottoRiconosciuto
        ? ""
        : conDettagliInline.residuo.trim(),
      confidenza: Number(confidenza.toFixed(3)),
      livello: livelloConfidenza,
      motivazioni,
      alternative,
      richiedeRevisione:
        !prodottoRiconosciuto ||
        livelloConfidenza === "bassa" ||
        prezzo === null ||
        (alternative.length > 1 && margine < 0.08),
    };
  });
  return {
    righe,
    note,
    ambigue: righe.filter((riga) => riga.richiedeRevisione).length,
  };
}
