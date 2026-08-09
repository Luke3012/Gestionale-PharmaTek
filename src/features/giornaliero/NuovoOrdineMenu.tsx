// Pulsante "Nuovo ordine" come split-button per categoria (FASE 4D).
// Il click principale crea un ordine Immunoterapia (lo "standard", percorso veloce);
// il chevron — oppure il semplice hover — fa scendere DA SOTTO il pulsante le altre
// due categorie (Diagnostica, Keriba). Animazione slide+stagger (non un fade),
// rispettosa di "riduci animazioni" via MotionConfig globale.
import { useRef, useState } from "react";
import { Box, Button, Paper, Stack } from "@mantine/core";
import { IconChevronDown, IconPlus } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { CATEGORIE_PRODOTTO } from "../anagrafiche/categorie";
import { CATEGORIA_DEFAULT } from "./categoriaOrdine";
import { dur, easeOut } from "../../ui/motion";

// Le categorie "extra" che scendono da sotto (lo standard resta il bottone grande).
const ALTRE = CATEGORIE_PRODOTTO.filter((c) => c.value !== CATEGORIA_DEFAULT);

export function NuovoOrdineMenu({ onNuovo }: { onNuovo: (categoria: string) => void }) {
  const [aperto, setAperto] = useState(false);
  const chiudiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apri = () => {
    if (chiudiTimer.current) clearTimeout(chiudiTimer.current);
    setAperto(true);
  };
  // Chiusura "morbida" all'uscita del mouse: piccola tolleranza per raggiungere i bottoni.
  const chiudiSoft = () => {
    if (chiudiTimer.current) clearTimeout(chiudiTimer.current);
    chiudiTimer.current = setTimeout(() => setAperto(false), 180);
  };

  const scegli = (categoria: string) => {
    setAperto(false);
    onNuovo(categoria);
  };

  return (
    <Box style={{ position: "relative", display: "inline-block" }} onMouseEnter={apri} onMouseLeave={chiudiSoft}>
      <Button.Group>
        <Button color="accent" leftSection={<IconPlus size={18} />} onClick={() => scegli(CATEGORIA_DEFAULT)}>
          Nuovo ordine
        </Button>
        <Button
          color="accent"
          px={8}
          aria-label="Altre categorie di ordine"
          onClick={() => setAperto((o) => !o)}
        >
          <IconChevronDown
            size={16}
            style={{ transform: aperto ? "rotate(180deg)" : "none", transition: "transform .18s ease" }}
          />
        </Button>
      </Button.Group>

      <AnimatePresence>
        {aperto && (
          <Box style={{ position: "absolute", top: "100%", left: 0, right: 0, paddingTop: 6, zIndex: 30 }}>
            <Stack gap={6}>
              {ALTRE.map((c, i) => (
                <motion.div
                  key={c.value}
                  // Parte "nascosta" dietro/sotto il pulsante e scende in posizione.
                  initial={{ opacity: 0, y: -12 - i * 6, scale: 0.96 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    transition: { duration: dur.base, ease: easeOut, delay: i * 0.05 },
                  }}
                  exit={{ opacity: 0, y: -8, scale: 0.96, transition: { duration: dur.fast, ease: easeOut } }}
                >
                  {/* Paper = superficie opaca con ombra: i bottoni non "spariscono" sopra la tabella. */}
                  <Paper shadow="md" radius="md" withBorder p={0} style={{ overflow: "hidden" }}>
                    <Button
                      fullWidth
                      size="sm"
                      variant="light"
                      color={c.color}
                      leftSection={<c.Ico size={16} />}
                      onClick={() => scegli(c.value)}
                      styles={{ root: { border: "none" } }}
                    >
                      {c.label}
                    </Button>
                  </Paper>
                </motion.div>
              ))}
            </Stack>
          </Box>
        )}
      </AnimatePresence>
    </Box>
  );
}
