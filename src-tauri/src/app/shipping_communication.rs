//! Destinatari ed esiti degli avvisi: un collo può contenere ordini di clienti diversi.
use super::*;
use crate::projection::{Projection, Record};

pub(super) fn campo_avviso_cliente(cliente_id: &str) -> String {
    format!("avviso_cliente_{}", communication::sha256_hex(cliente_id))
}

/// Indici costruiti una sola volta per elenco, dettaglio o suggerimenti.
pub(super) struct ContestoAvvisiSpedizione {
    ordini: HashMap<String, Record>,
    clienti: HashMap<String, Record>,
    numeri: HashMap<String, String>,
    medici: HashMap<String, String>,
    agenti: HashMap<String, String>,
    conti_nomi: HashMap<String, String>,
    conti_tipi: HashMap<String, String>,
    righe: HashMap<String, Vec<Record>>,
    pagamenti: HashMap<String, Vec<Record>>,
    importi: HashMap<String, HashMap<String, i64>>,
}

impl ContestoAvvisiSpedizione {
    pub(super) fn new(p: &Projection) -> Self {
        let ordini: HashMap<_, _> = p
            .list("ordine")
            .unwrap_or_default()
            .into_iter()
            .map(|r| (r.id.clone(), r))
            .collect();
        let clienti = p
            .list("cliente")
            .unwrap_or_default()
            .into_iter()
            .map(|r| (r.id.clone(), r))
            .collect();
        let mut righe: HashMap<String, Vec<Record>> = HashMap::new();
        let mut totali: HashMap<String, i64> = HashMap::new();
        let mut spedite: HashMap<String, HashMap<String, (i64, i64)>> = HashMap::new();
        for r in p.list("riga_ordine").unwrap_or_default() {
            let oid = str_field(&r.data, "ordine_id");
            if oid.is_empty() {
                continue;
            }
            *totali.entry(oid.clone()).or_default() += 1;
            let sid = str_field(&r.data, "spedizione_id");
            if sid.is_empty() {
                continue;
            }
            let quota = spedite
                .entry(sid.clone())
                .or_default()
                .entry(oid)
                .or_default();
            quota.0 += 1;
            quota.1 += i64_field(&r.data, "prezzo") * i64_field(&r.data, "qta");
            righe.entry(sid).or_default().push(r);
        }
        let mut pagamenti: HashMap<String, Vec<Record>> = HashMap::new();
        let mut acconti: HashMap<String, i64> = HashMap::new();
        for r in p.list("pagamento").unwrap_or_default() {
            let oid = str_field(&r.data, "ordine_id");
            if str_field(&r.data, "tipo") == "acconto" {
                *acconti.entry(oid).or_default() += i64_field(&r.data, "importo");
            } else {
                pagamenti.entry(oid).or_default().push(r);
            }
        }
        for ordine in ordini.values() {
            acconti
                .entry(ordine.id.clone())
                .or_insert_with(|| i64_field(&ordine.data, "acconto"));
        }
        for rate in pagamenti.values_mut() {
            rate.sort_by_key(|r| {
                let scadenza = str_field(&r.data, "scadenza");
                (
                    if scadenza.is_empty() {
                        "9999-99-99".into()
                    } else {
                        scadenza
                    },
                    r.id.clone(),
                )
            });
        }
        let importi = spedite
            .into_iter()
            .map(|(sid, per_ordine)| {
                let quote = per_ordine
                    .into_iter()
                    .map(|(oid, (n, valore))| {
                        let importo = importo_netto_spedito(
                            n,
                            valore,
                            *totali.get(&oid).unwrap_or(&1),
                            *acconti.get(&oid).unwrap_or(&0),
                        );
                        (oid, importo)
                    })
                    .collect();
                (sid, quote)
            })
            .collect();
        Self {
            ordini,
            clienti,
            numeri: numeri_ordini(p),
            medici: nome_map(p, "medico"),
            agenti: nome_map(p, "agente"),
            conti_nomi: nome_map(p, "conto"),
            conti_tipi: p
                .list("conto")
                .unwrap_or_default()
                .into_iter()
                .map(|r| (r.id, str_field(&r.data, "tipo")))
                .collect(),
            righe,
            pagamenti,
            importi,
        }
    }

    pub(super) fn destinatari(
        &self,
        spedizione: &Record,
    ) -> Vec<DestinatarioComunicazioneSpedizioneDto> {
        let righe = self
            .righe
            .get(&spedizione.id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let mut gruppi: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for r in righe {
            let oid = str_field(&r.data, "ordine_id");
            if let Some(ordine) = self.ordini.get(&oid) {
                let cid = str_field(&ordine.data, "cliente_id");
                if !cid.is_empty() {
                    gruppi.entry(cid).or_default().insert(oid);
                }
            }
        }
        let singolo = gruppi.len() == 1;
        let mut out = Vec::new();
        for (cid, oids) in gruppi {
            let cliente = self.clienti.get(&cid);
            let campo = |nome: &str| {
                cliente
                    .map(|r| str_field(&r.data, nome))
                    .unwrap_or_default()
            };
            let ordini: Vec<_> = oids
                .iter()
                .map(|oid| {
                    let ordine = &self.ordini[oid];
                    let importo = self
                        .importi
                        .get(&spedizione.id)
                        .and_then(|m| m.get(oid))
                        .copied()
                        .unwrap_or(0);
                    OrdineComunicazioneSpedizioneDto {
                        ordine_id: oid.clone(),
                        ordine_numero: self.numeri.get(oid).cloned().unwrap_or_default(),
                        medico_nome: self
                            .medici
                            .get(&str_field(&ordine.data, "medico_id"))
                            .cloned()
                            .unwrap_or_default(),
                        agente_nome: self
                            .agenti
                            .get(&str_field(&ordine.data, "agente_id"))
                            .cloned()
                            .unwrap_or_default(),
                        pagamenti: pagamenti_spedizione_calcolati_da_records(
                            self.pagamenti.get(oid).map(Vec::as_slice).unwrap_or(&[]),
                            importo,
                            &self.conti_nomi,
                            &self.conti_tipi,
                        ),
                    }
                })
                .collect();
            let mut numeri_righe: Vec<_> = righe
                .iter()
                .filter(|r| oids.contains(&str_field(&r.data, "ordine_id")))
                .map(|r| (r.id.clone(), str_field(&r.data, "numero")))
                .collect();
            numeri_righe.sort();
            let fingerprint = format!("spedizione-cliente-v2:{}", communication::sha256_hex(
                &serde_json::to_string(&json!({
                    "id": spedizione.id, "cliente": cid, "data": str_field(&spedizione.data, "data"),
                    "corriere": str_field(&spedizione.data, "corriere_id"), "righe": numeri_righe,
                    "ordini": ordini, "anagrafica": [campo("nome"), campo("indirizzo"), campo("cap"), campo("citta"), campo("prov")],
                })).unwrap_or_default()));
            let esito = spedizione.data.get(&campo_avviso_cliente(&cid));
            let legacy = singolo
                && esito.is_none()
                && str_field(&spedizione.data, "ultimo_avviso_fingerprint")
                    == suggestions::fingerprint_spedizione_comunicazione(
                        &spedizione.id,
                        &str_field(&spedizione.data, "data"),
                        &str_field(&spedizione.data, "corriere_id"),
                        &cid,
                        righe.iter().map(|r| {
                            (
                                r.id.as_str(),
                                r.data
                                    .get("numero")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or(""),
                            )
                        }),
                    );
            let avvisato = legacy
                || esito
                    .and_then(|v| v.get("fingerprint"))
                    .and_then(serde_json::Value::as_str)
                    == Some(fingerprint.as_str());
            let ultimo_avviso_ms = if legacy {
                spedizione
                    .data
                    .get("ultimo_avviso_ms")
                    .and_then(serde_json::Value::as_u64)
            } else {
                esito
                    .and_then(|v| v.get("ms"))
                    .and_then(serde_json::Value::as_u64)
            };
            let ultimo_avviso_canale = if legacy {
                Some(str_field(&spedizione.data, "ultimo_avviso_canale"))
            } else {
                esito
                    .and_then(|v| v.get("canale"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)
            };
            out.push(DestinatarioComunicazioneSpedizioneDto {
                cliente_id: cid.clone(),
                cliente_nome: if campo("nome").is_empty() {
                    cid
                } else {
                    campo("nome")
                },
                email: campo("email"),
                telefono: campo("telefono"),
                ordini,
                fingerprint,
                avvisato,
                ultimo_avviso_ms,
                ultimo_avviso_canale,
            });
        }
        out
    }
}
