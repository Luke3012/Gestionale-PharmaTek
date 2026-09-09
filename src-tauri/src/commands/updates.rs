use super::*;
use crate::premium;
use serde::Deserialize;

const UPDATER_MANIFEST_URL: &str =
    "https://api.github.com/repos/Luke3012/Gestionale-PharmaTek/contents/.updater/latest.json";
const REMOTE_CONTROL_URL: &str =
    "https://api.github.com/repos/Luke3012/Gestionale-PharmaTek/contents/.updater/control.json";
const REMOTE_CONTROL_SIG_URL: &str =
    "https://api.github.com/repos/Luke3012/Gestionale-PharmaTek/contents/.updater/control.json.sig";
const UPDATER_PLATFORM_WINDOWS: &str = "windows-x86_64";
const CONTROL_CACHE_JSON: &str = "remote-control.json";
const CONTROL_CACHE_SIG: &str = "remote-control.json.sig";
const CONTROL_APP_ID: &str = "pharmatek";
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteControlManifest {
    schema: u32,
    app: String,
    #[serde(default)]
    disabled: bool,
    #[serde(default)]
    message: String,
    #[serde(default)]
    updated_at: String,
}
#[tauri::command]
pub async fn installa_ultima_versione(token: String) -> Result<InstallLatestDto, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token updater mancante: impossibile installare da repo privata.".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("PharmaTek-Updater-Test")
        .build()
        .map_err(|e| e.to_string())?;

    let manifest: UpdaterManifest = client
        .get(UPDATER_MANIFEST_URL)
        .header(reqwest::header::AUTHORIZATION, format!("token {token}"))
        .header(reqwest::header::ACCEPT, "application/vnd.github.raw")
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
        .header(reqwest::header::AUTHORIZATION, format!("token {token}"))
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .send()
        .await
        .map_err(|e| format!("Download installer non riuscito: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Download installer non autorizzato o non disponibile: {e}"))?
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

    Ok(InstallLatestDto {
        version: manifest.version,
    })
}

#[tauri::command]
pub async fn remote_control_status(
    token: String,
    state: State<'_, AppState>,
) -> Result<RemoteControlStatusDto, String> {
    let token = token.trim().to_string();
    let cache_json = state.app_dir.join(CONTROL_CACHE_JSON);
    let cache_sig = state.app_dir.join(CONTROL_CACHE_SIG);
    let premium_local_enabled = premium::is_enabled(&state.app_dir);

    if !token.is_empty() {
        match scarica_controllo_remoto(&token).await {
            Ok((json, sig)) => match verifica_manifest_controllo(&json, &sig) {
                Ok(manifest) => {
                    salva_cache_controllo(&cache_json, &cache_sig, &json, &sig);
                    return Ok(status_da_manifest(manifest, premium_local_enabled, false));
                }
                Err(err) => {
                    eprintln!("Controllo remoto ignorato: firma/manifest non valido ({err})");
                }
            },
            Err(err) => {
                eprintln!("Controllo remoto non raggiungibile: {err}");
            }
        }
    }

    Ok(status_da_cache_o_default(
        &cache_json,
        &cache_sig,
        premium_local_enabled,
    ))
}

async fn scarica_controllo_remoto(token: &str) -> Result<(Vec<u8>, String), String> {
    let client = reqwest::Client::builder()
        .user_agent("PharmaTek-Remote-Control")
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let json = client
        .get(REMOTE_CONTROL_URL)
        .header(reqwest::header::AUTHORIZATION, format!("token {token}"))
        .header(reqwest::header::ACCEPT, "application/vnd.github.raw")
        .send()
        .await
        .map_err(|e| format!("manifest controllo non raggiungibile: {e}"))?
        .error_for_status()
        .map_err(|e| format!("manifest controllo non valido: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("manifest controllo non leggibile: {e}"))?
        .to_vec();

    let sig = client
        .get(REMOTE_CONTROL_SIG_URL)
        .header(reqwest::header::AUTHORIZATION, format!("token {token}"))
        .header(reqwest::header::ACCEPT, "application/vnd.github.raw")
        .send()
        .await
        .map_err(|e| format!("firma controllo non raggiungibile: {e}"))?
        .error_for_status()
        .map_err(|e| format!("firma controllo non valida: {e}"))?
        .text()
        .await
        .map_err(|e| format!("firma controllo non leggibile: {e}"))?;

    Ok((json, sig))
}

fn verifica_manifest_controllo(json: &[u8], sig: &str) -> Result<RemoteControlManifest, String> {
    crate::update_signature::verify_signed_payload(json, sig, "controllo")?;

    let manifest: RemoteControlManifest = serde_json::from_slice(json)
        .map_err(|e| format!("manifest controllo non leggibile: {e}"))?;
    if manifest.schema != 1 {
        return Err(format!(
            "schema controllo non supportato: {}",
            manifest.schema
        ));
    }
    if manifest.app != CONTROL_APP_ID {
        return Err(format!(
            "manifest controllo per app diversa: {}",
            manifest.app
        ));
    }
    Ok(manifest)
}

fn salva_cache_controllo(json_path: &Path, sig_path: &Path, json: &[u8], sig: &str) {
    if let Some(parent) = json_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(json_path, json);
    let _ = std::fs::write(sig_path, sig.as_bytes());
}

fn status_da_cache_o_default(
    json_path: &Path,
    sig_path: &Path,
    premium_local_enabled: bool,
) -> RemoteControlStatusDto {
    let cached = std::fs::read(json_path)
        .ok()
        .zip(std::fs::read_to_string(sig_path).ok())
        .and_then(|(json, sig)| verifica_manifest_controllo(&json, &sig).ok());

    match cached {
        Some(manifest) => status_da_manifest(manifest, premium_local_enabled, true),
        None => RemoteControlStatusDto {
            disabled: false,
            message: String::new(),
            updated_at: String::new(),
            from_cache: true,
            premium_enabled: premium_local_enabled,
        },
    }
}

fn status_da_manifest(
    manifest: RemoteControlManifest,
    premium_local_enabled: bool,
    from_cache: bool,
) -> RemoteControlStatusDto {
    RemoteControlStatusDto {
        disabled: manifest.disabled,
        message: manifest.message.trim().to_string(),
        updated_at: manifest.updated_at,
        from_cache,
        premium_enabled: premium_local_enabled,
    }
}

fn percorso_temp_installer(version: &str) -> PathBuf {
    cartella_temp_update().join(format!(
        "PharmaTek_{}_{}_x64-setup.exe",
        version,
        std::process::id()
    ))
}

fn cartella_temp_update() -> PathBuf {
    let dir = std::env::temp_dir().join("pharmatek-updater");
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
            if !installer.exists() {
                break;
            }
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn avvia_installer_update(_installer: &PathBuf) -> Result<(), String> {
    Err("Installazione forzata supportata solo su Windows.".into())
}
