//! Comandi esposti al frontend (Tauri `invoke`).
//!
//! Sono wrapper sottili attorno a [`crate::app::AppState`]: la logica vera vive lì.

pub(crate) mod updates;

use base64::Engine as _;
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

use crate::app::communication::{
    AllegatoComunicazioneInput, ComunicazioneCreaInput, ComunicazioneDto, DocumentoCacheSalvaInput,
    WhatsappVerificaInput, WhatsappVerificaProvaDto,
};
use crate::app::communication_config::{ConfigurazioneEmailDto, ConfigurazioneEmailSalvaInput};
use crate::app::communication_templates::{
    ModelloComunicazioneDto, ModelloComunicazioneSalvaInput,
};
use crate::app::prescriptions::{
    operation_cancel, operation_finish, operation_start, PrescriptionFileDto,
    PrescriptionSelectionInput, PrescriptionsFolderDto, ProductionAttachmentsDto,
    ProductionPrescriptionScanDto,
};
use crate::app::preventivi::{
    AliasPreventivoDto, ConfigurazioneDocumentiDto, ConfigurazioneDocumentiSalvaInput,
    PreventivoDto, PreventivoSalvaInput, SchedaClienteDto, SchedaClienteSalvaInput,
};
use crate::app::{
    AppState, BollettazioneAnalisiDto, BollettazioneConfermaDto, BollettazioneConfermaIn,
    BootstrapDto, CestinoDto, ContrassegnoApertoDto, DashboardPanelsDto, DashboardStatsDto,
    DedupClienteMergeInput, DedupClientiResult, DistintaDto, FinishOnboarding, IdentityDto,
    OrdineDaSpedireDto, OrdineDto, OrdineSalvaBaseInput, OrdineSalvaBaseResult,
    PagamentoDistintaAtteso, PagamentoDto, PagamentoVistaDto, PrezzoSuggeritoDto,
    PrezzoSuggeritoProdottoDto, ProduzioneRigaPatchInput, ProrogaPagamentoInput,
    ProvvigioniReportDto, PuliziaDatiArgs, PuliziaPreviewDto, PuliziaResultDto, RataInput,
    RecordDto, RigaNumeroIn, RimborsoDto, RimborsoExtraDto, RitiroDispositivoResult, SpedizioneDto,
    SpedizioneRiepilogoDto, StoricoDto, SuggerimentiBundleDto, SuggerimentiPreferenzeInput,
    SyncOverviewDto, SyncPollOutcome, UserDto,
};
use crate::data_events::{emetti_entita_modificate, EVENTO_RICERCA_INVALIDATA};

const EVENTO_OPERAZIONE_PROGRESS: &str = "pt:operazione-progress";
const EVENTO_PRESCRIZIONI_PROGRESS: &str = "pt:prescriptions-progress";
const DESKTOP_SEARCH_SHORTCUT_NAME: &str = "Ricerca PharmaTek.lnk";
#[cfg(target_os = "windows")]
const DESKTOP_SEARCH_ICON_NAME: &str = "ricerca-pharmatek.ico";
#[cfg(target_os = "windows")]
const DESKTOP_SEARCH_ICON_BYTES: &[u8] = include_bytes!("../../icons/search.ico");

static BACKGROUND_OP_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationProgressDto {
    pub id: String,
    pub kind: String,
    pub progress: u8,
    pub message: String,
    pub done: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrescriptionsProgressDto {
    pub id: String,
    pub phase: String,
    pub progress: Option<u8>,
    pub current: u64,
    pub total: u64,
    pub message: String,
    pub done: bool,
}

fn emetti_prescrizioni_progress(
    app: &tauri::AppHandle,
    id: &str,
    phase: &str,
    progress: Option<u8>,
    current: u64,
    total: u64,
    message: &str,
) {
    let _ = app.emit(
        EVENTO_PRESCRIZIONI_PROGRESS,
        PrescriptionsProgressDto {
            id: id.into(),
            phase: phase.into(),
            progress,
            current,
            total,
            message: message.into(),
            done: phase == "complete" || phase == "cancelled" || phase == "error",
        },
    );
}

fn background_lock() -> &'static Mutex<()> {
    BACKGROUND_OP_LOCK.get_or_init(|| Mutex::new(()))
}

fn respiro_background() {
    std::thread::yield_now();
    std::thread::sleep(Duration::from_millis(20));
}

fn emetti_progress(
    app: &tauri::AppHandle,
    id: &str,
    kind: &str,
    progress: u8,
    message: &str,
    done: bool,
) {
    let _ = app.emit(
        EVENTO_OPERAZIONE_PROGRESS,
        OperationProgressDto {
            id: id.to_string(),
            kind: kind.to_string(),
            progress,
            message: message.to_string(),
            done,
        },
    );
}

fn emetti_se_ok<T>(
    app: &tauri::AppHandle,
    result: Result<T, String>,
    entita: &[&str],
) -> Result<T, String> {
    if result.is_ok() {
        let entita = entita
            .iter()
            .map(|nome| (*nome).to_string())
            .collect::<Vec<_>>();
        emetti_entita_modificate(app, &entita);
    }
    result
}

fn emetti_bulk_demo(app: &tauri::AppHandle) {
    emetti_entita_modificate(
        app,
        &[
            "ordine",
            "pagamento",
            "spedizione",
            "distinta",
            "cliente",
            "medico",
            "agente",
            "prodotto",
            "corriere",
            "rimborso",
        ]
        .map(str::to_string),
    );
}

/// Verifica del ponte UI <-> core (eredità di FASE 0).
#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}

/// Apre un collegamento esterno esplicitamente consentito con il programma di sistema.
#[tauri::command]
pub fn apri_url(url: String) -> Result<(), String> {
    if !crate::platform::url_esterno_consentito(&url) {
        return Err("URL non valido".into());
    }
    crate::platform::apri_url_sistema(&url)
}

fn desktop_search_shortcut_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .desktop_dir()
        .map(|dir| dir.join(DESKTOP_SEARCH_SHORTCUT_NAME))
        .map_err(|e| format!("Desktop non raggiungibile: {e}"))
}

#[cfg(target_os = "windows")]
fn desktop_search_icon_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(DESKTOP_SEARCH_ICON_NAME))
        .map_err(|e| format!("Cartella app non raggiungibile: {e}"))
}

#[cfg(target_os = "windows")]
fn prepara_desktop_search_icon(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let icon = desktop_search_icon_path(app)?;
    if let Some(parent) = icon.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Preparazione icona ricerca non riuscita: {e}"))?;
    }
    std::fs::write(&icon, DESKTOP_SEARCH_ICON_BYTES)
        .map_err(|e| format!("Scrittura icona ricerca non riuscita: {e}"))?;
    Ok(icon)
}

#[tauri::command]
pub fn desktop_search_shortcut_status(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(desktop_search_shortcut_path(&app)?.exists())
}

#[tauri::command]
pub fn desktop_search_shortcut_remove(app: tauri::AppHandle) -> Result<bool, String> {
    let path = desktop_search_shortcut_path(&app)?;
    if !path.exists() {
        return Ok(false);
    }
    std::fs::remove_file(&path).map_err(|e| format!("Rimozione scorciatoia non riuscita: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub fn desktop_search_shortcut_create(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Scorciatoia desktop supportata solo su Windows.".into())
    }

    #[cfg(target_os = "windows")]
    {
        let shortcut = desktop_search_shortcut_path(&app)?;
        let target = std::env::current_exe()
            .map_err(|e| format!("Percorso applicazione non leggibile: {e}"))?;
        let icon = prepara_desktop_search_icon(&app)?;
        crea_shortcut_windows(&shortcut, &target, "--spotlight", &icon)?;
        Ok(shortcut.to_string_lossy().to_string())
    }
}

#[cfg(target_os = "windows")]
fn crea_shortcut_windows(
    shortcut: &Path,
    target: &Path,
    arguments: &str,
    icon: &Path,
) -> Result<(), String> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    fn wide(value: &Path) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        value.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    fn wide_str(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    let target_w = wide(target);
    let shortcut_w = wide(shortcut);
    let args_w = wide_str(arguments);
    let icon_w = wide(icon);
    let workdir_w = target.parent().map(wide);

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("Inizializzazione collegamento non riuscita: {e}"))?;
        let result = (|| -> windows::core::Result<()> {
            let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            shell_link.SetPath(PCWSTR(target_w.as_ptr()))?;
            shell_link.SetArguments(PCWSTR(args_w.as_ptr()))?;
            shell_link.SetIconLocation(PCWSTR(icon_w.as_ptr()), 0)?;
            if let Some(workdir_w) = &workdir_w {
                shell_link.SetWorkingDirectory(PCWSTR(workdir_w.as_ptr()))?;
            }
            let persist: IPersistFile = shell_link.cast()?;
            persist.Save(PCWSTR(shortcut_w.as_ptr()), true)?;
            Ok(())
        })();
        CoUninitialize();
        result.map_err(|e| format!("Creazione scorciatoia non riuscita: {e}"))
    }
}

/// Aggiorna il "badge" notifiche sull'icona della tray (FASE 6A/6D). Windows non
/// ha un badge numerico nativo, quindi lo riflettiamo nel tooltip dell'icona.
#[tauri::command]
pub fn tray_badge(app: tauri::AppHandle, n: u32) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        let testo = if n > 0 {
            format!("Gestionale PharmaTek — {n} da leggere")
        } else {
            "Gestionale PharmaTek".to_string()
        };
        tray.set_tooltip(Some(testo)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Stato iniziale: onboarded?, identità, deviceId, cartella dati.
#[tauri::command]
pub fn app_bootstrap(app: tauri::AppHandle) -> Result<BootstrapDto, String> {
    let boot = app
        .try_state::<AppState>()
        .map(|state| state.bootstrap())
        .ok_or_else(|| "Stato app non ancora pronto, riprova tra un istante.".to_string())?;
    if boot.reconnect_required {
        for (label, window) in app.webview_windows() {
            if label != "main" {
                let _ = window.destroy();
            }
        }
        if let Some(notificatore) =
            app.try_state::<std::sync::Arc<crate::notifiche::Notificatore>>()
        {
            notificatore.disattiva_sessione();
        }
        let _ = app.emit_to("main", EVENTO_RICERCA_INVALIDATA, ());
    }
    Ok(boot)
}

/// Apre il motore sulla cartella scelta e restituisce gli utenti già presenti.
#[tauri::command]
pub fn open_data_dir(data_dir: String, state: State<'_, AppState>) -> Result<Vec<UserDto>, String> {
    state.open_data_dir(&data_dir)
}

/// Completa l'onboarding (crea/usa/riconfigura utente + registra dispositivo).
#[tauri::command]
pub fn finish_onboarding(
    args: FinishOnboarding,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<IdentityDto, String> {
    let identity = state.finish_onboarding(args)?;
    #[cfg(target_os = "windows")]
    {
        if desktop_search_shortcut_path(&app)
            .map(|path| path.exists())
            .unwrap_or(false)
        {
            let _ = prepara_desktop_search_icon(&app);
        }
    }
    Ok(identity)
}

/// Utenti del registro condiviso (motore già aperto).
#[tauri::command]
pub fn get_users(state: State<'_, AppState>) -> Vec<UserDto> {
    state.get_users()
}

/// Identità corrente (se onboarded).
#[tauri::command]
pub fn whoami(state: State<'_, AppState>) -> Option<IdentityDto> {
    state.whoami()
}

/// Aggiorna nome e avatar dell'utente corrente (Impostazioni → Profilo).
#[tauri::command]
pub fn aggiorna_profilo(
    nome: String,
    avatar_tipo: String,
    avatar_valore: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<IdentityDto, String> {
    let result = state.aggiorna_profilo(&nome, &avatar_tipo, &avatar_valore);
    emetti_se_ok(&app, result, &["user"])
}

/// Salva i byte di una foto avatar in `meta/avatars/<userId>.png`.
#[tauri::command]
pub fn save_avatar(
    user_id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.save_avatar(&user_id, &data)
}

/// Legge i byte della foto avatar (per ricostruirla nella UI).
#[tauri::command]
pub fn read_avatar(user_id: String, state: State<'_, AppState>) -> Result<Option<Vec<u8>>, String> {
    state.read_avatar(&user_id)
}

/// Forza un giro di sincronizzazione (rilettura dei log).
#[tauri::command]
pub fn force_sync(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let entities = state.force_sync_entities()?;
    if !entities.is_empty() {
        emetti_entita_modificate(&app, &entities);
    }
    Ok(entities.len())
}

/// Controllo incrementale di background: non ricostruisce mai la proiezione in
/// silenzio. Le anomalie passano dal flusso bloccante del frontend.
#[tauri::command]
pub fn sync_poll(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    match state.poll_sync_entities()? {
        SyncPollOutcome::Changed(entities) => {
            if !entities.is_empty() {
                emetti_entita_modificate(&app, &entities);
            }
            Ok(entities.len())
        }
        SyncPollOutcome::Rebuild(reason) => {
            let _ = app.emit("pt:data-wiped", serde_json::json!({ "reason": reason }));
            Ok(0)
        }
        SyncPollOutcome::Waiting => {
            let _ = app.emit(
                "pt:data-wiped",
                serde_json::json!({ "reason": "restore-waiting" }),
            );
            Ok(0)
        }
    }
}

/// Panoramica sincronizzazione (dispositivi + ultima attività + freschezza).
#[tauri::command]
pub fn sync_overview(state: State<'_, AppState>) -> Result<SyncOverviewDto, String> {
    state.sync_overview()
}

/// Elenco amministrativo dei PC ritirabili, inclusi quelli riconfigurati e scollegati.
#[tauri::command]
pub fn sync_overview_ritiro(state: State<'_, AppState>) -> Result<SyncOverviewDto, String> {
    state.sync_overview_ritiro()
}

/// Apre la cartella dati nel file manager.
#[tauri::command]
pub fn apri_cartella_dati(state: State<'_, AppState>) -> Result<(), String> {
    state.apri_cartella_dati()
}

/// Apre la cartella dei backup (la crea se manca).
#[tauri::command]
pub fn apri_cartella_backup(state: State<'_, AppState>) -> Result<(), String> {
    state.apri_cartella_backup()
}

/// Crea un backup zip dei dati condivisi.
#[tauri::command]
pub fn backup_now(
    dest: Option<String>,
    tag: Option<String>,
    state: State<'_, AppState>,
) -> Result<crate::backup::BackupInfo, String> {
    state.backup_now(dest, tag)
}

/// Crea un backup con eventi di avanzamento e coda cooperativa per le operazioni
/// avviate dall'interfaccia. I backup critici interni usano ancora `backup_now`.
#[tauri::command]
pub fn backup_now_progress(
    app: tauri::AppHandle,
    dest: Option<String>,
    tag: Option<String>,
    op_id: String,
    state: State<'_, AppState>,
) -> Result<crate::backup::BackupInfo, String> {
    emetti_progress(&app, &op_id, "backup", 1, "Backup in coda...", false);
    let _guard = background_lock()
        .lock()
        .map_err(|_| "coda operazioni non disponibile".to_string())?;
    emetti_progress(
        &app,
        &op_id,
        "backup",
        4,
        "Avvio backup in background...",
        false,
    );
    respiro_background();
    let result = state.backup_now_with_progress(dest, tag, |pct, msg| {
        emetti_progress(&app, &op_id, "backup", pct, msg, pct >= 100);
        respiro_background();
    });
    if let Err(err) = &result {
        emetti_progress(
            &app,
            &op_id,
            "backup",
            100,
            &format!("Backup non riuscito: {err}"),
            true,
        );
    }
    result
}

/// Elenco dei backup disponibili.
#[tauri::command]
pub fn lista_backup(
    dest: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::backup::BackupInfo>, String> {
    state.lista_backup(dest)
}

/// Ripristina un backup (sostituisce i dati). Irreversibile.
#[tauri::command]
pub fn ripristina_backup(
    zip_path: String,
    snapshot_path_in_zip: Option<String>,
    mode: Option<String>,
    restore_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.ripristina_backup(
        &zip_path,
        snapshot_path_in_zip.as_deref(),
        mode.as_deref(),
        restore_id.as_deref(),
    )
}

#[tauri::command]
pub fn backup_snapshot_choices(
    zip_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::backup::SnapshotInfoDto>, String> {
    state.backup_snapshot_choices(&zip_path)
}

#[tauri::command]
pub fn restore_prepare(
    state: State<'_, AppState>,
) -> Result<crate::app::RestoreCoordinationDto, String> {
    state.restore_prepare()
}

#[tauri::command]
pub fn restore_coordination_status(
    restore_id: String,
    state: State<'_, AppState>,
) -> Result<crate::app::RestoreCoordinationDto, String> {
    state.restore_coordination_status(&restore_id)
}

#[tauri::command]
pub fn restore_cancel(restore_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.restore_cancel(&restore_id)
}

#[tauri::command]
pub fn ottimizza_database(
    generation_id: String,
    dedup_merges: Option<Vec<crate::app::DedupClienteMergeInput>>,
    forza: Option<bool>,
    state: State<'_, AppState>,
) -> Result<crate::app::OttimizzazioneDatabaseResult, String> {
    state.ottimizza_database(
        &generation_id,
        dedup_merges.unwrap_or_default(),
        forza.unwrap_or(false),
    )
}

/// Elimina un singolo file di backup dalla lista in Impostazioni.
#[tauri::command]
pub fn elimina_backup(zip_path: String, state: State<'_, AppState>) -> Result<(), String> {
    state.elimina_backup(&zip_path)
}

/// Reset leggero: riconfigura questo PC (onboarding) senza toccare i dati condivisi.
#[tauri::command]
pub fn reset_leggero(state: State<'_, AppState>) -> Result<(), String> {
    state.reset_leggero()
}

/// Ritira un dispositivo/profilo: backup + snapshot, rimozione log e logout remoto.
#[tauri::command]
pub fn ritira_dispositivo(
    device_id: String,
    state: State<'_, AppState>,
) -> Result<RitiroDispositivoResult, String> {
    state.ritira_dispositivo(&device_id)
}

/// Ricostruisce la proiezione locale SQLite cancellandola e riaprendola da zero.
#[tauri::command]
pub fn ricostruisci_proiezione_locale(
    state: State<'_, AppState>,
    nt: State<'_, std::sync::Arc<crate::notifiche::Notificatore>>,
) -> Result<(), String> {
    let result = state.ricostruisci_proiezione_locale();
    if result.is_ok() {
        nt.invalida_suggerimenti(&["snapshot".into()]);
    }
    result
}

/// Acquisisce un lock cooperativo su OneDrive per un'operazione sensibile.
#[tauri::command]
pub fn acquisisci_lock(azione: String, state: State<'_, AppState>) -> Result<(), String> {
    state.acquisisci_lock(&azione)
}

/// Rinnova il lock già posseduto da questo processo senza consentire una seconda acquisizione.
#[tauri::command]
pub fn rinnova_lock(azione: String, state: State<'_, AppState>) -> Result<(), String> {
    state.rinnova_lock(&azione)
}

/// Stato del lock cooperativo attivo, se presente.
#[tauri::command]
pub fn operation_lock_status(
    state: State<'_, AppState>,
) -> Result<Option<crate::app::OperationLockDto>, String> {
    state.operation_lock_status()
}

/// Rilascia il lock cooperativo di questo dispositivo.
#[tauri::command]
pub fn rilascia_lock(azione: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    match azione
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(azione) => state.rilascia_lock_se(azione),
        None => state.rilascia_lock(),
    }
}

/// Reset completo del programma (cancella stato locale + dati condivisi). Irreversibile.
#[tauri::command]
pub fn reset_completo(state: State<'_, AppState>) -> Result<(), String> {
    state.reset_completo()
}

/// Solo demo: popola ~50 ordini di prova (e assicura le anagrafiche di default).
#[tauri::command]
pub fn popola_demo(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let n = state.popola_demo()?;
    emetti_bulk_demo(&app);
    Ok(n)
}

#[tauri::command]
pub fn popola_demo_progress(
    app: tauri::AppHandle,
    op_id: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    emetti_progress(
        &app,
        &op_id,
        "demo",
        1,
        "Importazione demo in coda...",
        false,
    );
    let _guard = background_lock()
        .lock()
        .map_err(|_| "coda operazioni non disponibile".to_string())?;
    emetti_progress(
        &app,
        &op_id,
        "demo",
        12,
        "Ripulisco eventuali dati demo precedenti...",
        false,
    );
    respiro_background();
    emetti_progress(
        &app,
        &op_id,
        "demo",
        35,
        "Creo ordini, righe, pagamenti e spedizioni demo...",
        false,
    );
    let result = state.popola_demo();
    match result {
        Ok(n) => {
            emetti_bulk_demo(&app);
            emetti_progress(
                &app,
                &op_id,
                "demo",
                100,
                "Importazione demo completata.",
                true,
            );
            Ok(n)
        }
        Err(err) => {
            emetti_progress(
                &app,
                &op_id,
                "demo",
                100,
                &format!("Importazione demo non riuscita: {err}"),
                true,
            );
            Err(err)
        }
    }
}

/// Solo demo: rimuove gli ordini demo creati.
#[tauri::command]
pub fn azzera_demo(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let n = state.azzera_demo()?;
    emetti_bulk_demo(&app);
    Ok(n)
}

#[tauri::command]
pub fn azzera_demo_progress(
    app: tauri::AppHandle,
    op_id: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    emetti_progress(&app, &op_id, "demo", 1, "Pulizia demo in coda...", false);
    let _guard = background_lock()
        .lock()
        .map_err(|_| "coda operazioni non disponibile".to_string())?;
    emetti_progress(
        &app,
        &op_id,
        "demo",
        35,
        "Rimuovo ordini e dati demo...",
        false,
    );
    respiro_background();
    let result = state.azzera_demo();
    match result {
        Ok(n) => {
            emetti_bulk_demo(&app);
            emetti_progress(&app, &op_id, "demo", 100, "Pulizia demo completata.", true);
            Ok(n)
        }
        Err(err) => {
            emetti_progress(
                &app,
                &op_id,
                "demo",
                100,
                &format!("Pulizia demo non riuscita: {err}"),
                true,
            );
            Err(err)
        }
    }
}

// ---- CRUD generico sui record (anagrafiche, ordini…) ----

#[tauri::command]
pub fn records_list(entity: String, state: State<'_, AppState>) -> Result<Vec<RecordDto>, String> {
    state.records_list(&entity)
}

#[tauri::command]
pub fn record_get(
    entity: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<RecordDto>, String> {
    state.record_get(&entity, &id)
}

#[tauri::command]
pub fn records_get_many(
    entity: String,
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<RecordDto>, String> {
    state.records_get_many(&entity, &ids)
}

#[tauri::command]
pub fn record_create(
    entity: String,
    fields: Map<String, Value>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<RecordDto, String> {
    let result = state.record_create(&entity, fields);
    if result.is_ok() {
        emetti_entita_modificate(&app, std::slice::from_ref(&entity));
    }
    result
}

/// Crea un record con id fornito dal chiamante (deterministico, idempotente/upsert):
/// usato per record che devono convergere fra dispositivi (occorrenze ricorrenti dei
/// promemoria, singoletti di impostazioni condivise).
#[tauri::command]
pub fn record_create_id(
    entity: String,
    id: String,
    fields: Map<String, Value>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<RecordDto, String> {
    let result = state.record_create_with_id(&entity, &id, fields);
    if result.is_ok() {
        emetti_entita_modificate(&app, std::slice::from_ref(&entity));
    }
    result
}

#[tauri::command]
pub fn record_update(
    entity: String,
    id: String,
    fields: Map<String, Value>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<RecordDto, String> {
    let result = state.record_update(&entity, &id, fields);
    if result.is_ok() {
        emetti_entita_modificate(&app, std::slice::from_ref(&entity));
    }
    result
}

/// Crea una bozza durevole e idempotente. Non esegue alcun invio esterno.
#[tauri::command]
pub fn comunicazione_crea_bozza(
    input: ComunicazioneCreaInput,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ComunicazioneDto, String> {
    emetti_se_ok(
        &app,
        state.comunicazione_crea_bozza(input),
        &["comunicazione"],
    )
}

/// Salva un PDF/PNG nella cache privata del PC e restituisce soltanto il
/// riferimento content-addressed inseribile nell'outbox.
#[tauri::command]
pub fn documento_cache_salva(
    input: DocumentoCacheSalvaInput,
    state: State<'_, AppState>,
) -> Result<AllegatoComunicazioneInput, String> {
    state.documento_cache_salva(input)
}

/// Rilascia i documenti appena generati. Con la pulizia immediata restano sul
/// disco soltanto quelli ancora necessari a bozze, revisioni, invii o retry.
#[tauri::command]
pub fn documenti_cache_rilascia(
    allegati: Vec<AllegatoComunicazioneInput>,
    elimina_se_non_usati: Option<bool>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    state.documenti_cache_rilascia_con_policy(&allegati, elimina_se_non_usati.unwrap_or(false))
}

#[tauri::command]
pub fn comunicazioni_lista(state: State<'_, AppState>) -> Result<Vec<ComunicazioneDto>, String> {
    state.comunicazioni_lista()
}

/// Affida la bozza alla coda. Il worker mittente non è ancora attivato in 11B-1.
#[tauri::command]
pub fn comunicazione_metti_in_coda(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ComunicazioneDto, String> {
    emetti_se_ok(
        &app,
        state.comunicazione_metti_in_coda(&id),
        &["comunicazione"],
    )
}

#[tauri::command]
pub fn comunicazione_annulla(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ComunicazioneDto, String> {
    emetti_se_ok(&app, state.comunicazione_annulla(&id), &["comunicazione"])
}

#[tauri::command]
pub fn comunicazione_whatsapp_riprendi(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ComunicazioneDto, String> {
    emetti_se_ok(
        &app,
        state.comunicazione_whatsapp_riprendi(&id),
        &["comunicazione"],
    )
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn whatsapp_diagnostica_get(
    app: tauri::AppHandle,
) -> Result<crate::app::whatsapp_windows::WhatsappDiagnosticaDto, String> {
    let task_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        task_app.state::<AppState>().whatsapp_diagnostica_get()
    })
    .await
    .map_err(|error| format!("diagnostica WhatsApp interrotta: {error}"))?
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn whatsapp_stato_get(
    state: State<'_, AppState>,
) -> Result<crate::app::whatsapp_windows::WhatsappDiagnosticaDto, String> {
    state.whatsapp_stato_get()
}

#[tauri::command]
pub fn whatsapp_interseca_overlay() -> bool {
    #[cfg(target_os = "windows")]
    {
        crate::app::whatsapp_windows::whatsapp_interseca_overlay()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn whatsapp_verifica_e_invia_prova(
    input: WhatsappVerificaInput,
    app: tauri::AppHandle,
) -> Result<WhatsappVerificaProvaDto, String> {
    let task_app = app.clone();
    let risultato = tauri::async_runtime::spawn_blocking(move || {
        task_app
            .state::<AppState>()
            .whatsapp_verifica_e_invia_prova(input)
    })
    .await
    .map_err(|error| format!("collaudo WhatsApp interrotto: {error}"))?;

    // Il deep-link porta necessariamente WhatsApp davanti. Quando il collaudo
    // termina, positivo o negativo, restituiamo sempre il controllo visivo al
    // gestionale senza dipendere dai tempi di rendering del frontend.
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    risultato
}

#[tauri::command]
pub fn comunicazione_elimina(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(&app, state.comunicazione_elimina(&id), &["comunicazione"])
}

#[tauri::command]
pub fn comunicazioni_elimina(
    ids: Vec<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    emetti_se_ok(&app, state.comunicazioni_elimina(&ids), &["comunicazione"])
}

#[tauri::command]
pub fn campagna_comunicazione_elimina(
    campagna_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    emetti_se_ok(
        &app,
        state.campagna_comunicazione_elimina(&campagna_id),
        &["comunicazione"],
    )
}

#[tauri::command]
pub fn campagna_comunicazione_sospendi(
    campagna_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ComunicazioneDto>, String> {
    emetti_se_ok(
        &app,
        state.campagna_comunicazione_sospendi(&campagna_id),
        &["comunicazione"],
    )
}

#[tauri::command]
pub fn campagna_comunicazione_riprendi(
    campagna_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ComunicazioneDto>, String> {
    emetti_se_ok(
        &app,
        state.campagna_comunicazione_riprendi(&campagna_id),
        &["comunicazione"],
    )
}

#[tauri::command]
pub fn campagna_comunicazione_annulla(
    campagna_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ComunicazioneDto>, String> {
    emetti_se_ok(
        &app,
        state.campagna_comunicazione_annulla(&campagna_id),
        &["comunicazione"],
    )
}

#[tauri::command]
pub fn campagna_comunicazione_riprova_fallite(
    campagna_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ComunicazioneDto>, String> {
    emetti_se_ok(
        &app,
        state.campagna_comunicazione_riprova_fallite(&campagna_id),
        &["comunicazione"],
    )
}

#[tauri::command]
pub fn comunicazione_email_invia(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ComunicazioneDto, String> {
    emetti_se_ok(
        &app,
        state.comunicazione_email_invia(&id),
        &["comunicazione"],
    )
}

#[tauri::command]
pub fn comunicazione_reinvia(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ComunicazioneDto, String> {
    emetti_se_ok(&app, state.comunicazione_reinvia(&id), &["comunicazione"])
}

#[tauri::command]
pub fn comunicazioni_reinvia(
    ids: Vec<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ComunicazioneDto>, String> {
    emetti_se_ok(&app, state.comunicazioni_reinvia(&ids), &["comunicazione"])
}

#[tauri::command]
pub fn modelli_comunicazione_lista(
    state: State<'_, AppState>,
) -> Result<Vec<ModelloComunicazioneDto>, String> {
    state.modelli_comunicazione_lista()
}

#[tauri::command]
pub fn modello_comunicazione_salva(
    input: ModelloComunicazioneSalvaInput,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ModelloComunicazioneDto, String> {
    emetti_se_ok(
        &app,
        state.modello_comunicazione_salva(input),
        &["modello_comunicazione", "modello_comunicazione_versione"],
    )
}

#[tauri::command]
pub fn modello_comunicazione_elimina(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(
        &app,
        state.modello_comunicazione_elimina(&id),
        &["modello_comunicazione"],
    )
}

#[tauri::command]
pub fn modello_comunicazione_storico(
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ModelloComunicazioneDto>, String> {
    state.modello_comunicazione_storico(&id)
}

#[tauri::command]
pub fn configurazione_email_get(
    state: State<'_, AppState>,
) -> Result<ConfigurazioneEmailDto, String> {
    state.configurazione_email_get()
}

/// Salva i parametri condivisi e, se fornita, la password nel portachiavi
/// Windows locale. La password non viene mai inclusa negli eventi emessi.
#[tauri::command]
pub fn configurazione_email_salva(
    input: ConfigurazioneEmailSalvaInput,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ConfigurazioneEmailDto, String> {
    emetti_se_ok(
        &app,
        state.configurazione_email_salva(input),
        &["configurazione_canale"],
    )
}

/// Verifica SMTP con un invio controllato e, senza reinviare, tenta di
/// archiviare la stessa MIME nella cartella IMAP «Posta inviata».
#[tauri::command]
pub fn configurazione_email_verifica_e_invia_prova(
    input: ConfigurazioneEmailSalvaInput,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ConfigurazioneEmailDto, String> {
    emetti_se_ok(
        &app,
        state.configurazione_email_verifica_e_invia_prova(input),
        &["configurazione_canale"],
    )
}

#[tauri::command]
pub fn configurazione_email_password_rimuovi(
    state: State<'_, AppState>,
) -> Result<ConfigurazioneEmailDto, String> {
    state.configurazione_email_password_rimuovi()
}

/// Salva testata e righe d'ordine in un batch con patch per campo.
#[tauri::command]
pub fn ordine_salva_base(
    input: OrdineSalvaBaseInput,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<OrdineSalvaBaseResult, String> {
    let aggiorna_rimborso = input.rimborso_extra.is_some();
    let result = state.ordine_salva_base(input);
    if result.is_ok() {
        let mut entita = vec!["ordine".into(), "riga_ordine".into()];
        if aggiorna_rimborso {
            entita.push("rimborso".into());
        }
        emetti_entita_modificate(&app, &entita);
    }
    result
}

#[tauri::command]
pub fn preventivi_lista(state: State<'_, AppState>) -> Result<Vec<PreventivoDto>, String> {
    state.preventivi_lista()
}

#[tauri::command]
pub fn configurazione_documenti_get(
    state: State<'_, AppState>,
) -> Result<ConfigurazioneDocumentiDto, String> {
    state.configurazione_documenti_get()
}

#[tauri::command]
pub fn configurazione_documenti_salva(
    input: ConfigurazioneDocumentiSalvaInput,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ConfigurazioneDocumentiDto, String> {
    emetti_se_ok(
        &app,
        state.configurazione_documenti_salva(input),
        &["configurazione_documenti"],
    )
}

#[tauri::command]
pub fn preventivo_alias_lista(
    state: State<'_, AppState>,
) -> Result<Vec<AliasPreventivoDto>, String> {
    state.preventivo_alias_lista()
}

#[tauri::command]
pub fn preventivo_alias_salva(
    alias: String,
    prodotto_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<AliasPreventivoDto, String> {
    emetti_se_ok(
        &app,
        state.preventivo_alias_salva(&alias, &prodotto_id),
        &["alias_preventivo"],
    )
}

#[tauri::command]
pub fn preventivo_ordini_disponibili(
    state: State<'_, AppState>,
) -> Result<Vec<PreventivoDto>, String> {
    state.preventivo_ordini_disponibili()
}

#[tauri::command]
pub fn preventivo_get(
    ordine_id: String,
    state: State<'_, AppState>,
) -> Result<PreventivoDto, String> {
    state.preventivo_get(&ordine_id)
}

#[tauri::command]
pub fn preventivo_salva(
    input: PreventivoSalvaInput,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<PreventivoDto, String> {
    emetti_se_ok(
        &app,
        state.preventivo_salva(input),
        &["preventivo", "ordine", "riga_ordine", "pagamento"],
    )
}

#[tauri::command]
pub fn preventivo_elimina(
    id: String,
    revision: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(
        &app,
        state.preventivo_elimina(&id, &revision),
        &["preventivo"],
    )
}

#[tauri::command]
pub fn preventivo_marca_inviato_manuale(
    ordine_id: String,
    revision: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<PreventivoDto, String> {
    emetti_se_ok(
        &app,
        state.preventivo_marca_inviato_manuale(&ordine_id, &revision),
        &["preventivo"],
    )
}

#[tauri::command]
pub fn preventivo_ripristina(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(&app, state.preventivo_ripristina(&id), &["preventivo"])
}

#[tauri::command]
pub fn preventivo_purge(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(&app, state.preventivo_purge(&id), &["preventivo"])
}

#[tauri::command]
pub fn scheda_cliente_get(
    ordine_id: String,
    state: State<'_, AppState>,
) -> Result<SchedaClienteDto, String> {
    state.scheda_cliente_get(&ordine_id)
}

#[tauri::command]
pub fn scheda_cliente_salva(
    input: SchedaClienteSalvaInput,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SchedaClienteDto, String> {
    emetti_se_ok(&app, state.scheda_cliente_salva(input), &["scheda_cliente"])
}

/// Salva in un solo batch i dati inseriti nel modale di preparazione alla produzione.
#[tauri::command]
pub fn produzione_compila_righe(
    aggiornamenti: Vec<ProduzioneRigaPatchInput>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(
        &app,
        state.produzione_compila_righe(aggiornamenti),
        &["riga_ordine"],
    )
}

#[tauri::command]
pub fn record_delete(
    entity: String,
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.record_delete(&entity, &id);
    if result.is_ok() {
        if entity == "ordine" {
            emetti_entita_modificate(&app, &["ordine".into(), "preventivo".into()]);
        } else if entity == "pagamento" {
            emetti_entita_modificate(&app, &["pagamento".into(), "ordine".into()]);
        } else {
            emetti_entita_modificate(&app, std::slice::from_ref(&entity));
        }
    }
    result
}

#[tauri::command]
pub fn clienti_deduplica_applica(
    merges: Vec<DedupClienteMergeInput>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<DedupClientiResult, String> {
    let result = state.clienti_deduplica_applica(merges);
    emetti_se_ok(&app, result, &["cliente", "ordine", "medico", "rimborso"])
}

/// Elenco del Giornaliero (ordini arricchiti con numero, totale, residuo, nomi).
#[tauri::command]
pub fn ordini_lista(state: State<'_, AppState>) -> Result<Vec<OrdineDto>, String> {
    state.ordini_lista()
}

/// Anni che contengono ordini (per il selettore anno).
#[tauri::command]
pub fn anni_ordini(state: State<'_, AppState>) -> Result<Vec<i64>, String> {
    state.anni_ordini()
}

/// Prezzo suggerito dal listino per un prodotto (con contesto medico → agente).
#[tauri::command]
pub fn prezzo_suggerito(
    prodotto_id: String,
    medico_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<PrezzoSuggeritoDto, String> {
    state.prezzo_suggerito(&prodotto_id, medico_id)
}

#[tauri::command]
pub fn prezzi_suggeriti_batch(
    prodotto_ids: Vec<String>,
    medico_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<PrezzoSuggeritoProdottoDto>, String> {
    state.prezzi_suggeriti_batch(prodotto_ids, medico_id)
}

/// Report provvigioni per agente/periodo (FASE 2).
#[tauri::command]
pub fn provvigioni_report(
    dal: Option<String>,
    al: Option<String>,
    agente_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<ProvvigioniReportDto, String> {
    state.provvigioni_report(dal, al, agente_id)
}

/// Statistiche della dashboard (KPI + serie per i grafici) nel periodo (FASE 6B).
#[tauri::command]
pub fn dashboard_stats(
    dal: Option<String>,
    al: Option<String>,
    state: State<'_, AppState>,
) -> Result<DashboardStatsDto, String> {
    state.dashboard_stats(dal, al)
}

/// Pannelli operativi della dashboard: ultime 6 righe utili già limitate lato backend.
#[tauri::command]
pub fn dashboard_pannelli(state: State<'_, AppState>) -> Result<DashboardPanelsDto, String> {
    state.dashboard_pannelli()
}

/// Azioni utili correnti, già ordinate e protette dal gate Premium.
#[tauri::command]
pub fn suggerimenti_lista(
    preferenze: SuggerimentiPreferenzeInput,
    nt: State<'_, std::sync::Arc<crate::notifiche::Notificatore>>,
) -> Result<SuggerimentiBundleDto, String> {
    nt.suggerimenti_dashboard_lista(preferenze)
}

/// Forza una nuova derivazione delle azioni, ignorando la cache corrente.
#[tauri::command]
pub fn suggerimenti_rigenera(
    preferenze: SuggerimentiPreferenzeInput,
    nt: State<'_, std::sync::Arc<crate::notifiche::Notificatore>>,
) -> Result<SuggerimentiBundleDto, String> {
    nt.suggerimenti_dashboard_rigenera(preferenze)
}

/// Ricalcola tutte le azioni correnti ignorando, solo per questa lettura,
/// fotografie nascoste e categorie sospese. Non invalida né modifica la cache.
#[tauri::command]
pub fn suggerimenti_rigenera_completa(
    anno: Option<i32>,
    state: State<'_, AppState>,
) -> Result<SuggerimentiBundleDto, String> {
    state.suggerimenti_lista_completa_per_anno(anno.unwrap_or(0))
}

/// Nasconde la fotografia corrente del suggerimento su tutte le postazioni Premium.
#[tauri::command]
pub fn suggerimento_nascondi(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.suggerimento_nascondi(&id);
    if result.is_ok() {
        emetti_entita_modificate(&app, &["suggerimento_stato".into(), "spedizione".into()]);
    }
    result
}

/// Nasconde più fotografie correnti con un solo batch condiviso.
#[tauri::command]
pub fn suggerimenti_nascondi(
    ids: Vec<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.suggerimenti_nascondi(&ids);
    if result.is_ok() {
        emetti_entita_modificate(&app, &["suggerimento_stato".into(), "spedizione".into()]);
    }
    result
}

/// Esporta il report provvigioni del periodo in un file `.xlsx`.
#[tauri::command]
pub fn provvigioni_export(
    path: String,
    dal: Option<String>,
    al: Option<String>,
    agente_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.provvigioni_export(&path, dal, al, agente_id)
}

/// Export generico di una griglia (Crediti/Rimborsi/Giornaliero…) in `.xlsx`.
#[tauri::command]
pub fn griglia_export(
    path: String,
    foglio: String,
    colonne: Vec<crate::export::ColExport>,
    righe: Vec<serde_json::Value>,
    orizzontale: bool,
    simbolo_euro: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.griglia_export(&path, &foglio, colonne, righe, orizzontale, simbolo_euro)
}

fn salva_documento_su_percorso(path: String, dati_base64: String) -> Result<(), String> {
    let destinazione = PathBuf::from(path);
    if destinazione.as_os_str().is_empty() || destinazione.file_name().is_none() {
        return Err("percorso di salvataggio non valido".into());
    }
    let dati = base64::engine::general_purpose::STANDARD
        .decode(dati_base64)
        .map_err(|error| format!("contenuto del documento non valido: {error}"))?;
    std::fs::write(&destinazione, dati)
        .map_err(|error| format!("salvataggio del documento non riuscito: {error}"))
}

/// Scrive un documento generato nel percorso scelto esplicitamente dall'utente.
#[tauri::command]
pub fn documento_salva(path: String, dati_base64: String) -> Result<(), String> {
    salva_documento_su_percorso(path, dati_base64)
}

/// Salva un PDF/PNG di preventivo: il renderer può essere usato anche in
/// anteprima senza Premium, ma l'esportazione su file resta protetta nel core.
fn documento_preventivo_salva_con_accesso(
    state: &AppState,
    path: String,
    dati_base64: String,
) -> Result<(), String> {
    crate::premium::ensure_access(state)?;
    salva_documento_su_percorso(path, dati_base64)
}

#[tauri::command]
pub fn documento_preventivo_salva(
    path: String,
    dati_base64: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    documento_preventivo_salva_con_accesso(&state, path, dati_base64)
}

/// Automazione "Chiuso": chiude gli ordini Spediti+saldati da ≥20gg. Ritorna quanti.
#[tauri::command]
pub fn ordini_auto_chiudi(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    emetti_se_ok(&app, state.ordini_auto_chiudi(), &["ordine"])
}

#[tauri::command]
pub fn record_restore(
    entity: String,
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.record_restore(&entity, &id);
    if result.is_ok() {
        if entity == "ordine" {
            emetti_entita_modificate(&app, &["ordine".into(), "preventivo".into()]);
        } else {
            emetti_entita_modificate(&app, std::slice::from_ref(&entity));
        }
    }
    result
}

/// Ripristina un ordine rifiutato dal Giornaliero (→ Nuovo/Confermato). Ritorna il nuovo stato.
#[tauri::command]
pub fn ordine_ripristina(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    emetti_se_ok(&app, state.ordine_ripristina(&id), &["ordine"])
}

/// Porta in blocco ordini a uno stato di produzione ("In produzione"/"Arrivato IT") con data.
#[tauri::command]
pub fn ordini_avanza_produzione(
    ids: Vec<String>,
    stato: String,
    data: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    emetti_se_ok(
        &app,
        state.ordini_avanza_produzione(&ids, &stato, &data),
        &["ordine"],
    )
}

/// Manda in produzione un set di ordini come un unico lotto (FASE 5B). Ritorna l'id del lotto.
#[tauri::command]
pub fn produzione_invia(
    ids: Vec<String>,
    data: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    emetti_se_ok(&app, state.produzione_invia(&ids, &data), &["ordine"])
}

/// Disfa l'invio in produzione di un singolo ordine (torna in coda "Da produrre").
#[tauri::command]
pub fn produzione_annulla_ordine(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(&app, state.produzione_annulla_ordine(&id), &["ordine"])
}

/// Annulla un intero lotto di produzione (tutti gli ordini tornano "Da produrre").
#[tauri::command]
pub fn produzione_lotto_annulla(
    lotto: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(&app, state.produzione_lotto_annulla(&lotto), &["ordine"])
}

/// Fonde più lotti di produzione in uno solo. Ritorna il lotto risultante.
#[tauri::command]
pub fn produzione_lotto_unisci(
    lotti: Vec<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    emetti_se_ok(&app, state.produzione_lotto_unisci(lotti), &["ordine"])
}

/// Separa un lotto di produzione unito (annulla l'unione).
#[tauri::command]
pub fn produzione_lotto_separa(
    lotto: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(&app, state.produzione_lotto_separa(&lotto), &["ordine"])
}

// ===== Produzione PER RIGA (FASE 7) =====

/// Manda in produzione le righe selezionate (anche di ordini diversi) come un unico lotto.
#[tauri::command]
pub fn produzione_invia_righe(
    righe_ids: Vec<String>,
    data: String,
    data_prevista: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    emetti_se_ok(
        &app,
        state.produzione_invia_righe(&righe_ids, &data, &data_prevista),
        &["ordine"],
    )
}

/// Porta le righe indicate a uno stato di produzione (`in_produzione`/`arrivato_it`).
#[tauri::command]
pub fn produzione_righe_stato(
    righe_ids: Vec<String>,
    stato: String,
    data: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(
        &app,
        state.produzione_righe_stato(&righe_ids, &stato, &data),
        &["ordine"],
    )
}

/// Annulla l'invio in produzione di una singola riga (torna «da produrre»).
#[tauri::command]
pub fn produzione_riga_annulla(
    riga_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(&app, state.produzione_riga_annulla(&riga_id), &["ordine"])
}

/// Annulla tutte le righe di un lotto di produzione (tornano «da produrre»).
#[tauri::command]
pub fn produzione_lotto_righe_annulla(
    lotto: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(
        &app,
        state.produzione_lotto_righe_annulla(&lotto),
        &["ordine"],
    )
}

/// Porta tutte le righe di un lotto a `arrivato_it`.
#[tauri::command]
pub fn produzione_lotto_righe_arrivate(
    lotto: String,
    data: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(
        &app,
        state.produzione_lotto_righe_arrivate(&lotto, &data),
        &["ordine"],
    )
}

/// Fonde più lotti di produzione (per riga) in uno solo. Ritorna il lotto risultante.
#[tauri::command]
pub fn produzione_lotto_righe_unisci(
    lotti: Vec<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    emetti_se_ok(
        &app,
        state.produzione_lotto_righe_unisci(lotti),
        &["ordine"],
    )
}

/// Separa un lotto di produzione unito (per riga).
#[tauri::command]
pub fn produzione_lotto_righe_separa(
    lotto: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(
        &app,
        state.produzione_lotto_righe_separa(&lotto),
        &["ordine"],
    )
}

/// Export Laboratorio (Immunoterapia) di un lotto in `.xlsx` (FASE 5C). Ritorna il n° di righe.
#[tauri::command]
pub fn laboratorio_export(
    lotto: String,
    path: String,
    base: i64,
    data_prevista: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    state.laboratorio_export(&lotto, &path, base, &data_prevista)
}

/// Export Diagnostica di un lotto in `.xlsx` (un blocco per ordine, FASE 5D). Ritorna n° ordini.
#[tauri::command]
pub fn diagnostica_export(
    lotto: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    state.diagnostica_export(&lotto, &path)
}

#[tauri::command]
pub fn prescriptions_folder_get(
    state: State<'_, AppState>,
) -> Result<PrescriptionsFolderDto, String> {
    state.prescriptions_folder_get()
}

#[tauri::command]
pub fn prescriptions_folder_set(
    path: String,
    state: State<'_, AppState>,
) -> Result<PrescriptionsFolderDto, String> {
    state.prescriptions_folder_set(&path)
}

#[tauri::command]
pub async fn prescriptions_scan_lot(
    lot: String,
    operation_id: String,
    force_refresh: bool,
    app: tauri::AppHandle,
) -> Result<ProductionPrescriptionScanDto, String> {
    let cancelled = operation_start(&operation_id)?;
    let worker_app = app.clone();
    let worker_id = operation_id.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        let state = worker_app.state::<AppState>();
        let event_app = worker_app.clone();
        let event_id = worker_id.clone();
        state.prescriptions_scan_lot(
            &lot,
            force_refresh,
            &cancelled,
            &mut move |phase, progress, current, total, message| {
                emetti_prescrizioni_progress(
                    &event_app, &event_id, phase, progress, current, total, message,
                );
            },
        )
    })
    .await;
    operation_finish(&operation_id);
    let result = joined.map_err(|error| format!("scansione prescrizioni interrotta: {error}"))?;
    if let Err(error) = &result {
        let phase = if error == "operazione annullata" {
            "cancelled"
        } else {
            "error"
        };
        emetti_prescrizioni_progress(&app, &operation_id, phase, None, 0, 0, error);
    }
    result
}

#[tauri::command]
pub fn prescriptions_inspect_files(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<PrescriptionFileDto>, String> {
    state.prescriptions_inspect_files(&paths)
}

#[tauri::command]
pub fn prescription_open(path: String, state: State<'_, AppState>) -> Result<(), String> {
    state.prescription_open(&path)
}

#[tauri::command]
pub async fn prescriptions_zip_save(
    lot: String,
    selections: Vec<PrescriptionSelectionInput>,
    output: String,
    operation_id: String,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    let cancelled = operation_start(&operation_id)?;
    let worker_app = app.clone();
    let worker_id = operation_id.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        let state = worker_app.state::<AppState>();
        let event_app = worker_app.clone();
        let event_id = worker_id.clone();
        state.prescriptions_zip_save(
            &lot,
            &selections,
            &output,
            &cancelled,
            &mut move |phase, progress, current, total, message| {
                emetti_prescrizioni_progress(
                    &event_app, &event_id, phase, progress, current, total, message,
                );
            },
        )
    })
    .await;
    operation_finish(&operation_id);
    let result = joined.map_err(|error| format!("creazione ZIP interrotta: {error}"))?;
    if let Err(error) = &result {
        let phase = if error == "operazione annullata" {
            "cancelled"
        } else {
            "error"
        };
        emetti_prescrizioni_progress(&app, &operation_id, phase, None, 0, 0, error);
    }
    result
}

#[tauri::command]
pub async fn production_attachments_prepare(
    lot: String,
    selections: Vec<PrescriptionSelectionInput>,
    include_zip: bool,
    base: i64,
    operation_id: String,
    app: tauri::AppHandle,
) -> Result<ProductionAttachmentsDto, String> {
    let cancelled = operation_start(&operation_id)?;
    let worker_app = app.clone();
    let worker_id = operation_id.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        let state = worker_app.state::<AppState>();
        let event_app = worker_app.clone();
        let event_id = worker_id.clone();
        state.production_attachments_prepare(
            &lot,
            &selections,
            include_zip,
            base,
            &cancelled,
            &mut move |phase, progress, current, total, message| {
                emetti_prescrizioni_progress(
                    &event_app, &event_id, phase, progress, current, total, message,
                );
            },
        )
    })
    .await;
    operation_finish(&operation_id);
    let result = joined.map_err(|error| format!("preparazione allegati interrotta: {error}"))?;
    if let Err(error) = &result {
        let phase = if error == "operazione annullata" {
            "cancelled"
        } else {
            "error"
        };
        emetti_prescrizioni_progress(&app, &operation_id, phase, None, 0, 0, error);
    }
    result
}

#[tauri::command]
pub fn prescriptions_operation_cancel(operation_id: String) -> bool {
    operation_cancel(&operation_id)
}

/// Elenco del Cestino (record soft-deleted di tutte le entità utente).
#[tauri::command]
pub fn cestino(state: State<'_, AppState>) -> Result<Vec<CestinoDto>, String> {
    state.cestino()
}

/// Elimina definitivamente un record dal Cestino.
#[tauri::command]
pub fn record_purge(
    entity: String,
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.record_purge(&entity, &id);
    if result.is_ok() {
        if entity == "ordine" {
            emetti_entita_modificate(&app, &["ordine".into(), "preventivo".into()]);
        } else {
            emetti_entita_modificate(&app, std::slice::from_ref(&entity));
        }
    }
    result
}

/// Svuota il Cestino.
#[tauri::command]
pub fn cestino_svuota(state: State<'_, AppState>) -> Result<(), String> {
    state.cestino_svuota()
}

/// Pulizia automatica: elimina definitivamente i record nel Cestino da più di N giorni.
#[tauri::command]
pub fn cestino_pulisci(giorni: u64, state: State<'_, AppState>) -> Result<usize, String> {
    state.cestino_pulisci(giorni)
}

#[tauri::command]
pub fn pulizia_dati_anteprima(
    args: PuliziaDatiArgs,
    state: State<'_, AppState>,
) -> Result<PuliziaPreviewDto, String> {
    state.pulizia_dati_anteprima(args)
}

#[tauri::command]
pub fn pulizia_dati_esegui(
    args: PuliziaDatiArgs,
    conferma: String,
    state: State<'_, AppState>,
) -> Result<PuliziaResultDto, String> {
    state.pulizia_dati_esegui(args, &conferma)
}

// ---- Pagamenti / contabilità (FASE 3) ----

/// Pagamenti di un ordine (scadenzario: attesi + saldati).
#[tauri::command]
pub fn pagamenti_ordine(
    ordine_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PagamentoDto>, String> {
    state.pagamenti_ordine(&ordine_id)
}

/// Vista unica Crediti: tutti i pagamenti (attesi/saldati) con filtri opzionali.
#[tauri::command]
pub fn pagamenti_vista(
    agente_id: Option<String>,
    conto_id: Option<String>,
    dal: Option<String>,
    al: Option<String>,
    stato: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<PagamentoVistaDto>, String> {
    state.pagamenti_vista(agente_id, conto_id, dal, al, stato)
}

#[tauri::command]
pub fn pagamenti_proroga_sette_giorni(
    campagna_id: String,
    pagamenti: Vec<ProrogaPagamentoInput>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    emetti_se_ok(
        &app,
        state.pagamenti_proroga_sette_giorni(&campagna_id, pagamenti),
        &["pagamento"],
    )
}

/// Crea un pagamento (atteso o saldato); conferma l'ordine se saldato ed era Nuovo.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pagamento_registra(
    ordine_id: String,
    tipo: String,
    importo: i64,
    saldato: bool,
    scadenza: String,
    conto_id: String,
    data: String,
    verificato: bool,
    note: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<PagamentoDto, String> {
    let result = state.pagamento_registra(
        &ordine_id, &tipo, importo, saldato, &scadenza, &conto_id, &data, verificato, note,
    );
    emetti_se_ok(&app, result, &["pagamento"])
}

/// Salda un pagamento atteso (conto/data/verifica reali); conferma l'ordine se Nuovo.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pagamento_salda(
    id: String,
    conto_id: String,
    data: String,
    verificato: bool,
    fields: Option<Map<String, Value>>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<PagamentoDto, String> {
    let fields = fields.unwrap_or_default();
    let result = if fields.is_empty() {
        state.pagamento_salda(&id, &conto_id, &data, verificato)
    } else {
        state.pagamento_salda_checked(&id, &conto_id, &data, verificato, fields)
    };
    emetti_se_ok(&app, result, &["pagamento"])
}

/// Rateizza il saldo di un ordine: sostituisce gli attesi saldo/rata con N rate attese.
#[tauri::command]
pub fn pagamenti_rateizza(
    ordine_id: String,
    rate: Vec<RataInput>,
    da_spedizione: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.pagamenti_rateizza(&ordine_id, rate, da_spedizione);
    emetti_se_ok(&app, result, &["pagamento"])
}

/// Aggiunge rate per il residuo non ancora presente nello scadenzario, senza sostituire
/// saldi o rate esistenti.
#[tauri::command]
pub fn pagamenti_aggiungi_rate(
    ordine_id: String,
    rate: Vec<RataInput>,
    da_spedizione: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.pagamenti_aggiungi_rate(&ordine_id, rate, da_spedizione);
    emetti_se_ok(&app, result, &["pagamento"])
}

/// Riallinea proporzionalmente saldo/rate aperti al totale attuale dell'ordine.
#[tauri::command]
pub fn pagamenti_riallinea_aperti(
    ordine_id: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<PagamentoDto>, String> {
    let res = state.pagamenti_riallinea_aperti(&ordine_id)?;
    emetti_entita_modificate(&app, &["pagamento".into()]);
    Ok(res)
}

/// Imposta il conto predefinito per un ruolo (`incassi` | `accrediti`).
#[tauri::command]
pub fn conto_predefinito_set(
    conto_id: String,
    ruolo: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.conto_predefinito_set(&conto_id, &ruolo);
    emetti_se_ok(&app, result, &["conto"])
}

// ---- Distinte corrieri (FASE 3C) ----

/// Pagamenti su conto di transito (contrassegno/assegno) ancora da accreditare.
#[tauri::command]
pub fn contrassegni_aperti(
    state: State<'_, AppState>,
) -> Result<Vec<ContrassegnoApertoDto>, String> {
    state.contrassegni_aperti()
}

/// Elenco delle distinte corrieri.
#[tauri::command]
pub fn distinte_lista(state: State<'_, AppState>) -> Result<Vec<DistintaDto>, String> {
    state.distinte_lista()
}

/// Pagamenti coperti da una distinta (dettaglio).
#[tauri::command]
pub fn distinta_righe(
    distinta_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ContrassegnoApertoDto>, String> {
    state.distinta_righe(&distinta_id)
}

/// Crea una distinta corriere accreditando i pagamenti spuntati sul conto reale.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn distinta_crea(
    corriere_id: String,
    data_distinta: String,
    data_accredito: String,
    conto_id: String,
    importo: i64,
    pagamento_ids: Vec<String>,
    pagamenti_attesi: Option<Vec<PagamentoDistintaAtteso>>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<DistintaDto, String> {
    let distinta = state.distinta_crea(
        &corriere_id,
        &data_distinta,
        &data_accredito,
        &conto_id,
        importo,
        pagamento_ids,
        pagamenti_attesi,
    )?;
    emetti_entita_modificate(&app, &["distinta".into()]);
    Ok(distinta)
}

/// Elimina una distinta: i pagamenti coperti tornano in attesa di accredito.
#[tauri::command]
pub fn distinta_elimina(
    id: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    state.distinta_elimina(&id)?;
    emetti_entita_modificate(&app, &["distinta".into()]);
    Ok(())
}

// ---- Spedizioni (FASE 4) ----

/// Analizza insieme i file del laboratorio senza modificare i dati condivisi.
#[tauri::command]
pub fn bollettazione_analizza(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<BollettazioneAnalisiDto, String> {
    state.bollettazione_analizza(&paths)
}

/// Applica in un solo batch l'arrivo o le spedizioni confermate dall'operatore.
#[tauri::command]
pub fn bollettazione_conferma(
    input: BollettazioneConfermaIn,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<BollettazioneConfermaDto, String> {
    emetti_se_ok(
        &app,
        state.bollettazione_conferma(input),
        &["ordine", "riga_ordine", "spedizione"],
    )
}

/// Ordini con righe ancora da spedire (con i dati di destinazione).
#[tauri::command]
pub fn righe_da_spedire(state: State<'_, AppState>) -> Result<Vec<OrdineDaSpedireDto>, String> {
    state.righe_da_spedire()
}

/// Elenco delle spedizioni effettuate (con le righe incluse).
#[tauri::command]
pub fn spedizioni_lista(state: State<'_, AppState>) -> Result<Vec<SpedizioneDto>, String> {
    state.spedizioni_lista()
}

/// Crea una spedizione con le righe selezionate, marcandole spedite.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn spedizione_crea(
    lotto: String,
    data: String,
    corriere_id: String,
    colli: i64,
    peso: i64,
    servizi: String,
    preavviso: bool,
    mezzo: String,
    contrassegno: i64,
    note: String,
    // Righe da spedire col proprio numero/lotto di vaccino (FASE 7).
    numeri: Vec<RigaNumeroIn>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SpedizioneDto, String> {
    let result = state.spedizione_crea(
        &lotto,
        &data,
        &corriere_id,
        colli,
        peso,
        &servizi,
        preavviso,
        &mezzo,
        contrassegno,
        &note,
        &numeri,
    );
    emetti_se_ok(&app, result, &["spedizione"])
}

/// Rimuove un singolo prodotto da un collo effettuato: torna fra quelli da spedire (FASE 7).
#[tauri::command]
pub fn spedizione_riga_rimuovi(
    riga_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.spedizione_riga_rimuovi(&riga_id);
    emetti_se_ok(&app, result, &["spedizione"])
}

/// Crea un collo manuale (senza ordine) dentro un lotto, coi dati destinatario a mano.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn spedizione_collo_manuale(
    lotto: String,
    data: String,
    corriere_id: String,
    numero: String,
    colli: i64,
    peso: i64,
    preavviso: bool,
    mezzo: String,
    contrassegno: i64,
    note: String,
    cliente: String,
    indirizzo: String,
    cap: String,
    citta: String,
    prov: String,
    regione: String,
    telefono: String,
    email: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SpedizioneDto, String> {
    let result = state.spedizione_collo_manuale(
        &lotto,
        &data,
        &corriere_id,
        &numero,
        colli,
        peso,
        preavviso,
        &mezzo,
        contrassegno,
        &note,
        &cliente,
        &indirizzo,
        &cap,
        &citta,
        &prov,
        &regione,
        &telefono,
        &email,
    );
    emetti_se_ok(&app, result, &["spedizione"])
}

/// Annulla una spedizione: le righe tornano da spedire.
#[tauri::command]
pub fn spedizione_annulla(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.spedizione_annulla(&id);
    emetti_se_ok(&app, result, &["spedizione"])
}

/// Annulla un intero lotto (tutte le spedizioni create insieme).
#[tauri::command]
pub fn lotto_annulla(
    lotto: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.lotto_annulla(&lotto);
    emetti_se_ok(&app, result, &["spedizione"])
}

/// Fonde più lotti (gruppi di Effettuate) in uno solo. Ritorna il lotto risultante.
#[tauri::command]
pub fn lotto_unisci(
    lotti: Vec<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    emetti_se_ok(&app, state.lotto_unisci(lotti), &["spedizione"])
}

/// Separa un gruppo unito: ogni spedizione torna al lotto originale (annulla l'unione).
#[tauri::command]
pub fn lotto_separa(
    lotto: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(&app, state.lotto_separa(&lotto), &["spedizione"])
}

/// Unisce colli dello stesso destinatario dentro un solo collo visibile.
#[tauri::command]
pub fn spedizione_destinatari_unisci(
    spedizione_ids: Vec<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(
        &app,
        state.spedizione_destinatari_unisci(spedizione_ids),
        &["spedizione"],
    )
}

/// Separa i destinatari uniti in precedenza.
#[tauri::command]
pub fn spedizione_destinatari_separa(
    spedizione_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(
        &app,
        state.spedizione_destinatari_separa(&spedizione_id),
        &["spedizione"],
    )
}

/// Contrassegna manualmente una spedizione come già avvisata (fuori gestionale).
#[tauri::command]
pub fn spedizione_segna_avvisata(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    emetti_se_ok(
        &app,
        state.spedizione_segna_avvisata(&id),
        &["spedizione", "suggerimento_stato"],
    )
}

/// Riepilogo incassi di un lotto (on-demand): per conto e per agente, esclusi acconti.
#[tauri::command]
pub fn spedizione_riepilogo(
    lotto: String,
    state: State<'_, AppState>,
) -> Result<SpedizioneRiepilogoDto, String> {
    state.spedizione_riepilogo(&lotto)
}

/// Aggiunge un prodotto mancante a un ordine come riga da spedire.
#[tauri::command]
pub fn riga_mancante_aggiungi(
    ordine_id: String,
    prodotto_id: String,
    qta: i64,
    prezzo: i64,
    paziente: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.riga_mancante_aggiungi(&ordine_id, &prodotto_id, qta, prezzo, &paziente);
    emetti_se_ok(&app, result, &["spedizione"])
}

// ---- Rimborsi (FASE 3D) ----

/// Elenco dei rimborsi (filtro opzionale per stato derivato richiesto/effettuato).
#[tauri::command]
pub fn rimborsi_lista(
    stato: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<RimborsoDto>, String> {
    state.rimborsi_lista(stato)
}

/// Crea o aggiorna un rimborso (id vuoto = nuovo).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn rimborso_salva(
    id: String,
    data_richiesta: String,
    importo: i64,
    ragione_sociale: String,
    motivo: String,
    iban: String,
    conto_id: String,
    data_rimborso: String,
    note: String,
    ordine_id: String,
    origine: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<RimborsoDto, String> {
    let result = state.rimborso_salva(
        &id,
        &data_richiesta,
        importo,
        &ragione_sociale,
        &motivo,
        &iban,
        &conto_id,
        &data_rimborso,
        &note,
        &ordine_id,
        &origine,
    );
    emetti_se_ok(&app, result, &["rimborso"])
}

/// Marca un rimborso come effettuato (data + conto di uscita opzionale).
#[tauri::command]
pub fn rimborso_segna_effettuato(
    id: String,
    data_rimborso: String,
    conto_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<RimborsoDto, String> {
    let result = state.rimborso_segna_effettuato(&id, &data_rimborso, &conto_id);
    emetti_se_ok(&app, result, &["rimborso"])
}

/// Pre-compila un rimborso "extra" dall'ordine pagato in eccesso.
#[tauri::command]
pub fn rimborso_extra_precompila(
    ordine_id: String,
    state: State<'_, AppState>,
) -> Result<RimborsoExtraDto, String> {
    state.rimborso_extra_precompila(&ordine_id)
}

/// Storico di un record (chi/cosa/quando).
#[tauri::command]
pub fn record_storico(
    entity: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<StoricoDto>, String> {
    state.record_storico(&entity, &id)
}

/// Importazione dei vecchi file giornalieri storici Excel.
#[tauri::command]
pub fn import_vecchi_giornalieri(
    path_generale: String,
    path_giornaliero: String,
    path_report_folder: String,
) -> Result<Vec<crate::import::ExtractedClient>, String> {
    crate::import::import_all_files(&path_generale, &path_giornaliero, &path_report_folder)
}

/// Verifica che la cartella contenga almeno un file Excel valido (.xlsx, .xlsm, .xls)
#[tauri::command]
pub fn verifica_cartella_excel(path: String) -> Result<bool, String> {
    let folder = std::path::Path::new(&path);
    if !folder.exists() || !folder.is_dir() {
        return Ok(false);
    }
    if let Ok(entries) = std::fs::read_dir(folder) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let ext = p
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if (ext == "xlsx" || ext == "xlsm" || ext == "xls")
                    && calamine::open_workbook_auto(&p).is_ok()
                {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn salvataggio_file_preventivo_rifiuta_un_pc_senza_premium() {
        let app = tempfile::tempdir().unwrap();
        let state = AppState::init(app.path().to_path_buf()).unwrap();
        let destinazione = app.path().join("preventivo.pdf");
        let dati = base64::engine::general_purpose::STANDARD.encode(b"pdf");

        let errore = documento_preventivo_salva_con_accesso(
            &state,
            destinazione.to_string_lossy().into_owned(),
            dati.clone(),
        )
        .unwrap_err();
        assert!(errore.contains("non abilitate"));
        assert!(!destinazione.exists());

        fs::write(app.path().join("premium.json"), br#"{"enabled":true}"#).unwrap();
        documento_preventivo_salva_con_accesso(
            &state,
            destinazione.to_string_lossy().into_owned(),
            dati,
        )
        .unwrap();
        assert_eq!(fs::read(destinazione).unwrap(), b"pdf");
    }
}
