use std::path::Path;

#[cfg(target_os = "windows")]
use std::ffi::{c_void, OsStr};
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;

#[cfg(target_os = "windows")]
const SW_SHOWNORMAL: i32 = 1;

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
fn wide_null(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn shell_open(value: &OsStr) -> Result<(), String> {
    let operation = wide_null(OsStr::new("open"));
    let file = wide_null(value);

    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };

    let code = result as isize;
    if code <= 32 {
        return Err(format!("Apertura non riuscita (ShellExecuteW={code})."));
    }
    Ok(())
}

pub fn url_esterno_consentito(url: &str) -> bool {
    if url.starts_with("http://") || url.starts_with("https://") {
        return true;
    }
    if let Some(destinatario) = url.strip_prefix("mailto:") {
        return !destinatario.is_empty()
            && !destinatario.chars().any(char::is_control)
            && !destinatario.contains('?')
            && !destinatario.contains('#');
    }
    if let Some(numero) = url.strip_prefix("whatsapp://send?phone=") {
        return (8..=15).contains(&numero.len()) && numero.chars().all(|c| c.is_ascii_digit());
    }
    false
}

#[cfg(target_os = "windows")]
pub fn apri_cartella_sistema(dir: &Path) -> Result<(), String> {
    shell_open(dir.as_os_str())
}

#[cfg(target_os = "windows")]
pub fn apri_file_sistema(path: &Path) -> Result<(), String> {
    shell_open(path.as_os_str())
}

#[cfg(not(target_os = "windows"))]
pub fn apri_cartella_sistema(dir: &Path) -> Result<(), String> {
    let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn apri_file_sistema(path: &Path) -> Result<(), String> {
    let _ = std::process::Command::new("xdg-open").arg(path).spawn();
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn apri_url_sistema(url: &str) -> Result<(), String> {
    shell_open(OsStr::new(url))
}

#[cfg(not(target_os = "windows"))]
pub fn apri_url_sistema(url: &str) -> Result<(), String> {
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::url_esterno_consentito;

    #[test]
    fn consente_solo_deep_link_esterni_previsti() {
        assert!(url_esterno_consentito("whatsapp://send?phone=393281883355"));
        assert!(url_esterno_consentito("mailto:demo%40example.invalid"));
        assert!(url_esterno_consentito("https://example.com"));

        assert!(!url_esterno_consentito("javascript:alert(1)"));
        assert!(!url_esterno_consentito("whatsapp://send?phone=39ABC"));
        assert!(!url_esterno_consentito(
            "mailto:demo%40example.invalid?bcc=altro%40example.it"
        ));
    }
}
