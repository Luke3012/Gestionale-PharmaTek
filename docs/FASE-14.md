# FASE 14 — Suggerimenti intelligenti e azionabili

> Stato: **completata il 1 agosto 2026**.
>
> Dipendenze: Dashboard, Contabilità, Produzione, Spedizioni, Comunicazioni FASE 11,
> deduplicazione anagrafiche e deep-link già esistenti.
>
> Principio: nessuna seconda lista operativa da mantenere. Le card sono derivate dai dati
> correnti e aprono sempre il flusso autorevole che consente di completare il lavoro.

## 1. Obiettivo

La Dashboard mostra un pannello compatto di azioni utili, ordinato per priorità. Ogni
suggerimento:

- nasce da record operativi già presenti;
- raggruppa situazioni omogenee invece di ripetere una card per record;
- apre la schermata corretta con filtri e contesto;
- scompare quando il lavoro viene completato o il dato sorgente cambia;
- può essere nascosto fino a una modifica sostanziale delle sorgenti;
- può essere ignorato insieme a tutte le altre azioni visibili con un unico salvataggio;
- rispetta categorie e soglie configurate localmente sul PC;
- entra nella campanella e nei pop-up custom quando raggiunge la soglia impostata;
- converge fra postazioni senza introdurre un nuovo archivio di attività.

Il motore non invia comunicazioni, non liquida importi, non crea lotti e non unisce
anagrafiche in autonomia. L'operatore conserva sempre il controllo nel normale flusso di
dominio.

## 2. Suggerimenti disponibili

| Tipo | Condizione derivata | Azione | Soglia Default |
|---|---|---|---|
| Rimborsi | Uno o più rimborsi richiesti non ancora effettuati | Apre Contabilità → Rimborsi filtrata sugli aperti | 3 giorni |
| Distinte | Contrassegni o assegni non ancora inclusi in distinta | Apre Contabilità → Distinte e avvia la distinta esistente | 20 giorni |
| Produzione | Righe Immunoterapia/Diagnostica confermate, con acconto incassato e senza lotto/stato produzione | Apre Produzione → Da produrre con filtro acconto incassato | 3 giorni |
| Spedizioni | Spedizioni recenti (ultimi 14 gg) e contattabili il cui contenuto non risulta ancora comunicato | Apre la spedizione effettuata da avvisare | 3 giorni |
| Provvigioni | Un agente ha provvigioni maturate positive (disattivata di default) | Apre il report dell'agente, ordinato per maturazione | 7 giorni |
| Preventivi | Preventivi da inviare o in attesa di risposta dopo l'ultimo invio (stato ordine Nuovo, nessun marcatore attivo, disattivata di default) | Apre Preventivi e avvia il selettore solleciti | 7 giorni |

L'intera FASE 14 è Premium. Senza accesso il pannello non viene montato né caricato, e tutti
i comandi e i processi Rust escono prima di leggere report o proiezioni della funzione.

## 3. Ranking e presentazione

Il backend assegna una priorità da 0 a 100 in base al tipo, all'anzianità e, dove utile,
all'importo. L'ordinamento è deterministico: priorità decrescente, tipo e identificativo.

Il pannello:

- mostra inizialmente al massimo cinque card e permette di espandere il resto;
- virtualizza la parte eccedente quando supera l'altezza massima del pannello;
- presenta categoria, titolo, dettaglio e una singola azione primaria;
- usa animazioni leggere e brevi;
- rende immediate le transizioni quando è attivo **Riduci animazioni**;
- include il pulsante **«Controlla ora»** che permette di forzare la visualizzazione di tutte le azioni rilevate anche prima dei giorni di soglia.

KPI e pannelli essenziali della Dashboard vengono caricati per primi. I suggerimenti sono
memorizzati nella cache Rust e ricalcolati soltanto quando cambia un'entità pertinente: il timer
notifiche di cinque secondi non rigenera continuamente report contabili o produttivi.

## 4. Ciclo di vita e sincronizzazione

I suggerimenti operativi non sono record persistenti. Il loro identificativo stabile contiene
una firma compatta della fotografia minima delle sorgenti, ordinata e deduplicata.

Da questa regola seguono tre comportamenti:

1. lo stesso lavoro produce lo stesso identificativo su ogni PC;
2. una modifica sostanziale produce un nuovo identificativo e rende nuovamente visibile la
   card;
3. quando tutte le sorgenti vengono risolte o eliminate, la card non viene più derivata.

**Nascondi fino al prossimo cambiamento** salva soltanto un piccolo record tecnico condiviso
`suggerimento_stato`, con l'identificativo della fotografia nascosta. Non viene salvata una
copia del titolo, del conteggio o dell'azione. La scelta converge quindi tramite il normale log
append-only e non può occultare una futura situazione diversa.

**Ignora tutte** applica la stessa regola a tutte le card visibili, ma le registra in un solo
batch atomico per non moltiplicare flush, eventi e lavoro di sincronizzazione.

Le impostazioni sono salvate nel `localStorage` applicativo del solo PC e propagate soltanto
fra le sue finestre Tauri. Non creano record `impostazioni` e non passano da OneDrive. Il modale
permette di:

- mostrare o nascondere ciascuna categoria (Provvigioni e Preventivi disattivate di default);
- abilitare campanella, suono e pop-up per le azioni;
- scegliere da 0 a 90 giorni di attesa per ogni categoria;
- ripristinare le soglie predefinite tramite il pulsante **«Ripristina predefiniti»**.

Per i preventivi la soglia usa giorni civili locali ed è applicata ai singoli candidati prima
dell'aggregazione della card; `0` significa disponibilità immediata. «Controlla ora» include
temporaneamente anche i candidati sotto soglia.
La stessa soglia è modificabile anche dalle Impostazioni generali, senza richiedere Premium; il
valore di compatibilità `giorniSollecitoPreventivi` e quello dei suggerimenti vengono aggiornati
insieme, mentre la classificazione continua a usare un solo valore operativo.
La marcatura manuale viene proposta soltanto dopo il salvataggio riuscito del preventivo in PDF
o PNG; la stampa e l'annullamento del salvataggio non modificano lo stato di invio.

Le card della Dashboard e le relative notifiche rispettano i giorni di soglia impostati:
prima del raggiungimento della soglia la card non compare in Dashboard, a meno che l'operatore
non forzi il ricalcolo cliccando su «Controlla ora». Anche con soglia zero il core rivalida la
condizione per 60 secondi dopo l'ultima modifica sostanziale o la prima comparsa locale della
nuova fotografia. Questo copre anche le card residue dopo un'azione parziale ed evita avvisi
durante una transazione ancora in assestamento. La derivazione viene ripetuta sullo stato
corrente prima dell'avviso: un'azione già risolta non genera quindi notifiche tardive.

Le notifiche riusano integralmente il sistema esistente: id stabile, stato letto/scartato
per utente, campanella, finestra notifiche, suono unico Rust, overlay custom e deep-link. Gli
stati letti FASE 14 seguono la retention temporale e non sono trattati come record `notifica`
orfani.

## 5. Comunicazioni di spedizione

Ogni spedizione espone un fingerprint condiviso calcolato da:

- identità e data della spedizione;
- corriere e cliente;
- righe e numeri lotto inclusi.

Il fingerprint è usato sia dall'elenco Spedizioni sia dal motore dei suggerimenti. Soltanto un
invio riuscito del modello `preavviso_spedizione` aggiorna sul record condiviso:

- `ultimo_avviso_ms`;
- `ultimo_avviso_canale`;
- `ultimo_avviso_fingerprint`.

Una comunicazione multipla conserva tutte le spedizioni correlate e, dopo il successo, aggiorna
ciascuna col proprio fingerprint. In questo modo i colli raggruppati non restano erroneamente da
avvisare e un contenuto modificato torna correttamente tra i suggerimenti. Coda, errori e
cronologia completa rimangono locali alla postazione come previsto dalla FASE 11.

## 6. Riuso delle logiche esistenti

Il motore compatto delega deliberatamente:

- selezione e importi di contrassegni/assegni a `contrassegni_dto`;
- maturazione e calcolo delle provvigioni a `provvigioni_report`;
- linee produttive a `linee_ordini`;
- follow-up e solleciti preventivi a `classificaSollecitiPreventivi` e marcatura con `preventivo_marca_inviato_manuale`;
- navigazione ai normali deep-link delle pagine;
- invio e marcatura degli avvisi al motore Comunicazioni.

Non esistono quindi formule parallele per provvigioni, una seconda deduplicazione, una nuova
coda di produzione o un nuovo sistema di comunicazioni.

## 7. Verifica

La fase comprende test automatici per:

- stabilità e invalidazione degli identificativi derivati;
- fingerprint di spedizione indipendente dall'ordine delle righe;
- ranking deterministico;
- conversione del piano di deduplicazione in una sola card;
- unione, filtro dei nascosti e ordinamento frontend;
- filtro locale delle categorie, batch «Ignora tutte» e convergenza del solo stato nascosto;
- gate Premium su UI, comandi, worker e scansione di background;
- preferenze locali validate, soglie 0–90 giorni e rivalidazione anti-avviso immediato;
- campanella, overlay custom, stato letto/scartato e deep-link dei suggerimenti;
- invalidazione selettiva della cache e worker unico dei duplicati;
- aggiornamento condiviso dei fingerprint di tutte le spedizioni di un invio multiplo.

La consegna richiede inoltre suite frontend e Rust complete, typecheck, build di produzione,
formattazione e Clippy con warning trattati come errori.
