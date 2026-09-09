import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface PopoverVerticalLayout {
  position: "bottom-end" | "top-end";
  maxHeight: string;
}

/** Aggiorna un layout ancorato all'apertura e a ogni ridimensionamento della finestra. */
export function useAggiornaLayoutPopover(aperto: boolean, aggiornaLayout: () => void) {
  useLayoutEffect(() => {
    if (!aperto) return;
    aggiornaLayout();
    const frame = window.requestAnimationFrame(aggiornaLayout);
    window.addEventListener("resize", aggiornaLayout);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", aggiornaLayout);
    };
  }, [aperto, aggiornaLayout]);
}

export function calcolaPopoverVerticalLayout(
  rect: Pick<DOMRect, "top" | "bottom">,
  viewportHeight: number
): PopoverVerticalLayout {
  const padding = 12;
  const footerEHeader = 64;
  const spazioSotto = viewportHeight - rect.bottom - padding;
  const spazioSopra = rect.top - padding;
  const sotto = spazioSotto >= 400 || spazioSotto >= spazioSopra;
  const spazioVerticale = Math.max(180, (sotto ? spazioSotto : spazioSopra) - footerEHeader);

  return {
    position: sotto ? "bottom-end" : "top-end",
    maxHeight: `${Math.min(520, Math.floor(spazioVerticale))}px`,
  };
}

/** Posizione e altezza adattive condivise dai popover azionati da un bottone. */
export function usePopoverVerticalLayout(aperto: boolean) {
  const targetRef = useRef<HTMLButtonElement | null>(null);
  const [layout, setLayout] = useState<PopoverVerticalLayout>({
    position: "bottom-end",
    maxHeight: "70vh",
  });

  const aggiornaLayout = useCallback(() => {
    const rect = targetRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
    setLayout(calcolaPopoverVerticalLayout(rect, viewportHeight));
  }, []);

  useAggiornaLayoutPopover(aperto, aggiornaLayout);

  return { targetRef, layout };
}
