import { useLayoutEffect, type RefObject } from "react";

export interface LeggiColonnaCompatta {
  (
    selector: string,
    ghost: HTMLSpanElement | null,
    fallbackAccessor?: string
  ): boolean | null;
}

export function richiedeColonnaCompatta(
  larghezzaContenuto: number,
  larghezzaCella: number,
  paddingOrizzontale: number
): boolean {
  return larghezzaContenuto > larghezzaCella - paddingOrizzontale + 1;
}

/**
 * Unico observer per i provider che decidono se mostrare badge completi o compatti.
 * Mantiene il debounce e la rimisurazione post-resize già usati dalle tabelle.
 */
export function useCompactColumnObserver(
  rootRef: RefObject<HTMLElement | null>,
  misuraColonne: (leggi: LeggiColonnaCompatta) => void,
  refreshKey = "",
  sospesa?: () => boolean
) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const paddingCache = new Map<HTMLElement, number>();
    const paddingOrizzontale = (element: HTMLElement): number => {
      const cached = paddingCache.get(element);
      if (cached !== undefined) return cached;
      const style = getComputedStyle(element);
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      paddingCache.set(element, padding);
      return padding;
    };

    const leggi: LeggiColonnaCompatta = (selector, ghost, fallbackAccessor) => {
      if (!ghost) return null;
      const cella = (root.querySelector(selector) ?? (fallbackAccessor
        ? root.querySelector(`th[data-accessor="${fallbackAccessor}"]`)
        : null)) as HTMLElement | null;
      const contenitore = (cella?.closest("td") as HTMLElement | null) ?? cella;
      if (!contenitore || contenitore.clientWidth === 0) return null;
      return richiedeColonnaCompatta(
        ghost.getBoundingClientRect().width,
        contenitore.clientWidth,
        paddingOrizzontale(contenitore)
      );
    };

    const misura = () => {
      if (sospesa?.()) return;
      misuraColonne(leggi);
    };

    misura();
    const frame = requestAnimationFrame(misura);
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(misura, 140);
    });
    observer.observe(root);

    const handlePointerUp = () => setTimeout(misura, 50);
    window.addEventListener("pointerup", handlePointerUp, true);
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("pointerup", handlePointerUp, true);
    };
  }, [rootRef, misuraColonne, refreshKey, sospesa]);
}
