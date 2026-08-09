// Stati di un rimborso (FASE 3D). Lo stato è DERIVATO dal backend: "richiesto"
// finché manca la data del rimborso, "effettuato" quando è valorizzata. Ognuno ha
// colore e icona per il riconoscimento a colpo d'occhio. L'origine ("manuale" |
// "extra") distingue i rimborsi nati da un ordine pagato in eccesso.
import { IconCircleCheck, IconClockHour4, type Icon } from "@tabler/icons-react";
import type { Rimborso } from "../../lib/tauri";

export interface StatoRimborsoDef {
  value: "richiesto" | "effettuato";
  label: string;
  color: string;
  Ico: Icon;
}

export const STATI_RIMBORSO: StatoRimborsoDef[] = [
  { value: "richiesto", label: "Richiesto", color: "orange", Ico: IconClockHour4 },
  { value: "effettuato", label: "Effettuato", color: "teal", Ico: IconCircleCheck },
];

const DEF = new Map(STATI_RIMBORSO.map((s) => [s.value, s]));

export function statoRimborsoDef(value: string): StatoRimborsoDef {
  return DEF.get(value as StatoRimborsoDef["value"]) ?? STATI_RIMBORSO[0];
}

export function origineRimborsoLabel(origine: string): string {
  return origine === "extra" ? "Soldi in eccesso" : "Manuale";
}

/** Evita di validare un rimborso contro un totale ordine diverso da quello mostrato. */
export function eccedenzaOrdineNonSalvata(eccedenzaInBozza: number, eccedenzaSalvata: number | null): boolean {
  return eccedenzaSalvata !== null && eccedenzaInBozza !== eccedenzaSalvata;
}

/** Un rimborso già richiesto spiega il sovrappiù dello scadenzario soltanto se
 * non esistono ulteriori voci aperte oltre agli incassi realmente eccedenti. */
export function rimborsoCopreEccedenzaScadenzario(args: {
  totale: number;
  coperto: number;
  eccedenza: number;
  rimborsoRichiesto: number;
  rimborsiEffettuati: number;
}): boolean {
  return (
    args.eccedenza > 0 &&
    args.coperto - args.totale === args.eccedenza &&
    args.rimborsoRichiesto + args.rimborsiEffettuati === args.eccedenza
  );
}

export interface RiepilogoRimborsiExtraOrdine {
  esistente: Rimborso | null;
  richiesto: Rimborso | null;
  importoEffettuato: number;
}

/** Fotografia dei soli rimborsi extra collegati all'ordine. Centralizza la stessa
 * selezione usata nell'editor, così il controllo al salvataggio può lavorare sui
 * dati appena riletti senza dipendere dai tempi di aggiornamento dello stato React. */
export function riepilogaRimborsiExtraOrdine(
  rimborsi: Rimborso[],
  ordineId: string
): RiepilogoRimborsiExtraOrdine {
  const collegati = rimborsi.filter(
    (rimborso) => rimborso.origine === "extra" && rimborso.ordineId === ordineId
  );
  const richiesto =
    collegati
      .filter((rimborso) => rimborso.stato === "richiesto")
      .sort(
        (a, b) =>
          b.dataRichiesta.localeCompare(a.dataRichiesta) || b.id.localeCompare(a.id)
      )[0] ?? null;

  return {
    esistente: mappaRimborsiExtra(collegati).get(ordineId) ?? null,
    richiesto,
    importoEffettuato: collegati
      .filter((rimborso) => rimborso.stato === "effettuato")
      .reduce((somma, rimborso) => somma + Math.max(0, rimborso.importo), 0),
  };
}

/** Calcola ciò che il dialogo deve mostrare quando un nuovo incasso aumenta
 * l'eccedenza: i rimborsi effettuati restano storici, quello richiesto viene riusato. */
export function impattoRimborsoDopoIncasso(args: {
  ordineId: string;
  totale: number;
  incassatoPrima: number;
  nuovoIncasso: number;
  rimborsi: Rimborso[];
}): { importoAttuale: number; importoDopo: number; esistente: boolean } {
  const collegati = args.rimborsi.filter(
    (rimborso) => rimborso.origine === "extra" && rimborso.ordineId === args.ordineId
  );
  const richiesto = collegati
    .filter((rimborso) => rimborso.stato === "richiesto")
    .sort(
      (a, b) => b.dataRichiesta.localeCompare(a.dataRichiesta) || b.id.localeCompare(a.id)
    )[0];
  const giaEffettuato = collegati
    .filter((rimborso) => rimborso.stato === "effettuato")
    .reduce((somma, rimborso) => somma + Math.max(0, rimborso.importo), 0);
  const eccedenzaDopo = Math.max(0, args.incassatoPrima + args.nuovoIncasso - args.totale);
  return {
    importoAttuale: richiesto?.importo ?? 0,
    importoDopo: Math.max(0, eccedenzaDopo - giaEffettuato),
    esistente: !!richiesto,
  };
}

/** Mappa ordineId → rimborso "extra" (il più recente per ordine). Serve a non
 * rigenerare un rimborso già richiesto: il sistema riconosce quello esistente e lo
 * riapre invece di crearne un altro. */
export function mappaRimborsiExtra(list: Rimborso[]): Map<string, Rimborso> {
  const m = new Map<string, Rimborso>();
  for (const r of list) {
    if (r.origine !== "extra" || !r.ordineId) continue;
    const prev = m.get(r.ordineId);
    if (!prev || r.dataRichiesta > prev.dataRichiesta) m.set(r.ordineId, r);
  }
  return m;
}
