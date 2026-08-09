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
  const abilitati = new Set(tipiAbilitati);
  const unici = new Map<string, Suggerimento>();
  for (const suggerimento of [
    ...bundle.suggerimenti,
    ...(duplicati ? [duplicati] : []),
  ]) {
    if (
      !nascosti.has(suggerimento.id) &&
      abilitati.has(suggerimento.tipo)
    ) {
      unici.set(suggerimento.id, suggerimento);
    }
  }
  return ordinaSuggerimenti([...unici.values()]);
}
