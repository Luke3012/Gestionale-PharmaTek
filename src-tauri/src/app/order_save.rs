//! Salvataggio aggregato della parte strutturale dell'ordine.
//!
//! Testata e righe vengono appese nello stesso batch. Per gli ordini esistenti il
//! frontend invia patch per campo: l'ultimo salvataggio dello stesso campo vince,
//! mentre le modifiche remote agli altri campi restano intatte.

use std::collections::HashSet;

use serde_json::json;
use ulid::Ulid;

use crate::sync::event::EventBody;
use crate::sync::Mutation;

use super::*;

impl AppState {
    pub fn ordine_salva_base(
        &self,
        input: OrdineSalvaBaseInput,
    ) -> AppResult<OrdineSalvaBaseResult> {
        let nuovo = input.id.is_none();
        let ordine_id = input
            .id
            .clone()
            .unwrap_or_else(|| Ulid::generate().to_string());
        let rimborso_extra = input.rimborso_extra;

        let expected: HashSet<String> = input
            .expected_righe
            .iter()
            .map(|riga| riga.id.clone())
            .collect();
        if expected.len() != input.expected_righe.len() {
            return Err("l'elenco delle righe esistenti contiene duplicati".into());
        }
        if nuovo && (!expected.is_empty() || input.righe.iter().any(|riga| riga.id.is_some())) {
            return Err("un nuovo ordine non può riferirsi a righe già esistenti".into());
        }
        if nuovo && rimborso_extra.is_some() {
            return Err("un nuovo ordine non può adeguare un rimborso esistente".into());
        }

        let mut desired_existing = HashSet::new();
        for riga in &input.righe {
            if let Some(id) = &riga.id {
                if !desired_existing.insert(id.clone()) {
                    return Err("la stessa riga compare più volte nel salvataggio".into());
                }
                if !expected.contains(id) {
                    return Err("una riga da aggiornare non appartiene all'ordine aperto".into());
                }
            }
            valida_numeri_lotto(
                riga.fields
                    .get("qta")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(1),
                riga.fields
                    .get("numero")
                    .and_then(|value| value.as_str())
                    .unwrap_or(""),
            )?;
        }

        let righe_per_totale = input
            .righe
            .iter()
            .map(|riga| (riga.id.clone(), riga.fields.clone()))
            .collect::<Vec<_>>();

        let mut mutations = Vec::new();
        if nuovo {
            mutations.push(Mutation::new(
                "ordine",
                ordine_id.clone(),
                EventBody::Created,
            ));
        }
        mutations.extend(input.fields.into_iter().map(|(field, value)| {
            Mutation::new(
                "ordine",
                ordine_id.clone(),
                EventBody::FieldSet { field, value },
            )
        }));

        let mut desired_ids = Vec::with_capacity(input.righe.len());
        for riga in input.righe {
            let riga_nuova = riga.id.is_none();
            let riga_id = riga.id.unwrap_or_else(|| Ulid::generate().to_string());
            desired_ids.push(riga_id.clone());
            if riga_nuova {
                mutations.push(Mutation::new(
                    "riga_ordine",
                    riga_id.clone(),
                    EventBody::Created,
                ));
            }
            let mut fields = riga.fields;
            // Il legame non è affidato al chiamante: il backend usa sempre l'id
            // dell'ordine creato o verificato in questa stessa operazione.
            fields.insert("ordine_id".into(), json!(ordine_id));
            if riga_nuova {
                fields
                    .entry("stato_riga")
                    .or_insert_with(|| json!("da_spedire"));
            }
            mutations.extend(fields.into_iter().map(|(field, value)| {
                Mutation::new(
                    "riga_ordine",
                    riga_id.clone(),
                    EventBody::FieldSet { field, value },
                )
            }));
        }
        for id in expected.iter().filter(|id| !desired_existing.contains(*id)) {
            mutations.push(Mutation::new("riga_ordine", id.clone(), EventBody::Purged));
        }

        let righe_da_rimuovere = expected
            .iter()
            .filter(|id| !desired_existing.contains(*id))
            .cloned()
            .collect::<Vec<_>>();

        let ordine_for_check = ordine_id.clone();
        self.with_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    if nuovo {
                        if projection
                            .get("ordine", &ordine_for_check)
                            .map_err(|error| error.to_string())?
                            .is_some()
                        {
                            return Err("l'identificativo del nuovo ordine esiste già".into());
                        }
                    } else {
                        let ordine = projection
                            .get("ordine", &ordine_for_check)
                            .map_err(|error| error.to_string())?
                            .ok_or_else(|| "l'ordine non è più disponibile".to_string())?;
                        if ordine.deleted {
                            return Err("l'ordine è stato eliminato da un'altra postazione".into());
                        }
                        for riga_id in &righe_da_rimuovere {
                            let Some(riga) = projection
                                .get("riga_ordine", riga_id)
                                .map_err(|error| error.to_string())?
                            else {
                                continue;
                            };
                            if !riga.deleted && riga_spedita(&riga.data) {
                                return Err(
                                    "una riga rimossa dall'ordine è già stata spedita: aggiorna l'ordine e riprova"
                                        .into(),
                                );
                            }
                        }
                    }

                    if let Some(adeguamento) = rimborso_extra {
                        if adeguamento.importo <= 0 {
                            return Err("il nuovo importo del rimborso non è valido".into());
                        }
                        let rimborso = projection
                            .get("rimborso", &adeguamento.id)
                            .map_err(|error| error.to_string())?
                            .ok_or_else(|| "il rimborso non è più disponibile".to_string())?;
                        if rimborso.deleted {
                            return Err("il rimborso è stato eliminato da un'altra postazione".into());
                        }
                        if str_field(&rimborso.data, "origine") != "extra"
                            || str_field(&rimborso.data, "ordine_id") != ordine_for_check
                        {
                            return Err("il rimborso non appartiene a questo ordine".into());
                        }
                        if !str_field(&rimborso.data, "data_rimborso").is_empty() {
                            return Err(
                                "il rimborso è già stato effettuato e non può essere adeguato automaticamente"
                                    .into(),
                            );
                        }

                        let mut totale_finale = 0i64;
                        for (riga_id, patch) in &righe_per_totale {
                            let mut dati = if let Some(riga_id) = riga_id {
                                let riga = projection
                                    .get("riga_ordine", riga_id)
                                    .map_err(|error| error.to_string())?
                                    .ok_or_else(|| {
                                        "una riga dell'ordine non è più disponibile".to_string()
                                    })?;
                                if riga.deleted {
                                    return Err(
                                        "una riga dell'ordine è stata eliminata da un'altra postazione"
                                            .into(),
                                    );
                                }
                                riga.data
                            } else {
                                serde_json::Map::new()
                            };
                            for (field, value) in patch {
                                dati.insert(field.clone(), value.clone());
                            }
                            totale_finale +=
                                i64_field(&dati, "qta") * i64_field(&dati, "prezzo");
                        }

                        let transito = conti_transito(projection);
                        let incassato = pagamenti_per_ordine(projection, &transito)
                            .get(&ordine_for_check)
                            .map(|riepilogo| riepilogo.incassato)
                            .unwrap_or(0);
                        let gia_effettuato = projection
                            .list("rimborso")
                            .unwrap_or_default()
                            .into_iter()
                            .filter(|record| {
                                record.id != adeguamento.id
                                    && str_field(&record.data, "origine") == "extra"
                                    && str_field(&record.data, "ordine_id") == ordine_for_check
                                    && !str_field(&record.data, "data_rimborso").is_empty()
                            })
                            .map(|record| i64_field(&record.data, "importo").max(0))
                            .sum::<i64>();
                        let importo_corretto =
                            (incassato - totale_finale - gia_effettuato).max(0);
                        if importo_corretto != adeguamento.importo {
                            return Err(
                                "l'eccedenza o i rimborsi dell'ordine sono cambiati: aggiorna l'ordine e riprova"
                                    .into(),
                            );
                        }
                        mutations.push(Mutation::new(
                            "rimborso",
                            adeguamento.id,
                            EventBody::FieldSet {
                                field: "importo".into(),
                                value: json!(importo_corretto),
                            },
                        ));
                    }
                    Ok(mutations)
                })
                .map_err(es)?;

            let ordine = engine
                .with_projection(|projection| {
                    projection
                        .get("ordine", &ordine_id)
                        .ok()
                        .flatten()
                        .map(record_to_dto)
                })
                .ok_or_else(|| "ordine non trovato dopo il salvataggio".to_string())?;
            let mut righe = engine.with_projection(|projection| {
                desired_ids
                    .iter()
                    .filter_map(|id| projection.get("riga_ordine", id).ok().flatten())
                    .map(record_to_dto)
                    .collect::<Vec<_>>()
            });
            righe.sort_by(|a, b| a.id.cmp(&b.id));
            Ok(OrdineSalvaBaseResult {
                id: ordine_id,
                ordine,
                righe,
            })
        })
    }
}
