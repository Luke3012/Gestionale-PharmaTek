import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBuildingBank,
  IconBulb,
  IconCash,
  IconChevronDown,
  IconEyeOff,
  IconFlask2,
  IconReceiptRefund,
  IconSettings,
  IconSparkles,
  IconTruckDelivery,
  IconUsersGroup,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type Suggerimento,
  type SuggerimentiBundle,
  type TipoSuggerimento,
} from "../../lib/tauri";
import type { DeepLink } from "../../shell/navigazione";
import { usePrefs } from "../../lib/prefs";
import { dur, easeOut, useAnimazioniRidotte } from "../../ui/motion";
import { toast } from "../../ui/toast/store";
import { VirtualStack } from "../../ui/VirtualStack";
import { calcolaLayoutVirtuale } from "../../ui/virtualizzazione";
import {
  combinaSuggerimenti,
} from "./suggerimenti";
import { deepLinkSuggerimento } from "./collegamento";
import {
  TIPI_SUGGERIMENTO,
  type PreferenzeSuggerimenti,
} from "./preferenze";

const VUOTO: SuggerimentiBundle = {
  suggerimenti: [],
  nascosti: [],
};
const LIMITE_COMPATTO = 5;
const ALTEZZA_SCHEDA = 58;
const GAP_SCHEDE = 7;
const ALTEZZA_EXTRA_MAX = 360;

const ASPETTO: Record<
  TipoSuggerimento,
  { label: string; colore: string; Icona: Icon }
> = {
  rimborso: { label: "Rimborsi", colore: "red", Icona: IconReceiptRefund },
  distinta: { label: "Distinte", colore: "grape", Icona: IconBuildingBank },
  provvigione: { label: "Provvigioni", colore: "teal", Icona: IconCash },
  produzione: { label: "Produzione", colore: "yellow", Icona: IconFlask2 },
  spedizione: {
    label: "Spedizioni",
    colore: "indigo",
    Icona: IconTruckDelivery,
  },
  duplicati: {
    label: "Anagrafiche",
    colore: "cyan",
    Icona: IconUsersGroup,
  },
};
const chiaveSuggerimento = (suggerimento: Suggerimento) => suggerimento.id;

const SchedaSuggerimento = memo(function SchedaSuggerimento({
  suggerimento,
  indice,
  virtuale = false,
  ridotte,
  onApri,
  onNascondi,
}: {
  suggerimento: Suggerimento;
  indice: number;
  virtuale?: boolean;
  ridotte: boolean;
  onApri: (suggerimento: Suggerimento) => void;
  onNascondi: (suggerimento: Suggerimento) => void;
}) {
  const aspetto = ASPETTO[suggerimento.tipo];
  const Icona = aspetto.Icona;

  return (
    <motion.div
      className="pt-suggerimento-card-shell"
      layout={!ridotte && !virtuale}
      initial={
        ridotte || virtuale ? false : { opacity: 0, y: 7, scale: 0.992 }
      }
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={
        ridotte || virtuale
          ? { opacity: 0 }
          : { opacity: 0, x: 18, height: 0 }
      }
      transition={{
        duration: ridotte ? 0 : dur.fast,
        ease: easeOut,
        delay: ridotte || virtuale ? 0 : Math.min(indice, 5) * 0.025,
      }}
    >
      <Group
        justify="space-between"
        gap="sm"
        wrap="nowrap"
        p="xs"
        style={{
          background: "var(--mantine-color-default-hover)",
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: "var(--mantine-radius-md)",
        }}
      >
        <ThemeIcon
          variant="light"
          color={aspetto.colore}
          radius="md"
          size={36}
          style={{ flex: "0 0 36px" }}
        >
          <Icona size={18} />
        </ThemeIcon>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Badge size="xs" variant="light" color={aspetto.colore}>
              {aspetto.label}
            </Badge>
            <Text size="sm" fw={700} truncate>
              {suggerimento.titolo}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" truncate mt={2}>
            {suggerimento.dettaglio}
          </Text>
        </Box>
        <Button
          size="compact-xs"
          variant="subtle"
          color={aspetto.colore}
          rightSection={<IconArrowRight size={13} />}
          onClick={() => onApri(suggerimento)}
          style={{ flex: "0 0 auto" }}
        >
          {suggerimento.azioneLabel}
        </Button>
        <Tooltip
          label="Nascondi finché i dati cambiano"
          withArrow
          openDelay={350}
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={`Nascondi: ${suggerimento.titolo}`}
            onClick={() => onNascondi(suggerimento)}
          >
            <IconX size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </motion.div>
  );
});

export function SuggerimentiPanel({
  nonce,
  onApri,
}: {
  nonce: number;
  onApri: (link: DeepLink) => void;
}) {
  const ridotte = useAnimazioniRidotte();
  const {
    preferenzeSuggerimenti,
    setPreferenzeSuggerimenti,
  } = usePrefs();
  const [bundle, setBundle] = useState<SuggerimentiBundle | null>(null);
  const [nascostiLocali, setNascostiLocali] = useState<Set<string>>(new Set());
  const [espanso, setEspanso] = useState(false);
  const [ignorandoTutti, setIgnorandoTutti] = useState(false);
  const [scansionando, setScansionando] = useState(false);
  const [controlloManualeCompletato, setControlloManualeCompletato] =
    useState(false);
  const [impostazioniAperte, setImpostazioniAperte] = useState(false);
  const [preferenzeBozza, setPreferenzeBozza] =
    useState<PreferenzeSuggerimenti>(preferenzeSuggerimenti);
  const haCategorieAttive =
    preferenzeSuggerimenti.tipiAbilitati.length > 0;

  useEffect(() => {
    if (!haCategorieAttive) {
      setBundle(VUOTO);
      setNascostiLocali(new Set());
      setControlloManualeCompletato(false);
      return;
    }
    let vivo = true;
    api
      .suggerimentiLista()
      .then((value) => {
        if (vivo) {
          setBundle(value);
          setNascostiLocali(new Set());
          setControlloManualeCompletato(false);
        }
      })
      .catch((error) => {
        if (vivo) {
          setBundle(VUOTO);
          console.error("Caricamento suggerimenti non riuscito", error);
        }
      });
    return () => {
      vivo = false;
    };
  }, [haCategorieAttive, nonce]);

  const forzaControllo = useCallback(async () => {
    if (!haCategorieAttive || scansionando) return;
    setScansionando(true);
    setControlloManualeCompletato(false);
    const durataMinima = ridotte ? 0 : 1_350;
    try {
      const [value] = await Promise.all([
        api.suggerimentiRigenera(),
        new Promise<void>((resolve) =>
          window.setTimeout(resolve, durataMinima),
        ),
      ]);
      setBundle(value);
      setNascostiLocali(new Set());
      setEspanso(false);
      setControlloManualeCompletato(true);
    } catch (error) {
      toast.error(`Controllo delle azioni non riuscito: ${error}`);
    } finally {
      setScansionando(false);
    }
  }, [haCategorieAttive, ridotte, scansionando]);

  const suggerimenti = useMemo(
    () =>
      combinaSuggerimenti(
        bundle ?? VUOTO,
        null,
        preferenzeSuggerimenti.tipiAbilitati,
      ).filter(
        (suggerimento) => !nascostiLocali.has(suggerimento.id),
      ),
    [
      bundle,
      nascostiLocali,
      preferenzeSuggerimenti.tipiAbilitati,
    ],
  );
  const principali = useMemo(
    () => suggerimenti.slice(0, LIMITE_COMPATTO),
    [suggerimenti],
  );
  const ulteriori = useMemo(
    () => suggerimenti.slice(LIMITE_COMPATTO),
    [suggerimenti],
  );
  const altezzaNaturaleUlteriori = useMemo(
    () =>
      calcolaLayoutVirtuale(
        ulteriori.map(chiaveSuggerimento),
        {},
        ALTEZZA_SCHEDA,
        GAP_SCHEDE,
      ).totale,
    [ulteriori],
  );
  const virtualizzaUlteriori =
    altezzaNaturaleUlteriori > ALTEZZA_EXTRA_MAX;
  const altezzaEspansaUlteriori =
    GAP_SCHEDE +
    Math.min(altezzaNaturaleUlteriori, ALTEZZA_EXTRA_MAX);

  const nascondi = useCallback(async (suggerimento: Suggerimento) => {
    setNascostiLocali((correnti) => {
      const prossimi = new Set(correnti);
      prossimi.add(suggerimento.id);
      return prossimi;
    });
    try {
      await api.suggerimentoNascondi(suggerimento.id);
    } catch (error) {
      setNascostiLocali((correnti) => {
        const prossimi = new Set(correnti);
        prossimi.delete(suggerimento.id);
        return prossimi;
      });
      toast.error(`Impossibile nascondere il suggerimento: ${error}`);
    }
  }, []);

  const apri = useCallback(
    (suggerimento: Suggerimento) =>
      onApri(deepLinkSuggerimento(suggerimento.collegamento)),
    [onApri],
  );

  const renderVirtuale = useCallback(
    (suggerimento: Suggerimento, indice: number) => (
      <SchedaSuggerimento
        suggerimento={suggerimento}
        indice={indice}
        virtuale
        ridotte={ridotte}
        onApri={apri}
        onNascondi={nascondi}
      />
    ),
    [apri, nascondi, ridotte],
  );

  const ignoraTutti = useCallback(async () => {
    const ids = suggerimenti.map((suggerimento) => suggerimento.id);
    if (ids.length === 0) return;
    setIgnorandoTutti(true);
    setEspanso(false);
    setNascostiLocali((correnti) => new Set([...correnti, ...ids]));
    try {
      await api.suggerimentiNascondi(ids);
      toast.success(
        ids.length === 1
          ? "Suggerimento ignorato fino al prossimo cambiamento."
          : `${ids.length} suggerimenti ignorati fino al prossimo cambiamento.`,
      );
    } catch (error) {
      setNascostiLocali((correnti) => {
        const prossimi = new Set(correnti);
        ids.forEach((id) => prossimi.delete(id));
        return prossimi;
      });
      toast.error(`Impossibile ignorare tutti i suggerimenti: ${error}`);
    } finally {
      setIgnorandoTutti(false);
    }
  }, [suggerimenti]);

  const apriImpostazioni = useCallback(() => {
    setPreferenzeBozza({
      ...preferenzeSuggerimenti,
      tipiAbilitati: [...preferenzeSuggerimenti.tipiAbilitati],
      giorniAvviso: { ...preferenzeSuggerimenti.giorniAvviso },
    });
    setImpostazioniAperte(true);
  }, [preferenzeSuggerimenti]);

  const salvaImpostazioni = useCallback(() => {
    setPreferenzeSuggerimenti(preferenzeBozza);
    setImpostazioniAperte(false);
    toast.success("Impostazioni salvate su questo PC.");
  }, [preferenzeBozza, setPreferenzeSuggerimenti]);

  return (
    <>
      <Card
        style={{
          overflow: "hidden",
          position: "relative",
        }}
      >
      <Box
        aria-hidden
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--mantine-color-yellow-3) 35%, transparent), transparent 68%)",
          height: 180,
          pointerEvents: "none",
          position: "absolute",
          right: -70,
          top: -95,
          width: 220,
        }}
      />
      <Group justify="space-between" align="center" mb="sm" wrap="nowrap">
        <Group gap={9} wrap="nowrap">
          <motion.div
            animate={
              ridotte
                ? undefined
                : { rotate: [0, -5, 4, 0], scale: [1, 1.06, 1.02, 1] }
            }
            transition={{
              duration: 2.8,
              ease: "easeInOut",
              repeat: Infinity,
              repeatDelay: 4,
            }}
          >
            <ThemeIcon variant="light" color="yellow" radius="md" size="lg">
              <IconBulb size={20} />
            </ThemeIcon>
          </motion.div>
          <Box>
            <Group gap={7}>
              <Text fw={750}>Azioni suggerite</Text>
              {bundle && suggerimenti.length > 0 && (
                <Badge size="sm" variant="light" color="yellow">
                  {suggerimenti.length}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              Ordinate per utilità, sempre basate sui dati correnti
            </Text>
          </Box>
        </Group>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Impostazioni suggerimenti" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Impostazioni suggerimenti"
              disabled={!bundle}
              onClick={apriImpostazioni}
            >
              <IconSettings size={17} />
            </ActionIcon>
          </Tooltip>
          <IconSparkles
            size={20}
            color="var(--mantine-color-yellow-7)"
            aria-hidden
          />
        </Group>
      </Group>

      {!bundle ? (
        <Stack gap={7}>
          {[0, 1, 2].map((indice) => (
            <Skeleton key={indice} h={58} radius="md" />
          ))}
        </Stack>
      ) : suggerimenti.length === 0 ? (
        <Paper withBorder radius="lg" p="md" className="pt-suggerimenti-vuoto">
          <Group justify="space-between" gap="md" wrap="wrap">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon variant="light" color="gray" radius="xl">
                <IconSparkles size={17} />
              </ThemeIcon>
              <Box>
                <Text size="sm" fw={700}>
                  {scansionando
                    ? "Analisi delle azioni in corso"
                    : "Tutto sotto controllo"}
                </Text>
                <Text size="xs" c="dimmed">
                  {scansionando
                    ? "Ricontrollo ordini, scadenze e attività correnti…"
                    : controlloManualeCompletato
                      ? "Controllo completato: nessuna nuova azione da suggerire."
                      : "Non ci sono azioni operative da suggerire adesso."}
                </Text>
              </Box>
            </Group>
            <Tooltip
              label={
                haCategorieAttive
                  ? "Rigenera le azioni dai dati correnti"
                  : "Attiva almeno una categoria nelle impostazioni"
              }
              withArrow
            >
              <Button
                size="compact-sm"
                variant="light"
                color="violet"
                className="pt-galaxy-scan-button"
                data-scanning={scansionando || undefined}
                data-reduced={ridotte || undefined}
                aria-busy={scansionando}
                disabled={!haCategorieAttive}
                leftSection={
                  <span className="pt-galaxy-scan-icon" aria-hidden>
                    <IconSparkles size={15} />
                    <b />
                  </span>
                }
                onClick={() => void forzaControllo()}
              >
                {scansionando ? "Sto analizzando" : "Controlla ora"}
              </Button>
            </Tooltip>
          </Group>
        </Paper>
      ) : (
        <>
          <Stack gap={GAP_SCHEDE}>
            <AnimatePresence mode="popLayout">
              {principali.map((suggerimento, indice) => (
                <SchedaSuggerimento
                  key={suggerimento.id}
                  suggerimento={suggerimento}
                  indice={indice}
                  ridotte={ridotte}
                  onApri={apri}
                  onNascondi={nascondi}
                />
              ))}
            </AnimatePresence>
          </Stack>
          <AnimatePresence initial={false}>
            {espanso && ulteriori.length > 0 && (
              <motion.div
                id="pt-suggerimenti-extra"
                key="suggerimenti-extra"
                initial={ridotte ? false : { height: 0, opacity: 0 }}
                animate={{
                  height: virtualizzaUlteriori
                    ? altezzaEspansaUlteriori
                    : "auto",
                  opacity: 1,
                }}
                exit={ridotte ? { height: 0 } : { height: 0, opacity: 0 }}
                transition={
                  ridotte
                    ? { duration: 0 }
                    : {
                        height: { duration: dur.slow, ease: easeOut },
                        opacity: { duration: dur.base, ease: easeOut },
                      }
                }
                style={{ overflow: "hidden" }}
              >
                <Box pt={GAP_SCHEDE}>
                  {virtualizzaUlteriori ? (
                    <VirtualStack
                      items={ulteriori}
                      getKey={chiaveSuggerimento}
                      maxHeight={ALTEZZA_EXTRA_MAX}
                      gap={GAP_SCHEDE}
                      estimateHeight={ALTEZZA_SCHEDA}
                      fixedItemHeight={ALTEZZA_SCHEDA}
                      overscan={2}
                      renderItem={renderVirtuale}
                    />
                  ) : (
                    <Stack gap={GAP_SCHEDE}>
                      {ulteriori.map((suggerimento, indice) => (
                        <SchedaSuggerimento
                          key={suggerimento.id}
                          suggerimento={suggerimento}
                          indice={indice}
                          virtuale
                          ridotte={ridotte}
                          onApri={apri}
                          onNascondi={nascondi}
                        />
                      ))}
                    </Stack>
                  )}
                </Box>
              </motion.div>
            )}
          </AnimatePresence>
          <Group justify="space-between" gap="xs" mt={8}>
            <Button
              variant="subtle"
              color="gray"
              size="compact-xs"
              leftSection={<IconEyeOff size={13} />}
              loading={ignorandoTutti}
              onClick={() => void ignoraTutti()}
            >
              Ignora tutte
            </Button>
            {ulteriori.length > 0 && (
              <Button
                variant="subtle"
                color="gray"
                size="compact-xs"
                aria-expanded={espanso}
                aria-controls="pt-suggerimenti-extra"
                rightSection={
                  <motion.span
                    aria-hidden
                    animate={{ rotate: espanso ? 180 : 0 }}
                    transition={{
                      duration: ridotte ? 0 : dur.base,
                      ease: easeOut,
                    }}
                    style={{ display: "inline-flex" }}
                  >
                    <IconChevronDown size={14} />
                  </motion.span>
                }
                onClick={() => setEspanso((value) => !value)}
              >
                {espanso
                  ? "Mostra meno"
                  : `Mostra altre ${ulteriori.length}`}
              </Button>
            )}
          </Group>
        </>
      )}
      </Card>
      <Modal
        opened={impostazioniAperte}
        onClose={() => setImpostazioniAperte(false)}
        title={
          <Group gap="sm">
            <ThemeIcon variant="light" color="yellow" radius="md">
              <IconSettings size={18} />
            </ThemeIcon>
            <Text fw={700}>Impostazioni azioni suggerite</Text>
          </Group>
        }
        centered
        size="md"
        transitionProps={{ transition: "fade", duration: 180 }}
      >
        <div className="pt-modal-shell">
          <div className="pt-modal-scroll">
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Queste preferenze valgono soltanto su questo PC. Le azioni
                compaiono subito nella Dashboard; il ritardo riguarda
                campanella, suono e pop-up.
              </Text>
              <Paper withBorder p="sm">
                <Switch
                  color="yellow"
                  checked={preferenzeBozza.notificheAttive}
                  onChange={(event) => {
                    const notificheAttive = event.currentTarget.checked;
                    setPreferenzeBozza((correnti) => ({
                      ...correnti,
                      notificheAttive,
                    }));
                  }}
                  label={
                    <Box>
                      <Text size="sm" fw={650}>
                        Notifiche delle azioni
                      </Text>
                      <Text size="xs" c="dimmed">
                        Mostra le azioni mature nella campanella e nei pop-up
                        custom.
                      </Text>
                    </Box>
                  }
                />
              </Paper>
              <Stack gap="xs">
                {TIPI_SUGGERIMENTO.map((tipo) => {
                  const aspetto = ASPETTO[tipo];
                  const Icona = aspetto.Icona;
                  const abilitato =
                    preferenzeBozza.tipiAbilitati.includes(tipo);
                  return (
                    <Paper key={tipo} withBorder p="sm" radius="md">
                      <Group justify="space-between" gap="md" wrap="nowrap">
                        <Switch
                          color={aspetto.colore}
                          checked={abilitato}
                          onChange={(event) => {
                            const attivo = event.currentTarget.checked;
                            setPreferenzeBozza((correnti) => ({
                              ...correnti,
                              tipiAbilitati: attivo
                                ? TIPI_SUGGERIMENTO.filter(
                                    (candidate) =>
                                      candidate === tipo ||
                                      correnti.tipiAbilitati.includes(candidate),
                                  )
                                : correnti.tipiAbilitati.filter(
                                    (candidate) => candidate !== tipo,
                                  ),
                            }));
                          }}
                          label={
                            <Group gap={7} wrap="nowrap">
                              <ThemeIcon
                                variant="light"
                                color={aspetto.colore}
                                radius="md"
                                size="sm"
                              >
                                <Icona size={14} />
                              </ThemeIcon>
                              <Text size="sm" fw={600}>
                                {aspetto.label}
                              </Text>
                            </Group>
                          }
                        />
                        <NumberInput
                          aria-label={`Giorni di attesa per ${aspetto.label}`}
                          value={preferenzeBozza.giorniAvviso[tipo]}
                          onChange={(value) =>
                            setPreferenzeBozza((correnti) => ({
                              ...correnti,
                              giorniAvviso: {
                                ...correnti.giorniAvviso,
                                [tipo]:
                                  value === ""
                                    ? 0
                                    : Math.max(
                                        0,
                                        Math.min(90, Math.round(Number(value))),
                                      ),
                              },
                            }))
                          }
                          min={0}
                          max={90}
                          clampBehavior="strict"
                          allowDecimal={false}
                          suffix={
                            preferenzeBozza.giorniAvviso[tipo] === 1
                              ? " giorno"
                              : " giorni"
                          }
                          disabled={
                            !abilitato || !preferenzeBozza.notificheAttive
                          }
                          w={132}
                        />
                      </Group>
                    </Paper>
                  );
                })}
              </Stack>
            </Stack>
          </div>
          <Group justify="flex-end" className="pt-modal-footer">
            <Button
              variant="default"
              onClick={() => setImpostazioniAperte(false)}
            >
              Annulla
            </Button>
            <Button
              color="accent"
              onClick={salvaImpostazioni}
            >
              Salva
            </Button>
          </Group>
        </div>
      </Modal>
    </>
  );
}
