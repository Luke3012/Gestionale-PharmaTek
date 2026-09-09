"""Contenuti editoriali del manuale PDF PharmaTek.

Le immagini sono abbinate in ordine naturale ai testi di ciascun capitolo.
Per aggiungere una schermata: copiarla nella cartella screenshot e aggiungere qui
la relativa voce. Il generatore interrompe la build se la copertura non e completa.
"""

VERSION = "Edizione 1.0"
TITLE = "Gestionale PharmaTek"
SUBTITLE = "Manuale operativo illustrato"

INTRO = {
    "title": "Introduzione",
    "lead": "Una guida semplice, da consultare quando serve",
    "body": [
        "Questo manuale serve quando devi svolgere un'operazione e vuoi controllare i passaggi senza andare a tentativi.",
        "Puoi leggerlo dall'inizio oppure aprire direttamente il capitolo che ti interessa. Ogni procedura indica dove partire, cosa fare e cosa cambia dopo il salvataggio.",
        "I nomi e gli importi usati negli esempi sono indicativi. Nel lavoro reale verifica sempre cliente, prodotti, prezzi e pagamenti prima di confermare.",
    ],
}

GLOSSARY = [
    "Residuo: la parte dell'ordine che non risulta ancora incassata.",
    "Scadenza: la data entro cui è previsto un pagamento.",
    "Movimento atteso: denaro previsto, ma non ancora ricevuto.",
    "Movimento incassato: denaro già ricevuto e registrato su un conto.",
    "Lotto: un gruppo di prodotti inviato insieme al laboratorio.",
    "Contrassegno: pagamento che il corriere riscuote alla consegna.",
    "Distinta: controllo che collega i contrassegni all'accredito del corriere.",
    "Postazione: uno dei PC collegati agli stessi dati del team.",
    "Sincronizzazione: aggiornamento dei dati condivisi tra le postazioni.",
    "Comunicazione: e-mail o messaggio WhatsApp operativo collegato a un cliente e alla relativa pratica.",
    "Campagna: un gruppo di comunicazioni preparate insieme, con avanzamento, pausa e interruzione degli invii pendenti.",
]

CHAPTERS = [
    {
        "key": "dashboard", "number": "01", "title": "Dashboard",
        "lead": "Controlla ordini, incassi, produzione e promemoria prima di aprire i singoli moduli.",
        "overview": [
            "Scegli il periodo dal selettore Anno e leggi le schede riepilogative prima di entrare nei moduli operativi.",
            "Le schede Ordini, Da saldare, In produzione e Provvigioni maturate sono riepiloghi navigabili: i dettagli vengono spiegati nei capitoli collegati.",
            "La bacheca riunisce segnalazioni e promemoria del team. Completa, posticipa o modifica una voce usando le azioni sulla riga.",
        ],
        "links": [("Giornaliero", "section-giornaliero"), ("Produzione", "section-produzione"), ("Spedizioni", "section-spedizioni"), ("Contabilità", "section-contabilita")],
        "figures": [
            ("dashboard-1.png", "Panoramica della Dashboard", "Controlla anno, indicatori principali e bacheca prima di iniziare. Le card riassumono il carico operativo e aprono le aree collegate."),
            ("dashboard-3.png", "Bacheca del team", "Nella bacheca trovi le cose da fare e i promemoria condivisi, con le azioni rapide per completarli, posticiparli o modificarli."),
            ("dashboard-2.png", "Nuovo promemoria", "Dalla bacheca puoi creare un promemoria con testo, scadenza, priorità, ricorrenza e collegamento a un elemento del gestionale."),
            ("dashboard-4.png", "Notifica al team", "Scegli cosa notificare e i destinatari, poi invia: il messaggio comparirà nelle notifiche delle postazioni selezionate."),
            ("dashboard-5.png", "Andamento e grafici", "Confronta serie temporali e distribuzioni per riconoscere rapidamente volumi e scostamenti nel periodo."),
            ("dashboard-6.png", "Analisi di dettaglio", "Usa i grafici di dettaglio insieme agli indicatori principali per interpretare il carico di lavoro."),
            ("dashboard-7.png", "Selezione dell'anno", "Scegli l'anno di lavoro oppure Tutti gli anni; elenchi e indicatori si riallineano al nuovo contesto."),
        ],
    },
    {
        "key": "giornaliero", "number": "02", "title": "Giornaliero",
        "lead": "Crea un ordine, correggilo e controllane prodotti, prezzi, pagamenti e stato.",
        "overview": [
            "Cerca o filtra gli ordini, poi apri una riga per consultarne o modificarne i dettagli.",
            "Nel nuovo ordine scegli cliente e medico, aggiungi i prodotti, verifica prezzi e totali, quindi salva. I pagamenti in bozza diventano effettivi con il salvataggio dell'ordine.",
            "Gli avanzamenti di stato collegano il Giornaliero ai capitoli Produzione, Spedizioni e Contabilità.",
        ],
        "figures": [
            ("giornaliero-1.png", "Elenco giornaliero", "Usa ricerca, periodo e filtri per restringere l'elenco. Controlla marcatori e stato prima di aprire un ordine."),
            ("giornaliero-2.png", "Azioni rapide", "Apri il menu della riga per scegliere l'azione compatibile con lo stato corrente dell'ordine."),
            ("giornaliero-3.png", "Nuovo ordine", "Imposta data e segnalazioni, poi seleziona cliente e medico. I pulsanti Nuovo permettono di creare le anagrafiche senza abbandonare l'ordine."),
            ("giornaliero-4.png", "Nuovo cliente durante l'ordine", "Compila e salva la nuova anagrafica senza chiudere l'ordine; al ritorno verifica che il cliente sia selezionato."),
            ("giornaliero-5.png", "Calcolo del codice fiscale", "Completa i dati anagrafici, verifica il codice calcolato e usa il risultato soltanto dopo averne controllato la correttezza."),
            ("giornaliero-6.png", "Totali e pagamenti", "Verifica totale, acconto suggerito, concordato e incassato. Correggi gli importi prima del salvataggio."),
            ("giornaliero-7.png", "Righe prodotto", "Ogni riga mostra prodotto, quantità, prezzo e paziente, con i comandi per aggiungere o rimuovere una voce."),
            ("giornaliero-8.png", "Acconto e scadenzario", "Il riepilogo distingue importo, incassato e residuo e prepara acconto e saldo nello scadenzario."),
            ("giornaliero-9.png", "Scegliere il conto", "Nel pagamento atteso puoi aprire il menu e scegliere uno dei conti configurati nelle Anagrafiche."),
            ("giornaliero-10.png", "Rateizzazione", "Scegli numero, cadenza e prima scadenza; controlla che la somma delle rate coincida con l'importo da rateizzare."),
            ("giornaliero-11.png", "Rate nello scadenzario", "Dopo la rateizzazione, il saldo viene sostituito dalle singole rate con importo e scadenza."),
            ("giornaliero-12.png", "Azioni dell'ordine", "Il menu della riga raccoglie apertura, pagamento, sostituzione e comandi di avanzamento o segnalazione."),
            ("giornaliero-13.png", "Dettaglio pagamento", "Correggi tipo, importo, stato, conto o data; usa Annulla pagamento soltanto per rimuovere il movimento selezionato."),
            ("giornaliero-14.png", "Indicatore di stato", "Lo stato indica quali attività sono già concluse e quale operazione deve ancora essere svolta."),
        ],
    },
    {
        "key": "produzione", "number": "03", "title": "Produzione",
        "lead": "Dalla selezione degli ordini alla compilazione dei lotti, con controlli su date, numerazioni e avanzamenti.",
        "overview": [
            "Filtra la vista e seleziona soltanto le righe pronte. Gli ordini incompleti o senza i requisiti necessari devono essere corretti nel Giornaliero.",
            "Compila i dati di produzione, controlla numerazione e date, quindi conferma l'avanzamento. Le righe completate proseguono verso la spedizione.",
            "In In lavorazione puoi unire lotti già creati per ottenere un solo gruppo e un solo export. Separa lotto ripristina i gruppi originali senza duplicare i prodotti.",
        ],
        "figures": [
            ("produzione-1.png", "Da produrre e In lavorazione", "Da produrre serve a creare i lotti; In lavorazione permette anche di unire più lotti per un export unico o di separarli di nuovo."),
            ("produzione-2.png", "Nuovo ordine Diagnostica", "Dalla Produzione puoi aprire direttamente un nuovo ordine Diagnostica e compilarne le righe specifiche."),
            ("produzione-3.png", "Selezionare le righe", "Spunta gli ordini da includere e controlla il contenuto prima di premere Manda in produzione."),
            ("produzione-4.png", "Dettagli del lotto", "Rileggi prodotti, pazienti, numerazioni e informazioni produttive prima della conferma."),
            ("produzione-5.png", "Conferma del lotto", "Rileggi riepilogo e numero proposto prima di mandare le righe in produzione."),
            ("produzione-6.png", "Lotto creato ed esportazione", "Dopo la conferma usa il menu Esporta per produrre il file richiesto dal laboratorio."),
            ("produzione-7.png", "Esito e file di produzione", "Controlla il feedback e gli eventuali file generati prima di considerare conclusa l'operazione."),
            ("produzione-8.png", "Filtri della Produzione", "Il pop-over dei filtri permette di restringere l'elenco per agente, stato dell'acconto e periodo, senza modificare le righe."),
        ],
    },
    {
        "key": "spedizioni", "number": "04", "title": "Spedizioni",
        "lead": "Preparazione dei destinatari, creazione dei colli, contrassegni, storico e annullamenti.",
        "overview": [
            "Parti dalla vista Da spedire, seleziona le righe e controlla il destinatario effettivo.",
            "Crea uno o più colli, completa i dati del corriere e verifica eventuali importi in contrassegno. Dopo la conferma, consulta lo storico per controllare l'esito.",
            "In Effettuate puoi unire gruppi già creati per leggerli insieme. Il riepilogo economico resta distinto per conto e agente, mentre le distinte restano separate per corriere.",
        ],
        "figures": [
            ("spedizioni-1.png", "Elementi da spedire", "Filtra e seleziona le righe pronte. Il destinatario e i prodotti devono essere completi prima di creare la spedizione."),
            ("spedizioni-2.png", "Raggruppamento per destinatario", "Controlla i gruppi proposti: righe dello stesso destinatario possono essere unite quando il caso operativo lo consente."),
            ("spedizioni-3.png", "Creazione della spedizione", "Verifica destinatario, indirizzo e righe incluse, poi avvia la creazione del collo."),
            ("spedizioni-4.png", "Pagamento alla consegna", "Per ogni destinatario puoi scegliere il pagamento alla consegna, indicare l'importo e selezionare i prodotti da includere."),
            ("spedizioni-5.png", "Spedizione completata", "Dopo la creazione compare la conferma Spedito: da qui puoi proseguire direttamente con la distinta del corriere."),
            ("spedizioni-6.png", "Esporta o stampa", "L'anteprima raccoglie i dati delle spedizioni e permette di scegliere tra stampa e salvataggio in Excel."),
            ("spedizioni-7.png", "Come si calcola il riepilogo della spedizione", "Il riepilogo considera la parte di ordine realmente spedita, esclude gli acconti e divide le somme tra già incassato e da incassare, per conto e per agente."),
            ("spedizioni-8.png", "Rimuovere un prodotto dal collo", "Nel dettaglio del collo puoi rimuovere una singola riga senza annullare l'intera spedizione."),
            ("spedizioni-9.png", "Modificare la spedizione", "Dal riepilogo puoi correggere destinatario, indirizzo, colli, peso, preavviso e numeri dei prodotti."),
            ("spedizioni-10.png", "Aggiungere un altro collo", "Puoi scegliere altre righe ancora da spedire oppure inserire una riga manuale e aggiungerle alla spedizione esistente."),
            ("spedizioni-11.png", "Unire o separare gruppi effettuati", "Seleziona almeno due gruppi per riunirli. L'unione è organizzativa e può essere annullata con Separa senza modificare ordini, colli o pagamenti."),
            ("spedizioni-12.png", "Spedizioni effettuate", "Consulta storico, filtri e dettagli. In caso di errore usa l'annullamento previsto, valutandone gli effetti sull'ordine."),
        ],
    },
    {
        "key": "contabilita", "number": "05", "title": "Contabilità",
        "lead": "Controlla somme da ricevere e incassi già registrati; gestisci anche distinte, provvigioni e rimborsi.",
        "overview": [
            "Distingui sempre un movimento atteso da un incasso effettivo. Scegli il conto corretto e verifica copertura e scadenza.",
            "Il gestionale segnala i pagamenti scaduti e permette di sollecitarli via e-mail, WhatsApp o entrambi. Le rate dello stesso ordine vengono riepilogate insieme; i filtri correnti possono preparare una campagna per più clienti.",
            "Prima di avviare una campagna controlla destinatari esclusi, importi e testi. Dal Centro comunicazioni puoi seguire lo stato, mettere in pausa, riprendere o interrompere gli invii ancora pendenti su questo PC; campagna e cronologia non vengono sincronizzate con le altre postazioni.",
            "Distinte, provvigioni e rimborsi producono conseguenze sugli ordini collegati; leggi sempre il riepilogo prima di confermare.",
        ],
        "figures": [
            ("crediti-1.png", "Crediti e pagamenti", "Usa stato, periodo e ricerca per individuare crediti attesi, scaduti o già incassati."),
            ("crediti-2.png", "Nuovo movimento", "Scegli il tipo corretto: atteso per una scadenza futura, incassato per denaro realmente ricevuto."),
            ("crediti-3.png", "Incasso superiore al residuo", "Quando l'incasso supera il residuo, PharmaTek propone tre modi diversi per gestire la differenza prima di proseguire."),
            ("crediti-4.png", "Filtri dei crediti", "Il pannello permette di filtrare per medico, conto, stato, linea, spedizione e intervallo di date."),
            ("crediti-5.png", "Esporta o stampa i crediti", "Scegli le colonne, l'orientamento e controlla l'anteprima prima di stampare o salvare il file Excel."),
            ("distinte-1.png", "Distinte corriere", "Seleziona i pagamenti disponibili e confronta importi attesi e accreditati."),
            ("distinte-2.png", "Creazione della distinta", "Scegli conto e movimenti, verifica le differenze e conferma solo quando il totale e riconciliato."),
            ("provvigioni-1.png", "Come vengono calcolate le provvigioni", "Le provvigioni percentuali usano l'imponibile quando lo scorporo IVA è attivo; quelle fisse restano l'importo in euro configurato per l'agente."),
            ("provvigioni-2.png", "Pagamento selettivo", "Seleziona soltanto le voci da liquidare e controlla il totale prima della conferma."),
            ("provvigioni-3.png", "Storico provvigioni", "Lo storico permette di verificare pagamenti già eseguiti e di ricostruirne il dettaglio."),
            ("rimborsi-1.png", "Elenco rimborsi", "Usa filtri e stati per separare richieste aperte, effettuate e collegate a uno specifico ordine."),
            ("rimborsi-2.png", "Nuovo rimborso", "Indica soggetto, importo, motivazione e collegamento all'ordine quando disponibile."),
            ("rimborsi-3.png", "Stato del rimborso", "Segna come effettuato soltanto dopo l'operazione reale: lo stato influenza la lettura contabile dell'ordine."),
            ("rimborsi-4.png", "Conferma ed eliminazione", "Prima di eliminare o annullare valuta tracciabilità e possibilità di recupero dal Cestino."),
        ],
    },
    {
        "key": "anagrafiche", "number": "06", "title": "Anagrafiche",
        "lead": "Mantieni corretti clienti, medici, agenti, prodotti, conti e corrieri usati nel resto del gestionale.",
        "overview": [
            "Apri il registro desiderato, cerca il record e modifica soltanto i campi necessari. Salva prima di usare il dato in un ordine.",
            "Gli strumenti locali aiutano con codice fiscale e indirizzi. Importazione, deduplicazione ed export Aruba vanno eseguiti dopo aver controllato il riepilogo proposto.",
        ],
        "figures": [
            ("anagrafiche-1.png", "Hub Anagrafiche", "Scegli il registro da consultare. Ogni categoria alimenta campi e automatismi diversi del gestionale."),
            ("anagrafiche-2.png", "Preferenze dell'agente", "Imposta regole provvigionali, maggiorazioni e costi associati; le modifiche influenzano i calcoli futuri."),
            ("anagrafiche-2.5.png", "Regole provvigionali", "Attiva solo le componenti concordate e verifica percentuali e spese prima di applicarle."),
            ("anagrafiche-3.png", "Scheda del medico", "Compila dati, agente di riferimento, listino e recapiti; queste informazioni vengono proposte negli ordini."),
            ("anagrafiche-4.png", "Scheda del cliente", "Inserisci recapiti, indirizzo, dati fiscali e note di spedizione, quindi salva prima di usarlo in un ordine."),
            ("anagrafiche-5.png", "Catalogo prodotti", "La scheda Prodotti mostra il listino e include lo strumento Prova prezzo per verificare quale regola verrebbe applicata."),
            ("anagrafiche-6.png", "Provare il prezzo di un prodotto", "Scegli prodotto e medico, poi premi Calcola per vedere il prezzo proposto e la regola che lo ha determinato."),
            ("anagrafiche-7.png", "Scheda prodotto", "Definisci categoria, prezzo base, acconto e righe del kit; il catalogo alimenta il nuovo ordine."),
            ("anagrafiche-8.png", "Scheda conto", "Registra nome, banca e IBAN del conto usato per incassi, acconti e rimborsi."),
            ("anagrafiche-9.png", "Preferenze dei conti", "Assegna i conti predefiniti per incassi, acconti corriere e rimborsi per ridurre gli errori di registrazione."),
            ("anagrafiche-10.png", "Profilo corriere", "Configura il corriere e i profili di spedizione associati prima di creare nuovi colli."),
        ],
    },
    {
        "key": "impostazioni", "number": "07", "title": "Impostazioni",
        "lead": "Preferenze, notifiche, ricerca Spotlight, backup e strumenti di sistema per adattare PharmaTek al lavoro del team.",
        "overview": [
            "Modifica una preferenza per volta e verifica il risultato nella schermata interessata.",
            "In E-mail e comunicazioni configuri la casella mittente, WhatsApp assistito e i modelli condivisi. Ogni modello usa lo stesso messaggio per entrambi i canali (l'oggetto vale solo per l'e-mail); puoi aggiungere e rimuovere modelli personalizzati usando i dati dinamici proposti. L'icona Cronologia apre bozze, invii ed errori conservati soltanto su questo PC; da Spotlight la stessa cronologia locale usa una finestra separata.",
            "Backup, ripristino e gestione postazioni hanno effetti condivisi: avvia queste operazioni soltanto quando nessun collega sta completando attività critiche.",
            "Spotlight ricerca record e avvia comandi usando il contesto dell'anno corrente; aprilo dalla barra superiore o dalla scorciatoia configurata.",
        ],
        "figures": [
            ("impostazioni-1.png", "Panoramica Impostazioni", "Configura periodo iniziale, notifiche, avvio e preferenze dei moduli dalle rispettive sezioni."),
            ("impostazioni-2.png", "Importazione clienti storici", "Aggiungi file o cartella, controlla i formati supportati e avvia la scansione soltanto dopo aver selezionato la sorgente corretta."),
            ("impostazioni-3.png", "Esito dell'importazione", "Leggi quanti clienti sono stati creati, aggiornati, saltati o segnalati come duplicati."),
            ("impostazioni-4.png", "Esportare i clienti in Aruba", "Scegli il periodo e avvia l'esportazione: il gestionale prepara automaticamente clienti e dati necessari. Salva l'Excel e caricalo da Aruba, nella sezione Clienti, usando Importa."),
            ("impostazioni-5.png", "Tutte le impostazioni", "La vista completa riunisce Dashboard, notifiche, anagrafiche esterne, produzione, sistema, backup, aspetto e pulizia dati."),
            ("impostazioni-6-backup.png", "Backup e copie disponibili", "Crea una copia di sicurezza e controlla data e dimensione dei backup già disponibili."),
            ("impostazioni-7-ripristino.png", "Ripristinare un backup", "Scegli con attenzione la copia: il ripristino sostituisce i dati condivisi di tutte le postazioni."),
            ("spotlight-1.png", "Apertura di Spotlight", "Digita più termini per restringere i risultati; il contesto dell'anno influenza i record operativi proposti."),
            ("spotlight-2.png", "Risultati e comandi", "Seleziona un risultato per aprire il record oppure scegli un comando per avviare direttamente un'azione."),
            ("spotlight-3.png", "Azioni intelligenti", "Usa i suggerimenti per raggiungere rapidamente pagamenti, spedizioni, messaggi e altre funzioni contestuali."),
            ("pannelli-1.png", "Pannello notifiche", "Leggi gli avvisi in ordine di urgenza e apri il collegamento per raggiungere il record interessato."),
            ("pannelli-2.png", "Cestino", "Ripristina un elemento eliminato quando necessario; l'eliminazione definitiva non offre lo stesso recupero."),
            ("pannelli-3.png", "Nuovo messaggio", "Scegli destinatario, scrivi il testo e invia; il pannello conferma quando non restano notifiche da leggere."),
            ("pannelli-4.png", "Modifica profilo", "Aggiorna nome, tema e avatar della postazione, quindi salva le preferenze personali."),
            ("pannelli-5.png", "Stato sincronizzazione", "Controlla postazioni e stato Online; usa la sincronizzazione forzata soltanto quando necessario."),
            ("info-1.png", "Informazioni sull'app", "Consulta versione e informazioni generali quando richiedi assistenza."),
            ("info-2.png", "Novità e changelog", "Leggi le modifiche introdotte dall'aggiornamento prima di usare un flusso cambiato."),
            ("info-3.png", "Flappy Livio", "La finestra Info include anche il piccolo gioco accessibile dalla relativa scheda."),
        ],
    },
]

CONCLUSIONS = {
    "title": "Il lavoro, dall'ordine all'incasso",
    "lead": "Cosa controllare dall'inserimento dell'ordine fino alla registrazione del pagamento",
    "intro": "Per completare correttamente un ordine, controlla questi quattro momenti prima di passare al successivo.",
    "workflow": [
        {"title": "1. Inserisci l'ordine", "text": "Nel Giornaliero scegli cliente e medico, aggiungi i prodotti e controlla i prezzi proposti.", "check": "Prima di salvare: prodotti, quantità, paziente, totale e acconto."},
        {"title": "2. Prepara la produzione", "text": "In Produzione seleziona soltanto le righe complete, inserisci i dati mancanti e crea il lotto.", "check": "Prima di confermare: formulazione, posologia, numerazione e prodotti inclusi."},
        {"title": "3. Crea la spedizione", "text": "Nella scheda Da spedire scegli le righe, controlla il destinatario e prepara uno o più colli.", "check": "Prima di creare il collo: indirizzo, prodotti, corriere e contrassegno."},
        {"title": "4. Registra il pagamento", "text": "In Contabilità registra come incassate soltanto le somme realmente ricevute e indica il conto corretto.", "check": "Dopo il salvataggio: incassato, residuo, scadenze ed eventuali rate."},
    ],
    "daily_checks": [
        {"title": "All'inizio", "items": ["Scegli l'anno corretto.", "Leggi promemoria e notifiche.", "Controlla pagamenti scaduti e ordini urgenti."]},
        {"title": "Prima di salvare", "items": ["Rileggi il nome del cliente e del medico.", "Controlla prodotti, quantità e prezzi.", "Verifica totale, acconto, incassato e residuo."]},
        {"title": "Prima di terminare", "items": ["Controlla che le operazioni confermate abbiano cambiato stato.", "Verifica che non siano rimaste righe selezionate per errore.", "Lascia una nota solo se serve davvero a un collega."]},
    ],
    "rules": [
        {"title": "Pagamenti", "text": "Usa Incassato solo per denaro già ricevuto. Per una somma prevista usa Atteso e indica la scadenza."},
        {"title": "Stati", "text": "Avanza un ordine solo dopo aver completato l'operazione reale. Lo stato determina dove comparirà nei moduli successivi."},
    ],
    "problems": [
        {"title": "Non trovi un ordine", "action": "Controlla anno, testo cercato e filtri attivi. Se ancora non compare, verifica lo stato della sincronizzazione."},
        {"title": "Il totale è sbagliato", "action": "Riapri l'ordine e controlla prodotti, quantità e prezzi. Il saldo si aggiorna automaticamente in base agli importi salvati."},
        {"title": "Un ordine non passa in Produzione", "action": "Apri la riga e completa i dati richiesti. Se manca un dato dell'ordine, correggilo nel Giornaliero e riprova."},
        {"title": "La spedizione contiene una riga errata", "action": "Rimuovi la singola riga dal collo oppure annulla la spedizione se l'errore riguarda l'intera operazione."},
        {"title": "Il residuo non coincide", "action": "Controlla totale dell'ordine, acconto, rate e movimenti già registrati. Correggi il dato che non corrisponde al pagamento reale."},
        {"title": "Un collega non vede la modifica", "action": "Controlla lo stato Online e attendi la sincronizzazione. Usa la sincronizzazione forzata solo se l'aggiornamento non arriva."},
    ],
    "where_to_go": [
        ("Creare o correggere un ordine", "Giornaliero", "section-giornaliero"),
        ("Controllare prezzi e saldo", "Giornaliero", "section-giornaliero"),
        ("Creare un lotto o il file Laboratorio", "Produzione", "section-produzione"),
        ("Preparare o correggere un collo", "Spedizioni", "section-spedizioni"),
        ("Registrare un incasso o una rata", "Contabilità", "section-contabilita"),
        ("Modificare clienti, prodotti o conti", "Anagrafiche", "section-anagrafiche"),
        ("Esportare i clienti per Aruba", "Impostazioni", "section-impostazioni"),
        ("Creare o ripristinare un backup", "Impostazioni", "section-impostazioni"),
    ],
    "support": "Quando chiedi assistenza, indica il numero dell'ordine o il cliente, l'operazione che stavi eseguendo e il messaggio comparso. Se possibile, allega una schermata senza chiudere l'avviso.",
}

FUTURE_FEATURES = {
    "title": "Un gestionale ancora più vicino al cliente",
    "lead": "Oggi alcuni file e messaggi devono ancora essere preparati e inviati manualmente. Le funzioni proposte ridurrebbero questi passaggi e renderebbero più semplice la gestione dei documenti.",
    "groups": [
        {
            "number": "01",
            "title": "Comunicazioni",
            "summary": "Invio di messaggi usando automaticamente i recapiti e i dati già salvati nel gestionale.",
            "items": ["WhatsApp automatico", "E-mail con account, configurazione e client", "Comunicazioni collegate al cliente"],
        },
        {
            "number": "02",
            "title": "Preventivi",
            "summary": "Creazione, invio e controllo dei preventivi usando prodotti e prezzi già presenti.",
            "items": ["Nuova schermata Preventivi", "Grafica da inviare al cliente", "Scheda anagrafica cliente e preventivo pronti per la stampa", "Sollecito automatico dei preventivi e dei saldi meno recenti"],
        },
        {
            "number": "03",
            "title": "File e spedizioni",
            "summary": "Invio automatico dei file a laboratorio e corrieri, con possibilità di rigenerare e reinviare il file corretto.",
            "items": ["Invio automatico dei file di esportazione a Laboratorio", "Invio automatico dei file di spedizione a Corriere A e agli altri corrieri", "Rigenerazione e reinvio del file corretto senza duplicati", "Avviso al cliente tramite WhatsApp o e-mail"],
        },
        {
            "number": "04",
            "title": "Dati e documenti",
            "summary": "Gestione più facile, unificata e veloce dell'archiviazione di dati e documenti.",
            "items": ["Archivio unico per dati e documenti", "Collegamento rapido alla scheda corretta", "Consultazione più veloce della documentazione"],
        },
    ],
    "already_available": "Il controllo dei pagamenti e i relativi solleciti sono già presenti nel Gestionale PharmaTek: non fanno parte di queste evoluzioni future.",
}

ADMIN_APPENDIX = {
    "number": "09",
    "key": "amministrazione",
    "title": "Appendice amministratori",
    "lead": "Riconfigurazione, ritiro delle postazioni, ottimizzazione del database e reset completo: quattro interventi diversi, da scegliere conoscendone gli effetti.",
    "access": {
        "title": "Come aprire il Centro di ripristino",
        "intro": "Apri Impostazioni e resta nella pagina principale. Il Centro di ripristino è protetto da una sequenza rapida, così non può essere aperto per errore.",
        "keyboard": "Premi cinque volte il tasto Canc della tastiera. Su alcune tastiere è indicato come Delete.",
        "mouse": "Nel riquadro Pulizia dati, premi una volta l'icona del cestino sulla destra.",
        "timing": "Le cinque pressioni devono avvenire entro circa 1,5 secondi. Non vengono mostrati avvisi intermedi: alla quinta pressione si apre direttamente il Centro di ripristino.",
        "exit": "Se lo hai aperto per errore, premi Esc dalla scelta iniziale per chiuderlo senza modificare nulla.",
        "safe": "L'apertura del Centro di ripristino non modifica i dati. Ogni intervento richiede una scelta e una conferma successiva.",
    },
    "figures": [
        ("amministrazione-1-centro-ripristino.png", "Scegliere l'intervento corretto", "Il Centro di ripristino separa chiaramente l'intervento locale, il ritiro di un PC e l'azzeramento generale."),
        ("amministrazione-2-riconfigura.png", "Riconfigurare soltanto questo PC", "La postazione corrente torna alla configurazione iniziale, mentre ordini e dati condivisi restano intatti."),
        ("amministrazione-3-ritira-pc.png", "Ritirare una postazione", "Seleziona il PC corretto: prima della revoca viene creato automaticamente un backup."),
        ("amministrazione-4-reset-completo.png", "Reset completo: primo avviso", "Questo percorso riguarda tutti i PC e tutti i dati, non la semplice correzione di una postazione."),
        ("amministrazione-5-ultima-conferma.png", "Reset completo: ultima conferma", "Il pulsante finale avvia un'operazione irreversibile; prima di usarlo servono autorizzazione e backup verificato."),
    ],
}


