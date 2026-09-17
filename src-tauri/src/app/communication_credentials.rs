//! Credenziale SMTP locale della FASE 11.
//!
//! Il target è stabile e intenzionalmente fuori dal dataset sincronizzato. Su
//! Windows il segreto viene affidato a Credential Manager come credenziale
//! generica persistente per l'utente corrente della macchina.

use super::AppResult;

const SMTP_CREDENTIAL_TARGET: &str = "PharmaTek/Comunicazioni/SMTP";
const MAX_CREDENTIAL_BLOB_BYTES: usize = 2_560;

pub(super) struct LocalSmtpCredential {
    pub username: String,
    pub password: String,
}

pub(super) fn leggi_password_smtp() -> AppResult<Option<LocalSmtpCredential>> {
    platform::read(SMTP_CREDENTIAL_TARGET)
}

pub(super) fn salva_password_smtp(username: &str, password: &str) -> AppResult<()> {
    if username.trim().is_empty() {
        return Err("nome utente della casella mancante".into());
    }
    if password.is_empty() {
        return Err("password della casella mancante".into());
    }
    if password.len() > MAX_CREDENTIAL_BLOB_BYTES {
        return Err("password della casella troppo lunga".into());
    }
    platform::write(SMTP_CREDENTIAL_TARGET, username, password)
}

pub(super) fn elimina_password_smtp() -> AppResult<bool> {
    platform::delete(SMTP_CREDENTIAL_TARGET)
}

#[cfg(target_os = "windows")]
mod platform {
    use std::ptr;

    use windows::core::{HRESULT, PCWSTR, PWSTR};
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    use super::{AppResult, LocalSmtpCredential};

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn non_trovata(error: &windows::core::Error) -> bool {
        error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0)
    }

    struct CredentialBuffer(*mut CREDENTIALW);

    impl Drop for CredentialBuffer {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: il puntatore è restituito da CredReadW e viene liberato
                // una sola volta tramite l'API abbinata.
                unsafe { CredFree(self.0.cast()) };
            }
        }
    }

    pub(super) fn read(target: &str) -> AppResult<Option<LocalSmtpCredential>> {
        let target = wide(target);
        let mut raw = ptr::null_mut();
        // SAFETY: target è una stringa UTF-16 terminata da NUL e `raw` è un
        // out-pointer valido. Il buffer risultante è posseduto dal guard sotto.
        match unsafe { CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut raw) } {
            Ok(()) => {}
            Err(error) if non_trovata(&error) => return Ok(None),
            Err(error) => {
                return Err(format!(
                    "impossibile leggere la password protetta di Windows: {error}"
                ))
            }
        }
        if raw.is_null() {
            return Err("Windows non ha restituito la credenziale richiesta".into());
        }
        let _guard = CredentialBuffer(raw);
        // SAFETY: raw rimane valido per la vita del guard e punta a CREDENTIALW.
        let credential = unsafe { &*raw };
        let bytes = if credential.CredentialBlobSize == 0 {
            &[][..]
        } else {
            if credential.CredentialBlob.is_null() {
                return Err("la password protetta di Windows è danneggiata".into());
            }
            // SAFETY: dimensione e puntatore provengono da CredReadW.
            unsafe {
                std::slice::from_raw_parts(
                    credential.CredentialBlob,
                    credential.CredentialBlobSize as usize,
                )
            }
        };
        let password = String::from_utf8(bytes.to_vec())
            .map_err(|_| "la password protetta di Windows non è leggibile".to_string())?;
        if credential.UserName.is_null() {
            return Err("il nome utente protetto di Windows è mancante".into());
        }
        // SAFETY: UserName appartiene al buffer restituito da CredReadW ed è
        // documentato come stringa UTF-16 terminata da NUL.
        let username = unsafe { credential.UserName.to_string() }
            .map_err(|_| "il nome utente protetto di Windows non è leggibile".to_string())?;
        Ok(Some(LocalSmtpCredential { username, password }))
    }

    pub(super) fn write(target: &str, username: &str, password: &str) -> AppResult<()> {
        let mut target = wide(target);
        let mut username = wide(username);
        let mut blob = password.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_mut_ptr()),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(username.as_mut_ptr()),
            ..Default::default()
        };
        // SAFETY: tutti i puntatori della struttura restano validi per la durata
        // sincrona della chiamata. CredWriteW copia i dati nel Credential Manager.
        let result = unsafe { CredWriteW(&credential, 0) };
        blob.fill(0);
        result.map_err(|error| {
            format!("impossibile salvare la password protetta di Windows: {error}")
        })
    }

    pub(super) fn delete(target: &str) -> AppResult<bool> {
        let target = wide(target);
        // SAFETY: target è una stringa UTF-16 terminata da NUL.
        match unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(true),
            Err(error) if non_trovata(&error) => Ok(false),
            Err(error) => Err(format!(
                "impossibile rimuovere la password protetta di Windows: {error}"
            )),
        }
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::platform;
    use ulid::Ulid;

    struct Cleanup(String);

    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = platform::delete(&self.0);
        }
    }

    #[test]
    fn credential_manager_scrive_legge_e_rimuove_un_segreto_temporaneo() {
        let target = format!("PharmaTek/Test/{}", Ulid::generate());
        let _cleanup = Cleanup(target.clone());
        assert!(platform::read(&target).unwrap().is_none());

        platform::write(&target, "demo@example.invalid", "segreto-di-test")
            .expect("scrittura credenziale temporanea");
        let letta = platform::read(&target).unwrap().unwrap();
        assert_eq!(letta.username, "demo@example.invalid");
        assert_eq!(letta.password, "segreto-di-test");

        assert!(platform::delete(&target).unwrap());
        assert!(platform::read(&target).unwrap().is_none());
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::{AppResult, LocalSmtpCredential};

    pub(super) fn read(_target: &str) -> AppResult<Option<LocalSmtpCredential>> {
        Ok(None)
    }

    pub(super) fn write(_target: &str, _username: &str, _password: &str) -> AppResult<()> {
        Err("il portachiavi SMTP è disponibile soltanto nell'app Windows".into())
    }

    pub(super) fn delete(_target: &str) -> AppResult<bool> {
        Ok(false)
    }
}
