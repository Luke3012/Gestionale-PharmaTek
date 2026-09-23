//! Proiezione locale (read model) costruita dal fold degli eventi.
//!
//! È un database **SQLite in `%APPDATA%\PharmaTek\`** (mai dentro OneDrive: un file
//! DB sincronizzato da più PC è la causa classica di corruzione). La parte
//! replicata si rigenera ripiegando gli eventi; `local_notifiche_avvisate` invece
//! va preservata nelle ricostruzioni tecniche perché non compare nei log.
//!
//! Lo schema è **generico per entità**: ogni record è una riga in `records` con i
//! valori dei campi in un blob JSON. Il merge è **per-campo Last-Write-Wins** usando
//! l'HLC: la tabella `field_clocks` ricorda quale HLC ha "vinto" ciascun campo, così
//! una scrittura più vecchia che arriva dopo (per ritardo di sync) non sovrascrive
//! una più recente. Lo storico completo resta comunque nei log eventi.
//!
//! Le tabelle tipizzate per ordini/anagrafiche (query ricche, filtri) verranno
//! aggiunte sopra questo strato nelle fette 1C/1E.

use std::collections::BTreeMap;
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{Map, Value};

use crate::sync::event::{Event, EventBody};
use crate::sync::hlc::Hlc;

/// Chiave-clock riservata per la coppia delete/restore di un record.
const CLOCK_DEL: &str = "@del";

/// Errore della proiezione.
#[derive(Debug)]
pub enum ProjectionError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
}

impl std::fmt::Display for ProjectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProjectionError::Sqlite(e) => write!(f, "SQLite: {e}"),
            ProjectionError::Json(e) => write!(f, "JSON: {e}"),
        }
    }
}
impl std::error::Error for ProjectionError {}
impl From<rusqlite::Error> for ProjectionError {
    fn from(e: rusqlite::Error) -> Self {
        ProjectionError::Sqlite(e)
    }
}
impl From<serde_json::Error> for ProjectionError {
    fn from(e: serde_json::Error) -> Self {
        ProjectionError::Json(e)
    }
}

pub type Result<T> = std::result::Result<T, ProjectionError>;

/// Un record materializzato della proiezione.
#[derive(Debug, Clone, PartialEq)]
pub struct Record {
    pub entity: String,
    pub id: String,
    /// Valori correnti dei campi (ultimo vincitore LWW per ciascuno).
    pub data: Map<String, Value>,
    /// `true` se è nel Cestino (soft-deleted).
    pub deleted: bool,
    pub created_hlc: Hlc,
    pub updated_hlc: Hlc,
}

/// La proiezione locale SQLite.
pub struct Projection {
    conn: Connection,
}

/// Stato del solo notificatore locale, escluso dai log e dagli snapshot condivisi.
pub type LocalNotificaAvvisata = (String, String, String, i64);

impl Projection {
    /// Apre (creando se serve) il DB SQLite al percorso dato.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    /// Proiezione in-memory (per i test).
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> Result<Self> {
        let purged_esisteva: bool = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'purged'",
                [],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        let purged_aveva_hlc = if purged_esisteva {
            let mut stmt = conn.prepare("PRAGMA table_info(purged)")?;
            let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
            let mut found = false;
            for column in columns {
                if column? == "purged_hlc" {
                    found = true;
                    break;
                }
            }
            found
        } else {
            true
        };
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            -- Se una connessione precedente è ancora in chiusura (es. il thread del
            -- file-watch), attende invece di fallire subito con "database is locked".
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS records (
                entity      TEXT NOT NULL,
                id          TEXT NOT NULL,
                data        TEXT NOT NULL DEFAULT '{}',
                deleted     INTEGER NOT NULL DEFAULT 0,
                created_hlc TEXT NOT NULL,
                updated_hlc TEXT NOT NULL,
                PRIMARY KEY (entity, id)
            );

            CREATE TABLE IF NOT EXISTS field_clocks (
                entity TEXT NOT NULL,
                id     TEXT NOT NULL,
                field  TEXT NOT NULL,   -- nome campo, oppure '@del' per delete/restore
                hlc    TEXT NOT NULL,   -- HLC vincente per quel campo
                PRIMARY KEY (entity, id, field)
            );

            CREATE TABLE IF NOT EXISTS applied_events (
                event_id TEXT PRIMARY KEY,
                hlc      TEXT NOT NULL
            );

            -- Massimo HLC osservato per device: serve a gap-healing e attivita device
            -- senza dover serializzare tutta la tabella applied_events negli snapshot.
            CREATE TABLE IF NOT EXISTS watermarks (
                device TEXT PRIMARY KEY,
                hlc    TEXT NOT NULL
            );

            -- Offset (byte) già consumati per ciascun file di log: lettura incrementale.
            CREATE TABLE IF NOT EXISTS log_offsets (
                file   TEXT PRIMARY KEY,
                offset INTEGER NOT NULL
            );

            -- Record eliminati definitivamente (dal Cestino): nascosti ovunque.
            CREATE TABLE IF NOT EXISTS purged (
                entity TEXT NOT NULL,
                id     TEXT NOT NULL,
                purged_hlc TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (entity, id)
            );

            -- Esclusioni della sola read-model di questa postazione. Non entrano negli
            -- snapshot e non producono eventi: la sorgente condivisa resta intatta.
            CREATE TABLE IF NOT EXISTS local_suppressions (
                entity TEXT NOT NULL,
                id     TEXT NOT NULL,
                PRIMARY KEY (entity, id)
            );

            -- Storico locale degli avvisi (pop-up/suono) emessi per questa postazione.
            -- Non entra negli snapshot e non produce eventi su OneDrive.
            CREATE TABLE IF NOT EXISTS local_notifiche_avvisate (
                user_id TEXT NOT NULL,
                chiave  TEXT NOT NULL,
                tipo    TEXT NOT NULL,
                ts      INTEGER NOT NULL,
                PRIMARY KEY (user_id, chiave)
            );
            CREATE INDEX IF NOT EXISTS idx_local_notifiche_avvisate_tipo ON local_notifiche_avvisate(user_id, tipo);

            CREATE INDEX IF NOT EXISTS idx_records_entity ON records(entity, deleted);
            "#,
        )?;
        let has_purged_hlc = {
            let mut stmt = conn.prepare("PRAGMA table_info(purged)")?;
            let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
            let mut found = false;
            for column in columns {
                if column? == "purged_hlc" {
                    found = true;
                    break;
                }
            }
            found
        };
        if !has_purged_hlc {
            conn.execute(
                "ALTER TABLE purged ADD COLUMN purged_hlc TEXT NOT NULL DEFAULT ''",
                [],
            )?;
        }
        if purged_esisteva && !purged_aveva_hlc {
            let ha_identita_ricreabili: bool = conn
                .query_row(
                    "SELECT 1 FROM purged
                     WHERE entity IN ('preventivo', 'scheda_cliente') LIMIT 1",
                    [],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if ha_identita_ricreabili {
                // Gli eventi successivi al purge possono essere già stati marcati
                // come applicati dalla vecchia semantica. Rileggiamo una sola volta
                // i log disponibili: field clock e tombstone rendono il replay
                // idempotente, senza toccare la sorgente condivisa.
                conn.execute_batch(
                    "DELETE FROM applied_events;
                     DELETE FROM log_offsets;",
                )?;
            }
        }
        conn.pragma_update(None, "user_version", 2)?;
        Ok(Projection { conn })
    }

    /// `true` se non è ancora stato applicato alcun evento (DB vergine).
    pub fn is_empty(&self) -> Result<bool> {
        let n: i64 = self.conn.query_row(
            "SELECT
                (SELECT COUNT(*) FROM records) +
                (SELECT COUNT(*) FROM purged) +
                (SELECT COUNT(*) FROM watermarks)",
            [],
            |r| r.get(0),
        )?;
        Ok(n == 0)
    }

    // ---- Offset dei log (lettura incrementale) ----

    pub fn get_offset(&self, file: &str) -> Result<u64> {
        let off: Option<i64> = self
            .conn
            .query_row(
                "SELECT offset FROM log_offsets WHERE file = ?1",
                params![file],
                |r| r.get(0),
            )
            .optional()?;
        Ok(off.unwrap_or(0) as u64)
    }

    pub fn set_offset(&self, file: &str, offset: u64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO log_offsets(file, offset) VALUES(?1, ?2)
             ON CONFLICT(file) DO UPDATE SET offset = excluded.offset",
            params![file, offset as i64],
        )?;
        Ok(())
    }

    /// Trova il massimo HLC registrato per un certo dispositivo.
    pub fn get_max_hlc_for_device(&self, device: &str) -> Result<Option<Hlc>> {
        let res: Option<String> = self
            .conn
            .query_row(
                "SELECT hlc FROM watermarks WHERE device = ?1",
                params![device],
                |r| r.get(0),
            )
            .optional()?;

        let res = match res {
            Some(s) => Some(s),
            None => {
                let pattern = format!("%-{}", device);
                self.conn.query_row(
                    "SELECT MAX(hlc) FROM applied_events WHERE hlc LIKE ?1",
                    params![pattern],
                    |r| r.get(0),
                )?
            }
        };

        match res {
            Some(s) if !s.is_empty() => {
                let hlc = s.parse::<Hlc>().map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, e.0)),
                    )
                })?;
                Ok(Some(hlc))
            }
            _ => Ok(None),
        }
    }

    /// True se il dispositivo è stato ritirato da una pulizia profili/PC.
    /// Un device ritirato ha il proprio flusso eventi chiuso: eventuali eventi
    /// tardivi sincronizzati dopo il ritiro non devono più modificare lo stato.
    pub fn is_device_retired(&self, device: &str) -> Result<bool> {
        Ok(self.get("device_retired", device)?.is_some())
    }

    // ---- Fold ----

    /// Applica un evento alla proiezione. Restituisce `true` se è stato applicato
    /// ora, `false` se era già presente (idempotenza tramite `applied_events`).
    ///
    /// Tutto avviene in una transazione: o l'evento è applicato per intero, o niente.
    /// Applica una sequenza di eventi all'interno di una singola transazione SQLite.
    /// Utilizza query con cache dei prepared statements per massimizzare il throughput.
    /// Restituisce l'insieme delle entità modificate.
    pub fn apply_batch(&mut self, events: &[Event]) -> Result<Vec<String>> {
        if events.is_empty() {
            return Ok(Vec::new());
        }
        let tx = self.conn.transaction()?;
        let mut modified = std::collections::HashSet::new();
        for ev in events {
            if Self::apply_event_tx(&tx, ev)? {
                modified.insert(ev.entity.clone());
            }
        }
        tx.commit()?;
        Ok(modified.into_iter().collect())
    }

    /// Applica un evento alla proiezione. Restituisce `true` se ha cambiato lo stato
    /// ora, `false` se era già presente (idempotenza tramite `applied_events`).
    ///
    /// Tutto avviene in una transazione: o l'evento è applicato per intero, o niente.
    #[allow(dead_code)]
    pub fn apply(&mut self, ev: &Event) -> Result<bool> {
        let tx = self.conn.transaction()?;
        let changed = Self::apply_event_tx(&tx, ev)?;
        tx.commit()?;
        Ok(changed)
    }

    fn apply_event_tx(tx: &rusqlite::Transaction<'_>, ev: &Event) -> Result<bool> {
        // Idempotenza: stesso evento applicato due volte (es. conflicted copy
        // duplicata, o re-ingest dopo snapshot) non cambia lo stato.
        let already: bool = tx
            .prepare_cached("SELECT 1 FROM applied_events WHERE event_id = ?1")?
            .query_row(params![ev.id], |_| Ok(()))
            .optional()?
            .is_some();
        if already {
            return Ok(false);
        }

        let ts = ev.ts.to_string();
        let mut changed = false;

        if !matches!(ev.body, EventBody::Purged) {
            if let Some(purged_hlc) = Self::purged_hlc(tx, &ev.entity, &ev.entity_id)? {
                let ricreabile = matches!(ev.entity.as_str(), "preventivo" | "scheda_cliente");
                let created_successiva = matches!(ev.body, EventBody::Created)
                    && ricreabile
                    && !purged_hlc.is_empty()
                    && ts > purged_hlc;
                if created_successiva {
                    tx.prepare_cached("DELETE FROM purged WHERE entity = ?1 AND id = ?2")?
                        .execute(params![ev.entity, ev.entity_id])?;
                } else {
                    Self::insert_applied_and_watermark(tx, ev, &ts)?;
                    return Ok(false);
                }
            }
        }

        if !matches!(ev.body, EventBody::Purged) {
            // Assicura l'esistenza del record (qualunque evento implicitamente lo crea:
            // robusto al riordino, es. un Deleted che arriva prima del Created).
            let inserted = tx
                .prepare_cached(
                    "INSERT OR IGNORE INTO records(entity, id, data, deleted, created_hlc, updated_hlc)
                     VALUES(?1, ?2, '{}', 0, ?3, ?3)",
                )?
                .execute(params![ev.entity, ev.entity_id, ts])?;
            changed |= inserted > 0;

            // `created_hlc` = minimo HLC fra tutti gli eventi del record: deterministico
            // a prescindere dall'ordine di applicazione (serve alla numerazione ordini).
            tx.prepare_cached(
                "UPDATE records SET created_hlc = ?3
                 WHERE entity = ?1 AND id = ?2 AND ?3 < created_hlc",
            )?
            .execute(params![ev.entity, ev.entity_id, ts])?;
        }

        match &ev.body {
            EventBody::Created => {
                // Se il record era stato eliminato (deleted = 1) ma riceve un nuovo evento
                // Created con timestamp HLC posteriore alla cancellazione, viene riattivato.
                if Self::clock_wins(tx, &ev.entity, &ev.entity_id, CLOCK_DEL, &ts)? {
                    let updated = tx
                        .prepare_cached(
                            "UPDATE records SET deleted = 0 WHERE entity = ?1 AND id = ?2 AND deleted != 0",
                        )?
                        .execute(params![ev.entity, ev.entity_id])?;
                    if updated > 0 {
                        Self::set_clock(tx, &ev.entity, &ev.entity_id, CLOCK_DEL, &ts)?;
                        Self::bump_updated(tx, &ev.entity, &ev.entity_id, &ts)?;
                        changed = true;
                    }
                }
            }
            EventBody::FieldSet { field, value } => {
                if Self::clock_wins(tx, &ev.entity, &ev.entity_id, field, &ts)? {
                    let mut data = Self::load_data(tx, &ev.entity, &ev.entity_id)?;
                    data.insert(field.clone(), value.clone());
                    Self::store_data(tx, &ev.entity, &ev.entity_id, &data)?;
                    Self::set_clock(tx, &ev.entity, &ev.entity_id, field, &ts)?;
                    Self::bump_updated(tx, &ev.entity, &ev.entity_id, &ts)?;
                    changed = true;
                }
            }
            EventBody::Deleted | EventBody::Restored => {
                if Self::clock_wins(tx, &ev.entity, &ev.entity_id, CLOCK_DEL, &ts)? {
                    let deleted = matches!(ev.body, EventBody::Deleted);
                    tx.prepare_cached(
                        "UPDATE records SET deleted = ?3 WHERE entity = ?1 AND id = ?2",
                    )?
                    .execute(params![
                        ev.entity,
                        ev.entity_id,
                        deleted as i64
                    ])?;
                    Self::set_clock(tx, &ev.entity, &ev.entity_id, CLOCK_DEL, &ts)?;
                    Self::bump_updated(tx, &ev.entity, &ev.entity_id, &ts)?;
                    changed = true;
                }
            }
            EventBody::Purged => {
                // Per le identità deterministiche ricreabili, un purge vecchio non
                // deve cancellare una nuova incarnazione creata causalmente dopo.
                if matches!(ev.entity.as_str(), "preventivo" | "scheda_cliente") {
                    let created_hlc: Option<String> = tx
                        .query_row(
                            "SELECT created_hlc FROM records WHERE entity = ?1 AND id = ?2",
                            params![ev.entity, ev.entity_id],
                            |row| row.get(0),
                        )
                        .optional()?;
                    if created_hlc.as_ref().is_some_and(|created| created > &ts) {
                        Self::insert_applied_and_watermark(tx, ev, &ts)?;
                        return Ok(false);
                    }
                }
                // Terminale: i dati applicativi spariscono davvero; resta solo una
                // tombstone minima per impedire resurrezioni da vecchi log.
                let removed_records = tx
                    .prepare_cached("DELETE FROM records WHERE entity = ?1 AND id = ?2")?
                    .execute(params![ev.entity, ev.entity_id])?;
                let removed_clocks = tx
                    .prepare_cached("DELETE FROM field_clocks WHERE entity = ?1 AND id = ?2")?
                    .execute(params![ev.entity, ev.entity_id])?;
                let inserted = tx
                    .prepare_cached(
                        "INSERT INTO purged(entity, id, purged_hlc) VALUES(?1, ?2, ?3)
                         ON CONFLICT(entity, id) DO UPDATE SET purged_hlc = excluded.purged_hlc
                         WHERE purged.purged_hlc = '' OR excluded.purged_hlc > purged.purged_hlc",
                    )?
                    .execute(params![ev.entity, ev.entity_id, ts])?;
                tx.prepare_cached("DELETE FROM local_suppressions WHERE entity = ?1 AND id = ?2")?
                    .execute(params![ev.entity, ev.entity_id])?;
                changed = removed_records > 0 || removed_clocks > 0 || inserted > 0;
            }
        }

        Self::insert_applied_and_watermark(tx, ev, &ts)?;
        Ok(changed)
    }

    fn purged_hlc(
        tx: &rusqlite::Transaction<'_>,
        entity: &str,
        id: &str,
    ) -> Result<Option<String>> {
        tx.query_row(
            "SELECT purged_hlc FROM purged WHERE entity = ?1 AND id = ?2",
            params![entity, id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
    }

    fn insert_applied_and_watermark(
        tx: &rusqlite::Transaction<'_>,
        ev: &Event,
        ts: &str,
    ) -> Result<()> {
        tx.prepare_cached("INSERT OR IGNORE INTO applied_events(event_id, hlc) VALUES(?1, ?2)")?
            .execute(params![ev.id, ts])?;
        Self::upsert_watermark_tx(tx, &ev.ts.device, ts)?;
        Ok(())
    }

    fn upsert_watermark_tx(tx: &rusqlite::Transaction<'_>, device: &str, hlc: &str) -> Result<()> {
        tx.prepare_cached(
            "INSERT INTO watermarks(device, hlc) VALUES(?1, ?2)
             ON CONFLICT(device) DO UPDATE SET hlc = excluded.hlc
             WHERE excluded.hlc > watermarks.hlc",
        )?
        .execute(params![device, hlc])?;
        Ok(())
    }

    /// `true` se `ts` deve vincere sul clock corrente del campo (maggiore o assente).
    /// Il confronto è fra stringhe HLC, che sono ordinabili come l'ordine logico.
    fn clock_wins(
        tx: &rusqlite::Transaction<'_>,
        entity: &str,
        id: &str,
        field: &str,
        ts: &str,
    ) -> Result<bool> {
        let cur: Option<String> = tx
            .prepare_cached(
                "SELECT hlc FROM field_clocks WHERE entity = ?1 AND id = ?2 AND field = ?3",
            )?
            .query_row(params![entity, id, field], |r| r.get(0))
            .optional()?;
        Ok(match cur {
            None => true,
            Some(c) => ts > c.as_str(),
        })
    }

    fn set_clock(
        tx: &rusqlite::Transaction<'_>,
        entity: &str,
        id: &str,
        field: &str,
        ts: &str,
    ) -> Result<()> {
        tx.prepare_cached(
            "INSERT INTO field_clocks(entity, id, field, hlc) VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(entity, id, field) DO UPDATE SET hlc = excluded.hlc",
        )?
        .execute(params![entity, id, field, ts])?;
        Ok(())
    }

    fn bump_updated(
        tx: &rusqlite::Transaction<'_>,
        entity: &str,
        id: &str,
        ts: &str,
    ) -> Result<()> {
        // updated_hlc = max(updated_hlc, ts)
        tx.prepare_cached(
            "UPDATE records SET updated_hlc = ?3
             WHERE entity = ?1 AND id = ?2 AND ?3 > updated_hlc",
        )?
        .execute(params![entity, id, ts])?;
        Ok(())
    }

    fn load_data(
        tx: &rusqlite::Transaction<'_>,
        entity: &str,
        id: &str,
    ) -> Result<Map<String, Value>> {
        let json: String = tx
            .prepare_cached("SELECT data FROM records WHERE entity = ?1 AND id = ?2")?
            .query_row(params![entity, id], |r| r.get(0))?;
        let v: Value = serde_json::from_str(&json)?;
        Ok(v.as_object().cloned().unwrap_or_default())
    }

    fn store_data(
        tx: &rusqlite::Transaction<'_>,
        entity: &str,
        id: &str,
        data: &Map<String, Value>,
    ) -> Result<()> {
        let json = serde_json::to_string(&Value::Object(data.clone()))?;
        tx.prepare_cached("UPDATE records SET data = ?3 WHERE entity = ?1 AND id = ?2")?
            .execute(params![entity, id, json])?;
        Ok(())
    }

    // ---- Query ----

    /// Legge un singolo record (anche se nel Cestino).
    pub fn get(&self, entity: &str, id: &str) -> Result<Option<Record>> {
        self.conn
            .query_row(
                "SELECT entity, id, data, deleted, created_hlc, updated_hlc
                 FROM records WHERE entity = ?1 AND id = ?2
                 AND NOT EXISTS (SELECT 1 FROM purged pg WHERE pg.entity = ?1 AND pg.id = ?2)",
                params![entity, id],
                Self::row_to_record,
            )
            .optional()
            .map_err(Into::into)
    }

    /// Elenca i record **non** cancellati di un'entità, ordinati per HLC di creazione.
    pub fn list(&self, entity: &str) -> Result<Vec<Record>> {
        self.query_list(entity, false)
    }

    /// Elenca i record nel Cestino (soft-deleted) di un'entità.
    pub fn list_deleted(&self, entity: &str) -> Result<Vec<Record>> {
        self.query_list(entity, true)
    }

    /// Elenca le tombstone minime dei record purgati definitivamente.
    pub fn list_purged(&self) -> Result<Vec<RawPurged>> {
        let mut stmt = self
            .conn
            .prepare("SELECT entity, id, purged_hlc FROM purged")?;
        let rows = stmt.query_map([], |r| {
            Ok(RawPurged {
                entity: r.get(0)?,
                id: r.get(1)?,
                purged_hlc: r.get(2)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Completa le tombstone create da versioni che non salvavano ancora l'HLC.
    /// Non sovrascrive mai un valore già noto e modifica soltanto la proiezione locale.
    pub(crate) fn backfill_purged_hlcs(
        &mut self,
        hlcs: &BTreeMap<(String, String), String>,
    ) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let mut aggiornate = 0;
        for ((entity, id), hlc) in hlcs {
            aggiornate += tx.execute(
                "UPDATE purged SET purged_hlc = ?3
                 WHERE entity = ?1 AND id = ?2 AND purged_hlc = ''",
                params![entity, id, hlc],
            )?;
        }
        tx.commit()?;
        Ok(aggiornate)
    }

    /// Verifica la tombstone terminale di un singolo record senza confondere una
    /// sync ancora incompleta con una cancellazione definitiva.
    pub fn record_is_purged(&self, entity: &str, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM purged WHERE entity = ?1 AND id = ?2",
                params![entity, id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    /// Nasconde un record esclusivamente nelle letture applicative di questa
    /// proiezione. La riga, i clock e gli eventi condivisi non vengono modificati.
    pub fn suppress_local(&self, entity: &str, id: &str) -> Result<bool> {
        Ok(self.conn.execute(
            "INSERT OR IGNORE INTO local_suppressions(entity, id) VALUES(?1, ?2)",
            params![entity, id],
        )? > 0)
    }

    pub fn unsuppress_local(&self, entity: &str, id: &str) -> Result<bool> {
        Ok(self.conn.execute(
            "DELETE FROM local_suppressions WHERE entity = ?1 AND id = ?2",
            params![entity, id],
        )? > 0)
    }

    pub fn is_locally_suppressed(&self, entity: &str, id: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM local_suppressions WHERE entity = ?1 AND id = ?2",
                params![entity, id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    fn query_list(&self, entity: &str, deleted: bool) -> Result<Vec<Record>> {
        let mut stmt = self.conn.prepare(
            "SELECT entity, id, data, deleted, created_hlc, updated_hlc
             FROM records WHERE entity = ?1 AND deleted = ?2
             AND NOT EXISTS (SELECT 1 FROM purged pg WHERE pg.entity = records.entity AND pg.id = records.id)
             ORDER BY created_hlc ASC",
        )?;
        let rows = stmt.query_map(params![entity, deleted as i64], Self::row_to_record)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<Record> {
        let data_json: String = row.get(2)?;
        let data: Map<String, Value> = serde_json::from_str(&data_json)
            .ok()
            .and_then(|v: Value| v.as_object().cloned())
            .unwrap_or_default();
        let created: String = row.get(4)?;
        let updated: String = row.get(5)?;
        Ok(Record {
            entity: row.get(0)?,
            id: row.get(1)?,
            data,
            deleted: row.get::<_, i64>(3)? != 0,
            created_hlc: created.parse().unwrap_or_else(|_| Hlc::new(0, 0, "?")),
            updated_hlc: updated.parse().unwrap_or_else(|_| Hlc::new(0, 0, "?")),
        })
    }

    /// Ultima attività per dispositivo, **derivata dagli eventi**: l'HLC contiene
    /// già `(wall, counter, device)`, quindi basta il watermark massimo per device.
    pub fn device_activity(&self) -> Result<std::collections::HashMap<String, u64>> {
        let mut stmt = self.conn.prepare("SELECT device, hlc FROM watermarks")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        for r in rows {
            let (device, hlc) = r?;
            if let Ok(h) = hlc.parse::<Hlc>() {
                let e = out.entry(device).or_insert(0);
                if h.wall > *e {
                    *e = h.wall;
                }
            }
        }
        Ok(out)
    }

    /// Frontiera massima osservata per ciascun dispositivo.
    pub fn watermarks(&self) -> Result<BTreeMap<String, String>> {
        let mut stmt = self.conn.prepare("SELECT device, hlc FROM watermarks")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut watermarks = BTreeMap::new();
        for row in rows {
            let (device, hlc) = row?;
            watermarks.insert(device, hlc);
        }
        Ok(watermarks)
    }

    /// Recupera spazio fisico dopo una ricostruzione/compattazione.
    pub fn vacuum(&self) -> Result<()> {
        self.conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        Ok(())
    }

    /// Svuota la sola proiezione replicata, conservando gli avvisi locali.
    pub fn wipe_replicated(&self) -> Result<()> {
        self.conn.execute_batch(
            "DELETE FROM records;
             DELETE FROM field_clocks;
             DELETE FROM applied_events;
             DELETE FROM log_offsets;
             DELETE FROM purged;
             DELETE FROM watermarks;",
        )?;
        Ok(())
    }

    /// Svuota completamente la proiezione (usato dal reset). La connessione resta
    /// valida: più affidabile, su Windows, della cancellazione del file (che può
    /// restare agganciato finché il processo non rilascia l'handle).
    pub fn wipe(&self) -> Result<()> {
        self.wipe_replicated()?;
        self.conn
            .execute("DELETE FROM local_notifiche_avvisate", [])?;
        Ok(())
    }

    /// Potatura best-effort della cache di deduplica. La correttezza vive in
    /// `field_clocks`, `purged` e `watermarks`; questa tabella non deve crescere per anni.
    pub fn prune_applied_events(&self, keep_per_device: usize) -> Result<usize> {
        if keep_per_device == 0 {
            return Ok(0);
        }
        let mut stmt = self
            .conn
            .prepare("SELECT event_id, hlc FROM applied_events")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut by_device: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
        for row in rows {
            let (event_id, hlc) = row?;
            let device = hlc
                .parse::<Hlc>()
                .map(|h| h.device)
                .unwrap_or_else(|_| "?".to_string());
            by_device.entry(device).or_default().push((event_id, hlc));
        }

        let mut drop_ids = Vec::new();
        for events in by_device.values_mut() {
            events.sort_by(|a, b| b.1.cmp(&a.1));
            if events.len() > keep_per_device {
                drop_ids.extend(events[keep_per_device..].iter().map(|(id, _)| id.clone()));
            }
        }

        let tx = self.conn.unchecked_transaction()?;
        for id in &drop_ids {
            tx.execute(
                "DELETE FROM applied_events WHERE event_id = ?1",
                params![id],
            )?;
        }
        tx.commit()?;
        Ok(drop_ids.len())
    }

    // ---- Notifiche avvisate locali (non replicate) ----

    pub fn export_local_notifiche_avvisate(&self) -> Result<Vec<LocalNotificaAvvisata>> {
        let mut stmt = self.conn.prepare(
            "SELECT user_id, chiave, tipo, ts FROM local_notifiche_avvisate ORDER BY user_id, chiave",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn import_local_notifiche_avvisate(&self, rows: &[LocalNotificaAvvisata]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for (user_id, chiave, tipo, ts) in rows {
            tx.execute(
                "INSERT INTO local_notifiche_avvisate(user_id, chiave, tipo, ts)
                 VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(user_id, chiave) DO UPDATE SET tipo = excluded.tipo, ts = excluded.ts",
                params![user_id, chiave, tipo, ts],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_local_suggerimenti(&self, user_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM local_notifiche_avvisate
             WHERE user_id = ?1 AND (chiave LIKE 'suggerimento:%'
                                    OR chiave LIKE 'primo_rilevato:%')",
            params![user_id],
        )?;
        Ok(())
    }

    /// Legge la mappa degli ultimi avvisi emessi per un utente: chiave -> timestamp ms.
    pub fn local_notifica_avvisata_get_map(
        &self,
        user_id: &str,
    ) -> Result<std::collections::HashMap<String, i64>> {
        let mut stmt = self
            .conn
            .prepare("SELECT chiave, ts FROM local_notifiche_avvisate WHERE user_id = ?1")?;
        let rows = stmt.query_map(params![user_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let mut map = std::collections::HashMap::new();
        for r in rows {
            let (k, v) = r?;
            map.insert(k, v);
        }
        Ok(map)
    }

    /// Salva o aggiorna l'ultimo timestamp di avviso per una data chiave.
    pub fn local_notifica_avvisata_set(
        &self,
        user_id: &str,
        chiave: &str,
        tipo: &str,
        ts: i64,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO local_notifiche_avvisate(user_id, chiave, tipo, ts)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(user_id, chiave) DO UPDATE SET ts = excluded.ts, tipo = excluded.tipo",
            params![user_id, chiave, tipo, ts],
        )?;
        Ok(())
    }

    /// Cancella una specifica chiave di avviso per un utente.
    pub fn local_notifica_avvisata_delete(&self, user_id: &str, chiave: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM local_notifiche_avvisate WHERE user_id = ?1 AND chiave = ?2",
            params![user_id, chiave],
        )?;
        Ok(())
    }

    /// Cancella tutti gli avvisi associati a un tipo/categoria di suggerimento per un utente.
    pub fn local_notifica_avvisata_delete_tipo(&self, user_id: &str, tipo: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM local_notifiche_avvisate
             WHERE user_id = ?1
               AND (
                 tipo = ?2
                 OR chiave = 'suggerimento:' || ?2
                 OR chiave = 'primo_rilevato:' || ?2
                 OR chiave LIKE 'suggerimento:%:' || ?2
                 OR chiave LIKE 'primo_rilevato:%:' || ?2
               )",
            params![user_id, tipo],
        )?;
        Ok(())
    }

    // ---- Supporto snapshot (export/import dello stato) ----

    /// Esporta tutto lo stato in una struttura serializzabile (per gli snapshot).
    pub fn export(&self) -> Result<SnapshotData> {
        let mut records = Vec::new();
        {
            let mut stmt = self.conn.prepare(
                "SELECT entity, id, data, deleted, created_hlc, updated_hlc
                 FROM records
                 WHERE NOT EXISTS (
                    SELECT 1 FROM purged pg
                    WHERE pg.entity = records.entity AND pg.id = records.id
                 )",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(RawRecord {
                    entity: r.get(0)?,
                    id: r.get(1)?,
                    data: r.get(2)?,
                    deleted: r.get::<_, i64>(3)? != 0,
                    created_hlc: r.get(4)?,
                    updated_hlc: r.get(5)?,
                })
            })?;
            for r in rows {
                records.push(r?);
            }
        }
        let mut clocks = Vec::new();
        {
            let mut stmt = self.conn.prepare(
                "SELECT entity, id, field, hlc
                     FROM field_clocks
                     WHERE NOT EXISTS (
                        SELECT 1 FROM purged pg
                        WHERE pg.entity = field_clocks.entity AND pg.id = field_clocks.id
                     )",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(RawClock {
                    entity: r.get(0)?,
                    id: r.get(1)?,
                    field: r.get(2)?,
                    hlc: r.get(3)?,
                })
            })?;
            for r in rows {
                clocks.push(r?);
            }
        }
        let applied = BTreeMap::new();
        let mut purged = Vec::new();
        {
            let mut stmt = self
                .conn
                .prepare("SELECT entity, id, purged_hlc FROM purged")?;
            let rows = stmt.query_map([], |r| {
                Ok(RawPurged {
                    entity: r.get(0)?,
                    id: r.get(1)?,
                    purged_hlc: r.get(2)?,
                })
            })?;
            for r in rows {
                purged.push(r?);
            }
        }
        let watermarks = self.watermarks()?;
        // Segnalibri (offset byte per file di log) folded in questo snapshot: chi
        // importa lo snapshot riparte da qui e ripiega solo la **coda** dei log,
        // non tutta la storia (vedi docs/COMPATTAZIONE.md).
        let mut offsets = BTreeMap::new();
        {
            let mut stmt = self.conn.prepare("SELECT file, offset FROM log_offsets")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
            for r in rows {
                let (k, v) = r?;
                offsets.insert(k, v);
            }
        }
        Ok(SnapshotData {
            records,
            clocks,
            applied,
            offsets,
            purged,
            watermarks,
        })
    }

    /// Importa uno snapshot in un DB (assunto vergine). Usato per il bootstrap.
    pub fn import(&mut self, snap: &SnapshotData) -> Result<()> {
        let tx = self.conn.transaction()?;
        let richiede_replay_legacy = snap.purged.iter().any(|pg| {
            pg.purged_hlc.is_empty()
                && matches!(pg.entity.as_str(), "preventivo" | "scheda_cliente")
        });
        for r in &snap.records {
            tx.execute(
                "INSERT OR REPLACE INTO records(entity, id, data, deleted, created_hlc, updated_hlc)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![r.entity, r.id, r.data, r.deleted as i64, r.created_hlc, r.updated_hlc],
            )?;
        }
        for c in &snap.clocks {
            tx.execute(
                "INSERT OR REPLACE INTO field_clocks(entity, id, field, hlc)
                 VALUES(?1, ?2, ?3, ?4)",
                params![c.entity, c.id, c.field, c.hlc],
            )?;
        }
        for pg in &snap.purged {
            tx.execute(
                "INSERT OR REPLACE INTO purged(entity, id, purged_hlc) VALUES(?1, ?2, ?3)",
                params![pg.entity, pg.id, pg.purged_hlc],
            )?;
            tx.execute(
                "DELETE FROM records WHERE entity = ?1 AND id = ?2",
                params![pg.entity, pg.id],
            )?;
            tx.execute(
                "DELETE FROM field_clocks WHERE entity = ?1 AND id = ?2",
                params![pg.entity, pg.id],
            )?;
        }
        if !richiede_replay_legacy {
            for (event_id, hlc) in &snap.applied {
                tx.execute(
                    "INSERT OR REPLACE INTO applied_events(event_id, hlc) VALUES(?1, ?2)",
                    params![event_id, hlc],
                )?;
                if snap.watermarks.is_empty() {
                    if let Ok(h) = hlc.parse::<Hlc>() {
                        Self::upsert_watermark_tx(&tx, &h.device, hlc)?;
                    }
                }
            }
        }
        for (device, hlc) in &snap.watermarks {
            Self::upsert_watermark_tx(&tx, device, hlc)?;
        }
        // Ripristina i segnalibri: così l'ingest dopo l'import legge solo la coda
        // dei log (gli snapshot vecchi senza offset → mappa vuota → comportamento
        // di prima, rilettura da capo, comunque corretta per idempotenza).
        if !richiede_replay_legacy {
            for (file, offset) in &snap.offsets {
                tx.execute(
                    "INSERT OR REPLACE INTO log_offsets(file, offset) VALUES(?1, ?2)",
                    params![file, offset],
                )?;
            }
        }
        if snap.watermarks.is_empty() && snap.applied.is_empty() {
            for r in &snap.records {
                if let Ok(h) = r.created_hlc.parse::<Hlc>() {
                    Self::upsert_watermark_tx(&tx, &h.device, &r.created_hlc)?;
                }
                if let Ok(h) = r.updated_hlc.parse::<Hlc>() {
                    Self::upsert_watermark_tx(&tx, &h.device, &r.updated_hlc)?;
                }
            }
            for c in &snap.clocks {
                if let Ok(h) = c.hlc.parse::<Hlc>() {
                    Self::upsert_watermark_tx(&tx, &h.device, &c.hlc)?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    }
}

/// Stato serializzabile della proiezione (contenuto di uno snapshot).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SnapshotData {
    pub records: Vec<RawRecord>,
    pub clocks: Vec<RawClock>,
    /// Eventi già piegati (event_id -> hlc): garantisce l'idempotenza dopo il restore.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub applied: BTreeMap<String, String>,
    /// Segnalibri di lettura (nome file di log -> offset byte già folded). `default`
    /// per retrocompatibilità con snapshot vecchi privi di questo campo.
    #[serde(default)]
    pub offsets: BTreeMap<String, i64>,
    /// Tombstone minime dei record eliminati definitivamente.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub purged: Vec<RawPurged>,
    /// Massimo HLC osservato per dispositivo.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub watermarks: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RawRecord {
    pub entity: String,
    pub id: String,
    pub data: String,
    pub deleted: bool,
    pub created_hlc: String,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RawClock {
    pub entity: String,
    pub id: String,
    pub field: String,
    pub hlc: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RawPurged {
    pub entity: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub purged_hlc: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn set(
        device: &str,
        wall: u64,
        cnt: u32,
        entity: &str,
        id: &str,
        field: &str,
        v: Value,
    ) -> Event {
        Event::new(
            Hlc::new(wall, cnt, device),
            device,
            "tester",
            entity,
            id,
            EventBody::FieldSet {
                field: field.into(),
                value: v,
            },
        )
    }

    #[test]
    fn fold_base_e_get() {
        let mut p = Projection::open_in_memory().unwrap();
        p.apply(&Event::new(
            Hlc::new(1, 0, "PC-A"),
            "PC-A",
            "t",
            "client",
            "C1",
            EventBody::Created,
        ))
        .unwrap();
        p.apply(&set("PC-A", 2, 0, "client", "C1", "nome", json!("Rossi")))
            .unwrap();
        let r = p.get("client", "C1").unwrap().unwrap();
        assert_eq!(r.data["nome"], json!("Rossi"));
        assert!(!r.deleted);
    }

    #[test]
    fn idempotenza_stesso_evento() {
        let mut p = Projection::open_in_memory().unwrap();
        let ev = set("PC-A", 1, 0, "client", "C1", "nome", json!("Rossi"));
        assert!(p.apply(&ev).unwrap(), "prima applicazione");
        assert!(!p.apply(&ev).unwrap(), "seconda applicazione: no-op");
    }

    #[test]
    fn lww_per_campo_vince_hlc_maggiore() {
        let mut p = Projection::open_in_memory().unwrap();
        // applico in ordine "sbagliato": prima il più recente, poi il più vecchio
        p.apply(&set("PC-A", 10, 0, "order", "O1", "acconto", json!(5000)))
            .unwrap();
        p.apply(&set("PC-B", 5, 0, "order", "O1", "acconto", json!(9999)))
            .unwrap();
        let r = p.get("order", "O1").unwrap().unwrap();
        assert_eq!(
            r.data["acconto"],
            json!(5000),
            "vince l'HLC maggiore (wall 10)"
        );
    }

    #[test]
    fn campi_diversi_si_fondono() {
        let mut p = Projection::open_in_memory().unwrap();
        p.apply(&set("PC-A", 1, 0, "order", "O1", "acconto", json!(5000)))
            .unwrap();
        p.apply(&set("PC-B", 2, 0, "order", "O1", "note", json!("urgente")))
            .unwrap();
        let r = p.get("order", "O1").unwrap().unwrap();
        assert_eq!(r.data["acconto"], json!(5000));
        assert_eq!(r.data["note"], json!("urgente"));
    }

    #[test]
    fn soft_delete_e_restore_lww() {
        let mut p = Projection::open_in_memory().unwrap();
        p.apply(&set("PC-A", 1, 0, "client", "C1", "nome", json!("Rossi")))
            .unwrap();
        // delete
        p.apply(&Event::new(
            Hlc::new(2, 0, "PC-A"),
            "PC-A",
            "t",
            "client",
            "C1",
            EventBody::Deleted,
        ))
        .unwrap();
        assert!(p.get("client", "C1").unwrap().unwrap().deleted);
        assert!(p.list("client").unwrap().is_empty());
        assert_eq!(p.list_deleted("client").unwrap().len(), 1);
        // restore con HLC maggiore
        p.apply(&Event::new(
            Hlc::new(3, 0, "PC-A"),
            "PC-A",
            "t",
            "client",
            "C1",
            EventBody::Restored,
        ))
        .unwrap();
        assert!(!p.get("client", "C1").unwrap().unwrap().deleted);
        // un delete "vecchio" (HLC minore) non deve più cancellare
        p.apply(&Event::new(
            Hlc::new(1, 5, "PC-Z"),
            "PC-Z",
            "t",
            "client",
            "C1",
            EventBody::Deleted,
        ))
        .unwrap();
        assert!(!p.get("client", "C1").unwrap().unwrap().deleted);
    }

    #[test]
    fn created_hlc_minimo_e_deterministico() {
        let mut p = Projection::open_in_memory().unwrap();
        // due Created per lo stesso id (offline su due PC) con HLC diversi
        p.apply(&Event::new(
            Hlc::new(10, 0, "PC-A"),
            "PC-A",
            "t",
            "order",
            "O1",
            EventBody::Created,
        ))
        .unwrap();
        p.apply(&Event::new(
            Hlc::new(4, 0, "PC-B"),
            "PC-B",
            "t",
            "order",
            "O1",
            EventBody::Created,
        ))
        .unwrap();
        let r = p.get("order", "O1").unwrap().unwrap();
        assert_eq!(
            r.created_hlc,
            Hlc::new(4, 0, "PC-B"),
            "vince il Created più vecchio"
        );
    }

    #[test]
    fn snapshot_roundtrip() {
        let mut p = Projection::open_in_memory().unwrap();
        let ev_nome = set("PC-A", 1, 0, "client", "C1", "nome", json!("Rossi"));
        p.apply(&ev_nome).unwrap();
        p.apply(&set("PC-A", 2, 0, "order", "O1", "acconto", json!(5000)))
            .unwrap();
        let snap = p.export().unwrap();

        let mut p2 = Projection::open_in_memory().unwrap();
        p2.import(&snap).unwrap();
        assert_eq!(p2.export().unwrap(), snap);
        assert_eq!(
            p2.get("client", "C1").unwrap().unwrap().data["nome"],
            json!("Rossi")
        );
        // dopo l'import, ri-applicare lo **stesso** evento (stesso id) è un no-op
        assert!(!p2.apply(&ev_nome).unwrap());
    }

    #[test]
    fn snapshot_include_e_ripristina_gli_offset() {
        let mut p = Projection::open_in_memory().unwrap();
        p.apply(&set("PC-A", 1, 0, "client", "C1", "nome", json!("Rossi")))
            .unwrap();
        p.set_offset("PC-A.ndjson", 123).unwrap();
        p.set_offset("PC-B.ndjson", 7).unwrap();

        let snap = p.export().unwrap();
        assert_eq!(snap.offsets.get("PC-A.ndjson"), Some(&123));
        assert_eq!(snap.offsets.get("PC-B.ndjson"), Some(&7));

        // L'import ripristina i segnalibri (così il bootstrap legge solo la coda).
        let mut p2 = Projection::open_in_memory().unwrap();
        p2.import(&snap).unwrap();
        assert_eq!(p2.get_offset("PC-A.ndjson").unwrap(), 123);
        assert_eq!(p2.get_offset("PC-B.ndjson").unwrap(), 7);
    }

    #[test]
    fn import_snapshot_legacy_ricreabile_forza_il_replay_dei_log() {
        let mut p = Projection::open_in_memory().unwrap();
        let mut snapshot = SnapshotData {
            records: Vec::new(),
            clocks: Vec::new(),
            applied: BTreeMap::from([(
                "CREATED-SCARTATA".into(),
                Hlc::new(20, 0, "PC-B").to_string(),
            )]),
            offsets: BTreeMap::from([("PC-B.ndjson".into(), 1234)]),
            purged: vec![RawPurged {
                entity: "preventivo".into(),
                id: "preventivo/O1".into(),
                purged_hlc: String::new(),
            }],
            watermarks: BTreeMap::from([("PC-B".into(), Hlc::new(20, 0, "PC-B").to_string())]),
        };

        p.import(&snapshot).unwrap();
        assert_eq!(p.get_offset("PC-B.ndjson").unwrap(), 0);
        let applied: i64 = p
            .conn
            .query_row(
                "SELECT COUNT(*) FROM applied_events WHERE event_id='CREATED-SCARTATA'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(applied, 0);

        snapshot.purged[0].entity = "cliente".into();
        let mut normale = Projection::open_in_memory().unwrap();
        normale.import(&snapshot).unwrap();
        assert_eq!(normale.get_offset("PC-B.ndjson").unwrap(), 1234);
    }

    #[test]
    fn snapshot_tiene_soft_deleted_ma_non_i_purged() {
        let mut p = Projection::open_in_memory().unwrap();
        p.apply(&set(
            "PC-A",
            1,
            0,
            "client",
            "SOFT",
            "nome",
            json!("Nel cestino"),
        ))
        .unwrap();
        p.apply(&Event::new(
            Hlc::new(2, 0, "PC-A"),
            "PC-A",
            "t",
            "client",
            "SOFT",
            EventBody::Deleted,
        ))
        .unwrap();
        p.apply(&set(
            "PC-A",
            3,
            0,
            "client",
            "PURGED",
            "nome",
            json!("Da cancellare"),
        ))
        .unwrap();
        p.apply(&Event::new(
            Hlc::new(4, 0, "PC-A"),
            "PC-A",
            "t",
            "client",
            "PURGED",
            EventBody::Purged,
        ))
        .unwrap();

        let snap = p.export().unwrap();
        assert!(snap.records.iter().any(|r| r.id == "SOFT" && r.deleted));
        assert!(snap.records.iter().all(|r| r.id != "PURGED"));
        assert!(snap.clocks.iter().all(|c| c.id != "PURGED"));
        assert!(snap
            .purged
            .iter()
            .any(|pg| pg.id == "PURGED" && pg.purged_hlc == Hlc::new(4, 0, "PC-A").to_string()));
        assert!(
            snap.applied.is_empty(),
            "i nuovi snapshot non serializzano la storia applied"
        );
    }

    #[test]
    fn purge_terminale_non_viene_resuscitato_da_vecchi_eventi() {
        let mut p = Projection::open_in_memory().unwrap();
        p.apply(&set("PC-A", 10, 0, "client", "C1", "nome", json!("Rossi")))
            .unwrap();
        p.apply(&Event::new(
            Hlc::new(11, 0, "PC-A"),
            "PC-A",
            "t",
            "client",
            "C1",
            EventBody::Purged,
        ))
        .unwrap();

        assert!(p.get("client", "C1").unwrap().is_none());
        assert!(!p
            .apply(&set("PC-A", 9, 0, "client", "C1", "nome", json!("Vecchio")))
            .unwrap());
        assert!(!p
            .apply(&Event::new(
                Hlc::new(12, 0, "PC-A"),
                "PC-A",
                "t",
                "client",
                "C1",
                EventBody::Restored
            ))
            .unwrap());
        assert!(p.get("client", "C1").unwrap().is_none());
    }

    #[test]
    fn solo_identita_deterministiche_ricreabili_superano_un_purge_precedente() {
        let mut p = Projection::open_in_memory().unwrap();
        for entity in ["client", "preventivo", "scheda_cliente"] {
            p.apply(&Event::new(
                Hlc::new(10, 0, "PC-A"),
                "PC-A",
                "t",
                entity,
                "ID",
                EventBody::Created,
            ))
            .unwrap();
            p.apply(&Event::new(
                Hlc::new(20, 0, "PC-A"),
                "PC-A",
                "t",
                entity,
                "ID",
                EventBody::Purged,
            ))
            .unwrap();
        }

        for entity in ["client", "preventivo", "scheda_cliente"] {
            assert!(!p
                .apply(&Event::new(
                    Hlc::new(20, 0, "PC-A"),
                    "PC-A",
                    "t",
                    entity,
                    "ID",
                    EventBody::Created,
                ))
                .unwrap());
        }
        assert!(p
            .apply(&Event::new(
                Hlc::new(30, 0, "PC-A"),
                "PC-A",
                "t",
                "preventivo",
                "ID",
                EventBody::Created,
            ))
            .unwrap());
        assert!(p
            .apply(&Event::new(
                Hlc::new(30, 1, "PC-A"),
                "PC-A",
                "t",
                "scheda_cliente",
                "ID",
                EventBody::Created,
            ))
            .unwrap());
        assert!(p.get("client", "ID").unwrap().is_none());
        assert!(p.get("preventivo", "ID").unwrap().is_some());
        assert!(p.get("scheda_cliente", "ID").unwrap().is_some());

        // Un purge consegnato in ritardo non cancella la nuova incarnazione.
        assert!(!p
            .apply(&Event::new(
                Hlc::new(25, 0, "PC-B"),
                "PC-B",
                "t",
                "preventivo",
                "ID",
                EventBody::Purged,
            ))
            .unwrap());
        assert!(p.get("preventivo", "ID").unwrap().is_some());
    }

    #[test]
    fn snapshot_legacy_senza_hlc_purge_resta_importabile() {
        let json = r#"{
            "records": [], "clocks": [], "offsets": {},
            "purged": [{"entity":"preventivo","id":"preventivo/O1"}],
            "watermarks": {}
        }"#;
        let snapshot: SnapshotData = serde_json::from_str(json).unwrap();
        assert_eq!(snapshot.purged[0].purged_hlc, "");
        let mut p = Projection::open_in_memory().unwrap();
        p.import(&snapshot).unwrap();
        assert!(p.record_is_purged("preventivo", "preventivo/O1").unwrap());
    }

    #[test]
    fn tombstone_legacy_senza_frontiera_non_accetta_created_in_replay() {
        let snapshot = SnapshotData {
            records: Vec::new(),
            clocks: Vec::new(),
            applied: BTreeMap::new(),
            offsets: BTreeMap::new(),
            purged: vec![RawPurged {
                entity: "preventivo".into(),
                id: "preventivo/O1".into(),
                purged_hlc: String::new(),
            }],
            watermarks: BTreeMap::new(),
        };
        let mut p = Projection::open_in_memory().unwrap();
        p.import(&snapshot).unwrap();

        assert!(!p
            .apply(&Event::new(
                Hlc::new(100, 0, "PC-A"),
                "PC-A",
                "t",
                "preventivo",
                "preventivo/O1",
                EventBody::Created,
            ))
            .unwrap());
        assert!(p.record_is_purged("preventivo", "preventivo/O1").unwrap());
        assert!(p.get("preventivo", "preventivo/O1").unwrap().is_none());
    }

    #[test]
    fn migrazione_tombstone_legacy_rilegge_solo_la_proiezione_locale() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("projection.sqlite");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE purged(entity TEXT NOT NULL, id TEXT NOT NULL,
                    PRIMARY KEY(entity, id));
                 CREATE TABLE applied_events(event_id TEXT PRIMARY KEY, hlc TEXT NOT NULL);
                 CREATE TABLE log_offsets(file TEXT PRIMARY KEY, offset INTEGER NOT NULL);
                 INSERT INTO purged(entity, id) VALUES('preventivo', 'preventivo/O1');
                 INSERT INTO applied_events(event_id, hlc)
                    VALUES('E1', '0000000000000001-00000000-PC-A');
                 INSERT INTO log_offsets(file, offset) VALUES('PC-A.ndjson', 123);",
            )
            .unwrap();
        }

        let p = Projection::open(&path).unwrap();
        assert_eq!(p.get_offset("PC-A.ndjson").unwrap(), 0);
        let applied: i64 = p
            .conn
            .query_row("SELECT COUNT(*) FROM applied_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(applied, 0);
        let hlc: String = p
            .conn
            .query_row(
                "SELECT purged_hlc FROM purged WHERE entity='preventivo'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(hlc.is_empty());
    }

    #[test]
    fn test_get_max_hlc_for_device() {
        let mut p = Projection::open_in_memory().unwrap();
        assert_eq!(p.get_max_hlc_for_device("PC-A").unwrap(), None);

        // Applica evento da PC-A
        let ev1 = set("PC-A", 10, 0, "client", "C1", "nome", json!("Rossi"));
        p.apply(&ev1).unwrap();
        // Applica evento da PC-B
        let ev2 = set("PC-B", 15, 0, "client", "C1", "nome", json!("Neri"));
        p.apply(&ev2).unwrap();
        // Applica un secondo evento più recente da PC-A
        let ev3 = set("PC-A", 20, 0, "client", "C1", "nome", json!("Verdi"));
        p.apply(&ev3).unwrap();

        assert_eq!(
            p.get_max_hlc_for_device("PC-A").unwrap().unwrap(),
            Hlc::new(20, 0, "PC-A")
        );
        assert_eq!(
            p.get_max_hlc_for_device("PC-B").unwrap().unwrap(),
            Hlc::new(15, 0, "PC-B")
        );
    }

    #[test]
    fn apply_batch_equivale_ad_apply_singolo() {
        let mut p1 = Projection::open_in_memory().unwrap();
        let mut p2 = Projection::open_in_memory().unwrap();

        let events = vec![
            set("PC-A", 1, 0, "cliente", "C1", "nome", json!("Mario")),
            set("PC-A", 2, 0, "cliente", "C1", "cognome", json!("Rossi")),
            set("PC-B", 3, 0, "cliente", "C2", "nome", json!("Luigi")),
            set(
                "PC-A",
                4,
                0,
                "cliente",
                "C1",
                "nome",
                json!("Mario Corretto"),
            ),
            Event::new(
                Hlc::new(5, 0, "PC-B"),
                "PC-B",
                "u",
                "cliente",
                "C2",
                EventBody::Deleted,
            ),
        ];

        for ev in &events {
            p1.apply(ev).unwrap();
        }

        let modified = p2.apply_batch(&events).unwrap();
        assert!(modified.contains(&"cliente".to_string()));

        let c1_p1 = p1.get("cliente", "C1").unwrap().unwrap();
        let c1_p2 = p2.get("cliente", "C1").unwrap().unwrap();
        assert_eq!(c1_p1, c1_p2);

        let c2_p1 = p1.get("cliente", "C2").unwrap().unwrap();
        let c2_p2 = p2.get("cliente", "C2").unwrap().unwrap();
        assert_eq!(c2_p1, c2_p2);
        assert!(c2_p2.deleted);

        assert_eq!(
            p1.get_max_hlc_for_device("PC-A").unwrap(),
            p2.get_max_hlc_for_device("PC-A").unwrap()
        );
        assert_eq!(
            p1.get_max_hlc_for_device("PC-B").unwrap(),
            p2.get_max_hlc_for_device("PC-B").unwrap()
        );
    }

    #[test]
    fn created_dopo_deleted_riattiva_se_posteriore() {
        let mut p = Projection::open_in_memory().unwrap();

        // 1. Creazione iniziale a t=10
        let ev1 = Event::new(
            Hlc::new(10, 0, "PC-A"),
            "PC-A",
            "u",
            "suggerimento_stato",
            "sugg-1",
            EventBody::Created,
        );
        p.apply(&ev1).unwrap();
        assert!(
            !p.get("suggerimento_stato", "sugg-1")
                .unwrap()
                .unwrap()
                .deleted
        );

        // 2. Cancellazione a t=20
        let ev2 = Event::new(
            Hlc::new(20, 0, "PC-A"),
            "PC-A",
            "u",
            "suggerimento_stato",
            "sugg-1",
            EventBody::Deleted,
        );
        p.apply(&ev2).unwrap();
        assert!(
            p.get("suggerimento_stato", "sugg-1")
                .unwrap()
                .unwrap()
                .deleted
        );

        // 3. Un vecchio Created fuori ordine a t=15 NON deve resuscitare il record
        let ev_old = Event::new(
            Hlc::new(15, 0, "PC-B"),
            "PC-B",
            "u",
            "suggerimento_stato",
            "sugg-1",
            EventBody::Created,
        );
        p.apply(&ev_old).unwrap();
        assert!(
            p.get("suggerimento_stato", "sugg-1")
                .unwrap()
                .unwrap()
                .deleted
        );

        // 4. Una ricreazione successiva a t=30 riattiva il record (deleted = false)
        let ev3 = Event::new(
            Hlc::new(30, 0, "PC-A"),
            "PC-A",
            "u",
            "suggerimento_stato",
            "sugg-1",
            EventBody::Created,
        );
        p.apply(&ev3).unwrap();
        let record = p.get("suggerimento_stato", "sugg-1").unwrap().unwrap();
        assert!(!record.deleted);
        assert_eq!(record.updated_hlc, Hlc::new(30, 0, "PC-A"));
    }

    #[test]
    fn local_notifiche_avvisate_crud() {
        let p = Projection::open_in_memory().unwrap();

        // Inserimento per utente 1
        p.local_notifica_avvisata_set("u1", "suggerimento:2026:provvigione", "provvigione", 100)
            .unwrap();
        p.local_notifica_avvisata_set("u1", "primo_rilevato:2026:provvigione", "provvigione", 50)
            .unwrap();
        p.local_notifica_avvisata_set("u1", "suggerimento:2026:rimborso", "rimborso", 200)
            .unwrap();

        // Inserimento per utente 2 (isolamento)
        p.local_notifica_avvisata_set("u2", "suggerimento:2026:provvigione", "provvigione", 500)
            .unwrap();

        let map_u1 = p.local_notifica_avvisata_get_map("u1").unwrap();
        assert_eq!(map_u1.len(), 3);
        assert_eq!(map_u1.get("suggerimento:2026:provvigione"), Some(&100));
        assert_eq!(map_u1.get("primo_rilevato:2026:provvigione"), Some(&50));
        assert_eq!(map_u1.get("suggerimento:2026:rimborso"), Some(&200));

        let map_u2 = p.local_notifica_avvisata_get_map("u2").unwrap();
        assert_eq!(map_u2.len(), 1);
        assert_eq!(map_u2.get("suggerimento:2026:provvigione"), Some(&500));

        // Cancellazione singola chiave
        p.local_notifica_avvisata_delete("u1", "suggerimento:2026:rimborso")
            .unwrap();
        let map_u1_after_del = p.local_notifica_avvisata_get_map("u1").unwrap();
        assert_eq!(map_u1_after_del.len(), 2);
        assert_eq!(map_u1_after_del.get("suggerimento:2026:rimborso"), None);

        // Cancellazione per tipo (cancella sia suggerimento:2026:provvigione che primo_rilevato:2026:provvigione)
        p.local_notifica_avvisata_delete_tipo("u1", "provvigione")
            .unwrap();
        let map_u1_after_del_tipo = p.local_notifica_avvisata_get_map("u1").unwrap();
        assert!(map_u1_after_del_tipo.is_empty());

        // Utente 2 non è stato toccato
        let map_u2_intatto = p.local_notifica_avvisata_get_map("u2").unwrap();
        assert_eq!(
            map_u2_intatto.get("suggerimento:2026:provvigione"),
            Some(&500)
        );

        // Verifica che l'export per snapshot sia completamente vuoto di queste tabelle locali
        let exported = p.export().unwrap();
        assert!(exported.records.is_empty());
    }

    #[test]
    fn wipe_tecnico_conserva_tutti_gli_utenti_e_wipe_completo_li_elimina() {
        let p = Projection::open_in_memory().unwrap();
        let righe = [
            ("u1", "suggerimento:2026:rimborso", "rimborso", 100),
            ("u1", "primo_rilevato:2026:rimborso", "rimborso", 50),
            ("u2", "suggerimento:2026:produzione", "produzione", 200),
        ];
        for (u, k, t, ts) in righe {
            p.local_notifica_avvisata_set(u, k, t, ts).unwrap();
        }
        let salvate = p.export_local_notifiche_avvisate().unwrap();
        p.wipe_replicated().unwrap();
        assert_eq!(p.export_local_notifiche_avvisate().unwrap(), salvate);
        p.delete_local_suggerimenti("u1").unwrap();
        assert!(p.local_notifica_avvisata_get_map("u1").unwrap().is_empty());
        assert_eq!(p.local_notifica_avvisata_get_map("u2").unwrap().len(), 1);
        p.import_local_notifiche_avvisate(&salvate).unwrap();
        assert_eq!(p.export_local_notifiche_avvisate().unwrap(), salvate);
        p.wipe().unwrap();
        assert!(p.export_local_notifiche_avvisate().unwrap().is_empty());
    }
}
