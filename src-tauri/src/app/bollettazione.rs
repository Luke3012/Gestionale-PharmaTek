//! Bollettazione guidata dai file del laboratorio (FASE 13).
//!
//! Il modulo coordina parser Excel, normalizzazione e matching senza introdurre nuove
//! entità. Le mutazioni passano sempre dagli stessi record e dalle stesse regole di
//! produzione/spedizione usate dal resto dell'applicazione.

use super::shipping::{prepara_spedizione_mutations, SpedizioneCreateParams};
use super::*;
use calamine::{open_workbook_auto, Data, Reader};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::cmp::Ordering;
use std::path::Path;

const STATO_PRONTO: &str = "pronto";
const STATO_CONTROLLO: &str = "da_controllare";
const STATO_NON_TROVATO: &str = "non_trovato";
const STATO_REGISTRATO: &str = "gia_registrato";
const MOTIVAZIONE_PRODOTTO_NON_CORRISPONDE: &str = "I prodotti non corrispondono";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BollettazioneFileDto {
    pub name: String,
    pub rows: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BollettazioneTotalsDto {
    pub ready: usize,
    pub review: usize,
    pub not_found: usize,
    pub already_registered: usize,
    pub valid_rows: usize,
    pub failed_files: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BollettazioneMatchDto {
    pub row_id: String,
    pub order_id: String,
    pub order_number: String,
    pub order_date: String,
    pub patient: String,
    pub doctor: String,
    pub product_name: String,
    pub score: f64,
    pub reason: String,
    pub expected_row_revision: String,
    pub expected_order_revision: String,
    pub proposed_fields: Map<String, Value>,
    pub conflicts: Vec<BollettazioneConflictDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BollettazioneConflictDto {
    pub field: String,
    pub label: String,
    pub current: Value,
    pub proposed: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_display: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposed_display: Option<String>,
    pub blocking: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BollettazioneRowDto {
    pub source: String,
    pub source_row: usize,
    pub reference: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_warning: Option<String>,
    pub patient: String,
    pub doctor: String,
    pub treatment: String,
    pub status: String,
    pub reason: String,
    pub selected_match: Option<BollettazioneMatchDto>,
    pub alternatives: Vec<BollettazioneMatchDto>,
    pub conflicts: Vec<BollettazioneConflictDto>,
    pub quantity_issue: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BollettazioneAnalisiDto {
    pub files: Vec<BollettazioneFileDto>,
    pub rows: Vec<BollettazioneRowDto>,
    pub totals: BollettazioneTotalsDto,
}

#[derive(Debug, Clone)]
struct RigaLaboratorio {
    source: String,
    source_row: usize,
    reference: String,
    raw_reference: Option<String>,
    reference_warning: Option<String>,
    reference_ambiguous: bool,
    lab_status: String,
    patient: String,
    doctor: String,
    treatment: String,
    quantity: i64,
    vials: i64,
    composition: String,
}

#[derive(Debug, Clone)]
struct TrattamentoNormalizzato {
    family: String,
    product_id: String,
    product_name: String,
    formulation: String,
    dosage: String,
    // Gli allergeni restano normalizzati per eventuali controlli interni/audit,
    // ma non sono un dato operativo della bollettazione e non vengono esportati.
    #[allow(dead_code)]
    allergens: Vec<String>,
    vials: i64,
    product_fallback: bool,
    veb_product_ambiguous: bool,
}

#[derive(Debug, Clone)]
struct Candidato {
    row_id: String,
    row_revision: String,
    order_id: String,
    order_revision: String,
    order_number: String,
    order_date: String,
    patient: String,
    doctor: String,
    product_id: String,
    product_name: String,
    formulation: String,
    dosage: String,
    current_fields: Map<String, Value>,
}

#[derive(Debug, Clone)]
struct Ranked {
    candidate_index: usize,
    score: f64,
    patient_score: f64,
    doctor_score: f64,
    product_score: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BollettazioneConfermaRigaIn {
    pub source_reference: String,
    pub row_id: String,
    pub order_id: String,
    pub expected_row_revision: String,
    pub expected_order_revision: String,
    #[serde(default)]
    pub accepted_fields: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BollettazioneSpedizioneIn {
    pub data: String,
    pub corriere_id: String,
    pub colli: i64,
    pub peso: i64,
    #[serde(default)]
    pub servizi: String,
    pub preavviso: bool,
    #[serde(default)]
    pub mezzo: String,
    #[serde(default)]
    pub contrassegno: i64,
    #[serde(default)]
    pub note: String,
    pub row_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BollettazioneConfermaIn {
    pub mode: String,
    #[serde(default)]
    pub data_arrivo: String,
    pub rows: Vec<BollettazioneConfermaRigaIn>,
    #[serde(default)]
    pub shipments: Vec<BollettazioneSpedizioneIn>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BollettazioneConfermaDto {
    pub mode: String,
    pub updated_rows: usize,
    pub shipments: Vec<SpedizioneDto>,
}

fn cell_text(cell: Option<&Data>) -> String {
    match cell {
        Some(Data::String(value)) => value.trim().to_string(),
        Some(Data::Int(value)) => value.to_string(),
        Some(Data::Float(value)) if value.fract() == 0.0 => format!("{value:.0}"),
        Some(Data::Float(value)) => value.to_string(),
        Some(Data::Bool(value)) => value.to_string(),
        Some(Data::DateTime(value)) => value.to_string(),
        Some(Data::DateTimeIso(value)) => value.trim().to_string(),
        Some(Data::DurationIso(value)) => value.trim().to_string(),
        _ => String::new(),
    }
}

fn normalizza_header(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn header_index(headers: &[String], name: &str) -> Option<usize> {
    let target = normalizza_header(name);
    headers
        .iter()
        .position(|header| normalizza_header(header) == target)
}

fn cell_i64(cell: Option<&Data>) -> i64 {
    match cell {
        Some(Data::Int(value)) => *value,
        Some(Data::Float(value)) => *value as i64,
        Some(Data::String(value)) => {
            let value = value.trim().replace(',', ".");
            value.parse::<i64>().unwrap_or_else(|_| {
                value
                    .parse::<f64>()
                    .map(|parsed| parsed as i64)
                    .unwrap_or(0)
            })
        }
        _ => 0,
    }
}

#[derive(Debug, Clone)]
struct RiferimentoNormalizzato {
    value: String,
    warning: Option<String>,
    ambiguous: bool,
}

fn riferimento_laboratorio_valido(value: &str) -> bool {
    value.len() == 7 && value.starts_with("50") && value.chars().all(|c| c.is_ascii_digit())
}

fn normalizza_riferimento(value: &str) -> RiferimentoNormalizzato {
    let raw = value.trim().to_string();
    if raw.is_empty() || !raw.chars().all(|c| c.is_ascii_digit()) {
        return RiferimentoNormalizzato {
            value: raw,
            warning: None,
            ambiguous: false,
        };
    }

    let mut candidates = Vec::new();
    if riferimento_laboratorio_valido(&raw) {
        candidates.push(raw.clone());
    }
    let stripped = raw.trim_start_matches('0');
    if stripped != raw && riferimento_laboratorio_valido(stripped) {
        candidates.push(stripped.to_string());
    }
    // Alcuni export hanno invertito il prefisso 50 come "05". È una correzione
    // specifica e vincolata al formato Laboratorio, non una rimozione indiscriminata.
    if raw.starts_with("05") && raw.len() > 2 {
        let swapped = format!("50{}", &raw[2..]);
        if riferimento_laboratorio_valido(&swapped) {
            candidates.push(swapped);
        }
    }
    candidates.sort();
    candidates.dedup();

    match candidates.as_slice() {
        [candidate] if candidate == &raw => RiferimentoNormalizzato {
            value: raw,
            warning: None,
            ambiguous: false,
        },
        [candidate] => RiferimentoNormalizzato {
            value: candidate.clone(),
            warning: Some(format!("Riferimento normalizzato: {raw} → {candidate}")),
            ambiguous: false,
        },
        [] => RiferimentoNormalizzato {
            value: raw,
            warning: None,
            ambiguous: false,
        },
        _ => RiferimentoNormalizzato {
            value: raw.clone(),
            warning: Some(format!(
                "Riferimento ambiguo: {raw} può corrispondere a {}",
                candidates.join(", ")
            )),
            ambiguous: true,
        },
    }
}

fn riferimento_chiave(value: &str) -> String {
    normalizza_riferimento(value).value
}

fn parse_workbook(path: &Path) -> Result<Vec<RigaLaboratorio>, String> {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("xlsx"))
    {
        return Err("formato non supportato: seleziona un file .xlsx".into());
    }
    let source = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("File Excel")
        .to_string();
    let mut workbook =
        open_workbook_auto(path).map_err(|_| "file non leggibile o danneggiato".to_string())?;
    let mut parsed = Vec::new();
    for sheet_name in workbook.sheet_names().to_vec() {
        let range = match workbook.worksheet_range(&sheet_name) {
            Ok(range) => range,
            Err(_) => continue,
        };
        let rows: Vec<&[Data]> = range.rows().collect();
        let Some((header_row, headers)) = rows.iter().enumerate().find_map(|(index, row)| {
            let values: Vec<String> = row.iter().map(|cell| cell_text(Some(cell))).collect();
            header_index(&values, "Referencia").map(|_| (index, values))
        }) else {
            continue;
        };
        let required = ["Referencia", "Paciente", "Doctor", "Tratamiento"];
        if required
            .iter()
            .any(|name| header_index(&headers, name).is_none())
        {
            continue;
        }
        let reference = header_index(&headers, "Referencia");
        let lab_status = header_index(&headers, "Estado");
        let patient = header_index(&headers, "Paciente");
        let doctor = header_index(&headers, "Doctor");
        let treatment = header_index(&headers, "Tratamiento");
        let quantity = header_index(&headers, "Cantidad");
        let vials = header_index(&headers, "Vials");
        let composition = header_index(&headers, "DescripcionCompleta");
        for (offset, row) in rows.iter().skip(header_row + 1).enumerate() {
            let reference_value = cell_text(reference.and_then(|index| row.get(index)));
            let all_text = row
                .iter()
                .map(|cell| cell_text(Some(cell)))
                .collect::<Vec<_>>()
                .join(" ");
            if reference_value.is_empty()
                || reference_value.eq_ignore_ascii_case("total")
                || normalizza_testo(&all_text).contains("filtros aplicados")
            {
                continue;
            }
            let normalized_reference = normalizza_riferimento(&reference_value);
            let canonical_reference = normalized_reference.value.clone();
            parsed.push(RigaLaboratorio {
                source: source.clone(),
                source_row: header_row + offset + 2,
                reference: canonical_reference.clone(),
                raw_reference: (reference_value != canonical_reference).then_some(reference_value),
                reference_warning: normalized_reference.warning,
                reference_ambiguous: normalized_reference.ambiguous,
                lab_status: cell_text(lab_status.and_then(|index| row.get(index))),
                patient: cell_text(patient.and_then(|index| row.get(index))),
                doctor: cell_text(doctor.and_then(|index| row.get(index))),
                treatment: cell_text(treatment.and_then(|index| row.get(index))),
                quantity: cell_i64(quantity.and_then(|index| row.get(index))).max(1),
                vials: cell_i64(vials.and_then(|index| row.get(index))),
                composition: cell_text(composition.and_then(|index| row.get(index))),
            });
        }
    }
    if parsed.is_empty() {
        Err("nessuna riga valida riconosciuta".into())
    } else {
        Ok(parsed)
    }
}

fn deaccent_char(value: char) -> char {
    match value {
        'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' | 'À' | 'Á' | 'Â' | 'Ä' | 'Ã' | 'Å' => 'a',
        'è' | 'é' | 'ê' | 'ë' | 'È' | 'É' | 'Ê' | 'Ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'Ì' | 'Í' | 'Î' | 'Ï' => 'i',
        'ò' | 'ó' | 'ô' | 'ö' | 'õ' | 'Ò' | 'Ó' | 'Ô' | 'Ö' | 'Õ' => 'o',
        'ù' | 'ú' | 'û' | 'ü' | 'Ù' | 'Ú' | 'Û' | 'Ü' => 'u',
        'ñ' | 'Ñ' => 'n',
        'ç' | 'Ç' => 'c',
        _ => value.to_ascii_lowercase(),
    }
}

fn normalizza_testo(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut previous_space = true;
    for c in value.chars() {
        let c = deaccent_char(c);
        if c.is_ascii_alphanumeric() {
            out.push(c);
            previous_space = false;
        } else if !previous_space {
            out.push(' ');
            previous_space = true;
        }
    }
    out.trim().to_string()
}

fn normalizza_nome(value: &str) -> String {
    const TITLES: &[&str] = &[
        "dr",
        "dott",
        "dottore",
        "dottoressa",
        "ssa",
        "prof",
        "professore",
        "professoressa",
        "sig",
        "signor",
        "signora",
    ];
    normalizza_testo(value)
        .split_whitespace()
        .filter(|token| !TITLES.contains(token))
        .collect::<Vec<_>>()
        .join(" ")
}

fn tokens(value: &str) -> Vec<String> {
    let mut values: Vec<String> = normalizza_nome(value)
        .split_whitespace()
        .map(str::to_string)
        .collect();
    values.sort();
    values.dedup();
    values
}

fn token_similarity(a: &str, b: &str) -> f64 {
    let a = tokens(a);
    let b = tokens(b);
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let intersection = a.iter().filter(|token| b.contains(token)).count();
    let union = a.len() + b.len() - intersection;
    intersection as f64 / union.max(1) as f64
}

fn trigrams(value: &str) -> Vec<String> {
    let normalized = format!("  {}  ", normalizza_nome(value));
    let chars: Vec<char> = normalized.chars().collect();
    if chars.len() < 3 {
        return vec![normalized];
    }
    chars
        .windows(3)
        .map(|window| window.iter().collect::<String>())
        .collect()
}

fn trigram_similarity(a: &str, b: &str) -> f64 {
    let a = trigrams(a);
    let b = trigrams(b);
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let mut used = vec![false; b.len()];
    let mut intersection = 0usize;
    for trigram in &a {
        if let Some((index, _)) = b
            .iter()
            .enumerate()
            .find(|(index, other)| !used[*index] && *other == trigram)
        {
            used[index] = true;
            intersection += 1;
        }
    }
    2.0 * intersection as f64 / (a.len() + b.len()) as f64
}

fn damerau_levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut matrix = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in matrix.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in matrix[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            matrix[i][j] = (matrix[i - 1][j] + 1)
                .min(matrix[i][j - 1] + 1)
                .min(matrix[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                matrix[i][j] = matrix[i][j].min(matrix[i - 2][j - 2] + cost);
            }
        }
    }
    matrix[a.len()][b.len()]
}

fn edit_similarity(a: &str, b: &str) -> f64 {
    let a = normalizza_nome(a);
    let b = normalizza_nome(b);
    let max_len = a.chars().count().max(b.chars().count());
    if max_len == 0 {
        return 0.0;
    }
    1.0 - damerau_levenshtein(&a, &b) as f64 / max_len as f64
}

fn name_similarity(a: &str, b: &str) -> f64 {
    token_similarity(a, b)
        .max(trigram_similarity(a, b))
        .max(edit_similarity(a, b))
        .clamp(0.0, 1.0)
}

fn first_name_initial_compatible(a: &str, b: &str) -> bool {
    let a_normalized = normalizza_nome(a);
    let b_normalized = normalizza_nome(b);
    let a_words: Vec<&str> = a_normalized.split_whitespace().collect();
    let b_words: Vec<&str> = b_normalized.split_whitespace().collect();
    if a_words.len() != b_words.len() || a_words.len() < 2 {
        return false;
    }
    let initial_pair = |left: &str, right: &str| {
        (left.len() == 1 && right.starts_with(left))
            || (right.len() == 1 && left.starts_with(right))
    };
    initial_pair(a_words[0], b_words[0])
        && a_words[1..].iter().all(|word| b_words[1..].contains(word))
        && b_words[1..].iter().all(|word| a_words[1..].contains(word))
}

fn patient_similarity(a: &str, b: &str) -> f64 {
    name_similarity(a, b)
        .max(if first_name_initial_compatible(a, b) {
            0.95
        } else {
            0.0
        })
        .clamp(0.0, 1.0)
}

fn same_last_name(a: &str, b: &str) -> bool {
    normalizza_nome(a)
        .split_whitespace()
        .last()
        .zip(normalizza_nome(b).split_whitespace().last())
        .is_some_and(|(left, right)| left == right)
}

fn patient_is_soft_match(a: &str, b: &str, score: f64) -> bool {
    score < 0.86
        && same_last_name(a, b)
        && normalizza_nome(a).split_whitespace().count() >= 2
        && normalizza_nome(b).split_whitespace().count() >= 2
}

fn doctor_similarity(a: &str, b: &str) -> f64 {
    let base = name_similarity(a, b);
    if base >= 0.90 {
        return base;
    }
    let a_normalized = normalizza_nome(a);
    let b_normalized = normalizza_nome(b);
    let a_words: Vec<&str> = a_normalized.split_whitespace().collect();
    let b_words: Vec<&str> = b_normalized.split_whitespace().collect();
    let (Some(a_surname), Some(b_surname)) = (a_words.last(), b_words.last()) else {
        return base;
    };
    let surname_match = a_surname == b_surname
        || (a_words.len() == 1 && b_words.contains(a_surname))
        || (b_words.len() == 1 && a_words.contains(b_surname));
    if !surname_match {
        return base;
    }
    if a_words.len() == 1 || b_words.len() == 1 {
        return 0.95;
    }
    let initial_match = a_words
        .first()
        .and_then(|word| word.chars().next())
        .zip(b_words.first().and_then(|word| word.chars().next()))
        .is_some_and(|(a_initial, b_initial)| a_initial == b_initial);
    if initial_match {
        0.95
    } else {
        0.72
    }
}

fn alias_allergene(value: &str) -> Option<&'static str> {
    match normalizza_testo(value).as_str() {
        "derm farinae" | "dermatophagoides farinae" => Some("d.farinae"),
        "derm pteronyssinus" | "dermatophagoides pteronyssinus" => Some("d.pteronyssinus"),
        "gramineas espontaneas" | "gramineas espontaneas polim" => Some("mix graminacee"),
        "olea europaea" => Some("olea europea"),
        "parietaria judaica" => Some("parietaria"),
        "cupressus arizonica" => Some("cipresso"),
        "betula pendula" => Some("betulla"),
        "alternaria alternata" => Some("alternaria"),
        "artemisia vulgaris" => Some("artemisia"),
        "ambrosia artemisiifolia" => Some("ambrosia"),
        "cynodon dactylon" => Some("cynodon"),
        "gato" => Some("gatto"),
        "perro" => Some("cane"),
        "haemophilus influenzae" => Some("h.influenzae"),
        "streptococcus pneumoniae" => Some("s.pneumoniae"),
        "moraxella catarrhalis" => Some("m.catarrhalis"),
        "klebsiella pneumoniae" => Some("k.pneumoniae"),
        "staphylococcus aureus" => Some("s.aureus"),
        "streptococcus pyogenes" => Some("s.pyogenes"),
        "pseudomonas aeruginosa" => Some("p.aeruginosa"),
        "proteus mirabilis" => Some("p.mirabilis"),
        "escherichia coli" => Some("e.coli"),
        "enterococcus faecalis" => Some("e.faecalis"),
        _ => None,
    }
}

fn pulisci_allergene(value: &str) -> String {
    let parts: Vec<&str> = value.split_whitespace().collect();
    let mut kept = Vec::new();
    for part in parts {
        let normalized = normalizza_testo(part);
        if part.contains('%')
            || matches!(
                normalized.as_str(),
                "polimerizado" | "polimerizzata" | "polimerizzato" | "polim"
            )
        {
            continue;
        }
        kept.push(part.trim_matches(|c: char| matches!(c, ',' | ';' | '.')));
    }
    let mut cleaned = kept.join(" ").trim().to_string();
    if cleaned
        .split_whitespace()
        .last()
        .is_some_and(|last| matches!(last, "N" | "S"))
    {
        cleaned = cleaned
            .split_whitespace()
            .take(cleaned.split_whitespace().count().saturating_sub(1))
            .collect::<Vec<_>>()
            .join(" ");
    }
    cleaned
}

fn canonicalizza_allergene(value: &str, canonical: &[String]) -> String {
    let cleaned = pulisci_allergene(value);
    if let Some(alias) = alias_allergene(&cleaned) {
        return alias.to_string();
    }
    let normalized = normalizza_testo(&cleaned);
    canonical
        .iter()
        .find(|candidate| normalizza_testo(candidate) == normalized)
        .cloned()
        .unwrap_or(cleaned)
}

fn parse_dosage(treatment: &str) -> String {
    let tokens: Vec<&str> = treatment
        .split_whitespace()
        .map(|token| token.trim_matches(|c: char| matches!(c, '(' | ')' | ';' | ':')))
        .collect();
    tokens
        .iter()
        .enumerate()
        .find_map(|(index, token)| {
            let token = *token;
            let valid = !token.is_empty()
                && token.contains(',')
                && token.chars().all(|c| c.is_ascii_digit() || c == ',')
                && token.split(',').all(|part| !part.is_empty());
            if valid {
                Some(token.replace(',', "+"))
            } else if token.chars().all(|c| c.is_ascii_digit())
                && matches!(token, "2" | "3")
                && tokens.get(index + 1).is_none_or(|next| {
                    !matches!(
                        normalizza_testo(next).as_str(),
                        "vial" | "vials" | "viale" | "viales" | "ml"
                    )
                })
            {
                Some(token.to_string())
            } else {
                None
            }
        })
        .unwrap_or_default()
}

fn normalize_treatment(
    row: &RigaLaboratorio,
    products: &[(String, String)],
    canonical_allergens: &[String],
) -> TrattamentoNormalizzato {
    let treatment = normalizza_testo(&row.treatment);
    let (family, base_name) = if treatment.starts_with("beltavac") {
        ("beltavac", "Polimerizzato")
    } else if treatment.starts_with("beltaoral") {
        ("beltaoral", "Sublinguale")
    } else if treatment.starts_with("veb") {
        ("veb", "Lisato batterico")
    } else {
        ("", "")
    };
    let suffix = if row.vials == 1 { "fiala" } else { "fiale" };
    let standard_product_name = if base_name.is_empty() || row.vials <= 0 {
        String::new()
    } else {
        format!("{base_name} {} {suffix}", row.vials)
    };
    let is_pro2 = treatment.contains("pro2");
    let pro_product_name = match family {
        "beltavac" => "Polimerizzato PRO",
        "beltaoral" => "Sublinguale PRO",
        _ => "",
    };
    let requested_product_name = if is_pro2 && !pro_product_name.is_empty() {
        pro_product_name.to_string()
    } else {
        standard_product_name.clone()
    };
    let product_id = products
        .iter()
        .find(|(_, name)| normalizza_testo(name) == normalizza_testo(&requested_product_name))
        .map(|(id, _)| id.clone())
        .unwrap_or_default();
    let product_fallback = is_pro2 && !pro_product_name.is_empty() && product_id.is_empty();
    let (product_name, product_id) = if product_fallback {
        let standard_id = products
            .iter()
            .find(|(_, name)| normalizza_testo(name) == normalizza_testo(&standard_product_name))
            .map(|(id, _)| id.clone())
            .unwrap_or_default();
        (standard_product_name, standard_id)
    } else {
        (requested_product_name, product_id)
    };
    let formulation = if treatment.contains("polimerizado") {
        "polimerizzato"
    } else if treatment.contains("depot") {
        "depot"
    } else if treatment.contains("spray") {
        "spray"
    } else if family == "beltaoral" {
        "gocce"
    } else if family == "veb" && treatment.contains("nasaleorale") {
        "nasale"
    } else if family == "veb" && treatment.contains("sublinguale") {
        "gocce"
    } else if family == "veb" && treatment.contains("sottocutanea") {
        "VEB sottocute"
    } else {
        ""
    }
    .to_string();
    let veb_product_ambiguous = family == "veb"
        && (treatment.contains("nasale")
            || treatment.contains("spray")
            || treatment.contains("sublinguale"));
    let mut allergens: Vec<String> = Vec::new();
    for value in row.composition.split('|') {
        let canonical = canonicalizza_allergene(value, canonical_allergens);
        if canonical.trim().is_empty()
            || allergens
                .iter()
                .any(|existing| normalizza_testo(existing) == normalizza_testo(&canonical))
        {
            continue;
        }
        allergens.push(canonical);
    }
    TrattamentoNormalizzato {
        family: family.to_string(),
        product_id,
        product_name,
        formulation,
        dosage: parse_dosage(&row.treatment),
        allergens,
        vials: row.vials,
        product_fallback,
        veb_product_ambiguous,
    }
}

fn vec_string(data: &Map<String, Value>, field: &str) -> Vec<String> {
    data.get(field)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn rank_candidate(
    row: &RigaLaboratorio,
    normalized: &TrattamentoNormalizzato,
    candidate_index: usize,
    c: &Candidato,
) -> Ranked {
    let patient_score = patient_similarity(&row.patient, &c.patient);
    let doctor_score = doctor_similarity(&row.doctor, &c.doctor);
    let product_score = product_score_for(normalized, c);
    let formulation = if normalized.formulation.is_empty() || c.formulation.is_empty() {
        0.5
    } else {
        name_similarity(&normalized.formulation, &c.formulation)
    };
    let dosage = if normalized.dosage.is_empty() || c.dosage.is_empty() {
        0.5
    } else {
        name_similarity(&normalized.dosage, &c.dosage)
    };
    // Gli allergeni sono metadati utili ma non sempre presenti o omogenei nei
    // tracciati. Non devono quindi ridurre la confidenza dell'associazione.
    let details_score = (formulation + dosage) / 2.0;
    Ranked {
        candidate_index,
        score: patient_score * 0.45
            + doctor_score * 0.30
            + product_score * 0.15
            + details_score * 0.10,
        patient_score,
        doctor_score,
        product_score,
    }
}

fn product_score_for(normalized: &TrattamentoNormalizzato, candidate: &Candidato) -> f64 {
    if !normalized.product_id.is_empty() && normalized.product_id == candidate.product_id {
        return 1.0;
    }
    let candidate_name = normalizza_testo(&candidate.product_name);
    let same_family = match normalized.family.as_str() {
        "beltavac" => candidate_name.starts_with("polimerizzato"),
        "beltaoral" => candidate_name.starts_with("sublinguale"),
        "veb" => candidate_name.starts_with("lisato batterico"),
        _ => false,
    };
    if same_family {
        return 0.55;
    }
    if normalized.veb_product_ambiguous
        && (candidate_name.starts_with("lisato batterico")
            || candidate_name.starts_with("sublinguale"))
    {
        return 0.55;
    }
    0.0
}

fn patient_is_compatible(row: &RigaLaboratorio, candidate: &Candidato, ranked: &Ranked) -> bool {
    ranked.patient_score >= 0.86
        || patient_is_soft_match(&row.patient, &candidate.patient, ranked.patient_score)
}

fn doctor_is_compatible(ranked: &Ranked) -> bool {
    ranked.doctor_score >= 0.55
}

fn association_edge(row: &RigaLaboratorio, candidate: &Candidato, ranked: &Ranked) -> bool {
    patient_is_compatible(row, candidate, ranked)
        && doctor_is_compatible(ranked)
        && ranked.product_score >= 0.55
}

fn requires_review(row: &RigaLaboratorio, candidate: &Candidato, ranked: &Ranked) -> bool {
    ranked.product_score < 1.0
        || patient_is_soft_match(&row.patient, &candidate.patient, ranked.patient_score)
}

fn product_conflict_reason(
    _normalized: &TrattamentoNormalizzato,
    _candidate: &Candidato,
) -> &'static str {
    MOTIVAZIONE_PRODOTTO_NON_CORRISPONDE
}

fn veb_products_cross_family(normalized: &TrattamentoNormalizzato, candidate: &Candidato) -> bool {
    if !normalized.veb_product_ambiguous {
        return false;
    }
    let source_product = normalizza_testo(&normalized.product_name);
    let candidate_product = normalizza_testo(&candidate.product_name);
    (source_product.starts_with("lisato batterico") && candidate_product.starts_with("sublinguale"))
        || (source_product.starts_with("sublinguale")
            && candidate_product.starts_with("lisato batterico"))
}

fn ranked_to_dto(
    ranked: &Ranked,
    candidate: &Candidato,
    reference: &str,
    normalized: &TrattamentoNormalizzato,
) -> BollettazioneMatchDto {
    let reason = format!(
        "paziente {}%, medico {}%, prodotto {}%",
        (ranked.patient_score * 100.0).round(),
        (ranked.doctor_score * 100.0).round(),
        (ranked.product_score * 100.0).round()
    );
    let (proposed_fields, conflicts) = proposed_and_conflicts(
        reference,
        normalized,
        &candidate.current_fields,
        &candidate.product_name,
    );
    BollettazioneMatchDto {
        row_id: candidate.row_id.clone(),
        order_id: candidate.order_id.clone(),
        order_number: candidate.order_number.clone(),
        order_date: candidate.order_date.clone(),
        patient: candidate.patient.clone(),
        doctor: candidate.doctor.clone(),
        product_name: candidate.product_name.clone(),
        score: (ranked.score * 1000.0).round() / 1000.0,
        reason,
        expected_row_revision: candidate.row_revision.clone(),
        expected_order_revision: candidate.order_revision.clone(),
        proposed_fields,
        conflicts,
    }
}

fn equivalent(current: &Value, proposed: &Value) -> bool {
    current
        .as_str()
        .zip(proposed.as_str())
        .is_some_and(|(a, b)| normalizza_testo(a) == normalizza_testo(b))
}

fn proposed_and_conflicts(
    reference: &str,
    normalized: &TrattamentoNormalizzato,
    current_fields: &Map<String, Value>,
    current_product_name: &str,
) -> (Map<String, Value>, Vec<BollettazioneConflictDto>) {
    // La bollettazione aggiorna soltanto lotto e identità del prodotto. I
    // dettagli produttivi restano indizi interni al matching e non diventano
    // né campi proposti né conflitti da confermare.
    let values = [
        ("numero", "Numero lotto", json!(reference)),
        ("prodotto_id", "Prodotto", json!(normalized.product_id)),
        (
            "prodotto_nome",
            "Nome prodotto",
            json!(normalized.product_name),
        ),
    ];
    let mut proposed = Map::new();
    let mut conflicts = Vec::new();
    for (field, label, value) in values {
        if value.as_str().is_some_and(str::is_empty) {
            continue;
        }
        let current = current_fields.get(field).cloned().unwrap_or(Value::Null);
        let current = if field == "prodotto_nome"
            && (current.is_null()
                || current
                    .as_str()
                    .is_some_and(|value| value.trim().is_empty()))
            && !current_product_name.trim().is_empty()
        {
            json!(current_product_name)
        } else {
            current
        };
        let empty = current.is_null()
            || current
                .as_str()
                .is_some_and(|value| value.trim().is_empty())
            || current.as_array().is_some_and(Vec::is_empty);
        if !empty && !equivalent(&current, &value) {
            conflicts.push(BollettazioneConflictDto {
                field: field.to_string(),
                label: label.to_string(),
                current: current.clone(),
                proposed: value.clone(),
                // Gli ID sono necessari al salvataggio, ma non sono utili a chi
                // deve scegliere. Mostriamo quindi i nomi prodotto senza alterare
                // i valori tecnici inviati nella conferma.
                current_display: (field == "prodotto_id")
                    .then(|| current_product_name.to_string())
                    .filter(|name| !name.trim().is_empty()),
                proposed_display: (field == "prodotto_id")
                    .then(|| normalized.product_name.clone())
                    .filter(|name| !name.trim().is_empty()),
                // È un conflitto fra la riga scelta e il file: l'operatore può
                // risolverlo esplicitamente in entrambe le direzioni.
                blocking: false,
            });
            proposed.insert(field.to_string(), current);
        } else {
            proposed.insert(field.to_string(), if empty { value } else { current });
        }
    }
    (proposed, conflicts)
}

fn source_signature(row: &RigaLaboratorio) -> String {
    [
        normalizza_testo(&row.patient),
        normalizza_testo(&row.doctor),
        normalizza_testo(&row.treatment),
        row.quantity.to_string(),
        row.vials.to_string(),
        normalizza_testo(&row.composition),
    ]
    .join("|")
}

fn source_group_signature(row: &RigaLaboratorio) -> String {
    [
        normalizza_nome(&row.patient),
        normalizza_nome(&row.doctor),
        normalizza_testo(&row.treatment),
        row.quantity.to_string(),
        row.vials.to_string(),
    ]
    .join("|")
}

fn candidate_group_signature(candidate: &Candidato) -> String {
    [
        candidate.order_id.clone(),
        candidate.product_id.clone(),
        normalizza_nome(&candidate.patient),
        normalizza_nome(&candidate.doctor),
    ]
    .join("|")
}

fn operational_edge(row: &RigaLaboratorio, candidate: &Candidato, ranked: &Ranked) -> bool {
    association_edge(row, candidate, ranked)
}

#[derive(Debug, Default)]
struct AutomaticAssignments {
    by_source: HashMap<usize, String>,
    group_sources: HashSet<usize>,
    forced_review: HashSet<usize>,
}

fn automatic_assignments(
    source_rows: &[RigaLaboratorio],
    candidates: &[Candidato],
    rankings: &[Vec<Ranked>],
    excluded_sources: &HashSet<usize>,
) -> AutomaticAssignments {
    let mut source_group_sizes: HashMap<String, usize> = HashMap::new();
    for row in source_rows {
        *source_group_sizes
            .entry(source_group_signature(row))
            .or_default() += 1;
    }
    let mut auto_edges: Vec<(usize, f64, String)> = rankings
        .iter()
        .enumerate()
        .filter_map(|(index, ranked)| {
            if excluded_sources.contains(&index) {
                return None;
            }
            if source_group_sizes
                .get(&source_group_signature(&source_rows[index]))
                .is_some_and(|size| *size >= 2)
            {
                return None;
            }
            let eligible: Vec<&Ranked> = ranked
                .iter()
                .filter(|item| {
                    association_edge(&source_rows[index], &candidates[item.candidate_index], item)
                })
                .collect();
            let best = eligible.first()?;
            let second = eligible.get(1).map(|item| item.score).unwrap_or(0.0);
            let best_candidate = &candidates[best.candidate_index];
            let ambiguous_identity = patient_is_soft_match(
                &source_rows[index].patient,
                &best_candidate.patient,
                best.patient_score,
            );
            let automatic = best.score >= 0.65
                && (eligible.len() == 1 || (!ambiguous_identity && best.score - second >= 0.10));
            automatic.then(|| {
                (
                    index,
                    best.score,
                    candidates[best.candidate_index].row_id.clone(),
                )
            })
        })
        .collect();
    auto_edges.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(Ordering::Equal)
            .then(source_rows[a.0].reference.cmp(&source_rows[b.0].reference))
    });
    let mut assigned_rows = HashSet::new();
    let mut assignments = AutomaticAssignments::default();
    for (index, _, row_id) in auto_edges {
        if assigned_rows.insert(row_id.clone()) {
            assignments.by_source.insert(index, row_id);
            let ranked = rankings[index].iter().find(|item| {
                candidates[item.candidate_index].row_id == assignments.by_source[&index]
            });
            if let Some(ranked) = ranked {
                if requires_review(
                    &source_rows[index],
                    &candidates[ranked.candidate_index],
                    ranked,
                ) {
                    assignments.forced_review.insert(index);
                }
            }
        }
    }

    // Seconda fase: quando le righe sorgente o le righe ordine sono duplicati
    // fisicamente equivalenti, non scegliamo un ordine arbitrario. Verifichiamo
    // che esista un solo gruppo operativo candidato, con cardinalità sufficiente
    // e stesso ordine, prodotto, paziente e medico. In questo caso lo scambio dei
    // lotti fra le righe fisiche non cambia il risultato della spedizione.
    let mut source_groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, row) in source_rows.iter().enumerate() {
        if excluded_sources.contains(&index) || assignments.by_source.contains_key(&index) {
            continue;
        }
        source_groups
            .entry(source_group_signature(row))
            .or_default()
            .push(index);
    }

    for source_indices in source_groups.values() {
        let mut candidate_groups: HashMap<String, HashSet<usize>> = HashMap::new();
        let mut source_group_scores: HashMap<String, Vec<f64>> = HashMap::new();
        let mut source_has_group: HashMap<String, HashSet<usize>> = HashMap::new();

        for source_index in source_indices {
            for ranked in &rankings[*source_index] {
                if assigned_rows.contains(&candidates[ranked.candidate_index].row_id)
                    || !operational_edge(
                        &source_rows[*source_index],
                        &candidates[ranked.candidate_index],
                        ranked,
                    )
                {
                    continue;
                }
                let group_key = candidate_group_signature(&candidates[ranked.candidate_index]);
                candidate_groups
                    .entry(group_key.clone())
                    .or_default()
                    .insert(ranked.candidate_index);
                source_has_group
                    .entry(group_key.clone())
                    .or_default()
                    .insert(*source_index);
                let scores = source_group_scores.entry(group_key).or_default();
                scores.push(ranked.score);
            }
        }

        let mut eligible_groups: Vec<(String, Vec<usize>, f64)> = candidate_groups
            .into_iter()
            .filter_map(|(group_key, candidate_indices)| {
                let covered = source_has_group.get(&group_key)?;
                if covered.len() != source_indices.len()
                    || candidate_indices.len() < source_indices.len()
                {
                    return None;
                }
                let scores = source_group_scores.get(&group_key)?;
                let score = scores.iter().sum();
                Some((group_key, candidate_indices.into_iter().collect(), score))
            })
            .collect();

        // Un solo gruppo candidato: nessun conflitto tra ordini. Se esistono
        // due gruppi possibili, anche un punteggio leggermente migliore non è
        // sufficiente per inventare l'ordine corretto.
        if eligible_groups.len() != 1 {
            continue;
        }
        let (_, mut candidate_indices, _) = eligible_groups.pop().unwrap();
        candidate_indices
            .sort_by(|left, right| candidates[*left].row_id.cmp(&candidates[*right].row_id));
        let mut source_indices_sorted = source_indices.clone();
        source_indices_sorted.sort_by(|left, right| {
            source_rows[*left]
                .reference
                .cmp(&source_rows[*right].reference)
        });

        for (source_index, candidate_index) in
            source_indices_sorted.into_iter().zip(candidate_indices)
        {
            let row_id = candidates[candidate_index].row_id.clone();
            if assigned_rows.insert(row_id.clone()) {
                assignments.by_source.insert(source_index, row_id);
                assignments.group_sources.insert(source_index);
                if let Some(ranked) = rankings[source_index]
                    .iter()
                    .find(|item| item.candidate_index == candidate_index)
                {
                    if requires_review(
                        &source_rows[source_index],
                        &candidates[candidate_index],
                        ranked,
                    ) {
                        assignments.forced_review.insert(source_index);
                    }
                }
            }
        }
    }

    assignments
}

type CandidateData = (
    Vec<Candidato>,
    Vec<(String, String)>,
    Vec<String>,
    HashMap<String, Vec<(String, bool)>>,
);

fn candidate_data(p: &crate::projection::Projection) -> CandidateData {
    let order_numbers = numeri_ordini(p);
    let orders: HashMap<String, crate::projection::Record> = p
        .list("ordine")
        .unwrap_or_default()
        .into_iter()
        .filter(|record| {
            !matches!(
                str_field(&record.data, "stato").as_str(),
                "Rifiutato" | "Annullato"
            )
        })
        .map(|record| (record.id.clone(), record))
        .collect();
    let clients = nome_map(p, "cliente");
    let doctors = nome_map(p, "medico");
    let products_records = p.list("prodotto").unwrap_or_default();
    let products: Vec<(String, String)> = products_records
        .iter()
        .filter(|record| str_field(&record.data, "categoria") == "Immunoterapia")
        .map(|record| (record.id.clone(), str_field(&record.data, "nome")))
        .collect();
    let product_names: HashMap<String, String> = products.iter().cloned().collect();
    let mut allergens: Vec<String> = p
        .list("prodotto_produzione")
        .unwrap_or_default()
        .into_iter()
        .filter(|record| {
            matches!(
                str_field(&record.data, "tipo").as_str(),
                "allergene" | "ceppo"
            )
        })
        .map(|record| str_field(&record.data, "valore"))
        .filter(|value| !value.is_empty())
        .collect();
    let mut candidates = Vec::new();
    let mut references: HashMap<String, Vec<(String, bool)>> = HashMap::new();
    for row in p.list("riga_ordine").unwrap_or_default() {
        let number = str_field(&row.data, "numero");
        let shipped = riga_spedita(&row.data);
        for reference in number
            .lines()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            references
                .entry(riferimento_chiave(reference))
                .or_default()
                .push((row.id.clone(), shipped));
        }
        allergens.extend(vec_string(&row.data, "allergeni"));
        if shipped {
            continue;
        }
        let order_id = str_field(&row.data, "ordine_id");
        let Some(order) = orders.get(&order_id) else {
            continue;
        };
        let product_id = str_field(&row.data, "prodotto_id");
        let product_name = nome_riga_prodotto(&product_names, &product_id, &row.data);
        let category = product_names
            .get(&product_id)
            .and_then(|_| {
                products_records
                    .iter()
                    .find(|product| product.id == product_id)
                    .map(|product| str_field(&product.data, "categoria"))
            })
            .unwrap_or_else(|| str_field(&row.data, "categoria"));
        if category != "Immunoterapia" {
            continue;
        }
        let patient = {
            let value = str_field(&row.data, "paziente");
            if value.is_empty() {
                clients
                    .get(&str_field(&order.data, "cliente_id"))
                    .cloned()
                    .unwrap_or_default()
            } else {
                value
            }
        };
        let current_fields = [
            "numero",
            "prodotto_id",
            "prodotto_nome",
            "formulazione",
            "posologia",
            "allergeni",
        ]
        .into_iter()
        .map(|field| {
            (
                field.to_string(),
                row.data.get(field).cloned().unwrap_or(Value::Null),
            )
        })
        .collect();
        candidates.push(Candidato {
            row_id: row.id,
            row_revision: row.updated_hlc.to_string(),
            order_id: order_id.clone(),
            order_revision: order.updated_hlc.to_string(),
            order_number: order_numbers.get(&order_id).cloned().unwrap_or_default(),
            order_date: str_field(&order.data, "data"),
            patient,
            doctor: doctors
                .get(&str_field(&order.data, "medico_id"))
                .cloned()
                .unwrap_or_default(),
            product_id,
            product_name,
            formulation: str_field(&row.data, "formulazione"),
            dosage: str_field(&row.data, "posologia"),
            current_fields,
        });
    }
    allergens.sort_by_key(|value| normalizza_testo(value));
    allergens.dedup_by(|a, b| normalizza_testo(a) == normalizza_testo(b));
    (candidates, products, allergens, references)
}

impl AppState {
    pub fn bollettazione_analizza(&self, paths: &[String]) -> AppResult<BollettazioneAnalisiDto> {
        crate::premium::ensure_access(self)?;
        if paths.is_empty() {
            return Err("seleziona almeno un file .xlsx".into());
        }
        let mut files = Vec::new();
        let mut source_rows = Vec::new();
        for path in paths {
            let path = Path::new(path);
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("File Excel")
                .to_string();
            match parse_workbook(path) {
                Ok(mut rows) => {
                    files.push(BollettazioneFileDto {
                        name,
                        rows: rows.len(),
                        error: None,
                    });
                    source_rows.append(&mut rows);
                }
                Err(error) => files.push(BollettazioneFileDto {
                    name,
                    rows: 0,
                    error: Some(error),
                }),
            }
        }
        if source_rows.is_empty() {
            return Err("nessuno dei file selezionati contiene righe valide".into());
        }
        self.with_engine(|engine| {
            let (candidates, products, canonical_allergens, existing_references) =
                engine.with_projection(candidate_data);
            let normalized: Vec<TrattamentoNormalizzato> = source_rows
                .iter()
                .map(|row| normalize_treatment(row, &products, &canonical_allergens))
                .collect();
            let mut rankings: Vec<Vec<Ranked>> = source_rows
                .iter()
                .zip(&normalized)
                .map(|(row, normalized)| {
                    let reference_already_exists = existing_references.contains_key(&row.reference);
                    let mut ranked: Vec<Ranked> = candidates
                        .iter()
                        .enumerate()
                        .filter(|candidate| {
                            let candidate = candidate.1;
                            let current_number = candidate
                                .current_fields
                                .get("numero")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            reference_already_exists
                                || current_number.trim().is_empty()
                                || current_number
                                    .lines()
                                    .any(|value| riferimento_chiave(value) == row.reference)
                        })
                        .map(|(candidate_index, candidate)| {
                            rank_candidate(row, normalized, candidate_index, candidate)
                        })
                        .collect();
                    ranked.sort_by(|a, b| {
                        let candidate_a = &candidates[a.candidate_index];
                        let candidate_b = &candidates[b.candidate_index];
                        b.score
                            .partial_cmp(&a.score)
                            .unwrap_or(Ordering::Equal)
                            .then(candidate_a.order_number.cmp(&candidate_b.order_number))
                            .then(candidate_a.row_id.cmp(&candidate_b.row_id))
                    });
                    ranked
                })
                .collect();

            let mut duplicate_groups: HashMap<String, Vec<usize>> = HashMap::new();
            for (index, row) in source_rows.iter().enumerate() {
                duplicate_groups
                    .entry(row.reference.clone())
                    .or_default()
                    .push(index);
            }
            let mut conflicting_duplicates: HashSet<usize> = HashSet::new();
            let mut repeated_duplicates: HashSet<usize> = HashSet::new();
            for indices in duplicate_groups
                .values()
                .filter(|indices| indices.len() > 1)
            {
                let signatures: HashSet<String> = indices
                    .iter()
                    .map(|index| source_signature(&source_rows[*index]))
                    .collect();
                if signatures.len() == 1 {
                    for index in indices.iter().skip(1) {
                        repeated_duplicates.insert(*index);
                    }
                } else {
                    conflicting_duplicates.extend(indices.iter().copied());
                }
            }

            // Assegnazione globale deterministica: gli edge automatici più sicuri scelgono
            // per primi; una riga ordine non può essere consumata da due riferimenti.
            let excluded_automatic: HashSet<usize> = source_rows
                .iter()
                .enumerate()
                .filter_map(|(index, row)| {
                    let normalized = &normalized[index];
                    (repeated_duplicates.contains(&index)
                        || conflicting_duplicates.contains(&index)
                        || existing_references.contains_key(&row.reference)
                        || row.quantity > 1
                        || normalized.family.is_empty()
                        || normalized.product_id.is_empty()
                        || normalized.vials <= 0
                        || row.reference_ambiguous)
                        .then_some(index)
                })
                .collect();
            let automatic =
                automatic_assignments(&source_rows, &candidates, &rankings, &excluded_automatic);

            let mut rows = Vec::with_capacity(source_rows.len());
            for (index, (row, normalized)) in source_rows.iter().zip(&normalized).enumerate() {
                let ranked = &mut rankings[index];
                let mut alternatives: Vec<BollettazioneMatchDto> = ranked
                    .iter()
                    .take(12)
                    .map(|item| {
                        ranked_to_dto(
                            item,
                            &candidates[item.candidate_index],
                            &row.reference,
                            normalized,
                        )
                    })
                    .collect();
                let existing = existing_references.get(&row.reference);
                let quantity_issue = row.quantity > 1;
                let lab_issue = !row.lab_status.is_empty()
                    && !matches!(
                        normalizza_testo(&row.lab_status).as_str(),
                        "fabricada" | "facturado"
                    );
                let mut status = STATO_CONTROLLO.to_string();
                let mut reason = String::new();
                let mut selected_match = None;
                let mut conflicts = Vec::new();

                if repeated_duplicates.contains(&index) {
                    status = STATO_REGISTRATO.into();
                    reason = "Riferimento già registrato nel gruppo di file".into();
                } else if conflicting_duplicates.contains(&index) {
                    reason =
                        "Lo stesso riferimento contiene dati diversi nei file selezionati".into();
                    conflicts.push(BollettazioneConflictDto {
                        field: "numero".into(),
                        label: "Riferimento duplicato".into(),
                        current: json!("Dati diversi nel gruppo"),
                        proposed: json!(row.reference),
                        current_display: None,
                        proposed_display: None,
                        // L'operatore può associare una delle occorrenze e deve
                        // saltare le altre; il backend impedisce la doppia conferma.
                        blocking: false,
                    });
                } else if let Some(existing) = existing {
                    if existing.len() == 1 {
                        let same_row = ranked.first().is_some_and(|best| {
                            candidates[best.candidate_index].row_id == existing[0].0
                        });
                        if existing[0].1 || same_row {
                            status = STATO_REGISTRATO.into();
                            reason = if existing[0].1 {
                                "Riferimento già spedito".into()
                            } else {
                                "Riferimento già registrato sulla stessa riga".into()
                            };
                        } else {
                            reason =
                                "Riferimento già assegnato a un'altra riga: controllo bloccante"
                                    .into();
                            conflicts.push(BollettazioneConflictDto {
                                field: "numero".into(),
                                label: "Numero lotto".into(),
                                current: json!("Presente su un'altra riga"),
                                proposed: json!(row.reference),
                                current_display: None,
                                proposed_display: None,
                                blocking: true,
                            });
                        }
                    } else {
                        reason =
                            "Riferimento già assegnato a più righe: controllo obbligatorio".into();
                        conflicts.push(BollettazioneConflictDto {
                            field: "numero".into(),
                            label: "Numero lotto".into(),
                            current: json!("Presente su più righe"),
                            proposed: json!(row.reference),
                            current_display: None,
                            proposed_display: None,
                            blocking: true,
                        });
                    }
                } else if row.reference_ambiguous {
                    reason = row
                        .reference_warning
                        .clone()
                        .unwrap_or_else(|| "Riferimento ambiguo: controllo obbligatorio".into());
                } else if normalized.family.is_empty()
                    || normalized.product_id.is_empty()
                    || normalized.vials <= 0
                {
                    reason = "Trattamento o numero di fiale non presente nel catalogo".into();
                } else if let Some(row_id) = automatic.by_source.get(&index) {
                    let matched = alternatives
                        .iter()
                        .find(|item| &item.row_id == row_id)
                        .cloned()
                        .or_else(|| {
                            ranked
                                .iter()
                                .find(|item| &candidates[item.candidate_index].row_id == row_id)
                                .map(|item| {
                                    ranked_to_dto(
                                        item,
                                        &candidates[item.candidate_index],
                                        &row.reference,
                                        normalized,
                                    )
                                })
                        });
                    if let Some(matched) = matched {
                        let match_has_conflicts = !matched.conflicts.is_empty();
                        let matched_row_id = matched.row_id.clone();
                        let candidate = candidates
                            .iter()
                            .find(|candidate| candidate.row_id == matched_row_id);
                        let matched_ranked = ranked.iter().find(|item| {
                            candidates[item.candidate_index].row_id == matched_row_id
                        });
                        let product_conflict = matched.conflicts.iter().any(|conflict| {
                            matches!(conflict.field.as_str(), "prodotto_id" | "prodotto_nome")
                        }) || matched_ranked.is_some_and(|item| item.product_score < 1.0);
                        let veb_cross_family = candidate
                            .is_some_and(|candidate| veb_products_cross_family(normalized, candidate));
                        let veb_conflict = veb_cross_family;
                        let patient_soft = match (candidate, matched_ranked) {
                            (Some(candidate), Some(item)) => patient_is_soft_match(
                                &row.patient,
                                &candidate.patient,
                                item.patient_score,
                            ),
                            _ => false,
                        };
                        selected_match = Some(matched);
                        if quantity_issue {
                            reason = "Quantità maggiore di uno: servono più riferimenti".into();
                        } else if lab_issue {
                            reason =
                                format!("Stato laboratorio «{}» da controllare", row.lab_status);
                        } else {
                            let mut reasons = Vec::new();
                            if normalized.product_fallback {
                                reasons.push(MOTIVAZIONE_PRODOTTO_NON_CORRISPONDE);
                            }
                            if patient_soft {
                                reasons.push("Nome paziente diverso, cognome compatibile");
                            }
                            if veb_conflict {
                                reasons.push(MOTIVAZIONE_PRODOTTO_NON_CORRISPONDE);
                            } else if product_conflict {
                                reasons.push(product_conflict_reason(
                                    normalized,
                                    candidate.expect("candidate selected for automatic assignment"),
                                ));
                            } else if match_has_conflicts {
                                reasons.push("Alcuni campi differiscono dai dati del gestionale");
                            }
                            if automatic.forced_review.contains(&index)
                                && reasons.is_empty()
                            {
                                reasons.push("Abbinamento da verificare");
                            }
                            if reasons.is_empty() {
                                status = STATO_PRONTO.into();
                                reason = if automatic.group_sources.contains(&index) {
                                    "Assegnazione per gruppo equivalente: ordine e prodotto corrispondono"
                                        .into()
                                } else {
                                    "Paziente, medico e prodotto corrispondono".into()
                                };
                            } else {
                                reason = reasons.join("; ");
                            }
                        }
                    }
                } else if normalized.product_fallback {
                    if let Some(best) = ranked.first() {
                        selected_match = alternatives
                            .iter()
                            .find(|item| item.row_id == candidates[best.candidate_index].row_id)
                            .cloned();
                    }
                    reason =
                        MOTIVAZIONE_PRODOTTO_NON_CORRISPONDE.into();
                } else if let Some(best) = ranked.first() {
                    if best.patient_score < 0.45 {
                        status = STATO_NON_TROVATO.into();
                        reason = "Nessuna riga ordine compatibile".into();
                    } else {
                        reason = "L'abbinamento richiede una scelta dell'operatore".into();
                    }
                } else {
                    status = STATO_NON_TROVATO.into();
                    reason = "Nessuna riga Immunoterapia ancora spedibile".into();
                }

                // Le alternative servono soltanto quando l'operatore può cambiare
                // associazione. Sulle righe già pronte o già registrate sarebbero
                // payload duplicato rispetto al match selezionato (o del tutto inutili).
                if matches!(status.as_str(), STATO_PRONTO | STATO_REGISTRATO) {
                    alternatives.clear();
                }

                rows.push(BollettazioneRowDto {
                    source: row.source.clone(),
                    source_row: row.source_row,
                    reference: row.reference.clone(),
                    raw_reference: row.raw_reference.clone(),
                    reference_warning: row.reference_warning.clone(),
                    patient: row.patient.clone(),
                    doctor: row.doctor.clone(),
                    treatment: row.treatment.clone(),
                    status,
                    reason,
                    selected_match,
                    alternatives,
                    conflicts,
                    quantity_issue,
                });
            }
            let totals = BollettazioneTotalsDto {
                ready: rows.iter().filter(|row| row.status == STATO_PRONTO).count(),
                review: rows
                    .iter()
                    .filter(|row| row.status == STATO_CONTROLLO)
                    .count(),
                not_found: rows
                    .iter()
                    .filter(|row| row.status == STATO_NON_TROVATO)
                    .count(),
                already_registered: rows
                    .iter()
                    .filter(|row| row.status == STATO_REGISTRATO)
                    .count(),
                valid_rows: rows.len(),
                failed_files: files.iter().filter(|file| file.error.is_some()).count(),
            };
            Ok(BollettazioneAnalisiDto {
                files,
                rows,
                totals,
            })
        })
    }

    pub fn bollettazione_conferma(
        &self,
        input: BollettazioneConfermaIn,
    ) -> AppResult<BollettazioneConfermaDto> {
        crate::premium::ensure_access(self)?;
        if !matches!(input.mode.as_str(), "arrivato_it" | "spedizione") {
            return Err("esito della bollettazione non valido".into());
        }
        if input.rows.is_empty() {
            return Err("nessuna riga confermata".into());
        }
        if input.mode == "spedizione" && input.shipments.is_empty() {
            return Err("nessuna spedizione preparata".into());
        }
        let row_ids: HashSet<String> = input.rows.iter().map(|row| row.row_id.clone()).collect();
        if row_ids.len() != input.rows.len() {
            return Err("la stessa riga è stata usata più volte".into());
        }
        let references: HashSet<String> = input
            .rows
            .iter()
            .map(|row| riferimento_chiave(&row.source_reference))
            .collect();
        if references.len() != input.rows.len() || references.contains("") {
            return Err("ogni riferimento può essere confermato una sola volta".into());
        }
        let shipment_ids: Vec<String> = input
            .shipments
            .iter()
            .map(|_| Ulid::generate().to_string())
            .collect();
        let lotto = Ulid::generate().to_string();
        self.with_engine(|engine| {
            engine
                .emit_built_checked(|projection| {
                    let mut mutations = Vec::new();
                    let mut orders = HashSet::new();
                    let by_row: HashMap<String, &BollettazioneConfermaRigaIn> = input
                        .rows
                        .iter()
                        .map(|row| (row.row_id.clone(), row))
                        .collect();
                    for row in &input.rows {
                        let current = projection
                            .get("riga_ordine", &row.row_id)
                            .map_err(|error| error.to_string())?
                            .ok_or_else(|| "una riga non è più disponibile".to_string())?;
                        if current.updated_hlc.to_string() != row.expected_row_revision {
                            return Err(
                                "una riga è cambiata durante la revisione: ricarica i file".into(),
                            );
                        }
                        let order_id = str_field(&current.data, "ordine_id");
                        if order_id != row.order_id {
                            return Err("una riga non appartiene più all'ordine revisionato".into());
                        }
                        let order = projection
                            .get("ordine", &order_id)
                            .map_err(|error| error.to_string())?
                            .ok_or_else(|| "un ordine non è più disponibile".to_string())?;
                        if order.updated_hlc.to_string() != row.expected_order_revision {
                            return Err(
                                "un ordine è cambiato durante la revisione: ricarica i file".into(),
                            );
                        }
                        if matches!(
                            str_field(&order.data, "stato").as_str(),
                            "Rifiutato" | "Annullato"
                        ) {
                            return Err("un ordine non è più utilizzabile".into());
                        }
                        if riga_spedita(&current.data) {
                            return Err("una riga è già stata spedita".into());
                        }
                        let mut fields = row.accepted_fields.clone();
                        let accepted_number = fields
                            .get("numero")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string)
                            .ok_or_else(|| {
                                "la conferma deve indicare il numero lotto scelto".to_string()
                            })?;
                        let accepted_lines: Vec<String> = accepted_number
                            .lines()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(riferimento_chiave)
                            .collect();
                        let accepted_numbers: HashSet<String> =
                            accepted_lines.iter().cloned().collect();
                        fields.insert("numero".into(), json!(accepted_lines.join("\n")));
                        for other in projection.list("riga_ordine").unwrap_or_default() {
                            if other.id == row.row_id {
                                continue;
                            }
                            if str_field(&other.data, "numero").lines().any(|value| {
                                let value = value.trim();
                                !value.is_empty()
                                    && (riferimento_chiave(value)
                                        == riferimento_chiave(&row.source_reference)
                                        || accepted_numbers.contains(&riferimento_chiave(value)))
                            }) {
                                return Err("un riferimento è già assegnato a un'altra riga".into());
                            }
                        }
                        let allowed = ["numero", "prodotto_id", "prodotto_nome"];
                        if fields
                            .keys()
                            .any(|field| !allowed.contains(&field.as_str()))
                        {
                            return Err("la conferma contiene un campo non modificabile".into());
                        }
                        for field in ["numero", "prodotto_id", "prodotto_nome"] {
                            if fields.get(field).is_some_and(|value| !value.is_string()) {
                                return Err("la conferma contiene un valore non valido".to_string());
                            }
                        }
                        if let Some(product_id) = fields.get("prodotto_id").and_then(Value::as_str)
                        {
                            let product = projection
                                .get("prodotto", product_id)
                                .map_err(|error| error.to_string())?
                                .ok_or_else(|| "il prodotto scelto non esiste più".to_string())?;
                            if str_field(&product.data, "categoria") != "Immunoterapia" {
                                return Err(
                                    "il prodotto scelto non appartiene all'Immunoterapia".into()
                                );
                            }
                        }
                        valida_numeri_lotto(
                            i64_field(&current.data, "qta"),
                            fields.get("numero").and_then(Value::as_str).unwrap_or(""),
                        )?;
                        for (field, value) in fields {
                            mutations.push(Mutation::new(
                                "riga_ordine",
                                row.row_id.clone(),
                                EventBody::FieldSet { field, value },
                            ));
                        }
                        if input.mode == "arrivato_it" {
                            mutations.push(Mutation::new(
                                "riga_ordine",
                                row.row_id.clone(),
                                EventBody::FieldSet {
                                    field: "stato_produzione".into(),
                                    value: json!("arrivato_it"),
                                },
                            ));
                        }
                        orders.insert(order_id);
                    }

                    if input.mode == "spedizione" {
                        let mut shipment_rows = HashSet::new();
                        for (shipment_index, shipment) in input.shipments.iter().enumerate() {
                            if shipment.row_ids.is_empty() {
                                return Err("una spedizione non contiene righe".into());
                            }
                            let numbers: Vec<RigaNumeroIn> = shipment
                                .row_ids
                                .iter()
                                .map(|row_id| {
                                    let row = by_row.get(row_id).ok_or_else(|| {
                                        "una spedizione usa una riga non revisionata".to_string()
                                    })?;
                                    if !shipment_rows.insert(row_id.clone()) {
                                        return Err(
                                            "la stessa riga compare in più spedizioni".into()
                                        );
                                    }
                                    Ok(RigaNumeroIn {
                                        riga_id: row_id.clone(),
                                        numero: row
                                            .accepted_fields
                                            .get("numero")
                                            .and_then(Value::as_str)
                                            .unwrap_or_default()
                                            .trim()
                                            .to_string(),
                                    })
                                })
                                .collect::<Result<_, String>>()?;
                            let params = SpedizioneCreateParams {
                                data: &shipment.data,
                                corriere_id: &shipment.corriere_id,
                                colli: shipment.colli,
                                peso: shipment.peso,
                                servizi: &shipment.servizi,
                                preavviso: shipment.preavviso,
                                mezzo: &shipment.mezzo,
                                contrassegno: shipment.contrassegno,
                                note: &shipment.note,
                                righe: &numbers,
                            };
                            mutations.extend(prepara_spedizione_mutations(
                                projection,
                                &shipment_ids[shipment_index],
                                &lotto,
                                &params,
                            )?);
                        }
                        if shipment_rows != row_ids {
                            return Err(
                                "alcune righe revisionate non sono incluse nelle spedizioni".into(),
                            );
                        }
                    }

                    // Lo stato di produzione e la data di arrivo fanno parte dello stesso batch
                    // soltanto per l'esito «arrivato_it» (la spedizione segue il normale ciclo di evasione).
                    if input.mode == "arrivato_it" {
                        for order_id in &orders {
                            for (field, value) in campi_stato_produzione(
                                projection,
                                order_id,
                                &row_ids,
                                &input.data_arrivo,
                            ) {
                                mutations.push(Mutation::new(
                                    "ordine",
                                    order_id.clone(),
                                    EventBody::FieldSet { field, value },
                                ));
                            }
                        }
                    }
                    Ok(mutations)
                })
                .map_err(es)?;

            let mut order_ids = HashSet::new();
            for row in &input.rows {
                order_ids.insert(row.order_id.clone());
            }
            if input.mode == "spedizione" {
                let threshold = data_giorni_fa(GIORNI_CHIUSURA);
                for order_id in &order_ids {
                    conferma_se_nuovo(engine, order_id)?;
                    aggiorna_stato_evasione(engine, order_id)?;
                    let shipment_date =
                        engine.with_projection(|p| ordine_data_spedizione(p, order_id));
                    riallinea_scadenze_da_spedizione(engine, order_id, &shipment_date)?;
                    prova_chiudi_ordine(engine, order_id, &threshold)?;
                }
            }
            let shipments = if input.mode == "spedizione" {
                shipment_ids
                    .iter()
                    .map(|id| self.spedizione_dto(engine, id))
                    .collect::<AppResult<Vec<_>>>()?
            } else {
                Vec::new()
            };
            Ok(BollettazioneConfermaDto {
                mode: input.mode,
                updated_rows: input.rows.len(),
                shipments,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fields(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs
            .iter()
            .map(|(field, value)| (field.to_string(), value.clone()))
            .collect()
    }

    fn test_state() -> (tempfile::TempDir, tempfile::TempDir, AppState) {
        let app = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fs::write(app.path().join("premium.json"), br#"{"enabled":true}"#).unwrap();
        let state = AppState::init(app.path().to_path_buf()).unwrap();
        state.open_data_dir(data.path().to_str().unwrap()).unwrap();
        state
            .finish_onboarding(FinishOnboarding {
                data_dir: data.path().to_string_lossy().into_owned(),
                mode: "create".into(),
                user_id: Some(Ulid::generate().to_string()),
                nome: "Tester bollettazione".into(),
                avatar_tipo: "iniziali".into(),
                avatar_valore: String::new(),
            })
            .unwrap();
        (app, data, state)
    }

    fn order_with_rows(state: &AppState, count: usize) -> OrdineSalvaBaseResult {
        let client = state
            .record_create("cliente", fields(&[("nome", json!("Paziente Test"))]))
            .unwrap();
        let doctor = state
            .record_create("medico", fields(&[("nome", json!("Medico Test"))]))
            .unwrap();
        let product = state
            .records_list("prodotto")
            .unwrap()
            .into_iter()
            .find(|record| record.data.get("nome") == Some(&json!("Polimerizzato 1 fiala")))
            .unwrap();
        state
            .ordine_salva_base(OrdineSalvaBaseInput {
                id: None,
                rimborso_extra: None,
                expected_righe: Vec::new(),
                fields: fields(&[
                    ("stato", json!("In produzione")),
                    ("data", json!("2026-08-01")),
                    ("categoria", json!("Immunoterapia")),
                    ("cliente_id", json!(client.id)),
                    ("medico_id", json!(doctor.id)),
                ]),
                righe: (0..count)
                    .map(|index| OrdineSalvaRigaInput {
                        id: None,
                        fields: fields(&[
                            ("prodotto_id", json!(product.id)),
                            ("prodotto_nome", json!("Polimerizzato 1 fiala")),
                            ("paziente", json!(format!("Paziente Test {index}"))),
                            ("qta", json!(1)),
                            ("prezzo", json!(28_000)),
                        ]),
                    })
                    .collect(),
            })
            .unwrap()
    }

    fn confirmation(
        order: &OrdineSalvaBaseResult,
        index: usize,
        reference: &str,
    ) -> BollettazioneConfermaRigaIn {
        BollettazioneConfermaRigaIn {
            source_reference: reference.into(),
            row_id: order.righe[index].id.clone(),
            order_id: order.id.clone(),
            expected_row_revision: order.righe[index].revision.clone(),
            expected_order_revision: order.ordine.revision.clone(),
            accepted_fields: fields(&[
                ("numero", json!(reference)),
                (
                    "prodotto_id",
                    order.righe[index].data["prodotto_id"].clone(),
                ),
                ("prodotto_nome", json!("Polimerizzato 1 fiala")),
            ]),
        }
    }

    #[test]
    fn normalizzazione_nomi_tollera_titoli_accenti_e_ordine() {
        assert_eq!(normalizza_nome("Dott.ssa Ánna D'Errico"), "anna d errico");
        assert_eq!(name_similarity("Mario Rossi", "Rossi Mario"), 1.0);
        assert!(name_similarity("Giusepe Bianchi", "Giuseppe Bianchi") > 0.86);
    }

    #[test]
    fn normalizzazione_riferimenti_corregge_solo_formati_laboratorio_noti() {
        for (raw, expected) in [
            ("05080720", "5080720"),
            ("05080719", "5080719"),
            ("0581348", "5081348"),
        ] {
            let normalized = normalizza_riferimento(raw);
            assert_eq!(normalized.value, expected);
            assert!(normalized.warning.is_some());
            assert!(!normalized.ambiguous);
        }
        assert_eq!(normalizza_riferimento("00123").value, "00123");
        assert_eq!(normalizza_riferimento("LOT-001").value, "LOT-001");
        let exact = normalizza_riferimento("5080700");
        assert_eq!(exact.value, "5080700");
        assert!(exact.warning.is_none());
        assert!(!exact.ambiguous);
        assert_eq!(riferimento_chiave("05080720"), "5080720");
    }

    #[test]
    fn trattamento_riconosce_pro2_veb_sottocute_e_fallback() {
        let products = vec![
            ("prod-pol-pro".into(), "Polimerizzato PRO".into()),
            ("prod-sub-pro".into(), "Sublinguale PRO".into()),
            ("prod-pol-1".into(), "Polimerizzato 1 fiala".into()),
        ];
        let row = |treatment: &str| RigaLaboratorio {
            source: "fixture.xlsx".into(),
            source_row: 2,
            reference: "5080001".into(),
            raw_reference: None,
            reference_warning: None,
            reference_ambiguous: false,
            lab_status: String::new(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            treatment: treatment.into(),
            quantity: 1,
            vials: 1,
            composition: String::new(),
        };
        let canonical = Vec::new();
        let beltavac = normalize_treatment(
            &row("BELTAVAC Polimerizado PRO2 1 Vial (ITA)"),
            &products,
            &canonical,
        );
        assert_eq!(beltavac.product_name, "Polimerizzato PRO");
        assert_eq!(beltavac.product_id, "prod-pol-pro");
        assert!(!beltavac.product_fallback);

        let beltaoral =
            normalize_treatment(&row("BELTAORAL PRO2 1 Vial (ITA)"), &products, &canonical);
        assert_eq!(beltaoral.product_name, "Sublinguale PRO");
        assert_eq!(beltaoral.product_id, "prod-sub-pro");

        let veb = normalize_treatment(&row("VEB Sottocutanea 1 Vial (ITA)"), &products, &canonical);
        assert_eq!(veb.formulation, "VEB sottocute");

        let fallback = normalize_treatment(
            &row("BELTAVAC Polimerizado PRO2 1 Vial (ITA)"),
            &products[2..],
            &canonical,
        );
        assert_eq!(fallback.product_name, "Polimerizzato 1 fiala");
        assert_eq!(fallback.product_id, "prod-pol-1");
        assert!(fallback.product_fallback);
    }

    #[test]
    fn medico_abbreviato_e_cognome_solo_restano_compatibili() {
        assert!(doctor_similarity("G. Tramaloni", "Giovanni Tramaloni") >= 0.95);
        assert!(doctor_similarity("Eustachio Nettis", "Nettis") >= 0.95);
        assert!(doctor_similarity("Mario Rossi", "Luigi Bianchi") < 0.55);
    }

    #[test]
    fn nomi_medico_completi_usano_la_similarita_generale() {
        assert_eq!(
            doctor_similarity("Antonio Rinciani Agente Demo 003", "Antonio Rinciani Agente Demo 003"),
            1.0
        );
        assert!(doctor_similarity("Antonio Rinciani", "Antonio Rinciani Agente Demo 003") >= 0.55);
        assert!(
            doctor_similarity("Antonio Rinciani Agente Demo 003", "Antonio Rinciani Infarinato") >= 0.55
        );
        assert!(doctor_similarity("Paolo Cioffi", "Pellegrini") < 0.55);

        let initial_score = patient_similarity("M. Grazia Capoccia", "Maria Grazia Capoccia");
        assert!(initial_score >= 0.95);
        assert!(!patient_is_soft_match(
            "M. Grazia Capoccia",
            "Maria Grazia Capoccia",
            initial_score
        ));

        let macri_score = patient_similarity("Pablo Macri", "Lorenzo Macri");
        assert!(patient_is_soft_match(
            "Pablo Macri",
            "Lorenzo Macri",
            macri_score
        ));
        assert!(!patient_is_soft_match(
            "Pablo Macri",
            "Lorenzo Rossi",
            patient_similarity("Pablo Macri", "Lorenzo Rossi")
        ));
    }

    #[test]
    fn prodotti_storici_e_fiale_discordanti_restano_proponibili_ma_segnalati() {
        let candidate = |product_id: &str, product_name: &str| Candidato {
            row_id: "row-1".into(),
            row_revision: "rev-row".into(),
            order_id: "order-1".into(),
            order_revision: "rev-order".into(),
            order_number: "2026-0001".into(),
            order_date: "2026-08-03".into(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            product_id: product_id.into(),
            product_name: product_name.into(),
            formulation: String::new(),
            dosage: String::new(),
            current_fields: Map::new(),
        };
        let veb = TrattamentoNormalizzato {
            family: "veb".into(),
            product_id: "lisato-2".into(),
            product_name: "Lisato batterico 2 fiale".into(),
            formulation: "spray".into(),
            dosage: String::new(),
            allergens: Vec::new(),
            vials: 2,
            product_fallback: false,
            veb_product_ambiguous: true,
        };
        let sublinguale = candidate("sublinguale-2", "Sublinguale 2 fiale");
        assert_eq!(product_score_for(&veb, &sublinguale), 0.55);
        assert_eq!(
            product_conflict_reason(&veb, &sublinguale),
            "I prodotti non corrispondono"
        );
        let veb_four = candidate("lisato-4", "Lisato batterico 4 fiale");
        assert_eq!(
            product_conflict_reason(&veb, &veb_four),
            "I prodotti non corrispondono"
        );

        let polimerizzato = TrattamentoNormalizzato {
            family: "beltavac".into(),
            product_id: "polimerizzato-2".into(),
            product_name: "Polimerizzato 2 fiale".into(),
            formulation: "polimerizzato".into(),
            dosage: String::new(),
            allergens: Vec::new(),
            vials: 2,
            product_fallback: false,
            veb_product_ambiguous: false,
        };
        let one_vial = candidate("polimerizzato-1", "Polimerizzato 1 fiala");
        assert_eq!(product_score_for(&polimerizzato, &one_vial), 0.55);
        assert_eq!(
            product_conflict_reason(&polimerizzato, &one_vial),
            "I prodotti non corrispondono"
        );

        let pro = TrattamentoNormalizzato {
            family: "beltavac".into(),
            product_id: "polimerizzato-pro".into(),
            product_name: "Polimerizzato PRO".into(),
            formulation: "polimerizzato".into(),
            dosage: String::new(),
            allergens: Vec::new(),
            vials: 2,
            product_fallback: false,
            veb_product_ambiguous: false,
        };
        let standard = candidate("polimerizzato-2", "Polimerizzato 2 fiale");
        assert_eq!(product_score_for(&pro, &standard), 0.55);
        assert_eq!(
            product_conflict_reason(&pro, &standard),
            "I prodotti non corrispondono"
        );
    }

    #[test]
    fn medico_con_nome_completo_unico_puo_essere_pronto() {
        let row = RigaLaboratorio {
            source: "fixture.xlsx".into(),
            source_row: 2,
            reference: "5080002".into(),
            raw_reference: None,
            reference_warning: None,
            reference_ambiguous: false,
            lab_status: String::new(),
            patient: "Paziente Test".into(),
            doctor: "Antonio Rinciani Agente Demo 003".into(),
            treatment: "BELTAVAC Polimerizado 1 Vial".into(),
            quantity: 1,
            vials: 1,
            composition: String::new(),
        };
        let candidate = Candidato {
            row_id: "row-1".into(),
            row_revision: "rev-row".into(),
            order_id: "order-1".into(),
            order_revision: "rev-order".into(),
            order_number: "2026-0001".into(),
            order_date: "2026-08-03".into(),
            patient: "Paziente Test".into(),
            doctor: "Antonio Rinciani Agente Demo 003".into(),
            product_id: "product-1".into(),
            product_name: "Polimerizzato 1 fiala".into(),
            formulation: "polimerizzato".into(),
            dosage: String::new(),
            current_fields: Map::new(),
        };
        let ranked = Ranked {
            candidate_index: 0,
            score: 0.866,
            patient_score: 1.0,
            doctor_score: doctor_similarity(
                "Antonio Rinciani Agente Demo 003",
                "Antonio Rinciani Agente Demo 003",
            ),
            product_score: 1.0,
        };
        let assignments =
            automatic_assignments(&[row], &[candidate], &[vec![ranked]], &HashSet::new());
        assert_eq!(assignments.by_source.len(), 1);
        assert!(assignments.forced_review.is_empty());
    }

    #[test]
    fn allergeni_assenti_non_alterano_il_punteggio_di_associazione() {
        let row = RigaLaboratorio {
            source: "fixture.xlsx".into(),
            source_row: 2,
            reference: "5080001".into(),
            raw_reference: None,
            reference_warning: None,
            reference_ambiguous: false,
            lab_status: String::new(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            treatment: "BELTAVAC Polimerizado 1 Vial".into(),
            quantity: 1,
            vials: 1,
            composition: String::new(),
        };
        let candidate = Candidato {
            row_id: "row-1".into(),
            row_revision: "rev-row".into(),
            order_id: "order-1".into(),
            order_revision: "rev-order".into(),
            order_number: "2026-0001".into(),
            order_date: "2026-08-03".into(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            product_id: "prod-1".into(),
            product_name: "Polimerizzato 1 fiala".into(),
            formulation: "polimerizzato".into(),
            dosage: String::new(),
            current_fields: Map::new(),
        };
        let mut normalized = TrattamentoNormalizzato {
            family: "beltavac".into(),
            product_id: "prod-1".into(),
            product_name: "Polimerizzato 1 fiala".into(),
            formulation: "polimerizzato".into(),
            dosage: String::new(),
            allergens: Vec::new(),
            vials: 1,
            product_fallback: false,
            veb_product_ambiguous: false,
        };
        let without_allergens = rank_candidate(&row, &normalized, 0, &candidate);
        normalized.allergens.push("non identificato".into());
        let with_unmatched_allergens = rank_candidate(&row, &normalized, 0, &candidate);
        assert_eq!(without_allergens.score, with_unmatched_allergens.score);
    }

    #[test]
    fn conflitto_prodotto_espone_i_nomi_e_non_gli_id_tecnici() {
        let normalized = TrattamentoNormalizzato {
            family: "lisato".into(),
            product_id: "__seed_prod_lisato_batterico_2_fiale__".into(),
            product_name: "Lisato batterico 2 fiale".into(),
            formulation: String::new(),
            dosage: String::new(),
            allergens: Vec::new(),
            vials: 2,
            product_fallback: false,
            veb_product_ambiguous: false,
        };
        let current = fields(&[("prodotto_id", json!("__seed_prod_sublinguale_2_fiale__"))]);

        let (_, conflicts) =
            proposed_and_conflicts("5081854", &normalized, &current, "Sublinguale 2 fiale");
        let product = conflicts
            .iter()
            .find(|conflict| conflict.field == "prodotto_id")
            .unwrap();

        assert_eq!(
            product.current_display.as_deref(),
            Some("Sublinguale 2 fiale")
        );
        assert_eq!(
            product.proposed_display.as_deref(),
            Some("Lisato batterico 2 fiale")
        );
    }

    #[test]
    fn dettagli_produzione_non_vengono_proposti_ne_segnalati() {
        let normalized = TrattamentoNormalizzato {
            family: "veb".into(),
            product_id: "prod-lisato-2".into(),
            product_name: "Lisato batterico 2 fiale".into(),
            formulation: "spray".into(),
            dosage: "2+2".into(),
            allergens: vec!["d.farinae".into()],
            vials: 2,
            product_fallback: false,
            veb_product_ambiguous: false,
        };
        let current = fields(&[
            ("prodotto_id", json!("prod-lisato-2")),
            ("prodotto_nome", json!("Lisato batterico 2 fiale")),
            ("formulazione", json!("gocce")),
            ("posologia", json!("1+1")),
            ("allergeni", json!(["parietaria"])),
        ]);

        let (proposed, conflicts) =
            proposed_and_conflicts("5080001", &normalized, &current, "Lisato batterico 2 fiale");
        assert_eq!(proposed.get("numero"), Some(&json!("5080001")));
        assert_eq!(proposed.get("prodotto_id"), Some(&json!("prod-lisato-2")));
        assert_eq!(
            proposed.get("prodotto_nome"),
            Some(&json!("Lisato batterico 2 fiale"))
        );
        assert!(!proposed.contains_key("formulazione"));
        assert!(!proposed.contains_key("posologia"));
        assert!(!proposed.contains_key("allergeni"));
        assert!(conflicts.iter().all(|conflict| {
            !matches!(
                conflict.field.as_str(),
                "formulazione" | "posologia" | "allergeni"
            )
        }));
    }

    #[test]
    fn trattamento_non_confonde_pro_ml_e_fiale_con_posologia() {
        assert_eq!(parse_dosage("BELTAVAC Polimerizado PRO2 1 Vial"), "");
        assert_eq!(
            parse_dosage("BELTAORAL DUO Spray 9 ml 2,2,2 (ITA)"),
            "2+2+2"
        );
        assert_eq!(parse_dosage("BELTAORAL DUO 2 Viales (ITA)"), "");
        assert_eq!(parse_dosage("VEB NasaleOrale 1,2,3,3 (ITA)"), "1+2+3+3");
        assert_eq!(parse_dosage("BELTAVAC Polimerizado 3 (ITA)"), "3");
    }

    #[test]
    fn allergeni_convergono_sul_catalogo_e_mantengono_i_liberi() {
        let canonical = vec![
            "d.farinae".to_string(),
            "mix graminacee".to_string(),
            "olea europea".to_string(),
        ];
        assert_eq!(
            canonicalizza_allergene("Dermatophagoides farinae polimerizado 50%", &canonical),
            "d.farinae"
        );
        assert_eq!(
            canonicalizza_allergene("Gramíneas espontáneas polim. 50%", &canonical),
            "mix graminacee"
        );
        assert_eq!(
            canonicalizza_allergene("Nuovo allergene 100%", &canonical),
            "Nuovo allergene"
        );
    }

    #[test]
    fn assegnazione_globale_non_riusa_la_stessa_riga_ordine_e_rispetta_la_cardinalita() {
        let source = |reference: &str| RigaLaboratorio {
            source: "fixture.xlsx".into(),
            source_row: 2,
            reference: reference.into(),
            raw_reference: None,
            reference_warning: None,
            reference_ambiguous: false,
            lab_status: String::new(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            treatment: "BELTAVAC Polimerizado 3".into(),
            quantity: 1,
            vials: 1,
            composition: String::new(),
        };
        let candidate = Candidato {
            row_id: "row-1".into(),
            row_revision: "rev-row".into(),
            order_id: "order-1".into(),
            order_revision: "rev-order".into(),
            order_number: "2026-0001".into(),
            order_date: "2026-08-03".into(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            product_id: "product-1".into(),
            product_name: "Polimerizzato 1 fiala".into(),
            formulation: "polimerizzato".into(),
            dosage: "3".into(),
            current_fields: Map::new(),
        };
        let ranked = |score: f64| Ranked {
            candidate_index: 0,
            score,
            patient_score: 1.0,
            doctor_score: 1.0,
            product_score: 1.0,
        };
        let assignments = automatic_assignments(
            &[source("LOT-A"), source("LOT-B")],
            &[candidate],
            &[vec![ranked(0.96)], vec![ranked(0.95)]],
            &HashSet::new(),
        );
        assert!(assignments.by_source.is_empty());
    }

    #[test]
    fn gruppo_equivalente_assegna_tutte_le_righe_dello_stesso_ordine() {
        let source = |reference: &str| RigaLaboratorio {
            source: "fixture.xlsx".into(),
            source_row: 2,
            reference: reference.into(),
            raw_reference: None,
            reference_warning: None,
            reference_ambiguous: false,
            lab_status: String::new(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            treatment: "BELTAVAC Polimerizzato 1 Vial".into(),
            quantity: 1,
            vials: 1,
            composition: String::new(),
        };
        let candidate = |row_id: &str| Candidato {
            row_id: row_id.into(),
            row_revision: "rev-row".into(),
            order_id: "order-1".into(),
            order_revision: "rev-order".into(),
            order_number: "2026-0001".into(),
            order_date: "2026-08-03".into(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            product_id: "product-1".into(),
            product_name: "Polimerizzato 1 fiala".into(),
            formulation: "polimerizzato".into(),
            dosage: String::new(),
            current_fields: Map::new(),
        };
        let ranked = |candidate_index: usize| Ranked {
            candidate_index,
            score: 0.91,
            patient_score: 1.0,
            doctor_score: 1.0,
            product_score: 1.0,
        };
        let assignments = automatic_assignments(
            &[source("LOT-A"), source("LOT-B")],
            &[candidate("row-1"), candidate("row-2")],
            &[vec![ranked(0), ranked(1)], vec![ranked(0), ranked(1)]],
            &HashSet::new(),
        );

        assert_eq!(assignments.by_source.len(), 2);
        assert_eq!(assignments.group_sources.len(), 2);
        assert_eq!(
            assignments.by_source.get(&0).map(String::as_str),
            Some("row-1")
        );
        assert_eq!(
            assignments.by_source.get(&1).map(String::as_str),
            Some("row-2")
        );
    }

    #[test]
    fn gruppo_equivalente_collassa_duplicati_fisici_dello_stesso_ordine() {
        let source = RigaLaboratorio {
            source: "fixture.xlsx".into(),
            source_row: 2,
            reference: "LOT-A".into(),
            raw_reference: None,
            reference_warning: None,
            reference_ambiguous: false,
            lab_status: String::new(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            treatment: "BELTAVAC Polimerizzato 1 Vial".into(),
            quantity: 1,
            vials: 1,
            composition: String::new(),
        };
        let candidate = |row_id: &str| Candidato {
            row_id: row_id.into(),
            row_revision: "rev-row".into(),
            order_id: "order-1".into(),
            order_revision: "rev-order".into(),
            order_number: "2026-0001".into(),
            order_date: "2026-08-03".into(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            product_id: "product-1".into(),
            product_name: "Polimerizzato 1 fiala".into(),
            formulation: "polimerizzato".into(),
            dosage: String::new(),
            current_fields: Map::new(),
        };
        let ranked = |candidate_index: usize| Ranked {
            candidate_index,
            score: 0.91,
            patient_score: 1.0,
            doctor_score: 1.0,
            product_score: 1.0,
        };
        let assignments = automatic_assignments(
            &[source],
            &[candidate("row-1"), candidate("row-2")],
            &[vec![ranked(0), ranked(1)]],
            &HashSet::new(),
        );

        assert_eq!(assignments.by_source.len(), 1);
        assert!(assignments.group_sources.contains(&0));
        assert_eq!(
            assignments.by_source.get(&0).map(String::as_str),
            Some("row-1")
        );
    }

    #[test]
    fn gruppo_equivalente_non_attraversa_ordini_diversi() {
        let source = |reference: &str| RigaLaboratorio {
            source: "fixture.xlsx".into(),
            source_row: 2,
            reference: reference.into(),
            raw_reference: None,
            reference_warning: None,
            reference_ambiguous: false,
            lab_status: String::new(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            treatment: "BELTAVAC Polimerizzato 1 Vial".into(),
            quantity: 1,
            vials: 1,
            composition: String::new(),
        };
        let candidate = |row_id: &str, order_id: &str| Candidato {
            row_id: row_id.into(),
            row_revision: "rev-row".into(),
            order_id: order_id.into(),
            order_revision: "rev-order".into(),
            order_number: order_id.into(),
            order_date: "2026-08-03".into(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            product_id: "product-1".into(),
            product_name: "Polimerizzato 1 fiala".into(),
            formulation: "polimerizzato".into(),
            dosage: String::new(),
            current_fields: Map::new(),
        };
        let ranked = |candidate_index: usize| Ranked {
            candidate_index,
            score: 0.91,
            patient_score: 1.0,
            doctor_score: 1.0,
            product_score: 1.0,
        };
        let assignments = automatic_assignments(
            &[source("LOT-A"), source("LOT-B")],
            &[candidate("row-1", "order-1"), candidate("row-2", "order-2")],
            &[vec![ranked(0), ranked(1)], vec![ranked(0), ranked(1)]],
            &HashSet::new(),
        );

        assert!(assignments.by_source.is_empty());
        assert!(assignments.group_sources.is_empty());
    }

    #[test]
    fn gruppo_equivalente_rispetta_la_cardinalita() {
        let source = |reference: &str| RigaLaboratorio {
            source: "fixture.xlsx".into(),
            source_row: 2,
            reference: reference.into(),
            raw_reference: None,
            reference_warning: None,
            reference_ambiguous: false,
            lab_status: String::new(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            treatment: "BELTAVAC Polimerizado 1 Vial".into(),
            quantity: 1,
            vials: 1,
            composition: String::new(),
        };
        let candidate = Candidato {
            row_id: "row-1".into(),
            row_revision: "rev-row".into(),
            order_id: "order-1".into(),
            order_revision: "rev-order".into(),
            order_number: "2026-0001".into(),
            order_date: "2026-08-03".into(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            product_id: "product-1".into(),
            product_name: "Polimerizzato 1 fiala".into(),
            formulation: "polimerizzato".into(),
            dosage: String::new(),
            current_fields: Map::new(),
        };
        let ranked = Ranked {
            candidate_index: 0,
            score: 0.79,
            patient_score: 1.0,
            doctor_score: 1.0,
            product_score: 1.0,
        };
        let assignments = automatic_assignments(
            &[source("LOT-A"), source("LOT-B")],
            &[candidate],
            &[vec![ranked.clone()], vec![ranked]],
            &HashSet::new(),
        );

        assert!(assignments.by_source.is_empty());
        assert!(assignments.group_sources.is_empty());
    }

    #[test]
    fn duplicato_equivalente_e_prodotto_non_esatto_vengono_proposti() {
        let ranked = |score: f64, product_score: f64| Ranked {
            candidate_index: 0,
            score,
            patient_score: 1.0,
            doctor_score: 1.0,
            product_score,
        };
        let source = RigaLaboratorio {
            source: "fixture.xlsx".into(),
            source_row: 2,
            reference: "5080001".into(),
            raw_reference: None,
            reference_warning: None,
            reference_ambiguous: false,
            lab_status: String::new(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            treatment: "BELTAVAC Polimerizado 1 Vial".into(),
            quantity: 1,
            vials: 1,
            composition: String::new(),
        };
        let candidates = vec![Candidato {
            row_id: "row-1".into(),
            row_revision: "rev-row".into(),
            order_id: "order-1".into(),
            order_revision: "rev-order".into(),
            order_number: "2026-0001".into(),
            order_date: "2026-08-03".into(),
            patient: "Paziente Test".into(),
            doctor: "Medico Test".into(),
            product_id: "product-1".into(),
            product_name: "Polimerizzato 1 fiala".into(),
            formulation: "polimerizzato".into(),
            dosage: "3".into(),
            current_fields: Map::new(),
        }];
        let equivalent_duplicate = automatic_assignments(
            &[source.clone()],
            &candidates,
            &[vec![ranked(0.95, 1.0), ranked(0.90, 1.0)]],
            &HashSet::new(),
        );
        assert_eq!(equivalent_duplicate.by_source.len(), 1);
        assert!(equivalent_duplicate.group_sources.contains(&0));
        let assignments = automatic_assignments(
            &[source],
            &candidates,
            &[vec![ranked(0.96, 0.55)]],
            &HashSet::new(),
        );
        assert_eq!(assignments.by_source.len(), 1);
        assert!(assignments.forced_review.contains(&0));
    }

    #[test]
    fn parser_excel_riconosce_i_due_tracciati_e_conserva_originale() {
        let dir = tempfile::tempdir().unwrap();
        let recent = dir.path().join("recente.xlsx");
        let historical = dir.path().join("storico.xlsx");

        let mut workbook = rust_xlsxwriter::Workbook::new();
        let sheet = workbook.add_worksheet();
        for (column, header) in [
            "Referencia",
            "FechaPedido",
            "FechaCaducidad",
            "Paciente",
            "Doctor",
            "Tratamiento",
            "Treatment Mode",
            "Cantidad",
            "Vials",
            "DescripcionCompleta",
        ]
        .iter()
        .enumerate()
        {
            sheet.write_string(0, column as u16, *header).unwrap();
        }
        sheet.write_string(1, 0, "0581348").unwrap();
        sheet.write_string(1, 3, "Paziente Uno").unwrap();
        sheet.write_string(1, 4, "Medico Uno").unwrap();
        sheet.write_string(1, 5, "BELTAORAL DUO 2,2 (ITA)").unwrap();
        sheet.write_number(1, 7, 1).unwrap();
        sheet.write_number(1, 8, 2).unwrap();
        sheet.write_string(2, 0, "Total").unwrap();
        sheet.write_string(3, 0, "Filtros aplicados").unwrap();
        workbook.save(&recent).unwrap();

        let mut workbook = rust_xlsxwriter::Workbook::new();
        let sheet = workbook.add_worksheet();
        for (column, header) in [
            "Referencia",
            "Fecha Envío",
            "Estado",
            "Paciente",
            "Doctor",
            "Tratamiento",
            "Treatment Mode",
            "Cantidad",
            "Vials",
            "DescripcionCompleta",
        ]
        .iter()
        .enumerate()
        {
            sheet.write_string(0, column as u16, *header).unwrap();
        }
        sheet.write_string(1, 0, "987").unwrap();
        sheet.write_string(1, 2, "Facturado").unwrap();
        sheet.write_string(1, 3, "Paziente Due").unwrap();
        sheet.write_string(1, 4, "Medico Due").unwrap();
        sheet
            .write_string(1, 5, "BELTAVAC Polimerizado 3 (ITA)")
            .unwrap();
        sheet.write_number(1, 7, 1).unwrap();
        sheet.write_number(1, 8, 1).unwrap();
        workbook.save(&historical).unwrap();

        let recent_rows = parse_workbook(&recent).unwrap();
        assert_eq!(recent_rows.len(), 1);
        assert_eq!(recent_rows[0].reference, "5081348");
        assert_eq!(recent_rows[0].raw_reference.as_deref(), Some("0581348"));
        assert!(recent_rows[0].reference_warning.is_some());
        let historical_rows = parse_workbook(&historical).unwrap();
        assert_eq!(historical_rows.len(), 1);
        assert_eq!(historical_rows[0].lab_status, "Facturado");
        assert!(!std::fs::read(&recent).unwrap().is_empty());
    }

    #[test]
    fn parser_excel_supera_buchi_e_righe_incomplete() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("con-buchi.xlsx");
        let mut workbook = rust_xlsxwriter::Workbook::new();
        let sheet = workbook.add_worksheet();
        for (column, header) in [
            "Referencia",
            "Paciente",
            "Doctor",
            "Tratamiento",
            "Cantidad",
            "Vials",
        ]
        .iter()
        .enumerate()
        {
            sheet.write_string(0, column as u16, *header).unwrap();
        }
        sheet.write_string(1, 0, "508245").unwrap();
        sheet.write_string(1, 1, "Paziente Uno").unwrap();
        sheet.write_string(1, 2, "Medico Uno").unwrap();
        sheet
            .write_string(1, 3, "BELTAVAC Polimerizado 3 (ITA)")
            .unwrap();
        sheet.write_number(1, 4, 1).unwrap();
        sheet.write_number(1, 5, 1).unwrap();
        // Riga 2 completamente vuota e riga 3 priva di riferimento: entrambe
        // vengono ignorate senza interrompere la lettura delle righe successive.
        sheet.write_string(3, 1, "Riga incompleta").unwrap();
        sheet.write_string(4, 0, "508246").unwrap();
        sheet.write_string(4, 1, "Paziente Due").unwrap();
        sheet.write_string(4, 2, "Medico Due").unwrap();
        sheet
            .write_string(4, 3, "BELTAVAC Polimerizado 3 (ITA)")
            .unwrap();
        sheet.write_number(4, 4, 1).unwrap();
        sheet.write_number(4, 5, 1).unwrap();
        workbook.save(&path).unwrap();

        let rows = parse_workbook(&path).unwrap();
        assert_eq!(
            rows.iter()
                .map(|row| row.reference.as_str())
                .collect::<Vec<_>>(),
            vec!["508245", "508246"]
        );
        assert_eq!(
            rows.iter().map(|row| row.source_row).collect::<Vec<_>>(),
            vec![2, 5]
        );
    }

    #[test]
    fn analisi_continua_se_un_file_del_gruppo_e_danneggiato() {
        let (_app, data, state) = test_state();
        let valido = data.path().join("valido.xlsx");
        let danneggiato = data.path().join("danneggiato.xlsx");
        let mut workbook = rust_xlsxwriter::Workbook::new();
        let sheet = workbook.add_worksheet();
        for (column, header) in [
            "Referencia",
            "Paciente",
            "Doctor",
            "Tratamiento",
            "Cantidad",
            "Vials",
        ]
        .iter()
        .enumerate()
        {
            sheet.write_string(0, column as u16, *header).unwrap();
        }
        sheet.write_string(1, 0, "508245").unwrap();
        sheet.write_string(1, 1, "Paziente").unwrap();
        sheet.write_string(1, 2, "Medico").unwrap();
        sheet
            .write_string(1, 3, "BELTAVAC Polimerizado 3 (ITA)")
            .unwrap();
        sheet.write_number(1, 4, 1).unwrap();
        sheet.write_number(1, 5, 1).unwrap();
        workbook.save(&valido).unwrap();
        fs::write(&danneggiato, b"non e un file xlsx").unwrap();

        let analysis = state
            .bollettazione_analizza(&[
                valido.to_string_lossy().into_owned(),
                danneggiato.to_string_lossy().into_owned(),
            ])
            .unwrap();
        assert_eq!(analysis.totals.valid_rows, 1);
        assert_eq!(analysis.totals.failed_files, 1);
        assert_eq!(analysis.files.len(), 2);
        assert!(analysis.files[0].error.is_none());
        assert!(analysis.files[1].error.is_some());
    }

    #[test]
    fn campioni_reali_opzionali_hanno_i_conteggi_attesi() {
        let Some(dir) = std::env::var_os("PHARMATEK_LAB_SAMPLE_DIR") else {
            return;
        };
        for (name, expected) in [
            ("Listado Pharmatek 270726.xlsx", 40),
            ("Listado Pharmatek 220726.xlsx", 14),
            ("Listado Italia 180326.xlsx", 108),
        ] {
            let rows = parse_workbook(&Path::new(&dir).join(name)).unwrap();
            assert_eq!(rows.len(), expected, "{name}");
        }
    }

    #[test]
    fn conferma_arrivo_riusa_stato_produzione_e_revisioni() {
        let (_app, _data, state) = test_state();
        let order = order_with_rows(&state, 1);
        let result = state
            .bollettazione_conferma(BollettazioneConfermaIn {
                mode: "arrivato_it".into(),
                data_arrivo: "2026-08-01".into(),
                rows: vec![confirmation(&order, 0, "LOT-001")],
                shipments: Vec::new(),
            })
            .unwrap();
        assert_eq!(result.updated_rows, 1);
        let row = state
            .record_get("riga_ordine", &order.righe[0].id)
            .unwrap()
            .unwrap();
        assert_eq!(row.data["numero"], json!("LOT-001"));
        assert_eq!(row.data["stato_produzione"], json!("arrivato_it"));
        let current_order = state.record_get("ordine", &order.id).unwrap().unwrap();
        assert_eq!(current_order.data["stato"], json!("Arrivato IT"));
        assert_eq!(current_order.data["data_arrivo_it"], json!("2026-08-01"));

        let retry = state.bollettazione_conferma(BollettazioneConfermaIn {
            mode: "arrivato_it".into(),
            data_arrivo: "2026-08-01".into(),
            rows: vec![confirmation(&order, 0, "LOT-001")],
            shipments: Vec::new(),
        });
        assert!(
            retry.is_err(),
            "una revisione vecchia deve essere rifiutata"
        );
    }

    #[test]
    fn conferma_rispetta_la_scelta_di_mantenere_il_numero_gestionale() {
        let (_app, _data, state) = test_state();
        let order = order_with_rows(&state, 1);
        state
            .record_update(
                "riga_ordine",
                &order.righe[0].id,
                fields(&[("numero", json!("GEST-001"))]),
            )
            .unwrap();
        let current_row = state
            .record_get("riga_ordine", &order.righe[0].id)
            .unwrap()
            .unwrap();
        let current_order = state.record_get("ordine", &order.id).unwrap().unwrap();
        let mut row = confirmation(&order, 0, "LAB-001");
        row.expected_row_revision = current_row.revision;
        row.expected_order_revision = current_order.revision;
        row.accepted_fields
            .insert("numero".into(), json!("GEST-001"));

        state
            .bollettazione_conferma(BollettazioneConfermaIn {
                mode: "arrivato_it".into(),
                data_arrivo: "2026-08-01".into(),
                rows: vec![row],
                shipments: Vec::new(),
            })
            .unwrap();

        let saved = state
            .record_get("riga_ordine", &order.righe[0].id)
            .unwrap()
            .unwrap();
        assert_eq!(saved.data["numero"], json!("GEST-001"));
    }

    #[test]
    fn batch_spedizioni_non_lascia_risultati_parziali() {
        let (_app, _data, state) = test_state();
        let order = order_with_rows(&state, 2);
        let courier = state.records_list("corriere").unwrap()[0].id.clone();
        let rows = vec![
            confirmation(&order, 0, "LOT-A"),
            confirmation(&order, 1, "LOT-B"),
        ];
        let result = state.bollettazione_conferma(BollettazioneConfermaIn {
            mode: "spedizione".into(),
            data_arrivo: "2026-08-01".into(),
            rows,
            shipments: vec![
                BollettazioneSpedizioneIn {
                    data: "2026-08-01".into(),
                    corriere_id: courier,
                    colli: 1,
                    peso: 1,
                    servizi: String::new(),
                    preavviso: true,
                    mezzo: String::new(),
                    contrassegno: 0,
                    note: String::new(),
                    row_ids: vec![order.righe[0].id.clone()],
                },
                BollettazioneSpedizioneIn {
                    data: "2026-08-01".into(),
                    corriere_id: "__missing_courier__".into(),
                    colli: 1,
                    peso: 1,
                    servizi: String::new(),
                    preavviso: true,
                    mezzo: String::new(),
                    contrassegno: 0,
                    note: String::new(),
                    row_ids: vec![order.righe[1].id.clone()],
                },
            ],
        });
        assert!(result.is_err());
        assert!(state.spedizioni_lista().unwrap().is_empty());
        for row in &order.righe {
            let current = state.record_get("riga_ordine", &row.id).unwrap().unwrap();
            assert_eq!(str_field(&current.data, "numero"), "");
            assert_eq!(str_field(&current.data, "spedizione_id"), "");
        }
    }

    #[test]
    fn gate_premium_blocca_analisi_e_conferma_prima_di_leggere_o_scrivere() {
        let app = tempfile::tempdir().unwrap();
        let state = AppState::init(app.path().to_path_buf()).unwrap();
        assert!(state
            .bollettazione_analizza(&["file-che-non-esiste.xlsx".into()])
            .is_err());
        assert!(state
            .bollettazione_conferma(BollettazioneConfermaIn {
                mode: "arrivato_it".into(),
                data_arrivo: "2026-08-01".into(),
                rows: Vec::new(),
                shipments: Vec::new(),
            })
            .is_err());
    }

    #[test]
    fn conferma_spedizione_non_imposta_stato_produzione() {
        let (_app, _data, state) = test_state();
        let order = order_with_rows(&state, 1);
        let courier = state.records_list("corriere").unwrap()[0].id.clone();
        let rows = vec![confirmation(&order, 0, "LOT-SPED-1")];
        let result = state
            .bollettazione_conferma(BollettazioneConfermaIn {
                mode: "spedizione".into(),
                data_arrivo: "2026-08-01".into(),
                rows,
                shipments: vec![BollettazioneSpedizioneIn {
                    data: "2026-08-01".into(),
                    corriere_id: courier,
                    colli: 1,
                    peso: 1,
                    servizi: String::new(),
                    preavviso: true,
                    mezzo: String::new(),
                    contrassegno: 0,
                    note: String::new(),
                    row_ids: vec![order.righe[0].id.clone()],
                }],
            })
            .unwrap();
        assert_eq!(result.updated_rows, 1);
        assert_eq!(result.shipments.len(), 1);
        let row = state
            .record_get("riga_ordine", &order.righe[0].id)
            .unwrap()
            .unwrap();
        assert_eq!(row.data["numero"], json!("LOT-SPED-1"));
        assert_eq!(str_field(&row.data, "stato_produzione"), "");
        assert_eq!(str_field(&row.data, "stato_riga"), "spedita");
        let current_order = state.record_get("ordine", &order.id).unwrap().unwrap();
        assert_eq!(current_order.data["stato"], json!("Spedito"));
    }

    #[test]
    fn annulla_lotto_fantasma_ripristina_ordine() {
        let (_app, _data, state) = test_state();
        let order = order_with_rows(&state, 2);
        state
            .record_update(
                "riga_ordine",
                &order.righe[0].id,
                fields(&[("stato_produzione", json!("arrivato_it"))]),
            )
            .unwrap();
        state
            .record_update(
                "riga_ordine",
                &order.righe[1].id,
                fields(&[
                    ("stato_produzione", json!("in_produzione")),
                    ("lotto_produzione", json!("LOTTO-REALE")),
                ]),
            )
            .unwrap();
        let phantom_lot = format!("_{}", order.id);
        state.produzione_lotto_righe_annulla(&phantom_lot).unwrap();
        let row = state
            .record_get("riga_ordine", &order.righe[0].id)
            .unwrap()
            .unwrap();
        assert_eq!(str_field(&row.data, "stato_produzione"), "");
        assert_eq!(str_field(&row.data, "lotto_produzione"), "");
        let valid_row = state
            .record_get("riga_ordine", &order.righe[1].id)
            .unwrap()
            .unwrap();
        assert_eq!(
            str_field(&valid_row.data, "stato_produzione"),
            "in_produzione"
        );
        assert_eq!(
            str_field(&valid_row.data, "lotto_produzione"),
            "LOTTO-REALE"
        );
        let current_order = state.record_get("ordine", &order.id).unwrap().unwrap();
        assert_eq!(str_field(&current_order.data, "stato"), "In produzione");
    }
}
