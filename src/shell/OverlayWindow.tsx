// Overlay notifiche custom (anticipo FASE 7, al posto del balloon di sistema). È una
// finestra Tauri trasparente, senza bordi e always-on-top. Nasce nascosta e viene
// mostrata dal rilevatore Rust (`notifiche.rs`) solo quando arrivano notifiche nuove
// in background; quando torna vuota si nasconde di nuovo.
//
// Il SUONO lo fa il Rust (un solo "suonatore", de-dup unificata): qui solo display +
// azioni. Ogni card resta in primo piano almeno 30s, 45s per azioni/urgenze
// (180s per i messaggi),
// poi lascia posto alla successiva. Click = leggi + apri ciò a cui punta; sulle
// comunicazioni operative ✗ annulla l'intera azione, sugli altri avvisi chiude
// soltanto il pop-up. I messaggi 6E si rispondono inline.
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ActionIcon, Box, Button, Group, Text, ThemeIcon } from "@mantine/core";
import { IconCornerUpLeft, IconPlayerPlay, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  api,
  inTauri,
  type Comunicazione,
  type Identity,
  type SuggerimentoCollegamento,
} from "../lib/tauri";
import { apriFinestraOrdine } from "../features/giornaliero/apriFinestra";
import { apriFinestraPagamento } from "../features/contabilita/apriFinestraPagamento";
import { apriRiepilogo, type TipoRiepilogo } from "./apriRiepilogo";
import { apriFinestraPromemoria } from "../features/promemoria/apriFinestraPromemoria";
import { ComposerMessaggio } from "../features/notifiche/ComposerMessaggio";
import { riproduciSuono } from "../features/notifiche/suoni";
import {
  COLORE_URGENZA,
  segnaLetta,
  TIPO_NOTIFICA,
  type TipoNotifica,
  type UrgenzaNotifica,
} from "../features/notifiche/notifiche";
import { usePrefs } from "../lib/prefs";
import { useAnimazioniRidotte } from "../ui/motion";
import { apriCentroComunicazioniDaNotifica } from "../features/comunicazioni/apriComunicazione";
import {
  formattaStimaInvio,
  STIMA_INVIO_SECONDI,
} from "../features/comunicazioni/stimaInvio";
import { riepilogaProgressoComunicazioni } from "../features/comunicazioni/progressoComunicazioni";
import { aggiornaStatoNotificheComunicazioniLocale } from "../features/notifiche/statoComunicazioniLocale";
import { vaiAllaPrincipale } from "./navigazione";
import { deepLinkSuggerimento } from "../features/suggerimenti/collegamento";
import { usePremiumAccess } from "../premium/PremiumAccess";

const SuggerimentoDuplicatiWorker = lazy(() =>
  import("../features/suggerimenti/SuggerimentoDuplicatiWorker").then(
    (module) => ({ default: module.SuggerimentoDuplicatiWorker }),
  ),
);

/** Payload inviato dal Rust (`Notif` serializzato in camelCase). */
interface Toast {
  id: string;
  tipo: TipoNotifica;
  urgenza: UrgenzaNotifica;
  titolo: string;
  dettaglio: string;
  collegatoTipo: string;
  collegatoId: string;
  collegatoNome: string;
  promemoriaId: string;
  mittenteId: string;
  suggerimentoCollegamento?: SuggerimentoCollegamento;
  comunicazioneId?: string;
  campagnaId?: string;
  inCorso?: boolean;
  ripresaWhatsapp?: boolean;
  erroreComunicazione?: boolean;
  campagnaInPausa?: boolean;
  durataMs?: number;
  stimaSecondi?: number;
  stimaAvvioMs?: number;
  progress?: number;
  installing?: boolean;
  forceInstall?: boolean;
}

const LARGHEZZA = 440; // px logici della finestra: card + spazio attorno per l'ombra
const MARGINE = 12; // distanza dai bordi dello schermo
// Spazio interno attorno alle card: deve contenere l'ombra PIÙ GRANDE senza tagliarla al
// bordo della finestra trasparente. L'urgente pulsa fino a `0 8px 30px` → blur 30 con offset
// verticale 8: serve ≥30 ai lati e in alto (30−8=22), ≥38 sotto (30+8). Con margine di
// sicurezza. Asimmetrico in verticale perché l'ombra cade più in basso che in alto.
const PAD_X = 40;
const PAD_TOP = 28;
const PAD_BOT = 46;
const GAP_BASSO = 56; // spazio per la barra delle applicazioni
const DURATA_MS = 30_000;
const DURATA_SUGGERIMENTO_MS = 45_000;
const DURATA_URGENTE_MS = 45_000;
const DURATA_MESSAGGIO_MS = 180_000;
const MAX_TOAST = 99; // cap di sicurezza: il mazzo mostra una card e mette il resto in coda
const CARD_W = LARGHEZZA - PAD_X * 2;

function pagamentoIdDaToast(t: Toast): string | undefined {
  if (t.tipo !== "sollecito") return undefined;
  return /^sollecito:([^:]+)/.exec(t.id)?.[1];
}

function prioritaToast(toast: Toast): number {
  if (toast.tipo === "comunicazione" && toast.inCorso) return 0;
  if (toast.tipo === "comunicazione" && toast.erroreComunicazione) return 1;
  return 2;
}

function ordinaToast(toasts: Toast[]): Toast[] {
  return [...toasts].sort(
    (a, b) => prioritaToast(a) - prioritaToast(b),
  );
}

function toastDaStatoComunicazione(
  comunicazione: Comunicazione,
): Toast | null {
  if (["bozza", "da_revisionare", "annullato"].includes(comunicazione.stato)) {
    return null;
  }
  const canale = comunicazione.canale === "email" ? "E-mail" : "WhatsApp";
  const base: Toast = {
    id: `comunicazione-operativa:${comunicazione.id}`,
    tipo: "comunicazione",
    urgenza: "info",
    titolo: "Invio in corso",
    dettaglio: `${canale} · ${comunicazione.recapito}`,
    collegatoTipo: "",
    collegatoId: "",
    collegatoNome: "",
    promemoriaId: "",
    mittenteId: "",
    comunicazioneId: comunicazione.id,
    campagnaId: comunicazione.campagnaId,
  };
  if (comunicazione.stato === "sospeso") {
    return {
      ...base,
      titolo: comunicazione.campagnaId
        ? "Campagna messa in pausa"
        : "Invio in pausa",
      dettaglio: comunicazione.campagnaId
        ? `${canale} · ${comunicazione.recapito}. Riprendi la campagna quando vuoi.`
        : `${canale} · ${comunicazione.recapito}`,
      inCorso: true,
      campagnaInPausa: Boolean(comunicazione.campagnaId),
    };
  }
  if (comunicazione.stato === "in_coda") {
    const stima = STIMA_INVIO_SECONDI[comunicazione.canale];
    return {
      ...base,
      titolo:
        comunicazione.canale === "whatsapp"
          ? "WhatsApp in attesa"
          : "Invio in coda",
      dettaglio:
        comunicazione.canale === "whatsapp"
          ? `${canale} · ${comunicazione.recapito}. Riprende appena il PC è libero · poi ${formattaStimaInvio(stima)}.`
          : `${canale} · ${comunicazione.recapito} · ${formattaStimaInvio(stima)}`,
      inCorso: true,
      progress: 5,
      ripresaWhatsapp: comunicazione.canale === "whatsapp",
    };
  }
  if (comunicazione.stato === "in_invio") {
    const stimaSecondi = STIMA_INVIO_SECONDI[comunicazione.canale];
    return {
      ...base,
      dettaglio:
        comunicazione.canale === "whatsapp"
          ? `${canale} · ${comunicazione.recapito}. Non usare mouse o tastiera finché l’invio non termina.`
          : `${canale} · ${comunicazione.recapito}`,
      inCorso: true,
      progress: 50,
      stimaSecondi,
      stimaAvvioMs: Date.now(),
    };
  }
  if (comunicazione.stato === "fallito") {
    return {
      ...base,
      urgenza: "scaduto",
      titolo: "Invio non riuscito",
      dettaglio:
        comunicazione.ultimoErrore ||
        `${canale} non inviato a ${comunicazione.recapito}.`,
      erroreComunicazione: true,
    };
  }
  if (["invio_azionato", "consegna_verificata"].includes(comunicazione.stato)) {
    return {
      ...base,
      titolo: "Invio completato",
      dettaglio: `${canale} · ${comunicazione.recapito}`,
      progress: 100,
      durataMs: 12_000,
    };
  }
  return null;
}

function compattaComunicazioniOperative(
  comunicazioni: Comunicazione[],
): Toast[] {
  const singole: Toast[] = [];
  const campagne = new Map<string, Comunicazione[]>();
  for (const comunicazione of comunicazioni) {
    if (!comunicazione.campagnaId) {
      const toast = toastDaStatoComunicazione(comunicazione);
      if (toast) singole.push(toast);
      continue;
    }
    const gruppo = campagne.get(comunicazione.campagnaId) ?? [];
    gruppo.push(comunicazione);
    campagne.set(comunicazione.campagnaId, gruppo);
  }
  return [
    ...singole,
    ...[...campagne.values()]
      .map(toastDaStatoCampagna)
      .filter((toast): toast is Toast => toast !== null),
  ];
}

function toastDaStatoCampagna(comunicazioni: Comunicazione[]): Toast | null {
  const prima = comunicazioni[0];
  if (!prima?.campagnaId) return null;
  const riepilogo = riepilogaProgressoComunicazioni(comunicazioni);
  const corrente =
    comunicazioni.find((item) => item.stato === "in_invio") ??
    comunicazioni.find((item) => item.stato === "sospeso") ??
    comunicazioni.find((item) => item.stato === "in_coda") ??
    comunicazioni.find((item) => item.stato === "fallito") ??
    prima;
  const canali = new Set(comunicazioni.map((item) => item.canale));
  const canale =
    canali.size > 1
      ? "E-mail e WhatsApp"
      : corrente.canale === "email"
        ? "E-mail"
        : "WhatsApp";
  const base: Toast = {
    id: `comunicazione-campagna:${prima.campagnaId}`,
    tipo: "comunicazione",
    urgenza: "info",
    titolo: "Invio comunicazioni",
    dettaglio: `${canale} · ${riepilogo.messaggio}`,
    collegatoTipo: "",
    collegatoId: "",
    collegatoNome: "",
    promemoriaId: "",
    mittenteId: "",
    comunicazioneId: corrente.id,
    campagnaId: prima.campagnaId,
    progress: riepilogo.progress,
  };

  if (riepilogo.terminale) {
    // L'annullamento e una scelta esplicita dell'operatore: resta nello storico
    // del Centro comunicazioni, senza generare un'altra notifica di esito.
    if (riepilogo.annullate > 0) return null;
    return {
      ...base,
      urgenza: riepilogo.fallite > 0 ? "scaduto" : "info",
      titolo: riepilogo.fallite > 0 ? "Invio concluso con errori" : "Invio completato",
      progress: 100,
      durataMs: riepilogo.fallite > 0 ? undefined : 12_000,
    };
  }

  const inPausa = riepilogo.sospese > 0;
  return {
    ...base,
    titolo: inPausa ? "Campagna messa in pausa" : "Invio comunicazioni",
    inCorso: true,
    campagnaInPausa: inPausa,
  };
}

export function OverlayWindow() {
  const { zoomUI, balloonAttivo, backupAuto } = usePrefs();
  const premium = usePremiumAccess();
  const ridotte = useAnimazioniRidotte();
  const zoomFactor = zoomUI || 1;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;
  const campagneAnnullateSilenzioseRef = useRef(new Set<string>());
  const identityRef = useRef<Identity | null>(null);
  const contenutoRef = useRef<HTMLDivElement>(null);
  const ultimoPortaDavantiRef = useRef(0);

  // Cap di altezza = area utile dello schermo (esclude la taskbar): oltre, la colonna
  // di card scorre invece di sforare lo schermo.
  const maxH = (typeof window !== "undefined" ? window.screen.availHeight : 800) - 2 * MARGINE;

  useEffect(() => {
    api.whoami().then((i) => (identityRef.current = i)).catch(() => {});
  }, []);

  const portaOverlayDavanti = useCallback(async (forza = false) => {
    if (!inTauri) return;
    const adesso = Date.now();
    if (!forza && adesso - ultimoPortaDavantiRef.current < 300) return;
    ultimoPortaDavantiRef.current = adesso;

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      await win.show().catch(() => {});
      await win.unminimize().catch(() => {});
      // Su Windows alcune finestre always-on-top possono superare l'overlay nel tempo:
      // togglarlo lo riporta in cima senza rubare il focus alla finestra corrente.
      await win.setAlwaysOnTop(false).catch(() => {});
      await win.setAlwaysOnTop(true).catch(() => {});
    } catch {}
  }, []);

  const nascondiOverlayDuranteWhatsapp = useCallback(async () => {
    if (!inTauri) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    } catch {}
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    let attivo = true;
    let off: (() => void) | undefined;
    const versioniCampagna = new Map<string, number>();

    const aggiornaComunicazione = async (payload: Comunicazione) => {
      if (payload.campagnaId) {
        if (payload.stato === "in_coda") {
          // Una ripresa esplicita dal Centro comunicazioni riattiva anche la
          // relativa notifica operativa.
          campagneAnnullateSilenzioseRef.current.delete(payload.campagnaId);
        } else if (
          campagneAnnullateSilenzioseRef.current.has(payload.campagnaId)
        ) {
          setToasts((correnti) =>
            correnti.filter((toast) => toast.campagnaId !== payload.campagnaId),
          );
          return;
        }
      }
      const automazioneWhatsapp =
        payload.canale === "whatsapp" && payload.stato === "in_invio";
      if (automazioneWhatsapp) void nascondiOverlayDuranteWhatsapp();
      if (!balloonAttivo) return;

      let prossimo: Toast | null;
      let whatsappAncoraAttivo =
        payload.canale === "whatsapp" &&
        ["in_coda", "in_invio"].includes(payload.stato);
      if (payload.campagnaId) {
        const versione = (versioniCampagna.get(payload.campagnaId) ?? 0) + 1;
        versioniCampagna.set(payload.campagnaId, versione);
        const tutte = await api.comunicazioniLista().catch(() => []);
        if (
          !attivo ||
          versioniCampagna.get(payload.campagnaId) !== versione
        ) {
          return;
        }
        const elementiCampagna = tutte.filter(
          (item) => item.campagnaId === payload.campagnaId,
        );
        prossimo = toastDaStatoCampagna(elementiCampagna);
        // Una campagna WhatsApp resta nascosta per tutta la sequenza. Mostrarla
        // tra un destinatario e il successivo produceva un continuo lampeggio
        // e poteva coprire i controlli che l'automazione deve verificare.
        whatsappAncoraAttivo = elementiCampagna.some(
          (item) =>
            item.canale === "whatsapp" &&
            ["in_coda", "in_invio"].includes(item.stato),
        ) && !elementiCampagna.some((item) => item.stato === "sospeso");
      } else {
        prossimo = toastDaStatoComunicazione(payload);
      }

      setToasts((correnti) => {
        const senzaPrecedente = correnti.filter(
          (toast) =>
            toast.id !== `comunicazione-operativa:${payload.id}` &&
            !(
              payload.campagnaId &&
              toast.campagnaId === payload.campagnaId &&
              (toast.id.startsWith("comunicazione-operativa:") ||
                toast.id.startsWith("comunicazione-campagna:"))
            ),
        );
        if (!prossimo) return senzaPrecedente;
        return ordinaToast([prossimo, ...senzaPrecedente]).slice(0, MAX_TOAST);
      });

      if (whatsappAncoraAttivo) {
        void nascondiOverlayDuranteWhatsapp();
      } else if (prossimo) {
        void portaOverlayDavanti(true);
      } else {
        window.setTimeout(() => {
          if (toastsRef.current.length > 0) void portaOverlayDavanti(true);
        }, 50);
      }
    };

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<Comunicazione>("pt:comunicazione-stato-locale", ({ payload }) => {
          if (!attivo) return;
          void aggiornaComunicazione(payload);
        }),
      )
      .then((unlisten) => {
        if (attivo) off = unlisten;
        else unlisten();
      })
      .catch(() => {});

    if (balloonAttivo) {
      void api
        .comunicazioniLista()
        .then((comunicazioni) => {
          if (!attivo) return;
          const campagneAttive = new Set(
            comunicazioni
              .filter(
                (item) =>
                  item.campagnaId &&
                  ["in_coda", "in_invio", "sospeso"].includes(item.stato),
              )
              .map((item) => item.campagnaId),
          );
          const operative = compattaComunicazioniOperative(
            comunicazioni.filter(
              (item) =>
                (!item.campagnaId &&
                  ["in_coda", "in_invio", "sospeso"].includes(item.stato)) ||
                (item.campagnaId && campagneAttive.has(item.campagnaId)),
            ),
          );
          setToasts((correnti) => {
            const nonOperative = correnti.filter(
              (toast) => !toast.id.startsWith("comunicazione-operativa:"),
            );
            return ordinaToast([...operative, ...nonOperative]).slice(0, MAX_TOAST);
          });
          const automazioneWhatsapp = comunicazioni.some(
            (item) =>
              item.canale === "whatsapp" &&
              ["in_coda", "in_invio"].includes(item.stato),
          ) && !comunicazioni.some((item) => item.stato === "sospeso");
          if (automazioneWhatsapp) void nascondiOverlayDuranteWhatsapp();
          else if (operative.length > 0) void portaOverlayDavanti(true);
        })
        .catch(() => {});
    }
    return () => {
      attivo = false;
      off?.();
    };
  }, [balloonAttivo, nascondiOverlayDuranteWhatsapp, portaOverlayDavanti]);

  const inserisciToastAggiornamento = useCallback((versione: string, note?: string) => {
    setToasts((cur) => {
      const id = `update:${versione}`;
      if (cur.some((x) => x.id === id)) return cur;
      const ut: Toast = {
        id,
        tipo: "aggiornamento" as TipoNotifica,
        urgenza: "info",
        titolo: `Aggiornamento disponibile · v${versione}`,
        dettaglio: note?.trim() || `È disponibile la versione ${versione}. Clicca per installare.`,
        collegatoTipo: "",
        collegatoId: "",
        collegatoNome: "",
        promemoriaId: "",
        mittenteId: "",
      };
      return [ut, ...cur];
    });
  }, []);

  const inserisciToastInstallUltimaVersione = useCallback(() => {
    setToasts((cur) => {
      const ut: Toast = {
        id: `update-test:${Date.now()}`,
        tipo: "aggiornamento" as TipoNotifica,
        urgenza: "info",
        titolo: "Installa ultima versione",
        dettaglio: "Clicca per installare l'ultima versione pubblicata.",
        collegatoTipo: "",
        collegatoId: "",
        collegatoNome: "",
        promemoriaId: "",
        mittenteId: "",
        forceInstall: true,
      };
      return [ut, ...cur].slice(0, MAX_TOAST);
    });
  }, []);

  // Controllo periodico degli aggiornamenti in background: quando l'app è davvero
  // nascosta in tray e inattiva può installare da sola; altrimenti, se i pop-up sono
  // attivi, resta il normale avviso con azione manuale.
  useEffect(() => {
    if (!inTauri) return;
    let attivo = true;
    let versioneAvvisata: string | null = null;

    async function controlla() {
      try {
        const autoInstallato = await import("../lib/autoAggiornamentoBackground")
          .then(({ provaAggiornamentoAutomaticoBackground }) => provaAggiornamentoAutomaticoBackground())
          .catch(() => false);
        if (!attivo || autoInstallato || !balloonAttivo) return;

        const { controllaAggiornamento, prenotaAvvisoAggiornamento, riallineaDedupVersioneInstallata } = await import("../updater");
        await riallineaDedupVersioneInstallata();
        const controlloRemoto = await import("../remoteControl")
          .then(({ controllaDisattivazioneRemota }) => controllaDisattivazioneRemota())
          .catch(() => null);
        if (!attivo) return;
        if (controlloRemoto?.disabled) {
          await api.notificheDisattivaSessione().catch(() => {});
          return;
        }
        const trovato = await controllaAggiornamento();
        if (!attivo || !trovato) return;
        if (trovato.versione === versioneAvvisata) return;
        if (!prenotaAvvisoAggiornamento(trovato.versione)) return;
        versioneAvvisata = trovato.versione;

        // La notifica update nasce da un flusso dedicato: riallineiamo il webview zoom
        // prima di mostrarla per evitare discrepanze rispetto ai pop-up normali.
        try {
          const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          await getCurrentWebviewWindow().setZoom(zoomFactor);
        } catch {}

        inserisciToastAggiornamento(trovato.versione, trovato.note);
      } catch {}
    }

    // Esegui dopo 12 secondi dall'avvio, poi ogni 6 ore per l'avviso normale.
    // Il tentativo silenzioso è più frequente: i controlli preliminari sono locali
    // e la rete viene usata soltanto dopo 30 minuti reali in tray senza pannelli.
    const t0 = window.setTimeout(() => void controlla(), 12000);
    const ivSilenzioso = window.setInterval(() => {
      void import("../lib/autoAggiornamentoBackground")
        .then(({ provaAggiornamentoAutomaticoBackground }) => provaAggiornamentoAutomaticoBackground())
        .catch(() => false);
    }, 15 * 60 * 1000);
    let iv: ReturnType<typeof window.setInterval> | undefined;
    import("../updater")
      .then(({ INTERVALLO_CONTROLLO_AGGIORNAMENTI_MS }) => {
        if (attivo) iv = window.setInterval(() => void controlla(), INTERVALLO_CONTROLLO_AGGIORNAMENTI_MS);
      })
      .catch(() => {
        if (attivo) iv = window.setInterval(() => void controlla(), 6 * 60 * 60 * 1000);
      });

    return () => {
      attivo = false;
      window.clearTimeout(t0);
      window.clearInterval(ivSilenzioso);
      if (iv) window.clearInterval(iv);
    };
  }, [balloonAttivo, zoomFactor, inserisciToastAggiornamento]);

  // Un heartbeat Rust mostra temporaneamente questo overlay trasparente quando la
  // main e' nascosta. Cosi' WebView2 non puo' congelare il timer proprio mentre deve
  // controllare/installare un update. Spotlight e gli altri pannelli restano bloccanti.
  useEffect(() => {
    if (!inTauri) return;
    let attivo = true;
    let unlistenFn: (() => void) | null = null;

    Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/webviewWindow"),
    ]).then(([{ listen }, { getCurrentWebviewWindow }]) =>
      listen("pt:background-maintenance", () => {
        if (!attivo) return;
        const finestra = getCurrentWebviewWindow();
        void import("../lib/autoAggiornamentoBackground")
          .then(({ provaAggiornamentoAutomaticoBackground }) =>
            provaAggiornamentoAutomaticoBackground(
              true,
              () => toastsRef.current.length === 0
            )
          )
          .catch(() => false)
          .finally(() => {
            if (attivo && toastsRef.current.length === 0) {
              void finestra.hide().catch(() => {});
            }
          });
      })
    ).then((fn) => {
      if (attivo) unlistenFn = fn;
      else fn();
    }).catch(() => {});

    return () => {
      attivo = false;
      unlistenFn?.();
    };
  }, []);

  // Controllo periodico del backup automatico in background (ogni ora) se backupAuto > 0
  useEffect(() => {
    if (!inTauri || backupAuto <= 0) return;
    let attivo = true;

    async function controlla() {
      try {
        const controlloRemoto = await import("../remoteControl")
          .then(({ controllaDisattivazioneRemota }) => controllaDisattivazioneRemota())
          .catch(() => null);
        if (!attivo) return;
        if (controlloRemoto?.disabled) {
          await api.notificheDisattivaSessione().catch(() => {});
          return;
        }

        const identity = await api.whoami().catch(() => null);
        if (!attivo || !identity) return; // Non siamo loggati / onboarding attivo

        const backups = await api.listaBackup();
        if (!attivo) return;
        if (backups.length === 0) {
          const primoAvvio = !localStorage.getItem("pt.backupInizializzato");
          if (primoAvvio) {
            localStorage.setItem("pt.backupInizializzato", "true");
            return;
          }
        }
        const ultimo = backups.reduce((max, b) => Math.max(max, b.ms), 0);
        if (Date.now() - ultimo >= backupAuto * 86_400_000) {
          await api.backupNowProgress(`backup-auto-${Date.now()}`);
          localStorage.setItem("pt.toastAutoBackup", "1");
          window.dispatchEvent(new CustomEvent("pt:backup-auto-eseguito"));
          import("@tauri-apps/api/event")
            .then(({ emit }) => emit("pt:backup-auto-eseguito"))
            .catch(() => {});
        }
      } catch {}
    }

    // Esegui dopo 15 secondi dall'avvio, poi ogni ora
    const t0 = window.setTimeout(() => void controlla(), 15000);
    const iv = window.setInterval(() => void controlla(), 60 * 60 * 1000);

    return () => {
      attivo = false;
      window.clearTimeout(t0);
      window.clearInterval(iv);
    };
  }, [backupAuto]);

  const rimuovi = useCallback((id: string) => {
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }, []);

  // Aprendo la campanella spariscono soltanto gli avvisi ordinari. Le card operative
  // sono anche i controlli della coda e devono sopravvivere a questa pulizia.
  const pulisci = useCallback(() => {
    setToasts((correnti) =>
      correnti.filter(
        (toast) => toast.tipo === "comunicazione" && toast.inCorso,
      ),
    );
  }, []);

  // Ascolta le notifiche nuove dal rilevatore Rust e la richiesta di pulizia locale
  // emessa quando l'utente apre esplicitamente la campanella.
  useEffect(() => {
    if (!inTauri) return;
    let attivo = true;
    const disiscrizioni: Array<() => void> = [];

    import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
        if (!attivo) return;
        const w = getCurrentWebviewWindow();

        // Tutti questi eventi sono emessi mirati alla finestra "overlay" da Rust (via emit_to)
        const promesse = [
          w.listen("pt:overlay-pulisci", () => pulisci()),
          w.listen("pt:overlay-pulisci-sessione", () => {
            setToasts((cur) => cur.filter((t) => t.tipo === "aggiornamento"));
          }),
          w.listen<string[]>("pt:overlay-rimuovi-notifiche", (ev) => {
            const ids = new Set(ev.payload ?? []);
            if (ids.size > 0) setToasts((cur) => cur.filter((t) => !ids.has(t.id)));
          }),
          w.listen<string>("pt:suona-notifica", (ev) => {
            const suono = ev.payload || "campanello";
            if (suono !== "nessuno") riproduciSuono(suono);
          }),
          w.listen<Toast[]>("pt:notifiche-nuove", (ev) => {
            const nuove = ev.payload ?? [];
            if (nuove.length > 0) void portaOverlayDavanti(true);
            setToasts((cur) => {
              const presenti = new Set(cur.map((t) => t.id));
              const aggiunte = nuove.filter((t) => !presenti.has(t.id));
              if (aggiunte.length === 0) return cur;
              return ordinaToast([...cur, ...aggiunte]).slice(0, MAX_TOAST);
            });
          }),
          w.listen("pt:update-test", () => {
            if (attivo) inserisciToastInstallUltimaVersione();
          }),
        ];

        Promise.all(promesse).then((unsubs) => {
          if (!attivo) {
            unsubs.forEach((u) => u());
          } else {
            disiscrizioni.push(...unsubs);
            void api.notificheOverlayPronto(true).catch(() => {});
          }
        });
    });

    return () => {
      attivo = false;
      void api.notificheOverlayPronto(false).catch(() => {});
      disiscrizioni.forEach((u) => u());
    };
  }, [rimuovi, pulisci, zoomFactor, inserisciToastAggiornamento, inserisciToastInstallUltimaVersione, portaOverlayDavanti]);

  useEffect(() => {
    if (!inTauri || toasts.length === 0) return;
    const t = window.setTimeout(() => void portaOverlayDavanti(), 80);
    return () => window.clearTimeout(t);
  }, [toasts.length, portaOverlayDavanti]);

  // Ridimensiona la finestra al contenuto + click-through quando è vuota. La misura
  // avviene sul contenitore interno (cambia solo coi toast, non col resize finestra →
  // niente loop). Riposiziona in basso a destra del monitor corrente.
  useEffect(() => {
    if (!inTauri) return;
    const el = contenutoRef.current;
    if (!el) return;

    let annulla = false;
    async function applica(altezza: number, ignoraClick: boolean, riduciFinestra: boolean) {
      const { getCurrentWindow, LogicalSize, LogicalPosition, currentMonitor } = await import(
        "@tauri-apps/api/window"
      );
      if (annulla) return;
      const win = getCurrentWindow();

      // Recuperiamo il monitor e impostiamo ignoreCursorEvents/visibilità in parallelo.
      // La finestra resta NASCOSTA quando è vuota: mostrarla da vuota faceva lampeggiare
      // un rettangolo grigio in basso a destra all'avvio (il webview trasparente non era
      // ancora dipinto). La mostriamo solo quando ci sono pop-up da far vedere.
      const [mon] = await Promise.all([
        currentMonitor().catch(() => null),
        win.setIgnoreCursorEvents(ignoraClick).catch(() => {}),
        (riduciFinestra ? win.hide() : win.show().then(() => win.setAlwaysOnTop(true))).catch(() => {}),
      ]);

      if (annulla) return;

      // La larghezza resta fissa (layout corretto delle card anche a finestra vuota); la
      // teniamo SEMPRE ancorata in basso a destra — anche da vuota, così non copre mai la
      // topbar nei primi istanti dopo l'avvio. Da vuota l'altezza è minima.
      const w = LARGHEZZA * zoomFactor;
      const h = riduciFinestra ? 80 * zoomFactor : Math.min(maxH, Math.max(60 * zoomFactor, Math.ceil(altezza * zoomFactor)));

      if (mon) {
        const s = mon.scaleFactor || 1;
        const monX = mon.position.x / s;
        const monY = mon.position.y / s;
        const monW = mon.size.width / s;
        const monH = mon.size.height / s;
        const x = monX + monW - w - MARGINE;
        const y = monY + monH - h - GAP_BASSO;

        // Impostiamo sia la dimensione che la posizione in parallelo, in modo che
        // l'OS possa applicarle contemporaneamente, eliminando lo spasmo visibile.
        await Promise.all([
          win.setSize(new LogicalSize(w, h)),
          win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)))
        ]).catch(() => {});
      } else {
        await win.setSize(new LogicalSize(w, h)).catch(() => {});
      }
    }

    const misura = () => {
      const r = el.getBoundingClientRect();
      const effettivoVuoto = toasts.length === 0 && r.height < 90;
      void applica(r.height, toasts.length === 0, effettivoVuoto);
    };
    misura();
    const ro = new ResizeObserver(misura);
    ro.observe(el);
    return () => {
      annulla = true;
      ro.disconnect();
    };
  }, [toasts.length, maxH, zoomFactor]);

  function naviga(t: Toast) {
    const identity = identityRef.current ?? undefined;
    if (t.tipo === "comunicazione" && t.comunicazioneId) {
      void apriCentroComunicazioniDaNotifica(t.comunicazioneId);
    } else if (t.suggerimentoCollegamento) {
      void vaiAllaPrincipale(
        deepLinkSuggerimento(t.suggerimentoCollegamento),
      );
    } else if (t.promemoriaId) {
      void apriFinestraPromemoria(identity, undefined, t.promemoriaId);
    } else if (t.collegatoTipo === "ordine" && t.collegatoId) {
      const pagamentoId = pagamentoIdDaToast(t);
      if (pagamentoId) {
        void apriFinestraPagamento(pagamentoId, identity);
      } else {
        void apriFinestraOrdine(t.collegatoId, t.collegatoNome, identity);
      }
    } else if (t.collegatoTipo && t.collegatoId) {
      void apriRiepilogo(t.collegatoTipo as TipoRiepilogo, t.collegatoId, t.collegatoNome, identity);
    }
  }

  async function avviaAggiornamento(t: Toast) {
    if (localStorage.getItem("pt.aggiornando") === "1") return;
    localStorage.setItem("pt.aggiornando", "1");
    setToasts((cur) =>
      cur.map((x) =>
        x.id === t.id
          ? {
              ...x,
              titolo: "Aggiornamento in corso",
              dettaglio: "Preparo l'aggiornamento...",
              progress: 3,
              installing: true,
            }
          : x
      )
    );
    try {
      const { installaAggiornamento } = await import("../updater");
      await installaAggiornamento(undefined, (p) => {
        setToasts((cur) =>
          cur.map((x) =>
            x.id === t.id
              ? {
                  ...x,
                  titolo:
                    p.fase === "scarico"
                      ? "Scarico l'aggiornamento"
                      : p.fase === "installo"
                        ? "Installo l'aggiornamento"
                        : p.fase === "riavvio"
                          ? "Riavvio in corso"
                          : "Aggiornamento in corso",
                  dettaglio: p.messaggio,
                  progress: p.percentuale,
                  installing: true,
                }
              : x
          )
        );
      });
    } catch (e) {
      localStorage.removeItem("pt.aggiornando");
      setToasts((cur) =>
        cur.map((x) =>
          x.id === t.id
            ? {
                ...x,
                titolo: "Aggiornamento fallito",
                dettaglio: String(e),
                progress: undefined,
                installing: false,
              }
            : x
        )
      );
    }
  }

  async function avviaInstallUltimaVersione(t: Toast) {
    if (localStorage.getItem("pt.aggiornando") === "1") return;
    localStorage.setItem("pt.aggiornando", "1");
    setToasts((cur) =>
      cur.map((x) =>
        x.id === t.id
          ? {
              ...x,
              titolo: "Aggiornamento in corso",
              dettaglio: "Preparo l'aggiornamento...",
              progress: 3,
              installing: true,
            }
          : x
      )
    );
    try {
      const { installaUltimaVersione } = await import("../updater");
      await installaUltimaVersione((p) => {
        setToasts((cur) =>
          cur.map((x) =>
            x.id === t.id
              ? {
                  ...x,
                  titolo:
                    p.fase === "scarico"
                      ? "Scarico l'aggiornamento"
                      : p.fase === "installo"
                        ? "Installo l'aggiornamento"
                        : p.fase === "riavvio"
                          ? "Riavvio in corso"
                          : "Aggiornamento in corso",
                  dettaglio: p.messaggio,
                  progress: p.percentuale,
                  installing: true,
                }
              : x
          )
        );
      });
      setToasts((cur) =>
        cur.map((x) =>
          x.id === t.id
            ? {
                ...x,
                titolo: "Aggiornamento installato",
                dettaglio: "Riavvio il gestionale...",
                progress: 100,
                installing: true,
              }
            : x
        )
      );
    } catch (e) {
      setToasts((cur) =>
        cur.map((x) =>
          x.id === t.id
            ? {
                ...x,
                titolo: "Aggiornamento fallito",
                dettaglio: String(e),
                progress: undefined,
                installing: false,
              }
            : x
        )
      );
    } finally {
      localStorage.removeItem("pt.aggiornando");
    }
  }

  function onClick(t: Toast) {
    if (t.forceInstall || t.id.startsWith("update-test:")) {
      void avviaInstallUltimaVersione(t);
      return;
    }
    if (t.id.startsWith("update:")) {
      void avviaAggiornamento(t);
      return;
    }
    if (t.tipo === "comunicazione" && t.comunicazioneId) {
      if (t.erroreComunicazione) {
        aggiornaStatoNotificheComunicazioniLocale(
          [`comunicazione:${t.comunicazioneId}`],
          identityRef.current?.userId,
        );
      }
      naviga(t);
      // Una comunicazione operativa rappresenta anche i controlli della coda:
      // aprire il Centro non deve far sparire pausa/annullamento/ripresa.
      if (!t.inCorso) rimuovi(t.id);
      return;
    }
    void segnaLetta(t.id, identityRef.current ?? undefined, false).catch(() => {});
    naviga(t);
    rimuovi(t.id);
  }

  const mostraRiepilogoPausa = useCallback(
    (comunicazioni: Comunicazione[], campagnaId: string) => {
      const riferimento =
        comunicazioni.find((item) => item.stato === "sospeso") ??
        comunicazioni.find((item) =>
          ["in_coda", "in_invio"].includes(item.stato),
        );
      if (!riferimento) return;
      const pausa = toastDaStatoComunicazione({
        ...riferimento,
        stato: "sospeso",
      });
      if (!pausa) return;
      setToasts((correnti) => {
        const altreCampagne = correnti.filter(
          (toast) => toast.campagnaId !== campagnaId,
        );
        return ordinaToast([pausa, ...altreCampagne]).slice(0, MAX_TOAST);
      });
      void portaOverlayDavanti(true);
    },
    [portaOverlayDavanti],
  );

  const impostaAnnullamentoSilenzioso = useCallback(
    (campagnaId: string, attivo: boolean) => {
      if (attivo) campagneAnnullateSilenzioseRef.current.add(campagnaId);
      else campagneAnnullateSilenzioseRef.current.delete(campagnaId);
    },
    [],
  );

  const active = toasts[0];
  const queued = Math.max(0, toasts.length - 1);

  return (
    // La finestra è ancorata in basso a destra: il contenitore allinea il mazzo in alto.
    <Box style={{ height: "100vh", display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
      {premium.enabled && (
        <Suspense fallback={null}>
          <SuggerimentoDuplicatiWorker />
        </Suspense>
      )}
      <div
        ref={contenutoRef}
        // overflow VISIBILE: nessuna scrollbar e l'ombra delle card non viene mai tagliata
        // (il contenitore non taglia i figli). Le card eccedenti sono limitate da MAX_TOAST,
        // quindi la colonna non supera mai l'altezza utile dello schermo.
        style={{ overflow: "visible" }}
      >
        <Box pt={PAD_TOP} pb={PAD_BOT} px={PAD_X}>
          <Box
            style={{
              position: "relative",
              width: CARD_W,
              isolation: "isolate",
              pointerEvents: active ? "auto" : "none",
            }}
          >
            <DeckBackplates count={queued} />
            <AnimatePresence initial={false} mode="popLayout">
              {active && (
                <motion.div
                  key={active.id}
                  initial={ridotte ? false : { opacity: 0, x: -30, scale: 0.96 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={ridotte ? undefined : { opacity: 0, x: 30, scale: 0.96 }}
                  transition={ridotte ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30 }}
                >
                  <CardNotifica
                    t={active}
                    identity={identityRef.current ?? undefined}
                    onClick={() => onClick(active)}
                    onChiudi={() => rimuovi(active.id)}
                    onCampagnaSospesa={mostraRiepilogoPausa}
                    onCampagnaAnnullamento={impostaAnnullamentoSilenzioso}
                    onIgnora={() => {
                      if (
                        active.erroreComunicazione &&
                        active.comunicazioneId
                      ) {
                        aggiornaStatoNotificheComunicazioniLocale(
                          [`comunicazione:${active.comunicazioneId}`],
                          identityRef.current?.userId,
                          true,
                        );
                      }
                      rimuovi(active.id);
                    }}
                    onLetta={() => void segnaLetta(active.id, identityRef.current ?? undefined, false).catch(() => {})}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </Box>
        </Box>
      </div>
    </Box>
  );
}

function DeckBackplates({ count }: { count: number }) {
  const visible = Math.min(count, 3);
  if (visible === 0) return null;

  return (
    <>
      {Array.from({ length: visible }).map((_, i) => {
        const layer = i + 1;
        return (
          <Box
            key={layer}
            style={{
              position: "absolute",
              left: layer * 18,
              right: layer * 18,
              bottom: -layer * 7,
              height: 22,
              zIndex: -layer,
              borderRadius: "0 0 14px 14px",
              border: "1px solid rgba(29, 39, 51, 0.08)",
              background: "rgba(255, 255, 255, 0.9)",
              boxShadow: "0 8px 22px rgba(29, 39, 51, 0.12)",
              opacity: 0.72 - i * 0.18,
              pointerEvents: "none",
            }}
          />
        );
      })}
      <Box
        style={{
          position: "absolute",
          right: 10,
          bottom: -12,
          zIndex: 4,
          minWidth: 24,
          height: 24,
          padding: "0 8px",
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          background: "var(--mantine-color-dark-7)",
          color: "white",
          fontSize: 11,
          fontWeight: 800,
          boxShadow: "0 8px 20px rgba(29, 39, 51, 0.26)",
          pointerEvents: "none",
        }}
      >
        +{count}
      </Box>
    </>
  );
}

function CardNotifica({
  t,
  identity,
  onClick,
  onChiudi,
  onCampagnaSospesa,
  onCampagnaAnnullamento,
  onIgnora,
  onLetta,
}: {
  t: Toast;
  identity?: Identity;
  onClick: () => void;
  onChiudi: () => void;
  onCampagnaSospesa: (
    comunicazioni: Comunicazione[],
    campagnaId: string,
  ) => void;
  onCampagnaAnnullamento: (campagnaId: string, attivo: boolean) => void;
  onIgnora: () => void;
  onLetta: () => void;
}) {
  const ridotte = useAnimazioniRidotte();
  const [rispondi, setRispondi] = useState(false);
  const [hover, setHover] = useState(false);
  const [riprovaInCorso, setRiprovaInCorso] = useState(false);
  const [azioneComunicazioneInCorso, setAzioneComunicazioneInCorso] =
    useState(false);
  const [erroreAzioneComunicazione, setErroreAzioneComunicazione] =
    useState("");
  const [oraStima, setOraStima] = useState(() => Date.now());
  const def = TIPO_NOTIFICA[t.tipo];
  const colore = COLORE_URGENZA[t.urgenza];
  const urgente = t.urgenza === "scaduto";
  const messaggio = t.tipo === "messaggio";
  const progress = t.progress == null ? null : Math.max(0, Math.min(100, t.progress));
  const mittenteNome = t.titolo.replace(/^💬\s*/, "");
  const onChiudiRef = useRef(onChiudi);
  const durataBase = messaggio
    ? DURATA_MESSAGGIO_MS
    : t.tipo === "suggerimento"
      ? DURATA_SUGGERIMENTO_MS
      : urgente
        ? DURATA_URGENTE_MS
        : DURATA_MS;
  const paroleNotifica = `${t.titolo} ${t.dettaglio}`
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const durata =
    t.durataMs ?? Math.max(durataBase, 2_500 + paroleNotifica * 380);
  const residuoTimerRef = useRef(durata);
  const timerStartRef = useRef(0);
  const secondiResidui =
    t.inCorso && t.stimaSecondi && t.stimaAvvioMs
      ? Math.max(
          0,
          Math.ceil(
            (t.stimaAvvioMs + t.stimaSecondi * 1_000 - oraStima) / 1_000,
          ),
        )
      : null;

  const riprendiWhatsapp = async () => {
    if (!t.comunicazioneId || azioneComunicazioneInCorso) return;
    setErroreAzioneComunicazione("");
    setAzioneComunicazioneInCorso(true);
    try {
      await api.comunicazioneWhatsappRiprendi(t.comunicazioneId);
    } catch (error) {
      setErroreAzioneComunicazione(String(error));
    } finally {
      setAzioneComunicazioneInCorso(false);
    }
  };

  const riprendiCampagna = async () => {
    if (!t.campagnaId || azioneComunicazioneInCorso) return;
    setErroreAzioneComunicazione("");
    setAzioneComunicazioneInCorso(true);
    try {
      await api.campagnaComunicazioneRiprendi(t.campagnaId);
      // Per una campagna sospesa gli eventi di stato trasformano direttamente
      // questa card in "in attesa": non deve sparire durante la ripresa.
      if (!t.campagnaInPausa) onChiudi();
    } catch (error) {
      setErroreAzioneComunicazione(String(error));
    } finally {
      setAzioneComunicazioneInCorso(false);
    }
  };

  const annullaODismiss = async () => {
    if (
      t.tipo !== "comunicazione" ||
      !t.inCorso ||
      !t.comunicazioneId
    ) {
      if (t.erroreComunicazione) onIgnora();
      else onChiudi();
      return;
    }
    setErroreAzioneComunicazione("");
    setAzioneComunicazioneInCorso(true);
    try {
      if (t.campagnaId && !t.campagnaInPausa) {
        // La X della notifica operativa mette in pausa l'intera campagna.
        // Aggiorniamo anche localmente la card: non dipende dai tempi degli eventi.
        const aggiornate = await api.campagnaComunicazioneSospendi(t.campagnaId);
        onCampagnaSospesa(aggiornate, t.campagnaId);
        return;
      }
      if (t.campagnaId) {
        onCampagnaAnnullamento(t.campagnaId, true);
        try {
          await api.campagnaComunicazioneAnnulla(t.campagnaId);
        } catch (error) {
          onCampagnaAnnullamento(t.campagnaId, false);
          throw error;
        }
        // L'annullamento resta consultabile nel Centro comunicazioni ma non
        // produce una nuova card: la X chiude definitivamente questo flusso.
        onChiudi();
      } else {
        await api.comunicazioneAnnulla(t.comunicazioneId);
        onChiudi();
      }
    } catch (error) {
      setErroreAzioneComunicazione(String(error));
    } finally {
      setAzioneComunicazioneInCorso(false);
    }
  };

  useEffect(() => {
    if (!t.inCorso || !t.stimaSecondi || !t.stimaAvvioMs) return;
    setOraStima(Date.now());
    const scadenza = t.stimaAvvioMs + t.stimaSecondi * 1_000;
    const intervallo = window.setInterval(() => {
      const adesso = Date.now();
      setOraStima(adesso);
      if (adesso >= scadenza) window.clearInterval(intervallo);
    }, 1_000);
    return () => window.clearInterval(intervallo);
  }, [t.id, t.inCorso, t.stimaAvvioMs, t.stimaSecondi]);

  useEffect(() => {
    onChiudiRef.current = onChiudi;
  }, [onChiudi]);

  useEffect(() => {
    residuoTimerRef.current = durata;
  }, [durata, t.id]);

  // Autoscomparsa: 15s per le notifiche ordinarie, 180s per i messaggi. Hover e
  // composer sospendono il conto alla rovescia mantenendo il tempo residuo.
  // Esclude le notifiche di aggiornamento (non hanno scadenza).
  useEffect(() => {
    if (
      hover ||
      rispondi ||
      t.tipo === "aggiornamento" ||
      urgente ||
      t.inCorso ||
      t.erroreComunicazione
    ) {
      return;
    }
    timerStartRef.current = Date.now();
    const h = window.setTimeout(() => onChiudiRef.current(), residuoTimerRef.current);
    return () => {
      window.clearTimeout(h);
      const elapsed = Date.now() - timerStartRef.current;
      residuoTimerRef.current = Math.max(0, residuoTimerRef.current - elapsed);
    };
  }, [hover, rispondi, t.id, t.tipo, urgente, t.inCorso, t.erroreComunicazione]);

  return (
    <motion.div
      // Le urgenti pulsano dolcemente finché non vengono gestite.
      animate={urgente && !ridotte ? { boxShadow: ["0 8px 24px rgba(0,0,0,0.18)", "0 8px 30px rgba(224,49,49,0.45)", "0 8px 24px rgba(0,0,0,0.18)"] } : undefined}
      transition={urgente && !ridotte ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : undefined}
      style={{
        background: "var(--mantine-color-body, #fff)",
        border: "1px solid var(--border, #e9ecef)",
        borderLeft: `4px solid var(--mantine-color-${colore}-6)`,
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Group
        align="flex-start"
        gap={10}
        wrap="nowrap"
        p={12}
        onClick={messaggio || t.installing ? undefined : onClick}
        style={{ cursor: messaggio || t.installing ? "default" : "pointer" }}
      >
        <ThemeIcon variant="light" color={def.color} radius="md" size="lg">
          <motion.div
            animate={
              t.inCorso && t.tipo === "comunicazione" && !ridotte
                ? { x: [-2, 3, -2], opacity: [0.62, 1, 0.62] }
                : t.installing &&
                    t.tipo === "aggiornamento" &&
                    !ridotte
                  ? { rotate: 360 }
                  : { rotate: 0, x: 0, opacity: 1 }
            }
            transition={
              t.inCorso && t.tipo === "comunicazione" && !ridotte
                ? { duration: 1.05, repeat: Infinity, ease: "easeInOut" }
                : t.installing && t.tipo === "aggiornamento" && !ridotte
                ? { duration: 0.9, repeat: Infinity, ease: "linear" }
                : { duration: 0.15 }
            }
            style={{ display: "flex" }}
          >
            <def.Ico size={18} />
          </motion.div>
        </ThemeIcon>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text fw={700} size="sm" lineClamp={2}>
            {t.titolo}
          </Text>
          {t.dettaglio && (
            <Text size="xs" c="dimmed" lineClamp={3}>
              {t.dettaglio}
              {secondiResidui !== null && (
                <motion.span
                  key={secondiResidui}
                  initial={ridotte ? false : { opacity: 0.45, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16 }}
                >
                  {secondiResidui > 0
                    ? ` · circa ${secondiResidui} s`
                    : " · ultimi istanti"}
                </motion.span>
              )}
            </Text>
          )}
          {messaggio && (
            <ActionIcon
              variant="light"
              color="grape"
              size="sm"
              mt={6}
              onClick={(e) => {
                e.stopPropagation();
                onLetta();
                setRispondi((prev) => !prev);
              }}
              aria-label="Rispondi"
            >
              <IconCornerUpLeft size={15} />
            </ActionIcon>
          )}
          {t.erroreComunicazione && t.comunicazioneId && (
            <Button
              size="compact-xs"
              variant="light"
              color="red"
              mt={7}
              loading={riprovaInCorso}
              onClick={(event) => {
                event.stopPropagation();
                setRiprovaInCorso(true);
                void api
                  .comunicazioneMettiInCoda(t.comunicazioneId!)
                  .then(() => onChiudi())
                  .catch(() => setRiprovaInCorso(false));
              }}
            >
              Riprova
            </Button>
          )}
          {t.ripresaWhatsapp && t.comunicazioneId && (
            <Button
              size="compact-xs"
              variant="light"
              color="blue"
              mt={7}
              leftSection={<IconPlayerPlay size={13} />}
              loading={azioneComunicazioneInCorso}
              onClick={(event) => {
                event.stopPropagation();
                void riprendiWhatsapp();
              }}
            >
              Riprendi ora
            </Button>
          )}
          {t.campagnaInPausa && t.campagnaId && (
            <Button
              size="compact-xs"
              variant="light"
              color="blue"
              mt={7}
              leftSection={<IconPlayerPlay size={13} />}
              loading={azioneComunicazioneInCorso}
              onClick={(event) => {
                event.stopPropagation();
                void riprendiCampagna();
              }}
            >
              Riprendi campagna
            </Button>
          )}
          {erroreAzioneComunicazione && (
            <Text size="xs" c="red" mt={5} lineClamp={2}>
              {erroreAzioneComunicazione}
            </Text>
          )}
        </Box>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          disabled={t.installing}
          loading={azioneComunicazioneInCorso}
          onClick={(e) => {
            e.stopPropagation();
            void annullaODismiss();
          }}
          aria-label={
            t.tipo === "comunicazione" && t.inCorso
              ? t.campagnaInPausa
                ? "Annulla definitivamente la campagna"
                : t.campagnaId
                  ? "Metti in pausa la campagna"
                  : "Annulla l'invio"
              : "Chiudi"
          }
        >
          <IconX size={15} />
        </ActionIcon>
      </Group>
      {progress != null && (
        <Box
          style={{
            height: 3,
            width: "100%",
            background: `var(--mantine-color-${def.color}-1)`,
          }}
        >
          <Box
            style={{
              height: "100%",
              width: `${progress}%`,
              background: `var(--mantine-color-${def.color}-6)`,
              transition: "width 220ms ease",
            }}
          />
        </Box>
      )}

      <AnimatePresence initial={false}>
        {rispondi && (
          <motion.div
            initial={ridotte ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={ridotte ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: ridotte ? 0 : 0.18 }}
            style={{ overflow: "hidden" }}
          >
            <Box px={12} pb={12}>
              <ComposerMessaggio
                identity={identity}
                rispostaA={{ mittenteId: t.mittenteId, mittenteNome, parent: t.id }}
                onInviato={onChiudi}
                onAnnulla={() => {
                  setRispondi(false);
                }}
              />
            </Box>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
