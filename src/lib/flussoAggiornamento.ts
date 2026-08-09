export interface DipendenzeInstallazioneConRiavvio<T> {
  preparaRiavvio: () => Promise<void>;
  installa: () => Promise<T>;
  riavvia: () => Promise<unknown>;
  annullaRiavvio: () => Promise<void>;
}

/**
 * Prepara l'intenzione PRIMA di avviare l'installer: su Windows l'installer puo'
 * terminare il processo chiamante e il codice successivo potrebbe non essere mai
 * eseguito. Se qualcosa fallisce mentre il processo e' ancora vivo, elimina il
 * marker per non influenzare un avvio futuro non collegato all'aggiornamento.
 */
export async function installaConRiavvioPreparato<T>(
  dipendenze: DipendenzeInstallazioneConRiavvio<T>
): Promise<T> {
  await dipendenze.preparaRiavvio();
  let installazioneCompletata = false;
  try {
    const risultato = await dipendenze.installa();
    installazioneCompletata = true;
    await dipendenze.riavvia();
    return risultato;
  } catch (errore) {
    // Se l'installer e' gia' partito ma il relaunch fallisce, il marker deve
    // restare: al prossimo avvio applichera' comunque la visibilita' richiesta.
    if (!installazioneCompletata) {
      await dipendenze.annullaRiavvio().catch(() => {});
    }
    throw errore;
  }
}
