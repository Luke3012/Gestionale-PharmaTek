// Storico changelog: timeline verticale dalla versione più recente alla prima.
// Usato nella finestra Info. Le voci sono raggruppate per categoria con icone colorate.
import { Badge, Box, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { motion } from "framer-motion";
import { VERSIONI } from "./changelog";
import { CATEGORIE, dataEstesa, vociPerCategoria } from "./categorie";

export function StoricoChangelog({ versioneCorrente }: { versioneCorrente?: string }) {
  return (
    <motion.div
      initial="nascosto"
      animate="visibile"
      variants={{
        nascosto: {},
        visibile: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
      }}
    >
      <Stack gap={0}>
        {VERSIONI.map((v, idx) => {
          const ultima = idx === VERSIONI.length - 1;
          const corrente = v.versione === versioneCorrente;

          return (
            <motion.div
              key={v.versione}
              variants={{
                nascosto: { opacity: 0, y: 12 },
                visibile: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 320, damping: 28 } },
              }}
            >
              <Group align="flex-start" gap="md" wrap="nowrap">
                {/* Binario della timeline: pallino + linea verticale. */}
                <Stack gap={0} align="center" style={{ flex: "0 0 auto", alignSelf: "stretch" }}>
                  <Box
                    mt={4}
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: corrente
                        ? "var(--mantine-color-accent-6)"
                        : "var(--mantine-color-gray-4)",
                      boxShadow: corrente ? "0 0 0 4px var(--mantine-color-accent-1)" : "none",
                    }}
                  />
                  {!ultima && (
                    <Box style={{ width: 2, flex: 1, background: "var(--mantine-color-gray-2)", marginTop: 4 }} />
                  )}
                </Stack>

                <Box pb="lg" style={{ flex: 1, minWidth: 0 }}>
                  <Group gap="xs" mb={4} align="center">
                    <Text fw={800} fz="md">
                      {v.versione}
                    </Text>
                    {corrente && (
                      <Badge size="xs" variant="light" color="accent">
                        in uso
                      </Badge>
                    )}
                    <Text c="dimmed" fz="xs">
                      · {dataEstesa(v.data)}
                    </Text>
                  </Group>
                  {v.sintesi && (
                    <Text c="dimmed" fz="sm" mb={v.voci.length > 0 ? "xs" : 0}>
                      {v.sintesi}
                    </Text>
                  )}

                  <Stack gap="sm">
                    {vociPerCategoria(v.voci).map((gruppo) => {
                      const meta = CATEGORIE[gruppo.categoria];
                      return (
                        <Stack key={gruppo.categoria} gap={6}>
                          <Group gap={7} wrap="nowrap">
                            <ThemeIcon variant="light" color={meta.color} radius="xl" size={22} style={{ flex: "0 0 auto" }}>
                              <meta.Ico size={13} />
                            </ThemeIcon>
                            <Text fw={700} fz="xs" c="dimmed" tt="uppercase">
                              {meta.label}
                            </Text>
                            <Box style={{ height: 1, flex: 1, background: "var(--mantine-color-gray-2)" }} />
                          </Group>
                          <Stack gap={5} pl={28}>
                            {gruppo.voci.map((voce, i) => (
                              <Group key={i} gap={8} wrap="nowrap" align="flex-start">
                                <Box
                                  mt={8}
                                  style={{
                                    width: 4,
                                    height: 4,
                                    borderRadius: "50%",
                                    background: "var(--mantine-color-gray-5)",
                                    flex: "0 0 auto",
                                  }}
                                />
                                <Text fz="sm" lh={1.4}>
                                  {voce.testo}
                                </Text>
                              </Group>
                            ))}
                          </Stack>
                        </Stack>
                      );
                    })}
                  </Stack>
                </Box>
              </Group>
            </motion.div>
          );
        })}
      </Stack>
    </motion.div>
  );
}
