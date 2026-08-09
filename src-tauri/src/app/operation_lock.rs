//! Lease cooperativa per le operazioni straordinarie nella cartella OneDrive.
//!
//! Non è un mutex distribuito forte: ogni dispositivo scrive soltanto il proprio
//! file. Riduce le sovrapposizioni operative, pulisce gli artefatti scaduti e non
//! interpreta un orologio remoto nel futuro come un lock già scaduto.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::json;
use ulid::Ulid;

use super::{es, hostname, now_ms, AppResult, AppState, OperationLockDto};

const LOCK_TTL_MS: u64 = 15 * 60 * 1000;

fn modified_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

/// Se il clock autore è nel futuro usiamo l'età osservabile del file. In questo
/// modo uno skew positivo non fa scadere immediatamente un lock appena arrivato.
fn lock_age_ms(now: u64, timestamp: u64, file_modified: Option<u64>) -> u64 {
    if timestamp <= now {
        return now - timestamp;
    }
    file_modified
        .map(|modified| now.saturating_sub(modified))
        .unwrap_or(0)
}

fn remove_best_effort(path: &Path) {
    let _ = fs::remove_file(path);
}

fn is_lock_tmp(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(".lock-") && name.ends_with(".tmp"))
}

fn tmp_is_expired(now: u64, modified: Option<u64>) -> bool {
    modified
        .map(|modified| now.saturating_sub(modified) >= LOCK_TTL_MS)
        .unwrap_or(false)
}

fn write_atomic(path: &Path, contents: &str) -> AppResult<()> {
    let parent = path.parent().ok_or("cartella lock non valida")?;
    fs::create_dir_all(parent).map_err(es)?;
    let tmp = parent.join(format!(".lock-{}.tmp", Ulid::generate()));
    fs::write(&tmp, contents).map_err(es)?;
    if path.exists() {
        remove_best_effort(path);
    }
    fs::rename(&tmp, path).map_err(|error| {
        remove_best_effort(&tmp);
        es(error)
    })
}

impl AppState {
    /// Acquisisce una lease advisory per un'operazione su OneDrive.
    pub fn acquisisci_lock(&self, azione: &str) -> AppResult<()> {
        let mut local = self
            .operation_lock_local
            .lock()
            .expect("operation lock locale poisoned");
        if let Some(in_corso) = local.as_deref() {
            return Err(
                format!(
                    "Operazione non disponibile: su questo PC è già in corso un'operazione di {in_corso} sui dati condivisi."
                ),
            );
        }
        let attivita = self.begin_runtime_activity()?;
        let cfg = self.config();
        let data_dir = cfg.data_dir.ok_or("cartella dati non impostata")?;
        let device_id = cfg.device_id;
        let locks_dir = Path::new(&data_dir).join("meta").join("locks");
        fs::create_dir_all(&locks_dir).map_err(es)?;

        if let Some(lock) = self
            .operation_lock_status()?
            .filter(|lock| lock.active && !lock.own)
        {
            return Err(format!(
                "Operazione non disponibile: l'utente {} su {} sta eseguendo un'operazione di {} sui dati condivisi.",
                lock.utente_nome, lock.device_nome, lock.azione
            ));
        }

        let my_lock_path = locks_dir.join(format!("{device_id}.json"));
        let info = json!({
            "deviceId": device_id,
            "deviceNome": hostname(),
            "utenteNome": self.whoami().map(|identity| identity.nome).unwrap_or_else(|| "Nuovo Utente".to_string()),
            "azione": azione,
            "timestamp": now_ms()
        });
        write_atomic(
            &my_lock_path,
            &serde_json::to_string_pretty(&info).map_err(es)?,
        )?;
        *local = Some(azione.to_string());
        attivita.keep_active();
        Ok(())
    }

    /// Restituisce la lease attiva più rilevante e rimuove fisicamente quelle scadute.
    pub fn operation_lock_status(&self) -> AppResult<Option<OperationLockDto>> {
        let cfg = self.config();
        let Some(ref data_dir) = cfg.data_dir else {
            return Ok(None);
        };
        let device_ritirati: HashSet<String> = self
            .with_engine(|engine| {
                Ok(engine.with_projection(|projection| {
                    projection
                        .list("device_retired")
                        .unwrap_or_default()
                        .into_iter()
                        .map(|record| record.id)
                        .collect()
                }))
            })
            .unwrap_or_default();
        let locks_dir = Path::new(data_dir).join("meta").join("locks");
        let now = now_ms();
        let mut best: Option<OperationLockDto> = None;

        if let Ok(entries) = fs::read_dir(&locks_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                if is_lock_tmp(&path) {
                    if tmp_is_expired(now, modified_ms(&path)) {
                        remove_best_effort(&path);
                    }
                    continue;
                }
                if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                    continue;
                }
                let Some(value) = fs::read_to_string(&path)
                    .ok()
                    .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
                else {
                    continue;
                };
                let timestamp = value
                    .get("timestamp")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0);
                let age = lock_age_ms(now, timestamp, modified_ms(&path));
                if age >= LOCK_TTL_MS {
                    remove_best_effort(&path);
                    continue;
                }
                let device_id = value
                    .get("deviceId")
                    .and_then(|value| value.as_str())
                    .or_else(|| path.file_stem().and_then(|stem| stem.to_str()))
                    .unwrap_or("")
                    .to_string();
                // OneDrive puo' riconsegnare in ritardo un vecchio file lease.
                // Un device ritirato non deve riapparire nelle UI ne' bloccare
                // operazioni: il marker condiviso e' la fonte autorevole.
                if device_ritirati.contains(&device_id) {
                    remove_best_effort(&path);
                    continue;
                }
                let dto = OperationLockDto {
                    active: true,
                    own: device_id == cfg.device_id,
                    device_id,
                    device_nome: string_field(&value, "deviceNome", "Sconosciuto"),
                    utente_nome: string_field(&value, "utenteNome", "Sconosciuto"),
                    azione: string_field(&value, "azione", "operazione"),
                    timestamp,
                    expires_in_ms: LOCK_TTL_MS.saturating_sub(age),
                };
                let prefer = match best.as_ref() {
                    None => true,
                    Some(current) if current.own && !dto.own => true,
                    Some(current) if current.own == dto.own => dto.timestamp > current.timestamp,
                    _ => false,
                };
                if prefer {
                    best = Some(dto);
                }
            }
        }
        Ok(best)
    }

    /// Rinnova una lease già posseduta da questo processo. È separato
    /// dall'acquisizione così una seconda finestra non può spacciarsi per rinnovo.
    pub fn rinnova_lock(&self, azione: &str) -> AppResult<()> {
        let local = self
            .operation_lock_local
            .lock()
            .expect("operation lock locale poisoned");
        match local.as_deref() {
            Some(corrente) if corrente == azione => {}
            Some(corrente) => {
                return Err(format!(
                    "impossibile rinnovare {azione}: il lock locale appartiene a {corrente}"
                ));
            }
            None => return Err("nessun lock locale da rinnovare".into()),
        }
        let cfg = self.config();
        let data_dir = cfg.data_dir.ok_or("cartella dati non impostata")?;
        let locks_dir = Path::new(&data_dir).join("meta").join("locks");
        let path = locks_dir.join(format!("{}.json", cfg.device_id));
        let info = json!({
            "deviceId": cfg.device_id,
            "deviceNome": hostname(),
            "utenteNome": self.whoami().map(|identity| identity.nome).unwrap_or_else(|| "Nuovo Utente".to_string()),
            "azione": azione,
            "timestamp": now_ms()
        });
        write_atomic(&path, &serde_json::to_string_pretty(&info).map_err(es)?)
    }

    /// Passa una stessa operazione coordinata alla fase successiva senza aprire
    /// una seconda lease. Usato dal ripristino: preparazione → applicazione.
    pub(crate) fn avanza_lock(&self, fase_attesa: &str, nuova_fase: &str) -> AppResult<()> {
        let mut local = self
            .operation_lock_local
            .lock()
            .expect("operation lock locale poisoned");
        match local.as_deref() {
            Some(corrente) if corrente == fase_attesa => {}
            Some(corrente) => {
                return Err(format!(
                    "impossibile avviare {nuova_fase}: il lock locale appartiene a {corrente}"
                ));
            }
            None => return Err("la preparazione del ripristino non è più attiva".into()),
        }

        let cfg = self.config();
        let data_dir = cfg.data_dir.ok_or("cartella dati non impostata")?;
        let path = Path::new(&data_dir)
            .join("meta")
            .join("locks")
            .join(format!("{}.json", cfg.device_id));
        let info = json!({
            "deviceId": cfg.device_id,
            "deviceNome": hostname(),
            "utenteNome": self.whoami().map(|identity| identity.nome).unwrap_or_else(|| "Nuovo Utente".to_string()),
            "azione": nuova_fase,
            "timestamp": now_ms()
        });
        write_atomic(&path, &serde_json::to_string_pretty(&info).map_err(es)?)?;
        *local = Some(nuova_fase.to_string());
        Ok(())
    }

    /// Rilascia la lease di questo dispositivo.
    pub fn rilascia_lock(&self) -> AppResult<()> {
        let cfg = self.config();
        self.rilascia_lock_acquisito_impl(
            cfg.data_dir.as_deref().map(Path::new),
            &cfg.device_id,
            None,
        )
    }

    /// Rilascia solo se la lease locale appartiene ancora all'operazione attesa.
    /// Impedisce a un cleanup tardivo di una finestra di liberare il lavoro che nel
    /// frattempo è stato avviato da un'altra finestra dello stesso processo.
    pub fn rilascia_lock_se(&self, azione_attesa: &str) -> AppResult<()> {
        let cfg = self.config();
        self.rilascia_lock_acquisito_impl(
            cfg.data_dir.as_deref().map(Path::new),
            &cfg.device_id,
            Some(azione_attesa),
        )
    }

    /// Rilascia la lease usando l'identità con cui era stata acquisita. Serve alle
    /// operazioni che possono cambiare o cancellare la configurazione locale prima
    /// del cleanup finale (per esempio il ritiro del PC corrente).
    pub(crate) fn rilascia_lock_acquisito(
        &self,
        data_dir: Option<&Path>,
        device_id: &str,
    ) -> AppResult<()> {
        self.rilascia_lock_acquisito_impl(data_dir, device_id, None)
    }

    fn rilascia_lock_acquisito_impl(
        &self,
        data_dir: Option<&Path>,
        device_id: &str,
        azione_attesa: Option<&str>,
    ) -> AppResult<()> {
        let mut local = self
            .operation_lock_local
            .lock()
            .expect("operation lock locale poisoned");
        if let (Some(attesa), Some(corrente)) = (azione_attesa, local.as_deref()) {
            if corrente != attesa {
                return Err(format!(
                    "impossibile rilasciare {attesa}: il lock locale appartiene a {corrente}"
                ));
            }
        }
        let aveva_lock_locale = local.take().is_some();
        drop(local);
        if aveva_lock_locale {
            self.finish_runtime_activity();
        }
        if let Some(dir) = data_dir {
            let path = PathBuf::from(dir)
                .join("meta")
                .join("locks")
                .join(format!("{device_id}.json"));
            remove_best_effort(&path);
        }
        Ok(())
    }
}

fn string_field(value: &serde_json::Value, key: &str, fallback: &str) -> String {
    value
        .get(key)
        .and_then(|field| field.as_str())
        .unwrap_or(fallback)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_passato_scade_normalmente() {
        assert_eq!(lock_age_ms(1_000, 700, None), 300);
    }

    #[test]
    fn timestamp_futuro_usa_eta_locale_del_file() {
        assert_eq!(lock_age_ms(1_000, 5_000, Some(800)), 200);
        assert_eq!(lock_age_ms(1_000, 5_000, Some(1_200)), 0);
    }

    #[test]
    fn riconosce_solo_i_temporanei_atomici_dei_lock() {
        assert!(is_lock_tmp(Path::new(".lock-01HXYZ.tmp")));
        assert!(!is_lock_tmp(Path::new("device.tmp")));
        assert!(!is_lock_tmp(Path::new(".lock-01HXYZ.json")));
    }

    #[test]
    fn temporaneo_scade_solo_dopo_la_ttl() {
        assert!(!tmp_is_expired(LOCK_TTL_MS - 1, Some(0)));
        assert!(tmp_is_expired(LOCK_TTL_MS, Some(0)));
        assert!(!tmp_is_expired(1_000, Some(2_000)));
        assert!(!tmp_is_expired(LOCK_TTL_MS, None));
    }
}
