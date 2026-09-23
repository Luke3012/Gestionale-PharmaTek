// Impostazioni: in 1B sono reali Profilo, Aspetto, Sincronizzazione, Aggiornamenti.
import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { IconAlertTriangle, IconDeviceFloppy, IconDownload, IconFolder, IconHistory, IconKeyboard, IconPlayerPlay, IconRestore, IconSearch, IconTrash, IconUpload, IconVolume } from "@tabler/icons-react";
import { SUONI } from "../features/notifiche/suoni";
import { riproduciSuono } from "../features/notifiche/suoni";
import { motion, useAnimationControls, type Variants } from "framer-motion";
import { api, inTauri, type BackupInfo, type Identity, type OperationProgress, type RestoreCoordination, type SnapshotInfo } from "../lib/tauri";
import { useOperationLockStatus } from "../lib/useOperationLockStatus";
import { ZOOM_UI_OPTIONS, usePrefs } from "../lib/prefs";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { leggiBaseProduzione, salvaBaseProduzione } from "../features/produzione/numeroProduzione";
import { OPZIONI_PERIODO } from "../features/dashboard/periodo";
import { Pagina } from "./Pagina";
import { toast } from "../ui/toast/store";
import { dialog } from "../ui/dialog/store";
import { Avatar, svuotaCacheAvatar } from "../ui/Avatar";
import { ImportAnagraficheModal } from "../features/anagrafiche/ImportAnagraficheModal";
import { ExportArubaModal } from "../features/anagrafiche/ExportArubaModal";
import { useDeepLink } from "../shell/navigazione";
import { useModalSnapshot } from "../ui/useModalSnapshot";
import { useRicaricaSuEventi } from "../lib/useRicaricaSuEventi";
import { PuliziaDatiBox } from "../features/impostazioni/PuliziaDatiBox";
import { registraPressioneReset, STATO_SEQUENZA_RESET_INIZIALE } from "../features/impostazioni/sequenzaReset";
import { ResetProgrammaView } from "../features/impostazioni/ResetProgrammaView";
import { ComunicazioniSettings } from "../features/comunicazioni/ComunicazioniSettings";
import { PremiumOnly, usePremiumAccess } from "../premium/PremiumAccess";
import { ConfigurazioneDocumentiSettings } from "../features/preventivi/ConfigurazioneDocumentiSettings";

type RestorePending = {
  zipPath: string;
  snapshotPathInZip?: string | null;
  mode: "auto" | "manual";
  descrizione: string;
};

const EVENTI_BASE_PRODUZIONE = ["impostazioni:salvato"] as const;

function operationId(kind: string) {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function eseguiConToastProgress<T>({
  kind,
  iniziale,
  run,
  successo,
  errore,
}: {
  kind: string;
  iniziale: string;
  run: (opId: string) => Promise<T>;
  successo: (res: T) => string;
  errore: string;
}): Promise<T> {
  const opId = operationId(kind);
  const toastId = toast.loading(iniziale, { progress: 1 });
  let off: (() => void) | undefined;
  try {
    if (inTauri) {
      const { listen } = await import("@tauri-apps/api/event");
      off = await listen<OperationProgress>("pt:operazione-progress", (ev) => {
        const p = ev.payload;
        if (!p || p.id !== opId) return;
        toast.update(toastId, {
          tipo: "loading",
          messaggio: p.message,
          durata: 0,
          progress: p.progress,
        });
      });
    }
    const res = await run(opId);
    toast.update(toastId, {
      tipo: "success",
      messaggio: successo(res),
      durata: 8000,
      progress: undefined,
    });
    return res;
  } catch (e) {
    toast.update(toastId, {
      tipo: "error",
      messaggio: `${errore}: ${e}`,
      durata: 20000,
      progress: undefined,
    });
    throw e;
  } finally {
    off?.();
  }
}

// La pagina esterna aspetta i dati; solo dopo le card entrano a cascata. Il
// wrapper usato dal masonry resta immobile, quindi il transform non ricalcola
// le colonne durante la transizione.
const contenitoreImpostazioni: Variants = {
  hidden: {},
  visibile: { transition: { staggerChildren: 0.03 } },
};
const elementoImpostazioni: Variants = {
  hidden: { opacity: 0, y: 18 },
  visibile: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 360, damping: 28 },
  },
};

function Sezione({ titolo, descrizione, children, className, id, azione }: { titolo: string; descrizione?: string; children: React.ReactNode; className?: string; id?: string; azione?: React.ReactNode }) {
  return (
    <div className={className} id={id}>
      <motion.div variants={elementoImpostazioni}>
        <Card withBorder radius="md" p="lg" style={{ alignSelf: "start" }}>
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Box style={{ minWidth: 0 }}>
              <Text fw={700} size="md">
                {titolo}
              </Text>
              {descrizione && (
                <Text size="xs" c="dimmed" mt={2}>
                  {descrizione}
                </Text>
              )}
            </Box>
            {azione}
          </Group>
          <Box mt="md">{children}</Box>
        </Card>
      </motion.div>
    </div>
  );
}

function RigaImpostazione({ titolo, descrizione, children, mt }: {
  titolo: string; descrizione: string; children: React.ReactNode; mt?: string | number;
}) {
  return (
    <Group mt={mt} justify="space-between" align="center" wrap="nowrap" gap="md">
      <Box style={{ minWidth: 0 }}>
        <Text size="sm" fw={600}>{titolo}</Text>
        <Text size="xs" c="dimmed">{descrizione}</Text>
      </Box>
      {children}
    </Group>
  );
}

function CestinoReset({
  ridurreAnimazioni,
  disabilitato,
  onApri,
}: {
  ridurreAnimazioni: boolean;
  disabilitato: boolean;
  onApri: () => void;
}) {
  const controlli = useAnimationControls();
  const [hover, setHover] = useState(false);

  const premi = () => {
    onApri();
    if (ridurreAnimazioni) return;
    void controlli.start({
      y: [0, -6, 2, 0],
      rotate: [0, 14, -10, 0],
      scale: [1, 1.12, 1],
      transition: { duration: 0.42, ease: "easeOut" },
    });
  };

  return (
    <Tooltip label="Cosa accadrà?" withArrow>
      <motion.div
        animate={controlli}
        onHoverStart={() => setHover(true)}
        onHoverEnd={() => setHover(false)}
        style={{ flex: "0 0 auto" }}
      >
        <ActionIcon
          variant="light"
          color="red"
          size="lg"
          radius="md"
          disabled={disabilitato}
          aria-label="Accesso rapido al reset del programma"
          onClick={premi}
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <motion.g
              animate={ridurreAnimazioni ? undefined : { rotate: hover ? -17 : 0, y: hover ? -1 : 0 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              style={{ transformOrigin: "5px 7px" }}
            >
              <path d="M4 7h16" />
              <path d="M9 7V4h6v3" />
            </motion.g>
            <path d="M6 7l1 14h10l1-14" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </ActionIcon>
      </motion.div>
    </Tooltip>
  );
}

export function Impostazioni({ identity }: { identity: Identity }) {
  const premium = usePremiumAccess();
  const { anno, ridurreAnimazioni, setRidurreAnimazioni, densitaTabelle, setDensitaTabelle, zoomUI, setZoomUI, ordineFinestra, setOrdineFinestra, cestinoGiorni, setCestinoGiorni, backupAuto, setBackupAuto, dashboardPeriodo, setDashboardPeriodo, filtriModo, setFiltriModo, hotkeyGlobale, setHotkeyGlobale, sogliaSolleciti, setSogliaSolleciti, giorniSollecitoPreventivi, setGiorniSollecitoPreventivi, anticipoPromemoria, setAnticipoPromemoria, balloonAttivo, setBalloonAttivo, notifichePrimoPiano, setNotifichePrimoPiano, suonoNotifica, setSuonoNotifica } = usePrefs();
  const [giorniPreventiviBozza, setGiorniPreventiviBozza] =
    useState<number | string>(giorniSollecitoPreventivi);
  const giorniPreventiviStabili = useDebouncedValue(giorniPreventiviBozza);
  useEffect(() => {
    setGiorniPreventiviBozza(giorniSollecitoPreventivi);
  }, [giorniSollecitoPreventivi]);
  useEffect(() => {
    if (giorniPreventiviStabili === "") return;
    const valore = Number(giorniPreventiviStabili);
    if (Number.isFinite(valore) && valore !== giorniSollecitoPreventivi) {
      setGiorniSollecitoPreventivi(valore);
    }
  }, [giorniPreventiviStabili, giorniSollecitoPreventivi, setGiorniSollecitoPreventivi]);
  const salvaGiorniPreventivi = useCallback(() => {
    const valore = Number(giorniPreventiviBozza);
    setGiorniSollecitoPreventivi(Number.isFinite(valore) ? valore : 7);
  }, [giorniPreventiviBozza, setGiorniSollecitoPreventivi]);
  const [resetAperto, setResetAperto] = useState(false);
  const [comunicazioniPronte, setComunicazioniPronte] = useState(false);
  const [documentiPronti, setDocumentiPronti] = useState(false);
  const segnalaComunicazioniPronte = useCallback(
    () => setComunicazioniPronte(true),
    [],
  );
  const segnalaDocumentiPronti = useCallback(
    () => setDocumentiPronti(true),
    [],
  );
  // I due pannelli segnalano il completamento del proprio caricamento solo
  // quando sono montati. Se Premium non è attivo, PremiumOnly non li monta:
  // non dobbiamo quindi restare in attesa delle loro callback e lasciare la
  // pagina invisibile dopo un ricaricamento.
  const impostazioniPronte =
    premium.loaded &&
    (!premium.enabled || (comunicazioniPronte && documentiPronti));
  const [resetPassoIniziale, setResetPassoIniziale] = useState<
    "scelta" | "ottimizza"
  >("scelta");
  const chiudiReset = useCallback(() => setResetAperto(false), []);
  const resetApertoRef = useRef(false);
  useEffect(() => {
    resetApertoRef.current = resetAperto;
  }, [resetAperto]);
  // N° di produzione iniziale: impostazione CONDIVISA (modello dati), non più per-PC.
  const [numeroProduzioneBase, setNumeroProduzioneBase] = useState<number | string>(1);
  const [baseProduzionePronta, setBaseProduzionePronta] = useState(false);
  const [baseProduzioneOccupata, setBaseProduzioneOccupata] = useState(false);
  const baseProduzioneSalvata = useRef(1);
  const baseProduzioneAlFocus = useRef(1);
  const baseProduzioneInModifica = useRef(false);
  const confermaBaseInCorso = useRef(false);
  useRicaricaSuEventi(EVENTI_BASE_PRODUZIONE, async () => {
    try {
      const base = await leggiBaseProduzione();
      baseProduzioneSalvata.current = base;
      setBaseProduzionePronta(true);
      if (!baseProduzioneInModifica.current && !confermaBaseInCorso.current) {
        setNumeroProduzioneBase(base);
      }
    } catch (error) {
      if (!baseProduzionePronta) toast.error(`Numero di produzione non disponibile: ${error}`);
    }
  }, 160, { caricamentoIniziale: true });

  async function confermaNumeroProduzioneBase() {
    baseProduzioneInModifica.current = false;
    if (confermaBaseInCorso.current || !baseProduzionePronta) return;
    const nuovo = typeof numeroProduzioneBase === "number"
      ? numeroProduzioneBase : Number(numeroProduzioneBase);
    if (!Number.isSafeInteger(nuovo) || nuovo < 1) {
      toast.error("Inserisci un numero di produzione intero maggiore di zero.");
      return;
    }
    const precedente = baseProduzioneAlFocus.current;
    if (nuovo === precedente) {
      setNumeroProduzioneBase(baseProduzioneSalvata.current);
      return;
    }
    confermaBaseInCorso.current = true;
    setBaseProduzioneOccupata(true);
    try {
      const confermato = await dialog.confirm(
        "Salvare il numero di produzione iniziale?",
        `Impostare ${nuovo} come base condivisa per le nuove produzioni? I numeri già assegnati resteranno invariati.`,
        { conferma: "Salva" },
      );
      if (!confermato) {
        setNumeroProduzioneBase(baseProduzioneSalvata.current);
        return;
      }
      const attuale = await leggiBaseProduzione();
      let atteso = precedente;
      if (attuale !== precedente) {
        baseProduzioneSalvata.current = attuale;
        const riconfermato = await dialog.confirm(
          "Numero aggiornato da un'altra postazione",
          `Nel frattempo il numero condiviso è diventato ${attuale}. Vuoi comunque impostarlo a ${nuovo}?`,
          { conferma: "Salva comunque" },
        );
        if (!riconfermato) {
          setNumeroProduzioneBase(attuale);
          return;
        }
        atteso = attuale;
      }
      await salvaBaseProduzione(atteso, nuovo);
      baseProduzioneSalvata.current = nuovo;
      setNumeroProduzioneBase(nuovo);
    } catch (error) {
      try { baseProduzioneSalvata.current = await leggiBaseProduzione(); } catch { /* conserva l'ultimo valore noto */ }
      toast.error(`Numero non salvato: ${error}`);
    } finally {
      confermaBaseInCorso.current = false;
      setBaseProduzioneOccupata(false);
    }
  }
  const [cartellaPrescrizioni, setCartellaPrescrizioni] = useState("");
  useEffect(() => {
    if (inTauri) {
      api.prescriptionsFolderGet().then((value) => setCartellaPrescrizioni(value.path)).catch(() => {});
    }
  }, []);

  async function scegliCartellaPrescrizioni() {
    const selected = await open({ directory: true, multiple: false, title: "Seleziona la cartella Prescrizioni" });
    if (typeof selected !== "string") return;
    try {
      const saved = await api.prescriptionsFolderSet(selected);
      setCartellaPrescrizioni(saved.path);
      toast.success("Cartella Prescrizioni aggiornata.");
    } catch (error) {
      toast.error(`Cartella non valida: ${error}`);
    }
  }
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backuppando, setBackuppando] = useState(false);
  const [lockStatus] = useOperationLockStatus(inTauri);
  const [autostart, setAutostart] = useState(false);
  const [shortcutRicercaDesktop, setShortcutRicercaDesktop] = useState(false);
  const [shortcutRicercaBusy, setShortcutRicercaBusy] = useState(false);
  const [backupManuale, setBackupManuale] = useState<BackupInfo | null>(null);
  const [snapshotManuali, setSnapshotManuali] = useState<SnapshotInfo[]>([]);
  const [snapshotScelto, setSnapshotScelto] = useState<string>("");
  const [caricandoSnapshot, setCaricandoSnapshot] = useState(false);
  const [ripristinoManualeInCorso, setRipristinoManualeInCorso] = useState(false);
  const [restoreCoord, setRestoreCoord] = useState<RestoreCoordination | null>(null);
  const [restorePending, setRestorePending] = useState<RestorePending | null>(null);
  const [restoreInCorso, setRestoreInCorso] = useState(false);
  const [restoreCoordMostrato, clearRestoreCoordMostrato] = useModalSnapshot(restoreCoord);
  const [restorePendingMostrato, clearRestorePendingMostrato] = useModalSnapshot(restorePending);

  const [modalImportAperto, setModalImportAperto] = useState(false);
  const [modalExportAperto, setModalExportAperto] = useState(false);

  const { link, consuma } = useDeepLink("/impostazioni");
  useEffect(() => {
    if (link) {
      if (link.azione === "importa_giornaliero") {
        setModalImportAperto(true);
        consuma();
      } else if (link.azione === "esporta_aruba") {
        setModalExportAperto(true);
        consuma();
      } else if (link.azione === "pulizia_dati") {
        window.requestAnimationFrame(() => {
          document.getElementById("impostazioni-pulizia-dati")?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        consuma();
      } else if (link.azione === "ottimizza_database") {
        setResetPassoIniziale("ottimizza");
        setResetAperto(true);
        consuma();
      }
    }
  }, [link, consuma]);

  function pulisciSnapshotRipristino() {
    clearRestoreCoordMostrato();
    clearRestorePendingMostrato();
  }

  useEffect(() => {
    if (!inTauri) return;
    import("@tauri-apps/plugin-autostart")
      .then(({ isEnabled }) => isEnabled())
      .then(setAutostart)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    let attivo = true;
    api.desktopSearchShortcutStatus()
      .then((presente) => {
        if (attivo) setShortcutRicercaDesktop(presente);
      })
      .catch(() => {});
    return () => {
      attivo = false;
    };
  }, []);

  useEffect(() => {
    if (!restoreCoord || restoreInCorso) return;
    let attivo = true;
    let ultimoRinnovoLock = Date.now();
    const aggiorna = async () => {
      try {
        if (Date.now() - ultimoRinnovoLock >= 5 * 60 * 1000) {
          ultimoRinnovoLock = Date.now();
          await api.rinnovaLock("preparazione_ripristino").catch(() => {});
        }
        const next = await api.restoreCoordinationStatus(restoreCoord.restoreId);
        if (attivo) setRestoreCoord(next);
      } catch {
        // best effort: se OneDrive sta ancora consegnando i file, il giro dopo riprova.
      }
    };
    const id = window.setInterval(() => void aggiorna(), 1200);
    void aggiorna();
    return () => {
      attivo = false;
      window.clearInterval(id);
    };
  }, [restoreCoord?.restoreId, restoreInCorso]);

  async function toggleAutostart(on: boolean) {
    try {
      const { enable, disable } = await import("@tauri-apps/plugin-autostart");
      if (on) {
        // Prima rendiamo raggiungibile il processo dalla tray, poi abilitiamo
        // l'avvio nascosto. Se l'autostart fallisce, rimuoviamo l'icona appena
        // creata e conserviamo lo stato precedente.
        await api.traySet(true);
        try {
          await enable();
        } catch (errore) {
          await api.traySet(false).catch(() => {});
          throw errore;
        }
      } else {
        await disable();
        await api.traySet(false);
      }
      setAutostart(on);
      toast.success(on ? "Avvio automatico attivato." : "Avvio automatico disattivato.");
    } catch (e) {
      toast.error(`Impostazione non riuscita: ${e}`);
    }
  }

  async function creaShortcutRicercaDesktop() {
    setShortcutRicercaBusy(true);
    try {
      await api.desktopSearchShortcutCreate();
      setShortcutRicercaDesktop(true);
      toast.success("Icona desktop per la ricerca creata.");
    } catch (e) {
      toast.error(`Creazione icona non riuscita: ${e}`);
    } finally {
      setShortcutRicercaBusy(false);
    }
  }

  async function rimuoviShortcutRicercaDesktop() {
    setShortcutRicercaBusy(true);
    try {
      await api.desktopSearchShortcutRemove();
      setShortcutRicercaDesktop(false);
      toast.success("Icona desktop per la ricerca rimossa.");
    } catch (e) {
      toast.error(`Rimozione icona non riuscita: ${e}`);
    } finally {
      setShortcutRicercaBusy(false);
    }
  }

  async function caricaBackup() {
    try {
      setBackups(await api.listaBackup());
    } catch {
      /* lista resta vuota */
    }
  }

  useEffect(() => {
    if (!inTauri) return;
    let offBackupAuto: (() => void) | undefined;
    void caricaBackup();
    const onFocus = () => void caricaBackup();
    const onBackupAuto = () => void caricaBackup();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "pt.toastAutoBackup") void caricaBackup();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("pt:backup-auto-eseguito", onBackupAuto);
    window.addEventListener("storage", onStorage);
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen("pt:backup-auto-eseguito", () => void caricaBackup()))
      .then((off) => (offBackupAuto = off))
      .catch(() => {});
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pt:backup-auto-eseguito", onBackupAuto);
      window.removeEventListener("storage", onStorage);
      offBackupAuto?.();
    };
  }, []);

  async function eseguiBackup() {
    setBackuppando(true);
    try {
      await eseguiConToastProgress({
        kind: "backup",
        iniziale: "Backup in preparazione...",
        run: (opId) => api.backupNowProgress(opId),
        successo: () => "Backup effettuato.",
        errore: "Backup non riuscito",
      });
      await caricaBackup();
    } catch {
      /* il toast progressivo mostra già l'errore */
    } finally {
      setBackuppando(false);
    }
  }

  async function backupIn() {
    try {
      const dir = await open({ directory: true, title: "Scegli dove salvare la copia di backup" });
      if (typeof dir !== "string") return;
      setBackuppando(true);
      await eseguiConToastProgress({
        kind: "backup",
        iniziale: "Copia di backup in preparazione...",
        run: (opId) => api.backupNowProgress(opId, dir),
        successo: () => "Copia di backup salvata.",
        errore: "Backup non riuscito",
      });
    } catch {
      /* il toast progressivo mostra già l'errore */
    } finally {
      setBackuppando(false);
    }
  }

  async function ripristinaDaFile() {
    try {
      const file = await open({
        title: "Scegli il file di backup da ripristinare",
        filters: [{ name: "Backup", extensions: ["zip"] }],
      });
      if (typeof file !== "string") return;
      const ok = await dialog.confirmDanger(
        "Ripristinare questo backup?",
        "I dati attuali (anche sugli altri PC sincronizzati) verranno sostituiti con quelli del " +
          "backup scelto. Operazione irreversibile.",
        { conferma: "Ripristina" }
      );
      if (!ok) return;
      await avviaRipristinoCoordinato({
        zipPath: file,
        mode: "auto",
        descrizione: "Backup selezionato da file",
      });
    } catch (e) {
      toast.error(`Ripristino non riuscito: ${e}`);
    }
  }

  async function apriCartellaBackup() {
    try {
      await api.apriCartellaBackup();
    } catch (e) {
      toast.error(`Apertura cartella non riuscita: ${e}`);
    }
  }

  async function ripristinaSalvato(b: BackupInfo) {
    const ok = await dialog.confirmDanger(
      `Ripristinare il backup del ${dataOra(b.ms)}?`,
      "I dati attuali (anche sugli altri PC sincronizzati) verranno sostituiti con quelli del " +
        "backup scelto. Operazione irreversibile.",
      { conferma: "Ripristina" }
    );
    if (!ok) return;
    try {
      await avviaRipristinoCoordinato({
        zipPath: b.path,
        mode: "auto",
        descrizione: `Backup del ${dataOra(b.ms)}`,
      });
    } catch (e) {
      toast.error(`Ripristino non riuscito: ${e}`);
    }
  }

  async function avviaRipristinoCoordinato(pending: RestorePending) {
    setRestorePending(pending);
    try {
      const coord = await api.restorePrepare();
      setRestoreCoord(coord);
    } catch (e) {
      setRestorePending(null);
      throw e;
    }
  }

  async function annullaRipristinoCoordinato() {
    const restoreId = restoreCoord?.restoreId;
    setRestoreCoord(null);
    setRestorePending(null);
    setRestoreInCorso(false);
    if (restoreId) {
      const errore = await api.restoreCancel(restoreId).then(() => null, (e) => e);
      await import("@tauri-apps/api/event")
        .then(({ emit }) => emit("pt:restore-cancelled", { restoreId }))
        .catch(() => {});
      if (errore) {
        toast.error(`Annullamento ripristino non riuscito: ${errore}`);
      }
    }
  }

  async function procediRipristinoCoordinato() {
    if (!restorePending) return;
    setRestoreInCorso(true);
    try {
      await api.ripristinaBackup(
        restorePending.zipPath,
        restorePending.snapshotPathInZip ?? null,
        restorePending.mode,
        restoreCoord?.restoreId ?? null
      );
      svuotaCacheAvatar();
      location.reload();
    } catch (e) {
      toast.error(`Ripristino non riuscito: ${e}`);
      setRestoreInCorso(false);
    }
  }

  async function apriRipristinoManuale(b: BackupInfo) {
    setBackupManuale(b);
    setSnapshotManuali([]);
    setSnapshotScelto("");
    setCaricandoSnapshot(true);
    try {
      const choices = await api.backupSnapshotChoices(b.path);
      setSnapshotManuali(choices);
      setSnapshotScelto(choices.find((s) => s.recommended && s.safe)?.pathInZip ?? choices.find((s) => s.safe)?.pathInZip ?? "");
    } catch (e) {
      toast.error(`Lettura snapshot non riuscita: ${e}`);
      setBackupManuale(null);
    } finally {
      setCaricandoSnapshot(false);
    }
  }

  async function confermaRipristinoManuale() {
    if (!backupManuale || !snapshotScelto) return;
    const scelto = snapshotManuali.find((s) => s.pathInZip === snapshotScelto);
    const ok = await dialog.confirmDanger(
      "Ripristino manuale",
      `Ripristinare il backup del ${dataOra(backupManuale.ms)} usando la copia di ${scelto?.deviceNome || scelto?.deviceId || "un dispositivo"}?\n\n` +
        "I dati attuali verranno sostituiti. Operazione irreversibile.",
      { conferma: "Ripristina" }
    );
    if (!ok) return;
    setRipristinoManualeInCorso(true);
    try {
      await avviaRipristinoCoordinato({
        zipPath: backupManuale.path,
        snapshotPathInZip: snapshotScelto,
        mode: "manual",
        descrizione: `Backup del ${dataOra(backupManuale.ms)} · copia ${scelto?.deviceNome || scelto?.deviceId || ""}`,
      });
      setBackupManuale(null);
    } catch (e) {
      toast.error(`Ripristino manuale non riuscito: ${e}`);
    } finally {
      setRipristinoManualeInCorso(false);
    }
  }

  async function eliminaSalvato(b: BackupInfo) {
    const ok = await dialog.confirmDanger(
      `Eliminare il backup del ${dataOra(b.ms)}?`,
      "Il file di backup verrà cancellato definitivamente da questa cartella.",
      { conferma: "Elimina" }
    );
    if (!ok) return;
    try {
      await api.eliminaBackup(b.path);
      toast.success("Backup eliminato.");
      caricaBackup();
    } catch (e) {
      toast.error(`Eliminazione non riuscita: ${e}`);
    }
  }

  // Modalità demo nascosta: digitare in sequenza «d-e-m-o» in questa pagina apre un
  // chooser (popola / azzera). Stessa filosofia del reset (Canc ×5): niente box a vista.
  useEffect(() => {
    if (!inTauri) return;
    const target = "demo";
    let idx = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inCorso = false;

    async function apriDemo() {
      const scelta = await dialog.open<"popola" | "azzera" | null>({
        tipo: "info",
        titolo: "Dati demo",
        valoreAnnulla: null,
        contenuto: (
          <Stack gap={8}>
            <Text size="sm">
              Dati di prova per esplorare il programma (<b>non</b> sono dati reali). Agenti, medici
              e prodotti di default ci sono già dall'installazione.
            </Text>
            <Text size="sm">
              <b>Popola</b> aggiunge ~130 ordini vari (Immunoterapia, Diagnostica, Keriba) con
              clienti (un cliente ha più ordini) e rifà eventuali demo precedenti. <b>Azzera</b> li
              rimuove tutti.
            </Text>
          </Stack>
        ),
        bottoni: [
          { label: "Annulla", variante: "secondario", value: null },
          { label: "Azzera dati demo", variante: "pericolo", value: "azzera" },
          { label: "Popola dati demo", variante: "primario", value: "popola" },
        ],
      });
      if (!scelta) return;
      try {
        if (scelta === "popola") {
          await eseguiConToastProgress({
            kind: "demo",
            iniziale: "Importazione dati demo in preparazione...",
            run: (opId) => api.popolaDemoProgress(opId),
            successo: (n) => `Creati ${n} ordini demo.`,
            errore: "Operazione demo non riuscita",
          });
        } else {
          await eseguiConToastProgress({
            kind: "demo",
            iniziale: "Pulizia dati demo in preparazione...",
            run: (opId) => api.azzeraDemoProgress(opId),
            successo: (n) => (n > 0 ? `Rimossi ${n} ordini demo.` : "Nessun ordine demo da rimuovere."),
            errore: "Operazione demo non riuscita",
          });
        }
      } catch {
        /* il toast progressivo mostra già l'errore */
      }
    }

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k.length !== 1 || k < "a" || k > "z") return; // solo lettere fanno avanzare/azzerano
      idx = k === target[idx] ? idx + 1 : k === target[0] ? 1 : 0;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (idx = 0), 1500);
      if (idx >= target.length) {
        idx = 0;
        if (!inCorso) {
          inCorso = true;
          void apriDemo().finally(() => (inCorso = false));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Percorso della cartella backup (per la sola visualizzazione).
  const percorsoBackup = identity.dataDir
    ? `${identity.dataDir.replace(/[\\/]$/, "")}\\backups`
    : "—";
  const backupOrdinati = [...backups].sort((a, b) => b.ms - a.ms);
  const lockAltrui = !!lockStatus?.active && !lockStatus.own;

  // Scorciatoia nascosta: premere "Canc" 5 volte di fila in questa pagina.
  // Il cestino apre la stessa view con un clic e non altera la sequenza da tastiera.
  useEffect(() => {
    if (!inTauri) return;
    let sequenza = STATO_SEQUENZA_RESET_INIZIALE;

    const registraPressione = () => {
      const esito = registraPressioneReset(sequenza, Date.now());
      sequenza = esito.stato;
      if (esito.attiva && !resetApertoRef.current) {
        setResetPassoIniziale("scelta");
        setResetAperto(true);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      registraPressione();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Pagina
      titolo="Impostazioni"
      caricamento={!impostazioniPronte}
    >
      <motion.div
        className="pt-impostazioni-masonry"
        style={{ maxWidth: 1100, marginLeft: "auto", marginRight: "auto" }}
        variants={contenitoreImpostazioni}
        initial="hidden"
        animate={impostazioniPronte ? "visibile" : "hidden"}
      >
        <Sezione
          className="pt-comunicazioni-span"
          titolo="E-mail e comunicazioni"
          descrizione="Casella mittente, modelli e gestione dei preventivi."
        >
          <Stack gap="lg">
            <PremiumOnly>
              <Stack gap="lg">
              <ComunicazioniSettings onReady={segnalaComunicazioniPronte} />
              <ConfigurazioneDocumentiSettings
                onReady={segnalaDocumentiPronti}
              />
              </Stack>
            </PremiumOnly>

            <RigaImpostazione
              titolo="Sollecita i preventivi"
              descrizione="Attesa prima di proporre l’invio o il sollecito di un preventivo."
            >
              <NumberInput
                value={giorniPreventiviBozza}
                onChange={(value) =>
                  setGiorniPreventiviBozza(value)
                }
                onBlur={salvaGiorniPreventivi}
                onKeyDown={(event) => {
                  if (event.key === "Enter") salvaGiorniPreventivi();
                }}
                min={0}
                max={90}
                step={1}
                suffix={giorniSollecitoPreventivi === 1 ? " giorno" : " giorni"}
                w={150}
                style={{ flexShrink: 0 }}
              />
            </RigaImpostazione>
          </Stack>
        </Sezione>

        <Sezione titolo="Dashboard" descrizione="Preferenze della home.">
          <Select
            label="Periodo predefinito"
            description="Periodo iniziale della dashboard."
            data={OPZIONI_PERIODO}
            value={dashboardPeriodo}
            onChange={(v) => v && setDashboardPeriodo(v as typeof dashboardPeriodo)}
            allowDeselect={false}
          />
        </Sezione>

        <Sezione titolo="Notifiche" descrizione="Campanella, suoni e pop-up.">
          <Stack gap="md">
            <RigaImpostazione
              titolo="Sollecita i pagamenti"
              descrizione="Quando mostrare un pagamento scaduto."
            >
              <Select
                data={[
                  { value: "0", label: "Dal giorno stesso" },
                  { value: "3", label: "Dopo 3 giorni" },
                  { value: "7", label: "Dopo 7 giorni" },
                  { value: "14", label: "Dopo 14 giorni" },
                ]}
                value={String(sogliaSolleciti)}
                onChange={(v) => setSogliaSolleciti(Number(v ?? 0))}
                allowDeselect={false}
                w={180}
                style={{ flexShrink: 0 }}
              />
            </RigaImpostazione>

            <RigaImpostazione
              titolo="Avviso anticipato promemoria"
              descrizione="Giorni di anticipo proposti nei nuovi promemoria."
            >
              <NumberInput
                value={anticipoPromemoria}
                onChange={(v) => setAnticipoPromemoria(typeof v === "number" ? v : 0)}
                min={0}
                max={30}
                step={1}
                suffix={anticipoPromemoria === 1 ? " giorno" : " giorni"}
                w={150}
                style={{ flexShrink: 0 }}
              />
            </RigaImpostazione>

            <Switch
              checked={balloonAttivo}
              onChange={(e) => setBalloonAttivo(e.currentTarget.checked)}
              disabled={!inTauri}
              label="Pop-up notifiche"
              description="Mostra i pop-up per le notifiche nuove."
            />

            <Switch
              checked={notifichePrimoPiano}
              onChange={(e) => setNotifichePrimoPiano(e.currentTarget.checked)}
              disabled={!inTauri || !balloonAttivo}
              label="Anche con l'app in primo piano"
              description="Mostra i pop-up anche mentre usi PharmaTek."
            />

            <Box>
              <Text size="sm" fw={600} mb={4}>
                Suono di notifica
              </Text>
              <Group gap="sm" wrap="nowrap" align="flex-end">
                <Select
                  leftSection={<IconVolume size={16} />}
                  data={SUONI.map((s) => ({ value: s.value, label: s.label }))}
                  value={suonoNotifica}
                  onChange={(v) => {
                    if (!v) return;
                    setSuonoNotifica(v);
                    if (v !== "nessuno") riproduciSuono(v);
                  }}
                  allowDeselect={false}
                  style={{ flex: 1 }}
                />
                <Tooltip label="Ascolta" withArrow>
                  <ActionIcon
                    variant="default"
                    size={36}
                    disabled={suonoNotifica === "nessuno"}
                    onClick={() => riproduciSuono(suonoNotifica)}
                    aria-label="Ascolta il suono"
                  >
                    <IconPlayerPlay size={18} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Box>
          </Stack>
        </Sezione>

        <Sezione titolo="Backup" descrizione="Copie di sicurezza dei dati.">
          <Group gap="sm">
            <Button variant="default" leftSection={<IconDeviceFloppy size={16} />} loading={backuppando} disabled={!inTauri} onClick={eseguiBackup}>
              Backup ora
            </Button>
            <Button variant="subtle" color="gray" disabled={!inTauri || backuppando} onClick={backupIn}>
              Salva copia…
            </Button>
            <Button variant="subtle" color="gray" leftSection={<IconUpload size={16} />} disabled={!inTauri || lockAltrui} onClick={ripristinaDaFile}>
              Ripristina da…
            </Button>
          </Group>
          {lockAltrui && lockStatus && (
            <Alert color="orange" variant="light" mt="sm" py="xs">
              <Text size="xs">
                Operazione in corso su {lockStatus.deviceNome}: {lockStatus.azione}. Ripristino momentaneamente bloccato.
              </Text>
            </Alert>
          )}
          <RigaImpostazione
            titolo="Backup automatico"
            descrizione="Crea backup periodici in background."
            mt="md"
          >
            <Select
              data={[
                { value: "0", label: "Mai" },
                { value: "1", label: "Giornaliero" },
                { value: "7", label: "Settimanale" },
                { value: "14", label: "Ogni 2 settimane" },
                { value: "30", label: "Ogni mese" },
              ]}
              value={String(backupAuto)}
              onChange={(v) => {
                setBackupAuto(Number(v ?? 0));
                window.setTimeout(() => void caricaBackup(), 250);
              }}
              allowDeselect={false}
              w={150}
              style={{ flexShrink: 0 }}
            />
          </RigaImpostazione>
          <Box mt="md">
            <Group justify="space-between" mb="xs">
              <Text size="sm" fw={600}>
                Backup salvati
              </Text>
              <Anchor size="xs" component="button" type="button" onClick={apriCartellaBackup}>
                Apri cartella
              </Anchor>
            </Group>
            {backupOrdinati.length === 0 ? (
              <Text size="xs" c="dimmed">
                Nessun backup ancora. Usa «Backup ora» per crearne uno.
              </Text>
            ) : (
              <Box
                style={{
                  maxHeight: 272,
                  overflowY: "auto",
                  overflowX: "hidden",
                  overscrollBehavior: "contain",
                  paddingRight: 4,
                }}
              >
                <Stack gap={6}>
                  {backupOrdinati.map((b) => (
                    <Card key={b.path} withBorder radius="md" p="xs" style={{ overflow: "hidden" }}>
                      <Group justify="space-between" wrap="nowrap" gap="sm">
                        <Box style={{ minWidth: 0, overflow: "hidden" }}>
                          <Text size="sm" fw={500} truncate>
                            {dataOra(b.ms)}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            {formatBytes(b.size)}
                          </Text>
                        </Box>
                        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                          <Tooltip label="Ripristina" withArrow>
                            <ActionIcon variant="subtle" color="gray" disabled={!inTauri || lockAltrui} onClick={() => ripristinaSalvato(b)} aria-label="Ripristina backup">
                              <IconHistory size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Ripristino manuale" withArrow>
                            <ActionIcon variant="subtle" color="blue" disabled={!inTauri || lockAltrui} onClick={() => apriRipristinoManuale(b)} aria-label="Ripristino manuale">
                              <IconRestore size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Elimina" withArrow>
                            <ActionIcon variant="subtle" color="red" disabled={!inTauri} onClick={() => eliminaSalvato(b)} aria-label="Elimina backup">
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>
                    </Card>
                  ))}
                </Stack>
              </Box>
            )}
            <Text size="xs" c="dimmed" mt="xs" style={{ wordBreak: "break-all" }}>
              Cartella: {percorsoBackup}
            </Text>
          </Box>
        </Sezione>

        <Sezione
          id="impostazioni-pulizia-dati"
          titolo="Pulizia dati"
          descrizione="Eliminazione definitiva con anteprima e backup."
          azione={
            <CestinoReset
              ridurreAnimazioni={ridurreAnimazioni}
              disabilitato={!inTauri}
              onApri={() => {
                if (!resetApertoRef.current) {
                  setResetPassoIniziale("scelta");
                  setResetAperto(true);
                }
              }}
            />
          }
        >
          <PuliziaDatiBox anno={anno} onBackupCleaned={caricaBackup} />
        </Sezione>

        <Sezione className="pt-sezione-span" titolo="Gestione Anagrafiche Esterne" descrizione="Importa clienti storici o esporta per Aruba.">
          <Box
            mt="xs"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
              gap: 16,
            }}
          >
            {[
              {
                colore: "blue",
                icona: <IconDownload size={24} />,
                titolo: "Importa Clienti Storici",
                descrizione: "Importa dai vecchi Excel solo i clienti mancanti.",
                onClick: () => setModalImportAperto(true),
              },
              {
                colore: "teal",
                icona: <IconUpload size={24} />,
                titolo: "Esporta per Aruba",
                descrizione: "Crea l'Excel Aruba per i nuovi clienti.",
                onClick: () => setModalExportAperto(true),
              },
            ].map(({ colore, icona, titolo, descrizione, onClick }) => (
              <Card
                key={titolo}
                withBorder
                radius="md"
                p="md"
                style={{ cursor: "pointer", transition: "border-color 0.2s, background-color 0.2s", background: "var(--mantine-color-body)" }}
                component={motion.div}
                whileHover={ridurreAnimazioni ? {} : { scale: 1.02, y: -4, boxShadow: "var(--mantine-shadow-md)" }}
                whileTap={ridurreAnimazioni ? {} : { scale: 0.98 }}
                onClick={onClick}
              >
                <Group gap="md" wrap="nowrap" align="flex-start">
                  <ThemeIcon size={44} radius="md" variant="light" color={colore}>{icona}</ThemeIcon>
                  <Stack gap={4} style={{ minWidth: 0 }}>
                    <Text fw={700} size="sm">{titolo}</Text>
                    <Text size="xs" c="dimmed">{descrizione}</Text>
                  </Stack>
                </Group>
              </Card>
            ))}
          </Box>
        </Sezione>

        <Sezione titolo="Produzione" descrizione="Numerazione Laboratorio e documenti delle terapie.">
          <Stack gap="md">
            <RigaImpostazione
              titolo="N° di produzione iniziale"
              descrizione="Numero da cui partire. Poi continua da solo."
            >
              <NumberInput
                min={1}
                max={Number.MAX_SAFE_INTEGER}
                allowDecimal={false}
                allowNegative={false}
                clampBehavior="none"
                value={numeroProduzioneBase}
                onFocus={() => {
                  baseProduzioneInModifica.current = true;
                  baseProduzioneAlFocus.current = baseProduzioneSalvata.current;
                }}
                onChange={setNumeroProduzioneBase}
                onBlur={() => void confermaNumeroProduzioneBase()}
                disabled={!baseProduzionePronta || baseProduzioneOccupata}
                w={120}
                style={{ flexShrink: 0 }}
              />
            </RigaImpostazione>
            <Box>
              <RigaImpostazione
                titolo="Cartella Prescrizioni"
                descrizione="Usata localmente per creare lo ZIP delle terapie; non viene sincronizzata."
              >
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconFolder size={15} />}
                  onClick={() => void scegliCartellaPrescrizioni()}
                  disabled={!inTauri}
                  style={{ flexShrink: 0 }}
                >
                  Cambia
                </Button>
              </RigaImpostazione>
              <Paper
                withBorder
                radius="sm"
                p="xs"
                mt="xs"
                bg="var(--mantine-color-default-hover)"
                style={{ wordBreak: "break-all" }}
              >
                <Text size="xs" c={cartellaPrescrizioni ? undefined : "dimmed"}>
                  {cartellaPrescrizioni || "Nessuna cartella selezionata (verrà richiesta al primo utilizzo)"}
                </Text>
              </Paper>
            </Box>
          </Stack>
        </Sezione>


        <Sezione titolo="Sistema" descrizione="Avvio, tray e ricerca globale.">
          <Stack gap="md">
            <Switch
              checked={autostart}
              onChange={(e) => toggleAutostart(e.currentTarget.checked)}
              disabled={!inTauri}
              label="Avvia con Windows"
              description="Parte con Windows e resta nella barra di sistema."
            />
            <Text size="xs" c="dimmed">
              {autostart
                ? "La X riduce PharmaTek nella barra di sistema. Per uscire usa l'icona vicino all'orologio."
                : "Se lo attivi, la X riduce PharmaTek nella barra di sistema."}
            </Text>
            <Select
              label="Scorciatoia di ricerca globale"
              description="Apre la ricerca anche fuori dall'app."
              leftSection={<IconKeyboard size={16} />}
              data={[
                { value: "Alt+P", label: "Alt + P (consigliata)" },
                { value: "Alt+G", label: "Alt + G" },
                { value: "CommandOrControl+Alt+P", label: "Ctrl + Alt + P" },
                { value: "CommandOrControl+Alt+K", label: "Ctrl + Alt + K" },
                { value: "CommandOrControl+Alt+Space", label: "Ctrl + Alt + Spazio" },
              ]}
              value={hotkeyGlobale}
              onChange={(v) => v && setHotkeyGlobale(v)}
              allowDeselect={false}
              disabled={!inTauri}
            />
            <Group justify="space-between" align="center" wrap="nowrap" gap="md">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <ThemeIcon variant="light" color="gray" size={36} radius="md">
                  <IconSearch size={19} />
                </ThemeIcon>
                <Box style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600}>
                    Icona desktop ricerca
                  </Text>
                  <Text size="xs" c="dimmed">
                    Apre direttamente la ricerca globale.
                  </Text>
                </Box>
              </Group>
              <Group gap="xs" wrap="nowrap">
                <Button
                  variant={shortcutRicercaDesktop ? "default" : "light"}
                  color="accent"
                  size="compact-sm"
                  leftSection={<IconSearch size={15} />}
                  loading={shortcutRicercaBusy}
                  disabled={!inTauri || shortcutRicercaBusy}
                  onClick={() => void creaShortcutRicercaDesktop()}
                >
                  {shortcutRicercaDesktop ? "Aggiorna" : "Crea"}
                </Button>
                {shortcutRicercaDesktop && (
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label="Rimuovi icona desktop ricerca"
                    title="Rimuovi icona desktop ricerca"
                    loading={shortcutRicercaBusy}
                    disabled={!inTauri || shortcutRicercaBusy}
                    onClick={() => void rimuoviShortcutRicercaDesktop()}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </Group>
            </Group>
          </Stack>
        </Sezione>

        <Sezione titolo="Aspetto">
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Switch
                checked={ridurreAnimazioni}
                onChange={(e) => setRidurreAnimazioni(e.currentTarget.checked)}
                label="Riduci animazioni"
                description="Transizioni più leggere."
              />
              <Switch
                checked={densitaTabelle === "compatta"}
                onChange={(e) => setDensitaTabelle(e.currentTarget.checked ? "compatta" : "standard")}
                label="Tabelle compatte"
                description="Righe più dense."
              />
            </SimpleGrid>
            <Select
              label="Zoom interfaccia"
              description="Dimensione generale dell'interfaccia."
              data={ZOOM_UI_OPTIONS}
              value={String(zoomUI)}
              onChange={(v) => v && setZoomUI(Number(v))}
              allowDeselect={false}
            />
            <Select
              label="Ordini, preventivi e promemoria in finestra separata"
              description="Scegli quando usare una finestra esterna."
              data={[
                { value: "mai", label: "Mai (usa le modali)" },
                { value: "modifica", label: "Solo in modifica (consigliato)" },
                { value: "sempre", label: "Sempre (anche i nuovi)" },
              ]}
              value={ordineFinestra}
              onChange={(v) => v && setOrdineFinestra(v as typeof ordineFinestra)}
            />
            <Select
              label="Filtri delle liste"
              description="Come mostrare i filtri nelle liste."
              data={[
                { value: "compatti", label: "Compatti (tutto nel menu «Filtri»)" },
                { value: "auto", label: "Automatico (in linea se c'è spazio)" },
                { value: "espansi", label: "Espansi (tutti in linea)" },
              ]}
              value={filtriModo}
              onChange={(v) => v && setFiltriModo(v as typeof filtriModo)}
            />
            <Select
              label="Svuota il Cestino dopo"
              description="Elimina automaticamente gli elementi vecchi."
              data={[
                { value: "30", label: "30 giorni" },
                { value: "60", label: "60 giorni" },
                { value: "90", label: "90 giorni" },
                { value: "180", label: "6 mesi" },
                { value: "365", label: "1 anno" },
                { value: "0", label: "Mai" },
              ]}
              value={String(cestinoGiorni)}
              onChange={(v) => v != null && setCestinoGiorni(Number(v))}
            />
          </Stack>
        </Sezione>


        <Modal
          opened={!!restoreCoord}
          onClose={() => {
            if (!restoreInCorso) void annullaRipristinoCoordinato();
          }}
          title={
            <Group gap="xs">
              <ThemeIcon size={30} radius="md" variant="light" color="red">
                <IconRestore size={18} />
              </ThemeIcon>
              <Text fw={700}>Ripristino coordinato</Text>
            </Group>
          }
          centered
          size="lg"
          closeOnClickOutside={!restoreInCorso}
          closeOnEscape={!restoreInCorso}
          transitionProps={{ transition: "fade", duration: 180, onExited: pulisciSnapshotRipristino }}
        >
          <Stack gap="sm">
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />}>
              <Text size="sm">
                Le altre postazioni vengono avvisate e bloccano le operazioni prima del ripristino.
                Procedi quando i PC attesi hanno risposto, oppure continua consapevolmente se una
                postazione è spenta o non sincronizzata.
              </Text>
            </Alert>
            {restorePendingMostrato && (
              <Text size="sm" c="dimmed">
                {restorePendingMostrato.descrizione}
              </Text>
            )}
            {restoreCoordMostrato && (
              <>
                <Group justify="space-between">
                  <Box>
                    <Text size="sm" fw={700}>
                      Postazioni avvisate
                    </Text>
                    <Text size="xs" c="dimmed">
                      {restoreCoordMostrato.acknowledged} di {restoreCoordMostrato.expectedCount} confermate
                    </Text>
                  </Box>
                  <Badge color={restoreCoordMostrato.acknowledged >= restoreCoordMostrato.expectedCount ? "green" : "yellow"} size="lg">
                    {restoreCoordMostrato.acknowledged}/{restoreCoordMostrato.expectedCount}
                  </Badge>
                </Group>
                <Stack gap={8}>
                  {restoreCoordMostrato.expected.map((d) => {
                    const ack = restoreCoordMostrato.acks.find((a) => a.deviceId === d.deviceId);
                    return (
                      <Group
                        key={d.deviceId}
                        justify="space-between"
                        p="sm"
                        style={{
                          border: "1px solid #e9ecef",
                          borderRadius: 10,
                          background: ack ? "#ebfbee" : "#fff9db",
                        }}
                      >
                        <Group gap="sm">
                          <Avatar tipo={d.avatarTipo} valore={d.avatarValore} nome={d.userNome || d.nome} size={34} />
                          <Box>
                            <Text size="sm" fw={700}>
                              {d.nome || d.deviceId}
                              {d.isCurrent ? " · questo PC" : ""}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {d.userNome || "Utente non associato"}
                            </Text>
                          </Box>
                        </Group>
                        <Badge color={ack ? "green" : "yellow"} variant="light">
                          {ack ? "Ricevuto" : "In attesa"}
                        </Badge>
                      </Group>
                    );
                  })}
                </Stack>
              </>
            )}
            <Group justify="flex-end" mt="sm">
              <Button variant="default" disabled={restoreInCorso} onClick={() => void annullaRipristinoCoordinato()}>
                Annulla
              </Button>
              <Button color="red" loading={restoreInCorso} onClick={() => void procediRipristinoCoordinato()}>
                Procedi con il ripristino
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={!!backupManuale}
          onClose={() => {
            if (!ripristinoManualeInCorso) setBackupManuale(null);
          }}
          title={
            <Group gap="xs">
              <ThemeIcon size={30} radius="md" variant="light" color="blue">
                <IconRestore size={18} />
              </ThemeIcon>
              <Text fw={700}>Ripristino manuale</Text>
            </Group>
          }
          centered
          size="lg"
        >
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Scegli quale copia ripristinare.
            </Text>
            {caricandoSnapshot ? (
              <Text size="sm" c="dimmed">Controllo backup...</Text>
            ) : snapshotManuali.length === 0 ? (
              <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                Nessuna copia leggibile trovata in questo backup.
              </Alert>
            ) : (
              <Stack gap="xs">
                {snapshotManuali.map((s) => {
                  const selected = snapshotScelto === s.pathInZip;
                  return (
                    <Box
                      key={s.pathInZip}
                      role="button"
                      tabIndex={0}
                      onClick={() => s.safe && setSnapshotScelto(s.pathInZip)}
                      onKeyDown={(e) => {
                        if (s.safe && (e.key === "Enter" || e.key === " ")) setSnapshotScelto(s.pathInZip);
                      }}
                      style={{
                        border: `1px solid ${selected ? "#1971c2" : "#dee2e6"}`,
                        borderRadius: 8,
                        padding: 12,
                        cursor: s.safe ? "pointer" : "not-allowed",
                        background: selected ? "#e7f5ff" : "white",
                        opacity: s.safe ? 1 : 0.6,
                      }}
                    >
                      <Group justify="space-between" align="flex-start" gap="sm">
                        <Box>
                          <Group gap="xs">
                            <Text size="sm" fw={700}>{s.deviceNome || s.deviceId}</Text>
                            {s.recommended && <Badge size="xs" color="blue">Consigliato</Badge>}
                            {!s.safe && <Badge size="xs" color="red">Non leggibile</Badge>}
                          </Group>
                          <Text size="xs" c="dimmed">
                            Copia #{s.seq || "-"} · {dataOra(s.modifiedMs)}
                          </Text>
                        </Box>
                        <Text size="xs" c="dimmed">{formatBytes(s.bytes)}</Text>
                      </Group>
                      <Group gap="xs" mt="xs">
                        <Badge variant="light" color="gray">{s.records} record</Badge>
                        <Badge variant="light" color="gray">{s.purged} eliminati</Badge>
                        <Badge variant="light" color="gray">{s.watermarks} PC</Badge>
                      </Group>
                    </Box>
                  );
                })}
              </Stack>
            )}
            <Group justify="flex-end" mt="sm">
              <Button variant="default" disabled={ripristinoManualeInCorso} onClick={() => setBackupManuale(null)}>
                Annulla
              </Button>
              <Button
                color="red"
                loading={ripristinoManualeInCorso}
                disabled={!snapshotScelto || caricandoSnapshot}
                onClick={confermaRipristinoManuale}
              >
                Ripristina manualmente
              </Button>
            </Group>
          </Stack>
        </Modal>

        <ImportAnagraficheModal
          aperto={modalImportAperto}
          onClose={() => setModalImportAperto(false)}
        />

        <ExportArubaModal
          aperto={modalExportAperto}
          onClose={() => setModalExportAperto(false)}
        />

        <ResetProgrammaView
          aperto={resetAperto}
          identity={identity}
          ridurreAnimazioni={ridurreAnimazioni}
          passoIniziale={resetPassoIniziale}
          onClose={chiudiReset}
        />

      </motion.div>
    </Pagina>
  );
}

function dataOra(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
}

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
