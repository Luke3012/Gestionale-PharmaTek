import { Box, Group, SegmentedControl, ThemeIcon, Tooltip } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { usePrefs } from "../../lib/prefs";
import { dialog } from "../../ui/dialog/store";
import { CATEGORIE_PRODOTTO, categoriaDef } from "../anagrafiche/categorie";

export const CATEGORIA_DEFAULT = "Immunoterapia";

export function IconaCategoria({ categoria, grande }: { categoria: string; grande?: boolean }) {
  const { color, Ico } = categoriaDef(categoria);
  if (grande) {
    return (
      <ThemeIcon variant="light" color={color} size={38} radius="md">
        <Ico size={24} />
      </ThemeIcon>
    );
  }
  return <Ico size={12} />;
}

/** Switch della linea disponibile esclusivamente durante la creazione di un ordine. */
export function SelettoreCategoriaNuovoOrdine({
  value,
  onChange,
  haContenuto = false,
  tipo = "ordine",
}: {
  value: string;
  onChange: (categoria: string) => void;
  haContenuto?: boolean;
  tipo?: "ordine" | "preventivo";
}) {
  const { ridurreAnimazioni } = usePrefs();
  const cambia = async (categoria: string) => {
    if (categoria === value) return;
    if (
      haContenuto &&
      !(await dialog.confirm(
        `Cambiare linea del nuovo ${tipo}?`,
        "I prodotti e le impostazioni collegate alla linea già inseriti verranno azzerati.",
        { conferma: "Cambia e azzera", annulla: "Annulla" },
      ))
    ) {
      return;
    }
    onChange(categoria);
  };

  return (
    <Tooltip label={`Scegli la linea del nuovo ${tipo}`} withArrow>
      <Box>
        <SegmentedControl
          size="xs"
          radius="xl"
          value={value}
          onChange={(categoria) => void cambia(categoria)}
          aria-label={`Linea del nuovo ${tipo}`}
          styles={{
            root: {
              padding: 4,
              background: "var(--mantine-color-gray-1)",
              border: "1px solid var(--mantine-color-gray-2)",
            },
            indicator: { display: "none" },
            label: { padding: 0 },
          }}
          data={CATEGORIE_PRODOTTO.map((categoria) => {
            const selezionata = categoria.value === value;
            return {
              value: categoria.value,
              label: (
                <Group
                  gap={6}
                  wrap="nowrap"
                  px={11}
                  py={6}
                  style={{
                    borderRadius: 999,
                    color: selezionata
                      ? "var(--mantine-color-white)"
                      : "var(--mantine-color-gray-7)",
                    background: selezionata
                      ? `var(--mantine-color-${categoria.color}-6)`
                      : "transparent",
                    boxShadow: selezionata
                      ? `0 3px 10px color-mix(in srgb, var(--mantine-color-${categoria.color}-6) 38%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--mantine-color-white) 24%, transparent)`
                      : "none",
                    opacity: selezionata ? 1 : 0.78,
                    transform: selezionata ? "scale(1)" : "scale(0.98)",
                    transition: ridurreAnimazioni
                      ? "none"
                      : "background-color 160ms ease, color 160ms ease, box-shadow 160ms ease, opacity 160ms ease, transform 160ms ease",
                  }}
                >
                  <categoria.Ico
                    size={14}
                    stroke={2.2}
                    style={
                      selezionata
                        ? undefined
                        : { color: `var(--mantine-color-${categoria.color}-6)` }
                    }
                  />
                  <span style={{ fontWeight: selezionata ? 800 : 600 }}>{categoria.label}</span>
                  {selezionata && <IconCheck size={13} stroke={3} aria-hidden />}
                </Group>
              ),
            };
          })}
        />
      </Box>
    </Tooltip>
  );
}
