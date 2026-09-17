import React, { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { Button, Center, MantineProvider, Stack, Text, v8CssVariablesResolver } from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "mantine-datatable/styles.css";
import { MotionConfig } from "framer-motion";
import { theme } from "./theme";
import "./styles.css";
import {
  inTauri,
  api,
  type Identity,
  type Bootstrap,
  type RemoteControlStatus,
  type Comunicazione,
  type ComunicazioneInvioErrore,
} from "./lib/tauri";
import { applicaGeometria, useRicordaGeometria } from "./lib/geometriaFinestre";
import { PrefsProvider, usePrefs } from "./lib/prefs";
import {
  appPuoGestireRiallineamentoDati,
  attivaRipristinoBloccante,
  disattivaRipristinoBloccante,
  eventoRichiedeRiconvalidaSessione,
  iniziaRiallineamentoDati,
  riallineamentoDatiInCorso,
  ricostruisciProiezioneConRetry,
  ripristinoBloccanteAttivo,
  terminaRiallineamentoDati,
} from "./lib/riallineamentoDati";
import { segnaMainVisibileOra } from "./lib/autoAggiornamentoBackground";
import {
  apriSpotlightDopoAvvio,
  bootstrapSincronizzabile,
  pollingMainAttivo,
  renderingInizialeNascosto,
  sincronizzaPrimaDelleViste,
} from "./lib/sincronizzazioneAvvio";
import { bootstrapConRetry as eseguiBootstrapConRetry } from "./lib/bootstrapRetry";
import {
  attendiConsegnaRipristino,
  eventoRichiedeBloccoRipristino,
  lockMantieneBloccoRipristino,
  ripristinoRemotoInCorso,
  statoConsegnaRipristino,
} from "./lib/consegnaRipristino";
import { ToastProvider } from "./ui/toast/ToastProvider";
import { DialogProvider } from "./ui/dialog/DialogProvider";
import { dialog } from "./ui/dialog/store";
import { destinazioneToastDaRicerca, toast } from "./ui/toast/store";
import { apriCentroComunicazioni } from "./features/comunicazioni/apriComunicazione";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { CaricamentoSchermo, LogoMark, UnifiedBootScreen } from "./ui/Brand";
import { MonetinaHost } from "./ui/monetina";
import { MenuContestualeTesto } from "./ui/MenuContestualeTesto";
import { useAggiornamenti } from "./features/info/useAggiornamenti";
import { attendiScrittureStatoNotifiche } from "./features/notifiche/notifiche";
import { pulisciStatoNotificheComunicazioniLocale } from "./features/notifiche/statoComunicazioniLocale";
import { nascondiInTraySeAttiva, èPannelloUtente } from "./lib/finestreTauri";
import { PremiumAccessProvider } from "./premium/PremiumAccess";
import { riepilogaProgressoComunicazioni } from "./features/comunicazioni/progressoComunicazioni";
import { bloccaScorciatoiaStampa } from "./lib/scorciatoie";

if (typeof window !== "undefined") {
  // La stampa resta disponibile soltanto tramite le azioni esplicite dell'app.
  // Il listener è installato nell'entrypoint condiviso da tutte le WebView,
  // incluse le finestre secondarie Tauri.
  window.addEventListener("keydown", bloccaScorciatoiaStampa, true);

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  // WebView2/Chromium conserva suggerimenti propri anche nei form applicativi.
  // Disabilitiamo soltanto l'autocompletamento nativo; Autocomplete/Select di
  // Mantine continuano a funzionare perché gestiscono internamente le opzioni.
  const disabilitaSuggerimentiChromium = (root: ParentNode) => {
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
      .forEach((campo) => {
        // Non sovrascrive scelte esplicite come current-password/new-password:
        // disabilita soltanto il comportamento implicito di Chromium.
        if (!campo.hasAttribute("autocomplete")) campo.setAttribute("autocomplete", "off");
      });
  };
  disabilitaSuggerimentiChromium(document);
  const observerSuggerimenti = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches("input, textarea") && !node.hasAttribute("autocomplete")) {
          node.setAttribute("autocomplete", "off");
        }
        disabilitaSuggerimentiChromium(node);
      }
    }
  });
  observerSuggerimenti.observe(document.documentElement, { childList: true, subtree: true });
}

// Code-splitting: la finestra Ordine non scarica/parsa il codice della shell e
// delle altre sezioni (apertura più rapida); il main non carica l'editor.
const loadApp = () => import("./App");
const preloadDashboard = () => import("./features/dashboard/DashboardView");

const App = lazy(loadApp);
const OrdineWindow = lazy(() =>
  import("./features/giornaliero/OrdineWindow").then((m) => ({ default: m.OrdineWindow }))
);
const PreventivoWindow = lazy(() =>
  import("./features/preventivi/PreventivoWindow").then((m) => ({
    default: m.PreventivoWindow,
  }))
);
const SpotlightWindow = lazy(() =>
  import("./shell/SpotlightWindow").then((m) => ({ default: m.SpotlightWindow }))
);
const RiepilogoWindow = lazy(() =>
  import("./shell/RiepilogoWindow").then((m) => ({ default: m.RiepilogoWindow }))
);
const PagamentoWindow = lazy(() =>
  import("./features/contabilita/PagamentoWindow").then((m) => ({ default: m.PagamentoWindow }))
);
const PromemoriaWindow = lazy(() =>
  import("./features/promemoria/PromemoriaWindow").then((m) => ({ default: m.PromemoriaWindow }))
);
const NotificheWindow = lazy(() =>
  import("./shell/NotificheWindow").then((m) => ({ default: m.NotificheWindow }))
);
const CentroComunicazioniWindow = lazy(() =>
  import("./features/comunicazioni/CentroComunicazioni").then((m) => ({
    default: m.CentroComunicazioniWindow,
  }))
);
const ComunicazioneComposerWindow = lazy(() =>
  import("./features/comunicazioni/ComunicazioneComposer").then((m) => ({
    default: m.ComunicazioneComposerWindow,
  }))
);
const CampagnaComunicazioniWindow = lazy(() =>
  import("./features/comunicazioni/CampagnaComunicazioni").then((m) => ({
    default: m.CampagnaComunicazioniWindow,
  }))
);
const CestinoWindow = lazy(() =>
  import("./shell/CestinoWindow").then((m) => ({ default: m.CestinoWindow }))
);
const InfoWindow = lazy(() =>
  import("./features/info/InfoWindow").then((m) => ({ default: m.InfoWindow }))
);
const OverlayWindow = lazy(() =>
  import("./shell/OverlayWindow").then((m) => ({ default: m.OverlayWindow }))
);

// Le finestre secondarie riusano lo stesso index.html con un parametro nella query.
const params = new URLSearchParams(window.location.search);
const finestraOrdine = params.has("ordine");
const finestraPreventivo = params.has("preventivo");
const finestraSpotlight = params.has("spotlight");
const finestraRiepilogo = params.has("riepilogo");
const finestraPagamento = params.has("pagamento");
const finestraPromemoria = params.has("promemoria");
const finestraNotifiche = params.has("notifiche");
const finestraComunicazioni = params.has("comunicazioni");
const finestraComponiComunicazione = params.has("componiComunicazione");
const finestraCampagnaComunicazioni = params.has("campagnaComunicazioni");
const finestraCestino = params.has("cestino");
const finestraInfo = params.has("info");
const finestraOverlay = params.has("overlay");
const finestraServizioToast =
  destinazioneToastDaRicerca(window.location.search) === "principale";
// Barra di ricerca e overlay notifiche sono trasparenti e senza bordi: niente sfondo.
if (finestraSpotlight || finestraOverlay) document.documentElement.classList.add("spotlight-root");

// Geometria di default della finestra principale (combacia con tauri.conf.json):
// usata se non c'è ancora nulla di salvato.
const GEOM_MAIN = { width: 1100, height: 720, minWidth: 900, minHeight: 600 } as const;
const INTERVALLO_CONTROLLO_PREPARAZIONE_MS = 5_000;

function Schermo({
  boot,
  erroreBootstrap,
  avvioNascosto,
  onBootstrapChange,
}: {
  boot: Bootstrap | null;
  erroreBootstrap: string | null;
  avvioNascosto: boolean;
  onBootstrapChange: (boot: Bootstrap) => void;
}) {
  if (finestraSpotlight) return <SpotlightWindow />;
  if (finestraOverlay) return <OverlayWindow />;
  if (finestraRiepilogo) return <RiepilogoWindow />;
  if (finestraPagamento) return <PagamentoWindow />;
  if (finestraPromemoria) return <PromemoriaWindow />;
  if (finestraNotifiche) return <NotificheWindow />;
  if (finestraComunicazioni) return <CentroComunicazioniWindow />;
  if (finestraComponiComunicazione) return <ComunicazioneComposerWindow />;
  if (finestraCampagnaComunicazioni) return <CampagnaComunicazioniWindow />;
  if (finestraCestino) return <CestinoWindow />;
  if (finestraInfo) return <InfoWindow />;
  if (finestraPreventivo) return <PreventivoWindow />;
  if (finestraOrdine) return <OrdineWindow />;
  return (
    <App
      boot={boot}
      erroreBootstrap={erroreBootstrap}
      avvioNascosto={avvioNascosto}
      onBootstrapChange={onBootstrapChange}
    />
  );
}

/** Registra misura+posizione della finestra principale (montato solo per `main`). */
function RicordaGeometriaMain() {
  useRicordaGeometria("main");
  return null;
}

/** Vive nel Root della sola main: resta montato anche durante bootstrap, onboarding,
 *  riconnessione e avvio minimizzato, senza dipendere dal lifecycle della Shell. */
function AggiornamentiMain() {
  useAggiornamenti();
  return null;
}

function getCachedIdentity(): Identity | null {
  try {
    const stored = localStorage.getItem("pt.lastIdentity");
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

let primoAvvioPromise: Promise<boolean> | null = null;
function getPrimoAvvio() {
  if (!primoAvvioPromise) {
    primoAvvioPromise = inTauri ? api.rivelaMainUnaVolta().catch(() => true) : Promise.resolve(true);
  }
  return primoAvvioPromise;
}

let avvioSpotlightPromise: Promise<boolean> | null = null;
function getAvvioSpotlight() {
  if (!avvioSpotlightPromise) {
    avvioSpotlightPromise = inTauri ? api.avvioSpotlight().catch(() => false) : Promise.resolve(false);
  }
  return avvioSpotlightPromise;
}

async function apriSpotlightDaScorciatoia() {
  const { mostraSpotlight } = await import("./shell/navigazione");
  await mostraSpotlight();
}

async function mainVisibileOra(): Promise<boolean> {
  if (!inTauri) return true;
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return await getCurrentWebviewWindow().isVisible();
  } catch {
    // Sul primo mount la decisione usa comunque l'intenzione nativa; sui reload
    // un errore di lettura non deve introdurre animazioni in una main forse nascosta.
    return false;
  }
}

async function distruggiFinestraCorrenteSecondaria() {
  if (!inTauri) return;
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().destroy();
  } catch {}
}

async function distruggiFinestreEsterneAllaMain() {
  if (!inTauri) return;
  try {
    const { getAllWindows } = await import("@tauri-apps/api/window");
    const finestre = await getAllWindows();
    await Promise.all(
      finestre
        .filter((w) => w.label !== "main")
        .map((w) => w.destroy().catch(() => {}))
    );
  } catch {}
}

async function controlloRemotoConFallback(): Promise<RemoteControlStatus> {
  try {
    const { controllaDisattivazioneRemota } = await import("./remoteControl");
    return await controllaDisattivazioneRemota();
  } catch {
    return {
      disabled: false,
      message: "",
      updatedAt: "",
      fromCache: true,
      premiumEnabled: false,
    };
  }
}

async function bootstrapConRetry(onAttesaSincronizzazione?: () => void) {
  return eseguiBootstrapConRetry({
    bootstrap: api.bootstrap,
    onAttesa: onAttesaSincronizzazione,
  });
}

function SchermoBloccoRemoto({
  stato,
  onRetry,
}: {
  stato: RemoteControlStatus;
  onRetry: () => Promise<void>;
}) {
  const [ricontrollo, setRicontrollo] = useState(false);
  const messaggio = stato.message || "Il gestionale è temporaneamente disattivato.";

  async function riprova() {
    if (ricontrollo) return;
    setRicontrollo(true);
    try {
      await onRetry();
    } finally {
      setRicontrollo(false);
    }
  }

  return (
    <Center style={{ flex: 1, padding: 24 }}>
      <Stack align="center" gap="sm" maw={520} ta="center">
        <LogoMark size={48} />
        <Text fw={700}>Gestionale non disponibile</Text>
        <Text c="dimmed" size="sm">
          {messaggio}
        </Text>
        <Button variant="default" loading={ricontrollo} onClick={() => void riprova()}>
          Riprova
        </Button>
      </Stack>
    </Center>
  );
}

function Root() {
  const {
    anno,
    ridurreAnimazioni,
    zoomUI,
    suonoNotifica,
    balloonAttivo,
    sogliaSolleciti,
    notifichePrimoPiano,
    preferenzeSuggerimenti,
    avvisoTrayMostrato,
    setAvvisoTrayMostrato,
  } = usePrefs();
  const [bootData, setBootData] = useState<Bootstrap | null>(null);
  const bootDataRef = useRef<Bootstrap | null>(bootData);
  bootDataRef.current = bootData;
  const [errore, setErrore] = useState<string | null>(null);
  const [erroreRendering, setErroreRendering] = useState(false);
  const [bloccoRemoto, setBloccoRemoto] = useState<RemoteControlStatus | null>(null);
  const bloccoRemotoRef = useRef<RemoteControlStatus | null>(bloccoRemoto);
  bloccoRemotoRef.current = bloccoRemoto;
  const [controlloRemoto, setControlloRemoto] = useState<RemoteControlStatus | null>(null);
  const [caricamento, setCaricamento] = useState(inTauri);
  const caricamentoRef = useRef(caricamento);
  const [testoCaricamento, setTestoCaricamento] = useState("Carico il gestionale…");
  const ripristinoFallitoRef = useRef(false);
  const controlloScadenzaRestoreRef = useRef<{
    restoreId: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const rootAttivoRef = useRef(true);
  const [avvioNascosto, setAvvioNascosto] = useState(false);
  const avvisoTrayMostratoRef = useRef(avvisoTrayMostrato);
  avvisoTrayMostratoRef.current = avvisoTrayMostrato;

  useEffect(() => {
    rootAttivoRef.current = true;
    return () => {
      rootAttivoRef.current = false;
    };
  }, []);

  const aggiornaCaricamento = (value: boolean) => {
    caricamentoRef.current = value;
    setCaricamento(value);
  };

  const aggiornaBootData = (value: Bootstrap) => {
    // I trigger nativi (in particolare `--spotlight`) possono riprendere nella
    // stessa microtask in cui termina il bootstrap: il ref deve essere autorevole
    // anche prima del successivo commit React.
    bootDataRef.current = value;
    setBootData(value);
  };

  useEffect(() => {
    caricamentoRef.current = caricamento;
  }, [caricamento]);

  const isFinestraSecondaria =
    finestraOrdine ||
    finestraPreventivo ||
    finestraSpotlight ||
    finestraRiepilogo ||
    finestraPagamento ||
    finestraPromemoria ||
    finestraNotifiche ||
    finestraComunicazioni ||
    finestraComponiComunicazione ||
    finestraCampagnaComunicazioni ||
    finestraCestino ||
    finestraInfo ||
    finestraOverlay;

  // Qualunque errore che impedisce alla main di arrivare alla home rende invalida
  // anche la sessione notifiche: niente overlay sopra lo schermo di indisponibilità.
  useEffect(() => {
    if (!inTauri || isFinestraSecondaria || !errore) return;
    void api.notificheDisattivaSessione().catch(() => {});
  }, [errore, isFinestraSecondaria]);

  // Unico proprietario frontend della configurazione del rilevatore Rust. Dopo
  // questa consegna il core resta autonomo anche se la main viene nascosta o il
  // WebView viene sospeso. Le finestre secondarie non possono riattivarlo.
  useEffect(() => {
    if (!inTauri || isFinestraSecondaria || !bootData) return;
    const identity = bootData.identity;
    const disponibile =
      bootData.onboarded &&
      !!identity &&
      !bootData.reconnectRequired &&
      bootData.dataDirStatus === "ok" &&
      !ripristinoRemotoInCorso(bootData) &&
      !bloccoRemoto?.disabled &&
      !errore &&
      !erroreRendering;
    if (!disponibile || !identity) {
      void api.notificheDisattivaSessione().catch(() => {});
      return;
    }
    // Durante un riallineamento conserviamo la configurazione Rust precedente;
    // al primo caricamento aspettiamo invece che App e dashboard siano disponibili.
    if (caricamento) return;
    const onboardingTimeStr = localStorage.getItem("pt.onboardingTime");
    const onboardingTime = onboardingTimeStr ? Number(onboardingTimeStr) : 0;
    void api
      .notificheConfig(
        identity.userId,
        suonoNotifica,
        balloonAttivo,
        sogliaSolleciti,
        onboardingTime,
        notifichePrimoPiano,
        { ...preferenzeSuggerimenti, anno },
      )
      .catch(() => {});
  }, [
    anno,
    balloonAttivo,
    bloccoRemoto,
    bootData,
    caricamento,
    errore,
    erroreRendering,
    isFinestraSecondaria,
    notifichePrimoPiano,
    preferenzeSuggerimenti,
    sogliaSolleciti,
    suonoNotifica,
  ]);

  useEffect(() => {
    if (!inTauri || isFinestraSecondaria || balloonAttivo) return;
    let annullato = false;
    let unlisten: (() => void) | undefined;
    const erroriCampagna = new Map<
      string,
      { count: number; toastId: string }
    >();

    const azioniErroreCampagna = (
      chiave: string,
      campagnaId: string,
      ambiguo: boolean,
    ) => [
      ...(!ambiguo
        ? [
            {
              label: "Riprova falliti",
              onClick: () => {
                void api
                  .campagnaComunicazioneRiprovaFallite(campagnaId)
                  .then((aggiornate) => {
                    const corrente = erroriCampagna.get(chiave);
                    if (corrente) toast.dismiss(corrente.toastId);
                    erroriCampagna.delete(chiave);
                    toast.info(
                      aggiornate.length === 1
                        ? "Il messaggio fallito è stato rimesso in coda."
                        : `${aggiornate.length} messaggi falliti sono stati rimessi in coda.`,
                    );
                  })
                  .catch((errore) =>
                    toast.error(`Retry multiplo non riuscito: ${errore}`),
                  );
              },
            },
          ]
        : []),
      {
        label: "Apri errori",
        onClick: () => void apriCentroComunicazioni("laterale"),
      },
    ];

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<ComunicazioneInvioErrore>("pt:comunicazione-invio-errore", ({ payload }) => {
          if (annullato) return;
          if (payload.campagnaId) {
            const chiave = [
              payload.campagnaId,
              payload.canale,
              payload.esitoAmbiguo ? "ambiguo" : "fallito",
            ].join(":");
            const esistente = erroriCampagna.get(chiave);
            const count = (esistente?.count ?? 0) + 1;
            const canale =
              payload.canale === "email" ? "e-mail" : "WhatsApp";
            const messaggio =
              count === 1
                ? `${payload.messaggio || "Invio non riuscito."} La campagna continua con i destinatari successivi.`
                : `${count} invii ${canale} falliti. La campagna continua; i destinatari e gli errori sono nel Centro comunicazioni.`;
            const titolo = payload.esitoAmbiguo
              ? `${count} ${count === 1 ? "esito" : "esiti"} da controllare`
              : `${count} ${count === 1 ? "invio fallito" : "invii falliti"}`;
            if (esistente) {
              toast.update(esistente.toastId, {
                titolo,
                messaggio,
                azioni: azioniErroreCampagna(
                  chiave,
                  payload.campagnaId,
                  payload.esitoAmbiguo,
                ),
              });
              erroriCampagna.set(chiave, {
                count,
                toastId: esistente.toastId,
              });
            } else {
              const toastId = toast.error(messaggio, {
                titolo,
                durata: 0,
                azioni: azioniErroreCampagna(
                  chiave,
                  payload.campagnaId,
                  payload.esitoAmbiguo,
                ),
              });
              erroriCampagna.set(chiave, { count, toastId });
            }
            return;
          }
          // Gli errori singoli confluiscono nel riepilogo progressivo fallback
          // sottostante. Qui resta il retry multiplo delle campagne.
        })
      )
      .then((off) => {
        if (annullato) off();
        else unlisten = off;
      })
      .catch(() => {});

    return () => {
      annullato = true;
      unlisten?.();
      erroriCampagna.forEach(({ toastId }) => toast.dismiss(toastId));
    };
  }, [balloonAttivo, isFinestraSecondaria]);

  // Fallback: quando le notifiche custom sono disabilitate, le transizioni del
  // worker alimentano un unico toast determinato per campagna o invio singolo.
  useEffect(() => {
    if (!inTauri || isFinestraSecondaria || balloonAttivo) return;
    let annullato = false;
    let unlisten: (() => void) | undefined;
    const perGruppo = new Map<string, Map<string, Comunicazione>>();
    const toastPerGruppo = new Map<string, string>();
    const caricamenti = new Map<string, Promise<void>>();
    const timerPulizia = new Map<string, ReturnType<typeof setTimeout>>();
    const statiOperativi = new Set([
      "in_coda",
      "sospeso",
      "in_invio",
      "invio_azionato",
      "consegna_verificata",
      "fallito",
      "annullato",
    ]);

    const aggiornaToast = (chiave: string, elementi: Comunicazione[]) => {
      if (annullato || elementi.length === 0) return;
      const puliziaPrecedente = timerPulizia.get(chiave);
      if (puliziaPrecedente) {
        window.clearTimeout(puliziaPrecedente);
        timerPulizia.delete(chiave);
      }
      const riepilogo = riepilogaProgressoComunicazioni(elementi);
      if (riepilogo.terminale && riepilogo.annullate > 0) {
        const esistente = toastPerGruppo.get(chiave);
        if (esistente) toast.dismiss(esistente);
        toastPerGruppo.delete(chiave);
        perGruppo.delete(chiave);
        caricamenti.delete(chiave);
        return;
      }
      const campagna = chiave.startsWith("campagna:");
      const titolo = campagna
        ? "Invio comunicazioni"
        : elementi[0]?.canale === "email"
          ? "Invio e-mail"
          : "Invio WhatsApp";
      const tipo = riepilogo.terminale
        ? riepilogo.fallite > 0
          ? "warning"
          : riepilogo.annullate === riepilogo.totale
            ? "info"
            : "success"
        : "loading";
      const patch = {
        tipo,
        titolo,
        messaggio: riepilogo.messaggio,
        progress: riepilogo.terminale ? undefined : riepilogo.progress,
        durata: riepilogo.terminale ? (tipo === "warning" ? 15000 : 10000) : 0,
      } as const;
      const esistente = toastPerGruppo.get(chiave);
      if (esistente) {
        toast.update(esistente, patch);
      } else {
        const id = toast.loading(riepilogo.messaggio, {
          titolo,
          progress: riepilogo.progress,
        });
        toastPerGruppo.set(chiave, id);
        if (riepilogo.terminale) toast.update(id, patch);
      }
      if (riepilogo.terminale) {
        const timer = window.setTimeout(() => {
          toastPerGruppo.delete(chiave);
          perGruppo.delete(chiave);
          timerPulizia.delete(chiave);
        }, 6500);
        timerPulizia.set(chiave, timer);
      }
    };

    const ricevi = async (comunicazione: Comunicazione) => {
      if (!statiOperativi.has(comunicazione.stato)) return;
      const chiave = comunicazione.campagnaId
        ? `campagna:${comunicazione.campagnaId}`
        : `singola:${comunicazione.id}`;
      const gruppo = perGruppo.get(chiave) ?? new Map<string, Comunicazione>();
      gruppo.set(comunicazione.id, comunicazione);
      perGruppo.set(chiave, gruppo);

      if (comunicazione.campagnaId && !caricamenti.has(chiave)) {
        const caricamento = api
          .comunicazioniLista()
          .then((tutte) => {
            const corrente = perGruppo.get(chiave);
            if (!corrente) return;
            for (const item of tutte) {
              if (item.campagnaId === comunicazione.campagnaId && !corrente.has(item.id)) {
                corrente.set(item.id, item);
              }
            }
          })
          .catch(() => {})
          .then(() => {});
        caricamenti.set(chiave, caricamento);
        await caricamento;
      } else {
        await caricamenti.get(chiave);
      }
      aggiornaToast(chiave, [...(perGruppo.get(chiave)?.values() ?? [])]);
    };

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<Comunicazione>("pt:comunicazione-stato-locale", ({ payload }) => {
          if (!annullato) void ricevi(payload);
        }),
      )
      .then((off) => {
        if (annullato) off();
        else unlisten = off;
      })
      .catch(() => {});

    return () => {
      annullato = true;
      unlisten?.();
      timerPulizia.forEach((timer) => window.clearTimeout(timer));
      toastPerGruppo.forEach((toastId) => toast.dismiss(toastId));
    };
  }, [balloonAttivo, isFinestraSecondaria]);

  // Un solo coordinatore della X della main, montato per tutta la vita del Root:
  // resta attivo durante bootstrap, onboarding, ripristino, blocco remoto e Shell.
  useEffect(() => {
    if (!inTauri || isFinestraSecondaria) return;
    let cancellato = false;
    let unlisten: (() => void) | undefined;
    let chiusuraInCorso = false;
    let uscendo = false;

    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow, getAllWindows }) => {
        if (cancellato) return;
        const win = getCurrentWindow();

        const esciDavvero = async () => {
          uscendo = true;
          await attendiScrittureStatoNotifiche();
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("forza_uscita");
          } catch {
            try {
              const { exit } = await import("@tauri-apps/plugin-process");
              await exit(0);
            } catch {
              try {
                const finestre = await getAllWindows();
                await Promise.all(finestre.map((finestra) => finestra.destroy().catch(() => {})));
              } catch {
                await win.destroy().catch(() => {});
              }
            }
          }
        };

        const off = await win.onCloseRequested(async (event) => {
          event.preventDefault();
          if (uscendo || chiusuraInCorso) return;
          chiusuraInCorso = true;
          try {
            // Con autostart attivo la X riduce sempre nella tray, anche se la
            // Shell non e' montata o la main mostra una schermata bloccante.
            if (await nascondiInTraySeAttiva(win)) {
              if (!avvisoTrayMostratoRef.current) {
                avvisoTrayMostratoRef.current = true;
                setAvvisoTrayMostrato(true);
                toast.info(
                  "PharmaTek resta attivo nella barra di sistema (vicino all'orologio): da lì lo riapri o esci del tutto. Lo trovi anche in Impostazioni.",
                  { durata: 9000 }
                );
              }
              return;
            }

            // Senza tray, i pannelli utente visibili richiedono conferma. Le
            // finestre di servizio nascoste non devono lasciare il processo vivo.
            let pannelliVisibili: Awaited<ReturnType<typeof getAllWindows>>;
            try {
              const candidate = (await getAllWindows()).filter(
                (finestra) => finestra.label !== win.label && èPannelloUtente(finestra.label)
              );
              const verificati = await Promise.all(
                candidate.map(async (finestra) => {
                  try {
                    return (await finestra.isVisible()) ? finestra : null;
                  } catch {
                    return finestra;
                  }
                })
              );
              pannelliVisibili = verificati.filter(
                (finestra): finestra is NonNullable<typeof finestra> => finestra !== null
              );
            } catch {
              // L'intenzione era uscire: evita di distruggere soltanto la main
              // lasciando Spotlight o overlay in un processo senza interfaccia.
              await esciDavvero();
              return;
            }

            if (pannelliVisibili.length > 0) {
              const ok = await dialog.confirm(
                "Uscire dal gestionale?",
                `Ci sono ${pannelliVisibili.length} ${pannelliVisibili.length === 1 ? "finestra ancora aperta" : "finestre ancora aperte"}. Vuoi chiuderle e uscire?`,
                { conferma: "Chiudi tutto ed esci", annulla: "Annulla" }
              );
              if (!ok) return;
            }
            await esciDavvero();
          } finally {
            if (!uscendo) chiusuraInCorso = false;
          }
        });

        if (cancellato) off();
        else unlisten = off;
      })
      .catch(() => {});

    return () => {
      cancellato = true;
      unlisten?.();
    };
  }, [isFinestraSecondaria, setAvvisoTrayMostrato]);

  useEffect(() => {
    if (isFinestraSecondaria) return;
    segnaMainVisibileOra();
    const aggiorna = () => {
      if (document.visibilityState !== "hidden") segnaMainVisibileOra();
    };
    window.addEventListener("focus", aggiorna);
    document.addEventListener("visibilitychange", aggiorna);
    return () => {
      window.removeEventListener("focus", aggiorna);
      document.removeEventListener("visibilitychange", aggiorna);
    };
  }, [isFinestraSecondaria]);

  const preparaDopoBootstrap = async (data: Bootstrap) => {
    // L'overlay ospita anche il controllo update in background: deve esistere pure
    // prima della configurazione e durante i flussi di recupero, non solo a login
    // fatto. La sua creazione non deve però ritardare la schermata principale.
    void import("./features/notifiche/useNotifiche")
      .then(({ assicuraFinestraOverlay }) => assicuraFinestraOverlay())
      .catch(() => {});

    if (
      !data.onboarded ||
      !data.identity ||
      data.reconnectRequired ||
      data.dataDirStatus !== "ok" ||
      ripristinoRemotoInCorso(data)
    ) {
      await api.notificheDisattivaSessione().catch(() => {});
      return;
    }

    await Promise.all([
      loadApp().catch(() => null),
      preloadDashboard().catch(() => null),
      new Promise((resolve) => setTimeout(resolve, 220)),
    ]);
  };

  const riprendiDopoSbloccoRemoto = async () => {
    if (isFinestraSecondaria || !inTauri) {
      setBloccoRemoto(null);
      return;
    }

    setErrore(null);
    aggiornaCaricamento(true);
    setTestoCaricamento("Sincronizzo i dati più recenti...");

    try {
      const riallineaRestore = async (bootstrap: Bootstrap): Promise<Bootstrap> => {
        if (!ripristinoRemotoInCorso(bootstrap) || !iniziaRiallineamentoDati()) return bootstrap;
        attivaRipristinoBloccante();
        try {
          const pronto = await attendiConsegnaRipristino(bootstrap, {
            bootstrap: () => bootstrapConRetry(),
            attivo: () => rootAttivoRef.current,
            onWaiting: () => setTestoCaricamento("Attendo che OneDrive completi il ripristino..."),
          });
          if (!rootAttivoRef.current) return pronto;
          if (statoConsegnaRipristino(pronto) !== "ready") return pronto;
          await ricostruisciProiezioneConRetry(() => {
            setTestoCaricamento("Attendo la sincronizzazione dei dati...");
          });
          return await bootstrapConRetry();
        } catch (error) {
          ripristinoFallitoRef.current = true;
          throw error;
        } finally {
          disattivaRipristinoBloccante();
          terminaRiallineamentoDati();
        }
      };

      let data = await riallineaRestore(await bootstrapConRetry());
      if (!rootAttivoRef.current) return;
      data = await sincronizzaPrimaDelleViste(data, {
        forceSync: api.forceSync,
        bootstrap: () => bootstrapConRetry(),
        onRetry: () => setTestoCaricamento("Attendo la sincronizzazione dei dati..."),
      });
      data = await riallineaRestore(data);
      if (!rootAttivoRef.current) return;
      aggiornaBootData(data);
      await preparaDopoBootstrap(data);
      setBloccoRemoto(null);
    } catch (err) {
      if (rootAttivoRef.current) {
        setErrore(String(err));
        setBloccoRemoto(null);
      }
    } finally {
      if (rootAttivoRef.current) aggiornaCaricamento(false);
    }
  };

  // Caricamento dei dati di bootstrap (solo per la finestra principale)
  useEffect(() => {
    if (isFinestraSecondaria || !inTauri) return;

    let attivo = true;
    let unlistenRevealFn: (() => void) | null = null;
    let unlistenDataWipedFn: (() => void) | null = null;
    let unlistenSyncProgressFn: (() => void) | null = null;
    let unlistenSpotlightFn: (() => void) | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let focusSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let pollIncrementaleInCorso: Promise<void> | null = null;
    let ricostruzioneBootInCorso = false;
    let rivelazioneInCorso = false;
    let avvioInCorso: Promise<void> | null = null;
    let avvioCompletatoAlle = 0;
    setTestoCaricamento("Carico il gestionale…");

    const schedulaFineCaricamento = () => {
      if (!attivo || timerId) return;
      timerId = setTimeout(() => {
        timerId = null;
        if (attivo) aggiornaCaricamento(false);
      }, 1200);
    };

    const pollIncrementale = () => {
      if (
        !attivo ||
        ripristinoFallitoRef.current ||
        !pollingMainAttivo(document.visibilityState, document.hasFocus()) ||
        caricamentoRef.current ||
        !bootDataRef.current ||
        !bootstrapSincronizzabile(bootDataRef.current) ||
        rivelazioneInCorso ||
        ricostruzioneBootInCorso ||
        riallineamentoDatiInCorso() ||
        pollIncrementaleInCorso
      ) return;
      const task = api.syncPoll().then(() => {}).catch(() => {});
      const coordinato = task.finally(() => {
        if (pollIncrementaleInCorso === coordinato) pollIncrementaleInCorso = null;
      });
      pollIncrementaleInCorso = coordinato;
    };

    import("@tauri-apps/api/event").then(({ listen }) => {
      if (!attivo) return;
      listen<{ current: number; total: number; phase: string }>("pt:sync-progress", (event) => {
        if (!attivo) return;
        if (event.payload.total > 0 && caricamentoRef.current) {
          const pct = Math.min(100, Math.round((event.payload.current / event.payload.total) * 100));
          setTestoCaricamento(
            `Sincronizzo i dati: ${event.payload.current.toLocaleString()} / ${event.payload.total.toLocaleString()} (${pct}%)`
          );
        }
      }).then((fn) => {
        if (attivo) unlistenSyncProgressFn = fn;
        else fn();
      });

      listen<{ reason?: string }>("pt:data-wiped", async (event) => {
        if (!attivo) return;
        const reason = event.payload?.reason;
        const eventoRestore = eventoRichiedeBloccoRipristino(reason);
        const eventoSessione = eventoRichiedeRiconvalidaSessione(reason);
        if (eventoRestore && ripristinoFallitoRef.current) return;
        const bootCorrente = bootDataRef.current;
        // Durante una preparazione già confermata, OneDrive può consegnare prima
        // le cancellazioni dei vecchi log e soltanto dopo marker e manifest. Non
        // scambiare quella finestra per un reset autonomo: attendiamo commit/cancel.
        if (ripristinoBloccanteAttivo() && !eventoRestore && !eventoSessione) return;
        // Backup e snapshot sostituiscono la linea temporale corrente: gli stati
        // effimeri di campanella/overlay della vecchia sessione non sono ripristinabili.
        if (eventoRestore) pulisciStatoNotificheComunicazioniLocale();
        // Durante onboarding/riconnessione la cartella scelta e' ancora soltanto
        // provvisoria. `open_data_dir` gestisce direttamente un eventuale restore;
        // Root non deve smontare i passaggi dell'onboarding per ricostruire usando
        // una configurazione che, correttamente, non e' stata ancora salvata.
        if (
          eventoRestore &&
          bootCorrente &&
          (!bootCorrente.dataDir || !bootCorrente.onboarded || !bootCorrente.identity)
        ) return;
        // A UI montata il proprietario e' App, che mostra anche il feedback. Root
        // interviene durante bootscreen/restore oppure finche' il listener di App
        // non e' stato registrato realmente.
        if (
          !eventoRestore &&
          !eventoSessione &&
          !caricamentoRef.current &&
          !ripristinoBloccanteAttivo() &&
          appPuoGestireRiallineamentoDati()
        ) return;
        // Acquisizione prima di qualunque await: impedisce ad App e Root di
        // completare in sequenza due ricostruzioni per la stessa emissione.
        if (ricostruzioneBootInCorso || !iniziaRiallineamentoDati()) return;
        ricostruzioneBootInCorso = true;
        if (eventoRestore) {
          attivaRipristinoBloccante();
          await api.notificheDisattivaSessione().catch(() => {});
          void distruggiFinestreEsterneAllaMain();
        }
        // Se Root copre una fase di recupero o la breve finestra prima che App
        // registri il listener, mantiene una schermata stabile fino al bootstrap
        // successivo e poi rimonta App con quello stato.
        if (!caricamentoRef.current) {
          setErrore(null);
          setTestoCaricamento("Sincronizzo i dati più recenti...");
          aggiornaCaricamento(true);
        }
        const controlloScadenza = controlloScadenzaRestoreRef.current;
        if (controlloScadenza) {
          clearTimeout(controlloScadenza.timer);
          controlloScadenzaRestoreRef.current = null;
        }
        try {
          const controllo = await controlloRemotoConFallback();
          if (!attivo) return;
          setControlloRemoto(controllo);
          if (controllo.disabled) {
            await api.notificheDisattivaSessione().catch(() => {});
            setBloccoRemoto(controllo);
            void distruggiFinestreEsterneAllaMain();
            return;
          }
          const statoPrimaDelRiallineamento = await bootstrapConRetry().catch(() => null);
          let statoConsegna = statoPrimaDelRiallineamento;
          if (statoConsegna && statoConsegnaRipristino(statoConsegna) === "waiting") {
            attivaRipristinoBloccante();
            setTestoCaricamento("Attendo che OneDrive completi il ripristino...");
            await api.notificheDisattivaSessione().catch(() => {});
            void distruggiFinestreEsterneAllaMain();
            statoConsegna = await attendiConsegnaRipristino(statoConsegna, {
              bootstrap: () => bootstrapConRetry(),
              attivo: () => attivo,
              onWaiting: () => {
                if (attivo) setTestoCaricamento("Attendo che OneDrive completi il ripristino...");
              },
            });
          }
          if (
            statoConsegna &&
            statoConsegnaRipristino(statoConsegna) === "none" &&
            (!statoConsegna.dataDir ||
              !statoConsegna.onboarded ||
              !statoConsegna.identity ||
              statoConsegna.reconnectRequired ||
              statoConsegna.dataDirStatus !== "ok")
          ) {
            // Un evento tardivo non deve tentare sei ricostruzioni senza cartella o
            // identita'. Rimontiamo invece il corretto flusso onboarding/reconnect.
            aggiornaBootData(statoConsegna);
            await preparaDopoBootstrap(statoConsegna);
            return;
          }
          if (
            eventoRestore &&
            (!statoConsegna || statoConsegnaRipristino(statoConsegna) !== "ready")
          ) {
            if (statoConsegna) {
              aggiornaBootData(statoConsegna);
              await preparaDopoBootstrap(statoConsegna);
            }
            return;
          }
          if (pollIncrementaleInCorso) await pollIncrementaleInCorso;
          if (!attivo) return;
          setTestoCaricamento("Sincronizzo i dati più recenti...");
          await ricostruisciProiezioneConRetry(() => {
            if (attivo) setTestoCaricamento("Attendo la sincronizzazione dei dati...");
          });
          const data = await bootstrapConRetry();
          if (!attivo) return;
          aggiornaBootData(data);
          await preparaDopoBootstrap(data);
        } catch (err) {
          if (eventoRestore) ripristinoFallitoRef.current = true;
          if (attivo) setErrore(String(err));
        } finally {
          ricostruzioneBootInCorso = false;
          disattivaRipristinoBloccante();
          terminaRiallineamentoDati();
          if (attivo) {
            setTestoCaricamento("Carico il gestionale…");
            aggiornaCaricamento(false);
          }
        }
      }).then((fn) => {
        if (attivo) unlistenDataWipedFn = fn;
        else fn();
      });
    });

    const riallineaRestoreDaBootstrapSeServe = async (data: Bootstrap): Promise<Bootstrap> => {
      if (!ripristinoRemotoInCorso(data)) return data;
      if (ricostruzioneBootInCorso || !iniziaRiallineamentoDati()) return data;
      ricostruzioneBootInCorso = true;
      attivaRipristinoBloccante();
      setTestoCaricamento(
        statoConsegnaRipristino(data) === "waiting"
          ? "Attendo che OneDrive completi il ripristino..."
          : "Sincronizzo i dati più recenti..."
      );
      aggiornaCaricamento(true);
      try {
        const pronto = await attendiConsegnaRipristino(data, {
          bootstrap: () => bootstrapConRetry(),
          attivo: () => attivo,
          onWaiting: () => {
            if (attivo) setTestoCaricamento("Attendo che OneDrive completi il ripristino...");
          },
        });
        if (!attivo || statoConsegnaRipristino(pronto) !== "ready") return pronto;
        setTestoCaricamento("Sincronizzo i dati più recenti...");
        await ricostruisciProiezioneConRetry(() => {
          if (attivo) setTestoCaricamento("Attendo la sincronizzazione dei dati...");
        });
        return await bootstrapConRetry();
      } catch (error) {
        ripristinoFallitoRef.current = true;
        throw error;
      } finally {
        ricostruzioneBootInCorso = false;
        disattivaRipristinoBloccante();
        terminaRiallineamentoDati();
      }
    };

    const riallineaPrimaDelleViste = async (data: Bootstrap): Promise<Bootstrap> => {
      let corrente = await riallineaRestoreDaBootstrapSeServe(data);
      corrente = await sincronizzaPrimaDelleViste(corrente, {
        forceSync: api.forceSync,
        bootstrap: () => bootstrapConRetry(() => {
          if (attivo) setTestoCaricamento("Attendo la sincronizzazione dei dati...");
        }),
        onRetry: () => {
          if (attivo) setTestoCaricamento("Attendo la sincronizzazione dei dati...");
        },
      });
      // Un marker restore può essere arrivato insieme agli eventi appena ingeriti.
      return riallineaRestoreDaBootstrapSeServe(corrente);
    };

    const gestisciRivelazione = async () => {
      if (!attivo || rivelazioneInCorso || ripristinoFallitoRef.current) return;
      setAvvioNascosto(false);
      rivelazioneInCorso = true;
      const eraInCaricamento = caricamentoRef.current;
      const eraBloccatoDaPreparazione = ripristinoBloccanteAttivo();
      let mantieniTestoRipristino = false;
      try {
        if (
          !eraBloccatoDaPreparazione &&
          avvioCompletatoAlle > 0 &&
          Date.now() - avvioCompletatoAlle < 2_000
        ) {
          schedulaFineCaricamento();
          return;
        }
        // Un click molto rapido sulla tray durante il bootstrap attende lo stesso
        // avvio. Se questo si e' appena concluso con successo, la proiezione e' gia'
        // allineata: basta rivelare le viste senza ripetere subito un secondo ingest.
        if (avvioInCorso) {
          let avvioRiuscito = true;
          await avvioInCorso.catch(() => { avvioRiuscito = false; });
          if (
            !eraBloccatoDaPreparazione &&
            avvioRiuscito &&
            avvioCompletatoAlle > 0 &&
            Date.now() - avvioCompletatoAlle < 2_000
          ) {
            schedulaFineCaricamento();
            return;
          }
        }
        if (pollIncrementaleInCorso) await pollIncrementaleInCorso;
        if (!attivo || riallineamentoDatiInCorso()) return;
        const controllo = await controlloRemotoConFallback();
        if (!attivo) return;
        setControlloRemoto(controllo);
        if (controllo.disabled) {
          await api.notificheDisattivaSessione().catch(() => {});
          setBloccoRemoto(controllo);
          aggiornaCaricamento(false);
          void distruggiFinestreEsterneAllaMain();
          return;
        }
        setBloccoRemoto(null);
        setTestoCaricamento("Sincronizzo i dati più recenti...");

        const bootstrapCorrente = await bootstrapConRetry(() => {
          if (attivo) setTestoCaricamento("Attendo la sincronizzazione dei dati...");
        });
        if (eraBloccatoDaPreparazione && !ripristinoRemotoInCorso(bootstrapCorrente)) {
          let lock;
          try {
            lock = await api.operationLockStatus();
          } catch {
            mantieniTestoRipristino = true;
            setTestoCaricamento("Ripristino in corso…");
            aggiornaCaricamento(true);
            return;
          }
          if (lockMantieneBloccoRipristino(lock)) {
            mantieniTestoRipristino = true;
            setTestoCaricamento("Ripristino in corso…");
            aggiornaCaricamento(true);
            return;
          }
          // Prepare annullato o coordinatore terminato: il bootstrap autorevole
          // non segnala alcun commit, quindi la UI può tornare operativa.
          disattivaRipristinoBloccante();
        }
        const data = await riallineaPrimaDelleViste(bootstrapCorrente);
        if (!attivo) return;
        setErrore(null);
        aggiornaBootData(data);
        await preparaDopoBootstrap(data);
        if (!attivo) return;

        if (eraInCaricamento) {
          // Click durante il bootstrap iniziale: la promise condivisa ha gia'
          // consegnato alle viste la proiezione riallineata, senza un secondo ingest.
          schedulaFineCaricamento();
        } else if (bootstrapSincronizzabile(data)) {
          // Ritorno nella tray con UI già montata: forza un refresh anche se il watcher
          // aveva già ingerito gli eventi mentre WebView2 era sospeso e `forceSync`
          // non ha quindi più entità nuove da restituire.
          const { emit } = await import("@tauri-apps/api/event");
          await emit("pt:proiezione-ricostruita");
        } else {
          // Reset, cartella mancante o identità rimossa richiedono di rimontare App
          // usando il nuovo bootstrap; è corretto perdere lo stato UI in questi casi.
          aggiornaCaricamento(true);
          setTimeout(() => {
            if (attivo) aggiornaCaricamento(false);
          }, 0);
        }
      } catch (err) {
        if (attivo && (eraInCaricamento || eraBloccatoDaPreparazione)) {
          setErrore(String(err));
          aggiornaCaricamento(false);
        }
      } finally {
        rivelazioneInCorso = false;
        if (attivo && !mantieniTestoRipristino) setTestoCaricamento("Carico il gestionale…");
      }
    };

    const apriSpotlightCoordinato = () =>
      apriSpotlightDopoAvvio({
        avvioInCorso,
        bootstrapCorrente: () => bootDataRef.current,
        aperturaBloccata: () =>
          !attivo ||
          caricamentoRef.current ||
          !!bloccoRemotoRef.current?.disabled ||
          ripristinoFallitoRef.current ||
          ripristinoBloccanteAttivo() ||
          rivelazioneInCorso ||
          ricostruzioneBootInCorso ||
          riallineamentoDatiInCorso(),
        apri: apriSpotlightDaScorciatoia,
      });

    const setupListener = () => {
      import("@tauri-apps/api/event").then(({ listen }) => {
        if (!attivo) return;
        listen("pt:main-rivelata", () => {
          if (focusSyncTimer) {
            clearTimeout(focusSyncTimer);
            focusSyncTimer = null;
          }
          void gestisciRivelazione();
        }).then((fn) => {
          if (attivo) {
            unlistenRevealFn = fn;
            // Chiude la piccola finestra fra `show()` nativo e la sottoscrizione:
            // se il click tray e' arrivato prima del listener, la visibilita' della
            // main conserva comunque l'intenzione e avvia il riallineamento.
            import("@tauri-apps/api/webviewWindow")
              .then(({ getCurrentWebviewWindow }) => getCurrentWebviewWindow().isVisible())
              .then((visibile) => {
                if (visibile && attivo && caricamentoRef.current) void gestisciRivelazione();
              })
              .catch(() => {});
          } else fn();
        });
      });
    };

    const setupSpotlightListener = () => {
      import("@tauri-apps/api/event").then(({ listen }) => {
        if (!attivo) return;
        listen("pt:apri-spotlight", () => {
          void apriSpotlightCoordinato();
        }).then((fn) => {
          if (attivo) unlistenSpotlightFn = fn;
          else fn();
        });
      });
    };

    // Il click tray emette `pt:main-rivelata`; un normale ritorno dalla taskbar o
    // da un'altra applicazione produce invece soltanto focus/visibility. Ritardiamo
    // appena il fallback così l'evento tray possa cancellarlo: un solo coordinatore
    // esegue bootstrap, sync e invalidazione completa.
    const programmaRiallineamentoDaFocus = () => {
      if (!attivo || document.visibilityState === "hidden" || focusSyncTimer) return;
      focusSyncTimer = setTimeout(() => {
        focusSyncTimer = null;
        void import("@tauri-apps/api/window")
          .then(({ getCurrentWindow }) => getCurrentWindow().isVisible())
          .then((visibile) => {
            if (visibile) void gestisciRivelazione();
          })
          .catch(() => {});
      }, 120);
    };

    async function avvia() {
      const controllo = await controlloRemotoConFallback();
      if (!attivo) return;
      setControlloRemoto(controllo);
      if (controllo.disabled) {
        await api.notificheDisattivaSessione().catch(() => {});
        setBloccoRemoto(controllo);
        aggiornaCaricamento(false);
        void distruggiFinestreEsterneAllaMain();
        return;
      }
      setBloccoRemoto(null);

      const segnalaAttesaSincronizzazione = () => {
        if (attivo) setTestoCaricamento("Attendo la sincronizzazione dei dati...");
      };
      const [bootstrapIniziale, primoAvvio, minimized, mainVisibile] = await Promise.all([
        bootstrapConRetry(segnalaAttesaSincronizzazione),
        getPrimoAvvio(),
        api.avvioMinimizzato().catch(() => false),
        mainVisibileOra(),
      ]);
      setAvvioNascosto(renderingInizialeNascosto(primoAvvio, minimized, mainVisibile));
      if (!attivo) return;
      const data = await riallineaPrimaDelleViste(bootstrapIniziale);
      if (!attivo) return;
      aggiornaBootData(data);

      // Se l'utente è registrato, attiviamo subito notifiche e overlay in background.
      // Il loader di main resta su "Carico il gestionale..."; il testo
      // "Preparo la tua dashboard..." appartiene al passaggio successivo (App/Shell).
      await preparaDopoBootstrap(data);

      if (!attivo) return;
      avvioCompletatoAlle = Date.now();

      // Anche in tray montiamo App/Shell: la finestra nativa resta invisibile, ma
      // ricerca, cache e viste completano il loro avvio senza un secondo bootstrap.
      aggiornaCaricamento(false);
    }

    // Resta attivo per tutta la vita della main: copre sia il primo avvio nascosto
    // post-update sia ogni successivo ritorno dalla tray.
    setupListener();
    window.addEventListener("focus", programmaRiallineamentoDaFocus);
    document.addEventListener("visibilitychange", programmaRiallineamentoDaFocus);
    // Un solo polling incrementale per la main, indipendente dal mount della Shell.
    // Le guardie sopra lo sospendono durante sync complete e ricostruzioni.
    pollInterval = window.setInterval(pollIncrementale, 6000);
    const avvioTask = avvia();
    avvioInCorso = avvioTask;
    setupSpotlightListener();
    void getAvvioSpotlight().then((spotlightLaunch) => {
      if (spotlightLaunch && attivo) void apriSpotlightCoordinato();
    });
    void avvioTask.catch((err) => {
        if (!attivo) return;
        setErrore(String(err));
        aggiornaCaricamento(false);
      }).finally(() => {
        if (avvioInCorso === avvioTask) avvioInCorso = null;
      });

    return () => {
      attivo = false;
      if (unlistenRevealFn) unlistenRevealFn();
      if (unlistenDataWipedFn) unlistenDataWipedFn();
      if (unlistenSyncProgressFn) unlistenSyncProgressFn();
      if (unlistenSpotlightFn) unlistenSpotlightFn();
      if (timerId) clearTimeout(timerId);
      if (focusSyncTimer) clearTimeout(focusSyncTimer);
      if (pollInterval) clearInterval(pollInterval);
      window.removeEventListener("focus", programmaRiallineamentoDaFocus);
      document.removeEventListener("visibilitychange", programmaRiallineamentoDaFocus);
    };
  }, [isFinestraSecondaria]);

  useEffect(() => {
    if (!inTauri) return;
    let attivo = true;
    let unlistenFn: (() => void) | null = null;

    const annullaControlloScadenza = () => {
      const corrente = controlloScadenzaRestoreRef.current;
      if (corrente) clearTimeout(corrente.timer);
      controlloScadenzaRestoreRef.current = null;
    };

    const programmaControlloScadenza = (restoreId: string, attesaMs: number) => {
      annullaControlloScadenza();
      const timer = setTimeout(async () => {
        if (!attivo || controlloScadenzaRestoreRef.current?.restoreId !== restoreId) return;
        const data = await bootstrapConRetry().catch(() => null);
        if (!attivo) return;
        if (!data) {
          programmaControlloScadenza(restoreId, 30_000);
          return;
        }
        if (ripristinoRemotoInCorso(data)) {
          annullaControlloScadenza();
          setErrore(null);
          aggiornaBootData(data);
          attivaRipristinoBloccante();
          setTestoCaricamento(
            statoConsegnaRipristino(data) === "waiting"
              ? "Attendo che OneDrive completi il ripristino..."
              : "Sincronizzo i dati più recenti..."
          );
          aggiornaCaricamento(true);
          await import("@tauri-apps/api/event")
            .then(({ emit }) =>
              emit("pt:data-wiped", {
                reason: statoConsegnaRipristino(data) === "waiting" ? "restore-waiting" : "restore",
              })
            )
            .catch(() => {
              programmaControlloScadenza(restoreId, INTERVALLO_CONTROLLO_PREPARAZIONE_MS);
            });
          return;
        }

        let lock;
        try {
          lock = await api.operationLockStatus();
        } catch {
          programmaControlloScadenza(restoreId, 30_000);
          return;
        }
        if (lockMantieneBloccoRipristino(lock)) {
          programmaControlloScadenza(restoreId, INTERVALLO_CONTROLLO_PREPARAZIONE_MS);
          return;
        }

        annullaControlloScadenza();
        disattivaRipristinoBloccante();
        terminaRiallineamentoDati();
        setTestoCaricamento("Carico il gestionale…");
        setErrore(null);
        aggiornaBootData(data);
        await preparaDopoBootstrap(data);
        if (attivo) aggiornaCaricamento(false);
      }, attesaMs);
      controlloScadenzaRestoreRef.current = { restoreId, timer };
    };

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ restoreId?: string }>("pt:restore-prepare", async (event) => {
          const restoreId = event.payload?.restoreId?.trim();
          if (restoreId) {
            programmaControlloScadenza(restoreId, INTERVALLO_CONTROLLO_PREPARAZIONE_MS);
          }
          attivaRipristinoBloccante();
          await api.notificheDisattivaSessione().catch(() => {});
          if (isFinestraSecondaria) {
            await distruggiFinestraCorrenteSecondaria();
            return;
          }
          if (!attivo) return;
          setErrore(null);
          setTestoCaricamento("Ripristino in corso…");
          aggiornaCaricamento(true);
          void distruggiFinestreEsterneAllaMain();
        })
      )
      .then((fn) => {
        if (attivo) unlistenFn = fn;
        else fn();
      })
      .catch(() => {});

    return () => {
      attivo = false;
      annullaControlloScadenza();
      if (unlistenFn) unlistenFn();
    };
  }, [isFinestraSecondaria]);

  useEffect(() => {
    if (!inTauri || isFinestraSecondaria) return;
    let attivo = true;
    let unlistenFn: (() => void) | null = null;

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ restoreId?: string }>("pt:restore-cancelled", async (event) => {
          if (!attivo) return;
          const controlloScadenza = controlloScadenzaRestoreRef.current;
          const restoreId = event.payload?.restoreId?.trim();
          if (controlloScadenza && restoreId && controlloScadenza.restoreId !== restoreId) {
            return;
          }
          if (controlloScadenza && (!restoreId || controlloScadenza.restoreId === restoreId)) {
            clearTimeout(controlloScadenza.timer);
            controlloScadenzaRestoreRef.current = null;
          }
          disattivaRipristinoBloccante();
          terminaRiallineamentoDati();
          setTestoCaricamento("Carico il gestionale…");
          const data = await bootstrapConRetry().catch((err) => {
            if (attivo) setErrore(String(err));
            return null;
          });
          if (!attivo) return;
          if (data) {
            setErrore(null);
            aggiornaBootData(data);
            await preparaDopoBootstrap(data);
          }
          if (attivo) aggiornaCaricamento(false);
        })
      )
      .then((fn) => {
        if (attivo) unlistenFn = fn;
        else fn();
      })
      .catch(() => {});

    return () => {
      attivo = false;
      if (unlistenFn) unlistenFn();
    };
  }, [isFinestraSecondaria]);

  useEffect(() => {
    if (!inTauri) return;
    let attivo = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let unlistenFn: (() => void) | null = null;

    const applica = (controllo: RemoteControlStatus) => {
      if (!attivo) return;
      setControlloRemoto(controllo);
      if (controllo.disabled) {
        void api.notificheDisattivaSessione().catch(() => {});
        if (isFinestraSecondaria) {
          void distruggiFinestraCorrenteSecondaria();
          return;
        }
        setBloccoRemoto(controllo);
        aggiornaCaricamento(false);
        void distruggiFinestreEsterneAllaMain();
      }
    };

    const aggiorna = async () => {
      const controllo = await controlloRemotoConFallback();
      applica(controllo);
    };

    import("./remoteControl")
      .then(({ EVENTO_CONTROLLO_REMOTO_CAMBIATO, INTERVALLO_CONTROLLO_REMOTO_MS }) => {
        if (!attivo) return;
        if (isFinestraSecondaria) void aggiorna();
        intervalId = window.setInterval(() => void aggiorna(), INTERVALLO_CONTROLLO_REMOTO_MS);

        import("@tauri-apps/api/event")
          .then(({ listen }) =>
            listen<RemoteControlStatus>(EVENTO_CONTROLLO_REMOTO_CAMBIATO, (event) => {
              applica(event.payload);
            })
          )
          .then((fn) => {
            if (attivo) unlistenFn = fn;
            else fn();
          })
          .catch(() => {});
      })
      .catch(() => {});

    return () => {
      attivo = false;
      if (intervalId) clearInterval(intervalId);
      if (unlistenFn) unlistenFn();
    };
  }, [isFinestraSecondaria, bootData, bloccoRemoto]);

  // Mostra le finestre utente una volta che React ha montato il guscio, eliminando
  // flash bianchi/neri durante l'avvio. Le finestre di servizio (Spotlight/overlay)
  // restano invece sotto controllo dei loro trigger: scorciatoia/notifiche.
  useEffect(() => {
    if (finestraSpotlight || finestraOverlay) return;
    // Le bozze preventivo usano un handoff in memoria: sarà il chiamante a
    // mostrare la WebView solo quando l'editor ha confermato di averla montata.
    if (finestraPreventivo && params.has("handoff")) return;
    if (inTauri) {
      import("@tauri-apps/api/webviewWindow")
        .then(({ getCurrentWebviewWindow }) => {
          const w = getCurrentWebviewWindow();
          setTimeout(async () => {
            try {
              if (w.label === "main") {
                // Riveliamo la `main` (nasce visible:false) SOLO al primo mount del
                // processo. Sul risveglio dalla sospensione WebView2 ricarica la pagina:
                // quel reload NON deve ri-mostrare la finestra se era nascosta nella tray
                // (né ri-toccarne geometria). Il flag vive lato Rust (sopravvive ai reload).
                const primoAvvio = await getPrimoAvvio();
                if (!primoAvvio) return;
                // Ripristina misura e posizione ricordate PRIMA di mostrarla (niente salto).
                await applicaGeometria("main", GEOM_MAIN);
                // Avvio automatico `--minimized`: resta nascosta nella tray.
                const minimized = await api.avvioMinimizzato().catch(() => false);
                if (minimized) return;
              }
              segnaMainVisibileOra();
              await w.show();
              w.unminimize().catch(() => {});
              w.setFocus().catch(() => {});
            } catch {}
          }, 80);
        })
        .catch(() => {});
    }
  }, []);

  // "Riduci animazioni" deve spegnere anche le transizioni/animazioni CSS (es. apertura
  // sidebar): una classe sul root le azzera (oltre a MotionConfig per Framer Motion).
  useLayoutEffect(() => {
    document.documentElement.classList.toggle(
      "riduci-animazioni",
      ridurreAnimazioni || avvioNascosto
    );
  }, [ridurreAnimazioni, avvioNascosto]);

  // Zoom dell'interfaccia. Usiamo lo zoom a livello **webview** (come Ctrl+ del
  // browser) invece del CSS `zoom` sul root: il CSS `zoom` sfasava il posizionamento
  // dei popover/menu (Floating UI misura in coordinate non scalate → dropdown in
  // posizioni assurde). Lo zoom webview scala tutto in modo coerente, overlay inclusi.
  // Non si applica alle finestre a dimensione fissa (Spotlight/Riepilogo), che restano al 100%.
  useEffect(() => {
    const fattore = zoomUI || 1;
    if (inTauri) {
      import("@tauri-apps/api/webviewWindow")
        .then(({ getCurrentWebviewWindow }) => getCurrentWebviewWindow().setZoom(fattore))
        .catch(() => {});
    } else {
      // Fuori da Tauri (anteprima browser) non c'è la API: ripiego sul CSS zoom.
      document.documentElement.style.zoom = String(fattore);
    }
  }, [zoomUI]);

  const cached = getCachedIdentity();
  const fallback = finestraOverlay ? (
    // L'overlay è mostrato fin dall'avvio (per tenerne vivo il renderer) ma dev'essere
    // INVISIBILE finché non arrivano notifiche: fallback trasparente, mai il box grigio.
    <div style={{ width: "100vw", height: "100vh", background: "transparent" }} />
  ) : isFinestraSecondaria ? (
    <div style={{ width: "100vw", height: "100vh", background: "var(--bg, #f8f9fa)" }} />
  ) : cached ? (
    <UnifiedBootScreen identity={bootData?.identity ?? cached} testoSottotitolo={testoCaricamento} />
  ) : (
    <CaricamentoSchermo testo={testoCaricamento} />
  );

  const showLoader = caricamento && !isFinestraSecondaria;

  return (
    <MotionConfig reducedMotion={ridurreAnimazioni || avvioNascosto ? "always" : "user"}>
      <PremiumAccessProvider status={controlloRemoto}>
        <ErrorBoundary
          onError={() => {
            if (!isFinestraSecondaria) setErroreRendering(true);
          }}
          onReset={() => setErroreRendering(false)}
        >
          {bloccoRemoto ? (
            <SchermoBloccoRemoto
              stato={bloccoRemoto}
              onRetry={async () => {
                const controllo = await controlloRemotoConFallback();
                setControlloRemoto(controllo);
                if (controllo.disabled) {
                  setBloccoRemoto(controllo);
                } else {
                  await riprendiDopoSbloccoRemoto();
                }
              }}
            />
          ) : showLoader ? (
            fallback
          ) : (
            <Suspense fallback={fallback}>
              <Schermo
                boot={bootData}
                erroreBootstrap={errore}
                avvioNascosto={avvioNascosto}
                onBootstrapChange={aggiornaBootData}
              />
            </Suspense>
          )}
        </ErrorBoundary>
        {/* Le finestre operative mostrano il feedback nel proprio contesto. Spotlight
          e l'overlay custom non montano toast: il relativo store inoltra alla main
          qualsiasi messaggio applicativo eventualmente generato lì. */}
        {!bloccoRemoto && !finestraServizioToast && (
          <ToastProvider riceviInoltri={!isFinestraSecondaria} />
        )}
        {!isFinestraSecondaria && <AggiornamentiMain />}
        {!bloccoRemoto && !isFinestraSecondaria && <RicordaGeometriaMain />}
        {!bloccoRemoto && <DialogProvider />}
        {!bloccoRemoto && <MonetinaHost />}
        <MenuContestualeTesto />
      </PremiumAccessProvider>
    </MotionConfig>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light" cssVariablesResolver={v8CssVariablesResolver}>
      <PrefsProvider>
        <Root />
      </PrefsProvider>
    </MantineProvider>
  </React.StrictMode>
);
