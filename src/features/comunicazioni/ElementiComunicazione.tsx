import type { ReactNode } from "react";
import { Box, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconSend } from "@tabler/icons-react";

export function TitoloNuovaComunicazione() {
  return (
    <Group gap="sm">
      <ThemeIcon variant="light" color="yellow" radius="md">
        <IconSend size={18} />
      </ThemeIcon>
      <Text fw={700}>Nuova comunicazione</Text>
    </Group>
  );
}

interface IntestazioneComunicazioneStandaloneProps {
  titolo: ReactNode;
  sottotitolo: ReactNode;
  conMargine?: boolean;
  troncaSottotitolo?: boolean;
}

export function IntestazioneComunicazioneStandalone({
  titolo, sottotitolo, conMargine = false, troncaSottotitolo = false,
}: IntestazioneComunicazioneStandaloneProps) {
  return (
    <Group gap="sm" mb={conMargine ? "lg" : undefined} wrap="nowrap">
      <ThemeIcon variant="light" color="yellow" radius="md" size="lg">
        <IconSend size={19} />
      </ThemeIcon>
      <Box style={{ minWidth: 0 }}>
        <Text fw={800} size="lg">{titolo}</Text>
        <Text size="sm" c="dimmed" truncate={troncaSottotitolo || undefined}>{sottotitolo}</Text>
      </Box>
    </Group>
  );
}

export function ContenitoreComunicazioneStandalone({ children }: { children: ReactNode }) {
  return (
    <Box p="lg" style={{ height: "100vh", overflow: "hidden", background: "var(--mantine-color-body)" }}>
      {children}
    </Box>
  );
}

/** Legge il payload JSON condiviso dalle finestre comunicazione senza propagare dati corrotti. */
export function leggiPayloadComunicazione<T>(search = window.location.search): T | null {
  const payload = new URLSearchParams(search).get("payload");
  try {
    return payload ? (JSON.parse(payload) as T) : null;
  } catch {
    return null;
  }
}

export function ComunicazioneNonDisponibile() {
  return (
    <Stack align="center" justify="center" h="100vh" p="xl" ta="center">
      <Text fw={700}>Comunicazione non disponibile</Text>
      <Text c="dimmed" size="sm">
        Chiudi questa finestra e riapri la comunicazione dal gestionale.
      </Text>
    </Stack>
  );
}
