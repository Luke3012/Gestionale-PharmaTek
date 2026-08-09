import { useEffect, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { ActionIcon, Box, Group, Stack, Text } from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAnimazioniRidotte } from "./motion";

interface CompletamentoFlourishProps {
  attivo: boolean;
  onFine: () => void;
  azione?: ReactNode;
  Icona: ComponentType<{ size?: number | string }>;
  titolo: string;
  descrizione: ReactNode;
  timbro: string;
}

/**
 * Feedback condiviso per il completamento di un'operazione.
 *
 * Senza un'azione si chiude automaticamente; con un'azione diventa una card
 * modale e resta aperto finché l'utente non sceglie o lo chiude. Con le
 * animazioni ridotte il feedback puramente decorativo non viene montato, mentre
 * la richiesta interattiva resta disponibile in forma statica.
 */
export function CompletamentoFlourish({
  attivo,
  onFine,
  azione,
  Icona,
  titolo,
  descrizione,
  timbro,
}: CompletamentoFlourishProps) {
  const ridotte = useAnimazioniRidotte();
  const interattivo = !!azione;

  useEffect(() => {
    if (!attivo || interattivo) return;
    const timer = window.setTimeout(onFine, ridotte ? 0 : 1500);
    return () => window.clearTimeout(timer);
  }, [attivo, onFine, ridotte, interattivo]);

  useEffect(() => {
    if (!attivo || !interattivo) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFine();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [attivo, interattivo, onFine]);

  const contenuto = (
    <>
      <Group gap={12} wrap="nowrap" align="center">
        <motion.div
          animate={ridotte ? undefined : { x: [0, 4, 0] }}
          transition={ridotte ? undefined : { repeat: Infinity, duration: 0.6, ease: "easeInOut" }}
          style={{ color: "var(--mantine-color-accent-7, #d9ab09)", display: "flex" }}
        >
          <Icona size={30} />
        </motion.div>
        <motion.div
          initial={ridotte ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={ridotte ? undefined : { delay: 0.14, type: "spring", stiffness: 520, damping: 18 }}
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: "var(--mantine-color-teal-6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <IconCheck size={20} color="#fff" stroke={3} />
        </motion.div>
        <Text fw={700} fz={18}>
          {titolo}
        </Text>
        {interattivo && (
          <ActionIcon variant="subtle" color="gray" radius="xl" onClick={onFine} aria-label="Chiudi" ml="auto">
            <IconX size={16} />
          </ActionIcon>
        )}
      </Group>
      {interattivo && (
        <Stack gap={8} mt={4}>
          <Text size="sm" c="dimmed">
            {descrizione}
          </Text>
          <Group justify="flex-end">{azione}</Group>
        </Stack>
      )}
      {!ridotte && (
        <motion.div
          initial={{ scale: 2.6, rotate: -28, opacity: 0 }}
          animate={{ scale: [2.6, 1, 1, 1.1], rotate: [-28, -13, -13, -13], opacity: [0, 0.85, 0.85, 0] }}
          transition={{ duration: 1.5, times: [0, 0.16, 0.66, 1], ease: "easeOut", delay: 0.15 }}
          style={{
            position: "absolute",
            top: 4,
            left: 2,
            pointerEvents: "none",
            border: "2px solid var(--mantine-color-teal-7)",
            color: "var(--mantine-color-teal-7)",
            borderRadius: 6,
            padding: "0 6px",
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: 1.5,
          }}
        >
          {timbro}
        </motion.div>
      )}
    </>
  );

  const stileCard: CSSProperties = {
    position: "relative",
    pointerEvents: "auto",
    minWidth: interattivo ? 320 : undefined,
    maxWidth: 420,
    padding: interattivo ? "16px 18px" : "12px 22px",
    borderRadius: 18,
    background: "var(--surface)",
    boxShadow: "var(--mantine-shadow-lg)",
    border: "1px solid var(--mantine-color-gray-2)",
  };

  if (ridotte) {
    if (!interattivo) return null;
    return (
      <Box style={overlayStyle} onClick={onFine}>
        <Box style={stileCard} onClick={(event) => event.stopPropagation()}>
          {contenuto}
        </Box>
      </Box>
    );
  }

  return (
    <AnimatePresence>
      {attivo && (
        <motion.div
          key="spedito"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={overlayStyle}
          onClick={onFine}
        >
          <motion.div
            initial={{ scale: 0.82, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 22 }}
            style={stileCard}
            onClick={(event) => event.stopPropagation()}
          >
            {contenuto}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0, 0, 0, 0.4)",
  pointerEvents: "auto",
  zIndex: 1500,
};
