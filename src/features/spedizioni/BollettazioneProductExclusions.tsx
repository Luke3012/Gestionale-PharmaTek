import { useEffect, useState } from "react";
import { ActionIcon, Box, Checkbox, Group, Popover, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { bollettazioneProductGroups } from "./bollettazioneReview";
import { dur, useAnimazioniRidotte } from "../../ui/motion";

export function BollettazioneProductExclusions({ groups, excluded, onChange, opened, onOpenedChange, disabled }: {
  groups: ReturnType<typeof bollettazioneProductGroups>;
  excluded: ReadonlySet<string>;
  onChange: (value: Set<string>) => void;
  opened: boolean;
  onOpenedChange: (opened: boolean) => void;
  disabled: boolean;
}) {
  const ridotte = useAnimazioniRidotte();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => setExpanded(new Set()), [groups]);
  const toggle = (keys: string[], checked: boolean) => {
    const next = new Set(excluded);
    for (const key of keys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    onChange(next);
  };
  return (
    <Popover opened={opened} onChange={onOpenedChange} position="top-start" width={320}
      shadow="md" radius="md" withinPortal trapFocus returnFocus closeOnEscape>
      <Popover.Target>
        <Tooltip label="Scegli quali prodotti escludere da questa importazione" withArrow disabled={opened}>
          <UnstyledButton className="pt-bollettazione-exclusions-link" disabled={disabled || !groups.length}
            aria-expanded={opened} aria-haspopup="dialog" onClick={() => onOpenedChange(!opened)}>
            {excluded.size === 1 ? "1 prodotto escluso" : excluded.size ? `${excluded.size} prodotti esclusi` : "Escludi prodotti"}
          </UnstyledButton>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p="sm" role="dialog" aria-label="Prodotti da escludere"
        style={{ maxWidth: "calc(100vw - 32px)" }}
        data-mantine-stop-propagation="true"
        onFocusCapture={(event) => event.target.setAttribute("data-mantine-stop-propagation", "true")}>
        <Text size="sm" fw={600} mb="xs">Escludi prodotti</Text>
        <Stack gap="xs" style={{
          maxHeight: "min(320px, calc(100dvh - 160px))", overflowY: "auto",
          scrollbarGutter: "stable", overflowAnchor: "none",
        }}>
          {groups.map((group) => {
            const keys = group.variants.map((variant) => variant.key);
            const selected = keys.filter((key) => excluded.has(key)).length;
            const isExpanded = expanded.has(group.family);
            return (
              <Box key={group.family} style={{ flexShrink: 0 }}>
                <Group gap="xs" wrap="nowrap">
                  <Checkbox label={group.label} checked={selected === keys.length}
                    indeterminate={selected > 0 && selected < keys.length}
                    disabled={disabled} style={{ flex: 1 }}
                    onChange={(event) => toggle(keys, event.currentTarget.checked)} />
                  <ActionIcon variant="subtle" color="gray" size="sm" aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Nascondi" : "Mostra"} varianti ${group.label}`}
                    onClick={() => setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(group.family)) next.delete(group.family);
                      else next.add(group.family);
                      return next;
                    })}>
                    <IconChevronRight size={15} style={{
                      transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                      transition: ridotte ? "none" : `transform ${dur.base}s ease-out`,
                    }} />
                  </ActionIcon>
                </Group>
                {/* La griglia anima l'altezza intrinseca senza rimisurazioni quando
                    l'elenco raggiunge il limite e compare la scrollbar. */}
                <Box aria-hidden={!isExpanded} inert={!isExpanded} style={{
                  display: "grid", gridTemplateRows: isExpanded ? "1fr" : "0fr",
                  opacity: isExpanded ? 1 : 0,
                  visibility: isExpanded ? "visible" : "hidden",
                  transition: ridotte ? "none" : `grid-template-rows ${dur.base}s ease-out, opacity ${dur.base}s ease-out, visibility 0s ${isExpanded ? "0s" : `${dur.base}s`}`,
                }}>
                  <Box style={{ minHeight: 0, overflow: "hidden" }}>
                  <Stack gap={8} pt="xs" pl="md">
                    {group.variants.map((variant) => <Checkbox key={variant.key} label={variant.label}
                      checked={excluded.has(variant.key)} disabled={disabled}
                      styles={{ label: { overflowWrap: "anywhere" } }}
                      onChange={(event) => toggle([variant.key], event.currentTarget.checked)} />)}
                  </Stack>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
