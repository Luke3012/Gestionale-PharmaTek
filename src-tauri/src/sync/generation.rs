//! Barriera persistente tra generazioni del log.
//!
//! La compattazione elimina log e tombstone soltanto dopo aver salvato uno
//! snapshot autorevole. Questo manifest resta nella cartella condivisa e rende
//! innocui eventuali file della generazione precedente riconsegnati da OneDrive.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::restore_support::checksum_file;
use crate::sync::hlc::Hlc;
use crate::sync::snapshot::SnapshotStore;

pub const GENERATION_MANIFEST_RELATIVE: &str = "meta/generation.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationBarrier {
    pub protocol_version: u8,
    pub generation_id: String,
    pub created_at: u64,
    pub device_id: String,
    pub anchor_path: String,
    pub anchor_bytes: u64,
    pub anchor_checksum: String,
    #[serde(default)]
    pub cutoffs: BTreeMap<String, String>,
}

impl GenerationBarrier {
    pub fn load(data_dir: &Path) -> io::Result<Option<Self>> {
        let path = data_dir.join(GENERATION_MANIFEST_RELATIVE);
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let manifest: Self = serde_json::from_slice(&bytes)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        manifest.validate(data_dir)?;
        Ok(Some(manifest))
    }

    pub fn write_atomic(&self, data_dir: &Path) -> io::Result<()> {
        self.validate(data_dir)?;
        let path = data_dir.join(GENERATION_MANIFEST_RELATIVE);
        let parent = path.parent().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "cartella manifest generazione non valida",
            )
        })?;
        fs::create_dir_all(parent)?;
        let tmp = parent.join(format!(".generation-{}.tmp", self.generation_id));
        {
            let mut file = fs::File::create(&tmp)?;
            use std::io::Write;
            file.write_all(
                serde_json::to_string_pretty(self)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
                    .as_bytes(),
            )?;
            file.flush()?;
            file.sync_all()?;
        }
        replace_atomic(&tmp, &path)
    }

    pub fn anchor(&self, data_dir: &Path) -> io::Result<PathBuf> {
        safe_relative_path(data_dir, &self.anchor_path)
    }

    pub fn cutoff(&self, device: &str) -> Option<Hlc> {
        self.cutoffs
            .get(device)
            .and_then(|value| value.parse::<Hlc>().ok())
    }

    pub fn skips(&self, hlc: &Hlc) -> bool {
        self.cutoff(&hlc.device)
            .map(|cutoff| hlc <= &cutoff)
            // Protegge anche sorgenti storiche sconosciute al checkpoint.
            .unwrap_or(hlc.wall <= self.created_at)
    }

    fn validate(&self, data_dir: &Path) -> io::Result<()> {
        if self.protocol_version != 1
            || self.generation_id.trim().is_empty()
            || self.device_id.trim().is_empty()
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "manifest generazione non valido",
            ));
        }
        for cutoff in self.cutoffs.values() {
            cutoff
                .parse::<Hlc>()
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
        }
        let anchor = self.anchor(data_dir)?;
        let metadata = fs::metadata(&anchor)?;
        if !metadata.is_file() || metadata.len() != self.anchor_bytes {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "anchor generazione incompleto",
            ));
        }
        if checksum_file(&anchor)? != self.anchor_checksum {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "checksum anchor generazione non valido",
            ));
        }
        let store = SnapshotStore::new(data_dir.join("snapshots"), "generation-validator")?;
        let snapshot = store.load(&anchor)?;
        if !snapshot.purged.is_empty()
            || !snapshot.offsets.is_empty()
            || !snapshot.applied.is_empty()
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "anchor generazione contiene tombstone, offset o deduplica storici",
            ));
        }
        for (device, cutoff) in &self.cutoffs {
            if snapshot
                .watermarks
                .get(device)
                .map(|watermark| watermark < cutoff)
                .unwrap_or(true)
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "anchor generazione non copre tutti i cutoff",
                ));
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
fn replace_atomic(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_w = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination_w = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        MoveFileExW(
            PCWSTR(source_w.as_ptr()),
            PCWSTR(destination_w.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(io::Error::other)
}

#[cfg(not(windows))]
fn replace_atomic(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

fn safe_relative_path(data_dir: &Path, relative: &str) -> io::Result<PathBuf> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "percorso anchor generazione non valido",
        ));
    }
    let path = data_dir.join(relative);
    if path.parent() != Some(data_dir.join("snapshots").as_path())
        || !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("generation-anchor-") && name.ends_with(".json"))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "anchor fuori dalla cartella prevista",
        ));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::SnapshotData;

    #[test]
    fn barriera_valida_salta_eventi_precedenti_e_non_quelli_nuovi() {
        let dir = tempfile::tempdir().unwrap();
        let snapshots = dir.path().join("snapshots");
        let store = SnapshotStore::new(&snapshots, "generation-anchor-G1").unwrap();
        let mut snapshot = SnapshotData {
            records: Vec::new(),
            clocks: Vec::new(),
            applied: BTreeMap::new(),
            offsets: BTreeMap::new(),
            purged: Vec::new(),
            watermarks: BTreeMap::new(),
        };
        snapshot
            .watermarks
            .insert("PC-A".into(), Hlc::new(100, 2, "PC-A").to_string());
        let anchor = store.save(&snapshot, 1).unwrap();
        let relative = anchor
            .strip_prefix(dir.path())
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        let barrier = GenerationBarrier {
            protocol_version: 1,
            generation_id: "G1".into(),
            created_at: 100,
            device_id: "PC-A".into(),
            anchor_path: relative,
            anchor_bytes: fs::metadata(&anchor).unwrap().len(),
            anchor_checksum: checksum_file(&anchor).unwrap(),
            cutoffs: snapshot.watermarks.clone(),
        };
        barrier.write_atomic(dir.path()).unwrap();
        let loaded = GenerationBarrier::load(dir.path()).unwrap().unwrap();
        assert!(loaded.skips(&Hlc::new(100, 2, "PC-A")));
        assert!(!loaded.skips(&Hlc::new(101, 0, "PC-A")));
        assert!(loaded.skips(&Hlc::new(99, 0, "PC-SCONOSCIUTO")));

        // La manutenzione è ripetibile: su Windows il manifest esistente deve
        // essere sostituito atomicamente, non rendere impossibile il secondo giro.
        let mut sostituita = loaded;
        sostituita.created_at = 101;
        sostituita.write_atomic(dir.path()).unwrap();
        assert_eq!(
            GenerationBarrier::load(dir.path())
                .unwrap()
                .unwrap()
                .created_at,
            101
        );
    }
}
