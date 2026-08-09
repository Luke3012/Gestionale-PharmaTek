import { useEffect } from "react";

export const CLOSE_FLOATING_UI_EVENT = "pt:close-floating-ui";
export const BLOCKING_VIEW_SELECTOR = "[data-pt-blocking-view]";

export function vistaBloccanteAttiva(): boolean {
  return typeof document !== "undefined" && document.querySelector(BLOCKING_VIEW_SELECTOR) !== null;
}

/**
 * Hook per chiudere un Popover/Menu quando l'utente scrolla all'esterno.
 */
export function useCloseOnScroll(aperto: boolean, setAperto: (v: boolean) => void) {
  useEffect(() => {
    if (!aperto) return;
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      // Se lo scroll avviene dentro il dropdown stesso, non chiudiamo.
      if (target && (target.closest(".mantine-Popover-dropdown") || target.closest(".mantine-Menu-dropdown"))) return;
      setAperto(false);
    };
    const handleClose = () => setAperto(false);
    window.addEventListener("scroll", handleScroll, true);
    document.addEventListener(CLOSE_FLOATING_UI_EVENT, handleClose);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener(CLOSE_FLOATING_UI_EVENT, handleClose);
    };
  }, [aperto, setAperto]);
}

/**
 * Comportamento comune dei popover controllati: ESC chiude, così come uno scroll
 * esterno al relativo dropdown. Non intercetta gli scroll del contenuto interno.
 */
export function useDismissPopover(aperto: boolean, setAperto: (v: boolean) => void) {
  useEffect(() => {
    if (!aperto) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAperto(false);
    };
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest(".mantine-Popover-dropdown")) return;
      setAperto(false);
    };
    window.addEventListener("keydown", handleEsc);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("keydown", handleEsc);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [aperto, setAperto]);
}
