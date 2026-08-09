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
//! **De-dup UNIFICATA (mai due volte).** Il suono/balloon è di competenza *esclusiva*
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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::app::{
    AppState, SuggerimentiBundleDto, SuggerimentiPreferenzeInput, SuggerimentoCollegamentoDto,
    SuggerimentoDto, SyncPollOutcome,
};
use crate::data_events::emetti_entita_modificate;

const GIORNO_MS: i64 = 86_400_000;
const RIVALIDAZIONE_SUGGERIMENTO_MS: i64 = 60_000;

#[derive(Clone)]
struct PreferenzeSuggerimenti {
    tipi_abilitati: HashSet<String>,
    notifiche_attive: bool,
    giorni_avviso: HashMap<String, i64>,
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

#[derive(Clone)]
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
    bundle: Option<SuggerimentiBundleDto>,
    duplicato_locale: Option<SuggerimentoDto>,
    /// Prima osservazione locale della fotografia corrente. Impedisce che una
    /// card residua avvisi subito dopo un'azione parziale sulle sorgenti.
    rilevati_ms: HashMap<String, i64>,
}

impl Default for CacheSuggerimenti {
    fn default() -> Self {
        Self {
            sporca: true,
            bundle: None,
            duplicato_locale: None,
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
    seminato: bool,
}

impl Stato {
    /// Diff de-dup: dato l'insieme **corrente** di notifiche non lette, ritorna quelle
    /// **nuove** da avvisare (e le marca come avvisate), oppure `None` al primo giro
    /// (semina: marca tutto l'arretrato senza avvisare). È pura → testabile: garantisce
    /// che ogni notifica nuova esca **una volta** e che la seconda/terza escano comunque
    /// (regressione storica «si ferma dopo la prima»).
    fn nuove_da_avvisare(
        &mut self,
        correnti: Vec<Notif>,
        reatt: &HashMap<String, i64>,
    ) -> Option<Vec<Notif>> {
        if !self.seminato {
            for n in &correnti {
                self.avvisate.insert(n.id.clone());
            }
            // Memorizza le riattivazioni già presenti, così non ri-suonano alla prima scansione.
            for (id, ts) in reatt {
                self.reatt_viste.insert(id.clone(), *ts);
            }
            self.seminato = true;
            return None;
        }
        let correnti_ids: HashSet<String> = correnti.iter().map(|n| n.id.clone()).collect();
        self.avvisate.retain(|id| correnti_ids.contains(id));
        self.reatt_viste.retain(|id, _| reatt.contains_key(id));
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
        let nuove: Vec<Notif> = correnti
            .into_iter()
            .filter(|n| !self.avvisate.contains(&n.id))
            .collect();
        for n in &nuove {
            self.avvisate.insert(n.id.clone());
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
    /// La finestra principale è in primo piano (a fuoco)? Aggiornato dai **window event**
    /// sul thread principale (vedi `lib.rs`), così il thread di fondo NON interroga lo
    /// stato finestra cross-thread (operazione fragile su Windows, causa storica di
    /// blocchi/avvisi persi). Decide: suono via webview (a fuoco) vs rodio (in background),
    /// e se mostrare i pop-up overlay.
    main_focused: AtomicBool,
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
            main_focused: AtomicBool::new(false),
        }
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
    }

    /// Riceve/aggiorna la configurazione dal webview e fa subito una scansione.
    pub fn configura(&self, input: NotificheConfigInput) {
        *self.cfg.lock().expect("cfg poisoned") = Some(Cfg {
            user_id: input.user_id,
            suono: input.suono,
            popup: input.balloon,
            popup_primo_piano: input.primo_piano,
            soglia: input.soglia,
            onboarding_time: input.onboarding_time,
            suggerimenti: normalizza_preferenze_suggerimenti(input.suggerimenti),
        });
        self.scansiona();
    }

    /// Scollega il notificatore dall'utente precedente e azzera la deduplicazione.
    /// Al termine del nuovo onboarding `notifiche_config` lo configura nuovamente.
    pub fn disattiva_sessione(&self) {
        *self.cfg.lock().expect("cfg poisoned") = None;
        *self.stato.lock().expect("stato poisoned") = Stato::default();
        *self
            .suggerimenti_cache
            .lock()
            .expect("suggerimenti cache poisoned") = CacheSuggerimenti::default();
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
        if entities
            .iter()
            .any(|entity| matches!(entity.as_str(), "cliente" | "snapshot"))
        {
            cache.duplicato_locale = None;
        }
    }

    fn bundle_suggerimenti(&self, state: &AppState) -> Option<SuggerimentiBundleDto> {
        if !crate::premium::is_enabled(&state.app_dir) {
            let mut cache = self
                .suggerimenti_cache
                .lock()
                .expect("suggerimenti cache poisoned");
            if cache.bundle.is_some()
                || cache.duplicato_locale.is_some()
                || !cache.rilevati_ms.is_empty()
            {
                *cache = CacheSuggerimenti::default();
            }
            return None;
        }
        let mut cache = self
            .suggerimenti_cache
            .lock()
            .expect("suggerimenti cache poisoned");
        if cache.sporca {
            cache.bundle = state.suggerimenti_lista().ok();
            cache.sporca = false;
        }
        let mut bundle = cache.bundle.clone()?;
        if let Some(duplicato) = cache.duplicato_locale.clone() {
            if !bundle.nascosti.contains(&duplicato.id) {
                bundle.suggerimenti.push(duplicato);
                bundle.suggerimenti.sort_by(|a, b| {
                    b.priorita
                        .cmp(&a.priorita)
                        .then_with(|| a.tipo.cmp(&b.tipo))
                        .then_with(|| a.id.cmp(&b.id))
                });
                bundle.suggerimenti.dedup_by(|a, b| a.id == b.id);
            }
        }
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
        state: &AppState,
        suggerimento: Option<SuggerimentoDto>,
    ) -> Result<(), String> {
        crate::premium::ensure_access(state)?;
        if let Some(ref voce) = suggerimento {
            if voce.tipo != "duplicati"
                || !voce.id.starts_with("s14:duplicati:")
                || voce.id.len() > 160
                || voce.collegamento.path != "/impostazioni"
                || voce.collegamento.azione.as_deref() != Some("ottimizza_database")
            {
                return Err("suggerimento duplicati locale non valido".into());
            }
        }
        let mut cache = self
            .suggerimenti_cache
            .lock()
            .expect("suggerimenti cache poisoned");
        let nuovo_id = suggerimento.as_ref().map(|voce| voce.id.as_str());
        cache.rilevati_ms.retain(|id, _| {
            !id.starts_with("s14:duplicati:") || nuovo_id.is_some_and(|corrente| corrente == id)
        });
        cache.duplicato_locale = suggerimento;
        Ok(())
    }

    pub fn suggerimenti_dashboard_lista(&self) -> Result<SuggerimentiBundleDto, String> {
        let state = self
            .app
            .try_state::<AppState>()
            .ok_or_else(|| "stato applicativo non disponibile".to_string())?;
        crate::premium::ensure_access(&state)?;
        self.bundle_suggerimenti(&state)
            .ok_or_else(|| "impossibile derivare le azioni suggerite".to_string())
    }

    /// Invalida esplicitamente la fotografia corrente e la ricalcola subito.
    /// È separato dalla lettura ordinaria perché il pulsante Dashboard deve
    /// eseguire un controllo reale anche quando nessuna entità ha emesso eventi.
    pub fn suggerimenti_dashboard_rigenera(&self) -> Result<SuggerimentiBundleDto, String> {
        let state = self
            .app
            .try_state::<AppState>()
            .ok_or_else(|| "stato applicativo non disponibile".to_string())?;
        crate::premium::ensure_access(&state)?;
        self.suggerimenti_cache
            .lock()
            .expect("suggerimenti cache poisoned")
            .sporca = true;
        self.bundle_suggerimenti(&state)
            .ok_or_else(|| "impossibile rigenerare le azioni suggerite".to_string())
    }

    fn suggerimenti_notificabili(
        &self,
        state: &AppState,
        preferenze: &PreferenzeSuggerimenti,
    ) -> Vec<SuggerimentoDto> {
        if !preferenze.notifiche_attive || preferenze.tipi_abilitati.is_empty() {
            return Vec::new();
        }
        let ora = ora_ms();
        let bundle = self.bundle_suggerimenti(state);
        let rilevati_ms = self
            .suggerimenti_cache
            .lock()
            .expect("suggerimenti cache poisoned")
            .rilevati_ms
            .clone();
        bundle
            .map(|bundle| {
                bundle
                    .suggerimenti
                    .into_iter()
                    .filter(|suggerimento| {
                        suggerimento_notificabile(
                            suggerimento,
                            preferenze,
                            ora,
                            rilevati_ms.get(&suggerimento.id).copied().unwrap_or(ora),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn suggerimenti_notifiche_lista(
        &self,
        preferenze: SuggerimentiPreferenzeInput,
    ) -> Result<Vec<SuggerimentoDto>, String> {
        let state = self
            .app
            .try_state::<AppState>()
            .ok_or_else(|| "stato applicativo non disponibile".to_string())?;
        crate::premium::ensure_access(&state)?;
        Ok(self.suggerimenti_notificabili(&state, &normalizza_preferenze_suggerimenti(preferenze)))
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
        // Motore aperto e onboarded? Se no, non seminare (lo faremo quando ci saranno dati).
        let onboarded = self
            .app
            .try_state::<AppState>()
            .map(|s| s.whoami().is_some())
            .unwrap_or(false);
        if !onboarded {
            return;
        }

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

                // La sync può aver ricevuto la rimozione dell'utente configurato: non
                // generare notifiche con una sessione che non è più valida.
                if state.whoami().is_none() {
                    return;
                }
            }
        }

        let correnti = self.deriva(&cfg);
        let reatt = self.reattivazioni(&cfg.user_id);

        // Diff + marcatura ATOMICI (sotto un solo lock): garantisce che due trigger
        // concorrenti (timer + webview) non avvisino mai due volte la stessa notifica.
        let nuove = match self
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
        self.avvisa(&cfg, &nuove);
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
        let ordini_vivi: HashSet<String> = state
            .ordini_lista()
            .map(|ordini| ordini.into_iter().map(|o| o.id).collect())
            .unwrap_or_default();
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
        if let Ok(ordini) = state.ordini_lista() {
            for o in ordini {
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
                    suggerimento_collegamento: None,
                });
            }
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
                    suggerimento_collegamento: None,
                });
            }
        }

        // FASE 14: usa lo stesso bundle Premium della Dashboard, già in cache e
        // filtrato dalle preferenze locali. Nessun report viene duplicato nel
        // notificatore e nessun calcolo parte sui PC senza accesso.
        for suggerimento in self.suggerimenti_notificabili(&state, &cfg.suggerimenti) {
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
    /// letto/scartato. Il pop-up sostituisce normalmente il vecchio balloon di sistema:
    /// mostriamo l'overlay prima dell'evento; il balloon resta soltanto il fallback se
    /// WebView2 non è pronto.
    fn avvisa(&self, cfg: &Cfg, nuove: &[Notif]) {
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
                // Renderer ancora in caricamento, sospeso o guasto: l'avviso è
                // comunque consegnato una sola volta tramite i fallback nativi.
                fallback_overlay(&self.app, suono_overlay.as_deref(), &payload);
            }
        }
    }

    /// Mostra l'overlay e poi emette gli eventi sul main thread. In caso di
    /// finestra scomparsa o consegna fallita, invalida l'handshake e usa i
    /// fallback nativi senza duplicare i canali già consegnati.
    fn consegna_overlay(&self, suono: Option<String>, notifiche: Vec<Notif>) {
        let app = self.app.clone();
        let app_main = app.clone();
        let ready = self.overlay_ready.clone();
        let ready_main = ready.clone();
        let suono_main = suono.clone();
        let notifiche_main = notifiche.clone();
        let schedulata = app.run_on_main_thread(move || {
            let mut suono_consegnato = suono_main.is_none();
            let mut popup_consegnato = notifiche_main.is_empty();
            let mut overlay_operativo = false;

            if ready_main.load(Ordering::Acquire) {
                if let Some(overlay) = app_main.get_webview_window("overlay") {
                    if overlay.show().is_ok() {
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
                if !overlay_operativo {
                    ready_main.store(false, Ordering::Release);
                }
                fallback_overlay(
                    &app_main,
                    (!suono_consegnato)
                        .then_some(suono_main.as_deref())
                        .flatten(),
                    if popup_consegnato {
                        &[]
                    } else {
                        &notifiche_main
                    },
                );
            }
        });

        if schedulata.is_err() {
            fallback_overlay(&self.app, suono.as_deref(), &notifiche);
        }
    }
}

/// Percorso di affidabilità quando WebView2 non è pronto: audio rodio e balloon
/// di sistema. Non viene accodata anche la card custom, evitando un duplicato
/// quando il renderer torna disponibile.
fn fallback_overlay(app: &AppHandle, suono: Option<&str>, notifiche: &[Notif]) {
    if let Some(bytes) = suono.and_then(suono_bytes) {
        riproduci(bytes);
    }
    if notifiche.is_empty() {
        return;
    }

    use tauri_plugin_notification::NotificationExt;
    let (titolo, corpo) = if notifiche.len() == 1 {
        (notifiche[0].titolo.clone(), notifiche[0].dettaglio.clone())
    } else {
        (
            format!("{} nuove notifiche", notifiche.len()),
            format!(
                "{} e altre {}",
                notifiche[0].titolo,
                notifiche.len().saturating_sub(1)
            ),
        )
    };
    let _ = app
        .notification()
        .builder()
        .title(titolo)
        .body(corpo)
        .show();
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
    rilevato_ms: i64,
) -> bool {
    if !preferenze.tipi_abilitati.contains(&suggerimento.tipo) {
        return false;
    }
    let giorni = preferenze
        .giorni_avviso
        .get(&suggerimento.tipo)
        .copied()
        .unwrap_or(0)
        .clamp(0, 90);
    let da_data = giorni_civili(&suggerimento.riferimento_data)
        .map(|giorno| giorno.saturating_add(giorni).saturating_mul(GIORNO_MS))
        .unwrap_or_else(|| {
            suggerimento
                .aggiornato_ms
                .saturating_add(giorni.saturating_mul(GIORNO_MS))
        });
    let dopo_rivalidazione = suggerimento
        .aggiornato_ms
        .max(rilevato_ms)
        .saturating_add(RIVALIDAZIONE_SUGGERIMENTO_MS);
    ora >= da_data.max(dopo_rivalidazione)
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

/// Chiede una nuova scansione (il webview la chiama quando ricarica, da vivo).
#[tauri::command]
pub fn notifiche_check(nt: State<'_, std::sync::Arc<Notificatore>>) {
    nt.scansiona();
}

/// Conferma che il renderer overlay abbia registrato tutti i listener. Alla
/// distruzione/reload torna false e il core usa i fallback nativi.
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
    nt.aggiorna_duplicato_locale(&state, suggerimento)?;
    let _ = app.emit("suggerimento:salvato", ());
    nt.scansiona();
    Ok(())
}

/// Scollega l'utente corrente dal rilevatore notifiche e svuota solo le card di
/// sessione dati nell'overlay. Le notifiche di aggiornamento restano indipendenti.
#[tauri::command]
pub fn notifiche_disattiva_sessione(app: AppHandle, nt: State<'_, std::sync::Arc<Notificatore>>) {
    nt.disattiva_sessione();
    let _ = app.emit_to("overlay", "pt:overlay-pulisci-sessione", ());
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
            ("r1", "2026-07-01", 8, 0, Some("promem-scaduto:r1:2026-07-01:1")),
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
            suggerimento_collegamento: None,
        }
    }

    fn preferenze_suggerimenti_test(tipi: &[&str], giorni: i64) -> PreferenzeSuggerimenti {
        PreferenzeSuggerimenti {
            tipi_abilitati: tipi.iter().map(|tipo| (*tipo).to_string()).collect(),
            notifiche_attive: true,
            giorni_avviso: [("rimborso".to_string(), giorni)].into_iter().collect(),
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
            aggiornato_ms: giorno + 1_000,
        };
        let subito = preferenze_suggerimenti_test(&["rimborso"], 0);
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &subito,
            giorno + 60_999,
            giorno + 1_000,
        ));
        assert!(suggerimento_notificabile(
            &suggerimento,
            &subito,
            giorno + 61_000,
            giorno + 1_000,
        ));

        let domani = preferenze_suggerimenti_test(&["rimborso"], 1);
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &domani,
            giorno + GIORNO_MS - 1,
            giorno + 1_000,
        ));
        assert!(suggerimento_notificabile(
            &suggerimento,
            &domani,
            giorno + GIORNO_MS,
            giorno + 1_000,
        ));
        let disabilitato = preferenze_suggerimenti_test(&[], 0);
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &disabilitato,
            i64::MAX,
            giorno + 1_000,
        ));

        // Una nuova fotografia residua deve attendere anche se le sorgenti
        // rimaste sono vecchie (es. una liquidazione parziale appena conclusa).
        let molto_dopo = giorno + 10 * GIORNO_MS;
        assert!(!suggerimento_notificabile(
            &suggerimento,
            &subito,
            molto_dopo,
            molto_dopo - 30_000,
        ));
        assert!(suggerimento_notificabile(
            &suggerimento,
            &subito,
            molto_dopo,
            molto_dopo - RIVALIDAZIONE_SUGGERIMENTO_MS,
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
}
