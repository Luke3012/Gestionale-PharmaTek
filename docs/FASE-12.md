# FASE 12 — Preventivi, scheda cliente e documenti intelligenti

> Stato: **completata il 27 luglio 2026**.
>
> Dipendenza: FASE 11 (comunicazioni multicanale, modelli, campagne, coda affidabile e gate
> premium).

## 1. Obiettivo

La FASE 12 aggiunge un flusso commerciale locale-first per preparare, stampare, inviare e
sollecitare preventivi collegati agli ordini già presenti nel Giornaliero. Comprende inoltre una
scheda cliente operativa separata, che replica la struttura del modulo cartaceo PharmaTek come
documento A4 vettoriale, precompilato e stampabile.

La fase deve:

- funzionare per **Immunoterapia, Diagnostica e Keriba**;
- riusare catalogo, regole prezzo, ordini, clienti, medici, pagamenti e comunicazioni esistenti;
- rimanere offline e prevedibile anche nella compilazione intelligente;
- produrre preventivo e scheda cliente in **una sola pagina** ciascuno;
- non aggiungere binari ai log, agli snapshot, ai backup o alla cartella OneDrive;
- rispettare integralmente componenti, modali, finestre, motion, accessibilità e responsive già
  adottati dall'app.

## 2. Decisioni funzionali confermate

### 2.1 Collegamento con l'ordine

- Il preventivo è **facoltativo**.
- Può essere creato soltanto da un ordine esistente in stato `Nuovo`.
- Non esistono preventivi autonomi e non si crea un ordine implicitamente dalla sezione
  Preventivi.
- Un ordine possiede al massimo un preventivo corrente.
- Il preventivo **non cambia mai automaticamente lo stato dell'ordine**.
- Non vengono introdotti stati `Bozza`, `Accettato`, `Rifiutato` o `Scaduto`.
- Se l'ordine esce dallo stato `Nuovo`, il preventivo esistente resta consultabile, stampabile e
  reinviabile, ma non può più essere creato o modificato e non entra nelle campagne di sollecito.

### 2.2 Unica fonte di verità commerciale

Prodotti, quantità e prezzi del preventivo sono quelli dell'ordine sorgente. Se vengono modificati
dall'editor Preventivi:

1. vengono validate le revisioni correnti di ordine, righe e pagamenti;
2. ordine, righe e metadati del preventivo vengono aggiornati nello stesso comando di dominio;
3. lo scadenzario aperto viene riconciliato con le stesse regole dell'editor ordine;
4. incassi reali e pagamenti già consolidati restano protetti;
5. in caso di modifica concorrente nessuna parte viene salvata e l'utente deve ricaricare.

La fotografia semantica dell'ultimo documento inviato è invece immutabile: una modifica successiva
non cambia retroattivamente ciò che risulta inviato.

### 2.3 Indicazioni mostrate

Il preventivo espone soltanto informazioni derivate:

- **Mai inviato**: manca un invio concluso positivamente;
- **Inviato il …**: l'ultimo invio positivo è almeno recente quanto l'ultima modifica;
- **Modificato dopo l'invio**: il contenuto corrente è più recente dell'ultimo invio.

Un messaggio in coda o fallito non aggiorna `ultimo_invio`. Retry, reinvii ed esiti ambigui
continuano a essere rappresentati dalla cronologia della FASE 11.

## 3. Modello dati previsto

Le nuove entità sono premium e non sono modificabili tramite il CRUD generico, neppure su un PC
abilitato.

### 3.1 Preventivo

Identità deterministica: `preventivo/{ordine_id}`.

Contenuto logico:

```text
ordine_id
numero_preventivo
campi_documento
fingerprint_corrente
ultima_modifica_ms
ultima_modifica_utente
ultima_modifica_dispositivo
ultimo_invio? {
  comunicazione_id
  inviato_ms
  canale
  fingerprint
  snapshot_semantico
  versione_modello
}
creato_ms
```

`campi_documento` contiene soltanto elementi propri del preventivo (validità, condizioni, testo
introduttivo, note commerciali). Le righe e i prezzi correnti restano autorevoli nell'ordine.

`snapshot_semantico` contiene i dati necessari a ricostruire esattamente il documento inviato, non
il PDF o il PNG.

### 3.2 Scheda cliente

Identità deterministica: `scheda_cliente/{ordine_id}`.

La scheda è una fotografia operativa dell'ordine, precompilata ma correggibile senza sovrascrivere
automaticamente l'anagrafica principale:

```text
ordine_id
data_ricezione
pazienti
info_spedizione
contatti
intestatario_fattura {
  nome
  data_nascita
  luogo_nascita
  indirizzo_residenza
}
importo_totale
importo_acconto
data_contabile_valuta
modalita_saldo: bonifico | contrassegno | assegno | altro
note
preventivo_whatsapp
preventivo_email
mantenimento
npp
paziente_nuovo
aggiornata_ms
```

I dati iniziali derivano da ordine, righe, cliente/medico, dati di fatturazione diversi, pagamenti
e cronologia comunicazioni. Gli override restano confinati nella scheda finché l'utente non
modifica esplicitamente l'anagrafica tramite i flussi già esistenti.

### 3.3 Configurazione documenti

Una configurazione condivisa e versionata contiene:

- logo e stile PharmaTek incorporati nell'app;
- denominazione e recapiti;
- sede, sito, e-mail e telefono;
- eventuali dati fiscali;
- condizioni e validità predefinite;
- versione del modello grafico.

I valori presenti nel vecchio modulo cartaceo sono proposti come base modificabile. Dati legali
non disponibili non vengono inventati.

## 4. Sezione Preventivi

La nuova voce di navigazione è collocata fra **Giornaliero** e **Produzione**.

La pagina riusa le convenzioni delle altre viste:

- caricamento lazy;
- `Pagina`, toolbar adattiva, filtri condivisi e tabella virtualizzata;
- colonne compatte e menu ⋯ coerenti col Giornaliero;
- ricerca per numero ordine/preventivo, cliente, medico e paziente;
- filtri per linea e indicazione dell'invio;
- aggiornamento su eventi e ricostruzione della proiezione;
- modali in-app; dialoghi nativi limitati a stampa e file-picker.

Il menu ⋯ del preventivo comprende:

- Apri / modifica;
- Anteprima;
- Stampa preventivo;
- Salva PDF;
- Salva immagine;
- Invia;
- Sollecita;
- Stampa scheda cliente.

**Invia** accoda direttamente il preventivo sui recapiti validi disponibili; **Sollecita** apre
invece il compositore per la revisione del singolo messaggio. L'azione di invio rapido è presente
anche nell'anteprima e come **Salva e invia** nell'editor.

La creazione mostra soltanto ordini `Nuovo` senza preventivo.

## 5. Compilazione intelligente da testo

Il parser è locale, deterministico e spiegabile. Non usa API, servizi cloud o modelli generativi.

### 5.1 Capacità

- normalizzazione Unicode, accenti, maiuscole, spaziatura e punteggiatura;
- quantità in cifra o parola;
- importi italiani con virgola, punto, simbolo euro o suffissi;
- riconoscimento di prodotti tramite nome, token caratteristici e alias;
- correzione di refusi con distanza Damerau-Levenshtein e similarità per trigrammi;
- segmentazione di più righe da newline, punti, virgole e congiunzioni;
- riconoscimento del paziente e di note residue;
- priorità alla linea dell'ordine;
- priorità secondaria ai prodotti già usati col cliente o medico;
- risoluzione del prezzo condiviso in un solo batch;
- rispetto degli override manuali;
- livello di confidenza per campo e motivazione dell'abbinamento.

### 5.2 Sicurezza operativa

- Nessuna interpretazione viene salvata senza revisione.
- Le ambiguità mostrano alternative selezionabili.
- Un prodotto non riconosciuto può restare testo libero.
- Gli alias vengono ricordati soltanto su scelta esplicita dell'utente.
- I casi a bassa confidenza vengono evidenziati e portati al primo campo da correggere.
- Parsing e ranking sono funzioni pure coperte da test.

## 6. Renderer documenti

Preventivo e scheda cliente condividono un renderer vettoriale A4 caricato soltanto quando serve.
Lo stesso modello genera:

- anteprima nel modale;
- stampa;
- PDF;
- PNG ad alta definizione.

Questo evita differenze di impaginazione fra anteprima e file.

### 6.1 Preventivo

Il layout single-page comprende:

- testata PharmaTek moderna ispirata alla diagonale del modulo storico;
- numero preventivo, riferimento ordine e data;
- cliente, medico, paziente e recapiti pertinenti;
- tabella prodotti compatta;
- totale IVA inclusa;
- imponibile e IVA al 10% scorporati senza aumentare il totale;
- acconto, saldo, modalità e condizioni di pagamento;
- validità e note;
- recapiti aziendali nel piè di pagina.

### 6.2 Scheda cliente

Il documento conserva struttura e ordine del riferimento cartaceo:

- ricezione e paziente;
- spedizione e contatti;
- intestatario fattura;
- totale, acconto e data contabile/valuta;
- modalità del saldo;
- note;
- canale usato per il preventivo;
- mantenimento, NPP e paziente nuovo.

I campi compilati vengono stampati come valori leggibili; le caselle booleane restano riconoscibili
anche in bianco e nero. Quando un dato manca, la relativa riga o cella resta bianca e scrivibile
a penna: non vengono stampati trattini o segnaposto.

### 6.3 Garanzia single-page

Il renderer usa densità progressiva, wrapping controllato e dimensioni minime leggibili. Non taglia
mai contenuto silenziosamente. Se righe o note superano la capacità sicura, l'anteprima indica cosa
ridurre prima di abilitare stampa e invio.

## 7. Modale scheda cliente e accessi

Il flusso è simile all'esportazione globale Aruba:

1. caricamento e precompilazione;
2. form compatto con riepilogo delle informazioni mancanti;
3. anteprima A4;
4. stampa o salvataggio.

Il footer resta fermo, il corpo è scrollabile e l'anteprima blocca la chiusura del modale
sottostante secondo le convenzioni esistenti.

Punti di accesso:

- menu ⋯ della riga nel Giornaliero;
- menu contestuale della riga;
- modale/finestra di visualizzazione e modifica ordine;
- menu ⋯ del preventivo.

### 7.1 Primo salvataggio ordine

- Con premium compare **Salva e stampa** accanto a **Salva**.
- Il comando salva prima l'ordine con il flusso normale, crea/precompila la scheda e apre
  l'anteprima.
- Se il dialogo di stampa viene annullato, l'ordine resta correttamente salvato.
- Senza premium **Salva e stampa** non viene mostrato.

### 7.2 Ordine già esistente

- **Salva** e **Stampa** sono azioni separate.
- **Stampa** resta visibile anche senza premium.
- Senza premium non carica dati riservati né avvia il renderer: apre il modale premium.
- La voce **Stampa scheda cliente** nei menu ⋯ segue lo stesso comportamento.

## 8. Invio e solleciti

### 8.1 Invio

- E-mail: messaggio FASE 11 con PDF allegato.
- WhatsApp: messaggio con PNG single-page, oppure PDF quando il documento occupa più pagine.
- L'invio rapido usa tutti i recapiti validi disponibili senza aprire il compositore: e-mail e
  WhatsApp quando sono entrambi validi, oppure silenziosamente il solo canale disponibile.
- Se nessun recapito è valido o la preparazione/accodamento fallisce, viene mostrato un toast.
- La revisione resta disponibile per il sollecito singolo e per le campagne.
- Dopo l'accodamento, il worker esegue automaticamente gli invii in sequenza.
- `ultimo_invio` viene aggiornato soltanto quando la comunicazione raggiunge
  `invio_azionato` o `consegna_verificata`. Sul preventivo condiviso resta soltanto il riepilogo
  minimo (data, canale e fingerprint); contenuto e fotografia esatta dell'invio restano nella
  cronologia locale della postazione.
- Errori certi, retry ed esiti ambigui conservano le protezioni della FASE 11.

### 8.2 Solleciti

Il flusso replica la campagna solleciti pagamenti:

1. la toolbar mostra la somma dei preventivi **Da inviare** e **Da sollecitare**;
2. l'operatore sceglie uno dei due gruppi disgiunti;
3. destinatari senza recapito o non più validi sono esclusi in modo visibile;
4. una sola conferma mette gli elementi in coda;
5. il worker li invia automaticamente e sequenzialmente.

Gruppi:

- **Da inviare**: preventivi mai inviati o modificati dopo l'ultimo invio, senza attesa e
  indipendentemente dallo stato dell'ordine;
- **Da sollecitare**: preventivi invariati dopo l'invio, collegati a un ordine ancora `Nuovo` e
  più vecchi della soglia configurata rispetto all'ultimo invio o sollecito riuscito;
- soglia predefinita: 7 giorni, configurabile;
- deduplicazione e idempotenza per preventivo, canale e campagna.

Le campagne dei due gruppi usano rispettivamente i modelli `preventivo` e
`sollecito_preventivo` e non vengono mai mescolate. Non viene introdotto uno scheduler invisibile
che invia senza una conferma di campagna.

## 9. File temporanei e prestazioni

- PDF/PNG non entrano nei dati condivisi.
- Il renderer e le dipendenze documentali sono lazy.
- Ogni documento possiede un fingerprint semantico.
- La cache locale riusa il file già generato finché il fingerprint non cambia.
- Gli allegati restano nella cache applicativa locale finché la comunicazione raggiunge uno stato
  terminale.
- Dopo il successo vengono eliminati; un cleanup TTL recupera residui dopo crash o riavvio.
- La generazione non blocca la navigazione e non viene ripetuta durante semplici re-render React.
- Caricamento dati e risoluzione prezzi avvengono in batch.

## 10. Matrice premium

| Superficie | Premium attivo | Premium non attivo |
|---|---|---|
| Voce/sezione Preventivi | Visibile | Nascosta |
| Azioni preventivo fuori dalla sezione | Visibili dove pertinenti | Nascoste |
| `Salva e stampa` su nuovo ordine | Visibile | Nascosto |
| `Stampa` su ordine esistente | Funzionante | Visibile, apre modale premium |
| `Stampa scheda cliente` nei menu ordine | Funzionante | Visibile, apre modale premium |
| Comandi backend e nuove entità | Consentiti | Rifiutati |

La UI non è una barriera di sicurezza: ogni comando di dominio verifica nuovamente il gate.

## 11. Fette di implementazione

### 12A — Contratti e dominio

- DTO, entità protette e comandi;
- fingerprint e snapshot;
- aggiornamento atomico ordine/preventivo/scadenzario;
- test premium e concorrenza.

### 12B — Parser intelligente

- normalizzazione, segmentazione, matching e ranking;
- alias espliciti;
- batch prezzi;
- test di casi reali e ambigui.

### 12C — Sezione Preventivi

- navigazione premium;
- tabella, filtri e menu;
- editor e compilazione da testo;
- stati derivati di modifica/invio.

### 12D — Renderer

- modello vettoriale condiviso;
- preventivo single-page;
- anteprima, stampa, PDF e PNG;
- controllo overflow.

### 12E — Scheda cliente

- payload, precompilazione e modale;
- layout single-page;
- integrazione Giornaliero/editor/finestra ordine;
- comportamenti primo e successivo salvataggio.

### 12F — Comunicazioni

- allegati temporanei;
- invio singolo;
- campagna solleciti;
- aggiornamento dell'ultimo invio da esito positivo.

### 12G — Hardening

- cleanup cache;
- eventi multi-finestra e riallineamento;
- responsive, zoom, motion ridotta e accessibilità;
- protezioni da doppio click e modifiche concorrenti.

### 12H — Verifica e documentazione

- test frontend e Rust;
- build, `rustfmt` e `clippy --all-targets -D warnings`;
- visual QA conclusiva dei due documenti e dei breakpoint principali;
- aggiornamento di `MODELLO-DATI.md`, `UI-SPEC.md`, `IMPLEMENTAZIONE.md`,
  `MANUALE-FUNZIONALE-UI.md` e `FEATURE-FUTURE.md`;
- changelog e manuale PDF esclusi dall'intervento su indicazione esplicita del committente.

## 12. Criteri di completamento

La fase è completa quando:

- ogni linea può creare un preventivo da un ordine `Nuovo`;
- modifiche commerciali dal preventivo e ordine restano coerenti dopo concorrenza e sync;
- il parser gestisce casi realistici senza rete e non applica ambiguità in silenzio;
- preventivo e scheda cliente producono una pagina coerente in anteprima, stampa, PDF e PNG;
- e-mail e WhatsApp usano la coda FASE 11 con allegati locali temporanei;
- ultimo invio e ultima modifica sono corretti anche dopo fallimenti e reinvii;
- coda, campagne e intera cronologia comunicazioni restano locali al PC e non entrano in
  OneDrive, snapshot o backup condivisi;
- i solleciti rispettano idempotenza, soglia e stato dell'ordine;
- tutte le superfici rispettano esattamente la matrice premium;
- nessun binario raggiunge OneDrive, eventi, snapshot o backup;
- test, build, formattazione, lint e documentazione risultano aggiornati.

## 13. Esito dell'implementazione

Tutte le fette 12A–12H sono state completate. L'implementazione autorevole è distribuita fra:

- `src-tauri/src/app/preventivi.rs` per dominio, precompilazione, alias e configurazione documenti;
- `src/features/preventivi/` per pagina, editor, parser, renderer, scheda cliente e solleciti;
- il motore locale FASE 11 per coda, campagne, cronologia ed esiti di invio;
- il Giornaliero e l'editor ordine per gli accessi contestuali alla scheda cliente;
- il gate premium condiviso, applicato sia alle superfici UI sia ai comandi Rust.

Il salvataggio del preventivo valida insieme revisione del preventivo, ordine, righe e pagamenti,
poi emette un unico batch. L'indicazione mostrata non è uno stato commerciale: viene derivata dal
confronto fra fingerprint corrente, ultima modifica e ultimo invio positivo. Le fotografie
semantiche dell'invio restano nel payload della comunicazione locale; sul preventivo condiviso
rimangono soltanto gli indicatori compatti necessari a questo confronto.

PDF e PNG sono generati soltanto quando servono. La cache locale usa riferimenti
`pt-cache://<sha256>.<estensione>`, con verifica di firma, hash e dimensione; non pubblica percorsi
locali o byte nei dati condivisi. Il file viene eliminato quando non è più referenziato da invii
attivi, mentre il cleanup a 30 giorni recupera eventuali residui lasciati da arresti anomali.

### 13.1 Verifiche concluse

- parser offline: casi Unicode, quantità e importi italiani, refusi, ranking, alias e ambiguità;
- dominio Rust: gate premium, identità deterministiche, salvataggio atomico, revisione obsoleta,
  configurazione condivisa e aggiornamento dell'ultimo invio;
- comunicazioni: registro e cronologia local-only, allegato MIME PDF, riferimenti locali sicuri,
  rimozione terminale e fotografia protetta localmente; i test che produrrebbero invii WhatsApp
  reali restano intenzionalmente esclusi dalla suite automatica;
- frontend: compilazione, rendering, preferenze e soglia dei solleciti;
- documenti: entrambi i PDF verificati come A4 a pagina singola e renderizzati in PNG per il
  controllo visivo;
- suite complete: test frontend, test Rust, build di produzione e Clippy senza warning.

I campioni usati per la QA vengono generati soltanto nella cartella temporanea e non fanno parte
degli artefatti versionati.
