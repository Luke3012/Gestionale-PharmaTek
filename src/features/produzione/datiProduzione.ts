// Helper condivisi per i **dati di produzione per riga** (FASE 5B): formulazione, posologia,
// allergeni/ceppi. Usati dalla pagina Produzione e dal modale di compilazione obbligatoria.
import type { RecordDto } from "../../lib/tauri";

/** Suggerimenti per l'autocompletamento: valori canonici (catalogo) + storico già compilato. */
export interface Suggerimenti {
  formulazioni: string[];
  posologie: string[];
  allergeni: string[];
}

/** Campi produzione di una riga, normalizzati (stringa vuota / array vuoto se assenti). */
export interface CampiProduzione {
  formulazione: string;
  posologia: string;
  allergeni: string[];
}

export function campiProduzione(data: Record<string, unknown>): CampiProduzione {
  return {
    formulazione: (data.formulazione as string) || "",
    posologia: (data.posologia as string) || "",
    allergeni: Array.isArray(data.allergeni) ? (data.allergeni as string[]) : [],
  };
}

/** Una riga è "completa" per la produzione quando ha formulazione, posologia e almeno un
 * allergene/ceppo: sono i dati minimi che Laboratorio richiede per produrre il set di fiale. */
export function rigaProduzioneCompleta(v: CampiProduzione): boolean {
  return v.formulazione.trim() !== "" && v.posologia.trim() !== "" && v.allergeni.length > 0;
}

/** Suggerimenti per i **dati di produzione** = valori canonici del catalogo
 * (`prodotto_produzione`, per tipo) + storico già compilato sulle righe d'ordine, così
 * l'autocompletamento impara da ciò che si è già scritto. Stessa logica usata sia nella
 * pagina Produzione sia nell'editor ordine (auto-compilazione coerente). FASE 5B. */
export function suggerimentiProduzione(catalogo: RecordDto[], righe: RecordDto[]): Suggerimenti {
  const catFor: string[] = [];
  const catPos: string[] = [];
  const catAll: string[] = [];
  for (const r of catalogo) {
    const tipo = (r.data.tipo as string) || "";
    const v = (r.data.valore as string) || "";
    if (!v) continue;
    if (tipo === "formulazione") catFor.push(v);
    else if (tipo === "posologia") catPos.push(v);
    else if (tipo === "allergene" || tipo === "ceppo") catAll.push(v);
  }
  for (const r of righe) {
    const f = (r.data.formulazione as string) || "";
    const p = (r.data.posologia as string) || "";
    if (f) catFor.push(f);
    if (p) catPos.push(p);
    if (Array.isArray(r.data.allergeni)) for (const a of r.data.allergeni as string[]) if (a) catAll.push(a);
  }
  const uniq = (xs: string[]) => [...new Set(xs)];
  return { formulazioni: uniq(catFor), posologie: uniq(catPos), allergeni: uniq(catAll) };
}

/** Nome del prodotto della riga: dal catalogo commerciale o dal testo libero. */
export function nomeProdotto(prodMap: Map<string, string>, r: RecordDto): string {
  const pid = (r.data.prodotto_id as string) || "";
  return (pid && prodMap.get(pid)) || (r.data.prodotto_nome as string) || "—";
}

/** Aggiunge `n` giorni **lavorativi** (salta sabato/domenica) a una data. FASE 5C. */
function aggiungiGiorniLavorativi(from: Date, n: number): Date {
  const d = new Date(from);
  let rimasti = n;
  while (rimasti > 0) {
    d.setDate(d.getDate() + 1);
    const g = d.getDay(); // 0 = domenica, 6 = sabato
    if (g !== 0 && g !== 6) rimasti -= 1;
  }
  return d;
}

/** Data prevista di default per il file Laboratorio (col J): oggi + ~25 giorni lavorativi,
 * formattata `gg/mm/aaaa`. Editabile dall'utente (globale e per riga). FASE 5C. */
export function dataPrevistaDefault(giorni = 25): string {
  const d = aggiungiGiorniLavorativi(new Date(), giorni);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Tipi di test diagnostico (la "dicitura"): elenco built-in curato (FASE 5D). NON è
 * un'entità sincronizzata — resta locale; l'Autocomplete consente anche voci libere e i
 * suggerimenti per-cliente arrivano dallo storico. */
export const TIPI_TEST: string[] = [
  "PRICK TEST",
  "PRICK TEST ALIMENTI",
  "PRICK TEST RESPIRATORI",
  "INTRADERMO",
  "PATCH TEST",
  "diagnostica allergologica prick test",
];

/** Volumi (ml) ricorrenti della diagnostica, per l'autocompletamento. Voci libere
 * comunque ammesse; allineati al catalogo produzione seminato (tipo "ml"). FASE 5D. */
export const ML_COMUNI: string[] = ["1", "2", "2.5", "3", "5"];

/** Campi diagnostica di una riga, normalizzati. FASE 5D. */
export interface CampiDiagnostica {
  tipoTest: string;
  ml: string;
  qta: number;
  codice: string;
}

export function campiDiagnostica(data: Record<string, unknown>): CampiDiagnostica {
  return {
    tipoTest: (data.tipo_test as string) || "",
    ml: (data.ml as string) || "",
    qta: typeof data.qta === "number" ? (data.qta as number) : 0,
    codice: (data.codice_fornitore as string) || "",
  };
}

/** Riga diagnostica con avviso "gentile": ML o quantità mancanti non bloccano l'invio,
 * ma vanno segnalati con garbo. FASE 5D. */
export function diagnosticaIncompleta(v: CampiDiagnostica): boolean {
  return v.ml.trim() === "" || v.qta <= 0;
}

/** Suggerimenti per la Diagnostica derivati dallo **storico locale** (FASE 5D): allergeni e
 * tipi-test già scritti. Una riga è "di diagnostica" se ha un `tipo_test` valorizzato. Se è
 * dato l'`ordineIdsCliente` (gli ordini di quel medico/azienda), i suoi allergeni vengono
 * messi **in cima** (suggerimento per-cliente). Tutto calcolato a runtime → niente entità
 * sincronizzate ("personale"). */
export function suggerimentiDiagnostica(
  righe: RecordDto[],
  ordineIdsCliente?: Set<string>
): { allergeni: string[]; tipiTest: string[] } {
  const tipi = new Set<string>();
  const tuttiAll = new Set<string>();
  const delCliente = new Set<string>();
  for (const r of righe) {
    const tt = (r.data.tipo_test as string) || "";
    if (!tt) continue; // solo righe diagnostica
    tipi.add(tt);
    const nome = ((r.data.prodotto_nome as string) || "").trim();
    if (!nome) continue;
    tuttiAll.add(nome);
    if (ordineIdsCliente?.has((r.data.ordine_id as string) || "")) delCliente.add(nome);
  }
  // Allergeni del cliente in cima, poi gli altri (entrambi ordinati alfabeticamente).
  const altri = [...tuttiAll].filter((a) => !delCliente.has(a)).sort((x, y) => x.localeCompare(y));
  const allergeni = [...[...delCliente].sort((x, y) => x.localeCompare(y)), ...altri];
  return { allergeni, tipiTest: [...new Set([...TIPI_TEST, ...tipi])] };
}
