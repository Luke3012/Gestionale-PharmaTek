//! Stato applicativo, identità e onboarding (collante fra la finestra e il motore).
//!
//! Decisione di FASE 1B: **utenti e dispositivi sono entità nel log eventi** (non
//! file `meta/*.json` riscritti a ogni avvio). Così l'identità si fonde con lo
//! stesso motore conflict-free di [`crate::sync`] e la "ultima attività per
//! dispositivo" si deriva gratis dagli eventi (niente polling). Le **foto avatar**
//! restano file binari in `meta/avatars/<userId>.png` (sincronizzati da OneDrive),
//! referenziati dagli eventi solo per nome.
//!
//! - `config.json` (in `%APPDATA%`, locale al PC): `device_id`, `data_dir`, `user_id`.
//! - Proiezione SQLite: `%APPDATA%/projection.sqlite` (fuori da OneDrive).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use notify::RecommendedWatcher;
use serde::{Deserialize, Serialize};
use serde_json::json;
use ulid::Ulid;

#[cfg(not(test))]
use crate::data_events::emetti_entita_modificate;
use crate::pricing::{Contesto, RegolaPrezzo};
use crate::restore_support::checksum_file;
use crate::sync::event::EventBody;
use crate::sync::generation::GenerationBarrier;
use crate::sync::log::LogStore;
use crate::sync::snapshot::SnapshotStore;
use crate::sync::{Engine, Mutation, SyncError};

mod accounting;
mod bollettazione;
mod cleanup;
pub(crate) mod communication;
pub(crate) mod communication_config;
mod communication_credentials;
pub(crate) mod communication_templates;
mod dto;
mod lifecycle;
mod operation_lock;
mod order_save;
pub(crate) mod preventivi;
mod production;
mod reports;
mod restore_coordination;
mod runtime_activity;
mod seed_catalog;
mod seeds;
mod shipping;
pub(crate) mod suggestions;
#[cfg(target_os = "windows")]
mod whatsapp_windows;

#[allow(unused_imports)]
pub use bollettazione::*;
pub use dto::*;
use restore_coordination::{
    leggi_restore_acks, pulisci_restore_coordination_vecchia, rimuovi_restore_coordination,
    scrivi_compaction_manifest, scrivi_restore_ack, scrivi_restore_anchor, scrivi_restore_cancel,
    scrivi_restore_manifest, scrivi_restore_prepare,
};
use seed_catalog::*;

#[cfg(not(test))]
type NativeAppHandle = tauri::AppHandle;
#[cfg(test)]
type NativeAppHandle = ();

#[cfg(not(test))]
fn clone_native_app_handle(handle: &Option<NativeAppHandle>) -> Option<NativeAppHandle> {
    handle.clone()
}

#[cfg(test)]
fn clone_native_app_handle(handle: &Option<NativeAppHandle>) -> Option<NativeAppHandle> {
    *handle
}

/// Configurazione locale del PC (mai dentro OneDrive).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppConfig {
    pub device_id: String,
    #[serde(default)]
    pub data_dir: Option<String>,
    #[serde(default)]
    pub user_id: Option<String>,
}

/// Motore attivo + watcher (tenuto vivo finché l'app è aperta).
///
/// **Ordine dei campi = ordine di drop**: prima il `_watcher` (ferma il thread del
/// file-watch, così non parte nessun altro `ingest`), poi l'`engine` (rilascia la
/// connessione SQLite). Invertendoli, una connessione potrebbe restare viva durante
/// un reset/riapertura e causare "database is locked".
pub struct Runtime {
    _watcher: RecommendedWatcher,
    pub engine: Arc<Engine>,
}

/// Risveglio event-driven dell'outbox locale. Il contatore evita di perdere un
/// segnale arrivato tra l'ultimo controllo della coda e l'attesa sul condvar.
#[derive(Default)]
struct CommunicationWake {
    generation: Mutex<u64>,
    changed: Condvar,
}

impl CommunicationWake {
    fn token(&self) -> u64 {
        *self.generation.lock().expect("communication wake poisoned")
    }

    fn signal(&self) {
        let mut generation = self.generation.lock().expect("communication wake poisoned");
        *generation = generation.wrapping_add(1);
        self.changed.notify_one();
    }

    fn wait_after(&self, token: u64, timeout: Duration) -> u64 {
        let generation = self.generation.lock().expect("communication wake poisoned");
        let result = self
            .changed
            .wait_timeout_while(generation, timeout, |current| *current == token);
        match result {
            Ok((current, _)) => *current,
            Err(poisoned) => *poisoned.into_inner().0,
        }
    }
}

/// Stato gestito da Tauri.
pub struct AppState {
    pub app_dir: PathBuf,
    pub config: Mutex<AppConfig>,
    pub runtime: Mutex<Option<Runtime>>,
    pub app_handle: Mutex<Option<NativeAppHandle>>,
    reconnect_required: Mutex<bool>,
    /// Impedisce che due finestre dello stesso processo acquisiscano la stessa
    /// lease cooperativa e che una la rilasci mentre l'altra sta ancora lavorando.
    operation_lock_local: Mutex<Option<String>>,
    /// Serializza le prove SMTP avviate da più finestre dello stesso processo.
    email_test_local: Mutex<()>,
    /// Una sola comunicazione per volta può produrre un effetto esterno su
    /// questo PC.
    communication_send_local: Mutex<()>,
    /// Impedisce al riavvio dell'updater di interrompere effetti esterni,
    /// backup e operazioni di manutenzione già in corso.
    runtime_activity: runtime_activity::RuntimeActivityGate,
    /// Registro completo delle comunicazioni del solo PC corrente. Vive in
    /// `%APPDATA%`, fuori dalla cartella condivisa e quindi da sync, snapshot e
    /// backup dei dati aziendali. Il nome su disco resta
    /// `communication-outbox`.
    communication_engine: Mutex<Option<Arc<Engine>>>,
    /// Riferimenti ai PDF/PNG appena generati ma non ancora affidati alla coda.
    /// Sono lease esclusivamente in memoria: dopo un crash non sopravvivono e
    /// la pulizia di avvio può eliminare ogni artefatto rimasto orfano.
    pending_document_cache: Mutex<HashSet<String>>,
    /// Serializza creazione e cancellazione dei file temporanei tra Webview e
    /// worker, evitando che una pulizia cada nel mezzo di una scrittura atomica.
    document_cache_io: Mutex<()>,
    communication_wake: CommunicationWake,
}

const RETENZIONE_APPLIED_EVENTI: usize = 10_000;
const RETENZIONE_MESSAGGI_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const RETENZIONE_SUGGERIMENTI_IGNORATI_MS: u64 = 180 * 24 * 60 * 60 * 1000;
/// Entità mostrate nel Cestino (escluse quelle interne: user/device/presence).
const ENTITA_UTENTE: [&str; 16] = [
    "agente",
    "medico",
    "cliente",
    "prodotto",
    "conto",
    "corriere",
    "regola_prezzo",
    "ordine",
    "riga_ordine",
    "pagamento",
    "distinta",
    "rimborso",
    "spedizione",
    "prodotto_produzione",
    "promemoria",
    "preventivo",
];

/// Entità che possono contenere riferimenti diretti a un cliente, incluse quelle
/// tecniche non mostrate nel Cestino.
const ENTITA_RIFERIMENTI_CLIENTE: [&str; 17] = [
    "agente",
    "medico",
    "prodotto",
    "conto",
    "corriere",
    "regola_prezzo",
    "ordine",
    "riga_ordine",
    "pagamento",
    "distinta",
    "rimborso",
    "spedizione",
    "prodotto_produzione",
    "promemoria",
    "provv_pagamento",
    "notifica",
    "cliente",
];

/// Conti speciali built-in (id fissi → conflict-free fra dispositivi).
const CONTO_CONTRASSEGNO: &str = "__contrassegno__";
const CONTO_ASSEGNO: &str = "__assegno__";

/// Corrieri built-in (id fissi): CORRIERE_B, CORRIERE_A e CORRIERE_C, con profilo di export irremovibile.
const CORRIERE_CORRIERE_B: &str = "__gls__";
const CORRIERE_CORRIERE_A: &str = "__carrai__";
const CORRIERE_CORRIERE_C: &str = "__mbe__";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishOnboarding {
    pub data_dir: String,
    /// "create" | "use" | "reconfigure"
    pub mode: String,
    pub user_id: Option<String>,
    pub nome: String,
    pub avatar_tipo: String,
    pub avatar_valore: String,
}

pub type AppResult<T> = Result<T, String>;

/// Esito del controllo leggero usato dalla UI come rete di protezione al file-watch.
/// Non ricostruisce mai la proiezione in autonomia: le anomalie vengono inoltrate al
/// coordinatore UI. Restore incompleti e revoche usano una schermata bloccante;
/// un gap coperto da snapshot usa invece il normale feedback di riallineamento.
pub enum SyncPollOutcome {
    Changed(Vec<String>),
    Rebuild(&'static str),
    Waiting,
}

#[derive(Debug)]
struct NuovoPagamentoAtteso {
    tipo: &'static str,
    importo: i64,
    scadenza: String,
    conto_id: String,
    scad_da_spedizione: bool,
}

impl AppState {
    // ---- CRUD generico sui record (anagrafiche e, in futuro, ordini) ----

    /// Esegue `f` con il motore aperto, o fallisce se non è ancora configurato.
    fn with_engine<R>(&self, f: impl FnOnce(&Engine) -> AppResult<R>) -> AppResult<R> {
        let guard = self.runtime.lock().expect("rt poisoned");
        let rt = guard.as_ref().ok_or("motore non aperto")?;
        f(&rt.engine)
    }

    /// Elenca i record non cancellati di un'entità.
    pub fn records_list(&self, entity: &str) -> AppResult<Vec<RecordDto>> {
        crate::premium::ensure_generic_entity_access(self, entity)?;
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                p.list(entity)
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|record| record_visibile_localmente(p, record))
                    .map(record_to_dto)
                    .collect()
            }))
        })
    }

    /// Legge un singolo record (anche se nel Cestino).
    pub fn record_get(&self, entity: &str, id: &str) -> AppResult<Option<RecordDto>> {
        crate::premium::ensure_generic_entity_access(self, entity)?;
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                p.get(entity, id)
                    .ok()
                    .flatten()
                    .filter(|record| record_visibile_localmente(p, record))
                    .map(record_to_dto)
            }))
        })
    }

    /// Legge più record in una sola proiezione/IPC, evitando una chiamata per
    /// destinatario nelle campagne con centinaia di clienti.
    pub fn records_get_many(&self, entity: &str, ids: &[String]) -> AppResult<Vec<RecordDto>> {
        crate::premium::ensure_generic_entity_access(self, entity)?;
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                ids.iter()
                    .filter_map(|id| p.get(entity, id).ok().flatten())
                    .filter(|record| record_visibile_localmente(p, record))
                    .map(record_to_dto)
                    .collect()
            }))
        })
    }

    /// Crea un record: genera l'ULID, emette `Created` + i campi, restituisce il record.
    pub fn record_create(
        &self,
        entity: &str,
        fields: serde_json::Map<String, serde_json::Value>,
    ) -> AppResult<RecordDto> {
        crate::premium::ensure_generic_entity_access(self, entity)?;
        valida_importo_pagamento(entity, &fields)?;
        if entity == "riga_ordine" {
            valida_numeri_lotto(
                fields.get("qta").and_then(|v| v.as_i64()).unwrap_or(1),
                fields.get("numero").and_then(|v| v.as_str()).unwrap_or(""),
            )?;
        }
        self.with_engine(|engine| {
            let id = Ulid::generate().to_string();
            let entity_owned = entity.to_string();
            let id_for_batch = id.clone();
            engine
                .emit_built_checked(move |projection| {
                    if entity_owned == "provv_pagamento" {
                        valida_provv_pagamento_snapshot(projection, &fields)?;
                    }
                    let mut mutations = vec![Mutation::new(
                        entity_owned.clone(),
                        id_for_batch.clone(),
                        EventBody::Created,
                    )];
                    mutations.extend(fields.into_iter().map(|(field, value)| {
                        Mutation::new(
                            entity_owned.clone(),
                            id_for_batch.clone(),
                            EventBody::FieldSet { field, value },
                        )
                    }));
                    Ok(mutations)
                })
                .map_err(es)?;
            engine
                .with_projection(|p| p.get(entity, &id).ok().flatten())
                .map(record_to_dto)
                .ok_or_else(|| "record non trovato dopo la creazione".to_string())
        })
    }

    /// Crea un record con un **id fornito dal chiamante** (deterministico), invece di
    /// generare un ULID casuale. Serve per i record che devono **convergere fra dispositivi**
    /// anche se creati in concorrenza: due `Created` con lo stesso `id` collassano in un
    /// solo record (la proiezione è idempotente sul `Created` e LWW per-campo), quindi non
    /// si duplicano. Si comporta da **upsert**: se il record esiste già, il `Created` è un
    /// no-op e i campi si applicano in LWW. Usato per:
    ///  · le occorrenze rigenerate dei promemoria ricorrenti (`prom-<serie>-<data>`);
    ///  · i singoletti di impostazioni condivise (es. `impostazioni/__app__`).
    pub fn record_create_with_id(
        &self,
        entity: &str,
        id: &str,
        fields: serde_json::Map<String, serde_json::Value>,
    ) -> AppResult<RecordDto> {
        crate::premium::ensure_generic_entity_access(self, entity)?;
        if id.is_empty() {
            return Err("id non valido".into());
        }
        valida_importo_pagamento(entity, &fields)?;
        if entity == "riga_ordine" {
            valida_numeri_lotto(
                fields.get("qta").and_then(|v| v.as_i64()).unwrap_or(1),
                fields.get("numero").and_then(|v| v.as_str()).unwrap_or(""),
            )?;
        }
        self.with_engine(|engine| {
            let entity_owned = entity.to_string();
            let id_owned = id.to_string();
            engine
                .emit_built_checked(move |_| {
                    let mut mutations = vec![Mutation::new(
                        entity_owned.clone(),
                        id_owned.clone(),
                        EventBody::Created,
                    )];
                    mutations.extend(fields.into_iter().map(|(field, value)| {
                        Mutation::new(
                            entity_owned.clone(),
                            id_owned.clone(),
                            EventBody::FieldSet { field, value },
                        )
                    }));
                    Ok(mutations)
                })
                .map_err(es)?;
            engine
                .with_projection(|p| p.get(entity, id).ok().flatten())
                .map(record_to_dto)
                .ok_or_else(|| "record non trovato dopo la creazione".to_string())
        })
    }

    /// Aggiorna i campi indicati di un record (LWW per-campo).
    pub fn record_update(
        &self,
        entity: &str,
        id: &str,
        fields: serde_json::Map<String, serde_json::Value>,
    ) -> AppResult<RecordDto> {
        crate::premium::ensure_generic_entity_access(self, entity)?;
        valida_importo_pagamento(entity, &fields)?;
        self.with_engine(|engine| {
            let riallinea_contrassegno = entity == "pagamento"
                && ["conto_id", "importo", "tipo", "saldato"]
                    .iter()
                    .any(|campo| fields.contains_key(*campo));
            let entity_owned = entity.to_string();
            let id_owned = id.to_string();
            engine
                .emit_built_checked(move |projection| {
                    let corrente = projection
                        .get(&entity_owned, &id_owned)
                        .map_err(|error| error.to_string())?
                        .ok_or_else(|| "record non trovato o eliminato".to_string())?;
                    if corrente.deleted {
                        return Err("il record è stato eliminato da un'altra postazione".into());
                    }
                    if entity_owned == "pagamento"
                        && !str_field(&corrente.data, "distinta_id").is_empty()
                    {
                        return Err(
                            "il pagamento è già incluso in una distinta e non può essere modificato"
                                .into(),
                        );
                    }
                    if entity_owned == "riga_ordine"
                        && (fields.contains_key("qta") || fields.contains_key("numero"))
                    {
                        let qta = fields
                            .get("qta")
                            .and_then(|v| v.as_i64())
                            .unwrap_or_else(|| i64_field(&corrente.data, "qta"));
                        let numero = fields
                            .get("numero")
                            .and_then(|v| v.as_str())
                            .map(str::to_string)
                            .unwrap_or_else(|| str_field(&corrente.data, "numero"));
                        valida_numeri_lotto(qta, &numero)?;
                    }
                    let mut fields = fields;
                    aggiorna_candidatura_aruba_per_cf(&entity_owned, &corrente.data, &mut fields);
                    Ok(fields
                        .into_iter()
                        .map(|(field, value)| {
                            Mutation::new(
                                entity_owned.clone(),
                                id_owned.clone(),
                                EventBody::FieldSet { field, value },
                            )
                        })
                        .collect())
                })
                .map_err(es)?;
            if riallinea_contrassegno {
                if let Some(ordine_id) = engine.with_projection(|p| {
                    p.get("pagamento", id)
                        .ok()
                        .flatten()
                        .map(|pagamento| str_field(&pagamento.data, "ordine_id"))
                }) {
                    riallinea_contrassegno_spedizioni_ordine(engine, &ordine_id)?;
                }
            }
            engine
                .with_projection(|p| p.get(entity, id).ok().flatten())
                .map(record_to_dto)
                .ok_or_else(|| "record non trovato".to_string())
        })
    }

    /// Applica una deduplicazione clienti come sequenza verificata di eventi convergenti.
    /// I duplicati vengono purgati solo dopo aver completato il canonico e riassegnato
    /// ogni riferimento cliente noto nella proiezione corrente.
    pub fn clienti_deduplica_applica(
        &self,
        merges: Vec<DedupClienteMergeInput>,
    ) -> AppResult<DedupClientiResult> {
        self.with_engine(|engine| clienti_deduplica_applica_engine(engine, merges))
    }
}

/// Unica implementazione dell'applicazione dei merge clienti. È usata sia
/// dall'importazione sia dalla compattazione generazionale, così verifiche,
/// completamento campi e riassegnazione riferimenti restano identici.
fn clienti_deduplica_applica_engine(
    engine: &Engine,
    merges: Vec<DedupClienteMergeInput>,
) -> AppResult<DedupClientiResult> {
    let mut result = DedupClientiResult::default();

    for merge in merges {
        if merge.canonico_id.is_empty() || merge.duplicati_ids.is_empty() {
            result.merge_saltati += 1;
            continue;
        }

        let canonico =
            engine.with_projection(|p| p.get("cliente", &merge.canonico_id).ok().flatten());
        let Some(canonico) = canonico.filter(|r| !r.deleted) else {
            result.merge_saltati += 1;
            continue;
        };
        if merge.snapshots.get(&canonico.id) != Some(&canonico.data) {
            result.merge_saltati += 1;
            continue;
        }

        let duplicati: Vec<_> = engine.with_projection(|p| {
            merge
                .duplicati_ids
                .iter()
                .filter(|id| id.as_str() != merge.canonico_id)
                .filter_map(|id| p.get("cliente", id).ok().flatten())
                .filter(|r| !r.deleted)
                .collect()
        });
        if duplicati.len() != merge.duplicati_ids.len() {
            result.merge_saltati += 1;
            continue;
        }
        if duplicati
            .iter()
            .any(|r| merge.snapshots.get(&r.id) != Some(&r.data))
        {
            result.merge_saltati += 1;
            continue;
        }

        // Non propagare mai vuoti. Un campo viene completato solo se il canonico
        // non ha già un valore; per il CF accettiamo anche il passaggio invalido→valido.
        let mut patch = serde_json::Map::new();
        for (field, value) in merge.fields {
            if !valore_significativo(&value) {
                continue;
            }
            let attuale = canonico.data.get(&field);
            let completa_vuoto = !attuale.is_some_and(valore_significativo);
            let migliora_cf = field == "cf"
                && !attuale
                    .and_then(|v| v.as_str())
                    .is_some_and(cf_formalmente_valido)
                && value.as_str().is_some_and(cf_formalmente_valido);
            if completa_vuoto || migliora_cf {
                patch.insert(field, value);
            }
        }

        let campi_applicativi = patch.len();
        aggiorna_candidatura_aruba_per_cf("cliente", &canonico.data, &mut patch);
        let attesi = patch.clone();
        emit_fields(engine, "cliente", &merge.canonico_id, patch)?;
        let canonico_completo =
            engine.with_projection(|p| p.get("cliente", &merge.canonico_id).ok().flatten());
        let patch_verificata = canonico_completo.as_ref().is_some_and(|r| {
            attesi
                .iter()
                .all(|(field, value)| r.data.get(field) == Some(value))
        });
        if !patch_verificata {
            result.merge_saltati += 1;
            continue;
        }
        result.campi_completati += campi_applicativi;

        let duplicati_ids: HashSet<String> = duplicati.iter().map(|r| r.id.clone()).collect();
        let aggiornamenti =
            riferimenti_cliente_da_riassegnare(engine, &duplicati_ids, &merge.canonico_id);
        for (entity, id, fields) in aggiornamenti {
            result.riferimenti_riassegnati += fields.len();
            emit_fields(engine, &entity, &id, fields)?;
        }

        if esistono_riferimenti_cliente(engine, &duplicati_ids) {
            result.merge_saltati += 1;
            continue;
        }

        for duplicato in duplicati {
            engine
                .emit("cliente", &duplicato.id, EventBody::Purged)
                .map_err(es)?;
            result.clienti_purgati += 1;
        }
        result.gruppi += 1;
    }

    Ok(result)
}

impl AppState {
    /// Rimuove dalla sola vista locale i clienti importati storicamente che non
    /// avrebbero potuto superare il salvataggio attuale. Non emette eventi, non
    /// modifica gli snapshot condivisi e conserva record con dati o riferimenti.
    fn clienti_locali_sanifica_dopo_backup(&self) -> AppResult<usize> {
        self.with_engine(|engine| {
            engine
                .with_projection(|p| -> crate::projection::Result<usize> {
                    let candidati = p
                        .list("cliente")?
                        .into_iter()
                        .filter(cliente_sotto_minimo_e_praticamente_vuoto)
                        .collect::<Vec<_>>();
                    let mut nascosti = 0;
                    for cliente in candidati {
                        let ids = HashSet::from([cliente.id.clone()]);
                        if !proiezione_contiene_riferimenti_cliente(p, &ids)
                            && p.suppress_local("cliente", &cliente.id)?
                        {
                            nascosti += 1;
                        }
                    }
                    Ok(nascosti)
                })
                .map_err(es)
        })
    }

    /// Prezzo suggerito per un prodotto in un dato contesto (medico → agente).
    /// Applica il listino con la regola "più specifica vince" (vedi `pricing`).
    pub fn prezzo_suggerito(
        &self,
        prodotto_id: &str,
        medico_id: Option<String>,
    ) -> AppResult<PrezzoSuggeritoDto> {
        self.with_engine(|engine| {
            engine.with_projection(|p| {
                let prod = p
                    .get("prodotto", prodotto_id)
                    .ok()
                    .flatten()
                    .ok_or("prodotto non trovato")?;
                let categoria = str_field(&prod.data, "categoria");
                let base = i64_field(&prod.data, "prezzo_base_default");

                // Agente derivato dal medico (se presente).
                let agente = match &medico_id {
                    Some(m) => p
                        .get("medico", m)
                        .ok()
                        .flatten()
                        .and_then(|r| opt_str_field(&r.data, "agente_id")),
                    None => None,
                };

                let regole: Vec<RegolaPrezzo> = p
                    .list("regola_prezzo")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| RegolaPrezzo {
                        id: r.id,
                        prodotto_id: opt_str_field(&r.data, "prodotto_id"),
                        categoria: opt_str_field(&r.data, "categoria"),
                        agente_id: opt_str_field(&r.data, "agente_id"),
                        medico_id: opt_str_field(&r.data, "medico_id"),
                        prezzo: i64_field(&r.data, "prezzo"),
                    })
                    .collect();

                let ctx = Contesto {
                    prodotto_id,
                    categoria: &categoria,
                    prezzo_base_default: base,
                    agente_id: agente.as_deref(),
                    medico_id: medico_id.as_deref(),
                };
                let ris = crate::pricing::risolvi(&ctx, &regole);
                Ok(PrezzoSuggeritoDto {
                    prezzo: ris.prezzo,
                    fonte: ris.fonte.codice().to_string(),
                    regola_id: ris.regola_id,
                })
            })
        })
    }

    /// Variante batch usata dall'interprete preventivi: catalogo e regole vengono
    /// letti una volta sola, indipendentemente dal numero di prodotti candidati.
    pub fn prezzi_suggeriti_batch(
        &self,
        prodotto_ids: Vec<String>,
        medico_id: Option<String>,
    ) -> AppResult<Vec<PrezzoSuggeritoProdottoDto>> {
        self.with_engine(|engine| {
            engine.with_projection(|p| {
                let agente = medico_id.as_ref().and_then(|medico| {
                    p.get("medico", medico)
                        .ok()
                        .flatten()
                        .and_then(|record| opt_str_field(&record.data, "agente_id"))
                });
                let regole = p
                    .list("regola_prezzo")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|record| RegolaPrezzo {
                        id: record.id,
                        prodotto_id: opt_str_field(&record.data, "prodotto_id"),
                        categoria: opt_str_field(&record.data, "categoria"),
                        agente_id: opt_str_field(&record.data, "agente_id"),
                        medico_id: opt_str_field(&record.data, "medico_id"),
                        prezzo: i64_field(&record.data, "prezzo"),
                    })
                    .collect::<Vec<_>>();
                let mut unici = HashSet::new();
                let mut result = Vec::new();
                for prodotto_id in prodotto_ids {
                    if prodotto_id.is_empty() || !unici.insert(prodotto_id.clone()) {
                        continue;
                    }
                    let prodotto = p
                        .get("prodotto", &prodotto_id)
                        .map_err(es)?
                        .filter(|record| !record.deleted)
                        .ok_or_else(|| format!("prodotto {prodotto_id} non trovato"))?;
                    let categoria = str_field(&prodotto.data, "categoria");
                    let ctx = Contesto {
                        prodotto_id: &prodotto_id,
                        categoria: &categoria,
                        prezzo_base_default: i64_field(&prodotto.data, "prezzo_base_default"),
                        agente_id: agente.as_deref(),
                        medico_id: medico_id.as_deref(),
                    };
                    let risolto = crate::pricing::risolvi(&ctx, &regole);
                    result.push(PrezzoSuggeritoProdottoDto {
                        prodotto_id,
                        prezzo: risolto.prezzo,
                        fonte: risolto.fonte.codice().into(),
                        regola_id: risolto.regola_id,
                    });
                }
                Ok(result)
            })
        })
    }

    /// Svuota lo stato LOCALE a questo PC: chiude il motore e rimuove la
    /// proiezione SQLite ricostruibile. Non tocca i dati condivisi nella cartella.
    fn wipe_local(&self) -> AppResult<()> {
        {
            let mut guard = self.runtime.lock().expect("rt poisoned");
            if let Some(rt) = guard.as_ref() {
                rt.engine.shutdown();
                rt.engine.wipe_projection().map_err(es)?;
            }
            *guard = None;
        }
        {
            let mut guard = self
                .communication_engine
                .lock()
                .expect("communication engine poisoned");
            if let Some(engine) = guard.take() {
                engine.shutdown();
            }
        }
        rimuovi_proiezione_locale(&self.app_dir)?;
        Ok(())
    }

    /// Chiude ogni risorsa locale e rimuove l'intera cartella AppData dell'app.
    /// La cartella verrà ricreata soltanto quando l'utente avvia un nuovo onboarding.
    fn cancella_cartella_locale(&self) -> AppResult<()> {
        self.wipe_local()?;
        if !self.app_dir.exists() {
            return Ok(());
        }
        let mut ultimo_errore = None;
        for tentativo in 0..5 {
            match fs::remove_dir_all(&self.app_dir) {
                Ok(()) => return Ok(()),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(err) => {
                    ultimo_errore = Some(err);
                    if tentativo < 4 {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
            }
        }
        Err(es(
            ultimo_errore.expect("errore cancellazione AppData mancante")
        ))
    }

    /// **Reset leggero**: riconfigura questo PC (torna all'onboarding) **senza** toccare i
    /// dati di business condivisi (ordini, anagrafiche). Mantiene il `device_id` (stesso
    /// dispositivo). In più **cancella il profilo corrente** dai dati condivisi quando
    /// non è usato da un'altra postazione attiva. Ricollegandosi si crea un nuovo profilo.
    pub fn reset_leggero(&self) -> AppResult<()> {
        // Prima di disconnettersi (l'engine è ancora vivo), scollega il device dal
        // profilo: finché il nuovo onboarding non termina non deve comparire nelle
        // liste operative. Il profilo viene rimosso solo se non è condiviso.
        let cfg = self.config();
        if let (Some(dir), Some(uid)) = (cfg.data_dir.clone(), cfg.user_id.clone()) {
            let condiviso = self.with_engine(|engine| {
                engine.ingest().map_err(es)?;
                let condiviso = profilo_usato_da_altro_device(engine, &uid, &cfg.device_id);
                set_fields(engine, "device", &cfg.device_id, &[("user_id", json!(""))])?;
                if !condiviso {
                    // Dopo lo scollegamento il profilo è già fuori dalle liste;
                    // la pulizia dei suoi artefatti non deve impedire il reset.
                    let _ = elimina_profilo_con_engine(engine, &uid);
                }
                Ok(condiviso)
            })?;
            if !condiviso {
                rimuovi_avatar(Path::new(&dir), &uid);
            }
        }
        let device_id = cfg.device_id;
        self.cancella_cartella_locale()?;
        let mut c = self.config.lock().expect("config poisoned");
        *c = AppConfig {
            device_id,
            ..AppConfig::default()
        };
        *self.reconnect_required.lock().expect("reconnect poisoned") = false;
        Ok(())
    }

    /// **Reset completo**: riporta il programma allo stato di primo avvio e cancella
    /// anche i **dati condivisi** nella cartella (`events/`, `snapshots/`, `meta/`),
    /// impattando gli altri PC sincronizzati. Operazione **irreversibile** (la UI
    /// chiede doppia conferma nativa).
    pub fn reset_completo(&self) -> AppResult<()> {
        let cfg = self.config();
        let mut vecchi_device = HashSet::new();
        if !cfg.device_id.is_empty() {
            vecchi_device.insert(cfg.device_id.clone());
        }
        if let Ok(ids) = self.with_engine(|engine| {
            let _ = engine.ingest();
            Ok(engine.with_projection(|p| {
                let mut ids: HashSet<String> = p
                    .device_activity()
                    .unwrap_or_default()
                    .into_keys()
                    .collect();
                ids.extend(
                    p.list("device")
                        .unwrap_or_default()
                        .into_iter()
                        .map(|r| r.id),
                );
                ids.extend(
                    p.list("device_retired")
                        .unwrap_or_default()
                        .into_iter()
                        .map(|r| r.id),
                );
                ids
            }))
        }) {
            vecchi_device.extend(ids);
        }

        // Stato locale (chiude anche il watcher, così le cartelle sono cancellabili).
        self.cancella_cartella_locale()?;

        // Dati condivisi nella cartella.
        if let Some(dir) = cfg.data_dir.as_deref() {
            for sub in ["events", "snapshots", "meta"] {
                let p = Path::new(dir).join(sub);
                if p.exists() {
                    fs::remove_dir_all(&p).map_err(e)?;
                }
            }
        }

        // Il nuovo archivio conserva solo una barriera per i vecchi device: se un PC
        // rimasto offline risincronizza il proprio log pre-reset, il fold lo ignora e
        // non fa ricomparire postazioni o dati del dataset precedente.
        let nuovo_device = Ulid::generate().to_string();
        if let Some(dir) = cfg.data_dir.as_deref() {
            let barriera = scrivi_barriera_reset_completo(
                &self.app_dir,
                Path::new(dir),
                &nuovo_device,
                &vecchi_device,
            );
            let pulizia_locale = self.cancella_cartella_locale();
            barriera?;
            pulizia_locale?;
        }

        // Nuova configurazione vergine (nuovo device_id) → riparte l'onboarding.
        let mut c = self.config.lock().expect("config poisoned");
        *c = AppConfig {
            device_id: nuovo_device,
            ..AppConfig::default()
        };
        *self.reconnect_required.lock().expect("reconnect poisoned") = false;
        Ok(())
    }

    fn ensure_engine(&self, data_dir: &str, author: &str) -> AppResult<()> {
        let mut guard = self.runtime.lock().expect("rt poisoned");
        if guard.is_none() {
            let cfg = self.config();
            let handle = clone_native_app_handle(&self.app_handle.lock().expect("handle poisoned"));
            *guard = Some(open_runtime(
                &self.app_dir,
                data_dir,
                &cfg.device_id,
                author,
                handle,
            )?);
        }
        Ok(())
    }
}

// ---- Funzioni di supporto ----

/// Apre una cartella nel file manager di sistema.
fn apri_cartella(dir: &Path) -> AppResult<()> {
    crate::platform::apri_cartella_sistema(dir)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn stato_cartella_dati(data_dir: Option<&str>) -> String {
    let Some(dir) = data_dir else {
        return "not_configured".to_string();
    };
    let root = Path::new(dir);
    if cartella_ha_eventi_validi(&root.join("events"))
        || cartella_ha_snapshot_validi(&root.join("snapshots"))
    {
        "ok".to_string()
    } else {
        "missing_or_empty".to_string()
    }
}

fn cartella_ha_eventi_validi(events: &Path) -> bool {
    let Ok(entries) = fs::read_dir(events) else {
        return false;
    };
    entries.flatten().any(|e| {
        let path = e.path();
        path.is_file()
            && path
                .extension()
                .map(|ext| ext.eq_ignore_ascii_case("ndjson"))
                .unwrap_or(false)
            && LogStore::read_first_event(&path).ok().flatten().is_some()
    })
}

fn cartella_ha_snapshot_validi(snapshots: &Path) -> bool {
    let Ok(entries) = fs::read_dir(snapshots) else {
        return false;
    };
    entries.flatten().any(|e| {
        let path = e.path();
        if !path.is_file()
            || !path
                .extension()
                .map(|ext| ext.eq_ignore_ascii_case("json"))
                .unwrap_or(false)
        {
            return false;
        }
        fs::read(&path)
            .ok()
            .and_then(|bytes| {
                serde_json::from_slice::<crate::projection::SnapshotData>(&bytes).ok()
            })
            .is_some()
    })
}

fn pulisci_locks_runtime(data_dir: &Path) -> AppResult<()> {
    let locks = data_dir.join("meta").join("locks");
    if locks.exists() {
        fs::remove_dir_all(locks).map_err(es)?;
    }
    Ok(())
}

fn rimuovi_proiezione_locale(app_dir: &Path) -> AppResult<()> {
    let base = app_dir.join("projection.sqlite");
    let paths = [
        base.clone(),
        app_dir.join("projection.sqlite-wal"),
        app_dir.join("projection.sqlite-shm"),
    ];

    for path in paths {
        let mut ultimo_errore = None;
        for tentativo in 0..5 {
            match fs::remove_file(&path) {
                Ok(()) => {
                    ultimo_errore = None;
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    ultimo_errore = None;
                    break;
                }
                Err(e) => {
                    ultimo_errore = Some(e);
                    if tentativo < 4 {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
            }
        }
        if let Some(e) = ultimo_errore {
            return Err(es(e));
        }
    }

    Ok(())
}

fn salva_snapshot_con_device(
    engine: &Engine,
    data_dir: &Path,
    device_id: &str,
) -> AppResult<PathBuf> {
    let snap = snapshot_condiviso(engine)?;
    salva_snapshot_data_con_device(&snap, data_dir, device_id)
}

/// Le comunicazioni appartengono alla postazione e non devono più essere
/// incorporate in snapshot, anchor di restore o generazioni condivise. I
/// watermark restano invariati: gli eventi già osservati non vengono
/// ripiegati di nuovo dopo il bootstrap dallo snapshot filtrato.
fn snapshot_condiviso(engine: &Engine) -> AppResult<crate::projection::SnapshotData> {
    let mut snapshot = engine.with_projection(|p| p.export()).map_err(es)?;
    filtra_snapshot_condiviso(&mut snapshot);
    Ok(snapshot)
}

fn filtra_snapshot_condiviso(snapshot: &mut crate::projection::SnapshotData) {
    const ENTITA_SOLO_LOCALE: &str = "comunicazione";
    snapshot
        .records
        .retain(|record| record.entity != ENTITA_SOLO_LOCALE);
    snapshot
        .clocks
        .retain(|clock| clock.entity != ENTITA_SOLO_LOCALE);
    snapshot
        .purged
        .retain(|record| record.entity != ENTITA_SOLO_LOCALE);
}

fn salva_snapshot_data_con_device(
    snap: &crate::projection::SnapshotData,
    data_dir: &Path,
    device_id: &str,
) -> AppResult<PathBuf> {
    let store = SnapshotStore::new(data_dir.join("snapshots"), device_id).map_err(es)?;
    let seq = store.next_seq().map_err(es)?;
    let path = store.save(snap, seq).map_err(es)?;
    let _ = store.prune(1);
    Ok(path)
}

fn scrivi_barriera_reset_completo(
    app_dir: &Path,
    data_dir: &Path,
    nuovo_device: &str,
    vecchi_device: &HashSet<String>,
) -> AppResult<()> {
    fs::create_dir_all(app_dir).map_err(e)?;
    let sqlite = app_dir.join("projection.sqlite");
    {
        let engine = Engine::open(data_dir, &sqlite, nuovo_device, "reset-completo").map_err(es)?;
        for device_id in vecchi_device {
            if device_id.is_empty() || device_id == nuovo_device {
                continue;
            }
            engine
                .emit("device_retired", device_id, EventBody::Created)
                .map_err(es)?;
        }
        engine.snapshot().map_err(es)?;
        engine.shutdown();
    }
    scrivi_restore_marker(data_dir, nuovo_device, None)
}

fn elimina_profilo_con_engine(engine: &Engine, uid: &str) -> AppResult<()> {
    let letti: Vec<String> = engine.with_projection(|p| {
        p.list("notifica_letta")
            .unwrap_or_default()
            .into_iter()
            .filter(|r| str_field(&r.data, "user_id") == uid)
            .map(|r| r.id)
            .collect()
    });
    for id in letti {
        let _ = engine.emit("notifica_letta", &id, EventBody::Deleted);
    }
    engine.emit("user", uid, EventBody::Deleted).map_err(es)?;
    Ok(())
}

fn rimuovi_avatar(data_dir: &Path, uid: &str) {
    let avatar = data_dir
        .join("meta")
        .join("avatars")
        .join(format!("{uid}.png"));
    if avatar.exists() {
        let _ = fs::remove_file(avatar);
    }
}

fn rimuovi_snapshot_dispositivo(data_dir: &Path, device_id: &str) -> usize {
    let snapshots = data_dir.join("snapshots");
    let prefix = format!("{device_id}-");
    let mut rimossi = 0;
    let Ok(entries) = fs::read_dir(snapshots) else {
        return 0;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_file()
            && name.starts_with(&prefix)
            && name.ends_with(".json")
            && fs::remove_file(path).is_ok()
        {
            rimossi += 1;
        }
    }
    rimossi
}

fn rimuovi_log_dispositivo(data_dir: &Path, device_id: &str) -> usize {
    let events = data_dir.join("events");
    let mut rimossi = 0;
    let Ok(entries) = fs::read_dir(events) else {
        return 0;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file()
            || !path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("ndjson"))
                .unwrap_or(false)
        {
            continue;
        }
        let name_match = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s == device_id || s.starts_with(&format!("{device_id} ")))
            .unwrap_or(false);
        let event_match = LogStore::read_first_event(&path)
            .ok()
            .flatten()
            .map(|ev| ev.ts.device == device_id)
            .unwrap_or(false);
        if (name_match || event_match) && fs::remove_file(path).is_ok() {
            rimossi += 1;
        }
    }
    rimossi
}

fn scrivi_restore_marker(
    data_dir: &Path,
    device_id: &str,
    restore_id: Option<&str>,
) -> AppResult<()> {
    let events = data_dir.join("events");
    fs::create_dir_all(&events).map_err(es)?;
    let marker = events.join(format!(".restore-{device_id}-{}.marker", now_ms()));
    let payload = match restore_id {
        Some(id) => serde_json::to_vec_pretty(&json!({ "restoreId": id })).map_err(es)?,
        None => b"restore".to_vec(),
    };
    fs::write(marker, payload).map_err(es)?;
    nascondi_restore_markers(&events);
    pulisci_restore_markers_device(&events, device_id);
    Ok(())
}

fn nascondi_restore_markers(events_dir: &Path) {
    let Ok(entries) = fs::read_dir(events_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with(".restore-") && name.ends_with(".marker") {
            nascondi_file_best_effort(&path);
        }
    }
}

fn pulisci_restore_markers_device(events_dir: &Path, device_id: &str) {
    let prefix = format!(".restore-{device_id}-");
    let Ok(entries) = fs::read_dir(events_dir) else {
        return;
    };
    let mut mine: Vec<(u64, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?;
            let ts = name
                .strip_prefix(&prefix)?
                .strip_suffix(".marker")?
                .parse::<u64>()
                .ok()?;
            Some((ts, path))
        })
        .collect();
    if mine.len() <= 1 {
        return;
    }
    mine.sort_by_key(|(ts, _)| std::cmp::Reverse(*ts));
    for (_, path) in mine.into_iter().skip(1) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(windows)]
fn nascondi_file_best_effort(path: &Path) {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_FLAGS_AND_ATTRIBUTES,
        INVALID_FILE_ATTRIBUTES,
    };

    use std::os::windows::ffi::OsStrExt;
    let path_w: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        let attrs = GetFileAttributesW(PCWSTR(path_w.as_ptr()));
        if attrs == INVALID_FILE_ATTRIBUTES {
            return;
        }
        let _ = SetFileAttributesW(
            PCWSTR(path_w.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(attrs | FILE_ATTRIBUTE_HIDDEN.0),
        );
    }
}

#[cfg(not(windows))]
fn nascondi_file_best_effort(_path: &Path) {}

pub(crate) fn open_runtime(
    app_dir: &Path,
    data_dir: &str,
    device_id: &str,
    author: &str,
    app_handle: Option<NativeAppHandle>,
) -> AppResult<Runtime> {
    open_runtime_internal(app_dir, data_dir, device_id, author, app_handle, None)
}

pub(crate) fn open_runtime_con_restore_anchor(
    app_dir: &Path,
    data_dir: &str,
    device_id: &str,
    author: &str,
    app_handle: Option<NativeAppHandle>,
    restore_anchor: PathBuf,
) -> AppResult<Runtime> {
    open_runtime_internal(
        app_dir,
        data_dir,
        device_id,
        author,
        app_handle,
        Some(restore_anchor),
    )
}

fn open_runtime_internal(
    app_dir: &Path,
    data_dir: &str,
    device_id: &str,
    author: &str,
    app_handle: Option<NativeAppHandle>,
    restore_anchor: Option<PathBuf>,
) -> AppResult<Runtime> {
    #[cfg(not(test))]
    use tauri::Emitter;
    fs::create_dir_all(app_dir).map_err(e)?;
    let sqlite = app_dir.join("projection.sqlite");
    let engine = Arc::new(
        match restore_anchor {
            Some(anchor) => {
                Engine::open_with_restore_anchor(data_dir, sqlite, device_id, author, anchor)
            }
            None => Engine::open(data_dir, sqlite, device_id, author),
        }
        .map_err(es)?,
    );
    #[cfg(not(test))]
    let handle_clone1 = clone_native_app_handle(&app_handle);
    let handle_clone2 = clone_native_app_handle(&app_handle);
    let handle_clone3 = clone_native_app_handle(&app_handle);
    let handle_clone4 = clone_native_app_handle(&app_handle);
    let watcher = engine
        .watch(
            move |entities| {
                #[cfg(test)]
                let _ = entities;
                #[cfg(not(test))]
                if let Some(ref h) = handle_clone1 {
                    emetti_entita_modificate(h, &entities);
                }
            },
            move |reason| {
                #[cfg(test)]
                let _ = (&handle_clone2, reason);
                #[cfg(not(test))]
                if let Some(ref h) = handle_clone2 {
                    let _ = h.emit("pt:data-wiped", json!({ "reason": reason }));
                }
            },
            move |restore_id| {
                #[cfg(test)]
                let _ = (&handle_clone3, restore_id);
                #[cfg(not(test))]
                if let Some(ref h) = handle_clone3 {
                    let _ = h.emit("pt:restore-prepare", json!({ "restoreId": restore_id }));
                }
            },
            move |restore_id| {
                #[cfg(test)]
                let _ = (&handle_clone4, restore_id);
                #[cfg(not(test))]
                if let Some(ref h) = handle_clone4 {
                    let _ = h.emit("pt:restore-cancelled", json!({ "restoreId": restore_id }));
                }
            },
        )
        .map_err(es)?;
    Ok(Runtime {
        engine,
        _watcher: watcher,
    })
}

fn set_fields(
    engine: &Engine,
    entity: &str,
    id: &str,
    fields: &[(&str, serde_json::Value)],
) -> AppResult<()> {
    engine
        .emit_many(
            entity,
            id,
            fields.iter().map(|(field, value)| EventBody::FieldSet {
                field: (*field).to_string(),
                value: value.clone(),
            }),
        )
        .map_err(es)?;
    Ok(())
}

fn emit_fields(
    engine: &Engine,
    entity: &str,
    id: &str,
    fields: serde_json::Map<String, serde_json::Value>,
) -> AppResult<()> {
    engine
        .emit_many(
            entity,
            id,
            fields
                .into_iter()
                .map(|(field, value)| EventBody::FieldSet { field, value }),
        )
        .map_err(es)?;
    Ok(())
}

fn valida_importo_pagamento(
    entity: &str,
    fields: &serde_json::Map<String, serde_json::Value>,
) -> AppResult<()> {
    if entity != "pagamento" {
        return Ok(());
    }
    if let Some(value) = fields.get("importo") {
        match value.as_i64() {
            Some(importo) if importo > 0 => {}
            _ => return Err("l'importo di un pagamento deve essere maggiore di zero".into()),
        }
    }
    Ok(())
}

/// Un CF nuovo o realmente cambiato rende nuovamente esportabile il cliente Aruba.
/// Il confronto normalizzato evita di ricandidarlo quando un form salva lo stesso
/// valore con sole differenze di spazi o maiuscole.
fn aggiorna_candidatura_aruba_per_cf(
    entity: &str,
    corrente: &serde_json::Map<String, serde_json::Value>,
    fields: &mut serde_json::Map<String, serde_json::Value>,
) {
    if entity != "cliente" {
        return;
    }
    let Some(nuovo_cf) = fields.get("cf").and_then(|value| value.as_str()) else {
        return;
    };
    let normalizza = |value: &str| value.trim().to_uppercase();
    let nuovo_cf = normalizza(nuovo_cf);
    let corrente_cf = corrente
        .get("cf")
        .and_then(|value| value.as_str())
        .map(normalizza)
        .unwrap_or_default();
    if !nuovo_cf.is_empty() && nuovo_cf != corrente_cf {
        fields.insert(
            "aruba_esportato_il".into(),
            serde_json::Value::String(String::new()),
        );
        fields.insert(
            "aruba_cf_esportato".into(),
            serde_json::Value::String(String::new()),
        );
        fields.insert(
            "aruba_ricandidato_il".into(),
            serde_json::Value::String(now_iso()),
        );
    }
}

fn valida_numeri_lotto(qta: i64, numero: &str) -> AppResult<()> {
    let qta = qta.max(1) as usize;
    let compilati = numero
        .lines()
        .filter(|lotto| !lotto.trim().is_empty())
        .count();
    if compilati > 0 && compilati != qta {
        return Err(format!(
            "inserire un numero lotto per ciascuna delle {qta} unità"
        ));
    }
    Ok(())
}

fn valore_significativo(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::String(s) => !s.trim().is_empty(),
        _ => true,
    }
}

fn cliente_sotto_minimo_e_praticamente_vuoto(record: &crate::projection::Record) -> bool {
    let nome_mancante = !record.data.get("nome").is_some_and(valore_significativo);
    nome_mancante
        && record
            .data
            .iter()
            .filter(|(field, _)| field.as_str() != "nome")
            .all(|(_, value)| !valore_significativo(value))
}

fn record_visibile_localmente(
    p: &crate::projection::Projection,
    record: &crate::projection::Record,
) -> bool {
    // I messaggi sono effimeri e non hanno cronologia. Quando la postazione che
    // li ha creati viene ritirata, non devono riapparire dopo un rebuild locale.
    // Il dato condiviso resta intatto: usiamo il device del Created HLC, valido
    // anche per i messaggi legacy che non salvavano un mittente_device_id.
    if record.entity == "notifica"
        && record.id.starts_with("msg:")
        && p.is_device_retired(&record.created_hlc.device)
            .unwrap_or(false)
    {
        return false;
    }

    if record.entity != "cliente"
        || !p
            .is_locally_suppressed(&record.entity, &record.id)
            .unwrap_or(false)
    {
        return true;
    }

    let ids = HashSet::from([record.id.clone()]);
    if cliente_sotto_minimo_e_praticamente_vuoto(record)
        && !proiezione_contiene_riferimenti_cliente(p, &ids)
    {
        return false;
    }

    // Se nel frattempo un altro PC completa o collega il cliente, torna visibile.
    let _ = p.unsuppress_local(&record.entity, &record.id);
    true
}

fn cf_formalmente_valido(value: &str) -> bool {
    value.trim().len() == 16
}

fn sostituisci_riferimento_cliente(
    value: &serde_json::Value,
    duplicati: &HashSet<String>,
    canonico_id: &str,
) -> Option<serde_json::Value> {
    match value {
        serde_json::Value::String(id) if duplicati.contains(id) => Some(json!(canonico_id)),
        serde_json::Value::Array(ids) => {
            let mut cambiato = false;
            let nuovi = ids
                .iter()
                .map(|value| {
                    if let serde_json::Value::String(id) = value {
                        if duplicati.contains(id) {
                            cambiato = true;
                            return json!(canonico_id);
                        }
                    }
                    value.clone()
                })
                .collect();
            cambiato.then_some(serde_json::Value::Array(nuovi))
        }
        _ => None,
    }
}

fn riferimenti_cliente_da_riassegnare(
    engine: &Engine,
    duplicati: &HashSet<String>,
    canonico_id: &str,
) -> Vec<(String, String, serde_json::Map<String, serde_json::Value>)> {
    engine.with_projection(|p| {
        let mut aggiornamenti = Vec::new();
        for entity in ENTITA_RIFERIMENTI_CLIENTE {
            if entity == "cliente" {
                continue;
            }
            let vivi = p.list(entity).unwrap_or_default();
            let eliminati = p.list_deleted(entity).unwrap_or_default();
            for record in vivi.into_iter().chain(eliminati) {
                let mut fields = serde_json::Map::new();
                for (field, value) in &record.data {
                    if !field.to_lowercase().contains("cliente") {
                        continue;
                    }
                    if let Some(nuovo) =
                        sostituisci_riferimento_cliente(value, duplicati, canonico_id)
                    {
                        fields.insert(field.clone(), nuovo);
                    }
                }
                if !fields.is_empty() {
                    aggiornamenti.push((entity.to_string(), record.id, fields));
                }
            }
        }
        aggiornamenti
    })
}

fn proiezione_contiene_riferimenti_cliente(
    p: &crate::projection::Projection,
    clienti: &HashSet<String>,
) -> bool {
    ENTITA_RIFERIMENTI_CLIENTE
        .iter()
        .copied()
        .filter(|entity| *entity != "cliente")
        .any(|entity| {
            let vivi = p.list(entity).unwrap_or_default();
            let eliminati = p.list_deleted(entity).unwrap_or_default();
            vivi.iter().chain(&eliminati).any(|record| {
                record.data.iter().any(|(field, value)| {
                    field.to_lowercase().contains("cliente")
                        && match value {
                            serde_json::Value::String(id) => clienti.contains(id),
                            serde_json::Value::Array(ids) => ids
                                .iter()
                                .any(|id| id.as_str().is_some_and(|id| clienti.contains(id))),
                            _ => false,
                        }
                })
            })
        })
}

fn esistono_riferimenti_cliente(engine: &Engine, duplicati: &HashSet<String>) -> bool {
    engine.with_projection(|p| proiezione_contiene_riferimenti_cliente(p, duplicati))
}

fn record_to_dto(r: crate::projection::Record) -> RecordDto {
    RecordDto {
        id: r.id,
        revision: r.updated_hlc.to_string(),
        data: r.data,
        deleted: r.deleted,
    }
}

fn list_users(engine: &Engine) -> Vec<UserDto> {
    engine.with_projection(|p| {
        // Le liste operative mostrano soltanto profili raggiungibili tramite almeno
        // un device attivo. Questo esclude sia i ritirati durevoli sia eventuali
        // utenti orfani risorti da vecchi snapshot o onboarding interrotti.
        let device_ritirati: HashSet<String> = p
            .list("device_retired")
            .unwrap_or_default()
            .into_iter()
            .map(|r| r.id)
            .collect();
        let utenti_attivi: HashSet<String> = p
            .list("device")
            .unwrap_or_default()
            .into_iter()
            .filter(|r| !device_ritirati.contains(&r.id))
            .map(|r| str_field(&r.data, "user_id"))
            .filter(|id| !id.is_empty())
            .collect();

        p.list("user")
            .unwrap_or_default()
            .into_iter()
            .filter(|r| utenti_attivi.contains(&r.id))
            .map(|r| UserDto {
                id: r.id,
                nome: str_field(&r.data, "nome"),
                avatar_tipo: str_field(&r.data, "avatar_tipo"),
                avatar_valore: str_field(&r.data, "avatar_valore"),
            })
            .collect()
    })
}

fn profilo_usato_da_altro_device(engine: &Engine, user_id: &str, escluso: &str) -> bool {
    if user_id.is_empty() {
        return false;
    }
    engine.with_projection(|p| {
        let device_ritirati: HashSet<String> = p
            .list("device_retired")
            .unwrap_or_default()
            .into_iter()
            .map(|r| r.id)
            .collect();
        p.list("device").unwrap_or_default().into_iter().any(|d| {
            d.id != escluso
                && !device_ritirati.contains(&d.id)
                && str_field(&d.data, "user_id") == user_id
        })
    })
}

fn identity_from(
    engine: &Engine,
    user_id: &str,
    device_id: &str,
    data_dir: &str,
) -> Option<IdentityDto> {
    engine.with_projection(|p| {
        let r = p.get("user", user_id).ok().flatten()?;
        if r.deleted {
            return None;
        }
        Some(IdentityDto {
            user_id: user_id.to_string(),
            nome: str_field(&r.data, "nome"),
            avatar_tipo: str_field(&r.data, "avatar_tipo"),
            avatar_valore: str_field(&r.data, "avatar_valore"),
            device_id: device_id.to_string(),
            device_nome: hostname(),
            data_dir: data_dir.to_string(),
        })
    })
}

fn str_field(data: &serde_json::Map<String, serde_json::Value>, key: &str) -> String {
    data.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Nome prodotto di una riga: dal catalogo se `prodotto_id` è valorizzato e presente
/// (autorevole, gestisce le rinomine), altrimenti il **nome libero** salvato sulla riga
/// (`prodotto_nome`). I prodotti liberi non sono in catalogo → niente categoria/listino:
/// contano come «non categorizzati». FASE 5.
fn nome_riga_prodotto(
    prodotti: &std::collections::HashMap<String, String>,
    prodotto_id: &str,
    riga: &serde_json::Map<String, serde_json::Value>,
) -> String {
    if !prodotto_id.is_empty() {
        if let Some(nome) = prodotti.get(prodotto_id).filter(|n| !n.is_empty()) {
            return nome.clone();
        }
    }
    str_field(riga, "prodotto_nome")
}

/// Stringa opzionale: `None` se assente o vuota (i criteri di regola non impostati).
fn opt_str_field(data: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    data.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn i64_field(data: &serde_json::Map<String, serde_json::Value>, key: &str) -> i64 {
    data.get(key).and_then(|v| v.as_i64()).unwrap_or(0)
}

fn bool_field(data: &serde_json::Map<String, serde_json::Value>, key: &str) -> bool {
    data.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

/// Mappa `id -> nome` dei record (non cancellati) di un'entità.
fn nome_map(p: &crate::projection::Projection, entity: &str) -> HashMap<String, String> {
    p.list(entity)
        .unwrap_or_default()
        .into_iter()
        .map(|r| (r.id, str_field(&r.data, "nome")))
        .collect()
}

/// Mappa id -> dati completi del record (per leggere indirizzo/telefono/ecc.).
fn dati_map(
    p: &crate::projection::Projection,
    entity: &str,
) -> HashMap<String, serde_json::Map<String, serde_json::Value>> {
    p.list(entity)
        .unwrap_or_default()
        .into_iter()
        .map(|r| (r.id, r.data))
        .collect()
}

/// Conti **di transito** (contrassegno/assegno): un pagamento su questi resta
/// "in attesa di accredito" finché una distinta corriere non lo accredita (FASE 3C).
fn conti_transito(p: &crate::projection::Projection) -> std::collections::HashSet<String> {
    p.list("conto")
        .unwrap_or_default()
        .into_iter()
        .filter(|r| {
            matches!(
                str_field(&r.data, "tipo").as_str(),
                "contrassegno" | "assegno"
            )
        })
        .map(|r| r.id)
        .collect()
}

/// Mappa `id -> (nome, tipo, iban)` dei conti (anche i built-in di transito).
fn conti_info(p: &crate::projection::Projection) -> HashMap<String, (String, String, String)> {
    p.list("conto")
        .unwrap_or_default()
        .into_iter()
        .map(|r| {
            (
                r.id.clone(),
                (
                    str_field(&r.data, "nome"),
                    str_field(&r.data, "tipo"),
                    str_field(&r.data, "iban"),
                ),
            )
        })
        .collect()
}

fn conto_preferito_ordine(
    p: &crate::projection::Projection,
    ordine_data: &serde_json::Map<String, serde_json::Value>,
    tipo: &str,
) -> String {
    let conti = p.list("conto").unwrap_or_default();
    let esiste = |id: &str| !id.is_empty() && conti.iter().any(|c| c.id == id);
    // Keriba usa sempre i conti generali dell'app. Immunoterapia e Diagnostica
    // seguono invece la stessa priorità dell'editor: medico → agente → default.
    let usa_preferenze_anagrafiche = str_field(ordine_data, "categoria") != "Keriba";

    if usa_preferenze_anagrafiche {
        let medico_id = str_field(ordine_data, "medico_id");
        if !medico_id.is_empty() {
            if let Ok(Some(medico)) = p.get("medico", &medico_id) {
                let conto = str_field(&medico.data, "conto_saldo_id");
                if esiste(&conto) {
                    return conto;
                }
            }
        }

        let agente_id = str_field(ordine_data, "agente_id");
        if !agente_id.is_empty() {
            if let Ok(Some(agente)) = p.get("agente", &agente_id) {
                let conto = str_field(&agente.data, "conto_saldo_id");
                if esiste(&conto) {
                    return conto;
                }
            }
        }
    }

    if tipo == "acconto" {
        if let Some(c) = conti
            .iter()
            .find(|c| c.data.get("predefinito_acconti") == Some(&json!(true)))
        {
            return c.id.clone();
        }
    }
    if let Some(c) = conti
        .iter()
        .find(|c| c.data.get("predefinito_incassi") == Some(&json!(true)))
    {
        return c.id.clone();
    }
    if let Some(c) = conti.iter().find(|c| {
        !matches!(
            str_field(&c.data, "tipo").as_str(),
            "contrassegno" | "assegno"
        )
    }) {
        return c.id.clone();
    }
    conti.first().map(|c| c.id.clone()).unwrap_or_default()
}

fn pagamento_dto(
    r: &crate::projection::Record,
    conti: &HashMap<String, (String, String, String)>,
    distinte: &HashMap<String, String>,
) -> PagamentoDto {
    let conto_id = str_field(&r.data, "conto_id");
    let (conto_nome, conto_tipo, conto_iban) = conti.get(&conto_id).cloned().unwrap_or_default();
    let distinta_id = str_field(&r.data, "distinta_id");
    let conto_accredito_nome = distinte.get(&distinta_id).cloned().unwrap_or_default();
    PagamentoDto {
        id: r.id.clone(),
        revision: r.updated_hlc.to_string(),
        ordine_id: str_field(&r.data, "ordine_id"),
        tipo: str_field(&r.data, "tipo"),
        importo: i64_field(&r.data, "importo"),
        saldato: bool_field(&r.data, "saldato"),
        scadenza: str_field(&r.data, "scadenza"),
        conto_id,
        conto_nome,
        conto_tipo,
        conto_iban,
        data: str_field(&r.data, "data"),
        verificato: bool_field(&r.data, "verificato"),
        distinta_id,
        conto_accredito_nome,
        note: str_field(&r.data, "note"),
        scad_da_spedizione: bool_field(&r.data, "scad_da_spedizione"),
        scad_rel_giorni: i64_field(&r.data, "scad_rel_giorni"),
    }
}

/// Costruisce le righe contrassegno (su conto di transito) che soddisfano `filtro`,
/// arricchite con ordine/cliente/agente/conto. Riusato da `contrassegni_aperti` (filtro
/// = senza distinta) e `distinta_righe` (filtro = con quella distinta). Ordina per data.
fn contrassegni_dto(
    p: &crate::projection::Projection,
    filtro: impl Fn(&crate::projection::Record) -> bool,
) -> Vec<ContrassegnoApertoDto> {
    let conti = conti_info(p);
    let transito = conti_transito(p);
    let numeri = numeri_ordini(p);
    let cli_nomi = nome_map(p, "cliente");
    let ag_nomi = nome_map(p, "agente");
    let ord_cli: HashMap<String, String> = p
        .list("ordine")
        .unwrap_or_default()
        .into_iter()
        .map(|r| (r.id.clone(), str_field(&r.data, "cliente_id")))
        .collect();
    let ord_ag: HashMap<String, String> = p
        .list("ordine")
        .unwrap_or_default()
        .into_iter()
        .map(|r| (r.id, str_field(&r.data, "agente_id")))
        .collect();
    let mut out = Vec::new();
    for r in p.list("pagamento").unwrap_or_default() {
        let conto = str_field(&r.data, "conto_id");
        if !transito.contains(&conto) || !filtro(&r) {
            continue;
        }
        let oid = str_field(&r.data, "ordine_id");
        // Ordine annullato (nel Cestino): il suo contrassegno non va né tra gli aperti
        // né in una distinta. ord_cli è solo degli ordini non eliminati.
        if !ord_cli.contains_key(&oid) {
            continue;
        }
        let (conto_nome, conto_tipo, _) = conti.get(&conto).cloned().unwrap_or_default();
        let cliente_nome = ord_cli
            .get(&oid)
            .and_then(|cid| cli_nomi.get(cid))
            .cloned()
            .unwrap_or_default();
        let agente_nome = ord_ag
            .get(&oid)
            .and_then(|aid| ag_nomi.get(aid))
            .cloned()
            .unwrap_or_default();
        out.push(ContrassegnoApertoDto {
            ordine_numero: numeri.get(&oid).cloned().unwrap_or_default(),
            ordine_id: oid,
            cliente_nome,
            agente_nome,
            tipo: str_field(&r.data, "tipo"),
            importo: i64_field(&r.data, "importo"),
            conto_id: conto,
            conto_nome,
            conto_tipo,
            data: str_field(&r.data, "data"),
            id: r.id,
        });
    }
    out.sort_by(|a, b| {
        a.data
            .cmp(&b.data)
            .then(a.ordine_numero.cmp(&b.ordine_numero))
    });
    out
}

/// Mappa `distinta_id -> nome del conto reale` di accredito: dove sono finiti i soldi di
/// un contrassegno/assegno coperto da quella distinta (per la doppia prospettiva mezzo↔conto).
fn distinte_accredito(p: &crate::projection::Projection) -> HashMap<String, String> {
    let conti = conti_info(p);
    p.list("distinta")
        .unwrap_or_default()
        .into_iter()
        .map(|r| {
            let conto_id = str_field(&r.data, "conto_id");
            let nome = conti
                .get(&conto_id)
                .map(|(n, _, _)| n.clone())
                .unwrap_or_default();
            (r.id, nome)
        })
        .collect()
}

/// Costruisce un `RimborsoDto` da un record `rimborso`: risolve il nome del conto di
/// uscita e dell'ordine collegato, e deriva lo stato (richiesto/effettuato).
fn rimborso_dto(
    r: &crate::projection::Record,
    conti: &HashMap<String, (String, String, String)>,
    numeri: &HashMap<String, String>,
    clienti: &HashMap<String, String>,
) -> RimborsoDto {
    let conto_id = str_field(&r.data, "conto_id");
    let ordine_id = str_field(&r.data, "ordine_id");
    let data_rimborso = str_field(&r.data, "data_rimborso");
    let stato = if data_rimborso.is_empty() {
        "richiesto"
    } else {
        "effettuato"
    };
    let origine = str_field(&r.data, "origine");
    RimborsoDto {
        data_richiesta: str_field(&r.data, "data_richiesta"),
        importo: i64_field(&r.data, "importo"),
        ragione_sociale: str_field(&r.data, "ragione_sociale"),
        motivo: str_field(&r.data, "motivo"),
        iban: str_field(&r.data, "iban"),
        conto_nome: conti
            .get(&conto_id)
            .map(|(n, _, _)| n.clone())
            .unwrap_or_default(),
        conto_id,
        data_rimborso,
        note: str_field(&r.data, "note"),
        ordine_numero: numeri.get(&ordine_id).cloned().unwrap_or_default(),
        cliente_id: clienti.get(&ordine_id).cloned().unwrap_or_default(),
        ordine_id,
        origine: if origine.is_empty() {
            "manuale".into()
        } else {
            origine
        },
        stato: stato.to_string(),
        id: r.id.clone(),
    }
}

/// Aggregato dei pagamenti **saldati** di un ordine (gli attesi non incidono su
/// `incassato`/`residuo`/stato).
#[derive(Default)]
struct AggPag {
    incassato: i64,
    non_verificati: usize,
    /// `true` se esiste un pagamento saldato su conto di transito non accreditato.
    transito_aperto: bool,
    /// `true` se esiste un pagamento **acconto** saldato (FASE 5A).
    acconto_incassato: bool,
    /// Somma dei pagamenti **acconto saldati**, in centesimi (per l'export Laboratorio col C,
    /// "saldato se incassato"). FASE 5C.
    acconto_saldato: i64,
    /// Data dell'acconto saldato (la prima trovata, `YYYY-MM-DD`). FASE 5A.
    data_acconto: String,
}

/// Somma e stato dei pagamenti **saldati** per ordine (una passata su `pagamento`).
fn pagamenti_per_ordine(
    p: &crate::projection::Projection,
    transito: &std::collections::HashSet<String>,
) -> HashMap<String, AggPag> {
    let mut out: HashMap<String, AggPag> = HashMap::new();
    for r in p.list("pagamento").unwrap_or_default() {
        if !bool_field(&r.data, "saldato") {
            continue; // i pagamenti attesi non contano come incasso
        }
        let oid = str_field(&r.data, "ordine_id");
        if oid.is_empty() {
            continue;
        }
        let a = out.entry(oid).or_default();
        a.incassato += i64_field(&r.data, "importo");
        if !bool_field(&r.data, "verificato") {
            a.non_verificati += 1;
        }
        if str_field(&r.data, "tipo") == "acconto" {
            a.acconto_incassato = true;
            a.acconto_saldato += i64_field(&r.data, "importo");
            if a.data_acconto.is_empty() {
                a.data_acconto = str_field(&r.data, "data");
            }
        }
        let conto = str_field(&r.data, "conto_id");
        if transito.contains(&conto) && str_field(&r.data, "distinta_id").is_empty() {
            a.transito_aperto = true;
        }
    }
    out
}

/// Per ogni ordine, la **prima rata utile non saldata** su conto di **transito**
/// (contrassegno/assegno) → `(mezzo, importo)` da proporre per l'incasso alla consegna
/// in fase di spedizione. "Prima utile" = scadenza più vicina (quelle senza scadenza in
/// coda). Ordini senza rate su transito non compaiono. FASE 4.
fn cod_atteso_per_ordine(p: &crate::projection::Projection) -> HashMap<String, (String, i64)> {
    // Conti di transito: id -> tipo (contrassegno|assegno).
    let tipi: HashMap<String, String> = p
        .list("conto")
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| {
            let tipo = str_field(&r.data, "tipo");
            (tipo == "contrassegno" || tipo == "assegno").then_some((r.id, tipo))
        })
        .collect();
    let mut per: HashMap<String, Vec<(String, String, i64)>> = HashMap::new();
    for r in p.list("pagamento").unwrap_or_default() {
        if bool_field(&r.data, "saldato") {
            continue; // solo rate ancora da incassare
        }
        let conto = str_field(&r.data, "conto_id");
        if let Some(tipo) = tipi.get(&conto) {
            let oid = str_field(&r.data, "ordine_id");
            if oid.is_empty() {
                continue;
            }
            per.entry(oid).or_default().push((
                str_field(&r.data, "scadenza"),
                tipo.clone(),
                i64_field(&r.data, "importo"),
            ));
        }
    }
    per.into_iter()
        .filter_map(|(oid, mut v)| {
            // Scadenza più vicina prima; le vuote in coda.
            v.sort_by(|a, b| {
                let ka = if a.0.is_empty() {
                    "9999-99-99"
                } else {
                    a.0.as_str()
                };
                let kb = if b.0.is_empty() {
                    "9999-99-99"
                } else {
                    b.0.as_str()
                };
                ka.cmp(kb)
            });
            v.into_iter()
                .next()
                .map(|(_, mezzo, imp)| (oid, (mezzo, imp)))
        })
        .collect()
}

/// Porta un ordine a *Confermato* se è ancora *Nuovo* (automazione: incasso registrato).
fn conferma_se_nuovo(engine: &Engine, ordine_id: &str) -> AppResult<()> {
    if let Some(o) = engine.with_projection(|p| p.get("ordine", ordine_id).ok().flatten()) {
        if str_field(&o.data, "stato") == "Nuovo" {
            set_fields(
                engine,
                "ordine",
                ordine_id,
                &[("stato", json!("Confermato"))],
            )?;
        }
    }
    Ok(())
}

/// Giorni che devono passare dall'ultimo saldo prima della chiusura automatica.
/// (La regola "Spedito + saldato + ≥20gg" usa la data dell'ultimo saldo come orologio;
/// in FASE 4 si potrà sostituire con la data di spedizione vera — vedi FASE-3 dec. 6.)
const GIORNI_CHIUSURA: u64 = 20;

/// Porta a **Chiuso** un ordine **Spedito** e **completamente saldato** se la sua
/// **data di spedizione** risale ad almeno `GIORNI_CHIUSURA` giorni fa (`soglia` = data
/// di N giorni fa). FASE 4E: l'orologio parte dalla spedizione reale (la data del collo
/// che ha completato l'evasione), non più dall'ultimo saldo. No-op se non idoneo.
fn prova_chiudi_ordine(engine: &Engine, ordine_id: &str, soglia: &str) -> AppResult<bool> {
    let info = engine.with_projection(|p| {
        let o = p.get("ordine", ordine_id).ok().flatten()?;
        let stato = str_field(&o.data, "stato");
        let totale = totali_ordini(p).get(ordine_id).copied().unwrap_or(0);
        let mut incassato = 0i64;
        let mut n_saldati = 0u32;
        for r in p.list("pagamento").unwrap_or_default() {
            if str_field(&r.data, "ordine_id") != ordine_id || !bool_field(&r.data, "saldato") {
                continue;
            }
            incassato += i64_field(&r.data, "importo");
            n_saldati += 1;
        }
        // Data di spedizione dell'ordine = data dell'ultimo collo che ha spedito le sue
        // righe (la più recente fra le spedizioni collegate).
        let sped_data: HashMap<String, String> = p
            .list("spedizione")
            .unwrap_or_default()
            .into_iter()
            .map(|s| (s.id, str_field(&s.data, "data")))
            .collect();
        let mut data_spedizione = String::new();
        for r in p.list("riga_ordine").unwrap_or_default() {
            if str_field(&r.data, "ordine_id") != ordine_id {
                continue;
            }
            let sid = str_field(&r.data, "spedizione_id");
            if sid.is_empty() {
                continue;
            }
            if let Some(d) = sped_data.get(&sid) {
                if d.as_str() > data_spedizione.as_str() {
                    data_spedizione = d.clone();
                }
            }
        }
        Some((stato, totale, incassato, n_saldati, data_spedizione))
    });
    let Some((stato, totale, incassato, n_saldati, data_spedizione)) = info else {
        return Ok(false);
    };
    // Solo ordini spediti, con almeno un incasso e residuo ≤ 0 (saldati), la cui data di
    // spedizione sia valida e già oltre la soglia dei 20 giorni.
    if stato != "Spedito"
        || n_saldati == 0
        || totale <= 0
        || incassato < totale
        || data_spedizione.is_empty()
        || data_spedizione.as_str() > soglia
    {
        return Ok(false);
    }
    set_fields(engine, "ordine", ordine_id, &[("stato", json!("Chiuso"))])?;
    Ok(true)
}

/// Quando un ordine raggiunge il pagamento pieno (anche con **soldi extra**:
/// `incassato ≥ totale`), è **saldato**: i pagamenti *attesi* residui non servono
/// più e vengono rimossi (così non risultano come crediti ancora da incassare).
fn pulisci_attesi_se_saldato(engine: &Engine, ordine_id: &str) -> AppResult<()> {
    let (incassato, totale, attesi) = engine.with_projection(|p| {
        let totale = totali_ordini(p).get(ordine_id).copied().unwrap_or(0);
        let mut incassato = 0i64;
        let mut attesi: Vec<String> = Vec::new();
        for r in p.list("pagamento").unwrap_or_default() {
            if str_field(&r.data, "ordine_id") != ordine_id {
                continue;
            }
            if bool_field(&r.data, "saldato") {
                incassato += i64_field(&r.data, "importo");
            } else {
                attesi.push(r.id);
            }
        }
        (incassato, totale, attesi)
    });
    if totale > 0 && incassato >= totale {
        for id in attesi {
            engine
                .emit("pagamento", &id, EventBody::Purged)
                .map_err(es)?;
        }
    }
    Ok(())
}

fn dividi_importo_equo(importo: i64, parti: usize) -> Vec<i64> {
    if parti == 0 {
        return Vec::new();
    }
    let base = importo / parti as i64;
    let mut resto = importo - base * parti as i64;
    (0..parti)
        .map(|_| {
            let extra = if resto > 0 {
                resto -= 1;
                1
            } else {
                0
            };
            base + extra
        })
        .collect()
}

fn ripartisci_importo_proporzionale(target: i64, importi_attuali: &[i64]) -> Vec<i64> {
    if importi_attuali.is_empty() || target <= 0 {
        return vec![0; importi_attuali.len()];
    }
    let totale_attuale: i128 = importi_attuali
        .iter()
        .map(|v| i128::from((*v).max(0)))
        .sum();
    if totale_attuale <= 0 {
        return dividi_importo_equo(target, importi_attuali.len());
    }

    let target_i = i128::from(target);
    let mut quote: Vec<i64> = Vec::with_capacity(importi_attuali.len());
    let mut resti: Vec<(usize, i128)> = Vec::with_capacity(importi_attuali.len());
    let mut assegnato = 0i64;
    for (idx, importo) in importi_attuali.iter().enumerate() {
        let peso = i128::from((*importo).max(0));
        let prodotto = target_i * peso;
        let quota = (prodotto / totale_attuale) as i64;
        quote.push(quota);
        resti.push((idx, prodotto % totale_attuale));
        assegnato += quota;
    }

    let mut residuo = target - assegnato;
    resti.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    for (idx, _) in resti {
        if residuo <= 0 {
            break;
        }
        quote[idx] += 1;
        residuo -= 1;
    }
    quote
}

/// Stato pagamento **effettivo**: override manuale se presente, altrimenti derivato
/// (vedi `MODELLO-DATI.md`). `agg` = aggregato dei pagamenti dell'ordine (se presenti).
fn stato_pagamento_effettivo(
    override_s: &str,
    omaggio: bool,
    totale: i64,
    agg: Option<&AggPag>,
) -> String {
    if !override_s.is_empty() {
        return override_s.to_string();
    }
    if omaggio {
        return "omaggio_sostituzione".to_string();
    }
    let incassato = agg.map(|a| a.incassato).unwrap_or(0);
    // Residuo da incassare → da saldare (anche per un ordine ancora vuoto).
    if totale - incassato > 0 || incassato <= 0 {
        return "da_saldare".to_string();
    }
    if agg.map(|a| a.transito_aperto).unwrap_or(false) {
        return "in_attesa_accredito".to_string();
    }
    if agg.map(|a| a.non_verificati > 0).unwrap_or(false) {
        return "saldato_da_verificare".to_string();
    }
    "saldato".to_string()
}

/// Dati destinatario di un collo per il DTO. I campi `dest_*` sono override della
/// spedizione; per i record storici senza override si ricade sul cliente/medico dell'ordine.
struct DestCollo {
    cliente: String,
    indirizzo: String,
    cap: String,
    citta: String,
    prov: String,
    regione: String,
    telefono: String,
    email: String,
}

impl DestCollo {
    /// `cf` legge un campo del cliente dell'ordine; `cliente_nome` ne dà il nome.
    fn estrai(
        rec: &serde_json::Map<String, serde_json::Value>,
        cf: impl Fn(&str) -> String,
        cliente_nome: impl FnOnce() -> String,
    ) -> Self {
        let ha_override = [
            "dest_cliente",
            "dest_indirizzo",
            "dest_cap",
            "dest_citta",
            "dest_prov",
            "dest_regione",
            "dest_telefono",
            "dest_email",
        ]
        .iter()
        .any(|k| rec.contains_key(*k));

        if bool_field(rec, "manuale") || ha_override {
            DestCollo {
                cliente: str_field(rec, "dest_cliente"),
                indirizzo: str_field(rec, "dest_indirizzo"),
                cap: str_field(rec, "dest_cap"),
                citta: str_field(rec, "dest_citta"),
                prov: str_field(rec, "dest_prov"),
                regione: str_field(rec, "dest_regione"),
                telefono: str_field(rec, "dest_telefono"),
                email: str_field(rec, "dest_email"),
            }
        } else {
            DestCollo {
                cliente: cliente_nome(),
                indirizzo: cf("indirizzo"),
                cap: cf("cap"),
                citta: cf("citta"),
                prov: cf("prov"),
                regione: cf("regione"),
                telefono: cf("telefono"),
                email: cf("email"),
            }
        }
    }
}

/// Profilo di esportazione di un corriere: il campo `profilo` se impostato, altrimenti
/// dedotto dal nome (contiene "carrai" → carrai, altrimenti gls). FASE 4B.
fn profilo_corriere(nome: &str, profilo: &str) -> String {
    if !profilo.is_empty() {
        return profilo.to_string();
    }
    if nome.to_lowercase().contains("carrai") {
        "carrai".to_string()
    } else {
        "gls".to_string()
    }
}

/// Numero di righe (prodotti) per ordine. Base per i colli proposti (FASE 4).
fn righe_count_ordini(p: &crate::projection::Projection) -> HashMap<String, i64> {
    let mut out: HashMap<String, i64> = HashMap::new();
    for riga in p.list("riga_ordine").unwrap_or_default() {
        *out.entry(str_field(&riga.data, "ordine_id")).or_insert(0) += 1;
    }
    out
}

/// Linee (categorie prodotto distinte) presenti nelle righe di ciascun ordine
/// (FASE 4D). Base per il filtro per linea del Giornaliero unificato: un ordine
/// compare sotto una linea se ha **almeno una** riga di quella categoria.
fn linee_ordini(p: &crate::projection::Projection) -> HashMap<String, Vec<String>> {
    let categorie: HashMap<String, String> = p
        .list("prodotto")
        .unwrap_or_default()
        .into_iter()
        .map(|r| (r.id, str_field(&r.data, "categoria")))
        .collect();
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for riga in p.list("riga_ordine").unwrap_or_default() {
        let cat = categorie
            .get(&str_field(&riga.data, "prodotto_id"))
            .cloned()
            .unwrap_or_default();
        if cat.is_empty() {
            continue;
        }
        let v = out.entry(str_field(&riga.data, "ordine_id")).or_default();
        if !v.contains(&cat) {
            v.push(cat);
        }
    }
    for v in out.values_mut() {
        v.sort();
    }
    out
}

/// Colli di un ordine: override `colli` sul record se > 0, altrimenti il numero di
/// righe/prodotti (`fallback`). Mai inferiore a 1 se l'ordine ha righe (FASE 4).
fn colli_di(data: &serde_json::Map<String, serde_json::Value>, fallback: i64) -> i64 {
    let override_colli = i64_field(data, "colli");
    if override_colli > 0 {
        override_colli
    } else {
        fallback
    }
}

/// `true` se la riga d'ordine è già spedita (FASE 4). `spedizione_id` resta valido come
/// indicatore legacy: alcuni demo/storici possono avere il collo collegato anche senza
/// `stato_riga = spedita`.
fn riga_spedita(data: &serde_json::Map<String, serde_json::Value>) -> bool {
    str_field(data, "stato_riga") == "spedita" || !str_field(data, "spedizione_id").is_empty()
}

/// Stato di produzione di una riga (FASE 7): `""` (= da produrre) | `in_produzione` |
/// `arrivato_it`. Una riga è «in lavorazione» se è in produzione o già arrivata.
fn riga_in_lavorazione(data: &serde_json::Map<String, serde_json::Value>) -> bool {
    matches!(
        str_field(data, "stato_produzione").as_str(),
        "in_produzione" | "arrivato_it"
    ) || !str_field(data, "lotto_produzione").is_empty()
}

/// Ricalcola lo stato di **produzione** della testata DALLE RIGHE (FASE 7, specchio di
/// `aggiorna_stato_evasione`): tutte le righe `arrivato_it` → ordine «Arrivato IT»; almeno una
/// in lavorazione → «In produzione»; nessuna → torna allo `stato_pre_produzione` (fallback
/// «Confermato»). Non tocca `Rifiutato`/`Spedito`/`Chiuso` (la produzione precede la
/// spedizione; lo stato post-spedizione lo governa l'evasione). Salva/azzera il segnalibro
/// `stato_pre_produzione` come fa l'evasione col suo, così l'uscita dalla lavorazione ripristina.
fn aggiorna_stato_produzione(engine: &Engine, ordine_id: &str) -> AppResult<()> {
    let fields = engine.with_projection(|projection| {
        campi_stato_produzione(projection, ordine_id, &HashSet::new(), "")
    });
    if !fields.is_empty() {
        let fields_ref: Vec<(&str, serde_json::Value)> = fields
            .iter()
            .map(|(field, value)| (field.as_str(), value.clone()))
            .collect();
        set_fields(engine, "ordine", ordine_id, &fields_ref)?;
    }
    Ok(())
}

/// Calcola i campi derivati della testata senza emettere eventi. È condivisa dal normale
/// flusso Produzione e dalla conferma atomica della bollettazione: `arriving_rows` descrive
/// le righe che lo stesso batch sta portando ad `arrivato_it`.
fn campi_stato_produzione(
    projection: &crate::projection::Projection,
    ordine_id: &str,
    arriving_rows: &HashSet<String>,
    data_arrivo: &str,
) -> Vec<(String, serde_json::Value)> {
    let (mut total, mut working, mut arrived, mut has_new_arrival) =
        (0usize, 0usize, 0usize, false);
    for row in projection.list("riga_ordine").unwrap_or_default() {
        if str_field(&row.data, "ordine_id") != ordine_id {
            continue;
        }
        total += 1;
        let arrives_now = arriving_rows.contains(&row.id);
        has_new_arrival |= arrives_now;
        if arrives_now || riga_in_lavorazione(&row.data) {
            working += 1;
        }
        if arrives_now || str_field(&row.data, "stato_produzione") == "arrivato_it" {
            arrived += 1;
        }
    }
    let Some(order) = projection.get("ordine", ordine_id).ok().flatten() else {
        return Vec::new();
    };
    let stato = str_field(&order.data, "stato");
    let pre = str_field(&order.data, "stato_pre_produzione");
    let current_arrival_date = str_field(&order.data, "data_arrivo_it");
    if matches!(stato.as_str(), "Rifiutato" | "Spedito" | "Chiuso") || total == 0 {
        return Vec::new();
    }
    let target: String = if arrived == total {
        "Arrivato IT".into()
    } else if working > 0 {
        "In produzione".into()
    } else if pre.is_empty() {
        "Confermato".into()
    } else {
        pre.clone()
    };
    let in_lav = |s: &str| s == "In produzione" || s == "Arrivato IT";
    let mut fields: Vec<(String, serde_json::Value)> = Vec::new();
    // Alla PRIMA entrata in lavorazione salva lo stato precedente (per ripristinarlo all'uscita).
    if in_lav(&target) && !in_lav(&stato) && pre.is_empty() {
        fields.push(("stato_pre_produzione".into(), json!(stato)));
    }
    // All'uscita dalla lavorazione azzera il segnalibro.
    if !in_lav(&target) && in_lav(&stato) {
        fields.push(("stato_pre_produzione".into(), json!("")));
    }
    if stato != target {
        fields.push(("stato".into(), json!(target)));
    }
    if has_new_arrival && !data_arrivo.is_empty() && current_arrival_date.is_empty() {
        fields.push(("data_arrivo_it".into(), json!(data_arrivo)));
    }
    fields
}

/// Disfa l'invio in produzione di un ordine (FASE 5B): se è «In lavorazione» (In produzione
/// / Arrivato IT) lo riporta in coda «Da produrre» ripristinando `stato_pre_produzione`
/// (fallback `Confermato`) e azzerando i campi di produzione (lotto/date). Su ordini non in
/// lavorazione è un no-op prudente (non tocca Rifiutato, Spedito, ecc.).
fn produzione_disfa_ordine(engine: &Engine, ordine_id: &str) -> AppResult<()> {
    let (stato, pre) = engine.with_projection(|p| {
        p.get("ordine", ordine_id)
            .ok()
            .flatten()
            .map(|r| {
                (
                    str_field(&r.data, "stato"),
                    str_field(&r.data, "stato_pre_produzione"),
                )
            })
            .unwrap_or_default()
    });
    if stato != "In produzione" && stato != "Arrivato IT" {
        return Ok(());
    }
    let restore = if pre.is_empty() {
        "Confermato".to_string()
    } else {
        pre
    };
    set_fields(
        engine,
        "ordine",
        ordine_id,
        &[
            ("stato", json!(restore)),
            ("stato_pre_produzione", json!("")),
            ("lotto_produzione", json!("")),
            ("lotto_produzione_pre", json!("")),
            ("data_produzione", json!("")),
            ("data_arrivo_it", json!("")),
        ],
    )
}

/// Ricalcola lo **stato di evasione** della testata (FASE 4) dalle righe:
/// **tutte** spedite → `Spedito`; altrimenti l'ordine **resta nello stato precedente**
/// alla spedizione (memorizzato in `stato_pre_spedizione`, es. *Arrivato IT*) — non esiste
/// più uno stato "Parzialmente spedito" (rimosso in FASE 5B: non serviva a nulla). Quindi
/// una spedizione parziale **non cambia** lo stato; solo l'evasione completa porta a
/// `Spedito`, e annullarla riporta allo stato pre. Non tocca `Rifiutato`.
fn aggiorna_stato_evasione(engine: &Engine, ordine_id: &str) -> AppResult<()> {
    let (tot, spedite, stato, pre) = engine.with_projection(|p| {
        let mut tot = 0usize;
        let mut spedite = 0usize;
        for r in p.list("riga_ordine").unwrap_or_default() {
            if str_field(&r.data, "ordine_id") == ordine_id {
                tot += 1;
                if riga_spedita(&r.data) {
                    spedite += 1;
                }
            }
        }
        let (stato, pre) = p
            .get("ordine", ordine_id)
            .ok()
            .flatten()
            .map(|r| {
                (
                    str_field(&r.data, "stato"),
                    str_field(&r.data, "stato_pre_spedizione"),
                )
            })
            .unwrap_or_default();
        (tot, spedite, stato, pre)
    });
    if stato == "Rifiutato" {
        return Ok(());
    }
    if tot > 0 && spedite == tot {
        // Evasione completa → `Spedito`. Alla PRIMA entrata salva lo stato precedente,
        // così l'annullo potrà ripristinarlo (es. *Arrivato IT*).
        let mut campi: Vec<(&str, serde_json::Value)> = Vec::new();
        if stato != "Spedito" && pre.is_empty() {
            campi.push(("stato_pre_spedizione", json!(stato)));
        }
        if stato != "Spedito" {
            campi.push(("stato", json!("Spedito")));
        }
        if !campi.is_empty() {
            set_fields(engine, "ordine", ordine_id, &campi)?;
        }
    } else if stato == "Spedito" || stato == "Chiuso" {
        // Non più completamente spedito (annullo di un collo): torna allo stato pre e
        // azzera il segnalibro. Fallback `Confermato` se il segnalibro manca (dati vecchi).
        let restore = if pre.is_empty() {
            "Confermato".to_string()
        } else {
            pre
        };
        set_fields(
            engine,
            "ordine",
            ordine_id,
            &[
                ("stato", json!(restore)),
                ("stato_pre_spedizione", json!("")),
            ],
        )?;
    }
    // Spedizione parziale con ordine non già `Spedito`: nessun cambiamento di stato.
    Ok(())
}

/// Data dell'**ultima spedizione** (collo più recente) che ha spedito righe dell'ordine;
/// vuota se l'ordine non è (ancora) stato spedito. FASE 7.
fn ordine_data_spedizione(p: &crate::projection::Projection, ordine_id: &str) -> String {
    let sped_data: HashMap<String, String> = p
        .list("spedizione")
        .unwrap_or_default()
        .into_iter()
        .map(|s| (s.id, str_field(&s.data, "data")))
        .collect();
    let mut data = String::new();
    for r in p.list("riga_ordine").unwrap_or_default() {
        if str_field(&r.data, "ordine_id") != ordine_id {
            continue;
        }
        let sid = str_field(&r.data, "spedizione_id");
        if sid.is_empty() {
            continue;
        }
        if let Some(d) = sped_data.get(&sid) {
            if d.as_str() > data.as_str() {
                data = d.clone();
            }
        }
    }
    data
}

/// Ri-ancora le scadenze **legate alla spedizione** (`scad_da_spedizione`) dei pagamenti
/// saldo/rata dell'ordine a `data_sped + offset + scad_rel_giorni`, dove `offset` = 30 per i
/// conti **contrassegno/assegno** (incasso alla consegna) e 7 negli altri casi (~7 giorni
/// dopo la spedizione). `scad_rel_giorni` è la distanza della rata dalla prima del piano:
/// così il piano intero scivola a partire da «spedizione + offset», conservando la cadenza.
/// Aggiorna ANCHE i pagamenti già saldati (la scadenza resta coerente con la spedizione, come
/// richiesto) e NON tocca importi né stato. No-op se l'ordine non è spedito. FASE 7.
fn riallinea_scadenze_da_spedizione(
    engine: &Engine,
    ordine_id: &str,
    data_sped: &str,
) -> AppResult<()> {
    if data_sped.is_empty() {
        return Ok(());
    }
    let aggiornamenti: Vec<(String, String)> = engine.with_projection(|p| {
        let conti = conti_info(p);
        let mut out = Vec::new();
        for r in p.list("pagamento").unwrap_or_default() {
            if str_field(&r.data, "ordine_id") != ordine_id
                || !bool_field(&r.data, "scad_da_spedizione")
                || !matches!(str_field(&r.data, "tipo").as_str(), "saldo" | "rata")
            {
                continue;
            }
            let tipo_conto = conti
                .get(&str_field(&r.data, "conto_id"))
                .map(|(_, t, _)| t.clone())
                .unwrap_or_default();
            let base = if tipo_conto == "contrassegno" || tipo_conto == "assegno" {
                30
            } else {
                7
            };
            let rel = i64_field(&r.data, "scad_rel_giorni").max(0);
            out.push((r.id, aggiungi_giorni_iso(data_sped, base + rel)));
        }
        out
    });
    for (id, scad) in aggiornamenti {
        set_fields(engine, "pagamento", &id, &[("scadenza", json!(scad))])?;
    }
    Ok(())
}

/// Scollega le righe di una spedizione (tornano `da_spedire`), la elimina in via
/// definitiva (`Purged`) e **restituisce gli ordini coinvolti** (senza ricalcolarne lo
/// stato: lo fa il chiamante, una volta sola per ordine). FASE 4.
fn annulla_spedizione_inner(engine: &Engine, id: &str) -> AppResult<Vec<String>> {
    let esiste = engine.with_projection(|p| p.get("spedizione", id).ok().flatten().is_some());
    if !esiste {
        return Ok(Vec::new());
    }
    let righe: Vec<(String, String)> = engine.with_projection(|p| {
        p.list("riga_ordine")
            .unwrap_or_default()
            .into_iter()
            .filter(|r| str_field(&r.data, "spedizione_id") == id)
            .map(|r| (r.id, str_field(&r.data, "ordine_id")))
            .collect()
    });
    let mut ordini: Vec<String> = Vec::new();
    for (rid, oid) in &righe {
        set_fields(
            engine,
            "riga_ordine",
            rid,
            &[
                ("stato_riga", json!("da_spedire")),
                ("spedizione_id", json!("")),
            ],
        )?;
        if !oid.is_empty() && !ordini.contains(oid) {
            ordini.push(oid.clone());
        }
    }
    engine
        .emit("spedizione", id, EventBody::Purged)
        .map_err(es)?;
    let sorgenti_unite: Vec<String> = engine.with_projection(|p| {
        p.list("spedizione")
            .unwrap_or_default()
            .into_iter()
            .filter(|r| str_field(&r.data, "dest_unito_in") == id)
            .map(|r| r.id)
            .collect()
    });
    for sid in sorgenti_unite {
        engine
            .emit("spedizione", &sid, EventBody::Purged)
            .map_err(es)?;
    }
    Ok(ordini)
}

/// Totale per ordine = somma(`qta` × `prezzo`) sulle righe. In centesimi.
fn totali_ordini(p: &crate::projection::Projection) -> HashMap<String, i64> {
    let mut totali: HashMap<String, i64> = HashMap::new();
    for riga in p.list("riga_ordine").unwrap_or_default() {
        let ordine_id = str_field(&riga.data, "ordine_id");
        let qta = i64_field(&riga.data, "qta");
        let prezzo = i64_field(&riga.data, "prezzo");
        *totali.entry(ordine_id).or_insert(0) += qta * prezzo;
    }
    totali
}

/// Importo COD/assegno da proporre per una spedizione parziale:
/// somma dei prodotti spediti nel collo meno quota proporzionale dell'acconto ordine.
/// È una regola logistica della spedizione, separata dalla contabilità effettiva.
fn importo_spedizione_parziale(p: &crate::projection::Projection, spedizione_id: &str) -> i64 {
    let mut spedizioni = std::collections::HashSet::new();
    spedizioni.insert(spedizione_id.to_string());
    importi_spedizione_parziali(p, &spedizioni).values().sum()
}

/// Mantiene allineata la fotografia logistica usata nelle distinte corriere quando,
/// dopo la spedizione, una rata viene spostata su/da un conto contrassegno o assegno.
/// Il dettaglio pagamenti della spedizione è già calcolato dinamicamente; qui si
/// aggiorna anche `mezzo`/`contrassegno`, che sono i campi letti dall'export.
fn riallinea_contrassegno_spedizioni_ordine(engine: &Engine, ordine_id: &str) -> AppResult<()> {
    let aggiornamenti: Vec<(String, String, i64)> = engine.with_projection(|p| {
        let spedizioni_ids: HashSet<String> = p
            .list("riga_ordine")
            .unwrap_or_default()
            .into_iter()
            .filter(|riga| str_field(&riga.data, "ordine_id") == ordine_id)
            .map(|riga| str_field(&riga.data, "spedizione_id"))
            .filter(|id| !id.is_empty())
            .collect();
        if spedizioni_ids.is_empty() {
            return Vec::new();
        }

        let conti = conti_info(p);
        let conti_nomi: HashMap<String, String> = conti
            .iter()
            .map(|(id, (nome, _, _))| (id.clone(), nome.clone()))
            .collect();
        let conti_tipi: HashMap<String, String> = conti
            .iter()
            .map(|(id, (_, tipo, _))| (id.clone(), tipo.clone()))
            .collect();

        spedizioni_ids
            .into_iter()
            .filter_map(|spedizione_id| {
                let spedizione = p.get("spedizione", &spedizione_id).ok().flatten()?;
                let mut singola = HashSet::new();
                singola.insert(spedizione_id.clone());
                let importi = importi_spedizione_parziali(p, &singola);
                let mut pagamenti_transito = Vec::new();
                for (ordine, importo) in importi {
                    pagamenti_transito.extend(
                        pagamenti_spedizione_calcolati(
                            p,
                            &ordine,
                            importo,
                            &conti_nomi,
                            &conti_tipi,
                        )
                        .into_iter()
                        .filter(|pagamento| {
                            matches!(pagamento.conto_tipo.as_str(), "contrassegno" | "assegno")
                        }),
                    );
                }

                let mezzo = pagamenti_transito
                    .first()
                    .map(|pagamento| pagamento.conto_tipo.clone())
                    .unwrap_or_default();
                let importo = pagamenti_transito
                    .iter()
                    .map(|pagamento| pagamento.importo)
                    .sum::<i64>();
                (str_field(&spedizione.data, "mezzo") != mezzo
                    || i64_field(&spedizione.data, "contrassegno") != importo)
                    .then_some((spedizione_id, mezzo, importo))
            })
            .collect()
    });

    for (spedizione_id, mezzo, importo) in aggiornamenti {
        set_fields(
            engine,
            "spedizione",
            &spedizione_id,
            &[("mezzo", json!(mezzo)), ("contrassegno", json!(importo))],
        )?;
    }
    Ok(())
}

fn importi_spedizione_parziali(
    p: &crate::projection::Projection,
    spedizione_ids: &std::collections::HashSet<String>,
) -> HashMap<String, i64> {
    let mut righe_totali: HashMap<String, (i64, i64)> = HashMap::new(); // ordine -> (n righe, valore)
    let mut righe_spedite: HashMap<String, (i64, i64)> = HashMap::new(); // ordine -> (n righe, valore)

    for riga in p.list("riga_ordine").unwrap_or_default() {
        let ordine_id = str_field(&riga.data, "ordine_id");
        if ordine_id.is_empty() {
            continue;
        }
        let valore = i64_field(&riga.data, "prezzo") * i64_field(&riga.data, "qta");
        let tot = righe_totali.entry(ordine_id.clone()).or_default();
        tot.0 += 1;
        tot.1 += valore;
        if spedizione_ids.contains(&str_field(&riga.data, "spedizione_id")) {
            let sp = righe_spedite.entry(ordine_id).or_default();
            sp.0 += 1;
            sp.1 += valore;
        }
    }

    let mut acconti: HashMap<String, i64> = HashMap::new();
    for pag in p.list("pagamento").unwrap_or_default() {
        if str_field(&pag.data, "tipo") != "acconto" {
            continue;
        }
        let ordine_id = str_field(&pag.data, "ordine_id");
        if ordine_id.is_empty() {
            continue;
        }
        *acconti.entry(ordine_id).or_insert(0) += i64_field(&pag.data, "importo");
    }
    for ordine in p.list("ordine").unwrap_or_default() {
        acconti
            .entry(ordine.id)
            .or_insert_with(|| i64_field(&ordine.data, "acconto"));
    }

    righe_spedite
        .into_iter()
        .map(|(ordine_id, (n_spedite, valore_spedito))| {
            let n_totali = righe_totali
                .get(&ordine_id)
                .map(|(n, _)| *n)
                .unwrap_or(0)
                .max(1);
            let acconto = acconti.get(&ordine_id).copied().unwrap_or(0).max(0);
            let quota_acconto =
                ((acconto as f64 / n_totali as f64) * n_spedite as f64).round() as i64;
            (ordine_id, (valore_spedito - quota_acconto).max(0))
        })
        .collect()
}

fn pagamenti_spedizione_calcolati(
    p: &crate::projection::Projection,
    ordine_id: &str,
    importo_spedizione: i64,
    conti_nomi: &HashMap<String, String>,
    conti_tipi: &HashMap<String, String>,
) -> Vec<PagamentoSpedizioneDto> {
    if importo_spedizione <= 0 {
        return Vec::new();
    }
    let mut pagamenti: Vec<_> = p
        .list("pagamento")
        .unwrap_or_default()
        .into_iter()
        .filter(|r| {
            str_field(&r.data, "ordine_id") == ordine_id && str_field(&r.data, "tipo") != "acconto"
        })
        .collect();
    pagamenti.sort_by(|a, b| {
        let sa = str_field(&a.data, "scadenza");
        let sb = str_field(&b.data, "scadenza");
        let ka = if sa.is_empty() {
            "9999-99-99"
        } else {
            sa.as_str()
        };
        let kb = if sb.is_empty() {
            "9999-99-99"
        } else {
            sb.as_str()
        };
        ka.cmp(kb).then(a.id.cmp(&b.id))
    });

    let mut restante = importo_spedizione;
    let mut out = Vec::new();
    for r in pagamenti {
        if restante <= 0 {
            break;
        }
        let conto_id = str_field(&r.data, "conto_id");
        let importo = i64_field(&r.data, "importo").min(restante).max(0);
        if importo == 0 {
            continue;
        }
        restante -= importo;
        out.push(PagamentoSpedizioneDto {
            conto_id: conto_id.clone(),
            tipo: str_field(&r.data, "tipo"),
            importo,
            saldato: bool_field(&r.data, "saldato"),
            conto_nome: conti_nomi.get(&conto_id).cloned().unwrap_or_default(),
            conto_tipo: conti_tipi.get(&conto_id).cloned().unwrap_or_default(),
            scadenza: str_field(&r.data, "scadenza"),
        });
    }
    out
}

fn pagamenti_spedizione_calcolati_da_records(
    pagamenti: &[crate::projection::Record],
    importo_spedizione: i64,
    conti_nomi: &HashMap<String, String>,
    conti_tipi: &HashMap<String, String>,
) -> Vec<PagamentoSpedizioneDto> {
    if importo_spedizione <= 0 {
        return Vec::new();
    }

    let mut restante = importo_spedizione;
    let mut out = Vec::new();
    for r in pagamenti {
        if restante <= 0 {
            break;
        }
        let conto_id = str_field(&r.data, "conto_id");
        let importo = i64_field(&r.data, "importo").min(restante).max(0);
        if importo == 0 {
            continue;
        }
        restante -= importo;
        out.push(PagamentoSpedizioneDto {
            conto_id: conto_id.clone(),
            tipo: str_field(&r.data, "tipo"),
            importo,
            saldato: bool_field(&r.data, "saldato"),
            conto_nome: conti_nomi.get(&conto_id).cloned().unwrap_or_default(),
            conto_tipo: conti_tipi.get(&conto_id).cloned().unwrap_or_default(),
            scadenza: str_field(&r.data, "scadenza"),
        });
    }
    out
}

/// Mappa `ordine_id -> numero` `ANNO-progressivo` (es. `2026-0001`), derivata
/// dall'ordinamento per HLC di creazione e raggruppata per anno. Deterministica:
/// tutti i dispositivi convergono agli stessi numeri.
fn numeri_ordini(p: &crate::projection::Projection) -> HashMap<String, String> {
    let mut ordini = p.list("ordine").unwrap_or_default();
    ordini.sort_by(|a, b| a.created_hlc.cmp(&b.created_hlc));
    let mut contatori: HashMap<i64, u32> = HashMap::new();
    let mut out = HashMap::with_capacity(ordini.len());
    for r in ordini {
        let anno = anno_di(&str_field(&r.data, "data"), r.created_hlc.wall);
        let n = contatori.entry(anno).or_insert(0);
        *n += 1;
        out.insert(r.id, format!("{anno}-{:04}", n));
    }
    out
}

/// Mappa ordine attivo -> cliente. Serve ai DTO derivati senza duplicare dati nei record figli.
fn clienti_ordini(p: &crate::projection::Projection) -> HashMap<String, String> {
    p.list("ordine")
        .unwrap_or_default()
        .into_iter()
        .map(|r| (r.id, str_field(&r.data, "cliente_id")))
        .collect()
}

/// Configurazione provvigioni di un agente (con default applicati).
struct CfgAgente {
    nome: String,
    /// `percentuale` (default) | `fisso`.
    tipo: String,
    /// Valore **predefinito**: percentuale (es. 10 = 10%) o euro (tipo fisso).
    valore: f64,
    /// Override del valore per linea/categoria (FASE 4D): chiave = categoria in
    /// minuscolo (`immunoterapia`/`diagnostica`/`keriba`). Se presente, ha priorità
    /// sul valore predefinito per gli ordini di quella categoria; il **tipo** resta
    /// condiviso. Assente = usa il predefinito.
    valori_cat: HashMap<String, f64>,
    /// Soglia di maturazione: `spedizione` (default) | `chiuso`.
    maturazione: String,
}

impl CfgAgente {
    /// Valore di provvigione per la categoria dell'ordine (override se impostato).
    fn valore_per(&self, categoria: &str) -> f64 {
        self.valori_cat
            .get(&categoria.to_lowercase())
            .copied()
            .unwrap_or(self.valore)
    }
}

fn config_agenti(p: &crate::projection::Projection) -> HashMap<String, CfgAgente> {
    let mut cfg = HashMap::new();
    for r in p.list("agente").unwrap_or_default() {
        let tipo = str_field(&r.data, "provv_tipo");
        let maturazione = str_field(&r.data, "provv_maturazione");
        let mut valori_cat = HashMap::new();
        for cat in ["immunoterapia", "diagnostica", "keriba"] {
            if let Some(v) = r
                .data
                .get(&format!("provv_cat_{cat}"))
                .and_then(|v| v.as_f64())
            {
                valori_cat.insert(cat.to_string(), v);
            }
        }
        cfg.insert(
            r.id.clone(),
            CfgAgente {
                nome: str_field(&r.data, "nome"),
                tipo: if tipo.is_empty() {
                    "percentuale".to_string()
                } else {
                    tipo
                },
                valore: r
                    .data
                    .get("provv_valore")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0),
                valori_cat,
                maturazione: if maturazione.is_empty() {
                    "spedizione".to_string()
                } else {
                    maturazione
                },
            },
        );
    }
    cfg
}

fn config_provvigioni_globali(p: &crate::projection::Projection) -> (bool, bool) {
    p.get("parametri_globali", "agenti")
        .ok()
        .flatten()
        .map(|param| {
            (
                bool_field(&param.data, "scorpora_iva"),
                bool_field(&param.data, "detrai_spedizione"),
            )
        })
        .unwrap_or((false, false))
}

/// Insieme degli ordini la cui provvigione è **già stata pagata**: gli `ordineId`
/// elencati nelle righe dei `provv_pagamento` non annullati (i record nel Cestino
/// sono esclusi da `list`, quindi annullare un pagamento rende di nuovo pagabili i
/// suoi ordini). Usato da `provvigioni_report` per non rimostrare il già saldato.
fn ordini_provv_pagati(p: &crate::projection::Projection) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    for r in p.list("provv_pagamento").unwrap_or_default() {
        if let Some(arr) = r.data.get("righe").and_then(|v| v.as_array()) {
            for rg in arr {
                if let Some(id) = rg.get("ordineId").and_then(|v| v.as_str()) {
                    out.insert(id.to_string());
                }
            }
        }
    }
    out
}

fn valida_provv_pagamento_snapshot(
    p: &crate::projection::Projection,
    fields: &serde_json::Map<String, serde_json::Value>,
) -> AppResult<()> {
    let agente_id = fields
        .get("agente_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    if agente_id.is_empty() || p.get("agente", agente_id).map_err(es)?.is_none() {
        return Err("l'agente delle provvigioni non e' piu disponibile".into());
    }

    let righe = fields
        .get("righe")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "snapshot provvigioni non valido".to_string())?;
    if righe.is_empty() {
        return Err("nessuna provvigione da pagare".into());
    }

    let cfg = config_agenti(p);
    let conf = cfg
        .get(agente_id)
        .ok_or_else(|| "configurazione agente non piu disponibile".to_string())?;
    let pagati = ordini_provv_pagati(p);
    let totali = totali_ordini(p);
    let transito = conti_transito(p);
    let pagamenti = pagamenti_per_ordine(p, &transito);
    let (scorpora_iva, detrai_spedizione) = config_provvigioni_globali(p);

    let mut visti = HashSet::new();
    let mut totale = 0i64;
    for row in righe {
        let ordine_id = row
            .get("ordineId")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if ordine_id.is_empty() || !visti.insert(ordine_id.to_string()) {
            return Err("snapshot provvigioni non valido".into());
        }
        if pagati.contains(ordine_id) {
            return Err("una delle provvigioni selezionate risulta gia pagata".into());
        }
        let ordine = p.get("ordine", ordine_id).map_err(es)?.ok_or_else(|| {
            "uno degli ordini delle provvigioni non e' piu disponibile".to_string()
        })?;
        if str_field(&ordine.data, "agente_id") != agente_id {
            return Err("uno degli ordini non appartiene piu all'agente selezionato".into());
        }
        let stato = str_field(&ordine.data, "stato");
        if stato == "Rifiutato" || bool_field(&ordine.data, "omaggio") {
            return Err("uno degli ordini non e' piu pagabile per provvigioni".into());
        }
        let acconto_incassato = pagamenti
            .get(ordine_id)
            .map(|a| a.acconto_incassato)
            .unwrap_or(false);
        if !provvigione_maturata(&stato, &conf.maturazione) && !acconto_incassato {
            return Err("una provvigione selezionata non e' piu maturata".into());
        }

        let categoria = str_field(&ordine.data, "categoria");
        let tipo = conf.tipo.as_str();
        let valore = conf.valore_per(&categoria);
        let totale_ordine = *totali.get(ordine_id).unwrap_or(&0);
        let base = calcola_base_provvigione(
            p,
            ordine_id,
            totale_ordine,
            tipo,
            scorpora_iva,
            detrai_spedizione,
        );
        let provvigione = calcola_provvigione(base, tipo, valore);
        let snap_base = row.get("base").and_then(|v| v.as_i64()).unwrap_or(-1);
        let snap_provv = row
            .get("provvigione")
            .and_then(|v| v.as_i64())
            .unwrap_or(-1);
        if snap_base != base || snap_provv != provvigione {
            return Err("le provvigioni sono cambiate: aggiorna il report e riprova".into());
        }
        totale += provvigione;
    }

    let snap_totale = fields.get("totale").and_then(|v| v.as_i64()).unwrap_or(-1);
    if snap_totale != totale {
        return Err("il totale provvigioni non e' piu aggiornato".into());
    }
    Ok(())
}

fn calcola_base_provvigione(
    p: &crate::projection::Projection,
    _ordine_id: &str,
    totale_ordine: i64,
    tipo_provv: &str,
    scorpora_iva: bool,
    detrai_spedizione: bool,
) -> i64 {
    if tipo_provv == "fisso" {
        return totale_ordine;
    }

    let mut base = totale_ordine;

    if detrai_spedizione {
        let quota_spedizione =
            if let Some(param) = p.get("parametri_globali", "agenti").ok().flatten() {
                i64_field(&param.data, "quota_spedizione")
            } else {
                0
            };
        base = (base - quota_spedizione).max(0);
    }

    if scorpora_iva {
        base = ((base as f64) / 1.1).round() as i64;
    }

    base
}

/// Provvigione in centesimi: importo fisso (euro→centesimi) o percentuale sul totale.
fn calcola_provvigione(base: i64, tipo: &str, valore: f64) -> i64 {
    match tipo {
        "fisso" => (valore * 100.0).round() as i64,
        _ => ((base as f64) * valore / 100.0).round() as i64,
    }
}

/// `true` se l'ordine ha raggiunto la soglia di maturazione (la pipeline degli
/// stati è ordinata: … → Spedito → Chiuso).
fn provvigione_maturata(stato: &str, soglia: &str) -> bool {
    match soglia {
        "chiuso" => stato == "Chiuso",
        // "spedizione" (default): matura alla partenza merce e oltre.
        _ => stato == "Spedito" || stato == "Chiuso",
    }
}

/// `true` se lo stato conta come «spedito» (merce uscita), incluso `Chiuso`.
/// Allineato a `isSpedito` lato frontend (FASE 4E).
fn is_spedito(stato: &str) -> bool {
    stato == "Spedito" || stato == "Chiuso"
}

/// Numero di giorni civili tra due date `YYYY-MM-DD` (`a − d`). 0 se non parsabili.
fn giorni_tra(d: &str, a: &str) -> i64 {
    match (giorno_civile(d), giorno_civile(a)) {
        (Some(g0), Some(g1)) => g1 - g0,
        _ => 0,
    }
}

/// Giorni dall'epoch per una data `YYYY-MM-DD` (algoritmo di Howard Hinnant).
fn giorno_civile(data: &str) -> Option<i64> {
    if data.len() < 10 {
        return None;
    }
    let y: i64 = data[0..4].parse().ok()?;
    let m: i64 = data[5..7].parse().ok()?;
    let d: i64 = data[8..10].parse().ok()?;
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

/// Chiave ISO del bucket di una data: `YYYY-MM` se mensile, altrimenti `YYYY-MM-DD`.
fn bucket_iso(data: &str, mensile: bool) -> String {
    let n = if mensile { 7 } else { 10 };
    if data.len() >= n {
        data[..n].to_string()
    } else {
        data.to_string()
    }
}

/// Etichetta breve per l'asse: nome mese (`gen`, `feb`…) se mensile, altrimenti `gg/mm`.
fn etichetta_bucket(iso: &str, mensile: bool) -> String {
    if mensile {
        let mesi = [
            "gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic",
        ];
        if iso.len() >= 7 {
            if let Ok(m) = iso[5..7].parse::<usize>() {
                if (1..=12).contains(&m) {
                    return mesi[m - 1].to_string();
                }
            }
        }
        iso.to_string()
    } else if iso.len() >= 10 {
        format!("{}/{}", &iso[8..10], &iso[5..7])
    } else {
        iso.to_string()
    }
}

/// Anno per la numerazione: quello della data ordine (`YYYY-MM-DD`) se valida,
/// altrimenti l'anno dell'istante di creazione (`wall` dell'HLC, in ms).
fn anno_di(data: &str, wall_ms: u64) -> i64 {
    if data.len() >= 4 {
        if let Ok(y) = data[..4].parse::<i64>() {
            if (2000..=2100).contains(&y) {
                return y;
            }
        }
    }
    civil_from_unix(wall_ms / 1000).0
}

fn config_path(app_dir: &Path) -> PathBuf {
    app_dir.join("config.json")
}

fn load_config(app_dir: &Path) -> AppResult<AppConfig> {
    match fs::read(config_path(app_dir)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(AppConfig::default()),
        Err(err) => Err(err.to_string()),
    }
}

fn save_config(app_dir: &Path, cfg: &AppConfig) -> AppResult<()> {
    fs::create_dir_all(app_dir).map_err(e)?;
    let bytes = serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_path(app_dir), bytes).map_err(e)
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PC".to_string())
}

fn now_iso() -> String {
    // Timestamp ISO-8601 UTC senza dipendenze esterne (yyyy-mm-ddThh:mm:ssZ).
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = civil_from_unix(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Data (UTC) di `giorni` fa come `YYYY-MM-DD`. Usata come soglia per la chiusura
/// automatica: un saldo con data ≤ soglia ha ormai ≥ `giorni` giorni.
/// Formatta una data ISO `YYYY-MM-DD` come `DD.MM.YYYY` (formato del file Laboratorio).
/// Stringa vuota o non riconosciuta → restituita invariata. FASE 5C.
fn data_it_punti(iso: &str) -> String {
    let parti: Vec<&str> = iso.split('-').collect();
    if parti.len() == 3 && !parti[0].is_empty() {
        format!("{}.{}.{}", parti[2], parti[1], parti[0])
    } else {
        iso.to_string()
    }
}

fn data_giorni_fa(giorni: u64) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        .saturating_sub(giorni * 86_400);
    let (y, mo, d, ..) = civil_from_unix(secs);
    format!("{y:04}-{mo:02}-{d:02}")
}

/// Conversione epoch→data civile (algoritmo di Howard Hinnant), senza dipendenze.
pub(crate) fn civil_from_unix(secs: u64) -> (i64, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, mi, s) = (
        (rem / 3600) as u32,
        ((rem % 3600) / 60) as u32,
        (rem % 60) as u32,
    );
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d, h, mi, s)
}

/// Giorni dall'epoca (1970-01-01) per una data civile — inverso di `civil_from_unix`
/// (algoritmo di Howard Hinnant, senza dipendenze).
pub(crate) fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = if m > 2 { m - 3 } else { m + 9 } as i64; // [0, 11]
    let doy = (153 * mp + 2) / 5 + d as i64 - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// Converte una data ISO `YYYY-MM-DD` in giorni dall'epoca; `None` se non parsabile.
fn iso_to_days(iso: &str) -> Option<i64> {
    let p: Vec<&str> = iso.split('-').collect();
    if p.len() != 3 {
        return None;
    }
    let y = p[0].parse::<i64>().ok()?;
    let m = p[1].parse::<u32>().ok()?;
    let d = p[2].parse::<u32>().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

/// Aggiunge `giorni` (anche negativi) a una data ISO `YYYY-MM-DD`; stringa invariata se non
/// parsabile. Usa il mezzogiorno per non slittare di fuso.
fn aggiungi_giorni_iso(iso: &str, giorni: i64) -> String {
    let Some(days) = iso_to_days(iso) else {
        return iso.to_string();
    };
    let secs = ((days + giorni) * 86_400 + 43_200).max(0) as u64;
    let (y, mo, d, ..) = civil_from_unix(secs);
    format!("{y:04}-{mo:02}-{d:02}")
}

fn e(err: std::io::Error) -> String {
    err.to_string()
}
fn es<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

#[cfg(test)]
mod tests;
