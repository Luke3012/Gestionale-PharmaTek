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

/** Data ISO `YYYY-MM-DD` interpretata a mezzogiorno nel fuso locale. */
export function dataIsoLocale(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

/** Somma giorni di calendario a una data ISO, senza conversioni UTC. */
export function aggiungiGiorniIso(iso: string, giorni: number): string {
  const data = dataIsoLocale(iso);
  data.setDate(data.getDate() + giorni);
  return isoLocale(data);
}

/** Somma giorni usando la data locale odierna quando il valore di partenza è vuoto. */
export function aggiungiGiorniDaOggiIso(iso: string, giorni: number): string {
  return aggiungiGiorniIso(iso || oggiIso(), giorni);
}

/** Somma mesi mantenendo il giorno, limitandolo all'ultimo disponibile nel mese. */
export function aggiungiMesiIso(iso: string, mesi: number): string {
  const data = dataIsoLocale(iso);
  const giorno = data.getDate();
  data.setDate(1);
  data.setMonth(data.getMonth() + mesi);
  const ultimo = new Date(data.getFullYear(), data.getMonth() + 1, 0).getDate();
  data.setDate(Math.min(giorno, ultimo));
  return isoLocale(data);
}

export interface IntervalloIso {
  dal: string;
  al: string;
}

/** Lunedì e domenica della settimana contenente la data ISO. */
export function intervalloSettimanaIso(iso = oggiIso()): IntervalloIso {
  const data = dataIsoLocale(iso);
  const distanzaDaLunedi = (data.getDay() + 6) % 7;
  const dal = aggiungiGiorniIso(iso, -distanzaDaLunedi);
  return { dal, al: aggiungiGiorniIso(dal, 6) };
}

/** Primo e ultimo giorno del mese contenente la data ISO, con offset opzionale. */
export function intervalloMeseIso(iso = oggiIso(), offsetMesi = 0): IntervalloIso {
  const [dal, al] = estremiMeseIso(dataIsoLocale(iso), offsetMesi);
  return { dal, al };
}

const FORMATO_DATA_ORA_BREVE = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "short",
  timeStyle: "short",
});
const FORMATO_DATA_LOCALE = new Intl.DateTimeFormat("it-IT");

/** Formato data predefinito italiano, condiviso senza ricreare il formatter. */
export function formattaDataLocale(valore: Date | number): string {
  return FORMATO_DATA_LOCALE.format(valore);
}

/** Formatta una data ISO completa a mezzogiorno locale, con fallback per input non validi. */
export function formattaDataIsoLocale(iso: string, fallback = ""): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? formattaDataLocale(new Date(`${iso}T12:00:00`))
    : fallback;
}

/** Data e ora nel formato breve usato nelle liste, con fallback configurabile. */
export function formattaDataOraBreve(ms: number, fallback = "—"): string {
  return ms ? FORMATO_DATA_ORA_BREVE.format(ms) : fallback;
}

/** Primo e ultimo giorno ISO del mese contenente il riferimento, con offset opzionale. */
export function estremiMeseIso(
  riferimento = new Date(),
  offsetMesi = 0,
): [string, string] {
  const anno = riferimento.getFullYear();
  const mese = riferimento.getMonth() + offsetMesi;
  return [
    isoLocale(new Date(anno, mese, 1)),
    isoLocale(new Date(anno, mese + 1, 0)),
  ];
}

export type PeriodoMensileIso =
  | "tutto"
  | "mese"
  | "scorso"
  | "trimestre"
  | "anno"
  | "custom";

/** Estremi inclusivi dei periodi mensili condivisi da produzione e contabilità. */
export function estremiPeriodoIso(
  periodo: PeriodoMensileIso,
  da: string,
  a: string,
  annoGlobale = 0,
  oggi = new Date(),
): [string, string] | null {
  if (periodo === "tutto") {
    return annoGlobale !== 0
      ? [`${annoGlobale}-01-01`, `${annoGlobale}-12-31`]
      : null;
  }
  if (periodo === "custom") {
    const limiteDal = annoGlobale !== 0 ? `${annoGlobale}-01-01` : "0000-01-01";
    const limiteAl = annoGlobale !== 0 ? `${annoGlobale}-12-31` : "9999-12-31";
    const dal = da || limiteDal;
    const al = a || limiteAl;
    return [dal < limiteDal ? limiteDal : dal, al > limiteAl ? limiteAl : al];
  }
  const riferimento =
    annoGlobale !== 0
      ? new Date(annoGlobale, oggi.getMonth(), oggi.getDate())
      : oggi;
  if (periodo === "mese") return estremiMeseIso(riferimento);
  if (periodo === "scorso") return estremiMeseIso(riferimento, -1);
  if (periodo === "trimestre") {
    return [estremiMeseIso(riferimento, -2)[0], estremiMeseIso(riferimento)[1]];
  }
  const anno = annoGlobale !== 0 ? annoGlobale : oggi.getFullYear();
  return [`${anno}-01-01`, `${anno}-12-31`];
}

/** Data ISO `YYYY-MM-DD` adatta ai nomi file italiani: `GG-MM-AAAA`. */
export function formattaDataFileItaliana(iso: string, fallback = ""): string {
  if (!iso) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** Formatta i primi dieci caratteri di una data ISO, preservando i fallback storici. */
export function formattaDataIsoItaliana(iso: string, fallback = ""): string {
  if (!iso || iso.length < 10) return iso || fallback;
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Converte tre segmenti separati da `-`, preservando il fallback storico dei documenti. */
export function formattaDataSeparataItaliana(valore: string, fallback = "—"): string {
  const [anno, mese, giorno] = valore.split("-");
  return anno && mese && giorno ? `${giorno}/${mese}/${anno}` : valore || fallback;
}

/** Data ISO `YYYY-MM-DD` resa nello standard visuale italiano dell'app `GG/MM/AAAA`. */
export function formattaDataItaliana(iso: string, fallback = "—"): string {
  if (!iso) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
