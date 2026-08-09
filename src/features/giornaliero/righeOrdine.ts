import type { RecordDto } from "../../lib/tauri";
import { mergeRealtimeSelettivo } from "../../lib/mergeRealtime";

export interface RigaForm {
  key: string;
  id?: string;
  revision?: string;
  /** Vuoto = prodotto libero (non in catalogo): vale `prodottoNome` come testo. */
  prodottoId: string;
  prodottoNome: string;
  qta: number;
  prezzo: number | "";
  paziente: string;
  tipoTest: string;
  ml: string;
  codice: string;
  formulazione: string;
  posologia: string;
  numero: string;
  allergeni: string[];
}

const CAMPI_RIGA_REALTIME = [
  "prodottoId", "prodottoNome", "qta", "prezzo", "paziente", "tipoTest", "ml",
  "codice", "formulazione", "posologia", "numero", "allergeni",
] as const;

export interface MergeRigheRealtime {
  righe: RigaForm[];
  aggiornate: string[];
}

function valoriRigaRealtime(riga: RigaForm): Record<string, unknown> {
  return Object.fromEntries(CAMPI_RIGA_REALTIME.map((campo) => [campo, riga[campo]]));
}

export function firmaRigheOrdineRealtime(righe: RigaForm[]): string {
  return JSON.stringify(
    righe
      .filter((riga) => riga.id)
      .map((riga) => [riga.id, valoriRigaRealtime(riga)] as const)
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
  );
}

/** Merge per-campo delle righe di un ordine aperto, incluse aggiunte/eliminazioni remote. */
export function mergeRigheOrdineRealtime(
  baseline: RigaForm[],
  locali: RigaForm[],
  remote: RigaForm[]
): MergeRigheRealtime {
  const baseById = new Map(baseline.filter((r) => r.id).map((r) => [r.id!, r]));
  const localiById = new Map(locali.filter((r) => r.id).map((r) => [r.id!, r]));
  const remoteById = new Map(remote.filter((r) => r.id).map((r) => [r.id!, r]));
  const aggiornate: string[] = [];
  const risultato: RigaForm[] = [];

  for (const remota of remote) {
    if (!remota.id) continue;
    const base = baseById.get(remota.id);
    const locale = localiById.get(remota.id);
    if (!base) {
      risultato.push(remota);
      aggiornate.push(remota.id);
      continue;
    }
    if (!locale) {
      // La riga è stata rimossa localmente: un evento remoto non deve ricrearla.
      continue;
    }

    const merge = mergeRealtimeSelettivo(
      valoriRigaRealtime(base),
      valoriRigaRealtime(locale),
      valoriRigaRealtime(remota)
    );
    risultato.push({ ...locale, ...merge.valori, id: remota.id, revision: remota.revision, key: locale.key });
    if (merge.aggiornati.length > 0) aggiornate.push(remota.id);
  }

  for (const locale of locali) {
    if (!locale.id) {
      risultato.push(locale);
      continue;
    }
    if (remoteById.has(locale.id)) continue;
    const base = baseById.get(locale.id);
    if (!base) {
      risultato.push(locale);
    } else {
      // Una riga eliminata altrove non viene ricreata da un normale salvataggio campi.
      aggiornate.push(locale.id);
    }
  }

  return { righe: risultato, aggiornate };
}

export function nuovaRiga(diag = false): RigaForm {
  return {
    key: crypto.randomUUID(),
    prodottoId: "",
    prodottoNome: "",
    qta: 1,
    prezzo: "",
    paziente: "",
    tipoTest: diag ? "PRICK TEST" : "",
    ml: "",
    codice: "",
    formulazione: "",
    posologia: "",
    numero: "",
    allergeni: [],
  };
}

/** Azzera l'unica riga senza sostituirne il nodo React.
 *  In questo modo la cancellazione singola resta un reset immediato e non viene
 *  interpretata come uscita animata di una riga seguita dall'ingresso di un'altra. */
export function azzeraRigaForm(riga: RigaForm, diag = false): RigaForm {
  return {
    ...nuovaRiga(diag),
    key: riga.key,
  };
}

export function totaleRigaForm(riga: RigaForm): number {
  return (riga.prezzo === "" ? 0 : Math.round(Number(riga.prezzo) * 100)) * (riga.qta || 0);
}

export function totaleRigheForm(righe: RigaForm[]): number {
  return righe.reduce((somma, riga) => somma + totaleRigaForm(riga), 0);
}

/** Un ordine omaggio conserva prodotti e quantità, ma non genera alcun valore economico. */
export function azzeraPrezziRigheForm(righe: RigaForm[]): RigaForm[] {
  return righe.map((riga) => ({ ...riga, prezzo: 0 }));
}

function applicaTotaleRigaForm(riga: RigaForm, totaleRiga: number): RigaForm {
  const qta = Math.max(1, Math.floor(riga.qta || 1));
  const totale = Math.max(0, Math.floor(totaleRiga));
  return {
    ...riga,
    qta,
    prezzo: qta <= 1 ? totale / 100 : Math.floor(totale / qta) / 100,
  };
}

export function riduciRigheForm(righe: RigaForm[], totaleTarget: number): RigaForm[] {
  let residuoDaAllocare = Math.max(0, Math.floor(totaleTarget));
  return righe.flatMap((riga) => {
    const attuale = totaleRigaForm(riga);
    const target = Math.min(attuale, residuoDaAllocare);
    residuoDaAllocare -= target;
    if (target === attuale) return [riga];

    const qta = Math.max(1, Math.floor(riga.qta || 1));
    if (qta <= 1 || target % qta === 0) return [applicaTotaleRigaForm(riga, target)];

    const base = Math.floor(target / qta);
    const resto = target - base * qta;
    const righeRidotte: RigaForm[] = [];
    if (resto > 0) {
      righeRidotte.push({
        ...applicaTotaleRigaForm(riga, resto * (base + 1)),
        qta: resto,
        prezzo: (base + 1) / 100,
      });
    }
    const qtaBase = qta - resto;
    if (qtaBase > 0) {
      righeRidotte.push({
        ...applicaTotaleRigaForm(
          { ...riga, id: undefined, key: crypto.randomUUID(), qta: qtaBase },
          qtaBase * base
        ),
        qta: qtaBase,
        prezzo: base / 100,
      });
    }
    return righeRidotte.length > 0 ? righeRidotte : [applicaTotaleRigaForm(riga, target)];
  });
}

export function adeguaRigheFormATotale(righe: RigaForm[], totaleTarget: number): RigaForm[] {
  const target = Math.max(0, Math.floor(totaleTarget));
  const totaleAttuale = totaleRigheForm(righe);
  if (target <= totaleAttuale) return riduciRigheForm(righe, target);

  const indice = [...righe]
    .map((riga, i) => ({ riga, i }))
    .reverse()
    .find(({ riga }) => riga.prodottoId || riga.prodottoNome.trim())?.i;
  if (indice === undefined) return righe;

  const differenza = target - totaleAttuale;
  return righe.map((riga, i) =>
    i === indice ? applicaTotaleRigaForm(riga, totaleRigaForm(riga) + differenza) : riga
  );
}

export function righeOrdineDaRecord(
  records: RecordDto[],
  prodotti: RecordDto[],
  diagnostica = false
): RigaForm[] {
  return records.length > 0
    ? records.map((record) => {
        const prodottoId = (record.data.prodotto_id as string) || "";
        const nomeCatalogo = prodottoId
          ? (prodotti.find((prodotto) => prodotto.id === prodottoId)?.data.nome as string)
          : "";
        return {
          key: record.id,
          id: record.id,
          revision: record.revision,
          prodottoId,
          prodottoNome: nomeCatalogo || (record.data.prodotto_nome as string) || "",
          qta: typeof record.data.qta === "number" ? record.data.qta : 1,
          prezzo: typeof record.data.prezzo === "number" ? record.data.prezzo / 100 : "",
          paziente: (record.data.paziente as string) || "",
          tipoTest: (record.data.tipo_test as string) || "",
          ml: (record.data.ml as string) || "",
          codice: (record.data.codice_fornitore as string) || "",
          formulazione: (record.data.formulazione as string) || "",
          posologia: (record.data.posologia as string) || "",
          numero: (record.data.numero as string) || "",
          allergeni: Array.isArray(record.data.allergeni) ? (record.data.allergeni as string[]) : [],
        };
      })
    : [nuovaRiga(diagnostica)];
}
