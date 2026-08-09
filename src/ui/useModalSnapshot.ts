import { useCallback, useEffect, useState } from "react";

export function useModalSnapshot<T>(value: T | null | undefined) {
  const [shown, setShown] = useState<T | null>(value ?? null);

  useEffect(() => {
    if (value != null) setShown(value);
  }, [value]);

  const clearShown = useCallback(() => setShown(null), []);

  return [shown, clearShown] as const;
}
