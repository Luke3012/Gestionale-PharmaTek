// Finestra «Cestino» (FASE 6D) — aperta dallo Spotlight. Riusa l'hook + la lista
// del pop-over Cestino (`CestinoContenuto`). Piccola finestra a sé, sempre richiamabile.
import { useEffect, useState } from "react";
import { Box, Group, Text, ThemeIcon } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useRicordaGeometria } from "../lib/geometriaFinestre";
import { CestinoContenuto, useCestino } from "./CestinoContenuto";

export function CestinoWindow() {
  const { items, ripristina, elimina, svuota, svuotando } = useCestino();
  useRicordaGeometria("cestino");
  // L'altezza della lista segue la finestra (poche righe → niente vuoto enorme).
  const [maxH, setMaxH] = useState(() => Math.max(160, window.innerHeight - 96));
  useEffect(() => {
    const onResize = () => setMaxH(Math.max(160, window.innerHeight - 96));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <Box style={{ height: "100vh", background: "var(--surface)", display: "flex", flexDirection: "column" }}>
      <Group p="md" gap="sm" wrap="nowrap" style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <ThemeIcon size={38} radius="md" variant="light" color="gray">
          <IconTrash size={20} />
        </ThemeIcon>
        <Box style={{ minWidth: 0 }}>
          <Text fw={700}>Cestino</Text>
          <Text size="xs" c="dimmed">
            Ripristina o elimina definitivamente
          </Text>
        </Box>
      </Group>
      <Box style={{ flex: 1, overflow: "auto", padding: 12 }}>
        <CestinoContenuto
          items={items}
          ripristina={ripristina}
          elimina={elimina}
          svuota={svuota}
          svuotando={svuotando}
          altezzaMax={maxH}
        />
      </Box>
    </Box>
  );
}
