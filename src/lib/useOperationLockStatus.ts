import { useEffect, useState } from "react";
import { api, type OperationLockStatus } from "./tauri";

/** Osserva periodicamente il lock cooperativo usato dalle operazioni lunghe. */
export function useOperationLockStatus(attivo = true, intervalloMs = 10_000) {
  const [status, setStatus] = useState<OperationLockStatus | null>(null);

  useEffect(() => {
    if (!attivo) return;
    let montato = true;
    async function carica() {
      try {
        const corrente = await api.operationLockStatus();
        if (montato) setStatus(corrente);
      } catch {
        if (montato) setStatus(null);
      }
    }
    void carica();
    const id = window.setInterval(() => void carica(), intervalloMs);
    return () => {
      montato = false;
      window.clearInterval(id);
    };
  }, [attivo, intervalloMs]);

  return [status, setStatus] as const;
}
