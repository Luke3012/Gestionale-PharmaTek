import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { setConToggle } from "../lib/set";
import type { DataTableColumn } from "./Tabella";

export interface DefinizioneColonnaConfigurabile<K extends string = string> {
  key: K;
  defaultVisible: boolean;
}

export interface StatoColonneConfigurabili<K extends string = string> {
  ordine: K[];
  nascoste: K[];
}

export interface VoceColonnaConfigurabile<D> {
  def: D;
  visibile: boolean;
}

export interface DefinizioneColonnaTabella<T> extends DefinizioneColonnaConfigurabile {
  label: string;
  align?: "right" | "center";
  render: (record: T) => ReactNode;
  sortAccessor?: (record: T) => string | number;
  /** Larghezza iniziale opzionale; l'assenza lascia dimensionare la tabella sul contenuto. */
  width?: DataTableColumn<T>["width"];
}

interface OpzioniColonneTabella<T> {
  includiLarghezza?: boolean;
  render?: (colonna: DefinizioneColonnaTabella<T>, record: T) => ReactNode;
}

/** Traduce le definizioni persistibili nel contratto della tabella. */
export function colonneTabellaConfigurabili<T>(
  definizioni: readonly DefinizioneColonnaTabella<T>[], opzioni: OpzioniColonneTabella<T> = {},
): DataTableColumn<T>[] {
  return definizioni.map((colonna) => ({
    accessor: colonna.key,
    title: colonna.label,
    textAlign: colonna.align === "right" ? "right" : colonna.align === "center" ? "center" : "left",
    sortable: !!colonna.sortAccessor,
    resizable: true,
    ...(opzioni.includiLarghezza ? { width: colonna.width } : {}),
    render: (record: T) => opzioni.render ? opzioni.render(colonna, record) : colonna.render(record),
  }));
}

interface OpzioniColonneConfigurabili<K extends string> {
  primeDefault?: readonly K[];
  nascondiNuoveOpzionali?: boolean;
  deduplicaNascoste?: boolean;
}

/** Costruisce ordine e visibilità iniziali senza leggere la persistenza. */
export function statoColonnePredefinito<K extends string>(
  definizioni: readonly DefinizioneColonnaConfigurabile<K>[],
  prime: readonly K[] = [],
): StatoColonneConfigurabili<K> {
  const prioritarie = new Set(prime);
  return {
    ordine: [
      ...prime,
      ...definizioni.map((colonna) => colonna.key).filter((key) => !prioritarie.has(key)),
    ],
    nascoste: definizioni
      .filter((colonna) => !colonna.defaultVisible)
      .map((colonna) => colonna.key),
  };
}

/**
 * Filtra chiavi obsolete e accoda le colonne introdotte dopo il salvataggio.
 * La visibilità delle nuove colonne resta una scelta esplicita della singola vista.
 */
export function normalizzaStatoColonne<K extends string>(
  definizioni: readonly DefinizioneColonnaConfigurabile<K>[],
  salvato: { ordine?: readonly string[]; nascoste?: readonly string[] } | undefined,
  opzioni: OpzioniColonneConfigurabili<K> = {},
): StatoColonneConfigurabili<K> {
  if (!salvato) return statoColonnePredefinito(definizioni, opzioni.primeDefault);

  const note = new Set<string>(definizioni.map((colonna) => colonna.key));
  const ordineSalvato = salvato.ordine ?? [];
  const giaPresenti = new Set(ordineSalvato);
  const nuove = definizioni.filter((colonna) => !giaPresenti.has(colonna.key));
  const ordine = [
    ...ordineSalvato.filter((key): key is K => note.has(key)),
    ...nuove.map((colonna) => colonna.key),
  ];
  const nascoste: K[] = [
    ...(salvato.nascoste ?? []).filter((key): key is K => note.has(key)),
    ...(opzioni.nascondiNuoveOpzionali
      ? nuove.filter((colonna) => !colonna.defaultVisible).map((colonna) => colonna.key)
      : []),
  ];

  return {
    ordine,
    nascoste: opzioni.deduplicaNascoste ? [...new Set(nascoste)] : nascoste,
  };
}

interface ConfigurazioneColonne<K extends string> {
  storage: string;
  storagePrecedenti?: readonly string[];
  normalizza: (
    salvato?: { ordine?: string[]; nascoste?: string[] },
  ) => StatoColonneConfigurabili<K>;
  richiedeOrdineSalvato?: boolean;
  validaChiavi?: boolean;
  onReset?: () => void;
}

/** Legge la prima chiave disponibile e ricade sui default per dati assenti o corrotti. */
export function caricaStatoColonne<K extends string>(
  storage: Pick<Storage, "getItem">,
  chiavi: readonly string[],
  normalizza: ConfigurazioneColonne<K>["normalizza"],
  richiedeOrdineSalvato = false,
): StatoColonneConfigurabili<K> {
  try {
    let raw: string | null = null;
    for (const chiave of chiavi) {
      raw = storage.getItem(chiave);
      if (raw !== null) break;
    }
    if (!raw) return normalizza();
    const salvato = JSON.parse(raw) as { ordine?: string[]; nascoste?: string[] };
    return richiedeOrdineSalvato && !Array.isArray(salvato.ordine)
      ? normalizza()
      : normalizza(salvato);
  } catch {
    return normalizza();
  }
}

/** Stato React comune delle tabelle con ordine e visibilità persistenti. */
export function useColonneConfigurabili<
  K extends string,
  D extends DefinizioneColonnaConfigurabile<K>,
>(
  definizioni: readonly D[],
  configurazione: ConfigurazioneColonne<K>,
) {
  const {
    storage,
    storagePrecedenti = [],
    normalizza,
    richiedeOrdineSalvato = false,
    validaChiavi = false,
    onReset,
  } = configurazione;
  const mappa = useMemo(
    () => new Map<K, D>(definizioni.map((definizione) => [definizione.key, definizione])),
    [definizioni],
  );
  const [stato, setStato] = useState<StatoColonneConfigurabili<K>>(() =>
    caricaStatoColonne(
      localStorage,
      [storage, ...storagePrecedenti],
      normalizza,
      richiedeOrdineSalvato,
    ),
  );

  useEffect(() => {
    localStorage.setItem(storage, JSON.stringify(stato));
  }, [stato, storage]);

  const nascoste = useMemo(() => new Set(stato.nascoste), [stato.nascoste]);
  const tutte = useMemo<VoceColonnaConfigurabile<D>[]>(
    () =>
      stato.ordine
        .map((key) => mappa.get(key))
        .filter((definizione): definizione is D => !!definizione)
        .map((def) => ({ def, visibile: !nascoste.has(def.key) })),
    [mappa, nascoste, stato.ordine],
  );
  const visibili = useMemo(
    () => tutte.filter((voce) => voce.visibile).map((voce) => voce.def),
    [tutte],
  );

  const riordina = useCallback(
    (keys: string[]) => {
      const ordine = validaChiavi
        ? keys.filter((key): key is K => mappa.has(key as K))
        : (keys as K[]);
      setStato((corrente) => ({ ...corrente, ordine }));
    },
    [mappa, validaChiavi],
  );

  const toggle = useCallback(
    (key: string) => {
      const chiave = key as K;
      if (validaChiavi && !mappa.has(chiave)) return;
      setStato((corrente) => {
        return { ...corrente, nascoste: [...setConToggle(corrente.nascoste, chiave)] };
      });
    },
    [mappa, validaChiavi],
  );

  const reset = useCallback(() => {
    setStato(normalizza());
    onReset?.();
  }, [normalizza, onReset]);

  return { visibili, tutte, ordineKeys: stato.ordine, riordina, toggle, reset };
}
