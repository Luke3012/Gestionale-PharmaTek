// Onboarding primo avvio (UI-SPEC §7.1). Ordine: Cartella → Utente → Avatar →
// Riepilogo. La cartella viene per prima perché serve ad aprire il registro
// condiviso e rilevare i nomi utente duplicati "mentre digiti".
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Center,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconFolder,
  IconFolderCheck,
  IconSparkles,
  IconUserPlus,
} from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "framer-motion";
import {
  api,
  inTauri,
  type AvatarTipo,
  type Bootstrap,
  type Identity,
  type OnboardingMode,
  type UserDto,
} from "../lib/tauri";
import {
  CHIAVE_SETUP_IMPOSTAZIONI_COMPLETATO,
  impostazioniInizialiDaProporre,
  usePrefs,
} from "../lib/prefs";
import { AnimatedAutoHeight } from "../ui/AnimatedAutoHeight";
import { Avatar, aggiornaAvatarCache } from "../ui/Avatar";
import { LogoMark, Wordmark } from "../ui/Brand";
import { fadeSlide, useAnimazioniRidotte } from "../ui/motion";
import { toast } from "../ui/toast/store";
import { useFotoAvatar } from "../ui/useFotoAvatar";
import { AzioniFotoAvatar, SceltePresetAvatar } from "../ui/ScelteAvatar";
import {
  ImpostazioniConsigliateStep,
  valoriImpostazioniIniziali,
  type ImpostazioneInizialeId,
  type ScelteImpostazioniIniziali,
} from "./ImpostazioniConsigliateStep";

type PassoOnboarding = "Cartella" | "Utente" | "Avatar" | "Impostazioni" | "Riepilogo";

export function calcolaPassiOnboarding(mostraImpostazioni: boolean): PassoOnboarding[] {
  return mostraImpostazioni
    ? ["Cartella", "Utente", "Avatar", "Impostazioni", "Riepilogo"]
    : ["Cartella", "Utente", "Avatar", "Riepilogo"];
}

export function passoVisibileOnboarding(
  passoCorrente: PassoOnboarding,
  passi: PassoOnboarding[]
): PassoOnboarding {
  return passi.includes(passoCorrente) ? passoCorrente : "Riepilogo";
}

export function selezioneDopoModificaNome(
  mode: OnboardingMode,
  userId: string | null
): { mode: OnboardingMode; userId: string | null } {
  return mode === "reconfigure" ? { mode, userId } : { mode: "create", userId: null };
}

export function avatarOnboardingCambiato(
  mode: OnboardingMode,
  originale: Pick<UserDto, "avatarTipo" | "avatarValore"> | undefined,
  avatarTipo: AvatarTipo,
  avatarValore: string,
  fotoCaricata: boolean
): boolean {
  return mode === "use" && !!originale && (
    avatarTipo !== originale.avatarTipo ||
    avatarValore !== originale.avatarValore ||
    (avatarTipo === "custom" && fotoCaricata)
  );
}

export function Onboarding({
  boot,
  onDone,
}: {
  boot: Bootstrap;
  onDone: (id: Identity) => void;
}) {
  const ridotte = useAnimazioniRidotte();
  const [passoCorrente, setPassoCorrente] = useState<PassoOnboarding>("Cartella");
  const [dataDir, setDataDir] = useState<string | null>(boot.dataDir);
  const [mostraConfermaCartella, setMostraConfermaCartella] = useState(!!boot.dataDir);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [verificando, setVerificando] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    current: number;
    total: number;
    phase: string;
  } | null>(null);

  const [nome, setNome] = useState("");
  const [createdUserId] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<OnboardingMode>("create");
  const [userId, setUserId] = useState<string | null>(null);

  const [avatarTipo, setAvatarTipo] = useState<AvatarTipo>("iniziali");
  const [avatarPreset, setAvatarPreset] = useState("p1");
  const [salvando, setSalvando] = useState(false);
  const { fotoBytes, fotoPreview, fileRef, caricaFoto, resettaFoto } = useFotoAvatar(setAvatarTipo);

  const { zoomUI, setZoomUI, ordineFinestra, setOrdineFinestra, sogliaSolleciti, setSogliaSolleciti } = usePrefs();
  const [impostazioniDaProporre] = useState(() =>
    impostazioniInizialiDaProporre({ zoomUI, ordineFinestra, sogliaSolleciti })
  );
  const [mostraImpostazioni, setMostraImpostazioni] = useState(true);
  const mostraImpostazioniRef = useRef(true);
  const [applicaImpostazioniScelte, setApplicaImpostazioniScelte] = useState(false);
  const [impostazioniScelte, setImpostazioniScelte] = useState<ScelteImpostazioniIniziali>({
    autostart: true,
    zoom: true,
    finestra: true,
    solleciti: true,
  });

  function scegliImpostazione(id: ImpostazioneInizialeId, consigliata: boolean) {
    setImpostazioniScelte((precedenti) => ({ ...precedenti, [id]: consigliata }));
  }

  useEffect(() => {
    if (!impostazioniDaProporre) {
      mostraImpostazioniRef.current = false;
      setMostraImpostazioni(false);
      setApplicaImpostazioniScelte(false);
      return;
    }
    if (!inTauri) return;
    let attivo = true;
    void import("@tauri-apps/plugin-autostart")
      .then(({ isEnabled }) => isEnabled())
      .then((enabled) => {
        if (attivo && enabled) {
          mostraImpostazioniRef.current = false;
          setMostraImpostazioni(false);
          setApplicaImpostazioniScelte(false);
        }
      })
      .catch(() => {});
    return () => {
      attivo = false;
    };
  }, [impostazioniDaProporre]);

  const passi = useMemo(() => calcolaPassiOnboarding(mostraImpostazioni), [mostraImpostazioni]);
  const currentPasso = passoVisibileOnboarding(passoCorrente, passi);
  const step = passi.indexOf(currentPasso);

  function selezionaImpostazioniConsigliate() {
    setApplicaImpostazioniScelte(true);
    setPassoCorrente("Riepilogo");
  }

  function saltaImpostazioni() {
    setApplicaImpostazioniScelte(false);
    setPassoCorrente("Riepilogo");
  }

  const duplicato = useMemo(
    () => users.find((u) => u.nome.trim().toLowerCase() === nome.trim().toLowerCase()),
    [users, nome]
  );

  async function scegliCartella() {
    try {
      const scelta = await open({
        directory: true,
        multiple: false,
        title: "Scegli la cartella dati condivisa (PharmaTek-Data)",
      });
      if (typeof scelta !== "string") return;
      setMostraConfermaCartella(false);
      setVerificando(true);
      setSyncProgress(null);
      let unlisten: (() => void) | undefined;
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ current: number; total: number; phase: string }>(
          "pt:sync-progress",
          (event) => {
            setSyncProgress(event.payload);
          }
        );
      } catch {}

      const esistenti = await api.openDataDir(scelta);
      if (unlisten) unlisten();
      setDataDir(scelta);
      setMostraConfermaCartella(true);
      setUsers(esistenti);
      setSyncProgress(null);
      setVerificando(false);
    } catch (e) {
      setSyncProgress(null);
      setVerificando(false);
      toast.error(`Cartella non utilizzabile: ${e}`);
    }
  }

  function risolviDuplicato(scelta: OnboardingMode) {
    if (!duplicato) return;
    resettaFoto();
    setMode(scelta);
    if (scelta === "use" || scelta === "reconfigure") {
      setUserId(duplicato.id);
      setNome(duplicato.nome);
      setAvatarTipo(duplicato.avatarTipo);
      if (duplicato.avatarTipo === "preset") setAvatarPreset(duplicato.avatarValore || "p1");
    } else {
      setUserId(null);
    }
  }

  function creaNuovoUtente() {
    resettaFoto();
    setMode("create");
    setUserId(null);
    setNome("");
    setAvatarTipo("iniziali");
    setAvatarPreset("p1");
  }

  const utenteSelezionato = mode === "use" ? users.find((utente) => utente.id === userId) : undefined;
  const userIdFinale = mode === "create" ? userId ?? createdUserId : userId!;
  const avatarValore =
    avatarTipo === "preset"
      ? avatarPreset
      : avatarTipo === "custom"
        ? mode === "use" && !fotoBytes && utenteSelezionato?.avatarTipo === "custom"
          ? utenteSelezionato.avatarValore
          : `${userIdFinale}.png`
        : "";

  async function conferma() {
    if (!dataDir) return;
    setSalvando(true);
    try {
      let identity = await api.finishOnboarding({
        dataDir,
        mode,
        userId: mode === "create" ? userIdFinale : userId ?? undefined,
        nome: nome.trim(),
        avatarTipo,
        avatarValore,
      });
      const avatarCambiato = avatarOnboardingCambiato(
        mode, utenteSelezionato, avatarTipo, avatarValore, !!fotoBytes
      );
      if (avatarTipo === "custom" && fotoBytes) {
        await api.saveAvatar(identity.userId, fotoBytes);
        // Semina la cache avatar (come fa la modale Profilo): così la foto compare
        // SUBITO al primo load / schermo d'avvio, senza attendere la lettura da disco.
        if (fotoPreview) aggiornaAvatarCache(identity.userId, fotoPreview);
      }
      if (avatarCambiato) {
        identity = await api.aggiornaProfilo(identity.nome, avatarTipo, avatarValore);
      }
      let impostazioniApplicate = true;
      if (mostraImpostazioniRef.current && applicaImpostazioniScelte) {
        const valori = valoriImpostazioniIniziali(impostazioniScelte);
        setZoomUI(valori.zoomUI);
        setOrdineFinestra(valori.ordineFinestra);
        setSogliaSolleciti(valori.sogliaSolleciti);
        if (inTauri) {
          try {
            const { enable, disable } = await import("@tauri-apps/plugin-autostart");
            if (valori.autostart) {
              await api.traySet(true);
              try {
                await enable();
              } catch {
                impostazioniApplicate = false;
                await api.traySet(false).catch(() => {});
              }
            } else {
              await disable();
              await api.traySet(false);
            }
          } catch {
            impostazioniApplicate = false;
          }
        }
      }
      if (impostazioniApplicate) {
        try {
          localStorage.setItem(CHIAVE_SETUP_IMPOSTAZIONI_COMPLETATO, "true");
        } catch {}
      }
      onDone(identity);
    } catch (e) {
      toast.error(`Configurazione non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  const puoAvanzare =
    currentPasso === "Cartella"
      ? !!dataDir
      : currentPasso === "Utente"
        ? nome.trim().length > 0 && (!duplicato || mode !== "create")
        : true;

  return (
    <Center style={{ flex: 1, height: "100%", padding: 20, overflow: "auto" }}>
      <Paper
        shadow="sm"
        radius="lg"
        withBorder
        px="xl"
        py="lg"
        style={{
          width: 560,
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box style={{ flexShrink: 0 }}>
          <Group justify="space-between" mb="md">
            <Group gap="sm">
              <LogoMark size={32} />
              <Wordmark />
            </Group>
            <Text size="xs" c="dimmed">
              Configurazione iniziale
            </Text>
          </Group>

          <Stepper current={step} passi={passi} />
        </Box>

        <Box mt="lg" style={{ flex: 1, minHeight: 0 }}>
          <AnimatedAutoHeight duration={0.45} reducedMotion={ridotte} headroom={6}>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentPasso}
                variants={fadeSlide}
                initial={ridotte ? false : "initial"}
                animate="animate"
                exit={ridotte ? undefined : "exit"}
              >
              {currentPasso === "Cartella" && (
                <Stack gap="md">
                  <Titolo
                    titolo="Cartella dati condivisa"
                    sub="Scegli la cartella PharmaTek-Data sincronizzata su OneDrive (la stessa per tutti i PC)."
                  />
                  <Button
                    variant={dataDir ? "default" : "filled"}
                    color="accent"
                    leftSection={dataDir ? <IconFolderCheck size={18} /> : <IconFolder size={18} />}
                    onClick={scegliCartella}
                    loading={verificando}
                    size="md"
                  >
                    {dataDir ? "Cambia cartella" : "Scegli cartella…"}
                  </Button>
                  {verificando && syncProgress && syncProgress.total > 0 && (
                    <Stack gap={4} mt={2}>
                      <Progress
                        value={Math.min(100, Math.round((syncProgress.current / syncProgress.total) * 100))}
                        size="sm"
                        color="accent"
                        animated
                      />
                    </Stack>
                  )}
                  {dataDir && mostraConfermaCartella && (
                    <Alert color="green" variant="light" icon={<IconCheck size={18} />}>
                      <Text size="sm" style={{ wordBreak: "break-all" }}>
                        {dataDir}
                      </Text>
                      <Text size="xs" c="dimmed" mt={4}>
                        {users.length === 0
                          ? "Nessun utente ancora registrato in questa cartella."
                          : `${users.length} utente/i già registrati.`}
                      </Text>
                    </Alert>
                  )}
                </Stack>
              )}

              {currentPasso === "Utente" && (
                <Stack gap="md">
                  <Titolo titolo="Chi sei?" sub="Il tuo nome serve a tracciare chi fa cosa nel registro condiviso." />
                  <TextInput
                    label="Nome utente"
                    placeholder="Es. Livio"
                    value={nome}
                    disabled={mode === "use"}
                    onChange={(e) => {
                      setNome(e.currentTarget.value);
                      const selezione = selezioneDopoModificaNome(mode, userId);
                      setMode(selezione.mode);
                      setUserId(selezione.userId);
                    }}
                    size="md"
                    data-autofocus
                  />
                  {duplicato && (
                    <Alert color="yellow" variant="light" title={`Esiste già l'utente «${duplicato.nome}»`}>
                      <Text size="sm" mb="xs">
                        Vuoi collegare questo PC all'utente esistente, riconfigurarlo o crearne uno nuovo?
                      </Text>
                      <Group gap="xs">
                        <Button size="xs" variant={mode === "use" ? "filled" : "default"} color="accent" onClick={() => risolviDuplicato("use")}>
                          Usa questo utente
                        </Button>
                        <Button size="xs" variant={mode === "reconfigure" ? "filled" : "default"} color="accent" onClick={() => risolviDuplicato("reconfigure")}>
                          Riconfiguralo
                        </Button>
                        <Button size="xs" variant="default" onClick={creaNuovoUtente}>
                          Crea nuovo
                        </Button>
                      </Group>
                    </Alert>
                  )}
                </Stack>
              )}

              {currentPasso === "Avatar" && (
                <Stack gap="md">
                  <Titolo
                    titolo="Foto profilo"
                    sub={
                      mode === "use"
                        ? "Puoi cambiare l'immagine di questo utente; sarà visibile anche sugli altri PC."
                        : "Scegli un avatar predefinito o carica una tua foto."
                    }
                  />
                  <Group justify="center">
                    <Avatar
                      nome={nome}
                      tipo={avatarTipo}
                      valore={avatarValore}
                      src={avatarTipo === "custom" ? fotoPreview : undefined}
                      userId={avatarTipo === "custom" && !fotoPreview ? userIdFinale : undefined}
                      size={88}
                    />
                  </Group>
                  <Group gap="sm" justify="center">
                    <SceltePresetAvatar
                      nome={nome}
                      tipo={avatarTipo}
                      preset={avatarPreset}
                      dimensione={44}
                      onSeleziona={(prossimo) => {
                        setAvatarTipo("preset");
                        setAvatarPreset(prossimo);
                      }}
                    />
                  </Group>
                  <AzioniFotoAvatar
                    fileRef={fileRef}
                    dimensioneIcona={18}
                    onCarica={caricaFoto}
                    onIniziali={() => setAvatarTipo("iniziali")}
                  />
                </Stack>
              )}

              {currentPasso === "Impostazioni" && (
                <ImpostazioniConsigliateStep scelte={impostazioniScelte} onScelta={scegliImpostazione} />
              )}

              {currentPasso === "Riepilogo" && (
                <Stack gap="md">
                  <Titolo titolo="Tutto pronto" sub="Controlla e conferma. Potrai cambiare nome e avatar da Impostazioni → Profilo." />
                  <Paper withBorder radius="md" p="md" shadow="none">
                    <Group>
                      <Avatar
                        nome={nome}
                        tipo={avatarTipo}
                        valore={avatarValore}
                        src={avatarTipo === "custom" ? fotoPreview : undefined}
                        userId={avatarTipo === "custom" && !fotoPreview ? userIdFinale : undefined}
                        size={56}
                      />
                      <Box>
                        <Text fw={700}>{nome || "—"}</Text>
                        <Text size="xs" c="dimmed">
                          {boot.deviceNome} · {mode === "create" ? "nuovo utente" : mode === "use" ? "utente esistente" : "utente riconfigurato"}
                        </Text>
                      </Box>
                    </Group>
                    <Text size="xs" c="dimmed" mt="sm" style={{ wordBreak: "break-all" }}>
                      Cartella dati: {dataDir}
                    </Text>
                  </Paper>
                </Stack>
              )}
            </motion.div>
          </AnimatePresence>
        </AnimatedAutoHeight>
      </Box>

      <Group justify="space-between" align="center" wrap="nowrap" mt="lg" style={{ flexShrink: 0 }}>
        <Button
          variant="subtle"
          color="gray"
          disabled={step === 0 || salvando}
          onClick={() => setPassoCorrente(passi[step - 1])}
        >
          Indietro
        </Button>
        {currentPasso === "Impostazioni" ? (
          <Group gap="xs" wrap="nowrap">
            <Button
              variant="subtle"
              color="gray"
              onClick={saltaImpostazioni}
            >
              Salta
            </Button>
            <Button
              color="accent"
              onClick={selezionaImpostazioniConsigliate}
              leftSection={<IconSparkles size={16} />}
            >
              Applica selezionate
            </Button>
          </Group>
        ) : step < passi.length - 1 ? (
          <Button
            color="accent"
            disabled={!puoAvanzare}
            onClick={() => setPassoCorrente(passi[step + 1])}
            rightSection={<IconCheck size={16} />}
          >
            Avanti
          </Button>
        ) : (
          <Button
            color="accent"
            loading={salvando}
            onClick={conferma}
            leftSection={<IconUserPlus size={18} />}
          >
            Entra nel gestionale
          </Button>
        )}
      </Group>
      </Paper>
    </Center>
  );
}

function Titolo({ titolo, sub }: { titolo: string; sub: string }) {
  return (
    <Box>
      <Text fw={700} size="lg">
        {titolo}
      </Text>
      <Text size="sm" c="dimmed">
        {sub}
      </Text>
    </Box>
  );
}

function Stepper({ current, passi }: { current: number; passi: string[] }) {
  return (
    <Box style={{ display: "flex", alignItems: "center", width: "100%" }}>
      {passi.map((p, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <Box key={p} style={{ display: "contents" }}>
            <Tooltip label={p} withArrow>
              <ThemeIcon
                size={26}
                radius="xl"
                variant={active || done ? "filled" : "light"}
                color={active || done ? "accent" : "gray"}
                style={{ flexShrink: 0 }}
              >
                {done ? <IconCheck size={15} /> : <Text size="xs" fw={700}>{i + 1}</Text>}
              </ThemeIcon>
            </Tooltip>
            {i < passi.length - 1 && (
              <Box style={{ flex: 1, height: 2, background: done ? "#F4C20D" : "#E3E8EF", borderRadius: 2, margin: "0 6px" }} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}
