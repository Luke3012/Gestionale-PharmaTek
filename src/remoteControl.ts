import { api, inTauri, type RemoteControlStatus } from "./lib/tauri";
import { INTERVALLO_CONTROLLO_AGGIORNAMENTI_MS } from "./updater";

const TOKEN = ((import.meta.env as Record<string, string | undefined>).VITE_DEMO_UPDATER_DISABLED ?? "").trim();

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
  if (!inTauri) {
    return {
      disabled: false,
      message: "",
      updatedAt: "",
      fromCache: true,
      premiumEnabled: false,
    };
  }
  const stato = await api.remoteControlStatus(TOKEN);
  notificaSeCambiato(stato);
  return stato;
}
