/** Misura subito un elemento e ripete la misura a ogni variazione delle dimensioni. */
export function osservaRidimensionamento(elemento: Element, misura: () => void): () => void {
  misura();
  const observer = new ResizeObserver(misura);
  observer.observe(elemento);
  return () => observer.disconnect();
}
