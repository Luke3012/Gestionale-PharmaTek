//! Rilevatore di notifiche lato Rust (FASE 6D — affidabilità in background).
//!
//! WebView2 **congela timer JS e audio** quando la finestra non è in primo piano e,
//! soprattutto, **sospende del tutto il renderer** quando la finestra è nascosta nella
//! tray (avvio automatico `--minimized`, chiusura in tray). In quei casi il webview non
//! può né rilevare né suonare nulla. Qui il **Rust** rideriva le notifiche correnti
//! dalla proiezione, decide cosa è nuovo e **riproduce il suono nativamente** (rodio) +
//! pilota i **pop-up custom** — sempre, anche a finestra nascosta.
//!
//! **Pop-up custom al posto del balloon di sistema (anticipo FASE 7).** Nel percorso
//! ordinario, quando c'è una notifica nuova **e** la finestra principale è in background,
//! emettiamo l'evento
//! `pt:notifiche-nuove` (col payload completo) alla finestra `overlay`, una finestra
//! trasparente always-on-top che viene risvegliata prima della consegna e disegna le
//! card animate. Il payload porta tutto ciò che
//! serve all'overlay per agire (tipo, urgenza, collegamento da aprire, id promemoria,
//! mittente del messaggio 6E per la risposta inline).
//!
//! **De-dup UNIFICATA (mai due volte).** Il suono/pop-up è di competenza *esclusiva*
//! del Rust: il webview NON suona più (vedi `features/notifiche/useNotifiche.ts`). Con
//! un solo "suonatore" il doppio avviso è impossibile per costruzione. La sorgente
//! "già avvisato" vive qui (`Stato::avvisate`), allineata agli stessi id stabili del
//! webview (`sollecito:…`, `promem-pre/scaduto:…`, `marcatore:…`) e al loro stato
//! letto/scartato (`notifica_letta`): una notifica già **letta** non viene avvisata.
//!
//! Trigger: un timer di fondo (ogni 5 s, copre i cambi da altri PC e i passaggi di
//! data anche a finestra nascosta) + le chiamate del webview quando è vivo
//! (`notifiche_config` al cambio preferenze, `notifiche_check` a ogni ricarica) per un
//! avviso immediato. All'avvio si **semina** (marca come già avvisato tutto ciò che è
//! già presente) per non sparare la raffica dell'arretrato.
//!
//! NB FASE 7: l'overlay visivo always-on-top e l'eventuale risposta tra PC (6E) si
//! appoggeranno a questo stesso rilevatore e alla sua de-dup unificata — non
//! reintrodurre un secondo percorso di avviso lato webview.

use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Local;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::app::{
    AppState, SuggerimentiBundleDto, SuggerimentiPreferenzeInput, SuggerimentoCollegamentoDto,
    SuggerimentoDto, SyncPollOutcome,
};
use crate::data_events::emetti_entita_modificate;

const GIORNO_MS: i64 = 86_400_000;
const RIVALIDAZIONE_SUGGERIMENTO_MS: i64 = 60_000;
const MAX_NOTIFICHE_OVERLAY_IN_ATTESA: usize = 99;

#[derive(Clone, PartialEq, Eq)]
struct PreferenzeSuggerimenti {
    tipi_abilitati: HashSet<String>,
    notifiche_attive: bool,
    giorni_avviso: HashMap<String, i64>,
    anno: i32,
}

fn normalizza_preferenze_suggerimenti(
    input: SuggerimentiPreferenzeInput,
) -> PreferenzeSuggerimenti {
    let tipi_abilitati = input
        .tipi_abilitati
        .into_iter()
        .filter(|tipo| crate::app::suggestions::TIPI_SUGGERIMENTO.contains(&tipo.as_str()))
        .collect();
    let giorni_avviso = crate::app::suggestions::TIPI_SUGGERIMENTO
        .into_iter()
        .map(|tipo| {
            (
                tipo.to_string(),
                input
                    .giorni_avviso
                    .get(tipo)
                    .copied()
                    .unwrap_or(0)
                    .clamp(0, 90),
            )
        })
        .collect();
    PreferenzeSuggerimenti {
        tipi_abilitati,
        notifiche_attive: input.notifiche_attive,
        giorni_avviso,
        anno: input.anno,
    }
}

/// Configurazione inviata dal webview (preferenze utente correnti).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificheConfigInput {
    user_id: String,
    suono: String,
    balloon: bool,
    soglia: i64,
    onboarding_time: i64,
    primo_piano: bool,
    suggerimenti: SuggerimentiPreferenzeInput,
}

#[derive(Clone, PartialEq, Eq)]
struct Cfg {
    user_id: String,
    /// Id del suono (vedi `features/notifiche/suoni`); `"nessuno"` = muto.
    suono: String,
    /// Mostrare i pop-up custom (overlay) quando l'app è in background (pref `balloonAttivo`).
    popup: bool,
    /// Mostrare i pop-up anche con l'app in primo piano (pref `notifichePrimoPiano`).
    popup_primo_piano: bool,
    /// Giorni dopo la scadenza prima di sollecitare (0 = dal giorno stesso).
    soglia: i64,
    onboarding_time: i64,
    suggerimenti: PreferenzeSuggerimenti,
}

struct CacheSuggerimenti {
    sporca: bool,
    soglia_preventivo: Option<i64>,
    anno: Option<i32>,
    giorno_preventivi: Option<String>,
    bundle: Option<SuggerimentiBundleDto>,
    /// Prima osservazione locale della fotografia corrente. Impedisce che una
    /// card residua avvisi subito dopo un'azione parziale sulle sorgenti.
    rilevati_ms: HashMap<String, i64>,
}

impl Default for CacheSuggerimenti {
    fn default() -> Self {
        Self {
            sporca: true,
            soglia_preventivo: None,
            anno: None,
            giorno_preventivi: None,
            bundle: None,
            rilevati_ms: HashMap::new(),
        }
    }
}

fn aggiorna_rilevati_ms<'a>(
    rilevati_ms: &mut HashMap<String, i64>,
    ids_correnti: impl IntoIterator<Item = &'a str>,
    ora: i64,
) {
    let correnti: HashSet<&str> = ids_correnti.into_iter().collect();
    rilevati_ms.retain(|id, _| correnti.contains(id.as_str()));
    for id in correnti {
        rilevati_ms.entry(id.to_string()).or_insert(ora);
    }
}

/// Stato protetto del rilevatore.
#[derive(Default)]
struct Stato {
    /// Id già avvisati e ANCORA pendenti: viene **riconciliato** a ogni scansione con le
    /// notifiche correnti non lette (vedi `scansiona`), così un id che diventa letto o si
    /// risolve esce dal set e potrà ri-allertare se in futuro ritorna.
    avvisate: HashSet<String>,
    /// Ultima «riattivazione» vista per ciascun id (timestamp del record `notifica_letta`
    /// con `letta:false`, scritto quando es. si modifica un promemoria): se cresce, l'id
    /// torna da avvisare **una sola volta** per riattivazione (niente loop).
    reatt_viste: HashMap<String, i64>,
    /// Ultimo avviso (o invio originario, durante la semina) per i messaggi
    /// ancora non letti. Dopo un giorno consente un nuovo avviso con lo stesso
    /// id applicativo, senza creare duplicati nella campanella.
    messaggi_avvisati_ms: HashMap<String, i64>,
    seminato: bool,
}

impl Stato {
    /// Controllo solo in memoria: consente al timer da 5s di rispettare la scadenza
    /// giornaliera dei messaggi senza riaprire SQLite a ogni giro.
    fn riavviso_messaggio_dovuto_a(&self, ora: i64) -> bool {
        self.messaggi_avvisati_ms
            .values()
            .any(|ultimo| *ultimo > 0 && ora.saturating_sub(*ultimo) >= GIORNO_MS)
    }

    /// Diff de-dup: dato l'insieme **corrente** di notifiche non lette, ritorna quelle
    /// **nuove** da avvisare (e le marca come avvisate), oppure `None` al primo giro
    /// (semina silenziosa, salvo messaggi non letti da almeno un giorno). È pura e
    /// testabile: garantisce
    /// che ogni notifica nuova esca **una volta** e che la seconda/terza escano comunque
    /// (regressione storica «si ferma dopo la prima»).
    fn nuove_da_avvisare(
        &mut self,
        correnti: Vec<Notif>,
        reatt: &HashMap<String, i64>,
    ) -> Option<Vec<Notif>> {
        self.nuove_da_avvisare_a(correnti, reatt, ora_ms())
    }

    fn nuove_da_avvisare_a(
        &mut self,
        correnti: Vec<Notif>,
        reatt: &HashMap<String, i64>,
        ora: i64,
    ) -> Option<Vec<Notif>> {
        if !self.seminato {
            let mut promemoria_messaggi = Vec::new();
            for n in &correnti {
                self.avvisate.insert(n.id.clone());
                if n.tipo == "messaggio" {
                    let riferimento = n.origine_ms.max(0);
                    if riferimento > 0 && ora.saturating_sub(riferimento) >= GIORNO_MS {
                        promemoria_messaggi.push(n.clone());
                        self.messaggi_avvisati_ms.insert(n.id.clone(), ora);
                    } else {
                        self.messaggi_avvisati_ms.insert(n.id.clone(), riferimento);
                    }
                }
            }
            // Memorizza le riattivazioni già presenti, così non ri-suonano alla prima scansione.
            for (id, ts) in reatt {
                self.reatt_viste.insert(id.clone(), *ts);
            }
            self.seminato = true;
            return if promemoria_messaggi.is_empty() {
                None
            } else {
                Some(promemoria_messaggi)
            };
        }
        let correnti_ids: HashSet<String> = correnti.iter().map(|n| n.id.clone()).collect();
        let messaggi_correnti: HashSet<String> = correnti
            .iter()
            .filter(|n| n.tipo == "messaggio")
            .map(|n| n.id.clone())
            .collect();
        self.avvisate.retain(|id| correnti_ids.contains(id));
        self.reatt_viste.retain(|id, _| reatt.contains_key(id));
        self.messaggi_avvisati_ms
            .retain(|id, _| messaggi_correnti.contains(id));
        // Riattivazioni: quando si **modifica** un promemoria, il suo stato di lettura viene
        // azzerato (record `notifica_letta` con `letta:false`, ts aggiornato). Se quel ts è
        // più recente dell'ultimo trattato, l'id torna «da avvisare» — UNA sola volta per
        // riattivazione (ricordiamo il ts) così l'utente risente il suono/pop-up della
        // notifica anche se l'id è stabile, senza loop a ogni scansione.
        for (id, ts) in reatt {
            if self.reatt_viste.get(id).copied().unwrap_or(i64::MIN) < *ts {
                self.avvisate.remove(id);
                self.reatt_viste.insert(id.clone(), *ts);
            }
        }
        for notifica in correnti.iter().filter(|n| n.tipo == "messaggio") {
            let ultimo = self
                .messaggi_avvisati_ms
                .entry(notifica.id.clone())
                .or_insert(notifica.origine_ms.max(0));
            if *ultimo > 0 && ora.saturating_sub(*ultimo) >= GIORNO_MS {
                self.avvisate.remove(&notifica.id);
            }
        }
        let nuove: Vec<Notif> = correnti
            .into_iter()
            .filter(|n| !self.avvisate.contains(&n.id))
            .collect();
        for n in &nuove {
            self.avvisate.insert(n.id.clone());
            if n.tipo == "messaggio" {
                self.messaggi_avvisati_ms.insert(n.id.clone(), ora);
            }
        }
        Some(nuove)
    }
}

/// Una notifica corrente derivata: id stabile + testo per il suono/balloon **e** il
/// payload completo per i pop-up custom (serializzato verso la finestra `overlay`).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Notif {
    id: String,
    /// "sollecito" | "promemoria_scaduto" | "promemoria_scadenza" | "marcatore" | "messaggio".
    tipo: String,
    /// "scaduto" | "oggi" | "presto" | "info" (colore + persistenza dell'overlay).
    urgenza: String,
    titolo: String,
    dettaglio: String,
    /// Entità da aprire al click (vuoto = niente): "ordine"|"cliente"|"medico"|"agente".
    collegato_tipo: String,
    collegato_id: String,
    collegato_nome: String,
    /// Se è la notifica di un promemoria, il suo id (al click si apre il promemoria).
    promemoria_id: String,
    /// Se è un messaggio 6E, l'id del mittente (per la risposta inline dall'overlay).
    mittente_id: String,
    /// Timestamp dell'evento originario, usato solo dal de-dup nativo.
    #[serde(skip_serializing)]
    origine_ms: i64,
    /// La riattivazione manuale dalla Dashboard richiede la card completa, non il riepilogo.
    mostra_completa: bool,
    /// Deep-link FASE 14; assente per le notifiche collegate a un record.
    suggerimento_collegamento: Option<SuggerimentoCollegamentoDto>,
}

/// Durante la migrazione possono convivere la vecchia chiave `letta|…` e la nuova
/// `stato-notifica-v2|…`. Per ogni notifica conta soltanto l'azione più recente;
/// a parità di timestamp l'id v2 (lessicograficamente maggiore) vince in modo stabile.
fn ultimi_stati_lettura(
    recs: Vec<crate::app::RecordDto>,
    user_id: &str,
) -> HashMap<String, (i64, bool)> {
    let mut ultimi: HashMap<String, (i64, String, bool)> = HashMap::new();
    for r in recs {
        if r.data.get("user_id").and_then(|v| v.as_str()) != Some(user_id) {
            continue;
        }
        let Some(id) = r.data.get("notifica_id").and_then(|v| v.as_str()) else {
            continue;
        };
        let ts = r.data.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
        let letta = r.data.get("letta").and_then(|v| v.as_bool()) != Some(false);
        if let Some((precedente_ts, precedente_record, _)) = ultimi.get(id) {
            if *precedente_ts > ts || (*precedente_ts == ts && precedente_record > &r.id) {
                continue;
            }
        }
        ultimi.insert(id.to_string(), (ts, r.id, letta));
    }
    ultimi
        .into_iter()
        .map(|(id, (ts, _, letta))| (id, (ts, letta)))
        .collect()
}

/// Riattivazioni create esplicitamente dal comando «Notifica...» della Dashboard.
/// Consideriamo soltanto il record vincente con le stesse regole dello stato letto,
/// così una lettura successiva o una normale riattivazione cancella correttamente il flag.
fn ultime_riattivazioni_dashboard(
    recs: Vec<crate::app::RecordDto>,
    user_id: &str,
) -> HashMap<String, i64> {
    let mut ultimi: HashMap<String, (i64, String, bool, bool)> = HashMap::new();
    for r in recs {
        if r.data.get("user_id").and_then(|v| v.as_str()) != Some(user_id) {
            continue;
        }
        let Some(id) = r.data.get("notifica_id").and_then(|v| v.as_str()) else {
            continue;
        };
        let ts = r.data.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
        let letta = r.data.get("letta").and_then(|v| v.as_bool()) != Some(false);
        let dashboard =
            r.data.get("origine_riattivazione").and_then(|v| v.as_str()) == Some("dashboard");
        if let Some((precedente_ts, precedente_record, _, _)) = ultimi.get(id) {
            if *precedente_ts > ts || (*precedente_ts == ts && precedente_record > &r.id) {
                continue;
            }
        }
        ultimi.insert(id.to_string(), (ts, r.id, letta, dashboard));
    }
    ultimi
        .into_iter()
        .filter_map(|(id, (ts, _, letta, dashboard))| (!letta && dashboard).then_some((id, ts)))
        .collect()
}

/// Recupera l'ultimo timestamp di avviso (pop-up/suono) emesso per ciascuna chiave.
/// Consente di rispettare la cadenza di re-invio configurata anche dopo il riavvio dell'app.
#[cfg(test)]
fn ultimi_avvisi(recs: Vec<crate::app::RecordDto>, user_id: &str) -> HashMap<String, i64> {
    let mut out: HashMap<String, i64> = HashMap::new();
    for r in recs {
        if r.data.get("user_id").and_then(|v| v.as_str()) != Some(user_id) {
            continue;
        }
        let Some(chiave) = r.data.get("chiave").and_then(|v| v.as_str()) else {
            continue;
        };
        let ts = r.data.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
        let entry = out.entry(chiave.to_string()).or_insert(0);
        if ts > *entry {
            *entry = ts;
        }
    }
    out
}

fn chiave_stato_suggerimento(prefisso: &str, tipo: &str, anno: i32) -> String {
    format!("{prefisso}:{anno}:{tipo}")
}

#[cfg(test)]
fn chiave_stato_appartiene_al_tipo(chiave: &str, tipo: &str) -> bool {
    chiave == format!("suggerimento:{tipo}")
        || chiave == format!("primo_rilevato:{tipo}")
        || chiave
            .strip_prefix("suggerimento:")
            .and_then(|resto| resto.split_once(':'))
            .is_some_and(|(_, tipo_chiave)| tipo_chiave == tipo)
        || chiave
            .strip_prefix("primo_rilevato:")
            .and_then(|resto| resto.split_once(':'))
            .is_some_and(|(_, tipo_chiave)| tipo_chiave == tipo)
}

pub struct Notificatore {
    app: AppHandle,
    cfg: Mutex<Option<Cfg>>,
    stato: Mutex<Stato>,
    suggerimenti_cache: Mutex<CacheSuggerimenti>,
    /// Evita ingest e derivazioni concorrenti tra timer nativo, eventi dati e
    /// richieste del renderer.
    scan_lock: Mutex<()>,
    /// Diventa true soltanto dopo che l'overlay ha registrato tutti i listener.
    /// È condiviso con il job sul main thread che mostra la finestra prima di
    /// emettere gli eventi.
    overlay_ready: Arc<AtomicBool>,
    /// Notifiche rilevate mentre il renderer custom non era ancora pronto. Restano
    /// locali e vengono consegnate all'handshake successivo, senza ricadere sui
    /// balloon nativi del sistema operativo.
    overlay_in_attesa: Arc<Mutex<Vec<Notif>>>,
    /// Evita di ripetere pulizia/evento a ogni scansione finché l'app resta in uno
    /// stato autorevolmente non operativo (cartella, identità, restore).
    avvisi_sospesi: AtomicBool,
    /// La finestra principale è in primo piano (a fuoco)? Aggiornato dai **window event**
    /// sul thread principale (vedi `lib.rs`), così il thread di fondo NON interroga lo
    /// stato finestra cross-thread (operazione fragile su Windows, causa storica di
    /// blocchi/avvisi persi). Decide: suono via webview (a fuoco) vs rodio (in background),
    /// e se mostrare i pop-up overlay.
    main_focused: AtomicBool,
    /// Flag reattivo: true se sono avvenute modifiche ai dati che richiedono una scansione.
    dati_sporce: AtomicBool,
    /// Timestamp (ms) dell'ultima derivazione completa delle notifiche.
    ultimo_controllo_ms: AtomicI64,
    /// Giorno di calendario (da epoch) dell'ultima scansione (per scadenze a mezzanotte).
    ultimo_giorno_scansionato: AtomicI64,
}

impl Notificatore {
    pub fn new(app: AppHandle) -> Self {
        Notificatore {
            app,
            cfg: Mutex::new(None),
            stato: Mutex::new(Stato::default()),
            suggerimenti_cache: Mutex::new(CacheSuggerimenti::default()),
            scan_lock: Mutex::new(()),
            overlay_ready: Arc::new(AtomicBool::new(false)),
            overlay_in_attesa: Arc::new(Mutex::new(Vec::new())),
            avvisi_sospesi: AtomicBool::new(true),
            main_focused: AtomicBool::new(false),
            dati_sporce: AtomicBool::new(true),
            ultimo_controllo_ms: AtomicI64::new(0),
            ultimo_giorno_scansionato: AtomicI64::new(0),
        }
    }

    /// Segnala che i dati della proiezione sono cambiati e richiedono una nuova scansione.
    pub fn segnala_modifica(&self) {
        self.dati_sporce.store(true, Ordering::Release);
    }

    /// Aggiorna il fuoco della finestra principale (chiamato dai window event, main thread).
    pub fn set_main_focused(&self, focused: bool) {
        self.main_focused.store(focused, Ordering::Relaxed);
    }

    fn main_in_primo_piano(&self) -> bool {
        self.main_focused.load(Ordering::Relaxed)
    }

    /// Handshake del renderer overlay: l'esistenza della finestra non implica
    /// che WebView2 abbia già caricato React e registrato i listener.
    pub fn set_overlay_ready(&self, ready: bool) {
        self.overlay_ready.store(ready, Ordering::Release);
        if !ready {
            return;
        }
        let cfg_opt = self.cfg.lock().expect("cfg poisoned").clone();
        if let Some(cfg) = cfg_opt {
            if !self.sessione_app_disponibile(&cfg) {
                self.sospendi_avvisi_per_app_non_disponibile();
                return;
            }
            let correnti = self.deriva(&cfg);
            pota_overlay_non_corrente(&self.overlay_in_attesa, &correnti);
        }
        let in_attesa = {
            let mut coda = self
                .overlay_in_attesa
                .lock()
                .expect("overlay queue poisoned");
            std::mem::take(&mut *coda)
        };
        if !in_attesa.is_empty() {
            self.consegna_overlay(None, in_attesa);
        }
    }

    /// Riceve/aggiorna la configurazione dal webview e fa subito una scansione.
    pub fn configura(&self, input: NotificheConfigInput) {
        let prossima = Cfg {
            user_id: input.user_id,
            suono: input.suono,
            popup: input.balloon,
            popup_primo_piano: input.primo_piano,
            soglia: input.soglia,
            onboarding_time: input.onboarding_time,
            suggerimenti: normalizza_preferenze_suggerimenti(input.suggerimenti),
        };
        let mut cfg = self.cfg.lock().expect("cfg poisoned");
        if cfg.as_ref() == Some(&prossima) {
            return;
        }
        let precedente = cfg.clone();
        *cfg = Some(prossima.clone());
        drop(cfg);

        // Se le notifiche dei suggerimenti sono state disattivate globalmente o per singola categoria,
        // azzera lo stato persistente per far ripartire pulito il conteggio di attesa alla riattivazione.
        if let Some(ref prec) = precedente {
            let disattivazione_globale =
                prec.suggerimenti.notifiche_attive && !prossima.suggerimenti.notifiche_attive;
            if disattivazione_globale {
                self.azzera_avvisi_suggerimenti(&prossima.user_id, None);
            } else {
                let rimosse: Vec<String> = prec
                    .suggerimenti
                    .tipi_abilitati
                    .iter()
                    .filter(|tipo| !prossima.suggerimenti.tipi_abilitati.contains(*tipo))
                    .cloned()
                    .collect();
                let cadenze_modificate: Vec<String> = prossima
                    .suggerimenti
                    .giorni_avviso
                    .iter()
                    .filter(|(tipo, &giorni)| {
                        prec.suggerimenti.giorni_avviso.get(*tipo).copied() != Some(giorni)
                    })
                    .map(|(tipo, _)| tipo.clone())
                    .collect();
                let mut da_azzerare = rimosse;
                for tipo in cadenze_modificate {
                    if !da_azzerare.contains(&tipo) {
                        da_azzerare.push(tipo);
                    }
                }
                if !da_azzerare.is_empty() {
                    self.azzera_avvisi_suggerimenti(&prossima.user_id, Some(&da_azzerare));
                }
            }
        }

        self.segnala_modifica();
        self.scansiona();
    }

    /// Ripristino esplicito: anche preferenze già identiche ai default devono
    /// azzerare timer e pause. Il lock impedisce scansioni con stato intermedio.
    pub fn ripristina_predefiniti(&self, input: SuggerimentiPreferenzeInput) -> Result<(), String> {
        let _scan_guard = self.scan_lock.lock().expect("scan poisoned");
        let mut cfg = self.cfg.lock().expect("cfg poisoned");
        let precedente = cfg.as_ref().ok_or("notificatore non configurato")?;
        let state = self
            .app
            .try_state::<AppState>()
            .ok_or("stato app non disponibile")?;
        let user_id = precedente.user_id.clone();
        let vecchie = state.esporta_notifiche_locali()?;
        state.cancella_suggerimenti_locali(&user_id)?;
        if let Err(err) = state.suggerimenti_azzera_pause(None) {
            state.importa_notifiche_locali(&vecchie)?;
            return Err(err);
        }
        let mut prossima = precedente.clone();
        prossima.suggerimenti = normalizza_preferenze_suggerimenti(input);
        *cfg = Some(prossima);
        *self
            .suggerimenti_cache
            .lock()
            .expect("suggerimenti cache poisoned") = CacheSuggerimenti::default();
        drop(cfg);
        drop(_scan_guard);
        self.segnala_modifica();
        self.scansiona();
        Ok(())
    }

    /// Azzera lo storico degli avvisi emessi per i suggerimenti (e i relativi timer di primo rilevamento).
    pub fn azzera_avvisi_suggerimenti(&self, user_id: &str, tipi: Option<&[String]>) {
        if let Some(state) = self.app.try_state::<AppState>() {
            let tipi_da_azzerare: Vec<String> = match tipi {
                Some(t) => t.to_vec(),
                None => vec![
                    "rimborso".into(),
                    "distinta".into(),
                    "provvigione".into(),
                    "produzione".into(),
                    "spedizione".into(),
                    "preventivo".into(),
                ],
            };
            for tipo in &tipi_da_azzerare {
                let _ = state.local_notifica_avvisata_delete_tipo(user_id, tipo);
            }
            let _ = state.suggerimenti_azzera_pause(tipi);
        }
        *self
            .suggerimenti_cache
            .lock()
            .expect("suggerimenti cache poisoned") = CacheSuggerimenti::default();
    }

    /// Scollega il notificatore dall'utente precedente e azzera la deduplicazione.
    /// Al termine del nuovo onboarding `notifiche_config` lo configura nuovamente.
    pub fn disattiva_sessione(&self) -> bool {
        let aveva_config = self.cfg.lock().expect("cfg poisoned").take().is_some();
        *self.stato.lock().expect("stato poisoned") = Stato::default();
        *self
            .suggerimenti_cache
            .lock()
            .expect("suggerimenti cache poisoned") = CacheSuggerimenti::default();
        let aveva_coda = {
            let mut coda = self
                .overlay_in_attesa
                .lock()
                .expect("overlay queue poisoned");
            let presente = !coda.is_empty();
            coda.clear();
            presente
        };
        let era_attiva = !self.avvisi_sospesi.swap(true, Ordering::AcqRel);
        aveva_config || aveva_coda || era_attiva
    }

    pub fn invalida_suggerimenti(&self, entities: &[String]) {
        let influenza = entities
            .iter()
            .any(|entity| crate::app::suggestions::entita_influenza_suggerimenti(entity));
        if !influenza {
            return;
        }
        let mut cache = self
            .suggerimenti_cache
            .lock()
            .expect("suggerimenti cache poisoned");
        cache.sporca = true;
    }

    fn bundle_suggerimenti(
        &self,
        state: &AppState,
        soglia_preventivo: i64,
        anno: i32,
    ) -> Option<SuggerimentiBundleDto> {
        if !crate::premium::is_enabled(&state.app_dir) {
            let mut cache = self
                .suggerimenti_cache
                .lock()
                .expect("suggerimenti cache poisoned");
            if cache.bundle.is_some() || !cache.rilevati_ms.is_empty() {
                *cache = CacheSuggerimenti::default();
            }
            return None;
        }
        let mut cache = self
            .suggerimenti_cache
            .lock()
            .expect("suggerimenti cache poisoned");
        let soglia_preventivo = soglia_preventivo.clamp(0, 90);
        let giorno_preventivi = Local::now().format("%Y-%m-%d").to_string();
        if cache.soglia_preventivo != Some(soglia_preventivo)
            || cache.anno != Some(anno)
            || cache.giorno_preventivi.as_deref() != Some(&giorno_preventivi)
        {
            cache.soglia_preventivo = Some(soglia_preventivo);
            cache.anno = Some(anno);
            cache.giorno_preventivi = Some(giorno_preventivi);
            cache.sporca = true;
        }
        if cache.sporca {
            cache.bundle = state
                .suggerimenti_lista_con_soglia_preventivi_per_anno(soglia_preventivo, anno)
                .ok();
            cache.sporca = false;
        }
        let bundle = cache.bundle.clone()?;
        aggiorna_rilevati_ms(
            &mut cache.rilevati_ms,
            bundle
                .suggerimenti
                .iter()
                .map(|suggerimento| suggerimento.id.as_str()),
            ora_ms(),
        );
        Some(bundle)
    }

    pub fn aggiorna_duplicato_locale(
        &self,
        _state: &AppState,
        _suggerimento: Option<SuggerimentoDto>,
    ) -> Result<bool, String> {
        Ok(false)
    }

    pub fn suggerimenti_dashboard_lista(
        &self,
        preferenze: SuggerimentiPreferenzeInput,
    ) -> Result<SuggerimentiBundleDto, String> {
        let state = self
            .app
            .try_state::<AppState>()
            .ok_or_else(|| "stato applicativo non disponibile".to_string())?;
        crate::premium::ensure_access(&state)?;
        let preferenze = normalizza_preferenze_suggerimenti(preferenze);
        self.bundle_suggerimenti(&state, soglia_preventivo(&preferenze), preferenze.anno)
            .ok_or_else(|| "impossibile derivare le azioni suggerite".to_string())
    }

    /// Invalida esplicitamente la fotografia corrente e la ricalcola subito.
    /// È separato dalla lettura ordinaria perché il pulsante Dashboard deve
    /// eseguire un controllo reale anche quando nessuna entità ha emesso eventi.
    pub fn suggerimenti_dashboard_rigenera(
        &self,
        preferenze: SuggerimentiPreferenzeInput,
    ) -> Result<SuggerimentiBundleDto, String> {
        let state = self
            .app
            .try_state::<AppState>()
            .ok_or_else(|| "stato applicativo non disponibile".to_string())?;
        crate::premium::ensure_access(&state)?;
        self.suggerimenti_cache
            .lock()
            .expect("suggerimenti cache poisoned")
            .sporca = true;
        let preferenze = normalizza_preferenze_suggerimenti(preferenze);
        self.bundle_suggerimenti(&state, soglia_preventivo(&preferenze), preferenze.anno)
            .ok_or_else(|| "impossibile rigenerare le azioni suggerite".to_string())
    }

    fn suggerimenti_notificabili(
        &self,
        state: &AppState,
        user_id: &str,
        preferenze: &PreferenzeSuggerimenti,
        ultimi_avvisi: &HashMap<String, i64>,
        riattivazioni_dashboard: &HashMap<String, i64>,
    ) -> Vec<SuggerimentoDto> {
        if !preferenze.notifiche_attive || preferenze.tipi_abilitati.is_empty() {
            return Vec::new();
        }
        let ora = ora_ms();
        let bundle =
            self.bundle_suggerimenti(state, soglia_preventivo(preferenze), preferenze.anno);

        bundle
            .map(|bundle| {
                // Tipi di suggerimento presenti in questo momento
                let tipi_presenti: HashSet<&str> = bundle
                    .suggerimenti
                    .iter()
                    .map(|s| s.tipo.as_str())
                    .collect();

                // Pulisci lo stato di eventuali tipi risolti/scomparsi
                for tipo in [
                    "rimborso",
                    "distinta",
                    "provvigione",
                    "produzione",
                    "spedizione",
                    "preventivo",
                ] {
                    if !tipi_presenti.contains(tipo) && !user_id.is_empty() {
                        let chiave_avviso =
                            chiave_stato_suggerimento("suggerimento", tipo, preferenze.anno);
                        let chiave_primo =
                            chiave_stato_suggerimento("primo_rilevato", tipo, preferenze.anno);
                        if ultimi_avvisi.contains_key(&chiave_avviso)
                            || ultimi_avvisi.contains_key(&chiave_primo)
                        {
                            let _ = state.local_notifica_avvisata_delete(user_id, &chiave_avviso);
                            let _ = state.local_notifica_avvisata_delete(user_id, &chiave_primo);
                        }
                    }
                }

                bundle
                    .suggerimenti
                    .into_iter()
                    .filter(|suggerimento| {
                        let chiave = chiave_stato_suggerimento(
                            "suggerimento",
                            &suggerimento.tipo,
                            preferenze.anno,
                        );
                        let ultimo_avviso = ultimi_avvisi.get(&chiave).copied().unwrap_or(0);
                        let chiave_primo = chiave_stato_suggerimento(
                            "primo_rilevato",
                            &suggerimento.tipo,
                            preferenze.anno,
                        );
                        let primo_rilevato = match ultimi_avvisi.get(&chiave_primo).copied() {
                            Some(ts) if ts > 0 => ts,
                            _ => {
                                if !user_id.is_empty() {
                                    let _ = state.local_notifica_avvisata_set(
                                        user_id,
                                        &chiave_primo,
                                        &suggerimento.tipo,
                                        ora,
                                    );
                                }
                                ora
                            }
                        };

                        let forzato = riattivazioni_dashboard
                            .get(&suggerimento.id)
                            .copied()
                            .unwrap_or(0)
                            > ultimo_avviso;
                        suggerimento_notificabile(
                            suggerimento,
                            preferenze,
                            ora,
                            primo_rilevato,
                            ultimo_avviso,
                            forzato,
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// I suggerimenti vivono nella Dashboard e nei pop-up custom; non compaiono nella lista della campanella.
    pub fn suggerimenti_notifiche_lista(
        &self,
        _preferenze: SuggerimentiPreferenzeInput,
    ) -> Result<Vec<SuggerimentoDto>, String> {
        Ok(Vec::new())
    }

    /// Rideriva le notifiche correnti e avvisa per quelle nuove non ancora viste.
    pub fn scansiona(&self) {
        let Ok(_scan_guard) = self.scan_lock.try_lock() else {
            return;
        };
        let cfg = match self.cfg.lock().expect("cfg poisoned").clone() {
            Some(c) => c,
            None => return, // il webview non ha ancora inviato la config
        };
        // La main nascosta nella tray non esegue il polling JS e WebView2 può anche
        // perdere gli eventi del file-watch. Prima di derivare le notifiche facciamo
        // quindi un ingest incrementale nativo: è idempotente e mantiene aggiornati
        // promemoria e scadenze anche senza aprire la finestra.
        if !self.main_in_primo_piano() {
            if let Some(state) = self.app.try_state::<AppState>() {
                match state.poll_sync_entities() {
                    Ok(SyncPollOutcome::Changed(entities)) => {
                        if !entities.is_empty() {
                            emetti_entita_modificate(&self.app, &entities);
                        }
                    }
                    Ok(SyncPollOutcome::Rebuild(reason)) => {
                        let _ = self
                            .app
                            .emit("pt:data-wiped", serde_json::json!({ "reason": reason }));
                    }
                    Ok(SyncPollOutcome::Waiting) => {
                        let _ = self.app.emit(
                            "pt:data-wiped",
                            serde_json::json!({ "reason": "restore-waiting" }),
                        );
                    }
                    Err(_) => {}
                }
            }
        }

        let oggi = oggi_giorni();
        let ora = ora_ms();
        let ultimo_controllo = self.ultimo_controllo_ms.load(Ordering::Acquire);
        let ultimo_giorno = self.ultimo_giorno_scansionato.load(Ordering::Acquire);
        let sporca = self.dati_sporce.load(Ordering::Acquire);
        let giorno_cambiato = oggi != ultimo_giorno;
        let fallback_tempo = ora.saturating_sub(ultimo_controllo) >= 60_000;
        let riavviso_messaggio_dovuto = self
            .stato
            .lock()
            .expect("stato poisoned")
            .riavviso_messaggio_dovuto_a(ora);
        let sessione_da_ricontrollare = self.avvisi_sospesi.load(Ordering::Acquire);

        // Il timer resta reattivo ogni 5s, ma la derivazione SQLite parte soltanto per
        // dati nuovi, cambio giorno, fallback o un riavviso maturato in memoria.
        if !sporca
            && !giorno_cambiato
            && !fallback_tempo
            && !riavviso_messaggio_dovuto
            && !sessione_da_ricontrollare
        {
            return;
        }

        // Verifica autorevole nel core, non nel WebView: continua a funzionare con
        // main sospesa/nascosta e blocca gli avvisi se cartella, identità o restore
        // rendono indisponibile la home. Il confronto utente evita che una vecchia
        // configurazione sopravviva alla revoca o a un cambio profilo.
        if !self.sessione_app_disponibile(&cfg) {
            self.sospendi_avvisi_per_app_non_disponibile();
            return;
        }
        self.avvisi_sospesi.store(false, Ordering::Release);

        // Consumiamo il dirty flag soltanto ora: se la sessione non era disponibile
        // resta pendente; una modifica concorrente successiva allo swap lo rialza.
        self.dati_sporce.swap(false, Ordering::AcqRel);

        // Il gate Premium viene letto a ogni scansione, anche se le notifiche dei
        // suggerimenti sono disattivate. In questo modo una disattivazione elimina
        // subito fotografie e tempi di rilevazione dalla cache; una successiva
        // riattivazione riparte obbligatoriamente da una derivazione fresca.
        if let Some(state) = self.app.try_state::<AppState>() {
            if !crate::premium::is_enabled(&state.app_dir) {
                let mut cache = self
                    .suggerimenti_cache
                    .lock()
                    .expect("suggerimenti cache poisoned");
                if cache.bundle.is_some() || !cache.rilevati_ms.is_empty() {
                    *cache = CacheSuggerimenti::default();
                }
            }
        }

        let correnti = self.deriva(&cfg);
        pota_overlay_non_corrente(&self.overlay_in_attesa, &correnti);
        let reatt = self.reattivazioni(&cfg.user_id);
        let reatt_dashboard = self.riattivazioni_dashboard(&cfg.user_id);
        self.ultimo_controllo_ms.store(ora, Ordering::Release);
        self.ultimo_giorno_scansionato
            .store(oggi, Ordering::Release);

        // Diff + marcatura ATOMICI (sotto un solo lock): garantisce che due trigger
        // concorrenti (timer + webview) non avvisino mai due volte la stessa notifica.
        let mut nuove = match self
            .stato
            .lock()
            .expect("stato poisoned")
            .nuove_da_avvisare(correnti, &reatt)
        {
            Some(n) => n,
            None => return, // primo giro: semina silenziosa dell'arretrato
        };

        // Niente raffica visiva: l'overlay mostra una sola card e mette le altre in coda.
        // Possiamo quindi avvisare anche blocchi grandi (es. dati demo/sync) senza tagliarli.
        if nuove.is_empty() {
            return;
        }
        for notifica in &mut nuove {
            notifica.mostra_completa = reatt_dashboard.get(&notifica.id) == reatt.get(&notifica.id);
        }
        self.avvisa(&cfg, &nuove);
    }

    fn sessione_app_disponibile(&self, cfg: &Cfg) -> bool {
        let Some(state) = self.app.try_state::<AppState>() else {
            return false;
        };
        let boot = state.bootstrap();
        boot.onboarded
            && boot.data_dir_status == "ok"
            && !boot.reconnect_required
            && boot.restore_status == "none"
            && boot
                .identity
                .as_ref()
                .map(|identity| identity.user_id.as_str())
                == Some(cfg.user_id.as_str())
    }

    fn sospendi_avvisi_per_app_non_disponibile(&self) {
        self.overlay_in_attesa
            .lock()
            .expect("overlay queue poisoned")
            .clear();
        if self.avvisi_sospesi.swap(true, Ordering::AcqRel) {
            return;
        }
        let _ = self
            .app
            .emit_to("overlay", "pt:overlay-pulisci-sessione", ());
    }

    /// Riattivazioni per-utente: id → ts dei record `notifica_letta` con `letta:false`
    /// (scritti quando es. si modifica un promemoria). Servono a ri-allertare quell'id una
    /// volta sola, anche se è stabile e già «avvisato», allineandosi al re-show in campanella.
    fn reattivazioni(&self, user_id: &str) -> HashMap<String, i64> {
        let mut out = HashMap::new();
        if let Some(state) = self.app.try_state::<AppState>() {
            if let Ok(recs) = state.records_list("notifica_letta") {
                for (id, (ts, letta)) in ultimi_stati_lettura(recs, user_id) {
                    if !letta {
                        out.insert(id, ts);
                    }
                }
            }
        }
        out
    }

    fn riattivazioni_dashboard(&self, user_id: &str) -> HashMap<String, i64> {
        self.app
            .try_state::<AppState>()
            .and_then(|state| state.records_list("notifica_letta").ok())
            .map(|recs| ultime_riattivazioni_dashboard(recs, user_id))
            .unwrap_or_default()
    }

    fn ultime_notifiche_avvisate(&self, user_id: &str) -> HashMap<String, i64> {
        self.app
            .try_state::<AppState>()
            .and_then(|state| state.local_notifica_avvisata_get_map(user_id).ok())
            .unwrap_or_default()
    }

    /// Costruisce le notifiche correnti **non lette** (stessi id stabili del webview).
    fn deriva(&self, cfg: &Cfg) -> Vec<Notif> {
        let state = match self.app.try_state::<AppState>() {
            Some(s) => s,
            None => return Vec::new(),
        };
        let mut out: Vec<Notif> = Vec::new();
        let oggi = oggi_giorni();

        // Stato letto per-utente: una notifica già vista non va avvisata. `letta:false`
        // = record "riattivato" (promemoria modificato) → torna NON vista.
        let mut viste: HashSet<String> = HashSet::new();
        if let Ok(recs) = state.records_list("notifica_letta") {
            for (id, (_, letta)) in ultimi_stati_lettura(recs, &cfg.user_id) {
                if letta {
                    viste.insert(id);
                }
            }
        }

        // Solleciti: pagamenti attesi (non saldati) scaduti oltre la soglia, su ordini
        // con credito reale (≥ Confermato: né Nuovo né Rifiutato).
        let ordini_completi = state.ordini_lista().unwrap_or_default();
        let ordini_vivi: HashSet<String> = ordini_completi.iter().map(|o| o.id.clone()).collect();
        if let Ok(pags) = state.pagamenti_vista(None, None, None, None, None) {
            for p in pags {
                if p.saldato || p.scadenza.is_empty() {
                    continue;
                }
                if !p.ordine_id.is_empty() && !ordini_vivi.contains(&p.ordine_id) {
                    continue;
                }
                if p.ordine_stato == "Nuovo" || p.ordine_stato == "Rifiutato" {
                    continue;
                }
                let giorni = match giorni_da(&p.scadenza, oggi) {
                    Some(g) => g,
                    None => continue,
                };
                let Some(id) = id_sollecito_contratto(&p.id, giorni, cfg.soglia) else {
                    continue;
                };
                let chi = if !p.cliente_nome.is_empty() {
                    p.cliente_nome.clone()
                } else if !p.medico_nome.is_empty() {
                    p.medico_nome.clone()
                } else {
                    p.ordine_numero.clone()
                };
                out.push(Notif {
                    id,
                    tipo: "sollecito".into(),
                    urgenza: if giorni > 0 { "scaduto" } else { "oggi" }.into(),
                    titolo: format!("Pagamento scaduto · {chi}"),
                    dettaglio: format!("{} · scad. {}", euro(p.importo), data_it(&p.scadenza)),
                    collegato_tipo: if p.ordine_id.is_empty() {
                        String::new()
                    } else {
                        "ordine".into()
                    },
                    collegato_id: p.ordine_id.clone(),
                    collegato_nome: p.ordine_numero.clone(),
                    promemoria_id: String::new(),
                    mittente_id: String::new(),
                    origine_ms: 0,
                    mostra_completa: false,
                    suggerimento_collegamento: None,
                });
            }
        }

        // Promemoria aperti con scadenza: scaduto (re-remind settimanale) o in scadenza.
        if let Ok(recs) = state.records_list("promemoria") {
            for r in recs {
                if r.data.get("fatto").and_then(|v| v.as_bool()) == Some(true) {
                    continue;
                }
                let scad = r
                    .data
                    .get("scadenza")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if scad.is_empty() {
                    continue;
                }
                let avviso = r
                    .data
                    .get("avviso_anticipato")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let testo = r
                    .data
                    .get("testo")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("Promemoria");
                let coll_tipo = str_field(&r.data, "collegato_tipo");
                let coll_id = str_field(&r.data, "collegato_id");
                let coll_nome = str_field(&r.data, "collegato_nome");
                if coll_tipo == "ordine" && !coll_id.is_empty() && !ordini_vivi.contains(&coll_id) {
                    continue;
                }
                let giorni = match giorni_da(scad, oggi) {
                    Some(g) => g, // oggi − scadenza: >0 scaduto, 0 oggi, <0 futuro
                    None => continue,
                };
                let Some(id) = id_promemoria_contratto(&r.id, scad, giorni, avviso) else {
                    continue;
                };
                if giorni > 0 {
                    out.push(Notif {
                        id,
                        tipo: "promemoria_scaduto".into(),
                        urgenza: "scaduto".into(),
                        titolo: testo.to_string(),
                        dettaglio: format!("Scaduto · {}", data_it(scad)),
                        collegato_tipo: coll_tipo,
                        collegato_id: coll_id,
                        collegato_nome: coll_nome,
                        promemoria_id: r.id.clone(),
                        mittente_id: String::new(),
                        origine_ms: 0,
                        mostra_completa: false,
                        suggerimento_collegamento: None,
                    });
                } else if giorni == 0 || (avviso > 0 && -giorni <= avviso) {
                    out.push(Notif {
                        id,
                        tipo: "promemoria_scadenza".into(),
                        urgenza: if giorni == 0 { "oggi" } else { "presto" }.into(),
                        titolo: testo.to_string(),
                        dettaglio: if giorni == 0 {
                            "Oggi".to_string()
                        } else {
                            format!("Entro il {}", data_it(scad))
                        },
                        collegato_tipo: coll_tipo,
                        collegato_id: coll_id,
                        collegato_nome: coll_nome,
                        promemoria_id: r.id.clone(),
                        mittente_id: String::new(),
                        origine_ms: 0,
                        mostra_completa: false,
                        suggerimento_collegamento: None,
                    });
                }
            }
        }

        // Marcatori urgente/anomalia/sollecito sugli ordini.
        let dispositivo_corrente = state.config().device_id;
        let origini_marcatori: HashMap<String, String> = state
            .records_list("ordine")
            .unwrap_or_default()
            .into_iter()
            .map(|record| {
                (
                    record.id,
                    str_field(&record.data, "marcatore_origine_device"),
                )
            })
            .collect();
        for o in &ordini_completi {
            let Some((label, urgenza)) = marcatore_notifica(&o.marcatore) else {
                continue;
            };
            if !marcatore_notificabile_su_dispositivo(
                origini_marcatori.get(&o.id),
                &dispositivo_corrente,
            ) {
                continue;
            }
            out.push(Notif {
                id: format!("marcatore:{}", o.id),
                tipo: "marcatore".into(),
                urgenza: urgenza.into(),
                titolo: format!("{label} · {}", o.numero),
                dettaglio: o.medico_nome.clone(),
                collegato_tipo: "ordine".into(),
                collegato_id: o.id.clone(),
                collegato_nome: o.numero.clone(),
                promemoria_id: String::new(),
                mittente_id: String::new(),
                origine_ms: 0,
                mostra_completa: false,
                suggerimento_collegamento: None,
            });
        }

        // Messaggi tra PC (FASE 6E): record `notifica` indirizzati a me (o a "tutti"),
        // non inviati da me. Id = id del record (`msg:<ulid>`), così il read-state
        // `notifica_letta` vale anche qui e non si ri-suona dopo la sync.
        if let Ok(recs) = state.records_list("notifica") {
            for r in recs {
                let mittente_id = str_field(&r.data, "mittente_id");
                let dest = str_field(&r.data, "destinatario");
                let ts = r.data.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
                if !messaggio_visibile_per_utente(
                    &mittente_id,
                    &dest,
                    &cfg.user_id,
                    ts,
                    cfg.onboarding_time,
                ) {
                    continue;
                }
                let mittente_nome = str_field(&r.data, "mittente_nome");
                let testo = str_field(&r.data, "testo");
                out.push(Notif {
                    id: r.id.clone(),
                    tipo: "messaggio".into(),
                    urgenza: "info".into(),
                    titolo: if mittente_nome.is_empty() {
                        "Nuovo messaggio".to_string()
                    } else {
                        format!("💬 {mittente_nome}")
                    },
                    dettaglio: testo,
                    collegato_tipo: str_field(&r.data, "collegato_tipo"),
                    collegato_id: str_field(&r.data, "collegato_id"),
                    collegato_nome: str_field(&r.data, "collegato_nome"),
                    promemoria_id: String::new(),
                    mittente_id,
                    origine_ms: ts,
                    mostra_completa: false,
                    suggerimento_collegamento: None,
                });
            }
        }

        // FASE 14: usa lo stesso bundle Premium della Dashboard, già in cache e
        // filtrato dalle preferenze locali. Nessun report viene duplicato nel
        // notificatore e nessun calcolo parte sui PC senza accesso.
        let ultimi_avvisi = self.ultime_notifiche_avvisate(&cfg.user_id);
        let reatt_dashboard = self.riattivazioni_dashboard(&cfg.user_id);
        for suggerimento in self.suggerimenti_notificabili(
            &state,
            &cfg.user_id,
            &cfg.suggerimenti,
            &ultimi_avvisi,
            &reatt_dashboard,
        ) {
            out.push(Notif {
                id: suggerimento.id,
                tipo: "suggerimento".into(),
                urgenza: if suggerimento.priorita >= 90 {
                    "scaduto"
                } else if suggerimento.priorita >= 75 {
                    "oggi"
                } else {
                    "info"
                }
                .into(),
                titolo: suggerimento.titolo,
                dettaglio: suggerimento.dettaglio,
                collegato_tipo: String::new(),
                collegato_id: String::new(),
                collegato_nome: String::new(),
                promemoria_id: String::new(),
                mittente_id: String::new(),
                origine_ms: 0,
                mostra_completa: false,
                suggerimento_collegamento: Some(suggerimento.collegamento),
            });
        }

        out.retain(|n| !viste.contains(&n.id));
        out
    }

    /// Suono + pop-up custom per le notifiche nuove.
    ///
    /// **Suono: un solo "suonatore" (questo Rust), sempre e una volta sola.** Il webview
    /// NON suona più da sé (vedi `features/notifiche/useNotifiche.ts`): qui decidiamo noi,
    /// sia in primo piano sia in background, eliminando il doppio suono e l'inaffidabilità
    /// della logica a fuoco lato webview. Se la finestra principale è VIVA (visibile e non
    /// minimizzata, anche se non a fuoco) glielo facciamo eseguire al webview con
    /// HTMLAudioElement (affidabile anche dove rodio non apre l'uscita audio del PC);
    /// se è NASCOSTA nella tray o minimizzata — dove WebView2 sospende JS+audio — suona il
    /// Rust con rodio.
    ///
    /// **Pop-up (overlay): solo quando la principale NON è in primo piano** (nascosta nella
    /// tray, minimizzata o sei su un'altra finestra). Se stai già guardando il gestionale
    /// bastano badge + suono. Le non-urgenti spariscono da sole dopo 15s; aprire
    /// esplicitamente la campanella nasconde i pop-up ordinari senza modificare lo stato
    /// letto/scartato. Le card custom sono l'unico canale visivo: se WebView2 non è
    /// ancora pronto le accodiamo e le consegniamo al successivo handshake dell'overlay.
    fn avvisa(&self, cfg: &Cfg, nuove: &[Notif]) {
        // Registra l'avvenuto invio su storage SQLite locale (local_notifiche_avvisate).
        // Questo impedisce a ogni riavvio dell'app di ri-emettere immediatamente il pop-up/suono,
        // garantendo il rispetto della cadenza di re-invio configurata, senza scrivere eventi su OneDrive.
        if let Some(state) = self.app.try_state::<AppState>() {
            let ora = ora_ms();
            for n in nuove {
                let (chiave, tipo) = if n.tipo == "suggerimento" {
                    let tipo_suggerimento = crate::app::suggestions::tipo_suggerimento_da_id(&n.id)
                        .unwrap_or(n.id.as_str());
                    (
                        chiave_stato_suggerimento(
                            "suggerimento",
                            tipo_suggerimento,
                            cfg.suggerimenti.anno,
                        ),
                        tipo_suggerimento.to_string(),
                    )
                } else {
                    (n.id.clone(), n.tipo.clone())
                };
                let _ = state.local_notifica_avvisata_set(&cfg.user_id, &chiave, &tipo, ora);
            }
        }

        // Il fuoco arriva dai window event (atomico), MAI interrogando lo stato finestra
        // cross-thread: su Windows quelle chiamate dal thread di fondo possono bloccarsi e
        // facevano «morire» gli avvisi dopo il primo. L'eventuale `show()` viene
        // schedulato esplicitamente sul main thread.
        let foreground = self.main_in_primo_piano();
        if cfg.suono != "nessuno" && foreground {
            // App a fuoco: suona il suo webview (attivo).
            let _ = self
                .app
                .emit_to("main", "pt:suona-notifica", cfg.suono.clone());
        }
        // Pop-up: di norma solo quando la principale NON è in primo piano; se l'utente ha
        // attivato `notifichePrimoPiano`, mostriamo i pop-up anche mentre guarda l'app.
        let popup = cfg.popup && (cfg.popup_primo_piano || !foreground);
        let suono_overlay = (!foreground && cfg.suono != "nessuno").then(|| cfg.suono.clone());
        if popup || suono_overlay.is_some() {
            let payload = if popup { nuove.to_vec() } else { Vec::new() };
            if self.overlay_ready.load(Ordering::Acquire) {
                self.consegna_overlay(suono_overlay, payload);
            } else {
                // Renderer ancora in caricamento o sospeso: il suono ha un fallback
                // nativo, mentre la parte visiva attende sempre l'overlay custom.
                fallback_overlay_custom(
                    suono_overlay.as_deref(),
                    &self.overlay_in_attesa,
                    &payload,
                );
            }
        }
    }

    /// Mostra l'overlay e poi emette gli eventi sul main thread. In caso di
    /// finestra scomparsa o consegna fallita, invalida l'handshake e riaccoda le
    /// card custom senza duplicare i canali già consegnati.
    fn consegna_overlay(&self, suono: Option<String>, notifiche: Vec<Notif>) {
        let app = self.app.clone();
        let app_main = app.clone();
        let ready = self.overlay_ready.clone();
        let ready_main = ready.clone();
        let overlay_in_attesa = self.overlay_in_attesa.clone();
        let overlay_in_attesa_main = overlay_in_attesa.clone();
        let suono_main = suono.clone();
        let notifiche_main = notifiche.clone();
        let schedulata = app.run_on_main_thread(move || {
            let mut suono_consegnato = suono_main.is_none();
            let mut popup_consegnato = notifiche_main.is_empty();
            let mut overlay_operativo = false;

            if ready_main.load(Ordering::Acquire) {
                if let Some(overlay) = app_main.get_webview_window("overlay") {
                    #[cfg(target_os = "windows")]
                    let attendi_whatsapp =
                        crate::app::whatsapp_windows::overlay_invio_richiedi_visibilita();
                    #[cfg(not(target_os = "windows"))]
                    let attendi_whatsapp = false;
                    if attendi_whatsapp || overlay.show().is_ok() {
                        overlay_operativo = true;
                        if let Some(ref id) = suono_main {
                            suono_consegnato = app_main
                                .emit_to("overlay", "pt:suona-notifica", id.clone())
                                .is_ok();
                        }
                        if !notifiche_main.is_empty() {
                            popup_consegnato = app_main
                                .emit_to("overlay", "pt:notifiche-nuove", notifiche_main.clone())
                                .is_ok();
                        }
                    }
                }
            }

            if !suono_consegnato || !popup_consegnato {
                if !overlay_operativo || !popup_consegnato {
                    ready_main.store(false, Ordering::Release);
                }
                fallback_overlay_custom(
                    (!suono_consegnato)
                        .then_some(suono_main.as_deref())
                        .flatten(),
                    &overlay_in_attesa_main,
                    if popup_consegnato {
                        &[]
                    } else {
                        &notifiche_main
                    },
                );
            }
        });

        if schedulata.is_err() {
            fallback_overlay_custom(suono.as_deref(), &overlay_in_attesa, &notifiche);
        }
    }
}

fn pota_overlay_non_corrente(overlay_in_attesa: &Mutex<Vec<Notif>>, correnti: &[Notif]) {
    let correnti_ids: HashSet<&str> = correnti
        .iter()
        .map(|notifica| notifica.id.as_str())
        .collect();
    overlay_in_attesa
        .lock()
        .expect("overlay queue poisoned")
        .retain(|notifica| correnti_ids.contains(notifica.id.as_str()));
}

/// Percorso di affidabilità quando WebView2 non è pronto: l'audio continua a usare
/// rodio, mentre gli avvisi visivi restano accodati per l'overlay custom. Gli id
/// stabili evitano duplicati anche se più tentativi di consegna falliscono.
fn fallback_overlay_custom(
    suono: Option<&str>,
    overlay_in_attesa: &Mutex<Vec<Notif>>,
    notifiche: &[Notif],
) {
    if let Some(bytes) = suono.and_then(suono_bytes) {
        riproduci(bytes);
    }
    if notifiche.is_empty() {
        return;
    }

    let mut coda = overlay_in_attesa.lock().expect("overlay queue poisoned");
    let mut presenti: HashSet<String> = coda.iter().map(|notifica| notifica.id.clone()).collect();
    for notifica in notifiche {
        if coda.len() >= MAX_NOTIFICHE_OVERLAY_IN_ATTESA {
            break;
        }
        if presenti.insert(notifica.id.clone()) {
            coda.push(notifica.clone());
        }
    }
}

/// Riproduce un WAV bundlato su un thread dedicato (il device sink di rodio non è
/// `Send`/`Sync`, quindi vive e muore dentro il thread di riproduzione).
fn riproduci(bytes: &'static [u8]) {
    std::thread::spawn(move || {
        if let Ok(device) = rodio::DeviceSinkBuilder::open_default_sink() {
            if let Ok(player) = rodio::play(device.mixer(), Cursor::new(bytes)) {
                player.set_volume(0.7);
                player.sleep_until_end();
            }
        }
    });
}

/// I suoni bundlati (gli stessi del webview, generati da `scripts/gen-sounds.mjs`).
fn suono_bytes(id: &str) -> Option<&'static [u8]> {
    Some(match id {
        "campanello" => include_bytes!("../../src/assets/sounds/campanello.wav"),
        "cristallo" => include_bytes!("../../src/assets/sounds/cristallo.wav"),
        "carillon" => include_bytes!("../../src/assets/sounds/carillon.wav"),
        "goccia" => include_bytes!("../../src/assets/sounds/goccia.wav"),
        "marimba" => include_bytes!("../../src/assets/sounds/marimba.wav"),
        "trillo" => include_bytes!("../../src/assets/sounds/trillo.wav"),
        "bolla" => include_bytes!("../../src/assets/sounds/bolla.wav"),
        _ => return None,
    })
}

// --- Helper di data/formato (senza dipendenze esterne) --------------------

/// Legge un campo stringa da `data` (vuoto se assente/non stringa).
fn str_field(data: &serde_json::Map<String, serde_json::Value>, key: &str) -> String {
    data.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Giorni dall'epoch (UTC) di oggi.
fn oggi_giorni() -> i64 {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    secs.div_euclid(86_400)
}

fn ora_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|durata| durata.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn suggerimento_notificabile(
    suggerimento: &SuggerimentoDto,
    preferenze: &PreferenzeSuggerimenti,
    ora: i64,
    primo_rilevato_ms: i64,
    ultimo_avviso_ms: i64,
    forzato_da_dashboard: bool,
) -> bool {
    if !preferenze.tipi_abilitati.contains(&suggerimento.tipo) {
        return false;
    }
    if forzato_da_dashboard {
        return ora >= suggerimento.aggiornato_ms;
    }
    let giorni = preferenze
        .giorni_avviso
        .get(&suggerimento.tipo)
        .copied()
        .unwrap_or(0)
        .clamp(0, 90);
    if giorni > 0 {
        let intervallo_ms = giorni.saturating_mul(GIORNO_MS);
        let base_ms = if ultimo_avviso_ms > 0 {
            ultimo_avviso_ms
        } else {
            primo_rilevato_ms
        };
        if ora.saturating_sub(base_ms) < intervallo_ms {
            return false;
        }
    }
    let dopo_rivalidazione = suggerimento
        .aggiornato_ms
        .max(primo_rilevato_ms)
        .saturating_add(RIVALIDAZIONE_SUGGERIMENTO_MS);
    ora >= dopo_rivalidazione
}

fn soglia_preventivo(preferenze: &PreferenzeSuggerimenti) -> i64 {
    preferenze
        .giorni_avviso
        .get("preventivo")
        .copied()
        .unwrap_or(7)
        .clamp(0, 90)
}

/// `oggi − scadenza` in giorni civili; `None` se la data non è valida.
fn giorni_da(scadenza_iso: &str, oggi_giorni: i64) -> Option<i64> {
    Some(oggi_giorni - giorni_civili(scadenza_iso)?)
}

/// Numero di giorni civili dall'epoch per una data `YYYY-MM-DD` (algoritmo di Hinnant).
fn giorni_civili(iso: &str) -> Option<i64> {
    let mut it = iso.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next()?.parse().ok()?;
    let d: i64 = it.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    Some(era * 146097 + doe - 719468)
}

/// `YYYY-MM-DD` → `DD/MM/YYYY` (per il testo del balloon).
fn data_it(iso: &str) -> String {
    let p: Vec<&str> = iso.split('-').collect();
    if p.len() == 3 {
        format!("{}/{}/{}", p[2], p[1], p[0])
    } else {
        iso.to_string()
    }
}

/// Centesimi → `€ 1.234,50` (formato italiano).
fn euro(centesimi: i64) -> String {
    let neg = centesimi < 0;
    let c = centesimi.unsigned_abs();
    let intero = c / 100;
    let dec = c % 100;
    // Migliaia con punto.
    let s = intero.to_string();
    let mut con_punti = String::new();
    let bytes = s.as_bytes();
    for (i, ch) in bytes.iter().enumerate() {
        if i > 0 && (bytes.len() - i).is_multiple_of(3) {
            con_punti.push('.');
        }
        con_punti.push(*ch as char);
    }
    format!("{}€ {},{:02}", if neg { "-" } else { "" }, con_punti, dec)
}

fn id_sollecito_contratto(id: &str, giorni: i64, soglia: i64) -> Option<String> {
    (giorni >= soglia).then(|| format!("sollecito:{id}:{}", (giorni - soglia).max(0) / 7))
}

fn id_promemoria_contratto(id: &str, scadenza: &str, giorni: i64, avviso: i64) -> Option<String> {
    if giorni > 0 {
        Some(format!(
            "promem-scaduto:{id}:{scadenza}:{}",
            giorni.max(0) / 7
        ))
    } else if giorni == 0 || (avviso > 0 && -giorni <= avviso) {
        Some(format!("promem-pre:{id}:{scadenza}"))
    } else {
        None
    }
}

fn marcatore_notifica(marcatore: &str) -> Option<(&'static str, &'static str)> {
    match marcatore {
        "urgente" => Some(("Urgente", "scaduto")),
        "anomalia" => Some(("Anomalia", "presto")),
        "sollecito" => Some(("Sollecito", "presto")),
        _ => None,
    }
}

fn marcatore_notificabile_su_dispositivo(
    dispositivo_origine: Option<&String>,
    dispositivo_corrente: &str,
) -> bool {
    dispositivo_origine.is_none_or(|origine| origine != dispositivo_corrente)
}

fn messaggio_visibile_per_utente(
    mittente_id: &str,
    destinatario: &str,
    user_id: &str,
    ts: i64,
    onboarding_time: i64,
) -> bool {
    if ts < onboarding_time
        || mittente_id.is_empty()
        || user_id.is_empty()
        || mittente_id == user_id
    {
        return false;
    }
    destinatario == "tutti" || destinatario == user_id
}

// --- Comandi esposti al webview -------------------------------------------

/// Riceve la configurazione corrente (utente + preferenze suono/pop-up/soglia).
/// L'arg `balloon` conserva il nome storico ma ora abilita i **pop-up custom** (pref
/// `balloonAttivo`): il balloon di sistema non si usa più.
#[tauri::command]
pub fn notifiche_config(config: NotificheConfigInput, nt: State<'_, std::sync::Arc<Notificatore>>) {
    nt.configura(config);
}

#[tauri::command]
pub fn notifiche_ripristina_predefiniti(
    preferenze: SuggerimentiPreferenzeInput,
    nt: State<'_, std::sync::Arc<Notificatore>>,
) -> Result<(), String> {
    nt.ripristina_predefiniti(preferenze)
}

/// Chiede una nuova scansione (il webview la chiama quando ricarica, da vivo).
#[tauri::command]
pub fn notifiche_check(nt: State<'_, std::sync::Arc<Notificatore>>) {
    nt.segnala_modifica();
    nt.scansiona();
}

/// Conferma che il renderer overlay abbia registrato tutti i listener. Alla
/// distruzione/reload torna false: il core usa l'audio nativo e accoda le card
/// visive finché l'overlay custom non è di nuovo pronto.
#[tauri::command]
pub fn notifiche_overlay_pronto(pronto: bool, nt: State<'_, std::sync::Arc<Notificatore>>) {
    nt.set_overlay_ready(pronto);
}

/// Elenco FASE 14 già maturo per la campanella, derivato dalla stessa cache del
/// rilevatore custom. Il gate Premium viene ricontrollato nel core.
#[tauri::command]
pub fn suggerimenti_notifiche_lista(
    preferenze: SuggerimentiPreferenzeInput,
    nt: State<'_, std::sync::Arc<Notificatore>>,
) -> Result<Vec<SuggerimentoDto>, String> {
    nt.suggerimenti_notifiche_lista(preferenze)
}

/// Riceve il solo esito del matcher TypeScript già esistente. È cache locale
/// volatile del PC: nessun record o preferenza entra nella sincronizzazione.
#[tauri::command]
pub fn suggerimento_duplicati_locale_aggiorna(
    suggerimento: Option<SuggerimentoDto>,
    app: AppHandle,
    state: State<'_, AppState>,
    nt: State<'_, std::sync::Arc<Notificatore>>,
) -> Result<(), String> {
    let modificato = nt.aggiorna_duplicato_locale(&state, suggerimento)?;
    if modificato {
        let _ = app.emit("suggerimento:salvato", ());
        nt.scansiona();
    }
    Ok(())
}

/// Scollega l'utente corrente dal rilevatore notifiche e svuota solo le card di
/// sessione dati nell'overlay. Le notifiche di aggiornamento restano indipendenti.
#[tauri::command]
pub fn notifiche_disattiva_sessione(app: AppHandle, nt: State<'_, std::sync::Arc<Notificatore>>) {
    if nt.disattiva_sessione() {
        let _ = app.emit_to("overlay", "pt:overlay-pulisci-sessione", ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contratto_derivazione_condiviso_col_frontend() {
        let solleciti = [
            ("p1", -1, 0, None),
            ("p1", 0, 0, Some("sollecito:p1:0")),
            ("p1", 6, 0, Some("sollecito:p1:0")),
            ("p1", 7, 0, Some("sollecito:p1:1")),
            ("p2", 10, 3, Some("sollecito:p2:1")),
        ];
        for (id, giorni, soglia, atteso) in solleciti {
            let ottenuto = id_sollecito_contratto(id, giorni, soglia);
            assert_eq!(ottenuto.as_deref(), atteso);
        }

        let promemoria = [
            (
                "r1",
                "2026-07-01",
                8,
                0,
                Some("promem-scaduto:r1:2026-07-01:1"),
            ),
            ("r1", "2026-07-01", 0, 0, Some("promem-pre:r1:2026-07-01")),
            ("r2", "2026-07-20", -2, 3, Some("promem-pre:r2:2026-07-20")),
            ("r2", "2026-07-20", -4, 3, None),
        ];
        for (id, scadenza, giorni, avviso, atteso) in promemoria {
            let ottenuto = id_promemoria_contratto(id, scadenza, giorni, avviso);
            assert_eq!(ottenuto.as_deref(), atteso);
        }
    }

    #[test]
    fn giorni_civili_e_differenze() {
        // Stesso giorno = 0.
        assert_eq!(
            giorni_da("2026-06-17", giorni_civili("2026-06-17").unwrap()),
            Some(0)
        );
        // Un giorno dopo.
        let oggi = giorni_civili("2026-06-18").unwrap();
        assert_eq!(giorni_da("2026-06-17", oggi), Some(1)); // oggi − scadenza = 1 (scaduto di 1)
        assert_eq!(giorni_da("2026-06-20", oggi), Some(-2)); // 2 giorni nel futuro
                                                             // A cavallo di un anno bisestile (2024).
        let a = giorni_civili("2024-02-28").unwrap();
        let b = giorni_civili("2024-03-01").unwrap();
        assert_eq!(b - a, 2); // 28 → 29 → 1
    }

    #[test]
    fn formato_euro_italiano() {
        assert_eq!(euro(123_450), "€ 1.234,50");
        assert_eq!(euro(5), "€ 0,05");
        assert_eq!(euro(10_000_000), "€ 100.000,00");
    }

    #[test]
    fn data_italiana() {
        assert_eq!(data_it("2026-06-17"), "17/06/2026");
        assert_eq!(data_it(""), "");
    }

    #[test]
    fn marcatori_ordine_notificabili() {
        assert_eq!(marcatore_notifica("urgente"), Some(("Urgente", "scaduto")));
        assert_eq!(marcatore_notifica("anomalia"), Some(("Anomalia", "presto")));
        assert_eq!(
            marcatore_notifica("sollecito"),
            Some(("Sollecito", "presto"))
        );
        assert_eq!(marcatore_notifica(""), None);
    }

    #[test]
    fn marcatore_non_avvisa_il_dispositivo_che_lo_ha_impostato() {
        let pc_a = "pc-a".to_string();
        assert!(!marcatore_notificabile_su_dispositivo(Some(&pc_a), "pc-a"));
        assert!(marcatore_notificabile_su_dispositivo(Some(&pc_a), "pc-b"));
        assert!(marcatore_notificabile_su_dispositivo(None, "pc-a"));
    }

    #[test]
    fn routing_messaggi_diretto_tutti_e_mittente() {
        assert!(messaggio_visibile_per_utente("u1", "u2", "u2", 200, 100));
        assert!(messaggio_visibile_per_utente("u1", "tutti", "u2", 200, 100));
        assert!(!messaggio_visibile_per_utente("u1", "u3", "u2", 200, 100));
        assert!(!messaggio_visibile_per_utente(
            "u2", "tutti", "u2", 200, 100
        ));
        assert!(!messaggio_visibile_per_utente("", "u2", "u2", 200, 100));
        assert!(!messaggio_visibile_per_utente("u1", "u2", "u2", 99, 100));
    }

    #[test]
    fn migrazione_stato_lettura_usa_l_azione_piu_recente() {
        let record = |record_id: &str, letta: bool, ts: i64| crate::app::RecordDto {
            id: record_id.to_string(),
            revision: String::new(),
            data: [
                ("user_id".to_string(), serde_json::json!("u1")),
                ("notifica_id".to_string(), serde_json::json!("msg:1")),
                ("letta".to_string(), serde_json::json!(letta)),
                ("ts".to_string(), serde_json::json!(ts)),
            ]
            .into_iter()
            .collect(),
            deleted: false,
        };

        let riattivato = ultimi_stati_lettura(
            vec![
                record("letta|u1|msg:1", true, 100),
                record("stato-notifica-v2|u1|msg:1", false, 200),
            ],
            "u1",
        );
        assert_eq!(riattivato.get("msg:1"), Some(&(200, false)));

        let scartato = ultimi_stati_lettura(
            vec![
                record("letta|u1|msg:1", false, 100),
                record("stato-notifica-v2|u1|msg:1", true, 200),
            ],
            "u1",
        );
        assert_eq!(scartato.get("msg:1"), Some(&(200, true)));
    }

    #[test]
    fn riattivazione_dashboard_vale_solo_finche_e_lo_stato_piu_recente() {
        let record = |record_id: &str, letta: bool, ts: i64, origine: Option<&str>| {
            let mut data: serde_json::Map<String, serde_json::Value> = [
                ("user_id".to_string(), serde_json::json!("u1")),
                ("notifica_id".to_string(), serde_json::json!("promemoria:1")),
                ("letta".to_string(), serde_json::json!(letta)),
                ("ts".to_string(), serde_json::json!(ts)),
            ]
            .into_iter()
            .collect();
            if let Some(origine) = origine {
                data.insert(
                    "origine_riattivazione".to_string(),
                    serde_json::json!(origine),
                );
            }
            crate::app::RecordDto {
                id: record_id.to_string(),
                revision: String::new(),
                data,
                deleted: false,
            }
        };

        let manuale = ultime_riattivazioni_dashboard(
            vec![record("stato-dashboard", false, 200, Some("dashboard"))],
            "u1",
        );
        assert_eq!(manuale.get("promemoria:1"), Some(&200));

        let poi_letta = ultime_riattivazioni_dashboard(
            vec![
                record("stato-dashboard", false, 200, Some("dashboard")),
                record("stato-letto", true, 300, None),
            ],
            "u1",
        );
        assert!(poi_letta.is_empty());

        let normale =
            ultime_riattivazioni_dashboard(vec![record("stato-modifica", false, 400, None)], "u1");
        assert!(normale.is_empty());
    }

    #[test]
    fn ultimi_avvisi_filtra_per_utente_e_tiene_il_piu_recente() {
        let record = |id: &str, user_id: &str, chiave: &str, ts: i64| {
            let data: serde_json::Map<String, serde_json::Value> = [
                ("user_id".to_string(), serde_json::json!(user_id)),
                ("chiave".to_string(), serde_json::json!(chiave)),
                ("ts".to_string(), serde_json::json!(ts)),
            ]
            .into_iter()
            .collect();
            crate::app::RecordDto {
                id: id.to_string(),
                revision: String::new(),
                data,
                deleted: false,
            }
        };

        let make_recs = || {
            vec![
                record("a1", "u1", "suggerimento:produzione", 100),
                record("a2", "u1", "suggerimento:produzione", 250),
                record("a3", "u1", "suggerimento:rimborso", 150),
                record("a4", "u2", "suggerimento:produzione", 500),
            ]
        };

        let mappa_u1 = ultimi_avvisi(make_recs(), "u1");
        assert_eq!(mappa_u1.get("suggerimento:produzione"), Some(&250));
        assert_eq!(mappa_u1.get("suggerimento:rimborso"), Some(&150));
        assert_eq!(mappa_u1.len(), 2);

        let mappa_u2 = ultimi_avvisi(make_recs(), "u2");
        assert_eq!(mappa_u2.get("suggerimento:produzione"), Some(&500));
        assert_eq!(mappa_u2.get("suggerimento:rimborso"), None);
    }

    #[test]
    fn stato_suggerimenti_e_isolato_per_anno() {
        let preventivo_2025 = chiave_stato_suggerimento("suggerimento", "preventivo", 2025);
        let preventivo_2026 = chiave_stato_suggerimento("suggerimento", "preventivo", 2026);
        let preventivo_tutti = chiave_stato_suggerimento("suggerimento", "preventivo", 0);

        assert_ne!(preventivo_2025, preventivo_2026);
        assert_ne!(preventivo_2026, preventivo_tutti);
        assert!(chiave_stato_appartiene_al_tipo(
            &preventivo_2025,
            "preventivo"
        ));
        assert!(chiave_stato_appartiene_al_tipo(
            "suggerimento:preventivo",
            "preventivo"
        ));
        assert!(!chiave_stato_appartiene_al_tipo(
            &preventivo_2025,
            "produzione"
        ));
    }

    /// Notif minima per i test del diff (solo l'id conta).
    fn notif(id: &str) -> Notif {
        Notif {
            id: id.into(),
            tipo: "promemoria_scaduto".into(),
            urgenza: "scaduto".into(),
            titolo: String::new(),
            dettaglio: String::new(),
            collegato_tipo: String::new(),
            collegato_id: String::new(),
            collegato_nome: String::new(),
            promemoria_id: String::new(),
            mittente_id: String::new(),
            origine_ms: 0,
            mostra_completa: false,
            suggerimento_collegamento: None,
        }
    }

    fn messaggio_notif(id: &str, origine_ms: i64) -> Notif {
        Notif {
            tipo: "messaggio".into(),
            origine_ms,
            ..notif(id)
        }
    }

    fn preferenze_suggerimenti_test(tipi: &[&str], giorni: i64) -> PreferenzeSuggerimenti {
        PreferenzeSuggerimenti {
            tipi_abilitati: tipi.iter().map(|tipo| (*tipo).to_string()).collect(),
            notifiche_attive: true,
            giorni_avviso: [("rimborso".to_string(), giorni)].into_iter().collect(),
            anno: 0,
        }
    }

    #[test]
    fn suggerimento_attende_soglia_e_rivalidazione() {
        let giorno = giorni_civili("2026-08-01").unwrap() * GIORNO_MS;
        let suggerimento = SuggerimentoDto {
            id: "s14:rimborso:test".into(),
            tipo: "rimborso".into(),
            titolo: String::new(),
            dettaglio: String::new(),
            azione_label: String::new(),
            priorita: 90,
            collegamento: SuggerimentoCollegamentoDto::default(),
            riferimento_data: "2026-08-01".into(),
            aggiornato_ms: giorno,
        };
        let subito = preferenze_suggerimenti_test(&["rimborso"], 0);
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &subito,
            giorno + 59_999,
            giorno,
            0,
            false,
        ));
        assert!(suggerimento_notificabile(
            &suggerimento,
            &subito,
            giorno + 60_000,
            giorno,
            0,
            false,
        ));

        let ogni_3_giorni = preferenze_suggerimenti_test(&["rimborso"], 3);
        // Primo avviso: prima dei 3 giorni dalla prima rilevazione, la notifica attende
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &ogni_3_giorni,
            giorno + 60_000,
            giorno,
            0,
            false,
        ));
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &ogni_3_giorni,
            giorno + 3 * GIORNO_MS - 1,
            giorno,
            0,
            false,
        ));
        // Al compimento del 3° giorno: scatta il primo avviso
        let primo_avviso = giorno + 3 * GIORNO_MS;
        assert!(suggerimento_notificabile(
            &suggerimento,
            &ogni_3_giorni,
            primo_avviso,
            giorno,
            0,
            false,
        ));

        // Secondo avviso dopo che è già stato inviato un avviso al tempo `primo_avviso`:
        let intervallo = 3 * GIORNO_MS;
        // Prima dei 3 giorni dal primo avviso: soppresso
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &ogni_3_giorni,
            primo_avviso + intervallo - 1,
            giorno,
            primo_avviso,
            false,
        ));
        // Trascorsi i 3 giorni dal primo avviso: notificabile
        assert!(suggerimento_notificabile(
            &suggerimento,
            &ogni_3_giorni,
            primo_avviso + intervallo,
            giorno,
            primo_avviso,
            false,
        ));
        // Se forzato da dashboard (anche se entro i 3 giorni): notificabile
        assert!(suggerimento_notificabile(
            &suggerimento,
            &ogni_3_giorni,
            primo_avviso + 1_000,
            giorno,
            primo_avviso,
            true,
        ));

        let disabilitato = preferenze_suggerimenti_test(&[], 0);
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &disabilitato,
            i64::MAX,
            giorno,
            0,
            false,
        ));

        // Una nuova fotografia residua deve attendere anche se le sorgenti
        // rimaste sono vecchie (es. una liquidazione parziale appena conclusa).
        let molto_dopo = giorno + 10 * GIORNO_MS;
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &subito,
            molto_dopo,
            molto_dopo - 30_000,
            0,
            false,
        ));
        assert!(suggerimento_notificabile(
            &suggerimento,
            &subito,
            molto_dopo,
            molto_dopo - RIVALIDAZIONE_SUGGERIMENTO_MS,
            0,
            false,
        ));
    }

    #[test]
    fn suggerimento_maturo_al_bootstrap_e_silenzioso_ma_nuova_fotografia_avvisa() {
        let mut stato = Stato::default();
        let riattivazioni = HashMap::new();
        let maturo = Notif {
            tipo: "suggerimento".into(),
            ..notif("s14:rimborso:foto-a")
        };
        assert!(stato
            .nuove_da_avvisare_a(vec![maturo.clone()], &riattivazioni, 100)
            .is_none());
        assert!(stato
            .nuove_da_avvisare_a(vec![maturo], &riattivazioni, 101)
            .unwrap()
            .is_empty());
        let nuova = Notif {
            tipo: "suggerimento".into(),
            ..notif("s14:rimborso:foto-b")
        };
        assert_eq!(
            ids(&stato
                .nuove_da_avvisare_a(vec![nuova], &riattivazioni, 102)
                .unwrap()),
            vec!["s14:rimborso:foto-b"]
        );
    }

    #[test]
    fn suggerimento_preventivo_non_riapplica_la_soglia_all_aggregato() {
        let t0 = giorni_civili("2026-08-01").unwrap() * GIORNO_MS;
        let suggerimento = SuggerimentoDto {
            id: "s14:preventivo:test".into(),
            tipo: "preventivo".into(),
            titolo: String::new(),
            dettaglio: String::new(),
            azione_label: String::new(),
            priorita: 80,
            collegamento: SuggerimentoCollegamentoDto::default(),
            riferimento_data: "2026-08-01".into(),
            aggiornato_ms: t0,
        };
        let preferenze = PreferenzeSuggerimenti {
            tipi_abilitati: ["preventivo".to_string()].into_iter().collect(),
            notifiche_attive: true,
            giorni_avviso: [("preventivo".to_string(), 7)].into_iter().collect(),
            anno: 0,
        };
        // Primo avviso: prima dei 7 giorni dalla prima rilevazione (t0), non notifica
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &preferenze,
            t0 + 6 * GIORNO_MS,
            t0,
            0,
            false,
        ));
        // A 7 giorni dalla prima rilevazione: primo avviso
        let primo_avviso = t0 + 7 * GIORNO_MS;
        assert!(suggerimento_notificabile(
            &suggerimento,
            &preferenze,
            primo_avviso,
            t0,
            0,
            false,
        ));
        // Secondo avviso prima di 7 giorni: soppresso
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &preferenze,
            primo_avviso + 2 * GIORNO_MS,
            t0,
            primo_avviso,
            false,
        ));
        // Secondo avviso dopo 7 giorni: consentito
        assert!(suggerimento_notificabile(
            &suggerimento,
            &preferenze,
            primo_avviso + 7 * GIORNO_MS,
            t0,
            primo_avviso,
            false,
        ));
    }

    #[test]
    fn prima_rilevazione_resta_stabile_e_riparte_per_una_nuova_fotografia() {
        let mut rilevati = HashMap::new();
        aggiorna_rilevati_ms(&mut rilevati, ["a", "b"], 10);
        aggiorna_rilevati_ms(&mut rilevati, ["b", "c"], 20);

        assert_eq!(rilevati.len(), 2);
        assert_eq!(rilevati.get("b"), Some(&10));
        assert_eq!(rilevati.get("c"), Some(&20));
        assert!(!rilevati.contains_key("a"));
    }

    fn ids(v: &[Notif]) -> Vec<String> {
        v.iter().map(|n| n.id.clone()).collect()
    }

    #[test]
    fn coda_overlay_custom_deduplica_e_rispetta_il_limite() {
        let coda = Mutex::new(Vec::new());
        let mut ingresso: Vec<Notif> = (0..MAX_NOTIFICHE_OVERLAY_IN_ATTESA + 10)
            .map(|indice| notif(&format!("n:{indice}")))
            .collect();
        ingresso.push(notif("n:0"));

        fallback_overlay_custom(None, &coda, &ingresso);
        let ids_accodati = ids(&coda.lock().expect("coda test poisoned"));
        assert_eq!(ids_accodati.len(), MAX_NOTIFICHE_OVERLAY_IN_ATTESA);
        assert_eq!(ids_accodati.first().map(String::as_str), Some("n:0"));
        assert_eq!(ids_accodati.last().map(String::as_str), Some("n:98"));

        fallback_overlay_custom(None, &coda, &[notif("n:0"), notif("n:nuova")]);
        assert_eq!(
            coda.lock().expect("coda test poisoned").len(),
            MAX_NOTIFICHE_OVERLAY_IN_ATTESA,
        );
    }

    #[test]
    fn coda_overlay_elimina_suggerimenti_non_piu_correnti() {
        let coda = Mutex::new(vec![notif("rimasto"), notif("ordine-eliminato")]);
        pota_overlay_non_corrente(&coda, &[notif("rimasto")]);
        assert_eq!(ids(&coda.lock().unwrap()), ["rimasto"]);
    }

    /// Regressione storica «si ferma dopo la prima»: dopo la semina, OGNI nuova notifica
    /// (la seconda, la terza, …) deve uscire una volta; le già viste mai più.
    #[test]
    fn dedup_non_si_ferma_dopo_la_prima() {
        let mut st = Stato::default();
        let no = HashMap::new();
        // Primo giro = semina: niente avvisi anche se c'è già arretrato.
        assert!(st.nuove_da_avvisare(vec![notif("a")], &no).is_none());
        // Arriva la prima nuova: esce.
        assert_eq!(
            ids(&st
                .nuove_da_avvisare(vec![notif("a"), notif("b")], &no)
                .unwrap()),
            vec!["b"]
        );
        // Arriva la SECONDA nuova: deve uscire anch'essa (qui si rompeva).
        assert_eq!(
            ids(&st
                .nuove_da_avvisare(vec![notif("a"), notif("b"), notif("c")], &no)
                .unwrap()),
            vec!["c"]
        );
        // La terza.
        assert_eq!(
            ids(&st
                .nuove_da_avvisare(vec![notif("c"), notif("d")], &no)
                .unwrap()),
            vec!["d"]
        );
        // Nessuna nuova tra quelle ancora pendenti: vuoto, e mai un doppione.
        assert!(st
            .nuove_da_avvisare(vec![notif("c"), notif("d")], &no)
            .unwrap()
            .is_empty());
        // Le notifiche risolte vengono potate: se tornano in futuro, riallertano.
        assert_eq!(
            ids(&st
                .nuove_da_avvisare(vec![notif("a"), notif("b"), notif("c"), notif("d")], &no)
                .unwrap()),
            vec!["a", "b"]
        );
    }

    #[test]
    fn dedup_regge_sequenze_lunghe_e_pota_risolte() {
        let mut st = Stato::default();
        let no = HashMap::new();
        assert!(st.nuove_da_avvisare(vec![notif("seed")], &no).is_none());

        for i in 0..120 {
            let id = format!("msg:{i}");
            let nuove = st.nuove_da_avvisare(vec![notif(&id)], &no).unwrap();
            assert_eq!(ids(&nuove), vec![id]);
            assert_eq!(
                st.avvisate.len(),
                1,
                "le notifiche non più correnti vengono potate"
            );
            assert!(st
                .nuove_da_avvisare(vec![notif(&format!("msg:{i}"))], &no)
                .unwrap()
                .is_empty());
        }
    }

    /// Una **riattivazione** (es. promemoria modificato: `notifica_letta` con `letta:false`
    /// e ts più recente) fa ri-avvisare l'id stabile UNA volta, senza ripetersi a ogni giro.
    #[test]
    fn riattivazione_riallerta_una_volta() {
        let mut st = Stato::default();
        let no = HashMap::new();
        // Semina con "x" già presente, poi nessuna novità.
        assert!(st.nuove_da_avvisare(vec![notif("x")], &no).is_none());
        assert!(st
            .nuove_da_avvisare(vec![notif("x")], &no)
            .unwrap()
            .is_empty());
        // Riattivazione di "x" (ts=10): torna da avvisare, una volta.
        let r1 = HashMap::from([("x".to_string(), 10_i64)]);
        assert_eq!(
            ids(&st.nuove_da_avvisare(vec![notif("x")], &r1).unwrap()),
            vec!["x"]
        );
        // Stessa riattivazione (ts invariato): NON si ripete.
        assert!(st
            .nuove_da_avvisare(vec![notif("x")], &r1)
            .unwrap()
            .is_empty());
        // Nuova riattivazione (ts=20, modificato di nuovo): ri-allerta ancora una volta.
        let r2 = HashMap::from([("x".to_string(), 20_i64)]);
        assert_eq!(
            ids(&st.nuove_da_avvisare(vec![notif("x")], &r2).unwrap()),
            vec!["x"]
        );
    }

    #[test]
    fn messaggio_non_letto_viene_ricordato_ogni_giorno() {
        let mut st = Stato::default();
        let no = HashMap::new();
        let origine = 1_000;

        // Anche al primo giro un messaggio gia' vecchio di un giorno deve
        // riapparire: e' un reminder, non la raffica dell'arretrato ordinario.
        let primo_promemoria = st
            .nuove_da_avvisare_a(
                vec![messaggio_notif("msg:1", origine)],
                &no,
                origine + GIORNO_MS,
            )
            .unwrap();
        assert_eq!(ids(&primo_promemoria), vec!["msg:1"]);
        assert!(st
            .nuove_da_avvisare_a(
                vec![messaggio_notif("msg:1", origine)],
                &no,
                origine + GIORNO_MS + 1,
            )
            .unwrap()
            .is_empty());
        let secondo_promemoria = st
            .nuove_da_avvisare_a(
                vec![messaggio_notif("msg:1", origine)],
                &no,
                origine + 2 * GIORNO_MS,
            )
            .unwrap();
        assert_eq!(ids(&secondo_promemoria), vec!["msg:1"]);
    }

    #[test]
    fn riavviso_messaggio_scade_in_memoria_e_si_riprogramma_dopo_l_avviso() {
        let mut st = Stato::default();
        let no = HashMap::new();
        let origine = 1_000;
        let prima_scadenza = origine + GIORNO_MS;

        assert!(st
            .nuove_da_avvisare_a(vec![messaggio_notif("msg:1", origine)], &no, origine)
            .is_none());
        assert!(!st.riavviso_messaggio_dovuto_a(prima_scadenza - 1));
        assert!(st.riavviso_messaggio_dovuto_a(prima_scadenza));

        let promemoria = st
            .nuove_da_avvisare_a(vec![messaggio_notif("msg:1", origine)], &no, prima_scadenza)
            .unwrap();
        assert_eq!(ids(&promemoria), vec!["msg:1"]);
        assert!(!st.riavviso_messaggio_dovuto_a(prima_scadenza + 1));
    }
}
