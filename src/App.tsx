import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Center, Group, Stack, Text } from "@mantine/core";
import { motion } from "framer-motion";
import { api, inTauri, type Bootstrap, type Identity } from "./lib/tauri";
import { LogoMark, Wordmark, SchermoBenvenuto, UnifiedBootScreen } from "./ui/Brand";
import { Onboarding } from "./onboarding/Onboarding";
import { Shell } from "./shell/Shell";
import { assicuraFinestraSpotlight } from "./shell/navigazione";
import { novitaDaMostrare, segnaVista, type VersioneChangelog } from "./features/changelog/changelog";
import { NovitaPanel } from "./features/changelog/NovitaPanel";
import { BLOCKING_VIEW_SELECTOR, CLOSE_FLOATING_UI_EVENT, vistaBloccanteAttiva } from "./lib/closeOnScroll";
import { easeOut, useAnimazioniRidotte } from "./ui/motion";
import {
  completaRicollegamento,
  marcaRicollegamentoRichiesto,
  ricollegamentoRichiesto,
} from "./lib/sessione";
import { destinazioneBootstrap } from "./lib/destinazioneBootstrap";
import { toast } from "./ui/toast/store";
import { eventoRichiedeBloccoRipristino } from "./lib/consegnaRipristino";
import {
  iniziaRiallineamentoDati,
  eventoRichiedeRiconvalidaSessione,
  messaggioRiallineamentoDati,
  messaggioRiallineamentoDatiCompletato,
  messaggioRiallineamentoDatiFallito,
  registraGestoreRiallineamentoApp,
  ricostruisciProiezioneConRetry,
  ripristinoBloccanteAttivo,
  terminaRiallineamentoDati,
} from "./lib/riallineamentoDati";
import { pulisciStatoNotificheComunicazioniLocale } from "./features/notifiche/statoComunicazioniLocale";

type Stato =
  | { fase: "browser" }
  | { fase: "errore"; messaggio: string }
  | { fase: "dataProblem"; messaggio: string }
  | { fase: "reconnect"; boot: Bootstrap }
  | { fase: "onboarding"; boot: Bootstrap }
  | { fase: "benvenuto"; identity: Identity }
  | { fase: "pronto"; identity: Identity; justOnboarded?: boolean };

const MESSAGGIO_CARTELLA_DATI_NON_DISPONIBILE =
  "La cartella dati condivisa configurata su questo PC è vuota o non è raggiungibile.";

const EVENTI_DATI_RICOSTRUITI = ["pt:proiezione-ricostruita", "pt:ricerca-invalidata"] as const;
let preloadDashboardPromise: Promise<unknown> | null = null;

function disattivaNotificheSessione() {
  if (!inTauri) return;
  void api.notificheDisattivaSessione().catch(() => {});
}

function preloadDashboardDopoOnboarding(): Promise<unknown> {
  if (!preloadDashboardPromise) {
    preloadDashboardPromise = import("./features/dashboard/DashboardView").catch(() => null);
  }
  return preloadDashboardPromise;
}

function FadePrimoIngressoDashboard({ attivo, children }: { attivo: boolean; children: ReactNode }) {
  const ridotte = useAnimazioniRidotte();

  if (!attivo) return <>{children}</>;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: ridotte ? 0 : 0.32, ease: easeOut }}
      style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}
    >
      {children}
    </motion.div>
  );
}

function App({
  boot,
  erroreBootstrap,
  avvioNascosto = false,
  onBootstrapChange,
}: {
  boot: Bootstrap | null;
  erroreBootstrap?: string | null;
  avvioNascosto?: boolean;
  onBootstrapChange?: (boot: Bootstrap) => void;
}) {
  const onBootstrapChangeRef = useRef(onBootstrapChange);
  onBootstrapChangeRef.current = onBootstrapChange;
  const [stato, setStato] = useState<Stato>(() => {
    if (!inTauri) return { fase: "browser" };
    if (erroreBootstrap) return { fase: "errore", messaggio: erroreBootstrap };
    if (!boot) return { fase: "errore", messaggio: "Errore imprevisto di avvio del sistema." };
    const destinazione = destinazioneBootstrap(boot, ricollegamentoRichiesto());
    if (destinazione === "reconnect") return { fase: "reconnect", boot };
    if (destinazione === "dataProblem") {
      return { fase: "dataProblem", messaggio: MESSAGGIO_CARTELLA_DATI_NON_DISPONIBILE };
    }
    if (destinazione === "pronto") return { fase: "pronto", identity: boot.identity! };
    return { fase: "onboarding", boot };
  });
  const faseRef = useRef(stato.fase);
  faseRef.current = stato.fase;

  useEffect(() => {
    if (!inTauri) return;
    let unsub: (() => void) | undefined;
    let attivo = true;
    let ricostruzioneInCorso = false;
    let ricostruzioneRichiesta = false;
    let ricostruzioneToastId: string | null = null;
    let scollegaCoordinamento: (() => void) | undefined;

    const applicaBootstrap = (nextBoot: Bootstrap) => {
      // Root resta la fonte usata da tray e scorciatoie anche quando il normale
      // riallineamento e' gestito da App: non deve conservare una vecchia sessione
      // valida dopo reset, ritiro del device o perdita della cartella dati.
      onBootstrapChangeRef.current?.(nextBoot);
      const destinazione = destinazioneBootstrap(nextBoot);
      if (destinazione === "reconnect") {
        disattivaNotificheSessione();
        try {
          localStorage.clear();
        } catch {}
        marcaRicollegamentoRichiesto();
        setStato({ fase: "reconnect", boot: nextBoot });
        return;
      }

      if (destinazione === "dataProblem") {
        disattivaNotificheSessione();
        setStato({
          fase: "dataProblem",
          messaggio: MESSAGGIO_CARTELLA_DATI_NON_DISPONIBILE,
        });
        return;
      }

      if (destinazione === "onboarding") {
        disattivaNotificheSessione();
        try {
          localStorage.clear();
        } catch {}
        setStato({ fase: "onboarding", boot: nextBoot });
        return;
      }

      try {
        localStorage.setItem("pt.lastIdentity", JSON.stringify(nextBoot.identity));
      } catch {}

      setStato((prev) => {
        if (prev.fase === "pronto" || prev.fase === "benvenuto") {
          const cur = prev.identity;
          const next = nextBoot.identity!;
          if (
            cur.userId === next.userId &&
            cur.deviceId === next.deviceId &&
            cur.nome === next.nome &&
            cur.avatarTipo === next.avatarTipo &&
            cur.avatarValore === next.avatarValore
          ) {
            return prev;
          }
        }
        return { fase: "pronto", identity: nextBoot.identity! };
      });
    };

    const segnalaRicostruzione = async () => {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await Promise.all(EVENTI_DATI_RICOSTRUITI.map((ev) => emit(ev)));
      } catch {}
    };

    const gestisciRicostruzione = async (reason?: string) => {
      if (ricostruzioneInCorso) {
        ricostruzioneRichiesta = true;
        if (ricostruzioneToastId) {
          toast.update(ricostruzioneToastId, {
            tipo: "loading",
            messaggio: messaggioRiallineamentoDati(reason),
            durata: 0,
          });
        }
        return;
      }
      if (!iniziaRiallineamentoDati()) return;
      ricostruzioneInCorso = true;
      ricostruzioneToastId = toast.loading(messaggioRiallineamentoDati(reason), {
        titolo: "Sincronizzazione",
      });
      try {
        do {
          ricostruzioneRichiesta = false;
          const { invoke } = await import("@tauri-apps/api/core");
          await ricostruisciProiezioneConRetry(() => {
            if (ricostruzioneToastId) {
              toast.update(ricostruzioneToastId, {
                tipo: "loading",
                messaggio: "Attendo la sincronizzazione dei dati...",
                durata: 0,
              });
            }
          });
          const nextBoot = await invoke<Bootstrap>("app_bootstrap");
          if (!attivo) return;
          applicaBootstrap(nextBoot);
          await segnalaRicostruzione();
        } while (attivo && ricostruzioneRichiesta);
        if (ricostruzioneToastId) {
          toast.update(ricostruzioneToastId, {
            tipo: "success",
            messaggio: messaggioRiallineamentoDatiCompletato(reason),
            durata: 7000,
          });
          ricostruzioneToastId = null;
        }
      } catch (e) {
        if (!attivo) return;
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const nextBoot = await invoke<Bootstrap>("app_bootstrap");
          if (!attivo) return;
          if (nextBoot.dataDirStatus !== "ok" || !nextBoot.onboarded) {
            applicaBootstrap(nextBoot);
          }
        } catch {
          setStato((prev) =>
            prev.fase === "pronto" || prev.fase === "benvenuto"
              ? prev
              : {
                  fase: "dataProblem",
                  messaggio: `Ricostruzione dati non riuscita: ${e}`,
                }
          );
        }
        if (ricostruzioneToastId) {
          toast.update(ricostruzioneToastId, {
            tipo: "error",
            messaggio: messaggioRiallineamentoDatiFallito(e),
            durata: 20000,
          });
          ricostruzioneToastId = null;
        }
      } finally {
        ricostruzioneInCorso = false;
        terminaRiallineamentoDati();
      }
    };

    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<{ reason?: string }>("pt:data-wiped", (event) => {
        if (!attivo) return;
        // La consegna parziale di un restore richiede una schermata bloccante e
        // attesa potenzialmente lunga: è sempre coordinata da Root, non da un toast.
        if (eventoRichiedeBloccoRipristino(event.payload?.reason)) return;
        // Identita' o device revocati passano dal bootscreen di Root: nessun toast
        // di successo deve comparire per un istante sopra la vecchia dashboard.
        if (eventoRichiedeRiconvalidaSessione(event.payload?.reason)) return;
        if (faseRef.current !== "pronto" && faseRef.current !== "benvenuto") {
          return;
        }
        if (ripristinoBloccanteAttivo()) {
          return;
        }
        void gestisciRicostruzione(event.payload?.reason);
      }))
      .then((fn) => {
        // StrictMode puo' eseguire il cleanup mentre la registrazione asincrona e'
        // ancora pendente: in quel caso rimuoviamo subito il listener appena nato.
        if (attivo) {
          unsub = fn;
          scollegaCoordinamento = registraGestoreRiallineamentoApp(
            () =>
              (faseRef.current === "pronto" || faseRef.current === "benvenuto") &&
              !ripristinoBloccanteAttivo()
          );
        } else fn();
      })
      .catch(() => {});
    return () => {
      attivo = false;
      if (ricostruzioneToastId) {
        toast.dismiss(ricostruzioneToastId);
        ricostruzioneToastId = null;
      }
      scollegaCoordinamento?.();
      unsub?.();
    };
  }, []);

  // Chiude popover/menu di Mantine al verificarsi di uno scroll all'esterno di essi.
  useEffect(() => {
    const handleScroll = (e: Event) => {
      if (vistaBloccanteAttiva()) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.closest(".mantine-Popover-dropdown") ||
          target.closest(".mantine-Menu-dropdown") ||
          target.closest(BLOCKING_VIEW_SELECTOR))
      ) {
        return;
      }
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.dispatchEvent(new Event(CLOSE_FLOATING_UI_EVENT));
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, []);

  useEffect(() => {
    if (stato.fase !== "reconnect") return;
    try {
      localStorage.clear();
    } catch {}
    marcaRicollegamentoRichiesto();
  }, [stato.fase]);

  // Ogni ingresso nell'onboarding apre una nuova identità/nuovo archivio locale:
  // i marker personali della sessione precedente non devono attraversarlo.
  useEffect(() => {
    if (stato.fase !== "onboarding") return;
    pulisciStatoNotificheComunicazioniLocale();
  }, [stato.fase]);

  useEffect(() => {
    if (!inTauri || stato.fase === "pronto" || stato.fase === "benvenuto") return;
    void api.notificheDisattivaSessione().catch(() => {});
  }, [stato.fase]);

  useEffect(() => {
    if (!inTauri || stato.fase !== "pronto") return;
    void assicuraFinestraSpotlight();
    void import("./features/notifiche/useNotifiche")
      .then(({ assicuraFinestraOverlay }) => assicuraFinestraOverlay())
      .catch(() => {});
  }, [stato.fase]);

  if (stato.fase === "browser") {
    return (
      <Center style={{ flex: 1, padding: 24 }}>
        <Stack align="center" gap="sm" maw={460} ta="center">
          <LogoMark size={56} />
          <Wordmark />
          <Text c="dimmed" size="sm">
            Questa è la sola interfaccia in modalità browser. Il gestionale completo
            funziona nella finestra desktop dell'app (il core Rust risponde solo lì).
          </Text>
        </Stack>
      </Center>
    );
  }

  if (stato.fase === "errore") {
    return (
      <Center style={{ flex: 1, padding: 24 }}>
        <Stack align="center" gap="sm" maw={460} ta="center">
          <LogoMark size={48} />
          <Text fw={600}>Avvio non riuscito</Text>
          <Text c="dimmed" size="sm">
            {stato.messaggio}
          </Text>
          <Button variant="default" onClick={() => location.reload()}>
            Riprova
          </Button>
        </Stack>
      </Center>
    );
  }

  if (stato.fase === "dataProblem") {
    async function resetConfigurazione() {
      const ok = window.confirm(
        "Vuoi davvero resettare la configurazione locale di questo PC? I dati condivisi non verranno cancellati, ma dovrai scegliere di nuovo cartella e profilo."
      );
      if (!ok) return;
      try {
        completaRicollegamento();
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("reset_leggero");
      } finally {
        location.reload();
      }
    }

    return (
      <Center style={{ flex: 1, padding: 24 }}>
        <Stack align="center" gap="sm" maw={520} ta="center">
          <LogoMark size={48} />
          <Text fw={700}>Cartella dati non disponibile</Text>
          <Text c="dimmed" size="sm">
            {stato.messaggio}
          </Text>
          <Group gap="sm">
            <Button variant="default" onClick={() => location.reload()}>
              Riprova
            </Button>
            <Button color="red" variant="light" onClick={() => void resetConfigurazione()}>
              Reset configurazione
            </Button>
          </Group>
        </Stack>
      </Center>
    );
  }

  if (stato.fase === "reconnect") {
    return (
      <Center style={{ flex: 1, padding: 24 }}>
        <Stack align="center" gap="sm" maw={520} ta="center">
          <LogoMark size={48} />
          <Text fw={700}>Sessione non più disponibile</Text>
          <Text c="dimmed" size="sm">
            Il profilo o il dispositivo collegato a questo PC non è più presente nei dati condivisi.
            Ricollega l’app scegliendo nuovamente la cartella dati e un profilo disponibile.
          </Text>
          <Button onClick={() => setStato({ fase: "onboarding", boot: stato.boot })}>
            Ricollega
          </Button>
        </Stack>
      </Center>
    );
  }

  if (stato.fase === "onboarding") {
    return (
      <Onboarding
        boot={stato.boot}
        onDone={(identity) => {
          // Niente toast di benvenuto: ci pensa già l'animazione `SchermoBenvenuto`.
          completaRicollegamento();
          localStorage.setItem("pt.lastIdentity", JSON.stringify(identity));
          localStorage.setItem("pt.onboardingTime", Date.now().toString());
          void preloadDashboardDopoOnboarding();
          setStato({ fase: "benvenuto", identity });
        }}
      />
    );
  }

  if (stato.fase === "benvenuto") {
    return (
      <SchermoBenvenuto
        identity={stato.identity}
        onFinished={() => {
          void preloadDashboardDopoOnboarding().finally(async () => {
            // Root è l'unico proprietario della configurazione del rilevatore Rust:
            // aggiorniamo il bootstrap soltanto al passaggio verso la home, senza
            // configurarlo una seconda volta da App o dalla finestra Notifiche.
            await api
              .bootstrap()
              .then((nextBoot) => onBootstrapChangeRef.current?.(nextBoot))
              .catch(() => {});
            setStato({ fase: "pronto", identity: stato.identity, justOnboarded: true });
          });
        }}
      />
    );
  }

  const appenaConfigurato = stato.fase === "pronto" && !!stato.justOnboarded;

  return (
    <FadePrimoIngressoDashboard attivo={appenaConfigurato}>
      <AvvioConNovita
        identity={stato.identity}
        skipChangelog={appenaConfigurato}
        forceDashboardIntro={appenaConfigurato}
        saltaIntroDashboard={avvioNascosto}
        onIdentityChange={(newIdentity) => setStato({ fase: "pronto", identity: newIdentity })}
      />
    </FadePrimoIngressoDashboard>
  );
}

/**
 * Prima di mostrare la Shell (e quindi l'intro animata della dashboard), verifica se
 * c'è il pannello «Novità» da mostrare per la versione corrente. Se sì lo mostra a
 * tutto schermo e monta la Shell solo alla chiusura; altrimenti entra subito. La
 * versione corrente viene segnata come "vista" in ogni caso, così non riappare.
 */
function AvvioConNovita({
  identity,
  onIdentityChange,
  skipChangelog = false,
  forceDashboardIntro = false,
  saltaIntroDashboard = false,
}: {
  identity: Identity;
  onIdentityChange: (identity: Identity) => void;
  skipChangelog?: boolean;
  forceDashboardIntro?: boolean;
  saltaIntroDashboard?: boolean;
}) {
  // Fuori da Tauri o alla prima configurazione non c'è da controllare nulla: entra direttamente.
  const [fase, setFase] = useState<"controllo" | "novita" | "pronto">(
    skipChangelog || !inTauri ? "pronto" : "controllo"
  );
  const [novita, setNovita] = useState<VersioneChangelog[] | null>(null);
  useEffect(() => {
    if (!inTauri) return;
    let attivo = true;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((versione) => {
        if (!attivo) return;
        if (skipChangelog) {
          segnaVista(versione);
          return;
        }
        const entries = novitaDaMostrare(versione);
        if (entries) {
          setNovita(entries);
          setFase("novita");
        } else {
          segnaVista(versione); // allinea il "visto" anche quando non c'è nulla da mostrare
          setFase("pronto");
        }
      })
      .catch(() => attivo && setFase("pronto"));
    return () => {
      attivo = false;
    };
  }, [skipChangelog]);

  // Microsalto del controllo versione: mostra la schermata di caricamento unificata
  if (fase === "controllo") {
    return <UnifiedBootScreen identity={identity} testoSottotitolo="Preparo la tua dashboard…" />;
  }

  if (fase === "novita" && novita) {
    return (
      <NovitaPanel
        entries={novita}
        onChiudi={() => {
          segnaVista(novita[0].versione);
          setFase("pronto");
        }}
      />
    );
  }

  return (
    <Shell
      identity={identity}
      onIdentityChange={onIdentityChange}
      forceDashboardIntro={forceDashboardIntro}
      testoDashboardLoader={forceDashboardIntro ? null : undefined}
      saltaIntroDashboard={saltaIntroDashboard}
    />
  );
}

export default App;
