/** Ricerca AND: ogni parola deve comparire, indipendentemente dall'ordine. */
export function normalizzaRicercaTesto(testo: string): string {
  return testo.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("it").replace(/\s+/g, " ").trim();
}

export function preparaRicercaTesto(query: string): (testo: string) => boolean {
  const termini = normalizzaRicercaTesto(query).split(/\s+/).filter(Boolean);
  return (testo) => {
    if (!termini.length) return true;
    const normalizzato = normalizzaRicercaTesto(testo);
    return termini.every((termine) => normalizzato.includes(termine));
  };
}

export function corrispondeRicercaTesto(testo: string, query: string): boolean {
  return preparaRicercaTesto(query)(testo);
}
import type { OptionsFilter } from "@mantine/core";


/** Preserva i gruppi e applica il limite dopo la ricerca nell'intero elenco. */
export const filtroOpzioniRicerca: OptionsFilter = ({ options, search, limit }) => {
  const corrisponde = preparaRicercaTesto(search);
  let rimasti = limit;
  const filtra = (elementi: typeof options): typeof options => {
    const risultato: typeof options = [];
    for (const elemento of elementi) {
      if (rimasti <= 0) break;
      if ("group" in elemento) {
        const items = filtra(elemento.items);
        if (items.length) risultato.push({ ...elemento, items } as typeof elemento);
      } else if (corrisponde(elemento.label)) {
        risultato.push(elemento);
        rimasti--;
      }
    }
    return risultato;
  };
  return filtra(options);
};
