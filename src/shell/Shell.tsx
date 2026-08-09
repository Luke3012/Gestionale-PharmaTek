// Layout principale: sidebar + topbar + area contenuto con routing.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Box } from "@mantine/core";
import { AnimatePresence, motion } from "framer-motion";
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, inTauri, type Identity } from "../lib/tauri";
import { dialog } from "../ui/dialog/store";
import { toast } from "../ui/toast/store";
import { usePrefs } from "../lib/prefs";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ascoltaNavigazione, mostraSpotlight, registraHotkeyGlobale, DeepLinkCtx, type DeepLink } from "./navigazione";
import { RiepilogoModalHost } from "./RiepilogoModalHost";
import { fadeSlide } from "../ui/motion";
import { UnifiedBootScreen } from "../ui/Brand";
import { vistaBloccanteAttiva } from "../lib/closeOnScroll";
import { CHIAVE_ANNO_PROMPT_COMPLETATO, deveProporreCambioAnno } from "./cambioAnno";
import { PremiumRoute } from "../premium/PremiumAccess";

const rottaSenzaAnimazione = {
  initial: { opacity: 1, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0 } },
  exit: { opacity: 1, y: 0, transition: { duration: 0 } },
};

const DashboardView = lazy(() =>
  import("../features/dashboard/DashboardView").then((m) => ({ default: m.DashboardView }))
);
const GiornalieroView = lazy(() =>
  import("../features/giornaliero/GiornalieroView").then((m) => ({ default: m.GiornalieroView }))
);
const PreventiviView = lazy(() =>
  import("../features/preventivi/PreventiviView").then((m) => ({ default: m.PreventiviView }))
);
const ProduzioneView = lazy(() =>
  import("../features/produzione/ProduzioneView").then((m) => ({ default: m.ProduzioneView }))
);
const ContabilitaHub = lazy(() =>
  import("../features/contabilita/ContabilitaHub").then((m) => ({ default: m.ContabilitaHub }))
);
const SpedizioniView = lazy(() =>
  import("../features/spedizioni/SpedizioniView").then((m) => ({ default: m.SpedizioniView }))
);
const AnagraficheHub = lazy(() =>
  import("../features/anagrafiche/AnagraficheHub").then((m) => ({ default: m.AnagraficheHub }))
);
const Impostazioni = lazy(() =>
  import("../pages/Impostazioni").then((m) => ({ default: m.Impostazioni }))
);
const ComunicazioneComposerHost = lazy(() =>
  import("../features/comunicazioni/ComunicazioneComposer").then((m) => ({
    default: m.ComunicazioneComposerHost,
  }))
);
const CentroComunicazioniHost = lazy(() =>
  import("../features/comunicazioni/CentroComunicazioni").then((m) => ({
    default: m.CentroComunicazioniHost,
  }))
);
const CampagnaComunicazioniHost = lazy(() =>
  import("../features/comunicazioni/CampagnaComunicazioni").then((m) => ({
    default: m.CampagnaComunicazioniHost,
  }))
);

export function Shell({
  identity,
  onIdentityChange,
  forceDashboardIntro = false,
  testoDashboardLoader = "Preparo la tua dashboard…",
}: {
  identity: Identity;
  onIdentityChange: (identity: Identity) => void;
  forceDashboardIntro?: boolean;
  testoDashboardLoader?: string | null;
}) {
  return (
    <MemoryRouter>
      <ShellLayout
        identity={identity}
        onIdentityChange={onIdentityChange}
        forceDashboardIntro={forceDashboardIntro}
        testoDashboardLoader={testoDashboardLoader}
      />
    </MemoryRouter>
  );
}

function ShellLayout({
  identity,
  onIdentityChange,
  forceDashboardIntro = false,
  testoDashboardLoader = "Preparo la tua dashboard…",
}: {
  identity: Identity;
  onIdentityChange: (identity: Identity) => void;
  forceDashboardIntro?: boolean;
  testoDashboardLoader?: string | null;
}) {
  const { anno, setAnno, sidebar, setSidebar, cestinoGiorni, hotkeyGlobale, ridurreAnimazioni } =
    usePrefs();
  const navigate = useNavigate();
  const location = useLocation();
  const forceDashboardIntroRef = useRef(forceDashboardIntro);
  const forceDashboardIntroOnce = forceDashboardIntroRef.current;
  // Deep-link pendente richiesto da Spotlight/Riepilogo (rotta + filtro da applicare).
  const [deepLink, setDeepLink] = useState<DeepLink | null>(null);
  // Scroll del contenuto: oltre la soglia il titolo grande esce di scena e la topbar
  // mostra il titolo pagina (crossfade dal wordmark). Vedi Topbar.
  const contenutoRef = useRef<HTMLDivElement>(null);
  const [scrollato, setScrollato] = useState(false);
  const annoPromptInSessioneRef = useRef<number | null>(null);
  const [annoCalendario, setAnnoCalendario] = useState(() => new Date().getFullYear());

  useEffect(() => {
    forceDashboardIntroRef.current = false;
  }, []);

  // Pulizia automatica del Cestino all'avvio (oltre la soglia in giorni).
  useEffect(() => {
    if (inTauri && cestinoGiorni > 0) api.cestinoPulisci(cestinoGiorni).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Chiude popover/menu su scorrimento (scroll) globale
  useEffect(() => {
    const handleScroll = (e: Event) => {
      // Le view a schermo intero gestiscono autonomamente lo scroll: non va
      // convertito nell'Esc sintetico usato per chiudere i menu flottanti.
      if (vistaBloccanteAttiva()) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Ignora se lo scorrimento avviene all'interno di dropdown, modali o pannelli
      if (
        target.closest(".mantine-Popover-dropdown") ||
        target.closest(".mantine-Menu-dropdown") ||
        target.closest(".mantine-Combobox-dropdown") ||
        target.closest(".mantine-Modal-content") ||
        target.closest(".mantine-Drawer-content")
      ) {
        return;
      }

      // Simula Escape per chiudere popover/menu
      const escEvent = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(escEvent);
    };

    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, []);
  // Automazione "Chiuso" all'avvio: gli ordini Spediti e saldati da ≥20 giorni
  // passano a Chiuso (silenziosa: è una manutenzione di stato, non disturba l'utente).
  useEffect(() => {
    if (inTauri) api.ordiniAutoChiudi().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aggiorna l'anno anche se il gestionale resta aperto durante il Capodanno.
  useEffect(() => {
    const aggiornaAnno = () => setAnnoCalendario(new Date().getFullYear());
    window.addEventListener("focus", aggiornaAnno);
    document.addEventListener("visibilitychange", aggiornaAnno);
    const timer = window.setInterval(aggiornaAnno, 60 * 60 * 1000);
    return () => {
      window.removeEventListener("focus", aggiornaAnno);
      document.removeEventListener("visibilitychange", aggiornaAnno);
      window.clearInterval(timer);
    };
  }, []);

  // Prompt "Cambio Anno": una sola richiesta per anno e per sessione. Il rinvio
  // non viene persistito, quindi la domanda ricompare al prossimo avvio.
  useEffect(() => {
    const fatto = localStorage.getItem(CHIAVE_ANNO_PROMPT_COMPLETATO);
    if (
      annoPromptInSessioneRef.current === annoCalendario ||
      !deveProporreCambioAnno(anno, annoCalendario, fatto)
    ) return;

    // Il ref viene valorizzato prima di aprire il dialog: evita duplicati durante
    // il replay degli effetti di StrictMode e mentre la Promise e ancora pendente.
    annoPromptInSessioneRef.current = annoCalendario;
    dialog
      .open<"si" | "dopo">({
        tipo: "info",
        titolo: `Benvenuto nel ${annoCalendario}!`,
        contenuto: `Stai lavorando sull'anno ${anno}. Vuoi passare al ${annoCalendario}?`,
        valoreAnnulla: "dopo",
        bottoni: [
          { label: "Ricordamelo al prossimo avvio", variante: "secondario", value: "dopo" },
          { label: `Sì, passa al ${annoCalendario}`, variante: "primario", value: "si", autofocus: true },
        ],
      })
      .then((scelta) => {
        if (scelta !== "si") return;
        setAnno(annoCalendario);
        localStorage.setItem(CHIAVE_ANNO_PROMPT_COMPLETATO, String(annoCalendario));
      });
  }, [anno, annoCalendario, setAnno]);

  // Mostra un toast se un backup automatico è stato eseguito in background (dall'OverlayWindow)
  // quando la finestra principale era chiusa o ridotta a icona. Scatta all'avvio e ad ogni focus.
  useEffect(() => {
    function controllaToast() {
      if (localStorage.getItem("pt.toastAutoBackup") === "1") {
        localStorage.removeItem("pt.toastAutoBackup");
        toast.success("Backup automatico eseguito.");
      }
    }
    controllaToast();
    window.addEventListener("focus", controllaToast);
    return () => window.removeEventListener("focus", controllaToast);
  }, []);

  // Scorciatoia GLOBALE di sistema (FASE 6A): funziona anche fuori dall'app →
  // mostra la barra di ricerca Spotlight (finestra a sé, sopra ogni cosa) SENZA
  // richiamare la finestra principale. In app la stessa cosa fa Ctrl+K.
  // La registrazione è idempotente (gestisce StrictMode/HMR): il toast d'errore
  // compare solo se la combo è davvero occupata da un altro programma.
  useEffect(() => {
    if (!inTauri) return;
    let annullato = false;
    registraHotkeyGlobale(hotkeyGlobale, () => void mostraSpotlight()).then((ok) => {
      if (!ok && !annullato) {
        toast.error(
          `Scorciatoia globale «${hotkeyGlobale}» non disponibile (forse già usata da un altro programma). Cambiala in Impostazioni.`,
          { durata: 8000 }
        );
      }
    });
    return () => {
      annullato = true;
    };
  }, [hotkeyGlobale]);

  // Ctrl+B mostra/nasconde la sidebar; Ctrl+K apre la barra di ricerca Spotlight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setSidebar(sidebar === "nascosto" ? "esteso" : "nascosto");
      } else if (e.ctrlKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        void mostraSpotlight();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebar, setSidebar]);

  // Deep-link da Spotlight/Riepilogo: naviga alla rotta richiesta e tiene da parte
  // il filtro (cerca/tab) finché la vista di destinazione non lo consuma.
  useEffect(() => {
    if (!inTauri) return;
    let attivo = true;
    let off: (() => void) | undefined;
    ascoltaNavigazione((link) => {
      if (!attivo) return false;
      setDeepLink(link);
      navigate(link.path);
      return true;
    })
      .then((u) => {
        if (attivo) off = u;
        else u();
      })
      .catch(() => {});
    return () => {
      attivo = false;
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cambio rotta: torna in cima e azzera lo stato "scrollato" (titolo big di nuovo
  // visibile), così la topbar è coerente su ogni pagina.
  useEffect(() => {
    contenutoRef.current?.scrollTo({ top: 0 });
    setScrollato(false);
  }, [location.pathname]);

  const nascosto = sidebar === "nascosto";
  // Le etichette dipendono SOLO dalla scelta dell'utente (pulsante ☰), non dalla
  // larghezza della finestra: "icone" = solo icone, "esteso" = icone + testo.
  const compatto = sidebar === "icone";

  const larghezzaTarget = nascosto ? 0 : compatto ? 60 : 220;
  const contenitoreRef = useRef<HTMLDivElement>(null);
  const prevLarghezza = useRef(larghezzaTarget);

  useLayoutEffect(() => {
    const from = prevLarghezza.current;
    const to = larghezzaTarget;
    if (from === to) return;
    prevLarghezza.current = to;

    const box = contenitoreRef.current;
    if (!box) return;

    if (ridurreAnimazioni) {
      // Con "Riduci animazioni" attiva, applichiamo immediatamente il nuovo layout.
      // Evitiamo di affidarci a transitionend perché le transizioni a 0s potrebbero non scattare.
      box.style.transition = "none";
      box.style.transform = "none";
      box.style.marginLeft = `${to}px`;
      return;
    }

    // FLIP PERFETTO: Non cambiamo il layout (width) durante l'animazione!
    // 1. Manteniamo il margin-left vecchio. Nessun ricalcolo della tabella.
    box.style.transition = "none";
    box.style.marginLeft = `${from}px`;
    box.style.transform = `translateX(0px)`;

    // Forza applicazione stili GPU
    void box.offsetHeight;

    // 2. Animiamo solo lo spostamento visivo (GPU) lasciando la larghezza invariata
    box.style.transition = "transform var(--dur-base) var(--ease-inout)";
    box.style.transform = `translateX(${to - from}px)`;

    // 3. Solo alla fine applichiamo il nuovo layout (1 solo ricalcolo alla fine)
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "transform" && e.target === box) {
        box.removeEventListener("transitionend", onEnd);
        box.style.transition = "none";
        box.style.transform = "none";
        box.style.marginLeft = `${to}px`;
      }
    };
    box.addEventListener("transitionend", onEnd);
  }, [larghezzaTarget, ridurreAnimazioni]);

  // Le rotte restano dentro un unico wrapper stabile: cambiare «Riduci animazioni»
  // deve modificare soltanto la transizione, senza smontare la pagina corrente.
  const fallbackRotta =
    location.pathname === "/" ? (
      testoDashboardLoader === null ? (
        <Box style={{ flex: 1, minHeight: 0 }} />
      ) : (
        <UnifiedBootScreen identity={identity} testoSottotitolo={testoDashboardLoader} />
      )
    ) : (
      <Box style={{ flex: 1 }} />
    );
  const rotte: ReactNode = (
    <Suspense fallback={fallbackRotta}>
      <Routes location={location}>
        <Route path="/" element={<DashboardView identity={identity} forceIntro={forceDashboardIntroOnce} testoIntro={testoDashboardLoader} />} />
        <Route path="/giornaliero" element={<GiornalieroView identity={identity} />} />
        <Route path="/preventivi" element={<PremiumRoute><PreventiviView identity={identity} /></PremiumRoute>} />
        <Route path="/produzione" element={<ProduzioneView identity={identity} />} />
        <Route path="/contabilita" element={<ContabilitaHub />} />
        <Route path="/evasione" element={<SpedizioniView identity={identity} />} />
        <Route path="/anagrafiche" element={<AnagraficheHub />} />
        <Route path="/impostazioni" element={<Impostazioni identity={identity} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );

  return (
    <DeepLinkCtx.Provider value={{ link: deepLink, consuma: () => setDeepLink(null) }}>
      <Box style={{ position: "relative", display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
        {!nascosto && (
          <Box
            style={{ position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 100, display: "flex" }}
          >
            <Sidebar compatto={compatto} />
          </Box>
        )}
        <Box style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Box style={{ marginLeft: larghezzaTarget, transition: "margin-left var(--dur-base) var(--ease-inout)" }}>
            <Topbar identity={identity} onIdentityChange={onIdentityChange} onCerca={() => void mostraSpotlight()} scrollato={scrollato} />
          </Box>
          <Box
            ref={contenitoreRef}
            style={{ 
              flex: 1, 
              display: "flex", 
              flexDirection: "column", 
              minWidth: 0, 
              minHeight: 0,
              marginLeft: larghezzaTarget // fallback se layout non applica in tempo, ma gestito da ref
            }}
          >
            <Box
            ref={contenutoRef}
            onScroll={(e) => {
              const oltre = e.currentTarget.scrollTop > 44;
              setScrollato((s) => (s === oltre ? s : oltre));
            }}
            style={{ flex: 1, overflowX: "hidden", overflowY: "auto", background: "var(--bg)" }}
          >
            {/* Transizione tra schermate (FASE 7C). `mode="wait"` fa uscire del tutto la vecchia
                vista prima di montare la nuova (niente accavallamenti di tabelle pesanti).
                IMPORTANTE: il wrapper di rotta fa SOLO l'uscita; **non** anima l'entrata
                (`initial="animate"` = parte già allo stato finale). L'unica animazione d'ingresso
                la fa <Pagina>, che la sgancia alla **fine del load reale** (`usePaginaPronta`):
                così non c'è prima la cornice che entra e poi lo "scatto" del contenuto a dati
                arrivati — entra tutto insieme, già pronto. Con «Riduci animazioni» lo stesso
                wrapper resta montato e usa una variante istantanea: il toggle non ricrea la rotta. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                variants={ridurreAnimazioni ? rottaSenzaAnimazione : fadeSlide}
                initial="animate"
                animate="animate"
                exit="exit"
                style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}
              >
                {rotte}
              </motion.div>
            </AnimatePresence>
          </Box>
        </Box>
        </Box>
      </Box>
      <RiepilogoModalHost
        identity={identity}
        onNaviga={(link) => {
          setDeepLink(link);
          navigate(link.path);
        }}
      />
      <Suspense fallback={null}>
        <CentroComunicazioniHost />
        <ComunicazioneComposerHost />
        <CampagnaComunicazioniHost />
      </Suspense>
    </DeepLinkCtx.Provider>
  );
}
