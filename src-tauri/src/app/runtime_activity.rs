//! Gate nativo tra updater e operazioni che non possono essere interrotte.

use std::sync::Mutex;

use super::{AppResult, AppState};

#[derive(Debug, Default)]
struct GateState {
    update_prepared: bool,
    active_operations: u32,
}

#[derive(Debug, Default)]
pub(crate) struct RuntimeActivityGate {
    state: Mutex<GateState>,
}

impl RuntimeActivityGate {
    fn try_begin(&self) -> AppResult<RuntimeActivityGuard<'_>> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "coordinamento attività locali non disponibile".to_string())?;
        if state.update_prepared {
            return Err(
                "Aggiornamento già in preparazione: attendi il riavvio del gestionale.".into(),
            );
        }
        state.active_operations = state.active_operations.saturating_add(1);
        Ok(RuntimeActivityGuard {
            gate: self,
            release_on_drop: true,
        })
    }

    fn try_prepare_update(&self) -> AppResult<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "coordinamento aggiornamento non disponibile".to_string())?;
        if state.update_prepared {
            return Err("Un altro aggiornamento è già in corso.".into());
        }
        if state.active_operations > 0 {
            return Err(
                "Aggiornamento rimandato: è ancora in corso un'operazione importante.".into(),
            );
        }
        state.update_prepared = true;
        Ok(())
    }

    fn cancel_update(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.update_prepared = false;
        }
    }

    fn finish(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.active_operations = state.active_operations.saturating_sub(1);
        }
    }
}

pub(crate) struct RuntimeActivityGuard<'a> {
    gate: &'a RuntimeActivityGate,
    release_on_drop: bool,
}

impl RuntimeActivityGuard<'_> {
    /// Le lease distribuite terminano in un comando successivo.
    pub(crate) fn keep_active(mut self) {
        self.release_on_drop = false;
    }
}

impl Drop for RuntimeActivityGuard<'_> {
    fn drop(&mut self) {
        if self.release_on_drop {
            self.gate.finish();
        }
    }
}

impl AppState {
    pub(crate) fn begin_runtime_activity(&self) -> AppResult<RuntimeActivityGuard<'_>> {
        self.runtime_activity.try_begin()
    }

    pub(crate) fn prepare_update(&self) -> AppResult<()> {
        self.runtime_activity.try_prepare_update()
    }

    pub(crate) fn cancel_prepared_update(&self) {
        self.runtime_activity.cancel_update();
    }

    pub(crate) fn finish_runtime_activity(&self) {
        self.runtime_activity.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updater_attende_le_attivita_e_blocca_le_nuove() {
        let gate = RuntimeActivityGate::default();
        let activity = gate.try_begin().unwrap();
        assert!(gate.try_prepare_update().is_err());

        drop(activity);
        gate.try_prepare_update().unwrap();
        assert!(gate.try_begin().is_err());

        gate.cancel_update();
        assert!(gate.try_begin().is_ok());
    }

    #[test]
    fn attivita_persistente_richiede_rilascio_esplicito() {
        let gate = RuntimeActivityGate::default();
        gate.try_begin().unwrap().keep_active();
        assert!(gate.try_prepare_update().is_err());

        gate.finish();
        assert!(gate.try_prepare_update().is_ok());
    }
}
