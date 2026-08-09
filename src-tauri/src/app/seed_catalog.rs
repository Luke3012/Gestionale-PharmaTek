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

pub(super) fn ensure_builtin_corrieri(_engine: &Engine) -> AppResult<()> {
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
pub(super) fn ensure_conti_default(_engine: &Engine) -> AppResult<()> {
    Ok(())
}

/// Agenti di partenza (consolidati dagli ordini 2026).
pub(super) fn ensure_agenti_default(_engine: &Engine) -> AppResult<()> {
    Ok(())
}

/// Medici di partenza con il loro **prezzo immunoterapia tipico** (moda dagli ordini Q1
/// 2026, in centesimi) e l'agente di riferimento. I nomi sono in forma propria (Title
/// Case), da rifinire. Id fissi. Il prezzo è solo un default suggerito, sempre editabile.
pub(super) fn ensure_medici_default(_engine: &Engine) -> AppResult<()> {
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
pub(super) fn ensure_regole_prezzo_default(_engine: &Engine) -> AppResult<()> {
    Ok(())
}

/// Parametri globali provvigioni agenti.
pub(super) fn ensure_parametri_globali_default(_engine: &Engine) -> AppResult<()> {
    Ok(())
}

/// Catalogo pubblico: nomi e categorie, senza valori economici preconfigurati.
pub(super) fn ensure_prodotti_default(engine: &Engine) -> AppResult<()> {
    // Prodotti immunoterapia = **tipo di preparazione × n° fiale** (è ciò che ha un prezzo e si
    // manda in produzione). I prezzi restano a zero finché l'utente non li configura.
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

/// Catalogo tecnico dimostrativo: nomi e categoria, senza codici o prezzi.
pub(super) fn ensure_prodotti_diagnostica(engine: &Engine) -> AppResult<()> {
    const DIAG: &[&str] = &[
        "DPF",
        "DPT",
        "Acarus siro",
        "Blomia tropicalis",
        "Lepidoglyphus destructor",
        "Rabbit (alimento)",
        "Pork",
        "Lamb",
        "Turkey",
        "Chicken",
        "Beef",
        "Strawberry",
        "Pineapple",
        "Kiwi",
        "Almond",
        "Peanut",
        "Chestnut",
        "Coconut",
        "Walnut",
        "Pistachio",
        "Garlic",
        "Eggplant",
        "Paprika",
        "Cow Fresh Milk",
        "Ovoalbumin",
        "Emperor Fish",
        "Tuna",
        "Cod",
        "Sole",
        "Bass",
        "Salmon",
        "Squid",
        "Clam",
        "Crab",
        "Shrimp / Prawn",
        "Lobster",
        "Mussel",
        "Cladosporium herbarum",
        "Betulla",
        "Cupressus sempervirens Mediterranean Cypress",
        "Olea europaea Olive Tree",
        "Cynodon dactylon Bermuda Grass",
        "Lolium perenne Rye Grass",
        "MIX GRAMINACEE ESPONTANEAS",
        "Artemisia",
        "Parietaria",
        "Salsola",
    ];
    for nome in DIAG {
        let id = seed_id("proddiag", nome);
        ensure_record(
            engine,
            "prodotto",
            &id,
            &[
                ("nome", json!(nome)),
                ("categoria", json!("Diagnostica")),
                ("codice_fornitore", json!("")),
                ("prezzo_base_default", json!(0)),
                ("builtin", json!(true)),
            ],
        )?;
    }
    Ok(())
}
