import { useCallback, useState } from "react";

export function useModalSnapshot<T>(value: T | null | undefined) {
  const [shown, setShown] = useState<T | null>(value ?? null);
  const [prevValue, setPrevValue] = useState(value);

  if (value !== prevValue) {
    setPrevValue(value);
    if (value != null) {
      setShown(value);
    }
  }

  const clearShown = useCallback(() => setShown(null), []);

  return [value ?? shown, clearShown] as const;
}
