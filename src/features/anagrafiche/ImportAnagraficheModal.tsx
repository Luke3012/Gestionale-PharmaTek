import { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Progress,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconCheck,
  IconFileSpreadsheet,
  IconFolder,
  IconFolderOpen,
  IconPlus,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { api, type Campi, type ExtractedClient, type OperationLockStatus } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { dialog } from "../../ui/dialog/store";
import { usePrefs } from "../../lib/prefs";
import { cercaPerCAP, infoCitta, type ComuneInfo } from "../../lib/cap-lookup";
import {
  campiVuotiDaCompletare,
  creaIndiceBatchEstratti,
  creaIndiceClientiEsistenti,
  indicizzaBatchEstratto,
  pulisciCap,
  rigaDaScartare,
  trovaCorrispondenzaIndicizzata,
  trovaDuplicatoBatchIndicizzato,
  unisciClienti,
} from "./deduplicazione";
import {
  eseguiDedupClientiAuto,
  type DedupAutoResult,
} from "./dedupClientiAuto";
import { riordinaNomeCognome } from "./nomeCognome";

// Converte una stringa in Title Case per la visualizzazione
// ("VIA ROMA" → "Via Roma", "MARIO ROSSI" → "Mario Rossi")
function toTitleCase(s: string): string {
  if (!s) return s;
  return s.toLowerCase().replace(/(?:^|\s|-)\S/g, (c) => c.toUpperCase());
}

function campiClienteImportato(c: ExtractedClient): Campi {
  return {
    nome: toTitleCase(c.nome),
    indirizzo: toTitleCase(c.indirizzo),
    citta: toTitleCase(c.citta),
    prov: c.prov.toUpperCase(),
    cap: c.cap,
    regione: toTitleCase(c.regione),
    telefono: c.telefono,
    email: c.email.toLowerCase(),
    cf: c.cf ? c.cf.toUpperCase() : "",
    note_spedizione: c.note_spedizione.trim(),
  };
}

// Tipo di file riconosciuto automaticamente
type TipoFile = "generale" | "giornaliero" | "report";
interface FileItem {
  path: string;
  nome: string;
  tipo: TipoFile;
  isCartella: boolean;
}

interface ClienteDaCompletare {
  id: string;
  nome: string;
  fields: Campi;
}

type Step = "paths" | "scanning" | "review" | "importing" | "done";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const yieldToRenderer = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const REGIONI_CANONICHE = new Map(
  [
    "Abruzzo",
    "Basilicata",
    "Calabria",
    "Campania",
    "Emilia-Romagna",
    "Friuli-Venezia Giulia",
    "Lazio",
    "Liguria",
    "Lombardia",
    "Marche",
    "Molise",
    "Piemonte",
    "Puglia",
    "Sardegna",
    "Sicilia",
    "Toscana",
    "Trentino-Alto Adige",
    "Umbria",
    "Valle D'Aosta",
    "Veneto",
  ].map((r) => [chiaveTesto(r), r]),
);

const REGIONI_ALIAS = new Map<string, string>([
  ["EMILIA", "Emilia-Romagna"],
  ["EMILIA ROMAGNA", "Emilia-Romagna"],
  ["FRIULI", "Friuli-Venezia Giulia"],
  ["FRIULI VENEZIA GIULIA", "Friuli-Venezia Giulia"],
  ["TRENTINO", "Trentino-Alto Adige"],
  ["TRENTINO ALTO ADIGE", "Trentino-Alto Adige"],
  ["VALLE AOSTA", "Valle D'Aosta"],
  ["VALLE D AOSTA", "Valle D'Aosta"],
]);

function chiaveTesto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

function regioneCanonica(regione: string): string {
  const key = chiaveTesto(regione);
  if (!key) return "";
  return REGIONI_CANONICHE.get(key) ?? REGIONI_ALIAS.get(key) ?? regione.trim();
}

function scegliComune(
  comuni: ComuneInfo[],
  citta: string,
  prov: string,
): ComuneInfo | null {
  if (comuni.length === 0) return null;
  const cittaKey = chiaveTesto(citta);
  const provKey = prov.trim().toUpperCase();

  return (
    comuni.find((c) => cittaKey && chiaveTesto(c.nome) === cittaKey) ??
    comuni.find((c) => provKey && c.sigla.toUpperCase() === provKey) ??
    (comuni.length === 1 ? comuni[0] : null)
  );
}

function normalizzaGeografia(raw: ExtractedClient): ExtractedClient {
  let cap = pulisciCap(raw.cap);
  let citta = raw.citta.trim();
  let prov = raw.prov.trim().toUpperCase();
  let regione = regioneCanonica(raw.regione);

  const capDaCitta = citta.match(/\b(\d{5})\b/);
  if (!cap && capDaCitta) cap = capDaCitta[1];

  const provDaCitta = citta.match(/\(([A-Z]{2})\)\s*$/i);
  if (!prov && provDaCitta) prov = provDaCitta[1].toUpperCase();

  citta = citta
    .replace(/\b\d{5}\b/g, "")
    .replace(/\(([A-Z]{2})\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  let comune: ComuneInfo | null = null;
  if (cap) {
    const perCap = cercaPerCAP(cap);
    if (perCap) comune = scegliComune(perCap.comuni, citta, prov);
  }
  if (!comune && citta) {
    const info = infoCitta(citta);
    if (info && (!cap || info.cap.includes(cap)) && (!prov || info.sigla.toUpperCase() === prov)) {
      comune = info;
    }
  }

  if (comune) {
    citta = comune.nome;
    prov = comune.sigla;
    regione = comune.regione;
    if (!cap && comune.cap.length === 1) cap = comune.cap[0];
  }

  return {
    ...raw,
    citta,
    prov,
    cap,
    regione,
  };
}

function ImportIconAnimata({
  color,
  ridotte,
}: {
  color: "blue" | "teal";
  ridotte: boolean;
}) {
  const icon = (
    <ThemeIcon size={72} radius={18} variant="light" color={color}>
      <IconSearch size={34} stroke={2.2} />
    </ThemeIcon>
  );

  if (ridotte) return icon;

  return (
    <Box style={{ position: "relative", width: 96, height: 96 }}>
      <motion.div
        aria-hidden
        style={{
          position: "absolute",
          inset: 8,
          borderRadius: 22,
          border: `2px solid var(--mantine-color-${color}-2)`,
        }}
        animate={{ rotate: 360, opacity: [0.45, 0.85, 0.45] }}
        transition={{ rotate: { repeat: Infinity, duration: 5.5, ease: "linear" }, opacity: { repeat: Infinity, duration: 2.4, ease: "easeInOut" } }}
      />
      <motion.div
        style={{
          position: "absolute",
          inset: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          willChange: "transform",
        }}
        animate={{ y: [0, -4, 0], scale: [1, 1.035, 1] }}
        transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
      >
        {icon}
      </motion.div>
    </Box>
  );
}

// Rileva automaticamente il tipo di file dal nome/estensione/percorso
function rilevaCategoria(percorso: string, isCartella: boolean): TipoFile {
  if (isCartella) return "report";
  const nome = (percorso.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (/\.xlsm$/i.test(nome)) return "generale";
  if (nome.includes("general")) return "generale";
  return "giornaliero";
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isEmailValida(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export function ImportAnagraficheModal({
  aperto,
  onClose,
}: {
  aperto: boolean;
  onClose: () => void;
}) {
  const { ridurreAnimazioni } = usePrefs();
  const [step, setStep] = useState<Step>("paths");

  // Elenco di file/cartelle selezionati con la loro categoria rilevata
  const [fileItems, setFileItems] = useState<FileItem[]>([]);

  // Analysis stats
  const [totalFound, setTotalFound] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [alreadyExistCount, setAlreadyExistCount] = useState(0);
  const [newClients, setNewClients] = useState<ExtractedClient[]>([]);
  const [clientsToComplete, setClientsToComplete] = useState<ClienteDaCompletare[]>([]);
  const [createdCount, setCreatedCount] = useState(0);
  const [updatedCount, setUpdatedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [dedupResult, setDedupResult] = useState<DedupAutoResult | null>(null);

  // Progress states
  const [scanProgress, setScanProgress] = useState(0);
  const [importProgress, setImportProgress] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [lockStatus, setLockStatus] = useState<OperationLockStatus | null>(null);

  // Reset all on open
  useEffect(() => {
    if (aperto) {
      setStep("paths");
      setFileItems([]);
      setImportError(null);
      setScanProgress(0);
      setImportProgress(0);
      setTotalFound(0);
      setSkippedCount(0);
      setAlreadyExistCount(0);
      setNewClients([]);
      setClientsToComplete([]);
      setCreatedCount(0);
      setUpdatedCount(0);
      setFailedCount(0);
      setDedupResult(null);
    }
  }, [aperto]);

  useEffect(() => {
    if (!aperto) return;
    let attivo = true;
    async function caricaLock() {
      try {
        const status = await api.operationLockStatus();
        if (attivo) setLockStatus(status);
      } catch {
        if (attivo) setLockStatus(null);
      }
    }
    void caricaLock();
    const iv = window.setInterval(() => void caricaLock(), 10_000);
    return () => {
      attivo = false;
      window.clearInterval(iv);
    };
  }, [aperto]);

  // Aggiunge file Excel (multipli) auto-categorizzandoli
  async function aggiungiFile() {
    try {
      const res = await open({
        multiple: true,
        filters: [{ name: "Excel", extensions: ["xlsm", "xlsx", "xls"] }],
        title: "Seleziona file Excel storici",
      });
      if (!res) return;
      const paths = Array.isArray(res) ? res : [res];
      setFileItems((prev) => {
        const existing = new Set(prev.map((f) => f.path));
        const nuovi: FileItem[] = paths
          .filter((p) => !existing.has(p))
          .map((p) => ({
            path: p,
            nome: p.split(/[\\/]/).pop() ?? p,
            tipo: rilevaCategoria(p, false),
            isCartella: false,
          }));
        return [...prev, ...nuovi];
      });
    } catch {}
  }

  // Aggiunge una cartella (default: Report, ma modificabile)
  async function aggiungiCartella() {
    try {
      const dir = await open({ directory: true, title: "Seleziona cartella" });
      if (!dir || typeof dir !== "string") return;

      // Valida la cartella per assicurarsi che contenga file Excel validi
      const valida = await api.verificaCartellaExcel(dir);
      if (!valida) {
        toast.error("La cartella selezionata non contiene file Excel validi (.xlsx, .xlsm, .xls).");
        return;
      }

      setFileItems((prev) => {
        if (prev.some((f) => f.path === dir)) return prev;
        return [
          ...prev,
          {
            path: dir,
            nome: dir.split(/[\\/]/).pop() ?? dir,
            tipo: rilevaCategoria(dir, true),
            isCartella: true,
          },
        ];
      });
    } catch {}
  }

  // Cicla la categoria: generale → giornaliero → report → generale
  function ciclaTipo(path: string) {
    const ordine: TipoFile[] = ["generale", "giornaliero", "report"];
    setFileItems((prev) =>
      prev.map((f) =>
        f.path === path
          ? { ...f, tipo: ordine[(ordine.indexOf(f.tipo) + 1) % ordine.length] }
          : f
      )
    );
  }

  // Rimuove un elemento dalla lista
  function rimuoviItem(path: string) {
    setFileItems((prev) => prev.filter((f) => f.path !== path));
  }

  // Avvia la scansione adattiva
  async function avviaScansione() {
    setImportError(null);
    setScanProgress(0);
    setStep("scanning");
    const startScanTime = Date.now();

    // Ricostruisce i path separati dalla lista unificata di FileItem
    const pathGenerale = fileItems.filter((f) => f.tipo === "generale" && !f.isCartella).map((f) => f.path).join(";");
    const pathGiornaliero = fileItems
      .filter((f) => (f.tipo === "giornaliero" || f.tipo === "report") && !f.isCartella)
      .map((f) => f.path)
      .join(";");
    const pathReport = fileItems.filter((f) => f.tipo === "report" && f.isCartella).map((f) => f.path)[0] ?? "";

    try {
      // 1. Invoca Rust per il parsing grezzo degli Excel
      const rawClients = await api.importVecchiGiornalieri(pathGenerale, pathGiornaliero, pathReport);
      setTotalFound(rawClients.length);
      setScanProgress(10);
      await yieldToRenderer();
      
      // 2. Carica le anagrafiche attuali dal DB locale
      const dbClients = await api.recordsList("cliente");
      const dbIndex = creaIndiceClientiEsistenti(dbClients);
      setScanProgress(18);
      await yieldToRenderer();
      
      // Costruisce dizionari statistici dal DB per rilevare ordine Cognome-Nome
      const dbFirstNames = new Set<string>();
      const dbLastNames = new Set<string>();
      for (const db of dbClients) {
        const parts = ((db.data.nome as string) || "").trim().toUpperCase().split(/\s+/);
        if (parts.length > 0) {
          dbFirstNames.add(parts[0]);
        }
        if (parts.length > 1) {
          dbLastNames.add(parts[parts.length - 1]);
        }
      }
      
      // 3. Pulisci, deduplica ed effettua matching
      // Yield ogni 100 iterazioni per non bloccare il main thread e permettere
      // a Framer Motion di continuare ad animare durante il processing.
      let skipped = 0;
      const uniqueBatch: ExtractedClient[] = [];
      const batchIndex = creaIndiceBatchEstratti();
      
      for (let i = 0; i < rawClients.length; i++) {
        const raw = rawClients[i];
        if (i % 100 === 0) {
          setScanProgress(18 + Math.round((i / Math.max(rawClients.length, 1)) * 42));
          await yieldToRenderer();
        }
        
        // Scarta se riga non valida o vuota
        if (rigaDaScartare(raw)) {
          skipped++;
          continue;
        }
        
        // Filtro email non valide
        let cleanedEmail = raw.email.trim();
        if (cleanedEmail && !isEmailValida(cleanedEmail)) {
          cleanedEmail = "";
        }

        // Applica lo swap intelligente cognome-nome in sottofondo se rilevato
        const nomeOrdinato = riordinaNomeCognome(raw.nome, dbFirstNames, dbLastNames);

        // Pulisci CAP, località e nomi. La geografia viene risolta offline dal
        // dataset CAP/comuni per evitare città tipo "MODICA (RG)" con provincia vuota.
        const normal = normalizzaGeografia({
          ...raw,
          nome: nomeOrdinato.trim().toUpperCase(),
          indirizzo: raw.indirizzo.trim().toUpperCase(),
          citta: raw.citta.trim().toUpperCase(),
          prov: raw.prov.trim().toUpperCase(),
          regione: raw.regione.trim().toUpperCase(),
          note_spedizione: raw.note_spedizione.trim(),
          email: cleanedEmail,
        });
        
        const dupIdx = trovaDuplicatoBatchIndicizzato(normal, uniqueBatch, batchIndex);
        if (dupIdx >= 0) {
          uniqueBatch[dupIdx] = unisciClienti(uniqueBatch[dupIdx], normal);
          indicizzaBatchEstratto(batchIndex, uniqueBatch[dupIdx], dupIdx);
        } else {
          uniqueBatch.push(normal);
          indicizzaBatchEstratto(batchIndex, normal, uniqueBatch.length - 1);
        }
      }
      setScanProgress(62);
      await yieldToRenderer();
      
      // 4. Confronta con il DB locale: crea i mancanti e completa i campi vuoti
      // dei clienti già presenti, invece di scartare tutto il record importato.
      const toImport: ExtractedClient[] = [];
      const daCompletare = new Map<string, ClienteDaCompletare>();
      let exists = 0;
      let batchIdx = 0;
      
      for (const batchClient of uniqueBatch) {
        if (batchIdx % 100 === 0) {
          setScanProgress(62 + Math.round((batchIdx / Math.max(uniqueBatch.length, 1)) * 34));
          await yieldToRenderer();
        }
        batchIdx++;
        const match = trovaCorrispondenzaIndicizzata(batchClient, dbIndex);
        if (match) {
          exists++;
          const fields = campiVuotiDaCompletare(match, campiClienteImportato(batchClient));
          if (Object.keys(fields).length > 0) {
            const corrente = daCompletare.get(match.id);
            daCompletare.set(match.id, {
              id: match.id,
              nome: String(match.data.nome ?? batchClient.nome),
              fields: corrente ? { ...fields, ...corrente.fields } : fields,
            });
          }
        } else {
          toImport.push(batchClient);
        }
      }
      setScanProgress(98);
      
      // Assicura durata minima di 3 secondi per la scansione
      const elapsed = Date.now() - startScanTime;
      if (elapsed < 3000) {
        await sleep(3000 - elapsed);
      }
      
      setSkippedCount(skipped);
      setAlreadyExistCount(exists);
      setNewClients(toImport);
      setClientsToComplete([...daCompletare.values()]);
      setScanProgress(100);
      setStep("review");
    } catch (e) {
      setImportError(String(e));
    }
  }

  // Esegue l'importazione in chunk per mostrare il progresso
  async function eseguiImportazione() {
    setStep("importing");
    setImportProgress(0);
    const startImportTime = Date.now();
    let lockPreso = false;
    let ultimoRinnovoLock = 0;
    
    try {
      await api.acquisisciLock("importazione_anagrafiche");
      lockPreso = true;
      ultimoRinnovoLock = Date.now();
      setLockStatus(await api.operationLockStatus().catch(() => null));
      
      // 1. Esegui backup preventivo automatico per rollback sicuro
      try {
        await api.backupNow(null, "pre-import");
      } catch (backupErr) {
        const prosegui = await dialog.confirmDanger(
          "Backup preventivo non riuscito",
          `Non è stato possibile creare il punto di ripristino pre-importazione: ${backupErr}. Vuoi proseguire comunque?`,
          { conferma: "Prosegui senza backup", annulla: "Annulla importazione" }
        );
        if (!prosegui) {
          setStep("review");
          return;
        }
      }

      const jobs = [
        ...newClients.map((client) => ({ kind: "create" as const, client })),
        ...clientsToComplete.map((client) => ({ kind: "update" as const, client })),
      ];
      const total = jobs.length;
      const chunkSize = 25;
      let creati = 0;
      let aggiornati = 0;
      let falliti = 0;
      
      for (let i = 0; i < total; i += chunkSize) {
        if (Date.now() - ultimoRinnovoLock > 5 * 60 * 1000) {
          await api.rinnovaLock("importazione_anagrafiche");
          ultimoRinnovoLock = Date.now();
        }
        const chunk = jobs.slice(i, i + chunkSize);
        
        const results = await Promise.all(
          chunk.map(async (job) => {
            try {
              if (job.kind === "create") {
                await api.recordCreate("cliente", campiClienteImportato(job.client));
                return "created" as const;
              }
              await api.recordUpdate("cliente", job.client.id, job.client.fields);
              return "updated" as const;
            } catch (err) {
              const nome = job.kind === "create" ? job.client.nome : job.client.nome || job.client.id;
              console.warn(`Errore durante l'import del cliente ${nome}:`, err);
              return "failed" as const;
            }
          })
        );
        creati += results.filter((r) => r === "created").length;
        aggiornati += results.filter((r) => r === "updated").length;
        falliti += results.filter((r) => r === "failed").length;
        
        const prog = Math.min(Math.round(((i + chunk.length) / total) * 100), 100);
        setImportProgress(prog);
        
        // Aggiungi un minimo delay tra i chunk per renderlo visivo
        await sleep(150);
      }
      
      // Assicura durata minima complessiva di 3 secondi per l'importazione
      const elapsed = Date.now() - startImportTime;
      if (elapsed < 3000) {
        await sleep(3000 - elapsed);
      }
      setCreatedCount(creati);
      setUpdatedCount(aggiornati);
      setFailedCount(falliti);

      setImportProgress(98);
      try {
        const dedup = await eseguiDedupClientiAuto();
        setDedupResult(dedup);
      } catch (dedupErr) {
        console.warn("Deduplicazione automatica clienti non riuscita:", dedupErr);
        setDedupResult(null);
      }
      setStep("done");
    } catch (e) {
      setImportError(String(e));
      setStep("review");
    } finally {
      if (lockPreso) {
        await api.rilasciaLock("importazione_anagrafiche").catch(() => {});
        setLockStatus(await api.operationLockStatus().catch(() => null));
      }
    }
  }

  const lockAltrui = !!lockStatus?.active && !lockStatus.own;
  const puoApplicareImport = newClients.length + clientsToComplete.length > 0 || alreadyExistCount > 0;

  return (
    <Modal
      opened={aperto}
      onClose={step === "scanning" || step === "importing" ? () => {} : onClose}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="blue" radius="md">
            <IconSearch size={18} />
          </ThemeIcon>
          <Text fw={700}>Importazione Clienti Storici</Text>
        </Group>
      }
      size={600}
      closeOnEscape={step !== "scanning" && step !== "importing"}
      closeOnClickOutside={step !== "scanning" && step !== "importing"}
      withCloseButton={step !== "scanning" && step !== "importing"}
      centered
      transitionProps={{ transition: "fade", duration: 180 }}
    >
      <Box className="pt-modal-shell">
        <Box className="pt-modal-scroll">
          <AnimatePresence mode="wait">
            {/* Step 1: Configurazione Percorsi */}
            {step === "paths" && (
          <motion.div
            key="paths"
            initial={ridurreAnimazioni ? {} : { opacity: 0, x: -15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={ridurreAnimazioni ? {} : { opacity: 0, x: 15 }}
            transition={{ duration: 0.2 }}
          >
          <Stack gap="md">
              {lockAltrui && lockStatus && (
                <Box p="sm" style={{ background: "var(--mantine-color-orange-light)", borderRadius: 8 }}>
                  <Text size="xs" fw={700} c="orange">
                    Operazione temporaneamente bloccata
                  </Text>
                  <Text size="xs">
                    {lockStatus.utenteNome} su {lockStatus.deviceNome} sta eseguendo: {lockStatus.azione}.
                  </Text>
                </Box>
              )}
              <Text size="sm" c="dimmed">
                Aggiungi file Excel e cartelle: il sistema riconosce automaticamente vecchi storici, report ed export Aruba. Tocca il badge colorato per correggere la categoria se necessario.
              </Text>

              {/* Lista degli elementi selezionati */}
              {fileItems.length > 0 && (
                <ScrollArea.Autosize mah={220} type="auto">
                  <Stack gap={6}>
                    {fileItems.map((item) => {
                      const colore = item.tipo === "generale" ? "blue" : item.tipo === "giornaliero" ? "orange" : "teal";
                      const labelTipo = item.tipo === "generale" ? "Generale" : item.tipo === "giornaliero" ? "Giornaliero" : "Report";
                      return (
                        <Group
                          key={item.path}
                          p="xs"
                          wrap="nowrap"
                          gap="xs"
                          style={{
                            borderRadius: 8,
                            border: "1px solid var(--mantine-color-default-border)",
                            background: "var(--mantine-color-body)",
                          }}
                        >
                          <ThemeIcon size={28} radius="sm" variant="light" color={item.isCartella ? "yellow" : "blue"} style={{ flexShrink: 0 }}>
                            {item.isCartella ? <IconFolderOpen size={14} /> : <IconFileSpreadsheet size={14} />}
                          </ThemeIcon>
                          <Text
                            size="xs"
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={item.path}
                          >
                            {item.nome}
                          </Text>
                          <Badge
                            size="sm"
                            variant="light"
                            color={colore}
                            style={{ cursor: "pointer", flexShrink: 0, userSelect: "none" }}
                            onClick={() => ciclaTipo(item.path)}
                            title="Tocca per cambiare categoria"
                          >
                            {labelTipo}
                          </Badge>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="gray"
                            onClick={() => rimuoviItem(item.path)}
                            aria-label="Rimuovi"
                          >
                            <IconX size={12} />
                          </ActionIcon>
                        </Group>
                      );
                    })}
                  </Stack>
                </ScrollArea.Autosize>
              )}
                 {fileItems.length === 0 && (
                <Stack
                  align="center"
                  justify="center"
                  p="xl"
                  style={{
                    borderRadius: 12,
                    border: "2px dashed var(--mantine-color-default-border)",
                    backgroundColor: "var(--mantine-color-default)",
                    cursor: "pointer",
                  }}
                  onClick={aggiungiFile}
                >
                  <ThemeIcon size={44} radius="md" variant="light" color="gray">
                    <IconFileSpreadsheet size={24} />
                  </ThemeIcon>
                  <Box ta="center">
                    <Text size="sm" fw={600}>Nessun file o cartella selezionata</Text>
                    <Text size="xs" c="dimmed" mt={4}>Clicca per esplorare o usa i pulsanti sottostanti</Text>
                  </Box>
                </Stack>
              )}

              {/* Pulsanti di selezione */}
              <Group gap="sm">
                <Button
                  variant="default"
                  leftSection={<IconPlus size={14} />}
                  onClick={aggiungiFile}
                  size="sm"
                  style={{ flex: 1 }}
                >
                  Aggiungi file Excel
                </Button>
                <Button
                  variant="default"
                  leftSection={<IconFolder size={14} />}
                  onClick={aggiungiCartella}
                  size="sm"
                  style={{ flex: 1 }}
                >
                  Aggiungi cartella
                </Button>
              </Group>

              {/* Legenda categorie */}
              <Box mt="xs" p="sm" style={{ background: "var(--bg)", borderRadius: 8 }}>
                <Text size="xs" fw={600} mb={6}>Formati supportati:</Text>
                <Group gap="xs">
                  <Badge size="xs" variant="light" color="blue">Generale</Badge>
                  <Text size="xs" c="dimmed">Singolo file .xlsm</Text>
                </Group>
                <Group gap="xs" mt={4}>
                  <Badge size="xs" variant="light" color="green">Giornaliero</Badge>
                  <Text size="xs" c="dimmed">Singolo file .xlsx</Text>
                </Group>
                <Group gap="xs" mt={4}>
                  <Badge size="xs" variant="light" color="violet">Report</Badge>
                  <Text size="xs" c="dimmed">Cartella di ordini .xlsx</Text>
                </Group>
              </Box>

              <Group justify="flex-end" mt="xs" gap="sm">
                <Button variant="subtle" color="gray" onClick={onClose}>
                  Annulla
                </Button>
                <Button
                  onClick={avviaScansione}
                  disabled={fileItems.length === 0 || lockAltrui}
                  color="teal"
                >
                  Avvia Scansione
                </Button>
              </Group>
            </Stack>
          </motion.div>
            )}

        {/* Step 2: Scansione Asincrona */}
            {step === "scanning" && (
          <motion.div
            key="scanning"
            initial={ridurreAnimazioni ? {} : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={ridurreAnimazioni ? {} : { opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <Stack align="center" gap="lg" py="xl">
              <ImportIconAnimata color="blue" ridotte={ridurreAnimazioni} />
              
              <Stack gap="xs" style={{ width: "100%" }}>
                <Group justify="space-between">
                  <Text size="sm" fw={600}>Analisi dei file in corso...</Text>
                  <Text size="sm" fw={700}>{scanProgress}%</Text>
                </Group>
                <Progress value={scanProgress} color="blue" animated />
                <Text size="xs" c="dimmed" ta="center">Lettura, normalizzazione e confronto con le anagrafiche esistenti...</Text>
              </Stack>
            </Stack>
          </motion.div>
            )}

        {/* Error State */}
            {importError && step !== "scanning" && step !== "importing" && (
          <motion.div
            key="error"
            initial={ridurreAnimazioni ? {} : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <Stack gap="md" py="xs">
              <Box
                p="sm"
                style={{
                  background: "var(--mantine-color-red-light)",
                  border: "1px solid var(--mantine-color-red-light-hover)",
                  borderRadius: 8,
                }}
              >
                <Text size="sm" fw={600} c="red" mb={4}>Errore di lettura o accesso ai file</Text>
                <Text size="xs">{importError}</Text>
              </Box>
              <Text size="xs" c="dimmed">
                Assicurati che i file non siano aperti in Microsoft Excel e che i percorsi specificati siano corretti.
              </Text>
              <Group justify="flex-end" mt="xl">
                <Button variant="subtle" color="gray" onClick={() => setStep("paths")}>
                  Riprova
                </Button>
              </Group>
            </Stack>
          </motion.div>
            )}

        {/* Step 3: Risultati dell'Analisi / Review */}
            {step === "review" && !importError && (
          <motion.div
            key="review"
            initial={ridurreAnimazioni ? {} : { opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={ridurreAnimazioni ? {} : { opacity: 0, y: -15 }}
            transition={{ duration: 0.2 }}
          >
            <Stack gap="md">
              <Text size="sm" fw={600}>Scansione completata!</Text>
              
              <Box p="md" style={{ background: "var(--bg)", borderRadius: 8 }}>
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Righe storiche trovate:</Text>
                    <Text size="xs" fw={700}>{totalFound}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Righe scartate (note o vuote):</Text>
                    <Text size="xs" c="red" fw={600}>{skippedCount}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Clienti già presenti nel DB:</Text>
                    <Text size="xs" c="blue" fw={600}>{alreadyExistCount}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Da completare con campi vuoti:</Text>
                    <Text size="xs" c="blue" fw={600}>{clientsToComplete.length}</Text>
                  </Group>
                  <Box style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>Nuovi clienti da aggiungere:</Text>
                    <Text size="sm" c="teal" fw={700}>{newClients.length}</Text>
                  </Group>
                </Stack>
              </Box>

              <Group justify="flex-end" mt="xl" gap="sm">
                <Button variant="subtle" color="gray" onClick={() => setStep("paths")}>
                  Indietro
                </Button>
                {puoApplicareImport ? (
                  <Button color="teal" onClick={eseguiImportazione} disabled={lockAltrui}>
                    Applica importazione
                  </Button>
                ) : (
                  <Button variant="outline" color="gray" onClick={onClose}>
                    Chiudi
                  </Button>
                )}
              </Group>
            </Stack>
          </motion.div>
            )}

        {/* Step 4: Importazione in corso */}
            {step === "importing" && (
          <motion.div
            key="importing"
            initial={ridurreAnimazioni ? {} : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <Stack align="center" gap="lg" py="xl">
              <ImportIconAnimata color="teal" ridotte={ridurreAnimazioni} />
              
              <Stack gap="xs" style={{ width: "100%" }}>
                <Group justify="space-between">
                  <Text size="sm" fw={600}>Importazione in corso...</Text>
                  <Text size="sm" fw={700}>{importProgress}%</Text>
                </Group>
                <Progress value={importProgress} color="teal" animated />
                <Text size="xs" c="dimmed" ta="center">
                  Creo i clienti, completo le anagrafiche e unisco i duplicati sicuri...
                </Text>
              </Stack>
            </Stack>
          </motion.div>
            )}

        {/* Step 5: Completamento */}
            {step === "done" && (
          <motion.div
            key="done"
            initial={ridurreAnimazioni ? {} : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <Stack align="center" gap="md" pt="xs" pb={0}>
              {/* Contenitore con overflow hidden: l'animazione non può uscire dai bordi */}
              <Box style={{ position: "relative", width: 80, height: 80, flexShrink: 0 }}>
                {!ridurreAnimazioni && (
                  <motion.div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      background: "rgba(9, 180, 102, 0.22)",
                    }}
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: [0.4, 1, 0.85], opacity: [0, 0.9, 0] }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                  />
                )}
                <Box style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ThemeIcon size={70} radius="100%" color="teal">
                    <IconCheck size={36} />
                  </ThemeIcon>
                </Box>
              </Box>

              <Stack gap={2} align="center">
                <Text size="md" fw={700} ta="center">Importazione completata!</Text>
              </Stack>

              <Box p="sm" w="100%" style={{ background: "var(--bg)", borderRadius: 10 }}>
                <Stack gap={6}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" c="dimmed">Nuovi clienti creati</Text>
                    <Text size="sm" fw={700} c="teal">{createdCount}</Text>
                  </Group>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" c="dimmed">Anagrafiche completate</Text>
                    <Text size="sm" fw={700} c="blue">{updatedCount}</Text>
                  </Group>
                  {dedupResult && (
                    <>
                      <Box style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="sm" c="dimmed">Duplicati sicuri uniti</Text>
                        <Text size="sm" fw={700} c="teal">
                          {dedupResult.clientiUniti}
                          {dedupResult.gruppi ? ` in ${dedupResult.gruppi} gruppi` : ""}
                        </Text>
                      </Group>
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="sm" c="dimmed">Campi arricchiti dalla deduplica</Text>
                        <Text size="sm" fw={700}>{dedupResult.campiCompletati}</Text>
                      </Group>
                      {dedupResult.protetti > 0 && (
                        <Group justify="space-between" wrap="nowrap">
                          <Text size="sm" c="dimmed">Duplicati protetti non uniti</Text>
                          <Text size="sm" fw={700} c="orange.8">{dedupResult.protetti}</Text>
                        </Group>
                      )}
                      {dedupResult.saltati > 0 && (
                        <Group justify="space-between" wrap="nowrap">
                          <Text size="sm" c="dimmed">Unioni saltate per dati cambiati</Text>
                          <Text size="sm" fw={700} c="orange.8">{dedupResult.saltati}</Text>
                        </Group>
                      )}
                      {dedupResult.sospetti > 0 && (
                        <Group justify="space-between" wrap="nowrap">
                          <Text size="sm" c="dimmed">Gruppi ambigui non uniti</Text>
                          <Text size="sm" fw={700}>{dedupResult.sospetti}</Text>
                        </Group>
                      )}
                    </>
                  )}
                  {failedCount > 0 && (
                    <>
                      <Box style={{ borderTop: "1px solid var(--border)", margin: "2px 0" }} />
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="sm" c="red">Operazioni non riuscite</Text>
                        <Text size="sm" fw={700} c="red">{failedCount}</Text>
                      </Group>
                    </>
                  )}
                </Stack>
              </Box>

              <Button onClick={onClose} fullWidth color="teal">
                Completato
              </Button>
            </Stack>
          </motion.div>
            )}
          </AnimatePresence>
        </Box>
      </Box>
    </Modal>
  );
}
