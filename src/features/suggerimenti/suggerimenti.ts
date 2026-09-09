import {
  api,
  type Suggerimento,
  type SuggerimentiBundle,
  type TipoSuggerimento,
} from "../../lib/tauri";
import {
  pianificaDedupClientiAuto,
  type DedupClientiAutoPlan,
} from "../anagrafiche/deduplicazione";

type EsitoControlloManuale = SuggerimentiBundle | null;

let bundleControlloManuale: SuggerimentiBundle | null = null;
let idsControlloManualeTemporanei = new Set<string>();
let controlloManualeInCorso: Promise<EsitoControlloManuale> | null = null;
let generazioneControlloManuale = 0;

/**
 * Il controllo completo deve sopravvivere allo smontaggio della Dashboard: cambiare
 * pagina non deve perdere né la richiesta in corso né il risultato appena prodotto.
 * Lo stato resta soltanto in memoria e non genera eventi o scritture persistenti.
 */
export function statoControlloManualeSuggerimenti(): {
  bundle: SuggerimentiBundle | null;
  temporanei: ReadonlySet<string>;
  inCorso: Promise<EsitoControlloManuale> | null;
} {
  return {
    bundle: bundleControlloManuale,
    temporanei: idsControlloManualeTemporanei,
    inCorso: controlloManualeInCorso,
  };
}

export function avviaControlloManualeSuggerimenti(
  carica: () => Promise<SuggerimentiBundle>,
): Promise<EsitoControlloManuale> {
  if (controlloManualeInCorso) return controlloManualeInCorso;

  const generazione = generazioneControlloManuale;
  bundleControlloManuale = null;
  const richiesta = carica()
    .then((bundle) => {
      if (generazione !== generazioneControlloManuale) return null;
      bundleControlloManuale = bundle;
      idsControlloManualeTemporanei = new Set(
        bundle.suggerimenti.map((suggerimento) => suggerimento.id),
      );
      return bundle;
    })
    .finally(() => {
      if (controlloManualeInCorso === richiesta) {
        controlloManualeInCorso = null;
      }
    });
  controlloManualeInCorso = richiesta;
  return richiesta;
}

/** Scarta una fotografia manuale quando la Dashboard riceve dati più recenti. */
export function invalidaControlloManualeSuggerimenti(): void {
  generazioneControlloManuale += 1;
  bundleControlloManuale = null;
  idsControlloManualeTemporanei = new Set();
  controlloManualeInCorso = null;
}

/**
 * Integra i dati ordinari senza cancellare in blocco il controllo manuale.
 * Una categoria viene sostituita soltanto quando la lista ordinaria contiene
 * davvero almeno un nuovo suggerimento di quel tipo.
 */
export function riconciliaControlloManualeSuggerimenti(
  correnti: SuggerimentiBundle,
): SuggerimentiBundle {
  if (!bundleControlloManuale) return correnti;

  const categorieCorrenti = new Set(
    correnti.suggerimenti.map((suggerimento) => suggerimento.tipo),
  );
  const temporaneiMantenuti = bundleControlloManuale.suggerimenti.filter(
    (suggerimento) =>
      idsControlloManualeTemporanei.has(suggerimento.id) &&
      !categorieCorrenti.has(suggerimento.tipo),
  );
  idsControlloManualeTemporanei = new Set(
    temporaneiMantenuti.map((suggerimento) => suggerimento.id),
  );
  const riconciliato: SuggerimentiBundle = {
    suggerimenti: ordinaSuggerimenti([
      ...correnti.suggerimenti,
      ...temporaneiMantenuti,
    ]),
    // I suggerimenti temporanei sono stati richiesti esplicitamente e devono
    // restare visibili; quelli ordinari arrivano già filtrati dal backend.
    nascosti: [],
    tipiInPausa: [],
  };
  bundleControlloManuale =
    idsControlloManualeTemporanei.size > 0 ? riconciliato : null;
  return riconciliato;
}

export function rimuoviSuggerimentiDalControlloManuale(
  ids: readonly string[],
): void {
  if (!bundleControlloManuale || ids.length === 0) return;
  const rimossi = new Set(ids);
  bundleControlloManuale = {
    ...bundleControlloManuale,
    suggerimenti: bundleControlloManuale.suggerimenti.filter(
      (suggerimento) => !rimossi.has(suggerimento.id),
    ),
  };
  ids.forEach((id) => idsControlloManualeTemporanei.delete(id));
  if (idsControlloManualeTemporanei.size === 0) {
    bundleControlloManuale = null;
  }
}

/** FNV-1a 64 bit: firma corta, deterministica e sincrona. Non è usata per
 * sicurezza, soltanto per rendere compatto lo stato condiviso della card. */
function firmaCompatta(valori: string[]): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode([...valori].sort().join("\n"))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function suggerimentoDuplicatiDaPiano(
  piano: DedupClientiAutoPlan,
): Suggerimento | null {
  if (piano.merges.length === 0) return null;
  const coinvolti = piano.merges.reduce(
    (totale, merge) => totale + 1 + merge.duplicati.length,
    0,
  );
  const fotografia = piano.merges.flatMap((merge) =>
    [merge.canonico, ...merge.duplicati].map(
      (record) => `${record.id}|${record.revision}`,
    ),
  );
  return {
    id: `s14:duplicati:${firmaCompatta(fotografia)}`,
    tipo: "duplicati",
    titolo:
      piano.merges.length === 1
        ? "Controlla un gruppo di clienti duplicati"
        : `Controlla ${piano.merges.length} gruppi di clienti duplicati`,
    dettaglio: `${coinvolti} anagrafiche con corrispondenze forti e verificabili`,
    azioneLabel: "Apri ottimizzazione",
    priorita: 58,
    collegamento: {
      path: "/impostazioni",
      azione: "ottimizza_database",
    },
    riferimentoData: "",
    aggiornatoMs: Date.now(),
  };
}

/**
 * Riusa il matcher della deduplica automatica. Per il solo suggerimento bastano
 * i clienti: ordini e riferimenti servono a scegliere il canonico durante
 * l'applicazione, non a stabilire se esiste una corrispondenza forte.
 */
export async function caricaSuggerimentoDuplicati(): Promise<Suggerimento | null> {
  const clienti = await api.recordsList("cliente");
  return suggerimentoDuplicatiDaPiano(
    pianificaDedupClientiAuto(clienti, []),
  );
}

export function ordinaSuggerimenti(
  suggerimenti: Suggerimento[],
): Suggerimento[] {
  return [...suggerimenti].sort(
    (a, b) =>
      b.priorita - a.priorita ||
      a.tipo.localeCompare(b.tipo) ||
      a.id.localeCompare(b.id),
  );
}

export function combinaSuggerimenti(
  bundle: SuggerimentiBundle,
  duplicati: Suggerimento | null,
  tipiAbilitati: readonly TipoSuggerimento[],
): Suggerimento[] {
  const nascosti = new Set(bundle.nascosti);
  const tipiInPausa = new Set(bundle.tipiInPausa);
  const abilitati = new Set(tipiAbilitati);
  const unici = new Map<string, Suggerimento>();
  for (const suggerimento of [
    ...bundle.suggerimenti,
    ...(duplicati ? [duplicati] : []),
  ]) {
    if (
      !nascosti.has(suggerimento.id) &&
      !tipiInPausa.has(suggerimento.tipo) &&
      abilitati.has(suggerimento.tipo)
    ) {
      unici.set(suggerimento.id, suggerimento);
    }
  }
  return ordinaSuggerimenti([...unici.values()]);
}
