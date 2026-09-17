import { useEffect, useState } from "react";

/** Mantiene l'ultimo valore stabile dopo una breve pausa nelle modifiche. */
export function useDebouncedValue<T>(value: T, delay = 220): T {
  const [stabile, setStabile] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setStabile(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return stabile;
}
