import { useCallback, useEffect, useMemo, useState } from "react";
import { resetLarghezzeTabella } from "../../ui/Tabella";

export const COLONNE_PREVENTIVI = [
  { key: "numeroPreventivo", label: "Preventivo", defaultVisible: true },
  { key: "creatoMs", label: "Data creazione", defaultVisible: true },
  { key: "clienteNome", label: "Cliente / destinatario", defaultVisible: true },
  { key: "agenteNome", label: "Agente", defaultVisible: true },
  { key: "prodotti", label: "Prodotti", defaultVisible: false },
  { key: "linee", label: "Linea", defaultVisible: true },
  { key: "ordineStato", label: "Stato", defaultVisible: false },
  { key: "totale", label: "Totale", defaultVisible: true },
  { key: "acconto", label: "Acconto", defaultVisible: false },
  { key: "email", label: "E-mail", defaultVisible: false },
  { key: "telefono", label: "Telefono", defaultVisible: false },
  { key: "spedizione", label: "Spedizione", defaultVisible: false },
  { key: "fatturazione", label: "Fatturazione", defaultVisible: false },
  { key: "ultimoInvioMs", label: "Stato invio", defaultVisible: true },
] as const;

export type ChiaveColonnaPreventivi = (typeof COLONNE_PREVENTIVI)[number]["key"];

const DEFINIZIONI = new Map(COLONNE_PREVENTIVI.map((colonna) => [colonna.key, colonna]));
const STORAGE = "pt.preventivi.colonne.v2";
const STORAGE_PRECEDENTE = "pt.preventivi.colonne.v1";
export const STORE_LARGHEZZE_PREVENTIVI = "preventivi-v2";

export interface StatoColonnePreventivi {
  ordine: ChiaveColonnaPreventivi[];
  nascoste: ChiaveColonnaPreventivi[];
}

function predefinito(): StatoColonnePreventivi {
  return {
    ordine: COLONNE_PREVENTIVI.map((colonna) => colonna.key),
    nascoste: COLONNE_PREVENTIVI
      .filter((colonna) => !colonna.defaultVisible)
      .map((colonna) => colonna.key),
  };
}

export function normalizzaColonnePreventivi(salvato?: {
  ordine?: string[];
  nascoste?: string[];
}): StatoColonnePreventivi {
  if (!salvato) return predefinito();
  const ordineSalvato = salvato.ordine ?? [];
  const giaPresenti = new Set(ordineSalvato);
  const ordine = [
    ...ordineSalvato.filter(
      (key): key is ChiaveColonnaPreventivi =>
        DEFINIZIONI.has(key as ChiaveColonnaPreventivi),
    ),
    ...COLONNE_PREVENTIVI
      .map((colonna) => colonna.key)
      .filter((key) => !giaPresenti.has(key)),
  ];
  const nascoste = new Set(
    (salvato.nascoste ?? []).filter(
      (key): key is ChiaveColonnaPreventivi =>
        DEFINIZIONI.has(key as ChiaveColonnaPreventivi),
    ),
  );
  // Le colonne introdotte dopo il salvataggio rispettano il proprio default:
  // quelle opzionali non compaiono improvvisamente sui PC già configurati.
  for (const colonna of COLONNE_PREVENTIVI) {
    if (!giaPresenti.has(colonna.key) && !colonna.defaultVisible) {
      nascoste.add(colonna.key);
    }
  }
  return { ordine, nascoste: [...nascoste] };
}

function carica(): StatoColonnePreventivi {
  try {
    const raw =
      localStorage.getItem(STORAGE) ??
      localStorage.getItem(STORAGE_PRECEDENTE);
    if (!raw) return predefinito();
    return normalizzaColonnePreventivi(
      JSON.parse(raw) as { ordine?: string[]; nascoste?: string[] },
    );
  } catch {
    return predefinito();
  }
}

export function useColonnePreventivi() {
  const [stato, setStato] = useState<StatoColonnePreventivi>(carica);

  useEffect(() => {
    localStorage.setItem(STORAGE, JSON.stringify(stato));
  }, [stato]);

  const nascoste = useMemo(() => new Set(stato.nascoste), [stato.nascoste]);
  const tutte = useMemo(
    () =>
      stato.ordine.map((key) => ({
        def: DEFINIZIONI.get(key)!,
        visibile: !nascoste.has(key),
      })),
    [nascoste, stato.ordine],
  );
  const visibili = useMemo(
    () => stato.ordine.filter((key) => !nascoste.has(key)),
    [nascoste, stato.ordine],
  );

  const riordina = useCallback((keys: string[]) => {
    setStato((corrente) => ({
      ...corrente,
      ordine: keys.filter(
        (key): key is ChiaveColonnaPreventivi => DEFINIZIONI.has(key as ChiaveColonnaPreventivi),
      ),
    }));
  }, []);

  const toggle = useCallback((key: string) => {
    if (!DEFINIZIONI.has(key as ChiaveColonnaPreventivi)) return;
    setStato((corrente) => {
      const nascoste = new Set(corrente.nascoste);
      const chiave = key as ChiaveColonnaPreventivi;
      if (nascoste.has(chiave)) nascoste.delete(chiave);
      else nascoste.add(chiave);
      return { ...corrente, nascoste: [...nascoste] };
    });
  }, []);

  const reset = useCallback(() => {
    setStato(predefinito());
    resetLarghezzeTabella(STORE_LARGHEZZE_PREVENTIVI);
  }, []);

  return {
    visibili,
    tutte,
    ordineKeys: stato.ordine,
    riordina,
    toggle,
    reset,
  };
}
