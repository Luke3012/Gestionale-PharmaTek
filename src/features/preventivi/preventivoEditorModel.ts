import type { Pagamento, Preventivo, RecordDto } from "../../lib/tauri";
import { nuovaRiga, type RigaForm } from "../giornaliero/righeOrdine";
import type { DatiFatturazione } from "../giornaliero/DatiFatturazionePanel";

export type RigaDraftPreventivo = RigaForm;

export interface PatchPagamentoVirtuale {
  contoId?: string;
  scadenza?: string;
  scadDaSpedizione?: boolean;
}

export function campiContoPagamentoVirtuale(contoId: string, conto?: RecordDto) {
  return {
    contoId,
    contoNome: String(conto?.data.nome || ""),
    contoTipo: String(conto?.data.tipo || ""),
    contoIban: String(conto?.data.iban || ""),
    data: "",
    verificato: false,
    distintaId: "",
    contoAccreditoNome: "",
    note: "",
  };
}

export function giorniTraScadenze(inizio: string, fine: string): number {
  return Math.max(
    0,
    Math.round((new Date(fine).getTime() - new Date(inizio).getTime()) / 86_400_000),
  );
}

export function applicaPatchPagamentoVirtuale(
  pagamento: Pagamento,
  key: string,
  patch: PatchPagamentoVirtuale,
  contiById: ReadonlyMap<string, RecordDto>,
): Pagamento {
  if (pagamento.id !== key) return pagamento;
  const conto = patch.contoId ? contiById.get(patch.contoId) : undefined;
  return {
    ...pagamento,
    ...patch,
    ...(conto ? {
      contoNome: String(conto.data.nome || ""),
      contoTipo: String(conto.data.tipo || ""),
      contoIban: String(conto.data.iban || ""),
    } : {}),
  };
}

export interface TestataDraftPreventivo extends Record<string, unknown> {
  validita: number;
  condizioni: string;
  introduzione: string;
  note: string;
  scontoPercentuale: number;
  acconto: number;
  linea: string;
  fatturazioneDiversa: boolean;
  fatturazione: DatiFatturazione;
}

export function fatturazioneDaPreventivo(preventivo: Preventivo): DatiFatturazione {
  if (!preventivo.fatturazioneDiversa) {
    return {
      ragione_sociale: "",
      indirizzo: "",
      citta: "",
      prov: "",
      cap: "",
      piva: "",
    };
  }
  return {
    ragione_sociale: preventivo.fatturazioneNome,
    indirizzo: preventivo.fatturazioneIndirizzo,
    citta: preventivo.fatturazioneCitta,
    prov: preventivo.fatturazioneProv,
    cap: preventivo.fatturazioneCap,
    piva: preventivo.fatturazionePiva,
  };
}

export function testataDaPreventivo(preventivo: Preventivo): TestataDraftPreventivo {
  return {
    validita: preventivo.validitaGiorni,
    condizioni: preventivo.condizioniPagamento,
    introduzione: preventivo.introduzione,
    note: preventivo.note,
    scontoPercentuale: preventivo.scontoPercentuale,
    acconto: preventivo.acconto,
    linea: preventivo.linee[0] || "Immunoterapia",
    fatturazioneDiversa: Boolean(preventivo.fatturazioneDiversa),
    fatturazione: fatturazioneDaPreventivo(preventivo),
  };
}

export function rigaVuotaPreventivo(linea = "Immunoterapia"): RigaDraftPreventivo {
  return nuovaRiga(linea === "Diagnostica");
}

export function righeDaPreventivo(preventivo: Preventivo): RigaDraftPreventivo[] {
  return preventivo.righe.length
    ? preventivo.righe.map((riga) => ({
        key: riga.id,
        id: riga.id,
        revision: riga.revision,
        prodottoId: riga.prodottoId,
        prodottoNome: riga.prodottoNome,
        qta: riga.qta,
        prezzo: riga.prezzo / 100,
        paziente: riga.paziente,
        tipoTest: riga.tipoTest,
        ml: riga.ml,
        codice: riga.codice,
        formulazione: riga.formulazione,
        posologia: riga.posologia,
        numero: riga.numero,
        allergeni: riga.allergeni,
      }))
    : [rigaVuotaPreventivo(preventivo.linee[0])];
}

export function snapshotPreventivoEditor(
  preventivo: Preventivo,
  righe: RigaDraftPreventivo[],
  validita: number,
  condizioni: string,
  introduzione: string,
  note: string,
  scontoPercentuale: number,
  acconto: number,
  linea: string,
  fatturazioneDiversa: boolean,
  fatturazione: DatiFatturazione,
) {
  return JSON.stringify({
    revision: preventivo.revision,
    righe: righe.map(({ key: _key, ...riga }) => riga),
    validita,
    condizioni,
    introduzione,
    note,
    scontoPercentuale,
    acconto,
    linea,
    fatturazioneDiversa,
    fatturazione,
  });
}
