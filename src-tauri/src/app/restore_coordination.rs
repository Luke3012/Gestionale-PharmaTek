use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::json;

use super::{es, hostname, now_ms, AppResult, RestoreAckDto};
use crate::restore_support::{checksum_file, checksum_file_with_len};
use crate::sync::snapshot::SnapshotStore;

fn restore_coordination_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("meta").join("restore_coordination")
}

fn restore_prepare_path(data_dir: &Path, restore_id: &str) -> PathBuf {
    restore_coordination_dir(data_dir).join(format!("prepare-{restore_id}.json"))
}

fn restore_ack_dir(data_dir: &Path, restore_id: &str) -> PathBuf {
    restore_coordination_dir(data_dir)
        .join("acks")
        .join(restore_id)
}

fn restore_committed_path(data_dir: &Path, restore_id: &str) -> PathBuf {
    restore_coordination_dir(data_dir).join(format!("committed-{restore_id}.json"))
}

fn restore_cancelled_path(data_dir: &Path, restore_id: &str) -> PathBuf {
    restore_coordination_dir(data_dir).join(format!("cancelled-{restore_id}.json"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreManifest {
    protocol_version: u8,
    kind: &'static str,
    restore_id: String,
    device_id: String,
    created_at: u64,
    files: Vec<RestoreManifestFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreManifestFile {
    path: String,
    bytes: u64,
    checksum: String,
    validation: &'static str,
}

/// Crea una fotografia immutabile della generazione ripristinata. I normali
/// snapshot del dispositivo hanno retention 1 e possono essere sostituiti prima
/// che un PC offline torni in linea; il prefisso dedicato non viene potato dai
/// successivi snapshot operativi e rende il commit ricostruibile nel tempo.
pub(super) fn scrivi_restore_anchor(
    data_dir: &Path,
    snapshot: &crate::projection::SnapshotData,
) -> AppResult<PathBuf> {
    let owner = format!("restore-anchor-{}", ulid::Ulid::generate());
    let store = SnapshotStore::new(data_dir.join("snapshots"), owner).map_err(es)?;
    store.save(snapshot, 1).map_err(es)
}

pub(super) fn scrivi_restore_manifest(
    data_dir: &Path,
    restore_id: &str,
    device_id: &str,
    anchor_path: &Path,
) -> AppResult<()> {
    // Fissa la frontiera prima di enumerare i log: un eventuale nuovo log nato
    // durante la scrittura del commit è per definizione successivo al restore.
    let created_at = now_ms();
    let mut files = Vec::new();

    // I log sono append-only: il manifest certifica il prefisso presente al
    // commit, lasciando che operazioni successive aggiungano una coda legittima.
    let events = data_dir.join("events");
    if let Ok(entries) = fs::read_dir(&events) {
        for entry in entries {
            let path = entry.map_err(es)?.path();
            if !path.is_file()
                || !path
                    .extension()
                    .map(|ext| ext.eq_ignore_ascii_case("ndjson"))
                    .unwrap_or(false)
            {
                continue;
            }
            files.push(file_manifest(data_dir, &path, "prefix")?);
        }
    }

    // L'anchor contiene già la proiezione completa della generazione ripristinata
    // e resta immutabile. Snapshot ordinari e file meta sono artefatti live: non
    // devono rendere il commit irraggiungibile se vengono poi sostituiti.
    files.push(file_manifest(data_dir, anchor_path, "exact")?);
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let manifest = RestoreManifest {
        protocol_version: 2,
        kind: "restore",
        restore_id: restore_id.to_string(),
        device_id: device_id.to_string(),
        created_at,
        files,
    };
    let dir = restore_coordination_dir(data_dir);
    fs::create_dir_all(&dir).map_err(es)?;
    let path = restore_committed_path(data_dir, restore_id);
    let tmp = dir.join(format!("committed-{restore_id}.json.tmp"));
    fs::write(&tmp, serde_json::to_vec_pretty(&manifest).map_err(es)?).map_err(es)?;
    fs::rename(tmp, path).map_err(es)?;
    Ok(())
}

/// Commit di una compattazione generazionale. L'anchor e la barriera condivisa
/// sono sufficienti: i log precedenti possono ricomparire, ma il motore li
/// scarta tramite i cutoff della generazione.
pub(super) fn scrivi_compaction_manifest(
    data_dir: &Path,
    generation_id: &str,
    device_id: &str,
    created_at: u64,
    anchor_path: &Path,
) -> AppResult<()> {
    let files = vec![file_manifest(data_dir, anchor_path, "exact")?];
    let manifest = RestoreManifest {
        protocol_version: 3,
        kind: "compaction",
        restore_id: generation_id.to_string(),
        device_id: device_id.to_string(),
        created_at,
        files,
    };
    let dir = restore_coordination_dir(data_dir);
    fs::create_dir_all(&dir).map_err(es)?;
    let path = restore_committed_path(data_dir, generation_id);
    let tmp = dir.join(format!("committed-{generation_id}.json.tmp"));
    fs::write(&tmp, serde_json::to_vec_pretty(&manifest).map_err(es)?).map_err(es)?;
    fs::rename(tmp, path).map_err(es)?;
    Ok(())
}

fn file_manifest(
    base: &Path,
    path: &Path,
    validation: &'static str,
) -> AppResult<RestoreManifestFile> {
    let rel = path
        .strip_prefix(base)
        .map_err(es)?
        .to_string_lossy()
        .replace('\\', "/");
    let (bytes, checksum) = if validation == "prefix" {
        checksum_file_with_len(path).map_err(es)?
    } else {
        (
            fs::metadata(path).map_err(es)?.len(),
            checksum_file(path).map_err(es)?,
        )
    };
    Ok(RestoreManifestFile {
        path: rel,
        bytes,
        checksum,
        validation,
    })
}

pub(super) fn scrivi_restore_prepare(
    data_dir: &Path,
    restore_id: &str,
    device_id: &str,
    device_nome: &str,
) -> AppResult<()> {
    let dir = restore_coordination_dir(data_dir);
    fs::create_dir_all(&dir).map_err(es)?;
    let payload = json!({
        "restoreId": restore_id,
        "deviceId": device_id,
        "deviceNome": device_nome,
        "createdAt": now_ms(),
    });
    let path = restore_prepare_path(data_dir, restore_id);
    let tmp = dir.join(format!("prepare-{restore_id}.json.tmp"));
    fs::write(&tmp, serde_json::to_vec_pretty(&payload).map_err(es)?).map_err(es)?;
    fs::rename(tmp, path).map_err(es)?;
    Ok(())
}

pub(super) fn scrivi_restore_cancel(
    data_dir: &Path,
    restore_id: &str,
    device_id: &str,
) -> AppResult<()> {
    let dir = restore_coordination_dir(data_dir);
    fs::create_dir_all(&dir).map_err(es)?;
    let payload = json!({
        "restoreId": restore_id,
        "deviceId": device_id,
        "deviceNome": hostname(),
        "cancelledAt": now_ms(),
    });
    let path = restore_cancelled_path(data_dir, restore_id);
    let tmp = dir.join(format!("cancelled-{restore_id}.json.tmp"));
    fs::write(&tmp, serde_json::to_vec_pretty(&payload).map_err(es)?).map_err(es)?;
    fs::rename(tmp, path).map_err(es)?;
    Ok(())
}

pub(super) fn scrivi_restore_ack(
    data_dir: &Path,
    restore_id: &str,
    device_id: &str,
    device_nome: &str,
    user_nome: &str,
) -> AppResult<()> {
    let dir = restore_ack_dir(data_dir, restore_id);
    fs::create_dir_all(&dir).map_err(es)?;
    let payload = json!({
        "restoreId": restore_id,
        "deviceId": device_id,
        "deviceNome": device_nome,
        "userNome": user_nome,
        "ms": now_ms(),
    });
    let path = dir.join(format!("{device_id}.json"));
    let tmp = dir.join(format!("{device_id}.json.tmp"));
    fs::write(&tmp, serde_json::to_vec_pretty(&payload).map_err(es)?).map_err(es)?;
    fs::rename(tmp, path).map_err(es)?;
    Ok(())
}

pub(super) fn leggi_restore_acks(data_dir: &Path, restore_id: &str) -> Vec<RestoreAckDto> {
    let dir = restore_ack_dir(data_dir, restore_id);
    fs::read_dir(dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
                return None;
            }
            let bytes = fs::read(path).ok()?;
            let val = serde_json::from_slice::<serde_json::Value>(&bytes).ok()?;
            Some(RestoreAckDto {
                device_id: val
                    .get("deviceId")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                device_nome: val
                    .get("deviceNome")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Sconosciuto")
                    .to_string(),
                user_nome: val
                    .get("userNome")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                ms: val.get("ms").and_then(|v| v.as_u64()).unwrap_or(0),
            })
        })
        .filter(|ack| !ack.device_id.is_empty())
        .collect()
}

pub(super) fn rimuovi_restore_coordination(data_dir: &Path, restore_id: Option<&str>) {
    let dir = restore_coordination_dir(data_dir);
    let Some(restore_id) = restore_id else {
        if dir.exists() {
            let _ = fs::remove_dir_all(dir);
        }
        return;
    };
    let acks = restore_ack_dir(data_dir, restore_id);
    if acks.exists() {
        let _ = fs::remove_dir_all(acks);
    }
    // Prepare e ack servono soltanto durante l'attesa delle postazioni. Il marker
    // terminale (committed/cancelled) resta invece disponibile per i PC offline
    // e rende innocua anche un'eventuale ricomparsa tardiva del prepare via cloud.
    for path in [
        restore_prepare_path(data_dir, restore_id),
        dir.join(format!("prepare-{restore_id}.json.tmp")),
    ] {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
}

pub(super) fn pulisci_restore_coordination_vecchia(data_dir: &Path, ttl_ms: u64, device_id: &str) {
    let dir = restore_coordination_dir(data_dir);
    let now = now_ms();
    let acks_root = dir.join("acks");
    if let Ok(entries) = fs::read_dir(&acks_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(restore_id) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !restore_prepare_path(data_dir, restore_id).exists()
                || restore_cancelled_path(data_dir, restore_id).exists()
                || restore_committed_path(data_dir, restore_id).exists()
            {
                let _ = fs::remove_dir_all(path);
                continue;
            }
            if let Ok(files) = fs::read_dir(&path) {
                for file in files.flatten() {
                    let tmp = file.path();
                    let is_tmp = tmp
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.ends_with(".tmp"))
                        .unwrap_or(false);
                    if !is_tmp {
                        continue;
                    }
                    let vecchio = fs::metadata(&tmp)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| now.saturating_sub(d.as_millis() as u64) > 10 * 60 * 1000)
                        .unwrap_or(false);
                    if vecchio {
                        let _ = fs::remove_file(tmp);
                    }
                }
            }
        }
    }
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let is_tmp = name.ends_with(".tmp");
        let is_committed = name.starts_with("committed-") && name.ends_with(".json");
        if is_committed {
            continue;
        }
        let vecchio = fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                let eta = now.saturating_sub(d.as_millis() as u64);
                if is_tmp {
                    eta > 10 * 60 * 1000
                } else {
                    eta > ttl_ms
                }
            })
            .unwrap_or(false);
        if vecchio {
            if let Some(restore_id) = name
                .strip_prefix("prepare-")
                .and_then(|name| name.strip_suffix(".json"))
            {
                // Una postazione può avere già visto il prepare ed essersi messa
                // in pausa. Prima di rimuoverlo pubblichiamo quindi un terminale:
                // alla prossima scansione potrà riprendere senza attendere un
                // riavvio, anche dopo un arresto del coordinatore.
                if !restore_cancelled_path(data_dir, restore_id).exists()
                    && !restore_committed_path(data_dir, restore_id).exists()
                {
                    let _ = scrivi_restore_cancel(data_dir, restore_id, device_id);
                }
                rimuovi_restore_coordination(data_dir, Some(restore_id));
                continue;
            }
            if path.is_dir() {
                let _ = fs::remove_dir_all(path);
            } else {
                let _ = fs::remove_file(path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn preparazione_scaduta_pubblica_annullamento_e_rimuove_transitori() {
        let data = tempfile::tempdir().unwrap();
        let restore_id = "RESTORE-INTERROTTO";
        scrivi_restore_prepare(data.path(), restore_id, "PC-A", "Postazione A").unwrap();
        scrivi_restore_ack(data.path(), restore_id, "PC-B", "Postazione B", "Luca").unwrap();
        thread::sleep(Duration::from_millis(5));

        pulisci_restore_coordination_vecchia(data.path(), 0, "PC-PULIZIA");

        let coord = restore_coordination_dir(data.path());
        assert!(!restore_prepare_path(data.path(), restore_id).exists());
        assert!(!restore_ack_dir(data.path(), restore_id).exists());
        assert!(
            restore_cancelled_path(data.path(), restore_id).exists(),
            "il terminale di annullamento deve sbloccare i PC già in pausa"
        );
        assert!(
            !restore_committed_path(data.path(), restore_id).exists(),
            "un'operazione interrotta non deve sembrare completata"
        );
        assert!(coord.exists());
    }

    #[test]
    fn pulizia_transitoria_conserva_il_manifest_finale() {
        let data = tempfile::tempdir().unwrap();
        let restore_id = "RESTORE-COMPLETATO";
        scrivi_restore_prepare(data.path(), restore_id, "PC-A", "Postazione A").unwrap();
        scrivi_restore_ack(data.path(), restore_id, "PC-B", "Postazione B", "Luca").unwrap();
        let committed = restore_committed_path(data.path(), restore_id);
        fs::write(&committed, b"manifest").unwrap();

        rimuovi_restore_coordination(data.path(), Some(restore_id));

        assert!(!restore_prepare_path(data.path(), restore_id).exists());
        assert!(!restore_ack_dir(data.path(), restore_id).exists());
        assert!(
            committed.exists(),
            "i PC offline devono poter trovare il manifest finale"
        );
    }
}
