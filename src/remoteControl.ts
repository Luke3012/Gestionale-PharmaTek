import type { RemoteControlStatus } from "./lib/tauri";
import { INTERVALLO_CONTROLLO_AGGIORNAMENTI_MS } from "./updater";

export const EVENTO_CONTROLLO_REMOTO_CAMBIATO = "pt:controllo-remoto-cambiato";
export const INTERVALLO_CONTROLLO_REMOTO_MS = INTERVALLO_CONTROLLO_AGGIORNAMENTI_MS;

let ultimoStatoNotificato: string | null = null;

function chiaveStato(stato: RemoteControlStatus) {
  return JSON.stringify({
    disabled: stato.disabled,
    message: stato.message,
    updatedAt: stato.updatedAt,
    fromCache: stato.fromCache,
    premiumEnabled: stato.premiumEnabled,
  });
}

function notificaSeCambiato(stato: RemoteControlStatus) {
  const chiave = chiaveStato(stato);
  if (chiave === ultimoStatoNotificato) return;
  ultimoStatoNotificato = chiave;

  import("@tauri-apps/api/event")
    .then(({ emit }) => emit(EVENTO_CONTROLLO_REMOTO_CAMBIATO, stato))
    .catch(() => {});
}

export async function controllaDisattivazioneRemota(): Promise<RemoteControlStatus> {
  const stato: RemoteControlStatus = {
    disabled: false,
    message: "",
    updatedAt: "",
    fromCache: false,
    premiumEnabled: true,
  };
  notificaSeCambiato(stato);
  return stato;
}
