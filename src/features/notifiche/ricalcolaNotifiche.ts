import { api } from "../../lib/tauri";

const EVENTI_NOTIFICHE_DA_RICALCOLARE = [
  "ordine:salvato",
  "pagamento:salvato",
  "promemoria:salvato",
  "notifica:salvato",
] as const;

/** Riallinea subito gli ascoltatori UI e la derivazione delle notifiche. */
export async function ricalcolaNotificheSubito(): Promise<void> {
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await Promise.all(EVENTI_NOTIFICHE_DA_RICALCOLARE.map((evento) => emit(evento)));
  } catch {
    // Best effort: l'operazione chiamante resta conclusa anche senza broadcast UI.
  }
  await api.notificheCheck().catch(() => {});
}
