import { ActionIcon, Alert, Badge, Box, Button, Checkbox, Group, Loader, Modal, Paper, Progress, Stack, Switch, Text, ThemeIcon, Tooltip, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconExternalLink, IconFileTypePdf, IconFolder, IconMail, IconPhoto, IconPlus, IconRefresh, IconZip } from "@tabler/icons-react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type AllegatoComunicazioneInput, type PrescriptionFile, type PrescriptionSelectionInput, type PrescriptionsProgress, type ProductionPrescriptionScan } from "../../lib/tauri";
import { formattaDataIsoLocale } from "../../lib/date";
import { creaIdCasuale } from "../../lib/idCasuale";
import { usePrefs } from "../../lib/prefs";
import { useModalSnapshot } from "../../ui/useModalSnapshot";
import { VirtualFlow } from "../../ui/VirtualFlow";
import { PremiumAction } from "../../premium/PremiumAction";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import { apriComunicazione } from "../comunicazioni/apriComunicazione";
import { leggiBaseProduzione } from "./numeroProduzione";
import { AnimazioneScansione } from "../../ui/AnimazioneScansione";
import { AnimatedAutoHeight } from "../../ui/AnimatedAutoHeight";

const MAX_ZIP_EMAIL = 20 * 1024 * 1024;
export type PrescrizioniIntento = "zip" | "email";
interface ModalTarget { lot: string; intent: PrescrizioniIntento }
interface ActiveOperation extends PrescriptionsProgress { kind: "scan" | "zip" | "email" }
type PatientItem = ProductionPrescriptionScan["patients"][number];

function fileKey(file: PrescriptionFile) { return file.path.toLocaleLowerCase("it"); }
function bytesLabel(value: number) {
  return `${(value / 1024 / 1024).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB`;
}

export function PrescrizioniProduzioneModal({ lot, intent, onClose }: {
  lot: string | null;
  intent: PrescrizioniIntento;
  onClose: () => void;
}) {
  const { ridurreAnimazioni } = usePrefs();
  const target = useMemo<ModalTarget | null>(() => lot ? { lot, intent } : null, [intent, lot]);
  const [mostrato, clearMostrato] = useModalSnapshot(target);
  const [scan, setScan] = useState<ProductionPrescriptionScan | null>(null);
  const [operation, setOperation] = useState<ActiveOperation | null>(null);
  const [error, setError] = useState("");
  const [includeZip, setIncludeZip] = useState(true);
  const [espansioneCompletata, setEspansioneCompletata] = useState(false);
  const activeOperationId = useRef("");
  const loadSequence = useRef(0);

  useEffect(() => {
    if (!scan) {
      setEspansioneCompletata(false);
      return;
    }
    if (ridurreAnimazioni) {
      setEspansioneCompletata(true);
      return;
    }
    const t = window.setTimeout(() => setEspansioneCompletata(true), 280);
    return () => window.clearTimeout(t);
  }, [scan, ridurreAnimazioni]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<PrescriptionsProgress>("pt:prescriptions-progress", (event) => {
      if (!active || event.payload.id !== activeOperationId.current) return;
      setOperation((current) => {
        if (!current) return null;
        const newProg = event.payload.progress;
        const monProg = newProg != null
          ? Math.max(current.progress ?? 0, newProg)
          : current.progress;
        return { ...event.payload, progress: monProg, kind: current.kind };
      });
    }).then((off) => active ? (unlisten = off) : off());
    return () => { active = false; unlisten?.(); };
  }, []);

  const beginOperation = (kind: ActiveOperation["kind"], message: string, initialProgress = 0) => {
    const id = creaIdCasuale();
    activeOperationId.current = id;
    setOperation({ id, kind, phase: "preparing", progress: initialProgress, current: 0, total: 0, message, done: false });
    return id;
  };
  const finishOperation = (id: string) => {
    if (activeOperationId.current !== id) return;
    activeOperationId.current = "";
    setOperation(null);
  };

  const load = async (lotToScan?: string, forceRefresh = false) => {
    const activeLot = lotToScan ?? mostrato?.lot ?? lot;
    if (!activeLot) return;
    const sequence = ++loadSequence.current;
    const operationId = beginOperation("scan", "Sto cercando tra le varie produzioni…", 8);
    setError("");
    try {
      let result: ProductionPrescriptionScan;
      try {
        result = await api.prescriptionsScanLot(activeLot, operationId, forceRefresh);
      } catch (reason) {
        if (!String(reason).includes("seleziona la cartella Prescrizioni")) throw reason;
        finishOperation(operationId);
        const selected = await open({ directory: true, multiple: false, title: "Seleziona la cartella Prescrizioni" });
        if (typeof selected !== "string") throw new Error("Seleziona la cartella Prescrizioni per continuare.");
        await api.prescriptionsFolderSet(selected);
        const retryId = beginOperation("scan", "Sto cercando tra le varie produzioni…", 8);
        try { result = await api.prescriptionsScanLot(activeLot, retryId, true); }
        finally { finishOperation(retryId); }
      }
      if (sequence === loadSequence.current) setScan(result);
    } catch (reason) {
      if (sequence === loadSequence.current && !String(reason).includes("operazione annullata")) setError(String(reason));
    } finally { finishOperation(operationId); }
  };

  useEffect(() => {
    if (!lot) return;
    setScan(null); setError(""); setIncludeZip(true);
    void load(lot, false);
    // Il contenuto precedente resta montato durante la transizione di chiusura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lot]);

  const selections = useMemo<PrescriptionSelectionInput[]>(() => (scan?.patients ?? []).map((patient) => ({
    patient: patient.name,
    paths: patient.files.filter((file) => file.selected).map((file) => file.path),
  })), [scan]);
  const missing = selections.filter((selection) => selection.paths.length === 0).length;
  const selectedCount = selections.reduce((total, selection) => total + selection.paths.length, 0);
  const selectedSize = useMemo(() => {
    const unique = new Map<string, number>();
    for (const patient of scan?.patients ?? []) for (const file of patient.files.filter((item) => item.selected)) unique.set(fileKey(file), file.size);
    return [...unique.values()].reduce((total, size) => total + size, 0);
  }, [scan]);
  const tooLargeForEmail = selectedSize > MAX_ZIP_EMAIL;

  const updateFile = (patientKey: string, path: string, selected: boolean) => setScan((current) => current ? ({
    ...current,
    patients: current.patients.map((patient) => patient.key === patientKey ? {
      ...patient, files: patient.files.map((file) => file.path === path ? { ...file, selected } : file),
    } : patient),
  }) : current);

  const chooseFiles = async (patientKey: string, mode: "replace" | "append" = "replace") => {
    const selected = await open({
      multiple: true,
      directory: false,
      title: mode === "append" ? "Aggiungi prescrizioni al paziente" : "Scegli le prescrizioni del paziente",
      filters: [{ name: "Prescrizioni", extensions: ["jpg", "jpeg", "png", "pdf"] }],
    });
    const paths = typeof selected === "string" ? [selected] : selected;
    if (!paths?.length) return;
    try {
      const inspected = await api.prescriptionsInspectFiles(paths);
      setScan((current) => current ? ({
        ...current,
        patients: current.patients.map((patient) => {
          if (patient.key !== patientKey) return patient;
          if (mode === "append") {
            const existingPaths = new Set(patient.files.map((f) => f.path.toLowerCase()));
            const toAdd = inspected.filter((f) => !existingPaths.has(f.path.toLowerCase()));
            if (toAdd.length === 0) {
              toast.info("Tutti i file selezionati sono già presenti per questo paziente.");
              return patient;
            }
            return {
              ...patient,
              files: [...patient.files, ...toAdd].sort((a, b) => b.modifiedMs - a.modifiedMs),
            };
          }
          return { ...patient, files: inspected.sort((a, b) => b.modifiedMs - a.modifiedMs) };
        }),
      }) : current);
    } catch (reason) { toast.error(`File non utilizzabile: ${reason}`); }
  };

  const openFile = async (file: PrescriptionFile) => {
    try { await api.prescriptionOpen(file.path); }
    catch (reason) { toast.error(`Apertura non riuscita: ${reason}`); }
  };
  const cancelOperation = () => {
    const id = activeOperationId.current;
    if (!id) return;
    setOperation((current) => current ? { ...current, message: "Annullamento in corso…" } : null);
    void api.prescriptionsOperationCancel(id);
  };
  const close = () => { loadSequence.current += 1; cancelOperation(); onClose(); };

  const saveZip = async () => {
    if (!scan || missing > 0) return;
    const output = await save({ title: "Salva ZIP prescrizioni", defaultPath: `Prescrizioni ${scan.productionDate || "produzione"}.zip`, filters: [{ name: "Archivio ZIP", extensions: ["zip"] }] });
    if (!output) return;
    const operationId = beginOperation("zip", "Preparo lo ZIP delle prescrizioni…");
    setError("");
    try { await api.prescriptionsZipSave(scan.lot, selections, output, operationId); toast.success("ZIP delle prescrizioni creato."); }
    catch (reason) { if (!String(reason).includes("operazione annullata")) setError(String(reason)); }
    finally { finishOperation(operationId); }
  };

  const prepareEmail = async () => {
    if (!scan) return;
    const canIncludeZip = includeZip && !tooLargeForEmail && missing === 0;
    if (includeZip && missing > 0) {
      toast.info("Alcune prescrizioni mancano: l'e-mail verrà preparata allegando solo i file Excel.");
    }
    if (scan.previousSendMs > 0) {
      const previous = new Date(scan.previousSendMs).toLocaleString("it-IT");
      const confirmed = await dialog.confirm("E-mail già inviata per questo lotto", `Il lotto ${scan.lot} risulta già comunicato il ${previous}${scan.previousSendUser ? ` da ${scan.previousSendUser}` : ""}${scan.previousSendDevice ? ` sul dispositivo ${scan.previousSendDevice}` : ""}${scan.previousSendCommunicationId ? ` (rif. ${scan.previousSendCommunicationId})` : ""}. Vuoi preparare un nuovo invio?`, { conferma: "Prepara nuovo invio" });
      if (!confirmed) return;
    }
    const operationId = beginOperation("email", "Preparo gli allegati di produzione…");
    setError("");
    let allegatiDaRilasciare: AllegatoComunicazioneInput[] = [];
    try {
      const base = await leggiBaseProduzione();
      const prepared = await api.productionAttachmentsPrepare(scan.lot, selections, canIncludeZip, base, operationId);
      allegatiDaRilasciare = prepared.attachments;
      if (canIncludeZip && (tooLargeForEmail || prepared.zipOmittedLarge)) toast.warning("Lo ZIP supera 20 MB: verranno allegati soltanto i file Excel.");
      await apriComunicazione({
        destinatarioEntita: "laboratorio_laboratorio", destinatarioId: "laboratorio", destinatarioNome: "Laboratorio International Sales",
        email: "laboratorio@example.invalid", tipo: "invio_produzione", origineEntita: "lotto_produzione", origineId: scan.lot,
        origineSnapshot: { lotto: scan.lot, dataProduzione: prepared.productionDate, numeroProdotti: prepared.productCount },
        variabili: { lotto_produzione: "", data_produzione: formattaDataIsoLocale(prepared.productionDate, prepared.productionDate), numero_prodotti: String(prepared.productCount) },
        canaliConsentiti: ["email"], allegatiPerCanale: { email: prepared.attachments }, rilasciaAllegatiAllaChiusura: true,
        eliminaAllegatiNonUsatiAllaChiusura: true,
      });
      allegatiDaRilasciare = [];
      onClose();
    } catch (reason) {
      if (allegatiDaRilasciare.length) {
        await api.documentiCacheRilascia(allegatiDaRilasciare, true).catch(() => {});
      }
      if (!String(reason).includes("operazione annullata")) setError(String(reason));
    }
    finally { finishOperation(operationId); }
  };

  return (
    <Modal
      opened={!!lot}
      onClose={close}
      closeOnEscape
      closeOnClickOutside
      size={scan ? 820 : 480}
      zIndex={1300}
      centered
      classNames={{
        content: `pt-prescrizioni-modal-content ${!scan ? "pt-modal-compact" : ""}`,
      }}
      styles={{ title: { flex: 1, marginRight: 8 } }}
      title={
        <Group justify="space-between" align="center" style={{ flex: 1 }} wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon
              variant="light"
              color={mostrato?.intent === "email" ? "blue" : "violet"}
              radius="md"
            >
              {mostrato?.intent === "email" ? <IconMail size={18} /> : <IconZip size={18} />}
            </ThemeIcon>
            <Text fw={700}>
              {mostrato?.intent === "email" ? "Prima di inviare..." : "Prescrizioni del lotto"}
            </Text>
          </Group>
          {scan && missing > 0 && (
            <Tooltip
              label={
                mostrato?.intent === "email"
                  ? "Puoi comunque preparare l’e-mail: verranno allegati i file Excel di produzione."
                  : "Scegli almeno un documento per ciascun paziente prima di creare lo ZIP."
              }
              withArrow
              openDelay={150}
              zIndex={1500}
            >
              <Badge
                color={mostrato?.intent === "email" ? "blue" : "orange"}
                variant="light"
                size="sm"
                radius="sm"
                leftSection={<IconAlertTriangle size={13} />}
                style={{ cursor: "default" }}
              >
                {missing} pazient{missing === 1 ? "e" : "i"} {mostrato?.intent === "email" ? "senza prescrizione" : "da completare"}
              </Badge>
            </Tooltip>
          )}
        </Group>
      }
      transitionProps={{
        transition: "fade",
        duration: ridurreAnimazioni ? 1 : 180,
        onExited: () => {
          clearMostrato();
          setScan(null);
          setError("");
          setOperation(null);
          activeOperationId.current = "";
          setEspansioneCompletata(false);
        },
      }}
    >
      {mostrato && (
        scan ? (
          <AnimatedAutoHeight
            initialHeight={280}
            reducedMotion={ridurreAnimazioni}
          >
            <motion.div
              initial={ridurreAnimazioni ? false : { opacity: 0 }}
              animate={{ opacity: espansioneCompletata ? 1 : 0 }}
              transition={{ duration: ridurreAnimazioni ? 0 : 0.18, ease: "easeOut" }}
              style={{
                width: "100%",
                pointerEvents: espansioneCompletata ? "auto" : "none",
              }}
            >
              <Box className="pt-modal-shell pt-modal-shell-tall">
                <Box className="pt-modal-scroll">
                  <Stack gap="md">
                    {operation && (
                      <Paper withBorder radius="md" p="sm" style={{ background: "var(--mantine-color-default-hover)", borderColor: "var(--mantine-color-default-border)" }}>
                        <Group gap="xs" mb={8}>
                          <Loader size={16} color="accent" />
                          <Text size="sm" fw={600}>{operation.message}</Text>
                        </Group>
                        <Progress value={operation.progress ?? 0} color="accent" size="sm" radius="xl" striped={(!operation.progress || operation.progress === 0) && !ridurreAnimazioni} animated={(!operation.progress || operation.progress === 0) && !ridurreAnimazioni} aria-label={operation.message} />
                      </Paper>
                    )}
                    {error && <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Operazione non riuscita">{error}</Alert>}
                    <Group justify="space-between" align="center">
                      <Box><Text fw={700}>{scan.productCount} prodotti · {scan.patients.length} pazienti</Text></Box>
                      <Button variant="subtle" size="xs" leftSection={<IconRefresh size={15} />} disabled={!!operation} onClick={() => void load(undefined, true)}>Aggiorna</Button>
                    </Group>
                    <VirtualFlow<PatientItem>
                      items={scan.patients}
                      getKey={(patient) => patient.key}
                      estimateHeight={110}
                      gap={8}
                      overscan={4}
                      renderItem={(patient) => {
                        const selected = patient.files.filter((file) => file.selected).length;
                        return (
                          <Paper key={patient.key} withBorder p="sm" radius="md">
                            <Group justify="space-between" mb={patient.files.length ? "xs" : 0}>
                              <Box><Group gap="xs"><Text fw={700} size="sm">{patient.name}</Text><Badge size="xs" color={selected ? "teal" : "orange"}>{selected ? `${selected} selezionat${selected === 1 ? "o" : "i"}` : "Mancante"}</Badge></Group><Text size="xs" c="dimmed">{patient.productCount} prodott{patient.productCount === 1 ? "o" : "i"}</Text></Box>
                              {patient.files.length === 0 ? (
                                <Button size="xs" variant="light" leftSection={<IconFolder size={14} />} disabled={!!operation} onClick={() => void chooseFiles(patient.key, "replace")}>
                                  Scegli file
                                </Button>
                              ) : (
                                <Group gap={6} wrap="nowrap">
                                  <Tooltip label="Aggiungi altri file" withArrow openDelay={200}>
                                    <ActionIcon
                                      size={30}
                                      variant="light"
                                      color="gray"
                                      disabled={!!operation}
                                      onClick={() => void chooseFiles(patient.key, "append")}
                                      aria-label="Aggiungi altri file"
                                    >
                                      <IconPlus size={15} />
                                    </ActionIcon>
                                  </Tooltip>
                                  <Button size="xs" variant="light" leftSection={<IconFolder size={14} />} disabled={!!operation} onClick={() => void chooseFiles(patient.key, "replace")}>
                                    Cambia file
                                  </Button>
                                </Group>
                              )}
                            </Group>
                            {patient.files.map((file) => (
                              <Group key={file.path} gap="sm" wrap="nowrap" py={5}>
                                <Checkbox checked={file.selected} disabled={!!operation} onChange={(event) => updateFile(patient.key, file.path, event.currentTarget.checked)} aria-label={`Includi ${file.name}`} />
                                <UnstyledButton onClick={() => void openFile(file)} aria-label={`Apri ${file.name} con il programma di sistema`} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                                  <ThemeIcon variant="light" color={file.mime === "application/pdf" ? "red" : "blue"} size={38} radius="md" style={{ flexShrink: 0 }}>{file.mime === "application/pdf" ? <IconFileTypePdf size={19} /> : <IconPhoto size={19} />}</ThemeIcon>
                                  <Box style={{ minWidth: 0, flex: 1 }}><Group gap={5} wrap="nowrap"><Text size="xs" fw={600} truncate>{file.name}</Text><IconExternalLink size={12} style={{ flexShrink: 0 }} /></Group><Text size="xs" c="dimmed">{new Date(file.modifiedMs).toLocaleDateString("it-IT")} · {bytesLabel(file.size)}</Text></Box>
                                </UnstyledButton>
                                {file.confidence === "fuzzy" && <Badge size="xs" variant="light" color="yellow">Nome simile</Badge>}
                              </Group>
                            ))}
                          </Paper>
                        );
                      }}
                    />
                  </Stack>
                </Box>
                <div className="pt-modal-footer">
                  <Text size="sm" c={missing ? "orange" : "dimmed"} fw={500} style={{ flexShrink: 0 }}>
                    {selectedCount} document{selectedCount === 1 ? "o" : "i"} · {missing ? `${missing} mancanti` : "selezione completa"}
                  </Text>
                  <div className="pt-modal-actions">
                    {operation && (
                      <Button variant="default" onClick={cancelOperation} style={{ whiteSpace: "nowrap" }}>
                        Annulla operazione
                      </Button>
                    )}
                    {mostrato.intent === "email" && scan.hasImmunotherapy && (
                      <Tooltip
                        label={
                          missing > 0
                            ? "Prescrizioni incomplete: l'e-mail verrà preparata allegando solo i file Excel."
                            : tooLargeForEmail
                              ? `Selezione da ${bytesLabel(selectedSize)}: oltre il limite e-mail di 20 MB.`
                              : "Allega lo ZIP con le prescrizioni mediche all’e-mail per il laboratorio. Puoi disattivarlo per inviare solo i file Excel."
                        }
                        withArrow
                        openDelay={100}
                        zIndex={1500}
                      >
                        <Box style={{ display: "inline-flex", alignItems: "center" }}>
                          <Switch
                            checked={includeZip && !tooLargeForEmail && missing === 0}
                            disabled={missing > 0 || tooLargeForEmail || !!operation}
                            onChange={(event) => setIncludeZip(event.currentTarget.checked)}
                            label="Allega ZIP"
                            size="sm"
                            styles={{ label: { cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" } }}
                          />
                        </Box>
                      </Tooltip>
                    )}
                    {mostrato.intent === "zip" && scan.hasImmunotherapy && (
                      <Button
                        variant="filled"
                        color="accent"
                        leftSection={<IconZip size={16} />}
                        disabled={missing > 0 || !!operation}
                        onClick={() => void saveZip()}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        Crea ZIP
                      </Button>
                    )}
                    {mostrato.intent === "email" && (
                      <PremiumAction
                        buttonVariant="filled"
                        buttonColor="accent"
                        leftSection={<IconMail size={16} />}
                        disabled={!!operation}
                        onAction={() => void prepareEmail()}
                        title="Invio produzione a Laboratorio"
                        message="L’invio e-mail dal gestionale è disponibile con Premium."
                        style={{ whiteSpace: "nowrap" }}
                      >
                        Prepara e-mail
                      </PremiumAction>
                    )}
                  </div>
                </div>
              </Box>
            </motion.div>
          </AnimatedAutoHeight>
        ) : (
          <Box>
            {error ? (
              <Box p="md">
                <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Operazione non riuscita">{error}</Alert>
                <Group justify="center" mt="md">
                  <Button leftSection={<IconRefresh size={16} />} onClick={() => void load(undefined, true)}>Riprova</Button>
                </Group>
              </Box>
            ) : (
              <AnimazioneScansione
                color={mostrato.intent === "email" ? "blue" : "violet"}
                icon={
                  <ThemeIcon variant="transparent" size={38} color={mostrato.intent === "email" ? "blue.8" : "violet.8"}>
                    {mostrato.intent === "email" ? <IconMail size={34} /> : <IconZip size={34} />}
                  </ThemeIcon>
                }
                title={mostrato.intent === "email" ? "Preparazione prescrizioni…" : "Ricerca prescrizioni in corso…"}
                subtitle={operation?.message || "Sto cercando tra le varie produzioni…"}
                progress={operation?.progress}
              />
            )}
          </Box>
        )
      )}
    </Modal>
  );
}
