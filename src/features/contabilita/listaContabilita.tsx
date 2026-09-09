import { useCallback, useEffect, useState, type PropsWithChildren, type ReactNode } from "react";
import { Stack, ThemeIcon } from "@mantine/core";
import { toast } from "../../ui/toast/store";

export async function aggiornaListaContabilita<T>(
  silente: boolean,
  caricatore: () => Promise<T[]>,
  aggiorna: (righe: T[]) => void,
  impostaCaricamento: (caricamento: boolean) => void,
  segnalaErrore: (errore: unknown) => void
) {
  if (!silente) impostaCaricamento(true);
  try {
    aggiorna(await caricatore());
  } catch (errore) {
    segnalaErrore(errore);
  } finally {
    impostaCaricamento(false);
  }
}

export function useListaContabilita<T>(caricatore: () => Promise<T[]>, messaggioErrore: string) {
  const [righe, setRighe] = useState<T[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const carica = useCallback(
    (silente = false) => aggiornaListaContabilita(silente, caricatore, setRighe, setCaricamento, (errore) => toast.error(`${messaggioErrore}: ${errore}`)),
    [caricatore, messaggioErrore]
  );
  useEffect(() => { carica(false); }, [carica]);
  return { righe, caricamento, carica };
}

export function StatoVuotoContabilita({ icona, children }: PropsWithChildren<{ icona: ReactNode }>) {
  return <Stack align="center" gap="xs" maw={460} ta="center" py={40}><ThemeIcon size={48} radius="xl" variant="light" color="gray">{icona}</ThemeIcon>{children}</Stack>;
}
