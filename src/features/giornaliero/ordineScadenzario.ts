import { formattaDataIsoItaliana, oggiIso as oggi } from "../../lib/date";
export { aggiungiGiorniDaOggiIso as aggiungiGiorniScadenzario } from "../../lib/date";
import type { Pagamento, RecordDto } from "../../lib/tauri";
import { èContoTransito } from "../contabilita/contoPreferito";

export function scaduta(scadenza: string): boolean {
  return !!scadenza && scadenza < oggi();
}

export function pagamentoApertoSaldoRata(
  p: Pick<Pagamento, "tipo" | "saldato">
): boolean {
  return !p.saldato && (p.tipo === "saldo" || p.tipo === "rata");
}

export function pagamentoApertoDaSaldare(
  p: Pick<Pagamento, "tipo" | "saldato">
): boolean {
  return !p.saldato && (p.tipo === "acconto" || p.tipo === "saldo" || p.tipo === "rata");
}

export function pagamentoPreviewLocale(p: Pick<Pagamento, "id">): boolean {
  return p.id.startsWith("__preview_scadenzario__") || p.id.startsWith("__local_pagamento__");
}

/**
 * Se lo scadenzario mostra una copia ricalcolata di un pagamento persistito,
 * conserva il record reale come baseline della modale e passa separatamente
 * l'importo visibile. In questo modo il salvataggio rileva davvero la modifica.
 */
export function pagamentoPersistitoConImportoPreview(
  preview: Pagamento,
  persistiti: Pagamento[]
): { pagamento: Pagamento; importoProposto?: number } {
  const persistito = persistiti.find((pagamento) => pagamento.id === preview.id);
  if (!persistito) return { pagamento: preview };
  return persistito.importo === preview.importo
    ? { pagamento: persistito }
    : { pagamento: persistito, importoProposto: preview.importo };
}

interface PropostaPagamentoAggiuntivoInput {
  pagamentiPreview: Pagamento[];
  residuo: number;
  accontoPrevisto: number;
  scopertoScadenzario: number;
}

/**
 * Precompila il pagamento aggiuntivo usando lo stesso scadenzario mostrato
 * nell'editor, comprese le righe ricreate automaticamente ma non ancora salvate.
 *
 * Lo scoperto misura quanto manca al piano, quindi vale zero quando una riga
 * automatica di saldo copre già il residuo. In quel caso il suo importo è proprio
 * quello da proporre: ignorarla farebbe ricomparire erroneamente l'acconto.
 */
export function proponiPagamentoAggiuntivo({
  pagamentiPreview,
  residuo,
  accontoPrevisto,
  scopertoScadenzario,
}: PropostaPagamentoAggiuntivoInput): { tipo: "acconto" | "saldo"; importo: number } {
  const residuoPositivo = Math.max(0, residuo);
  const ordineGiaSaldato = residuo <= 0;
  const saldoAutomatico = pagamentiPreview
    .filter(
      (pag) =>
        pag.id.startsWith("__preview_scadenzario__") &&
        pagamentoApertoSaldoRata(pag)
    )
    .reduce((somma, pag) => somma + pag.importo, 0);
  // Mantiene la regola precedente per pagamenti persistiti/locali. La estende
  // esclusivamente al saldo automatico visibile: un acconto automatico che da
  // solo copre l'intero ordine deve invece continuare a essere proposto come acconto.
  const haScadenzarioApertoConfermatoOLocale = pagamentiPreview.some(
    (pag) =>
      !pag.id.startsWith("__preview_scadenzario__") &&
      pagamentoApertoDaSaldare(pag)
  );
  const tipo = ordineGiaSaldato || haScadenzarioApertoConfermatoOLocale || saldoAutomatico > 0
    ? "saldo"
    : "acconto";

  if (tipo === "acconto") {
    return {
      tipo,
      importo: accontoPrevisto > 0
        ? Math.min(accontoPrevisto, residuoPositivo)
        : residuoPositivo,
    };
  }

  return {
    tipo,
    importo: Math.max(0, scopertoScadenzario, saldoAutomatico),
  };
}

export function confrontaPagamentiAperti(a: Pagamento, b: Pagamento): number {
  const prioritaA = a.tipo === "acconto" ? 0 : 1;
  const prioritaB = b.tipo === "acconto" ? 0 : 1;
  if (prioritaA !== prioritaB) return prioritaA - prioritaB;
  if (a.scadDaSpedizione && b.scadDaSpedizione) {
    const relA = a.scadRelGiorni ?? 0;
    const relB = b.scadRelGiorni ?? 0;
    if (relA !== relB) return relA - relB;
  }
  return (a.scadenza || "9999-12-31").localeCompare(b.scadenza || "9999-12-31")
    || a.id.localeCompare(b.id);
}

/**
 * Confronta due pagamenti da saldare (es. per "Registra pagamento" o "Salda prossima rata").
 * Regole di precedenza:
 * 1. L'acconto ha precedenza assoluta (è l'anticipo dell'ordine).
 * 2. Tra saldo e rate aperti, hanno priorità i conti bancari/ordinari rispetto a contrassegno/transito
 *    (il contrassegno viene normalmente riscosso alla consegna dal corriere, mentre l'incasso registrato
 *    a mano è tipicamente un bonifico o saldo diretto).
 * 3. Se rimangono solo voci a contrassegno, viene proposta la prima di esse.
 * 4. A parità di canale di incasso, ordine cronologico di scadenza (e tie-break su id).
 */
function confrontaPagamentiDaSaldare(
  a: Pagamento,
  b: Pagamento,
  conti?: RecordDto[]
): number {
  const prioritaAccontoA = a.tipo === "acconto" ? 0 : 1;
  const prioritaAccontoB = b.tipo === "acconto" ? 0 : 1;
  if (prioritaAccontoA !== prioritaAccontoB) return prioritaAccontoA - prioritaAccontoB;

  const tipoA = a.contoTipo || (conti && a.contoId ? (conti.find((c) => c.id === a.contoId)?.data.tipo as string) : "");
  const tipoB = b.contoTipo || (conti && b.contoId ? (conti.find((c) => c.id === b.contoId)?.data.tipo as string) : "");

  const transitoA = èContoTransito(tipoA) ? 1 : 0;
  const transitoB = èContoTransito(tipoB) ? 1 : 0;
  if (transitoA !== transitoB) return transitoA - transitoB;

  return (a.scadenza || "9999-12-31").localeCompare(b.scadenza || "9999-12-31")
    || (a.id || "").localeCompare(b.id || "");
}

/**
 * Seleziona il prossimo pagamento aperto da saldare per un ordine.
 * Esclude le preview puramente locali e privilegia i conti bancari/ordinari
 * prima del contrassegno (se è presente solo contrassegno, propone quello).
 */
export function selezionaProssimoPagamentoDaSaldare(
  pagamenti: Pagamento[],
  conti?: RecordDto[]
): Pagamento | null {
  const aperti = pagamenti.filter(
    (p) => !pagamentoPreviewLocale(p) && pagamentoApertoDaSaldare(p)
  );
  if (aperti.length === 0) return null;
  return aperti.sort((a, b) => confrontaPagamentiDaSaldare(a, b, conti))[0] ?? null;
}

export function firmaScadenzario(pagamenti: Pagamento[]): string {
  return [...pagamenti]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) =>
      [
        p.id,
        p.tipo,
        p.importo,
        p.saldato ? 1 : 0,
        p.scadenza,
        p.data,
        p.contoId,
        p.scadDaSpedizione ? 1 : 0,
        p.scadRelGiorni ?? 0,
      ].join(":")
    )
    .join("|");
}

export interface RigaScadenzarioOrdinabile {
  key: string;
  tipo: string;
  scadenza?: string;
  data?: string;
  scadDaSpedizione?: boolean;
  scadRelGiorni?: number;
}

export function confrontaRigheScadenzario<T extends RigaScadenzarioOrdinabile>(a: T, b: T): number {
  const prioritaA = a.tipo === "acconto" ? 0 : 1;
  const prioritaB = b.tipo === "acconto" ? 0 : 1;
  if (prioritaA !== prioritaB) return prioritaA - prioritaB;
  if (a.scadDaSpedizione && b.scadDaSpedizione) {
    const relA = a.scadRelGiorni ?? 0;
    const relB = b.scadRelGiorni ?? 0;
    if (relA !== relB) return relA - relB;
  }
  const dataA = a.scadenza
    || (a.scadDaSpedizione
      ? `spedizione:${String(a.scadRelGiorni ?? 0).padStart(5, "0")}`
      : a.data || "9999-12-31");
  const dataB = b.scadenza
    || (b.scadDaSpedizione
      ? `spedizione:${String(b.scadRelGiorni ?? 0).padStart(5, "0")}`
      : b.data || "9999-12-31");
  return dataA.localeCompare(dataB) || a.key.localeCompare(b.key);
}

type PagamentoSlot = Pick<
  Pagamento,
  "id" | "tipo" | "saldato" | "scadenza" | "scadDaSpedizione" | "scadRelGiorni" | "contoTipo" | "spedizioneId"
>;

/** Rate incassate alla consegna (contrassegno/assegno o agganciate a una spedizione): non scalano. */
function rataAncorataAllaConsegna(p: PagamentoSlot): boolean {
  return !!p.spedizioneId || èContoTransito(p.contoTipo);
}

function confrontaSlot(a: PagamentoSlot, b: PagamentoSlot): number {
  const riga = (p: PagamentoSlot): RigaScadenzarioOrdinabile => ({
    key: p.id,
    tipo: "rata",
    scadenza: p.scadenza,
    data: "",
    scadDaSpedizione: p.scadDaSpedizione,
    scadRelGiorni: p.scadRelGiorni,
  });
  return confrontaRigheScadenzario(riga(a), riga(b));
}

/**
 * Specchio di `pianifica_scorrimento_rate_saldate` (backend): saldando una rata che non è
 * la prima aperta, il pagamento prende la posizione (scadenza o «spedizione + N gg») della
 * prima aperta e le aperte precedenti scalano di un posto, restando in fondo al piano.
 * `primaDelSaldo` è il pagamento com'era prima del saldo (posizione e conto originali).
 */
export function scalaRateDopoSaldo<T extends PagamentoSlot>(pagamenti: T[], primaDelSaldo: PagamentoSlot): T[] {
  if (
    (primaDelSaldo.tipo !== "saldo" && primaDelSaldo.tipo !== "rata") ||
    primaDelSaldo.saldato ||
    rataAncorataAllaConsegna(primaDelSaldo)
  ) {
    return pagamenti;
  }
  const candidati: PagamentoSlot[] = pagamenti
    .filter((p) => p.id !== primaDelSaldo.id && pagamentoApertoSaldoRata(p) && !rataAncorataAllaConsegna(p))
    .map((p) => ({ ...p }));
  candidati.push(primaDelSaldo);
  candidati.sort(confrontaSlot);
  const pos = candidati.findIndex((p) => p.id === primaDelSaldo.id);
  if (pos <= 0) return pagamenti;
  const nuovoSlot = new Map<string, PagamentoSlot>([[primaDelSaldo.id, candidati[0]]]);
  for (let i = 0; i < pos; i += 1) nuovoSlot.set(candidati[i].id, candidati[i + 1]);
  return pagamenti.map((p) => {
    const slot = nuovoSlot.get(p.id);
    return slot
      ? { ...p, scadenza: slot.scadenza, scadDaSpedizione: slot.scadDaSpedizione, scadRelGiorni: slot.scadRelGiorni }
      : p;
  });
}

/**
 * Distanze «spedizione + N gg» coerenti del piano: incassate e attese insieme, in ordine
 * di piano, a passi di 30 giorni. Restituisce solo le rate da correggere. Includere le
 * saldate evita che, dopo un saldo, le attese ripartano da +0 sovrapponendosi a quelle
 * già incassate.
 */
export function relSpedizioneDaNormalizzare(
  pagamenti: Array<Pick<Pagamento, "id" | "tipo" | "saldato" | "scadenza" | "scadDaSpedizione" | "scadRelGiorni">>
): Map<string, number> {
  const piano = pagamenti
    .filter((p) => p.scadDaSpedizione && (p.tipo === "saldo" || p.tipo === "rata"))
    .sort((a, b) =>
      (a.scadRelGiorni ?? 0) - (b.scadRelGiorni ?? 0)
      || Number(b.saldato) - Number(a.saldato)
      || (a.scadenza || "9999-12-31").localeCompare(b.scadenza || "9999-12-31")
      || a.id.localeCompare(b.id)
    );
  const out = new Map<string, number>();
  piano.forEach((p, idx) => {
    if (p.scadRelGiorni !== idx * 30) out.set(p.id, idx * 30);
  });
  return out;
}

export function offsetScadenzaDaSpedizione(contoTipo: string, rel = 0): number {
  const base = èContoTransito(contoTipo) ? 30 : 7;
  return base + Math.max(0, Math.floor(rel));
}

/**
 * Calcola l'offset per tutte le righe legate alla spedizione in base al conto
 * effettivo della riga (base 30gg per contrassegno/assegno, base 7gg per conti ordinari)
 * sommato alla cadenza relativa (es. 0, +30gg, +60gg...).
 */
export function calcolaOffsetSpedizRighe<T extends { key: string; contoTipo?: string; scadDaSpedizione?: boolean; scadRelGiorni?: number }>(
  righe: T[]
): Map<string, number> {
  const righeSpediz = righe.filter((r) => r.scadDaSpedizione);
  const out = new Map<string, number>();
  if (righeSpediz.length === 0) return out;
  righeSpediz.forEach((r, idx) => {
    const rel = r.scadRelGiorni !== undefined && r.scadRelGiorni >= 0 ? r.scadRelGiorni : idx * 30;
    const base = èContoTransito(r.contoTipo) ? 30 : 7;
    out.set(r.key, base + rel);
  });
  return out;
}

export function formatDataScadenzario(iso: string): string {
  return formattaDataIsoItaliana(iso, "—");
}

/** Giorni (>= 0) tra due date ISO; 0 se una manca o non è valida. */
export function giorniTra(a: string | undefined, b: string): number {
  if (!a || !b) return 0;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return 0;
  return Math.max(0, Math.round((db - da) / 86_400_000));
}
