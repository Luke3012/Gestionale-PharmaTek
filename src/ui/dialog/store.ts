// Servizio dialog promise-based: modali tipizzate multi-bottone. Vedi UI-SPEC §13.2.
import type { ReactNode } from "react";

export type DialogTipo = "info" | "success" | "warning" | "error" | "question";
export type BottoneVariante = "primario" | "secondario" | "pericolo" | "ghost" | "informativo" | "ignora";

export interface DialogBottone<T = unknown> {
  label: string;
  /** Mostra l'azione come scelta visuale nel corpo del dialog invece che nel footer. */
  posizione?: "contenuto" | "footer";
  /** Rendering personalizzato della scelta nel corpo; il click resta gestito dal dialog globale. */
  contenutoAzione?: ReactNode;
  variante?: BottoneVariante;
  value: T;
  autofocus?: boolean;
}

export interface DialogInput {
  tipo?: DialogTipo;
  titolo: string;
  contenuto?: ReactNode;
  bottoni?: DialogBottone[];
  /** Valore risolto su Esc/click fuori (default: undefined). */
  valoreAnnulla?: unknown;
}

export interface DialogAttivo extends DialogInput {
  id: string;
  bottoni: DialogBottone[];
  resolve: (value: unknown) => void;
}

type Listener = (d: DialogAttivo | null) => void;

let seq = 0;

class DialogStore {
  private queue: DialogAttivo[] = [];
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.current);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private get current(): DialogAttivo | null {
    return this.queue[0] ?? null;
  }

  private emit() {
    this.listeners.forEach((l) => l(this.current));
  }

  open<T = unknown>(input: DialogInput): Promise<T> {
    return new Promise<T>((resolve) => {
      const bottoni =
        input.bottoni && input.bottoni.length > 0
          ? input.bottoni
          : [{ label: "Ok", variante: "primario" as const, value: undefined }];
      const dlg: DialogAttivo = {
        ...input,
        id: `d${++seq}`,
        bottoni,
        resolve: resolve as (v: unknown) => void,
      };
      const eraVuota = this.queue.length === 0;
      this.queue.push(dlg);
      if (eraVuota) this.emit();
    });
  }

  /** Chiude il dialog corrente risolvendo con `value` e mostra il successivo. */
  close(id: string, value: unknown) {
    const idx = this.queue.findIndex((d) => d.id === id);
    if (idx === -1) return;
    const [dlg] = this.queue.splice(idx, 1);
    dlg.resolve(value);
    this.emit();
  }
}

export const dialogStore = new DialogStore();

export const dialog = {
  open: <T = unknown>(input: DialogInput) => dialogStore.open<T>(input),

  alert: (titolo: string, contenuto?: ReactNode, tipo: DialogTipo = "info") =>
    dialogStore.open<void>({
      tipo,
      titolo,
      contenuto,
      bottoni: [{ label: "Ok", variante: "primario", value: undefined }],
    }),

  confirm: (
    titolo: string,
    contenuto?: ReactNode,
    opts?: { conferma?: string; annulla?: string }
  ) =>
    dialogStore.open<boolean>({
      tipo: "question",
      titolo,
      contenuto,
      valoreAnnulla: false,
      bottoni: [
        { label: opts?.annulla ?? "Annulla", variante: "secondario", value: false },
        { label: opts?.conferma ?? "Conferma", variante: "primario", value: true, autofocus: true },
      ],
    }),

  confirmDanger: (
    titolo: string,
    contenuto?: ReactNode,
    opts?: { conferma?: string; annulla?: string }
  ) =>
    dialogStore.open<boolean>({
      tipo: "warning",
      titolo,
      contenuto,
      valoreAnnulla: false,
      bottoni: [
        { label: opts?.annulla ?? "Annulla", variante: "secondario", value: false },
        { label: opts?.conferma ?? "Elimina", variante: "pericolo", value: true, autofocus: true },
      ],
    }),
};
