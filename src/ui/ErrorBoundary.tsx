// Rete di sicurezza globale: un errore di rendering non deve mai lasciare la
// schermata bianca. Mostra un riquadro con il messaggio e un pulsante per
// riprovare (rimonta i figli) o ricaricare l'app.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Button, Card, Code, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

interface Props {
  children: ReactNode;
  onError?: (errore: Error) => void;
  onReset?: () => void;
}
interface State {
  errore: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { errore: null };

  static getDerivedStateFromError(errore: Error): State {
    return { errore };
  }

  componentDidCatch(errore: Error, info: ErrorInfo) {
    // Lasciamo traccia in console per la diagnosi (visibile in DevTools / log).
    console.error("Errore di rendering:", errore, info.componentStack);
    this.props.onError?.(errore);
  }

  riprova = () => {
    this.props.onReset?.();
    this.setState({ errore: null });
  };

  render() {
    const { errore } = this.state;
    if (!errore) return this.props.children;

    return (
      <Box style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 24 }}>
        <Card withBorder radius="md" p="lg" maw={560} w="100%">
          <Group gap="sm" mb="sm" wrap="nowrap">
            <ThemeIcon size={40} radius="xl" variant="light" color="red">
              <IconAlertTriangle size={22} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={700}>Qualcosa è andato storto</Text>
              <Text size="sm" c="dimmed">
                La schermata ha avuto un problema, ma i tuoi dati sono al sicuro.
              </Text>
            </Stack>
          </Group>
          <Code block style={{ whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto" }}>
            {errore.message || String(errore)}
          </Code>
          <Group justify="flex-end" mt="md" gap="sm">
            <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={() => location.reload()}>
              Ricarica
            </Button>
            <Button color="accent" onClick={this.riprova}>
              Riprova
            </Button>
          </Group>
        </Card>
      </Box>
    );
  }
}
