use super::*;

fn figli_ordine_da_purgare(
    projection: &crate::projection::Projection,
    ordine_id: &str,
) -> Vec<(String, String)> {
    let mut result = Vec::new();
    for entity in [
        "riga_ordine",
        "pagamento",
        "rimborso",
        "promemoria",
        "preventivo",
        "scheda_cliente",
    ] {
        result.extend(
            projection
                .list(entity)
                .unwrap_or_default()
                .into_iter()
                .chain(projection.list_deleted(entity).unwrap_or_default())
                .filter(|record| str_field(&record.data, "ordine_id") == ordine_id)
                .map(|record| (entity.to_string(), record.id)),
        );
    }
    result
}

impl AppState {
    /// Soft-delete (Cestino) di un record. I pagamenti fanno eccezione: sono
    /// componenti dello scadenzario e vengono eliminati definitivamente.
    pub fn record_delete(&self, entity: &str, id: &str) -> AppResult<()> {
        crate::premium::ensure_generic_entity_access(self, entity)?;
        self.with_engine(|engine| {
            let ordine_id_riallinea = if entity == "pagamento" {
                engine.with_projection(|p| {
                    p.get("pagamento", id)
                        .ok()
                        .flatten()
                        .map(|r| str_field(&r.data, "ordine_id"))
                })
            } else {
                None
            };
            let entity_owned = entity.to_string();
            let id_owned = id.to_string();
            engine
                .emit_built_checked(move |projection| {
                    let corrente = projection
                        .get(&entity_owned, &id_owned)
                        .map_err(|error| error.to_string())?
                        .ok_or_else(|| "record non trovato o già eliminato".to_string())?;
                    if corrente.deleted {
                        return Err("il record è già stato eliminato".into());
                    }
                    if entity_owned == "pagamento"
                        && !str_field(&corrente.data, "distinta_id").is_empty()
                    {
                        return Err(
                            "il pagamento è già incluso in una distinta e non può essere annullato"
                                .into(),
                        );
                    }
                    let evento = if entity_owned == "pagamento" {
                        EventBody::Purged
                    } else {
                        EventBody::Deleted
                    };
                    let mut mutations = vec![Mutation::new(
                        entity_owned.clone(),
                        id_owned.clone(),
                        evento,
                    )];
                    if entity_owned == "pagamento"
                        && str_field(&corrente.data, "tipo").eq_ignore_ascii_case("acconto")
                    {
                        let ordine_id = str_field(&corrente.data, "ordine_id");
                        let ha_altri_incassi = !ordine_id.is_empty()
                            && projection
                                .list("pagamento")
                                .unwrap_or_default()
                                .into_iter()
                                .any(|pagamento| {
                                    pagamento.id != corrente.id
                                        && str_field(&pagamento.data, "ordine_id") == ordine_id
                                        && bool_field(&pagamento.data, "saldato")
                                });
                        if !ha_altri_incassi {
                            if let Some(ordine) = projection
                                .get("ordine", &ordine_id)
                                .map_err(|error| error.to_string())?
                                .filter(|ordine| !ordine.deleted)
                            {
                                // Solo un ordine ancora semplicemente confermato può
                                // tornare Nuovo. Produzione e spedizione impostano stati
                                // successivi, che non devono mai essere retrocessi
                                // eliminando un pagamento.
                                if str_field(&ordine.data, "stato") == "Confermato" {
                                    mutations.push(Mutation::new(
                                        "ordine",
                                        ordine.id,
                                        EventBody::FieldSet {
                                            field: "stato".into(),
                                            value: json!("Nuovo"),
                                        },
                                    ));
                                }
                            }
                        }
                    }
                    if entity_owned == "ordine" {
                        // Il preventivo è un documento figlio dell'ordine: eliminando
                        // l'ordine sparisce insieme a lui, ma conserva un marcatore che
                        // consente al ripristino di ricostruire la cascata esatta.
                        for preventivo in projection
                            .list("preventivo")
                            .unwrap_or_default()
                            .into_iter()
                            .filter(|record| str_field(&record.data, "ordine_id") == id_owned)
                        {
                            mutations.push(Mutation::new(
                                "preventivo",
                                preventivo.id.clone(),
                                EventBody::FieldSet {
                                    field: "eliminato_con_ordine".into(),
                                    value: json!(true),
                                },
                            ));
                            mutations.push(Mutation::new(
                                "preventivo",
                                preventivo.id,
                                EventBody::Deleted,
                            ));
                        }
                    }
                    Ok(mutations)
                })
                .map_err(es)?;
            if let Some(oid) = ordine_id_riallinea.filter(|s| !s.is_empty()) {
                super::riallinea_contrassegno_spedizioni_ordine(engine, &oid)?;
            }
            Ok(())
        })
    }

    /// Ripristina un record dal Cestino (de-annulla il soft-delete). Per un ordine torna
    /// **com'era**, incluso lo stato `Rifiutato` se lo era: srifiutare è un'azione separata
    /// dal Giornaliero (`ordine_ripristina`), il Cestino tratta solo l'annullamento.
    pub fn record_restore(&self, entity: &str, id: &str) -> AppResult<()> {
        crate::premium::ensure_generic_entity_access(self, entity)?;
        self.with_engine(|engine| {
            let entity = entity.to_string();
            let id = id.to_string();
            engine
                .emit_built_checked(move |projection| {
                    let corrente = projection
                        .get(&entity, &id)
                        .map_err(|error| error.to_string())?
                        .filter(|record| record.deleted)
                        .ok_or_else(|| "record non trovato nel Cestino".to_string())?;
                    if entity == "ordine"
                        && bool_field(&corrente.data, "supporto_preventivo_eliminato")
                    {
                        return Err(
                            "questo ordine è stato eliminato definitivamente dal Giornaliero"
                                .into(),
                        );
                    }
                    let mut mutations = vec![Mutation::new(
                        entity.clone(),
                        id.clone(),
                        EventBody::Restored,
                    )];
                    if entity == "ordine" {
                        for preventivo in projection
                            .list_deleted("preventivo")
                            .unwrap_or_default()
                            .into_iter()
                            .filter(|record| {
                                str_field(&record.data, "ordine_id") == corrente.id
                                    && bool_field(&record.data, "eliminato_con_ordine")
                            })
                        {
                            mutations.push(Mutation::new(
                                "preventivo",
                                preventivo.id.clone(),
                                EventBody::Restored,
                            ));
                            mutations.push(Mutation::new(
                                "preventivo",
                                preventivo.id,
                                EventBody::FieldSet {
                                    field: "eliminato_con_ordine".into(),
                                    value: json!(false),
                                },
                            ));
                        }
                    }
                    Ok(mutations)
                })
                .map_err(es)?;
            Ok(())
        })
    }

    /// Ripristina un ordine **rifiutato** riportandolo attivo (dal Giornaliero, senza passare
    /// dal Cestino): stato **Confermato** se ha almeno un incasso saldato (acconto), altrimenti
    /// **Nuovo**; pulisce i campi del rifiuto. No-op se l'ordine non è `Rifiutato`. Ritorna il
    /// nuovo stato.
    pub fn ordine_ripristina(&self, id: &str) -> AppResult<String> {
        self.with_engine(|engine| {
            let stato = engine
                .with_projection(|p| {
                    p.get("ordine", id)
                        .ok()
                        .flatten()
                        .map(|r| str_field(&r.data, "stato"))
                })
                .unwrap_or_default();
            if stato != "Rifiutato" {
                return Ok(stato);
            }
            let ha_incasso = engine.with_projection(|p| {
                p.list("pagamento").unwrap_or_default().iter().any(|r| {
                    str_field(&r.data, "ordine_id") == id && bool_field(&r.data, "saldato")
                })
            });
            let nuovo = if ha_incasso { "Confermato" } else { "Nuovo" };
            set_fields(
                engine,
                "ordine",
                id,
                &[
                    ("stato", json!(nuovo)),
                    ("motivo_rifiuto", json!("")),
                    ("data_rifiuto", json!("")),
                    ("stato_pre_rifiuto", json!("")),
                ],
            )?;
            Ok(nuovo.to_string())
        })
    }

    /// Elenco del Cestino: record soft-deleted di tutte le entità utente.
    pub fn cestino(&self) -> AppResult<Vec<CestinoDto>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let mut out = Vec::new();
                let numeri = numeri_ordini(p);
                for ent in ENTITA_UTENTE {
                    // Le rate sono componenti tecniche dello scadenzario e vengono
                    // eliminate definitivamente. Nascondiamo anche eventuali
                    // soft-delete creati da versioni precedenti dell'app.
                    if ent == "pagamento" {
                        continue;
                    }
                    for r in p.list_deleted(ent).unwrap_or_default() {
                        if ent == "ordine" && bool_field(&r.data, "supporto_preventivo_eliminato") {
                            continue;
                        }
                        // Un preventivo eliminato insieme al suo ordine è presentato
                        // come parte di quell'unica voce: ripristina/elimina dell'ordine
                        // applicano la stessa cascata, senza doppioni nel Cestino.
                        if ent == "preventivo" && bool_field(&r.data, "eliminato_con_ordine") {
                            continue;
                        }
                        let mut data = r.data;
                        if ent == "preventivo" {
                            let ordine_id = str_field(&data, "ordine_id");
                            if let Some(numero_ordine) = numeri.get(&ordine_id) {
                                data.insert("ordine_numero".into(), json!(numero_ordine));
                                data.insert(
                                    "numero_preventivo".into(),
                                    json!(format!("P-{numero_ordine}")),
                                );
                            }
                        }
                        out.push(CestinoDto {
                            entity: ent.to_string(),
                            deleted_ms: r.updated_hlc.wall,
                            id: r.id,
                            data,
                        });
                    }
                }
                out
            }))
        })
    }

    /// Elimina **definitivamente** un record dal Cestino (non più ripristinabile).
    pub fn record_purge(&self, entity: &str, id: &str) -> AppResult<()> {
        crate::premium::ensure_generic_entity_access(self, entity)?;
        self.with_engine(|engine| {
            let entity = entity.to_string();
            let id = id.to_string();
            engine
                .emit_built_checked(move |projection| {
                    if entity == "ordine" {
                        if let Some(ordine) = projection.get("ordine", &id).map_err(es)? {
                            if bool_field(&ordine.data, "supporto_preventivo_eliminato")
                                && projection
                                    .list("preventivo")
                                    .unwrap_or_default()
                                    .iter()
                                    .any(|preventivo| {
                                        str_field(&preventivo.data, "ordine_id") == id
                                    })
                            {
                                return Err(
                                    "l’ordine è il supporto interno di un preventivo attivo".into(),
                                );
                            }
                        }
                    }
                    let mut mutations =
                        vec![Mutation::new(entity.clone(), id.clone(), EventBody::Purged)];
                    if entity == "ordine" {
                        mutations.extend(figli_ordine_da_purgare(projection, &id).into_iter().map(
                            |(figlio_entity, figlio_id)| {
                                Mutation::new(figlio_entity, figlio_id, EventBody::Purged)
                            },
                        ));
                    }
                    Ok(mutations)
                })
                .map_err(es)?;
            purga_notifiche_letta_orfane(engine)?;
            Ok(())
        })
    }

    /// Svuota il Cestino: elimina definitivamente tutti i record soft-deleted.
    pub fn cestino_svuota(&self) -> AppResult<()> {
        self.with_engine(|engine| {
            let da_purgare: Vec<(String, String)> = engine.with_projection(|p| {
                let mut v = BTreeSet::new();
                for ent in ENTITA_UTENTE {
                    for r in p.list_deleted(ent).unwrap_or_default() {
                        if ent == "ordine"
                            && bool_field(&r.data, "supporto_preventivo_eliminato")
                            && p.list("preventivo")
                                .unwrap_or_default()
                                .iter()
                                .any(|preventivo| str_field(&preventivo.data, "ordine_id") == r.id)
                        {
                            continue;
                        }
                        v.insert((ent.to_string(), r.id));
                    }
                }
                let ordini = v
                    .iter()
                    .filter(|(entity, _)| entity == "ordine")
                    .map(|(_, id)| id.clone())
                    .collect::<Vec<_>>();
                for ordine_id in ordini {
                    v.extend(figli_ordine_da_purgare(p, &ordine_id));
                }
                v.into_iter().collect()
            });
            for (ent, id) in da_purgare {
                engine.emit(&ent, &id, EventBody::Purged).map_err(es)?;
            }
            purga_notifiche_letta_orfane(engine)?;
            Ok(())
        })
    }

    /// Pulizia automatica del Cestino: elimina definitivamente i record eliminati da
    /// più di `giorni` giorni. `giorni == 0` non fa nulla. Restituisce quanti purgati.
    pub fn cestino_pulisci(&self, giorni: u64) -> AppResult<usize> {
        if giorni == 0 {
            return Ok(0);
        }
        let soglia_ms = crate::sync::hlc::HlcClock::now_ms().saturating_sub(giorni * 86_400_000);
        self.with_engine(|engine| {
            let vecchi: Vec<(String, String)> = engine.with_projection(|p| {
                let mut v = BTreeSet::new();
                for ent in ENTITA_UTENTE {
                    for r in p.list_deleted(ent).unwrap_or_default() {
                        if ent == "ordine"
                            && bool_field(&r.data, "supporto_preventivo_eliminato")
                            && p.list("preventivo")
                                .unwrap_or_default()
                                .iter()
                                .any(|preventivo| str_field(&preventivo.data, "ordine_id") == r.id)
                        {
                            continue;
                        }
                        if r.updated_hlc.wall < soglia_ms {
                            v.insert((ent.to_string(), r.id));
                        }
                    }
                }
                let ordini = v
                    .iter()
                    .filter(|(entity, _)| entity == "ordine")
                    .map(|(_, id)| id.clone())
                    .collect::<Vec<_>>();
                for ordine_id in ordini {
                    v.extend(figli_ordine_da_purgare(p, &ordine_id));
                }
                v.into_iter().collect()
            });
            let n = vecchi.len();
            for (ent, id) in vecchi {
                engine.emit(&ent, &id, EventBody::Purged).map_err(es)?;
            }
            purga_notifiche_letta_orfane(engine)?;
            Ok(n)
        })
    }

    /// Anteprima della pulizia definitiva: calcola i record candidati e gli eventuali blocchi,
    /// senza scrivere nulla. La stessa funzione di piano viene riusata dall'esecuzione.
    pub fn pulizia_dati_anteprima(&self, args: PuliziaDatiArgs) -> AppResult<PuliziaPreviewDto> {
        self.with_engine(|engine| {
            Ok(engine
                .with_projection(|p| calcola_pulizia_plan(p, &args))
                .to_preview())
        })
    }

    /// Esegue la pulizia definitiva solo dopo backup obbligatorio e conferma testuale.
    pub fn pulizia_dati_esegui(
        &self,
        args: PuliziaDatiArgs,
        conferma: &str,
    ) -> AppResult<PuliziaResultDto> {
        self.force_sync()?;
        self.acquisisci_lock("pulizia_dati")?;

        let result = (|| {
            let cfg = self.config();
            let data_dir = cfg.data_dir.clone().ok_or("cartella dati non impostata")?;
            let current_device = cfg.device_id.clone();
            let data_path = Path::new(&data_dir);

            let prima = self.pulizia_dati_anteprima(args.clone())?;
            if !prima.blocchi.is_empty() {
                return Err("pulizia bloccata: risolvi prima i collegamenti segnalati".into());
            }
            if conferma.trim() != prima.conferma {
                return Err(format!("conferma non valida: scrivi {}", prima.conferma));
            }

            let backup = self.backup_now_internal(None, None, None::<fn(u8, &str)>, false)?;
            self.force_sync()?;

            let plan = self.with_engine(|engine| {
                Ok(engine.with_projection(|p| calcola_pulizia_plan(p, &args)))
            })?;
            let preview = plan.to_preview();
            if !preview.blocchi.is_empty() {
                return Err("pulizia bloccata dopo il ricalcolo: i dati sono cambiati".into());
            }
            if conferma.trim() != preview.conferma {
                return Err(format!(
                    "i dati sono cambiati dopo il backup: riapri l'anteprima e conferma con {}",
                    preview.conferma
                ));
            }

            let da_purgare: Vec<(String, String)> = plan.da_purgare.into_iter().collect();
            let notifiche_ripulite = da_purgare
                .iter()
                .filter(|(entity, _)| entity == "notifica_letta")
                .count();
            self.with_engine(|engine| {
                for (entity, id) in &da_purgare {
                    engine.emit(entity, id, EventBody::Purged).map_err(es)?;
                }
                Ok(())
            })?;

            let compattazione = self.with_engine(|engine| {
                compatta_store_dopo_pulizia(engine, data_path, &current_device)
            })?;
            if compattazione.compattato {
                scrivi_restore_marker(data_path, &current_device, None)?;
                self.ricostruisci_proiezione_locale()?;
            }

            Ok(PuliziaResultDto {
                purgati: da_purgare.len(),
                conteggi: preview.conteggi,
                notifiche_ripulite,
                tombstone_rimosse: compattazione.tombstone_rimosse,
                eventi_rimossi: compattazione.eventi_rimossi,
                compattato: compattazione.compattato,
                backup,
            })
        })();

        let _ = self.rilascia_lock();
        result
    }

    /// Storico di un record (chi/cosa/quando), ricostruito dagli eventi.
    pub fn record_storico(&self, entity: &str, id: &str) -> AppResult<Vec<StoricoDto>> {
        crate::premium::ensure_generic_entity_access(self, entity)?;
        self.with_engine(|engine| {
            let eventi = engine.storia(entity, id).map_err(es)?;
            Ok(eventi
                .into_iter()
                .map(|ev| {
                    let crate::sync::event::Event {
                        ts,
                        user,
                        device,
                        body,
                        ..
                    } = ev;
                    let (op, field, value) = match body {
                        EventBody::Created => ("created", None, None),
                        EventBody::FieldSet { field, value } => {
                            ("field_set", Some(field), Some(value))
                        }
                        EventBody::Deleted => ("deleted", None, None),
                        EventBody::Restored => ("restored", None, None),
                        EventBody::Purged => ("purged", None, None),
                    };
                    StoricoDto {
                        ms: ts.wall,
                        user,
                        device,
                        op: op.to_string(),
                        field,
                        value,
                    }
                })
                .collect())
        })
    }
}

#[derive(Clone)]
struct PuliziaRange {
    dal: String,
    al: String,
    valido: bool,
}

#[derive(Default)]
struct PuliziaPlan {
    modalita: String,
    preset: String,
    dal: String,
    al: String,
    descrizione: String,
    da_purgare: BTreeSet<(String, String)>,
    blocchi: Vec<PuliziaBloccoDto>,
}

impl PuliziaPlan {
    fn add(&mut self, entity: &str, id: &str) {
        if !entity.is_empty() && !id.is_empty() {
            self.da_purgare.insert((entity.to_string(), id.to_string()));
        }
    }

    fn blocca(&mut self, titolo: impl Into<String>, dettaglio: impl Into<String>) {
        let titolo = titolo.into();
        let dettaglio = dettaglio.into();
        if self
            .blocchi
            .iter()
            .any(|b| b.titolo == titolo && b.dettaglio == dettaglio)
        {
            return;
        }
        self.blocchi.push(PuliziaBloccoDto { titolo, dettaglio });
    }

    fn to_preview(&self) -> PuliziaPreviewDto {
        let mut conteggi: BTreeMap<String, usize> = BTreeMap::new();
        for (entity, _) in &self.da_purgare {
            *conteggi.entry(entity.clone()).or_insert(0) += 1;
        }
        let totale_record = self.da_purgare.len();
        PuliziaPreviewDto {
            modalita: self.modalita.clone(),
            preset: self.preset.clone(),
            dal: self.dal.clone(),
            al: self.al.clone(),
            descrizione: self.descrizione.clone(),
            conferma: format!("ELIMINA {totale_record} RECORD"),
            totale_record,
            conteggi,
            blocchi: self.blocchi.clone(),
        }
    }
}

#[derive(Default)]
pub(super) struct PuliziaCompattazioneStats {
    tombstone_rimosse: usize,
    eventi_rimossi: usize,
    pub(super) compattato: bool,
}

fn calcola_pulizia_plan(p: &crate::projection::Projection, args: &PuliziaDatiArgs) -> PuliziaPlan {
    let range = pulizia_range(args);
    let mut plan = PuliziaPlan {
        modalita: args.modalita.clone(),
        preset: args.preset.clone(),
        dal: range.dal.clone(),
        al: range.al.clone(),
        descrizione: descrizione_pulizia(&args.modalita, &range),
        ..Default::default()
    };
    if !range.valido {
        plan.blocca(
            "Periodo non valido",
            "Controlla le date: la data iniziale deve precedere quella finale.",
        );
        return plan;
    }

    let ordini = p.list("ordine").unwrap_or_default();
    let righe = p.list("riga_ordine").unwrap_or_default();
    let pagamenti = p.list("pagamento").unwrap_or_default();
    let rimborsi = p.list("rimborso").unwrap_or_default();
    let spedizioni = p.list("spedizione").unwrap_or_default();
    let distinte = p.list("distinta").unwrap_or_default();
    let clienti = p.list("cliente").unwrap_or_default();
    let promemoria = p.list("promemoria").unwrap_or_default();

    let mut righe_by_ordine: HashMap<String, Vec<crate::projection::Record>> = HashMap::new();
    let mut ordine_by_riga: HashMap<String, String> = HashMap::new();
    let mut sped_righe: HashMap<String, Vec<String>> = HashMap::new();
    for r in &righe {
        let oid = str_field(&r.data, "ordine_id");
        if !oid.is_empty() {
            righe_by_ordine
                .entry(oid.clone())
                .or_default()
                .push(r.clone());
            ordine_by_riga.insert(r.id.clone(), oid);
        }
        let sid = str_field(&r.data, "spedizione_id");
        if !sid.is_empty() {
            sped_righe.entry(sid).or_default().push(r.id.clone());
        }
    }

    let mut pag_by_ordine: HashMap<String, Vec<crate::projection::Record>> = HashMap::new();
    let mut pag_by_distinta: HashMap<String, Vec<crate::projection::Record>> = HashMap::new();
    for pag in &pagamenti {
        let oid = str_field(&pag.data, "ordine_id");
        if !oid.is_empty() {
            pag_by_ordine.entry(oid).or_default().push(pag.clone());
        }
        let did = str_field(&pag.data, "distinta_id");
        if !did.is_empty() {
            pag_by_distinta.entry(did).or_default().push(pag.clone());
        }
    }

    let mut rim_by_ordine: HashMap<String, Vec<crate::projection::Record>> = HashMap::new();
    for rim in &rimborsi {
        let oid = str_field(&rim.data, "ordine_id");
        if !oid.is_empty() {
            rim_by_ordine.entry(oid).or_default().push(rim.clone());
        }
    }

    let mut prom_by_ordine: HashMap<String, Vec<crate::projection::Record>> = HashMap::new();
    let mut prom_by_cliente: HashMap<String, Vec<crate::projection::Record>> = HashMap::new();
    for prom in &promemoria {
        let tipo = str_field(&prom.data, "collegato_tipo");
        let id = str_field(&prom.data, "collegato_id");
        match tipo.as_str() {
            "ordine" if !id.is_empty() => prom_by_ordine.entry(id).or_default().push(prom.clone()),
            "cliente" if !id.is_empty() => {
                prom_by_cliente.entry(id).or_default().push(prom.clone())
            }
            _ => {}
        }
    }

    let mut ordini_by_cliente: HashMap<String, Vec<crate::projection::Record>> = HashMap::new();
    for ordine in &ordini {
        let cid = str_field(&ordine.data, "cliente_id");
        if !cid.is_empty() {
            ordini_by_cliente
                .entry(cid)
                .or_default()
                .push(ordine.clone());
        }
    }

    let mut selected_orders: BTreeSet<String> = BTreeSet::new();
    match args.modalita.as_str() {
        "inutili" => {
            for ordine in &ordini {
                if data_in_range(&str_field(&ordine.data, "data"), &range)
                    && ordine_inutile(
                        ordine,
                        righe_by_ordine
                            .get(&ordine.id)
                            .map(Vec::as_slice)
                            .unwrap_or(&[]),
                        pag_by_ordine
                            .get(&ordine.id)
                            .map(Vec::as_slice)
                            .unwrap_or(&[]),
                        rim_by_ordine
                            .get(&ordine.id)
                            .map(Vec::as_slice)
                            .unwrap_or(&[]),
                    )
                {
                    selected_orders.insert(ordine.id.clone());
                }
            }
        }
        "clienti_morti" => {
            for cliente in &clienti {
                let linked = ordini_by_cliente
                    .get(&cliente.id)
                    .cloned()
                    .unwrap_or_default();
                if linked.is_empty() {
                    if data_in_range(&data_record(&cliente.created_hlc), &range) {
                        plan.add("cliente", &cliente.id);
                        if let Some(proms) = prom_by_cliente.get(&cliente.id) {
                            for prom in proms {
                                plan.add("promemoria", &prom.id);
                            }
                        }
                    }
                    continue;
                }
                let ha_reali = linked.iter().any(|ordine| {
                    ordine_reale(
                        ordine,
                        righe_by_ordine
                            .get(&ordine.id)
                            .map(Vec::as_slice)
                            .unwrap_or(&[]),
                        pag_by_ordine
                            .get(&ordine.id)
                            .map(Vec::as_slice)
                            .unwrap_or(&[]),
                    )
                });
                if ha_reali {
                    continue;
                }
                let tutti_inutili_nel_range = linked.iter().all(|ordine| {
                    data_in_range(&str_field(&ordine.data, "data"), &range)
                        && ordine_inutile(
                            ordine,
                            righe_by_ordine
                                .get(&ordine.id)
                                .map(Vec::as_slice)
                                .unwrap_or(&[]),
                            pag_by_ordine
                                .get(&ordine.id)
                                .map(Vec::as_slice)
                                .unwrap_or(&[]),
                            rim_by_ordine
                                .get(&ordine.id)
                                .map(Vec::as_slice)
                                .unwrap_or(&[]),
                        )
                });
                if tutti_inutili_nel_range {
                    for ordine in linked {
                        selected_orders.insert(ordine.id);
                    }
                    plan.add("cliente", &cliente.id);
                    if let Some(proms) = prom_by_cliente.get(&cliente.id) {
                        for prom in proms {
                            plan.add("promemoria", &prom.id);
                        }
                    }
                }
            }
        }
        "movimenti_periodo" => {
            for ordine in &ordini {
                if data_in_range(&str_field(&ordine.data, "data"), &range) {
                    selected_orders.insert(ordine.id.clone());
                }
            }
        }
        _ => {
            plan.blocca(
                "Modalità non valida",
                "La modalità richiesta non è riconosciuta.",
            );
            return plan;
        }
    }

    for oid in &selected_orders {
        aggiungi_cascata_ordine(
            &mut plan,
            oid,
            &righe_by_ordine,
            &pag_by_ordine,
            &rim_by_ordine,
            &prom_by_ordine,
            args.modalita == "movimenti_periodo",
        );
    }

    if args.modalita == "movimenti_periodo" {
        for cliente in &clienti {
            if plan
                .da_purgare
                .contains(&("cliente".to_string(), cliente.id.clone()))
            {
                continue;
            }
            let linked = ordini_by_cliente
                .get(&cliente.id)
                .cloned()
                .unwrap_or_default();
            let aveva_ordine_selezionato = linked.iter().any(|o| selected_orders.contains(&o.id));
            let nessun_ordine_fuori = linked.iter().all(|o| selected_orders.contains(&o.id));
            if nessun_ordine_fuori
                && (aveva_ordine_selezionato
                    || data_in_range(&data_record(&cliente.created_hlc), &range))
            {
                plan.add("cliente", &cliente.id);
                if let Some(proms) = prom_by_cliente.get(&cliente.id) {
                    for prom in proms {
                        plan.add("promemoria", &prom.id);
                    }
                }
            }
        }
    }

    valida_collegamenti_periodo(
        &mut plan,
        &selected_orders,
        &ordine_by_riga,
        &sped_righe,
        &spedizioni,
        &pag_by_distinta,
        &distinte,
    );
    aggiungi_notifiche_letta_orfane(p, &mut plan);
    plan
}

fn aggiungi_notifiche_letta_orfane(p: &crate::projection::Projection, plan: &mut PuliziaPlan) {
    for r in p.list("notifica_letta").unwrap_or_default() {
        let id = str_field(&r.data, "notifica_id");
        // La pulizia esplicita avviene sotto lock e dopo force-sync: qui l'assenza
        // effettiva del target è sufficiente per ripulire anche vecchi orfani.
        if notifica_letta_orfana(p, &plan.da_purgare, &id, true) {
            plan.add("notifica_letta", &r.id);
        }
    }
}

fn purga_notifiche_letta_orfane(engine: &Engine) -> AppResult<usize> {
    let ids = engine.with_projection(|p| {
        p.list("notifica_letta")
            .unwrap_or_default()
            .into_iter()
            .filter(|r| {
                let id = str_field(&r.data, "notifica_id");
                // Durante una normale sync i file del read-state e del messaggio
                // possono arrivare in ordine diverso. L'assenza temporanea non deve
                // produrre una tombstone irreversibile: serve la purge del target.
                notifica_letta_orfana(p, &BTreeSet::new(), &id, false)
            })
            .map(|r| r.id)
            .collect::<Vec<_>>()
    });
    let n = ids.len();
    for id in ids {
        engine
            .emit("notifica_letta", &id, EventBody::Purged)
            .map_err(es)?;
    }
    Ok(n)
}

pub(super) fn manutenzione_retention_notifiche(
    engine: &Engine,
    data_dir: &Path,
    device_id: &str,
) -> AppResult<PuliziaCompattazioneStats> {
    engine.ingest().map_err(es)?;
    let cutoff = now_ms().saturating_sub(RETENZIONE_MESSAGGI_MS);
    let cutoff_suggerimenti = now_ms().saturating_sub(RETENZIONE_SUGGERIMENTI_IGNORATI_MS);
    let da_purgare = engine.with_projection(|p| {
        let mut plan = BTreeSet::<(String, String)>::new();
        for r in p.list("notifica").unwrap_or_default() {
            let ts = r.data.get("ts").and_then(|v| v.as_u64()).unwrap_or(0);
            if r.id.starts_with("msg:") && ts > 0 && ts < cutoff {
                plan.insert(("notifica".to_string(), r.id));
            }
        }
        for r in p.list("notifica_letta").unwrap_or_default() {
            let id = str_field(&r.data, "notifica_id");
            if id.starts_with("s14:") {
                let ts = r.data.get("ts").and_then(|v| v.as_u64()).unwrap_or(0);
                if ts > 0 && ts < cutoff {
                    plan.insert(("notifica_letta".to_string(), r.id));
                }
                continue;
            }
            if notifica_letta_orfana(p, &plan, &id, false) {
                plan.insert(("notifica_letta".to_string(), r.id));
            }
        }
        // Le card sono derivate e il loro id cambia insieme ai dati sorgente.
        // Dopo sei mesi il vecchio marker non puo' piu' occultare indefinitamente
        // una fotografia storica e non deve gonfiare la proiezione condivisa.
        for r in p.list("suggerimento_stato").unwrap_or_default() {
            let ts = r.data.get("ts").and_then(|v| v.as_u64()).unwrap_or(0);
            if ts > 0 && ts < cutoff_suggerimenti {
                plan.insert(("suggerimento_stato".to_string(), r.id));
            }
        }
        plan
    });
    if da_purgare.is_empty() {
        return Ok(PuliziaCompattazioneStats::default());
    }
    for (entity, id) in &da_purgare {
        engine.emit(entity, id, EventBody::Purged).map_err(es)?;
    }
    compatta_store_dopo_pulizia(engine, data_dir, device_id)
}

fn notifica_letta_orfana(
    p: &crate::projection::Projection,
    pianificati: &BTreeSet<(String, String)>,
    notifica_id: &str,
    assenza_sufficiente: bool,
) -> bool {
    let Some((entity, id)) = target_notifica(notifica_id) else {
        return false;
    };
    if pianificati.contains(&(entity.to_string(), id.clone())) {
        return true;
    }
    if p.get(entity, &id).ok().flatten().is_some() {
        return false;
    }
    assenza_sufficiente || p.record_is_purged(entity, &id).unwrap_or(false)
}

fn target_notifica(notifica_id: &str) -> Option<(&'static str, String)> {
    // I suggerimenti sono proiezioni derivate, non record `notifica`: il loro
    // read-state resta valido fino alla retention temporale sopra.
    if notifica_id.starts_with("s14:") {
        return None;
    }
    if let Some(rest) = notifica_id.strip_prefix("sollecito:") {
        return rest
            .split(':')
            .next()
            .filter(|id| !id.is_empty())
            .map(|id| ("pagamento", id.to_string()));
    }
    if let Some(rest) = notifica_id.strip_prefix("marcatore:") {
        return (!rest.is_empty()).then(|| ("ordine", rest.to_string()));
    }
    for prefix in ["promem-pre:", "promem-scaduto:"] {
        if let Some(rest) = notifica_id.strip_prefix(prefix) {
            return rest
                .split(':')
                .next()
                .filter(|id| !id.is_empty())
                .map(|id| ("promemoria", id.to_string()));
        }
    }
    (!notifica_id.is_empty()).then(|| ("notifica", notifica_id.to_string()))
}

fn compatta_store_dopo_pulizia(
    engine: &Engine,
    data_dir: &Path,
    device_id: &str,
) -> AppResult<PuliziaCompattazioneStats> {
    engine.ingest().map_err(es)?;
    let (purged, snapshot) = engine.with_projection(|p| {
        let purged = p.list_purged().map_err(es)?;
        let snapshot = p.export().map_err(es)?;
        Ok::<_, String>((purged, snapshot))
    })?;
    if purged.is_empty() {
        return Ok(PuliziaCompattazioneStats::default());
    }

    // Non riscriviamo i log degli altri dispositivi e non eliminiamo le tombstone:
    // un PC offline deve poter ripubblicare la propria coda senza creare conflitti
    // né resuscitare record già eliminati. Lo snapshot aggiornato rende comunque
    // rapido il bootstrap, mentre il log completo resta la fonte di verità.
    salva_snapshot_data_con_device(&snapshot, data_dir, device_id)?;

    Ok(PuliziaCompattazioneStats {
        tombstone_rimosse: 0,
        eventi_rimossi: 0,
        compattato: false,
    })
}

fn aggiungi_cascata_ordine(
    plan: &mut PuliziaPlan,
    ordine_id: &str,
    righe_by_ordine: &HashMap<String, Vec<crate::projection::Record>>,
    pag_by_ordine: &HashMap<String, Vec<crate::projection::Record>>,
    rim_by_ordine: &HashMap<String, Vec<crate::projection::Record>>,
    prom_by_ordine: &HashMap<String, Vec<crate::projection::Record>>,
    includi_rimborsi_extra: bool,
) {
    plan.add("ordine", ordine_id);
    if let Some(righe) = righe_by_ordine.get(ordine_id) {
        for riga in righe {
            plan.add("riga_ordine", &riga.id);
        }
    }
    if let Some(pags) = pag_by_ordine.get(ordine_id) {
        for pag in pags {
            plan.add("pagamento", &pag.id);
        }
    }
    if let Some(rims) = rim_by_ordine.get(ordine_id) {
        for rim in rims {
            if includi_rimborsi_extra && str_field(&rim.data, "origine") == "extra" {
                plan.add("rimborso", &rim.id);
            }
        }
    }
    if let Some(proms) = prom_by_ordine.get(ordine_id) {
        for prom in proms {
            plan.add("promemoria", &prom.id);
        }
    }
}

fn valida_collegamenti_periodo(
    plan: &mut PuliziaPlan,
    selected_orders: &BTreeSet<String>,
    ordine_by_riga: &HashMap<String, String>,
    sped_righe: &HashMap<String, Vec<String>>,
    spedizioni: &[crate::projection::Record],
    pag_by_distinta: &HashMap<String, Vec<crate::projection::Record>>,
    distinte: &[crate::projection::Record],
) {
    for sped in spedizioni {
        let righe = sped_righe.get(&sped.id).cloned().unwrap_or_default();
        if righe.is_empty() {
            continue;
        }
        let ordini: HashSet<String> = righe
            .iter()
            .filter_map(|rid| ordine_by_riga.get(rid).cloned())
            .collect();
        let tocca = ordini.iter().any(|oid| selected_orders.contains(oid));
        if !tocca {
            continue;
        }
        if ordini.iter().all(|oid| selected_orders.contains(oid)) {
            plan.add("spedizione", &sped.id);
        } else {
            plan.blocca(
                "Spedizione mista",
                format!(
                    "La spedizione {} contiene righe sia dentro sia fuori dal periodo scelto.",
                    str_field(&sped.data, "numero_spedizione")
                ),
            );
        }
    }

    for distinta in distinte {
        let pagamenti = pag_by_distinta
            .get(&distinta.id)
            .cloned()
            .unwrap_or_default();
        if pagamenti.is_empty() {
            continue;
        }
        let tocca = pagamenti
            .iter()
            .any(|p| selected_orders.contains(&str_field(&p.data, "ordine_id")));
        if !tocca {
            continue;
        }
        if pagamenti
            .iter()
            .all(|p| selected_orders.contains(&str_field(&p.data, "ordine_id")))
        {
            plan.add("distinta", &distinta.id);
        } else {
            plan.blocca(
                "Distinta mista",
                format!(
                    "La distinta del {} copre pagamenti sia dentro sia fuori dal periodo scelto.",
                    str_field(&distinta.data, "data_distinta")
                ),
            );
        }
    }
}

fn ordine_inutile(
    ordine: &crate::projection::Record,
    righe: &[crate::projection::Record],
    pagamenti: &[crate::projection::Record],
    rimborsi: &[crate::projection::Record],
) -> bool {
    let stato = str_field(&ordine.data, "stato");
    matches!(stato.as_str(), "Nuovo" | "Rifiutato")
        && !pagamenti.iter().any(|p| bool_field(&p.data, "saldato"))
        && !ordine_ha_produzione(ordine, righe)
        && !ordine_ha_spedizione(righe)
        && rimborsi.is_empty()
}

fn ordine_reale(
    ordine: &crate::projection::Record,
    righe: &[crate::projection::Record],
    pagamenti: &[crate::projection::Record],
) -> bool {
    pagamenti.iter().any(|p| bool_field(&p.data, "saldato"))
        || ordine_ha_produzione(ordine, righe)
        || ordine_ha_spedizione(righe)
        || stato_almeno_confermato(&str_field(&ordine.data, "stato"))
}

fn stato_almeno_confermato(stato: &str) -> bool {
    matches!(
        stato,
        "Confermato" | "In produzione" | "Arrivato IT" | "Spedito" | "Chiuso"
    )
}

fn ordine_ha_produzione(
    ordine: &crate::projection::Record,
    righe: &[crate::projection::Record],
) -> bool {
    for key in [
        "data_produzione",
        "data_arrivo_it",
        "data_prevista_lotto",
        "lotto_produzione",
    ] {
        if !str_field(&ordine.data, key).is_empty() {
            return true;
        }
    }
    righe.iter().any(|r| {
        [
            "stato_produzione",
            "data_produzione",
            "data_arrivo_it",
            "lotto_produzione",
            "numero_produzione",
        ]
        .iter()
        .any(|key| !str_field(&r.data, key).is_empty())
    })
}

fn ordine_ha_spedizione(righe: &[crate::projection::Record]) -> bool {
    righe.iter().any(|r| {
        !str_field(&r.data, "spedizione_id").is_empty()
            || str_field(&r.data, "stato_riga") == "spedita"
    })
}

fn pulizia_range(args: &PuliziaDatiArgs) -> PuliziaRange {
    let oggi = oggi_iso();
    let anno = args
        .anno
        .filter(|y| (2000..=2100).contains(y))
        .unwrap_or_else(|| oggi[..4].parse::<i64>().unwrap_or(2026));
    let (dal, al) = match args.preset.as_str() {
        "anno" => (format!("{anno:04}-01-01"), format!("{anno:04}-12-31")),
        "prima_anno" => (String::new(), format!("{:04}-12-31", anno - 1)),
        "mesi_12" => (String::new(), sottrai_mesi(&oggi, 12)),
        "mesi_24" => (String::new(), sottrai_mesi(&oggi, 24)),
        "mesi_36" => (String::new(), sottrai_mesi(&oggi, 36)),
        "custom" => (
            args.dal.clone().unwrap_or_default(),
            args.al.clone().unwrap_or_default(),
        ),
        _ => (format!("{anno:04}-01-01"), format!("{anno:04}-12-31")),
    };
    let valido = match (iso_to_days(&dal), iso_to_days(&al)) {
        (Some(d), Some(a)) => d <= a,
        (Some(_), None) => true,
        (None, Some(_)) => true,
        (None, None) => !dal.is_empty() || !al.is_empty(),
    };
    PuliziaRange { dal, al, valido }
}

fn data_in_range(data: &str, range: &PuliziaRange) -> bool {
    let Some(d) = iso_to_days(data) else {
        return false;
    };
    if !range.dal.is_empty() {
        if let Some(min) = iso_to_days(&range.dal) {
            if d < min {
                return false;
            }
        }
    }
    if !range.al.is_empty() {
        if let Some(max) = iso_to_days(&range.al) {
            if d > max {
                return false;
            }
        }
    }
    true
}

fn descrizione_pulizia(modalita: &str, range: &PuliziaRange) -> String {
    let periodo = match (range.dal.as_str(), range.al.as_str()) {
        ("", "") => "nel periodo selezionato".to_string(),
        ("", al) => format!("fino al {al}"),
        (dal, "") => format!("dal {dal} in poi"),
        (dal, al) => format!("dal {dal} al {al}"),
    };
    match modalita {
        "inutili" => format!("Ordini inutili {periodo}"),
        "clienti_morti" => format!("Clienti senza ordini reali {periodo}"),
        "movimenti_periodo" => format!("Movimenti e clienti orfani {periodo}"),
        _ => format!("Pulizia dati {periodo}"),
    }
}

fn data_record(hlc: &crate::sync::hlc::Hlc) -> String {
    data_epoch_ms(hlc.wall)
}

pub(super) fn data_epoch_ms(ms: u64) -> String {
    let (y, m, d, ..) = civil_from_unix(ms / 1000);
    format!("{y:04}-{m:02}-{d:02}")
}

pub(super) fn oggi_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, m, d, ..) = civil_from_unix(secs);
    format!("{y:04}-{m:02}-{d:02}")
}

fn sottrai_mesi(iso: &str, mesi: i64) -> String {
    let parts: Vec<&str> = iso.split('-').collect();
    if parts.len() != 3 {
        return iso.to_string();
    }
    let mut y = parts[0].parse::<i64>().unwrap_or(2026);
    let mut m = parts[1].parse::<i64>().unwrap_or(1);
    let mut d = parts[2].parse::<u32>().unwrap_or(1);
    let total = y * 12 + (m - 1) - mesi;
    y = total.div_euclid(12);
    m = total.rem_euclid(12) + 1;
    d = d.min(giorni_mese(y, m as u32));
    format!("{y:04}-{m:02}-{d:02}")
}

fn giorni_mese(y: i64, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        _ => 30,
    }
}

#[cfg(test)]
mod tests {
    use super::target_notifica;

    #[test]
    fn read_state_suggerimenti_non_cerca_record_persistiti() {
        assert_eq!(target_notifica("s14:rimborso:utente:rev"), None);
        assert_eq!(
            target_notifica("sollecito:pagamento-1:0"),
            Some(("pagamento", "pagamento-1".to_string()))
        );
    }
}
