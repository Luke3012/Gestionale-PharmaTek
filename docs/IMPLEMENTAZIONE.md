# Implementazione â€” stato di ciÃ² che Ã¨ stato costruito

Documento **canonico** di cosa Ã¨ realizzato nel codice e come, con gli **scostamenti**
rispetto alle specifiche (`ARCHITETTURA.md`,
`MODELLO-DATI.md`, `UI-SPEC.md`). Va aggiornato man mano. Le feature rinviate stanno in
[`FEATURE-FUTURE.md`](FEATURE-FUTURE.md).

> Stato corrente: le fasi operative descritte in questo documento sono implementate, inclusi
> contabilità completa, spedizioni, produzione/Laboratorio, dashboard, finestre secondarie,
> integrazione desktop e rifiniture UI. I riferimenti ai singoli commit nelle sezioni storiche
> descrivono la progressione dello sviluppo, non lo stato del worktree corrente.
>
> Dopo il refactor strutturale, il backend applicativo è suddiviso per dominio sotto `app/` e il
> frontend condivide le astrazioni di finestre, popover, colonne compatte e virtualizzazione.
> Verifica corrente: **287 test Rust automatici** (più 7 collaudi reali ignorati per
> impostazione), **290 test frontend**, build TypeScript/Vite, `rustfmt` e
> `clippy --all-targets -D warnings` completati con successo. Restano da verificare manualmente su
> Windows i comportamenti nativi che non sono osservabili dai test headless, in particolare tray,
> timing visivo delle finestre e interazioni multi-finestra.

## Mappa fette â†” task del piano

Le "fette" usate durante lo sviluppo coprono i task storici lettera Aâ€“G:

| Fetta | Task piano | Contenuto |
|---|---|---|
| 1A | A + B | Motore sync + proiezione (core Rust) |
| 1B | C + G | Onboarding + shell/estetica/motion |
| 1C | D | Anagrafiche |
| 1D | E | Listino / motore prezzi |
| 1E | F | Giornaliero |
| 1F | F (rifiniture) | Finestra ordine, nuovo cliente al volo, ecc. |
| 1G | G (completamento) | Ctrl+K, panoramica sync, (todo: backup, cestino) |

---

## Backend (Rust, `src-tauri/src`)

### `sync/` â€” motore local-first
- **`hlc.rs`**: Hybrid Logical Clock `(wall_ms, counter, device)`. Serializzato come stringa
  `"{wall:016x}-{counter:08x}-{device}"` **lessicograficamente ordinabile** (confrontabile in
  SQL come TEXT). `HlcClock::tick/observe/bump_to`.
- **`event.rs`**: `Event { id(ULID), ts(Hlc), device, user, entity, entityId, op }` in **NDJSON**
  (una riga per evento). `op` âˆˆ `created | field_set{field,value} | deleted | restored`.
  Valori monetari in **centesimi interi**.
- **`log.rs`**: `LogStore`. Ogni device scrive **solo** `events/<deviceId>.ndjson` (append
  atomico + flush + fsync). Lettura **incrementale per offset**, **recovery** della riga troncata,
  assorbimento di qualunque `*.ndjson` (incluse "conflicted copy").
- **`snapshot.rs`**: dump/restore JSON dello stato in `snapshots/<device>-<seq>.json` (atomico,
  per-dispositivo). Lo snapshot include i **segnalibri di lettura** (offset per log), watermark
  HLC per device e tombstone minime dei purged → il bootstrap ripiega **solo la coda** dei log,
  non tutta la storia. **Generato a ogni backup**; retention `prune` (ultimo 1 per dispositivo).
  `SnapshotStore::latest()` raggruppa preliminarmente per dispositivo e carica solo lo snapshot
  con sequenza massima per device prima della fusione. Dettagli in **`COMPATTAZIONE.md`**.
- **`mod.rs`**: `Engine`. `emit` (durevole + applica subito), `ingest` (piega i nuovi eventi da
  tutti i file a chunk da 1.000 via `apply_batch` e notifica il progresso con `progress_reporter`),
  `watch` (file-watch `notify` con **`Weak<Engine>`**), `snapshot`, `wipe_projection`,
  `set_user`, `shutdown`.

### `projection/mod.rs` — read model SQLite (in `%APPDATA%`, fuori da OneDrive)
- **Schema GENERICO per entità** (non tabelle tipizzate): `records(entity,id,data JSON,deleted,
  created_hlc,updated_hlc)`, `field_clocks(entity,id,field,hlc)`, `applied_events`, `watermarks`,
  `purged`, `log_offsets`.
- **Fold** con **merge per-campo Last-Write-Wins** sull'HLC (confronto fra stringhe). Soft-delete/
  restore via clock `@del`. `created_hlc` = **minimo** HLC fra gli eventi del record (deterministico
  per la numerazione ordini). **Idempotenza** per `event.id` recente e no-op tramite clock/tombstone
  quando la cache `applied_events` viene potata.
- **Rendimento elevato**: `PRAGMA synchronous = NORMAL;` (sicuro in WAL mode, zero blocchi disco I/O),
  `apply_batch(&mut self, events: &[Event])` con raggruppamento in singola transazione e riutilizzo
  degli statement SQL compilati (`prepare_cached`).
- `PRAGMA busy_timeout=5000`. `wipe()` (svuota tutto, per il reset). `device_activity()` (ultima
  attività per device, derivata da `watermarks`).

### `pricing/mod.rs` â€” motore prezzi
- `risolvi(Contesto, &[RegolaPrezzo]) -> Risolto` con gerarchia **"piÃ¹ specifica vince"**:
  `medico+prodotto â†’ agente+prodotto â†’ categoria â†’ prodotto.default`. `Fonte` con `.codice()`.
- 7 test unitari. **Nota**: il livello *categoria* esiste nel resolver ma la UI **non** crea piÃ¹
  regole di categoria (ridondante col prezzo base).

### `backup.rs` â€” backup/ripristino
- `esegui(data_dir, dest_dir, device, retention, tag)`: **zip** di `events/snapshots/meta`; default
  **dentro la cartella dati** (OneDrive â†’ off-site), nome `pharmatek-backup-<device>-<ts>.zip`
  oppure `pharmatek-backup-<device>-pre-import-<ts>.zip`. Il
  **deviceId nel nome** evita le "conflicted copy" (ogni PC scrive file distinti); retention
  **per-dispositivo**. Lo zip include uno snapshot compatto per PC ed esclude `meta/locks/`,
  `meta/restore_coordination/` e i marker restore runtime.
  UI: "Backup ora" (OneDrive) + "Salva copia…" (cartella a scelta).
  `lista`, `ripristina` (protezione zip-slip via `enclosed_name`, pulizia lock runtime),
  `snapshot_choices` per il ripristino manuale.
- Comandi `backup_now`/`lista_backup`/`backup_snapshot_choices`/`ripristina_backup` +
  `restore_prepare`/`restore_coordination_status`/`restore_cancel`. Il ripristino acquisisce il
  lock, può aprire una fase `prepare` con ack transitori degli altri PC, chiude il motore,
  sostituisce le cartelle, apre la generazione ripristinata e ne salva uno snapshot-anchor non soggetto
  alla retention ordinaria. `committed-<restoreId>.json` v2 registra l'anchor con verifica esatta e i
  log append-only con verifica del prefisso; lunghezza e checksum del prefisso sono letti dallo stesso
  stream per non creare coppie incoerenti durante un append. Il marker con lo stesso `restoreId` viene
  scritto per ultimo. Gli altri PC espongono `restoreStatus = waiting | ready | none`: durante `waiting`
  la UI resta bloccata e bootstrap non può scollegare utente/device o eseguire seed su dati parziali;
  in `ready` ricostruisce esclusivamente dall'anchor certificato e dai log, ignorando snapshot ordinari
  obsoleti eventualmente riconsegnati. I log non elencati con eventi anteriori al commit mantengono
  `waiting`, mentre file vuoti o code nate dopo il commit sono ammessi. Durante `waiting`/`ready` anche
  `Engine::ingest` resta congelato; l'unica eccezione è il motore del rebuild aperto con l'anchor già
  verificato. Solo dopo il rebuild persiste
  localmente il `restoreId` e l'anchor fidato, riutilizzato anche se SQLite viene perso in seguito. Un fallimento resta
  quindi ritentabile nello stesso processo. I manifest v1 sono compatibili tramite checksum del prefisso
  dei log canonici, senza dipendere da snapshot/meta live già sostituiti; dopo il mark locale il rebuild
  ripiega comunque la coda completa prima di verificare sessione e device. Il ripristino manuale passa lo snapshot scelto e ne
  azzera gli offset prima del rebuild. Gli ack sono best-effort: non hanno significato senza il prepare, vengono
  puliti se orfani e non finiscono mai nei backup. I marker legacy di ritiro/reset/compattazione già
  incorporati dal bootstrap avanzano comunque la frontiera temporale e sopprimono restore più vecchi,
  anche quando il reset locale ha eliminato il file `restore-handled-<device>.json`.
- **`backup_now`** (vedi `COMPATTAZIONE.md`): 1) snapshot aggiornato â†’ 2) backup dei dati
  completi â†’ 3) potatura della sola cache locale `applied_events`. I log condivisi non vengono
  troncati: restano append-only, così un PC offline non dipende da uno snapshot particolare.
- **Backup automatico**: `OverlayWindow` controlla dopo l'avvio e poi ogni ora; se l'ultimo backup Ã¨ piÃ¹ vecchio della soglia (pref
  `backupAuto`: Mai/Giornaliero/Settimanale/14 giorni/30 giorni, default settimanale, in Impostazioniâ†’Backup), esegue
  un backup in background (quindi anche snapshot aggiornato) e differisce il toast alla riapertura della finestra principale. Manuale: "Backup ora" / "Salva
  copia inâ€¦" (file-picker nativo).

### Cestino + storico
- **Cestino**: comando `cestino` (record soft-deleted di tutte le entitÃ  utente), `record_restore`,
  `record_purge` (eliminazione **definitiva** via evento `Purged` â€” terminale, una `purged` table
  nella proiezione mantiene solo la tombstone minima e rimuove `records`/`field_clocks`, anche dopo un eventuale Restored), `cestino_svuota`,
  `cestino_pulisci(giorni)` (auto-eliminazione oltre N giorni). UI: **icona Cestino in topbar** con
  **badge di conteggio** + popover (`CestinoPopover`); soglia auto-pulizia in Impostazioniâ†’Aspetto
  (default **90 giorni**, eseguita all'avvio).
- **Pulizia dati profonda**: `pulizia_dati_esegui` include anche gli stati `notifica_letta`
  orfani, crea il backup obbligatorio, purga i record e salva uno snapshot che conserva le
  tombstone terminali. Non riscrive i log condivisi; la UI forza subito il ricalcolo della campanella.
- **Storico/undo**: `Engine::storia(entity,id)` rilegge i log e raccoglie gli eventi del record;
  comando `record_storico`; `StoricoModal` (in `ui/`) mostra chi/cosa/quando e permette di
  **annullare una singola modifica** (re-emette il valore precedente). Agganciato al menu â‹¯ delle
  anagrafiche.

### `app/` â€” stato e logica applicativa modulare

`app/mod.rs` conserva `AppState`, il runtime condiviso e gli helper trasversali; non contiene più
da solo tutta la logica applicativa. Le responsabilità principali sono distribuite così:

- `lifecycle.rs`: bootstrap, onboarding, backup, restore, sincronizzazione forzata e gestione del runtime;
- `reports.rs`: Giornaliero, dashboard e report provvigioni;
- `accounting.rs`: pagamenti, rate, distinte, provvigioni liquidate e rimborsi;
- `production.rs`: avanzamento produzione, lotti e date previste;
- `shipping.rs`: creazione, modifica, unione, separazione e annullamento spedizioni;
- `cleanup.rs`: Cestino, purge, pulizia dati e storico;
- `seeds.rs`: cataloghi e record predefiniti;
- `restore_coordination.rs`: coordinamento del ripristino tra postazioni;
- `dto.rs`: strutture scambiate con il frontend;
- `tests.rs`: test applicativi e di convergenza del dominio.

I comandi pubblici restano esposti da `AppState`: la suddivisione cambia soltanto l'organizzazione
interna e non il contratto Tauri.
- `AppState { app_dir, config(Mutex), runtime(Mutex<Option<Runtime>>), reconnect_required(Mutex) }`.
  `Runtime { _watcher,
  engine }` (**ordine dei campi = ordine di drop**: prima il watcher, poi la connessione).
- **Config locale** `config.json` in app_data_dir: `device_id`, `data_dir`, `user_id`. Proiezione
  in `<app_dir>/projection.sqlite`.
- Onboarding: `bootstrap`, `open_data_dir` (apre engine, completa un restore `ready` prima della
  lista utenti e rifiuta senza salvare la cartella se il payload è ancora `waiting`), `finish_onboarding`
  (crea/usa/riconfigura utente + registra device come **eventi**, imposta autore via `set_user`).
- CRUD generico: `records_list/record_get/record_create/record_update/record_delete/record_restore`.
- Dominio: `ordini_lista` (numero ANNO-progressivo derivato, totale, residuo, nomi),
  `anni_ordini`, `prezzo_suggerito`.
- Sync: `force_sync`, `sync_overview`, `apri_cartella_dati`.
- Reset: `reset_leggero` (riconfigura questo PC eliminando l'intera `app_data_dir`; rimuove
  `user`, stati utente e avatar solo se nessun altro device attivo usa il profilo, svuota sempre
  `device.user_id` per nascondere il PC fino al nuovo onboarding; `sync_overview_ritiro` continua
  a esporlo alla sola lista amministrativa; dati di lavoro intatti) e
  `ottimizza_database` (attende normalmente tutti gli ack del prepare ma accetta una forzatura
  esplicita, verifica i log, crea backup + `generation-anchor`, pubblica cutoff in
  `meta/generation.json`, rimuove log/snapshot sostituiti e tutte le tombstone terminali, pubblica
  marker/manifest per riallineare i PC offline, riapre dall'anchor ed esegue `VACUUM`) e
  `reset_completo` (cancella i dati applicativi, riparte con nuovo device e crea un log/snapshot
  minimo `device_retired` come barriera contro vecchi log risincronizzati);
  `cancella_cartella_locale` esegue shutdown/wipe e rimuove config, SQLite e cache locali.
- Bootstrap: una cartella non leggibile conserva la configurazione e produce
  `data_dir_status=missing_or_empty`; un'identità assente in dati leggibili o un device ritirato
  produce `reconnect_required` e pulizia AppData. Il reset volontario lascia invece
  `reconnect_required=false` per entrare direttamente nell'onboarding.

### `commands/mod.rs` + `lib.rs`
Wrapper `#[tauri::command]` per tutto quanto sopra. Plugin: `updater`, `process`, `dialog`.
Capabilities (`capabilities/default.json`): `core:default`, updater, process,
`dialog:allow-open`, e per le finestre ordine (`windows: ["main","ordine-*"]`)
`core:webview:allow-create-webview-window`, `core:window:allow-close`,
`core:event:allow-listen|emit|unlisten`.

### Robustezza concorrenza (scoperta dai test del reset)
1. watcher con **`Weak<Engine>`** (non tiene vivo il motore); 2. `Runtime` con `_watcher` prima
di `engine`; 3. `Engine.closed: AtomicBool` + `shutdown()` â†’ `ingest` no-op durante il reset;
4. il check di `closed` Ã¨ **dentro il lock** della proiezione (prima di `apply` e di `set_offset`);
5. `busy_timeout`; 6. lo svuotamento avviene via connessione viva (`wipe`), non cancellando il file.
Altro fix: `set_user` a caldo invece di riaprire il motore (evita "database is locked").

---

## Modello dati realizzato (entitÃ  nello store generico)

Gli ID sono ULID; importi in centesimi. Campi salvati come JSON nel record.

- **user**: `nome, avatar_tipo, avatar_valore, creato_ts`. (Avatar foto in `meta/avatars/<id>.png`.)
- **device**: `nome(hostname), user_id, registrato_ts`.
- **agente**: `nome, provv_tipo(percentuale|fisso), provv_valore`.
- **medico**: `nome, agente_id, acconto_default(cent, default 90â‚¬/prodotto),
  rate_saldo_default?(intero 1..60, default effettivo 1; solo Immunoterapia)`.
- **cliente**: `nome, indirizzo, citta, prov, cap, regione, telefono, email, cf, ultimo_medico_id`.
- **prodotto**: `nome, categoria(Immunoterapia|Diagnostica|Keriba), prezzo_base_default(cent),
  codice_laboratorio?(Diagnostica), builtin`. Immuno seminati = **tipo preparazione Ã— fiale**
  (Sublinguale/Polimerizzato/Lisato batterico, prezzi reali dai file Laboratorio); Diagnostica = listino
  Laboratorio (162 voci con codice). Gli allergeni NON sono prodotti (contenuto, in produzione).
- **conto**: `nome, banca, iban`. **corriere**: `nome`.
- **regola_prezzo**: `prodotto_id?, categoria?, agente_id?, medico_id?, prezzo(cent)`.
- **agente** (esteso FASE 2/4D): `provv_maturazione(spedizione|chiuso)`, provvigioni per linea
  `provv_cat_*` (campo tipo `sezione`).
- **medico** (esteso FASE 4D): indirizzo di spedizione + preferenze conto/acconto (Immunoterapia).
- **corriere** (esteso FASE 4): CORRIERE_B/CORRIERE_A **built-in** (non eliminabili), profilo/conto di saldo.
- **ordine** (testata): `data(YYYY-MM-DD), medico_id, agente_id, cliente_id, stato, note, acconto(cent),
  motivo_rifiuto, provvisorio(bool), creato_da_device, fatt_*(dati fatturazione opzionali),
  categoria/linea, omaggio(bool), marcatore(urgente|anomalia|sollecito)`. Campi produzione (FASE 5):
  `acconto_incassato, data_acconto, data_produzione, data_arrivo_it, lotto_produzione(+_pre),
  data_prevista_lotto` (fallback storico per la data prevista di consegna Laboratorio).
  Numero `ANNO-progressivo` **derivato** (non salvato). Totale/residuo/incassato derivati.
- **riga_ordine**: `ordine_id, prodotto_id, prodotto_nome(libero), qta, prezzo(cent), paziente,
  stato_riga(da_spedire|spedita)`. Dati produzione immuno (FASE 5): `formulazione, posologia,
  allergeni[], numero_produzione`(col D Laboratorio, assegnato/persistito all'export), `data_prevista`
  (data di consegna prevista puntuale per riga/prodotto, impostata da Produzione > In lavorazione).
  Dati Diagnostica (FASE 5D): `tipo_test, ml, codice_laboratorio`.
- **pagamento** (FASE 3): `ordine_id, tipo(atteso|incasso), importo(cent), conto_id, data,
  verificato, scadenza(per le rate), note`.
- **distinta** (FASE 3C): `corriere_id, data, importo(cent), note`; lega gli incassi contrassegno.
- **rimborso** (FASE 3D): `importo(cent), ragione_sociale, motivo, conto/iban, date, stato
  (richiesto|effettuato), origine(manuale|eccesso)`.
- **spedizione** (FASE 4): righe spedite, corriere, colli, peso, nÂ° spedizione, preavviso,
  eventuali override destinatario `dest_*`; lotti via flag `unito` + `lotto_unisci`/`lotto_separa`;
  collo manuale (`spedizione_collo_manuale`). I numeri/lotti vaccino sono su `riga_ordine.numero`,
  non sul record spedizione, salvo colli manuali senza righe.
- **prodotto_produzione** (FASE 5): `tipo(formulazione|posologia|allergene|ceppo|ml), valore`;
  catalogo builtin seminato (`ensure_prodotti_produzione`) â€” Ã¨ la fonte dei **suggerimenti**
  allergeni/ceppi/formulazione in produzione (separato dal catalogo commerciale `prodotto`).

Stati ordine (con icona/colore): Nuovo Â· Confermato Â· In produzione Â· Arrivato IT Â· Spedito Â·
Chiuso Â· Rifiutato. (Rimossi "Parz. spedito" e "Saldato".)

---

## Frontend (`src/`)

Stack: **React 19 + TypeScript 7**, **Mantine v9** (PostCSS preset), **Framer Motion 12**,
**react-router 7** (`MemoryRouter`), **Tabler Icons**. Build Vite 8 con **code-splitting**
(chunk App / finestre secondarie e aree funzionali).

- **`main.tsx`**: provider (Mantine, Prefs, MotionConfig). Rileva `?ordine=` â†’ rende `OrdineWindow`
  (finestra separata; supporta `focus=pagamenti` per evidenziare il box Pagamento da solleciti)
  altrimenti `App`. `App` e `OrdineWindow` sono `lazy`.
- **`lib/tauri.ts`**: `api` tipizzato (tutti i comandi) + `inTauri`. **`lib/prefs.tsx`**: sidebar,
  riduci-animazioni, densitÃ , `ordineFinestra` (mai|modifica|sempre), `anno` e le altre preferenze
  persistite. Ogni modifica viene propagata alle webview aperte tramite
  `pt:preferenze-cambiate`, con evento `storage` come fallback browser; non richiede reload.
- **`ui/`**: servizio **`dialog`** (modali promise multi-bottone; tiene il contenuto durante l'exit)
  e **`toast`** (mazzo: una card visibile, coda dietro con `+N`, countdown CSS + pausa hover);
  `motion.ts`; `Avatar`/`avatars`; `Brand`;
  `gag.ts` (`gagNonDisponibile()` â†’ modale "ðŸ¤‘ðŸ«°ðŸ’°" per le feature future).
- **`onboarding/Onboarding.tsx`**: 4 passi (Cartella â†’ Utente con check duplicati â†’ Avatar
  preset/foto-crop â†’ Riepilogo). **Cartella per prima** (serve ad aprire il registro per i duplicati).
- **`shell/`**: `Shell` (MemoryRouter + layout), `Sidebar` (3 stati + selettore **Anno** in fondo â†’
  `AnnoModal`), `Topbar` (â˜° etichette, ricerca, **pill sync** â†’ panoramica, campanella, utente),
  `ComandiPalette` (**Ctrl+K**: cerca ordini/anagrafiche + comandi).
- **`features/anagrafiche/`**: `RegistroView` (CRUD generico data-driven da `registri.ts`,
  `CampoForm` esportato e **riusato** dal nuovo-cliente rapido), `AnagraficheHub` (switcher + Listino),
  `ListinoView` (regole agente/medico+prodotto + "prova prezzo").
- **`features/giornaliero/`**: `GiornalieroView` (lista, filtri stato/anno/ricerca, badge con icona,
  menu â‹¯ con gag "Solleciti"), `OrdineEditor` (wrapper modale animato) + `OrdineForm`
  (form a colonna unica: Data/Stato Â· Cliente Â· Medicoâ†’agente Â· Prodotti Â· Pagamento Â· fatturazione),
  `OrdineWindow`/`apriFinestra` (finestra Tauri separata + fallback modale; **ricorda
  dimensione+posizione** via il modulo generico `lib/geometriaFinestre`), `stati.ts`.
  - **Chiusura app**: il `Root` della main intercetta una sola volta `onCloseRequested` per tutto il
    ciclo di vita (bootstrap, onboarding, schermate bloccanti e `Shell`). Senza tray, se ci sono
    pannelli utente visibili chiede conferma ("Chiudi tutto ed esci"); con tray nasconde la main.
- **`pages/`**: `Impostazioni` (Profilo, Aspetto incl. finestra ordine, Sincronizzazione,
  Aggiornamenti) con reset nascosto a quattro opzioni (riconfigura questo PC, ritira un PC da lista
  scrollabile, ottimizza database con checkpoint generazionale, reset completo); segnaposto Dashboard/ContabilitÃ /Evasione.

---

## FASE 2 â€” Provvigioni agenti (completa, non committata)

Calcolo e rendicontazione provvigioni a partire dagli ordini del Giornaliero.

**Backend** (`app/reports.rs`, helper condivisi in `app/mod.rs`, `export.rs`):
- **Maturazione per-agente** (scelta utente, non impostazione globale): campo
  `provv_maturazione` su `agente` = `spedizione` (default) | `chiuso`. La pipeline degli
  stati Ã¨ ordinata, quindi "matura alla spedizione" = stato âˆˆ {Spedito, Chiuso}; "a chiuso"
  = solo Chiuso. Quando ci sarÃ  la contabilitÃ  (FASE 3) si potrÃ  agganciare al saldo vero.
- **Calcolo**: `calcola_provvigione(base, tipo, valore)` â†’ fisso (`valore`â‚¬ â†’ centesimi) o
  percentuale (`base Ã— valore/100`). Base = **totale ordine** (Î£ righe).
- **Esclusioni**: ordini **Rifiutati** e con flag **`omaggio`** (nuovo campo bool su `ordine`).
- **`provvigioni_report(dal?, al?, agente_id?)`** â†’ `ProvvigioniReportDto`: per agente, lista
  ordini con base/provvigione/maturato, `totale_maturato` (ciÃ² che si paga) e
  `totale_potenziale`. Filtri periodo (date `YYYY-MM-DD` inclusive, confronto lessicografico)
  e agente. **Numerazione e totali rifattorizzati** in helper riusati anche da `ordini_lista`
  (`numeri_ordini`, `totali_ordini`, `config_agenti`).
- **`provvigioni_export(path, â€¦)`** â†’ `.xlsx` nativo via **`rust_xlsxwriter`** (`export.rs`):
  una riga per ordine, raggruppata per agente con subtotale maturato + totale generale;
  importi come numeri (Excel li somma) con formato `#,##0.00`.
- Comandi `provvigioni_report`/`provvigioni_export`; capability `dialog:allow-save` (save-dialog).
- Test `provvigioni_calcolo_maturazione_e_filtri` (calcolo, maturazione per-agente,
  esclusioni, filtri, roundtrip export). **45 test verdi.**

**Frontend** (`features/contabilita/`):
- **`ContabilitaHub`**: hub a tab (UI-SPEC Â§7.6) **Pagamenti Â· Provvigioni Â· Rimborsi**; solo
  **Provvigioni attiva**, gli altri due segnaposto "FASE 3". Rotta `/contabilita` aggiornata.
- **`ProvvigioniView`**: filtri agente + periodo (input `date` nativi), card totale generale
  (maturato vs potenziale), una card per agente (badge tipo+maturazione) con tabella ordini e
  badge "maturato/in attesa"; **Esporta Excel** (save-dialog â†’ `provvigioni_export`).
- **`agente`**: campo `provv_maturazione` (segmented, default prima opzione = spedizione).
- **Omaggio**: checkbox "Omaggio / sostituzione" in `OrdineForm`; badge `omaggio` (viola) nel
  Giornaliero.
- **Sostituzione prodotto** (`SostituzioneModal`): voce nel menu â‹¯ dell'ordine â†’ crea con
  pochi click un **nuovo ordine omaggio** per lo stesso cliente (copia medico/agente/cliente),
  con i prodotti scelti gratuiti (prezzo 0, stato Nuovo, nota "Sostituzione ordine N").
- **Colonne Giornaliero configurabili** (`colonne.tsx` + `ColonneMenu.tsx`): popover "Colonne"
  con **riordino drag** (framer-motion `Reorder` + maniglia `useDragControls`) e **switch
  mostra/nascondi**; preferenza persistita in `localStorage` (`pt.giornaliero.colonne.v1`,
  merge con eventuali colonne nuove) + "Ripristina predefinite". Colonne disponibili: Data,
  Medico, **Agente** (extra), Cliente, CittÃ , Importo, **Acconto** (extra), Residuo, Stato,
  **Note** (extra); NÂ° e azioni â‹¯ restano fissi ai bordi. Le 3 extra nascoste di default.

## FASE 3A â€” Pagamenti, stati pagamento, verifica (completa, non committata)

Primo taglio della contabilitÃ : libro mastro incassi + stati pagamento + conti speciali.

**Decisioni (giugno 2026)** â€” coerenti con `MODELLO-DATI.md`:
- **Registro Pagamenti unico tipizzato** (`acconto | saldo | rata`): il tipo conta piÃ¹ della
  posizione (un pagamento alla consegna Ã¨ un `saldo`, non un acconto).
- **Acconto = campo "previsto" sull'ordine** (piano, auto dal medico, 0 ammesso), **non** un
  incasso. `incassato = Î£ pagamenti`, `residuo = totale âˆ’ incassato`.
- **Stato pagamento derivato + override** (col flag `verificato` che distingue
  `saldato_da_verificare` da `saldato`).
- **Contrassegno e Assegno = conti speciali built-in non eliminabili** (id fissi
  `__contrassegno__`/`__assegno__`): conti di transito â†’ `in_attesa_accredito` finchÃ© una distinta
  corriere (3C) non li accredita.
- **Conto predefinito** = flag universale sul record `conto` (rotella âš™ï¸� "Preferenze conti").
- **Automazione**: un pagamento su ordine *Nuovo* lo porta a *Confermato*. (Il *Chiuso*
  spedito+saldato+20gg arriva in 3E/FASE 4.)

**Backend** (`app/accounting.rs`, `commands/mod.rs`, `lib.rs`):
- EntitÃ  **`pagamento`**: `ordine_id, tipo, importo(cent), conto_id, data, verificato(bool),
  distinta_id?, note?`. Aggiunta a `ENTITA_UTENTE` (Cestino/storico). *(FASE 3B aggiunge `saldato` +
  `scadenza` e rimuove `rata_id`: vedi sotto.)*
- `conto` arricchito: `tipo (banca|contrassegno|assegno), builtin, predefinito_incassi,
  predefinito_accrediti`. `ensure_builtin_conti` semina i due speciali (idempotente, id fissi)
  in `init`/`finish_onboarding`/`ripristina_backup`.
- `OrdineDto` ora espone `incassato`, `stato_pagamento` (effettivo) e `residuo = totale âˆ’
  incassato` (rimosso `saldo`); `acconto` = previsto. Helper `conti_transito`/`conti_info`/
  `pagamenti_per_ordine`/`stato_pagamento_effettivo`/`pagamento_dto`.
- Comandi: `pagamenti_ordine`, `pagamenti_lista(dal,al,conto,non_verificati)`,
  `pagamento_registra(...)` (crea + auto-conferma l'ordine), `conto_predefinito_set(conto,ruolo)`.
  Verifica/modifica/elimina pagamento riusano il CRUD generico su entitÃ  `pagamento`.
- Test `pagamenti_stato_verifica_e_automazione` (derivazione stati, contrassegnoâ†’in_attesa,
  override, automazione conferma, predefinito, vista aggregata) + `giornaliero_numerazione_e_totali`
  aggiornato (residuo da incassato). **55 test verdi.**

**Frontend** (`features/contabilita/`, `features/giornaliero/`, `features/anagrafiche/`):
- `statiPagamento.ts` (6 stati con colore/icona della Legenda + tipi pagamento).
- `SaldaModal.tsx`: modale "Salda" rapido (tipo/importo precompilati, conto predefinito, data
  oggi, verificato). Richiamato dal menu riga Giornaliero e dall'editor ordine.
- `PagamentiView.tsx`: tab **ContabilitÃ  â†’ Pagamenti** (filtri conto/periodo/da-verificare, spunta
  verifica ottimistica, totale incassato). `ContabilitaHub` attiva il tab (Rimborsi resta 3D).
- **Editor ordine**: "Acconto previsto" + sezione Pagamenti (Incassato/Residuo reali, lista
  movimenti, "Registra pagamento"; dopo un incasso ricarica stato/pagamenti).
- **Giornaliero**: colonne `Incassato` (nascosta) e `Pagamento` (stato, visibile); voce menu
  "Registra pagamento".
- **Anagrafica Conti**: `PreferenzeContiModal` (âš™ï¸�) per i conti predefiniti; i conti `builtin`
  non sono eliminabili (`RegistroView` ora accetta `nonEliminabile`/`azioneExtra`).

**Rifiniture round 3 (feedback utente)**:
- **Handle resize** non piÃ¹ sempre visibile (tolto l'override `opacity`): resta nascosto e appare su
  hover (regola della libreria), con area di 14px per afferrarlo.
- **NÂ° Ã¨ una colonna configurabile** (in `COLONNE`, render ricco con badge dal Giornaliero) â†’
  nascondibile/riordinabile; storage colonne â†’ `v2`.
- **Anagrafiche**: cache record per entitÃ  in `RegistroView` â†’ niente flash "nessuna anagrafica"
  switchando registro (mostra subito i dati giÃ  visti, aggiorna in sottofondo).
- **Anagrafiche con molte righe**: l'apertura del modale non ridisegna piu' la tabella completa
  (il nodo `Tabella` e' memoizzato e le opzioni collegate si aggiornano dopo il primo frame). Con
  10.000 record il click sulla riga mostra subito il modale, come nel Giornaliero.
- **Import anagrafiche storiche**: la scansione usa indici `Map` per CF/nome/telefono sia sul batch
  estratto sia sui clienti gia' presenti. Evita i confronti lineari ripetuti, aggiorna una barra di
  progresso reale e cede il renderer a ogni blocco, mentre la scrittura resta in chunk come prima.
- **Anagrafiche clienti lunghe**: il registro clienti puo' partire in vista compatta locale
  (solo clienti con ordine nell'anno corrente o creati nell'anno corrente, quando esistono nuovi
  clienti di quell'anno). Lo switch "Tutti i clienti" resta salvato in `localStorage`; la ricerca
  testuale mostra sempre l'intero archivio prima di applicare ricerca e filtri.
- **Filtri anagrafiche**: `RegistroView` riusa `FiltriPopover`; Clienti filtra per agente e medico
  derivando anche dagli ordini, Medici filtra per agente.
- **Dedup import clienti**: gli indici includono anche email. Nome+telefono, nome+email o
  nome+luogo+stessa strada identificano lo stesso cliente anche se civico/punteggiatura sono cambiati;
  la fusione arricchisce i campi incompleti e lascia prevalere il valore piu' recente sui conflitti
  valorizzati. L'applicazione del piano avviene ora in un solo comando backend: confronta gli
  snapshot letti dalla UI con la proiezione corrente, non propaga mai valori vuoti, riassegna tutti
  i riferimenti cliente e verifica che non ne restino prima di emettere `Purged`. I duplicati non
  passano dal Cestino; se un record cambia nel frattempo, la relativa unione viene saltata.
- **Export Aruba condiviso**: ogni cliente esportato riceve `aruba_esportato_il` solo dopo la
  scrittura riuscita dell'Excel. Il marcatore e' nel log condiviso, quindi vale su tutti i PC.
  I clienti senza CF restano non marcati e ricompaiono automaticamente quando il CF viene
  completato, anche se creati prima dell'ultimo export. Anche la modifica di un CF già presente
  azzera il marcatore di export. La ricandidatura è registrata in `aruba_ricandidato_il`, così il
  vecchio cutoff in `localStorage` (migrato una sola volta tramite il singleton
  `parametri_globali/aruba_export`) non può rimarcare per errore il cliente appena aggiornato.
  `aruba_cf_esportato` rende inoltre inefficace un marcatore concorrente riferito al vecchio CF.
- **Ricerca globale**: comando "Mostra Pulizia dati" verso Impostazioni con scroll diretto al box.
- **Notifiche custom overlay**: hover e composer di risposta sospendono il countdown mantenendo il
  tempo residuo, allineando il comportamento ai toast/popover. Il focus della finestra
  principale non pulisce più le card: soltanto l'apertura esplicita della campanella emette una
  pulizia locale e visiva, senza `notifica_letta` né eventi condivisi fra PC.
- **Contabilita' / Crediti**: apertura del modale pagamento ottimizzata come Anagrafiche; la tabella
  crediti e' memoizzata, la ricerca usa `useDeferredValue`, i filtri multipli usano `Set` e i totali
  sono calcolati in una sola passata. Gli update realtime sono debounced per evitare ricariche
  multiple durante raffiche di eventi sync.
- **Provvigioni agenti**: le ricariche realtime del report sono debounced e la ricerca nel modale
  "Paga provvigioni" e' differita, cosi' la digitazione resta fluida anche con molti ordini pagabili.
- **Spedizioni**: gli eventi realtime sono debounced come nelle viste contabili e le distinte per
  corriere sono precalcolate per lotto, evitando ricalcoli durante il render delle righe.
- **Produzione**: ricerca differita, filtro agenti indicizzato con `Set`, lookup ordine/pazienti
  indicizzati con `Map` e realtime debounced. Il polling periodico resta come fallback, quindi gli
  aggiornamenti da altri PC o finestre separate continuano ad arrivare senza reload pagina.
- **Anagrafiche calcolate**: il conteggio Medici per Agente usa una `Map` precomputata invece di
  filtrare tutti i medici per ogni riga agente.
- **Dialog app sopra tutto**: `DialogProvider` `zIndex={4000}` (prima il confirm di eliminazione
  pagamento finiva sotto il modale di modifica).
- **Transizione pagina**: `Pagina` ritarda il fade-in di un frame â†’ il layout (tabelle che leggono
  le larghezze salvate) si assesta **mentre Ã¨ invisibile**, niente piÃ¹ "contenuti che si adattano".
- **Menu**: pagina **Produzione** (rotta `/produzione`, completa in FASE 5) tra Giornaliero ed
  Evasione; ContabilitÃ  spostata sotto Evasione.

**Rifiniture round 2 (feedback utente su 3A + tabelle)**:
- **Conti built-in** (Contrassegno/Assegno): in `RegistroView` un record `bloccato` (builtin) non ha
  menu â‹¯, doppio-click, nÃ© storico (prop `bloccato`).
- **Storico**: la creazione (Created + campi iniziali entro 2 s) Ã¨ accorpata nella sola voce
  "Creato"; mostrato il **nome utente** (mappa `getUsers`) invece dell'id grezzo.
- **Pagamenti / SaldaModal**: conto **non digitabile** (Select senza `searchable`); scegliendo un
  conto di transito (Contrassegno/Assegno) si chiede **conferma in-app** (il saldo va con la
  distinta corriere). `allowDeselect={false}` ovunque (fix del **bug** "ri-clic sull'opzione giÃ 
  scelta svuotava il campo", es. prodotto).
- **Editor ordine**: card pagamento riorganizzata (Importo+Acconto previsto a sinistra,
  Incassato+Residuo a destra; meno spazio vuoto); i movimenti sono righe **chiaramente cliccabili**
  (`.pt-pagamento-row` con hover + matita).
- **Giornaliero**: aggiunta colonna **Regione** giÃ  c'era; il filtro stati Ã¨ multi-selezione.
- **Tabelle (mantine-datatable)**: tolti i `width` espliciti dalle colonne `resizable` (erano la
  causa dello **scroll orizzontale**), forzato `.mantine-datatable-table { width:100% }`, e
  l'**handle di resize** allargato a 14px e reso visibile (prima 8px invisibile â†’ si mancava e si
  ordinava per sbaglio). CSS in `styles.css`.
- **Impostazioni**: Backup senza lista (mostra **percorso cartella** + click â†’ apre la cartella via
  `apri_cartella_backup`, dove gestirli/eliminarli) + "Ripristina da fileâ€¦"; box **Aggiornamenti e
  info** uniti (meno spazio vuoto).

**Tabelle universali (mantine-datatable, richiesta utente)**: introdotto `src/ui/Tabella.tsx`
(wrapper attorno a **mantine-datatable** 7.17.1, stile dell'app) come **componente tabella unico e
riusabile** per tutte le liste. Funzioni: **resize colonne** (persistito via `storeColumnsKey`),
**sort cliccando l'header** (`sortStatus`/`onSortStatusChange` + sort client-side), **header/filtri di
pagina sempre fissi** (la tabella riempie l'altezza con `height="100%"` dentro un `Box flex:1
minHeight:0`, scrolla solo il corpo), pronto per virtualizzazione/paginazione. Migrate: **Giornaliero**
(+ **filtro stati multi-selezione**), **Pagamenti**, le 6 anagrafiche (**RegistroView**) e **Listino**.
La colonna ordinamento e la larghezza si ricordano. CSS importata in `main.tsx`. ProvvigioniView resta
a card (Ã¨ un report, non una griglia). `limit={100}` sui Select pesanti per liste lunghe.

**Convenzione EMPTY-STATE (regola del progetto, ogni tabella)** â€” documentata in `Tabella.tsx` e
coerente con la regola *fetch-then-render*: durante il caricamento si passa un `emptyState` **vuoto**
(`<Box/>`, niente messaggio nÃ© spinner: i dati locali sono immediati, non deve lampeggiare un falso
vuoto); a caricamento finito, se non ci sono righe, si mostra un `emptyState` **dedicato e parlante**
(icona + frase specifica della vista, es. Â«Nessun creditoâ€¦Â», Â«Nessun rimborsoâ€¦Â», Â«Nessun ordineâ€¦Â»),
distinguendo "nessun dato" da "nessun risultato per i filtri" quando utile. Pattern:
`emptyState={caricamento ? <Box/> : <Messaggioâ€¦/>}`. Applicata a Giornaliero, Crediti, Distinte,
Provvigioni, Rimborsi e anagrafiche; vale anche per le tabelle future (Ordini, Spedizioni).

**Rifiniture (feedback utente dopo verifica dal vivo)**:
- **Elimina/visualizza pagamento**: `PagamentoDettaglioModal` (click su un movimento nell'editor
  ordine o nella tabella Pagamenti) â†’ vedi/modifica (tipo, importo, conto, data, verificato, note)
  o **Elimina** = soft-delete â†’ **Cestino** (ripristinabile). `incassato`/`stato_pagamento` si
  ricalcolano da soli (derivati dai pagamenti non eliminati) â†’ **ripristino conflict-safe**. Il
  Cestino mostra i pagamenti con etichetta Â«Pagamento Â· â‚¬ importo (tipo)Â».
- **Giornaliero**: aggiunta colonna **Regione** (`cliente_regione` nel DTO/`ordini_lista`); il NÂ°
  resta la prima colonna fissa con i badge.
- **ContabilitÃ **: il tab di default Ã¨ **Pagamenti** ma si **ricorda l'ultimo** aperto
  (`localStorage pt.contabilita.tab`); spunta Â«VerificatoÂ» **centrata**.
- **Spedizioni / Produzione**: anche questi hub ricordano l'ultima scheda aperta
  (`localStorage pt.spedizioni.tab`, `localStorage pt.produzione.tab`), coerenti con gli altri hub.
- **Autocomplete**: `limit={100}` sui Select pesanti (cliente/medico/prodotto + relazioni
  anagrafiche) come primo passo per liste lunghe.

**Pulizia UX (richiesta utente)**: rimossi gli spinner/Â«Caricamentoâ€¦Â» che lampeggiavano allo
switch di sezione/tab (dati locali = immediati): niente loader durante il primo caricamento in
`ProvvigioniView`/`PagamentiView`/`GiornalieroView`/`RegistroView`/`ListinoView`; i tab ContabilitÃ 
restano montati (niente remount/refetch).

## FASE 3B â€” Modello pagamenti unificato (atteso/saldato) + scadenzario + tab Crediti

**Refactor (giugno 2026, su feedback utente)**: la contabilitÃ  di 3A/3B Ã¨ stata **semplificata in un
unico concetto**. Non esistono piÃ¹ entitÃ  `piano_rate`/`rata`: c'Ã¨ solo **`pagamento`** con uno
**stato** (`saldato: bool`) e una **scadenza**. Acconto, saldo e rate sono tutti pagamenti â€” *attesi*
(in attesa di incasso) finchÃ© non si **saldano**.

**Decisioni (giugno 2026)** â€” vedi `MODELLO-DATI.md`:
- **Un solo `pagamento`** con `saldato` + `scadenza`. **`incassato = Î£ pagamenti saldati`**; gli
  attesi sono crediti, non incassi. Rimosse `piano_rate`/`rata` e i comandi/DTO relativi.
- **Scadenzario automatico al primo salvataggio ordine**: si creano **acconto + saldo** *attesi*. Se
  l'acconto Ã¨ spuntato **Â«giÃ  incassatoÂ»** nasce *saldato* (â†’ resta credito solo il saldo). Tutto poi
  **annullabile/modificabile** (anche l'acconto), cosa che prima non era possibile.
- **"Salda"** trasforma un pagamento *atteso* in *incassato* (conto/data/verifica reali); non crea un
  movimento separato. "Registra pagamento" puÃ² creare anche un *atteso*.
- **Tab rinominato "Crediti"**: **tabella unica** (attesi + saldati insieme) con NÂ° ordine, tipo,
  importo, scadenza/incasso, stato e verifica; filtri agente/conto/periodo/stato; **colonne
  ordinabili e configurabili** come il Giornaliero (riusa `ColonneMenu`). Empty-state "nessun credito".
- **Auto-apply su data spedizione** ancora **differito alla FASE 4** (il saldo atteso usa una scadenza
  stimata = data ordine + 30 gg).

**Backend** (`app/accounting.rs`, `commands/mod.rs`, `lib.rs`):
- `pagamento` ora: `ordine_id, tipo (acconto|saldo|rata), importo, saldato, scadenza, conto_id, data,
  verificato, distinta_id?, note?`. `AggPag`/`stato_pagamento` derivano **solo dai saldati**;
  `conferma_se_nuovo` (Nuovoâ†’Confermato) scatta quando un pagamento Ã¨/diventa saldato.
- Comandi: `pagamenti_ordine` (scadenzario), `pagamenti_vista(agente?,conto?,dal?,al?,stato?)` (vista
  unica Crediti; `stato` âˆˆ atteso|saldato|da_verificare), `pagamento_registra(â€¦, saldato, scadenza,
  conto, data, verificato, note)`, `pagamento_salda(id, conto, data, verificato)`,
  `pagamenti_rateizza(ordine, rate[])` (sostituisce gli *attesi* saldo/rata con N rate attese). Il
  calcolo rate (parti uguali, ultima quadra i centesimi) resta **lato UI**.
- Test `pagamenti_attesi_saldo_e_rateizza`: attesi non incidono su incassato; salda â†’ confermato;
  vista/filtri; rateizza sostituisce il saldo; annullo pagamento; contrassegno in attesa. **56 verdi.**

**Frontend** (`features/contabilita/`, `features/giornaliero/`):
- `PagamentoModal.tsx` (unica): crea (atteso o incassato), modifica, **Salda**, **annulla**. Stato via
  SegmentedControl *Atteso/Incassato*; se atteso â†’ scadenza, se incassato â†’ conto+data+verifica.
  Sostituisce le vecchie `SaldaModal` + `PagamentoDettaglioModal` (rimosse).
- `RateizzaModal.tsx`: divide il **saldo atteso** in N rate (default **2**), cadenza Mensile/Ogni N
  giorni, anteprima editabile; conferma â†’ `pagamenti_rateizza`.
- **Editor ordine**: campo "Acconto previsto" + checkbox **Â«giÃ  incassatoÂ»** (solo nuovo ordine);
  **scadenzario** (attesi+saldati) con badge stato (atteso/scaduto/da verificare/saldato), **Salda**
  per riga, **Rateizza saldo**, **Aggiungi pagamento**. `incassato` = solo saldati.
- `PagamentiView.tsx` = tab **Crediti** unico: tabella `pagamenti_vista` con colonne configurabili
  (`colonneCrediti.tsx` + `ColonneMenu` reso generico), filtri, totali Atteso/Incassato; verifica
  inline (checkbox) e **Salda** sui saldabili; riga â†’ `PagamentoModal`. Rimossa la `CreditiView`
  separata e il SegmentedControl.

## FASE 3C â€” Distinte corrieri (accredito contrassegni/assegni) (completa, non committata)

Saldo del transito: i pagamenti incassati in **contrassegno**/**assegno** restano
`in_attesa_accredito` finchÃ© una **distinta** non li accredita sul conto reale del bonifico
cumulativo.

**Decisioni (giugno 2026)** â€” vedi `MODELLO-DATI.md`:
- **Distinta per contrassegno *e* assegno**: `corriere_id` **opzionale** (vuoto = versamento
  assegni). Il candidato Ã¨ qualunque pagamento su conto di transito saldato e non ancora
  accreditato (`distinta_id` vuoto), indipendentemente dal corriere (gli ordini non hanno ancora
  un corriere: arriva con le spedizioni in FASE 4).
- **Doppia prospettiva mezzoâ†”conto** (richiesta utente): il pagamento **mantiene** `conto_id =
  Contrassegno/Assegno` (cosÃ¬ "quanto ha incassato un agente in contrassegno" si calcola sul
  mezzo), mentre il **conto reale** dove sono arrivati i soldi Ã¨ la **fotografia** `conto_id`
  **sulla distinta**; il pagamento vi si collega con `distinta_id`. Niente campo duplicato sul
  pagamento: il conto reale si deriva dalla distinta (`conto_accredito_nome` nei DTO, mostrato nei
  Crediti come Â«Contrassegno â†’ BANCA DEMOÂ»).
- **Importo distinta = somma dei pagamenti spuntati** (auto, nessuna trattenuta), salvato come
  snapshot sulla distinta.
- **Accredito = riscontro in prima nota**: collegando i pagamenti la distinta li marca anche
  `verificato = true` (i soldi sono sul conto via bonifico) â†’ l'ordine va a `saldato` (verde scuro),
  non solo `saldato_da_verificare`. Eliminando la distinta i pagamenti tornano scollegati e
  `verificato = false` â†’ di nuovo `in_attesa_accredito`.
- **Niente entitÃ  `DistinteRighe`**: il legame distintaâ†”pagamenti Ã¨ il campo `distinta_id` sul
  pagamento (le "righe" di una distinta = i pagamenti con quel `distinta_id`). Scostamento dal
  `MODELLO-DATI.md` che la elencava come entitÃ  separata.

**Backend** (`app/accounting.rs`, `commands/mod.rs`, `lib.rs`):
- EntitÃ  **`distinta`**: `corriere_id?, data_distinta, data_accredito, importo, conto_id`
  (snapshot del conto reale). Aggiunta a `ENTITA_UTENTE`.
- DTO `DistintaDto` (con `corriere_nome`/`conto_nome`/`n_pagamenti`) e `ContrassegnoApertoDto`
  (pagamento di transito con ordine/cliente/agente). `PagamentoDto`/`PagamentoVistaDto` ora
  espongono `conto_accredito_nome` (derivato dalla distinta via helper `distinte_accredito`).
- Comandi: `contrassegni_aperti` (transito saldati senza distinta), `distinte_lista`,
  `distinta_righe(id)` (pagamenti coperti), `distinta_crea(corriere, date, conto, pagamento_ids)`
  (importo = Î£ spuntati; collega+verifica i pagamenti), `distinta_elimina(id)` (scollega â†’ tornano
  in attesa). Helper `contrassegni_dto(p, filtro)` riusato da aperti/righe.
- Test `distinte_corriere_accredito` (in_attesaâ†’saldato, importo = somma, mezzo resta contrassegno
  + conto reale dalla distinta, assegno escluso resta in attesa, elimina ripristina). **58 verdi.**

**Frontend** (`features/contabilita/`, `features/anagrafiche/`):
- `ContabilitaHub`: nuovo tab **"Distinte Corrieri"** (tra Crediti e Provvigioni).
- `DistinteView.tsx`: `Tabella` delle distinte (corriere/date/conto/n. pagamenti/importo, totale
  accreditato) + **"Nuova distinta"**; click su riga â†’ modale **dettaglio** (pagamenti coperti,
  read-only) con **Elimina** (conferma `dialog.confirmDanger`).
- `DistintaModal.tsx`: corriere (opzionale, **propone** il suo `conto_incasso_id`, fallback
  `predefinito_accrediti`), conto di accredito (solo conti reali), date distinta/accredito, lista
  **contrassegni aperti** con spunta + filtro Tutti/Contrassegno/Assegno + "spunta tutti";
  **importo = somma spuntati** in tempo reale.
- `colonneCrediti.tsx`: colonna **Conto** mostra Â«mezzo â†’ conto realeÂ» quando accreditato.
- `registri.ts`: corriere esteso con **"Conto di accredito contrassegni"** (`conto_incasso_id`).

**Rifinitura â€” conto destinazione sugli attesi (giugno 2026, feedback utente)** (FASE-3 decisione 11):
un pagamento **atteso** porta il **conto verso cui arriveranno i soldi sin dalla creazione**, non
solo al saldo, risolto con le stesse preferenze (`risolviContoPreferito`, medico â†’ agente â†’
`predefinito_incassi`).
- `OrdineEditor`: lo scadenzario bozze assegna `contoAccontoResolved`/`contoSaldoResolved` agli
  attesi; `persistiBozze` salva sempre il conto; il rateizzo locale e lo scadenzario mostrano il
  conto destinazione (Â«â†’ ContoÂ») anche per gli attesi.
- `PagamentoModal`: il **conto** si mostra anche in modalitÃ  *Atteso* (label Â«Conto previstoÂ») e si
  salva (creazione e ritorno-ad-atteso); saldando, Ã¨ il conto giÃ  pre-compilato.
- Backend `pagamenti_rateizza`: le rate **ereditano** il `conto_id` del saldo atteso sostituito
  (test `pagamenti_attesi_saldo_e_rateizza` aggiornato).

**Empty-state ContabilitÃ ** (FASE-3 decisione 12): ogni tab mostra un messaggio dedicato a dati
assenti dopo il caricamento (no flash): Â«nessun creditoÂ» (Crediti), Â«nessuna distintaÂ» (Distinte),
Â«nessuna provvigioneÂ» (Provvigioni); Â«nessun rimborsoÂ» arriverÃ  con 3D.

**Credito potenziale vs atteso** (FASE-3 decisione 13, feedback utente): i Crediti distinguono ora
**Potenziale** (attesi di ordini `Nuovo`, preventivi) Â· **Atteso** (attesi di ordini impegnati,
stato âˆ‰ {Nuovo, Rifiutato}) Â· **Incassato** (saldati).
- Backend `pagamenti_vista`: `PagamentoVistaDto` espone `ordine_stato`; gli **attesi dei `Rifiutato`
  sono esclusi** dalla vista (un saldato di un rifiutato resta visibile). Test
  `crediti_stato_ordine_e_rifiutato_escluso`. **59 verdi.**
- `colonneCrediti.tsx`: helper `potenziale(r)`; `scaduta` ora **non** marca i potenziali; `StatoBadge`
  con Â«PotenzialeÂ» (grigio).
- `PagamentiView.tsx`: tre totali (Potenziale/Atteso/Incassato) in una **banda grande** stile
  Provvigioni (Atteso in evidenza, Incassato e Potenziale a destra); filtro stato con Â«PotenzialiÂ».

## FASE 3D â€” Rimborsi (completa, non committata)

Flusso di denaro **in uscita**, separato dai pagamenti in entrata. Copre il foglio RIMBORSI del
File GENERALE e il caso "soldi in eccesso" (overpayment).

**Decisioni (giugno 2026)** â€” vedi `MODELLO-DATI.md` â†’ Rimborsi:
- **EntitÃ  `rimborso`** con stato **derivato** richiestoâ†’effettuato (la `data_rimborso` valorizzata
  = effettuato). Niente stato "annullato": un rimborso non valido si elimina â†’ **Cestino**.
- **Caso "Rimborsa extra"** da ordine pagato in eccesso (`incassato > totale`): `origine = extra`,
  `ordine_id` valorizzato, importo pre-compilato = `incassato âˆ’ totale`, ragione sociale/IBAN dal
  cliente. Ãˆ un **flusso a parte**: NON tocca i pagamenti nÃ© i totali Crediti (il residuo negativo
  resta visibile finchÃ© lo si gestisce; il rimborso Ã¨ denaro che esce, non un pagamento annullato).
- **Entry "Rimborsa extra" da ovunque** (scelta utente): menu â‹¯ Giornaliero (solo se eccesso),
  editor ordine (card Pagamenti), tab Crediti (al posto di "Salda" sulle righe di ordini in eccesso)
  e tab Rimborsi (collegando un ordine in fase di creazione).
- **"Segna effettuato" = modale leggera** (data, default oggi + conto di uscita, suggerito dal
  `predefinito_accrediti`, modificabile/opzionale).

**Backend** (`app/accounting.rs`, `commands/mod.rs`, `lib.rs`):
- EntitÃ  **`rimborso`**: `data_richiesta, importo(cent), ragione_sociale, motivo, iban, conto_id?,
  data_rimborso, note, ordine_id?, origine`. Aggiunta a `ENTITA_UTENTE` (Cestino/storico â†’ ora 12).
- DTO `RimborsoDto` (stato derivato, `conto_nome`, `ordine_numero`) via helper `rimborso_dto`;
  `RimborsoExtraDto` per la pre-compilazione.
- Comandi: `rimborsi_lista(stato?)`, `rimborso_salva(...)` (crea se id vuoto, altrimenti aggiorna),
  `rimborso_segna_effettuato(id, data, conto?)`, `rimborso_extra_precompila(ordine_id)` (importo =
  `incassato âˆ’ totale`, ragione/IBAN dal cliente). Filtri ricchi (periodo/origine) lato UI â†’ 3E.
- Test `rimborsi_richiesto_effettuato_e_extra` (stato derivato, filtro, no-duplicati su modifica,
  precompilazione extra, il rimborso non altera incassato/residuo dell'ordine). **60 verdi.**

**Frontend** (`features/contabilita/`, `features/giornaliero/`, `shell/`):
- `statiRimborso.ts` (stati richiesto/effettuato con colore+icona; `origineRimborsoLabel`).
- `RimborsiView.tsx`: tab **Rimborsi** attivo (era segnaposto). `Tabella` (data richiesta, ragione
  sociale, motivo, origine, importo, stato, data rimborso) + banda totali Richiesto/Effettuato +
  filtri stato/periodo + empty-state Â«nessun rimborsoÂ»; azione di riga **"Effettuato"** sui
  richiesti (apre `SegnaEffettuatoModal`); click riga â†’ dettaglio/modifica.
- `RimborsoModal.tsx`: crea/modifica un rimborso (con campo opzionale **"Collega a un ordine"** che
  lo rende `extra` e precompila), elimina â†’ Cestino; + `SegnaEffettuatoModal` (modale leggera).
- **Giornaliero**: colonna Residuo mostra badge **"Extra â‚¬X"** (viola) quando `residuo < 0`; voce
  menu â‹¯ **"Rimborsa extra"** (solo se eccesso).
- **Editor ordine** (`OrdineEditor`): bottone **"Rimborsa extra"** nella card Pagamenti se l'ordine
  salvato Ã¨ in eccesso.
- **Crediti** (`PagamentiView`): carica `ordini_lista` per la mappa residuo per ordine; sulle righe
  di un ordine in eccesso l'azione diventa **"Rimborsa extra"** (al posto di Salda/verifica).
- `ContabilitaHub`: tab Rimborsi attivo (rimosso il segnaposto/badge "FASE 3").
- `CestinoPopover`: etichette per `rimborso` (e `distinta`).

**Rifiniture (feedback utente, giugno 2026)**:
- **Conto predefinito rimborsi**: nuovo flag universale `predefinito_rimborsi` sul `conto`
  (ruolo `rimborsi` in `conto_predefinito_set`), impostabile da âš™ï¸� **Preferenze conti** â†’ si
  auto-compila nel "Nuovo rimborso" e nella `SegnaEffettuatoModal` (prima usava `predefinito_accrediti`).
- **Niente rimborsi duplicati**: il sistema riconosce un rimborso `extra` giÃ  esistente per
  l'ordine (helper `mappaRimborsiExtra` su `rimborsi_lista`) e lo **riapre** invece di crearne uno
  nuovo. L'entry point mostra lo **stato**: Â«Rimborso richiestoÂ» / Â«Rimborso effettuato (emesso)Â»
  invece di Â«Rimborsa extraÂ». Applicato a Giornaliero (menu â‹¯), editor ordine (bottone) e Crediti.
- **Crediti â€” una sola riga**: Â«Rimborsa extraÂ» appare **solo sulla riga in eccesso** (l'ultimo
  pagamento saldato che ha superato il totale, `righeEccesso`), non su ogni pagamento dell'ordine;
  sulla stessa riga si vede poi Â«Rimborso richiesto/emessoÂ».
- **DistintaModal** (FASE 3C): dropdown Corriere/Conto con `zIndex: 1400` (prima finivano sotto il
  modale) e contenuto **tenuto montato durante l'uscita** (`onExited`) per non far "collassare" il
  modale in chiusura.
- **Distinta â€” candidati e importo** (FASE 3C, feedback): `contrassegni_aperti` ora include **anche i
  pagamenti ATTESI** su conto di transito (non solo i giÃ  saldati): un credito in
  contrassegno/assegno compare quindi fra i candidati e la distinta lo **salda** al momento
  dell'accredito (`saldato + verificato`, data = data accredito; l'ordine si conferma e gli attesi
  residui si ripuliscono). `distinta_crea` accetta un **importo accreditato** modificabile (campo
  Â«Importo accreditatoÂ» in `DistintaModal`, default = somma spuntati, mostra trattenuta/eccedenza);
  `importo <= 0` ricade sulla somma. Test `distinta_salda_attesi_e_importo_personalizzato`. **61 verdi.**
- **Annullo pagamento con rimborso associato**: in `PagamentoModal`, annullando un pagamento di un
  ordine che ha un rimborso `extra` (richiesto **o** emesso), un dialog avvisa e â€” se confermato â€”
  **annulla anche il rimborso** (â†’ Cestino). Vale per Crediti ed editor ordine.

## FASE 3E â€” Export Excel universale + filtri ricchi + automazione "Chiuso" (completa, non committata)

Chiude la FASE 3: esportazioni contabili (task 8), filtri piÃ¹ ricchi (task 7) e l'automazione di
stato "Chiuso" (task 9-resto).

**Decisioni (giugno 2026)**:
- **Export/stampa UNIVERSALE con anteprima** (richiesta utente): un solo meccanismo riusabile da
  qualsiasi tabella (anche le future Ordini/Spedizioni). Il bottone Ã¨ **solo-icona** accanto a
  "Colonne" (niente spazio in piÃ¹ nella riga filtri). Aprendolo, un **modale di anteprima** mostra
  le prime righe come usciranno, con una **checkbox per colonna pre-spuntata = colonna visibile**
  (riusa la config colonne della vista) e la scelta dell'**orientamento** (Verticale/Orizzontale,
  proposto in base al numero di colonne). Due azioni: **Salva Excel** (.xlsx, dialog nativo + **nome
  file proposto** `crediti-AAAA-MM-GG.xlsx`, foglio in landscape se orizzontale) e **Stampa** (apre
  il dialog di stampa del sistema via iframe nascosto â†’ anche "Salva come PDF"). L'export/stampa
  **rispetta i filtri** perchÃ© la vista passa giÃ  le righe filtrate+ordinate.
- **Automazione "Chiuso"** (FASE-3 dec. 6, chiarita con l'utente): un ordine va a **Chiuso** quando Ã¨
  **Spedito** + **completamente saldato** (`incassato â‰¥ totale`, almeno un incasso) + **â‰¥ 20 giorni
  dalla data dell'ultimo saldo**. Scelto l'**ultimo saldo** come orologio invece della data di
  spedizione (che non esiste ancora) â†’ **nessuna dipendenza da FASE 4**; quando ci sarÃ  la data di
  spedizione vera si potrÃ  cambiare solo la sorgente. Eseguita **all'avvio** dell'app e **dopo ogni
  saldo** (registrazione/saldo pagamento, accredito distinta) â€” utile per saldi retrodatati.

**Backend** (`export.rs`, `app/accounting.rs`, helper di chiusura in `app/mod.rs`, `commands/mod.rs`, `lib.rs`):
- **Export generico** `export::griglia_xlsx(path, foglio, colonne, righe, orizzontale)`: header in
  grassetto, importi come **numeri** (formato `#,##0.00`, Excel li somma), date come testo
  `gg/mm/aaaa`, riga **Totali** in fondo per le colonne marcate, larghezze auto, nome foglio
  sanificato (â‰¤31 char) e orientamento foglio (`set_landscape` se orizzontale). `ColExport { label,
  tipo (testo|euro|numero|data), totale }`. Comando `griglia_export(path, foglio, colonne, righe,
  orizzontale)` (non tocca la proiezione: dati e filtri vivono nel frontend).
- **Chiusura automatica**: `prova_chiudi_ordine(engine, ordine_id, soglia)` (no-op se non idoneo;
  emette `stato = Chiuso` via motore eventi), `ordini_auto_chiudi()` (itera gli Spediti, ritorna
  quanti chiusi); helper `data_giorni_fa(n)` (soglia = `oggi âˆ’ n gg`, `YYYY-MM-DD`); const
  `GIORNI_CHIUSURA = 20`. Aggancio in `pagamento_registra`/`pagamento_salda`/`distinta_crea`.
- Test `ordini_auto_chiudi_spedito_saldato_20gg` (chiude solo Spedito+saldato+vecchio; non chiude
  saldato-oggi, parziale o non-spedito; chiusura immediata al saldo retrodatato). **62 test verdi.**

**Frontend** (`ui/esporta/`, `features/contabilita/`, `features/giornaliero/`, `shell/`):
- **`ui/esporta/EsportaTabella.tsx`** (riusabile, export **+ stampa**): trigger configurabile via
  `variante` â€” `bottone` (default, etichetta Â«Esporta / StampaÂ», scelta utente per coerenza con
  Provvigioni) o `icona` (`ActionIcon` compatto); in entrambi i casi tooltip Â«Esporta o stampaÂ».
  Modale anteprima (`Table`
  striped, checkbox colonne in `SimpleGrid`, `SegmentedControl` orientamento, conteggio
  righe/colonne, nota riga Totali) con due azioni **Stampa** e **Salva Excel**. `ColonnaExport<T> {
  key, label, tipo, totale, valore, preSel }` e helper `colonneEsportabili(defs, visibili)` che
  costruisce le colonne dalle definizioni di vista che portano `esporta`, pre-spuntando le visibili.
  Stampa = `stampaTabella()` costruisce un HTML print-friendly (`@page size A4 portrait/landscape`,
  totali, striping) in un **iframe nascosto** e chiama `print()` (nessuna dipendenza; in webview â†’
  anche PDF). Excel = `api.grigliaExport` + `save()` nativo con nome proposto.
- **Colonne con `esporta`**: `colonneCrediti.tsx` e `giornaliero/colonne.tsx` arricchite con i
  metadati di export (tipo euro/data/testo, totali su importi); `MetaExport<T>` condiviso.
- **Crediti** (`PagamentiView`): `EsportaTabella` accanto a "Colonne" (righe = vista filtrata+ordinata);
  filtro stato esteso con **"Scaduti"** (`statiDi` tagga gli attesi scaduti) â€” senza nuovi controlli.
- **Rimborsi** (`RimborsiView`): colonne export fisse (incl. IBAN/Conto off-default), filtro
  **"Origine"** (Manuali/Eccesso) e `EsportaTabella` in coda alla riga filtri.
- **Giornaliero** (`GiornalieroView`): `EsportaTabella` accanto a "Colonne" (ordini filtrati+ordinati).
- **Provvigioni** (`ProvvigioniView`): export/stampa **universalizzato** â€” il vecchio bottone dedicato
  Ã¨ sostituito da `EsportaTabella` su righe piatte (un ordine per riga + nome agente, `RigaProvv`),
  rispettando i filtri agente/periodo del report. Il backend `provvigioni_export`/`provvigioni_xlsx`
  resta (ancora testato) ma la UI non lo usa piÃ¹.
- **Shell**: all'avvio chiama `api.ordiniAutoChiudi()` (silenzioso), come pulizia Cestino e backup auto.

**Scostamenti / rinviati**: i filtri "spediti/non spediti" e i marcatori note (`!`/`?`/`ok`) del
task 7 restano fuori (la ricerca Giornaliero copre giÃ  il testo note; lo stato Spedito sarÃ  piÃ¹
significativo con la FASE 4). Export solo **Excel** (no CSV/PDF: l'utente ha chiesto Excel).

## FASE 4 â€” Spedizioni / evasione (completa, non committata) â€” commit `f017aa7`

Evasione **a livello di riga**, distinte corrieri, bundling colli, unione/separazione lotti, filtri
spediti/non-spediti e marcatori di triage. **Committata+pushata** (commit
`5db569e` per 4A-4C, `f017aa7` per 4D-4E + rifiniture). **70 test verdi.**

**4A-4C â€” Spedizioni base + distinte + bundling + lotti**:
- **Righe da spedire** (`righe_da_spedire`): elenco delle righe `da spedire` di tutti gli ordini,
  con nomi cliente/medico/corriere; selezione multi-ordine/multi-cliente.
- **Spedizione** (`spedizione_crea`): le righe scelte passano a `spedita` (parziale = il resto
  resta `da spedire`); collo manuale (`spedizione_collo_manuale`), riepilogo incassi/contrassegni.
- **Distinte corriere** (`distinta_*`): export distinta **CORRIERE_B/CORRIERE_A** (file Excel) su selezione
  multi-lotto/giorno, filtri corriere/periodo, **chooser multi-corriere**.
- **Bundling**: ordini dello stesso cliente raggruppati in **un collo**.
- **Lotti Effettuate** (`lotto_unisci`/`lotto_separa`, flag `unito`): Unisci/Separa lotti, Â«Da
  spedireÂ» di un rigo, card collo compatta (via + griglia ordini per i colli uniti).
- Frontend: `features/spedizioni/` (`SpedizioniView`, `CreaSpedizioneModal`, `DistintaModal`,
  `ColloAzioni`, `GruppoSpedDettaglio`, `AggiungiColloModal`, `FurgoncinoLoader`); rotta `/evasione`.

**4D â€” Ordini per categoria (redesign)**:
- Ordini **per categoria** (Immunoterapia/Diagnostica/Keriba): split-button **Â«Nuovo ordineÂ»**
  (`NuovoOrdineMenu`, chevron + slide), categoria salvata sull'ordine + prodotti filtrati in editor,
  filtro + colonna **Â«LineaÂ»** (`OrdineDto.linee`, storage colonne v5).
- **Provvigioni per linea** sull'agente (`provv_cat_*`, campo tipo `sezione`, `CfgAgente.valore_per`).
- **Indirizzo di spedizione sui Medici**; Diagnostica **cliente = medico** (fallback destinatario);
  Keriba **Â«salda tutto alla consegnaÂ»** (contrassegno + 30gg), acconto Keriba = costo prodotti.
- Box `DiagPanel` per riga **rimosso** (struttura Diagnostica dettagliata â†’ FASE 5).

**4E â€” Triage**:
- Filtro **Spediti / Non spediti** (Giornaliero + Crediti, helper `isSpedito`).
- **Marcatori `urgente`/`anomalia`/`sollecito`** (`OrdineDto.marcatore`, modulo `giornaliero/marcatori.ts`,
  set da editor + menu â‹¯) mostrati sotto lo stato. NON i simboli Excel; messaggi/incident â†’ FASE 6.
- **Chiusura auto da data spedizione** (`prova_chiudi_ordine` ora usa anche la data di evasione).

**Rifiniture FASE 4** (commit `f017aa7`): colonne registri data-driven in `RegistroView`
(`Colonna.calcola`/`badge`, `Registro.correlate`, `ColonnaCtx`); **Listino fuso in Prodotti**
(`prezzi.tsx`: `ProvaPrezzoCard` + `RegoleProdotto`, regola = modale `RegolaModal`; `ListinoView`
eliminato) via prop `RegistroView` `intestazione`/`modalExtra`/`modalSize`/`bloccaChiusura`;
**corrieri CORRIERE_B/CORRIERE_A built-in** (`ensure_builtin_corrieri`/`seed_builtin_corrieri`, non
eliminabili); **filtro per linea** combinabile in Giornaliero/Crediti; **`FiltriPopover`** (badge
conteggio + Azzera); empty-state robusto (`minHeight` in `Tabella`).

## FASE 5 â€” Produzione / Laboratorio (COMPLETA: 5A+5B+5C+5D+5E)

Pagina **Produzione** dedicata, lotti di produzione, dati produzione per riga, **export Laboratorio
(immuno) + Diagnostica**, rifiuto ordini + flusso Keriba. 5A+5B+5E
committate+pushate (`e0b9716`); **5C/5D + rifiniture NON ancora committate**. **82 test verdi.**

**5A â€” Pagina Produzione** (`features/produzione/ProduzioneView.tsx`, rotta `/produzione`;
modale date in `DataConsegnaPrevistaModal.tsx`, tipi lotto in `tipiProduzione.ts`):
- Due viste via `SegmentedControl`: **Â«Da produrreÂ»** (stati Nuovo/Confermato, coda con acconto
  incassato in cima) e **Â«In lavorazioneÂ»** (In produzione/Arrivato IT). Card a **tendina**
  (`Paper` + `Collapse`), selezione multipla + barra azioni.
- Backend: `OrdineDto.acconto_incassato`/`data_acconto`/`data_produzione`/`data_arrivo_it` +
  `ordini_avanza_produzione(ids, stato, data)`.

**5B â€” Lotti + catalogo + dati produzione per riga**:
- **Lotti** (`lotto_produzione` Ulid condiviso): Â«Manda in produzioneÂ» crea un lotto; vista Â«In
  lavorazioneÂ» raggruppata per lotto (annulla singolo/lotto, **Unisci/Separa** via
  `lotto_produzione_pre`, badge Â«UnitoÂ», Â«Arrivato ITÂ» per lotto o singolo). Filtro periodo
  (preset + daâ€“a). Backend `produzione_invia`/`produzione_annulla_ordine`/`produzione_lotto_annulla`
  /`_unisci`/`_separa` (+ helper `produzione_disfa_ordine`); `OrdineDto.lottoProduzione`
  /`lottoProduzioneUnito`.
- **Catalogo** entitÃ  **`prodotto_produzione`** (`tipo` âˆˆ formulazione/posologia/allergene/ceppo +
  `valore`, builtin, `ensure_prodotti_produzione` idempotente).
- **Dati produzione per riga** editabili nelle tendine (`RigaProduzione`: `Autocomplete`
  formulazione/posologia + `TagsInput` allergeni/ceppi, salva su `riga_ordine` via `record_update`,
  suggerimenti catalogo + storico).
- **Compilazione produzione OBBLIGATORIA all'invio** (`CompilaProduzioneModal`: elenca i prodotti
  non compilati, bottone disabilitato finchÃ© non completi; helper `datiProduzione.ts`).
- **Rimosso lo stato Â«Parzialmente speditoÂ»** (`stati.ts` + `aggiorna_stato_evasione`): la spedizione
  parziale non cambia stato, solo l'evasione completa â†’ `Spedito`; `STATI_SPEDITI` = {Spedito, Chiuso}.

**5E â€” Rifiuto ordini + Keriba** (campi esito/motivazione/rifiutati del preventivo Keriba).

**5C â€” Export Laboratorio (Immunoterapia)**: `laboratorio_export(lotto, path, base, data_prevista)` +
`export::laboratorio_xlsx` nel formato dei file reali (una riga per riga d'ordine/paziente; acconto
col C â€” saldato se incassato, altrimenti previsto â€” e valore col I solo sulla 1Âª riga dell'ordine,
no doppio conteggio nella somma). **`numero_produzione` (col D)** assegnato e **persistito** alla
prima esportazione (`next = max(esistenti, baseâˆ’1)+1`; ri-esportare non cambia i numeri â†’ idempotente;
`base` = pref locale `numeroProduzioneBase`, solo bootstrap). **Data prevista (col J)**:
non viene piu chiesta al «Manda in produzione»; si imposta da «In lavorazione» sul lotto o sulle
singole righe quando il laboratorio la comunica. L'export manuale suggerisce +25 gg lavorativi se
manca, ma consente di esportare lasciandola vuota. La priorita e `riga_ordine.data_prevista` â†’
fallback storico `ordine.data_prevista_lotto` â†’ eventuale fallback temporaneo di export. Unire lotti
cambia solo il raggruppamento e conserva le date gia presenti su righe/ordini. **Catalogo immuno
rifatto**: i prodotti sono **tipo preparazione Ã— fiale** (Sublinguale/Polimerizzato/Lisato batterico,
7 voci, prezzi = moda dei file reali); gli **allergeni/ceppi si compilano in produzione** (non sono
piÃ¹ prodotti). La semina **rimuove i vecchi prodotti-allergene** builtin preservando gli ordini che
li usavano (copia il nome in `prodotto_nome`, azzera `prodotto_id`, poi elimina).

**5D â€” Diagnostica**: modello riga con `tipo_test` (dicitura: PRICK TEST/INTRADERMO/â€¦, lista
built-in `TIPI_TEST` + storico), `ml`, `codice_laboratorio` (auto-compilato dal catalogo). Listino
**Diagnostica standard Laboratorio** seminato (`ensure_prodotti_diagnostica`, 162 voci con codice).
Export `diagnostica_export(lotto, path)` + `export::diagnostica_xlsx` (blocchi per ordine).
**Export per linea sul lotto**: l'azione Â«EsportaÂ» del lotto raggruppa per linea; lotto misto/unito
immuno+diagnostica â†’ due file con dicitura propria (Laboratorio vs Diagnostica), via la modale globale
`EsportaTabella` (anteprima) con scrittura specializzata (`salvaCustom` â†’ `api.laboratorioExport`
/`diagnosticaExport`).

**Rifiniture Produzione/UI (questo batch)**: card coda con **cliente/medico in primis** + icona
categoria; **Â«Da produrreÂ» raggruppata per data**; **Â«Nuovo ordine DiagnosticaÂ»** solo in Â«Da
produrreÂ», in alto a destra, con proposta di export dopo la compilazione; Â«Manda in produzioneÂ»
propone la generazione della distinta; **Â«Da spedireÂ»** mostra prima gli ordini Â«In produzioneÂ» poi
i confermati, dal piÃ¹ vecchio (per `data_produzione`).

**Rifiniture UI FASE 5** (commit `e0b9716`): **icone categorie prodotto** (`CategoriaProdotto` in
`registri.ts` con `color`+`Ico`: Immunoterapia/blue, Diagnostica/teal, Keriba/grape) usate ovunque;
colonna Linea visibile di default (storage colonne **v6**); Stato/Linea centrati con fallback a
sola-icona **uniforme per colonna** (`ColonneDominioProvider` in `colonne.tsx`); icone nei tab di
Spedizioni e Anagrafiche; **Tabella piÃ¹ compatta** (`horizontalSpacing` xs); anagrafiche a contenuto
(niente grosso riquadro vuoto sotto poche righe).

## FASE 6A â€” Integrazione col sistema (completa, non committata)

Servizio background: istanza singola, traybar, avvio automatico, Xâ†’tray, hotkey globale. I
coordinatori puri e i contratti
frontend/backend sono coperti da test automatici; focus, sospensione WebView e installer reale
restano verificabili soltanto dal vivo.

**Backend** (`Cargo.toml`, `lib.rs`, `commands/mod.rs`, `capabilities/default.json`):
- **Istanza singola** â€” `tauri-plugin-single-instance` registrato **come primo plugin**; il callback
  porta in primo piano la finestra `main` (`mostra_finestra_principale`: show + unminimize + focus).
- **Traybar** â€” `tauri = features ["tray-icon"]`; `costruisci_tray()` crea l'icona id `main` con menu
  **Apri / Esci** (`on_menu_event`) e click sinistro â†’ primo piano (`on_tray_icon_event`). Comando
  **`tray_badge(n)`** aggiorna il tooltip ("N da leggere"), pronto per il conteggio di 6D.
- **Avvio automatico** â€” `tauri-plugin-autostart` (LaunchAgent, arg `--minimized`); in `setup`, se
  l'app Ã¨ avviata con `--minimized` la finestra parte **nascosta nella tray**.
- **Hotkey globale** â€” `tauri-plugin-global-shortcut` (solo init; la registrazione Ã¨ lato JS).
- **Capabilities**: aggiunti `core:window:allow-hide`/`-show`/`-set-focus`/`-unminimize`,
  `autostart:*`, `global-shortcut:*`.

**Frontend** (`package.json`, `lib/prefs.tsx`, `lib/tauri.ts`, `shell/Shell.tsx`, `pages/Impostazioni.tsx`):
- Deps JS `@tauri-apps/plugin-autostart` + `@tauri-apps/plugin-global-shortcut`.
- **Prefs** nuove: `hotkeyGlobale` (default `"Alt+P"`), `avvisoTrayMostrato` (avviso Xâ†’tray una volta).
- **`Shell.tsx`**: registra la **hotkey globale** (handler su `state === "Pressed"` â†’ show +
  unminimize + focus + apre la palette; toast se la combo Ã¨ in conflitto; in app resta **Ctrl+K**).
- **`main.tsx` (`Root`)**: possiede l'unico `onCloseRequested` della main. Con autostart attivo la
  **X nasconde sempre** la finestra (`win.hide()`), anche durante bootstrap, riconnessione o
  ripristino; senza autostart conferma gli eventuali pannelli visibili e poi chiude tutte le finestre.
- **Impostazioni â†’ Sistema**: Switch **Â«Avvia con WindowsÂ»** (autostart enable/disable/isEnabled) +
  Select **Â«Scorciatoia di ricerca globaleÂ»** (preset: Alt+P / Alt+G / Ctrl+Alt+P / Ctrl+Alt+K /
  Ctrl+Alt+Spazio) + spiegazione del comportamento Xâ†’tray.
- **Scorciatoia desktop ricerca**: Impostazioni consente di creare/rimuovere `Ricerca PharmaTek.lnk`;
  il collegamento avvia l'eseguibile con `--spotlight`, quindi apre solo la finestra di ricerca
  globale senza portare in primo piano la finestra principale.
- **Spotlight ampliato**: la finestra `?spotlight` include comandi rapidi per messaggi,
  promemoria, notifiche, Cestino, aggiornamenti/novita/Flappy Livio, import/export Aruba, pulizia
  dati e filtri smart per pagamenti, spedizioni, distinte, provvigioni, rimborsi e Laboratorio.
- **Controllo remoto multi-finestra**: `remoteControl.ts` mantiene la cadenza degli aggiornamenti
  (6 ore) ma propaga via evento locale Tauri `pt:controllo-remoto-cambiato` lo stato appena letto.
  Quando `disabled=true`, solo `main` resta visibile con il blocco remoto; tutte le altre finestre
  Tauri vengono distrutte. Il ritorno attivo non sblocca automaticamente: serve **Riprova**, che
  rifa bootstrap se necessario e ricrea solo l'overlay tecnico notifiche.
- **Invalidazione sessione multi-finestra**: `app_bootstrap`, quando riceve
  `reconnect_required=true`, distrugge tutte le finestre eccetto `main`, chiama
  `Notificatore::disattiva_sessione` e invalida Spotlight. `App.tsx` mostra
  **Sessione non più disponibile → Ricollega**; il marker locale è versionato per sopravvivere a un
  rilancio senza confondersi con i reset volontari. Durante `reconnect`/`onboarding` gli eventi
  `pt:data-wiped` non cambiano fase. Il normale ingresso in `pronto` riconfigura notifiche e ricrea
  overlay/Spotlight.
- **Bootstrap e ritorno in primo piano**: il `Root` della main è l'unico coordinatore di bootstrap,
  polling incrementale, focus e ritorno dalla tray. `App` gestisce `pt:data-wiped` solo quando la UI
  è realmente montata; una guardia condivisa impedisce ricostruzioni concorrenti e i listener
  asincroni vengono rimossi correttamente anche nel replay di React StrictMode. Spotlight viene
  aperto soltanto con identità, cartella dati e proiezione utilizzabili e senza restore pendente. La
  richiesta `--spotlight` attende la promise del bootstrap corrente, senza invocarne uno parallelo.
  Un processo nato con `--minimized` completa anche il mount della Shell in background, mantiene la
  finestra Tauri nascosta e sopprime intro/transizioni iniziali; il fallback focus continua a
  verificare `isVisible()` nativo prima di trattare un evento come reveal reale.
- **Ritiro device**: sotto lock esegue ingest, emette `device_retired`, elimina il device e, se il
  profilo non è usato da altri device attivi, anche profilo e stati utente; salva lo snapshot
  finale, crea il backup prima della rimozione fisica, quindi elimina quando opportuno l'avatar,
  oltre a log/conflicted-copy e snapshot del device, e scrive il marker di rebuild.
  `open_data_dir` e `finish_onboarding` ricontrollano la barriera dopo l'ingest: un marker arrivato
  durante l'onboarding ruota il `deviceId` e riapre il runtime prima di qualsiasi registrazione.
  La modalità `use` applica `Restored` a profilo e device per convergere anche se la cancellazione
  è arrivata fra la lista utenti e la conferma. Se più device condividono lo stesso profilo, il
  ritiro di uno non scollega gli altri.
- **Panoramica device**: gli id visualizzati derivano soltanto dai record `device` attivi; i
  watermark HLC forniscono esclusivamente `last_ms`. Questo evita postazioni fantasma nominate con
  l'ULID quando OneDrive ripresenta un autore orfano. I marker `device_retired` escludono inoltre
  device e lock operativi riconsegnati in ritardo. La panoramica e `force_sync` non convertono
  automaticamente un watermark orfano in `device_retired` e non eliminano file: un device può
  essere transitoriamente privo di record durante un onboarding concorrente, quindi la pulizia
  retroattiva deve restare un'azione esplicita.
- **Controllo aggiornamenti + kill switch**: il pulsante manuale in Info e i controlli silenziosi
  main/overlay interrogano prima il controllo remoto. L'updater resta disponibile anche durante
  onboarding/ricollegamento; un heartbeat nativo risveglia l'overlay tecnico quando il WebView
  nascosto è sospeso. Un mutex nativo serializza preparazione e installazione: gli aggiornamenti
  manuali riaprono la main, quelli automatici ripartono minimizzati e qualunque attività utente
  promuove l'intenzione a riavvio visibile. Se il check remoto fallisce viene ignorato; se risponde
  disattivato, il controllo aggiornamenti non prosegue.

**âš ï¸� Da verificare dal vivo**: tray, istanza singola, autostart e hotkey globale **non sono
testabili headless** (come la finestra ordine separata). Provare: doppio avvio, X con autostart
on/off, Alt+P da un'altra app, menu della tray.

## Scostamenti principali dal piano/spec (decisi con l'utente)

- **Utenti e dispositivi = eventi** (non file `meta/*.json` riscritti): conflict-free; l'ultima
  attività dei dispositivi è derivata gratis dagli eventi. Avatar foto restano file binari.
- **Proiezione generica** (non tabelle tipizzate per entitÃ ): piÃ¹ flessibile; le query ricche sono
  comandi dedicati (`ordini_lista`, `prezzo_suggerito`).
- **Onboarding cartella-prima** (per il check duplicati live).
- **Editor ordine: modale di default** per il nuovo (la finestra separata Ã¨ lenta), **finestra** per
  apri/modifica; configurabile in Impostazioni.
- **Niente corriere/colli/peso nell'ordine**: si scelgono dopo, in spedizione bulk (FASE 4).
- **Acconto auto** dalla preferenza del medico (`acconto_default`/prodotto, default 90â‚¬, capped al
  totale, editabile). Rimossi i campi separati Acconto/Saldo.
- **Regola prezzo per categoria rimossa dalla UI** (ridondante col prezzo base).
- **Stati ordine ancora manuali** (l'automazione richiede contabilitÃ /spedizioni â†’ FUTURO).
- **Maturazione provvigioni per-agente** (non impostazione globale `meta/config.json` come da
  piano FASE-2): default "alla spedizione", alternativa "a ordine chiuso". Il "saldo completo"
  del piano richiede la contabilitÃ  (FASE 3) â†’ si aggancerÃ  allora.
- **Presence ordine rimossa**: il vecchio heartbeat "in modifica" scriveva eventi tecnici ogni pochi
  secondi senza bloccare davvero altri utenti. La coerenza resta affidata al sync degli eventi reali.

---

## Test, build, esecuzione

- **Test Rust**: `cargo test --lib --manifest-path src-tauri/Cargo.toml` copre (HLC, log,
  fold/LWW, snapshot, concorrenza/recovery/conflicted-copy, onboarding, CRUD, reset leggero/ritiro PC/reset completo,
  prezzo, numerazione, pricing, **provvigioni**, + 2 **stress test concorrenza** (convergenza
  multi-thread con oracolo LWW e file-watch reale), + **compattazione fase 1+2** (offset nello
  snapshot, bootstrap solo-coda, conflicted-copy post-snapshot, retention snapshot, snapshot al
  backup, compatibilità con log legacy troncati e nessuna perdita su nuovo PC)),
  + **protocollo restore multi-postazione** (marker/manifest riordinati, payload parziale, anchor
  mancante, prefisso corrotto, log cresciuto, log estraneo pre/post-commit, snapshot vecchio consegnato
  in ritardo, ingest congelato durante `waiting`, perdita successiva di SQLite, manifest v1 stale,
  riavvio durante la consegna e retry). È stato inoltre eseguito un collaudo distruttivo manuale sulla
  cartella configurata: backup/ripristino reale, consegna file progressiva, prefisso corrotto, log stale,
  arresto/riavvio minimized e reveal finale, con ripristino byte-per-byte dello stato iniziale,
  + **pagamenti FASE 3A** (`pagamenti_stato_verifica_e_automazione`)
  + **pagamenti unificati FASE 3B** (`pagamenti_attesi_saldo_e_rateizza`)
  + **overpayment** (`pagamento_overpayment_saldato_e_pulizia_attesi`)
  + **distinte corrieri FASE 3C** (`distinte_corriere_accredito`)
  + **credito potenziale/atteso + rifiutati esclusi** (`crediti_stato_ordine_e_rifiutato_escluso`)
  + **rimborsi FASE 3D** (`rimborsi_richiesto_effettuato_e_extra`)
  + **distinta salda attesi + importo personalizzato** (`distinta_salda_attesi_e_importo_personalizzato`)
  + **automazione "Chiuso" FASE 3E** (`ordini_auto_chiudi_spedito_saldato_20gg`)
  + **spedizioni/lotti FASE 4** (evasione riga, distinte, unione/separazione lotti, marcatori)
  + **produzione FASE 5** (`produzione_lotti_invio_annulla_unisci_separa`,
  `catalogo_produzione_seminato_e_idempotente`, evasione completaâ†’Spedito)
  + **export Laboratorio 5C** (`laboratorio_export_assegna_numeri_e_somma_acconti` â€” numerazione `numero_produzione`
  progressiva+idempotente, somma acconti, **data prevista persistita sul lotto**)
  + **catalogo immuno 5C** (`anagrafiche_default_seminate_e_idempotenti` esteso: 7 prodotti tipoÃ—fiale,
  `Polimerizzato 2 fiale`=400â‚¬; + Diagnostica `A-004`=Acarus siro, â‰¥100 voci) e
  `seed_rimuove_vecchi_prodotti_immuno_preservando_ordini`
  + **export Diagnostica 5D** (`diagnostica_export_blocchi_per_ordine`, `diagnostica_destinatario_e_il_medico`)
  + **linee per categoria su ordine misto** (`ordini_lista_espone_le_linee_per_categoria`).
  â†’ **82 verdi** (FASE 6A non aggiunge test: Ã¨ integrazione di sistema).
- **Frontend**: `npx tsc --noEmit` e `npm run build`.
- **App**: `npm run app:dev` (dev) / `npm run app:build`. Script PS in `scripts/`.
  `scripts/test.ps1` prova `cargo test`; se l'harness Rust/Tauri non parte su Windows con
  `STATUS_ENTRYPOINT_NOT_FOUND`, fa fallback a `cargo test --no-run` e prosegue solo se la
  compilazione dei test e `clippy -D warnings` restano puliti.

âš ï¸� **Non verificati dal vivo dall'agente** (l'automazione schermo non aggancia la dev-window):
finestra ordine separata; flusso multi-finestra spedizioni/lotti; e l'**integrazione di
sistema FASE 6A** (tray, istanza singola, autostart, hotkey globale). Build/typecheck/test ok, ma
vanno provati a mano.

---

## Ottimizzazioni UI (Virtualizzazione e Responsività)

- **Cluster Virtualization Espansa**: Implementato il componente VirtualCard basato su useIntersection e ResizeObserver per virtualizzare liste pesanti contenenti tabelle annidate (es. ProvvigioniView). Mantiene 60fps preservando la dimensione calcolata in tempo reale per non corrompere la barra di scorrimento.
- **Dashboard e Contabilità leggere**: la Dashboard usa `dashboard_pannelli` per caricare solo le 6 righe operative necessarie (ultimi ordini/scaduti) e accorpa gli eventi realtime ravvicinati; Distinte e Rimborsi applicano debounce realtime, memoizzazione della tabella e filtri più economici. Le Distinte calcolano ora il totale sulle righe effettivamente filtrate/visualizzate.
- **Dashboard first-load coerente**: al primo avvio la dashboard resta sulla schermata unificata finché statistiche e pannelli sono pronti; non monta più la cornice vuota tra "Carico il gestionale" e "Preparo la tua dashboard", così l'entrata iniziale mostra direttamente i componenti reali.
- **Popover pesanti virtualizzati**: Cestino e Notifiche mantengono la stessa grafica delle righe, ma sopra soglia montano solo gli elementi visibili tramite `VirtualStack` (ScrollArea + ResizeObserver). La stessa ottimizzazione vale anche per le finestre Cestino/Notifiche perché riusano gli stessi componenti.
- **Virtualizzazione condivisa**: `VirtualStack` e `VirtualFlow` riusano gli stessi calcoli di layout,
  range, overscan e altezze misurate da `ui/virtualizzazione.ts`; cambiano soltanto il contenitore di
  scroll e il relativo sistema di coordinate.
- **Colonne compatte condivise**: Giornaliero e Provvigioni usano `useCompactColumnObserver` per
  confrontare la cella con il ghost di misura, mantenendo un solo debounce e le stesse soglie.
- **Finestre secondarie**: apertura, ripristino in primo piano, query identità, esito di creazione,
  chiusura ed eventi best-effort sono centralizzati in `lib/finestreTauri.ts`.
- **Drag finestre fluido**: `lib/geometriaFinestre` non ascolta più `onMoved` a raffica durante il trascinamento; dimensione e posizione vengono salvate tramite campionamento leggero, resize stabilizzato e flush a chiusura. La geometria ricordata resta invariata per l'utente, ma il renderer non viene saturato mentre si sposta la finestra.
- **Default finestre secondarie**: le finestre Ordine, Dettaglio pagamento e Promemoria partono più compatte alla prima apertura, ma la geometria scelta dall'utente resta prioritaria e viene riusata nelle aperture successive.
- **Modali/finestre form adattive**: i form principali usano shell condivisa con titolo e footer azioni sempre visibili, corpo interno scrollabile e validazione che porta il focus sul primo campo obbligatorio mancante senza scrollare la view sottostante.
- **Modali con liste pesanti**: pagamento/storico provvigioni e nuova/dettaglio distinta usano il componente `Tabella` custom con altezza contenuto/max (`modalTableHeight`), così restano compatti e scrollano verticalmente solo quando serve. I modali a contenuto libero (crea spedizione, data spedizione prevista / invio in produzione) mantengono lo scroll unico del corpo modale ma montano solo le card/righe vicine al viewport tramite `VirtualFlow`, evitando nested scroll non desiderati e il mount massivo dei controlli.
- **Salvataggi concorrenti dei form**: ordine, pagamento, anagrafiche e produzione inviano patch per campo. Nessuna revisione globale blocca il form: sullo stesso campo vince l'ultimo salvataggio, mentre i campi remoti non toccati vengono conservati. Non vengono mostrati banner di “campo modificato altrove”.
- **Distinte corriere anti-concorrenza**: la creazione invia al backend una fotografia dei pagamenti selezionati (`pagamentiAttesi`); `distinta_crea` valida fotografia, conto, ordine e collegamento precedente e costruisce distinta + collegamento/incasso dei pagamenti in un unico `emit_built_checked`. Un pagamento collegato è protetto anche dal CRUD generico e si apre in sola lettura finché la distinta non viene eliminata.
- **Spedizioni anti-concorrenza**: `spedizione_crea` valida corriere, ordini e righe e appende spedizione + marcatura delle righe nello stesso batch protetto. Una riga già spedita non può quindi essere riutilizzata da un secondo comando arrivato nello stesso processo.
- **Rateizzazione atomica**: residuo corrente, esclusione delle quote già saldate e sostituzione/creazione delle rate vengono calcolati dalla stessa proiezione protetta e appesi in un solo batch. Le rate saldate restano immutabili.
- **Container Queries**: Applicate alla Topbar per collassare dinamicamente il titolo solo quando lo spazio reale si riduce sotto la soglia utile, evitando breakpoint CSS statici.
- **Flexbox Auto-Scroll**: Corretto il contenitore root della Shell garantendo il riempimento orizzontale e verticale tramite minHeight: 0, ripristinando il corretto overflow delle tabelle.

---

## FASE 11 — Comunicazioni multicanale (completata, 23 luglio 2026)

- Nuovo modulo Rust `app/communication.rs`: canali e stati tipizzati, normalizzazione e-mail/
  WhatsApp, validazione di corpo e metadati allegato, fingerprint SHA-256 e id deterministico
  derivato dalla chiave di idempotenza.
- Entità `comunicazione` durevole nel **motore eventi locale della postazione**, sotto
  `%APPDATA%`: ripetere la stessa richiesta restituisce la stessa bozza; riusare la chiave con un
  payload diverso viene rifiutato. Il registro locale conserva anche errori, ricevute e cronologia
  e non usa la cartella OneDrive.
- Transizioni sicure `bozza → in_coda → in_invio → invio_azionato/fallito`; un record positivo
  (`invio_azionato`/`consegna_verificata`) non può rientrare in coda come retry.
- Comandi Tauri piccoli e tipizzati: `comunicazione_crea_bozza`, `comunicazioni_lista`,
  `comunicazione_metti_in_coda`, gestione campagne, retry/reinvio e annullamento.
- Coordinatore volutamente locale e minimale: la bozza fotografa utente e dispositivo d'origine;
  ogni PC crea ed esegue soltanto i propri invii. Coda, campagna, tentativo, contenuto, errore,
  ricevuta ed esito restano eventi locali e non entrano in log, snapshot o backup condivisi.
  Non servono servizio centrale, lease o file-lock aggiuntivi.
- Prima di SMTP il PC d'origine esegue un giro di ingest e serializza gli invii del proprio
  processo. Dopo l'accettazione conserva localmente data, riferimento, copia IMAP ed eventuale
  avviso. Sull'eventuale entità sorgente condivisa aggiorna soltanto indicatori compatti, per
  esempio data/canale/fingerprint dell'ultimo preventivo inviato: mai corpo, recapito, ricevuta o
  cronologia. Un timeout/errore dopo l'avvio SMTP è marcato `esitoAmbiguo` e non è riaccodabile
  automaticamente.
- Un solo worker leggero per processo controlla ogni cinque secondi la comunicazione locale più
  vecchia, condividendo lo stesso ordine tra e-mail e WhatsApp. Al riavvio riprende gli elementi
  ancora `in_coda`. Un elemento rimasto `in_invio` dopo un arresto viene invece marcato con esito
  ambiguo senza essere ritentato automaticamente.
- Gli errori generano un toast persistente nella finestra principale. Un errore certo prima di
  SMTP espone **Riprova**; un timeout o esito esterno incerto espone **Controlla e reinvia**,
  richiede conferma e crea una nuova comunicazione collegata, senza alterare l'originale.
- Contratti TypeScript corrispondenti in `lib/tauriTypes.ts` e `lib/tauri.ts`.
- Gate premium applicato ai comandi specializzati; le entità FASE 11 sono vietate al CRUD generico
  anche su un PC abilitato, così un frontend alternativo non può aggirare validazioni e stati.
- Adattatore finto isolato per distinguere `invio_azionato` da `consegna_verificata`.
- Configurazione condivisa `configurazione_canale/email` salvata come payload atomico: preset Aruba
  `smtp.example.invalid:465` e `imap.example.invalid:993` SSL/TLS, mittente e nome modificabili, Reply-To
  opzionale e copia in Posta inviata abilitata per impostazione predefinita.
- Password SMTP conservata esclusivamente nel Gestore credenziali di Windows dell'utente locale
  (`CRED_TYPE_GENERIC`, persistenza macchina); non entra in eventi, proiezione, backup o DTO.
- Prova e-mail controllata verso l'indirizzo configurato: SMTP viene eseguito una sola volta;
  soltanto dopo l'accettazione si tenta `APPEND` IMAP della stessa MIME nella cartella con attributo
  `\Sent` o nome noto. Un errore IMAP produce «inviata, copia non archiviata» e non ripete SMTP.
- Prima superficie approvata implementata in Impostazioni, nascosta integralmente senza premium:
  tre card e modale e-mail guidato, corpo scrollabile con footer fermo, preset avanzati
  modificabili e pulsante primario **Verifica e invia prova**.
- Destinatario prova predefinito `demo@example.invalid`; Reply-To proposto
  `demo@example.invalid` ma applicato soltanto attivando l'interruttore.
- Quattro modelli base condivisi e versionati, limitati agli eventi operativi presenti:
  preventivo, sollecito preventivo, sollecito pagamento e preavviso spedizione. Ogni modello ha
  un solo corpo per e-mail e WhatsApp; l'oggetto viene usato soltanto per l'e-mail. Si possono
  aggiungere e rimuovere modelli personalizzati, mentre i modelli base restano protetti.
- Le variabili sono validate, il payload corrente è atomico e lo storico è immutabile. Le
  istruzioni di pagamento sono generate dai conti correnti e distinguono bonifico/IBAN,
  contrassegno, assegno e rate; gli stessi contenuti non generano versioni duplicate.
- Compositore unico per e-mail, WhatsApp o entrambi: abilita i canali soltanto quando il
  destinatario dispone di un recapito valido, applica lo stesso modello ai canali scelti e
  impedisce l'invio
  finché restano dati da completare.
- Azioni contestuali in Anagrafiche, Crediti e Spedizioni; la selezione di più spedizioni apre una
  revisione virtualizzata che mostra destinatari pronti ed esclusi prima di preparare gli invii.
- I solleciti raggruppano le rate scadute dello stesso ordine; l'azione multipla usa i filtri
  correnti dei Crediti, aggrega per cliente e fotografa versioni, importi e recapiti. Se un dato
  cambia durante la revisione, la preparazione si ferma e richiede di rigenerare l'anteprima.
- La revisione dei solleciti può posticipare le scadenze di sette giorni mostrando prima vecchie
  e nuove date e totale interessato. La mutazione è atomica e idempotente per campagna: un retry
  non aggiunge altri sette giorni.
- Centro comunicazioni: ricerca, filtri per stato, lista virtualizzata, annullamento, riprova e
  reinvio controllato. Dalla topbar resta un drawer; dall'icona Cronologia nelle Impostazioni si
  apre come modale; da Spotlight usa una finestra Tauri separata senza navigare la main. La
  finestra rientra nei pannelli utente chiusi dall'uscita completa dell'app. Il contenuto mostrato
  è esclusivamente quello della postazione corrente.
- Gli snapshot condivisi, gli anchor di ripristino e quelli generazionali filtrano sempre
  l'entità `comunicazione`; backup e pulizia dati aziendali non includono né cancellano la
  cronologia locale. Una ricostruzione della proiezione condivisa la conserva, mentre
  **Riconfigura questo PC**, ritiro della postazione e reset completo eliminano l'intera
  `app_data_dir` e quindi anche il registro comunicazioni locale.
- Gli errori di comunicazione alimentano campanella e overlay dalla lista locale e dall'evento
  Tauri `pt:comunicazione-stato-locale`. Letto/scartato è memorizzato nel `localStorage` per
  utente/postazione e non crea record `notifica_letta` condivisi.
- Le campagne non introducono un coordinatore distinto: gli elementi condividono `campagna_id` e
  possono essere sospesi, ripresi o interrotti in batch **sulla stessa postazione**. Il Centro
  mostra avanzamento e comandi;
  il worker del PC d'origine ignora gli elementi `sospeso`. Un errore non blocca i destinatari
  successivi: terminato il primo giro, **Riprova falliti** rimette in coda soltanto gli errori
  certi; gli esiti ambigui richiedono sempre il reinvio esplicito. L'interruzione conserva gli
  invii già riusciti, marca come `annullato` il resto e mostra separatamente i conteggi inviati,
  annullati ed errori sia nella notifica sia nel Centro comunicazioni. **Riprendi mancanti**
  riporta in coda soltanto gli elementi annullati senza errori e appartenenti al PC d'origine;
  positivi ed eventuali esiti ambigui non vengono mai duplicati.
- WhatsApp Windows è automatico e sequenziale: apre la conversazione col protocollo dell'app,
  poi usa Windows UI Automation senza coordinate per **sostituire** l'eventuale bozza col corpo
  richiesto. La sostituzione rende idempotente un retry e impedisce di accodare due volte lo
  stesso testo. Preme **Invia** soltanto dopo aver verificato corpo esatto e relazione geometrica
  fra compositore e pulsante; conferma inoltre che la bozza sia stata consumata. Il controllo non
  dipende dal nome con cui il numero è salvato in WhatsApp, quindi gestisce anche clienti distinti
  con lo stesso recapito. Prima di usare `SendInput` ripristina e verifica sia la finestra WhatsApp
  in primo piano sia il focus del compositore; le ricerche UIA dei pulsanti sono ristrette ai soli
  nomi Invia/messaggio vocale per evitare scansioni lente dell'intera WebView. Registra
  `invio_azionato`, non dichiara la consegna e, se un destinatario fallisce, prosegue con quelli
  successivi.
- Spotlight espone **Centro comunicazioni** in finestra autonoma e il comando
  `comunica <cliente>` soltanto sui PC con accesso premium.
- Collaudi reali completati sulla casella Aruba e sulla conversazione WhatsApp autorizzata. Le
  suite automatiche ordinarie non contengono test ignorati o comandi che producano invii esterni.

---

## FASE 12 — Preventivi, scheda cliente e documenti intelligenti (completata, 27 luglio 2026)

- Nuovo dominio Rust `app/preventivi.rs` con entità deterministiche `preventivo/{ordine_id}` e
  `scheda_cliente/{ordine_id}`, alias espliciti e configurazione documenti condivisa.
- Creazione limitata agli ordini `Nuovo`; il preventivo resta consultabile dopo un cambio stato
  ma non introduce stati commerciali e non modifica mai automaticamente quello dell'ordine.
- Salvataggio atomico: revisione di preventivo, ordine, righe e pagamenti verificata prima di
  aggiornare righe, totali, metadati e scadenzario aperto nello stesso batch.
- Fingerprint semantico corrente, fotografia protetta dell'ultimo invio e indicazione derivata
  `mai_inviato / inviato / modificato`; messaggi in coda, falliti o ambigui non avanzano
  `ultimo_invio`.
- Parser locale puro in `features/preventivi/parserPreventivo.ts`: normalizzazione Unicode,
  quantità e importi italiani, segmentazione multi-riga, distanza Damerau-Levenshtein, trigrammi,
  token caratteristici, linea ordine, storico e alias. Le ambiguità espongono alternative,
  motivazione e confidenza e non vengono applicate silenziosamente.
- Risoluzione prezzi condivisa in batch e possibilità di salvare un alias soltanto dopo una
  scelta esplicita.
- Pagina Preventivi lazy disponibile fra Giornaliero e Produzione, costruita con `Pagina`,
  `Tabella`, filtri e menu esistenti. Comprende ricerca, filtri per linea/invio, editor, anteprima,
  stampa, PDF, PNG, invio, sollecito e accesso alla scheda cliente.
- Renderer A4 vettoriale unico in `rendererDocumenti.ts`: lo stesso albero produce anteprima SVG,
  PDF a pagina singola, PNG e stampa. Wrapping e controllo overflow impediscono tagli
  silenziosi; il segno di spunta della scheda è vettoriale e non dipende da font Unicode.
- Scheda cliente separata, precompilata da ordine, anagrafiche, pagamenti e comunicazioni.
  Integrata nei due menu del Giornaliero, nell'editor ordine e nel menu preventivo. Il nuovo ordine
  mostra **Salva e stampa** a tutti; apertura, modifica, salvataggio e stampa della scheda cliente
  sono gratuite.
- Configurazione condivisa di denominazione, recapiti, validità e condizioni predefinite in
  Impostazioni → E-mail e comunicazioni. Il payload è atomico, revisionato e protetto.
- Integrazione completa col motore FASE 11: PDF MIME per e-mail, PNG per WhatsApp Windows,
  revisione prima dell'invio, campagne solleciti con soglia configurabile e aggiornamento
  dell'ultimo invio soltanto dopo esito positivo.
- Cache allegati esclusivamente locale con riferimenti `pt-cache://sha256.ext`, verifica di firma,
  hash e dimensione, rimozione dopo lo stato terminale e cleanup TTL. Nessun binario o percorso
  assoluto entra nel log, negli snapshot, nei backup o nella cartella OneDrive.
- Gate premium applicato alle azioni di invio, sollecito e stampa/esportazione del preventivo;
  `preventivo`, `scheda_cliente`, `alias_preventivo` e `configurazione_documenti` restano
  inaccessibili tramite CRUD generico. Le letture e il salvataggio condiviso dei preventivi e della
  scheda cliente sono gratuiti; salvataggio configurazione/alias e salvataggio file del preventivo
  restano protetti anche nei comandi Rust.
- Verifica completata con suite frontend e Rust, build di produzione, Clippy `-D warnings` e
  rendering visivo dei due PDF A4 single-page. Gli unici test esclusi richiedono deliberatamente
  un invio reale nell'app WhatsApp autorizzata.

---

## FASE 13 — Bollettazione automatica dai file del laboratorio (completata, 1 agosto 2026)

- Parser Rust locale per più file `.xlsx`, con scoperta delle colonne per intestazione, supporto
  dei tracciati `FechaPedido` e `Fecha Envío`, continuazione sugli altri file in caso di errore e
  conservazione testuale di `Referencia`.
- Normalizzazione deterministica di BELTAVAC, BELTAORAL e VEB sui prodotti Immunoterapia già
  presenti; formulazione, posologia, allergeni e alias convergono sui campi e cataloghi esistenti
  senza creare anagrafiche o prodotti.
- Matching spiegabile con pesi paziente/cliente, medico, prodotto e dettagli, alternative
  ordinate e assegnazione globale uno-a-uno. Duplicati, riferimenti già registrati, quantità
  incompatibili e conflitti bloccanti sono classificati prima di qualsiasi scrittura.
- Modale `BollettazioneReviewModal` con i gruppi Pronti/Da controllare/Non trovati/Già registrati,
  ricerca manuale, scelta Gestionale/Excel, righe saltate e azioni **Segna come arrivati** e
  **Prepara spedizione**.
- Il flusso di arrivo usa lo stesso calcolo dello stato Produzione; il flusso di spedizione
  richiama la stessa funzione di validazione e generazione mutazioni usata da `spedizione_crea`.
  Revisione delle righe e degli ordini, aggiornamenti, colli e ricalcoli successivi sono protetti
  da un unico batch tutto-o-niente.
- Accesso Premium verificato prima di leggere i file e prima di confermare. Il pulsante resta
  visibile col paywall, non entra nella pill sticky e il comando Spotlight compare soltanto con
  Premium attivo.
- I tre campioni reali sono stati verificati in sola lettura fuori dal repository: 40 e 14 righe
  per i file recenti, 108 per lo storico. Test automatici e fixture non contengono nomi o dati
  sanitari reali.

---

## FASE 14 — Suggerimenti intelligenti e azionabili (completata, 1 agosto 2026; revisionata settembre 2026)

- Nuovo motore derivato `app/suggestions.rs`: produce card raggruppate per rimborsi aperti (soglia default 3gg),
  distinte da accreditare (soglia default 20gg), provvigioni maturate (soglia default 7gg, disattivata di default),
  lotti pronti (soglia default 3gg), spedizioni da comunicare (soglia default 3gg, finestra 14gg) e
  preventivi da inviare o sollecitare (soglia default 7gg, disattivata di default, ordini `Nuovo` senza marcatori),
  senza creare una seconda coda operativa.
- Ranking deterministico e identificativi firmati sulla fotografia minima delle sorgenti. Il
  completamento fa sparire la card; una modifica sostanziale ne genera una nuova.
- Lo stato persistente delle fotografie ignorate è `suggerimento_stato`; «Ignora tutte» scrive
  più stati con un solo batch e converge fra PC. Categorie, notifiche e cadenza di notifica vivono
  invece esclusivamente nelle preferenze locali del PC e vengono condivisi soltanto fra le sue
  finestre.
- Riuso diretto di `contrassegni_dto`, `provvigioni_report`, `linee_ordini` e `classificaSollecitiPreventivi`: nessuna replica delle regole contabili, produttive o commerciali.
- `SuggerimentiPanel` nella Dashboard con massimo cinque card compatte, espansione misurata
  senza scatti, virtualizzazione della coda, «Ignora tutte», pulsante «Controlla ora» (forza ricalcolo immediato della fotografia),
  impostazioni locali con cadenza configurabile per categoria (0–90 gg, con pulsante «Ripristina predefiniti»), deep-link contestuali (incluso `solleciti_preventivi`) e animazioni compatibili con **Riduci animazioni**.
- La soglia operativa dei preventivi resta unica in `preferenzeSuggerimenti.giorniAvviso.preventivo`, ma è esposta anche nelle Impostazioni generali tramite `giorniSollecitoPreventivi`: il provider aggiorna e persiste contemporaneamente entrambi i formati per compatibilità con la pagina Preventivi e con le installazioni senza funzioni premium.
- Dopo il salvataggio riuscito del preventivo in PDF o PNG viene richiesta la conferma per marcare l'invio manuale (`preventivo_marca_inviato_manuale` con canale `"manuale"`). Stampa, Escape, annullamento del dialog o del selettore file non alterano lo stato.
- L'intera FASE 14 è protetta dal gate Premium prima di UI, API e report. Gli avvisi di
  spedizione e preventivo usano un fingerprint condiviso unico fra elenchi, suggerimenti
  e comunicazioni. Dopo un invio multiplo riuscito, tutte le spedizioni correlate ricevono il
  proprio marcatore; coda e cronologia continuano a essere locali al PC d'origine.
- I suggerimenti non compaiono nella lista della campanella (riservata a promemoria, scadenze e messaggi), ma attivano l'overlay custom con durata impostata a 5 minuti (300.000 ms).
- L'emissione della notifica custom persiste lo stato su tabella SQLite locale non replicata (`local_notifiche_avvisate` con chiave `suggerimento:<anno>:<tipo>`), garantendo che al riavvio dell'app la notifica non si ripeta prima che sia trascorsa la cadenza in giorni configurata per quella specifica categoria, senza generare traffico di eventi sul log OneDrive. Nella Dashboard le azioni abilitate rimangono sempre consultabili. Una rivalidazione di 60 secondi impedisce pop-up immediati durante transazioni in assestamento.
- Deep-link fino a filtri Contabilità/Produzione e al selettore solleciti Preventivi, senza nuove pagine o modali parallele.
- Test automatici su fingerprint, ranking, deduplicazione frontend, classificazione preventivi e invio multiplo; verifica
  finale con suite complete, typecheck, build, formattazione e Clippy `-D warnings`.
