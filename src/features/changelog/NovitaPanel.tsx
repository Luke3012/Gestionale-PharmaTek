// Pannello «Novità» mostrato all'avvio dopo un aggiornamento, PRIMA di entrare nella
// dashboard (così precede l'intro animata). Compare una sola volta per versione (vedi
// changelog.ts / il gate in App.tsx). Animazione a comparsa con stagger delle voci.
import { useEffect } from "react";
import { Box, Button, Center, Group, Portal, Stack, Text, ThemeIcon } from "@mantine/core";
import { motion } from "framer-motion";
import { LogoMark, Wordmark } from "../../ui/Brand";
import { type VersioneChangelog } from "./changelog";
import { CATEGORIE, dataEstesa, vociPerCategoria } from "./categorie";

export function NovitaPanel({
  entries,
  onChiudi,
}: {
  entries: VersioneChangelog[];
  onChiudi: () => void;
}) {
  // Le entries sono ordinate decrescente (più recente prima).
  const latest = entries[0];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        onChiudi();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onChiudi]);

  return (
    <Portal>
      <Box
        data-pt-blocking-view="changelog"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background:
            "radial-gradient(120% 90% at 50% -10%, var(--mantine-color-accent-0, #eef2ff) 0%, var(--surface, #fff) 60%)",
          overflow: "auto",
        }}
      >
      <Center p="xl" style={{ minHeight: "100vh" }}>
        <Stack gap="xl" style={{ width: "100%", maxWidth: 560, paddingBottom: 40, paddingTop: 40 }}>
          {/* Header Principale */}
          <Stack gap={6} align="center" ta="center">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 18 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "var(--surface, #fff)",
                border: "1px solid var(--mantine-color-gray-2)",
                padding: "8px 20px",
                borderRadius: 16,
                boxShadow: "0 6px 20px rgba(0,0,0,0.02)"
              }}
            >
              <LogoMark size={28} />
              <Wordmark />
            </motion.div>
            <Text fw={750} c="accent" tt="uppercase" fz={12} mt="xs" style={{ letterSpacing: 1.5 }}>
              Novità
            </Text>
            <Text fw={800} fz={28} lh={1.1}>
              {entries.length === 1
                ? `Versione ${latest.versione}`
                : `Aggiornato alla versione ${latest.versione}`}
            </Text>
            {entries.length > 1 && (
              <Text c="dimmed" fz="sm" maw={440}>
                Ecco cosa è cambiato dall'ultimo avvio (versioni: {entries.map((e) => e.versione).join(" · ")}):
              </Text>
            )}
          </Stack>

          {/* Lista delle versioni non viste */}
          <Stack gap="xl">
            {entries.map((entry, idx) => {
              return (
                <motion.div
                  key={entry.versione}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ type: "spring", stiffness: 120, damping: 20, delay: idx === 0 ? 0.1 : 0 }}
                  style={{ width: "100%" }}
                >
                  <Stack
                    gap="xs"
                    p="md"
                    style={{
                      background: "var(--surface, #fff)",
                      border: "1px solid var(--mantine-color-gray-2)",
                      borderRadius: 16,
                      boxShadow: "0 6px 22px rgba(0,0,0,0.02)",
                    }}
                  >
                    {/* Intestazione Versione */}
                    <Group justify="space-between" align="baseline" px="xs" mb={4}>
                      <Text fw={800} fz="lg">
                        v{entry.versione}
                      </Text>
                      <Text c="dimmed" fz="xs">
                        {dataEstesa(entry.data)}
                      </Text>
                    </Group>
                    {entry.sintesi && (
                      <Text c="dimmed" fz="sm" px="xs" mb={entry.voci.length > 0 ? 4 : 0}>
                        {entry.sintesi}
                      </Text>
                    )}

                    <Stack gap="md" px="xs">
                      {vociPerCategoria(entry.voci).map((gruppo) => {
                        const meta = CATEGORIE[gruppo.categoria];
                        return (
                          <Stack key={gruppo.categoria} gap={8}>
                            <Group gap={8} wrap="nowrap">
                              <ThemeIcon variant="light" color={meta.color} radius="xl" size={28} style={{ flex: "0 0 auto" }}>
                                <meta.Ico size={16} />
                              </ThemeIcon>
                              <Text fw={750} fz="sm">
                                {meta.label}
                              </Text>
                              <Box style={{ height: 1, flex: 1, background: "var(--mantine-color-gray-2)" }} />
                            </Group>
                            <Stack gap={7} pl={36}>
                              {gruppo.voci.map((v, i) => (
                                <Group key={i} gap={9} wrap="nowrap" align="flex-start">
                                  <Box
                                    mt={9}
                                    style={{
                                      width: 5,
                                      height: 5,
                                      borderRadius: "50%",
                                      background: `var(--mantine-color-${meta.color}-5, var(--mantine-color-accent-5))`,
                                      flex: "0 0 auto",
                                    }}
                                  />
                                  <Text fz="sm" lh={1.45}>
                                    {v.testo}
                                  </Text>
                                </Group>
                              ))}
                            </Stack>
                          </Stack>
                        );
                      })}
                    </Stack>
                  </Stack>
                </motion.div>
              );
            })}
          </Stack>

          <Center mt="md">
            <Button size="md" radius="xl" color="accent" onClick={onChiudi} px={40}>
              Inizia
            </Button>
          </Center>
        </Stack>
      </Center>
    </Box>
    </Portal>
  );
}
