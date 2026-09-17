# Architettura — concorrenza local-first su OneDrive

## Problema

Niente server: i PC condividono solo una **cartella OneDrive sincronizzata**. Serve un
sistema che funzioni anche:

- **offline** (PC non connesso) e durante un **blackout** (interruzione improvvisa),
- con **modifiche simultanee** da 3-5 PC,
- senza generare i temuti `… conflicted copy` di OneDrive né corrompere i dati.

## Principio: event log append-only, un file per dispositivo

Ogni dispositivo scrive **solo il proprio file** di eventi. Due dispositivi non toccano
mai lo stesso file → OneDrive non ha nulla da "fondere" → niente conflicted copy.

Lo stato visibile dall'utente è una **proiezione** ricostruibile in qualunque momento
dagli eventi (event sourcing): questo regala gratis storico, audit e undo.

```
PharmaTek-Data/                       (cartella OneDrive condivisa)
  events/
    <deviceId>.ndjson                 # append-only; SOLO questo device ci scrive
  snapshots/
    <deviceId>-<seq>.json             # proiezione periodica, fusa per campo al bootstrap
  meta/
    avatars/<userId>.png              # foto profilo utente
    locks/<deviceId>.json             # lock cooperativi temporanei
    restore_coordination/             # prepare/ack effimeri per restore coordinato
  backups/
    pharmatek-backup-<deviceId>-...
```

La **proiezione locale** è un database **SQLite nella `app_data_dir` Tauri**
(`%APPDATA%\it.pharmatek.gestionale\` su Windows), cioè
**fuori da OneDrive**: un file DB sincronizzato da più PC è la causa classica di
corruzione, quindi non va mai messo nella cartella condivisa.

### C'è un database? (riassunto)
**Sì, ma non è la fonte di verità.** Due livelli:
- **Verità = log di eventi** (`*.ndjson` in OneDrive): ogni modifica è un evento immutabile
  aggiunto in coda. Come il registro di una banca: non si salva "il saldo", si salvano le
  operazioni e il saldo si **calcola**.
- **Database SQLite locale** (in `app_data_dir`, per-PC): copia **ricostruibile** ottenuta
  "piegando" (fold) gli eventi, usata per liste/ricerche/filtri veloci. Si può cancellare e
  rigenerare in ogni momento dai log + snapshot.

Salvataggio (es. un ordine): (1) scrivo l'evento nel `.ndjson` locale → (2) aggiorno subito il
SQLite locale (UI istantanea) → (3) OneDrive sincronizza il file → (4) gli altri PC piegano gli
eventi nel loro SQLite. Vantaggi: niente conflitti DB, storico/audit/undo gratis.

### Eccezione intenzionale: Centro comunicazioni local-only

Il Centro comunicazioni non è dati di team: ogni postazione mantiene in
`%APPDATA%\it.pharmatek.gestionale\` un secondo registro eventi locale
(`communication-outbox/` + `communication-outbox.sqlite`) contenente bozze, campagne, corpi,
recapiti, code, tentativi, errori, ricevute e cronologia. Questo registro:

- non scrive in `PharmaTek-Data/events/` e non viene osservato dagli altri PC;
- è escluso in difesa anche da snapshot ordinari, anchor di restore e anchor generazionali;
- non entra nei backup/ripristini della cartella dati aziendale;
- sopravvive alla ricostruzione della sola proiezione condivisa, ma viene eliminato quando si
  cancella l'intera `app_data_dir` con riconfigurazione, ritiro del PC o reset completo.

Un invio positivo può aggiornare sul record sorgente condiviso soltanto indicatori piccoli
(data/canale/fingerprint dell'ultimo preventivo, ultimo sollecito e canali usati). Non vengono mai
sincronizzati contenuto, destinatario, allegati, errore, ricevuta o id del singolo messaggio. Anche
gli stati letto/scartato delle relative notifiche sono locali alla postazione.

## Eventi

Eventi piccoli e granulari, una riga JSON per evento (NDJSON):

```json
{"id":"01J…","type":"order.created","orderId":"01J…","ts":"<HLC>","device":"PC-LIVIO","user":"Livio"}
{"id":"01J…","type":"order.field.set","orderId":"01J…","field":"acconto","value":15000,"ts":"<HLC>","device":"PC-UFFICIO","user":"Anna"}
```

(`value` monetario in **centesimi interi**.)

## Ordinamento e conflitti

- **HLC (Hybrid Logical Clock)** = `(wall-clock, contatore, deviceId)`. Ordina gli
  eventi in modo deterministico anche se gli orologi dei PC sono leggermente disallineati.
- **Risoluzione per-campo Last-Write-Wins**: vince l'evento con HLC maggiore (tiebreak
  sul `deviceId`). Campi diversi dello stesso ordine → nessun conflitto. Stesso campo →
  vince l'ultimo, ma lo **storico** resta consultabile (nessuna perdita silenziosa).

## Offline, blackout, recovery

- **Offline**: gli eventi si accodano al `.ndjson` locale; quando OneDrive torna online il
  file si sincronizza e gli altri client lo rilevano (file-watch) e lo *foldano*.
- **Append atomico + flush** per resistere ai blackout.
- **Recovery**: se l'ultima riga del log è troncata (JSON incompleto), viene scartata; la
  proiezione è sempre ricostruibile dai log + snapshot.

## Robustezza extra

- Il motore tratta **qualunque** `*.ndjson` nella cartella `events/` come sorgente di
  eventi. Se OneDrive crea comunque un `<device> - conflicted copy.ndjson`, viene
  **assorbito** invece che perso.
- **Snapshot**: periodicamente lo stato viene riassunto in `snapshots/` per accelerare il
  bootstrap. Gli snapshot concorrenti dei diversi PC vengono fusi per campo (dopo deduplicazione
  dei soli file più recenti per ciascun dispositivo tramite `SnapshotStore::latest()`); i log restano
  append-only e completi e vengono riletti dalla posizione coperta dallo snapshot fuso.
- **Rendimento del Replay & Batching SQLite**: la proiezione locale opera con `PRAGMA synchronous = NORMAL;`
  in modalità WAL, azzerando i ritardi I/O di sincronizzazione disco tipici di Windows. L'ingestione
  massiva raggruppa gli eventi in batch da 1.000 per transazione con statement caching (`prepare_cached`),
  consentendo il replay deterministico di 60.000+ eventi in circa 1-2 secondi ed emettendo progressi
  in streaming (`pt:sync-progress`) per mantenere l'interfaccia grafica costantemente fluida.

## Modifiche concorrenti

L'app non usa soft-lock sugli ordini: più utenti possono aprire lo stesso ordine e la
convergenza tra dispositivi resta garantita dal merge LWW sugli eventi reali. Gli editor
applicano un merge selettivo: i campi non toccati si aggiornano in tempo reale, mentre quelli
modificati localmente restano nel form. Al salvataggio viene inviata soltanto la patch dei
campi realmente modificati: sullo stesso campo vince l'ultimo salvataggio, senza banner di
conflitto o blocchi di revisione; le modifiche remote sugli altri campi non vengono riscritte.

Le precondizioni **di dominio** restano invece vincolanti. Record eliminati, rate già saldate,
righe già spedite e pagamenti già collegati a una distinta non possono essere modificati come
se fossero ancora aperti. Per ordine, saldo pagamento, rateizzazione, creazione distinta e
creazione spedizione il controllo e il batch principale vengono costruiti sotto lo stesso
`Engine::mutation` lock (`emit_built_checked`/`emit_batch_checked`): il watcher dello stesso
processo non può inserire un ingest fra la verifica e l'append. Queste protezioni non sono
avvisi di modifica concorrente dello stesso campo, ma invarianti contabili/logistiche.

I normali salvataggi non usano file-lock OneDrive: la lease in `meta/locks/` è advisory ed è
riservata alle operazioni straordinarie. Fra due PC perfettamente simultanei non esiste una
mutua esclusione forte senza un coordinatore centrale; dopo la propagazione, HLC/LWW garantisce
la convergenza e le precondizioni impediscono di riutilizzare uno stato già osservato come
chiuso. L'indicatore "in modifica" con heartbeat è stato rimosso per evitare eventi tecnici
periodici nel log.

## Numerazione ordini (sync-safe)

Il numero leggibile `ANNO-progressivo` (es. `2026-0001`) è **derivato**, non un dato
sorgente: si calcola ordinando gli eventi `order.created` per **HLC** e assegnando il
progressivo per anno. Poiché tutti i dispositivi convergono allo stesso insieme di eventi,
calcolano gli stessi numeri (nessun contatore condiviso da bloccare).

Conseguenza offline: un ordine creato senza rete ha un numero **provvisorio**
(`numero_provvisorio = true`), perché un altro PC potrebbe aver creato un ordine con HLC
inferiore non ancora visto. Alla sincronizzazione il numero si finalizza; in caso di
collisione vince l'HLC più basso e l'altro slitta al primo numero libero. Gli ordini già
sincronizzati non vengono mai rinumerati. L'**ULID** dell'ordine, invece, è stabile dal
primo istante.

## Identità

Al primo avvio l'app:

1. genera un **`deviceId`** locale;
2. chiede il **percorso** della cartella `PharmaTek-Data` sincronizzata;
3. carica gli utenti condivisi e permette di usarne/riconfigurarne uno o crearne uno nuovo;
4. raccoglie avatar e riepilogo prima della conferma.

Utenti e dispositivi sono entità nel log eventi (`user`, `device`), non file JSON condivisi
riscritti a ogni avvio. In `meta/` restano solo artefatti binari/operativi, come avatar e lock.

### Reset nascosto: riconfigura, ritira, ottimizza, reset completo

Il modale nascosto di reset offre sempre quattro opzioni:

- **Riconfigura questo PC**: reset leggero. Svuota configurazione/preferenze locali, mantiene lo
  stesso `deviceId`, rimuove il profilo utente corrente (`user`, stati utente e avatar) solo se
  nessun'altra postazione attiva lo usa, azzera il collegamento `device.user_id` e torna
  all'onboarding. Finché non viene scelto un nuovo utente il PC non compare nelle liste operative;
  resta però visibile nell'elenco amministrativo **Ritira un PC**. Riconfigurandolo, continua ad appendere su
  `events/<stessoDeviceId>.ndjson`. La cartella locale `app_data_dir` viene eliminata integralmente
  (configurazione, proiezione SQLite, cronologia comunicazioni e cache) e ricreata
  dall'onboarding.
- **Ritira un PC**: apre una lista scrollabile dei dispositivi noti, incluso quello corrente.
  L'operazione chiude definitivamente quel flusso eventi: emette `device_retired`, elimina `device`
  e, se non è condiviso con altre postazioni attive, anche `user`, stati utente e avatar; crea
  snapshot+backup, poi rimuove
  `events/<deviceId>.ndjson` e `snapshots/<deviceId>-*.json`.
- **Ottimizza database**: coordina e sospende tutte le postazioni registrate, verifica i log,
  applica la stessa deduplicazione convergente dei clienti usata dall'importazione, crea un backup
  completo e pubblica un checkpoint generazionale immutabile. Conserva tutti i
  record operativi e i soft-delete, rimuove insieme i vecchi eventi e tutte le tombstone terminali,
  poi esegue `VACUUM` sulla proiezione locale. `meta/generation.json` impedisce a vecchi log
  riconsegnati da OneDrive di resuscitare dati; i PC vengono ricostruiti dall'anchor esatto.
  Come nel ripristino, l'utente può procedere anche con ACK mancanti: le postazioni offline
  ricevono il manifest e il marker terminale al successivo collegamento e si riallineano
  automaticamente, con l'avviso che eventuali modifiche non ancora sincronizzate possono perdersi.
- **Reset completo**: cancella tutti i dati applicativi condivisi e l'intera cartella locale
  `app_data_dir`, poi riparte direttamente dall'onboarding con un nuovo `deviceId`. Nel dataset
  ricrea soltanto un log/snapshot minimo con `device_retired` per tutti i vecchi device: è una
  barriera anti-resurrezione, non contiene utenti o dati di lavoro. Le directory tecniche restano
  quindi visibili e i backup già presenti in `backups/` vengono conservati.

Se un PC ritirato è online, riceve il marker di rebuild, vede il proprio `deviceId` in
`device_retired`, elimina la propria `app_data_dir` e richiede il ricollegamento con un **nuovo
`deviceId`**. Gli eventi tardivi provenienti da un device ritirato vengono ignorati dal fold.
Il controllo viene ripetuto sia quando l'onboarding apre la cartella condivisa sia subito prima
della conferma: se il marker arriva durante quei passaggi, il runtime viene riaperto con un nuovo
id prima di scrivere `user` e `device`. Un eventuale **Usa questo utente** ripristina inoltre in modo
idempotente profilo e record device, chiudendo la gara con una cancellazione appena sincronizzata.
Il ritiro elimina il profilo associato solo quando nessun'altra postazione attiva lo usa; un utente
condiviso resta quindi valido sugli altri PC. Le panoramiche, i destinatari e i lock operativi
escludono sempre i `device_retired`, anche se OneDrive riconsegna in ritardo vecchi artefatti.

### Stati di recupero e ricollegamento

Le tre situazioni sono volutamente esclusive:

- **Cartella dati non disponibile**: la cartella configurata è assente, vuota, illeggibile o non
  ancora sincronizzata. La configurazione locale non viene cancellata automaticamente; la UI offre
  **Riprova** e **Reset configurazione**. All'avvio concede a OneDrive una breve finestra di circa
  sette secondi, poi mostra comunque le azioni senza ripetere un'attesa di un minuto.
- **Sessione non più disponibile**: i dati condivisi sono leggibili ma confermano che il profilo è
  stato cancellato o il device ritirato da un altro PC. L'app elimina `app_data_dir`, chiude tutte
  le finestre secondarie, disattiva il notificatore e invalida/distrugge Spotlight; **Ricollega**
  apre l'onboarding.
- **Reset volontario**: non mostra la schermata di sessione invalida; entra direttamente
  nell'onboarding.

Durante **Ricollega/onboarding** gli eventi tecnici `pt:data-wiped` non interrompono i passaggi.
Dopo la conferma dell'identità il controllo torna attivo; notifiche, overlay e indice di ricerca
vengono configurati e ricreati dal normale ingresso nello stato `pronto`.

## Panoramica sincronizzazione (semplice, senza polling)

**Niente heartbeat periodici**: nessuna scrittura artificiale in background. Il file-watch resta il
percorso immediato; letture incrementali idempotenti fanno da rete di sicurezza mentre la UI è
visibile e nel rilevatore notifiche nativo quando la main è nascosta nella tray. Una **panoramica**
essenziale si ricava **gratis e on-demand** dai dati già presenti:

- **Dispositivi/utenti** noti: dalle entità `device` e `user` già presenti nel log eventi.
- **Ultima attività per dispositivo/utente**: il timestamp dell'evento più recente di quel device
  nel log (informazione **già presente** negli eventi) → "ultima modifica di Mario: …", senza
  alcuna scrittura aggiuntiva.
- **Stato di questo PC**: online/offline e raggiungibilità della cartella dati, verificati **solo
  quando apri la panoramica** (o guardi la pill di sync), mai in continuo.

Tutto **advisory**: una semplice occhiata, non condiziona il funzionamento.

## Backup e Ripristino

I log append-only + snapshot sono già storia completa, ma serve protezione contro la perdita
dell'intera cartella (cancellazione accidentale, problema OneDrive):

- **Backup automatico** periodico (giornaliero/settimanale/ogni 2 settimane/mensile, configurabile): copia
  `events/ + snapshots/ + meta/` in un archivio **zip** (percorso di default `backups/` dentro OneDrive, oppure configurabile), con **retention** (ultimi 10 per dispositivo). Lo zip viene scritto e verificato come file temporaneo, sincronizzato su disco e rinominato atomicamente solo a completamento; file parziali o archivi strutturalmente corrotti non compaiono nella lista. Nello zip entra uno snapshot compatto per PC; lock runtime `meta/locks/`, coordination restore `meta/restore_coordination/` e marker restore sono esclusi.
- **Backup manuale** ("Backup ora") e **Ripristino**: Il ripristino sostituisce la cartella dati condivisa sotto lock cooperativo. Prima del taglio può creare un marker `prepare` transitorio in `meta/restore_coordination/`: gli altri PC scrivono un ack, chiudono le finestre operative e mostrano una schermata bloccante. Finché il modale di preparazione è aperto la lease viene rinnovata ogni 5 minuti; le postazioni bloccate ricontrollano ogni 5 secondi bootstrap e lease, così recuperano un commit/cancel perso anche dopo tray o sospensione. Se il PC proprietario termina senza annullare, rimuovono il solo blocco grafico quando la lease di 15 minuti risulta scaduta. Gli ack non sono dati applicativi, valgono solo se esiste il relativo `prepare`, sono puliti se orfani e non entrano nei backup. Al termine di ripristino o ottimizzazione, `prepare`, ack e relativi `.tmp` vengono rimossi subito; il piccolo marker terminale resta disponibile ai PC offline. Una preparazione abbandonata da oltre 24 ore viene annullata e ripulita in sicurezza all’avvio, alla scelta della cartella dati o alla preparazione successiva. Il ripristino normale usa automaticamente lo snapshot piu' recente; il ripristino manuale permette di scegliere lo snapshot contenuto nello zip. Dopo la sostituzione il coordinatore crea uno **snapshot-anchor immutabile** della generazione ripristinata e un manifest v2 `meta/restore_coordination/committed-<restoreId>.json`: l'anchor è verificato per dimensione/checksum esatti, mentre ogni log append-only è verificato sul prefisso presente al commit. Il marker con `restoreId` viene scritto per ultimo. In questo modo gli altri PC aspettano un payload completo, ma le operazioni legittime successive possono allungare i log senza rendere il commit irraggiungibile. La ricostruzione parte soltanto dall'anchor certificato e dai log: snapshot ordinari della generazione precedente, anche se validi ma consegnati in ritardo, non vengono fusi. Un log non elencato è ammesso se vuoto o se il suo primo evento è successivo alla frontiera del commit; un log vecchio estraneo mantiene invece lo stato `waiting` finché OneDrive non ne propaga la cancellazione. Un motore aperto mentre il restore è `waiting` o `ready` congela anche l'ingest: nessun log parziale o estraneo entra temporaneamente in SQLite; soltanto il motore riaperto esplicitamente con l'anchor verificato può ripiegare la coda. Un bootstrap che osserva `waiting` non valuta identità/device sui file parziali e mantiene una schermata bloccante; quando passa a `ready` ricostruisce SQLite. Il polling visibile e quello nativo in tray rilanciano anche `restore-waiting`, quindi non dipendono dalla consegna di un singolo evento del watcher. Se il payload non diventa verificabile entro due minuti, la UI passa a un errore recuperabile con **Riprova** e non rientra automaticamente nello stesso loop. Se l'app è partita con `--minimized`, completa bootstrap, sincronizzazione e mount della Shell in background lasciando la finestra nativa nascosta; intro e transizioni iniziali vengono soppresse. Tray e scorciatoia riusano la promise di avvio già in corso e non lanciano un bootstrap concorrente. Ogni PC marca localmente il `restoreId` e l'anchor fidato solo dopo una ricostruzione riuscita, così un errore è ritentabile, una futura perdita della cache locale resta sicura e un PC offline converge senza loop. I manifest v1 già distribuiti verificano i prefissi dei log canonici; dopo aver marcato localmente il restore come gestito, il rebuild deve ripiegare esplicitamente l'intera coda prima di validare identità e device. La scelta cartella esegue lo stesso riallineamento prima di restituire gli utenti e, se il payload è ancora `waiting`, mantiene l'onboarding senza salvare una configurazione parziale.
  I marker legacy già incorporati all'apertura restano una frontiera cronologica: un marker più recente di ritiro, reset o compattazione rende superati i manifest di restore precedenti. La regola sopravvive alla cancellazione dell'AppData locale e impedisce che un nuovo onboarding resti in attesa di file deliberatamente sostituiti.
- **Snapshot compatti**: gli elementi svuotati dal Cestino (`Purged`) non mantengono dati applicativi nello snapshot; resta solo una tombstone minima per impedire resurrezioni da vecchi log. I soft-deleted restano ripristinabili.
- **Backup preventivo**: L'importazione delle vecchie anagrafiche crea un backup `pre-import` prima dell'inizio delle modifiche. Se il backup fallisce, l'utente deve confermare esplicitamente l'import senza punto di ripristino.
- **Advisory lock cooperativo**: Le operazioni sensibili (importazione Excel, ripristino backup, pulizia dati) pubblicano un blocco in `meta/locks/<deviceId>.json`. Un guard in memoria impedisce a due finestre dello stesso processo di acquisire la lease contemporaneamente e che una la rilasci mentre l'altra lavora: i cleanup frontend indicano l'azione attesa e un rilascio tardivo di un'altra operazione viene rifiutato. Le operazioni a più fasi trasferiscono esplicitamente la stessa lease (per esempio `preparazione_ripristino` → `ripristino_backup`) senza tentare una seconda acquisizione. Le operazioni che cambiano l'identità locale, come il ritiro del PC corrente, rilasciano comunque la lease con device e cartella originari. I timestamp futuri vengono valutati tramite l'età locale del file e i lock scaduti vengono rimossi. Il meccanismo riduce le sovrapposizioni visibili, ma non è un mutex distribuito e non può escludere due partenze su PC diversi prima della sincronizzazione OneDrive.
- **Deduplicazione clienti convergente**: al termine dell'import il frontend invia al backend il
  piano con gli snapshot dei clienti osservati. Il backend rilegge la proiezione, completa il
  canonico senza scrivere vuoti, riassegna i riferimenti e solo dopo la verifica emette `Purged`
  per i duplicati. `Purged` e' terminale grazie a tombstone e watermark: un PC offline converge
  allo stesso risultato quando riceve l'intera coda, senza mostrare gli scarti nel Cestino.
- **Stato export Aruba**: non dipende piu' dal solo ultimo ID locale. Il campo cliente
  `aruba_esportato_il` e il singleton di migrazione sono normali record/eventi condivisi; un
  cliente escluso per CF mancante resta candidabile e viene esportato dopo il completamento.

## Sincronizzazione in Tempo Reale e Gestione Finestre Esterne

Tutti i cambiamenti avvenuti sui dati condivisi vengono rilevati in tempo reale dal file-watcher e notificati alle varie schermate:
- **Preservazione dei Filtri e dello Stato UI**: L'aggiornamento automatico dei dati nelle viste (Giornaliero, Contabilità, Spedizioni, ecc.) rinfresca la lista dei record mantenendo intatti i filtri attivi dell'utente (come selezioni, ricerche di testo, o intervalli di date) senza forzare il reload della pagina o cancellare il lavoro in corso.
- **Eventi derivati coperti**: le viste che mostrano dati calcolati ascoltano anche le entità collegate
  (pagamenti, rimborsi, distinte, conti, prodotti e anagrafiche correlate), non solo il record
  principale. Un saldo arrivato da sync remoto aggiorna quindi Giornaliero, Crediti, Produzione,
  Spedizioni e Riepiloghi senza aspettare il polling di sicurezza.
- **Righe ordine come fonte unica per lotti prodotto**: il numero lotto vive su `riga_ordine`
  insieme ai dati di produzione e alla data di consegna prevista Laboratorio puntuale
  (`data_prevista`). Il watcher pubblica le modifiche alle righe come `ordine:salvato`, quindi
  Giornaliero, Produzione, Spedizioni e ricerca globale ricaricano la stessa fonte e restano
  allineati anche quando il lotto viene corretto dall'editor ordine, dalla vista Produzione o da
  un popover spedizione. Il vecchio `ordine.data_prevista_lotto` resta solo come fallback per dati
  storici.
- **Guard di dominio sulle azioni operative**: prima di scrivere movimenti derivati il backend
  rilegge la proiezione corrente nello stesso lock del batch principale. Spedizioni, invio
  produzione, pagamenti/rate/rimborsi, provvigioni pagate e unioni/annulli lotti falliscono se
  nel frattempo un altro evento ha eliminato record, saldato rate, spedito righe o reso non più
  valido il residuo/importo selezionato.
- **Aggiornamento in tempo reale negli Editor**: Se la finestra dell'editor Ordine è aperta e un altro client modifica lo stato dell'ordine (es. avanzato in produzione) o registra/salda un pagamento collegato ad esso, la lista dei pagamenti e lo stato dell'ordine si aggiornano **automaticamente e istantaneamente** in sottofondo. I campi non toccati seguono il remoto; quelli modificati localmente restano nel form e vincono se vengono salvati per ultimi.
- **Finestre Esterne Orfane (Caso limite)**: Se un operatore apre una finestra esterna di dettaglio/modifica (es. editor Ordine, dettaglio Pagamento, Promemoria o Riepilogo soggetto) e quel record viene eliminato o annullato da un altro PC:
  - La finestra esterna rileva la rimozione in tempo reale.
  - Mostra un avviso all'utente comunicando l'eliminazione avvenuta.
  - Chiude automaticamente la finestra per prevenire tentativi di salvataggio inconsistenti o reinserimenti accidentali di dati obsoleti.

## Requisito di deployment

La cartella `PharmaTek-Data` va impostata su **"Mantieni sempre su questo dispositivo"**
(Files On-Demand disattivato per quella cartella), così i file sono locali e osservabili
dal file-watcher. Dettagli operativi in [`DEPLOY-ONEDRIVE.md`](DEPLOY-ONEDRIVE.md).
