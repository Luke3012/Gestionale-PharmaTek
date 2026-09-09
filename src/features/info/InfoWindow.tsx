// Finestra «Info» (FASE 7B) — aperta dal menu utente in Topbar. Pattern delle altre
// finestre-pannello (?info in main.tsx). Due modalità nello stesso "vetro" a misura fissa:
//  • INFO: marchio + versione + crediti + «Controlla aggiornamenti» (inline, qui).
//  • GIOCO: premendo SPAZIO le scritte svaniscono, il cielo con le nuvole entra in
//    dissolvenza, Livio arriva da sinistra e gli ostacoli da destra (gioco "Flappy Livio").
//    Con ESC si torna alle info con un'animazione morbida.
import { useEffect, useRef, useState } from "react";
import { ActionIcon, Anchor, Box, Button, Divider, Group, Stack, Text } from "@mantine/core";
import { IconArrowLeft, IconExternalLink, IconPlayerPlay, IconRefresh, IconSparkles } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { api, inTauri } from "../../lib/tauri";
import { useRicordaGeometria } from "../../lib/geometriaFinestre";
import { usePrefs } from "../../lib/prefs";
import { collegaDisiscrizioneAsincrona } from "../../lib/disiscrizioneAsincrona";
import { LogoMark, Wordmark } from "../../ui/Brand";
import { cercaAggiornamenti, type StatoUpdate } from "../../updater";
import { StoricoChangelog } from "../changelog/StoricoChangelog";
import { FlappyLivio } from "./FlappyLivio";

type Modalita = "info" | "gioco" | "storico";
const SEQUENZA_TEST_UPDATE = "test";

export function InfoWindow() {
  const [versione, setVersione] = useState<string>("");
  const [modalita, setModalita] = useState<Modalita>("info");
  const [update, setUpdate] = useState<StatoUpdate>({ stato: "inattivo" });
  const { balloonAttivo } = usePrefs();
  const sequenzaTestRef = useRef("");

  useRicordaGeometria("info");

  async function controllaAggiornamentiEStatoRemoto() {
    setUpdate({ stato: "controllo" });
    const controllo = await import("../../remoteControl")
      .then(({ controllaDisattivazioneRemota }) => controllaDisattivazioneRemota())
      .catch(() => null);
    if (controllo?.disabled) {
      setUpdate({ stato: "inattivo" });
      return;
    }
    await cercaAggiornamenti(setUpdate);
  }

  useEffect(() => {
    if (!inTauri) return;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersione)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("target");
    if (target === "gioco") {
      setModalita("gioco");
    } else if (target === "novita") {
      setModalita("storico");
    } else if (target === "aggiornamenti") {
      setModalita("info");
      void controllaAggiornamentiEStatoRemoto();
    }

    if (!inTauri) return;
    let attivo = true;
    const disiscriviTauri = collegaDisiscrizioneAsincrona(
      import("@tauri-apps/api/event")
      .then(({ listen }) => listen<string>("info:navigate", (ev) => {
        if (!attivo) return;
        const dest = ev.payload;
        if (dest === "gioco") {
          setModalita("gioco");
        } else if (dest === "novita") {
          setModalita("storico");
        } else if (dest === "aggiornamenti") {
          setModalita("info");
          void controllaAggiornamentiEStatoRemoto();
        }
      })),
    );
    return () => {
      attivo = false;
      disiscriviTauri();
    };
  }, []);

  async function inviaTestAggiornamento() {
    if (!inTauri) return;
    const { emit, emitTo } = await import("@tauri-apps/api/event");
    if (balloonAttivo) {
      try {
        await emitTo("overlay", "pt:update-test");
        return;
      } catch {
        // Se l'overlay non è ancora pronto, ripieghiamo sul toast della main.
      }
    }
    await emit("pt:update-test-main");
  }

  // Spazio (dalle info) → entra nel gioco; Esc (da gioco/storico) → torna alle info.
  // Sequenza nascosta T-E-S-T → notifica di installazione ultima versione.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const k = e.key.toLowerCase();
        if (/^[a-z]$/.test(k)) {
          const prossima = (sequenzaTestRef.current + k).slice(-SEQUENZA_TEST_UPDATE.length);
          sequenzaTestRef.current = prossima;
          if (prossima === SEQUENZA_TEST_UPDATE) {
            sequenzaTestRef.current = "";
            e.preventDefault();
            void inviaTestAggiornamento();
            return;
          }
        } else {
          sequenzaTestRef.current = "";
        }
      }
      if (modalita === "info") {
        const a = document.activeElement;
        const interattivo = a && /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
        if (e.code === "Space" && !interattivo) {
          e.preventDefault();
          setModalita("gioco");
        }
      } else if (e.code === "Escape") {
        e.preventDefault();
        setModalita("info");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalita, balloonAttivo]);

  useEffect(() => {
    const titolo =
      modalita === "gioco" ? "FLAPPY LIVIO" : modalita === "storico" ? "Novità — PharmaTek" : "Info — PharmaTek";
    if (!inTauri) {
      document.title = titolo;
      return;
    }
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        getCurrentWindow().setTitle(titolo).catch(() => {});
      })
      .catch(() => {});
  }, [modalita]);

  function apriSito() {
    const url = "https://example.invalid";
    if (inTauri) api.apriUrl(url).catch(() => {});
    else window.open(url, "_blank");
  }

  return (
    <Box style={{ position: "relative", height: "100vh", overflow: "hidden", background: "var(--surface)" }}>
      <AnimatePresence mode="sync" initial={false}>
        {modalita === "info" ? (
          <motion.div
            key="info"
            initial="nascosto"
            animate="visibile"
            exit="uscita"
            variants={{
              nascosto: {},
              visibile: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
              uscita: { opacity: 0, transition: { duration: 0.28 } },
            }}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              overflow: "auto",
            }}
          >
            <Stack
              gap="sm"
              p="md"
              maw={420}
              w="100%"
              m="auto"
              style={{ flexShrink: 0 }}
            >
              <Vola>
                <Stack gap={4} align="center" ta="center" mt="xs">
                  <LogoMark size={56} />
                  <Wordmark />
                  <Text size="sm" c="dimmed">
                    Gestionale by Luchino 🥰
                  </Text>
                  {versione && (
                    <Text size="xs" c="dimmed">
                      Versione {versione}
                    </Text>
                  )}
                </Stack>
              </Vola>

              <Vola>
                <Group justify="center" gap="sm">
                  <Button
                    variant="default"
                    leftSection={<IconRefresh size={16} />}
                    disabled={!inTauri}
                    loading={update.stato === "controllo" || update.stato === "installazione"}
                    onClick={() => void controllaAggiornamentiEStatoRemoto()}
                  >
                    Controlla aggiornamenti
                  </Button>
                  <Button variant="subtle" color="gray" leftSection={<IconExternalLink size={16} />} onClick={apriSito}>
                    example.invalid
                  </Button>
                </Group>
              </Vola>

              <Vola>
                <Text size="xs" c="dimmed" ta="center" mih={18}>
                  {update.stato === "nessuno"
                    ? "Sei aggiornato all'ultima versione."
                    : update.stato === "installazione"
                      ? "Scarico e installo l'aggiornamento…"
                      : update.stato === "errore"
                        ? `Controllo non riuscito: ${update.messaggio}`
                        : ""}
                </Text>
              </Vola>

              <Vola>
                <Group justify="center">
                  <Button
                    variant="light"
                    color="accent"
                    leftSection={<IconSparkles size={16} />}
                    onClick={() => setModalita("storico")}
                  >
                    Novità e changelog
                  </Button>
                </Group>
              </Vola>

              <Vola>
                <Text size="xs" c="dimmed" ta="center">
                  © {new Date().getFullYear()} PharmaTek · Realizzato con cura.
                </Text>
              </Vola>

              <Vola>
                <Divider />
              </Vola>

              <Vola>
                <Group justify="center" gap={8}>
                  <Button
                    variant="light"
                    color="accent"
                    size="xs"
                    leftSection={<IconPlayerPlay size={14} />}
                    onClick={() => setModalita("gioco")}
                  >
                    Gioca a Flappy Livio
                  </Button>
                  <Text size="xs" c="dimmed">
                    (o premi <Kbd>Spazio</Kbd>)
                  </Text>
                </Group>
              </Vola>
            </Stack>
          </motion.div>
        ) : modalita === "storico" ? (
          <motion.div
            key="storico"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.22 } }}
            style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}
          >
            <Group gap="xs" px="md" py="sm" style={{ flex: "0 0 auto", borderBottom: "1px solid var(--mantine-color-gray-2)" }}>
              <ActionIcon variant="subtle" color="gray" onClick={() => setModalita("info")} aria-label="Torna alle info">
                <IconArrowLeft size={18} />
              </ActionIcon>
              <Text fw={700}>Novità e changelog</Text>
            </Group>
            <Box style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "var(--mantine-spacing-md)" }}>
              <Box maw={460} mx="auto">
                <StoricoChangelog versioneCorrente={versione} />
              </Box>
            </Box>
          </motion.div>
        ) : (
          <motion.div
            key="gioco"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.5 } }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: 12 }}
          >
            <Box style={{ flex: 1, minHeight: 0 }}>
              <FlappyLivio />
            </Box>
            <Group justify="center" mt={6} style={{ flex: "0 0 auto" }}>
              <Anchor size="xs" c="dimmed" component="button" type="button" onClick={() => setModalita("info")}>
                ← Torna alle info (Esc)
              </Anchor>
            </Group>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  );
}

/** Figlio che "vola dentro" con uno spring morbido (stagger gestito dal genitore). */
function Vola({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      variants={{
        nascosto: { opacity: 0, y: 14 },
        visibile: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 320, damping: 26 } },
        uscita: { opacity: 0 },
      }}
    >
      {children}
    </motion.div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="kbd"
      style={{
        fontFamily: "inherit",
        fontSize: 11,
        fontWeight: 700,
        padding: "1px 5px",
        borderRadius: 4,
        background: "#fff",
        border: "1px solid var(--mantine-color-gray-4)",
        borderBottomWidth: 2,
      }}
    >
      {children}
    </Box>
  );
}
