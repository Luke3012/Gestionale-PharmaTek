import type { Preventivo } from "../../lib/tauri";

export function normalizzaRicerca(valore: string): string {
  return valore
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .trim();
}

/** Verifica se un ordine soddisfa una query di ricerca (numero, data, cliente o medico). */
export function corrispondeRicercaOrdine(
  ordine: Preventivo,
  queryNormalizzata: string,
): boolean {
  if (!queryNormalizzata) return true;
  return normalizzaRicerca(
    [
      ordine.ordineNumero,
      ordine.ordineData,
      ordine.clienteNome,
      ordine.medicoNome,
    ].join(" "),
  ).includes(queryNormalizzata);
}

/** La lista iniziale segue l'anno di lavoro; una ricerca esplicita usa l'intero dominio. */
export function ordiniVisibiliPerPreventivo(
  disponibili: Preventivo[],
  anno: number,
  ricerca: string,
  limite = 80,
): Preventivo[] {
  const query = normalizzaRicerca(ricerca);
  const filtrati = query
    ? disponibili.filter((ordine) => corrispondeRicercaOrdine(ordine, query))
    : disponibili.filter(
        (ordine) =>
          anno === 0 || Number(ordine.ordineData.slice(0, 4)) === anno,
      );
  return filtrati.slice(0, limite);
}
