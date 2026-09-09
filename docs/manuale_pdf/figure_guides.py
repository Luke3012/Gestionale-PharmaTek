"""Testi di accompagnamento delle singole schermate.

Ogni voce spiega come arrivare alla schermata, cosa contiene e come leggerla.
Il tono e volutamente discorsivo: il lettore non deve conoscere già PharmaTek.
"""

GUIDES = {
    "dashboard-1.png": {
        "access": "All'avvio si apre normalmente la Dashboard. Se ti trovi altrove, premi il primo pulsante in alto nella barra laterale sinistra, quello con i quattro riquadri.",
        "fields": ["Ordini: numero e valore degli ordini nel periodo", "Da saldare: importi ancora aperti, separati tra spediti e non spediti", "In produzione: lavorazioni attive e prodotti in arrivo", "Provvigioni maturate: importo maturato e potenziale", "Bacheca del team: segnalazioni e promemoria condivisi"],
        "use": "Controlla rapidamente ordini, produzione, spedizioni e situazione economica del periodo. Se un valore richiede attenzione, premi la relativa scheda per aprire direttamente l'elenco interessato.",
    },
    "dashboard-2.png": {
        "access": "Dalla Dashboard scendi alla Bacheca del team e premi il pulsante giallo Nuovo promemoria.",
        "fields": ["Promemoria: il testo che dovrà comparire in bacheca", "Scadenza: il giorno in cui ricordare l'attività", "Priorità: bassa, media o alta", "Ricorrenza: nessuna oppure ripetizione periodica", "Avviso anticipato: quanti giorni prima avvisare", "Collega a: eventuale ordine o elemento del gestionale", "Utenti: persone o postazioni a cui assegnarlo"],
        "use": "Dopo aver compilato i dati, premi Crea promemoria. Se scegli più utenti, ciascuno lo vedrà nella propria bacheca e nelle notifiche previste.",
    },
    "dashboard-3.png": {
        "access": "La Bacheca del team si trova al centro della Dashboard, subito sotto le quattro schede riepilogative.",
        "fields": ["Da fare: segnalazioni operative ancora aperte", "Promemoria: attività con scadenza", "Etichette di data, priorità e ricorrenza", "Spunta: completa la voce", "Calendario: posticipa", "Matita: modifica"],
        "use": "Leggi prima le voci Da fare e poi i promemoria. Le piccole icone a destra permettono di intervenire senza aprire un'altra pagina.",
    },
    "dashboard-4.png": {
        "access": "Dalla Bacheca del team premi Notifica, accanto al pulsante Nuovo promemoria.",
        "fields": ["Cosa vuoi notificare: pagamenti scaduti, elementi da fare o altri avvisi disponibili", "Destinatari: tutti oppure utenti scelti", "Utenti: elenco delle persone selezionate", "Invia: spedisce la notifica"],
        "use": "Seleziona prima il tipo di avviso e poi i destinatari. Il messaggio viene creato solo quando premi Invia; Annulla chiude la finestra senza spedire nulla.",
    },
    "dashboard-5.png": {
        "access": "Scorri la Dashboard sotto i riepiloghi principali fino ai grafici di andamento.",
        "fields": ["Asse temporale: giorni o mesi del periodo", "Linee colorate: serie confrontate", "Totali per categoria: distribuzione dei volumi", "Legenda: associa ogni colore al relativo dato"],
        "use": "Confronta i periodi per riconoscere aumenti, rallentamenti o variazioni insolite nel lavoro. Se un valore non torna, apri il modulo di origine per controllare i record che lo compongono.",
    },
    "dashboard-6.png": {
        "access": "Resta nella sezione dei grafici della Dashboard e continua a scorrere per vedere le analisi di dettaglio.",
        "fields": ["Classifiche", "Agenti", "Regioni", "Valore ordini", "Numero ordini", "Barre per ogni agente o area", "Valore preciso al passaggio del mouse"],
        "use": "Scegli Agenti o Regioni e confronta le barre. Passando il mouse su una barra puoi leggere il valore esatto senza aprire un altro elenco.",
    },
    "dashboard-7.png": {
        "access": "Per aprire il selettore dell'anno premi il pulsante con l'icona del calendario in basso a sinistra, nella barra laterale nera del programma.",
        "fields": ["Tutti gli anni: mostra insieme i record di ogni anno", "Anno corrente: apre il lavoro dell'anno indicato", "Indicazione Corrente: segnala l'anno usato normalmente"],
        "use": "Premi l'anno desiderato: il pannello si chiude e Dashboard, elenchi e ricerche si aggiornano. Prima di inserire un nuovo ordine controlla sempre di essere nell'anno corretto.",
    },

    "giornaliero-1.png": {
        "access": "Premi l'icona del Giornaliero nella barra laterale sinistra, subito sotto la Dashboard.",
        "fields": ["Cerca: trova numero ordine, cliente, medico o altri dati", "Filtri: restringono periodo, stato e segnalazioni", "Nuovo ordine: apre la finestra di inserimento", "Colonne: numero, data, cliente, medico, prodotti, importi e stato", "Azioni di riga: aprono o modificano l'ordine"],
        "use": "Usa la ricerca per arrivare rapidamente a un ordine. Premi una riga per aprirne il dettaglio oppure Nuovo ordine per iniziarne uno da zero.",
    },
    "giornaliero-2.png": {
        "access": "Nella pagina Giornaliero premi la parte destra del pulsante Nuovo ordine, quella con la freccia.",
        "fields": ["Nuovo ordine: apre il flusso standard", "Diagnostica: prepara un ordine della linea diagnostica", "Keriba: prepara il relativo tipo di ordine"],
        "use": "Scegli la voce che corrisponde al lavoro da inserire. La scelta iniziale prepara campi e linea dell'ordine, ma i dati andranno comunque controllati nella finestra successiva.",
    },
    "giornaliero-3.png": {
        "access": "Dal Giornaliero premi Nuovo ordine oppure scegli una delle varianti dal menu della freccia.",
        "fields": ["Data: giorno dell'ordine", "Segnalazione: Urgente, Anomalia o Da sollecitare", "Stato: percorso grafico dell'ordine", "Cliente e Medico: anagrafiche obbligatorie", "Agente: proposto dal medico", "Omaggio o sostituzione: esclude l'ordine dalle provvigioni", "Prodotto, quantità, prezzo e paziente", "Annulla e Salva"],
        "use": "Compila dall'alto verso il basso. Scegli cliente e medico prima dei prodotti: il gestionale usa il proprio prezzario e le regole configurate per proporre agente e prezzo corretti.",
        "first_time": "I campi con l'asterisco sono obbligatori. Se cliente o medico non esistono ancora, usa Nuovo: l'ordine resta aperto mentre crei l'anagrafica.",
    },
    "giornaliero-4.png": {
        "access": "Nel Nuovo ordine premi Nuovo accanto al campo Cliente.",
        "fields": ["Nome o ragione sociale", "Indirizzo, città, provincia, CAP e regione", "Telefono ed e-mail", "Codice fiscale o partita IVA", "Crea e seleziona: salva il cliente e lo riporta nell'ordine"],
        "use": "Compila almeno i dati necessari per riconoscere e contattare il cliente. Con Crea e seleziona non perdi ciò che avevi già scritto nell'ordine.",
    },
    "giornaliero-5.png": {
        "access": "Nel modulo anagrafico premi l'icona accanto al campo Codice fiscale per aprire il calcolo assistito.",
        "fields": ["Cognome e nome", "Data di nascita", "Sesso", "Comune di nascita con ricerca locale", "Codice calcolato", "Usa: inserisce il risultato nel modulo"],
        "use": "Controlla con attenzione luogo e data di nascita. Il codice si aggiorna mentre compili; premi Usa solo dopo aver verificato il risultato.",
    },
    "giornaliero-6.png": {
        "access": "Nel Nuovo ordine scorri sotto cliente e medico fino alle righe dei prodotti e al riepilogo economico.",
        "fields": ["Prodotto: scegli dal catalogo o scrivi una voce libera", "Quantità", "Prezzo", "Paziente", "Totale ordine", "Acconto suggerito, concordato e incassato", "Aggiungi prodotto"],
        "use": "Inserisci una riga per ogni prodotto e controlla quantità e prezzo proposto. Il gestionale ricalcola automaticamente totale, acconto e saldo; prima di salvare verifica che riflettano ciò che è stato realmente concordato.",
    },
    "giornaliero-7.png": {
        "access": "Nel Nuovo ordine scorri fino alla tabella Prodotti.",
        "fields": ["Prodotto", "Quantità", "Prezzo", "Paziente", "Icona per i dati di produzione", "Cestino per rimuovere la riga", "Aggiungi prodotto"],
        "use": "Compila una riga per ogni prodotto. Aggiungi prodotto crea una nuova riga; il cestino elimina soltanto quella selezionata.",
    },
    "giornaliero-8.png": {
        "access": "Nel Nuovo ordine scorri sotto le righe prodotto fino ad Acconto previsto e Scadenzario.",
        "fields": ["Acconto concordato", "Già incassato", "Importo totale", "Incassato", "Residuo", "Riga Acconto", "Riga Saldo", "Stato Atteso", "Scadenza", "Conto", "Rateizza saldo"],
        "use": "Controlla acconto e saldo prima di salvare. Le righe dello scadenzario indicano cosa dovrà essere incassato e su quale conto.",
        "first_time": "Atteso significa che il denaro deve ancora arrivare; Incassato significa che lo hai già ricevuto. Non usare Incassato come semplice conferma dell'ordine.",
    },
    "giornaliero-9.png": {
        "access": "Nel Nuovo ordine scorri fino alla sezione dello scadenzario e premi il campo del conto, sulla destra della riga del pagamento.",
        "fields": ["Stato Atteso", "Data collegata alla spedizione", "Indicazione Da spedire", "Menu dei conti disponibili", "Note", "Dati di fatturazione diversi"],
        "use": "Scegli il conto sul quale prevedi di ricevere il pagamento. Il menu mostra i conti configurati nelle Anagrafiche e chiude la scelta appena ne premi uno.",
    },
    "giornaliero-10.png": {
        "access": "Nel riepilogo pagamenti dell'ordine premi Rateizza il saldo.",
        "fields": ["Importo da rateizzare", "Numero rate", "Cadenza", "Prima scadenza", "Importo e data di ciascuna rata", "Somma rate", "Rateizza"],
        "use": "Scegli numero e cadenza, poi controlla le rate proposte. L'ultima può assorbire pochi centesimi di arrotondamento; la somma deve coincidere con il saldo.",
    },
    "giornaliero-11.png": {
        "access": "Dopo aver confermato Rateizza, torna allo Scadenzario del Nuovo ordine.",
        "fields": ["Acconto", "Rata", "Saldo residuo eventuale", "Stato Atteso", "Scadenza relativa alla spedizione", "Conto", "Importo di ogni riga", "Rateizza saldo"],
        "use": "Le rate sostituiscono il saldo unico. Controlla importi, scadenze e conto; puoi riaprire Rateizza saldo se devi ricomporre il piano.",
    },
    "giornaliero-12.png": {
        "access": "Nella tabella del Giornaliero premi il menu con i tre puntini alla fine della riga.",
        "fields": ["Apri o modifica", "Registra pagamento", "Sostituzione prodotto", "Segna come urgente", "Segna come anomalia", "Segna come da sollecitare", "Avanzamenti disponibili", "Rifiuta o elimina"],
        "use": "Il menu cambia in base allo stato dell'ordine. Scegli l'azione che descrive ciò che è realmente avvenuto; i comandi di stato spostano l'ordine nel passaggio successivo.",
    },
    "giornaliero-13.png": {
        "access": "Apri l'ordine, entra nella sezione pagamenti e premi il movimento che vuoi correggere.",
        "fields": ["Tipo", "Importo", "Atteso o Incassato", "Conto", "Data", "Note", "Annulla pagamento", "Salva"],
        "use": "Modifica soltanto il movimento interessato. Annulla pagamento rimuove quel movimento; Salva conserva le correzioni.",
    },
    "giornaliero-14.png": {
        "access": "L'indicatore compare nella parte alta dell'editor dell'ordine.",
        "fields": ["Cerchi che rappresentano le fasi", "Linea che collega le fasi", "Fase evidenziata come corrente"],
        "use": "Controlla quali fasi sono già concluse e quale deve ancora iniziare. Per cambiare stato usa l'azione prevista nel menu dell'ordine: l'indicatore non è un pulsante.",
    },

    "produzione-1.png": {"access": "Premi l'icona della Produzione, con il simbolo del laboratorio, nella barra laterale sinistra.", "fields": ["Da produrre", "In lavorazione", "Ricerca e filtri", "Righe degli ordini", "Stato e dati del prodotto", "Nuovo ordine Diagnostica", "Manda in produzione"], "use": "Da produrre raccoglie ciò che deve ancora entrare in un lotto; In lavorazione mostra i lotti già creati. Prima di selezionare una riga controlla prodotto, paziente e acconto.", "first_time": "Se non trovi un ordine, controlla prima la scheda scelta e poi azzera i filtri. Un ordine non ancora confermato potrebbe non essere pronto per la Produzione."},
    "produzione-2.png": {"access": "Nella pagina Produzione premi Nuovo ordine Diagnostica, in alto a destra.", "fields": ["Data", "Segnalazioni", "Stato", "Medico o azienda", "Agente", "Righe diagnostiche", "Allergene", "Quantità", "Valore", "Tipo test", "Materiale e codice", "Acconto", "Salva"], "use": "Puoi inserire un ordine diagnostico senza tornare nel Giornaliero. Compila soggetto, righe diagnostiche, materiali e acconto, quindi premi Salva per aggiungerlo all'elenco produttivo."},
    "produzione-3.png": {"access": "Nella scheda Da produrre spunta la riga desiderata e premi Manda in produzione.", "fields": ["Seleziona tutti", "Casella della singola riga", "Ordine e cliente", "Medico o azienda", "Agente", "Data ordine", "Prodotti", "Acconto", "Manda in produzione"], "use": "La selezione prepara il lotto. Puoi espandere la riga prima di proseguire, così controlli i prodotti e compili i dati mancanti."},
    "produzione-4.png": {"access": "Premi la freccia della riga selezionata per espanderla prima di mandarla in produzione.", "fields": ["Dati dell'ordine", "Prodotti inclusi", "Formulazione", "Posologia", "Allergeni", "Codici o materiali", "Suggerimenti e campi mancanti"], "use": "Completa formulazione, posologia e informazioni richieste per ogni prodotto. Poi torna al pulsante Manda in produzione per continuare."},
    "produzione-5.png": {"access": "Dopo aver selezionato le righe premi Manda in produzione.", "fields": ["Avviso Tutto pronto", "Ordini con dati Diagnostica mancanti", "ML o quantità non compilati", "Annulla", "Manda in produzione"], "use": "L'avviso segnala dati utili ma non obbligatori. Premi Annulla per completarli oppure Manda in produzione se hai verificato che il lotto può proseguire così."},
    "produzione-6.png": {"access": "La conferma appare al termine della creazione del lotto.", "fields": ["Messaggio Lotto creato", "Esporta", "Immunoterapia o Diagnostica", "Eventuali formati disponibili"], "use": "Apri Esporta per generare il file richiesto dal laboratorio. Il messaggio conferma che il lotto è già stato registrato."},
    "produzione-7.png": {"access": "Dopo la creazione del lotto apri il riepilogo o il file prodotto.", "fields": ["Righe del lotto", "Numeri ordine", "Prodotti e pazienti", "Date e riferimenti", "Comando di esportazione"], "use": "Confronta il file con il riepilogo a video prima dell'invio esterno."},
    "produzione-8.png": {"access": "Nella pagina Produzione premi l'icona dei filtri a destra del campo di ricerca.", "fields": ["Agente", "Acconto: Tutti, Incassato o Atteso", "Periodo relativo alla data di invio", "Tutto", "Questo mese", "Mese scorso", "Intervallo Dal/Al", "Azzera filtri"], "use": "Combina agente, acconto e periodo per restringere l'elenco. Il pop-over filtra soltanto ciò che vedi: non cambia stato o contenuto degli ordini.", "first_time": "Se l'elenco diventa vuoto, premi Azzera filtri. Spesso l'ordine esiste ma è nascosto da un criterio rimasto attivo."},

    "spedizioni-1.png": {"access": "Premi l'icona del camion nella barra laterale sinistra per aprire Spedizioni.", "fields": ["Scheda Da spedire", "Ricerca e filtri", "Righe pronte", "Destinatario", "Prodotti e quantità", "Crea spedizione"], "use": "Seleziona le righe che vuoi preparare. Prima controlla che destinatario e indirizzo siano completi."},
    "spedizioni-2.png": {"access": "Nella vista Da spedire seleziona più righe: PharmaTek propone i gruppi per destinatario.", "fields": ["Destinatario del gruppo", "Ordini compresi", "Prodotti", "Importi", "Comandi per unire o separare"], "use": "Il raggruppamento è una proposta. Correggilo se due consegne devono restare separate o se righe compatibili devono viaggiare insieme."},
    "spedizioni-3.png": {"access": "Seleziona le righe Da spedire e premi Crea spedizione, in alto a destra.", "fields": ["Data spedizione", "Corriere", "Preavviso telefonico per tutti", "Colli da spedire", "Numero di colli per destinatario", "Telefono e preavviso del singolo destinatario", "Pagamento alla consegna", "Prodotti inclusi", "Numero del prodotto", "Crea spedizione"], "use": "Imposta data e corriere, poi controlla ogni destinatario. Decidi numero di colli, preavviso, pagamento e prodotti prima di premere Crea spedizione.", "first_time": "Ogni destinatario può avere un numero di colli e un pagamento diverso. Scorri tutta la finestra prima di confermare, soprattutto quando hai selezionato più ordini."},
    "spedizioni-4.png": {"access": "Durante Crea spedizione, apri il riquadro del destinatario e usa la sezione Pagamento alla consegna.", "fields": ["Tipo di pagamento, per esempio Contrassegno", "Importo da riscuotere", "Residuo dell'ordine", "Prodotti inclusi", "Numero o riferimento del prodotto", "Apri ordine"], "use": "Scegli il pagamento e inserisci l'importo che il corriere dovrà riscuotere. Spunta soltanto i prodotti che entreranno in questa spedizione."},
    "spedizioni-5.png": {"access": "Questo messaggio compare subito dopo aver premuto Crea spedizione e aver completato il salvataggio.", "fields": ["Conferma Spedito", "Domanda sulla distinta", "Crea distinta", "X per chiudere"], "use": "È il passaggio conclusivo della creazione. Se il corriere ha pagamenti da riconciliare, premi Crea distinta; altrimenti chiudi e continua dalla scheda Effettuate."},
    "spedizioni-6.png": {"access": "Nella pagina Spedizioni premi Esporta o Stampa dopo aver scelto le righe da includere.", "fields": ["Anteprima", "Data fattura", "Numero fattura", "Cliente", "Indirizzo", "CAP, città e provincia", "Colli, peso, telefono e note", "Stampa", "Salva Excel"], "use": "Controlla l'anteprima e poi scegli Stampa oppure Salva Excel. Annulla chiude l'anteprima senza creare file."},
    "spedizioni-7.png": {"access": "Apri la scheda Effettuate e premi la freccia della spedizione che vuoi esaminare.", "fields": ["Corriere e numero di colli", "Destinatari", "Numero del collo", "Contrassegni", "Crea distinta", "Aggiungi collo", "Riepilogo incassi per conto e agente"], "use": "Controlla destinatari, colli, prodotti e contrassegni della spedizione. Puoi aggiungere un collo, intervenire sul singolo collo oppure creare la distinta per riconciliare gli incassi del corriere."},
    "spedizioni-8.png": {"access": "Nella spedizione espansa individua il prodotto dentro il collo e premi l'icona di rimozione sulla destra.", "fields": ["Destinatario e indirizzo", "Prodotto", "Numero del collo", "Importo", "Pagamento alla consegna", "Icona Rimuovi dal collo", "Annulla collo"], "use": "Usa questa azione per togliere soltanto quel prodotto. Il resto del collo e della spedizione rimane invariato."},
    "spedizioni-9.png": {"access": "Nella spedizione effettuata premi l'icona della matita accanto al destinatario o al collo.", "fields": ["Destinatario", "Indirizzo", "CAP, città, provincia e regione", "Telefono ed e-mail", "Numero colli", "Peso", "Preavviso telefonico", "Numeri dei prodotti", "Salva"], "use": "Correggi i dati della spedizione e premi Salva. Le modifiche riguardano la spedizione scelta, non riscrivono automaticamente l'anagrafica originale."},
    "spedizioni-10.png": {"access": "Nella spedizione effettuata premi Aggiungi collo.", "fields": ["Scegli da Da spedire", "Riga manuale", "Campo di ricerca", "Ordini e prodotti selezionabili", "Numero di elementi scelti", "Aggiungi"], "use": "Seleziona le righe ancora da spedire oppure passa a Riga manuale. Il nuovo collo viene aggiunto alla spedizione già esistente."},
    "spedizioni-11.png": {"access": "Apri la scheda Effettuate e spunta una o più spedizioni dall'elenco.", "fields": ["Intervallo di date", "Ricerca", "Spedizioni selezionate", "Unisci", "Distinta del corriere", "Distinta CORRIERE_B", "Crea distinta"], "use": "La selezione abilita le azioni collettive nella parte alta. Scegli il documento o l'operazione adatta alle spedizioni selezionate."},
    "spedizioni-12.png": {"access": "Nella pagina Spedizioni apri la scheda Spedizioni effettuate.", "fields": ["Ricerca e filtri", "Data", "Destinatario", "Colli e prodotti", "Contrassegno", "Stato", "Dettaglio e annullamento"], "use": "Usa lo storico per verificare una consegna già registrata. L'annullamento riporta le righe nel flusso previsto e va usato soltanto per una correzione reale."},

    "crediti-1.png": {"access": "Premi l'icona della Contabilità nella barra laterale e apri la sezione Crediti o Pagamenti.", "fields": ["Totali contabili", "Ricerca", "Filtri", "Schede o segmenti", "Elenco movimenti", "Importo, scadenza, cliente e stato"], "use": "Separa gli importi ancora attesi dagli incassi già registrati, quindi usa ricerca e filtri per trovare il movimento da controllare, correggere o confermare."},
    "crediti-2.png": {"access": "Dalla pagina Crediti apri il pagamento che vuoi registrare o correggere.", "fields": ["Tipo", "Importo", "Atteso o Incassato", "Conto", "Data", "Verificato in prima nota", "Note", "Annulla pagamento", "Salva"], "use": "Scegli Atteso per una scadenza e Incassato per denaro già ricevuto. Il conto deve essere quello su cui il movimento è realmente transitato.", "first_time": "Se stai solo correggendo conto o data, non cambiare lo stato. Annulla pagamento rimuove il movimento: non equivale al pulsante Chiudi."},
    "crediti-3.png": {"access": "La schermata compare quando registri un incasso più alto del residuo ancora dovuto.", "fields": ["Differenza tra incasso e residuo", "Aumenta il prezzo finale dell'ordine", "Mantieni l'eccedenza e crea il rimborso", "Correggi l'incasso al residuo", "Torna a correggere"], "use": "Scegli in base a ciò che è successo davvero: adegua il prezzo, conserva l'eccedenza preparando un rimborso oppure riduci l'incasso al residuo. Torna a correggere riapre il pagamento senza applicare nulla.", "first_time": "Se non sai perché l'importo è più alto, scegli Torna a correggere. È l'unica opzione che non cambia ordine, incasso o rimborsi."},
    "crediti-4.png": {"access": "Nella scheda Crediti premi Filtri, sopra la tabella.", "fields": ["Medici", "Conti", "Stato", "Linee", "Spedizione: Tutti, Spediti o Non spediti", "Dal", "Al", "Azzera filtri"], "use": "I filtri si possono combinare. Se non trovi un credito, premi Azzera filtri e riparti da una ricerca più ampia."},
    "crediti-5.png": {"access": "Nella scheda Crediti premi Esporta o Stampa.", "fields": ["Colonne da includere", "Orientamento verticale o orizzontale", "Numero di righe e colonne", "Anteprima", "Stampa", "Salva Excel"], "use": "Spunta soltanto le colonne utili, scegli l'orientamento e controlla l'anteprima. Premi Salva Excel per creare il file oppure Stampa per inviarlo alla stampante."},
    "distinte-1.png": {"access": "Dalla Contabilità apri la scheda Distinte corriere.", "fields": ["Nuova distinta", "Ricerca e filtri", "Elenco distinte", "Data", "Corriere", "Importi e stato", "Azioni"], "use": "Consulta le riconciliazioni già registrate oppure crea una nuova distinta quando ricevi l'accredito del corriere. Data, importi e stato aiutano a distinguere le operazioni già chiuse da quelle da verificare."},
    "distinte-2.png": {"access": "Premi Nuova distinta nella sezione Distinte corriere.", "fields": ["Corriere", "Data distinta e data accredito", "Conto di accredito", "Pagamenti selezionabili", "Importo atteso", "Importo accreditato", "Registra distinta"], "use": "Seleziona i pagamenti realmente compresi nell'accredito e confronta i totali prima di registrare.", "first_time": "L'importo accreditato è ciò che trovi sul conto; i pagamenti selezionati spiegano da quali consegne proviene. Se i valori non tornano, non registrare ancora la distinta."},
    "provvigioni-1.png": {"access": "Dalla Contabilità apri la scheda Provvigioni.", "fields": ["Agente", "Periodo", "Maturato, potenziale e pagato", "Ordini collegati", "Importi", "Paga provvigioni"], "use": "Filtra per agente e periodo. Il maturato rappresenta quanto può essere liquidato secondo le regole applicate."},
    "provvigioni-2.png": {"access": "Nella scheda Provvigioni premi Paga provvigioni.", "fields": ["Agente", "Data", "Includi solo acconto", "Voci selezionabili", "Importo di ogni provvigione", "Totale", "Segna come pagate"], "use": "Seleziona solo le voci comprese nel pagamento reale e controlla il totale prima della conferma.", "first_time": "Segna come pagate modifica tutte le righe selezionate. Prima di premere, confronta il totale con il pagamento effettuato all'agente."},
    "provvigioni-3.png": {"access": "Dalla finestra delle provvigioni apri lo Storico.", "fields": ["Data del pagamento", "Agente", "Totale pagato", "Voci comprese", "Azioni di dettaglio o annullamento"], "use": "Ricostruisci una liquidazione già effettuata controllando data, agente, totale e voci comprese. Le somme pagate restano così separate dalle provvigioni ancora maturate."},
    "rimborsi-1.png": {"access": "Dalla Contabilità apri la scheda Rimborsi.", "fields": ["Nuovo rimborso", "Filtri", "Totali", "Elenco richieste", "Cliente", "Ordine", "Importo e stato"], "use": "Usa i filtri per distinguere richieste aperte e rimborsi già effettuati."},
    "rimborsi-2.png": {"access": "Premi Nuovo rimborso oppure apri una richiesta esistente.", "fields": ["Ordine collegato", "Data richiesta", "Importo", "Ragione sociale", "Motivo", "IBAN", "Conto di uscita", "Data rimborso", "Note", "Crea rimborso"], "use": "Collega l'ordine quando esiste: sarà più semplice capire l'origine del rimborso e i suoi effetti economici.", "first_time": "Creare la richiesta non significa aver già restituito il denaro. Usa Segna come effettuato solo dopo l'uscita reale dal conto."},
    "rimborsi-3.png": {"access": "Apri la scheda Rimborsi e osserva la riga della richiesta.", "fields": ["Cliente e ordine", "Importo", "Data", "Stato Richiesto o Effettuato", "Azioni disponibili"], "use": "Lo stato Richiesto indica che il denaro non è ancora uscito; Effettuato va usato solo dopo il rimborso reale."},
    "rimborsi-4.png": {"access": "Sulla riga del rimborso premi Segna come effettuato.", "fields": ["Importo del rimborso", "Data rimborso", "Conto di uscita", "Annulla", "Conferma"], "use": "Scegli data e conto effettivi. Conferma aggiorna la situazione contabile dell'ordine collegato."},

    "anagrafiche-1.png": {"access": "Premi l'icona delle Anagrafiche nella barra laterale sinistra.", "fields": ["Schede Agenti, Medici, Clienti, Prodotti, Conti e Corrieri", "Ricerca", "Filtri", "Elenco record", "Nuovo elemento", "Azioni di modifica"], "use": "Apri la scheda della categoria che ti serve. Cerca sempre prima di creare un nuovo record, per evitare duplicati."},
    "anagrafiche-2.png": {"access": "Nelle Anagrafiche apri Agenti e premi Modifica sull'agente desiderato.", "fields": ["Nome", "Tipo provvigione", "Valore provvigione", "Provvigione maturata", "Pagamento alla spedizione o a ordine chiuso", "Diagnostica e Keriba", "Acconti provvigionali", "Conto di uscita"], "use": "Le scelte determinano come il Gestionale PharmaTek calcolerà le provvigioni future dell'agente."},
    "anagrafiche-2.5.png": {"access": "Dalla scheda dell'agente apri Preferenze agenti.", "fields": ["Calcola provvigioni percentuali su imponibile", "Detrai spese di spedizione", "Spese di spedizione standard"], "use": "Attiva soltanto le regole concordate. Queste opzioni cambiano la base usata per il calcolo delle provvigioni."},
    "anagrafiche-3.png": {"access": "Apri Anagrafiche, scheda Medici, quindi premi Modifica.", "fields": ["Nome", "Agente di riferimento", "Prezzo standard immunoterapia", "Acconto predefinito", "Ruolo dati paziente", "Conto di saldo preferito", "Indirizzo, telefono, e-mail, città, CAP e regione"], "use": "Agente, prezzo e acconto possono essere proposti automaticamente nei nuovi ordini del medico."},
    "anagrafiche-4.png": {"access": "Apri Anagrafiche, scheda Clienti, quindi premi Modifica.", "fields": ["Nome o ragione sociale", "Indirizzo", "Città, provincia, CAP e regione", "Telefono ed e-mail", "Codice fiscale o partita IVA", "Note di spedizione"], "use": "Questi dati vengono riutilizzati in ordini e spedizioni. Controlla soprattutto recapiti e indirizzo prima di salvare."},
    "anagrafiche-5.png": {"access": "Apri Anagrafiche e premi la scheda Prodotti.", "fields": ["Ricerca prodotti", "Nuovo prodotto", "Prova prezzo", "Prodotto", "Medico opzionale", "Calcola", "Prezzo risultante e regola applicata", "Elenco con categoria e prezzo base"], "use": "Usa l'elenco per consultare o modificare il prezzario del gestionale. Con Prova prezzo puoi scegliere prodotto e medico e verificare quale prezzo verrebbe proposto, senza creare un ordine."},
    "anagrafiche-6.png": {"access": "Nella scheda Prodotti usa il riquadro Prova prezzo nella parte alta.", "fields": ["Prodotto", "Medico opzionale", "Calcola", "Prezzo risultante", "Origine della regola", "Elenco dei prodotti sottostante"], "use": "Scegli un prodotto, aggiungi il medico se vuoi verificare una regola personalizzata e premi Calcola. Il risultato spiega anche quale regola ha determinato il prezzo."},
    "anagrafiche-7.png": {"access": "Apri Anagrafiche, scheda Prodotti, quindi Nuovo o Modifica.", "fields": ["Nome prodotto", "Categoria", "Prezzo base", "Righe del kit", "Importo delle componenti", "Acconto o regole collegate", "Aggiungi riga", "Salva"], "use": "Il prodotto apparirà nel nuovo ordine con i dati configurati qui. Dai un nome chiaro e controlla categoria e prezzo."},
    "anagrafiche-8.png": {"access": "Apri Anagrafiche, scheda Conti, quindi Nuovo o Modifica.", "fields": ["Nome conto", "Banca", "IBAN", "Salva"], "use": "Usa un nome riconoscibile dagli operatori. L'IBAN serve a distinguere conti simili e va verificato con attenzione."},
    "anagrafiche-9.png": {"access": "Dalla scheda Conti apri Preferenze conti.", "fields": ["Conto predefinito incassi", "Conto preferito acconti", "Conto acconti corriere", "Conto predefinito rimborsi"], "use": "Queste scelte vengono proposte automaticamente nelle registrazioni; l'operatore può comunque cambiarle quando il movimento usa un conto diverso."},
    "anagrafiche-10.png": {"access": "Apri Anagrafiche, scheda Corrieri, quindi Nuovo o Modifica.", "fields": ["Nome corriere", "Profilo distinto export", "Conto di accredito contrassegni", "Salva"], "use": "Il profilo viene usato nella preparazione delle spedizioni e delle relative esportazioni."},

    "impostazioni-1.png": {"access": "Premi l'icona dell'ingranaggio nella barra laterale sinistra.", "fields": ["Periodo predefinito della Dashboard", "Sollecita i pagamenti", "Avviso anticipato promemoria", "Pop-up notifiche", "Notifiche anche in primo piano", "Suono di notifica e pulsante di prova", "Importa Clienti Storici", "Esporta per Aruba", "Numero di produzione iniziale", "Avvia con Windows e opzioni di sistema"], "use": "Imposta il periodo iniziale della Dashboard, scegli quando ricevere avvisi e solleciti, prova il suono delle notifiche e configura l'avvio del programma. Importazioni, esportazioni e numerazioni incidono sul lavoro condiviso: modificale solo quando necessario."},
    "impostazioni-2.png": {"access": "In Impostazioni premi Importa Clienti Storici.", "fields": ["Area dei file selezionati", "Aggiungi file Excel", "Aggiungi cartella", "Formati supportati", "Avvia scansione", "Annulla"], "use": "Puoi scegliere singoli file o una cartella. Avvia la scansione solo dopo aver controllato la sorgente indicata.", "first_time": "L'analisi riconosce i formati supportati e controlla i duplicati. Il riepilogo finale ti dirà cosa è stato creato e cosa è stato saltato."},
    "impostazioni-3.png": {"access": "Al termine dell'importazione dei clienti storici si apre il riepilogo dell'operazione.", "fields": ["Nuovi clienti creati", "Anagrafiche completate", "Duplicati saltati", "Errori o righe da controllare", "Completato"], "use": "Controlla quanti clienti sono stati creati, completati o saltati e verifica le eventuali righe con errori prima di chiudere. I duplicati saltati indicano record già riconosciuti."},
    "impostazioni-4.png": {"access": "In Impostazioni premi Esporta per Aruba.", "fields": ["Dal e Al", "Clienti trovati nel periodo", "Gestione automatica dei dati mancanti", "Avvia esportazione", "Salvataggio del file Excel", "Importazione in Aruba"], "use": "Scegli il periodo e premi Avvia esportazione. Il Gestionale PharmaTek prepara automaticamente i clienti inclusi e gestisce i dati mancanti necessari al formato Aruba: non devi completarli uno per uno. Salva l'Excel in una posizione riconoscibile; poi apri Aruba, entra in Clienti, scegli Importa e carica il file appena salvato."},
    "impostazioni-5.png": {"access": "Apri Impostazioni dall'ingranaggio e scorri la pagina dall'alto verso il basso.", "fields": ["Dashboard", "Gestione anagrafiche esterne", "Notifiche", "Produzione", "Sistema", "Backup", "Aspetto", "Pubblica dati", "Pulizia dati"], "use": "Puoi personalizzare Dashboard e notifiche, gestire importazioni ed esportazioni, cambiare l'aspetto del programma e controllare gli strumenti di sistema. Backup, pubblicazione e pulizia modificano dati o file: leggine sempre la conferma prima di proseguire."},
    "spotlight-1.png": {"access": "Premi la barra Cerca o digita un comando nella parte alta del programma, oppure usa Alt+P.", "fields": ["Campo di ricerca", "Messaggio", "Promemoria", "Pagamenti", "Spedizioni", "Distinte corriere", "Provvigioni", "Rimborsi e altri comandi"], "use": "Scrivi il nome di una persona, un numero ordine o l'azione che vuoi eseguire. Spotlight propone risultati e comandi pertinenti."},
    "spotlight-2.png": {"access": "Apri Spotlight e digita uno o più termini.", "fields": ["Testo cercato", "Risultati clienti o medici", "Ordini collegati", "Comandi suggeriti", "Indicazione dell'anno"], "use": "Premi il risultato desiderato per aprirlo. Se trovi più omonimi, usa anno, numero ordine o altri termini per restringere la ricerca."},
    "spotlight-3.png": {"access": "In Spotlight digita un comando, ad esempio messaggio seguito dal destinatario.", "fields": ["Comando riconosciuto", "Destinatario o record trovato", "Azione proposta", "Conferma tramite selezione"], "use": "Spotlight può preparare azioni contestuali. Controlla sempre destinatario e record prima di confermare il suggerimento."},
    "pannelli-1.png": {"access": "Premi la campanella nella barra superiore.", "fields": ["Numero di notifiche", "Tipo e urgenza", "Titolo", "Importo, scadenza o ordine collegato", "X per scartare", "Nuovo messaggio", "Cancella tutte"], "use": "Premi una notifica per aprire l'elemento collegato. La X rimuove l'avviso dal pannello, non elimina l'ordine o il pagamento."},
    "pannelli-2.png": {"access": "Premi l'icona del cestino nella barra superiore.", "fields": ["Tipo di elemento eliminato", "Nome o riferimento", "Ripristina", "Elimina definitivamente", "Svuota"], "use": "Ripristina riporta il record nel gestionale. L'eliminazione definitiva non offre lo stesso recupero e va usata con cautela.", "first_time": "La freccia verde ripristina; la X elimina definitivamente. Svuota applica l'eliminazione definitiva a tutto ciò che è nel Cestino."},
    "pannelli-3.png": {"access": "Dal pannello notifiche premi l'icona del nuovo messaggio.", "fields": ["Destinatario", "Testo del messaggio", "Invia", "Annulla", "Stato delle notifiche"], "use": "Scegli la persona, scrivi il messaggio e premi Invia. Il testo viene consegnato tramite le notifiche interne di PharmaTek."},
    "pannelli-4.png": {"access": "Premi nome o avatar in alto a destra e scegli Modifica profilo.", "fields": ["Nome utente", "Nome mostrato agli altri PC", "Tema colore", "Carica una foto", "Usa le iniziali", "Salva profilo"], "use": "Il profilo identifica la postazione nelle attività condivise. Scegli un nome chiaro e, se vuoi, un colore o una foto riconoscibile."},
    "pannelli-5.png": {"access": "Premi l'indicatore Online nella barra superiore.", "fields": ["Stato della sincronizzazione", "Postazioni", "Ultimo aggiornamento", "Forza sincronizzazione", "Apri cartella dati"], "use": "Controlla che la postazione sia Online e aggiornata. Forza sincronizzazione serve quando vuoi richiedere subito un nuovo controllo dei dati condivisi."},
    "info-1.png": {"access": "Apri il menu del profilo in alto a destra e scegli Info.", "fields": ["Versione di PharmaTek", "Controlla aggiornamenti", "Sito e contatti", "Novità e changelog", "Schede informative"], "use": "Quando chiedi assistenza, comunica la versione mostrata qui. Da questa finestra puoi anche controllare la disponibilità di aggiornamenti."},
    "info-2.png": {"access": "Nella finestra Info premi Novità e changelog.", "fields": ["Numero versione", "Data", "Novità", "Correzioni", "Miglioramenti"], "use": "Consulta la versione installata per scoprire quali funzioni sono state aggiunte, quali comportamenti sono migliorati e quali problemi sono stati corretti."},
    "info-3.png": {"access": "Nella finestra Info apri la scheda del gioco Flappy Livio.", "fields": ["Punteggio", "Record", "Area di gioco", "Indicazione dei comandi"], "use": "Premi Spazio per iniziare e prova a superare il record. Il gioco è indipendente dal lavoro operativo e non modifica i dati del gestionale."},
    "impostazioni-6-backup.png": {"goal": "Creare una copia di sicurezza o ritrovare un backup già disponibile.", "start": "Apri Impostazioni e raggiungi il riquadro Backup.", "steps": ["Premi Backup ora per creare subito una copia.", "Controlla data e dimensione nell'elenco dei backup salvati.", "Usa le icone della riga soltanto se devi ripristinare o eliminare quella copia."], "result": "Il nuovo backup compare nell'elenco e può essere usato come punto di recupero.", "attention": "Eliminare un backup non cancella i dati correnti, ma toglie un punto di recupero."},
    "impostazioni-7-ripristino.png": {"goal": "Riportare tutte le postazioni ai dati contenuti in un backup scelto.", "start": "Nel riquadro Backup premi Ripristina sulla copia corretta.", "steps": ["Controlla con attenzione data e ora del backup.", "Avvisa i colleghi e assicurati che non stiano inserendo dati.", "Premi Ripristina solo quando sei certo della copia scelta."], "result": "Il gestionale coordina le postazioni, sostituisce i dati e le riallinea alla copia selezionata.", "recovery": "Finché non confermi puoi scegliere Annulla. Non chiudere il programma durante il ripristino."},
    "amministrazione-1-centro-ripristino.png": {"goal": "Scegliere l'intervento amministrativo corretto senza confondere un problema locale con un reset generale.", "start": "In Impostazioni premi una volta il cestino del riquadro Pulizia dati oppure premi rapidamente cinque volte Canc.", "steps": ["Riconfigura questo PC interviene soltanto sulla postazione corrente.", "Ritira un PC scollega una postazione scelta dopo aver creato un backup.", "Ottimizza database conserva i dati di lavoro e compatta la cronologia tecnica dopo il coordinamento dei PC.", "Reset completo elimina i dati condivisi di tutti i PC."], "result": "Dopo la scelta viene indicato con precisione quali dati e postazioni saranno modificati.", "attention": "Se vuoi soltanto risolvere un problema su questo computer, non scegliere Reset completo."},
    "amministrazione-2-riconfigura.png": {"goal": "Riportare questo PC alla configurazione iniziale conservando il lavoro del team.", "start": "Nel Centro di ripristino scegli Riconfigura questo PC.", "steps": ["Leggi quali impostazioni locali verranno rimosse.", "Verifica di essere sul PC che vuoi scollegare.", "Conferma soltanto se vuoi ripetere la configurazione iniziale su questa postazione."], "result": "L'avvio automatico locale viene disattivato, questo PC viene scollegato e i dati condivisi restano intatti."},
    "amministrazione-3-ritira-pc.png": {"goal": "Revocare in sicurezza una postazione che non deve più usare il gestionale.", "start": "Nel Centro di ripristino scegli Ritira un PC.", "steps": ["Seleziona il PC corretto nell'elenco.", "Controlla il nome dell'utente, l'ultima attività e l'indicazione questo PC.", "Prosegui e rileggi la conferma prima del ritiro."], "result": "Prima della revoca viene creato un backup; gli altri PC non vengono modificati.", "attention": "La sessione del PC ritirato non potrà più scrivere dati condivisi."},
    "amministrazione-4-reset-completo.png": {"goal": "Capire la portata del reset completo prima di raggiungere l'ultima conferma.", "start": "Nel Centro di ripristino scegli Reset completo.", "steps": ["Leggi ciò che verrà eliminato.", "Verifica che un backup recente sia disponibile.", "Prosegui soltanto se l'obiettivo è ripartire da zero su tutti i PC."], "result": "Il pulsante continua apre un secondo e ultimo avviso; a questo punto non è ancora stato cancellato nulla.", "attention": "Non usare questo percorso per riconfigurare un solo PC."},
    "amministrazione-5-ultima-conferma.png": {"goal": "Fermarsi un'ultima volta prima dell'eliminazione definitiva di tutti i dati.", "start": "Dopo il primo avviso del Reset completo viene richiesta l'ultima conferma.", "steps": ["Controlla che l'intero team abbia terminato il lavoro.", "Verifica il backup e la decisione di ripartire da zero.", "Premi Elimina tutto definitivamente soltanto con autorizzazione esplicita."], "result": "Dopo la conferma vengono eliminati dati, sessioni e configurazioni condivise e il programma si riavvia.", "recovery": "Prima del clic finale usa Indietro per annullare. Dopo l'esecuzione, l'unica possibile fonte di recupero è un backup valido."},
}


def _procedura_da_guida(guide):
    """Converte le note descrittive senza trasformare i campi in una lista meccanica."""
    if "goal" in guide:
        return guide
    use = guide.get("use", "")
    sentences = [part.strip() for part in use.replace("!", ".").split(".") if part.strip()]
    # Il punto di partenza viene impaginato come primo passaggio dal generatore.
    # Le istruzioni successive arrivano dalle azioni reali descritte nella guida,
    # non da inventari del tipo "Controlla campo A, campo B, campo C".
    steps = [sentence + "." for sentence in sentences]
    return {
        "goal": sentences[-1] + "." if sentences else "Completare l'operazione in modo controllato.",
        "start": guide.get("access", "Apri la funzione indicata."),
        "steps": steps[:4],
        "result": use,
        **({"attention": guide["first_time"]} if guide.get("first_time") else {}),
    }


GUIDES = {name: _procedura_da_guida(guide) for name, guide in GUIDES.items()}

# Le procedure più delicate ricevono testi editoriali specifici: sono quelle in
# cui una spiegazione generica potrebbe portare a errori economici o di stato.
GUIDES.update({
    "giornaliero-6.png": {"goal": "Fare in modo che totale, acconto e saldo rappresentino davvero l'accordo con il cliente.", "start": "Nel nuovo ordine raggiungi il riepilogo economico dopo aver inserito i prodotti.", "steps": ["Controlla prodotti e quantità.", "Verifica il prezzo proposto dal prezzario e correggilo soltanto se l'accordo è diverso.", "Confronta totale, acconto concordato e importo già ricevuto prima di salvare."], "result": "Il gestionale calcola automaticamente quanto resta da pagare e prepara lo scadenzario coerente con i valori salvati.", "example": "Esempio: ordine da 1.000 €, acconto concordato 300 € e già incassato 300 €: il saldo sarà 700 €."},
    "giornaliero-8.png": {"goal": "Capire subito quanto è stato pagato e quanto resta da incassare.", "start": "Apri l'ordine e raggiungi Acconto e scadenzario.", "steps": ["Controlla il totale dell'ordine.", "Distingui l'acconto concordato da quello già incassato.", "Verifica il residuo e le scadenze future."], "result": "Dopo il salvataggio, i movimenti attesi compaiono anche in Contabilità; quelli incassati aggiornano il denaro già ricevuto.", "terms": "Residuo: parte dell'ordine che non risulta ancora incassata."},
    "giornaliero-10.png": {"goal": "Dividere il saldo in scadenze semplici da seguire.", "start": "Nello scadenzario dell'ordine premi Rateizza saldo.", "steps": ["Scegli il numero di rate e la cadenza.", "Imposta la prima scadenza.", "Controlla che la somma delle rate coincida con il saldo e conferma."], "result": "Il saldo unico viene sostituito dalle rate e il piano diventa effettivo quando salvi l'ordine.", "example": "Esempio: 100 € in tre rate diventano 33,33 €, 33,33 € e 33,34 €."},
    "produzione-6.png": {"goal": "Concludere la creazione del lotto e preparare il file per Laboratorio.", "start": "Dopo aver confermato le righe, apri il lotto appena creato.", "steps": ["Controlla numero del lotto e righe incluse.", "Apri il menu Esporta.", "Salva il file in una posizione riconoscibile e verifica il messaggio finale."], "result": "Le righe risultano in lavorazione e il file è pronto per essere inviato manualmente a Laboratorio.", "attention": "L'invio automatico a Laboratorio è una possibile evoluzione futura, non una funzione attuale."},
    "produzione-1.png": {"goal": "Creare i lotti e, quando serve, riordinare quelli già in lavorazione.", "start": "Apri Produzione. Usa Da produrre per preparare nuove lavorazioni e In lavorazione per i lotti già creati.", "steps": ["Per un nuovo lotto, resta in Da produrre e seleziona le righe pronte.", "Per riunire lotti esistenti, apri In lavorazione e spuntane almeno due.", "Premi Unisci lotti e conferma: possono appartenere anche a giorni diversi.", "Per tornare indietro, apri il menu del lotto unito e scegli Separa lotto."], "result": "Unisci lotti crea un solo gruppo operativo e permette un unico export. Separa lotto ripristina i gruppi di partenza: i prodotti non vengono duplicati e lo stato degli ordini non cambia.", "attention": "Unire non manda nuovamente gli ordini in produzione; separare non annulla il lavoro già registrato."},
    "spedizioni-2.png": {"goal": "Decidere quali ordini devono viaggiare nello stesso collo prima di creare la spedizione.", "start": "Nella scheda Da spedire seleziona le righe e controlla i gruppi proposti per destinatario.", "steps": ["Verifica che nome e indirizzo del destinatario coincidano.", "Unisci le righe che devono viaggiare insieme.", "Separa quelle che devono diventare colli distinti, poi prosegui con Crea spedizione."], "result": "Questa scelta prepara i colli da creare. Non modifica i gruppi già presenti nella scheda Effettuate.", "terms": "Prima della creazione si uniscono i destinatari; dopo la creazione si possono unire i gruppi di spedizione."},
    "spedizioni-7.png": {"goal": "Capire quanto denaro è collegato ai prodotti partiti e su quali conti deve arrivare.", "start": "Apri Spedizioni, entra in Effettuate e apri con la freccia il gruppo che vuoi controllare.", "steps": ["Leggi Già incassato per il denaro già ricevuto e Da incassare per i pagamenti ancora attesi.", "Controlla la suddivisione per conto; i conti di transito, come contrassegno e assegno, restano riconoscibili.", "Apri il nome di un agente per vedere la sua parte divisa sugli stessi conti.", "Se devi registrare o correggere un movimento, premi Visualizza crediti."], "result": "Il totale comprende solo gli ordini con almeno un prodotto in questo gruppo. Gli acconti non vengono sommati una seconda volta: nella spedizione parziale ne viene attribuita soltanto la quota relativa alle righe partite. La somma restante viene associata ai pagamenti non-acconto, partendo dalle scadenze più vicine.", "example": "Esempio: un ordine ha due righe da 300 € e un acconto di 200 €. Se parte una sola riga, il riepilogo considera 300 € meno metà acconto, quindi 200 €.", "attention": "Questo riepilogo non è una distinta del corriere e non calcola le provvigioni: serve a leggere gli incassi collegati alla merce partita."},
    "spedizioni-11.png": {"goal": "Riunire spedizioni già effettuate in un unico gruppo di consultazione, oppure ripristinare i gruppi originali.", "start": "Apri Spedizioni, scegli Effettuate e spunta almeno due gruppi.", "steps": ["Controlla i gruppi selezionati e premi Unisci.", "Conferma anche se appartengono a giorni o corrieri diversi.", "Per annullare l'unione, apri il gruppo risultante e scegli Separa."], "result": "Le spedizioni selezionate compaiono in un solo gruppo, utile per controlli e calcoli comuni. Le distinte restano separate per corriere e gli incassi restano divisi per conto e agente. Separa ripristina i gruppi precedenti senza cambiare colli, ordini o pagamenti.", "attention": "Non confondere questa funzione con Unisci/separa destinatari: quella si usa prima di creare i colli; questa lavora su spedizioni già effettuate."},
    "provvigioni-1.png": {"goal": "Capire perché una provvigione percentuale può avere una base diversa dal totale dell'ordine.", "start": "Apri Contabilità e scegli Provvigioni; ogni scheda mostra la regola dell'agente e gli ordini che la compongono.", "steps": ["Controlla se la regola è percentuale oppure fissa.", "Per la percentuale, leggi la base mostrata: con lo scorporo attivo il gestionale divide il totale per 1,10 e calcola la percentuale sull'imponibile.", "Se è attiva anche la detrazione delle spese, il costo standard di spedizione viene tolto prima dello scorporo IVA.", "Per la regola fissa, usa direttamente l'importo in euro configurato: non viene scorporata l'IVA."], "result": "Il report ricalcola automaticamente base e provvigione per ogni ordine, applicando l'eventuale valore specifico della categoria. Potenziale, maturato e pagato descrivono momenti diversi e non vanno sommati tra loro.", "example": "Percentuale: 10% su 550 € IVA inclusa diventa 10% su 500 €, quindi 50 €. Fissa: una provvigione configurata a 50 € resta 50 €.", "attention": "Le opzioni Scorpora IVA e Detrai spese di spedizione riguardano le provvigioni percentuali; l'importo fisso non cambia."},
    "anagrafiche-2.5.png": {"goal": "Definire la base comune usata per le provvigioni percentuali.", "start": "In Anagrafiche, nella sezione Agenti, apri Preferenze agenti.", "steps": ["Attiva Calcola provvigioni percentuali su imponibile per scorporare l'IVA del 10%.", "Se previsto dagli accordi, attiva Detrai spese di spedizione.", "Inserisci il costo standard da sottrarre a ogni ordine e chiudi la finestra."], "result": "Per le percentuali, il gestionale sottrae prima l'eventuale costo di spedizione, poi scorpora l'IVA e applica la percentuale. Le provvigioni fisse non usano queste due correzioni.", "example": "Con ordine da 580 €, spese standard da 30 € e aliquota del 10%: (580 - 30) / 1,10 = 500 € di base."},
    "crediti-2.png": {"goal": "Registrare una scadenza o un pagamento senza alterare il saldo in modo errato.", "start": "In Contabilità apri Crediti e pagamenti e scegli Nuovo movimento.", "steps": ["Scegli Atteso se il denaro deve ancora arrivare oppure Incassato se è già stato ricevuto.", "Inserisci importo, data e conto corretti.", "Controlla l'ordine collegato e conferma."], "result": "Un incasso riduce il residuo; un movimento atteso aggiunge una scadenza senza aumentare il denaro ricevuto.", "terms": "Atteso significa da incassare. Incassato significa già ricevuto."},
    "crediti-3.png": {"goal": "Decidere consapevolmente come trattare un incasso più alto del residuo.", "start": "L'avviso compare quando l'importo inserito supera ciò che resta da pagare.", "steps": ["Confronta l'importo ricevuto con il residuo.", "Scegli l'opzione che corrisponde all'accordo reale.", "Rileggi il nuovo saldo prima di confermare."], "result": "La scelta determina se la differenza resta come credito, viene collegata ad altro oppure richiede una correzione dell'importo.", "attention": "Non scegliere in base al pulsante più rapido: verifica prima il pagamento reale."},
    "distinte-2.png": {"goal": "Far coincidere i contrassegni attesi con l'accredito ricevuto dal corriere.", "start": "Apri Distinte corriere e seleziona i movimenti compresi nell'accredito.", "steps": ["Scegli il conto che ha ricevuto il bonifico.", "Confronta totale atteso e totale accreditato.", "Conferma soltanto quando movimenti e differenze sono spiegati."], "result": "I movimenti vengono riconciliati e non compaiono più tra quelli in attesa della distinta."},
    "rimborsi-3.png": {"goal": "Distinguere una richiesta di rimborso dal denaro realmente restituito.", "start": "Apri il rimborso dall'elenco Contabilità.", "steps": ["Controlla cliente, ordine, importo e motivazione.", "Lascia la richiesta aperta finché il pagamento non è stato eseguito.", "Dopo l'operazione reale, scegli il conto e segna il rimborso come effettuato."], "result": "Lo stato effettuato registra l'uscita e rende leggibile la situazione contabile dell'ordine."},
    "impostazioni-4.png": {"goal": "Portare in Aruba tutti i clienti nuovi senza completarli uno per uno.", "start": "In Impostazioni premi Esporta per Aruba.", "steps": ["Scegli eventualmente il periodo.", "Premi Procedi all'esportazione e salva tutti i file Excel proposti.", "In Aruba apri Clienti, scegli Importa e carica l'Excel salvato."], "result": "Il gestionale include automaticamente i clienti senza codice fiscale con un valore provvisorio marcato (FAKE). I clienti vengono segnati come esportati solo dopo il salvataggio riuscito.", "attention": "Il file viene preparato automaticamente, ma il caricamento in Aruba resta manuale."},
})


# Etichette narrative: chiariscono se una figura è un passaggio del flusso
# principale oppure un approfondimento/diramazione.
PROCESS_META = {
    "dashboard-1.png": ("Orientarsi nella Dashboard", "Punto di partenza"),
    "dashboard-3.png": ("Usare la bacheca", "1 · Leggi le attività"),
    "dashboard-2.png": ("Usare la bacheca", "2 · Crea un promemoria"),
    "dashboard-4.png": ("Usare la bacheca", "Alternativa · Notifica il team"),
    "dashboard-5.png": ("Leggere i grafici", "1 · Andamento e distribuzione"),
    "dashboard-6.png": ("Leggere i grafici", "2 · Classifiche"),
    "dashboard-7.png": ("Cambiare anno di lavoro", "Pannello dedicato"),

    "giornaliero-1.png": ("Gestire gli ordini", "Punto di partenza"),
    "giornaliero-2.png": ("Creare un ordine", "1 · Scegli il tipo"),
    "giornaliero-3.png": ("Creare un ordine", "2 · Compila i dati principali"),
    "giornaliero-4.png": ("Creare un ordine", "Se serve · Nuovo cliente"),
    "giornaliero-5.png": ("Creare un ordine", "Se serve · Codice fiscale"),
    "giornaliero-6.png": ("Creare un ordine", "3 · Controlla il riepilogo"),
    "giornaliero-7.png": ("Creare un ordine", "4 · Compila i prodotti"),
    "giornaliero-8.png": ("Preparare i pagamenti", "1 · Acconto e scadenzario"),
    "giornaliero-9.png": ("Preparare i pagamenti", "2 · Scegli il conto"),
    "giornaliero-10.png": ("Preparare i pagamenti", "3 · Crea le rate"),
    "giornaliero-11.png": ("Preparare i pagamenti", "4 · Controlla il piano"),
    "giornaliero-12.png": ("Azioni sull'ordine", "Menu della riga"),
    "giornaliero-13.png": ("Correggere un pagamento", "Finestra di modifica"),
    "giornaliero-14.png": ("Leggere lo stato", "Indicatore del percorso"),

    "produzione-1.png": ("Produzione", "Da produrre, unire e separare i lotti"),
    "produzione-2.png": ("Nuovo ordine Diagnostica", "Percorso alternativo"),
    "produzione-3.png": ("Preparare un lotto", "1 · Seleziona le righe"),
    "produzione-4.png": ("Preparare un lotto", "2 · Completa i prodotti"),
    "produzione-5.png": ("Preparare un lotto", "3 · Controlla gli avvisi"),
    "produzione-6.png": ("Preparare un lotto", "4 · Lotto creato"),
    "produzione-7.png": ("Preparare un lotto", "5 · Esporta il file"),
    "produzione-8.png": ("Trovare le righe", "Approfondimento · Filtri"),

    "spedizioni-1.png": ("Creare una spedizione", "Punto di partenza"),
    "spedizioni-2.png": ("Creare una spedizione", "1 · Seleziona ordini e prodotti"),
    "spedizioni-3.png": ("Creare una spedizione", "2 · Imposta data e corriere"),
    "spedizioni-4.png": ("Creare una spedizione", "3 · Pagamento e prodotti"),
    "spedizioni-5.png": ("Creare una spedizione", "4 · Conferma finale"),
    "spedizioni-6.png": ("Dopo la creazione", "Se serve · Esporta o stampa"),
    "spedizioni-7.png": ("Gestire una spedizione effettuata", "1 · Capisci il riepilogo economico"),
    "spedizioni-8.png": ("Gestire una spedizione effettuata", "Se serve · Rimuovi un prodotto"),
    "spedizioni-9.png": ("Gestire una spedizione effettuata", "Se serve · Modifica i dati"),
    "spedizioni-10.png": ("Gestire una spedizione effettuata", "Se serve · Aggiungi un collo"),
    "spedizioni-11.png": ("Operazioni collettive", "Unisci o separa i gruppi"),
    "spedizioni-12.png": ("Operazioni collettive", "Controlla il riepilogo"),

    "crediti-1.png": ("Gestire i crediti", "Punto di partenza"),
    "crediti-2.png": ("Registrare un pagamento", "Compila il movimento"),
    "crediti-3.png": ("Registrare un pagamento", "Se serve · Incasso eccedente"),
    "crediti-4.png": ("Trovare i crediti", "Filtri"),
    "crediti-5.png": ("Condividere l'elenco", "Esporta o stampa"),
    "distinte-1.png": ("Creare una distinta", "Punto di partenza"),
    "distinte-2.png": ("Creare una distinta", "Seleziona e registra"),
    "provvigioni-1.png": ("Capire le provvigioni", "Percentuale e importo fisso"),
    "provvigioni-2.png": ("Pagare le provvigioni", "Seleziona e conferma"),
    "provvigioni-3.png": ("Pagare le provvigioni", "Controlla lo storico"),
    "rimborsi-1.png": ("Gestire un rimborso", "Punto di partenza"),
    "rimborsi-2.png": ("Gestire un rimborso", "1 · Crea la richiesta"),
    "rimborsi-3.png": ("Gestire un rimborso", "2 · Controlla lo stato"),
    "rimborsi-4.png": ("Gestire un rimborso", "3 · Segna come effettuato"),

    "anagrafiche-1.png": ("Orientarsi nelle Anagrafiche", "Punto di partenza"),
    "anagrafiche-2.png": ("Configurare un agente", "1 · Dati e provvigione"),
    "anagrafiche-2.5.png": ("Configurare un agente", "2 · Regole globali"),
    "anagrafiche-3.png": ("Compilare le anagrafiche", "Scheda del medico"),
    "anagrafiche-4.png": ("Compilare le anagrafiche", "Scheda del cliente"),
    "anagrafiche-5.png": ("Gestire i prodotti", "1 · Consulta il catalogo"),
    "anagrafiche-6.png": ("Gestire i prodotti", "2 · Prova un prezzo"),
    "anagrafiche-7.png": ("Gestire i prodotti", "3 · Modifica prodotto e regole"),
    "anagrafiche-8.png": ("Configurare i conti", "1 · Dati del conto"),
    "anagrafiche-9.png": ("Configurare i conti", "2 · Conti predefiniti"),
    "anagrafiche-10.png": ("Configurare le spedizioni", "Profilo del corriere"),

    "impostazioni-1.png": ("Orientarsi nelle Impostazioni", "Punto di partenza"),
    "impostazioni-2.png": ("Importare clienti storici", "1 · Scegli file o cartella"),
    "impostazioni-3.png": ("Importare clienti storici", "2 · Leggi il riepilogo"),
    "impostazioni-4.png": ("Portare i clienti in Aruba", "Esporta, salva e importa l'Excel"),
    "impostazioni-5.png": ("Orientarsi nelle Impostazioni", "Mappa completa"),
    "spotlight-1.png": ("Usare Spotlight", "1 · Apri la ricerca"),
    "spotlight-2.png": ("Usare Spotlight", "2 · Scegli un risultato"),
    "spotlight-3.png": ("Usare Spotlight", "3 · Avvia un comando"),
    "pannelli-1.png": ("Gestire le notifiche", "Apri la campanella"),
    "pannelli-2.png": ("Recuperare un elemento", "Apri il Cestino"),
    "pannelli-3.png": ("Inviare un messaggio", "Componi e invia"),
    "pannelli-4.png": ("Personalizzare il profilo", "Nome, colore e foto"),
    "pannelli-5.png": ("Controllare la sincronizzazione", "Postazioni e stato Online"),
    "info-1.png": ("Conoscere la versione", "Informazioni sull'app"),
    "info-2.png": ("Conoscere la versione", "Novità e changelog"),
    "info-3.png": ("Una pausa", "Flappy Livio"),
    "impostazioni-6-backup.png": ("Proteggere i dati", "1 · Crea e ritrova i backup"),
    "impostazioni-7-ripristino.png": ("Proteggere i dati", "2 · Scegli la copia da ripristinare"),
    "amministrazione-1-centro-ripristino.png": ("Amministrare le postazioni", "Scegli l'intervento corretto"),
    "amministrazione-2-riconfigura.png": ("Amministrare le postazioni", "Solo questo PC"),
    "amministrazione-3-ritira-pc.png": ("Amministrare le postazioni", "Ritira una postazione"),
    "amministrazione-4-reset-completo.png": ("Reset completo", "Primo avviso"),
    "amministrazione-5-ultima-conferma.png": ("Reset completo", "Ultima conferma"),
}



