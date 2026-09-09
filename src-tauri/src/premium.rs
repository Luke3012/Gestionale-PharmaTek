use std::path::Path;

use crate::app::AppState;

const PREMIUM_STATE_FILE: &str = "premium.json";
const PREMIUM_ENTITIES: &[&str] = &[
    "modello_comunicazione",
    "modello_comunicazione_versione",
    "regola_comunicazione",
    "campagna_comunicazione",
    "comunicazione",
    "tentativo_comunicazione",
    "allegato_comunicazione",
    "configurazione_canale",
    "lease_mittente",
    "preventivo",
    "scheda_cliente",
    "alias_preventivo",
    "configurazione_documenti",
    "suggerimento_stato",
];

/// Restituisce lo stato premium registrato esclusivamente nella cartella locale
/// dell'app. File assente, JSON non valido o campo non booleano significano chiuso.
pub(crate) fn is_enabled(app_dir: &Path) -> bool {
    std::fs::read(app_dir.join(PREMIUM_STATE_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|state| state.get("enabled").and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

/// Guardia condivisa dai futuri comandi e processi automatici premium.
#[allow(dead_code)] // diventa usata appena arriva il primo comando delle FASI 11-13
pub(crate) fn ensure_access(state: &AppState) -> Result<(), String> {
    if is_enabled(&state.app_dir) {
        Ok(())
    } else {
        Err("Funzionalità extra non abilitate su questo PC.".to_string())
    }
}

/// Le entità con effetti esterni passano soltanto dai comandi di dominio. Il
/// CRUD generico non può crearle o mutarle neppure su un PC premium: prima
/// restituiamo comunque il paywall corretto ai PC non abilitati.
pub(crate) fn ensure_generic_entity_access(state: &AppState, entity: &str) -> Result<(), String> {
    if PREMIUM_ENTITIES.contains(&entity) {
        ensure_access(state)?;
        Err("Questi dati possono essere modificati soltanto dal relativo flusso Premium.".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn premium_locale_e_chiuso_senza_file_o_con_file_non_valido() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_enabled(dir.path()));

        std::fs::write(dir.path().join(PREMIUM_STATE_FILE), b"non-json").unwrap();
        assert!(!is_enabled(dir.path()));

        std::fs::write(dir.path().join(PREMIUM_STATE_FILE), br#"{"enabled":"si"}"#).unwrap();
        assert!(!is_enabled(dir.path()));
    }

    #[test]
    fn premium_locale_rispetta_attivazione_e_disattivazione() {
        let dir = tempfile::tempdir().unwrap();

        std::fs::write(dir.path().join(PREMIUM_STATE_FILE), br#"{"enabled":false}"#).unwrap();
        assert!(!is_enabled(dir.path()));

        std::fs::write(dir.path().join(PREMIUM_STATE_FILE), br#"{"enabled":true}"#).unwrap();
        assert!(is_enabled(dir.path()));
    }

    #[test]
    fn riconosce_le_entita_protette() {
        assert!(PREMIUM_ENTITIES.contains(&"comunicazione"));
        assert!(PREMIUM_ENTITIES.contains(&"configurazione_canale"));
        assert!(PREMIUM_ENTITIES.contains(&"preventivo"));
        assert!(PREMIUM_ENTITIES.contains(&"scheda_cliente"));
        assert!(PREMIUM_ENTITIES.contains(&"alias_preventivo"));
        assert!(PREMIUM_ENTITIES.contains(&"configurazione_documenti"));
        assert!(PREMIUM_ENTITIES.contains(&"suggerimento_stato"));
        assert!(!PREMIUM_ENTITIES.contains(&"cliente"));
    }
}
