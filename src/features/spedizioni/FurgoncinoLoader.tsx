// Animazione di caricamento "lazy" del riepilogo spedizione: un furgoncino con le ruote
// che girano e la strada che scorre. Rispetta reduced-motion (Framer Motion + MotionConfig
// globale): con le animazioni ridotte il furgoncino resta fermo.
import { Box, Stack, Text } from "@mantine/core";
import { motion } from "framer-motion";

function Ruota({ cx }: { cx: number }) {
  return (
    <motion.g
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, ease: "linear", duration: 0.7 }}
    >
      <circle cx={cx} cy={44} r={7.5} fill="#1A1A1A" />
      <circle cx={cx} cy={44} r={2.6} fill="#cfcfcf" />
      <rect x={cx - 0.6} y={37.5} width={1.2} height={13} fill="#cfcfcf" />
      <rect x={cx - 6.5} y={43.4} width={13} height={1.2} fill="#cfcfcf" />
    </motion.g>
  );
}

export function FurgoncinoLoader({ label = "Calcolo il riepilogo…" }: { label?: string }) {
  return (
    <Stack align="center" gap={6} py={26}>
      <motion.svg
        width={132}
        height={58}
        viewBox="0 0 132 58"
        animate={{ y: [0, -1.6, 0] }}
        transition={{ repeat: Infinity, duration: 0.5, ease: "easeInOut" }}
      >
        <rect x={12} y={14} width={66} height={26} rx={4} fill="var(--mantine-color-accent-6, #F4C20D)" />
        <path d="M78 20 h14 l11 12 v8 H78 z" fill="var(--mantine-color-accent-7, #d9ab09)" />
        <rect x={82} y={23} width={12} height={8} rx={2} fill="#bfe0ff" />
        <circle cx={34} cy={44} r={9.5} fill="#2c2c2a" />
        <circle cx={92} cy={44} r={9.5} fill="#2c2c2a" />
        <Ruota cx={34} />
        <Ruota cx={92} />
      </motion.svg>
      <Box w={150} style={{ overflow: "hidden", height: 4 }}>
        <motion.div
          style={{ display: "flex", gap: 10 }}
          animate={{ x: [0, -34] }}
          transition={{ repeat: Infinity, ease: "linear", duration: 0.4 }}
        >
          {Array.from({ length: 16 }).map((_, i) => (
            <Box key={i} w={24} h={3} style={{ borderRadius: 2, flex: "0 0 auto", background: "var(--mantine-color-gray-4)" }} />
          ))}
        </motion.div>
      </Box>
      <Text size="xs" c="dimmed" mt={4}>
        {label}
      </Text>
    </Stack>
  );
}
