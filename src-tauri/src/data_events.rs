//! Eventi di invalidazione delle viste dopo una modifica della proiezione.
//!
//! Tutte le scritture locali e gli ingest remoti devono passare da qui: in questo
//! modo una vista non dipende dal componente che ha materialmente eseguito la
//! modifica. Gli eventi eccezionali restano distinti dalle normali invalidazioni.

use std::collections::BTreeSet;

use serde_json::json;
use tauri::{Emitter, Manager};

pub const EVENTO_RICERCA_INVALIDATA: &str = "pt:ricerca-invalidata";
const EVENTO_DATI_MODIFICATI: &str = "pt:dati-modificati";

fn eventi_per_entita(entity: &str) -> Vec<String> {
    let eventi: &[&str] = match entity {
        "ordine" | "riga_ordine" => &["ordine:salvato"],
        "pagamento" => &["pagamento:salvato", "ordine:salvato"],
        // `messaggio:salvato` è l'alias storico usato dalle finestre messaggi.
        // Entrambi partono dalla stessa entità, senza riemissioni dal frontend.
        "notifica" | "messaggio" => &["notifica:salvato", "messaggio:salvato"],
        "notifica_letta" => &["notifica:salvato"],
        "suggerimento_stato" => &["suggerimento:salvato"],
        "promemoria" => &["promemoria:salvato"],
        "spedizione" => &["spedizione:salvato", "ordine:salvato", "pagamento:salvato"],
        "distinta" => &["distinta:salvato", "pagamento:salvato", "ordine:salvato"],
        "rimborso" => &["rimborso:salvato", "ordine:salvato"],
        _ => return vec![format!("{entity}:salvato")],
    };
    eventi.iter().map(|evento| (*evento).to_string()).collect()
}

fn influenza_ricerca(entity: &str) -> bool {
    matches!(
        entity,
        "ordine"
            | "riga_ordine"
            | "cliente"
            | "medico"
            | "agente"
            | "prodotto"
            | "corriere"
            | "conto"
            | "distinta"
            | "spedizione"
            | "pagamento"
            | "promemoria"
            | "preventivo"
            | "user"
            | "snapshot"
    )
}

/// Invalida le viste interessate dalle entità modificate. `device_retired` non è
/// una normale modifica dati: conserva il percorso bloccante di riallineamento.
pub fn emetti_entita_modificate(app: &tauri::AppHandle, entities: &[String]) {
    if let Some(notificatore) = app.try_state::<std::sync::Arc<crate::notifiche::Notificatore>>() {
        notificatore.invalida_suggerimenti(entities);
        notificatore.segnala_modifica();
    }
    let mut eventi_visti = BTreeSet::new();
    let mut ricerca_sporca = false;
    let mut dati_modificati = false;

    for entity in entities {
        if entity == "device_retired" {
            let _ = app.emit("pt:data-wiped", json!({ "reason": "identity" }));
            continue;
        }

        dati_modificati = true;
        ricerca_sporca |= influenza_ricerca(entity);
        for evento in eventi_per_entita(entity) {
            if eventi_visti.insert(evento.clone()) {
                let _ = app.emit(&evento, ());
            }
        }
    }

    if dati_modificati {
        let _ = app.emit(EVENTO_DATI_MODIFICATI, ());
    }
    if ricerca_sporca {
        let _ = app.emit(EVENTO_RICERCA_INVALIDATA, ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn righe_ordine_invalidano_la_stessa_vista_dell_ordine() {
        assert_eq!(eventi_per_entita("riga_ordine"), ["ordine:salvato"]);
        assert_eq!(
            eventi_per_entita("notifica"),
            ["notifica:salvato", "messaggio:salvato"]
        );
        assert_eq!(eventi_per_entita("notifica_letta"), ["notifica:salvato"]);
        assert_eq!(
            eventi_per_entita("suggerimento_stato"),
            ["suggerimento:salvato"]
        );
    }

    #[test]
    fn stati_tecnici_non_sporcano_l_indice_ricerca() {
        assert!(!influenza_ricerca("notifica_letta"));
        assert!(!influenza_ricerca("suggerimento_stato"));
        assert!(!influenza_ricerca("impostazioni"));
        assert!(influenza_ricerca("cliente"));
        assert!(influenza_ricerca("pagamento"));
        assert!(influenza_ricerca("snapshot"));
    }
}
