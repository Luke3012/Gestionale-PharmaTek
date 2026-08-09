// Selettore "Anno di lavoro": modale estetica per filtrare il giornaliero per anno.
// Funziona anche a gestionale vuoto (mostra almeno l'anno corrente).
import { useEffect, useState } from "react";
import { Box, Group, Modal, SimpleGrid, Text, ThemeIcon, ActionIcon, UnstyledButton } from "@mantine/core";
import { IconCalendarMonth, IconInfinity, IconPlus } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { api } from "../lib/tauri";
import { usePrefs } from "../lib/prefs";
import { listItem } from "../ui/motion";

export function AnnoModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { anno, setAnno } = usePrefs();
  const corrente = new Date().getFullYear();
  const [anni, setAnni] = useState<number[]>([corrente]);

  useEffect(() => {
    if (!opened) return;
    api
      .anniOrdini()
      .then((a) => {
        setAnni([...new Set(a)].sort((x, y) => y - x));
      })
      .catch(() => setAnni([]));
  }, [opened, corrente]);

  function scegli(y: number) {
    setAnno(y);
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      size="md"
      radius="lg"
      padding={0}
      transitionProps={{ transition: "fade", duration: 200 }}
      styles={{ body: { padding: 0 } }}
    >
      <Box style={{ background: "linear-gradient(135deg, #1A1A1A 0%, #2A2A2A 100%)", padding: 24, color: "#fff" }}>
        <Group gap="md" wrap="nowrap">
          <ThemeIcon size={46} radius="md" variant="filled" color="accent">
            <IconCalendarMonth size={26} />
          </ThemeIcon>
          <Box>
            <Text fw={800} fz="xl" lh={1.1}>
              Anno di lavoro
            </Text>
            <Text size="sm" style={{ color: "#A6ABB2" }}>
              Mostra solo gli ordini dell'anno scelto
            </Text>
          </Box>
          {!anni.includes(corrente) && (
            <ActionIcon
              variant="light"
              color="accent"
              size="xl"
              radius="md"
              ml="auto"
              onClick={() => scegli(corrente)}
              title={`Aggiungi anno ${corrente}`}
            >
              <IconPlus size={24} />
            </ActionIcon>
          )}
        </Group>
      </Box>

      <Box p="md">
        <CardAnno selezionato={anno === 0} onClick={() => scegli(0)} pieno>
          <Group gap="xs" justify="center">
            <IconInfinity size={20} />
            <Text fw={700}>Tutti gli anni</Text>
          </Group>
        </CardAnno>

        <SimpleGrid cols={3} spacing="sm" mt="sm">
          {anni.map((y, i) => (
            <motion.div key={y} {...listItem(i)}>
              <CardAnno selezionato={anno === y} onClick={() => scegli(y)}>
                <Text fw={800} fz="lg" lh={1.1}>
                  {y}
                </Text>
                {y === corrente && (
                  <Text size="xs" style={{ opacity: 0.7 }}>
                    corrente
                  </Text>
                )}
              </CardAnno>
            </motion.div>
          ))}
        </SimpleGrid>
      </Box>
    </Modal>
  );
}

function CardAnno({
  selezionato,
  onClick,
  pieno,
  children,
}: {
  selezionato: boolean;
  onClick: () => void;
  pieno?: boolean;
  children: React.ReactNode;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        width: pieno ? "100%" : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        padding: pieno ? "12px" : "16px 8px",
        borderRadius: 12,
        border: `2px solid ${selezionato ? "#F4C20D" : "var(--border)"}`,
        background: selezionato ? "#FFF7DD" : "#fff",
        color: "var(--text)",
        boxShadow: selezionato ? "0 0 0 3px rgba(244,194,13,.18)" : "none",
        transition: "border-color 120ms, background 120ms, box-shadow 120ms",
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (!selezionato) e.currentTarget.style.borderColor = "#cfd6df";
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (!selezionato) e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      {children}
    </UnstyledButton>
  );
}
