// Suoni del gioco "Flappy Livio" (FASE 7B). Bundlati con l'app (generati da
// scripts/gen-sounds.mjs in src/assets/sounds/game/) → offline, niente download.
// Riprodotti dal webview con un piccolo pool di Audio per non tagliare i suoni
// ravvicinati (es. salti in rapida successione).
import saltoUrl from "../../assets/sounds/game/salto.wav";
import puntoUrl from "../../assets/sounds/game/punto.wav";
import colpoUrl from "../../assets/sounds/game/colpo.wav";
import gameoverUrl from "../../assets/sounds/game/gameover.wav";

export type SuonoGioco = "salto" | "punto" | "colpo" | "gameover";

const URL: Record<SuonoGioco, string> = {
  salto: saltoUrl,
  punto: puntoUrl,
  colpo: colpoUrl,
  gameover: gameoverUrl,
};

// Pool di cloni per suono: i salti ravvicinati non si troncano a vicenda.
const POOL = 4;
const pool = new Map<SuonoGioco, HTMLAudioElement[]>();
const indice = new Map<SuonoGioco, number>();

function prepara(id: SuonoGioco): HTMLAudioElement[] {
  let voci = pool.get(id);
  if (!voci) {
    voci = Array.from({ length: POOL }, () => {
      const a = new Audio(URL[id]);
      a.preload = "auto";
      a.volume = 0.45;
      return a;
    });
    pool.set(id, voci);
    indice.set(id, 0);
  }
  return voci;
}

/** Riproduce un suono del gioco (no-op se `muto`). */
export function suonaGioco(id: SuonoGioco, muto = false): void {
  if (muto) return;
  try {
    const voci = prepara(id);
    const i = (indice.get(id) ?? 0) % voci.length;
    indice.set(id, i + 1);
    const a = voci[i];
    a.currentTime = 0;
    void a.play()?.catch(() => {});
  } catch {
    /* audio non disponibile: il gioco resta giocabile */
  }
}

/** Precarica gli asset (chiamato all'apertura della finestra Info). */
export function precaricaSuoniGioco(): void {
  (Object.keys(URL) as SuonoGioco[]).forEach(prepara);
}
