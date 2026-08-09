// Marchio PharmaTek + schermata di caricamento brandizzata (logo che pulsa).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, Center, Stack, Text, Group } from "@mantine/core";
import { motion } from "framer-motion";
import { Avatar } from "./Avatar";
import type { Identity } from "../lib/tauri";
import { useAnimazioniRidotte } from "./motion";

let blocchiToastAttivi = 0;

function useBloccoToastDuranteCaricamento() {
  useLayoutEffect(() => {
    blocchiToastAttivi += 1;
    document.documentElement.dataset.ptToastBlocking = "1";
    return () => {
      blocchiToastAttivi = Math.max(0, blocchiToastAttivi - 1);
      if (blocchiToastAttivi === 0) delete document.documentElement.dataset.ptToastBlocking;
    };
  }, []);
}

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <Box
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: "linear-gradient(135deg, #F4C20D, #E0900C)",
        color: "#1A1A1A",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: size * 0.56,
        flex: `0 0 ${size}px`,
      }}
    >
      P
    </Box>
  );
}

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <Text fw={800} size="lg" c={light ? "#fff" : undefined} style={{ letterSpacing: -0.3 }}>
      Pharma<span style={{ color: "#F4C20D" }}>Tek</span>
    </Text>
  );
}

export function CaricamentoSchermo({ testo = "Avvio…" }: { testo?: string }) {
  useBloccoToastDuranteCaricamento();
  const ridotte = useAnimazioniRidotte();
  return (
    <Center style={{ flex: 1, height: "100%" }}>
      <Stack align="center" gap="md">
        <motion.div
          animate={ridotte ? undefined : { scale: [1, 1.08, 1], opacity: [0.85, 1, 0.85] }}
          transition={ridotte ? undefined : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <LogoMark size={56} />
        </motion.div>
        <Text c="dimmed" size="sm">
          {testo}
        </Text>
      </Stack>
    </Center>
  );
}

export function UnifiedBootScreen({
  identity,
  testoSottotitolo = null
}: {
  identity: Identity;
  testoSottotitolo?: string | null;
}) {
  useBloccoToastDuranteCaricamento();
  const ridotte = useAnimazioniRidotte();
  return (
    <Box
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "var(--surface)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Stack align="center" gap="lg">
        <Box style={{ position: "relative", display: "inline-flex" }}>
          <motion.div
            animate={ridotte ? undefined : { scale: [1, 1.14, 1], opacity: [0.5, 0.12, 0.5] }}
            transition={ridotte ? undefined : { repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
            style={{ position: "absolute", inset: -10, borderRadius: "50%", border: "3px solid var(--mantine-color-accent-5)" }}
          />
          <motion.div
            animate={ridotte ? undefined : { scale: [1, 1.04, 1] }}
            transition={ridotte ? undefined : { repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
          >
            <Avatar
              nome={identity.nome}
              tipo={identity.avatarTipo}
              valore={identity.avatarValore}
              userId={identity.userId}
              size={96}
            />
          </motion.div>
        </Box>
        <Stack align="center" gap={4}>
          <Text fw={700} fz="lg">
            Ciao, {identity.nome}!
          </Text>
          {testoSottotitolo && (
            <Text size="sm" c="dimmed">
              {testoSottotitolo}
            </Text>
          )}
        </Stack>
        <Group gap={6}>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={ridotte ? undefined : { y: [0, -6, 0], opacity: [0.4, 1, 0.4] }}
              transition={ridotte ? undefined : { repeat: Infinity, duration: 0.9, delay: i * 0.15 }}
              style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--mantine-color-accent-6)" }}
            />
          ))}
        </Group>
      </Stack>
    </Box>
  );
}

const welcomeEmojis = [
  { char: "❤️", x: -80, y: -80, delay: 0.3 },
  { char: "✨", x: 80, y: -70, delay: 0.5 },
  { char: "🚀", x: -90, y: 70, delay: 0.7 },
  { char: "💊", x: 90, y: 60, delay: 0.9 },
  { char: "🎉", x: 0, y: -110, delay: 1.1 },
  { char: "📦", x: -120, y: -10, delay: 1.2 },
  { char: "🩺", x: 120, y: -10, delay: 1.4 },
];

export function SchermoBenvenuto({ identity, onFinished }: { identity: Identity; onFinished: () => void }) {
  const [visibile, setVisibile] = useState(true);
  const ridotte = useAnimazioniRidotte();
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    if (ridotte) {
      const tFinish = setTimeout(() => onFinishedRef.current(), 0);
      return () => clearTimeout(tFinish);
    }
    const tFade = setTimeout(() => setVisibile(false), 3100);
    const tFinish = setTimeout(() => onFinishedRef.current(), 3500);
    return () => {
      clearTimeout(tFade);
      clearTimeout(tFinish);
    };
  }, [ridotte]);

  if (ridotte) {
    return <UnifiedBootScreen identity={identity} testoSottotitolo="Preparo la schermata principale…" />;
  }

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: visibile ? 1 : 0 }}
      transition={{ duration: 0.4, ease: "easeInOut" }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3500,
        background: "var(--surface)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden"
      }}
    >
      <Stack align="center" gap="xl">
        <Box style={{ position: "relative", display: "inline-flex" }}>
          {/* Pulsing Aura */}
          <motion.div
            animate={{ scale: [1, 1.2, 1], opacity: [0.6, 0.15, 0.6] }}
            transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
            style={{
              position: "absolute",
              inset: -15,
              borderRadius: "50%",
              border: "4px solid var(--mantine-color-accent-5)"
            }}
          />

          {/* User Avatar */}
          <motion.div
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 12, delay: 0.1 }}
          >
            <Avatar
              nome={identity.nome}
              tipo={identity.avatarTipo}
              valore={identity.avatarValore}
              userId={identity.userId}
              size={120}
            />
          </motion.div>

          {/* Floating Emojis */}
          {welcomeEmojis.map((em, idx) => (
            <motion.div
              key={idx}
              initial={{ scale: 0, x: 0, y: 0, opacity: 0 }}
              animate={{ scale: 1.4, x: em.x, y: em.y, opacity: 1 }}
              transition={{
                type: "spring",
                stiffness: 90,
                damping: 10,
                delay: em.delay
              }}
              style={{
                position: "absolute",
                left: "calc(50% - 15px)",
                top: "calc(50% - 15px)",
                fontSize: 24,
                lineHeight: 1,
                pointerEvents: "none",
                userSelect: "none"
              }}
            >
              {em.char}
            </motion.div>
          ))}
        </Box>

        <Stack align="center" gap={8} style={{ textAlign: "center", paddingLeft: 20, paddingRight: 20 }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
          >
            <Text fw={900} fz={28} style={{ letterSpacing: -0.5 }}>
              Grazie di esserci, <span style={{ color: "var(--mantine-color-accent-6)" }}>{identity.nome}</span>! ❤️
            </Text>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.0, ease: "easeOut" }}
          >
            <Text fz="md" c="dimmed" fw={500}>
              Adesso è ora di lavorare... 💼👨‍⚕️📈
            </Text>
          </motion.div>
        </Stack>

        <Group gap={6} style={{ marginTop: 10 }}>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0 }}
              animate={{ y: [0, -8, 0], opacity: [0.4, 1, 0.4] }}
              transition={{ repeat: Infinity, duration: 1.0, delay: 1.2 + i * 0.18 }}
              style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--mantine-color-accent-6)" }}
            />
          ))}
        </Group>
      </Stack>
    </motion.div>
  );
}
