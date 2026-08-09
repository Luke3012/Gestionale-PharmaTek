use super::*;

impl AppState {
    /// Salva insieme i dati compilati nel modale di preparazione. Il controllo dello
    /// stato e tutte le patch condividono lo stesso batch: se anche una sola riga non
    /// è più disponibile, è già in lavorazione o è stata spedita, non viene scritto nulla.
    pub fn produzione_compila_righe(
        &self,
        aggiornamenti: Vec<ProduzioneRigaPatchInput>,
    ) -> AppResult<()> {
        if aggiornamenti.is_empty() {
            return Ok(());
        }
        self.with_engine(|engine| {
            engine
                .emit_built_checked(move |p| {
                    let mut ids = HashSet::new();
                    let mut mutations = Vec::new();
                    for aggiornamento in aggiornamenti {
                        if aggiornamento.id.trim().is_empty()
                            || !ids.insert(aggiornamento.id.clone())
                        {
                            return Err("selezione produzione non valida".into());
                        }
                        let riga = p
                            .get("riga_ordine", &aggiornamento.id)
                            .map_err(|error| error.to_string())?
                            .ok_or_else(|| {
                                "una riga è stata eliminata da un altro PC".to_string()
                            })?;
                        if riga.deleted {
                            return Err("una riga è stata eliminata da un altro PC".into());
                        }
                        if !str_field(&riga.data, "stato_produzione").is_empty()
                            || !str_field(&riga.data, "lotto_produzione").is_empty()
                            || riga_spedita(&riga.data)
                        {
                            return Err("una riga è già stata lavorata da un altro PC".into());
                        }

                        if aggiornamento.fields.contains_key("qta")
                            || aggiornamento.fields.contains_key("numero")
                        {
                            let qta = aggiornamento
                                .fields
                                .get("qta")
                                .and_then(|value| value.as_i64())
                                .unwrap_or_else(|| i64_field(&riga.data, "qta"));
                            let numero = aggiornamento
                                .fields
                                .get("numero")
                                .and_then(|value| value.as_str())
                                .map(str::to_string)
                                .unwrap_or_else(|| str_field(&riga.data, "numero"));
                            valida_numeri_lotto(qta, &numero)?;
                        }

                        mutations.extend(aggiornamento.fields.into_iter().map(|(field, value)| {
                            Mutation::new(
                                "riga_ordine",
                                aggiornamento.id.clone(),
                                EventBody::FieldSet { field, value },
                            )
                        }));
                    }
                    Ok(mutations)
                })
                .map_err(es)?;
            Ok(())
        })
    }

    /// Porta in blocco un set di ordini a uno stato di **produzione** (FASE 5A), registrando
    /// la data del passaggio nel campo dedicato:
    ///  · `"In produzione"` → `data_produzione`;
    ///  · `"Arrivato IT"`   → `data_arrivo_it`.
    /// Non tocca i pagamenti (l'eventuale assenza dell'acconto è solo un avviso lato UI).
    /// Ignora `stato` non riconosciuti. Ritorna il numero di ordini aggiornati.
    pub fn ordini_avanza_produzione(
        &self,
        ids: &[String],
        stato: &str,
        data: &str,
    ) -> AppResult<usize> {
        let campo_data = match stato {
            "In produzione" => "data_produzione",
            "Arrivato IT" => "data_arrivo_it",
            _ => return Ok(0),
        };
        self.with_engine(|engine| {
            for id in ids {
                set_fields(
                    engine,
                    "ordine",
                    id,
                    &[("stato", json!(stato)), (campo_data, json!(data))],
                )?;
            }
            Ok(ids.len())
        })
    }

    /// **Manda in produzione** un set di ordini come **un unico lotto** (sessione di invio,
    /// FASE 5B): genera un nuovo `lotto_produzione` condiviso, porta ogni ordine a
    /// `In produzione` con `data_produzione = data`, e salva lo `stato_pre_produzione`
    /// (per poter disfare l'invio). Non tocca i pagamenti. Ritorna l'id del lotto creato.
    pub fn produzione_invia(&self, ids: &[String], data: &str) -> AppResult<String> {
        if ids.is_empty() {
            return Err("nessun ordine selezionato".into());
        }
        let mut unici = HashSet::new();
        for id in ids {
            if id.trim().is_empty() || !unici.insert(id.clone()) {
                return Err("selezione produzione non valida".into());
            }
        }
        let lotto = Ulid::generate().to_string();
        self.with_engine(|engine| {
            engine.with_projection(|p| -> AppResult<()> {
                for id in ids {
                    let ordine = p.get("ordine", id).map_err(es)?.ok_or_else(|| {
                        "uno degli ordini selezionati non e' piu disponibile".to_string()
                    })?;
                    let stato = str_field(&ordine.data, "stato");
                    if matches!(stato.as_str(), "Rifiutato" | "Spedito" | "Chiuso") {
                        return Err(
                            "uno degli ordini selezionati non e' piu inviabile in produzione"
                                .into(),
                        );
                    }
                    let righe: Vec<_> = p
                        .list("riga_ordine")
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|r| str_field(&r.data, "ordine_id") == *id)
                        .collect();
                    if righe.is_empty() || righe.iter().all(|r| riga_in_lavorazione(&r.data)) {
                        return Err(
                            "uno degli ordini selezionati non ha piu righe da produrre".into()
                        );
                    }
                }
                Ok(())
            })?;
            for id in ids {
                let stato = engine.with_projection(|p| {
                    p.get("ordine", id)
                        .ok()
                        .flatten()
                        .map(|r| str_field(&r.data, "stato"))
                        .unwrap_or_default()
                });
                set_fields(
                    engine,
                    "ordine",
                    id,
                    &[
                        ("stato", json!("In produzione")),
                        ("data_produzione", json!(data)),
                        ("data_arrivo_it", json!("")),
                        ("lotto_produzione", json!(lotto)),
                        ("lotto_produzione_pre", json!("")),
                        ("stato_pre_produzione", json!(stato)),
                    ],
                )?;
                // Stampa il lotto anche sulle RIGHE (modello per-riga FASE 7): così l'export
                // Laboratorio/Diagnostica — che ora filtra per `riga.lotto_produzione` — funziona
                // sia col vecchio invio per-ordine sia col nuovo per-riga.
                let righe: Vec<String> = engine.with_projection(|p| {
                    p.list("riga_ordine")
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|r| str_field(&r.data, "ordine_id") == *id)
                        .map(|r| r.id)
                        .collect()
                });
                for rid in &righe {
                    set_fields(
                        engine,
                        "riga_ordine",
                        rid,
                        &[
                            ("stato_produzione", json!("in_produzione")),
                            ("lotto_produzione", json!(lotto)),
                            ("lotto_produzione_pre", json!("")),
                        ],
                    )?;
                }
            }
            Ok(())
        })?;
        Ok(lotto)
    }

    /// Disfa l'invio in produzione di **un singolo ordine**: lo riporta in coda «Da
    /// produrre» ripristinando lo `stato_pre_produzione` (fallback `Confermato`) e azzera
    /// i campi di produzione (data/lotto). Non tocca i pagamenti. FASE 5B.
    pub fn produzione_annulla_ordine(&self, id: &str) -> AppResult<()> {
        self.with_engine(|engine| produzione_disfa_ordine(engine, id))
    }

    /// Annulla un intero **lotto di produzione**: ogni ordine del lotto torna in coda
    /// «Da produrre» (come `produzione_annulla_ordine`). FASE 5B.
    pub fn produzione_lotto_annulla(&self, lotto: &str) -> AppResult<()> {
        if lotto.is_empty() {
            return Err("lotto non valido".into());
        }
        self.with_engine(|engine| {
            let ids: Vec<String> = engine.with_projection(|p| {
                p.list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "lotto_produzione") == lotto)
                    .map(|r| r.id)
                    .collect()
            });
            if ids.is_empty() {
                return Err("lotto produzione non piu disponibile".into());
            }
            for id in &ids {
                produzione_disfa_ordine(engine, id)?;
            }
            Ok(())
        })
    }

    /// Fonde più **lotti di produzione** in uno solo (il primo passato): tutti gli ordini
    /// vi confluiscono, così in «In lavorazione» diventano un unico gruppo — utile per
    /// l'export unico e l'organizzazione. Salva il lotto originale in `lotto_produzione_pre`
    /// (la prima volta) così l'unione è **reversibile** con `produzione_lotto_separa`.
    /// Ritorna il lotto risultante. FASE 5B (specchio di `lotto_unisci`).
    pub fn produzione_lotto_unisci(&self, lotti: Vec<String>) -> AppResult<String> {
        let mut lotti_unici: Vec<String> = Vec::new();
        for lotto in lotti
            .into_iter()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
        {
            if !lotti_unici.contains(&lotto) {
                lotti_unici.push(lotto);
            }
        }
        let lotti = lotti_unici;
        if lotti.len() < 2 {
            return Err("seleziona almeno due lotti da unire".into());
        }
        let target = lotti[0].clone();
        let set: std::collections::HashSet<&str> = lotti.iter().map(|s| s.as_str()).collect();
        self.with_engine(|engine| {
            let recs: Vec<(String, String, String)> = engine.with_projection(|p| {
                p.list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| set.contains(str_field(&r.data, "lotto_produzione").as_str()))
                    .map(|r| {
                        (
                            r.id,
                            str_field(&r.data, "lotto_produzione"),
                            str_field(&r.data, "lotto_produzione_pre"),
                        )
                    })
                    .collect()
            });
            let presenti: std::collections::HashSet<String> =
                recs.iter().map(|(_, lotto, _)| lotto.clone()).collect();
            if presenti.len() != set.len() {
                return Err("uno dei lotti produzione selezionati non e' piu disponibile".into());
            }
            for (oid, lotto, lotto_pre) in &recs {
                let pre = if lotto_pre.is_empty() {
                    lotto.clone()
                } else {
                    lotto_pre.clone()
                };
                set_fields(
                    engine,
                    "ordine",
                    oid,
                    &[
                        ("lotto_produzione", json!(target)),
                        ("lotto_produzione_pre", json!(pre)),
                    ],
                )?;
            }
            Ok(())
        })?;
        Ok(target)
    }

    /// Separa un lotto di produzione **unito** (annulla `produzione_lotto_unisci`): ogni
    /// ordine torna al proprio lotto originale (`lotto_produzione_pre`), poi azzerato. FASE 5B.
    pub fn produzione_lotto_separa(&self, lotto: &str) -> AppResult<()> {
        if lotto.is_empty() {
            return Err("lotto non valido".into());
        }
        self.with_engine(|engine| {
            let recs: Vec<(String, String)> = engine.with_projection(|p| {
                p.list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "lotto_produzione") == lotto)
                    .map(|r| (r.id, str_field(&r.data, "lotto_produzione_pre")))
                    .filter(|(_, pre)| !pre.is_empty())
                    .collect()
            });
            if recs.is_empty() {
                return Err("il lotto produzione non risulta piu unito".into());
            }
            for (oid, pre) in &recs {
                set_fields(
                    engine,
                    "ordine",
                    oid,
                    &[
                        ("lotto_produzione", json!(pre)),
                        ("lotto_produzione_pre", json!("")),
                    ],
                )?;
            }
            Ok(())
        })
    }

    // ===== Produzione PER RIGA (FASE 7) =====
    // Modello specchio della spedizione: lo stato di produzione vive sulla riga
    // (`stato_produzione` + `lotto_produzione` per riga) e lo stato della testata è DERIVATO
    // (`aggiorna_stato_produzione`). Permette di mandare in produzione un prodotto o alcuni di
    // un ordine, non per forza tutti.

    /// Manda in produzione le **righe** selezionate (anche di ordini diversi) come **un unico
    /// lotto**: ogni riga → `in_produzione` + `lotto_produzione`. Conferma gli ordini «Nuovo»,
    /// imposta `data_produzione` di testata (se manca, per ordinamento) e, solo per chiamanti
    /// legacy che passano `data_prevista`, il fallback `data_prevista_lotto`. Non tocca i
    /// pagamenti. Ritorna l'id del lotto.
    pub fn produzione_invia_righe(
        &self,
        righe_ids: &[String],
        data: &str,
        data_prevista: &str,
    ) -> AppResult<String> {
        if righe_ids.is_empty() {
            return Err("nessuna riga selezionata".into());
        }
        let lotto = Ulid::generate().to_string();
        self.with_engine(|engine| {
            let mut righe_uniche = HashSet::new();
            engine.with_projection(|p| -> AppResult<()> {
                for rid in righe_ids {
                    if rid.trim().is_empty() || !righe_uniche.insert(rid.clone()) {
                        return Err("selezione produzione non valida".into());
                    }
                    let riga = p.get("riga_ordine", rid).map_err(es)?.ok_or_else(|| {
                        "una delle righe selezionate non e' piu disponibile".to_string()
                    })?;
                    if !str_field(&riga.data, "stato_produzione").is_empty()
                        || !str_field(&riga.data, "lotto_produzione").is_empty()
                    {
                        return Err("una delle righe selezionate e' gia in produzione".into());
                    }
                    if riga_spedita(&riga.data) {
                        return Err("una delle righe selezionate e' gia stata spedita".into());
                    }
                    let oid = str_field(&riga.data, "ordine_id");
                    let ordine = p.get("ordine", &oid).map_err(es)?.ok_or_else(|| {
                        "uno degli ordini selezionati non e' piu disponibile".to_string()
                    })?;
                    let stato = str_field(&ordine.data, "stato");
                    if matches!(stato.as_str(), "Rifiutato" | "Spedito" | "Chiuso") {
                        return Err(
                            "uno degli ordini selezionati non e' piu inviabile in produzione"
                                .into(),
                        );
                    }
                }
                Ok(())
            })?;
            let mut ordini: Vec<String> = Vec::new();
            for rid in righe_ids {
                set_fields(
                    engine,
                    "riga_ordine",
                    rid,
                    &[
                        ("stato_produzione", json!("in_produzione")),
                        ("lotto_produzione", json!(lotto)),
                        ("lotto_produzione_pre", json!("")),
                        // Data di invio del lotto SULLA RIGA = la data reale di questo invio (oggi).
                        // La testata `data_produzione` dell'ordine segue la regola «prima vince»
                        // (per ordinamento/export legacy) e può quindi restare a un invio
                        // precedente; il lotto deve invece mostrare la propria data reale.
                        ("data_produzione", json!(data)),
                    ],
                )?;
                if let Some(r) =
                    engine.with_projection(|p| p.get("riga_ordine", rid).ok().flatten())
                {
                    let oid = str_field(&r.data, "ordine_id");
                    if !oid.is_empty() && !ordini.contains(&oid) {
                        ordini.push(oid);
                    }
                }
            }
            for oid in &ordini {
                conferma_se_nuovo(engine, oid)?;
                // Date di testata: impostale solo se non già presenti (unendo lotti o invii
                // parziali successivi, la prima vince) — servono a ordinamento/export.
                let (dp, dpl) = engine.with_projection(|p| {
                    p.get("ordine", oid)
                        .ok()
                        .flatten()
                        .map(|r| {
                            (
                                str_field(&r.data, "data_produzione"),
                                str_field(&r.data, "data_prevista_lotto"),
                            )
                        })
                        .unwrap_or_default()
                });
                let mut campi: Vec<(&str, serde_json::Value)> = Vec::new();
                if dp.is_empty() && !data.is_empty() {
                    campi.push(("data_produzione", json!(data)));
                }
                if dpl.is_empty() && !data_prevista.is_empty() {
                    campi.push(("data_prevista_lotto", json!(data_prevista)));
                }
                if !campi.is_empty() {
                    set_fields(engine, "ordine", oid, &campi)?;
                }
                aggiorna_stato_produzione(engine, oid)?;
            }
            Ok(())
        })?;
        Ok(lotto)
    }

    /// Porta le righe indicate a uno stato di produzione (`arrivato_it` per «Arrivato in
    /// Italia», o `in_produzione` per tornare indietro) e ricalcola lo stato derivato. FASE 7.
    pub fn produzione_righe_stato(
        &self,
        righe_ids: &[String],
        stato: &str,
        data: &str,
    ) -> AppResult<()> {
        if !matches!(stato, "in_produzione" | "arrivato_it") {
            return Err("stato di produzione non valido".into());
        }
        self.with_engine(|engine| {
            let mut ordini: Vec<String> = Vec::new();
            for rid in righe_ids {
                set_fields(
                    engine,
                    "riga_ordine",
                    rid,
                    &[("stato_produzione", json!(stato))],
                )?;
                if let Some(r) =
                    engine.with_projection(|p| p.get("riga_ordine", rid).ok().flatten())
                {
                    let oid = str_field(&r.data, "ordine_id");
                    if !oid.is_empty() && !ordini.contains(&oid) {
                        ordini.push(oid);
                    }
                }
            }
            for oid in &ordini {
                if stato == "arrivato_it" && !data.is_empty() {
                    let gia = engine.with_projection(|p| {
                        p.get("ordine", oid)
                            .ok()
                            .flatten()
                            .map(|r| str_field(&r.data, "data_arrivo_it"))
                            .unwrap_or_default()
                    });
                    if gia.is_empty() {
                        set_fields(engine, "ordine", oid, &[("data_arrivo_it", json!(data))])?;
                    }
                }
                aggiorna_stato_produzione(engine, oid)?;
            }
            Ok(())
        })
    }

    /// Annulla l'invio in produzione di una **singola riga** (FASE 7): torna «da produrre»
    /// (azzera `stato_produzione`/`lotto_produzione`), poi ricalcola lo stato dell'ordine.
    pub fn produzione_riga_annulla(&self, riga_id: &str) -> AppResult<()> {
        self.with_engine(|engine| {
            let oid = engine.with_projection(|p| {
                p.get("riga_ordine", riga_id)
                    .ok()
                    .flatten()
                    .map(|r| str_field(&r.data, "ordine_id"))
                    .unwrap_or_default()
            });
            set_fields(
                engine,
                "riga_ordine",
                riga_id,
                &[
                    ("stato_produzione", json!("")),
                    ("lotto_produzione", json!("")),
                    ("lotto_produzione_pre", json!("")),
                ],
            )?;
            if !oid.is_empty() {
                aggiorna_stato_produzione(engine, &oid)?;
            }
            Ok(())
        })
    }

    /// Tutte le righe di un **lotto di produzione**: le annulla (tornano «da produrre»). FASE 7.
    pub fn produzione_lotto_righe_annulla(&self, lotto: &str) -> AppResult<()> {
        if lotto.is_empty() {
            return Err("lotto non valido".into());
        }
        self.with_engine(|engine| {
            let ids: Vec<String> = engine.with_projection(|p| {
                p.list("riga_ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "lotto_produzione") == lotto)
                    .map(|r| r.id)
                    .collect()
            });
            let mut ordini: Vec<String> = Vec::new();
            for rid in &ids {
                set_fields(
                    engine,
                    "riga_ordine",
                    rid,
                    &[
                        ("stato_produzione", json!("")),
                        ("lotto_produzione", json!("")),
                        ("lotto_produzione_pre", json!("")),
                    ],
                )?;
                if let Some(r) =
                    engine.with_projection(|p| p.get("riga_ordine", rid).ok().flatten())
                {
                    let oid = str_field(&r.data, "ordine_id");
                    if !oid.is_empty() && !ordini.contains(&oid) {
                        ordini.push(oid);
                    }
                }
            }
            for oid in &ordini {
                aggiorna_stato_produzione(engine, oid)?;
            }
            Ok(())
        })
    }

    /// Porta tutte le righe di un lotto a `arrivato_it` (FASE 7), poi ricalcola gli ordini.
    pub fn produzione_lotto_righe_arrivate(&self, lotto: &str, data: &str) -> AppResult<()> {
        if lotto.is_empty() {
            return Err("lotto non valido".into());
        }
        let ids: Vec<String> = self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                p.list("riga_ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "lotto_produzione") == lotto)
                    .map(|r| r.id)
                    .collect()
            }))
        })?;
        self.produzione_righe_stato(&ids, "arrivato_it", data)
    }

    /// Fonde più **lotti di produzione** (per riga) in uno solo: tutte le righe dei `lotti`
    /// passano al primo lotto; il lotto originale resta in `lotto_produzione_pre` (prima volta)
    /// per poter separare. Ritorna il lotto risultante. FASE 7.
    pub fn produzione_lotto_righe_unisci(&self, lotti: Vec<String>) -> AppResult<String> {
        let lotti: Vec<String> = lotti.into_iter().filter(|l| !l.is_empty()).collect();
        if lotti.len() < 2 {
            return Err("seleziona almeno due lotti da unire".into());
        }
        let target = lotti[0].clone();
        let set: std::collections::HashSet<&str> = lotti.iter().map(|s| s.as_str()).collect();
        self.with_engine(|engine| {
            let recs: Vec<(String, String, String)> = engine.with_projection(|p| {
                p.list("riga_ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| set.contains(str_field(&r.data, "lotto_produzione").as_str()))
                    .map(|r| {
                        (
                            r.id,
                            str_field(&r.data, "lotto_produzione"),
                            str_field(&r.data, "lotto_produzione_pre"),
                        )
                    })
                    .collect()
            });
            for (rid, lotto, lotto_pre) in &recs {
                let pre = if lotto_pre.is_empty() {
                    lotto.clone()
                } else {
                    lotto_pre.clone()
                };
                set_fields(
                    engine,
                    "riga_ordine",
                    rid,
                    &[
                        ("lotto_produzione", json!(target)),
                        ("lotto_produzione_pre", json!(pre)),
                    ],
                )?;
            }
            Ok(())
        })?;
        Ok(target)
    }

    /// Separa un lotto di produzione unito (per riga): ogni riga torna al suo
    /// `lotto_produzione_pre`, poi azzerato. FASE 7.
    pub fn produzione_lotto_righe_separa(&self, lotto: &str) -> AppResult<()> {
        if lotto.is_empty() {
            return Err("lotto non valido".into());
        }
        self.with_engine(|engine| {
            let recs: Vec<(String, String)> = engine.with_projection(|p| {
                p.list("riga_ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "lotto_produzione") == lotto)
                    .map(|r| (r.id, str_field(&r.data, "lotto_produzione_pre")))
                    .filter(|(_, pre)| !pre.is_empty())
                    .collect()
            });
            for (rid, pre) in &recs {
                set_fields(
                    engine,
                    "riga_ordine",
                    rid,
                    &[
                        ("lotto_produzione", json!(pre)),
                        ("lotto_produzione_pre", json!("")),
                    ],
                )?;
            }
            Ok(())
        })
    }

    /// **Export Laboratorio (Immunoterapia)** di un lotto (FASE 5C): genera il `.xlsx` nel
    /// formato reale (`maggio_2026.xlsx`). Una riga Laboratorio per **riga d'ordine** (paziente);
    /// acconto (col C, saldato se incassato altrimenti previsto) e valore (col I) solo sulla
    /// **prima** riga di ciascun ordine. Assegna e **persiste** il `numero_produzione` (col D)
    /// alle righe che ancora non l'hanno: `next = max(esistenti, base−1) + 1` (idempotente:
    /// ri-esportare non cambia i numeri già assegnati). `data_prevista` (col J) è il default
    /// del lotto, sovrascritto dall'eventuale `data_prevista` salvata sulla riga.
    pub fn fornitore_export(
        &self,
        lotto: &str,
        path: &str,
        base: i64,
        data_prevista: &str,
    ) -> AppResult<usize> {
        if lotto.is_empty() {
            return Err("lotto non valido".into());
        }
        let righe = self.with_engine(|engine| {
            // La data prevista (col J) vive prima di tutto sulla riga (`data_prevista`), con
            // fallback legacy sull'ordine (`data_prevista_lotto`). Se qui arriva un valore di
            // fallback da vecchi flussi, lo salvo SOLO sugli ordini che ancora non ne hanno una,
            // senza sovrascrivere quelle già impostate.
            // Il lotto vive ora SULLE RIGHE (FASE 7): un ordine "appartiene" al lotto se ha
            // almeno una riga col lotto, e si esportano SOLO le sue righe di quel lotto.
            let ord_del_lotto =
                |p: &crate::projection::Projection| -> std::collections::HashSet<String> {
                    p.list("riga_ordine")
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|r| str_field(&r.data, "lotto_produzione") == lotto)
                        .map(|r| str_field(&r.data, "ordine_id"))
                        .filter(|s| !s.is_empty())
                        .collect()
                };
            if !data_prevista.is_empty() {
                let ids: Vec<String> = engine.with_projection(|p| {
                    let set = ord_del_lotto(p);
                    p.list("ordine")
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|r| set.contains(&r.id))
                        .filter(|r| str_field(&r.data, "data_prevista_lotto").is_empty())
                        .map(|r| r.id)
                        .collect()
                });
                for id in &ids {
                    set_fields(
                        engine,
                        "ordine",
                        id,
                        &[("data_prevista_lotto", json!(data_prevista))],
                    )?;
                }
            }

            // Numero massimo già assegnato (globale) → punto di partenza del contatore.
            let mut prossimo = engine.with_projection(|p| {
                p.list("riga_ordine")
                    .unwrap_or_default()
                    .iter()
                    .map(|r| i64_field(&r.data, "numero_produzione"))
                    .max()
                    .unwrap_or(0)
                    .max(base - 1)
            });

            // Ordini Immunoterapia del lotto (esclusa Diagnostica/Keriba), ordinati per
            // data invio poi creazione (sequenza stabile della numerazione).
            let (agenti, medici, totali, transito) = engine.with_projection(|p| {
                (
                    nome_map(p, "agente"),
                    nome_map(p, "medico"),
                    totali_ordini(p),
                    conti_transito(p),
                )
            });
            let pagamenti = engine.with_projection(|p| pagamenti_per_ordine(p, &transito));

            let mut ordini = engine.with_projection(|p| {
                let set = ord_del_lotto(p);
                let mut v: Vec<_> = p
                    .list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| set.contains(&r.id))
                    .filter(|r| {
                        let c = str_field(&r.data, "categoria");
                        c != "Diagnostica" && c != "Keriba"
                    })
                    .collect();
                v.sort_by(|a, b| {
                    str_field(&a.data, "data_produzione")
                        .cmp(&str_field(&b.data, "data_produzione"))
                        .then(a.created_hlc.cmp(&b.created_hlc))
                });
                v
            });

            let mut out: Vec<crate::export::RigaLaboratorio> = Vec::new();
            for o in ordini.drain(..) {
                let agente = agenti
                    .get(&str_field(&o.data, "agente_id"))
                    .cloned()
                    .unwrap_or_default();
                let medico = medici
                    .get(&str_field(&o.data, "medico_id"))
                    .cloned()
                    .unwrap_or_default();
                let agg = pagamenti.get(&o.id);
                // Col C = acconto: saldato se incassato, altrimenti previsto.
                let acconto_cent = match agg {
                    Some(a) if a.acconto_incassato => a.acconto_saldato,
                    _ => i64_field(&o.data, "acconto"),
                };
                let valore_cent = *totali.get(&o.id).unwrap_or(&0);
                let data_invio = data_it_punti(&str_field(&o.data, "data_produzione"));
                // Fallback legacy dell'ordine per la col J; la riga resta la fonte puntuale e il
                // parametro è l'ultimo fallback.
                let data_prev_ordine = str_field(&o.data, "data_prevista_lotto");

                // SOLO le righe dell'ordine appartenenti a QUESTO lotto (FASE 7: invio parziale),
                // in ordine di creazione.
                let mut righe_ord = engine.with_projection(|p| {
                    let mut v: Vec<_> = p
                        .list("riga_ordine")
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|r| {
                            str_field(&r.data, "ordine_id") == o.id
                                && str_field(&r.data, "lotto_produzione") == lotto
                        })
                        .collect();
                    v.sort_by(|a, b| a.created_hlc.cmp(&b.created_hlc));
                    v
                });

                for (idx, riga) in righe_ord.drain(..).enumerate() {
                    // Numero di produzione: riusa quello già assegnato, altrimenti il prossimo.
                    let mut numero = i64_field(&riga.data, "numero_produzione");
                    if numero <= 0 {
                        prossimo += 1;
                        numero = prossimo;
                        set_fields(
                            engine,
                            "riga_ordine",
                            &riga.id,
                            &[("numero_produzione", json!(numero))],
                        )?;
                    }
                    let allergeni: Vec<String> = riga
                        .data
                        .get("allergeni")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();
                    let data_prev_riga = str_field(&riga.data, "data_prevista");
                    let data_prev = if !data_prev_riga.is_empty() {
                        data_prev_riga
                    } else if !data_prev_ordine.is_empty() {
                        data_prev_ordine.clone()
                    } else {
                        data_prevista.to_string()
                    };
                    out.push(crate::export::RigaLaboratorio {
                        // Acconto/valore solo sulla PRIMA riga dell'ordine (no doppio conteggio).
                        acconto: (idx == 0 && acconto_cent != 0)
                            .then(|| acconto_cent as f64 / 100.0),
                        numero_produzione: numero,
                        data_invio: data_invio.clone(),
                        agente: agente.clone(),
                        medico: medico.clone(),
                        paziente: str_field(&riga.data, "paziente"),
                        valore: (idx == 0 && valore_cent != 0).then(|| valore_cent as f64 / 100.0),
                        data_prevista: data_prev,
                        formulazione: str_field(&riga.data, "formulazione"),
                        posologia: str_field(&riga.data, "posologia"),
                        allergeni,
                    });
                }
            }
            Ok(out)
        })?;

        crate::export::fornitore_xlsx(Path::new(path), &righe)?;
        Ok(righe.len())
    }

    /// **Export Diagnostica** di un lotto (FASE 5D): un file `.xlsx` con **un blocco per
    /// ordine** (intestazione n°/cliente + righe allergene/tipo test/ml/quantità/valore).
    /// Il "cliente" della Diagnostica = medico se presente, altrimenti cliente/ospedale.
    pub fn diagnostica_export(&self, lotto: &str, path: &str) -> AppResult<usize> {
        if lotto.is_empty() {
            return Err("lotto non valido".into());
        }
        let ordini = self.with_engine(|engine| {
            let (medici, clienti, prodotti, numeri) = engine.with_projection(|p| {
                (
                    nome_map(p, "medico"),
                    nome_map(p, "cliente"),
                    nome_map(p, "prodotto"),
                    numeri_ordini(p),
                )
            });
            // Il lotto vive sulle RIGHE (FASE 7): ordini con almeno una riga Diagnostica nel lotto.
            let ord_del_lotto: std::collections::HashSet<String> = engine.with_projection(|p| {
                p.list("riga_ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "lotto_produzione") == lotto)
                    .map(|r| str_field(&r.data, "ordine_id"))
                    .filter(|s| !s.is_empty())
                    .collect()
            });
            let mut testate = engine.with_projection(|p| {
                let mut v: Vec<_> = p
                    .list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| ord_del_lotto.contains(&r.id))
                    .filter(|r| str_field(&r.data, "categoria") == "Diagnostica")
                    .collect();
                v.sort_by(|a, b| a.created_hlc.cmp(&b.created_hlc));
                v
            });

            let mut out: Vec<crate::export::OrdineDiagnostica> = Vec::new();
            for o in testate.drain(..) {
                let medico = medici
                    .get(&str_field(&o.data, "medico_id"))
                    .cloned()
                    .unwrap_or_default();
                let cliente = if !medico.is_empty() {
                    medico
                } else {
                    clienti
                        .get(&str_field(&o.data, "cliente_id"))
                        .cloned()
                        .unwrap_or_default()
                };
                let mut righe_ord = engine.with_projection(|p| {
                    let mut v: Vec<_> = p
                        .list("riga_ordine")
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|r| {
                            str_field(&r.data, "ordine_id") == o.id
                                && str_field(&r.data, "lotto_produzione") == lotto
                        })
                        .collect();
                    v.sort_by(|a, b| a.created_hlc.cmp(&b.created_hlc));
                    v
                });
                let righe = righe_ord
                    .drain(..)
                    .map(|r| {
                        let prezzo = i64_field(&r.data, "prezzo");
                        crate::export::RigaDiagnostica {
                            allergene: nome_riga_prodotto(
                                &prodotti,
                                &str_field(&r.data, "prodotto_id"),
                                &r.data,
                            ),
                            tipo_test: str_field(&r.data, "tipo_test"),
                            ml: str_field(&r.data, "ml"),
                            qta: i64_field(&r.data, "qta"),
                            valore: (prezzo != 0).then(|| prezzo as f64 / 100.0),
                            codice: str_field(&r.data, "codice_fornitore"),
                        }
                    })
                    .collect();
                out.push(crate::export::OrdineDiagnostica {
                    numero: numeri.get(&o.id).cloned().unwrap_or_default(),
                    data: data_it_punti(&str_field(&o.data, "data")),
                    cliente,
                    righe,
                });
            }
            Ok(out)
        })?;

        crate::export::diagnostica_xlsx(Path::new(path), &ordini)?;
        Ok(ordini.len())
    }
}
