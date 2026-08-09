// Frecency personale per la ricerca globale: ricorda cosa apri più spesso e più di
// recente per proporlo in cima a barra vuota. "Super-ottimizzato": una sola voce in
// localStorage, punteggio a decadimento esponenziale aggiornato in O(1) per evento e
// O(k log k) per la classifica. Nessun backend, nessuna dipendenza: per-dispositivo.
//
// Modello: per ogni chiave (id della voce di ricerca) teniamo { s, t } = punteggio e
// istante dell'ultimo uso. A ogni uso il punteggio si "raffredda" fino a ora e poi +1,
// così frequenza e recenza pesano insieme (emivita ~14 giorni). In classifica il
// punteggio è di nuovo raffreddato a ora, per essere equi fra voci viste in momenti diversi.

const KEY = "pt.frecency";
const EMIVITA_MS = 14 * 86_400_000; // 14 giorni
const MAX_VOCI = 120; // tetto: la mappa resta piccola e veloce
const SOGLIA = 0.04; // sotto questa soglia (decaduta) la voce è "dimenticata"

interface Voce {
  s: number;
  t: number;
}
type Mappa = Record<string, Voce>;

function carica(): Mappa {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Mappa) : {};
  } catch {
    return {};
  }
}

function salva(m: Mappa) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* best-effort */
  }
}

/** Punteggio raffreddato a `ora`. */
function decaduto(v: Voce, ora: number): number {
  return v.s * Math.pow(0.5, (ora - v.t) / EMIVITA_MS);
}

/** Registra un uso della voce `chiave` (chiamato quando la si esegue dalla ricerca). */
export function registraUso(chiave: string): void {
  if (!chiave) return;
  const m = carica();
  const ora = Date.now();
  const prec = m[chiave];
  m[chiave] = { s: (prec ? decaduto(prec, ora) : 0) + 1, t: ora };

  // Potatura: se la mappa cresce troppo, tieni solo le voci più "calde".
  const chiavi = Object.keys(m);
  if (chiavi.length > MAX_VOCI) {
    const ordinate = chiavi.sort((a, b) => decaduto(m[b], ora) - decaduto(m[a], ora)).slice(0, MAX_VOCI);
    const ridotta: Mappa = {};
    for (const k of ordinate) ridotta[k] = m[k];
    salva(ridotta);
    return;
  }
  salva(m);
}

/** Le prime `n` chiavi per frecency (uso + recenza), più calde in testa. */
export function chiaviTop(n: number): string[] {
  const m = carica();
  const ora = Date.now();
  return Object.keys(m)
    .map((k) => [k, decaduto(m[k], ora)] as const)
    .filter(([, sc]) => sc >= SOGLIA)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}
