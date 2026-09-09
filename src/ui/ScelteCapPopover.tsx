import { Button, Popover, Stack, Text } from "@mantine/core";
import type { ComuneInfo } from "../lib/cap-lookup";

interface ScelteCapPopoverProps {
  capCittaMultiplo: ComuneInfo | null;
  capAmbiguo: ComuneInfo[] | null;
  onScegli: (comune: ComuneInfo, opzioni?: { capSelezionato?: string }) => void;
  proteggiEscape?: boolean;
}

function marcaFocusPopover(event: React.FocusEvent<HTMLElement>) {
  (event.target as HTMLElement | null)?.setAttribute?.("data-mantine-stop-propagation", "true");
}

/** Elenco condiviso per scegliere un comune ambiguo o uno dei CAP della città. */
export function ScelteCapPopover({
  capCittaMultiplo, capAmbiguo, onScegli, proteggiEscape = false,
}: ScelteCapPopoverProps) {
  return (
    <Popover.Dropdown
      p="xs"
      data-mantine-stop-propagation="true"
      onFocusCapture={proteggiEscape ? marcaFocusPopover : undefined}
    >
      <Text size="xs" fw={600} c="dimmed" mb={4}>
        {capCittaMultiplo ? `Più CAP per ${capCittaMultiplo.nome}:` : "Più comuni per questo CAP:"}
      </Text>
      <Stack gap={2}>
        {capCittaMultiplo
          ? capCittaMultiplo.cap.map((cap) => (
              <Button key={cap} variant="subtle" size="xs" justify="flex-start" fullWidth
                onClick={() => onScegli(capCittaMultiplo, { capSelezionato: cap })}>
                {cap} — {capCittaMultiplo.nome} ({capCittaMultiplo.sigla})
              </Button>
            ))
          : capAmbiguo?.map((comune) => (
              <Button key={comune.nome} variant="subtle" size="xs" justify="flex-start" fullWidth
                onClick={() => onScegli(comune)}>
                {comune.nome} ({comune.sigla}) — {comune.regione}
              </Button>
            ))}
      </Stack>
    </Popover.Dropdown>
  );
}
