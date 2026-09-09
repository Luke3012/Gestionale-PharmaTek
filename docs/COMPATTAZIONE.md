# Compattazione: snapshot, bootstrap veloce e pulizia

Come teniamo sotto controllo la crescita dei log eventi nel tempo, senza server e con PC
che possono stare offline. Vedi anche `ARCHITETTURA.md` (motore sync) e `DEPLOY-ONEDRIVE.md`.

## Il problema

Ogni modifica è un evento append-only in `events/<deviceId>.ndjson`. In funzionamento
normale la lettura è **incrementale** (per offset) → costa solo sulle novità. Il costo vero
è il **bootstrap** (nuovo PC, reset, cache locale svuotata): lì il motore ripiega *tutta* la
storia. A centinaia di migliaia/milioni di eventi quel rebuild passa da istantaneo a minuti.
La crescita su disco, alla scala del progetto (3–5 utenti), resta modesta (decine–poche
centinaia di MB su anni): il collo di bottiglia è il **tempo di rebuild**, non lo spazio.

## Principi (validi per tutte le fasi)

1. **Lo snapshot è uno stato compatto condiviso**: un dump JSON della proiezione
   (`SnapshotData`: record vivi/ripristinabili + **clock HLC per campo** + tombstone minime dei
   purged + **watermark HLC per device** + **segnalibri di lettura**). I clock HLC sono essenziali:
   permettono a eventi vecchi in ritardo (PC offline) di fondersi correttamente con LWW.
2. **Niente file condiviso mutabile**: gli snapshot sono **per-dispositivo**
   (`snapshots/<device>-<seq>.json`, scrittura atomica tmp+rename); al bootstrap gli snapshot
   validi vengono **fusi per campo con gli stessi clock LWW**. Così due PC che hanno creato
   snapshot mentre erano offline non perdono lo stato visto soltanto da uno dei due. Un unico file riscritto da tutti reintrodurrebbe
   le "conflicted copy" di OneDrive che evitiamo per i log.
3. **Il `.sqlite` non sta MAI in OneDrive**: la proiezione locale è una cache derivata in
   `%APPDATA%`. Si condivide solo lo snapshot JSON (portabile, read-only, mergeabile).
4. **Ogni dispositivo tocca solo i propri file** (log e snapshot): nessun conflitto.
5. **Le comunicazioni non fanno parte dello snapshot condiviso**: coda, contenuti, ricevute,
   errori e cronologia vivono nel registro locale della postazione. `backup_now`, anchor di
   restore e compattazione generazionale filtrano difensivamente l'entità `comunicazione`; restano
   condivisi soltanto i piccoli indicatori applicativi salvati direttamente sull'entità sorgente.

## Fase 1 — bootstrap veloce (IMPLEMENTATA, zero rischio)

Risolve il tempo di rebuild **senza cancellare nessun evento**.

- **Segnalibri nello snapshot**: `SnapshotData.offsets` = per ogni file di log, l'offset byte
  già folded. `Projection::export`/`import` li salvano/ripristinano (campo `#[serde(default)]`
  → retrocompatibile con snapshot vecchi). *(`projection/mod.rs`)*
- **Bootstrap "solo coda"**: `Engine::open` importa lo snapshot più recente (ripristinando i
  segnalibri) e poi `ingest` ripiega **solo la coda** di ogni log oltre quell'offset.
- **Snapshot generato al backup**: `backup_now` salva prima uno snapshot condiviso filtrato,
  così lo zip contiene sempre uno stato recente insieme ai log aziendali completi, ma non la
  cronologia del Centro comunicazioni locale. Lo snapshot accelera il bootstrap, ma non autorizza
  la cancellazione della storia condivisa. *(`app/lifecycle.rs`, `app/mod.rs`, `sync/mod.rs`)*
- **Sicurezza idempotenza**: i nuovi snapshot non serializzano piu' tutta la tabella
  `applied_events`. Il fold resta idempotente tramite clock HLC e tombstone `purged`; una
  "conflicted copy" vecchia non sovrascrive dati recenti e non resuscita record svuotati.

Test: `projection::snapshot_include_e_ripristina_gli_offset`,
`sync::snapshot_con_offset_bootstrap_solo_la_coda`,
`sync::conflicted_copy_dopo_snapshot_non_duplica`, `app::backup_genera_snapshot_aggiornato`.

## Log completi append-only (scelta di affidabilità)

L'applicazione operativa **non tronca più i log durante il backup**. Conservare il log completo
evita che un PC offline dipenda da uno specifico snapshot per recuperare eventi ormai rimossi.
Alla scala prevista del progetto lo spazio aggiuntivo è preferibile al rischio di perdita silenziosa.

Le primitive di lettura dei vecchi log già compattati restano supportate per compatibilità e
migrazione, ma il normale `backup_now` esegue: snapshot → backup completo → sola potatura della
cache locale `applied_events`. Nessun PC riscrive il log di un altro PC.

Test di compatibilità legacy: `log::compact_tiene_solo_gli_ultimi_n`,
`sync::compattazione_log_nessuna_perdita_su_nuovo_dispositivo` (end-to-end: snapshot+compat→nuovo
PC ha tutto), `sync::reader_aggiornato_gestisce_il_log_compattato` (shrink + dedup),
`sync::pc_rimasto_indietro_si_ricostruisce_da_snapshot_su_gap` (PC già configurato rimasto
indietro oltre la coda compattata).

**Risoluzione automatica dei gap legacy (Gap Healing)**: se viene incontrato un dataset creato da
una versione precedente che aveva già troncato i log, il sistema rileva il gap e ricostruisce dallo
snapshot fuso:
- Ferma temporaneamente il motore.
- Svuota la proiezione SQLite locale (`Projection::wipe()`).
- Ricarica l'ultimo snapshot disponibile da OneDrive e riesegue l'ingest della coda rimanente.
- Se l'app è in background (minimizzata nella tray), questa operazione avviene in modo silente; se l'app è aperta, mostra una schermata di caricamento unificata (`UnifiedBootScreen`) fino al reload.
- Se all'avvio la cartella dati configurata è vuota o non raggiungibile, la configurazione locale non viene resettata automaticamente: la UI chiede esplicitamente di riprovare o fare reset configurazione.

**Advisory lock cooperativo**: Per ridurre le operazioni critiche concorrenti (importazione Excel massiva, ripristino backup, pulizia dati), i client scrivono un file JSON individuale in `meta/locks/<deviceId>.json` con utente, macchina e timestamp. Se il file di un altro PC è già sincronizzato e ancora valido (15 minuti), l'operazione viene bloccata segnalando chi lo detiene. Un guard locale impedisce acquisizioni concorrenti da due finestre dello stesso processo e rilasci prematuri; il rilascio richiesto dalla UI è accettato solo se l'azione coincide ancora. Il ripristino trasferisce la lease dalla preparazione all'applicazione, mentre gli import lunghi la rinnovano senza riacquisirla. Il ritiro libera anche il guard in memoria usando l'identità con cui era stato acquisito, prima dell'eventuale cambio di device locale. I lock scaduti e quelli attribuiti a un `device_retired` vengono eliminati durante la scansione, così un lease riconsegnato in ritardo da OneDrive non ricompare nella UI e non blocca le postazioni attive. È escluso dai backup e cancellato dopo un ripristino. Poiché OneDrive non offre una creazione esclusiva condivisa, non garantisce mutua esclusione contro due partenze simultanee su PC diversi.

**Ritiro profilo/PC**: cancellare un profilo utente (`user` + avatar + stati utente) è un normale
evento di dominio. Il ritiro di un PC chiude invece l'intero flusso del dispositivo: emette
`device_retired`, salva snapshot+backup e poi rimuove `events/<deviceId>.ndjson` e gli snapshot di
quel dispositivo.

Le liste operative degli utenti richiedono sempre almeno un record `device` attivo associato:
un profilo orfano, anche se ricompare da uno snapshot vecchio, non viene proposto come destinatario
né come duplicato durante l'onboarding. Messaggi e rinotifiche rivalidano i destinatari subito
prima della scrittura per chiudere la gara con un ritiro avvenuto mentre la UI era aperta.
Simmetricamente, la panoramica espone soltanto device collegati a un record `user` vivo: il reset
leggero conserva l'identificativo del PC ma svuota `device.user_id`, rendendolo non operativo e
invisibile fino alla conclusione del nuovo onboarding. La lista amministrativa di ritiro usa una
lettura distinta che include anche questi device scollegati, così possono essere dismessi davvero.

Sequenza sicura per ritirare gli eventi di un PC:
- acquisire il lock cooperativo;
- forzare ingest;
- marcare `device_retired`, eliminare il device e, solo se il profilo non è usato da altre
  postazioni attive, eliminare anche profilo e stati utente nel log;
- salvare uno snapshot che contiene già lo stato finale del ritiro;
- creare il backup completo mentre tutti i log sono ancora presenti;
- rimuovere `events/<deviceId>.ndjson` e `snapshots/<deviceId>-*.json` solo dopo il backup;
- scrivere un marker di rebuild/restore, così gli altri PC non interpretano la sparizione del log
  come un semplice no-op.

Gli altri PC che rilevano marker, gap o shrink non affidabile devono svuotare la proiezione SQLite
locale, importare l'ultimo snapshot disponibile e ripiegare la coda dei log rimasti. In questo modo
lo stato resta nello snapshot, lo storico completo resta nello zip di backup e il device ritirato non
ricompare nelle liste operative. Anche l'onboarding ricontrolla `device_retired` dopo aver aperto la
cartella e prima del salvataggio finale, ruotando l'id e il runtime se il marker è arrivato durante
la procedura. Se il PC ritirato è online, al rebuild mostra
**Sessione non più disponibile** e da **Ricollega** entra nell'onboarding con un nuovo `deviceId`;
eventuali eventi tardivi del vecchio `deviceId` vengono ignorati.

Se più postazioni condividono volontariamente lo stesso profilo, il ritiro di una sola postazione
conserva utente, avatar e stati condivisi finché almeno un altro device attivo continua a usarli.

Sul PC ritirato viene rimossa anche l'intera `app_data_dir` (SQLite, config e cache ricostruibili).
Se il ritiro è rilevato da remoto, la UI chiude tutte le finestre secondarie, azzera lo stato del
notificatore e invalida Spotlight prima di chiedere **Ricollega**. Il nuovo onboarding ricrea i
servizi; gli eventi `pt:data-wiped` vengono ignorati solo mentre i passaggi di configurazione sono
in corso, per evitare cambi di schermata accidentali.

**Barriera del reset completo**: dopo aver eliminato eventi, snapshot e metadati applicativi, il
reset raccoglie dalla vecchia proiezione tutti i device noti (registro e watermark), assegna il nuovo
`deviceId` e crea un log/snapshot minimo con un record `device_retired` per ciascun vecchio id. Se
OneDrive o un PC rimasto offline ripubblicano un `.ndjson` pre-reset, `Engine::ingest` riconosce
l'autore ritirato dal primo evento e salta l'intero file. La barriera non contiene utenti né dati di
lavoro e non compare nella lista operativa dei dispositivi.

Per dataset già resettati da versioni precedenti la panoramica nasconde gli autori orfani, ma non
li ritira né cancella automaticamente: l'assenza momentanea di un record `device` può verificarsi
anche durante un onboarding concorrente. La rimozione fisica retroattiva richiede quindi
un'operazione esplicita e confermata; non viene eseguita da una semplice lettura o da `force_sync`.

**Purge reale**: gli elementi svuotati dal Cestino (`Purged`) vengono rimossi fisicamente da
`records` e `field_clocks`. Nello snapshot resta solo una tombstone minima `{ entity, id }`, che
serve a impedire che vecchi eventi o conflicted copy resuscitino dati eliminati definitivamente.
I soft-delete restano invece nello snapshot perche' sono ancora ripristinabili dal Cestino.

**Ottimizzazione generazionale esplicita**: la quarta azione del Centro di ripristino crea prima
un backup completo con log e tombstone, attende normalmente l'ack delle postazioni registrate e
verifica integralmente ogni NDJSON. Se una postazione non risponde, l'utente può forzare il commit
dopo un avviso esplicito: quel PC si riallineerà al prossimo collegamento e le sue modifiche non
sincronizzate possono andare perse. Poi salva un anchor consolidato con record, clock e watermark,
ma senza `applied`, offset o tombstone, e pubblica atomicamente `meta/generation.json` con i cutoff
HLC per device. Soltanto dopo la pubblicazione rimuove i vecchi `*.ndjson` e gli snapshot sostituiti,
crea il nuovo log vuoto e compatta SQLite con `VACUUM`. Come nel ripristino, il manifest
`committed-*.json` e il marker terminale fanno ricostruire dall'anchor anche i PC che erano offline;
il marker è scritto per ultimo.

La barriera viene riletta a ogni ingest: eventi fino al cutoff sono ignorati anche se OneDrive
riconsegna una conflicted copy. Un PC nuovo o riallineato importa esattamente
`snapshots/generation-anchor-*.json`; il suo HLC viene portato sopra `createdAt`, quindi gli eventi
nuovi restano validi anche con un orologio locale arretrato. La pulizia comprende **tutte** le
tombstone terminali condivise, indipendentemente dal tipo di entità; i soft-delete e i record
semantici vivi come `device_retired` non sono tombstone e vengono conservati.

**Pulizia dati profonda**: la pulizia definitiva esegue prima un backup completo, poi emette i purge
dei record selezionati e degli stati `notifica_letta` ormai orfani. I log restano append-only e le
tombstone terminali restano nello snapshot: una copia vecchia può essere riletta senza resuscitare i
record e nessun PC deve riscrivere i file appartenenti agli altri dispositivi.

## Pulizia / retention (criteri e strumenti)

Gli artefatti automatici si auto-limitano, per-dispositivo (così non si toccano mai i file altrui → niente conflitti):

| Artefatto | Dove | Retention | Quando si pulisce / Note |
|---|---|---|---|
| **Snapshot** | `snapshots/<device>-<seq>.json` | ultimo **1** per dispositivo | a ogni `Engine::snapshot()` via `SnapshotStore::prune`; al bootstrap gli snapshot dei diversi PC vengono fusi |
| **Backup** | `backups/...-<device>-<ts>-<ulid>.zip` o `...-pre-import-<ts>-<ulid>.zip` | ultimi **10** per dispositivo | a ogni `backup_now` via `backup::esegui` (parametro `retention`). Lo zip viene prima scritto/validato come `.zip.tmp` e pubblicato con rename atomico. **Ottimizzazione CPU/UI**: Lo zip include **uno snapshot compatto per PC**. I log `.ndjson` vengono compressi velocemente (livello 1), mentre snapshot `.json` e file binari vengono salvati senza compressione (`Stored`). I lock runtime `meta/locks/` e i marker restore non entrano nel backup. |
| **Log di PC dismesso** | `events/<device>.ndjson` + `snapshots/<device>-*.json` | ritiro manuale, non automatico | solo sotto lock, dopo snapshot + backup completo, con marker di rebuild per gli altri PC |
| **Generazione operativa** | `meta/generation.json` + `snapshots/generation-anchor-*.json` | un checkpoint autorevole | solo con **Ottimizza database**, dopo backup e coordinamento; sostituisce insieme vecchi eventi e tombstone |

Test: `sync::snapshot::prune_tiene_solo_gli_ultimi_n`,
`sync::snapshot::prune_non_tocca_gli_altri_dispositivi` (+ roundtrip backup esistente).

Possibili evoluzioni (UI): pulsanti "pulisci snapshot/backup adesso", retention configurabile
in Impostazioni, e — quando ci sarà l'auto-backup schedulato — la stessa retention applicata
in automatico.
