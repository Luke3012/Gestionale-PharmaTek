use super::*;

/// Crea, se mancanti, i conti speciali built-in (id fissi → conflict-free).
pub(super) fn ensure_builtin_conti(engine: &Engine) -> AppResult<()> {
    for (id, nome, tipo) in [
        (CONTO_CONTRASSEGNO, "Contrassegno", "contrassegno"),
        (CONTO_ASSEGNO, "Assegno", "assegno"),
    ] {
        let presente = engine.with_projection(|p| p.get("conto", id).ok().flatten().is_some());
        if !presente {
            engine.emit("conto", id, EventBody::Created).map_err(es)?;
            set_fields(
                engine,
                "conto",
                id,
                &[
                    ("nome", json!(nome)),
                    ("tipo", json!(tipo)),
                    ("builtin", json!(true)),
                ],
            )?;
        }
    }
    Ok(())
}

pub(super) fn ensure_builtin_corrieri(engine: &Engine) -> AppResult<()> {
    for (id, nome, profilo) in [
        (CORRIERE_CORRIERE_B, "CORRIERE_B", "gls"),
        (CORRIERE_CORRIERE_A, "CORRIERE_A", "corriere_a"),
        (CORRIERE_CORRIERE_C, "CORRIERE_C", "mbe"),
    ] {
        let presente = engine.with_projection(|p| p.get("corriere", id).ok().flatten().is_some());
        if !presente {
            engine
                .emit("corriere", id, EventBody::Created)
                .map_err(es)?;
            set_fields(
                engine,
                "corriere",
                id,
                &[
                    ("nome", json!(nome)),
                    ("profilo", json!(profilo)),
                    ("builtin", json!(true)),
                ],
            )?;
        }
    }
    Ok(())
}

/// Slug per gli id del catalogo produzione: alfanumerici minuscoli, il resto → `_`.
fn pp_slug(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect()
}

/// Crea, se mancanti, le voci canoniche del catalogo «prodotti di produzione» (FASE 5B):
/// formulazioni, posologie, allergeni respiratori e ceppi batterici. Sono i valori di
/// riferimento per i suggerimenti dei dati produzione per riga (Laboratorio). Id fissi
/// (`__pp_<tipo>_<slug>__`) per essere conflict-free fra dispositivi e idempotenti.
/// Le liste descrivono la tassonomia tecnica della demo.
pub(super) fn ensure_prodotti_produzione(engine: &Engine) -> AppResult<()> {
    const FORMULAZIONI: &[&str] = &[
        "polimerizzato",
        "gocce",
        "spray",
        "sottocute",
        "VEB sottocute",
        "depot",
        "nasale",
    ];
    const POSOLOGIE: &[&str] = &["2+2", "3+3", "3", "2+2+2", "1+2+3", "1+2+3+3", "3+3+3", "2"];
    const ALLERGENI: &[&str] = &[
        "d.pteronyssinus",
        "d.farinae",
        "parietaria",
        "mix graminacee",
        "olea europea",
        "cipresso",
        "betulla",
        "alternaria",
        "artemisia",
        "blomia",
        "blomia tropicalis",
        "cynodon",
        "plantago",
        "salsola",
        "ambrosia",
        "chenopodium",
        "acarus siro",
        "l.destructor",
        "t.putrescentiae",
        "a.fumigatus",
        "candida albicans",
        "gatto",
        "cane",
        "cavallo",
        "graminacee",
    ];
    const CEPPI: &[&str] = &[
        "h.influenzae",
        "s.pneumoniae",
        "m.catarrhalis",
        "k.pneumoniae",
        "s.aureus",
        "s.pyogenes",
        "p.aeruginosa",
        "p.mirabilis",
        "e.coli",
        "e.faecalis",
    ];
    // Volumi (ml) ricorrenti della diagnostica (estratti dagli ordini Laboratorio).
    const ML: &[&str] = &["1", "2", "2.5", "3", "5"];
    for (tipo, valori) in [
        ("formulazione", FORMULAZIONI),
        ("posologia", POSOLOGIE),
        ("allergene", ALLERGENI),
        ("ceppo", CEPPI),
        ("ml", ML),
    ] {
        for valore in valori {
            let id = format!("__pp_{}_{}__", tipo, pp_slug(valore));
            let presente = engine
                .with_projection(|p| p.get("prodotto_produzione", &id).ok().flatten().is_some());
            if !presente {
                engine
                    .emit("prodotto_produzione", &id, EventBody::Created)
                    .map_err(es)?;
                set_fields(
                    engine,
                    "prodotto_produzione",
                    &id,
                    &[
                        ("tipo", json!(tipo)),
                        ("valore", json!(valore)),
                        ("builtin", json!(true)),
                    ],
                )?;
            }
        }
    }
    Ok(())
}

/// Id stabile per un record di seed: `__seed_<kind>_<slug>__` (conflict-free fra PC).
pub(super) fn seed_id(kind: &str, nome: &str) -> String {
    format!("__seed_{}_{}__", kind, pp_slug(nome))
}

/// Crea il record `id` con i campi dati solo se non esiste già (idempotente).
fn ensure_record(
    engine: &Engine,
    entity: &str,
    id: &str,
    fields: &[(&str, serde_json::Value)],
) -> AppResult<()> {
    let presente = engine.with_projection(|p| p.get(entity, id).ok().flatten().is_some());
    if !presente {
        engine.emit(entity, id, EventBody::Created).map_err(es)?;
        set_fields(engine, entity, id, fields)?;
    }
    Ok(())
}

/// Conti reali di default (non builtin, eliminabili) e loro ruoli.
pub(super) fn ensure_conti_default(engine: &Engine) -> AppResult<()> {
    let conti = &[
        (
            "9438",
            "Banca Demo 9438",
            "Banca Demo San Paolo S.P.A.",
            "IT00 X000 00DE MO",
            true,
        ),
        (
            "1243",
            "Banca Demo 1243",
            "Banca Demo San Paolo S.P.A.",
            "IT00 X000 00DE MO",
            false,
        ),
        (
            "8376",
            "Banca Demo 8376",
            "Banca Demo San Paolo S.P.A.",
            "IT00 X000 00DE MO",
            false,
        ),
        (
            "2163",
            "Poste 2163",
            "Banca Demo",
            "IT00 B076 01DE MO",
            false,
        ),
    ];
    for (key, nome, banca, iban, predefinito) in conti {
        let id = seed_id("conto", key);
        ensure_record(
            engine,
            "conto",
            &id,
            &[
                ("nome", json!(nome)),
                ("banca", json!(banca)),
                ("iban", json!(iban)),
                ("tipo", json!("banca")),
                ("predefinito_incassi", json!(predefinito)),
                ("predefinito_acconti", json!(predefinito)),
                ("predefinito_accrediti", json!(predefinito)),
                ("predefinito_rimborsi", json!(predefinito)),
                ("builtin", json!(false)),
            ],
        )?;
    }
    Ok(())
}

/// Agenti di partenza (consolidati dagli ordini 2026).
pub(super) fn ensure_agenti_default(engine: &Engine) -> AppResult<()> {
    const AGENTI: &[&str] = &[
        "Agente Demo 001",
        "Agente Demo 002",
        "Agente Demo 003",
        "Pharmatek",
        "Morello",
        "Salis",
        "Sannino",
        "Quaresima",
        "Infarinato",
        "La Cava",
    ];
    for nome in AGENTI {
        let id = seed_id("agente", nome);
        let mut tipo = "fisso";
        let mut valore = 20.0;
        let mut fields = vec![
            ("nome", json!(nome)),
            ("provv_maturazione", json!("spedizione")),
            ("builtin", json!(true)),
        ];
        if *nome == "Agente Demo 003" {
            tipo = "percentuale";
            valore = 15.0;
            fields.push(("conto_saldo_id", json!(seed_id("conto", "8376"))));
            fields.push(("acconto_default", json!(10000)));
        } else if *nome == "Agente Demo 001" || *nome == "Agente Demo 002" {
            tipo = "percentuale";
            valore = 0.0;
        } else if *nome == "Sannino" {
            fields.push(("conto_saldo_id", json!(seed_id("conto", "9438"))));
        }
        fields.push(("provv_tipo", json!(tipo)));
        if valore == 0.0 {
            fields.push(("provv_valore", json!(0)));
        } else {
            fields.push(("provv_valore", json!(valore)));
        }
        ensure_record(engine, "agente", &id, &fields)?;
    }
    Ok(())
}

/// Medici di partenza con il loro **prezzo immunoterapia tipico** (moda dagli ordini Q1
/// 2026, in centesimi) e l'agente di riferimento. I nomi sono in forma propria (Title
/// Case), da rifinire. Id fissi. Il prezzo è solo un default suggerito, sempre editabile.
pub(super) fn ensure_medici_default(engine: &Engine) -> AppResult<()> {
    // (nome, agente, prezzo_immuno_euro)
    const MEDICI: &[(&str, &str, i64)] = &[
        ("Stefano Crescioli", "Agente Demo 002", 400),
        ("Medico Demo 001", "Agente Demo 001", 250),
        ("Medico Demo 002", "Agente Demo 002", 270),
        ("Barbatano", "Agente Demo 002", 345),
        ("Tansella", "Pharmatek", 275),
        ("Cannata", "Agente Demo 003", 320),
        ("Lamanna", "Morello", 250),
        ("Ronchi", "Salis", 340),
        ("Rinciani", "Agente Demo 003", 320),
        ("Cabras", "Salis", 350),
        ("Tourtchenko", "Agente Demo 003", 300),
        ("Cantone", "Agente Demo 001", 375),
        ("Leonetti", "Agente Demo 001", 330),
        ("Casale", "Pharmatek", 511),
        ("Dagnello", "Agente Demo 001", 275),
        ("Caramazza", "Agente Demo 003", 300),
        ("Borrelli", "Agente Demo 001", 275),
        ("Cinquepalmi", "Morello", 275),
        ("Del Giudice", "Agente Demo 001", 200),
        ("Greco", "Agente Demo 001", 275),
        ("Aiello", "Agente Demo 001", 175),
        ("Del Buono", "Sannino", 340),
        ("Berra", "Agente Demo 001", 175),
        ("Kantar", "Agente Demo 001", 260),
        ("Brinch", "Agente Demo 003", 260),
        ("Gaspardini", "Salis", 340),
        ("Falilla", "Agente Demo 001", 275),
        ("Pellegrini", "Agente Demo 001", 270),
        ("Craparo", "Agente Demo 003", 300),
        ("Condoluci", "Agente Demo 001", 270),
        ("Del Mastro", "Sannino", 348),
        ("Di Palma", "La Cava", 275),
        ("Nettis", "Morello", 400),
        ("Florio", "Agente Demo 001", 400),
        ("Sacerdoti", "Sannino", 400),
        ("Businco", "Quaresima", 265),
        ("Marta Boi", "Salis", 175),
        ("Di Leo", "Morello", 270),
        ("Varini", "Quaresima", 360),
        ("Fanelli", "Pharmatek", 270),
        ("Di Bella", "Agente Demo 003", 260),
        ("Trimarchi", "Quaresima", 280),
        ("Savoia", "Sannino", 400),
        ("Puglisi", "Quaresima", 270),
        ("Brivio", "Agente Demo 001", 300),
        ("Fiocchi", "Agente Demo 002", 345),
        ("De Bartolomeis", "Sannino", 275),
        ("Gatta", "Quaresima", 357),
        ("Pannofino", "Morello", 270),
        ("Licitra", "Agente Demo 003", 320),
        ("Di Girolamo", "Morello", 400),
    ];
    for (nome, agente, _prezzo) in MEDICI {
        let id = seed_id("medico", nome);
        let agente_id = seed_id("agente", agente);
        let mut fields = vec![
            ("nome", json!(nome)),
            ("agente_id", json!(agente_id)),
            ("prezzo_immuno_default", json!(0)),
            ("builtin", json!(true)),
        ];
        if *nome == "Stefano Crescioli" {
            fields.push(("conto_saldo_id", json!(seed_id("conto", "8376"))));
        } else if *nome == "Medico Demo 001" || *nome == "Medico Demo 002" {
            fields.push(("conto_saldo_id", json!(seed_id("conto", "1243"))));
            if *nome == "Medico Demo 001" {
                // `ensure_record` applica questo valore solo alla creazione: nessun
                // backfill o modifica sulle installazioni già inizializzate.
                fields.push(("rate_saldo_default", json!(2)));
            }
        } else if *nome == "Lamanna" {
            fields.push(("conto_saldo_id", json!(seed_id("conto", "1243"))));
            fields.push(("acconto_default", json!(9000)));
        } else if *nome == "Del Giudice" {
            fields.push(("acconto_default", json!(9000)));
        } else if *nome == "Leonetti" {
            fields.push(("acconto_default", json!(11500)));
        }
        ensure_record(engine, "medico", &id, &fields)?;
    }
    Ok(())
}

fn ensure_regola_prezzo(
    engine: &Engine,
    id: &str,
    prod_id: &str,
    agente_id: Option<&str>,
    medico_id: Option<&str>,
    prezzo: i64,
) -> AppResult<()> {
    let mut fields = vec![
        ("prodotto_id", json!(prod_id)),
        ("prezzo", json!(prezzo)),
        ("builtin", json!(true)),
    ];
    if let Some(ag) = agente_id {
        fields.push(("agente_id", json!(ag)));
    }
    if let Some(med) = medico_id {
        fields.push(("medico_id", json!(med)));
    }
    ensure_record(engine, "regola_prezzo", id, &fields)
}

/// Regole di listino personalizzate (medico/agente -> prodotto).
pub(super) fn ensure_regole_prezzo_default(engine: &Engine) -> AppResult<()> {
    // Agente Demo 003:
    let blandino = seed_id("agente", "Agente Demo 003");
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "agente_blandino_sub3"),
        &seed_id("prod", "Sublinguale 3 fiale"),
        Some(&blandino),
        None,
        32000,
    )?;
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "agente_blandino_pol2"),
        &seed_id("prod", "Polimerizzato 2 fiale"),
        Some(&blandino),
        None,
        32000,
    )?;

    // Medico Demo 002:
    let runci = seed_id("medico", "Medico Demo 002");
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "medico_runci_sub2"),
        &seed_id("prod", "Sublinguale 2 fiale"),
        None,
        Some(&runci),
        27000,
    )?;
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "medico_runci_lis2"),
        &seed_id("prod", "Lisato batterico 2 fiale"),
        None,
        Some(&runci),
        27000,
    )?;
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "medico_runci_lis3"),
        &seed_id("prod", "Lisato batterico 3 fiale"),
        None,
        Some(&runci),
        27000,
    )?;
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "medico_runci_lis4"),
        &seed_id("prod", "Lisato batterico 4 fiale"),
        None,
        Some(&runci),
        27000,
    )?;

    // Medico Demo 001:
    let santiago = seed_id("medico", "Medico Demo 001");
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "medico_santiago_sub2"),
        &seed_id("prod", "Sublinguale 2 fiale"),
        None,
        Some(&santiago),
        25000,
    )?;

    // Sannino:
    let sannino = seed_id("agente", "Sannino");
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "agente_sannino_sub2"),
        &seed_id("prod", "Sublinguale 2 fiale"),
        Some(&sannino),
        None,
        28000,
    )?;
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "agente_sannino_pol1"),
        &seed_id("prod", "Polimerizzato 1 fiala"),
        Some(&sannino),
        None,
        28000,
    )?;
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "agente_sannino_sub3"),
        &seed_id("prod", "Sublinguale 3 fiale"),
        Some(&sannino),
        None,
        35000,
    )?;
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "agente_sannino_pol2"),
        &seed_id("prod", "Polimerizzato 2 fiale"),
        Some(&sannino),
        None,
        40000,
    )?;

    // Lamanna:
    let lamanna = seed_id("medico", "Lamanna");
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "medico_lamanna_pol1"),
        &seed_id("prod", "Polimerizzato 1 fiala"),
        None,
        Some(&lamanna),
        25000,
    )?;
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "medico_lamanna_sub2"),
        &seed_id("prod", "Sublinguale 2 fiale"),
        None,
        Some(&lamanna),
        25000,
    )?;

    // Del Giudice:
    let del_giudice = seed_id("medico", "Del Giudice");
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "medico_delgiudice_pol1"),
        &seed_id("prod", "Polimerizzato 1 fiala"),
        None,
        Some(&del_giudice),
        21000,
    )?;
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "medico_delgiudice_sub2"),
        &seed_id("prod", "Sublinguale 2 fiale"),
        None,
        Some(&del_giudice),
        21000,
    )?;

    // Leonetti:
    let leonetti = seed_id("medico", "Leonetti");
    ensure_regola_prezzo(
        engine,
        &seed_id("regola", "medico_leonetti_pol2"),
        &seed_id("prod", "Polimerizzato 2 fiale"),
        None,
        Some(&leonetti),
        37500,
    )?;

    Ok(())
}

/// Parametri globali provvigioni agenti.
pub(super) fn ensure_parametri_globali_default(engine: &Engine) -> AppResult<()> {
    ensure_record(
        engine,
        "parametri_globali",
        "agenti",
        &[
            ("scorpora_iva", json!(true)),
            ("detrai_spedizione", json!(true)),
            ("quota_spedizione", json!(3000)),
        ],
    )?;
    ensure_record(
        engine,
        "parametri_globali",
        "prodotti",
        &[
            ("soglia_prezzo", json!(30000)),
            ("acconto_prezzo_basso", json!(9000)),
            ("acconto_prezzo_alto", json!(11500)),
        ],
    )?;
    Ok(())
}

/// Prodotti di partenza: gli allergeni/ceppi dell'immunoterapia (il prezzo vero è
/// per-medico → base di riserva 270€) e i tre Keriba a 60€/confezione. Id fissi.
pub(super) fn ensure_prodotti_default(engine: &Engine) -> AppResult<()> {
    // Prodotti immunoterapia = **tipo di preparazione × n° fiale** (è ciò che ha un prezzo e si
    // manda in produzione). Le tre famiglie e i prezzi base sono definiti dal catalogo dimostrativo.
    // + storico). Prezzi in centesimi, editabili nel listino. (nome, prezzo_cent)
    const IMMUNO: &[(&str, i64)] = &[
        ("Sublinguale 2 fiale", 0),
        ("Sublinguale 3 fiale", 0),
        ("Polimerizzato 1 fiala", 0),
        ("Polimerizzato 2 fiale", 0),
        ("Lisato batterico 2 fiale", 0),
        ("Lisato batterico 3 fiale", 0),
        ("Lisato batterico 4 fiale", 0),
    ];
    for (nome, prezzo) in IMMUNO {
        let id = seed_id("prod", nome);
        ensure_record(
            engine,
            "prodotto",
            &id,
            &[
                ("nome", json!(nome)),
                ("categoria", json!("Immunoterapia")),
                ("prezzo_base_default", json!(prezzo)),
                ("builtin", json!(true)),
            ],
        )?;
    }
    // Rimuove definitivamente i vecchi prodotti immunoterapia builtin che non fanno più
    // parte del catalogo. L'unico prodotto rinominabile senza perdere significato,
    // "Sublinguale 1 fiala", confluisce nel formato valido a 2 fiale. I vecchi allergeni
    // restano invece come testo libero sulle righe storiche: non sono preparazioni vendibili.
    let validi: HashSet<String> = IMMUNO
        .iter()
        .map(|(nome, _)| seed_id("prod", nome))
        .collect();
    let obsoleti: Vec<(String, String)> = engine.with_projection(|p| {
        p.list("prodotto")
            .unwrap_or_default()
            .into_iter()
            .chain(p.list_deleted("prodotto").unwrap_or_default())
            .filter(|r| {
                str_field(&r.data, "categoria") == "Immunoterapia"
                    && r.data.get("builtin") == Some(&json!(true))
                    && !validi.contains(&r.id)
            })
            .map(|r| (r.id, str_field(&r.data, "nome")))
            .collect()
    });
    for (prodotto_id, nome) in obsoleti {
        let destinazione = (nome == "Sublinguale 1 fiala").then(|| {
            (
                seed_id("prod", "Sublinguale 2 fiale"),
                "Sublinguale 2 fiale",
            )
        });
        let righe: Vec<String> = engine.with_projection(|p| {
            p.list("riga_ordine")
                .unwrap_or_default()
                .into_iter()
                .chain(p.list_deleted("riga_ordine").unwrap_or_default())
                .filter(|r| str_field(&r.data, "prodotto_id") == prodotto_id)
                .map(|r| r.id)
                .collect()
        });
        for riga_id in righe {
            if let Some((destinazione_id, destinazione_nome)) = &destinazione {
                set_fields(
                    engine,
                    "riga_ordine",
                    &riga_id,
                    &[
                        ("prodotto_id", json!(destinazione_id)),
                        ("prodotto_nome", json!(destinazione_nome)),
                    ],
                )?;
            } else {
                set_fields(
                    engine,
                    "riga_ordine",
                    &riga_id,
                    &[("prodotto_id", json!("")), ("prodotto_nome", json!(nome))],
                )?;
            }
        }

        let regole: Vec<String> = engine.with_projection(|p| {
            p.list("regola_prezzo")
                .unwrap_or_default()
                .into_iter()
                .chain(p.list_deleted("regola_prezzo").unwrap_or_default())
                .filter(|r| str_field(&r.data, "prodotto_id") == prodotto_id)
                .map(|r| r.id)
                .collect()
        });
        for regola_id in regole {
            if let Some((destinazione_id, _)) = &destinazione {
                set_fields(
                    engine,
                    "regola_prezzo",
                    &regola_id,
                    &[("prodotto_id", json!(destinazione_id))],
                )?;
            } else {
                engine
                    .emit("regola_prezzo", &regola_id, EventBody::Purged)
                    .map_err(es)?;
            }
        }

        engine
            .emit("prodotto", &prodotto_id, EventBody::Purged)
            .map_err(es)?;
    }
    for nome in ["Keriba Forte", "Keriba Sport", "Keriba Duo"] {
        let id = seed_id("prod", nome);
        ensure_record(
            engine,
            "prodotto",
            &id,
            &[
                ("nome", json!(nome)),
                ("categoria", json!("Keriba")),
                ("prezzo_base_default", json!(0)),
                ("builtin", json!(true)),
            ],
        )?;
    }
    Ok(())
}

/// Catalogo **Diagnostica** standard (estratti per prick test / intradermo): è il listino
/// Laboratorio ufficiale, con **codice** (es. `A-004`) e nome dell'allergene/estratto. Seminato
/// come `prodotto` categoria «Diagnostica» (id fisso sul codice), col `codice_laboratorio` salvato
/// per l'export. Prezzo base 15€/fiala come riserva (editabile). Fonte: catalogo dimostrativo.
pub(super) fn ensure_prodotti_diagnostica(engine: &Engine) -> AppResult<()> {
    const DIAG: &[(&str, &str)] = &[
        ("A-001", "DPF"),
        ("A-002", "DPT"),
        ("A-004", "Acarus siro"),
        ("A-005", "Blomia tropicalis"),
        ("A-007", "Lepidoglyphus destructor"),
        ("F-001", "Rabbit (alimento)"),
        ("F-002", "Pork"),
        ("F-003", "Lamb"),
        ("F-004", "Turkey"),
        ("F-005", "Chicken"),
        ("F-006", "Beef"),
        ("F-023", "Strawberry"),
        ("F-030", "Pineapple"),
        ("F-033", "Kiwi"),
        ("F-040", "Almond"),
        ("F-042", "Peanut"),
        ("F-043", "Chestnut"),
        ("F-044", "Coconut"),
        ("F-045", "Walnut"),
        ("F-048", "Pistachio"),
        ("F-050", "Garlic"),
        ("F-052", "Eggplant"),
        ("F-073", "Paprika"),
        ("F-100", "Cow Fresh Milk"),
        ("F-101", "Ovoalbumin"),
        ("F-107", "Emperor Fish"),
        ("F-110", "Tuna"),
        ("F-111", "Cod"),
        ("F-114", "Sole"),
        ("F-115", "Bass"),
        ("F-117", "Salmon"),
        ("F-129", "Squid"),
        ("F-130", "Clam"),
        ("F-131", "Crab"),
        ("F-132", "Shrimp / Prawn"),
        ("F-133", "Lobster"),
        ("F-134", "Mussel"),
        ("M-009", "Cladosporium herbarum"),
        ("P-003", "Betulla"),
        ("P-005", "Cupressus sempervirens Mediterranean Cypress"),
        ("P-012", "Olea europaea Olive Tree"),
        ("P-058", "Cynodon dactylon Bermuda Grass"),
        ("P-064", "Lolium perenne Rye Grass"),
        ("P-093", "MIX GRAMINACEE ESPONTANEAS"),
        ("P-103", "Artemisia"),
        ("P-105", "Parietaria"),
        ("P-108", "Salsola"),
    ];
    for (codice, nome) in DIAG {
        let id = seed_id("proddiag", codice);
        ensure_record(
            engine,
            "prodotto",
            &id,
            &[
                ("nome", json!(nome)),
                ("categoria", json!("Diagnostica")),
                ("codice_laboratorio", json!(codice)),
                ("prezzo_base_default", json!(0)),
                ("builtin", json!(true)),
            ],
        )?;
    }
    Ok(())
}
