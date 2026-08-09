// Helper data **fuso-locale**. Regola del progetto: per ottenere una stringa Y-M-D da una
// Date NON usare mai `toISOString().slice(0,10)` — converte in UTC e in fuso positivo
// (Italia +1/+2) la mezzanotte locale "torna" al giorno prima. Effetti visti: lo snooze
// «+1 giorno» dei promemoria restituiva la STESSA data; «oggi» a notte fonda risultava ieri;
// il fine-mese dei deep-link dashboard era a -1. Usare queste funzioni.

/** Y-M-D nel fuso LOCALE di una Date. */
export function isoLocale(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const g = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${g}`;
}

/** La data di OGGI (Y-M-D) nel fuso LOCALE. */
export function oggiIso(): string {
  return isoLocale(new Date());
}

/** Data ISO `YYYY-MM-DD` adatta ai nomi file italiani: `GG-MM-AAAA`. */
export function formattaDataFileItaliana(iso: string, fallback = ""): string {
  if (!iso) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** Data ISO `YYYY-MM-DD` resa nello standard visuale italiano dell'app `GG/MM/AAAA`. */
export function formattaDataItaliana(iso: string, fallback = "—"): string {
  if (!iso) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
