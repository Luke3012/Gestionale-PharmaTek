// Topbar: ☰, titolo vista, ricerca (Ctrl+K), pill sync, campanella, utente.
import { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Divider,
  Group,
  Menu,
  Popover,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconFolder,
  IconHistory,
  IconInfoCircle,
  IconMenu2,
  IconMessage,
  IconRefresh,
  IconSearch,
  IconUserEdit,
  IconCheck,
} from "@tabler/icons-react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { api, type Identity, type SyncOverview } from "../lib/tauri";
import { usePrefs } from "../lib/prefs";
import { Avatar } from "../ui/Avatar";
import { Wordmark } from "../ui/Brand";
import { titoloPerPath } from "./nav";
import { etichettaHotkey } from "./navigazione";
import { CestinoPopover } from "./CestinoPopover";
import { CampanellaPopover } from "./CampanellaPopover";
import { ProfiloModal } from "../features/profilo/ProfiloModal";
import { apriFinestraInfo } from "./apriPannelli";
import { componiMessaggio } from "../features/notifiche/messaggi";
import { toast } from "../ui/toast/store";
import { useCloseOnScroll } from "../lib/closeOnScroll";
import { PremiumAction } from "../premium/PremiumAction";
import { apriCentroComunicazioni } from "../features/comunicazioni/apriComunicazione";

export function Topbar({
  identity,
  onIdentityChange,
  onCerca,
  scrollato,
}: {
  identity: Identity;
  onIdentityChange: (identity: Identity) => void;
  onCerca: () => void;
  /** Il contenuto è scrollato oltre il titolo big: mostra il titolo pagina in topbar. */
  scrollato: boolean;
}) {
  const { sidebar, setSidebar, hotkeyGlobale } = usePrefs();
  const location = useLocation();
  const [profiloOpen, setProfiloOpen] = useState(false);
  const titolo = titoloPerPath(location.pathname);
  const [online, setOnline] = useState(navigator.onLine);
  const [sincronizzando, setSincronizzando] = useState(false);
  const [syncStato, setSyncStato] = useState<"idle" | "success" | "already">(
    "idle",
  );
  const [syncOpen, setSyncOpen] = useState(false);
  useCloseOnScroll(syncOpen, setSyncOpen);
  const [overview, setOverview] = useState<SyncOverview | null>(null);

  async function caricaOverview() {
    try {
      setOverview(await api.syncOverview());
    } catch {
      /* pannello resta usabile */
    }
  }

  async function apriCartella() {
    try {
      await api.apriCartellaDati();
    } catch (e) {
      toast.error(`Impossibile aprire la cartella: ${e}`);
    }
  }

  useEffect(() => {
    const su = () => setOnline(true);
    const giu = () => setOnline(false);
    window.addEventListener("online", su);
    window.addEventListener("offline", giu);
    return () => {
      window.removeEventListener("online", su);
      window.removeEventListener("offline", giu);
    };
  }, []);

  async function forzaSync() {
    if (sincronizzando) return;
    setSincronizzando(true);
    setSyncStato("idle");
    try {
      const n = await api.forceSync();
      if (n > 0) {
        toast.success(`Sincronizzato: ${n} aggiornamenti.`);
        setSyncStato("success");
      } else {
        setSyncStato("already");
      }
      void caricaOverview();
    } catch (e) {
      toast.error(`Sync non riuscita: ${e}`);
      setSyncStato("idle");
    } finally {
      setSincronizzando(false);
      setTimeout(() => setSyncStato("idle"), 2500);
    }
  }

  // Mostra/nasconde le etichette: estesa ↔ solo icone (non nasconde la barra).
  const toggleSidebar = () =>
    setSidebar(sidebar === "esteso" ? "icone" : "esteso");

  return (
    <Group
      h={52}
      px="md"
      justify="space-between"
      wrap="nowrap"
      style={{
        flex: "0 0 52px",
        background: "#fff",
        borderBottom: "1px solid var(--border)",
        zIndex: 100,
      }}
    >
      <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Tooltip label="Mostra/nascondi etichette menu" withArrow zIndex={1500}>
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={toggleSidebar}
            aria-label="Menu"
          >
            <IconMenu2 size={20} />
          </ActionIcon>
        </Tooltip>
        {/* Slot brand/titolo con crossfade. In cima alla pagina mostra il wordmark
            (solo se la sidebar NON è estesa, perché lì il wordmark c'è già); scrollando
            il titolo big esce di scena e qui appare il titolo pagina. Comportamento
            identico con sidebar aperta o chiusa (titolo su scroll sempre). */}
        <Box
          style={{
            position: "relative",
            height: 26,
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            containerType: "inline-size",
          }}
        >
          <style>{`
            @container (max-width: 130px) {
              .titolo-topbar { display: none !important; }
            }
          `}</style>
          <AnimatePresence initial={false}>
            {scrollato ? (
              <motion.div
                key="titolo"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  position: "absolute",
                  left: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  maxWidth: "100%",
                }}
              >
                <Text className="titolo-topbar" fw={700} fz="lg" lh={1}>
                  {titolo}
                </Text>
              </motion.div>
            ) : sidebar !== "esteso" ? (
              <motion.div
                key="wordmark"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{ position: "absolute", left: 0, lineHeight: 0 }}
              >
                <Wordmark />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </Box>
      </Group>

      <Group gap="sm" wrap="nowrap">
        <TextInput
          placeholder={
            sidebar === "esteso" ? "Cerca…" : "Cerca o digita un comando…"
          }
          leftSection={<IconSearch size={16} />}
          rightSection={<KbdHotkey combo={hotkeyGlobale} />}
          rightSectionWidth={62}
          rightSectionProps={{
            style: { justifyContent: "flex-end", paddingRight: 6 },
          }}
          w={sidebar === "esteso" ? 210 : 300}
          readOnly
          onClick={onCerca}
          styles={{
            root: { transition: "width 160ms ease" },
            input: { cursor: "pointer", textOverflow: "ellipsis" },
          }}
          visibleFrom="sm"
        />

        <Popover
          width={360}
          position="bottom-end"
          withArrow
          shadow="md"
          opened={syncOpen}
          onChange={setSyncOpen}
        >
          <Popover.Target>
            <Tooltip
              label={
                overview
                  ? `Aggiornato ${tempoFa(overview.lastEventMs)}`
                  : "Sincronizzazione"
              }
              withArrow
              disabled={syncOpen}
              zIndex={1500}
            >
              <Badge
                variant="light"
                color={online ? "green" : "gray"}
                leftSection={
                  <Box
                    w={8}
                    h={8}
                    style={{
                      borderRadius: 999,
                      background: online ? "#2F9E44" : "#868E96",
                    }}
                  />
                }
                style={{ cursor: "pointer" }}
                size="lg"
                onClick={() => {
                  const apri = !syncOpen;
                  setSyncOpen(apri);
                  if (apri) caricaOverview();
                }}
              >
                {online ? "Online" : "Offline"}
              </Badge>
            </Tooltip>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text fw={700} size="sm">
                  Sincronizzazione
                </Text>
                <Badge
                  size="sm"
                  variant="light"
                  color={online ? "green" : "gray"}
                >
                  {online ? "Online" : "Offline"}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {overview && overview.lastEventMs > 0
                  ? `Dati aggiornati ${tempoFa(overview.lastEventMs)}`
                  : online
                    ? "Connesso. I dati si aggiornano automaticamente."
                    : "Offline: le modifiche partiranno al ritorno online."}
              </Text>

              {overview && overview.devices.length > 0 && (
                <>
                  <Divider label="Dispositivi" labelPosition="left" />
                  <Stack gap={6}>
                    {overview.devices.map((d) => (
                      <Group
                        key={d.deviceId}
                        justify="space-between"
                        wrap="nowrap"
                        gap="xs"
                      >
                        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                          <Avatar
                            nome={d.userNome || d.nome}
                            tipo={d.avatarTipo}
                            valore={d.avatarValore}
                            userId={d.userId || undefined}
                            size={28}
                          />
                          <Box style={{ minWidth: 0 }}>
                            <Text size="sm" truncate>
                              {d.userNome || d.nome}{" "}
                              {!d.userNome && d.isCurrent && (
                                <Text span c="dimmed" size="xs">
                                  (questo PC)
                                </Text>
                              )}
                            </Text>
                            {d.userNome && (
                              <Text size="xs" c="dimmed" truncate>
                                {d.nome}{" "}
                                {d.isCurrent && (
                                  <Text span size="xs">
                                    (questo PC)
                                  </Text>
                                )}
                              </Text>
                            )}
                          </Box>
                        </Group>
                        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                          {!d.isCurrent && d.userId && (
                            <Tooltip
                              label={`Scrivi a ${d.userNome || d.nome}`}
                              withArrow
                              zIndex={1500}
                            >
                              <ActionIcon
                                variant="subtle"
                                color="grape"
                                size="sm"
                                aria-label={`Scrivi a ${d.userNome || d.nome}`}
                                onClick={() => {
                                  setSyncOpen(false);
                                  componiMessaggio(
                                    d.userId,
                                    d.userNome || d.nome,
                                  );
                                }}
                              >
                                <IconMessage size={15} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          <Text
                            size="xs"
                            c="dimmed"
                            style={{ whiteSpace: "nowrap" }}
                          >
                            {d.lastMs > 0 ? tempoFa(d.lastMs) : "—"}
                          </Text>
                        </Group>
                      </Group>
                    ))}
                  </Stack>
                </>
              )}

              <Divider />
              <UnstyledButton
                onClick={forzaSync}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 14,
                  color:
                    syncStato === "already" || syncStato === "success"
                      ? "var(--mantine-color-green-7)"
                      : undefined,
                  transition: "color 0.2s ease",
                }}
              >
                {sincronizzando ? (
                  <IconRefresh size={16} className="spin" />
                ) : syncStato === "already" || syncStato === "success" ? (
                  <IconCheck size={16} />
                ) : (
                  <IconRefresh size={16} />
                )}
                {sincronizzando
                  ? "Sincronizzazione..."
                  : syncStato === "already"
                    ? "Già aggiornato"
                    : syncStato === "success"
                      ? "Fatto!"
                      : "Forza sincronizzazione"}
              </UnstyledButton>
              <UnstyledButton
                onClick={apriCartella}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 14,
                }}
              >
                <IconFolder size={16} />
                Apri cartella dati
              </UnstyledButton>
            </Stack>
          </Popover.Dropdown>
        </Popover>

        <Tooltip label="Centro comunicazioni" withArrow zIndex={1500}>
          <Box
            w={34}
            h={34}
            style={{
              alignItems: "center",
              display: "inline-flex",
              justifyContent: "center",
              lineHeight: 0,
            }}
          >
            <PremiumAction
              ariaLabel="Apri Centro comunicazioni"
              className="pt-topbar-communication-action"
              iconOnly
              leftSection={
                <IconHistory
                  className="pt-premium-action-main-icon"
                  size={18}
                />
              }
              lockedPresentation="modal"
              message="Il Centro comunicazioni è disponibile attivando le funzionalità extra."
              onAction={() => void apriCentroComunicazioni()}
              style={{
                background: "transparent",
                borderColor: "transparent",
                color: "var(--mantine-color-gray-light-color)",
                height: 34,
                minHeight: 34,
                opacity: 1,
                padding: 0,
                width: 34,
              }}
            >
              Centro comunicazioni
            </PremiumAction>
          </Box>
        </Tooltip>

        <CestinoPopover />

        <CampanellaPopover identity={identity} />

        <Menu position="bottom-end" withArrow shadow="md" width={200}>
          <Menu.Target>
            <UnstyledButton
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <Avatar
                nome={identity.nome}
                tipo={identity.avatarTipo}
                valore={identity.avatarValore}
                userId={identity.userId}
                size={32}
              />
              <Text size="sm" fw={600} visibleFrom="sm">
                {identity.nome}
              </Text>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>{identity.nome}</Menu.Label>
            <Menu.Item
              leftSection={<IconUserEdit size={16} />}
              onClick={() => setProfiloOpen(true)}
            >
              Modifica profilo
            </Menu.Item>
            <Menu.Item
              leftSection={<IconInfoCircle size={16} />}
              onClick={async () => {
                if (!(await apriFinestraInfo()))
                  toast.info("Gestionale PharmaTek");
              }}
            >
              Info
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      <ProfiloModal
        opened={profiloOpen}
        onClose={() => setProfiloOpen(false)}
        identity={identity}
        onIdentityChange={onIdentityChange}
      />
    </Group>
  );
}

/** Scorciatoia resa come tasti della tastiera (es. Alt + P). */
function KbdHotkey({ combo }: { combo: string }) {
  const tasti = etichettaHotkey(combo).split(" ").filter(Boolean);
  return (
    <Group gap={3} wrap="nowrap" style={{ pointerEvents: "none" }}>
      {tasti.map((t, i) => (
        <Box
          key={i}
          component="kbd"
          style={{
            fontFamily: "inherit",
            fontSize: 10.5,
            fontWeight: 600,
            lineHeight: 1,
            color: "var(--mantine-color-gray-7)",
            background: "var(--mantine-color-gray-0)",
            border: "1px solid var(--mantine-color-gray-3)",
            borderBottomWidth: 2,
            borderRadius: 5,
            padding: "3px 5px",
            whiteSpace: "nowrap",
          }}
        >
          {t}
        </Box>
      ))}
    </Group>
  );
}

function tempoFa(ms: number): string {
  if (!ms) return "mai";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "ora";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} min fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h fa`;
  return `${Math.floor(h / 24)} g fa`;
}
