use super::*;

pub(super) struct SpedizioneCreateParams<'a> {
    pub data: &'a str,
    pub corriere_id: &'a str,
    pub colli: i64,
    pub peso: i64,
    pub servizi: &'a str,
    pub preavviso: bool,
    pub mezzo: &'a str,
    pub contrassegno: i64,
    pub note: &'a str,
    pub righe: &'a [RigaNumeroIn],
}

/// Allinea lo scadenzario aperto al pagamento scelto per la consegna.
///
/// La prima voce diventa il contrassegno/assegno del collo; l'eventuale residuo
/// resta sulle altre rate, mantenendone numero e proporzioni. Se esisteva un solo
/// saldo, viene creata una rata ordinaria per il resto. La somma aperta non cambia.
fn pianifica_pagamenti_alla_consegna(
    projection: &crate::projection::Projection,
    params: &SpedizioneCreateParams<'_>,
    spedizione_id: &str,
) -> Result<Vec<Mutation>, String> {
    let conto_transito = match params.mezzo {
        "contrassegno" => CONTO_CONTRASSEGNO,
        "assegno" => CONTO_ASSEGNO,
        _ => return Ok(Vec::new()),
    };
    let importo_consegna = params.contrassegno.max(0);
    if importo_consegna == 0 {
        return Ok(Vec::new());
    }

    let mut ordini_ids = Vec::new();
    for numero in params.righe {
        let riga = projection
            .get("riga_ordine", &numero.riga_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "una delle righe selezionate non è più disponibile".to_string())?;
        let ordine_id = str_field(&riga.data, "ordine_id");
        if !ordine_id.is_empty() && !ordini_ids.contains(&ordine_id) {
            ordini_ids.push(ordine_id);
        }
    }

    struct PianoOrdine {
        ordine_id: String,
        conto_ordinario: String,
        pagamenti: Vec<crate::projection::Record>,
        totale: i64,
    }

    let conti = conti_info(projection);
    let mut piani = Vec::new();
    for ordine_id in ordini_ids {
        let ordine = projection
            .get("ordine", &ordine_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "uno degli ordini selezionati non è più disponibile".to_string())?;
        let mut pagamenti: Vec<_> = projection
            .list("pagamento")
            .unwrap_or_default()
            .into_iter()
            .filter(|pagamento| {
                str_field(&pagamento.data, "ordine_id") == ordine_id
                    && !bool_field(&pagamento.data, "saldato")
                    && matches!(
                        str_field(&pagamento.data, "tipo").as_str(),
                        "acconto" | "saldo" | "rata"
                    )
            })
            .collect();
        pagamenti.sort_by(|a, b| {
            let a_sid = str_field(&a.data, "spedizione_id");
            let b_sid = str_field(&b.data, "spedizione_id");
            let a_matches = a_sid == spedizione_id;
            let b_matches = b_sid == spedizione_id;
            let a_other = !a_sid.is_empty() && !a_matches;
            let b_other = !b_sid.is_empty() && !b_matches;
            let a_transit = str_field(&a.data, "conto_id") == conto_transito;
            let b_transit = str_field(&b.data, "conto_id") == conto_transito;
            b_matches
                .cmp(&a_matches)
                .then(a_other.cmp(&b_other))
                .then(b_transit.cmp(&a_transit))
                .then_with(|| {
                    let data_a = str_field(&a.data, "scadenza");
                    let data_b = str_field(&b.data, "scadenza");
                    (if data_a.is_empty() {
                        "9999-12-31"
                    } else {
                        data_a.as_str()
                    })
                    .cmp(if data_b.is_empty() {
                        "9999-12-31"
                    } else {
                        data_b.as_str()
                    })
                    .then(a.created_hlc.cmp(&b.created_hlc))
                })
        });
        let totale = pagamenti
            .iter()
            .map(|pagamento| i64_field(&pagamento.data, "importo").max(0))
            .sum();
        if totale <= 0 {
            continue;
        }

        let preferito = conto_preferito_ordine(projection, &ordine.data, "saldo");
        let conto_ordinario = if conti
            .get(&preferito)
            .is_some_and(|(_, tipo, _)| !matches!(tipo.as_str(), "contrassegno" | "assegno"))
        {
            preferito
        } else {
            projection
                .list("conto")
                .unwrap_or_default()
                .into_iter()
                .find(|conto| {
                    !matches!(
                        str_field(&conto.data, "tipo").as_str(),
                        "contrassegno" | "assegno"
                    )
                })
                .map(|conto| conto.id)
                .unwrap_or(preferito)
        };
        piani.push(PianoOrdine {
            ordine_id,
            conto_ordinario,
            pagamenti,
            totale,
        });
    }

    let totale_aperto: i64 = piani.iter().map(|piano| piano.totale).sum();
    if totale_aperto <= 0 {
        return Ok(Vec::new());
    }
    let importo_da_allineare = importo_consegna.min(totale_aperto);
    let quote_ordini = ripartisci_importo_proporzionale(
        importo_da_allineare,
        &piani.iter().map(|piano| piano.totale).collect::<Vec<_>>(),
    );
    let mut mutations = Vec::new();

    for (piano, quota_consegna) in piani.into_iter().zip(quote_ordini) {
        if quota_consegna <= 0 {
            continue;
        }
        let residuo = piano.totale - quota_consegna;
        let primo = &piano.pagamenti[0];
        let importo_primo_originale = i64_field(&primo.data, "importo");
        for (field, value) in [
            ("conto_id", json!(conto_transito)),
            ("importo", json!(quota_consegna)),
            ("scadenza", json!(aggiungi_giorni_iso(params.data, 30))),
            ("scad_da_spedizione", json!(true)),
            ("scad_rel_giorni", json!(0)),
            ("spedizione_id", json!(spedizione_id)),
        ] {
            mutations.push(Mutation::new(
                "pagamento",
                primo.id.clone(),
                EventBody::FieldSet {
                    field: field.to_string(),
                    value,
                },
            ));
        }

        // Se la quota corrisponde esattamente alla rata individuata, le altre rate non vanno toccate
        if quota_consegna == importo_primo_originale && residuo > 0 {
            continue;
        }

        let successive = &piano.pagamenti[1..];
        if residuo <= 0 {
            // Elimina solo rate non vincolate ad altre spedizioni
            mutations.extend(
                successive
                    .iter()
                    .filter(|p| str_field(&p.data, "spedizione_id").is_empty())
                    .map(|pagamento| {
                        Mutation::new("pagamento", pagamento.id.clone(), EventBody::Purged)
                    }),
            );
            continue;
        }

        if successive.is_empty() {
            let id = Ulid::generate().to_string();
            mutations.push(Mutation::new("pagamento", id.clone(), EventBody::Created));
            for (field, value) in [
                ("ordine_id", json!(piano.ordine_id)),
                ("tipo", json!("rata")),
                ("importo", json!(residuo)),
                ("saldato", json!(false)),
                ("scadenza", json!(aggiungi_giorni_iso(params.data, 7))),
                ("conto_id", json!(piano.conto_ordinario)),
                ("data", json!("")),
                ("verificato", json!(false)),
                ("scad_da_spedizione", json!(true)),
                ("scad_rel_giorni", json!(0)),
            ] {
                mutations.push(Mutation::new(
                    "pagamento",
                    id.clone(),
                    EventBody::FieldSet {
                        field: field.to_string(),
                        value,
                    },
                ));
            }
            continue;
        }

        // Ripartisce residuo solo sulle rate non vincolate ad altre spedizioni
        let non_vincolate: Vec<_> = successive
            .iter()
            .filter(|p| str_field(&p.data, "spedizione_id").is_empty())
            .collect();
        if non_vincolate.is_empty() {
            continue;
        }

        let quote_successive = ripartisci_importo_proporzionale(
            residuo,
            &non_vincolate
                .iter()
                .map(|pagamento| i64_field(&pagamento.data, "importo").max(0))
                .collect::<Vec<_>>(),
        );
        for (pagamento, importo) in non_vincolate.into_iter().zip(quote_successive) {
            if importo <= 0 {
                mutations.push(Mutation::new(
                    "pagamento",
                    pagamento.id.clone(),
                    EventBody::Purged,
                ));
                continue;
            }
            mutations.push(Mutation::new(
                "pagamento",
                pagamento.id.clone(),
                EventBody::FieldSet {
                    field: "importo".into(),
                    value: json!(importo),
                },
            ));
            let conto_corrente = str_field(&pagamento.data, "conto_id");
            if conti
                .get(&conto_corrente)
                .is_some_and(|(_, tipo, _)| matches!(tipo.as_str(), "contrassegno" | "assegno"))
            {
                mutations.push(Mutation::new(
                    "pagamento",
                    pagamento.id.clone(),
                    EventBody::FieldSet {
                        field: "conto_id".into(),
                        value: json!(piano.conto_ordinario),
                    },
                ));
            }
        }
    }

    Ok(mutations)
}

/// Unica costruzione delle mutazioni di un collo: il flusso manuale e la bollettazione
/// condividono validazioni e campi, mentre il chiamante decide se emettere un collo singolo
/// o un intero batch atomico.
pub(super) fn prepara_spedizione_mutations(
    projection: &crate::projection::Projection,
    id: &str,
    lotto: &str,
    params: &SpedizioneCreateParams<'_>,
) -> Result<Vec<Mutation>, String> {
    let corriere = if params.corriere_id.is_empty() {
        None
    } else {
        Some(
            projection
                .get("corriere", params.corriere_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "il corriere scelto non è più disponibile".to_string())?,
        )
    };
    let mut righe_immunoterapia = HashSet::new();
    for row_number in params.righe {
        let row = projection
            .get("riga_ordine", &row_number.riga_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "una delle righe selezionate non è più disponibile".to_string())?;
        if !str_field(&row.data, "spedizione_id").is_empty()
            || str_field(&row.data, "stato_riga") == "spedita"
        {
            return Err(
                "una delle righe selezionate risulta gia spedita: aggiorna la lista e riprova"
                    .into(),
            );
        }
        let order_id = str_field(&row.data, "ordine_id");
        if order_id.is_empty() {
            return Err("una delle righe selezionate non è più collegata a un ordine".into());
        }
        let order = projection
            .get("ordine", &order_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "uno degli ordini selezionati non è più disponibile".to_string())?;
        if matches!(
            str_field(&order.data, "stato").as_str(),
            "Rifiutato" | "Annullato"
        ) {
            return Err("uno degli ordini selezionati non è più spedibile".into());
        }
        let categoria = str_field(&order.data, "categoria");
        // Compatibilità con gli ordini storici, creati prima del campo categoria:
        // in archivio erano tutti Immunoterapia.
        if categoria.is_empty() || categoria.eq_ignore_ascii_case("Immunoterapia") {
            valida_numeri_lotto(i64_field(&row.data, "qta"), &row_number.numero)?;
            righe_immunoterapia.insert(row_number.riga_id.clone());
        }
    }
    let corriere_a = corriere.is_some_and(|record| {
        profilo_corriere(
            &str_field(&record.data, "nome"),
            &str_field(&record.data, "profilo"),
        ) == "corriere_a"
    });
    let mut mutations = vec![Mutation::new("spedizione", id, EventBody::Created)];
    for (field, value) in [
        ("lotto", json!(lotto)),
        ("data", json!(params.data)),
        ("corriere_id", json!(params.corriere_id)),
        ("numero", json!("")),
        (
            "colli",
            json!(if corriere_a || righe_immunoterapia.is_empty() {
                1
            } else {
                params.colli
            }),
        ),
        ("peso", json!(if corriere_a { 1 } else { params.peso })),
        ("servizi", json!(params.servizi)),
        ("preavviso", json!(params.preavviso)),
        ("mezzo", json!(params.mezzo)),
        ("contrassegno", json!(params.contrassegno)),
        ("note", json!(params.note)),
    ] {
        mutations.push(Mutation::new(
            "spedizione",
            id,
            EventBody::FieldSet {
                field: field.to_string(),
                value,
            },
        ));
    }
    for row_number in params.righe {
        for (field, value) in [
            ("stato_riga", json!("spedita")),
            ("spedizione_id", json!(id)),
            (
                "numero",
                json!(if righe_immunoterapia.contains(&row_number.riga_id) {
                    row_number.numero.trim()
                } else {
                    ""
                }),
            ),
        ] {
            mutations.push(Mutation::new(
                "riga_ordine",
                row_number.riga_id.clone(),
                EventBody::FieldSet {
                    field: field.to_string(),
                    value,
                },
            ));
        }
    }
    mutations.extend(pianifica_pagamenti_alla_consegna(projection, params, id)?);
    Ok(mutations)
}

impl AppState {
    // ---- Spedizioni (FASE 4) ----

    /// Ordini con almeno una riga ancora **da spedire** (esclusi i Rifiutati), con i
    /// dati di destinazione del cliente + medico/agente + residuo. Le righe già spedite
    /// non compaiono. **Ordine di default**: prima i pronti (Confermato/In produzione/…),
    /// i `Nuovo` per ultimi; a parità, i **più vecchi** prima (poi per numero).
    pub fn righe_da_spedire(&self) -> AppResult<Vec<OrdineDaSpedireDto>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let numeri = numeri_ordini(p);
                let prodotti = nome_map(p, "prodotto");
                let medici = nome_map(p, "medico");
                let agenti = nome_map(p, "agente");
                let totali = totali_ordini(p);
                let transito = conti_transito(p);
                let pagamenti = pagamenti_per_ordine(p, &transito);
                let cod = cod_atteso_per_ordine(p);
                let righe_totali = righe_count_ordini(p);
                // Dati cliente completi (indirizzo) per la destinazione. Per gli ordini
                // Diagnostica (senza cliente) il destinatario è il medico stesso. FASE 4D.
                let clienti = dati_map(p, "cliente");
                let medici_dati = dati_map(p, "medico");
                // Ordini validi: id -> dati testata utili.
                let ordini: HashMap<String, serde_json::Map<String, serde_json::Value>> = p
                    .list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "stato") != "Rifiutato")
                    .map(|r| (r.id, r.data))
                    .collect();

                let mut per_ordine: HashMap<String, Vec<RigaDaSpedireDto>> = HashMap::new();
                for r in p.list("riga_ordine").unwrap_or_default() {
                    if riga_spedita(&r.data) {
                        continue;
                    }
                    let oid = str_field(&r.data, "ordine_id");
                    if !ordini.contains_key(&oid) {
                        continue;
                    }
                    let prodotto_id = str_field(&r.data, "prodotto_id");
                    per_ordine.entry(oid).or_default().push(RigaDaSpedireDto {
                        prodotto_nome: nome_riga_prodotto(&prodotti, &prodotto_id, &r.data),
                        prodotto_id,
                        qta: i64_field(&r.data, "qta"),
                        prezzo: i64_field(&r.data, "prezzo"),
                        paziente: str_field(&r.data, "paziente"),
                        numero: str_field(&r.data, "numero"),
                        riga_id: r.id,
                    });
                }

                let mut out: Vec<OrdineDaSpedireDto> = per_ordine
                    .into_iter()
                    .filter_map(|(oid, righe)| {
                        let od = ordini.get(&oid)?;
                        let cliente_id = str_field(od, "cliente_id");
                        let medico_id = str_field(od, "medico_id");
                        // Destinatario: il cliente; in mancanza (Diagnostica) il medico.
                        let cli = clienti
                            .get(&cliente_id)
                            .or_else(|| medici_dati.get(&medico_id));
                        let cf = |k: &str| cli.map(|c| str_field(c, k)).unwrap_or_default();
                        let colli_over = i64_field(od, "colli");
                        let righe_rimaste = righe.len() as i64;
                        let righe_totali_ordine =
                            righe_totali.get(&oid).copied().unwrap_or(righe_rimaste);
                        let colli = if colli_over > 0 && righe_rimaste == righe_totali_ordine {
                            colli_over
                        } else {
                            righe_rimaste
                        };
                        let totale = *totali.get(&oid).unwrap_or(&0);
                        let incassato = pagamenti.get(&oid).map(|a| a.incassato).unwrap_or(0);
                        let (cod_mezzo, cod_importo) = cod.get(&oid).cloned().unwrap_or_default();
                        Some(OrdineDaSpedireDto {
                            numero: numeri.get(&oid).cloned().unwrap_or_default(),
                            data: str_field(od, "data"),
                            stato: str_field(od, "stato"),
                            cliente_nome: cf("nome"),
                            medico_nome: medici.get(&medico_id).cloned().unwrap_or_default(),
                            agente_nome: agenti
                                .get(&str_field(od, "agente_id"))
                                .cloned()
                                .unwrap_or_default(),
                            indirizzo: cf("indirizzo"),
                            cap: cf("cap"),
                            citta: cf("citta"),
                            prov: cf("prov"),
                            regione: cf("regione"),
                            telefono: cf("telefono"),
                            email: cf("email"),
                            residuo: totale - incassato,
                            acconto: i64_field(od, "acconto"),
                            cod_mezzo,
                            cod_importo,
                            note_spedizione: cf("note_spedizione"),
                            cliente_id,
                            colli,
                            categoria: str_field(od, "categoria"),
                            data_produzione: str_field(od, "data_produzione"),
                            righe,
                            ordine_id: oid,
                        })
                    })
                    .collect();
                // Ordine di default: prima gli «In produzione», poi i «Confermato», quindi il
                // resto e i «Nuovo» in fondo; dentro ogni gruppo dal più vecchio al più nuovo
                // per data di produzione (chi non l'ha cade sulla data ordine), poi per numero.
                let rank = |s: &str| match s {
                    "In produzione" => 0,
                    "Confermato" => 1,
                    "Arrivato IT" => 2,
                    "Nuovo" => 4,
                    _ => 3,
                };
                let chiave_data = |o: &OrdineDaSpedireDto| {
                    if o.data_produzione.is_empty() {
                        o.data.clone()
                    } else {
                        o.data_produzione.clone()
                    }
                };
                out.sort_by(|a, b| {
                    rank(&a.stato)
                        .cmp(&rank(&b.stato))
                        .then(chiave_data(a).cmp(&chiave_data(b)))
                        .then(a.numero.cmp(&b.numero))
                });
                out
            }))
        })
    }

    pub(super) fn fondi_numeri(nums: &[String]) -> String {
        let nums: Vec<String> = nums
            .iter()
            .flat_map(|numero| numero.lines())
            .map(str::trim)
            .filter(|numero| !numero.is_empty())
            .map(str::to_string)
            .collect();
        if nums.is_empty() {
            return String::new();
        }
        if nums.len() == 1 {
            return nums[0].clone();
        }
        let mut prefisso = nums[0].clone();
        for num in nums.iter().skip(1) {
            let mut len = 0;
            for (c1, c2) in prefisso.chars().zip(num.chars()) {
                if c1 == c2 {
                    len += c1.len_utf8();
                } else {
                    break;
                }
            }
            prefisso.truncate(len);
        }
        let mut ris = nums[0].clone();
        let pref_len = prefisso.len();
        for num in nums.iter().skip(1) {
            ris.push('/');
            if pref_len > 0 && num.len() > pref_len {
                ris.push_str(&num[pref_len..]);
            } else {
                ris.push_str(num);
            }
        }
        ris
    }

    /// Elenco delle spedizioni **effettuate** (dalla più recente), con le righe incluse
    /// raggruppate (anche di più ordini dello stesso cliente).
    pub fn spedizioni_lista(&self) -> AppResult<Vec<SpedizioneDto>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let numeri = numeri_ordini(p);
                let prodotti = nome_map(p, "prodotto");
                let corrieri = nome_map(p, "corriere");
                let ordini_records = p.list("ordine").unwrap_or_default();
                let righe_records = p.list("riga_ordine").unwrap_or_default();
                let pagamenti_records = p.list("pagamento").unwrap_or_default();
                let spedizioni_records = p.list("spedizione").unwrap_or_default();
                let corrieri_profilo: HashMap<String, String> = p
                    .list("corriere")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| {
                        let prof = profilo_corriere(
                            &str_field(&r.data, "nome"),
                            &str_field(&r.data, "profilo"),
                        );
                        (r.id, prof)
                    })
                    .collect();
                let clienti = nome_map(p, "cliente");
                let medici = nome_map(p, "medico");
                let agenti = nome_map(p, "agente");
                // Dati completi (indirizzo) per l'info collo: cliente, o medico se l'ordine
                // è Diagnostica (destinatario = medico). FASE 4D.
                let clienti_dati = dati_map(p, "cliente");
                let medici_dati = dati_map(p, "medico");
                // ordine_id -> (cliente_id, medico_id, agente_id).
                let ord_info: HashMap<String, (String, String, String, String)> = ordini_records
                    .iter()
                    .map(|r| {
                        (
                            r.id.clone(),
                            (
                                str_field(&r.data, "cliente_id"),
                                str_field(&r.data, "medico_id"),
                                str_field(&r.data, "agente_id"),
                                str_field(&r.data, "categoria"),
                            ),
                        )
                    })
                    .collect();

                // Righe per spedizione.
                let mut righe_per_sped: HashMap<String, Vec<SpedizioneRigaDto>> = HashMap::new();
                let mut righe_totali: HashMap<String, (i64, i64)> = HashMap::new();
                let mut righe_spedite: HashMap<String, HashMap<String, (i64, i64)>> =
                    HashMap::new();
                for r in righe_records {
                    let sid = str_field(&r.data, "spedizione_id");
                    let ordine_id = str_field(&r.data, "ordine_id");
                    if !ordine_id.is_empty() {
                        let valore = i64_field(&r.data, "prezzo") * i64_field(&r.data, "qta");
                        let tot = righe_totali.entry(ordine_id.clone()).or_default();
                        tot.0 += 1;
                        tot.1 += valore;
                        if !sid.is_empty() {
                            let sp = righe_spedite
                                .entry(sid.clone())
                                .or_default()
                                .entry(ordine_id.clone())
                                .or_default();
                            sp.0 += 1;
                            sp.1 += valore;
                        }
                    }
                    if sid.is_empty() {
                        continue;
                    }
                    let prodotto_id = str_field(&r.data, "prodotto_id");
                    let cliente_id = ord_info
                        .get(&ordine_id)
                        .map(|(c, _, _, _)| c.clone())
                        .unwrap_or_default();
                    let categoria = ord_info
                        .get(&ordine_id)
                        .map(|(_, _, _, categoria)| categoria.clone())
                        .unwrap_or_default();
                    righe_per_sped
                        .entry(sid)
                        .or_default()
                        .push(SpedizioneRigaDto {
                            ordine_numero: numeri.get(&ordine_id).cloned().unwrap_or_default(),
                            prodotto_nome: nome_riga_prodotto(&prodotti, &prodotto_id, &r.data),
                            qta: i64_field(&r.data, "qta"),
                            prezzo: i64_field(&r.data, "prezzo"),
                            cliente_nome: clienti.get(&cliente_id).cloned().unwrap_or_default(),
                            categoria,
                            paziente: str_field(&r.data, "paziente"),
                            numero: str_field(&r.data, "numero"),
                            ordine_id,
                            riga_id: r.id,
                        });
                }

                let conti_nomi = nome_map(p, "conto");
                let conti_tipi: HashMap<String, String> = p
                    .list("conto")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| (r.id, str_field(&r.data, "tipo")))
                    .collect();

                let mut acconti: HashMap<String, i64> = HashMap::new();
                let mut pagamenti_per_ordine: HashMap<String, Vec<crate::projection::Record>> =
                    HashMap::new();
                for pag in pagamenti_records {
                    let ordine_id = str_field(&pag.data, "ordine_id");
                    if ordine_id.is_empty() {
                        continue;
                    }
                    if str_field(&pag.data, "tipo") == "acconto" {
                        *acconti.entry(ordine_id).or_insert(0) += i64_field(&pag.data, "importo");
                    } else {
                        pagamenti_per_ordine.entry(ordine_id).or_default().push(pag);
                    }
                }
                for ordine in &ordini_records {
                    acconti
                        .entry(ordine.id.clone())
                        .or_insert_with(|| i64_field(&ordine.data, "acconto"));
                }
                for pagamenti in pagamenti_per_ordine.values_mut() {
                    pagamenti.sort_by(|a, b| {
                        let sa = str_field(&a.data, "scadenza");
                        let sb = str_field(&b.data, "scadenza");
                        let ka = if sa.is_empty() {
                            "9999-99-99"
                        } else {
                            sa.as_str()
                        };
                        let kb = if sb.is_empty() {
                            "9999-99-99"
                        } else {
                            sb.as_str()
                        };
                        ka.cmp(kb).then(a.id.cmp(&b.id))
                    });
                }
                let importi_per_spedizione: HashMap<String, HashMap<String, i64>> = righe_spedite
                    .into_iter()
                    .map(|(spedizione_id, per_ordine)| {
                        let importi = per_ordine
                            .into_iter()
                            .map(|(ordine_id, (n_spedite, valore_spedito))| {
                                let n_totali = righe_totali
                                    .get(&ordine_id)
                                    .map(|(n, _)| *n)
                                    .unwrap_or(0)
                                    .max(1);
                                let acconto = acconti.get(&ordine_id).copied().unwrap_or(0).max(0);
                                let quota_acconto =
                                    ((acconto as f64 / n_totali as f64) * n_spedite as f64).round()
                                        as i64;
                                (ordine_id, (valore_spedito - quota_acconto).max(0))
                            })
                            .collect();
                        (spedizione_id, importi)
                    })
                    .collect();

                let destinatari_uniti: HashSet<String> = spedizioni_records
                    .iter()
                    .map(|r| str_field(&r.data, "dest_unito_in"))
                    .filter(|id| !id.is_empty())
                    .collect();

                let mut out: Vec<SpedizioneDto> = spedizioni_records
                    .into_iter()
                    .filter(|r| str_field(&r.data, "dest_unito_in").is_empty())
                    .filter_map(|r| {
                        let corriere_id = str_field(&r.data, "corriere_id");
                        let righe = righe_per_sped.remove(&r.id).unwrap_or_default();
                        if righe.is_empty() && !bool_field(&r.data, "manuale") {
                            return None;
                        }
                        // Numero del collo = concatenazione dei numeri/lotti dei vaccini che
                        // contiene (es. «1234 + 2345»); così la distinta corriere li riporta
                        // tutti in una cella senza modifiche. Collo manuale (senza righe): il
                        // numero digitato sul record. FASE 7.
                        let numero_join = {
                            let nums: Vec<String> = righe
                                .iter()
                                .map(|x| x.numero.clone())
                                .filter(|n| !n.is_empty())
                                .collect();
                            if nums.is_empty() {
                                str_field(&r.data, "numero")
                            } else {
                                Self::fondi_numeri(&nums)
                            }
                        };
                        // Info collo dal primo ordine incluso (stesso destinatario).
                        let ordine_id = righe
                            .first()
                            .map(|x| x.ordine_id.clone())
                            .unwrap_or_default();
                        let (cliente_id, medico_id, agente_id, _) =
                            ord_info.get(&ordine_id).cloned().unwrap_or_default();
                        // Destinatario: il cliente; in mancanza (Diagnostica) il medico.
                        let cli = clienti_dati
                            .get(&cliente_id)
                            .or_else(|| medici_dati.get(&medico_id));
                        let cf = |k: &str| cli.map(|c| str_field(c, k)).unwrap_or_default();
                        let corriere_profilo = corrieri_profilo
                            .get(&corriere_id)
                            .cloned()
                            .unwrap_or_default();
                        // Collo manuale (senza ordine): i dati destinatario stanno sul record.
                        let dest = DestCollo::estrai(&r.data, cf, || {
                            cli.map(|c| str_field(c, "nome")).unwrap_or_default()
                        });
                        let mut pagamenti = Vec::new();
                        let mut visti_ordini = std::collections::HashSet::new();
                        let importi_spedizione = importi_per_spedizione.get(&r.id);
                        for x in &righe {
                            if visti_ordini.insert(&x.ordine_id) {
                                let importo = importi_spedizione
                                    .and_then(|m| m.get(&x.ordine_id))
                                    .copied()
                                    .unwrap_or(0);
                                if let Some(pags) = pagamenti_per_ordine.get(&x.ordine_id) {
                                    pagamenti.extend(pagamenti_spedizione_calcolati_da_records(
                                        pags,
                                        importo,
                                        &conti_nomi,
                                        &conti_tipi,
                                    ));
                                }
                            }
                        }
                        let comunicazione_fingerprint =
                            super::suggestions::fingerprint_spedizione_comunicazione(
                                &r.id,
                                &str_field(&r.data, "data"),
                                &corriere_id,
                                &cliente_id,
                                righe
                                    .iter()
                                    .map(|riga| (riga.riga_id.as_str(), riga.numero.as_str())),
                            );

                        let ultimo_avviso_fingerprint =
                            str_field(&r.data, "ultimo_avviso_fingerprint");
                        let avvisato = !comunicazione_fingerprint.is_empty()
                            && ultimo_avviso_fingerprint == comunicazione_fingerprint;
                        let ultimo_avviso_canale = {
                            let c = str_field(&r.data, "ultimo_avviso_canale");
                            if c.is_empty() {
                                None
                            } else {
                                Some(c)
                            }
                        };
                        let ultimo_avviso_ms = r
                            .data
                            .get("ultimo_avviso_ms")
                            .and_then(serde_json::Value::as_u64);

                        Some(SpedizioneDto {
                            comunicazione_fingerprint,
                            lotto: str_field(&r.data, "lotto"),
                            data: str_field(&r.data, "data"),
                            corriere_nome: corrieri.get(&corriere_id).cloned().unwrap_or_default(),
                            corriere_id,
                            numero: numero_join,
                            colli: if corriere_profilo == "corriere_a" {
                                1
                            } else {
                                i64_field(&r.data, "colli")
                            },
                            peso: if corriere_profilo == "corriere_a" {
                                1
                            } else {
                                i64_field(&r.data, "peso")
                            },
                            servizi: str_field(&r.data, "servizi"),
                            preavviso: bool_field(&r.data, "preavviso"),
                            mezzo: str_field(&r.data, "mezzo"),
                            contrassegno: i64_field(&r.data, "contrassegno"),
                            note: str_field(&r.data, "note"),
                            cliente_id,
                            cliente_nome: dest.cliente,
                            medico_nome: medici.get(&medico_id).cloned().unwrap_or_default(),
                            agente_nome: agenti.get(&agente_id).cloned().unwrap_or_default(),
                            indirizzo: dest.indirizzo,
                            cap: dest.cap,
                            citta: dest.citta,
                            prov: dest.prov,
                            regione: dest.regione,
                            telefono: dest.telefono,
                            email: dest.email,
                            corriere_profilo,
                            unito: !str_field(&r.data, "lotto_pre").is_empty(),
                            destinatari_uniti: destinatari_uniti.contains(&r.id),
                            avvisato,
                            ultimo_avviso_canale,
                            ultimo_avviso_ms,
                            n_righe: righe.len(),
                            righe,
                            pagamenti,
                            id: r.id,
                        })
                    })
                    .collect();
                // Più recenti in cima (per data, poi per id ULID lessicografico).
                out.sort_by(|a, b| b.data.cmp(&a.data).then(b.id.cmp(&a.id)));
                out
            }))
        })
    }

    /// Crea una spedizione (un collo) con le righe selezionate, marcandole `spedita`
    /// e collegandole (`spedizione_id`). Ricalcola lo stato di evasione delle testate
    /// coinvolte (`Spedito`/`Parzialmente spedito`) e prova la chiusura automatica.
    #[allow(clippy::too_many_arguments)]
    pub fn spedizione_crea(
        &self,
        lotto: &str,
        data: &str,
        corriere_id: &str,
        colli: i64,
        peso: i64,
        servizi: &str,
        preavviso: bool,
        mezzo: &str,
        contrassegno: i64,
        note: &str,
        // Righe da spedire, ciascuna col proprio numero/lotto di vaccino (FASE 7): il numero
        // non è più unico per collo ma per riga. Il collo li concatena (vd. `spedizioni_lista`).
        righe: &[RigaNumeroIn],
    ) -> AppResult<SpedizioneDto> {
        if righe.is_empty() {
            return Err("selezionare almeno una riga da spedire".into());
        }
        let mut righe_uniche = HashSet::new();
        for rn in righe {
            if rn.riga_id.trim().is_empty() {
                return Err("una delle righe da spedire non è valida".into());
            }
            if !righe_uniche.insert(rn.riga_id.clone()) {
                return Err("la stessa riga è stata selezionata più volte".into());
            }
        }
        self.with_engine(|engine| {
            let id = Ulid::generate().to_string();
            // Lotto = sessione di creazione (condiviso fra le spedizioni create insieme);
            // se vuoto ricade sull'id della spedizione stessa (gruppo da uno).
            let lotto_effettivo = if lotto.is_empty() {
                id.clone()
            } else {
                lotto.to_string()
            };
            let params = SpedizioneCreateParams {
                data,
                corriere_id,
                colli,
                peso,
                servizi,
                preavviso,
                mezzo,
                contrassegno,
                note,
                righe,
            };
            engine
                .emit_built_checked(|projection| {
                    prepara_spedizione_mutations(projection, &id, &lotto_effettivo, &params)
                })
                .map_err(es)?;

            // Raccoglie gli ordini coinvolti dallo stato appena applicato.
            let mut ordini: Vec<String> = Vec::new();
            for rn in righe {
                if let Some(r) =
                    engine.with_projection(|p| p.get("riga_ordine", &rn.riga_id).ok().flatten())
                {
                    let oid = str_field(&r.data, "ordine_id");
                    if !oid.is_empty() && !ordini.contains(&oid) {
                        ordini.push(oid);
                    }
                }
            }

            // Ricalcola stato testata + riallinea le scadenze legate alla spedizione (saldo/rate
            // a «spedizione + 7gg», contrassegno/assegno +30gg) + chiusura automatica.
            let soglia_chiusura = data_giorni_fa(GIORNI_CHIUSURA);
            for oid in &ordini {
                conferma_se_nuovo(engine, oid)?;
                aggiorna_stato_evasione(engine, oid)?;
                let data_sped = engine.with_projection(|p| ordine_data_spedizione(p, oid));
                riallinea_scadenze_da_spedizione(engine, oid, &data_sped)?;
                prova_chiudi_ordine(engine, oid, &soglia_chiusura)?;
            }

            self.spedizione_dto(engine, &id)
        })
    }

    /// Rimuove un **singolo prodotto** da un collo effettuato (FASE 7): la riga torna fra
    /// quelle «da spedire» (conserva il suo numero), si ricalcola lo stato di evasione
    /// dell'ordine e — se il collo resta senza righe — la spedizione viene eliminata
    /// (`Purged`, non va nel Cestino, come l'annullo). No-op se la riga non è spedita.
    pub fn spedizione_riga_rimuovi(&self, riga_id: &str) -> AppResult<()> {
        self.with_engine(|engine| {
            let (sid, oid) = engine.with_projection(|p| {
                p.get("riga_ordine", riga_id)
                    .ok()
                    .flatten()
                    .map(|r| {
                        (
                            str_field(&r.data, "spedizione_id"),
                            str_field(&r.data, "ordine_id"),
                        )
                    })
                    .unwrap_or_default()
            });
            if sid.is_empty() {
                return Ok(());
            }
            set_fields(
                engine,
                "riga_ordine",
                riga_id,
                &[
                    ("stato_riga", json!("da_spedire")),
                    ("spedizione_id", json!("")),
                ],
            )?;
            // Se il collo resta senza righe, eliminalo del tutto.
            let (restanti, current_colli, current_contrassegno, mezzo) =
                engine.with_projection(|p| {
                    let rest = p
                        .list("riga_ordine")
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|r| str_field(&r.data, "spedizione_id") == sid)
                        .count();
                    let (c, cod, m) = p
                        .get("spedizione", &sid)
                        .ok()
                        .flatten()
                        .map(|r| {
                            (
                                i64_field(&r.data, "colli"),
                                i64_field(&r.data, "contrassegno"),
                                str_field(&r.data, "mezzo"),
                            )
                        })
                        .unwrap_or((1, 0, String::new()));
                    (rest, c, cod, m)
                });

            if restanti == 0 {
                engine
                    .emit("spedizione", &sid, EventBody::Purged)
                    .map_err(es)?;
            } else {
                let nuovo_colli = std::cmp::min(current_colli, restanti as i64);
                let target_contrassegno = if !mezzo.is_empty() {
                    engine.with_projection(|p| importo_spedizione_parziale(p, &sid))
                } else {
                    0
                };
                let diff_contrassegno =
                    std::cmp::max(0, current_contrassegno - target_contrassegno);
                let nuovo_contrassegno = current_contrassegno - diff_contrassegno;

                set_fields(
                    engine,
                    "spedizione",
                    &sid,
                    &[
                        ("colli", json!(nuovo_colli)),
                        ("contrassegno", json!(nuovo_contrassegno)),
                    ],
                )?;

                // Se abbiamo ridotto il contrassegno ed esiste un ordine, riallinea i pagamenti
                if diff_contrassegno > 0 && !oid.is_empty() {
                    let pagamenti_update = engine.with_projection(|p| {
                        let conti = conti_info(p);
                        let unpaid: Vec<(String, i64, String)> = p
                            .list("pagamento")
                            .unwrap_or_default()
                            .into_iter()
                            .filter(|r| {
                                str_field(&r.data, "ordine_id") == oid
                                    && !bool_field(&r.data, "saldato")
                                    && matches!(
                                        str_field(&r.data, "tipo").as_str(),
                                        "saldo" | "rata"
                                    )
                            })
                            .map(|r| {
                                let c_id = str_field(&r.data, "conto_id");
                                let t_conto = conti
                                    .get(&c_id)
                                    .map(|(_, t, _)| t.clone())
                                    .unwrap_or_default();
                                (r.id, i64_field(&r.data, "importo"), t_conto)
                            })
                            .collect();
                        unpaid
                    });

                    // Trova il pagamento di transito (contrassegno o assegno)
                    if let Some(idx_transit) = pagamenti_update
                        .iter()
                        .position(|(_, _, t)| t == "contrassegno" || t == "assegno")
                    {
                        let (transit_id, transit_importo, _) = &pagamenti_update[idx_transit];
                        let nuovo_transit_importo =
                            std::cmp::max(0, transit_importo - diff_contrassegno);
                        let diff_effettiva = transit_importo - nuovo_transit_importo;
                        if diff_effettiva > 0 {
                            let altri: Vec<&(String, i64, String)> = pagamenti_update
                                .iter()
                                .enumerate()
                                .filter(|(i, _)| *i != idx_transit)
                                .map(|(_, x)| x)
                                .collect();
                            if let Some((altro_id, altro_importo, _)) = altri.first() {
                                if nuovo_transit_importo > 0 {
                                    set_fields(
                                        engine,
                                        "pagamento",
                                        transit_id,
                                        &[("importo", json!(nuovo_transit_importo))],
                                    )?;
                                } else {
                                    engine
                                        .emit("pagamento", transit_id, EventBody::Purged)
                                        .map_err(es)?;
                                }
                                set_fields(
                                    engine,
                                    "pagamento",
                                    altro_id,
                                    &[("importo", json!(altro_importo + diff_effettiva))],
                                )?;
                            }
                            // Senza un'altra rata aperta non spostiamo denaro fuori
                            // dallo scadenzario: la copertura dell'ordine deve restare integra.
                        }
                    }
                }
            }

            if !oid.is_empty() {
                aggiorna_stato_evasione(engine, &oid)?;
            }
            Ok(())
        })
    }

    /// Crea un **collo manuale** dentro un lotto: una spedizione **senza ordine/righe**, coi
    /// dati destinatario inseriti a mano (servono per la distinta corriere CORRIERE_B/CORRIERE_A quando
    /// si spedisce qualcosa che non è un ordine a sistema). Non tocca ordini né stato di
    /// evasione; compare fra i colli del lotto e nell'export. Annullabile come gli altri.
    #[allow(clippy::too_many_arguments)]
    pub fn spedizione_collo_manuale(
        &self,
        lotto: &str,
        data: &str,
        corriere_id: &str,
        numero: &str,
        colli: i64,
        peso: i64,
        preavviso: bool,
        mezzo: &str,
        contrassegno: i64,
        note: &str,
        cliente: &str,
        indirizzo: &str,
        cap: &str,
        citta: &str,
        prov: &str,
        regione: &str,
        telefono: &str,
        email: &str,
    ) -> AppResult<SpedizioneDto> {
        if cliente.trim().is_empty() {
            return Err("indicare il destinatario del collo manuale".into());
        }
        self.with_engine(|engine| {
            let profilo_carrai = engine.with_projection(|p| -> AppResult<bool> {
                if corriere_id.is_empty() {
                    return Ok(false);
                }
                let corriere = p
                    .get("corriere", corriere_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "il corriere scelto non è più disponibile".to_string())?;
                Ok(profilo_corriere(
                    &str_field(&corriere.data, "nome"),
                    &str_field(&corriere.data, "profilo"),
                ) == "corriere_a")
            })?;
            let id = Ulid::generate().to_string();
            let lotto = if lotto.is_empty() {
                id.clone()
            } else {
                lotto.to_string()
            };
            engine
                .emit("spedizione", &id, EventBody::Created)
                .map_err(es)?;
            let mut fields = serde_json::Map::new();
            fields.insert("lotto".into(), json!(lotto));
            fields.insert("data".into(), json!(data));
            fields.insert("corriere_id".into(), json!(corriere_id));
            fields.insert("numero".into(), json!(numero));
            fields.insert(
                "colli".into(),
                json!(if profilo_carrai { 1 } else { colli.max(1) }),
            );
            fields.insert(
                "peso".into(),
                json!(if profilo_carrai { 1 } else { peso.max(1) }),
            );
            fields.insert("servizi".into(), json!(""));
            fields.insert("preavviso".into(), json!(preavviso));
            fields.insert("mezzo".into(), json!(mezzo));
            fields.insert("contrassegno".into(), json!(contrassegno));
            fields.insert("note".into(), json!(note));
            // Marca il collo come manuale e porta con sé i dati destinatario.
            fields.insert("manuale".into(), json!(true));
            fields.insert("dest_cliente".into(), json!(cliente.trim()));
            fields.insert("dest_indirizzo".into(), json!(indirizzo));
            fields.insert("dest_cap".into(), json!(cap));
            fields.insert("dest_citta".into(), json!(citta));
            fields.insert("dest_prov".into(), json!(prov));
            fields.insert("dest_regione".into(), json!(regione));
            fields.insert("dest_telefono".into(), json!(telefono));
            fields.insert("dest_email".into(), json!(email));
            emit_fields(engine, "spedizione", &id, fields)?;
            self.spedizione_dto(engine, &id)
        })
    }

    /// Annulla una spedizione: le righe tornano **da spedire** (scollegate) e la
    /// spedizione è eliminata **in via definitiva** (`Purged`, NON va nel Cestino: una
    /// spedizione annullata non è un dato da ripristinare). Ricalcola lo stato di evasione
    /// (che ripristina lo stato ordine **precedente** alla spedizione).
    pub fn spedizione_annulla(&self, id: &str) -> AppResult<()> {
        self.with_engine(|engine| {
            let ordini = annulla_spedizione_inner(engine, id)?;
            for oid in &ordini {
                aggiorna_stato_evasione(engine, oid)?;
            }
            Ok(())
        })
    }

    /// Annulla un intero **lotto** (sessione di creazione): tutte le spedizioni con quel
    /// `lotto`. Le righe tornano da spedire e gli ordini coinvolti ricalcolano lo stato.
    pub fn lotto_annulla(&self, lotto: &str) -> AppResult<()> {
        if lotto.is_empty() {
            return Err("lotto non valido".into());
        }
        self.with_engine(|engine| {
            let ids: Vec<String> = engine.with_projection(|p| {
                p.list("spedizione")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "lotto") == lotto)
                    .map(|r| r.id)
                    .collect()
            });
            if ids.is_empty() {
                return Err("lotto spedizione non piu disponibile".into());
            }
            let mut ordini: Vec<String> = Vec::new();
            for sid in &ids {
                for oid in annulla_spedizione_inner(engine, sid)? {
                    if !ordini.contains(&oid) {
                        ordini.push(oid);
                    }
                }
            }
            for oid in &ordini {
                aggiorna_stato_evasione(engine, oid)?;
            }
            Ok(())
        })
    }

    /// Fonde più **lotti** (sessioni di creazione) in uno solo: riassegna tutte le spedizioni
    /// dei `lotti` a un unico lotto (il primo passato), così in «Effettuate» diventano un solo
    /// gruppo — base per i calcoli (provvigioni/contabilità) su spedizioni di più giorni o
    /// corrieri. Non tocca righe né stato ordini; le distinte restano divise per corriere e il
    /// riepilogo incassi resta per conto/agente. Salva il lotto originale in `lotto_pre` (se non
    /// già fuso) così l'unione è **reversibile** con `lotto_separa`. Ritorna il lotto risultante.
    pub fn lotto_unisci(&self, lotti: Vec<String>) -> AppResult<String> {
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
            return Err("seleziona almeno due gruppi da unire".into());
        }
        let target = lotti[0].clone();
        let set: std::collections::HashSet<&str> = lotti.iter().map(|s| s.as_str()).collect();
        self.with_engine(|engine| {
            let recs: Vec<(String, String, String)> = engine.with_projection(|p| {
                p.list("spedizione")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| set.contains(str_field(&r.data, "lotto").as_str()))
                    .map(|r| {
                        (
                            r.id,
                            str_field(&r.data, "lotto"),
                            str_field(&r.data, "lotto_pre"),
                        )
                    })
                    .collect()
            });
            let presenti: std::collections::HashSet<String> =
                recs.iter().map(|(_, lotto, _)| lotto.clone()).collect();
            if presenti.len() != set.len() {
                return Err("uno dei gruppi spedizione selezionati non e' piu disponibile".into());
            }
            for (sid, lotto, lotto_pre) in &recs {
                // Preserva il lotto originale solo la prima volta (catene di unioni restano
                // riconducibili al lotto di partenza).
                let pre = if lotto_pre.is_empty() {
                    lotto.clone()
                } else {
                    lotto_pre.clone()
                };
                set_fields(
                    engine,
                    "spedizione",
                    sid,
                    &[("lotto", json!(target)), ("lotto_pre", json!(pre))],
                )?;
            }
            Ok(())
        })?;
        Ok(target)
    }

    /// Separa un gruppo **unito** (annulla `lotto_unisci`): ogni spedizione torna al proprio
    /// lotto originale salvato in `lotto_pre`, che viene poi azzerato. Le spedizioni senza
    /// `lotto_pre` restano dove sono.
    pub fn lotto_separa(&self, lotto: &str) -> AppResult<()> {
        if lotto.is_empty() {
            return Err("lotto non valido".into());
        }
        self.with_engine(|engine| {
            let recs: Vec<(String, String)> = engine.with_projection(|p| {
                p.list("spedizione")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "lotto") == lotto)
                    .map(|r| (r.id, str_field(&r.data, "lotto_pre")))
                    .filter(|(_, pre)| !pre.is_empty())
                    .collect()
            });
            if recs.is_empty() {
                return Err("il gruppo spedizione non risulta piu unito".into());
            }
            for (sid, pre) in &recs {
                set_fields(
                    engine,
                    "spedizione",
                    sid,
                    &[("lotto", json!(pre)), ("lotto_pre", json!(""))],
                )?;
            }
            Ok(())
        })
    }

    /// Unisce piu colli dello stesso destinatario dentro il collo principale (il primo id).
    /// I colli sorgente restano nascosti e le righe ricordano il collo di provenienza, così
    /// l'operazione è reversibile con `spedizione_destinatari_separa`.
    pub fn spedizione_destinatari_unisci(&self, spedizione_ids: Vec<String>) -> AppResult<()> {
        let mut ids: Vec<String> = Vec::new();
        for id in spedizione_ids
            .into_iter()
            .filter(|id| !id.trim().is_empty())
        {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        if ids.len() < 2 {
            return Err("seleziona almeno due destinatari da unire".into());
        }
        let target = ids[0].clone();
        let sorgenti: Vec<String> = ids.iter().skip(1).cloned().collect();
        self.with_engine(|engine| {
            let recs: HashMap<String, serde_json::Map<String, serde_json::Value>> = engine
                .with_projection(|p| {
                    ids.iter()
                        .filter_map(|id| {
                            p.get("spedizione", id)
                                .ok()
                                .flatten()
                                .map(|r| (id.clone(), r.data))
                        })
                        .collect()
                });
            if recs.len() != ids.len() {
                return Err("una delle spedizioni selezionate non esiste più".into());
            }
            let target_data = recs
                .get(&target)
                .ok_or_else(|| "spedizione principale non trovata".to_string())?;
            let lotto = str_field(target_data, "lotto");
            let corriere_id = str_field(target_data, "corriere_id");
            let mut colli = i64_field(target_data, "colli").max(1);
            let mut peso = i64_field(target_data, "peso").max(1);
            let mut contrassegno = i64_field(target_data, "contrassegno").max(0);
            let mut preavviso = bool_field(target_data, "preavviso");
            let mut fields_target: Vec<(&str, serde_json::Value)> = Vec::new();
            if i64_field(target_data, "dest_unione_colli_pre") <= 0 {
                fields_target.push(("dest_unione_colli_pre", json!(colli)));
                fields_target.push(("dest_unione_peso_pre", json!(peso)));
                fields_target.push(("dest_unione_contrassegno_pre", json!(contrassegno)));
                fields_target.push(("dest_unione_preavviso_pre", json!(preavviso)));
            }

            for id in &ids {
                let data = recs.get(id).unwrap();
                if !str_field(data, "dest_unito_in").is_empty() {
                    return Err("uno dei destinatari è già unito a un altro collo".into());
                }
                if str_field(data, "lotto") != lotto {
                    return Err("puoi unire solo colli dello stesso gruppo spedizione".into());
                }
                if str_field(data, "corriere_id") != corriere_id {
                    return Err("puoi unire solo destinatari dello stesso corriere".into());
                }
            }

            for sid in &sorgenti {
                let data = recs.get(sid).unwrap();
                colli += i64_field(data, "colli").max(1);
                peso += i64_field(data, "peso").max(1);
                contrassegno += i64_field(data, "contrassegno").max(0);
                preavviso = preavviso || bool_field(data, "preavviso");
            }
            fields_target.push(("colli", json!(colli)));
            fields_target.push(("peso", json!(peso)));
            fields_target.push(("contrassegno", json!(contrassegno)));
            fields_target.push(("preavviso", json!(preavviso)));
            set_fields(engine, "spedizione", &target, &fields_target)?;

            for sid in &sorgenti {
                set_fields(
                    engine,
                    "spedizione",
                    sid,
                    &[("dest_unito_in", json!(target))],
                )?;
                let righe: Vec<String> = engine.with_projection(|p| {
                    p.list("riga_ordine")
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|r| str_field(&r.data, "spedizione_id") == *sid)
                        .map(|r| r.id)
                        .collect()
                });
                for rid in righe {
                    set_fields(
                        engine,
                        "riga_ordine",
                        &rid,
                        &[
                            ("spedizione_pre_dest", json!(sid)),
                            ("spedizione_id", json!(target)),
                        ],
                    )?;
                }
            }
            Ok(())
        })
    }

    /// Separa i destinatari uniti in `spedizione_destinatari_unisci`, ripristinando i colli
    /// sorgente nascosti e le righe che erano state spostate nel collo principale.
    pub fn spedizione_destinatari_separa(&self, spedizione_id: &str) -> AppResult<()> {
        if spedizione_id.is_empty() {
            return Err("spedizione non valida".into());
        }
        self.with_engine(|engine| {
            let (sorgenti, target_data): (
                Vec<String>,
                Option<serde_json::Map<String, serde_json::Value>>,
            ) = engine.with_projection(|p| {
                let src = p
                    .list("spedizione")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "dest_unito_in") == spedizione_id)
                    .map(|r| r.id)
                    .collect();
                let target = p
                    .get("spedizione", spedizione_id)
                    .ok()
                    .flatten()
                    .map(|r| r.data);
                (src, target)
            });
            let target_data =
                target_data.ok_or_else(|| "spedizione principale non trovata".to_string())?;
            if sorgenti.is_empty() {
                return Err("questa spedizione non risulta piu unita ad altri destinatari".into());
            }
            let sorgenti_set: HashSet<String> = sorgenti.iter().cloned().collect();
            let righe: Vec<(String, String)> = engine.with_projection(|p| {
                p.list("riga_ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|r| {
                        let pre = str_field(&r.data, "spedizione_pre_dest");
                        if str_field(&r.data, "spedizione_id") == spedizione_id
                            && sorgenti_set.contains(&pre)
                        {
                            Some((r.id, pre))
                        } else {
                            None
                        }
                    })
                    .collect()
            });
            for (rid, sid) in righe {
                set_fields(
                    engine,
                    "riga_ordine",
                    &rid,
                    &[
                        ("spedizione_id", json!(sid)),
                        ("spedizione_pre_dest", json!("")),
                    ],
                )?;
            }
            for sid in &sorgenti {
                set_fields(engine, "spedizione", sid, &[("dest_unito_in", json!(""))])?;
            }

            let colli_pre = i64_field(&target_data, "dest_unione_colli_pre");
            let peso_pre = i64_field(&target_data, "dest_unione_peso_pre");
            let contrassegno_pre = i64_field(&target_data, "dest_unione_contrassegno_pre");
            let preavviso_pre = bool_field(&target_data, "dest_unione_preavviso_pre");
            let mut fields = vec![
                ("dest_unione_colli_pre", json!(0)),
                ("dest_unione_peso_pre", json!(0)),
                ("dest_unione_contrassegno_pre", json!(0)),
                ("dest_unione_preavviso_pre", json!(false)),
            ];
            if colli_pre > 0 {
                fields.push(("colli", json!(colli_pre)));
                fields.push(("peso", json!(peso_pre.max(1))));
                fields.push(("contrassegno", json!(contrassegno_pre.max(0))));
                fields.push(("preavviso", json!(preavviso_pre)));
            }
            set_fields(engine, "spedizione", spedizione_id, &fields)?;
            Ok(())
        })
    }

    /// Aggiunge un **prodotto mancante** a un ordine come riga **da spedire** (FASE 4B):
    /// un prodotto ordinato ma non inserito, da spedire ora. Se `prezzo > 0` la riga
    /// **incide sul totale** (e quindi su provvigioni/residuo); con `prezzo = 0` è inclusa
    /// (logistica soltanto). Ricalcola lo stato di evasione della testata.
    pub fn riga_mancante_aggiungi(
        &self,
        ordine_id: &str,
        prodotto_id: &str,
        qta: i64,
        prezzo: i64,
        paziente: &str,
    ) -> AppResult<()> {
        if ordine_id.is_empty() || prodotto_id.is_empty() {
            return Err("ordine e prodotto sono obbligatori".into());
        }
        self.with_engine(|engine| {
            let id = Ulid::generate().to_string();
            engine
                .emit("riga_ordine", &id, EventBody::Created)
                .map_err(es)?;
            let mut f = serde_json::Map::new();
            f.insert("ordine_id".into(), json!(ordine_id));
            f.insert("prodotto_id".into(), json!(prodotto_id));
            f.insert("qta".into(), json!(qta.max(1)));
            f.insert("prezzo".into(), json!(prezzo.max(0)));
            f.insert("paziente".into(), json!(paziente));
            f.insert("stato_riga".into(), json!("da_spedire"));
            emit_fields(engine, "riga_ordine", &id, f)?;
            aggiorna_stato_evasione(engine, ordine_id)?;
            Ok(())
        })
    }

    /// **Riepilogo incassi** di un lotto (calcolato **on-demand** all'apertura del gruppo):
    /// per conto e per agente, con **già incassato** (rate saldate) + **da incassare** (rate
    /// attese) + **totale**, **esclusi gli acconti** (`tipo = acconto`). Considera tutti gli
    /// ordini che hanno almeno una riga nelle spedizioni del lotto.
    pub fn spedizione_riepilogo(&self, lotto: &str) -> AppResult<SpedizioneRiepilogoDto> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                use std::collections::HashSet;
                let sped_ids: HashSet<String> = p
                    .list("spedizione")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "lotto") == lotto)
                    .map(|r| r.id)
                    .collect();
                let order_ids: HashSet<String> = p
                    .list("riga_ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| sped_ids.contains(&str_field(&r.data, "spedizione_id")))
                    .map(|r| str_field(&r.data, "ordine_id"))
                    .filter(|o| !o.is_empty())
                    .collect();
                let conti = conti_info(p);
                let conti_nomi: HashMap<String, String> = conti
                    .iter()
                    .map(|(id, (nome, _, _))| (id.clone(), nome.clone()))
                    .collect();
                let conti_tipi: HashMap<String, String> = conti
                    .iter()
                    .map(|(id, (_, tipo, _))| (id.clone(), tipo.clone()))
                    .collect();
                let agenti = nome_map(p, "agente");
                let ord_agente: HashMap<String, String> = p
                    .list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|o| (o.id, str_field(&o.data, "agente_id")))
                    .collect();

                // conto_id -> (gia, da); (agente_id, conto_id) -> (gia, da).
                let mut per_conto: HashMap<String, (i64, i64)> = HashMap::new();
                let mut per_ag: HashMap<String, HashMap<String, (i64, i64)>> = HashMap::new();
                let importi_spedizione = importi_spedizione_parziali(p, &sped_ids);
                for oid in &order_ids {
                    // order_ids può contenere un ordine annullato (testata nel Cestino ma
                    // riga già in spedizione): ord_agente è solo degli ordini NON eliminati,
                    // quindi l'assenza dalla mappa lo esclude dal riepilogo incassi.
                    if !ord_agente.contains_key(oid) {
                        continue;
                    }
                    let importo = importi_spedizione.get(oid).copied().unwrap_or(0);
                    for pag in
                        pagamenti_spedizione_calcolati(p, oid, importo, &conti_nomi, &conti_tipi)
                    {
                        let conto = pag.conto_id.clone();
                        let e = per_conto.entry(conto.clone()).or_default();
                        if pag.saldato {
                            e.0 += pag.importo
                        } else {
                            e.1 += pag.importo
                        }
                        let ag = ord_agente.get(oid).cloned().unwrap_or_default();
                        let ec = per_ag.entry(ag).or_default().entry(conto).or_default();
                        if pag.saldato {
                            ec.0 += pag.importo
                        } else {
                            ec.1 += pag.importo
                        }
                    }
                }

                // Ordina i conti: transito (contrassegno/assegno) prima, poi per nome.
                let rank = |tipo: &str| if tipo == "banca" { 1 } else { 0 };
                let mk_conto = |id: &str, gia: i64, da: i64| {
                    let (nome, tipo, _) = conti.get(id).cloned().unwrap_or_default();
                    RiepilogoContoDto {
                        conto_id: id.to_string(),
                        conto_nome: nome,
                        conto_tipo: tipo,
                        gia_incassato: gia,
                        da_incassare: da,
                        totale: gia + da,
                    }
                };
                let ordina = |v: &mut Vec<RiepilogoContoDto>| {
                    v.sort_by(|a, b| {
                        rank(&a.conto_tipo)
                            .cmp(&rank(&b.conto_tipo))
                            .then(a.conto_nome.cmp(&b.conto_nome))
                    });
                };

                let mut conto_dtos: Vec<RiepilogoContoDto> = per_conto
                    .iter()
                    .map(|(id, (g, d))| mk_conto(id, *g, *d))
                    .collect();
                ordina(&mut conto_dtos);

                let mut agente_dtos: Vec<RiepilogoAgenteDto> = per_ag
                    .into_iter()
                    .map(|(aid, conti_map)| {
                        let mut cv: Vec<RiepilogoContoDto> = conti_map
                            .iter()
                            .map(|(id, (g, d))| mk_conto(id, *g, *d))
                            .collect();
                        ordina(&mut cv);
                        let gia: i64 = cv.iter().map(|c| c.gia_incassato).sum();
                        let da: i64 = cv.iter().map(|c| c.da_incassare).sum();
                        RiepilogoAgenteDto {
                            agente_nome: agenti
                                .get(&aid)
                                .cloned()
                                .unwrap_or_else(|| "(senza agente)".into()),
                            agente_id: aid,
                            gia_incassato: gia,
                            da_incassare: da,
                            totale: gia + da,
                            conti: cv,
                        }
                    })
                    .collect();
                // Agenti per totale decrescente.
                agente_dtos.sort_by(|a, b| {
                    b.totale
                        .cmp(&a.totale)
                        .then(a.agente_nome.cmp(&b.agente_nome))
                });

                let gia_incassato: i64 = conto_dtos.iter().map(|c| c.gia_incassato).sum();
                let da_incassare: i64 = conto_dtos.iter().map(|c| c.da_incassare).sum();
                SpedizioneRiepilogoDto {
                    gia_incassato,
                    da_incassare,
                    totale: gia_incassato + da_incassare,
                    per_conto: conto_dtos,
                    per_agente: agente_dtos,
                }
            }))
        })
    }

    /// Costruisce il DTO di una singola spedizione dalla proiezione (riuso dopo la
    /// creazione, senza ri-bloccare il motore).
    pub(super) fn spedizione_dto(&self, engine: &Engine, id: &str) -> AppResult<SpedizioneDto> {
        engine
            .with_projection(|p| {
                let r = p.get("spedizione", id).ok().flatten()?;
                let numeri = numeri_ordini(p);
                let prodotti = nome_map(p, "prodotto");
                let corrieri = nome_map(p, "corriere");
                let clienti = nome_map(p, "cliente");
                let medici = nome_map(p, "medico");
                let agenti = nome_map(p, "agente");
                let clienti_dati = dati_map(p, "cliente");
                let medici_dati = dati_map(p, "medico");
                let ord_info: HashMap<String, (String, String, String, String)> = p
                    .list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|o| {
                        (
                            o.id,
                            (
                                str_field(&o.data, "cliente_id"),
                                str_field(&o.data, "medico_id"),
                                str_field(&o.data, "agente_id"),
                                str_field(&o.data, "categoria"),
                            ),
                        )
                    })
                    .collect();
                let mut righe: Vec<SpedizioneRigaDto> = p
                    .list("riga_ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|x| str_field(&x.data, "spedizione_id") == id)
                    .map(|x| {
                        let ordine_id = str_field(&x.data, "ordine_id");
                        let prodotto_id = str_field(&x.data, "prodotto_id");
                        let cliente_id = ord_info
                            .get(&ordine_id)
                            .map(|(c, _, _, _)| c.clone())
                            .unwrap_or_default();
                        let categoria = ord_info
                            .get(&ordine_id)
                            .map(|(_, _, _, categoria)| categoria.clone())
                            .unwrap_or_default();
                        SpedizioneRigaDto {
                            ordine_numero: numeri.get(&ordine_id).cloned().unwrap_or_default(),
                            prodotto_nome: nome_riga_prodotto(&prodotti, &prodotto_id, &x.data),
                            qta: i64_field(&x.data, "qta"),
                            prezzo: i64_field(&x.data, "prezzo"),
                            cliente_nome: clienti.get(&cliente_id).cloned().unwrap_or_default(),
                            categoria,
                            paziente: str_field(&x.data, "paziente"),
                            numero: str_field(&x.data, "numero"),
                            ordine_id,
                            riga_id: x.id,
                        }
                    })
                    .collect();
                righe.sort_by(|a, b| a.ordine_numero.cmp(&b.ordine_numero));
                let corriere_id = str_field(&r.data, "corriere_id");
                let ordine_id = righe
                    .first()
                    .map(|x| x.ordine_id.clone())
                    .unwrap_or_default();
                let (cliente_id, medico_id, agente_id, _) =
                    ord_info.get(&ordine_id).cloned().unwrap_or_default();
                // Destinatario: il cliente; in mancanza (Diagnostica) il medico.
                let cli = clienti_dati
                    .get(&cliente_id)
                    .or_else(|| medici_dati.get(&medico_id));
                let cf = |k: &str| cli.map(|c| str_field(c, k)).unwrap_or_default();
                let corriere_profilo = profilo_corriere(
                    corrieri.get(&corriere_id).map(|s| s.as_str()).unwrap_or(""),
                    "",
                );
                // Collo manuale (senza ordine): i dati destinatario stanno sul record.
                let dest = DestCollo::estrai(&r.data, cf, || {
                    cli.map(|c| str_field(c, "nome")).unwrap_or_default()
                });
                // Numero del collo = concatenazione dei numeri dei vaccini (vd. `spedizioni_lista`).
                let numero_join = {
                    let nums: Vec<String> = righe
                        .iter()
                        .map(|x| x.numero.clone())
                        .filter(|n| !n.is_empty())
                        .collect();
                    if nums.is_empty() {
                        str_field(&r.data, "numero")
                    } else {
                        Self::fondi_numeri(&nums)
                    }
                };
                let conti_nomi = nome_map(p, "conto");
                let conti_tipi: HashMap<String, String> = p
                    .list("conto")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| (r.id, str_field(&r.data, "tipo")))
                    .collect();
                let destinatari_uniti = p
                    .list("spedizione")
                    .unwrap_or_default()
                    .into_iter()
                    .any(|s| str_field(&s.data, "dest_unito_in") == id);

                let mut pagamenti = Vec::new();
                let mut visti_ordini = std::collections::HashSet::new();
                let mut sped_set = std::collections::HashSet::new();
                sped_set.insert(id.to_string());
                let importi_spedizione = importi_spedizione_parziali(p, &sped_set);
                for x in &righe {
                    if visti_ordini.insert(&x.ordine_id) {
                        let importo = importi_spedizione.get(&x.ordine_id).copied().unwrap_or(0);
                        pagamenti.extend(pagamenti_spedizione_calcolati(
                            p,
                            &x.ordine_id,
                            importo,
                            &conti_nomi,
                            &conti_tipi,
                        ));
                    }
                }
                let comunicazione_fingerprint =
                    super::suggestions::fingerprint_spedizione_comunicazione(
                        &r.id,
                        &str_field(&r.data, "data"),
                        &corriere_id,
                        &cliente_id,
                        righe
                            .iter()
                            .map(|riga| (riga.riga_id.as_str(), riga.numero.as_str())),
                    );

                let ultimo_avviso_fingerprint = str_field(&r.data, "ultimo_avviso_fingerprint");
                let avvisato = !comunicazione_fingerprint.is_empty()
                    && ultimo_avviso_fingerprint == comunicazione_fingerprint;
                let ultimo_avviso_canale = {
                    let c = str_field(&r.data, "ultimo_avviso_canale");
                    if c.is_empty() {
                        None
                    } else {
                        Some(c)
                    }
                };
                let ultimo_avviso_ms = r
                    .data
                    .get("ultimo_avviso_ms")
                    .and_then(serde_json::Value::as_u64);

                Some(SpedizioneDto {
                    comunicazione_fingerprint,
                    lotto: str_field(&r.data, "lotto"),
                    data: str_field(&r.data, "data"),
                    corriere_nome: corrieri.get(&corriere_id).cloned().unwrap_or_default(),
                    corriere_id,
                    numero: numero_join,
                    colli: if corriere_profilo == "corriere_a" {
                        1
                    } else {
                        i64_field(&r.data, "colli")
                    },
                    peso: if corriere_profilo == "corriere_a" {
                        1
                    } else {
                        i64_field(&r.data, "peso")
                    },
                    servizi: str_field(&r.data, "servizi"),
                    preavviso: bool_field(&r.data, "preavviso"),
                    mezzo: str_field(&r.data, "mezzo"),
                    contrassegno: i64_field(&r.data, "contrassegno"),
                    note: str_field(&r.data, "note"),
                    cliente_id,
                    cliente_nome: dest.cliente,
                    medico_nome: medici.get(&medico_id).cloned().unwrap_or_default(),
                    agente_nome: agenti.get(&agente_id).cloned().unwrap_or_default(),
                    indirizzo: dest.indirizzo,
                    cap: dest.cap,
                    citta: dest.citta,
                    prov: dest.prov,
                    regione: dest.regione,
                    telefono: dest.telefono,
                    email: dest.email,
                    corriere_profilo,
                    unito: !str_field(&r.data, "lotto_pre").is_empty(),
                    destinatari_uniti,
                    avvisato,
                    ultimo_avviso_canale,
                    ultimo_avviso_ms,
                    n_righe: righe.len(),
                    righe,
                    pagamenti,
                    id: r.id,
                })
            })
            .ok_or_else(|| "spedizione non trovata dopo la creazione".to_string())
    }

    /// Contrassegna manualmente una spedizione come già avvisata (fuori gestionale).
    pub fn spedizione_segna_avvisata(&self, id: &str) -> AppResult<()> {
        let ts = now_ms();
        self.with_engine(|engine| {
            let (fp, gia_avvisata) = engine.with_projection(|p| -> AppResult<(String, bool)> {
                let spedizione = p
                    .get("spedizione", id)
                    .map_err(es)?
                    .ok_or_else(|| format!("spedizione {id} non trovata"))?;
                let ordini: HashMap<String, crate::projection::Record> = p
                    .list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| (r.id.clone(), r))
                    .collect();
                let ord_clienti: HashMap<String, String> = ordini
                    .iter()
                    .map(|(oid, o)| (oid.clone(), str_field(&o.data, "cliente_id")))
                    .collect();
                let righe: Vec<_> = p
                    .list("riga_ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|r| str_field(&r.data, "spedizione_id") == id)
                    .collect();
                let cliente_id = righe
                    .iter()
                    .find_map(|r| ord_clienti.get(&str_field(&r.data, "ordine_id")))
                    .cloned()
                    .unwrap_or_default();
                let righe_info: Vec<(String, String)> = righe
                    .iter()
                    .map(|r| (r.id.clone(), str_field(&r.data, "numero")))
                    .collect();
                let fp = super::suggestions::fingerprint_spedizione_comunicazione(
                    id,
                    &str_field(&spedizione.data, "data"),
                    &str_field(&spedizione.data, "corriere_id"),
                    &cliente_id,
                    righe_info
                        .iter()
                        .map(|(rid, num)| (rid.as_str(), num.as_str())),
                );
                let gia_avvisata = str_field(&spedizione.data, "ultimo_avviso_fingerprint") == fp;
                Ok((fp, gia_avvisata))
            })?;
            if !gia_avvisata {
                set_fields(
                    engine,
                    "spedizione",
                    id,
                    &[
                        ("ultimo_avviso_ms", json!(ts)),
                        ("ultimo_avviso_canale", json!("manuale")),
                        ("ultimo_avviso_fingerprint", json!(fp)),
                    ],
                )?;
            }
            Ok(())
        })
    }
}
