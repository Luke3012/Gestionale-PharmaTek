// Genera la libreria di suoni di notifica bundlati (FASE 6D).
//
// Sintetizza piccoli WAV (mono 16-bit PCM, 44.1 kHz) — niente dipendenze, niente
// download a runtime: i suoni sono inclusi nell'app e funzionano offline. Rigenerali
// con:  node scripts/gen-sounds.mjs
//
// Obiettivo: suoni *gradevoli*, non beep da sintetizzatore. Usiamo timbri campanari
// con **parziali inarmonici** (come campane/carillon reali), inviluppi morbidi, un
// filtro passa-basso per togliere durezza e un riverbero leggero (early reflections)
// per dare un po' di "aria". I file finiscono in src/assets/sounds/.
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44_100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "sounds");

const sin = (f, t) => Math.sin(2 * Math.PI * f * t);

/** Inviluppo: attacco morbido (raised-cosine) + decadimento esponenziale. */
function env(t, dur, attack = 0.005, tail = 1) {
  const a = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
  const d = Math.exp((-t / dur) * 5 * tail);
  return a * d;
}

/** Una "campana": fondamentale + parziali inarmonici, ognuno col suo decadimento
 *  (gli acuti svaniscono prima → suono caldo e naturale). */
function campana(f, t, dur, brillantezza = 1) {
  // Rapporti tipici di una campana (Chowning/FM bell): leggermente inarmonici.
  const parz = [
    [1.0, 1.0, 1.0],
    [2.0, 0.6, 1.6],
    [2.76, 0.45, 2.0],
    [4.07, 0.28 * brillantezza, 2.8],
    [5.43, 0.18 * brillantezza, 3.6],
    [6.8, 0.1 * brillantezza, 4.6],
  ];
  let s = 0;
  for (const [r, amp, dec] of parz) s += amp * sin(f * r, t) * Math.exp((-t / dur) * 5 * dec);
  const a = t < 0.005 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.005) : 1;
  return s * a;
}

/** Costruisce un buffer da una funzione voce(t) → ampiezza. */
function rende(dur, voce) {
  const n = Math.floor(SR * dur);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = voce(i / SR);
  return buf;
}

/** Riverbero leggero: poche riflessioni anticipate attenuate (un po' d'aria, niente metallo). */
function riverbero(buf, { mix = 0.22, taps = [37, 63, 97], decay = 0.55 } = {}) {
  const out = Float32Array.from(buf);
  taps.forEach((ms, i) => {
    const off = Math.floor((SR * ms) / 1000);
    const g = mix * Math.pow(decay, i);
    for (let k = 0; k + off < out.length; k++) out[k + off] += buf[k] * g;
  });
  return out;
}

/** Passa-basso a un polo (addolcisce gli acuti). cutoff in Hz. */
function passaBasso(buf, cutoff = 6500) {
  const dt = 1 / SR;
  const rc = 1 / (2 * Math.PI * cutoff);
  const a = dt / (rc + dt);
  const out = new Float32Array(buf.length);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += a * (buf[i] - y);
    out[i] = y;
  }
  return out;
}

/** Normalizza con un piccolo margine + breve fade-out finale (niente click). */
function rifinisci(buf) {
  let max = 1e-6;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const g = 0.9 / max;
  const fade = Math.min(buf.length, Math.floor(SR * 0.02));
  for (let i = 0; i < buf.length; i++) {
    let v = buf[i] * g;
    const fromEnd = buf.length - i;
    if (fromEnd < fade) v *= fromEnd / fade;
    buf[i] = v;
  }
  return buf;
}

/** Sequenza di "campane" (note che partono ognuna al suo offset). */
function sequenza(eventi, dur, brillantezza = 1) {
  const buf = rende(dur, (t) => {
    let s = 0;
    for (const ev of eventi) if (t >= ev.at) s += (ev.gain ?? 1) * campana(ev.f, t - ev.at, ev.dur, ev.b ?? brillantezza);
    return s * 0.5;
  });
  return rifinisci(passaBasso(riverbero(buf)));
}

// Note (Hz)
const N = { A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98 };

// --- Catalogo suoni -------------------------------------------------------
const SUONI = {
  // Campanello: due rintocchi morbidi e caldi (default).
  campanello: () => sequenza([
    { at: 0, f: N.E6, dur: 0.6 },
    { at: 0.12, f: N.B5, dur: 0.75 },
  ], 0.95, 0.9),

  // Cristallo: campanellino acuto e luminoso, due note brillanti.
  cristallo: () => sequenza([
    { at: 0, f: N.C6, dur: 0.5, b: 1.4 },
    { at: 0.09, f: N.G6, dur: 0.7, b: 1.4 },
  ], 0.85, 1.4),

  // Carillon: arpeggio dolce da carillon (3 note ascendenti).
  carillon: () => sequenza([
    { at: 0, f: N.G5, dur: 0.45 },
    { at: 0.11, f: N.B5, dur: 0.45 },
    { at: 0.22, f: N.E6, dur: 0.8 },
  ], 1.05, 1.05),

  // Goccia: "ploc" con una piccola caduta di tono + coda morbida.
  goccia: () => rifinisci(passaBasso(riverbero(rende(0.5, (t) => {
    const f = 1500 * Math.exp(-t * 9) + 320; // glide verso il basso
    return env(t, 0.5, 0.003, 1.1) * (sin(f, t) + 0.25 * sin(2 * f, t)) * 0.8;
  }), { mix: 0.28 }), 5000)),

  // Marimba: due note di legno calde, decadimento rapido.
  marimba: () => sequenza([
    { at: 0, f: N.D5, dur: 0.32, b: 0.5 },
    { at: 0.13, f: N.A5, dur: 0.4, b: 0.5 },
  ], 0.6, 0.5),

  // Trillo: due notine rapide e squillanti (notifica "classica" ma gentile).
  trillo: () => sequenza([
    { at: 0, f: N.A5, dur: 0.28 },
    { at: 0.085, f: N.D6, dur: 0.5 },
  ], 0.7, 1.1),

  // Bolla: "pop" soffice e breve.
  bolla: () => rifinisci(passaBasso(rende(0.24, (t) => {
    const f = 520 + 260 * Math.exp(-t * 26);
    return env(t, 0.24, 0.004, 1.3) * (sin(f, t) + 0.2 * sin(2 * f, t)) * 0.85;
  }), 5500)),
};

// --- Suoni del gioco "Flappy Livio" (FASE 7B) ----------------------------
// Effetti corti e arcade-friendly: niente campane, qui servono blip vivaci.
// Onda quadra addolcita (un filo di seconda armonica per "ciccia"). */
const quadra = (f, t) => Math.tanh(3 * sin(f, t));

/** Glide di frequenza tra due valori (lineare in t/dur). */
function glide(f0, f1, t, dur) {
  return f0 + (f1 - f0) * Math.min(1, t / dur);
}

const GIOCO = {
  // Salto: piccolo "blip" che sale veloce.
  salto: () => rifinisci(passaBasso(rende(0.12, (t) => {
    const f = glide(420, 760, t, 0.1);
    return env(t, 0.12, 0.002, 1.4) * quadra(f, t) * 0.7;
  }), 7000)),

  // Punto: due notine cristalline ascendenti (premio).
  punto: () => rifinisci(passaBasso(rende(0.2, (t) => {
    const a = t < 0.06 ? quadra(880, t) : quadra(1318, t - 0.06);
    return env(t, 0.2, 0.002, 1.2) * a * 0.6;
  }), 8000)),

  // Colpo: "thud" basso e secco con un pizzico di rumore.
  colpo: () => rifinisci(passaBasso(rende(0.22, (t) => {
    const f = glide(240, 90, t, 0.18);
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 30) * 0.4;
    return env(t, 0.22, 0.001, 1.5) * (Math.tanh(2 * sin(f, t)) + noise) * 0.8;
  }), 3200)),

  // Game over: discesa di tre note (trombone triste).
  gameover: () => rifinisci(passaBasso(rende(0.7, (t) => {
    const seq = [330, 262, 196];
    const i = Math.min(2, Math.floor(t / 0.22));
    const lt = t - i * 0.22;
    return env(lt, 0.22, 0.004, 1.1) * quadra(seq[i], lt) * 0.6;
  }), 4500)),
};

/** Scrive un WAV mono 16-bit da un Float32Array [-1,1]. */
function scriviWav(path, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32_767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

mkdirSync(OUT, { recursive: true });
// Pulisci i vecchi .wav per non lasciare orfani quando cambia il catalogo.
for (const f of readdirSync(OUT)) if (f.endsWith(".wav")) rmSync(join(OUT, f));

for (const [nome, gen] of Object.entries(SUONI)) {
  const path = join(OUT, `${nome}.wav`);
  scriviWav(path, gen());
  console.log(`✓ ${nome}.wav`);
}
console.log(`\nGenerati ${Object.keys(SUONI).length} suoni in ${OUT}`);

// Suoni del gioco in una sottocartella dedicata (così la pulizia .wav qui sopra
// non li tocca e restano raggruppati).
const OUT_GIOCO = join(OUT, "game");
mkdirSync(OUT_GIOCO, { recursive: true });
for (const f of readdirSync(OUT_GIOCO)) if (f.endsWith(".wav")) rmSync(join(OUT_GIOCO, f));
for (const [nome, gen] of Object.entries(GIOCO)) {
  scriviWav(join(OUT_GIOCO, `${nome}.wav`), gen());
  console.log(`✓ game/${nome}.wav`);
}
console.log(`Generati ${Object.keys(GIOCO).length} suoni gioco in ${OUT_GIOCO}`);
