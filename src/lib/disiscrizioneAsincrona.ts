export type Disiscrizione = () => void;

/**
 * Collega il cleanup a una sottoscrizione asincrona, evitando listener superstiti
 * quando il chiamante viene smontato prima che la registrazione sia terminata.
 */
export function collegaDisiscrizioneAsincrona(
  promessa: Promise<Disiscrizione>,
): Disiscrizione {
  let attiva = true;
  let disiscrivi: Disiscrizione | undefined;

  void promessa
    .then((fn) => {
      if (attiva) disiscrivi = fn;
      else fn();
    })
    .catch(() => {});

  return () => {
    attiva = false;
    disiscrivi?.();
  };
}
