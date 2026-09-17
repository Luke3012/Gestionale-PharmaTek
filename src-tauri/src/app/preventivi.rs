//! Dominio FASE 12: preventivi e schede cliente.
//!
//! Le entità sono intenzionalmente escluse dal CRUD generico. Tutte le letture
//! sono arricchite con l'ordine corrente e tutte le scritture passano da comandi
//! atomici con controllo esplicito delle revisioni.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use ulid::Ulid;

use super::accounting::pianifica_riallineamento_pagamenti_aperti;
use super::*;

const VERSIONE_MODELLO_DOCUMENTI: u64 = 4;
const VALIDITA_DEFAULT_GIORNI: u64 = 30;
const ID_CONFIGURAZIONE_DOCUMENTI: &str = "base";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurazioneDocumentiCampi {
    pub denominazione: String,
    pub indirizzo: String,
    pub localita: String,
    pub telefono: String,
    pub email: String,
    pub sito: String,
    pub validita_default_giorni: u64,
    pub condizioni_default: String,
}

impl Default for ConfigurazioneDocumentiCampi {
    fn default() -> Self {
        Self {
            denominazione: "PharmaTek".into(),
            indirizzo: "".into(),
            localita: "".into(),
            telefono: "".into(),
            email: "demo@example.invalid".into(),
            sito: "example.invalid".into(),
            validita_default_giorni: VALIDITA_DEFAULT_GIORNI,
            condizioni_default: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurazioneDocumentiDto {
    pub revision: String,
    pub esiste: bool,
    pub aggiornata_ms: u64,
    pub versione_modello: u64,
    #[serde(flatten)]
    pub campi: ConfigurazioneDocumentiCampi,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurazioneDocumentiSalvaInput {
    #[serde(default)]
    pub revision: String,
    #[serde(flatten)]
    pub campi: ConfigurazioneDocumentiCampi,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreventivoRigaDto {
    pub id: String,
    pub revision: String,
    pub prodotto_id: String,
    pub prodotto_nome: String,
    pub categoria: String,
    pub qta: i64,
    pub prezzo: i64,
    pub paziente: String,
    pub tipo_test: String,
    pub ml: String,
    pub codice: String,
    pub formulazione: String,
    pub posologia: String,
    pub numero: String,
    pub allergeni: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UtilizzoProdottoPreventivoDto {
    pub prodotto_id: String,
    pub usi_cliente: u64,
    pub usi_medico: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreventivoDto {
    pub id: String,
    pub revision: String,
    pub esiste: bool,
    pub ordine_id: String,
    pub ordine_revision: String,
    pub ordine_numero: String,
    pub ordine_data: String,
    pub creato_ms: u64,
    pub ordine_stato: String,
    pub ordine_marcatore: String,
    pub linee: Vec<String>,
    pub cliente_id: String,
    pub cliente_nome: String,
    pub cliente_indirizzo: String,
    pub cliente_citta: String,
    pub cliente_cap: String,
    pub cliente_prov: String,
    pub spedizione_nome: String,
    pub spedizione_indirizzo: String,
    pub spedizione_citta: String,
    pub spedizione_cap: String,
    pub spedizione_prov: String,
    pub spedizione_email: String,
    pub spedizione_telefono: String,
    pub spedizione_note: String,
    pub spedizione_codice_fiscale: String,
    pub fatturazione_nome: String,
    pub fatturazione_indirizzo: String,
    pub fatturazione_citta: String,
    pub fatturazione_cap: String,
    pub fatturazione_prov: String,
    pub fatturazione_piva: String,
    pub fatturazione_codice_fiscale: String,
    pub medico_id: String,
    pub medico_nome: String,
    pub agente_id: String,
    pub agente_nome: String,
    pub email: String,
    pub telefono: String,
    pub numero_preventivo: String,
    pub validita_giorni: u64,
    pub condizioni_pagamento: String,
    pub introduzione: String,
    pub note: String,
    /// Percentuale commerciale realmente riconosciuta e mostrata nel documento.
    pub sconto_percentuale: u64,
    pub acconto: i64,
    pub totale: i64,
    pub fingerprint_corrente: String,
    pub ultima_modifica_ms: u64,
    pub ultima_modifica_utente: String,
    pub ultima_modifica_dispositivo: String,
    pub ultimo_invio_ms: u64,
    pub ultimo_invio_canale: String,
    pub ultimo_invio_fingerprint: String,
    pub ultimo_invio_comunicazione_id: String,
    pub ultimo_sollecito_ms: u64,
    /// `mai_inviato` | `inviato` | `modificato_dopo_invio`.
    pub indicazione_invio: String,
    pub versione_modello: u64,
    pub righe: Vec<PreventivoRigaDto>,
    pub pagamenti: Vec<PagamentoDto>,
    pub utilizzi_prodotti: Vec<UtilizzoProdottoPreventivoDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreventivoRigaSalvaInput {
    pub id: Option<String>,
    #[serde(default)]
    pub revision: String,
    #[serde(default)]
    pub prodotto_id: String,
    #[serde(default)]
    pub prodotto_nome: String,
    pub qta: i64,
    pub prezzo: i64,
    #[serde(default)]
    pub paziente: String,
    #[serde(default)]
    pub tipo_test: String,
    #[serde(default)]
    pub ml: String,
    #[serde(default)]
    pub codice: String,
    #[serde(default)]
    pub formulazione: String,
    #[serde(default)]
    pub posologia: String,
    #[serde(default)]
    pub numero: String,
    #[serde(default)]
    pub allergeni: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreventivoSalvaInput {
    pub ordine_id: String,
    pub ordine_revision: String,
    #[serde(default)]
    pub preventivo_revision: String,
    pub linea: String,
    pub validita_giorni: u64,
    #[serde(default)]
    pub condizioni_pagamento: String,
    #[serde(default)]
    pub introduzione: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub sconto_percentuale: u64,
    pub acconto: i64,
    pub righe: Vec<PreventivoRigaSalvaInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AliasPreventivoDto {
    pub id: String,
    pub alias: String,
    pub prodotto_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedaClienteCampi {
    pub data_ricezione: String,
    pub pazienti: String,
    pub info_spedizione: String,
    pub contatti: String,
    pub intestatario_nome: String,
    #[serde(default)]
    pub intestatario_codice_fiscale: String,
    #[serde(default)]
    pub intestatario_data_nascita: String,
    #[serde(default)]
    pub intestatario_luogo_nascita: String,
    pub intestatario_indirizzo: String,
    pub importo_totale: i64,
    pub importo_acconto: i64,
    pub data_contabile_valuta: String,
    pub modalita_saldo: String,
    pub note: String,
    pub preventivo_whatsapp: bool,
    pub preventivo_email: bool,
    pub mantenimento: bool,
    pub npp: bool,
    pub paziente_nuovo: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedaClienteDto {
    pub id: String,
    pub revision: String,
    pub esiste: bool,
    pub ordine_id: String,
    pub ordine_revision: String,
    pub ordine_numero: String,
    pub cliente_nome: String,
    pub medico_nome: String,
    pub agente_nome: String,
    pub aggiornata_ms: u64,
    pub versione_modello: u64,
    #[serde(flatten)]
    pub campi: SchedaClienteCampi,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedaClienteSalvaInput {
    pub ordine_id: String,
    pub ordine_revision: String,
    #[serde(default)]
    pub scheda_revision: String,
    #[serde(flatten)]
    pub campi: SchedaClienteCampi,
}

fn preventivo_id(ordine_id: &str) -> String {
    format!("preventivo/{ordine_id}")
}

fn scheda_id(ordine_id: &str) -> String {
    format!("scheda_cliente/{ordine_id}")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn u64_field(data: &Map<String, Value>, key: &str) -> u64 {
    data.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn configurazione_documenti(p: &crate::projection::Projection) -> ConfigurazioneDocumentiDto {
    let record = p
        .get("configurazione_documenti", ID_CONFIGURAZIONE_DOCUMENTI)
        .ok()
        .flatten()
        .filter(|record| !record.deleted);
    let campi = record
        .as_ref()
        .and_then(|record| record.data.get("config"))
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    ConfigurazioneDocumentiDto {
        revision: record
            .as_ref()
            .map(|record| record.updated_hlc.to_string())
            .unwrap_or_default(),
        esiste: record.is_some(),
        aggiornata_ms: record
            .as_ref()
            .map(|record| u64_field(&record.data, "aggiornata_ms"))
            .unwrap_or(0),
        versione_modello: VERSIONE_MODELLO_DOCUMENTI,
        campi,
    }
}

fn indirizzo_completo(data: &Map<String, Value>) -> String {
    let indirizzo = str_field(data, "indirizzo");
    let cap = str_field(data, "cap");
    let citta = str_field(data, "citta");
    let prov = str_field(data, "prov");
    let localita = [cap, citta]
        .into_iter()
        .filter(|parte| !parte.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let localita = if prov.is_empty() {
        localita
    } else if localita.is_empty() {
        format!("({prov})")
    } else {
        format!("{localita} ({prov})")
    };
    [indirizzo, localita]
        .into_iter()
        .filter(|parte| !parte.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

fn euro_breve(centesimi: i64) -> String {
    if centesimi % 100 == 0 {
        format!("{}€", centesimi / 100)
    } else {
        format!("{:.2}€", centesimi as f64 / 100.0).replace('.', ",")
    }
}

fn nota_piano_pagamenti(pagamenti: &[crate::projection::Record]) -> String {
    let validi = pagamenti
        .iter()
        .filter(|pagamento| i64_field(&pagamento.data, "importo") > 0)
        .collect::<Vec<_>>();
    if validi.is_empty() {
        return String::new();
    }
    let mut indice_rata = 0usize;
    let voci = validi
        .iter()
        .map(|pagamento| {
            let tipo = str_field(&pagamento.data, "tipo");
            let etichetta = match tipo.as_str() {
                "acconto" => "acconto".to_string(),
                "saldo" => "saldo".to_string(),
                "rata" => {
                    indice_rata += 1;
                    format!("{indice_rata}a rata")
                }
                _ => "rata".to_string(),
            };
            format!(
                "{} {}",
                euro_breve(i64_field(&pagamento.data, "importo")),
                etichetta
            )
        })
        .collect::<Vec<_>>();
    format!(
        "{} {}: {}",
        validi.len(),
        if validi.len() == 1 { "rata" } else { "rate" },
        voci.join(" - ")
    )
}

fn dati_destinatario(
    p: &crate::projection::Projection,
    ordine: &crate::projection::Record,
) -> (String, Map<String, Value>) {
    let categoria = str_field(&ordine.data, "categoria");
    let cliente_id = str_field(&ordine.data, "cliente_id");
    let medico_id = str_field(&ordine.data, "medico_id");
    let preferito = riferimento_destinatario(&categoria, &cliente_id, &medico_id);
    let data = p
        .get(preferito.0, preferito.1)
        .ok()
        .flatten()
        .filter(|record| !record.deleted)
        .map(|record| record.data)
        .unwrap_or_default();
    (preferito.1.to_string(), data)
}

fn riferimento_destinatario<'a>(
    categoria: &str,
    cliente_id: &'a str,
    medico_id: &'a str,
) -> (&'static str, &'a str) {
    if !cliente_id.is_empty() && (medico_id.is_empty() || categoria != "Diagnostica") {
        ("cliente", cliente_id)
    } else {
        ("medico", medico_id)
    }
}

fn righe_ordine(
    p: &crate::projection::Projection,
    ordine_id: &str,
) -> Vec<crate::projection::Record> {
    let mut righe = p
        .list("riga_ordine")
        .unwrap_or_default()
        .into_iter()
        .filter(|riga| str_field(&riga.data, "ordine_id") == ordine_id)
        .collect::<Vec<_>>();
    righe.sort_by(|a, b| a.created_hlc.cmp(&b.created_hlc).then(a.id.cmp(&b.id)));
    righe
}

fn righe_dto(
    p: &crate::projection::Projection,
    righe: Vec<crate::projection::Record>,
) -> Vec<PreventivoRigaDto> {
    let prodotti = p
        .list("prodotto")
        .unwrap_or_default()
        .into_iter()
        .map(|record| {
            (
                record.id,
                (
                    str_field(&record.data, "nome"),
                    str_field(&record.data, "categoria"),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    righe
        .into_iter()
        .map(|riga| {
            let prodotto_id = str_field(&riga.data, "prodotto_id");
            let (nome_catalogo, categoria) =
                prodotti.get(&prodotto_id).cloned().unwrap_or_default();
            let prodotto_nome = if nome_catalogo.is_empty() {
                str_field(&riga.data, "prodotto_nome")
            } else {
                nome_catalogo
            };
            PreventivoRigaDto {
                id: riga.id,
                revision: riga.updated_hlc.to_string(),
                prodotto_id,
                prodotto_nome,
                categoria,
                qta: i64_field(&riga.data, "qta"),
                prezzo: i64_field(&riga.data, "prezzo"),
                paziente: str_field(&riga.data, "paziente"),
                tipo_test: str_field(&riga.data, "tipo_test"),
                ml: str_field(&riga.data, "ml"),
                codice: str_field(&riga.data, "codice_laboratorio"),
                formulazione: str_field(&riga.data, "formulazione"),
                posologia: str_field(&riga.data, "posologia"),
                numero: str_field(&riga.data, "numero"),
                allergeni: riga
                    .data
                    .get("allergeni")
                    .and_then(Value::as_array)
                    .map(|valori| {
                        valori
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default(),
            }
        })
        .collect()
}

fn utilizzi_prodotti(
    p: &crate::projection::Projection,
    ordine_corrente_id: &str,
    cliente_id: &str,
    medico_id: &str,
) -> Vec<UtilizzoProdottoPreventivoDto> {
    if cliente_id.is_empty() && medico_id.is_empty() {
        return Vec::new();
    }
    let contesti = p
        .list("ordine")
        .unwrap_or_default()
        .into_iter()
        .filter(|ordine| ordine.id != ordine_corrente_id)
        .filter(|ordine| {
            !matches!(
                str_field(&ordine.data, "stato").as_str(),
                "Rifiutato" | "Annullato"
            )
        })
        .map(|ordine| {
            (
                ordine.id,
                (
                    str_field(&ordine.data, "cliente_id"),
                    str_field(&ordine.data, "medico_id"),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut per_cliente = HashMap::<String, u64>::new();
    let mut per_medico = HashMap::<String, u64>::new();
    for riga in p.list("riga_ordine").unwrap_or_default() {
        let Some((cliente_ordine, medico_ordine)) =
            contesti.get(&str_field(&riga.data, "ordine_id"))
        else {
            continue;
        };
        let prodotto_id = str_field(&riga.data, "prodotto_id");
        if prodotto_id.is_empty() {
            continue;
        }
        let utilizzi = i64_field(&riga.data, "qta").max(1) as u64;
        if !cliente_id.is_empty() && cliente_ordine == cliente_id {
            per_cliente
                .entry(prodotto_id.clone())
                .and_modify(|valore| *valore = valore.saturating_add(utilizzi))
                .or_insert(utilizzi);
        }
        if !medico_id.is_empty() && medico_ordine == medico_id {
            per_medico
                .entry(prodotto_id)
                .and_modify(|valore| *valore = valore.saturating_add(utilizzi))
                .or_insert(utilizzi);
        }
    }
    per_cliente
        .keys()
        .chain(per_medico.keys())
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|prodotto_id| UtilizzoProdottoPreventivoDto {
            usi_cliente: per_cliente.get(&prodotto_id).copied().unwrap_or_default(),
            usi_medico: per_medico.get(&prodotto_id).copied().unwrap_or_default(),
            prodotto_id,
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn fingerprint_semantico(
    ordine: &crate::projection::Record,
    linea: &str,
    validita_giorni: u64,
    condizioni_pagamento: &str,
    introduzione: &str,
    note: &str,
    sconto_percentuale: u64,
    acconto: i64,
    righe: &[PreventivoRigaSalvaInput],
) -> AppResult<String> {
    let righe = righe
        .iter()
        .map(|riga| {
            json!({
                "prodottoId": riga.prodotto_id.trim(),
                "prodottoNome": riga.prodotto_nome.trim(),
                "qta": riga.qta,
                "prezzo": riga.prezzo,
                "paziente": riga.paziente.trim(),
                "tipoTest": riga.tipo_test.trim(),
                "ml": riga.ml.trim(),
                "codice": riga.codice.trim(),
                "formulazione": riga.formulazione.trim(),
                "posologia": riga.posologia.trim(),
                "numero": riga.numero.trim(),
                "allergeni": riga.allergeni,
            })
        })
        .collect::<Vec<_>>();
    let semantica = json!({
        "versione": VERSIONE_MODELLO_DOCUMENTI,
        "ordineId": ordine.id,
        "linea": linea.trim(),
        "data": str_field(&ordine.data, "data"),
        "clienteId": str_field(&ordine.data, "cliente_id"),
        "medicoId": str_field(&ordine.data, "medico_id"),
        "agenteId": str_field(&ordine.data, "agente_id"),
        "validitaGiorni": validita_giorni,
        "condizioniPagamento": condizioni_pagamento.trim(),
        "introduzione": introduzione.trim(),
        "note": note.trim(),
        "scontoPercentuale": sconto_percentuale,
        "acconto": acconto,
        "righe": righe,
    });
    Ok(sha256_hex(&serde_json::to_vec(&semantica).map_err(es)?))
}

fn ultimo_invio_preventivo(
    p: &crate::projection::Projection,
    preventivo_id: &str,
) -> (u64, String, String, String) {
    if let Some(record) = p
        .get("preventivo", preventivo_id)
        .ok()
        .flatten()
        .filter(|record| !record.deleted)
    {
        let ultimo = u64_field(&record.data, "ultimo_invio_ms");
        if ultimo > 0 {
            return (
                ultimo,
                str_field(&record.data, "ultimo_invio_canale"),
                str_field(&record.data, "ultimo_invio_fingerprint"),
                str_field(&record.data, "ultimo_invio_comunicazione_id"),
            );
        }
    }
    (0, String::new(), String::new(), String::new())
}

fn preventivo_dto(
    p: &crate::projection::Projection,
    ordine_id: &str,
    includi_utilizzi: bool,
) -> AppResult<PreventivoDto> {
    let id = preventivo_id(ordine_id);
    let preventivo = p
        .get("preventivo", &id)
        .map_err(es)?
        .filter(|record| !record.deleted);
    let esiste = preventivo.is_some();
    let ordine = p
        .get("ordine", ordine_id)
        .map_err(es)?
        .filter(|record| {
            !record.deleted || (esiste && bool_field(&record.data, "supporto_preventivo_eliminato"))
        })
        .ok_or_else(|| "ordine non disponibile".to_string())?;
    let data_preventivo = preventivo
        .as_ref()
        .map(|record| record.data.clone())
        .unwrap_or_default();
    let righe = righe_dto(p, righe_ordine(p, ordine_id));
    let totale = righe
        .iter()
        .map(|riga| riga.qta.saturating_mul(riga.prezzo))
        .sum::<i64>();
    let numeri = numeri_ordini(p);
    let numero_ordine = numeri
        .get(ordine_id)
        .cloned()
        .filter(|numero| !numero.is_empty())
        .unwrap_or_else(|| str_field(&data_preventivo, "ordine_numero"));
    let cliente_id = str_field(&ordine.data, "cliente_id");
    let medico_id = str_field(&ordine.data, "medico_id");
    let utilizzi_prodotti = if includi_utilizzi {
        utilizzi_prodotti(p, ordine_id, cliente_id.as_str(), medico_id.as_str())
    } else {
        Vec::new()
    };
    let agente_id = str_field(&ordine.data, "agente_id");
    let cliente = p
        .get("cliente", &cliente_id)
        .ok()
        .flatten()
        .filter(|record| !record.deleted)
        .map(|record| record.data)
        .unwrap_or_default();
    let medico = p
        .get("medico", &medico_id)
        .ok()
        .flatten()
        .filter(|record| !record.deleted)
        .map(|record| record.data)
        .unwrap_or_default();
    let agente = p
        .get("agente", &agente_id)
        .ok()
        .flatten()
        .filter(|record| !record.deleted)
        .map(|record| record.data)
        .unwrap_or_default();
    let (_, destinatario) = dati_destinatario(p, &ordine);
    let fatturazione_separata = [
        "fatt_ragione_sociale",
        "fatt_indirizzo",
        "fatt_citta",
        "fatt_cap",
        "fatt_prov",
        "fatt_piva",
    ]
    .iter()
    .any(|campo| !str_field(&ordine.data, campo).is_empty());
    let fatturazione_base = if cliente.is_empty() {
        &destinatario
    } else {
        &cliente
    };
    let fatturazione_nome = if fatturazione_separata {
        str_field(&ordine.data, "fatt_ragione_sociale")
    } else {
        str_field(fatturazione_base, "nome")
    };
    let fatturazione_indirizzo = if fatturazione_separata {
        str_field(&ordine.data, "fatt_indirizzo")
    } else {
        str_field(fatturazione_base, "indirizzo")
    };
    let fatturazione_citta = if fatturazione_separata {
        str_field(&ordine.data, "fatt_citta")
    } else {
        str_field(fatturazione_base, "citta")
    };
    let fatturazione_cap = if fatturazione_separata {
        str_field(&ordine.data, "fatt_cap")
    } else {
        str_field(fatturazione_base, "cap")
    };
    let fatturazione_prov = if fatturazione_separata {
        str_field(&ordine.data, "fatt_prov")
    } else {
        str_field(fatturazione_base, "prov")
    };
    let fatturazione_piva = if fatturazione_separata {
        str_field(&ordine.data, "fatt_piva")
    } else {
        String::new()
    };
    let fatturazione_codice_fiscale = str_field(fatturazione_base, "cf");
    let conti = conti_info(p);
    let distinte = distinte_accredito(p);
    let mut pagamenti = p
        .list("pagamento")
        .unwrap_or_default()
        .into_iter()
        .filter(|record| str_field(&record.data, "ordine_id") == ordine_id)
        .collect::<Vec<_>>();
    pagamenti.sort_by(|a, b| {
        let tipo_a = str_field(&a.data, "tipo");
        let tipo_b = str_field(&b.data, "tipo");
        let prio_a = if tipo_a == "acconto" { 0 } else { 1 };
        let prio_b = if tipo_b == "acconto" { 0 } else { 1 };
        if prio_a != prio_b {
            return prio_a.cmp(&prio_b);
        }
        let da_sped_a = bool_field(&a.data, "scad_da_spedizione");
        let da_sped_b = bool_field(&b.data, "scad_da_spedizione");
        if da_sped_a && da_sped_b {
            let rel_a = i64_field(&a.data, "scad_rel_giorni");
            let rel_b = i64_field(&b.data, "scad_rel_giorni");
            if rel_a != rel_b {
                return rel_a.cmp(&rel_b);
            }
        }
        let data_chiave = |record: &crate::projection::Record| {
            if bool_field(&record.data, "saldato") {
                let d = str_field(&record.data, "data");
                if !d.is_empty() {
                    return d;
                }
            }
            let scad = str_field(&record.data, "scadenza");
            if !scad.is_empty() {
                return scad;
            }
            if bool_field(&record.data, "scad_da_spedizione") {
                let rel = i64_field(&record.data, "scad_rel_giorni");
                return format!("spedizione:{:05}", rel.max(0));
            }
            "9999-12-31".to_string()
        };
        let data_a = data_chiave(a);
        let data_b = data_chiave(b);
        data_a
            .cmp(&data_b)
            .then_with(|| {
                let rank = |tipo: &str| match tipo {
                    "saldo" => 0,
                    "rata" => 1,
                    _ => 2,
                };
                rank(&tipo_a).cmp(&rank(&tipo_b))
            })
            .then(a.created_hlc.cmp(&b.created_hlc))
            .then(a.id.cmp(&b.id))
    });
    let pagamenti = pagamenti
        .iter()
        .map(|record| pagamento_dto(record, &conti, &distinte))
        .collect::<Vec<_>>();
    // Un preventivo appartiene sempre a una sola linea. Per i documenti storici la
    // deduciamo dalla testata ordine e, solo se assente, dalla prima riga categorizzata.
    let linea = {
        let testata = str_field(&ordine.data, "categoria");
        if !testata.is_empty() {
            testata
        } else {
            righe
                .iter()
                .map(|riga| riga.categoria.clone())
                .find(|categoria| !categoria.is_empty())
                .unwrap_or_else(|| "Immunoterapia".into())
        }
    };
    let linee = vec![linea];
    let ultima_modifica_ms = u64_field(&data_preventivo, "ultima_modifica_ms");
    let configurazione = configurazione_documenti(p);
    let fingerprint_corrente = str_field(&data_preventivo, "fingerprint_corrente");
    let (ultimo_invio_ms, ultimo_invio_canale, ultimo_invio_fingerprint, comunicazione_id) =
        ultimo_invio_preventivo(p, &id);
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
    Ok(PreventivoDto {
        id,
        revision: preventivo
            .as_ref()
            .map(|record| record.updated_hlc.to_string())
            .unwrap_or_default(),
        esiste,
        ordine_id: ordine_id.to_string(),
        ordine_revision: ordine.updated_hlc.to_string(),
        ordine_numero: numero_ordine.clone(),
        ordine_data: str_field(&ordine.data, "data"),
        creato_ms: u64_field(&data_preventivo, "creato_ms"),
        ordine_stato: str_field(&ordine.data, "stato"),
        ordine_marcatore: str_field(&ordine.data, "marcatore"),
        linee,
        cliente_id,
        cliente_nome: str_field(&cliente, "nome"),
        cliente_indirizzo: str_field(&cliente, "indirizzo"),
        cliente_citta: str_field(&cliente, "citta"),
        cliente_cap: str_field(&cliente, "cap"),
        cliente_prov: str_field(&cliente, "prov"),
        spedizione_nome: str_field(&destinatario, "nome"),
        spedizione_indirizzo: str_field(&destinatario, "indirizzo"),
        spedizione_citta: str_field(&destinatario, "citta"),
        spedizione_cap: str_field(&destinatario, "cap"),
        spedizione_prov: str_field(&destinatario, "prov"),
        spedizione_email: str_field(&destinatario, "email"),
        spedizione_telefono: str_field(&destinatario, "telefono"),
        spedizione_note: str_field(&destinatario, "note_spedizione"),
        spedizione_codice_fiscale: str_field(&destinatario, "cf"),
        fatturazione_nome,
        fatturazione_indirizzo,
        fatturazione_citta,
        fatturazione_cap,
        fatturazione_prov,
        fatturazione_piva,
        fatturazione_codice_fiscale,
        medico_id,
        medico_nome: str_field(&medico, "nome"),
        agente_id,
        agente_nome: str_field(&agente, "nome"),
        email: str_field(&destinatario, "email"),
        telefono: str_field(&destinatario, "telefono"),
        numero_preventivo: format!("P-{numero_ordine}"),
        validita_giorni: data_preventivo
            .get("validita_giorni")
            .and_then(Value::as_u64)
            .unwrap_or(configurazione.campi.validita_default_giorni),
        condizioni_pagamento: data_preventivo
            .get("condizioni_pagamento")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        introduzione: data_preventivo
            .get("introduzione")
            .and_then(Value::as_str)
            .unwrap_or("Come da accordi, riportiamo di seguito la nostra proposta.")
            .to_string(),
        note: str_field(&data_preventivo, "note"),
        sconto_percentuale: u64_field(&data_preventivo, "sconto_percentuale").min(90),
        acconto: i64_field(&ordine.data, "acconto").clamp(0, totale.max(0)),
        totale,
        fingerprint_corrente,
        ultima_modifica_ms,
        ultima_modifica_utente: str_field(&data_preventivo, "ultima_modifica_utente"),
        ultima_modifica_dispositivo: str_field(&data_preventivo, "ultima_modifica_dispositivo"),
        ultimo_invio_ms,
        ultimo_invio_canale,
        ultimo_invio_fingerprint,
        ultimo_invio_comunicazione_id: comunicazione_id,
        ultimo_sollecito_ms: u64_field(&data_preventivo, "ultimo_sollecito_ms"),
        indicazione_invio: indicazione_invio.into(),
        versione_modello: VERSIONE_MODELLO_DOCUMENTI,
        righe,
        pagamenti,
        utilizzi_prodotti,
    })
}

fn valida_revision(
    corrente: &crate::projection::Record,
    attesa: &str,
    cosa: &str,
) -> AppResult<()> {
    if attesa.is_empty() || corrente.updated_hlc.to_string() != attesa {
        Err(format!(
            "{cosa} è cambiato su un'altra postazione: ricarica prima di salvare"
        ))
    } else {
        Ok(())
    }
}

fn valida_configurazione_documenti(
    mut campi: ConfigurazioneDocumentiCampi,
) -> AppResult<ConfigurazioneDocumentiCampi> {
    for valore in [
        &mut campi.denominazione,
        &mut campi.indirizzo,
        &mut campi.localita,
        &mut campi.telefono,
        &mut campi.email,
        &mut campi.sito,
        &mut campi.condizioni_default,
    ] {
        *valore = valore.trim().to_string();
        if valore.chars().any(char::is_control) {
            return Err("la configurazione documenti contiene caratteri non validi".into());
        }
    }
    if campi.denominazione.is_empty()
        || campi.email.is_empty()
        || campi.validita_default_giorni == 0
        || campi.validita_default_giorni > 365
    {
        return Err("completa denominazione, e-mail e validità dei documenti".into());
    }
    if campi.denominazione.chars().count() > 120
        || campi.indirizzo.chars().count() > 180
        || campi.localita.chars().count() > 120
        || campi.telefono.chars().count() > 80
        || campi.email.chars().count() > 180
        || campi.sito.chars().count() > 180
        || campi.condizioni_default.chars().count() > 500
    {
        return Err("uno dei campi della configurazione documenti è troppo lungo".into());
    }
    Ok(campi)
}

impl AppState {
    pub fn configurazione_documenti_get(&self) -> AppResult<ConfigurazioneDocumentiDto> {
        self.with_engine(|engine| Ok(engine.with_projection(configurazione_documenti)))
    }

    pub fn configurazione_documenti_salva(
        &self,
        input: ConfigurazioneDocumentiSalvaInput,
    ) -> AppResult<ConfigurazioneDocumentiDto> {
        crate::premium::ensure_access(self)?;
        let campi = valida_configurazione_documenti(input.campi)?;
        let revision = input.revision.trim().to_string();
        let aggiornata_ms = now_ms();
        self.with_engine(|engine| {
            engine
                .emit_built_checked(move |p| {
                    let corrente = p
                        .get("configurazione_documenti", ID_CONFIGURAZIONE_DOCUMENTI)
                        .map_err(es)?
                        .filter(|record| !record.deleted);
                    match corrente {
                        Some(ref record) => {
                            valida_revision(record, &revision, "la configurazione documenti")?
                        }
                        None if !revision.is_empty() => {
                            return Err(
                                "la configurazione documenti non esiste più: ricarica".into()
                            )
                        }
                        None => {}
                    }
                    let mut mutations = Vec::new();
                    if corrente.is_none() {
                        mutations.push(Mutation::new(
                            "configurazione_documenti",
                            ID_CONFIGURAZIONE_DOCUMENTI,
                            EventBody::Created,
                        ));
                    }
                    mutations.extend([
                        Mutation::new(
                            "configurazione_documenti",
                            ID_CONFIGURAZIONE_DOCUMENTI,
                            EventBody::FieldSet {
                                field: "config".into(),
                                value: serde_json::to_value(campi).map_err(es)?,
                            },
                        ),
                        Mutation::new(
                            "configurazione_documenti",
                            ID_CONFIGURAZIONE_DOCUMENTI,
                            EventBody::FieldSet {
                                field: "aggiornata_ms".into(),
                                value: json!(aggiornata_ms),
                            },
                        ),
                    ]);
                    Ok(mutations)
                })
                .map_err(es)?;
            Ok(engine.with_projection(configurazione_documenti))
        })
    }

    pub fn preventivo_alias_lista(&self) -> AppResult<Vec<AliasPreventivoDto>> {
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let mut result = p
                    .list("alias_preventivo")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|record| AliasPreventivoDto {
                        id: record.id,
                        alias: str_field(&record.data, "alias"),
                        prodotto_id: str_field(&record.data, "prodotto_id"),
                    })
                    .filter(|alias| !alias.alias.is_empty() && !alias.prodotto_id.is_empty())
                    .collect::<Vec<_>>();
                result.sort_by(|a, b| a.alias.cmp(&b.alias));
                result
            }))
        })
    }

    pub fn preventivo_alias_salva(
        &self,
        alias: &str,
        prodotto_id: &str,
    ) -> AppResult<AliasPreventivoDto> {
        crate::premium::ensure_access(self)?;
        let alias = alias.trim().to_lowercase();
        let prodotto_id = prodotto_id.trim().to_string();
        if alias.len() < 2 || alias.len() > 120 {
            return Err("l'alias deve contenere da 2 a 120 caratteri".into());
        }
        if prodotto_id.is_empty() {
            return Err("seleziona il prodotto associato all'alias".into());
        }
        let id = format!("alias/{}", sha256_hex(alias.as_bytes()));
        self.with_engine(|engine| {
            let id_for_save = id.clone();
            engine
                .emit_built_checked(move |p| {
                    if p.get("prodotto", &prodotto_id)
                        .map_err(es)?
                        .filter(|record| !record.deleted)
                        .is_none()
                    {
                        return Err("il prodotto associato non è più disponibile".into());
                    }
                    Ok(vec![
                        Mutation::new("alias_preventivo", id_for_save.clone(), EventBody::Created),
                        Mutation::new(
                            "alias_preventivo",
                            id_for_save.clone(),
                            EventBody::FieldSet {
                                field: "alias".into(),
                                value: json!(alias),
                            },
                        ),
                        Mutation::new(
                            "alias_preventivo",
                            id_for_save,
                            EventBody::FieldSet {
                                field: "prodotto_id".into(),
                                value: json!(prodotto_id),
                            },
                        ),
                    ])
                })
                .map_err(es)?;
            engine
                .with_projection(|p| p.get("alias_preventivo", &id).ok().flatten())
                .map(|record| AliasPreventivoDto {
                    id: record.id,
                    alias: str_field(&record.data, "alias"),
                    prodotto_id: str_field(&record.data, "prodotto_id"),
                })
                .ok_or_else(|| "alias non trovato dopo il salvataggio".to_string())
        })
    }

    pub fn preventivi_lista(&self) -> AppResult<Vec<PreventivoDto>> {
        self.with_engine(|engine| {
            engine.with_projection(|p| {
                let mut result = p
                    .list("preventivo")
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|record| {
                        let ordine_id = str_field(&record.data, "ordine_id");
                        preventivo_dto(p, &ordine_id, false).ok()
                    })
                    .collect::<Vec<_>>();
                result.sort_by(|a, b| {
                    b.creato_ms
                        .cmp(&a.creato_ms)
                        .then(b.ordine_numero.cmp(&a.ordine_numero))
                });
                Ok(result)
            })
        })
    }

    pub fn preventivo_ordini_disponibili(&self) -> AppResult<Vec<PreventivoDto>> {
        self.with_engine(|engine| {
            engine.with_projection(|p| {
                let esistenti = p
                    .list("preventivo")
                    .unwrap_or_default()
                    .into_iter()
                    .chain(p.list_deleted("preventivo").unwrap_or_default())
                    .map(|record| str_field(&record.data, "ordine_id"))
                    .collect::<HashSet<_>>();
                let mut result = p
                    .list("ordine")
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|ordine| {
                        str_field(&ordine.data, "stato") == "Nuovo"
                            && !esistenti.contains(&ordine.id)
                    })
                    .filter_map(|ordine| preventivo_dto(p, &ordine.id, false).ok())
                    .collect::<Vec<_>>();
                result.sort_by(|a, b| {
                    b.ordine_data
                        .cmp(&a.ordine_data)
                        .then(b.ordine_numero.cmp(&a.ordine_numero))
                });
                Ok(result)
            })
        })
    }

    pub fn preventivo_get(&self, ordine_id: &str) -> AppResult<PreventivoDto> {
        self.with_engine(|engine| engine.with_projection(|p| preventivo_dto(p, ordine_id, true)))
    }

    pub fn preventivo_elimina(&self, id: &str, revision: &str) -> AppResult<()> {
        let id = id.trim().to_string();
        let revision = revision.trim().to_string();
        self.with_engine(|engine| {
            engine
                .emit_built_checked(move |p| {
                    let corrente = p
                        .get("preventivo", &id)
                        .map_err(es)?
                        .filter(|record| !record.deleted)
                        .ok_or_else(|| "il preventivo non è più disponibile".to_string())?;
                    valida_revision(&corrente, &revision, "Il preventivo")?;
                    Ok(vec![Mutation::new("preventivo", id, EventBody::Deleted)])
                })
                .map_err(es)?;
            Ok(())
        })
    }

    pub fn preventivo_marca_inviato_manuale(
        &self,
        ordine_id: &str,
        revision: &str,
    ) -> AppResult<PreventivoDto> {
        let ordine_id = ordine_id.trim().to_string();
        let revision = revision.trim().to_string();
        let id = preventivo_id(&ordine_id);
        let now = now_ms();
        self.with_engine(|engine| {
            let id_for_mutation = id.clone();
            engine
                .emit_built_checked(move |p| {
                    let corrente = p
                        .get("preventivo", &id_for_mutation)
                        .map_err(es)?
                        .filter(|record| !record.deleted)
                        .ok_or_else(|| "il preventivo non è più disponibile".to_string())?;
                    if !revision.is_empty() {
                        valida_revision(&corrente, &revision, "Il preventivo")?;
                    }
                    let fingerprint = str_field(&corrente.data, "fingerprint_corrente");
                    Ok(vec![
                        Mutation::new(
                            "preventivo",
                            id_for_mutation.clone(),
                            EventBody::FieldSet {
                                field: "ultimo_invio_ms".into(),
                                value: json!(now),
                            },
                        ),
                        Mutation::new(
                            "preventivo",
                            id_for_mutation.clone(),
                            EventBody::FieldSet {
                                field: "ultimo_invio_canale".into(),
                                value: json!("manuale"),
                            },
                        ),
                        Mutation::new(
                            "preventivo",
                            id_for_mutation.clone(),
                            EventBody::FieldSet {
                                field: "ultimo_invio_fingerprint".into(),
                                value: json!(fingerprint),
                            },
                        ),
                    ])
                })
                .map_err(es)?;
            engine.with_projection(|p| preventivo_dto(p, &ordine_id, true))
        })
    }

    pub fn preventivo_ripristina(&self, id: &str) -> AppResult<()> {
        self.with_engine(|engine| {
            let id = id.to_string();
            engine
                .emit_built_checked(move |p| {
                    let preventivo = p
                        .get("preventivo", &id)
                        .map_err(es)?
                        .filter(|record| record.deleted)
                        .ok_or_else(|| "il preventivo non è nel Cestino".to_string())?;
                    let ordine_id = str_field(&preventivo.data, "ordine_id");
                    let ordine = p.get("ordine", &ordine_id).map_err(es)?.ok_or_else(|| {
                        "l’ordine di supporto del preventivo non è più disponibile".to_string()
                    })?;
                    if ordine.deleted && bool_field(&preventivo.data, "eliminato_con_ordine") {
                        return Err(
                            "ripristina l’ordine: il preventivo verrà recuperato insieme".into(),
                        );
                    }
                    let mut mutations = vec![Mutation::new("preventivo", id, EventBody::Restored)];
                    if ordine.deleted {
                        // Il preventivo era già nel Cestino quando l'ordine è stato
                        // eliminato. L'ordine non torna nel Giornaliero e scompare
                        // definitivamente dal Cestino, ma conserva internamente i dati
                        // condivisi necessari al documento ripristinato.
                        mutations.push(Mutation::new(
                            "ordine",
                            ordine_id,
                            EventBody::FieldSet {
                                field: "supporto_preventivo_eliminato".into(),
                                value: json!(true),
                            },
                        ));
                    }
                    Ok(mutations)
                })
                .map_err(es)?;
            Ok(())
        })
    }

    pub fn preventivo_purge(&self, id: &str) -> AppResult<()> {
        self.with_engine(|engine| {
            let id = id.to_string();
            engine
                .emit_built_checked(move |p| {
                    let preventivo = p
                        .get("preventivo", &id)
                        .map_err(es)?
                        .ok_or_else(|| "preventivo non disponibile".to_string())?;
                    let ordine_id = str_field(&preventivo.data, "ordine_id");
                    let supporto_eliminato =
                        p.get("ordine", &ordine_id)
                            .map_err(es)?
                            .is_some_and(|ordine| {
                                ordine.deleted
                                    && bool_field(&ordine.data, "supporto_preventivo_eliminato")
                            });
                    let mut mutations = vec![Mutation::new("preventivo", id, EventBody::Purged)];
                    if supporto_eliminato {
                        mutations.push(Mutation::new(
                            "ordine",
                            ordine_id.clone(),
                            EventBody::Purged,
                        ));
                        for entity in ["riga_ordine", "pagamento", "rimborso", "promemoria"] {
                            mutations.extend(
                                p.list(entity)
                                    .unwrap_or_default()
                                    .into_iter()
                                    .chain(p.list_deleted(entity).unwrap_or_default())
                                    .filter(|record| {
                                        str_field(&record.data, "ordine_id") == ordine_id
                                    })
                                    .map(|record| {
                                        Mutation::new(entity, record.id, EventBody::Purged)
                                    }),
                            );
                        }
                        if let Some(scheda) = p
                            .get("scheda_cliente", &scheda_id(&ordine_id))
                            .map_err(es)?
                        {
                            mutations.push(Mutation::new(
                                "scheda_cliente",
                                scheda.id,
                                EventBody::Purged,
                            ));
                        }
                    }
                    Ok(mutations)
                })
                .map_err(es)?;
            Ok(())
        })
    }

    pub fn preventivo_salva(&self, input: PreventivoSalvaInput) -> AppResult<PreventivoDto> {
        if input.ordine_id.trim().is_empty() {
            return Err("ordine non specificato".into());
        }
        if input.validita_giorni == 0 || input.validita_giorni > 365 {
            return Err("la validità deve essere compresa fra 1 e 365 giorni".into());
        }
        if input.sconto_percentuale > 90 {
            return Err("lo sconto commerciale deve essere compreso fra 0% e 90%".into());
        }
        let linea = input.linea.trim();
        if linea.is_empty() {
            return Err("seleziona la linea del preventivo".into());
        }
        if input.righe.is_empty() {
            return Err("inserisci almeno un prodotto nel preventivo".into());
        }
        for riga in &input.righe {
            if riga.qta <= 0 {
                return Err("la quantità di ogni prodotto deve essere positiva".into());
            }
            if riga.prezzo < 0 {
                return Err("il prezzo di un prodotto non può essere negativo".into());
            }
            if riga.prodotto_id.trim().is_empty() && riga.prodotto_nome.trim().is_empty() {
                return Err("ogni riga deve indicare un prodotto".into());
            }
            if riga.allergeni.len() > 10 {
                return Err("ogni riga può contenere al massimo 10 allergeni o ceppi".into());
            }
        }
        let identity = self
            .whoami()
            .ok_or("seleziona un utente prima di salvare il preventivo")?;
        let ordine_id = input.ordine_id.trim().to_string();
        let id = preventivo_id(&ordine_id);
        let now = now_ms();
        self.with_engine(|engine| {
            let ordine_id_for_save = ordine_id.clone();
            engine
                .emit_built_checked(move |p| {
                    let ordine_id = ordine_id_for_save;
                    let ordine = p
                        .get("ordine", &ordine_id)
                        .map_err(es)?
                        .ok_or_else(|| "l'ordine non è più disponibile".to_string())?;

                    let preventivo = p
                        .get("preventivo", &id)
                        .map_err(es)?
                        .filter(|record| !record.deleted);
                    if ordine.deleted
                        && !(preventivo.is_some()
                            && bool_field(&ordine.data, "supporto_preventivo_eliminato"))
                    {
                        return Err("l'ordine non è più disponibile".into());
                    }
                    valida_revision(&ordine, &input.ordine_revision, "L'ordine")?;
                    match preventivo.as_ref() {
                        Some(record) => {
                            valida_revision(record, &input.preventivo_revision, "Il preventivo")?;
                        }
                        None if !input.preventivo_revision.is_empty() => {
                            return Err(
                                "il preventivo non esiste più: ricarica prima di salvare".into()
                            );
                        }
                        None => {}
                    }

                    let correnti = righe_ordine(p, &ordine_id);
                    let correnti_by_id = correnti
                        .iter()
                        .map(|riga| (riga.id.clone(), riga))
                        .collect::<HashMap<_, _>>();
                    let mut desiderate_esistenti = HashSet::new();
                    let mut righe_con_id = Vec::with_capacity(input.righe.len());
                    for riga in &input.righe {
                        if let Some(riga_id) = riga.id.as_ref() {
                            if !desiderate_esistenti.insert(riga_id.clone()) {
                                return Err("la stessa riga compare più volte".into());
                            }
                            let corrente = correnti_by_id.get(riga_id).ok_or_else(|| {
                                "una riga non appartiene più all'ordine".to_string()
                            })?;
                            valida_revision(corrente, &riga.revision, "Una riga dell'ordine")?;
                        } else if !riga.revision.is_empty() {
                            return Err("una nuova riga non può avere una revisione".into());
                        }
                        if !riga.prodotto_id.trim().is_empty() {
                            let prodotto = p
                                .get("prodotto", riga.prodotto_id.trim())
                                .map_err(es)?
                                .filter(|record| !record.deleted)
                                .ok_or_else(|| {
                                    "un prodotto selezionato non è più disponibile".to_string()
                                })?;
                            if str_field(&prodotto.data, "categoria") != input.linea.trim() {
                                return Err(format!(
                                    "tutti i prodotti devono appartenere alla linea {}",
                                    input.linea.trim()
                                ));
                            }
                        }
                        righe_con_id.push((
                            riga.id
                                .clone()
                                .unwrap_or_else(|| Ulid::generate().to_string()),
                            riga.clone(),
                        ));
                    }
                    for corrente in &correnti {
                        if !desiderate_esistenti.contains(&corrente.id)
                            && riga_spedita(&corrente.data)
                        {
                            return Err(
                                "una riga rimossa risulta già spedita: ricarica l'ordine".into()
                            );
                        }
                    }

                    let totale = input
                        .righe
                        .iter()
                        .map(|riga| riga.qta.saturating_mul(riga.prezzo))
                        .sum::<i64>();
                    if input.acconto < 0 || input.acconto > totale {
                        return Err("l'acconto deve essere compreso fra zero e il totale".into());
                    }
                    let fingerprint = fingerprint_semantico(
                        &ordine,
                        &input.linea,
                        input.validita_giorni,
                        &input.condizioni_pagamento,
                        &input.introduzione,
                        &input.note,
                        input.sconto_percentuale,
                        input.acconto,
                        &input.righe,
                    )?;
                    let precedente_fingerprint = preventivo
                        .as_ref()
                        .map(|record| str_field(&record.data, "fingerprint_corrente"))
                        .unwrap_or_default();
                    let modificato = precedente_fingerprint != fingerprint;
                    let mut mutations = Vec::new();

                    if preventivo.is_none() {
                        let numero_ordine = numeri_ordini(p)
                            .get(&ordine_id)
                            .cloned()
                            .unwrap_or_default();
                        mutations.push(Mutation::new("preventivo", id.clone(), EventBody::Created));
                        mutations.push(Mutation::new(
                            "preventivo",
                            id.clone(),
                            EventBody::FieldSet {
                                field: "ordine_id".into(),
                                value: json!(ordine_id),
                            },
                        ));
                        mutations.push(Mutation::new(
                            "preventivo",
                            id.clone(),
                            EventBody::FieldSet {
                                field: "creato_ms".into(),
                                value: json!(now),
                            },
                        ));
                        mutations.push(Mutation::new(
                            "preventivo",
                            id.clone(),
                            EventBody::FieldSet {
                                field: "ordine_numero".into(),
                                value: json!(numero_ordine),
                            },
                        ));
                    }

                    let campi_preventivo = [
                        ("validita_giorni", json!(input.validita_giorni)),
                        (
                            "condizioni_pagamento",
                            json!(input.condizioni_pagamento.trim()),
                        ),
                        ("introduzione", json!(input.introduzione.trim())),
                        ("note", json!(input.note.trim())),
                        ("sconto_percentuale", json!(input.sconto_percentuale)),
                        ("fingerprint_corrente", json!(fingerprint)),
                        ("versione_modello", json!(VERSIONE_MODELLO_DOCUMENTI)),
                    ];
                    for (field, value) in campi_preventivo {
                        let invariato = preventivo
                            .as_ref()
                            .and_then(|record| record.data.get(field))
                            == Some(&value);
                        if !invariato {
                            mutations.push(Mutation::new(
                                "preventivo",
                                id.clone(),
                                EventBody::FieldSet {
                                    field: field.into(),
                                    value,
                                },
                            ));
                        }
                    }
                    if modificato || preventivo.is_none() {
                        for (field, value) in [
                            ("ultima_modifica_ms", json!(now)),
                            ("ultima_modifica_utente", json!(identity.nome)),
                            ("ultima_modifica_dispositivo", json!(identity.device_nome)),
                        ] {
                            mutations.push(Mutation::new(
                                "preventivo",
                                id.clone(),
                                EventBody::FieldSet {
                                    field: field.into(),
                                    value,
                                },
                            ));
                        }
                    }

                    if i64_field(&ordine.data, "acconto") != input.acconto {
                        mutations.push(Mutation::new(
                            "ordine",
                            ordine_id.clone(),
                            EventBody::FieldSet {
                                field: "acconto".into(),
                                value: json!(input.acconto),
                            },
                        ));
                    }
                    if str_field(&ordine.data, "categoria") != input.linea.trim() {
                        mutations.push(Mutation::new(
                            "ordine",
                            ordine_id.clone(),
                            EventBody::FieldSet {
                                field: "categoria".into(),
                                value: json!(input.linea.trim()),
                            },
                        ));
                    }
                    for (riga_id, input_riga) in righe_con_id {
                        let corrente = correnti_by_id.get(&riga_id);
                        if corrente.is_none() {
                            mutations.push(Mutation::new(
                                "riga_ordine",
                                riga_id.clone(),
                                EventBody::Created,
                            ));
                            mutations.push(Mutation::new(
                                "riga_ordine",
                                riga_id.clone(),
                                EventBody::FieldSet {
                                    field: "ordine_id".into(),
                                    value: json!(ordine_id),
                                },
                            ));
                            mutations.push(Mutation::new(
                                "riga_ordine",
                                riga_id.clone(),
                                EventBody::FieldSet {
                                    field: "stato_riga".into(),
                                    value: json!("da_spedire"),
                                },
                            ));
                        }
                        for (field, value) in [
                            ("prodotto_id", json!(input_riga.prodotto_id.trim())),
                            ("prodotto_nome", json!(input_riga.prodotto_nome.trim())),
                            ("qta", json!(input_riga.qta)),
                            ("prezzo", json!(input_riga.prezzo)),
                            ("paziente", json!(input_riga.paziente.trim())),
                            ("tipo_test", json!(input_riga.tipo_test.trim())),
                            ("ml", json!(input_riga.ml.trim())),
                            ("codice_laboratorio", json!(input_riga.codice.trim())),
                            ("formulazione", json!(input_riga.formulazione.trim())),
                            ("posologia", json!(input_riga.posologia.trim())),
                            ("numero", json!(input_riga.numero.trim())),
                            (
                                "allergeni",
                                json!(input_riga
                                    .allergeni
                                    .iter()
                                    .map(|valore| valore.trim())
                                    .filter(|valore| !valore.is_empty())
                                    .collect::<Vec<_>>()),
                            ),
                        ] {
                            let invariato =
                                corrente.and_then(|record| record.data.get(field)) == Some(&value);
                            if !invariato {
                                mutations.push(Mutation::new(
                                    "riga_ordine",
                                    riga_id.clone(),
                                    EventBody::FieldSet {
                                        field: field.into(),
                                        value,
                                    },
                                ));
                            }
                        }
                    }
                    for corrente in correnti {
                        if !desiderate_esistenti.contains(&corrente.id) {
                            mutations.push(Mutation::new(
                                "riga_ordine",
                                corrente.id,
                                EventBody::Purged,
                            ));
                        }
                    }
                    mutations.extend(pianifica_riallineamento_pagamenti_aperti(
                        p,
                        &ordine_id,
                        Some(totale),
                        Some(input.acconto),
                    )?);
                    Ok(mutations)
                })
                .map_err(es)?;
            engine.with_projection(|p| preventivo_dto(p, &ordine_id, true))
        })
    }

    pub fn scheda_cliente_get(&self, ordine_id: &str) -> AppResult<SchedaClienteDto> {
        self.with_engine(|engine| engine.with_projection(|p| scheda_cliente_dto(p, ordine_id)))
    }

    pub fn scheda_cliente_salva(
        &self,
        input: SchedaClienteSalvaInput,
    ) -> AppResult<SchedaClienteDto> {
        let ordine_id = input.ordine_id.trim().to_string();
        if ordine_id.is_empty() {
            return Err("ordine non specificato".into());
        }
        if input.campi.importo_totale < 0
            || input.campi.importo_acconto < 0
            || input.campi.importo_acconto > input.campi.importo_totale
        {
            return Err("gli importi della scheda cliente non sono coerenti".into());
        }
        let id = scheda_id(&ordine_id);
        let now = now_ms();
        self.with_engine(|engine| {
            let ordine_id_for_save = ordine_id.clone();
            engine
                .emit_built_checked(move |p| {
                    let ordine_id = ordine_id_for_save;
                    let ordine = p
                        .get("ordine", &ordine_id)
                        .map_err(es)?
                        .filter(|record| !record.deleted)
                        .ok_or_else(|| "l'ordine non è più disponibile".to_string())?;
                    valida_revision(&ordine, &input.ordine_revision, "L'ordine")?;
                    let scheda = p
                        .get("scheda_cliente", &id)
                        .map_err(es)?
                        .filter(|record| !record.deleted);
                    match scheda.as_ref() {
                        Some(record) => {
                            valida_revision(record, &input.scheda_revision, "La scheda cliente")?
                        }
                        None if !input.scheda_revision.is_empty() => {
                            return Err(
                                "la scheda cliente non esiste più: ricarica prima di salvare"
                                    .into(),
                            )
                        }
                        None => {}
                    }
                    let mut mutations = Vec::new();
                    if scheda.is_none() {
                        mutations.push(Mutation::new(
                            "scheda_cliente",
                            id.clone(),
                            EventBody::Created,
                        ));
                        mutations.push(Mutation::new(
                            "scheda_cliente",
                            id.clone(),
                            EventBody::FieldSet {
                                field: "ordine_id".into(),
                                value: json!(ordine_id),
                            },
                        ));
                    }
                    let mut fields = serde_json::to_value(&input.campi)
                        .map_err(es)?
                        .as_object()
                        .cloned()
                        .ok_or("contenuto della scheda cliente non valido".to_string())?;
                    fields.insert("aggiornata_ms".into(), json!(now));
                    fields.insert("versione_modello".into(), json!(VERSIONE_MODELLO_DOCUMENTI));
                    for (field, value) in fields {
                        if scheda.as_ref().and_then(|record| record.data.get(&field))
                            != Some(&value)
                        {
                            mutations.push(Mutation::new(
                                "scheda_cliente",
                                id.clone(),
                                EventBody::FieldSet { field, value },
                            ));
                        }
                    }
                    Ok(mutations)
                })
                .map_err(es)?;
            engine.with_projection(|p| scheda_cliente_dto(p, &ordine_id))
        })
    }
}

fn scheda_cliente_dto(
    p: &crate::projection::Projection,
    ordine_id: &str,
) -> AppResult<SchedaClienteDto> {
    let ordine = p
        .get("ordine", ordine_id)
        .map_err(es)?
        .filter(|record| !record.deleted)
        .ok_or_else(|| "ordine non disponibile".to_string())?;
    let id = scheda_id(ordine_id);
    let scheda = p
        .get("scheda_cliente", &id)
        .map_err(es)?
        .filter(|record| !record.deleted);
    let esiste = scheda.is_some();
    let righe = righe_ordine(p, ordine_id);
    let totale = righe
        .iter()
        .map(|riga| i64_field(&riga.data, "qta").saturating_mul(i64_field(&riga.data, "prezzo")))
        .sum::<i64>();
    let pazienti_righe = righe
        .iter()
        .map(|riga| str_field(&riga.data, "paziente"))
        .filter(|paziente| !paziente.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join(", ");
    let cliente_id = str_field(&ordine.data, "cliente_id");
    let cliente = p
        .get("cliente", &cliente_id)
        .ok()
        .flatten()
        .filter(|record| !record.deleted)
        .map(|record| record.data)
        .unwrap_or_default();
    let (_, destinatario) = dati_destinatario(p, &ordine);
    let intestatario_ordine = str_field(&destinatario, "nome");
    let pazienti = if intestatario_ordine.is_empty() {
        pazienti_righe
    } else {
        intestatario_ordine
    };
    let medico_nome = p
        .get("medico", &str_field(&ordine.data, "medico_id"))
        .ok()
        .flatten()
        .filter(|record| !record.deleted)
        .map(|record| str_field(&record.data, "nome"))
        .unwrap_or_default();
    let agente_nome = p
        .get("agente", &str_field(&ordine.data, "agente_id"))
        .ok()
        .flatten()
        .filter(|record| !record.deleted)
        .map(|record| str_field(&record.data, "nome"))
        .unwrap_or_default();
    let contatti = [
        str_field(&destinatario, "telefono"),
        str_field(&destinatario, "email"),
    ]
    .into_iter()
    .filter(|parte| !parte.is_empty())
    .collect::<Vec<_>>()
    .join(" · ");
    let note_spedizione = str_field(&destinatario, "note_spedizione");
    let info_spedizione = [indirizzo_completo(&destinatario), note_spedizione]
        .into_iter()
        .filter(|parte| !parte.is_empty())
        .collect::<Vec<_>>()
        .join(" — ");
    let fatt_nome = str_field(&ordine.data, "fatt_ragione_sociale");
    let fatt_indirizzo = str_field(&ordine.data, "fatt_indirizzo");
    let fatt_citta = str_field(&ordine.data, "fatt_citta");
    let fatt_cap = str_field(&ordine.data, "fatt_cap");
    let fatt_prov = str_field(&ordine.data, "fatt_prov");
    let fatt_codice_fiscale = str_field(&ordine.data, "fatt_piva");
    let intestatario_indirizzo = {
        let localita = [fatt_cap, fatt_citta]
            .into_iter()
            .filter(|parte| !parte.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        let localita = if fatt_prov.is_empty() {
            localita
        } else {
            format!("{localita} ({fatt_prov})")
        };
        [fatt_indirizzo, localita]
            .into_iter()
            .filter(|parte| !parte.is_empty())
            .collect::<Vec<_>>()
            .join(", ")
    };
    let mut pagamenti = p
        .list("pagamento")
        .unwrap_or_default()
        .into_iter()
        .filter(|record| str_field(&record.data, "ordine_id") == ordine_id)
        .collect::<Vec<_>>();
    pagamenti.sort_by(|a, b| a.created_hlc.cmp(&b.created_hlc).then(a.id.cmp(&b.id)));
    let mut data_contabile = String::new();
    let mut importo_acconto = 0i64;
    let mut modalita_saldo = "bonifico".to_string();
    for pagamento in &pagamenti {
        let tipo = str_field(&pagamento.data, "tipo");
        if tipo == "acconto" && bool_field(&pagamento.data, "saldato") {
            let data = str_field(&pagamento.data, "data");
            if data > data_contabile {
                data_contabile = data;
            }
            importo_acconto =
                importo_acconto.saturating_add(i64_field(&pagamento.data, "importo").max(0));
        }
        if matches!(tipo.as_str(), "saldo" | "rata") {
            modalita_saldo = match str_field(&pagamento.data, "conto_id").as_str() {
                CONTO_CONTRASSEGNO => "contrassegno",
                CONTO_ASSEGNO => "assegno",
                _ => "bonifico",
            }
            .into();
        }
    }
    let nota_rate = nota_piano_pagamenti(&pagamenti);
    let note_ordine = str_field(&ordine.data, "note");
    let note = [note_ordine, nota_rate]
        .into_iter()
        .filter(|valore| !valore.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    let preventivo = preventivo_id(ordine_id);
    let preventivo_data = p
        .get("preventivo", &preventivo)
        .ok()
        .flatten()
        .filter(|record| !record.deleted)
        .map(|record| record.data)
        .unwrap_or_default();
    let preventivo_whatsapp = bool_field(&preventivo_data, "preventivo_whatsapp_inviato");
    let preventivo_email = bool_field(&preventivo_data, "preventivo_email_inviato");
    let prefill = SchedaClienteCampi {
        data_ricezione: str_field(&ordine.data, "data"),
        pazienti,
        info_spedizione,
        contatti,
        intestatario_nome: fatt_nome,
        intestatario_codice_fiscale: fatt_codice_fiscale,
        intestatario_data_nascita: String::new(),
        intestatario_luogo_nascita: String::new(),
        intestatario_indirizzo,
        importo_totale: totale,
        importo_acconto: importo_acconto.clamp(0, totale.max(0)),
        data_contabile_valuta: data_contabile,
        modalita_saldo,
        note,
        preventivo_whatsapp,
        preventivo_email,
        mantenimento: false,
        npp: false,
        paziente_nuovo: false,
    };
    let mut campi = if let Some(record) = scheda.as_ref() {
        serde_json::from_value(Value::Object(record.data.clone())).map_err(es)?
    } else {
        prefill.clone()
    };
    // Questi due valori descrivono un incasso reale, non il piano concordato: restano
    // quindi sempre derivati dal libro mastro, anche su una scheda già salvata.
    campi.importo_acconto = prefill.importo_acconto;
    campi.data_contabile_valuta = prefill.data_contabile_valuta;
    // Paziente e intestatario arrivano dall'ordine: non devono restare congelati nella
    // copia della scheda né ricadere sui dati anagrafici generici del cliente.
    if campi.pazienti.trim().is_empty() && !prefill.pazienti.is_empty() {
        campi.pazienti = prefill.pazienti.clone();
    }
    campi.intestatario_codice_fiscale = prefill.intestatario_codice_fiscale.clone();
    let cliente_nome = str_field(&cliente, "nome");
    let cliente_indirizzo = indirizzo_completo(&cliente);
    if campi.intestatario_nome.trim().is_empty() || campi.intestatario_nome == cliente_nome {
        campi.intestatario_nome = prefill.intestatario_nome.clone();
    }
    if campi.intestatario_indirizzo.trim().is_empty()
        || campi.intestatario_indirizzo == cliente_indirizzo
    {
        campi.intestatario_indirizzo = prefill.intestatario_indirizzo.clone();
    }
    if campi.modalita_saldo.trim().is_empty() {
        campi.modalita_saldo = prefill.modalita_saldo;
    }
    let numeri = numeri_ordini(p);
    Ok(SchedaClienteDto {
        id,
        revision: scheda
            .as_ref()
            .map(|record| record.updated_hlc.to_string())
            .unwrap_or_default(),
        esiste,
        ordine_id: ordine_id.into(),
        ordine_revision: ordine.updated_hlc.to_string(),
        ordine_numero: numeri.get(ordine_id).cloned().unwrap_or_default(),
        cliente_nome: str_field(&cliente, "nome"),
        medico_nome,
        agente_nome,
        aggiornata_ms: scheda
            .as_ref()
            .map(|record| u64_field(&record.data, "aggiornata_ms"))
            .unwrap_or(0),
        versione_modello: VERSIONE_MODELLO_DOCUMENTI,
        campi,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn destinatario_unico_rispetta_la_scelta_e_preserva_gli_ordini_esistenti() {
        assert_eq!(
            riferimento_destinatario("Diagnostica", "cliente-1", ""),
            ("cliente", "cliente-1")
        );
        assert_eq!(
            riferimento_destinatario("Immunoterapia", "", "medico-1"),
            ("medico", "medico-1")
        );
        assert_eq!(
            riferimento_destinatario("Diagnostica", "cliente-1", "medico-1"),
            ("medico", "medico-1")
        );
        assert_eq!(
            riferimento_destinatario("Immunoterapia", "cliente-1", "medico-1"),
            ("cliente", "cliente-1")
        );
    }

    fn campi(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.clone()))
            .collect()
    }

    fn stato_test(premium: bool) -> (tempfile::TempDir, tempfile::TempDir, AppState) {
        let app = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        if premium {
            fs::write(app.path().join("premium.json"), br#"{"enabled":true}"#).unwrap();
        }
        let state = AppState::init(app.path().to_path_buf()).unwrap();
        state.open_data_dir(data.path().to_str().unwrap()).unwrap();
        state
            .finish_onboarding(FinishOnboarding {
                data_dir: data.path().to_string_lossy().into_owned(),
                mode: "create".into(),
                user_id: Some(Ulid::generate().to_string()),
                nome: "Tester preventivi".into(),
                avatar_tipo: "iniziali".into(),
                avatar_valore: String::new(),
            })
            .unwrap();
        (app, data, state)
    }

    fn crea_ordine(state: &AppState) -> OrdineSalvaBaseResult {
        state
            .ordine_salva_base(OrdineSalvaBaseInput {
                id: None,
                rimborso_extra: None,
                expected_righe: Vec::new(),
                fields: campi(&[
                    ("stato", json!("Nuovo")),
                    ("data", json!("2026-07-26")),
                    ("acconto", json!(0)),
                ]),
                righe: vec![OrdineSalvaRigaInput {
                    id: None,
                    fields: campi(&[
                        ("prodotto_nome", json!("Preparato personalizzato")),
                        ("qta", json!(1)),
                        ("prezzo", json!(10_000)),
                        ("paziente", json!("Mario Rossi")),
                    ]),
                }],
            })
            .unwrap()
    }

    fn input_preventivo(preventivo: &PreventivoDto, note: &str) -> PreventivoSalvaInput {
        PreventivoSalvaInput {
            ordine_id: preventivo.ordine_id.clone(),
            ordine_revision: preventivo.ordine_revision.clone(),
            preventivo_revision: preventivo.revision.clone(),
            linea: preventivo
                .linee
                .first()
                .cloned()
                .unwrap_or_else(|| "Immunoterapia".into()),
            validita_giorni: preventivo.validita_giorni,
            condizioni_pagamento: preventivo.condizioni_pagamento.clone(),
            introduzione: preventivo.introduzione.clone(),
            note: note.into(),
            sconto_percentuale: preventivo.sconto_percentuale,
            acconto: preventivo.acconto,
            righe: preventivo
                .righe
                .iter()
                .map(|riga| PreventivoRigaSalvaInput {
                    id: Some(riga.id.clone()),
                    revision: riga.revision.clone(),
                    prodotto_id: riga.prodotto_id.clone(),
                    prodotto_nome: riga.prodotto_nome.clone(),
                    qta: riga.qta,
                    prezzo: riga.prezzo,
                    paziente: riga.paziente.clone(),
                    tipo_test: riga.tipo_test.clone(),
                    ml: riga.ml.clone(),
                    codice: riga.codice.clone(),
                    formulazione: riga.formulazione.clone(),
                    posologia: riga.posologia.clone(),
                    numero: riga.numero.clone(),
                    allergeni: riga.allergeni.clone(),
                })
                .collect(),
        }
    }

    #[test]
    fn id_documenti_sono_deterministici_per_ordine() {
        assert_eq!(preventivo_id("ORD-1"), "preventivo/ORD-1");
        assert_eq!(scheda_id("ORD-1"), "scheda_cliente/ORD-1");
    }

    #[test]
    fn marcatura_manuale_registra_invio_e_rifiuta_revisioni_stantie() {
        let (_app, _data, state) = stato_test(true);
        let ordine = crea_ordine(&state);
        let prefill = state.preventivo_get(&ordine.id).unwrap();
        let salvato = state
            .preventivo_salva(input_preventivo(&prefill, "Da esportare"))
            .unwrap();

        let aggiornato = state
            .preventivo_marca_inviato_manuale(&ordine.id, &salvato.revision)
            .unwrap();
        assert!(aggiornato.ultimo_invio_ms > 0);
        assert_eq!(aggiornato.ultimo_invio_canale, "manuale");
        assert_eq!(
            aggiornato.ultimo_invio_fingerprint,
            aggiornato.fingerprint_corrente
        );
        assert_eq!(aggiornato.indicazione_invio, "inviato");
        assert!(state
            .preventivo_marca_inviato_manuale(&ordine.id, &salvato.revision)
            .is_err());
    }

    #[test]
    fn indirizzo_non_lascia_separatori_vuoti() {
        let mut data = Map::new();
        data.insert("indirizzo".into(), json!("Via Roma 1"));
        data.insert("cap".into(), json!("20100"));
        data.insert("citta".into(), json!("Milano"));
        data.insert("prov".into(), json!("MI"));
        assert_eq!(indirizzo_completo(&data), "Via Roma 1, 20100 Milano (MI)");
    }

    #[test]
    fn configurazione_documenti_ha_default_e_controllo_revisione() {
        let (_app, _data, state) = stato_test(true);
        let iniziale = state.configurazione_documenti_get().unwrap();
        assert!(!iniziale.esiste);
        assert_eq!(iniziale.campi.denominazione, "PharmaTek");
        assert_eq!(iniziale.campi.sito, "example.invalid");
        assert_eq!(iniziale.campi.validita_default_giorni, 30);
        let salvata = state
            .configurazione_documenti_salva(ConfigurazioneDocumentiSalvaInput {
                revision: String::new(),
                campi: ConfigurazioneDocumentiCampi {
                    telefono: "02 123456".into(),
                    ..iniziale.campi
                },
            })
            .unwrap();
        assert!(salvata.esiste);
        assert_eq!(salvata.campi.telefono, "02 123456");
        assert!(state
            .configurazione_documenti_salva(ConfigurazioneDocumentiSalvaInput {
                revision: "revisione-vecchia".into(),
                campi: salvata.campi,
            })
            .is_err());
    }

    #[test]
    fn preventivi_e_scheda_cliente_sono_gratuiti_ma_il_crud_generico_resta_protetto() {
        let (_app, _data, state) = stato_test(false);
        let ordine = crea_ordine(&state);

        let prefill = state.preventivo_get(&ordine.id).unwrap();
        assert!(!prefill.esiste);
        assert!(state.preventivi_lista().is_ok());
        assert!(state.preventivo_ordini_disponibili().is_ok());

        let salvato = state
            .preventivo_salva(input_preventivo(&prefill, "Creato senza Premium"))
            .unwrap();
        let aggiornato = state
            .preventivo_salva(input_preventivo(&salvato, "Modificato senza Premium"))
            .unwrap();
        assert_eq!(aggiornato.note, "Modificato senza Premium");

        let scheda = state.scheda_cliente_get(&ordine.id).unwrap();
        assert!(state
            .scheda_cliente_salva(SchedaClienteSalvaInput {
                ordine_id: ordine.id.clone(),
                ordine_revision: scheda.ordine_revision,
                scheda_revision: scheda.revision,
                campi: scheda.campi,
            })
            .is_ok());

        state
            .preventivo_elimina(&aggiornato.id, &aggiornato.revision)
            .unwrap();
        assert!(state.preventivi_lista().unwrap().is_empty());
        state.preventivo_ripristina(&aggiornato.id).unwrap();
        assert!(state.preventivo_get(&ordine.id).unwrap().esiste);

        // Il CRUD generico resta chiuso anche se i comandi di dominio sono gratuiti.
        assert!(state.records_list("preventivo").is_err());
        assert!(state.records_list("scheda_cliente").is_err());
    }

    #[test]
    fn letture_configurazione_e_alias_sono_gratuite_ma_le_scritture_restano_premium() {
        let (_app, _data, state) = stato_test(false);
        let configurazione = state.configurazione_documenti_get().unwrap();
        assert!(state.preventivo_alias_lista().is_ok());
        assert!(state
            .configurazione_documenti_salva(ConfigurazioneDocumentiSalvaInput {
                revision: String::new(),
                campi: configurazione.campi,
            })
            .is_err());
        assert!(state.preventivo_alias_salva("alias", "prodotto").is_err());
    }

    #[test]
    fn preventivo_resta_modificabile_dopo_la_conferma_dell_ordine() {
        let (_app, _data, state) = stato_test(true);
        let ordine = crea_ordine(&state);
        let iniziale = state.preventivo_get(&ordine.id).unwrap();
        let salvato = state
            .preventivo_salva(input_preventivo(&iniziale, "Prima versione"))
            .unwrap();

        state
            .record_update(
                "ordine",
                &ordine.id,
                campi(&[("stato", json!("Confermato"))]),
            )
            .unwrap();

        let confermato = state.preventivo_get(&ordine.id).unwrap();
        assert_eq!(confermato.ordine_stato, "Confermato");
        let aggiornato = state
            .preventivo_salva(input_preventivo(&confermato, "Aggiornato dopo l’acconto"))
            .unwrap();

        assert_eq!(aggiornato.id, salvato.id);
        assert_eq!(aggiornato.note, "Aggiornato dopo l’acconto");
    }

    #[test]
    fn salvataggio_preventivo_allinea_ordine_e_scadenzario_nello_stesso_flusso() {
        let (_app, _data, state) = stato_test(true);
        let ordine = crea_ordine(&state);
        state
            .pagamento_registra(
                &ordine.id,
                "saldo",
                10_000,
                false,
                "2026-08-26",
                "",
                "",
                false,
                None,
            )
            .unwrap();
        let prefill = state.preventivo_get(&ordine.id).unwrap();
        let salvato = state
            .preventivo_salva(PreventivoSalvaInput {
                ordine_id: ordine.id.clone(),
                ordine_revision: prefill.ordine_revision,
                preventivo_revision: String::new(),
                linea: "Immunoterapia".into(),
                validita_giorni: 30,
                condizioni_pagamento: "Saldo a 30 giorni".into(),
                introduzione: "Proposta riservata".into(),
                note: String::new(),
                sconto_percentuale: 75,
                acconto: 5_000,
                righe: vec![PreventivoRigaSalvaInput {
                    id: Some(prefill.righe[0].id.clone()),
                    revision: prefill.righe[0].revision.clone(),
                    prodotto_id: String::new(),
                    prodotto_nome: "Preparato personalizzato".into(),
                    qta: 2,
                    prezzo: 10_000,
                    paziente: "Mario Rossi".into(),
                    tipo_test: String::new(),
                    ml: String::new(),
                    codice: String::new(),
                    formulazione: "Mantenimento".into(),
                    posologia: "1 volta al mese".into(),
                    numero: "L-42".into(),
                    allergeni: vec!["Graminacee".into()],
                }],
            })
            .unwrap();
        assert!(salvato.esiste);
        assert!(salvato.creato_ms > 0);
        assert_eq!(salvato.ordine_data, "2026-07-26");
        assert_eq!(salvato.totale, 20_000);
        assert_eq!(salvato.acconto, 5_000);
        assert_eq!(salvato.sconto_percentuale, 75);
        assert_eq!(salvato.linee, vec!["Immunoterapia"]);
        assert_eq!(salvato.righe[0].formulazione, "Mantenimento");
        assert_eq!(salvato.righe[0].allergeni, vec!["Graminacee"]);
        let pagamenti = state.pagamenti_ordine(&ordine.id).unwrap();
        assert_eq!(
            pagamenti
                .iter()
                .filter(|pagamento| !pagamento.saldato)
                .map(|pagamento| pagamento.importo)
                .sum::<i64>(),
            20_000
        );
        assert!(pagamenti
            .iter()
            .any(|pagamento| pagamento.tipo == "acconto" && pagamento.importo == 5_000));
        assert_eq!(salvato.pagamenti.len(), 2);
        assert_eq!(salvato.pagamenti[0].tipo, "acconto");
        assert_eq!(salvato.pagamenti[0].importo, 5_000);
        assert_eq!(salvato.pagamenti[1].tipo, "saldo");
        assert_eq!(salvato.pagamenti[1].importo, 15_000);

        let senza_acconto = state
            .preventivo_salva(PreventivoSalvaInput {
                ordine_id: ordine.id.clone(),
                ordine_revision: salvato.ordine_revision.clone(),
                preventivo_revision: salvato.revision.clone(),
                linea: "Immunoterapia".into(),
                validita_giorni: salvato.validita_giorni,
                condizioni_pagamento: salvato.condizioni_pagamento.clone(),
                introduzione: salvato.introduzione.clone(),
                note: salvato.note.clone(),
                sconto_percentuale: salvato.sconto_percentuale,
                acconto: 0,
                righe: salvato
                    .righe
                    .iter()
                    .map(|riga| PreventivoRigaSalvaInput {
                        id: Some(riga.id.clone()),
                        revision: riga.revision.clone(),
                        prodotto_id: riga.prodotto_id.clone(),
                        prodotto_nome: if riga.prodotto_id.is_empty() {
                            riga.prodotto_nome.clone()
                        } else {
                            String::new()
                        },
                        qta: riga.qta,
                        prezzo: riga.prezzo,
                        paziente: riga.paziente.clone(),
                        tipo_test: riga.tipo_test.clone(),
                        ml: riga.ml.clone(),
                        codice: riga.codice.clone(),
                        formulazione: riga.formulazione.clone(),
                        posologia: riga.posologia.clone(),
                        numero: riga.numero.clone(),
                        allergeni: riga.allergeni.clone(),
                    })
                    .collect(),
            })
            .unwrap();
        assert!(state
            .pagamenti_ordine(&ordine.id)
            .unwrap()
            .iter()
            .all(|pagamento| pagamento.tipo != "acconto" || pagamento.saldato));

        state
            .preventivo_elimina(&senza_acconto.id, &senza_acconto.revision)
            .unwrap();
        assert!(state.preventivi_lista().unwrap().is_empty());
        let cestino = state.cestino().unwrap();
        let eliminato = cestino
            .iter()
            .find(|elemento| elemento.entity == "preventivo" && elemento.id == senza_acconto.id)
            .expect("preventivo nel Cestino");
        assert_eq!(
            str_field(&eliminato.data, "numero_preventivo"),
            senza_acconto.numero_preventivo
        );
        assert!(state
            .preventivo_ordini_disponibili()
            .unwrap()
            .iter()
            .all(|elemento| elemento.ordine_id != ordine.id));
        state.preventivo_ripristina(&senza_acconto.id).unwrap();
        assert_eq!(state.preventivi_lista().unwrap().len(), 1);
    }

    #[test]
    fn eliminazione_ordine_porta_con_se_il_preventivo_e_il_ripristino_li_recupera() {
        let (_app, _data, state) = stato_test(true);
        let ordine = crea_ordine(&state);
        let prefill = state.preventivo_get(&ordine.id).unwrap();
        let preventivo = state
            .preventivo_salva(input_preventivo(&prefill, "Collegato"))
            .unwrap();

        state.record_delete("ordine", &ordine.id).unwrap();
        assert!(state.preventivi_lista().unwrap().is_empty());
        let cestino = state.cestino().unwrap();
        assert!(cestino
            .iter()
            .any(|elemento| elemento.entity == "ordine" && elemento.id == ordine.id));
        assert!(!cestino
            .iter()
            .any(|elemento| elemento.entity == "preventivo" && elemento.id == preventivo.id));

        state.record_restore("ordine", &ordine.id).unwrap();
        assert_eq!(state.preventivi_lista().unwrap().len(), 1);
        assert!(state
            .cestino()
            .unwrap()
            .iter()
            .all(|elemento| elemento.id != ordine.id && elemento.id != preventivo.id));

        let ripristinato = state.preventivo_get(&ordine.id).unwrap();
        state
            .preventivo_elimina(&ripristinato.id, &ripristinato.revision)
            .unwrap();
        assert!(state.record_get("ordine", &ordine.id).unwrap().is_some());
        assert!(state.preventivi_lista().unwrap().is_empty());
    }

    #[test]
    fn ripristino_preventivo_eliminato_prima_dell_ordine_non_ripristina_l_ordine() {
        let (_app, _data, state) = stato_test(true);
        let ordine = crea_ordine(&state);
        let prefill = state.preventivo_get(&ordine.id).unwrap();
        let preventivo = state
            .preventivo_salva(input_preventivo(&prefill, "Da conservare"))
            .unwrap();

        state
            .preventivo_elimina(&preventivo.id, &preventivo.revision)
            .unwrap();
        state.record_delete("ordine", &ordine.id).unwrap();
        let cestino = state.cestino().unwrap();
        assert!(cestino
            .iter()
            .any(|elemento| elemento.entity == "ordine" && elemento.id == ordine.id));
        assert!(cestino
            .iter()
            .any(|elemento| { elemento.entity == "preventivo" && elemento.id == preventivo.id }));

        state.preventivo_ripristina(&preventivo.id).unwrap();
        assert!(state
            .cestino()
            .unwrap()
            .iter()
            .all(|elemento| { elemento.id != ordine.id && elemento.id != preventivo.id }));
        assert!(state.record_restore("ordine", &ordine.id).is_err());
        assert!(state
            .record_get("ordine", &ordine.id)
            .unwrap()
            .is_some_and(|record| record.deleted));

        let ripristinato = state.preventivo_get(&ordine.id).unwrap();
        assert_eq!(ripristinato.numero_preventivo, preventivo.numero_preventivo);
        let aggiornato = state
            .preventivo_salva(input_preventivo(
                &ripristinato,
                "Modificabile senza ripristinare l’ordine",
            ))
            .unwrap();
        assert_eq!(aggiornato.note, "Modificabile senza ripristinare l’ordine");

        // Uno "Svuota" su altre voci non può rimuovere il supporto di un
        // preventivo attivo. Quando invece si elimina anche il preventivo,
        // lo svuotamento purga l'intero aggregato senza lasciare figli orfani.
        state.cestino_svuota().unwrap();
        assert!(state.preventivo_get(&ordine.id).is_ok());
        state
            .preventivo_elimina(&aggiornato.id, &aggiornato.revision)
            .unwrap();
        state.cestino_svuota().unwrap();
        assert!(state.preventivo_get(&ordine.id).is_err());
        assert!(state.record_get("ordine", &ordine.id).unwrap().is_none());
        assert!(state
            .record_get("riga_ordine", &ordine.righe[0].id)
            .unwrap()
            .is_none());
    }

    #[test]
    fn ordine_base_del_preventivo_usa_conto_medico_e_si_conferma_all_incasso() {
        let (_app, _data, state) = stato_test(true);
        let conto = state
            .record_create(
                "conto",
                campi(&[("nome", json!("Conto medico")), ("tipo", json!("banca"))]),
            )
            .unwrap();
        let medico = state
            .record_create(
                "medico",
                campi(&[
                    ("nome", json!("Medico test")),
                    ("conto_saldo_id", json!(conto.id)),
                    ("acconto_default", json!(3_000)),
                ]),
            )
            .unwrap();
        let ordine = state
            .ordine_salva_base(OrdineSalvaBaseInput {
                id: None,
                rimborso_extra: None,
                expected_righe: Vec::new(),
                fields: campi(&[
                    ("stato", json!("Nuovo")),
                    ("data", json!("2026-07-28")),
                    ("categoria", json!("Immunoterapia")),
                    ("medico_id", json!(medico.id)),
                    ("acconto", json!(3_000)),
                ]),
                righe: vec![OrdineSalvaRigaInput {
                    id: None,
                    fields: campi(&[
                        ("prodotto_nome", json!("Sublinguale 2 fiale")),
                        ("qta", json!(1)),
                        ("prezzo", json!(10_000)),
                    ]),
                }],
            })
            .unwrap();

        let pagamenti = state.pagamenti_riallinea_aperti(&ordine.id).unwrap();
        assert_eq!(pagamenti.len(), 2);
        assert!(pagamenti
            .iter()
            .all(|pagamento| pagamento.conto_id == conto.id));
        let acconto = pagamenti
            .iter()
            .find(|pagamento| pagamento.tipo == "acconto")
            .unwrap();
        state
            .pagamento_salda(&acconto.id, &conto.id, "2026-07-28", true)
            .unwrap();
        let ordine = state.record_get("ordine", &ordine.id).unwrap().unwrap();
        assert_eq!(str_field(&ordine.data, "stato"), "Confermato");
    }

    #[test]
    fn scheda_cliente_usa_solo_acconto_incassato_e_descrive_le_rate() {
        let (_app, _data, state) = stato_test(true);
        let ordine = crea_ordine(&state);
        state
            .pagamento_registra(
                &ordine.id,
                "acconto",
                3_000,
                true,
                "",
                CONTO_ASSEGNO,
                "2026-07-28",
                true,
                None,
            )
            .unwrap();
        state
            .pagamento_registra(
                &ordine.id,
                "saldo",
                7_000,
                false,
                "2026-08-28",
                CONTO_CONTRASSEGNO,
                "",
                false,
                None,
            )
            .unwrap();

        let scheda = state.scheda_cliente_get(&ordine.id).unwrap();
        assert_eq!(scheda.campi.importo_acconto, 3_000);
        assert_eq!(scheda.campi.data_contabile_valuta, "2026-07-28");
        assert_eq!(scheda.campi.modalita_saldo, "contrassegno");
        assert!(scheda
            .campi
            .note
            .contains("2 rate: 30€ acconto - 70€ saldo"));
    }

    #[test]
    fn scheda_cliente_rilegge_paziente_e_dati_fattura_dall_ordine() {
        let (_app, _data, state) = stato_test(true);
        let ordine = crea_ordine(&state);
        let iniziale = state.scheda_cliente_get(&ordine.id).unwrap();
        let mut campi_salvati = iniziale.campi.clone();
        campi_salvati.pazienti = String::new();
        campi_salvati.intestatario_nome = String::new();
        campi_salvati.intestatario_indirizzo = String::new();
        state
            .scheda_cliente_salva(SchedaClienteSalvaInput {
                ordine_id: ordine.id.clone(),
                ordine_revision: iniziale.ordine_revision,
                scheda_revision: String::new(),
                campi: campi_salvati,
            })
            .unwrap();

        state
            .record_update(
                "ordine",
                &ordine.id,
                campi(&[
                    ("fatt_ragione_sociale", json!("Rossi Medical S.r.l.")),
                    ("fatt_indirizzo", json!("Via Fatture 5")),
                    ("fatt_cap", json!("20100")),
                    ("fatt_citta", json!("Milano")),
                    ("fatt_prov", json!("MI")),
                ]),
            )
            .unwrap();
        state
            .record_update(
                "riga_ordine",
                &ordine.righe[0].id,
                campi(&[("paziente", json!("Giulia Bianchi"))]),
            )
            .unwrap();

        let aggiornata = state.scheda_cliente_get(&ordine.id).unwrap();
        assert_eq!(aggiornata.campi.pazienti, "Giulia Bianchi");
        assert_eq!(aggiornata.campi.intestatario_nome, "Rossi Medical S.r.l.");
        assert_eq!(
            aggiornata.campi.intestatario_indirizzo,
            "Via Fatture 5, 20100 Milano (MI)"
        );
    }

    #[test]
    fn scheda_cliente_completa_intestatario_cf_medico_e_agente() {
        let (_app, _data, state) = stato_test(true);
        let agente = state
            .record_create("agente", campi(&[("nome", json!("Anna Bianchi"))]))
            .unwrap();
        let medico = state
            .record_create(
                "medico",
                campi(&[
                    ("nome", json!("Dott. Verdi")),
                    ("agente_id", json!(agente.id.clone())),
                ]),
            )
            .unwrap();
        let cliente = state
            .record_create("cliente", campi(&[("nome", json!("Mario Rossi"))]))
            .unwrap();
        let ordine = crea_ordine(&state);
        state
            .record_update(
                "ordine",
                &ordine.id,
                campi(&[
                    ("categoria", json!("Immunoterapia")),
                    ("cliente_id", json!(cliente.id.clone())),
                    ("medico_id", json!(medico.id.clone())),
                    ("agente_id", json!(agente.id.clone())),
                    ("fatt_ragione_sociale", json!("Mario Rossi")),
                    ("fatt_piva", json!("RSSMRA80A01F205X")),
                ]),
            )
            .unwrap();
        state
            .record_update(
                "riga_ordine",
                &ordine.righe[0].id,
                campi(&[("paziente", json!(""))]),
            )
            .unwrap();

        let scheda = state.scheda_cliente_get(&ordine.id).unwrap();
        assert_eq!(scheda.campi.pazienti, "Mario Rossi");
        assert_eq!(scheda.campi.intestatario_codice_fiscale, "RSSMRA80A01F205X");
        assert_eq!(scheda.medico_nome, "Dott. Verdi");
        assert_eq!(scheda.agente_nome, "Anna Bianchi");
    }

    #[test]
    fn revisione_stantia_non_applica_modifiche_parziali() {
        let (_app, _data, state) = stato_test(true);
        let ordine = crea_ordine(&state);
        let prefill = state.preventivo_get(&ordine.id).unwrap();
        state
            .record_update(
                "ordine",
                &ordine.id,
                campi(&[("note", json!("modifica remota"))]),
            )
            .unwrap();
        let result = state.preventivo_salva(PreventivoSalvaInput {
            ordine_id: ordine.id.clone(),
            ordine_revision: prefill.ordine_revision,
            preventivo_revision: String::new(),
            linea: "Immunoterapia".into(),
            validita_giorni: 30,
            condizioni_pagamento: "Saldo".into(),
            introduzione: String::new(),
            note: String::new(),
            sconto_percentuale: 0,
            acconto: 0,
            righe: vec![PreventivoRigaSalvaInput {
                id: Some(prefill.righe[0].id.clone()),
                revision: prefill.righe[0].revision.clone(),
                prodotto_id: String::new(),
                prodotto_nome: "Non deve essere salvato".into(),
                qta: 9,
                prezzo: 90_000,
                paziente: String::new(),
                tipo_test: String::new(),
                ml: String::new(),
                codice: String::new(),
                formulazione: String::new(),
                posologia: String::new(),
                numero: String::new(),
                allergeni: Vec::new(),
            }],
        });
        assert!(result.is_err());
        assert!(!state.preventivo_get(&ordine.id).unwrap().esiste);
        let riga = state
            .record_get("riga_ordine", &prefill.righe[0].id)
            .unwrap()
            .unwrap();
        assert_eq!(
            str_field(&riga.data, "prodotto_nome"),
            "Preparato personalizzato"
        );
    }
}
