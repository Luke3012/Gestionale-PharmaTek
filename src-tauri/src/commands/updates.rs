use super::*;
use serde::Deserialize;

const UPDATER_MANIFEST_URL: &str =
    "https://github.com/Luke3012/Gestionale-PharmaTek/releases/latest/download/latest.json";
const UPDATER_PLATFORM_WINDOWS: &str = "windows-x86_64";

#[derive(Debug, Deserialize)]
struct UpdaterManifest {
    version: String,
    platforms: std::collections::HashMap<String, UpdaterPlatform>,
}

#[derive(Debug, Deserialize)]
struct UpdaterPlatform {
    url: String,
    signature: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLatestDto {
    pub version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteControlStatusDto {
    pub disabled: bool,
    pub message: String,
    pub updated_at: String,
    pub from_cache: bool,
    pub premium_enabled: bool,
}

/// Scarica l'ultima release pubblica senza credenziali. Il parametro resta nella
/// firma IPC per compatibilita con il frontend, ma viene intenzionalmente ignorato.
#[tauri::command]
pub async fn installa_ultima_versione(_token: String) -> Result<InstallLatestDto, String> {
    let client = reqwest::Client::builder()
        .user_agent("PharmaTek-Demo-Updater")
        .build()
        .map_err(|e| e.to_string())?;

    let manifest: UpdaterManifest = client
        .get(UPDATER_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| format!("Manifest aggiornamento non raggiungibile: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Manifest aggiornamento non valido: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Manifest aggiornamento non leggibile: {e}"))?;

    let platform = manifest
        .platforms
        .get(UPDATER_PLATFORM_WINDOWS)
        .ok_or_else(|| "Manifest aggiornamento senza installer Windows.".to_string())?;

    let bytes = client
        .get(&platform.url)
        .send()
        .await
        .map_err(|e| format!("Download installer non riuscito: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Download installer non disponibile: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Download installer interrotto: {e}"))?;

    crate::update_signature::verify_signed_payload(
        &bytes,
        &platform.signature,
        "installer aggiornamento",
    )?;

    let path = percorso_temp_installer(&manifest.version);
    std::fs::write(&path, &bytes).map_err(|e| format!("Scrittura installer fallita: {e}"))?;
    avvia_installer_update(&path)?;
    Ok(InstallLatestDto { version: manifest.version })
}

/// La demo pubblica non implementa disattivazione remota e rende disponibili
/// localmente tutte le funzioni dimostrative.
#[tauri::command]
pub async fn remote_control_status(
    _token: String,
    _state: State<'_, AppState>,
) -> Result<RemoteControlStatusDto, String> {
    Ok(RemoteControlStatusDto {
        disabled: false,
        message: String::new(),
        updated_at: String::new(),
        from_cache: false,
        premium_enabled: true,
    })
}

fn percorso_temp_installer(version: &str) -> PathBuf {
    cartella_temp_update().join(format!(
        "PharmaTek_Demo_{}_{}_x64-setup.exe",
        version,
        std::process::id()
    ))
}

fn cartella_temp_update() -> PathBuf {
    let dir = std::env::temp_dir().join("pharmatek-demo-updater");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[cfg(target_os = "windows")]
fn avvia_installer_update(installer: &Path) -> Result<(), String> {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;

    const SW_SHOW: i32 = 5;

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> *mut c_void;
    }

    fn wide_null(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }

    let operation = wide_null(OsStr::new("open"));
    let file = wide_null(installer.as_os_str());
    let parameters = wide_null(OsStr::new("/S /R /UPDATE /ARGS"));
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            parameters.as_ptr(),
            std::ptr::null(),
            SW_SHOW,
        )
    };
    let code = result as isize;
    if code <= 32 {
        return Err(format!("Avvio installer fallito (ShellExecuteW={code})."));
    }
    programma_cleanup_installer(installer);
    Ok(())
}

#[cfg(target_os = "windows")]
fn programma_cleanup_installer(installer: &Path) {
    let installer = installer.to_path_buf();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        for _ in 0..120 {
            let _ = std::fs::remove_file(&installer);
            if !installer.exists() { break; }
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn avvia_installer_update(_installer: &PathBuf) -> Result<(), String> {
    Err("Installazione forzata supportata solo su Windows.".into())
}
