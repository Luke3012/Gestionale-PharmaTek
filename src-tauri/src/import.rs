use calamine::{open_workbook_auto, Data, Reader, Sheets};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedClient {
    pub nome: String,
    pub indirizzo: String,
    pub citta: String,
    pub prov: String,
    pub cap: String,
    pub regione: String,
    pub telefono: String,
    pub email: String,
    pub cf: String,
    pub note_spedizione: String,
}

fn get_string_value(val: &Data) -> String {
    match val {
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 {
                format!("{:.0}", f)
            } else {
                f.to_string()
            }
        }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        _ => "".to_string(),
    }
}

fn find_column_index(headers: &[String], aliases: &[&str]) -> Option<usize> {
    for alias in aliases {
        let a_clean = alias.trim().to_uppercase();
        for (idx, h) in headers.iter().enumerate() {
            if h.trim().to_uppercase() == a_clean {
                return Some(idx);
            }
        }
    }
    for alias in aliases {
        let a_clean = alias.trim().to_uppercase();
        for (idx, h) in headers.iter().enumerate() {
            if h.trim().to_uppercase().contains(&a_clean) {
                return Some(idx);
            }
        }
    }
    None
}

fn get_cell(r: &[Data], idx: Option<usize>) -> String {
    idx.and_then(|i| r.get(i))
        .map(get_string_value)
        .unwrap_or_default()
}

fn clean_client_name(name: &str) -> String {
    let mut n = name.trim().to_uppercase();
    // Clean generic prefixes
    for prefix in &["DR.SSA", "DR.", "DOTT.SSA", "DOTT.", "SIG.RA", "SIG."] {
        if n.starts_with(prefix) {
            n = n.replacen(prefix, "", 1).trim().to_string();
        }
    }
    n
}

fn is_aruba_headers(headers: &[String]) -> bool {
    find_column_index(headers, &["Tipo cliente"]).is_some()
        && find_column_index(headers, &["Codice fiscale"]).is_some()
        && find_column_index(headers, &["Denominazione"]).is_some()
        && find_column_index(headers, &["Numero civico"]).is_some()
}

fn cognome_senza_fake(cognome: &str) -> (String, bool) {
    let trimmed = cognome.trim();
    let upper = trimmed.to_uppercase();
    if upper.ends_with("(FAKE)") {
        let without = trimmed
            .get(..trimmed.len().saturating_sub("(FAKE)".len()))
            .unwrap_or("")
            .trim()
            .to_string();
        (without, true)
    } else {
        (trimmed.to_string(), false)
    }
}

fn indirizzo_con_civico(indirizzo: &str, civico: &str) -> String {
    let via = indirizzo.trim();
    let num = civico.trim();
    if via.is_empty() {
        num.to_string()
    } else if num.is_empty() {
        via.to_string()
    } else {
        format!("{via}, {num}")
    }
}

fn parse_aruba_rows(
    headers: &[String],
    rows: calamine::Rows<'_, Data>,
    clients: &mut Vec<ExtractedClient>,
) {
    let nome_idx = find_column_index(headers, &["Nome"]);
    let cognome_idx = find_column_index(headers, &["Cognome"]);
    let denominazione_idx = find_column_index(headers, &["Denominazione"]);
    let indirizzo_idx = find_column_index(headers, &["Indirizzo"]);
    let civico_idx = find_column_index(headers, &["Numero civico", "Civico"]);
    let cap_idx = find_column_index(headers, &["CAP"]);
    let cit_idx = find_column_index(headers, &["Comune", "CITTA", "CITTA'"]);
    let pr_idx = find_column_index(headers, &["Provincia", "PROV", "PROV."]);
    let tel_idx = find_column_index(headers, &["Telefono", "TEL"]);
    let mail_idx = find_column_index(headers, &["Email", "MAIL", "E-MAIL"]);
    let cf_idx = find_column_index(headers, &["Codice fiscale", "CF", "C.F."]);

    for r in rows {
        let nome = get_cell(r, nome_idx);
        let cognome_raw = get_cell(r, cognome_idx);
        let (cognome, cf_fake) = cognome_senza_fake(&cognome_raw);
        let denominazione = get_cell(r, denominazione_idx);
        let full_name = if !nome.trim().is_empty() || !cognome.trim().is_empty() {
            [nome.trim(), cognome.trim()]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            denominazione.trim().to_string()
        };

        if full_name.is_empty() {
            continue;
        }

        let indirizzo = indirizzo_con_civico(&get_cell(r, indirizzo_idx), &get_cell(r, civico_idx));

        clients.push(ExtractedClient {
            nome: clean_client_name(&full_name),
            indirizzo,
            cap: get_cell(r, cap_idx),
            citta: get_cell(r, cit_idx),
            prov: get_cell(r, pr_idx),
            regione: "".to_string(),
            telefono: get_cell(r, tel_idx),
            email: get_cell(r, mail_idx),
            cf: if cf_fake {
                "".to_string()
            } else {
                get_cell(r, cf_idx)
            },
            note_spedizione: "".to_string(),
        });
    }
}

pub fn parse_file(path: &Path) -> Result<Vec<ExtractedClient>, String> {
    let mut clients = Vec::new();
    let basename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

    let mut xl: Sheets<_> =
        open_workbook_auto(path).map_err(|e| format!("errore apertura file: {e}"))?;
    let sheet_names = xl.sheet_names();

    // 1. File generale 2025
    if basename.contains("File GENERALE 2025") {
        if sheet_names.contains(&"Giornaliero".to_string()) {
            if let Ok(range) = xl.worksheet_range("Giornaliero") {
                let mut rows = range.rows();
                if let Some(header_row) = rows.next() {
                    let headers: Vec<String> = header_row.iter().map(get_string_value).collect();
                    let c_idx = find_column_index(
                        &headers,
                        &[
                            "CLIENTE",
                            "CLIENTE/PAZIENTE",
                            "PAZIENTE",
                            "NOME CLIENTE",
                            "INTESTATARIO",
                        ],
                    );
                    let i_idx = find_column_index(
                        &headers,
                        &[
                            "INDIRIZZO",
                            "INDIRIZZO DI CONSEGNA",
                            "INDIRIZZO CONSEGNA",
                            "VIA",
                            "DESTINAZIONE",
                        ],
                    );
                    let cap_idx = find_column_index(&headers, &["CAP", "CODICE POSTALE", "C.A.P."]);
                    let cit_idx = find_column_index(
                        &headers,
                        &["CITTA", "CITTA'", "COMUNE", "LOCALITA", "LOCALITA'"],
                    );
                    let pr_idx = find_column_index(
                        &headers,
                        &[
                            "PROVINCIA",
                            "PROV",
                            "PRV",
                            "PROV.",
                            "SIGLA PROVINCIA",
                            "SIGLA PROV",
                        ],
                    );
                    let reg_idx = find_column_index(&headers, &["REGIONE"]);
                    let tel_idx = find_column_index(
                        &headers,
                        &[
                            "TELEFONO",
                            "CONTATTI",
                            "TEL",
                            "CELLULARE",
                            "CELL",
                            "RECAPITO",
                        ],
                    );
                    let mail_idx = find_column_index(&headers, &["MAIL", "EMAIL", "E-MAIL"]);
                    let cf_idx = find_column_index(
                        &headers,
                        &["CF", "CODICE FISCALE", "C.F.", "COD. FISC."],
                    );
                    let note_idx = find_column_index(
                        &headers,
                        &[
                            "NOTE DI SPEDIZIONE",
                            "NOTE SPEDIZIONE",
                            "NOTE CONSEGNA",
                            "NOTE CORRIERE",
                            "NOTE/CONSEGNA",
                            "DETTAGLI",
                            "NOTE",
                        ],
                    );

                    for r in rows {
                        if let Some(c) = c_idx {
                            if r.len() > c {
                                let name = get_string_value(&r[c]);
                                if name.is_empty()
                                    || name == "CLIENTE"
                                    || name == "CLIENTE/PAZIENTE"
                                    || name == "DATA"
                                {
                                    continue;
                                }
                                clients.push(ExtractedClient {
                                    nome: clean_client_name(&name),
                                    indirizzo: i_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    cap: cap_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    citta: cit_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    prov: pr_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    regione: reg_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    telefono: tel_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    email: mail_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    cf: cf_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    note_spedizione: note_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    // 2. Giornaliero.xlsx
    else if basename.contains("Giornaliero") {
        for sname in &sheet_names {
            let is_year_sheet = sname
                .parse::<i32>()
                .map(|yr| (2000..=2099).contains(&yr))
                .unwrap_or(false);
            if is_year_sheet {
                if let Ok(range) = xl.worksheet_range(sname) {
                    let mut rows = range.rows();

                    let mut start_row_is_data = false;

                    if let Some(first_row) = rows.next() {
                        let first_row_strs: Vec<String> =
                            first_row.iter().map(get_string_value).collect();
                        let first_row_joined = first_row_strs.join(" ").to_uppercase();

                        let headers = if first_row_joined.contains("CLIENTE")
                            || first_row_joined.contains("PAZIENTE")
                            || first_row_joined.contains("DATA")
                        {
                            first_row_strs
                        } else {
                            start_row_is_data = true;
                            // Set virtual columns
                            if sname == "2023" {
                                let mut h = vec!["".to_string(); 20];
                                h[4] = "CLIENTE".to_string();
                                h[5] = "INDIRIZZO".to_string();
                                h[6] = "CAP".to_string();
                                h[7] = "CITTA".to_string();
                                h[8] = "PROV".to_string();
                                h[9] = "REGIONE".to_string();
                                h[12] = "TELEFONO".to_string();
                                h
                            } else {
                                // Default / 2024 structure
                                let mut h = vec!["".to_string(); 20];
                                h[5] = "CLIENTE".to_string();
                                h[6] = "INDIRIZZO".to_string();
                                h[7] = "CAP".to_string();
                                h[8] = "CITTA".to_string();
                                h[9] = "PROV".to_string();
                                h[10] = "REGIONE".to_string();
                                h[13] = "TELEFONO".to_string();
                                h
                            }
                        };

                        let c_idx = find_column_index(
                            &headers,
                            &[
                                "CLIENTE",
                                "CLIENTE/PAZIENTE",
                                "PAZIENTE",
                                "NOME CLIENTE",
                                "INTESTATARIO",
                            ],
                        );
                        let i_idx = find_column_index(
                            &headers,
                            &[
                                "INDIRIZZO",
                                "INDIRIZZO DI CONSEGNA",
                                "INDIRIZZO CONSEGNA",
                                "VIA",
                                "DESTINAZIONE",
                            ],
                        );
                        let cap_idx =
                            find_column_index(&headers, &["CAP", "CODICE POSTALE", "C.A.P."]);
                        let cit_idx = find_column_index(
                            &headers,
                            &["CITTA", "CITTA'", "COMUNE", "LOCALITA", "LOCALITA'"],
                        );
                        let pr_idx = find_column_index(
                            &headers,
                            &[
                                "PROVINCIA",
                                "PROV",
                                "PRV",
                                "PROV.",
                                "SIGLA PROVINCIA",
                                "SIGLA PROV",
                            ],
                        );
                        let reg_idx = find_column_index(&headers, &["REGIONE"]);
                        let tel_idx = find_column_index(
                            &headers,
                            &[
                                "TELEFONO",
                                "CONTATTI",
                                "TEL",
                                "CELLULARE",
                                "CELL",
                                "RECAPITO",
                            ],
                        );
                        let mail_idx = find_column_index(&headers, &["MAIL", "EMAIL", "E-MAIL"]);
                        let cf_idx = find_column_index(
                            &headers,
                            &["CF", "CODICE FISCALE", "C.F.", "COD. FISC."],
                        );
                        let note_idx = find_column_index(
                            &headers,
                            &[
                                "NOTE DI SPEDIZIONE",
                                "NOTE SPEDIZIONE",
                                "NOTE CONSEGNA",
                                "NOTE CORRIERE",
                                "NOTE/CONSEGNA",
                                "NOTE/ORDINE RIFIUTATO",
                                "DETTAGLI",
                                "NOTE",
                            ],
                        );

                        let process_row = |r: &[Data], clients_list: &mut Vec<ExtractedClient>| {
                            if let Some(c) = c_idx {
                                if r.len() > c {
                                    let name = get_string_value(&r[c]);
                                    if !name.is_empty()
                                        && name != "CLIENTE"
                                        && name != "CLIENTE/PAZIENTE"
                                        && name != "DATA"
                                    {
                                        clients_list.push(ExtractedClient {
                                            nome: clean_client_name(&name),
                                            indirizzo: i_idx
                                                .and_then(|idx| r.get(idx))
                                                .map(get_string_value)
                                                .unwrap_or_default(),
                                            cap: cap_idx
                                                .and_then(|idx| r.get(idx))
                                                .map(get_string_value)
                                                .unwrap_or_default(),
                                            citta: cit_idx
                                                .and_then(|idx| r.get(idx))
                                                .map(get_string_value)
                                                .unwrap_or_default(),
                                            prov: pr_idx
                                                .and_then(|idx| r.get(idx))
                                                .map(get_string_value)
                                                .unwrap_or_default(),
                                            regione: reg_idx
                                                .and_then(|idx| r.get(idx))
                                                .map(get_string_value)
                                                .unwrap_or_default(),
                                            telefono: tel_idx
                                                .and_then(|idx| r.get(idx))
                                                .map(get_string_value)
                                                .unwrap_or_default(),
                                            email: mail_idx
                                                .and_then(|idx| r.get(idx))
                                                .map(get_string_value)
                                                .unwrap_or_default(),
                                            cf: cf_idx
                                                .and_then(|idx| r.get(idx))
                                                .map(get_string_value)
                                                .unwrap_or_default(),
                                            note_spedizione: note_idx
                                                .and_then(|idx| r.get(idx))
                                                .map(get_string_value)
                                                .unwrap_or_default(),
                                        });
                                    }
                                }
                            }
                        };

                        if start_row_is_data {
                            process_row(first_row, &mut clients);
                        }
                        for r in rows {
                            process_row(r, &mut clients);
                        }
                    }
                }
            }
        }
    }
    // 3. Monthly reports
    else {
        for sname in &sheet_names {
            if let Ok(range) = xl.worksheet_range(sname) {
                let mut rows = range.rows();
                if let Some(header_row) = rows.next() {
                    let headers: Vec<String> = header_row.iter().map(get_string_value).collect();

                    if is_aruba_headers(&headers) {
                        parse_aruba_rows(&headers, rows, &mut clients);
                        continue;
                    }

                    let c_idx = find_column_index(
                        &headers,
                        &[
                            "CLIENTE",
                            "CLIENTE/PAZIENTE",
                            "PAZIENTE",
                            "NOME CLIENTE",
                            "INTESTATARIO",
                        ],
                    );

                    if let Some(c) = c_idx {
                        let i_idx = find_column_index(
                            &headers,
                            &[
                                "INDIRIZZO",
                                "INDIRIZZO DI CONSEGNA",
                                "INDIRIZZO CONSEGNA",
                                "VIA",
                                "DESTINAZIONE",
                            ],
                        );
                        let cap_idx =
                            find_column_index(&headers, &["CAP", "CODICE POSTALE", "C.A.P."]);
                        let cit_idx = find_column_index(
                            &headers,
                            &["CITTA", "CITTA'", "COMUNE", "LOCALITA", "LOCALITA'"],
                        );
                        let pr_idx = find_column_index(
                            &headers,
                            &[
                                "PROVINCIA",
                                "PROV",
                                "PRV",
                                "PROV.",
                                "SIGLA PROVINCIA",
                                "SIGLA PROV",
                            ],
                        );
                        let reg_idx = find_column_index(&headers, &["REGIONE"]);
                        let tel_idx = find_column_index(
                            &headers,
                            &[
                                "TELEFONO",
                                "TEL",
                                "CONTATTI",
                                "CELLULARE",
                                "CELL",
                                "RECAPITO",
                            ],
                        );
                        let mail_idx = find_column_index(&headers, &["EMAIL", "MAIL", "E-MAIL"]);
                        let cf_idx = find_column_index(
                            &headers,
                            &["CF", "CODICE FISCALE", "C.F.", "COD. FISC."],
                        );
                        let note_idx = find_column_index(
                            &headers,
                            &[
                                "NOTE DI SPEDIZIONE",
                                "NOTE SPEDIZIONE",
                                "NOTE CONSEGNA",
                                "NOTE CORRIERE",
                                "NOTE/CONSEGNA",
                                "NOTE/ORDINE RIFIUTATO",
                                "DETTAGLI",
                                "NOTE",
                            ],
                        );

                        for r in rows {
                            if r.len() > c {
                                let name = get_string_value(&r[c]);
                                if name.is_empty()
                                    || name == "CLIENTE"
                                    || name == "CLIENTE/PAZIENTE"
                                    || name == "DATA"
                                {
                                    continue;
                                }
                                clients.push(ExtractedClient {
                                    nome: clean_client_name(&name),
                                    indirizzo: i_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    cap: cap_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    citta: cit_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    prov: pr_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    regione: reg_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    telefono: tel_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    email: mail_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    cf: cf_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                    note_spedizione: note_idx
                                        .and_then(|idx| r.get(idx))
                                        .map(get_string_value)
                                        .unwrap_or_default(),
                                });
                            }
                        }
                    } else if sname.contains("INTEGRATORI")
                        || headers.iter().any(|h| h.contains("INTEGRATORI"))
                    {
                        // Integrators format: DATA, MEDICO, AGENTE, CLIENTE, TEL, ...
                        let c_idx = find_column_index(&headers, &["CLIENTE"]);
                        let tel_idx = find_column_index(&headers, &["TEL", "TELEFONO"]);

                        if let Some(c) = c_idx {
                            for r in rows {
                                if r.len() > c {
                                    let name = get_string_value(&r[c]);
                                    if !name.is_empty() && name != "CLIENTE" && name != "DATA" {
                                        clients.push(ExtractedClient {
                                            nome: clean_client_name(&name),
                                            indirizzo: "".to_string(),
                                            cap: "".to_string(),
                                            citta: "".to_string(),
                                            prov: "".to_string(),
                                            regione: "".to_string(),
                                            telefono: tel_idx
                                                .and_then(|idx| r.get(idx))
                                                .map(get_string_value)
                                                .unwrap_or_default(),
                                            email: "".to_string(),
                                            cf: "".to_string(),
                                            note_spedizione: "".to_string(),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(clients)
}

pub fn import_all_files(
    path_generale: &str,
    path_giornaliero: &str,
    path_report_folder: &str,
) -> Result<Vec<ExtractedClient>, String> {
    let mut all_clients = Vec::new();

    // Parse General
    if !path_generale.is_empty() {
        for p_str in path_generale.split(';') {
            let trimmed = p_str.trim();
            if !trimmed.is_empty() {
                let p = Path::new(trimmed);
                if p.exists() {
                    if let Ok(mut cls) = parse_file(p) {
                        all_clients.append(&mut cls);
                    }
                }
            }
        }
    }

    // Parse Giornaliero
    if !path_giornaliero.is_empty() {
        for p_str in path_giornaliero.split(';') {
            let trimmed = p_str.trim();
            if !trimmed.is_empty() {
                let p = Path::new(trimmed);
                if p.exists() {
                    if let Ok(mut cls) = parse_file(p) {
                        all_clients.append(&mut cls);
                    }
                }
            }
        }
    }

    // Parse monthly reports
    if !path_report_folder.is_empty() {
        let folder = Path::new(path_report_folder);
        if folder.exists() && folder.is_dir() {
            if let Ok(entries) = std::fs::read_dir(folder) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        let ext = p
                            .extension()
                            .and_then(|ext| ext.to_str())
                            .unwrap_or("")
                            .to_lowercase();
                        if ext == "xlsx" || ext == "xlsm" || ext == "xls" {
                            if let Ok(mut cls) = parse_file(&p) {
                                all_clients.append(&mut cls);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(all_clients)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_xlsxwriter::Workbook;

    #[test]
    fn test_parse_real_files() {
        let p1 = Path::new(r"C:\Users\lucat\Linux\PharmaTek\File GENERALE 2025.xlsm");
        if p1.exists() {
            let res = parse_file(p1);
            assert!(
                res.is_ok(),
                "Errore nel parsing di File GENERALE 2025: {:?}",
                res.err()
            );
            let cls = res.unwrap();
            println!("Parsed File GENERALE 2025: {} record trovati", cls.len());
        }

        let p2 = Path::new(r"C:\Users\lucat\Downloads\2026\Giornaliero.xlsx");
        if p2.exists() {
            let res = parse_file(p2);
            assert!(
                res.is_ok(),
                "Errore nel parsing di Giornaliero.xlsx: {:?}",
                res.err()
            );
            let cls = res.unwrap();
            println!("Parsed Giornaliero.xlsx: {} record trovati", cls.len());
        }

        let p3 = Path::new(r"C:\Users\lucat\Downloads\Giornaliero_2022-2024.xlsx");
        if p3.exists() {
            let res = parse_file(p3);
            assert!(
                res.is_ok(),
                "Errore nel parsing di Giornaliero_2022-2024.xlsx: {:?}",
                res.err()
            );
            let cls = res.unwrap();
            println!(
                "Parsed Giornaliero_2022-2024.xlsx: {} record trovati",
                cls.len()
            );
        }
    }

    #[test]
    fn parse_aruba_export_format() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clienti-aruba.xlsx");
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        let headers = [
            "Codice cliente",
            "Tipo cliente",
            "Indirizzo telematico (Codice SDI o PEC)",
            "Email",
            "PEC",
            "Telefono",
            "ID Paese",
            "Partita Iva   ",
            "Codice fiscale",
            "Denominazione",
            "Nome",
            "Cognome",
            "Codice EORI (solo Privati)",
            "Nazione",
            "CAP",
            "Provincia",
            "Comune",
            "Indirizzo",
            "Numero civico",
            "Beneficiario",
            "Condizioni di pagamento",
            "Metodo di pagamento",
            "Banca",
        ];
        for (col, header) in headers.iter().enumerate() {
            ws.write_string(0, col as u16, *header).unwrap();
        }
        let values = [
            "",
            "Privato",
            "",
            "demo@example.invalid",
            "",
            "3331234567",
            "IT",
            "",
            "RSSMRA80A01H501U",
            "ROSSI MARIO",
            "MARIO",
            "ROSSI",
            "",
            "IT",
            "00100",
            "RM",
            "Roma",
            "Via Test",
            "12",
            "",
            "",
            "",
            "",
        ];
        for (col, value) in values.iter().enumerate() {
            ws.write_string(1, col as u16, *value).unwrap();
        }
        let fake_values = [
            "",
            "Privato",
            "",
            "demo@example.invalid",
            "",
            "3337654321",
            "IT",
            "",
            "XXXYYY60A01H501Z",
            "BIANCHI GIULIA",
            "GIULIA",
            "BIANCHI (FAKE)",
            "",
            "IT",
            "20100",
            "MI",
            "Milano",
            "Via Prova",
            "7",
            "",
            "",
            "",
            "",
        ];
        for (col, value) in fake_values.iter().enumerate() {
            ws.write_string(2, col as u16, *value).unwrap();
        }
        wb.save(&path).unwrap();

        let clients = parse_file(&path).unwrap();
        assert_eq!(clients.len(), 2);
        assert_eq!(clients[0].nome, "MARIO ROSSI");
        assert_eq!(clients[0].indirizzo, "Via Test, 12");
        assert_eq!(clients[0].citta, "Roma");
        assert_eq!(clients[0].prov, "RM");
        assert_eq!(clients[0].cap, "00100");
        assert_eq!(clients[0].telefono, "3331234567");
        assert_eq!(clients[0].email, "demo@example.invalid");
        assert_eq!(clients[0].cf, "RSSMRA80A01H501U");

        assert_eq!(clients[1].nome, "GIULIA BIANCHI");
        assert_eq!(clients[1].indirizzo, "Via Prova, 7");
        assert_eq!(clients[1].cf, "");
    }
}
