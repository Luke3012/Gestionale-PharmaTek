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
  IconClockHour4,
  IconEyeOff,
  IconFileInvoice,
  IconFlask2,
  IconReceiptRefund,
  IconSettings,
  IconSparkle,
  IconSparkles,
  IconTruckDelivery,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type Suggerimento,
  type SuggerimentiBundle,
  type TipoSuggerimento,
} from "../../lib/tauri";
import type { DeepLink } from "../../shell/navigazione";
import { usePrefs } from "../../lib/prefs";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { dur, easeOut, useAnimazioniRidotte } from "../../ui/motion";
import { toast } from "../../ui/toast/store";
import {
  avviaControlloManualeSuggerimenti,
  combinaSuggerimenti,
  invalidaControlloManualeSuggerimenti,
  ordinaSuggerimenti,
  riconciliaControlloManualeSuggerimenti,
  rimuoviSuggerimentiDalControlloManuale,
  statoControlloManualeSuggerimenti,
} from "./suggerimenti";
import { deepLinkSuggerimento } from "./collegamento";
import {
  PREFERENZE_SUGGERIMENTI_DEFAULT,
  TIPI_SUGGERIMENTO,
  type PreferenzeSuggerimenti,
} from "./preferenze";

const VUOTO: SuggerimentiBundle = {
  suggerimenti: [],
  nascosti: [],
  tipiInPausa: [],
};
const LIMITE_COMPATTO = 5;
const GAP_SCHEDE = 7;
const DURATA_USCITA_MS = 170;

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
  preventivo: {
    label: "Preventivi",
    colore: "cyan",
    Icona: IconFileInvoice,
  },
};

const SchedaSuggerimento = memo(function SchedaSuggerimento({
  suggerimento,
  temporaneo = false,
  ridotte,
  onApri,
  onNascondi,
}: {
  suggerimento: Suggerimento;
  indice?: number;
  temporaneo?: boolean;
  ridotte: boolean;
  onApri: (suggerimento: Suggerimento) => void;
  onNascondi: (suggerimento: Suggerimento) => void;
}) {
  const aspetto = ASPETTO[suggerimento.tipo];
  const Icona = aspetto.Icona;

  return (
    <motion.div
      className="pt-suggerimento-card-shell"
      layout={!ridotte}
      initial={
        ridotte
          ? false
          : {
              opacity: 0,
              y: 8,
              scale: 0.99,
              height: 0,
              marginBottom: -GAP_SCHEDE,
            }
      }
      animate={{
        opacity: 1,
        x: 0,
        y: 0,
        scale: 1,
        height: "auto",
        marginBottom: 0,
      }}
      exit={
        ridotte
          ? { opacity: 0, transition: { duration: 0 } }
          : {
              opacity: 0,
              x: 16,
              scale: 0.98,
              height: 0,
              marginBottom: -GAP_SCHEDE,
              transition: {
                opacity: { duration: 0.14, ease: "easeOut" },
                x: { duration: 0.14, ease: "easeOut" },
                scale: { duration: 0.14, ease: "easeOut" },
                height: { duration: 0.22, delay: 0.06, ease: [0.22, 1, 0.36, 1] },
                marginBottom: { duration: 0.22, delay: 0.06, ease: [0.22, 1, 0.36, 1] },
              },
            }
      }
      transition={{
        duration: ridotte ? 0 : dur.fast,
        ease: easeOut,
        opacity: {
          duration: ridotte ? 0 : 0.2,
          delay: ridotte ? 0 : 0.08,
          ease: "easeOut",
        },
        y: {
          duration: ridotte ? 0 : 0.22,
          delay: ridotte ? 0 : 0.06,
          ease: [0.22, 1, 0.36, 1],
        },
        height: {
          duration: ridotte ? 0 : 0.22,
          delay: ridotte ? 0 : 0.06,
          ease: [0.22, 1, 0.36, 1],
        },
        marginBottom: {
          duration: ridotte ? 0 : 0.22,
          delay: ridotte ? 0 : 0.06,
          ease: [0.22, 1, 0.36, 1],
        },
        layout: {
          duration: ridotte ? 0 : 0.22,
          ease: [0.22, 1, 0.36, 1],
        },
      }}
      style={{
        overflow: "hidden",
        width: "100%",
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
            {temporaneo && (
              <Tooltip
                label="Mostrato temporaneamente dal controllo manuale"
                withArrow
                openDelay={350}
              >
                <IconClockHour4
                  size={13}
                  color="var(--mantine-color-dimmed)"
                  aria-label="Suggerimento temporaneo"
                  style={{ flex: "0 0 auto" }}
                />
              </Tooltip>
            )}
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
          label={
            suggerimento.tipo === "spedizione"
              ? "Ignora avviso"
              : "Nascondi e sospendi questa categoria per 6 ore"
          }
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
    anno,
    preferenzeSuggerimenti,
    setPreferenzeSuggerimenti,
  } = usePrefs();
  const preferenzePerCaricamento = useDebouncedValue(
    preferenzeSuggerimenti,
  );
  const preferenzeConAnno = useMemo(
    () => ({ ...preferenzePerCaricamento, anno }),
    [anno, preferenzePerCaricamento],
  );
  // Il controllo manuale sopravvive alla navigazione, ma mai al cambio del
  // contesto annuale: una fotografia di un altro anno non deve essere fusa.
  const statoManuale = statoControlloManualeSuggerimenti(anno);
  const [bundle, setBundle] = useState<SuggerimentiBundle | null>(
    () => statoManuale.bundle,
  );
  const [temporanei, setTemporanei] = useState<ReadonlySet<string>>(
    () => statoManuale.temporanei,
  );
  const [nascostiLocali, setNascostiLocali] = useState<Set<string>>(new Set());
  const usciteInCorsoRef = useRef<Set<string>>(new Set());
  const [espanso, setEspanso] = useState(false);
  const [ignorandoTutti, setIgnorandoTutti] = useState(false);
  const [uscitaTutti, setUscitaTutti] = useState(false);
  const [scansionando, setScansionando] = useState(
    () => statoManuale.inCorso !== null,
  );
  const [controlloManualeCompletato, setControlloManualeCompletato] =
    useState(() => statoManuale.bundle !== null);
  const [impostazioniAperte, setImpostazioniAperte] = useState(false);
  const [preferenzeBozza, setPreferenzeBozza] =
    useState<PreferenzeSuggerimenti>(preferenzeSuggerimenti);
  const haCategorieAttive =
    preferenzeSuggerimenti.tipiAbilitati.length > 0;

  useEffect(() => {
    if (!haCategorieAttive) {
      invalidaControlloManualeSuggerimenti();
      setBundle(VUOTO);
      setNascostiLocali(new Set());
      setControlloManualeCompletato(false);
      setScansionando(false);
      setTemporanei(new Set());
      return;
    }
    let vivo = true;
    const manuale = statoControlloManualeSuggerimenti(anno);
    if (manuale.inCorso) {
      setBundle(VUOTO);
      setNascostiLocali(new Set());
      setControlloManualeCompletato(false);
      setScansionando(true);
      void manuale.inCorso
        .then(async (value) => {
          if (!vivo || !value) return;
          const correnti = await api.suggerimentiLista(preferenzeConAnno);
          if (!vivo) return;
          const riconciliato = riconciliaControlloManualeSuggerimenti(correnti);
          setBundle(riconciliato);
          setTemporanei(statoControlloManualeSuggerimenti(anno).temporanei);
          setEspanso(false);
          setControlloManualeCompletato(true);
        })
        .catch((error) => {
          if (vivo) console.error("Controllo delle azioni non riuscito", error);
        })
        .finally(() => {
          if (vivo) setScansionando(false);
        });
      return () => {
        vivo = false;
      };
    }
    if (manuale.bundle) {
      setBundle(manuale.bundle);
      setTemporanei(manuale.temporanei);
      setNascostiLocali(new Set());
      setControlloManualeCompletato(true);
      setScansionando(false);
      void api
        .suggerimentiLista(preferenzeConAnno)
        .then((correnti) => {
          if (!vivo) return;
          setBundle(riconciliaControlloManualeSuggerimenti(correnti));
          setTemporanei(statoControlloManualeSuggerimenti(anno).temporanei);
        })
        .catch((error) => {
          if (vivo) console.error("Aggiornamento suggerimenti non riuscito", error);
        });
      return () => {
        vivo = false;
      };
    }
    setScansionando(false);
    api
      .suggerimentiLista(preferenzeConAnno)
      .then((value) => {
        if (vivo) {
          setBundle(value);
          setTemporanei(new Set());
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
  }, [anno, haCategorieAttive, nonce, preferenzeConAnno]);

  const forzaControllo = useCallback(async () => {
    if (!haCategorieAttive || scansionando) return;
    setScansionando(true);
    setControlloManualeCompletato(false);
    const durataMinima = ridotte ? 0 : 1_350;
    try {
      const value = await avviaControlloManualeSuggerimenti(async () => {
        const [rigenerato] = await Promise.all([
          api.suggerimentiRigeneraCompleta(anno),
          new Promise<void>((resolve) =>
            window.setTimeout(resolve, durataMinima),
          ),
        ]);
        return {
          suggerimenti: ordinaSuggerimenti([...rigenerato.suggerimenti]),
          nascosti: [],
          tipiInPausa: [],
        };
      });
      if (!value) return;
      setBundle(value);
      setTemporanei(statoControlloManualeSuggerimenti(anno).temporanei);
      setNascostiLocali(new Set());
      setEspanso(false);
      setControlloManualeCompletato(true);
    } catch (error) {
      toast.error(`Controllo delle azioni non riuscito: ${error}`);
    } finally {
      setScansionando(false);
    }
  }, [anno, haCategorieAttive, ridotte, scansionando]);

  const suggerimenti = useMemo(
    () =>
      combinaSuggerimenti(
        bundle ?? VUOTO,
        preferenzeSuggerimenti.tipiAbilitati,
        preferenzeSuggerimenti.giorniAvviso,
        temporanei,
      ).filter(
        (suggerimento) => !nascostiLocali.has(suggerimento.id),
      ),
    [
      bundle,
      nascostiLocali,
      preferenzeSuggerimenti.tipiAbilitati,
      preferenzeSuggerimenti.giorniAvviso,
      temporanei,
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

  const nascondi = useCallback(
    async (suggerimento: Suggerimento) => {
      if (usciteInCorsoRef.current.has(suggerimento.id)) return;
      usciteInCorsoRef.current.add(suggerimento.id);
      const eUltimo = suggerimenti.length <= 1;
      if (eUltimo && !ridotte) {
        setUscitaTutti(true);
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, DURATA_USCITA_MS),
        );
      }
      setNascostiLocali((correnti) => {
        const prossimi = new Set(correnti);
        prossimi.add(suggerimento.id);
        return prossimi;
      });
      if (eUltimo) {
        setEspanso(false);
      }
      try {
        await api.suggerimentoNascondi(suggerimento.id);
        rimuoviSuggerimentiDalControlloManuale([suggerimento.id]);
      } catch (error) {
        setNascostiLocali((correnti) => {
          const prossimi = new Set(correnti);
          prossimi.delete(suggerimento.id);
          return prossimi;
        });
        toast.error(`Impossibile nascondere il suggerimento: ${error}`);
      } finally {
        if (eUltimo) {
          setUscitaTutti(false);
        }
        usciteInCorsoRef.current.delete(suggerimento.id);
      }
    },
    [ridotte, suggerimenti.length],
  );

  const apri = useCallback(
    (suggerimento: Suggerimento) => {
      if (suggerimento.tipo === "spedizione") {
        void api.suggerimentoNascondi(suggerimento.id).catch(() => {});
      }
      const link = deepLinkSuggerimento(suggerimento.collegamento);
      if (
        suggerimento.tipo === "preventivo" &&
        temporanei.has(suggerimento.id)
      ) {
        link.azione = "solleciti_preventivi_tutti";
      }
      onApri(link);
    },
    [onApri, temporanei],
  );

  const renderScheda = useCallback(
    (suggerimento: Suggerimento, indice: number) => (
      <SchedaSuggerimento
        key={suggerimento.id}
        suggerimento={suggerimento}
        indice={indice}
        temporaneo={temporanei.has(suggerimento.id)}
        ridotte={ridotte}
        onApri={apri}
        onNascondi={nascondi}
      />
    ),
    [apri, nascondi, ridotte, temporanei],
  );

  const ignoraTutti = useCallback(async () => {
    const ids = suggerimenti.map((suggerimento) => suggerimento.id);
    if (ids.length === 0) return;
    setIgnorandoTutti(true);
    if (!ridotte) {
      setUscitaTutti(true);
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, DURATA_USCITA_MS),
      );
    }
    setEspanso(false);
    setNascostiLocali((correnti) => new Set([...correnti, ...ids]));
    try {
      await api.suggerimentiNascondi(ids);
      rimuoviSuggerimentiDalControlloManuale(ids);
      toast.success(
        ids.length === 1
          ? "Suggerimento ignorato."
          : `${ids.length} suggerimenti ignorati.`,
      );
    } catch (error) {
      setNascostiLocali((correnti) => {
        const prossimi = new Set(correnti);
        ids.forEach((id) => prossimi.delete(id));
        return prossimi;
      });
      toast.error(`Impossibile ignorare tutti i suggerimenti: ${error}`);
    } finally {
      setUscitaTutti(false);
      setIgnorandoTutti(false);
    }
  }, [ridotte, suggerimenti]);

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
    setNascostiLocali(new Set());
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

      <AnimatePresence mode="wait" initial={false}>
        {!bundle ? (
          <motion.div
            key="suggerimenti-loading"
            initial={ridotte ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={ridotte ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: ridotte ? 0 : 0.15 }}
          >
            <Stack gap={7}>
              {[0, 1, 2].map((indice) => (
                <Skeleton key={indice} h={58} radius="md" />
              ))}
            </Stack>
          </motion.div>
        ) : suggerimenti.length === 0 ? (
          <motion.div
            key="suggerimenti-vuoto"
            initial={ridotte ? false : { opacity: 0, y: 4, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={ridotte ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.992 }}
            transition={{ duration: ridotte ? 0 : dur.base, ease: easeOut }}
          >
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
                    ? "Mostra tutte le azioni correnti, anche quelle ignorate o sospese"
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
                      <IconSparkle className="pt-galaxy-scan-star pt-galaxy-scan-star--1" />
                      <IconSparkle className="pt-galaxy-scan-star pt-galaxy-scan-star--2" />
                      <IconSparkle className="pt-galaxy-scan-star pt-galaxy-scan-star--3" />
                    </span>
                  }
                  onClick={() => void forzaControllo()}
                >
                  {scansionando ? "Sto analizzando" : "Controlla ora"}
                </Button>
              </Tooltip>
              </Group>
            </Paper>
          </motion.div>
        ) : (
          <motion.div
            key="suggerimenti-lista"
            initial={ridotte ? false : { opacity: 0, y: 6, scale: 0.995 }}
            animate={
              uscitaTutti && !ridotte
                ? { opacity: 0, y: -4, scale: 0.992 }
                : { opacity: 1, y: 0, scale: 1 }
            }
            exit={ridotte ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.992 }}
            transition={{ duration: ridotte ? 0 : dur.base, ease: easeOut }}
            style={{
              pointerEvents: uscitaTutti ? "none" : undefined,
              willChange:
                uscitaTutti && !ridotte ? "transform, opacity" : undefined,
            }}
          >
            <Stack gap={GAP_SCHEDE}>
              <AnimatePresence initial={false}>
                {principali.map((suggerimento, indice) => (
                  <SchedaSuggerimento
                    key={suggerimento.id}
                    suggerimento={suggerimento}
                    indice={indice}
                    temporaneo={temporanei.has(suggerimento.id)}
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
                  animate={{ height: "auto", opacity: 1 }}
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
                    <Stack gap={GAP_SCHEDE}>
                      <AnimatePresence initial={false}>
                        {ulteriori.map((suggerimento, i) =>
                          renderScheda(suggerimento, LIMITE_COMPATTO + i),
                        )}
                      </AnimatePresence>
                    </Stack>
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
          </motion.div>
        )}
      </AnimatePresence>
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
                Queste preferenze valgono soltanto su questo PC. Per ciascuna categoria puoi
                impostare la cadenza di notifica: stabilisce ogni quanti giorni ripetere l'avviso
                pop-up se l'azione è ancora da compiere (0 = avviso immediato). Nella Dashboard le
                azioni abilitate restano sempre consultabili.
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
                        Invia notifiche pop-up custom per le azioni da compiere.
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
                          aria-label={`Cadenza di notifica per ${aspetto.label}`}
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
                          disabled={!abilitato}
                          w={132}
                        />
                      </Group>
                    </Paper>
                  );
                })}
              </Stack>
            </Stack>
          </div>
          <Group justify="space-between" className="pt-modal-footer">
            <Button
              variant="subtle"
              color="gray"
              onClick={() =>
                setPreferenzeBozza({
                  ...PREFERENZE_SUGGERIMENTI_DEFAULT,
                  tipiAbilitati: [
                    ...PREFERENZE_SUGGERIMENTI_DEFAULT.tipiAbilitati,
                  ],
                  giorniAvviso: {
                    ...PREFERENZE_SUGGERIMENTI_DEFAULT.giorniAvviso,
                  },
                })
              }
            >
              Ripristina predefiniti
            </Button>
            <Group gap="sm">
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
          </Group>
        </div>
      </Modal>
    </>
  );
}
