// Numero/importo che si anima fino al valore (KPI dashboard, UI-SPEC §12).
// Rispetta la preferenza "riduci animazioni": in quel caso mostra subito il valore.
import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { usePrefs } from "../../lib/prefs";
import { dur } from "../../ui/motion";

export function CountUp({
  value,
  format,
}: {
  value: number;
  /** Formatta il numero animato (es. euro, intero). Default: intero localizzato. */
  format?: (n: number) => string;
}) {
  const { ridurreAnimazioni } = usePrefs();
  const [mostrato, setMostrato] = useState(value);
  const precedente = useRef(value);
  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString("it-IT"));

  useEffect(() => {
    if (ridurreAnimazioni) {
      precedente.current = value;
      setMostrato(value);
      return;
    }
    const controls = animate(precedente.current, value, {
      duration: dur.slow,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => setMostrato(v),
    });
    precedente.current = value;
    return () => controls.stop();
  }, [value, ridurreAnimazioni]);

  return <>{fmt(mostrato)}</>;
}
