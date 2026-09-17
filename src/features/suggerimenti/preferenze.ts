import type { TipoSuggerimento } from "../../lib/tauriTypes";

export const TIPI_SUGGERIMENTO: readonly TipoSuggerimento[] = [
  "rimborso",
  "distinta",
  "provvigione",
  "produzione",
  "spedizione",
  "preventivo",
];

export interface PreferenzeSuggerimenti {
  /** Categorie mostrate nella Dashboard e considerate dal notificatore. */
  tipiAbilitati: TipoSuggerimento[];
  /** Inserisce le azioni mature in campanella e nei pop-up custom. */
  notificheAttive: boolean;
  /** Giorni minimi dalla data operativa prima dell'avviso. */
  giorniAvviso: Record<TipoSuggerimento, number>;
}

export const PREFERENZE_SUGGERIMENTI_DEFAULT: PreferenzeSuggerimenti = {
  tipiAbilitati: ["rimborso", "distinta", "produzione", "spedizione"],
  notificheAttive: true,
  giorniAvviso: {
    rimborso: 3,
    distinta: 20,
    provvigione: 7,
    produzione: 3,
    spedizione: 3,
    preventivo: 7,
  },
};

const èRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const limitaGiorni = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(90, Math.round(value)));
};

/** Migra e valida la preferenza locale senza mai propagare valori arbitrari al core. */
export function normalizzaPreferenzeSuggerimenti(
  value: unknown,
): PreferenzeSuggerimenti {
  if (!èRecord(value)) {
    return {
      ...PREFERENZE_SUGGERIMENTI_DEFAULT,
      tipiAbilitati: [...PREFERENZE_SUGGERIMENTI_DEFAULT.tipiAbilitati],
      giorniAvviso: { ...PREFERENZE_SUGGERIMENTI_DEFAULT.giorniAvviso },
    };
  }
  const tipiRicevuti = Array.isArray(value.tipiAbilitati)
    ? value.tipiAbilitati
    : PREFERENZE_SUGGERIMENTI_DEFAULT.tipiAbilitati;
  const tipiAbilitati = TIPI_SUGGERIMENTO.filter((tipo) =>
    tipiRicevuti.includes(tipo),
  );
  const giorniRicevuti = èRecord(value.giorniAvviso)
    ? value.giorniAvviso
    : {};
  return {
    tipiAbilitati,
    notificheAttive:
      typeof value.notificheAttive === "boolean"
        ? value.notificheAttive
        : PREFERENZE_SUGGERIMENTI_DEFAULT.notificheAttive,
    giorniAvviso: Object.fromEntries(
      TIPI_SUGGERIMENTO.map((tipo) => [
        tipo,
        limitaGiorni(
          giorniRicevuti[tipo],
          PREFERENZE_SUGGERIMENTI_DEFAULT.giorniAvviso[tipo],
        ),
      ]),
    ) as Record<TipoSuggerimento, number>,
  };
}
