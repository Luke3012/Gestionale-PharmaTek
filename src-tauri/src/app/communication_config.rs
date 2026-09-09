//! Configurazione condivisa e non segreta dei canali (FASE 11B).
//!
//! L'intero profilo e-mail vive in un solo campo LWW per evitare configurazioni
//! ibride durante modifiche concorrenti. La password non viene mai serializzata:
//! il comando la inoltra al portachiavi locale di Windows e nel log resta soltanto
//! la configurazione tecnica condivisibile.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::time::Duration;

use imap::types::Flag;
use imap::{ClientBuilder, ConnectionMode, Session, TlsKind};
use imap_proto::NameAttribute;
use lettre::message::{header::ContentType, Attachment, Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};

use super::communication::{normalizza_email, ComunicazioneDto};
use super::communication_credentials::{
    elimina_password_smtp, leggi_password_smtp, salva_password_smtp, LocalSmtpCredential,
};
use super::{es, now_ms, AppResult, AppState, EventBody, Mutation};

const ENTITA_CONFIGURAZIONE_CANALE: &str = "configurazione_canale";
const ID_CONFIGURAZIONE_EMAIL: &str = "email";

const DEFAULT_NOME_MITTENTE: &str = "PharmaTek";
const DEFAULT_EMAIL_MITTENTE: &str = "";
const DEFAULT_REPLY_TO: &str = "";
const DEFAULT_DESTINATARIO_PROVA: &str = "";
const DEFAULT_SMTP_HOST: &str = "smtp.example.invalid";
const DEFAULT_SMTP_PORT: u16 = 465;
const DEFAULT_IMAP_HOST: &str = "imap.example.invalid";
const DEFAULT_IMAP_PORT: u16 = 993;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SicurezzaTrasportoEmail {
    SslTls,
    Starttls,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigurazioneEmailCondivisa {
    nome_mittente: String,
    indirizzo_mittente: String,
    smtp_host: String,
    smtp_port: u16,
    smtp_sicurezza: SicurezzaTrasportoEmail,
    smtp_username: String,
    reply_to_abilitato: bool,
    reply_to: String,
    firma: String,
    salva_posta_inviata: bool,
    imap_host: String,
    imap_port: u16,
    imap_sicurezza: SicurezzaTrasportoEmail,
    destinatario_prova: String,
}

impl Default for ConfigurazioneEmailCondivisa {
    fn default() -> Self {
        Self {
            nome_mittente: DEFAULT_NOME_MITTENTE.into(),
            indirizzo_mittente: DEFAULT_EMAIL_MITTENTE.into(),
            smtp_host: DEFAULT_SMTP_HOST.into(),
            smtp_port: DEFAULT_SMTP_PORT,
            smtp_sicurezza: SicurezzaTrasportoEmail::SslTls,
            smtp_username: DEFAULT_EMAIL_MITTENTE.into(),
            reply_to_abilitato: false,
            reply_to: DEFAULT_REPLY_TO.into(),
            firma: String::new(),
            salva_posta_inviata: true,
            imap_host: DEFAULT_IMAP_HOST.into(),
            imap_port: DEFAULT_IMAP_PORT,
            imap_sicurezza: SicurezzaTrasportoEmail::SslTls,
            destinatario_prova: DEFAULT_DESTINATARIO_PROVA.into(),
        }
    }
}

/// Input IPC: volutamente senza `Debug`, perché può contenere la password
/// temporanea ricevuta dal modale.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurazioneEmailSalvaInput {
    pub nome_mittente: String,
    pub indirizzo_mittente: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_sicurezza: SicurezzaTrasportoEmail,
    pub smtp_username: String,
    pub reply_to_abilitato: bool,
    pub reply_to: String,
    #[serde(default)]
    pub firma: String,
    pub salva_posta_inviata: bool,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_sicurezza: SicurezzaTrasportoEmail,
    pub destinatario_prova: String,
    /// Assente = conserva la credenziale locale corrente.
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurazioneEmailDto {
    pub revision: String,
    pub configurata: bool,
    pub nome_mittente: String,
    pub indirizzo_mittente: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_sicurezza: SicurezzaTrasportoEmail,
    pub smtp_username: String,
    pub reply_to_abilitato: bool,
    pub reply_to: String,
    pub firma: String,
    pub salva_posta_inviata: bool,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_sicurezza: SicurezzaTrasportoEmail,
    pub destinatario_prova: String,
    pub password_presente_locale: bool,
    pub password_altro_utente_locale: bool,
    pub aggiornata_ms: u64,
    pub ultima_prova: Option<ProvaEmailDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvaEmailDto {
    pub destinatario: String,
    pub inviata_ms: u64,
    pub smtp_accettata: bool,
    pub copia_posta_inviata: bool,
    pub avviso: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct InvioEmailOperativa {
    pub copia_posta_inviata: bool,
    pub avviso: String,
}

impl From<ConfigurazioneEmailSalvaInput> for ConfigurazioneEmailCondivisa {
    fn from(input: ConfigurazioneEmailSalvaInput) -> Self {
        Self {
            nome_mittente: input.nome_mittente,
            indirizzo_mittente: input.indirizzo_mittente,
            smtp_host: input.smtp_host,
            smtp_port: input.smtp_port,
            smtp_sicurezza: input.smtp_sicurezza,
            smtp_username: input.smtp_username,
            reply_to_abilitato: input.reply_to_abilitato,
            reply_to: input.reply_to,
            firma: input.firma,
            salva_posta_inviata: input.salva_posta_inviata,
            imap_host: input.imap_host,
            imap_port: input.imap_port,
            imap_sicurezza: input.imap_sicurezza,
            destinatario_prova: input.destinatario_prova,
        }
    }
}

fn normalizza_host(value: &str, label: &str) -> AppResult<String> {
    let host = value.trim().to_lowercase();
    if host.is_empty()
        || host.len() > 253
        || host.contains("://")
        || host.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(format!("{label} non valido"));
    }
    Ok(host)
}

fn normalizza_testo(value: String, label: &str, max_chars: usize) -> AppResult<String> {
    let value = value.trim().to_string();
    if value.is_empty() || value.chars().count() > max_chars || value.chars().any(char::is_control)
    {
        return Err(format!("{label} mancante o troppo lungo"));
    }
    Ok(value)
}

fn valida(mut config: ConfigurazioneEmailCondivisa) -> AppResult<ConfigurazioneEmailCondivisa> {
    config.nome_mittente = normalizza_testo(config.nome_mittente, "nome del mittente", 160)?;
    config.indirizzo_mittente = normalizza_email(&config.indirizzo_mittente)?;
    config.smtp_host = normalizza_host(&config.smtp_host, "server di invio")?;
    if config.smtp_port == 0 {
        return Err("porta del server di invio non valida".into());
    }
    config.smtp_username =
        normalizza_testo(config.smtp_username, "nome utente della casella", 254)?;
    config.reply_to = config.reply_to.trim().to_lowercase();
    if config.reply_to_abilitato {
        config.reply_to = normalizza_email(&config.reply_to)?;
    } else if !config.reply_to.is_empty() {
        // Manteniamo la proposta pronta per l'interruttore, ma non la usiamo.
        config.reply_to = normalizza_email(&config.reply_to)?;
    }
    config.firma = config.firma.trim().to_string();
    if config.firma.chars().count() > 4_000 {
        return Err("firma e-mail troppo lunga".into());
    }
    config.imap_host = normalizza_host(&config.imap_host, "server Posta inviata")?;
    if config.imap_port == 0 {
        return Err("porta del server Posta inviata non valida".into());
    }
    config.destinatario_prova = normalizza_email(&config.destinatario_prova)?;
    Ok(config)
}

fn stato_password(credenziale: Option<&LocalSmtpCredential>, username: &str) -> (bool, bool) {
    match credenziale {
        Some(credenziale) if credenziale.username.eq_ignore_ascii_case(username) => (true, false),
        Some(_) => (false, true),
        None => (false, false),
    }
}

fn dto(
    config: ConfigurazioneEmailCondivisa,
    revision: String,
    configurata: bool,
    aggiornata_ms: u64,
    credenziale: Option<&LocalSmtpCredential>,
    ultima_prova: Option<ProvaEmailDto>,
) -> ConfigurazioneEmailDto {
    let (password_presente_locale, password_altro_utente_locale) =
        stato_password(credenziale, &config.smtp_username);
    ConfigurazioneEmailDto {
        revision,
        configurata,
        nome_mittente: config.nome_mittente,
        indirizzo_mittente: config.indirizzo_mittente,
        smtp_host: config.smtp_host,
        smtp_port: config.smtp_port,
        smtp_sicurezza: config.smtp_sicurezza,
        smtp_username: config.smtp_username,
        reply_to_abilitato: config.reply_to_abilitato,
        reply_to: config.reply_to,
        firma: config.firma,
        salva_posta_inviata: config.salva_posta_inviata,
        imap_host: config.imap_host,
        imap_port: config.imap_port,
        imap_sicurezza: config.imap_sicurezza,
        destinatario_prova: config.destinatario_prova,
        password_presente_locale,
        password_altro_utente_locale,
        aggiornata_ms,
        ultima_prova,
    }
}

fn ripristina_credenziale(precedente: Option<LocalSmtpCredential>) {
    match precedente {
        Some(precedente) => {
            let _ = salva_password_smtp(&precedente.username, &precedente.password);
        }
        None => {
            let _ = elimina_password_smtp();
        }
    }
}

fn crea_messaggio_prova(config: &ConfigurazioneEmailCondivisa) -> AppResult<Message> {
    let mittente: Mailbox = Mailbox::new(
        Some(config.nome_mittente.clone()),
        config
            .indirizzo_mittente
            .parse()
            .map_err(|_| "indirizzo del mittente non valido".to_string())?,
    );
    let destinatario: Mailbox = config
        .destinatario_prova
        .parse()
        .map_err(|_| "destinatario della prova non valido".to_string())?;
    let mut builder = Message::builder()
        .from(mittente)
        .to(destinatario)
        .subject("Prova e-mail da PharmaTek");
    if config.reply_to_abilitato {
        let reply_to: Mailbox = config
            .reply_to
            .parse()
            .map_err(|_| "indirizzo Rispondi a non valido".to_string())?;
        builder = builder.reply_to(reply_to);
    }
    builder
        .header(ContentType::TEXT_PLAIN)
        .body(
            "Questa è una prova controllata inviata dalle impostazioni di PharmaTek.\r\n\
             Non è richiesta alcuna risposta."
                .to_string(),
        )
        .map_err(es)
}

fn crea_messaggio_operativo(
    config: &ConfigurazioneEmailCondivisa,
    comunicazione: &ComunicazioneDto,
    allegati: Vec<(String, String, Vec<u8>)>,
) -> AppResult<Message> {
    let mittente: Mailbox = Mailbox::new(
        Some(config.nome_mittente.clone()),
        config
            .indirizzo_mittente
            .parse()
            .map_err(|_| "indirizzo del mittente non valido".to_string())?,
    );
    let destinatario: Mailbox = comunicazione
        .recapito
        .parse()
        .map_err(|_| "destinatario dell'e-mail non valido".to_string())?;
    let mut builder = Message::builder()
        .from(mittente)
        .to(destinatario)
        .subject(&comunicazione.oggetto);
    if config.reply_to_abilitato {
        let reply_to: Mailbox = config
            .reply_to
            .parse()
            .map_err(|_| "indirizzo Rispondi a non valido".to_string())?;
        builder = builder.reply_to(reply_to);
    }
    let mut corpo = comunicazione.corpo.clone();
    if !config.firma.is_empty() {
        corpo.push_str("\r\n\r\n");
        corpo.push_str(&config.firma);
    }
    if allegati.is_empty() {
        return builder
            .header(ContentType::TEXT_PLAIN)
            .body(corpo)
            .map_err(es);
    }
    let mut multipart = MultiPart::mixed().singlepart(SinglePart::plain(corpo));
    for (nome, mime, dati) in allegati {
        let content_type: ContentType = mime
            .parse()
            .map_err(|_| format!("formato dell'allegato «{nome}» non valido"))?;
        multipart = multipart.singlepart(Attachment::new(nome).body(dati, content_type));
    }
    builder.multipart(multipart).map_err(es)
}

fn invia_smtp(
    config: &ConfigurazioneEmailCondivisa,
    password: &str,
    messaggio: &Message,
) -> AppResult<()> {
    let builder = match config.smtp_sicurezza {
        SicurezzaTrasportoEmail::SslTls => SmtpTransport::relay(&config.smtp_host),
        SicurezzaTrasportoEmail::Starttls => SmtpTransport::starttls_relay(&config.smtp_host),
    }
    .map_err(|error| format!("server di invio non valido: {error}"))?;
    let transport = builder
        .port(config.smtp_port)
        .credentials(Credentials::new(
            config.smtp_username.clone(),
            password.to_string(),
        ))
        .timeout(Some(Duration::from_secs(30)))
        .build();
    transport
        .send(messaggio)
        .map(|_| ())
        .map_err(|error| format!("il server non ha accettato l'e-mail: {error}"))
}

fn nome_cartella_inviati<T: Read + Write>(session: &mut Session<T>) -> AppResult<String> {
    let cartelle = session
        .list(None, Some("*"))
        .map_err(|error| format!("impossibile leggere le cartelle della casella: {error}"))?;
    let selezionabile = |attributi: &[NameAttribute<'_>]| {
        !attributi
            .iter()
            .any(|attributo| matches!(attributo, NameAttribute::NoSelect))
    };
    let special_use = cartelle.iter().find(|cartella| {
        selezionabile(cartella.attributes())
            && cartella
                .attributes()
                .iter()
                .any(|attributo| matches!(attributo, NameAttribute::Sent))
    });
    let per_nome = || {
        cartelle.iter().find(|cartella| {
            if !selezionabile(cartella.attributes()) {
                return false;
            }
            let nome = cartella.name().trim().to_lowercase();
            matches!(
                nome.as_str(),
                "sent" | "sent items" | "posta inviata" | "inbox.sent" | "inbox.posta inviata"
            )
        })
    };
    special_use
        .or_else(per_nome)
        .map(|cartella| cartella.name().to_string())
        .ok_or_else(|| "cartella «Posta inviata» non riconosciuta sul server".to_string())
}

fn archivia_inviata_imap(
    config: &ConfigurazioneEmailCondivisa,
    password: &str,
    raw: &[u8],
) -> AppResult<()> {
    let mode = match config.imap_sicurezza {
        SicurezzaTrasportoEmail::SslTls => ConnectionMode::Tls,
        SicurezzaTrasportoEmail::Starttls => ConnectionMode::StartTls,
    };
    let client = ClientBuilder::new(&config.imap_host, config.imap_port)
        .mode(mode)
        .tls_kind(TlsKind::Native)
        .connect()
        .map_err(|error| format!("server Posta inviata non raggiungibile: {error}"))?;
    let mut session = client
        .login(&config.smtp_username, password)
        .map_err(|(error, _)| format!("accesso alla Posta inviata non riuscito: {error}"))?;
    let result = nome_cartella_inviati(&mut session).and_then(|cartella| {
        session
            .append(&cartella, raw)
            .flag(Flag::Seen)
            .finish()
            .map(|_| ())
            .map_err(|error| format!("copia nella Posta inviata non salvata: {error}"))
    });
    let _ = session.logout();
    result
}

impl AppState {
    fn configurazione_email_operativa(&self) -> AppResult<(ConfigurazioneEmailCondivisa, String)> {
        let config = self.with_engine(|engine| {
            engine
                .with_projection(|projection| {
                    projection
                        .get(ENTITA_CONFIGURAZIONE_CANALE, ID_CONFIGURAZIONE_EMAIL)
                        .ok()
                        .flatten()
                        .filter(|record| !record.deleted)
                })
                .ok_or_else(|| "configura e verifica la casella e-mail su questo PC".to_string())
                .and_then(|record| {
                    record
                        .data
                        .get("config")
                        .cloned()
                        .ok_or_else(|| "configurazione e-mail incompleta".to_string())
                })
                .and_then(|value| serde_json::from_value(value).map_err(es))
                .and_then(valida)
        })?;
        let credenziale =
            leggi_password_smtp()?.ok_or("inserisci la password della casella su questo PC")?;
        if !credenziale
            .username
            .eq_ignore_ascii_case(&config.smtp_username)
        {
            return Err("la password protetta presente appartiene a un altro nome utente".into());
        }
        Ok((config, credenziale.password))
    }

    pub(super) fn verifica_email_operativa(&self) -> AppResult<()> {
        crate::premium::ensure_access(self)?;
        self.configurazione_email_operativa().map(|_| ())
    }

    pub(super) fn invia_email_operativa(
        &self,
        comunicazione: &ComunicazioneDto,
    ) -> AppResult<InvioEmailOperativa> {
        crate::premium::ensure_access(self)?;
        let (config, password) = self.configurazione_email_operativa()?;
        let allegati = comunicazione
            .allegati
            .iter()
            .map(|allegato| {
                self.documento_cache_leggi(allegato)
                    .map(|dati| (allegato.nome.clone(), allegato.mime.clone(), dati))
            })
            .collect::<AppResult<Vec<_>>>()?;
        let messaggio = crea_messaggio_operativo(&config, comunicazione, allegati)?;
        let raw = messaggio.formatted();
        invia_smtp(&config, &password, &messaggio)?;

        // Dopo l'accettazione SMTP non si ripete mai l'invio. L'eventuale errore
        // IMAP viene restituito come avviso e sincronizzato nello storico.
        let (copia_posta_inviata, avviso) = if config.salva_posta_inviata {
            match archivia_inviata_imap(&config, &password, &raw) {
                Ok(()) => (true, String::new()),
                Err(error) => (
                    false,
                    format!("E-mail inviata; copia in Posta inviata non archiviata: {error}"),
                ),
            }
        } else {
            (false, String::new())
        };
        Ok(InvioEmailOperativa {
            copia_posta_inviata,
            avviso,
        })
    }

    pub fn configurazione_email_get(&self) -> AppResult<ConfigurazioneEmailDto> {
        crate::premium::ensure_access(self)?;
        let credenziale = leggi_password_smtp()?;
        self.with_engine(|engine| {
            let record = engine.with_projection(|projection| {
                projection
                    .get(ENTITA_CONFIGURAZIONE_CANALE, ID_CONFIGURAZIONE_EMAIL)
                    .ok()
                    .flatten()
                    .filter(|record| !record.deleted)
            });
            let Some(record) = record else {
                return Ok(dto(
                    ConfigurazioneEmailCondivisa::default(),
                    String::new(),
                    false,
                    0,
                    credenziale.as_ref(),
                    None,
                ));
            };
            let config = record
                .data
                .get("config")
                .cloned()
                .ok_or_else(|| "configurazione e-mail incompleta".to_string())
                .and_then(|value| serde_json::from_value(value).map_err(es))?;
            let aggiornata_ms = record
                .data
                .get("aggiornata_ms")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let ultima_prova = record
                .data
                .get("ultima_prova")
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(es)?;
            Ok(dto(
                config,
                record.updated_hlc.to_string(),
                true,
                aggiornata_ms,
                credenziale.as_ref(),
                ultima_prova,
            ))
        })
    }

    fn configurazione_email_scrivi(
        &self,
        config: ConfigurazioneEmailCondivisa,
        password: Option<String>,
        ultima_prova: Option<ProvaEmailDto>,
    ) -> AppResult<ConfigurazioneEmailDto> {
        let precedente = if password.is_some() {
            leggi_password_smtp()?
        } else {
            None
        };
        if let Some(password) = password.as_deref() {
            salva_password_smtp(&config.smtp_username, password)?;
        }

        let config_json = serde_json::to_value(&config).map_err(es)?;
        let ultima_prova_json = ultima_prova
            .map(serde_json::to_value)
            .transpose()
            .map_err(es)?;
        let result = self.with_engine(|engine| {
            engine
                .emit_built_checked(move |_| {
                    let mut mutations = vec![
                        Mutation::new(
                            ENTITA_CONFIGURAZIONE_CANALE,
                            ID_CONFIGURAZIONE_EMAIL,
                            EventBody::Created,
                        ),
                        Mutation::new(
                            ENTITA_CONFIGURAZIONE_CANALE,
                            ID_CONFIGURAZIONE_EMAIL,
                            EventBody::FieldSet {
                                field: "config".into(),
                                value: config_json,
                            },
                        ),
                        Mutation::new(
                            ENTITA_CONFIGURAZIONE_CANALE,
                            ID_CONFIGURAZIONE_EMAIL,
                            EventBody::FieldSet {
                                field: "aggiornata_ms".into(),
                                value: json!(now_ms()),
                            },
                        ),
                    ];
                    if let Some(value) = ultima_prova_json {
                        mutations.push(Mutation::new(
                            ENTITA_CONFIGURAZIONE_CANALE,
                            ID_CONFIGURAZIONE_EMAIL,
                            EventBody::FieldSet {
                                field: "ultima_prova".into(),
                                value,
                            },
                        ));
                    }
                    Ok(mutations)
                })
                .map_err(es)
        });
        if let Err(error) = result {
            if password.is_some() {
                ripristina_credenziale(precedente);
            }
            return Err(error);
        }
        self.configurazione_email_get()
    }

    pub fn configurazione_email_salva(
        &self,
        input: ConfigurazioneEmailSalvaInput,
    ) -> AppResult<ConfigurazioneEmailDto> {
        crate::premium::ensure_access(self)?;
        let password = input.password.clone().filter(|value| !value.is_empty());
        let config = valida(input.into())?;
        self.configurazione_email_scrivi(config, password, None)
    }

    pub fn configurazione_email_verifica_e_invia_prova(
        &self,
        input: ConfigurazioneEmailSalvaInput,
    ) -> AppResult<ConfigurazioneEmailDto> {
        crate::premium::ensure_access(self)?;
        let _invio_singolo = self.email_test_local.try_lock().map_err(|_| {
            "un'altra finestra sta già verificando la configurazione e-mail".to_string()
        })?;
        let nuova_password = input.password.clone().filter(|value| !value.is_empty());
        let config = valida(input.into())?;
        let password = match nuova_password.as_ref() {
            Some(password) => password.clone(),
            None => {
                let credenziale = leggi_password_smtp()?
                    .ok_or("inserisci la password della casella su questo PC")?;
                if !credenziale
                    .username
                    .eq_ignore_ascii_case(&config.smtp_username)
                {
                    return Err(
                        "la password protetta presente appartiene a un altro nome utente".into(),
                    );
                }
                credenziale.password
            }
        };

        let messaggio = crea_messaggio_prova(&config)?;
        let raw = messaggio.formatted();
        invia_smtp(&config, &password, &messaggio)?;

        // SMTP positivo significa che il server ha accettato il messaggio. Un
        // eventuale errore IMAP non deve mai causare un secondo invio SMTP.
        let (copia_posta_inviata, avviso) = if config.salva_posta_inviata {
            match archivia_inviata_imap(&config, &password, &raw) {
                Ok(()) => (true, String::new()),
                Err(error) => (
                    false,
                    format!("E-mail inviata; copia in Posta inviata non archiviata: {error}"),
                ),
            }
        } else {
            (false, String::new())
        };
        let prova = ProvaEmailDto {
            destinatario: config.destinatario_prova.clone(),
            inviata_ms: now_ms(),
            smtp_accettata: true,
            copia_posta_inviata,
            avviso,
        };
        self.configurazione_email_scrivi(config, nuova_password, Some(prova))
            .map_err(|error| {
                format!(
                    "la prova è stata inviata, ma la configurazione non è stata salvata: {error}"
                )
            })
    }

    pub fn configurazione_email_password_rimuovi(&self) -> AppResult<ConfigurazioneEmailDto> {
        crate::premium::ensure_access(self)?;
        elimina_password_smtp()?;
        self.configurazione_email_get()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::communication::{CanaleComunicazione, ComunicazioneDto, StatoComunicazione};
    use crate::app::FinishOnboarding;
    use std::fs;
    use ulid::Ulid;

    fn stato_test() -> (tempfile::TempDir, tempfile::TempDir, AppState) {
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
                nome: "Tester configurazione".into(),
                avatar_tipo: "iniziali".into(),
                avatar_valore: String::new(),
            })
            .unwrap();
        (app, data, state)
    }

    fn input_default() -> ConfigurazioneEmailSalvaInput {
        let config = ConfigurazioneEmailCondivisa::default();
        ConfigurazioneEmailSalvaInput {
            nome_mittente: config.nome_mittente,
            indirizzo_mittente: config.indirizzo_mittente,
            smtp_host: config.smtp_host,
            smtp_port: config.smtp_port,
            smtp_sicurezza: config.smtp_sicurezza,
            smtp_username: config.smtp_username,
            reply_to_abilitato: config.reply_to_abilitato,
            reply_to: config.reply_to,
            firma: config.firma,
            salva_posta_inviata: config.salva_posta_inviata,
            imap_host: config.imap_host,
            imap_port: config.imap_port,
            imap_sicurezza: config.imap_sicurezza,
            destinatario_prova: config.destinatario_prova,
            password: None,
        }
    }

    #[test]
    fn preset_aruba_e_decisioni_utente_sono_coerenti() {
        let config = ConfigurazioneEmailCondivisa::default();
        assert_eq!(config.indirizzo_mittente, "");
        assert_eq!(config.smtp_host, "smtp.example.invalid");
        assert_eq!(config.smtp_port, 465);
        assert_eq!(config.imap_host, "imap.example.invalid");
        assert_eq!(config.imap_port, 993);
        assert!(config.salva_posta_inviata);
        assert_eq!(config.reply_to, "");
        assert!(!config.reply_to_abilitato);
        assert_eq!(config.destinatario_prova, "");
    }

    #[test]
    fn configurazione_salvata_non_contiene_password() {
        let (_app, _data, state) = stato_test();
        let mut input = input_default();
        input.nome_mittente = "  PharmaTek  ".into();
        let salvata = state.configurazione_email_salva(input).unwrap();
        assert!(salvata.configurata);
        assert_eq!(salvata.nome_mittente, "PharmaTek");

        state
            .with_engine(|engine| {
                let record = engine.with_projection(|projection| {
                    projection
                        .get(ENTITA_CONFIGURAZIONE_CANALE, ID_CONFIGURAZIONE_EMAIL)
                        .unwrap()
                        .unwrap()
                });
                let serializzato = serde_json::to_string(&record.data).unwrap();
                assert!(!serializzato.to_lowercase().contains("password"));
                assert!(!serializzato.contains("segreto-di-prova"));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn reply_to_disabilitato_resta_proposto_ma_non_obbligatorio() {
        let mut config = ConfigurazioneEmailCondivisa::default();
        config.reply_to.clear();
        assert!(valida(config).is_ok());

        let config = ConfigurazioneEmailCondivisa {
            reply_to_abilitato: true,
            reply_to: "non-valido".into(),
            ..ConfigurazioneEmailCondivisa::default()
        };
        assert!(valida(config).is_err());
    }

    #[test]
    fn email_operativa_con_pdf_usa_mime_multipart_senza_perdere_il_corpo() {
        let comunicazione = ComunicazioneDto {
            id: "com-test".into(),
            revision: "1".into(),
            stato: StatoComunicazione::InCoda,
            canale: CanaleComunicazione::Email,
            destinatario_entita: "cliente".into(),
            destinatario_id: "cliente-1".into(),
            recapito: "".into(),
            oggetto: "Preventivo P-1".into(),
            corpo: "In allegato trova il preventivo.".into(),
            modello_id: String::new(),
            modello_versione_id: String::new(),
            modello_versione: 0,
            origine_entita: "preventivo".into(),
            origine_id: "preventivo/ordine-1".into(),
            origine_fingerprint: "abc".into(),
            origini_correlate: Vec::new(),
            tipo_modello: "preventivo".into(),
            campagna_id: String::new(),
            reinvio_di: String::new(),
            allegati: Vec::new(),
            tentativi: 0,
            ultimo_errore: String::new(),
            errore_codice: String::new(),
            errore_fase: String::new(),
            esito_ambiguo: false,
            proprietario_utente_id: "utente-1".into(),
            proprietario_utente_nome: "Tester".into(),
            proprietario_dispositivo_id: "pc-1".into(),
            proprietario_dispositivo_nome: "PC".into(),
            inviata_ms: 0,
            riferimento_esterno: String::new(),
            copia_posta_inviata: false,
            creata_ms: 1,
            stato_aggiornato_ms: 1,
        };
        let messaggio = crea_messaggio_operativo(
            &ConfigurazioneEmailCondivisa::default(),
            &comunicazione,
            vec![(
                "Preventivo P-1.pdf".into(),
                "application/pdf".into(),
                b"%PDF-1.4\n%%EOF".to_vec(),
            )],
        )
        .unwrap();
        let raw = String::from_utf8_lossy(&messaggio.formatted()).to_string();
        assert!(raw.contains("multipart/mixed"));
        assert!(raw.contains("application/pdf"));
        assert!(raw.contains("Preventivo P-1.pdf"));
        assert!(raw.contains("In allegato trova il preventivo."));
    }
}
