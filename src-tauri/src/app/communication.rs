//! Dominio locale delle comunicazioni (FASE 11B).
//!
//! Bozze, code, contenuti, errori, ricevute e cronologia appartengono al PC che
//! li ha creati e vivono soltanto in `%APPDATA%`. Nel motore condiviso restano
//! esclusivamente piccoli indicatori di stato sull'entità sorgente (per esempio
//! l'ultimo invio di un preventivo), mai il record della comunicazione.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
#[cfg(not(test))]
use tauri::Emitter;

use super::{es, now_ms, str_field, AppResult, AppState, EventBody, Mutation};

const ENTITA_COMUNICAZIONE: &str = "comunicazione";
const MAX_CORPO_BYTES: usize = 200_000;
const MAX_OGGETTO_CHARS: usize = 300;
const MAX_ALLEGATI: usize = 20;
const MAX_PDF_BYTES: usize = 5 * 1024 * 1024;
const MAX_PNG_BYTES: usize = 8 * 1024 * 1024;
const MAX_XLSX_BYTES: usize = 10 * 1024 * 1024;
const MAX_ZIP_BYTES: usize = 20 * 1024 * 1024;
const CACHE_DOCUMENTI_SCHEMA: &str = "pt-cache://";
const CACHE_DOCUMENTI_NOMI: &str = ".nomi-invio";
const DURATA_CACHE_DOCUMENTI: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const CAMPO_INTERRUZIONE_RICHIESTA: &str = "interruzione_richiesta";
const INTERRUZIONE_SOSPENDI: &str = "sospendi";
const INTERRUZIONE_ANNULLA: &str = "annulla";
const INTERRUZIONE_RIPRENDI: &str = "riprendi";
const DESTINATARIO_DIAGNOSTICA_WHATSAPP: &str = "diagnostica_whatsapp";
const DESTINATARIO_LABORATORIO_LABORATORIO: &str = "laboratorio_laboratorio";
const ID_LABORATORIO_LABORATORIO: &str = "laboratorio";
const EMAIL_LABORATORIO_LABORATORIO: &str = "laboratorio@example.invalid";

fn classifica_errore_whatsapp(messaggio: &str) -> (String, String) {
    let testo = messaggio.to_lowercase();
    let (codice, fase) = if testo.contains("non si è aperto") || testo.contains("protocollo") {
        ("protocollo_non_disponibile", "protocollo")
    } else if testo.contains("pc in uso") || testo.contains("primo piano") {
        ("pc_in_uso", "sicurezza")
    } else if testo.contains("non risulta associato") || testo.contains("destinatario") {
        ("chat_non_verificata", "chat")
    } else if testo.contains("allegato")
        || testo.contains("anteprima")
        || testo.contains("didascalia")
        || testo.contains("documento")
    {
        ("allegato_non_verificato", "allegato")
    } else if testo.contains("pulsante invia") || testo.contains("comando invia") {
        ("invio_non_verificato", "invio")
    } else if testo.contains("compositore") || testo.contains("campo messaggio") {
        ("compositore_non_verificato", "compositore")
    } else if testo.contains("testo") || testo.contains("appunti") {
        ("testo_non_verificato", "testo")
    } else if testo.contains("finestra") || testo.contains("automation") {
        ("finestra_non_verificata", "finestra")
    } else {
        ("esito_non_verificato", "verifica_finale")
    };
    (codice.into(), fase.into())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CanaleComunicazione {
    Email,
    Whatsapp,
}

impl CanaleComunicazione {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Whatsapp => "whatsapp",
        }
    }

    pub(super) fn parse(value: &str) -> AppResult<Self> {
        match value {
            "email" => Ok(Self::Email),
            "whatsapp" => Ok(Self::Whatsapp),
            _ => Err("canale di comunicazione non riconosciuto".into()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatoComunicazione {
    Bozza,
    DaRevisionare,
    InCoda,
    Sospeso,
    InInvio,
    InvioAzionato,
    ConsegnaVerificata,
    Fallito,
    Annullato,
}

impl StatoComunicazione {
    fn as_str(self) -> &'static str {
        match self {
            Self::Bozza => "bozza",
            Self::DaRevisionare => "da_revisionare",
            Self::InCoda => "in_coda",
            Self::Sospeso => "sospeso",
            Self::InInvio => "in_invio",
            Self::InvioAzionato => "invio_azionato",
            Self::ConsegnaVerificata => "consegna_verificata",
            Self::Fallito => "fallito",
            Self::Annullato => "annullato",
        }
    }

    fn parse(value: &str) -> AppResult<Self> {
        match value {
            "bozza" => Ok(Self::Bozza),
            "da_revisionare" => Ok(Self::DaRevisionare),
            "in_coda" => Ok(Self::InCoda),
            "sospeso" => Ok(Self::Sospeso),
            "in_invio" => Ok(Self::InInvio),
            "invio_azionato" => Ok(Self::InvioAzionato),
            "consegna_verificata" => Ok(Self::ConsegnaVerificata),
            "fallito" => Ok(Self::Fallito),
            "annullato" => Ok(Self::Annullato),
            _ => Err("stato della comunicazione non riconosciuto".into()),
        }
    }

    fn positivo(self) -> bool {
        matches!(self, Self::InvioAzionato | Self::ConsegnaVerificata)
    }

    /// Stati attivi dai quali l'utente o il worker devono poter proseguire
    /// usando lo stesso allegato. Gli invii falliti restano invece coperti
    /// dalla normale finestra di recupero della cache.
    fn richiede_documento_temporaneo(self) -> bool {
        matches!(
            self,
            Self::Bozza | Self::DaRevisionare | Self::InCoda | Self::Sospeso | Self::InInvio
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllegatoComunicazioneInput {
    pub nome: String,
    pub mime: String,
    pub dimensione: u64,
    /// Riferimento al documento gestito dall'app; il binario non entra nel log.
    pub riferimento: String,
    /// SHA-256 esadecimale della versione che verrà inviata.
    pub sha256: String,
}

/// Ulteriore origine coperta dalla stessa comunicazione batch. Il fingerprint
/// resta per-origine: un invio che comprende più colli può quindi allineare
/// ciascuno senza confondere revisioni o dati diversi.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrigineCorrelataInput {
    pub id: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComunicazioneCreaInput {
    /// Chiave opaca e stabile per la stessa intenzione di invio. Un reinvio
    /// intenzionale deve usarne una nuova e compilare `reinvio_di`.
    pub idempotency_key: String,
    pub destinatario_entita: String,
    pub destinatario_id: String,
    pub canale: CanaleComunicazione,
    pub recapito: String,
    #[serde(default)]
    pub oggetto: String,
    pub corpo: String,
    #[serde(default)]
    pub modello_id: String,
    #[serde(default)]
    pub modello_versione_id: String,
    #[serde(default)]
    pub modello_versione: u64,
    #[serde(default)]
    pub origine_entita: String,
    #[serde(default)]
    pub origine_id: String,
    #[serde(default)]
    pub origine_revision: String,
    #[serde(default)]
    pub origine_fingerprint: String,
    #[serde(default)]
    pub origini_correlate: Vec<OrigineCorrelataInput>,
    /// Snapshot semantico conservato soltanto nella cronologia locale della
    /// comunicazione; non viene copiato nell'entità condivisa di origine.
    #[serde(default)]
    pub origine_snapshot: Value,
    #[serde(default)]
    pub tipo_modello: String,
    #[serde(default)]
    pub campagna_id: String,
    #[serde(default)]
    pub reinvio_di: String,
    #[serde(default)]
    pub allegati: Vec<AllegatoComunicazioneInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComunicazioneDto {
    pub id: String,
    pub revision: String,
    pub stato: StatoComunicazione,
    pub canale: CanaleComunicazione,
    pub destinatario_entita: String,
    pub destinatario_id: String,
    pub recapito: String,
    pub oggetto: String,
    pub corpo: String,
    pub modello_id: String,
    pub modello_versione_id: String,
    pub modello_versione: u64,
    pub origine_entita: String,
    pub origine_id: String,
    pub origine_fingerprint: String,
    pub origini_correlate: Vec<OrigineCorrelataInput>,
    pub tipo_modello: String,
    pub campagna_id: String,
    pub reinvio_di: String,
    pub allegati: Vec<AllegatoComunicazioneInput>,
    pub tentativi: u64,
    pub ultimo_errore: String,
    pub errore_codice: String,
    pub errore_fase: String,
    pub esito_ambiguo: bool,
    pub proprietario_utente_id: String,
    pub proprietario_utente_nome: String,
    pub proprietario_dispositivo_id: String,
    pub proprietario_dispositivo_nome: String,
    pub inviata_ms: u64,
    pub riferimento_esterno: String,
    pub copia_posta_inviata: bool,
    pub creata_ms: u64,
    pub stato_aggiornato_ms: u64,
}

#[cfg(not(test))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComunicazioneInvioErroreDto {
    id: String,
    campagna_id: String,
    canale: CanaleComunicazione,
    destinatario: String,
    oggetto: String,
    messaggio: String,
    errore_codice: String,
    errore_fase: String,
    esito_ambiguo: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProprietarioComunicazione {
    utente_id: String,
    utente_nome: String,
    dispositivo_id: String,
    dispositivo_nome: String,
}

struct ComunicazionePreparata {
    id: String,
    payload_fingerprint: String,
    fields: Map<String, Value>,
    destinatario_entita: String,
    destinatario_id: String,
    origine_entita: String,
    origine_id: String,
    origine_revision: String,
    origine_fingerprint: String,
    origini_correlate: Vec<OrigineCorrelataInput>,
    reinvio_di: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentoCacheSalvaInput {
    pub nome: String,
    pub mime: String,
    pub dati: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsappVerificaInput {
    pub nome: String,
    pub telefono: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsappVerificaProvaDto {
    pub testo: ComunicazioneDto,
    pub allegato: ComunicazioneDto,
    #[cfg(target_os = "windows")]
    pub diagnostica: crate::app::whatsapp_windows::WhatsappDiagnosticaDto,
}

fn pdf_diagnostico_whatsapp() -> Vec<u8> {
    let contenuto = b"BT /F1 18 Tf 72 750 Td (Collaudo WhatsApp PharmaTek) Tj 0 -28 Td /F1 11 Tf (Documento diagnostico generato localmente.) Tj ET";
    let oggetti = [
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_vec(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_vec(),
        [
            format!("<< /Length {} >>\nstream\n", contenuto.len()).into_bytes(),
            contenuto.to_vec(),
            b"\nendstream".to_vec(),
        ]
        .concat(),
    ];
    let mut pdf = b"%PDF-1.4\n%PTWA\n".to_vec();
    let mut offset = Vec::with_capacity(oggetti.len());
    for (indice, oggetto) in oggetti.iter().enumerate() {
        offset.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n", indice + 1).as_bytes());
        pdf.extend_from_slice(oggetto);
        pdf.extend_from_slice(b"\nendobj\n");
    }
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", oggetti.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for value in offset {
        pdf.extend_from_slice(format!("{value:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            oggetti.len() + 1
        )
        .as_bytes(),
    );
    pdf
}

pub(super) fn sha256_hex(bytes: impl AsRef<[u8]>) -> String {
    let digest = Sha256::digest(bytes.as_ref());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) fn normalizza_email(value: &str) -> AppResult<String> {
    let email = value.trim().to_lowercase();
    if email.is_empty()
        || email.len() > 254
        || email.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("indirizzo e-mail non valido".into());
    }
    let mut parti = email.split('@');
    let locale = parti.next().unwrap_or_default();
    let dominio = parti.next().unwrap_or_default();
    if parti.next().is_some()
        || locale.is_empty()
        || dominio.is_empty()
        || dominio.starts_with('.')
        || dominio.ends_with('.')
        || !dominio.contains('.')
    {
        return Err("indirizzo e-mail non valido".into());
    }
    Ok(email)
}

fn normalizza_singolo_telefono(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let mut cifre = trimmed
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect::<String>();
    let internazionale = trimmed.starts_with('+') || cifre.starts_with("00");
    if cifre.starts_with("00") {
        cifre.drain(..2);
    }

    if !internazionale {
        let nazionale_italiano = (cifre.starts_with('0') && (6..=11).contains(&cifre.len()))
            || (cifre.starts_with('3') && (9..=10).contains(&cifre.len()));
        if nazionale_italiano {
            cifre.insert_str(0, "39");
        } else if !(cifre.starts_with("39") && cifre.len() >= 11)
            && (!(8..=15).contains(&cifre.len()) || cifre.starts_with('0'))
        {
            return None;
        }
    }

    if !(8..=15).contains(&cifre.len()) || cifre.starts_with('0') {
        return None;
    }
    Some(format!("+{cifre}"))
}

fn normalizza_telefono(value: &str) -> AppResult<String> {
    // Nei dati storici fisso e cellulare possono convivere nello stesso campo.
    // I separatori con spazi non spezzano formati come "081/1234567".
    let caratteri = value.char_indices().collect::<Vec<_>>();
    let mut segmenti = Vec::new();
    let mut inizio = 0;
    for (indice, (offset, carattere)) in caratteri.iter().copied().enumerate() {
        let separatore_sempre = matches!(carattere, ';' | '|' | ',' | '\n');
        let separatore_spaziato = matches!(carattere, '-' | '–' | '—' | '/')
            && indice > 0
            && indice + 1 < caratteri.len()
            && caratteri[indice - 1].1.is_whitespace()
            && caratteri[indice + 1].1.is_whitespace();
        if separatore_sempre || separatore_spaziato {
            segmenti.push(&value[inizio..offset]);
            inizio = offset + carattere.len_utf8();
        }
    }
    segmenti.push(&value[inizio..]);
    let candidati = segmenti
        .into_iter()
        .filter_map(normalizza_singolo_telefono)
        .collect::<Vec<_>>();
    candidati
        .iter()
        .find(|numero| {
            numero
                .strip_prefix("+393")
                .is_some_and(|resto| (8..=9).contains(&resto.len()))
        })
        .or_else(|| candidati.first())
        .cloned()
        .ok_or_else(|| "numero di telefono non utilizzabile per WhatsApp".into())
}

fn url_whatsapp(numero: &str) -> String {
    let cifre = numero
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    format!("whatsapp://send?phone={cifre}")
}

fn codifica_componente_query(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            use std::fmt::Write;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

pub(super) fn url_whatsapp_con_testo(numero: &str, corpo: &str) -> String {
    format!(
        "{}&text={}",
        url_whatsapp(numero),
        codifica_componente_query(corpo)
    )
}

fn valida_allegati(allegati: &mut [AllegatoComunicazioneInput]) -> AppResult<()> {
    for allegato in allegati {
        allegato.nome = allegato.nome.trim().to_string();
        allegato.mime = allegato.mime.trim().to_lowercase();
        allegato.riferimento = allegato.riferimento.trim().to_string();
        allegato.sha256 = allegato.sha256.trim().to_lowercase();
        if allegato.nome.is_empty() || allegato.riferimento.is_empty() {
            return Err("allegato senza nome o riferimento".into());
        }
        if allegato.dimensione == 0 {
            return Err(format!("l'allegato «{}» è vuoto", allegato.nome));
        }
        if allegato.sha256.len() != 64 || !allegato.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!(
                "impronta dell'allegato «{}» non valida",
                allegato.nome
            ));
        }
    }
    Ok(())
}

fn allegati_whatsapp_supportati(allegati: &[AllegatoComunicazioneInput]) -> bool {
    match allegati {
        [] => true,
        [allegato] => matches!(allegato.mime.as_str(), "image/png" | "application/pdf"),
        [immagine, pdf] => immagine.mime == "image/png" && pdf.mime == "application/pdf",
        _ => false,
    }
}

fn estensione_documento_cache(mime: &str, dati: &[u8]) -> AppResult<(&'static str, usize)> {
    match mime.trim().to_lowercase().as_str() {
        "application/pdf" if dati.starts_with(b"%PDF-") => Ok(("pdf", MAX_PDF_BYTES)),
        "image/png" if dati.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) => {
            Ok(("png", MAX_PNG_BYTES))
        }
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            if dati.starts_with(b"PK\x03\x04") =>
        {
            Ok(("xlsx", MAX_XLSX_BYTES))
        }
        "application/zip" if dati.starts_with(b"PK\x03\x04") => Ok(("zip", MAX_ZIP_BYTES)),
        "application/pdf"
        | "image/png"
        | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        | "application/zip" => {
            Err("il contenuto del documento non corrisponde al formato dichiarato".into())
        }
        _ => Err("sono ammessi soltanto PDF, PNG, XLSX e ZIP".into()),
    }
}

fn nome_file_cache_da_riferimento(riferimento: &str) -> AppResult<&str> {
    let nome = riferimento
        .strip_prefix(CACHE_DOCUMENTI_SCHEMA)
        .ok_or("riferimento allegato non gestito dall'app")?;
    let valido = !nome.is_empty()
        && !nome.contains('/')
        && !nome.contains('\\')
        && nome
            .split_once('.')
            .map(|(hash, ext)| {
                hash.len() == 64
                    && hash.chars().all(|c| c.is_ascii_hexdigit())
                    && matches!(ext, "pdf" | "png" | "xlsx" | "zip")
            })
            .unwrap_or(false);
    if !valido {
        return Err("riferimento allegato locale non valido".into());
    }
    Ok(nome)
}

fn nome_allegato_sicuro(nome: &str, mime: &str) -> String {
    let estensione = match mime {
        "image/png" => "png",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        "application/zip" => "zip",
        _ => "pdf",
    };
    let base = Path::new(nome.trim())
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Documento");
    let mut base = base
        .chars()
        .map(|carattere| {
            if carattere.is_control()
                || matches!(
                    carattere,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '-'
            } else {
                carattere
            }
        })
        .take(120)
        .collect::<String>();
    base = base.trim_matches([' ', '.', '-']).to_string();
    if base.is_empty() {
        base = "Documento".into();
    }
    let riservato = matches!(
        base.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if riservato {
        base.insert(0, '_');
    }
    format!("{base}.{estensione}")
}

fn cache_documento_scaduta(path: &Path) -> bool {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modificato| modificato.elapsed().ok())
        .is_some_and(|eta| eta >= DURATA_CACHE_DOCUMENTI)
}

fn prepara(
    input: ComunicazioneCreaInput,
    proprietario: ProprietarioComunicazione,
) -> AppResult<ComunicazionePreparata> {
    let idempotency_key = input.idempotency_key.trim();
    if idempotency_key.is_empty()
        || idempotency_key.len() > 512
        || idempotency_key.chars().any(char::is_control)
    {
        return Err("chiave di idempotenza non valida".into());
    }

    let destinatario_entita = input.destinatario_entita.trim().to_string();
    let destinatario_id = input.destinatario_id.trim().to_string();
    if destinatario_entita.is_empty() || destinatario_id.is_empty() {
        return Err("seleziona un destinatario collegato al gestionale".into());
    }

    let origine_entita = input.origine_entita.trim().to_string();
    let origine_id = input.origine_id.trim().to_string();
    if origine_entita.is_empty() != origine_id.is_empty() {
        return Err("il collegamento di origine è incompleto".into());
    }
    let mut origini_correlate = input.origini_correlate;
    for origine in &mut origini_correlate {
        origine.id = origine.id.trim().to_string();
        origine.fingerprint = origine.fingerprint.trim().to_string();
    }
    origini_correlate.retain(|origine| !origine.id.is_empty() && origine.id != origine_id);
    origini_correlate.sort_by(|a, b| a.id.cmp(&b.id));
    origini_correlate.dedup_by(|a, b| a.id == b.id);
    if (origine_entita.is_empty() && !origini_correlate.is_empty())
        || origini_correlate.len() > 100
        || origini_correlate
            .iter()
            .any(|origine| origine.fingerprint.is_empty())
    {
        return Err("le origini collegate non sono valide".into());
    }

    let corpo = input.corpo;
    if corpo.trim().is_empty() || corpo.len() > MAX_CORPO_BYTES {
        return Err("il testo del messaggio è vuoto o troppo lungo".into());
    }
    let oggetto = input.oggetto.trim().to_string();
    if oggetto.chars().count() > MAX_OGGETTO_CHARS
        || oggetto
            .chars()
            .any(|c| c == '\r' || c == '\n' || c.is_control())
    {
        return Err("l'oggetto del messaggio è troppo lungo".into());
    }
    if input.canale == CanaleComunicazione::Email && oggetto.is_empty() {
        return Err("inserisci l'oggetto dell'e-mail".into());
    }

    if input.allegati.len() > MAX_ALLEGATI {
        return Err("sono presenti troppi allegati".into());
    }
    let mut allegati = input.allegati;
    valida_allegati(&mut allegati)?;

    let destinatario_laboratorio = destinatario_entita == DESTINATARIO_LABORATORIO_LABORATORIO
        || destinatario_id == ID_LABORATORIO_LABORATORIO;
    if destinatario_laboratorio
        && (destinatario_entita != DESTINATARIO_LABORATORIO_LABORATORIO
            || destinatario_id != ID_LABORATORIO_LABORATORIO
            || input.canale != CanaleComunicazione::Email)
    {
        return Err("il destinatario Laboratorio è riservato e non può essere modificato".into());
    }
    let recapito = if destinatario_laboratorio {
        EMAIL_LABORATORIO_LABORATORIO.into()
    } else {
        match input.canale {
            CanaleComunicazione::Email => {
                let recapito = normalizza_email(&input.recapito)?;
                if recapito.eq_ignore_ascii_case(EMAIL_LABORATORIO_LABORATORIO) {
                    return Err("usa il flusso Produzioni per inviare e-mail a Laboratorio".into());
                }
                recapito
            }
            CanaleComunicazione::Whatsapp => normalizza_telefono(&input.recapito)?,
        }
    };

    let mut payload = json!({
        "canale": input.canale.as_str(),
        "destinatario_entita": destinatario_entita,
        "destinatario_id": destinatario_id,
        "recapito": recapito,
        "oggetto": oggetto,
        "corpo": corpo,
        "modello_id": input.modello_id.trim(),
        "modello_versione_id": input.modello_versione_id.trim(),
        "modello_versione": input.modello_versione,
        "origine_entita": origine_entita,
        "origine_id": origine_id,
        "origine_fingerprint": input.origine_fingerprint.trim(),
        "origini_correlate": origini_correlate.clone(),
        "origine_snapshot": input.origine_snapshot,
        "tipo_modello": input.tipo_modello.trim(),
        "campagna_id": input.campagna_id.trim(),
        "reinvio_di": input.reinvio_di.trim(),
        "allegati": allegati,
    });
    let payload_fingerprint = sha256_hex(serde_json::to_vec(&payload).map_err(es)?);
    let key_hash = sha256_hex(idempotency_key.as_bytes());
    let id = format!("com-{key_hash}");
    let now = now_ms();
    payload
        .as_object_mut()
        .ok_or("contenuto della comunicazione non valido")?
        .insert("fingerprint".into(), json!(payload_fingerprint));

    // Il payload risolto è volutamente un solo campo LWW: due finestre dello
    // stesso PC non possono produrre un messaggio "frankenstein" composto da
    // oggetto, corpo e destinatario di due intenzioni diverse.
    let mut fields = Map::new();
    fields.insert("payload".into(), payload);
    fields.insert("idempotency_hash".into(), json!(key_hash));
    fields.insert("stato".into(), json!(StatoComunicazione::Bozza.as_str()));
    fields.insert("tentativi".into(), json!(0));
    fields.insert("ultimo_errore".into(), json!(""));
    fields.insert("errore_codice".into(), json!(""));
    fields.insert("errore_fase".into(), json!(""));
    fields.insert("esito_ambiguo".into(), json!(false));
    fields.insert(CAMPO_INTERRUZIONE_RICHIESTA.into(), json!(""));
    fields.insert(
        "proprietario".into(),
        serde_json::to_value(proprietario).map_err(es)?,
    );
    fields.insert("inviata_ms".into(), json!(0));
    fields.insert("riferimento_esterno".into(), json!(""));
    fields.insert("copia_posta_inviata".into(), json!(false));
    fields.insert("origine_allineata".into(), json!(false));
    fields.insert("creata_ms".into(), json!(now));
    fields.insert("stato_aggiornato_ms".into(), json!(now));

    Ok(ComunicazionePreparata {
        id,
        payload_fingerprint,
        fields,
        destinatario_entita,
        destinatario_id,
        origine_entita,
        origine_id,
        origine_revision: input.origine_revision.trim().to_string(),
        origine_fingerprint: input.origine_fingerprint.trim().to_string(),
        origini_correlate,
        reinvio_di: input.reinvio_di.trim().to_string(),
    })
}

fn dto(record: crate::projection::Record) -> AppResult<ComunicazioneDto> {
    let id = record.id.clone();
    let revision = record.updated_hlc.to_string();
    let stato = StatoComunicazione::parse(&str_field(&record.data, "stato"))?;
    let payload = record
        .data
        .get("payload")
        .and_then(Value::as_object)
        .ok_or("contenuto della comunicazione mancante")?;
    let canale = CanaleComunicazione::parse(&str_field(payload, "canale"))?;
    let allegati = payload
        .get("allegati")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(es)?
        .unwrap_or_default();
    let proprietario = record
        .data
        .get("proprietario")
        .cloned()
        .map(serde_json::from_value::<ProprietarioComunicazione>)
        .transpose()
        .map_err(es)?
        .unwrap_or(ProprietarioComunicazione {
            utente_id: String::new(),
            utente_nome: String::new(),
            dispositivo_id: String::new(),
            dispositivo_nome: String::new(),
        });
    Ok(ComunicazioneDto {
        id,
        revision,
        stato,
        canale,
        destinatario_entita: str_field(payload, "destinatario_entita"),
        destinatario_id: str_field(payload, "destinatario_id"),
        recapito: str_field(payload, "recapito"),
        oggetto: str_field(payload, "oggetto"),
        corpo: str_field(payload, "corpo"),
        modello_id: str_field(payload, "modello_id"),
        modello_versione_id: str_field(payload, "modello_versione_id"),
        modello_versione: payload
            .get("modello_versione")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        origine_entita: str_field(payload, "origine_entita"),
        origine_id: str_field(payload, "origine_id"),
        origine_fingerprint: str_field(payload, "origine_fingerprint"),
        origini_correlate: payload
            .get("origini_correlate")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(es)?
            .unwrap_or_default(),
        tipo_modello: str_field(payload, "tipo_modello"),
        campagna_id: str_field(payload, "campagna_id"),
        reinvio_di: str_field(payload, "reinvio_di"),
        allegati,
        tentativi: record
            .data
            .get("tentativi")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        ultimo_errore: str_field(&record.data, "ultimo_errore"),
        errore_codice: str_field(&record.data, "errore_codice"),
        errore_fase: str_field(&record.data, "errore_fase"),
        esito_ambiguo: record
            .data
            .get("esito_ambiguo")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        proprietario_utente_id: proprietario.utente_id,
        proprietario_utente_nome: proprietario.utente_nome,
        proprietario_dispositivo_id: proprietario.dispositivo_id,
        proprietario_dispositivo_nome: proprietario.dispositivo_nome,
        inviata_ms: record
            .data
            .get("inviata_ms")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        riferimento_esterno: str_field(&record.data, "riferimento_esterno"),
        copia_posta_inviata: record
            .data
            .get("copia_posta_inviata")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        creata_ms: record
            .data
            .get("creata_ms")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        stato_aggiornato_ms: record
            .data
            .get("stato_aggiornato_ms")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    })
}

fn transizione_valida(da: StatoComunicazione, a: StatoComunicazione) -> bool {
    use StatoComunicazione::*;
    matches!(
        (da, a),
        (Bozza, DaRevisionare | InCoda | Annullato)
            | (DaRevisionare, Bozza | InCoda | Annullato)
            | (InCoda, Sospeso | InInvio | Fallito | Annullato)
            | (Sospeso, InCoda | Annullato)
            | (
                InInvio,
                InvioAzionato | ConsegnaVerificata | Fallito | Annullato
            )
            | (InvioAzionato, ConsegnaVerificata)
            | (Fallito, InCoda | Annullato)
    )
}

impl AppState {
    fn cartella_cache_documenti(&self) -> PathBuf {
        self.app_dir.join("document-cache")
    }

    fn riferimenti_documenti_cache_in_uso(
        &self,
        proteggi_falliti: bool,
    ) -> AppResult<std::collections::HashSet<String>> {
        let mut riferimenti: std::collections::HashSet<String> =
            self.with_communication_engine(|engine| {
                Ok(engine.with_projection(|projection| {
                    projection
                        .list(ENTITA_COMUNICAZIONE)
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|record| !record.deleted)
                        .filter(|record| {
                            StatoComunicazione::parse(&str_field(&record.data, "stato")).is_ok_and(
                                |stato| {
                                    stato.richiede_documento_temporaneo()
                                        || (proteggi_falliti
                                            && stato == StatoComunicazione::Fallito)
                                },
                            )
                        })
                        .filter_map(|record| {
                            record
                                .data
                                .get("payload")
                                .and_then(Value::as_object)
                                .and_then(|payload| payload.get("allegati"))
                                .cloned()
                        })
                        .filter_map(|value| {
                            serde_json::from_value::<Vec<AllegatoComunicazioneInput>>(value).ok()
                        })
                        .flatten()
                        .map(|allegato| allegato.riferimento)
                        .collect()
                }))
            })?;
        riferimenti.extend(
            self.pending_document_cache
                .lock()
                .expect("pending document cache poisoned")
                .iter()
                .cloned(),
        );
        Ok(riferimenti)
    }

    fn riferimenti_documenti_produzione_terminati(
        &self,
    ) -> AppResult<std::collections::HashSet<String>> {
        self.with_communication_engine(|engine| {
            Ok(engine.with_projection(|projection| {
                projection
                    .list(ENTITA_COMUNICAZIONE)
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|record| !record.deleted)
                    .filter_map(|record| dto(record).ok())
                    .filter(|comunicazione| {
                        comunicazione.tipo_modello == "invio_produzione"
                            && (comunicazione.stato.positivo()
                                || comunicazione.stato == StatoComunicazione::Annullato)
                    })
                    .flat_map(|comunicazione| comunicazione.allegati)
                    .map(|allegato| allegato.riferimento)
                    .collect()
            }))
        })
    }

    fn pulisci_cache_documenti_non_usata(&self) -> AppResult<usize> {
        let _io = self
            .document_cache_io
            .lock()
            .map_err(|_| "cache documenti non disponibile".to_string())?;
        let cartella = self.cartella_cache_documenti();
        let entries = match fs::read_dir(&cartella) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(error) => return Err(super::e(error)),
        };
        let riferimenti_in_uso = self.riferimenti_documenti_cache_in_uso(false)?;
        let produzioni_terminate = self.riferimenti_documenti_produzione_terminati()?;
        let mut rimossi = 0;
        let mut hash_presenti = std::collections::HashSet::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let riferimento = path
                .file_name()
                .and_then(|nome| nome.to_str())
                .map(|nome| format!("{CACHE_DOCUMENTI_SCHEMA}{nome}"));
            if let Some(hash) = path
                .file_stem()
                .and_then(|value| value.to_str())
                .filter(|value| value.len() == 64)
            {
                hash_presenti.insert(hash.to_string());
            }
            if riferimento
                .as_ref()
                .is_some_and(|value| riferimenti_in_uso.contains(value))
            {
                continue;
            }
            if !produzioni_terminate.contains(riferimento.as_deref().unwrap_or_default())
                && !cache_documento_scaduta(&path)
            {
                continue;
            }
            if fs::remove_file(&path).is_ok() {
                if let Some(hash) = path.file_stem().and_then(|value| value.to_str()) {
                    hash_presenti.remove(hash);
                    let _ = fs::remove_dir_all(cartella.join(CACHE_DOCUMENTI_NOMI).join(hash));
                }
                rimossi += 1;
            }
        }
        // Le copie con nome leggibile servono soltanto a WhatsApp. Eliminiamo
        // eventuali directory rimaste senza il corrispondente file verificato.
        if let Ok(entries) = fs::read_dir(cartella.join(CACHE_DOCUMENTI_NOMI)) {
            for entry in entries.flatten() {
                let path = entry.path();
                let hash = entry.file_name().to_string_lossy().to_string();
                if path.is_dir() && !hash_presenti.contains(&hash) {
                    let _ = fs::remove_dir_all(path);
                }
            }
        }
        Ok(rimossi)
    }

    /// Scrive un artefatto locale e content-addressed. Nel log eventi resta
    /// soltanto `pt-cache://<sha>.<ext>`: mai byte o percorsi assoluti.
    pub fn documento_cache_salva(
        &self,
        mut input: DocumentoCacheSalvaInput,
    ) -> AppResult<AllegatoComunicazioneInput> {
        crate::premium::ensure_access(self)?;
        let _io = self
            .document_cache_io
            .lock()
            .map_err(|_| "cache documenti non disponibile".to_string())?;
        input.nome = input.nome.trim().to_string();
        if input.nome.is_empty() || input.nome.chars().any(char::is_control) {
            return Err("nome del documento non valido".into());
        }
        let mime = input.mime.trim().to_lowercase();
        let (estensione, massimo) = estensione_documento_cache(&mime, &input.dati)?;
        if input.dati.is_empty() || input.dati.len() > massimo {
            return Err("il documento generato è vuoto o troppo grande".into());
        }
        let sha256 = sha256_hex(&input.dati);
        let nome_cache = format!("{sha256}.{estensione}");
        let cartella = self.cartella_cache_documenti();
        fs::create_dir_all(&cartella).map_err(super::e)?;
        let destinazione = cartella.join(&nome_cache);
        if !destinazione.exists() {
            let temporaneo = cartella.join(format!(".{nome_cache}.{}.tmp", ulid::Ulid::generate()));
            fs::write(&temporaneo, &input.dati).map_err(super::e)?;
            match fs::rename(&temporaneo, &destinazione) {
                Ok(()) => {}
                Err(error)
                    if error.kind() == std::io::ErrorKind::AlreadyExists
                        || destinazione.exists() =>
                {
                    let _ = fs::remove_file(&temporaneo);
                }
                Err(error) => {
                    let _ = fs::remove_file(&temporaneo);
                    return Err(super::e(error));
                }
            }
        } else {
            // Lo stesso preventivo può essere preparato di nuovo: il touch fa
            // ripartire la conservazione senza duplicare il binario.
            let _ = filetime::set_file_mtime(&destinazione, filetime::FileTime::now());
        }
        let allegato = AllegatoComunicazioneInput {
            nome: input.nome,
            mime,
            dimensione: input.dati.len() as u64,
            riferimento: format!("{CACHE_DOCUMENTI_SCHEMA}{nome_cache}"),
            sha256,
        };
        self.pending_document_cache
            .lock()
            .expect("pending document cache poisoned")
            .insert(allegato.riferimento.clone());
        Ok(allegato)
    }

    /// Rilascia le lease in memoria dei documenti appena generati. I file non
    /// più usati restano disponibili per sette giorni, così bozze, errori e
    /// reinvii non perdono l'allegato appena preparato.
    pub fn documenti_cache_rilascia(
        &self,
        allegati: &[AllegatoComunicazioneInput],
    ) -> AppResult<usize> {
        self.documenti_cache_rilascia_con_policy(allegati, false)
    }

    pub fn documenti_cache_rilascia_con_policy(
        &self,
        allegati: &[AllegatoComunicazioneInput],
        elimina_se_non_usati: bool,
    ) -> AppResult<usize> {
        {
            let mut pending = self
                .pending_document_cache
                .lock()
                .expect("pending document cache poisoned");
            for allegato in allegati {
                pending.remove(&allegato.riferimento);
            }
        }
        if elimina_se_non_usati {
            self.rimuovi_documenti_cache_specifici_non_usati(allegati)
        } else {
            self.pulisci_cache_documenti_non_usata()
        }
    }

    pub(super) fn documento_cache_leggi(
        &self,
        allegato: &AllegatoComunicazioneInput,
    ) -> AppResult<Vec<u8>> {
        let nome = nome_file_cache_da_riferimento(&allegato.riferimento)?;
        let path = self.cartella_cache_documenti().join(nome);
        let dati = fs::read(&path).map_err(|_| {
            format!(
                "l'allegato «{}» non è più nella cache locale",
                allegato.nome
            )
        })?;
        let (_, massimo) = estensione_documento_cache(&allegato.mime, &dati)?;
        if dati.len() > massimo
            || dati.len() as u64 != allegato.dimensione
            || sha256_hex(&dati) != allegato.sha256
        {
            return Err(format!(
                "l'allegato «{}» non corrisponde alla versione preparata",
                allegato.nome
            ));
        }
        let _ = filetime::set_file_mtime(&path, filetime::FileTime::now());
        Ok(dati)
    }

    #[cfg(test)]
    pub(super) fn documento_cache_percorso_verificato(
        &self,
        allegato: &AllegatoComunicazioneInput,
    ) -> AppResult<PathBuf> {
        let _ = self.documento_cache_leggi(allegato)?;
        let nome = nome_file_cache_da_riferimento(&allegato.riferimento)?;
        Ok(self.cartella_cache_documenti().join(nome))
    }

    /// WhatsApp usa il basename del percorso come nome visibile del file. La
    /// cache resta content-addressed, mentre questa copia verificata espone il
    /// titolo leggibile scelto dall'app.
    pub(super) fn documento_cache_percorso_invio(
        &self,
        allegato: &AllegatoComunicazioneInput,
    ) -> AppResult<PathBuf> {
        let dati = self.documento_cache_leggi(allegato)?;
        let nome = nome_allegato_sicuro(&allegato.nome, &allegato.mime);
        let cartella = self
            .cartella_cache_documenti()
            .join(CACHE_DOCUMENTI_NOMI)
            .join(&allegato.sha256);
        let destinazione = cartella.join(nome);
        let _io = self
            .document_cache_io
            .lock()
            .map_err(|_| "cache documenti non disponibile".to_string())?;
        fs::create_dir_all(&cartella).map_err(super::e)?;
        // Riscriviamo dalla sorgente appena verificata: anche una copia locale
        // alterata con la stessa dimensione non può finire negli appunti.
        fs::write(&destinazione, dati).map_err(super::e)?;
        Ok(destinazione)
    }

    fn rimuovi_documenti_cache_non_usati(
        &self,
        allegati: &[AllegatoComunicazioneInput],
    ) -> AppResult<()> {
        if allegati.is_empty() {
            return Ok(());
        }
        self.pulisci_cache_documenti_non_usata().map(|_| ())
    }

    fn rimuovi_documenti_cache_specifici_non_usati(
        &self,
        allegati: &[AllegatoComunicazioneInput],
    ) -> AppResult<usize> {
        if allegati.is_empty() {
            return Ok(0);
        }
        let _io = self
            .document_cache_io
            .lock()
            .map_err(|_| "cache documenti non disponibile".to_string())?;
        let riferimenti_in_uso = self.riferimenti_documenti_cache_in_uso(true)?;
        let cartella = self.cartella_cache_documenti();
        let mut rimossi = 0;
        let mut elaborati = std::collections::HashSet::new();
        for allegato in allegati {
            if !elaborati.insert(allegato.riferimento.clone())
                || riferimenti_in_uso.contains(&allegato.riferimento)
            {
                continue;
            }
            let nome = nome_file_cache_da_riferimento(&allegato.riferimento)?;
            let (hash, _) = nome
                .split_once('.')
                .ok_or("riferimento allegato locale non valido")?;
            if hash != allegato.sha256 {
                return Err("riferimento allegato locale non coerente".into());
            }
            match fs::remove_file(cartella.join(nome)) {
                Ok(()) => rimossi += 1,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(super::e(error)),
            }
            let _ = fs::remove_dir_all(cartella.join(CACHE_DOCUMENTI_NOMI).join(hash));
        }
        Ok(rimossi)
    }

    fn rimuovi_cache_comunicazione_se_non_usata(
        &self,
        comunicazione: &ComunicazioneDto,
    ) -> AppResult<()> {
        if comunicazione.tipo_modello == "invio_produzione"
            && (comunicazione.stato.positivo()
                || comunicazione.stato == StatoComunicazione::Annullato)
        {
            self.rimuovi_documenti_cache_specifici_non_usati(&comunicazione.allegati)
                .map(|_| ())
        } else {
            self.rimuovi_documenti_cache_non_usati(&comunicazione.allegati)
        }
    }

    fn with_communication_engine<T>(
        &self,
        f: impl FnOnce(&crate::sync::Engine) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut locale = self
            .communication_engine
            .lock()
            .map_err(|_| "outbox comunicazioni non disponibile".to_string())?;
        if locale.is_none() {
            let config = self.config();
            let autore = config
                .user_id
                .clone()
                .unwrap_or_else(|| config.device_id.clone());
            let cartella = self.app_dir.join("communication-outbox");
            let sqlite = self.app_dir.join("communication-outbox.sqlite");
            std::fs::create_dir_all(&cartella).map_err(super::e)?;
            let engine = crate::sync::Engine::open(&cartella, &sqlite, config.device_id, autore)
                .map_err(super::es)?;
            *locale = Some(std::sync::Arc::new(engine));
        }
        f(locale
            .as_deref()
            .ok_or_else(|| "outbox comunicazioni non disponibile".to_string())?)
    }

    /// Aggiorna soltanto gli indicatori applicativi dell'entità sorgente. Corpo,
    /// recapito, ricevuta, errori e cronologia restano nel registro locale.
    fn registra_esito_su_origine_condivisa(
        &self,
        comunicazione: &ComunicazioneDto,
    ) -> AppResult<()> {
        if !comunicazione.stato.positivo() || comunicazione.origine_id.is_empty() {
            return Ok(());
        }

        if comunicazione.origine_entita == "spedizione"
            && comunicazione.tipo_modello == "preavviso_spedizione"
            && !comunicazione.origine_fingerprint.is_empty()
        {
            let mut origini = vec![OrigineCorrelataInput {
                id: comunicazione.origine_id.clone(),
                fingerprint: comunicazione.origine_fingerprint.clone(),
            }];
            origini.extend(comunicazione.origini_correlate.clone());
            origini.sort_by(|a, b| a.id.cmp(&b.id));
            origini.dedup_by(|a, b| a.id == b.id);
            let inviata_ms = comunicazione.inviata_ms;
            let canale = comunicazione.canale.as_str().to_string();
            return self.with_engine(|engine| {
                engine
                    .emit_built_checked(move |projection| {
                        let mut mutations = Vec::new();
                        for origine in &origini {
                            let Some(spedizione) = projection
                                .get("spedizione", &origine.id)
                                .map_err(|error| error.to_string())?
                                .filter(|record| !record.deleted)
                            else {
                                continue;
                            };
                            let ultimo_corrente = spedizione
                                .data
                                .get("ultimo_avviso_ms")
                                .and_then(Value::as_u64)
                                .unwrap_or(0);
                            if inviata_ms < ultimo_corrente {
                                continue;
                            }
                            for (field, value) in [
                                ("ultimo_avviso_ms", json!(inviata_ms)),
                                ("ultimo_avviso_canale", json!(canale.clone())),
                                (
                                    "ultimo_avviso_fingerprint",
                                    json!(origine.fingerprint.clone()),
                                ),
                            ] {
                                if spedizione.data.get(field) != Some(&value) {
                                    mutations.push(Mutation::new(
                                        "spedizione",
                                        origine.id.clone(),
                                        EventBody::FieldSet {
                                            field: field.into(),
                                            value,
                                        },
                                    ));
                                }
                            }
                        }
                        Ok(mutations)
                    })
                    .map(|_| ())
                    .map_err(es)
            });
        }

        if comunicazione.origine_entita == "lotto_produzione"
            && comunicazione.tipo_modello == "invio_produzione"
        {
            let lot = comunicazione.origine_id.clone();
            let sent_ms = comunicazione.inviata_ms;
            let user = comunicazione.proprietario_utente_nome.clone();
            let device = comunicazione.proprietario_dispositivo_nome.clone();
            let communication_id = comunicazione.id.clone();
            return self.with_engine(|engine| {
                engine
                    .emit_built_checked(move |projection| {
                        let rows = projection
                            .list("riga_ordine")
                            .unwrap_or_default()
                            .into_iter()
                            .filter(|record| {
                                !record.deleted
                                    && str_field(&record.data, "lotto_produzione") == lot
                            })
                            .collect::<Vec<_>>();
                        let mut mutations = Vec::new();
                        for row in rows {
                            for (field, value) in [
                                ("ultimo_invio_laboratorio_ms", json!(sent_ms)),
                                ("ultimo_invio_laboratorio_utente", json!(user.clone())),
                                (
                                    "ultimo_invio_laboratorio_dispositivo",
                                    json!(device.clone()),
                                ),
                                ("ultimo_invio_laboratorio_lotto", json!(lot.clone())),
                                (
                                    "ultimo_invio_laboratorio_comunicazione_id",
                                    json!(communication_id.clone()),
                                ),
                            ] {
                                mutations.push(Mutation::new(
                                    "riga_ordine",
                                    row.id.clone(),
                                    EventBody::FieldSet {
                                        field: field.into(),
                                        value,
                                    },
                                ));
                            }
                        }
                        Ok(mutations)
                    })
                    .map(|_| ())
                    .map_err(es)
            });
        }

        if comunicazione.origine_entita != "preventivo"
            || comunicazione.origine_fingerprint.is_empty()
        {
            return Ok(());
        }
        let origine_id = comunicazione.origine_id.clone();
        let origine_fingerprint = comunicazione.origine_fingerprint.clone();
        let tipo_modello = comunicazione.tipo_modello.clone();
        let inviata_ms = comunicazione.inviata_ms;
        let canale = comunicazione.canale.as_str().to_string();
        self.with_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    let Some(preventivo) = projection
                        .get("preventivo", &origine_id)
                        .map_err(|error| error.to_string())?
                        .filter(|record| !record.deleted)
                    else {
                        return Ok(Vec::new());
                    };
                    let mut mutations = Vec::new();
                    let mut imposta = |field: &str, value: Value| {
                        if preventivo.data.get(field) != Some(&value) {
                            mutations.push(Mutation::new(
                                "preventivo",
                                origine_id.clone(),
                                EventBody::FieldSet {
                                    field: field.into(),
                                    value,
                                },
                            ));
                        }
                    };
                    let ultimo_corrente = preventivo
                        .data
                        .get("ultimo_invio_ms")
                        .and_then(Value::as_u64)
                        .unwrap_or(0);
                    if inviata_ms >= ultimo_corrente {
                        imposta("ultimo_invio_ms", json!(inviata_ms));
                        imposta("ultimo_invio_canale", json!(canale));
                        imposta("ultimo_invio_fingerprint", json!(origine_fingerprint));
                    }
                    imposta(
                        match canale.as_str() {
                            "email" => "preventivo_email_inviato",
                            _ => "preventivo_whatsapp_inviato",
                        },
                        json!(true),
                    );
                    if tipo_modello == "sollecito_preventivo" {
                        let ultimo_sollecito = preventivo
                            .data
                            .get("ultimo_sollecito_ms")
                            .and_then(Value::as_u64)
                            .unwrap_or(0);
                        if inviata_ms >= ultimo_sollecito {
                            imposta("ultimo_sollecito_ms", json!(inviata_ms));
                        }
                    }
                    Ok(mutations)
                })
                .map(|_| ())
                .map_err(es)
        })
    }

    fn marca_origine_comunicazione_allineata(&self, id: &str) -> AppResult<()> {
        self.with_communication_engine(|engine| {
            engine
                .emit(
                    ENTITA_COMUNICAZIONE,
                    id,
                    EventBody::FieldSet {
                        field: "origine_allineata".into(),
                        value: json!(true),
                    },
                )
                .map(|_| ())
                .map_err(es)
        })
    }

    fn riallinea_esito_locale(&self, comunicazione: &ComunicazioneDto) -> AppResult<()> {
        self.registra_esito_su_origine_condivisa(comunicazione)?;
        self.marca_origine_comunicazione_allineata(&comunicazione.id)
    }

    fn riallinea_esiti_locali_in_attesa(&self) -> AppResult<()> {
        let positive = self.with_communication_engine(|engine| {
            Ok(engine.with_projection(|projection| {
                projection
                    .list(ENTITA_COMUNICAZIONE)
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|record| {
                        !record
                            .data
                            .get("origine_allineata")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                    })
                    .filter_map(|record| dto(record).ok())
                    .filter(|comunicazione| comunicazione.stato.positivo())
                    .collect::<Vec<_>>()
            }))
        })?;
        for comunicazione in positive {
            self.riallinea_esito_locale(&comunicazione)?;
            let _ = self.rimuovi_cache_comunicazione_se_non_usata(&comunicazione);
        }
        Ok(())
    }

    #[cfg(not(test))]
    fn emetti_stato_comunicazione_locale(&self, comunicazione: &ComunicazioneDto) {
        let handle = self.app_handle.lock().expect("app handle poisoned").clone();
        if let Some(handle) = handle {
            // Evento operativo effimero: non è un record del motore condiviso e
            // quindi non entra in backup, snapshot o sincronizzazione.
            let _ = handle.emit("pt:comunicazione-stato-locale", comunicazione.clone());
        }
    }

    #[cfg(test)]
    fn emetti_stato_comunicazione_locale(&self, _comunicazione: &ComunicazioneDto) {}

    pub(crate) fn comunicazione_wake_token(&self) -> u64 {
        self.communication_wake.token()
    }

    pub(crate) fn comunicazione_attendi_lavoro(&self, token: u64, timeout: Duration) -> u64 {
        self.communication_wake.wait_after(token, timeout)
    }

    pub(crate) fn comunicazione_intervallo_riprova(&self) -> Duration {
        #[cfg(target_os = "windows")]
        {
            let dispositivo = self.config().device_id;
            let trattenute = self
                .communication_startup_held
                .lock()
                .expect("communication startup gate poisoned")
                .clone();
            let whatsapp_in_attesa = self
                .comunicazioni_lista()
                .map(|comunicazioni| {
                    comunicazioni.into_iter().any(|comunicazione| {
                        comunicazione.stato == StatoComunicazione::InCoda
                            && comunicazione.canale == CanaleComunicazione::Whatsapp
                            && comunicazione.proprietario_dispositivo_id == dispositivo
                            && trattenute
                                .as_ref()
                                .is_some_and(|ids| !ids.contains(&comunicazione.id))
                    })
                })
                .unwrap_or(false);
            if whatsapp_in_attesa {
                // GetLastInputInfo non emette eventi quando l'utente smette di
                // usare il PC: il worker deve ricontrollare la quiete in tempi
                // brevi, altrimenti una coda resta apparentemente bloccata.
                return Duration::from_secs(1);
            }
        }
        Duration::from_secs(30)
    }

    #[cfg(not(test))]
    fn emetti_errore_invio(&self, comunicazione: &ComunicazioneDto) {
        let handle = self.app_handle.lock().expect("app handle poisoned").clone();
        if let Some(handle) = handle {
            let _ = handle.emit(
                "pt:comunicazione-invio-errore",
                ComunicazioneInvioErroreDto {
                    id: comunicazione.id.clone(),
                    campagna_id: comunicazione.campagna_id.clone(),
                    canale: comunicazione.canale,
                    destinatario: comunicazione.recapito.clone(),
                    oggetto: comunicazione.oggetto.clone(),
                    messaggio: comunicazione.ultimo_errore.clone(),
                    errore_codice: comunicazione.errore_codice.clone(),
                    errore_fase: comunicazione.errore_fase.clone(),
                    esito_ambiguo: comunicazione.esito_ambiguo,
                },
            );
        }
    }

    #[cfg(test)]
    fn emetti_errore_invio(&self, _comunicazione: &ComunicazioneDto) {}

    pub fn comunicazione_crea_bozza(
        &self,
        input: ComunicazioneCreaInput,
    ) -> AppResult<ComunicazioneDto> {
        crate::premium::ensure_access(self)?;
        let identity = self
            .whoami()
            .ok_or("seleziona un utente prima di creare una comunicazione")?;
        let preparata = prepara(
            input,
            ProprietarioComunicazione {
                utente_id: identity.user_id,
                utente_nome: identity.nome,
                dispositivo_id: identity.device_id,
                dispositivo_nome: identity.device_nome,
            },
        )?;
        let id = preparata.id.clone();
        let id_closure = id.clone();
        if preparata.destinatario_entita != DESTINATARIO_DIAGNOSTICA_WHATSAPP {
            self.with_engine(|engine| {
                engine.with_projection(|projection| {
                    if preparata.destinatario_entita != DESTINATARIO_LABORATORIO_LABORATORIO {
                        projection
                            .get(&preparata.destinatario_entita, &preparata.destinatario_id)
                            .map_err(|error| error.to_string())?
                            .filter(|record| !record.deleted)
                            .ok_or_else(|| {
                                "il destinatario non esiste più o è stato eliminato".to_string()
                            })?;
                    }
                    if !preparata.origine_entita.is_empty()
                        && preparata.origine_entita != "lotto_produzione"
                    {
                        let origine = projection
                            .get(&preparata.origine_entita, &preparata.origine_id)
                            .map_err(|error| error.to_string())?
                            .filter(|record| !record.deleted)
                            .ok_or_else(|| {
                                "l'elemento collegato non esiste più o è stato eliminato"
                                    .to_string()
                            })?;
                        let revisione_origine_cambiata = !preparata.origine_revision.is_empty()
                            && origine.updated_hlc.to_string() != preparata.origine_revision;
                        // L'esito di un invio aggiorna gli indicatori operativi del
                        // preventivo e quindi anche la sua revisione. Un secondo invio
                        // dalla stessa anteprima resta valido finché la fingerprint del
                        // documento non è cambiata; una vera modifica commerciale viene
                        // invece ancora respinta come concorrenza.
                        let stesso_preventivo_semantico = preparata.origine_entita == "preventivo"
                            && !preparata.origine_fingerprint.is_empty()
                            && str_field(&origine.data, "fingerprint_corrente")
                                == preparata.origine_fingerprint;
                        if revisione_origine_cambiata && !stesso_preventivo_semantico {
                            return Err(
                            "l'elemento collegato è cambiato durante la revisione: riapri l'invio"
                                .into(),
                        );
                        }
                        for correlata in &preparata.origini_correlate {
                            projection
                                .get(&preparata.origine_entita, &correlata.id)
                                .map_err(|error| error.to_string())?
                                .filter(|record| !record.deleted)
                                .ok_or_else(|| {
                                    "un elemento collegato non esiste più o è stato eliminato"
                                        .to_string()
                                })?;
                        }
                    }
                    if preparata.origine_entita == "lotto_produzione" {
                        let exists = projection
                            .list("riga_ordine")
                            .unwrap_or_default()
                            .into_iter()
                            .any(|record| {
                                !record.deleted
                                    && str_field(&record.data, "lotto_produzione")
                                        == preparata.origine_id
                            });
                        if !exists {
                            return Err("il lotto di produzione non è più disponibile".into());
                        }
                    }
                    Ok(())
                })
            })?;
        }
        if !preparata.reinvio_di.is_empty() {
            if preparata.reinvio_di == id {
                return Err("una comunicazione non può reinviare se stessa".into());
            }
            if !self
                .comunicazioni_lista()?
                .iter()
                .any(|item| item.id == preparata.reinvio_di)
            {
                return Err("la comunicazione originale del reinvio non esiste".into());
            }
        }

        self.with_communication_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    if let Some(esistente) = projection
                        .get(ENTITA_COMUNICAZIONE, &id_closure)
                        .map_err(|error| error.to_string())?
                    {
                        if esistente.deleted {
                            return Err(
                                "la stessa richiesta era stata eliminata: usa un nuovo reinvio"
                                    .into(),
                            );
                        }
                        let fingerprint = esistente
                            .data
                            .get("payload")
                            .and_then(Value::as_object)
                            .map(|payload| str_field(payload, "fingerprint"))
                            .unwrap_or_default();
                        if fingerprint != preparata.payload_fingerprint {
                            return Err(
                                "la chiave di idempotenza è già associata a un messaggio diverso"
                                    .into(),
                            );
                        }
                        return Ok(Vec::new());
                    }

                    let mut mutations = vec![Mutation::new(
                        ENTITA_COMUNICAZIONE,
                        id_closure.clone(),
                        EventBody::Created,
                    )];
                    mutations.extend(preparata.fields.into_iter().map(|(field, value)| {
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_closure.clone(),
                            EventBody::FieldSet { field, value },
                        )
                    }));
                    Ok(mutations)
                })
                .map_err(es)?;

            engine
                .with_projection(|projection| {
                    projection.get(ENTITA_COMUNICAZIONE, &id).ok().flatten()
                })
                .ok_or_else(|| "comunicazione non trovata dopo la creazione".to_string())
                .and_then(dto)
        })
    }

    pub fn comunicazioni_lista(&self) -> AppResult<Vec<ComunicazioneDto>> {
        crate::premium::ensure_access(self)?;
        let mut out = self.with_communication_engine(|engine| {
            let records = engine.with_projection(|projection| {
                projection.list(ENTITA_COMUNICAZIONE).unwrap_or_default()
            });
            records.into_iter().map(dto).collect::<AppResult<Vec<_>>>()
        })?;
        out.sort_by_key(|item| std::cmp::Reverse(item.stato_aggiornato_ms));
        Ok(out)
    }

    fn comunicazione_cambia_stato(
        &self,
        id: &str,
        nuovo: StatoComunicazione,
        solo_pc_origine: bool,
    ) -> AppResult<ComunicazioneDto> {
        crate::premium::ensure_access(self)?;
        let id_owned = id.to_string();
        let dispositivo_corrente = self.config().device_id;
        let recapito_da_aggiornare: Result<Option<String>, String> = if nuovo
            == StatoComunicazione::InCoda
        {
            let info = self.with_communication_engine(|engine| {
                Ok(engine.with_projection(|projection| {
                    let record = projection.get(ENTITA_COMUNICAZIONE, id).ok().flatten()?;
                    if record.deleted {
                        return None;
                    }
                    let stato =
                        StatoComunicazione::parse(&str_field(&record.data, "stato")).ok()?;
                    if stato != StatoComunicazione::Fallito {
                        return None;
                    }
                    let payload = record.data.get("payload").and_then(Value::as_object)?;
                    let entita = str_field(payload, "destinatario_entita");
                    let dest_id = str_field(payload, "destinatario_id");
                    let recapito = str_field(payload, "recapito");
                    let canale = CanaleComunicazione::parse(&str_field(payload, "canale")).ok()?;
                    Some((entita, dest_id, canale, recapito))
                }))
            })?;
            if let Some((entita, dest_id, canale, recapito)) = info {
                self.recapito_destinatario_aggiornato(&entita, &dest_id, canale, &recapito)
                    .map(Some)
            } else {
                Ok(None)
            }
        } else {
            Ok(None)
        };
        let recapito_da_aggiornare_val = recapito_da_aggiornare.clone();
        let aggiornata = self.with_communication_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    let corrente = projection
                        .get(ENTITA_COMUNICAZIONE, &id_owned)
                        .map_err(|error| error.to_string())?
                        .filter(|record| !record.deleted)
                        .ok_or_else(|| "comunicazione non trovata".to_string())?;
                    if solo_pc_origine {
                        let proprietario_dispositivo = corrente
                            .data
                            .get("proprietario")
                            .and_then(Value::as_object)
                            .map(|value| str_field(value, "dispositivoId"))
                            .unwrap_or_default();
                        if proprietario_dispositivo != dispositivo_corrente {
                            return Err(
                                "questa comunicazione verrà inviata dal PC che l'ha creata"
                                    .into(),
                            );
                        }
                    }
                    let stato = StatoComunicazione::parse(&str_field(&corrente.data, "stato"))?;
                    if stato == nuovo {
                        return Ok(Vec::new());
                    }
                    if stato.positivo() {
                        return Err(
                            "il messaggio risulta già inviato: crea un reinvio intenzionale".into(),
                        );
                    }
                    if stato == StatoComunicazione::Fallito
                        && nuovo == StatoComunicazione::InCoda
                        && corrente
                            .data
                            .get("esito_ambiguo")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                    {
                        return Err(
                            "l'esito del tentativo precedente è incerto: crea un reinvio intenzionale"
                                .into(),
                        );
                    }
                    if stato == StatoComunicazione::Fallito
                        && nuovo == StatoComunicazione::InCoda
                    {
                        let campagna_id = corrente
                            .data
                            .get("payload")
                            .and_then(Value::as_object)
                            .map(|payload| str_field(payload, "campagna_id"))
                            .unwrap_or_default();
                        if !campagna_id.is_empty() {
                            let campagna_ancora_attiva = projection
                                .list(ENTITA_COMUNICAZIONE)
                                .map_err(|error| error.to_string())?
                                .into_iter()
                                .filter(|record| record.id != id_owned)
                                .filter(|record| {
                                    record
                                        .data
                                        .get("payload")
                                        .and_then(Value::as_object)
                                        .map(|payload| str_field(payload, "campagna_id"))
                                        .as_deref()
                                        == Some(campagna_id.as_str())
                                })
                                .try_fold(false, |attiva, record| {
                                    let stato = StatoComunicazione::parse(&str_field(
                                        &record.data,
                                        "stato",
                                    ))?;
                                    Ok::<_, String>(
                                        attiva
                                            || matches!(
                                                stato,
                                                StatoComunicazione::Bozza
                                                    | StatoComunicazione::DaRevisionare
                                                    | StatoComunicazione::InCoda
                                                    | StatoComunicazione::Sospeso
                                                    | StatoComunicazione::InInvio
                                            ),
                                    )
                                })?;
                            if campagna_ancora_attiva {
                                return Err(
                                    "attendi che la campagna completi gli altri destinatari; poi riprova i falliti"
                                        .into(),
                                );
                            }
                        }
                    }
                    if !transizione_valida(stato, nuovo) {
                        return Err(format!(
                            "passaggio da «{}» a «{}» non consentito",
                            stato.as_str(),
                            nuovo.as_str()
                        ));
                    }
                    let mut mutations = vec![
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "stato".into(),
                                value: json!(nuovo.as_str()),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "stato_aggiornato_ms".into(),
                                value: json!(now_ms()),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: CAMPO_INTERRUZIONE_RICHIESTA.into(),
                                value: json!(""),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "ultimo_errore".into(),
                                value: json!(""),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "errore_codice".into(),
                                value: json!(""),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "errore_fase".into(),
                                value: json!(""),
                            },
                        ),
                    ];
                    let nuovo_rec = recapito_da_aggiornare_val
                        .as_ref()
                        .map_err(|e| format!("Impossibile riprovare l'invio: {e}"))?;
                    if let Some(ref nuovo_rec) = nuovo_rec {
                        if let Some(payload_obj) = corrente.data.get("payload").and_then(Value::as_object) {
                            let recapito_attuale = str_field(payload_obj, "recapito");
                            if &recapito_attuale != nuovo_rec {
                                let mut nuovo_payload = payload_obj.clone();
                                nuovo_payload.insert("recapito".into(), json!(nuovo_rec));
                                let payload_bytes = serde_json::to_vec(&nuovo_payload).map_err(es)?;
                                let nuovo_fp = sha256_hex(payload_bytes);
                                nuovo_payload.insert("fingerprint".into(), json!(nuovo_fp));
                                mutations.push(Mutation::new(
                                    ENTITA_COMUNICAZIONE,
                                    id_owned.clone(),
                                    EventBody::FieldSet {
                                        field: "payload".into(),
                                        value: json!(nuovo_payload),
                                    },
                                ));
                            }
                        }
                    }
                    Ok(mutations)
                })
                .map_err(es)?;
            engine
                .with_projection(|projection| {
                    projection.get(ENTITA_COMUNICAZIONE, id).ok().flatten()
                })
                .ok_or_else(|| "comunicazione non trovata dopo l'aggiornamento".to_string())
                .and_then(dto)
        })?;
        self.emetti_stato_comunicazione_locale(&aggiornata);
        if !aggiornata.stato.richiede_documento_temporaneo() {
            let _ = self.rimuovi_cache_comunicazione_se_non_usata(&aggiornata);
        }
        Ok(aggiornata)
    }

    pub fn comunicazione_metti_in_coda(&self, id: &str) -> AppResult<ComunicazioneDto> {
        let corrente = self
            .comunicazioni_lista()?
            .into_iter()
            .find(|comunicazione| comunicazione.id == id)
            .ok_or("comunicazione non trovata")?;
        for allegato in &corrente.allegati {
            self.documento_cache_leggi(allegato).map_err(|_| {
                "il documento temporaneo non è più disponibile: riapri l'elemento e rigenera l'invio"
                    .to_string()
            })?;
        }
        let comunicazione =
            self.comunicazione_cambia_stato(id, StatoComunicazione::InCoda, true)?;
        self.rilascia_comunicazione_trattenuta_all_avvio(id);
        self.communication_wake.signal();
        Ok(comunicazione)
    }

    /// Congela esclusivamente in memoria le comunicazioni già in coda quando
    /// parte il processo. Non cambia stato, non scrive eventi e non tocca i
    /// backup: una nuova sessione non può quindi inviarle automaticamente.
    pub(crate) fn comunicazioni_trattieni_coda_all_avvio(&self) -> AppResult<usize> {
        let dispositivo = self.config().device_id;
        let trattenute = self
            .comunicazioni_lista()?
            .into_iter()
            .filter(|comunicazione| {
                comunicazione.stato == StatoComunicazione::InCoda
                    && comunicazione.proprietario_dispositivo_id == dispositivo
            })
            .map(|comunicazione| comunicazione.id)
            .collect::<HashSet<_>>();
        let totale = trattenute.len();
        *self
            .communication_startup_held
            .lock()
            .expect("communication startup gate poisoned") = Some(trattenute);
        Ok(totale)
    }

    fn rilascia_comunicazione_trattenuta_all_avvio(&self, id: &str) {
        if let Some(trattenute) = self
            .communication_startup_held
            .lock()
            .expect("communication startup gate poisoned")
            .as_mut()
        {
            trattenute.remove(id);
        }
    }

    pub fn comunicazione_annulla(&self, id: &str) -> AppResult<ComunicazioneDto> {
        if self
            .comunicazioni_lista()?
            .into_iter()
            .find(|comunicazione| comunicazione.id == id)
            .is_some_and(|comunicazione| comunicazione.stato == StatoComunicazione::InInvio)
        {
            return self.comunicazione_richiedi_interruzione(id, INTERRUZIONE_ANNULLA);
        }
        let aggiornata =
            self.comunicazione_cambia_stato(id, StatoComunicazione::Annullato, false)?;
        if aggiornata.canale == CanaleComunicazione::Whatsapp {
            self.minimizza_whatsapp_se_inattivo();
        }
        Ok(aggiornata)
    }

    fn comunicazione_richiedi_interruzione(
        &self,
        id: &str,
        richiesta: &str,
    ) -> AppResult<ComunicazioneDto> {
        let id_owned = id.to_string();
        let richiesta = richiesta.to_string();
        let aggiornata = self.with_communication_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    let corrente = projection
                        .get(ENTITA_COMUNICAZIONE, &id_owned)
                        .map_err(|error| error.to_string())?
                        .filter(|record| !record.deleted)
                        .ok_or_else(|| "comunicazione non trovata".to_string())?;
                    let stato = StatoComunicazione::parse(&str_field(&corrente.data, "stato"))?;
                    if stato != StatoComunicazione::InInvio {
                        // L'adattatore può avere concluso tra la lettura iniziale
                        // e questa mutazione: chiudere in quel preciso istante è
                        // un no-op, non un errore da mostrare all'operatore.
                        return Ok(Vec::new());
                    }
                    Ok(vec![
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: CAMPO_INTERRUZIONE_RICHIESTA.into(),
                                value: json!(richiesta),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "stato_aggiornato_ms".into(),
                                value: json!(now_ms()),
                            },
                        ),
                    ])
                })
                .map_err(es)?;
            engine
                .with_projection(|projection| {
                    projection.get(ENTITA_COMUNICAZIONE, id).ok().flatten()
                })
                .ok_or_else(|| "comunicazione non trovata dopo l'interruzione".to_string())
                .and_then(dto)
        })?;
        self.emetti_stato_comunicazione_locale(&aggiornata);
        let _ = self.rimuovi_cache_comunicazione_se_non_usata(&aggiornata);
        Ok(aggiornata)
    }

    fn comunicazione_interruzione_richiesta(&self, id: &str) -> Option<StatoComunicazione> {
        self.with_communication_engine(|engine| {
            Ok(engine.with_projection(|projection| {
                let record = projection.get(ENTITA_COMUNICAZIONE, id).ok().flatten()?;
                let stato = StatoComunicazione::parse(&str_field(&record.data, "stato")).ok()?;
                if stato == StatoComunicazione::Annullato {
                    return Some(StatoComunicazione::Annullato);
                }
                if stato != StatoComunicazione::InInvio {
                    return None;
                }
                match str_field(&record.data, CAMPO_INTERRUZIONE_RICHIESTA).as_str() {
                    INTERRUZIONE_SOSPENDI => Some(StatoComunicazione::Sospeso),
                    INTERRUZIONE_ANNULLA => Some(StatoComunicazione::Annullato),
                    INTERRUZIONE_RIPRENDI => Some(StatoComunicazione::InCoda),
                    _ => None,
                }
            }))
        })
        .ok()
        .flatten()
    }

    fn comunicazione_interrotta(&self, id: &str) -> bool {
        self.comunicazione_interruzione_richiesta(id).is_some()
    }

    fn minimizza_whatsapp_se_inattivo(&self) {
        #[cfg(all(target_os = "windows", not(test)))]
        {
            let dispositivo = self.config().device_id;
            let whatsapp_attivo = self
                .comunicazioni_lista()
                .map(|comunicazioni| {
                    comunicazioni.into_iter().any(|comunicazione| {
                        comunicazione.canale == CanaleComunicazione::Whatsapp
                            && comunicazione.proprietario_dispositivo_id == dispositivo
                            && matches!(
                                comunicazione.stato,
                                StatoComunicazione::InCoda | StatoComunicazione::InInvio
                            )
                    })
                })
                .unwrap_or(true);
            if !whatsapp_attivo {
                // Un thread STA dedicato evita conflitti con l'apartment COM
                // usato dal runtime Tauri che ha ricevuto il dismiss.
                let _ = std::thread::spawn(crate::app::whatsapp_windows::minimizza_finestre);
            }
        }
    }

    fn purga_comunicazione_locale(&self, id: &str) -> AppResult<()> {
        self.with_communication_engine(|engine| {
            let presente = engine
                .with_projection(|projection| projection.get(ENTITA_COMUNICAZIONE, id))
                .map_err(es)?
                .is_some();
            if presente {
                engine
                    .emit(ENTITA_COMUNICAZIONE, id, EventBody::Purged)
                    .map_err(es)?;
            }
            Ok(())
        })
    }

    fn comunicazioni_elimina_validate(
        &self,
        ids: &[String],
        errore_vuoto: &str,
    ) -> AppResult<usize> {
        let ids = ids
            .iter()
            .map(|id| id.trim())
            .filter(|id| !id.is_empty())
            .collect::<std::collections::HashSet<_>>();
        if ids.is_empty() {
            return Err(errore_vuoto.into());
        }
        let comunicazioni = self
            .comunicazioni_lista()?
            .into_iter()
            .filter(|comunicazione| ids.contains(comunicazione.id.as_str()))
            .collect::<Vec<_>>();
        if comunicazioni.len() != ids.len() {
            return Err("una o più comunicazioni non sono state trovate".into());
        }
        if comunicazioni.iter().any(|comunicazione| {
            matches!(
                comunicazione.stato,
                StatoComunicazione::Bozza
                    | StatoComunicazione::DaRevisionare
                    | StatoComunicazione::InCoda
                    | StatoComunicazione::Sospeso
                    | StatoComunicazione::InInvio
            )
        }) {
            return Err("una comunicazione ancora attiva non può essere eliminata".into());
        }
        for comunicazione in &comunicazioni {
            self.purga_comunicazione_locale(&comunicazione.id)?;
            if comunicazione.tipo_modello == "invio_produzione" {
                self.rimuovi_documenti_cache_specifici_non_usati(&comunicazione.allegati)?;
            } else {
                self.rimuovi_documenti_cache_non_usati(&comunicazione.allegati)?;
            }
        }
        Ok(comunicazioni.len())
    }

    /// Rimuove una voce terminale dalla cronologia del solo PC corrente.
    pub fn comunicazione_elimina(&self, id: &str) -> AppResult<()> {
        crate::premium::ensure_access(self)?;
        self.comunicazioni_elimina_validate(&[id.to_string()], "comunicazione non specificata")
            .map(|_| ())
    }

    /// Elimina in batch comunicazioni terminali dopo aver validato l'intera
    /// selezione, evitando round-trip e aggiornamenti UI per ogni singola voce.
    pub fn comunicazioni_elimina(&self, ids: &[String]) -> AppResult<usize> {
        crate::premium::ensure_access(self)?;
        self.comunicazioni_elimina_validate(ids, "nessuna comunicazione selezionata")
    }

    /// Scarta in una sola operazione logica una campagna già terminata.
    pub fn campagna_comunicazione_elimina(&self, campagna_id: &str) -> AppResult<usize> {
        crate::premium::ensure_access(self)?;
        let campagna_id = campagna_id.trim();
        if campagna_id.is_empty() {
            return Err("campagna non specificata".into());
        }
        let comunicazioni = self
            .comunicazioni_lista()?
            .into_iter()
            .filter(|comunicazione| comunicazione.campagna_id == campagna_id)
            .collect::<Vec<_>>();
        if comunicazioni.is_empty() {
            return Err("campagna non trovata".into());
        }
        if comunicazioni.iter().any(|comunicazione| {
            matches!(
                comunicazione.stato,
                StatoComunicazione::Bozza
                    | StatoComunicazione::DaRevisionare
                    | StatoComunicazione::InCoda
                    | StatoComunicazione::Sospeso
                    | StatoComunicazione::InInvio
            )
        }) {
            return Err("la campagna è ancora attiva e non può essere eliminata".into());
        }
        let ids = comunicazioni
            .into_iter()
            .map(|comunicazione| comunicazione.id)
            .collect::<Vec<_>>();
        self.comunicazioni_elimina_validate(&ids, "campagna non trovata")
    }

    fn campagna_comunicazione_cambia_stato(
        &self,
        campagna_id: &str,
        operazione: &str,
    ) -> AppResult<Vec<ComunicazioneDto>> {
        crate::premium::ensure_access(self)?;
        let campagna_id = campagna_id.trim();
        if campagna_id.is_empty() {
            return Err("campagna non specificata".into());
        }
        let campagna_owned = campagna_id.to_string();
        let operazione_owned = operazione.to_string();
        let dispositivo_corrente = self.config().device_id;
        let recapiti_aggiornati: std::collections::HashMap<String, Result<String, String>> =
            if operazione_owned == "riprova_falliti" {
                let fallite = self.with_communication_engine(|engine| {
                    Ok(engine.with_projection(|projection| {
                        projection
                            .list(ENTITA_COMUNICAZIONE)
                            .unwrap_or_default()
                            .into_iter()
                            .filter(|record| !record.deleted)
                            .filter_map(|record| dto(record).ok())
                            .filter(|c| {
                                c.campagna_id == campagna_owned
                                    && c.stato == StatoComunicazione::Fallito
                                    && c.proprietario_dispositivo_id == dispositivo_corrente
                                    && !c.esito_ambiguo
                            })
                            .map(|c| {
                                (
                                    c.id,
                                    c.destinatario_entita,
                                    c.destinatario_id,
                                    c.canale,
                                    c.recapito,
                                )
                            })
                            .collect::<Vec<_>>()
                    }))
                })?;
                let mut mappa = std::collections::HashMap::new();
                for (id, entita, dest_id, canale, recapito) in fallite {
                    let esito =
                        self.recapito_destinatario_aggiornato(&entita, &dest_id, canale, &recapito);
                    mappa.insert(id, esito);
                }
                mappa
            } else {
                std::collections::HashMap::new()
            };
        let aggiornate = self.with_communication_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    let records = projection
                        .list(ENTITA_COMUNICAZIONE)
                        .map_err(|error| error.to_string())?;
                    if operazione_owned == "riprova_falliti" {
                        let campagna_ancora_attiva =
                            records.iter().try_fold(false, |attiva, record| {
                                let appartiene = record
                                    .data
                                    .get("payload")
                                    .and_then(Value::as_object)
                                    .map(|payload| str_field(payload, "campagna_id"))
                                    .as_deref()
                                    == Some(campagna_owned.as_str());
                                if !appartiene {
                                    return Ok::<_, String>(attiva);
                                }
                                let stato =
                                    StatoComunicazione::parse(&str_field(&record.data, "stato"))?;
                                Ok(attiva
                                    || matches!(
                                        stato,
                                        StatoComunicazione::Bozza
                                            | StatoComunicazione::DaRevisionare
                                            | StatoComunicazione::InCoda
                                            | StatoComunicazione::Sospeso
                                            | StatoComunicazione::InInvio
                                    ))
                            })?;
                        if campagna_ancora_attiva {
                            return Err(
                                "attendi che la campagna completi tutti i destinatari prima di riprovare i falliti"
                                    .into(),
                            );
                        }
                    }
                    let mut trovate = 0usize;
                    let mut mutations = Vec::new();
                    let now = now_ms();
                    for record in records {
                        let payload = record.data.get("payload").and_then(Value::as_object);
                        if payload
                            .map(|value| str_field(value, "campagna_id"))
                            .as_deref()
                            != Some(campagna_owned.as_str())
                        {
                            continue;
                        }
                        trovate += 1;
                        let stato = StatoComunicazione::parse(&str_field(&record.data, "stato"))?;
                        let proprietario_dispositivo = record
                            .data
                            .get("proprietario")
                            .and_then(Value::as_object)
                            .map(|value| str_field(value, "dispositivoId"))
                            .unwrap_or_default();
                        if stato == StatoComunicazione::InInvio
                            && matches!(operazione_owned.as_str(), "sospendi" | "annulla")
                        {
                            let richiesta = if operazione_owned == "sospendi" {
                                INTERRUZIONE_SOSPENDI
                            } else {
                                INTERRUZIONE_ANNULLA
                            };
                            mutations.push(Mutation::new(
                                ENTITA_COMUNICAZIONE,
                                record.id.clone(),
                                EventBody::FieldSet {
                                    field: CAMPO_INTERRUZIONE_RICHIESTA.into(),
                                    value: json!(richiesta),
                                },
                            ));
                            mutations.push(Mutation::new(
                                ENTITA_COMUNICAZIONE,
                                record.id,
                                EventBody::FieldSet {
                                    field: "stato_aggiornato_ms".into(),
                                    value: json!(now),
                                },
                            ));
                            continue;
                        }
                        if stato == StatoComunicazione::InInvio
                            && operazione_owned == "riprendi"
                            && !str_field(&record.data, CAMPO_INTERRUZIONE_RICHIESTA).is_empty()
                        {
                            // Se la ripresa arriva mentre l'automazione sta
                            // ancora recependo la pausa, l'elemento attivo deve
                            // tornare in coda appena si ferma, non restare
                            // sospeso fuori dal batch appena ripreso.
                            mutations.push(Mutation::new(
                                ENTITA_COMUNICAZIONE,
                                record.id.clone(),
                                EventBody::FieldSet {
                                    field: CAMPO_INTERRUZIONE_RICHIESTA.into(),
                                    value: json!(INTERRUZIONE_RIPRENDI),
                                },
                            ));
                            mutations.push(Mutation::new(
                                ENTITA_COMUNICAZIONE,
                                record.id,
                                EventBody::FieldSet {
                                    field: "stato_aggiornato_ms".into(),
                                    value: json!(now),
                                },
                            ));
                            continue;
                        }
                        if operazione_owned == "riprova_falliti" {
                            if stato == StatoComunicazione::Fallito
                                && proprietario_dispositivo == dispositivo_corrente
                                && !record
                                    .data
                                    .get("esito_ambiguo")
                                    .and_then(Value::as_bool)
                                    .unwrap_or(false)
                            {
                                match recapiti_aggiornati.get(&record.id) {
                                    Some(Ok(nuovo_recapito)) => {
                                        let recapito_attuale = payload
                                            .map(|p| str_field(p, "recapito"))
                                            .unwrap_or_default();
                                        if nuovo_recapito != &recapito_attuale {
                                            if let Some(payload_obj) = payload {
                                                let mut nuovo_payload = payload_obj.clone();
                                                nuovo_payload.insert("recapito".into(), json!(nuovo_recapito));
                                                let payload_bytes = serde_json::to_vec(&nuovo_payload).map_err(es)?;
                                                let nuovo_fp = sha256_hex(payload_bytes);
                                                nuovo_payload.insert("fingerprint".into(), json!(nuovo_fp));
                                                mutations.push(Mutation::new(
                                                    ENTITA_COMUNICAZIONE,
                                                    record.id.clone(),
                                                    EventBody::FieldSet {
                                                        field: "payload".into(),
                                                        value: json!(nuovo_payload),
                                                    },
                                                ));
                                            }
                                        }
                                        mutations.push(Mutation::new(
                                            ENTITA_COMUNICAZIONE,
                                            record.id.clone(),
                                            EventBody::FieldSet {
                                                field: "stato".into(),
                                                value: json!(StatoComunicazione::InCoda.as_str()),
                                            },
                                        ));
                                        mutations.push(Mutation::new(
                                            ENTITA_COMUNICAZIONE,
                                            record.id.clone(),
                                            EventBody::FieldSet {
                                                field: "stato_aggiornato_ms".into(),
                                                value: json!(now),
                                            },
                                        ));
                                        mutations.push(Mutation::new(
                                            ENTITA_COMUNICAZIONE,
                                            record.id.clone(),
                                            EventBody::FieldSet {
                                                field: CAMPO_INTERRUZIONE_RICHIESTA.into(),
                                                value: json!(""),
                                            },
                                        ));
                                        mutations.push(Mutation::new(
                                            ENTITA_COMUNICAZIONE,
                                            record.id.clone(),
                                            EventBody::FieldSet {
                                                field: "ultimo_errore".into(),
                                                value: json!(""),
                                            },
                                        ));
                                        mutations.push(Mutation::new(
                                            ENTITA_COMUNICAZIONE,
                                            record.id.clone(),
                                            EventBody::FieldSet {
                                                field: "errore_codice".into(),
                                                value: json!(""),
                                            },
                                        ));
                                        mutations.push(Mutation::new(
                                            ENTITA_COMUNICAZIONE,
                                            record.id.clone(),
                                            EventBody::FieldSet {
                                                field: "errore_fase".into(),
                                                value: json!(""),
                                            },
                                        ));
                                    }
                                    Some(Err(motivo)) => {
                                        mutations.push(Mutation::new(
                                            ENTITA_COMUNICAZIONE,
                                            record.id.clone(),
                                            EventBody::FieldSet {
                                                field: "ultimo_errore".into(),
                                                value: json!(format!("Recapito in anagrafica non valido: {motivo}")),
                                            },
                                        ));
                                        mutations.push(Mutation::new(
                                            ENTITA_COMUNICAZIONE,
                                            record.id.clone(),
                                            EventBody::FieldSet {
                                                field: "errore_codice".into(),
                                                value: json!("recapito_anagrafica_non_valido"),
                                            },
                                        ));
                                        mutations.push(Mutation::new(
                                            ENTITA_COMUNICAZIONE,
                                            record.id.clone(),
                                            EventBody::FieldSet {
                                                field: "stato_aggiornato_ms".into(),
                                                value: json!(now),
                                            },
                                        ));
                                    }
                                    None => {}
                                }
                            }
                            continue;
                        }
                        let nuovo = match operazione_owned.as_str() {
                            "sospendi" if stato == StatoComunicazione::InCoda => {
                                Some(StatoComunicazione::Sospeso)
                            }
                            "riprendi"
                                if (stato == StatoComunicazione::Sospeso
                                    || (stato == StatoComunicazione::Annullato
                                        && proprietario_dispositivo == dispositivo_corrente
                                        && str_field(&record.data, "ultimo_errore").is_empty()
                                        && !record
                                            .data
                                            .get("esito_ambiguo")
                                            .and_then(Value::as_bool)
                                            .unwrap_or(false))) =>
                            {
                                Some(StatoComunicazione::InCoda)
                            }
                            "annulla"
                                if matches!(
                                    stato,
                                    StatoComunicazione::Bozza
                                        | StatoComunicazione::DaRevisionare
                                        | StatoComunicazione::InCoda
                                        | StatoComunicazione::Sospeso
                                        | StatoComunicazione::InInvio
                                ) =>
                            {
                                Some(StatoComunicazione::Annullato)
                            }
                            "sospendi" | "riprendi" | "annulla" => None,
                            _ => return Err("operazione sulla campagna non riconosciuta".into()),
                        };
                        let Some(nuovo) = nuovo else {
                            continue;
                        };
                        mutations.push(Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            record.id.clone(),
                            EventBody::FieldSet {
                                field: "stato".into(),
                                value: json!(nuovo.as_str()),
                            },
                        ));
                        mutations.push(Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            record.id.clone(),
                            EventBody::FieldSet {
                                field: "stato_aggiornato_ms".into(),
                                value: json!(now),
                            },
                        ));
                        mutations.push(Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            record.id,
                            EventBody::FieldSet {
                                field: CAMPO_INTERRUZIONE_RICHIESTA.into(),
                                value: json!(""),
                            },
                        ));
                    }
                    if trovate == 0 {
                        return Err("campagna non trovata".into());
                    }
                    Ok(mutations)
                })
                .map_err(es)?;

            let mut comunicazioni = engine.with_projection(|projection| {
                projection
                    .list(ENTITA_COMUNICAZIONE)
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|record| {
                        record
                            .data
                            .get("payload")
                            .and_then(Value::as_object)
                            .map(|payload| str_field(payload, "campagna_id"))
                            .as_deref()
                            == Some(campagna_id)
                    })
                    .map(dto)
                    .collect::<AppResult<Vec<_>>>()
            })?;
            comunicazioni.sort_by_key(|item| item.creata_ms);
            Ok(comunicazioni)
        })?;
        for comunicazione in &aggiornate {
            self.emetti_stato_comunicazione_locale(comunicazione);
        }
        if aggiornate
            .iter()
            .any(|comunicazione| !comunicazione.stato.richiede_documento_temporaneo())
        {
            let _ = self.pulisci_cache_documenti_non_usata();
        }
        let mut complete = self
            .comunicazioni_lista()?
            .into_iter()
            .filter(|comunicazione| comunicazione.campagna_id == campagna_id)
            .collect::<Vec<_>>();
        complete.sort_by_key(|item| item.creata_ms);
        Ok(complete)
    }

    pub fn campagna_comunicazione_sospendi(
        &self,
        campagna_id: &str,
    ) -> AppResult<Vec<ComunicazioneDto>> {
        let aggiornate = self.campagna_comunicazione_cambia_stato(campagna_id, "sospendi")?;
        #[cfg(all(target_os = "windows", not(test)))]
        {
            // La pausa deve essere percepibile subito, senza aspettare che la
            // scansione UIA attiva termini e che il worker rilasci la coda.
            let _ = std::thread::spawn(crate::app::whatsapp_windows::minimizza_finestre);
        }
        Ok(aggiornate)
    }

    pub fn campagna_comunicazione_riprendi(
        &self,
        campagna_id: &str,
    ) -> AppResult<Vec<ComunicazioneDto>> {
        let comunicazioni = self.campagna_comunicazione_cambia_stato(campagna_id, "riprendi")?;
        if comunicazioni
            .iter()
            .any(|item| item.stato == StatoComunicazione::InCoda)
        {
            self.communication_wake.signal();
        }
        Ok(comunicazioni)
    }

    pub fn campagna_comunicazione_annulla(
        &self,
        campagna_id: &str,
    ) -> AppResult<Vec<ComunicazioneDto>> {
        let aggiornate = self.campagna_comunicazione_cambia_stato(campagna_id, "annulla")?;
        if aggiornate
            .iter()
            .any(|comunicazione| comunicazione.canale == CanaleComunicazione::Whatsapp)
        {
            self.minimizza_whatsapp_se_inattivo();
        }
        Ok(aggiornate)
    }

    pub fn campagna_comunicazione_riprova_fallite(
        &self,
        campagna_id: &str,
    ) -> AppResult<Vec<ComunicazioneDto>> {
        let comunicazioni =
            self.campagna_comunicazione_cambia_stato(campagna_id, "riprova_falliti")?;
        if comunicazioni
            .iter()
            .any(|item| item.stato == StatoComunicazione::InCoda)
        {
            self.communication_wake.signal();
        }
        Ok(comunicazioni)
    }

    fn comunicazione_inizia_invio(&self, id: &str) -> AppResult<ComunicazioneDto> {
        let id_owned = id.to_string();
        let dispositivo_corrente = self.config().device_id;
        let aggiornata = self.with_communication_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    let corrente = projection
                        .get(ENTITA_COMUNICAZIONE, &id_owned)
                        .map_err(|error| error.to_string())?
                        .filter(|record| !record.deleted)
                        .ok_or_else(|| "comunicazione non trovata".to_string())?;
                    let proprietario_dispositivo = corrente
                        .data
                        .get("proprietario")
                        .and_then(Value::as_object)
                        .map(|value| str_field(value, "dispositivoId"))
                        .unwrap_or_default();
                    if proprietario_dispositivo != dispositivo_corrente {
                        return Err(
                            "soltanto il PC che ha creato la comunicazione può inviarla".into()
                        );
                    }
                    let stato = StatoComunicazione::parse(&str_field(&corrente.data, "stato"))?;
                    if stato != StatoComunicazione::InCoda {
                        return Err(format!(
                            "la comunicazione non è pronta per l'invio: stato «{}»",
                            stato.as_str()
                        ));
                    }
                    let tentativi = corrente
                        .data
                        .get("tentativi")
                        .and_then(Value::as_u64)
                        .unwrap_or(0)
                        .saturating_add(1);
                    let now = now_ms();
                    Ok(vec![
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "stato".into(),
                                value: json!(StatoComunicazione::InInvio.as_str()),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "tentativi".into(),
                                value: json!(tentativi),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "ultimo_errore".into(),
                                value: json!(""),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "errore_codice".into(),
                                value: json!(""),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "errore_fase".into(),
                                value: json!(""),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "esito_ambiguo".into(),
                                value: json!(false),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "stato_aggiornato_ms".into(),
                                value: json!(now),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: CAMPO_INTERRUZIONE_RICHIESTA.into(),
                                value: json!(""),
                            },
                        ),
                    ])
                })
                .map_err(es)?;
            engine
                .with_projection(|projection| {
                    projection.get(ENTITA_COMUNICAZIONE, id).ok().flatten()
                })
                .ok_or_else(|| "comunicazione non trovata dopo l'avvio dell'invio".to_string())
                .and_then(dto)
        })?;
        self.emetti_stato_comunicazione_locale(&aggiornata);
        let _ = self.rimuovi_cache_comunicazione_se_non_usata(&aggiornata);
        Ok(aggiornata)
    }

    fn comunicazione_fallisce_prima_invio(
        &self,
        id: &str,
        messaggio: &str,
    ) -> AppResult<ComunicazioneDto> {
        let id_owned = id.to_string();
        let messaggio = messaggio.to_string();
        let dispositivo_corrente = self.config().device_id;
        let aggiornata = self.with_communication_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    let corrente = projection
                        .get(ENTITA_COMUNICAZIONE, &id_owned)
                        .map_err(|error| error.to_string())?
                        .filter(|record| !record.deleted)
                        .ok_or_else(|| "comunicazione non trovata".to_string())?;
                    let proprietario_dispositivo = corrente
                        .data
                        .get("proprietario")
                        .and_then(Value::as_object)
                        .map(|value| str_field(value, "dispositivoId"))
                        .unwrap_or_default();
                    if proprietario_dispositivo != dispositivo_corrente {
                        return Err(
                            "soltanto il PC che ha creato la comunicazione può inviarla".into()
                        );
                    }
                    let stato = StatoComunicazione::parse(&str_field(&corrente.data, "stato"))?;
                    if stato != StatoComunicazione::InCoda {
                        return Err("la comunicazione non è più in coda".into());
                    }
                    let now = now_ms();
                    let canale = corrente
                        .data
                        .get("payload")
                        .and_then(Value::as_object)
                        .map(|payload| str_field(payload, "canale"))
                        .unwrap_or_default();
                    let (errore_codice, errore_fase) = if canale == "whatsapp" {
                        classifica_errore_whatsapp(&messaggio)
                    } else {
                        (String::new(), String::new())
                    };
                    Ok(vec![
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "stato".into(),
                                value: json!(StatoComunicazione::Fallito.as_str()),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "ultimo_errore".into(),
                                value: json!(messaggio),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "errore_codice".into(),
                                value: json!(errore_codice),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "errore_fase".into(),
                                value: json!(errore_fase),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "esito_ambiguo".into(),
                                value: json!(false),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "stato_aggiornato_ms".into(),
                                value: json!(now),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: CAMPO_INTERRUZIONE_RICHIESTA.into(),
                                value: json!(""),
                            },
                        ),
                    ])
                })
                .map_err(es)?;
            engine
                .with_projection(|projection| {
                    projection.get(ENTITA_COMUNICAZIONE, id).ok().flatten()
                })
                .ok_or_else(|| "comunicazione non trovata dopo l'errore".to_string())
                .and_then(dto)
        })?;
        self.emetti_stato_comunicazione_locale(&aggiornata);
        let _ = self.rimuovi_cache_comunicazione_se_non_usata(&aggiornata);
        Ok(aggiornata)
    }

    fn comunicazione_conclude_invio(
        &self,
        id: &str,
        stato_finale: StatoComunicazione,
        ricevuta: Option<&RicevutaAdattatore>,
        errore: Option<&ErroreAdattatore>,
    ) -> AppResult<ComunicazioneDto> {
        let id_owned = id.to_string();
        let dispositivo_corrente = self.config().device_id;
        let ricevuta = ricevuta.cloned();
        let errore = errore.cloned();
        let aggiornata = self.with_communication_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    let corrente = projection
                        .get(ENTITA_COMUNICAZIONE, &id_owned)
                        .map_err(|error| error.to_string())?
                        .filter(|record| !record.deleted)
                        .ok_or_else(|| "comunicazione non trovata".to_string())?;
                    let proprietario_dispositivo = corrente
                        .data
                        .get("proprietario")
                        .and_then(Value::as_object)
                        .map(|value| str_field(value, "dispositivoId"))
                        .unwrap_or_default();
                    if proprietario_dispositivo != dispositivo_corrente {
                        return Err(
                            "il PC proprietario della comunicazione è cambiato durante l'invio"
                                .into(),
                        );
                    }
                    let stato = StatoComunicazione::parse(&str_field(&corrente.data, "stato"))?;
                    if stato != StatoComunicazione::InInvio {
                        return Err(
                            "lo stato della comunicazione è cambiato durante l'invio".into()
                        );
                    }
                    let now = now_ms();
                    let ultimo_errore = ricevuta
                        .as_ref()
                        .map(|value| value.avviso.clone())
                        .or_else(|| errore.as_ref().map(|value| value.messaggio.clone()))
                        .unwrap_or_default();
                    let esito_ambiguo = errore
                        .as_ref()
                        .is_some_and(|value| value.classe == ClasseErroreAdattatore::EsitoAmbiguo);
                    let inviata_ms = ricevuta.as_ref().map(|_| now).unwrap_or(0);
                    let riferimento_esterno = ricevuta
                        .as_ref()
                        .map(|value| value.riferimento_esterno.clone())
                        .unwrap_or_default();
                    let copia_posta_inviata = ricevuta
                        .as_ref()
                        .is_some_and(|value| value.copia_posta_inviata);
                    let canale = corrente
                        .data
                        .get("payload")
                        .and_then(Value::as_object)
                        .map(|payload| str_field(payload, "canale"))
                        .unwrap_or_default();
                    let (errore_codice, errore_fase) = if errore.is_some() && canale == "whatsapp" {
                        classifica_errore_whatsapp(&ultimo_errore)
                    } else {
                        (String::new(), String::new())
                    };
                    Ok(vec![
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "stato".into(),
                                value: json!(stato_finale.as_str()),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "ultimo_errore".into(),
                                value: json!(ultimo_errore),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "errore_codice".into(),
                                value: json!(errore_codice),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "errore_fase".into(),
                                value: json!(errore_fase),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "esito_ambiguo".into(),
                                value: json!(esito_ambiguo),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "inviata_ms".into(),
                                value: json!(inviata_ms),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "riferimento_esterno".into(),
                                value: json!(riferimento_esterno),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "copia_posta_inviata".into(),
                                value: json!(copia_posta_inviata),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "stato_aggiornato_ms".into(),
                                value: json!(now),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: CAMPO_INTERRUZIONE_RICHIESTA.into(),
                                value: json!(""),
                            },
                        ),
                    ])
                })
                .map_err(es)?;
            engine
                .with_projection(|projection| {
                    projection.get(ENTITA_COMUNICAZIONE, id).ok().flatten()
                })
                .ok_or_else(|| "comunicazione non trovata dopo l'invio".to_string())
                .and_then(dto)
        })?;
        self.emetti_stato_comunicazione_locale(&aggiornata);
        if aggiornata.stato.positivo() {
            // L'effetto esterno è già riuscito: un eventuale problema di sync
            // dell'indicatore sorgente non deve trasformarlo in un errore né
            // provocare un nuovo invio. Il worker lo riallineerà in seguito.
            let _ = self.riallinea_esito_locale(&aggiornata);
        }
        let _ = self.rimuovi_cache_comunicazione_se_non_usata(&aggiornata);
        Ok(aggiornata)
    }

    fn comunicazione_differisce_per_attivita_utente(
        &self,
        id: &str,
    ) -> AppResult<ComunicazioneDto> {
        let id_owned = id.to_string();
        let dispositivo_corrente = self.config().device_id;
        let aggiornata = self.with_communication_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    let corrente = projection
                        .get(ENTITA_COMUNICAZIONE, &id_owned)
                        .map_err(|error| error.to_string())?
                        .filter(|record| !record.deleted)
                        .ok_or_else(|| "comunicazione non trovata".to_string())?;
                    let proprietario_dispositivo = corrente
                        .data
                        .get("proprietario")
                        .and_then(Value::as_object)
                        .map(|value| str_field(value, "dispositivoId"))
                        .unwrap_or_default();
                    if proprietario_dispositivo != dispositivo_corrente {
                        return Err(
                            "il PC proprietario della comunicazione è cambiato durante l'invio"
                                .into(),
                        );
                    }
                    let stato = StatoComunicazione::parse(&str_field(&corrente.data, "stato"))?;
                    if stato != StatoComunicazione::InInvio {
                        return Err(
                            "lo stato della comunicazione è cambiato durante l'invio".into()
                        );
                    }
                    let richiesta = str_field(&corrente.data, CAMPO_INTERRUZIONE_RICHIESTA);
                    let campagna_id = corrente
                        .data
                        .get("payload")
                        .and_then(Value::as_object)
                        .map(|payload| str_field(payload, "campagna_id"))
                        .unwrap_or_default();
                    let campagna_sospesa = !campagna_id.is_empty()
                        && projection
                            .list(ENTITA_COMUNICAZIONE)
                            .map_err(|error| error.to_string())?
                            .iter()
                            .any(|record| {
                                record.id != id_owned
                                    && str_field(&record.data, "stato")
                                        == StatoComunicazione::Sospeso.as_str()
                                    && record
                                        .data
                                        .get("payload")
                                        .and_then(Value::as_object)
                                        .map(|payload| str_field(payload, "campagna_id"))
                                        .as_deref()
                                        == Some(campagna_id.as_str())
                            });
                    let stato_differito = if richiesta == INTERRUZIONE_ANNULLA {
                        StatoComunicazione::Annullato
                    } else if richiesta == INTERRUZIONE_SOSPENDI || campagna_sospesa {
                        StatoComunicazione::Sospeso
                    } else {
                        StatoComunicazione::InCoda
                    };
                    Ok(vec![
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "stato".into(),
                                value: json!(stato_differito.as_str()),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "ultimo_errore".into(),
                                value: json!(""),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "esito_ambiguo".into(),
                                value: json!(false),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: "stato_aggiornato_ms".into(),
                                value: json!(now_ms()),
                            },
                        ),
                        Mutation::new(
                            ENTITA_COMUNICAZIONE,
                            id_owned.clone(),
                            EventBody::FieldSet {
                                field: CAMPO_INTERRUZIONE_RICHIESTA.into(),
                                value: json!(""),
                            },
                        ),
                    ])
                })
                .map_err(es)?;
            engine
                .with_projection(|projection| {
                    projection.get(ENTITA_COMUNICAZIONE, id).ok().flatten()
                })
                .ok_or_else(|| "comunicazione non trovata dopo il differimento".to_string())
                .and_then(dto)
        })?;
        self.emetti_stato_comunicazione_locale(&aggiornata);
        if !aggiornata.stato.richiede_documento_temporaneo() {
            let _ = self.rimuovi_cache_comunicazione_se_non_usata(&aggiornata);
        }
        Ok(aggiornata)
    }

    fn comunicazione_processa_con_adattatore(
        &self,
        id: &str,
        adapter: &mut impl CommunicationAdapter,
    ) -> AppResult<ComunicazioneDto> {
        let comunicazione = self
            .comunicazioni_lista()?
            .into_iter()
            .find(|comunicazione| comunicazione.id == id)
            .ok_or("comunicazione non trovata")?;
        if comunicazione.proprietario_dispositivo_id != self.config().device_id {
            return Err("questa comunicazione appartiene a un altro PC".into());
        }
        if comunicazione.stato != StatoComunicazione::InCoda {
            return Err("la comunicazione non è in coda".into());
        }
        if let Err(errore) = adapter.verifica_configurazione() {
            if errore.classe == ClasseErroreAdattatore::AttivitaUtente {
                return Ok(comunicazione);
            }
            return self.comunicazione_fallisce_prima_invio(id, &errore.messaggio);
        }
        let in_invio = self.comunicazione_inizia_invio(id)?;
        let esito = adapter.invia(&in_invio);
        let interruzione_richiesta = self.comunicazione_interruzione_richiesta(id);
        match esito {
            Ok(ricevuta) => {
                let stato = if ricevuta.consegna_verificata {
                    StatoComunicazione::ConsegnaVerificata
                } else {
                    StatoComunicazione::InvioAzionato
                };
                self.comunicazione_conclude_invio(id, stato, Some(&ricevuta), None)
            }
            Err(errore)
                if interruzione_richiesta.is_some()
                    && errore.classe != ClasseErroreAdattatore::EsitoAmbiguo =>
            {
                self.comunicazione_differisce_per_attivita_utente(id)
            }
            Err(errore) if errore.classe == ClasseErroreAdattatore::AttivitaUtente => {
                self.comunicazione_differisce_per_attivita_utente(id)
            }
            Err(errore) => self.comunicazione_conclude_invio(
                id,
                StatoComunicazione::Fallito,
                None,
                Some(&errore),
            ),
        }
    }

    /// Esegue una singola e-mail già in coda. Prima riallinea i dati aziendali
    /// condivisi usati per la validazione, poi registra tentativo ed esito
    /// esclusivamente nella cronologia locale.
    /// Un errore dopo l'avvio SMTP è conservato come ambiguo e non viene ritentato.
    pub fn comunicazione_email_invia(&self, id: &str) -> AppResult<ComunicazioneDto> {
        crate::premium::ensure_access(self)?;
        let _invio_locale = self.communication_send_local.try_lock().map_err(|_| {
            "questo PC sta già inviando un'altra comunicazione; attendi il suo esito".to_string()
        })?;
        let _attivita = self.begin_runtime_activity()?;
        self.force_sync()?;
        let mut adapter = EmailCommunicationAdapter { state: self };
        let result = self.comunicazione_processa_con_adattatore(id, &mut adapter);
        self.gestisci_eventuale_errore_invio(&result);
        result
    }

    fn nome_destinatario_comunicazione(
        &self,
        comunicazione: &ComunicazioneDto,
    ) -> AppResult<String> {
        if comunicazione.destinatario_entita == DESTINATARIO_DIAGNOSTICA_WHATSAPP {
            return Ok(comunicazione.destinatario_id.clone());
        }
        self.with_engine(|engine| {
            let record = engine
                .with_projection(|projection| {
                    projection
                        .get(
                            &comunicazione.destinatario_entita,
                            &comunicazione.destinatario_id,
                        )
                        .ok()
                        .flatten()
                })
                .filter(|record| !record.deleted)
                .ok_or("destinatario della comunicazione non trovato")?;
            for campo in ["ragione_sociale", "denominazione", "nome_completo"] {
                let valore = str_field(&record.data, campo);
                if !valore.trim().is_empty() {
                    return Ok(valore);
                }
            }
            let nome = str_field(&record.data, "nome");
            let cognome = str_field(&record.data, "cognome");
            let completo = format!("{} {}", nome.trim(), cognome.trim())
                .trim()
                .to_string();
            if completo.is_empty() {
                Err("nome del destinatario non disponibile per la verifica WhatsApp".into())
            } else {
                Ok(completo)
            }
        })
    }

    fn recapito_destinatario_aggiornato(
        &self,
        destinatario_entita: &str,
        destinatario_id: &str,
        canale: CanaleComunicazione,
        recapito_attuale: &str,
    ) -> Result<String, String> {
        if destinatario_entita == DESTINATARIO_DIAGNOSTICA_WHATSAPP {
            return Ok(recapito_attuale.to_string());
        }
        let record = self
            .with_engine(|engine| {
                engine
                    .with_projection(|projection| {
                        projection
                            .get(destinatario_entita, destinatario_id)
                            .ok()
                            .flatten()
                    })
                    .filter(|record| !record.deleted)
                    .ok_or_else(|| "destinatario non trovato o eliminato".to_string())
            })
            .map_err(|e| e.to_string())?;

        match canale {
            CanaleComunicazione::Whatsapp => {
                let tel = str_field(&record.data, "telefono");
                if tel.trim().is_empty() {
                    if !recapito_attuale.trim().is_empty() {
                        return Ok(recapito_attuale.to_string());
                    }
                    return Err("numero di telefono mancante in anagrafica".to_string());
                }
                normalizza_telefono(&tel).map_err(|_| {
                    "numero di telefono in anagrafica non valido per WhatsApp".to_string()
                })
            }
            CanaleComunicazione::Email => {
                let email = str_field(&record.data, "email");
                if email.trim().is_empty() {
                    if !recapito_attuale.trim().is_empty() {
                        return Ok(recapito_attuale.to_string());
                    }
                    return Err("indirizzo email mancante in anagrafica".to_string());
                }
                normalizza_email(&email)
                    .map_err(|_| "indirizzo email in anagrafica non valido".to_string())
            }
        }
    }

    fn gestisci_eventuale_errore_invio(&self, result: &AppResult<ComunicazioneDto>) {
        let Ok(comunicazione) = result else {
            return;
        };
        if comunicazione.stato != StatoComunicazione::Fallito {
            return;
        }
        self.emetti_errore_invio(comunicazione);
    }

    /// Esegue un singolo WhatsApp già in coda. Il protocollo apre la
    /// conversazione e Windows UI Automation preme Invia soltanto dopo aver
    /// verificato intestazione, destinatario e testo.
    fn comunicazione_whatsapp_invia_con_autorizzazione(
        &self,
        id: &str,
        autorizzazione_input: Option<u32>,
        riprova_fallito: bool,
    ) -> AppResult<ComunicazioneDto> {
        crate::premium::ensure_access(self)?;
        let _invio_locale = self.communication_send_local.try_lock().map_err(|_| {
            "questo PC sta già inviando un'altra comunicazione; attendi il suo esito".to_string()
        })?;
        let _attivita = self.begin_runtime_activity()?;
        self.force_sync()?;
        let mut comunicazione = self
            .comunicazioni_lista()?
            .into_iter()
            .find(|comunicazione| comunicazione.id == id)
            .ok_or("comunicazione non trovata")?;
        if comunicazione.canale != CanaleComunicazione::Whatsapp {
            return Err("la comunicazione selezionata non è WhatsApp".into());
        }
        if riprova_fallito && comunicazione.stato == StatoComunicazione::Fallito {
            comunicazione =
                self.comunicazione_cambia_stato(id, StatoComunicazione::InCoda, true)?;
        }
        self.rilascia_comunicazione_trattenuta_all_avvio(id);
        let destinatario = match self.nome_destinatario_comunicazione(&comunicazione) {
            Ok(destinatario) => destinatario,
            Err(messaggio) => {
                let result = self.comunicazione_fallisce_prima_invio(id, &messaggio);
                self.gestisci_eventuale_errore_invio(&result);
                return result;
            }
        };
        let mut adapter = WhatsappCommunicationAdapter {
            state: self,
            destinatario: &destinatario,
            autorizzazione_input,
        };
        let result = self.comunicazione_processa_con_adattatore(id, &mut adapter);
        self.gestisci_eventuale_errore_invio(&result);
        result
    }

    pub fn comunicazione_whatsapp_invia(&self, id: &str) -> AppResult<ComunicazioneDto> {
        self.comunicazione_whatsapp_invia_con_autorizzazione(id, None, false)
    }

    /// Ripresa esplicita dalla notifica. Il click che ha richiesto la ripresa è
    /// autorizzato una sola volta; qualsiasi input successivo dell'operatore
    /// interrompe comunque l'automazione prima del click su Invia.
    pub fn comunicazione_whatsapp_riprendi(&self, id: &str) -> AppResult<ComunicazioneDto> {
        #[cfg(target_os = "windows")]
        let autorizzazione_input = crate::app::whatsapp_windows::marcatore_input_utente();
        #[cfg(not(target_os = "windows"))]
        let autorizzazione_input = None;
        self.comunicazione_whatsapp_invia_con_autorizzazione(id, autorizzazione_input, true)
    }

    #[cfg(target_os = "windows")]
    pub fn whatsapp_diagnostica_get(
        &self,
    ) -> AppResult<crate::app::whatsapp_windows::WhatsappDiagnosticaDto> {
        crate::premium::ensure_access(self)?;
        self.completa_diagnostica_whatsapp(crate::app::whatsapp_windows::diagnostica_get())
    }

    #[cfg(target_os = "windows")]
    pub fn whatsapp_stato_get(
        &self,
    ) -> AppResult<crate::app::whatsapp_windows::WhatsappDiagnosticaDto> {
        crate::premium::ensure_access(self)?;
        self.completa_diagnostica_whatsapp(crate::app::whatsapp_windows::diagnostica_rapida_get())
    }

    #[cfg(target_os = "windows")]
    fn completa_diagnostica_whatsapp(
        &self,
        mut diagnostica: crate::app::whatsapp_windows::WhatsappDiagnosticaDto,
    ) -> AppResult<crate::app::whatsapp_windows::WhatsappDiagnosticaDto> {
        if diagnostica.ultimo_esito.is_none() {
            if let Some(collaudo) = self
                .comunicazioni_lista()?
                .into_iter()
                .filter(|item| {
                    item.canale == CanaleComunicazione::Whatsapp
                        && item.destinatario_entita == DESTINATARIO_DIAGNOSTICA_WHATSAPP
                        && item.stato != StatoComunicazione::Annullato
                })
                .max_by_key(|item| item.stato_aggiornato_ms)
            {
                let riuscito = collaudo.stato.positivo();
                diagnostica.ultimo_esito =
                    Some(crate::app::whatsapp_windows::WhatsappUltimoEsitoDto {
                        riuscito,
                        codice: if riuscito {
                            "collaudo_completato".into()
                        } else if collaudo.errore_codice.is_empty() {
                            "collaudo_non_completato".into()
                        } else {
                            collaudo.errore_codice
                        },
                        fase: if riuscito {
                            "collaudo".into()
                        } else if collaudo.errore_fase.is_empty() {
                            "verifica_finale".into()
                        } else {
                            collaudo.errore_fase
                        },
                        messaggio: collaudo.ultimo_errore,
                        esito_ambiguo: collaudo.esito_ambiguo,
                        attivita_utente: false,
                        durata_ms: 0,
                        avvenuto_ms: collaudo.stato_aggiornato_ms,
                    });
            }
        }
        Ok(diagnostica)
    }

    #[cfg(target_os = "windows")]
    fn processa_elemento_collaudo_whatsapp(
        &self,
        id: &str,
        destinatario: &str,
    ) -> AppResult<ComunicazioneDto> {
        let scadenza = Instant::now() + Duration::from_secs(4);
        loop {
            let mut adapter = WhatsappCommunicationAdapter {
                state: self,
                destinatario,
                autorizzazione_input: crate::app::whatsapp_windows::marcatore_input_utente(),
            };
            let esito = self.comunicazione_processa_con_adattatore(id, &mut adapter)?;
            if esito.stato != StatoComunicazione::InCoda {
                return Ok(esito);
            }
            if Instant::now() >= scadenza {
                return self.comunicazione_fallisce_prima_invio(
                    id,
                    "PC in uso durante il collaudo WhatsApp: riprova senza usare mouse o tastiera per alcuni secondi.",
                );
            }
            // Nessuna pausa nel percorso riuscito. Solo dopo un differimento di
            // sicurezza aspettiamo in modo adattivo la quiete richiesta dal
            // driver, conservando la stessa bozza e la stessa intenzione.
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    #[cfg(target_os = "windows")]
    pub fn whatsapp_verifica_e_invia_prova(
        &self,
        input: WhatsappVerificaInput,
    ) -> AppResult<WhatsappVerificaProvaDto> {
        let collaudo_iniziato = Instant::now();
        crate::premium::ensure_access(self)?;
        let nome = input.nome.trim().to_string();
        if nome.is_empty() || nome.chars().count() > 160 || nome.chars().any(char::is_control) {
            return Err("inserisci il nome del destinatario di collaudo".into());
        }
        let telefono = normalizza_telefono(&input.telefono)?;
        let _invio_locale = self.communication_send_local.try_lock().map_err(|_| {
            "questo PC sta già inviando un'altra comunicazione; attendi il suo esito".to_string()
        })?;
        let _ripristino_visibilita =
            crate::app::whatsapp_windows::RipristinoVisibilitaDopoCollaudo::cattura();
        let _attivita = self.begin_runtime_activity()?;
        self.force_sync()?;

        // Un arresto o una versione precedente del collaudo può aver lasciato
        // una prova diagnostica in sospeso o fallita. Annulliamo le precedenti prove
        // non riuscite e azzeriamo l'ultimo esito così che il nuovo collaudo parta pulito.
        let diagnostiche_precedenti = self
            .comunicazioni_lista()?
            .into_iter()
            .filter(|item| {
                item.destinatario_entita == DESTINATARIO_DIAGNOSTICA_WHATSAPP
                    && !item.stato.positivo()
            })
            .map(|item| item.id)
            .collect::<Vec<_>>();
        for id in diagnostiche_precedenti {
            // Nessuna minimizzazione asincrona qui: potrebbe arrivare mentre
            // il nuovo collaudo ha già riaperto WhatsApp.
            let _ = self.comunicazione_cambia_stato(&id, StatoComunicazione::Annullato, false);
        }
        crate::app::whatsapp_windows::resetta_ultimo_esito();

        let sessione = ulid::Ulid::generate().to_string();
        let crea = |suffisso: &str,
                    corpo: &str,
                    allegati: Vec<AllegatoComunicazioneInput>|
         -> AppResult<ComunicazioneDto> {
            self.comunicazione_crea_bozza(ComunicazioneCreaInput {
                idempotency_key: format!("collaudo-whatsapp:{sessione}:{suffisso}"),
                destinatario_entita: DESTINATARIO_DIAGNOSTICA_WHATSAPP.into(),
                destinatario_id: nome.clone(),
                canale: CanaleComunicazione::Whatsapp,
                recapito: telefono.clone(),
                oggetto: String::new(),
                corpo: corpo.into(),
                modello_id: String::new(),
                modello_versione_id: String::new(),
                modello_versione: 0,
                origine_entita: String::new(),
                origine_id: String::new(),
                origine_revision: String::new(),
                origine_fingerprint: String::new(),
                origini_correlate: Vec::new(),
                origine_snapshot: Value::Null,
                tipo_modello: String::new(),
                campagna_id: format!("collaudo-whatsapp:{sessione}"),
                reinvio_di: String::new(),
                allegati,
            })
        };

        let testo = crea(
            "testo",
            "Collaudo WhatsApp PharmaTek — messaggio di verifica automatica.",
            Vec::new(),
        )?;
        self.comunicazione_metti_in_coda(&testo.id)?;
        let destinatario = nome.clone();
        let testo = self.processa_elemento_collaudo_whatsapp(&testo.id, &destinatario)?;
        if !testo.stato.positivo() {
            let fase = if testo.errore_fase.is_empty() {
                "sicurezza"
            } else {
                &testo.errore_fase
            };
            let messaggio = if testo.ultimo_errore.is_empty() {
                "l'invio è stato differito prima del click su Invia"
            } else {
                &testo.ultimo_errore
            };
            return Err(format!(
                "collaudo WhatsApp fallito nella fase {}: {}",
                fase, messaggio
            ));
        }

        std::thread::sleep(Duration::from_millis(650));
        let allegato_cache = self.documento_cache_salva(DocumentoCacheSalvaInput {
            nome: "collaudo-whatsapp-pharmatek.pdf".into(),
            mime: "application/pdf".into(),
            dati: pdf_diagnostico_whatsapp(),
        })?;
        let allegato = match crea(
            "allegato",
            "Collaudo WhatsApp PharmaTek — verifica allegato PDF.",
            vec![allegato_cache.clone()],
        ) {
            Ok(comunicazione) => comunicazione,
            Err(error) => {
                let _ = self.documenti_cache_rilascia(&[allegato_cache]);
                return Err(error);
            }
        };
        self.comunicazione_metti_in_coda(&allegato.id)?;
        let _ = self.documenti_cache_rilascia(&[allegato_cache]);
        let allegato = self.processa_elemento_collaudo_whatsapp(&allegato.id, &destinatario)?;
        if !allegato.stato.positivo() {
            let fase = if allegato.errore_fase.is_empty() {
                "sicurezza"
            } else {
                &allegato.errore_fase
            };
            let messaggio = if allegato.ultimo_errore.is_empty() {
                "l'invio è stato differito prima del click su Invia"
            } else {
                &allegato.ultimo_errore
            };
            return Err(format!(
                "collaudo WhatsApp fallito nella fase {}: {}",
                fase, messaggio
            ));
        }
        crate::app::whatsapp_windows::registra_collaudo_completato(collaudo_iniziato.elapsed());
        Ok(WhatsappVerificaProvaDto {
            testo,
            allegato,
            diagnostica: crate::app::whatsapp_windows::diagnostica_get(),
        })
    }

    /// Crea una nuova intenzione collegata. Vale sia dopo la verifica di un
    /// esito ambiguo, sia per ripetere volontariamente una comunicazione già
    /// inviata. Il record originale resta immutato nello storico.
    fn crea_reinvio_collegato(&self, originale: ComunicazioneDto) -> AppResult<ComunicazioneDto> {
        for allegato in &originale.allegati {
            self.documento_cache_leggi(allegato).map_err(|_| {
                if originale.origine_entita == "preventivo" {
                    "il documento temporaneo è già stato eliminato: riapri il preventivo e usa «Invia» per rigenerarlo"
                        .to_string()
                } else {
                    "il documento temporaneo del messaggio non è più disponibile".to_string()
                }
            })?;
        }
        let id_originale = originale.id.clone();
        let recapito = self
            .recapito_destinatario_aggiornato(
                &originale.destinatario_entita,
                &originale.destinatario_id,
                originale.canale,
                &originale.recapito,
            )
            .unwrap_or(originale.recapito);
        let nuova = self.comunicazione_crea_bozza(ComunicazioneCreaInput {
            idempotency_key: format!("reinvio:{id_originale}:{}", ulid::Ulid::generate()),
            destinatario_entita: originale.destinatario_entita,
            destinatario_id: originale.destinatario_id,
            canale: originale.canale,
            recapito,
            oggetto: originale.oggetto,
            corpo: originale.corpo,
            modello_id: originale.modello_id,
            modello_versione_id: originale.modello_versione_id,
            modello_versione: originale.modello_versione,
            origine_entita: originale.origine_entita,
            origine_id: originale.origine_id,
            origine_revision: String::new(),
            origine_fingerprint: originale.origine_fingerprint,
            origini_correlate: originale.origini_correlate,
            origine_snapshot: Value::Null,
            tipo_modello: originale.tipo_modello,
            campagna_id: originale.campagna_id,
            reinvio_di: id_originale,
            allegati: originale.allegati,
        })?;
        self.comunicazione_metti_in_coda(&nuova.id)
    }

    pub fn comunicazione_reinvia(&self, id: &str) -> AppResult<ComunicazioneDto> {
        crate::premium::ensure_access(self)?;
        self.force_sync()?;
        let originale = self
            .comunicazioni_lista()?
            .into_iter()
            .find(|comunicazione| comunicazione.id == id)
            .ok_or("comunicazione originale non trovata")?;
        let reinviabile = (originale.stato == StatoComunicazione::Fallito
            && originale.esito_ambiguo)
            || matches!(
                originale.stato,
                StatoComunicazione::InvioAzionato | StatoComunicazione::ConsegnaVerificata
            );
        if !reinviabile {
            return Err("la comunicazione selezionata non può essere inviata di nuovo".into());
        }
        self.crea_reinvio_collegato(originale)
    }

    /// Crea nuovi invii intenzionali per una selezione di comunicazioni
    /// terminali. Le originali restano immutate e ogni nuova voce conserva il
    /// collegamento `reinvio_di`, quindi il tracking non viene confuso.
    pub fn comunicazioni_reinvia(&self, ids: &[String]) -> AppResult<Vec<ComunicazioneDto>> {
        crate::premium::ensure_access(self)?;
        self.force_sync()?;
        let mut viste = std::collections::HashSet::new();
        let ids = ids
            .iter()
            .map(|id| id.trim())
            .filter(|id| !id.is_empty() && viste.insert((*id).to_string()))
            .collect::<Vec<_>>();
        if ids.is_empty() {
            return Err("nessuna comunicazione selezionata".into());
        }
        let mut per_id = self
            .comunicazioni_lista()?
            .into_iter()
            .map(|comunicazione| (comunicazione.id.clone(), comunicazione))
            .collect::<std::collections::HashMap<_, _>>();
        let mut originali = Vec::with_capacity(ids.len());
        for id in ids {
            let originale = per_id
                .remove(id)
                .ok_or_else(|| format!("comunicazione {id} non trovata"))?;
            if !matches!(
                originale.stato,
                StatoComunicazione::InvioAzionato
                    | StatoComunicazione::ConsegnaVerificata
                    | StatoComunicazione::Fallito
                    | StatoComunicazione::Annullato
            ) {
                return Err(
                    "soltanto comunicazioni concluse possono essere inviate di nuovo".into(),
                );
            }
            originali.push(originale);
        }

        originali
            .into_iter()
            .map(|originale| self.crea_reinvio_collegato(originale))
            .collect()
    }

    /// Chiude in modo prudente gli invii rimasti a metà dopo una terminazione
    /// del processo. Non li rimette mai in coda automaticamente: l'effetto
    /// esterno potrebbe essere già avvenuto e va verificato prima di un reinvio.
    pub(crate) fn comunicazioni_recupera_invii_interrotti(&self) -> AppResult<usize> {
        let dispositivo = self.config().device_id;
        let comunicazioni = match self.comunicazioni_lista() {
            Ok(comunicazioni) => comunicazioni,
            Err(error) => {
                // La privacy della cache non dipende dalla licenza o dallo
                // stato dell'onboarding: prova comunque a togliere gli orfani.
                let _ = self.pulisci_cache_documenti_non_usata();
                return Err(error);
            }
        };
        let interrotte = comunicazioni
            .into_iter()
            .filter(|comunicazione| {
                comunicazione.stato == StatoComunicazione::InInvio
                    && comunicazione.proprietario_dispositivo_id == dispositivo
            })
            .collect::<Vec<_>>();
        let mut recuperate = 0;
        for comunicazione in interrotte {
            let errore = ErroreAdattatore {
                classe: ClasseErroreAdattatore::EsitoAmbiguo,
                messaggio: "Il programma si è chiuso durante l'invio: verifica il destinatario prima di creare un reinvio.".into(),
            };
            let result = self.comunicazione_conclude_invio(
                &comunicazione.id,
                StatoComunicazione::Fallito,
                None,
                Some(&errore),
            );
            self.gestisci_eventuale_errore_invio(&result);
            result?;
            recuperate += 1;
        }
        // Le lease di generazione vivono soltanto nel processo. Al riavvio
        // qualsiasi PDF/PNG che non appartiene a un invio attivo è un residuo.
        let _ = self.pulisci_cache_documenti_non_usata();
        Ok(recuperate)
    }

    /// Riprende al massimo un elemento della coda di questo PC. E-mail e
    /// WhatsApp condividono lo stesso ordine, così un batch resta strettamente
    /// sequenziale e non può produrre due effetti esterni insieme.
    pub(crate) fn comunicazione_processa_prossima(&self) -> AppResult<Option<ComunicazioneDto>> {
        // Se l'effetto esterno era già riuscito ma l'indicatore compatto
        // dell'entità sorgente non era stato aggiornato, completa soltanto quel
        // riallineamento senza pubblicare lo storico e senza ripetere l'invio.
        let _ = self.riallinea_esiti_locali_in_attesa();
        let dispositivo = self.config().device_id;
        let Some(trattenute_all_avvio) = self
            .communication_startup_held
            .lock()
            .expect("communication startup gate poisoned")
            .clone()
        else {
            // Fail closed: finché la fotografia iniziale non è disponibile il
            // worker non può produrre alcun effetto esterno.
            return Ok(None);
        };
        let in_coda: Vec<_> = self
            .comunicazioni_lista()?
            .into_iter()
            .filter(|comunicazione| {
                comunicazione.stato == StatoComunicazione::InCoda
                    && comunicazione.proprietario_dispositivo_id == dispositivo
                    && !trattenute_all_avvio.contains(&comunicazione.id)
            })
            .collect();

        #[cfg(all(target_os = "windows", not(test)))]
        let whatsapp_pronto = crate::app::whatsapp_windows::pc_pronto_per_whatsapp();
        #[cfg(any(not(target_os = "windows"), test))]
        let whatsapp_pronto = true;

        // Se WhatsApp è pronto, rispettiamo l'ordine cronologico (FIFO).
        // Se il PC è in uso, WhatsApp viene temporaneamente scavalcato dalle e-mail pronte,
        // così le e-mail partono subito in background senza attendere la quiete dell'operatore.
        let prossima = in_coda
            .iter()
            .filter(|c| c.canale != CanaleComunicazione::Whatsapp || whatsapp_pronto)
            .min_by_key(|c| c.creata_ms)
            .cloned();

        #[cfg(all(target_os = "windows", not(test)))]
        let mut era_whatsapp = prossima
            .as_ref()
            .is_some_and(|comunicazione| comunicazione.canale == CanaleComunicazione::Whatsapp);

        let mut risultato = prossima
            .map(|comunicazione| match comunicazione.canale {
                CanaleComunicazione::Email => self.comunicazione_email_invia(&comunicazione.id),
                CanaleComunicazione::Whatsapp => {
                    self.comunicazione_whatsapp_invia(&comunicazione.id)
                }
            })
            .transpose();

        // Se WhatsApp è stato differito (rimasto in InCoda per attività operatore)
        // ma ci sono e-mail pronte in coda, inviamo subito la prima e-mail invece di fermare il worker.
        if risultato
            .as_ref()
            .ok()
            .and_then(|c| c.as_ref())
            .is_some_and(|item| item.stato == StatoComunicazione::InCoda)
        {
            if let Some(email) = in_coda
                .iter()
                .filter(|c| c.canale == CanaleComunicazione::Email)
                .min_by_key(|c| c.creata_ms)
            {
                #[cfg(all(target_os = "windows", not(test)))]
                {
                    era_whatsapp = false;
                }
                risultato = self.comunicazione_email_invia(&email.id).map(Some);
            }
        }

        #[cfg(all(target_os = "windows", not(test)))]
        if era_whatsapp
            && risultato
                .as_ref()
                .ok()
                .and_then(|comunicazione| comunicazione.as_ref())
                .is_some_and(|comunicazione| comunicazione.stato.positivo())
        {
            let dispositivo = self.config().device_id;
            let altri_whatsapp_in_coda = self
                .comunicazioni_lista()
                .map(|comunicazioni| {
                    comunicazioni.into_iter().any(|comunicazione| {
                        comunicazione.stato == StatoComunicazione::InCoda
                            && comunicazione.canale == CanaleComunicazione::Whatsapp
                            && comunicazione.proprietario_dispositivo_id == dispositivo
                    })
                })
                .unwrap_or(true);
            if !altri_whatsapp_in_coda {
                // Mai nascondere WhatsApp in caso di errore o di esito
                // ambiguo: la finestra resta visibile per la verifica manuale.
                // Dopo un successo lasciamo inoltre due secondi per vedere il
                // messaggio appena inviato. Il controllo finale evita di
                // minimizzare se nel frattempo è entrato un nuovo WhatsApp.
                std::thread::sleep(Duration::from_secs(2));
                self.minimizza_whatsapp_se_inattivo();
            }
        }

        risultato.map(|comunicazione| {
            if comunicazione
                .as_ref()
                .is_some_and(|item| item.stato == StatoComunicazione::InCoda)
            {
                None
            } else {
                comunicazione
            }
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClasseErroreAdattatore {
    Configurazione,
    AttivitaUtente,
    InvioNonAzionato,
    EsitoAmbiguo,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ErroreAdattatore {
    classe: ClasseErroreAdattatore,
    messaggio: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RicevutaAdattatore {
    invio_azionato: bool,
    consegna_verificata: bool,
    riferimento_esterno: String,
    copia_posta_inviata: bool,
    avviso: String,
}

trait CommunicationAdapter {
    fn verifica_configurazione(&self) -> Result<(), ErroreAdattatore>;
    fn invia(
        &mut self,
        comunicazione: &ComunicazioneDto,
    ) -> Result<RicevutaAdattatore, ErroreAdattatore>;
}

struct EmailCommunicationAdapter<'a> {
    state: &'a AppState,
}

impl CommunicationAdapter for EmailCommunicationAdapter<'_> {
    fn verifica_configurazione(&self) -> Result<(), ErroreAdattatore> {
        self.state
            .verifica_email_operativa()
            .map_err(|messaggio| ErroreAdattatore {
                classe: ClasseErroreAdattatore::Configurazione,
                messaggio,
            })
    }

    fn invia(
        &mut self,
        comunicazione: &ComunicazioneDto,
    ) -> Result<RicevutaAdattatore, ErroreAdattatore> {
        self.state
            .invia_email_operativa(comunicazione)
            .map(|ricevuta| RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: comunicazione.id.clone(),
                copia_posta_inviata: ricevuta.copia_posta_inviata,
                avviso: ricevuta.avviso,
            })
            .map_err(|messaggio| ErroreAdattatore {
                // Una volta chiamato SMTP, anche un timeout può nascondere
                // un'accettazione già avvenuta: niente retry automatico.
                classe: ClasseErroreAdattatore::EsitoAmbiguo,
                messaggio,
            })
    }
}

struct WhatsappCommunicationAdapter<'a> {
    state: &'a AppState,
    destinatario: &'a str,
    autorizzazione_input: Option<u32>,
}

impl CommunicationAdapter for WhatsappCommunicationAdapter<'_> {
    fn verifica_configurazione(&self) -> Result<(), ErroreAdattatore> {
        #[cfg(target_os = "windows")]
        {
            if crate::app::whatsapp_windows::pc_pronto_per_whatsapp_con_autorizzazione(
                self.autorizzazione_input,
            ) {
                Ok(())
            } else {
                Err(ErroreAdattatore {
                    classe: ClasseErroreAdattatore::AttivitaUtente,
                    messaggio: "PC in uso: invio WhatsApp differito".into(),
                })
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::Configurazione,
                messaggio: "l'invio automatico WhatsApp è disponibile su Windows".into(),
            })
        }
    }

    fn invia(
        &mut self,
        comunicazione: &ComunicazioneDto,
    ) -> Result<RicevutaAdattatore, ErroreAdattatore> {
        let iniziato = Instant::now();
        if !allegati_whatsapp_supportati(&comunicazione.allegati) {
            return Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::InvioNonAzionato,
                messaggio: "WhatsApp accetta un PDF oppure un’immagine seguita dal relativo PDF"
                    .into(),
            });
        }
        let allegati = comunicazione
            .allegati
            .iter()
            .map(|allegato| self.state.documento_cache_percorso_invio(allegato))
            .collect::<AppResult<Vec<_>>>()
            .map_err(|messaggio| ErroreAdattatore {
                classe: ClasseErroreAdattatore::InvioNonAzionato,
                messaggio,
            })?;
        // Il marcatore e specifico dell'invio. Se un tentativo e stato
        // differito per una falsa attivita utente, il retry riconosce la bozza
        // gia aperta e non richiama il protocollo (che altrimenti accoderebbe
        // un altro puntino a ogni giro).
        let marcatore_apertura =
            crate::app::whatsapp_windows::marcatore_apertura(&comunicazione.id);
        let url = url_whatsapp_con_testo(&comunicazione.recapito, &marcatore_apertura);
        if self.state.comunicazione_interrotta(&comunicazione.id) {
            return Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::InvioNonAzionato,
                messaggio: "Invio WhatsApp annullato.".into(),
            });
        }
        let bozza_gia_preparata =
            crate::app::whatsapp_windows::bozza_contiene_marcatore(&comunicazione.corpo);
        if !bozza_gia_preparata
            && !crate::app::whatsapp_windows::bozza_contiene_marcatore(&marcatore_apertura)
        {
            crate::platform::apri_url_sistema(&url).map_err(|_| {
                let messaggio =
                    "WhatsApp non si è aperto: verifica che l'app Windows sia installata";
                crate::app::whatsapp_windows::registra_errore_esterno(
                    "protocollo_non_disponibile",
                    "protocollo",
                    messaggio,
                    iniziato.elapsed(),
                );
                ErroreAdattatore {
                    classe: ClasseErroreAdattatore::InvioNonAzionato,
                    messaggio: messaggio.into(),
                }
            })?;
        }

        #[cfg(target_os = "windows")]
        if allegati.is_empty() {
            crate::app::whatsapp_windows::aziona_invio(
                &comunicazione.recapito,
                self.destinatario,
                &comunicazione.corpo,
                &marcatore_apertura,
                self.autorizzazione_input,
                || self.state.comunicazione_interrotta(&comunicazione.id),
            )
            .map_err(|error| ErroreAdattatore {
                classe: if error.attivita_utente {
                    ClasseErroreAdattatore::AttivitaUtente
                } else if error.esito_ambiguo {
                    ClasseErroreAdattatore::EsitoAmbiguo
                } else {
                    ClasseErroreAdattatore::InvioNonAzionato
                },
                messaggio: error.messaggio,
            })?;
        } else {
            let destinazione_whatsapp =
                crate::app::whatsapp_windows::prepara_invio_allegato_con_didascalia(
                    &comunicazione.recapito,
                    self.destinatario,
                    &comunicazione.corpo,
                    &marcatore_apertura,
                    self.autorizzazione_input,
                    || self.state.comunicazione_interrotta(&comunicazione.id),
                )
                .map_err(|error| ErroreAdattatore {
                    classe: if error.attivita_utente {
                        ClasseErroreAdattatore::AttivitaUtente
                    } else if error.esito_ambiguo {
                        ClasseErroreAdattatore::EsitoAmbiguo
                    } else {
                        ClasseErroreAdattatore::InvioNonAzionato
                    },
                    messaggio: error.messaggio,
                })?;

            for (indice, path) in allegati.iter().enumerate() {
                if indice > 0 {
                    // Dopo il primo allegato WebView2 conserva per un istante
                    // nodi UIA ormai rimossi. Riaprire la stessa chat senza
                    // testo costa pochi millisecondi e materializza subito il
                    // compositore pulito per il PDF extra.
                    crate::platform::apri_url_sistema(&url_whatsapp(&comunicazione.recapito))
                        .map_err(|_| ErroreAdattatore {
                            classe: ClasseErroreAdattatore::EsitoAmbiguo,
                            messaggio: "Immagine e didascalia WhatsApp inviate; non è stato possibile riaprire la chat per il PDF extra."
                                .into(),
                        })?;
                    std::thread::sleep(Duration::from_millis(250));
                }
                let autorizzazione_allegato =
                    crate::app::whatsapp_windows::marcatore_input_utente();
                crate::app::whatsapp_windows::aziona_invio_allegato(
                    path,
                    &destinazione_whatsapp,
                    (indice == 0).then_some(comunicazione.corpo.as_str()),
                    autorizzazione_allegato,
                    || self.state.comunicazione_interrotta(&comunicazione.id),
                )
                .map_err(|mut error| {
                    if indice > 0 {
                        // La prima parte è già partita: un retry automatico
                        // duplicherebbe immagine e didascalia.
                        error.esito_ambiguo = true;
                    }
                    let classe = if error.attivita_utente && indice == 0 {
                        ClasseErroreAdattatore::AttivitaUtente
                    } else if error.esito_ambiguo {
                        ClasseErroreAdattatore::EsitoAmbiguo
                    } else {
                        ClasseErroreAdattatore::InvioNonAzionato
                    };
                    ErroreAdattatore {
                        classe,
                        messaggio: if indice > 0 {
                            format!(
                                "Immagine e didascalia WhatsApp inviate; PDF extra da verificare: {}",
                                error.messaggio
                            )
                        } else {
                            error.messaggio
                        },
                    }
                })?;
            }
        }

        Ok(RicevutaAdattatore {
            invio_azionato: true,
            consegna_verificata: false,
            riferimento_esterno: format!("whatsapp-windows:{}", now_ms()),
            copia_posta_inviata: false,
            avviso: String::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::FinishOnboarding;
    use std::fs;
    use ulid::Ulid;

    #[test]
    fn pdf_diagnostico_whatsapp_e_autocontenuto() {
        let pdf = pdf_diagnostico_whatsapp();
        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(pdf
            .windows(b"Collaudo WhatsApp PharmaTek".len())
            .any(|finestra| { finestra == b"Collaudo WhatsApp PharmaTek" }));
        assert!(pdf.ends_with(b"%%EOF\n"));
        assert!(pdf.len() < 4_096);
    }

    struct MockCommunicationAdapter {
        esito: Result<RicevutaAdattatore, ErroreAdattatore>,
        invocazioni: usize,
    }

    struct SospendiDuranteSuccessoAdapter<'a> {
        state: &'a AppState,
        campagna_id: &'a str,
    }

    fn allegato_test(mime: &str) -> AllegatoComunicazioneInput {
        AllegatoComunicazioneInput {
            nome: "preventivo".into(),
            mime: mime.into(),
            dimensione: 128,
            riferimento:
                "pt-cache://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf"
                    .into(),
            sha256: "a".repeat(64),
        }
    }

    #[test]
    fn cache_accetta_excel_e_zip_con_firma_zip() {
        assert_eq!(
            estensione_documento_cache(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                b"PK\x03\x04xlsx",
            )
            .unwrap()
            .0,
            "xlsx"
        );
        assert_eq!(
            estensione_documento_cache("application/zip", b"PK\x03\x04zip")
                .unwrap()
                .0,
            "zip"
        );
        assert!(estensione_documento_cache("application/zip", b"not-a-zip").is_err());
    }

    #[test]
    fn whatsapp_accetta_pdf_o_immagine_seguita_dal_pdf() {
        assert!(allegati_whatsapp_supportati(&[]));
        assert!(allegati_whatsapp_supportati(&[allegato_test("image/png")]));
        assert!(allegati_whatsapp_supportati(&[allegato_test(
            "application/pdf"
        )]));
        assert!(!allegati_whatsapp_supportati(&[allegato_test(
            "image/jpeg"
        )]));
        assert!(allegati_whatsapp_supportati(&[
            allegato_test("image/png"),
            allegato_test("application/pdf"),
        ]));
        assert!(!allegati_whatsapp_supportati(&[
            allegato_test("application/pdf"),
            allegato_test("image/png"),
        ]));
    }

    impl CommunicationAdapter for MockCommunicationAdapter {
        fn verifica_configurazione(&self) -> Result<(), ErroreAdattatore> {
            Ok(())
        }

        fn invia(
            &mut self,
            _comunicazione: &ComunicazioneDto,
        ) -> Result<RicevutaAdattatore, ErroreAdattatore> {
            self.invocazioni += 1;
            self.esito.clone()
        }
    }

    impl CommunicationAdapter for SospendiDuranteSuccessoAdapter<'_> {
        fn verifica_configurazione(&self) -> Result<(), ErroreAdattatore> {
            Ok(())
        }

        fn invia(
            &mut self,
            _comunicazione: &ComunicazioneDto,
        ) -> Result<RicevutaAdattatore, ErroreAdattatore> {
            self.state
                .campagna_comunicazione_sospendi(self.campagna_id)
                .unwrap();
            Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "effetto-esterno-confermato".into(),
                copia_posta_inviata: false,
                avviso: String::new(),
            })
        }
    }

    struct ConfigErrorAdapter;

    impl CommunicationAdapter for ConfigErrorAdapter {
        fn verifica_configurazione(&self) -> Result<(), ErroreAdattatore> {
            Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::Configurazione,
                messaggio: "password locale mancante".into(),
            })
        }

        fn invia(
            &mut self,
            _comunicazione: &ComunicazioneDto,
        ) -> Result<RicevutaAdattatore, ErroreAdattatore> {
            panic!("un errore di configurazione non deve tentare SMTP")
        }
    }

    fn input_email(key: &str) -> ComunicazioneCreaInput {
        ComunicazioneCreaInput {
            idempotency_key: key.into(),
            destinatario_entita: "cliente".into(),
            destinatario_id: "c1".into(),
            canale: CanaleComunicazione::Email,
            recapito: "  demo@example.invalid ".into(),
            oggetto: "Avviso".into(),
            corpo: "Messaggio di prova".into(),
            modello_id: String::new(),
            modello_versione_id: String::new(),
            modello_versione: 0,
            origine_entita: String::new(),
            origine_id: String::new(),
            origine_revision: String::new(),
            origine_fingerprint: String::new(),
            origini_correlate: Vec::new(),
            origine_snapshot: Value::Null,
            tipo_modello: String::new(),
            campagna_id: String::new(),
            reinvio_di: String::new(),
            allegati: Vec::new(),
        }
    }

    fn proprietario_test() -> ProprietarioComunicazione {
        ProprietarioComunicazione {
            utente_id: "u-test".into(),
            utente_nome: "Tester".into(),
            dispositivo_id: "pc-test".into(),
            dispositivo_nome: "PC test".into(),
        }
    }

    fn stato_test(premium: bool) -> (tempfile::TempDir, tempfile::TempDir, AppState) {
        let app = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        if premium {
            fs::write(app.path().join("premium.json"), br#"{"enabled":true}"#).unwrap();
        }
        let state = AppState::init(app.path().to_path_buf()).unwrap();
        state.open_data_dir(data.path().to_str().unwrap()).unwrap();
        state
            .finish_onboarding(FinishOnboarding {
                data_dir: data.path().to_string_lossy().into_owned(),
                mode: "create".into(),
                user_id: Some(Ulid::generate().to_string()),
                nome: "Tester comunicazioni".into(),
                avatar_tipo: "iniziali".into(),
                avatar_valore: String::new(),
            })
            .unwrap();
        (app, data, state)
    }

    #[test]
    fn normalizza_i_recapiti_senza_perdere_la_validazione() {
        assert_eq!(
            normalizza_email(" demo@example.invalid ").unwrap(),
            "demo@example.invalid"
        );
        assert_eq!(
            normalizza_telefono("333 123 4567").unwrap(),
            "+393331234567"
        );
        assert_eq!(
            normalizza_telefono("00 39 333 123 4567").unwrap(),
            "+393331234567"
        );
        assert_eq!(normalizza_telefono("328 188 335").unwrap(), "+39328188335");
        assert_eq!(
            normalizza_telefono("081 123 4567").unwrap(),
            "+390811234567"
        );
        assert_eq!(
            normalizza_telefono("081 1234567 - 328 188 3355").unwrap(),
            "+393281883355"
        );
        assert!(normalizza_email("cliente@localhost").is_err());
        assert!(normalizza_telefono("123").is_err());
        assert_eq!(
            url_whatsapp("+39 333 123 4567"),
            "whatsapp://send?phone=393331234567"
        );
        assert_eq!(
            url_whatsapp_con_testo("+39 333 123 4567", "Ciao Luca — prova"),
            "whatsapp://send?phone=393331234567&text=Ciao%20Luca%20%E2%80%94%20prova"
        );
    }

    #[test]
    fn cache_documenti_accetta_solo_pdf_png_validi_e_non_espone_percorsi() {
        let (app, _data, state) = stato_test(true);
        let allegato = state
            .documento_cache_salva(DocumentoCacheSalvaInput {
                nome: "Preventivo P-1.pdf".into(),
                mime: "application/pdf".into(),
                dati: b"%PDF-1.4\n%%EOF".to_vec(),
            })
            .unwrap();
        assert!(allegato.riferimento.starts_with("pt-cache://"));
        assert!(!allegato
            .riferimento
            .contains(&app.path().to_string_lossy().to_string()));
        assert_eq!(
            state.documento_cache_leggi(&allegato).unwrap(),
            b"%PDF-1.4\n%%EOF"
        );
        let percorso_invio = state.documento_cache_percorso_invio(&allegato).unwrap();
        assert_eq!(
            percorso_invio.file_name().and_then(|value| value.to_str()),
            Some("Preventivo P-1.pdf")
        );
        assert!(state
            .documento_cache_salva(DocumentoCacheSalvaInput {
                nome: "falso.pdf".into(),
                mime: "application/pdf".into(),
                dati: b"non un pdf".to_vec(),
            })
            .is_err());
        assert!(nome_file_cache_da_riferimento("pt-cache://../segreto.pdf").is_err());
    }

    #[test]
    fn rilascio_immediato_elimina_solo_un_allegato_non_referenziato() {
        let (_app, _data, state) = stato_test(true);
        let allegato = state
            .documento_cache_salva(DocumentoCacheSalvaInput {
                nome: "Prescrizioni temporanee.zip".into(),
                mime: "application/zip".into(),
                dati: b"PK\x03\x04temporaneo".to_vec(),
            })
            .unwrap();
        let path = state
            .documento_cache_percorso_verificato(&allegato)
            .unwrap();
        assert!(path.exists());
        assert_eq!(
            state
                .documenti_cache_rilascia_con_policy(&[allegato], true)
                .unwrap(),
            1
        );
        assert!(!path.exists());
    }

    #[test]
    fn stati_attivi_proteggono_gli_allegati() {
        for stato in [
            StatoComunicazione::Bozza,
            StatoComunicazione::DaRevisionare,
            StatoComunicazione::InCoda,
            StatoComunicazione::Sospeso,
            StatoComunicazione::InInvio,
        ] {
            assert!(stato.richiede_documento_temporaneo());
        }
        for stato in [
            StatoComunicazione::InvioAzionato,
            StatoComunicazione::ConsegnaVerificata,
            StatoComunicazione::Fallito,
            StatoComunicazione::Annullato,
        ] {
            assert!(!stato.richiede_documento_temporaneo());
        }
    }

    #[test]
    fn cache_documenti_elimina_solo_gli_artefatti_scaduti() {
        let (_app, _data, state) = stato_test(true);
        let allegato = state
            .documento_cache_salva(DocumentoCacheSalvaInput {
                nome: "Preventivo scaduto.pdf".into(),
                mime: "application/pdf".into(),
                dati: b"%PDF-1.4\n%%EOF".to_vec(),
            })
            .unwrap();
        let path = state
            .documento_cache_percorso_verificato(&allegato)
            .unwrap();
        let modificato = std::time::SystemTime::now()
            .checked_sub(DURATA_CACHE_DOCUMENTI + Duration::from_secs(1))
            .unwrap();
        filetime::set_file_mtime(&path, filetime::FileTime::from_system_time(modificato)).unwrap();

        state.documenti_cache_rilascia(&[allegato]).unwrap();

        assert!(
            !path.exists(),
            "un artefatto oltre la retention va eliminato"
        );
    }

    #[test]
    fn esito_positivo_conserva_temporaneamente_il_documento_e_gli_indicatori() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([
                    ("nome".into(), json!("Cliente preventivo")),
                    ("email".into(), json!("demo@example.invalid")),
                ]),
            )
            .unwrap();
        let preventivo_id = "preventivo/ordine-test";
        state
            .with_engine(|engine| {
                engine
                    .emit("preventivo", preventivo_id, EventBody::Created)
                    .map_err(es)?;
                engine
                    .emit(
                        "preventivo",
                        preventivo_id,
                        EventBody::FieldSet {
                            field: "fingerprint_corrente".into(),
                            value: json!("impronta-1"),
                        },
                    )
                    .map(|_| ())
                    .map_err(es)
            })
            .unwrap();
        let revision = state
            .with_engine(|engine| {
                engine
                    .with_projection(|projection| {
                        projection
                            .get("preventivo", preventivo_id)
                            .ok()
                            .flatten()
                            .map(|record| record.updated_hlc.to_string())
                    })
                    .ok_or_else(|| "preventivo test mancante".to_string())
            })
            .unwrap();
        let allegato = state
            .documento_cache_salva(DocumentoCacheSalvaInput {
                nome: "Preventivo.pdf".into(),
                mime: "application/pdf".into(),
                dati: b"%PDF-1.4\n%%EOF".to_vec(),
            })
            .unwrap();
        let path = state
            .documento_cache_percorso_verificato(&allegato)
            .unwrap();
        let mut input = input_email("preventivo:esito:positivo");
        input.destinatario_id = cliente.id.clone();
        input.origine_entita = "preventivo".into();
        input.origine_id = preventivo_id.into();
        input.origine_revision = revision.clone();
        input.origine_fingerprint = "impronta-1".into();
        input.origine_snapshot = json!({"totale": 12345, "versioneModello": 1});
        input.tipo_modello = "sollecito_preventivo".into();
        input.allegati = vec![allegato.clone()];
        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        state.comunicazione_metti_in_coda(&bozza.id).unwrap();
        state.documenti_cache_rilascia(&[allegato]).unwrap();
        let mut adapter = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "smtp-test".into(),
                copia_posta_inviata: true,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        state
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter)
            .unwrap();
        assert!(
            path.exists(),
            "il PDF deve restare disponibile per il reinvio"
        );

        state
            .with_engine(|engine| {
                engine.with_projection(|projection| {
                    let preventivo = projection
                        .get("preventivo", preventivo_id)
                        .unwrap()
                        .unwrap();
                    assert_eq!(
                        str_field(&preventivo.data, "ultimo_invio_fingerprint"),
                        "impronta-1"
                    );
                    assert!(
                        preventivo
                            .data
                            .get("ultimo_sollecito_ms")
                            .and_then(Value::as_u64)
                            .unwrap_or(0)
                            > 0
                    );
                    assert!(
                        preventivo
                            .data
                            .get("preventivo_email_inviato")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        "il piccolo indicatore applicativo deve restare condiviso"
                    );
                    assert!(!preventivo.data.contains_key("ultimo_invio_snapshot"));
                    assert_eq!(
                        str_field(&preventivo.data, "ultimo_invio_comunicazione_id"),
                        ""
                    );
                    assert!(
                        projection
                            .get(ENTITA_COMUNICAZIONE, &bozza.id)
                            .unwrap()
                            .is_none(),
                        "il record della comunicazione non deve entrare nel motore condiviso"
                    );
                });
                Ok(())
            })
            .unwrap();
        state
            .with_communication_engine(|engine| {
                engine.with_projection(|projection| {
                    let comunicazione = projection
                        .get(ENTITA_COMUNICAZIONE, &bozza.id)
                        .unwrap()
                        .unwrap();
                    assert_eq!(
                        comunicazione
                            .data
                            .get("payload")
                            .and_then(Value::as_object)
                            .and_then(|payload| payload.get("origine_snapshot")),
                        Some(&json!({"totale": 12345, "versioneModello": 1}))
                    );
                });
                Ok(())
            })
            .unwrap();

        let mut secondo_invio = input_email("preventivo:esito:secondo");
        secondo_invio.destinatario_id = cliente.id;
        secondo_invio.origine_entita = "preventivo".into();
        secondo_invio.origine_id = preventivo_id.into();
        // È intenzionalmente la revisione precedente all'aggiornamento degli
        // indicatori prodotto dal primo invio.
        secondo_invio.origine_revision = revision;
        secondo_invio.origine_fingerprint = "impronta-1".into();
        secondo_invio.tipo_modello = "preventivo".into();
        assert!(state.comunicazione_crea_bozza(secondo_invio).is_ok());
    }

    #[test]
    fn reinvio_preventivo_rifiuta_una_fingerprint_semantica_superata() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([
                    ("nome".into(), json!("Cliente preventivo modificato")),
                    ("email".into(), json!("demo@example.invalid")),
                ]),
            )
            .unwrap();
        let preventivo_id = "preventivo/ordine-modificato";
        state
            .with_engine(|engine| {
                engine
                    .emit("preventivo", preventivo_id, EventBody::Created)
                    .map_err(es)?;
                engine
                    .emit(
                        "preventivo",
                        preventivo_id,
                        EventBody::FieldSet {
                            field: "fingerprint_corrente".into(),
                            value: json!("impronta-iniziale"),
                        },
                    )
                    .map(|_| ())
                    .map_err(es)
            })
            .unwrap();
        let revisione_iniziale = state
            .with_engine(|engine| {
                engine
                    .with_projection(|projection| {
                        projection
                            .get("preventivo", preventivo_id)
                            .ok()
                            .flatten()
                            .map(|record| record.updated_hlc.to_string())
                    })
                    .ok_or_else(|| "preventivo test mancante".to_string())
            })
            .unwrap();
        state
            .with_engine(|engine| {
                engine
                    .emit(
                        "preventivo",
                        preventivo_id,
                        EventBody::FieldSet {
                            field: "fingerprint_corrente".into(),
                            value: json!("impronta-modificata"),
                        },
                    )
                    .map(|_| ())
                    .map_err(es)
            })
            .unwrap();

        let mut input = input_email("preventivo:fingerprint-superata");
        input.destinatario_id = cliente.id;
        input.origine_entita = "preventivo".into();
        input.origine_id = preventivo_id.into();
        input.origine_revision = revisione_iniziale;
        input.origine_fingerprint = "impronta-iniziale".into();
        input.tipo_modello = "preventivo".into();

        assert_eq!(
            state.comunicazione_crea_bozza(input).unwrap_err(),
            "l'elemento collegato è cambiato durante la revisione: riapri l'invio"
        );
    }

    #[test]
    fn scheda_cliente_e_allegato_restano_validi_per_due_invii_consecutivi() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([
                    ("nome".into(), json!("Cliente scheda")),
                    ("email".into(), json!("demo@example.invalid")),
                ]),
            )
            .unwrap();
        let scheda_id = "scheda_cliente/ordine-scheda";
        state
            .with_engine(|engine| {
                engine
                    .emit("scheda_cliente", scheda_id, EventBody::Created)
                    .map_err(es)?;
                engine
                    .emit(
                        "scheda_cliente",
                        scheda_id,
                        EventBody::FieldSet {
                            field: "ordine_id".into(),
                            value: json!("ordine-scheda"),
                        },
                    )
                    .map(|_| ())
                    .map_err(es)
            })
            .unwrap();
        let revisione = state
            .with_engine(|engine| {
                engine
                    .with_projection(|projection| {
                        projection
                            .get("scheda_cliente", scheda_id)
                            .ok()
                            .flatten()
                            .map(|record| record.updated_hlc.to_string())
                    })
                    .ok_or_else(|| "scheda cliente test mancante".to_string())
            })
            .unwrap();
        let allegato = state
            .documento_cache_salva(DocumentoCacheSalvaInput {
                nome: "Scheda cliente.pdf".into(),
                mime: "application/pdf".into(),
                dati: b"%PDF-1.4\n%%EOF".to_vec(),
            })
            .unwrap();
        let prepara_input = |key: &str| {
            let mut input = input_email(key);
            input.destinatario_id = cliente.id.clone();
            input.origine_entita = "scheda_cliente".into();
            input.origine_id = scheda_id.into();
            input.origine_revision = revisione.clone();
            input.allegati = vec![allegato.clone()];
            input
        };
        let mut adapter = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "smtp-scheda".into(),
                copia_posta_inviata: true,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };

        let primo = state
            .comunicazione_crea_bozza(prepara_input("scheda-cliente:primo"))
            .unwrap();
        state.comunicazione_metti_in_coda(&primo.id).unwrap();
        state
            .documenti_cache_rilascia(std::slice::from_ref(&allegato))
            .unwrap();
        state
            .comunicazione_processa_con_adattatore(&primo.id, &mut adapter)
            .unwrap();

        let secondo = state
            .comunicazione_crea_bozza(prepara_input("scheda-cliente:secondo"))
            .unwrap();
        state.comunicazione_metti_in_coda(&secondo.id).unwrap();
        state
            .comunicazione_processa_con_adattatore(&secondo.id, &mut adapter)
            .unwrap();

        assert_eq!(adapter.invocazioni, 2);
        assert!(state.documento_cache_leggi(&allegato).is_ok());
    }

    #[test]
    fn avviso_spedizione_batch_allinea_ogni_fingerprint_condiviso() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([
                    ("nome".into(), json!("Cliente spedizione")),
                    ("email".into(), json!("demo@example.invalid")),
                ]),
            )
            .unwrap();
        for id in ["sped-1", "sped-2"] {
            state
                .record_create_with_id(
                    "spedizione",
                    id,
                    Map::from_iter([
                        ("data".into(), json!("2026-08-01")),
                        ("lotto".into(), json!("lotto-1")),
                    ]),
                )
                .unwrap();
        }

        let mut input = input_email("spedizione:batch:esito");
        input.destinatario_id = cliente.id;
        input.origine_entita = "spedizione".into();
        input.origine_id = "sped-1".into();
        input.origine_fingerprint = "fingerprint-1".into();
        input.origini_correlate = vec![OrigineCorrelataInput {
            id: "sped-2".into(),
            fingerprint: "fingerprint-2".into(),
        }];
        input.tipo_modello = "preavviso_spedizione".into();
        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        state.comunicazione_metti_in_coda(&bozza.id).unwrap();
        let mut adapter = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "smtp-spedizione".into(),
                copia_posta_inviata: true,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        state
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter)
            .unwrap();

        state
            .with_engine(|engine| {
                engine.with_projection(|projection| {
                    for (id, fingerprint) in
                        [("sped-1", "fingerprint-1"), ("sped-2", "fingerprint-2")]
                    {
                        let spedizione = projection.get("spedizione", id).unwrap().unwrap();
                        assert_eq!(
                            str_field(&spedizione.data, "ultimo_avviso_fingerprint"),
                            fingerprint
                        );
                        assert!(
                            spedizione
                                .data
                                .get("ultimo_avviso_ms")
                                .and_then(Value::as_u64)
                                .unwrap_or(0)
                                > 0
                        );
                    }
                });
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn invio_produzione_accetta_solo_destinatario_fisso_e_traccia_il_lotto() {
        let (_app, _data, state) = stato_test(true);
        let order = state
            .record_create(
                "ordine",
                Map::from_iter([("categoria".into(), json!("Immunoterapia"))]),
            )
            .unwrap();
        let row = state
            .record_create(
                "riga_ordine",
                Map::from_iter([
                    ("ordine_id".into(), json!(order.id)),
                    ("lotto_produzione".into(), json!("lot-test")),
                ]),
            )
            .unwrap();
        let mut invalid = input_email("produzione:destinatario-invalido");
        invalid.destinatario_entita = DESTINATARIO_LABORATORIO_LABORATORIO.into();
        invalid.destinatario_id = ID_LABORATORIO_LABORATORIO.into();
        invalid.canale = CanaleComunicazione::Whatsapp;
        invalid.recapito = "+393331234567".into();
        assert!(state.comunicazione_crea_bozza(invalid).is_err());

        let mut input = input_email("produzione:invio-valido");
        input.destinatario_entita = DESTINATARIO_LABORATORIO_LABORATORIO.into();
        input.destinatario_id = ID_LABORATORIO_LABORATORIO.into();
        input.recapito = "questo valore viene ignorato dal backend".into();
        input.origine_entita = "lotto_produzione".into();
        input.origine_id = "lot-test".into();
        input.tipo_modello = "invio_produzione".into();
        let allegato = state
            .documento_cache_salva(DocumentoCacheSalvaInput {
                nome: "Prescrizioni lotto.zip".into(),
                mime: "application/zip".into(),
                dati: b"PK\x03\x04produzione".to_vec(),
            })
            .unwrap();
        let allegato_path = state
            .documento_cache_percorso_verificato(&allegato)
            .unwrap();
        input.allegati = vec![allegato.clone()];
        let draft = state.comunicazione_crea_bozza(input).unwrap();
        assert_eq!(draft.recapito, EMAIL_LABORATORIO_LABORATORIO);
        state
            .documenti_cache_rilascia_con_policy(&[allegato], true)
            .unwrap();
        assert!(
            allegato_path.exists(),
            "la bozza deve proteggere l'allegato di produzione"
        );
        state.comunicazione_metti_in_coda(&draft.id).unwrap();
        let mut adapter = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: true,
                riferimento_esterno: "smtp-production".into(),
                copia_posta_inviata: true,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        state
            .comunicazione_processa_con_adattatore(&draft.id, &mut adapter)
            .unwrap();
        assert!(
            !allegato_path.exists(),
            "dopo l'invio il file di produzione non è più necessario"
        );
        let residuo_post_arresto = state
            .documento_cache_salva(DocumentoCacheSalvaInput {
                nome: "Prescrizioni lotto.zip".into(),
                mime: "application/zip".into(),
                dati: b"PK\x03\x04produzione".to_vec(),
            })
            .unwrap();
        assert!(allegato_path.exists());
        state
            .documenti_cache_rilascia(&[residuo_post_arresto])
            .unwrap();
        assert!(
            !allegato_path.exists(),
            "la manutenzione deve rimuovere anche un residuo di un invio già concluso"
        );
        let updated = state.record_get("riga_ordine", &row.id).unwrap().unwrap();
        assert_eq!(
            str_field(&updated.data, "ultimo_invio_laboratorio_lotto"),
            "lot-test"
        );
        assert!(
            updated
                .data
                .get("ultimo_invio_laboratorio_ms")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                > 0
        );
        assert_eq!(
            str_field(&updated.data, "ultimo_invio_laboratorio_comunicazione_id"),
            draft.id
        );
    }

    #[test]
    fn invio_conserva_preventivo_pdf_o_png_per_un_reinvio() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente allegati"))]),
            )
            .unwrap();
        let casi = [
            (
                "application/pdf",
                "Preventivo P-100.pdf",
                b"%PDF-1.4\n%%EOF".as_slice(),
            ),
            (
                "image/png",
                "Preventivo P-100.png",
                &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00],
            ),
        ];

        for (indice, (mime, nome, dati)) in casi.into_iter().enumerate() {
            let allegato = state
                .documento_cache_salva(DocumentoCacheSalvaInput {
                    nome: nome.into(),
                    mime: mime.into(),
                    dati: dati.to_vec(),
                })
                .unwrap();
            let mut input = input_email(&format!("custom:preventivo:{indice}"));
            input.destinatario_id = cliente.id.clone();
            input.corpo = "Messaggio personalizzato con preventivo".into();
            input.allegati = vec![allegato.clone()];
            let bozza = state.comunicazione_crea_bozza(input).unwrap();
            state.comunicazione_metti_in_coda(&bozza.id).unwrap();
            state
                .documenti_cache_rilascia(std::slice::from_ref(&allegato))
                .unwrap();
            let mut adapter = MockCommunicationAdapter {
                esito: Ok(RicevutaAdattatore {
                    invio_azionato: true,
                    consegna_verificata: false,
                    riferimento_esterno: format!("custom-{indice}"),
                    copia_posta_inviata: true,
                    avviso: String::new(),
                }),
                invocazioni: 0,
            };
            let inviata = state
                .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter)
                .unwrap();

            assert!(state.documento_cache_leggi(&allegato).is_ok());
            assert!(state.comunicazione_reinvia(&inviata.id).is_ok());
        }
    }

    #[test]
    fn documento_condiviso_resta_disponibile_dopo_gli_invii() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente due canali"))]),
            )
            .unwrap();
        let allegato = state
            .documento_cache_salva(DocumentoCacheSalvaInput {
                nome: "Preventivo condiviso.pdf".into(),
                mime: "application/pdf".into(),
                dati: b"%PDF-1.4\n%%EOF".to_vec(),
            })
            .unwrap();
        let path = state
            .documento_cache_percorso_verificato(&allegato)
            .unwrap();
        let mut ids = Vec::new();
        for indice in 0..2 {
            let mut input = input_email(&format!("documento:condiviso:{indice}"));
            input.destinatario_id = cliente.id.clone();
            input.allegati = vec![allegato.clone()];
            let bozza = state.comunicazione_crea_bozza(input).unwrap();
            state.comunicazione_metti_in_coda(&bozza.id).unwrap();
            ids.push(bozza.id);
        }
        state
            .documenti_cache_rilascia(std::slice::from_ref(&allegato))
            .unwrap();

        for (indice, id) in ids.iter().enumerate() {
            let mut adapter = MockCommunicationAdapter {
                esito: Ok(RicevutaAdattatore {
                    invio_azionato: true,
                    consegna_verificata: false,
                    riferimento_esterno: format!("condiviso-{indice}"),
                    copia_posta_inviata: true,
                    avviso: String::new(),
                }),
                invocazioni: 0,
            };
            state
                .comunicazione_processa_con_adattatore(id, &mut adapter)
                .unwrap();
            assert!(
                path.exists(),
                "il file deve restare disponibile per il reinvio"
            );
        }
    }

    #[test]
    fn annullare_una_bozza_non_rimuove_subito_il_relativo_allegato() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente pulizia allegato"))]),
            )
            .unwrap();
        let allegato = state
            .documento_cache_salva(DocumentoCacheSalvaInput {
                nome: "Preventivo da eliminare.pdf".into(),
                mime: "application/pdf".into(),
                dati: b"%PDF-1.4\n%%EOF".to_vec(),
            })
            .unwrap();
        let path = state
            .documento_cache_percorso_verificato(&allegato)
            .unwrap();
        let mut input = input_email("storico:allegato:elimina");
        input.destinatario_id = cliente.id;
        input.allegati = vec![allegato.clone()];
        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        state.comunicazione_annulla(&bozza.id).unwrap();
        state.documenti_cache_rilascia(&[allegato]).unwrap();

        assert!(
            path.exists(),
            "l'artefatto appena creato non va eliminato subito"
        );
        state.comunicazione_elimina(&bozza.id).unwrap();
    }

    #[test]
    fn stessa_intenzione_genera_lo_stesso_id_e_payload_diverso_viene_rilevato() {
        let prima = prepara(
            input_email("ordine:o1:sollecito:email:v1"),
            proprietario_test(),
        )
        .unwrap();
        let seconda = prepara(
            input_email("ordine:o1:sollecito:email:v1"),
            proprietario_test(),
        )
        .unwrap();
        assert_eq!(prima.id, seconda.id);
        assert_eq!(prima.payload_fingerprint, seconda.payload_fingerprint);

        let mut cambiata = input_email("ordine:o1:sollecito:email:v1");
        cambiata.corpo = "Contenuto differente".into();
        let cambiata = prepara(cambiata, proprietario_test()).unwrap();
        assert_eq!(prima.id, cambiata.id);
        assert_ne!(prima.payload_fingerprint, cambiata.payload_fingerprint);
    }

    #[test]
    fn macchina_a_stati_non_ritenta_un_invio_positivo() {
        assert!(transizione_valida(
            StatoComunicazione::Bozza,
            StatoComunicazione::InCoda
        ));
        assert!(transizione_valida(
            StatoComunicazione::Fallito,
            StatoComunicazione::InCoda
        ));
        assert!(!transizione_valida(
            StatoComunicazione::InvioAzionato,
            StatoComunicazione::InCoda
        ));
        assert!(!transizione_valida(
            StatoComunicazione::ConsegnaVerificata,
            StatoComunicazione::InCoda
        ));
    }

    #[test]
    fn cronologia_elimina_solo_comunicazioni_terminali() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente cronologia"))]),
            )
            .unwrap();
        let mut input = input_email("cronologia:singola");
        input.destinatario_id = cliente.id;
        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        assert!(state.comunicazione_elimina(&bozza.id).is_err());

        state.comunicazione_annulla(&bozza.id).unwrap();
        state.comunicazione_elimina(&bozza.id).unwrap();
        assert!(state
            .comunicazioni_lista()
            .unwrap()
            .iter()
            .all(|comunicazione| comunicazione.id != bozza.id));
    }

    #[test]
    fn cronologia_locale_elimina_un_invio_positivo() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente cronologia"))]),
            )
            .unwrap();
        let mut input = input_email("cronologia:positivo-locale");
        input.destinatario_id = cliente.id;
        let comunicazione = state.comunicazione_crea_bozza(input).unwrap();
        state
            .with_communication_engine(|engine| {
                engine
                    .emit(
                        ENTITA_COMUNICAZIONE,
                        &comunicazione.id,
                        EventBody::FieldSet {
                            field: "stato".into(),
                            value: json!(StatoComunicazione::InvioAzionato.as_str()),
                        },
                    )
                    .map(|_| ())
                    .map_err(es)
            })
            .unwrap();

        assert!(state
            .comunicazioni_lista()
            .unwrap()
            .iter()
            .any(|item| item.id == comunicazione.id));
        state.comunicazione_elimina(&comunicazione.id).unwrap();
        assert!(state
            .comunicazioni_lista()
            .unwrap()
            .iter()
            .all(|item| item.id != comunicazione.id));
    }

    #[test]
    fn cronologia_elimina_una_selezione_in_un_solo_batch() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente cronologia"))]),
            )
            .unwrap();
        let mut prima = input_email("cronologia:selezione:1");
        prima.destinatario_id = cliente.id.clone();
        let mut seconda = input_email("cronologia:selezione:2");
        seconda.destinatario_id = cliente.id;
        let prima = state.comunicazione_crea_bozza(prima).unwrap();
        let seconda = state.comunicazione_crea_bozza(seconda).unwrap();
        state.comunicazione_annulla(&prima.id).unwrap();
        state.comunicazione_annulla(&seconda.id).unwrap();

        assert_eq!(
            state
                .comunicazioni_elimina(&[prima.id.clone(), seconda.id.clone()])
                .unwrap(),
            2
        );
        assert!(state.comunicazioni_lista().unwrap().is_empty());
    }

    #[test]
    fn cronologia_elimina_un_batch_terminato_in_blocco() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente cronologia"))]),
            )
            .unwrap();
        let mut prima = input_email("cronologia:batch:1");
        prima.destinatario_id = cliente.id.clone();
        prima.campagna_id = "campagna:cronologia".into();
        let mut seconda = input_email("cronologia:batch:2");
        seconda.destinatario_id = cliente.id;
        seconda.campagna_id = "campagna:cronologia".into();
        let prima = state.comunicazione_crea_bozza(prima).unwrap();
        let seconda = state.comunicazione_crea_bozza(seconda).unwrap();

        assert!(state
            .campagna_comunicazione_elimina("campagna:cronologia")
            .is_err());
        state.comunicazione_annulla(&prima.id).unwrap();
        state.comunicazione_annulla(&seconda.id).unwrap();
        assert_eq!(
            state
                .campagna_comunicazione_elimina("campagna:cronologia")
                .unwrap(),
            2
        );
        assert!(state.comunicazioni_lista().unwrap().is_empty());
    }

    #[test]
    fn adattatore_finto_distingue_inv_io_azionato_da_consegna() {
        let mut adapter = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "mock-1".into(),
                copia_posta_inviata: true,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        let prepared = prepara(input_email("mock:test:1"), proprietario_test()).unwrap();
        let record = crate::projection::Record {
            entity: ENTITA_COMUNICAZIONE.into(),
            id: prepared.id,
            data: prepared.fields,
            deleted: false,
            created_hlc: crate::sync::hlc::Hlc::new(1, 0, "test"),
            updated_hlc: crate::sync::hlc::Hlc::new(1, 0, "test"),
        };
        let communication = dto(record).unwrap();
        let receipt = adapter.invia(&communication).unwrap();
        assert!(receipt.invio_azionato);
        assert!(!receipt.consegna_verificata);
        assert_eq!(adapter.invocazioni, 1);
    }

    #[test]
    fn outbox_crea_una_sola_bozza_e_rifiuta_collisioni() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente test"))]),
            )
            .unwrap();
        let mut input = input_email("ordine:o1:sollecito:email:v1");
        input.destinatario_id = cliente.id.clone();

        let prima = state.comunicazione_crea_bozza(input.clone()).unwrap();
        let seconda = state.comunicazione_crea_bozza(input.clone()).unwrap();
        assert_eq!(prima.id, seconda.id);
        assert_eq!(state.comunicazioni_lista().unwrap().len(), 1);
        assert!(
            state.record_get(ENTITA_COMUNICAZIONE, &prima.id).is_err(),
            "anche su un PC premium il CRUD generico non deve aggirare i comandi di dominio"
        );

        input.corpo = "Un messaggio diverso con la stessa chiave".into();
        assert!(state.comunicazione_crea_bozza(input).is_err());
        assert_eq!(state.comunicazioni_lista().unwrap().len(), 1);
    }

    #[test]
    fn coda_e_annullamento_rispettano_le_transizioni() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente test"))]),
            )
            .unwrap();
        let mut input = input_email("manuale:cliente:email:1");
        input.destinatario_id = cliente.id;
        let bozza = state.comunicazione_crea_bozza(input).unwrap();

        let in_coda = state.comunicazione_metti_in_coda(&bozza.id).unwrap();
        assert_eq!(in_coda.stato, StatoComunicazione::InCoda);
        let ancora_in_coda = state.comunicazione_metti_in_coda(&bozza.id).unwrap();
        assert_eq!(ancora_in_coda.stato, StatoComunicazione::InCoda);

        let annullata = state.comunicazione_annulla(&bozza.id).unwrap();
        assert_eq!(annullata.stato, StatoComunicazione::Annullato);
        assert!(state.comunicazione_metti_in_coda(&bozza.id).is_err());
    }

    #[test]
    fn la_coda_trovata_all_avvio_resta_ferma_fino_a_una_scelta_esplicita() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente coda avvio"))]),
            )
            .unwrap();
        let mut input = input_email("manuale:cliente:email:coda-avvio");
        input.destinatario_id = cliente.id;
        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        state.comunicazione_metti_in_coda(&bozza.id).unwrap();

        assert_eq!(state.comunicazioni_trattieni_coda_all_avvio().unwrap(), 1);
        assert!(state.comunicazione_processa_prossima().unwrap().is_none());
        assert_eq!(
            state
                .comunicazioni_lista()
                .unwrap()
                .into_iter()
                .find(|item| item.id == bozza.id)
                .unwrap()
                .stato,
            StatoComunicazione::InCoda,
            "la protezione di avvio non deve cambiare né riscrivere lo stato"
        );

        state.comunicazione_metti_in_coda(&bozza.id).unwrap();
        assert!(!state
            .communication_startup_held
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .contains(&bozza.id));
    }

    #[test]
    fn due_clienti_con_lo_stesso_numero_restano_due_invii_sequenziali() {
        let (_app, _data, state) = stato_test(true);
        let cliente_a = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente fake A"))]),
            )
            .unwrap();
        let cliente_b = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente fake B"))]),
            )
            .unwrap();

        let mut primo_input = input_email("campagna:duplicato:whatsapp:1");
        primo_input.destinatario_id = cliente_a.id;
        primo_input.canale = CanaleComunicazione::Whatsapp;
        primo_input.recapito = "+39 328 188 3355".into();
        primo_input.oggetto.clear();
        let mut secondo_input = input_email("campagna:duplicato:whatsapp:2");
        secondo_input.destinatario_id = cliente_b.id;
        secondo_input.canale = CanaleComunicazione::Whatsapp;
        secondo_input.recapito = "+39 328 188 3355".into();
        secondo_input.oggetto.clear();

        let primo = state.comunicazione_crea_bozza(primo_input).unwrap();
        let secondo = state.comunicazione_crea_bozza(secondo_input).unwrap();
        assert_ne!(primo.id, secondo.id);
        assert_eq!(primo.recapito, secondo.recapito);
        state.comunicazione_metti_in_coda(&primo.id).unwrap();
        state.comunicazione_metti_in_coda(&secondo.id).unwrap();

        let mut adapter = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "whatsapp-test".into(),
                copia_posta_inviata: false,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        state
            .comunicazione_processa_con_adattatore(&primo.id, &mut adapter)
            .unwrap();
        state
            .comunicazione_processa_con_adattatore(&secondo.id, &mut adapter)
            .unwrap();
        assert_eq!(adapter.invocazioni, 2);
    }

    #[test]
    fn campagna_sospende_riprende_e_annulla_solo_gli_invii_pendenti() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente campagna"))]),
            )
            .unwrap();
        let mut primo_input = input_email("campagna:test:cliente:email:1");
        primo_input.destinatario_id = cliente.id.clone();
        primo_input.campagna_id = "campagna:test".into();
        let mut secondo_input = input_email("campagna:test:cliente:email:2");
        secondo_input.destinatario_id = cliente.id;
        secondo_input.campagna_id = "campagna:test".into();

        let primo = state.comunicazione_crea_bozza(primo_input).unwrap();
        let secondo = state.comunicazione_crea_bozza(secondo_input).unwrap();
        state.comunicazione_metti_in_coda(&primo.id).unwrap();
        state.comunicazione_metti_in_coda(&secondo.id).unwrap();

        let mut adapter = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "smtp-campagna-1".into(),
                copia_posta_inviata: true,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        state
            .comunicazione_processa_con_adattatore(&primo.id, &mut adapter)
            .unwrap();

        let sospese = state
            .campagna_comunicazione_sospendi("campagna:test")
            .unwrap();
        assert_eq!(
            sospese
                .iter()
                .find(|item| item.id == primo.id)
                .unwrap()
                .stato,
            StatoComunicazione::InvioAzionato
        );
        assert_eq!(
            sospese
                .iter()
                .find(|item| item.id == secondo.id)
                .unwrap()
                .stato,
            StatoComunicazione::Sospeso
        );
        assert!(state.comunicazione_processa_prossima().unwrap().is_none());

        let riprese = state
            .campagna_comunicazione_riprendi("campagna:test")
            .unwrap();
        assert_eq!(
            riprese
                .iter()
                .find(|item| item.id == secondo.id)
                .unwrap()
                .stato,
            StatoComunicazione::InCoda
        );

        let annullate = state
            .campagna_comunicazione_annulla("campagna:test")
            .unwrap();
        assert_eq!(
            annullate
                .iter()
                .find(|item| item.id == primo.id)
                .unwrap()
                .stato,
            StatoComunicazione::InvioAzionato
        );
        assert_eq!(
            annullate
                .iter()
                .find(|item| item.id == secondo.id)
                .unwrap()
                .stato,
            StatoComunicazione::Annullato
        );
        assert_eq!(
            state
                .campagna_comunicazione_annulla("campagna:test")
                .unwrap()
                .len(),
            2,
            "ripetere l'annullamento non crea effetti o duplicati"
        );
    }

    #[test]
    fn campagna_annulla_anche_invio_attivo_e_resto_della_coda() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente annullo attivo"))]),
            )
            .unwrap();
        let crea = |indice: u8| {
            let mut input = input_email(&format!("campagna:annullo-attivo:{indice}"));
            input.destinatario_id = cliente.id.clone();
            input.campagna_id = "campagna:annullo-attivo".into();
            let bozza = state.comunicazione_crea_bozza(input).unwrap();
            state.comunicazione_metti_in_coda(&bozza.id).unwrap()
        };
        let prima = crea(1);
        let seconda = crea(2);
        let attiva = state.comunicazione_inizia_invio(&prima.id).unwrap();
        assert_eq!(attiva.stato, StatoComunicazione::InInvio);

        let annullate = state
            .campagna_comunicazione_annulla("campagna:annullo-attivo")
            .unwrap();
        assert_eq!(
            annullate
                .iter()
                .find(|item| item.id == prima.id)
                .unwrap()
                .stato,
            StatoComunicazione::InInvio,
            "un invio già attivo resta tale finché non è noto se l'effetto esterno è avvenuto"
        );
        assert_eq!(
            state.comunicazione_interruzione_richiesta(&prima.id),
            Some(StatoComunicazione::Annullato)
        );
        assert_eq!(
            annullate
                .iter()
                .find(|item| item.id == seconda.id)
                .unwrap()
                .stato,
            StatoComunicazione::Annullato
        );
        let interrotta = state
            .comunicazione_differisce_per_attivita_utente(&prima.id)
            .unwrap();
        assert_eq!(interrotta.stato, StatoComunicazione::Annullato);
    }

    #[test]
    fn campagna_annullata_riprende_solo_gli_invii_non_effettuati() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente ripresa annullata"))]),
            )
            .unwrap();
        let crea = |indice: u8| {
            let mut input = input_email(&format!("campagna:riprendi-annullata:{indice}"));
            input.destinatario_id = cliente.id.clone();
            input.campagna_id = "campagna:riprendi-annullata".into();
            let bozza = state.comunicazione_crea_bozza(input).unwrap();
            state.comunicazione_metti_in_coda(&bozza.id).unwrap()
        };
        let prima = crea(1);
        let seconda = crea(2);
        let terza = crea(3);
        let mut adapter = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "primo-gia-inviato".into(),
                copia_posta_inviata: true,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        state
            .comunicazione_processa_con_adattatore(&prima.id, &mut adapter)
            .unwrap();
        state
            .campagna_comunicazione_annulla("campagna:riprendi-annullata")
            .unwrap();

        let ripresa = state
            .campagna_comunicazione_riprendi("campagna:riprendi-annullata")
            .unwrap();
        assert_eq!(
            ripresa
                .iter()
                .find(|item| item.id == prima.id)
                .unwrap()
                .stato,
            StatoComunicazione::InvioAzionato
        );
        assert_eq!(
            ripresa
                .iter()
                .find(|item| item.id == seconda.id)
                .unwrap()
                .stato,
            StatoComunicazione::InCoda
        );
        assert_eq!(
            ripresa
                .iter()
                .find(|item| item.id == terza.id)
                .unwrap()
                .stato,
            StatoComunicazione::InCoda
        );
        assert_eq!(adapter.invocazioni, 1, "la ripresa non reinvia il positivo");
    }

    #[test]
    fn un_errore_non_sospende_i_destinatari_successivi_del_batch() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente batch"))]),
            )
            .unwrap();
        let mut primo_input = input_email("campagna:errore:email:1");
        primo_input.destinatario_id = cliente.id.clone();
        primo_input.campagna_id = "campagna:errore".into();
        let mut secondo_input = input_email("campagna:errore:email:2");
        secondo_input.destinatario_id = cliente.id;
        secondo_input.campagna_id = "campagna:errore".into();
        let primo = state.comunicazione_crea_bozza(primo_input).unwrap();
        let secondo = state.comunicazione_crea_bozza(secondo_input).unwrap();
        state.comunicazione_metti_in_coda(&primo.id).unwrap();
        state.comunicazione_metti_in_coda(&secondo.id).unwrap();

        let mut adapter = MockCommunicationAdapter {
            esito: Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::InvioNonAzionato,
                messaggio: "finestra non verificata".into(),
            }),
            invocazioni: 0,
        };
        let result = state.comunicazione_processa_con_adattatore(&primo.id, &mut adapter);
        state.gestisci_eventuale_errore_invio(&result);

        let elementi = state.comunicazioni_lista().unwrap();
        assert_eq!(
            elementi
                .iter()
                .find(|item| item.id == primo.id)
                .unwrap()
                .stato,
            StatoComunicazione::Fallito
        );
        assert_eq!(
            elementi
                .iter()
                .find(|item| item.id == secondo.id)
                .unwrap()
                .stato,
            StatoComunicazione::InCoda
        );
        assert!(state
            .comunicazione_metti_in_coda(&primo.id)
            .unwrap_err()
            .contains("completi gli altri destinatari"));
        assert!(state
            .campagna_comunicazione_riprova_fallite("campagna:errore")
            .unwrap_err()
            .contains("completi tutti i destinatari"));
        assert_eq!(adapter.invocazioni, 1);
    }

    #[test]
    fn numero_whatsapp_inesistente_non_spezza_il_batch() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente batch WhatsApp"))]),
            )
            .unwrap();
        let mut inesistente = input_email("campagna:wa-inesistente:1");
        inesistente.canale = CanaleComunicazione::Whatsapp;
        inesistente.recapito = "+999999999999".into();
        inesistente.destinatario_id = cliente.id.clone();
        inesistente.campagna_id = "campagna:wa-inesistente".into();
        let mut successiva = input_email("campagna:wa-inesistente:2");
        successiva.canale = CanaleComunicazione::Whatsapp;
        successiva.recapito = "+393281883355".into();
        successiva.destinatario_id = cliente.id;
        successiva.campagna_id = "campagna:wa-inesistente".into();
        let inesistente = state.comunicazione_crea_bozza(inesistente).unwrap();
        let successiva = state.comunicazione_crea_bozza(successiva).unwrap();
        state.comunicazione_metti_in_coda(&inesistente.id).unwrap();
        state.comunicazione_metti_in_coda(&successiva.id).unwrap();

        let mut errore_numero = MockCommunicationAdapter {
            esito: Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::InvioNonAzionato,
                messaggio: "Il numero +999999999999 non risulta associato a WhatsApp. L'invio non è stato effettuato."
                    .into(),
            }),
            invocazioni: 0,
        };
        let primo = state
            .comunicazione_processa_con_adattatore(&inesistente.id, &mut errore_numero)
            .unwrap();
        assert_eq!(primo.stato, StatoComunicazione::Fallito);
        assert_eq!(primo.errore_codice, "chat_non_verificata");
        assert_eq!(primo.errore_fase, "chat");
        assert!(!primo.esito_ambiguo);

        let ancora_in_coda = state
            .comunicazioni_lista()
            .unwrap()
            .into_iter()
            .find(|item| item.id == successiva.id)
            .unwrap();
        assert_eq!(ancora_in_coda.stato, StatoComunicazione::InCoda);

        let mut invio_successivo = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "whatsapp-successivo".into(),
                copia_posta_inviata: false,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        let secondo = state
            .comunicazione_processa_con_adattatore(&successiva.id, &mut invio_successivo)
            .unwrap();
        assert_eq!(secondo.stato, StatoComunicazione::InvioAzionato);
        assert_eq!(errore_numero.invocazioni, 1);
        assert_eq!(invio_successivo.invocazioni, 1);
    }

    #[test]
    fn attivita_utente_differisce_senza_fallire_e_poi_riprende() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente PC occupato"))]),
            )
            .unwrap();
        let mut input = input_email("coda:pc-occupato:1");
        input.destinatario_id = cliente.id;
        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        state.comunicazione_metti_in_coda(&bozza.id).unwrap();

        let mut adapter = MockCommunicationAdapter {
            esito: Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::AttivitaUtente,
                messaggio: "PC in uso".into(),
            }),
            invocazioni: 0,
        };
        let differita = state
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter)
            .unwrap();
        assert_eq!(differita.stato, StatoComunicazione::InCoda);
        assert!(differita.ultimo_errore.is_empty());
        assert!(!differita.esito_ambiguo);

        adapter.esito = Ok(RicevutaAdattatore {
            invio_azionato: true,
            consegna_verificata: false,
            riferimento_esterno: "ripresa-dopo-quiete".into(),
            copia_posta_inviata: false,
            avviso: String::new(),
        });
        let inviata = state
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter)
            .unwrap();
        assert_eq!(inviata.stato, StatoComunicazione::InvioAzionato);
        assert_eq!(adapter.invocazioni, 2);
    }

    #[test]
    fn pausa_della_campagna_trattiene_anche_l_invio_attivo_differito() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente pausa batch"))]),
            )
            .unwrap();
        let crea = |indice: u8| {
            let mut input = input_email(&format!("campagna:pausa-attiva:email:{indice}"));
            input.destinatario_id = cliente.id.clone();
            input.campagna_id = "campagna:pausa-attiva".into();
            let bozza = state.comunicazione_crea_bozza(input).unwrap();
            state.comunicazione_metti_in_coda(&bozza.id).unwrap()
        };
        let attiva = crea(1);
        let in_coda = crea(2);

        state.comunicazione_inizia_invio(&attiva.id).unwrap();
        state
            .campagna_comunicazione_sospendi("campagna:pausa-attiva")
            .unwrap();
        let differita = state
            .comunicazione_differisce_per_attivita_utente(&attiva.id)
            .unwrap();
        assert_eq!(differita.stato, StatoComunicazione::Sospeso);

        let sospese = state.comunicazioni_lista().unwrap();
        assert_eq!(
            sospese
                .iter()
                .find(|item| item.id == in_coda.id)
                .unwrap()
                .stato,
            StatoComunicazione::Sospeso
        );
        let riprese = state
            .campagna_comunicazione_riprendi("campagna:pausa-attiva")
            .unwrap();
        assert!(riprese
            .iter()
            .all(|item| item.stato == StatoComunicazione::InCoda));
    }

    #[test]
    fn ripresa_durante_la_pausa_non_lascia_indietro_l_invio_attivo() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente ripresa immediata"))]),
            )
            .unwrap();
        let crea = |indice: u8| {
            let mut input = input_email(&format!("campagna:ripresa-immediata:email:{indice}"));
            input.destinatario_id = cliente.id.clone();
            input.campagna_id = "campagna:ripresa-immediata".into();
            let bozza = state.comunicazione_crea_bozza(input).unwrap();
            state.comunicazione_metti_in_coda(&bozza.id).unwrap()
        };
        let attiva = crea(1);
        let in_coda = crea(2);

        state.comunicazione_inizia_invio(&attiva.id).unwrap();
        state
            .campagna_comunicazione_sospendi("campagna:ripresa-immediata")
            .unwrap();
        let riprese = state
            .campagna_comunicazione_riprendi("campagna:ripresa-immediata")
            .unwrap();
        assert_eq!(
            riprese
                .iter()
                .find(|item| item.id == in_coda.id)
                .unwrap()
                .stato,
            StatoComunicazione::InCoda
        );
        assert_eq!(
            state.comunicazione_interruzione_richiesta(&attiva.id),
            Some(StatoComunicazione::InCoda)
        );

        let riaccodata = state
            .comunicazione_differisce_per_attivita_utente(&attiva.id)
            .unwrap();
        assert_eq!(riaccodata.stato, StatoComunicazione::InCoda);
        assert!(state
            .comunicazioni_lista()
            .unwrap()
            .iter()
            .all(|item| item.stato == StatoComunicazione::InCoda));
    }

    #[test]
    fn pausa_non_trasforma_in_mancante_un_invio_gia_azionato() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente pausa dopo invio"))]),
            )
            .unwrap();
        let crea = |indice: u8| {
            let mut input = input_email(&format!("campagna:pausa-successo:email:{indice}"));
            input.destinatario_id = cliente.id.clone();
            input.campagna_id = "campagna:pausa-successo".into();
            let bozza = state.comunicazione_crea_bozza(input).unwrap();
            state.comunicazione_metti_in_coda(&bozza.id).unwrap()
        };
        let attiva = crea(1);
        let in_coda = crea(2);
        let mut adapter = SospendiDuranteSuccessoAdapter {
            state: &state,
            campagna_id: "campagna:pausa-successo",
        };

        let inviata = state
            .comunicazione_processa_con_adattatore(&attiva.id, &mut adapter)
            .unwrap();
        assert_eq!(inviata.stato, StatoComunicazione::InvioAzionato);
        assert_eq!(
            state
                .comunicazioni_lista()
                .unwrap()
                .into_iter()
                .find(|item| item.id == in_coda.id)
                .unwrap()
                .stato,
            StatoComunicazione::Sospeso
        );
        assert_eq!(state.comunicazione_interruzione_richiesta(&attiva.id), None);
    }

    #[test]
    fn il_retry_di_campagna_rimette_in_coda_solo_i_falliti_certi() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente retry batch"))]),
            )
            .unwrap();
        let crea = |indice: u8| {
            let mut input = input_email(&format!("campagna:retry:email:{indice}"));
            input.destinatario_id = cliente.id.clone();
            input.campagna_id = "campagna:retry".into();
            let bozza = state.comunicazione_crea_bozza(input).unwrap();
            state.comunicazione_metti_in_coda(&bozza.id).unwrap()
        };
        let fallita_certa = crea(1);
        let riuscita = crea(2);
        let fallita_ambigua = crea(3);

        let mut adapter = MockCommunicationAdapter {
            esito: Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::InvioNonAzionato,
                messaggio: "numero non disponibile".into(),
            }),
            invocazioni: 0,
        };
        state
            .comunicazione_processa_con_adattatore(&fallita_certa.id, &mut adapter)
            .unwrap();
        adapter.esito = Ok(RicevutaAdattatore {
            invio_azionato: true,
            consegna_verificata: false,
            riferimento_esterno: "smtp-retry-test".into(),
            copia_posta_inviata: true,
            avviso: String::new(),
        });
        state
            .comunicazione_processa_con_adattatore(&riuscita.id, &mut adapter)
            .unwrap();
        adapter.esito = Err(ErroreAdattatore {
            classe: ClasseErroreAdattatore::EsitoAmbiguo,
            messaggio: "esito incerto".into(),
        });
        state
            .comunicazione_processa_con_adattatore(&fallita_ambigua.id, &mut adapter)
            .unwrap();

        let elementi = state
            .campagna_comunicazione_riprova_fallite("campagna:retry")
            .unwrap();
        assert_eq!(
            elementi
                .iter()
                .find(|item| item.id == fallita_certa.id)
                .unwrap()
                .stato,
            StatoComunicazione::InCoda
        );
        assert_eq!(
            elementi
                .iter()
                .find(|item| item.id == riuscita.id)
                .unwrap()
                .stato,
            StatoComunicazione::InvioAzionato
        );
        let ambigua = elementi
            .iter()
            .find(|item| item.id == fallita_ambigua.id)
            .unwrap();
        assert_eq!(ambigua.stato, StatoComunicazione::Fallito);
        assert!(ambigua.esito_ambiguo);
    }

    #[test]
    fn un_invio_interrotto_non_riparte_e_non_blocca_il_batch() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente recupero"))]),
            )
            .unwrap();
        let mut primo_input = input_email("campagna:recupero:email:1");
        primo_input.destinatario_id = cliente.id.clone();
        primo_input.campagna_id = "campagna:recupero".into();
        let mut secondo_input = input_email("campagna:recupero:email:2");
        secondo_input.destinatario_id = cliente.id;
        secondo_input.campagna_id = "campagna:recupero".into();
        let primo = state.comunicazione_crea_bozza(primo_input).unwrap();
        let secondo = state.comunicazione_crea_bozza(secondo_input).unwrap();
        state.comunicazione_metti_in_coda(&primo.id).unwrap();
        state.comunicazione_metti_in_coda(&secondo.id).unwrap();
        state.comunicazione_inizia_invio(&primo.id).unwrap();

        assert_eq!(state.comunicazioni_recupera_invii_interrotti().unwrap(), 1);
        assert_eq!(
            state.comunicazioni_recupera_invii_interrotti().unwrap(),
            0,
            "il recupero è idempotente"
        );

        let elementi = state.comunicazioni_lista().unwrap();
        let primo_recuperato = elementi.iter().find(|item| item.id == primo.id).unwrap();
        assert_eq!(primo_recuperato.stato, StatoComunicazione::Fallito);
        assert!(primo_recuperato.esito_ambiguo);
        assert_eq!(
            elementi
                .iter()
                .find(|item| item.id == secondo.id)
                .unwrap()
                .stato,
            StatoComunicazione::InCoda
        );
    }

    #[test]
    fn il_pc_origine_esegue_una_volta_e_conserva_autore_ed_esito_locali() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente test"))]),
            )
            .unwrap();
        let mut input = input_email("manuale:cliente:email:esito-positivo");
        input.destinatario_id = cliente.id;
        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        assert_eq!(bozza.proprietario_utente_nome, "Tester comunicazioni");
        assert_eq!(bozza.proprietario_dispositivo_id, state.config().device_id);
        state.comunicazione_metti_in_coda(&bozza.id).unwrap();

        let mut adapter = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "smtp-test-1".into(),
                copia_posta_inviata: true,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        let inviata = state
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter)
            .unwrap();
        assert_eq!(inviata.stato, StatoComunicazione::InvioAzionato);
        assert_eq!(inviata.tentativi, 1);
        assert!(inviata.inviata_ms > 0);
        assert!(inviata.copia_posta_inviata);
        assert_eq!(inviata.riferimento_esterno, "smtp-test-1");
        assert_eq!(adapter.invocazioni, 1);
        assert!(state
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter)
            .is_err());
        assert_eq!(adapter.invocazioni, 1);

        let reinvio = state.comunicazione_reinvia(&inviata.id).unwrap();
        assert_ne!(reinvio.id, inviata.id);
        assert_eq!(reinvio.reinvio_di, inviata.id);
        assert_eq!(reinvio.stato, StatoComunicazione::InCoda);
        assert_eq!(reinvio.corpo, inviata.corpo);
        assert_eq!(reinvio.oggetto, inviata.oggetto);
    }

    #[test]
    fn errore_smtp_ambiguo_non_viene_ritentato_con_la_stessa_comunicazione() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente test"))]),
            )
            .unwrap();
        let mut input = input_email("manuale:cliente:email:esito-incerto");
        input.destinatario_id = cliente.id;
        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        state.comunicazione_metti_in_coda(&bozza.id).unwrap();

        let mut adapter = MockCommunicationAdapter {
            esito: Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::EsitoAmbiguo,
                messaggio: "timeout dopo il tentativo SMTP".into(),
            }),
            invocazioni: 0,
        };
        let fallita = state
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter)
            .unwrap();
        assert_eq!(fallita.stato, StatoComunicazione::Fallito);
        assert!(fallita.esito_ambiguo);
        assert_eq!(fallita.tentativi, 1);
        assert!(state.comunicazione_metti_in_coda(&bozza.id).is_err());

        let reinvio = state.comunicazione_reinvia(&bozza.id).unwrap();
        assert_ne!(reinvio.id, bozza.id);
        assert_eq!(reinvio.reinvio_di, bozza.id);
        assert_eq!(reinvio.stato, StatoComunicazione::InCoda);
    }

    #[test]
    fn reinvio_multiplo_crea_nuove_intenzioni_senza_toccare_le_originali() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente reinvio multiplo"))]),
            )
            .unwrap();
        let crea = |indice: u8| {
            let mut input = input_email(&format!("reinvio:multiplo:{indice}"));
            input.destinatario_id = cliente.id.clone();
            state.comunicazione_crea_bozza(input).unwrap()
        };
        let prima = crea(1);
        let seconda = crea(2);
        let attiva = crea(3);
        state.comunicazione_annulla(&prima.id).unwrap();
        state.comunicazione_annulla(&seconda.id).unwrap();

        assert!(state
            .comunicazioni_reinvia(&[prima.id.clone(), attiva.id.clone()])
            .is_err());
        assert_eq!(state.comunicazioni_lista().unwrap().len(), 3);

        let nuove = state
            .comunicazioni_reinvia(&[prima.id.clone(), seconda.id.clone()])
            .unwrap();
        assert_eq!(nuove.len(), 2);
        assert!(nuove
            .iter()
            .all(|comunicazione| comunicazione.stato == StatoComunicazione::InCoda));
        assert_eq!(
            nuove
                .iter()
                .map(|comunicazione| comunicazione.reinvio_di.as_str())
                .collect::<std::collections::HashSet<_>>(),
            std::collections::HashSet::from([prima.id.as_str(), seconda.id.as_str()])
        );
        let tutte = state.comunicazioni_lista().unwrap();
        assert_eq!(tutte.len(), 5);
        assert_eq!(
            tutte
                .iter()
                .find(|comunicazione| comunicazione.id == prima.id)
                .unwrap()
                .stato,
            StatoComunicazione::Annullato
        );
        assert_eq!(
            tutte
                .iter()
                .find(|comunicazione| comunicazione.id == seconda.id)
                .unwrap()
                .stato,
            StatoComunicazione::Annullato
        );
    }

    #[test]
    fn errore_di_configurazione_offre_un_retry_senza_tentare_smtp() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente test"))]),
            )
            .unwrap();
        let mut input = input_email("manuale:cliente:email:config-mancante");
        input.destinatario_id = cliente.id;
        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        state.comunicazione_metti_in_coda(&bozza.id).unwrap();

        let fallita = state
            .comunicazione_processa_con_adattatore(&bozza.id, &mut ConfigErrorAdapter)
            .unwrap();
        assert_eq!(fallita.stato, StatoComunicazione::Fallito);
        assert!(!fallita.esito_ambiguo);
        assert_eq!(fallita.tentativi, 0);
        assert_eq!(fallita.ultimo_errore, "password locale mancante");
        let riprovabile = state.comunicazione_metti_in_coda(&bozza.id).unwrap();
        assert_eq!(riprovabile.stato, StatoComunicazione::InCoda);
    }

    #[test]
    fn ricostruzione_proiezione_condivisa_conserva_la_cronologia_locale() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente locale"))]),
            )
            .unwrap();
        let mut input = input_email("ricostruzione:locale:email:1");
        input.destinatario_id = cliente.id;
        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        let annullata = state.comunicazione_annulla(&bozza.id).unwrap();
        assert_eq!(annullata.stato, StatoComunicazione::Annullato);

        state.ricostruisci_proiezione_locale().unwrap();

        let conservata = state
            .comunicazioni_lista()
            .unwrap()
            .into_iter()
            .find(|comunicazione| comunicazione.id == bozza.id)
            .expect("la ricostruzione condivisa non deve toccare lo storico locale");
        assert_eq!(conservata.stato, StatoComunicazione::Annullato);
        assert_eq!(conservata.corpo, "Messaggio di prova");
    }

    #[test]
    fn due_pc_non_condividono_ne_coda_ne_cronologia_riuscita() {
        let data = tempfile::tempdir().unwrap();
        let app_a = tempfile::tempdir().unwrap();
        let app_b = tempfile::tempdir().unwrap();
        for app in [&app_a, &app_b] {
            fs::write(app.path().join("premium.json"), br#"{"enabled":true}"#).unwrap();
        }
        let a = AppState::init(app_a.path().to_path_buf()).unwrap();
        let b = AppState::init(app_b.path().to_path_buf()).unwrap();
        let data_dir = data.path().to_string_lossy().into_owned();
        for (state, nome) in [(&a, "Operatore A"), (&b, "Operatore B")] {
            state.open_data_dir(&data_dir).unwrap();
            state
                .finish_onboarding(FinishOnboarding {
                    data_dir: data_dir.clone(),
                    mode: "create".into(),
                    user_id: Some(Ulid::generate().to_string()),
                    nome: nome.into(),
                    avatar_tipo: "iniziali".into(),
                    avatar_valore: String::new(),
                })
                .unwrap();
        }
        a.force_sync().unwrap();
        b.force_sync().unwrap();

        let cliente = a
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Cliente condiviso"))]),
            )
            .unwrap();
        b.force_sync().unwrap();
        let mut input = input_email("due-pc:cliente:email:1");
        input.destinatario_id = cliente.id.clone();
        let bozza = a.comunicazione_crea_bozza(input).unwrap();
        let in_coda = a.comunicazione_metti_in_coda(&bozza.id).unwrap();
        assert_eq!(in_coda.proprietario_utente_nome, "Operatore A");

        b.force_sync().unwrap();
        let vista_b = b
            .comunicazioni_lista()
            .unwrap()
            .into_iter()
            .find(|comunicazione| comunicazione.id == bozza.id);
        assert!(
            vista_b.is_none(),
            "bozze e coda non devono comparire sugli altri PC"
        );
        assert!(b.comunicazione_metti_in_coda(&bozza.id).is_err());

        let mut adapter_b = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "non-deve-partire".into(),
                copia_posta_inviata: true,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        assert!(b
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter_b)
            .is_err());
        assert_eq!(adapter_b.invocazioni, 0);

        let mut adapter_a = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "smtp-a-1".into(),
                copia_posta_inviata: true,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        let inviata = a
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter_a)
            .unwrap();
        assert_eq!(inviata.stato, StatoComunicazione::InvioAzionato);
        assert_eq!(adapter_a.invocazioni, 1);

        b.force_sync().unwrap();
        let sincronizzata = b
            .comunicazioni_lista()
            .unwrap()
            .into_iter()
            .find(|comunicazione| comunicazione.id == bozza.id);
        assert!(
            sincronizzata.is_none(),
            "anche ricevuta e cronologia riuscita devono restare sul PC A"
        );
        a.with_engine(|engine| {
            assert!(
                engine
                    .with_projection(|projection| {
                        projection.get(ENTITA_COMUNICAZIONE, &bozza.id)
                    })
                    .map_err(es)?
                    .is_none(),
                "nessun record comunicazione deve essere scritto nel motore condiviso"
            );
            Ok(())
        })
        .unwrap();

        let mut campagna_input = input_email("due-pc:campagna:email:2");
        campagna_input.destinatario_id = cliente.id;
        campagna_input.campagna_id = "campagna:due-pc".into();
        let campagna = a.comunicazione_crea_bozza(campagna_input).unwrap();
        a.comunicazione_metti_in_coda(&campagna.id).unwrap();
        b.force_sync().unwrap();
        assert!(b
            .campagna_comunicazione_sospendi("campagna:due-pc")
            .is_err());
        a.campagna_comunicazione_sospendi("campagna:due-pc")
            .unwrap();
        a.campagna_comunicazione_riprendi("campagna:due-pc")
            .unwrap();
        let mut adapter_campagna = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "smtp-a-campagna".into(),
                copia_posta_inviata: true,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        let ripresa = a
            .comunicazione_processa_con_adattatore(&campagna.id, &mut adapter_campagna)
            .unwrap();
        assert_eq!(ripresa.stato, StatoComunicazione::InvioAzionato);
        assert_eq!(adapter_campagna.invocazioni, 1);
    }

    /// Collaudo manuale esplicito, escluso dalla suite normale. Richiede:
    /// `PHARMATEK_APP_DIR` e `PHARMATEK_WHATSAPP_BATCH_TEST` (numeri separati da
    /// virgola). Usa il primo cliente configurato come intestatario tecnico e
    /// verifica che un fallimento non impedisca l'elaborazione dei successivi.
    #[test]
    #[ignore = "invia messaggi WhatsApp reali soltanto su richiesta esplicita"]
    fn collaudo_whatsapp_batch_reale_da_env() {
        let app_dir = std::env::var("PHARMATEK_APP_DIR").expect("PHARMATEK_APP_DIR mancante");
        let numeri = std::env::var("PHARMATEK_WHATSAPP_BATCH_TEST")
            .expect("PHARMATEK_WHATSAPP_BATCH_TEST mancante")
            .split(',')
            .map(str::trim)
            .filter(|numero| !numero.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        assert!(numeri.len() >= 2, "servono almeno due numeri");

        let state = AppState::init(std::path::PathBuf::from(app_dir)).unwrap();
        state.force_sync().unwrap();
        let cliente = state
            .records_list("cliente")
            .unwrap()
            .into_iter()
            .find(|record| {
                normalizza_telefono(&str_field(&record.data, "telefono")).ok()
                    == normalizza_telefono(&numeri[0]).ok()
            })
            .expect("nessun cliente col primo numero disponibile per il collaudo");
        let campagna = format!("collaudo-whatsapp-batch:{}", now_ms());

        for (index, numero) in numeri.iter().enumerate() {
            let bozza = state
                .comunicazione_crea_bozza(ComunicazioneCreaInput {
                    idempotency_key: format!("{campagna}:{}", index + 1),
                    destinatario_entita: "cliente".into(),
                    destinatario_id: cliente.id.clone(),
                    canale: CanaleComunicazione::Whatsapp,
                    recapito: numero.clone(),
                    oggetto: String::new(),
                    corpo: format!(
                        "Test batch comunicazioni PharmaTek ({}/{})",
                        index + 1,
                        numeri.len()
                    ),
                    modello_id: String::new(),
                    modello_versione_id: String::new(),
                    modello_versione: 0,
                    origine_entita: String::new(),
                    origine_id: String::new(),
                    origine_revision: String::new(),
                    origine_fingerprint: String::new(),
                    origini_correlate: Vec::new(),
                    origine_snapshot: Value::Null,
                    tipo_modello: String::new(),
                    campagna_id: campagna.clone(),
                    reinvio_di: String::new(),
                    allegati: Vec::new(),
                })
                .unwrap();
            state.comunicazione_metti_in_coda(&bozza.id).unwrap();
        }

        let mut elaborati = Vec::new();
        while let Some(esito) = state.comunicazione_processa_prossima().unwrap() {
            elaborati.push(esito);
        }
        assert_eq!(elaborati.len(), numeri.len());
        assert!(
            elaborati.iter().all(|item| {
                matches!(
                    item.stato,
                    StatoComunicazione::InvioAzionato
                        | StatoComunicazione::ConsegnaVerificata
                        | StatoComunicazione::Fallito
                )
            }),
            "ogni destinatario deve essere elaborato senza sospendere i successivi"
        );
        for item in elaborati {
            eprintln!(
                "{} {}: {}",
                item.recapito,
                item.stato.as_str(),
                item.ultimo_errore
            );
        }
    }

    /// Collaudo diretto dell'interazione Desktop con destinatari e nomi
    /// distinti (`numero|nome,numero|nome`). Non minimizza tra gli elementi,
    /// misura ogni invio e, se il PC viene usato, attende la quiete senza
    /// trasformare l'elemento in un fallimento.
    #[test]
    #[ignore = "invia messaggi WhatsApp reali soltanto su richiesta esplicita"]
    fn collaudo_whatsapp_batch_ui_da_env() {
        let targets = std::env::var("PHARMATEK_WHATSAPP_BATCH_TARGETS")
            .expect("PHARMATEK_WHATSAPP_BATCH_TARGETS mancante")
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| {
                let (numero, nome) = value
                    .split_once('|')
                    .expect("usa il formato numero|nome,numero|nome");
                (
                    normalizza_telefono(numero).unwrap(),
                    nome.trim().to_string(),
                )
            })
            .collect::<Vec<_>>();
        assert!(targets.len() >= 2, "servono almeno due destinatari");
        let prefisso = std::env::var("PHARMATEK_WHATSAPP_BATCH_MESSAGE")
            .unwrap_or_else(|_| "Test batch rapido PharmaTek".into());
        let mut errori = Vec::new();

        for (indice, (recapito, nome)) in targets.iter().enumerate() {
            let corpo = format!("{prefisso} ({}/{})", indice + 1, targets.len());
            let iniziato = std::time::Instant::now();
            loop {
                while !crate::app::whatsapp_windows::pc_pronto_per_whatsapp() {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
                let url = url_whatsapp_con_testo(recapito, &corpo);
                crate::platform::apri_url_sistema(&url).expect("WhatsApp non si è aperto");
                match crate::app::whatsapp_windows::aziona_invio(
                    recapito,
                    nome,
                    &corpo,
                    &corpo,
                    None,
                    || false,
                ) {
                    Ok(_) => {
                        eprintln!(
                            "{} inviato in {} ms",
                            recapito,
                            iniziato.elapsed().as_millis()
                        );
                        break;
                    }
                    Err(error) if error.attivita_utente => {
                        eprintln!("{recapito} differito: PC in uso");
                    }
                    Err(error) => {
                        errori.push(format!("{recapito}: {}", error.messaggio));
                        break;
                    }
                }
            }
            if indice + 1 < targets.len() {
                std::thread::sleep(std::time::Duration::from_millis(650));
            }
        }
        crate::app::whatsapp_windows::minimizza_finestre();
        assert!(errori.is_empty(), "{}", errori.join(" | "));
    }

    /// Prova controllata di un solo numero senza dipendere dall'anagrafica:
    /// l'automazione può procedere soltanto se WhatsApp espone nell'intestazione
    /// le cifre del numero richiesto. Resta esclusa dalla suite normale.
    #[test]
    #[ignore = "invia un messaggio WhatsApp reale soltanto su richiesta esplicita"]
    fn collaudo_whatsapp_singolo_per_numero_da_env() {
        let numero = std::env::var("PHARMATEK_WHATSAPP_SINGLE_TEST")
            .expect("PHARMATEK_WHATSAPP_SINGLE_TEST mancante");
        let corpo = std::env::var("PHARMATEK_WHATSAPP_SINGLE_MESSAGE")
            .unwrap_or_else(|_| "Test comunicazioni PharmaTek".into());
        let destinatario = std::env::var("PHARMATEK_WHATSAPP_SINGLE_NAME").unwrap_or_default();
        let recapito = normalizza_telefono(&numero).unwrap();
        let marcatore = crate::app::whatsapp_windows::marcatore_apertura("collaudo-singolo");
        let mut tentativi = 0_u8;
        loop {
            while !crate::app::whatsapp_windows::pc_pronto_per_whatsapp() {
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
            if !crate::app::whatsapp_windows::bozza_contiene_marcatore(&marcatore) {
                let url = url_whatsapp_con_testo(&recapito, &marcatore);
                crate::platform::apri_url_sistema(&url).expect("WhatsApp non si è aperto");
            }
            match crate::app::whatsapp_windows::aziona_invio(
                &recapito,
                &destinatario,
                &corpo,
                &marcatore,
                None,
                || false,
            ) {
                Ok(_) => break,
                Err(error) if error.attivita_utente && tentativi < 10 => {
                    tentativi += 1;
                    eprintln!("retry {tentativi}: {}", error.messaggio);
                }
                Err(error) => panic!("{}", error.messaggio),
            }
        }
        if std::env::var("PHARMATEK_WHATSAPP_KEEP_OPEN").as_deref() != Ok("1") {
            crate::app::whatsapp_windows::minimizza_finestre();
        }
    }

    /// Verifica reale negativa: il deep-link deve mostrare l'errore di numero
    /// non associato e il driver non deve mai arrivare al pulsante Invia.
    #[test]
    #[ignore = "verifica un numero WhatsApp fittizio soltanto su richiesta esplicita"]
    fn collaudo_whatsapp_numero_fittizio_da_env() {
        let numero = std::env::var("PHARMATEK_WHATSAPP_INVALID_TEST")
            .expect("PHARMATEK_WHATSAPP_INVALID_TEST mancante");
        let recapito = normalizza_telefono(&numero).unwrap();
        let url = url_whatsapp(&recapito);
        crate::platform::apri_url_sistema(&url).expect("WhatsApp non si è aperto");
        let error = crate::app::whatsapp_windows::aziona_invio(
            &recapito,
            "",
            "Questo messaggio non deve essere inviato",
            "",
            None,
            || false,
        )
        .expect_err("il numero fittizio è stato accettato inaspettatamente");
        assert!(
            error.messaggio.contains("non risulta associato a WhatsApp"),
            "{}",
            error.messaggio
        );
        assert!(!error.esito_ambiguo);
        assert!(!error.attivita_utente);
        crate::app::whatsapp_windows::minimizza_finestre();
    }

    #[test]
    fn premium_blocca_comandi_specializzati_e_crud_generico() {
        let (_app, _data, state) = stato_test(false);
        assert!(state.comunicazioni_lista().is_err());
        assert!(state
            .record_create(
                ENTITA_COMUNICAZIONE,
                Map::from_iter([("stato".into(), json!("bozza"))]),
            )
            .is_err());
        assert!(state.records_list(ENTITA_COMUNICAZIONE).is_err());
        assert!(state
            .record_create(
                "cliente",
                Map::from_iter([("nome".into(), json!("Consentito"))]),
            )
            .is_ok());
    }

    #[test]
    fn riprova_campagna_aggiorna_numero_telefono_se_modificato_in_anagrafica() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([
                    ("nome".into(), json!("Mario Rossi")),
                    ("telefono".into(), json!("+393280000000")),
                ]),
            )
            .unwrap();

        let mut input = input_email("campagna:retry-aggiorna:1");
        input.canale = CanaleComunicazione::Whatsapp;
        input.destinatario_id = cliente.id.clone();
        input.recapito = "+393280000000".into();
        input.campagna_id = "campagna:retry-aggiorna".into();

        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        state.comunicazione_metti_in_coda(&bozza.id).unwrap();

        let mut adapter = MockCommunicationAdapter {
            esito: Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::InvioNonAzionato,
                messaggio: "numero non valido su whatsapp".into(),
            }),
            invocazioni: 0,
        };
        let fallita = state
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter)
            .unwrap();
        assert_eq!(fallita.stato, StatoComunicazione::Fallito);
        assert_eq!(fallita.recapito, "+393280000000");

        // Aggiorniamo il numero in anagrafica
        state
            .record_update(
                "cliente",
                &cliente.id,
                Map::from_iter([("telefono".into(), json!("338 111 2233"))]),
            )
            .unwrap();

        // Eseguiamo "Riprova falliti" sulla campagna
        let aggiornate = state
            .campagna_comunicazione_riprova_fallite("campagna:retry-aggiorna")
            .unwrap();
        let riprovata = aggiornate.iter().find(|item| item.id == bozza.id).unwrap();
        assert_eq!(riprovata.stato, StatoComunicazione::InCoda);
        assert_eq!(riprovata.recapito, "+393381112233");
        assert!(riprovata.ultimo_errore.is_empty());
    }

    #[test]
    fn riprova_campagna_mantiene_fallito_se_telefono_anagrafica_non_valido() {
        let (_app, _data, state) = stato_test(true);
        let cli_valido = state
            .record_create(
                "cliente",
                Map::from_iter([
                    ("nome".into(), json!("Cliente Valido")),
                    ("telefono".into(), json!("+393280000001")),
                ]),
            )
            .unwrap();
        let cli_invalido = state
            .record_create(
                "cliente",
                Map::from_iter([
                    ("nome".into(), json!("Cliente Invalido")),
                    ("telefono".into(), json!("+393280000002")),
                ]),
            )
            .unwrap();

        let crea = |key: &str, cli_id: &str, num: &str| {
            let mut input = input_email(key);
            input.canale = CanaleComunicazione::Whatsapp;
            input.destinatario_id = cli_id.into();
            input.recapito = num.into();
            input.campagna_id = "campagna:retry-invalid".into();
            let bozza = state.comunicazione_crea_bozza(input).unwrap();
            state.comunicazione_metti_in_coda(&bozza.id).unwrap();
            bozza
        };
        let b1 = crea("c:retry-inv:1", &cli_valido.id, "+393280000001");
        let b2 = crea("c:retry-inv:2", &cli_invalido.id, "+393280000002");

        let mut adapter = MockCommunicationAdapter {
            esito: Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::InvioNonAzionato,
                messaggio: "errore".into(),
            }),
            invocazioni: 0,
        };
        state
            .comunicazione_processa_con_adattatore(&b1.id, &mut adapter)
            .unwrap();
        state
            .comunicazione_processa_con_adattatore(&b2.id, &mut adapter)
            .unwrap();

        // Aggiorniamo cli_valido con un nuovo numero valido e cli_invalido con uno non valido
        state
            .record_update(
                "cliente",
                &cli_valido.id,
                Map::from_iter([("telefono".into(), json!("338 555 4433"))]),
            )
            .unwrap();
        state
            .record_update(
                "cliente",
                &cli_invalido.id,
                Map::from_iter([("telefono".into(), json!("123"))]),
            )
            .unwrap();

        let aggiornate = state
            .campagna_comunicazione_riprova_fallite("campagna:retry-invalid")
            .unwrap();
        let item1 = aggiornate.iter().find(|i| i.id == b1.id).unwrap();
        let item2 = aggiornate.iter().find(|i| i.id == b2.id).unwrap();

        // Il valido è rimesso in coda col nuovo numero
        assert_eq!(item1.stato, StatoComunicazione::InCoda);
        assert_eq!(item1.recapito, "+393385554433");

        // L'invalido resta Fallito e segnala l'errore dell'anagrafica
        assert_eq!(item2.stato, StatoComunicazione::Fallito);
        assert_eq!(item2.errore_codice, "recapito_anagrafica_non_valido");
        assert!(item2
            .ultimo_errore
            .contains("Recapito in anagrafica non valido"));
    }

    #[test]
    fn riprova_singola_aggiorna_e_valida_recapito() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([
                    ("nome".into(), json!("Singolo Retry")),
                    ("telefono".into(), json!("+393280000000")),
                ]),
            )
            .unwrap();

        let mut input = input_email("singola:retry:1");
        input.canale = CanaleComunicazione::Whatsapp;
        input.destinatario_id = cliente.id.clone();
        input.recapito = "+393280000000".into();

        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        state.comunicazione_metti_in_coda(&bozza.id).unwrap();

        let mut adapter = MockCommunicationAdapter {
            esito: Err(ErroreAdattatore {
                classe: ClasseErroreAdattatore::InvioNonAzionato,
                messaggio: "fallito".into(),
            }),
            invocazioni: 0,
        };
        state
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter)
            .unwrap();

        // 1. Con numero invalido in anagrafica, la rimessa in coda fallisce
        state
            .record_update(
                "cliente",
                &cliente.id,
                Map::from_iter([("telefono".into(), json!("abc"))]),
            )
            .unwrap();
        let err = state.comunicazione_metti_in_coda(&bozza.id).unwrap_err();
        assert!(err.contains("non valido per WhatsApp"));

        // 2. Con numero valido in anagrafica, viene rimessa in coda col nuovo recapito
        state
            .record_update(
                "cliente",
                &cliente.id,
                Map::from_iter([("telefono".into(), json!("339 999 8877"))]),
            )
            .unwrap();
        let riprovata = state.comunicazione_metti_in_coda(&bozza.id).unwrap();
        assert_eq!(riprovata.stato, StatoComunicazione::InCoda);
        assert_eq!(riprovata.recapito, "+393399998877");
    }

    #[test]
    fn reinvio_comunicazione_usa_nuovo_recapito() {
        let (_app, _data, state) = stato_test(true);
        let cliente = state
            .record_create(
                "cliente",
                Map::from_iter([
                    ("nome".into(), json!("Reinvio Cliente")),
                    ("email".into(), json!("demo@example.invalid")),
                ]),
            )
            .unwrap();

        let mut input = input_email("reinvio:test:1");
        input.destinatario_id = cliente.id.clone();
        input.recapito = "demo@example.invalid".into();

        let bozza = state.comunicazione_crea_bozza(input).unwrap();
        state.comunicazione_metti_in_coda(&bozza.id).unwrap();

        let mut adapter = MockCommunicationAdapter {
            esito: Ok(RicevutaAdattatore {
                invio_azionato: true,
                consegna_verificata: false,
                riferimento_esterno: "ext-1".into(),
                copia_posta_inviata: false,
                avviso: String::new(),
            }),
            invocazioni: 0,
        };
        let inviata = state
            .comunicazione_processa_con_adattatore(&bozza.id, &mut adapter)
            .unwrap();
        assert_eq!(inviata.stato, StatoComunicazione::InvioAzionato);

        // Aggiorniamo l'email in anagrafica
        state
            .record_update(
                "cliente",
                &cliente.id,
                Map::from_iter([("email".into(), json!("demo@example.invalid"))]),
            )
            .unwrap();

        // Creiamo il reinvio
        let reinviata = state.comunicazione_reinvia(&inviata.id).unwrap();
        assert_eq!(reinviata.recapito, "demo@example.invalid");
        assert_eq!(reinviata.reinvio_di, inviata.id);
    }
}
