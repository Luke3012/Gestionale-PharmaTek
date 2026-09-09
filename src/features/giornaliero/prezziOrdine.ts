import type { RigaForm } from "./righeOrdine";

export function applicaPrezzoAutomaticoRiga(
  riga: RigaForm,
  nuovoCents: number,
  opzioni: { soloSeVuoto?: boolean; sovrascrivi?: boolean; prezzoPrecedente?: number | null } = {}
): RigaForm {
  const attuale = riga.prezzo === "" ? 0 : Math.round(Number(riga.prezzo) * 100);
  if ("prezzoPrecedente" in opzioni) {
    const coincideColPrecedente = opzioni.prezzoPrecedente != null && attuale === opzioni.prezzoPrecedente;
    if (!(attuale <= 0) && !coincideColPrecedente) return riga;
  } else {
    if (opzioni.soloSeVuoto && attuale > 0) return riga;
    if (!opzioni.sovrascrivi && attuale > 0) return riga;
  }
  return { ...riga, prezzo: nuovoCents / 100 };
}
