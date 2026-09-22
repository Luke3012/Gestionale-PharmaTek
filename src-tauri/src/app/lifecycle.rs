use super::cleanup::manutenzione_retention_notifiche;
use super::*;

impl AppState {
    /// Inizializza lo stato all'avvio: carica/crea `config.json` (con `device_id`)
    /// e, se già onboarded, apre il motore e avvia il file-watch.
    #[cfg(test)]
    pub fn init(app_dir: PathBuf) -> AppResult<Self> {
        Self::init_internal(app_dir, None)
    }

    #[cfg(not(test))]
    pub(crate) fn init_with_app_handle(
        app_dir: PathBuf,
        app_handle: NativeAppHandle,
    ) -> AppResult<Self> {
        Self::init_internal(app_dir, Some(app_handle))
    }

    fn init_internal(app_dir: PathBuf, app_handle: Option<NativeAppHandle>) -> AppResult<Self> {
        fs::create_dir_all(&app_dir).map_err(e)?;
        // Un arresto del processo può impedire il cleanup finale degli XLSX
        // intermedi. La directory è locale ad AppData e contiene soltanto
        // artefatti di preparazione rigenerabili.
        let _ = fs::remove_dir_all(app_dir.join("production-preparation"));
        let mut config = load_config(&app_dir)?;
        if config.device_id.is_empty() {
            config.device_id = Ulid::generate().to_string();
            save_config(&app_dir, &config)?;
        }

        let mut runtime = None;
        if let (Some(dir), Some(uid)) = (config.data_dir.clone(), config.user_id.clone()) {
            if Path::new(&dir).is_dir() {
                pulisci_restore_coordination_vecchia(
                    Path::new(&dir),
                    24 * 60 * 60 * 1000,
                    &config.device_id,
                );
                match open_runtime(
                    &app_dir,
                    &dir,
                    &config.device_id,
                    &uid,
                    clone_native_app_handle(&app_handle),
                ) {
                    Ok(rt) => runtime = Some(rt),
                    Err(err) => eprintln!("apertura motore fallita: {err}"),
                }
            }
        }

        let app = AppState {
            app_dir,
            config: Mutex::new(config),
            runtime: Mutex::new(runtime),
            app_handle: Mutex::new(app_handle),
            reconnect_required: Mutex::new(false),
            operation_lock_local: Mutex::new(None),
            email_test_local: Mutex::new(()),
            communication_send_local: Mutex::new(()),
            runtime_activity: runtime_activity::RuntimeActivityGate::default(),
            communication_engine: Mutex::new(None),
            pending_document_cache: Mutex::new(HashSet::new()),
            document_cache_io: Mutex::new(()),
            communication_wake: CommunicationWake::default(),
            communication_startup_held: Mutex::new({
                #[cfg(test)]
                {
                    Some(HashSet::new())
                }
                #[cfg(not(test))]
                {
                    None
                }
            }),
            prescriptions_index: Mutex::new(None),
        };
        // Marker e manifest possono arrivare prima dei file del payload. In quella
        // finestra la proiezione è intenzionalmente incompleta: non va usata per
        // ritirare il device, scollegare l'utente o scrivere seed condivisi.
        if app.restore_remoto_stato() == "none" {
            let _ = app.reset_if_current_device_retired();
            let cfg = app.config();
            let identity = app.whoami();
            let data_dir_status = stato_cartella_dati(cfg.data_dir.as_deref());
            let _ = app.reset_if_configured_user_missing(&cfg, identity.as_ref(), &data_dir_status);
            // Se già onboarded, assicura i conti speciali built-in (anche per installazioni
            // precedenti alla FASE 3) e i corrieri built-in (CORRIERE_B, CORRIERE_A).
            if app.whoami().is_some() {
                app.seed_builtin_conti();
                app.seed_builtin_corrieri();
                app.seed_prodotti_produzione();
                app.seed_anagrafiche_default();
                app.seed_modelli_comunicazione();
            }
        }
        Ok(app)
    }

    pub(crate) fn config(&self) -> AppConfig {
        self.config.lock().expect("config poisoned").clone()
    }

    /// Stato per il bootstrap della UI.
    pub fn bootstrap(&self) -> BootstrapDto {
        let restore_status = self.restore_remoto_stato();
        if restore_status == "none" {
            let _ = self.reset_if_current_device_retired();
        }
        let mut cfg = self.config();
        let mut identity = self.whoami();
        let mut data_dir_status = stato_cartella_dati(cfg.data_dir.as_deref());
        if restore_status == "none"
            && self
                .reset_if_configured_user_missing(&cfg, identity.as_ref(), &data_dir_status)
                .unwrap_or(false)
        {
            cfg = self.config();
            identity = self.whoami();
            data_dir_status = stato_cartella_dati(cfg.data_dir.as_deref());
        }

        BootstrapDto {
            onboarded: identity.is_some(),
            device_id: cfg.device_id,
            device_nome: hostname(),
            data_dir: cfg.data_dir,
            data_dir_status,
            identity,
            reconnect_required: *self.reconnect_required.lock().expect("reconnect poisoned"),
            pending_restore: restore_status == "ready",
            restore_status,
        }
    }

    fn restore_remoto_stato(&self) -> String {
        let guard = self.runtime.lock().expect("rt poisoned");
        match guard
            .as_ref()
            .map(|rt| rt.engine.restore_remoto_stato())
            .unwrap_or(crate::sync::RestoreRemoteStatus::None)
        {
            crate::sync::RestoreRemoteStatus::None => "none",
            crate::sync::RestoreRemoteStatus::Waiting => "waiting",
            crate::sync::RestoreRemoteStatus::Ready => "ready",
        }
        .to_string()
    }

    pub(super) fn reset_if_configured_user_missing(
        &self,
        cfg: &AppConfig,
        identity: Option<&IdentityDto>,
        data_dir_status: &str,
    ) -> AppResult<bool> {
        if identity.is_some() || data_dir_status != "ok" {
            return Ok(false);
        }
        let Some(uid) = cfg.user_id.as_deref() else {
            return Ok(false);
        };
        if cfg.data_dir.is_none() {
            return Ok(false);
        }
        let user_missing = {
            let guard = self.runtime.lock().expect("rt poisoned");
            let Some(rt) = guard.as_ref() else {
                return Ok(false);
            };
            rt.engine.with_projection(|p| {
                p.list("user")
                    .map(|users| users.iter().all(|u| u.id != uid))
                    .unwrap_or(false)
            })
        };
        if user_missing {
            self.disconnetti_configurazione_locale()?;
        }
        Ok(user_missing)
    }

    pub(super) fn reset_if_current_device_retired(&self) -> AppResult<bool> {
        let cfg = self.config();
        let retired = {
            let guard = self.runtime.lock().expect("rt poisoned");
            let Some(rt) = guard.as_ref() else {
                return Ok(false);
            };
            rt.engine
                .with_projection(|p| p.is_device_retired(&cfg.device_id).unwrap_or(false))
        };
        if retired {
            self.disconnetti_device_ritirato()?;
        }
        Ok(retired)
    }

    pub(super) fn disconnetti_configurazione_locale(&self) -> AppResult<()> {
        let device_id = self.config().device_id;
        self.cancella_cartella_locale()?;
        let mut c = self.config.lock().expect("config poisoned");
        *c = AppConfig {
            device_id,
            ..AppConfig::default()
        };
        *self.reconnect_required.lock().expect("reconnect poisoned") = true;
        Ok(())
    }

    fn disconnetti_device_ritirato(&self) -> AppResult<()> {
        self.cancella_cartella_locale()?;
        let mut c = self.config.lock().expect("config poisoned");
        *c = AppConfig {
            device_id: Ulid::generate().to_string(),
            ..AppConfig::default()
        };
        *self.reconnect_required.lock().expect("reconnect poisoned") = true;
        Ok(())
    }

    /// Apre (o riapre) il motore su `data_dir` con un'autorità provvisoria, e
    /// restituisce gli utenti già presenti nel registro condiviso (per gestire i
    /// duplicati in onboarding). Non salva ancora la configurazione.
    pub fn open_data_dir(&self, data_dir: &str) -> AppResult<Vec<UserDto>> {
        valida_radice_dati(data_dir)?;
        let mut cfg = self.config();
        pulisci_restore_coordination_vecchia(
            Path::new(data_dir),
            24 * 60 * 60 * 1000,
            &cfg.device_id,
        );
        let mut author = cfg
            .user_id
            .clone()
            .unwrap_or_else(|| format!("nuovo@{}", cfg.device_id));
        // Chiude un eventuale motore precedente (connessione + watcher) PRIMA di
        // aprire il nuovo, per non avere mai due connessioni allo stesso SQLite.
        *self.runtime.lock().expect("rt poisoned") = None;
        rimuovi_proiezione_locale(&self.app_dir)?;
        let handle = clone_native_app_handle(&self.app_handle.lock().expect("handle poisoned"));
        let mut rt = open_runtime(
            &self.app_dir,
            data_dir,
            &cfg.device_id,
            &author,
            clone_native_app_handle(&handle),
        )?;

        // Una nuova configurazione non ha ancora un `data_dir` persistito, quindi
        // Root non puo' ricostruire per suo conto un restore trovato scegliendo la
        // cartella. Completiamo qui il riallineamento prima di mostrare gli utenti:
        // l'onboarding non deve sparire dietro al bootscreen ne' leggere uno
        // snapshot privo della coda NDJSON.
        match rt.engine.restore_remoto_stato() {
            crate::sync::RestoreRemoteStatus::Waiting => {
                return Err(
                    "Ripristino dati in corso: attendi che OneDrive completi la sincronizzazione e riprova."
                        .into(),
                );
            }
            crate::sync::RestoreRemoteStatus::Ready => {
                let restore_anchor = rt.engine.restore_anchor_remoto_pronto();
                if let Some(anchor) = restore_anchor.as_ref() {
                    rt.engine
                        .registra_restore_anchor_locale(anchor)
                        .map_err(es)?;
                }
                drop(rt);
                rimuovi_proiezione_locale(&self.app_dir)?;
                rt = match restore_anchor {
                    Some(anchor) => open_runtime_con_restore_anchor(
                        &self.app_dir,
                        data_dir,
                        &cfg.device_id,
                        &author,
                        clone_native_app_handle(&handle),
                        anchor,
                    )?,
                    None => open_runtime(
                        &self.app_dir,
                        data_dir,
                        &cfg.device_id,
                        &author,
                        clone_native_app_handle(&handle),
                    )?,
                };
                rt.engine.segna_restore_pronti_come_gestiti().map_err(es)?;
                rt.engine.ingest().map_err(es)?;
            }
            crate::sync::RestoreRemoteStatus::None => {}
        }
        *self.runtime.lock().expect("rt poisoned") = Some(rt);

        // Il marker di ritiro remoto può arrivare proprio mentre l'utente sceglie
        // la cartella. In quel caso il runtime appena aperto usa ancora il vecchio
        // deviceId: ruotalo subito e riapri il motore, altrimenti l'onboarding
        // scriverebbe nel flusso revocato e la nuova postazione resterebbe invisibile.
        if self.reset_if_current_device_retired()? {
            cfg = self.config();
            author = format!("nuovo@{}", cfg.device_id);
            let rt = open_runtime(&self.app_dir, data_dir, &cfg.device_id, &author, handle)?;
            *self.runtime.lock().expect("rt poisoned") = Some(rt);
        }

        let guard = self.runtime.lock().expect("rt poisoned");
        Ok(list_users(&guard.as_ref().expect("engine assente").engine))
    }

    /// Completa l'onboarding: crea/aggiorna l'utente e registra il dispositivo come
    /// eventi, salva la configurazione locale e riapre il motore con l'autorità
    /// definitiva (lo `userId`).
    pub fn finish_onboarding(&self, args: FinishOnboarding) -> AppResult<IdentityDto> {
        valida_radice_dati(&args.data_dir)?;
        let mut cfg = self.config();
        self.ensure_engine(
            &args.data_dir,
            cfg.user_id.as_deref().unwrap_or(&cfg.device_id),
        )?;

        // Chiude anche la gara fra la scelta cartella e il click finale: se nel
        // frattempo è arrivato il ritiro di questo PC, nessun evento deve essere
        // emesso con l'identificativo ormai revocato.
        if self.reset_if_current_device_retired()? {
            cfg = self.config();
            self.ensure_engine(&args.data_dir, &cfg.device_id)?;
        }
        let mut device_id = cfg.device_id.clone();
        let now = now_iso();
        let is_reconnecting = *self.reconnect_required.lock().expect("reconnect poisoned");
        let existing_device_id = if is_reconnecting && (args.mode == "use" || args.mode == "reconfigure") {
            let guard = self.runtime.lock().expect("rt poisoned");
            if let Some(rt) = guard.as_ref() {
                let host = hostname();
                let uid = args.user_id.as_deref().unwrap_or("");
                rt.engine.with_projection(|p| {
                    p.list("device")
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|d| {
                            !p.is_device_retired(&d.id).unwrap_or(false)
                                && str_field(&d.data, "nome").trim().eq_ignore_ascii_case(&host)
                                && str_field(&d.data, "user_id") == uid
                        })
                        .max_by_key(|d| d.id.clone())
                        .map(|d| d.id)
                })
            } else {
                None
            }
        } else {
            None
        };

        if let Some(target_id) = existing_device_id {
            if target_id != device_id {
                let target_author = args.user_id.as_deref().unwrap_or(&target_id);
                // Riapre il runtime con il deviceId originale già registrato per questo computer e utente
                *self.runtime.lock().expect("rt poisoned") = None;
                let handle = clone_native_app_handle(&self.app_handle.lock().expect("handle poisoned"));
                let rt = open_runtime(
                    &self.app_dir,
                    &args.data_dir,
                    &target_id,
                    target_author,
                    handle,
                )?;
                *self.runtime.lock().expect("rt poisoned") = Some(rt);
                device_id = target_id.clone();
                cfg.device_id = target_id;
            }
        }

        let user_id = {
            let guard = self.runtime.lock().expect("rt poisoned");
            let engine = &guard.as_ref().expect("engine assente").engine;

            let user_id = match args.mode.as_str() {
                "use" => {
                    let uid = args.user_id.clone().ok_or("user_id mancante per 'use'")?;
                    // Un profilo visto prima dell'ultimo ingest può essere stato
                    // soft-deleted dal ritiro. Riutilizzarlo deve essere atomico e
                    // convergente, non lasciare un device legato a un utente sparito.
                    engine.emit("user", &uid, EventBody::Restored).map_err(es)?;
                    uid
                }
                "reconfigure" => {
                    let uid = args
                        .user_id
                        .clone()
                        .ok_or("user_id mancante per 'reconfigure'")?;
                    set_fields(
                        engine,
                        "user",
                        &uid,
                        &[
                            ("nome", json!(args.nome)),
                            ("avatar_tipo", json!(args.avatar_tipo)),
                            ("avatar_valore", json!(args.avatar_valore)),
                        ],
                    )?;
                    uid
                }
                _ => {
                    // create: usa l'id fornito dalla UI (così conosce già il nome
                    // file avatar `<userId>.png`), altrimenti generane uno.
                    let uid = args
                        .user_id
                        .clone()
                        .unwrap_or_else(|| Ulid::generate().to_string());
                    engine.emit("user", &uid, EventBody::Created).map_err(es)?;
                    set_fields(
                        engine,
                        "user",
                        &uid,
                        &[
                            ("nome", json!(args.nome)),
                            ("avatar_tipo", json!(args.avatar_tipo)),
                            ("avatar_valore", json!(args.avatar_valore)),
                            ("creato_ts", json!(now)),
                        ],
                    )?;
                    uid
                }
            };

            // Registra/aggiorna questo dispositivo (presence).
            engine
                .emit("device", &device_id, EventBody::Created)
                .map_err(es)?;
            // `Created` non annulla una tombstone LWW. È normalmente un no-op per
            // il nuovo ULID, ma rende sicuro anche un recupero da configurazioni
            // legacy che avessero conservato un id già soft-deleted.
            engine
                .emit("device", &device_id, EventBody::Restored)
                .map_err(es)?;
            set_fields(
                engine,
                "device",
                &device_id,
                &[
                    ("nome", json!(hostname())),
                    ("user_id", json!(user_id)),
                    ("registrato_ts", json!(now)),
                ],
            )?;
            user_id
        };

        // Salva la configurazione locale.
        {
            let mut c = self.config.lock().expect("config poisoned");
            c.device_id = device_id.clone();
            c.data_dir = Some(args.data_dir.clone());
            c.user_id = Some(user_id.clone());
            save_config(&self.app_dir, &c)?;
        }

        // Imposta l'autorità definitiva (userId) sul motore GIÀ aperto, senza
        // riaprirlo: una sola connessione SQLite (niente "database is locked").
        let identity = {
            let guard = self.runtime.lock().expect("rt poisoned");
            let engine = &guard.as_ref().expect("engine assente").engine;
            engine.set_user(&user_id);
            identity_from(engine, &user_id, &device_id, &args.data_dir)
        }
        .ok_or_else(|| "utente non trovato dopo l'onboarding".to_string())?;
        *self.reconnect_required.lock().expect("reconnect poisoned") = false;

        // Conti speciali built-in (Contrassegno, Assegno) per la contabilità + corrieri built-in.
        self.seed_builtin_conti();
        self.seed_builtin_corrieri();
        self.seed_prodotti_produzione();
        self.seed_anagrafiche_default();

        Ok(identity)
    }

    pub fn get_users(&self) -> Vec<UserDto> {
        match &*self.runtime.lock().expect("rt poisoned") {
            Some(rt) => list_users(&rt.engine),
            None => Vec::new(),
        }
    }

    pub fn whoami(&self) -> Option<IdentityDto> {
        let cfg = self.config();
        let (uid, dir) = (cfg.user_id?, cfg.data_dir?);
        let guard = self.runtime.lock().expect("rt poisoned");
        let rt = guard.as_ref()?;
        identity_from(&rt.engine, &uid, &cfg.device_id, &dir)
    }

    /// Salva i byte di una foto avatar in `meta/avatars/<userId>.png`.
    pub fn save_avatar(&self, user_id: &str, bytes: &[u8]) -> AppResult<()> {
        let cfg = self.config();
        let dir = cfg.data_dir.ok_or("cartella dati non impostata")?;
        let avatars = Path::new(&dir).join("meta").join("avatars");
        fs::create_dir_all(&avatars).map_err(e)?;
        fs::write(avatars.join(format!("{user_id}.png")), bytes).map_err(e)?;
        Ok(())
    }

    /// Aggiorna nome e avatar dell'utente corrente (gestione profilo da Impostazioni:
    /// gli stessi dati dell'onboarding). Restituisce l'identità aggiornata.
    pub fn aggiorna_profilo(
        &self,
        nome: &str,
        avatar_tipo: &str,
        avatar_valore: &str,
    ) -> AppResult<IdentityDto> {
        let cfg = self.config();
        let user_id = cfg.user_id.clone().ok_or("utente non configurato")?;
        let device_id = cfg.device_id.clone();
        let data_dir = cfg.data_dir.clone().ok_or("cartella dati non impostata")?;
        let guard = self.runtime.lock().expect("rt poisoned");
        let engine = &guard.as_ref().ok_or("motore non aperto")?.engine;
        set_fields(
            engine,
            "user",
            &user_id,
            &[
                ("nome", json!(nome)),
                ("avatar_tipo", json!(avatar_tipo)),
                ("avatar_valore", json!(avatar_valore)),
            ],
        )?;
        identity_from(engine, &user_id, &device_id, &data_dir).ok_or("utente non trovato".into())
    }

    /// Legge i byte della foto avatar (per ricostruire l'immagine nella UI).
    pub fn read_avatar(&self, user_id: &str) -> AppResult<Option<Vec<u8>>> {
        let cfg = self.config();
        let dir = match cfg.data_dir {
            Some(d) => d,
            None => return Ok(None),
        };
        let path = Path::new(&dir)
            .join("meta")
            .join("avatars")
            .join(format!("{user_id}.png"));
        match fs::read(&path) {
            Ok(b) => Ok(Some(b)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    }

    /// Panoramica sincronizzazione: dispositivi noti con ultima attività derivata
    /// dagli eventi (nessun polling), freschezza e percorso cartella.
    pub fn sync_overview(&self) -> AppResult<SyncOverviewDto> {
        self.sync_overview_impl(false)
    }

    /// Elenco amministrativo per il ritiro: include anche i device scollegati da
    /// un utente, purché non siano già stati ritirati.
    pub fn sync_overview_ritiro(&self) -> AppResult<SyncOverviewDto> {
        self.sync_overview_impl(true)
    }

    fn sync_overview_impl(&self, include_scollegati: bool) -> AppResult<SyncOverviewDto> {
        let cfg = self.config();
        let current = cfg.device_id.clone();
        self.with_engine(|engine| {
            Ok(engine.with_projection(|p| {
                let attivita = p.device_activity().unwrap_or_default();
                // Info utente per id: (nome, avatar_tipo, avatar_valore) — per mostrare
                // l'avatar nella panoramica e poter scrivere alla persona.
                let mut user_info: HashMap<String, (String, String, String)> = HashMap::new();
                for u in p.list("user").unwrap_or_default() {
                    user_info.insert(
                        u.id.clone(),
                        (
                            str_field(&u.data, "nome"),
                            str_field(&u.data, "avatar_tipo"),
                            str_field(&u.data, "avatar_valore"),
                        ),
                    );
                }

                let mut nomi: HashMap<String, String> = HashMap::new();
                let mut utenti: HashMap<String, String> = HashMap::new();
                for d in p.list("device").unwrap_or_default() {
                    nomi.insert(d.id.clone(), str_field(&d.data, "nome"));
                    utenti.insert(d.id.clone(), str_field(&d.data, "user_id"));
                }
                let ritirati: HashSet<String> = p
                    .list("device_retired")
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| r.id)
                    .collect();
                // La freschezza descrive l'archivio, non soltanto le righe
                // visualizzabili: un device appena scollegato può avere emesso
                // l'evento più recente e va comunque contato nel timestamp.
                let last_event_ms = nomi
                    .keys()
                    .filter(|id| !ritirati.contains(*id))
                    .filter_map(|id| attivita.get(id).copied())
                    .max()
                    .unwrap_or(0);

                // La lista operativa deriva esclusivamente dal registro `device`
                // e richiede un profilo utente vivo collegato. Un PC appena
                // riconfigurato conserva il deviceId, ma resta invisibile finché
                // il nuovo onboarding non imposta nuovamente `user_id`.
                // I watermark di attività possono contenere autori orfani (per esempio
                // vecchi log riapparsi da OneDrive dopo un reset completo): servono per
                // la data dell'ultima attività, non per inventare una postazione.
                let mut ids: std::collections::BTreeSet<String> = nomi.keys().cloned().collect();
                // Il marker di ritiro e' autorevole anche per il device corrente:
                // normalmente il lifecycle ruota subito il suo id, ma durante una
                // gara di ingest non deve esistere una finestra in cui ricompare
                // nelle liste operative.
                ids.retain(|id| {
                    if ritirati.contains(id) {
                        return false;
                    }
                    include_scollegati
                        || utenti.get(id).is_some_and(|user_id| {
                            !user_id.is_empty() && user_info.contains_key(user_id)
                        })
                });

                let mut devices = Vec::new();
                for id in ids {
                    let last_ms = *attivita.get(&id).unwrap_or(&0);
                    let nome = nomi
                        .get(&id)
                        .cloned()
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| id.clone());
                    let uid = utenti.get(&id).cloned().unwrap_or_default();
                    let (user_nome, avatar_tipo, avatar_valore) =
                        user_info.get(&uid).cloned().unwrap_or_default();
                    devices.push(DispositivoDto {
                        is_current: id == current,
                        device_id: id,
                        nome,
                        user_id: uid,
                        user_nome,
                        avatar_tipo,
                        avatar_valore,
                        last_ms,
                    });
                }
                devices.sort_by_key(|b| std::cmp::Reverse(b.last_ms));

                SyncOverviewDto {
                    devices,
                    last_event_ms,
                    data_dir: cfg.data_dir.clone(),
                }
            }))
        })
    }

    /// Apre la cartella dati nel file manager di sistema.
    pub fn apri_cartella_dati(&self) -> AppResult<()> {
        let cfg = self.config();
        let dir = cfg.data_dir.ok_or("cartella dati non impostata")?;
        apri_cartella(Path::new(&dir))
    }

    /// Apre la cartella dei backup (la crea se manca), per consultarli/eliminarli.
    pub fn apri_cartella_backup(&self) -> AppResult<()> {
        let cfg = self.config();
        let dir = cfg.data_dir.ok_or("cartella dati non impostata")?;
        let backups = crate::backup::cartella_default(Path::new(&dir));
        fs::create_dir_all(&backups).map_err(e)?;
        apri_cartella(&backups)
    }

    /// Crea un backup zip dei dati condivisi. Default: `<cartella dati>/backups/`
    /// (su OneDrive, off-site); il nome file include il deviceId (no conflitti).
    ///
    /// Prima del backup genera uno **snapshot aggiornato** dello stato (compattazione
    /// fase 1, vedi docs/COMPATTAZIONE.md): così lo zip contiene sempre uno snapshot
    /// recente e i nuovi PC ripartono da lì ripiegando solo la coda dei log.
    pub fn backup_now(
        &self,
        dest: Option<String>,
        tag: Option<String>,
    ) -> AppResult<crate::backup::BackupInfo> {
        self.backup_now_internal(dest, tag, None::<fn(u8, &str)>, true)
    }

    pub fn backup_now_with_progress<F>(
        &self,
        dest: Option<String>,
        tag: Option<String>,
        progress: F,
    ) -> AppResult<crate::backup::BackupInfo>
    where
        F: FnMut(u8, &str),
    {
        self.backup_now_internal(dest, tag, Some(progress), true)
    }

    pub(super) fn backup_now_internal<F>(
        &self,
        dest: Option<String>,
        tag: Option<String>,
        mut progress: Option<F>,
        esegui_retention: bool,
    ) -> AppResult<crate::backup::BackupInfo>
    where
        F: FnMut(u8, &str),
    {
        let _attivita_backup = self.begin_runtime_activity()?;

        fn report<F>(progress: &mut Option<F>, pct: u8, msg: &str)
        where
            F: FnMut(u8, &str),
        {
            if let Some(cb) = progress.as_mut() {
                cb(pct, msg);
            }
        }

        let cfg = self.config();
        let data_dir = cfg.data_dir.ok_or("cartella dati non impostata")?;
        let backup_import = tag.as_deref() == Some("pre-import");
        // 1. Snapshot best-effort: un eventuale errore non deve impedire il backup.
        report(&mut progress, 10, "Creo uno snapshot aggiornato...");
        if let Some(rt) = self.runtime.lock().expect("rt poisoned").as_ref() {
            if let Err(err) =
                salva_snapshot_con_device(&rt.engine, Path::new(&data_dir), &cfg.device_id)
            {
                eprintln!("snapshot pre-backup fallito: {err}");
            }
        }
        // 2. Backup dei dati COMPLETI (log inclusi): lo storico è ora archiviato.
        report(&mut progress, 35, "Archivio log, snapshot e metadati...");
        let dest_dir = dest
            .map(PathBuf::from)
            .unwrap_or_else(|| crate::backup::cartella_default(Path::new(&data_dir)));
        let info = crate::backup::esegui(
            Path::new(&data_dir),
            &dest_dir,
            &cfg.device_id,
            10,
            tag.as_deref(),
        )?;
        // Solo dopo uno zip riuscito: la sorgente condivisa e il punto di ripristino
        // restano integri, mentre questa postazione può ripulire la propria read-model.
        let _ = self.clienti_locali_sanifica_dopo_backup();
        // 2b. Manutenzione dati effimeri: solo dopo che lo storico completo è nello zip.
        // Se un altro PC sta facendo un'operazione sensibile il backup resta valido e la
        // manutenzione verrà ritentata al prossimo giro.
        if esegui_retention && !backup_import {
            report(&mut progress, 68, "Pulisco notifiche vecchie...");
            match self.acquisisci_lock("manutenzione_notifiche") {
                Ok(()) => {
                    let retention = self.with_engine(|engine| {
                        manutenzione_retention_notifiche(
                            engine,
                            Path::new(&data_dir),
                            &cfg.device_id,
                        )
                    });
                    let _ = self.rilascia_lock();
                    match retention {
                        Ok(stats) if stats.compattato => {
                            if let Err(err) =
                                scrivi_restore_marker(Path::new(&data_dir), &cfg.device_id, None)
                            {
                                eprintln!("marker restore post-retention fallito: {err}");
                            }
                            if let Err(err) = self.ricostruisci_proiezione_locale() {
                                eprintln!("ricostruzione post-retention fallita: {err}");
                            }
                        }
                        Ok(_) => {}
                        Err(err) => eprintln!("retention notifiche fallita: {err}"),
                    }
                }
                Err(err) => eprintln!("retention notifiche saltata: {err}"),
            }
        }
        // I log condivisi restano append-only e completi. Non vengono più troncati:
        // è la scelta più affidabile quando più PC possono creare snapshot mentre
        // sono offline e impedisce che un client rimasto indietro dipenda da un
        // singolo snapshot per recuperare la storia mancante.
        if !backup_import {
            report(&mut progress, 82, "Ottimizzo la cache locale...");
            if let Some(rt) = self.runtime.lock().expect("rt poisoned").as_ref() {
                rt.engine.with_projection(|p| {
                    if let Err(err) = p.prune_applied_events(RETENZIONE_APPLIED_EVENTI) {
                        eprintln!("potatura applied_events fallita: {err}");
                    }
                });
            }
        }
        report(&mut progress, 100, "Backup completato.");
        Ok(info)
    }

    /// Elenco dei backup disponibili (default: cartella backup dentro i dati).
    pub fn lista_backup(&self, dest: Option<String>) -> AppResult<Vec<crate::backup::BackupInfo>> {
        let dest_dir = match dest {
            Some(d) => PathBuf::from(d),
            None => {
                let dd = self
                    .config()
                    .data_dir
                    .ok_or("cartella dati non impostata")?;
                crate::backup::cartella_default(Path::new(&dd))
            }
        };
        crate::backup::lista(&dest_dir)
    }

    /// Elimina un singolo file di backup (dalla lista in Impostazioni).
    pub fn elimina_backup(&self, zip_path: &str) -> AppResult<()> {
        crate::backup::elimina(Path::new(zip_path))?;
        Ok(())
    }

    pub fn backup_snapshot_choices(
        &self,
        zip_path: &str,
    ) -> AppResult<Vec<crate::backup::SnapshotInfoDto>> {
        crate::backup::snapshot_choices(Path::new(zip_path))
    }

    pub fn restore_prepare(&self) -> AppResult<RestoreCoordinationDto> {
        let cfg = self.config();
        let data_dir = cfg.data_dir.clone().ok_or("cartella dati non impostata")?;
        self.acquisisci_lock("preparazione_ripristino")?;
        let mut restore_id_creato = None;
        let result = (|| {
            let data_path = Path::new(&data_dir);
            pulisci_restore_coordination_vecchia(data_path, 24 * 60 * 60 * 1000, &cfg.device_id);
            let restore_id = format!("{}-{}", cfg.device_id, now_ms());
            restore_id_creato = Some(restore_id.clone());
            scrivi_restore_prepare(data_path, &restore_id, &cfg.device_id, &hostname())?;
            scrivi_restore_ack(
                data_path,
                &restore_id,
                &cfg.device_id,
                &hostname(),
                self.whoami()
                    .map(|i| i.nome)
                    .unwrap_or_else(|| "Questo PC".to_string())
                    .as_str(),
            )?;
            self.restore_coordination_status(&restore_id)
        })();
        if result.is_err() {
            if let Some(restore_id) = restore_id_creato.as_deref() {
                let data_path = Path::new(&data_dir);
                let _ = scrivi_restore_cancel(data_path, restore_id, &cfg.device_id);
                rimuovi_restore_coordination(data_path, Some(restore_id));
            }
            let _ = self.rilascia_lock();
        }
        result
    }

    pub fn restore_coordination_status(
        &self,
        restore_id: &str,
    ) -> AppResult<RestoreCoordinationDto> {
        let cfg = self.config();
        let data_dir = cfg.data_dir.clone().ok_or("cartella dati non impostata")?;
        let overview = self.sync_overview()?;
        let mut acks = leggi_restore_acks(Path::new(&data_dir), restore_id);
        acks.sort_by_key(|a| a.ms);
        let expected_ids: HashSet<String> = overview
            .devices
            .iter()
            .map(|d| d.device_id.clone())
            .collect();
        acks.retain(|ack| expected_ids.contains(&ack.device_id));
        let acknowledged = acks.len();
        Ok(RestoreCoordinationDto {
            restore_id: restore_id.to_string(),
            expected_count: overview.devices.len(),
            expected: overview.devices,
            acks,
            acknowledged,
        })
    }

    pub fn restore_cancel(&self, restore_id: &str) -> AppResult<()> {
        // Un annullamento tardivo non deve scrivere un cancel né liberare una fase
        // successiva o un'altra operazione partita nel frattempo.
        self.rinnova_lock("preparazione_ripristino")?;
        let cfg = self.config();
        if let Some(data_dir) = cfg.data_dir.as_deref() {
            scrivi_restore_cancel(Path::new(data_dir), restore_id, &cfg.device_id)?;
            rimuovi_restore_coordination(Path::new(data_dir), Some(restore_id));
        }
        self.rilascia_lock_se("preparazione_ripristino")
    }

    /// Converte lo stato condiviso in un checkpoint generazionale autorevole.
    ///
    /// La barriera viene pubblicata prima di rimuovere qualsiasi file storico:
    /// anche se OneDrive riconsegna in seguito un vecchio log (o una conflicted
    /// copy), ogni PC lo scarta fino ai cutoff certificati dall'anchor.
    pub fn ottimizza_database(
        &self,
        generation_id: &str,
        dedup_merges: Vec<DedupClienteMergeInput>,
        forza: bool,
    ) -> AppResult<OttimizzazioneDatabaseResult> {
        let generation_id = generation_id.trim();
        if generation_id.is_empty() {
            return Err("identificativo dell'ottimizzazione mancante".into());
        }

        let coordinamento = self.restore_coordination_status(generation_id)?;
        let postazioni_senza_ack = coordinamento
            .expected_count
            .saturating_sub(coordinamento.acknowledged);
        if coordinamento.expected_count == 0 || (!forza && postazioni_senza_ack > 0) {
            return Err(format!(
                "Attendi la conferma di tutte le postazioni ({}/{} pronte).",
                coordinamento.acknowledged, coordinamento.expected_count
            ));
        }
        let cfg = self.config();
        let data_dir = cfg.data_dir.clone().ok_or("cartella dati non impostata")?;
        let data_path = Path::new(&data_dir);
        let _attivita = self.begin_runtime_activity()?;
        self.avanza_lock("preparazione_ripristino", "ottimizzazione_database")?;
        let mut barriera_pubblicata = false;

        let result = (|| {
            self.with_engine(|engine| {
                engine.ingest().map_err(es)?;
                let snapshot = snapshot_condiviso(engine)?;
                salva_snapshot_data_con_device(
                    &snapshot,
                    data_path,
                    &format!("pre-ottimizzazione-{}", cfg.device_id),
                )
            })?;

            // Il backup conserva deliberatamente log e tombstone: è la rete di
            // sicurezza completa da cui si può ancora ripristinare anche lo stato
            // precedente alle unioni clienti eseguite subito dopo.
            let backup_dir = crate::backup::cartella_default(data_path);
            let backup = crate::backup::esegui(
                data_path,
                &backup_dir,
                &cfg.device_id,
                10,
                Some("pre-ottimizzazione"),
            )?;

            let (mut snapshot, dedup_clienti, eventi_rimossi, _byte_log, file_log_totali) = self
                .with_engine(|engine| {
                    let dedup_clienti = clienti_deduplica_applica_engine(engine, dedup_merges)?;
                    let (eventi, bytes, files) = statistiche_log(data_path, &cfg.device_id)?;
                    let snapshot = snapshot_condiviso(engine)?;
                    Ok((snapshot, dedup_clienti, eventi, bytes, files))
                })?;

            let tombstone_rimosse = snapshot.purged.len();
            let record_conservati = snapshot.records.len();
            snapshot.purged.clear();
            snapshot.applied.clear();
            snapshot.offsets.clear();

            let anchor_store = SnapshotStore::new(
                data_path.join("snapshots"),
                format!("generation-anchor-{generation_id}"),
            )
            .map_err(es)?;
            let anchor = anchor_store.save(&snapshot, 1).map_err(es)?;
            let anchor_bytes = fs::metadata(&anchor).map_err(es)?.len();
            let created_at = now_ms();
            let anchor_path = anchor
                .strip_prefix(data_path)
                .map_err(es)?
                .to_string_lossy()
                .replace('\\', "/");
            let barrier = GenerationBarrier {
                protocol_version: 1,
                generation_id: generation_id.to_string(),
                created_at,
                device_id: cfg.device_id.clone(),
                anchor_path,
                anchor_bytes,
                anchor_checksum: checksum_file(&anchor).map_err(es)?,
                cutoffs: snapshot.watermarks.clone(),
            };
            barrier.write_atomic(data_path).map_err(es)?;
            barriera_pubblicata = true;

            // Da questo punto i file vecchi sono soltanto spazio occupato: la
            // barriera li rende semanticamente inerti anche se una rimozione
            // best-effort fallisce o OneDrive li riconsegna più tardi.
            self.wipe_local()?;
            let (file_log_rimossi, byte_log_rimossi) =
                rimuovi_file_con_estensione(&data_path.join("events"), "ndjson", None);
            let (snapshot_rimossi, byte_snapshot_rimossi) =
                rimuovi_file_con_estensione(&data_path.join("snapshots"), "json", Some(&anchor));
            let log_corrente = LogStore::new(data_path.join("events"), &cfg.device_id)
                .map_err(es)?
                .own_path();
            fs::write(&log_corrente, []).map_err(es)?;

            scrivi_compaction_manifest(
                data_path,
                generation_id,
                &cfg.device_id,
                created_at,
                &anchor,
            )?;
            // Commit marker sempre per ultimo: le altre postazioni non ricostruiscono
            // finché anchor, barriera e manifest non sono tutti verificabili.
            while now_ms() <= created_at {
                std::thread::sleep(Duration::from_millis(1));
            }
            scrivi_restore_marker(data_path, &cfg.device_id, Some(generation_id))?;

            let author = cfg
                .user_id
                .clone()
                .unwrap_or_else(|| format!("nuovo@{}", cfg.device_id));
            let handle = clone_native_app_handle(&self.app_handle.lock().expect("handle poisoned"));
            let rt = open_runtime_con_restore_anchor(
                &self.app_dir,
                &data_dir,
                &cfg.device_id,
                &author,
                handle,
                anchor.clone(),
            )?;
            rt.engine
                .registra_restore_anchor_locale(&anchor)
                .map_err(es)?;
            rt.engine.with_projection(|p| p.vacuum()).map_err(es)?;
            *self.runtime.lock().expect("rt poisoned") = Some(rt);

            self.seed_builtin_conti();
            self.seed_builtin_corrieri();
            self.seed_prodotti_produzione();
            self.seed_anagrafiche_default();
            self.seed_modelli_comunicazione();
            rimuovi_restore_coordination(data_path, Some(generation_id));

            Ok(OttimizzazioneDatabaseResult {
                generation_id: generation_id.to_string(),
                backup_path: backup.path,
                dedup_clienti,
                postazioni_senza_ack,
                tombstone_rimosse,
                eventi_rimossi,
                file_log_rimossi: file_log_rimossi.min(file_log_totali),
                snapshot_rimossi,
                byte_liberati: byte_log_rimossi.saturating_add(byte_snapshot_rimossi),
                record_conservati,
            })
        })();

        if result.is_err() {
            // Prima della barriera si può annullare normalmente. Dopo la barriera
            // i vecchi log restano comunque innocui; prova a rendere nuovamente
            // operativo questo PC dall'anchor generazionale prima di sbloccare gli altri.
            if barriera_pubblicata {
                let _ = self.riapri_da_generazione_corrente();
            }
            let _ = scrivi_restore_cancel(data_path, generation_id, &cfg.device_id);
            rimuovi_restore_coordination(data_path, Some(generation_id));
        }
        let _ = self.rilascia_lock();
        result
    }

    fn riapri_da_generazione_corrente(&self) -> AppResult<()> {
        let cfg = self.config();
        let data_dir = cfg.data_dir.clone().ok_or("cartella dati non impostata")?;
        let data_path = Path::new(&data_dir);
        let barrier = GenerationBarrier::load(data_path)
            .map_err(es)?
            .ok_or("checkpoint generazionale non disponibile")?;
        let anchor = barrier.anchor(data_path).map_err(es)?;
        let _ = self.wipe_local();
        let log_corrente = LogStore::new(data_path.join("events"), &cfg.device_id)
            .map_err(es)?
            .own_path();
        if !log_corrente.exists() {
            fs::write(&log_corrente, []).map_err(es)?;
        }
        let author = cfg
            .user_id
            .clone()
            .unwrap_or_else(|| format!("nuovo@{}", cfg.device_id));
        let handle = clone_native_app_handle(&self.app_handle.lock().expect("handle poisoned"));
        let rt = open_runtime_con_restore_anchor(
            &self.app_dir,
            &data_dir,
            &cfg.device_id,
            &author,
            handle,
            anchor,
        )?;
        *self.runtime.lock().expect("rt poisoned") = Some(rt);
        Ok(())
    }

    pub fn ritira_dispositivo(&self, device_id: &str) -> AppResult<RitiroDispositivoResult> {
        let target = device_id.trim();
        if target.is_empty() {
            return Err("dispositivo mancante".into());
        }
        let cfg_lock = self.config();
        let lock_device = cfg_lock.device_id.clone();
        let lock_dir = cfg_lock.data_dir.clone();
        self.acquisisci_lock("ritiro_pc")?;
        let result = self.ritira_dispositivo_locked(target);
        let _ = self.rilascia_lock_acquisito(lock_dir.as_deref().map(Path::new), &lock_device);
        result
    }

    fn ritira_dispositivo_locked(&self, device_id: &str) -> AppResult<RitiroDispositivoResult> {
        let cfg = self.config();
        let data_dir = cfg.data_dir.clone().ok_or("cartella dati non impostata")?;
        let data_path = Path::new(&data_dir);
        let current_device = cfg.device_id.clone();
        let ritira_corrente = device_id == current_device;
        let nuovo_device = ritira_corrente.then(|| Ulid::generate().to_string());

        let (device_nome, user_id, user_nome, user_usato_altrove) = self.with_engine(|engine| {
            engine.ingest().map_err(es)?;
            let (nome_device, target_user, nome_user) = engine.with_projection(|p| {
                let device = p.get("device", device_id).ok().flatten();
                let mut target_user = device
                    .as_ref()
                    .map(|d| str_field(&d.data, "user_id"))
                    .unwrap_or_default();
                if target_user.is_empty() && ritira_corrente {
                    target_user = cfg.user_id.clone().unwrap_or_default();
                }
                let user = if target_user.is_empty() {
                    None
                } else {
                    p.get("user", &target_user).ok().flatten()
                };
                let nome_device = device
                    .as_ref()
                    .map(|d| str_field(&d.data, "nome"))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| {
                        if ritira_corrente {
                            hostname()
                        } else {
                            device_id.to_string()
                        }
                    });
                let nome_user = user
                    .as_ref()
                    .map(|u| str_field(&u.data, "nome"))
                    .unwrap_or_default();
                (nome_device, target_user, nome_user)
            });
            let user_usato_altrove = profilo_usato_da_altro_device(engine, &target_user, device_id);
            Ok((nome_device, target_user, nome_user, user_usato_altrove))
        })?;

        let backup = self.with_engine(|engine| {
            let now = now_iso();
            engine
                .emit("device_retired", device_id, EventBody::Created)
                .map_err(es)?;
            set_fields(
                engine,
                "device_retired",
                device_id,
                &[
                    ("device_id", json!(device_id)),
                    ("device_nome", json!(device_nome)),
                    ("user_id", json!(user_id)),
                    ("user_nome", json!(user_nome)),
                    ("ritirato_ts", json!(now)),
                    ("ritirato_da_device", json!(current_device)),
                ],
            )?;
            engine
                .emit("device", device_id, EventBody::Deleted)
                .map_err(es)?;
            // Un utente puo' essere collegato a piu' postazioni. Ritirarne una
            // non deve cancellare il profilo e disconnettere quelle ancora attive.
            if !user_id.is_empty() && !user_usato_altrove {
                elimina_profilo_con_engine(engine, &user_id)?;
            }

            let snapshot_owner = nuovo_device.as_deref().unwrap_or(&current_device);
            salva_snapshot_con_device(engine, data_path, snapshot_owner)?;
            let dest = crate::backup::cartella_default(data_path);
            crate::backup::esegui(data_path, &dest, &current_device, 10, Some("ritiro-pc"))
        })?;

        if !user_id.is_empty() && !user_usato_altrove {
            rimuovi_avatar(data_path, &user_id);
        }
        let events_removed = rimuovi_log_dispositivo(data_path, device_id);
        rimuovi_snapshot_dispositivo(data_path, device_id);
        scrivi_restore_marker(data_path, &current_device, None)?;

        if ritira_corrente {
            self.cancella_cartella_locale()?;
            let mut c = self.config.lock().expect("config poisoned");
            *c = AppConfig {
                device_id: nuovo_device.expect("nuovo device mancante"),
                ..AppConfig::default()
            };
            *self.reconnect_required.lock().expect("reconnect poisoned") = false;
        } else {
            self.ricostruisci_proiezione_locale()?;
        }

        Ok(RitiroDispositivoResult {
            device_id: device_id.to_string(),
            device_nome,
            user_id,
            user_nome,
            backup_path: backup.path,
            events_removed,
        })
    }

    /// Ripristina un backup: chiude il motore, sostituisce i dati e lo riapre
    /// (la proiezione si ricostruisce dai dati ripristinati). Irreversibile.
    pub fn ripristina_backup(
        &self,
        zip_path: &str,
        snapshot_path_in_zip: Option<&str>,
        mode: Option<&str>,
        restore_id: Option<&str>,
    ) -> AppResult<()> {
        if restore_id.is_some_and(|id| !id.trim().is_empty()) {
            self.avanza_lock("preparazione_ripristino", "ripristino_backup")?;
        } else {
            self.acquisisci_lock("ripristino_backup")?;
        }
        let restore_id_coordinato = restore_id
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_string);
        let result = (|| {
            let cfg = self.config();
            let data_dir = cfg.data_dir.clone().ok_or("cartella dati non impostata")?;
            self.wipe_local()?;
            let manual_snapshot = if mode == Some("manual") {
                snapshot_path_in_zip
            } else {
                None
            };
            crate::backup::ripristina(Path::new(zip_path), Path::new(&data_dir), manual_snapshot)?;
            pulisci_locks_runtime(Path::new(&data_dir))?;
            let restore_id = restore_id
                .filter(|id| !id.trim().is_empty())
                .map(|id| id.trim().to_string())
                .unwrap_or_else(|| format!("{}-{}", cfg.device_id, now_ms()));
            let author = cfg
                .user_id
                .unwrap_or_else(|| format!("nuovo@{}", cfg.device_id));
            let handle = clone_native_app_handle(&self.app_handle.lock().expect("handle poisoned"));
            let rt = open_runtime(&self.app_dir, &data_dir, &cfg.device_id, &author, handle)?;
            let snapshot = snapshot_condiviso(&rt.engine)?;
            let anchor = scrivi_restore_anchor(Path::new(&data_dir), &snapshot)?;
            scrivi_restore_manifest(Path::new(&data_dir), &restore_id, &cfg.device_id, &anchor)?;
            // Il marker è sempre l'ultimo artefatto scritto: una postazione remota
            // non può osservare un commit dichiarato prima di anchor e manifest.
            scrivi_restore_marker(Path::new(&data_dir), &cfg.device_id, Some(&restore_id))?;
            // Anche il coordinatore deve riusare l'anchor se in futuro perde la
            // cache SQLite: il proprio marker è intenzionalmente ignorato.
            rt.engine
                .registra_restore_anchor_locale(&anchor)
                .map_err(es)?;
            *self.runtime.lock().expect("rt poisoned") = Some(rt);
            self.seed_builtin_conti(); // il backup potrebbe precedere la FASE 3
            self.seed_builtin_corrieri();
            self.seed_prodotti_produzione();
            self.seed_anagrafiche_default();
            Ok(())
        })();
        if let Some(restore_id) = restore_id_coordinato.as_deref() {
            let cfg = self.config();
            if let Some(data_dir) = cfg.data_dir.as_deref() {
                let data_path = Path::new(data_dir);
                if result.is_err() {
                    let _ = scrivi_restore_cancel(data_path, restore_id, &cfg.device_id);
                }
                rimuovi_restore_coordination(data_path, Some(restore_id));
            }
        }
        let _ = self.rilascia_lock();
        result
    }

    /// Ricostruisce la proiezione locale SQLite cancellandola e riaprendola da zero.
    /// Caricherà lo snapshot e i log da OneDrive in background.
    pub fn ricostruisci_proiezione_locale(&self) -> AppResult<()> {
        let cfg = self.config();
        let data_dir = cfg.data_dir.clone().ok_or("cartella dati non impostata")?;
        let restore_anchor = {
            let runtime = self.runtime.lock().expect("rt poisoned");
            let anchor = runtime
                .as_ref()
                .and_then(|rt| rt.engine.restore_anchor_remoto_pronto());
            if let (Some(rt), Some(anchor)) = (runtime.as_ref(), anchor.as_ref()) {
                rt.engine
                    .registra_restore_anchor_locale(anchor)
                    .map_err(es)?;
            }
            anchor
        };
        self.wipe_local()?;
        let author = cfg
            .user_id
            .unwrap_or_else(|| format!("nuovo@{}", cfg.device_id));
        let handle = clone_native_app_handle(&self.app_handle.lock().expect("handle poisoned"));
        let rt = match restore_anchor {
            Some(anchor) => open_runtime_con_restore_anchor(
                &self.app_dir,
                &data_dir,
                &cfg.device_id,
                &author,
                handle,
                anchor,
            )?,
            None => open_runtime(&self.app_dir, &data_dir, &cfg.device_id, &author, handle)?,
        };
        rt.engine.segna_restore_pronti_come_gestiti().map_err(es)?;
        // Nei manifest legacy non esiste un anchor dedicato. L'apertura appena
        // sopra importa quindi lo snapshot ordinario ma sospende il replay finche'
        // il marker e' pendente. Dopo averlo assorbito bisogna ripiegare la coda
        // prima di decidere che utente o device non esistano: in caso contrario un
        // profilo creato dopo lo snapshot viene scollegato come falso positivo.
        rt.engine.ingest().map_err(es)?;
        *self.runtime.lock().expect("rt poisoned") = Some(rt);
        if self.reset_if_current_device_retired()? {
            return Ok(());
        }
        if self.whoami().is_none() {
            if stato_cartella_dati(Some(&data_dir)) == "ok" {
                self.disconnetti_configurazione_locale()?;
            }
            return Ok(());
        }
        self.seed_builtin_conti();
        self.seed_builtin_corrieri();
        self.seed_prodotti_produzione();
        self.seed_anagrafiche_default();
        Ok(())
    }

    /// Forza un giro di sincronizzazione (rilettura dei log). Restituisce gli
    /// eventi nuovi applicati.
    pub fn force_sync(&self) -> AppResult<usize> {
        self.force_sync_entities().map(|entities| entities.len())
    }

    /// Come `force_sync`, ma conserva l'elenco delle entità modificate per permettere
    /// al frontend di invalidare solo le viste interessate.
    pub fn force_sync_entities(&self) -> AppResult<Vec<String>> {
        let result = {
            let guard = self.runtime.lock().expect("rt poisoned");
            match guard.as_ref() {
                Some(rt) => rt.engine.ingest(),
                None => return Ok(Vec::new()),
            }
        };

        match result {
            Ok(entities) => Ok(entities),
            Err(SyncError::GapDetected {
                device,
                first_avail,
                ..
            }) => {
                let coperto_da_snapshot = {
                    let guard = self.runtime.lock().expect("rt poisoned");
                    guard
                        .as_ref()
                        .map(|rt| rt.engine.snapshot_covers_gap(&device, &first_avail))
                        .unwrap_or(false)
                };
                if coperto_da_snapshot {
                    self.ricostruisci_proiezione_locale()?;
                    Ok(vec!["snapshot".to_string()])
                } else {
                    Err(format!(
                        "Gap rilevato per {device}: attendo che OneDrive scarichi uno snapshot più recente."
                    ))
                }
            }
            Err(err) => Err(es(err)),
        }
    }

    /// Controllo incrementale sicuro per la UI. A differenza di `force_sync_entities`,
    /// un gap coperto da snapshot non provoca qui una ricostruzione silenziosa: viene
    /// segnalato al frontend, che applica il percorso bloccante e coordinato esistente.
    pub fn poll_sync_entities(&self) -> AppResult<SyncPollOutcome> {
        let result = {
            let guard = self.runtime.lock().expect("rt poisoned");
            match guard.as_ref() {
                Some(rt) => {
                    // L'ordine è intenzionale: durante un restore coordinato la
                    // cartella eventi può sembrare vuota finché arriva il payload.
                    if rt.engine.restore_remoto_pronto_da_riallineare() {
                        return Ok(SyncPollOutcome::Rebuild("restore"));
                    }
                    if rt.engine.restore_remoto_in_attesa() {
                        return Ok(SyncPollOutcome::Waiting);
                    }
                    if rt.engine.shared_events_missing_or_empty() {
                        return Ok(SyncPollOutcome::Rebuild("reset"));
                    }
                    rt.engine.ingest()
                }
                None => return Ok(SyncPollOutcome::Changed(Vec::new())),
            }
        };

        match result {
            Ok(entities) => {
                let device_corrente_ritirato = if entities.iter().any(|e| e == "device_retired") {
                    let guard = self.runtime.lock().expect("rt poisoned");
                    guard
                        .as_ref()
                        .map(|rt| rt.engine.configured_device_is_retired())
                        .unwrap_or(false)
                } else {
                    false
                };
                let utente_corrente_rimosso = if entities.iter().any(|e| e == "user") {
                    let guard = self.runtime.lock().expect("rt poisoned");
                    guard
                        .as_ref()
                        .map(|rt| !rt.engine.configured_user_is_active())
                        .unwrap_or(false)
                } else {
                    false
                };
                if device_corrente_ritirato {
                    Ok(SyncPollOutcome::Rebuild("device"))
                } else if utente_corrente_rimosso {
                    Ok(SyncPollOutcome::Rebuild("identity"))
                } else {
                    Ok(SyncPollOutcome::Changed(entities))
                }
            }
            Err(SyncError::GapDetected {
                device,
                first_avail,
                ..
            }) => {
                let coperto_da_snapshot = {
                    let guard = self.runtime.lock().expect("rt poisoned");
                    guard
                        .as_ref()
                        .map(|rt| rt.engine.snapshot_covers_gap(&device, &first_avail))
                        .unwrap_or(false)
                };
                if coperto_da_snapshot {
                    Ok(SyncPollOutcome::Rebuild("snapshot"))
                } else {
                    // OneDrive può consegnare prima il log compattato e subito dopo lo
                    // snapshot: non mostrare errori transitori né modificare la proiezione.
                    Ok(SyncPollOutcome::Waiting)
                }
            }
            Err(err) => Err(es(err)),
        }
    }
}

fn statistiche_log(data_dir: &Path, device_id: &str) -> AppResult<(usize, u64, usize)> {
    let store = LogStore::new(data_dir.join("events"), device_id).map_err(es)?;
    let files = store.ndjson_files().map_err(es)?;
    let mut eventi = 0usize;
    let mut bytes = 0u64;
    for path in &files {
        let metadata = fs::metadata(path).map_err(es)?;
        let read = LogStore::read_from(path, 0).map_err(es)?;
        if let Some(corruption) = read.corruption {
            return Err(format!(
                "Il log {} è corrotto al byte {}: {}. L'ottimizzazione è stata annullata.",
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("sconosciuto"),
                corruption.offset,
                corruption.reason
            ));
        }
        if read.consumed != metadata.len() {
            return Err(format!(
                "Il log {} contiene una scrittura incompleta. Attendi la sincronizzazione e riprova.",
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("sconosciuto")
            ));
        }
        eventi = eventi.saturating_add(read.events.len());
        bytes = bytes.saturating_add(metadata.len());
    }
    Ok((eventi, bytes, files.len()))
}

/// Rimuove esclusivamente file con l'estensione richiesta, senza attraversare
/// sottocartelle. Gli errori sono best-effort: una copia riconsegnata da OneDrive
/// resta innocua grazie alla barriera generazionale.
fn rimuovi_file_con_estensione(
    dir: &Path,
    estensione: &str,
    conserva: Option<&Path>,
) -> (usize, u64) {
    let Ok(entries) = fs::read_dir(dir) else {
        return (0, 0);
    };
    let mut rimossi = 0usize;
    let mut bytes = 0u64;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file()
            || conserva.is_some_and(|keep| keep == path)
            || !path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case(estensione))
        {
            continue;
        }
        let len = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        let mut eliminato = false;
        for tentativo in 0..5 {
            match fs::remove_file(&path) {
                Ok(()) => {
                    eliminato = true;
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    eliminato = true;
                    break;
                }
                Err(_) if tentativo < 4 => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
        if eliminato {
            rimossi += 1;
            bytes = bytes.saturating_add(len);
        }
    }
    (rimossi, bytes)
}

/// Le sottocartelle del dataset non sono dataset autonomi. Aprirne una come
/// radice produrrebbe strutture annidate (`snapshots/events`, ecc.) e potrebbe
/// far apparire un archivio vuoto o un falso ripristino in corso.
fn valida_radice_dati(data_dir: &str) -> AppResult<()> {
    let nome = Path::new(data_dir)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if ["events", "snapshots", "meta", "backups"]
        .iter()
        .any(|riservato| nome.eq_ignore_ascii_case(riservato))
    {
        return Err(format!(
            "«{nome}» è una sottocartella tecnica di PharmaTek. Seleziona la cartella dati che la contiene."
        ));
    }
    Ok(())
}
