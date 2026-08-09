// Mini-fioriture "nel punto" (FASE 7C): piccole animazioni inline e non invasive che
// scattano dove hai cliccato e si dissolvono da sole (pointer-events: none, nessun modale).
// Tre tipi:
//  • moneta → incasso (€ dorato + spunta) — `mostraMonetina()`;
//  • pacco  → «Arrivato in Italia» (scatolino che atterra + spunta) — `mostraFlourish("pacco")`;
//  • beuta  → «In produzione» (beuta da laboratorio che borbotta) — `mostraFlourish("beuta")`.
// Event-based: il chiamante lancia, l'host (montato una volta in main) disegna. Ritornano
// `true` se l'animazione partirà (così il chiamante può omettere il toast, che la coprirebbe);
// `false` con «Riduci animazioni». Una «beuta» = la "beuta produzione" del piano FASE 7C.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { IconCheck, IconFlask2, IconPackage } from "@tabler/icons-react";

const EVENTO = "pt:flourish-punto";

export type FlourishTipo = "moneta" | "pacco" | "beuta";

let ultimoClick = { x: 0, y: 0 };
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      ultimoClick = { x: e.clientX, y: e.clientY };
    },
    { capture: true, passive: true }
  );
}

function animazioniRidotte(): boolean {
  try {
    return JSON.parse(localStorage.getItem("pt.ridurreAnimazioni") || "false") === true;
  } catch {
    return false;
  }
}

function lancia(tipo: FlourishTipo, from?: { x: number; y: number }): boolean {
  if (typeof window === "undefined" || animazioniRidotte()) return false;
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { tipo, ...(from ?? ultimoClick) } }));
  return true;
}

/** Monetina dell'incasso (€). */
export function mostraMonetina(from?: { x: number; y: number }): boolean {
  return lancia("moneta", from);
}

/** Fioritura generica nel punto (pacco arrivato / beuta in produzione / moneta). */
export function mostraFlourish(tipo: FlourishTipo, from?: { x: number; y: number }): boolean {
  return lancia(tipo, from);
}

interface Pop {
  id: number;
  x: number;
  y: number;
  tipo: FlourishTipo;
}

/** Host globale (montato una volta in main): disegna le fioriture in un portal su body. */
export function MonetinaHost() {
  const [pops, setPops] = useState<Pop[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { tipo: FlourishTipo; x: number; y: number };
      setPops((p) => [...p, { id: idRef.current++, x: d.x, y: d.y, tipo: d.tipo }]);
    };
    window.addEventListener(EVENTO, on);
    return () => window.removeEventListener(EVENTO, on);
  }, []);

  if (typeof document === "undefined" || pops.length === 0) return null;

  return createPortal(
    <AnimatePresence>
      {pops.map((p) => (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, scale: p.tipo === "pacco" ? 0.6 : 0.4, y: p.tipo === "pacco" ? -14 : 0 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [p.tipo === "pacco" ? 0.6 : 0.4, 1.15, 1, 1], y: [0, -28, -40, -52] }}
          transition={{ duration: 1.1, ease: "easeOut", times: [0, 0.25, 0.6, 1] }}
          onAnimationComplete={() => setPops((cur) => cur.filter((c) => c.id !== p.id))}
          style={{
            position: "fixed",
            left: p.x - 16,
            top: p.y - 16,
            zIndex: 4000,
            pointerEvents: "none",
            width: 32,
            height: 32,
          }}
        >
          <Disegno tipo={p.tipo} />
        </motion.div>
      ))}
    </AnimatePresence>,
    document.body
  );
}

function Disegno({ tipo }: { tipo: FlourishTipo }) {
  if (tipo === "beuta") {
    // Beuta da laboratorio che "borbotta": bollicine che salgono dall'icona.
    return (
      <div style={{ position: "relative", width: 32, height: 32 }}>
        <Cerchio bg="radial-gradient(circle at 35% 30%, #c3fae8, #20c997 75%, #0ca678)" colore="#0b6e54">
          <IconFlask2 size={18} />
        </Cerchio>
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 0], y: [-2, -12, -20], scale: [0.6, 1, 0.5] }}
            transition={{ duration: 0.9, delay: 0.1 + i * 0.18, ease: "easeOut" }}
            style={{
              position: "absolute",
              left: 8 + i * 6,
              top: 4,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--mantine-color-teal-3)",
            }}
          />
        ))}
      </div>
    );
  }
  if (tipo === "pacco") {
    return (
      <SpuntaSu>
        <Cerchio bg="radial-gradient(circle at 35% 30%, #ffe8cc, #e8a857 72%, #b87f33)" colore="#7a5018">
          <IconPackage size={18} />
        </Cerchio>
      </SpuntaSu>
    );
  }
  // moneta
  return (
    <SpuntaSu>
      <Cerchio bg="radial-gradient(circle at 35% 30%, #ffe9a3, #e7b425 70%, #b8860b)" colore="#7a5b00">
        <span style={{ fontWeight: 800, fontSize: 16 }}>€</span>
      </Cerchio>
    </SpuntaSu>
  );
}

function Cerchio({ bg, colore, children }: { bg: string; colore: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: bg,
        border: "1px solid rgba(0,0,0,.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colore,
        boxShadow: "0 2px 8px rgba(0,0,0,.18)",
      }}
    >
      {children}
    </div>
  );
}

/** Avvolge un disegno con una mini-spunta verde che fa "pop" in basso a destra. */
function SpuntaSu({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "relative", width: 32, height: 32 }}>
      {children}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.18, type: "spring", stiffness: 520, damping: 16 }}
        style={{
          position: "absolute",
          right: -4,
          bottom: -4,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--mantine-color-teal-6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconCheck size={11} color="#fff" stroke={3} />
      </motion.div>
    </div>
  );
}
