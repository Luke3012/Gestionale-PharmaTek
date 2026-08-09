// Stepper «pipeline» dello stato ordine (FASE 7C): mostra le tappe Nuovo → Confermato →
// In produzione → Arrivato in Italia → Spedito → Chiuso, con quelle già percorse colorate e
// un anello che **scorre** sulla tappa attiva quando l'ordine avanza (layoutId di Framer →
// si "muove" da una tappa all'altra). Le tappe sono cliccabili per impostare lo stato.
// «Rifiutato» è fuori pipeline (nessuna tappa accesa). Rispetta «Riduci animazioni».
import { Fragment, useEffect, useState } from "react";
import { Box, Group, ThemeIcon, Tooltip, UnstyledButton } from "@mantine/core";
import { motion } from "framer-motion";
import { STATI_ORDINE } from "./stati";
import { useAnimazioniRidotte } from "../../ui/motion";

const PIPELINE = STATI_ORDINE.filter((s) => s.value !== "Rifiutato");

export function PipelineStato({
  stato,
  onSel,
  disabled = false,
}: {
  stato: string;
  /** Se presente, le tappe sono cliccabili e impostano lo stato. */
  onSel?: (v: string) => void;
  disabled?: boolean;
}) {
  const ridotte = useAnimazioniRidotte();
  const idx = PIPELINE.findIndex((s) => s.value === stato);
  const colore = idx >= 0 ? PIPELINE[idx].color : "gray";
  const cliccabile = !!onSel && !disabled;

  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  return (
    <Group gap={4} wrap="nowrap" align="center">
      {PIPELINE.map((s, i) => {
        const fatto = idx >= 0 && i <= idx;
        const attivo = i === idx;
        return (
          <Fragment key={s.value}>
            {i > 0 && (
              <Box
                style={{
                  flex: 1,
                  height: 2,
                  borderRadius: 2,
                  background: fatto ? `var(--mantine-color-${colore}-4)` : "var(--mantine-color-gray-3)",
                  transition: "background 240ms ease",
                }}
              />
            )}
            <Tooltip label={s.label} withArrow>
              <UnstyledButton
                onClick={cliccabile ? () => onSel!(s.value) : undefined}
                style={{
                  position: "relative",
                  lineHeight: 0,
                  flexShrink: 0,
                  cursor: cliccabile ? "pointer" : "default",
                }}
                aria-label={s.label}
              >
                {attivo && !ridotte && (
                  <motion.div
                    layoutId="pipeline-anello"
                    transition={ready ? { type: "spring", stiffness: 420, damping: 32 } : { duration: 0 }}
                    style={{
                      position: "absolute",
                      inset: -3,
                      borderRadius: "50%",
                      border: `2px solid var(--mantine-color-${colore}-6)`,
                    }}
                  />
                )}
                <ThemeIcon
                  size={28}
                  radius="xl"
                  variant={attivo ? "filled" : fatto ? "light" : "default"}
                  color={fatto || attivo ? s.color : "gray"}
                >
                  <s.Ico size={15} />
                </ThemeIcon>
              </UnstyledButton>
            </Tooltip>
          </Fragment>
        );
      })}
    </Group>
  );
}
