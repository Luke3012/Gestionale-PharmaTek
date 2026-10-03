/** Accorpa gli eventi dell'overlay senza sovrapporre letture dell'outbox. */
export function creaAggiornamentiCampagne<T>(
  leggi: () => Promise<T>,
  applica: (campagnaId: string, snapshot: T) => void,
  ritardoMs = 100,
) {
  const versioni = new Map<string, number>();
  const pendenti = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inCorso = false;
  let chiuso = false;

  const pianifica = () => {
    if (chiuso || inCorso || timer !== undefined || !pendenti.size) return;
    timer = setTimeout(() => void aggiorna(), ritardoMs);
  };

  const aggiorna = async () => {
    timer = undefined;
    const richieste = new Map(pendenti);
    pendenti.clear();
    inCorso = true;
    try {
      const snapshot = await leggi();
      if (chiuso) return;
      for (const [id, versione] of richieste) {
        // Un evento arrivato durante la lettura richiede un nuovo snapshot.
        if (versioni.get(id) === versione) applica(id, snapshot);
      }
    } catch {
      // Una lettura fallita non cancella le notifiche già corrette.
      // Un nuovo evento potrà richiedere un aggiornamento.
    } finally {
      inCorso = false;
      pianifica();
    }
  };

  return {
    richiedi(campagnaId: string) {
      if (chiuso) return;
      const versione = (versioni.get(campagnaId) ?? 0) + 1;
      versioni.set(campagnaId, versione);
      pendenti.set(campagnaId, versione);
      pianifica();
    },
    async caricaIniziale(applicaIniziale: (snapshot: T, pendenti: Set<string>) => void) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      inCorso = true;
      try {
        const snapshot = await leggi();
        if (!chiuso) applicaIniziale(snapshot, new Set(pendenti.keys()));
      } catch {
        // Anche dopo un errore iniziale gli eventi successivi restano elaborabili.
      } finally {
        inCorso = false;
        pianifica();
      }
    },
    chiudi() {
      chiuso = true;
      if (timer !== undefined) clearTimeout(timer);
      pendenti.clear();
      versioni.clear();
    },
  };
}

/** Lo snapshot iniziale non deve sostituire stati già aggiornati dagli eventi. */
export function filtraSnapshotIniziale<T extends { id: string; campagnaId?: string }>(
  snapshot: T[],
  eventiRicevuti: Set<string>,
  campagnePendenti: Set<string>,
  campagneSilenziose: Set<string>,
): T[] {
  return snapshot.filter((item) =>
    !eventiRicevuti.has(item.id) &&
    !campagnePendenti.has(item.campagnaId ?? "") &&
    !campagneSilenziose.has(item.campagnaId ?? ""),
  );
}
