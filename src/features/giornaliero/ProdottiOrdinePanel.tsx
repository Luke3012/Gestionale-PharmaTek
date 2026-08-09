import { useMemo, type CSSProperties, type RefObject } from "react";
import {
  ActionIcon,
  Autocomplete,
  Badge,
  Box,
  Button,
  Collapse,
  Divider,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconFlask2,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { NumeriLottoInput } from "../../ui/NumeriLottoInput";
import { useAnimazioniRidotte } from "../../ui/motion";
import { tabCompleta } from "../../ui/tabCompleta";
import { ML_COMUNI, type Suggerimenti } from "../produzione/datiProduzione";
import type { RigaForm } from "./righeOrdine";

interface ProdottiOrdinePanelProps {
  containerRef: RefObject<HTMLDivElement | null>;
  titolo?: string;
  /** Nel Giornaliero usa sempre “prodotto”; altri flussi possono conservare
   * la terminologia specialistica già adottata. */
  terminologiaProdotto?: boolean;
  righe: RigaForm[];
  isAllergene: boolean;
  isDiagnostica: boolean;
  isImmunoterapia: boolean;
  evidenziato: boolean;
  attentionStyle: CSSProperties;
  nomiProdotti: string[];
  nomiAllergeni: string[];
  tipiTest: string[];
  suggerimentiProduzione: Suggerimenti;
  datiProduzioneAperti: Set<string>;
  disabled?: boolean;
  prezziDisabilitati?: boolean;
  onDigitaProdotto: (key: string, nome: string) => void;
  onScegliProdotto: (key: string, nome: string) => void;
  onAggiornaRiga: (key: string, patch: Partial<RigaForm>) => void;
  onToggleDatiProduzione: (key: string) => void;
  onRimuoviRiga: (key: string) => void;
  onAggiungiRiga: () => void;
}

export function ProdottiOrdinePanel({
  containerRef,
  titolo,
  terminologiaProdotto = false,
  righe,
  isAllergene,
  isDiagnostica,
  isImmunoterapia,
  evidenziato,
  attentionStyle,
  nomiProdotti,
  nomiAllergeni,
  tipiTest,
  suggerimentiProduzione,
  datiProduzioneAperti,
  disabled = false,
  prezziDisabilitati = false,
  onDigitaProdotto,
  onScegliProdotto,
  onAggiornaRiga,
  onToggleDatiProduzione,
  onRimuoviRiga,
  onAggiungiRiga,
}: ProdottiOrdinePanelProps) {
  const animazioniRidotte = useAnimazioniRidotte();
  const suggerimentiNomi = isDiagnostica ? nomiAllergeni : nomiProdotti;
  const nomeVoce = terminologiaProdotto ? "Prodotto" : "Preparazione";
  const nomeVoceMinuscolo = nomeVoce.toLocaleLowerCase("it");
  const strutturaRighe = useMemo(
    () => righe.map((riga) => riga.key).join("|"),
    [righe],
  );
  const listaEstesa = righe.length >= 8;

  return (
    <Box
      ref={containerRef}
      style={{
        borderRadius: "var(--mantine-radius-md)",
        paddingBlock: terminologiaProdotto ? 4 : 0,
      }}
    >
      <Group
        justify="space-between"
        align="center"
        mb={terminologiaProdotto ? "sm" : "xs"}
      >
        <Group gap="xs">
          <Text size="sm" fw={700}>
            {titolo ??
              (isDiagnostica ? "Composizione diagnostica" : "Composizione")}
          </Text>
          <Badge size="sm" variant="light" color="gray">
            {righe.length} {righe.length === 1 ? "voce" : "voci"}
          </Badge>
        </Group>
      </Group>

      <Stack gap={terminologiaProdotto ? "md" : "sm"}>
        <AnimatePresence initial={false}>
          {righe.map((riga, indice) => {
            const dettagliAperti =
              isImmunoterapia && datiProduzioneAperti.has(riga.key);
            const dettagliCompilati =
              !!riga.formulazione.trim() ||
              !!riga.posologia.trim() ||
              !!riga.numero.trim() ||
              riga.allergeni.length > 0;

            return (
              <motion.div
                key={riga.key}
                layout={animazioniRidotte ? false : "position"}
                layoutDependency={strutturaRighe}
                initial={false}
                animate={{ opacity: 1, x: 0, height: "auto" }}
                exit={
                  animazioniRidotte
                    ? {
                        opacity: 0,
                        height: 0,
                        transition: { duration: 0 },
                      }
                    : {
                        opacity: 0,
                        x: 14,
                        height: 0,
                        transition: {
                          opacity: { duration: 0.12, ease: "easeOut" },
                          x: { duration: 0.15, ease: [0.2, 0.8, 0.2, 1] },
                          height: {
                            duration: 0.16,
                            delay: 0.1,
                            ease: [0.2, 0.8, 0.2, 1],
                          },
                        },
                      }
                }
                transition={{
                  layout: animazioniRidotte
                    ? { duration: 0 }
                    : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] },
                }}
                className="pt-product-card-shell"
                data-lista-estesa={listaEstesa || undefined}
                style={{ overflow: "hidden", width: "100%" }}
              >
                <Paper
                  data-pt-row={riga.key}
                  withBorder
                  radius="md"
                  className="pt-product-card"
                >
              <Group
                justify="space-between"
                align="center"
                px={terminologiaProdotto ? "md" : "sm"}
                py={terminologiaProdotto ? 10 : 8}
                className="pt-product-card-header"
              >
                <Group gap="xs">
                  <ThemeIcon
                    size={25}
                    radius="xl"
                    color="yellow"
                    variant="light"
                  >
                    <Text size="xs" fw={800}>
                      {indice + 1}
                    </Text>
                  </ThemeIcon>
                  <Text size="sm" fw={700}>
                    {isDiagnostica ? "Voce diagnostica" : nomeVoce}{" "}
                    {indice + 1}
                  </Text>
                </Group>
                <Group gap={5} wrap="nowrap">
                  {isImmunoterapia && (
                    <Button
                      variant={dettagliAperti ? "light" : "subtle"}
                      color={dettagliCompilati ? "blue" : "gray"}
                      styles={
                        dettagliCompilati
                          ? {
                              label: {
                                color: "var(--mantine-color-blue-7)",
                              },
                              section: {
                                color: "var(--mantine-color-blue-7)",
                              },
                            }
                          : undefined
                      }
                      size="compact-xs"
                      leftSection={<IconFlask2 size={14} />}
                      rightSection={
                        dettagliAperti ? (
                          <IconChevronDown size={13} />
                        ) : (
                          <IconChevronRight size={13} />
                        )
                      }
                      onClick={() => onToggleDatiProduzione(riga.key)}
                      disabled={disabled}
                    >
                      Dettagli
                    </Button>
                  )}
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => onRimuoviRiga(riga.key)}
                    aria-label={`Rimuovi ${isDiagnostica ? "voce" : nomeVoceMinuscolo} ${indice + 1}`}
                    disabled={disabled}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Group>

              <Box
                p={terminologiaProdotto ? "md" : "sm"}
                pt={terminologiaProdotto ? "sm" : "xs"}
              >
                <Box
                  className="pt-product-main-grid"
                  data-diagnostica={isDiagnostica || undefined}
                  data-immunoterapia={isImmunoterapia || undefined}
                >
                  <Box
                    data-pt-field="prodotto"
                    className={
                      evidenziato &&
                      !riga.prodottoId &&
                      !riga.prodottoNome.trim()
                        ? "pt-product-field-attention-cell"
                        : undefined
                    }
                    style={attentionStyle}
                  >
                    <Autocomplete
                      size="xs"
                      label="Nome"
                      placeholder={
                        isAllergene
                          ? "Scegli o scrivi l’allergene"
                          : `Scegli o scrivi il ${nomeVoceMinuscolo}`
                      }
                      data={suggerimentiNomi}
                      value={riga.prodottoNome}
                      onChange={(value) => onDigitaProdotto(riga.key, value)}
                      onOptionSubmit={(value) =>
                        onScegliProdotto(riga.key, value)
                      }
                      onKeyDown={tabCompleta(
                        suggerimentiNomi,
                        riga.prodottoNome,
                        (value) => onScegliProdotto(riga.key, value),
                      )}
                      limit={100}
                      comboboxProps={{ withinPortal: true }}
                      disabled={disabled}
                    />
                  </Box>
                  {!isImmunoterapia && (
                    <NumberInput
                      size="xs"
                      label="Quantità"
                      value={riga.qta}
                      onChange={(value) =>
                        onAggiornaRiga(riga.key, { qta: Number(value) || 0 })
                      }
                      min={0}
                      disabled={disabled}
                    />
                  )}
                  <NumberInput
                    size="xs"
                    label={
                      isDiagnostica
                        ? "Valore"
                        : isImmunoterapia
                          ? "Prezzo"
                          : "Prezzo unitario"
                    }
                    value={riga.prezzo}
                    onChange={(value) =>
                      onAggiornaRiga(riga.key, {
                        prezzo: value === "" ? "" : Number(value),
                      })
                    }
                    prefix="€ "
                    decimalScale={2}
                    fixedDecimalScale
                    thousandSeparator="."
                    decimalSeparator=","
                    min={0}
                    disabled={disabled || prezziDisabilitati}
                  />
                  {!isDiagnostica && (
                    <TextInput
                      size="xs"
                      label="Paziente"
                      value={riga.paziente}
                      onChange={(event) =>
                        onAggiornaRiga(riga.key, {
                          paziente: event.currentTarget.value,
                        })
                      }
                      placeholder="Facoltativo"
                      disabled={disabled}
                    />
                  )}
                </Box>

                {isDiagnostica && (
                  <>
                    <Divider
                      my="sm"
                      label="Dettagli diagnostici"
                      labelPosition="left"
                    />
                    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
                      <Autocomplete
                        size="xs"
                        label="Tipo test"
                        data={tipiTest}
                        value={riga.tipoTest}
                        onChange={(value) =>
                          onAggiornaRiga(riga.key, { tipoTest: value })
                        }
                        onKeyDown={tabCompleta(
                          tipiTest,
                          riga.tipoTest,
                          (value) =>
                            onAggiornaRiga(riga.key, { tipoTest: value }),
                        )}
                        placeholder="es. PRICK TEST"
                        comboboxProps={{ withinPortal: true }}
                        disabled={disabled}
                      />
                      <Autocomplete
                        size="xs"
                        label="ML"
                        data={ML_COMUNI}
                        value={riga.ml}
                        onChange={(value) =>
                          onAggiornaRiga(riga.key, { ml: value })
                        }
                        onKeyDown={tabCompleta(
                          ML_COMUNI,
                          riga.ml,
                          (value) => onAggiornaRiga(riga.key, { ml: value }),
                        )}
                        placeholder="es. 2"
                        comboboxProps={{ withinPortal: true }}
                        disabled={disabled}
                      />
                      <TextInput
                        size="xs"
                        label="Codice"
                        value={riga.codice}
                        onChange={(event) =>
                          onAggiornaRiga(riga.key, {
                            codice: event.currentTarget.value,
                          })
                        }
                        placeholder="es. P-093"
                        disabled={disabled}
                      />
                    </SimpleGrid>
                  </>
                )}

                {isImmunoterapia && (
                  <Collapse expanded={dettagliAperti}>
                    <Divider
                      my="sm"
                      label={`Specifiche del ${nomeVoceMinuscolo}`}
                      labelPosition="left"
                    />
                    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
                      <Autocomplete
                        size="xs"
                        label="Formulazione"
                        placeholder="—"
                        data={suggerimentiProduzione.formulazioni}
                        value={riga.formulazione}
                        onChange={(value) =>
                          onAggiornaRiga(riga.key, { formulazione: value })
                        }
                        onKeyDown={tabCompleta(
                          suggerimentiProduzione.formulazioni,
                          riga.formulazione,
                          (value) =>
                            onAggiornaRiga(riga.key, { formulazione: value }),
                        )}
                        comboboxProps={{ withinPortal: true }}
                        disabled={disabled}
                      />
                      <Autocomplete
                        size="xs"
                        label="Posologia"
                        placeholder="—"
                        data={suggerimentiProduzione.posologie}
                        value={riga.posologia}
                        onChange={(value) =>
                          onAggiornaRiga(riga.key, { posologia: value })
                        }
                        onKeyDown={tabCompleta(
                          suggerimentiProduzione.posologie,
                          riga.posologia,
                          (value) =>
                            onAggiornaRiga(riga.key, { posologia: value }),
                        )}
                        comboboxProps={{ withinPortal: true }}
                        disabled={disabled}
                      />
                      <NumeriLottoInput
                        size="xs"
                        label="Numero lotto"
                        placeholder="Facoltativo"
                        value={riga.numero}
                        quantita={riga.qta}
                        onChange={(numero) =>
                          onAggiornaRiga(riga.key, { numero })
                        }
                        disabled={disabled}
                      />
                    </SimpleGrid>
                    <TagsInput
                      size="xs"
                      mt="xs"
                      label="Allergeni / ceppi (max 10)"
                      placeholder={
                        riga.allergeni.length === 0 ? "Aggiungi…" : undefined
                      }
                      maxTags={10}
                      data={suggerimentiProduzione.allergeni}
                      value={riga.allergeni}
                      onChange={(value) =>
                        onAggiornaRiga(riga.key, { allergeni: value })
                      }
                      comboboxProps={{ withinPortal: true }}
                      disabled={disabled}
                    />
                  </Collapse>
                )}
              </Box>
                </Paper>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </Stack>
      <Button
        variant="light"
        color="accent"
        size="compact-sm"
        leftSection={<IconPlus size={15} />}
        mt={terminologiaProdotto ? "md" : "sm"}
        onClick={onAggiungiRiga}
        disabled={disabled}
      >
        {isDiagnostica
          ? "Aggiungi voce diagnostica"
          : `Aggiungi ${nomeVoceMinuscolo}`}
      </Button>
    </Box>
  );
}
