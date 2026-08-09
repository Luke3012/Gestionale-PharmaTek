import { oggiIso as oggi } from "../../lib/date";
import type { Pagamento } from "../../lib/tauri";

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
  return (a.scadenza || "9999-12-31").localeCompare(b.scadenza || "9999-12-31")
    || a.id.localeCompare(b.id);
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

export function offsetScadenzaDaSpedizione(contoTipo: string, rel = 0): number {
  const base = contoTipo === "contrassegno" || contoTipo === "assegno" ? 30 : 7;
  return base + Math.max(0, Math.floor(rel));
}

export function formatDataScadenzario(iso: string): string {
  if (!iso || iso.length < 10) return iso || "—";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function aggiungiGiorniScadenzario(iso: string, giorni: number): string {
  const [y, m, d] = (iso || oggi()).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
  dt.setDate(dt.getDate() + giorni);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Giorni (>= 0) tra due date ISO; 0 se una manca o non è valida. */
export function giorniTra(a: string | undefined, b: string): number {
  if (!a || !b) return 0;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return 0;
  return Math.max(0, Math.round((db - da) / 86_400_000));
}
