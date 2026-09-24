// Sistema di changelog (FASE 7C). Sorgente unica: `changelog.json` (una sezione per
// versione, dalla più recente alla prima). Lo stesso file alimenta:
//   • il pannello «Novità» mostrato all'avvio dopo un aggiornamento (NovitaPanel);
//   • lo storico nella finestra Info (StoricoChangelog);
//   • le note dell'updater e della release GitHub (scripts/release.ps1 legge questo file).
// Si modifica facilmente con l'editor grafico: `scripts/changelog.ps1`.
import dati from "./changelog.json";

export type Categoria = "novita" | "correzioni" | "altro";

export interface VoceChangelog {
  categoria: Categoria;
  testo: string;
}

export interface VersioneChangelog {
  versione: string;
  /** Data ISO `yyyy-mm-dd`. */
  data: string;
  /** Riga di sintesi: usata nella notifica di aggiornamento e come sottotitolo. */
  sintesi: string;
  /** Dettaglio per categoria. Se VUOTO, la versione NON apre il pannello «Novità»
   *  (resta solo nello storico e nel toast di aggiornamento). */
  voci: VoceChangelog[];
}

/** Confronto semver discendente (più recente prima). */
function confrontaDesc(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Tutte le versioni, dalla più recente alla prima. */
export const VERSIONI: VersioneChangelog[] = [
  ...((dati as { versioni: VersioneChangelog[] }).versioni ?? []),
].sort((a, b) => confrontaDesc(a.versione, b.versione));


/** Chiave localStorage: ultima versione di cui l'utente ha già visto le novità. */
const CHIAVE_VISTO = "pt.changelogVisto";

export function versioneVista(): string | null {
  try {
    return localStorage.getItem(CHIAVE_VISTO);
  } catch {
    return null;
  }
}

export function segnaVista(versione: string): void {
  try {
    localStorage.setItem(CHIAVE_VISTO, versione);
  } catch {
    /* localStorage non disponibile: al massimo il pannello potrebbe ricomparire */
  }
}

/**
 * Decide se mostrare il pannello «Novità» per la versione corrente.
 * Restituisce la voce changelog se va mostrato il pannello, altrimenti `null`.
 * NON mostra nulla (e non ha effetti collaterali) se:
 *   • è già stata vista questa versione;
 *   • è il PRIMO avvio in assoluto (chiave assente): non disturbiamo chi installa ora;
 *   • la versione non è documentata o ha solo la sintesi (`voci` vuoto).
 * La marcatura di "vista" la fa il chiamante (gate) quando chiude il pannello o quando
 * non c'è nulla da mostrare, così la stessa versione non riprova al riavvio.
 */
export function novitaDaMostrare(versioneCorrente: string): VersioneChangelog[] | null {
  const vista = versioneVista();
  if (vista === versioneCorrente) return null;
  // Primo avvio assoluto: allineiamo il "visto" senza mostrare nulla.
  if (vista === null) return null;

  // Filtra le versioni rilasciate dopo 'vista' e fino a 'versioneCorrente' inclusive.
  // VERSIONI è già ordinata decrescente.
  const unseen = VERSIONI.filter((v) => {
    const isDopoVista = confrontaDesc(v.versione, vista) < 0; // v.versione > vista
    const isFinoACorrente = confrontaDesc(v.versione, versioneCorrente) >= 0; // v.versione <= versioneCorrente
    return isDopoVista && isFinoACorrente && v.voci.length > 0;
  });

  if (unseen.length === 0) return null;
  return unseen;
}
