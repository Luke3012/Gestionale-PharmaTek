/** Restituisce una nuova copia del Set aggiungendo o rimuovendo il valore indicato. */
export function setConToggle<T>(corrente: Iterable<T>, valore: T): Set<T> {
  const prossimo = new Set(corrente);
  if (prossimo.has(valore)) prossimo.delete(valore);
  else prossimo.add(valore);
  return prossimo;
}
