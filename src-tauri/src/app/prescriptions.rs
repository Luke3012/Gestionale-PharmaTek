//! Ricerca locale delle prescrizioni e preparazione degli artefatti di produzione.
//! I percorsi restano esclusivamente nella configurazione/AppData del PC corrente.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use strsim::{levenshtein, normalized_levenshtein};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use super::communication::{AllegatoComunicazioneInput, DocumentoCacheSalvaInput};
use super::{es, nome_map, save_config, str_field, AppResult, AppState};

const INDEX_TTL: Duration = Duration::from_secs(5 * 60);
pub const MAX_ZIP_EMAIL_BYTES: u64 = 20 * 1024 * 1024;
const COPY_BUFFER_BYTES: usize = 256 * 1024;
const CANCELLED: &str = "operazione annullata";
const AUTO_MATCH_MAX_AGE_DAYS: i64 = 365;
const MINOR_TYPO_SCORE: f64 = 0.95;

static OPERATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

pub type PrescriptionProgress<'a> = dyn FnMut(&str, Option<u8>, u64, u64, &str) + 'a;

pub fn operation_start(id: &str) -> AppResult<Arc<AtomicBool>> {
    let id = id.trim();
    if id.is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
        return Err("identificatore operazione non valido".into());
    }
    let flag = Arc::new(AtomicBool::new(false));
    OPERATIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "operazioni prescrizioni non disponibili")?
        .insert(id.into(), flag.clone());
    Ok(flag)
}

pub fn operation_cancel(id: &str) -> bool {
    OPERATIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()
        .and_then(|operations| operations.get(id).cloned())
        .is_some_and(|flag| {
            flag.store(true, Ordering::Relaxed);
            true
        })
}

pub fn operation_finish(id: &str) {
    if let Ok(mut operations) = OPERATIONS.get_or_init(|| Mutex::new(HashMap::new())).lock() {
        operations.remove(id);
    }
}

fn ensure_not_cancelled(cancelled: &AtomicBool) -> AppResult<()> {
    if cancelled.load(Ordering::Relaxed) {
        Err(CANCELLED.into())
    } else {
        Ok(())
    }
}

#[derive(Clone)]
struct IndexedFile {
    path: PathBuf,
    name: String,
    normalized: String,
    mime: String,
    size: u64,
    modified_ms: u64,
    production_day: i64,
}

pub(super) struct PrescriptionIndex {
    root: PathBuf,
    scanned_at: Instant,
    files: Vec<IndexedFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrescriptionsFolderDto {
    pub path: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrescriptionFileDto {
    pub path: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub modified_ms: u64,
    pub confidence: String,
    pub score: f64,
    pub selected: bool,
    #[serde(skip)]
    production_day: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrescriptionPatientDto {
    pub key: String,
    pub name: String,
    pub product_count: usize,
    pub files: Vec<PrescriptionFileDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionPrescriptionScanDto {
    pub folder: String,
    pub lot: String,
    pub production_date: String,
    pub product_count: usize,
    pub has_immunotherapy: bool,
    pub has_diagnostics: bool,
    pub patients: Vec<PrescriptionPatientDto>,
    pub previous_send_ms: u64,
    pub previous_send_user: String,
    pub previous_send_device: String,
    pub previous_send_communication_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrescriptionSelectionInput {
    pub patient: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionAttachmentsDto {
    pub attachments: Vec<AllegatoComunicazioneInput>,
    pub zip_omitted_large: bool,
    pub production_date: String,
    pub product_count: usize,
}

#[derive(Clone)]
struct LotPatient {
    key: String,
    name: String,
    product_count: usize,
}

struct LotInfo {
    date: String,
    count: usize,
    has_immunotherapy: bool,
    has_diagnostics: bool,
    patients: Vec<LotPatient>,
    previous_send_ms: u64,
    previous_send_user: String,
    previous_send_device: String,
    previous_send_communication_id: String,
}

fn supported(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "pdf" => Some("application/pdf"),
        _ => None,
    }
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn scan_dir(
    dir: &Path,
    out: &mut Vec<IndexedFile>,
    cancelled: &AtomicBool,
    progress: &mut PrescriptionProgress<'_>,
) -> AppResult<()> {
    ensure_not_cancelled(cancelled)?;
    for entry in fs::read_dir(dir).map_err(es)? {
        ensure_not_cancelled(cancelled)?;
        let entry = entry.map_err(es)?;
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            scan_dir(&path, out, cancelled, progress)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let Some(mime) = supported(&path) else {
            continue;
        };
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Documento")
            .to_string();
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        out.push(IndexedFile {
            production_day: production_day(&path, modified_ms(&meta)),
            path,
            name,
            normalized: normalize(&stem),
            mime: mime.into(),
            size: meta.len(),
            modified_ms: modified_ms(&meta),
        });
        if out.len().is_multiple_of(50) {
            let percent = 8 + ((out.len() / 50).min(18) as u8 * 2);
            progress(
                "indexing",
                Some(percent),
                out.len() as u64,
                0,
                "Sto cercando tra le varie produzioni…",
            );
        }
    }
    Ok(())
}

fn normalize(value: &str) -> String {
    let folded: String = value
        .nfkd()
        .filter(|value| !is_combining_mark(*value))
        .flat_map(char::to_lowercase)
        .map(|value| if value.is_alphanumeric() { value } else { ' ' })
        .collect();
    folded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn reverse_words(value: &str) -> String {
    value.split_whitespace().rev().collect::<Vec<_>>().join(" ")
}

fn meaningful_tokens(value: &str) -> Vec<&str> {
    value
        .split_whitespace()
        .filter(|token| !token.chars().all(|value| value.is_ascii_digit()))
        .filter(|token| {
            !matches!(
                *token,
                "prescrizione"
                    | "prescrizioni"
                    | "terapia"
                    | "terapie"
                    | "sottocutanea"
                    | "sublinguale"
                    | "vaccino"
                    | "vaccini"
                    | "produzione"
                    | "foto"
                    | "immagine"
                    | "documento"
            )
        })
        .collect()
}

fn contains_same_tokens(patient: &str, file: &str) -> bool {
    let patient_tokens = meaningful_tokens(patient);
    let mut file_tokens = meaningful_tokens(file);
    patient_tokens.iter().all(|patient_token| {
        file_tokens
            .iter()
            .position(|file_token| file_token == patient_token)
            .map(|index| {
                file_tokens.remove(index);
                true
            })
            .unwrap_or(false)
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NameMatch {
    None,
    Exact,
    MinorTypo,
}

fn contains_same_tokens_with_minor_typo(patient: &str, file: &str) -> bool {
    let patient_tokens = meaningful_tokens(patient);
    let file_tokens = meaningful_tokens(file);
    if patient_tokens.is_empty() || patient_tokens.len() != file_tokens.len() {
        return false;
    }

    let mut used = vec![false; file_tokens.len()];
    for patient_token in patient_tokens {
        let exact = file_tokens
            .iter()
            .enumerate()
            .find(|(index, file_token)| !used[*index] && **file_token == patient_token)
            .map(|(index, _)| index);
        let index = exact.or_else(|| {
            if patient_token.chars().count() < 4 {
                return None;
            }
            file_tokens
                .iter()
                .enumerate()
                .find(|(index, file_token)| {
                    !used[*index]
                        && file_token.chars().count() >= 4
                        && levenshtein(patient_token, file_token) <= 1
                })
                .map(|(index, _)| index)
        });
        let Some(index) = index else {
            return false;
        };
        used[index] = true;
    }
    true
}

fn classify_name(patient: &str, file: &str) -> (f64, NameMatch) {
    if patient.is_empty() || file.is_empty() {
        return (0.0, NameMatch::None);
    }
    let reverse = reverse_words(patient);
    if file.contains(patient)
        || (reverse != patient && file.contains(&reverse))
        || contains_same_tokens(patient, file)
    {
        return (1.0, NameMatch::Exact);
    }
    if contains_same_tokens_with_minor_typo(patient, file) {
        return (MINOR_TYPO_SCORE, NameMatch::MinorTypo);
    }
    let patient_words = patient.split_whitespace().count().max(1);
    let words = file.split_whitespace().collect::<Vec<_>>();
    let mut best: f64 = 0.0;
    for width in patient_words.saturating_sub(1).max(1)..=(patient_words + 1).min(words.len()) {
        for window in words.windows(width) {
            let candidate = window.join(" ");
            best = best
                .max(normalized_levenshtein(patient, &candidate))
                .max(normalized_levenshtein(&reverse, &candidate));
        }
    }
    (best, NameMatch::None)
}

#[cfg(test)]
fn score_name(patient: &str, file: &str) -> (f64, bool) {
    let (score, kind) = classify_name(patient, file);
    (score, kind == NameMatch::Exact)
}

fn valid_date(year: i32, month: u32, day: u32) -> bool {
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=max_day).contains(&day)
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - i32::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let shifted_month = month as i32 + if month > 2 { -3 } else { 9 };
    let doy = (153 * shifted_month + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146_097 + doe - 719_468) as i64
}

fn ancestor_year(path: &Path) -> Option<i32> {
    path.ancestors()
        .flat_map(|ancestor| ancestor.file_name())
        .filter_map(|part| part.to_str())
        .flat_map(|part| {
            normalize(part)
                .split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .find_map(|token| {
            token
                .parse::<i32>()
                .ok()
                .filter(|year| (2000..=2099).contains(year))
        })
}

fn date_from_name(path: &Path) -> Option<(i32, u32, u32)> {
    let stem = path.file_stem()?.to_str()?;
    let normalized = normalize(stem);
    let tokens = normalized.split_whitespace().collect::<Vec<_>>();
    let parent_year = ancestor_year(path);
    for (position, window) in tokens.windows(2).enumerate() {
        let Ok(day) = window[0].parse::<u32>() else {
            continue;
        };
        let Ok(month) = window[1].parse::<u32>() else {
            continue;
        };
        let explicit_year = tokens.get(position + 2).and_then(|value| {
            if value.len() == 2 {
                value.parse::<i32>().ok().map(|year| 2000 + year)
            } else if value.len() == 4 {
                value.parse::<i32>().ok()
            } else {
                None
            }
        });
        let Some(year) = explicit_year.or(parent_year) else {
            continue;
        };
        if valid_date(year, month, day) {
            return Some((year, month, day));
        }
    }
    None
}

fn production_day(path: &Path, modified_ms: u64) -> i64 {
    date_from_name(path)
        .map(|(year, month, day)| days_from_civil(year, month, day))
        .unwrap_or_else(|| (modified_ms / 86_400_000) as i64)
}

fn parse_lot_day(value: &str) -> Option<i64> {
    let parts = normalize(value)
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    if parts.len() < 3 {
        return None;
    }
    let (year, month, day) = if parts[0].len() == 4 {
        (
            parts[0].parse::<i32>().ok()?,
            parts[1].parse::<u32>().ok()?,
            parts[2].parse::<u32>().ok()?,
        )
    } else {
        let short_or_full_year = parts[2].parse::<i32>().ok()?;
        (
            if parts[2].len() == 2 {
                2000 + short_or_full_year
            } else {
                short_or_full_year
            },
            parts[1].parse::<u32>().ok()?,
            parts[0].parse::<u32>().ok()?,
        )
    };
    valid_date(year, month, day).then(|| days_from_civil(year, month, day))
}

fn today_day() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| (value.as_secs() / 86_400) as i64)
        .unwrap_or(0)
}

fn lot_reference_day(value: &str, fallback_day: i64) -> i64 {
    parse_lot_day(value).unwrap_or(fallback_day)
}

fn is_recent_for_lot(file_day: i64, lot_day: i64) -> bool {
    file_day >= lot_day.saturating_sub(AUTO_MATCH_MAX_AGE_DAYS)
}

fn discover_folder() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for key in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(value) = std::env::var_os(key) {
            candidates.push(PathBuf::from(value).join("Prescrizioni"));
        }
    }
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        candidates.push(PathBuf::from(profile).join("OneDrive").join("Prescrizioni"));
    }
    candidates.into_iter().find(|path| path.is_dir())
}

fn safe_component(value: &str, fallback: &str) -> String {
    let mut result = value
        .chars()
        .map(|value| {
            if value.is_control()
                || matches!(value, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '-'
            } else {
                value
            }
        })
        .take(120)
        .collect::<String>();
    result = result.trim_matches([' ', '.', '-']).to_string();
    if result.is_empty() {
        return fallback.into();
    }
    let stem = result
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|number| {
                matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            });
    if reserved {
        result.insert(0, '_');
    }
    result
}

impl AppState {
    pub fn prescriptions_folder_get(&self) -> AppResult<PrescriptionsFolderDto> {
        let mut config = self.config();
        let current = config
            .prescriptions_dir
            .as_deref()
            .map(PathBuf::from)
            .filter(|path| path.is_dir());
        let path = current.or_else(discover_folder);
        if let Some(path) = path {
            let value = path.to_string_lossy().into_owned();
            if config.prescriptions_dir.as_deref() != Some(value.as_str()) {
                config.prescriptions_dir = Some(value.clone());
                save_config(&self.app_dir, &config)?;
                *self
                    .config
                    .lock()
                    .map_err(|_| "configurazione non disponibile")? = config;
            }
            return Ok(PrescriptionsFolderDto {
                path: value,
                available: true,
            });
        }
        Ok(PrescriptionsFolderDto {
            path: String::new(),
            available: false,
        })
    }

    pub fn prescriptions_folder_set(&self, path: &str) -> AppResult<PrescriptionsFolderDto> {
        let canonical = fs::canonicalize(path)
            .map_err(|_| "la cartella Prescrizioni non è accessibile".to_string())?;
        if !canonical.is_dir() {
            return Err("seleziona una cartella valida".into());
        }
        let value = canonical.to_string_lossy().into_owned();
        let mut config = self.config();
        config.prescriptions_dir = Some(value.clone());
        save_config(&self.app_dir, &config)?;
        *self
            .config
            .lock()
            .map_err(|_| "configurazione non disponibile")? = config;
        *self
            .prescriptions_index
            .lock()
            .map_err(|_| "indice prescrizioni non disponibile")? = None;
        Ok(PrescriptionsFolderDto {
            path: value,
            available: true,
        })
    }

    fn indexed_files(
        &self,
        root: &Path,
        force_refresh: bool,
        cancelled: &AtomicBool,
        progress: &mut PrescriptionProgress<'_>,
    ) -> AppResult<Vec<IndexedFile>> {
        let mut cache = self
            .prescriptions_index
            .lock()
            .map_err(|_| "indice prescrizioni non disponibile")?;
        if !force_refresh {
            if let Some(index) = cache.as_ref() {
                if index.root == root && index.scanned_at.elapsed() < INDEX_TTL {
                    return Ok(index.files.clone());
                }
            }
        }
        let mut files = Vec::new();
        scan_dir(root, &mut files, cancelled, progress)?;
        ensure_not_cancelled(cancelled)?;
        *cache = Some(PrescriptionIndex {
            root: root.to_path_buf(),
            scanned_at: Instant::now(),
            files: files.clone(),
        });
        Ok(files)
    }

    fn lot_info(&self, lot: &str, validate_complete: bool) -> AppResult<LotInfo> {
        if lot.trim().is_empty() {
            return Err("lotto non valido".into());
        }
        self.with_engine(|engine| engine.with_projection(|projection| {
            let orders = projection.list("ordine").unwrap_or_default().into_iter()
                .filter(|record| !record.deleted)
                .map(|record| (record.id.clone(), record))
                .collect::<HashMap<_, _>>();
            let clients = nome_map(projection, "cliente");
            let rows = projection.list("riga_ordine").unwrap_or_default().into_iter()
                .filter(|record| !record.deleted && str_field(&record.data, "lotto_produzione") == lot)
                .collect::<Vec<_>>();
            if rows.is_empty() { return Err("il lotto non è più disponibile".into()); }
            let mut patients = BTreeMap::<String, LotPatient>::new();
            let mut date = String::new();
            let mut has_immunotherapy = false;
            let mut has_diagnostics = false;
            let mut previous_send_ms = 0;
            let mut previous_send_user = String::new();
            let mut previous_send_device = String::new();
            let mut previous_send_communication_id = String::new();
            for row in &rows {
                let order_id = str_field(&row.data, "ordine_id");
                let order = orders.get(&order_id).ok_or("un ordine del lotto non è più disponibile")?;
                let category = str_field(&order.data, "categoria");
                let diagnostic = category == "Diagnostica";
                has_diagnostics |= diagnostic;
                if !diagnostic && category != "Keriba" {
                    has_immunotherapy = true;
                    if validate_complete {
                        let allergens = row.data.get("allergeni").and_then(|value| value.as_array()).map(|value| !value.is_empty()).unwrap_or(false);
                        if str_field(&row.data, "formulazione").trim().is_empty()
                            || str_field(&row.data, "posologia").trim().is_empty()
                            || !allergens
                        {
                            return Err("tutti i dati Immunoterapia devono essere completi prima dell’invio".into());
                        }
                    }
                    let patient_name = {
                        let patient = str_field(&row.data, "paziente");
                        if patient.trim().is_empty() {
                            clients.get(&str_field(&order.data, "cliente_id")).cloned().unwrap_or_default()
                        } else { patient.trim().to_string() }
                    };
                    let key = normalize(&patient_name);
                    if !key.is_empty() {
                        patients.entry(key.clone()).and_modify(|value| value.product_count += 1).or_insert(LotPatient { key, name: patient_name, product_count: 1 });
                    }
                }
                if date.is_empty() { date = str_field(&row.data, "data_produzione"); }
                let sent_lot = str_field(&row.data, "ultimo_invio_laboratorio_lotto");
                let sent_ms = row.data.get("ultimo_invio_laboratorio_ms").and_then(|value| value.as_u64()).unwrap_or(0);
                if sent_lot == lot && sent_ms >= previous_send_ms {
                    previous_send_ms = sent_ms;
                    previous_send_user = str_field(&row.data, "ultimo_invio_laboratorio_utente");
                    previous_send_device = str_field(&row.data, "ultimo_invio_laboratorio_dispositivo");
                    previous_send_communication_id = str_field(&row.data, "ultimo_invio_laboratorio_comunicazione_id");
                }
            }
            Ok(LotInfo { date, count: rows.len(), has_immunotherapy, has_diagnostics, patients: patients.into_values().collect(), previous_send_ms, previous_send_user, previous_send_device, previous_send_communication_id })
        }))
    }

    pub fn prescriptions_scan_lot(
        &self,
        lot: &str,
        force_refresh: bool,
        cancelled: &AtomicBool,
        progress: &mut PrescriptionProgress<'_>,
    ) -> AppResult<ProductionPrescriptionScanDto> {
        progress(
            "preparing",
            Some(8),
            0,
            0,
            "Sto cercando tra le varie produzioni…",
        );
        ensure_not_cancelled(cancelled)?;
        let info = self.lot_info(lot, false)?;
        if !info.has_immunotherapy {
            progress(
                "complete",
                Some(100),
                0,
                0,
                "Il lotto non richiede prescrizioni.",
            );
            return Ok(ProductionPrescriptionScanDto {
                folder: String::new(),
                lot: lot.into(),
                production_date: info.date,
                product_count: info.count,
                has_immunotherapy: false,
                has_diagnostics: info.has_diagnostics,
                patients: Vec::new(),
                previous_send_ms: info.previous_send_ms,
                previous_send_user: info.previous_send_user,
                previous_send_device: info.previous_send_device,
                previous_send_communication_id: info.previous_send_communication_id,
            });
        }
        let folder = self.prescriptions_folder_get()?;
        if !folder.available {
            return Err("seleziona la cartella Prescrizioni".into());
        }
        let files =
            self.indexed_files(Path::new(&folder.path), force_refresh, cancelled, progress)?;
        let lot_day = lot_reference_day(&info.date, today_day());
        let mut grouped = vec![Vec::<PrescriptionFileDto>::new(); info.patients.len()];
        for (file_index, file) in files.iter().enumerate() {
            ensure_not_cancelled(cancelled)?;
            // I documenti oltre il limite restano disponibili soltanto tramite
            // selezione manuale e non possono influenzare il matching automatico.
            if is_recent_for_lot(file.production_day, lot_day) {
                let scores = info
                    .patients
                    .iter()
                    .map(|patient| classify_name(&patient.key, &file.normalized))
                    .collect::<Vec<_>>();
                let exact = scores
                    .iter()
                    .enumerate()
                    .filter(|(_, (_, kind))| *kind == NameMatch::Exact)
                    .map(|(index, _)| index)
                    .collect::<Vec<_>>();
                let selected_patient = if exact.len() == 1 {
                    Some((exact[0], "exact", 1.0))
                } else if exact.is_empty() {
                    let mut ranked = scores
                        .iter()
                        .enumerate()
                        .map(|(index, (score, kind))| (index, *score, *kind))
                        .collect::<Vec<_>>();
                    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
                    let best = ranked.first().copied();
                    let second = ranked.get(1).map(|value| value.1).unwrap_or(0.0);
                    best.filter(|(_, score, kind)| {
                        (*kind == NameMatch::MinorTypo || *score >= 0.92) && *score - second >= 0.08
                    })
                    .map(|(index, score, kind)| {
                        (
                            index,
                            "fuzzy",
                            if kind == NameMatch::MinorTypo {
                                MINOR_TYPO_SCORE
                            } else {
                                score
                            },
                        )
                    })
                } else {
                    None
                };
                if let Some((patient_index, confidence, score)) = selected_patient {
                    grouped[patient_index].push(file_dto(file, confidence, score, true));
                }
            }
            if file_index % 50 == 0 || file_index + 1 == files.len() {
                let percent = 45 + (((file_index + 1) * 50) / files.len().max(1)) as u8;
                progress(
                    "matching",
                    Some(percent),
                    (file_index + 1) as u64,
                    files.len() as u64,
                    "Sto cercando tra le varie produzioni…",
                );
            }
        }
        let mut patients = info
            .patients
            .into_iter()
            .enumerate()
            .map(|(index, patient)| {
                let mut files = std::mem::take(&mut grouped[index]);
                retain_latest_production(&mut files);
                files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then(a.name.cmp(&b.name)));
                PrescriptionPatientDto {
                    key: patient.key,
                    name: patient.name,
                    product_count: patient.product_count,
                    files,
                }
            })
            .collect::<Vec<_>>();
        patients.sort_by(|a, b| {
            let missing_a = !a.files.iter().any(|file| file.selected);
            let missing_b = !b.files.iter().any(|file| file.selected);
            missing_b
                .cmp(&missing_a)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        progress(
            "complete",
            Some(100),
            files.len() as u64,
            files.len() as u64,
            "Ricerca completata.",
        );
        Ok(ProductionPrescriptionScanDto {
            folder: folder.path,
            lot: lot.into(),
            production_date: info.date,
            product_count: info.count,
            has_immunotherapy: info.has_immunotherapy,
            has_diagnostics: info.has_diagnostics,
            patients,
            previous_send_ms: info.previous_send_ms,
            previous_send_user: info.previous_send_user,
            previous_send_device: info.previous_send_device,
            previous_send_communication_id: info.previous_send_communication_id,
        })
    }

    pub fn prescriptions_inspect_files(
        &self,
        paths: &[String],
    ) -> AppResult<Vec<PrescriptionFileDto>> {
        let mut result = Vec::new();
        for value in paths {
            let path = fs::canonicalize(value)
                .map_err(|_| format!("il file «{value}» non è accessibile"))?;
            let mime = supported(&path).ok_or("sono ammessi soltanto JPG, JPEG, PNG e PDF")?;
            let meta = fs::metadata(&path).map_err(es)?;
            if !meta.is_file() || meta.len() == 0 {
                return Err("il documento selezionato è vuoto o non valido".into());
            }
            result.push(PrescriptionFileDto {
                path: path.to_string_lossy().into_owned(),
                name: path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Documento")
                    .into(),
                mime: mime.into(),
                size: meta.len(),
                modified_ms: modified_ms(&meta),
                confidence: "manual".into(),
                score: 1.0,
                selected: true,
                production_day: production_day(&path, modified_ms(&meta)),
            });
        }
        Ok(result)
    }

    pub fn prescription_open(&self, path: &str) -> AppResult<()> {
        let path =
            fs::canonicalize(path).map_err(|_| "il documento non è più accessibile".to_string())?;
        supported(&path).ok_or("formato prescrizione non supportato")?;
        if !path.is_file() {
            return Err("il documento non è più accessibile".into());
        }
        crate::platform::apri_file_sistema(&path)
    }

    pub fn prescriptions_zip_save(
        &self,
        lot: &str,
        selections: &[PrescriptionSelectionInput],
        output: &str,
        cancelled: &AtomicBool,
        progress: &mut PrescriptionProgress<'_>,
    ) -> AppResult<u64> {
        progress(
            "preparing",
            Some(2),
            0,
            0,
            "Preparo i documenti selezionati…",
        );
        ensure_not_cancelled(cancelled)?;
        let info = self.lot_info(lot, false)?;
        ensure_patient_selections(&info, selections)?;
        let total = selected_source_size(selections)?;
        let output = PathBuf::from(output);
        let parent = output.parent().ok_or("destinazione ZIP non valida")?;
        if !parent.is_dir() {
            return Err("la cartella di destinazione non esiste".into());
        }
        let temp = parent.join(format!(
            ".{}.{}.tmp",
            output
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("prescrizioni.zip"),
            ulid::Ulid::generate()
        ));
        let result = (|| {
            let file = File::create(&temp).map_err(es)?;
            let mut writer = ZipWriter::new(file);
            write_zip_progress(&mut writer, selections, total, cancelled, progress)?;
            ensure_not_cancelled(cancelled)?;
            progress(
                "validating",
                Some(96),
                total,
                total,
                "Verifico l’archivio creato…",
            );
            let file = writer.finish().map_err(es)?;
            file.sync_all().map_err(es)?;
            validate_zip(&temp)?;
            if output.exists() {
                fs::remove_file(&output).map_err(es)?;
            }
            fs::rename(&temp, &output).map_err(es)?;
            let size = fs::metadata(&output).map(|value| value.len()).map_err(es)?;
            progress("complete", Some(100), total, total, "ZIP completato.");
            Ok(size)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }

    pub fn production_attachments_prepare(
        &self,
        lot: &str,
        selections: &[PrescriptionSelectionInput],
        include_zip: bool,
        base: i64,
        cancelled: &AtomicBool,
        progress: &mut PrescriptionProgress<'_>,
    ) -> AppResult<ProductionAttachmentsDto> {
        progress(
            "preparing",
            Some(2),
            0,
            0,
            "Preparazione file di produzione…",
        );
        ensure_not_cancelled(cancelled)?;
        crate::premium::ensure_access(self)?;
        let info = self.lot_info(lot, true)?;
        if include_zip {
            ensure_patient_selections(&info, selections)?;
        }
        let suffix = ulid::Ulid::generate().to_string();
        let preparation_root = self.app_dir.join("production-preparation");
        fs::create_dir_all(&preparation_root).map_err(es)?;
        let dir = preparation_root.join(&suffix);
        fs::create_dir(&dir).map_err(es)?;
        let mut attachments = Vec::new();
        let preparation = (|| -> AppResult<bool> {
            if info.has_immunotherapy {
                ensure_not_cancelled(cancelled)?;
                progress("excel", Some(8), 0, 0, "Preparazione file Excel…");
                let path = dir.join(format!("laboratorio-{suffix}.xlsx"));
                let generated = self
                    .laboratorio_export(lot, path.to_string_lossy().as_ref(), base, "")
                    .and_then(|_| fs::read(&path).map_err(es));
                let _ = fs::remove_file(&path);
                attachments.push(self.documento_cache_salva(DocumentoCacheSalvaInput {
                    nome: format!("Laboratorio {}.xlsx", info.date),
                    mime:
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into(),
                    dati: generated?,
                })?);
            }
            if info.has_diagnostics {
                ensure_not_cancelled(cancelled)?;
                progress("excel", Some(18), 0, 0, "Creo l’Excel Diagnostica…");
                let path = dir.join(format!("diagnostica-{suffix}.xlsx"));
                let generated = self
                    .diagnostica_export(lot, path.to_string_lossy().as_ref())
                    .and_then(|_| fs::read(&path).map_err(es));
                let _ = fs::remove_file(&path);
                attachments.push(self.documento_cache_salva(DocumentoCacheSalvaInput {
                    nome: format!("Diagnostica {}.xlsx", info.date),
                    mime:
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into(),
                    dati: generated?,
                })?);
            }
            if !include_zip {
                progress("complete", Some(100), 0, 0, "Allegati pronti.");
                return Ok(false);
            }
            let total = selected_source_size(selections)?;
            if total > MAX_ZIP_EMAIL_BYTES {
                progress(
                    "complete",
                    Some(100),
                    total,
                    total,
                    "Allegati pronti senza ZIP.",
                );
                return Ok(true);
            }
            let cursor = Cursor::new(Vec::new());
            let mut writer = ZipWriter::new(cursor);
            write_zip_progress(&mut writer, selections, total, cancelled, progress)?;
            ensure_not_cancelled(cancelled)?;
            let data = writer.finish().map_err(es)?.into_inner();
            if data.len() as u64 > MAX_ZIP_EMAIL_BYTES {
                progress(
                    "complete",
                    Some(100),
                    total,
                    total,
                    "Allegati pronti senza ZIP.",
                );
                return Ok(true);
            }
            attachments.push(self.documento_cache_salva(DocumentoCacheSalvaInput {
                nome: format!("Prescrizioni {}.zip", info.date),
                mime: "application/zip".into(),
                dati: data,
            })?);
            progress("complete", Some(100), total, total, "Allegati pronti.");
            Ok(false)
        })();
        // Gli XLSX intermedi sono isolati in AppData e rimossi anche in caso
        // di errore o annullamento. Non vengono mai scritti nella cartella
        // condivisa del gestionale né nella cartella Prescrizioni.
        let _ = fs::remove_dir_all(&dir);
        let zip_omitted_large = match preparation {
            Ok(value) => value,
            Err(error) => {
                let _ = self.documenti_cache_rilascia_con_policy(&attachments, true);
                return Err(error);
            }
        };
        Ok(ProductionAttachmentsDto {
            attachments,
            zip_omitted_large,
            production_date: info.date,
            product_count: info.count,
        })
    }
}

fn retain_latest_production(files: &mut Vec<PrescriptionFileDto>) {
    if let Some(latest) = files.iter().map(|file| file.production_day).max() {
        files.retain(|file| file.production_day == latest);
    }
}

fn ensure_patient_selections(
    info: &LotInfo,
    selections: &[PrescriptionSelectionInput],
) -> AppResult<()> {
    let mut selected = HashSet::new();
    for selection in selections {
        if !selection.paths.is_empty() {
            selected.insert(normalize(&selection.patient));
        }
    }
    if info
        .patients
        .iter()
        .any(|patient| !selected.contains(&patient.key))
    {
        return Err(
            "seleziona almeno una prescrizione per ogni paziente oppure disattiva lo ZIP".into(),
        );
    }
    Ok(())
}

fn file_dto(
    file: &IndexedFile,
    confidence: &str,
    score: f64,
    selected: bool,
) -> PrescriptionFileDto {
    PrescriptionFileDto {
        path: file.path.to_string_lossy().into_owned(),
        name: file.name.clone(),
        mime: file.mime.clone(),
        size: file.size,
        modified_ms: file.modified_ms,
        confidence: confidence.into(),
        score,
        selected,
        production_day: file.production_day,
    }
}

fn selected_source_size(selections: &[PrescriptionSelectionInput]) -> AppResult<u64> {
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for selection in selections {
        for value in &selection.paths {
            let path = fs::canonicalize(value)
                .map_err(|_| format!("il file «{value}» non è più accessibile"))?;
            if seen.insert(path.clone()) {
                supported(&path).ok_or("formato prescrizione non supportato")?;
                total = total.saturating_add(fs::metadata(path).map_err(es)?.len());
            }
        }
    }
    Ok(total)
}

fn write_zip_progress<W: Write + io::Seek>(
    writer: &mut ZipWriter<W>,
    selections: &[PrescriptionSelectionInput],
    total_bytes: u64,
    cancelled: &AtomicBool,
    progress: &mut PrescriptionProgress<'_>,
) -> AppResult<()> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(1));
    let mut seen_paths = HashSet::new();
    let mut seen_names = HashSet::new();
    let mut written = 0usize;
    let mut copied = 0u64;
    let mut buffer = vec![0u8; COPY_BUFFER_BYTES];
    for selection in selections {
        for value in &selection.paths {
            ensure_not_cancelled(cancelled)?;
            let path = fs::canonicalize(value)
                .map_err(|_| format!("il file «{value}» non è più accessibile"))?;
            if !seen_paths.insert(path.clone()) {
                continue;
            }
            supported(&path).ok_or("formato prescrizione non supportato")?;
            let original = safe_component(
                path.file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Documento"),
                "Documento",
            );
            let stem = Path::new(&original)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Documento");
            let ext = Path::new(&original)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            let mut index = 1;
            let entry = loop {
                let file = if index == 1 {
                    original.clone()
                } else if ext.is_empty() {
                    format!("{stem} ({index})")
                } else {
                    format!("{stem} ({index}).{ext}")
                };
                if seen_names.insert(file.to_lowercase()) {
                    break file;
                }
                index += 1;
            };
            writer.start_file(entry, options).map_err(es)?;
            let mut source = File::open(path).map_err(es)?;
            loop {
                ensure_not_cancelled(cancelled)?;
                let read = source.read(&mut buffer).map_err(es)?;
                if read == 0 {
                    break;
                }
                writer.write_all(&buffer[..read]).map_err(es)?;
                copied = copied.saturating_add(read as u64);
                let percent = 20 + ((copied.saturating_mul(74) / total_bytes.max(1)) as u8);
                progress(
                    "archiving",
                    Some(percent.min(94)),
                    copied,
                    total_bytes,
                    "Creazione archivio ZIP in corso…",
                );
            }
            written += 1;
        }
    }
    if written == 0 {
        return Err("nessuna prescrizione selezionata".into());
    }
    Ok(())
}

#[cfg(test)]
fn write_zip<W: Write + io::Seek>(
    writer: &mut ZipWriter<W>,
    selections: &[PrescriptionSelectionInput],
) -> AppResult<()> {
    let cancelled = AtomicBool::new(false);
    let total = selected_source_size(selections)?;
    write_zip_progress(
        writer,
        selections,
        total,
        &cancelled,
        &mut |_, _, _, _, _| {},
    )
}

fn validate_zip(path: &Path) -> AppResult<()> {
    let file = File::open(path).map_err(es)?;
    let mut archive = ZipArchive::new(file).map_err(es)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(es)?;
        io::copy(&mut entry, &mut io::sink()).map_err(es)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn normalization_and_reversed_names_match() {
        assert_eq!(normalize("15-09 Pàziente, Tèst"), "15 09 paziente test");
        assert_eq!(
            score_name("test patient", "15 09 patient test terapia"),
            (1.0, true)
        );
        assert_eq!(
            score_name("alpha beta gamma", "31 08 prescrizione gamma alpha beta"),
            (1.0, true)
        );
        assert_eq!(score_name("alpha beta", "26 06 alpha beta 2"), (1.0, true));
    }

    #[test]
    fn production_date_uses_filename_then_ancestor_year() {
        let path = Path::new(r"C:\Prescrizioni\2026\Agosto\31_08 prescrizione.pdf");
        assert_eq!(date_from_name(path), Some((2026, 8, 31)));
        let explicit = Path::new(r"C:\Prescrizioni\cliente 25_09_24.pdf");
        assert_eq!(date_from_name(explicit), Some((2024, 9, 25)));
    }

    #[test]
    fn latest_production_keeps_every_file_from_the_same_day() {
        let file = |name: &str, day: i64| PrescriptionFileDto {
            path: name.into(),
            name: name.into(),
            mime: "image/jpeg".into(),
            size: 1,
            modified_ms: 0,
            confidence: "exact".into(),
            score: 1.0,
            selected: true,
            production_day: day,
        };
        let mut files = vec![
            file("precedente.jpg", 10),
            file("alpha beta.jpg", 20),
            file("alpha beta 2.jpg", 20),
        ];
        retain_latest_production(&mut files);
        assert_eq!(files.len(), 2);
        assert!(files.iter().all(|value| value.production_day == 20));
    }

    #[test]
    fn metadata_scan_does_not_require_decoding_document_contents() {
        let temp = tempdir().unwrap();
        fs::write(temp.path().join("31_08 TEST PATIENT.jpg"), b"not an image").unwrap();
        let cancelled = AtomicBool::new(false);
        let mut files = Vec::new();
        scan_dir(temp.path(), &mut files, &cancelled, &mut |_, _, _, _, _| {}).unwrap();
        assert_eq!(files.len(), 1);
    }

    #[test]
    fn typo_can_reach_high_confidence() {
        let (score, exact) = score_name("alpha bravo", "15 09 alpha brvo");
        assert!(!exact);
        assert!(score >= 0.92);
    }

    #[test]
    fn minor_name_typo_matches_all_numbered_files_from_the_same_day() {
        for name in [
            "11 12 DELTA KAPAA",
            "11 12 DELTA KAPAA 1",
            "11 12 DELTA KAPAA 2",
        ] {
            let (score, exact) = score_name("delta kappa", &normalize(name));
            assert!(!exact);
            assert_eq!(score, MINOR_TYPO_SCORE);
            assert_eq!(
                classify_name("delta kappa", &normalize(name)).1,
                NameMatch::MinorTypo
            );
        }
    }

    #[test]
    fn minor_typo_matching_is_order_independent_and_not_name_specific() {
        for (patient, file) in [
            ("alpha bravo", "bravo alphi"),
            ("charlie delta", "deltu charlie"),
            ("echo foxtrot", "foxtrot ecko 2"),
            ("golf hotel", "gotf hotel"),
            ("india juliet", "juliet indio"),
        ] {
            let normalized = normalize(file);
            let (score, exact) = score_name(patient, &normalized);
            assert!(!exact);
            assert_eq!(score, MINOR_TYPO_SCORE);
            assert_eq!(classify_name(patient, &normalized).1, NameMatch::MinorTypo);
        }
    }

    #[test]
    fn old_documents_are_blocked_only_from_automatic_selection() {
        let lot_day = days_from_civil(2026, 9, 16);
        assert!(is_recent_for_lot(
            lot_day - AUTO_MATCH_MAX_AGE_DAYS,
            lot_day
        ));
        assert!(!is_recent_for_lot(
            lot_day - AUTO_MATCH_MAX_AGE_DAYS - 1,
            lot_day
        ));
    }

    #[test]
    fn lot_date_parsing_and_today_fallback_are_deterministic() {
        let expected = days_from_civil(2026, 9, 16);
        assert_eq!(parse_lot_day("2026-09-16"), Some(expected));
        assert_eq!(parse_lot_day("16/09/2026"), Some(expected));
        assert_eq!(lot_reference_day("", 42), 42);
        assert_eq!(lot_reference_day("data non valida", 42), 42);
    }

    #[test]
    fn unsafe_components_are_sanitized() {
        assert_eq!(safe_component("A/B:C", "x"), "A-B-C");
        assert_eq!(safe_component("CON.pdf", "x"), "_CON.pdf");
        assert_eq!(safe_component("lpt9", "x"), "_lpt9");
    }

    #[test]
    fn zip_is_flat_and_deduplicates_the_same_source() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("terapia.pdf");
        fs::write(&source, b"%PDF-1.4 test").unwrap();
        let selections = vec![
            PrescriptionSelectionInput {
                patient: "Test/Patient".into(),
                paths: vec![source.to_string_lossy().into_owned()],
            },
            PrescriptionSelectionInput {
                patient: "Altro".into(),
                paths: vec![source.to_string_lossy().into_owned()],
            },
        ];
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        write_zip(&mut writer, &selections).unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert_eq!(archive.len(), 1);
        assert_eq!(archive.by_index(0).unwrap().name(), "terapia.pdf");
    }

    #[test]
    fn zip_numbers_flat_name_collisions() {
        let temp = tempdir().unwrap();
        let first_dir = temp.path().join("prima");
        let second_dir = temp.path().join("seconda");
        fs::create_dir_all(&first_dir).unwrap();
        fs::create_dir_all(&second_dir).unwrap();
        let first = first_dir.join("terapia.pdf");
        let second = second_dir.join("terapia.pdf");
        fs::write(&first, b"%PDF-1.4 first").unwrap();
        fs::write(&second, b"%PDF-1.4 second").unwrap();
        let selections = vec![PrescriptionSelectionInput {
            patient: "Test Patient".into(),
            paths: vec![
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ],
        }];
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        write_zip(&mut writer, &selections).unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert_eq!(archive.len(), 2);
        assert_eq!(archive.by_index(0).unwrap().name(), "terapia.pdf");
        assert_eq!(archive.by_index(1).unwrap().name(), "terapia (2).pdf");
    }

    #[test]
    fn zip_copy_honours_cancellation_between_chunks() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("terapia.pdf");
        fs::write(&source, vec![b'x'; COPY_BUFFER_BYTES * 2]).unwrap();
        let selections = vec![PrescriptionSelectionInput {
            patient: "Test Patient".into(),
            paths: vec![source.to_string_lossy().into_owned()],
        }];
        let total = selected_source_size(&selections).unwrap();
        let cancelled = AtomicBool::new(false);
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        let result = write_zip_progress(
            &mut writer,
            &selections,
            total,
            &cancelled,
            &mut |phase, _, current, _, _| {
                if phase == "archiving" && current > 0 {
                    cancelled.store(true, Ordering::Relaxed);
                }
            },
        );
        assert_eq!(result.unwrap_err(), CANCELLED);
    }

    #[test]
    fn unsupported_source_is_rejected() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("note.docx");
        fs::write(&source, b"PK test").unwrap();
        let selections = vec![PrescriptionSelectionInput {
            patient: "Test Patient".into(),
            paths: vec![source.to_string_lossy().into_owned()],
        }];
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        assert!(write_zip(&mut writer, &selections).is_err());
    }
}
