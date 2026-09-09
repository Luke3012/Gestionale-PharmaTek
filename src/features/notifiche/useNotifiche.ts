// Hook centrale della campanella (FASE 6D). Carica i dati, deriva le notifiche
// correnti, tiene gli stati per-utente (viste/scartate) e aggiorna il badge tray.
// Il **suono e i pop-up NON li decide il webview**: li gestisce il rilevatore Rust
// (`src-tauri/src/notifiche.rs`), affidabile anche a finestra nascosta dove WebView2
// congela JS+audio. Un solo "suonatore" (il Rust) ⇒ mai due volte. La main configura
// il core; questo hook della Topbar lo stimola a ogni ricarica (`notifiche_check`).
// La finestra Notifiche riusa l'hook in modalità di sola lettura, senza coordinare il core.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, inTauri, type Identity } from "../../lib/tauri";
import { usePrefs } from "../../lib/prefs";
import { listaPromemoria } from "../promemoria/promemoria";
import { listaMessaggi } from "./messaggi";
import { riproduciSuono } from "./suoni";
import { toast } from "../../ui/toast/store";
import { attendiCreazioneFinestra } from "../../lib/finestreTauri";
import { collegaDisiscrizioneAsincrona } from "../../lib/disiscrizioneAsincrona";
import { usePremiumAccess } from "../../premium/PremiumAccess";
import {
  caricaStati,
  contaNonVisteConStatiLocali,
  derivaNotifiche,
  scarta as scartaUna,
  scartaTutte as scartaTutteApi,
  segnaLetta,
  type Notifica,
  type StatiNotifiche,
} from "./notifiche";
import {
  aggiornaStatoNotificheComunicazioniLocale,
  chiaveStatoComunicazioni,
  EVENTO_STATO_COMUNICAZIONI_LOCALI,
  leggiStatoNotificheComunicazioniLocale,
  type StatoNotificheComunicazioniLocale,
} from "./statoComunicazioniLocale";

/** Crea la finestra `overlay` a RUNTIME (come ordine/promemoria), invece che da
 *  `tauri.conf.json`: le finestre di config in dev nascono prima che Vite serva e il loro
 *  webview restava «morto» (renderer mai avviato → i pop-up non comparivano mai). Creandola
 *  qui, dalla finestra principale già viva, il renderer parte e riceve i `pt:notifiche-nuove`.
 *  Idempotente: se esiste già non fa nulla. La crea SOLO la finestra principale. */
let creazioneOverlayInCorso: Promise<void> | null = null;

export async function assicuraFinestraOverlay(): Promise<void> {
  if (!inTauri) return;
  if (typeof window !== "undefined" && window.location.search) return; // solo la main (no query)
  if (creazioneOverlayInCorso) return creazioneOverlayInCorso;
  const creazione = (async () => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      if (await WebviewWindow.getByLabel("overlay")) return;
      const overlay = new WebviewWindow("overlay", {
        url: "index.html?overlay",
        title: "Notifiche — PharmaTek",
        width: 380,
        height: 120,
        visible: false,
        focus: false,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        shadow: false,
      });
      await attendiCreazioneFinestra(overlay);
    } catch {
      /* creazione overlay non riuscita: i pop-up non compariranno, ma badge/suono restano */
    }
  })();
  creazioneOverlayInCorso = creazione;
  try {
    await creazione;
  } finally {
    if (creazioneOverlayInCorso === creazione) creazioneOverlayInCorso = null;
  }
}

export interface NotificheState {
  notifiche: Notifica[];
  viste: Set<string>;
  scartate: Set<string>;
  visteComunicazioniLocali: Set<string>;
  scartateComunicazioniLocali: Set<string>;
  nonLette: number;
  caricando: boolean;
  ricarica: () => void;
  /** Segna letta (click): resta in lista, esce dal badge. */
  segna: (id: string) => Promise<void>;
  /** Scarta (dismiss): la toglie dalla lista. */
  scarta: (id: string) => Promise<void>;
  /** Scarta tutte quelle visibili. */
  scartaTutte: (ids: string[]) => Promise<void>;
  segnaComunicazioneLocale: (id: string) => void;
  scartaComunicazioneLocale: (id: string) => void;
  scartaComunicazioniLocali: (ids: string[]) => void;
}

export function useNotifiche(
  identity?: Identity,
  coordinaRilevatoreCentrale = true,
): NotificheState {
  const {
    sogliaSolleciti,
    suonoNotifica,
    preferenzeSuggerimenti,
  } = usePrefs();
  const premium = usePremiumAccess();
  const [notifiche, setNotifiche] = useState<Notifica[]>([]);
  const [stati, setStati] = useState<StatiNotifiche>({ viste: new Set(), scartate: new Set() });
  const [statiComunicazioniLocali, setStatiComunicazioniLocali] =
    useState<StatoNotificheComunicazioniLocale>(() =>
      leggiStatoNotificheComunicazioniLocale(identity?.userId),
    );
  const [caricando, setCaricando] = useState(true);
  const caricaSeqRef = useRef(0);
  const scartateOttimisticheRef = useRef<Set<string>>(new Set());

  // Il suono ha un **solo "suonatore": il Rust** (`notifiche.rs::avvisa`), affidabile e
  // mai doppio. Qui il webview non decide più nulla: si limita a *eseguire* il suono
  // quando il Rust glielo chiede (`pt:suona-notifica`), perché HTMLAudioElement funziona
  // anche dove rodio non riesce ad aprire l'uscita audio del PC. `suonoRef` tiene la
  // preferenza corrente per quel listener.
  const suonoRef = useRef(suonoNotifica);
  suonoRef.current = suonoNotifica;

  const carica = useCallback(async () => {
    const seq = ++caricaSeqRef.current;
    try {
      const [
        pagamenti,
        promemoria,
        ordini,
        messaggi,
        comunicazioni,
        suggerimenti,
        st,
      ] =
        await Promise.all([
        api.pagamentiVista(),
        listaPromemoria(),
        api.ordiniLista(),
        listaMessaggi(),
        api.comunicazioniLista().catch(() => []),
        premium.enabled && preferenzeSuggerimenti.notificheAttive
          ? api
              .suggerimentiNotificheLista(preferenzeSuggerimenti)
              .catch(() => [])
          : Promise.resolve([]),
        identity ? caricaStati(identity.userId) : Promise.resolve<StatiNotifiche>({ viste: new Set(), scartate: new Set() }),
      ]);
      const onboardingTimeStr = localStorage.getItem("pt.onboardingTime");
      const onboardingTime = onboardingTimeStr ? Number(onboardingTimeStr) : 0;
      const list = derivaNotifiche({
        pagamenti,
        promemoria,
        ordini,
        messaggi,
        comunicazioni,
        suggerimenti,
        userId: identity?.userId,
        sogliaSolleciti,
        onboardingTime,
      });
      if (seq !== caricaSeqRef.current) return;
      setNotifiche(list);
      // Durante “Cancella tutte” gli eventi delle singole scritture possono avviare
      // refresh intermedi. Non devono far riapparire le notifiche ancora in coda.
      const ottimistiche = scartateOttimisticheRef.current;
      if (ottimistiche.size > 0) {
        const viste = new Set(st.viste);
        const scartate = new Set(st.scartate);
        ottimistiche.forEach((id) => {
          viste.add(id);
          scartate.add(id);
        });
        setStati({ viste, scartate });
      } else {
        setStati(st);
      }

      // Suono e pop-up li decide e li innesca il solo coordinatore della Shell
      // principale: gli chiediamo una scansione immediata e lui ci richiama via
      // `pt:suona-notifica` se c'è da suonare. Le finestre secondarie restano lettrici.
      if (inTauri && coordinaRilevatoreCentrale) {
        void api.notificheCheck().catch(() => {});
      }
    } catch {
      // Fetch-then-render: in errore manteniamo lo stato precedente (niente flash).
    } finally {
      if (seq === caricaSeqRef.current) setCaricando(false);
    }
  }, [
    identity,
    premium.enabled,
    preferenzeSuggerimenti,
    sogliaSolleciti,
    coordinaRilevatoreCentrale,
  ]);

  useEffect(() => {
    void carica();
  }, [carica]);

  useEffect(() => {
    const aggiorna = () =>
      setStatiComunicazioniLocali(
        leggiStatoNotificheComunicazioniLocale(identity?.userId),
      );
    aggiorna();
    const chiave = chiaveStatoComunicazioni(identity?.userId);
    const suStorage = (event: StorageEvent) => {
      if (event.key === chiave) aggiorna();
    };
    const suEventoLocale = () => aggiorna();
    window.addEventListener("storage", suStorage);
    window.addEventListener(
      EVENTO_STATO_COMUNICAZIONI_LOCALI,
      suEventoLocale,
    );
    let disiscriviTauri: (() => void) | undefined;
    if (inTauri) {
      disiscriviTauri = collegaDisiscrizioneAsincrona(
        import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen<{ userId?: string }>(
            EVENTO_STATO_COMUNICAZIONI_LOCALI,
            ({ payload }) => {
              if (!payload?.userId || payload.userId === identity?.userId) {
                aggiorna();
              }
            },
          ),
        ),
      );
    }
    return () => {
      window.removeEventListener("storage", suStorage);
      window.removeEventListener(
        EVENTO_STATO_COMUNICAZIONI_LOCALI,
        suEventoLocale,
      );
      disiscriviTauri?.();
    };
  }, [identity?.userId]);

  // Ricarica sui cambi rilevanti emessi altrove + al ritorno a fuoco + a intervalli.
  useEffect(() => {
    const giri = window.setInterval(() => void carica(), 90_000);
    const onFocus = () => void carica();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    // Crea l'overlay dei pop-up dalla finestra principale già viva (non da config).
    if (coordinaRilevatoreCentrale) void assicuraFinestraOverlay();

    let attivo = true;
    const disiscrizioni: Array<() => void> = [];

    if (inTauri) {
      Promise.all([
        import("@tauri-apps/api/webviewWindow"),
        import("@tauri-apps/api/event"),
      ]).then(([{ getCurrentWebviewWindow }, { listen }]) => {
        if (!attivo) return;
        const w = getCurrentWebviewWindow();

        // Queste invalidazioni sono emesse globalmente dal backend centralizzato.
        const eventiGlobali = [
          "pagamento:salvato",
          "promemoria:salvato",
          "ordine:salvato",
          "messaggio:salvato",
          "comunicazione:salvato",
          "notifica:salvato",
          "cliente:salvato",
          "medico:salvato",
          "agente:salvato",
          "suggerimento:salvato",
          "pt:proiezione-ricostruita",
        ];
        const promesse = eventiGlobali.map((ev) => listen(ev, () => void carica()));

        // Questo evento è inviato in modo mirato dal Rust alla finestra specifica → ascoltiamo sulla finestra
        promesse.push(
          w.listen("pt:suona-notifica", () => {
            if (suonoRef.current !== "nessuno") riproduciSuono(suonoRef.current);
            void carica();
          })
        );

        Promise.all(promesse).then((unsubs) => {
          if (!attivo) {
            unsubs.forEach((u) => u());
          } else {
            disiscrizioni.push(...unsubs);
          }
        });
      });
    }

    return () => {
      attivo = false;
      window.clearInterval(giri);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      disiscrizioni.forEach((u) => u());
    };
  }, [carica, coordinaRilevatoreCentrale]);

  const nonLette = useMemo(
    () =>
      contaNonVisteConStatiLocali(
        notifiche,
        stati.viste,
        stati.scartate,
        statiComunicazioniLocali.viste,
        statiComunicazioniLocali.scartate,
      ),
    [notifiche, stati, statiComunicazioniLocali],
  );

  // Riflette il conteggio non-lette nel tooltip dell'icona tray.
  useEffect(() => {
    if (inTauri && coordinaRilevatoreCentrale) {
      void api.trayBadge(nonLette).catch(() => {});
    }
  }, [nonLette, coordinaRilevatoreCentrale]);

  const segna = useCallback(
    async (id: string) => {
      try {
        await segnaLetta(id, identity);
        // Invalida un caricamento partito prima della scrittura: non deve poter
        // rimettere in memoria lo stato precedente appena confermato dal core.
        caricaSeqRef.current += 1;
        setCaricando(false);
        setStati((s) => (s.viste.has(id) ? s : { viste: new Set(s.viste).add(id), scartate: s.scartate }));
      } catch (e) {
        toast.error(`Impossibile segnare la notifica come letta: ${e}`);
      }
    },
    [identity]
  );

  const scarta = useCallback(
    async (id: string) => {
      try {
        await scartaUna(id, identity);
        caricaSeqRef.current += 1;
        setCaricando(false);
        setStati((s) => ({ viste: new Set(s.viste).add(id), scartate: new Set(s.scartate).add(id) }));
      } catch (e) {
        toast.error(`Impossibile cancellare la notifica: ${e}`);
      }
    },
    [identity]
  );

  const scartaTutte = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      // Aggiornamento ottimistico: il popover si svuota subito, mentre le scritture
      // persistenti proseguono in background. Invalida anche eventuali fetch già partiti.
      caricaSeqRef.current += 1;
      ids.forEach((id) => scartateOttimisticheRef.current.add(id));
      setCaricando(false);
      setStati((s) => {
        const viste = new Set(s.viste);
        const scartate = new Set(s.scartate);
        ids.forEach((id) => {
          viste.add(id);
          scartate.add(id);
        });
        return { viste, scartate };
      });
      try {
        await scartaTutteApi(ids, identity);
        // Un ultimo caricamento invalida i refresh parziali partiti dagli eventi
        // delle singole scritture; fino al suo completamento resta attivo l'overlay.
        await carica();
        ids.forEach((id) => scartateOttimisticheRef.current.delete(id));
      } catch (e) {
        ids.forEach((id) => scartateOttimisticheRef.current.delete(id));
        toast.error(`Impossibile cancellare tutte le notifiche: ${e}`);
        // Rilegge la verità persistita: ripristina soltanto ciò che non è stato
        // effettivamente scritto, anche in caso di errore parziale.
        void carica();
      }
    },
    [carica, identity]
  );

  const aggiornaComunicazioniLocali = useCallback(
    (ids: string[], scarta = false) => {
      setStatiComunicazioniLocali(
        aggiornaStatoNotificheComunicazioniLocale(
          ids,
          identity?.userId,
          scarta,
        ),
      );
    },
    [identity?.userId],
  );

  return {
    notifiche,
    viste: stati.viste,
    scartate: stati.scartate,
    visteComunicazioniLocali: statiComunicazioniLocali.viste,
    scartateComunicazioniLocali: statiComunicazioniLocali.scartate,
    nonLette,
    caricando,
    ricarica: carica,
    segna,
    scarta,
    scartaTutte,
    segnaComunicazioneLocale: (id) =>
      aggiornaComunicazioniLocali([id]),
    scartaComunicazioneLocale: (id) =>
      aggiornaComunicazioniLocali([id], true),
    scartaComunicazioniLocali: (ids) =>
      aggiornaComunicazioniLocali(ids, true),
  };
}
