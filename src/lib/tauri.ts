// Ponte tipizzato verso i comandi del core Rust (Tauri `invoke`).
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

// `invoke` esiste solo dentro la finestra desktop di Tauri (non in un browser).
export const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!inTauri) {
    throw new Error(
      "Questa funzione è disponibile solo nella finestra desktop dell'app.",
    );
  }
  return tauriInvoke<T>(cmd, args);
}

// ---- Tipi condivisi con il core ----

import type {
  AvatarTipo,
  UserDto,
  Identity,
  Bootstrap,
  OperationLockStatus,
  SnapshotInfo,
  RecordDto,
  AllegatoComunicazioneInput,
  ComunicazioneCreaInput,
  DocumentoCacheSalvaInput,
  Comunicazione,
  WhatsappDiagnostica,
  WhatsappVerificaInput,
  WhatsappVerificaProva,
  ModelloComunicazione,
  ModelloComunicazioneSalvaInput,
  ConfigurazioneEmail,
  ConfigurazioneEmailSalvaInput,
  OrdineSalvaBaseInput,
  OrdineSalvaBaseResult,
  ConfigurazioneDocumenti,
  ConfigurazioneDocumentiSalvaInput,
  Preventivo,
  PreventivoSalvaInput,
  AliasPreventivo,
  SchedaCliente,
  SchedaClienteSalvaInput,
  ProduzioneRigaPatchInput,
  Campi,
  DedupClienteMergeInput,
  DedupClientiResult,
  CestinoItem,
  StoricoVoce,
  PrezzoSuggerito,
  PrezzoSuggeritoProdotto,
  OrdineDto,
  OrdineDaSpedire,
  BollettazioneAnalisi,
  BollettazioneConfermaInput,
  BollettazioneConfermaResult,
  Spedizione,
  SpedizioneRiepilogo,
  Pagamento,
  PagamentoVista,
  ProrogaPagamentoInput,
  RataInput,
  Distinta,
  ContrassegnoAperto,
  Rimborso,
  RimborsoExtra,
  ProvvigioniReport,
  DashboardStats,
  DashboardPanels,
  Suggerimento,
  SuggerimentiBundle,
  SuggerimentiPreferenzeInput,
  SyncOverview,
  RitiroDispositivoResult,
  BackupInfo,
  RestoreCoordination,
  OttimizzazioneDatabaseResult,
  InstallLatest,
  RemoteControlStatus,
  PuliziaDatiArgs,
  PuliziaPreview,
  PuliziaResult,
  FinishOnboardingArgs,
  ExtractedClient,
  PrescriptionsFolder,
  PrescriptionFile,
  ProductionPrescriptionScan,
  PrescriptionSelectionInput,
  ProductionAttachments,
} from "./tauriTypes";
export type {
  AvatarTipo,
  UserDto,
  Identity,
  Bootstrap,
  OperationLockStatus,
  SnapshotInfo,
  RecordDto,
  CanaleComunicazione,
  StatoComunicazione,
  AllegatoComunicazioneInput,
  DocumentoCacheSalvaInput,
  ComunicazioneCreaInput,
  Comunicazione,
  ComunicazioneInvioErrore,
  WhatsappDiagnostica,
  WhatsappUltimoEsito,
  WhatsappVerificaInput,
  WhatsappVerificaProva,
  TipoModelloComunicazione,
  VariabileModelloComunicazione,
  ModelloComunicazione,
  ModelloComunicazioneSalvaInput,
  SicurezzaTrasportoEmail,
  ConfigurazioneEmail,
  ConfigurazioneEmailSalvaInput,
  ProvaEmail,
  OrdineSalvaBaseInput,
  OrdineSalvaBaseResult,
  ConfigurazioneDocumenti,
  ConfigurazioneDocumentiSalvaInput,
  IndicazioneInvioPreventivo,
  PreventivoRiga,
  Preventivo,
  PreventivoRigaSalvaInput,
  PreventivoSalvaInput,
  AliasPreventivo,
  SchedaClienteCampi,
  SchedaCliente,
  SchedaClienteSalvaInput,
  Campi,
  DedupClienteMergeInput,
  DedupClientiResult,
  CestinoItem,
  StoricoVoce,
  PrezzoSuggerito,
  PrezzoSuggeritoProdotto,
  OrdineDto,
  RigaDaSpedire,
  OrdineDaSpedire,
  BollettazioneFile,
  BollettazioneTotals,
  BollettazioneMatch,
  BollettazioneConflict,
  BollettazioneRowStatus,
  BollettazioneRow,
  BollettazioneAnalisi,
  BollettazioneConfermaRiga,
  BollettazioneSpedizione,
  BollettazioneConfermaInput,
  BollettazioneConfermaResult,
  SpedizioneRiga,
  Spedizione,
  PagamentoSpedizione,
  RiepilogoConto,
  RiepilogoAgente,
  SpedizioneRiepilogo,
  Pagamento,
  PagamentoVista,
  ProrogaPagamentoInput,
  RataInput,
  Distinta,
  ContrassegnoAperto,
  Rimborso,
  RimborsoExtra,
  ProvvigioneOrdine,
  ProvvigioneAgente,
  ProvvigioniReport,
  DashPunto,
  DashFetta,
  DashAgente,
  DashboardStats,
  DashboardPanels,
  TipoSuggerimento,
  SuggerimentoCollegamento,
  Suggerimento,
  SuggerimentiBundle,
  SuggerimentiPreferenzeInput,
  Dispositivo,
  SyncOverview,
  RitiroDispositivoResult,
  BackupInfo,
  RestoreAck,
  RestoreCoordination,
  OttimizzazioneDatabaseResult,
  OperationProgress,
  InstallLatest,
  RemoteControlStatus,
  PuliziaModalita,
  PuliziaPreset,
  PuliziaDatiArgs,
  PuliziaBlocco,
  PuliziaPreview,
  PuliziaResult,
  OnboardingMode,
  FinishOnboardingArgs,
  ExtractedClient,
  PrescriptionsFolder,
  PrescriptionFile,
  PrescriptionPatient,
  ProductionPrescriptionScan,
  PrescriptionSelectionInput,
  ProductionAttachments,
  PrescriptionsProgress,
} from "./tauriTypes";

export const api = {
  ping: () => invoke<string>("ping"),
  importVecchiGiornalieri: (
    pathGenerale: string,
    pathGiornaliero: string,
    pathReportFolder: string,
  ) =>
    invoke<ExtractedClient[]>("import_vecchi_giornalieri", {
      pathGenerale,
      pathGiornaliero,
      pathReportFolder,
    }),
  verificaCartellaExcel: (path: string) =>
    invoke<boolean>("verifica_cartella_excel", { path }),
  bootstrap: () => invoke<Bootstrap>("app_bootstrap"),
  openDataDir: (dataDir: string) =>
    invoke<UserDto[]>("open_data_dir", { dataDir }),
  finishOnboarding: (args: FinishOnboardingArgs) =>
    invoke<Identity>("finish_onboarding", { args }),
  getUsers: () => invoke<UserDto[]>("get_users"),
  whoami: () => invoke<Identity | null>("whoami"),
  aggiornaProfilo: (
    nome: string,
    avatarTipo: AvatarTipo,
    avatarValore: string,
  ) => invoke<Identity>("aggiorna_profilo", { nome, avatarTipo, avatarValore }),
  saveAvatar: (userId: string, data: number[]) =>
    invoke<void>("save_avatar", { userId, data }),
  readAvatar: (userId: string) =>
    invoke<number[] | null>("read_avatar", { userId }),
  forceSync: () => invoke<number>("force_sync"),
  syncPoll: () => invoke<number>("sync_poll"),
  syncOverview: () => invoke<SyncOverview>("sync_overview"),
  syncOverviewRitiro: () => invoke<SyncOverview>("sync_overview_ritiro"),
  trayBadge: (n: number) => invoke<void>("tray_badge", { n }),
  /** Mostra/nasconde l'icona nella traybar (segue il toggle dell'avvio automatico). */
  traySet: (enabled: boolean) => invoke<void>("tray_set", { enabled }),
  /** La X può nascondere la main soltanto se l'icona tray è stata creata davvero. */
  trayDisponibile: () => invoke<boolean>("tray_disponibile"),
  /** True se l'app è partita in automatico col flag `--minimized` (nascosta nella tray):
   *  in tal caso il frontend non mostra la finestra principale all'avvio. */
  avvioMinimizzato: () => invoke<boolean>("avvio_minimizzato"),
  /** Fa sì che il prossimo riavvio dell'app resti nascosto nella tray. */
  preparaRiavvioMinimizzato: () => invoke<void>("prepara_riavvio_minimizzato"),
  /** Fa sì che il prossimo riavvio mostri la main, anche se il processo corrente era
   *  stato avviato automaticamente con `--minimized`. */
  preparaRiavvioVisibile: () => invoke<void>("prepara_riavvio_visibile"),
  /** Rimuove l'intenzione preparata se l'installazione fallisce prima del riavvio. */
  annullaRiavvioPreparato: () => invoke<void>("annulla_riavvio_preparato"),
  /** True se l'app è partita dalla scorciatoia desktop della ricerca (`--spotlight`). */
  avvioSpotlight: () => invoke<boolean>("avvio_spotlight"),
  /** True solo al primo mount del processo: i reload del webview (es. risveglio dalla
   *  sospensione) ottengono false, così la finestra principale non si ri-mostra da sola. */
  rivelaMainUnaVolta: () => invoke<boolean>("rivela_main_una_volta"),
  desktopSearchShortcutStatus: () =>
    invoke<boolean>("desktop_search_shortcut_status"),
  desktopSearchShortcutCreate: () =>
    invoke<string>("desktop_search_shortcut_create"),
  desktopSearchShortcutRemove: () =>
    invoke<boolean>("desktop_search_shortcut_remove"),
  /** Invia al rilevatore notifiche Rust le preferenze correnti (utente + suono/balloon/
   *  soglia): da lì in poi può suonare/avvisare anche a finestra nascosta (FASE 6D). */
  notificheConfig: (
    userId: string,
    suono: string,
    balloon: boolean,
    soglia: number,
    onboardingTime: number,
    primoPiano: boolean,
    suggerimenti: SuggerimentiPreferenzeInput,
  ) =>
    invoke<void>("notifiche_config", {
      config: {
        userId,
        suono,
        balloon,
        soglia,
        onboardingTime,
        primoPiano,
        suggerimenti,
      },
    }),
  /** Chiede al rilevatore Rust una scansione immediata (il webview la chiama a ogni
   *  ricarica, da vivo, per un avviso istantaneo). */
  notificheCheck: () => invoke<void>("notifiche_check"),
  notificheRipristinaPredefiniti: (preferenze: SuggerimentiPreferenzeInput) =>
    invoke<void>("notifiche_ripristina_predefiniti", { preferenze }),
  /** Handshake dell'overlay: true soltanto dopo la registrazione dei listener. */
  notificheOverlayPronto: (pronto: boolean) =>
    invoke<void>("notifiche_overlay_pronto", { pronto }),
  /** Disattiva la sessione notifiche dati quando bootstrap/onboarding non sono validi. */
  notificheDisattivaSessione: () =>
    invoke<void>("notifiche_disattiva_sessione"),
  apriCartellaDati: () => invoke<void>("apri_cartella_dati"),
  apriCartellaBackup: () => invoke<void>("apri_cartella_backup"),
  apriUrl: (url: string) => invoke<void>("apri_url", { url }),
  installaUltimaVersione: (token: string) =>
    invoke<InstallLatest>("installa_ultima_versione", { token }),
  remoteControlStatus: (token: string) =>
    invoke<RemoteControlStatus>("remote_control_status", { token }),
  backupNow: (dest?: string | null, tag?: string | null) =>
    invoke<BackupInfo>("backup_now", { dest: dest ?? null, tag: tag ?? null }),
  backupNowProgress: (
    opId: string,
    dest?: string | null,
    tag?: string | null,
  ) =>
    invoke<BackupInfo>("backup_now_progress", {
      opId,
      dest: dest ?? null,
      tag: tag ?? null,
    }),
  listaBackup: (dest?: string | null) =>
    invoke<BackupInfo[]>("lista_backup", { dest: dest ?? null }),
  ripristinaBackup: (
    zipPath: string,
    snapshotPathInZip?: string | null,
    mode?: "auto" | "manual",
    restoreId?: string | null,
  ) =>
    invoke<void>("ripristina_backup", {
      zipPath,
      snapshotPathInZip: snapshotPathInZip ?? null,
      mode: mode ?? "auto",
      restoreId: restoreId ?? null,
    }),
  backupSnapshotChoices: (zipPath: string) =>
    invoke<SnapshotInfo[]>("backup_snapshot_choices", { zipPath }),
  restorePrepare: () => invoke<RestoreCoordination>("restore_prepare"),
  restoreCoordinationStatus: (restoreId: string) =>
    invoke<RestoreCoordination>("restore_coordination_status", { restoreId }),
  restoreCancel: (restoreId: string) =>
    invoke<void>("restore_cancel", { restoreId }),
  ottimizzaDatabase: (
    generationId: string,
    dedupMerges: DedupClienteMergeInput[] = [],
    forza = false,
  ) =>
    invoke<OttimizzazioneDatabaseResult>("ottimizza_database", {
      generationId,
      dedupMerges,
      forza,
    }),
  eliminaBackup: (zipPath: string) =>
    invoke<void>("elimina_backup", { zipPath }),
  operationLockStatus: () =>
    invoke<OperationLockStatus | null>("operation_lock_status"),
  acquisisciLock: (azione: string) =>
    invoke<void>("acquisisci_lock", { azione }),
  rinnovaLock: (azione: string) => invoke<void>("rinnova_lock", { azione }),
  rilasciaLock: (azione?: string) =>
    invoke<void>("rilascia_lock", { azione: azione ?? null }),
  /** Reset leggero: riconfigura questo PC (onboarding), dati condivisi intatti. */
  resetLeggero: () => invoke<void>("reset_leggero"),
  ritiraDispositivo: (deviceId: string) =>
    invoke<RitiroDispositivoResult>("ritira_dispositivo", { deviceId }),
  /** Reset completo: cancella stato locale + dati condivisi. Irreversibile. */
  resetCompleto: () => invoke<void>("reset_completo"),
  /** Solo demo: popola ~50 ordini di prova (e le anagrafiche di default). */
  popolaDemo: () => invoke<number>("popola_demo"),
  popolaDemoProgress: (opId: string) =>
    invoke<number>("popola_demo_progress", { opId }),
  /** Solo demo: rimuove gli ordini demo creati. */
  azzeraDemo: () => invoke<number>("azzera_demo"),
  azzeraDemoProgress: (opId: string) =>
    invoke<number>("azzera_demo_progress", { opId }),

  // CRUD generico sui record
  recordsList: (entity: string) =>
    invoke<RecordDto[]>("records_list", { entity }),
  recordGet: (entity: string, id: string) =>
    invoke<RecordDto | null>("record_get", { entity, id }),
  recordsGetMany: (entity: string, ids: string[]) =>
    invoke<RecordDto[]>("records_get_many", { entity, ids }),
  recordCreate: (entity: string, fields: Campi) =>
    invoke<RecordDto>("record_create", { entity, fields }),
  /** Crea un record con id deterministico (idempotente/upsert): per record che devono
   *  convergere fra dispositivi anche se creati in concorrenza (es. occorrenze ricorrenti
   *  dei promemoria, singoletti di impostazioni condivise). */
  recordCreateId: (entity: string, id: string, fields: Campi) =>
    invoke<RecordDto>("record_create_id", { entity, id, fields }),
  recordUpdate: (entity: string, id: string, fields: Campi) =>
    invoke<RecordDto>("record_update", { entity, id, fields }),
  documentoCacheSalva: (input: DocumentoCacheSalvaInput) =>
    invoke<AllegatoComunicazioneInput>("documento_cache_salva", { input }),
  prescriptionsFolderGet: () =>
    invoke<PrescriptionsFolder>("prescriptions_folder_get"),
  prescriptionsFolderSet: (path: string) =>
    invoke<PrescriptionsFolder>("prescriptions_folder_set", { path }),
  prescriptionsScanLot: (lot: string, operationId: string, forceRefresh = false) =>
    invoke<ProductionPrescriptionScan>("prescriptions_scan_lot", { lot, operationId, forceRefresh }),
  prescriptionsInspectFiles: (paths: string[]) =>
    invoke<PrescriptionFile[]>("prescriptions_inspect_files", { paths }),
  prescriptionOpen: (path: string) => invoke<void>("prescription_open", { path }),
  prescriptionsZipSave: (
    lot: string,
    selections: PrescriptionSelectionInput[],
    output: string,
    operationId: string,
  ) => invoke<number>("prescriptions_zip_save", { lot, selections, output, operationId }),
  productionAttachmentsPrepare: (
    lot: string,
    selections: PrescriptionSelectionInput[],
    includeZip: boolean,
    base: number,
    operationId: string,
  ) =>
    invoke<ProductionAttachments>("production_attachments_prepare", {
      lot,
      selections,
      includeZip,
      base,
      operationId,
    }),
  prescriptionsOperationCancel: (operationId: string) =>
    invoke<boolean>("prescriptions_operation_cancel", { operationId }),
  documentiCacheRilascia: (
    allegati: AllegatoComunicazioneInput[],
    eliminaSeNonUsati = false,
  ) =>
    invoke<number>("documenti_cache_rilascia", {
      allegati,
      eliminaSeNonUsati,
    }),
  configurazioneDocumentiGet: () =>
    invoke<ConfigurazioneDocumenti>("configurazione_documenti_get"),
  configurazioneDocumentiSalva: (
    input: ConfigurazioneDocumentiSalvaInput,
  ) =>
    invoke<ConfigurazioneDocumenti>("configurazione_documenti_salva", {
      input,
    }),
  /** Crea una bozza idempotente; nessun effetto esterno parte da questo comando. */
  comunicazioneCreaBozza: (input: ComunicazioneCreaInput) =>
    invoke<Comunicazione>("comunicazione_crea_bozza", { input }),
  comunicazioniLista: () => invoke<Comunicazione[]>("comunicazioni_lista"),
  comunicazioneMettiInCoda: (id: string) =>
    invoke<Comunicazione>("comunicazione_metti_in_coda", { id }),
  comunicazioneAnnulla: (id: string) =>
    invoke<Comunicazione>("comunicazione_annulla", { id }),
  comunicazioneWhatsappRiprendi: (id: string) =>
    invoke<Comunicazione>("comunicazione_whatsapp_riprendi", { id }),
  whatsappDiagnosticaGet: () =>
    invoke<WhatsappDiagnostica>("whatsapp_diagnostica_get"),
  whatsappStatoGet: () =>
    invoke<WhatsappDiagnostica>("whatsapp_stato_get"),
  whatsappIntersecaOverlay: () =>
    invoke<boolean>("whatsapp_interseca_overlay"),
  overlayInvioAttivo: () =>
    invoke<boolean>("overlay_invio_attivo"),
  overlayImpostaVisibilitaDesiderata: (visibile: boolean) =>
    invoke<void>("overlay_imposta_visibilita_desiderata", { visibile }),
  whatsappVerificaEInviaProva: (input: WhatsappVerificaInput) =>
    invoke<WhatsappVerificaProva>("whatsapp_verifica_e_invia_prova", {
      input,
    }),
  comunicazioneElimina: (id: string) =>
    invoke<void>("comunicazione_elimina", { id }),
  comunicazioniElimina: (ids: string[]) =>
    invoke<number>("comunicazioni_elimina", { ids }),
  campagnaComunicazioneElimina: (campagnaId: string) =>
    invoke<number>("campagna_comunicazione_elimina", { campagnaId }),
  campagnaComunicazioneSospendi: (campagnaId: string) =>
    invoke<Comunicazione[]>("campagna_comunicazione_sospendi", { campagnaId }),
  campagnaComunicazioneRiprendi: (campagnaId: string) =>
    invoke<Comunicazione[]>("campagna_comunicazione_riprendi", { campagnaId }),
  campagnaComunicazioneAnnulla: (campagnaId: string) =>
    invoke<Comunicazione[]>("campagna_comunicazione_annulla", { campagnaId }),
  campagnaComunicazioneRiprovaFallite: (campagnaId: string) =>
    invoke<Comunicazione[]>("campagna_comunicazione_riprova_fallite", {
      campagnaId,
    }),
  comunicazioneEmailInvia: (id: string) =>
    invoke<Comunicazione>("comunicazione_email_invia", { id }),
  comunicazioneReinvia: (id: string) =>
    invoke<Comunicazione>("comunicazione_reinvia", { id }),
  comunicazioniReinvia: (ids: string[]) =>
    invoke<Comunicazione[]>("comunicazioni_reinvia", { ids }),
  modelliComunicazioneLista: () =>
    invoke<ModelloComunicazione[]>("modelli_comunicazione_lista"),
  modelloComunicazioneSalva: (input: ModelloComunicazioneSalvaInput) =>
    invoke<ModelloComunicazione>("modello_comunicazione_salva", { input }),
  modelloComunicazioneElimina: (id: string) =>
    invoke<void>("modello_comunicazione_elimina", { id }),
  modelloComunicazioneStorico: (id: string) =>
    invoke<ModelloComunicazione[]>("modello_comunicazione_storico", { id }),
  configurazioneEmailGet: () =>
    invoke<ConfigurazioneEmail>("configurazione_email_get"),
  configurazioneEmailSalva: (input: ConfigurazioneEmailSalvaInput) =>
    invoke<ConfigurazioneEmail>("configurazione_email_salva", { input }),
  configurazioneEmailVerificaEInviaProva: (
    input: ConfigurazioneEmailSalvaInput,
  ) =>
    invoke<ConfigurazioneEmail>("configurazione_email_verifica_e_invia_prova", {
      input,
    }),
  configurazioneEmailPasswordRimuovi: () =>
    invoke<ConfigurazioneEmail>("configurazione_email_password_rimuovi"),
  ordineSalvaBase: (input: OrdineSalvaBaseInput) =>
    invoke<OrdineSalvaBaseResult>("ordine_salva_base", { input }),
  preventiviLista: () => invoke<Preventivo[]>("preventivi_lista"),
  preventivoAliasLista: () => invoke<AliasPreventivo[]>("preventivo_alias_lista"),
  preventivoAliasSalva: (alias: string, prodottoId: string) =>
    invoke<AliasPreventivo>("preventivo_alias_salva", { alias, prodottoId }),
  preventivoOrdiniDisponibili: () =>
    invoke<Preventivo[]>("preventivo_ordini_disponibili"),
  preventivoGet: (ordineId: string) =>
    invoke<Preventivo>("preventivo_get", { ordineId }),
  preventivoSalva: (input: PreventivoSalvaInput) =>
    invoke<Preventivo>("preventivo_salva", { input }),
  preventivoElimina: (id: string, revision: string) =>
    invoke<void>("preventivo_elimina", { id, revision }),
  preventivoMarcaInviatoManuale: (ordineId: string, revision = "") =>
    invoke<Preventivo>("preventivo_marca_inviato_manuale", {
      ordineId,
      revision,
    }),
  preventivoRipristina: (id: string) =>
    invoke<void>("preventivo_ripristina", { id }),
  preventivoPurge: (id: string) =>
    invoke<void>("preventivo_purge", { id }),
  documentoSalva: (path: string, datiBase64: string) =>
    invoke<void>("documento_salva", { path, datiBase64 }),
  documentoPreventivoSalva: (path: string, datiBase64: string) =>
    invoke<void>("documento_preventivo_salva", { path, datiBase64 }),
  schedaClienteGet: (ordineId: string) =>
    invoke<SchedaCliente>("scheda_cliente_get", { ordineId }),
  schedaClienteSalva: (input: SchedaClienteSalvaInput) =>
    invoke<SchedaCliente>("scheda_cliente_salva", { input }),
  produzioneCompilaRighe: (aggiornamenti: ProduzioneRigaPatchInput[]) =>
    invoke<void>("produzione_compila_righe", { aggiornamenti }),
  recordDelete: (entity: string, id: string) =>
    invoke<void>("record_delete", { entity, id }),
  clientiDeduplicaApplica: (merges: DedupClienteMergeInput[]) =>
    invoke<DedupClientiResult>("clienti_deduplica_applica", { merges }),
  recordRestore: (entity: string, id: string) =>
    invoke<void>("record_restore", { entity, id }),
  /** Ripristina un ordine rifiutato dal Giornaliero (→ Nuovo/Confermato). Ritorna il nuovo stato. */
  ordineRipristina: (id: string) => invoke<string>("ordine_ripristina", { id }),
  /** Porta in blocco ordini a uno stato di produzione ("In produzione"/"Arrivato IT") con data. */
  ordiniAvanzaProduzione: (ids: string[], stato: string, data: string) =>
    invoke<number>("ordini_avanza_produzione", { ids, stato, data }),
  /** Manda in produzione un set di ordini come UN lotto (FASE 5B). Ritorna l'id del lotto. */
  produzioneInvia: (ids: string[], data: string) =>
    invoke<string>("produzione_invia", { ids, data }),
  /** Disfa l'invio in produzione di un singolo ordine (torna "Da produrre"). FASE 5B. */
  produzioneAnnullaOrdine: (id: string) =>
    invoke<void>("produzione_annulla_ordine", { id }),
  /** Annulla un intero lotto di produzione (tutti gli ordini tornano "Da produrre"). FASE 5B. */
  produzioneLottoAnnulla: (lotto: string) =>
    invoke<void>("produzione_lotto_annulla", { lotto }),
  /** Fonde più lotti di produzione in uno solo. Ritorna il lotto risultante. FASE 5B. */
  produzioneLottoUnisci: (lotti: string[]) =>
    invoke<string>("produzione_lotto_unisci", { lotti }),
  /** Separa un lotto di produzione unito (annulla l'unione). FASE 5B. */
  produzioneLottoSepara: (lotto: string) =>
    invoke<void>("produzione_lotto_separa", { lotto }),
  // --- Produzione PER RIGA (FASE 7): lo stato vive sulla riga, quello dell'ordine è derivato ---
  /** Manda in produzione le righe selezionate (anche di ordini diversi) come UN lotto. */
  produzioneInviaRighe: (
    righeIds: string[],
    data: string,
    dataPrevista: string,
  ) =>
    invoke<string>("produzione_invia_righe", { righeIds, data, dataPrevista }),
  /** Porta le righe a uno stato di produzione (`in_produzione`/`arrivato_it`). */
  produzioneRigheStato: (righeIds: string[], stato: string, data: string) =>
    invoke<void>("produzione_righe_stato", { righeIds, stato, data }),
  /** Annulla l'invio in produzione di una singola riga (torna «da produrre»). */
  produzioneRigaAnnulla: (rigaId: string) =>
    invoke<void>("produzione_riga_annulla", { rigaId }),
  /** Annulla tutte le righe di un lotto di produzione (tornano «da produrre»). */
  produzioneLottoRigheAnnulla: (lotto: string) =>
    invoke<void>("produzione_lotto_righe_annulla", { lotto }),
  /** Porta tutte le righe di un lotto a `arrivato_it`. */
  produzioneLottoRigheArrivate: (lotto: string, data: string) =>
    invoke<void>("produzione_lotto_righe_arrivate", { lotto, data }),
  /** Fonde più lotti di produzione (per riga) in uno solo. Ritorna il lotto risultante. */
  produzioneLottoRigheUnisci: (lotti: string[]) =>
    invoke<string>("produzione_lotto_righe_unisci", { lotti }),
  /** Separa un lotto di produzione unito (per riga). */
  produzioneLottoRigheSepara: (lotto: string) =>
    invoke<void>("produzione_lotto_righe_separa", { lotto }),
  /** Export Laboratorio (Immunoterapia) di un lotto in .xlsx (FASE 5C). Ritorna n° righe. */
  laboratorioExport: (
    lotto: string,
    path: string,
    base: number,
    dataPrevista: string,
  ) => invoke<number>("laboratorio_export", { lotto, path, base, dataPrevista }),
  /** Export Diagnostica di un lotto in .xlsx (un blocco per ordine, FASE 5D). Ritorna n° ordini. */
  diagnosticaExport: (lotto: string, path: string) =>
    invoke<number>("diagnostica_export", { lotto, path }),
  cestino: () => invoke<CestinoItem[]>("cestino"),
  recordPurge: (entity: string, id: string) =>
    invoke<void>("record_purge", { entity, id }),
  cestinoSvuota: () => invoke<void>("cestino_svuota"),
  cestinoPulisci: (giorni: number) =>
    invoke<number>("cestino_pulisci", { giorni }),
  puliziaDatiAnteprima: (args: PuliziaDatiArgs) =>
    invoke<PuliziaPreview>("pulizia_dati_anteprima", { args }),
  puliziaDatiEsegui: (args: PuliziaDatiArgs, conferma: string) =>
    invoke<PuliziaResult>("pulizia_dati_esegui", { args, conferma }),
  recordStorico: (entity: string, id: string) =>
    invoke<StoricoVoce[]>("record_storico", { entity, id }),

  // Listino / prezzi
  prezzoSuggerito: (prodottoId: string, medicoId?: string | null) =>
    invoke<PrezzoSuggerito>("prezzo_suggerito", {
      prodottoId,
      medicoId: medicoId ?? null,
    }),
  prezziSuggeritiBatch: (prodottoIds: string[], medicoId?: string | null) =>
    invoke<PrezzoSuggeritoProdotto[]>("prezzi_suggeriti_batch", {
      prodottoIds,
      medicoId: medicoId ?? null,
    }),

  // Giornaliero
  ordiniLista: () => invoke<OrdineDto[]>("ordini_lista"),
  anniOrdini: () => invoke<number[]>("anni_ordini"),

  // Pagamenti / contabilità (FASE 3) — modello unico atteso/saldato
  pagamentiOrdine: (ordineId: string) =>
    invoke<Pagamento[]>("pagamenti_ordine", { ordineId }),
  /** Le rate sono componenti dello scadenzario: annullarle le elimina definitivamente. */
  pagamentoElimina: (id: string) =>
    invoke<void>("record_delete", { entity: "pagamento", id }),
  pagamentiVista: (args?: {
    agenteId?: string | null;
    contoId?: string | null;
    dal?: string | null;
    al?: string | null;
    stato?: string | null;
  }) =>
    invoke<PagamentoVista[]>("pagamenti_vista", {
      agenteId: args?.agenteId ?? null,
      contoId: args?.contoId ?? null,
      dal: args?.dal ?? null,
      al: args?.al ?? null,
      stato: args?.stato ?? null,
    }),
  pagamentiProrogaSetteGiorni: (
    campagnaId: string,
    pagamenti: ProrogaPagamentoInput[],
  ) =>
    invoke<number>("pagamenti_proroga_sette_giorni", {
      campagnaId,
      pagamenti,
    }),
  pagamentoRegistra: (args: {
    ordineId: string;
    tipo: string;
    importo: number;
    saldato: boolean;
    scadenza?: string;
    contoId?: string;
    data?: string;
    verificato?: boolean;
    note?: string | null;
  }) =>
    invoke<Pagamento>("pagamento_registra", {
      ordineId: args.ordineId,
      tipo: args.tipo,
      importo: args.importo,
      saldato: args.saldato,
      scadenza: args.scadenza ?? "",
      contoId: args.contoId ?? "",
      data: args.data ?? "",
      verificato: args.verificato ?? false,
      note: args.note ?? null,
    }),
  pagamentoSalda: (args: {
    id: string;
    contoId: string;
    data: string;
    verificato: boolean;
    fields?: Campi;
  }) =>
    invoke<Pagamento>("pagamento_salda", {
      id: args.id,
      contoId: args.contoId,
      data: args.data,
      verificato: args.verificato,
      fields: args.fields ?? null,
    }),
  pagamentiRateizza: (
    ordineId: string,
    rate: RataInput[],
    daSpedizione = false,
  ) => invoke<void>("pagamenti_rateizza", { ordineId, rate, daSpedizione }),
  pagamentiAggiungiRate: (
    ordineId: string,
    rate: RataInput[],
    daSpedizione = false,
  ) =>
    invoke<void>("pagamenti_aggiungi_rate", { ordineId, rate, daSpedizione }),
  pagamentiRiallineaAperti: (ordineId: string) =>
    invoke<Pagamento[]>("pagamenti_riallinea_aperti", { ordineId }),
  contoPredefinitoSet: (
    contoId: string,
    ruolo: "incassi" | "accrediti" | "acconti" | "rimborsi",
  ) => invoke<void>("conto_predefinito_set", { contoId, ruolo }),

  // Distinte corrieri (FASE 3C)
  contrassegniAperti: () => invoke<ContrassegnoAperto[]>("contrassegni_aperti"),
  distinteLista: () => invoke<Distinta[]>("distinte_lista"),
  distintaRighe: (distintaId: string) =>
    invoke<ContrassegnoAperto[]>("distinta_righe", { distintaId }),
  distintaCrea: (args: {
    corriereId: string;
    dataDistinta: string;
    dataAccredito: string;
    contoId: string;
    importo: number;
    pagamentoIds: string[];
    pagamentiAttesi?: Array<{
      id: string;
      ordineId: string;
      importo: number;
      contoId: string;
      contoTipo: string;
    }>;
  }) =>
    invoke<Distinta>("distinta_crea", {
      corriereId: args.corriereId,
      dataDistinta: args.dataDistinta,
      dataAccredito: args.dataAccredito,
      contoId: args.contoId,
      importo: args.importo,
      pagamentoIds: args.pagamentoIds,
      pagamentiAttesi: args.pagamentiAttesi,
    }),
  distintaElimina: (id: string) => invoke<void>("distinta_elimina", { id }),

  // Spedizioni (FASE 4)
  bollettazioneAnalizza: (paths: string[]) =>
    invoke<BollettazioneAnalisi>("bollettazione_analizza", { paths }),
  bollettazioneConferma: (input: BollettazioneConfermaInput) =>
    invoke<BollettazioneConfermaResult>("bollettazione_conferma", { input }),
  righeDaSpedire: () => invoke<OrdineDaSpedire[]>("righe_da_spedire"),
  spedizioniLista: () => invoke<Spedizione[]>("spedizioni_lista"),
  spedizioneCrea: (args: {
    lotto: string;
    data: string;
    corriereId: string;
    colli: number;
    peso: number;
    servizi: string;
    preavviso: boolean;
    mezzo: string;
    contrassegno: number;
    note: string;
    /** Righe da spedire, ciascuna col proprio numero/lotto di vaccino. FASE 7. */
    numeri: { rigaId: string; numero: string }[];
  }) =>
    invoke<Spedizione>("spedizione_crea", {
      lotto: args.lotto,
      data: args.data,
      corriereId: args.corriereId,
      colli: args.colli,
      peso: args.peso,
      servizi: args.servizi,
      preavviso: args.preavviso,
      mezzo: args.mezzo,
      contrassegno: args.contrassegno,
      note: args.note,
      numeri: args.numeri,
    }),
  spedizioneRigaRimuovi: (rigaId: string) =>
    invoke<void>("spedizione_riga_rimuovi", { rigaId }),
  spedizioneColloManuale: (args: {
    lotto: string;
    data: string;
    corriereId: string;
    numero: string;
    colli: number;
    peso: number;
    preavviso: boolean;
    mezzo: string;
    contrassegno: number;
    note: string;
    cliente: string;
    indirizzo: string;
    cap: string;
    citta: string;
    prov: string;
    regione: string;
    telefono: string;
    email: string;
  }) =>
    invoke<Spedizione>("spedizione_collo_manuale", {
      lotto: args.lotto,
      data: args.data,
      corriereId: args.corriereId,
      numero: args.numero,
      colli: args.colli,
      peso: args.peso,
      preavviso: args.preavviso,
      mezzo: args.mezzo,
      contrassegno: args.contrassegno,
      note: args.note,
      cliente: args.cliente,
      indirizzo: args.indirizzo,
      cap: args.cap,
      citta: args.citta,
      prov: args.prov,
      regione: args.regione,
      telefono: args.telefono,
      email: args.email,
    }),
  spedizioneAnnulla: (id: string) => invoke<void>("spedizione_annulla", { id }),
  lottoAnnulla: (lotto: string) => invoke<void>("lotto_annulla", { lotto }),
  lottoUnisci: (lotti: string[]) => invoke<string>("lotto_unisci", { lotti }),
  lottoSepara: (lotto: string) => invoke<void>("lotto_separa", { lotto }),
  spedizioneDestinatariUnisci: (spedizioneIds: string[]) =>
    invoke<void>("spedizione_destinatari_unisci", { spedizioneIds }),
  spedizioneDestinatariSepara: (spedizioneId: string) =>
    invoke<void>("spedizione_destinatari_separa", { spedizioneId }),
  spedizioneSegnaAvvisata: (id: string) =>
    invoke<void>("spedizione_segna_avvisata", { id }),
  spedizioneRiepilogo: (lotto: string) =>
    invoke<SpedizioneRiepilogo>("spedizione_riepilogo", { lotto }),
  rigaMancanteAggiungi: (args: {
    ordineId: string;
    prodottoId: string;
    qta: number;
    prezzo: number;
    paziente: string;
  }) =>
    invoke<void>("riga_mancante_aggiungi", {
      ordineId: args.ordineId,
      prodottoId: args.prodottoId,
      qta: args.qta,
      prezzo: args.prezzo,
      paziente: args.paziente,
    }),

  // Rimborsi (FASE 3D)
  rimborsiLista: (stato?: string | null) =>
    invoke<Rimborso[]>("rimborsi_lista", { stato: stato ?? null }),
  rimborsoSalva: (args: {
    id?: string;
    dataRichiesta: string;
    importo: number;
    ragioneSociale: string;
    motivo?: string;
    iban?: string;
    contoId?: string;
    dataRimborso?: string;
    note?: string;
    ordineId?: string;
    origine?: "manuale" | "extra";
  }) =>
    invoke<Rimborso>("rimborso_salva", {
      id: args.id ?? "",
      dataRichiesta: args.dataRichiesta,
      importo: args.importo,
      ragioneSociale: args.ragioneSociale,
      motivo: args.motivo ?? "",
      iban: args.iban ?? "",
      contoId: args.contoId ?? "",
      dataRimborso: args.dataRimborso ?? "",
      note: args.note ?? "",
      ordineId: args.ordineId ?? "",
      origine: args.origine ?? "manuale",
    }),
  rimborsoSegnaEffettuato: (args: {
    id: string;
    dataRimborso: string;
    contoId?: string;
  }) =>
    invoke<Rimborso>("rimborso_segna_effettuato", {
      id: args.id,
      dataRimborso: args.dataRimborso,
      contoId: args.contoId ?? "",
    }),
  rimborsoExtraPrecompila: (ordineId: string) =>
    invoke<RimborsoExtra>("rimborso_extra_precompila", { ordineId }),

  // Provvigioni (FASE 2)
  provvigioniReport: (
    dal?: string | null,
    al?: string | null,
    agenteId?: string | null,
  ) =>
    invoke<ProvvigioniReport>("provvigioni_report", {
      dal: dal ?? null,
      al: al ?? null,
      agenteId: agenteId ?? null,
    }),
  /** KPI + serie per la dashboard nel periodo [dal, al] (FASE 6B). */
  dashboardStats: (dal?: string | null, al?: string | null) =>
    invoke<DashboardStats>("dashboard_stats", {
      dal: dal ?? null,
      al: al ?? null,
    }),
  /** Pannelli operativi della dashboard già limitati lato backend. */
  dashboardPannelli: () => invoke<DashboardPanels>("dashboard_pannelli"),
  /** Suggerimenti FASE 14, derivati e già ordinati dal core. */
  suggerimentiLista: (preferenze: SuggerimentiPreferenzeInput) =>
    invoke<SuggerimentiBundle>("suggerimenti_lista", { preferenze }),
  /** Invalida la cache locale e ricalcola subito tutte le azioni correnti. */
  suggerimentiRigenera: (preferenze: SuggerimentiPreferenzeInput) =>
    invoke<SuggerimentiBundle>("suggerimenti_rigenera", { preferenze }),
  /** Ricalcolo manuale completo, senza applicare esclusioni o scrivere stato. */
  suggerimentiRigeneraCompleta: (anno = 0) =>
    invoke<SuggerimentiBundle>("suggerimenti_rigenera_completa", { anno }),
  /** Suggerimenti maturi per campanella/pop-up secondo le preferenze locali. */
  suggerimentiNotificheLista: (
    preferenze: SuggerimentiPreferenzeInput,
  ) =>
    invoke<Suggerimento[]>("suggerimenti_notifiche_lista", {
      preferenze,
    }),
  /** Aggiorna la cache volatile del matcher duplicati sul solo PC corrente. */
  suggerimentoDuplicatiLocaleAggiorna: (
    suggerimento: Suggerimento | null,
  ) =>
    invoke<void>("suggerimento_duplicati_locale_aggiorna", {
      suggerimento,
    }),
  /** Nasconde la fotografia corrente del suggerimento su tutti i PC. */
  suggerimentoNascondi: (id: string) =>
    invoke<void>("suggerimento_nascondi", { id }),
  /** Nasconde più fotografie in un solo batch sincronizzato. */
  suggerimentiNascondi: (ids: string[]) =>
    invoke<void>("suggerimenti_nascondi", { ids }),
  provvigioniExport: (
    path: string,
    dal?: string | null,
    al?: string | null,
    agenteId?: string | null,
  ) =>
    invoke<void>("provvigioni_export", {
      path,
      dal: dal ?? null,
      al: al ?? null,
      agenteId: agenteId ?? null,
    }),

  /** Export generico di una griglia (Crediti/Rimborsi/Giornaliero) in .xlsx. */
  grigliaExport: (args: {
    path: string;
    foglio: string;
    colonne: { label: string; tipo: string; totale: boolean }[];
    righe: (string | number)[][];
    orizzontale: boolean;
    /** Mostra «€» nelle celle importo (export leggibili). La distinta corriere lo lascia a `false`. */
    simboloEuro: boolean;
  }) => invoke<void>("griglia_export", args),

  /** Automazione "Chiuso": chiude gli ordini Spediti+saldati da ≥20gg. Ritorna quanti. */
  ordiniAutoChiudi: () => invoke<number>("ordini_auto_chiudi"),
};
