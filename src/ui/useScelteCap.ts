import { useCallback, useState } from "react";
import {
  cercaCAPDigitato,
  nomiCittaSuggeriti,
  type ComuneInfo,
} from "../lib/cap-lookup";
import { useCloseOnScroll } from "../lib/closeOnScroll";

/** Stato e transizioni comuni della disambiguazione CAP/città. */
export function useScelteCap() {
  const [suggerimentiCitta, setSuggerimentiCitta] = useState<string[]>([]);
  const [capAmbiguo, setCapAmbiguo] = useState<ComuneInfo[] | null>(null);
  const [capCittaMultiplo, setCapCittaMultiplo] = useState<ComuneInfo | null>(null);
  const [capPopoverAperto, setCapPopoverAperto] = useState(false);
  useCloseOnScroll(capPopoverAperto, setCapPopoverAperto);

  const chiudiScelteCap = useCallback(() => {
    setCapAmbiguo(null); setCapCittaMultiplo(null); setCapPopoverAperto(false);
  }, []);
  const dopoSceltaComune = useCallback((comune: ComuneInfo, mostraCapMultipli = false) => {
    setCapAmbiguo(null);
    setCapCittaMultiplo(mostraCapMultipli && comune.cap.length > 1 ? comune : null);
    setCapPopoverAperto(mostraCapMultipli && comune.cap.length > 1);
  }, []);
  const gestisciCap = useCallback((cap: string, onUnivoco: (comune: ComuneInfo) => void) => {
    const risultato = cercaCAPDigitato(cap);
    if (risultato?.univoco) onUnivoco(risultato.comuni[0]);
    else if (risultato) {
      setCapCittaMultiplo(null); setCapAmbiguo(risultato.comuni); setCapPopoverAperto(true);
    } else if (risultato === undefined) chiudiScelteCap();
  }, [chiudiScelteCap]);
  const suggerisciCitta = useCallback((query: string) => {
    setSuggerimentiCitta(nomiCittaSuggeriti(query, 10));
  }, []);

  return {
    suggerimentiCitta, capAmbiguo, capCittaMultiplo, capPopoverAperto,
    setCapPopoverAperto, dopoSceltaComune, gestisciCap, suggerisciCitta,
  };
}
