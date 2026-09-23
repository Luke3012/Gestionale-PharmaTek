//! FASE 14 — suggerimenti intelligenti e azionabili.
//!
//! Le card non sono record applicativi: vengono riderivate dalla proiezione e
//! contengono soltanto un deep-link verso flussi già esistenti. L'unico stato
//! sincronizzato è l'eventuale «nascondi finché cambia», identificato dalla
//! fotografia minima delle sorgenti. Quando una sorgente sparisce o cambia,
//! anche l'id cambia e il vecchio stato non può occultare lavoro nuovo.

use super::cleanup::oggi_iso;
use super::*;
use chrono::{Local, TimeZone};

const ENTITA_STATO_SUGGERIMENTO: &str = "suggerimento_stato";
const PREFISSO_SUGGERIMENTO: &str = "s14:";
const PAUSA_TIPO_SUGGERIMENTO_MS: u64 = 6 * 60 * 60 * 1000;
pub(crate) const TIPI_SUGGERIMENTO: [&str; 6] = [
    "rimborso",
    "distinta",
    "provvigione",
    "produzione",
    "spedizione",
    "preventivo",
];

pub(crate) fn entita_influenza_suggerimenti(entity: &str) -> bool {
    matches!(
        entity,
        "rimborso"
            | "pagamento"
            | "conto"
            | "distinta"
            | "ordine"
            | "riga_ordine"
            | "prodotto"
            | "agente"
            | "provv_pagamento"
            | "parametri_globali"
            | "spedizione"
            | "cliente"
            | "corriere"
            | "suggerimento_stato"
            | "snapshot"
            | "preventivo"
            | "comunicazione"
    )
}

fn firma_sorgenti(mut sorgenti: Vec<String>) -> String {
    sorgenti.sort();
    sorgenti.dedup();
    let digest = communication::sha256_hex(sorgenti.join("\n"));
    digest[..20].to_string()
}

fn id_suggerimento(tipo: &str, sorgenti: Vec<String>) -> String {
    format!("{PREFISSO_SUGGERIMENTO}{tipo}:{}", firma_sorgenti(sorgenti))
}

fn collegamento(path: &str) -> SuggerimentoCollegamentoDto {
    SuggerimentoCollegamentoDto {
        path: path.into(),
        ..Default::default()
    }
}

fn testo_importo(centesimi: i64) -> String {
    let euro = centesimi as f64 / 100.0;
    let segno = if euro < 0.0 { "-" } else { "" };
    let assoluto = euro.abs();
    let intero = assoluto.trunc() as i64;
    let decimali = ((assoluto.fract() * 100.0).round() as i64).min(99);
    let gruppi = intero
        .to_string()
        .as_bytes()
        .rchunks(3)
        .rev()
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or_default())
        .collect::<Vec<_>>()
        .join(".");
    format!("{segno}€ {gruppi},{decimali:02}")
}

fn u64_field(data: &serde_json::Map<String, serde_json::Value>, key: &str) -> u64 {
    data.get(key)
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0)
}

#[derive(Clone, Copy)]
enum SelezionePreventivi {
    Tutti,
    Maturi(i64),
}

fn oggi_iso_locale() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn data_epoch_ms_locale(ms: u64) -> String {
    i64::try_from(ms)
        .ok()
        .and_then(|valore| Local.timestamp_millis_opt(valore).single())
        .map(|data| data.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

fn preventivo_maturo(data: &str, selezione: SelezionePreventivi, oggi: &str) -> bool {
    match selezione {
        SelezionePreventivi::Tutti => true,
        SelezionePreventivi::Maturi(giorni) => {
            giorni <= 0 || giorni_tra(data, oggi) >= giorni.clamp(0, 90)
        }
    }
}

fn nello_anno_di_lavoro(data: &str, anno: i32) -> bool {
    anno == 0 || data.get(..4).and_then(|valore| valore.parse::<i32>().ok()) == Some(anno)
}

fn data_it(iso: &str) -> String {
    let mut parti = iso.split('-');
    match (parti.next(), parti.next(), parti.next(), parti.next()) {
        (Some(anno), Some(mese), Some(giorno), None)
            if anno.len() == 4 && mese.len() == 2 && giorno.len() == 2 =>
        {
            format!("{giorno}/{mese}/{anno}")
        }
        _ => iso.to_string(),
    }
}

fn ordine_candidabile_produzione(stato: &str, ha_righe_spedite: bool) -> bool {
    stato == "Confermato" && !ha_righe_spedite
}

fn priorita_con_anzianita(base: i64, data: &str, oggi: &str) -> i64 {
    let giorni = giorni_tra(data, oggi).max(0);
    (base + giorni.min(12)).min(100)
}

fn aggiornato_massimo<'a>(records: impl IntoIterator<Item = &'a crate::projection::Record>) -> i64 {
    records
        .into_iter()
        .map(aggiornato_record_ms)
        .max()
        .unwrap_or(0)
}

fn aggiornato_record_ms(record: &crate::projection::Record) -> i64 {
    record.updated_hlc.wall.min(i64::MAX as u64) as i64
}

/// Fingerprint condiviso fra elenco spedizioni, invio comunicazione e motore dei
/// suggerimenti. Include solo i campi che cambiano davvero il contenuto
/// dell'avviso; il marcatore di invio non si auto-invalida.
pub(super) fn fingerprint_spedizione_comunicazione<'a>(
    id: &str,
    data: &str,
    corriere_id: &str,
    cliente_id: &str,
    righe: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> String {
    let mut parti = vec![
        format!("id={id}"),
        format!("data={data}"),
        format!("corriere={corriere_id}"),
        format!("cliente={cliente_id}"),
    ];
    parti.extend(
        righe
            .into_iter()
            .map(|(riga_id, numero)| format!("riga={riga_id}|numero={numero}")),
    );
    format!("spedizione-v1:{}", firma_sorgenti(parti))
}

pub(crate) struct SpedizioneDaAvvisare {
    pub id: String,
    pub data: String,
    pub cliente_id: String,
    pub fingerprint: String,
    pub aggiornato_ms: i64,
}

pub(crate) fn spedizioni_da_avvisare_per_lotto(
    p: &crate::projection::Projection,
    ordini: &HashMap<String, crate::projection::Record>,
    oggi: &str,
) -> HashMap<String, Vec<SpedizioneDaAvvisare>> {
    let ord_clienti: HashMap<String, String> = ordini
        .iter()
        .map(|(id, ordine)| (id.clone(), str_field(&ordine.data, "cliente_id")))
        .collect();
    let clienti_contattabili: HashSet<String> = p
        .list("cliente")
        .unwrap_or_default()
        .into_iter()
        .filter(|cliente| {
            !str_field(&cliente.data, "email").is_empty()
                || !str_field(&cliente.data, "telefono").is_empty()
        })
        .map(|cliente| cliente.id)
        .collect();
    let mut righe_per_spedizione: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
    for riga in p.list("riga_ordine").unwrap_or_default() {
        let spedizione_id = str_field(&riga.data, "spedizione_id");
        if spedizione_id.is_empty() {
            continue;
        }
        righe_per_spedizione
            .entry(spedizione_id)
            .or_default()
            .push((
                riga.id,
                str_field(&riga.data, "numero"),
                str_field(&riga.data, "ordine_id"),
            ));
    }

    let mut per_lotto: HashMap<String, Vec<SpedizioneDaAvvisare>> = HashMap::new();
    for spedizione in p.list("spedizione").unwrap_or_default() {
        if !str_field(&spedizione.data, "dest_unito_in").is_empty() {
            continue;
        }
        let data = str_field(&spedizione.data, "data");
        let eta = giorni_tra(&data, oggi);
        if data.is_empty() || !(0..=14).contains(&eta) {
            continue;
        }
        let righe = righe_per_spedizione
            .get(&spedizione.id)
            .cloned()
            .unwrap_or_default();
        let cliente_id = righe
            .iter()
            .find_map(|(_, _, ordine_id)| ord_clienti.get(ordine_id))
            .cloned()
            .unwrap_or_default();
        if cliente_id.is_empty() || !clienti_contattabili.contains(&cliente_id) {
            continue;
        }
        let fingerprint = fingerprint_spedizione_comunicazione(
            &spedizione.id,
            &data,
            &str_field(&spedizione.data, "corriere_id"),
            &cliente_id,
            righe
                .iter()
                .map(|(riga_id, numero, _)| (riga_id.as_str(), numero.as_str())),
        );
        if str_field(&spedizione.data, "ultimo_avviso_fingerprint") == fingerprint {
            continue;
        }
        let lotto = str_field(&spedizione.data, "lotto");
        let aggiornato_ms = aggiornato_record_ms(&spedizione);
        per_lotto
            .entry(if lotto.is_empty() {
                spedizione.id.clone()
            } else {
                lotto
            })
            .or_default()
            .push(SpedizioneDaAvvisare {
                id: spedizione.id,
                data,
                cliente_id,
                fingerprint,
                aggiornato_ms,
            });
    }
    per_lotto
}

pub(crate) fn spedizioni_per_suggerimento_avviso(
    p: &crate::projection::Projection,
) -> HashMap<String, Vec<(String, String)>> {
    let oggi = oggi_iso();
    let tutti_ordini: HashMap<String, crate::projection::Record> = p
        .list("ordine")
        .unwrap_or_default()
        .into_iter()
        .map(|r| (r.id.clone(), r))
        .collect();
    let mut out = HashMap::new();
    let anni = std::iter::once(0).chain(
        tutti_ordini
            .values()
            .filter_map(|ordine| {
                str_field(&ordine.data, "data")
                    .get(..4)?
                    .parse::<i32>()
                    .ok()
            })
            .collect::<HashSet<_>>(),
    );
    for anno in anni {
        let ordini: HashMap<String, crate::projection::Record> = tutti_ordini
            .iter()
            .filter(|(_, ordine)| {
                anno == 0 || nello_anno_di_lavoro(&str_field(&ordine.data, "data"), anno)
            })
            .map(|(id, ordine)| (id.clone(), ordine.clone()))
            .collect();
        for (_lotto, spedizioni) in spedizioni_da_avvisare_per_lotto(p, &ordini, &oggi) {
            let fonti: Vec<String> = spedizioni
                .iter()
                .map(|s| format!("{}|{}", s.id, s.fingerprint))
                .collect();
            let id = id_suggerimento("spedizione", fonti);
            out.insert(
                id,
                spedizioni
                    .into_iter()
                    .map(|s| (s.id, s.fingerprint))
                    .collect(),
            );
        }
    }
    out
}

fn deriva_operativi(
    p: &crate::projection::Projection,
    selezione_preventivi: SelezionePreventivi,
    anno: i32,
) -> Vec<SuggerimentoDto> {
    let oggi = oggi_iso();
    let mut out = Vec::new();

    // Rimborsi richiesti: una sola azione di coda, non una card per record.
    let rimborsi: Vec<_> = p
        .list("rimborso")
        .unwrap_or_default()
        .into_iter()
        .filter(|r| {
            str_field(&r.data, "data_rimborso").is_empty()
                && nello_anno_di_lavoro(&str_field(&r.data, "data_richiesta"), anno)
        })
        .collect();
    if !rimborsi.is_empty() {
        let totale: i64 = rimborsi.iter().map(|r| i64_field(&r.data, "importo")).sum();
        let aggiornato_ms = aggiornato_massimo(rimborsi.iter());
        let data_vecchia = rimborsi
            .iter()
            .map(|r| str_field(&r.data, "data_richiesta"))
            .filter(|data| !data.is_empty())
            .min()
            .unwrap_or_default();
        let fonti = rimborsi
            .iter()
            .map(|r| {
                format!(
                    "{}|{}|{}",
                    r.id,
                    i64_field(&r.data, "importo"),
                    str_field(&r.data, "data_richiesta")
                )
            })
            .collect();
        let mut target = collegamento("/contabilita");
        target.tab = Some("rimborsi".into());
        target.rimborso_stati = Some(vec!["richiesto".into()]);
        out.push(SuggerimentoDto {
            id: id_suggerimento("rimborso", fonti),
            tipo: "rimborso".into(),
            titolo: if rimborsi.len() == 1 {
                "Completa il rimborso aperto".into()
            } else {
                format!("Completa {} rimborsi aperti", rimborsi.len())
            },
            dettaglio: format!("{} ancora da effettuare", testo_importo(totale)),
            azione_label: "Vai ai rimborsi".into(),
            priorita: priorita_con_anzianita(91, &data_vecchia, &oggi),
            collegamento: target,
            riferimento_data: data_vecchia,
            aggiornato_ms,
        });
    }

    // Contrassegni/assegni non ancora coperti: riusa lo stesso selettore usato
    // dal modale Distinta, così criteri e importi non possono divergere.
    let aperti = contrassegni_dto(p, |r| {
        str_field(&r.data, "distinta_id").is_empty()
            && nello_anno_di_lavoro(&str_field(&r.data, "data"), anno)
    });
    if !aperti.is_empty() {
        let totale: i64 = aperti.iter().map(|r| r.importo).sum();
        let aggiornato_ms = aperti
            .iter()
            .filter_map(|r| p.get("pagamento", &r.id).ok().flatten())
            .map(|record| aggiornato_record_ms(&record))
            .max()
            .unwrap_or(0);
        let data_vecchia = aperti
            .iter()
            .map(|r| r.data.clone())
            .filter(|data| !data.is_empty())
            .min()
            .unwrap_or_default();
        let fonti = aperti
            .iter()
            .map(|r| format!("{}|{}|{}|{}", r.id, r.importo, r.conto_id, r.data))
            .collect();
        let mut target = collegamento("/contabilita");
        target.tab = Some("distinte".into());
        target.azione = Some("nuova_distinta".into());
        out.push(SuggerimentoDto {
            id: id_suggerimento("distinta", fonti),
            tipo: "distinta".into(),
            titolo: if aperti.len() == 1 {
                "Registra una distinta da accreditare".into()
            } else {
                format!("Raggruppa {} incassi in distinta", aperti.len())
            },
            dettaglio: format!(
                "{} tra contrassegni e assegni non accreditati",
                testo_importo(totale)
            ),
            azione_label: "Crea distinta".into(),
            priorita: priorita_con_anzianita(82, &data_vecchia, &oggi),
            collegamento: target,
            riferimento_data: data_vecchia,
            aggiornato_ms,
        });
    }

    let ordini: HashMap<String, crate::projection::Record> = p
        .list("ordine")
        .unwrap_or_default()
        .into_iter()
        .filter(|r| nello_anno_di_lavoro(&str_field(&r.data, "data"), anno))
        .map(|r| (r.id.clone(), r))
        .collect();
    let linee_per_ordine = linee_ordini(p);
    let acconti_incassati: HashMap<String, i64> = p
        .list("pagamento")
        .unwrap_or_default()
        .into_iter()
        .filter(|r| str_field(&r.data, "tipo") == "acconto" && bool_field(&r.data, "saldato"))
        .fold(HashMap::new(), |mut out, record| {
            let ordine_id = str_field(&record.data, "ordine_id");
            out.entry(ordine_id)
                .and_modify(|ts| *ts = (*ts).max(aggiornato_record_ms(&record)))
                .or_insert_with(|| aggiornato_record_ms(&record));
            out
        });

    // Righe confermate, pagate e ancora fuori da un lotto: coincide con la
    // coda «Da produrre» e apre quel filtro, senza inventare un nuovo batch.
    // Una spedizione gia' collegata a una qualunque riga rende l'intero ordine
    // non proponibile: uno stato ordine rimasto temporaneamente «Confermato» non
    // deve mai far preparare di nuovo merce gia' spedita.
    let ordini_gia_spediti: HashSet<String> = p
        .list("riga_ordine")
        .unwrap_or_default()
        .into_iter()
        .filter(|riga| !str_field(&riga.data, "spedizione_id").is_empty())
        .map(|riga| str_field(&riga.data, "ordine_id"))
        .filter(|ordine_id| !ordine_id.is_empty())
        .collect();
    let mut righe_pronte = Vec::new();
    let mut ordini_pronti = HashSet::new();
    let mut data_vecchia_produzione = String::new();
    let mut aggiornato_produzione = 0;
    for riga in p.list("riga_ordine").unwrap_or_default() {
        if !str_field(&riga.data, "stato_produzione").is_empty()
            || !str_field(&riga.data, "lotto_produzione").is_empty()
        {
            continue;
        }
        let ordine_id = str_field(&riga.data, "ordine_id");
        let Some(ordine) = ordini.get(&ordine_id) else {
            continue;
        };
        let categoria_ordine = str_field(&ordine.data, "categoria");
        let linee_rilevanti = if categoria_ordine.is_empty() {
            linee_per_ordine.get(&ordine_id).is_some_and(|linee| {
                linee
                    .iter()
                    .any(|linea| matches!(linea.as_str(), "Immunoterapia" | "Diagnostica"))
            })
        } else {
            matches!(categoria_ordine.as_str(), "Immunoterapia" | "Diagnostica")
        };
        if !ordine_candidabile_produzione(
            &str_field(&ordine.data, "stato"),
            ordini_gia_spediti.contains(&ordine_id),
        ) || !linee_rilevanti
            || !acconti_incassati.contains_key(&ordine_id)
        {
            continue;
        }
        let data = str_field(&ordine.data, "data");
        if data_vecchia_produzione.is_empty()
            || (!data.is_empty() && data < data_vecchia_produzione)
        {
            data_vecchia_produzione = data;
        }
        ordini_pronti.insert(ordine_id);
        aggiornato_produzione = aggiornato_produzione
            .max(aggiornato_record_ms(&riga))
            .max(aggiornato_record_ms(ordine))
            .max(
                acconti_incassati
                    .get(&str_field(&riga.data, "ordine_id"))
                    .copied()
                    .unwrap_or(0),
            );
        righe_pronte.push(format!(
            "{}|{}|{}",
            riga.id,
            str_field(&riga.data, "prodotto_id"),
            i64_field(&riga.data, "qta")
        ));
    }
    if !righe_pronte.is_empty() {
        let mut target = collegamento("/produzione");
        target.tab = Some("da_produrre".into());
        target.produzione_acconto = Some("incassato".into());
        out.push(SuggerimentoDto {
            id: id_suggerimento("produzione", righe_pronte.clone()),
            tipo: "produzione".into(),
            titolo: "Prepara il prossimo lotto di produzione".into(),
            dettaglio: format!(
                "{} {} · {} {} con acconto incassato",
                righe_pronte.len(),
                if righe_pronte.len() == 1 {
                    "prodotto"
                } else {
                    "prodotti"
                },
                ordini_pronti.len(),
                if ordini_pronti.len() == 1 {
                    "ordine"
                } else {
                    "ordini"
                }
            ),
            azione_label: "Prepara lotto".into(),
            priorita: priorita_con_anzianita(73, &data_vecchia_produzione, &oggi),
            collegamento: target,
            riferimento_data: data_vecchia_produzione,
            aggiornato_ms: aggiornato_produzione,
        });
    }

    {
        let per_lotto = spedizioni_da_avvisare_per_lotto(p, &ordini, &oggi);

        for (_lotto, spedizioni) in per_lotto {
            let clienti = spedizioni
                .iter()
                .map(|spedizione| spedizione.cliente_id.as_str())
                .collect::<HashSet<_>>()
                .len();
            let prima = spedizioni.first().map(|s| s.id.clone()).unwrap_or_default();
            let data = spedizioni
                .iter()
                .map(|s| s.data.clone())
                .min()
                .unwrap_or_default();
            let fonti = spedizioni
                .iter()
                .map(|s| format!("{}|{}", s.id, s.fingerprint))
                .collect();
            let aggiornato_ms = spedizioni
                .iter()
                .map(|spedizione| spedizione.aggiornato_ms)
                .max()
                .unwrap_or(0);
            let mut target = collegamento("/evasione");
            target.tab = Some("effettuate".into());
            target.apri_id = Some(prima);
            out.push(SuggerimentoDto {
                id: id_suggerimento("spedizione", fonti),
                tipo: "spedizione".into(),
                titolo: if clienti == 1 {
                    "Avvisa il cliente della spedizione".into()
                } else {
                    format!("Avvisa {clienti} clienti della spedizione")
                },
                dettaglio: format!(
                    "{} {} senza avviso · spedizione del {}",
                    spedizioni.len(),
                    if spedizioni.len() == 1 {
                        "collo"
                    } else {
                        "colli"
                    },
                    data_it(&data)
                ),
                azione_label: "Apri spedizione".into(),
                priorita: priorita_con_anzianita(84, &data, &oggi),
                collegamento: target,
                riferimento_data: data,
                aggiornato_ms,
            });
        }
    }

    {
        let oggi_preventivi = oggi_iso_locale();
        let mut da_inviare_fonti = Vec::new();
        let mut da_sollecitare_fonti = Vec::new();
        let mut data_vecchia_preventivo = String::new();
        let mut aggiornato_preventivo = 0i64;

        for record in p.list("preventivo").unwrap_or_default() {
            if record.deleted {
                continue;
            }
            let ordine_id = str_field(&record.data, "ordine_id");
            if ordine_id.is_empty() {
                continue;
            }
            let Some(ordine) = ordini.get(&ordine_id) else {
                continue;
            };
            if ordine.deleted {
                continue;
            }
            // Filtro: solo ordini con stato "Nuovo" e nessun marcatore (né urgente, né anomalia, né sollecito)
            if str_field(&ordine.data, "stato") != "Nuovo" {
                continue;
            }
            if !str_field(&ordine.data, "marcatore").is_empty() {
                continue;
            }

            let creato_ms = u64_field(&record.data, "creato_ms");
            let ultima_modifica_ms = u64_field(&record.data, "ultima_modifica_ms");
            let ultimo_invio_ms = u64_field(&record.data, "ultimo_invio_ms");
            let ultimo_invio_fingerprint = str_field(&record.data, "ultimo_invio_fingerprint");
            let fingerprint_corrente = str_field(&record.data, "fingerprint_corrente");
            let ultimo_sollecito_ms = u64_field(&record.data, "ultimo_sollecito_ms");

            let indicazione_invio = if ultimo_invio_ms == 0 {
                "mai_inviato"
            } else if ultimo_invio_fingerprint.is_empty()
                || ultimo_invio_fingerprint != fingerprint_corrente
                || ultimo_invio_ms < ultima_modifica_ms
            {
                "modificato_dopo_invio"
            } else {
                "inviato"
            };

            let data_rif_ms = match indicazione_invio {
                "mai_inviato" | "modificato_dopo_invio" => ultima_modifica_ms.max(creato_ms),
                "inviato" => ultimo_invio_ms.max(ultimo_sollecito_ms),
                _ => 0,
            };

            let data_iso = if data_rif_ms > 0 {
                data_epoch_ms_locale(data_rif_ms)
            } else {
                let data_ord = str_field(&ordine.data, "data");
                if !data_ord.is_empty() {
                    data_ord
                } else {
                    data_epoch_ms_locale(record.updated_hlc.wall)
                }
            };

            if !preventivo_maturo(&data_iso, selezione_preventivi, &oggi_preventivi) {
                continue;
            }

            let aggiornato_rec = aggiornato_record_ms(&record).max(aggiornato_record_ms(ordine));
            aggiornato_preventivo = aggiornato_preventivo.max(aggiornato_rec);

            if data_vecchia_preventivo.is_empty()
                || (!data_iso.is_empty() && data_iso < data_vecchia_preventivo)
            {
                data_vecchia_preventivo = data_iso.clone();
            }

            match indicazione_invio {
                "mai_inviato" | "modificato_dopo_invio" => {
                    da_inviare_fonti.push(format!(
                        "invio:{}|{}|{}",
                        record.id, fingerprint_corrente, data_iso
                    ));
                }
                "inviato" => {
                    da_sollecitare_fonti.push(format!(
                        "sollecito:{}|{}|{}",
                        record.id, ultimo_sollecito_ms, data_iso
                    ));
                }
                _ => {}
            }
        }

        let n_inviare = da_inviare_fonti.len();
        let n_sollecitare = da_sollecitare_fonti.len();
        let totale_candidati = n_inviare + n_sollecitare;

        if totale_candidati > 0 {
            let mut fonti = da_inviare_fonti;
            fonti.extend(da_sollecitare_fonti);

            let (titolo, dettaglio, azione_label) = if n_inviare > 0 && n_sollecitare > 0 {
                (
                    "Invia o sollecita preventivi in sospeso".to_string(),
                    format!("{n_inviare} da inviare · {n_sollecitare} in attesa di risposta"),
                    "Gestisci preventivi".to_string(),
                )
            } else if n_inviare > 0 {
                (
                    if n_inviare == 1 {
                        "Invia il preventivo non trasmesso".to_string()
                    } else {
                        format!("Invia {n_inviare} preventivi non trasmessi")
                    },
                    format!(
                        "{n_inviare} {} in attesa di proposta",
                        if n_inviare == 1 {
                            "ordine Nuovo"
                        } else {
                            "ordini Nuovi"
                        }
                    ),
                    "Invia preventivi".to_string(),
                )
            } else {
                (
                    if n_sollecitare == 1 {
                        "Sollecita il preventivo in attesa".to_string()
                    } else {
                        format!("Sollecita {n_sollecitare} preventivi in attesa")
                    },
                    format!(
                        "{n_sollecitare} {} senza risposta",
                        if n_sollecitare == 1 {
                            "preventivo inviato"
                        } else {
                            "preventivi inviati"
                        }
                    ),
                    "Sollecita preventivi".to_string(),
                )
            };

            let mut target = collegamento("/preventivi");
            target.azione = Some("solleciti_preventivi".into());

            out.push(SuggerimentoDto {
                id: id_suggerimento("preventivo", fonti),
                tipo: "preventivo".into(),
                titolo,
                dettaglio,
                azione_label,
                priorita: priorita_con_anzianita(78, &data_vecchia_preventivo, &oggi_preventivi),
                collegamento: target,
                riferimento_data: data_vecchia_preventivo,
                aggiornato_ms: aggiornato_preventivo,
            });
        }
    }

    out
}

fn ordina(mut suggerimenti: Vec<SuggerimentoDto>) -> Vec<SuggerimentoDto> {
    suggerimenti.sort_by(|a, b| {
        b.priorita
            .cmp(&a.priorita)
            .then_with(|| a.tipo.cmp(&b.tipo))
            .then_with(|| a.id.cmp(&b.id))
    });
    suggerimenti
}

fn provvigioni_positive_da_liquidare(
    agente: &ProvvigioneAgenteDto,
) -> (Vec<&ProvvigioneOrdineDto>, i64) {
    let ordini: Vec<_> = agente
        .ordini
        .iter()
        .filter(|ordine| ordine.maturato && ordine.provvigione > 0)
        .collect();
    let totale = ordini.iter().map(|ordine| ordine.provvigione).sum();
    (ordini, totale)
}

fn valida_id_suggerimento(suggerimento_id: &str) -> AppResult<&str> {
    let suggerimento_id = suggerimento_id.trim();
    if !suggerimento_id.starts_with(PREFISSO_SUGGERIMENTO)
        || suggerimento_id.len() > 160
        || suggerimento_id.chars().any(char::is_control)
    {
        return Err("suggerimento non valido".into());
    }
    Ok(suggerimento_id)
}

pub(crate) fn tipo_suggerimento_da_id(suggerimento_id: &str) -> Option<&str> {
    let tipo = suggerimento_id
        .strip_prefix(PREFISSO_SUGGERIMENTO)?
        .split(':')
        .next()?;
    TIPI_SUGGERIMENTO.contains(&tipo).then_some(tipo)
}

fn tipo_suggerimento_in_pausa(
    suggerimento_id: &str,
    tipo_salvato: &str,
    ts: u64,
    ora: u64,
) -> Option<String> {
    if ts == 0 || ora.saturating_sub(ts) >= PAUSA_TIPO_SUGGERIMENTO_MS {
        return None;
    }
    let tipo = if TIPI_SUGGERIMENTO.contains(&tipo_salvato) {
        tipo_salvato
    } else {
        tipo_suggerimento_da_id(suggerimento_id).unwrap_or_default()
    };
    // Per "spedizione", l'azione o l'ignora marca permanentemente i singoli colli come avvisati
    // manualmente, evitando di riproporli. Non dobbiamo mettere in pausa l'intera categoria per 24 ore,
    // altrimenti eventuali nuove spedizioni create poco dopo non verrebbero suggerite.
    if tipo == "spedizione" {
        return None;
    }
    if TIPI_SUGGERIMENTO.contains(&tipo) {
        return Some(tipo.to_string());
    }
    None
}

impl AppState {
    #[allow(dead_code)]
    pub fn suggerimenti_lista_con_soglia_preventivi(
        &self,
        giorni: i64,
    ) -> AppResult<SuggerimentiBundleDto> {
        self.suggerimenti_lista_con_soglia_preventivi_per_anno(giorni, 0)
    }

    pub fn suggerimenti_lista_con_soglia_preventivi_per_anno(
        &self,
        giorni: i64,
        anno: i32,
    ) -> AppResult<SuggerimentiBundleDto> {
        self.suggerimenti_lista_con_esclusioni(
            true,
            SelezionePreventivi::Maturi(giorni.clamp(0, 90)),
            anno,
        )
    }

    /// Ricalcolo esplicito richiesto dall'utente: restituisce anche fotografie
    /// nascoste e categorie in pausa, senza modificare i relativi record.
    #[allow(dead_code)]
    pub fn suggerimenti_lista_completa(&self) -> AppResult<SuggerimentiBundleDto> {
        self.suggerimenti_lista_completa_per_anno(0)
    }

    pub fn suggerimenti_lista_completa_per_anno(
        &self,
        anno: i32,
    ) -> AppResult<SuggerimentiBundleDto> {
        self.suggerimenti_lista_con_esclusioni(false, SelezionePreventivi::Tutti, anno)
    }

    fn suggerimenti_lista_con_esclusioni(
        &self,
        applica_esclusioni: bool,
        selezione_preventivi: SelezionePreventivi,
        anno: i32,
    ) -> AppResult<SuggerimentiBundleDto> {
        crate::premium::ensure_access(self)?;
        // Il report è l'unica fonte autorevole per maturazione, configurazioni,
        // IVA/spedizione e ordini già liquidati: lo riusiamo invece di replicarne
        // le regole nel motore FASE 14.
        let (dal, al) = if anno == 0 {
            (None, None)
        } else {
            (Some(format!("{anno}-01-01")), Some(format!("{anno}-12-31")))
        };
        let report = self.provvigioni_report(dal, al, None)?;
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let mut suggerimenti = deriva_operativi(p, selezione_preventivi, anno);

                for agente in &report.agenti {
                    // Il report resta la fonte autorevole per calcolo e maturazione.
                    // Il suggerimento, però, riguarda soltanto importi realmente
                    // liquidabili: righe a zero o negative non devono far comparire
                    // l'agente né gonfiare conteggio, totale o firma della card.
                    let (maturate, totale_da_liquidare) = provvigioni_positive_da_liquidare(agente);
                    if maturate.is_empty() {
                        continue;
                    }
                    let fonti = maturate
                        .iter()
                        .map(|ordine| {
                            format!(
                                "{}|{}|{}",
                                ordine.ordine_id, ordine.provvigione, ordine.stato
                            )
                        })
                        .collect();
                    let riferimento_data = maturate
                        .iter()
                        .map(|ordine| ordine.data.clone())
                        .filter(|data| !data.is_empty())
                        .min()
                        .unwrap_or_default();
                    let aggiornato_ms = maturate
                        .iter()
                        .filter_map(|ordine| p.get("ordine", &ordine.ordine_id).ok().flatten())
                        .map(|record| aggiornato_record_ms(&record))
                        .max()
                        .unwrap_or(0);
                    let mut target = collegamento("/contabilita");
                    target.tab = Some("provvigioni".into());
                    target.agente_id = Some(agente.agente_id.clone());
                    target.provvigioni_ordina = Some("maturato".into());
                    suggerimenti.push(SuggerimentoDto {
                        id: id_suggerimento("provvigione", fonti),
                        tipo: "provvigione".into(),
                        titolo: format!(
                            "Liquida le provvigioni di {}",
                            if agente.agente_nome.is_empty() {
                                "un agente"
                            } else {
                                &agente.agente_nome
                            }
                        ),
                        dettaglio: format!(
                            "{} maturate su {} {}",
                            testo_importo(totale_da_liquidare),
                            maturate.len(),
                            if maturate.len() == 1 {
                                "ordine"
                            } else {
                                "ordini"
                            }
                        ),
                        azione_label: "Apri provvigioni".into(),
                        priorita: (70 + (totale_da_liquidare / 100_000).min(10)).min(88),
                        collegamento: target,
                        riferimento_data,
                        aggiornato_ms,
                    });
                }

                if !applica_esclusioni {
                    return SuggerimentiBundleDto {
                        suggerimenti: ordina(suggerimenti),
                        nascosti: Vec::new(),
                        tipi_in_pausa: Vec::new(),
                    };
                }

                let ora = now_ms();
                let mut nascosti = HashSet::new();
                let mut tipi_in_pausa = HashSet::new();
                for record in p.list(ENTITA_STATO_SUGGERIMENTO).unwrap_or_default() {
                    if !bool_field(&record.data, "nascosto") {
                        continue;
                    }
                    let id = str_field(&record.data, "suggerimento_id");
                    if id.is_empty() {
                        continue;
                    }
                    nascosti.insert(id.clone());
                    let ts = record
                        .data
                        .get("ts")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0);
                    if let Some(tipo) =
                        tipo_suggerimento_in_pausa(&id, &str_field(&record.data, "tipo"), ts, ora)
                    {
                        tipi_in_pausa.insert(tipo);
                    }
                }
                suggerimenti.retain(|suggerimento| {
                    !nascosti.contains(&suggerimento.id)
                        && !tipi_in_pausa.contains(&suggerimento.tipo)
                });
                let mut nascosti: Vec<String> = nascosti.into_iter().collect();
                nascosti.sort();
                let mut tipi_in_pausa: Vec<String> = tipi_in_pausa.into_iter().collect();
                tipi_in_pausa.sort();
                SuggerimentiBundleDto {
                    suggerimenti: ordina(suggerimenti),
                    nascosti,
                    tipi_in_pausa,
                }
            }))
        })
    }

    pub fn suggerimento_nascondi(&self, suggerimento_id: &str) -> AppResult<()> {
        self.suggerimenti_nascondi(&[suggerimento_id.to_owned()])
    }

    pub fn suggerimenti_nascondi(&self, suggerimento_ids: &[String]) -> AppResult<()> {
        crate::premium::ensure_access(self)?;
        if suggerimento_ids.len() > 512 {
            return Err("troppi suggerimenti".into());
        }
        let mut suggerimenti = suggerimento_ids
            .iter()
            .map(|id| {
                let id = valida_id_suggerimento(id)?.to_owned();
                let tipo = tipo_suggerimento_da_id(&id).unwrap_or_default().to_owned();
                Ok((id, tipo))
            })
            .collect::<AppResult<Vec<_>>>()?;
        suggerimenti.sort();
        suggerimenti.dedup();
        if suggerimenti.is_empty() {
            return Ok(());
        }
        let identity = self
            .whoami()
            .ok_or("seleziona un utente prima di nascondere il suggerimento")?;
        let ts = now_ms();
        self.with_engine(|engine| {
            engine
                .emit_built_checked(move |p| {
                    let mut mutations = Vec::with_capacity(suggerimenti.len() * 7);
                    let mut spedizioni_mappa: Option<HashMap<String, Vec<(String, String)>>> = None;
                    for (suggerimento_id, tipo) in &suggerimenti {
                        let record_id = format!(
                            "stato-suggerimento-v1|{}",
                            &communication::sha256_hex(suggerimento_id)[..24]
                        );
                        mutations.push(Mutation::new(
                            ENTITA_STATO_SUGGERIMENTO,
                            record_id.clone(),
                            EventBody::Created,
                        ));
                        for (field, value) in [
                            ("suggerimento_id", json!(suggerimento_id)),
                            ("tipo", json!(tipo)),
                            ("nascosto", json!(true)),
                            ("ts", json!(ts)),
                            ("utente_id", json!(identity.user_id)),
                            ("dispositivo_id", json!(identity.device_id)),
                        ] {
                            mutations.push(Mutation::new(
                                ENTITA_STATO_SUGGERIMENTO,
                                record_id.clone(),
                                EventBody::FieldSet {
                                    field: field.into(),
                                    value,
                                },
                            ));
                        }

                        if tipo == "spedizione" {
                            let mappa = spedizioni_mappa
                                .get_or_insert_with(|| spedizioni_per_suggerimento_avviso(p));
                            if let Some(colli) = mappa.get(suggerimento_id) {
                                for (sped_id, fp) in colli {
                                    for (field, val) in [
                                        ("ultimo_avviso_ms", json!(ts)),
                                        ("ultimo_avviso_canale", json!("manuale")),
                                        ("ultimo_avviso_fingerprint", json!(fp)),
                                    ] {
                                        mutations.push(Mutation::new(
                                            "spedizione",
                                            sped_id.clone(),
                                            EventBody::FieldSet {
                                                field: field.into(),
                                                value: val,
                                            },
                                        ));
                                    }
                                }
                            }
                        }
                    }
                    Ok(mutations)
                })
                .map(|_| ())
                .map_err(es)
        })
    }

    /// Elimina i record tecnici di sospensione/pausa (suggerimento_stato) per i tipi indicati,
    /// o per tutti i tipi se `tipi` è `None`. Consente di ripristinare immediatamente le card
    /// alla disattivazione delle notifiche o al ripristino delle impostazioni predefinite.
    pub fn suggerimenti_azzera_pause(&self, tipi: Option<&[String]>) -> AppResult<()> {
        self.with_engine(|engine| {
            engine
                .emit_built_checked(|p| {
                    let mut mutations = Vec::new();
                    for record in p.list(ENTITA_STATO_SUGGERIMENTO).map_err(es)? {
                        let tipo = str_field(&record.data, "tipo");
                        let tipo_effettivo = if tipo.is_empty() {
                            let id = str_field(&record.data, "suggerimento_id");
                            tipo_suggerimento_da_id(&id).unwrap_or_default().to_string()
                        } else {
                            tipo
                        };
                        let da_eliminare = match tipi {
                            None => true,
                            Some(filtri) => filtri.iter().any(|f| f == &tipo_effettivo),
                        };
                        if da_eliminare {
                            mutations.push(Mutation::new(
                                ENTITA_STATO_SUGGERIMENTO,
                                record.id,
                                EventBody::Deleted,
                            ));
                        }
                    }
                    Ok(mutations)
                })
                .map(|_| ())
                .map_err(es)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_cambia_solo_quando_cambia_la_fotografia() {
        let a = id_suggerimento("rimborso", vec!["b|20".into(), "a|10".into()]);
        let b = id_suggerimento("rimborso", vec!["a|10".into(), "b|20".into()]);
        let c = id_suggerimento("rimborso", vec!["a|11".into(), "b|20".into()]);
        assert_eq!(a, b, "l'ordine di lettura non deve cambiare l'id");
        assert_ne!(a, c, "una modifica sostanziale deve riattivare la card");
    }

    #[test]
    fn fingerprint_spedizione_non_dipende_dall_ordine_delle_righe() {
        let a = fingerprint_spedizione_comunicazione(
            "s1",
            "2026-08-01",
            "gls",
            "c1",
            [("r2", "20"), ("r1", "10")],
        );
        let b = fingerprint_spedizione_comunicazione(
            "s1",
            "2026-08-01",
            "gls",
            "c1",
            [("r1", "10"), ("r2", "20")],
        );
        assert_eq!(a, b);
    }

    #[test]
    fn produzione_esclude_qualsiasi_ordine_gia_spedito() {
        assert!(ordine_candidabile_produzione("Confermato", false));
        assert!(!ordine_candidabile_produzione("Confermato", true));
        assert!(!ordine_candidabile_produzione("Spedito", false));
        assert!(!ordine_candidabile_produzione("Chiuso", false));
    }

    #[test]
    fn dettaglio_spedizione_usa_la_data_italiana() {
        assert_eq!(data_it("2026-08-10"), "10/08/2026");
    }

    #[test]
    fn filtro_anno_accetta_tutto_o_solo_la_data_coerente() {
        assert!(nello_anno_di_lavoro("2025-12-31", 0));
        assert!(nello_anno_di_lavoro("2025-12-31", 2025));
        assert!(!nello_anno_di_lavoro("2025-12-31", 2026));
        assert!(!nello_anno_di_lavoro("", 2025));
    }

    #[test]
    fn categoria_ignorata_resta_in_pausa_per_sei_ore() {
        let ora = 2 * PAUSA_TIPO_SUGGERIMENTO_MS;
        let recente = ora - PAUSA_TIPO_SUGGERIMENTO_MS + 1;
        let scaduto = ora - PAUSA_TIPO_SUGGERIMENTO_MS;
        assert_eq!(
            tipo_suggerimento_in_pausa("s14:rimborso:foto-1", "", recente, ora),
            Some("rimborso".into())
        );
        assert_eq!(
            tipo_suggerimento_in_pausa("s14:rimborso:foto-1", "rimborso", scaduto, ora),
            None
        );
    }

    #[test]
    fn categoria_spedizione_ignorata_non_ha_pausa_tipo() {
        let ora = 2 * PAUSA_TIPO_SUGGERIMENTO_MS;
        let recente = ora - PAUSA_TIPO_SUGGERIMENTO_MS + 1;
        assert_eq!(
            tipo_suggerimento_in_pausa("s14:spedizione:foto-1", "", recente, ora),
            None,
            "la categoria spedizione non deve andare in pausa per tipo"
        );
        assert_eq!(
            tipo_suggerimento_in_pausa("s14:spedizione:foto-1", "spedizione", recente, ora),
            None,
            "anche con tipo esplicito non deve andare in pausa per tipo"
        );
    }

    #[test]
    fn ranking_stabile_prima_per_priorita() {
        let voce = |id: &str, priorita| SuggerimentoDto {
            id: id.into(),
            tipo: "test".into(),
            titolo: String::new(),
            dettaglio: String::new(),
            azione_label: String::new(),
            priorita,
            collegamento: collegamento("/"),
            riferimento_data: String::new(),
            aggiornato_ms: 0,
        };
        let ordinati = ordina(vec![voce("b", 10), voce("c", 20), voce("a", 10)]);
        assert_eq!(
            ordinati
                .iter()
                .map(|suggerimento| suggerimento.id.as_str())
                .collect::<Vec<_>>(),
            ["c", "a", "b"]
        );
    }

    #[test]
    fn suggerisce_solo_provvigioni_maturate_strettamente_positive() {
        let riga = |id: &str, provvigione, maturato| ProvvigioneOrdineDto {
            ordine_id: id.into(),
            numero: id.into(),
            data: "2026-08-01".into(),
            cliente_id: String::new(),
            cliente_nome: String::new(),
            stato: "Spedito".into(),
            base: 10_000,
            provvigione,
            maturato,
            acconto_incassato: false,
        };
        let agente = ProvvigioneAgenteDto {
            agente_id: "a1".into(),
            agente_nome: "Agente".into(),
            provv_tipo: "percentuale".into(),
            provv_valore: 10.0,
            maturazione: "spedizione".into(),
            ordini: vec![
                riga("positiva", 1_000, true),
                riga("zero", 0, true),
                riga("negativa", -300, true),
                riga("non-maturata", 2_000, false),
            ],
            n_ordini: 4,
            totale_maturato: 700,
            totale_potenziale: 2_700,
        };

        let (liquidabili, totale) = provvigioni_positive_da_liquidare(&agente);
        assert_eq!(
            liquidabili
                .iter()
                .map(|ordine| ordine.ordine_id.as_str())
                .collect::<Vec<_>>(),
            ["positiva"]
        );
        assert_eq!(totale, 1_000);
    }

    #[test]
    fn premium_blocca_lista_e_stato_prima_di_qualsiasi_calcolo() {
        let app = tempfile::tempdir().unwrap();
        let state = AppState::init(app.path().to_path_buf()).unwrap();
        assert!(state.suggerimenti_lista_con_soglia_preventivi(0).is_err());
        assert!(state
            .suggerimenti_nascondi(&["s14:rimborso:test".into()])
            .is_err());
    }
}
