use super::*;
use calamine::Reader;
use serde_json::json;

#[test]
fn risveglio_outbox_non_perde_un_segnale_anticipato() {
    let wake = CommunicationWake::default();
    let token = wake.token();
    wake.signal();

    let aggiornato = wake.wait_after(token, Duration::from_secs(1));

    assert_ne!(aggiornato, token);
}

fn campi(pairs: &[(&str, serde_json::Value)]) -> serde_json::Map<String, serde_json::Value> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}

/// Helper test: una riga da spedire col suo numero/lotto (FASE 7).
fn rn(riga_id: &str, numero: &str) -> RigaNumeroIn {
    RigaNumeroIn {
        riga_id: riga_id.to_string(),
        numero: numero.to_string(),
    }
}

#[test]
fn nome_prodotto_catalogo_o_libero() {
    let cat: HashMap<String, String> = [("p1".to_string(), "Vaccino".to_string())]
        .into_iter()
        .collect();
    // Prodotto di catalogo: nome dal record (autorevole).
    let r1 = campi(&[("prodotto_id", json!("p1"))]);
    assert_eq!(nome_riga_prodotto(&cat, "p1", &r1), "Vaccino");
    // Prodotto libero: prodotto_id vuoto → nome dal testo della riga.
    let r2 = campi(&[("prodotto_nome", json!("Garze sterili"))]);
    assert_eq!(nome_riga_prodotto(&cat, "", &r2), "Garze sterili");
    // Id non più in catalogo → fallback al testo se presente.
    let r3 = campi(&[
        ("prodotto_id", json!("px")),
        ("prodotto_nome", json!("Vecchio")),
    ]);
    assert_eq!(nome_riga_prodotto(&cat, "px", &r3), "Vecchio");
}

#[test]
fn proroga_pagamenti_e_atomica_e_idempotente_per_campagna() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    fs::write(app.path().join("premium.json"), br#"{"enabled":true}"#).unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Tester");
    let ordine = state
        .ordine_salva_base(OrdineSalvaBaseInput {
            id: None,
            rimborso_extra: None,
            expected_righe: Vec::new(),
            fields: campi(&[("stato", json!("Confermato"))]),
            righe: vec![OrdineSalvaRigaInput {
                id: None,
                fields: campi(&[
                    ("prodotto_nome", json!("Prodotto")),
                    ("qta", json!(1)),
                    ("prezzo", json!(10_000)),
                ]),
            }],
        })
        .unwrap();
    let pagamento = state
        .pagamento_registra(
            &ordine.id,
            "rata",
            10_000,
            false,
            "2026-07-20",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    let input = ProrogaPagamentoInput {
        id: pagamento.id.clone(),
        revision: pagamento.revision.clone(),
        vecchia_scadenza: "2026-07-20".into(),
        nuova_scadenza: "2026-07-27".into(),
    };

    assert_eq!(
        state
            .pagamenti_proroga_sette_giorni("campagna:proroga", vec![input.clone()])
            .unwrap(),
        1
    );
    assert_eq!(
        state.pagamenti_ordine(&ordine.id).unwrap()[0].scadenza,
        "2026-07-27"
    );
    assert_eq!(
        state
            .pagamenti_proroga_sette_giorni("campagna:proroga", vec![input.clone()])
            .unwrap(),
        1,
        "il retry della stessa campagna non aggiunge altri sette giorni"
    );
    assert_eq!(
        state.pagamenti_ordine(&ordine.id).unwrap()[0].scadenza,
        "2026-07-27"
    );
    assert!(state
        .pagamenti_proroga_sette_giorni("campagna:diversa", vec![input])
        .is_err());
}

#[test]
fn numeri_lotto_multipli_non_introducono_a_capo_nel_numero_collo() {
    assert!(valida_numeri_lotto(3, "LOT-100\nLOT-101\nLOT-102").is_ok());
    assert!(valida_numeri_lotto(3, "LOT-100").is_err());
    assert!(
        valida_numeri_lotto(3, "").is_ok(),
        "il lotto resta facoltativo"
    );
    assert_eq!(
        AppState::fondi_numeri(&["LOT-100\nLOT-101".to_string(), "LOT-102".to_string()]),
        "LOT-100/1/2"
    );
}

fn onboarda(state: &AppState, data_dir: &str, nome: &str) -> IdentityDto {
    state.open_data_dir(data_dir).unwrap();
    state
        .finish_onboarding(FinishOnboarding {
            data_dir: data_dir.to_string(),
            mode: "create".into(),
            user_id: Some(Ulid::generate().to_string()),
            nome: nome.into(),
            avatar_tipo: "iniziali".into(),
            avatar_valore: String::new(),
        })
        .unwrap()
}

fn semina_restore_storico_gestito(
    state: &AppState,
    app_dir: &Path,
    data_dir: &Path,
    restore_id: &str,
) {
    fs::create_dir_all(data_dir.join("events")).unwrap();
    fs::write(
        data_dir.join("events/.restore-PC-STORICO-100.marker"),
        serde_json::to_vec(&json!({ "restoreId": restore_id })).unwrap(),
    )
    .unwrap();
    fs::write(
        app_dir.join(format!(
            "restore-handled-{}.json",
            state.bootstrap().device_id
        )),
        serde_json::to_vec(&json!({ "ids": [restore_id] })).unwrap(),
    )
    .unwrap();
}

#[test]
fn cambio_cf_ricandida_il_cliente_aruba_senza_ricandidare_salvataggi_invariati() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Tester");

    let senza_cf = state
        .record_create(
            "cliente",
            campi(&[
                ("nome", json!("Cliente senza CF")),
                ("aruba_esportato_il", json!("2026-07-01T10:00:00Z")),
            ]),
        )
        .unwrap();
    let ricandidato = state
        .record_update(
            "cliente",
            &senza_cf.id,
            campi(&[("cf", json!("RSSMRA80A01H501U"))]),
        )
        .unwrap();
    assert_eq!(ricandidato.data.get("aruba_esportato_il"), Some(&json!("")));
    assert_eq!(ricandidato.data.get("aruba_cf_esportato"), Some(&json!("")));
    assert!(ricandidato
        .data
        .get("aruba_ricandidato_il")
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.is_empty()));

    let con_cf = state
        .record_create(
            "cliente",
            campi(&[
                ("nome", json!("Cliente con CF")),
                ("cf", json!("VRDLGI80A01H501X")),
                ("aruba_esportato_il", json!("2026-07-02T10:00:00Z")),
            ]),
        )
        .unwrap();
    let cambiato = state
        .record_update(
            "cliente",
            &con_cf.id,
            campi(&[("cf", json!("BNCLGI80A01H501Y"))]),
        )
        .unwrap();
    assert_eq!(cambiato.data.get("aruba_esportato_il"), Some(&json!("")));
    assert_eq!(cambiato.data.get("aruba_cf_esportato"), Some(&json!("")));
    assert!(cambiato
        .data
        .get("aruba_ricandidato_il")
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.is_empty()));

    state
        .record_update(
            "cliente",
            &con_cf.id,
            campi(&[("aruba_esportato_il", json!("2026-07-03T10:00:00Z"))]),
        )
        .unwrap();
    let invariato = state
        .record_update(
            "cliente",
            &con_cf.id,
            campi(&[
                ("cf", json!(" bnclgi80a01h501y ")),
                ("telefono", json!("055123456")),
            ]),
        )
        .unwrap();
    assert_eq!(
        invariato.data.get("aruba_esportato_il"),
        Some(&json!("2026-07-03T10:00:00Z"))
    );
}

#[test]
fn dedup_che_completa_il_cf_ricandida_aruba_senza_alterare_i_conteggi() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Tester");

    let canonico = state
        .record_create(
            "cliente",
            campi(&[
                ("nome", json!("Mario Rossi")),
                ("aruba_esportato_il", json!("2026-07-01T10:00:00Z")),
            ]),
        )
        .unwrap();
    let duplicato = state
        .record_create(
            "cliente",
            campi(&[
                ("nome", json!("Mario Rossi")),
                ("cf", json!("RSSMRA80A01H501U")),
            ]),
        )
        .unwrap();

    let risultato = state
        .clienti_deduplica_applica(vec![DedupClienteMergeInput {
            canonico_id: canonico.id.clone(),
            duplicati_ids: vec![duplicato.id.clone()],
            fields: campi(&[("cf", json!("RSSMRA80A01H501U"))]),
            snapshots: [
                (canonico.id.clone(), canonico.data.clone()),
                (duplicato.id.clone(), duplicato.data.clone()),
            ]
            .into_iter()
            .collect(),
        }])
        .unwrap();

    assert_eq!(risultato.campi_completati, 1);
    let aggiornato = state.record_get("cliente", &canonico.id).unwrap().unwrap();
    assert_eq!(aggiornato.data.get("cf"), Some(&json!("RSSMRA80A01H501U")));
    assert_eq!(aggiornato.data.get("aruba_esportato_il"), Some(&json!("")));
    assert_eq!(aggiornato.data.get("aruba_cf_esportato"), Some(&json!("")));
    assert!(aggiornato
        .data
        .get("aruba_ricandidato_il")
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.is_empty()));
}

#[test]
fn ordine_salva_base_applica_l_ultimo_salvataggio_sui_campi_inviati() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Tester");

    let creato = state
        .ordine_salva_base(OrdineSalvaBaseInput {
            id: None,
            rimborso_extra: None,
            expected_righe: Vec::new(),
            fields: campi(&[("stato", json!("Nuovo"))]),
            righe: vec![OrdineSalvaRigaInput {
                id: None,
                fields: campi(&[
                    ("prodotto_nome", json!("Prodotto libero")),
                    ("qta", json!(1)),
                    ("prezzo", json!(100)),
                ]),
            }],
        })
        .unwrap();
    let riga = &creato.righe[0];

    state
        .record_update(
            "ordine",
            &creato.id,
            campi(&[("note", json!("nota remota da conservare"))]),
        )
        .unwrap();
    state
        .record_update(
            "riga_ordine",
            &riga.id,
            campi(&[
                ("prezzo", json!(999)),
                ("paziente", json!("Paziente remoto")),
            ]),
        )
        .unwrap();

    state
        .ordine_salva_base(OrdineSalvaBaseInput {
            id: Some(creato.id.clone()),
            rimborso_extra: None,
            expected_righe: vec![RecordIdInput {
                id: riga.id.clone(),
            }],
            fields: campi(&[("stato", json!("Confermato"))]),
            righe: vec![OrdineSalvaRigaInput {
                id: Some(riga.id.clone()),
                fields: campi(&[("prezzo", json!(200))]),
            }],
        })
        .expect("l'ultimo salvataggio deve vincere sui campi inviati");

    let ordine = state.record_get("ordine", &creato.id).unwrap().unwrap();
    assert_eq!(ordine.data.get("stato"), Some(&json!("Confermato")));
    assert_eq!(
        ordine.data.get("note"),
        Some(&json!("nota remota da conservare"))
    );
    let riga_corrente = state.record_get("riga_ordine", &riga.id).unwrap().unwrap();
    assert_eq!(riga_corrente.data.get("prezzo"), Some(&json!(200)));
    assert_eq!(
        riga_corrente.data.get("paziente"),
        Some(&json!("Paziente remoto"))
    );
}

#[test]
fn ordine_salva_base_non_rimuove_una_riga_spedita_nel_frattempo() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Tester");

    let ordine = state
        .record_create("ordine", campi(&[("stato", json!("Confermato"))]))
        .unwrap();
    let riga = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id)),
                ("qta", json!(1)),
                ("prezzo", json!(100)),
            ]),
        )
        .unwrap();

    state
        .record_update(
            "riga_ordine",
            &riga.id,
            campi(&[
                ("stato_riga", json!("spedita")),
                ("spedizione_id", json!("SP-REMOTA")),
            ]),
        )
        .unwrap();

    let errore = match state.ordine_salva_base(OrdineSalvaBaseInput {
        id: Some(ordine.id),
        rimborso_extra: None,
        expected_righe: vec![RecordIdInput {
            id: riga.id.clone(),
        }],
        fields: campi(&[]),
        righe: Vec::new(),
    }) {
        Ok(_) => panic!("una riga già spedita non doveva essere rimossa"),
        Err(errore) => errore,
    };

    assert!(errore.contains("già stata spedita"), "{errore}");
    assert!(state.record_get("riga_ordine", &riga.id).unwrap().is_some());
}

#[test]
fn ordine_salva_base_aggiorna_crea_e_rimuove_righe_nello_stesso_batch() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Tester");

    let creato = state
        .ordine_salva_base(OrdineSalvaBaseInput {
            id: None,
            rimborso_extra: None,
            expected_righe: Vec::new(),
            fields: campi(&[("stato", json!("Nuovo")), ("numero", json!("O-1"))]),
            righe: vec![
                OrdineSalvaRigaInput {
                    id: None,
                    fields: campi(&[
                        ("prodotto_nome", json!("Da mantenere")),
                        ("qta", json!(1)),
                        ("prezzo", json!(100)),
                    ]),
                },
                OrdineSalvaRigaInput {
                    id: None,
                    fields: campi(&[
                        ("prodotto_nome", json!("Da rimuovere")),
                        ("qta", json!(1)),
                        ("prezzo", json!(50)),
                    ]),
                },
            ],
        })
        .unwrap();
    let mantenuta = creato
        .righe
        .iter()
        .find(|riga| riga.data.get("prodotto_nome") == Some(&json!("Da mantenere")))
        .unwrap();
    let rimossa = creato
        .righe
        .iter()
        .find(|riga| riga.data.get("prodotto_nome") == Some(&json!("Da rimuovere")))
        .unwrap();

    let aggiornato = state
        .ordine_salva_base(OrdineSalvaBaseInput {
            id: Some(creato.id.clone()),
            rimborso_extra: None,
            expected_righe: creato
                .righe
                .iter()
                .map(|riga| RecordIdInput {
                    id: riga.id.clone(),
                })
                .collect(),
            fields: campi(&[("stato", json!("Confermato")), ("numero", json!("O-2"))]),
            righe: vec![
                OrdineSalvaRigaInput {
                    id: Some(mantenuta.id.clone()),
                    fields: campi(&[
                        // Il backend deve imporre il legame con l'ordine verificato.
                        ("ordine_id", json!("ordine-estraneo")),
                        ("prodotto_nome", json!("Aggiornata")),
                        ("qta", json!(2)),
                        ("prezzo", json!(125)),
                    ]),
                },
                OrdineSalvaRigaInput {
                    id: None,
                    fields: campi(&[
                        ("prodotto_nome", json!("Nuova")),
                        ("qta", json!(1)),
                        ("prezzo", json!(75)),
                    ]),
                },
            ],
        })
        .unwrap();

    assert_eq!(
        aggiornato.ordine.data.get("stato"),
        Some(&json!("Confermato"))
    );
    assert_eq!(aggiornato.ordine.data.get("numero"), Some(&json!("O-2")));
    assert_ne!(aggiornato.ordine.revision, creato.ordine.revision);
    assert_eq!(aggiornato.righe.len(), 2);
    let mantenuta_aggiornata = aggiornato
        .righe
        .iter()
        .find(|riga| riga.id == mantenuta.id)
        .unwrap();
    assert_eq!(
        mantenuta_aggiornata.data.get("ordine_id"),
        Some(&json!(creato.id.clone()))
    );
    assert_eq!(
        mantenuta_aggiornata.data.get("prodotto_nome"),
        Some(&json!("Aggiornata"))
    );
    assert_ne!(mantenuta_aggiornata.revision, mantenuta.revision);
    assert!(state
        .record_get("riga_ordine", &rimossa.id)
        .unwrap()
        .is_none());
}

#[test]
fn ordine_salva_base_adegua_il_rimborso_extra_nello_stesso_batch() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Tester");
    let conto = state.records_list("conto").unwrap().remove(0);

    let creato = state
        .ordine_salva_base(OrdineSalvaBaseInput {
            id: None,
            rimborso_extra: None,
            expected_righe: Vec::new(),
            fields: campi(&[("stato", json!("Confermato"))]),
            righe: vec![OrdineSalvaRigaInput {
                id: None,
                fields: campi(&[
                    ("prodotto_nome", json!("Prodotto")),
                    ("qta", json!(1)),
                    ("prezzo", json!(28_000)),
                ]),
            }],
        })
        .unwrap();
    let riga_id = creato.righe[0].id.clone();
    state
        .pagamento_registra(
            &creato.id,
            "saldo",
            50_500,
            true,
            "",
            &conto.id,
            "2026-07-16",
            true,
            None,
        )
        .unwrap();
    let rimborso = state
        .rimborso_salva(
            "",
            "2026-07-16",
            22_500,
            "Cliente",
            "Soldi in eccesso",
            "",
            "",
            "",
            "",
            &creato.id,
            "extra",
        )
        .unwrap();

    state
        .ordine_salva_base(OrdineSalvaBaseInput {
            id: Some(creato.id.clone()),
            rimborso_extra: Some(OrdineSalvaRimborsoInput {
                id: rimborso.id.clone(),
                importo: 20_500,
            }),
            expected_righe: vec![RecordIdInput {
                id: riga_id.clone(),
            }],
            fields: campi(&[]),
            righe: vec![OrdineSalvaRigaInput {
                id: Some(riga_id.clone()),
                fields: campi(&[("prezzo", json!(30_000))]),
            }],
        })
        .expect("ordine e rimborso devono essere adeguati insieme");

    assert_eq!(
        state
            .record_get("rimborso", &rimborso.id)
            .unwrap()
            .unwrap()
            .data
            .get("importo"),
        Some(&json!(20_500))
    );

    let errore = match state.ordine_salva_base(OrdineSalvaBaseInput {
        id: Some(creato.id.clone()),
        rimborso_extra: Some(OrdineSalvaRimborsoInput {
            id: rimborso.id.clone(),
            importo: 99_999,
        }),
        expected_righe: vec![RecordIdInput {
            id: riga_id.clone(),
        }],
        fields: campi(&[]),
        righe: vec![OrdineSalvaRigaInput {
            id: Some(riga_id.clone()),
            fields: campi(&[("prezzo", json!(32_000))]),
        }],
    }) {
        Ok(_) => panic!("un importo ormai obsoleto deve annullare l'intero batch"),
        Err(errore) => errore,
    };
    assert!(errore.contains("sono cambiati"), "{errore}");
    assert_eq!(
        state
            .record_get("riga_ordine", &riga_id)
            .unwrap()
            .unwrap()
            .data
            .get("prezzo"),
        Some(&json!(30_000))
    );
    assert_eq!(
        state
            .record_get("rimborso", &rimborso.id)
            .unwrap()
            .unwrap()
            .data
            .get("importo"),
        Some(&json!(20_500))
    );
}

#[test]
fn pagamento_salda_checked_preserva_i_campi_remoti_non_inviati() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Tester");
    let conto = state.records_list("conto").unwrap().remove(0);
    let ordine = state
        .record_create("ordine", campi(&[("stato", json!("Nuovo"))]))
        .unwrap();
    let pagamento = state
        .pagamento_registra(
            &ordine.id,
            "saldo",
            100,
            false,
            "2026-07-20",
            &conto.id,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .record_update(
            "pagamento",
            &pagamento.id,
            campi(&[("note", json!("modifica remota"))]),
        )
        .unwrap();

    state
        .pagamento_salda_checked(
            &pagamento.id,
            &conto.id,
            "2026-07-15",
            true,
            campi(&[("importo", json!(200))]),
        )
        .expect("il saldo deve applicare la patch locale");

    let corrente = state
        .record_get("pagamento", &pagamento.id)
        .unwrap()
        .unwrap();
    assert_eq!(corrente.data.get("importo"), Some(&json!(200)));
    assert_eq!(corrente.data.get("saldato"), Some(&json!(true)));
    assert_eq!(corrente.data.get("note"), Some(&json!("modifica remota")));
}

#[test]
fn pagamento_salda_checked_applica_transizione_e_chiusura_attesi_in_un_batch() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Tester");
    let conto = state.records_list("conto").unwrap().remove(0);
    let ordine = state
        .record_create("ordine", campi(&[("stato", json!("Nuovo"))]))
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id.clone())),
                ("qta", json!(1)),
                ("prezzo", json!(100)),
            ]),
        )
        .unwrap();
    let da_saldare = state
        .pagamento_registra(
            &ordine.id,
            "saldo",
            80,
            false,
            "2026-07-20",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    let altro_atteso = state
        .pagamento_registra(
            &ordine.id,
            "rata",
            20,
            false,
            "2026-08-20",
            "",
            "",
            false,
            None,
        )
        .unwrap();

    let saldato = state
        .pagamento_salda_checked(
            &da_saldare.id,
            &conto.id,
            "2026-07-15",
            true,
            campi(&[
                ("importo", json!(100)),
                ("note", json!("incasso definitivo")),
                // I campi della transizione non devono essere alterabili dalla patch.
                ("ordine_id", json!("ordine-estraneo")),
                ("conto_id", json!("conto-estraneo")),
                ("saldato", json!(false)),
            ]),
        )
        .unwrap();

    assert!(saldato.saldato);
    assert_eq!(saldato.ordine_id, ordine.id);
    assert_eq!(saldato.conto_id, conto.id);
    assert_eq!(saldato.data, "2026-07-15");
    assert_eq!(saldato.importo, 100);
    assert_eq!(saldato.note, "incasso definitivo");
    assert!(saldato.verificato);
    let ordine_corrente = state.record_get("ordine", &ordine.id).unwrap().unwrap();
    assert_eq!(
        ordine_corrente.data.get("stato"),
        Some(&json!("Confermato"))
    );
    assert!(
        state
            .record_get("pagamento", &altro_atteso.id)
            .unwrap()
            .is_none(),
        "la rata attesa residua deve essere eliminata definitivamente"
    );
    assert!(
        state
            .cestino()
            .unwrap()
            .iter()
            .all(|item| item.id != altro_atteso.id),
        "una rata eliminata automaticamente non deve entrare nel Cestino"
    );
}

#[test]
fn bootstrap_cartella_eventi_vuota_non_reset_configurazione() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let device_id = state.config().device_id;
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.data_dir = Some(data.path().to_string_lossy().into_owned());
        cfg.user_id = Some("utente-test".to_string());
    }

    let boot = state.bootstrap();

    assert_eq!(boot.data_dir_status, "missing_or_empty");
    assert_eq!(boot.device_id, device_id);
    assert_eq!(
        boot.data_dir.as_deref(),
        Some(data.path().to_str().unwrap())
    );
}

#[test]
fn bootstrap_cartella_eventi_senza_log_ndjson_e_mancante() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    fs::create_dir_all(data.path().join("events")).unwrap();
    fs::write(data.path().join("events").join("note.txt"), "non e' un log").unwrap();

    let state = AppState::init(app.path().to_path_buf()).unwrap();
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.data_dir = Some(data.path().to_string_lossy().into_owned());
        cfg.user_id = Some("utente-test".to_string());
    }

    let boot = state.bootstrap();

    assert_eq!(boot.data_dir_status, "missing_or_empty");
}

#[test]
fn bootstrap_cartella_eventi_con_log_ndjson_non_valido_e_mancante() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    fs::create_dir_all(data.path().join("events")).unwrap();
    fs::write(
        data.path().join("events").join("PC.ndjson"),
        "non e' json\n",
    )
    .unwrap();

    let state = AppState::init(app.path().to_path_buf()).unwrap();
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.data_dir = Some(data.path().to_string_lossy().into_owned());
        cfg.user_id = Some("utente-test".to_string());
    }

    let boot = state.bootstrap();

    assert_eq!(boot.data_dir_status, "missing_or_empty");
}

#[test]
fn bootstrap_snapshot_valido_senza_eventi_resta_recuperabile() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let identity = {
        let state = AppState::init(app.path().to_path_buf()).unwrap();
        let identity = onboarda(&state, data_dir, "Utente Demo");
        state
            .with_engine(|engine| engine.snapshot().map(|_| ()).map_err(es))
            .unwrap();
        identity
    };
    fs::remove_dir_all(data.path().join("events")).unwrap();

    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let boot = state.bootstrap();

    assert_eq!(boot.data_dir_status, "ok");
    assert!(boot.onboarded);
    assert_eq!(boot.identity.unwrap().user_id, identity.user_id);
}

#[test]
#[ignore = "test di temporizzazione OneDrive non deterministico su Windows"]
fn log_del_pc_cancellato_mantiene_la_configurazione_finche_onedrive_lo_ripristina() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let identity = {
        let state = AppState::init(app.path().to_path_buf()).unwrap();
        onboarda(&state, data_dir, "Luca")
    };
    let log = data
        .path()
        .join("events")
        .join(format!("{}.ndjson", identity.device_id));
    let contenuto = fs::read(&log).unwrap();
    fs::remove_file(&log).unwrap();

    // Anche dopo riavvii successivi il backend non deve inventare una revoca né
    // cancellare la configurazione: l'assenza può essere una consegna OneDrive
    // temporanea. La UI potrà quindi offrire Riprova o Reset configurazione.
    for _ in 0..2 {
        let riavviata = AppState::init(app.path().to_path_buf()).unwrap();
        let boot = riavviata.bootstrap();
        assert_eq!(boot.data_dir_status, "ok");
        assert_eq!(boot.data_dir.as_deref(), Some(data_dir));
        assert!(!boot.reconnect_required);
        assert_eq!(boot.identity.unwrap().user_id, identity.user_id);
    }

    fs::write(&log, contenuto).unwrap();
    let riallineata = AppState::init(app.path().to_path_buf()).unwrap();
    let boot = riallineata.bootstrap();
    assert_eq!(boot.data_dir_status, "ok");
    assert!(boot.onboarded);
    assert_eq!(boot.identity.unwrap().user_id, identity.user_id);
}

#[test]
fn bootstrap_utente_configurato_cancellato_disconnette_config_locale() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let identity = onboarda(&state, data_dir, "Utente Demo");
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Farmacia"))]))
        .unwrap();

    state.record_delete("user", &identity.user_id).unwrap();
    let boot = state.bootstrap();

    assert!(!boot.onboarded);
    assert!(boot.data_dir.is_none());
    assert_eq!(boot.data_dir_status, "not_configured");
    assert!(boot.reconnect_required);
    assert_eq!(boot.device_id, identity.device_id);
    let cfg = state.config();
    assert!(cfg.data_dir.is_none());
    assert!(cfg.user_id.is_none());
    assert!(
        !app.path().exists(),
        "l'identità non più disponibile deve cancellare tutta la cartella AppData"
    );

    let users = state.open_data_dir(data_dir).unwrap();
    assert!(
        users.is_empty(),
        "l'utente cancellato non torna selezionabile"
    );
    let clienti = state.records_list("cliente").unwrap();
    assert_eq!(clienti.len(), 1);
    assert_eq!(clienti[0].id, cliente.id);
}

#[test]
fn pulizia_ordini_inutili_anteprima_cascata() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Mario Rossi"))]))
        .unwrap();
    let ordine = state
        .record_create(
            "ordine",
            campi(&[
                ("data", json!("2024-03-10")),
                ("stato", json!("Nuovo")),
                ("cliente_id", json!(cliente.id)),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id)),
                ("qta", json!(1)),
                ("prezzo", json!(1000)),
            ]),
        )
        .unwrap();
    state
        .pagamento_registra(
            &ordine.id,
            "saldo",
            1000,
            false,
            "2024-04-10",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    state
        .record_create(
            "promemoria",
            campi(&[
                ("testo", json!("richiamare")),
                ("collegato_tipo", json!("ordine")),
                ("collegato_id", json!(ordine.id)),
            ]),
        )
        .unwrap();

    let preview = state
        .pulizia_dati_anteprima(PuliziaDatiArgs {
            modalita: "inutili".into(),
            preset: "custom".into(),
            anno: Some(2024),
            dal: Some("2024-01-01".into()),
            al: Some("2024-12-31".into()),
        })
        .unwrap();
    assert!(preview.blocchi.is_empty());
    assert_eq!(preview.conteggi.get("ordine"), Some(&1));
    assert_eq!(preview.conteggi.get("riga_ordine"), Some(&1));
    assert_eq!(preview.conteggi.get("pagamento"), Some(&1));
    assert_eq!(preview.conteggi.get("promemoria"), Some(&1));
}

#[test]
fn pulizia_clienti_morti_non_tocca_clienti_reali() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let morto = state
        .record_create("cliente", campi(&[("nome", json!("Cliente morto"))]))
        .unwrap();
    let reale = state
        .record_create("cliente", campi(&[("nome", json!("Cliente reale"))]))
        .unwrap();
    let o_morto = state
        .record_create(
            "ordine",
            campi(&[
                ("data", json!("2024-02-01")),
                ("stato", json!("Nuovo")),
                ("cliente_id", json!(morto.id)),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o_morto.id)),
                ("qta", json!(1)),
                ("prezzo", json!(1000)),
            ]),
        )
        .unwrap();
    let o_reale = state
        .record_create(
            "ordine",
            campi(&[
                ("data", json!("2024-02-02")),
                ("stato", json!("Confermato")),
                ("cliente_id", json!(reale.id)),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o_reale.id)),
                ("qta", json!(1)),
                ("prezzo", json!(1000)),
            ]),
        )
        .unwrap();

    let preview = state
        .pulizia_dati_anteprima(PuliziaDatiArgs {
            modalita: "clienti_morti".into(),
            preset: "custom".into(),
            anno: Some(2024),
            dal: Some("2024-01-01".into()),
            al: Some("2024-12-31".into()),
        })
        .unwrap();
    assert_eq!(preview.conteggi.get("cliente"), Some(&1));
    assert_eq!(preview.conteggi.get("ordine"), Some(&1));
}

#[test]
fn pulizia_periodo_blocca_spedizione_mista() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let o1 = state
        .record_create(
            "ordine",
            campi(&[("data", json!("2024-01-10")), ("stato", json!("Spedito"))]),
        )
        .unwrap();
    let o2 = state
        .record_create(
            "ordine",
            campi(&[("data", json!("2025-01-10")), ("stato", json!("Spedito"))]),
        )
        .unwrap();
    let sp = state
        .record_create(
            "spedizione",
            campi(&[("numero_spedizione", json!("CORRIERE_B-1"))]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o1.id)),
                ("spedizione_id", json!(sp.id)),
                ("stato_riga", json!("spedita")),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o2.id)),
                ("spedizione_id", json!(sp.id)),
                ("stato_riga", json!("spedita")),
            ]),
        )
        .unwrap();

    let preview = state
        .pulizia_dati_anteprima(PuliziaDatiArgs {
            modalita: "movimenti_periodo".into(),
            preset: "custom".into(),
            anno: Some(2024),
            dal: Some("2024-01-01".into()),
            al: Some("2024-12-31".into()),
        })
        .unwrap();
    assert!(preview
        .blocchi
        .iter()
        .any(|b| b.titolo == "Spedizione mista"));
}

#[test]
fn pulizia_esegui_backup_e_purge() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let ordine = state
        .record_create(
            "ordine",
            campi(&[("data", json!("2024-05-01")), ("stato", json!("Nuovo"))]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id)),
                ("qta", json!(1)),
                ("prezzo", json!(1000)),
            ]),
        )
        .unwrap();
    let args = PuliziaDatiArgs {
        modalita: "inutili".into(),
        preset: "custom".into(),
        anno: Some(2024),
        dal: Some("2024-01-01".into()),
        al: Some("2024-12-31".into()),
    };
    let preview = state.pulizia_dati_anteprima(args.clone()).unwrap();
    let result = state.pulizia_dati_esegui(args, &preview.conferma).unwrap();
    assert_eq!(result.purgati, 2);
    assert!(std::path::Path::new(&result.backup.path).exists());
    assert!(state.records_list("ordine").unwrap().is_empty());
    assert!(state.records_list("riga_ordine").unwrap().is_empty());
}

#[test]
fn pulizia_condivisa_ignora_la_cronologia_comunicazioni_locale() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    state
        .with_engine(|engine| {
            for (id, stato, inviata_ms) in [
                (
                    "comunicazione:inviata-2024",
                    "invio_azionato",
                    1_714_521_600_000_u64,
                ),
                (
                    "comunicazione:fallita-2024",
                    "fallito",
                    1_714_521_600_000_u64,
                ),
                (
                    "comunicazione:inviata-2025",
                    "consegna_verificata",
                    1_746_057_600_000_u64,
                ),
            ] {
                engine
                    .emit("comunicazione", id, EventBody::Created)
                    .map_err(es)?;
                set_fields(
                    engine,
                    "comunicazione",
                    id,
                    &[("stato", json!(stato)), ("inviata_ms", json!(inviata_ms))],
                )?;
            }
            Ok(())
        })
        .unwrap();

    let preview = state
        .pulizia_dati_anteprima(PuliziaDatiArgs {
            modalita: "inutili".into(),
            preset: "custom".into(),
            anno: Some(2024),
            dal: Some("2024-01-01".into()),
            al: Some("2024-12-31".into()),
        })
        .unwrap();

    assert!(preview.blocchi.is_empty());
    assert_eq!(preview.conteggi.get("comunicazione"), None);
    assert_eq!(preview.totale_record, 0);

    let snapshot = state.with_engine(snapshot_condiviso).unwrap();
    assert!(snapshot
        .records
        .iter()
        .all(|record| record.entity != "comunicazione"));
    assert!(snapshot
        .clocks
        .iter()
        .all(|clock| clock.entity != "comunicazione"));
    assert!(snapshot
        .purged
        .iter()
        .all(|record| record.entity != "comunicazione"));
}

#[test]
fn pulizia_non_tombstona_read_state_se_target_solo_temporaneamente_assente() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let identity = onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");
    let messaggio_id = "msg:arriva-dopo";
    let stato_id = format!("stato-notifica-v2|{}|{}", identity.user_id, messaggio_id);

    // Simula l'ordine possibile con file OneDrive separati: il read-state viene
    // ingerito prima del record messaggio a cui fa riferimento.
    state
        .record_create_with_id(
            "notifica_letta",
            &stato_id,
            campi(&[
                ("user_id", json!(identity.user_id.clone())),
                ("notifica_id", json!(messaggio_id)),
                ("letta", json!(true)),
                ("scartata", json!(true)),
                ("ts", json!(now_ms())),
            ]),
        )
        .unwrap();

    // Una purge non correlata avvia la manutenzione degli orfani: l'assenza del
    // messaggio, senza la sua tombstone, non deve più bastare a purgare lo stato.
    let temporaneo = state
        .record_create("cliente", campi(&[("nome", json!("Temporaneo"))]))
        .unwrap();
    state.record_purge("cliente", &temporaneo.id).unwrap();
    assert!(state
        .record_get("notifica_letta", &stato_id)
        .unwrap()
        .is_some());

    state
        .record_create_with_id(
            "notifica",
            messaggio_id,
            campi(&[
                ("mittente_id", json!("altro-utente")),
                ("destinatario", json!(identity.user_id)),
                ("testo", json!("arrivato dopo")),
                ("ts", json!(now_ms())),
            ]),
        )
        .unwrap();
    assert!(state
        .record_get("notifica_letta", &stato_id)
        .unwrap()
        .is_some());
}

#[test]
fn pulizia_rimuove_notifiche_lette_orfane_e_conserva_tombstone_e_log() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let id = onboarda(&state, data_dir, "Utente Demo");
    let device = state.bootstrap().device_id;

    let ordine = state
        .record_create(
            "ordine",
            campi(&[("data", json!("2024-05-01")), ("stato", json!("Nuovo"))]),
        )
        .unwrap();
    let pagamento = state
        .pagamento_registra(
            &ordine.id,
            "saldo",
            1000,
            false,
            "2024-06-01",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    let notif_pag = format!("sollecito:{}:0", pagamento.id);
    state
        .record_create_with_id(
            "notifica_letta",
            &format!("letta|{}|{}", id.user_id, notif_pag),
            campi(&[
                ("user_id", json!(id.user_id.clone())),
                ("notifica_id", json!(notif_pag)),
                ("letta", json!(true)),
                ("scartata", json!(true)),
            ]),
        )
        .unwrap();
    state
        .record_create_with_id(
            "notifica_letta",
            &format!("letta|{}|sollecito:pagamento-gia-purgato:0", id.user_id),
            campi(&[
                ("user_id", json!(id.user_id.clone())),
                ("notifica_id", json!("sollecito:pagamento-gia-purgato:0")),
                ("letta", json!(true)),
                ("scartata", json!(true)),
            ]),
        )
        .unwrap();

    let old_log = fs::read(data.path().join("events").join(format!("{device}.ndjson"))).unwrap();
    let args = PuliziaDatiArgs {
        modalita: "inutili".into(),
        preset: "custom".into(),
        anno: Some(2024),
        dal: Some("2024-01-01".into()),
        al: Some("2024-12-31".into()),
    };
    let preview = state.pulizia_dati_anteprima(args.clone()).unwrap();
    assert_eq!(preview.conteggi.get("notifica_letta"), Some(&2));

    let result = state.pulizia_dati_esegui(args, &preview.conferma).unwrap();

    assert_eq!(result.notifiche_ripulite, 2);
    assert!(!result.compattato);
    assert_eq!(result.tombstone_rimosse, 0);
    assert_eq!(result.eventi_rimossi, 0);
    assert!(state.records_list("ordine").unwrap().is_empty());
    assert!(state.records_list("pagamento").unwrap().is_empty());
    assert!(state.records_list("notifica_letta").unwrap().is_empty());

    let store =
        crate::sync::snapshot::SnapshotStore::new(data.path().join("snapshots"), "test-reader")
            .unwrap();
    let snap = store.latest().unwrap().expect("snapshot pulito");
    assert!(
        snap.purged.len() >= result.purgati,
        "lo snapshot conserva le tombstone terminali"
    );
    assert!(snap.records.iter().all(|r| r.id != ordine.id));
    assert!(snap.records.iter().all(|r| r.id != pagamento.id));

    // Se OneDrive facesse ricomparire una copia vecchia del log, sono le tombstone
    // terminali (non un watermark globale) a impedire la resurrezione.
    fs::write(
        data.path()
            .join("events")
            .join(format!("{device} - conflicted old.ndjson")),
        old_log,
    )
    .unwrap();
    state.force_sync().unwrap();
    assert!(state.record_get("ordine", &ordine.id).unwrap().is_none());
    assert!(state
        .record_get("pagamento", &pagamento.id)
        .unwrap()
        .is_none());
    assert!(state.records_list("notifica_letta").unwrap().is_empty());
}

#[test]
fn onboarding_persistito_e_riavvio() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();

    let id = {
        let state = AppState::init(app.path().to_path_buf()).unwrap();
        onboarda(&state, data_dir, "Utente Demo")
    };
    assert_eq!(id.nome, "Utente Demo");

    // "Riavvio": un nuovo AppState sullo stesso app_dir deve risultare già onboarded.
    let state2 = AppState::init(app.path().to_path_buf()).unwrap();
    let boot = state2.bootstrap();
    assert!(
        boot.onboarded,
        "dopo il riavvio deve essere già configurato"
    );
    assert_eq!(boot.identity.unwrap().nome, "Utente Demo");
}

#[test]
fn notifica_scartata_resta_scartata_dopo_il_riavvio() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let messaggio_id = "msg:riavvio-scartata";

    let (user_id, stato_id) = {
        let state = AppState::init(app.path().to_path_buf()).unwrap();
        let identity = onboarda(&state, data_dir, "Utente Demo");
        state
            .record_create_with_id(
                "notifica",
                messaggio_id,
                campi(&[
                    ("mittente_id", json!("altro-utente")),
                    ("destinatario", json!(identity.user_id.clone())),
                    ("testo", json!("messaggio persistente")),
                    ("ts", json!(now_ms())),
                ]),
            )
            .unwrap();
        let stato_id = format!("letta|{}|{}", identity.user_id, messaggio_id);
        state
            .record_create_with_id(
                "notifica_letta",
                &stato_id,
                campi(&[
                    ("user_id", json!(identity.user_id.clone())),
                    ("notifica_id", json!(messaggio_id)),
                    ("letta", json!(true)),
                    ("scartata", json!(true)),
                    ("ts", json!(now_ms())),
                ]),
            )
            .unwrap();
        (identity.user_id, stato_id)
    };

    let riaperta = AppState::init(app.path().to_path_buf()).unwrap();
    assert_eq!(riaperta.whoami().unwrap().user_id, user_id);
    let stato = riaperta
        .record_get("notifica_letta", &stato_id)
        .unwrap()
        .expect("lo stato letto/scartato deve sopravvivere al riavvio");
    assert_eq!(stato.data.get("letta"), Some(&json!(true)));
    assert_eq!(stato.data.get("scartata"), Some(&json!(true)));
    assert_eq!(stato.data.get("notifica_id"), Some(&json!(messaggio_id)));
}

#[test]
fn gestione_utente_esistente_use_e_reconfigure() {
    let app1 = tempfile::tempdir().unwrap();
    let app2 = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();

    let s1 = AppState::init(app1.path().to_path_buf()).unwrap();
    let id1 = onboarda(&s1, data_dir, "Anna");

    // Secondo PC: vede Anna già esistente e la "usa".
    let s2 = AppState::init(app2.path().to_path_buf()).unwrap();
    let users = s2.open_data_dir(data_dir).unwrap();
    assert_eq!(users.len(), 1);
    assert_eq!(users[0].nome, "Anna");
    let id2 = s2
        .finish_onboarding(FinishOnboarding {
            data_dir: data_dir.to_string(),
            mode: "use".into(),
            user_id: Some(id1.user_id.clone()),
            nome: "Anna".into(),
            avatar_tipo: "iniziali".into(),
            avatar_valore: String::new(),
        })
        .unwrap();
    assert_eq!(id2.user_id, id1.user_id, "stesso utente condiviso");
    // Non si è creato un doppione.
    assert_eq!(s2.get_users().len(), 1);
    assert!(s2
        .sync_overview()
        .unwrap()
        .devices
        .iter()
        .any(|device| device.device_id == id2.device_id && device.is_current));

    // Se il profilo viene cancellato fra la lista utenti e la conferma della UI,
    // "usa questo utente" deve ripristinarlo insieme alla nuova postazione.
    let app3 = tempfile::tempdir().unwrap();
    let s3 = AppState::init(app3.path().to_path_buf()).unwrap();
    s3.open_data_dir(data_dir).unwrap();
    s1.record_delete("user", &id1.user_id).unwrap();
    s3.force_sync().unwrap();
    let id3 = s3
        .finish_onboarding(FinishOnboarding {
            data_dir: data_dir.to_string(),
            mode: "use".into(),
            user_id: Some(id1.user_id.clone()),
            nome: "Anna".into(),
            avatar_tipo: "iniziali".into(),
            avatar_valore: String::new(),
        })
        .unwrap();
    assert_eq!(id3.user_id, id1.user_id);
    assert!(s3
        .sync_overview()
        .unwrap()
        .devices
        .iter()
        .any(|device| device.device_id == id3.device_id && device.is_current));
}

#[test]
fn crud_anagrafiche_completo() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    // Crea agente
    let ag = state
        .record_create(
            "agente",
            campi(&[
                ("nome", json!("Mario Bianchi")),
                ("provv_tipo", json!("percentuale")),
                ("provv_valore", json!(10)),
            ]),
        )
        .unwrap();
    assert_eq!(ag.data["nome"], json!("Mario Bianchi"));
    // Esclude gli agenti seminati di default (builtin) dai conteggi del test.
    let agenti_utente = |s: &AppState| {
        s.records_list("agente")
            .unwrap()
            .into_iter()
            .filter(|r| r.data.get("builtin") != Some(&json!(true)))
            .count()
    };
    assert_eq!(agenti_utente(&state), 1);

    // Update parziale: cambia solo il valore, il nome resta
    let ag2 = state
        .record_update("agente", &ag.id, campi(&[("provv_valore", json!(12))]))
        .unwrap();
    assert_eq!(ag2.data["provv_valore"], json!(12));
    assert_eq!(ag2.data["nome"], json!("Mario Bianchi"));

    // Medico che referenzia l'agente
    let med = state
        .record_create(
            "medico",
            campi(&[("nome", json!("Dott. Rossi")), ("agente_id", json!(ag.id))]),
        )
        .unwrap();
    assert_eq!(med.data["agente_id"], json!(ag.id));

    // Prodotto con prezzo in centesimi
    let prod = state
        .record_create(
            "prodotto",
            campi(&[
                ("nome", json!("Allergene X")),
                ("categoria", json!("Diagnostica")),
                ("prezzo_base_default", json!(2500)),
            ]),
        )
        .unwrap();
    assert_eq!(prod.data["prezzo_base_default"], json!(2500));

    // Soft-delete → Cestino → restore
    state.record_delete("agente", &ag.id).unwrap();
    assert_eq!(agenti_utente(&state), 0);
    assert!(state.record_get("agente", &ag.id).unwrap().unwrap().deleted);
    state.record_restore("agente", &ag.id).unwrap();
    assert_eq!(agenti_utente(&state), 1);
}

#[test]
fn prezzo_suggerito_applica_il_listino() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let agente = state
        .record_create("agente", campi(&[("nome", json!("Mario"))]))
        .unwrap();
    let medico = state
        .record_create(
            "medico",
            campi(&[("nome", json!("Rossi")), ("agente_id", json!(agente.id))]),
        )
        .unwrap();
    let prod = state
        .record_create(
            "prodotto",
            campi(&[
                ("nome", json!("Allergene X")),
                ("categoria", json!("Immunoterapia")),
                ("prezzo_base_default", json!(1000)),
            ]),
        )
        .unwrap();
    let med = Some(medico.id.clone());

    // Nessuna regola → prezzo base.
    let r = state.prezzo_suggerito(&prod.id, med.clone()).unwrap();
    assert_eq!((r.prezzo, r.fonte.as_str()), (1000, "default"));

    // Regola di categoria.
    state
        .record_create(
            "regola_prezzo",
            campi(&[
                ("categoria", json!("Immunoterapia")),
                ("prezzo", json!(800)),
            ]),
        )
        .unwrap();
    let r = state.prezzo_suggerito(&prod.id, med.clone()).unwrap();
    assert_eq!((r.prezzo, r.fonte.as_str()), (800, "categoria"));

    // Agente+prodotto batte categoria (agente derivato dal medico).
    state
        .record_create(
            "regola_prezzo",
            campi(&[
                ("agente_id", json!(agente.id)),
                ("prodotto_id", json!(prod.id)),
                ("prezzo", json!(700)),
            ]),
        )
        .unwrap();
    let r = state.prezzo_suggerito(&prod.id, med.clone()).unwrap();
    assert_eq!((r.prezzo, r.fonte.as_str()), (700, "agente_prodotto"));

    // Medico+prodotto batte tutto.
    state
        .record_create(
            "regola_prezzo",
            campi(&[
                ("medico_id", json!(medico.id)),
                ("prodotto_id", json!(prod.id)),
                ("prezzo", json!(650)),
            ]),
        )
        .unwrap();
    let r = state.prezzo_suggerito(&prod.id, med).unwrap();
    assert_eq!((r.prezzo, r.fonte.as_str()), (650, "medico_prodotto"));
}

#[test]
fn giornaliero_numerazione_e_totali() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("X")), ("prezzo_base_default", json!(1000))]),
        )
        .unwrap();

    let crea = |data: &str, provvisorio: bool| {
        let mut f = campi(&[("data", json!(data)), ("stato", json!("Nuovo"))]);
        if provvisorio {
            f.insert("provvisorio".into(), json!(true));
        }
        state.record_create("ordine", f).unwrap()
    };

    // Creati in quest'ordine (HLC crescente).
    let o1 = crea("2026-03-01", false);
    let o2 = crea("2026-04-01", false);
    let o3 = crea("2025-12-01", false);
    let o4 = crea("2026-05-01", true);

    // Righe su o1: 2×500 + 3×1000 = 4000; acconto 1000 → residuo 3000.
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o1.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(2)),
                ("prezzo", json!(500)),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o1.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(3)),
                ("prezzo", json!(1000)),
            ]),
        )
        .unwrap();
    // Un pagamento parziale di 1000 (saldato) → incassato 1000, residuo 3000.
    let conto = state
        .record_create("conto", campi(&[("nome", json!("Banca"))]))
        .unwrap();
    state
        .pagamento_registra(
            &o1.id,
            "acconto",
            1000,
            true,
            "",
            &conto.id,
            "2026-03-02",
            false,
            None,
        )
        .unwrap();

    let lista = state.ordini_lista().unwrap();
    let by_id: std::collections::HashMap<String, &OrdineDto> =
        lista.iter().map(|o| (o.id.clone(), o)).collect();

    // Numerazione per anno, ordinata per HLC di creazione.
    assert_eq!(by_id[&o1.id].numero, "2026-0001");
    assert_eq!(by_id[&o2.id].numero, "2026-0002");
    assert_eq!(by_id[&o4.id].numero, "2026-0003");
    assert_eq!(by_id[&o3.id].numero, "2025-0001");

    // Totale/incassato/residuo (residuo = totale − incassato) e flag provvisorio.
    assert_eq!(by_id[&o1.id].totale, 4000);
    assert_eq!(by_id[&o1.id].incassato, 1000);
    assert_eq!(by_id[&o1.id].residuo, 3000);
    assert_eq!(by_id[&o1.id].stato_pagamento, "da_saldare");
    assert!(by_id[&o4.id].provvisorio);
    assert!(!by_id[&o1.id].provvisorio);
}

#[test]
fn corrieri_builtin_seminati_con_profilo() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let corrieri = state.records_list("corriere").unwrap();
    assert!(corrieri.is_empty(), "la demo pubblica non semina corrieri nominativi");
    return;
    let gls = corrieri
        .iter()
        .find(|c| c.id == CORRIERE_CORRIERE_B)
        .expect("CORRIERE_B built-in mancante");
    assert_eq!(gls.data.get("nome"), Some(&json!("CORRIERE_B")));
    assert_eq!(gls.data.get("profilo"), Some(&json!("gls")));
    assert_eq!(gls.data.get("builtin"), Some(&json!(true)));

    let carrai = corrieri
        .iter()
        .find(|c| c.id == CORRIERE_CORRIERE_A)
        .expect("CORRIERE_A built-in mancante");
    assert_eq!(carrai.data.get("profilo"), Some(&json!("carrai")));
    assert_eq!(carrai.data.get("builtin"), Some(&json!(true)));

    let mbe = corrieri
        .iter()
        .find(|c| c.id == CORRIERE_CORRIERE_C)
        .expect("CORRIERE_C built-in mancante");
    assert_eq!(mbe.data.get("nome"), Some(&json!("CORRIERE_C")));
    assert_eq!(mbe.data.get("profilo"), Some(&json!("mbe")));
    assert_eq!(mbe.data.get("builtin"), Some(&json!(true)));

    // Idempotente: un secondo giro non duplica né cambia.
    state.seed_builtin_corrieri();
    let dopo = state.records_list("corriere").unwrap();
    assert_eq!(dopo.iter().filter(|c| c.id == CORRIERE_CORRIERE_B).count(), 1);
    assert_eq!(dopo.iter().filter(|c| c.id == CORRIERE_CORRIERE_A).count(), 1);
    assert_eq!(dopo.iter().filter(|c| c.id == CORRIERE_CORRIERE_C).count(), 1);
}

#[test]
fn pagamenti_stato_verifica_e_automazione() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    // L'onboarding ha seminato i conti speciali built-in (non eliminabili).
    let conti = state.records_list("conto").unwrap();
    let speciali: Vec<&str> = conti
        .iter()
        .filter(|c| c.data.get("builtin") == Some(&json!(true)))
        .map(|c| c.id.as_str())
        .collect();
    assert!(speciali.contains(&CONTO_CONTRASSEGNO));
    assert!(speciali.contains(&CONTO_ASSEGNO));

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("X")), ("prezzo_base_default", json!(1000))]),
        )
        .unwrap();
    let banca = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("ACME"))]))
        .unwrap();
    let medico = state
        .record_create("medico", campi(&[("nome", json!("Dott. Verdi"))]))
        .unwrap();
    let agente = state
        .record_create("agente", campi(&[("nome", json!("Mario"))]))
        .unwrap();

    // Ordine da 10000 (1×10000), stato Nuovo.
    let crea = |totale: i64| {
        let o = state
            .record_create(
                "ordine",
                campi(&[
                    ("stato", json!("Nuovo")),
                    ("cliente_id", json!(cliente.id.clone())),
                    ("medico_id", json!(medico.id.clone())),
                    ("agente_id", json!(agente.id.clone())),
                ]),
            )
            .unwrap();
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(totale)),
                ]),
            )
            .unwrap();
        o
    };
    let o = crea(10000);

    // Acconto 4000 saldato → automazione: l'ordine passa a Confermato; resta da_saldare.
    let p1 = state
        .pagamento_registra(
            &o.id,
            "acconto",
            4000,
            true,
            "",
            &banca.id,
            "2026-03-01",
            false,
            None,
        )
        .unwrap();
    let ord = state.record_get("ordine", &o.id).unwrap().unwrap();
    assert_eq!(
        str_field(&ord.data, "stato"),
        "Confermato",
        "pagamento conferma l'ordine"
    );
    let dto = |id: &str| {
        state
            .ordini_lista()
            .unwrap()
            .into_iter()
            .find(|x| x.id == id)
            .unwrap()
    };
    let d = dto(&o.id);
    assert_eq!(
        (d.incassato, d.residuo, d.stato_pagamento.as_str()),
        (4000, 6000, "da_saldare")
    );

    // Saldo 6000 (non verificato) → incassato pieno, ma da verificare.
    let p2 = state
        .pagamento_registra(
            &o.id,
            "saldo",
            6000,
            true,
            "",
            &banca.id,
            "2026-03-10",
            false,
            None,
        )
        .unwrap();
    let d = dto(&o.id);
    assert_eq!(
        (d.incassato, d.residuo, d.stato_pagamento.as_str()),
        (10000, 0, "saldato_da_verificare")
    );

    // Verificati entrambi → saldato (verde scuro).
    state
        .record_update("pagamento", &p1.id, campi(&[("verificato", json!(true))]))
        .unwrap();
    state
        .record_update("pagamento", &p2.id, campi(&[("verificato", json!(true))]))
        .unwrap();
    assert_eq!(dto(&o.id).stato_pagamento, "saldato");

    // I pagamenti dell'ordine si elencano (2, ordinati per data).
    let pags = state.pagamenti_ordine(&o.id).unwrap();
    assert_eq!(pags.len(), 2);
    assert_eq!(pags[0].tipo, "acconto");
    assert_eq!(pags[1].importo, 6000);

    // Ordine pagato interamente in contrassegno → in attesa di accredito.
    let o2 = crea(5000);
    state
        .pagamento_registra(
            &o2.id,
            "saldo",
            5000,
            true,
            "",
            CONTO_CONTRASSEGNO,
            "2026-04-01",
            false,
            None,
        )
        .unwrap();
    assert_eq!(dto(&o2.id).stato_pagamento, "in_attesa_accredito");

    // Override manuale: forza da_controllare.
    state
        .record_update(
            "ordine",
            &o2.id,
            campi(&[("stato_pagamento", json!("da_controllare"))]),
        )
        .unwrap();
    assert_eq!(dto(&o2.id).stato_pagamento, "da_controllare");

    // Omaggio → omaggio_sostituzione (quando non c'è override).
    let o3 = crea(2000);
    state
        .record_update("ordine", &o3.id, campi(&[("omaggio", json!(true))]))
        .unwrap();
    assert_eq!(dto(&o3.id).stato_pagamento, "omaggio_sostituzione");

    // Conto predefinito incassi: il flag sta su un solo conto.
    state.conto_predefinito_set(&banca.id, "incassi").unwrap();
    let conti = state.records_list("conto").unwrap();
    let predef: Vec<&str> = conti
        .iter()
        .filter(|c| c.data.get("predefinito_incassi") == Some(&json!(true)))
        .map(|c| c.id.as_str())
        .collect();
    assert_eq!(predef, vec![banca.id.as_str()]);

    // Vista unica crediti: filtro per conto.
    let righe = state
        .pagamenti_vista(None, Some(banca.id.clone()), None, None, None)
        .unwrap();
    assert_eq!(righe.len(), 2, "i 2 pagamenti su Banca Demo");
    assert!(righe.iter().all(|r| r.conto_id == banca.id));
    assert!(righe.iter().all(|r| r.cliente_id == cliente.id));
    assert!(righe.iter().all(|r| r.agente_id == agente.id));
    assert!(righe.iter().all(|r| r.medico_id == medico.id));
}

#[test]
fn pagamenti_attesi_saldo_e_rateizza() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("X")), ("prezzo_base_default", json!(1000))]),
        )
        .unwrap();
    let banca = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();
    let agente = state
        .record_create("agente", campi(&[("nome", json!("Mario"))]))
        .unwrap();
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("ACME"))]))
        .unwrap();

    let crea = |totale: i64| {
        let o = state
            .record_create(
                "ordine",
                campi(&[
                    ("stato", json!("Nuovo")),
                    ("agente_id", json!(agente.id)),
                    ("cliente_id", json!(cliente.id)),
                ]),
            )
            .unwrap();
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(totale)),
                ]),
            )
            .unwrap();
        o
    };
    let dto = |id: &str| {
        state
            .ordini_lista()
            .unwrap()
            .into_iter()
            .find(|x| x.id == id)
            .unwrap()
    };
    let o = crea(10000);

    // Scadenzario di default: acconto atteso 1000 + saldo atteso 9000.
    let acconto = state
        .pagamento_registra(
            &o.id,
            "acconto",
            1000,
            false,
            "2026-05-01",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    // Il saldo atteso porta già il conto destinazione (lo ereditano le rate).
    let saldo = state
        .pagamento_registra(
            &o.id,
            "saldo",
            9000,
            false,
            "2026-05-31",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    assert!(!acconto.saldato && !saldo.saldato);
    // Gli attesi non incidono su incassato/residuo né confermano l'ordine.
    let d = dto(&o.id);
    assert_eq!(
        (d.incassato, d.residuo, d.stato_pagamento.as_str()),
        (0, 10000, "da_saldare")
    );
    assert_eq!(
        str_field(
            &state.record_get("ordine", &o.id).unwrap().unwrap().data,
            "stato"
        ),
        "Nuovo"
    );

    // Se l'acconto e' ancora solo atteso, "Rateizza saldo" non deve inglobarlo:
    // l'acconto resta separato e le rate sostituiscono solo il saldo da 9000.
    let o_acconto_atteso = crea(10000);
    state
        .pagamento_registra(
            &o_acconto_atteso.id,
            "acconto",
            1000,
            false,
            "2026-05-01",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    state
        .pagamento_registra(
            &o_acconto_atteso.id,
            "saldo",
            9000,
            false,
            "2026-05-31",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .pagamenti_rateizza(
            &o_acconto_atteso.id,
            vec![
                RataInput {
                    importo: 4500,
                    scadenza: "2026-06-30".into(),
                },
                RataInput {
                    importo: 4500,
                    scadenza: "2026-07-30".into(),
                },
            ],
            false,
        )
        .unwrap();
    let pags_acconto_atteso = state.pagamenti_ordine(&o_acconto_atteso.id).unwrap();
    assert_eq!(
        pags_acconto_atteso
            .iter()
            .filter(|p| !p.saldato && p.tipo == "acconto")
            .map(|p| p.importo)
            .collect::<Vec<_>>(),
        vec![1000]
    );
    assert_eq!(
        pags_acconto_atteso
            .iter()
            .filter(|p| !p.saldato && p.tipo == "rata")
            .map(|p| p.importo)
            .sum::<i64>(),
        9000
    );

    // Saldo l'acconto → incassato 1000, ordine Confermato (automazione).
    state
        .pagamento_salda(&acconto.id, &banca.id, "2026-05-02", false)
        .unwrap();
    let d = dto(&o.id);
    assert_eq!(
        (d.incassato, d.residuo, d.stato_pagamento.as_str()),
        (1000, 9000, "da_saldare")
    );
    assert_eq!(
        str_field(
            &state.record_get("ordine", &o.id).unwrap().unwrap().data,
            "stato"
        ),
        "Confermato"
    );

    // La vista mostra sia attesi sia saldati; filtro stato.
    let tutti = state.pagamenti_vista(None, None, None, None, None).unwrap();
    assert_eq!(tutti.iter().filter(|r| r.ordine_id == o.id).count(), 2);
    let attesi = state
        .pagamenti_vista(None, None, None, None, Some("atteso".into()))
        .unwrap();
    assert!(attesi.iter().all(|r| !r.saldato));
    assert!(attesi.iter().any(|r| r.id == saldo.id));

    // Rateizza il saldo in 2 rate → l'atteso "saldo" sparisce, 2 "rata" attese.
    state
        .pagamenti_rateizza(
            &o.id,
            vec![
                RataInput {
                    importo: 4500,
                    scadenza: "2026-06-30".into(),
                },
                RataInput {
                    importo: 4500,
                    scadenza: "2026-07-30".into(),
                },
            ],
            false,
        )
        .unwrap();
    let pags = state.pagamenti_ordine(&o.id).unwrap();
    let attese: Vec<_> = pags.iter().filter(|p| !p.saldato).collect();
    assert_eq!(attese.len(), 2);
    assert!(attese.iter().all(|p| p.tipo == "rata"));
    assert_eq!(attese.iter().map(|p| p.importo).sum::<i64>(), 9000);
    assert!(
        attese.iter().all(|p| p.conto_id == banca.id),
        "le rate ereditano il conto del saldo"
    );
    // L'acconto saldato è rimasto.
    assert!(pags.iter().any(|p| p.tipo == "acconto" && p.saldato));

    // Saldo in contrassegno: solo la prima rata resta sul conto di transito; le
    // successive seguono il conto incassi predefinito dell'ordine.
    state.conto_predefinito_set(&banca.id, "incassi").unwrap();
    let o_cod = crea(9000);
    state
        .pagamento_registra(
            &o_cod.id,
            "saldo",
            9000,
            false,
            "2026-05-31",
            CONTO_CONTRASSEGNO,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .pagamenti_rateizza(
            &o_cod.id,
            vec![
                RataInput {
                    importo: 3000,
                    scadenza: "2026-06-30".into(),
                },
                RataInput {
                    importo: 3000,
                    scadenza: "2026-07-30".into(),
                },
                RataInput {
                    importo: 3000,
                    scadenza: "2026-08-30".into(),
                },
            ],
            false,
        )
        .unwrap();
    let mut rate_cod: Vec<_> = state
        .pagamenti_ordine(&o_cod.id)
        .unwrap()
        .into_iter()
        .filter(|p| p.tipo == "rata")
        .collect();
    rate_cod.sort_by(|a, b| a.scadenza.cmp(&b.scadenza));
    assert_eq!(rate_cod[0].conto_id, CONTO_CONTRASSEGNO);
    assert!(
        rate_cod.iter().skip(1).all(|p| p.conto_id == banca.id),
        "dopo la prima rata COD, le rate tornano sul conto default dell'ordine"
    );

    // "Aggiungi rate" copre solo la parte non ancora nello scadenzario e conserva
    // integralmente il saldo già presente.
    let o_aggiungi = crea(10000);
    let saldo_esistente = state
        .pagamento_registra(
            &o_aggiungi.id,
            "saldo",
            4000,
            false,
            "2026-05-31",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .pagamenti_aggiungi_rate(
            &o_aggiungi.id,
            vec![
                RataInput {
                    importo: 3000,
                    scadenza: "2026-06-30".into(),
                },
                RataInput {
                    importo: 3000,
                    scadenza: "2026-07-30".into(),
                },
            ],
            false,
        )
        .unwrap();
    let pags_aggiunti = state.pagamenti_ordine(&o_aggiungi.id).unwrap();
    assert!(pags_aggiunti.iter().any(|p| p.id == saldo_esistente.id));
    assert_eq!(pags_aggiunti.iter().map(|p| p.importo).sum::<i64>(), 10000);
    assert_eq!(pags_aggiunti.iter().filter(|p| p.tipo == "rata").count(), 2);
    assert!(
        state
            .pagamenti_aggiungi_rate(
                &o_aggiungi.id,
                vec![RataInput {
                    importo: 100,
                    scadenza: "2026-08-30".into(),
                }],
                false,
            )
            .is_err(),
        "non deve aggiungere rate quando lo scadenzario è già completo"
    );

    // "Rateizza saldo" usa sempre il saldo/rate ancora da coprire, non la somma
    // (eventualmente sovrabbondante) delle vecchie rate aperte.
    let o_residuo = crea(62500);
    state
        .pagamento_registra(
            &o_residuo.id,
            "saldo",
            33500,
            true,
            "",
            &banca.id,
            "2026-05-02",
            false,
            None,
        )
        .unwrap();
    for (importo, scadenza) in [
        (9766, "2026-06-30"),
        (9766, "2026-07-30"),
        (9768, "2026-08-30"),
    ] {
        state
            .pagamento_registra(
                &o_residuo.id,
                "rata",
                importo,
                false,
                scadenza,
                &banca.id,
                "",
                false,
                None,
            )
            .unwrap();
    }
    state
        .pagamenti_rateizza(
            &o_residuo.id,
            vec![
                RataInput {
                    importo: 9666,
                    scadenza: "2026-06-30".into(),
                },
                RataInput {
                    importo: 9666,
                    scadenza: "2026-07-30".into(),
                },
                RataInput {
                    importo: 9668,
                    scadenza: "2026-08-30".into(),
                },
            ],
            false,
        )
        .unwrap();
    let pags_residuo = state.pagamenti_ordine(&o_residuo.id).unwrap();
    assert_eq!(
        pags_residuo
            .iter()
            .filter(|p| !p.saldato)
            .map(|p| p.importo)
            .sum::<i64>(),
        29000
    );
    assert_eq!(
        pags_residuo.iter().filter(|p| !p.saldato).count(),
        3,
        "conserva il numero di rate scelto dalla UI"
    );

    // Saldando entrambe le rate → incassato pieno, da verificare.
    for r in &attese {
        state
            .pagamento_salda(&r.id, &banca.id, "2026-07-01", false)
            .unwrap();
    }
    let d = dto(&o.id);
    assert_eq!(
        (d.incassato, d.residuo, d.stato_pagamento.as_str()),
        (10000, 0, "saldato_da_verificare")
    );

    // Annullare un pagamento (anche l'acconto) è possibile: residuo si ricalcola.
    state.record_delete("pagamento", &acconto.id).unwrap();
    assert_eq!(dto(&o.id).incassato, 9000);

    // Contrassegno saldato non accreditato → in attesa accredito.
    let o2 = crea(2000);
    state
        .pagamento_registra(
            &o2.id,
            "saldo",
            2000,
            true,
            "",
            CONTO_CONTRASSEGNO,
            "2026-05-04",
            false,
            None,
        )
        .unwrap();
    assert_eq!(dto(&o2.id).stato_pagamento, "in_attesa_accredito");

    // Filtro per agente nella vista.
    let v = state
        .pagamenti_vista(Some(agente.id.clone()), None, None, None, None)
        .unwrap();
    assert!(!v.is_empty() && v.iter().all(|r| !r.ordine_id.is_empty()));
    let vx = state
        .pagamenti_vista(Some("inesistente".into()), None, None, None, None)
        .unwrap();
    assert!(vx.is_empty());
}

#[test]
fn pagamenti_riallinea_aperti_proporzionale() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("X")), ("prezzo_base_default", json!(1000))]),
        )
        .unwrap();
    let banca = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();

    let crea = |prezzo: i64| {
        let o = state
            .record_create("ordine", campi(&[("stato", json!("Confermato"))]))
            .unwrap();
        let riga = state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(prezzo)),
                ]),
            )
            .unwrap();
        (o, riga)
    };
    let aperti_importi = |ordine_id: &str| {
        let mut v: Vec<_> = state
            .pagamenti_ordine(ordine_id)
            .unwrap()
            .into_iter()
            .filter(|p| !p.saldato && matches!(p.tipo.as_str(), "saldo" | "rata"))
            .collect();
        v.sort_by(|a, b| a.scadenza.cmp(&b.scadenza).then(a.id.cmp(&b.id)));
        v.into_iter().map(|p| p.importo).collect::<Vec<_>>()
    };

    let (o, riga) = crea(10000);
    state
        .pagamento_registra(
            &o.id,
            "acconto",
            1000,
            true,
            "",
            &banca.id,
            "2026-05-01",
            true,
            None,
        )
        .unwrap();
    state
        .pagamento_registra(
            &o.id,
            "rata",
            3000,
            false,
            "2026-06-01",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .pagamento_registra(
            &o.id,
            "rata",
            6000,
            false,
            "2026-07-01",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();

    state
        .record_update("riga_ordine", &riga.id, campi(&[("prezzo", json!(19000))]))
        .unwrap();
    state.pagamenti_riallinea_aperti(&o.id).unwrap();
    assert_eq!(aperti_importi(&o.id), vec![6000, 12000]);

    state
        .record_update("riga_ordine", &riga.id, campi(&[("prezzo", json!(10000))]))
        .unwrap();
    state.pagamenti_riallinea_aperti(&o.id).unwrap();
    assert_eq!(aperti_importi(&o.id), vec![3000, 6000]);

    let prima = state
        .pagamenti_ordine(&o.id)
        .unwrap()
        .into_iter()
        .find(|p| !p.saldato && p.scadenza == "2026-06-01")
        .unwrap();
    state
        .pagamento_salda(&prima.id, &banca.id, "2026-06-10", true)
        .unwrap();
    state
        .record_update("riga_ordine", &riga.id, campi(&[("prezzo", json!(15000))]))
        .unwrap();
    state.pagamenti_riallinea_aperti(&o.id).unwrap();
    assert_eq!(aperti_importi(&o.id), vec![11000]);

    state
        .record_update("riga_ordine", &riga.id, campi(&[("prezzo", json!(3000))]))
        .unwrap();
    state.pagamenti_riallinea_aperti(&o.id).unwrap();
    assert!(aperti_importi(&o.id).is_empty());
    assert!(state
        .pagamenti_ordine(&o.id)
        .unwrap()
        .iter()
        .any(|p| p.saldato && p.importo == 3000));

    let (o2, _) = crea(3);
    state
        .pagamento_registra(
            &o2.id,
            "saldo",
            1,
            false,
            "2026-01-01",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .pagamento_registra(
            &o2.id,
            "rata",
            1,
            false,
            "2026-02-01",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    state.pagamenti_riallinea_aperti(&o2.id).unwrap();
    assert_eq!(aperti_importi(&o2.id), vec![2, 1]);

    let (o4, _) = crea(10000);
    state
        .pagamento_registra(
            &o4.id,
            "acconto",
            9000,
            false,
            "2026-01-01",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .pagamento_registra(
            &o4.id,
            "rata",
            5500,
            false,
            "2026-02-01",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .pagamento_registra(
            &o4.id,
            "rata",
            5500,
            false,
            "2026-03-01",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    state.pagamenti_riallinea_aperti(&o4.id).unwrap();
    assert_eq!(aperti_importi(&o4.id), vec![500, 500]);

    let (o3, _) = crea(5);
    for scadenza in ["2026-03-01", "2026-04-01"] {
        state
            .record_create(
                "pagamento",
                campi(&[
                    ("ordine_id", json!(o3.id)),
                    ("tipo", json!("rata")),
                    ("importo", json!(1)),
                    ("saldato", json!(false)),
                    ("scadenza", json!(scadenza)),
                    ("conto_id", json!(banca.id)),
                    ("data", json!("")),
                    ("verificato", json!(false)),
                ]),
            )
            .unwrap();
    }
    state.pagamenti_riallinea_aperti(&o3.id).unwrap();
    assert_eq!(aperti_importi(&o3.id), vec![3, 2]);

    let (o_minimo, _) = crea(1);
    for scadenza in ["2026-05-01", "2026-06-01"] {
        state
            .pagamento_registra(
                &o_minimo.id,
                "rata",
                1,
                false,
                scadenza,
                &banca.id,
                "",
                false,
                None,
            )
            .unwrap();
    }
    state.pagamenti_riallinea_aperti(&o_minimo.id).unwrap();
    assert_eq!(
        aperti_importi(&o_minimo.id),
        vec![1],
        "le quote a zero centesimi vanno eliminate, non persistite"
    );

    let rata = state
        .pagamenti_ordine(&o3.id)
        .unwrap()
        .into_iter()
        .find(|p| p.tipo == "rata")
        .unwrap();
    assert!(
        state
            .record_update("pagamento", &rata.id, campi(&[("importo", json!(-1))]))
            .is_err(),
        "il CRUD generico non deve poter introdurre pagamenti negativi"
    );
}

#[test]
fn scadenzario_ordine_generico_si_materializza_e_non_riscrive_incassi() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let prodotto = state
        .record_create("prodotto", campi(&[("nome", json!("Vaccino"))]))
        .unwrap();
    let conto = state
        .record_create(
            "conto",
            campi(&[
                ("nome", json!("Banca")),
                ("predefinito_incassi", json!(true)),
                ("predefinito_acconti", json!(true)),
            ]),
        )
        .unwrap();
    let ordine = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Nuovo")),
                ("data", json!("2026-07-06")),
                ("categoria", json!("Immunoterapia")),
                ("acconto", json!(2000)),
            ]),
        )
        .unwrap();

    // Salvare l'ordine senza prodotti non deve inventare crediti a totale zero.
    assert!(state
        .pagamenti_riallinea_aperti(&ordine.id)
        .unwrap()
        .is_empty());

    let riga = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id)),
                ("prodotto_id", json!(prodotto.id)),
                ("qta", json!(1)),
                ("prezzo", json!(10000)),
            ]),
        )
        .unwrap();
    let scadenzario = state.pagamenti_riallinea_aperti(&ordine.id).unwrap();
    assert_eq!(scadenzario.len(), 2);
    let acconto = scadenzario.iter().find(|p| p.tipo == "acconto").unwrap();
    let saldo = scadenzario.iter().find(|p| p.tipo == "saldo").unwrap();
    assert_eq!(
        (acconto.importo, acconto.scadenza.as_str()),
        (2000, "2026-07-06")
    );
    assert_eq!((saldo.importo, saldo.scadenza.as_str()), (8000, ""));
    assert!(
        saldo.scad_da_spedizione,
        "il saldo automatico resta relativo alla spedizione finché questa non avviene"
    );

    state.record_delete("riga_ordine", &riga.id).unwrap();
    let svuotato = state.pagamenti_riallinea_aperti(&ordine.id).unwrap();
    assert!(
        svuotato.is_empty(),
        "rimuovere tutti i prodotti elimina lo scadenzario ancora solo atteso"
    );

    let riga = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id)),
                ("prodotto_id", json!(prodotto.id)),
                ("qta", json!(1)),
                ("prezzo", json!(10000)),
            ]),
        )
        .unwrap();
    let scadenzario = state.pagamenti_riallinea_aperti(&ordine.id).unwrap();
    assert_eq!(scadenzario.len(), 2);
    let acconto = scadenzario.iter().find(|p| p.tipo == "acconto").unwrap();

    let acconto_id = acconto.id.clone();
    state
        .pagamento_salda(&acconto_id, &conto.id, "2026-07-07", true)
        .unwrap();
    state
        .pagamento_registra(
            &ordine.id,
            "acconto",
            5000,
            false,
            "2026-07-09",
            &conto.id,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .record_update("ordine", &ordine.id, campi(&[("acconto", json!(5000))]))
        .unwrap();
    state
        .record_update("riga_ordine", &riga.id, campi(&[("prezzo", json!(15000))]))
        .unwrap();
    let aggiornato = state.pagamenti_riallinea_aperti(&ordine.id).unwrap();
    let acconto_storico = aggiornato.iter().find(|p| p.id == acconto_id).unwrap();
    assert!(acconto_storico.saldato);
    assert_eq!(
        acconto_storico.importo, 2000,
        "l'acconto previsto non deve riscrivere quello incassato"
    );
    assert!(
        aggiornato.iter().all(|p| p.saldato || p.tipo != "acconto"),
        "un acconto gia' saldato elimina eventuali acconti ancora attesi"
    );
    assert_eq!(
        aggiornato
            .iter()
            .filter(|p| !p.saldato && p.tipo == "saldo")
            .map(|p| p.importo)
            .sum::<i64>(),
        13000
    );

    let saldo_id = aggiornato
        .iter()
        .find(|p| !p.saldato && p.tipo == "saldo")
        .unwrap()
        .id
        .clone();
    state
        .pagamento_salda(&saldo_id, &conto.id, "2026-07-08", true)
        .unwrap();
    state
        .record_update("riga_ordine", &riga.id, campi(&[("prezzo", json!(18000))]))
        .unwrap();
    let esteso = state.pagamenti_riallinea_aperti(&ordine.id).unwrap();
    assert_eq!(
        esteso
            .iter()
            .filter(|p| !p.saldato && p.tipo == "saldo")
            .map(|p| p.importo)
            .collect::<Vec<_>>(),
        vec![3000],
        "un aumento dopo il saldo crea soltanto il nuovo residuo atteso"
    );
}

#[test]
fn pagamento_overpayment_saldato_e_pulizia_attesi() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("X")), ("prezzo_base_default", json!(1000))]),
        )
        .unwrap();
    let banca = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();
    let o = state
        .record_create("ordine", campi(&[("stato", json!("Nuovo"))]))
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(1)),
                ("prezzo", json!(30000)),
            ]),
        )
        .unwrap();

    // Scadenzario: acconto atteso 100€ + saldo atteso 200€.
    state
        .pagamento_registra(
            &o.id,
            "acconto",
            10000,
            false,
            "2026-05-01",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    state
        .pagamento_registra(
            &o.id,
            "saldo",
            20000,
            false,
            "2026-05-31",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    assert_eq!(state.pagamenti_ordine(&o.id).unwrap().len(), 2);

    // Il cliente paga TUTTO + extra in un colpo: 350€ (saldato, verificato).
    state
        .pagamento_registra(
            &o.id,
            "saldo",
            35000,
            true,
            "",
            &banca.id,
            "2026-05-10",
            true,
            None,
        )
        .unwrap();

    // L'ordine è saldato e gli attesi residui sono stati rimossi.
    let dto = state
        .ordini_lista()
        .unwrap()
        .into_iter()
        .find(|x| x.id == o.id)
        .unwrap();
    assert_eq!(dto.stato_pagamento, "saldato");
    assert_eq!(dto.incassato, 35000);
    assert_eq!(
        dto.residuo, -5000,
        "soldi extra → residuo negativo, ordine comunque saldato"
    );
    let pags = state.pagamenti_ordine(&o.id).unwrap();
    assert_eq!(pags.len(), 1, "restano solo i pagamenti saldati");
    assert!(pags.iter().all(|p| p.saldato));
}

#[test]
fn rimborsi_richiesto_effettuato_e_extra() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let banca = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();

    // Rimborso manuale → nasce "richiesto" (data_rimborso vuota).
    let r = state
        .rimborso_salva(
            "",
            "2026-06-01",
            5000,
            "Mario Rossi",
            "Reso prodotto",
            "IT00X",
            "",
            "",
            "",
            "",
            "manuale",
        )
        .unwrap();
    assert_eq!(r.stato, "richiesto");
    assert_eq!(r.origine, "manuale");
    assert!(
        r.cliente_id.is_empty(),
        "un rimborso manuale non inventa un collegamento cliente"
    );
    assert_eq!(state.rimborsi_lista(None).unwrap().len(), 1);
    assert_eq!(
        state
            .rimborsi_lista(Some("richiesto".into()))
            .unwrap()
            .len(),
        1
    );
    assert!(state
        .rimborsi_lista(Some("effettuato".into()))
        .unwrap()
        .is_empty());

    // Segna effettuato → stato derivato cambia, conto valorizzato.
    let r2 = state
        .rimborso_segna_effettuato(&r.id, "2026-06-05", &banca.id)
        .unwrap();
    assert_eq!(r2.stato, "effettuato");
    assert_eq!(r2.conto_nome, "Banca Demo");
    assert_eq!(
        state
            .rimborsi_lista(Some("effettuato".into()))
            .unwrap()
            .len(),
        1
    );

    // Modifica (id valorizzato) non duplica.
    state
        .rimborso_salva(
            &r.id,
            "2026-06-01",
            6000,
            "Mario Rossi",
            "Reso",
            "IT00X",
            &banca.id,
            "2026-06-05",
            "ok",
            "",
            "manuale",
        )
        .unwrap();
    assert_eq!(state.rimborsi_lista(None).unwrap().len(), 1);

    // --- Rimborso EXTRA da ordine pagato in eccesso ---
    let cliente = state
        .record_create(
            "cliente",
            campi(&[("nome", json!("Studio Bianchi")), ("iban", json!("IT99Y"))]),
        )
        .unwrap();
    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("X")), ("prezzo_base_default", json!(10000))]),
        )
        .unwrap();
    let o = state
        .record_create(
            "ordine",
            campi(&[("stato", json!("Nuovo")), ("cliente_id", json!(cliente.id))]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(1)),
                ("prezzo", json!(10000)),
            ]),
        )
        .unwrap();
    // Pagamento in eccesso: 150€ su un totale di 100€.
    state
        .pagamento_registra(
            &o.id,
            "saldo",
            15000,
            true,
            "",
            &banca.id,
            "2026-06-10",
            true,
            None,
        )
        .unwrap();

    let pre = state.rimborso_extra_precompila(&o.id).unwrap();
    assert_eq!(pre.importo, 5000, "eccedenza = incassato − totale");
    assert_eq!(pre.ragione_sociale, "Studio Bianchi");
    assert_eq!(pre.iban, "IT99Y");

    // Non può creare un rimborso superiore all'eccedenza e il batch fallito non deve
    // lasciare un record parziale.
    let errore = match state.rimborso_salva(
        "",
        "2026-06-11",
        pre.importo + 1,
        &pre.ragione_sociale,
        "Soldi in eccesso",
        &pre.iban,
        "",
        "",
        "",
        &o.id,
        "extra",
    ) {
        Ok(_) => panic!("un rimborso superiore all'eccedenza non deve essere creato"),
        Err(errore) => errore,
    };
    assert!(errore.contains("eccedenza"), "{errore}");
    assert_eq!(
        state.rimborsi_lista(None).unwrap().len(),
        1,
        "il tentativo non valido non deve creare un rimborso incompleto"
    );

    // Crea il rimborso extra: non tocca i pagamenti dell'ordine.
    let extra = state
        .rimborso_salva(
            "",
            "2026-06-11",
            pre.importo,
            &pre.ragione_sociale,
            "Soldi in eccesso",
            &pre.iban,
            "",
            "",
            "",
            &o.id,
            "extra",
        )
        .unwrap();
    assert_eq!(extra.origine, "extra");
    assert_eq!(extra.ordine_id, o.id);
    assert_eq!(extra.cliente_id, cliente.id);
    assert!(
        !extra.ordine_numero.is_empty(),
        "il numero ordine derivato è risolto nel DTO"
    );
    let dto = state
        .ordini_lista()
        .unwrap()
        .into_iter()
        .find(|x| x.id == o.id)
        .unwrap();
    assert_eq!(dto.incassato, 15000, "il rimborso non altera l'incassato");
    assert_eq!(
        dto.residuo, -5000,
        "l'eccedenza resta finché non c'è la pulizia: il rimborso è un flusso a parte"
    );
    assert_eq!(state.rimborsi_lista(None).unwrap().len(), 2);

    // Anche in modifica il limite resta atomico: un errore non deve cambiare l'importo
    // precedentemente salvato.
    let errore = match state.rimborso_salva(
        &extra.id,
        "2026-06-11",
        pre.importo + 1,
        &pre.ragione_sociale,
        "Soldi in eccesso",
        &pre.iban,
        "",
        "",
        "",
        &o.id,
        "extra",
    ) {
        Ok(_) => panic!("un rimborso superiore all'eccedenza non deve essere aggiornato"),
        Err(errore) => errore,
    };
    assert!(errore.contains("eccedenza"), "{errore}");
    assert_eq!(
        state
            .rimborsi_lista(None)
            .unwrap()
            .into_iter()
            .find(|rimborso| rimborso.id == extra.id)
            .unwrap()
            .importo,
        pre.importo
    );
}

#[test]
fn distinte_corriere_accredito() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("X")), ("prezzo_base_default", json!(1000))]),
        )
        .unwrap();
    let conto_demo = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();
    let gls = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();

    let crea = |totale: i64| {
        let o = state
            .record_create("ordine", campi(&[("stato", json!("Nuovo"))]))
            .unwrap();
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(totale)),
                ]),
            )
            .unwrap();
        o
    };
    let dto = |id: &str| {
        state
            .ordini_lista()
            .unwrap()
            .into_iter()
            .find(|x| x.id == id)
            .unwrap()
    };

    // Due ordini saldati in contrassegno + uno in assegno → tutti in_attesa_accredito.
    let o1 = crea(5000);
    let p1 = state
        .pagamento_registra(
            &o1.id,
            "saldo",
            5000,
            true,
            "",
            CONTO_CONTRASSEGNO,
            "2026-05-01",
            false,
            None,
        )
        .unwrap();
    let o2 = crea(3000);
    let p2 = state
        .pagamento_registra(
            &o2.id,
            "saldo",
            3000,
            true,
            "",
            CONTO_CONTRASSEGNO,
            "2026-05-02",
            false,
            None,
        )
        .unwrap();
    let o3 = crea(2000);
    let p3 = state
        .pagamento_registra(
            &o3.id,
            "saldo",
            2000,
            true,
            "",
            CONTO_ASSEGNO,
            "2026-05-03",
            false,
            None,
        )
        .unwrap();
    assert_eq!(dto(&o1.id).stato_pagamento, "in_attesa_accredito");
    assert_eq!(dto(&o3.id).stato_pagamento, "in_attesa_accredito");

    // Tutti e 3 i pagamenti sono "contrassegni aperti" (transito senza distinta).
    let aperti = state.contrassegni_aperti().unwrap();
    assert_eq!(aperti.len(), 3);
    assert!(aperti.iter().any(|c| c.conto_tipo == "assegno"));

    // Distinta CORRIERE_B che copre i 2 contrassegni (non l'assegno). importo 0 = somma spuntati.
    let d = state
        .distinta_crea(
            &gls.id,
            "2026-05-04",
            "2026-05-06",
            &conto_demo.id,
            0,
            vec![p1.id.clone(), p2.id.clone()],
            None,
        )
        .unwrap();
    assert_eq!(d.importo, 8000, "importo = somma spuntati (fallback)");
    assert_eq!(d.n_pagamenti, 2);
    assert_eq!(d.corriere_nome, "CORRIERE_B");
    assert_eq!(d.conto_nome, "Banca Demo");

    // I due ordini accreditati passano a saldato; l'assegno resta in attesa.
    assert_eq!(dto(&o1.id).stato_pagamento, "saldato");
    assert_eq!(dto(&o2.id).stato_pagamento, "saldato");
    assert_eq!(dto(&o3.id).stato_pagamento, "in_attesa_accredito");

    // Il pagamento mantiene il "mezzo" (contrassegno) ma espone il conto reale.
    let pags = state.pagamenti_ordine(&o1.id).unwrap();
    assert_eq!(
        pags[0].conto_tipo, "contrassegno",
        "il mezzo resta contrassegno"
    );
    assert_eq!(
        pags[0].conto_accredito_nome, "Banca Demo",
        "conto reale dalla distinta"
    );
    assert_eq!(pags[0].distinta_id, d.id);

    // Resta solo l'assegno fra i contrassegni aperti; la distinta elenca i 2 coperti.
    assert_eq!(state.contrassegni_aperti().unwrap().len(), 1);
    let righe = state.distinta_righe(&d.id).unwrap();
    assert_eq!(righe.len(), 2);

    // Elenco distinte.
    assert_eq!(state.distinte_lista().unwrap().len(), 1);

    // Eliminando la distinta i 2 pagamenti tornano in attesa di accredito.
    state.distinta_elimina(&d.id).unwrap();
    assert_eq!(dto(&o1.id).stato_pagamento, "in_attesa_accredito");
    let p1_ripristinato = state.pagamenti_ordine(&o1.id).unwrap().remove(0);
    assert!(p1_ripristinato.saldato);
    assert!(!p1_ripristinato.verificato);
    assert_eq!(p1_ripristinato.data, "2026-05-01");
    assert_eq!(state.contrassegni_aperti().unwrap().len(), 3);
    assert!(state.distinte_lista().unwrap().is_empty());
    let _ = p3;
}

#[test]
fn distinta_salda_attesi_e_importo_personalizzato() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("X")), ("prezzo_base_default", json!(1000))]),
        )
        .unwrap();
    let conto_demo = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();
    let o = state
        .record_create("ordine", campi(&[("stato", json!("Nuovo"))]))
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(1)),
                ("prezzo", json!(10000)),
            ]),
        )
        .unwrap();

    // Credito ATTESO in contrassegno (non ancora saldato): deve comparire fra i candidati.
    let p = state
        .pagamento_registra(
            &o.id,
            "saldo",
            10000,
            false,
            "2026-05-31",
            CONTO_CONTRASSEGNO,
            "",
            false,
            None,
        )
        .unwrap();
    assert!(!p.saldato);
    let aperti = state.contrassegni_aperti().unwrap();
    assert_eq!(
        aperti.len(),
        1,
        "anche un atteso in contrassegno è candidato"
    );

    // La distinta lo accredita: importo personalizzato (corriere trattiene commissioni)
    // e il pagamento atteso diventa saldato+verificato con la data di accredito.
    let d = state
        .distinta_crea(
            "",
            "2026-06-01",
            "2026-06-03",
            &conto_demo.id,
            9500,
            vec![p.id.clone()],
            None,
        )
        .unwrap();
    assert_eq!(d.importo, 9500, "importo personalizzato, non la somma");
    assert_eq!(d.corriere_nome, "", "versamento senza corriere ammesso");

    let dto = state
        .ordini_lista()
        .unwrap()
        .into_iter()
        .find(|x| x.id == o.id)
        .unwrap();
    assert_eq!(
        dto.stato_pagamento, "saldato",
        "atteso accreditato → saldato e verificato"
    );
    assert_eq!(
        dto.incassato, 10000,
        "incassato = importo del pagamento, non della distinta"
    );
    let pags = state.pagamenti_ordine(&o.id).unwrap();
    assert!(pags[0].saldato && pags[0].verificato);
    assert_eq!(pags[0].data, "2026-06-03", "data incasso = data accredito");
    assert_eq!(pags[0].conto_accredito_nome, "Banca Demo");
    // L'ordine era Nuovo → confermato dall'incasso.
    assert_eq!(dto.stato, "Confermato");

    // Eliminando la distinta, il credito torna esattamente atteso: niente data
    // di accredito rimasta nell'ordine e scadenza originaria conservata.
    state.distinta_elimina(&d.id).unwrap();
    let ripristinato = state.pagamenti_ordine(&o.id).unwrap().remove(0);
    assert!(!ripristinato.saldato);
    assert!(!ripristinato.verificato);
    assert!(ripristinato.data.is_empty());
    assert_eq!(ripristinato.scadenza, "2026-05-31");
}

#[test]
fn distinta_blocca_pagamenti_cambiati_o_gia_accreditati() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("X")), ("prezzo_base_default", json!(1000))]),
        )
        .unwrap();
    let conto_demo = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();
    let o = state
        .record_create("ordine", campi(&[("stato", json!("Confermato"))]))
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(1)),
                ("prezzo", json!(10000)),
            ]),
        )
        .unwrap();
    let p = state
        .pagamento_registra(
            &o.id,
            "saldo",
            10000,
            true,
            "",
            CONTO_CONTRASSEGNO,
            "2026-06-01",
            false,
            None,
        )
        .unwrap();

    let err = match state.distinta_crea(
        "",
        "2026-06-03",
        "2026-06-04",
        &conto_demo.id,
        0,
        vec![p.id.clone()],
        Some(vec![PagamentoDistintaAtteso {
            id: p.id.clone(),
            ordine_id: o.id.clone(),
            importo: 9999,
            conto_id: CONTO_CONTRASSEGNO.to_string(),
            conto_tipo: "contrassegno".into(),
        }]),
    ) {
        Ok(_) => panic!("la distinta con snapshot incoerente doveva fallire"),
        Err(err) => err,
    };
    assert!(err.contains("cambiato"), "{err}");

    let distinta = state
        .distinta_crea(
            "",
            "2026-06-03",
            "2026-06-04",
            &conto_demo.id,
            0,
            vec![p.id.clone()],
            Some(vec![PagamentoDistintaAtteso {
                id: p.id.clone(),
                ordine_id: o.id.clone(),
                importo: 10000,
                conto_id: CONTO_CONTRASSEGNO.to_string(),
                conto_tipo: "contrassegno".into(),
            }]),
        )
        .unwrap();

    let err = match state.record_update(
        "pagamento",
        &p.id,
        campi(&[("note", json!("modifica non consentita"))]),
    ) {
        Ok(_) => panic!("il pagamento incluso in distinta non doveva essere modificabile"),
        Err(err) => err,
    };
    assert!(err.contains("incluso in una distinta"), "{err}");
    let err = state.record_delete("pagamento", &p.id).unwrap_err();
    assert!(err.contains("incluso in una distinta"), "{err}");
    let collegato = state.pagamenti_ordine(&o.id).unwrap().remove(0);
    assert_eq!(collegato.distinta_id, distinta.id);

    let err = match state.distinta_crea(
        "",
        "2026-06-05",
        "2026-06-06",
        &conto_demo.id,
        0,
        vec![p.id],
        None,
    ) {
        Ok(_) => panic!("la distinta con pagamento già accreditato doveva fallire"),
        Err(err) => err,
    };
    assert!(err.contains("già stato accreditato"), "{err}");
}

#[test]
fn lock_cooperativo_blocca_due_operazioni_nello_stesso_processo() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    state.acquisisci_lock("preparazione_ripristino").unwrap();
    state.rinnova_lock("preparazione_ripristino").unwrap();
    let err = state.acquisisci_lock("seconda operazione").unwrap_err();
    assert!(err.contains("questo PC"), "{err}");
    state
        .avanza_lock("preparazione_ripristino", "ripristino_backup")
        .unwrap();
    state.rinnova_lock("ripristino_backup").unwrap();
    let err = state
        .rilascia_lock_se("preparazione_ripristino")
        .unwrap_err();
    assert!(err.contains("appartiene a ripristino_backup"), "{err}");
    state.rinnova_lock("ripristino_backup").unwrap();

    state.rilascia_lock_se("ripristino_backup").unwrap();
    state.acquisisci_lock("seconda operazione").unwrap();
    state.rilascia_lock().unwrap();
}

#[test]
fn ripristino_coordinato_avanza_il_lock_e_applica_il_backup() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let destinazione = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let cliente_backup = state
        .record_create("cliente", campi(&[("nome", json!("Nel backup"))]))
        .unwrap();
    let backup = state
        .backup_now(
            Some(destinazione.path().to_string_lossy().into_owned()),
            Some("test-ripristino-coordinato".into()),
        )
        .unwrap();
    let cliente_dopo = state
        .record_create("cliente", campi(&[("nome", json!("Dopo il backup"))]))
        .unwrap();
    let snapshot_vecchio = state
        .with_engine(|engine| engine.snapshot().map_err(es))
        .map(|path| fs::read(path).unwrap())
        .unwrap();

    let coordinamento = state.restore_prepare().unwrap();
    state
        .ripristina_backup(
            &backup.path,
            None,
            Some("auto"),
            Some(&coordinamento.restore_id),
        )
        .unwrap();
    let coord = data.path().join("meta/restore_coordination");
    assert!(
        !coord
            .join(format!("prepare-{}.json", coordinamento.restore_id))
            .exists(),
        "il restore completato deve eliminare la preparazione transitoria"
    );
    assert!(
        !coord.join("acks").join(&coordinamento.restore_id).exists(),
        "il restore completato deve eliminare gli ack transitori"
    );
    assert!(
        coord
            .join(format!("committed-{}.json", coordinamento.restore_id))
            .exists(),
        "il manifest finale deve restare disponibile ai PC offline"
    );

    let nomi = state
        .records_list("cliente")
        .unwrap()
        .into_iter()
        .filter_map(|record| {
            record
                .data
                .get("nome")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    assert!(nomi.iter().any(|nome| nome == "Nel backup"));
    assert!(!nomi.iter().any(|nome| nome == "Dopo il backup"));

    // Il coordinatore può tornare operativo subito: la crescita append-only del
    // log dopo marker/manifest non deve rendere il commit irraggiungibile.
    let cliente_coda = state
        .record_create("cliente", campi(&[("nome", json!("Dopo il restore"))]))
        .unwrap();

    // Simula uno snapshot della generazione precedente consegnato in ritardo.
    // È formalmente valido e contiene proprio il dato che il backup ha escluso:
    // la ricostruzione coordinata non deve fonderlo con l'anchor certificato.
    fs::write(
        data.path().join("snapshots/PC-RITARDO-00000001.json"),
        snapshot_vecchio,
    )
    .unwrap();

    // Un altro PC deve considerare il restore pronto soltanto quando marker,
    // manifest e tutti i file ripristinati (snapshot compresi) combaciano.
    let remoto_app = tempfile::tempdir().unwrap();
    let remoto2_app = tempfile::tempdir().unwrap();
    let remoto = crate::sync::Engine::open(
        data.path(),
        remoto_app.path().join("status.sqlite"),
        "PC-REMOTO",
        "utente-remoto",
    )
    .unwrap();
    let remoto2 = crate::sync::Engine::open(
        data.path(),
        remoto2_app.path().join("status.sqlite"),
        "PC-OFFLINE",
        "utente-offline",
    )
    .unwrap();
    assert!(
        remoto.restore_remoto_stato() == crate::sync::RestoreRemoteStatus::Ready,
        "il payload completo deve essere rilevato dagli altri PC"
    );
    assert_eq!(
        remoto2.restore_remoto_stato(),
        crate::sync::RestoreRemoteStatus::Ready,
        "anche una terza postazione rientrata tardi deve riconoscere il commit"
    );
    let anchor = remoto
        .restore_anchor_remoto_pronto()
        .expect("anchor del commit pronto");
    let anchor_fidato = anchor.clone();
    let anchor2 = remoto2
        .restore_anchor_remoto_pronto()
        .expect("anchor del commit pronto sulla postazione offline");
    let riallineato = crate::sync::Engine::open_with_restore_anchor(
        data.path(),
        remoto_app.path().join("projection.sqlite"),
        "PC-REMOTO",
        "utente-remoto",
        anchor,
    )
    .unwrap();
    let riallineato2 = crate::sync::Engine::open_with_restore_anchor(
        data.path(),
        remoto2_app.path().join("projection.sqlite"),
        "PC-OFFLINE",
        "utente-offline",
        anchor2,
    )
    .unwrap();
    for engine in [&riallineato, &riallineato2] {
        engine.with_projection(|projection| {
            assert!(projection
                .get("cliente", &cliente_backup.id)
                .unwrap()
                .is_some());
            assert!(projection
                .get("cliente", &cliente_dopo.id)
                .unwrap()
                .is_none());
            assert!(projection
                .get("cliente", &cliente_coda.id)
                .unwrap()
                .is_some());
        });
    }

    let manifest = data
        .path()
        .join("meta/restore_coordination")
        .join(format!("committed-{}.json", coordinamento.restore_id));
    let manifest: serde_json::Value = serde_json::from_slice(&fs::read(manifest).unwrap()).unwrap();
    assert_eq!(manifest["protocolVersion"], json!(2));
    assert!(manifest["files"].as_array().unwrap().iter().any(|file| {
        file["path"]
            .as_str()
            .is_some_and(|path| path.starts_with("snapshots/restore-anchor-"))
            && file["validation"] == json!("exact")
    }));
    assert!(manifest["files"].as_array().unwrap().iter().any(|file| {
        file["path"]
            .as_str()
            .is_some_and(|path| path.ends_with(".ndjson"))
            && file["validation"] == json!("prefix")
    }));

    riallineato.segna_restore_pronti_come_gestiti().unwrap();
    assert!(
        riallineato.restore_remoto_stato() == crate::sync::RestoreRemoteStatus::None,
        "lo stesso restore non deve riattivarsi dopo il riallineamento"
    );

    // Anche una successiva perdita della cache locale deve riusare l'anchor
    // fidato registrato sul PC, non lo snapshot vecchio ancora in OneDrive.
    drop(riallineato);
    rimuovi_proiezione_locale(remoto_app.path()).unwrap();
    let anchor_temporaneo = remoto_app.path().join("anchor-in-consegna.json");
    fs::rename(&anchor_fidato, &anchor_temporaneo).unwrap();
    let in_attesa_anchor = crate::sync::Engine::open(
        data.path(),
        remoto_app.path().join("projection.sqlite"),
        "PC-REMOTO",
        "utente-remoto",
    )
    .unwrap();
    assert_eq!(
        in_attesa_anchor.restore_remoto_stato(),
        crate::sync::RestoreRemoteStatus::Waiting,
        "senza l'anchor fidato non deve ripiegare sugli snapshot generici"
    );
    fs::rename(&anchor_temporaneo, &anchor_fidato).unwrap();
    assert_eq!(
        in_attesa_anchor.restore_remoto_stato(),
        crate::sync::RestoreRemoteStatus::Ready,
        "la consegna tardiva dell'anchor deve sbloccare il rebuild"
    );
    drop(in_attesa_anchor);
    rimuovi_proiezione_locale(remoto_app.path()).unwrap();
    let riaperto = crate::sync::Engine::open(
        data.path(),
        remoto_app.path().join("projection.sqlite"),
        "PC-REMOTO",
        "utente-remoto",
    )
    .unwrap();
    riaperto.with_projection(|projection| {
        assert!(projection
            .get("cliente", &cliente_backup.id)
            .unwrap()
            .is_some());
        assert!(projection
            .get("cliente", &cliente_dopo.id)
            .unwrap()
            .is_none());
        assert!(projection
            .get("cliente", &cliente_coda.id)
            .unwrap()
            .is_some());
    });
}

#[test]
fn avvio_durante_consegna_parziale_non_scollega_configurazione_e_converge() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let identita = onboarda(&state, data_dir, "Bruno");
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Conservato"))]))
        .unwrap();
    let snapshot_path = state
        .with_engine(|engine| engine.snapshot().map_err(es))
        .unwrap();
    let snapshot_bytes = fs::read(&snapshot_path).unwrap();
    let log_rel = format!("events/{}.ndjson", identita.device_id);
    let log_path = data.path().join(&log_rel);
    let log_bytes = fs::read(&log_path).unwrap();
    let log_checksum = crate::restore_support::checksum_file(&log_path).unwrap();
    let anchor_rel = "snapshots/restore-anchor-R-PARZIALE-00000001.json";
    let anchor_tmp = app.path().join("anchor-copy.json");
    fs::write(&anchor_tmp, &snapshot_bytes).unwrap();
    let anchor_checksum = crate::restore_support::checksum_file(&anchor_tmp).unwrap();
    drop(state);

    // Simula marker+manifest arrivati prima del contenuto e una cache locale
    // assente (riavvio/installazione su una postazione rimasta offline).
    let events = data.path().join("events");
    let snapshots = data.path().join("snapshots");
    fs::remove_dir_all(&events).unwrap();
    fs::remove_dir_all(&snapshots).unwrap();
    fs::create_dir_all(&events).unwrap();
    fs::create_dir_all(&snapshots).unwrap();
    rimuovi_proiezione_locale(app.path()).unwrap();
    let coord = data.path().join("meta/restore_coordination");
    fs::create_dir_all(&coord).unwrap();
    fs::write(
        coord.join("committed-R-PARZIALE.json"),
        serde_json::to_vec(&json!({
            "protocolVersion": 2,
            "files": [
                { "path": log_rel, "bytes": log_bytes.len(), "checksum": log_checksum, "validation": "prefix" },
                { "path": anchor_rel, "bytes": snapshot_bytes.len(), "checksum": anchor_checksum, "validation": "exact" }
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        events.join(".restore-PC-SOURCE-500.marker"),
        serde_json::to_vec(&json!({ "restoreId": "R-PARZIALE" })).unwrap(),
    )
    .unwrap();

    let riavviata = AppState::init(app.path().to_path_buf()).unwrap();
    let durante = riavviata.bootstrap();
    assert_eq!(durante.restore_status, "waiting");
    assert_eq!(
        riavviata.config().user_id.as_deref(),
        Some(identita.user_id.as_str()),
        "la proiezione parziale non deve scollegare l'identità configurata"
    );
    assert!(!durante.reconnect_required);

    fs::write(data.path().join(&log_rel), &log_bytes).unwrap();
    fs::write(data.path().join(anchor_rel), &snapshot_bytes).unwrap();
    assert_eq!(riavviata.bootstrap().restore_status, "ready");

    riavviata.ricostruisci_proiezione_locale().unwrap();
    let dopo = riavviata.bootstrap();
    assert_eq!(dopo.restore_status, "none");
    assert!(dopo.onboarded);
    assert_eq!(dopo.identity.unwrap().user_id, identita.user_id);
    assert!(riavviata
        .record_get("cliente", &cliente.id)
        .unwrap()
        .is_some());
}

#[test]
fn manifest_legacy_non_scollega_utente_presente_solo_nella_coda_dei_log() {
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let app_sorgente = tempfile::tempdir().unwrap();
    let app_utente = tempfile::tempdir().unwrap();

    let sorgente = AppState::init(app_sorgente.path().to_path_buf()).unwrap();
    let identita_sorgente = onboarda(&sorgente, data_dir, "Anna");
    sorgente
        .with_engine(|engine| engine.snapshot().map_err(es))
        .unwrap();

    // Il secondo profilo nasce dopo l'ultimo snapshot: e' il caso reale in cui
    // l'identita' configurata esiste soltanto nella coda NDJSON.
    let utente = AppState::init(app_utente.path().to_path_buf()).unwrap();
    let identita_utente = onboarda(&utente, data_dir, "Luca");

    let log_rel = format!("events/{}.ndjson", identita_sorgente.device_id);
    let log_path = data.path().join(&log_rel);
    let log_bytes = fs::metadata(&log_path).unwrap().len();
    let log_checksum = crate::restore_support::checksum_file(&log_path).unwrap();
    let restore_id = "RESTORE-LEGACY-CODA";
    let coord = data.path().join("meta/restore_coordination");
    fs::create_dir_all(&coord).unwrap();
    fs::write(
        coord.join(format!("committed-{restore_id}.json")),
        serde_json::to_vec(&json!({
            "files": [
                { "path": log_rel, "bytes": log_bytes, "checksum": log_checksum },
                { "path": "snapshots/sostituito-dalla-retention.json", "bytes": 1, "checksum": "legacy" }
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        data.path().join("events").join(format!(
            ".restore-{}-900.marker",
            identita_sorgente.device_id
        )),
        serde_json::to_vec(&json!({ "restoreId": restore_id })).unwrap(),
    )
    .unwrap();

    drop(utente);
    rimuovi_proiezione_locale(app_utente.path()).unwrap();
    let riavviata = AppState::init(app_utente.path().to_path_buf()).unwrap();
    let prima = riavviata.bootstrap();
    assert_eq!(prima.restore_status, "ready");
    assert_eq!(
        riavviata.config().user_id.as_deref(),
        Some(identita_utente.user_id.as_str()),
        "una proiezione sospesa non deve essere scambiata per una sessione rimossa"
    );

    riavviata.ricostruisci_proiezione_locale().unwrap();
    let dopo = riavviata.bootstrap();
    assert!(dopo.onboarded);
    assert!(!dopo.reconnect_required);
    assert_eq!(dopo.restore_status, "none");
    assert_eq!(dopo.identity.unwrap().user_id, identita_utente.user_id);

    // Anche una postazione senza configurazione deve risolvere il marker dentro
    // la scelta cartella, senza far sostituire l'onboarding dal bootscreen.
    let app_nuova = tempfile::tempdir().unwrap();
    let nuova = AppState::init(app_nuova.path().to_path_buf()).unwrap();
    let utenti = nuova.open_data_dir(data_dir).unwrap();
    assert!(utenti.iter().any(|user| user.id == identita_utente.user_id));
    assert_eq!(
        nuova
            .runtime
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .engine
            .restore_remoto_stato(),
        crate::sync::RestoreRemoteStatus::None
    );
    assert!(nuova.config().data_dir.is_none());
}

#[test]
fn annullamento_ripristino_sblocca_solo_la_preparazione_corrente() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let coordinamento = state.restore_prepare().unwrap();
    state.restore_cancel(&coordinamento.restore_id).unwrap();

    let coord = data.path().join("meta").join("restore_coordination");
    assert!(
        coord
            .join(format!("cancelled-{}.json", coordinamento.restore_id))
            .exists(),
        "gli altri PC devono ricevere il marker di annullamento"
    );
    assert!(
        !coord.join("acks").join(&coordinamento.restore_id).exists(),
        "gli ack transitori devono essere rimossi"
    );
    assert!(
        !coord
            .join(format!("prepare-{}.json", coordinamento.restore_id))
            .exists(),
        "la preparazione conclusa non deve restare nella cartella condivisa"
    );
    state.acquisisci_lock("operazione_successiva").unwrap();
    state.rilascia_lock().unwrap();
}

#[test]
fn ottimizzazione_richiede_ack_di_tutte_le_postazioni_registrate() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let identita = onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");
    state
        .with_engine(|engine| {
            engine
                .emit("device", "PC-OFFLINE", EventBody::Created)
                .map_err(es)?;
            set_fields(
                engine,
                "device",
                "PC-OFFLINE",
                &[
                    ("nome", json!("PC offline")),
                    ("user_id", json!(identita.user_id)),
                ],
            )?;
            Ok(())
        })
        .unwrap();

    let coordinamento = state.restore_prepare().unwrap();
    assert_eq!(coordinamento.expected_count, 2);
    assert_eq!(coordinamento.acknowledged, 1);
    let errore = state
        .ottimizza_database(&coordinamento.restore_id, Vec::new(), false)
        .unwrap_err();
    assert!(errore.contains("1/2"), "{errore}");
    assert!(
        !data.path().join("meta/generation.json").exists(),
        "senza tutti gli ack non deve essere pubblicata alcuna barriera"
    );
    state.restore_cancel(&coordinamento.restore_id).unwrap();
}

#[test]
fn ottimizzazione_forzata_pubblica_checkpoint_con_postazioni_senza_ack() {
    let app = tempfile::tempdir().unwrap();
    let app_offline = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let identita = onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");
    state
        .with_engine(|engine| {
            engine
                .emit("device", "PC-OFFLINE", EventBody::Created)
                .map_err(es)?;
            set_fields(
                engine,
                "device",
                "PC-OFFLINE",
                &[
                    ("nome", json!("PC offline")),
                    ("user_id", json!(identita.user_id)),
                ],
            )
        })
        .unwrap();

    let coordinamento = state.restore_prepare().unwrap();
    assert_eq!(coordinamento.expected_count, 2);
    assert_eq!(coordinamento.acknowledged, 1);
    let risultato = state
        .ottimizza_database(&coordinamento.restore_id, Vec::new(), true)
        .unwrap();

    assert_eq!(risultato.postazioni_senza_ack, 1);
    assert!(data.path().join("meta/generation.json").is_file());
    assert!(data
        .path()
        .join("meta/restore_coordination")
        .join(format!("committed-{}.json", coordinamento.restore_id))
        .is_file());
    assert!(fs::read_dir(data.path().join("events"))
        .unwrap()
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().starts_with(".restore-")));

    // La postazione che non ha mai visto il prepare deve scoprire il commit
    // soltanto da marker + manifest, esattamente come dopo un ripristino.
    save_config(
        app_offline.path(),
        &AppConfig {
            device_id: "PC-OFFLINE".into(),
            data_dir: Some(data.path().to_string_lossy().into_owned()),
            user_id: Some(identita.user_id),
        },
    )
    .unwrap();
    let offline = AppState::init(app_offline.path().to_path_buf()).unwrap();
    let prima = offline.bootstrap();
    assert!(prima.pending_restore);
    assert_eq!(prima.restore_status, "ready");

    offline.ricostruisci_proiezione_locale().unwrap();
    let dopo = offline.bootstrap();
    assert!(!dopo.pending_restore);
    assert_eq!(dopo.restore_status, "none");
    assert!(offline.whoami().is_some());
}

#[test]
fn ottimizzazione_generazionale_non_resuscita_tombstone_e_accetta_nuovi_eventi() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let identita = onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let eliminato = state
        .record_create("cliente", campi(&[("nome", json!("Da eliminare"))]))
        .unwrap();
    let conservato = state
        .record_create("cliente", campi(&[("nome", json!("Da conservare"))]))
        .unwrap();
    let medico_eliminato = state
        .record_create("medico", campi(&[("nome", json!("Medico da eliminare"))]))
        .unwrap();
    state.record_delete("cliente", &eliminato.id).unwrap();
    state.record_purge("cliente", &eliminato.id).unwrap();
    state.record_delete("medico", &medico_eliminato.id).unwrap();
    state.record_purge("medico", &medico_eliminato.id).unwrap();

    let device_id = state.bootstrap().device_id;
    let vecchio_log = fs::read(
        data.path()
            .join("events")
            .join(format!("{device_id}.ndjson")),
    )
    .unwrap();
    let coordinamento = state.restore_prepare().unwrap();
    assert_eq!(coordinamento.expected_count, 1);
    assert_eq!(coordinamento.acknowledged, 1);
    let risultato = state
        .ottimizza_database(&coordinamento.restore_id, Vec::new(), false)
        .unwrap();

    assert!(Path::new(&risultato.backup_path).is_file());
    assert!(risultato.tombstone_rimosse >= 2);
    assert!(risultato.eventi_rimossi > 0);
    assert!(state
        .record_get("cliente", &conservato.id)
        .unwrap()
        .is_some());
    assert!(state
        .record_get("cliente", &eliminato.id)
        .unwrap()
        .is_none());
    assert!(state
        .record_get("medico", &medico_eliminato.id)
        .unwrap()
        .is_none());

    let barrier = GenerationBarrier::load(data.path()).unwrap().unwrap();
    let anchor = barrier.anchor(data.path()).unwrap();
    let anchor_data = SnapshotStore::new(data.path().join("snapshots"), "verifica")
        .unwrap()
        .load(&anchor)
        .unwrap();
    assert!(anchor_data.purged.is_empty());
    assert!(anchor_data.applied.is_empty());
    assert!(anchor_data.offsets.is_empty());
    let coord = data.path().join("meta/restore_coordination");
    assert!(
        !coord
            .join(format!("prepare-{}.json", coordinamento.restore_id))
            .exists(),
        "il prepare deve essere rimosso subito dopo l'ottimizzazione"
    );
    assert!(
        !coord.join("acks").join(&coordinamento.restore_id).exists(),
        "gli ack non devono accumularsi"
    );
    assert!(
        coord
            .join(format!("committed-{}.json", coordinamento.restore_id))
            .exists(),
        "il manifest finale deve restare disponibile per i PC offline"
    );

    // Simula OneDrive che riconsegna integralmente il vecchio log, compreso
    // l'evento di creazione del record poi purgato.
    fs::write(
        data.path()
            .join("events")
            .join(format!("{device_id} - conflicted copy.ndjson")),
        vecchio_log,
    )
    .unwrap();

    let app_nuova = tempfile::tempdir().unwrap();
    let nuova = AppState::init(app_nuova.path().to_path_buf()).unwrap();
    let utenti = nuova.open_data_dir(data.path().to_str().unwrap()).unwrap();
    assert!(utenti.iter().any(|utente| utente.id == identita.user_id));
    assert!(nuova
        .record_get("cliente", &eliminato.id)
        .unwrap()
        .is_none());
    assert!(nuova
        .record_get("medico", &medico_eliminato.id)
        .unwrap()
        .is_none());
    assert!(nuova
        .record_get("cliente", &conservato.id)
        .unwrap()
        .is_some());

    let nuovo = nuova
        .record_create("cliente", campi(&[("nome", json!("Dopo il checkpoint"))]))
        .unwrap();
    assert!(nuova.record_get("cliente", &nuovo.id).unwrap().is_some());
}

#[test]
fn ottimizzazione_applica_la_stessa_deduplica_clienti_prima_dell_anchor() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let canonico = state
        .record_create(
            "cliente",
            campi(&[("nome", json!("Mario Rossi")), ("telefono", json!(""))]),
        )
        .unwrap();
    let duplicato = state
        .record_create(
            "cliente",
            campi(&[
                ("nome", json!("Mario Rossi")),
                ("telefono", json!("3331234567")),
            ]),
        )
        .unwrap();
    let ordine = state
        .record_create(
            "ordine",
            campi(&[("cliente_id", json!(duplicato.id.clone()))]),
        )
        .unwrap();
    let merge = DedupClienteMergeInput {
        canonico_id: canonico.id.clone(),
        duplicati_ids: vec![duplicato.id.clone()],
        fields: campi(&[("telefono", json!("3331234567"))]),
        snapshots: [
            (canonico.id.clone(), canonico.data.clone()),
            (duplicato.id.clone(), duplicato.data.clone()),
        ]
        .into_iter()
        .collect(),
    };

    let coordinamento = state.restore_prepare().unwrap();
    let risultato = state
        .ottimizza_database(&coordinamento.restore_id, vec![merge], false)
        .unwrap();

    assert_eq!(risultato.dedup_clienti.gruppi, 1);
    assert_eq!(risultato.dedup_clienti.clienti_purgati, 1);
    assert_eq!(risultato.dedup_clienti.campi_completati, 1);
    assert_eq!(risultato.dedup_clienti.riferimenti_riassegnati, 1);
    assert_eq!(
        str_field(
            &state
                .record_get("cliente", &canonico.id)
                .unwrap()
                .unwrap()
                .data,
            "telefono"
        ),
        "3331234567"
    );
    assert!(state
        .record_get("cliente", &duplicato.id)
        .unwrap()
        .is_none());
    assert_eq!(
        str_field(
            &state
                .record_get("ordine", &ordine.id)
                .unwrap()
                .unwrap()
                .data,
            "cliente_id"
        ),
        canonico.id
    );

    let barrier = GenerationBarrier::load(data.path()).unwrap().unwrap();
    let anchor = barrier.anchor(data.path()).unwrap();
    let anchor_data = SnapshotStore::new(data.path().join("snapshots"), "verifica-dedup")
        .unwrap()
        .load(&anchor)
        .unwrap();
    assert!(anchor_data
        .records
        .iter()
        .any(|record| record.entity == "cliente" && record.id == canonico.id));
    assert!(anchor_data
        .records
        .iter()
        .all(|record| record.entity != "cliente" || record.id != duplicato.id));
}

#[test]
fn crediti_stato_ordine_e_rifiutato_escluso() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("X")), ("prezzo_base_default", json!(1000))]),
        )
        .unwrap();
    let banca = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();
    let crea = |totale: i64| {
        let o = state
            .record_create("ordine", campi(&[("stato", json!("Nuovo"))]))
            .unwrap();
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(totale)),
                ]),
            )
            .unwrap();
        o
    };

    // Ordine Nuovo con due attesi → la vista li espone con ordine_stato = "Nuovo".
    let o1 = crea(10000);
    state
        .pagamento_registra(
            &o1.id,
            "acconto",
            1000,
            false,
            "2026-05-01",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .pagamento_registra(
            &o1.id,
            "saldo",
            9000,
            false,
            "2026-05-31",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    let v1: Vec<_> = state.pagamenti_vista(None, None, None, None, None).unwrap();
    let o1_righe: Vec<_> = v1.iter().filter(|r| r.ordine_id == o1.id).collect();
    assert_eq!(o1_righe.len(), 2);
    assert!(
        o1_righe.iter().all(|r| r.ordine_stato == "Nuovo"),
        "credito potenziale: ordine Nuovo"
    );

    // Ordine poi rifiutato: il suo atteso è escluso del tutto dalla vista…
    let o2 = crea(5000);
    state
        .pagamento_registra(
            &o2.id,
            "saldo",
            5000,
            false,
            "2026-06-30",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .pagamento_registra(
            &o2.id,
            "acconto",
            2000,
            true,
            "",
            &banca.id,
            "2026-06-10",
            false,
            None,
        )
        .unwrap();
    state
        .record_update("ordine", &o2.id, campi(&[("stato", json!("Rifiutato"))]))
        .unwrap();
    let v2 = state.pagamenti_vista(None, None, None, None, None).unwrap();
    assert!(
        v2.iter().all(|r| r.ordine_id != o2.id || r.saldato),
        "attesi di un ordine rifiutato esclusi"
    );

    // …ma un pagamento SALDATO già registrato resta visibile (incassato reale).
    let v3 = state.pagamenti_vista(None, None, None, None, None).unwrap();
    let o2_righe: Vec<_> = v3.iter().filter(|r| r.ordine_id == o2.id).collect();
    assert_eq!(o2_righe.len(), 1, "resta solo il saldato del rifiutato");
    assert!(o2_righe[0].saldato);
}

#[test]
fn ordini_auto_chiudi_spedito_saldato_20gg() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("X")), ("prezzo_base_default", json!(1000))]),
        )
        .unwrap();
    let banca = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();
    let gls = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    // Crea ordine + 1 riga; ritorna (ordineId, rigaId).
    let crea = |totale: i64| -> (String, String) {
        let o = state
            .record_create("ordine", campi(&[("stato", json!("Nuovo"))]))
            .unwrap();
        let r = state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(totale)),
                ]),
            )
            .unwrap();
        (o.id, r.id)
    };
    let stato = |id: &str| {
        str_field(
            &state.record_get("ordine", id).unwrap().unwrap().data,
            "stato",
        )
    };
    let oggi = data_giorni_fa(0);
    let vecchio = "2020-01-01"; // ben oltre 20 giorni fa
                                // Spedisce la riga OGGI (stato testata → Spedito); ritorna l'id della spedizione.
    let spedisci = |lotto: &str, numero: &str, riga: &str| -> String {
        state
            .spedizione_crea(
                lotto,
                &oggi,
                &gls.id,
                1,
                1,
                "",
                false,
                "",
                0,
                "",
                &[rn(riga, numero)],
            )
            .unwrap()
            .id
    };
    // Retrodata la spedizione SENZA passare dai trigger (record_update puro).
    let retrodata = |sid: &str| {
        state
            .record_update("spedizione", sid, campi(&[("data", json!(vecchio))]))
            .unwrap();
    };

    // o1: spedito (oggi) + saldato → al saldo NON si chiude (spedizione recente);
    //     poi retrodato la spedizione → idoneo, lo chiude `ordini_auto_chiudi`.
    let (o1, r1) = crea(10000);
    let sp1 = spedisci("L1", "1", &r1);
    state
        .pagamento_registra(&o1, "saldo", 10000, true, "", &banca.id, &oggi, false, None)
        .unwrap();
    assert_eq!(
        stato(&o1),
        "Spedito",
        "spedizione recente: non ancora chiuso"
    );
    retrodata(&sp1);

    // o2: saldato VECCHIO ma spedito OGGI → NON si chiude (orologio = data spedizione).
    let (o2, r2) = crea(10000);
    spedisci("L2", "2", &r2);
    state
        .pagamento_registra(
            &o2, "saldo", 10000, true, "", &banca.id, vecchio, false, None,
        )
        .unwrap();

    // o3: spedito vecchio ma solo PARZIALMENTE saldato → non si chiude.
    let (o3, r3) = crea(10000);
    let sp3 = spedisci("L3", "3", &r3);
    state
        .pagamento_registra(
            &o3, "acconto", 4000, true, "", &banca.id, vecchio, false, None,
        )
        .unwrap();
    retrodata(&sp3);

    // o4: saldato vecchio ma NON spedito (Confermato) → non si chiude.
    let (o4, _r4) = crea(10000);
    state
        .pagamento_registra(
            &o4, "saldo", 10000, true, "", &banca.id, vecchio, false, None,
        )
        .unwrap();
    assert_eq!(stato(&o4), "Confermato"); // automazione acconto→Confermato

    // Esecuzione dell'automazione: chiude solo o1.
    let chiusi = state.ordini_auto_chiudi().unwrap();
    assert_eq!(chiusi, 1, "solo o1 è Spedito+saldato+spedizione≥20gg");
    assert_eq!(stato(&o1), "Chiuso");
    assert_eq!(stato(&o2), "Spedito", "spedito oggi: non ancora 20 giorni");
    assert_eq!(stato(&o3), "Spedito", "saldato solo in parte");
    assert_eq!(stato(&o4), "Confermato", "non spedito");

    // Trigger "dopo ogni saldo": spedizione già vecchia, poi saldo → chiude subito.
    let (o5, r5) = crea(10000);
    let sp5 = spedisci("L5", "5", &r5);
    retrodata(&sp5);
    state
        .pagamento_registra(
            &o5, "saldo", 10000, true, "", &banca.id, vecchio, false, None,
        )
        .unwrap();
    assert_eq!(
        stato(&o5),
        "Chiuso",
        "chiusura immediata: spedizione vecchia + saldo"
    );
}

#[test]
fn provvigioni_calcolo_maturazione_e_filtri() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data_dir, "Utente Demo");

    // Disabilita lo scorporo iva e detrazione spedizione per il test
    state
        .with_engine(|engine| {
            set_fields(
                engine,
                "parametri_globali",
                "agenti",
                &[
                    ("scorpora_iva", json!(false)),
                    ("detrai_spedizione", json!(false)),
                ],
            )
        })
        .unwrap();

    // Agente A: 10% maturazione "alla spedizione". Agente B: 50€ fissi "a chiuso".
    let a = state
        .record_create(
            "agente",
            campi(&[
                ("nome", json!("Agente A")),
                ("provv_tipo", json!("percentuale")),
                ("provv_valore", json!(10)),
                ("provv_maturazione", json!("spedizione")),
            ]),
        )
        .unwrap();
    let b = state
        .record_create(
            "agente",
            campi(&[
                ("nome", json!("Agente B")),
                ("provv_tipo", json!("fisso")),
                ("provv_valore", json!(50)),
                ("provv_maturazione", json!("chiuso")),
            ]),
        )
        .unwrap();
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Cliente provvigioni"))]))
        .unwrap();

    // Crea un ordine con una singola riga che ne fissa il totale.
    let crea_ordine = |agente: &str, stato: &str, data: &str, totale: i64, omaggio: bool| {
        let mut f = campi(&[
            ("agente_id", json!(agente)),
            ("cliente_id", json!(cliente.id.clone())),
            ("stato", json!(stato)),
            ("data", json!(data)),
        ]);
        if omaggio {
            f.insert("omaggio".into(), json!(true));
        }
        let o = state.record_create("ordine", f).unwrap();
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(totale)),
                ]),
            )
            .unwrap();
        o
    };

    let o1 = crea_ordine(&a.id, "Spedito", "2026-03-10", 10000, false); // 10% = 1000, maturato
    crea_ordine(&a.id, "Confermato", "2026-03-15", 20000, false); // 2000, NON maturato
    crea_ordine(&b.id, "Spedito", "2026-04-01", 30000, false); // 5000, NON maturato (soglia chiuso)
    crea_ordine(&b.id, "Chiuso", "2026-04-05", 30000, false); // 5000, maturato
    crea_ordine(&a.id, "Rifiutato", "2026-03-20", 99999, false); // escluso (rifiutato)
    crea_ordine(&a.id, "Spedito", "2026-03-22", 99999, true); // escluso (omaggio)

    // Report completo.
    let rep = state.provvigioni_report(None, None, None).unwrap();
    assert_eq!(rep.totale_maturato, 1000 + 5000);
    assert_eq!(rep.totale_potenziale, 1000 + 2000 + 5000 + 5000);
    let ag_a = rep.agenti.iter().find(|x| x.agente_id == a.id).unwrap();
    assert_eq!(ag_a.n_ordini, 2, "rifiutato e omaggio esclusi");
    assert_eq!(ag_a.totale_maturato, 1000);
    assert_eq!(ag_a.totale_potenziale, 3000);
    let dett_o1 = ag_a.ordini.iter().find(|o| o.ordine_id == o1.id).unwrap();
    assert_eq!((dett_o1.provvigione, dett_o1.maturato), (1000, true));
    assert_eq!(dett_o1.cliente_id, cliente.id);
    let ag_b = rep.agenti.iter().find(|x| x.agente_id == b.id).unwrap();
    assert_eq!(ag_b.totale_maturato, 5000, "solo l'ordine Chiuso matura");
    assert_eq!(ag_b.totale_potenziale, 10000);

    // Filtro periodo: solo aprile → resta il solo agente B.
    let apr = state
        .provvigioni_report(Some("2026-04-01".into()), Some("2026-04-30".into()), None)
        .unwrap();
    assert_eq!(apr.agenti.len(), 1);
    assert_eq!(apr.agenti[0].agente_id, b.id);
    assert_eq!(apr.totale_maturato, 5000);

    // Filtro per agente A.
    let solo_a = state
        .provvigioni_report(None, None, Some(a.id.clone()))
        .unwrap();
    assert_eq!(solo_a.agenti.len(), 1);
    assert_eq!(solo_a.agenti[0].agente_id, a.id);

    // Export xlsx: il file viene creato e non è vuoto.
    let out = app.path().join("provv.xlsx");
    state
        .provvigioni_export(out.to_str().unwrap(), None, None, None)
        .unwrap();
    assert!(out.exists());
    assert!(fs::metadata(&out).unwrap().len() > 0);
}

#[test]
fn backup_genera_snapshot_aggiornato() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let identity = onboarda(&state, data_dir, "Utente Demo");
    state
        .record_create("cliente", campi(&[("nome", json!("Farmacia"))]))
        .unwrap();

    let log_path = data
        .path()
        .join("events")
        .join(format!("{}.ndjson", identity.device_id));
    let eventi_prima = LogStore::read_from(&log_path, 0).unwrap().events.len();
    state.backup_now(None, None).unwrap();
    let eventi_dopo = LogStore::read_from(&log_path, 0).unwrap().events.len();

    // Il backup deve aver generato almeno uno snapshot nella cartella condivisa.
    let snaps = std::fs::read_dir(data.path().join("snapshots"))
        .unwrap()
        .count();
    assert!(snaps >= 1, "il backup deve generare uno snapshot");
    assert_eq!(
        eventi_dopo, eventi_prima,
        "il backup non deve troncare il log append-only"
    );
}

#[test]
fn backup_retention_purga_messaggi_vecchi_ma_non_notifiche_vive() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let id = onboarda(&state, data_dir, "Utente Demo");
    let old_ts = now_ms() - RETENZIONE_MESSAGGI_MS - 1_000;
    let fresh_ts = now_ms();

    state
        .record_create_with_id(
            "notifica",
            "msg:old",
            campi(&[
                ("mittente_id", json!(id.user_id.clone())),
                ("destinatario", json!("tutti")),
                ("testo", json!("vecchio")),
                ("ts", json!(old_ts)),
            ]),
        )
        .unwrap();
    state
        .record_create_with_id(
            "notifica",
            "msg:fresh",
            campi(&[
                ("mittente_id", json!(id.user_id.clone())),
                ("destinatario", json!("tutti")),
                ("testo", json!("recente")),
                ("ts", json!(fresh_ts)),
            ]),
        )
        .unwrap();

    let ordine = state
        .record_create(
            "ordine",
            campi(&[
                ("data", json!("2026-07-01")),
                ("stato", json!("Confermato")),
            ]),
        )
        .unwrap();
    let pagamento = state
        .pagamento_registra(
            &ordine.id,
            "saldo",
            1000,
            false,
            "2026-06-01",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    let notif_pag = format!("sollecito:{}:0", pagamento.id);

    for notif in [
        "msg:old".to_string(),
        "msg:fresh".to_string(),
        notif_pag.clone(),
        "sollecito:pagamento-gia-purgato:0".to_string(),
    ] {
        state
            .record_create_with_id(
                "notifica_letta",
                &format!("letta|{}|{}", id.user_id, notif),
                campi(&[
                    ("user_id", json!(id.user_id.clone())),
                    ("notifica_id", json!(notif)),
                    ("letta", json!(true)),
                    ("scartata", json!(true)),
                ]),
            )
            .unwrap();
    }

    state.backup_now(None, None).unwrap();

    assert!(state.record_get("notifica", "msg:old").unwrap().is_none());
    assert!(state.record_get("notifica", "msg:fresh").unwrap().is_some());
    let stati = state.records_list("notifica_letta").unwrap();
    let ids: HashSet<String> = stati
        .iter()
        .map(|r| str_field(&r.data, "notifica_id"))
        .collect();
    assert!(!ids.contains("msg:old"));
    // Senza la tombstone del pagamento l'assenza può essere soltanto temporanea
    // (file OneDrive ingeriti in ordine diverso): meglio conservare il piccolo
    // read-state che tombstonarlo irreversibilmente prima del target.
    assert!(ids.contains("sollecito:pagamento-gia-purgato:0"));
    assert!(ids.contains("msg:fresh"));
    assert!(ids.contains(&notif_pag));

    let store =
        crate::sync::snapshot::SnapshotStore::new(data.path().join("snapshots"), "test-reader")
            .unwrap();
    let snap = store.latest().unwrap().expect("snapshot post-retention");
    assert!(snap.records.iter().all(|r| r.id != "msg:old"));
    assert!(snap.records.iter().any(|r| r.id == "msg:fresh"));
}

#[test]
fn backup_retention_purga_solo_suggerimenti_ignorati_vecchi() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    fs::write(app.path().join("premium.json"), br#"{"enabled":true}"#).unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let identity = onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");
    let old_ts = now_ms() - RETENZIONE_SUGGERIMENTI_IGNORATI_MS - 1_000;
    let fresh_ts = now_ms();

    state
        .with_engine(|engine| {
            engine
                .emit_built_checked(move |_| {
                    let mut mutations = Vec::new();
                    for (record_id, suggerimento_id, ts) in [
                        ("stato-suggerimento-old", "s14:rimborso:old", old_ts),
                        ("stato-suggerimento-fresh", "s14:rimborso:fresh", fresh_ts),
                    ] {
                        mutations.push(Mutation::new(
                            "suggerimento_stato",
                            record_id,
                            EventBody::Created,
                        ));
                        for (field, value) in campi(&[
                            ("suggerimento_id", json!(suggerimento_id)),
                            ("nascosto", json!(true)),
                            ("ts", json!(ts)),
                            ("utente_id", json!(identity.user_id.clone())),
                            ("dispositivo_id", json!(identity.device_id.clone())),
                        ]) {
                            mutations.push(Mutation::new(
                                "suggerimento_stato",
                                record_id,
                                EventBody::FieldSet { field, value },
                            ));
                        }
                    }
                    Ok(mutations)
                })
                .map(|_| ())
                .map_err(es)
        })
        .unwrap();

    state.backup_now(None, None).unwrap();

    let ids = state
        .with_engine(|engine| {
            Ok(engine.with_projection(|projection| {
                projection
                    .list("suggerimento_stato")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|record| record.id)
                    .collect::<HashSet<_>>()
            }))
        })
        .unwrap();
    assert!(!ids.contains("stato-suggerimento-old"));
    assert!(ids.contains("stato-suggerimento-fresh"));
}

#[test]
fn restore_marker_cleanup_tiene_solo_ultimo_del_device() {
    let data = tempfile::tempdir().unwrap();
    let events = data.path().join("events");
    fs::create_dir_all(&events).unwrap();
    fs::write(events.join(".restore-PC-A-1.marker"), b"restore").unwrap();
    fs::write(events.join(".restore-PC-A-2.marker"), b"restore").unwrap();
    fs::write(events.join(".restore-PC-B-1.marker"), b"restore").unwrap();

    scrivi_restore_marker(data.path(), "PC-A", None).unwrap();

    let names: Vec<String> = fs::read_dir(&events)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        names
            .iter()
            .filter(|n| n.starts_with(".restore-PC-A-"))
            .count(),
        1
    );
    assert!(names.iter().any(|n| n == ".restore-PC-B-1.marker"));
}

#[test]
fn cestino_restore_e_purge_terminale() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let c = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    state.record_delete("cliente", &c.id).unwrap();
    let err = match state.record_update(
        "cliente",
        &c.id,
        campi(&[("nome", json!("Non deve tornare"))]),
    ) {
        Ok(_) => panic!("un record eliminato non doveva essere aggiornabile"),
        Err(err) => err,
    };
    assert!(err.contains("eliminato"), "{err}");
    assert_eq!(state.cestino().unwrap().len(), 1);
    assert!(state.records_list("cliente").unwrap().is_empty());

    // Ripristino: torna nella lista, esce dal cestino.
    state.record_restore("cliente", &c.id).unwrap();
    assert!(state.cestino().unwrap().is_empty());
    assert_eq!(state.records_list("cliente").unwrap().len(), 1);

    // Elimina definitivamente: sparisce ovunque e un restore NON lo riporta.
    state.record_delete("cliente", &c.id).unwrap();
    state.record_purge("cliente", &c.id).unwrap();
    assert!(state.cestino().unwrap().is_empty());
    assert!(state.records_list("cliente").unwrap().is_empty());
    let restore_error = state.record_restore("cliente", &c.id).unwrap_err();
    assert!(
        restore_error.contains("non trovato nel Cestino"),
        "{restore_error}"
    );
    assert!(
        state.records_list("cliente").unwrap().is_empty(),
        "purge è terminale"
    );
    assert!(state.record_get("cliente", &c.id).unwrap().is_none());

    // Storico: presenti gli eventi del record.
    let storico = state.record_storico("cliente", &c.id).unwrap();
    assert!(storico
        .iter()
        .any(|s| s.op == "field_set" && s.field.as_deref() == Some("nome")));
    assert!(storico.iter().any(|s| s.op == "purged"));
}

#[test]
fn pagamento_eliminato_definitivamente_non_entra_nel_cestino() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let pagamento = state
        .record_create(
            "pagamento",
            campi(&[("tipo", json!("saldo")), ("importo", json!(12_500))]),
        )
        .unwrap();
    state.record_delete("pagamento", &pagamento.id).unwrap();

    assert!(state
        .records_list("pagamento")
        .unwrap()
        .iter()
        .all(|record| record.id != pagamento.id));
    assert!(state
        .cestino()
        .unwrap()
        .iter()
        .all(|item| item.id != pagamento.id));
}

#[test]
fn eliminare_acconto_riporta_a_nuovo_solo_un_ordine_non_avanzato() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let ordine = state
        .record_create("ordine", campi(&[("stato", json!("Confermato"))]))
        .unwrap();
    let acconto = state
        .record_create(
            "pagamento",
            campi(&[
                ("ordine_id", json!(ordine.id.clone())),
                ("tipo", json!("acconto")),
                ("importo", json!(8_000)),
                ("saldato", json!(true)),
            ]),
        )
        .unwrap();

    state.record_delete("pagamento", &acconto.id).unwrap();

    let ordine = state.record_get("ordine", &ordine.id).unwrap().unwrap();
    assert_eq!(str_field(&ordine.data, "stato"), "Nuovo");

    for stato in ["In produzione", "Arrivato IT", "Spedito", "Chiuso"] {
        let ordine = state
            .record_create("ordine", campi(&[("stato", json!(stato))]))
            .unwrap();
        let acconto = state
            .record_create(
                "pagamento",
                campi(&[
                    ("ordine_id", json!(ordine.id.clone())),
                    ("tipo", json!("acconto")),
                    ("importo", json!(8_000)),
                    ("saldato", json!(true)),
                ]),
            )
            .unwrap();

        state.record_delete("pagamento", &acconto.id).unwrap();

        let ordine = state.record_get("ordine", &ordine.id).unwrap().unwrap();
        assert_eq!(
            str_field(&ordine.data, "stato"),
            stato,
            "uno stato operativo avanzato non deve essere retrocesso"
        );
    }
}

#[test]
fn eliminare_acconto_non_retrocede_se_rimane_un_altro_incasso() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let ordine = state
        .record_create("ordine", campi(&[("stato", json!("Confermato"))]))
        .unwrap();
    let acconto = state
        .record_create(
            "pagamento",
            campi(&[
                ("ordine_id", json!(ordine.id.clone())),
                ("tipo", json!("acconto")),
                ("importo", json!(8_000)),
                ("saldato", json!(true)),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "pagamento",
            campi(&[
                ("ordine_id", json!(ordine.id.clone())),
                ("tipo", json!("saldo")),
                ("importo", json!(12_000)),
                ("saldato", json!(true)),
            ]),
        )
        .unwrap();

    state.record_delete("pagamento", &acconto.id).unwrap();

    let ordine = state.record_get("ordine", &ordine.id).unwrap().unwrap();
    assert_eq!(str_field(&ordine.data, "stato"), "Confermato");
}

#[test]
fn dedup_clienti_completa_riassegna_purga_e_converge() {
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    onboarda(&a, data.path().to_str().unwrap(), "Anna");
    onboarda(&b, data.path().to_str().unwrap(), "Bruno");

    let canonico = a
        .record_create(
            "cliente",
            campi(&[
                ("nome", json!("Mario Rossi")),
                ("telefono", json!("")),
                ("email", json!("")),
            ]),
        )
        .unwrap();
    let duplicato = a
        .record_create(
            "cliente",
            campi(&[
                ("nome", json!("Mario Rossi")),
                ("telefono", json!("3331234567")),
                ("email", json!("")),
            ]),
        )
        .unwrap();
    let ordine = a
        .record_create(
            "ordine",
            campi(&[("cliente_id", json!(duplicato.id.clone()))]),
        )
        .unwrap();

    let risultato = a
        .clienti_deduplica_applica(vec![DedupClienteMergeInput {
            canonico_id: canonico.id.clone(),
            duplicati_ids: vec![duplicato.id.clone()],
            fields: campi(&[
                ("telefono", json!("3331234567")),
                ("email", json!("")),
                ("cf", serde_json::Value::Null),
            ]),
            snapshots: [
                (canonico.id.clone(), canonico.data.clone()),
                (duplicato.id.clone(), duplicato.data.clone()),
            ]
            .into_iter()
            .collect(),
        }])
        .unwrap();

    assert_eq!(risultato.gruppi, 1);
    assert_eq!(risultato.clienti_purgati, 1);
    assert_eq!(risultato.campi_completati, 1);
    assert_eq!(risultato.riferimenti_riassegnati, 1);
    let finale_a = a.record_get("cliente", &canonico.id).unwrap().unwrap();
    assert_eq!(str_field(&finale_a.data, "telefono"), "3331234567");
    assert_eq!(
        str_field(&finale_a.data, "email"),
        "",
        "un vuoto del duplicato non deve sovrascrivere il canonico"
    );
    assert!(a.record_get("cliente", &duplicato.id).unwrap().is_none());
    assert!(a
        .cestino()
        .unwrap()
        .iter()
        .all(|item| item.id != duplicato.id));
    assert_eq!(
        str_field(
            &a.record_get("ordine", &ordine.id).unwrap().unwrap().data,
            "cliente_id"
        ),
        canonico.id
    );

    b.with_engine(|engine| engine.ingest().map(|_| ()).map_err(es))
        .unwrap();
    let finale_b = b.record_get("cliente", &canonico.id).unwrap().unwrap();
    assert_eq!(finale_b.data, finale_a.data);
    assert!(b.record_get("cliente", &duplicato.id).unwrap().is_none());
    assert_eq!(
        str_field(
            &b.record_get("ordine", &ordine.id).unwrap().unwrap().data,
            "cliente_id"
        ),
        canonico.id
    );
}

#[test]
fn dedup_clienti_salva_il_duplicato_se_i_dati_sono_cambiati() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Anna");

    let canonico = state
        .record_create("cliente", campi(&[("nome", json!("Mario Rossi"))]))
        .unwrap();
    let duplicato = state
        .record_create("cliente", campi(&[("nome", json!("Mario Rossi"))]))
        .unwrap();
    let snapshots = [
        (canonico.id.clone(), canonico.data.clone()),
        (duplicato.id.clone(), duplicato.data.clone()),
    ]
    .into_iter()
    .collect();

    state
        .record_update(
            "cliente",
            &duplicato.id,
            campi(&[("cf", json!("RSSMRA80A01H501U"))]),
        )
        .unwrap();
    let risultato = state
        .clienti_deduplica_applica(vec![DedupClienteMergeInput {
            canonico_id: canonico.id,
            duplicati_ids: vec![duplicato.id.clone()],
            fields: campi(&[]),
            snapshots,
        }])
        .unwrap();

    assert_eq!(risultato.merge_saltati, 1);
    assert_eq!(risultato.clienti_purgati, 0);
    assert!(state
        .record_get("cliente", &duplicato.id)
        .unwrap()
        .is_some());
}

#[test]
fn backup_nasconde_solo_localmente_clienti_vuoti_e_scollegati() {
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    onboarda(&a, data.path().to_str().unwrap(), "Anna");
    onboarda(&b, data.path().to_str().unwrap(), "Bruno");

    let vuoto = a
        .record_create(
            "cliente",
            campi(&[
                ("nome", json!("  ")),
                ("indirizzo", json!("")),
                ("telefono", json!("")),
            ]),
        )
        .unwrap();
    let con_dato = a
        .record_create(
            "cliente",
            campi(&[("nome", json!("")), ("telefono", json!("3331234567"))]),
        )
        .unwrap();
    let collegato = a
        .record_create("cliente", campi(&[("nome", json!(""))]))
        .unwrap();
    a.record_create(
        "ordine",
        campi(&[("cliente_id", json!(collegato.id.clone()))]),
    )
    .unwrap();
    let valido = a
        .record_create("cliente", campi(&[("nome", json!("Mario Rossi"))]))
        .unwrap();

    b.with_engine(|engine| engine.ingest().map(|_| ()).map_err(es))
        .unwrap();
    assert!(b.record_get("cliente", &vuoto.id).unwrap().is_some());

    a.backup_now(None, Some("test-clienti-locali".into()))
        .unwrap();
    assert_eq!(a.clienti_locali_sanifica_dopo_backup().unwrap(), 0);
    assert!(a.record_get("cliente", &vuoto.id).unwrap().is_none());
    assert!(a.record_get("cliente", &con_dato.id).unwrap().is_some());
    assert!(a.record_get("cliente", &collegato.id).unwrap().is_some());
    assert!(a.record_get("cliente", &valido.id).unwrap().is_some());

    // Nessuna cancellazione viene condivisa: un altro PC e gli snapshot vedono
    // ancora il record sorgente, che resta recuperabile integralmente.
    assert!(b.record_get("cliente", &vuoto.id).unwrap().is_some());
    let presente_nello_snapshot = a
        .with_engine(|engine| engine.with_projection(|p| p.export()).map_err(es))
        .unwrap()
        .records
        .iter()
        .any(|record| record.entity == "cliente" && record.id == vuoto.id);
    assert!(presente_nello_snapshot);
    assert!(a
        .record_storico("cliente", &vuoto.id)
        .unwrap()
        .iter()
        .all(|evento| evento.op != "purged" && evento.op != "deleted"));
}

#[test]
fn record_create_with_id_e_idempotente() {
    // Crea-con-id si comporta da upsert: ricreare lo STESSO id (come farebbe il
    // secondo PC che rigenera lo stesso promemoria ricorrente) non duplica il record,
    // e i campi si fondono in LWW. È la base della convergenza fra dispositivi.
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let id = "prom-SERIE-2026-07-01";
    let a = state
        .record_create_with_id(
            "promemoria",
            id,
            campi(&[
                ("testo", json!("richiama")),
                ("scadenza", json!("2026-07-01")),
            ]),
        )
        .unwrap();
    assert_eq!(a.id, id);

    // Seconda creazione con lo stesso id (concorrenza simulata): nessun duplicato.
    let b = state
        .record_create_with_id(
            "promemoria",
            id,
            campi(&[
                ("testo", json!("richiama")),
                ("scadenza", json!("2026-07-01")),
                ("priorita", json!("alta")),
            ]),
        )
        .unwrap();
    assert_eq!(b.id, id);

    let tutti = state.records_list("promemoria").unwrap();
    assert_eq!(
        tutti.len(),
        1,
        "stesso id → un solo record (niente duplicati)"
    );
    assert_eq!(
        tutti[0].data.get("priorita").and_then(|v| v.as_str()),
        Some("alta")
    );

    // Id vuoto rifiutato.
    assert!(state
        .record_create_with_id("promemoria", "", campi(&[]))
        .is_err());
}

#[test]
fn reset_leggero_riconfigura_ma_conserva_i_dati_condivisi() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let device = state.bootstrap().device_id;

    onboarda(&state, data_dir, "Utente Demo");
    state
        .record_create("cliente", campi(&[("nome", json!("Farmacia"))]))
        .unwrap();

    state.reset_leggero().unwrap();

    // Torna all'onboarding, ma stesso device_id e dati di business conservati.
    let boot = state.bootstrap();
    assert!(!boot.onboarded);
    assert!(boot.data_dir.is_none());
    assert!(!boot.reconnect_required);
    assert_eq!(boot.device_id, device, "stesso dispositivo");
    assert!(
        !app.path().exists(),
        "il reset leggero deve cancellare tutta la cartella AppData"
    );
    assert!(
        Path::new(data_dir).join("events").exists(),
        "dati condivisi conservati"
    );

    // Il PROFILO corrente è stato rimosso dai dati condivisi…
    let users = state.open_data_dir(data_dir).unwrap();
    assert_eq!(users.len(), 0, "il profilo è stato cancellato");
    assert!(
        state.sync_overview().unwrap().devices.is_empty(),
        "il device riconfigurato resta nascosto finché non viene collegato a un nuovo utente"
    );
    let ritirabili = state.sync_overview_ritiro().unwrap().devices;
    assert!(
        ritirabili
            .iter()
            .any(|item| item.device_id == device && item.is_current),
        "il device scollegato resta disponibile nella lista amministrativa di ritiro"
    );
    // …ma i dati di business (anagrafiche, ordini) restano intatti.
    let clienti = state.records_list("cliente").unwrap();
    assert_eq!(clienti.len(), 1);
    assert_eq!(clienti[0].data["nome"], json!("Farmacia"));

    let nuovo_device = boot.device_id;
    let nuova_identita = state
        .finish_onboarding(FinishOnboarding {
            data_dir: data_dir.to_string(),
            mode: "create".into(),
            user_id: Some("livio-dopo-ritiro".into()),
            nome: "Utente Demo".into(),
            avatar_tipo: "iniziali".into(),
            avatar_valore: String::new(),
        })
        .unwrap();
    assert_eq!(nuova_identita.device_id, nuovo_device);
    assert_eq!(state.get_users().len(), 1);
    assert_eq!(state.get_users()[0].nome, "Utente Demo");
    assert!(state
        .sync_overview()
        .unwrap()
        .devices
        .iter()
        .any(|device| device.device_id == nuovo_device && device.is_current));
}

#[test]
fn reset_leggero_non_cancella_un_profilo_condiviso_con_un_altro_device() {
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    let id_a = onboarda(&a, data_dir, "Anna");

    b.open_data_dir(data_dir).unwrap();
    let id_b = b
        .finish_onboarding(FinishOnboarding {
            data_dir: data_dir.to_string(),
            mode: "use".into(),
            user_id: Some(id_a.user_id.clone()),
            nome: "Anna".into(),
            avatar_tipo: "iniziali".into(),
            avatar_valore: String::new(),
        })
        .unwrap();
    assert_eq!(id_b.user_id, id_a.user_id);
    a.force_sync().unwrap();

    a.reset_leggero().unwrap();
    b.force_sync().unwrap();

    assert_eq!(b.whoami().unwrap().user_id, id_a.user_id);
    assert!(b.get_users().iter().any(|user| user.id == id_a.user_id));
    let devices = b.sync_overview().unwrap().devices;
    assert!(devices
        .iter()
        .any(|device| device.device_id == id_b.device_id));
    assert!(
        devices
            .iter()
            .all(|device| device.device_id != id_a.device_id),
        "il PC riconfigurato non deve apparire anche se il profilo condiviso resta vivo"
    );
    let ritirabili = b.sync_overview_ritiro().unwrap().devices;
    assert!(ritirabili
        .iter()
        .any(|device| device.device_id == id_a.device_id));
    assert!(ritirabili
        .iter()
        .any(|device| device.device_id == id_b.device_id));
}

#[test]
fn ritiro_dispositivo_corrente_genera_nuovo_device_e_conserva_i_dati() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    // Riproduce una postazione che aveva gia' assorbito un restore coordinato
    // storico. Il ritiro cancella AppData (quindi anche questo handled locale),
    // ma il proprio marker piu' recente deve continuare a superare quello vecchio.
    let restore_storico = "RESTORE-STORICO-PRIMA-RITIRO";
    semina_restore_storico_gestito(&state, app.path(), data.path(), restore_storico);
    let id = onboarda(&state, data_dir, "Utente Demo");
    let projection = app.path().join("projection.sqlite");
    state
        .record_create("cliente", campi(&[("nome", json!("Farmacia"))]))
        .unwrap();
    assert!(projection.exists(), "proiezione locale creata");

    let res = state.ritira_dispositivo(&id.device_id).unwrap();

    // Il ritiro cambia/cancella la configurazione locale: deve comunque liberare
    // anche il guard in memoria acquisito con il vecchio device id.
    assert!(
        state
            .operation_lock_local
            .lock()
            .expect("operation lock locale poisoned")
            .is_none(),
        "il ritiro corrente non deve lasciare il processo bloccato"
    );

    let boot = state.bootstrap();
    assert!(!boot.onboarded);
    assert!(boot.data_dir.is_none());
    assert_ne!(
        boot.device_id, id.device_id,
        "il device ritirato non si riusa"
    );
    assert!(res.events_removed >= 1);
    assert!(
        Path::new(&res.backup_path).exists(),
        "backup di ritiro creato"
    );
    assert!(!data
        .path()
        .join("events")
        .join(format!("{}.ndjson", id.device_id))
        .exists());
    assert!(
        !projection.exists(),
        "il ritiro del PC corrente rimuove la proiezione locale"
    );
    assert!(
        !app.path().exists(),
        "il ritiro del PC corrente deve cancellare tutta la cartella AppData"
    );

    let users = state
        .open_data_dir(data_dir)
        .expect("il marker del ritiro deve superare il restore storico");
    assert!(users.is_empty(), "il profilo ritirato non torna in lista");
    let clienti = state.records_list("cliente").unwrap();
    assert_eq!(clienti.len(), 1);
    assert_eq!(clienti[0].data["nome"], json!("Farmacia"));
}

#[test]
fn ritiro_dispositivo_remoto_forza_onboarding_e_ignora_eventi_tardivi() {
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    let restore_storico = "RESTORE-STORICO-PRIMA-RITIRO-REMOTO";
    semina_restore_storico_gestito(&a, app_a.path(), data.path(), restore_storico);
    semina_restore_storico_gestito(&b, app_b.path(), data.path(), restore_storico);
    let _id_a = onboarda(&a, data_dir, "Anna");
    let id_b = onboarda(&b, data_dir, "Bruno");
    b.record_create("cliente", campi(&[("nome", json!("Cliente B"))]))
        .unwrap();
    a.force_sync().unwrap();

    a.ritira_dispositivo(&id_b.device_id).unwrap();

    // Un lease del PC ritirato puo' ricomparire in ritardo da OneDrive: non deve
    // essere mostrato ne' bloccare le operazioni dei dispositivi attivi.
    let locks_dir = data.path().join("meta").join("locks");
    fs::create_dir_all(&locks_dir).unwrap();
    let lock_ritirato = locks_dir.join(format!("{}.json", id_b.device_id));
    fs::write(
        &lock_ritirato,
        serde_json::to_vec(&json!({
            "deviceId": id_b.device_id,
            "deviceNome": "PC Bruno",
            "utenteNome": "Bruno",
            "azione": "importazione",
            "timestamp": now_ms()
        }))
        .unwrap(),
    )
    .unwrap();
    assert!(a.operation_lock_status().unwrap().is_none());
    assert!(!lock_ritirato.exists(), "il lease ritirato viene ripulito");
    a.acquisisci_lock("verifica_post_ritiro_remoto").unwrap();
    a.rilascia_lock().unwrap();

    // Anche se un vecchio snapshot facesse ricomparire il profilo, il marker
    // durevole del PC ritirato deve tenerlo fuori dai destinatari dei messaggi.
    a.record_create_with_id(
        "user",
        &id_b.user_id,
        campi(&[("nome", json!("Bruno risorto"))]),
    )
    .unwrap();
    assert!(
        a.get_users().iter().all(|u| u.id != id_b.user_id),
        "il profilo di un PC ritirato non deve comparire nei messaggi"
    );
    a.record_create_with_id(
        "user",
        "utente-orfano",
        campi(&[("nome", json!("Profilo senza PC"))]),
    )
    .unwrap();
    assert!(
        a.get_users().iter().all(|u| u.id != "utente-orfano"),
        "un profilo senza device attivo non deve apparire nelle liste operative"
    );

    let overview = a.sync_overview().unwrap();
    assert!(
        overview
            .devices
            .iter()
            .all(|d| d.device_id != id_b.device_id),
        "un device ritirato non deve restare nella lista operativa di sync"
    );
    let overview_ritiro = a.sync_overview_ritiro().unwrap();
    assert!(
        overview_ritiro
            .devices
            .iter()
            .all(|d| d.device_id != id_b.device_id),
        "un device ritirato non deve restare nemmeno nella lista amministrativa di ritiro"
    );
    assert!(!data
        .path()
        .join("events")
        .join(format!("{}.ndjson", id_b.device_id))
        .exists());
    assert!(fs::read_dir(data.path().join("snapshots"))
        .unwrap()
        .flatten()
        .all(|e| !e
            .file_name()
            .to_string_lossy()
            .starts_with(&format!("{}-", id_b.device_id))));
    let clienti = a.records_list("cliente").unwrap();
    assert_eq!(
        clienti.len(),
        1,
        "i dati gia' sincronizzati restano nello snapshot"
    );

    let late_sqlite = app_b.path().join("late.sqlite");
    let late =
        crate::sync::Engine::open(data_dir, late_sqlite, &id_b.device_id, &id_b.user_id).unwrap();
    late.emit(
        "cliente",
        "late-client",
        crate::sync::event::EventBody::Created,
    )
    .unwrap();
    late.emit(
        "cliente",
        "late-client",
        crate::sync::event::EventBody::FieldSet {
            field: "nome".into(),
            value: json!("Tardivo"),
        },
    )
    .unwrap();
    a.force_sync().unwrap();
    assert!(
        a.record_get("cliente", "late-client").unwrap().is_none(),
        "gli eventi tardivi del device ritirato sono ignorati"
    );

    drop(late);
    // Riproduce la gara reale: il PC remoto è ancora configurato col vecchio id
    // quando riapre la cartella dall'onboarding. `open_data_dir` deve accorgersi
    // del marker appena ingerito e ruotare l'id prima di mostrare gli utenti.
    let users = b.open_data_dir(data_dir).unwrap();
    let boot_b = b.bootstrap();
    assert!(!boot_b.onboarded);
    assert_ne!(boot_b.device_id, id_b.device_id);
    assert!(
        users
            .iter()
            .all(|user| user.id != id_b.user_id && user.nome != "Bruno"),
        "il nome ritirato deve tornare disponibile"
    );
    let nuovo_device_b = boot_b.device_id;
    let nuova_identita = b
        .finish_onboarding(FinishOnboarding {
            data_dir: data_dir.to_string(),
            mode: "create".into(),
            user_id: Some("bruno-dopo-ritiro".into()),
            nome: "Bruno".into(),
            avatar_tipo: "iniziali".into(),
            avatar_valore: String::new(),
        })
        .unwrap();
    assert_eq!(nuova_identita.device_id, nuovo_device_b);
    assert!(b
        .sync_overview()
        .unwrap()
        .devices
        .iter()
        .any(|device| device.device_id == nuovo_device_b && device.is_current));

    a.force_sync().unwrap();
    assert!(a
        .sync_overview()
        .unwrap()
        .devices
        .iter()
        .any(|device| device.device_id == nuovo_device_b));
}

#[test]
fn ritiro_nasconde_senza_distruggerli_i_messaggi_creati_dal_pc_ritirato() {
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    let id_a = onboarda(&a, data_dir, "Anna");
    let id_b = onboarda(&b, data_dir, "Bruno");
    let messaggio_id = "msg:dal-pc-poi-ritirato";

    b.record_create_with_id(
        "notifica",
        messaggio_id,
        campi(&[
            ("mittente_id", json!(id_b.user_id.clone())),
            ("mittente_nome", json!("Bruno")),
            ("destinatario", json!(id_a.user_id.clone())),
            ("testo", json!("Messaggio effimero")),
            ("ts", json!(now_ms())),
        ]),
    )
    .unwrap();
    a.force_sync().unwrap();
    assert!(a.record_get("notifica", messaggio_id).unwrap().is_some());

    a.ritira_dispositivo(&id_b.device_id).unwrap();

    assert!(a.record_get("notifica", messaggio_id).unwrap().is_none());
    assert!(a
        .records_list("notifica")
        .unwrap()
        .iter()
        .all(|record| record.id != messaggio_id));
    assert!(
        a.with_engine(|engine| Ok(
            engine.with_projection(|p| { p.get("notifica", messaggio_id).unwrap().is_some() })
        ))
        .unwrap(),
        "il messaggio resta nella sorgente/proiezione e viene soltanto escluso dalle viste"
    );

    let store =
        crate::sync::snapshot::SnapshotStore::new(data.path().join("snapshots"), "lettore-test")
            .unwrap();
    let snapshot = store.latest().unwrap().expect("snapshot del ritiro");
    assert!(snapshot
        .records
        .iter()
        .any(|record| record.entity == "notifica" && record.id == messaggio_id));
}

#[test]
fn ritiro_di_un_device_non_cancella_un_utente_usato_da_un_altro_device() {
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    let id_a = onboarda(&a, data_dir, "Anna");

    b.open_data_dir(data_dir).unwrap();
    let id_b = b
        .finish_onboarding(FinishOnboarding {
            data_dir: data_dir.to_string(),
            mode: "use".into(),
            user_id: Some(id_a.user_id.clone()),
            nome: "Anna".into(),
            avatar_tipo: "iniziali".into(),
            avatar_valore: String::new(),
        })
        .unwrap();
    a.force_sync().unwrap();

    a.ritira_dispositivo(&id_b.device_id).unwrap();

    assert_eq!(a.whoami().unwrap().user_id, id_a.user_id);
    assert!(a.get_users().iter().any(|user| user.id == id_a.user_id));
    let devices = a.sync_overview().unwrap().devices;
    assert!(devices
        .iter()
        .any(|device| device.device_id == id_a.device_id));
    assert!(devices
        .iter()
        .all(|device| device.device_id != id_b.device_id));
}

#[test]
fn reset_completo_riporta_allo_stato_iniziale() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    let device_prima = state.bootstrap().device_id;
    let projection = app.path().join("projection.sqlite");

    semina_restore_storico_gestito(
        &state,
        app.path(),
        data.path(),
        "RESTORE-STORICO-PRIMA-RESET-COMPLETO",
    );
    onboarda(&state, data_dir, "Utente Demo");
    state
        .record_create("cliente", campi(&[("nome", json!("X"))]))
        .unwrap();
    assert!(state.bootstrap().onboarded);
    assert!(app.path().join("config.json").exists());
    assert!(Path::new(data_dir).join("events").exists());
    assert!(projection.exists(), "proiezione locale creata");

    state.reset_completo().unwrap();

    let boot = state.bootstrap();
    assert!(!boot.onboarded, "dopo il reset non è più configurato");
    assert!(boot.data_dir.is_none());
    assert!(!boot.reconnect_required);
    assert_ne!(boot.device_id, device_prima, "nuovo device_id");
    assert!(
        Path::new(data_dir).join("events").exists(),
        "dopo il wipe resta il log minimo della barriera anti-resurrezione"
    );
    assert!(
        Path::new(data_dir).join("snapshots").exists(),
        "dopo il wipe resta lo snapshot minimo della barriera anti-resurrezione"
    );
    assert!(
        !projection.exists(),
        "il reset completo rimuove la proiezione locale"
    );
    assert!(
        !app.path().exists(),
        "il reset completo deve cancellare tutta la cartella AppData"
    );

    // Si può ri-onboardare da zero: la cartella contiene solo la barriera,
    // nessun utente o dato di lavoro del dataset precedente.
    let users = state.open_data_dir(data_dir).unwrap();
    assert!(users.is_empty());
    assert!(state
        .with_engine(|engine| {
            Ok(engine.with_projection(|p| p.is_device_retired(&device_prima).unwrap_or(false)))
        })
        .unwrap());

    let late_dir = tempfile::tempdir().unwrap();
    let late = crate::sync::Engine::open(
        data_dir,
        late_dir.path().join("late.sqlite"),
        &device_prima,
        "utente-pre-reset",
    )
    .unwrap();
    late.emit("cliente", "cliente-pre-reset-tardivo", EventBody::Created)
        .unwrap();
    state.force_sync().unwrap();
    assert!(state
        .record_get("cliente", "cliente-pre-reset-tardivo")
        .unwrap()
        .is_none());
    assert!(state.sync_overview().unwrap().devices.is_empty());
}

#[test]
fn onboarding_rifiuta_le_sottocartelle_tecniche_senza_creare_dati_annidati() {
    let app = tempfile::tempdir().unwrap();
    let contenitore = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();

    for nome in ["events", "snapshots", "meta", "backups"] {
        let tecnica = contenitore.path().join(nome);
        fs::create_dir_all(&tecnica).unwrap();

        let errore = match state.open_data_dir(tecnica.to_str().unwrap()) {
            Ok(_) => panic!("una sottocartella tecnica non deve essere apribile come dataset"),
            Err(errore) => errore,
        };
        assert!(errore.to_string().contains("sottocartella tecnica"));
        assert!(
            !tecnica.join("events").exists() && !tecnica.join("snapshots").exists(),
            "la validazione deve avvenire prima di qualsiasi scrittura in {nome}"
        );
    }

    onboarda(
        &state,
        contenitore.path().to_str().unwrap(),
        "Utente valido",
    );
    assert!(state
        .open_data_dir(contenitore.path().join("snapshots").to_str().unwrap())
        .is_err());
    state
        .record_create("cliente", campi(&[("nome", json!("Dopo il rifiuto"))]))
        .expect("una scelta non valida non deve chiudere il runtime già attivo");
}

#[test]
fn force_sync_ricostruisce_da_snapshot_quando_il_log_ha_un_gap() {
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();

    onboarda(&a, data_dir, "A");
    onboarda(&b, data_dir, "B");

    for i in 0..10 {
        a.record_create("cliente", campi(&[("nome", json!(format!("Prima {i}")))]))
            .unwrap();
    }
    b.force_sync().unwrap();
    assert_eq!(b.records_list("cliente").unwrap().len(), 10);

    for i in 10..30 {
        a.record_create("cliente", campi(&[("nome", json!(format!("Dopo {i}")))]))
            .unwrap();
    }
    a.with_engine(|engine| {
        engine.snapshot().map_err(es)?;
        engine.compact_own_log(5).map_err(es)?;
        Ok(())
    })
    .unwrap();

    let _ = b.force_sync().unwrap();
    assert_eq!(
        b.records_list("cliente").unwrap().len(),
        30,
        "il PC indietro deve vedere tutti i record: via watcher se gia' arrivati, o via snapshot/gap con la sync manuale"
    );
}

#[test]
fn gap_coperto_da_snapshot_su_quattro_postazioni_richiede_solo_riallineamento() {
    let data = tempfile::tempdir().unwrap();
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let app_c = tempfile::tempdir().unwrap();
    let app_d = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    let c = AppState::init(app_c.path().to_path_buf()).unwrap();
    let d = AppState::init(app_d.path().to_path_buf()).unwrap();

    onboarda(&a, data_dir, "A");
    onboarda(&b, data_dir, "B");
    onboarda(&c, data_dir, "C");
    onboarda(&d, data_dir, "D");
    for i in 0..10 {
        a.record_create("cliente", campi(&[("nome", json!(format!("Prima {i}")))]))
            .unwrap();
    }
    for state in [&b, &c, &d] {
        state.force_sync().unwrap();
        assert_eq!(state.records_list("cliente").unwrap().len(), 10);

        // Le postazioni diventano offline: sostituiamo il watcher con uno inerte,
        // mantenendo proiezione e offset reali. Il poll successivo è così la prima
        // osservazione del log compattato, senza dipendere dal timing del filesystem.
        let cfg = state.config();
        *state.runtime.lock().unwrap() = None;
        let engine = Arc::new(
            crate::sync::Engine::open(
                data_dir,
                state.app_dir.join("projection.sqlite"),
                &cfg.device_id,
                cfg.user_id.as_deref().unwrap(),
            )
            .unwrap(),
        );
        let watcher = notify::recommended_watcher(|_: notify::Result<notify::Event>| {}).unwrap();
        *state.runtime.lock().unwrap() = Some(Runtime {
            _watcher: watcher,
            engine,
        });
    }

    for i in 10..30 {
        a.record_create("cliente", campi(&[("nome", json!(format!("Dopo {i}")))]))
            .unwrap();
    }
    a.with_engine(|engine| {
        engine.snapshot().map_err(es)?;
        engine.compact_own_log(5).map_err(es)?;
        Ok(())
    })
    .unwrap();

    for state in [&b, &c, &d] {
        assert!(matches!(
            state.poll_sync_entities().unwrap(),
            SyncPollOutcome::Rebuild("snapshot")
        ));
        let prima = state.bootstrap();
        assert!(prima.onboarded);
        assert!(!prima.reconnect_required);
        assert_eq!(prima.data_dir_status, "ok");

        state.ricostruisci_proiezione_locale().unwrap();
        let dopo = state.bootstrap();
        assert!(dopo.onboarded);
        assert!(!dopo.reconnect_required);
        assert_eq!(dopo.data_dir_status, "ok");
        assert_eq!(state.records_list("cliente").unwrap().len(), 30);
    }
}

#[test]
fn quattro_postazioni_convergono_dopo_restore_ritiro_remoto_e_reset_completo() {
    let data = tempfile::tempdir().unwrap();
    let backup_dir = tempfile::tempdir().unwrap();
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let app_c = tempfile::tempdir().unwrap();
    let app_d = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();

    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    let c = AppState::init(app_c.path().to_path_buf()).unwrap();
    let d = AppState::init(app_d.path().to_path_buf()).unwrap();
    let id_a = onboarda(&a, data_dir, "Anna");
    let id_b = onboarda(&b, data_dir, "Bruno");
    let id_c = onboarda(&c, data_dir, "Carla");
    let id_d = onboarda(&d, data_dir, "Diego");
    for state in [&a, &b, &c, &d] {
        state.force_sync().unwrap();
    }

    let nel_backup = a
        .record_create(
            "cliente",
            campi(&[("nome", json!("Conservato dal backup"))]),
        )
        .unwrap();
    for state in [&b, &c, &d] {
        state.force_sync().unwrap();
    }
    let backup = a
        .backup_now(
            Some(backup_dir.path().to_string_lossy().into_owned()),
            Some("matrice-quattro-pc".into()),
        )
        .unwrap();
    let dopo_backup = a
        .record_create(
            "cliente",
            campi(&[("nome", json!("Da rimuovere col restore"))]),
        )
        .unwrap();
    for state in [&b, &c, &d] {
        state.force_sync().unwrap();
        assert!(state
            .record_get("cliente", &dopo_backup.id)
            .unwrap()
            .is_some());
    }

    let coordinamento = a.restore_prepare().unwrap();
    a.ripristina_backup(
        &backup.path,
        None,
        Some("auto"),
        Some(&coordinamento.restore_id),
    )
    .unwrap();

    // Le tre postazioni remote non devono scambiare il payload del restore per
    // una cartella sparita o una sessione revocata. Prima vedono `ready`, poi
    // ricostruiscono dall'anchor e conservano ciascuna la propria identità.
    for (state, identity) in [(&b, &id_b), (&c, &id_c), (&d, &id_d)] {
        let prima = state.bootstrap();
        assert_eq!(prima.restore_status, "ready");
        assert!(prima.onboarded);
        assert!(!prima.reconnect_required);
        assert!(matches!(
            state.poll_sync_entities().unwrap(),
            SyncPollOutcome::Rebuild("restore")
        ));
        state.ricostruisci_proiezione_locale().unwrap();
        let dopo = state.bootstrap();
        assert_eq!(dopo.restore_status, "none");
        assert!(dopo.onboarded);
        assert!(!dopo.reconnect_required);
        assert_eq!(dopo.identity.unwrap().user_id, identity.user_id);
        assert!(state
            .record_get("cliente", &nel_backup.id)
            .unwrap()
            .is_some());
        assert!(state
            .record_get("cliente", &dopo_backup.id)
            .unwrap()
            .is_none());
    }

    // A ritira D da remoto. Le altre tre sessioni restano valide; D riceve un
    // rebuild tecnico e solo dopo la proiezione autorevole passa a reconnect.
    a.ritira_dispositivo(&id_d.device_id).unwrap();
    for state in [&a, &b, &c] {
        match state.poll_sync_entities().unwrap() {
            SyncPollOutcome::Rebuild(_) => state.ricostruisci_proiezione_locale().unwrap(),
            SyncPollOutcome::Changed(_) | SyncPollOutcome::Waiting => {}
        }
        let boot = state.bootstrap();
        assert!(
            boot.onboarded,
            "il ritiro di D non deve scollegare gli altri PC"
        );
        assert!(!boot.reconnect_required);
    }
    match d.poll_sync_entities().unwrap() {
        SyncPollOutcome::Rebuild(_) => {}
        // Il file-watch può aver già ingerito e notificato `device_retired` prima
        // del poll esplicito. In quel caso l'elenco è correttamente già vuoto.
        SyncPollOutcome::Changed(_) => {}
        SyncPollOutcome::Waiting => panic!("il ritiro completo non deve restare in attesa"),
    }
    d.ricostruisci_proiezione_locale().unwrap();
    let ritirata = d.bootstrap();
    assert!(!ritirata.onboarded);
    assert!(ritirata.reconnect_required);
    assert!(ritirata.data_dir.is_none());
    assert_ne!(ritirata.device_id, id_d.device_id);

    // Il nuovo onboarding della postazione ritirata deve percorrere tutti i passi
    // e produrre una nuova identità/device, senza riusare la sessione revocata.
    let utenti = d.open_data_dir(data_dir).unwrap();
    assert!(utenti.iter().all(|utente| utente.id != id_d.user_id));
    let nuovo_d = d
        .finish_onboarding(FinishOnboarding {
            data_dir: data_dir.to_string(),
            mode: "create".into(),
            user_id: Some("diego-dopo-ritiro".into()),
            nome: "Diego".into(),
            avatar_tipo: "iniziali".into(),
            avatar_valore: String::new(),
        })
        .unwrap();
    assert_ne!(nuovo_d.device_id, id_d.device_id);
    assert_eq!(nuovo_d.user_id, "diego-dopo-ritiro");

    // Un reset completo volontario su C porta C al normale onboarding, mentre
    // le altre tre postazioni vengono esplicitamente revocate e devono mostrare
    // il percorso di ricollegamento, non «cartella dati non disponibile».
    c.reset_completo().unwrap();
    let locale = c.bootstrap();
    assert!(!locale.onboarded);
    assert!(!locale.reconnect_required);
    assert_eq!(locale.data_dir_status, "not_configured");

    for state in [&a, &b, &d] {
        match state.poll_sync_entities().unwrap() {
            SyncPollOutcome::Rebuild(_) | SyncPollOutcome::Changed(_) => {}
            SyncPollOutcome::Waiting => panic!("la barriera completa del reset non è parziale"),
        }
        state.ricostruisci_proiezione_locale().unwrap();
        let remoto = state.bootstrap();
        assert!(!remoto.onboarded);
        assert!(remoto.reconnect_required);
        assert!(remoto.data_dir.is_none());
        assert_eq!(remoto.data_dir_status, "not_configured");
    }

    // Le identità originarie erano realmente quattro e tutte distinte: protegge
    // il test da una falsa copertura ottenuta condividendo lo stesso profilo.
    let ids = [&id_a.user_id, &id_b.user_id, &id_c.user_id, &id_d.user_id];
    assert_eq!(ids.iter().collect::<HashSet<_>>().len(), 4);
}

#[test]
fn due_dispositivi_condividono_le_anagrafiche() {
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();

    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    a.open_data_dir(data_dir).unwrap();
    b.open_data_dir(data_dir).unwrap();

    // A crea un cliente; B (dopo una sync esplicita) lo vede.
    a.record_create(
        "cliente",
        campi(&[
            ("nome", json!("Farmacia Centrale")),
            ("citta", json!("Firenze")),
        ]),
    )
    .unwrap();
    b.force_sync().unwrap();
    let lista = b.records_list("cliente").unwrap();
    assert_eq!(lista.len(), 1);
    assert_eq!(lista[0].data["nome"], json!("Farmacia Centrale"));
    assert_eq!(lista[0].data["citta"], json!("Firenze"));

    // Modifica concorrente di campi diversi: A cambia città, B aggiunge telefono.
    let id = lista[0].id.clone();
    a.record_update("cliente", &id, campi(&[("citta", json!("Prato"))]))
        .unwrap();
    b.record_update("cliente", &id, campi(&[("telefono", json!("055-123"))]))
        .unwrap();
    a.force_sync().unwrap();
    b.force_sync().unwrap();
    let ra = a.record_get("cliente", &id).unwrap().unwrap();
    let rb = b.record_get("cliente", &id).unwrap().unwrap();
    // Convergono: entrambi i campi presenti su entrambi i dispositivi.
    for r in [&ra, &rb] {
        assert_eq!(r.data["citta"], json!("Prato"));
        assert_eq!(r.data["telefono"], json!("055-123"));
    }
}

#[test]
fn suggerimento_nascosto_converge_e_una_sorgente_modificata_lo_riattiva() {
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    fs::write(app_a.path().join("premium.json"), br#"{"enabled":true}"#).unwrap();
    fs::write(app_b.path().join("premium.json"), br#"{"enabled":true}"#).unwrap();
    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    onboarda(&a, data_dir, "Anna");
    onboarda(&b, data_dir, "Bruno");

    let rimborso = a
        .record_create(
            "rimborso",
            campi(&[
                ("importo", json!(10_000)),
                ("data_richiesta", json!("2026-08-01")),
                ("data_rimborso", json!("")),
            ]),
        )
        .unwrap();
    b.force_sync().unwrap();

    let prima = a
        .suggerimenti_lista()
        .unwrap()
        .suggerimenti
        .into_iter()
        .find(|voce| voce.tipo == "rimborso")
        .unwrap();
    let stessa_su_b = b
        .suggerimenti_lista()
        .unwrap()
        .suggerimenti
        .into_iter()
        .find(|voce| voce.tipo == "rimborso")
        .unwrap();
    assert_eq!(stessa_su_b.id, prima.id);

    let id_tecnico = "s14:test:batch-condiviso".to_string();
    a.suggerimenti_nascondi(&[prima.id.clone(), id_tecnico.clone()])
        .unwrap();
    b.force_sync().unwrap();
    let nascosti_su_b = b.suggerimenti_lista().unwrap();
    assert!(nascosti_su_b
        .suggerimenti
        .iter()
        .all(|voce| voce.id != prima.id));
    assert!(nascosti_su_b.nascosti.contains(&prima.id));
    assert!(nascosti_su_b.nascosti.contains(&id_tecnico));

    b.record_update(
        "rimborso",
        &rimborso.id,
        campi(&[("importo", json!(12_000))]),
    )
    .unwrap();
    let riattivato_su_b = b
        .suggerimenti_lista()
        .unwrap()
        .suggerimenti
        .into_iter()
        .find(|voce| voce.tipo == "rimborso")
        .unwrap();
    assert_ne!(riattivato_su_b.id, prima.id);

    a.force_sync().unwrap();
    let riattivato_su_a = a
        .suggerimenti_lista()
        .unwrap()
        .suggerimenti
        .into_iter()
        .find(|voce| voce.tipo == "rimborso")
        .unwrap();
    assert_eq!(riattivato_su_a.id, riattivato_su_b.id);
}

#[test]
fn due_dispositivi_sincronizzano_scadenza_e_anticipo_del_promemoria() {
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    a.open_data_dir(data_dir).unwrap();
    b.open_data_dir(data_dir).unwrap();

    let promemoria = a
        .record_create(
            "promemoria",
            campi(&[
                ("testo", json!("Richiamare il cliente")),
                ("scadenza", json!("2026-08-10")),
                ("avviso_anticipato", json!(2)),
                ("fatto", json!(false)),
            ]),
        )
        .unwrap();
    b.force_sync().unwrap();
    let ricevuto = b.record_get("promemoria", &promemoria.id).unwrap().unwrap();
    assert_eq!(ricevuto.data["scadenza"], json!("2026-08-10"));
    assert_eq!(ricevuto.data["avviso_anticipato"], json!(2));

    b.record_update(
        "promemoria",
        &promemoria.id,
        campi(&[
            ("scadenza", json!("2026-08-18")),
            ("avviso_anticipato", json!(5)),
        ]),
    )
    .unwrap();
    a.force_sync().unwrap();
    let aggiornato = a.record_get("promemoria", &promemoria.id).unwrap().unwrap();
    assert_eq!(aggiornato.data["scadenza"], json!("2026-08-18"));
    assert_eq!(aggiornato.data["avviso_anticipato"], json!(5));
}

#[test]
fn risalvare_un_valore_identico_resta_un_evento_lww() {
    let data = tempfile::tempdir().unwrap();
    let data_dir = data.path().to_str().unwrap();
    let app_a = tempfile::tempdir().unwrap();
    let app_b = tempfile::tempdir().unwrap();
    let a = AppState::init(app_a.path().to_path_buf()).unwrap();
    let b = AppState::init(app_b.path().to_path_buf()).unwrap();
    a.open_data_dir(data_dir).unwrap();
    b.open_data_dir(data_dir).unwrap();

    let cliente = a
        .record_create("cliente", campi(&[("citta", json!("Firenze"))]))
        .unwrap();
    b.force_sync().unwrap();
    b.record_update("cliente", &cliente.id, campi(&[("citta", json!("Prato"))]))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2));

    // Sul PC A il valore è ancora Firenze, ma il salvataggio esplicito deve
    // comunque produrre un nuovo evento e prevalere sulla modifica offline di B.
    a.record_update(
        "cliente",
        &cliente.id,
        campi(&[("citta", json!("Firenze"))]),
    )
    .unwrap();
    a.force_sync().unwrap();
    b.force_sync().unwrap();
    assert_eq!(
        a.record_get("cliente", &cliente.id).unwrap().unwrap().data["citta"],
        json!("Firenze")
    );
    assert_eq!(
        b.record_get("cliente", &cliente.id).unwrap().unwrap().data["citta"],
        json!("Firenze")
    );
}

#[test]
fn spedizioni_evasione_parziale_e_stato() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[
                ("nome", json!("Vaccino")),
                ("prezzo_base_default", json!(10000)),
            ]),
        )
        .unwrap();
    let cliente = state
        .record_create(
            "cliente",
            campi(&[
                ("nome", json!("Rossi Mario")),
                ("indirizzo", json!("Via Roma 1")),
                ("citta", json!("Bari")),
                ("prov", json!("BA")),
                ("telefono", json!("3331112233")),
            ]),
        )
        .unwrap();
    let gls = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    // Ordine "In produzione" con 2 righe (2 prodotti → 2 colli proposti): lo stato
    // prima della spedizione deve essere ripristinato all'annullo.
    let o = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("In produzione")),
                ("cliente_id", json!(cliente.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    for _ in 0..2 {
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(10000)),
                ]),
            )
            .unwrap();
    }
    let stato = |id: &str| {
        state
            .ordini_lista()
            .unwrap()
            .into_iter()
            .find(|x| x.id == id)
            .unwrap()
            .stato
    };
    let colli = |id: &str| {
        state
            .ordini_lista()
            .unwrap()
            .into_iter()
            .find(|x| x.id == id)
            .unwrap()
            .colli
    };

    // Tutto da spedire: 1 ordine, 2 righe, colli = 2, con i dati di destinazione.
    let da = state.righe_da_spedire().unwrap();
    assert_eq!(da.len(), 1);
    assert_eq!(da[0].righe.len(), 2);
    assert_eq!(da[0].colli, 2);
    assert_eq!(da[0].citta, "Bari");
    assert_eq!(colli(&o.id), 2);

    // Spedisci 1 riga → evasione parziale: l'ordine RESTA "In produzione" (niente più
    // stato "Parzialmente spedito"; il segnalibro pre-spedizione si salva al full ship).
    let r1 = da[0].righe[0].riga_id.clone();
    let sp1 = state
        .spedizione_crea(
            "lottoA",
            "2026-06-05",
            &gls.id,
            1,
            1,
            "",
            true,
            "",
            0,
            "",
            &[rn(&r1, "55001")],
        )
        .unwrap();
    assert_eq!(sp1.lotto, "lottoA");
    assert_eq!(sp1.n_righe, 1);
    assert_eq!(sp1.corriere_nome, "CORRIERE_B");
    assert_eq!(sp1.cliente_nome, "Rossi Mario");
    let err = match state.spedizione_crea(
        "lottoDuplicato",
        "2026-06-05",
        &gls.id,
        1,
        1,
        "",
        false,
        "",
        0,
        "",
        &[rn(&r1, "55001")],
    ) {
        Ok(_) => panic!("la stessa riga non doveva poter essere spedita due volte"),
        Err(err) => err,
    };
    assert!(err.contains("gia spedita"), "{err}");
    assert_eq!(state.spedizioni_lista().unwrap().len(), 1);
    let sped_pre_override = state
        .spedizioni_lista()
        .unwrap()
        .into_iter()
        .find(|s| s.id == sp1.id)
        .unwrap();
    assert_eq!(
        sped_pre_override.citta, "Bari",
        "senza override legge il destinatario dall'ordine"
    );
    state
        .record_update(
            "spedizione",
            &sp1.id,
            campi(&[
                ("dest_cliente", json!("Farmacia Verdi")),
                ("dest_indirizzo", json!("Via Milano 8")),
                ("dest_cap", json!("20100")),
                ("dest_citta", json!("Milano")),
                ("dest_prov", json!("MI")),
                ("dest_regione", json!("Lombardia")),
                ("dest_telefono", json!("021234")),
                ("dest_email", json!("")),
            ]),
        )
        .unwrap();
    state
        .record_update("riga_ordine", &r1, campi(&[("numero", json!("99001"))]))
        .unwrap();
    let sped_post_override = state
        .spedizioni_lista()
        .unwrap()
        .into_iter()
        .find(|s| s.id == sp1.id)
        .unwrap();
    assert_eq!(sped_post_override.cliente_nome, "Farmacia Verdi");
    assert_eq!(sped_post_override.citta, "Milano");
    assert_eq!(sped_post_override.telefono, "021234");
    assert_eq!(sped_post_override.righe[0].numero, "99001");
    assert_eq!(stato(&o.id), "In produzione");
    // Ora resta 1 riga da spedire.
    let da = state.righe_da_spedire().unwrap();
    assert_eq!(da[0].righe.len(), 1);

    // Spedisci la seconda → ordine Spedito, niente più da spedire.
    let r2 = da[0].righe[0].riga_id.clone();
    state
        .spedizione_crea(
            "lottoA",
            "2026-06-05",
            &gls.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&r2, "55002")],
        )
        .unwrap();
    assert_eq!(stato(&o.id), "Spedito");
    assert!(state.righe_da_spedire().unwrap().is_empty());
    assert_eq!(state.spedizioni_lista().unwrap().len(), 2);

    // Annulla la prima spedizione → non più completamente spedito: torna allo stato
    // pre ("In produzione") e la riga riappare fra quelle da spedire.
    state.spedizione_annulla(&sp1.id).unwrap();
    assert_eq!(stato(&o.id), "In produzione");
    let da = state.righe_da_spedire().unwrap();
    assert_eq!(da[0].righe.len(), 1);
    assert_eq!(da[0].righe[0].riga_id, r1);
    assert_eq!(
        da[0].righe[0].numero, "99001",
        "il lotto corretto segue la riga dopo l'annullo"
    );
    assert_eq!(state.spedizioni_lista().unwrap().len(), 1);

    // Annulla l'intero lotto → l'ordine RIPRISTINA lo stato precedente ("In produzione"),
    // tutte le righe tornano da spedire, nessuna spedizione resta.
    state.lotto_annulla("lottoA").unwrap();
    assert_eq!(
        stato(&o.id),
        "In produzione",
        "ripristina lo stato pre-spedizione, non Confermato"
    );
    assert_eq!(state.righe_da_spedire().unwrap()[0].righe.len(), 2);
    assert!(state.spedizioni_lista().unwrap().is_empty());
    // Le spedizioni annullate NON finiscono nel Cestino (Purged, non Deleted).
    assert!(
        !state
            .cestino()
            .unwrap()
            .iter()
            .any(|c| c.entity == "spedizione"),
        "una spedizione annullata non deve comparire nel cestino"
    );
}

#[test]
fn diagnostica_non_conserva_numero_vaccino_o_colli() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let prodotto = state
        .record_create("prodotto", campi(&[("nome", json!("Test diagnostico"))]))
        .unwrap();
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Mario Rossi"))]))
        .unwrap();
    let corriere = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    let ordine = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("categoria", json!("Diagnostica")),
                ("cliente_id", json!(cliente.id)),
            ]),
        )
        .unwrap();
    let riga = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id)),
                ("prodotto_id", json!(prodotto.id)),
                ("qta", json!(2)),
                ("prezzo", json!(1000)),
            ]),
        )
        .unwrap();

    let spedizione = state
        .spedizione_crea(
            "lotto-diagnostica",
            "2026-08-05",
            &corriere.id,
            7,
            7,
            "",
            false,
            "",
            0,
            "",
            &[rn(&riga.id, "55001 / 55002")],
        )
        .unwrap();

    assert_eq!(spedizione.colli, 1);
    assert_eq!(spedizione.numero, "");
    assert_eq!(spedizione.righe[0].numero, "");
    assert_eq!(spedizione.righe[0].categoria, "Diagnostica");
}

#[test]
fn rimozione_prodotto_ricalcola_contrassegno_parziale_con_acconto() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[
                ("nome", json!("Vaccino")),
                ("prezzo_base_default", json!(10000)),
            ]),
        )
        .unwrap();
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    let gls = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    let ordine = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("cliente_id", json!(cliente.id)),
                ("data", json!("2026-06-01")),
                ("acconto", json!(4000)),
            ]),
        )
        .unwrap();
    let r1 = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(1)),
                ("prezzo", json!(10000)),
            ]),
        )
        .unwrap();
    let r2 = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(1)),
                ("prezzo", json!(10000)),
            ]),
        )
        .unwrap();

    let sped = state
        .spedizione_crea(
            "lottoCOD",
            "2026-06-05",
            &gls.id,
            1,
            1,
            "",
            false,
            "contrassegno",
            16000,
            "",
            &[rn(&r1.id, "A"), rn(&r2.id, "B")],
        )
        .unwrap();

    state.spedizione_riga_rimuovi(&r1.id).unwrap();
    let aggiornata = state
        .spedizioni_lista()
        .unwrap()
        .into_iter()
        .find(|s| s.id == sped.id)
        .unwrap();
    assert_eq!(aggiornata.n_righe, 1);
    assert_eq!(
        aggiornata.contrassegno, 8000,
        "un prodotto da 100 meno metà acconto da 40 lascia 80 di COD"
    );
}

#[test]
fn rata_spostata_in_contrassegno_riallinea_la_distinta_spedizione() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let banca = state
        .record_create(
            "conto",
            campi(&[("nome", json!("Banca")), ("tipo", json!("banca"))]),
        )
        .unwrap();
    let contrassegno = state
        .record_create(
            "conto",
            campi(&[
                ("nome", json!("Contrassegno")),
                ("tipo", json!("contrassegno")),
            ]),
        )
        .unwrap();
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    let corriere = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    let ordine = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("cliente_id", json!(cliente.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    let riga = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id)),
                ("prodotto_nome", json!("Vaccino")),
                ("qta", json!(1)),
                ("prezzo", json!(10000)),
            ]),
        )
        .unwrap();
    let rata = state
        .pagamento_registra(
            &ordine.id,
            "rata",
            7500,
            false,
            "2026-07-01",
            &banca.id,
            "",
            false,
            None,
        )
        .unwrap();
    let spedizione = state
        .spedizione_crea(
            "lotto-sync-cod",
            "2026-06-10",
            &corriere.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&riga.id, "LOT-COD")],
        )
        .unwrap();

    state
        .record_update(
            "pagamento",
            &rata.id,
            campi(&[("conto_id", json!(contrassegno.id))]),
        )
        .unwrap();
    let aggiornata = state
        .spedizioni_lista()
        .unwrap()
        .into_iter()
        .find(|sped| sped.id == spedizione.id)
        .unwrap();
    assert_eq!(aggiornata.mezzo, "contrassegno");
    assert_eq!(aggiornata.contrassegno, 7500);

    state
        .record_update("pagamento", &rata.id, campi(&[("importo", json!(8000))]))
        .unwrap();
    let aggiornata = state
        .spedizioni_lista()
        .unwrap()
        .into_iter()
        .find(|sped| sped.id == spedizione.id)
        .unwrap();
    assert_eq!(aggiornata.contrassegno, 8000);

    state
        .record_update(
            "pagamento",
            &rata.id,
            campi(&[("conto_id", json!(banca.id))]),
        )
        .unwrap();
    let aggiornata = state
        .spedizioni_lista()
        .unwrap()
        .into_iter()
        .find(|sped| sped.id == spedizione.id)
        .unwrap();
    assert_eq!(aggiornata.mezzo, "");
    assert_eq!(aggiornata.contrassegno, 0);
}

#[test]
fn annullo_spedizione_da_ordine_chiuso_ripristina_stato_precedente() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let prod = state
        .record_create("prodotto", campi(&[("nome", json!("Vaccino"))]))
        .unwrap();
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    let gls = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    let ordine = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Arrivato IT")),
                ("cliente_id", json!(cliente.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    let riga = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(1)),
                ("prezzo", json!(10000)),
            ]),
        )
        .unwrap();
    let sped = state
        .spedizione_crea(
            "lottoChiuso",
            "2026-06-05",
            &gls.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&riga.id, "A")],
        )
        .unwrap();
    assert_eq!(
        state
            .ordini_lista()
            .unwrap()
            .into_iter()
            .find(|o| o.id == ordine.id)
            .unwrap()
            .stato,
        "Spedito"
    );

    state
        .record_update("ordine", &ordine.id, campi(&[("stato", json!("Chiuso"))]))
        .unwrap();
    state.spedizione_annulla(&sped.id).unwrap();
    assert_eq!(
        state
            .ordini_lista()
            .unwrap()
            .into_iter()
            .find(|o| o.id == ordine.id)
            .unwrap()
            .stato,
        "Arrivato IT"
    );
}

#[test]
fn spedizione_destinatari_unisci_e_separa_righe_e_collo() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let prod = state
        .record_create("prodotto", campi(&[("nome", json!("Vaccino"))]))
        .unwrap();
    let cliente = state
        .record_create(
            "cliente",
            campi(&[
                ("nome", json!("Ospedale")),
                ("indirizzo", json!("Via Roma 1")),
                ("cap", json!("00100")),
                ("citta", json!("Roma")),
                ("prov", json!("RM")),
            ]),
        )
        .unwrap();
    let gls = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    let crea = |numero: &str, prezzo: i64| {
        let ordine = state
            .record_create(
                "ordine",
                campi(&[
                    ("stato", json!("Confermato")),
                    ("cliente_id", json!(cliente.id)),
                    ("data", json!("2026-06-01")),
                ]),
            )
            .unwrap();
        let riga = state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(ordine.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(prezzo)),
                ]),
            )
            .unwrap();
        state
            .spedizione_crea(
                "lottoDest",
                "2026-06-05",
                &gls.id,
                1,
                1,
                "",
                false,
                "contrassegno",
                prezzo,
                "",
                &[rn(&riga.id, numero)],
            )
            .unwrap()
    };
    let sp1 = crea("A", 10000);
    let sp2 = crea("B", 12000);

    state
        .spedizione_destinatari_unisci(vec![sp1.id.clone(), sp2.id.clone()])
        .unwrap();
    let unite = state.spedizioni_lista().unwrap();
    assert_eq!(unite.len(), 1);
    assert_eq!(unite[0].id, sp1.id);
    assert_eq!(unite[0].n_righe, 2);
    assert_eq!(unite[0].colli, 2);
    assert_eq!(unite[0].contrassegno, 22000);
    assert!(unite[0].destinatari_uniti);

    state.spedizione_destinatari_separa(&sp1.id).unwrap();
    let separate = state.spedizioni_lista().unwrap();
    assert_eq!(separate.len(), 2);
    let a = separate.iter().find(|s| s.id == sp1.id).unwrap();
    let b = separate.iter().find(|s| s.id == sp2.id).unwrap();
    assert_eq!(
        (a.n_righe, a.colli, a.contrassegno, a.destinatari_uniti),
        (1, 1, 10000, false)
    );
    assert_eq!((b.n_righe, b.colli, b.contrassegno), (1, 1, 12000));
}

#[test]
fn scadenze_si_ancorano_alla_spedizione() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[
                ("nome", json!("Vaccino")),
                ("prezzo_base_default", json!(10000)),
            ]),
        )
        .unwrap();
    let cliente = state
        .record_create(
            "cliente",
            campi(&[("nome", json!("Rossi")), ("citta", json!("Bari"))]),
        )
        .unwrap();
    let gls = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    let banca = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();
    state.conto_predefinito_set(&banca.id, "incassi").unwrap();

    // Crea un ordine Confermato con una riga da 100€; ritorna (ordine, riga_id).
    let crea_ordine = |data_ord: &str| {
        let o = state
            .record_create(
                "ordine",
                campi(&[
                    ("stato", json!("Confermato")),
                    ("cliente_id", json!(cliente.id)),
                    ("data", json!(data_ord)),
                ]),
            )
            .unwrap();
        let r = state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(10000)),
                ]),
            )
            .unwrap();
        (o, r.id)
    };
    let scad = |oid: &str| {
        state
            .pagamenti_ordine(oid)
            .unwrap()
            .into_iter()
            .find(|p| p.tipo == "saldo")
            .map(|p| p.scadenza)
            .unwrap_or_default()
    };

    // Saldo unico legato alla spedizione → scadenza = spedizione + 7gg.
    let (o1, r1) = crea_ordine("2026-06-01");
    let s1 = state
        .pagamento_registra(
            &o1.id,
            "saldo",
            10000,
            false,
            "2026-07-01",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    state
        .record_update(
            "pagamento",
            &s1.id,
            campi(&[
                ("scad_da_spedizione", json!(true)),
                ("scad_rel_giorni", json!(0)),
            ]),
        )
        .unwrap();
    state
        .spedizione_crea(
            "L1",
            "2026-06-10",
            &gls.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&r1, "1")],
        )
        .unwrap();
    assert_eq!(scad(&o1.id), "2026-06-17", "saldo unico: spedizione + 7gg");

    // Conto contrassegno → scadenza = spedizione + 30gg.
    let (o2, r2) = crea_ordine("2026-06-01");
    let s2 = state
        .pagamento_registra(
            &o2.id,
            "saldo",
            10000,
            false,
            "2026-07-01",
            CONTO_CONTRASSEGNO,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .record_update(
            "pagamento",
            &s2.id,
            campi(&[
                ("scad_da_spedizione", json!(true)),
                ("scad_rel_giorni", json!(0)),
            ]),
        )
        .unwrap();
    state
        .spedizione_crea(
            "L2",
            "2026-06-10",
            &gls.id,
            1,
            1,
            "",
            false,
            "contrassegno",
            10000,
            "",
            &[rn(&r2, "2")],
        )
        .unwrap();
    assert_eq!(
        scad(&o2.id),
        "2026-07-10",
        "contrassegno: spedizione + 30gg"
    );

    // Senza il flag: la spedizione NON tocca la scadenza.
    let (o3, r3) = crea_ordine("2026-06-01");
    state
        .pagamento_registra(
            &o3.id,
            "saldo",
            10000,
            false,
            "2026-07-01",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    state
        .spedizione_crea(
            "L3",
            "2026-06-10",
            &gls.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&r3, "3")],
        )
        .unwrap();
    assert_eq!(scad(&o3.id), "2026-07-01", "senza flag: scadenza invariata");

    // Rateizza su ordine GIÀ spedito (flag attivo) → rate ancorate subito a spedizione+7 e +37.
    let (o4, r4) = crea_ordine("2026-06-01");
    state
        .pagamento_registra(
            &o4.id,
            "saldo",
            10000,
            false,
            "2026-07-01",
            "",
            "",
            false,
            None,
        )
        .unwrap();
    state
        .spedizione_crea(
            "L4",
            "2026-06-10",
            &gls.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&r4, "4")],
        )
        .unwrap();
    state
        .pagamenti_rateizza(
            &o4.id,
            vec![
                RataInput {
                    importo: 5000,
                    scadenza: "2099-01-01".into(),
                },
                RataInput {
                    importo: 5000,
                    scadenza: "2099-01-31".into(),
                },
            ],
            true,
        )
        .unwrap();
    let mut scadenze: Vec<String> = state
        .pagamenti_ordine(&o4.id)
        .unwrap()
        .into_iter()
        .filter(|p| p.tipo == "rata")
        .map(|p| p.scadenza)
        .collect();
    scadenze.sort();
    assert_eq!(
        scadenze,
        vec!["2026-06-17".to_string(), "2026-07-17".to_string()],
        "rate: spedizione +7 e +37 (cadenza preservata)"
    );

    // Percorso dell'editor: una rata relativa viene materializzata dopo che
    // l'ordine è già spedito e nasce senza data. Il riallineamento importi deve
    // ancorarla immediatamente alla spedizione esistente.
    let (o4b, r4b) = crea_ordine("2026-06-01");
    state
        .spedizione_crea(
            "L4B",
            "2026-06-10",
            &gls.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&r4b, "4B")],
        )
        .unwrap();
    let relativa = state
        .pagamento_registra(&o4b.id, "rata", 10000, false, "", "", "", false, None)
        .unwrap();
    state
        .record_update(
            "pagamento",
            &relativa.id,
            campi(&[
                ("scad_da_spedizione", json!(true)),
                ("scad_rel_giorni", json!(0)),
            ]),
        )
        .unwrap();
    state.pagamenti_riallinea_aperti(&o4b.id).unwrap();
    let relativa_riallineata = state
        .pagamenti_ordine(&o4b.id)
        .unwrap()
        .into_iter()
        .find(|pagamento| pagamento.id == relativa.id)
        .unwrap();
    assert_eq!(
        relativa_riallineata.scadenza, "2026-06-17",
        "una rata relativa aggiunta dopo la spedizione non può restare senza data"
    );

    // Rateizza un saldo in contrassegno già spedito: solo la prima rata resta
    // contrassegno (+30), le successive passano al conto default (+7 + cadenza).
    let (o5, r5) = crea_ordine("2026-06-01");
    state
        .pagamento_registra(
            &o5.id,
            "saldo",
            10000,
            false,
            "2026-07-01",
            CONTO_CONTRASSEGNO,
            "",
            false,
            None,
        )
        .unwrap();
    state
        .spedizione_crea(
            "L5",
            "2026-06-10",
            &gls.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&r5, "5")],
        )
        .unwrap();
    state
        .pagamenti_rateizza(
            &o5.id,
            vec![
                RataInput {
                    importo: 5000,
                    scadenza: "2099-01-01".into(),
                },
                RataInput {
                    importo: 5000,
                    scadenza: "2099-01-31".into(),
                },
            ],
            true,
        )
        .unwrap();
    let mut rate_cod: Vec<_> = state
        .pagamenti_ordine(&o5.id)
        .unwrap()
        .into_iter()
        .filter(|p| p.tipo == "rata")
        .collect();
    rate_cod.sort_by(|a, b| a.scadenza.cmp(&b.scadenza));
    assert_eq!(rate_cod[0].conto_id, CONTO_CONTRASSEGNO);
    assert_eq!(rate_cod[0].scadenza, "2026-07-10");
    assert_eq!(rate_cod[1].conto_id, banca.id);
    assert_eq!(rate_cod[1].scadenza, "2026-07-17");
}

#[test]
fn crea_spedizione_ripartisce_il_residuo_sulle_rate_rimanenti() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let banca = state
        .record_create(
            "conto",
            campi(&[("nome", json!("Banca")), ("tipo", json!("banca"))]),
        )
        .unwrap();
    state.conto_predefinito_set(&banca.id, "incassi").unwrap();
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    let corriere = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    let ordine = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("cliente_id", json!(cliente.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    let riga = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(ordine.id)),
                ("prodotto_nome", json!("Vaccino")),
                ("qta", json!(1)),
                ("prezzo", json!(30000)),
            ]),
        )
        .unwrap();

    for (indice, scadenza) in ["2026-07-01", "2026-08-01", "2026-09-01"]
        .into_iter()
        .enumerate()
    {
        let rata = state
            .pagamento_registra(
                &ordine.id, "rata", 10000, false, scadenza, &banca.id, "", false, None,
            )
            .unwrap();
        state
            .record_update(
                "pagamento",
                &rata.id,
                campi(&[
                    ("scad_da_spedizione", json!(true)),
                    ("scad_rel_giorni", json!((indice as i64) * 30)),
                ]),
            )
            .unwrap();
    }

    state
        .spedizione_crea(
            "lotto-rate-assegno",
            "2026-06-10",
            &corriere.id,
            1,
            1,
            "",
            false,
            "assegno",
            12000,
            "",
            &[rn(&riga.id, "LOT-1")],
        )
        .unwrap();

    let pagamenti = state.pagamenti_ordine(&ordine.id).unwrap();
    assert_eq!(
        pagamenti.len(),
        3,
        "il numero di rate residue va conservato"
    );
    assert_eq!(pagamenti.iter().map(|p| p.importo).sum::<i64>(), 30000);
    let assegno = pagamenti
        .iter()
        .find(|pagamento| pagamento.conto_id == CONTO_ASSEGNO)
        .unwrap();
    assert_eq!(assegno.importo, 12000);
    assert_eq!(assegno.scadenza, "2026-07-10");
    let mut ordinarie: Vec<_> = pagamenti
        .iter()
        .filter(|pagamento| pagamento.conto_id == banca.id)
        .collect();
    ordinarie.sort_by(|a, b| a.scadenza.cmp(&b.scadenza));
    assert_eq!(
        ordinarie
            .iter()
            .map(|pagamento| pagamento.importo)
            .collect::<Vec<_>>(),
        vec![9000, 9000]
    );
    assert_eq!(ordinarie[0].scadenza, "2026-07-17");
    assert_eq!(ordinarie[1].scadenza, "2026-08-16");
}

#[test]
fn diagnostica_destinatario_e_il_medico() {
    // Ordine Diagnostica: nessun cliente, il destinatario È il medico. La
    // spedizione deve usare l'indirizzo del medico. FASE 4D.
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[
                ("nome", json!("Kit prick")),
                ("categoria", json!("Diagnostica")),
            ]),
        )
        .unwrap();
    let medico = state
        .record_create(
            "medico",
            campi(&[
                ("nome", json!("Dott. Bianchi")),
                ("indirizzo", json!("Via Ospedale 9")),
                ("citta", json!("Lecce")),
                ("prov", json!("LE")),
            ]),
        )
        .unwrap();
    let gls = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    // Ordine SENZA cliente_id: solo il medico (destinatario).
    let o = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("categoria", json!("Diagnostica")),
                ("medico_id", json!(medico.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(1)),
                ("prezzo", json!(5000)),
            ]),
        )
        .unwrap();

    // Da spedire: il destinatario eredita l'indirizzo del medico.
    let da = state.righe_da_spedire().unwrap();
    assert_eq!(da.len(), 1);
    assert_eq!(da[0].cliente_nome, "Dott. Bianchi");
    assert_eq!(da[0].citta, "Lecce");
    assert_eq!(da[0].medico_nome, "Dott. Bianchi");

    // Spedita: il collo riporta il medico come destinatario.
    let riga = da[0].righe[0].riga_id.clone();
    let sp = state
        .spedizione_crea(
            "lottoD",
            "2026-06-05",
            &gls.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&riga, "70001")],
        )
        .unwrap();
    assert_eq!(sp.cliente_nome, "Dott. Bianchi");
    assert_eq!(sp.citta, "Lecce");
    assert_eq!(sp.medico_nome, "Dott. Bianchi");
}

#[test]
fn ordine_annullato_sparisce_da_crediti_e_spedizioni_e_torna_al_ripristino() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let agente = state
        .record_create("agente", campi(&[("nome", json!("Agente Demo 003"))]))
        .unwrap();
    let medico = state
        .record_create(
            "medico",
            campi(&[
                ("nome", json!("Dott. Rossi")),
                ("agente_id", json!(agente.id)),
            ]),
        )
        .unwrap();
    let cli = state
        .record_create("cliente", campi(&[("nome", json!("Verdi"))]))
        .unwrap();
    let prod = state
        .record_create(
            "prodotto",
            campi(&[
                ("nome", json!("Vaccino")),
                ("categoria", json!("Immunoterapia")),
            ]),
        )
        .unwrap();
    let o = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("cliente_id", json!(cli.id)),
                ("medico_id", json!(medico.id)),
                ("agente_id", json!(agente.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(1)),
                ("prezzo", json!(10000)),
                ("stato_riga", json!("da_spedire")),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "pagamento",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("tipo", json!("saldo")),
                ("importo", json!(10000)),
                ("saldato", json!(true)),
                ("data", json!("2026-06-02")),
            ]),
        )
        .unwrap();

    let crediti = |s: &AppState| {
        s.pagamenti_vista(None, None, None, None, None)
            .unwrap()
            .len()
    };
    let daspedire = |s: &AppState| s.righe_da_spedire().unwrap().len();

    // Prima dell'annullamento: presente nei Crediti e tra le righe da spedire.
    assert_eq!(crediti(&state), 1);
    assert_eq!(daspedire(&state), 1);

    // Annullato (soft-delete): sparisce da entrambe le viste.
    state.record_delete("ordine", &o.id).unwrap();
    assert_eq!(
        crediti(&state),
        0,
        "i pagamenti di un ordine annullato non sono crediti"
    );
    assert_eq!(
        daspedire(&state),
        0,
        "le righe di un ordine annullato non vanno spedite"
    );

    // Ripristinato dal Cestino: torna esattamente com'era.
    state.record_restore("ordine", &o.id).unwrap();
    assert_eq!(crediti(&state), 1);
    assert_eq!(daspedire(&state), 1);
}

#[test]
fn ordine_ripristina_torna_attivo_per_acconto() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let cli = state
        .record_create("cliente", campi(&[("nome", json!("Verdi"))]))
        .unwrap();

    // Rifiutato SENZA incassi → ripristino a Nuovo; pulisce i campi del rifiuto.
    let o1 = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Rifiutato")),
                ("stato_pre_rifiuto", json!("Confermato")),
                ("motivo_rifiuto", json!("non interessato")),
                ("data_rifiuto", json!("2026-06-10")),
                ("cliente_id", json!(cli.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    assert_eq!(state.ordine_ripristina(&o1.id).unwrap(), "Nuovo");
    let r = state.record_get("ordine", &o1.id).unwrap().unwrap();
    assert_eq!(str_field(&r.data, "stato"), "Nuovo");
    assert_eq!(str_field(&r.data, "motivo_rifiuto"), "");
    assert_eq!(str_field(&r.data, "data_rifiuto"), "");
    assert_eq!(str_field(&r.data, "stato_pre_rifiuto"), "");

    // Rifiutato CON un incasso saldato (acconto) → ripristino a Confermato.
    let o2 = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Rifiutato")),
                ("cliente_id", json!(cli.id)),
                ("data", json!("2026-06-02")),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "pagamento",
            campi(&[
                ("ordine_id", json!(o2.id)),
                ("importo", json!(9000)),
                ("tipo", json!("acconto")),
                ("saldato", json!(true)),
            ]),
        )
        .unwrap();
    assert_eq!(state.ordine_ripristina(&o2.id).unwrap(), "Confermato");

    // No-op su un ordine non rifiutato.
    let o3 = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("cliente_id", json!(cli.id)),
                ("data", json!("2026-06-03")),
            ]),
        )
        .unwrap();
    assert_eq!(state.ordine_ripristina(&o3.id).unwrap(), "Confermato");

    // I rifiutati VIVI non sono più nel Cestino (solo i soft-deleted ci finiscono).
    let o4 = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Rifiutato")),
                ("cliente_id", json!(cli.id)),
                ("data", json!("2026-06-04")),
            ]),
        )
        .unwrap();
    assert!(
        state.cestino().unwrap().iter().all(|c| c.id != o4.id),
        "i rifiutati non sono nel Cestino"
    );
}

#[test]
fn ordine_rifiutato_eliminato_va_nel_cestino_come_annullato() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let cli = state
        .record_create("cliente", campi(&[("nome", json!("Verdi"))]))
        .unwrap();
    let o = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Rifiutato")),
                ("stato_pre_rifiuto", json!("Confermato")),
                ("cliente_id", json!(cli.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    // Vivo (rifiutato): NON nel Cestino.
    assert!(state.cestino().unwrap().iter().all(|c| c.id != o.id));

    // Eliminato (soft-delete) → una sola riga nel Cestino (annullato).
    state.record_delete("ordine", &o.id).unwrap();
    let righe: Vec<_> = state
        .cestino()
        .unwrap()
        .into_iter()
        .filter(|c| c.id == o.id)
        .collect();
    assert_eq!(righe.len(), 1, "una sola riga annullata");

    // Ripristino dal Cestino = de-annulla soltanto: l'ordine torna com'era (Rifiutato).
    state.record_restore("ordine", &o.id).unwrap();
    let r = state.record_get("ordine", &o.id).unwrap().unwrap();
    assert_eq!(
        str_field(&r.data, "stato"),
        "Rifiutato",
        "de-annullare non srifiuta"
    );
    assert!(state.cestino().unwrap().iter().all(|c| c.id != o.id));

    // Dal Giornaliero si srifiuta con ordine_ripristina (qui niente incassi → Nuovo).
    assert_eq!(state.ordine_ripristina(&o.id).unwrap(), "Nuovo");
}

#[test]
fn ordini_lista_espone_le_linee_per_categoria() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let immuno = state
        .record_create(
            "prodotto",
            campi(&[
                ("nome", json!("Vaccino")),
                ("categoria", json!("Immunoterapia")),
            ]),
        )
        .unwrap();
    let diag = state
        .record_create(
            "prodotto",
            campi(&[
                ("nome", json!("Prick")),
                ("categoria", json!("Diagnostica")),
            ]),
        )
        .unwrap();
    let cli = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();

    // Ordine solo Immunoterapia.
    let o_imm = state
        .record_create(
            "ordine",
            campi(&[("cliente_id", json!(cli.id)), ("data", json!("2026-06-01"))]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o_imm.id)),
                ("prodotto_id", json!(immuno.id)),
                ("qta", json!(1)),
                ("prezzo", json!(1000)),
            ]),
        )
        .unwrap();

    // Ordine misto: una riga Diagnostica + una Immunoterapia (linee distinte, ordinate).
    let o_mix = state
        .record_create(
            "ordine",
            campi(&[("cliente_id", json!(cli.id)), ("data", json!("2026-06-02"))]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o_mix.id)),
                ("prodotto_id", json!(diag.id)),
                ("qta", json!(1)),
                ("prezzo", json!(2000)),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o_mix.id)),
                ("prodotto_id", json!(immuno.id)),
                ("qta", json!(1)),
                ("prezzo", json!(3000)),
            ]),
        )
        .unwrap();

    let lista = state.ordini_lista().unwrap();
    let linee = |id: &str| lista.iter().find(|x| x.id == id).unwrap().linee.clone();
    assert_eq!(linee(&o_imm.id), vec!["Immunoterapia"]);
    // Distinte e ordinate alfabeticamente; la riga Diagnostica fa comparire l'ordine
    // anche sotto quel filtro.
    assert_eq!(linee(&o_mix.id), vec!["Diagnostica", "Immunoterapia"]);
}

#[test]
fn produzione_acconto_incassato_e_avanzamento_stato() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let cli = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();

    // o1: acconto saldato con data → acconto_incassato + data_acconto.
    let o1 = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("cliente_id", json!(cli.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "pagamento",
            campi(&[
                ("ordine_id", json!(o1.id)),
                ("tipo", json!("acconto")),
                ("importo", json!(9000)),
                ("saldato", json!(true)),
                ("data", json!("2026-06-05")),
            ]),
        )
        .unwrap();
    // o2: solo un saldo (nessun acconto) → acconto_incassato falso.
    let o2 = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Nuovo")),
                ("cliente_id", json!(cli.id)),
                ("data", json!("2026-06-02")),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "pagamento",
            campi(&[
                ("ordine_id", json!(o2.id)),
                ("tipo", json!("saldo")),
                ("importo", json!(5000)),
                ("saldato", json!(true)),
            ]),
        )
        .unwrap();

    let lista = state.ordini_lista().unwrap();
    let get = |id: &str| lista.iter().find(|x| x.id == id).unwrap();
    assert!(get(&o1.id).acconto_incassato);
    assert_eq!(get(&o1.id).data_acconto, "2026-06-05");
    assert!(!get(&o2.id).acconto_incassato, "un saldo non è un acconto");
    assert_eq!(get(&o2.id).data_acconto, "");

    // Avanzamento in blocco: In produzione (con data_produzione) poi Arrivato IT.
    let n = state
        .ordini_avanza_produzione(
            &[o1.id.clone(), o2.id.clone()],
            "In produzione",
            "2026-06-10",
        )
        .unwrap();
    assert_eq!(n, 2);
    let lista = state.ordini_lista().unwrap();
    let get = |id: &str| lista.iter().find(|x| x.id == id).unwrap();
    assert_eq!(get(&o1.id).stato, "In produzione");
    assert_eq!(get(&o1.id).data_produzione, "2026-06-10");

    state
        .ordini_avanza_produzione(std::slice::from_ref(&o1.id), "Arrivato IT", "2026-07-08")
        .unwrap();
    let arr = state
        .ordini_lista()
        .unwrap()
        .into_iter()
        .find(|x| x.id == o1.id)
        .unwrap();
    assert_eq!(arr.stato, "Arrivato IT");
    assert_eq!(arr.data_arrivo_it, "2026-07-08");

    // Stato non riconosciuto = no-op.
    assert_eq!(
        state
            .ordini_avanza_produzione(std::slice::from_ref(&o2.id), "Boh", "2026-07-08")
            .unwrap(),
        0
    );
}

#[test]
fn produzione_lotti_invio_annulla_unisci_separa() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let cli = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("P")), ("prezzo_base_default", json!(1000))]),
        )
        .unwrap();
    let crea = |stato: &str, d: &str| {
        let o = state
            .record_create(
                "ordine",
                campi(&[
                    ("stato", json!(stato)),
                    ("cliente_id", json!(cli.id)),
                    ("data", json!(d)),
                ]),
            )
            .unwrap();
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(1000)),
                ]),
            )
            .unwrap();
        o.id
    };
    let o1 = crea("Confermato", "2026-06-01");
    let o2 = crea("Nuovo", "2026-06-02");
    let o3 = crea("Confermato", "2026-06-03");
    let get = |id: &str| {
        state
            .ordini_lista()
            .unwrap()
            .into_iter()
            .find(|x| x.id == id)
            .unwrap()
    };

    // Invio 1: o1 + o2 in un lotto; invio 2: o3 in un altro lotto.
    let lotto_a = state
        .produzione_invia(&[o1.clone(), o2.clone()], "2026-06-10")
        .unwrap();
    let lotto_b = state
        .produzione_invia(std::slice::from_ref(&o3), "2026-06-11")
        .unwrap();
    assert_ne!(lotto_a, lotto_b);
    assert_eq!(get(&o1).stato, "In produzione");
    assert_eq!(get(&o1).data_produzione, "2026-06-10");
    assert_eq!(get(&o1).lotto_produzione, lotto_a);
    assert_eq!(get(&o2).lotto_produzione, lotto_a);
    assert_eq!(get(&o3).lotto_produzione, lotto_b);

    // Annulla singolo o2 → torna allo stato pre ("Nuovo"), fuori dal lotto.
    state.produzione_annulla_ordine(&o2).unwrap();
    assert_eq!(get(&o2).stato, "Nuovo");
    assert_eq!(get(&o2).lotto_produzione, "");
    assert_eq!(get(&o2).data_produzione, "");
    assert_eq!(get(&o1).lotto_produzione, lotto_a, "o1 resta nel lotto");

    // Unisci lotto_a + lotto_b → un solo lotto (lotto_a); separabile dopo.
    let unito = state
        .produzione_lotto_unisci(vec![lotto_a.clone(), lotto_b.clone()])
        .unwrap();
    assert_eq!(unito, lotto_a);
    assert_eq!(get(&o1).lotto_produzione, lotto_a);
    assert_eq!(get(&o3).lotto_produzione, lotto_a);
    assert!(get(&o3).lotto_produzione_unito);

    // Separa → o3 torna al suo lotto_b originale.
    state.produzione_lotto_separa(&lotto_a).unwrap();
    assert_eq!(get(&o3).lotto_produzione, lotto_b);
    assert!(!get(&o3).lotto_produzione_unito);
    assert_eq!(get(&o1).lotto_produzione, lotto_a, "o1 resta in lotto_a");

    // Annulla l'intero lotto_a (resta solo o1, In produzione) → o1 torna "Confermato".
    state.produzione_lotto_annulla(&lotto_a).unwrap();
    assert_eq!(get(&o1).stato, "Confermato");
    assert_eq!(get(&o1).lotto_produzione, "");
}

#[test]
fn produzione_per_riga_stato_ordine_derivato() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let cli = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    let o = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("cliente_id", json!(cli.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    let mk = || {
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(1000)),
                ]),
            )
            .unwrap()
            .id
    };
    let r1 = mk();
    let r2 = mk();
    let stato = |id: &str| {
        str_field(
            &state.record_get("ordine", id).unwrap().unwrap().data,
            "stato",
        )
    };
    let sp = |id: &str| {
        str_field(
            &state.record_get("riga_ordine", id).unwrap().unwrap().data,
            "stato_produzione",
        )
    };

    // Invio SOLO r1 → ordine «In produzione» (parziale), r2 resta da produrre.
    let lotto = state
        .produzione_invia_righe(std::slice::from_ref(&r1), "2026-06-10", "")
        .unwrap();
    assert_eq!(sp(&r1), "in_produzione");
    assert_eq!(sp(&r2), "");
    assert_eq!(stato(&o.id), "In produzione");
    assert_eq!(
        str_field(
            &state.record_get("ordine", &o.id).unwrap().unwrap().data,
            "data_produzione"
        ),
        "2026-06-10"
    );

    // r1 arrivata ma r2 non ancora in lavorazione → resta «In produzione».
    state
        .produzione_righe_stato(std::slice::from_ref(&r1), "arrivato_it", "2026-06-20")
        .unwrap();
    assert_eq!(stato(&o.id), "In produzione");

    // Invio r2 nello stesso lotto, poi arrivata anch'essa → TUTTE arrivate → «Arrivato IT».
    state
        .produzione_invia_righe(std::slice::from_ref(&r2), "2026-06-10", "")
        .unwrap();
    assert_eq!(stato(&o.id), "In produzione");
    state
        .produzione_righe_stato(std::slice::from_ref(&r2), "arrivato_it", "2026-06-21")
        .unwrap();
    assert_eq!(stato(&o.id), "Arrivato IT");

    // Annulla l'intero lotto del primo invio (r1) → r1 torna da produrre; r2 ancora
    // arrivata → ordine «In produzione».
    state.produzione_lotto_righe_annulla(&lotto).unwrap();
    assert_eq!(sp(&r1), "");
    assert_eq!(stato(&o.id), "In produzione");

    // Annulla anche r2 → nessuna riga in lavorazione → ripristina «Confermato».
    state.produzione_riga_annulla(&r2).unwrap();
    assert_eq!(sp(&r2), "");
    assert_eq!(stato(&o.id), "Confermato");
}

#[test]
fn produzione_compila_righe_non_lascia_aggiornamenti_parziali() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let ordine = state
        .record_create("ordine", campi(&[("stato", json!("Confermato"))]))
        .unwrap();
    let crea_riga = || {
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(ordine.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(1000)),
                ]),
            )
            .unwrap()
    };
    let prima = crea_riga();
    let seconda = crea_riga();
    state
        .record_update(
            "riga_ordine",
            &seconda.id,
            campi(&[("stato_riga", json!("spedita"))]),
        )
        .unwrap();

    let errore = state
        .produzione_compila_righe(vec![
            ProduzioneRigaPatchInput {
                id: prima.id.clone(),
                fields: campi(&[("formulazione", json!("prima"))]),
            },
            ProduzioneRigaPatchInput {
                id: seconda.id.clone(),
                fields: campi(&[("formulazione", json!("seconda"))]),
            },
        ])
        .unwrap_err();

    assert!(errore.contains("già stata lavorata"), "{errore}");
    for id in [&prima.id, &seconda.id] {
        let riga = state.record_get("riga_ordine", id).unwrap().unwrap();
        assert!(str_field(&riga.data, "formulazione").is_empty());
    }
}

#[test]
fn fornitore_export_assegna_numeri_e_somma_acconti() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let cli = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();

    // o1 Immunoterapia con DUE righe (pazienti) + acconto SALDATO 9000 → col C = saldato.
    let o1 = state
        .record_create(
            "ordine",
            campi(&[
                ("categoria", json!("Immunoterapia")),
                ("cliente_id", json!(cli.id)),
                ("data", json!("2026-06-01")),
                ("acconto", json!(11500)),
            ]),
        )
        .unwrap();
    let r1 = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o1.id)),
                ("paziente", json!("Mario")),
                ("qta", json!(1)),
                ("prezzo", json!(40000)),
                ("formulazione", json!("polimerizzato")),
                ("posologia", json!("3+3")),
                ("allergeni", json!(["parietaria", "olea europea"])),
            ]),
        )
        .unwrap();
    state
        .record_update(
            "riga_ordine",
            &r1.id,
            campi(&[("data_prevista", json!("10 luglio"))]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o1.id)),
                ("paziente", json!("Lucia")),
                ("qta", json!(1)),
                ("prezzo", json!(0)),
                ("formulazione", json!("spray")),
                ("posologia", json!("2+2")),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "pagamento",
            campi(&[
                ("ordine_id", json!(o1.id)),
                ("tipo", json!("acconto")),
                ("importo", json!(9000)),
                ("saldato", json!(true)),
                ("data", json!("2026-06-05")),
            ]),
        )
        .unwrap();

    // o2 Immunoterapia con acconto solo PREVISTO (non incassato) → col C = previsto 9000.
    let o2 = state
        .record_create(
            "ordine",
            campi(&[
                ("categoria", json!("Immunoterapia")),
                ("cliente_id", json!(cli.id)),
                ("data", json!("2026-06-02")),
                ("acconto", json!(9000)),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o2.id)),
                ("paziente", json!("Anna")),
                ("qta", json!(1)),
                ("prezzo", json!(27000)),
            ]),
        )
        .unwrap();

    let lotto = state
        .produzione_invia(&[o1.id.clone(), o2.id.clone()], "2026-06-10")
        .unwrap();

    let path = data.path().join("fornitore.xlsx");
    let n = state
        .fornitore_export(&lotto, path.to_str().unwrap(), 700, "3 giugno")
        .unwrap();
    assert_eq!(n, 3, "tre righe paziente (2 da o1 + 1 da o2)");
    assert!(path.exists(), "il file .xlsx è stato creato");

    let mut xl = calamine::open_workbook_auto(&path).unwrap();
    let range = xl.worksheet_range("Produzione").unwrap();
    let data_j = |row: u32| {
        range
            .get_value((row, 9))
            .map(|v| v.to_string())
            .unwrap_or_default()
    };
    assert_eq!(
        data_j(1),
        "10 luglio",
        "la data sulla riga vince sul fallback ordine"
    );
    assert_eq!(
        data_j(2),
        "3 giugno",
        "le righe senza data usano il fallback ordine/export"
    );

    // Fallback legacy persistito sugli ordini del lotto quando l'export riceve un valore.
    let get_ord = |id: &str| {
        state
            .records_list("ordine")
            .unwrap()
            .into_iter()
            .find(|r| r.id == id)
            .unwrap()
    };
    assert_eq!(
        str_field(&get_ord(&o1.id).data, "data_prevista_lotto"),
        "3 giugno"
    );
    assert_eq!(
        str_field(&get_ord(&o2.id).data, "data_prevista_lotto"),
        "3 giugno"
    );

    // Numeri di produzione assegnati e PERSISTITI, sequenziali da 700.
    let numeri: Vec<i64> = state
        .records_list("riga_ordine")
        .unwrap()
        .iter()
        .map(|r| i64_field(&r.data, "numero_produzione"))
        .filter(|n| *n > 0)
        .collect();
    let mut ordinati = numeri.clone();
    ordinati.sort_unstable();
    assert_eq!(ordinati, vec![700, 701, 702], "contatore parte da base=700");

    // Idempotenza: ri-esportare non cambia i numeri già assegnati.
    let n2 = state
        .fornitore_export(&lotto, path.to_str().unwrap(), 999, "3 giugno")
        .unwrap();
    assert_eq!(n2, 3);
    let numeri2: Vec<i64> = state
        .records_list("riga_ordine")
        .unwrap()
        .iter()
        .map(|r| i64_field(&r.data, "numero_produzione"))
        .filter(|n| *n > 0)
        .collect();
    let mut ordinati2 = numeri2.clone();
    ordinati2.sort_unstable();
    assert_eq!(
        ordinati2,
        vec![700, 701, 702],
        "i numeri non cambiano al secondo export"
    );
}

#[test]
fn diagnostica_export_blocchi_per_ordine() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let cli = state
        .record_create("cliente", campi(&[("nome", json!("Ospedale Reggio"))]))
        .unwrap();
    let o = state
        .record_create(
            "ordine",
            campi(&[
                ("categoria", json!("Diagnostica")),
                ("cliente_id", json!(cli.id)),
                ("data", json!("2026-04-27")),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("prodotto_nome", json!("CIPRESSO")),
                ("tipo_test", json!("PRICK TEST")),
                ("ml", json!("2.5")),
                ("qta", json!(1)),
                ("prezzo", json!(1471)),
            ]),
        )
        .unwrap();
    let lotto = state
        .produzione_invia(std::slice::from_ref(&o.id), "2026-04-28")
        .unwrap();

    let path = data.path().join("diag.xlsx");
    let n = state
        .diagnostica_export(&lotto, path.to_str().unwrap())
        .unwrap();
    assert_eq!(n, 1, "un ordine diagnostica nel lotto");
    assert!(path.exists());
}

#[test]
fn catalogo_produzione_seminato_e_idempotente() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let cat = state.records_list("prodotto_produzione").unwrap();
    let di = |t: &str| {
        cat.iter()
            .filter(|r| r.data.get("tipo") == Some(&json!(t)))
            .count()
    };
    assert_eq!(di("formulazione"), 7);
    assert_eq!(di("posologia"), 8);
    assert_eq!(di("allergene"), 25);
    assert_eq!(di("ceppo"), 10);
    assert_eq!(di("ml"), 5);
    // Voce nota con id fisso (conflict-free fra dispositivi).
    assert!(cat.iter().any(|r| r.id == "__pp_allergene_parietaria__"
        && r.data.get("valore") == Some(&json!("parietaria"))));

    // Idempotente: ri-seminare non duplica.
    state.seed_prodotti_produzione();
    assert_eq!(
        state.records_list("prodotto_produzione").unwrap().len(),
        cat.len()
    );
}

#[test]
fn anagrafiche_default_seminate_e_idempotenti() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    // Agente interno Agente Demo 001 a provvigione 0%.
    let agenti = state.records_list("agente").unwrap();
    assert!(agenti.is_empty(), "la demo pubblica non semina agenti");
    assert!(state.records_list("medico").unwrap().is_empty());
    assert!(state.records_list("conto").unwrap().iter().all(|record| {
        matches!(record.data.get("tipo").and_then(|value| value.as_str()), Some("contrassegno" | "assegno"))
    }));
    let prodotti_demo = state.records_list("prodotto").unwrap();
    assert!(prodotti_demo.iter().all(|record| {
        record.data.get("prezzo_base_default") == Some(&json!(0))
            && record.data.get("codice_fornitore").and_then(|value| value.as_str()).unwrap_or("").is_empty()
    }));
    return;
    let livio = agenti
        .iter()
        .find(|r| r.data.get("nome") == Some(&json!("Agente Demo 001")))
        .expect("agente Agente Demo 001 mancante");
    assert_eq!(livio.data.get("provv_valore"), Some(&json!(0)));
    assert_eq!(livio.id, seed_id("agente", "Agente Demo 001"));

    // Medico con prezzo immunoterapia tipico (centesimi) e agente collegato.
    let medici = state.records_list("medico").unwrap();
    let santiago = medici
        .iter()
        .find(|r| r.data.get("nome") == Some(&json!("Medico Demo 001")))
        .expect("medico Medico Demo 001 mancante");
    assert_eq!(santiago.data.get("prezzo_immuno_default"), Some(&json!(0)));
    assert_eq!(
        santiago.data.get("agente_id"),
        Some(&json!(seed_id("agente", "Agente Demo 001")))
    );
    assert_eq!(santiago.data.get("rate_saldo_default"), Some(&json!(2)));

    // Keriba: tre prodotti a 60€ (6000 cent), categoria Keriba.
    let prodotti = state.records_list("prodotto").unwrap();
    let keriba: Vec<_> = prodotti
        .iter()
        .filter(|r| r.data.get("categoria") == Some(&json!("Keriba")))
        .collect();
    assert_eq!(keriba.len(), 3);
    assert!(keriba
        .iter()
        .all(|r| r.data.get("prezzo_base_default") == Some(&json!(6000))));
    // Immunoterapia: prodotti = tipo preparazione × fiale (non più allergeni), prezzi reali.
    let immuno: Vec<_> = prodotti
        .iter()
        .filter(|r| r.data.get("categoria") == Some(&json!("Immunoterapia")))
        .collect();
    assert_eq!(immuno.len(), 7);
    let poli2 = immuno
        .iter()
        .find(|r| r.data.get("nome") == Some(&json!("Polimerizzato 2 fiale")))
        .expect("prodotto «Polimerizzato 2 fiale» mancante");
    assert_eq!(poli2.data.get("prezzo_base_default"), Some(&json!(40000)));
    // Il catalogo diagnostico pubblico non contiene codici fornitore.
    let acaro = prodotti
        .iter()
        .find(|r| r.data.get("nome") == Some(&json!("Acarus siro")))
        .expect("catalogo Diagnostica mancante");
    assert_eq!(acaro.data.get("categoria"), Some(&json!("Diagnostica")));
    assert_eq!(acaro.data.get("nome"), Some(&json!("Acarus siro")));
    assert!(
        prodotti
            .iter()
            .filter(|r| r.data.get("categoria") == Some(&json!("Diagnostica")))
            .count()
            >= 40
    );

    // Il prezzo immuno del medico non è suggerito perché il fallback è rimosso.
    // Medico Demo 001 ha una regola specifica su "Sublinguale 2 fiale".
    let prod_sub2 = prodotti
        .iter()
        .find(|r| r.data.get("nome") == Some(&json!("Sublinguale 2 fiale")))
        .unwrap();
    let r = state
        .prezzo_suggerito(&prod_sub2.id, Some(santiago.id.clone()))
        .unwrap();
    assert_eq!(r.prezzo, 25000);
    assert_eq!(r.fonte.as_str(), "medico_prodotto");

    // Query for a product without rule -> falls back to default product price.
    let prod_pol2 = prodotti
        .iter()
        .find(|r| r.data.get("nome") == Some(&json!("Polimerizzato 2 fiale")))
        .unwrap();
    let r2 = state
        .prezzo_suggerito(&prod_pol2.id, Some(santiago.id.clone()))
        .unwrap();
    assert_eq!(r2.prezzo, 40000);
    assert_eq!(r2.fonte.as_str(), "default");

    // Idempotente: ri-seminare non duplica e non modifica record già inizializzati.
    let n_ag = agenti.len();
    let n_med = medici.len();
    let n_prod = prodotti.len();
    state
        .record_update(
            "medico",
            &santiago.id,
            campi(&[("rate_saldo_default", json!(3))]),
        )
        .unwrap();
    state.seed_anagrafiche_default();
    assert_eq!(state.records_list("agente").unwrap().len(), n_ag);
    assert_eq!(state.records_list("medico").unwrap().len(), n_med);
    assert_eq!(state.records_list("prodotto").unwrap().len(), n_prod);
    assert_eq!(
        state
            .record_get("medico", &santiago.id)
            .unwrap()
            .unwrap()
            .data
            .get("rate_saldo_default"),
        Some(&json!(3))
    );
}

#[test]
fn seed_rimuove_vecchi_prodotti_immuno_preservando_ordini() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");
    // Simula un DB già esistente con un vecchio prodotto immuno builtin (nome di allergene)
    // e una riga d'ordine che lo referenzia.
    let vecchio_id = seed_id("prod", "Parietaria");
    let sublinguale_1_id = seed_id("prod", "Sublinguale 1 fiala");
    state
        .with_engine(|engine| {
            engine
                .emit("prodotto", &vecchio_id, EventBody::Created)
                .map_err(es)?;
            set_fields(
                engine,
                "prodotto",
                &vecchio_id,
                &[
                    ("nome", json!("Parietaria")),
                    ("categoria", json!("Immunoterapia")),
                    ("builtin", json!(true)),
                ],
            )
        })
        .unwrap();
    state
        .with_engine(|engine| {
            engine
                .emit("prodotto", &sublinguale_1_id, EventBody::Created)
                .map_err(es)?;
            set_fields(
                engine,
                "prodotto",
                &sublinguale_1_id,
                &[
                    ("nome", json!("Sublinguale 1 fiala")),
                    ("categoria", json!("Immunoterapia")),
                    ("builtin", json!(true)),
                ],
            )
        })
        .unwrap();
    let o = state
        .record_create(
            "ordine",
            campi(&[
                ("categoria", json!("Immunoterapia")),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    let riga = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o.id.clone())),
                ("prodotto_id", json!(vecchio_id)),
                ("qta", json!(1)),
                ("prezzo", json!(27000)),
            ]),
        )
        .unwrap();
    let riga_sublinguale = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("prodotto_id", json!(sublinguale_1_id.clone())),
                ("qta", json!(1)),
                ("prezzo", json!(27000)),
            ]),
        )
        .unwrap();
    let regola_sublinguale = state
        .record_create(
            "regola_prezzo",
            campi(&[
                ("prodotto_id", json!(sublinguale_1_id.clone())),
                ("tipo", json!("fisso")),
                ("valore", json!(27000)),
            ]),
        )
        .unwrap();

    state.seed_anagrafiche_default();

    // Il vecchio prodotto è stato eliminato...
    let prodotti = state.records_list("prodotto").unwrap();
    assert!(
        !prodotti.iter().any(|r| r.id == vecchio_id),
        "vecchio prodotto immuno rimosso"
    );
    assert!(
        prodotti
            .iter()
            .filter(|r| r.data.get("categoria") == Some(&json!("Immunoterapia")))
            .count()
            == 7
    );
    // ...ma l'ordine che lo usava conserva il nome (ora come testo libero).
    let r = state
        .records_list("riga_ordine")
        .unwrap()
        .into_iter()
        .find(|x| x.id == riga.id)
        .unwrap();
    assert_eq!(str_field(&r.data, "prodotto_id"), "");
    assert_eq!(str_field(&r.data, "prodotto_nome"), "Parietaria");

    // Il formato rimosso da una fiala confluisce nel prodotto valido già esistente.
    let destinazione_id = seed_id("prod", "Sublinguale 2 fiale");
    let riga_sublinguale = state
        .record_get("riga_ordine", &riga_sublinguale.id)
        .unwrap()
        .unwrap();
    assert_eq!(
        str_field(&riga_sublinguale.data, "prodotto_id"),
        destinazione_id
    );
    assert_eq!(
        str_field(&riga_sublinguale.data, "prodotto_nome"),
        "Sublinguale 2 fiale"
    );
    let regola_sublinguale = state
        .record_get("regola_prezzo", &regola_sublinguale.id)
        .unwrap()
        .unwrap();
    assert_eq!(
        str_field(&regola_sublinguale.data, "prodotto_id"),
        destinazione_id
    );
    assert!(state
        .record_get("prodotto", &sublinguale_1_id)
        .unwrap()
        .is_none());
}

#[test]
fn provvigioni_valore_per_categoria() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    // Disabilita lo scorporo iva e detrazione spedizione per il test
    state
        .with_engine(|engine| {
            set_fields(
                engine,
                "parametri_globali",
                "agenti",
                &[
                    ("scorpora_iva", json!(false)),
                    ("detrai_spedizione", json!(false)),
                ],
            )
        })
        .unwrap();

    // Agente con predefinito 10% e override 20% per la Diagnostica.
    let agente = state
        .record_create(
            "agente",
            campi(&[
                ("nome", json!("Rossi")),
                ("provv_tipo", json!("percentuale")),
                ("provv_valore", json!(10)),
                ("provv_cat_diagnostica", json!(20)),
                ("provv_maturazione", json!("spedizione")),
            ]),
        )
        .unwrap();
    let p_imm = state
        .record_create(
            "prodotto",
            campi(&[
                ("nome", json!("Vac")),
                ("categoria", json!("Immunoterapia")),
            ]),
        )
        .unwrap();
    let p_diag = state
        .record_create(
            "prodotto",
            campi(&[
                ("nome", json!("Prick")),
                ("categoria", json!("Diagnostica")),
            ]),
        )
        .unwrap();
    let cli = state
        .record_create("cliente", campi(&[("nome", json!("Cli"))]))
        .unwrap();

    let crea_ordine = |categoria: &str, prod: &str, data: &str| {
        let o = state
            .record_create(
                "ordine",
                campi(&[
                    ("categoria", json!(categoria)),
                    ("agente_id", json!(agente.id)),
                    ("cliente_id", json!(cli.id)),
                    ("stato", json!("Spedito")),
                    ("data", json!(data)),
                ]),
            )
            .unwrap();
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod)),
                    ("qta", json!(1)),
                    ("prezzo", json!(10000)),
                ]),
            )
            .unwrap();
    };
    crea_ordine("Immunoterapia", &p_imm.id, "2026-06-01");
    crea_ordine("Diagnostica", &p_diag.id, "2026-06-02");

    let rep = state
        .provvigioni_report(None, None, Some(agente.id.clone()))
        .unwrap();
    let ag = rep
        .agenti
        .iter()
        .find(|a| a.agente_id == agente.id)
        .unwrap();
    let provv = |d: &str| ag.ordini.iter().find(|o| o.data == d).unwrap().provvigione;
    // 10% di 100€ = 10€ (Immunoterapia, predefinito); 20% = 20€ (Diagnostica, override).
    assert_eq!(provv("2026-06-01"), 1000);
    assert_eq!(provv("2026-06-02"), 2000);
}

#[test]
fn lotto_unisci_fonde_piu_lotti_in_uno() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("V")), ("prezzo_base_default", json!(10000))]),
        )
        .unwrap();
    let cli = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    let gls = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    let carrai = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_A")), ("profilo", json!("carrai"))]))
        .unwrap();

    // Due ordini, ognuno con una riga: li spediamo in giorni/corrieri diversi (lotti diversi).
    let mk = |numero: &str| {
        let o = state
            .record_create(
                "ordine",
                campi(&[
                    ("stato", json!("Confermato")),
                    ("cliente_id", json!(cli.id)),
                    ("data", json!("2026-06-01")),
                    ("numero", json!(numero)),
                ]),
            )
            .unwrap();
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(10000)),
                    ("paziente", json!("Mario Rossi")),
                ]),
            )
            .unwrap()
            .id
    };
    let r1 = mk("0001");
    let r2 = mk("0002");
    state
        .spedizione_crea(
            "lotto1",
            "2026-06-05",
            &gls.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&r1, "A")],
        )
        .unwrap();
    state
        .spedizione_crea(
            "lotto2",
            "2026-06-06",
            &carrai.id,
            8,
            12,
            "",
            false,
            "",
            0,
            "",
            &[rn(&r2, "B")],
        )
        .unwrap();

    // Prima: due lotti distinti.
    let lista = state.spedizioni_lista().unwrap();
    assert_eq!(lista.len(), 2);
    let collo_carrai = lista
        .iter()
        .find(|spedizione| spedizione.corriere_id == carrai.id)
        .unwrap();
    assert_eq!(
        (collo_carrai.colli, collo_carrai.peso),
        (1, 1),
        "il profilo CORRIERE_A forza colli e peso a 1 anche se il chiamante passa altri valori"
    );
    assert_eq!(collo_carrai.righe[0].paziente, "Mario Rossi");
    let mut lotti: Vec<String> = lista.iter().map(|s| s.lotto.clone()).collect();
    lotti.sort();
    lotti.dedup();
    assert_eq!(lotti.len(), 2);

    // Unisci → un solo lotto (il primo passato), entrambe le spedizioni vi appartengono.
    let target = state
        .lotto_unisci(vec!["lotto1".into(), "lotto2".into()])
        .unwrap();
    assert_eq!(target, "lotto1");
    let lista = state.spedizioni_lista().unwrap();
    assert_eq!(lista.len(), 2);
    assert!(lista.iter().all(|s| s.lotto == "lotto1"));
    // Sono marcate "unite" (separabili).
    assert!(lista.iter().all(|s| s.unito));

    // Meno di due lotti → errore (niente da unire).
    assert!(state.lotto_unisci(vec!["lotto1".into()]).is_err());

    // Separa → ognuna torna al lotto originale e non è più "unita".
    state.lotto_separa("lotto1").unwrap();
    let lista = state.spedizioni_lista().unwrap();
    let mut lotti: Vec<String> = lista.iter().map(|s| s.lotto.clone()).collect();
    lotti.sort();
    assert_eq!(lotti, vec!["lotto1".to_string(), "lotto2".to_string()]);
    assert!(lista.iter().all(|s| !s.unito));
}

#[test]
fn separare_spedizioni_non_rimette_nei_spediti_i_colli_rimossi() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    let corriere = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    let ordine = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("cliente_id", json!(cliente.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    let crea_riga = |lotto: &str| {
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(ordine.id)),
                    ("prodotto_nome", json!("Vaccino")),
                    ("qta", json!(1)),
                    ("prezzo", json!(10000)),
                    ("numero", json!(lotto)),
                ]),
            )
            .unwrap()
    };
    let riga_a = crea_riga("LOT-A");
    let riga_b = crea_riga("LOT-B");
    state
        .spedizione_crea(
            "gruppo-a",
            "2026-06-10",
            &corriere.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&riga_a.id, "LOT-A")],
        )
        .unwrap();
    state
        .spedizione_crea(
            "gruppo-b",
            "2026-06-11",
            &corriere.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&riga_b.id, "LOT-B")],
        )
        .unwrap();

    state
        .lotto_unisci(vec!["gruppo-a".into(), "gruppo-b".into()])
        .unwrap();
    state.spedizione_riga_rimuovi(&riga_b.id).unwrap();
    state.lotto_separa("gruppo-a").unwrap();

    let da_spedire = state.righe_da_spedire().unwrap();
    assert_eq!(da_spedire.len(), 1);
    assert_eq!(da_spedire[0].righe.len(), 1);
    assert_eq!(da_spedire[0].righe[0].riga_id, riga_b.id);
    assert!(state
        .spedizioni_lista()
        .unwrap()
        .iter()
        .all(|spedizione| spedizione
            .righe
            .iter()
            .all(|riga| riga.riga_id != riga_b.id)));
}

#[test]
fn spedizione_riepilogo_per_conto_e_agente_esclude_acconti() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let ag = state
        .record_create("agente", campi(&[("nome", json!("Vitale"))]))
        .unwrap();
    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("V")), ("prezzo_base_default", json!(100000))]),
        )
        .unwrap();
    let conto_demo = state
        .record_create(
            "conto",
            campi(&[("nome", json!("BANCA DEMO")), ("tipo", json!("banca"))]),
        )
        .unwrap();
    let contra = state
        .record_create(
            "conto",
            campi(&[
                ("nome", json!("Contrassegno")),
                ("tipo", json!("contrassegno")),
            ]),
        )
        .unwrap();
    let gls = state
        .record_create("corriere", campi(&[("nome", json!("CORRIERE_B"))]))
        .unwrap();
    let o = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("agente_id", json!(ag.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();
    let riga = state
        .record_create(
            "riga_ordine",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(1)),
                ("prezzo", json!(100000)),
            ]),
        )
        .unwrap();
    // Acconto 200€ saldato su BANCA DEMO (ESCLUSO dal riepilogo) + saldo 800€ atteso su contrassegno.
    state
        .record_create(
            "pagamento",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("tipo", json!("acconto")),
                ("importo", json!(20000)),
                ("saldato", json!(true)),
                ("conto_id", json!(conto_demo.id)),
            ]),
        )
        .unwrap();
    state
        .record_create(
            "pagamento",
            campi(&[
                ("ordine_id", json!(o.id)),
                ("tipo", json!("saldo")),
                ("importo", json!(80000)),
                ("saldato", json!(false)),
                ("conto_id", json!(contra.id)),
            ]),
        )
        .unwrap();

    let sp = state
        .spedizione_crea(
            "lottoR",
            "2026-06-05",
            &gls.id,
            1,
            1,
            "",
            false,
            "",
            0,
            "",
            &[rn(&riga.id, "9001")],
        )
        .unwrap();
    assert_eq!(sp.lotto, "lottoR");

    let rp = state.spedizione_riepilogo("lottoR").unwrap();
    // L'acconto è escluso: resta solo il saldo atteso da incassare in contrassegno.
    assert_eq!(rp.gia_incassato, 0, "l'acconto su BANCA DEMO è escluso");
    assert_eq!(rp.da_incassare, 80000);
    assert_eq!(rp.totale, 80000);
    assert_eq!(
        rp.per_conto.len(),
        1,
        "solo il conto contrassegno (l'acconto escluso)"
    );
    assert_eq!(rp.per_conto[0].conto_nome, "Contrassegno");
    assert_eq!(rp.per_conto[0].da_incassare, 80000);
    assert_eq!(rp.per_agente.len(), 1);
    assert_eq!(rp.per_agente[0].agente_nome, "Vitale");
    assert_eq!(rp.per_agente[0].totale, 80000);
    assert_eq!(rp.per_agente[0].conti[0].conto_nome, "Contrassegno");
}

#[test]
fn riga_mancante_aggiunge_riga_da_spedire() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("Extra")), ("prezzo_base_default", json!(0))]),
        )
        .unwrap();
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    let o = state
        .record_create(
            "ordine",
            campi(&[
                ("stato", json!("Confermato")),
                ("cliente_id", json!(cliente.id)),
                ("data", json!("2026-06-01")),
            ]),
        )
        .unwrap();

    // Riga che INCIDE sul totale (2 × 50€ = 100€).
    state
        .riga_mancante_aggiungi(&o.id, &prod.id, 2, 5000, "Mario")
        .unwrap();
    let da = state.righe_da_spedire().unwrap();
    assert_eq!(da.len(), 1);
    assert_eq!(da[0].righe.len(), 1);
    assert_eq!(da[0].righe[0].qta, 2);
    assert_eq!(da[0].righe[0].paziente, "Mario");
    let tot = state
        .ordini_lista()
        .unwrap()
        .into_iter()
        .find(|x| x.id == o.id)
        .unwrap()
        .totale;
    assert_eq!(tot, 10000, "la riga con prezzo incide sul totale");

    // Riga INCLUSA (prezzo 0): non cambia il totale ma è da spedire.
    state
        .riga_mancante_aggiungi(&o.id, &prod.id, 1, 0, "")
        .unwrap();
    let da = state.righe_da_spedire().unwrap();
    assert_eq!(da[0].righe.len(), 2);
    let tot = state
        .ordini_lista()
        .unwrap()
        .into_iter()
        .find(|x| x.id == o.id)
        .unwrap()
        .totale;
    assert_eq!(
        tot, 10000,
        "la riga inclusa (prezzo 0) non cambia il totale"
    );
}

#[test]
fn da_spedire_ordina_in_produzione_poi_confermato_poi_nuovo() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("P")), ("prezzo_base_default", json!(0))]),
        )
        .unwrap();
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    let mk = |stato: &str, data: &str| {
        let o = state
            .record_create(
                "ordine",
                campi(&[
                    ("stato", json!(stato)),
                    ("cliente_id", json!(cliente.id)),
                    ("data", json!(data)),
                ]),
            )
            .unwrap();
        state
            .riga_mancante_aggiungi(&o.id, &prod.id, 1, 0, "")
            .unwrap();
        o.id
    };
    let nuovo = mk("Nuovo", "2026-06-01");
    let confermato = mk("Confermato", "2026-06-02");
    let in_prod = mk("Confermato", "2026-05-01");
    state
        .produzione_invia(std::slice::from_ref(&in_prod), "2026-06-10")
        .unwrap();

    // Default: «In produzione» prima, poi «Confermato», infine «Nuovo».
    let ids: Vec<String> = state
        .righe_da_spedire()
        .unwrap()
        .into_iter()
        .map(|d| d.ordine_id)
        .collect();
    assert_eq!(ids, vec![in_prod, confermato, nuovo]);
}

#[test]
#[ignore = "il dataset operativo automatico non fa parte della variante pubblica"]
fn demo_popola_crea_pagamenti_e_azzera_pulisce() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");
    let stale = state
        .record_create(
            "spedizione",
            campi(&[
                ("lotto", json!("lotto-sped-vecchio")),
                ("data", json!("2026-01-01")),
                ("numero", json!("")),
                ("manuale", json!(false)),
            ]),
        )
        .unwrap();

    let n = state.popola_demo().unwrap();
    assert!(n > 0, "deve creare ordini demo");
    assert!(
        state
            .records_list("spedizione")
            .unwrap()
            .iter()
            .all(|s| s.id != stale.id),
        "popola_demo deve ripulire i vecchi colli demo orfani"
    );
    let sped = state.spedizioni_lista().unwrap();
    assert!(!sped.is_empty(), "popola_demo deve creare spedizioni demo");
    assert!(
        sped.iter().all(|s| s.n_righe > 0),
        "le spedizioni demo non devono generare colli vuoti"
    );
    assert!(
        sped.iter().any(|s| s.n_righe > 1),
        "serve almeno una spedizione demo multi-riga per coprire i colli"
    );
    for s in sped.iter().filter(|s| s.n_righe > 0) {
        let attesi = if s.corriere_profilo == "carrai" {
            1
        } else {
            s.n_righe as i64
        };
        assert_eq!(
            s.colli, attesi,
            "solo CORRIERE_A resta a un collo; gli altri profili seguono i prodotti demo"
        );
    }
    // Ogni ordine demo ha uno scadenzario: ci sono pagamenti, sia saldati sia attesi.
    let pag = state.records_list("pagamento").unwrap();
    assert!(!pag.is_empty(), "popola_demo deve creare i pagamenti");
    assert!(
        pag.iter().any(|p| bool_field(&p.data, "saldato")),
        "alcuni saldati"
    );
    assert!(
        pag.iter().any(|p| !bool_field(&p.data, "saldato")),
        "alcuni attesi"
    );
    // Almeno uno scaduto rispetto a oggi-demo (scadenza < 2026-06-16).
    assert!(
        pag.iter().any(|p| !bool_field(&p.data, "saldato")
            && str_field(&p.data, "scadenza").as_str() < "2026-06-16"),
        "alcuni scaduti"
    );

    // azzera_demo rimuove ordini, righe, clienti, conti demo e i pagamenti collegati.
    state.azzera_demo().unwrap();
    assert!(
        state.records_list("ordine").unwrap().is_empty(),
        "ordini puliti"
    );
    assert!(
        state.records_list("pagamento").unwrap().is_empty(),
        "pagamenti puliti"
    );
    assert!(
        state.records_list("spedizione").unwrap().is_empty(),
        "spedizioni demo pulite"
    );
    assert!(
        state
            .records_list("conto")
            .unwrap()
            .iter()
            .all(|c| c.data.get("demo") != Some(&json!(true))),
        "conti demo puliti"
    );
}

#[test]
fn dashboard_stats_kpi_serie_e_distribuzioni() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("P")), ("prezzo_base_default", json!(0))]),
        )
        .unwrap();
    let banca = state
        .record_create("conto", campi(&[("nome", json!("Banca Demo"))]))
        .unwrap();
    let lazio = state
        .record_create(
            "cliente",
            campi(&[("nome", json!("Rossi")), ("regione", json!("Lazio"))]),
        )
        .unwrap();
    // Cliente senza regione → confluisce in «Altre zone».
    let senza = state
        .record_create("cliente", campi(&[("nome", json!("Senza"))]))
        .unwrap();

    // Crea ordine + 1 riga (con stato_produzione opzionale, FASE 7) + un saldo ATTESO
    // (lo scadenzario alimenta i Crediti e la KPI «Da saldare», che li specchia).
    let mk =
        |stato: &str, data: &str, cliente: &str, totale: i64, atteso: i64, prod_stato: &str| {
            let o = state
                .record_create(
                    "ordine",
                    campi(&[
                        ("stato", json!(stato)),
                        ("cliente_id", json!(cliente)),
                        ("data", json!(data)),
                    ]),
                )
                .unwrap();
            let mut riga = vec![
                ("ordine_id", json!(o.id)),
                ("prodotto_id", json!(prod.id)),
                ("qta", json!(1)),
                ("prezzo", json!(totale)),
            ];
            if !prod_stato.is_empty() {
                riga.push(("stato_produzione", json!(prod_stato)));
            }
            state.record_create("riga_ordine", campi(&riga)).unwrap();
            if atteso > 0 {
                state
                    .pagamento_registra(&o.id, "saldo", atteso, false, data, "", "", false, None)
                    .unwrap();
            }
            o.id
        };

    // Spedito 10000: acconto 4000 incassato + saldo atteso 6000 (= da saldare spedito).
    let spedito = mk("Spedito", "2026-03-10", &lazio.id, 10000, 6000, "");
    mk("Confermato", "2026-04-15", &lazio.id, 5000, 5000, ""); // da saldare (non spedito)
                                                               // In produzione: la riga è effettivamente in lavorazione (stato per-riga).
    mk(
        "In produzione",
        "2026-05-20",
        &senza.id,
        3000,
        3000,
        "in_produzione",
    );
    let rifiutato = mk("Confermato", "2026-06-01", &lazio.id, 9999, 9999, "");
    state
        .record_update(
            "ordine",
            &rifiutato,
            campi(&[("stato", json!("Rifiutato"))]),
        )
        .unwrap(); // atteso escluso (rifiutato)
                   // Ordine fuori periodo (anno precedente): nel da-saldare (corrente) sì, nel periodo no.
    mk("Spedito", "2025-12-01", &lazio.id, 7000, 7000, "");

    // L'acconto incassato sullo Spedito (non riduce il «da saldare», che è già il solo saldo atteso).
    state
        .pagamento_registra(
            &spedito,
            "acconto",
            4000,
            true,
            "",
            &banca.id,
            "2026-03-12",
            false,
            None,
        )
        .unwrap();

    let s = state
        .dashboard_stats(Some("2026-01-01".into()), Some("2026-12-31".into()))
        .unwrap();

    // KPI di periodo: 4 ordini nel 2026 (il rifiutato conta come ordine ma non nelle provvigioni).
    assert_eq!(s.ordini_n, 4);
    assert_eq!(s.ordini_valore, 10000 + 5000 + 3000 + 9999);

    // Da saldare (stato corrente, fuori periodo): somma dei saldi ATTESI, come i Crediti.
    // Spediti = 6000 (Spedito 2026) + 7000 (Spedito 2025) = 13000; non spediti = 5000
    // (Confermato) + 3000 (In produzione) = 8000. Il saldo atteso del Rifiutato è escluso.
    assert_eq!(s.da_saldare_spediti, 13000);
    assert_eq!(s.da_saldare_non_spediti, 8000);
    // In produzione = numero di PRODOTTI (righe) in lavorazione, non di ordini/lotti.
    assert_eq!(s.in_produzione, 1);
    assert_eq!(s.in_arrivo, 0);

    // Andamento mensile (periodo annuale > 92 giorni): bucket marzo/aprile/maggio (+ giugno rifiutato).
    assert!(
        s.andamento.iter().all(|p| p.iso.len() == 7),
        "bucket mensili YYYY-MM"
    );
    let marzo = s.andamento.iter().find(|p| p.iso == "2026-03").unwrap();
    assert_eq!(
        (marzo.ordini, marzo.valore, marzo.incassato),
        (1, 10000, 4000)
    );

    // Distribuzioni.
    assert!(s
        .per_stato
        .iter()
        .any(|f| f.chiave == "Spedito" && f.n == 1));
    assert!(s.per_regione.iter().any(|f| f.chiave == "Lazio"));
    assert!(s.per_regione.iter().any(|f| f.chiave == "Altre zone"));
}

#[test]
fn dashboard_da_saldare_esclude_preventivi_e_provv_pagate_maturano() {
    let app = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let state = AppState::init(app.path().to_path_buf()).unwrap();
    onboarda(&state, data.path().to_str().unwrap(), "Utente Demo");

    // Disabilita lo scorporo iva e detrazione spedizione per il test
    state
        .with_engine(|engine| {
            set_fields(
                engine,
                "parametri_globali",
                "agenti",
                &[
                    ("scorpora_iva", json!(false)),
                    ("detrai_spedizione", json!(false)),
                ],
            )
        })
        .unwrap();

    let prod = state
        .record_create(
            "prodotto",
            campi(&[("nome", json!("P")), ("prezzo_base_default", json!(0))]),
        )
        .unwrap();
    let cliente = state
        .record_create("cliente", campi(&[("nome", json!("Rossi"))]))
        .unwrap();
    let banca = state
        .record_create("conto", campi(&[("nome", json!("Banca"))]))
        .unwrap();
    // Agente al 10%, provvigione che matura alla spedizione.
    let ag = state
        .record_create(
            "agente",
            campi(&[
                ("nome", json!("Anna")),
                ("provv_tipo", json!("percentuale")),
                ("provv_valore", json!(10.0)),
                ("provv_maturazione", json!("spedizione")),
            ]),
        )
        .unwrap();

    // Ordine + riga + (eventuale) saldo atteso. Agente fisso per le provvigioni.
    let mk = |stato: &str, totale: i64, atteso: i64| {
        let o = state
            .record_create(
                "ordine",
                campi(&[
                    ("stato", json!(stato)),
                    ("cliente_id", json!(cliente.id)),
                    ("agente_id", json!(ag.id)),
                    ("data", json!("2026-03-10")),
                ]),
            )
            .unwrap();
        state
            .record_create(
                "riga_ordine",
                campi(&[
                    ("ordine_id", json!(o.id)),
                    ("prodotto_id", json!(prod.id)),
                    ("qta", json!(1)),
                    ("prezzo", json!(totale)),
                ]),
            )
            .unwrap();
        if atteso > 0 {
            state
                .pagamento_registra(
                    &o.id,
                    "saldo",
                    atteso,
                    false,
                    "2026-04-01",
                    "",
                    "",
                    false,
                    None,
                )
                .unwrap();
        }
        o.id
    };

    mk("Nuovo", 8000, 8000); // preventivo: NON è un credito reale → escluso da «Da saldare»
    mk("Confermato", 10000, 4000); // credito reale (non spedito)
    mk("Spedito", 5000, 1000); // credito reale (spedito) + provvigione maturata per stato
                               // Confermato (non spedito) con provvigione PAGATA in anticipo all'agente.
    let pagato = mk("Confermato", 20000, 0);
    state
        .pagamento_registra(
            &pagato,
            "acconto",
            100,
            true,
            "",
            &banca.id,
            "2026-03-11",
            false,
            None,
        )
        .unwrap();
    state
        .record_create(
            "provv_pagamento",
            campi(&[
                ("agente_id", json!(ag.id)),
                ("agente_nome", json!("Anna")),
                ("data", json!("2026-03-20")),
                ("totale", json!(2000)),
                (
                    "righe",
                    json!([{ "ordineId": pagato, "base": 20000, "provvigione": 2000 }]),
                ),
            ]),
        )
        .unwrap();

    let s = state.dashboard_stats(None, None).unwrap();

    // Da saldare: escluso il preventivo Nuovo. Spediti = 1000; non spediti = 4000
    // (il Confermato pagato non ha saldo atteso, quindi non incide).
    assert_eq!(s.da_saldare_spediti, 1000);
    assert_eq!(s.da_saldare_non_spediti, 4000);

    // Potenziale = 10% di (8000+10000+5000+20000) = 4300 (anche il preventivo entra nel potenziale).
    assert_eq!(s.provv_potenziale, 4300);
    // Maturate = Spedito (500, per stato) + Confermato pagato (2000, perché già pagata) = 2500.
    assert_eq!(s.provv_maturato, 2500);
}
