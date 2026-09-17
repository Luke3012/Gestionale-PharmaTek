//! Backup e ripristino dei dati condivisi (`events/`, `snapshots/`, `meta/`).
//!
//! Il backup è un semplice **zip** (testo compresso) scritto in una posizione
//! **fuori dalla cartella OneDrive** (di default `%APPDATA%/…/backups/`), con
//! retention degli ultimi N. Il ripristino sostituisce le cartelle dati e la
//! proiezione viene poi ricostruita riaprendo il motore.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use ulid::Ulid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::app::civil_from_unix;
use crate::projection::SnapshotData;
use crate::restore_support::is_restore_runtime_artifact;
use crate::sync::hlc::Hlc;

/// Informazioni su un file di backup.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub nome: String,
    pub path: String,
    pub size: u64,
    /// Data del backup (ms epoch, da mtime).
    pub ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfoDto {
    pub path_in_zip: String,
    pub device_id: String,
    pub device_nome: String,
    pub seq: u64,
    pub modified_ms: u64,
    pub bytes: u64,
    pub records: usize,
    pub purged: usize,
    pub watermarks: usize,
    pub recommended: bool,
    pub safe: bool,
}

const SOTTOCARTELLE_ZIP: [&str; 3] = ["events", "snapshots", "meta"];
const SOTTOCARTELLE_PULISCI: [&str; 3] = ["events", "snapshots", "meta"];
const TEMP_BACKUP_STALE_SECS: u64 = 24 * 60 * 60;

type R<T> = Result<T, String>;

fn s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Crea un backup zip di `data_dir` in `dest_dir`, applicando la retention.
///
/// Il nome file include il `device` (come per i log eventi): così su OneDrive due
/// PC scrivono file distinti e non si generano "conflicted copy". La retention è
/// **per-dispositivo** (ogni PC gestisce solo i propri backup).
pub fn esegui(
    data_dir: &Path,
    dest_dir: &Path,
    device: &str,
    retention: usize,
    tag: Option<&str>,
) -> R<BackupInfo> {
    fs::create_dir_all(dest_dir).map_err(s)?;
    let prefix = format!("pharmatek-backup-{device}-");
    pulisci_temporanei_stale(dest_dir, &prefix);
    let nome = match tag.and_then(tag_backup) {
        Some(tag) => format!("{prefix}{tag}-{}-{}.zip", timestamp(), Ulid::generate()),
        None => format!("{prefix}{}-{}.zip", timestamp(), Ulid::generate()),
    };
    let zip_path = dest_dir.join(&nome);
    let temp_path = dest_dir.join(format!(".{prefix}{}.zip.tmp", Ulid::generate()));

    let result = (|| {
        let file = File::create(&temp_path).map_err(s)?;
        let mut zip = ZipWriter::new(file);
        let opts = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .compression_level(Some(1));
        for sub in SOTTOCARTELLE_ZIP {
            let p = data_dir.join(sub);
            if p.is_dir() {
                zip.add_directory(format!("{sub}/"), opts).map_err(s)?;
                if sub == "snapshots" {
                    aggiungi_ultimi_snapshot_per_device(&mut zip, data_dir, &p)?;
                } else {
                    aggiungi_dir(&mut zip, data_dir, &p, opts)?;
                }
            }
        }
        let file = zip.finish().map_err(s)?;
        file.sync_all().map_err(s)?;
        valida_archivio_completo(&temp_path)?;
        fs::rename(&temp_path, &zip_path).map_err(s)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    applica_retention(dest_dir, &prefix, retention)?;
    info_di(&zip_path)
}

fn valida_archivio_completo(path: &Path) -> R<()> {
    let file = File::open(path).map_err(s)?;
    let mut archive = ZipArchive::new(file).map_err(s)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(s)?;
        if entry.is_file() {
            io::copy(&mut entry, &mut io::sink()).map_err(s)?;
        }
    }
    Ok(())
}

fn archivio_apribile(path: &Path) -> bool {
    File::open(path)
        .ok()
        .and_then(|file| ZipArchive::new(file).ok())
        .is_some()
}

fn pulisci_temporanei_stale(dest_dir: &Path, prefix: &str) {
    let Ok(entries) = fs::read_dir(dest_dir) else {
        return;
    };
    let now = std::time::SystemTime::now();
    let temp_prefix = format!(".{prefix}");
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if !name.starts_with(&temp_prefix) || !name.ends_with(".zip.tmp") {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age.as_secs() >= TEMP_BACKUP_STALE_SECS);
        if stale {
            let _ = fs::remove_file(path);
        }
    }
}

fn aggiungi_ultimi_snapshot_per_device<W: io::Write + io::Seek>(
    zip: &mut ZipWriter<W>,
    base: &Path,
    dir: &Path,
) -> R<()> {
    let mut best: std::collections::BTreeMap<String, (u64, std::time::SystemTime, PathBuf)> =
        std::collections::BTreeMap::new();
    for entry in fs::read_dir(dir).map_err(s)? {
        let entry = entry.map_err(s)?;
        let path = entry.path();
        if !path.is_file()
            || !path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("json"))
                .unwrap_or(false)
        {
            continue;
        }
        let Some((device, seq)) = snapshot_name_parts(&path) else {
            continue;
        };
        if let Ok(meta) = entry.metadata() {
            if let Ok(mtime) = meta.modified() {
                let replace = best
                    .get(&device)
                    .map(|(cur_seq, cur_time, _)| {
                        seq > *cur_seq || (seq == *cur_seq && mtime > *cur_time)
                    })
                    .unwrap_or(true);
                if replace {
                    best.insert(device, (seq, mtime, path));
                }
            }
        }
    }
    for (_, _, path) in best.into_values() {
        let rel = path
            .strip_prefix(base)
            .map_err(s)?
            .to_string_lossy()
            .replace('\\', "/");
        let file_opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file(rel, file_opts).map_err(s)?;
        let mut f = File::open(&path).map_err(s)?;
        io::copy(&mut f, zip).map_err(s)?;
    }
    Ok(())
}

fn aggiungi_dir<W: io::Write + io::Seek>(
    zip: &mut ZipWriter<W>,
    base: &Path,
    dir: &Path,
    opts: SimpleFileOptions,
) -> R<()> {
    for entry in fs::read_dir(dir).map_err(s)? {
        let path = entry.map_err(s)?.path();
        let rel = path
            .strip_prefix(base)
            .map_err(s)?
            .to_string_lossy()
            .replace('\\', "/");
        if is_restore_runtime_artifact(&rel) {
            continue;
        }
        if path.is_dir() {
            zip.add_directory(format!("{rel}/"), opts).map_err(s)?;
            aggiungi_dir(zip, base, &path, opts)?;
        } else {
            let usa_deflate = path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("ndjson"))
                .unwrap_or(false);
            let file_opts = if usa_deflate {
                opts
            } else {
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored)
            };
            zip.start_file(rel, file_opts).map_err(s)?;
            let mut f = File::open(&path).map_err(s)?;
            io::copy(&mut f, zip).map_err(s)?;
        }
    }
    Ok(())
}

/// Ripristina un backup: cancella le cartelle dati e le riestrae dallo zip.
pub fn ripristina(zip_path: &Path, data_dir: &Path, snapshot_in_zip: Option<&str>) -> R<()> {
    if let Some(sel) = snapshot_in_zip {
        let normalized = sel.replace('\\', "/");
        valida_snapshot_selezionato(&normalized)?;
        let file = File::open(zip_path).map_err(s)?;
        let mut archive = ZipArchive::new(file).map_err(s)?;
        let f = archive.by_name(&normalized).map_err(s)?;
        if f.is_dir() {
            return Err("snapshot selezionato non valido".into());
        }
    }
    for sub in SOTTOCARTELLE_PULISCI {
        let p = data_dir.join(sub);
        if p.exists() {
            fs::remove_dir_all(&p).map_err(s)?;
        }
    }
    let file = File::open(zip_path).map_err(s)?;
    let mut archive = ZipArchive::new(file).map_err(s)?;
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(s)?;
        // `enclosed_name` protegge dallo zip-slip (percorsi `..`).
        let name = match f.enclosed_name() {
            Some(n) => n,
            None => continue,
        };
        let out = data_dir.join(name);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(s)?;
        } else {
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).map_err(s)?;
            }
            let mut o = File::create(&out).map_err(s)?;
            io::copy(&mut f, &mut o).map_err(s)?;
        }
    }
    if let Some(sel) = snapshot_in_zip {
        applica_snapshot_manuale(data_dir, sel)?;
    }
    let locks = data_dir.join("meta").join("locks");
    if locks.exists() {
        fs::remove_dir_all(locks).map_err(s)?;
    }
    Ok(())
}

pub fn snapshot_choices(zip_path: &Path) -> R<Vec<SnapshotInfoDto>> {
    let file = File::open(zip_path).map_err(s)?;
    let mut archive = ZipArchive::new(file).map_err(s)?;
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(s)?;
        if f.is_dir() || !f.name().starts_with("snapshots/") || !f.name().ends_with(".json") {
            continue;
        }
        let path_in_zip = f.name().replace('\\', "/");
        let (device_id, seq) = snapshot_name_parts(Path::new(&path_in_zip))
            .unwrap_or_else(|| ("sconosciuto".to_string(), 0));
        let bytes = f.size();
        let mut buf = Vec::new();
        io::copy(&mut f, &mut buf).map_err(s)?;
        let Ok(snap) = serde_json::from_slice::<SnapshotData>(&buf) else {
            out.push(SnapshotInfoDto {
                path_in_zip,
                device_id,
                device_nome: "Dispositivo sconosciuto".to_string(),
                seq,
                modified_ms: 0,
                bytes,
                records: 0,
                purged: 0,
                watermarks: 0,
                recommended: false,
                safe: false,
            });
            continue;
        };
        let device_nome = snapshot_device_name(&snap, &device_id);
        let retired_devices: std::collections::HashSet<&str> = snap
            .records
            .iter()
            .filter(|r| r.entity == "device_retired")
            .map(|r| r.id.as_str())
            .collect();
        let active_watermarks = snap
            .watermarks
            .keys()
            .filter(|dev| !retired_devices.contains(dev.as_str()))
            .count();
        out.push(SnapshotInfoDto {
            path_in_zip,
            device_id,
            device_nome,
            seq,
            modified_ms: snapshot_modified_ms(&snap),
            bytes,
            records: snap.records.len(),
            purged: snap.purged.len(),
            watermarks: active_watermarks,
            recommended: false,
            safe: true,
        });
    }
    if let Some((idx, _)) = out
        .iter()
        .enumerate()
        .filter(|(_, s)| s.safe)
        .max_by_key(|(_, s)| (s.modified_ms, s.seq))
    {
        out[idx].recommended = true;
    }
    out.sort_by_key(|s| std::cmp::Reverse((s.recommended, s.modified_ms, s.seq)));
    Ok(out)
}

fn snapshot_device_name(snap: &SnapshotData, device_id: &str) -> String {
    if device_id.starts_with("generation-anchor") {
        return "Base post-ottimizzazione".to_string();
    }
    if device_id.starts_with("restore-anchor") {
        return "Base di ripristino".to_string();
    }
    if let Some(rest) = device_id.strip_prefix("pre-ottimizzazione-") {
        let dev_name = snapshot_device_name(snap, rest);
        return format!("Pre-ottimizzazione ({dev_name})");
    }
    snap.records
        .iter()
        .find(|r| r.entity == "device" && r.id == device_id)
        .and_then(|r| serde_json::from_str::<serde_json::Value>(&r.data).ok())
        .and_then(|v| {
            v.get("nome")
                .and_then(|n| n.as_str())
                .map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| device_id.to_string())
}

fn applica_snapshot_manuale(data_dir: &Path, selected: &str) -> R<()> {
    let normalized = selected.replace('\\', "/");
    valida_snapshot_selezionato(&normalized)?;
    let snapshots_dir = data_dir.join("snapshots");
    let selected_path = data_dir.join(&normalized);
    if !selected_path.exists() {
        return Err("snapshot selezionato non presente nel backup estratto".into());
    }

    for entry in fs::read_dir(&snapshots_dir).map_err(s)? {
        let path = entry.map_err(s)?.path();
        if path.is_file()
            && path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("json"))
                .unwrap_or(false)
            && path != selected_path
        {
            let _ = fs::remove_file(path);
        }
    }

    let bytes = fs::read(&selected_path).map_err(s)?;
    let mut snap: SnapshotData = serde_json::from_slice(&bytes).map_err(s)?;
    // Nel restore manuale la scelta dello snapshot e' esplicita: gli offset vengono
    // azzerati per rileggere i log estratti dall'inizio ed evitare salti storici.
    snap.offsets.clear();
    let bytes = serde_json::to_vec(&snap).map_err(s)?;
    fs::write(&selected_path, bytes).map_err(s)?;
    Ok(())
}

fn valida_snapshot_selezionato(path: &str) -> R<()> {
    let normalized = path.replace('\\', "/");
    if !normalized.starts_with("snapshots/")
        || !normalized.ends_with(".json")
        || normalized.contains("..")
        || normalized.split('/').count() != 2
    {
        return Err("snapshot selezionato non valido".into());
    }
    Ok(())
}

/// Elenco dei backup in `dest_dir`, dal più recente.
pub fn lista(dest_dir: &Path) -> R<Vec<BackupInfo>> {
    let mut out = Vec::new();
    if !dest_dir.exists() {
        return Ok(out);
    }
    for entry in fs::read_dir(dest_dir).map_err(s)? {
        let path = entry.map_err(s)?.path();
        let nome = match path.file_name() {
            Some(n) => n.to_string_lossy().into_owned(),
            None => continue,
        };
        if nome.starts_with("pharmatek-backup-")
            && nome.ends_with(".zip")
            && archivio_apribile(&path)
        {
            out.push(info_di(&path)?);
        }
    }
    out.sort_by_key(|b| std::cmp::Reverse(b.ms));
    Ok(out)
}

/// Elimina un singolo file di backup. Per sicurezza accetta solo file con il
/// nome convenzionale `pharmatek-backup-*.zip` (niente cancellazioni arbitrarie).
pub fn elimina(zip_path: &Path) -> R<()> {
    let nome = zip_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !(nome.starts_with("pharmatek-backup-") && nome.ends_with(".zip")) {
        return Err("Non è un file di backup valido.".into());
    }
    if !zip_path.exists() {
        return Ok(()); // già rimosso: niente errore
    }
    fs::remove_file(zip_path).map_err(s)
}

fn applica_retention(dest_dir: &Path, prefix: &str, retention: usize) -> R<()> {
    // Solo i backup di questo dispositivo (stesso prefisso col deviceId).
    let mut v: Vec<BackupInfo> = lista(dest_dir)?
        .into_iter()
        .filter(|b| b.nome.starts_with(prefix))
        .collect();
    if v.len() > retention {
        for b in v.split_off(retention) {
            let _ = fs::remove_file(&b.path);
        }
    }
    Ok(())
}

fn tag_backup(tag: &str) -> Option<String> {
    let pulito: String = tag
        .chars()
        .filter_map(|c| {
            let c = c.to_ascii_lowercase();
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                Some(c)
            } else if c.is_ascii_whitespace() {
                Some('-')
            } else {
                None
            }
        })
        .take(32)
        .collect();
    if pulito.is_empty() {
        None
    } else {
        Some(pulito)
    }
}

fn info_di(path: &Path) -> R<BackupInfo> {
    let meta = fs::metadata(path).map_err(s)?;
    let ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(BackupInfo {
        nome: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        size: meta.len(),
        ms,
    })
}

fn snapshot_name_parts(path: &Path) -> Option<(String, u64)> {
    let name = path.file_name()?.to_string_lossy();
    let stem = name.strip_suffix(".json")?;
    let (device, seq) = stem.rsplit_once('-')?;
    let seq = seq.parse::<u64>().ok()?;
    Some((device.to_string(), seq))
}

pub fn snapshot_modified_ms(snap: &SnapshotData) -> u64 {
    snap.watermarks
        .values()
        .filter_map(|h| h.parse::<Hlc>().ok().map(|h| h.wall))
        .chain(
            snap.records
                .iter()
                .filter_map(|r| r.updated_hlc.parse::<Hlc>().ok().map(|h| h.wall)),
        )
        .max()
        .unwrap_or(0)
}

fn timestamp() -> String {
    use std::time::SystemTime;
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, d, h, mi, sec) = civil_from_unix(secs);
    format!("{y:04}{mo:02}{d:02}-{h:02}{mi:02}{sec:02}")
}

/// Posizione di default dei backup: dentro la cartella dati (OneDrive), così sono
/// salvati anche off-site. Il nome file include il deviceId → niente conflitti.
pub fn cartella_default(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_e_ripristino_roundtrip() {
        let data = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();

        fs::create_dir_all(data.path().join("events")).unwrap();
        fs::write(data.path().join("events/PC-A.ndjson"), b"riga1\nriga2\n").unwrap();
        fs::create_dir_all(data.path().join("meta/avatars")).unwrap();
        fs::write(data.path().join("meta/avatars/u.png"), b"PNGDATA").unwrap();

        let info = esegui(data.path(), dest.path(), "PC-TEST", 10, None).unwrap();
        assert!(Path::new(&info.path).exists());
        assert_eq!(lista(dest.path()).unwrap().len(), 1);
        assert!(fs::read_dir(dest.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".zip.tmp")
        }));

        // Cancella e ripristina.
        fs::remove_dir_all(data.path().join("events")).unwrap();
        fs::remove_dir_all(data.path().join("meta")).unwrap();
        ripristina(Path::new(&info.path), data.path(), None).unwrap();

        assert_eq!(
            fs::read(data.path().join("events/PC-A.ndjson")).unwrap(),
            b"riga1\nriga2\n"
        );
        assert_eq!(
            fs::read(data.path().join("meta/avatars/u.png")).unwrap(),
            b"PNGDATA"
        );
    }

    #[test]
    fn lista_ignora_zip_parziali_e_temporanei() {
        let dest = tempfile::tempdir().unwrap();
        fs::write(
            dest.path().join("pharmatek-backup-PC-ROTTO.zip"),
            b"PK\x03\x04archivio troncato",
        )
        .unwrap();
        fs::write(
            dest.path().join(".pharmatek-backup-PC-ROTTO.zip.tmp"),
            b"parziale",
        )
        .unwrap();

        assert!(lista(dest.path()).unwrap().is_empty());
    }

    #[test]
    fn backup_esclude_lock_runtime_e_supporta_tag() {
        let data = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        fs::create_dir_all(data.path().join("events")).unwrap();
        fs::write(data.path().join("events/PC-A.ndjson"), b"{}\n").unwrap();
        fs::create_dir_all(data.path().join("meta/locks")).unwrap();
        fs::write(data.path().join("meta/locks/PC-A.json"), b"LOCK").unwrap();
        fs::create_dir_all(data.path().join("meta/restore_coordination/acks/R1")).unwrap();
        fs::write(
            data.path()
                .join("meta/restore_coordination/prepare-R1.json"),
            b"PREPARE",
        )
        .unwrap();
        fs::write(
            data.path()
                .join("meta/restore_coordination/acks/R1/PC-A.json"),
            b"ACK",
        )
        .unwrap();

        let info = esegui(data.path(), dest.path(), "PC-TEST", 10, Some("pre import")).unwrap();
        assert!(info.nome.contains("-pre-import-"));

        let file = File::open(&info.path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.iter().all(|n| !n.starts_with("meta/locks")));
        assert!(names
            .iter()
            .all(|n| !n.starts_with("meta/restore_coordination")));
    }

    #[test]
    fn backup_include_uno_snapshot_per_device() {
        let data = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        fs::create_dir_all(data.path().join("events")).unwrap();
        fs::write(data.path().join("events/PC-A.ndjson"), b"{}\n").unwrap();
        fs::create_dir_all(data.path().join("snapshots")).unwrap();
        fs::write(
            data.path().join("snapshots/PC-A-00000001.json"),
            b"{\"records\":[],\"clocks\":[],\"offsets\":{}}",
        )
        .unwrap();
        fs::write(
            data.path().join("snapshots/PC-A-00000002.json"),
            b"{\"records\":[],\"clocks\":[],\"offsets\":{}}",
        )
        .unwrap();
        fs::write(
            data.path().join("snapshots/PC-B-00000001.json"),
            b"{\"records\":[],\"clocks\":[],\"offsets\":{}}",
        )
        .unwrap();

        let info = esegui(data.path(), dest.path(), "PC-TEST", 10, None).unwrap();
        let file = File::open(&info.path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.iter().any(|n| n == "snapshots/PC-A-00000002.json"));
        assert!(names.iter().any(|n| n == "snapshots/PC-B-00000001.json"));
        assert!(names.iter().all(|n| n != "snapshots/PC-A-00000001.json"));
    }

    #[test]
    fn ripristino_manuale_tiene_snapshot_scelto_e_azzera_offset() {
        let data = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        fs::create_dir_all(data.path().join("events")).unwrap();
        fs::write(data.path().join("events/PC-A.ndjson"), b"{}\n").unwrap();
        fs::create_dir_all(data.path().join("snapshots")).unwrap();
        fs::write(
            data.path().join("snapshots/PC-A-00000001.json"),
            br#"{"records":[],"clocks":[],"offsets":{"PC-A.ndjson":100},"watermarks":{"PC-A":"0000000000000001-00000000-PC-A"}}"#,
        )
        .unwrap();
        fs::write(
            data.path().join("snapshots/PC-B-00000001.json"),
            br#"{"records":[],"clocks":[],"offsets":{"PC-B.ndjson":200},"watermarks":{"PC-B":"0000000000000002-00000000-PC-B"}}"#,
        )
        .unwrap();

        let info = esegui(data.path(), dest.path(), "PC-TEST", 10, None).unwrap();
        let choices = snapshot_choices(Path::new(&info.path)).unwrap();
        assert_eq!(choices.len(), 2);
        assert!(choices
            .iter()
            .any(|s| s.path_in_zip == "snapshots/PC-B-00000001.json" && s.recommended));

        fs::remove_dir_all(data.path().join("events")).unwrap();
        fs::remove_dir_all(data.path().join("snapshots")).unwrap();
        ripristina(
            Path::new(&info.path),
            data.path(),
            Some("snapshots/PC-A-00000001.json"),
        )
        .unwrap();

        assert!(data.path().join("snapshots/PC-A-00000001.json").exists());
        assert!(!data.path().join("snapshots/PC-B-00000001.json").exists());
        let bytes = fs::read(data.path().join("snapshots/PC-A-00000001.json")).unwrap();
        let snap: SnapshotData = serde_json::from_slice(&bytes).unwrap();
        assert!(snap.offsets.is_empty());
    }
}
