// Onboarding primo avvio (UI-SPEC §7.1). Ordine: Cartella → Utente → Avatar →
// Riepilogo. La cartella viene per prima perché serve ad aprire il registro
// condiviso e rilevare i nomi utente duplicati "mentre digiti".
import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Center,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconCheck,
  IconFolder,
  IconFolderCheck,
  IconPhoto,
  IconUserPlus,
} from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "framer-motion";
import {
  api,
  type AvatarTipo,
  type Bootstrap,
  type Identity,
  type OnboardingMode,
  type UserDto,
} from "../lib/tauri";
import { Avatar, aggiornaAvatarCache } from "../ui/Avatar";
import { LogoMark, Wordmark } from "../ui/Brand";
import { PRESETS } from "../ui/avatars";
import { fadeSlide, useAnimazioniRidotte } from "../ui/motion";
import { toast } from "../ui/toast/store";
import { cropAvatarTo256 } from "../ui/avatarImage";

const PASSI = ["Cartella", "Utente", "Avatar", "Riepilogo"];

export function Onboarding({
  boot,
  onDone,
}: {
  boot: Bootstrap;
  onDone: (id: Identity) => void;
}) {
  const ridotte = useAnimazioniRidotte();
  const [step, setStep] = useState(0);
  const [dataDir, setDataDir] = useState<string | null>(boot.dataDir);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [verificando, setVerificando] = useState(false);

  const [nome, setNome] = useState("");
  const [createdUserId] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<OnboardingMode>("create");
  const [userId, setUserId] = useState<string | null>(null);

  const [avatarTipo, setAvatarTipo] = useState<AvatarTipo>("iniziali");
  const [avatarPreset, setAvatarPreset] = useState("p1");
  const [fotoBytes, setFotoBytes] = useState<number[] | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | undefined>();
  const [salvando, setSalvando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      setVerificando(true);
      const esistenti = await api.openDataDir(scelta);
      setDataDir(scelta);
      setUsers(esistenti);
      setVerificando(false);
    } catch (e) {
      setVerificando(false);
      toast.error(`Cartella non utilizzabile: ${e}`);
    }
  }

  function risolviDuplicato(scelta: OnboardingMode) {
    if (!duplicato) return;
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

  async function caricaFoto(file?: File) {
    if (!file) return;
    try {
      const { bytes, dataUrl } = await cropAvatarTo256(file);
      setFotoBytes(bytes);
      setFotoPreview(dataUrl);
      setAvatarTipo("custom");
    } catch {
      toast.error("Immagine non valida.");
    }
  }

  const userIdFinale = mode === "create" ? userId ?? createdUserId : userId!;
  const avatarValore =
    avatarTipo === "preset" ? avatarPreset : avatarTipo === "custom" ? `${userIdFinale}.png` : "";

  async function conferma() {
    if (!dataDir) return;
    setSalvando(true);
    try {
      const identity = await api.finishOnboarding({
        dataDir,
        mode,
        userId: mode === "create" ? userIdFinale : userId ?? undefined,
        nome: nome.trim(),
        avatarTipo,
        avatarValore,
      });
      if (avatarTipo === "custom" && fotoBytes) {
        await api.saveAvatar(identity.userId, fotoBytes);
        // Semina la cache avatar (come fa la modale Profilo): così la foto compare
        // SUBITO al primo load / schermo d'avvio, senza attendere la lettura da disco.
        if (fotoPreview) aggiornaAvatarCache(identity.userId, fotoPreview);
      }
      onDone(identity);
    } catch (e) {
      toast.error(`Configurazione non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  const puoAvanzare =
    step === 0
      ? !!dataDir
      : step === 1
        ? nome.trim().length > 0 && (!duplicato || mode !== "create")
        : true;

  return (
    <Center style={{ flex: 1, height: "100%", padding: 24, overflow: "auto" }}>
      <Paper shadow="lg" radius="lg" withBorder p="xl" style={{ width: 560, maxWidth: "100%" }}>
        <Group justify="space-between" mb="lg">
          <Group gap="sm">
            <LogoMark size={34} />
            <Wordmark />
          </Group>
          <Text size="xs" c="dimmed">
            Configurazione iniziale
          </Text>
        </Group>

        <Stepper current={step} />

        <Box mt="xl" style={{ minHeight: 240 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              variants={fadeSlide}
              initial={ridotte ? false : "initial"}
              animate="animate"
              exit={ridotte ? undefined : "exit"}
            >
              {step === 0 && (
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
                  {dataDir && (
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

              {step === 1 && (
                <Stack gap="md">
                  <Titolo titolo="Chi sei?" sub="Il tuo nome serve a tracciare chi fa cosa nel registro condiviso." />
                  <TextInput
                    label="Nome utente"
                    placeholder="Es. Utente Demo"
                    value={nome}
                    onChange={(e) => {
                      setNome(e.currentTarget.value);
                      setMode("create");
                      setUserId(null);
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
                        <Button size="xs" variant="default" onClick={() => toast.info("Scegli un nome diverso per creare un nuovo utente.")}>
                          Crea nuovo
                        </Button>
                      </Group>
                    </Alert>
                  )}
                </Stack>
              )}

              {step === 2 && (
                <Stack gap="md">
                  <Titolo
                    titolo="Foto profilo"
                    sub={
                      mode === "use"
                        ? "Stai usando un utente esistente: puoi tenere il suo avatar o cambiarlo."
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
                    {PRESETS.map((p) => {
                      const sel = avatarTipo === "preset" && avatarPreset === p.id;
                      return (
                        <UnstyledButton
                          key={p.id}
                          onClick={() => {
                            setAvatarTipo("preset");
                            setAvatarPreset(p.id);
                          }}
                          style={{
                            display: "inline-flex",
                            borderRadius: "50%",
                            padding: 2,
                            lineHeight: 0,
                            outline: sel ? "2px solid #F4C20D" : "2px solid transparent",
                          }}
                        >
                          <Avatar nome={nome} tipo="preset" valore={p.id} size={44} />
                        </UnstyledButton>
                      );
                    })}
                  </Group>
                  <Group gap="sm">
                    <Button
                      variant="default"
                      leftSection={<IconPhoto size={18} />}
                      onClick={() => fileRef.current?.click()}
                    >
                      Carica una foto
                    </Button>
                    <Button variant="subtle" color="gray" onClick={() => setAvatarTipo("iniziali")}>
                      Usa le iniziali
                    </Button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      hidden
                      onChange={(e) => caricaFoto(e.currentTarget.files?.[0])}
                    />
                  </Group>
                </Stack>
              )}

              {step === 3 && (
                <Stack gap="md">
                  <Titolo titolo="Tutto pronto" sub="Controlla e conferma. Potrai cambiare nome e avatar da Impostazioni → Profilo." />
                  <Paper withBorder radius="md" p="md">
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
        </Box>

        <Group justify="space-between" mt="xl">
          <Button variant="subtle" color="gray" disabled={step === 0 || salvando} onClick={() => setStep((s) => s - 1)}>
            Indietro
          </Button>
          {step < 3 ? (
            <Button color="accent" disabled={!puoAvanzare} onClick={() => setStep((s) => s + 1)} rightSection={<IconCheck size={16} />}>
              Avanti
            </Button>
          ) : (
            <Button color="accent" loading={salvando} onClick={conferma} leftSection={<IconUserPlus size={18} />}>
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

function Stepper({ current }: { current: number }) {
  return (
    <Box style={{ display: "flex", alignItems: "center", width: "100%" }}>
      {PASSI.map((p, i) => {
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
            {i < PASSI.length - 1 && (
              <Box style={{ flex: 1, height: 2, background: done ? "#F4C20D" : "#E3E8EF", borderRadius: 2, margin: "0 6px" }} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}
