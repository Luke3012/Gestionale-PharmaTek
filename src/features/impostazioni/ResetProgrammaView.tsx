import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Portal,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { useFocusTrap } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconDatabaseCog,
  IconDeviceDesktop,
  IconRefresh,
  IconShieldLock,
  IconTrashX,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  api,
  type Dispositivo,
  type Identity,
  type OttimizzazioneDatabaseResult,
  type RestoreCoordination,
} from "../../lib/tauri";
import { attivaRipristinoBloccante, disattivaRipristinoBloccante } from "../../lib/riallineamentoDati";
import { Avatar, svuotaCacheAvatar } from "../../ui/Avatar";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import { RITIRO_AUTO_RELOAD_MS, secondiRimanentiRitiro } from "./ritiroCountdown";
import { preparaDedupClientiAuto } from "../anagrafiche/dedupClientiAuto";

type PassoReset =
  | "scelta"
  | "leggero"
  | "ritiro"
  | "ritiro_conferma"
  | "ritiro_effettuato"
  | "ottimizza"
  | "ottimizza_attesa"
  | "ottimizza_effettuata"
  | "completo_1"
  | "completo_2"
  | "lavoro";

type LavoroReset = "leggero" | "ritiro" | "ottimizza" | "completo" | null;
type RitiroCompletato = { corrente: boolean; nome: string; backupPath: string };

const EASE = [0.22, 1, 0.36, 1] as const;
const SECONDI_RITIRO = RITIRO_AUTO_RELOAD_MS / 1_000;

const SFONDI_RESET = {
  blue: "radial-gradient(circle at 12% 10%, rgba(34,139,230,.22), transparent 32%), radial-gradient(circle at 88% 86%, rgba(77,171,247,.14), transparent 36%)",
  orange: "radial-gradient(circle at 12% 10%, rgba(253,126,20,.22), transparent 32%), radial-gradient(circle at 88% 86%, rgba(255,146,43,.15), transparent 36%)",
  yellow: "radial-gradient(circle at 12% 10%, rgba(250,176,5,.23), transparent 32%), radial-gradient(circle at 88% 86%, rgba(252,196,25,.16), transparent 36%)",
  red: "radial-gradient(circle at 12% 10%, rgba(250,82,82,.22), transparent 32%), radial-gradient(circle at 88% 86%, rgba(224,49,49,.15), transparent 36%)",
} as const;

function dimensione(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dataOra(ms: number): string {
  if (!ms) return "mai visto";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function èIdTecnico(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value.trim());
}

function nomePc(d: Dispositivo, identity: Identity): string {
  const nome = (d.nome || "").trim();
  if (nome && nome !== d.deviceId && !èIdTecnico(nome)) return nome;
  if (d.isCurrent) return identity.deviceNome || "Questo PC";
  if (d.lastMs) return `PC visto il ${dataOra(d.lastMs)}`;
  return "PC senza nome";
}

async function preparaUscitaLocale() {
  try {
    const { disable } = await import("@tauri-apps/plugin-autostart");
    await disable();
  } catch {}
  try {
    await api.traySet(false);
  } catch {}
}

async function chiudiFinestreSecondarie() {
  try {
    const { getAllWindows, getCurrentWindow } = await import("@tauri-apps/api/window");
    const tutte = await getAllWindows().catch(() => []);
    const corrente = getCurrentWindow();
    for (const win of tutte) {
      if (win.label !== corrente.label) await win.close().catch(() => {});
    }
  } catch {}
}

async function tornaAllOnboarding() {
  svuotaCacheAvatar();
  localStorage.clear();
  await chiudiFinestreSecondarie();
  location.reload();
}

export function ResetProgrammaView({
  aperto,
  identity,
  ridurreAnimazioni,
  passoIniziale = "scelta",
  onClose,
}: {
  aperto: boolean;
  identity: Identity;
  ridurreAnimazioni: boolean;
  passoIniziale?: "scelta" | "ottimizza";
  onClose: () => void;
}) {
  const [passo, setPasso] = useState<PassoReset>("scelta");
  const [direzione, setDirezione] = useState(1);
  const [devices, setDevices] = useState<Dispositivo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [caricandoDevices, setCaricandoDevices] = useState(false);
  const [lavoro, setLavoro] = useState<LavoroReset>(null);
  const [ritiroCompletato, setRitiroCompletato] = useState<RitiroCompletato | null>(null);
  const [secondiRitiro, setSecondiRitiro] = useState(SECONDI_RITIRO);
  const [riavvioRitiroInCorso, setRiavvioRitiroInCorso] = useState(false);
  const [coordinamento, setCoordinamento] = useState<RestoreCoordination | null>(null);
  const [preparandoOttimizzazione, setPreparandoOttimizzazione] = useState(false);
  const [ottimizzazione, setOttimizzazione] = useState<OttimizzazioneDatabaseResult | null>(null);
  const bloccoRitiroAttivoRef = useRef(false);
  const riavvioRitiroInCorsoRef = useRef(false);
  const coordinamentoRef = useRef<RestoreCoordination | null>(null);
  const focusTrapRef = useFocusTrap(aperto);

  const occupato =
    passo === "lavoro"
    || passo === "ritiro_effettuato"
    || caricandoDevices
    || preparandoOttimizzazione;
  const device = useMemo(() => devices.find((item) => item.deviceId === deviceId) ?? null, [devices, deviceId]);
  const coloreSfondo = useMemo<keyof typeof SFONDI_RESET>(() => {
    if (passo === "leggero" || (passo === "lavoro" && lavoro === "leggero")) return "blue";
    if (passo.startsWith("ritiro") || (passo === "lavoro" && lavoro === "ritiro")) return "orange";
    if (passo.startsWith("ottimizza") || (passo === "lavoro" && lavoro === "ottimizza")) return "yellow";
    return "red";
  }, [lavoro, passo]);

  useEffect(() => {
    if (!aperto) return;
    setPasso(passoIniziale);
    setDirezione(1);
    setDevices([]);
    setDeviceId("");
    setCaricandoDevices(false);
    setLavoro(null);
    setRitiroCompletato(null);
    setSecondiRitiro(SECONDI_RITIRO);
    setRiavvioRitiroInCorso(false);
    setCoordinamento(null);
    coordinamentoRef.current = null;
    setPreparandoOttimizzazione(false);
    setOttimizzazione(null);
    riavvioRitiroInCorsoRef.current = false;
  }, [aperto, passoIniziale]);

  useEffect(() => {
    coordinamentoRef.current = coordinamento;
  }, [coordinamento]);

  useEffect(() => {
    if (aperto) return;
    const corrente = coordinamentoRef.current;
    if (!corrente) return;
    coordinamentoRef.current = null;
    setCoordinamento(null);
    void api.restoreCancel(corrente.restoreId).catch(() => {});
  }, [aperto]);

  useEffect(() => () => {
    const corrente = coordinamentoRef.current;
    if (corrente) void api.restoreCancel(corrente.restoreId).catch(() => {});
  }, []);

  useEffect(() => {
    if (aperto || !bloccoRitiroAttivoRef.current) return;
    disattivaRipristinoBloccante();
    bloccoRitiroAttivoRef.current = false;
  }, [aperto]);

  useEffect(() => () => {
    if (!bloccoRitiroAttivoRef.current) return;
    disattivaRipristinoBloccante();
    bloccoRitiroAttivoRef.current = false;
  }, []);

  useEffect(() => {
    if (!aperto) return;
    const root = document.documentElement;
    const precedente = root.dataset.ptBlockingView;
    root.dataset.ptBlockingView = "reset";
    return () => {
      if (precedente === undefined) delete root.dataset.ptBlockingView;
      else root.dataset.ptBlockingView = precedente;
    };
  }, [aperto]);

  useEffect(() => {
    if (!aperto) return;
    const precedente = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = precedente;
    };
  }, [aperto]);

  const vai = (next: PassoReset, verso = 1) => {
    setDirezione(verso);
    setPasso(next);
  };

  const indietro = () => {
    if (occupato) return;
    if (passo === "scelta") onClose();
    else if (passo === "ritiro_conferma") vai("ritiro", -1);
    else if (passo === "ottimizza_attesa") {
      const corrente = coordinamentoRef.current;
      setCoordinamento(null);
      coordinamentoRef.current = null;
      if (corrente) void api.restoreCancel(corrente.restoreId).catch(() => {});
      vai("ottimizza", -1);
    }
    else if (passo === "completo_2") vai("completo_1", -1);
    else vai("scelta", -1);
  };

  useEffect(() => {
    if (!aperto) return;
    const onKey = (event: KeyboardEvent) => {
      // Shell usa un Escape sintetico per chiudere menu e popover durante lo
      // scroll. Una view bloccante deve reagire soltanto al tasto Esc reale.
      if (event.key !== "Escape" || !event.isTrusted || occupato) return;
      event.preventDefault();
      event.stopPropagation();
      setDirezione(-1);
      if (passo === "scelta") onClose();
      else if (passo === "ritiro_conferma") setPasso("ritiro");
      else if (passo === "ottimizza_attesa") {
        const corrente = coordinamentoRef.current;
        setCoordinamento(null);
        coordinamentoRef.current = null;
        if (corrente) void api.restoreCancel(corrente.restoreId).catch(() => {});
        setPasso("ottimizza");
      }
      else if (passo === "completo_2") setPasso("completo_1");
      else setPasso("scelta");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [aperto, occupato, onClose, passo]);

  useEffect(() => {
    if (!aperto || passo !== "ottimizza_attesa" || !coordinamento) return;
    let annullato = false;
    let timer = 0;
    const aggiorna = async () => {
      try {
        const stato = await api.restoreCoordinationStatus(coordinamento.restoreId);
        if (!annullato) setCoordinamento(stato);
      } catch {
        // OneDrive può consegnare gli ack in ritardo: il giro successivo riprova.
      } finally {
        if (!annullato) timer = window.setTimeout(aggiorna, 1_200);
      }
    };
    timer = window.setTimeout(aggiorna, 400);
    const rinnovo = window.setInterval(
      () => void api.rinnovaLock("preparazione_ripristino").catch(() => {}),
      120_000,
    );
    return () => {
      annullato = true;
      window.clearTimeout(timer);
      window.clearInterval(rinnovo);
    };
  }, [aperto, coordinamento?.restoreId, passo]);

  const apriRitiro = async () => {
    vai("ritiro");
    setCaricandoDevices(true);
    try {
      await api.forceSync().catch(() => 0);
      const overview = await api.syncOverviewRitiro();
      if (overview.devices.length === 0) {
        toast.info("Nessun PC da ritirare.");
        vai("scelta", -1);
        return;
      }
      setDevices(overview.devices);
      setDeviceId(overview.devices.find((item) => item.isCurrent)?.deviceId ?? overview.devices[0].deviceId);
    } catch (e) {
      toast.error(`Lista PC non disponibile: ${e}`);
      vai("scelta", -1);
    } finally {
      setCaricandoDevices(false);
    }
  };

  const eseguiLeggero = async () => {
    setLavoro("leggero");
    vai("lavoro");
    try {
      await preparaUscitaLocale();
      await api.resetLeggero();
      await tornaAllOnboarding();
    } catch (e) {
      toast.error(`Reset non riuscito: ${e}`);
      setLavoro(null);
      vai("leggero", -1);
    }
  };

  const eseguiRitiro = async () => {
    if (!device) return;
    // Il ritiro emette `pt:data-wiped`: finché questa view non ha mostrato l'esito,
    // App non deve reagire smontandola e passando direttamente all'onboarding.
    attivaRipristinoBloccante();
    bloccoRitiroAttivoRef.current = true;
    setLavoro("ritiro");
    vai("lavoro");
    try {
      await chiudiFinestreSecondarie();
      const corrente = device.isCurrent;
      const res = await api.ritiraDispositivo(device.deviceId);
      setRitiroCompletato({
        corrente,
        nome: nomePc(device, identity),
        backupPath: res.backupPath,
      });
      setSecondiRitiro(SECONDI_RITIRO);
      setLavoro(null);
      vai("ritiro_effettuato");
    } catch (e) {
      disattivaRipristinoBloccante();
      bloccoRitiroAttivoRef.current = false;
      toast.error(`Ritiro non riuscito: ${e}`);
      setLavoro(null);
      vai("ritiro_conferma", -1);
    }
  };

  const riavviaDopoRitiro = useCallback(async () => {
    if (!ritiroCompletato || riavvioRitiroInCorsoRef.current) return;
    riavvioRitiroInCorsoRef.current = true;
    setRiavvioRitiroInCorso(true);
    setSecondiRitiro(0);
    if (ritiroCompletato.corrente) {
      await preparaUscitaLocale();
      await tornaAllOnboarding();
      return;
    }
    svuotaCacheAvatar();
    await chiudiFinestreSecondarie();
    location.reload();
  }, [ritiroCompletato]);

  useEffect(() => {
    if (!aperto || passo !== "ritiro_effettuato" || !ritiroCompletato) return;
    const deadline = Date.now() + RITIRO_AUTO_RELOAD_MS;
    setSecondiRitiro(SECONDI_RITIRO);

    const aggiorna = () => setSecondiRitiro(secondiRimanentiRitiro(deadline));
    const intervallo = window.setInterval(aggiorna, 200);
    const automatico = window.setTimeout(() => void riavviaDopoRitiro(), RITIRO_AUTO_RELOAD_MS);
    return () => {
      window.clearInterval(intervallo);
      window.clearTimeout(automatico);
    };
  }, [aperto, passo, riavviaDopoRitiro, ritiroCompletato]);

  const eseguiCompleto = async () => {
    setLavoro("completo");
    vai("lavoro");
    try {
      await preparaUscitaLocale();
      svuotaCacheAvatar();
      localStorage.clear();
      await api.resetCompleto();
      await chiudiFinestreSecondarie();
      try {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch {
        location.reload();
      }
    } catch (e) {
      toast.error(`Reset non riuscito: ${e}`);
      setLavoro(null);
      vai("completo_2", -1);
    }
  };

  const preparaOttimizzazione = async () => {
    setPreparandoOttimizzazione(true);
    try {
      const stato = await api.restorePrepare();
      setCoordinamento(stato);
      coordinamentoRef.current = stato;
      vai("ottimizza_attesa");
    } catch (e) {
      toast.error(`Preparazione non riuscita: ${e}`);
    } finally {
      setPreparandoOttimizzazione(false);
    }
  };

  const eseguiOttimizzazione = async (forza = false) => {
    const corrente = coordinamentoRef.current;
    if (!corrente) return;
    const mancanti = corrente.expected.filter(
      (device) => !corrente.acks.some((ack) => ack.deviceId === device.deviceId),
    );
    if (!forza && mancanti.length > 0) return;
    if (forza && mancanti.length > 0) {
      const nomi = mancanti.map((device) => nomePc(device, identity)).join(", ");
      const confermato = await dialog.confirmDanger(
        "Forzare l’ottimizzazione?",
        `${mancanti.length} ${mancanti.length === 1 ? "postazione non ha" : "postazioni non hanno"} confermato: ${nomi}.\n\n`
          + "Il checkpoint verrà pubblicato comunque. Questi PC si riallineeranno automaticamente quando torneranno online, ma eventuali modifiche non ancora sincronizzate potrebbero andare perse.",
        { conferma: "Forza ottimizzazione" },
      );
      if (!confermato) return;
    }
    setLavoro("ottimizza");
    vai("lavoro");
    try {
      const dedup = await preparaDedupClientiAuto();
      const risultato = await api.ottimizzaDatabase(corrente.restoreId, dedup.merges, forza);
      setCoordinamento(null);
      coordinamentoRef.current = null;
      setOttimizzazione(risultato);
      setLavoro(null);
      vai("ottimizza_effettuata");
    } catch (e) {
      await api.restoreCancel(corrente.restoreId).catch(() => {});
      setCoordinamento(null);
      coordinamentoRef.current = null;
      setLavoro(null);
      toast.error(`Ottimizzazione non riuscita: ${e}`);
      vai("ottimizza", -1);
    }
  };

  const footer = (() => {
    if (passo === "lavoro") return null;
    if (passo === "ritiro_effettuato") {
      return (
        <Button
          color="orange"
          leftSection={<IconRefresh size={17} />}
          loading={riavvioRitiroInCorso}
          onClick={() => void riavviaDopoRitiro()}
        >
          Fatto, riavvia ora
        </Button>
      );
    }
    if (passo === "ottimizza_effettuata") {
      return (
        <Button
          color="yellow"
          leftSection={<IconRefresh size={17} />}
          onClick={() => location.reload()}
        >
          Fatto, ricarica
        </Button>
      );
    }
    if (passo === "scelta") {
      return (
        <Button variant="subtle" color="gray" leftSection={<IconX size={16} />} onClick={onClose}>
          Torna alle impostazioni
        </Button>
      );
    }

    const indietroFooter = (
      <Button variant="default" leftSection={<IconArrowLeft size={16} />} disabled={occupato} onClick={indietro}>
        Indietro
      </Button>
    );

    if (passo === "leggero") {
      return <>{indietroFooter}<Button color="blue" onClick={() => void eseguiLeggero()}>Riconfigura questo PC</Button></>;
    }
    if (passo === "ritiro") {
      return <>{indietroFooter}<Button color="orange" disabled={!device || caricandoDevices} onClick={() => vai("ritiro_conferma")}>Continua</Button></>;
    }
    if (passo === "ritiro_conferma") {
      return <>{indietroFooter}<Button color="orange" onClick={() => void eseguiRitiro()}>Ritira PC</Button></>;
    }
    if (passo === "ottimizza") {
      return <>{indietroFooter}<Button color="yellow" loading={preparandoOttimizzazione} onClick={() => void preparaOttimizzazione()}>Prepara i PC</Button></>;
    }
    if (passo === "ottimizza_attesa") {
      const pronto = Boolean(
        coordinamento
        && coordinamento.expectedCount > 0
        && coordinamento.acknowledged === coordinamento.expectedCount,
      );
      const forzabile = Boolean(
        coordinamento
        && coordinamento.expectedCount > 0
        && coordinamento.acknowledged < coordinamento.expectedCount,
      );
      return (
        <>
          {indietroFooter}
          <Group gap="sm">
            {forzabile && (
              <Button color="orange" variant="light" onClick={() => void eseguiOttimizzazione(true)}>
                Forza comunque
              </Button>
            )}
            <Button color="yellow" disabled={!pronto} onClick={() => void eseguiOttimizzazione()}>
              Ottimizza ora
            </Button>
          </Group>
        </>
      );
    }
    if (passo === "completo_1") {
      return <>{indietroFooter}<Button color="red" onClick={() => vai("completo_2")}>Ho capito, continua</Button></>;
    }
    return (
      <>
        {indietroFooter}
        <Button color="red" leftSection={<IconTrashX size={17} />} onClick={() => void eseguiCompleto()}>
          Elimina tutto definitivamente
        </Button>
      </>
    );
  })();

  return (
    <Portal>
      <AnimatePresence>
        {aperto && (
          <motion.div
            ref={focusTrapRef}
            data-pt-blocking-view="reset"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pt-reset-view-title"
            initial={ridurreAnimazioni ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: ridurreAnimazioni ? 0 : 0.2 }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 5000,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              overscrollBehavior: "contain",
              background: "var(--mantine-color-body)",
            }}
          >
              {(Object.keys(SFONDI_RESET) as Array<keyof typeof SFONDI_RESET>).map((colore) => {
                const attivo = colore === coloreSfondo;
                return (
                  <motion.div
                    key={colore}
                    aria-hidden
                    initial={false}
                    animate={{ opacity: attivo ? 0.88 : 0 }}
                    transition={ridurreAnimazioni ? { duration: 0 } : { duration: 0.65, ease: EASE }}
                    style={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: "none",
                      background: SFONDI_RESET[colore],
                      willChange: "opacity",
                    }}
                  />
                );
              })}
              <motion.div
                aria-hidden
                initial={false}
                animate={ridurreAnimazioni ? { opacity: 0 } : { opacity: [0, 0.13, 0] }}
                transition={ridurreAnimazioni ? { duration: 0 } : { duration: 5.2, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  background: "radial-gradient(circle at 50% 42%, rgba(255,255,255,.9), transparent 48%)",
                  willChange: "opacity",
                }}
              />
              <Box
                component="header"
                px={{ base: "md", sm: "xl" }}
                py="md"
                style={{ position: "relative", zIndex: 1, borderBottom: "1px solid var(--mantine-color-default-border)", background: "color-mix(in srgb, var(--mantine-color-body) 88%, transparent)" }}
              >
                <Group justify="space-between" wrap="nowrap" maw={1040} mx="auto">
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon size={42} radius="xl" color={coloreSfondo} variant="light">
                      <IconShieldLock size={23} />
                    </ThemeIcon>
                    <Box>
                      <Text id="pt-reset-view-title" fw={800} fz="lg">Centro di ripristino</Text>
                      <Text size="xs" c="dimmed">Area protetta</Text>
                    </Box>
                  </Group>
                  <Group gap="xs" wrap="nowrap">
                    <Badge variant="light" color={coloreSfondo} visibleFrom="xs">
                      {passo === "scelta" ? "Scelta" : passo === "lavoro" ? "Operazione in corso" : passo.endsWith("_effettuata") || passo === "ritiro_effettuato" ? "Completato" : passo.endsWith("_attesa") ? "Coordinamento" : "Conferma"}
                    </Badge>
                  </Group>
                </Group>
              </Box>

              <Box component="main" style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, overflow: "auto" }} px={{ base: "md", sm: "xl" }} py={{ base: "lg", sm: 42 }}>
                <Box maw={1040} mx="auto">
                  <AnimatePresence mode="wait" initial={false} custom={direzione}>
                    <motion.div
                      key={passo}
                      custom={direzione}
                      initial={ridurreAnimazioni ? false : { opacity: 0, x: 24 * direzione, filter: "blur(3px)" }}
                      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                      exit={ridurreAnimazioni ? { opacity: 1 } : { opacity: 0, x: -18 * direzione, filter: "blur(2px)" }}
                      transition={{ duration: ridurreAnimazioni ? 0 : 0.22, ease: EASE }}
                    >
                      {passo === "scelta" && (
                        <Stack gap="md" maw={780} mx="auto">
                          <Box ta="center" maw={700} mx="auto">
                            <Text fz={{ base: 26, sm: 32 }} fw={850}>Scegli un’operazione</Text>
                          </Box>
                          <Stack gap="sm">
                            <SceltaCard ridotte={ridurreAnimazioni} colore="blue" Icona={IconRefresh} titolo="Riconfigura questo PC" testo="Torna alla schermata iniziale conservando tutti i dati condivisi del team." onClick={() => vai("leggero")} />
                            <SceltaCard ridotte={ridurreAnimazioni} colore="orange" Icona={IconDeviceDesktop} titolo="Ritira un PC" testo="Scollega in sicurezza una postazione e crea automaticamente un backup prima del ritiro." onClick={() => void apriRitiro()} />
                            <SceltaCard ridotte={ridurreAnimazioni} colore="yellow" Icona={IconDatabaseCog} titolo="Ottimizza database" testo="Unisce i clienti duplicati sicuri e rende il database più leggero." onClick={() => vai("ottimizza")} />
                            <SceltaCard ridotte={ridurreAnimazioni} colore="red" Icona={IconTrashX} titolo="Reset completo" testo="Elimina i dati operativi del gestionale per ogni PC e riparte da zero." onClick={() => vai("completo_1")} />
                          </Stack>
                        </Stack>
                      )}

                      {passo === "leggero" && (
                        <ConfermaView
                          colore="blue"
                          Icona={IconRefresh}
                          titolo="Riconfigurare questo PC?"
                          testo="PharmaTek tornerà alla configurazione iniziale su questa postazione. Ordini, anagrafiche e dati condivisi del team restano intatti."
                          punti={["Disattiva l'avvio automatico locale", "Scollega soltanto questo PC", "Riporta alla schermata iniziale"]}
                        />
                      )}

                      {passo === "ritiro" && (
                        <Stack gap="lg">
                          <TitoloPasso Icona={IconDeviceDesktop} colore="orange" titolo="Scegli il PC da ritirare" testo="Prima del ritiro viene creato un backup. Il PC selezionato non potrà più scrivere con la sessione corrente." />
                          {caricandoDevices ? (
                            <StatoLavoro titolo="Aggiorno l'elenco delle postazioni…" testo="Sincronizzo lo stato più recente prima di mostrarti i PC disponibili." />
                          ) : (
                            <>
                              <ScrollArea.Autosize mah="min(48vh, 460px)" type="auto">
                                <Stack gap="sm" pr={6}>
                                  {devices.map((item) => {
                                    const selezionato = item.deviceId === deviceId;
                                    const nomeAvatar = item.userNome || nomePc(item, identity);
                                    return (
                                      <motion.div key={item.deviceId} layout={!ridurreAnimazioni}>
                                        <UnstyledButton w="100%" onClick={() => setDeviceId(item.deviceId)}>
                                          <Paper withBorder radius="lg" p="md" style={{ borderColor: selezionato ? "var(--mantine-color-orange-5)" : undefined, background: selezionato ? "var(--mantine-color-orange-light)" : "var(--mantine-color-body)", transition: "border-color 120ms, background-color 120ms" }}>
                                            <Group justify="space-between" wrap="nowrap" gap="md">
                                              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                                                <Avatar nome={nomeAvatar} tipo={item.avatarTipo || "iniziali"} valore={item.avatarValore} userId={item.avatarTipo === "custom" ? item.userId : undefined} size={42} />
                                                <Box style={{ minWidth: 0 }}>
                                                  <Group gap={7} wrap="wrap">
                                                    <Text fw={750}>{nomePc(item, identity)}</Text>
                                                    {item.isCurrent && <Badge size="xs" color="blue" variant="light">questo PC</Badge>}
                                                  </Group>
                                                  <Text size="xs" c="dimmed">{item.userNome || "Nessun utente"} · {dataOra(item.lastMs)}</Text>
                                                </Box>
                                              </Group>
                                              <ThemeIcon radius="xl" color={selezionato ? "orange" : "gray"} variant={selezionato ? "filled" : "light"}>
                                                {selezionato ? <IconCheck size={16} /> : <IconDeviceDesktop size={16} />}
                                              </ThemeIcon>
                                            </Group>
                                          </Paper>
                                        </UnstyledButton>
                                      </motion.div>
                                    );
                                  })}
                                </Stack>
                              </ScrollArea.Autosize>
                            </>
                          )}
                        </Stack>
                      )}

                      {passo === "ritiro_conferma" && device && (
                        <ConfermaView
                          colore="orange"
                          Icona={IconDeviceDesktop}
                          titolo={`Ritirare ${nomePc(device, identity)}?`}
                          testo={device.isCurrent ? "Questo PC verrà scollegato e PharmaTek tornerà alla configurazione iniziale." : "Il PC verrà scollegato. Se è acceso, tornerà alla configurazione iniziale alla prossima sincronizzazione."}
                          punti={["Crea un backup prima del ritiro", "Revoca la sessione della postazione", device.isCurrent ? "Riconfigura questo PC" : "Non modifica gli altri PC"]}
                        />
                      )}

                      {passo === "ritiro_effettuato" && ritiroCompletato && (
                        <Stack gap="lg">
                          <ConfermaView
                            colore="orange"
                            Icona={IconCheck}
                            titolo="Ritiro effettuato"
                            testo={`${ritiroCompletato.nome} è stato ritirato correttamente. Il backup di sicurezza è stato creato prima della revoca.`}
                            punti={[
                              "Registro del PC chiuso in sicurezza",
                              `Backup salvato: ${ritiroCompletato.backupPath}`,
                              ritiroCompletato.corrente ? "Questo PC ripartirà dalla configurazione iniziale" : "L’interfaccia verrà ricaricata con lo stato aggiornato",
                            ]}
                          />
                          <Paper withBorder radius="lg" p="md" maw={820} mx="auto" w="100%" style={{ background: "var(--mantine-color-orange-light)" }}>
                            <Group justify="space-between" wrap="nowrap" gap="md">
                              <Box>
                                <Text fw={750}>Riavvio automatico dell’interfaccia</Text>
                                <Text size="sm" c="dimmed">Puoi premere “Fatto” oppure attendere il termine del conto alla rovescia.</Text>
                              </Box>
                              <Badge color="orange" variant="filled" size="xl" miw={58} aria-live="polite">
                                {secondiRitiro}s
                              </Badge>
                            </Group>
                          </Paper>
                        </Stack>
                      )}

                      {passo === "ottimizza" && (
                        <ConfermaView
                          colore="yellow"
                          Icona={IconDatabaseCog}
                          titolo="Ottimizzare il database?"
                          testo="PharmaTek unisce i clienti riconosciuti con certezza, crea un backup di sicurezza e rimuove i file tecnici non più necessari."
                          punti={[
                            "I riferimenti dei duplicati vengono spostati sul cliente canonico",
                            "I campi mancanti vengono completati senza sovrascrivere quelli presenti",
                            "Vengono rimossi soltanto vecchi dati tecnici",
                            "Le altre postazioni restano sincronizzate",
                            "Può liberare spazio occupato inutilmente",
                          ]}
                        />
                      )}

                      {passo === "ottimizza_attesa" && coordinamento && (
                        <Stack gap="lg" maw={820} mx="auto">
                          <TitoloPasso
                             Icona={IconDatabaseCog}
                             colore="yellow"
                             titolo="Preparo le postazioni"
                             testo="Aspetto che le altre postazioni siano pronte. Se una è spenta, puoi forzare: si riallineerà automaticamente quando tornerà online."
                          />
                          <Paper withBorder radius="xl" p={{ base: "md", sm: "lg" }}>
                            <Group justify="space-between" mb="md">
                              <Box>
                                <Text fw={800}>Postazioni pronte</Text>
                                <Text size="xs" c="dimmed">Il controllo si aggiorna automaticamente.</Text>
                              </Box>
                              <Badge
                                color={coordinamento.acknowledged === coordinamento.expectedCount ? "green" : "yellow"}
                                variant="light"
                                size="lg"
                              >
                                {coordinamento.acknowledged}/{coordinamento.expectedCount}
                              </Badge>
                            </Group>
                            <Stack gap="xs">
                              {coordinamento.expected.map((item) => {
                                const ack = coordinamento.acks.find((value) => value.deviceId === item.deviceId);
                                return (
                                  <Group key={item.deviceId} justify="space-between" wrap="nowrap" gap="md">
                                    <Box style={{ minWidth: 0 }}>
                                      <Text size="sm" fw={700} truncate>{nomePc(item, identity)}</Text>
                                      <Text size="xs" c="dimmed" truncate>{item.userNome || "Nessun utente"}</Text>
                                    </Box>
                                    <Badge color={ack ? "green" : "gray"} variant="light">
                                      {ack ? "pronto" : "in attesa"}
                                    </Badge>
                                  </Group>
                                );
                              })}
                            </Stack>
                          </Paper>
                        </Stack>
                      )}

                      {passo === "ottimizza_effettuata" && ottimizzazione && (
                        <Stack gap="lg" maw={820} mx="auto">
                          <ConfermaView
                            colore="yellow"
                             Icona={IconCheck}
                             titolo="Database ottimizzato"
                             testo="Pulizia completata. I tuoi dati sono al sicuro e, se serve, puoi sempre tornare al backup appena creato."
                             punti={[
                               `${ottimizzazione.recordConservati} elementi conservati`,
                               `${ottimizzazione.dedupClienti.clientiPurgati} clienti duplicati uniti in ${ottimizzazione.dedupClienti.gruppi} gruppi`,
                               ...(ottimizzazione.postazioniSenzaAck > 0
                                 ? [`${ottimizzazione.postazioniSenzaAck} postazioni verranno riallineate al prossimo collegamento`]
                                 : []),
                               `${ottimizzazione.eventiRimossi + ottimizzazione.tombstoneRimosse} vecchi elementi tecnici rimossi`,
                               `${ottimizzazione.fileLogRimossi + ottimizzazione.snapshotRimossi} file tecnici rimossi · ${dimensione(ottimizzazione.byteLiberati)} liberati`,
                               `Backup: ${ottimizzazione.backupPath}`,
                             ]}
                          />
                        </Stack>
                      )}

                      {passo === "completo_1" && (
                        <ConfermaView
                          colore="red"
                          Icona={IconAlertTriangle}
                          titolo="Reset completo del programma"
                          testo="Questo percorso cancella i dati operativi del gestionale per tutti i PC. Conserva i backup esistenti e pochi file tecnici che impediscono ai vecchi PC offline di ripristinare i dati eliminati."
                          punti={["Elimina ordini e anagrafiche", "Azzera le postazioni condivise", "Conserva i backup di sicurezza"]}
                        />
                      )}

                      {passo === "completo_2" && (
                        <ConfermaView
                          colore="red"
                          Icona={IconTrashX}
                          titolo="Ultima conferma"
                          testo="Dopo questa conferma PharmaTek eliminerà tutti i dati operativi e ripartirà da zero. Le cartelle tecniche possono restare visibili perché contengono la barriera di sicurezza; i backup non vengono cancellati."
                          punti={["Dati operativi di tutti i PC", "Tutte le sessioni e configurazioni", "Riavvio automatico al termine"]}
                          enfasi
                        />
                      )}

                      {passo === "lavoro" && (
                        <StatoLavoro
                          colore={lavoro === "ottimizza" ? "yellow" : undefined}
                          titolo={lavoro === "ritiro" ? "Ritiro della postazione…" : lavoro === "ottimizza" ? "Ottimizzazione del database…" : lavoro === "completo" ? "Reset completo in corso…" : "Riconfigurazione in corso…"}
                          testo={lavoro === "ritiro" ? "Creo il backup e scollego il PC selezionato. Non chiudere PharmaTek." : lavoro === "ottimizza" ? "Creo il backup e faccio pulizia. Ci vorrà solo un momento: non chiudere PharmaTek." : lavoro === "completo" ? "Sto eliminando i dati e preparando il riavvio. Non interrompere l'operazione." : "Preparo questo PC per tornare alla schermata iniziale."}
                        />
                      )}
                    </motion.div>
                  </AnimatePresence>
                </Box>
              </Box>
              {footer && (
                <Box
                  component="footer"
                  px={{ base: "md", sm: "xl" }}
                  py="md"
                  style={{
                    position: "relative",
                    zIndex: 2,
                    flex: "0 0 auto",
                    background: "transparent",
                  }}
                >
                  <Group justify={passo === "scelta" ? "center" : "space-between"} gap="md" maw={1040} mx="auto">
                    {footer}
                  </Group>
                </Box>
              )}
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  );
}

function SceltaCard({ ridotte, colore, Icona, titolo, testo, onClick }: { ridotte: boolean; colore: string; Icona: typeof IconRefresh; titolo: string; testo: string; onClick: () => void }) {
  return (
    <motion.div whileHover={ridotte ? undefined : { x: 4 }} whileTap={ridotte ? undefined : { scale: 0.992 }} transition={{ duration: 0.14 }}>
      <UnstyledButton w="100%" onClick={onClick}>
        <Paper withBorder radius="lg" px="md" py="sm" style={{ background: `linear-gradient(100deg, var(--mantine-color-${colore}-light), var(--mantine-color-body) 65%)`, boxShadow: "0 7px 22px rgba(0,0,0,.045)" }}>
          <Group gap="md" wrap="nowrap">
            <ThemeIcon size={40} radius="lg" color={colore} variant="light" style={{ flex: "0 0 auto" }}><Icona size={21} /></ThemeIcon>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text fw={800} fz="sm">{titolo}</Text>
              <Text size="xs" c="dimmed" mt={1} lh={1.35}>{testo}</Text>
            </Box>
            <Group gap={5} c={colore} wrap="nowrap" style={{ flex: "0 0 auto" }}>
              <Text size="xs" fw={700} visibleFrom="xs">Continua</Text>
              <Text aria-hidden fw={800}>→</Text>
            </Group>
          </Group>
        </Paper>
      </UnstyledButton>
    </motion.div>
  );
}

function TitoloPasso({ Icona, colore, titolo, testo }: { Icona: typeof IconRefresh; colore: string; titolo: string; testo: string }) {
  return (
    <Group gap="md" wrap="nowrap" align="flex-start">
      <ThemeIcon size={52} radius="xl" color={colore} variant="light" style={{ flex: "0 0 auto" }}><Icona size={27} /></ThemeIcon>
      <Box>
        <Text fw={850} fz={{ base: 25, sm: 32 }}>{titolo}</Text>
        <Text c="dimmed" mt={5} maw={720} lh={1.5}>{testo}</Text>
      </Box>
    </Group>
  );
}

function ConfermaView({ colore, Icona, titolo, testo, punti, enfasi = false }: { colore: string; Icona: typeof IconRefresh; titolo: string; testo: string; punti: string[]; enfasi?: boolean }) {
  return (
    <Stack gap="xl" maw={820} mx="auto">
      <TitoloPasso Icona={Icona} colore={colore} titolo={titolo} testo={testo} />
      <Paper withBorder radius="xl" p={{ base: "lg", sm: "xl" }} style={{ background: enfasi ? "var(--mantine-color-red-light)" : "var(--mantine-color-body)", borderColor: enfasi ? "var(--mantine-color-red-5)" : undefined }}>
        <Stack gap="md">
          {punti.map((punto) => (
            <Group key={punto} gap="sm" wrap="nowrap">
              <ThemeIcon size="sm" radius="xl" color={colore} variant="light"><IconCheck size={13} /></ThemeIcon>
              <Text size="sm" fw={600}>{punto}</Text>
            </Group>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}

function StatoLavoro({ titolo, testo, colore = "red" }: { titolo: string; testo: string; colore?: string }) {
  return (
    <Stack align="center" justify="center" ta="center" gap="lg" mih="55vh">
      <Box pos="relative">
        <ThemeIcon size={82} radius={999} color={colore} variant="light"><IconShieldLock size={38} /></ThemeIcon>
        <Box pos="absolute" bottom={-4} right={-4} bg="var(--mantine-color-body)" p={4} style={{ borderRadius: 999 }}><Loader size="sm" color={colore} /></Box>
      </Box>
      <Box maw={560}>
        <Text fw={850} fz={30}>{titolo}</Text>
        <Text c="dimmed" mt={8} lh={1.55}>{testo}</Text>
      </Box>
    </Stack>
  );
}
