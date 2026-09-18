use super::*;

impl AppState {
    /// Anni che contengono ordini (decrescente), per il selettore anno della UI.
    pub fn anni_ordini(&self) -> AppResult<Vec<i64>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let mut set: std::collections::BTreeSet<i64> = std::collections::BTreeSet::new();
                for r in p.list("ordine").unwrap_or_default() {
                    set.insert(anno_di(&str_field(&r.data, "data"), r.created_hlc.wall));
                }
                let mut v: Vec<i64> = set.into_iter().collect();
                v.sort_unstable_by(|a, b| b.cmp(a));
                v
            }))
        })
    }

    /// Elenco del Giornaliero: ordini arricchiti con **numero ANNO-progressivo**
    /// derivato dall'ordinamento HLC (`created_hlc`) per anno, totale dalle righe,
    /// residuo e nomi risolti. Tutti i dispositivi convergono agli stessi numeri.
    pub fn ordini_lista(&self) -> AppResult<Vec<OrdineDto>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let medici = nome_map(p, "medico");
                let agenti = nome_map(p, "agente");
                let clienti: HashMap<String, (String, String, String, String)> = p
                    .list("cliente")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| {
                        (
                            r.id,
                            (
                                str_field(&r.data, "nome"),
                                str_field(&r.data, "citta"),
                                str_field(&r.data, "regione"),
                                str_field(&r.data, "telefono"),
                            ),
                        )
                    })
                    .collect();

                let righe_ordine = p.list("riga_ordine").unwrap_or_default();
                let totali = totali_ordini_da_righe(&righe_ordine);
                let numeri = numeri_ordini(p);
                let transito = conti_transito(p);
                let pagamenti = pagamenti_per_ordine(p, &transito);
                let righe_count = righe_count_ordini_da_righe(&righe_ordine);
                let linee = linee_ordini_da_righe(p, &righe_ordine);
                let mut numeri_lotto: HashMap<String, Vec<String>> = HashMap::new();
                let mut stato_righe_produzione: HashMap<String, (bool, bool)> = HashMap::new();
                for riga in &righe_ordine {
                    let ordine_id = str_field(&riga.data, "ordine_id");
                    let stato_produzione = str_field(&riga.data, "stato_produzione");
                    let lotto_produzione = str_field(&riga.data, "lotto_produzione");
                    let stato = stato_righe_produzione
                        .entry(ordine_id.clone())
                        .or_insert((false, false));
                    stato.0 |= stato_produzione.is_empty() && lotto_produzione.is_empty();
                    stato.1 |= matches!(stato_produzione.as_str(), "in_produzione" | "arrivato_it")
                        || !lotto_produzione.is_empty();
                    let numero = str_field(&riga.data, "numero");
                    if numero.is_empty() {
                        continue;
                    }
                    numeri_lotto.entry(ordine_id).or_default().push(numero);
                }
                for nums in numeri_lotto.values_mut() {
                    nums.sort();
                    nums.dedup();
                }

                // Output ordinato per HLC di creazione (come la numerazione).
                let mut ordini = p.list("ordine").unwrap_or_default();
                ordini.sort_by(|a, b| a.created_hlc.cmp(&b.created_hlc));

                let mut out = Vec::with_capacity(ordini.len());
                for r in ordini {
                    let data = str_field(&r.data, "data");
                    let numero = numeri.get(&r.id).cloned().unwrap_or_default();

                    let medico_id = str_field(&r.data, "medico_id");
                    let agente_id = str_field(&r.data, "agente_id");
                    let cliente_id = str_field(&r.data, "cliente_id");
                    let totale = *totali.get(&r.id).unwrap_or(&0);
                    let acconto = i64_field(&r.data, "acconto");
                    let omaggio = bool_field(&r.data, "omaggio");
                    let stato_ordine = str_field(&r.data, "stato");
                    let agg = pagamenti.get(&r.id);
                    let incassato = agg.map(|a| a.incassato).unwrap_or(0);
                    let stato_pagamento = stato_pagamento_effettivo(
                        &str_field(&r.data, "stato_pagamento"),
                        omaggio,
                        totale,
                        agg,
                    );
                    let (cliente_nome, cliente_citta, cliente_regione, cliente_telefono) =
                        clienti.get(&cliente_id).cloned().unwrap_or_default();

                    let linee_ordine = {
                        let cat = str_field(&r.data, "categoria");
                        if cat.is_empty() {
                            linee.get(&r.id).cloned().unwrap_or_default()
                        } else {
                            vec![cat]
                        }
                    };
                    let (ha_righe_da_produrre, ha_righe_in_lavorazione) = stato_righe_produzione
                        .get(&r.id)
                        .copied()
                        .unwrap_or_default();
                    let ha_righe = righe_count.get(&r.id).copied().unwrap_or(0) > 0;
                    let linea_produzione = linee_ordine
                        .iter()
                        .any(|linea| matches!(linea.as_str(), "Immunoterapia" | "Diagnostica"));
                    let produzione_operativa = stato_ordine != "Rifiutato"
                        && linea_produzione
                        && ((!["Spedito", "Chiuso", "Rifiutato"].contains(&stato_ordine.as_str())
                            && (!ha_righe || ha_righe_da_produrre))
                            || ha_righe_in_lavorazione);

                    out.push(OrdineDto {
                        numero,
                        provvisorio: bool_field(&r.data, "provvisorio"),
                        data,
                        medico_nome: medici.get(&medico_id).cloned().unwrap_or_default(),
                        agente_nome: agenti.get(&agente_id).cloned().unwrap_or_default(),
                        cliente_nome,
                        cliente_citta,
                        cliente_regione,
                        cliente_telefono,
                        stato: stato_ordine,
                        stato_pagamento,
                        sollecito: bool_field(&r.data, "sollecito"),
                        marcatore: str_field(&r.data, "marcatore"),
                        note: str_field(&r.data, "note"),
                        motivo_rifiuto: str_field(&r.data, "motivo_rifiuto"),
                        totale,
                        acconto,
                        incassato,
                        residuo: totale - incassato,
                        omaggio,
                        colli: colli_di(&r.data, righe_count.get(&r.id).copied().unwrap_or(0)),
                        // Linea dell'ordine: dal campo `categoria` (FASE 4D, scelto col
                        // pulsante); per gli ordini vecchi senza campo si deduce dalle
                        // categorie dei prodotti delle righe.
                        linee: linee_ordine,
                        numeri_lotto: numeri_lotto.get(&r.id).cloned().unwrap_or_default(),
                        acconto_incassato: agg.map(|a| a.acconto_incassato).unwrap_or(false),
                        data_acconto: agg.map(|a| a.data_acconto.clone()).unwrap_or_default(),
                        data_produzione: str_field(&r.data, "data_produzione"),
                        data_arrivo_it: str_field(&r.data, "data_arrivo_it"),
                        data_prevista: str_field(&r.data, "data_prevista_lotto"),
                        lotto_produzione: str_field(&r.data, "lotto_produzione"),
                        lotto_produzione_unito: !str_field(&r.data, "lotto_produzione_pre")
                            .is_empty(),
                        produzione_operativa,
                        medico_id,
                        agente_id,
                        cliente_id,
                        id: r.id,
                    });
                }
                out
            }))
        })
    }

    /// Report provvigioni per agente nel periodo `[dal, al]` (date `YYYY-MM-DD`
    /// inclusive, vuote = nessun limite), filtrabile per `agente_id`.
    ///
    /// Esclude gli ordini **Rifiutati** e quelli con flag **omaggio**. Per ogni
    /// ordine calcola la provvigione (fissa o percentuale) sull'importo totale e
    /// segna se è **maturata** secondo la soglia configurata sull'agente
    /// (`spedizione` di default, oppure `chiuso`).
    pub fn provvigioni_report(
        &self,
        dal: Option<String>,
        al: Option<String>,
        agente_id: Option<String>,
    ) -> AppResult<ProvvigioniReportDto> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let numeri = numeri_ordini(p);
                let totali = totali_ordini(p);
                let clienti = nome_map(p, "cliente");
                let cfg = config_agenti(p);
                // Ordini con provvigione GIÀ pagata (in un pagamento provvigione non
                // annullato): vanno esclusi dal report → spariscono dalla schermata.
                let pagati = ordini_provv_pagati(p);
                // Acconto incassato per ordine (abilita il pagamento anticipato).
                let transito = conti_transito(p);
                let pagamenti = pagamenti_per_ordine(p, &transito);

                let (scorpora_iva, detrai_spedizione) = config_provvigioni_globali(p);
                let quota_spedizione = if detrai_spedizione {
                    quota_spedizione_agenti(p)
                } else {
                    0
                };

                let filtro_ag = agente_id.as_deref().filter(|s| !s.is_empty());
                let dal = dal.filter(|s| !s.is_empty());
                let al = al.filter(|s| !s.is_empty());

                let mut per_agente: HashMap<String, Vec<ProvvigioneOrdineDto>> = HashMap::new();
                for o in p.list("ordine").unwrap_or_default() {
                    let stato = str_field(&o.data, "stato");
                    if stato == "Rifiutato" || bool_field(&o.data, "omaggio") {
                        continue;
                    }
                    if pagati.contains(&o.id) {
                        continue; // provvigione già saldata: non più nel report
                    }
                    let data = str_field(&o.data, "data");
                    if let Some(d) = &dal {
                        if data.as_str() < d.as_str() {
                            continue;
                        }
                    }
                    if let Some(a) = &al {
                        if data.as_str() > a.as_str() {
                            continue;
                        }
                    }
                    let aid = str_field(&o.data, "agente_id");
                    if let Some(f) = filtro_ag {
                        if aid != f {
                            continue;
                        }
                    }
                    let totale_ordine = *totali.get(&o.id).unwrap_or(&0);
                    let categoria = str_field(&o.data, "categoria");
                    let c = cfg.get(&aid);
                    // Valore di provvigione: override per la categoria dell'ordine se
                    // impostato sull'agente (FASE 4D), altrimenti il predefinito.
                    let (tipo, valore, soglia) = match c {
                        Some(c) => (
                            c.tipo.as_str(),
                            c.valore_per(&categoria),
                            c.maturazione.as_str(),
                        ),
                        None => ("percentuale", 0.0, "spedizione"),
                    };
                    let base = calcola_base_provvigione_con_quota(
                        totale_ordine,
                        tipo,
                        scorpora_iva,
                        detrai_spedizione,
                        quota_spedizione,
                    );
                    let provvigione = calcola_provvigione(base, tipo, valore);
                    let maturato = provvigione_maturata(&stato, soglia);
                    let acconto_incassato = pagamenti
                        .get(&o.id)
                        .map(|a| a.acconto_incassato)
                        .unwrap_or(false);
                    let cliente_id = str_field(&o.data, "cliente_id");
                    let cliente_nome = clienti.get(&cliente_id).cloned().unwrap_or_default();
                    per_agente
                        .entry(aid)
                        .or_default()
                        .push(ProvvigioneOrdineDto {
                            numero: numeri.get(&o.id).cloned().unwrap_or_default(),
                            ordine_id: o.id,
                            data,
                            cliente_id,
                            cliente_nome,
                            stato,
                            base,
                            provvigione,
                            maturato,
                            acconto_incassato,
                        });
                }

                let mut agenti = Vec::new();
                let mut tot_mat = 0i64;
                let mut tot_pot = 0i64;
                for (aid, mut ordini) in per_agente {
                    ordini.sort_by(|a, b| a.data.cmp(&b.data).then(a.numero.cmp(&b.numero)));
                    let totale_maturato: i64 = ordini
                        .iter()
                        .filter(|o| o.maturato)
                        .map(|o| o.provvigione)
                        .sum();
                    let totale_potenziale: i64 = ordini.iter().map(|o| o.provvigione).sum();
                    tot_mat += totale_maturato;
                    tot_pot += totale_potenziale;
                    let c = cfg.get(&aid);
                    agenti.push(ProvvigioneAgenteDto {
                        agente_nome: c
                            .map(|c| c.nome.clone())
                            .filter(|s| !s.is_empty())
                            .unwrap_or_else(|| "(agente sconosciuto)".to_string()),
                        provv_tipo: c
                            .map(|c| c.tipo.clone())
                            .unwrap_or_else(|| "percentuale".to_string()),
                        provv_valore: c.map(|c| c.valore).unwrap_or(0.0),
                        maturazione: c
                            .map(|c| c.maturazione.clone())
                            .unwrap_or_else(|| "spedizione".to_string()),
                        n_ordini: ordini.len(),
                        totale_maturato,
                        totale_potenziale,
                        ordini,
                        agente_id: aid,
                    });
                }
                agenti.sort_by(|a, b| a.agente_nome.cmp(&b.agente_nome));

                let mut totale_pagato = 0i64;
                for p_rec in p.list("provv_pagamento").unwrap_or_default() {
                    let data = str_field(&p_rec.data, "data");
                    if let Some(d) = &dal {
                        if data.as_str() < d.as_str() {
                            continue;
                        }
                    }
                    if let Some(a) = &al {
                        if data.as_str() > a.as_str() {
                            continue;
                        }
                    }
                    let aid = str_field(&p_rec.data, "agente_id");
                    if let Some(f) = filtro_ag {
                        if aid != f {
                            continue;
                        }
                    }
                    totale_pagato += i64_field(&p_rec.data, "totale");
                }

                ProvvigioniReportDto {
                    agenti,
                    totale_maturato: tot_mat,
                    totale_potenziale: tot_pot,
                    totale_pagato,
                }
            }))
        })
    }

    /// Statistiche per la **dashboard** (FASE 6B) nel periodo `[dal, al]` (date
    /// `YYYY-MM-DD` inclusive, vuote = nessun limite). Un'unica passata sulla proiezione
    /// produce KPI, andamento (bucketizzato), distribuzioni per stato/regione e top agenti,
    /// riusando gli stessi helper di `ordini_lista`/`provvigioni_report`. I KPI «da saldare»
    /// e «produzione» fotografano lo **stato corrente** (ignorano il periodo).
    pub fn dashboard_stats(
        &self,
        dal: Option<String>,
        al: Option<String>,
    ) -> AppResult<DashboardStatsDto> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let totali = totali_ordini(p);
                let agenti_nomi = nome_map(p, "agente");
                let cfg = config_agenti(p);
                // Ordini la cui provvigione è già stata pagata all'agente: contano come
                // «maturate» nella KPI anche se l'ordine non ha ancora raggiunto la soglia
                // di stato (es. pagamento anticipato su acconto incassato).
                let pagati = ordini_provv_pagati(p);

                let dal = dal.filter(|s| !s.is_empty());
                let al = al.filter(|s| !s.is_empty());
                let nel_periodo = |data: &str| {
                    dal.as_deref().is_none_or(|d| data >= d)
                        && al.as_deref().is_none_or(|a| data <= a)
                };
                // Granularità dell'andamento: giornaliera per finestre brevi (≤ ~3 mesi),
                // altrimenti mensile (es. l'anno corrente → 12 punti).
                let mensile = match (&dal, &al) {
                    (Some(d), Some(a)) => giorni_tra(d, a) > 92,
                    _ => true,
                };

                // KPI correnti (stato attuale, fuori periodo) + distribuzioni di periodo.
                let mut k = DashboardStatsDto {
                    ordini_n: 0,
                    ordini_valore: 0,
                    provv_maturato: 0,
                    provv_potenziale: 0,
                    da_saldare_spediti: 0,
                    da_saldare_non_spediti: 0,
                    in_produzione: 0,
                    in_arrivo: 0,
                    andamento: Vec::new(),
                    per_stato: Vec::new(),
                    per_regione: Vec::new(),
                    top_agenti: Vec::new(),
                };

                let (scorpora_iva, detrai_spedizione) = config_provvigioni_globali(p);
                let quota_spedizione = if detrai_spedizione {
                    quota_spedizione_agenti(p)
                } else {
                    0
                };

                let mut per_stato: HashMap<String, (i64, i64)> = HashMap::new();
                let mut per_regione: HashMap<String, (i64, i64)> = HashMap::new();
                let mut per_agente: HashMap<String, (i64, i64)> = HashMap::new(); // (valore, provv maturate)
                let mut buckets: HashMap<String, (i64, i64)> = HashMap::new(); // iso -> (ordini, valore)
                                                                               // Stato corrente di ogni ordine NON nel cestino: serve sotto per attribuire
                                                                               // i pagamenti attesi (Da saldare) allo stato spedito/non-spedito dell'ordine.
                let mut ord_stato: HashMap<String, String> = HashMap::new();

                for o in p.list("ordine").unwrap_or_default() {
                    let stato = str_field(&o.data, "stato");
                    let omaggio = bool_field(&o.data, "omaggio");
                    let totale = *totali.get(&o.id).unwrap_or(&0);
                    ord_stato.insert(o.id.clone(), stato.clone());

                    // Tutto il resto è di periodo (sul `data` dell'ordine).
                    let data = str_field(&o.data, "data");
                    if !nel_periodo(&data) {
                        continue;
                    }
                    k.ordini_n += 1;
                    k.ordini_valore += totale;

                    let st = per_stato.entry(stato.clone()).or_default();
                    st.0 += 1;
                    st.1 += totale;

                    // Provvigioni nel periodo (esclude rifiutati e omaggi).
                    if stato != "Rifiutato" && !omaggio {
                        let aid = str_field(&o.data, "agente_id");
                        let categoria = str_field(&o.data, "categoria");
                        let c = cfg.get(&aid);
                        let (tipo, valore, soglia) = match c {
                            Some(c) => (
                                c.tipo.as_str(),
                                c.valore_per(&categoria),
                                c.maturazione.as_str(),
                            ),
                            None => ("percentuale", 0.0, "spedizione"),
                        };
                        let base = calcola_base_provvigione_con_quota(
                            totale,
                            tipo,
                            scorpora_iva,
                            detrai_spedizione,
                            quota_spedizione,
                        );
                        let provv = calcola_provvigione(base, tipo, valore);
                        k.provv_potenziale += provv;
                        // «Maturata» = soglia di stato raggiunta OPPURE già pagata all'agente
                        // (il pagamento anticipato non va perso dalla KPI).
                        let maturato =
                            provvigione_maturata(&stato, soglia) || pagati.contains(&o.id);
                        if maturato {
                            k.provv_maturato += provv;
                        }
                        let e = per_agente.entry(aid).or_default();
                        e.0 += totale;
                        if maturato {
                            e.1 += provv;
                        }
                    }

                    // Bucket dell'andamento (ordini + valore).
                    let iso = bucket_iso(&data, mensile);
                    let e = buckets.entry(iso).or_default();
                    e.0 += 1;
                    e.1 += totale;
                }

                // Da saldare (KPI corrente, indipendente dal periodo): stessa logica del tab
                // Crediti → somma dei pagamenti **attesi** (non saldati) degli ordini impegnati
                // (≥ Confermato, cioè stato diverso da «Nuovo»: i preventivi sono solo
                // "potenziali", non crediti reali). I Rifiutati e gli ordini nel cestino sono
                // esclusi. Lo split spedito/non-spedito segue lo stato dell'ordine.
                for r in p.list("pagamento").unwrap_or_default() {
                    if bool_field(&r.data, "saldato") {
                        continue;
                    }
                    let oid = str_field(&r.data, "ordine_id");
                    let stato = match ord_stato.get(&oid) {
                        Some(s) => s,
                        None => continue, // ordine annullato (cestino)
                    };
                    if stato == "Nuovo" || stato == "Rifiutato" {
                        continue; // preventivo (potenziale) o rifiutato: non è un credito atteso
                    }
                    let importo = i64_field(&r.data, "importo");
                    if is_spedito(stato) {
                        k.da_saldare_spediti += importo;
                    } else {
                        k.da_saldare_non_spediti += importo;
                    }
                }

                // In produzione (KPI corrente): conta i **prodotti** (righe d'ordine), non gli
                // ordini né i lotti. Lo stato di produzione vive sulla riga (FASE 7). Le righe
                // di ordini nel cestino/Rifiutati sono escluse.
                for r in p.list("riga_ordine").unwrap_or_default() {
                    let oid = str_field(&r.data, "ordine_id");
                    match ord_stato.get(&oid) {
                        Some(s) if s != "Rifiutato" => {}
                        _ => continue,
                    }
                    if str_field(&r.data, "stato_produzione") == "arrivato_it" {
                        k.in_arrivo += 1;
                    } else if riga_in_lavorazione(&r.data) {
                        k.in_produzione += 1;
                    }
                }

                // Regione: serve la mappa clienti (id -> regione). Seconda mappa leggera.
                let regioni: HashMap<String, String> = p
                    .list("cliente")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| (r.id, str_field(&r.data, "regione")))
                    .collect();
                for o in p.list("ordine").unwrap_or_default() {
                    let data = str_field(&o.data, "data");
                    if !nel_periodo(&data) {
                        continue;
                    }
                    let totale = *totali.get(&o.id).unwrap_or(&0);
                    let cliente_id = str_field(&o.data, "cliente_id");
                    let reg = regioni
                        .get(&cliente_id)
                        .cloned()
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "Altre zone".to_string());
                    let e = per_regione.entry(reg).or_default();
                    e.0 += 1;
                    e.1 += totale;
                }

                // Incassi per bucket: pagamenti saldati con `data` nel periodo. Assicura
                // anche il bucket (un mese può avere incassi ma nessun ordine nuovo).
                let mut incassi: HashMap<String, i64> = HashMap::new();
                for r in p.list("pagamento").unwrap_or_default() {
                    if !bool_field(&r.data, "saldato") {
                        continue;
                    }
                    let data = str_field(&r.data, "data");
                    if data.is_empty() || !nel_periodo(&data) {
                        continue;
                    }
                    let iso = bucket_iso(&data, mensile);
                    buckets.entry(iso.clone()).or_default();
                    *incassi.entry(iso).or_default() += i64_field(&r.data, "importo");
                }

                // Materializza l'andamento ordinato per chiave ISO.
                let mut iso_keys: Vec<String> = buckets.keys().cloned().collect();
                iso_keys.sort();
                k.andamento = iso_keys
                    .into_iter()
                    .map(|iso| {
                        let (ordini, valore) = buckets.get(&iso).copied().unwrap_or_default();
                        DashPuntoDto {
                            etichetta: etichetta_bucket(&iso, mensile),
                            incassato: incassi.get(&iso).copied().unwrap_or(0),
                            iso,
                            ordini,
                            valore,
                        }
                    })
                    .collect();

                // Distribuzioni → vettori ordinati (per valore desc).
                k.per_stato = per_stato
                    .into_iter()
                    .map(|(chiave, (n, valore))| DashFettaDto { chiave, n, valore })
                    .collect();
                k.per_stato.sort_by_key(|b| std::cmp::Reverse(b.valore));

                k.per_regione = per_regione
                    .into_iter()
                    .map(|(chiave, (n, valore))| DashFettaDto { chiave, n, valore })
                    .collect();
                k.per_regione.sort_by_key(|b| std::cmp::Reverse(b.valore));

                k.top_agenti = per_agente
                    .into_iter()
                    .map(|(agente_id, (valore, provvigioni))| DashAgenteDto {
                        agente_nome: agenti_nomi.get(&agente_id).cloned().unwrap_or_default(),
                        agente_id,
                        valore,
                        provvigioni,
                    })
                    .collect();
                k.top_agenti.sort_by_key(|b| std::cmp::Reverse(b.valore));

                k
            }))
        })
    }

    /// Esporta il report provvigioni del periodo in un file `.xlsx` al percorso dato.
    pub fn provvigioni_export(
        &self,
        path: &str,
        dal: Option<String>,
        al: Option<String>,
        agente_id: Option<String>,
    ) -> AppResult<()> {
        let report = self.provvigioni_report(dal, al, agente_id)?;
        crate::export::provvigioni_xlsx(Path::new(path), &report)
    }

    /// Export **generico** di una griglia (la UI passa colonne + righe già filtrate
    /// e ordinate, riusato da Crediti/Rimborsi/Giornaliero). Non tocca la proiezione:
    /// l'anteprima e i filtri vivono nel frontend, qui si scrive solo il file.
    pub fn griglia_export(
        &self,
        path: &str,
        foglio: &str,
        colonne: Vec<crate::export::ColExport>,
        righe: Vec<serde_json::Value>,
        orizzontale: bool,
        simbolo_euro: bool,
    ) -> AppResult<()> {
        // Le righe arrivano come array di array di valori (cella).
        let righe: Vec<Vec<serde_json::Value>> = righe
            .into_iter()
            .map(|r| r.as_array().cloned().unwrap_or_default())
            .collect();
        crate::export::griglia_xlsx(
            Path::new(path),
            foglio,
            &colonne,
            &righe,
            orizzontale,
            simbolo_euro,
        )
    }
}
