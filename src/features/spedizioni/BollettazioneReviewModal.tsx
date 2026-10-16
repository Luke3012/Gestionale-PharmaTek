import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Badge,
  Box,
  Button,
  FocusTrap,
  Group,
  Modal,
  Radio,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconFileSpreadsheet,
  IconMapPinCheck,
  IconPackageExport,
  IconSearch,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  api,
  type BollettazioneAnalisi,
  type BollettazioneConfermaRiga,
  type BollettazioneRow,
  type BollettazioneRowStatus,
} from "../../lib/tauri";
import { formattaDataItaliana, oggiIso } from "../../lib/date";
import { dur, easeOut, useAnimazioniRidotte } from "../../ui/motion";
import { toast } from "../../ui/toast/store";
import { dialog } from "../../ui/dialog/store";
import { BollettazioneProductExclusions } from "./BollettazioneProductExclusions";
import {
  bollettazioneActiveRows,
  bollettazioneProductGroups,
  bollettazioneRowKey as rowKey,
  bollettazioneReviewChanged,
  bollettazioneSelectedRowCounts,
  bollettazioneConflictIsOperational,
  bollettazioneConfirmation,
  bollettazioneReviewIssue,
  bollettazioneReviewConflicts,
  initialBollettazioneResolution,
  trattamentoBollettazioneLabel,
  type BollettazioneResolution,
} from "./bollettazioneReview";
import { VirtualFlow } from "../../ui/VirtualFlow";
import { AnimazioneScansione } from "../../ui/AnimazioneScansione";
import { AnimatedAutoHeight } from "../../ui/AnimatedAutoHeight";

export interface BollettazionePreparazione {
  rows: BollettazioneConfermaRiga[];
  dataArrivo: string;
}

const STATUS_META: Record<
  BollettazioneRowStatus,
  { label: string; color: string }
> = {
  pronto: { label: "Pronti", color: "teal" },
  da_controllare: { label: "Da controllare", color: "orange" },
  non_trovato: { label: "Non trovati", color: "red" },
  gia_registrato: { label: "Già registrati", color: "gray" },
};

const statusOrder: BollettazioneRowStatus[] = [
  "pronto",
  "da_controllare",
  "non_trovato",
  "gia_registrato",
];

function initialFilter(
  analysis: BollettazioneAnalisi | null,
): BollettazioneRowStatus {
  return (
    statusOrder.find((status) =>
      analysis?.rows.some((row) => row.status === status),
    ) ?? "pronto"
  );
}

function readableValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}



const BollettazioneReviewRow = memo(function BollettazioneReviewRow({
  row,
  resolution,
  selectedRowCount,
  onPatch,
}: {
  row: BollettazioneRow;
  resolution: BollettazioneResolution;
  selectedRowCount: number;
  onPatch: (
    row: BollettazioneRow,
    value: Partial<BollettazioneResolution>,
  ) => void;
}) {
  const match = resolution.match;
  const issue = bollettazioneReviewIssue(row, resolution, selectedRowCount);
  const alternatives = useMemo(
    () =>
      row.alternatives.map((alternative) => ({
        value: alternative.rowId,
        label: `${alternative.orderNumber || "Ordine"} · ${formattaDataItaliana(alternative.orderDate, "data non indicata")} · ${alternative.patient || "senza paziente"} · ${alternative.doctor || "senza medico"} · ${alternative.productName || "prodotto"}`,
      })),
    [row.alternatives],
  );

  return (
    <Box
      className="pt-bollettazione-row"
      data-status={row.status}
      p="sm"
    >
      <Group justify="space-between" align="flex-start" gap="sm">
        <Box style={{ minWidth: 0 }}>
          <Group gap={6}>
            <Badge variant="light" color={STATUS_META[row.status].color}>
              {row.reference}
            </Badge>
            <Text fw={600} size="sm">
              {row.patient || "Paziente non indicato"}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" mt={3}>
            {row.doctor || "Medico non indicato"} ·{" "}
            {trattamentoBollettazioneLabel(row.treatment) ||
              "Trattamento non indicato"}
          </Text>
          <Text
            size="xs"
            c={row.status === "pronto" ? "teal" : row.status === "gia_registrato" ? "dimmed" : "orange"}
            mt={4}
          >
            {row.reason}
          </Text>
          {row.status !== "gia_registrato" && row.rawReference && (
            <Text size="xs" c="orange" mt={3}>
              Riferimento originale: {row.rawReference}
            </Text>
          )}
          {row.status !== "gia_registrato" && row.referenceWarning && (
            <Text size="xs" c="orange" mt={3}>
              {row.referenceWarning}
            </Text>
          )}
        </Box>
        <Text size="xs" c="dimmed" ta="right">
          {row.source}
          <br />
          riga {row.sourceRow}
        </Text>
      </Group>

      {issue && <Text size="xs" c="orange" role="status" mt={6}>{issue}</Text>}
      {row.status !== "gia_registrato" && (
        <Stack gap="xs" mt="sm">
          {row.conflicts
            .filter((conflict) => bollettazioneConflictIsOperational(conflict.field))
            .map((conflict) => (
              <Box
                key={`row-${conflict.field}`}
                className="pt-bollettazione-conflict"
                p="xs"
              >
                <Text size="xs" fw={600}>
                  {conflict.label}
                </Text>
                <Text size="xs" c="dimmed">
                  {conflict.currentDisplay ?? readableValue(conflict.current)} ·{" "}
                  {conflict.proposedDisplay ?? readableValue(conflict.proposed)}
                </Text>
              </Box>
            ))}
          {row.status !== "pronto" && (
            <Group align="flex-end" wrap="nowrap">
              <Select
                style={{ flex: 1 }}
                searchable
                clearable
                label="Associa a una riga ordine"
                placeholder="Cerca fra le alternative…"
                leftSection={<IconSearch size={15} />}
                data={alternatives}
                value={resolution.match?.rowId ?? null}
                onChange={(rowId) => {
                  const selected =
                    row.alternatives.find(
                      (alternative) => alternative.rowId === rowId,
                    ) ?? null;
                  onPatch(row, {
                    match: selected,
                    skipped: false,
                    confirmed: !!selected,
                    conflictChoices: {},
                  });
                }}
                nothingFoundMessage="Nessuna alternativa compatibile"
                comboboxProps={{ withinPortal: true }}
              />
              <Button
                variant={resolution.skipped ? "filled" : "default"}
                color={resolution.skipped ? "gray" : undefined}
                onClick={() =>
                  onPatch(row, {
                    skipped: !resolution.skipped,
                    confirmed: false,
                    match: resolution.skipped ? resolution.match : null,
                    conflictChoices: {},
                  })
                }
              >
                {resolution.skipped ? "Riga saltata" : "Salta questa riga"}
              </Button>
            </Group>
          )}

          {match && !resolution.skipped && (
            <Box className="pt-bollettazione-match" p="xs">
              <Group justify="space-between" gap="xs">
                <Text size="sm" fw={600}>
                  Ordine {match.orderNumber || "—"} ·{" "}
                  {formattaDataItaliana(match.orderDate)} ·{" "}
                  {match.productName || "Prodotto"}
                </Text>
                <Badge variant="light" color="teal">
                  {Math.round(match.score * 100)}%
                </Badge>
              </Group>
              {row.status !== "pronto" && (
                <Text size="xs" c="dimmed">
                  {match.reason}
                </Text>
              )}
              {selectedRowCount > 1 && (
                <Text size="xs" c="orange" mt={4}>
                  Questa riga ordine è associata a più riferimenti: cambia
                  associazione o salta una delle righe.
                </Text>
              )}
              {row.status !== "pronto" && !resolution.confirmed && !!issue && (
                <Button
                  size="compact-xs"
                  variant="light"
                  mt={6}
                  onClick={() => onPatch(row, { confirmed: true })}
                >
                  Associa
                </Button>
              )}
            </Box>
          )}

          {match &&
            !resolution.skipped &&
            bollettazioneReviewConflicts(match)
              .map((conflict) => (
                <Box
                  key={conflict.field}
                  className="pt-bollettazione-conflict"
                  p="xs"
                >
                  <Text size="xs" fw={600} mb={5}>
                    {conflict.label}
                  </Text>
                  <Radio.Group
                    value={resolution.conflictChoices[conflict.field] ?? ""}
                    onChange={(value) =>
                      onPatch(row, {
                        conflictChoices: {
                          ...resolution.conflictChoices,
                          [conflict.field]: value as "current" | "file",
                        },
                      })
                    }
                  >
                    <Stack gap={4}>
                      <Radio
                        value="current"
                        label={`Mantieni il gestionale: ${conflict.currentDisplay ?? readableValue(conflict.current)}`}
                      />
                      <Radio
                        value="file"
                        label={`Usa il file: ${conflict.proposedDisplay ?? readableValue(conflict.proposed)}`}
                      />
                    </Stack>
                  </Radio.Group>
                </Box>
              ))}
        </Stack>
      )}
    </Box>
  );
});

export function BollettazioneReviewModal({
  analysis,
  analyzing = false,
  fileCount = 0,
  onClose,
  onPrepareShipment,
  onArrived,
}: {
  analysis: BollettazioneAnalisi | null;
  analyzing?: boolean;
  fileCount?: number;
  onClose: () => void;
  onPrepareShipment: (preparation: BollettazionePreparazione) => void;
  onArrived: () => void;
}) {
  const ridotte = useAnimazioniRidotte();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shownAnalysis, setShownAnalysis] =
    useState<BollettazioneAnalisi | null>(analysis);
  const displayAnalysis = analysis ?? shownAnalysis;
  const [filter, setFilter] = useState<BollettazioneRowStatus>(() =>
    initialFilter(analysis),
  );
  const [saving, setSaving] = useState(false);
  const [unresolvedKey, setUnresolvedKey] = useState<string | null>(null);
  const [arrivalDate, setArrivalDate] = useState(oggiIso);
  const initialArrivalDate = useRef(arrivalDate);
  const [excludedProducts, setExcludedProducts] = useState<Set<string>>(() => new Set());
  const [exclusionsOpen, setExclusionsOpen] = useState(false);
  const closePending = useRef(false);
  const currentAnalysis = useRef(analysis);
  currentAnalysis.current = analysis;
  const [espansioneCompletata, setEspansioneCompletata] = useState(false);

  useEffect(() => {
    if (!analysis) {
      setEspansioneCompletata(false);
      return;
    }
    if (ridotte) {
      setEspansioneCompletata(true);
      return;
    }
    const t = window.setTimeout(() => setEspansioneCompletata(true), 280);
    return () => window.clearTimeout(t);
  }, [analysis, ridotte]);
  const [resolutions, setResolutions] = useState<
    Record<string, BollettazioneResolution>
  >(
    () =>
      Object.fromEntries(
        (analysis?.rows ?? []).map((row) => [
          rowKey(row),
          initialBollettazioneResolution(row),
        ]),
      ),
  );

  useLayoutEffect(() => {
    if (!analysis) return;
    initialArrivalDate.current = oggiIso();
    setArrivalDate(initialArrivalDate.current);
    setExcludedProducts(new Set());
    setExclusionsOpen(false);
    setUnresolvedKey(null);
    scrollRef.current?.scrollTo({ top: 0 });
    setShownAnalysis(analysis);
    setFilter(initialFilter(analysis));
    setResolutions(
      Object.fromEntries(
        analysis.rows.map((row) => [
          rowKey(row),
          initialBollettazioneResolution(row),
        ]),
      ),
    );
  }, [analysis]);

  const activeRows = useMemo(() => bollettazioneActiveRows(
    displayAnalysis?.rows ?? [], excludedProducts,
  ), [displayAnalysis, excludedProducts]);
  const productGroups = useMemo(() => bollettazioneProductGroups(displayAnalysis?.rows ?? []), [displayAnalysis]);
  const requestClose = async () => {
    if (saving || closePending.current || dialog.isOpen()) return;
    if (exclusionsOpen) {
      setExclusionsOpen(false);
    }
    if (!analysis || !bollettazioneReviewChanged(analysis.rows, resolutions, excludedProducts,
      arrivalDate, initialArrivalDate.current)) {
      onClose();
      return;
    }
    closePending.current = true;
    try {
      const discard = await dialog.confirm("Annullare le modifiche?",
        "Le scelte effettuate in questa revisione andranno perse.",
        { conferma: "Annulla modifiche", annulla: "Continua revisione" });
      if (discard && currentAnalysis.current === analysis) onClose();
    } finally {
      closePending.current = false;
    }
  };

  const counts = useMemo(() => {
    const result: Record<BollettazioneRowStatus, number> = {
      pronto: 0,
      da_controllare: 0,
      non_trovato: 0,
      gia_registrato: 0,
    };
    for (const row of activeRows) result[row.status] += 1;
    return result;
  }, [activeRows]);
  const visible = useMemo(
    () => activeRows.filter((row) => row.status === filter),
    [activeRows, filter],
  );

  const patch = useCallback(
    (
      row: BollettazioneRow,
      value: Partial<BollettazioneResolution>,
    ) => {
      const key = rowKey(row);
      setUnresolvedKey(null);
      setResolutions((current) => ({
        ...current,
        [key]: {
          ...(current[key] ?? initialBollettazioneResolution(row)),
          ...value,
        },
      }));
    },
    [],
  );

  const selectedRowCounts = useMemo(() => bollettazioneSelectedRowCounts(activeRows, resolutions),
    [activeRows, resolutions]);

  const reviewSummary = useMemo(() => {
    let unresolvedCount = 0;
    let firstUnresolved: BollettazioneRow | null = null;
    let confirmationCount = 0;
    for (const row of activeRows) {
      const resolution =
        resolutions[rowKey(row)] ?? initialBollettazioneResolution(row);
      const issue = bollettazioneReviewIssue(
        row, resolution, selectedRowCounts.get(resolution.match?.rowId ?? "") ?? 0,
      );
      if (!issue && bollettazioneConfirmation(row, resolution)) confirmationCount += 1;
      if (!issue) continue;
      unresolvedCount += 1;
      firstUnresolved ??= row;
    }
    return { unresolvedCount, firstUnresolved, confirmationCount };
  }, [activeRows, resolutions, selectedRowCounts]);

  const collectConfirmations = useCallback(
    () =>
      activeRows
        .map((row) =>
          bollettazioneConfirmation(
            row,
            resolutions[rowKey(row)] ??
              initialBollettazioneResolution(row),
            selectedRowCounts.get(resolutions[rowKey(row)]?.match?.rowId ?? "") ?? 0,
          ),
        )
        .filter((row): row is BollettazioneConfermaRiga => !!row),
    [activeRows, resolutions, selectedRowCounts],
  );

  const renderRow = useCallback(
    (row: BollettazioneRow) => {
      const key = rowKey(row);
      const resolution =
        resolutions[key] ?? initialBollettazioneResolution(row);
      return (
        <BollettazioneReviewRow
          key={key}
          row={row}
          resolution={resolution}
          selectedRowCount={
            resolution.match
              ? (selectedRowCounts.get(resolution.match.rowId) ?? 0)
              : 0
          }
          onPatch={patch}
        />
      );
    },
    [patch, resolutions, selectedRowCounts],
  );

  const requireResolved = () => {
    if (reviewSummary.unresolvedCount === 0) return true;
    const row = reviewSummary.firstUnresolved!;
    const resolution = resolutions[rowKey(row)] ?? initialBollettazioneResolution(row);
    setFilter(row.status);
    setUnresolvedKey(rowKey(row));
    toast.warning(bollettazioneReviewIssue(
      row, resolution, selectedRowCounts.get(resolution.match?.rowId ?? "") ?? 0,
    )!);
    return false;
  };

  const markArrived = async () => {
    if (!requireResolved()) return;
    if (!arrivalDate) {
      toast.warning("Indica la data di arrivo.");
      return;
    }
    const confirmations = collectConfirmations();
    if (confirmations.length === 0) {
      toast.warning("Nessuna riga da aggiornare.");
      return;
    }
    setSaving(true);
    try {
      const result = await api.bollettazioneConferma({
        mode: "arrivato_it",
        dataArrivo: arrivalDate,
        rows: confirmations,
      });
      const skipped = activeRows.filter(
        (row) => resolutions[rowKey(row)]?.skipped,
      ).length;
      toast.success(
        `${result.updatedRows} righe segnate come arrivate${skipped ? ` · ${skipped} saltate` : ""}.`,
      );
      onArrived();
    } catch (error) {
      toast.error(`Conferma non riuscita: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  const prepareShipment = () => {
    if (!requireResolved()) return;
    if (!arrivalDate) {
      toast.warning("Indica la data di arrivo.");
      return;
    }
    const confirmations = collectConfirmations();
    if (confirmations.length === 0) {
      toast.warning("Nessuna riga da preparare.");
      return;
    }
    onPrepareShipment({ rows: confirmations, dataArrivo: arrivalDate });
  };

  return (
    <Modal
      opened={!!analysis || analyzing}
      onClose={() => void requestClose()}
      closeButtonProps={{ "aria-label": "Chiudi bollettazione", disabled: saving }}
      size={displayAnalysis ? "min(1540px, calc(100vw - 24px))" : 480}
      classNames={{
        content: `pt-bollettazione-modal-content ${!displayAnalysis ? "pt-modal-compact" : ""}`,
        body: "pt-bollettazione-modal-body",
      }}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="teal" radius="md">
            <IconFileSpreadsheet size={18} />
          </ThemeIcon>
          <Text fw={700}>Bollettazione automatica</Text>
          {displayAnalysis ? (
            <Badge variant="light">
              {displayAnalysis.totals.validRows ?? 0} righe
            </Badge>
          ) : null}
        </Group>
      }
      closeOnClickOutside={!saving && !exclusionsOpen}
      // Il dialog globale ascolta Esc in capture: aprirlo in bubble evita che
      // lo stesso tasto annulli anche la conferma appena aperta.
      closeOnEscape={!analysis && !saving}
      onKeyDown={(event) => {
        if (!analysis || event.key !== "Escape" || event.defaultPrevented || exclusionsOpen
          || (event.target instanceof Element && event.target.closest('[data-mantine-stop-propagation="true"]'))) return;
        event.preventDefault();
        event.stopPropagation();
        void requestClose();
      }}
      transitionProps={{
        transition: "fade",
        duration: ridotte ? 0 : dur.base * 1000,
        onExited: () => {
          setShownAnalysis(null);
          setEspansioneCompletata(false);
        },
      }}
      trapFocus={!!displayAnalysis && espansioneCompletata}
    >
      {displayAnalysis ? (
        <AnimatedAutoHeight
          initialHeight={280}
          reducedMotion={ridotte}
          className="pt-bollettazione-auto-height"
        >
          <motion.div
            initial={ridotte ? false : { opacity: 0 }}
            animate={{ opacity: espansioneCompletata ? 1 : 0 }}
            transition={{ duration: ridotte ? 0 : 0.18, ease: "easeOut" }}
            style={{
              width: "100%",
              pointerEvents: espansioneCompletata ? "auto" : "none",
            }}
          >
            <FocusTrap.InitialFocus />
            <Box className="pt-modal-shell pt-bollettazione-shell">
          <Box ref={scrollRef} className="pt-modal-scroll">
            <Stack gap="md">
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
                {statusOrder.map((status) => {
                  const meta = STATUS_META[status];
                  return (
                    <Button
                      key={status}
                      className="pt-bollettazione-status"
                      variant={filter === status ? "light" : "default"}
                      color={meta.color}
                      onClick={() => {
                        setUnresolvedKey(null);
                        setFilter(status);
                        scrollRef.current?.scrollTo({ top: 0, behavior: ridotte ? "auto" : "smooth" });
                      }}
                    >
                      <span className="pt-bollettazione-status-label">
                        {meta.label}
                      </span>
                      <motion.span
                        key={`${status}-${counts[status]}`}
                        className="pt-bollettazione-status-count"
                        initial={ridotte ? false : { opacity: 0, scale: 0.72 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: ridotte ? 0 : dur.fast, ease: easeOut }}
                      >
                        <Badge
                          className="pt-bollettazione-status-badge"
                          color={meta.color}
                          variant="filled"
                          size="sm"
                          radius="xl"
                          px={counts[status] > 9 ? 6 : 0}
                        >
                          {counts[status]}
                        </Badge>
                      </motion.span>
                    </Button>
                  );
                })}
              </SimpleGrid>

              {displayAnalysis.files.some((file) => file.error) && (
                <Box className="pt-bollettazione-file-errors" p="sm">
                  <Group gap={6} mb={4}>
                    <IconAlertTriangle size={16} />
                    <Text fw={600} size="sm">
                      Alcuni file non sono stati letti
                    </Text>
                  </Group>
                  {displayAnalysis.files
                    .filter((file) => file.error)
                    .map((file) => (
                      <Text key={file.name} size="xs" c="dimmed">
                        {file.name}: {file.error}
                      </Text>
                    ))}
                </Box>
              )}

              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={filter}
                  initial={ridotte ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={ridotte ? undefined : { opacity: 0, y: -4 }}
                  transition={{ duration: ridotte ? 0 : dur.fast, ease: easeOut }}
                >
                  {visible.length === 0 ? (
                    <Text c="dimmed" ta="center" py="xl">
                      Nessuna riga in questo gruppo.
                    </Text>
                  ) : (
                    <VirtualFlow
                      items={visible}
                      scrollToKey={unresolvedKey}
                      scrollBehavior={ridotte ? "auto" : "smooth"}
                      getKey={rowKey}
                      renderItem={renderRow}
                      estimateHeight={
                        filter === "pronto" || filter === "gia_registrato"
                          ? 92
                          : 260
                      }
                      gap={8}
                      overscan={3}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </Stack>
          </Box>

          <div className="pt-modal-footer pt-bollettazione-footer">
            <Group gap="sm" className="pt-bollettazione-footer-summary">
            <Text
              size="sm"
              c={reviewSummary.unresolvedCount ? "orange" : "dimmed"}
              fw={500}
            >
              {reviewSummary.unresolvedCount
                ? `${reviewSummary.unresolvedCount} da risolvere`
                : `${reviewSummary.confirmationCount} pronte da applicare`}
            </Text>
            <BollettazioneProductExclusions
              groups={productGroups} excluded={excludedProducts} onChange={setExcludedProducts}
              opened={exclusionsOpen} onOpenedChange={setExclusionsOpen} disabled={saving} />
            </Group>
            <Group
              className="pt-bollettazione-footer-actions"
              gap="md"
              align="center"
              wrap="nowrap"
            >
              <Group gap="xs" align="center" wrap="nowrap" className="pt-bollettazione-date-group">
                <Text size="xs" fw={500} c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  Data arrivo:
                </Text>
                <TextInput
                  type="date"
                  size="sm"
                  value={arrivalDate}
                  onChange={(event) => setArrivalDate(event.currentTarget.value)}
                  className="pt-bollettazione-date"
                  aria-label="Data arrivo"
                />
              </Group>
              <Group gap="xs" wrap="nowrap" align="center">
                <Button
                  variant="light"
                  color="teal"
                  leftSection={<IconMapPinCheck size={16} />}
                  loading={saving}
                  disabled={!activeRows.some((row) => row.status !== "gia_registrato")}
                  onClick={markArrived}
                >
                  Segna come arrivati
                </Button>
                <Button
                  color="accent"
                  className="pt-bollettazione-footer-primary"
                  leftSection={<IconPackageExport size={16} />}
                  disabled={saving || !activeRows.some((row) => row.status !== "gia_registrato")}
                  onClick={prepareShipment}
                >
                  Prepara spedizione
                </Button>
              </Group>
            </Group>
          </div>
        </Box>
        </motion.div>
        </AnimatedAutoHeight>
      ) : (
        <AnimazioneScansione
          color="teal"
          icon={
            <ThemeIcon variant="transparent" size={38} color="teal.8">
              <IconFileSpreadsheet size={34} />
            </ThemeIcon>
          }
          title="Analisi file in corso…"
          subtitle={
            fileCount > 1
              ? `Lettura ed estrazione dei dati da ${fileCount} file Excel del laboratorio…`
              : "Lettura ed estrazione dei dati dal file Excel del laboratorio…"
          }
        />
      )}
    </Modal>
  );
}
