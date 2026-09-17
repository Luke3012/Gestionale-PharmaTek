// Sidebar scura a 3 stati (estesa/solo-icone/nascosta). UI-SPEC §4.
import { useState } from "react";
import { Box, Group, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCalendarMonth } from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { LogoMark, Wordmark } from "../ui/Brand";
import { usePrefs } from "../lib/prefs";
import { MENU } from "./nav";
import { AnnoModal } from "./AnnoModal";

const animazioneEspansione = () => ({
  initial: { opacity: 0, width: 0 }, animate: { opacity: 1, width: "auto" },
  exit: { opacity: 0, width: 0 }, transition: { duration: 0.2, ease: "easeInOut" },
} as const);

export function Sidebar({ compatto }: { compatto: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { anno } = usePrefs();
  const [annoOpen, setAnnoOpen] = useState(false);

  const attivo = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <Box
      style={{
        width: compatto ? 60 : 220,
        background: "var(--sidebar)",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        flex: `0 0 ${compatto ? 60 : 220}px`,
        transition: "width var(--dur-base) var(--ease-inout), flex-basis var(--dur-base) var(--ease-inout)",
        overflow: "hidden",
        zIndex: 100,
      }}
    >
      <Group
        h={52}
        px={15} // 15 + 30(logo) + 15 = 60. Perfettamente centrato da chiuso, e allineato a sx da aperto.
        wrap="nowrap"
        style={{ flex: "0 0 52px", overflow: "hidden" }}
      >
        <Group gap="xs" wrap="nowrap">
          <LogoMark size={30} />
          <AnimatePresence>
            {!compatto && (
              <motion.div
                {...animazioneEspansione()}
                style={{ overflow: "hidden", whiteSpace: "nowrap" }}
              >
                <Wordmark light />
              </motion.div>
            )}
          </AnimatePresence>
        </Group>
      </Group>

      <Stack gap={4} px={8} mt="xs" style={{ flex: 1 }}>
        {MENU.map((v) => {
          const on = attivo(v.path);
          const btn = (
            <UnstyledButton
              key={v.path}
              onClick={() => navigate(v.path)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                height: 40,
                padding: "0 12px", // 12 + 20(icon) = 32. 8px padding Stack + 12 = 20. 20 + 20 + 20 = 60! Centrato.
                borderRadius: 8,
                position: "relative",
                color: on ? "#fff" : "#C9CDD2",
                background: on ? "var(--sidebar-3)" : "transparent",
                transition: "background var(--dur-xfast)",
                overflow: "hidden",
              }}
              onMouseEnter={(e) => {
                if (!on) e.currentTarget.style.background = "var(--sidebar-2)";
              }}
              onMouseLeave={(e) => {
                if (!on) e.currentTarget.style.background = "transparent";
              }}
            >
              {on && (
                <Box
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 8,
                    bottom: 8,
                    width: 3,
                    borderRadius: 3,
                    background: "var(--accent)",
                  }}
                />
              )}
              <v.Icon size={20} stroke={1.8} style={{ flexShrink: 0 }} />
              <AnimatePresence initial={false}>
                {!compatto && (
                  <motion.span
                    {...animazioneEspansione()}
                    style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", display: "inline-block" }}
                  >
                    {v.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </UnstyledButton>
          );
          return (
            <Tooltip key={v.path} label={v.label} position="right" withArrow disabled={!compatto} zIndex={1500}>
              {btn}
            </Tooltip>
          );
        })}
      </Stack>

      {/* Selettore anno di lavoro */}
      <Box p={8}>
        <Tooltip label={anno === 0 ? "Tutti gli anni" : `Anno ${anno}`} position="right" withArrow disabled={!compatto} zIndex={1500}>
          <UnstyledButton
            onClick={() => setAnnoOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              height: 44,
              padding: "0 12px", // 12 + 20 = 32. 8px outer padding. Total 20+20+20 = 60. Center aligned.
              borderRadius: 10,
              background: compatto ? "transparent" : "var(--sidebar-2)",
              color: "#fff",
              transition: "background var(--dur-xfast)",
              overflow: "hidden",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--sidebar-3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = compatto ? "transparent" : "var(--sidebar-2)";
            }}
          >
            <IconCalendarMonth size={20} color={compatto ? "#C9CDD2" : "#F4C20D"} style={{ flexShrink: 0, transition: "color var(--dur-xfast)" }} />
            <AnimatePresence initial={false}>
              {!compatto && (
                  <motion.div
                    {...animazioneEspansione()}
                    style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}
                >
                  <Text size="xs" style={{ color: "#A6ABB2", lineHeight: 1.2 }}>
                    Anno di lavoro
                  </Text>
                  <Text size="sm" fw={700} style={{ lineHeight: 1.2 }}>
                    {anno === 0 ? "Tutti gli anni" : anno}
                  </Text>
                </motion.div>
              )}
            </AnimatePresence>
          </UnstyledButton>
        </Tooltip>
      </Box>

      <AnnoModal opened={annoOpen} onClose={() => setAnnoOpen(false)} />
    </Box>
  );
}
