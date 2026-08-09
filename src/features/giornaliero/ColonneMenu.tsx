// Popover "Colonne": riordina (drag) e mostra/nascondi le colonne del Giornaliero.
// Drag fluido con framer-motion Reorder; la maniglia avvia il drag (lo Switch no).
import { useState } from "react";
import { Box, Button, Group, Popover, Switch, Text, Tooltip } from "@mantine/core";
import { IconColumns3, IconGripVertical, IconRefresh } from "@tabler/icons-react";
import { Reorder, useDragControls } from "framer-motion";
import { useDismissPopover } from "../../lib/closeOnScroll";
import { usePopoverVerticalLayout } from "../../ui/usePopoverVerticalLayout";

/** Forma minima richiesta dal menu (riusabile oltre il Giornaliero). */
export interface VoceColonnaMenu {
  def: { key: string; label: string };
  visibile: boolean;
}

export function ColonneMenu({
  ordineKeys,
  tutte,
  riordina,
  toggle,
  reset,
  adattivo = false,
}: {
  ordineKeys: string[];
  tutte: VoceColonnaMenu[];
  riordina: (keys: string[]) => void;
  toggle: (key: string) => void;
  reset: () => void;
  adattivo?: boolean;
}) {
  const [aperto, setAperto] = useState(false);
  const byKey = new Map(tutte.map((v) => [v.def.key, v]));

  const { targetRef, layout } = usePopoverVerticalLayout(aperto);

  useDismissPopover(aperto, setAperto);

  return (
    <Popover opened={aperto} onChange={setAperto} position={layout.position} withinPortal withArrow shadow="md" width={280} radius="md">
      <Popover.Target>
        <Tooltip label="Colonne" withArrow disabled={aperto}>
          <Button
            ref={targetRef}
            className={adattivo ? "pt-colonne-adattive" : undefined}
            variant="default"
            leftSection={<IconColumns3 size={16} />}
            onClick={() => setAperto((o) => !o)}
            style={{ flexShrink: 0 }}
          >
            <span className="pt-colonne-adattive-label">Colonne</span>
          </Button>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown
        p="xs"
        style={{ maxHeight: layout.maxHeight, display: "flex", flexDirection: "column", overflow: "hidden" }}
        onWheelCapture={(e) => e.stopPropagation()}
        onTouchMoveCapture={(e) => e.stopPropagation()}
      >
        <Group justify="space-between" mb={6} px={6} style={{ flexShrink: 0 }}>
          <Text size="sm" fw={600}>
            Colonne
          </Text>
          <Text size="xs" c="dimmed">
            trascina per ordinare
          </Text>
        </Group>

        <Box style={{ overflowY: "auto", flex: 1, minHeight: 0, overscrollBehavior: "contain" }} pr={4}>
          <Reorder.Group
            axis="y"
            values={ordineKeys}
            onReorder={riordina}
            style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}
          >
            {ordineKeys.map((k) => {
              const v = byKey.get(k);
              if (!v) return null;
              return <RigaColonna key={k} chiave={k} etichetta={v.def.label} visibile={v.visibile} toggle={toggle} />;
            })}
          </Reorder.Group>
        </Box>

        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          leftSection={<IconRefresh size={14} />}
          mt={8}
          onClick={reset}
          fullWidth
          style={{ flexShrink: 0 }}
        >
          Ripristina predefinite
        </Button>
      </Popover.Dropdown>
    </Popover>
  );
}

function RigaColonna({
  chiave,
  etichetta,
  visibile,
  toggle,
}: {
  chiave: string;
  etichetta: string;
  visibile: boolean;
  toggle: (key: string) => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={chiave} dragListener={false} dragControls={controls} style={{ listStyle: "none" }}>
      <Group
        gap="xs"
        wrap="nowrap"
        py={5}
        px={6}
        style={{ borderRadius: 8, background: visibile ? "var(--mantine-color-gray-0)" : "transparent", userSelect: "none" }}
      >
        <Box
          onPointerDown={(e) => controls.start(e)}
          style={{ cursor: "grab", display: "flex", color: "var(--mantine-color-gray-5)", touchAction: "none" }}
        >
          <IconGripVertical size={16} />
        </Box>
        <Text size="sm" style={{ flex: 1 }} c={visibile ? undefined : "dimmed"}>
          {etichetta}
        </Text>
        <Switch size="xs" color="accent" checked={visibile} onChange={() => toggle(chiave)} />
      </Group>
    </Reorder.Item>
  );
}
