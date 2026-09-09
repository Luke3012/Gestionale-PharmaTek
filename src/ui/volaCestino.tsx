// «Vola nel cestino» (FASE 7C): quando un elemento viene spostato nel Cestino, un piccolo
// fantasmino (icona cestino) parte dal punto del clic e vola fino all'icona del Cestino in
// topbar, che poi "rimbalza" per dire «ricevuto». Decoupling via CustomEvent/Tauri Event: chi elimina
// chiama `volaNelCestino()` e non deve sapere dov'è l'icona; l'icona (CestinoPopover) ascolta
// con `useVoloCestino`. Rispetta «Riduci animazioni» (solo un rimbalzo, niente volo).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { IconTrash } from "@tabler/icons-react";
import { inTauri } from "../lib/tauri";
import { animazioniRidotteSalvate } from "./motion";
import { ultimoPuntoPointer, type PuntoPointer } from "./ultimoPuntoPointer";

const EVENTO = "pt:vola-cestino";

export type PuntoVoloCestino = PuntoPointer;

type SorgenteVolo =
  | HTMLElement
  | {
      clientX?: number;
      clientY?: number;
      currentTarget?: EventTarget | null;
    }
  | null
  | undefined;

/** Cattura subito il punto di partenza del volo, prima che dialog/modal asincroni
 *  spostino l'ultimo click sul bottone di conferma. */
export function catturaOrigineCestino(src?: SorgenteVolo): PuntoVoloCestino {
  if (typeof window === "undefined") return { x: 0, y: 0 };

  if (src instanceof HTMLElement) {
    const r = src.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  const ev = src as Exclude<SorgenteVolo, HTMLElement>;
  if (ev?.currentTarget instanceof HTMLElement) {
    const r = ev.currentTarget.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  if (typeof ev?.clientX === "number" && typeof ev?.clientY === "number") {
    return { x: ev.clientX, y: ev.clientY };
  }

  return ultimoPuntoPointer();
}

/** Lancia l'animazione «vola nel cestino». Chiamala subito dopo aver spostato un elemento nel
 *  Cestino (soft-delete). Sorgente: un punto esplicito o, di default, l'ultimo clic.
 *  Ritorna `true` se l'animazione partirà (così il chiamante può **omettere il toast**, che la
 *  coprirebbe); `false` con «Riduci animazioni» → il chiamante mostri pure il toast di conferma. */
export function volaNelCestino(from?: PuntoVoloCestino): boolean {
  if (typeof window === "undefined" || animazioniRidotteSalvate()) return false;
  const targetFrom = from ?? ultimoPuntoPointer();

  // Calcoliamo la coordinata assoluta sullo schermo per la traduzione cross-window
  const screenX = window.screenX + targetFrom.x;
  const screenY = window.screenY + targetFrom.y;

  if (inTauri) {
    import("@tauri-apps/api/event").then(({ emit }) => {
      emit(EVENTO, { x: screenX, y: screenY }).catch(() => {});
    });
  } else {
    // Fallback locale per browser
    window.dispatchEvent(new CustomEvent(EVENTO, { detail: targetFrom }));
  }
  return true;
}

interface Volo {
  id: number;
  x: number;
  y: number;
}

/** Da usare sull'icona del Cestino: ascolta i voli, restituisce il `portal` con i fantasmini
 *  che volano e un contatore `rimbalzo` che scatta a ogni arrivo (per far "ricevere" l'icona). */
export function useVoloCestino(iconRef: React.RefObject<HTMLElement | null>, ridotte: boolean) {
  const [voli, setVoli] = useState<Volo[]>([]);
  const [rimbalzo, setRimbalzo] = useState(0);
  const idRef = useRef(0);

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    if (inTauri) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen(EVENTO, (event) => {
          const d = event.payload as { x: number; y: number };
          // Traduciamo la coordinata schermo di nuovo in coordinate client relative alla finestra corrente (main)
          const clientX = d.x - window.screenX;
          const clientY = d.y - window.screenY;

          if (ridotte) {
            setRimbalzo((b) => b + 1);
            return;
          }
          setVoli((v) => [...v, { id: idRef.current++, x: clientX, y: clientY }]);
        }).then((unlisten) => {
          unlistenFn = unlisten;
        });
      });
    } else {
      const onVola = (e: Event) => {
        const d = (e as CustomEvent).detail as { x: number; y: number };
        if (ridotte) {
          setRimbalzo((b) => b + 1);
          return;
        }
        setVoli((v) => [...v, { id: idRef.current++, x: d.x, y: d.y }]);
      };
      window.addEventListener(EVENTO, onVola);
      unlistenFn = () => window.removeEventListener(EVENTO, onVola);
    }

    return () => {
      unlistenFn?.();
    };
  }, [ridotte]);

  const bersaglio = () => {
    const el = iconRef.current;
    if (!el) return { x: window.innerWidth - 40, y: 24 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const portal =
    voli.length > 0 && typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            {voli.map((v) => {
              const t = bersaglio();
              return (
                <motion.div
                  key={v.id}
                  initial={{ x: v.x - 12, y: v.y - 12, scale: 1, opacity: 0.95 }}
                  animate={{ x: t.x - 12, y: t.y - 12, scale: 0.22, opacity: 0.12 }}
                  transition={{ duration: 0.62, ease: [0.5, 0, 0.75, 0.25] }}
                  onAnimationComplete={() => {
                    setVoli((cur) => cur.filter((c) => c.id !== v.id));
                    setRimbalzo((b) => b + 1);
                  }}
                  style={{
                    position: "fixed",
                    left: 0,
                    top: 0,
                    zIndex: 4000,
                    pointerEvents: "none",
                    color: "var(--mantine-color-red-6)",
                  }}
                >
                  <IconTrash size={24} />
                </motion.div>
              );
            })}
          </AnimatePresence>,
          document.body
        )
      : null;

  return { portal, rimbalzo };
}
