# PharmaTek — Manuale funzionale completo dell'interfaccia

> Documento di analisi funzionale della UI, destinato a formazione, assistenza e manutenzione.
> Revisione: 27 luglio 2026.

## Come leggere questo manuale

Questo documento descrive ciò che l'operatore vede, che cosa può fare e quali conseguenze produce ogni azione. Non è una guida al codice: i nomi tecnici compaiono soltanto quando aiutano a identificare senza ambiguità una finestra o un flusso.

Le funzioni sono descritte con la seguente convenzione:

- **Scopo**: perché esiste la schermata.
- **Come si apre**: da dove vi accede l'utente.
- **Comandi**: cosa può fare l'utente.
- **Regole**: controlli, automatismi e dipendenze.
- **Effetti**: cosa cambia dopo il salvataggio.
- **Errori e protezioni**: come l'app evita operazioni incomplete o distruttive.

Il manuale distingue inoltre tre tipi di superficie:

1. **Pagina**: occupa l'area centrale della finestra principale.
2. **Modale o popover**: si sovrappone alla pagina e deve essere concluso o chiuso.
3. **Finestra separata**: può restare aperta mentre l'utente continua a lavorare nella finestra principale.

---

# Parte I — Modello mentale dell'applicazione

## 1. La struttura generale

PharmaTek è un gestionale desktop organizzato intorno al ciclo di vita dell'ordine:

```text
Anagrafiche
    ↓
Creazione ordine nel Giornaliero
    ↓
Acconto e condizioni economiche
    ↓
Produzione
    ↓
Preparazione e spedizione
    ↓
Incassi, distinte, provvigioni e rimborsi
```

Il menu principale espone otto pagine sui PC premium e sette sugli altri:

| Pagina | Scopo sintetico |
|---|---|
| Dashboard | Riepilogo operativo e attività urgenti |
| Giornaliero | Inserimento, ricerca e gestione degli ordini |
| Preventivi | Preparazione, stampa, invio e sollecito dei preventivi; solo premium |
| Produzione | Preparazione e avanzamento delle righe da produrre |
| Spedizioni | Composizione dei colli e storico delle spedizioni |
| Contabilità | Incassi, distinte, provvigioni e rimborsi |
| Anagrafiche | Archivi di soggetti, prodotti, conti e corrieri |
| Impostazioni | Preferenze, notifiche, backup e amministrazione postazioni |

L'anno selezionato nella barra laterale costituisce un contesto globale. Quando è impostato a **Tutti gli anni**, le pagine compatibili non limitano i dati a una singola annualità. I filtri locali di una pagina possono restringere ulteriormente il risultato.

## 2. Dati condivisi e lavoro da più computer

L'applicazione è pensata per più postazioni. Ogni operazione viene prima resa disponibile localmente e poi sincronizzata nella cartella dati condivisa. L'utente deve quindi distinguere:

- **salvataggio**: l'operazione è stata accettata dalla postazione;
- **sincronizzazione**: la modifica è stata propagata o recepita dalle altre postazioni;
- **offline**: si può continuare a lavorare sulle funzioni disponibili, ma l'allineamento è rinviato;
- **blocco coordinato**: durante un ripristino tutte le postazioni devono sospendere le modifiche.

Le modifiche provenienti da altri computer possono aggiornare elenchi e conteggi senza che l'utente cambi pagina.

## 3. Regole comuni delle schermate

### 3.1 Caricamento e rivelazione

Le pagine attendono i dati necessari prima di mostrare il contenuto definitivo. Questo evita tabelle temporaneamente vuote e conteggi incoerenti. Se una lettura tarda, la UI mantiene un feedback di caricamento e impedisce che l'utente interpreti l'assenza momentanea dei dati come un archivio vuoto.

### 3.2 Ricerca e filtri

Le ricerche testuali vengono applicate con un breve ritardo dopo la digitazione. I filtri:

- possono essere combinati;
- sono segnalati quando attivi;
- possono essere azzerati;
- in alcune pagine vengono ricordati secondo la preferenza personale;
- operano sui dati dell'anno selezionato, salvo esplicita scelta diversa.

### 3.3 Tabelle

Le tabelle possono offrire:

- ordinamento cliccando l'intestazione;
- colonne configurabili;
- righe espandibili;
- menu azioni;
- apertura del dettaglio;
- esportazione o stampa;
- caricamento progressivo/virtualizzato per archivi grandi.

Il click su una riga e il click sui pulsanti della riga hanno ruoli diversi: il primo apre o seleziona il record; i secondi eseguono azioni puntuali.

### 3.4 Salvataggio, annullamento ed eliminazione

I moduli distinguono tra:

- **Annulla/Chiudi**: scarta ciò che non è stato salvato;
- **Salva**: valida e registra;
- **Elimina**: richiede conferma quando l'effetto è distruttivo;
- **Sposta nel Cestino**: eliminazione reversibile;
- **Elimina definitivamente**: rimozione non ripristinabile.

I pulsanti di conferma possono essere disabilitati quando mancano campi obbligatori o è in corso un'altra operazione.

---

# Parte II — Avvio, accesso e cornice dell'app

## 4. Avvio dell'applicazione

All'apertura PharmaTek verifica ambiente desktop, configurazione, cartella dati, identità della postazione e stato di eventuali ripristini.

### 4.1 Stati possibili

- **Ambiente non desktop**: avvisa che l'app deve essere eseguita come applicazione installata.
- **Errore di inizializzazione**: mostra il problema e permette di riprovare.
- **Cartella dati non disponibile**: permette di riprovare o di tornare alla configurazione.
- **Postazione non più autorizzata**: richiede il ricollegamento.
- **Primo avvio**: avvia l'onboarding.
- **Ripristino in corso**: mostra un blocco non ignorabile.
- **Avvio normale**: apre la shell e, se necessario, le novità della versione.

La funzione **Riprova** riesegue i controlli senza modificare i dati. Il reset della configurazione è invece un'azione amministrativa e non equivale a cancellare gli archivi condivisi.

## 5. Onboarding iniziale

L'onboarding collega la postazione all'archivio e a un utente.

### 5.1 Selezione cartella dati

L'utente seleziona la cartella condivisa. PharmaTek verifica che sia accessibile e adatta a ospitare i dati. Se la cartella non supera il controllo, non è possibile avanzare.

### 5.2 Identità utente

Il campo **Nome utente** individua chi sta operando. Se il nome esiste già, l'interfaccia propone:

- uso dell'utente esistente;
- riconfigurazione del profilo;
- scelta di un nome diverso per creare un nuovo utente.

Questa distinzione evita la duplicazione involontaria di uno stesso operatore.

### 5.3 Avatar

L'utente sceglie un avatar predefinito, le iniziali oppure un'immagine. L'anteprima mostra il risultato prima della conferma.

### 5.4 Conferma

Il pulsante finale salva il collegamento tra utente e postazione. Durante il salvataggio la navigazione è bloccata per impedire doppi invii.

## 6. Barra laterale

La barra laterale contiene il menu e l'anno di lavoro.

- Il comando nella topbar alterna la visualizzazione estesa e compatta.
- In modalità compatta le icone restano utilizzabili e mostrano tooltip.
- La voce attiva evidenzia la pagina corrente.
- Il selettore anno aggiorna il contesto dei moduli.

### 6.1 Modale dell'anno

Quando occorre aggiungere il nuovo anno, la modale propone l'operazione in modo esplicito. L'aggiunta rende l'anno selezionabile; non duplica automaticamente gli ordini dell'anno precedente.

## 7. Barra superiore

### 7.1 Menu

Mostra o nasconde le etichette della barra laterale e recupera spazio per le pagine dense.

### 7.2 Ricerca globale

Il campo apre Spotlight. Non filtra la pagina sottostante: serve a cercare in tutta l'app o a eseguire comandi.

### 7.3 Stato sincronizzazione

L'indicatore mostra lo stato generale. Aprendolo si ottiene:

- stato dell'allineamento;
- tempo dall'ultimo evento;
- elenco delle postazioni;
- identità e attività recente;
- comando per scrivere a una postazione, quando disponibile.

### 7.4 Cestino

L'icona mostra il numero degli elementi eliminati. Il popover permette una consultazione rapida; la finestra dedicata offre più spazio.

Per ogni elemento sono disponibili:

- **Ripristina**, che rimette il record nell'archivio;
- **Elimina definitivamente**, con conferma;
- **Svuota cestino**, che rimuove tutti gli elementi e richiede conferma rafforzata.

### 7.5 Notifiche

La campanella mostra il numero delle notifiche non lette, limitando visivamente il badge a `99+`. Il pannello consente di leggere, aprire l'elemento collegato e gestire lo stato letto/non letto.

### 7.6 Menu profilo

Consente di modificare profilo e avatar e di accedere alle azioni personali previste dalla sessione.

---

# Parte III — Dashboard

## 8. Scopo e comportamento

La Dashboard sintetizza ciò che richiede attenzione. I suoi numeri non sono record indipendenti: derivano da ordini, pagamenti, produzione, spedizioni e promemoria.

## 9. Indicatori e grafici

Le card mostrano quantità e importi per periodi selezionabili. Quando una card è cliccabile, apre il modulo di dettaglio coerente con quel dato.

I grafici permettono di:

- cambiare periodo o metrica;
- confrontare volumi e importi;
- leggere valori tramite tooltip;
- passare dal riepilogo al dettaglio operativo.

Un valore pari a zero non indica necessariamente un errore: può dipendere dall'anno, dal periodo o dall'assenza di record nello stato richiesto.

### 9.1 Navigazioni dalla Dashboard

Ogni elemento interattivo mantiene il contesto con cui è stato calcolato:

- **Ordini** apre il Giornaliero sul periodo visualizzato.
- **Da saldare** apre Contabilità → Pagamenti sulle voci attese.
- **In produzione** apre Produzione.
- **Provvigioni maturate** apre Contabilità → Provvigioni sul periodo visualizzato.
- Un punto dell'andamento ordini/incassi apre il Giornaliero sul mese o intervallo del punto.
- Il donut **Per stato** apre il Giornaliero sullo stato scelto; il donut **Da saldare** distingue spediti a rischio e non spediti.
- La classifica **Agenti** apre le provvigioni dell'agente scelto; la classifica **Regioni** apre il Giornaliero filtrato per regione.
- Le righe di **Ultimi ordini** e **Scaduti da saldare** aprono l'ordine; il collegamento **Vai ai crediti** apre le sole scadenze scadute.

I selettori dei grafici sono locali alla Dashboard: non alterano permanentemente i filtri delle altre pagine.

### 9.2 Azioni suggerite

Il pannello **Azioni suggerite** raccoglie attività già ricavabili dai dati: rimborsi aperti,
incassi da mettere in distinta, provvigioni maturate, righe pronte per un lotto, spedizioni da
comunicare e possibili clienti duplicati. Non è una seconda lista da aggiornare a mano.

Le card sono ordinate per priorità e raggruppano situazioni simili. Il pulsante della card apre
direttamente la pagina e il filtro necessari per completare il lavoro. All'inizio vengono mostrate
al massimo cinque azioni; **Mostra altre** espande l'elenco.

Il pulsante **Nascondi fino al prossimo cambiamento** rimuove la fotografia corrente per tutte le
postazioni sincronizzate. Se i dati coinvolti cambiano in modo sostanziale, il suggerimento torna
visibile; se il lavoro viene completato o le sorgenti non esistono più, scompare automaticamente.

**Ignora tutte** nasconde in una sola operazione tutte le azioni attualmente visibili, sempre
fino al prossimo cambiamento dei rispettivi dati. Dal pulsante con l'ingranaggio si scelgono le
categorie, si abilitano le notifiche e si impostano i giorni di attesa per ciascun tipo. Queste
preferenze valgono soltanto sul PC corrente; lo stato delle fotografie ignorate resta condiviso.

L'intero pannello è disponibile soltanto sui PC con Premium. Le azioni che hanno raggiunto la
soglia locale compaiono anche nella campanella e nei pop-up custom, con lo stesso stato
letto/scartato e lo stesso collegamento della card. Una spedizione già
comunicata torna tra le azioni solo quando ne cambia il contenuto rilevante. La cronologia
dettagliata degli invii resta locale al PC che li ha eseguiti.

## 10. Bacheca promemoria

La bacheca riunisce promemoria manuali e segnalazioni operative.

### 10.1 Azioni rapide

- Nella bacheca completa della Dashboard, un clic sul corpo del promemoria espande una scheda
  riepilogativa inline; un secondo clic la richiude e l'apertura di una riga chiude quella precedente.
  Il riepilogo mostra priorità, scadenza, anticipo, ricorrenza, autore e soggetto collegato, senza
  richieste dati aggiuntive. La variante compatta usata nelle schede collegate non si espande.
- **Nuovo** apre il modulo del promemoria.
- **Fatto** conclude un promemoria.
- **Apri collegato** porta all'ordine o al record associato.
- **Modifica** riapre il modulo.
- **Posticipa** offre `+1 giorno`, `+7 giorni` o una data scelta.
- **Risolvi** azzera una segnalazione operativa collegata.

La bacheca completa della Dashboard ha tre insiemi distinti:

- **Solleciti**, derivati da pagamenti da gestire;
- **Segnalazioni**, derivate dai marcatori degli ordini;
- **Promemoria**, creati dagli utenti e non ancora completati.

Il sottotitolo mostra il totale delle cose da seguire. I dati vengono aggiornati quando un ordine o un promemoria viene salvato da un'altra vista o postazione. Con un anno globale specifico, la bacheca limita promemoria e segnalazioni al contesto annuale pertinente.

L'espansione si chiude prima di **Fatto**, **Posticipa**, **Modifica** o **Apri collegato**. Si chiude
anche quando un aggiornamento remoto completa o rimuove il promemoria. L'animazione rispetta
**Riduci animazioni** e in quel caso diventa immediata.

Per i promemoria ricorrenti, **Fatto** non li elimina definitivamente: completa l'occorrenza e indica quando arriverà il prossimo avviso. Il posticipo imposta un periodo di silenzio fino alla nuova data.

### 10.2 Notifica ad altri utenti

Il pulsante **Notifica…** nella Bacheca del team non crea un messaggio libero: invia agli altri utenti le notifiche operative già disponibili nella Dashboard.

La modale carica pagamenti, promemoria, ordini e utenti e permette di selezionare una o più categorie:

- **Solleciti** per scadenze di pagamento;
- **Segnalazioni** per marcatori e situazioni operative;
- **Promemoria** attivi.

Accanto a ciascuna categoria appare il numero di notifiche pronte; una categoria senza elementi non può essere selezionata. L'utente può scegliere:

- **Tutti**, che invia a ogni altro utente disponibile;
- **Scegli utenti**, che abilita una selezione multipla e ricercabile.

Il pulsante **Invia** rimane disabilitato finché non esiste almeno una notifica selezionata e almeno un destinatario. Alla conferma, PharmaTek riattiva le notifiche selezionate per i destinatari, emette l'aggiornamento alle altre finestre ed esegue un controllo notifiche. Non modifica l'ordine, il pagamento o il promemoria sorgente: ne amplia soltanto la visibilità presso gli utenti scelti.

## 11. Modale promemoria

Permette di definire:

- titolo o testo;
- data e ora;
- priorità;
- destinatario o ambito;
- eventuale collegamento a un record;
- ripetizione, se prevista dal tipo selezionato.

Il salvataggio aggiorna la bacheca e il sistema notifiche. La chiusura senza salvataggio non crea il promemoria.

---

# Parte IV — Giornaliero e ordine

## 12. Pagina Giornaliero

Il Giornaliero è il registro operativo degli ordini.

### 12.1 Creazione ordine

Il menu **Nuovo ordine** consente di scegliere il tipo o la linea prevista. L'editor può aprirsi in modale o in finestra separata secondo le preferenze.

### 12.2 Ricerca e filtri

La ricerca lavora sui principali identificativi dell'ordine. I filtri possono includere stato, periodo, soggetti collegati, linee e segnalazioni. Il selettore di vista consente di cambiare raggruppamento o insieme operativo.

### 12.3 Colonne

Il menu colonne mostra o nasconde informazioni senza cancellarle. La configurazione è personale e serve ad adattare il Giornaliero al ruolo dell'operatore.

### 12.4 Azioni di riga

Le azioni disponibili dipendono dallo stato dell'ordine:

- aprire o modificare;
- registrare un pagamento;
- creare una sostituzione;
- impostare o risolvere marcatori;
- rifiutare;
- spostare nel Cestino.

Un ordine rifiutato resta nello storico e mostra la motivazione. Un ordine cestinato scompare dalle viste normali ma può essere ripristinato.

## 13. Pipeline di stato

La pipeline rende visibile il punto del ciclo in cui si trova l'ordine. Gli stati non sono semplici etichette: alcune transizioni dipendono da acconto, righe producibili, compilazione dei dati di produzione e spedizione.

L'utente deve correggere la causa di un blocco anziché forzare un passaggio non ammesso.

## 14. Editor dell'ordine

L'editor raccoglie intestazione, soggetti, righe, condizioni economiche e note. La finestra separata consente di mantenere aperto un ordine mentre si consultano altri moduli.

### 14.1 Identificazione cliente e medico

I campi di ricerca propongono record esistenti. Accanto alla selezione sono disponibili, secondo il contesto:

- modifica del record scelto;
- creazione di un nuovo cliente;
- creazione o modifica del medico.

Le modali **Nuovo cliente/Modifica cliente** e **Nuovo medico/Modifica medico** usano le stesse regole delle Anagrafiche. Al salvataggio, il record viene selezionato nell'ordine.

#### Come funziona la scelta del cliente

Il cliente non è soltanto un testo riportato sull'ordine: è un collegamento all'anagrafica. La selezione dall'elenco consente quindi di riutilizzare indirizzo, recapiti, codice fiscale/partita IVA e note di spedizione senza riscriverli.

Ogni cliente conserva anche l'ultimo medico utilizzato in un suo ordine. Quando l'operatore sceglie il cliente:

1. PharmaTek cerca il campo **ultimo medico** memorizzato sul cliente;
2. se quel medico esiste ancora, lo seleziona automaticamente;
3. la scelta del medico determina a sua volta l'agente;
4. eventuali prezzi automatici delle righe vengono valutati nel nuovo contesto;
5. per Immunoterapia possono essere recuperati i dati di mantenimento storici.

L'associazione “ultimo medico” viene aggiornata al salvataggio dell'ordine corrente. È un aiuto operativo, non un vincolo: il medico può essere cambiato manualmente.

Per gli ordini di **Diagnostica** il modello è diverso: il medico o l'azienda costituisce anche il cliente e destinatario. Per questo la UI non richiede un cliente separato e presenta il campo come **Medico o azienda (cliente e destinatario)**.

#### Come funziona la scelta del medico

Il medico determina automaticamente l'**agente di riferimento**. Il campo agente nell'ordine è quindi mostrato in sola lettura e viene riallineato quando:

- si seleziona un medico diverso;
- si crea un nuovo medico dall'ordine;
- si modifica il medico selezionato cambiandone l'agente.

La scelta del medico influenza anche prezzi, conto preferito e numero predefinito di rate del saldo.

#### Protezione dei dati compilati manualmente

Quando cambia il medico, PharmaTek confronta per ogni riga:

- il prezzo automatico previsto con il vecchio medico;
- il prezzo presente nella riga;
- il prezzo automatico previsto con il nuovo medico.

Il nuovo prezzo viene applicato soltanto se quello corrente è vuoto oppure coincide ancora con il precedente prezzo automatico. Se l'operatore ha digitato un prezzo diverso, quel valore viene considerato una modifica intenzionale e non viene sovrascritto.

Lo stesso principio vale quando cambia il prodotto: il prezzo si aggiorna se era vuoto o ancora automatico; resta invariato se era stato personalizzato.

#### Creare o modificare senza abbandonare l'ordine

Premendo il comando accanto al campo:

- **Nuovo cliente/medico** apre un modulo vuoto;
- **Modifica** apre il record selezionato con tutti i campi precompilati;
- gli stessi controlli di validità delle Anagrafiche vengono applicati anche qui;
- dopo la creazione, il nuovo record viene selezionato automaticamente;
- dopo la modifica, l'elenco locale dell'editor viene aggiornato subito.

Una modifica eseguita qui cambia l'anagrafica condivisa, non soltanto la copia visualizzata nell'ordine. Per cambiare esclusivamente i dati fiscali di una fattura si deve usare invece la sezione **Dati di fatturazione diversi**.

### 14.2 Dati dell'ordine

Comprendono numero, data, cliente, medico, agente, destinazione, dati fiscali e opzioni pertinenti. I campi obbligatori sono validati; in caso di errore la UI porta l'attenzione sul primo campo non valido.

### 14.3 Righe prodotto

Ogni riga identifica prodotto, quantità, prezzo e dati specialistici. Le regole prezzo possono proporre un valore derivato dal contesto; l'utente deve verificare eventuali deroghe.

Per prodotti che richiedono produzione possono comparire:

- formulazione/composizione;
- posologia;
- allergeni o ceppi;
- numero o lotto;
- note tecniche;
- stato della riga.

Rimuovere una riga già coinvolta in processi successivi può richiedere conferma o essere limitato.

#### Prodotto di catalogo e prodotto libero

Il campo prodotto accetta sia una scelta dal catalogo sia testo libero:

- una corrispondenza esatta con un prodotto di catalogo collega la riga al relativo record;
- una descrizione non riconosciuta rimane un prodotto libero;
- per un prodotto libero il prezzo deve essere gestito manualmente;
- scegliendo esplicitamente un prodotto di catalogo viene proposto il prezzo applicabile.

Per Diagnostica, la scelta di un prodotto può precompilare anche il **codice Laboratorio** del catalogo, ma soltanto se il campo della riga è ancora vuoto.

#### Gerarchia del prezzo proposto

Il motore dei prezzi applica la regola più specifica disponibile:

1. regola per **medico + prodotto**;
2. regola per **agente + prodotto**;
3. prezzo standard Immunoterapia del medico, quando pertinente e non esiste una regola più specifica;
4. prezzo base del prodotto.

Il prezzo suggerito resta modificabile. La modifica manuale viene protetta dai successivi automatismi, come descritto nella sezione precedente.

#### Dati di produzione Immunoterapia

Il pannello dati di produzione è facoltativo nell'ordine, ma compilarlo riduce il lavoro successivo in Produzione. I suggerimenti provengono da:

- catalogo dei dati di produzione;
- righe già registrate;
- ultimo ordine dello stesso cliente per lo stesso prodotto.

Quando viene trovato un precedente compatibile, PharmaTek può recuperare formulazione, posologia e allergeni. Il recupero riempie soltanto i campi vuoti: ciò che l'operatore ha già inserito non viene cancellato.

#### Suggerimenti Diagnostica

Per Diagnostica vengono proposti allergeni e tipi di test già utilizzati. I valori usati in precedenza con il medico/azienda selezionato vengono portati in evidenza. Il caricamento avviene soltanto quando serve, per non appesantire gli altri tipi di ordine.

### 14.4 Totali e pagamenti

Il riepilogo economico distingue totale, incassato/acconto, previsto e residuo. Da qui si può:

- aprire la registrazione di pagamento;
- modificare una registrazione;
- creare un piano rate;
- consultare scadenze e stato.

#### Acconto suggerito

L'acconto iniziale può essere proposto automaticamente in base alle preferenze:

- del medico;
- dell'agente;
- della fascia di prezzo configurata nelle preferenze prodotti;
- del numero di prodotti;
- della categoria dell'ordine.

Il suggerimento non supera mai il totale dell'ordine. Finché l'utente non modifica manualmente l'acconto, variazioni a prodotti e totale possono aggiornare la proposta. Dopo una modifica manuale, l'automatismo smette di sovrascrivere il valore. Azzerando esplicitamente il campo è possibile ripristinare il comportamento di suggerimento previsto dall'editor.

#### Acconto concordato e acconto incassato

In un ordine nuovo l'acconto può essere:

- soltanto **concordato**, quindi inserito nello scadenzario come atteso al primo salvataggio;
- già **incassato**, attivando la spunta e indicando la data d'incasso.

Acconto concordato e denaro realmente incassato sono concetti distinti. Il primo rappresenta una previsione; il secondo concorre all'incassato.

#### Pagamento completo alla consegna

L'opzione di pagamento completo in contrassegno/COD:

- azzera la necessità di un acconto;
- destina l'intero importo al flusso di incasso alla consegna;
- usa il conto di transito/contrassegno configurato;
- produce una scadenza collegata alla spedizione.

Disattivando l'opzione, lo scadenzario viene ricostruito secondo acconto e saldo ordinari.

#### Materializzazione al primo salvataggio

Prima che un ordine nuovo sia salvato, acconto, saldo e rate sono bozze locali dell'editor. La UI lo segnala con il messaggio che entreranno nello scadenzario al salvataggio. Questo evita la creazione di pagamenti orfani per un ordine che potrebbe essere chiuso senza essere registrato.

Al primo salvataggio:

1. viene creato l'ordine;
2. vengono create le voci dello scadenzario;
3. sono registrati stato atteso/incassato, conto e scadenze;
4. il riepilogo viene riletto dai dati persistenti.

#### Riconciliazione quando cambia il totale

Se prodotti, prezzi o acconto cambiano, PharmaTek confronta il nuovo totale con la copertura di pagamenti e rate. L'app non modifica alla cieca lo storico:

- un acconto già incassato resta invariato;
- un acconto ancora atteso può essere aggiornato o rimosso;
- lo scoperto viene assorbito da saldo/rate secondo la scelta dell'utente;
- un pagamento locale non ancora salvato può essere adeguato prima della registrazione;
- i pagamenti attesi non verificati possono essere sostituiti dal nuovo piano;
- gli incassi reali non vengono cancellati automaticamente.

Se il rimborso richiesto copre già esattamente l'extra e non esistono ulteriori rate aperte eccedenti, il disallineamento è già spiegato contabilmente e il dialogo non compare. Quando invece il cambio del totale modifica l'extra, il dialogo propone **Adegua rimborso attuale**. La scelta conserva prodotti e incassi e aggiorna soltanto l'importo ancora da rimborsare. Gli importi di rimborsi già effettuati vengono sottratti dal nuovo extra e non sono riscritti automaticamente. Ordine e rimborso richiesto vengono validati e salvati nello stesso batch; se nel frattempo cambiano pagamenti, righe o rimborso, non viene applicata alcuna delle due modifiche.

#### Lettura del riepilogo

- **Totale**: somma delle righe.
- **Incassato**: pagamenti effettivamente saldati.
- **Atteso**: pagamenti e rate ancora aperti.
- **Residuo**: parte del totale non incassata.
- **Scoperto dello scadenzario**: parte del totale non coperta né da incassi né da previsioni.
- **Extra**: importi incassati oltre il totale; abilita il flusso di rimborso della differenza.

Le righe scadute vengono evidenziate. Una voce attesa può essere aperta e saldata; una voce già incassata può essere aperta per modificarne i dati consentiti.

### 14.5 Note

Le note mantengono il contesto operativo dell'ordine. Il testo salvato diventa parte dello storico condiviso. Le menzioni e gli allegati, quando disponibili, generano i relativi collegamenti o notifiche.

### 14.6 Salvataggio

Il salvataggio:

1. valida intestazione e righe;
2. registra eventuali nuovi soggetti creati nel flusso;
3. ricalcola totali e stato;
4. aggiorna le viste collegate;
5. genera l'evento da sincronizzare.

La finestra non deve essere chiusa forzatamente mentre il pulsante indica un salvataggio in corso.

Prima di chiudere un ordine con modifiche non salvate, PharmaTek avverte che verranno perse anche le modifiche locali allo scadenzario. La conferma riguarda quindi non soltanto i campi dell'ordine, ma anche pagamenti o rate preparati nell'editor e non ancora materializzati.

Su un nuovo ordine, i PC premium mostrano anche **Salva e stampa**: l'ordine viene salvato con lo
stesso flusso e, soltanto dopo il successo, si apre la scheda cliente precompilata. Sugli ordini
esistenti **Salva** e **Stampa** restano separati. Senza premium il comando Stampa è visibile ma
apre l'informativa premium senza caricare dati riservati.

## 15. Modale sostituzione

La sostituzione crea un flusso collegato a un ordine esistente.

- L'utente seleziona ciò che deve essere sostituito.
- Specifica quantità e motivazione.
- La UI riepiloga l'origine per evitare una sostituzione sul record sbagliato.
- La conferma genera le righe compensative previste e conserva il collegamento storico.

Non va usata per correggere un semplice errore di battitura in un ordine ancora modificabile.

## 16. Rifiuto ordine

Il rifiuto richiede una motivazione. Dopo la conferma:

- l'ordine assume lo stato rifiutato;
- resta ricercabile;
- non prosegue nei normali flussi di produzione e spedizione;
- la motivazione è visibile nell'editor.

---

# Parte IV bis — Preventivi e scheda cliente

## 16 bis. Pagina Preventivi

**Scopo:** preparare un documento commerciale partendo da un ordine già presente, senza
duplicare cliente, prodotti, prezzi o pagamenti.

**Come si apre:** dalla voce **Preventivi**, collocata fra Giornaliero e Produzione. La voce è
presente soltanto sui PC premium.

La tabella permette di cercare numero ordine o preventivo, cliente, medico e paziente; i filtri
restringono le linee e l'indicazione dell'invio. Ogni riga mostra:

- riferimento e data;
- cliente, medico e linee;
- totale e validità;
- ultima modifica;
- **Mai inviato**, **Inviato il …** oppure **Modificato dopo l'invio**.

Queste indicazioni non cambiano lo stato dell'ordine. Un preventivo può essere creato soltanto
quando l'ordine è `Nuovo`; se l'ordine avanza, il documento resta consultabile, stampabile e
reinviabile ma non modificabile.

### 16 bis.1 Nuovo preventivo

**Nuovo preventivo** propone soltanto ordini `Nuovo` che non ne possiedono già uno. Dopo la scelta
si apre l'editor con cliente, medico, righe, prezzi, totale, acconto e condizioni già compilati.
Ogni ordine può avere un solo preventivo corrente.

Il riquadro **Compila da testo** accetta indicazioni naturali come prodotti, quantità, prezzi,
pazienti e note. L'interpretazione avviene interamente sul PC:

1. il testo viene separato in righe;
2. prodotti e alias vengono confrontati col catalogo;
3. quantità e importi italiani vengono riconosciuti;
4. ogni proposta mostra confidenza e motivazione;
5. un risultato incerto presenta alternative e richiede una scelta.

Nessun dato ambiguo viene salvato in automatico. Se una descrizione non corrisponde al catalogo
può restare testo libero; un nuovo alias viene ricordato soltanto su conferma.

### 16 bis.2 Modifica e salvataggio

Righe, quantità e prezzi sono gli stessi dell'ordine. Salvare dall'editor aggiorna insieme
preventivo, ordine e scadenzario aperto. Pagamenti già incassati o consolidati non vengono
riscritti. Se un collega ha modificato uno dei dati mentre l'editor era aperto, l'intero
salvataggio viene fermato e va ricaricato: non rimangono aggiornamenti parziali.

### 16 bis.3 Anteprima, PDF, immagine e stampa

**Anteprima**, **Stampa preventivo**, **Salva PDF** e **Salva immagine** usano la stessa pagina A4.
Il totale è IVA inclusa; imponibile e IVA al 10% sono scorporati senza aumentarlo. Se righe o note
non entrano in una pagina, l'anteprima indica quali contenuti ridurre e blocca stampa e invio,
evitando tagli invisibili.

### 16 bis.4 Invio

**Invia** nel menu ⋯ e nell'anteprima accoda direttamente la comunicazione; nell'editor
**Salva e invia** completa prima il salvataggio e poi apre comunque l'anteprima. Il preventivo
resta salvato anche se l'invio non riesce.

- per e-mail viene allegato il PDF;
- per WhatsApp viene inviata l'immagine a pagina singola, oppure il PDF per documenti su più
  pagine;
- se entrambi i recapiti sono validi vengono accodati entrambi i canali;
- se è valido un solo recapito viene usato silenziosamente quello disponibile;
- senza recapiti validi, o in caso di errore di preparazione/accodamento, compare un toast.

**Sollecita** continua ad aprire il compositore per rivedere destinatario, canale e contenuto.
L'ultimo invio si aggiorna soltanto dopo un esito positivo; un messaggio fallito, in coda o
dall'esito incerto non fa apparire il preventivo come inviato.

### 16 bis.5 Solleciti

La campanella della toolbar somma due gruppi separati:

- **Da inviare**: preventivi mai inviati o modificati dopo l'invio, disponibili subito e
  indipendentemente dallo stato dell'ordine;
- **Da sollecitare**: preventivi inviati e invariati, collegati a un ordine `Nuovo` e più vecchi
  della soglia configurata rispetto all'ultimo invio o sollecito riuscito.

La prima finestra opera soltanto sul gruppo attivo; la revisione successiva mostra inclusi ed
esclusi e richiede una conferma. I due gruppi usano modelli diversi e non vengono mescolati nella
stessa campagna. Non esiste uno scheduler che invia campagne senza intervento dell'operatore.

## 16 ter. Scheda cliente

La scheda cliente è un documento separato dal preventivo. Si apre da:

- menu ⋯ e menu contestuale della riga nel Giornaliero;
- pulsante Stampa dell'editor ordine;
- menu ⋯ del preventivo.

Il modale precompila ricezione, paziente, spedizione, contatti, intestatario fattura, importi,
acconto, modalità di saldo, note e caselle operative. Le correzioni restano nella scheda e non
alterano automaticamente l'anagrafica cliente.

Il corpo del modale è scorrevole e il footer mantiene disponibili **Salva**, **Anteprima** e
**Stampa**. Il risultato è un A4 vettoriale che replica la struttura del modulo cartaceo: righe
per i dati generali, tabelle affiancate per importi e saldo, note e caselle operative. Quando un
dato manca, la riga o cella corrispondente resta bianca e scrivibile a penna, senza trattini o
segnaposto. Tutte le caselle selezionate restano leggibili anche in stampa. Senza premium gli
accessi dagli ordini esistenti restano visibili ma aprono l'informativa premium.

---

# Parte V — Produzione

## 17. Pagina Produzione

La pagina usa due viste principali tramite selettore e righe espandibili. I conteggi indicano gli ordini con almeno una riga nello stato della vista.

### 17.1 Ricerca e segmenti

L'operatore può restringere l'elenco e, nelle viste che lo consentono, filtrare ulteriormente lo stato produttivo. Aprendo una riga si vedono i prodotti e le informazioni necessarie alla lavorazione.

### 17.2 Compilazione produzione

La modale **Compila produzione** raccoglie i dati delle righe selezionate.

Regole principali:

- segnala un acconto non ancora registrato;
- richiede i dati obbligatori del prodotto;
- evita la conferma di righe incomplete;
- assegna o propone il numero di produzione;
- aggiorna lo stato soltanto dopo un salvataggio riuscito.

### 17.3 Avanzamento e annullamento

Le azioni di avanzamento trasferiscono le righe alla fase successiva. L'annullamento riporta la riga allo stato precedente soltanto quando non entra in conflitto con spedizioni o altri eventi successivi.

### 17.4 Feedback visivo

Le animazioni di completamento confermano l'operazione, ma non sostituiscono il dato: in caso di dubbio va verificato il badge di stato e l'eventuale presenza nella vista successiva.

---

# Parte VI — Spedizioni

## 18. Pagina Spedizioni

Le viste principali sono **Da spedire** ed **Effettuate**.

### 18.1 Da spedire

Mostra ordini e righe pronti per la preparazione. Diagnostica e Keriba sono normalmente escluse dal flusso ordinario; il toggle dedicato le rende visibili quando serve.

Sono disponibili ricerca per destinatario/ordine/regione, filtro corriere e intervallo di date.
La colonna tecnica **Apri ordine** mantiene una larghezza fissa durante il ridimensionamento delle altre colonne, come la colonna di selezione.

### 18.2 Raggruppamento destinatari

Gli elementi dello stesso destinatario possono essere trattati insieme. La modale **Unisci / separa destinatari** consente di controllare esplicitamente quali record compongono il gruppo.

- Unire riduce spedizioni duplicate.
- Separare mantiene colli distinti anche in presenza di dati simili.
- La selezione deve essere verificata prima della conferma.

### 18.3 Creazione spedizione

La modale riepiloga destinatario, corriere, colli, righe incluse, contrassegno e note. La conferma marca le righe incluse come spedite e crea il record di spedizione.

### 18.4 Aggiungi collo

Permette di creare un collo anche fuori dal normale insieme “Da spedire”. I campi includono:

- destinatario e indirizzo;
- CAP, città, provincia e regione;
- telefono ed e-mail;
- numero/vaccino;
- numero colli;
- preavviso telefonico;
- pagamento alla consegna e importo;
- note di spedizione.

Il destinatario può essere derivato da un ordine oppure compilato manualmente. L'importo del contrassegno è richiesto quando il pagamento alla consegna è attivo.

### 18.5 Dettaglio gruppo

La riga espansa consente di:

- controllare prodotti e numeri/lotti;
- rimuovere un elemento dal collo;
- aprire l'ordine;
- gestire unione/separazione;
- annullare il gruppo quando consentito.

La rimozione dal collo non elimina la riga d'ordine: la riporta tra gli elementi da organizzare.

### 18.6 Modifica dati spedizione

Il pannello di modifica consente di correggere destinazione, contatti, colli, peso, preavviso e lotti. Il salvataggio modifica il record di spedizione, non necessariamente l'anagrafica cliente originaria.

### 18.7 Note di spedizione

Il campo “Cosa vuole il cliente?” conserva istruzioni utili al corriere o alla preparazione. Le note vanno mantenute operative e prive di informazioni non necessarie.

### 18.8 Contrassegno

La modale permette di impostare metodo di incasso e importo. Questi dati alimentano la riconciliazione contabile delle distinte.

### 18.9 Spedizioni effettuate

Lo storico consente filtri e apertura del dettaglio. Le azioni di annullamento:

- chiedono conferma;
- ripristinano le righe come da spedire;
- devono essere usate prima di registrare eventi contabili incompatibili.

Il riepilogo incassi per conto/agente aiuta a confrontare quanto spedito con quanto contabilizzato.

### 18.10 Bollettazione automatica

Sui PC con Premium, accanto a **Crea spedizione** è disponibile **Bollettazione automatica**.
Selezionare insieme uno o più file `.xlsx` ricevuti dal laboratorio; i file vengono soltanto
letti e non sono copiati nella cartella dati o nei backup.

La revisione divide le righe in **Pronti**, **Da controllare**, **Non trovati** e **Già
registrati**. Prima di procedere occorre associare o saltare le righe dubbie e scegliere, per
ogni dato diverso, se mantenere il valore del gestionale o usare quello del file. Quantità
incompatibili, riferimenti duplicati su altre righe e prodotti non presenti nel catalogo non
vengono applicati automaticamente.

Dal footer si può:

- scegliere la data e premere **Segna come arrivati** per aggiornare produzione e ordine;
- premere **Prepara spedizione** per aprire la normale modale **Crea spedizione**, già compilata
  con righe e numeri lotto revisionati.

La creazione dei colli conserva gli stessi controlli del flusso manuale. Se una riga o un ordine
cambiano nel frattempo, oppure un collo non è valido, l'intera conferma viene rifiutata senza
lasciare aggiornamenti o spedizioni parziali. Chiudere la revisione o la modale prima della
conferma non salva nulla. Lo stesso flusso può essere avviato da Spotlight cercando
**Bollettazione automatica**.

---

# Parte VII — Contabilità

## 19. Hub Contabilità

L'hub contiene quattro schede:

1. **Pagamenti**
2. **Distinte**
3. **Provvigioni**
4. **Rimborsi**

Il cambio scheda non altera i dati; cambia soltanto la prospettiva operativa.

## 20. Pagamenti

La pagina elenca incassi, previsioni e scadenze. I filtri includono ricerca, agenti, medici, conti, stato, linee e intervallo date.

Il controllo **Verificato in prima nota** segnala l'avvenuto confronto con la registrazione contabile esterna. Non equivale a incassare una scadenza.

### 20.1 Modale pagamento

I campi principali sono:

- **Tipo**;
- **Importo**;
- **Conto** o **Conto previsto**;
- **Data incasso** per movimenti saldati;
- **Scadenza prevista** per movimenti futuri;
- **Verificato in prima nota**;
- **Collega la scadenza alla data di spedizione**;
- **Note**.

Il tipo modifica i campi pertinenti. Una previsione legata alla spedizione calcola la scadenza a partire dall'evento di spedizione, evitando una data assoluta prematura.

La modifica mantiene l'identità del movimento. **Elimina** richiede conferma e ricalcola saldo e stato dell'ordine.

#### Tipi di movimento

Il campo **Tipo** distingue:

- **Acconto**: quota iniziale collegata anche al valore acconto dell'ordine;
- **Saldo**: pagamento della parte restante non rateizzata;
- **Rata**: singola quota di un piano dilazionato.

Il tipo descrive la funzione economica della voce; lo stato **Atteso/Incassato** dice invece se il denaro è già stato ricevuto.

#### Movimento atteso

Un movimento atteso contiene:

- importo;
- conto previsto;
- scadenza fissa oppure collegata alla futura spedizione;
- note.

Non richiede una data d'incasso e non può essere marcato come verificato in prima nota, perché l'incasso non è ancora avvenuto.

#### Movimento incassato

Un movimento incassato richiede:

- importo maggiore di zero;
- conto effettivo;
- data d'incasso;
- eventuale spunta **Verificato in prima nota**.

Se il conto è di transito, come contrassegno o assegno, la UI avverte che normalmente l'accredito viene gestito tramite distinta del corriere. L'utente può annullare oppure scegliere **Registra comunque**. Questa protezione evita che un incasso in attesa di accredito venga trattato per errore come già disponibile sul conto definitivo.

#### Conto proposto automaticamente

Il conto viene risolto con una gerarchia di preferenze:

1. conto preferito del medico;
2. conto preferito dell'agente;
3. conto predefinito per acconti o incassi;
4. conto bancario di ripiego disponibile.

Per un pagamento atteso il conto resta una destinazione prevista. Può essere corretto quando il denaro viene effettivamente incassato.

#### Scadenza collegata alla spedizione

Per saldo e rate attesi, la spunta **Collega la scadenza alla data di spedizione** lascia la scadenza in forma relativa finché l'ordine non parte.

- Conto ordinario: scadenza normalmente a spedizione `+7 giorni`.
- Conto contrassegno/assegno: scadenza normalmente a spedizione `+30 giorni`.

Se l'ordine è già spedito, la data effettiva può essere calcolata subito. Altrimenti la UI mostra una data approssimativa e la fissa quando riceve l'evento di spedizione.

#### Controllo di copertura

Ogni volta che si crea o modifica un pagamento, PharmaTek confronta:

```text
somma di incassi e attesi
              ↕
        totale dell'ordine
```

Se le due cifre non coincidono, l'operatore viene guidato a scegliere come riallinearle. In base alla situazione può:

- adeguare il totale prodotti alla copertura;
- adeguare il rimborso extra ancora richiesto, quando il nuovo totale cambia l'eccedenza;
- dilazionare la differenza sull'ultima rata aperta;
- mantenere l'importo e creare un residuo con scadenza successiva;
- annullare e tornare al modulo.

Se l'incasso genera un extra e per l'ordine esiste già un rimborso ancora richiesto, la scelta relativa all'eccedenza mostra l'importo corrente e quello risultante e aggiorna quel rimborso, senza crearne un duplicato. I rimborsi già effettuati vengono conservati e sottratti dalla quota ancora da richiedere. **Correggi l'incasso al residuo** non viene proposto quando il residuo è zero, perché non è possibile registrare un pagamento di importo nullo.

Un nuovo acconto parziale, quando è la prima voce dell'ordine, è ammesso senza forzare subito la copertura dell'intero totale: la parte restante sarà rappresentata dal saldo.

#### Effetti della modifica

Modificare importo o stato può cambiare:

- totale incassato;
- residuo;
- stato di pagamento dell'ordine;
- scadenze e solleciti;
- eventuale scoperto da coprire;
- disponibilità dell'azione di rimborso.

Dopo il salvataggio viene emesso un aggiornamento alle viste in ascolto, così una notifica di pagamento scaduto può sparire immediatamente quando la voce viene saldata o annullata.

#### Modifiche da più postazioni e protezioni

Se due operatori modificano lo stesso form, PharmaTek non mostra un banner di conflitto: ogni
salvataggio contiene soltanto i campi effettivamente cambiati. Sullo stesso campo prevale
l'ultimo salvataggio; i valori aggiornati altrove negli altri campi vengono conservati.

Restano protette le condizioni che rappresentano uno stato contabile o logistico già concluso:

- una rata già incassata non viene sostituita dalla rateizzazione;
- una riga già spedita non può entrare in un secondo collo;
- un record eliminato non può essere salvato nuovamente dal form rimasto aperto;
- un pagamento incluso in una distinta non può essere modificato o annullato finché la distinta
  non viene eliminata.

Queste condizioni non usano box persistenti all'inizio del form. Un record eliminato produce un
toast visibile sopra le modali e il dettaglio viene chiuso; nella finestra separata del pagamento
viene usato un dialog centrale prima della chiusura. Un'operazione divenuta non valida produce un
toast di errore e lascia il modulo aperto per il controllo. Un pagamento già incluso in distinta
si apre invece in **sola lettura**, con badge nel footer sempre visibile. Le conferme che richiedono
una decisione (per esempio un incasso manuale su conto di transito) restano modali.

#### Annullamento e rimborso associato

**Annulla pagamento** sposta il movimento nel Cestino e ricalcola automaticamente incassato, residuo e stato. Se l'ordine possiede un rimborso per denaro incassato in eccesso:

- la UI avverte che viene meno il presupposto del rimborso;
- chiede una conferma specifica;
- annulla anche il rimborso associato;
- segnala con maggiore evidenza il caso in cui il rimborso risulti già effettuato.

### 20.2 Finestra pagamento

Quando la preferenza “apri in finestra separata” è attiva, lo stesso modulo viene ospitato in una finestra dedicata. Il salvataggio notifica la pagina principale, che aggiorna i dati.

### 20.3 Rateizzazione

La modale consente di scegliere:

- numero rate;
- giorni tra le rate;
- prima scadenza assoluta o relativa alla spedizione;
- importo e data di ogni rata nell'anteprima.

L'anteprima è modificabile. La somma delle rate deve coincidere con l'importo da pianificare; gli arrotondamenti vengono assorbiti senza lasciare centesimi non assegnati.

#### Quale importo viene rateizzato

**Rateizza saldo** sostituisce il saldo atteso corrente con più rate. L'importo proposto corrisponde alla parte di saldo ancora pianificabile, non all'intero totale storico dell'ordine.

**Aggiungi rate** compare invece quando un ordine già salvato presenta uno scoperto nello scadenzario. In questa modalità:

- incassi e rate esistenti vengono conservati;
- vengono create nuove rate soltanto per la parte non coperta;
- lo storico già saldato non viene riscritto.

#### Numero iniziale di rate

Per Immunoterapia il numero iniziale può provenire dal campo **Rate del saldo predefinite** del medico, con valori ammessi da 1 a 60. Per le altre categorie il comportamento predefinito è un saldo unico, salvo scelta manuale dell'operatore.

#### Ripartizione degli importi

Il calcolo opera in centesimi:

1. divide il totale con divisione intera;
2. assegna la stessa quota a tutte le rate;
3. aggiunge l'eventuale resto all'ultima rata.

Esempio:

```text
€ 100,00 in 3 rate
→ € 33,33
→ € 33,33
→ € 33,34
```

L'operatore può modificare ogni importo. Il pulsante di conferma rifiuta tuttavia un piano la cui somma non coincide esattamente con l'importo da rateizzare.

#### Cadenza

Sono disponibili:

- **Mensile**: conserva il giorno del mese avanzando di un mese alla volta;
- **Ogni N giorni**: applica un intervallo da 1 a 365 giorni.

Con date mensili vicine alla fine del mese, il calendario JavaScript normalizza automaticamente i mesi che non possiedono quel giorno. Per scadenze contrattualmente sensibili è quindi opportuno controllare l'anteprima.

#### Prima scadenza dalla spedizione

La modalità predefinita lega la prima rata alla spedizione:

- `+7 giorni` con un conto ordinario;
- `+30 giorni` quando la prima rata usa contrassegno o assegno.

Le scadenze mostrate prima della partenza sono relative, per esempio `≈ spedizione + 37gg`. Alla spedizione viene fissata l'ancora reale mantenendo la distanza tra le rate.

Se la prima rata usa un conto di transito ma le successive usano il conto ordinario dell'ordine, l'app mantiene l'offset specifico del transito per la prima e applica la cadenza prevista alle successive.

#### Prima scadenza fissa

Disattivando la spunta collegata alla spedizione, la prima scadenza viene proposta a 30 giorni dalla data dell'acconto, oppure da oggi se la data dell'acconto non è disponibile. L'utente può cambiarla direttamente.

#### Controlli prima della conferma

La rateizzazione viene rifiutata se:

- il numero di rate è assente o non valido;
- non esiste alcuna rata calcolata;
- la somma non quadra;
- una rata non possiede una scadenza nella modalità a date fisse.

Il focus viene portato sul primo campo da correggere.

#### Ordine o importi ancora in bozza

Se l'ordine non è ancora salvato, oppure prodotti e importi sono stati modificati nell'editor ma non confermati, il piano rimane locale. Le rate vengono create realmente soltanto con **Salva ordine**. In questo modo il database non riceve un piano calcolato su un totale ancora provvisorio.

## 21. Distinte corriere

Le distinte riconciliano contrassegni e accrediti del corriere.

### 21.1 Creazione/modifica distinta

La modale permette di identificare corriere, periodo/riferimento e movimenti inclusi. Il selettore di modalità cambia la logica di composizione prevista dalla schermata.

L'operatore:

1. seleziona i movimenti;
2. confronta totale atteso e totale della distinta;
3. risolve eventuali differenze;
4. conferma la registrazione.

La distinta collega più incassi senza duplicarli.

### 21.2 Stato e annullamento

La pagina mostra le distinte registrate e il loro dettaglio. Un annullamento libera i movimenti collegati e richiede conferma.

## 22. Provvigioni

Le provvigioni percentuali e quelle fisse non usano la stessa base. Con lo scorporo IVA attivo, la percentuale viene calcolata sull'imponibile; un importo fisso resta invece la somma in euro configurata. Le eventuali spese standard vengono detratte soltanto dal calcolo percentuale quando la relativa preferenza è attiva.

La pagina calcola gli importi per agente e permette filtri per agente, periodo e criterio di ordinamento.

Il calcolo dipende dalle regole dell'agente, dallo stato dell'ordine e dagli eventi economici rilevanti. Un filtro diverso può quindi produrre totali diversi senza che i dati siano cambiati.

### 22.1 Paga provvigioni

La modale consente di:

- selezionare tutti o singoli ordini;
- pagare fino a una data ordine;
- includere solo l'acconto per i non spediti;
- cercare per numero o cliente;
- controllare il totale selezionato.

La conferma crea una registrazione storica. Non modifica il valore originario dell'ordine.

### 22.2 Storico provvigioni

Mostra i pagamenti già effettuati. Per ciascuno sono disponibili:

- dettaglio;
- esportazione o stampa;
- annullamento, con conseguente ripristino degli importi tra quelli da pagare.

## 23. Rimborsi

La pagina distingue stato e origine del rimborso e offre filtri temporali.

### 23.1 Nuovo/modifica rimborso

Il modulo include:

- collegamento facoltativo a un ordine;
- data richiesta;
- importo;
- intestatario;
- motivo;
- IBAN;
- conto di uscita;
- data rimborso;
- note.

Il collegamento all'ordine serve per rimborsi derivati da denaro in eccesso; un rimborso manuale può restare senza ordine.

### 23.2 Segna come effettuato

La modale richiede data e conto di uscita. La conferma cambia lo stato da richiesto a effettuato e registra l'informazione contabile.

### 23.3 Eliminazione

L'eliminazione richiede conferma e va usata per registrazioni errate, non per rappresentare un rimborso annullato quando lo storico deve restare tracciabile.

---

# Parte VIII — Anagrafiche

## 24. Hub e registri

Lo switcher dell'hub passa tra:

- Agenti
- Medici
- Clienti
- Prodotti
- Conti
- Corrieri

Ogni registro usa una struttura comune: elenco ricercabile, selezione, form di dettaglio e azioni.

## 25. Creazione e modifica record

### 25.1 Campi e validazione

Il form cambia in base alla categoria. I campi obbligatori sono indicati e gli errori impediscono il salvataggio. I selettori propongono valori coerenti già presenti negli archivi.

I controlli principali sono:

- e-mail con struttura valida;
- CAP composto da cinque cifre;
- provincia composta da due lettere;
- codice fiscale/partita IVA tra 11 e 16 caratteri alfanumerici;
- campi numerici entro i limiti configurati;
- valori interi dove richiesto, per esempio il numero di rate;
- selezione obbligatoria dei record collegati, come l'agente del medico.

La validazione strutturale non certifica che il dato appartenga realmente alla persona: segnala soltanto che il formato è plausibile.

### 25.2 Attivo, storico ed eliminazione

Quando previsto, disattivare un record è preferibile all'eliminazione se è già collegato a ordini. L'eliminazione può essere impedita per preservare l'integrità dello storico.

### 25.3 Calcolo codice fiscale

Il popover raccoglie dati anagrafici, sesso e comune di nascita e produce una proposta. Il valore deve essere verificato dall'operatore: omocodie e dati incompleti richiedono controllo documentale.

#### Apertura e precompilazione

Il pulsante con la calcolatrice è disponibile accanto a **Codice fiscale / P.IVA** nei moduli cliente e medico, compresi quelli aperti direttamente dall'editor ordine.

All'apertura, PharmaTek prova a separare automaticamente il contenuto di **Nome / Ragione sociale**:

- l'ultima parola viene proposta come cognome;
- le parole precedenti vengono proposte come nome;
- con una sola parola, questa viene considerata cognome.

La separazione è soltanto un'ipotesi. Nomi composti, doppi cognomi, titoli professionali e ragioni sociali devono essere corretti manualmente.

#### Compilazione e calcolo dal vivo

I campi richiesti sono:

- cognome;
- nome;
- data di nascita;
- sesso;
- comune di nascita.

Il codice viene ricalcolato mentre si digita, senza premere un pulsante aggiuntivo. **Usa** resta disabilitato finché il risultato non contiene tutti i 16 caratteri.

#### Autocompletamento del comune

Il comune di nascita usa il dataset Belfiore incorporato nell'applicazione:

- la ricerca inizia dopo almeno due caratteri;
- i comuni che iniziano con il testo digitato precedono quelli che lo contengono;
- vengono mostrati al massimo otto suggerimenti;
- premendo Tab può essere accettato il primo suggerimento;
- se il comune non viene trovato, compare un errore.

Il calcolo funziona offline e non interroga servizi esterni.

#### Inserimento del risultato

Premendo **Usa**, il codice calcolato viene copiato nel campo dell'anagrafica e il popover si chiude. L'operatore deve poi salvare il cliente o medico: chiudere il modulo principale annulla anche il valore appena riportato.

#### Validazione del valore digitato

Sotto il campo può comparire un badge:

- **CF valido** per un codice fiscale con controllo formale corretto;
- **P.IVA valida** per una partita IVA formalmente valida;
- **Non valido** quando i controlli falliscono.

Il badge è più approfondito del semplice limite 11–16 caratteri, ma non risolve omocodie né verifica il dato presso l'Agenzia delle Entrate.

### 25.4 Autocompletamento di CAP, città, provincia e regione

I moduli di cliente e medico usano un archivio geografico incorporato e quindi disponibile offline.

#### Inserendo il CAP

- Il lookup parte quando il CAP contiene cinque cifre.
- Se il CAP identifica un solo comune, vengono compilati città, provincia e regione.
- Se il CAP è condiviso da più comuni, si apre un elenco di scelta.
- I campi geografici non vengono completati con dati arbitrari se il CAP non è riconosciuto.

#### Inserendo la città

La ricerca può proporre il comune e ricavare CAP, provincia e regione. Quando esistono più combinazioni possibili, l'utente sceglie quella corretta.

#### Regola di sovrascrittura

L'autocompletamento serve a ridurre errori e battiture, ma i campi restano modificabili. Prima del salvataggio va controllato soprattutto il caso di CAP multi-comune e località con nomi simili.

### 25.5 Campi specifici del medico

Oltre ai recapiti, il medico contiene impostazioni che influenzano direttamente gli ordini:

- **Agente di riferimento**, obbligatorio;
- **Prezzo standard immunoterapia**;
- **Acconto predefinito per prodotto**;
- **Rate del saldo predefinite**, intero da 1 a 60;
- **Conto di saldo preferito**;
- indirizzo usato quando il medico è anche destinatario, come in Diagnostica;
- note di spedizione.

Cambiare questi valori modifica i suggerimenti degli ordini successivi. I prezzi già modificati manualmente e gli incassi storici restano protetti.

### 25.6 Campi specifici del cliente

Il cliente contiene dati di destinazione e fatturazione di base, recapiti, codice fiscale/partita IVA e note di spedizione. Conserva inoltre internamente l'ultimo medico usato, aggiornato dagli ordini, per accelerare la compilazione futura.

Le note di spedizione dell'anagrafica costituiscono una preferenza ricorrente del cliente. Le note inserite soltanto in una singola spedizione restano invece legate a quella spedizione.

## 26. Prezzi

Le regole prezzo possono specializzare il prezzo base per contesto. La schermata espone tipo di regola, soggetto/ambito, validità e valore.

Il simulatore **Prova prezzo** mostra quale regola prevale per la combinazione selezionata. Serve a diagnosticare un prezzo inatteso prima di modificare listini o ordini.

## 27. Preferenze agenti

La modale centralizza parametri usati nel calcolo o nel comportamento degli agenti. Le modifiche influenzano i calcoli futuri e le ricostruzioni previste dalla logica applicativa; non vanno applicate senza conoscere la decorrenza desiderata.

## 28. Preferenze conti

Permette di scegliere:

- conto predefinito incassi;
- conto preferito acconti;
- conto accrediti corrieri;
- conto predefinito rimborsi.

Questi valori precompilano i moduli, ma l'utente può cambiarli nella singola operazione.

## 29. Preferenze prodotti e acconti

Definisce:

- soglia di prezzo;
- acconto standard sotto soglia;
- acconto standard sopra soglia.

L'automatismo propone l'acconto nell'ordine; non sostituisce la verifica dell'accordo commerciale.

## 30. Importazione anagrafiche

La procedura guidata:

1. acquisisce uno o più file;
2. assegna o fa correggere la categoria;
3. analizza colonne e record;
4. mostra problemi e anteprima;
5. chiede conferma in presenza di operazioni rischiose;
6. esegue l'importazione;
7. presenta il riepilogo finale.

Rimuovere un file dalla coda non elimina il file originale. Tornare ai passi precedenti consente di correggere l'associazione prima di scrivere dati.

## 31. Deduplicazione

Il sistema può individuare record probabilmente duplicati. Il confronto deve considerare nome, dati fiscali, contatti e collegamenti esistenti. L'unione non va confermata basandosi soltanto su un nome simile.

## 32. Export Aruba

La modale prepara automaticamente le anagrafiche nel formato richiesto da Aruba. L'utente sceglie
il periodo e vede quanti clienti entreranno nel file. I clienti già esportati non vengono riproposti.

Se un cliente non ha il codice fiscale, il gestionale lo include comunque: genera un codice
provvisorio stabile e formalmente valido e aggiunge `(FAKE)` al cognome nel solo file Excel. Il
record originale non viene modificato e un codice fiscale reale già presente viene sempre
conservato. Indirizzo, CAP, telefono e altri dati facoltativi mancanti restano vuoti: non vengono
inventati.

Aruba accetta al massimo 500 righe totali per file. Quando occorre, l'esportazione crea quindi più
file con un'intestazione e un massimo di 499 clienti ciascuno. I clienti vengono marcati con
`aruba_esportato_il` soltanto dopo il salvataggio riuscito di tutti i file.

Il file non viene inviato automaticamente ad Aruba. Dopo il salvataggio l'utente apre Aruba,
entra in **Clienti**, sceglie **Importa** e carica l'Excel appena creato.

---

# Parte IX — Ricerca, comunicazioni e finestre ausiliarie

## 33. Spotlight

Spotlight si apre dal campo di ricerca o dalla scorciatoia configurata. Se la cartella dati non è
disponibile, la postazione richiede un ricollegamento o è in corso un ripristino, resta chiuso e la
finestra principale mostra il relativo percorso di recupero.

### 33.1 Ricerca

Il placeholder indica gli ambiti principali: ordini, clienti, medici, corrieri e comandi. I risultati sono raggruppati per tipo.

- Scrivendo si restringono i risultati.
- Freccia su/giù cambia selezione.
- Invio apre o esegue.
- Esc chiude.
- Il click fuori dalla finestra può nasconderla.

Quando la query è vuota possono comparire elementi recenti o frequenti.

### 33.2 Comandi

I comandi permettono di navigare o avviare un'azione. Prima dell'esecuzione di un comando distruttivo restano valide le normali conferme.

### 33.3 Compositore comunicazioni

Le azioni **Comunica**, **Sollecita** e **Avvisa clienti** aprono lo stesso compositore. Il canale
può essere **E-mail**, **WhatsApp** o **Entrambi**; una scelta è disponibile soltanto quando
l'anagrafica contiene il relativo recapito valido. Oggetto e testo derivano dal modello scelto e
restano modificabili prima dell'invio.

L'e-mail viene affidata al PC che ha creato la comunicazione. WhatsApp apre la conversazione con il
testo compilato e richiede la conferma dell'operatore dopo il click su Invia. Chiudere il
compositore dopo la preparazione non annulla l'elemento già registrato.

### 33.4 Campagne operative

Nella revisione multipla ogni destinatario mostra i canali disponibili oppure il motivo
dell'esclusione. La lista è scorrevole e virtualizzata. Nei Crediti, la campagna usa i filtri
correnti, unisce le rate scadute dello stesso ordine e raggruppa il riepilogo per cliente.

L'opzione **Posticipa le scadenze di 7 giorni** mostra vecchie e nuove date e il totale coinvolto.
La proroga viene applicata insieme alla preparazione e non viene ripetuta da un retry. Se recapiti,
pagamenti o importi cambiano mentre la revisione è aperta, l'invio si ferma e richiede di riaprire
la campagna.

Dal Centro comunicazioni una campagna può essere messa in **Pausa**, **Ripresa** o **Interrotta**.
Gli invii già effettuati restano nello storico; l'interruzione annulla soltanto quelli pendenti.

### 33.5 Cronologia comunicazioni

La cronologia raccoglie bozze, invii, errori e messaggi WhatsApp da completare. Offre ricerca,
filtri, avanzamento delle campagne, **Riprova** per gli errori certi e un reinvio esplicito quando
l'esito precedente è incerto. È una cronologia **locale a questo PC**: non viene sincronizzata
con le altre postazioni e ciascun PC vede soltanto le comunicazioni preparate ed eseguite lì.

- Dalla topbar si apre nel pannello laterale.
- Dall'icona Cronologia in **Impostazioni → E-mail e comunicazioni** si apre in una modale.
- Da Spotlight si apre in una finestra separata, senza cambiare la pagina principale.

Chiudendo completamente PharmaTek vengono chiuse anche le finestre autonome della cronologia.
La chiusura dell'app non cancella lo storico locale. Backup e ripristino dei dati aziendali non lo
trasferiscono fra PC e una ricostruzione della sola cache condivisa lo conserva. **Riconfigura
questo PC**, il ritiro della postazione e il reset completo eliminano invece i dati locali della
postazione, inclusa questa cronologia.

## 34. Overlay notifiche

L'overlay mostra un avviso alla volta e conserva gli altri in coda.

- La barra inferiore rappresenta il tempo residuo.
- Il passaggio del mouse mette in pausa la chiusura automatica.
- Le notifiche persistenti richiedono chiusura o azione.
- **Rispondi** espande il campo per i messaggi tra postazioni.
- **Chiudi** rimuove l'avviso in primo piano, non necessariamente il record dalla cronologia.
- Gli errori di comunicazione e il loro stato letto/scartato restano locali allo stesso PC: non
  generano traffico di sincronizzazione né cambiano la campanella delle altre postazioni.

## 35. Composer messaggio

Si apre, per esempio, dall'elenco dispositivi. L'utente sceglie il destinatario, scrive e invia. L'invio produce una notifica sulla postazione destinataria; la ricezione può essere differita se quella postazione è offline.

## 36. Finestra notifiche

Offre una vista più ampia rispetto alla campanella. Consente di scorrere lo storico, aprire i collegamenti e gestire le letture senza occupare la pagina di lavoro.

## 37. Riepilogo soggetto

Mostra KPI quali ordini in attesa, valore in attesa e da saldare, oltre a dettagli per soggetto. I comandi aprono il riepilogo pertinente o la pagina completa. È una vista informativa: gli importi derivano dai dati gestionali sottostanti.

I nomi di cliente, medico e agente diventano collegamenti discreti nei contesti operativi in cui il
riepilogo è utile: Giornaliero, Crediti, Provvigioni, rimborsi extra e promemoria collegati. L'aspetto
della cella rimane invariato; sottolineatura e cursore compaiono al passaggio del mouse. Il clic non
si propaga alla riga della tabella.

L'apertura segue la preferenza **Apri ordini in finestra separata**: con `Mai` il riepilogo appare in
una modale della finestra principale; con `In modifica` o `Sempre` usa una finestra deterministica,
riportando davanti quella già aperta. Nel browser usa sempre la modale. Il contenuto resta visibile
durante l'uscita e si aggiorna su salvataggi di ordini, pagamenti e anagrafiche; se il soggetto viene
eliminato il riepilogo si chiude in sicurezza.

Prima di **Nuovo ordine**, apertura di un ordine, **Crediti**, **Provvigioni**, **Apri scheda** o di
un'altra anagrafica collegata, la modale corrente si chiude. Con le finestre disattivate, Nuovo ordine
apre l'editor modale già precompilato con il cliente o medico selezionato.

## 38. Info, aggiornamenti e novità

### 38.1 Pannello Novità

Compare dopo un aggiornamento rilevante. Elenca cambiamenti per categoria e il pulsante finale registra che l'utente ha visto la versione.

### 38.2 Storico changelog

Permette di consultare versioni precedenti e relative modifiche.

### 38.3 Finestra Info

Mostra informazioni applicative e accesso al controllo aggiornamenti. Eventuali errori di rete non compromettono i dati gestionali.

### 38.4 Flappy Livio

È una funzione ludica separata dai dati aziendali. I suoni rispettano le impostazioni applicative pertinenti.

---

# Parte X — Profilo e impostazioni

## 39. Modale profilo

Permette di modificare nome e avatar.

- **Carica foto** apre la scelta file.
- **Usa iniziali** rimuove la foto personalizzata dalla visualizzazione.
- **Salva** aggiorna l'identità mostrata sulle postazioni.

Il cambio nome non deve essere usato per trasformare il profilo di una persona in quello di un'altra: per quello va creato o collegato l'utente corretto.

## 40. Impostazioni generali

La pagina è divisa in sezioni selezionabili.

### 40.1 Periodo predefinito

Definisce il periodo iniziale usato dalle viste compatibili. Non cancella i filtri impostati manualmente nella sessione corrente.

### 40.2 Notifiche

Le opzioni includono:

- popup notifiche;
- popup anche con app in primo piano;
- scelta del suono;
- pulsante **Ascolta** per l'anteprima.

Disattivare i popup non elimina le notifiche dalla campanella.

### 40.3 Avvio e ricerca

- **Avvia con Windows** registra o rimuove l'avvio automatico.
- **Scorciatoia di ricerca globale** abilita/configura Spotlight.
- È possibile creare o rimuovere l'icona desktop per la ricerca.

### 40.4 Aspetto e comportamento

- **Riduci animazioni** rende immediate le transizioni dell'interfaccia e ferma le animazioni
  decorative, comprese quelle delle schermate di avvio e benvenuto.
- **Tabelle compatte** riduce l'altezza delle righe.
- **Zoom interfaccia** modifica la scala della UI.
- **Apri in finestra separata** cambia l'hosting di alcuni editor.
- **Filtri delle liste** controlla la persistenza prevista.
- **Svuota il Cestino dopo** definisce la conservazione automatica.

Un forte zoom può ridurre lo spazio utile; tabelle compatte e sidebar compatta possono compensarlo.

Le preferenze vengono applicate senza ricaricare la pagina. Le finestre Tauri già aperte — inclusi
Info, ordini, pagamenti, promemoria, notifiche, Cestino, Spotlight e overlay — ricevono subito la
modifica; le modali condividono direttamente lo stesso stato della finestra che le ospita.

### 40.5 E-mail e comunicazioni

La sezione configura mittente e server e-mail, accesso a WhatsApp assistito e modelli condivisi.
**Verifica e invia prova** controlla la configurazione e spedisce al destinatario indicato nel
campo. Se **Salva una copia nella Posta inviata** è attivo, la copia viene aggiunta via IMAP dopo
l'accettazione SMTP; un eventuale errore di archiviazione non provoca un secondo invio.

Il pulsante con l'icona Cronologia nell'header apre lo storico compatto **del PC corrente**. I
modelli restano invece condivisi fra le postazioni e distinti per tipo di evento. Ogni modello usa
lo stesso messaggio per e-mail e WhatsApp; l'oggetto compare soltanto nelle e-mail. È possibile
modificare i modelli base e aggiungere o rimuovere modelli personalizzati usando i dati dinamici
proposti nell'editor.

## 41. Backup

### 41.1 Crea backup

**Esegui backup** crea una copia secondo la configurazione corrente. Il pulsante mostra lo stato durante l'operazione. **Apri cartella backup** permette di ispezionare i file senza modificarne il contenuto dall'app.

### 41.2 Elenco backup

Per ogni backup sono disponibili:

- ripristino coordinato;
- ripristino manuale;
- eliminazione del file di backup.

Eliminare un backup non elimina i dati correnti, ma riduce i punti di recupero.

### 41.3 Ripristina da file

Permette di scegliere un backup esterno. Prima di procedere la UI mostra riepilogo e avvertenze.

### 41.4 Ripristino coordinato

Il flusso:

1. acquisisce un lock condiviso;
2. avvisa/blocca le altre postazioni;
3. attende la condizione di sicurezza;
4. sostituisce i dati;
5. ricostruisce o riallinea la proiezione locale;
6. comunica la conclusione;
7. rilascia il blocco.

La modale offre **Annulla** finché la fase lo consente e **Procedi** dopo la conferma. Non si deve chiudere forzatamente PharmaTek o OneDrive durante la scrittura.
Durante l'attesa il PC proprietario rinnova periodicamente il lock. Se termina in modo anomalo senza inviare l'annullamento, dopo la scadenza della lease gli altri PC rimuovono automaticamente la sola schermata bloccante; nessun dato viene cancellato o ripristinato dal timeout grafico.

Dopo la conferma, OneDrive può consegnare marker, log e snapshot in momenti diversi. In questa fase la
finestra principale mostra **Attendo che OneDrive completi il ripristino...**, disattiva notifiche e
finestre operative e non permette di lavorare su dati intermedi. La schermata scompare soltanto quando
il payload è verificato e la proiezione locale è stata ricostruita. Chi avvia l'app durante la consegna
vede la stessa schermata: non viene mandato per errore all'onboarding o al ricollegamento.
Anche file vecchi riconsegnati fuori ordine mantengono questa attesa: la schermata non indica un blocco
dell'invio messaggi, ma che OneDrive non ha ancora reso coerente la generazione ripristinata.
Se PharmaTek è stato avviato minimizzato, completa controllo e ricostruzione senza mostrare né montare
le viste operative; la dashboard viene preparata soltanto quando la finestra principale è realmente
riaperta dalla tray o dalla taskbar.
Anche durante questa schermata la **X** conserva la regola generale: con **Avvia con Windows** attivo
nasconde la main nella tray senza interrompere il processo; altrimenti esce dall'app.

### 41.5 Ripristino manuale

È una procedura di emergenza per casi in cui il coordinamento automatico non è applicabile. Le istruzioni mostrate dalla UI devono essere seguite nell'ordine; un uso improprio può riallineare le postazioni su copie diverse.

## 42. Gestione postazioni

Le funzioni amministrative consentono diversi livelli di reset:

- **Riconfigura questo PC**: scollega soltanto la postazione corrente, conserva i dati condivisi e
  riapre il percorso iniziale di configurazione; se il profilo è usato anche da un altro PC,
  quest'ultimo resta collegato. La postazione riconfigurata non compare negli elenchi operativi
  finché non viene associata nuovamente a un utente, ma resta selezionabile in **Ritira un PC**;
- **Ritira un PC**: crea prima un backup, revoca la sessione della postazione scelta e non modifica
  gli altri PC;
- **Ottimizza database**: conserva tutti i dati di lavoro, crea un backup completo e alleggerisce
  la cronologia tecnica. Prima di iniziare mostra quali postazioni hanno confermato la sospensione;
  il pulsante resta disabilitato finché non sono tutte pronte. Al termine riepiloga record
  conservati, eventi e tombstone assorbiti, file rimossi e spazio liberato;
- **Reset completo**: elimina i dati operativi condivisi per tutte le postazioni e richiede due
  conferme. I backup già creati restano disponibili; rimangono inoltre un log e uno snapshot
  tecnici minimi per impedire ai PC offline di far ricomparire i dati eliminati.

Il flusso si apre con un singolo clic sul cestino a destra del box **Pulizia dati**. In alternativa,
servono cinque pressioni di `Canc` entro 1,5 secondi. Il clic non incrementa né modifica la sequenza
da tastiera. Non vengono mostrati toast intermedi; rimangono la scelta
del tipo di reset e tutte le conferme già previste. Il cestino reagisce al passaggio e ai clic, mentre
con **Riduci animazioni** non esegue trasformazioni.

L'accesso apre il **Centro di ripristino**, una view bloccante a schermo intero: la pagina sottostante
non è interagibile e non vengono sovrapposti dialoghi o modali. Scelta iniziale, conferma del reset
leggero, selezione e conferma del PC da ritirare, coordinamento dell'ottimizzazione, doppia conferma del reset completo e stato di lavoro
sono passi animati della stessa view. `Esc` torna al passo precedente o chiude dalla scelta iniziale;
durante l'operazione la view non può essere chiusa. **Riduci animazioni** azzera anche le transizioni
tra i passi.

Il percorso **Ritira un PC** mostra nella view una lista scrollabile di postazioni con utente, ultima
attività e indicazione del PC corrente. La revoca può far apparire su quel computer la schermata di
ricollegamento.

Il percorso **Ottimizza database** attende normalmente la conferma delle postazioni registrate.
Se una postazione è offline compare **Forza comunque**: prima del commit viene mostrato un avviso
perché le modifiche rimaste soltanto su quel PC possono andare perse. Quando tornerà online,
PharmaTek rileverà lo stesso marker usato dai ripristini e ricostruirà automaticamente la copia
locale dall'anchor autorevole.

## 43. Strumenti dati

Le funzioni di popolamento, azzeramento, riallineamento o manutenzione sono protette da dialoghi. Prima di usarle occorre:

- verificare l'ambiente;
- creare un backup;
- accertarsi che nessun altro utente stia lavorando;
- leggere se l'effetto è locale o condiviso.

---

# Parte XI — Errori, sicurezza operativa e assistenza

## 44. Tipi di messaggio

| Tipo | Significato | Comportamento consigliato |
|---|---|---|
| Informazione | Operazione conclusa o dettaglio utile | Leggere e proseguire |
| Avviso | Dato ammesso ma da verificare | Controllare prima di confermare |
| Errore di validazione | Campo mancante o incoerente | Correggere il campo evidenziato |
| Errore tecnico | Comando o sincronizzazione falliti | Non ripetere alla cieca; verificare stato |
| Conferma pericolosa | Effetto distruttivo o difficile da annullare | Leggere record e conseguenza |
| Blocco coordinato | Operazione amministrativa in corso | Attendere senza forzare l'uscita |

## 45. Prevenzione dei doppi inserimenti

Quando un pulsante mostra un indicatore di caricamento:

- non ricliccarlo;
- non chiudere la finestra;
- attendere il messaggio finale;
- se il tempo è anomalo, verificare prima nell'elenco se il record è già stato creato.

## 46. Lavoro offline

In assenza di sincronizzazione:

- annotare eventuali operazioni critiche;
- evitare ripristini e manutenzioni;
- non interpretare l'assenza di modifiche altrui come dato definitivo;
- attendere il ritorno online e controllare l'indicatore.

## 47. Checklist per assistenza

Quando si segnala un problema, raccogliere:

1. pagina o finestra;
2. numero ordine o record coinvolto;
3. azione eseguita;
4. messaggio esatto;
5. stato sincronizzazione;
6. postazione e utente;
7. ora approssimativa;
8. screenshot, evitando dati sensibili non necessari.

---

# Parte XII — Procedure operative complete

## 48. Creare e portare a termine un ordine

1. Verificare l'anno nella sidebar.
2. Aprire **Giornaliero → Nuovo ordine**.
3. Selezionare cliente esistente o crearne uno.
4. Collegare medico e agente corretti.
5. Inserire righe, prezzi e dati specialistici.
6. Controllare totale, acconto e condizioni.
7. Salvare.
8. Registrare l'acconto se ricevuto.
9. In **Produzione**, compilare e avanzare le righe.
10. In **Spedizioni**, verificare lotti e destinatario.
11. Creare il collo e confermare la spedizione.
12. In **Contabilità**, registrare o verificare gli incassi.
13. Se necessario, riconciliare distinta e provvigioni.

## 49. Correggere un pagamento

1. Aprire Contabilità → Pagamenti o l'ordine.
2. Cercare il movimento.
3. Aprire la modale.
4. Verificare se è incasso o previsione.
5. Correggere importo, conto, data o note.
6. Salvare.
7. Controllare il residuo dell'ordine.

Se il movimento appartiene a una distinta o incide su un rimborso, verificare prima i collegamenti.

## 50. Annullare una spedizione

1. Aprire **Spedizioni → Effettuate**.
2. Cercare il destinatario o l'ordine.
3. Espandere e controllare le righe.
4. Scegliere l'annullamento appropriato.
5. Leggere la conferma.
6. Confermare.
7. Verificare che le righe ricompaiano in **Da spedire**.
8. Controllare eventuali contrassegni/distinte già registrati.

## 51. Recuperare un elemento eliminato

1. Aprire il Cestino.
2. Identificare tipo e record.
3. Premere **Ripristina**.
4. Tornare nella pagina originale.
5. Cercare il record e verificarne lo stato.

## 52. Importare anagrafiche in sicurezza

1. Creare un backup.
2. Preparare file con intestazioni chiare.
3. Aprire Importa nelle Anagrafiche.
4. Assegnare la categoria corretta a ogni file.
5. Esaminare anteprima ed errori.
6. Correggere duplicati e campi obbligatori.
7. Confermare.
8. Leggere il riepilogo finale.
9. Controllare alcuni record campione.

## 53. Ripristinare un backup

1. Fermare le normali attività.
2. Verificare che OneDrive e le postazioni siano raggiungibili.
3. Selezionare il backup corretto per data.
4. Avviare il ripristino coordinato.
5. Attendere l'adesione/blocco delle altre postazioni.
6. Confermare soltanto dopo il riepilogo.
7. Non interrompere l'app.
8. Attendere sblocco e riallineamento.
9. Verificare ordini recenti e conteggi.

---

# Parte XIII — Approfondimenti completi dei moduli

## 54. Provvigioni: regole complete

### 54.1 Da dove nasce una provvigione

La provvigione è calcolata sulle righe degli ordini attribuiti a un agente. Non viene digitata nella pagina Provvigioni: deriva dalla configurazione dell'agente e dagli eventi dell'ordine.

L'anagrafica agente definisce:

- **Tipo provvigione**: percentuale oppure importo fisso;
- **Valore predefinito**;
- **Momento di maturazione**: alla spedizione oppure alla chiusura dell'ordine;
- valori specifici per Diagnostica e Keriba;
- conto preferito e acconto, che influenzano altri flussi ma non sostituiscono la regola provvigionale.

Se non è indicato un valore specifico per una linea, viene usato il valore generale previsto dalla configurazione. Gli omaggi e gli ordini di sostituzione contrassegnati come esclusi non generano provvigioni ordinarie.

Il tipo cambia il calcolo:

- **Percentuale**: la percentuale viene applicata a una base calcolata. Se nelle Preferenze agenti è attivo lo scorporo IVA, il gestionale divide la base per `1,10` e usa quindi l'imponibile. Se è attiva anche la detrazione delle spese di spedizione, sottrae prima il costo standard configurato e poi scorpora l'IVA.
- **Importo fisso**: la provvigione è direttamente il valore in euro configurato per l'agente o per la categoria. Non viene applicata una percentuale e non vengono eseguiti lo scorporo IVA o la detrazione delle spese.

Esempio percentuale: con un ordine da 550 € IVA inclusa, scorporo IVA attivo e provvigione del 10%, la base è 500 € e la provvigione è 50 €. Con una provvigione fissa di 50 €, il risultato resta 50 €.

### 54.2 Maturato, potenziale e pagato

- **Potenziale**: importo che potrebbe spettare all'agente se si verificano le condizioni.
- **Maturato**: importo per il quale si è verificato l'evento configurato.
- **Pagato**: importo incluso in una registrazione di pagamento provvigioni.

Un ordine può quindi contribuire al potenziale senza essere ancora pagabile. Il filtro temporale limita gli ordini considerati, non cambia la loro regola.

### 54.3 Schede agente

Ogni scheda riepiloga valori e ordini dell'agente. Le righe permettono di leggere:

- numero e data ordine;
- cliente;
- stato;
- base di calcolo;
- regola applicata;
- provvigione risultante;
- quota già pagata o ancora disponibile.

Le schede sono virtualizzate quando l'elenco è ampio. L'espansione mostra il dettaglio senza aprire l'ordine.

### 54.4 Filtri e ordinamento

La pagina permette di:

- scegliere un singolo agente o tutti;
- selezionare un periodo predefinito;
- usare un intervallo **Dal/Al**;
- ordinare per maturato, potenziale o nome;
- mostrare o nascondere gli agenti senza importi nel periodo;
- azzerare i filtri.

Il contesto annuale globale continua ad applicarsi. Un intervallo personalizzato non deve essere interpretato come modifica dell'anno dei dati.

### 54.5 Pagamento selettivo

La modale **Paga provvigioni** non paga automaticamente tutto ciò che appare nella scheda. L'operatore può:

1. fissare una data limite dell'ordine;
2. cercare per numero o cliente;
3. includere/escludere singole righe;
4. usare **Seleziona tutte** sulle righe filtrate;
5. includere soltanto la quota dell'acconto per ordini non spediti;
6. controllare il totale selezionato;
7. confermare.

La selezione esplicita prevale sul semplice fatto che una riga sia visibile. Il pulsante di pagamento resta disabilitato quando non è selezionato alcun importo.

### 54.6 Acconti di ordini non spediti

L'opzione **Includi solo acconto (non spediti)** permette di liquidare la quota provvigionale riferibile all'acconto prima della spedizione, nei casi ammessi dalla configurazione. La parte restante non viene persa: resta disponibile quando maturano le condizioni successive.

### 54.7 Conferma e aggiornamento

La conferma crea un record di pagamento con:

- agente;
- data;
- righe incluse;
- importo attribuito a ciascun ordine;
- totale.

La vista ricalcola immediatamente quanto resta pagabile. Un pagamento non modifica prezzi, incassi del cliente o stato produttivo.

### 54.8 Storico

Lo storico raggruppa le liquidazioni per data. Ogni gruppo può essere:

- espanso per mostrare le righe;
- esportato o stampato;
- annullato.

L'elenco interno viene virtualizzato se contiene molte righe.

### 54.9 Annullamento

L'annullamento richiede conferma. Elimina la registrazione di pagamento provvigioni e rende nuovamente pagabili gli ordini inclusi. Non annulla gli ordini né i pagamenti dei clienti.

### 54.10 Esportazione

L'esportazione usa il gruppo selezionato, il nome agente, la data e le righe effettivamente pagate. Il documento prodotto rappresenta quella liquidazione storica, non il totale corrente della pagina.

## 55. Rimborsi: ciclo completo

### 55.1 Origini

Un rimborso può essere:

- **manuale**, senza ordine collegato;
- **da importo extra**, collegato a un ordine il cui incassato supera il totale.

La colonna origine permette di distinguere le due casistiche e il filtro può mostrarle separatamente.

### 55.2 Collegamento a un ordine

Nel modulo, il campo **Collega a un ordine** ricerca gli ordini eleggibili. Quando viene scelto un ordine, PharmaTek può proporre:

- importo eccedente;
- intestatario derivato dal cliente;
- riferimenti utili.

Il collegamento preserva la relazione con l'ordine. Cambiare ordine ricalcola le proposte, ma i campi restano verificabili dall'operatore.

### 55.3 Creazione manuale

Scegliendo **Nessuno — rimborso manuale**, l'utente inserisce autonomamente dati e motivo. Sono obbligatori:

- importo maggiore di zero;
- ragione sociale/intestatario.

IBAN, motivo e note completano l'istruzione amministrativa.

### 55.4 Stato richiesto

Un nuovo rimborso senza data di esecuzione è una richiesta. Compare tra gli elementi da effettuare e non genera ancora un'uscita contabilizzata.

### 55.5 Stato effettuato

Il rimborso diventa effettuato quando possiede:

- data rimborso;
- conto di uscita, se richiesto dal flusso.

Il comando **Segna come effettuato** apre una modale minima per raccogliere questi dati senza dover modificare l'intero record.

### 55.6 Modifica

Aprendo la riga si possono correggere richiesta, importo, intestatario, IBAN, motivo, conto, data e note. Modificare un rimborso effettuato cambia il dato storico: l'operatore deve verificare che la correzione rifletta l'operazione bancaria reale.

### 55.7 Filtri

La pagina consente:

- stato singolo o multiplo;
- origine manuale/ordine;
- data iniziale e finale;
- azzeramento filtri.

Le date sono applicate secondo il riferimento esposto dalla tabella; stato e origine possono essere combinati.

### 55.8 Eliminazione e Cestino

Eliminare un rimborso richiede conferma e lo sposta nel Cestino. Un rimborso collegato a un pagamento extra può essere eliminato automaticamente anche quando quel pagamento viene annullato.

Se il rimborso risulta già effettuato, il dialogo di annullamento del pagamento lo segnala esplicitamente perché l'uscita bancaria potrebbe dover essere gestita fuori dall'app.

### 55.9 Effetti sull'ordine

Il rimborso non riduce il totale prodotti. Rappresenta la restituzione dell'extra e rende leggibile la sua gestione. Incassato, residuo ed extra continuano a derivare dai pagamenti; l'annullamento del pagamento di origine rimuove il presupposto del rimborso.

## 56. Messaggi e notifiche

### 56.1 Nuovo messaggio

Il composer è disponibile:

- dalla campanella;
- dalla finestra Notifiche;
- dall'elenco postazioni nel pannello sincronizzazione;
- da Spotlight;
- come risposta nell'overlay.

Per un nuovo messaggio l'utente sceglie:

- **Tutti**, per trasmettere a ogni altro utente;
- un utente specifico.

L'utente corrente viene escluso dall'elenco dei destinatari individuali.

### 56.2 Scrittura e tastiera

- **Invio** spedisce.
- **Shift+Invio** inserisce una nuova riga.
- **Esc** annulla quando il composer lo consente.
- **Invia** è disabilitato con testo vuoto o destinatario mancante.

Il testo viene ripulito dagli spazi esterni prima della validazione logica prevista dal flusso.

### 56.3 Risposta

Cliccando una notifica di tipo messaggio:

- la notifica viene segnata come letta;
- si apre il composer inline;
- il destinatario è bloccato sul mittente originale;
- viene conservato l'identificativo del messaggio padre.

Questo collegamento permette di riconoscere la risposta, pur non esistendo una pagina di cronologia chat tradizionale.

### 56.4 Invio e aggiornamento UI

Dopo il salvataggio vengono emessi eventi di messaggio e notifica. Campanella, finestra e overlay possono quindi aggiornarsi senza riavviare. Se una postazione attiva è offline, il messaggio resta nei dati condivisi e sarà rilevato al controllo successivo. Un destinatario ritirato o rimasto senza postazioni viene invece escluso e rivalidato al momento dell'invio.

### 56.5 Lettura

Leggere non significa cancellare:

- il click rimuove la notifica dal conteggio non lette;
- la riga resta nell'elenco;
- l'aspetto diventa attenuato;
- se esiste un collegamento, viene aperto.

### 56.6 Apertura del collegamento

In base al tipo, una notifica può aprire:

- ordine;
- pagamento specifico per un sollecito;
- promemoria in finestra separata;
- riepilogo cliente, medico o altro soggetto;
- composer di risposta.

### 56.7 Scarto

La `X` scarta una sola notifica senza eseguire il collegamento. **Cancella tutte** scarta tutte le notifiche attualmente visibili. Lo scarto è distinto dalla lettura.

### 56.8 Elenchi grandi

Oltre 40 notifiche visibili, la lista usa virtualizzazione: vengono renderizzate soltanto le righe necessarie. Il comportamento di click, lettura e scarto resta identico.

### 56.9 Categorie e urgenza

Icona, colore e bordo dipendono dal tipo e dall'urgenza. Una notifica letta viene resa neutra, ma conserva titolo e dettaglio. Le categorie comprendono messaggi, promemoria, solleciti e avvisi gestionali prodotti dai moduli.

### 56.10 Popup e campanella

Il popup temporaneo e la riga nella campanella sono due rappresentazioni dello stesso evento:

- chiudere il popup non equivale necessariamente a scartare la riga;
- disabilitare i popup non disabilita la raccolta notifiche;
- leggere dalla campanella aggiorna il badge;
- riportare semplicemente il focus sull'app non nasconde il popup;
- aprire la campanella nasconde i popup ordinari senza marcarli automaticamente come letti;
- le preferenze sonore e “anche in primo piano” controllano soltanto la presentazione.

## 57. Spotlight: motore completo

### 57.1 Dati indicizzati

Spotlight carica in parallelo:

- ordini;
- clienti;
- medici;
- agenti;
- prodotti;
- corrieri;
- conti;
- distinte;
- spedizioni effettuate;
- ordini da spedire;
- pagamenti;
- promemoria;
- utenti destinatari dei messaggi.

Un errore in una singola sorgente non blocca l'intera ricerca: quella categoria rimane vuota e le altre continuano a funzionare.

### 57.2 Contesto anno

Con un anno specifico vengono limitati ordini, distinte, spedizioni, pagamenti collegati e promemoria datati. Le anagrafiche restano ricercabili perché non appartengono a una singola annualità.

### 57.3 Ricerca a più termini

I termini sono combinati in logica **AND**: tutti devono comparire nel contenuto indicizzato, ma il loro ordine è irrilevante.

Esempi equivalenti:

```text
gls 10/04/2026
10/04/2026 gls
```

Le date vengono indicizzate sia in formato `AAAA-MM-GG` sia italiano `GG/MM/AAAA`.

### 57.4 Contenuti ricercabili

- Ordine: numero, data, cliente, medico, agente e lotti.
- Cliente: nome, città e regione.
- Medico: nome e regione.
- Prodotto: nome e categoria.
- Distinta: corriere, data distinta e accredito.
- Spedizione: corriere, data, destinatario, numeri ordine, prodotti e lotti.
- Pagamento: ordine, cliente, medico, conto e scadenza.
- Promemoria: testo e record collegato.

### 57.5 Risultati contestuali

I risultati anagrafici possono mostrare:

- numero ordini;
- data dell'ultimo ordine;
- credito aperto.

Questi dettagli vengono calcolati sui dati correnti e aiutano a distinguere omonimi.

### 57.6 Suggeriti e frequenza d'uso

Quando la query è vuota, Spotlight ricostruisce fino a sei elementi frequenti tra comandi, ordini e anagrafiche. Il punteggio combina frequenza e recente utilizzo e decade nel tempo.

Un elemento eliminato non viene riproposto anche se era frequente, perché i suggeriti vengono ricostruiti contro i dati esistenti.

### 57.7 Completamento

Una voce può esporre il testo di completamento. Se l'utente sta scrivendo un prefisso riconosciuto, Spotlight propone la forma completa senza eseguire prematuramente l'azione.

### 57.8 Messaggi da Spotlight

Prefissi riconosciuti:

- `messaggio`
- `scrivi`
- `scrivi a`
- `invia messaggio`
- `invia messaggio a`
- alias `msg`

Spotlight propone utenti e “Tutti”. Quando destinatario e testo sono sufficienti, può costruire l'azione di invio diretto; altrimenti apre il composer indirizzato.

### 57.9 Promemoria da Spotlight

Prefissi:

- `promemoria`
- alias `prom`

Sono riconosciuti:

- oggi;
- ieri;
- domani;
- questa settimana;
- questo mese;
- data ISO;
- data italiana con `/`, `.` o `-`.

Il risultato può aprire l'elenco filtrato o il promemoria pertinente.

### 57.10 Filtri temporali

Le query di spedizione comprendono periodi relativi e date esplicite. Il motore converte l'espressione in `dal/al` e apre la pagina con quei filtri già impostati.

### 57.11 Pagamenti intelligenti

Le query smart possono combinare faccette quali:

- stato temporale;
- conto;
- agente;
- medico;
- linea;
- periodo.

Il risultato apre Contabilità → Pagamenti con i filtri corrispondenti, anziché limitarsi a cercare il testo.

### 57.12 Spedizioni intelligenti

Possono essere combinati:

- corriere;
- periodo;
- stato da spedire/effettuata;
- inclusione delle linee normalmente nascoste.

La navigazione mantiene il contesto costruito dalla query.

### 57.13 Distinte, provvigioni e rimborsi

Spotlight riconosce comandi dedicati e può aprire:

- distinte filtrate per corriere/conto/periodo;
- provvigioni di un agente con criterio di ordinamento;
- rimborsi filtrati per stato e origine;
- creazione di nuova distinta o nuovo rimborso.

### 57.14 Laboratorio e produzione

I comandi Laboratorio possono indirizzare alla Produzione con il segmento appropriato e i filtri compatibili, evitando di cercare manualmente la riga.

### 57.15 Altri comandi

Tra i bersagli supportati:

- navigazione a ogni pagina;
- nuovo ordine;
- forza sincronizzazione;
- apri notifiche;
- apri Cestino;
- apri Informazioni, aggiornamenti o novità;
- apri gioco;
- importazione Giornaliero;
- export Aruba;
- pulizia dati.

Le azioni pericolose continuano a passare dai dialoghi di conferma della pagina destinataria.

### 57.16 Deduplicazione

Risultati testuali e comandi smart possono puntare allo stesso bersaglio. Prima della visualizzazione vengono deduplicati tramite una chiave stabile, così la stessa azione non compare più volte.

### 57.17 Tastiera e finestra

- frecce: cambiano selezione;
- Invio: esegue;
- Esc: chiude;
- click: esegue la voce;
- perdita del focus: nasconde la finestra secondo il comportamento desktop.

Le righe informative disabilitate non possono essere eseguite.

## 58. Produzione: riferimento completo

### 58.1 Viste

La pagina separa gli ordini da avviare e quelli già in produzione. I conteggi del selettore misurano ordini con almeno una riga pertinente, non il numero assoluto di prodotti.

### 58.2 Selezione

È possibile selezionare:

- un ordine;
- singole righe dell'ordine;
- tutte le righe ammissibili;
- più ordini;
- interi lotti nella vista successiva.

La selezione controlla le azioni massive. Una riga non ammissibile resta visibile ma non selezionabile.

### 58.3 Ordini generici o incompleti

Se un ordine non contiene un prodotto valido, la UI invita a completarlo. Il comando apre l'ordine focalizzando la sezione prodotti. Dopo l'aggiunta, l'ordine torna selezionato ed espanso nella pagina Produzione.

### 58.4 Controllo acconto

L'acconto incassato è mostrato con data. Se manca, la modale segnala **Acconto non ancora registrato**. Il controllo rende evidente la condizione economica prima dell'avvio.

### 58.5 Compila produzione

Per ogni riga Immunoterapia:

- formulazione;
- posologia;
- allergeni/ceppi, massimo 10.

I suggerimenti combinano catalogo e storico. L'operatore può correggere ogni valore.

### 58.6 Numerazione e lotti

Il passaggio in produzione assegna/usa il numero di produzione e raggruppa le righe secondo il flusso previsto. Diagnostica e Immunoterapia seguono percorsi distinti; il menu permette di scegliere il tipo di avvio.

### 58.7 File Laboratorio

Per un lotto Immunoterapia è disponibile la generazione Laboratorio. Se il lotto non contiene righe Immunoterapia, l'azione viene rifiutata con avviso. I dati esportati derivano dalle righe selezionate e dai campi di produzione compilati.

### 58.8 Date previste

La modale data consegna permette:

- valore comune **Imposta per tutti**;
- date specifiche per riga;
- input in forma testuale comprensibile o data;
- salvataggio soltanto delle date valide.

La data prevista è informativa e non equivale alla data di arrivo effettiva.

### 58.9 Arrivo in Italia

Il comando segna il lotto/pacco come arrivato e registra la data. Il feedback visivo conferma il passaggio. L'azione è disponibile soltanto quando esistono prodotti nello stato corretto.

### 58.10 Unione e separazione dei lotti

Nella scheda **In lavorazione** l'operatore può selezionare almeno due lotti e premere **Unisci lotti**. I lotti diventano un unico gruppo operativo anche se sono stati creati in giorni diversi. L'unione serve soprattutto a preparare un solo export e a consultare insieme lavorazioni correlate; non rimanda gli ordini in produzione e non modifica i pagamenti.

Dal menu del lotto unito, **Separa lotto** ripristina i gruppi originali conservati dal gestionale. La separazione è quindi reversibile e non duplica prodotti, non annulla il lotto e non cambia lo stato degli ordini.

### 58.11 Ritorni di stato

Le azioni di annullamento chiedono conferma e verificano che non esistano eventi successivi incompatibili. Riportare “da produrre” una riga non annulla automaticamente pagamenti o modifiche all'ordine.

### 58.12 Filtri

- ricerca per numero, medico, cliente e paziente;
- agente;
- sottostato;
- acconto incassato/atteso;
- periodo e intervallo personalizzato;
- categoria o segmento compatibile.

## 59. Spedizioni: riferimento completo

### 59.1 Ammissibilità

La vista Da spedire include righe pronte secondo stato produttivo e categoria. Diagnostica e Keriba sono normalmente escluse; il toggle le mostra e **Aggiungi collo** consente comunque una spedizione manuale.

### 59.2 Destinatario effettivo

Per gli ordini ordinari il destinatario deriva dal cliente. Per Diagnostica può essere il medico/azienda. Le modifiche eseguite nel record spedizione non aggiornano automaticamente l'anagrafica.

### 59.3 Creazione multipla

La modale può creare una o più spedizioni nello stesso salvataggio. Richiede:

- corriere;
- data;
- almeno una riga selezionata.

Se mancano, il focus resta sul problema e nessuna spedizione viene creata.

### 59.4 Unione automatica proposta

Quando lo stesso destinatario ha più ordini, viene proposta l'unione in un collo. L'utente può accettare o mantenere colli separati.

### 59.5 Controlli per collo

Ogni collo possiede:

- numero colli;
- preavviso telefonico;
- note;
- contrassegno;
- importo;
- righe incluse;
- numero/lotto per prodotto.

Il comando globale del preavviso imposta tutti i colli, mentre il controllo locale permette eccezioni.

### 59.6 Inclusione parziale

Le checkbox delle righe permettono di spedire soltanto parte di un ordine. Le righe escluse restano Da spedire. Aprire l'ordine dalla modale non perde automaticamente la selezione corrente.

### 59.7 Unisci/separa destinatari

Questa funzione si usa **prima della creazione**. La modale mostra gruppi e candidati: l'unione prepara un solo collo per righe compatibili, mentre la separazione mantiene colli distinti. Le anagrafiche non vengono modificate.

Non va confusa con l'unione dei gruppi già presenti in **Effettuate**.

### 59.8 Rimozione prodotto dal collo

Il click sul prodotto richiede conferma. Dopo la rimozione, la riga torna disponibile per un altro collo; non viene eliminata dall'ordine.

### 59.9 Profili corriere

Il corriere può avere un profilo:

- **CORRIERE_B**;
- **CORRIERE_A**;
- **CORRIERE_C**.

Il profilo controlla formato e campi dell'esportazione distinta/spedizione, inclusi servizi, preavviso e contrassegno. Il profilo non cambia il destinatario.

### 59.10 Storico e filtri

La vista Effettuate filtra per:

- testo;
- corriere multiplo;
- data dal/al.

Le righe espandibili mostrano colli, ordini, prodotti e stato economico.

In **Effettuate** è inoltre possibile selezionare almeno due gruppi e premere **Unisci**. Le spedizioni diventano un unico gruppo di consultazione anche se appartengono a giorni o corrieri diversi. L'operazione non modifica colli, righe, ordini o pagamenti: le distinte restano separate per corriere e il riepilogo incassi resta diviso per conto e agente. Dal gruppo unito, **Separa** ripristina le sessioni originali.

### 59.11 Annullamento singolo o totale

È possibile annullare:

- un singolo collo/gruppo;
- l'intera spedizione.

Entrambe le azioni richiedono conferma e ripristinano le righe tra quelle da spedire. Dati contabili già riconciliati devono essere verificati separatamente.

### 59.12 Riepilogo incassi

Aprendo un gruppo effettuato, il Gestionale PharmaTek calcola il riepilogo economico soltanto per gli ordini che hanno almeno una riga in quel gruppo. Il calcolo segue queste regole:

1. somma il valore dei prodotti effettivamente partiti;
2. nelle spedizioni parziali attribuisce soltanto la quota di acconto relativa al numero di righe partite;
3. sottrae quella quota dal valore spedito, senza contare nuovamente l'acconto nel riepilogo;
4. distribuisce l'importo risultante sui pagamenti non-acconto dell'ordine, partendo dalle scadenze più vicine;
5. divide le somme tra **Già incassato** e **Da incassare**, poi le raggruppa per conto e per agente.

Esempio: un ordine contiene due righe da 300 € e un acconto di 200 €. Se parte una sola riga, il valore attribuito alla spedizione è 300 € meno metà acconto, quindi 200 €.

Il riepilogo serve a capire su quali conti deve arrivare il denaro collegato alla merce partita. Non sostituisce la distinta del corriere e non rappresenta il calcolo delle provvigioni.

### 59.13 Bollettazione da Excel

Il parser accetta i tracciati recenti con `FechaPedido` e quello storico con `Fecha Envío`.
`Referencia` resta testuale, compresi gli zeri iniziali. BELTAVAC, BELTAORAL e VEB vengono
ricondotti ai prodotti Immunoterapia già presenti; formulazione, posologia e allergeni sono
proposti sui campi esistenti. Il sistema non crea clienti, ordini o prodotti.

Il matching usa paziente/cliente come segnale principale e medico, prodotto e dettagli come
conferme. L'assegnazione è globale e uno-a-uno: una riga ordine non può essere proposta
automaticamente a due righe del file. I risultati incerti richiedono sempre una decisione
dell'operatore e la conferma verifica nuovamente revisioni, stato, corriere, lotti e unicità dei
riferimenti.

## 60. Distinte: riferimento completo

### 60.1 Scopo

La distinta collega accrediti del corriere ai contrassegni/assegni registrati nelle spedizioni. Evita di saldare manualmente ogni movimento di transito.

### 60.2 Nuova distinta

L'utente sceglie corriere, modalità, date e movimenti. L'elenco propone soltanto elementi compatibili e non già riconciliati.

### 60.3 Selezione

Le righe possono essere selezionate singolarmente o in blocco. Il totale selezionato viene confrontato con l'importo accreditato.

### 60.4 Conto di accredito

Il conto può derivare:

1. dal corriere;
2. dalle preferenze conti;
3. dalla scelta manuale.

Il conto di transito dei singoli contrassegni e il conto bancario di accredito hanno ruoli diversi.

### 60.5 Differenze

Se totale movimenti e accredito non coincidono, la UI evidenzia lo scarto. L'operatore deve correggere selezione o importo prima di rappresentare la distinta come riconciliata.

### 60.6 Effetti

Alla conferma:

- i movimenti inclusi risultano accreditati;
- conto e data vengono registrati;
- pagamenti e riepiloghi si aggiornano;
- gli elementi non possono essere inclusi in una seconda distinta attiva.

### 60.7 Annullamento

Annullare la distinta libera i movimenti e ripristina lo stato in attesa di accredito. Non annulla le spedizioni che hanno generato i contrassegni.

## 61. Giornaliero: funzioni residue

### 61.1 Numero provvisorio offline

Un ordine creato offline può mostrare un numero provvisorio. L'icona segnala che la numerazione definitiva dipende dall'allineamento; il record resta utilizzabile secondo le funzioni disponibili.

### 61.2 Filtri completi

I filtri comprendono:

- stati multipli;
- linee;
- segnalazioni;
- spediti/non spediti;
- agente;
- medici;
- regione;
- data dal/al;
- ricerca per numero, cliente e medico.

Sono combinati in AND tra categorie e in OR all'interno di selezioni multiple dello stesso campo.

### 61.3 Marcatori

I marcatori disponibili nella riga segnalano urgenza, anomalia o sollecito. Possono essere impostati, cambiati o rimossi. Alimentano filtri, Dashboard e promemoria/segnalazioni.

### 61.4 Ripristino di un ordine rifiutato

Quando consentito, il menu può ripristinare un ordine dallo stato rifiutato scegliendo un nuovo stato coerente. La motivazione storica resta disponibile secondo i dati conservati.

### 61.5 Annulla, rifiuta o elimina

Il dialogo di rimozione distingue:

- annullamento nel Cestino;
- rifiuto con motivazione;
- eliminazione prevista dal contesto.

La scelta modifica stato e visibilità in modo diverso; non sono sinonimi.

### 61.6 Omaggio/sostituzione

L'icona regalo identifica ordini esclusi dalle provvigioni. La sostituzione mantiene il riferimento all'ordine originario e segue produzione/spedizione per le righe fisiche necessarie.

### 61.7 Menu contestuale

Click destro e pulsante azioni espongono funzioni equivalenti. Il menu viene posizionato nell'area visibile e si chiude dopo l'azione.

## 62. Dashboard: origine dei dati

### 62.1 Ordini

La card conta gli ordini del periodo scelto. Il click apre il Giornaliero con lo stesso intervallo.

### 62.2 Da saldare

Somma il residuo positivo e distingue spedito/non spedito. Gli extra non riducono artificialmente il credito di altri ordini.

### 62.3 In produzione

Conta ordini/righe nel flusso produttivo, distinguendo gli stati mostrati dalla card. Il click apre Produzione.

### 62.4 Provvigioni maturate

Usa le stesse regole della pagina Provvigioni. Il numero cambia con eventi di maturazione e pagamenti storici.

### 62.5 Grafici e periodi

I selettori di periodo sono locali al grafico. Il click su segmento/punto costruisce filtri per la pagina di dettaglio. Il tooltip mostra il valore esatto senza modificare la selezione.

### 62.6 Intervallo personalizzato

La modale intervallo richiede Dal/Al coerenti. Applicare l'intervallo aggiorna soltanto il componente da cui è stata aperta.

## 63. Promemoria: riferimento completo

### 63.1 Tipi e collegamenti

Un promemoria può essere libero o collegato a ordine, cliente, medico o altra entità prevista. Il collegamento abilita **Apri collegato**.

### 63.2 Scadenza e priorità

Data/ora determinano quando l'elemento diventa imminente o scaduto. La priorità controlla colore e ordine visivo, non anticipa materialmente la data.

### 63.3 Destinatari

Può essere personale o destinato ad altri utenti. La notifica multipla richiede almeno un destinatario.

### 63.4 Completamento

**Fatto** chiude il promemoria. Una segnalazione derivata da un ordine usa **Risolvi**, che azzera il marcatore corrispondente invece di creare un secondo record.

### 63.5 Posticipo

Le opzioni rapide aggiungono uno o sette giorni; **Al giorno** imposta una data esplicita. Il posticipo modifica la scadenza, non crea una copia.

### 63.6 Finestra separata

L'apertura da una notifica usa sempre la finestra dedicata, così l'utente può consultare il record senza perdere la pagina corrente.

## 64. Importazione anagrafiche

### 64.1 File e categorie

La procedura accetta più percorsi. Per ogni file mostra nome, percorso e categoria rilevata. L'utente può cambiare categoria o rimuovere il file dalla coda.

### 64.2 Analisi

Vengono letti fogli/colonne e costruita un'anteprima. Le intestazioni vengono associate ai campi del registro compatibile.

### 64.3 Errori

Sono distinti:

- file illeggibile;
- categoria non riconosciuta;
- colonna obbligatoria assente;
- valore non valido;
- record duplicato;
- riga ignorata.

### 64.4 Duplicati

La procedura confronta i record esistenti e quelli del file. Prima di un'operazione rischiosa mostra una conferma rafforzata. La somiglianza non equivale automaticamente a identità.

### 64.5 Lock

L'importazione viene disabilitata quando un'altra postazione possiede un lock incompatibile. Non va aggirato copiando manualmente i dati nella cartella condivisa.

### 64.6 Riepilogo

Al termine mostra creati, aggiornati, ignorati ed errori. Il controllo campione sulle Anagrafiche resta parte della procedura consigliata.

## 65. Export Aruba

### 65.1 Preparazione

La modale raccoglie tutti i clienti non ancora esportati compresi nel periodo scelto. Il riepilogo
mostra quanti record sono pronti e quanti richiedono un codice fiscale provvisorio.

### 65.2 Validazioni

Un codice fiscale reale viene conservato. Se manca, il gestionale genera automaticamente un valore
provvisorio deterministico e aggiunge `(FAKE)` al cognome esportato. La stessa anagrafica produce
sempre lo stesso valore provvisorio; il codice non viene scritto nella scheda cliente. Gli altri
campi facoltativi mancanti restano vuoti.

### 65.3 Risultato

Il file viene salvato nella destinazione scelta. Se i clienti superano 499, la divisione in più file
è proposta automaticamente. Lo stato condiviso `aruba_esportato_il` viene aggiornato soltanto dopo
il salvataggio riuscito, così un errore o un annullamento non fa sparire clienti ancora da esportare.

### 65.4 Importazione in Aruba

1. Salvare il file Excel in una posizione riconoscibile.
2. Aprire Aruba e raggiungere **Clienti**.
3. Scegliere **Importa**.
4. Caricare l'Excel creato dal Gestionale PharmaTek.
5. Controllare il riepilogo proposto da Aruba prima della conferma finale.

L'esportazione prepara il file ma non equivale all'invio, all'accettazione fiscale o alla creazione
di una fattura in Aruba.

## 66. Cestino

### 66.1 Contenuto

Può contenere ordini, pagamenti, rimborsi, regole prezzo e altri record gestiti con soft-delete.

### 66.2 Ripristino

Il ripristino riattiva il record. Se dipende da un record ancora eliminato, il risultato può richiedere anche il ripristino del collegamento padre.

### 66.3 Eliminazione definitiva

Richiede conferma e non è annullabile dall'interfaccia. I backup restano l'unica possibile fonte di recupero.

### 66.4 Svuota

Rimuove tutti gli elementi presenti. La conservazione automatica configurata nelle Impostazioni può eseguire lo stesso tipo di pulizia sugli elementi oltre soglia.

## 67. Sincronizzazione e postazioni

### 67.1 Stato dispositivo

Il pannello mostra utenti/postazioni e attività recente. L'assenza di attività non prova da sola che il PC sia guasto: può essere spento o offline.

### 67.2 Eventi remoti

Salvataggi provenienti da altri PC invalidano e ricaricano viste, notifiche e indice Spotlight pertinenti.

### 67.3 Conflitti

Le operazioni sono registrate come eventi ordinabili. Quando due postazioni modificano dati collegati, la proiezione viene riallineata secondo l'ordine determinato dal sistema; l'utente deve comunque verificare modifiche contemporanee allo stesso record.

### 67.4 Forza sincronizzazione

Richiede un nuovo ciclo di lettura/scrittura. Non sostituisce un ripristino e non cancella modifiche locali.

### 67.5 Offline

I record creati offline possono avere riferimenti provvisori. Al ritorno della cartella condivisa vengono propagati e l'interfaccia aggiorna gli identificativi definitivi.

## 68. Aggiornamenti software

### 68.1 Controllo

Il controllo aggiornamenti può essere manuale o in background. Un errore di rete viene segnalato senza bloccare il gestionale.

### 68.2 Installazione

Quando disponibile, l'utente segue il flusso proposto. Prima dell'installazione va concluso il lavoro non salvato.

### 68.3 Novità

Dopo l'aggiornamento, il pannello mostra le modifiche della versione. Chiuderlo registra l'avvenuta visualizzazione.

### 68.4 Storico

Lo storico changelog permette di consultare versioni precedenti, categorie e dettagli.

## 69. Esportazione e stampa tabelle

Le funzioni comuni operano sui dati della vista:

- rispettano filtri attivi;
- usano le colonne previste dall'esportatore;
- formattano date e importi;
- possono produrre foglio, CSV, PDF o stampa secondo la schermata.

Prima di condividere un file va verificato se comprende tutte le righe filtrate o soltanto la selezione. L'esportazione non modifica lo stato dei record.

## 70. Preferenze: ordine di priorità

### 70.1 Conti

La preferenza più specifica del medico precede quella dell'agente; seguono preferenze globali e conto di ripiego.

### 70.2 Prezzi

Medico+prodotto precede agente+prodotto, poi prezzo Immunoterapia del medico e prezzo base.

### 70.3 Acconti

Preferenze del soggetto e soglie prodotto costruiscono il suggerimento. La modifica manuale dell'ordine lo protegge.

### 70.4 Rate

Il numero predefinito del medico inizializza la modale, ma l'utente può cambiarlo entro 1–60.

### 70.5 Corrieri

Il profilo del corriere determina l'export; il conto preferito determina la proposta di accredito.

# Appendice A — Inventario delle superfici UI

## Pagine principali

- Dashboard
- Giornaliero
- Preventivi (premium)
- Produzione
- Spedizioni
- Contabilità: Pagamenti
- Contabilità: Distinte
- Contabilità: Provvigioni
- Contabilità: Rimborsi
- Anagrafiche: Agenti
- Anagrafiche: Medici
- Anagrafiche: Clienti
- Anagrafiche: Prodotti
- Anagrafiche: Conti
- Anagrafiche: Corrieri
- Impostazioni

## Modali e popover operativi

- Aggiungi anno
- Profilo
- Campanella notifiche
- Cestino
- Nuovo/modifica promemoria
- Invia notifica
- Nuovo ordine
- Nuovo/modifica cliente dall'ordine
- Nuovo/modifica medico dall'ordine
- Sostituzione
- Rifiuto ordine
- Editor preventivo
- Anteprima documento A4
- Scheda cliente
- Revisione campagna solleciti preventivi
- Compila produzione
- Crea spedizione
- Aggiungi collo
- Unisci/separa destinatari
- Modifica dati spedizione
- Note spedizione
- Modifica contrassegno
- Pagamento
- Rateizza
- Distinta
- Paga provvigioni
- Storico provvigioni
- Rimborso
- Segna rimborso effettuato
- Form anagrafica
- Calcola codice fiscale
- Regole prezzo/Prova prezzo
- Preferenze agenti
- Preferenze conti
- Preferenze prodotti
- Import anagrafiche
- Export Aruba
- Ripristino coordinato
- Ripristino manuale
- Ritira PC

## Finestre separate

- Editor ordine
- Pagamento
- Promemoria
- Spotlight
- Overlay notifiche
- Elenco notifiche
- Cestino
- Riepilogo
- Info/aggiornamenti

---

# Appendice B — Glossario

- **Acconto**: importo incassato prima del saldo.
- **Collo**: unità fisica/logica affidata alla spedizione.
- **Contrassegno**: importo incassato dal corriere alla consegna.
- **Distinta**: raggruppamento usato per riconciliare accrediti del corriere.
- **Evento sincronizzato**: modifica condivisa con le altre postazioni.
- **Finestra separata**: webview desktop indipendente dalla pagina principale.
- **Marcatori**: segnalazioni operative applicate a un ordine.
- **Prima nota verificata**: controllo contabile effettuato sul movimento.
- **Proiezione locale**: copia strutturata usata dalla postazione per mostrare i dati.
- **Riga ordine**: singolo prodotto/servizio contenuto nell'ordine.
- **Soft-delete**: spostamento reversibile nel Cestino.
- **Spotlight**: ricerca e lanciatore comandi globale.

---

# Appendice C — Confini e note di manutenzione

Questo manuale fotografa la UI presente nel repository alla data indicata. Le etichette possono cambiare con nuove versioni. Prima di distribuire il documento agli utenti finali è consigliato:

1. sostituire le sezioni più tecniche con esempi aziendali reali;
2. aggiungere screenshot della versione rilasciata;
3. indicare ruoli e permessi effettivamente adottati;
4. trasformare le procedure più frequenti in schede rapide;
5. aggiornare revisione e changelog del manuale a ogni release importante.

---

# Appendice D — Matrice di copertura del codice UI

Questa matrice collega le superfici implementate alle sezioni funzionali del manuale. I componenti puramente grafici sono associati al comportamento che rappresentano.

| Area/componente | Funzione documentata | Sezioni |
|---|---|---|
| `App` | bootstrap, errori, riconnessione, onboarding, novità | 4–5 |
| `Shell`, `Sidebar`, `Topbar` | cornice, anno, sync, profilo, ricerca | 6–7 |
| `AnnoModal` | aggiunta anno di lavoro | 6.1 |
| `CampanellaPopover`, `NotificheWindow` | elenco notifiche | 7.5, 36, 56 |
| `OverlayWindow` | popup, coda, timer, risposta | 34, 56.10 |
| `CestinoPopover`, `CestinoWindow`, `CestinoContenuto` | ripristino e cancellazione | 7.4, 66 |
| `SpotlightWindow`, motore `ricerca`, `frecency` | ricerca globale e comandi | 33, 57 |
| `RiepilogoWindow` | KPI e riepiloghi separati | 37 |
| `DashboardView`, `CountUp` | KPI, grafici e periodi | 8–10, 62 |
| `BachecaPromemoria` | bacheca, azioni rapide e invio | 10, 63 |
| `PromemoriaModal`, `PromemoriaWindow` | creazione/modifica e finestra | 11, 63 |
| `GiornalieroView` | elenco, filtri, azioni e stati | 12, 61 |
| `ColonneMenu` | visibilità colonne | 12.3 |
| `NuovoOrdineMenu` | scelta tipo nuovo ordine | 12.1 |
| `PipelineStato` | stato e transizioni ordine | 13 |
| `OrdineEditor`, `OrdineWindow` | compilazione completa ordine | 14 |
| `SostituzioneModal` | sostituzione/omaggio | 15, 61.6 |
| flusso `rifiuta` | rifiuto e ripristino | 16, 61.4–61.5 |
| `PreventiviView` | elenco, filtri, azioni, invii e solleciti | 16 bis |
| `PreventivoEditorModal`, `parserPreventivo` | compilazione e interpretazione offline | 16 bis.1–16 bis.2 |
| `DocumentoPreviewModal`, `rendererDocumenti` | anteprima, PDF, PNG e stampa A4 | 16 bis.3 |
| `SchedaClienteModal` | form e documento separato della scheda cliente | 16 ter |
| `ProduzioneView` | selezione, lotti, stati e Laboratorio | 17, 58 |
| `CompilaProduzioneModal` | formulazione, posologia e allergeni | 17.2, 58.5 |
| `DataConsegnaPrevistaModal` | date previste per lotto, righe ed export | 58.8 |
| `InProduzioneFlourish` | conferma visiva di avanzamento | 17.4 |
| `SpedizioniView` | code, storico, filtri e annullamenti | 18, 59 |
| `CreaSpedizioneModal` | creazione colli singoli/multipli | 18.3, 59.3–59.6 |
| `AggiungiColloModal` | collo manuale | 18.4 |
| `GruppoSpedDettaglio` | dettaglio, unione e separazione | 18.5, 59.7–59.8 |
| `ColloAzioni` | destinatario, note e contrassegno | 18.6–18.8 |
| `FurgoncinoLoader`, `SpeditoFlourish` | feedback di salvataggio | 18.9 |
| `ContabilitaHub` | navigazione schede | 19 |
| `PagamentiView`, `colonneCrediti` | scadenzario, filtri e prima nota | 20 |
| `PagamentoModal`, `PagamentoWindow` | incassi/attesi e finestra | 20.1–20.2 |
| logica `coperturaScadenzario` | riallineamento della copertura | 20.1 |
| `RateizzaModal`, logica `rateizzazione` | piano rate completo | 20.3 |
| `DistinteView`, `DistintaModal` | riconciliazione corrieri | 21, 60 |
| `ProvvigioniView` | maturato, potenziale e filtri | 22, 54 |
| `PagaProvvigioniModal` | selezione e liquidazione | 22.1, 54.5–54.7 |
| `StoricoProvvigioniModal`, `provvigioniExport` | storico, annullo e stampa | 22.2, 54.8–54.10 |
| `RimborsiView` | elenco e filtri rimborsi | 23, 55 |
| `RimborsoModal`, `SegnaEffettuatoModal` | creazione ed esecuzione | 23.1–23.2, 55 |
| `AnagraficheHub`, `RegistroView` | sei registri | 24–25 |
| `categorie` anagrafiche | categorie prodotto condivise | 14.3, 24, 58–59 |
| `FormAnagrafica` | form, validazione e CAP | 25.1, 25.4 |
| `CalcolaCFPopover` | calcolo e controllo CF/P.IVA | 25.3 |
| regole `prezzi` | prova prezzo e gerarchia | 26, 70.2 |
| `PreferenzeAgentiModal` | parametri agenti | 27, 54.1 |
| `PreferenzeContiModal` | conti predefiniti | 28, 70.1 |
| `PreferenzeProdottiModal` | soglie acconto | 29, 70.3 |
| `ImportAnagraficheModal`, deduplicazione | import e duplicati | 30–31, 64 |
| `ExportArubaModal` | export fiscale | 32, 65 |
| `ComposerMessaggio`, logica messaggi | invio e risposta | 35, 56 |
| `ListaNotifiche`, hook notifiche e suoni | lettura, scarto e popup | 34–36, 56 |
| `ProfiloModal` | nome e avatar | 39 |
| `Impostazioni` | preferenze e amministrazione | 40–43 |
| `PuliziaDatiBox` | anteprima, conferma, backup e purge | 43, 66 |
| backup/restore UI | backup e ripristino coordinato | 41 |
| gestione dispositivi | reset e ritiro PC | 42, 67 |
| `NovitaPanel`, `StoricoChangelog` | novità e storico | 38, 68 |
| `categorie` changelog | raggruppamento visivo delle novità | 38.1–38.2 |
| `InfoWindow`, aggiornamenti | info e update | 38.3, 68 |
| `FlappyLivio` | funzione ludica | 38.4 |
| `Tabella`, `VirtualFlow`, `VirtualStack`, logica `virtualizzazione` | tabelle e virtualizzazione | 3.3, 56.8 |
| `colonne` Giornaliero | definizione e resa delle colonne ordini | 12.3, 61 |
| `Pagina`, `navigazione` | caricamento coordinato e passaggio filtri | 3.1–3.2 |
| esportatori comuni | fogli, CSV, PDF e stampa | 69 |
| dialog e toast condivisi | conferme, avvisi ed errori | 3.4, 44 |
| motion e reduced-motion | animazioni accessibili | 17.4, 40.4 |

---

# Appendice E — Stati, transizioni e indicatori

## E.1 Stati dell'ordine

| Stato | Significato operativo | Come ci arriva | Cosa può succedere dopo |
|---|---|---|---|
| Nuovo | Ordine registrato ma non ancora confermato operativamente | Creazione senza incassi confermati | Conferma, modifica, rifiuto o Cestino |
| Confermato | Ordine validato e pronto per i flussi successivi | Salvataggio con condizioni coerenti o pagamento registrato | Produzione oppure spedizione, secondo categoria |
| In produzione | Almeno una riga è stata avviata | Azione nel modulo Produzione | Arrivo in Italia, completamento o ritorno controllato |
| Arrivato in Italia | Il prodotto estero è arrivato ed è disponibile per l'evasione | Registrazione dell'arrivo | Preparazione spedizione |
| Spedito | Tutte le righe spedibili risultano evase | Conferma della spedizione completa | Chiusura amministrativa |
| Chiuso | Ciclo operativo archiviato | Completamento delle condizioni previste | Consultazione storica |
| Rifiutato | Ordine conservato ma escluso dal flusso ordinario | Rifiuto con motivazione | Eventuale ripristino controllato |

Un ordine parzialmente spedito non usa uno stato separato: diventa **Spedito** soltanto a evasione completa. Le singole righe conservano il dettaglio necessario.

## E.2 Transizioni da non interpretare come automatiche

Non ogni evento modifica da solo lo stato generale:

- registrare un acconto non equivale sempre a mandare in produzione;
- compilare i dati di produzione non equivale ad avviare le righe;
- creare un collo non equivale a ricevere il pagamento;
- spedire non equivale a chiudere contabilmente;
- effettuare un rimborso non cambia il totale dell'ordine;
- pagare una provvigione non chiude l'ordine.

## E.3 Stati del pagamento

| Stato | Origine | Significato |
|---|---|---|
| Da saldare | Derivato o override | Esiste ancora un residuo da incassare |
| Saldato | Derivato o override | Copertura completa registrata |
| Da verificare | Manuale/derivato | Incasso presente ma controllo contabile ancora necessario |
| Da controllare | Manuale | Caso anomalo che richiede verifica dell'operatore |
| Omaggio / sostituzione | Manuale/ordine | Nessun normale incasso atteso |
| In attesa accredito | Conto di transito | Denaro riscosso tramite corriere/assegno ma non ancora accreditato |

Lo stato sintetico non sostituisce le singole righe dello scadenzario. In caso di dubbio vanno controllati importi, scadenze, conti e stato Atteso/Incassato.

## E.4 Tipi di pagamento

| Tipo | Funzione | Può essere atteso? | Può essere incassato? |
|---|---|---:|---:|
| Acconto | Quota iniziale | Sì | Sì |
| Saldo | Parte finale non rateizzata | Sì | Sì |
| Rata | Quota di un piano | Sì | Sì |

## E.5 Stati del rimborso

| Stato | Condizione | Azione principale |
|---|---|---|
| Richiesto | Manca la data effettiva del rimborso | Segna come effettuato |
| Effettuato | Data di rimborso valorizzata | Consultazione o correzione |

L'origine è indipendente dallo stato:

- **Manuale**: creato senza ordine.
- **Soldi in eccesso**: collegato a un ordine con extra.

## E.6 Marcatori dell'ordine

| Marcatore | Uso | Risoluzione |
|---|---|---|
| Urgente | Richiede priorità operativa | Rimuovi marcatore/Risolvi |
| Anomalia | Segnala un dato o flusso da controllare | Correggi la causa e risolvi |
| Da sollecitare | Richiede contatto o richiamo | Registra l'esito e risolvi |

I marcatori non cambiano lo stato dell'ordine e non producono automaticamente un pagamento.

## E.7 Stati di sincronizzazione

| Indicatore | Significato | Azione consigliata |
|---|---|---|
| Online/allineato | Ultimo ciclo riuscito | Lavorare normalmente |
| In sincronizzazione | Lettura o scrittura in corso | Attendere prima di manutenzioni |
| Offline | Cartella o rete non disponibile | Continuare soltanto con operazioni ordinarie |
| Lock altrui | Altra postazione esegue manutenzione | Non forzare |
| Ripristino | Dati in sostituzione/riallineamento | Attendere la conclusione |

---

# Appendice F — Matrice degli effetti tra moduli

## F.1 Operazioni sull'ordine

| Operazione | Giornaliero | Produzione | Spedizioni | Contabilità | Provvigioni/Notifiche |
|---|---|---|---|---|---|
| Modifica cliente | Aggiorna collegamento | Cambia dati mostrati | Può cambiare destinatario futuro | Cambia intestazione visualizzata | Aggiorna contesto |
| Modifica medico | Aggiorna agente/prezzi automatici | Cambia riferimenti | Per Diagnostica può cambiare destinatario | Cambia conto proposto | Cambia agente e regola |
| Modifica prodotto/prezzo | Ricalcola totale | Cambia riga da produrre | Cambia riga da spedire | Riconcilia scadenzario | Ricalcola base provvigionale |
| Modifica acconto | Aggiorna ordine | Può rimuovere/mostrare avviso | Nessun effetto fisico diretto | Aggiorna voce attesa | Può cambiare quota anticipata |
| Salva preventivo | Aggiorna righe e totale nello stesso batch | Cambia i dati soltanto se l'ordine è ancora Nuovo | Nessun effetto fisico diretto | Riconcilia lo scadenzario aperto | Non cambia lo stato ordine |
| Rifiuta | Esclude dal flusso | Non deve avanzare | Non deve essere spedito | Conserva lo storico coerente | Escluso dai normali calcoli |
| Cestina | Nasconde dalle viste | Rimuove dalle code | Rimuove dalle code compatibili | Record collegati restano secondo regole | Aggiorna notifiche |

## F.2 Operazioni di produzione e spedizione

| Operazione | Effetto immediato | Effetti successivi |
|---|---|---|
| Manda in produzione | Cambia stato righe e assegna lotto/numero | Alimenta date e vista In produzione |
| Compila formulazione | Salva dati tecnici | Vengono riusati nell'export e nello storico |
| Arrivato in Italia | Registra data/stato | Rende il prodotto predisposto all'evasione |
| Crea spedizione | Marca le righe incluse come spedite | Fissa scadenze relative e genera contrassegni |
| Rimuovi dal collo | Riporta la riga tra quelle organizzabili | Nessuna cancellazione dall'ordine |
| Annulla spedizione | Ripristina righe Da spedire | Richiede controllo su distinte e incassi |

## F.3 Operazioni contabili

| Operazione | Residuo | Stato pagamento | Notifiche | Altro |
|---|---:|---|---|---|
| Crea atteso | Non aumenta l'incassato | Rappresenta la previsione | Può generare sollecito | Copre lo scadenzario |
| Salda | Riduce il residuo | Può diventare saldato/da verificare | Rimuove sollecito pertinente | Registra conto e data |
| Annulla pagamento | Aumenta/ricalcola residuo | Ricalcolato | Aggiornate | Può annullare rimborso extra |
| Crea distinta | Non cambia il totale ordine | Accredita movimenti di transito | Aggiornate | Collega più contrassegni |
| Annulla distinta | Invariato | Torna in attesa accredito | Aggiornate | Libera movimenti |
| Crea rimborso | Non cambia totale prodotti | Nessun incasso cancellato | Può generare attività | Traccia restituzione |
| Paga provvigioni | Invariato | Invariato | Nessun sollecito cliente | Riduce quota pagabile agente |

## F.4 Modifica anagrafica o dato locale

| Tipo di modifica | Ambito |
|---|---|
| Modifica cliente/medico dall'ordine | Anagrafica condivisa, usata anche altrove |
| Dati di fatturazione diversi | Solo ordine/fatturazione specifica |
| Modifica destinatario della spedizione | Record spedizione, non necessariamente anagrafica |
| Nota di spedizione anagrafica | Preferenza ricorrente |
| Nota su singolo collo | Soltanto quella spedizione |
| Preferenza conto/prezzo/acconto | Suggerimenti e calcoli futuri |
| Valore manuale nell'ordine | Protetto dagli automatismi compatibili |

## F.5 Operazioni distruttive e possibilità di recupero

| Operazione | Recuperabile dalla UI? | Protezione |
|---|---:|---|
| Chiudi modale senza salvare | No | Avviso se ci sono modifiche |
| Sposta nel Cestino | Sì | Ripristina |
| Elimina definitivamente | No | Conferma pericolosa |
| Svuota Cestino | No | Conferma pericolosa |
| Annulla pagamento | Sì tramite Cestino, nei limiti dei collegamenti | Conferma e ricalcolo |
| Annulla distinta | La distinta è rimossa, movimenti liberati | Conferma |
| Annulla provvigioni | Sì come ritorno a pagabile | Conferma |
| Ripristina backup | Solo tramite un altro backup | Lock e conferme multiple |

---

# Appendice G — Diagnosi dei problemi e rimedi

## G.1 “Serve il medico e il cliente”

**Causa:** l'ordine ordinario non possiede entrambe le anagrafiche richieste.

**Rimedio:** selezionare o creare cliente e medico. Per Diagnostica è sufficiente il medico/azienda destinatario.

## G.2 “Dai un nome al prodotto”

**Causa:** una riga contiene prezzo o paziente ma non un prodotto.

**Rimedio:** scegliere un prodotto dal catalogo oppure digitare una descrizione libera. Se la riga non serve, svuotarla o rimuoverla.

## G.3 Il prezzo cambia scegliendo il medico

**Causa:** il prezzo era vuoto o coincideva ancora con quello automatico precedente.

**Rimedio:** verificare la regola medico/agente. Se serve una deroga solo per l'ordine, digitare il prezzo manualmente; se deve essere ricorrente, creare una regola prezzo.

## G.4 Il prezzo non cambia scegliendo il medico

**Causa:** il valore è stato riconosciuto come modifica manuale.

**Rimedio:** cancellare il prezzo e riselezionare prodotto/medico per richiedere la proposta automatica, oppure inserire direttamente il valore corretto.

## G.5 L'acconto suggerito non si aggiorna

**Causa:** l'utente ha già toccato manualmente il campo.

**Rimedio:** verificare il valore intenzionale; se si vuole tornare al suggerimento, azzerare il campo secondo il comportamento dell'editor.

## G.6 “La somma delle rate deve essere uguale”

**Causa:** gli importi modificati non coincidono con il saldo.

**Rimedio:** confrontare **Somma rate** e **Importo da rateizzare**; assegnare la differenza, normalmente all'ultima rata.

## G.7 La rata non ha una data reale

**Causa:** è collegata alla spedizione e l'ordine non è ancora partito.

**Rimedio:** nessuna correzione necessaria se la scelta è voluta. La data verrà fissata alla spedizione. Disattivare la spunta per usare una data assoluta.

## G.8 “Scegli un conto per l'incasso”

**Causa:** un movimento Incassato richiede un conto effettivo.

**Rimedio:** selezionare il conto bancario/transito corretto. Se il movimento è ancora futuro, impostarlo come Atteso.

## G.9 Avviso conto di transito

**Causa:** si sta registrando manualmente un incasso su contrassegno/assegno.

**Rimedio:** preferire la distinta del corriere. Usare **Registra comunque** soltanto se il movimento deve davvero restare in attesa di accredito.

## G.10 Un pagamento selezionato nella distinta non è più disponibile

**Causa:** un'altra postazione lo ha modificato o riconciliato.

**Rimedio:** lasciare aggiornare l'elenco, ricontrollare selezione e totale e riprovare. Non ricreare un pagamento duplicato.

## G.11 “Nessuna riga Immunoterapia in questo lotto”

**Causa:** è stata richiesta un'azione Laboratorio su un lotto incompatibile.

**Rimedio:** scegliere il lotto Immunoterapia corretto o usare il flusso Diagnostica.

## G.12 “Nessun prodotto In produzione da segnare”

**Causa:** la selezione non contiene righe nello stato richiesto.

**Rimedio:** espandere il lotto, controllare gli stati e selezionare soltanto righe ammissibili.

## G.13 “Nessuna riga selezionata da spedire”

**Causa:** tutte le righe del collo sono state deselezionate.

**Rimedio:** spuntare almeno un prodotto. Le righe escluse possono essere spedite più avanti.

## G.14 Il destinatario è mancante

**Causa:** ordine manuale/Diagnostica o anagrafica incompleta.

**Rimedio:** compilare destinatario e indirizzo nel collo oppure correggere l'anagrafica prima di creare la spedizione.

## G.15 Una notifica resta dopo averla letta

**Causa:** lettura e cancellazione sono operazioni distinte.

**Rimedio:** usare la `X` per scartarla. Il click la attenua e rimuove soltanto dal conteggio non lette.

## G.16 Il messaggio non parte

**Causa:** testo vuoto, destinatario assente o salvataggio non riuscito.

**Rimedio:** scegliere un utente/Tutti, inserire testo e controllare sincronizzazione. Invio manda; Shift+Invio crea una nuova riga.

## G.17 Spotlight non trova un record

Controllare:

1. anno globale;
2. ortografia o identificativo;
3. categoria dati temporaneamente non caricata;
4. record nel Cestino;
5. sincronizzazione;
6. query AND troppo restrittiva.

Rimuovere un termine alla volta aiuta a individuare quello non presente nell'indice.

## G.17 bis Il preventivo risulta “Modificato dopo l'invio”

**Causa:** almeno un contenuto del documento corrente è diverso dalla fotografia dell'ultimo
invio positivo.

**Rimedio:** aprire l'anteprima, verificare le modifiche e usare **Invia** per creare un nuovo
invio. Non modificare manualmente lo stato dell'ordine: l'indicazione si riallinea soltanto dopo
l'esito positivo della comunicazione.

## G.17 ter Il preventivo o la scheda non entra in una pagina

**Causa:** troppe righe oppure introduzione, condizioni o note oltre la capacità leggibile
dell'A4.

**Rimedio:** seguire l'elenco mostrato nell'anteprima e ridurre soltanto i campi indicati. Stampa e
invio restano disabilitati finché nessun contenuto verrebbe tagliato.

## G.18 L'importazione non trova file Excel

**Causa:** cartella priva di `.xlsx`, `.xlsm` o `.xls`, oppure percorsi non accessibili.

**Rimedio:** selezionare file/cartella corretti e verificare che OneDrive li abbia scaricati localmente.

## G.19 Il codice fiscale risulta non valido

**Causa:** dato incompleto, comune errato, omocodia o P.IVA/CF digitato male.

**Rimedio:** ricontrollare i dati e confrontare con il documento ufficiale. Il calcolatore produce una proposta, non una certificazione.

## G.20 Il CAP propone più comuni

**Causa:** il CAP è condiviso.

**Rimedio:** scegliere esplicitamente il comune corretto; non affidarsi al primo risultato.

## G.21 Caricamento o salvataggio non riuscito

Procedura generale:

1. leggere e annotare il messaggio completo;
2. non premere ripetutamente Salva;
3. controllare l'indicatore sincronizzazione;
4. verificare se il record compare già nell'elenco;
5. riprovare una volta dopo il riallineamento;
6. raccogliere dati per l'assistenza se persiste.

## G.22 Ripristino bloccato

Non chiudere forzatamente le postazioni. Verificare:

- PC coordinatore ancora acceso;
- OneDrive attivo;
- lock mostrato nella UI;
- fase indicata dalla modale.

Usare l'annullamento coordinato se disponibile. Il ripristino manuale è l'ultima opzione.

---

# Appendice H — Checklist decisionali

## H.1 Prima di salvare un ordine

- anno corretto;
- cliente e medico corretti;
- agente derivato corretto;
- prodotti e prezzi verificati;
- dati di produzione completi dove disponibili;
- acconto concordato/incassato distinto correttamente;
- totale, atteso e residuo coerenti;
- dati fiscali alternativi usati soltanto quando necessari.

## H.2 Prima di mandare in produzione

- acconto verificato;
- righe corrette selezionate;
- formulazione, posologia e allergeni controllati;
- numero/paziente corretti;
- nessun ordine rifiutato o duplicato.

## H.3 Prima di spedire

- destinatario e CAP;
- righe incluse;
- numero/lotto;
- colli;
- corriere;
- data;
- preavviso;
- note;
- contrassegno e importo.

## H.4 Prima di registrare un incasso

- ordine corretto;
- tipo acconto/saldo/rata;
- Atteso oppure Incassato;
- importo;
- conto;
- data;
- prima nota;
- copertura totale dopo il salvataggio.

## H.5 Prima di una distinta

- corriere;
- periodo;
- movimenti non già accreditati;
- totale selezionato;
- importo accredito;
- conto definitivo;
- eventuali modifiche da altri PC.

## H.6 Prima di pagare provvigioni

- agente;
- periodo;
- maturazione applicata;
- righe selezionate;
- acconti non spediti inclusi/esclusi;
- totale;
- nessuna liquidazione duplicata.

## H.7 Prima di effettuare un rimborso

- origine manuale/extra;
- ordine collegato;
- importo effettivamente eccedente;
- intestatario;
- IBAN;
- conto di uscita;
- data;
- eventuale pagamento di origine ancora valido.

## H.8 Prima di importare dati

- backup recente;
- nessun lock;
- file corretti;
- categoria corretta;
- anteprima;
- duplicati;
- errori;
- record campione dopo l'import.

## H.9 Prima di ripristinare

- attività ferme;
- backup scelto verificato;
- postazioni raggiungibili;
- OneDrive attivo;
- coordinamento completato;
- nessuna chiusura forzata;
- verifica finale di ordini e contabilità.
