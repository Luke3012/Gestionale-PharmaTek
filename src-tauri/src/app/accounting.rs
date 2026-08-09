use super::cleanup::oggi_iso;
use super::*;

#[derive(Clone)]
struct PagamentoApertoDaRiallineare {
    id: String,
    importo: i64,
    scadenza: String,
}

/// Costruisce le mutazioni necessarie per riallineare lo scadenzario aperto.
///
/// Gli override sono usati dal salvataggio preventivo: totale, righe ordine,
/// testata e scadenzario entrano così nello stesso batch event-sourced, senza
/// una finestra intermedia incoerente. Il normale editor ordine passa `None` e
/// continua a derivare gli importi dalla proiezione corrente.
pub(super) fn pianifica_riallineamento_pagamenti_aperti(
    p: &crate::projection::Projection,
    ordine_id: &str,
    totale_override: Option<i64>,
    acconto_override: Option<i64>,
) -> AppResult<Vec<Mutation>> {
    let ordine = p
        .get("ordine", ordine_id)
        .map_err(es)?
        .ok_or_else(|| "ordine non piu disponibile".to_string())?;
    let stato = str_field(&ordine.data, "stato");
    if matches!(stato.as_str(), "Rifiutato" | "Annullato") {
        return Ok(Vec::new());
    }

    let totale = totale_override.unwrap_or_else(|| *totali_ordini(p).get(ordine_id).unwrap_or(&0));
    let mut importo_fisso = 0i64;
    let mut aperti: Vec<PagamentoApertoDaRiallineare> = Vec::new();
    let mut acconti_attesi: Vec<crate::projection::Record> = Vec::new();
    let mut ha_acconto_saldato = false;
    let mut pagamenti: Vec<crate::projection::Record> = p
        .list("pagamento")
        .unwrap_or_default()
        .into_iter()
        .filter(|r| str_field(&r.data, "ordine_id") == ordine_id)
        .collect();
    pagamenti.sort_by(|a, b| a.created_hlc.cmp(&b.created_hlc));
    for r in pagamenti {
        let saldato = bool_field(&r.data, "saldato");
        let tipo = str_field(&r.data, "tipo");
        if !saldato && matches!(tipo.as_str(), "saldo" | "rata") {
            aperti.push(PagamentoApertoDaRiallineare {
                id: r.id,
                importo: i64_field(&r.data, "importo").max(0),
                scadenza: str_field(&r.data, "scadenza"),
            });
        } else if !saldato && tipo == "acconto" {
            acconti_attesi.push(r);
        } else {
            if saldato && tipo == "acconto" {
                ha_acconto_saldato = true;
            }
            importo_fisso += i64_field(&r.data, "importo").max(0);
        }
    }
    aperti.sort_by(|a, b| {
        (if a.scadenza.is_empty() {
            "9999-12-31"
        } else {
            a.scadenza.as_str()
        })
        .cmp(if b.scadenza.is_empty() {
            "9999-12-31"
        } else {
            b.scadenza.as_str()
        })
        .then(a.id.cmp(&b.id))
    });
    let mut da_eliminare = Vec::new();
    let mut da_aggiornare = Vec::new();
    let mut da_creare = Vec::new();

    // Un acconto incassato e' storico e non si riscrive. L'acconto soltanto
    // atteso segue invece il piano commerciale corrente.
    let acconto_previsto = acconto_override
        .unwrap_or_else(|| i64_field(&ordine.data, "acconto"))
        .clamp(0, totale.max(0));
    if ha_acconto_saldato || totale <= 0 {
        da_eliminare.extend(acconti_attesi.into_iter().map(|r| r.id));
    } else if acconto_previsto > 0 {
        if let Some((primo, altri)) = acconti_attesi.split_first() {
            let importo_attuale = i64_field(&primo.data, "importo").max(0);
            if importo_attuale != acconto_previsto {
                da_aggiornare.push((primo.id.clone(), acconto_previsto));
            }
            importo_fisso += acconto_previsto;
            da_eliminare.extend(altri.iter().map(|r| r.id.clone()));
        } else {
            importo_fisso += acconto_previsto;
            da_creare.push(NuovoPagamentoAtteso {
                tipo: "acconto",
                importo: acconto_previsto,
                scadenza: str_field(&ordine.data, "data"),
                conto_id: conto_preferito_ordine(p, &ordine.data, "acconto"),
                scad_da_spedizione: false,
            });
        }
    } else if acconto_override.is_some() {
        // Un override esplicito a zero (preventivo/editor) annulla il vecchio
        // acconto soltanto atteso. Senza override conserviamo invece un eventuale
        // piano manuale non ancora riportato sulla testata dell'ordine.
        da_eliminare.extend(acconti_attesi.into_iter().map(|r| r.id));
    } else if let Some((primo, altri)) = acconti_attesi.split_first() {
        importo_fisso += i64_field(&primo.data, "importo").max(0);
        da_eliminare.extend(altri.iter().map(|r| r.id.clone()));
    }

    let target_aperto = (totale - importo_fisso).max(0);
    if target_aperto == 0 {
        da_eliminare.extend(aperti.into_iter().map(|pagamento| pagamento.id));
    } else if aperti.is_empty() {
        da_creare.push(NuovoPagamentoAtteso {
            tipo: "saldo",
            importo: target_aperto,
            scadenza: aggiungi_giorni_iso(&str_field(&ordine.data, "data"), 30),
            conto_id: conto_preferito_ordine(p, &ordine.data, "saldo"),
            scad_da_spedizione: true,
        });
    } else {
        let quote = ripartisci_importo_proporzionale(
            target_aperto,
            &aperti
                .iter()
                .map(|pagamento| pagamento.importo)
                .collect::<Vec<_>>(),
        );
        for (pagamento, importo) in aperti.into_iter().zip(quote) {
            if importo <= 0 {
                da_eliminare.push(pagamento.id);
            } else if pagamento.importo != importo {
                da_aggiornare.push((pagamento.id, importo));
            }
        }
    }

    let mut mutations = da_eliminare
        .into_iter()
        .map(|id| Mutation::new("pagamento", id, EventBody::Purged))
        .collect::<Vec<_>>();
    mutations.extend(da_aggiornare.into_iter().map(|(id, importo)| {
        Mutation::new(
            "pagamento",
            id,
            EventBody::FieldSet {
                field: "importo".into(),
                value: json!(importo),
            },
        )
    }));
    for nuovo in da_creare {
        let id = Ulid::generate().to_string();
        mutations.push(Mutation::new("pagamento", id.clone(), EventBody::Created));
        let mut fields = vec![
            ("ordine_id", json!(ordine_id)),
            ("tipo", json!(nuovo.tipo)),
            ("importo", json!(nuovo.importo)),
            ("saldato", json!(false)),
            (
                "scadenza",
                json!(if nuovo.scad_da_spedizione {
                    "".to_string()
                } else {
                    nuovo.scadenza
                }),
            ),
            ("conto_id", json!(nuovo.conto_id)),
            ("data", json!("")),
            ("verificato", json!(false)),
        ];
        if nuovo.scad_da_spedizione {
            fields.push(("scad_da_spedizione", json!(true)));
            fields.push(("scad_rel_giorni", json!(0)));
        }
        mutations.extend(fields.into_iter().map(|(field, value)| {
            Mutation::new(
                "pagamento",
                id.clone(),
                EventBody::FieldSet {
                    field: field.to_string(),
                    value,
                },
            )
        }));
    }
    Ok(mutations)
}

impl AppState {
    // ---- Pagamenti / contabilità (FASE 3A) ----

    /// Pagamenti di un ordine (libro mastro), arricchiti col nome/tipo del conto,
    /// ordinati per data di incasso poi creazione.
    pub fn pagamenti_ordine(&self, ordine_id: &str) -> AppResult<Vec<PagamentoDto>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let conti = conti_info(p);
                let distinte = distinte_accredito(p);
                let mut v: Vec<crate::projection::Record> = p
                    .list("pagamento")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "ordine_id") == ordine_id)
                    .collect();
                // Ordina per data rilevante (incasso se saldato, altrimenti scadenza),
                // poi per creazione: lo scadenzario risulta in ordine cronologico.
                let chiave = |r: &crate::projection::Record| {
                    if bool_field(&r.data, "saldato") {
                        str_field(&r.data, "data")
                    } else {
                        str_field(&r.data, "scadenza")
                    }
                };
                v.sort_by(|a, b| {
                    chiave(a)
                        .cmp(&chiave(b))
                        .then(a.created_hlc.cmp(&b.created_hlc))
                });
                v.iter()
                    .map(|r| pagamento_dto(r, &conti, &distinte))
                    .collect()
            }))
        })
    }

    /// Vista unica **Crediti** (Contabilità → Crediti): tutti i pagamenti — attesi e
    /// saldati — con i dati dell'ordine. Filtri opzionali agente/conto/periodo/stato.
    /// `stato` ∈ "" (tutti) | `atteso` | `saldato` | `da_verificare`. Il periodo si
    /// applica alla data rilevante (incasso se saldato, altrimenti scadenza).
    pub fn pagamenti_vista(
        &self,
        agente_id: Option<String>,
        conto_id: Option<String>,
        dal: Option<String>,
        al: Option<String>,
        stato: Option<String>,
    ) -> AppResult<Vec<PagamentoVistaDto>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let conti = conti_info(p);
                let distinte = distinte_accredito(p);
                let numeri = numeri_ordini(p);
                let cli_nomi = nome_map(p, "cliente");
                let ag_nomi = nome_map(p, "agente");
                let med_nomi = nome_map(p, "medico");
                // Un solo scan di `ordine` (era ripetuto 4 volte → 4× il parse JSON di
                // ogni ordine): si costruiscono in un colpo le mappe id→cliente/medico/
                // agente/stato. Sul Crediti con molti ordini taglia il grosso del caricamento.
                let mut ord_cli: HashMap<String, String> = HashMap::new();
                let mut ord_med: HashMap<String, String> = HashMap::new();
                let mut ord_ag: HashMap<String, String> = HashMap::new();
                let mut ord_stato: HashMap<String, String> = HashMap::new();
                for r in p.list("ordine").unwrap_or_default() {
                    ord_cli.insert(r.id.clone(), str_field(&r.data, "cliente_id"));
                    ord_med.insert(r.id.clone(), str_field(&r.data, "medico_id"));
                    ord_ag.insert(r.id.clone(), str_field(&r.data, "agente_id"));
                    ord_stato.insert(r.id, str_field(&r.data, "stato"));
                }
                let ordini_spediti: std::collections::HashSet<String> = p
                    .list("riga_ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| !str_field(&r.data, "spedizione_id").is_empty())
                    .map(|r| str_field(&r.data, "ordine_id"))
                    .filter(|id| !id.is_empty())
                    .collect();
                let linee = linee_ordini(p);

                let af = agente_id.filter(|s| !s.is_empty());
                let cf = conto_id.filter(|s| !s.is_empty());
                let dal = dal.filter(|s| !s.is_empty());
                let al = al.filter(|s| !s.is_empty());
                let stato = stato.filter(|s| !s.is_empty());

                let mut out = Vec::new();
                for r in p.list("pagamento").unwrap_or_default() {
                    let saldato = bool_field(&r.data, "saldato");
                    let verificato = bool_field(&r.data, "verificato");
                    if let Some(s) = &stato {
                        let ok = match s.as_str() {
                            "atteso" => !saldato,
                            "saldato" => saldato,
                            "da_verificare" => saldato && !verificato,
                            _ => true,
                        };
                        if !ok {
                            continue;
                        }
                    }
                    let conto = str_field(&r.data, "conto_id");
                    if let Some(c) = &cf {
                        if &conto != c {
                            continue;
                        }
                    }
                    let oid = str_field(&r.data, "ordine_id");
                    // Ordine annullato (soft-deleted): i suoi pagamenti non esistono più ai
                    // fini dei Crediti. Le mappe ord_* sono costruite solo dagli ordini NON
                    // eliminati, quindi l'assenza dalla mappa = ordine nel Cestino → si salta.
                    if !ord_stato.contains_key(&oid) {
                        continue;
                    }
                    let ordine_stato = ord_stato.get(&oid).cloned().unwrap_or_default();
                    // Gli attesi di un ordine RIFIUTATO sono esclusi del tutto (preventivo
                    // rifiutato: né incasso, né credito, né potenziale).
                    if !saldato && ordine_stato == "Rifiutato" {
                        continue;
                    }
                    let ag = ord_ag.get(&oid).cloned().unwrap_or_default();
                    if let Some(a) = &af {
                        if &ag != a {
                            continue;
                        }
                    }
                    let data = str_field(&r.data, "data");
                    let scadenza_record = str_field(&r.data, "scadenza");
                    let scadenza = if !saldato
                        && bool_field(&r.data, "scad_da_spedizione")
                        && !ordini_spediti.contains(&oid)
                    {
                        String::new()
                    } else {
                        scadenza_record
                    };
                    let rilevante = if saldato { &data } else { &scadenza };
                    if let Some(d) = &dal {
                        if rilevante.as_str() < d.as_str() {
                            continue;
                        }
                    }
                    if let Some(a) = &al {
                        if rilevante.as_str() > a.as_str() {
                            continue;
                        }
                    }
                    let cliente_nome = ord_cli
                        .get(&oid)
                        .and_then(|cid| cli_nomi.get(cid))
                        .cloned()
                        .unwrap_or_default();
                    let medico_nome = ord_med
                        .get(&oid)
                        .and_then(|mid| med_nomi.get(mid))
                        .cloned()
                        .unwrap_or_default();
                    let (conto_nome, conto_tipo, _) =
                        conti.get(&conto).cloned().unwrap_or_default();
                    let distinta_id = str_field(&r.data, "distinta_id");
                    let conto_accredito_nome =
                        distinte.get(&distinta_id).cloned().unwrap_or_default();
                    let linee_ord = linee.get(&oid).cloned().unwrap_or_default();
                    out.push(PagamentoVistaDto {
                        revision: r.updated_hlc.to_string(),
                        ordine_numero: numeri.get(&oid).cloned().unwrap_or_default(),
                        linee: linee_ord,
                        cliente_id: ord_cli.get(&oid).cloned().unwrap_or_default(),
                        medico_id: ord_med.get(&oid).cloned().unwrap_or_default(),
                        agente_id: ag.clone(),
                        ordine_id: oid,
                        cliente_nome,
                        medico_nome,
                        agente_nome: ag_nomi.get(&ag).cloned().unwrap_or_default(),
                        tipo: str_field(&r.data, "tipo"),
                        importo: i64_field(&r.data, "importo"),
                        saldato,
                        scadenza,
                        data,
                        conto_id: conto,
                        conto_nome,
                        conto_tipo,
                        conto_accredito_nome,
                        ordine_stato,
                        verificato,
                        id: r.id,
                    });
                }
                out
            }))
        })
    }

    /// Posticipa di sette giorni un insieme di rate ancora aperte. L'operazione è
    /// atomica e idempotente per campagna: un retry non applica altri sette giorni.
    pub fn pagamenti_proroga_sette_giorni(
        &self,
        campagna_id: &str,
        pagamenti: Vec<ProrogaPagamentoInput>,
    ) -> AppResult<usize> {
        crate::premium::ensure_access(self)?;
        let campagna_id = campagna_id.trim();
        if campagna_id.is_empty() || pagamenti.is_empty() {
            return Err("specifica campagna e pagamenti da prorogare".into());
        }
        let campagna_id = campagna_id.to_string();
        let totale = pagamenti.len();
        self.with_engine(|engine| {
            engine
                .emit_built_checked(move |projection| {
                    let mut mutations = Vec::new();
                    let mut ids = std::collections::BTreeSet::new();
                    for input in &pagamenti {
                        if !ids.insert(input.id.clone()) {
                            return Err("lo stesso pagamento compare più volte".into());
                        }
                        let record = projection
                            .get("pagamento", &input.id)
                            .map_err(|error| error.to_string())?
                            .filter(|record| !record.deleted)
                            .ok_or_else(|| "un pagamento non esiste più".to_string())?;
                        if str_field(&record.data, "comunicazione_proroga_id") == campagna_id {
                            continue;
                        }
                        if record.updated_hlc.to_string() != input.revision {
                            return Err(
                                "un pagamento è cambiato durante la revisione: rigenera la campagna"
                                    .into(),
                            );
                        }
                        if bool_field(&record.data, "saldato") {
                            return Err("un pagamento selezionato risulta già saldato".into());
                        }
                        let corrente = str_field(&record.data, "scadenza");
                        if corrente != input.vecchia_scadenza
                            || !sette_giorni_dopo(&corrente, &input.nuova_scadenza)
                        {
                            return Err("le scadenze della proroga non sono più coerenti".into());
                        }
                        mutations.push(Mutation::new(
                            "pagamento",
                            input.id.clone(),
                            EventBody::FieldSet {
                                field: "scadenza".into(),
                                value: json!(input.nuova_scadenza),
                            },
                        ));
                        mutations.push(Mutation::new(
                            "pagamento",
                            input.id.clone(),
                            EventBody::FieldSet {
                                field: "comunicazione_proroga_id".into(),
                                value: json!(campagna_id),
                            },
                        ));
                    }
                    Ok(mutations)
                })
                .map_err(es)?;
            Ok(totale)
        })
    }

    /// Piccoli pannelli della dashboard: ultimi ordini e pagamenti scaduti.
    /// Il frontend mostra solo poche righe, quindi tronchiamo prima del passaggio IPC.
    pub fn dashboard_pannelli(&self) -> AppResult<DashboardPanelsDto> {
        let mut ultimi_ordini = self.ordini_lista()?;
        ultimi_ordini.sort_by(|a, b| b.data.cmp(&a.data).then_with(|| b.numero.cmp(&a.numero)));
        ultimi_ordini.truncate(6);

        let oggi = oggi_iso();
        let mut pagamenti_scaduti =
            self.pagamenti_vista(None, None, None, None, Some("atteso".into()))?;
        // Gli acconti attesi di un ordine appena creato non sono solleciti: la dashboard
        // mostra soltanto saldi e rate realmente scaduti.
        pagamenti_scaduti.retain(|r| {
            r.tipo != "acconto" && !r.scadenza.is_empty() && r.scadenza.as_str() < oggi.as_str()
        });
        pagamenti_scaduti.sort_by(|a, b| a.scadenza.cmp(&b.scadenza));
        pagamenti_scaduti.truncate(6);

        Ok(DashboardPanelsDto {
            ultimi_ordini,
            pagamenti_scaduti,
        })
    }

    /// Crea un pagamento. `saldato = false` → **atteso** (con `scadenza`); `true` →
    /// **incassato** (con `data`/`conto`). Saldando un ordine *Nuovo* lo porta a
    /// *Confermato*. Restituisce il pagamento creato.
    #[allow(clippy::too_many_arguments)]
    pub fn pagamento_registra(
        &self,
        ordine_id: &str,
        tipo: &str,
        importo: i64,
        saldato: bool,
        scadenza: &str,
        conto_id: &str,
        data: &str,
        verificato: bool,
        note: Option<String>,
    ) -> AppResult<PagamentoDto> {
        if importo <= 0 {
            return Err("importo pagamento non valido".into());
        }
        if saldato && (data.is_empty() || conto_id.is_empty()) {
            return Err("conto e data sono obbligatori per un pagamento incassato".into());
        }
        self.with_engine(|engine| {
            let id = Ulid::generate().to_string();
            engine
                .emit_built_checked(|p| {
                    let ordine = p
                        .get("ordine", ordine_id)
                        .map_err(|error| error.to_string())?
                        .ok_or_else(|| "ordine non piu disponibile".to_string())?;
                    let stato = str_field(&ordine.data, "stato");
                    if matches!(stato.as_str(), "Rifiutato" | "Annullato") {
                        return Err("l'ordine non puo ricevere pagamenti".into());
                    }
                    if !conto_id.is_empty()
                        && p.get("conto", conto_id)
                            .map_err(|error| error.to_string())?
                            .is_none()
                    {
                        return Err("il conto selezionato non e' piu disponibile".into());
                    }
                    let mut mutations =
                        vec![Mutation::new("pagamento", id.clone(), EventBody::Created)];
                    let mut fields = vec![
                        ("ordine_id", json!(ordine_id)),
                        ("tipo", json!(tipo)),
                        ("importo", json!(importo)),
                        ("saldato", json!(saldato)),
                        ("scadenza", json!(scadenza)),
                        ("conto_id", json!(conto_id)),
                        ("data", json!(data)),
                        ("verificato", json!(verificato)),
                    ];
                    if let Some(n) = note.as_ref().filter(|value| !value.is_empty()) {
                        fields.push(("note", json!(n)));
                    }
                    mutations.extend(fields.into_iter().map(|(field, value)| {
                        Mutation::new(
                            "pagamento",
                            id.clone(),
                            EventBody::FieldSet {
                                field: field.to_string(),
                                value,
                            },
                        )
                    }));
                    Ok(mutations)
                })
                .map_err(es)?;

            if saldato {
                conferma_se_nuovo(engine, ordine_id)?;
                pulisci_attesi_se_saldato(engine, ordine_id)?;
                prova_chiudi_ordine(engine, ordine_id, &data_giorni_fa(GIORNI_CHIUSURA))?;
            }

            engine
                .with_projection(|p| {
                    let conti = conti_info(p);
                    let distinte = distinte_accredito(p);
                    p.get("pagamento", &id)
                        .ok()
                        .flatten()
                        .map(|r| pagamento_dto(&r, &conti, &distinte))
                })
                .ok_or_else(|| "pagamento non trovato dopo la creazione".to_string())
        })
    }

    /// **Salda** un pagamento atteso: imposta `saldato = true` con conto/data/verifica
    /// reali. Conferma l'ordine se era *Nuovo*. Restituisce il pagamento aggiornato.
    pub fn pagamento_salda(
        &self,
        id: &str,
        conto_id: &str,
        data: &str,
        verificato: bool,
    ) -> AppResult<PagamentoDto> {
        self.pagamento_salda_checked(id, conto_id, data, verificato, serde_json::Map::new())
    }

    /// Variante usata dall'editor: applica anche le modifiche accessorie e il saldo
    /// nello stesso batch. La patch contiene solo i campi modificati nel form.
    pub fn pagamento_salda_checked(
        &self,
        id: &str,
        conto_id: &str,
        data: &str,
        verificato: bool,
        mut fields: serde_json::Map<String, serde_json::Value>,
    ) -> AppResult<PagamentoDto> {
        if conto_id.is_empty() || data.is_empty() {
            return Err("conto e data sono obbligatori per saldare un pagamento".into());
        }
        // Questi campi descrivono la transizione e non possono essere contraffatti
        // dalla patch accessoria proveniente dall'editor.
        for reserved in ["ordine_id", "saldato", "conto_id", "data", "verificato"] {
            fields.remove(reserved);
        }
        valida_importo_pagamento("pagamento", &fields)?;
        self.with_engine(|engine| {
            let ordine_id = engine.with_projection(|p| {
                p.get("pagamento", id)
                    .ok()
                    .flatten()
                    .map(|pagamento| str_field(&pagamento.data, "ordine_id"))
            });
            let ordine_id = ordine_id.ok_or_else(|| "pagamento non trovato".to_string())?;
            let importo_patch = fields.get("importo").and_then(|value| value.as_i64());
            let mut mutations = fields
                .into_iter()
                .map(|(field, value)| {
                    Mutation::new("pagamento", id, EventBody::FieldSet { field, value })
                })
                .collect::<Vec<_>>();
            mutations.extend([
                Mutation::new(
                    "pagamento",
                    id,
                    EventBody::FieldSet {
                        field: "saldato".into(),
                        value: json!(true),
                    },
                ),
                Mutation::new(
                    "pagamento",
                    id,
                    EventBody::FieldSet {
                        field: "conto_id".into(),
                        value: json!(conto_id),
                    },
                ),
                Mutation::new(
                    "pagamento",
                    id,
                    EventBody::FieldSet {
                        field: "data".into(),
                        value: json!(data),
                    },
                ),
                Mutation::new(
                    "pagamento",
                    id,
                    EventBody::FieldSet {
                        field: "verificato".into(),
                        value: json!(verificato),
                    },
                ),
            ]);
            let ordine_for_check = ordine_id.clone();
            engine
                .emit_built_checked(move |p| {
                    if p.get("conto", conto_id)
                        .map_err(|error| error.to_string())?
                        .is_none()
                    {
                        return Err("il conto selezionato non e' piu disponibile".into());
                    }
                    let pagamento = p
                        .get("pagamento", id)
                        .map_err(|error| error.to_string())?
                        .ok_or_else(|| "pagamento non trovato".to_string())?;
                    if pagamento.deleted {
                        return Err("il pagamento è stato eliminato".into());
                    }
                    if bool_field(&pagamento.data, "saldato") {
                        return Err("questo pagamento risulta gia saldato".into());
                    }
                    if str_field(&pagamento.data, "ordine_id") != ordine_for_check {
                        return Err("il pagamento è stato spostato su un altro ordine".into());
                    }
                    let ordine = p
                        .get("ordine", &ordine_for_check)
                        .map_err(|error| error.to_string())?
                        .ok_or_else(|| "ordine non piu disponibile".to_string())?;
                    let stato = str_field(&ordine.data, "stato");
                    if matches!(stato.as_str(), "Rifiutato" | "Annullato") {
                        return Err("l'ordine non puo ricevere pagamenti".into());
                    }
                    if stato == "Nuovo" {
                        mutations.push(Mutation::new(
                            "ordine",
                            ordine_for_check.clone(),
                            EventBody::FieldSet {
                                field: "stato".into(),
                                value: json!("Confermato"),
                            },
                        ));
                    }

                    // Se questo incasso completa l'ordine, elimina gli altri
                    // attesi nello stesso batch della transizione di saldo.
                    let totale = totali_ordini(p)
                        .get(&ordine_for_check)
                        .copied()
                        .unwrap_or(0);
                    let importo_corrente =
                        importo_patch.unwrap_or_else(|| i64_field(&pagamento.data, "importo"));
                    let pagamenti = p.list("pagamento").unwrap_or_default();
                    let incassato = pagamenti
                        .iter()
                        .filter(|record| {
                            str_field(&record.data, "ordine_id") == ordine_for_check
                                && bool_field(&record.data, "saldato")
                        })
                        .map(|record| i64_field(&record.data, "importo"))
                        .sum::<i64>();
                    if totale > 0 && incassato + importo_corrente >= totale {
                        mutations.extend(
                            pagamenti
                                .into_iter()
                                .filter(|record| {
                                    record.id != id
                                        && str_field(&record.data, "ordine_id") == ordine_for_check
                                        && !bool_field(&record.data, "saldato")
                                })
                                .map(|record| {
                                    Mutation::new("pagamento", record.id, EventBody::Purged)
                                }),
                        );
                    }
                    Ok(mutations)
                })
                .map_err(es)?;
            prova_chiudi_ordine(engine, &ordine_id, &data_giorni_fa(GIORNI_CHIUSURA))?;
            engine
                .with_projection(|p| {
                    let conti = conti_info(p);
                    let distinte = distinte_accredito(p);
                    p.get("pagamento", id)
                        .ok()
                        .flatten()
                        .map(|r| pagamento_dto(&r, &conti, &distinte))
                })
                .ok_or_else(|| "pagamento non trovato dopo il saldo".to_string())
        })
    }

    /// Automazione **"Chiuso"**: chiude gli ordini Spediti e completamente saldati il
    /// cui ultimo saldo risale ad almeno 20 giorni fa. Eseguita all'avvio dell'app.
    /// Ritorna il numero di ordini chiusi. (Tutto via motore eventi → conflict-free.)
    pub fn ordini_auto_chiudi(&self) -> AppResult<usize> {
        self.with_engine(|engine| {
            let soglia = data_giorni_fa(GIORNI_CHIUSURA);
            let candidati: Vec<String> = engine.with_projection(|p| {
                p.list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "stato") == "Spedito")
                    .map(|r| r.id)
                    .collect()
            });
            let mut chiusi = 0usize;
            for id in candidati {
                if prova_chiudi_ordine(engine, &id, &soglia)? {
                    chiusi += 1;
                }
            }
            Ok(chiusi)
        })
    }

    /// **Rateizza** il saldo di un ordine: elimina i pagamenti *attesi* di tipo
    /// `saldo`/`rata` e crea N rate attese con gli importi/scadenze dati. Acconto e
    /// pagamenti già saldati restano intatti.
    pub fn pagamenti_rateizza(
        &self,
        ordine_id: &str,
        rate: Vec<RataInput>,
        // FASE 7: se vero, le rate sono **legate alla spedizione** (prima a «spedizione + 7gg»,
        // poi la cadenza). Vengono marcate e — se l'ordine è già spedito — riallineate subito.
        da_spedizione: bool,
    ) -> AppResult<()> {
        self.pagamenti_rateizza_impl(ordine_id, rate, da_spedizione, false)
    }

    /// Aggiunge N rate per la parte dell'ordine non ancora coperta dallo scadenzario.
    /// A differenza di `pagamenti_rateizza`, non elimina né modifica gli attesi esistenti.
    pub fn pagamenti_aggiungi_rate(
        &self,
        ordine_id: &str,
        rate: Vec<RataInput>,
        da_spedizione: bool,
    ) -> AppResult<()> {
        self.pagamenti_rateizza_impl(ordine_id, rate, da_spedizione, true)
    }

    fn pagamenti_rateizza_impl(
        &self,
        ordine_id: &str,
        rate: Vec<RataInput>,
        da_spedizione: bool,
        aggiungi: bool,
    ) -> AppResult<()> {
        if rate.is_empty() {
            return Err("indicare almeno una rata".into());
        }
        let somma_rate: i64 = rate.iter().map(|r| r.importo).sum();
        if somma_rate <= 0
            || rate
                .iter()
                .any(|r| r.importo <= 0 || r.scadenza.trim().is_empty())
        {
            return Err("rate non valide".into());
        }
        // Distanza (giorni) di ogni rata dalla prima del piano: serve per far scivolare
        // l'intero scadenzario a partire da «spedizione + offset», conservando la cadenza.
        let anchor = rate.first().and_then(|r| iso_to_days(&r.scadenza));
        self.with_engine(|engine| {
            let ordine_for_batch = ordine_id.to_string();
            engine
                .emit_built_checked(move |p| {
                    // Il piano, la verifica del residuo e la sostituzione degli aperti sono
                    // costruiti dalla stessa proiezione protetta: il watcher non può inserire
                    // un saldo fra il controllo e l'append del batch.
                    let ordine = p
                        .get("ordine", &ordine_for_batch)
                        .map_err(|error| error.to_string())?
                        .ok_or_else(|| "ordine non piu disponibile".to_string())?;
                    let stato = str_field(&ordine.data, "stato");
                    if matches!(stato.as_str(), "Rifiutato" | "Annullato") {
                        return Err("l'ordine non puo essere rateizzato".into());
                    }
                    let mut ids = Vec::new();
                    let mut conto = String::new();
                    let mut coperto = 0i64;
                    let mut fisso_non_rateizzabile = 0i64;
                    for r in p.list("pagamento").unwrap_or_default() {
                        if str_field(&r.data, "ordine_id") != ordine_for_batch {
                            continue;
                        }
                        let importo = i64_field(&r.data, "importo").max(0);
                        let tipo = str_field(&r.data, "tipo");
                        let saldo_o_rata_aperto = !bool_field(&r.data, "saldato")
                            && matches!(tipo.as_str(), "saldo" | "rata");
                        coperto += importo;
                        if saldo_o_rata_aperto {
                            if conto.is_empty() {
                                conto = str_field(&r.data, "conto_id");
                            }
                            if !aggiungi {
                                ids.push(r.id);
                            }
                        } else {
                            // Acconti attesi/saldati e pagamenti già saldati sono quote fisse:
                            // "Rateizza saldo" deve sostituire solo saldo/rate aperti.
                            fisso_non_rateizzabile += importo;
                        }
                    }
                    if aggiungi && conto.is_empty() {
                        conto = conto_preferito_ordine(p, &ordine.data, "saldo");
                    }
                    if !conto.is_empty()
                        && p.get("conto", &conto)
                            .map_err(|error| error.to_string())?
                            .is_none()
                    {
                        return Err("il conto del saldo non e' piu disponibile".into());
                    }
                    let totale = *totali_ordini(p).get(&ordine_for_batch).unwrap_or(&0);
                    let transito = conti_transito(p);
                    let conto_successive = if transito.contains(&conto) {
                        let preferito = conto_preferito_ordine(p, &ordine.data, "saldo");
                        if preferito.is_empty() {
                            conto.clone()
                        } else {
                            preferito
                        }
                    } else {
                        conto.clone()
                    };
                    let target = if aggiungi {
                        totale - coperto
                    } else {
                        totale - fisso_non_rateizzabile
                    };
                    if target <= 0 || somma_rate != target {
                        return Err(
                            "il residuo dell'ordine e' cambiato: aggiorna le rate e riprova".into(),
                        );
                    }
                    let data_sped = if da_spedizione {
                        ordine_data_spedizione(p, &ordine_for_batch)
                    } else {
                        String::new()
                    };
                    let mut mutations = ids
                        .into_iter()
                        .map(|id| Mutation::new("pagamento", id, EventBody::Purged))
                        .collect::<Vec<_>>();
                    for (idx, r) in rate.iter().enumerate() {
                        let id = Ulid::generate().to_string();
                        mutations.push(Mutation::new("pagamento", id.clone(), EventBody::Created));
                        let scadenza_effettiva = if da_spedizione && data_sped.is_empty() {
                            ""
                        } else {
                            r.scadenza.as_str()
                        };
                        let conto_rata = if idx == 0 {
                            conto.as_str()
                        } else {
                            conto_successive.as_str()
                        };
                        let mut campi: Vec<(&str, serde_json::Value)> = vec![
                            ("ordine_id", json!(ordine_for_batch)),
                            ("tipo", json!("rata")),
                            ("importo", json!(r.importo)),
                            ("saldato", json!(false)),
                            ("scadenza", json!(scadenza_effettiva)),
                            ("conto_id", json!(conto_rata)),
                            ("data", json!("")),
                            ("verificato", json!(false)),
                        ];
                        if da_spedizione {
                            let rel = match (anchor, iso_to_days(&r.scadenza)) {
                                (Some(a), Some(d)) => (d - a).max(0),
                                _ => 0,
                            };
                            campi.push(("scad_da_spedizione", json!(true)));
                            campi.push(("scad_rel_giorni", json!(rel)));
                        }
                        mutations.extend(campi.into_iter().map(|(field, value)| {
                            Mutation::new(
                                "pagamento",
                                id.clone(),
                                EventBody::FieldSet {
                                    field: field.to_string(),
                                    value,
                                },
                            )
                        }));
                    }
                    Ok(mutations)
                })
                .map_err(es)?;
            let data_sped = if da_spedizione {
                engine.with_projection(|p| ordine_data_spedizione(p, ordine_id))
            } else {
                String::new()
            };
            // Ordine già spedito: ancora subito le rate alla spedizione (la prima a +7gg, ecc.).
            // Vale anche se l'ordine è Spedito/Chiuso o ha già rate saldate (si aggiorna comunque
            // lo scadenzario, come richiesto), e poi si riverifica la chiusura per coerenza.
            if da_spedizione && !data_sped.is_empty() {
                riallinea_scadenze_da_spedizione(engine, ordine_id, &data_sped)?;
                prova_chiudi_ordine(engine, ordine_id, &data_giorni_fa(GIORNI_CHIUSURA))?;
            }
            Ok(())
        })
    }

    /// Riconcilia lo scadenzario col totale attuale dell'ordine.
    ///
    /// - i pagamenti gia' saldati non vengono mai modificati;
    /// - un acconto atteso segue l'acconto previsto sulla testata;
    /// - saldo/rate aperti conservano tipo, conto, scadenze e proporzioni;
    /// - se manca del tutto una parte aperta, crea solo l'atteso necessario.
    pub fn pagamenti_riallinea_aperti(&self, ordine_id: &str) -> AppResult<Vec<PagamentoDto>> {
        self.with_engine(|engine| {
            engine
                .emit_built_checked(|p| {
                    pianifica_riallineamento_pagamenti_aperti(p, ordine_id, None, None)
                })
                .map_err(es)?;

            // Il riallineamento può essere richiesto anche dall'editor di un ordine
            // già spedito: in quel caso le nuove rate relative vanno ancorate subito,
            // senza attendere un ulteriore evento di spedizione.
            let data_sped = engine.with_projection(|p| ordine_data_spedizione(p, ordine_id));
            riallinea_scadenze_da_spedizione(engine, ordine_id, &data_sped)?;

            Ok(engine.with_projection(|p| {
                let conti = conti_info(p);
                let distinte = distinte_accredito(p);
                let mut v: Vec<crate::projection::Record> = p
                    .list("pagamento")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "ordine_id") == ordine_id)
                    .collect();
                let chiave = |r: &crate::projection::Record| {
                    if bool_field(&r.data, "saldato") {
                        str_field(&r.data, "data")
                    } else {
                        str_field(&r.data, "scadenza")
                    }
                };
                v.sort_by(|a, b| {
                    chiave(a)
                        .cmp(&chiave(b))
                        .then(a.created_hlc.cmp(&b.created_hlc))
                });
                v.iter()
                    .map(|r| pagamento_dto(r, &conti, &distinte))
                    .collect()
            }))
        })
    }

    /// Imposta il conto **predefinito** per un ruolo (`incassi` | `accrediti`),
    /// togliendo il flag a tutti gli altri (universale: campo sul record `conto`).
    pub fn conto_predefinito_set(&self, conto_id: &str, ruolo: &str) -> AppResult<()> {
        let field = match ruolo {
            "accrediti" => "predefinito_accrediti",
            "acconti" => "predefinito_acconti",
            "rimborsi" => "predefinito_rimborsi",
            _ => "predefinito_incassi",
        };
        self.with_engine(|engine| {
            let conti: Vec<(String, bool)> = engine.with_projection(|p| {
                p.list("conto")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| (r.id.clone(), bool_field(&r.data, field)))
                    .collect()
            });
            for (id, attuale) in conti {
                let vuoi = id == conto_id;
                if attuale != vuoi {
                    set_fields(engine, "conto", &id, &[(field, json!(vuoi))])?;
                }
            }
            Ok(())
        })
    }

    // ---- Distinte corrieri (FASE 3C) ----

    /// Pagamenti su conto di **transito** (contrassegno/assegno) **non ancora accreditati**
    /// (`distinta_id` vuoto): candidati per una distinta corriere. Include sia i già
    /// `saldato` (incassati, in attesa di accredito) sia gli **attesi** (crediti in
    /// contrassegno/assegno che il bonifico del corriere salderà al momento della distinta).
    pub fn contrassegni_aperti(&self) -> AppResult<Vec<ContrassegnoApertoDto>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                contrassegni_dto(p, |r| str_field(&r.data, "distinta_id").is_empty())
            }))
        })
    }

    /// Pagamenti **coperti** da una distinta (per il dettaglio in elenco).
    pub fn distinta_righe(&self, distinta_id: &str) -> AppResult<Vec<ContrassegnoApertoDto>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                contrassegni_dto(p, |r| str_field(&r.data, "distinta_id") == distinta_id)
            }))
        })
    }

    /// Elenco delle distinte corrieri (nome corriere/conto + n. pagamenti coperti),
    /// dalla più recente.
    pub fn distinte_lista(&self) -> AppResult<Vec<DistintaDto>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let conti = conti_info(p);
                let corr_nomi = nome_map(p, "corriere");
                let mut n_pag: HashMap<String, usize> = HashMap::new();
                for r in p.list("pagamento").unwrap_or_default() {
                    let d = str_field(&r.data, "distinta_id");
                    if !d.is_empty() {
                        *n_pag.entry(d).or_default() += 1;
                    }
                }
                let mut out: Vec<DistintaDto> = p
                    .list("distinta")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| {
                        let conto_id = str_field(&r.data, "conto_id");
                        let corriere_id = str_field(&r.data, "corriere_id");
                        DistintaDto {
                            n_pagamenti: n_pag.get(&r.id).copied().unwrap_or(0),
                            corriere_nome: corr_nomi.get(&corriere_id).cloned().unwrap_or_default(),
                            data_distinta: str_field(&r.data, "data_distinta"),
                            data_accredito: str_field(&r.data, "data_accredito"),
                            importo: i64_field(&r.data, "importo"),
                            conto_nome: conti
                                .get(&conto_id)
                                .map(|(n, _, _)| n.clone())
                                .unwrap_or_default(),
                            conto_id,
                            corriere_id,
                            id: r.id,
                        }
                    })
                    .collect();
                // Più recenti in cima (accredito, poi data distinta, poi creazione).
                out.sort_by(|a, b| {
                    b.data_accredito
                        .cmp(&a.data_accredito)
                        .then(b.data_distinta.cmp(&a.data_distinta))
                });
                out
            }))
        })
    }

    /// Crea una distinta corriere. L'**importo** è quello realmente accreditato dal bonifico:
    /// si propone come somma dei pagamenti spuntati ma è **modificabile** (il corriere può
    /// trattenere commissioni); `importo <= 0` ricade sulla somma. Ogni pagamento coperto
    /// viene collegato (`distinta_id`) e **incassato**: `saldato = true` + `verificato = true`
    /// (l'accredito da bonifico è il riscontro in prima nota), così un credito atteso in
    /// contrassegno/assegno si salda proprio qui. La distinta conserva la **fotografia** del
    /// conto reale in `conto_id`. `corriere_id` può essere vuoto (versamento assegni).
    #[allow(clippy::too_many_arguments)]
    pub fn distinta_crea(
        &self,
        corriere_id: &str,
        data_distinta: &str,
        data_accredito: &str,
        conto_id: &str,
        importo: i64,
        pagamento_ids: Vec<String>,
        pagamenti_attesi: Option<Vec<PagamentoDistintaAtteso>>,
    ) -> AppResult<DistintaDto> {
        if pagamento_ids.is_empty() {
            return Err("selezionare almeno un pagamento da accreditare".into());
        }
        if conto_id.is_empty() {
            return Err("indicare il conto di accredito".into());
        }
        let mut ids_unici = HashSet::new();
        for id in &pagamento_ids {
            if !ids_unici.insert(id.clone()) {
                return Err("la selezione contiene lo stesso pagamento più volte".into());
            }
        }
        let attesi_by_id: HashMap<String, PagamentoDistintaAtteso> = pagamenti_attesi
            .unwrap_or_default()
            .into_iter()
            .map(|p| (p.id.clone(), p))
            .collect();
        if !attesi_by_id.is_empty() && attesi_by_id.len() != pagamento_ids.len() {
            return Err(
                "i pagamenti selezionati sono cambiati: aggiorna la distinta e riprova".into(),
            );
        }
        if !attesi_by_id.is_empty()
            && pagamento_ids
                .iter()
                .any(|id| !attesi_by_id.contains_key(id))
        {
            return Err(
                "i pagamenti selezionati sono cambiati: aggiorna la distinta e riprova".into(),
            );
        }
        self.with_engine(|engine| {
            let id = Ulid::generate().to_string();
            let id_for_batch = id.clone();
            let corriere_for_batch = corriere_id.to_string();
            let data_distinta_for_batch = data_distinta.to_string();
            let data_accredito_for_batch = data_accredito.to_string();
            let conto_for_batch = conto_id.to_string();
            let pagamento_ids_for_batch = pagamento_ids.clone();
            engine.emit_built_checked(move |p| {
                let conti = conti_info(p);
                let tipo_accredito = conti
                    .get(&conto_for_batch)
                    .map(|(_, tipo, _)| tipo.as_str())
                    .ok_or_else(|| "il conto di accredito non è più disponibile".to_string())?;
                if tipo_accredito == "contrassegno" || tipo_accredito == "assegno" {
                    return Err("il conto di accredito deve essere un conto reale, non un conto di transito".into());
                }
                if !corriere_for_batch.is_empty()
                    && p.get("corriere", &corriere_for_batch).map_err(|e| e.to_string())?.is_none()
                {
                    return Err("il corriere scelto non è più disponibile".into());
                }
                let ordini_attivi: HashSet<String> = p
                    .list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| r.id)
                    .collect();

                let mut pagamenti_correnti = Vec::with_capacity(pagamento_ids_for_batch.len());
                for pid in &pagamento_ids_for_batch {
                    let pagamento = p
                        .get("pagamento", pid)
                        .map_err(|e| e.to_string())?
                        .ok_or_else(|| "uno dei pagamenti selezionati non è più disponibile".to_string())?;
                    if !str_field(&pagamento.data, "distinta_id").is_empty() {
                        return Err("uno dei pagamenti selezionati è già stato accreditato da un'altra distinta".into());
                    }
                    let ordine_id = str_field(&pagamento.data, "ordine_id");
                    if ordine_id.is_empty() || !ordini_attivi.contains(&ordine_id) {
                        return Err("uno degli ordini collegati ai pagamenti non è più attivo".into());
                    }
                    let conto_pagamento = str_field(&pagamento.data, "conto_id");
                    let tipo_conto = conti
                        .get(&conto_pagamento)
                        .map(|(_, tipo, _)| tipo.as_str())
                        .unwrap_or_default();
                    if tipo_conto != "contrassegno" && tipo_conto != "assegno" {
                        return Err("uno dei pagamenti selezionati non è più su un conto contrassegno/assegno".into());
                    }
                    if let Some(atteso) = attesi_by_id.get(pid) {
                        if atteso.ordine_id != ordine_id
                            || atteso.importo != i64_field(&pagamento.data, "importo")
                            || atteso.conto_id != conto_pagamento
                            || atteso.conto_tipo != tipo_conto
                        {
                            return Err("uno dei pagamenti selezionati è cambiato: aggiorna la distinta e riprova".into());
                        }
                    }
                    pagamenti_correnti.push(pagamento);
                }
                let importo_effettivo = if importo > 0 {
                    importo
                } else {
                    pagamenti_correnti
                        .iter()
                        .map(|r| i64_field(&r.data, "importo"))
                        .sum()
                };
                let data_incasso = if !data_accredito_for_batch.is_empty() {
                    data_accredito_for_batch.as_str()
                } else {
                    data_distinta_for_batch.as_str()
                };
                let mut mutations = vec![Mutation::new(
                    "distinta",
                    id_for_batch.clone(),
                    EventBody::Created,
                )];
                for (field, value) in [
                    ("corriere_id", json!(corriere_for_batch)),
                    ("data_distinta", json!(data_distinta_for_batch)),
                    ("data_accredito", json!(data_accredito_for_batch)),
                    ("importo", json!(importo_effettivo)),
                    ("conto_id", json!(conto_for_batch)),
                ] {
                    mutations.push(Mutation::new(
                        "distinta",
                        id_for_batch.clone(),
                        EventBody::FieldSet {
                            field: field.to_string(),
                            value,
                        },
                    ));
                }
                for pagamento in pagamenti_correnti {
                    let pid = pagamento.id.clone();
                    let data_precedente = str_field(&pagamento.data, "data");
                    let mut campi = vec![
                        ("distinta_id", json!(id_for_batch)),
                        ("saldato", json!(true)),
                        ("verificato", json!(true)),
                        (
                            "distinta_pre_saldato",
                            json!(bool_field(&pagamento.data, "saldato")),
                        ),
                        ("distinta_pre_data", json!(data_precedente)),
                        (
                            "distinta_pre_verificato",
                            json!(bool_field(&pagamento.data, "verificato")),
                        ),
                    ];
                    if data_precedente.is_empty() {
                        campi.push(("data", json!(data_incasso)));
                    }
                    mutations.extend(campi.into_iter().map(|(field, value)| {
                        Mutation::new(
                            "pagamento",
                            pid.clone(),
                            EventBody::FieldSet {
                                field: field.to_string(),
                                value,
                            },
                        )
                    }));
                }
                Ok(mutations)
            }).map_err(es)?;

            // Il collegamento e l'incasso dei pagamenti sono già nello stesso batch.
            // Le automazioni successive derivano gli ordini dallo stato appena applicato.
            let ordini: Vec<String> = engine.with_projection(|p| {
                pagamento_ids
                    .iter()
                    .filter_map(|id| p.get("pagamento", id).ok().flatten())
                    .map(|r| str_field(&r.data, "ordine_id"))
                    .filter(|o| !o.is_empty())
                    .collect()
            });
            // Gli ordini coinvolti possono passare a Confermato e ripulire gli attesi residui.
            let soglia_chiusura = data_giorni_fa(GIORNI_CHIUSURA);
            let mut visti = std::collections::HashSet::new();
            for oid in ordini {
                if visti.insert(oid.clone()) {
                    conferma_se_nuovo(engine, &oid)?;
                    pulisci_attesi_se_saldato(engine, &oid)?;
                    prova_chiudi_ordine(engine, &oid, &soglia_chiusura)?;
                }
            }
            engine
                .with_projection(|p| {
                    let conti = conti_info(p);
                    let corr_nomi = nome_map(p, "corriere");
                    p.get("distinta", &id).ok().flatten().map(|r| {
                        let conto_id = str_field(&r.data, "conto_id");
                        let corriere_id = str_field(&r.data, "corriere_id");
                        DistintaDto {
                            n_pagamenti: pagamento_ids.len(),
                            corriere_nome: corr_nomi.get(&corriere_id).cloned().unwrap_or_default(),
                            data_distinta: str_field(&r.data, "data_distinta"),
                            data_accredito: str_field(&r.data, "data_accredito"),
                            importo: i64_field(&r.data, "importo"),
                            conto_nome: conti
                                .get(&conto_id)
                                .map(|(n, _, _)| n.clone())
                                .unwrap_or_default(),
                            conto_id,
                            corriere_id,
                            id: r.id,
                        }
                    })
                })
                .ok_or_else(|| "distinta non trovata dopo la creazione".to_string())
        })
    }

    /// Elimina una distinta: **scollega** i pagamenti coperti (tornano
    /// `in_attesa_accredito`) e soft-delete della distinta.
    pub fn distinta_elimina(&self, id: &str) -> AppResult<()> {
        self.with_engine(|engine| {
            engine
                .emit_built_checked(|p| {
                    let distinta = p
                        .get("distinta", id)
                        .map_err(|error| error.to_string())?
                        .ok_or_else(|| "distinta non più disponibile".to_string())?;
                    if distinta.deleted {
                        return Err("la distinta è già stata eliminata".into());
                    }
                    let mut mutations = Vec::new();
                    for pagamento in p
                        .list("pagamento")
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|record| str_field(&record.data, "distinta_id") == id)
                    {
                        let ha_snapshot = pagamento.data.contains_key("distinta_pre_saldato");
                        // Le distinte nuove conservano lo snapshot esatto. Per quelle
                        // storiche ricadiamo sulla data della spedizione.
                        let data_spedizione =
                            ordine_data_spedizione(p, &str_field(&pagamento.data, "ordine_id"));
                        let saldato = if ha_snapshot {
                            bool_field(&pagamento.data, "distinta_pre_saldato")
                        } else {
                            !data_spedizione.is_empty()
                        };
                        let data = if ha_snapshot {
                            str_field(&pagamento.data, "distinta_pre_data")
                        } else {
                            data_spedizione
                        };
                        let verificato =
                            ha_snapshot && bool_field(&pagamento.data, "distinta_pre_verificato");
                        for (field, value) in [
                            ("distinta_id", json!("")),
                            ("saldato", json!(saldato)),
                            ("data", json!(data)),
                            ("verificato", json!(verificato)),
                            ("distinta_pre_saldato", json!(false)),
                            ("distinta_pre_data", json!("")),
                            ("distinta_pre_verificato", json!(false)),
                        ] {
                            mutations.push(Mutation::new(
                                "pagamento",
                                pagamento.id.clone(),
                                EventBody::FieldSet {
                                    field: field.to_string(),
                                    value,
                                },
                            ));
                        }
                    }
                    mutations.push(Mutation::new("distinta", id, EventBody::Deleted));
                    Ok(mutations)
                })
                .map_err(es)?;
            Ok(())
        })
    }

    // ---- Rimborsi (FASE 3D) ----

    /// Elenco dei rimborsi (dal più recente). `stato` opzionale (`richiesto | effettuato`)
    /// filtra per stato derivato; i filtri ricchi (periodo/origine) arrivano in 3E e per
    /// ora si applicano lato UI.
    pub fn rimborsi_lista(&self, stato: Option<String>) -> AppResult<Vec<RimborsoDto>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let conti = conti_info(p);
                let numeri = numeri_ordini(p);
                let clienti = clienti_ordini(p);
                let filtro = stato.filter(|s| !s.is_empty());
                let mut out: Vec<RimborsoDto> = p
                    .list("rimborso")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| rimborso_dto(&r, &conti, &numeri, &clienti))
                    .filter(|d| filtro.as_deref().map(|s| s == d.stato).unwrap_or(true))
                    .collect();
                // Più recenti in cima: per data richiesta, poi creazione (ULID nell'id).
                out.sort_by(|a, b| {
                    b.data_richiesta
                        .cmp(&a.data_richiesta)
                        .then(b.id.cmp(&a.id))
                });
                out
            }))
        })
    }

    /// Crea o aggiorna un rimborso. `id` vuoto → crea (ULID nuovo). Restituisce il
    /// rimborso risultante. Non tocca pagamenti né ordini (flusso in uscita separato).
    #[allow(clippy::too_many_arguments)]
    pub fn rimborso_salva(
        &self,
        id: &str,
        data_richiesta: &str,
        importo: i64,
        ragione_sociale: &str,
        motivo: &str,
        iban: &str,
        conto_id: &str,
        data_rimborso: &str,
        note: &str,
        ordine_id: &str,
        origine: &str,
    ) -> AppResult<RimborsoDto> {
        if importo <= 0 {
            return Err("importo rimborso non valido".into());
        }
        if !data_rimborso.is_empty() && conto_id.is_empty() {
            return Err("indicare il conto del rimborso effettuato".into());
        }
        let nuovo = id.is_empty();
        let id = if nuovo {
            Ulid::generate().to_string()
        } else {
            id.to_string()
        };
        let origine = if origine.is_empty() {
            "manuale".to_string()
        } else {
            origine.to_string()
        };
        let ordine_id = ordine_id.to_string();
        let conto_id = conto_id.to_string();
        let fields = [
            ("data_richiesta", json!(data_richiesta)),
            ("importo", json!(importo)),
            ("ragione_sociale", json!(ragione_sociale)),
            ("motivo", json!(motivo)),
            ("iban", json!(iban)),
            ("conto_id", json!(conto_id)),
            ("data_rimborso", json!(data_rimborso)),
            ("note", json!(note)),
            ("ordine_id", json!(ordine_id)),
            ("origine", json!(origine)),
        ];
        self.with_engine(|engine| {
            let id_batch = id.clone();
            engine
                .emit_built_checked(move |p| {
                    if nuovo {
                        if p.get("rimborso", &id_batch)
                            .map_err(|error| error.to_string())?
                            .is_some()
                        {
                            return Err("l'identificativo del nuovo rimborso esiste già".into());
                        }
                    } else if p
                        .get("rimborso", &id_batch)
                        .map_err(|error| error.to_string())?
                        .is_none()
                    {
                        return Err("rimborso non piu disponibile".into());
                    }
                    if !conto_id.is_empty()
                        && p.get("conto", &conto_id)
                            .map_err(|error| error.to_string())?
                            .is_none()
                    {
                        return Err("il conto selezionato non e' piu disponibile".into());
                    }
                    if origine == "extra" {
                        if ordine_id.is_empty() {
                            return Err("rimborso extra senza ordine collegato".into());
                        }
                        let ordine = p
                            .get("ordine", &ordine_id)
                            .map_err(|error| error.to_string())?
                            .ok_or_else(|| {
                                "ordine collegato al rimborso non piu disponibile".to_string()
                            })?;
                        if str_field(&ordine.data, "stato") == "Rifiutato" {
                            return Err("l'ordine collegato al rimborso non e' piu valido".into());
                        }
                        let totale = *totali_ordini(p).get(&ordine_id).unwrap_or(&0);
                        let transito = conti_transito(p);
                        let incassato = pagamenti_per_ordine(p, &transito)
                            .get(&ordine_id)
                            .map(|a| a.incassato)
                            .unwrap_or(0);
                        if incassato - totale < importo {
                            return Err(
                                "l'eccedenza dell'ordine e' cambiata: aggiorna il rimborso".into(),
                            );
                        }
                    }

                    let mut mutations = Vec::with_capacity(fields.len() + usize::from(nuovo));
                    if nuovo {
                        mutations.push(Mutation::new(
                            "rimborso",
                            id_batch.clone(),
                            EventBody::Created,
                        ));
                    }
                    mutations.extend(fields.into_iter().map(|(field, value)| {
                        Mutation::new(
                            "rimborso",
                            id_batch.clone(),
                            EventBody::FieldSet {
                                field: field.to_string(),
                                value,
                            },
                        )
                    }));
                    Ok(mutations)
                })
                .map_err(es)?;
            engine
                .with_projection(|p| {
                    let conti = conti_info(p);
                    let numeri = numeri_ordini(p);
                    let clienti = clienti_ordini(p);
                    p.get("rimborso", &id)
                        .ok()
                        .flatten()
                        .map(|r| rimborso_dto(&r, &conti, &numeri, &clienti))
                })
                .ok_or_else(|| "rimborso non trovato dopo il salvataggio".to_string())
        })
    }

    /// Marca un rimborso come **effettuato**: valorizza `data_rimborso` (e il conto di
    /// uscita, se indicato). Restituisce il rimborso aggiornato.
    pub fn rimborso_segna_effettuato(
        &self,
        id: &str,
        data_rimborso: &str,
        conto_id: &str,
    ) -> AppResult<RimborsoDto> {
        if data_rimborso.is_empty() {
            return Err("indicare la data del rimborso".into());
        }
        self.with_engine(|engine| {
            engine.with_projection(|p| -> AppResult<()> {
                let rimborso = p
                    .get("rimborso", id)
                    .map_err(es)?
                    .ok_or_else(|| "rimborso non trovato".to_string())?;
                if !str_field(&rimborso.data, "data_rimborso").is_empty() {
                    return Err("rimborso gia segnato come effettuato".into());
                }
                let conto_eff = if conto_id.is_empty() {
                    str_field(&rimborso.data, "conto_id")
                } else {
                    conto_id.to_string()
                };
                if conto_eff.is_empty() || p.get("conto", &conto_eff).map_err(es)?.is_none() {
                    return Err("il conto del rimborso non e' piu disponibile".into());
                }
                Ok(())
            })?;
            let mut fields: Vec<(&str, serde_json::Value)> =
                vec![("data_rimborso", json!(data_rimborso))];
            if !conto_id.is_empty() {
                fields.push(("conto_id", json!(conto_id)));
            }
            set_fields(engine, "rimborso", id, &fields)?;
            engine
                .with_projection(|p| {
                    let conti = conti_info(p);
                    let numeri = numeri_ordini(p);
                    let clienti = clienti_ordini(p);
                    p.get("rimborso", id)
                        .ok()
                        .flatten()
                        .map(|r| rimborso_dto(&r, &conti, &numeri, &clienti))
                })
                .ok_or_else(|| "rimborso non trovato".to_string())
        })
    }

    /// Pre-compila un rimborso **extra** da un ordine pagato in eccesso: importo =
    /// `incassato − totale` (0 se non c'è eccesso), ragione sociale/IBAN dal cliente.
    pub fn rimborso_extra_precompila(&self, ordine_id: &str) -> AppResult<RimborsoExtraDto> {
        self.with_engine(|engine| {
            engine
                .with_projection(|p| {
                    let ordine = p.get("ordine", ordine_id).ok().flatten()?;
                    let totale = totali_ordini(p).get(ordine_id).copied().unwrap_or(0);
                    let transito = conti_transito(p);
                    let incassato = pagamenti_per_ordine(p, &transito)
                        .get(ordine_id)
                        .map(|a| a.incassato)
                        .unwrap_or(0);
                    let cliente_id = str_field(&ordine.data, "cliente_id");
                    let (ragione_sociale, iban) = p
                        .get("cliente", &cliente_id)
                        .ok()
                        .flatten()
                        .map(|c| (str_field(&c.data, "nome"), str_field(&c.data, "iban")))
                        .unwrap_or_default();
                    Some(RimborsoExtraDto {
                        ordine_numero: numeri_ordini(p).get(ordine_id).cloned().unwrap_or_default(),
                        ordine_id: ordine_id.to_string(),
                        importo: (incassato - totale).max(0),
                        ragione_sociale,
                        iban,
                    })
                })
                .ok_or_else(|| "ordine non trovato".to_string())
        })
    }
}

fn sette_giorni_dopo(vecchia: &str, nuova: &str) -> bool {
    match (
        giorni_civili_pagamento(vecchia),
        giorni_civili_pagamento(nuova),
    ) {
        (Some(vecchia), Some(nuova)) => nuova - vecchia == 7,
        _ => false,
    }
}

fn giorni_civili_pagamento(iso: &str) -> Option<i64> {
    let mut parti = iso.split('-');
    let anno: i64 = parti.next()?.parse().ok()?;
    let mese: i64 = parti.next()?.parse().ok()?;
    let giorno: i64 = parti.next()?.parse().ok()?;
    if parti.next().is_some() || !(1..=12).contains(&mese) || !(1..=31).contains(&giorno) {
        return None;
    }
    let anno = if mese <= 2 { anno - 1 } else { anno };
    let era = if anno >= 0 { anno } else { anno - 399 } / 400;
    let anno_era = anno - era * 400;
    let giorno_anno = (153 * (if mese > 2 { mese - 3 } else { mese + 9 }) + 2) / 5 + giorno - 1;
    let giorno_era = anno_era * 365 + anno_era / 4 - anno_era / 100 + giorno_anno;
    Some(era * 146097 + giorno_era - 719468)
}
