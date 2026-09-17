//! Export Excel (.xlsx) nativo dei riepiloghi.
//!
//! Usa `rust_xlsxwriter` (pura Rust, nessuna dipendenza nativa). Gli importi sono
//! salvati come **numeri** (euro, 2 decimali) così Excel li somma davvero, con
//! formato italiano applicato dalla cella.
//!
//! Oltre al report provvigioni (tipizzato) c'è un export **generico di griglia**
//! (`griglia_xlsx`): la UI passa intestazioni + righe già filtrate/ordinate, così lo
//! stesso meccanismo serve Crediti, Rimborsi, Giornaliero e qualunque tabella futura.

use std::path::Path;

use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook};
use serde::Deserialize;
use serde_json::Value;

use crate::app::ProvvigioniReportDto;

/// Colore dell'intestazione (blu PharmaTek) e della riga totali (azzurro tenue).
const BLU_HEADER: Color = Color::RGB(0x1971C2);
const AZZURRO_TENUE: Color = Color::RGB(0xE7F5FF);

/// Formato intestazione riusabile: grassetto bianco su fondo blu, centrato, con bordo.
fn fmt_header() -> Format {
    Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(BLU_HEADER)
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
        .set_border(FormatBorder::Thin)
}

/// Definizione di una colonna per l'export generico (dalla UI).
#[derive(Debug, Deserialize)]
pub struct ColExport {
    pub label: String,
    /// Tipo cella: `euro` (numero in € → formato + somma), `numero`, `data` o `testo`.
    #[serde(default)]
    pub tipo: String,
    /// Se `true`, la colonna è sommata nella riga **Totali** in fondo (solo euro/numero).
    #[serde(default)]
    pub totale: bool,
}

/// Larghezza colonna euristica: tiene conto dell'header e di un campione di righe.
fn larghezza(col: usize, c: &ColExport, righe: &[Vec<Value>]) -> f64 {
    let mut max = c.label.chars().count();
    for r in righe.iter().take(200) {
        if let Some(v) = r.get(col) {
            let len = match v {
                Value::String(s) => s.chars().count(),
                Value::Number(n) => n.to_string().len(),
                _ => 0,
            };
            max = max.max(len);
        }
    }
    (max as f64 + 2.0).clamp(8.0, 48.0)
}

/// Nome foglio valido per Excel: max 31 caratteri, senza `[]:*?/\`.
fn nome_foglio(s: &str) -> String {
    let pulito: String = s
        .chars()
        .map(|c| if "[]:*?/\\".contains(c) { ' ' } else { c })
        .collect();
    let pulito = pulito.trim();
    let troncato: String = pulito.chars().take(31).collect();
    if troncato.is_empty() {
        "Foglio1".to_string()
    } else {
        troncato
    }
}

/// Export **generico** di una griglia in `.xlsx`: header in grassetto, importi come
/// numeri (Excel li somma), eventuale riga Totali in fondo per le colonne marcate.
/// `righe[r][c]` è il valore grezzo della cella: numero per euro/numero, stringa per
/// data (già `gg/mm/aaaa`) e testo.
pub fn griglia_xlsx(
    path: &Path,
    foglio: &str,
    colonne: &[ColExport],
    righe: &[Vec<Value>],
    orizzontale: bool,
    simbolo_euro: bool,
) -> Result<(), String> {
    let mut wb = Workbook::new();
    // Con `simbolo_euro` la cella mostra "€ 1.234,56" (export leggibili: Crediti/Rimborsi/…);
    // senza, resta il numero nudo "1.234,56" (distinta corriere: fedeltà al tracciato legacy).
    // Decimali solo se presenti: intero → "€ 90" (senza virgola); con centesimi → "€ 90,50" o "€ 90,15".
    let (fmt_int_str, fmt_dec_str) = if simbolo_euro {
        ("€ #,##0", "€ #,##0.00")
    } else {
        ("#,##0", "#,##0.00")
    };
    let fmt_int = Format::new().set_num_format(fmt_int_str);
    let fmt_dec = Format::new().set_num_format(fmt_dec_str);
    let fmt_int_bold = Format::new()
        .set_num_format(fmt_int_str)
        .set_bold()
        .set_background_color(AZZURRO_TENUE)
        .set_border(FormatBorder::Thin);
    let fmt_dec_bold = Format::new()
        .set_num_format(fmt_dec_str)
        .set_bold()
        .set_background_color(AZZURRO_TENUE)
        .set_border(FormatBorder::Thin);
    let bold = Format::new()
        .set_bold()
        .set_background_color(AZZURRO_TENUE)
        .set_border(FormatBorder::Thin);
    let header = fmt_header();

    let ws = wb.add_worksheet();
    ws.set_name(nome_foglio(foglio)).map_err(es)?;
    // Riga intestazione "congelata": resta visibile scorrendo (header colorato).
    ws.set_freeze_panes(1, 0).map_err(es)?;
    // Orientamento di stampa del foglio (coerente con la scelta in anteprima).
    if orizzontale {
        ws.set_landscape();
    }

    for (c, col) in colonne.iter().enumerate() {
        ws.set_column_width(c as u16, larghezza(c, col, righe))
            .map_err(es)?;
        ws.write_string_with_format(0, c as u16, col.label.as_str(), &header)
            .map_err(es)?;
    }

    let mut totali = vec![0.0f64; colonne.len()];
    let mut r = 1u32;
    for riga in righe {
        for (c, col) in colonne.iter().enumerate() {
            let val = riga.get(c).unwrap_or(&Value::Null);
            let numerico = matches!(col.tipo.as_str(), "euro" | "numero");
            if numerico {
                // Cella numerica vuota (valore assente) → lasciata **vuota**, non 0
                // (fedeltà col file corriere: il contrassegno c'è solo dove serve).
                if let Some(n) = val.as_f64() {
                    if col.tipo == "euro" {
                        let has_decimals = (n - n.trunc()).abs() > 0.005;
                        let fmt = if has_decimals { &fmt_dec } else { &fmt_int };
                        ws.write_number_with_format(r, c as u16, n, fmt)
                            .map_err(es)?;
                    } else {
                        ws.write_number(r, c as u16, n).map_err(es)?;
                    }
                    if col.totale {
                        totali[c] += n;
                    }
                }
            } else {
                let s = match val {
                    Value::String(s) => s.clone(),
                    Value::Null => String::new(),
                    other => other.to_string(),
                };
                ws.write_string(r, c as u16, s.as_str()).map_err(es)?;
            }
        }
        r += 1;
    }

    // Riga Totali (solo se almeno una colonna è sommabile).
    if colonne.iter().any(|c| c.totale) {
        let prima = colonne.iter().position(|c| !c.totale).unwrap_or(0);
        ws.write_string_with_format(r, prima as u16, "TOTALE", &bold)
            .map_err(es)?;
        for (c, col) in colonne.iter().enumerate() {
            if col.totale {
                let n = totali[c];
                let has_decimals = (n - n.trunc()).abs() > 0.005;
                let fmt = if col.tipo == "euro" {
                    if has_decimals {
                        &fmt_dec_bold
                    } else {
                        &fmt_int_bold
                    }
                } else {
                    &bold
                };
                ws.write_number_with_format(r, c as u16, n, fmt)
                    .map_err(es)?;
            }
        }
    }

    wb.save(path).map_err(es)?;
    Ok(())
}

/// Una riga del file di produzione Laboratorio (un set di fiale per un paziente). I campi
/// `acconto`/`valore` sono `None` sulle righe successive alla prima di uno stesso ordine
/// (così la somma di colonna C non raddoppia per gli ordini multi-paziente). FASE 5C.
#[derive(Debug, Default)]
pub struct RigaLaboratorio {
    pub acconto: Option<f64>,
    pub numero_produzione: i64,
    pub data_invio: String,
    pub agente: String,
    pub medico: String,
    pub paziente: String,
    pub valore: Option<f64>,
    pub data_prevista: String,
    pub formulazione: String,
    pub posologia: String,
    pub allergeni: Vec<String>,
}

/// Scrive il file **Laboratorio** (Immunoterapia) replicando il formato reale di
/// `maggio_2026.xlsx`: **nessuna intestazione**, dati da riga 1; colonne A, B, K, T–W sono
/// spaziature vuote legacy. Mappatura: C=acconto, D=n° produzione, E=data invio, F=agente,
/// G=medico, H=paziente, I=valore vendita, J=data prevista, L=formulazione, M=posologia,
/// N…=allergeni (una colonna per allergene, dinamico). In fondo la **somma di colonna C**
/// (totale acconti del lotto). FASE 5C.
pub fn laboratorio_xlsx(path: &Path, righe: &[RigaLaboratorio]) -> Result<(), String> {
    let mut wb = Workbook::new();
    // Importi col simbolo «€» (il valore resta numerico: il € è solo formato), niente decimali
    // superflui come nel file reale (€ 90, € 115, € 270…).
    let num_int = Format::new().set_num_format("€ #,##0");
    let num_dec = Format::new().set_num_format("€ #,##0.00");
    let num_int_bold = Format::new()
        .set_num_format("€ #,##0")
        .set_bold()
        .set_background_color(AZZURRO_TENUE)
        .set_border(FormatBorder::Thin);
    let num_dec_bold = Format::new()
        .set_num_format("€ #,##0.00")
        .set_bold()
        .set_background_color(AZZURRO_TENUE)
        .set_border(FormatBorder::Thin);
    let bold = Format::new()
        .set_bold()
        .set_background_color(AZZURRO_TENUE)
        .set_border(FormatBorder::Thin);
    let header = fmt_header();

    let ws = wb.add_worksheet();
    ws.set_name("Produzione").map_err(es)?;
    ws.set_freeze_panes(1, 0).map_err(es)?;

    // Intestazioni colonna (riga 0) + larghezze. Le colonne A,B,K restano vuote come nel
    // tracciato legacy; le altre prendono un titolo leggibile. Gli allergeni (da N in poi)
    // sono DINAMICI: una colonna per allergene, tante quante ne servono al lotto (il massimo
    // fra le righe). Niente più tetto fisso a 6 → nessuna colonna vuota di troppo.
    let max_all = righe.iter().map(|r| r.allergeni.len()).max().unwrap_or(0);
    let mut intest: Vec<(u16, String, f64)> = vec![
        (0, "Acconto".into(), 10.0),       // A
        (1, "N° prod.".into(), 8.0),       // B
        (2, "Data invio".into(), 12.0),    // C
        (3, "Agente".into(), 16.0),        // D
        (4, "Medico".into(), 18.0),        // E
        (5, "Paziente".into(), 24.0),      // F
        (6, "Valore".into(), 10.0),        // G
        (7, "Data prevista".into(), 14.0), // H
        // Colonna 8 (I) lasciata vuota tra Data prevista e Formulazione (richiesta utente)
        (9, "Formulazione".into(), 16.0), // J
        (10, "Posologia".into(), 12.0),   // K
    ];
    for k in 0..max_all {
        intest.push((11 + k as u16, format!("Allergene {}", k + 1), 15.0)); // L, M, …
    }
    for (c, label, w) in &intest {
        ws.set_column_width(*c, *w).map_err(es)?;
        ws.write_string_with_format(0, *c, label.as_str(), &header)
            .map_err(es)?;
    }

    let mut totale_acconto = 0.0f64;
    let mut totale_valore = 0.0f64;
    for (i, r) in righe.iter().enumerate() {
        let row = i as u32 + 1; // riga 0 = intestazione
        if let Some(a) = r.acconto {
            let has_decimals = (a - a.trunc()).abs() > 0.005;
            let fmt = if has_decimals { &num_dec } else { &num_int };
            ws.write_number_with_format(row, 0, a, fmt).map_err(es)?; // A
            totale_acconto += a;
        }
        ws.write_number(row, 1, r.numero_produzione as f64)
            .map_err(es)?; // B
        ws.write_string(row, 2, r.data_invio.as_str()).map_err(es)?; // C
        ws.write_string(row, 3, r.agente.as_str()).map_err(es)?; // D
        ws.write_string(row, 4, r.medico.as_str()).map_err(es)?; // E
        ws.write_string(row, 5, r.paziente.as_str()).map_err(es)?; // F
        if let Some(v) = r.valore {
            let has_decimals = (v - v.trunc()).abs() > 0.005;
            let fmt = if has_decimals { &num_dec } else { &num_int };
            ws.write_number_with_format(row, 6, v, fmt).map_err(es)?; // G
            totale_valore += v;
        }
        ws.write_string(row, 7, r.data_prevista.as_str())
            .map_err(es)?; // H
                           // Colonna 8 (I) lasciata vuota
        ws.write_string(row, 9, r.formulazione.as_str())
            .map_err(es)?; // J
        ws.write_string(row, 10, r.posologia.as_str()).map_err(es)?; // K
        for (k, a) in r.allergeni.iter().enumerate() {
            ws.write_string(row, 11 + k as u16, a.as_str())
                .map_err(es)?;
        }
    }

    // Riga dei totali in fondo:
    // Come nella stampa (e confermato dall'utente):
    // - Col 0 (Acconto): totale acconto
    // - Col 1 (N° prod.): scritta "TOTALE"
    // - Col 6 (Valore): totale valore
    // - Altre colonne: vuote
    if !righe.is_empty() {
        let row = righe.len() as u32 + 1; // riga totali subito sotto i dati
        let acc_has_decimals = (totale_acconto - totale_acconto.trunc()).abs() > 0.005;
        let acc_fmt = if acc_has_decimals {
            &num_dec_bold
        } else {
            &num_int_bold
        };
        ws.write_number_with_format(row, 0, totale_acconto, acc_fmt)
            .map_err(es)?;
        ws.write_string_with_format(row, 1, "TOTALE", &bold)
            .map_err(es)?;

        let val_has_decimals = (totale_valore - totale_valore.trunc()).abs() > 0.005;
        let val_fmt = if val_has_decimals {
            &num_dec_bold
        } else {
            &num_int_bold
        };
        ws.write_number_with_format(row, 6, totale_valore, val_fmt)
            .map_err(es)?;
    }

    wb.save(path).map_err(es)?;
    Ok(())
}

/// Un ordine Diagnostica per l'export a blocchi (FASE 5D): intestazione (n° + cliente) e
/// le sue righe (allergene · tipo test · ml · quantità · valore).
#[derive(Debug, Default)]
pub struct OrdineDiagnostica {
    pub numero: String,
    pub data: String,
    pub cliente: String,
    pub righe: Vec<RigaDiagnostica>,
}

#[derive(Debug, Default)]
pub struct RigaDiagnostica {
    pub allergene: String,
    pub tipo_test: String,
    pub ml: String,
    pub qta: i64,
    pub valore: Option<f64>,
    pub codice: String,
}

/// Scrive il file **Diagnostica** di un lotto: **un blocco per ordine** (FASE 5D). Ogni
/// blocco ha una riga intestazione (ORD n° · data · cliente), una riga di colonne, e una
/// riga per allergene (allergene · tipo test · ml · quantità · valore · codice). I blocchi
/// sono separati da una riga vuota. Rispecchia i file in `DIAGNOSTICA/`.
pub fn diagnostica_xlsx(path: &Path, ordini: &[OrdineDiagnostica]) -> Result<(), String> {
    let mut wb = Workbook::new();
    // Titoli colonna = header blu; riga ORD/cliente = fascia grigia in grassetto.
    let bold = fmt_header();
    let intest = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0xDEE2E6))
        .set_border(FormatBorder::Thin);
    // Importi col simbolo «€» (valore numerico invariato, € solo come formato cella).
    let num_int = Format::new().set_num_format("€ #,##0");
    let num_dec = Format::new().set_num_format("€ #,##0.00");

    let ws = wb.add_worksheet();
    ws.set_name("Diagnostica").map_err(es)?;
    for (c, w) in [
        (0u16, 26.0),
        (1, 14.0),
        (2, 12.0),
        (3, 8.0),
        (4, 9.0),
        (5, 14.0),
    ] {
        ws.set_column_width(c, w).map_err(es)?;
    }

    let mut row = 0u32;
    for o in ordini {
        // Intestazione ordine.
        let testa = format!(
            "ORD {}{}",
            o.numero,
            if o.data.is_empty() {
                String::new()
            } else {
                format!("  ·  {}", o.data)
            }
        );
        ws.write_string_with_format(row, 0, testa.as_str(), &intest)
            .map_err(es)?;
        ws.write_string_with_format(row, 1, "CLIENTE", &intest)
            .map_err(es)?;
        ws.write_string_with_format(row, 2, o.cliente.as_str(), &intest)
            .map_err(es)?;
        for c in 3..=5u16 {
            ws.write_string_with_format(row, c, "", &intest)
                .map_err(es)?;
        }
        row += 1;
        // Riga colonne.
        for (c, h) in ["ALLERGENE", "TIPO TEST", "ML", "Q.TÀ", "VALORE", "CODICE"]
            .iter()
            .enumerate()
        {
            ws.write_string_with_format(row, c as u16, *h, &bold)
                .map_err(es)?;
        }
        row += 1;
        for r in &o.righe {
            ws.write_string(row, 0, r.allergene.as_str()).map_err(es)?;
            ws.write_string(row, 1, r.tipo_test.as_str()).map_err(es)?;
            ws.write_string(row, 2, r.ml.as_str()).map_err(es)?;
            ws.write_number(row, 3, r.qta as f64).map_err(es)?;
            if let Some(v) = r.valore {
                let has_decimals = (v - v.trunc()).abs() > 0.005;
                let fmt = if has_decimals { &num_dec } else { &num_int };
                ws.write_number_with_format(row, 4, v, fmt).map_err(es)?;
            }
            ws.write_string(row, 5, r.codice.as_str()).map_err(es)?;
            row += 1;
        }
        row += 1; // riga vuota fra blocchi
    }

    wb.save(path).map_err(es)?;
    Ok(())
}

/// Scrive il riepilogo provvigioni in un file `.xlsx`: una riga per ordine,
/// raggruppata per agente con subtotale del maturato, e un totale generale.
pub fn provvigioni_xlsx(path: &Path, report: &ProvvigioniReportDto) -> Result<(), String> {
    let mut wb = Workbook::new();
    // Decimali solo se presenti (coerente con gli altri export).
    let fmt_int = Format::new().set_num_format("#,##0");
    let fmt_dec = Format::new().set_num_format("#,##0.00");
    let fmt_int_bold = Format::new()
        .set_num_format("#,##0")
        .set_bold()
        .set_background_color(AZZURRO_TENUE)
        .set_border(FormatBorder::Thin);
    let fmt_dec_bold = Format::new()
        .set_num_format("#,##0.00")
        .set_bold()
        .set_background_color(AZZURRO_TENUE)
        .set_border(FormatBorder::Thin);
    let bold = Format::new()
        .set_bold()
        .set_background_color(AZZURRO_TENUE)
        .set_border(FormatBorder::Thin);
    let header = fmt_header();

    let ws = wb.add_worksheet();
    ws.set_name("Provvigioni").map_err(es)?;
    ws.set_freeze_panes(1, 0).map_err(es)?;

    let larghezze = [22.0, 12.0, 12.0, 26.0, 14.0, 12.0, 14.0, 11.0];
    for (i, w) in larghezze.iter().enumerate() {
        ws.set_column_width(i as u16, *w).map_err(es)?;
    }

    let header_titoli = [
        "Agente",
        "N° Ordine",
        "Data",
        "Cliente",
        "Stato",
        "Base €",
        "Provvigione €",
        "Maturato",
    ];
    for (c, h) in header_titoli.iter().enumerate() {
        ws.write_string_with_format(0, c as u16, *h, &header)
            .map_err(es)?;
    }

    let mut row = 1u32;
    for ag in &report.agenti {
        for o in &ag.ordini {
            ws.write_string(row, 0, ag.agente_nome.as_str())
                .map_err(es)?;
            ws.write_string(row, 1, o.numero.as_str()).map_err(es)?;
            ws.write_string(row, 2, o.data.as_str()).map_err(es)?;
            ws.write_string(row, 3, o.cliente_nome.as_str())
                .map_err(es)?;
            ws.write_string(row, 4, o.stato.as_str()).map_err(es)?;

            let base_val = o.base as f64 / 100.0;
            let base_has_dec = (base_val - base_val.trunc()).abs() > 0.005;
            let base_fmt = if base_has_dec { &fmt_dec } else { &fmt_int };
            ws.write_number_with_format(row, 5, base_val, base_fmt)
                .map_err(es)?;

            let provv_val = o.provvigione as f64 / 100.0;
            let provv_has_dec = (provv_val - provv_val.trunc()).abs() > 0.005;
            let provv_fmt = if provv_has_dec { &fmt_dec } else { &fmt_int };
            ws.write_number_with_format(row, 6, provv_val, provv_fmt)
                .map_err(es)?;

            ws.write_string(row, 7, if o.maturato { "Sì" } else { "No" })
                .map_err(es)?;
            row += 1;
        }
        // Subtotale dell'agente (solo il maturato: è ciò che si paga).
        let sub_val = ag.totale_maturato as f64 / 100.0;
        let sub_has_dec = (sub_val - sub_val.trunc()).abs() > 0.005;
        let sub_fmt = if sub_has_dec {
            &fmt_dec_bold
        } else {
            &fmt_int_bold
        };
        ws.write_string_with_format(row, 3, "Totale agente (maturato)", &bold)
            .map_err(es)?;
        ws.write_number_with_format(row, 6, sub_val, sub_fmt)
            .map_err(es)?;
        row += 2;
    }

    let tot_val = report.totale_maturato as f64 / 100.0;
    let tot_has_dec = (tot_val - tot_val.trunc()).abs() > 0.005;
    let tot_fmt = if tot_has_dec {
        &fmt_dec_bold
    } else {
        &fmt_int_bold
    };
    ws.write_string_with_format(row, 3, "TOTALE MATURATO", &bold)
        .map_err(es)?;
    ws.write_number_with_format(row, 6, tot_val, tot_fmt)
        .map_err(es)?;

    wb.save(path).map_err(es)?;
    Ok(())
}

fn es<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
