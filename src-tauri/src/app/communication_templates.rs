//! Modelli condivisi e versionati delle comunicazioni.
//!
//! Ogni modello contiene un solo corpo, valido sia per e-mail sia per WhatsApp.
//! L'oggetto viene usato esclusivamente quando il canale scelto è e-mail.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ulid::Ulid;

use super::communication::sha256_hex;
use super::{es, now_ms, AppResult, AppState, EventBody, Mutation};

const ENTITA_MODELLO: &str = "modello_comunicazione";
const ENTITA_VERSIONE: &str = "modello_comunicazione_versione";
const SCHEMA_UNIFICATO: u8 = 2;
const MAX_TITOLO_CHARS: usize = 120;
const MAX_OGGETTO_CHARS: usize = 300;
const MAX_CORPO_BYTES: usize = 100_000;
const PREVENTIVO_OGGETTO_BASE: &str = "Preventivo {{numero_preventivo}}";
const PREVENTIVO_CORPO_BASE_LEGACY: &str = "Gentile {{nome_cliente}},\nLe inviamo il preventivo {{numero_preventivo}} relativo a {{riferimento_ordine}} e le condizioni generali di vendita.\nRestiamo in attesa della Sua conferma e dei dati di fatturazione e consegna.\nGrazie.\nPharmaTek";
const PREVENTIVO_CORPO_BASE: &str = "Gentile cliente,\nLe alleghiamo il preventivo del Suo ordine. Le condizioni di vendita sono specificate nel preventivo.\nResteremo in attesa della Sua conferma; inoltre, Le chiediamo gentilmente di confermarci i dati di fatturazione (nome, cognome, codice fiscale), l’indirizzo di consegna, la Sua modalità di pagamento e, facoltativamente, il Suo indirizzo e-mail.\nGrazie.\nPharmaTek";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TipoModelloComunicazione {
    Preventivo,
    SollecitoPreventivo,
    SollecitoPagamento,
    PreavvisoSpedizione,
}

impl TipoModelloComunicazione {
    fn as_str(self) -> &'static str {
        match self {
            Self::Preventivo => "preventivo",
            Self::SollecitoPreventivo => "sollecito_preventivo",
            Self::SollecitoPagamento => "sollecito_pagamento",
            Self::PreavvisoSpedizione => "preavviso_spedizione",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Preventivo => "Invio preventivo",
            Self::SollecitoPreventivo => "Sollecito preventivo",
            Self::SollecitoPagamento => "Sollecito pagamento",
            Self::PreavvisoSpedizione => "Preavviso spedizione",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariabileModelloDto {
    pub chiave: String,
    pub etichetta: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelloPayload {
    #[serde(default = "schema_legacy")]
    schema_version: u8,
    modello_id: String,
    versione_id: String,
    versione: u64,
    tipo: TipoModelloComunicazione,
    titolo: String,
    oggetto: String,
    corpo: String,
    attivo: bool,
    #[serde(default)]
    predefinito: bool,
    variabili_usate: Vec<String>,
    fingerprint: String,
    aggiornato_ms: u64,
    aggiornato_da_utente: String,
    aggiornato_da_dispositivo: String,
}

fn schema_legacy() -> u8 {
    1
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelloComunicazioneSalvaInput {
    #[serde(default)]
    pub id: String,
    pub tipo: TipoModelloComunicazione,
    pub titolo: String,
    #[serde(default)]
    pub oggetto: String,
    pub corpo: String,
    #[serde(default = "default_true")]
    pub attivo: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelloComunicazioneDto {
    pub id: String,
    pub revision: String,
    pub versione_id: String,
    pub versione: u64,
    pub tipo: TipoModelloComunicazione,
    pub tipo_label: String,
    pub titolo: String,
    pub oggetto: String,
    pub corpo: String,
    pub attivo: bool,
    pub predefinito: bool,
    pub variabili_usate: Vec<String>,
    pub variabili_disponibili: Vec<VariabileModelloDto>,
    pub aggiornato_ms: u64,
    pub aggiornato_da_utente: String,
    pub aggiornato_da_dispositivo: String,
}

fn modello_base_id(tipo: TipoModelloComunicazione) -> String {
    format!("{}-base-v2", tipo.as_str())
}

fn catalogo_variabili(tipo: TipoModelloComunicazione) -> BTreeMap<&'static str, &'static str> {
    let mut catalogo = BTreeMap::from([
        ("nome_cliente", "Nome cliente"),
        ("ragione_sociale", "Ragione sociale"),
        ("nome_medico", "Nome medico"),
        ("nome_agente", "Nome agente"),
        ("riferimento_ordine", "Riferimento ordine"),
    ]);
    match tipo {
        TipoModelloComunicazione::Preventivo | TipoModelloComunicazione::SollecitoPreventivo => {
            catalogo.extend([
                ("numero_preventivo", "Numero preventivo"),
                ("data_preventivo", "Data preventivo"),
                ("totale_preventivo", "Totale preventivo"),
            ]);
        }
        TipoModelloComunicazione::SollecitoPagamento => {
            catalogo.extend([
                ("totale_scaduto", "Totale scaduto"),
                ("dettaglio_rate", "Dettaglio rate"),
                ("istruzioni_pagamento", "Istruzioni di pagamento"),
                ("iban", "IBAN"),
                ("modalita_pagamento", "Modalità di pagamento"),
            ]);
        }
        TipoModelloComunicazione::PreavvisoSpedizione => {
            catalogo.extend([
                ("data_spedizione", "Data spedizione"),
                ("corriere", "Corriere"),
                ("tracking", "Codice di tracciamento"),
                ("importo_residuo", "Importo residuo"),
                ("istruzioni_pagamento", "Istruzioni di pagamento"),
                ("iban", "IBAN"),
                ("modalita_pagamento", "Modalità di pagamento"),
            ]);
        }
    }
    catalogo
}

fn estrai_variabili(testo: &str) -> AppResult<BTreeSet<String>> {
    let mut risultato = BTreeSet::new();
    let mut offset = 0;
    while offset < testo.len() {
        let restante = &testo[offset..];
        let apertura = restante.find("{{");
        let chiusura = restante.find("}}");
        match (apertura, chiusura) {
            (None, None) => break,
            (None, Some(_)) => return Err("segnaposto chiuso senza apertura".into()),
            (Some(apertura), Some(chiusura)) if chiusura < apertura => {
                return Err("segnaposto chiuso senza apertura".into())
            }
            (Some(apertura), _) => {
                let inizio = offset + apertura + 2;
                let coda = &testo[inizio..];
                let fine_relativa = coda
                    .find("}}")
                    .ok_or("segnaposto non chiuso: aggiungi }}")?;
                let fine = inizio + fine_relativa;
                let chiave = testo[inizio..fine].trim();
                if chiave.is_empty()
                    || chiave.contains("{{")
                    || !chiave
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
                {
                    return Err("segnaposto non valido: usa {{nome_variabile}}".into());
                }
                risultato.insert(chiave.to_string());
                offset = fine + 2;
            }
        }
    }
    Ok(risultato)
}

fn valida_input(
    mut input: ModelloComunicazioneSalvaInput,
) -> AppResult<(ModelloComunicazioneSalvaInput, Vec<String>, String)> {
    input.id = input.id.trim().to_string();
    input.titolo = input.titolo.trim().to_string();
    input.oggetto = input.oggetto.trim().to_string();
    if input.titolo.is_empty() || input.titolo.chars().count() > MAX_TITOLO_CHARS {
        return Err("nome del modello mancante o troppo lungo".into());
    }
    if input.oggetto.is_empty() || input.oggetto.chars().count() > MAX_OGGETTO_CHARS {
        return Err("oggetto del modello mancante o troppo lungo".into());
    }
    if input.corpo.trim().is_empty() || input.corpo.len() > MAX_CORPO_BYTES {
        return Err("testo del modello mancante o troppo lungo".into());
    }

    let mut usate = estrai_variabili(&input.oggetto)?;
    usate.extend(estrai_variabili(&input.corpo)?);
    let disponibili = catalogo_variabili(input.tipo);
    if let Some(sconosciuta) = usate
        .iter()
        .find(|chiave| !disponibili.contains_key(chiave.as_str()))
    {
        return Err(format!(
            "la variabile «{sconosciuta}» non è disponibile per questo modello"
        ));
    }
    let usate = usate.into_iter().collect::<Vec<_>>();
    let contenuto = json!({
        "schema_version": SCHEMA_UNIFICATO,
        "tipo": input.tipo,
        "titolo": input.titolo,
        "oggetto": input.oggetto,
        "corpo": input.corpo,
        "attivo": input.attivo,
        "variabili_usate": usate,
    });
    let fingerprint = sha256_hex(serde_json::to_vec(&contenuto).map_err(es)?);
    Ok((input, usate, fingerprint))
}

fn payload_to_dto(payload: ModelloPayload, revision: String) -> ModelloComunicazioneDto {
    let variabili_disponibili = catalogo_variabili(payload.tipo)
        .into_iter()
        .map(|(chiave, etichetta)| VariabileModelloDto {
            chiave: chiave.into(),
            etichetta: etichetta.into(),
        })
        .collect();
    ModelloComunicazioneDto {
        id: payload.modello_id,
        revision,
        versione_id: payload.versione_id,
        versione: payload.versione,
        tipo: payload.tipo,
        tipo_label: payload.tipo.label().into(),
        titolo: payload.titolo,
        oggetto: payload.oggetto,
        corpo: payload.corpo,
        attivo: payload.attivo,
        predefinito: payload.predefinito,
        variabili_usate: payload.variabili_usate,
        variabili_disponibili,
        aggiornato_ms: payload.aggiornato_ms,
        aggiornato_da_utente: payload.aggiornato_da_utente,
        aggiornato_da_dispositivo: payload.aggiornato_da_dispositivo,
    }
}

fn payload_da_record(
    record: crate::projection::Record,
    campo: &str,
) -> AppResult<(u8, ModelloComunicazioneDto)> {
    let payload: ModelloPayload = record
        .data
        .get(campo)
        .cloned()
        .ok_or_else(|| "contenuto del modello mancante".to_string())
        .and_then(|value| serde_json::from_value(value).map_err(es))?;
    Ok((
        payload.schema_version,
        payload_to_dto(payload, record.updated_hlc.to_string()),
    ))
}

struct DefaultTemplate {
    tipo: TipoModelloComunicazione,
    oggetto: &'static str,
    corpo: &'static str,
}

fn defaults() -> Vec<DefaultTemplate> {
    use TipoModelloComunicazione::{
        PreavvisoSpedizione, Preventivo, SollecitoPagamento, SollecitoPreventivo,
    };
    vec![
        DefaultTemplate {
            tipo: Preventivo,
            oggetto: PREVENTIVO_OGGETTO_BASE,
            corpo: PREVENTIVO_CORPO_BASE,
        },
        DefaultTemplate {
            tipo: SollecitoPreventivo,
            oggetto: "Promemoria preventivo {{numero_preventivo}}",
            corpo: "Gentile {{nome_cliente}},\nrestiamo in attesa della Sua conferma del preventivo {{numero_preventivo}}. Nella conferma Le chiediamo gentilmente di comunicarci i dati di fatturazione e l'indirizzo di consegna.\nGrazie.\nPharmaTek",
        },
        DefaultTemplate {
            tipo: SollecitoPagamento,
            oggetto: "Promemoria pagamento ordine {{riferimento_ordine}}",
            corpo: "Gentile {{nome_cliente}},\ndai nostri sistemi risulta ancora da saldare {{totale_scaduto}} per {{riferimento_ordine}}.\n{{dettaglio_rate}}\n{{istruzioni_pagamento}}\nRestiamo in attesa di un Suo gentile riscontro.\nPharmaTek",
        },
        DefaultTemplate {
            tipo: PreavvisoSpedizione,
            oggetto: "Spedizione ordine {{riferimento_ordine}}",
            corpo: "Gentile {{nome_cliente}},\nil Suo ordine {{riferimento_ordine}} sarà affidato al corriere {{corriere}} il {{data_spedizione}}.\nTempi e tracciamento: {{tracking}}.\nImporto residuo: {{importo_residuo}}.\n{{istruzioni_pagamento}}\nDistinti saluti,\nPharmaTek",
        },
    ]
}

impl AppState {
    pub(super) fn seed_modelli_comunicazione(&self) {
        if !crate::premium::is_enabled(&self.app_dir) {
            return;
        }
        let config = self.config();
        let legacy_preventivo_fingerprint = valida_input(ModelloComunicazioneSalvaInput {
            id: modello_base_id(TipoModelloComunicazione::Preventivo),
            tipo: TipoModelloComunicazione::Preventivo,
            titolo: TipoModelloComunicazione::Preventivo.label().into(),
            oggetto: PREVENTIVO_OGGETTO_BASE.into(),
            corpo: PREVENTIVO_CORPO_BASE_LEGACY.into(),
            attivo: true,
        })
        .map(|(_, _, fingerprint)| fingerprint)
        .unwrap_or_default();
        let defaults = defaults()
            .into_iter()
            .filter_map(|default| {
                let id = modello_base_id(default.tipo);
                let input = ModelloComunicazioneSalvaInput {
                    id,
                    tipo: default.tipo,
                    titolo: default.tipo.label().into(),
                    oggetto: default.oggetto.into(),
                    corpo: default.corpo.into(),
                    attivo: true,
                };
                valida_input(input).ok()
            })
            .collect::<Vec<_>>();
        let _ = self.with_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    let mut mutations = Vec::new();
                    for (input, variabili_usate, fingerprint) in defaults {
                        let id = input.id.clone();
                        let esistente = projection
                            .get(ENTITA_MODELLO, &id)
                            .map_err(|error| error.to_string())?
                            .filter(|record| !record.deleted);
                        if let Some(record) = esistente {
                            let corrente = record.data.get("corrente").cloned().and_then(|value| {
                                serde_json::from_value::<ModelloPayload>(value).ok()
                            });
                            let versione_seed_v1 = format!("mv-{id}-seed-v1");
                            let migra_preventivo_legacy = input.tipo
                                == TipoModelloComunicazione::Preventivo
                                && corrente.as_ref().is_some_and(|payload| {
                                    payload.predefinito
                                        && payload.versione == 1
                                        && payload.versione_id == versione_seed_v1
                                        && payload.fingerprint == legacy_preventivo_fingerprint
                                });
                            if migra_preventivo_legacy {
                                let versione_id = format!("mv-{id}-seed-v2");
                                let payload = ModelloPayload {
                                    schema_version: SCHEMA_UNIFICATO,
                                    modello_id: id.clone(),
                                    versione_id: versione_id.clone(),
                                    versione: 2,
                                    tipo: input.tipo,
                                    titolo: input.titolo,
                                    oggetto: input.oggetto,
                                    corpo: input.corpo,
                                    attivo: input.attivo,
                                    predefinito: true,
                                    variabili_usate,
                                    fingerprint,
                                    aggiornato_ms: 0,
                                    aggiornato_da_utente: "sistema".into(),
                                    aggiornato_da_dispositivo: "sistema".into(),
                                };
                                let value = serde_json::to_value(&payload).map_err(es)?;
                                mutations.extend([
                                    Mutation::new(
                                        ENTITA_VERSIONE,
                                        &versione_id,
                                        EventBody::Created,
                                    ),
                                    Mutation::new(
                                        ENTITA_VERSIONE,
                                        &versione_id,
                                        EventBody::FieldSet {
                                            field: "payload".into(),
                                            value: value.clone(),
                                        },
                                    ),
                                    Mutation::new(ENTITA_MODELLO, &id, EventBody::Created),
                                    Mutation::new(
                                        ENTITA_MODELLO,
                                        &id,
                                        EventBody::FieldSet {
                                            field: "corrente".into(),
                                            value,
                                        },
                                    ),
                                ]);
                            }
                            continue;
                        }
                        let versione_id = format!("mv-{id}-seed-v1");
                        let payload = ModelloPayload {
                            schema_version: SCHEMA_UNIFICATO,
                            modello_id: id.clone(),
                            versione_id: versione_id.clone(),
                            versione: 1,
                            tipo: input.tipo,
                            titolo: input.titolo,
                            oggetto: input.oggetto,
                            corpo: input.corpo,
                            attivo: input.attivo,
                            predefinito: true,
                            variabili_usate,
                            fingerprint,
                            aggiornato_ms: 0,
                            aggiornato_da_utente: "sistema".into(),
                            aggiornato_da_dispositivo: config.device_id.clone(),
                        };
                        let value = serde_json::to_value(&payload).map_err(es)?;
                        mutations.extend([
                            Mutation::new(ENTITA_VERSIONE, &versione_id, EventBody::Created),
                            Mutation::new(
                                ENTITA_VERSIONE,
                                &versione_id,
                                EventBody::FieldSet {
                                    field: "payload".into(),
                                    value: value.clone(),
                                },
                            ),
                            Mutation::new(ENTITA_MODELLO, &id, EventBody::Created),
                            Mutation::new(
                                ENTITA_MODELLO,
                                &id,
                                EventBody::FieldSet {
                                    field: "corrente".into(),
                                    value,
                                },
                            ),
                        ]);
                    }
                    Ok(mutations)
                })
                .map_err(es)
        });
    }

    pub fn modelli_comunicazione_lista(&self) -> AppResult<Vec<ModelloComunicazioneDto>> {
        crate::premium::ensure_access(self)?;
        self.seed_modelli_comunicazione();
        self.with_engine(|engine| {
            let mut modelli = engine
                .with_projection(|projection| projection.list(ENTITA_MODELLO).unwrap_or_default())
                .into_iter()
                .filter_map(|record| match payload_da_record(record, "corrente") {
                    Ok((schema, modello)) if schema >= SCHEMA_UNIFICATO => Some(Ok(modello)),
                    Ok(_) => None,
                    Err(error) => Some(Err(error)),
                })
                .collect::<AppResult<Vec<_>>>()?;
            modelli.sort_by(|a, b| {
                (a.tipo, !a.predefinito, a.titolo.to_lowercase()).cmp(&(
                    b.tipo,
                    !b.predefinito,
                    b.titolo.to_lowercase(),
                ))
            });
            Ok(modelli)
        })
    }

    pub fn modello_comunicazione_salva(
        &self,
        input: ModelloComunicazioneSalvaInput,
    ) -> AppResult<ModelloComunicazioneDto> {
        crate::premium::ensure_access(self)?;
        let (mut input, variabili_usate, fingerprint) = valida_input(input)?;
        let nuovo = input.id.is_empty();
        if nuovo {
            input.id = format!("modello-{}", Ulid::generate());
        }
        let id = input.id.clone();
        let version_id_candidate = format!("mv-{id}-{}", Ulid::generate());
        let identity = self.config();
        let id_closure = id.clone();
        self.with_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    let corrente = projection
                        .get(ENTITA_MODELLO, &id_closure)
                        .map_err(|error| error.to_string())?
                        .filter(|record| !record.deleted);
                    if !nuovo && corrente.is_none() {
                        return Err("modello non trovato".into());
                    }
                    if nuovo && corrente.is_some() {
                        return Err("identificativo del modello già in uso".into());
                    }
                    let corrente_payload = corrente
                        .as_ref()
                        .and_then(|record| record.data.get("corrente"))
                        .cloned()
                        .map(serde_json::from_value::<ModelloPayload>)
                        .transpose()
                        .map_err(es)?;
                    if corrente_payload
                        .as_ref()
                        .is_some_and(|payload| payload.schema_version < SCHEMA_UNIFICATO)
                    {
                        return Err("questo modello appartiene a una versione precedente".into());
                    }
                    if corrente_payload
                        .as_ref()
                        .is_some_and(|payload| payload.predefinito && payload.tipo != input.tipo)
                    {
                        return Err(
                            "il tipo di un modello predefinito non può essere cambiato".into()
                        );
                    }
                    if corrente_payload
                        .as_ref()
                        .is_some_and(|payload| payload.fingerprint == fingerprint)
                    {
                        return Ok(Vec::new());
                    }
                    let versione = corrente_payload
                        .as_ref()
                        .map(|payload| payload.versione.saturating_add(1))
                        .unwrap_or(1);
                    let predefinito = corrente_payload
                        .as_ref()
                        .is_some_and(|payload| payload.predefinito);
                    let payload = ModelloPayload {
                        schema_version: SCHEMA_UNIFICATO,
                        modello_id: id_closure.clone(),
                        versione_id: version_id_candidate.clone(),
                        versione,
                        tipo: input.tipo,
                        titolo: input.titolo,
                        oggetto: input.oggetto,
                        corpo: input.corpo,
                        attivo: input.attivo,
                        predefinito,
                        variabili_usate,
                        fingerprint,
                        aggiornato_ms: now_ms(),
                        aggiornato_da_utente: identity.user_id.clone().unwrap_or_default(),
                        aggiornato_da_dispositivo: identity.device_id.clone(),
                    };
                    let value = serde_json::to_value(payload).map_err(es)?;
                    Ok(vec![
                        Mutation::new(ENTITA_VERSIONE, &version_id_candidate, EventBody::Created),
                        Mutation::new(
                            ENTITA_VERSIONE,
                            &version_id_candidate,
                            EventBody::FieldSet {
                                field: "payload".into(),
                                value: value.clone(),
                            },
                        ),
                        Mutation::new(ENTITA_MODELLO, &id_closure, EventBody::Created),
                        Mutation::new(
                            ENTITA_MODELLO,
                            &id_closure,
                            EventBody::FieldSet {
                                field: "corrente".into(),
                                value,
                            },
                        ),
                    ])
                })
                .map_err(es)?;
            engine
                .with_projection(|projection| projection.get(ENTITA_MODELLO, &id).ok().flatten())
                .ok_or_else(|| "modello non trovato dopo il salvataggio".to_string())
                .and_then(|record| payload_da_record(record, "corrente").map(|(_, dto)| dto))
        })
    }

    pub fn modello_comunicazione_elimina(&self, id: &str) -> AppResult<()> {
        crate::premium::ensure_access(self)?;
        let id = id.trim();
        if id.is_empty() {
            return Err("modello mancante".into());
        }
        self.with_engine(|engine| {
            engine
                .emit_built_checked(|projection| {
                    let record = projection
                        .get(ENTITA_MODELLO, id)
                        .map_err(|error| error.to_string())?
                        .filter(|record| !record.deleted)
                        .ok_or_else(|| "modello non trovato".to_string())?;
                    let (schema, modello) = payload_da_record(record, "corrente")?;
                    if schema < SCHEMA_UNIFICATO {
                        return Err("questo modello appartiene a una versione precedente".into());
                    }
                    if modello.predefinito {
                        return Err("i modelli predefiniti non possono essere eliminati".into());
                    }
                    Ok(vec![Mutation::new(ENTITA_MODELLO, id, EventBody::Deleted)])
                })
                .map_err(es)?;
            Ok(())
        })
    }

    pub fn modello_comunicazione_storico(
        &self,
        id: &str,
    ) -> AppResult<Vec<ModelloComunicazioneDto>> {
        crate::premium::ensure_access(self)?;
        self.with_engine(|engine| {
            let mut versioni = engine
                .with_projection(|projection| projection.list(ENTITA_VERSIONE).unwrap_or_default())
                .into_iter()
                .filter_map(|record| {
                    let appartiene = record
                        .data
                        .get("payload")
                        .and_then(Value::as_object)
                        .and_then(|payload| payload.get("modelloId"))
                        .and_then(Value::as_str)
                        == Some(id);
                    appartiene.then(|| payload_da_record(record, "payload"))
                })
                .filter_map(|result| match result {
                    Ok((schema, dto)) if schema >= SCHEMA_UNIFICATO => Some(Ok(dto)),
                    Ok(_) => None,
                    Err(error) => Some(Err(error)),
                })
                .collect::<AppResult<Vec<_>>>()?;
            versioni.sort_by(|a, b| {
                b.versione
                    .cmp(&a.versione)
                    .then_with(|| b.aggiornato_ms.cmp(&a.aggiornato_ms))
                    .then_with(|| b.versione_id.cmp(&a.versione_id))
            });
            Ok(versioni)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::FinishOnboarding;
    use std::fs;

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
                nome: "Tester modelli".into(),
                avatar_tipo: "iniziali".into(),
                avatar_valore: String::new(),
            })
            .unwrap();
        (app, data, state)
    }

    fn pagamento(id: &str, corpo: &str) -> ModelloComunicazioneSalvaInput {
        ModelloComunicazioneSalvaInput {
            id: id.into(),
            tipo: TipoModelloComunicazione::SollecitoPagamento,
            titolo: "Sollecito personale".into(),
            oggetto: "Pagamento {{riferimento_ordine}}".into(),
            corpo: corpo.into(),
            attivo: true,
        }
    }

    fn imposta_preventivo_seed_legacy(state: &AppState) {
        let id = modello_base_id(TipoModelloComunicazione::Preventivo);
        let (input, variabili_usate, fingerprint) = valida_input(ModelloComunicazioneSalvaInput {
            id: id.clone(),
            tipo: TipoModelloComunicazione::Preventivo,
            titolo: TipoModelloComunicazione::Preventivo.label().into(),
            oggetto: PREVENTIVO_OGGETTO_BASE.into(),
            corpo: PREVENTIVO_CORPO_BASE_LEGACY.into(),
            attivo: true,
        })
        .unwrap();
        let payload = ModelloPayload {
            schema_version: SCHEMA_UNIFICATO,
            modello_id: id.clone(),
            versione_id: format!("mv-{id}-seed-v1"),
            versione: 1,
            tipo: input.tipo,
            titolo: input.titolo,
            oggetto: input.oggetto,
            corpo: input.corpo,
            attivo: input.attivo,
            predefinito: true,
            variabili_usate,
            fingerprint,
            aggiornato_ms: 0,
            aggiornato_da_utente: "sistema".into(),
            aggiornato_da_dispositivo: "legacy".into(),
        };
        let value = serde_json::to_value(payload).unwrap();
        state
            .with_engine(|engine| {
                engine
                    .emit_built_checked(move |_| {
                        Ok(vec![Mutation::new(
                            ENTITA_MODELLO,
                            &id,
                            EventBody::FieldSet {
                                field: "corrente".into(),
                                value,
                            },
                        )])
                    })
                    .map_err(es)
            })
            .unwrap();
    }

    #[test]
    fn parser_accetta_variabili_note_e_rifiuta_errori() {
        let (_, usate, _) = valida_input(pagamento(
            "",
            "Gentile {{ nome_cliente }}, residuo {{totale_scaduto}}.",
        ))
        .unwrap();
        assert_eq!(
            usate,
            vec!["nome_cliente", "riferimento_ordine", "totale_scaduto"]
        );
        assert!(valida_input(pagamento("", "Valore {{sconosciuta}}")).is_err());
        assert!(valida_input(pagamento("", "Valore {{nome_cliente")).is_err());
        assert!(valida_input(pagamento("", "Valore }}")).is_err());
    }

    #[test]
    fn seed_crea_quattro_modelli_unificati() {
        let (_app, _data, state) = stato_test();
        let modelli = state.modelli_comunicazione_lista().unwrap();
        assert_eq!(modelli.len(), 4);
        assert!(modelli.iter().all(|modello| modello.versione == 1));
        assert!(modelli.iter().all(|modello| modello.predefinito));
        assert!(modelli
            .iter()
            .all(|modello| modello.versione_id.ends_with("-seed-v1")));
        assert!(state.records_list(ENTITA_MODELLO).is_err());
        assert!(state.records_list(ENTITA_VERSIONE).is_err());
    }

    #[test]
    fn seed_aggiorna_solo_il_preventivo_base_legacy_ed_e_idempotente() {
        let (_app, _data, state) = stato_test();
        imposta_preventivo_seed_legacy(&state);

        let aggiornato = state
            .modelli_comunicazione_lista()
            .unwrap()
            .into_iter()
            .find(|modello| modello.tipo == TipoModelloComunicazione::Preventivo)
            .unwrap();
        assert_eq!(aggiornato.corpo, PREVENTIVO_CORPO_BASE);
        assert_eq!(aggiornato.versione, 2);
        assert!(aggiornato.versione_id.ends_with("-seed-v2"));

        let ancora = state
            .modelli_comunicazione_lista()
            .unwrap()
            .into_iter()
            .find(|modello| modello.tipo == TipoModelloComunicazione::Preventivo)
            .unwrap();
        assert_eq!(ancora.versione_id, aggiornato.versione_id);
        assert_eq!(
            state
                .modello_comunicazione_storico(&aggiornato.id)
                .unwrap()
                .into_iter()
                .filter(|versione| versione.versione == 2)
                .count(),
            1
        );
    }

    #[test]
    fn seed_preserva_il_preventivo_base_personalizzato() {
        let (_app, _data, state) = stato_test();
        let iniziale = state
            .modelli_comunicazione_lista()
            .unwrap()
            .into_iter()
            .find(|modello| modello.tipo == TipoModelloComunicazione::Preventivo)
            .unwrap();
        let personalizzato = state
            .modello_comunicazione_salva(ModelloComunicazioneSalvaInput {
                id: iniziale.id,
                tipo: TipoModelloComunicazione::Preventivo,
                titolo: "Invio preventivo personalizzato".into(),
                oggetto: "Offerta {{numero_preventivo}}".into(),
                corpo: "Testo scelto dall’utente per {{nome_cliente}}.".into(),
                attivo: true,
            })
            .unwrap();

        state.seed_modelli_comunicazione();
        let dopo = state
            .modelli_comunicazione_lista()
            .unwrap()
            .into_iter()
            .find(|modello| modello.id == personalizzato.id)
            .unwrap();
        assert_eq!(dopo.versione_id, personalizzato.versione_id);
        assert_eq!(dopo.corpo, personalizzato.corpo);
    }

    #[test]
    fn modifica_versiona_e_modello_personale_si_puo_eliminare() {
        let (_app, _data, state) = stato_test();
        let iniziale = state
            .modelli_comunicazione_lista()
            .unwrap()
            .into_iter()
            .find(|modello| modello.tipo == TipoModelloComunicazione::SollecitoPagamento)
            .unwrap();
        let identico = ModelloComunicazioneSalvaInput {
            id: iniziale.id.clone(),
            tipo: iniziale.tipo,
            titolo: iniziale.titolo.clone(),
            oggetto: iniziale.oggetto.clone(),
            corpo: iniziale.corpo.clone(),
            attivo: iniziale.attivo,
        };
        let ancora = state.modello_comunicazione_salva(identico).unwrap();
        assert_eq!(ancora.versione_id, iniziale.versione_id);

        let aggiornata = state
            .modello_comunicazione_salva(pagamento(
                &iniziale.id,
                "Gentile {{nome_cliente}}, totale scaduto: {{totale_scaduto}}.",
            ))
            .unwrap();
        assert_eq!(aggiornata.versione, 2);
        assert_eq!(
            state
                .modello_comunicazione_storico(&aggiornata.id)
                .unwrap()
                .len(),
            2
        );
        assert!(state.modello_comunicazione_elimina(&aggiornata.id).is_err());

        let personale = state
            .modello_comunicazione_salva(pagamento(
                "",
                "Gentile {{nome_cliente}}, {{istruzioni_pagamento}}.",
            ))
            .unwrap();
        assert!(!personale.predefinito);
        state.modello_comunicazione_elimina(&personale.id).unwrap();
        assert!(!state
            .modelli_comunicazione_lista()
            .unwrap()
            .iter()
            .any(|modello| modello.id == personale.id));
    }
}
