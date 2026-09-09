import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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
import { osservaRidimensionamento } from "../../ui/osservaRidimensionamento";
import { dur, easeOut, useAnimazioniRidotte } from "../../ui/motion";
import { toast } from "../../ui/toast/store";
import {
  bollettazioneConfirmation,
  initialBollettazioneResolution,
  trattamentoBollettazioneLabel,
  type BollettazioneResolution,
} from "./bollettazioneReview";
import { VirtualFlow } from "../../ui/VirtualFlow";

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

function rowKey(row: BollettazioneRow): string {
  return `${row.source}\u0000${row.sourceRow}\u0000${row.reference}`;
}

function readableValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function AnimatedAutoHeight({
  children,
  reducedMotion,
}: {
  children: ReactNode;
  reducedMotion: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const measure = () => {
      const next = Math.ceil(node.getBoundingClientRect().height);
      setHeight((current) => (current === next ? current : next));
    };
    return osservaRidimensionamento(node, measure);
  }, []);

  return (
    <motion.div
      className="pt-bollettazione-auto-height"
      initial={false}
      animate={height === null ? undefined : { height }}
      transition={{
        duration: reducedMotion ? 0 : dur.base,
        ease: easeOut,
      }}
    >
      <div ref={contentRef}>{children}</div>
    </motion.div>
  );
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
            c={row.status === "pronto" ? "teal" : "orange"}
            mt={4}
          >
            {row.reason}
          </Text>
        </Box>
        <Text size="xs" c="dimmed" ta="right">
          {row.source}
          <br />
          riga {row.sourceRow}
        </Text>
      </Group>

      {row.status !== "gia_registrato" && (
        <Stack gap="xs" mt="sm">
          {row.conflicts.map((conflict) => (
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
              {row.status !== "pronto" && !resolution.confirmed && (
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
            match.conflicts.map((conflict) => (
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
  onClose,
  onPrepareShipment,
  onArrived,
}: {
  analysis: BollettazioneAnalisi | null;
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
  const [arrivalDate, setArrivalDate] = useState(oggiIso);
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

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: 0,
      behavior: ridotte ? "auto" : "smooth",
    });
  }, [filter, ridotte]);

  const counts = useMemo(() => {
    const result: Record<BollettazioneRowStatus, number> = {
      pronto: 0,
      da_controllare: 0,
      non_trovato: 0,
      gia_registrato: 0,
    };
    for (const row of displayAnalysis?.rows ?? []) result[row.status] += 1;
    return result;
  }, [displayAnalysis]);
  const visible = useMemo(
    () => displayAnalysis?.rows.filter((row) => row.status === filter) ?? [],
    [displayAnalysis, filter],
  );

  const patch = useCallback(
    (
      row: BollettazioneRow,
      value: Partial<BollettazioneResolution>,
    ) => {
      const key = rowKey(row);
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

  const selectedRowCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const resolution of Object.values(resolutions)) {
      if (!resolution.match || resolution.skipped) continue;
      counts.set(
        resolution.match.rowId,
        (counts.get(resolution.match.rowId) ?? 0) + 1,
      );
    }
    return counts;
  }, [resolutions]);

  const reviewSummary = useMemo(() => {
    let unresolvedCount = 0;
    let firstUnresolved: BollettazioneRow | null = null;
    let confirmationCount = 0;
    for (const row of displayAnalysis?.rows ?? []) {
      const resolution =
        resolutions[rowKey(row)] ?? initialBollettazioneResolution(row);
      if (resolution.match && !resolution.skipped) confirmationCount += 1;
      if (row.status === "gia_registrato" || resolution.skipped) continue;

      const unresolved =
        row.quantityIssue ||
        row.conflicts.some((conflict) => conflict.blocking) ||
        !resolution.match ||
        (selectedRowCounts.get(resolution.match?.rowId ?? "") ?? 0) > 1 ||
        (row.status !== "pronto" &&
          (!resolution.confirmed ||
            resolution.match.conflicts.some(
              (conflict) =>
                !resolution.conflictChoices[conflict.field],
            )));
      if (!unresolved) continue;
      unresolvedCount += 1;
      firstUnresolved ??= row;
    }
    return { unresolvedCount, firstUnresolved, confirmationCount };
  }, [displayAnalysis, resolutions, selectedRowCounts]);

  const collectConfirmations = useCallback(
    () =>
      (displayAnalysis?.rows ?? [])
        .map((row) =>
          bollettazioneConfirmation(
            row,
            resolutions[rowKey(row)] ??
              initialBollettazioneResolution(row),
          ),
        )
        .filter((row): row is BollettazioneConfermaRiga => !!row),
    [displayAnalysis, resolutions],
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
    setFilter(reviewSummary.firstUnresolved?.status ?? "da_controllare");
    toast.warning(
      `Risolvi o salta le ${reviewSummary.unresolvedCount} righe ancora da controllare.`,
    );
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
      const skipped = displayAnalysis?.rows.filter(
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
      opened={!!analysis}
      onClose={onClose}
      size="min(1540px, calc(100vw - 24px))"
      classNames={{
        content: "pt-bollettazione-modal-content",
        body: "pt-bollettazione-modal-body",
      }}
      title={
        <Group gap="sm">
          <IconFileSpreadsheet size={20} />
          <Text fw={700}>Bollettazione automatica</Text>
          <Badge variant="light">
            {displayAnalysis?.totals.validRows ?? 0} righe
          </Badge>
        </Group>
      }
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
      transitionProps={{
        transition: "fade",
        duration: ridotte ? 0 : dur.base * 1000,
        onExited: () => setShownAnalysis(null),
      }}
      trapFocus
    >
      <FocusTrap.InitialFocus />
      {displayAnalysis && (
        <AnimatedAutoHeight reducedMotion={ridotte}>
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
                      onClick={() => setFilter(status)}
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
                        <Badge color={meta.color} variant="filled" circle>
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
            <Text
              className="pt-bollettazione-footer-summary"
              size="sm"
              c={reviewSummary.unresolvedCount ? "orange" : "dimmed"}
            >
              {reviewSummary.unresolvedCount
                ? `${reviewSummary.unresolvedCount} da risolvere`
                : `${reviewSummary.confirmationCount} pronte da applicare`}
            </Text>
            <TextInput
              label="Data arrivo"
              type="date"
              value={arrivalDate}
              onChange={(event) => setArrivalDate(event.currentTarget.value)}
              className="pt-bollettazione-date"
            />
            <Group
              className="pt-bollettazione-footer-actions"
              gap="xs"
              wrap="nowrap"
            >
              <Button variant="default" onClick={onClose} disabled={saving}>
                Annulla
              </Button>
              <Button
                variant="light"
                color="teal"
                leftSection={<IconMapPinCheck size={16} />}
                loading={saving}
                onClick={markArrived}
              >
                Segna come arrivati
              </Button>
              <Button
                color="accent"
                className="pt-bollettazione-footer-primary"
                leftSection={<IconPackageExport size={16} />}
                disabled={saving}
                onClick={prepareShipment}
              >
                Prepara spedizione
              </Button>
            </Group>
          </div>
        </Box>
        </AnimatedAutoHeight>
      )}
    </Modal>
  );
}
