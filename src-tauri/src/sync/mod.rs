//! Motore di sincronizzazione local-first su OneDrive.
//!
//! Mette insieme i pezzi (vedi `docs/ARCHITETTURA.md`):
//! - [`hlc`]      : Hybrid Logical Clock per l'ordinamento deterministico;
//! - [`event`]    : evento immutabile + NDJSON;
//! - [`log`]      : log append-only per dispositivo + lettura incrementale/recovery;
//! - [`snapshot`] : compattazione/bootstrap dello stato;
//! - [`crate::projection`] : fold degli eventi nella proiezione SQLite (read model).
//!
//! Flusso di salvataggio: `emit` scrive l'evento nel proprio `.ndjson` (durevole)
//! e lo applica subito alla proiezione locale (UI istantanea). OneDrive sincronizza
//! il file; sugli altri PC il file-watch chiama [`Engine::ingest`], che legge i nuovi
//! eventi da **tutti** i `*.ndjson` e li piega nella loro proiezione.

pub mod event;
pub mod generation;
pub mod hlc;
pub mod log;
pub mod snapshot;

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};

use crate::projection::{Projection, SnapshotData};
use crate::restore_support::{checksum_file, checksum_file_prefix};
use event::{Event, EventBody};
use generation::GenerationBarrier;
use hlc::{Hlc, HlcClock};
use log::LogStore;
use snapshot::SnapshotStore;

/// Errore del motore di sync.
#[derive(Debug)]
pub enum SyncError {
    Io(std::io::Error),
    Projection(crate::projection::ProjectionError),
    Watch(notify::Error),
    GapDetected {
        device: String,
        last_seen: String,
        first_avail: String,
    },
    CorruptLog {
        file: String,
        offset: u64,
        reason: String,
    },
    PreconditionFailed(String),
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncError::Io(e) => write!(f, "IO: {e}"),
            SyncError::Projection(e) => write!(f, "Proiezione: {e}"),
            SyncError::Watch(e) => write!(f, "File-watch: {e}"),
            SyncError::GapDetected {
                device,
                last_seen,
                first_avail,
            } => {
                write!(f, "Gap rilevato per {device}: l'evento più vecchio disponibile ({first_avail}) è più recente dell'ultimo visto ({last_seen})")
            }
            SyncError::CorruptLog {
                file,
                offset,
                reason,
            } => write!(
                f,
                "Log {file} corrotto al byte {offset}: {reason}. La riga non è stata consumata"
            ),
            SyncError::PreconditionFailed(message) => write!(f, "Conflitto: {message}"),
        }
    }
}
impl std::error::Error for SyncError {}
impl From<std::io::Error> for SyncError {
    fn from(e: std::io::Error) -> Self {
        SyncError::Io(e)
    }
}
impl From<crate::projection::ProjectionError> for SyncError {
    fn from(e: crate::projection::ProjectionError) -> Self {
        SyncError::Projection(e)
    }
}
impl From<notify::Error> for SyncError {
    fn from(e: notify::Error) -> Self {
        SyncError::Watch(e)
    }
}

pub type Result<T> = std::result::Result<T, SyncError>;

/// Mutazione elementare da rendere durevole insieme alle altre dello stesso comando.
pub(crate) struct Mutation {
    pub entity: String,
    pub entity_id: String,
    pub body: EventBody,
}

impl Mutation {
    pub(crate) fn new(
        entity: impl Into<String>,
        entity_id: impl Into<String>,
        body: EventBody,
    ) -> Self {
        Self {
            entity: entity.into(),
            entity_id: entity_id.into(),
            body,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreManifest {
    #[serde(default)]
    protocol_version: u8,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    created_at: u64,
    files: Vec<RestoreManifestFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreManifestFile {
    path: String,
    bytes: u64,
    checksum: String,
    #[serde(default)]
    validation: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RestoreRemoteStatus {
    None,
    Waiting,
    Ready,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreHandled {
    #[serde(default)]
    ids: Vec<String>,
    #[serde(default)]
    latest_anchor: Option<String>,
}

pub type ProgressReporter = Arc<dyn Fn(usize, usize, &str) + Send + Sync>;

/// Il motore di sincronizzazione. Va condiviso come `Arc<Engine>` (es. nello stato
/// Tauri) perché il watcher tiene un riferimento al motore.
pub struct Engine {
    device: String,
    events_dir: PathBuf,
    restore_handled_path: PathBuf,
    log: LogStore,
    snapshots: SnapshotStore,
    /// Anchor certificato dell'ultimo ripristino gestito (o di quello in corso).
    /// Se SQLite va ricreato, snapshot obsoleti consegnati in ritardo non vengono
    /// fusi nella nuova generazione.
    bootstrap_anchor: Option<PathBuf>,
    /// La proiezione era vuota ma l'anchor fidato locale non era ancora
    /// disponibile/leggibile. Il bootstrap resta in `waiting` e non ripiega log
    /// o snapshot alternativi finché OneDrive non lo consegna.
    bootstrap_anchor_pending: bool,
    /// Solo il motore aperto esplicitamente dal rebuild con anchor verificato può
    /// ripiegare i log mentre il marker remoto è ancora pendente.
    restore_ingest_authorized: bool,
    restore_markers_seen: Mutex<HashSet<String>>,
    restore_waiting_announced: Mutex<HashSet<String>>,
    restore_prepares_seen: Mutex<HashSet<String>>,
    restore_prepares_active: Mutex<HashSet<String>>,
    restore_cancels_seen: Mutex<HashSet<String>>,
    /// Ultima barriera già verificata (anchor + checksum). Il manifest piccolo
    /// viene riletto per scoprire nuove generazioni, ma l'anchor potenzialmente
    /// grande non viene ricalcolato a ogni polling/ingest.
    generation_cache: Mutex<Option<GenerationBarrier>>,
    clock: Mutex<HlcClock>,
    proj: Mutex<Projection>,
    /// Serializza ingest e scritture locali: una precondizione verificata non può
    /// diventare obsoleta prima dell'append del relativo batch nello stesso processo.
    mutation: Mutex<()>,
    /// Autore degli eventi (userId). Aggiornabile a caldo: l'onboarding apre il
    /// motore con un'autorità provvisoria e poi la imposta sullo userId definitivo
    /// **senza riaprire** (una sola connessione SQLite).
    user: Mutex<String>,
    /// Quando `true` il motore è in chiusura: `ingest`/`emit` diventano no-op. Serve
    /// a fermare il file-watch durante un reset (niente ri-fold concorrente).
    closed: AtomicBool,
    progress_reporter: Mutex<Option<ProgressReporter>>,
}

impl Engine {
    /// Apre il motore su una cartella dati condivisa (`data_dir`, dentro OneDrive)
    /// con la proiezione SQLite in `sqlite_path` (in `%APPDATA%`, fuori da OneDrive).
    ///
    /// Al bootstrap: se la proiezione è vergine carica l'eventuale snapshot più
    /// recente, poi ripiega i log per colmare la coda e allineare l'HLC.
    pub fn open(
        data_dir: impl AsRef<Path>,
        sqlite_path: impl AsRef<Path>,
        device: impl Into<String>,
        user: impl Into<String>,
    ) -> Result<Self> {
        Self::open_internal(data_dir, sqlite_path, device, user, None, None)
    }

    pub fn open_with_reporter(
        data_dir: impl AsRef<Path>,
        sqlite_path: impl AsRef<Path>,
        device: impl Into<String>,
        user: impl Into<String>,
        reporter: Option<ProgressReporter>,
    ) -> Result<Self> {
        Self::open_internal(data_dir, sqlite_path, device, user, None, reporter)
    }

    #[allow(dead_code)]
    pub(crate) fn open_with_restore_anchor(
        data_dir: impl AsRef<Path>,
        sqlite_path: impl AsRef<Path>,
        device: impl Into<String>,
        user: impl Into<String>,
        restore_anchor: PathBuf,
    ) -> Result<Self> {
        Self::open_internal(
            data_dir,
            sqlite_path,
            device,
            user,
            Some(restore_anchor),
            None,
        )
    }

    pub(crate) fn open_with_restore_anchor_and_reporter(
        data_dir: impl AsRef<Path>,
        sqlite_path: impl AsRef<Path>,
        device: impl Into<String>,
        user: impl Into<String>,
        restore_anchor: PathBuf,
        reporter: Option<ProgressReporter>,
    ) -> Result<Self> {
        Self::open_internal(
            data_dir,
            sqlite_path,
            device,
            user,
            Some(restore_anchor),
            reporter,
        )
    }

    fn open_internal(
        data_dir: impl AsRef<Path>,
        sqlite_path: impl AsRef<Path>,
        device: impl Into<String>,
        user: impl Into<String>,
        restore_anchor: Option<PathBuf>,
        progress_reporter: Option<ProgressReporter>,
    ) -> Result<Self> {
        let restore_ingest_authorized = restore_anchor.is_some();
        let device = device.into();
        let data_dir = data_dir.as_ref().to_path_buf();
        let sqlite_path = sqlite_path.as_ref().to_path_buf();
        let events_dir = data_dir.join("events");
        let snapshots_dir = data_dir.join("snapshots");
        let restore_handled_path = sqlite_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!("restore-handled-{device}.json"));

        let log = LogStore::new(&events_dir, &device)?;
        let snapshots = SnapshotStore::new(&snapshots_dir, &device)?;
        let mut proj = Projection::open(&sqlite_path)?;
        let generation = GenerationBarrier::load(&data_dir)?;
        let bootstrap_anchor = restore_anchor
            .or_else(|| {
                Self::restore_handled(&restore_handled_path)
                    .latest_anchor
                    .as_deref()
                    .and_then(|path| safe_manifest_path(&data_dir, path))
                    .filter(|path| path.parent() == Some(snapshots_dir.as_path()))
            })
            .or_else(|| {
                generation
                    .as_ref()
                    .and_then(|barrier| barrier.anchor(&data_dir).ok())
            });
        let mut bootstrap_anchor_pending = false;

        if proj.is_empty()? {
            match bootstrap_anchor.as_deref() {
                Some(path) => match snapshots.load(path) {
                    Ok(snapshot) => proj.import(&snapshot)?,
                    Err(_) => bootstrap_anchor_pending = true,
                },
                None => {
                    if let Some(snapshot) = snapshots.latest()? {
                        proj.import(&snapshot)?;
                    }
                }
            }
        }

        // Le vecchie tombstone non contenevano l'HLC del Purged. Quando la storia
        // è ancora nei log, lo ricaviamo prima del replay: così una Created antica
        // non può resuscitare il record solo perché il file del suo device viene
        // letto prima del file che contiene il purge.
        let tombstone_legacy = proj
            .list_purged()?
            .into_iter()
            .filter(|pg| {
                pg.purged_hlc.is_empty()
                    && matches!(pg.entity.as_str(), "preventivo" | "scheda_cliente")
            })
            .collect::<Vec<_>>();
        if !tombstone_legacy.is_empty() {
            let mut purge_hlcs = BTreeMap::new();
            let mut massimo_log: Option<Hlc> = None;
            for path in log.ndjson_files()? {
                let rr = LogStore::read_from(&path, 0)?;
                for event in rr.events {
                    if massimo_log
                        .as_ref()
                        .is_none_or(|corrente| event.ts > *corrente)
                    {
                        massimo_log = Some(event.ts.clone());
                    }
                    if matches!(event.body, EventBody::Purged) {
                        let key = (event.entity, event.entity_id);
                        let hlc = event.ts.to_string();
                        purge_hlcs
                            .entry(key)
                            .and_modify(|current: &mut String| {
                                if hlc > *current {
                                    *current = hlc.clone();
                                }
                            })
                            .or_insert(hlc);
                    }
                }
            }
            // Se il Purged non è più nei log compattati, il massimo watermark
            // dello snapshot è un limite conservativo: blocca le vecchie Created,
            // mentre il clock del motore viene portato oltre quel limite e rende
            // valida la prossima ricreazione esplicita dell'utente.
            let mut floor = Hlc::new(HlcClock::now_ms(), 0, device.clone());
            if let Some(log_hlc) = massimo_log {
                floor = floor.max(log_hlc);
            }
            for watermark in proj.watermarks()?.into_values() {
                if let Ok(hlc) = watermark.parse::<Hlc>() {
                    floor = floor.max(hlc);
                }
            }
            let floor = floor.to_string();
            for pg in tombstone_legacy {
                purge_hlcs
                    .entry((pg.entity, pg.id))
                    .or_insert_with(|| floor.clone());
            }
            proj.backfill_purged_hlcs(&purge_hlcs)?;
        }

        let bootstrap_watermarks = proj.watermarks()?;
        let restore_markers_seen = marker_restore_legacy_remoti_presenti(&events_dir, &device);
        let mut clock = HlcClock::new(device.clone());
        for watermark in bootstrap_watermarks.values() {
            if let Ok(hlc) = watermark.parse() {
                clock.bump_to(&hlc);
            }
        }
        for purged in proj.list_purged()? {
            if let Ok(hlc) = purged.purged_hlc.parse() {
                clock.bump_to(&hlc);
            }
        }
        // Un PC nuovo o rimasto con l'orologio indietro deve comunque emettere
        // sopra la frontiera generazionale. Per i device sconosciuti al checkpoint
        // gli eventi con wall <= createdAt sono intenzionalmente considerati storia.
        if let Some(barrier) = generation.as_ref() {
            clock.bump_to(&Hlc::new(
                barrier.created_at.saturating_add(1),
                0,
                device.clone(),
            ));
        }
        let engine = Engine {
            device: device.clone(),
            user: Mutex::new(user.into()),
            events_dir,
            restore_handled_path,
            log,
            snapshots,
            bootstrap_anchor,
            bootstrap_anchor_pending,
            restore_ingest_authorized,
            restore_markers_seen: Mutex::new(restore_markers_seen),
            restore_waiting_announced: Mutex::new(HashSet::new()),
            restore_prepares_seen: Mutex::new(HashSet::new()),
            restore_prepares_active: Mutex::new(HashSet::new()),
            restore_cancels_seen: Mutex::new(HashSet::new()),
            generation_cache: Mutex::new(generation),
            clock: Mutex::new(clock),
            proj: Mutex::new(proj),
            mutation: Mutex::new(()),
            closed: AtomicBool::new(false),
            progress_reporter: Mutex::new(progress_reporter),
        };

        // Un marker remoto può essere già presente all'apertura mentre OneDrive
        // sta ancora consegnando/rimuovendo i file della nuova generazione. In
        // quella finestra non ripieghiamo alcun log: anche un residuo valido della
        // generazione precedente contaminerebbe temporaneamente SQLite prima del
        // rebuild bloccante gestito dal frontend.
        let restore_remoto_in_corso = engine.restore_remoto_stato() != RestoreRemoteStatus::None;
        // In assenza di restore ripiega i log esistenti e allinea l'HLC alla
        // storia già presente.
        if !engine.bootstrap_anchor_pending
            && (engine.restore_ingest_authorized || !restore_remoto_in_corso)
        {
            engine.ingest_bootstrap()?;
        }
        Ok(engine)
    }

    fn ingest_bootstrap(&self) -> Result<()> {
        if let Err(e) = self.ingest() {
            if let SyncError::GapDetected {
                device,
                first_avail,
                ..
            } = &e
            {
                if let Some(snapshot) = self.recovery_snapshot_for_gap(device, first_avail) {
                    eprintln!("Gap rilevato all'avvio: ricostruzione automatica della proiezione.");
                    let mut proj_guard = self.proj.lock().expect("proj poisoned");
                    proj_guard.wipe_replicated()?;
                    proj_guard.import(&snapshot)?;
                    drop(proj_guard);
                    self.ingest()?;
                } else {
                    eprintln!(
                        "Gap rilevato all'avvio ma snapshot non ancora disponibile: attendo OneDrive."
                    );
                }
            } else {
                return Err(e);
            }
        }
        Ok(())
    }

    pub fn device(&self) -> &str {
        &self.device
    }

    pub fn user(&self) -> String {
        self.user.lock().expect("user poisoned").clone()
    }

    /// Imposta l'autore degli eventi successivi (es. dopo l'onboarding).
    pub fn set_user(&self, user: impl Into<String>) {
        *self.user.lock().expect("user poisoned") = user.into();
    }

    /// Imposta un reporter per notificare l'avanzamento della sincronizzazione.
    #[allow(dead_code)]
    pub fn set_progress_reporter(&self, reporter: Option<ProgressReporter>) {
        *self.progress_reporter.lock().expect("reporter poisoned") = reporter;
    }

    fn report_progress(&self, current: usize, total: usize, phase: &str) {
        if let Some(reporter) = self
            .progress_reporter
            .lock()
            .expect("reporter poisoned")
            .as_ref()
        {
            reporter(current, total, phase);
        }
    }

    /// Emette un nuovo evento locale: lo rende durevole nel log e lo applica subito
    /// alla proiezione. Restituisce l'evento creato.
    pub fn emit(
        &self,
        entity: impl Into<String>,
        entity_id: impl Into<String>,
        body: EventBody,
    ) -> Result<Event> {
        let mut events = self.emit_batch(vec![Mutation::new(entity, entity_id, body)])?;
        Ok(events.pop().expect("un evento richiesto"))
    }

    /// Emette un gruppo di eventi individuali con HLC distinti, ma li rende
    /// durevoli con un solo fsync. La semantica CRDT/LWW e il formato del log non
    /// cambiano; si elimina soltanto il costo di una sincronizzazione disco per campo.
    pub fn emit_many(
        &self,
        entity: impl Into<String>,
        entity_id: impl Into<String>,
        bodies: impl IntoIterator<Item = EventBody>,
    ) -> Result<Vec<Event>> {
        let entity = entity.into();
        let entity_id = entity_id.into();
        self.emit_batch(
            bodies
                .into_iter()
                .map(|body| Mutation::new(entity.clone(), entity_id.clone(), body))
                .collect(),
        )
    }

    /// Verifica una precondizione e deriva le mutazioni dalla stessa proiezione
    /// mantenuta sotto il lock di mutazione, quindi appende il batch eterogeneo.
    pub(crate) fn emit_built_checked<F>(&self, build: F) -> Result<Vec<Event>>
    where
        F: FnOnce(&Projection) -> std::result::Result<Vec<Mutation>, String>,
    {
        let _mutation = self.mutation.lock().expect("mutation poisoned");
        let mutations = {
            let projection = self.proj.lock().expect("proj poisoned");
            build(&projection).map_err(SyncError::PreconditionFailed)?
        };
        self.emit_batch_locked(mutations)
    }

    fn emit_batch(&self, mutations: Vec<Mutation>) -> Result<Vec<Event>> {
        let _mutation = self.mutation.lock().expect("mutation poisoned");
        self.emit_batch_locked(mutations)
    }

    fn emit_batch_locked(&self, mutations: Vec<Mutation>) -> Result<Vec<Event>> {
        if mutations.is_empty() {
            return Ok(Vec::new());
        }
        let user = self.user.lock().expect("user poisoned").clone();
        let mut clock = self.clock.lock().expect("clock poisoned");
        let events = mutations
            .into_iter()
            .map(|mutation| {
                Event::new(
                    clock.tick(),
                    &self.device,
                    &user,
                    mutation.entity,
                    mutation.entity_id,
                    mutation.body,
                )
            })
            .collect::<Vec<_>>();
        drop(clock);

        self.log.append_many(&events)?;
        let mut projection = self.proj.lock().expect("proj poisoned");
        let _ = projection.apply_batch(&events)?;
        if let Some(name) = file_name(&self.log.own_path()) {
            if let Ok(meta) = std::fs::metadata(self.log.own_path()) {
                projection.set_offset(&name, meta.len())?;
            }
        }
        Ok(events)
    }

    /// Legge i nuovi eventi da **tutti** i `*.ndjson` (inclusi eventuali
    /// "conflicted copy") e li piega nella proiezione. Idempotente.
    /// Restituisce la lista di entità modificate.
    pub fn ingest(&self) -> Result<Vec<String>> {
        if !self.restore_ingest_authorized
            && self.restore_remoto_stato() != RestoreRemoteStatus::None
        {
            return Ok(Vec::new());
        }
        let _mutation = self.mutation.lock().expect("mutation poisoned");
        let generation = self.generation_barrier()?;
        let mut modified = std::collections::HashSet::new();

        let ndjson_files = self.log.ndjson_files()?;
        let mut file_reads = Vec::with_capacity(ndjson_files.len());
        let mut total_events = 0;

        for path in ndjson_files {
            if self.closed.load(Ordering::Relaxed) {
                return Ok(modified.into_iter().collect());
            }
            let name = match file_name(&path) {
                Some(n) => n,
                None => continue,
            };
            let mut from = {
                let proj = self.proj.lock().expect("proj poisoned");
                proj.get_offset(&name)?
            };
            if let Ok(meta) = std::fs::metadata(&path) {
                if from > meta.len() {
                    from = 0;
                }
            }
            let rr = LogStore::read_from(&path, from)?;
            total_events += rr.events.len();
            file_reads.push((path, name, rr));
        }

        if total_events > 0 {
            self.report_progress(0, total_events, "Avvio sincronizzazione eventi...");
        }

        let mut processed_events = 0;
        const BATCH_SIZE: usize = 1000;

        for (path, name, rr) in file_reads {
            if self.closed.load(Ordering::Relaxed) {
                return Ok(modified.into_iter().collect());
            }

            let first_in_file = if rr.events.is_empty() {
                None
            } else {
                let from = {
                    let proj = self.proj.lock().expect("proj poisoned");
                    proj.get_offset(&name)?
                };
                if from == 0 {
                    rr.events.first().cloned()
                } else {
                    LogStore::read_first_event(&path)?
                }
            };

            if let Some(ev_first) = first_in_file.as_ref() {
                let retired = {
                    let proj = self.proj.lock().expect("proj poisoned");
                    proj.is_device_retired(&ev_first.ts.device)?
                };
                if retired {
                    let proj = self.proj.lock().expect("proj poisoned");
                    proj.set_offset(&name, rr.consumed)?;
                    continue;
                }
            }

            // Gap detection: se abbiamo già applicato eventi per questo device,
            // verifichiamo che il primissimo evento nel log su disco non sia più recente
            // del nostro max_hlc, il che indicherebbe la perdita di eventi intermedi a causa
            // di una compattazione avvenuta mentre eravamo offline.
            if let Some(ev_first) = first_in_file.as_ref() {
                self.check_gap(ev_first, generation.as_ref())?;
            }

            let valid_events: Vec<&Event> = rr
                .events
                .iter()
                .filter(|ev| {
                    !generation
                        .as_ref()
                        .is_some_and(|barrier| barrier.skips(&ev.ts))
                })
                .collect();

            for chunk in valid_events.chunks(BATCH_SIZE) {
                if self.closed.load(Ordering::Relaxed) {
                    return Ok(modified.into_iter().collect());
                }

                // Allinea l'HLC locale alla storia osservata
                {
                    let mut clock = self.clock.lock().expect("clock poisoned");
                    for ev in chunk {
                        clock.bump_to(&ev.ts);
                    }
                }

                let mut proj = self.proj.lock().expect("proj poisoned");
                if self.closed.load(Ordering::Relaxed) {
                    return Ok(modified.into_iter().collect());
                }

                let non_retired: Vec<Event> = chunk
                    .iter()
                    .filter(|ev| !proj.is_device_retired(&ev.ts.device).unwrap_or(false))
                    .map(|ev| (*ev).clone())
                    .collect();

                if !non_retired.is_empty() {
                    let changed = proj.apply_batch(&non_retired)?;
                    modified.extend(changed);
                }
                drop(proj);

                processed_events += chunk.len();
                if total_events > 0 {
                    self.report_progress(
                        processed_events,
                        total_events,
                        "Sincronizzazione eventi...",
                    );
                }
            }

            let proj = self.proj.lock().expect("proj poisoned");
            if self.closed.load(Ordering::Relaxed) {
                return Ok(modified.into_iter().collect());
            }
            proj.set_offset(&name, rr.consumed)?;

            if let Some(corruption) = rr.corruption {
                return Err(SyncError::CorruptLog {
                    file: name,
                    offset: corruption.offset,
                    reason: corruption.reason,
                });
            }
        }

        if total_events > 0 {
            self.report_progress(total_events, total_events, "Sincronizzazione completata");
        }

        Ok(modified.into_iter().collect())
    }

    /// Avvia il file-watch delle cartelle `events/` e `snapshots/`. Ogni cambiamento
    /// scatena un [`ingest`]. Guardare anche `snapshots/` permette il riallineamento
    /// automatico quando OneDrive consegna in ritardo uno snapshot necessario dopo
    /// una compattazione.
    ///
    /// Il [`RecommendedWatcher`] restituito va **mantenuto vivo**: quando viene
    /// droppato, il watch si ferma.
    ///
    /// Il watcher tiene un riferimento **debole** ([`Weak`]) al motore: così non lo
    /// mantiene in vita. Appena il motore viene rilasciato la sua connessione SQLite
    /// si chiude subito (essenziale per riaprire/cancellare il DB dopo un reset),
    /// e il watcher diventa inerte (`upgrade()` restituisce `None`).
    pub fn watch<F, W, P, C>(
        self: &Arc<Self>,
        on_change: F,
        on_wiped: W,
        on_restore_prepare: P,
        on_restore_cancelled: C,
    ) -> Result<RecommendedWatcher>
    where
        F: Fn(Vec<String>) + Send + Sync + 'static,
        W: Fn(&str) + Send + Sync + 'static,
        P: Fn(String) + Send + Sync + 'static,
        C: Fn(String) + Send + Sync + 'static,
    {
        let debole: Weak<Self> = Arc::downgrade(self);
        let mut watcher = notify::recommended_watcher(
            move |res: notify::Result<notify::Event>| {
                if let Ok(_event) = res {
                    if let Some(engine) = debole.upgrade() {
                        if engine.closed.load(Ordering::Relaxed) {
                            return;
                        }
                        if let Some(restore_id) = engine.restore_prepare_remoto_pendente() {
                            match engine.scrivi_restore_ack(&restore_id) {
                                Ok(true) => on_restore_prepare(restore_id),
                                Ok(false) => {}
                                Err(err) => eprintln!("ack ripristino fallito: {err}"),
                            }
                            return;
                        }
                        if let Some(restore_id) = engine.restore_cancel_remoto_pendente() {
                            on_restore_cancelled(restore_id);
                            return;
                        }
                        if engine.restore_remoto_pronto_da_riallineare() {
                            on_wiped("restore");
                            return;
                        }
                        if let Some(marker) = engine.restore_marker_remoto_in_attesa() {
                            let prima_segnalazione = engine
                                .restore_waiting_announced
                                .lock()
                                .expect("restore waiting poisoned")
                                .insert(marker);
                            if prima_segnalazione {
                                eprintln!(
                                    "Ripristino remoto rilevato: attendo che OneDrive consegni il payload completo."
                                );
                                // Root blocca immediatamente le viste operative e
                                // attende lo stato Ready; non prova a ricostruire su
                                // file parziali.
                                on_wiped("restore-waiting");
                            }
                            return;
                        }
                        // Controlla se la cartella events è stata cancellata o svuotata da altri
                        let missing_or_empty = engine.shared_events_missing_or_empty();

                        if missing_or_empty {
                            on_wiped("reset");
                        } else {
                            match engine.ingest() {
                                Ok(entities) => {
                                    let device_corrente_ritirato =
                                        entities.iter().any(|entity| entity == "device_retired")
                                            && engine.configured_device_is_retired();
                                    let utente_corrente_rimosso =
                                        entities.iter().any(|entity| entity == "user")
                                            && !engine.configured_user_is_active();
                                    if device_corrente_ritirato {
                                        on_wiped("device");
                                    } else if utente_corrente_rimosso {
                                        on_wiped("identity");
                                    } else if !entities.is_empty() {
                                        on_change(entities);
                                    }
                                }
                                Err(e) => {
                                    eprintln!("ingest fallito in watch: {e}");
                                    if let SyncError::GapDetected {
                                        device,
                                        first_avail,
                                        ..
                                    } = &e
                                    {
                                        if engine.snapshot_covers_gap(device, first_avail) {
                                            on_wiped("snapshot");
                                        } else {
                                            eprintln!(
                                                "Gap rilevato ma snapshot non ancora disponibile: attendo OneDrive."
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
        )?;
        watcher.watch(&self.events_dir, RecursiveMode::NonRecursive)?;
        watcher.watch(self.snapshots.dir(), RecursiveMode::NonRecursive)?;
        if let Some(meta_dir) = self.data_dir().map(|dir| dir.join("meta")) {
            let _ = std::fs::create_dir_all(&meta_dir);
            let _ = watcher.watch(&meta_dir, RecursiveMode::Recursive);
        } else if let Some(coord_dir) = self.restore_coordination_dir() {
            let _ = std::fs::create_dir_all(&coord_dir);
            watcher.watch(&coord_dir, RecursiveMode::Recursive)?;
        }
        Ok(watcher)
    }

    /// Numero di snapshot per-dispositivo conservati (retention); i più vecchi
    /// vengono eliminati. Lo storico completo resta comunque nei log e nei backup.
    const KEEP_SNAPSHOTS: usize = 1;

    /// Scrive uno snapshot dello stato corrente in `snapshots/` (con i segnalibri
    /// di lettura, per un bootstrap "solo coda") e applica la retention.
    pub fn snapshot(&self) -> Result<PathBuf> {
        let data = {
            let proj = self.proj.lock().expect("proj poisoned");
            proj.export()?
        };
        let seq = self.snapshots.next_seq()?;
        let path = self.snapshots.save(&data, seq)?;
        // La pulizia non deve far fallire lo snapshot: best-effort.
        let _ = self.snapshots.prune(Self::KEEP_SNAPSHOTS);
        Ok(path)
    }

    /// Primitive legacy usata dai test di compatibilità con i log troncati.
    #[cfg(test)]
    pub fn compact_own_log(&self, keep_recent: usize) -> Result<usize> {
        let dropped = self.log.compact(keep_recent)?;
        if dropped > 0 {
            // Il proprio file è ora più corto ma è tutto già folded: allinea l'offset
            // alla nuova lunghezza (così l'ingest non lo rilegge inutilmente).
            let proj = self.proj.lock().expect("proj poisoned");
            if let Some(name) = file_name(&self.log.own_path()) {
                if let Ok(meta) = std::fs::metadata(self.log.own_path()) {
                    proj.set_offset(&name, meta.len())?;
                }
            }
        }
        Ok(dropped)
    }

    /// Esegue una funzione di sola lettura sulla proiezione (per le query).
    pub fn with_projection<R>(&self, f: impl FnOnce(&Projection) -> R) -> R {
        let proj = self.proj.lock().expect("proj poisoned");
        f(&proj)
    }

    /// Verifica l'identità usata dal runtime contro la proiezione appena sincronizzata.
    /// Serve al watcher per invalidare subito una sessione il cui profilo è stato
    /// cancellato da un altro dispositivo.
    pub(crate) fn configured_user_is_active(&self) -> bool {
        let user = self.user.lock().expect("user poisoned").clone();
        self.with_projection(|p| {
            p.get("user", &user)
                .ok()
                .flatten()
                .map(|record| !record.deleted)
                .unwrap_or(false)
        })
    }

    /// Verifica se l'identificativo locale e' stato revocato da un'altra
    /// postazione. E' distinto dall'utente: lo stesso profilo puo' restare attivo
    /// su un altro PC mentre questo device deve comunque uscire dalle viste.
    pub(crate) fn configured_device_is_retired(&self) -> bool {
        self.with_projection(|p| p.is_device_retired(&self.device).unwrap_or(false))
    }

    /// Distingue un reset condiviso da una normale coda senza novità. I marker di
    /// restore vanno controllati prima di usare questo risultato, perché durante la
    /// consegna coordinata il payload può essere temporaneamente incompleto.
    pub(crate) fn shared_events_missing_or_empty(&self) -> bool {
        if !self.events_dir.exists() {
            return true;
        }
        match std::fs::read_dir(&self.events_dir) {
            Ok(entries) => entries
                .flatten()
                .find(|entry| {
                    entry
                        .path()
                        .extension()
                        .map(|ext| ext.eq_ignore_ascii_case("ndjson"))
                        .unwrap_or(false)
                })
                .is_none(),
            Err(_) => true,
        }
    }

    fn check_gap(&self, ev_first: &Event, generation: Option<&GenerationBarrier>) -> Result<()> {
        let event_device = ev_first.ts.device.as_str();
        let max_hlc = {
            let proj = self.proj.lock().expect("proj poisoned");
            proj.get_max_hlc_for_device(event_device)?
        };
        let Some(max_ts) = max_hlc else {
            return Ok(());
        };
        if ev_first.ts <= max_ts {
            return Ok(());
        }

        // Un log che parte oltre il cutoff è una normale coda della nuova
        // generazione soltanto quando la proiezione è esattamente sull'anchor.
        // Se max_ts è già post-cutoff, un primo evento ancora successivo prova
        // invece che è stato perso un prefisso dentro la generazione corrente.
        if generation
            .and_then(|barrier| barrier.cutoff(event_device))
            .is_some_and(|cutoff| max_ts == cutoff && ev_first.ts > cutoff)
        {
            return Ok(());
        }

        Err(SyncError::GapDetected {
            device: event_device.to_string(),
            last_seen: max_ts.to_string(),
            first_avail: ev_first.ts.to_string(),
        })
    }

    fn generation_barrier(&self) -> Result<Option<GenerationBarrier>> {
        let Some(data_dir) = self.data_dir() else {
            return Ok(None);
        };
        let path = data_dir.join(generation::GENERATION_MANIFEST_RELATIVE);
        let cached = self
            .generation_cache
            .lock()
            .expect("generation cache poisoned")
            .clone();
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            // Una cancellazione/sostituzione propagata in ordine diverso non deve
            // mai abbassare una barriera già conosciuta dal processo.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(cached),
            Err(error) => return cached.map(Some).ok_or(SyncError::Io(error)),
        };
        let preview = match serde_json::from_slice::<GenerationBarrier>(&bytes) {
            Ok(preview) => preview,
            Err(error) => {
                return cached.map(Some).ok_or_else(|| {
                    SyncError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, error))
                })
            }
        };
        if cached.as_ref() == Some(&preview) {
            return Ok(cached);
        }
        match GenerationBarrier::load(&data_dir) {
            Ok(Some(next)) => {
                *self
                    .generation_cache
                    .lock()
                    .expect("generation cache poisoned") = Some(next.clone());
                Ok(Some(next))
            }
            Ok(None) => Ok(cached),
            Err(error) => cached.map(Some).ok_or(SyncError::Io(error)),
        }
    }

    pub(crate) fn snapshot_covers_gap(&self, device: &str, first_avail: &str) -> bool {
        self.recovery_snapshot_for_gap(device, first_avail)
            .is_some()
    }

    /// Restituisce esattamente lo snapshot autorevole da importare per colmare il
    /// gap. Verifica e consumo condividono così la stessa istanza, senza approvare
    /// un anchor per poi caricarne accidentalmente un altro.
    fn recovery_snapshot_for_gap(&self, device: &str, first_avail: &str) -> Option<SnapshotData> {
        let first_avail = first_avail.parse::<Hlc>().ok()?;
        if first_avail.device != device {
            return None;
        }

        let primary = match self.bootstrap_anchor.as_deref() {
            Some(path) => self.snapshots.load(path).ok(),
            None => self.snapshots.latest().ok().flatten(),
        };
        if primary.as_ref().is_some_and(|snapshot| {
            snapshot_watermark(snapshot, device).is_some_and(|watermark| watermark >= first_avail)
        }) {
            return primary;
        }

        // Dopo una compattazione l'anchor arriva fino al cutoff, mentre il log
        // riparte dal primo evento strettamente successivo. Non deve quindi
        // raggiungere first_avail, ma deve coprire integralmente il cutoff.
        let barrier = self.generation_barrier().ok().flatten()?;
        let cutoff = barrier.cutoff(device)?;
        if first_avail <= cutoff {
            return None;
        }
        let data_dir = self.data_dir()?;
        let anchor_path = barrier.anchor(&data_dir).ok()?;
        let anchor = self.snapshots.load(&anchor_path).ok()?;
        snapshot_watermark(&anchor, device)
            .is_some_and(|watermark| watermark >= cutoff)
            .then_some(anchor)
    }

    fn data_dir(&self) -> Option<PathBuf> {
        self.events_dir.parent().map(Path::to_path_buf)
    }

    fn restore_coordination_dir(&self) -> Option<PathBuf> {
        Some(self.data_dir()?.join("meta").join("restore_coordination"))
    }

    fn restore_prepare_remoto_pendente(&self) -> Option<String> {
        let coord = self.restore_coordination_dir()?;
        self.pulisci_restore_ack_orfani(&coord);
        let entries = fs::read_dir(&coord).ok()?;
        let seen = self
            .restore_prepares_seen
            .lock()
            .expect("restore prepares poisoned");
        entries
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                let name = path.file_name()?.to_str()?.to_string();
                let restore_id = name
                    .strip_prefix("prepare-")?
                    .strip_suffix(".json")?
                    .to_string();
                if seen.contains(&restore_id) {
                    return None;
                }
                if coord.join(format!("cancelled-{restore_id}.json")).exists()
                    || coord.join(format!("committed-{restore_id}.json")).exists()
                {
                    return None;
                }
                let bytes = fs::read(path).ok()?;
                let val = serde_json::from_slice::<serde_json::Value>(&bytes).ok()?;
                let owner = val.get("deviceId").and_then(|v| v.as_str()).unwrap_or("");
                if owner == self.device {
                    return None;
                }
                Some(restore_id)
            })
            .max()
    }

    fn scrivi_restore_ack(&self, restore_id: &str) -> std::io::Result<bool> {
        let Some(data_dir) = self.data_dir() else {
            return Ok(false);
        };
        let prepare = data_dir
            .join("meta")
            .join("restore_coordination")
            .join(format!("prepare-{restore_id}.json"));
        if !prepare.exists() {
            return Ok(false);
        }
        let coord = data_dir.join("meta").join("restore_coordination");
        if coord.join(format!("cancelled-{restore_id}.json")).exists()
            || coord.join(format!("committed-{restore_id}.json")).exists()
        {
            return Ok(false);
        }
        let dir = data_dir
            .join("meta")
            .join("restore_coordination")
            .join("acks")
            .join(restore_id);
        fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{}.json", self.device));
        let payload = serde_json::json!({
            "restoreId": restore_id,
            "deviceId": self.device,
            "deviceNome": hostname_best_effort(),
            "userNome": self.user(),
            "ms": modified_now_ms(),
        });
        let tmp = dir.join(format!("{}.json.tmp", self.device));
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(
                serde_json::to_string_pretty(&payload)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?
                    .as_bytes(),
            )?;
            f.flush()?;
            f.sync_all()?;
        }
        if prepare.exists() {
            fs::rename(tmp, path)?;
        } else {
            let _ = fs::remove_file(tmp);
            return Ok(false);
        }
        self.restore_prepares_seen
            .lock()
            .expect("restore prepares poisoned")
            .insert(restore_id.to_string());
        self.restore_prepares_active
            .lock()
            .expect("restore active prepares poisoned")
            .insert(restore_id.to_string());
        Ok(true)
    }

    fn restore_cancel_remoto_pendente(&self) -> Option<String> {
        let coord = self.restore_coordination_dir()?;
        let entries = fs::read_dir(coord).ok()?;
        let candidate = {
            let seen = self
                .restore_cancels_seen
                .lock()
                .expect("restore cancels poisoned");
            entries
                .flatten()
                .filter_map(|entry| {
                    let path = entry.path();
                    let name = path.file_name()?.to_str()?.to_string();
                    let restore_id = name
                        .strip_prefix("cancelled-")?
                        .strip_suffix(".json")?
                        .to_string();
                    if seen.contains(&restore_id) {
                        return None;
                    }
                    let bytes = fs::read(path).ok()?;
                    let val = serde_json::from_slice::<serde_json::Value>(&bytes).ok()?;
                    let owner = val.get("deviceId").and_then(|v| v.as_str()).unwrap_or("");
                    if owner == self.device {
                        return None;
                    }
                    if !self
                        .restore_prepares_active
                        .lock()
                        .expect("restore active prepares poisoned")
                        .contains(&restore_id)
                    {
                        return None;
                    }
                    Some(restore_id)
                })
                .max()
        };
        if let Some(restore_id) = candidate.as_ref() {
            self.restore_cancels_seen
                .lock()
                .expect("restore cancels poisoned")
                .insert(restore_id.clone());
            self.restore_prepares_active
                .lock()
                .expect("restore active prepares poisoned")
                .remove(restore_id);
            if let Some(data_dir) = self.data_dir() {
                let _ = fs::remove_file(
                    data_dir
                        .join("meta")
                        .join("restore_coordination")
                        .join("acks")
                        .join(restore_id)
                        .join(format!("{}.json", self.device)),
                );
            }
        }
        candidate
    }

    fn pulisci_restore_ack_orfani(&self, coord: &Path) {
        let acks_root = coord.join("acks");
        let Ok(entries) = fs::read_dir(&acks_root) else {
            return;
        };
        let now = modified_now_ms();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(restore_id) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !coord.join(format!("prepare-{restore_id}.json")).exists()
                || coord.join(format!("cancelled-{restore_id}.json")).exists()
                || coord.join(format!("committed-{restore_id}.json")).exists()
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

    pub fn restore_remoto_pronto_da_riallineare(&self) -> bool {
        if self.bootstrap_anchor_pending {
            return self
                .bootstrap_anchor
                .as_deref()
                .is_some_and(|path| self.snapshots.load(path).is_ok());
        }
        let Some(marker) = self.restore_marker_remoto_pendente() else {
            return false;
        };
        if !self.payload_restore_disponibile(&marker) {
            return false;
        }
        // I marker con restoreId vengono assorbiti in modo durevole soltanto dopo
        // una ricostruzione riuscita (`segna_restore_pronti_come_gestiti`). Non li
        // consumiamo qui: se il rebuild fallisce, il polling deve poter ritentare
        // senza richiedere un riavvio dell'app.
        if self.restore_id_marker(&marker).is_some() {
            return true;
        }
        // I marker legacy non hanno un id persistibile: per loro resta necessaria
        // la deduplicazione in memoria del singolo processo.
        self.restore_markers_seen
            .lock()
            .expect("restore markers poisoned")
            .insert(marker)
    }

    pub(crate) fn restore_remoto_stato(&self) -> RestoreRemoteStatus {
        if self.bootstrap_anchor_pending {
            return match self.bootstrap_anchor.as_deref() {
                Some(path) if self.snapshots.load(path).is_ok() => RestoreRemoteStatus::Ready,
                _ => RestoreRemoteStatus::Waiting,
            };
        }
        let Some(marker) = self.restore_marker_remoto_pendente() else {
            return RestoreRemoteStatus::None;
        };
        if self.payload_restore_disponibile(&marker) {
            RestoreRemoteStatus::Ready
        } else {
            RestoreRemoteStatus::Waiting
        }
    }

    pub fn segna_restore_pronti_come_gestiti(&self) -> std::io::Result<()> {
        for (_, marker) in self.restore_markers_remoti() {
            let Some(restore_id) = self.restore_id_marker(&marker) else {
                continue;
            };
            if self.restore_id_gia_gestito(&restore_id) {
                continue;
            }
            if self.restore_manifest_disponibile(&restore_id) {
                let anchor = self.restore_anchor_manifest(&restore_id).and_then(|path| {
                    self.data_dir().and_then(|data_dir| {
                        path.strip_prefix(data_dir)
                            .ok()
                            .map(|path| path.to_string_lossy().replace('\\', "/"))
                    })
                });
                self.segna_restore_gestito(&restore_id, anchor.as_deref())?;
            }
        }
        Ok(())
    }

    /// Restituisce l'anchor v2 del ripristino remoto pronto. Il chiamante lo
    /// acquisisce prima di cancellare SQLite e marca il restore come gestito solo
    /// dopo una ricostruzione riuscita.
    pub(crate) fn restore_anchor_remoto_pronto(&self) -> Option<PathBuf> {
        if self.bootstrap_anchor_pending {
            let path = self.bootstrap_anchor.clone()?;
            return self.snapshots.load(&path).is_ok().then_some(path);
        }
        let marker = self.restore_marker_remoto_pendente()?;
        let restore_id = self.restore_id_marker(&marker)?;
        if !self.restore_manifest_disponibile(&restore_id) {
            return None;
        }
        self.restore_anchor_manifest(&restore_id)
    }

    /// Registra l'anchor prima di cancellare la proiezione. Se l'apertura del
    /// nuovo SQLite fallisce, il retry (o un riavvio) non può ricadere sulla
    /// fusione degli snapshot ordinari della generazione precedente.
    pub(crate) fn registra_restore_anchor_locale(&self, anchor: &Path) -> std::io::Result<()> {
        let data_dir = self.data_dir().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "cartella dati assente")
        })?;
        let relative = anchor.strip_prefix(&data_dir).map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "anchor fuori dalla cartella dati",
            )
        })?;
        let mut handled = Self::restore_handled(&self.restore_handled_path);
        handled.latest_anchor = Some(relative.to_string_lossy().replace('\\', "/"));
        self.scrivi_restore_handled(&handled)
    }

    pub(crate) fn restore_remoto_in_attesa(&self) -> bool {
        self.restore_remoto_stato() == RestoreRemoteStatus::Waiting
    }

    fn restore_marker_remoto_in_attesa(&self) -> Option<String> {
        self.restore_marker_remoto_pendente()
            .filter(|marker| !self.payload_restore_disponibile(marker))
    }

    fn restore_marker_remoto_pendente(&self) -> Option<String> {
        let seen = self
            .restore_markers_seen
            .lock()
            .expect("restore markers poisoned");
        let own_prefix = format!(".restore-{}-", self.device());
        let tutti_i_marker = self.restore_markers_tutti();
        let ultimo_marker_proprio_ts = tutti_i_marker
            .iter()
            .filter(|(_, name)| {
                name.starts_with(&own_prefix) && self.restore_id_marker(name).is_none()
            })
            .map(|(ts, _)| *ts)
            .max()
            .unwrap_or(0);
        let markers = tutti_i_marker
            .into_iter()
            .filter(|(_, name)| !name.starts_with(&own_prefix))
            .collect::<Vec<_>>();
        // Un marker legacy gia' presente all'apertura non richiede un rebuild:
        // snapshot e log vengono caricati direttamente dal bootstrap. Resta pero'
        // una frontiera cronologica autorevole. In particolare, il marker scritto
        // da un ritiro/compattazione deve rendere definitivamente superati i
        // manifest restore piu' vecchi, anche dopo la cancellazione dell'AppData.
        let ultimo_superato_ts = markers
            .iter()
            .filter_map(|(ts, name)| {
                if seen.contains(name) {
                    return Some(*ts);
                }
                self.restore_id_marker(name)
                    .and_then(|restore_id| self.restore_id_gia_gestito(&restore_id).then_some(*ts))
            })
            .max()
            .unwrap_or(0)
            .max(ultimo_marker_proprio_ts)
            .max(
                self.generation_barrier()
                    .ok()
                    .flatten()
                    .map(|barrier| barrier.created_at)
                    .unwrap_or(0),
            );
        markers
            .into_iter()
            .filter(|(ts, name)| {
                if *ts <= ultimo_superato_ts {
                    return false;
                }
                if seen.contains(name) {
                    return false;
                }
                self.restore_id_marker(name)
                    .map(|restore_id| !self.restore_id_gia_gestito(&restore_id))
                    .unwrap_or(true)
            })
            .max_by_key(|(ts, _)| *ts)
            .map(|(_, name)| name)
    }

    fn restore_markers_remoti(&self) -> Vec<(u64, String)> {
        let own_prefix = format!(".restore-{}-", self.device());
        self.restore_markers_tutti()
            .into_iter()
            .filter(|(_, name)| !name.starts_with(&own_prefix))
            .collect()
    }

    fn restore_markers_tutti(&self) -> Vec<(u64, String)> {
        std::fs::read_dir(&self.events_dir)
            .ok()
            .into_iter()
            .flat_map(|entries| entries.flatten())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.starts_with(".restore-") && name.ends_with(".marker"))
            .filter_map(|name| timestamp_marker_restore(&name).map(|ts| (ts, name)))
            .collect()
    }

    fn payload_restore_disponibile(&self, marker: &str) -> bool {
        if let Some(restore_id) = self.restore_id_marker(marker) {
            return self.restore_manifest_disponibile(&restore_id);
        }
        let soglia_ms = timestamp_marker_restore(marker).map(|ts| ts.saturating_sub(300_000));
        let eventi_pronti = self
            .log
            .ndjson_files()
            .map(|files| {
                files.into_iter().any(|path| {
                    soglia_ms
                        .map(|soglia| modified_ms(&path).map(|m| m >= soglia).unwrap_or(false))
                        .unwrap_or(true)
                })
            })
            .unwrap_or(false);
        if eventi_pronti {
            return true;
        }
        std::fs::read_dir(self.snapshots.dir())
            .ok()
            .into_iter()
            .flat_map(|entries| entries.flatten())
            .map(|entry| entry.path())
            .any(|path| {
                path.is_file()
                    && path
                        .extension()
                        .map(|ext| ext.eq_ignore_ascii_case("json"))
                        .unwrap_or(false)
                    && soglia_ms
                        .map(|soglia| modified_ms(&path).map(|m| m >= soglia).unwrap_or(false))
                        .unwrap_or(true)
            })
    }

    fn restore_id_marker(&self, marker: &str) -> Option<String> {
        let path = self.events_dir.join(marker);
        let bytes = fs::read(path).ok()?;
        let val = serde_json::from_slice::<serde_json::Value>(&bytes).ok()?;
        val.get("restoreId")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    }

    fn restore_manifest_disponibile(&self, restore_id: &str) -> bool {
        let Some(data_dir) = self.data_dir() else {
            return false;
        };
        let path = data_dir
            .join("meta")
            .join("restore_coordination")
            .join(format!("committed-{restore_id}.json"));
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(_) => return false,
        };
        let manifest = match serde_json::from_slice::<RestoreManifest>(&bytes) {
            Ok(manifest) => manifest,
            Err(_) => return false,
        };
        if manifest.files.is_empty() {
            return false;
        }

        // I manifest v1 sono stati prodotti nella fase in cui i log erano già la
        // fonte completa e append-only, ma elencavano anche snapshot/meta live.
        // Per retrocompatibilità basta quindi che tutti i prefissi NDJSON elencati
        // siano arrivati; se non ci sono log, resta necessaria la verifica esatta di
        // ogni file (dataset storici basati soltanto su snapshot).
        if manifest.protocol_version < 2 {
            let eventi = manifest
                .files
                .iter()
                .filter(|file| file.path.starts_with("events/") && file.path.ends_with(".ndjson"))
                .collect::<Vec<_>>();
            if !eventi.is_empty() {
                return eventi
                    .into_iter()
                    .all(|file| self.restore_file_disponibile(&data_dir, file, "prefix"));
            }
        }

        let payload_pronto = manifest.files.iter().all(|file| {
            let validation = file.validation.as_deref().unwrap_or("exact");
            self.restore_file_disponibile(&data_dir, file, validation)
        });
        let compaction_generation_ready = manifest.kind == "compaction"
            && self
                .generation_barrier()
                .ok()
                .flatten()
                .is_some_and(|barrier| barrier.generation_id == restore_id);
        payload_pronto
            && (compaction_generation_ready
                || manifest.protocol_version < 2
                || self.log_eventi_inattesi_compatibili(&data_dir, &manifest))
    }

    fn restore_anchor_manifest(&self, restore_id: &str) -> Option<PathBuf> {
        let data_dir = self.data_dir()?;
        let bytes = fs::read(
            data_dir
                .join("meta")
                .join("restore_coordination")
                .join(format!("committed-{restore_id}.json")),
        )
        .ok()?;
        let manifest = serde_json::from_slice::<RestoreManifest>(&bytes).ok()?;
        if manifest.protocol_version < 2 {
            return None;
        }
        manifest.files.iter().find_map(|file| {
            let validation = file.validation.as_deref().unwrap_or("exact");
            let anchor_restore = file.path.starts_with("snapshots/restore-anchor-");
            let anchor_compaction = manifest.kind == "compaction"
                && file
                    .path
                    .starts_with(&format!("snapshots/generation-anchor-{restore_id}-"));
            if validation != "exact"
                || (!anchor_restore && !anchor_compaction)
                || !file.path.ends_with(".json")
            {
                return None;
            }
            safe_manifest_path(&data_dir, &file.path)
        })
    }

    /// Un log non elencato può essere nato legittimamente dopo il commit (ad
    /// esempio il file vuoto del PC che torna online). Se contiene eventi più
    /// vecchi del commit è invece un residuo della generazione sostituita e il
    /// restore deve attendere la cancellazione propagata da OneDrive.
    fn log_eventi_inattesi_compatibili(&self, data_dir: &Path, manifest: &RestoreManifest) -> bool {
        let expected = manifest
            .files
            .iter()
            .filter(|file| file.path.starts_with("events/") && file.path.ends_with(".ndjson"))
            .map(|file| file.path.replace('\\', "/"))
            .collect::<HashSet<_>>();
        let Ok(mut entries) = fs::read_dir(data_dir.join("events")) else {
            return false;
        };
        entries.all(|entry| {
            let Ok(entry) = entry else {
                return false;
            };
            let path = entry.path();
            if !path.is_file()
                || !path
                    .extension()
                    .map(|ext| ext.eq_ignore_ascii_case("ndjson"))
                    .unwrap_or(false)
            {
                return true;
            }
            let relative = format!("events/{}", entry.file_name().to_string_lossy());
            if expected.contains(&relative) {
                return true;
            }
            match fs::metadata(&path) {
                Ok(meta) if meta.len() == 0 => true,
                Ok(_) if manifest.created_at > 0 => LogStore::read_first_event(&path)
                    .ok()
                    .flatten()
                    .map(|event| event.ts.wall >= manifest.created_at)
                    .unwrap_or(false),
                _ => false,
            }
        })
    }

    fn restore_file_disponibile(
        &self,
        data_dir: &Path,
        file: &RestoreManifestFile,
        validation: &str,
    ) -> bool {
        let Some(path) = safe_manifest_path(data_dir, &file.path) else {
            return false;
        };
        let Ok(meta) = fs::metadata(&path) else {
            return false;
        };
        if !meta.is_file() {
            return false;
        }
        match validation {
            "prefix" => {
                meta.len() >= file.bytes
                    && checksum_file_prefix(&path, file.bytes)
                        .map(|checksum| checksum == file.checksum)
                        .unwrap_or(false)
            }
            "exact" => {
                meta.len() == file.bytes
                    && checksum_file(&path)
                        .map(|checksum| checksum == file.checksum)
                        .unwrap_or(false)
            }
            _ => false,
        }
    }

    fn restore_id_gia_gestito(&self, restore_id: &str) -> bool {
        self.restore_ids_gestiti().contains(restore_id)
    }

    fn restore_ids_gestiti(&self) -> HashSet<String> {
        Self::restore_handled(&self.restore_handled_path)
            .ids
            .into_iter()
            .collect()
    }

    fn restore_handled(path: &Path) -> RestoreHandled {
        let Ok(bytes) = fs::read(path) else {
            return RestoreHandled::default();
        };
        serde_json::from_slice::<RestoreHandled>(&bytes).unwrap_or_else(|_| RestoreHandled {
            ids: serde_json::from_slice::<Vec<String>>(&bytes).unwrap_or_default(),
            latest_anchor: None,
        })
    }

    fn segna_restore_gestito(&self, restore_id: &str, anchor: Option<&str>) -> std::io::Result<()> {
        let mut handled = Self::restore_handled(&self.restore_handled_path);
        let mut ids = handled.ids.into_iter().collect::<HashSet<_>>();
        if !ids.insert(restore_id.to_string()) {
            return Ok(());
        }
        let mut sorted: Vec<_> = ids.into_iter().collect();
        sorted.sort();
        if sorted.len() > 50 {
            sorted = sorted.split_off(sorted.len() - 50);
        }
        handled.ids = sorted;
        if let Some(anchor) = anchor {
            handled.latest_anchor = Some(anchor.to_string());
        }
        self.scrivi_restore_handled(&handled)
    }

    fn scrivi_restore_handled(&self, handled: &RestoreHandled) -> std::io::Result<()> {
        if let Some(parent) = self.restore_handled_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = self.restore_handled_path.with_extension("json.tmp");
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(
                serde_json::to_string_pretty(&handled)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?
                    .as_bytes(),
            )?;
            f.flush()?;
            f.sync_all()?;
        }
        fs::rename(tmp, &self.restore_handled_path)
    }

    /// Mette il motore in chiusura: i successivi `ingest` (anche dal file-watch)
    /// diventano no-op. Da chiamare prima di svuotare/chiudere durante un reset.
    pub fn shutdown(&self) {
        self.closed.store(true, Ordering::Relaxed);
    }

    /// Svuota la proiezione locale (usato dal reset). Va chiamato dopo [`shutdown`].
    pub fn wipe_projection(&self) -> Result<()> {
        self.proj.lock().expect("proj poisoned").wipe()?;
        Ok(())
    }

    /// Tutti gli eventi che riguardano un record, in ordine cronologico (HLC).
    /// Rilegge i log da capo: uso on-demand per lo storico/undo.
    pub fn storia(&self, entity: &str, entity_id: &str) -> Result<Vec<Event>> {
        let mut out = Vec::new();
        let generation = self.generation_barrier()?;
        for path in self.log.ndjson_files()? {
            for ev in LogStore::read_from(&path, 0)?.events {
                if ev.entity == entity
                    && ev.entity_id == entity_id
                    && !generation
                        .as_ref()
                        .is_some_and(|barrier| barrier.skips(&ev.ts))
                {
                    out.push(ev);
                }
            }
        }
        out.sort_by(|a, b| a.ts.cmp(&b.ts));
        Ok(out)
    }
}

fn file_name(path: &Path) -> Option<String> {
    path.file_name().map(|n| n.to_string_lossy().into_owned())
}

fn marker_restore_legacy_remoti_presenti(events_dir: &Path, device: &str) -> HashSet<String> {
    let own_prefix = format!(".restore-{device}-");
    std::fs::read_dir(events_dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let legacy_marker = fs::read(entry.path())
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                .and_then(|val| {
                    val.get("restoreId")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                })
                .is_none();
            legacy_marker.then_some(name)
        })
        .filter(|name| {
            name.starts_with(".restore-")
                && name.ends_with(".marker")
                && !name.starts_with(&own_prefix)
        })
        .collect()
}

fn timestamp_marker_restore(marker: &str) -> Option<u64> {
    marker
        .strip_suffix(".marker")?
        .rsplit_once('-')?
        .1
        .parse()
        .ok()
}

fn modified_ms(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn modified_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn safe_manifest_path(data_dir: &Path, rel: &str) -> Option<PathBuf> {
    let rel_path = Path::new(rel);
    if rel_path.components().any(|c| {
        matches!(
            c,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return None;
    }
    Some(data_dir.join(rel_path))
}

fn snapshot_watermark(snapshot: &SnapshotData, device: &str) -> Option<Hlc> {
    snapshot.watermarks.get(device)?.parse::<Hlc>().ok()
}

fn hostname_best_effort() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Questo PC".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Crea un motore su `data_dir` condivisa con una proiezione SQLite dedicata.
    fn engine(data_dir: &Path, sqlite_dir: &Path, device: &str) -> Arc<Engine> {
        let sqlite = sqlite_dir.join(format!("{device}.sqlite"));
        Arc::new(Engine::open(data_dir, sqlite, device, device).unwrap())
    }

    #[test]
    fn riconosce_la_revoca_del_device_anche_se_l_utente_resta_attivo() {
        let data = tempfile::tempdir().unwrap();
        let sqlite = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sqlite.path(), "PC-A");
        let b = engine(data.path(), sqlite.path(), "PC-B");

        a.emit("device_retired", "PC-B", EventBody::Created)
            .unwrap();
        b.ingest().unwrap();

        assert!(b.configured_device_is_retired());
        assert!(!a.configured_device_is_retired());
    }

    fn set(field: &str, value: serde_json::Value) -> EventBody {
        EventBody::FieldSet {
            field: field.into(),
            value,
        }
    }

    fn empty_snapshot() -> SnapshotData {
        SnapshotData {
            records: Vec::new(),
            clocks: Vec::new(),
            applied: std::collections::BTreeMap::new(),
            offsets: std::collections::BTreeMap::new(),
            purged: Vec::new(),
            watermarks: std::collections::BTreeMap::new(),
        }
    }

    #[test]
    fn bootstrap_legacy_usa_hlc_del_purge_prima_di_ripiegare_file_in_ordine_diverso() {
        let data = tempfile::tempdir().unwrap();
        let sqlite_dir = tempfile::tempdir().unwrap();
        let events_dir = data.path().join("events");
        std::fs::create_dir_all(&events_dir).unwrap();
        let id = "preventivo/O1";
        let eventi_a = [
            Event::new(
                Hlc::new(5, 0, "PC-A"),
                "PC-A",
                "t",
                "preventivo",
                id,
                EventBody::Created,
            ),
            Event::new(
                Hlc::new(6, 0, "PC-A"),
                "PC-A",
                "t",
                "preventivo",
                id,
                set("ordine_id", json!("VECCHIO")),
            ),
            Event::new(
                Hlc::new(20, 0, "PC-A"),
                "PC-A",
                "t",
                "preventivo",
                id,
                EventBody::Created,
            ),
            Event::new(
                Hlc::new(21, 0, "PC-A"),
                "PC-A",
                "t",
                "preventivo",
                id,
                set("ordine_id", json!("NUOVO")),
            ),
        ];
        let purge = Event::new(
            Hlc::new(10, 0, "PC-Z"),
            "PC-Z",
            "t",
            "preventivo",
            id,
            EventBody::Purged,
        );
        let serializza = |eventi: &[Event]| {
            eventi
                .iter()
                .map(|event| format!("{}\n", event.to_ndjson().unwrap()))
                .collect::<String>()
        };
        std::fs::write(events_dir.join("PC-A.ndjson"), serializza(&eventi_a)).unwrap();
        std::fs::write(events_dir.join("PC-Z.ndjson"), serializza(&[purge])).unwrap();

        let sqlite = sqlite_dir.path().join("observer.sqlite");
        {
            let conn = rusqlite::Connection::open(&sqlite).unwrap();
            conn.execute_batch(
                "CREATE TABLE purged(entity TEXT NOT NULL, id TEXT NOT NULL,
                    PRIMARY KEY(entity, id));
                 CREATE TABLE applied_events(event_id TEXT PRIMARY KEY, hlc TEXT NOT NULL);
                 CREATE TABLE log_offsets(file TEXT PRIMARY KEY, offset INTEGER NOT NULL);
                 INSERT INTO purged(entity, id) VALUES
                    ('preventivo', 'preventivo/O1');",
            )
            .unwrap();
        }

        let observer = Engine::open(data.path(), sqlite, "PC-OBS", "t").unwrap();
        let record = observer
            .with_projection(|projection| projection.get("preventivo", id).unwrap())
            .unwrap();
        assert_eq!(record.data["ordine_id"], json!("NUOVO"));
        assert_eq!(record.created_hlc, Hlc::new(20, 0, "PC-A"));
    }

    #[test]
    fn tombstone_legacy_senza_storia_blocca_il_replay_ma_accetta_una_nuova_created() {
        let data = tempfile::tempdir().unwrap();
        let sqlite_dir = tempfile::tempdir().unwrap();
        let events_dir = data.path().join("events");
        std::fs::create_dir_all(&events_dir).unwrap();
        let id = "preventivo/O1";
        let created_vecchia = Event::new(
            Hlc::new(5, 0, "PC-A"),
            "PC-A",
            "t",
            "preventivo",
            id,
            EventBody::Created,
        );
        std::fs::write(
            events_dir.join("PC-A.ndjson"),
            format!("{}\n", created_vecchia.to_ndjson().unwrap()),
        )
        .unwrap();

        let sqlite = sqlite_dir.path().join("observer.sqlite");
        {
            let conn = rusqlite::Connection::open(&sqlite).unwrap();
            conn.execute_batch(
                "CREATE TABLE purged(entity TEXT NOT NULL, id TEXT NOT NULL,
                    PRIMARY KEY(entity, id));
                 CREATE TABLE applied_events(event_id TEXT PRIMARY KEY, hlc TEXT NOT NULL);
                 CREATE TABLE log_offsets(file TEXT PRIMARY KEY, offset INTEGER NOT NULL);
                 INSERT INTO purged(entity, id) VALUES
                    ('preventivo', 'preventivo/O1');",
            )
            .unwrap();
        }

        let observer = Engine::open(data.path(), sqlite, "PC-OBS", "t").unwrap();
        assert!(observer
            .with_projection(|projection| projection.get("preventivo", id).unwrap())
            .is_none());

        observer.emit("preventivo", id, EventBody::Created).unwrap();
        assert!(observer
            .with_projection(|projection| projection.get("preventivo", id).unwrap())
            .is_some());
    }

    fn publish_generation(
        data_dir: &Path,
        created_at: u64,
        mut snapshot: SnapshotData,
    ) -> GenerationBarrier {
        snapshot.applied.clear();
        snapshot.offsets.clear();
        snapshot.purged.clear();
        let generation_id = "TEST-GENERATION";
        let store = SnapshotStore::new(
            data_dir.join("snapshots"),
            format!("generation-anchor-{generation_id}"),
        )
        .unwrap();
        let anchor = store.save(&snapshot, 1).unwrap();
        let anchor_path = anchor
            .strip_prefix(data_dir)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        let barrier = GenerationBarrier {
            protocol_version: 1,
            generation_id: generation_id.into(),
            created_at,
            device_id: "PC-GENERATION".into(),
            anchor_path,
            anchor_bytes: fs::metadata(&anchor).unwrap().len(),
            anchor_checksum: checksum_file(&anchor).unwrap(),
            cutoffs: snapshot.watermarks.clone(),
        };
        barrier.write_atomic(data_dir).unwrap();
        barrier
    }

    #[test]
    fn nuovo_device_post_generazione_gestisce_append_successivi_senza_falso_gap() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let barrier = publish_generation(data.path(), 100, empty_snapshot());
        assert!(barrier.cutoff("PC-POST").is_none());

        let post = engine(data.path(), sq.path(), "PC-POST");
        let observer = engine(data.path(), sq.path(), "PC-OBSERVER");
        for i in 0..10 {
            post.emit("order", format!("O{i}"), EventBody::Created)
                .unwrap();
        }
        observer.ingest().unwrap();
        let offset_before = observer.with_projection(|p| p.get_offset("PC-POST.ndjson").unwrap());
        assert!(
            offset_before > 0,
            "il secondo ingest deve essere incrementale"
        );

        let mut last = None;
        for i in 10..27 {
            last = Some(
                post.emit("order", format!("O{i}"), EventBody::Created)
                    .unwrap(),
            );
        }
        observer.ingest().unwrap();

        let log_path = data.path().join("events/PC-POST.ndjson");
        let offset_after = observer.with_projection(|p| p.get_offset("PC-POST.ndjson").unwrap());
        assert_eq!(offset_after, fs::metadata(log_path).unwrap().len());
        assert!(offset_after > offset_before);
        assert_eq!(
            observer
                .with_projection(|p| p.get_max_hlc_for_device("PC-POST").unwrap())
                .unwrap(),
            last.unwrap().ts
        );
        assert_eq!(
            observer.with_projection(|p| p.list("order").unwrap().len()),
            27
        );
    }

    #[test]
    fn nuovo_device_post_generazione_con_prefisso_perso_segnala_gap_reale() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        publish_generation(data.path(), 100, empty_snapshot());
        let post = engine(data.path(), sq.path(), "PC-POST");
        let observer = engine(data.path(), sq.path(), "PC-OBSERVER");

        for i in 0..10 {
            post.emit("order", format!("O{i}"), EventBody::Created)
                .unwrap();
        }
        observer.ingest().unwrap();
        let offset_before = observer.with_projection(|p| p.get_offset("PC-POST.ndjson").unwrap());
        for i in 10..20 {
            post.emit("order", format!("O{i}"), EventBody::Created)
                .unwrap();
        }

        let log_path = data.path().join("events/PC-POST.ndjson");
        let complete = LogStore::read_from(&log_path, 0).unwrap().events;
        let truncated = complete
            .into_iter()
            .skip(14)
            .map(|event| format!("{}\n", event.to_ndjson().unwrap()))
            .collect::<String>();
        fs::write(&log_path, truncated).unwrap();

        let error = observer.ingest().unwrap_err();
        let (device, first_avail) = match error {
            SyncError::GapDetected {
                device,
                first_avail,
                ..
            } => (device, first_avail),
            other => panic!("atteso GapDetected, ricevuto {other}"),
        };
        assert_eq!(device, "PC-POST");
        assert!(!observer.snapshot_covers_gap(&device, &first_avail));
        assert_eq!(
            observer.with_projection(|p| p.get_offset("PC-POST.ndjson").unwrap()),
            offset_before,
            "un gap reale non deve avanzare l'offset"
        );
    }

    #[test]
    fn transizione_generazionale_richiede_cutoff_locale_e_riusa_lo_stesso_anchor() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let seed = engine(data.path(), sq.path(), "PC-A");
        let base = seed.emit("client", "BASE", EventBody::Created).unwrap();
        let anchor_snapshot = seed.with_projection(|p| p.export().unwrap());
        drop(seed);
        fs::remove_file(data.path().join("events/PC-A.ndjson")).unwrap();
        let barrier = publish_generation(data.path(), base.ts.wall, anchor_snapshot.clone());
        let cutoff = barrier.cutoff("PC-A").unwrap();

        let observer = engine(data.path(), sq.path(), "PC-OBSERVER");
        let tail = Event::new(
            Hlc::new(cutoff.wall.saturating_add(1), 0, "PC-A"),
            "PC-A",
            "PC-A",
            "client",
            "TAIL",
            EventBody::Created,
        );
        assert!(observer.check_gap(&tail, Some(&barrier)).is_ok());

        // Dopo aver già visto eventi post-cutoff, un file che inizi ancora più
        // avanti non è più una transizione generazionale: ha perso un prefisso.
        {
            let mut projection = observer.proj.lock().expect("proj poisoned");
            projection.apply(&tail).unwrap();
        }
        let later = Event::new(
            Hlc::new(cutoff.wall.saturating_add(2), 0, "PC-A"),
            "PC-A",
            "PC-A",
            "client",
            "LATER",
            EventBody::Created,
        );
        assert!(matches!(
            observer.check_gap(&later, Some(&barrier)),
            Err(SyncError::GapDetected { .. })
        ));

        let old = Event::new(
            Hlc::new(cutoff.wall.saturating_sub(1), 0, "PC-A"),
            "PC-A",
            "PC-A",
            "client",
            "OLD-ONLY",
            EventBody::Created,
        );
        {
            let mut projection = observer.proj.lock().expect("proj poisoned");
            projection.wipe().unwrap();
            projection.apply(&old).unwrap();
        }
        let gap = observer.check_gap(&tail, Some(&barrier)).unwrap_err();
        assert!(matches!(gap, SyncError::GapDetected { .. }));

        let recovered = observer
            .recovery_snapshot_for_gap("PC-A", &tail.ts.to_string())
            .expect("l'anchor deve coprire il cutoff");
        let mut expected_anchor = anchor_snapshot;
        expected_anchor.applied.clear();
        expected_anchor.offsets.clear();
        expected_anchor.purged.clear();
        assert_eq!(recovered, expected_anchor);

        fs::write(
            data.path().join("events/PC-A.ndjson"),
            format!("{}\n", tail.to_ndjson().unwrap()),
        )
        .unwrap();
        observer.ingest_bootstrap().unwrap();
        assert!(observer
            .with_projection(|p| p.get("client", "BASE").unwrap())
            .is_some());
        assert!(observer
            .with_projection(|p| p.get("client", "TAIL").unwrap())
            .is_some());
        assert!(observer
            .with_projection(|p| p.get("client", "OLD-ONLY").unwrap())
            .is_none());
    }

    #[test]
    fn snapshot_insufficiente_o_assente_non_autorizza_il_rebuild() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let mut snapshot = empty_snapshot();
        snapshot
            .watermarks
            .insert("PC-A".into(), Hlc::new(100, 0, "PC-A").to_string());
        SnapshotStore::new(data.path().join("snapshots"), "PC-SNAPSHOT")
            .unwrap()
            .save(&snapshot, 1)
            .unwrap();
        let observer = engine(data.path(), sq.path(), "PC-OBSERVER");
        let first = Hlc::new(200, 0, "PC-A").to_string();
        assert!(observer.recovery_snapshot_for_gap("PC-A", &first).is_none());
        assert!(observer.recovery_snapshot_for_gap("PC-B", &first).is_none());
        assert!(observer
            .recovery_snapshot_for_gap("PC-A", "hlc-non-valido")
            .is_none());

        let empty_data = tempfile::tempdir().unwrap();
        let empty_sq = tempfile::tempdir().unwrap();
        let empty_observer = engine(empty_data.path(), empty_sq.path(), "PC-EMPTY");
        assert!(empty_observer
            .recovery_snapshot_for_gap("PC-A", &first)
            .is_none());
    }

    #[test]
    fn batch_locale_eterogeneo_resta_durevole_ordinato_e_idempotente() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");

        let events = a
            .emit_built_checked(|_| {
                Ok(vec![
                    Mutation::new("ordine", "O1", EventBody::Created),
                    Mutation::new("ordine", "O1", set("numero", json!("O-1"))),
                    Mutation::new("riga_ordine", "R1", EventBody::Created),
                    Mutation::new("riga_ordine", "R1", set("ordine_id", json!("O1"))),
                    Mutation::new("riga_ordine", "R1", set("prodotto_nome", json!("Prodotto"))),
                ])
            })
            .unwrap();

        assert_eq!(events.len(), 5);
        assert!(events.windows(2).all(|pair| pair[0].ts < pair[1].ts));
        assert_eq!(
            events
                .iter()
                .map(|event| event.entity.as_str())
                .collect::<Vec<_>>(),
            vec![
                "ordine",
                "ordine",
                "riga_ordine",
                "riga_ordine",
                "riga_ordine"
            ]
        );

        let ordine = a
            .with_projection(|p| p.get("ordine", "O1").unwrap())
            .unwrap();
        assert_eq!(ordine.data["numero"], json!("O-1"));
        let riga = a
            .with_projection(|p| p.get("riga_ordine", "R1").unwrap())
            .unwrap();
        assert_eq!(riga.data["ordine_id"], json!("O1"));
        assert_eq!(riga.data["prodotto_nome"], json!("Prodotto"));

        let log_path = data.path().join("events").join("PC-A.ndjson");
        let persisted = LogStore::read_from(&log_path, 0).unwrap();
        assert!(persisted.corruption.is_none());
        assert_eq!(
            persisted
                .events
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            events
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>()
        );
        let log_len = std::fs::metadata(&log_path).unwrap().len();
        let offset = a.with_projection(|p| p.get_offset("PC-A.ndjson").unwrap());
        assert_eq!(offset, log_len);
        assert!(a.ingest().unwrap().is_empty());

        drop(a);
        let reopened = engine(data.path(), sq.path(), "PC-A");
        assert_eq!(
            reopened
                .with_projection(|p| p.list("ordine").unwrap())
                .len(),
            1
        );
        assert_eq!(
            reopened
                .with_projection(|p| p.list("riga_ordine").unwrap())
                .len(),
            1
        );
        assert!(reopened.ingest().unwrap().is_empty());
    }

    #[test]
    fn due_dispositivi_si_propagano_le_modifiche() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");

        a.emit("client", "C1", EventBody::Created).unwrap();
        a.emit("client", "C1", set("nome", json!("Rossi"))).unwrap();

        // B non ha ancora visto nulla finché non fa ingest (simula il file-watch).
        assert!(b
            .with_projection(|p| p.get("client", "C1").unwrap())
            .is_none());
        let n = b.ingest().unwrap();
        assert_eq!(n.len(), 1);
        let r = b
            .with_projection(|p| p.get("client", "C1").unwrap())
            .unwrap();
        assert_eq!(r.data["nome"], json!("Rossi"));
    }

    #[test]
    fn ingest_rileva_utente_corrente_rimosso_da_altro_dispositivo() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");

        a.emit("user", "PC-B", EventBody::Created).unwrap();
        b.ingest().unwrap();
        assert!(b.configured_user_is_active());

        a.emit("user", "PC-B", EventBody::Deleted).unwrap();
        let entities = b.ingest().unwrap();

        assert!(entities.iter().any(|entity| entity == "user"));
        assert!(!b.configured_user_is_active());
    }

    #[test]
    fn merge_per_campo_e_lww_tra_dispositivi() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");

        a.emit("order", "O1", EventBody::Created).unwrap();
        a.sync_round(&b);

        // Campi diversi sullo stesso ordine, da PC diversi: si fondono.
        a.emit("order", "O1", set("acconto", json!(5000))).unwrap();
        b.emit("order", "O1", set("note", json!("urgente")))
            .unwrap();
        a.sync_round(&b);
        b.sync_round(&a);

        for e in [&a, &b] {
            let r = e
                .with_projection(|p| p.get("order", "O1").unwrap())
                .unwrap();
            assert_eq!(r.data["acconto"], json!(5000), "device {}", e.device());
            assert_eq!(r.data["note"], json!("urgente"), "device {}", e.device());
        }

        // Stesso campo da entrambi: vince l'ultimo in ordine HLC, su entrambi i PC.
        a.emit("order", "O1", set("acconto", json!(1))).unwrap();
        b.ingest().unwrap();
        b.emit("order", "O1", set("acconto", json!(2))).unwrap(); // HLC più alto (osservato A)
        a.ingest().unwrap();
        b.ingest().unwrap();
        let ra = a
            .with_projection(|p| p.get("order", "O1").unwrap())
            .unwrap();
        let rb = b
            .with_projection(|p| p.get("order", "O1").unwrap())
            .unwrap();
        assert_eq!(ra.data["acconto"], rb.data["acconto"], "convergenza");
        assert_eq!(ra.data["acconto"], json!(2));
    }

    #[test]
    fn conflicted_copy_viene_assorbita_senza_duplicare() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        a.emit("client", "C1", EventBody::Created).unwrap();
        a.emit("client", "C1", set("nome", json!("Rossi"))).unwrap();

        // OneDrive crea una copia in conflitto del file di A.
        let events_dir = data.path().join("events");
        let orig = events_dir.join("PC-A.ndjson");
        let conflicted = events_dir.join("PC-A - conflicted copy.ndjson");
        std::fs::copy(&orig, &conflicted).unwrap();

        // Un terzo dispositivo ingerisce tutto: gli eventi duplicati non raddoppiano.
        let c = engine(data.path(), sq.path(), "PC-C");
        let r = c
            .with_projection(|p| p.get("client", "C1").unwrap())
            .unwrap();
        assert_eq!(r.data["nome"], json!("Rossi"));
        // La seconda ingest non applica nulla di nuovo (idempotenza).
        assert_eq!(c.ingest().unwrap().len(), 0);
    }

    #[test]
    fn conflicted_copy_divergente_non_perde_eventi_con_hlc_inferiore() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let events = data.path().join("events");
        fs::create_dir_all(&events).unwrap();
        let recente = Event::new(
            hlc::Hlc::new(20, 0, "PC-A"),
            "PC-A",
            "U1",
            "client",
            "C1",
            set("nome", json!("Rossi")),
        );
        let distinto_ma_vecchio = Event::new(
            hlc::Hlc::new(10, 0, "PC-A"),
            "PC-A",
            "U1",
            "client",
            "C1",
            set("telefono", json!("111")),
        );
        // Il nome con spazio viene ordinato prima dell'originale: il watermark sale
        // prima che venga letto l'evento distinto con HLC inferiore.
        fs::write(
            events.join("PC-A - conflicted copy.ndjson"),
            format!("{}\n", recente.to_ndjson().unwrap()),
        )
        .unwrap();
        fs::write(
            events.join("PC-A.ndjson"),
            format!("{}\n", distinto_ma_vecchio.to_ndjson().unwrap()),
        )
        .unwrap();

        let c = engine(data.path(), sq.path(), "PC-C");
        let record = c
            .with_projection(|p| p.get("client", "C1").unwrap())
            .unwrap();
        assert_eq!(record.data["nome"], json!("Rossi"));
        assert_eq!(record.data["telefono"], json!("111"));
    }

    #[test]
    fn offline_poi_riconciliazione() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");

        // B "offline": accumula modifiche senza che A le veda.
        b.emit("order", "O9", EventBody::Created).unwrap();
        b.emit("order", "O9", set("acconto", json!(3000))).unwrap();
        assert!(a
            .with_projection(|p| p.get("order", "O9").unwrap())
            .is_none());

        // B torna online -> A ingerisce e si riconcilia.
        let n = a.ingest().unwrap();
        assert_eq!(n.len(), 1);
        let r = a
            .with_projection(|p| p.get("order", "O9").unwrap())
            .unwrap();
        assert_eq!(r.data["acconto"], json!(3000));
    }

    #[test]
    fn recovery_da_riga_troncata_poi_bootstrap() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        a.emit("client", "C1", set("nome", json!("Rossi"))).unwrap();

        // Simulo un blackout: appendo byte JSON incompleti al file di A.
        let path = data.path().join("events").join("PC-A.ndjson");
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap();
            f.write_all(b"{\"id\":\"01J\",\"ts\":\"00000").unwrap();
        }

        // Un nuovo dispositivo che bootstrappa da zero ignora la riga troncata.
        let c = engine(data.path(), sq.path(), "PC-C");
        let r = c
            .with_projection(|p| p.get("client", "C1").unwrap())
            .unwrap();
        assert_eq!(r.data["nome"], json!("Rossi"));
    }

    #[test]
    fn snapshot_bootstrap_di_un_nuovo_dispositivo() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        a.emit("product", "P1", set("nome", json!("Allergene X")))
            .unwrap();
        a.emit("product", "P1", set("prezzo_base_default", json!(2500)))
            .unwrap();
        a.snapshot().unwrap();

        // Nuovo dispositivo: la proiezione vergine carica lo snapshot, poi i log.
        let d = engine(data.path(), sq.path(), "PC-D");
        let r = d
            .with_projection(|p| p.get("product", "P1").unwrap())
            .unwrap();
        assert_eq!(r.data["nome"], json!("Allergene X"));
        assert_eq!(r.data["prezzo_base_default"], json!(2500));
    }

    #[test]
    fn snapshot_con_offset_bootstrap_solo_la_coda() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        a.emit("product", "P1", set("nome", json!("X"))).unwrap();
        a.emit("product", "P1", set("prezzo", json!(1000))).unwrap();
        a.snapshot().unwrap();

        // Eventi DOPO lo snapshot: sono la "coda" che il bootstrap deve ripiegare.
        a.emit("product", "P1", set("prezzo", json!(2000))).unwrap();
        a.emit("product", "P2", set("nome", json!("Y"))).unwrap();

        // Nuovo dispositivo: importa lo snapshot (con i segnalibri) e ripiega solo la coda.
        let d = engine(data.path(), sq.path(), "PC-D");
        let p1 = d
            .with_projection(|p| p.get("product", "P1").unwrap())
            .unwrap();
        assert_eq!(p1.data["nome"], json!("X"), "stato dallo snapshot");
        assert_eq!(
            p1.data["prezzo"],
            json!(2000),
            "coda post-snapshot applicata"
        );
        let p2 = d
            .with_projection(|p| p.get("product", "P2").unwrap())
            .unwrap();
        assert_eq!(p2.data["nome"], json!("Y"));

        // Il segnalibro del log di PC-A è stato ripristinato dallo snapshot (>0):
        // la coda è stata letta da lì, non l'intera storia da capo.
        let off = d.with_projection(|p| p.get_offset("PC-A.ndjson").unwrap());
        assert!(off > 0, "offset ripristinato dallo snapshot");
    }

    #[test]
    fn compattazione_log_nessuna_perdita_su_nuovo_dispositivo() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        for i in 0..30 {
            a.emit("order", format!("O{i}"), set("n", json!(i)))
                .unwrap();
        }
        // Snapshot (cattura lo stato di tutti i 30) poi compatta tenendo solo 10.
        a.snapshot().unwrap();
        assert_eq!(
            a.compact_own_log(10).unwrap(),
            20,
            "eliminati i 20 più vecchi"
        );

        // Lo stato locale di A è intatto (aveva già folded tutto).
        assert_eq!(a.with_projection(|p| p.list("order").unwrap().len()), 30);

        // Un NUOVO dispositivo: stato dallo snapshot (O0..O29) + coda compattata
        // (O20..O29, deduplicata) → deve avere TUTTI i 30, niente perso.
        let d = engine(data.path(), sq.path(), "PC-D");
        assert_eq!(
            d.with_projection(|p| p.list("order").unwrap().len()),
            30,
            "nessun evento perso dopo la compattazione"
        );
        assert_eq!(d.ingest().unwrap().len(), 0, "idempotente");
    }

    #[test]
    fn reader_aggiornato_gestisce_il_log_compattato() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");
        for i in 0..20 {
            a.emit("order", format!("O{i}"), set("n", json!(i)))
                .unwrap();
        }
        b.ingest().unwrap(); // B ripiega tutti e 20, offset al fondo.
        assert_eq!(b.with_projection(|p| p.list("order").unwrap().len()), 20);

        // A compatta (tiene 5): il file rimpicciolisce sotto l'offset di B.
        a.compact_own_log(5).unwrap();

        // B ri-ingerisce: rileva lo shrink, rilegge la coda, dedup → nessun nuovo
        // evento e nessuna perdita.
        assert_eq!(b.ingest().unwrap().len(), 0, "niente di nuovo");
        assert_eq!(
            b.with_projection(|p| p.list("order").unwrap().len()),
            20,
            "B conserva tutti i record"
        );
    }

    #[test]
    fn pc_rimasto_indietro_si_ricostruisce_da_snapshot_su_gap() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");

        for i in 0..10 {
            a.emit("order", format!("O{i}"), set("n", json!(i)))
                .unwrap();
        }
        b.ingest().unwrap();
        assert_eq!(b.with_projection(|p| p.list("order").unwrap().len()), 10);
        b.with_projection(|p| {
            p.local_notifica_avvisata_set("u1", "suggerimento:2026:rimborso", "rimborso", 123)
                .unwrap();
            p.local_notifica_avvisata_set(
                "u2",
                "primo_rilevato:2026:produzione",
                "produzione",
                456,
            )
            .unwrap();
        });
        drop(b);

        for i in 10..30 {
            a.emit("order", format!("O{i}"), set("n", json!(i)))
                .unwrap();
        }
        a.snapshot().unwrap();
        a.compact_own_log(5).unwrap();

        let b_rebuilt = engine(data.path(), sq.path(), "PC-B");
        assert_eq!(
            b_rebuilt.with_projection(|p| p.list("order").unwrap().len()),
            30,
            "il PC indietro deve ripartire dallo snapshot e non perdere eventi compattati"
        );
        assert_eq!(
            b_rebuilt.with_projection(|p| p.local_notifica_avvisata_get_map("u1").unwrap())
                ["suggerimento:2026:rimborso"],
            123
        );
        assert_eq!(
            b_rebuilt.with_projection(|p| p.local_notifica_avvisata_get_map("u2").unwrap())
                ["primo_rilevato:2026:produzione"],
            456
        );
    }

    #[test]
    fn conflicted_copy_dopo_snapshot_non_duplica() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        a.emit("order", "O1", set("acconto", json!(5000))).unwrap();
        a.snapshot().unwrap();

        // OneDrive duplica il file di A in una "conflicted copy".
        let events = data.path().join("events");
        std::fs::copy(
            events.join("PC-A.ndjson"),
            events.join("PC-A - conflicted copy.ndjson"),
        )
        .unwrap();

        // Nuovo dispositivo: import snapshot (offset di PC-A.ndjson) + legge la
        // conflicted copy da capo, ma i clock rendono gli eventi vecchi no-op.
        let d = engine(data.path(), sq.path(), "PC-D");
        let r = d
            .with_projection(|p| p.get("order", "O1").unwrap())
            .unwrap();
        assert_eq!(r.data["acconto"], json!(5000));
        assert_eq!(
            d.ingest().unwrap().len(),
            0,
            "nessun evento nuovo applicato"
        );
    }

    #[test]
    fn conflicted_copy_vecchia_non_resuscita_purged_da_snapshot() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        a.emit("client", "C1", set("nome", json!("Rossi"))).unwrap();

        let events = data.path().join("events");
        std::fs::copy(
            events.join("PC-A.ndjson"),
            events.join("PC-A - conflicted copy.ndjson"),
        )
        .unwrap();

        a.emit("client", "C1", EventBody::Purged).unwrap();
        a.snapshot().unwrap();
        a.compact_own_log(1).unwrap();

        let d = engine(data.path(), sq.path(), "PC-D");
        assert!(d
            .with_projection(|p| p.get("client", "C1").unwrap())
            .is_none());
        assert_eq!(d.ingest().unwrap().len(), 0);
    }

    // --------------------------------------------------------------------
    // Stress test di concorrenza (verifica end-to-end del motore local-first).
    // --------------------------------------------------------------------

    /// Porta un gruppo di motori a quiescenza: ingest ripetuto su tutti finché
    /// in un giro completo nessuno applica più eventi nuovi (converge perché gli
    /// eventi sono finiti).
    fn settle(engines: &[Arc<Engine>]) {
        loop {
            let mut total = 0usize;
            for e in engines {
                total += e.ingest().unwrap().len();
            }
            if total == 0 {
                break;
            }
        }
    }

    /// Stato normalizzato di un record per il confronto di convergenza:
    /// `(deleted, {campo -> valore intero})`. `None` se il record non esiste.
    fn snap_rid(e: &Engine, rid: &str) -> Option<(bool, std::collections::BTreeMap<String, i64>)> {
        e.with_projection(|p| p.get("order", rid).unwrap())
            .map(|r| {
                let mut m = std::collections::BTreeMap::new();
                for (k, v) in r.data.iter() {
                    if let Some(n) = v.as_i64() {
                        m.insert(k.clone(), n);
                    }
                }
                (r.deleted, m)
            })
    }

    /// 4 dispositivi che scrivono **in parallelo** sugli stessi record/campi
    /// (incluse delete/restore in gara), ognuno con il proprio file di log e la
    /// propria proiezione, sulla **stessa cartella condivisa** (come OneDrive).
    ///
    /// Verifica due proprietà fondamentali del CRDT:
    /// 1. **Convergenza**: dopo la riconciliazione tutti i device vedono lo
    ///    stato identico, byte per byte.
    /// 2. **Correttezza LWW**: il valore "vincente" di ogni campo è davvero
    ///    quello con l'HLC massimo (oracolo calcolato a parte dagli HLC che
    ///    `emit` restituisce), non un esito casuale dell'interleaving.
    #[test]
    fn concorrenza_multithread_converge_ed_e_corretta() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();

        const DEVICES: usize = 4;
        const EVENTI: usize = 60;
        const RECORDS: usize = 5;
        const CAMPI: usize = 3;

        let engines: Vec<Arc<Engine>> = (0..DEVICES)
            .map(|t| engine(data.path(), sq.path(), &format!("PC-{t}")))
            .collect();

        // Oracolo condiviso: ogni evento emesso registra (rid, chiave, hlc, payload).
        // chiave = nome campo per i FieldSet, "@del" per delete/restore.
        // payload campo = valore intero; payload @del = 1 se Deleted, 0 se Restored.
        let field_ev: Mutex<Vec<(String, String, String, i64)>> = Mutex::new(Vec::new());
        let del_ev: Mutex<Vec<(String, String, bool)>> = Mutex::new(Vec::new());

        std::thread::scope(|scope| {
            for (t, eng) in engines.iter().enumerate() {
                let eng = Arc::clone(eng);
                let field_ev = &field_ev;
                let del_ev = &del_ev;
                scope.spawn(move || {
                    for i in 0..EVENTI {
                        let rid = format!("O{}", (t + i) % RECORDS);
                        // Mix di operazioni in gara: per lo più FieldSet, ogni tanto
                        // un soft-delete o un restore sullo stesso record.
                        if (t + i) % 13 == 0 {
                            let ev = eng.emit("order", &rid, EventBody::Deleted).unwrap();
                            del_ev.lock().unwrap().push((rid, ev.ts.to_string(), true));
                        } else if (t + i) % 17 == 0 {
                            let ev = eng.emit("order", &rid, EventBody::Restored).unwrap();
                            del_ev.lock().unwrap().push((rid, ev.ts.to_string(), false));
                        } else {
                            let field = format!("f{}", (t * 3 + i) % CAMPI);
                            let val = (t as i64) * 1_000_000 + i as i64; // unico globalmente
                            let ev = eng.emit("order", &rid, set(&field, json!(val))).unwrap();
                            field_ev
                                .lock()
                                .unwrap()
                                .push((rid, field, ev.ts.to_string(), val));
                        }
                        // Ogni tanto ingerisce il lavoro altrui mentre scrive: massimizza
                        // l'interleaving (lettura concorrente al fold di un altro device).
                        if i % 5 == 0 {
                            eng.ingest().unwrap();
                        }
                    }
                });
            }
        });

        // Riconciliazione finale: tutti vedono tutto.
        settle(&engines);

        // --- Proprietà 1: convergenza (tutti i device identici) ---
        for rid_n in 0..RECORDS {
            let rid = format!("O{rid_n}");
            let atteso = snap_rid(&engines[0], &rid);
            for e in &engines[1..] {
                assert_eq!(
                    snap_rid(e, &rid),
                    atteso,
                    "i device divergono sul record {rid} ({} vs PC-0)",
                    e.device()
                );
            }
        }

        // --- Proprietà 2: correttezza LWW rispetto all'oracolo HLC ---
        // Vincitore atteso di ogni campo = valore dell'evento con HLC massimo.
        let mut campo_atteso: std::collections::BTreeMap<(String, String), (String, i64)> =
            std::collections::BTreeMap::new();
        for (rid, field, ts, val) in field_ev.into_inner().unwrap() {
            let e = campo_atteso
                .entry((rid, field))
                .or_insert_with(|| (ts.clone(), val));
            if ts > e.0 {
                *e = (ts, val);
            }
        }
        let mut del_atteso: std::collections::BTreeMap<String, (String, bool)> =
            std::collections::BTreeMap::new();
        for (rid, ts, deleted) in del_ev.into_inner().unwrap() {
            let e = del_atteso
                .entry(rid)
                .or_insert_with(|| (ts.clone(), deleted));
            if ts > e.0 {
                *e = (ts, deleted);
            }
        }

        // Confronto col device 0 (gli altri sono già == per la proprietà 1).
        for ((rid, field), (_, val)) in &campo_atteso {
            let (_deleted, data) = snap_rid(&engines[0], rid)
                .unwrap_or_else(|| panic!("record {rid} mancante ma atteso"));
            assert_eq!(
                data.get(field),
                Some(val),
                "campo {field} del record {rid}: la proiezione non ha il vincitore HLC"
            );
        }
        for (rid, (_, deleted)) in &del_atteso {
            let (got_deleted, _) = snap_rid(&engines[0], rid)
                .unwrap_or_else(|| panic!("record {rid} mancante ma atteso"));
            assert_eq!(
                got_deleted, *deleted,
                "stato deleted del record {rid}: non corrisponde al vincitore HLC"
            );
        }
    }

    /// Il file-watch reale (`notify`) propaga gli eventi di un altro dispositivo
    /// **senza ingest manuale**: valida il collante OneDrive→watch→fold, non solo
    /// la logica di applicazione.
    #[test]
    fn file_watch_propaga_senza_ingest_manuale() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");

        // B osserva la cartella condivisa; il watcher va tenuto vivo.
        let _w = b.watch(|_| {}, |_| {}, |_| {}, |_| {}).unwrap();

        // A scrive: OneDrive (qui: stesso filesystem) propaga, il watch di B scatta.
        a.emit("client", "CW", EventBody::Created).unwrap();
        a.emit("client", "CW", set("nome", json!("Rossi"))).unwrap();

        // Attesa limitata: la notifica è asincrona ma deve arrivare in fretta.
        let mut visto = false;
        for _ in 0..40 {
            if let Some(r) = b.with_projection(|p| p.get("client", "CW").unwrap()) {
                if r.data.get("nome") == Some(&json!("Rossi")) {
                    visto = true;
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert!(
            visto,
            "il file-watch non ha propagato l'evento entro il timeout"
        );
    }

    #[test]
    fn file_watch_segnala_la_rimozione_dell_utente_corrente() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        a.emit("user", "PC-B", EventBody::Created).unwrap();
        let b = engine(data.path(), sq.path(), "PC-B");
        assert!(b.configured_user_is_active());

        let (tx, rx) = std::sync::mpsc::channel();
        let _w = b
            .watch(
                |_| {},
                move |_| {
                    let _ = tx.send(());
                },
                |_| {},
                |_| {},
            )
            .unwrap();

        a.emit("user", "PC-B", EventBody::Deleted).unwrap();

        rx.recv_timeout(std::time::Duration::from_secs(4))
            .expect("il watcher non ha invalidato la sessione dell'utente rimosso");
        assert!(!b.configured_user_is_active());
    }

    #[test]
    fn file_watch_segnala_snapshot_quando_un_gap_diventa_ricostruibile() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");

        for i in 0..10 {
            a.emit("order", format!("O{i}"), set("n", json!(i)))
                .unwrap();
        }
        b.ingest().unwrap();
        for i in 10..30 {
            a.emit("order", format!("O{i}"), set("n", json!(i)))
                .unwrap();
        }
        let snapshot = a.snapshot().unwrap();
        a.compact_own_log(5).unwrap();

        let (tx, rx) = std::sync::mpsc::channel();
        let _watcher = b
            .watch(
                |_| {},
                move |reason| {
                    let _ = tx.send(reason.to_string());
                },
                |_| {},
                |_| {},
            )
            .unwrap();

        // Simula la consegna/il rumore di OneDrive sullo snapshot già completo:
        // il watcher ritenta l'ingest, riconosce che il gap è ora coperto e chiede
        // al frontend il riallineamento con il motivo specifico `snapshot`.
        let bytes = fs::read(&snapshot).unwrap();
        fs::write(&snapshot, bytes).unwrap();
        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(4))
                .expect("il watcher deve chiedere il rebuild quando lo snapshot copre il gap"),
            "snapshot"
        );
    }

    #[test]
    fn file_watch_attende_payload_dopo_marker_restore() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let b = engine(data.path(), sq.path(), "PC-B");

        let (tx, rx) = std::sync::mpsc::channel();
        let _w = b
            .watch(
                |_| {},
                move |reason| {
                    let _ = tx.send(reason.to_string());
                },
                |_| {},
                |_| {},
            )
            .unwrap();

        std::fs::write(
            data.path().join("events").join(".restore-PC-A-1.marker"),
            b"restore",
        )
        .unwrap();

        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(4))
                .expect("il marker parziale deve bloccare subito la UI"),
            "restore-waiting"
        );

        let a = engine(data.path(), sq.path(), "PC-A");
        a.emit("client", "C1", EventBody::Created).unwrap();

        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(4))
                .expect("il watcher deve riallineare quando arriva il payload del restore"),
            "restore"
        );
    }

    #[test]
    fn file_watch_con_manifest_restore_attende_tutti_i_file() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");

        let (tx, rx) = std::sync::mpsc::channel();
        let _w = b
            .watch(
                |_| {},
                move |reason| {
                    let _ = tx.send(reason.to_string());
                },
                |_| {},
                |_| {},
            )
            .unwrap();

        std::fs::write(
            data.path().join("events").join(".restore-PC-A-2.marker"),
            serde_json::to_vec(&json!({ "restoreId": "R2" })).unwrap(),
        )
        .unwrap();
        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(4))
                .expect("il marker senza manifest deve bloccare subito la UI"),
            "restore-waiting"
        );
        let meta = data.path().join("meta");
        fs::create_dir_all(&meta).unwrap();
        fs::write(meta.join("rumore.tmp"), b"x").unwrap();
        assert!(
            rx.recv_timeout(std::time::Duration::from_millis(300))
                .is_err(),
            "lo stesso marker in attesa non deve tempestare log e UI"
        );

        a.emit("client", "C1", EventBody::Created).unwrap();
        let rel = "events/PC-A.ndjson";
        let path = data.path().join(rel);
        let bytes = std::fs::metadata(&path).unwrap().len();
        let checksum = checksum_file(&path).unwrap();
        let coord = data.path().join("meta").join("restore_coordination");
        std::fs::create_dir_all(&coord).unwrap();
        std::fs::write(
            coord.join("committed-R2.json"),
            serde_json::to_vec(&json!({
                "restoreId": "R2",
                "deviceId": "PC-A",
                "createdAt": 2,
                "files": [
                    { "path": rel, "bytes": bytes, "checksum": checksum }
                ]
            }))
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(4))
                .expect("il watcher deve riallineare solo quando il manifest combacia"),
            "restore"
        );
    }

    #[test]
    fn file_watch_con_manifest_restore_riprova_quando_arriva_file_meta() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let b = engine(data.path(), sq.path(), "PC-B");

        let (tx, rx) = std::sync::mpsc::channel();
        let _w = b
            .watch(
                |_| {},
                move |reason| {
                    let _ = tx.send(reason.to_string());
                },
                |_| {},
                |_| {},
            )
            .unwrap();

        std::fs::write(data.path().join("events").join("PC-A.ndjson"), b"").unwrap();
        std::fs::write(
            data.path().join("events").join(".restore-PC-A-22.marker"),
            serde_json::to_vec(&json!({ "restoreId": "R22" })).unwrap(),
        )
        .unwrap();

        let tmp = sq.path().join("avatar.bin");
        std::fs::write(&tmp, b"avatar").unwrap();
        let checksum = checksum_file(&tmp).unwrap();
        let coord = data.path().join("meta").join("restore_coordination");
        std::fs::create_dir_all(&coord).unwrap();
        std::fs::write(
            coord.join("committed-R22.json"),
            serde_json::to_vec(&json!({
                "restoreId": "R22",
                "deviceId": "PC-A",
                "createdAt": 22,
                "files": [
                    { "path": "meta/avatars/U1.png", "bytes": 6, "checksum": checksum }
                ]
            }))
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(4))
                .expect("il manifest incompleto deve bloccare subito la UI"),
            "restore-waiting"
        );

        let avatar_dir = data.path().join("meta").join("avatars");
        std::fs::create_dir_all(&avatar_dir).unwrap();
        std::fs::write(avatar_dir.join("U1.png"), b"avatar").unwrap();

        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(4))
                .expect("l'arrivo dell'ultimo file meta deve far ritentare il restore"),
            "restore"
        );
    }

    #[test]
    fn manifest_v2_accetta_log_cresciuto_ma_rifiuta_un_prefisso_diverso() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");
        a.emit("client", "C1", set("nome", json!("Nel restore")))
            .unwrap();

        let log = data.path().join("events/PC-A.ndjson");
        let bytes = fs::metadata(&log).unwrap().len();
        let checksum = checksum_file(&log).unwrap();
        let anchor = data
            .path()
            .join("snapshots/restore-anchor-R30-00000001.json");
        fs::write(&anchor, b"anchor-immutabile").unwrap();
        let anchor_bytes = fs::metadata(&anchor).unwrap().len();
        let anchor_checksum = checksum_file(&anchor).unwrap();
        let coord = data.path().join("meta/restore_coordination");
        fs::create_dir_all(&coord).unwrap();
        fs::write(
            coord.join("committed-R30.json"),
            serde_json::to_vec(&json!({
                "protocolVersion": 2,
                "restoreId": "R30",
                "deviceId": "PC-A",
                "createdAt": 30,
                "files": [
                    { "path": "events/PC-A.ndjson", "bytes": bytes, "checksum": checksum, "validation": "prefix" },
                    { "path": "snapshots/restore-anchor-R30-00000001.json", "bytes": anchor_bytes, "checksum": anchor_checksum, "validation": "exact" }
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(
            data.path().join("events/.restore-PC-A-30.marker"),
            serde_json::to_vec(&json!({ "restoreId": "R30" })).unwrap(),
        )
        .unwrap();

        assert_eq!(b.restore_remoto_stato(), RestoreRemoteStatus::Ready);
        a.emit("client", "C2", set("nome", json!("Dopo il restore")))
            .unwrap();
        assert_eq!(
            b.restore_remoto_stato(),
            RestoreRemoteStatus::Ready,
            "la coda append-only successiva non invalida il commit"
        );

        let mut contenuto = fs::read(&log).unwrap();
        contenuto[0] ^= 1;
        fs::write(&log, contenuto).unwrap();
        assert_eq!(
            b.restore_remoto_stato(),
            RestoreRemoteStatus::Waiting,
            "un prefisso alterato non deve essere scambiato per il payload ripristinato"
        );
    }

    #[test]
    fn manifest_v2_attende_anchor_esatto_anche_se_i_log_sono_arrivati() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");
        a.emit("client", "C1", EventBody::Created).unwrap();
        let log = data.path().join("events/PC-A.ndjson");
        let log_bytes = fs::metadata(&log).unwrap().len();
        let log_checksum = checksum_file(&log).unwrap();
        let sorgente_anchor = sq.path().join("anchor.json");
        fs::write(&sorgente_anchor, b"snapshot-completo").unwrap();
        let anchor_bytes = fs::metadata(&sorgente_anchor).unwrap().len();
        let anchor_checksum = checksum_file(&sorgente_anchor).unwrap();
        let coord = data.path().join("meta/restore_coordination");
        fs::create_dir_all(&coord).unwrap();
        fs::write(
            coord.join("committed-R31.json"),
            serde_json::to_vec(&json!({
                "protocolVersion": 2,
                "files": [
                    { "path": "events/PC-A.ndjson", "bytes": log_bytes, "checksum": log_checksum, "validation": "prefix" },
                    { "path": "snapshots/restore-anchor-R31-00000001.json", "bytes": anchor_bytes, "checksum": anchor_checksum, "validation": "exact" }
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(
            data.path().join("events/.restore-PC-A-31.marker"),
            serde_json::to_vec(&json!({ "restoreId": "R31" })).unwrap(),
        )
        .unwrap();
        assert_eq!(b.restore_remoto_stato(), RestoreRemoteStatus::Waiting);

        let anchor = data
            .path()
            .join("snapshots/restore-anchor-R31-00000001.json");
        fs::copy(&sorgente_anchor, anchor).unwrap();
        assert_eq!(b.restore_remoto_stato(), RestoreRemoteStatus::Ready);
    }

    #[test]
    fn manifest_v2_blocca_log_vecchi_estranei_ma_accetta_quelli_nati_dopo_il_commit() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");
        a.emit("client", "C1", EventBody::Created).unwrap();
        let log = data.path().join("events/PC-A.ndjson");
        let log_bytes = fs::metadata(&log).unwrap().len();
        let log_checksum = checksum_file(&log).unwrap();
        let anchor = data
            .path()
            .join("snapshots/restore-anchor-R33-00000001.json");
        fs::write(&anchor, b"anchor").unwrap();
        let anchor_bytes = fs::metadata(&anchor).unwrap().len();
        let anchor_checksum = checksum_file(&anchor).unwrap();
        let coord = data.path().join("meta/restore_coordination");
        fs::create_dir_all(&coord).unwrap();
        fs::write(
            coord.join("committed-R33.json"),
            serde_json::to_vec(&json!({
                "protocolVersion": 2,
                "createdAt": 200,
                "files": [
                    { "path": "events/PC-A.ndjson", "bytes": log_bytes, "checksum": log_checksum, "validation": "prefix" },
                    { "path": "snapshots/restore-anchor-R33-00000001.json", "bytes": anchor_bytes, "checksum": anchor_checksum, "validation": "exact" }
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(
            data.path().join("events/.restore-PC-A-33.marker"),
            serde_json::to_vec(&json!({ "restoreId": "R33" })).unwrap(),
        )
        .unwrap();
        assert_eq!(b.restore_remoto_stato(), RestoreRemoteStatus::Ready);

        let vecchio = Event::new(
            hlc::Hlc::new(100, 0, "PC-VECCHIO"),
            "PC-VECCHIO",
            "utente",
            "client",
            "C-VECCHIO",
            EventBody::Created,
        );
        fs::write(
            data.path().join("events/PC-VECCHIO.ndjson"),
            format!("{}\n", vecchio.to_ndjson().unwrap()),
        )
        .unwrap();
        assert_eq!(
            b.restore_remoto_stato(),
            RestoreRemoteStatus::Waiting,
            "un log della generazione precedente non deve resuscitare dati esclusi dal backup"
        );
        let c = engine(data.path(), sq.path(), "PC-C-RIENTRATO");
        assert_eq!(c.restore_remoto_stato(), RestoreRemoteStatus::Waiting);
        assert!(c.ingest().unwrap().is_empty());
        assert!(
            c.with_projection(|projection| projection.get("client", "C-VECCHIO").unwrap())
                .is_none(),
            "un avvio durante waiting non deve ingerire neppure temporaneamente il log estraneo"
        );

        fs::remove_file(data.path().join("events/PC-VECCHIO.ndjson")).unwrap();
        let nuovo = Event::new(
            hlc::Hlc::new(300, 0, "PC-NUOVO"),
            "PC-NUOVO",
            "utente",
            "client",
            "C-NUOVO",
            EventBody::Created,
        );
        fs::write(
            data.path().join("events/PC-NUOVO.ndjson"),
            format!("{}\n", nuovo.to_ndjson().unwrap()),
        )
        .unwrap();
        assert_eq!(
            b.restore_remoto_stato(),
            RestoreRemoteStatus::Ready,
            "un log nato dopo il commit è una coda concorrente legittima"
        );
    }

    #[test]
    fn manifest_v1_stale_con_snapshot_sostituito_usa_il_prefisso_canonico_dei_log() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        let b = engine(data.path(), sq.path(), "PC-B");
        a.emit("client", "C1", EventBody::Created).unwrap();
        let log = data.path().join("events/PC-A.ndjson");
        let bytes = fs::metadata(&log).unwrap().len();
        let checksum = checksum_file(&log).unwrap();
        let coord = data.path().join("meta/restore_coordination");
        fs::create_dir_all(&coord).unwrap();
        fs::write(
            coord.join("committed-R32.json"),
            serde_json::to_vec(&json!({
                "restoreId": "R32",
                "files": [
                    { "path": "events/PC-A.ndjson", "bytes": bytes, "checksum": checksum },
                    { "path": "snapshots/PC-A-00000001.json", "bytes": 123, "checksum": "non-piu-presente" }
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        a.emit("client", "C2", EventBody::Created).unwrap();
        fs::write(
            data.path().join("events/.restore-PC-A-32.marker"),
            serde_json::to_vec(&json!({ "restoreId": "R32" })).unwrap(),
        )
        .unwrap();

        assert_eq!(
            b.restore_remoto_stato(),
            RestoreRemoteStatus::Ready,
            "i manifest già distribuiti non devono restare bloccati per snapshot sottoposti a retention"
        );
    }

    #[test]
    fn marker_legacy_piu_recente_supera_un_restore_storico_non_piu_consegnabile() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        fs::create_dir_all(data.path().join("events")).unwrap();
        fs::write(
            data.path().join("events/.restore-PC-A-100.marker"),
            serde_json::to_vec(&json!({ "restoreId": "R-STORICO" })).unwrap(),
        )
        .unwrap();

        let prima = engine(data.path(), sq.path(), "PC-B");
        assert_eq!(
            prima.restore_remoto_stato(),
            RestoreRemoteStatus::Waiting,
            "senza una frontiera successiva il manifest mancante resta correttamente in attesa"
        );
        drop(prima);

        // È il formato legacy tuttora scritto da ritiro/compattazione. Un motore
        // nuovo lo considera gia' incorporato dal bootstrap, ma il suo timestamp
        // deve anche impedire la resurrezione dei restore precedenti.
        fs::write(
            data.path().join("events/.restore-PC-RITIRO-200.marker"),
            "restore",
        )
        .unwrap();
        let dopo = engine(data.path(), sq.path(), "PC-C");
        assert_eq!(dopo.restore_remoto_stato(), RestoreRemoteStatus::None);

        fs::remove_file(data.path().join("events/.restore-PC-RITIRO-200.marker")).unwrap();
        fs::write(
            data.path().join("events/.restore-PC-D-300.marker"),
            "restore",
        )
        .unwrap();
        let stesso_device = engine(data.path(), sq.path(), "PC-D");
        assert_eq!(
            stesso_device.restore_remoto_stato(),
            RestoreRemoteStatus::None,
            "anche un marker legacy proprio deve superare i restore storici"
        );
    }

    #[test]
    fn marker_restore_con_manifest_presente_all_avvio_viene_gestito_una_sola_volta() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let a = engine(data.path(), sq.path(), "PC-A");
        a.emit("client", "C1", set("nome", json!("Rossi"))).unwrap();

        let rel = "events/PC-A.ndjson";
        let path = data.path().join(rel);
        let bytes = std::fs::metadata(&path).unwrap().len();
        let checksum = checksum_file(&path).unwrap();
        let coord = data.path().join("meta").join("restore_coordination");
        std::fs::create_dir_all(&coord).unwrap();
        std::fs::write(
            coord.join("committed-R3.json"),
            serde_json::to_vec(&json!({
                "restoreId": "R3",
                "deviceId": "PC-A",
                "createdAt": 3,
                "files": [
                    { "path": rel, "bytes": bytes, "checksum": checksum }
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            data.path().join("events").join(".restore-PC-A-3.marker"),
            serde_json::to_vec(&json!({ "restoreId": "R3" })).unwrap(),
        )
        .unwrap();

        let b = engine(data.path(), sq.path(), "PC-B");
        assert!(
            b.restore_remoto_stato() == RestoreRemoteStatus::Ready,
            "il controllo bootstrap deve vedere il restore senza consumare il marker"
        );
        assert!(
            b.restore_remoto_stato() == RestoreRemoteStatus::Ready,
            "il controllo bootstrap e' read-only: se la ricostruzione fallisce puo' riprovare"
        );
        assert!(
            b.restore_remoto_pronto_da_riallineare(),
            "un PC che si avvia dopo il marker deve rilevare il restore pronto"
        );
        assert!(
            b.restore_remoto_pronto_da_riallineare(),
            "un tentativo fallito deve poter essere ripetuto nello stesso processo"
        );
        b.segna_restore_pronti_come_gestiti().unwrap();

        std::fs::write(
            data.path().join("events").join(".restore-PC-A-2.marker"),
            serde_json::to_vec(&json!({ "restoreId": "R2" })).unwrap(),
        )
        .unwrap();

        let b_riaperto = engine(data.path(), sq.path(), "PC-B");
        assert!(
            !b_riaperto.restore_remoto_pronto_da_riallineare(),
            "dopo il mark locale lo stesso restore, e quelli più vecchi superati, non devono ripartire in loop"
        );
    }

    #[test]
    fn file_watch_ack_prepare_restore_remoto() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let b = engine(data.path(), sq.path(), "PC-B");

        let (tx, rx) = std::sync::mpsc::channel();
        let _w = b
            .watch(
                |_| {},
                |_| {},
                move |restore_id| {
                    let _ = tx.send(restore_id);
                },
                |_| {},
            )
            .unwrap();

        let coord = data.path().join("meta").join("restore_coordination");
        std::fs::create_dir_all(&coord).unwrap();
        std::fs::write(
            coord.join("prepare-R1.json"),
            serde_json::to_vec(&json!({
                "restoreId": "R1",
                "deviceId": "PC-A",
                "deviceNome": "PC A",
                "createdAt": 1,
            }))
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(4))
                .expect("il watcher deve notificare il prepare remoto"),
            "R1"
        );
        assert!(
            data.path()
                .join("meta/restore_coordination/acks/R1/PC-B.json")
                .exists(),
            "il PC ricevente deve scrivere il proprio ack transitorio"
        );
    }

    #[test]
    fn file_watch_cancel_restore_sblocca_e_rimuove_ack() {
        let data = tempfile::tempdir().unwrap();
        let sq = tempfile::tempdir().unwrap();
        let b = engine(data.path(), sq.path(), "PC-B");

        let (tx_prepare, rx_prepare) = std::sync::mpsc::channel();
        let (tx_cancel, rx_cancel) = std::sync::mpsc::channel();
        let _w = b
            .watch(
                |_| {},
                |_| {},
                move |restore_id| {
                    let _ = tx_prepare.send(restore_id);
                },
                move |restore_id| {
                    let _ = tx_cancel.send(restore_id);
                },
            )
            .unwrap();

        let coord = data.path().join("meta").join("restore_coordination");
        std::fs::create_dir_all(&coord).unwrap();
        std::fs::write(
            coord.join("prepare-R4.json"),
            serde_json::to_vec(&json!({
                "restoreId": "R4",
                "deviceId": "PC-A",
                "deviceNome": "PC A",
                "createdAt": 4,
            }))
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            rx_prepare
                .recv_timeout(std::time::Duration::from_secs(4))
                .expect("il watcher deve notificare il prepare remoto"),
            "R4"
        );
        let ack = data
            .path()
            .join("meta/restore_coordination/acks/R4/PC-B.json");
        assert!(ack.exists(), "il prepare deve scrivere l'ack");

        std::fs::write(
            coord.join("cancelled-R4.json"),
            serde_json::to_vec(&json!({
                "restoreId": "R4",
                "deviceId": "PC-A",
                "cancelledAt": 5,
            }))
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            rx_cancel
                .recv_timeout(std::time::Duration::from_secs(4))
                .expect("il watcher deve notificare il cancel remoto"),
            "R4"
        );
        assert!(
            !ack.exists(),
            "il cancel deve rimuovere l'ack transitorio locale"
        );
    }

    impl Engine {
        /// Helper per i test: due round di ingest reciproco fra due motori.
        fn sync_round(&self, other: &Engine) {
            self.ingest().unwrap();
            other.ingest().unwrap();
        }
    }
}
