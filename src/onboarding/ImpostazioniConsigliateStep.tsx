import {
  Badge,
  Box,
  Group,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { motion } from "framer-motion";
import {
  IconAppWindow,
  IconArrowRight,
  IconBrandWindows,
  IconClock,
  IconSparkles,
  IconZoomIn,
} from "@tabler/icons-react";
import { useAnimazioniRidotte } from "../ui/motion";

export type ImpostazioneInizialeId = "autostart" | "zoom" | "finestra" | "solleciti";
export type ScelteImpostazioniIniziali = Record<ImpostazioneInizialeId, boolean>;

export function valoriImpostazioniIniziali(scelte: ScelteImpostazioniIniziali) {
  return {
    autostart: scelte.autostart,
    zoomUI: scelte.zoom ? 1.1 : 1,
    ordineFinestra: scelte.finestra ? "modifica" as const : "mai" as const,
    sogliaSolleciti: scelte.solleciti ? 7 : 0,
  };
}

export interface ImpostazioneConsigliataItem {
  id: ImpostazioneInizialeId;
  titolo: string;
  descrizione: string;
  valorePredefinito: string;
  valoreConsigliato: string;
  icona: typeof IconBrandWindows;
  coloreIcona: string;
}

export const LISTA_IMPOSTAZIONI_CONSIGLIATE: ImpostazioneConsigliataItem[] = [
  {
    id: "autostart",
    titolo: "Avvio automatico con Windows",
    descrizione: "Scegli se avviare PharmaTek con Windows e tenerlo pronto nella tray.",
    valorePredefinito: "Disattivato",
    valoreConsigliato: "Attivo",
    icona: IconBrandWindows,
    coloreIcona: "blue",
  },
  {
    id: "zoom",
    titolo: "Zoom interfaccia",
    descrizione: "Scegli la dimensione più comoda per testi e pulsanti.",
    valorePredefinito: "100%",
    valoreConsigliato: "110%",
    icona: IconZoomIn,
    coloreIcona: "teal",
  },
  {
    id: "finestra",
    titolo: "Finestra esterna per i documenti",
    descrizione: "Scegli come aprire ordini, preventivi e promemoria.",
    valorePredefinito: "Mai (modali)",
    valoreConsigliato: "Solo in modifica",
    icona: IconAppWindow,
    coloreIcona: "indigo",
  },
  {
    id: "solleciti",
    titolo: "Sollecito pagamenti scaduti",
    descrizione: "Scegli quando segnalare i pagamenti dopo la scadenza.",
    valorePredefinito: "Dal giorno stesso",
    valoreConsigliato: "Dopo 7 giorni",
    icona: IconClock,
    coloreIcona: "orange",
  },
];

export function ImpostazioniConsigliateStep({
  scelte,
  onScelta,
}: {
  scelte: ScelteImpostazioniIniziali;
  onScelta: (id: ImpostazioneInizialeId, consigliata: boolean) => void;
}) {
  const ridotte = useAnimazioniRidotte();
  return (
    <Stack gap="sm">
      <Box>
        <Group gap="xs" align="center">
          <ThemeIcon size={24} radius="xl" color="accent" variant="light">
            <IconSparkles size={14} />
          </ThemeIcon>
          <Text fw={700} size="lg">
            Impostazioni consigliate
          </Text>
        </Group>
        <Text size="sm" c="dimmed" mt={2}>
          Tocca il valore che preferisci per ogni voce. Le opzioni consigliate sono già selezionate.
        </Text>
      </Box>

      <Box
        style={{
          maxHeight: "calc(100vh - 280px)",
          overflowY: "auto",
          scrollbarWidth: "none",
        }}
      >
        <Stack gap={8}>
          {LISTA_IMPOSTAZIONI_CONSIGLIATE.map((item) => {
            const Icona = item.icona;
            const consigliata = scelte[item.id];
            return (
              <Paper
                key={item.id}
                withBorder
                radius="md"
                shadow="none"
                px="sm"
                py={8}
                bg="var(--mantine-color-body)"
              >
                <Group justify="space-between" align="center" wrap="nowrap" gap="md">
                  <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                    <ThemeIcon
                      size={34}
                      radius="md"
                      color={item.coloreIcona}
                      variant="light"
                      style={{ flexShrink: 0 }}
                    >
                      <Icona size={18} />
                    </ThemeIcon>
                    <Box style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600} style={{ fontSize: 14 }}>
                        {item.titolo}
                      </Text>
                      <Text size="sm" c="dimmed" style={{ fontSize: 12 }}>
                        {item.descrizione}
                      </Text>
                    </Box>
                  </Group>

                  <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }} align="center">
                    <UnstyledButton
                      aria-label={`${item.titolo}: ${item.valorePredefinito}`}
                      aria-pressed={!consigliata}
                      onClick={() => onScelta(item.id, false)}
                      style={{ borderRadius: 999 }}
                    >
                      <motion.span
                        animate={{ scale: consigliata ? 1 : 1.04, opacity: consigliata ? 0.75 : 1 }}
                        transition={{ duration: ridotte ? 0 : 0.18 }}
                        style={{ display: "inline-flex" }}
                      >
                        <Badge variant={consigliata ? "light" : "filled"} color={consigliata ? "gray" : "accent"}
                          size="sm" fw={600} style={{ textTransform: "none" }}>
                          {item.valorePredefinito}
                        </Badge>
                      </motion.span>
                    </UnstyledButton>
                    <motion.span
                      animate={{ rotate: consigliata ? 0 : 180 }}
                      transition={{ duration: ridotte ? 0 : 0.2, ease: "easeInOut" }}
                      style={{ display: "inline-flex", color: "var(--mantine-color-dimmed)", opacity: 0.7 }}
                      aria-hidden="true"
                    >
                      <IconArrowRight size={14} />
                    </motion.span>
                    <UnstyledButton
                      aria-label={`${item.titolo}: ${item.valoreConsigliato}`}
                      aria-pressed={consigliata}
                      onClick={() => onScelta(item.id, true)}
                      style={{ borderRadius: 999 }}
                    >
                      <motion.span
                        animate={{ scale: consigliata ? 1.04 : 1, opacity: consigliata ? 1 : 0.75 }}
                        transition={{ duration: ridotte ? 0 : 0.18 }}
                        style={{ display: "inline-flex" }}
                      >
                        <Badge variant={consigliata ? "filled" : "light"} color={consigliata ? "accent" : "gray"}
                          size="sm" fw={600} style={{ textTransform: "none" }}>
                          {item.valoreConsigliato}
                        </Badge>
                      </motion.span>
                    </UnstyledButton>
                  </Group>
                </Group>
              </Paper>
            );
          })}
        </Stack>
      </Box>
    </Stack>
  );
}
