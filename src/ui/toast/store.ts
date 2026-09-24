// Store imperativo dei toast: usabile da qualunque punto (anche fuori da React).
// Vedi UI-SPEC §13.3.

export type ToastTipo = "info" | "success" | "warning" | "error" | "loading";

interface ToastAzione {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  tipo: ToastTipo;
  titolo?: string;
  messaggio: string;
  /** Avanzamento determinato 0-100, usato dai toast di operazioni lunghe. */
  progress?: number;
  /** ms prima dell'auto-chiusura; 0 = resta finché chiuso a mano. */
  durata: number;
  azioni?: ToastAzione[];
}

export interface ToastInput {
  titolo?: string;
  durata?: number;
  progress?: number;
  azioni?: ToastAzione[];
}

type Listener = (items: ToastItem[]) => void;

export const EVENTO_TOAST_PRINCIPALE = "pt:toast-principale";

type ToastSerializzabile = Omit<ToastItem, "azioni">;
type PatchToastSerializzabile = Partial<Omit<ToastItem, "id" | "azioni">>;

export type MessaggioToastPrincipale =
  | { operazione: "mostra"; item: ToastSerializzabile }
  | { operazione: "aggiorna"; id: string; patch: PatchToastSerializzabile }
  | { operazione: "chiudi"; id: string };

let seq = 0;
const origine =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type DestinazioneToast = "locale" | "principale";

/**
 * Le finestre operative possiedono un provider locale. Spotlight e l'overlay
 * custom sono invece finestre di servizio: qualsiasi toast applicativo nato lì
 * viene mostrato dalla main, senza sovrapporsi alla loro UI specializzata.
 */
export function destinazioneToastDaRicerca(search: string): DestinazioneToast {
  const params = new URLSearchParams(search);
  return params.has("spotlight") || params.has("overlay")
    ? "principale"
    : "locale";
}

function destinazioneToastCorrente(): DestinazioneToast {
  if (typeof window === "undefined") return "locale";
  return destinazioneToastDaRicerca(window.location.search);
}

function inoltraAllaPrincipale(messaggio: MessaggioToastPrincipale): void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  void import("@tauri-apps/api/event")
    .then(({ emitTo }) => emitTo("main", EVENTO_TOAST_PRINCIPALE, messaggio))
    .catch(() => {});
}

function idPrincipale(id: string): string {
  return `${origine}:${id}`;
}

function itemSerializzabile(item: ToastItem, id: string): ToastSerializzabile {
  return {
    id,
    tipo: item.tipo,
    titolo: item.titolo,
    messaggio: item.messaggio,
    progress: item.progress,
    durata: item.durata,
  };
}

function patchSerializzabile(
  patch: Partial<Omit<ToastItem, "id">>,
): PatchToastSerializzabile {
  return {
    tipo: patch.tipo,
    titolo: patch.titolo,
    messaggio: patch.messaggio,
    progress: patch.progress,
    durata: patch.durata,
  };
}

class ToastStore {
  private items: ToastItem[] = [];
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.items);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    const snap = [...this.items];
    this.listeners.forEach((l) => l(snap));
  }

  show(item: Omit<ToastItem, "id"> & { id?: string }): string {
    const id = item.id ?? `t${++seq}`;
    if (destinazioneToastCorrente() === "principale") {
      inoltraAllaPrincipale({
        operazione: "mostra",
        item: itemSerializzabile({ ...item, id }, idPrincipale(id)),
      });
      return id;
    }
    // De-duplica messaggi identici ravvicinati (stesso tipo + testo).
    const dup = item.id
      ? undefined
      : this.items.find(
          (t) =>
            t.tipo === item.tipo &&
            t.messaggio === item.messaggio &&
            t.titolo === item.titolo,
        );
    if (dup) return dup.id;
    this.items = [...this.items, { ...item, id }];
    this.emit();
    return id;
  }

  update(id: string, patch: Partial<Omit<ToastItem, "id">>) {
    if (destinazioneToastCorrente() === "principale") {
      inoltraAllaPrincipale({
        operazione: "aggiorna",
        id: idPrincipale(id),
        patch: patchSerializzabile(patch),
      });
      return;
    }
    this.items = this.items.map((t) => (t.id === id ? { ...t, ...patch } : t));
    this.emit();
  }

  dismiss(id: string) {
    if (destinazioneToastCorrente() === "principale") {
      inoltraAllaPrincipale({ operazione: "chiudi", id: idPrincipale(id) });
      return;
    }
    this.items = this.items.filter((t) => t.id !== id);
    this.emit();
  }
}

export const toastStore = new ToastStore();

/** Applica nella sola main un toast ricevuto da una Webview secondaria. */
export function applicaToastPrincipale(messaggio: MessaggioToastPrincipale): void {
  if (!messaggio || typeof messaggio !== "object") return;
  if (messaggio.operazione === "mostra") {
    toastStore.show(messaggio.item);
  } else if (messaggio.operazione === "aggiorna") {
    toastStore.update(messaggio.id, messaggio.patch);
  } else if (messaggio.operazione === "chiudi") {
    toastStore.dismiss(messaggio.id);
  }
}

const DURATE_MINIME: Record<Exclude<ToastTipo, "loading">, number> = {
  info: 7_000,
  success: 6_000,
  warning: 10_000,
  error: 20_000,
};

const DURATE_MASSIME: Record<Exclude<ToastTipo, "loading">, number> = {
  info: 24_000,
  success: 18_000,
  warning: 32_000,
  error: 45_000,
};

/** Tempo di lettura adattivo; le azioni restano finché l'utente decide. */
export function durataToastAutomatica(
  tipo: Exclude<ToastTipo, "loading">,
  messaggio: string,
  opzioni?: ToastInput,
): number {
  if (opzioni?.durata !== undefined) return opzioni.durata;
  if (opzioni?.azioni?.length) return 0;
  const parole = messaggio.trim().split(/\s+/).filter(Boolean).length;
  const righeExtra = Math.max(0, messaggio.split(/\r?\n/).length - 1);
  const stimata = 2_200 + parole * 360 + righeExtra * 650;
  return Math.min(
    DURATE_MASSIME[tipo],
    Math.max(DURATE_MINIME[tipo], stimata),
  );
}

export const toast = {
  info: (messaggio: string, o?: ToastInput) =>
    toastStore.show({ tipo: "info", messaggio, durata: durataToastAutomatica("info", messaggio, o), ...o }),
  success: (messaggio: string, o?: ToastInput) =>
    toastStore.show({ tipo: "success", messaggio, durata: durataToastAutomatica("success", messaggio, o), ...o }),
  warning: (messaggio: string, o?: ToastInput) =>
    toastStore.show({ tipo: "warning", messaggio, durata: durataToastAutomatica("warning", messaggio, o), ...o }),
  // Gli errori restano a lungo per dare tempo di leggerli, poi si chiudono da soli;
  // override possibile via `durata` (es. 0 = finché chiuso a mano).
  error: (messaggio: string, o?: ToastInput) =>
    toastStore.show({ tipo: "error", messaggio, durata: durataToastAutomatica("error", messaggio, o), ...o }),
  // Toast persistente che poi si trasforma in success/error.
  loading: (messaggio: string, o?: ToastInput) =>
    toastStore.show({ tipo: "loading", messaggio, durata: 0, ...o }),
  update: (id: string, patch: Partial<Omit<ToastItem, "id">>) =>
    toastStore.update(id, patch),
  dismiss: (id: string) => toastStore.dismiss(id),
};
