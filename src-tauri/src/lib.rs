//! Core del Gestionale PharmaTek.
//!
//! Architettura (vedi `docs/ARCHITETTURA.md`):
//! - `sync`       : event log append-only su OneDrive, HLC, file-watch, merge LWW
//! - `projection` : fold degli eventi nella proiezione locale SQLite (read model)
//! - `pricing`    : motore di risoluzione prezzo (prodotto/categoria + agente + medico)
//! - `app`        : stato applicativo, identità/onboarding, collante con la finestra
//! - `commands`   : comandi esposti al frontend React via Tauri

// Nei test `run()` e la registrazione `generate_handler!` sono volutamente esclusi:
// le API raggiunte tramite `invoke` sembrerebbero quindi inutilizzate, pur essendo
// collegate nella build reale. La build non-test resta verificata con `-D warnings`.
#![cfg_attr(test, allow(dead_code))]

mod app;
mod backup;
#[cfg(not(test))]
mod commands;
mod data_events;
mod export;
mod import;
mod notifiche;
mod platform;
mod premium;
mod pricing;
mod projection;
mod restore_support;
mod sync;
mod update_signature;

#[cfg(not(test))]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(not(test))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(not(test))]
use tauri::{Emitter, Manager};

#[cfg(not(test))]
use app::AppState;

#[cfg(not(test))]
static AVVIO_MINIMIZZATO_EFFETTIVO: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(not(test))]
static AGGIORNAMENTO_PREPARATO: std::sync::Mutex<Option<IntenzioneRiavvio>> =
    std::sync::Mutex::new(None);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IntenzioneRiavvio {
    Visibile,
    Minimizzato,
}

fn avvio_minimizzato_effettivo(
    argomento_minimized: bool,
    intenzione_riavvio: Option<IntenzioneRiavvio>,
) -> bool {
    match intenzione_riavvio {
        // L'intenzione esplicita deve prevalere sugli argomenti ereditati da
        // `relaunch()`: un processo nato con --minimized può essere stato poi
        // mostrato dall'utente prima di avviare manualmente l'aggiornamento.
        Some(IntenzioneRiavvio::Visibile) => false,
        Some(IntenzioneRiavvio::Minimizzato) => true,
        None => argomento_minimized,
    }
}

#[cfg(not(test))]
fn log_startup(message: impl AsRef<str>) {
    let base = std::env::var_os("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("it.pharmatek.gestionale");
    let _ = std::fs::create_dir_all(&dir);
    let line = format!(
        "[{}] {}\n",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "time-error".to_string()),
        message.as_ref()
    );
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("startup.log"))
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

/// Porta la finestra principale in primo piano (mostra, de-minimizza, focus).
/// Usata dall'istanza singola (secondo avvio) e dal click sull'icona della tray.
#[cfg(not(test))]
fn mostra_finestra_principale(app: &tauri::AppHandle) {
    // Se un update automatico aveva gia' superato i controlli di inattivita', il
    // gesto dell'utente prevale: l'installer puo' proseguire, ma il riavvio non deve
    // riportare l'app di nascosto nella tray.
    promuovi_riavvio_preparato_visibile(app);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        let _ = app.emit_to("main", "pt:main-rivelata", ());
    }
}

/// Chiede al frontend di aprire Spotlight usando lo stesso percorso della hotkey globale.
#[cfg(not(test))]
fn richiedi_spotlight(app: &tauri::AppHandle) {
    promuovi_riavvio_preparato_visibile(app);
    let _ = app.emit_to("main", "pt:apri-spotlight", ());
}

#[cfg(not(test))]
fn ha_argomento(flag: &str) -> bool {
    std::env::args().any(|a| a == flag)
}

#[cfg(not(test))]
fn flag_riavvio_minimizzato_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("relaunch-minimized.flag"))
}

#[cfg(not(test))]
fn consuma_intenzione_riavvio(app: &tauri::AppHandle) -> Option<IntenzioneRiavvio> {
    let path = flag_riavvio_minimizzato_path(app)?;
    let contenuto = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(path);
    match contenuto.trim() {
        "visible" => Some(IntenzioneRiavvio::Visibile),
        // Compatibilità con le versioni precedenti, che scrivevano `1`.
        "minimized" | "1" => Some(IntenzioneRiavvio::Minimizzato),
        _ => None,
    }
}

#[cfg(not(test))]
fn prepara_intenzione_riavvio(
    app: &tauri::AppHandle,
    intenzione: IntenzioneRiavvio,
) -> Result<(), String> {
    let path = flag_riavvio_minimizzato_path(app)
        .ok_or_else(|| "Cartella app non raggiungibile.".to_string())?;
    prenota_intenzione_riavvio_path(&AGGIORNAMENTO_PREPARATO, &path, intenzione)
}

fn prenota_intenzione_riavvio_path(
    stato: &std::sync::Mutex<Option<IntenzioneRiavvio>>,
    path: &std::path::Path,
    intenzione: IntenzioneRiavvio,
) -> Result<(), String> {
    let mut preparato = stato
        .lock()
        .map_err(|_| "Coordinamento aggiornamento non disponibile.".to_string())?;
    if preparato.is_some() {
        return Err("Un altro aggiornamento e' gia' in corso.".to_string());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Preparazione riavvio non riuscita: {e}"))?;
    }
    let valore = match intenzione {
        IntenzioneRiavvio::Visibile => "visible",
        IntenzioneRiavvio::Minimizzato => "minimized",
    };
    std::fs::write(path, valore).map_err(|e| format!("Flag riavvio non scrivibile: {e}"))?;
    *preparato = Some(intenzione);
    Ok(())
}

#[cfg(not(test))]
fn promuovi_riavvio_preparato_visibile(app: &tauri::AppHandle) {
    let Some(path) = flag_riavvio_minimizzato_path(app) else {
        return;
    };
    let _ = promuovi_intenzione_riavvio_path(&AGGIORNAMENTO_PREPARATO, &path);
}

fn promuovi_intenzione_riavvio_path(
    stato: &std::sync::Mutex<Option<IntenzioneRiavvio>>,
    path: &std::path::Path,
) -> Result<(), String> {
    let mut preparato = stato
        .lock()
        .map_err(|_| "Coordinamento aggiornamento non disponibile.".to_string())?;
    if *preparato != Some(IntenzioneRiavvio::Minimizzato) {
        return Ok(());
    }
    std::fs::write(path, "visible").map_err(|e| format!("Flag riavvio non scrivibile: {e}"))?;
    *preparato = Some(IntenzioneRiavvio::Visibile);
    Ok(())
}

fn annulla_intenzione_riavvio_path(path: &std::path::Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!(
            "Annullamento riavvio preparato non riuscito: {err}"
        )),
    }
}

fn annulla_intenzione_riavvio_coordinata(
    stato: &std::sync::Mutex<Option<IntenzioneRiavvio>>,
    path: &std::path::Path,
) -> Result<(), String> {
    let mut preparato = stato
        .lock()
        .map_err(|_| "Coordinamento aggiornamento non disponibile.".to_string())?;
    annulla_intenzione_riavvio_path(path)?;
    *preparato = None;
    Ok(())
}

#[cfg(all(target_os = "windows", not(test)))]
fn imposta_identita_taskbar() {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    // Se una scorciatoia con icona personalizzata punta allo stesso .exe, Windows può
    // riutilizzarne l'associazione nella taskbar. Un AppUserModelID esplicito mantiene
    // l'identità della finestra principale separata dall'icona del launcher Spotlight.
    let app_id = HSTRING::from("it.pharmatek.gestionale");
    if let Err(e) = unsafe { SetCurrentProcessExplicitAppUserModelID(&app_id) } {
        eprintln!("Impossibile impostare l'identità della taskbar: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(test))]
pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        log_startup(format!("panic: {info}"));
    }));

    let _ = rustls::crypto::ring::default_provider().install_default();

    #[cfg(target_os = "windows")]
    imposta_identita_taskbar();

    let result = tauri::Builder::default()
        // Istanza singola: DEVE essere il primo plugin. Al secondo avvio porta in
        // primo piano la finestra già aperta invece di aprirne un'altra (FASE 6A).
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.iter().any(|a| a == "--spotlight") {
                richiedi_spotlight(app);
            } else {
                mostra_finestra_principale(app);
            }
        }))
        // Auto-aggiornamento (updater) + riavvio dopo l'installazione (process)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Dialoghi nativi (file-picker della cartella dati in onboarding)
        .plugin(tauri_plugin_dialog::init())
        // Appunti nativi: evita le richieste di autorizzazione del WebView per
        // il menu contestuale Copia/Incolla dei campi testuali.
        .plugin(tauri_plugin_clipboard_manager::init())
        // Avvio automatico col sistema (toggle in Impostazioni). `--minimized`
        // permette al frontend di partire nascosto nella tray quando autoavviato.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        // Hotkey globale (Alt+P): registrata/gestita dal frontend, qui solo init.
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Il collegamento desktop di Spotlight usa volutamente un'icona diversa
            // ma punta allo stesso eseguibile. Su Windows, soprattutto in dev, quella
            // associazione può finire sulla taskbar se la finestra non dichiara la
            // propria icona: fissiamo esplicitamente quella principale di PharmaTek.
            if let (Some(main), Some(icon)) = (
                app.get_webview_window("main"),
                app.default_window_icon().cloned(),
            ) {
                main.set_icon(icon)?;
            }

            // Cartella locale al PC (fuori da OneDrive): config + proiezione SQLite.
            let app_dir = app.path().app_data_dir()?;
            let state = AppState::init_with_app_handle(app_dir, app.handle().clone())
                .map_err(|e| Box::<dyn std::error::Error>::from(format!("init stato app: {e}")))?;

            if let Err(e) = state.comunicazioni_recupera_invii_interrotti() {
                eprintln!("Errore recupero comunicazioni interrotte: {e}");
            }
            if let Err(e) = state.comunicazioni_trattieni_coda_all_avvio() {
                // Il gate resta chiuso: in caso di errore è preferibile non
                // avviare alcun effetto esterno anziché riprendere una vecchia
                // coda senza una scelta esplicita dell'utente.
                eprintln!("Errore protezione coda comunicazioni all'avvio: {e}");
            }
            app.manage(state);

            // Outbox locale minimale: ogni PC elabora soltanto le comunicazioni
            // accodate durante questa sessione o riattivate esplicitamente
            // dall'utente. Quelle già pendenti all'avvio restano ferme.
            let app_outbox = app.handle().clone();
            std::thread::spawn(move || {
                let state = app_outbox.state::<AppState>();
                let mut wake_token = state.comunicazione_wake_token();
                loop {
                    // Una volta sveglio, svuota l'intera coda locale in ordine. Un
                    // fallimento di recapito viene registrato come esito e non
                    // interrompe i successivi; soltanto un errore interno rimanda
                    // il lavoro al ciclo seguente.
                    while let Ok(Some(comunicazione)) = state.comunicazione_processa_prossima() {
                        // WhatsApp richiede un breve intervallo di quiete:
                        // serve sia a distinguere l'input automatico da
                        // quello dell'operatore, sia a lasciare a Desktop
                        // il tempo di stabilizzare la chat successiva.
                        let pausa = if comunicazione.canale
                            == app::communication::CanaleComunicazione::Whatsapp
                        {
                            // Il driver richiede 600 ms di quiete dall'ultimo
                            // input sintetico; 650 ms conserva il margine senza
                            // aggiungere oltre mezzo secondo a ogni destinatario.
                            650
                        } else {
                            100
                        };
                        std::thread::sleep(std::time::Duration::from_millis(pausa));
                    }
                    // Le nuove code risvegliano subito il worker. Il timeout è
                    // soltanto una rete di sicurezza per recuperi o errori
                    // transitori che non producono un nuovo evento locale.
                    let attesa = state.comunicazione_intervallo_riprova();
                    wake_token = state.comunicazione_attendi_lavoro(wake_token, attesa);
                }
            });

            // Icona nella traybar SOLO se l'avvio automatico è attivo: serve perché in
            // quel caso la «X» riduce nella tray invece di chiudere. Senza autostart la X
            // chiude normalmente, quindi NON mostriamo l'icona (comportamento voluto).
            // Si crea/rimuove a runtime al toggle del'autostart (comando `tray_set`).
            let tray_pronta_all_avvio = {
                use tauri_plugin_autostart::ManagerExt;
                if app.autolaunch().is_enabled().unwrap_or(false) {
                    if let Err(errore) = costruisci_tray(app.handle()) {
                        // Un errore transitorio della tray non deve impedire
                        // l'avvio dell'intera applicazione. La main resterà
                        // visibile e la X chiuderà normalmente.
                        eprintln!("Creazione tray all'avvio non riuscita: {errore}");
                    }
                }
                app.tray_by_id("main").is_some()
            };

            // Rilevatore di notifiche lato Rust (FASE 6D): suona/avvisa anche quando la
            // finestra è nascosta nella tray o non in primo piano (WebView2 lì congela
            // JS+audio). Un timer di fondo lo tiene vivo; il webview lo stimola quando è
            // attivo via `notifiche_config`/`notifiche_check`.
            let notificatore =
                std::sync::Arc::new(notifiche::Notificatore::new(app.handle().clone()));
            app.manage(notificatore.clone());
            // Stato iniziale del fuoco: avviato normale = in primo piano; con `--minimized`
            // parte nascosto nella tray (background). Poi lo aggiornano i window event.
            let intenzione_riavvio = consuma_intenzione_riavvio(app.handle());
            let avvio_minimized = tray_pronta_all_avvio
                && avvio_minimizzato_effettivo(ha_argomento("--minimized"), intenzione_riavvio);
            AVVIO_MINIMIZZATO_EFFETTIVO.store(avvio_minimized, std::sync::atomic::Ordering::SeqCst);
            notificatore.set_main_focused(!avvio_minimized);

            // Fuoco della finestra principale via window event (sul thread principale): il
            // rilevatore lo legge da un atomico invece di interrogare lo stato finestra dal
            // thread di fondo (cross-thread fragile su Windows = causa storica degli avvisi
            // persi). I pop-up non vengono nascosti dal solo focus: la loro pulizia ordinaria
            // avviene esclusivamente quando l'utente apre la campanella.
            if let Some(main) = app.get_webview_window("main") {
                let h = app.handle().clone();
                let nt = notificatore.clone();
                main.on_window_event(move |ev| {
                    if let tauri::WindowEvent::Focused(focused) = ev {
                        nt.set_main_focused(*focused);
                        if *focused {
                            promuovi_riavvio_preparato_visibile(&h);
                        }
                    }
                });
            }

            // NB: la finestra `overlay` dei pop-up NON è più definita in `tauri.conf.json`:
            // le finestre di config, in dev, nascono prima che Vite serva e il loro webview
            // restava «morto» (renderer mai avviato → pop-up mai visibili). Ora la crea a
            // runtime la finestra principale già viva (vedi `useNotifiche.ts`).

            // A finestra nascosta il webview è sospeso e NON chiama `notifiche_check`: il
            // solo trigger è questo timer, quindi lo teniamo reattivo per far comparire i
            // pop-up con poco ritardo anche dalla tray. `catch_unwind` su ogni giro: un
            // singolo panic NON deve uccidere il thread (era ciò che spegneva gli avvisi in
            // background «dopo la prima notifica»).
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    notificatore.scansiona();
                }));
            });

            // I timer JavaScript dei webview nascosti possono essere sospesi da
            // WebView2. Ogni 15 minuti, se la main e tutti i pannelli utente sono
            // invisibili, risvegliamo per un istante l'overlay trasparente e gli
            // affidiamo il controllo update. Spotlight visibile blocca il risveglio.
            let app_heartbeat = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(15 * 60));
                let Some(main) = app_heartbeat.get_webview_window("main") else {
                    continue;
                };
                if main.is_visible().unwrap_or(true) {
                    continue;
                }
                let altre_visibili = app_heartbeat.webview_windows().iter().any(|(label, win)| {
                    label != "main" && label != "overlay" && win.is_visible().unwrap_or(true)
                });
                if altre_visibili {
                    continue;
                }
                let Some(overlay) = app_heartbeat.get_webview_window("overlay") else {
                    continue;
                };
                if overlay.is_visible().unwrap_or(true) {
                    continue;
                }
                let _ = overlay.show();
                let _ = app_heartbeat.emit_to("overlay", "pt:background-maintenance", ());
            });

            // Avvio automatico col flag `--minimized`: parte nascosta nella tray
            // (resta in ascolto per le notifiche). Si apre dal click sull'icona.
            if avvio_minimized {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::import_vecchi_giornalieri,
            commands::verifica_cartella_excel,
            commands::app_bootstrap,
            commands::open_data_dir,
            commands::finish_onboarding,
            commands::get_users,
            commands::whoami,
            commands::aggiorna_profilo,
            commands::save_avatar,
            commands::read_avatar,
            commands::force_sync,
            commands::sync_poll,
            commands::sync_overview,
            commands::sync_overview_ritiro,
            commands::apri_cartella_dati,
            commands::apri_cartella_backup,
            commands::apri_url,
            commands::desktop_search_shortcut_status,
            commands::desktop_search_shortcut_create,
            commands::desktop_search_shortcut_remove,
            commands::updates::installa_ultima_versione,
            commands::updates::remote_control_status,
            commands::backup_now,
            commands::backup_now_progress,
            commands::lista_backup,
            commands::ripristina_backup,
            commands::backup_snapshot_choices,
            commands::restore_prepare,
            commands::restore_coordination_status,
            commands::restore_cancel,
            commands::ottimizza_database,
            commands::elimina_backup,
            commands::reset_leggero,
            commands::ritira_dispositivo,
            commands::ricostruisci_proiezione_locale,
            commands::acquisisci_lock,
            commands::rinnova_lock,
            commands::operation_lock_status,
            commands::rilascia_lock,
            commands::reset_completo,
            commands::popola_demo,
            commands::popola_demo_progress,
            commands::azzera_demo,
            commands::azzera_demo_progress,
            commands::records_list,
            commands::record_get,
            commands::records_get_many,
            commands::record_create,
            commands::record_create_id,
            commands::record_update,
            commands::documento_cache_salva,
            commands::documenti_cache_rilascia,
            commands::comunicazione_crea_bozza,
            commands::comunicazioni_lista,
            commands::comunicazione_metti_in_coda,
            commands::comunicazione_annulla,
            commands::comunicazione_whatsapp_riprendi,
            commands::whatsapp_diagnostica_get,
            commands::whatsapp_stato_get,
            commands::whatsapp_verifica_e_invia_prova,
            commands::comunicazione_elimina,
            commands::comunicazioni_elimina,
            commands::campagna_comunicazione_elimina,
            commands::campagna_comunicazione_sospendi,
            commands::campagna_comunicazione_riprendi,
            commands::campagna_comunicazione_annulla,
            commands::campagna_comunicazione_riprova_fallite,
            commands::comunicazione_email_invia,
            commands::comunicazione_reinvia,
            commands::comunicazioni_reinvia,
            commands::modelli_comunicazione_lista,
            commands::modello_comunicazione_salva,
            commands::modello_comunicazione_elimina,
            commands::modello_comunicazione_storico,
            commands::configurazione_email_get,
            commands::configurazione_email_salva,
            commands::configurazione_email_verifica_e_invia_prova,
            commands::configurazione_email_password_rimuovi,
            commands::ordine_salva_base,
            commands::configurazione_documenti_get,
            commands::configurazione_documenti_salva,
            commands::preventivi_lista,
            commands::preventivo_alias_lista,
            commands::preventivo_alias_salva,
            commands::preventivo_ordini_disponibili,
            commands::preventivo_get,
            commands::preventivo_salva,
            commands::preventivo_elimina,
            commands::preventivo_ripristina,
            commands::preventivo_purge,
            commands::scheda_cliente_get,
            commands::scheda_cliente_salva,
            commands::produzione_compila_righe,
            commands::record_delete,
            commands::clienti_deduplica_applica,
            commands::record_restore,
            commands::ordine_ripristina,
            commands::ordini_avanza_produzione,
            commands::produzione_invia,
            commands::produzione_annulla_ordine,
            commands::produzione_lotto_annulla,
            commands::produzione_lotto_unisci,
            commands::produzione_lotto_separa,
            commands::produzione_invia_righe,
            commands::produzione_righe_stato,
            commands::produzione_riga_annulla,
            commands::produzione_lotto_righe_annulla,
            commands::produzione_lotto_righe_arrivate,
            commands::produzione_lotto_righe_unisci,
            commands::produzione_lotto_righe_separa,
            commands::laboratorio_export,
            commands::diagnostica_export,
            commands::cestino,
            commands::record_purge,
            commands::cestino_svuota,
            commands::cestino_pulisci,
            commands::pulizia_dati_anteprima,
            commands::pulizia_dati_esegui,
            commands::record_storico,
            commands::ordini_lista,
            commands::anni_ordini,
            commands::prezzo_suggerito,
            commands::prezzi_suggeriti_batch,
            commands::provvigioni_report,
            commands::dashboard_stats,
            commands::dashboard_pannelli,
            commands::suggerimenti_lista,
            commands::suggerimenti_rigenera,
            commands::suggerimenti_rigenera_completa,
            commands::suggerimento_nascondi,
            commands::suggerimenti_nascondi,
            commands::provvigioni_export,
            commands::griglia_export,
            commands::documento_salva,
            commands::ordini_auto_chiudi,
            commands::pagamenti_ordine,
            commands::pagamenti_vista,
            commands::pagamenti_proroga_sette_giorni,
            commands::pagamento_registra,
            commands::pagamento_salda,
            commands::pagamenti_rateizza,
            commands::pagamenti_aggiungi_rate,
            commands::pagamenti_riallinea_aperti,
            commands::conto_predefinito_set,
            commands::contrassegni_aperti,
            commands::distinte_lista,
            commands::distinta_righe,
            commands::distinta_crea,
            commands::distinta_elimina,
            commands::bollettazione_analizza,
            commands::bollettazione_conferma,
            commands::righe_da_spedire,
            commands::spedizioni_lista,
            commands::spedizione_crea,
            commands::spedizione_riga_rimuovi,
            commands::spedizione_collo_manuale,
            commands::spedizione_annulla,
            commands::lotto_annulla,
            commands::lotto_unisci,
            commands::lotto_separa,
            commands::spedizione_destinatari_unisci,
            commands::spedizione_destinatari_separa,
            commands::spedizione_riepilogo,
            commands::riga_mancante_aggiungi,
            commands::rimborsi_lista,
            commands::rimborso_salva,
            commands::rimborso_segna_effettuato,
            commands::rimborso_extra_precompila,
            commands::tray_badge,
            notifiche::notifiche_config,
            notifiche::notifiche_check,
            notifiche::notifiche_overlay_pronto,
            notifiche::suggerimenti_notifiche_lista,
            notifiche::suggerimento_duplicati_locale_aggiorna,
            notifiche::notifiche_disattiva_sessione,
            tray_set,
            tray_disponibile,
            forza_uscita,
            avvio_minimizzato,
            prepara_riavvio_minimizzato,
            prepara_riavvio_visibile,
            annulla_riavvio_preparato,
            avvio_spotlight,
            rivela_main_una_volta,
        ])
        .run(tauri::generate_context!());

    if let Err(err) = result {
        log_startup(format!(
            "errore durante l'avvio dell'applicazione Tauri: {err}"
        ));
        panic!("errore durante l'avvio dell'applicazione Tauri: {err}");
    }
}

/// True se l'app è stata avviata in automatico col flag `--minimized` (parte nascosta
/// nella tray). Il frontend lo usa per NON mostrare la finestra principale all'avvio:
/// la `main` nasce con `visible:false`, quindi non bastava più controllare `isVisible`.
#[tauri::command]
#[cfg(not(test))]
fn avvio_minimizzato() -> bool {
    AVVIO_MINIMIZZATO_EFFETTIVO.load(std::sync::atomic::Ordering::SeqCst)
}

/// Chiede al prossimo avvio di restare nascosto nella tray. Serve al riavvio
/// post-update automatico: `relaunch()` non permette di passare `--minimized`.
#[tauri::command]
#[cfg(not(test))]
fn prepara_riavvio_minimizzato(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let app_in_uso = || {
        let main_nascosta = app
            .get_webview_window("main")
            .and_then(|win| win.is_visible().ok())
            == Some(false);
        let pannello_visibile = app.webview_windows().iter().any(|(label, win)| {
            label != "main" && label != "overlay" && win.is_visible().unwrap_or(true)
        });
        !main_nascosta || pannello_visibile
    };
    if app_in_uso() {
        return Err("Aggiornamento automatico annullato: l'app e' tornata in uso.".to_string());
    }
    state.prepare_update()?;
    // Dopo aver chiuso il gate nessuna nuova attività critica può iniziare.
    // Ricontrolliamo però le finestre: l'utente potrebbe averne aperta una tra
    // il primo controllo e l'acquisizione del gate.
    if app_in_uso() {
        state.cancel_prepared_update();
        return Err("Aggiornamento automatico annullato: l'app e' tornata in uso.".to_string());
    }
    prepara_intenzione_riavvio(&app, IntenzioneRiavvio::Minimizzato).inspect_err(|_| {
        state.cancel_prepared_update();
    })
}

/// Chiede al prossimo avvio di mostrare la finestra principale. Prevale anche su
/// `--minimized`, che `relaunch()` può ereditare dall'avvio automatico originale.
#[tauri::command]
#[cfg(not(test))]
fn prepara_riavvio_visibile(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.prepare_update()?;
    prepara_intenzione_riavvio(&app, IntenzioneRiavvio::Visibile).inspect_err(|_| {
        state.cancel_prepared_update();
    })
}

/// Annulla un'intenzione preparata prima di un download/installazione fallito.
/// Senza questa pulizia un avvio futuro non collegato all'update potrebbe ereditare
/// per errore la modalita' visibile o minimizzata dell'operazione precedente.
#[tauri::command]
#[cfg(not(test))]
fn annulla_riavvio_preparato(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let Some(path) = flag_riavvio_minimizzato_path(&app) else {
        state.cancel_prepared_update();
        return Err("Cartella app non raggiungibile.".to_string());
    };
    let result = annulla_intenzione_riavvio_coordinata(&AGGIORNAMENTO_PREPARATO, &path);
    state.cancel_prepared_update();
    result
}

/// True se l'app è stata avviata dalla scorciatoia desktop della ricerca: al cold start
/// il frontend mostra la finestra principale e apre Spotlight quando è pronta.
#[tauri::command]
#[cfg(not(test))]
fn avvio_spotlight() -> bool {
    ha_argomento("--spotlight")
}

/// True SOLO alla prima chiamata in questo processo: il frontend rivela la finestra
/// principale solo al primo mount. I reload successivi del webview — in particolare al
/// **risveglio dalla sospensione**, quando WebView2 ricarica la pagina — ottengono `false`,
/// così la finestra NON si ri-mostra da sola se l'utente l'aveva nascosta nella tray.
/// Il processo Rust sopravvive ai reload del webview, quindi il flag resta valido.
#[tauri::command]
#[cfg(not(test))]
fn rivela_main_una_volta() -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};
    static FATTA: AtomicBool = AtomicBool::new(false);
    !FATTA.swap(true, Ordering::SeqCst)
}

/// Forza la chiusura immediata di tutte le finestre e del processo.
#[tauri::command]
#[cfg(not(test))]
fn forza_uscita(app: tauri::AppHandle) {
    for (_, w) in app.webview_windows() {
        let _ = w.destroy();
    }
    std::process::exit(0);
}

/// Mostra/nasconde l'icona nella traybar, seguendo il toggle dell'avvio automatico
/// (Impostazioni). L'icona ha senso solo con autostart attivo (allora la X chiude e riduce nella
/// tray); spento, la X chiude e l'icona non deve esserci.
#[tauri::command]
#[cfg(not(test))]
fn tray_set(enabled: bool, app: tauri::AppHandle) -> Result<(), String> {
    if enabled {
        if app.tray_by_id("main").is_none() {
            costruisci_tray(&app).map_err(|e| e.to_string())?;
        }
        if app.tray_by_id("main").is_none() {
            return Err("L'icona tray non risulta disponibile.".to_string());
        }
    } else {
        let _ = app.remove_tray_by_id("main");
    }
    Ok(())
}

/// Conferma che l'icona tray esista davvero prima che la X nasconda la main.
/// L'autostart da solo non basta: una creazione fallita non deve lasciare il
/// processo attivo ma irraggiungibile.
#[tauri::command]
#[cfg(not(test))]
fn tray_disponibile(app: tauri::AppHandle) -> bool {
    app.tray_by_id("main").is_some()
}

/// Costruisce l'icona nell'area di notifica con un menu (Apri / Esci) e il
/// click sinistro che riporta la finestra in primo piano (FASE 6A). L'id "main"
/// permette di recuperarla dopo (es. badge conteggio notifiche, FASE 6D).
#[cfg(not(test))]
fn costruisci_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let apri = MenuItem::with_id(app, "apri", "Apri PharmaTek", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let esci = MenuItem::with_id(app, "esci", "Esci", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&apri, &sep, &esci])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("Gestionale PharmaTek")
        .menu(&menu)
        // Il menu si apre col tasto destro; il sinistro porta in primo piano.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "apri" => mostra_finestra_principale(app),
            "esci" => {
                // Distruggi TUTTE le finestre (overlay runtime compreso) bypassando il
                // «riduci nella tray» della principale, poi esci davvero dal processo.
                for (_, w) in app.webview_windows() {
                    let _ = w.destroy();
                }
                std::process::exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                mostra_finestra_principale(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(test)]
mod test_avvio_dopo_aggiornamento {
    use super::{
        annulla_intenzione_riavvio_coordinata, annulla_intenzione_riavvio_path,
        avvio_minimizzato_effettivo, prenota_intenzione_riavvio_path,
        promuovi_intenzione_riavvio_path, IntenzioneRiavvio,
    };

    #[test]
    fn riavvio_manuale_visibile_prevale_sull_argomento_minimized_ereditato() {
        assert!(!avvio_minimizzato_effettivo(
            true,
            Some(IntenzioneRiavvio::Visibile)
        ));
    }

    #[test]
    fn riavvio_background_resta_minimizzato_anche_senza_argomento() {
        assert!(avvio_minimizzato_effettivo(
            false,
            Some(IntenzioneRiavvio::Minimizzato)
        ));
    }

    #[test]
    fn avvio_normale_senza_intenzione_rispetta_l_argomento() {
        assert!(avvio_minimizzato_effettivo(true, None));
        assert!(!avvio_minimizzato_effettivo(false, None));
    }

    #[test]
    fn annullamento_intenzione_e_idempotente() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("relaunch-minimized.flag");
        std::fs::write(&path, "visible").unwrap();

        annulla_intenzione_riavvio_path(&path).unwrap();
        assert!(!path.exists());
        annulla_intenzione_riavvio_path(&path).unwrap();
    }

    #[test]
    fn una_sola_installazione_puo_preparare_il_riavvio() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("relaunch-minimized.flag");
        let stato = std::sync::Mutex::new(None);

        prenota_intenzione_riavvio_path(&stato, &path, IntenzioneRiavvio::Minimizzato).unwrap();
        let errore = prenota_intenzione_riavvio_path(&stato, &path, IntenzioneRiavvio::Visibile)
            .unwrap_err();

        assert!(errore.contains("gia' in corso"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "minimized");
    }

    #[test]
    fn attivita_utente_promuove_il_riavvio_background_a_visibile() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("relaunch-minimized.flag");
        let stato = std::sync::Mutex::new(None);
        prenota_intenzione_riavvio_path(&stato, &path, IntenzioneRiavvio::Minimizzato).unwrap();

        promuovi_intenzione_riavvio_path(&stato, &path).unwrap();

        assert_eq!(*stato.lock().unwrap(), Some(IntenzioneRiavvio::Visibile));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "visible");
    }

    #[test]
    fn fallimento_rilascia_coordinamento_e_marker() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("relaunch-minimized.flag");
        let stato = std::sync::Mutex::new(None);
        prenota_intenzione_riavvio_path(&stato, &path, IntenzioneRiavvio::Visibile).unwrap();

        annulla_intenzione_riavvio_coordinata(&stato, &path).unwrap();
        prenota_intenzione_riavvio_path(&stato, &path, IntenzioneRiavvio::Minimizzato).unwrap();

        assert_eq!(*stato.lock().unwrap(), Some(IntenzioneRiavvio::Minimizzato));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "minimized");
    }
}
