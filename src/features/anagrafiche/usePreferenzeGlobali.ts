import { useCallback, useEffect, useState } from "react";
import { api, type Campi } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";

type ValorePreferenza = boolean | number;
type ChiavePreferenza<T> = Extract<keyof T, string>;

export function usePreferenzeGlobali<T extends Record<string, ValorePreferenza>>({
  id,
  aperto,
  iniziali,
  decodifica,
  codifica,
  codificaCampo,
  onChanged,
}: {
  id: string;
  aperto: boolean;
  iniziali: T;
  decodifica: (data: Campi) => T;
  codifica: (valori: T) => Campi;
  codificaCampo: (key: ChiavePreferenza<T>, valore: T[ChiavePreferenza<T>]) => ValorePreferenza;
  onChanged?: () => void;
}) {
  const [valori, setValori] = useState<T>(iniziali);

  const carica = useCallback(async () => {
    try {
      const record = await api.recordGet("parametri_globali", id);
      setValori(record ? decodifica(record.data) : iniziali);
    } catch (error) {
      toast.error(`Caricamento impostazioni non riuscito: ${error}`);
    }
  }, [decodifica, id, iniziali]);

  useEffect(() => {
    if (aperto) void carica();
  }, [aperto, carica]);

  async function salva<K extends ChiavePreferenza<T>>(key: K, valore: T[K]) {
    const prossimi = { ...valori, [key]: valore };
    setValori(prossimi);
    try {
      const corrente = await api.recordGet("parametri_globali", id);
      if (corrente) {
        await api.recordUpdate("parametri_globali", id, {
          [key]: codificaCampo(key, valore),
        });
      } else {
        await api.recordCreateId("parametri_globali", id, codifica(prossimi));
      }
      onChanged?.();
    } catch (error) {
      toast.error(`Salvataggio impostazione non riuscito: ${error}`);
      void carica();
    }
  }

  return { valori, salva };
}
