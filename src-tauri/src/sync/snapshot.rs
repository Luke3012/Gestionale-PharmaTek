//! Snapshot/compattazione dello stato in `snapshots/`.
//!
//! Uno snapshot è un dump JSON della proiezione (vedi [`crate::projection::SnapshotData`]).
//! Serve a:
//! - **bootstrap rapido** di un nuovo dispositivo (carica lo stato senza ripiegare
//!   tutta la storia da zero — anche se per sicurezza i log vengono comunque riletti);
//! - bootstrap e recovery di compatibilità per dataset prodotti da versioni precedenti.
//!
//! La scrittura è atomica (file temporaneo + `rename`). Ogni dispositivo scrive i
//! propri snapshot `snapshots/<device>-<seq>.json`; al bootstrap tutti gli snapshot
//! validi vengono fusi per campo e i log completi colmano la coda.
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::projection::{RawClock, RawRecord, SnapshotData};

pub struct SnapshotStore {
    dir: PathBuf,
    device: String,
}

impl SnapshotStore {
    pub fn new(snapshots_dir: impl Into<PathBuf>, device: impl Into<String>) -> io::Result<Self> {
        let dir = snapshots_dir.into();
        fs::create_dir_all(&dir)?;
        Ok(SnapshotStore {
            dir,
            device: device.into(),
        })
    }

    /// Prossima sequenza per questo dispositivo (max esistente + 1).
    pub fn next_seq(&self) -> io::Result<u64> {
        let prefix = format!("{}-", self.device);
        let mut max = 0u64;
        for entry in fs::read_dir(&self.dir)? {
            let name = entry?.file_name().to_string_lossy().into_owned();
            if let Some(rest) = name.strip_prefix(&prefix) {
                if let Some(num) = rest.strip_suffix(".json") {
                    if let Ok(n) = num.parse::<u64>() {
                        max = max.max(n);
                    }
                }
            }
        }
        Ok(max + 1)
    }

    /// Salva uno snapshot (scrittura atomica) e restituisce il percorso scritto.
    pub fn save(&self, data: &SnapshotData, seq: u64) -> io::Result<PathBuf> {
        let path = self.dir.join(format!("{}-{:08}.json", self.device, seq));
        let tmp = self
            .dir
            .join(format!(".{}-{:08}.json.tmp", self.device, seq));
        let bytes =
            serde_json::to_vec(data).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        {
            let mut f = File::create(&tmp)?;
            f.write_all(&bytes)?;
            f.flush()?;
            f.sync_all()?;
        }
        fs::rename(&tmp, &path)?;
        Ok(path)
    }

    /// Carica e fonde gli snapshot validi di tutti i dispositivi.
    ///
    /// Snapshot creati da PC che erano offline possono essere concorrenti: sceglierne
    /// uno in base all'ultimo timestamp perderebbe lo stato presente soltanto negli
    /// altri. La fusione usa i clock LWW, unisce le tombstone terminali e conserva
    /// per ogni log soltanto l'offset sicuramente coperto da tutti gli snapshot.
    pub fn latest(&self) -> io::Result<Option<SnapshotData>> {
        let raw_paths = fs::read_dir(&self.dir)?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.is_file()
                    && path
                        .extension()
                        .map(|e| e.eq_ignore_ascii_case("json"))
                        .unwrap_or(false)
            })
            .collect::<Vec<_>>();

        // Raggruppa per dispositivo e conserva solo lo snapshot con sequenza massima.
        // Evita di rileggere e fondere file storici obsoleti della stessa postazione.
        let mut latest_by_device: BTreeMap<String, (u64, PathBuf)> = BTreeMap::new();
        let mut others = Vec::new();
        for path in raw_paths {
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if let Some(stem) = file_name
                    .strip_suffix(".json")
                    .or_else(|| file_name.strip_suffix(".JSON"))
                {
                    if let Some((device, seq_str)) = stem.rsplit_once('-') {
                        if let Ok(seq) = seq_str.parse::<u64>() {
                            match latest_by_device.get_mut(device) {
                                Some((cur_seq, cur_path)) => {
                                    if seq > *cur_seq {
                                        *cur_seq = seq;
                                        *cur_path = path;
                                    }
                                }
                                None => {
                                    latest_by_device.insert(device.to_string(), (seq, path));
                                }
                            }
                            continue;
                        }
                    }
                }
            }
            others.push(path);
        }

        let mut paths: Vec<PathBuf> = latest_by_device.into_values().map(|(_, p)| p).collect();
        paths.extend(others);
        paths.sort();

        let mut snapshots = Vec::new();
        for path in paths {
            let bytes = match fs::read(&path) {
                Ok(bytes) => bytes,
                Err(err) => {
                    eprintln!(
                        "snapshot non leggibile ignorato ({}): {err}",
                        path.display()
                    );
                    continue;
                }
            };
            match serde_json::from_slice::<SnapshotData>(&bytes) {
                Ok(data) => match validate_snapshot(&data) {
                    Ok(()) => snapshots.push(data),
                    Err(err) => {
                        eprintln!("snapshot incoerente ignorato ({}): {err}", path.display());
                    }
                },
                Err(err) => {
                    // Un file parziale non deve bloccare gli altri snapshot validi o,
                    // in loro assenza, il rebuild dai log completi.
                    eprintln!("snapshot non valido ignorato ({}): {err}", path.display());
                }
            }
        }
        merge_snapshots(snapshots)
    }

    /// Carica un singolo snapshot, senza fonderlo con gli altri file presenti.
    /// Il ripristino coordinato usa questa primitive per partire esclusivamente
    /// dall'anchor certificato dal manifest.
    pub fn load(&self, path: &Path) -> io::Result<SnapshotData> {
        if path.parent() != Some(self.dir.as_path()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "snapshot fuori dalla cartella prevista",
            ));
        }
        let bytes = fs::read(path)?;
        let data = serde_json::from_slice::<SnapshotData>(&bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        validate_snapshot(&data).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        Ok(data)
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Mantiene solo gli ultimi `keep` snapshot **di questo dispositivo**, eliminando
    /// i più vecchi (per sequenza). Tocca solo i propri file → niente conflitti
    /// OneDrive. Restituisce quanti ne ha rimossi. `keep == 0` non rimuove nulla.
    pub fn prune(&self, keep: usize) -> io::Result<usize> {
        if keep == 0 {
            return Ok(0);
        }
        let prefix = format!("{}-", self.device);
        let mut mine: Vec<(u64, PathBuf)> = Vec::new();
        for entry in fs::read_dir(&self.dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(rest) = name.strip_prefix(&prefix) {
                if let Some(num) = rest.strip_suffix(".json") {
                    if let Ok(n) = num.parse::<u64>() {
                        mine.push((n, entry.path()));
                    }
                }
            }
        }
        if mine.len() <= keep {
            return Ok(0);
        }
        mine.sort_by_key(|(n, _)| *n); // crescente: i più vecchi davanti
        let da_rimuovere = mine.len() - keep;
        let mut rimossi = 0;
        for (_, path) in mine.into_iter().take(da_rimuovere) {
            if fs::remove_file(&path).is_ok() {
                rimossi += 1;
            }
        }
        Ok(rimossi)
    }
}

fn validate_snapshot(snapshot: &SnapshotData) -> std::result::Result<(), String> {
    for record in &snapshot.records {
        let data = serde_json::from_str::<serde_json::Value>(&record.data)
            .map_err(|err| format!("JSON record {}/{}: {err}", record.entity, record.id))?;
        if !data.is_object() {
            return Err(format!(
                "il record {}/{} non contiene un oggetto JSON",
                record.entity, record.id
            ));
        }
        record
            .created_hlc
            .parse::<crate::sync::hlc::Hlc>()
            .map_err(|err| err.to_string())?;
        record
            .updated_hlc
            .parse::<crate::sync::hlc::Hlc>()
            .map_err(|err| err.to_string())?;
    }
    for clock in &snapshot.clocks {
        clock
            .hlc
            .parse::<crate::sync::hlc::Hlc>()
            .map_err(|err| err.to_string())?;
    }
    for purged in &snapshot.purged {
        if !purged.purged_hlc.is_empty() {
            purged
                .purged_hlc
                .parse::<crate::sync::hlc::Hlc>()
                .map_err(|err| err.to_string())?;
        }
    }
    for hlc in snapshot
        .applied
        .values()
        .chain(snapshot.watermarks.values())
    {
        hlc.parse::<crate::sync::hlc::Hlc>()
            .map_err(|err| err.to_string())?;
    }
    if snapshot.offsets.values().any(|offset| *offset < 0) {
        return Err("offset log negativo".into());
    }
    Ok(())
}

#[derive(Default)]
struct MergedRecord {
    created_hlc: Option<String>,
    updated_hlc: Option<String>,
    fields: BTreeMap<String, (String, serde_json::Value)>,
    deleted: Option<(String, bool)>,
}

fn entity_ricreabile(entity: &str) -> bool {
    matches!(entity, "preventivo" | "scheda_cliente")
}

fn created_successiva_al_purge(
    entity: &str,
    id: &str,
    created_hlc: &str,
    purged: &BTreeMap<(String, String), String>,
    legacy_purge_watermarks: &BTreeMap<(String, String), Vec<BTreeMap<String, String>>>,
) -> bool {
    if !entity_ricreabile(entity) {
        return false;
    }
    let key = (entity.to_string(), id.to_string());
    let Some(purged_hlc) = purged.get(&key) else {
        return true;
    };
    if !purged_hlc.is_empty() {
        return created_hlc > purged_hlc.as_str();
    }

    // Gli snapshot legacy non registravano l'HLC della purge. Un record può
    // prevalere soltanto se la sua Created è certamente successiva a ciascuno
    // snapshot che porta quella tombstone: il device non era ancora noto, oppure
    // il suo watermark era precedente. Senza watermarks restiamo conservativi.
    let Ok(created) = created_hlc.parse::<crate::sync::hlc::Hlc>() else {
        return false;
    };
    legacy_purge_watermarks.get(&key).is_some_and(|sources| {
        !sources.is_empty()
            && sources.iter().all(|source| {
                if source.is_empty() {
                    return false;
                }
                source
                    .get(&created.device)
                    .map(|watermark| created_hlc > watermark.as_str())
                    .unwrap_or(true)
            })
    })
}

fn merge_snapshots(snapshots: Vec<SnapshotData>) -> io::Result<Option<SnapshotData>> {
    if snapshots.is_empty() {
        return Ok(None);
    }

    let mut records: BTreeMap<(String, String), MergedRecord> = BTreeMap::new();
    let mut clocks: BTreeMap<(String, String, String), RawClock> = BTreeMap::new();
    let mut purged: BTreeMap<(String, String), String> = BTreeMap::new();
    let mut legacy_purge_watermarks: BTreeMap<(String, String), Vec<BTreeMap<String, String>>> =
        BTreeMap::new();
    for snap in &snapshots {
        for pg in &snap.purged {
            let key = (pg.entity.clone(), pg.id.clone());
            if pg.purged_hlc.is_empty() {
                legacy_purge_watermarks
                    .entry(key.clone())
                    .or_default()
                    .push(snap.watermarks.clone());
            }
            purged
                .entry(key)
                .and_modify(|current| {
                    if current.is_empty() || (!pg.purged_hlc.is_empty() && pg.purged_hlc > *current)
                    {
                        *current = pg.purged_hlc.clone();
                    }
                })
                .or_insert_with(|| pg.purged_hlc.clone());
        }
    }
    let mut applied = BTreeMap::new();
    let mut offsets = BTreeMap::new();
    let mut watermarks = BTreeMap::new();
    for (snapshots_seen, snap) in snapshots.into_iter().enumerate() {
        let snap_clocks: BTreeMap<(String, String, String), String> = snap
            .clocks
            .iter()
            .map(|clock| {
                (
                    (clock.entity.clone(), clock.id.clone(), clock.field.clone()),
                    clock.hlc.clone(),
                )
            })
            .collect();

        for (event_id, hlc) in snap.applied {
            applied
                .entry(event_id)
                .and_modify(|current: &mut String| {
                    if hlc > *current {
                        *current = hlc.clone();
                    }
                })
                .or_insert(hlc);
        }
        // Un offset è riutilizzabile soltanto fino al minimo coperto da tutti gli
        // snapshot fusi. Se uno snapshot non conosce quel file, si riparte da zero:
        // il replay è idempotente e non rischia di saltare il ramo di una copia
        // conflittuale che in origine aveva lo stesso nome.
        let snap_offsets = snap.offsets;
        for (file, current) in offsets.iter_mut() {
            if !snap_offsets.contains_key(file) {
                *current = 0;
            }
        }
        for (file, offset) in snap_offsets {
            if let Some(current) = offsets.get_mut(&file) {
                *current = (*current).min(offset);
            } else {
                offsets.insert(file, if snapshots_seen == 0 { offset } else { 0 });
            }
        }
        for (device, hlc) in snap.watermarks {
            watermarks
                .entry(device)
                .and_modify(|current: &mut String| {
                    if hlc > *current {
                        *current = hlc.clone();
                    }
                })
                .or_insert(hlc);
        }
        for clock in snap.clocks {
            let key = (clock.entity.clone(), clock.id.clone(), clock.field.clone());
            let replace = clocks
                .get(&key)
                .map(|current| clock.hlc > current.hlc)
                .unwrap_or(true);
            if replace {
                clocks.insert(key, clock);
            }
        }

        for raw in snap.records {
            let key = (raw.entity.clone(), raw.id.clone());
            if purged.contains_key(&key)
                && !created_successiva_al_purge(
                    &raw.entity,
                    &raw.id,
                    &raw.created_hlc,
                    &purged,
                    &legacy_purge_watermarks,
                )
            {
                continue;
            }
            let data = serde_json::from_str::<serde_json::Value>(&raw.data)
                .ok()
                .and_then(|value| value.as_object().cloned())
                .ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("dati snapshot non validi per {}/{}", raw.entity, raw.id),
                    )
                })?;
            let merged = records.entry(key.clone()).or_default();
            if merged
                .created_hlc
                .as_ref()
                .map(|current| raw.created_hlc < *current)
                .unwrap_or(true)
            {
                merged.created_hlc = Some(raw.created_hlc.clone());
            }
            if merged
                .updated_hlc
                .as_ref()
                .map(|current| raw.updated_hlc > *current)
                .unwrap_or(true)
            {
                merged.updated_hlc = Some(raw.updated_hlc.clone());
            }

            for (field, value) in data {
                let hlc = snap_clocks
                    .get(&(key.0.clone(), key.1.clone(), field.clone()))
                    .cloned()
                    .unwrap_or_else(|| raw.updated_hlc.clone());
                let replace = merged
                    .fields
                    .get(&field)
                    .map(|(current, _)| hlc > *current)
                    .unwrap_or(true);
                if replace {
                    merged.fields.insert(field, (hlc, value));
                }
            }

            let deleted_hlc = snap_clocks
                .get(&(key.0, key.1, "@del".to_string()))
                .cloned()
                // Compatibilità: un vecchio snapshot può avere `deleted=true`
                // senza il clock riservato. L'assenza su un record vivo, invece,
                // non equivale a un restore e non deve annullare un delete remoto.
                .or_else(|| raw.deleted.then(|| raw.updated_hlc.clone()));
            if let Some(deleted_hlc) = deleted_hlc {
                let replace_deleted = merged
                    .deleted
                    .as_ref()
                    .map(|(current, _)| deleted_hlc > *current)
                    .unwrap_or(true);
                if replace_deleted {
                    merged.deleted = Some((deleted_hlc, raw.deleted));
                }
            }
        }
    }

    let records = records
        .into_iter()
        .filter(|(key, merged)| {
            let Some(_) = purged.get(key) else {
                return true;
            };
            merged.created_hlc.as_ref().is_some_and(|created| {
                created_successiva_al_purge(
                    &key.0,
                    &key.1,
                    created,
                    &purged,
                    &legacy_purge_watermarks,
                )
            })
        })
        .map(|((entity, id), merged)| {
            let data = serde_json::Map::from_iter(
                merged
                    .fields
                    .into_iter()
                    .map(|(field, (_, value))| (field, value)),
            );
            serde_json::to_string(&serde_json::Value::Object(data))
                .map(|data| RawRecord {
                    entity,
                    id,
                    data,
                    deleted: merged.deleted.map(|(_, deleted)| deleted).unwrap_or(false),
                    created_hlc: merged.created_hlc.unwrap_or_default(),
                    updated_hlc: merged.updated_hlc.unwrap_or_default(),
                })
                .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
        })
        .collect::<io::Result<Vec<_>>>()?;
    let clocks = clocks
        .into_iter()
        .filter(|((entity, id, _), clock)| {
            let Some(purged_hlc) = purged.get(&(entity.clone(), id.clone())) else {
                return true;
            };
            records
                .iter()
                .any(|record| record.entity == *entity && record.id == *id)
                && (purged_hlc.is_empty() || clock.hlc > *purged_hlc)
        })
        .map(|(_, clock)| clock)
        .collect();
    let purged = purged
        .into_iter()
        .filter_map(|((entity, id), purged_hlc)| {
            let recreated = records
                .iter()
                .any(|record| record.entity == entity && record.id == id);
            (!recreated).then_some(crate::projection::RawPurged {
                entity,
                id,
                purged_hlc,
            })
        })
        .collect();

    Ok(Some(SnapshotData {
        records,
        clocks,
        applied,
        offsets,
        purged,
        watermarks,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    fn vuoto() -> SnapshotData {
        SnapshotData {
            records: Vec::new(),
            clocks: Vec::new(),
            applied: BTreeMap::new(),
            offsets: BTreeMap::new(),
            purged: Vec::new(),
            watermarks: BTreeMap::new(),
        }
    }

    fn conta(dir: &Path, prefix: &str) -> usize {
        fs::read_dir(dir)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(prefix)
            })
            .count()
    }

    #[test]
    fn prune_tiene_solo_gli_ultimi_n() {
        let dir = tempfile::tempdir().unwrap();
        let store = SnapshotStore::new(dir.path(), "PC-A").unwrap();
        for _ in 0..5 {
            let seq = store.next_seq().unwrap();
            store.save(&vuoto(), seq).unwrap();
        }
        assert_eq!(store.prune(2).unwrap(), 3);
        assert_eq!(conta(dir.path(), "PC-A-"), 2);
        // Lo snapshot più recente resta caricabile.
        assert!(store.latest().unwrap().is_some());
    }

    #[test]
    fn prune_non_tocca_gli_altri_dispositivi() {
        let dir = tempfile::tempdir().unwrap();
        let a = SnapshotStore::new(dir.path(), "PC-A").unwrap();
        let b = SnapshotStore::new(dir.path(), "PC-B").unwrap();
        for _ in 0..3 {
            let s = a.next_seq().unwrap();
            a.save(&vuoto(), s).unwrap();
            let s = b.next_seq().unwrap();
            b.save(&vuoto(), s).unwrap();
        }
        a.prune(1).unwrap();
        assert_eq!(conta(dir.path(), "PC-A-"), 1);
        assert_eq!(conta(dir.path(), "PC-B-"), 3, "i file di PC-B sono intatti");
    }

    #[test]
    fn snapshot_con_hlc_purge_non_valido_viene_rifiutato() {
        let mut snapshot = vuoto();
        snapshot.purged.push(crate::projection::RawPurged {
            entity: "preventivo".into(),
            id: "preventivo/O1".into(),
            purged_hlc: "non-un-hlc".into(),
        });

        assert!(validate_snapshot(&snapshot).is_err());
    }

    #[test]
    fn latest_fonde_snapshot_offline_per_campo_senza_regredire() {
        let dir = tempfile::tempdir().unwrap();
        let a = SnapshotStore::new(dir.path(), "PC-A").unwrap();
        let b = SnapshotStore::new(dir.path(), "PC-B").unwrap();
        let mut snap_a = vuoto();
        snap_a.records.push(RawRecord {
            entity: "cliente".into(),
            id: "C1".into(),
            data: json!({"nome":"Vecchio", "telefono":"111"}).to_string(),
            deleted: false,
            created_hlc: "0000000000000001-00000000-PC-A".into(),
            updated_hlc: "000000000000001e-00000000-PC-A".into(),
        });
        snap_a.clocks.extend([
            RawClock {
                entity: "cliente".into(),
                id: "C1".into(),
                field: "nome".into(),
                hlc: "000000000000000a-00000000-PC-A".into(),
            },
            RawClock {
                entity: "cliente".into(),
                id: "C1".into(),
                field: "telefono".into(),
                hlc: "000000000000001e-00000000-PC-A".into(),
            },
        ]);
        snap_a.offsets.insert("PC-A.ndjson".into(), 120);
        snap_a.records.push(RawRecord {
            entity: "cliente".into(),
            id: "SOLO-A".into(),
            data: json!({"nome":"Visto soltanto da A"}).to_string(),
            deleted: false,
            created_hlc: "0000000000000002-00000000-PC-A".into(),
            updated_hlc: "0000000000000002-00000000-PC-A".into(),
        });

        let mut snap_b = vuoto();
        snap_b.records.push(RawRecord {
            entity: "cliente".into(),
            id: "C1".into(),
            data: json!({"nome":"Corretto", "email":"demo@example.invalid"}).to_string(),
            deleted: false,
            created_hlc: "0000000000000001-00000000-PC-A".into(),
            updated_hlc: "0000000000000014-00000000-PC-B".into(),
        });
        snap_b.clocks.extend([
            RawClock {
                entity: "cliente".into(),
                id: "C1".into(),
                field: "nome".into(),
                hlc: "0000000000000014-00000000-PC-B".into(),
            },
            RawClock {
                entity: "cliente".into(),
                id: "C1".into(),
                field: "email".into(),
                hlc: "000000000000000f-00000000-PC-B".into(),
            },
        ]);
        snap_b.offsets.insert("PC-B.ndjson".into(), 90);
        snap_b.records.push(RawRecord {
            entity: "cliente".into(),
            id: "SOLO-B".into(),
            data: json!({"nome":"Visto soltanto da B"}).to_string(),
            deleted: false,
            created_hlc: "0000000000000003-00000000-PC-B".into(),
            updated_hlc: "0000000000000003-00000000-PC-B".into(),
        });

        a.save(&snap_a, 1).unwrap();
        b.save(&snap_b, 1).unwrap();
        let merged = a.latest().unwrap().unwrap();
        let record = merged.records.iter().find(|r| r.id == "C1").unwrap();
        let data: serde_json::Value = serde_json::from_str(&record.data).unwrap();
        assert_eq!(
            data["nome"],
            json!("Corretto"),
            "vince il clock più recente"
        );
        assert_eq!(
            data["telefono"],
            json!("111"),
            "resta il campo visto solo da A"
        );
        assert_eq!(
            data["email"],
            json!("demo@example.invalid"),
            "resta il campo visto solo da B"
        );
        assert!(merged.records.iter().any(|record| record.id == "SOLO-A"));
        assert!(merged.records.iter().any(|record| record.id == "SOLO-B"));
        assert_eq!(merged.offsets.get("PC-A.ndjson"), Some(&0));
        assert_eq!(merged.offsets.get("PC-B.ndjson"), Some(&0));
    }

    #[test]
    fn latest_tiene_la_ricreazione_successiva_alla_tombstone() {
        let mut eliminato = vuoto();
        eliminato.purged.push(crate::projection::RawPurged {
            entity: "preventivo".into(),
            id: "preventivo/O1".into(),
            purged_hlc: "0000000000000010-00000000-PC-A".into(),
        });
        let mut ricreato = vuoto();
        ricreato.records.push(RawRecord {
            entity: "preventivo".into(),
            id: "preventivo/O1".into(),
            data: json!({"ordine_id":"O1"}).to_string(),
            deleted: false,
            created_hlc: "0000000000000020-00000000-PC-B".into(),
            updated_hlc: "0000000000000021-00000000-PC-B".into(),
        });
        ricreato.clocks.push(RawClock {
            entity: "preventivo".into(),
            id: "preventivo/O1".into(),
            field: "ordine_id".into(),
            hlc: "0000000000000021-00000000-PC-B".into(),
        });

        let merged = merge_snapshots(vec![eliminato, ricreato]).unwrap().unwrap();
        assert!(merged
            .records
            .iter()
            .any(|record| record.id == "preventivo/O1"));
        assert!(merged.purged.is_empty());
    }

    #[test]
    fn latest_distingue_ricreazione_da_record_vecchio_con_tombstone_legacy() {
        let mut eliminato = vuoto();
        eliminato
            .watermarks
            .insert("PC-A".into(), "0000000000000010-00000000-PC-A".into());
        eliminato.purged.push(crate::projection::RawPurged {
            entity: "preventivo".into(),
            id: "preventivo/O1".into(),
            purged_hlc: String::new(),
        });

        let mut vecchio = vuoto();
        vecchio.records.push(RawRecord {
            entity: "preventivo".into(),
            id: "preventivo/O1".into(),
            data: json!({"ordine_id":"VECCHIO"}).to_string(),
            deleted: false,
            created_hlc: "0000000000000005-00000000-PC-A".into(),
            updated_hlc: "0000000000000006-00000000-PC-A".into(),
        });

        let mut ricreato = vuoto();
        ricreato.records.push(RawRecord {
            entity: "preventivo".into(),
            id: "preventivo/O1".into(),
            data: json!({"ordine_id":"NUOVO"}).to_string(),
            deleted: false,
            created_hlc: "0000000000000020-00000000-PC-B".into(),
            updated_hlc: "0000000000000021-00000000-PC-B".into(),
        });

        let merged = merge_snapshots(vec![eliminato, vecchio, ricreato])
            .unwrap()
            .unwrap();
        let record = merged
            .records
            .iter()
            .find(|record| record.id == "preventivo/O1")
            .unwrap();
        let data: serde_json::Value = serde_json::from_str(&record.data).unwrap();
        assert_eq!(data["ordine_id"], json!("NUOVO"));
        assert!(merged.purged.is_empty());
    }

    #[test]
    fn latest_ignora_uno_snapshot_json_corrotto() {
        let dir = tempfile::tempdir().unwrap();
        let store = SnapshotStore::new(dir.path(), "PC-A").unwrap();
        store.save(&vuoto(), 1).unwrap();
        fs::write(dir.path().join("PC-B-00000001.json"), b"{non-json").unwrap();
        assert!(store.latest().unwrap().is_some());
    }
}
