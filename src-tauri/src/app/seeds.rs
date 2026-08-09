use super::*;

impl AppState {
    /// Crea, se mancanti, i conti speciali built-in (Contrassegno, Assegno). Best-effort.
    pub(super) fn seed_builtin_conti(&self) {
        if let Some(rt) = self.runtime.lock().expect("rt poisoned").as_ref() {
            if let Err(err) = ensure_builtin_conti(&rt.engine) {
                eprintln!("seed conti speciali fallito: {err}");
            }
        }
    }

    /// Crea, se mancanti, i corrieri built-in (CORRIERE_B, CORRIERE_A, CORRIERE_C) con profilo export fisso. Best-effort.
    pub(super) fn seed_builtin_corrieri(&self) {
        if let Some(rt) = self.runtime.lock().expect("rt poisoned").as_ref() {
            if let Err(err) = ensure_builtin_corrieri(&rt.engine) {
                eprintln!("seed corrieri built-in fallito: {err}");
            }
        }
    }

    /// Crea, se mancante, il catalogo «prodotti di produzione» (FASE 5B): valori canonici
    /// per i suggerimenti dei dati produzione (formulazioni/posologie/allergeni/ceppi).
    /// Best-effort, idempotente (id fissi, non ricrea ciò che esiste).
    pub(super) fn seed_prodotti_produzione(&self) {
        if let Some(rt) = self.runtime.lock().expect("rt poisoned").as_ref() {
            if let Err(err) = ensure_prodotti_produzione(&rt.engine) {
                eprintln!("seed prodotti produzione fallito: {err}");
            }
        }
    }

    /// Crea, se mancanti, le anagrafiche di partenza: agenti reali (Agente Demo 001 0%),
    /// medici (con prezzo immunoterapia tipico precompilato dagli ordini storici) e i
    /// prodotti default (allergeni/ceppi Immunoterapia + i tre Keriba). Tutto a id fissi
    /// → idempotente e conflict-free; al reset si ripristina. Best-effort.
    pub(super) fn seed_anagrafiche_default(&self) {
        if let Some(rt) = self.runtime.lock().expect("rt poisoned").as_ref() {
            if let Err(err) = ensure_conti_default(&rt.engine)
                .and_then(|_| ensure_agenti_default(&rt.engine))
                .and_then(|_| ensure_medici_default(&rt.engine))
                .and_then(|_| ensure_prodotti_default(&rt.engine))
                .and_then(|_| ensure_prodotti_diagnostica(&rt.engine))
                .and_then(|_| ensure_regole_prezzo_default(&rt.engine))
                .and_then(|_| ensure_parametri_globali_default(&rt.engine))
            {
                eprintln!("seed anagrafiche default fallito: {err}");
            }
        }
    }

    /// **Solo demo**: elimina definitivamente tutti gli ordini demo con righe/pagamenti,
    /// spedizioni e i **clienti demo** creati apposta (flag `demo:true`). Le anagrafiche di
    /// default (builtin) non si toccano. Ripulisce anche eventuali demo gia finiti nel Cestino
    /// da versioni precedenti. Restituisce il numero di ordini demo purgati.
    pub fn azzera_demo(&self) -> AppResult<usize> {
        self.with_engine(|engine| {
            let (da_purgare, n_ordini) = engine.with_projection(|p| {
                let mut demo_ord: HashSet<String> = HashSet::new();
                for r in p
                    .list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .chain(p.list_deleted("ordine").unwrap_or_default())
                {
                    if r.data.get("demo") == Some(&json!(true)) {
                        demo_ord.insert(r.id);
                    }
                }

                let righe_live = p.list("riga_ordine").unwrap_or_default();
                let righe_deleted = p.list_deleted("riga_ordine").unwrap_or_default();
                let mut spedizioni_demo_da_righe: HashSet<String> = HashSet::new();
                let mut spedizioni_con_righe: HashSet<String> = HashSet::new();
                for r in &righe_live {
                    let sid = str_field(&r.data, "spedizione_id");
                    if !sid.is_empty() {
                        spedizioni_con_righe.insert(sid);
                    }
                }
                for r in righe_live.iter().chain(righe_deleted.iter()) {
                    if demo_ord.contains(&str_field(&r.data, "ordine_id")) {
                        let sid = str_field(&r.data, "spedizione_id");
                        if !sid.is_empty() {
                            spedizioni_demo_da_righe.insert(sid);
                        }
                    }
                }

                let mut out: Vec<(String, String)> = Vec::new();
                for r in righe_live.into_iter().chain(righe_deleted) {
                    if demo_ord.contains(&str_field(&r.data, "ordine_id")) {
                        out.push(("riga_ordine".to_string(), r.id));
                    }
                }
                for r in p
                    .list("pagamento")
                    .unwrap_or_default()
                    .into_iter()
                    .chain(p.list_deleted("pagamento").unwrap_or_default())
                {
                    if demo_ord.contains(&str_field(&r.data, "ordine_id")) {
                        out.push(("pagamento".to_string(), r.id));
                    }
                }
                for r in p
                    .list("spedizione")
                    .unwrap_or_default()
                    .into_iter()
                    .chain(p.list_deleted("spedizione").unwrap_or_default())
                {
                    let lotto = str_field(&r.data, "lotto");
                    let orfana_demo = !spedizioni_con_righe.contains(&r.id)
                        && !bool_field(&r.data, "manuale")
                        && lotto.starts_with("lotto-sped-");
                    if r.data.get("demo") == Some(&json!(true))
                        || spedizioni_demo_da_righe.contains(&r.id)
                        || orfana_demo
                    {
                        out.push(("spedizione".to_string(), r.id));
                    }
                }
                for entity in ["ordine", "cliente", "conto"] {
                    for r in p
                        .list(entity)
                        .unwrap_or_default()
                        .into_iter()
                        .chain(p.list_deleted(entity).unwrap_or_default())
                    {
                        if r.data.get("demo") == Some(&json!(true)) {
                            out.push((entity.to_string(), r.id));
                        }
                    }
                }
                let n_ordini = demo_ord.len();
                (out, n_ordini)
            });
            for (entity, id) in da_purgare {
                engine.emit(&entity, &id, EventBody::Purged).map_err(es)?;
            }
            Ok(n_ordini)
        })
    }

    /// **Solo demo**: popola molti ordini di prova vari (Immunoterapia/Diagnostica/Keriba)
    /// e i relativi **clienti** (farmacie/ambulatori), dove **un cliente ha più ordini**.
    /// Usa le anagrafiche di default (che assicura presenti). Riparte sempre pulito (azzera
    /// prima i demo precedenti) e marca ordini e clienti con `demo:true` così sono rimovibili
    /// in un colpo. NON è un seed automatico: si lancia a mano. Ritorna gli ordini creati.
    pub fn popola_demo(&self) -> AppResult<usize> {
        self.seed_anagrafiche_default();
        self.azzera_demo()?;

        let medici: Vec<RecordDto> = self
            .records_list("medico")?
            .into_iter()
            .filter(|r| r.data.get("builtin") == Some(&json!(true)))
            .collect();
        let prodotti = self.records_list("prodotto")?;
        let per_cat = |cat: &'static str| -> Vec<&RecordDto> {
            prodotti
                .iter()
                .filter(|r| str_field(&r.data, "categoria") == cat)
                .collect()
        };
        let imm = per_cat("Immunoterapia");
        let ker = per_cat("Keriba");
        let diag = per_cat("Diagnostica");
        if medici.is_empty() || imm.is_empty() {
            return Ok(0);
        }

        // Clienti demo: in gran parte PERSONE (clienti privati) con indirizzo, così le viste
        // (spedizioni, crediti) hanno destinatari veri; più pochi ospedali (max 5). Ognuno avrà
        // PIÙ ordini.
        const CLIENTI: &[(&str, &str, &str, &str)] = &[
            ("Alessandro Vitale", "Mondragone", "CE", "Campania"),
            ("Maria Grazia Donati", "Milano", "MI", "Lombardia"),
            ("Giuseppe Carbone", "Verona", "VR", "Veneto"),
            ("Ospedale di Macerata", "Macerata", "MC", "Marche"),
            ("Francesca Rinaldi", "Reggio Emilia", "RE", "Emilia-Romagna"),
            ("Ospedale di Parma", "Parma", "PR", "Emilia-Romagna"),
            ("Davide Sanna", "Melegnano", "MI", "Lombardia"),
            ("Chiara Fontana", "Latina", "LT", "Lazio"),
            ("Antonio Lombardo", "Avellino", "AV", "Campania"),
            ("Ospedale di Alessandria", "Alessandria", "AL", "Piemonte"),
            ("Elena Barbieri", "Torino", "TO", "Piemonte"),
            ("Salvatore Caruso", "Bari", "BA", "Puglia"),
            ("Valentina Ferraro", "Roma", "RM", "Lazio"),
            ("Roberto Galli", "Napoli", "NA", "Campania"),
            (
                "Ospedale di Reggio Emilia",
                "Reggio Emilia",
                "RE",
                "Emilia-Romagna",
            ),
            ("Laura Mariani", "Bologna", "BO", "Emilia-Romagna"),
        ];
        // Conti reali esistenti da usare a rotazione per i pagamenti demo
        let conti_esistenti = [
            seed_id("conto", "9438"),
            seed_id("conto", "8376"),
            seed_id("conto", "1243"),
        ];

        let mut clienti_ids: Vec<String> = Vec::new();
        for (i, (nome, citta, prov, regione)) in CLIENTI.iter().enumerate() {
            let mut cf = serde_json::Map::new();
            cf.insert("nome".into(), json!(nome));
            cf.insert("indirizzo".into(), json!(format!("Via Roma {}", i + 1)));
            cf.insert("citta".into(), json!(citta));
            cf.insert("prov".into(), json!(prov));
            cf.insert("regione".into(), json!(regione));
            cf.insert("cap".into(), json!("00100"));
            cf.insert("demo".into(), json!(true));
            let c = self.record_create("cliente", cf)?;
            clienti_ids.push(c.id);
        }

        const PAZIENTI: &[&str] = &[
            "Rossi Marco",
            "Bianchi Lucia",
            "Esposito Anna",
            "Russo Giuseppe",
            "Ferrari Sara",
            "Romano Luca",
            "Colombo Elena",
            "Ricci Davide",
            "Marino Chiara",
            "Greco Paolo",
            "Bruno Martina",
            "Gallo Andrea",
            "Conti Federica",
            "De Luca Simone",
            "Mancini Giulia",
            "Costa Roberto",
            "Giordano Laura",
            "Rizzo Matteo",
            "Lombardi Valentina",
            "Moretti Stefano",
        ];
        const FORM: &[&str] = &["polimerizzato", "gocce", "spray", "sottocute"];
        const POS: &[&str] = &["2+2", "3+3", "3", "2+2+2"];
        // Allergeni/ceppi reali (il "contenuto" della preparazione), non il prodotto commerciale.
        const ALLERG: &[&str] = &[
            "parietaria",
            "d.pteronyssinus",
            "olea europea",
            "mix graminacee",
            "cipresso",
            "betulla",
            "alternaria",
            "gatto",
            "h.influenzae",
            "s.pneumoniae",
        ];
        const STATI: &[&str] = &["Nuovo", "Confermato", "In produzione", "Spedito"];
        const TIPI_TEST: &[&str] = &["PRICK TEST", "INTRADERMO", "PRICK TEST ALIMENTI"];
        const ML: &[&str] = &["2", "3", "2.5"];

        let mut creati = 0usize;
        // Molti ordini: ~130. Il cliente è assegnato a rotazione sfasata rispetto al medico,
        // così lo stesso cliente compare su più ordini con medici/linee diversi.
        for i in 0..130usize {
            let med = &medici[i % medici.len()];
            let agente_id = str_field(&med.data, "agente_id");
            let prezzo_imm = i64_field(&med.data, "prezzo_immuno_default");
            let categoria = if i % 9 == 4 && !ker.is_empty() {
                "Keriba"
            } else if i % 7 == 3 && !diag.is_empty() {
                "Diagnostica"
            } else {
                "Immunoterapia"
            };
            let data = format!("2026-{:02}-{:02}", 1 + (i % 6), 1 + (i % 27));
            let stato = STATI[i % STATI.len()];

            let mut of = serde_json::Map::new();
            of.insert("data".into(), json!(data));
            of.insert("categoria".into(), json!(categoria));
            of.insert("medico_id".into(), json!(med.id));
            of.insert("agente_id".into(), json!(agente_id));
            of.insert("stato".into(), json!(stato));
            of.insert("demo".into(), json!(true));
            // In produzione/Spedito → segna la data di produzione (coda spedizioni/produzione).
            if stato == "In produzione" || stato == "Spedito" {
                of.insert("data_produzione".into(), json!(data));
            }
            // Gli ordini «In produzione» devono avere un `lotto_produzione` (come fa
            // `produzione_invia`): senza, la coda «In lavorazione» li raggruppa sotto lotto
            // vuoto e poi l'export Laboratorio/Diagnostica fallisce ("lotto non valido") e
            // l'unione non parte (un solo gruppo). Demo: pochi lotti per mese → «Unisci»
            // ha più lotti da fondere e ogni lotto è valido ed esportabile.
            if stato == "In produzione" {
                of.insert(
                    "lotto_produzione".into(),
                    json!(format!("lotto-demo-{:02}", 1 + (i % 6))),
                );
            }
            // Diagnostica = il destinatario è il medico/struttura; le altre linee hanno un cliente
            // (farmacia) → un cliente con più ordini.
            if categoria != "Diagnostica" {
                of.insert(
                    "cliente_id".into(),
                    json!(clienti_ids[(i + 3) % clienti_ids.len()]),
                );
            }
            if categoria == "Immunoterapia" {
                of.insert("acconto".into(), json!(9000));
            }
            let ord = self.record_create("ordine", of)?;

            let mut righe_create = Vec::new();
            let totale: i64 = match categoria {
                "Keriba" => {
                    let prod = &ker[i % ker.len()];
                    let qta = 1 + (i % 2) as i64;
                    let mut rf = serde_json::Map::new();
                    rf.insert("ordine_id".into(), json!(ord.id));
                    rf.insert("prodotto_id".into(), json!(prod.id));
                    rf.insert("qta".into(), json!(qta));
                    rf.insert("prezzo".into(), json!(6000));
                    if stato == "In produzione" {
                        rf.insert("stato_produzione".into(), json!("in_produzione"));
                        rf.insert(
                            "lotto_produzione".into(),
                            json!(format!("lotto-demo-{:02}", 1 + (i % 6))),
                        );
                    }
                    let r = self.record_create("riga_ordine", rf)?;
                    righe_create.push(r.id);
                    qta * 6000
                }
                "Diagnostica" => {
                    let prod = &diag[i % diag.len()];
                    let qta = 5 + (i % 10) as i64;
                    let mut rf = serde_json::Map::new();
                    rf.insert("ordine_id".into(), json!(ord.id));
                    rf.insert("prodotto_id".into(), json!(prod.id));
                    rf.insert("qta".into(), json!(qta));
                    rf.insert("prezzo".into(), json!(1500));
                    rf.insert("tipo_test".into(), json!(TIPI_TEST[i % TIPI_TEST.len()]));
                    rf.insert("ml".into(), json!(ML[i % ML.len()]));
                    rf.insert(
                        "codice_fornitore".into(),
                        json!(str_field(&prod.data, "codice_fornitore")),
                    );
                    if stato == "In produzione" {
                        rf.insert("stato_produzione".into(), json!("in_produzione"));
                        rf.insert(
                            "lotto_produzione".into(),
                            json!(format!("lotto-demo-{:02}", 1 + (i % 6))),
                        );
                    }
                    let r = self.record_create("riga_ordine", rf)?;
                    righe_create.push(r.id);
                    qta * 1500
                }
                _ => {
                    let prezzo = if prezzo_imm > 0 { prezzo_imm } else { 27000 };
                    let n_righe = 1 + (i % 3); // 1..3 pazienti per ordine
                    for k in 0..n_righe {
                        let prod = &imm[(i + k) % imm.len()];
                        // 1..3 allergeni reali (non il nome del prodotto, che è la preparazione):
                        // numero variabile → esercita le colonne allergeni dinamiche dell'export.
                        let n_all = 1 + ((i + k) % 3);
                        let allergeni: Vec<&str> = (0..n_all)
                            .map(|j| ALLERG[(i + k + j) % ALLERG.len()])
                            .collect();
                        let mut rf = serde_json::Map::new();
                        rf.insert("ordine_id".into(), json!(ord.id));
                        rf.insert("prodotto_id".into(), json!(prod.id));
                        rf.insert("qta".into(), json!(1));
                        rf.insert("prezzo".into(), json!(prezzo));
                        rf.insert("paziente".into(), json!(PAZIENTI[(i + k) % PAZIENTI.len()]));
                        rf.insert("formulazione".into(), json!(FORM[(i + k) % FORM.len()]));
                        rf.insert("posologia".into(), json!(POS[(i + k) % POS.len()]));
                        rf.insert("allergeni".into(), json!(allergeni));
                        if stato == "In produzione" {
                            rf.insert("stato_produzione".into(), json!("in_produzione"));
                            rf.insert(
                                "lotto_produzione".into(),
                                json!(format!("lotto-demo-{:02}", 1 + (i % 6))),
                            );
                        }
                        let r = self.record_create("riga_ordine", rf)?;
                        righe_create.push(r.id);
                    }
                    prezzo * n_righe as i64
                }
            };

            // --- Scadenzario / pagamenti diversificati (FASE 6B demo) ---
            // Date di comodo: scaduta = prima di "oggi" (2026-06-16); futura = dopo.
            let scad_passata = format!("2026-{:02}-15", 2 + (i % 4)); // feb–mag → scaduti
            let scad_futura = format!("2026-{:02}-10", 8 + (i % 3)); // ago–ott → attesi
            let data_incasso = format!("2026-{:02}-20", 1 + (i % 6));
            let crea_pag = |tipo: &str,
                            importo: i64,
                            saldato: bool,
                            scadenza: &str,
                            data: &str,
                            conto: &str,
                            verificato: bool|
             -> AppResult<()> {
                let mut pf = serde_json::Map::new();
                pf.insert("ordine_id".into(), json!(ord.id));
                pf.insert("tipo".into(), json!(tipo));
                pf.insert("importo".into(), json!(importo));
                pf.insert("saldato".into(), json!(saldato));
                pf.insert("scadenza".into(), json!(scadenza));
                pf.insert("data".into(), json!(data));
                pf.insert("conto_id".into(), json!(conto));
                pf.insert("verificato".into(), json!(verificato));
                self.record_create("pagamento", pf)?;
                Ok(())
            };
            match categoria {
                "Keriba" => {
                    // «Salda tutto alla consegna»: contrassegno +30gg. Alcuni già accreditati.
                    if i % 2 == 0 {
                        crea_pag(
                            "saldo",
                            totale,
                            true,
                            "",
                            &data_incasso,
                            CONTO_CONTRASSEGNO,
                            true,
                        )?;
                    } else {
                        crea_pag(
                            "saldo",
                            totale,
                            false,
                            &scad_futura,
                            "",
                            CONTO_CONTRASSEGNO,
                            false,
                        )?;
                    }
                }
                "Diagnostica" => {
                    let c = &conti_esistenti[i % conti_esistenti.len()];
                    match i % 3 {
                        0 => crea_pag("saldo", totale, true, "", &data_incasso, c, true)?,
                        1 => crea_pag("saldo", totale, false, &scad_passata, "", c, false)?,
                        _ => crea_pag("saldo", totale, false, &scad_futura, "", c, false)?,
                    }
                }
                _ => {
                    // Immunoterapia: acconto 9000 + saldo, con esiti diversi.
                    let saldo = (totale - 9000).max(0);
                    let c = &conti_esistenti[i % conti_esistenti.len()];
                    if stato == "Nuovo" {
                        // Niente incassato: acconto + saldo ancora attesi.
                        crea_pag("acconto", 9000, false, &scad_passata, "", c, false)?;
                        crea_pag("saldo", saldo, false, &scad_futura, "", c, false)?;
                    } else {
                        crea_pag("acconto", 9000, true, "", &data_incasso, c, true)?;
                        match i % 3 {
                            // saldo saldato (alcuni ancora da verificare), scaduto, o atteso futuro.
                            0 => crea_pag("saldo", saldo, true, "", &data_incasso, c, i % 2 == 0)?,
                            1 => crea_pag("saldo", saldo, false, &scad_passata, "", c, false)?,
                            _ => crea_pag("saldo", saldo, false, &scad_futura, "", c, false)?,
                        }
                    }
                }
            }

            // Crea spedizioni demo se lo stato è Spedito
            if stato == "Spedito" {
                let corrieri = self.records_list("corriere")?;
                if !corrieri.is_empty() {
                    let corr = &corrieri[i % corrieri.len()];
                    let lotto_sped = format!("lotto-sped-{:02}", 1 + (i % 5));
                    let contrassegno = if categoria == "Keriba" { totale } else { 0 };
                    let mezzo = if contrassegno > 0 {
                        if i % 2 == 0 {
                            "contrassegno"
                        } else {
                            "assegno"
                        }
                    } else {
                        ""
                    };
                    let righe_in: Vec<RigaNumeroIn> = righe_create
                        .iter()
                        .map(|r_id| RigaNumeroIn {
                            riga_id: r_id.clone(),
                            numero: format!("VAC-{:04}", i),
                        })
                        .collect();
                    let colli = righe_in.len().max(1) as i64;
                    let peso = colli * 2;
                    if let Ok(sped_dto) = self.spedizione_crea(
                        &lotto_sped,
                        &data,
                        &corr.id,
                        colli,
                        peso,
                        "",
                        false,
                        mezzo,
                        contrassegno,
                        "",
                        &righe_in,
                    ) {
                        let _ = self.with_engine(|engine| {
                            set_fields(engine, "spedizione", &sped_dto.id, &[("demo", json!(true))])
                        });
                    }
                }
            }

            creati += 1;
        }
        Ok(creati)
    }
}
