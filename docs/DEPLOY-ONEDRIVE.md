# Deploy & configurazione OneDrive

Guida operativa per far girare il gestionale su più PC tramite una cartella OneDrive
condivisa, senza server.

## 1. Cartella condivisa

1. Su un account OneDrive, creare una cartella `PharmaTek-Data`.
2. Condividerla con gli account/PC che useranno il gestionale (permessi di modifica).
3. Su **ogni** PC, accettare la condivisione e aggiungerla al proprio OneDrive così da
   averla sincronizzata localmente.

La struttura interna (creata dall'app) sarà:

```
PharmaTek-Data/
  events/      un file .ndjson per ogni PC (append-only; ogni PC scrive SOLO il proprio)
  snapshots/   compattazioni periodiche (un file per PC)
  meta/        avatars/ (foto utente); utenti e dispositivi sono eventi, non file json
  backups/     zip di backup (un file per PC)
```

`config.json`, `projection.sqlite`, `communication-outbox/` e
`communication-outbox.sqlite` **non** stanno qui: vivono nella `app_data_dir` Tauri
(`%APPDATA%\it.pharmatek.gestionale\` su Windows), locale al singolo PC (vedi §2 e §7). Gli ultimi
due contengono coda e intera cronologia del Centro comunicazioni e non vengono sincronizzati.

## 2. "Mantieni sempre su questo dispositivo" (importante)

Per evitare che OneDrive tenga i file solo nel cloud (Files On-Demand) — cosa che
impedirebbe la lettura/osservazione immediata — su ogni PC:

1. Aprire Esplora File → tasto destro sulla cartella `PharmaTek-Data`.
2. Selezionare **"Mantieni sempre su questo dispositivo"**.

## 3. Ora di sistema

Il motore usa un Hybrid Logical Clock, ma è bene che l'orologio dei PC sia
sincronizzato (impostazione Windows: *Data e ora → Sincronizza ora*). Riduce i casi di
ordinamento ambiguo tra eventi quasi simultanei.

## 4. Primo avvio dell'app (e aggiunta di un nuovo PC)

Al primo avvio l'app guida l'onboarding, **cartella per prima**:

1. **Percorso** della cartella `PharmaTek-Data` sincronizzata localmente.
2. **Utente**: si sceglie un utente già esistente (la lista è letta dai dati condivisi) o se
   ne crea uno nuovo; poi avatar e riepilogo.

Genera inoltre un `deviceId` persistente (salvato nella `app_data_dir` Tauri). La proiezione
locale SQLite vive nella stessa cartella locale, **mai** dentro OneDrive.

**Da dove prende i dati un nuovo PC.** Appena selezioni la cartella, il motore apre una
proiezione SQLite **vuota** in locale, carica l'eventuale snapshot più recente e poi **rilegge
tutti i file `events/*.ndjson` di tutti i PC** ricostruendo l'intero stato (anagrafiche,
ordini, listino, provvigioni, utenti…). I log append-only sono lo storico completo: il nuovo
Pc rigenera **tutto** da lì, non serve copiare altro. Il SQLite locale è solo una cache
derivata, mai sincronizzata fra PC.

Fa eccezione il Centro comunicazioni: un nuovo PC non riceve bozze, campagne, messaggi, errori o
cronologia delle altre postazioni. Vede soltanto le comunicazioni che creerà localmente e gli
eventuali indicatori sintetici già presenti sui record aziendali condivisi.

### Reset nascosto e ritiro PC

Il reset nascosto in Impostazioni ha quattro opzioni:

- **Riconfigura questo PC**: reset leggero. Mantiene lo stesso `deviceId`, rimuove il profilo
  corrente, elimina l'intera `app_data_dir` locale e torna direttamente all'onboarding; alla
  riconfigurazione appende ancora allo stesso log eventi.
- **Ritira un PC**: mostra una lista scrollabile dei PC noti, incluso quello corrente. Crea snapshot
  e backup, poi rimuove profilo, avatar, associazione `device`, log e snapshot del PC scelto.
- **Ottimizza database**: attende normalmente l'ack di tutte le postazioni registrate, ma può essere
  forzata con un avviso sulle modifiche non sincronizzate. Crea un backup completo, consolida lo
  stato in un anchor generazionale, elimina insieme vecchi eventi e tutte le tombstone terminali e
  applica `VACUUM`. I dati operativi e i soft-delete restano intatti; marker e manifest fanno
  riallineare dall'anchor i PC che erano offline e rendono innocui i vecchi log risincronizzati.
- **Reset completo**: elimina dati applicativi condivisi e `app_data_dir`, quindi riparte
  direttamente dall'onboarding. Restano soltanto un log e uno snapshot minimi che marcano i vecchi
  device come ritirati, impedendo a log pre-reset risincronizzati in ritardo di rientrare. Le
  cartelle tecniche possono perciò restare visibili; gli archivi in `backups/` non vengono rimossi.

Un PC ritirato che torna online elimina la propria `app_data_dir` e mostra **Sessione non più
disponibile → Ricollega** con un nuovo `deviceId`; il vecchio flusso eventi resta solo nel backup
e nello snapshot operativo. Gli eventi tardivi del vecchio `deviceId` vengono ignorati. Se più PC
erano collegati allo stesso profilo rimosso, devono ricollegarsi tutti.

### Schermate di recupero

- Cartella assente/vuota/irraggiungibile: **Cartella dati non disponibile** con **Riprova** e
  **Reset configurazione**; nessun reset automatico. La tolleranza iniziale per una consegna
  OneDrive tardiva è limitata a circa sette secondi, poi la UI torna a una schermata azionabile.
- Profilo cancellato o device ritirato rilevati in dati leggibili: **Sessione non più disponibile**
  con **Ricollega**. Le finestre secondarie, Spotlight e overlay notifiche vengono chiusi.
- Reset scelto dall'utente: onboarding diretto, senza mostrare in sequenza entrambe le schermate.

Durante l'onboarding gli eventi di rebuild non cambiano schermata. Completata la configurazione,
Spotlight e overlay notifiche vengono ricreati e ricaricati automaticamente.

## 5. Niente conflitti (perché OneDrive non chiede mai cosa fare)

Ogni PC scrive **solo il proprio** file `events/<deviceId>.ndjson` (e i propri snapshot/backup).
Due PC non toccano mai lo stesso file, quindi **OneDrive non ha nulla da fondere** e non mostra
prompt del tipo "sovrascrivere / usare la copia locale". Non è una configurazione di OneDrive
(che l'app non può cambiare): è il modello dati a evitare il conflitto alla radice.

Come rete di sicurezza, se per qualsiasi motivo comparisse un file *"conflicted copy"* `.ndjson`,
l'app lo **assorbe automaticamente** senza duplicare gli eventi (idempotenza). Nessun dato perso.

## 6. Cosa succede offline / con blackout

- Le modifiche vengono salvate nel log locale del PC e sincronizzate appena OneDrive
  torna online.
- In caso di interruzione improvvisa, al riavvio l'app scarta l'eventuale ultima riga di
  log incompleta e ricostruisce lo stato.

## 7. Backup, Ripristino e Lock
- **Snapshot e Backup**: a ogni backup viene creato uno snapshot compatto per PC, mentre i log aziendali restano append-only e completi. Comunicazioni e relativa cronologia locale sono escluse sia dallo snapshot sia dallo zip: un ripristino condiviso non le trasferisce e non le sovrascrive. Al bootstrap gli snapshot concorrenti vengono fusi per campo con i clock LWW e i log colmano la coda. Le tombstone dei dati svuotati dal Cestino restano minime e impediscono resurrezioni. L'importazione clienti storici esegue un backup `pre-import`; se fallisce, l'utente deve confermare prima di proseguire senza rollback.
- **Ripristino automatico (Auto-healing)**: Il ripristino di un backup da parte di una postazione viene sincronizzato da OneDrive. Gli altri PC rilevano reset/gap/marker restore e ricostruiscono il database SQLite locale da snapshot+log. Il ripristino normale sceglie lo snapshot piu' recente; quello manuale consente di scegliere uno snapshot nello zip. Se la cartella dati è vuota o non raggiungibile all'avvio, l'app non resetta la configurazione da sola: chiede di riprovare o fare reset configurazione.
- **Lock cooperativo (advisory)**: Per ridurre la probabilità di operazioni straordinarie concorrenti (import, restore, pulizia dati), ogni dispositivo pubblica `meta/locks/<deviceId>.json` (valido per 15 minuti e rinnovato durante import lunghi). Gli altri client disabilitano temporaneamente queste funzioni mostrando PC e utente. Un guard locale impedisce a due finestre dello stesso processo di acquisire o rilasciare la lease in modo concorrente; i cleanup della UI possono liberare soltanto l'azione che avevano acquisito e il ripristino coordinato trasferisce la stessa lease dalla preparazione all'applicazione. Il ritiro usa device e cartella originari per il cleanup anche se cambia la configurazione locale. Un timestamp remoto nel futuro viene valutato usando l'età locale del file; i lock scaduti vengono rimossi fisicamente. Non è un mutex distribuito forte: due acquisizioni su PC diversi perfettamente simultanee, prima della sincronizzazione OneDrive, restano possibili. I lock sono esclusi dai backup.
- **Import clienti e deduplicazione**: gli arricchimenti, le riassegnazioni dei riferimenti e i
  purge dei duplicati sono eventi condivisi. Dopo che OneDrive ha consegnato tutti i log, ogni PC
  ricostruisce lo stesso cliente canonico; gli scarti purgati non entrano nel Cestino e non possono
  riapparire da snapshot o log precedenti.
- **Export Aruba**: lo stato esportato vive sui record cliente (`aruba_esportato_il`) e non solo
  nel browser locale. Un export eseguito da un PC viene quindi riconosciuto dagli altri dopo la
  sincronizzazione; i clienti esclusi per CF mancante restano disponibili.

## 8. Aggiornamenti dell'app

L'installer viene distribuito manualmente (es. tramite la stessa cartella condivisa).
In futuro è valutabile l'updater automatico di Tauri.
