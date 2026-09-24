// Libreria di suoni di notifica (FASE 6D). I file sono bundlati con l'app
// (generati da scripts/gen-sounds.mjs) → offline-safe, nessun download a runtime.
// La riproduzione avviene dal webview via HTMLAudioElement; la scelta dell'utente
// vive nelle preferenze (`suonoNotifica`).
import campanelloUrl from "../../assets/sounds/campanello.wav";
import cristalloUrl from "../../assets/sounds/cristallo.wav";
import carillonUrl from "../../assets/sounds/carillon.wav";
import gocciaUrl from "../../assets/sounds/goccia.wav";
import marimbaUrl from "../../assets/sounds/marimba.wav";
import trilloUrl from "../../assets/sounds/trillo.wav";
import bollaUrl from "../../assets/sounds/bolla.wav";

type SuonoId =
  | "nessuno"
  | "campanello"
  | "cristallo"
  | "carillon"
  | "goccia"
  | "marimba"
  | "trillo"
  | "bolla";

export interface SuonoDef {
  value: SuonoId;
  label: string;
  /** URL dell'asset, `null` per «nessuno». */
  url: string | null;
}

export const SUONI: SuonoDef[] = [
  { value: "campanello", label: "Campanello", url: campanelloUrl },
  { value: "cristallo", label: "Cristallo", url: cristalloUrl },
  { value: "carillon", label: "Carillon", url: carillonUrl },
  { value: "goccia", label: "Goccia", url: gocciaUrl },
  { value: "marimba", label: "Marimba", url: marimbaUrl },
  { value: "trillo", label: "Trillo", url: trilloUrl },
  { value: "bolla", label: "Bolla", url: bollaUrl },
  { value: "nessuno", label: "Nessuno", url: null },
];

function suonoDef(value: string): SuonoDef {
  return SUONI.find((s) => s.value === value) ?? SUONI[0];
}

// Riproduzione via **Web Audio API**, non `HTMLAudioElement`: quest'ultimo, riusato con
// `currentTime = 0` + `play()`, su WebView2 produce un crepitio/«gracchio». Con Web Audio
// decodifichiamo il buffer UNA volta (cache) e suoniamo una `BufferSource` nuova ad ogni
// notifica → attacco pulito, nessun pop, e i suoni ravvicinati non si disturbano.
let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();

function audioCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  } catch {
    return null;
  }
}

async function buffer(c: AudioContext, url: string): Promise<AudioBuffer | null> {
  const hit = buffers.get(url);
  if (hit) return hit;
  try {
    const arr = await (await fetch(url)).arrayBuffer();
    const buf = await c.decodeAudioData(arr);
    buffers.set(url, buf);
    return buf;
  } catch {
    return null;
  }
}

/** Riproduce il suono scelto (no-op se «nessuno»). `volume` 0..1. */
export function riproduciSuono(id: string, volume = 0.6): void {
  const def = suonoDef(id);
  if (!def.url) return;
  const c = audioCtx();
  if (!c) return;

  const suona = (buf: AudioBuffer) => {
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(gain).connect(c.destination);
    src.start();
  };

  const playAfterResume = () => {
    void buffer(c, def.url!).then((buf) => {
      if (!buf) return;
      suona(buf);
    });
  };

  if (c.state === "suspended") {
    c.resume()
      .then(playAfterResume)
      .catch(() => {
        // Ripiego: proviamo comunque a suonare
        playAfterResume();
      });
  } else {
    playAfterResume();
  }
}

// Precaricamento ed auto-resume all'interazione dell'utente
if (typeof window !== "undefined") {
  const resumeContext = () => {
    const c = audioCtx();
    if (c) {
      if (c.state === "suspended") {
        c.resume()
          .then(() => {
            if (c.state === "running") {
              window.removeEventListener("click", resumeContext);
              window.removeEventListener("keydown", resumeContext);
              window.removeEventListener("touchstart", resumeContext);
            }
          })
          .catch(() => {});
      } else if (c.state === "running") {
        window.removeEventListener("click", resumeContext);
        window.removeEventListener("keydown", resumeContext);
        window.removeEventListener("touchstart", resumeContext);
      }
    }
  };
  window.addEventListener("click", resumeContext, { passive: true });
  window.addEventListener("keydown", resumeContext, { passive: true });
  window.addEventListener("touchstart", resumeContext, { passive: true });

  // Avviamo il precaricamento e la decodifica dei buffer audio in background dopo l'avvio
  setTimeout(() => {
    try {
      const c = audioCtx();
      if (c) {
        SUONI.forEach((s) => {
          if (s.url) {
            void buffer(c, s.url).catch(() => {});
          }
        });
      }
    } catch {}
  }, 100);
}
