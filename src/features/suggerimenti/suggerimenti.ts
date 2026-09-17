import {
  type Suggerimento,
  type SuggerimentiBundle,
  type TipoSuggerimento,
} from "../../lib/tauri";
import { aggiungiGiorniIso, oggiIso } from "../../lib/date";

type EsitoControlloManuale = SuggerimentiBundle | null;

let bundleControlloManuale: SuggerimentiBundle | null = null;
let idsControlloManualeTemporanei = new Set<string>();
let controlloManualeInCorso: Promise<EsitoControlloManuale> | null = null;
let generazioneControlloManuale = 0;
let annoControlloManuale: number | null = null;

/**
 * Il controllo completo deve sopravvivere allo smontaggio della Dashboard: cambiare
 * pagina non deve perdere né la richiesta in corso né il risultato appena prodotto.
 * Lo stato resta soltanto in memoria e non genera eventi o scritture persistenti.
 */
export function statoControlloManualeSuggerimenti(anno?: number): {
  bundle: SuggerimentiBundle | null;
  temporanei: ReadonlySet<string>;
  inCorso: Promise<EsitoControlloManuale> | null;
} {
  if (anno !== undefined && annoControlloManuale !== anno) {
    invalidaControlloManualeSuggerimenti();
    annoControlloManuale = anno;
  }
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

export function suggerimentoHaRaggiuntoSoglia(
  suggerimento: Suggerimento,
  sogliaGiorni: number,
  oggi = oggiIso(),
): boolean {
  if (sogliaGiorni <= 0) return true;
  if (suggerimento.riferimentoData) {
    return aggiungiGiorniIso(suggerimento.riferimentoData, sogliaGiorni) <= oggi;
  }
  const giorniTrascorso = Math.floor(
    (Date.now() - suggerimento.aggiornatoMs) / (24 * 60 * 60 * 1000),
  );
  return giorniTrascorso >= sogliaGiorni;
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
  tipiAbilitati: readonly TipoSuggerimento[],
  giorniAvviso?: Partial<Record<TipoSuggerimento, number>>,
  temporanei?: ReadonlySet<string>,
  oggi = oggiIso(),
): Suggerimento[] {
  const nascosti = new Set(bundle.nascosti);
  const tipiInPausa = new Set(bundle.tipiInPausa);
  const abilitati = new Set(tipiAbilitati);
  const unici = new Map<string, Suggerimento>();

  for (const suggerimento of bundle.suggerimenti) {
    if (
      !nascosti.has(suggerimento.id) &&
      !tipiInPausa.has(suggerimento.tipo) &&
      abilitati.has(suggerimento.tipo)
    ) {
      const eForzato = temporanei?.has(suggerimento.id) ?? false;
      const soglia = giorniAvviso?.[suggerimento.tipo] ?? 0;
      if (eForzato || suggerimentoHaRaggiuntoSoglia(suggerimento, soglia, oggi)) {
        unici.set(suggerimento.id, suggerimento);
      }
    }
  }
  return ordinaSuggerimenti([...unici.values()]);
}
