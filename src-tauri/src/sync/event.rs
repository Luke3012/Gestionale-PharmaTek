//! Definizione dell'evento e (de)serializzazione NDJSON.
//!
//! Un evento è **immutabile** e descrive una singola modifica granulare a un
//! record (un'entità del modello dati). Lo stato visibile è la proiezione
//! ottenuta "piegando" (fold) tutti gli eventi: vedi `projection`.
//!
//! Formato sul disco: **una riga JSON per evento** (NDJSON), es.
//! ```text
//! {"id":"01J…","ts":"…","device":"PC-LIVIO","user":"Livio","entity":"order","entityId":"01J…","op":"created"}
//! {"id":"01J…","ts":"…","device":"PC-UFFICIO","user":"Anna","entity":"order","entityId":"01J…","op":"field_set","field":"acconto","value":15000}
//! ```
//! I valori monetari in `value` sono **interi in centesimi**.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ulid::Ulid;

use super::hlc::Hlc;

/// Il "corpo" dell'evento: che tipo di modifica rappresenta.
///
/// Serializzato con tag interno `op` (snake_case), appiattito dentro [`Event`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum EventBody {
    /// Il record viene creato (la sua esistenza). I campi arrivano con `FieldSet`.
    Created,
    /// Imposta il valore di un campo (merge per-campo Last-Write-Wins sull'HLC).
    FieldSet { field: String, value: Value },
    /// Soft-delete: il record finisce nel Cestino, è ripristinabile.
    Deleted,
    /// Annulla un soft-delete.
    Restored,
    /// Eliminazione **definitiva** (dal Cestino): il record sparisce e non è più
    /// ripristinabile. Gli eventi restano nel log (rimossi solo dalla compattazione).
    Purged,
}

/// Un evento del log append-only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    /// ULID dell'evento: unico e ordinabile per istante di creazione locale.
    pub id: String,
    /// Timestamp HLC, usato per l'ordinamento globale e il merge LWW.
    pub ts: Hlc,
    /// Dispositivo che ha emesso l'evento.
    pub device: String,
    /// Utente che ha emesso l'evento (per audit/storico).
    pub user: String,
    /// Tipo di entità del modello dati (es. `order`, `client`, `product`).
    pub entity: String,
    /// ULID del record bersaglio.
    #[serde(rename = "entityId")]
    pub entity_id: String,
    /// Cosa fa l'evento.
    #[serde(flatten)]
    pub body: EventBody,
}

impl Event {
    /// Costruisce un nuovo evento con un id ULID fresco.
    pub fn new(
        ts: Hlc,
        device: impl Into<String>,
        user: impl Into<String>,
        entity: impl Into<String>,
        entity_id: impl Into<String>,
        body: EventBody,
    ) -> Self {
        Event {
            id: Ulid::generate().to_string(),
            ts,
            device: device.into(),
            user: user.into(),
            entity: entity.into(),
            entity_id: entity_id.into(),
            body,
        }
    }

    /// Serializza in una singola riga NDJSON (senza terminatore `\n`).
    pub fn to_ndjson(&self) -> serde_json::Result<String> {
        serde_json::to_string(self)
    }

    /// Deserializza da una riga NDJSON.
    pub fn from_ndjson(line: &str) -> serde_json::Result<Self> {
        serde_json::from_str(line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn roundtrip_field_set() {
        let ev = Event::new(
            Hlc::new(1000, 0, "PC-A"),
            "PC-A",
            "Livio",
            "order",
            "01ORDER",
            EventBody::FieldSet {
                field: "acconto".into(),
                value: json!(15000),
            },
        );
        let line = ev.to_ndjson().unwrap();
        assert!(!line.contains('\n'));
        // l'op è appiattita nello stesso oggetto
        assert!(line.contains("\"op\":\"field_set\""));
        assert!(line.contains("\"field\":\"acconto\""));
        assert!(line.contains("\"entityId\":\"01ORDER\""));
        let back = Event::from_ndjson(&line).unwrap();
        assert_eq!(ev, back);
    }

    #[test]
    fn roundtrip_created_e_deleted() {
        for body in [EventBody::Created, EventBody::Deleted, EventBody::Restored] {
            let ev = Event::new(
                Hlc::new(1, 0, "PC-A"),
                "PC-A",
                "Anna",
                "client",
                "01CLIENT",
                body.clone(),
            );
            let back = Event::from_ndjson(&ev.to_ndjson().unwrap()).unwrap();
            assert_eq!(ev.body, body);
            assert_eq!(ev, back);
        }
    }
}
