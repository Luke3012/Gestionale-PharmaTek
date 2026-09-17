import { useEffect, useRef } from "react";
import type { Event, EventName, UnlistenFn } from "@tauri-apps/api/event";
import { inTauri } from "./tauri";

type Ricarica = () => void | Promise<void>;
type Listen = <T>(event: EventName, handler: (event: Event<T>) => void) => Promise<UnlistenFn>;

export interface PianificatoreRicarica {
  pianifica: () => void;
  eseguiSubito: () => void;
  annulla: () => void;
}

interface OpzioniRicaricaSuEventi {
  caricamentoIniziale?: boolean;
}

/** Crea un refresh immediato o debounced, con cancellazione esplicita allo smontaggio. */
export function creaPianificatoreRicarica(ricarica: Ricarica, ritardoMs?: number): PianificatoreRicarica {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inCorso = false;
  let richiestaDuranteEsecuzione = false;
  let annullata = false;

  const esegui = async () => {
    if (annullata) return;
    if (inCorso) {
      richiestaDuranteEsecuzione = true;
      return;
    }
    inCorso = true;
    try {
      await ricarica();
    } finally {
      inCorso = false;
      if (richiestaDuranteEsecuzione && !annullata) {
        richiestaDuranteEsecuzione = false;
        void esegui();
      }
    }
  };

  return {
    pianifica: () => {
      if (annullata) return;
      if (inCorso) {
        richiestaDuranteEsecuzione = true;
        return;
      }
      if (ritardoMs === undefined) {
        void esegui();
        return;
      }
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void esegui();
      }, ritardoMs);
    },
    eseguiSubito: () => {
      if (annullata) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      void esegui();
    },
    annulla: () => {
      annullata = true;
      richiestaDuranteEsecuzione = false;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Registra la stessa invalidazione su più eventi e restituisce un cleanup idempotente. */
export async function registraRicaricaSuEventi(
  eventi: readonly EventName[],
  ricarica: () => void,
  listen: Listen
): Promise<UnlistenFn> {
  // Dopo una ricostruzione da snapshot/restore ogni proiezione può essere cambiata:
  // tutte le viste che usano questo hook devono quindi invalidarsi, anche se non è
  // disponibile l'elenco puntuale delle entità ricostruite.
  const tuttiGliEventi = [...new Set([...eventi, "pt:proiezione-ricostruita"] as EventName[])];
  const disiscrizioni: UnlistenFn[] = [];
  try {
    for (const evento of tuttiGliEventi) {
      disiscrizioni.push(await listen(evento, ricarica));
    }
  } catch (error) {
    disiscrizioni.forEach((disiscrivi) => disiscrivi());
    throw error;
  }
  let chiusa = false;
  return () => {
    if (chiusa) return;
    chiusa = true;
    disiscrizioni.forEach((disiscrivi) => disiscrivi());
  };
}

/**
 * Mantiene aggiornata una vista in risposta agli eventi Tauri dichiarati dal chiamante.
 * La callback più recente viene usata senza risottoscrivere i listener; l'elenco eventi
 * deve quindi essere una costante stabile del modulo.
 */
export function useRicaricaSuEventi(
  eventi: readonly EventName[],
  ricarica: Ricarica,
  ritardoMs?: number,
  opzioni?: OpzioniRicaricaSuEventi
): void {
  const ricaricaRef = useRef(ricarica);
  ricaricaRef.current = ricarica;

  useEffect(() => {
    let attivo = true;
    let disiscrivi: UnlistenFn | undefined;
    const pianificatore = creaPianificatoreRicarica(() => ricaricaRef.current(), ritardoMs);

    if (!inTauri) {
      if (opzioni?.caricamentoIniziale) pianificatore.eseguiSubito();
      return () => {
        attivo = false;
        pianificatore.annulla();
      };
    }

    void import("@tauri-apps/api/event")
      .then(({ listen }) => registraRicaricaSuEventi(eventi, pianificatore.pianifica, listen))
      .then((cleanup) => {
        if (!attivo) {
          cleanup();
          return;
        }
        disiscrivi = cleanup;
        if (opzioni?.caricamentoIniziale) pianificatore.eseguiSubito();
      })
      .catch((error) => {
        console.error("Sottoscrizione eventi Tauri non riuscita", error);
        if (attivo && opzioni?.caricamentoIniziale) pianificatore.eseguiSubito();
      });

    return () => {
      attivo = false;
      pianificatore.annulla();
      disiscrivi?.();
    };
  }, [eventi, ritardoMs, opzioni?.caricamentoIniziale]);
}
