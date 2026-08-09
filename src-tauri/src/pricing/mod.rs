//! Motore di risoluzione del prezzo (listino).
//!
//! Dato un prodotto e il contesto dell'ordine (medico → agente, categoria), il
//! prezzo **suggerito** si risolve con la regola **"più specifica vince"**
//! (vedi `docs/MODELLO-DATI.md`):
//!
//! `medico+prodotto → agente+prodotto → categoria → prodotto.default`
//!
//! Il prezzo risolto è solo un **suggerimento**: sull'ordine resta sempre
//! modificabile a mano. Gli importi sono interi in **centesimi**.

/// Una regola di listino. Tutti i criteri sono opzionali: la combinazione
/// determina a quale livello della gerarchia la regola partecipa.
#[derive(Debug, Clone, PartialEq)]
pub struct RegolaPrezzo {
    pub id: String,
    pub prodotto_id: Option<String>,
    pub categoria: Option<String>,
    pub agente_id: Option<String>,
    pub medico_id: Option<String>,
    pub prezzo: i64,
}

/// Contesto per cui si vuole il prezzo.
#[derive(Debug, Clone)]
pub struct Contesto<'a> {
    pub prodotto_id: &'a str,
    pub categoria: &'a str,
    pub prezzo_base_default: i64,
    pub agente_id: Option<&'a str>,
    pub medico_id: Option<&'a str>,
}

/// Da dove proviene il prezzo risolto (per trasparenza nella UI).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fonte {
    MedicoProdotto,
    AgenteProdotto,
    Categoria,
    DefaultProdotto,
}

impl Fonte {
    /// Codice stabile usato nel DTO verso il frontend.
    pub fn codice(self) -> &'static str {
        match self {
            Fonte::MedicoProdotto => "medico_prodotto",
            Fonte::AgenteProdotto => "agente_prodotto",
            Fonte::Categoria => "categoria",
            Fonte::DefaultProdotto => "default",
        }
    }
}

/// Esito della risoluzione.
#[derive(Debug, Clone, PartialEq)]
pub struct Risolto {
    pub prezzo: i64,
    pub fonte: Fonte,
    pub regola_id: Option<String>,
}

/// Risolve il prezzo per `ctx` applicando la prima regola che matcha nell'ordine
/// di specificità decrescente; se nessuna matcha, usa il prezzo base del prodotto.
pub fn risolvi(ctx: &Contesto, regole: &[RegolaPrezzo]) -> Risolto {
    // 1. medico + prodotto
    if let Some(medico) = ctx.medico_id {
        if let Some(r) = regole.iter().find(|r| {
            r.medico_id.as_deref() == Some(medico)
                && r.prodotto_id.as_deref() == Some(ctx.prodotto_id)
        }) {
            return Risolto {
                prezzo: r.prezzo,
                fonte: Fonte::MedicoProdotto,
                regola_id: Some(r.id.clone()),
            };
        }
    }

    // 2. agente + prodotto
    if let Some(agente) = ctx.agente_id {
        if let Some(r) = regole.iter().find(|r| {
            r.agente_id.as_deref() == Some(agente)
                && r.prodotto_id.as_deref() == Some(ctx.prodotto_id)
        }) {
            return Risolto {
                prezzo: r.prezzo,
                fonte: Fonte::AgenteProdotto,
                regola_id: Some(r.id.clone()),
            };
        }
    }

    // 3. categoria (regola "pura" di categoria, senza altri criteri)
    if let Some(r) = regole.iter().find(|r| {
        r.categoria.as_deref() == Some(ctx.categoria)
            && r.prodotto_id.is_none()
            && r.medico_id.is_none()
            && r.agente_id.is_none()
    }) {
        return Risolto {
            prezzo: r.prezzo,
            fonte: Fonte::Categoria,
            regola_id: Some(r.id.clone()),
        };
    }

    // 4. prezzo base del prodotto
    Risolto {
        prezzo: ctx.prezzo_base_default,
        fonte: Fonte::DefaultProdotto,
        regola_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn regola(
        id: &str,
        prodotto: Option<&str>,
        categoria: Option<&str>,
        agente: Option<&str>,
        medico: Option<&str>,
        prezzo: i64,
    ) -> RegolaPrezzo {
        RegolaPrezzo {
            id: id.into(),
            prodotto_id: prodotto.map(Into::into),
            categoria: categoria.map(Into::into),
            agente_id: agente.map(Into::into),
            medico_id: medico.map(Into::into),
            prezzo,
        }
    }

    fn ctx<'a>(agente: Option<&'a str>, medico: Option<&'a str>) -> Contesto<'a> {
        Contesto {
            prodotto_id: "P1",
            categoria: "Immunoterapia",
            prezzo_base_default: 1000,
            agente_id: agente,
            medico_id: medico,
        }
    }

    #[test]
    fn nessuna_regola_usa_il_default() {
        let r = risolvi(&ctx(Some("A1"), Some("M1")), &[]);
        assert_eq!(r.prezzo, 1000);
        assert_eq!(r.fonte, Fonte::DefaultProdotto);
        assert!(r.regola_id.is_none());
    }

    #[test]
    fn regola_categoria() {
        let regole = vec![regola(
            "r-cat",
            None,
            Some("Immunoterapia"),
            None,
            None,
            800,
        )];
        let r = risolvi(&ctx(Some("A1"), Some("M1")), &regole);
        assert_eq!(r.prezzo, 800);
        assert_eq!(r.fonte, Fonte::Categoria);
        assert_eq!(r.regola_id.as_deref(), Some("r-cat"));
    }

    #[test]
    fn agente_prodotto_batte_categoria() {
        let regole = vec![
            regola("r-cat", None, Some("Immunoterapia"), None, None, 800),
            regola("r-ag", Some("P1"), None, Some("A1"), None, 700),
        ];
        let r = risolvi(&ctx(Some("A1"), Some("M1")), &regole);
        assert_eq!(r.prezzo, 700);
        assert_eq!(r.fonte, Fonte::AgenteProdotto);
        assert_eq!(r.regola_id.as_deref(), Some("r-ag"));
    }

    #[test]
    fn medico_prodotto_batte_tutto() {
        let regole = vec![
            regola("r-cat", None, Some("Immunoterapia"), None, None, 800),
            regola("r-ag", Some("P1"), None, Some("A1"), None, 700),
            regola("r-med", Some("P1"), None, None, Some("M1"), 650),
        ];
        let r = risolvi(&ctx(Some("A1"), Some("M1")), &regole);
        assert_eq!(r.prezzo, 650);
        assert_eq!(r.fonte, Fonte::MedicoProdotto);
        assert_eq!(r.regola_id.as_deref(), Some("r-med"));
    }

    #[test]
    fn regola_di_altro_agente_o_medico_non_si_applica() {
        let regole = vec![
            regola("r-ag2", Some("P1"), None, Some("A2"), None, 700),
            regola("r-med2", Some("P1"), None, None, Some("M2"), 650),
        ];
        // Il nostro contesto è agente A1, medico M1: nessuna delle due matcha.
        let r = risolvi(&ctx(Some("A1"), Some("M1")), &regole);
        assert_eq!(r.prezzo, 1000);
        assert_eq!(r.fonte, Fonte::DefaultProdotto);
    }

    #[test]
    fn agente_prodotto_richiede_il_prodotto_giusto() {
        let regole = vec![regola("r-ag", Some("P9"), None, Some("A1"), None, 700)];
        // La regola è per il prodotto P9, ma il contesto è P1.
        let r = risolvi(&ctx(Some("A1"), Some("M1")), &regole);
        assert_eq!(r.fonte, Fonte::DefaultProdotto);
    }

    #[test]
    fn senza_medico_si_parte_da_agente() {
        let regole = vec![regola("r-med", Some("P1"), None, None, Some("M1"), 650)];
        // Ordine senza medico: la regola medico+prodotto non è applicabile.
        let r = risolvi(&ctx(Some("A1"), None), &regole);
        assert_eq!(r.fonte, Fonte::DefaultProdotto);
    }
}
