// Token e varianti di animazione condivisi (Framer Motion). Vedi UI-SPEC §12.
import type { Variants } from "framer-motion";
import type { CSSProperties } from "react";
import { CHIAVI_PREFERENZE, usePrefs } from "../lib/prefs";

/** Lettura sincrona per gli effetti avviati fuori dal ciclo React. */
export function animazioniRidotteSalvate(): boolean {
  try {
    return JSON.parse(localStorage.getItem(CHIAVI_PREFERENZE.ridurreAnimazioni) || "false") === true;
  } catch {
    return false;
  }
}

/** True se l'utente ha attivato «Riduci animazioni» (Impostazioni).
 *
 * Serve perché `MotionConfig reducedMotion="always"` (in main.tsx) **non** spegne le
 * animazioni di opacità (Framer le considera "sicure"): per onorare davvero la
 * preferenza, i componenti con fade/slide/exit la consultano e degradano a istantaneo. */
export function useAnimazioniRidotte(): boolean {
  return usePrefs().ridurreAnimazioni;
}

// Durate condivise. Tenute volutamente brevi: la transizione tra schermate deve
// risultare presente ma scattante (l'utente la trovava «macchinosa» se più lenta).
export const dur = { xfast: 0.1, fast: 0.13, base: 0.18, tab: 0.18, slow: 0.26 } as const;
/** Switch fra tabelle parallele (Spedizioni e Contabilità): volutamente istantaneo. */
export const durataSwitchTabelleMs = 0;

/** Stile comune alle viste contabili mantenute montate durante il cambio scheda. */
export function stileVistaTabellaParallela(
  nascosta: boolean,
  ridurreAnimazioni: boolean
): CSSProperties {
  return {
    height: "100%",
    opacity: nascosta ? 0 : 1,
    visibility: nascosta ? "hidden" : "visible",
    transition: ridurreAnimazioni ? "none" : `opacity ${durataSwitchTabelleMs}ms ease-out`,
  };
}
export const easeOut = [0.2, 0.8, 0.2, 1] as const;
export const easeInOut = [0.4, 0, 0.2, 1] as const;

// Solo dissolvenza (niente spostamento): per contenuti annidati dentro un contenitore
// che già fa il lift (es. Pagina dentro la transizione di rotta) → evita il doppio
// translate. Usata anche come reveal "fetch-then-render".
export const fadeOnly: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: dur.base, ease: easeOut } },
  exit: { opacity: 0, transition: { duration: dur.fast, ease: easeOut } },
};

// Entrata vista/elemento: fade + leggero slide verso l'alto.
export const fadeSlide: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease: easeOut } },
  exit: { opacity: 0, y: 6, transition: { duration: dur.fast, ease: easeOut } },
};

// Modali/pannelli: fade + zoom soft.
export const fadeZoom: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: { duration: dur.base, ease: easeOut } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: dur.fast, ease: easeOut } },
};

// Toast: slide-in da destra.
export const toastVariants: Variants = {
  initial: { opacity: 0, x: 32, scale: 0.98 },
  animate: { opacity: 1, x: 0, scale: 1, transition: { duration: dur.base, ease: easeOut } },
  exit: { opacity: 0, x: 24, scale: 0.98, transition: { duration: dur.fast, ease: easeOut } },
};

// Riga di lista in stagger (sottile, max ~10 righe poi istantaneo).
export function listItem(i: number) {
  return {
    initial: { opacity: 0, y: 6 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: dur.fast, ease: easeOut, delay: Math.min(i, 10) * 0.02 },
    },
  };
}
