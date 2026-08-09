import { inTauri } from "../../lib/tauri";

const CHIAVE_STATO_COMUNICAZIONI =
  "pt.notifiche-comunicazioni-locali.v1";
export const EVENTO_STATO_COMUNICAZIONI_LOCALI =
  "pt:notifiche-comunicazioni-locali-cambiate";

export interface StatoNotificheComunicazioniLocale {
  viste: Set<string>;
  scartate: Set<string>;
}

export function chiaveStatoComunicazioni(userId?: string) {
  return `${CHIAVE_STATO_COMUNICAZIONI}:${userId?.trim() || "locale"}`;
}

export function leggiStatoNotificheComunicazioniLocale(
  userId?: string,
): StatoNotificheComunicazioniLocale {
  try {
    const raw = localStorage.getItem(chiaveStatoComunicazioni(userId));
    if (!raw) return { viste: new Set(), scartate: new Set() };
    const parsed = JSON.parse(raw) as {
      viste?: unknown;
      scartate?: unknown;
    };
    return {
      viste: new Set(Array.isArray(parsed.viste) ? parsed.viste : []),
      scartate: new Set(
        Array.isArray(parsed.scartate) ? parsed.scartate : [],
      ),
    };
  } catch {
    return { viste: new Set(), scartate: new Set() };
  }
}

/**
 * Stato effimero e personale degli errori di comunicazione: resta fuori dal
 * motore eventi, dai backup e dalla sincronizzazione dei dati aziendali.
 */
export function aggiornaStatoNotificheComunicazioniLocale(
  ids: string[],
  userId?: string,
  scarta = false,
): StatoNotificheComunicazioniLocale {
  const corrente = leggiStatoNotificheComunicazioniLocale(userId);
  ids.filter(Boolean).forEach((id) => {
    corrente.viste.add(id);
    if (scarta) corrente.scartate.add(id);
  });
  try {
    localStorage.setItem(
      chiaveStatoComunicazioni(userId),
      JSON.stringify({
        viste: [...corrente.viste].slice(-500),
        scartate: [...corrente.scartate].slice(-500),
      }),
    );
  } catch {
    // Senza storage l'azione resta valida soltanto per il componente corrente.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(EVENTO_STATO_COMUNICAZIONI_LOCALI, {
        detail: { userId },
      }),
    );
  }
  if (inTauri) {
    void import("@tauri-apps/api/event")
      .then(({ emit, emitTo }) =>
        Promise.all([
          emit(EVENTO_STATO_COMUNICAZIONI_LOCALI, { userId }),
          emitTo(
            "overlay",
            "pt:overlay-rimuovi-notifiche",
            ids.map((id) =>
              id.startsWith("comunicazione:")
                ? `comunicazione-operativa:${id.slice("comunicazione:".length)}`
                : id,
            ),
          ),
        ]),
      )
      .catch(() => {});
  }
  return corrente;
}

/**
 * Elimina soltanto i marker personali delle comunicazioni (lette/scartate).
 * Va usato quando cambia davvero archivio o identità: non tocca preferenze,
 * dati applicativi o stati notifiche sincronizzati.
 */
export function pulisciStatoNotificheComunicazioniLocale(): number {
  let rimosse = 0;
  try {
    for (let indice = localStorage.length - 1; indice >= 0; indice -= 1) {
      const chiave = localStorage.key(indice);
      if (!chiave?.startsWith(`${CHIAVE_STATO_COMUNICAZIONI}:`)) continue;
      localStorage.removeItem(chiave);
      rimosse += 1;
    }
  } catch {
    // Lo storage può non essere disponibile nelle fasi iniziali/di chiusura.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(EVENTO_STATO_COMUNICAZIONI_LOCALI, {
        detail: { reset: true },
      }),
    );
  }
  if (inTauri) {
    void import("@tauri-apps/api/event")
      .then(({ emit, emitTo }) =>
        Promise.all([
          emit(EVENTO_STATO_COMUNICAZIONI_LOCALI, { reset: true }),
          emitTo("overlay", "pt:overlay-pulisci"),
        ]),
      )
      .catch(() => {});
  }
  return rimosse;
}
