# FASE 13 — Bollettazione automatica dai file del laboratorio

> Stato: **completata il 1 agosto 2026**.
>
> Dipendenze: flussi esistenti di Produzione e Spedizioni, numeri lotto per riga, modale
> `Crea spedizione`, Spotlight e gate premium.
>
> Verifica: parser collaudato in sola lettura sui tre file reali (40, 14 e 108 righe valide),
> fixture anonime, suite Rust/frontend, build, formattazione e lint.

## 1. Obiettivo

La FASE 13 introduce una bollettazione guidata a partire dai file `.xlsx` inviati dal
laboratorio. L'operatore può selezionare più file, controllare gli abbinamenti proposti e:

- segnare i vaccini come **arrivati in Italia**;
- oppure preparare la loro spedizione nel modale **Crea spedizione**, già compilato.

La funzione deve riusare esclusivamente ordini, clienti, medici, prodotti e campi già presenti.
Non crea nuove anagrafiche, nuovi ordini o nuovi tipi di prodotto.

Il flusso è locale, deterministico e sempre sottoposto a revisione. I file non vengono copiati
nei dati condivisi, nei backup o nella cartella OneDrive.

## 2. File supportati

La prima versione accetta uno o più file `.xlsx` selezionati insieme tramite il file-picker
nativo.

I tre campioni esaminati sono:

- `Listado Pharmatek 270726.xlsx`;
- `Listado Pharmatek 220726.xlsx`;
- `Listado Italia 180326.xlsx`.

Sono presenti due tracciati compatibili:

| Campo | File recenti | File storico | Uso |
|---|---|---|---|
| Lotto vaccino | `Referencia` | `Referencia` | Salvato come numero lotto della riga |
| Data sorgente | `FechaPedido` | `Fecha Envío` | Mostrata soltanto per controllo |
| Scadenza | `FechaCaducidad` | — | Mostrata soltanto per controllo |
| Stato laboratorio | — | `Estado` | Controllo della riga |
| Paziente | `Paciente` | `Paciente` | Abbinamento con paziente/cliente |
| Medico | `Doctor` | `Doctor` | Conferma dell'abbinamento |
| Trattamento | `Tratamiento` | `Tratamiento` | Prodotto, formulazione e posologia |
| Modalità | `Treatment Mode` | `Treatment Mode` | Informazione visibile, non salvata |
| Quantità | `Cantidad` | `Cantidad` | Controllo delle unità |
| Fiale | `Vials` | `Vials` | Scelta del prodotto esistente |
| Composizione | `DescripcionCompleta` | `DescripcionCompleta` | Allergeni e ceppi |

Il parser:

- individua le colonne dal nome, senza dipendere dalla loro posizione;
- ignora righe vuote, `Total` e la riga finale `Filtros aplicados`;
- conserva `Referencia` come testo, inclusi gli zeri iniziali;
- continua con gli altri file quando un singolo file non è leggibile, mostrando l'errore;
- blocca il flusso soltanto se nessun file contiene righe valide;
- non modifica mai i file originali.

Quando `Estado` è presente, `Fabricada` e `Facturado` sono considerati compatibili. Un valore
diverso porta la riga fra quelle **Da controllare**.

## 3. Compilazione dei campi esistenti

### 3.1 Numero lotto

`Referencia` viene proposto in `riga_ordine.numero`.

Il valore resta una stringa. I riferimenti numerici che rispettano il formato Laboratorio vengono
normalizzati in modo conservativo (per esempio `05080720` → `5080720` e `0581348` → `5081348`):
il valore originale resta disponibile nell'avviso mostrato all'operatore. I riferimenti non
riconoscibili restano invariati.
Se la quantità della riga ordine è maggiore di uno, resta valida la regola esistente di un numero
lotto per ogni unità, separato da newline.

Se `Cantidad` è maggiore di uno e il file non fornisce un riferimento per ciascuna unità, la riga
non può essere confermata automaticamente.

### 3.2 Prodotto

Il nome commerciale e `Vials` vengono ricondotti al catalogo Immunoterapia esistente:

| Trattamento del laboratorio | Prodotto del gestionale |
|---|---|
| `BELTAVAC …` | `Polimerizzato N fiala/fiale` |
| `BELTAVAC … PRO2` | `Polimerizzato PRO` |
| `BELTAORAL …` | `Sublinguale N fiale` |
| `BELTAORAL … PRO2` | `Sublinguale PRO` |
| `VEB …` | `Lisato batterico N fiale` |

`N` deriva da `Vials`, non da `Cantidad`.

Se famiglia o numero di fiale non corrispondono a un prodotto esistente, il sistema non crea un
nuovo prodotto: la riga passa fra quelle **Da controllare**. Se manca il prodotto PRO, viene
proposta la variante standard disponibile, ma l'associazione resta obbligatoriamente da verificare.

### 3.3 Formulazione e posologia

La formulazione viene ricavata dalle parole già presenti nel trattamento:

- `Polimerizado` → `polimerizzato`;
- `Depot` → `depot`;
- `Spray` → `spray`;
- BELTAORAL senza `Spray` → `gocce`;
- VEB `NasaleOrale` → `nasale`;
- VEB sublinguale senza `Spray` → `gocce`;
- VEB `Sottocutanea` → `VEB sottocute`.

La sequenza posologica viene letta soltanto quando è chiaramente separata dal nome commerciale:

- `2,2` → `2+2`;
- `3,3` → `3+3`;
- `2,2,2` → `2+2+2`;
- `1,2,3,3` → `1+2+3+3`;
- `3` → `3`.

Sigle come `PRO2`, `PRO3`, quantità in ml e diciture `1 Vial`/`2 Viales` non sono interpretate
come posologia.

### 3.4 Allergeni e ceppi

`DescripcionCompleta` viene divisa sul carattere `|`. Per ogni elemento:

1. si rimuovono percentuale e parola `polimerizado`;
2. si normalizzano accenti, spaziatura e abbreviazioni;
3. si cerca il nome equivalente nel catalogo e nello storico degli allergeni/ceppi;
4. se non esiste un equivalente sicuro, si conserva il nome ripulito come tag libero.

Alias ricorrenti come `Derm. farinae`, `Dermatophagoides farinae`, `Gramíneas espontáneas`,
`Olea europaea`, `Gato` e `Perro` vengono ricondotti ai nomi già usati dal gestionale.

L'ordine degli allergeni viene mantenuto e i duplicati vengono rimossi. Gli allergeni e i ceppi
sono metadati facoltativi: se assenti o non riconoscibili non bloccano l'associazione né la
spedizione. Oltre dieci elementi vengono omessi dalla proposta automatica, lasciando comunque
possibile la revisione dell'ordine e del prodotto.

### 3.5 Dati già compilati

La sorgente Excel non sovrascrive silenziosamente il lavoro dell'operatore:

- campo vuoto → viene proposta la compilazione;
- valore equivalente dopo la normalizzazione → viene mantenuto;
- valore diverso → viene mostrato il confronto **Gestionale / Excel**;
- numero lotto diverso → conflitto obbligatorio da risolvere;
- prodotto incompatibile → nessun abbinamento automatico.

Per ogni conflitto l'operatore sceglie **Mantieni il gestionale** oppure **Usa il file**.

`INICIO/CONT.`, `FechaPedido`, `Fecha Envío`, `FechaCaducidad` e lo stato del laboratorio
rimangono informazioni di controllo: non esistono campi equivalenti da compilare sulla riga
d'ordine.

## 4. Abbinamento con gli ordini

### 4.1 Candidati

L'abbinamento considera soltanto:

- ordini esistenti non rifiutati o annullati;
- righe Immunoterapia;
- righe non ancora spedite.

Le righe già spedite partecipano soltanto al controllo dei riferimenti già registrati.

Il paziente del file viene confrontato prima con `riga_ordine.paziente` e, se questo è vuoto, con
il nome del cliente dell'ordine.

### 4.2 Normalizzazione e punteggio

Il confronto è locale e deterministico:

- rimuove accenti, titoli, punteggiatura e spazi doppi;
- non distingue maiuscole e minuscole;
- tollera l'ordine invertito di nome e cognome;
- usa similarità per token, trigrammi e distanza Damerau-Levenshtein;
- usa paziente/cliente come segnale principale;
- usa medico, famiglia del prodotto e numero di fiale come conferme; il medico può corrispondere
  anche per cognome o iniziale;
- considera allergeni e ceppi metadati facoltativi, non vincoli di associazione.

Pesi del punteggio:

| Segnale | Peso |
|---|---:|
| Paziente o cliente | 45% |
| Medico | 30% |
| Prodotto e numero di fiale | 15% |
| Formulazione e posologia | 10% |

Un abbinamento è automatico soltanto quando:

- la somiglianza del paziente è almeno `0,86`;
- la somiglianza del medico compatibile è almeno `0,55`;
- il prodotto del catalogo è esatto (famiglia e numero di fiale coerenti);
- il punteggio complessivo è almeno `0,80`;
- supera la seconda alternativa di almeno `0,10`.

Negli altri casi l'operatore deve scegliere.

### 4.3 Assegnazione globale

Gli abbinamenti vengono risolti sull'intero gruppo di file, non riga per riga in modo isolato.
Una riga ordine non può essere assegnata a due riferimenti diversi.

Quando più righe del file sono indistinguibili e il gestionale contiene lo stesso numero di righe
con paziente, medico, prodotto e ordine compatibili, il resolver verifica la cardinalità del gruppo
e assegna le righe in modo deterministico. Queste righe sono equivalenti dal punto di vista della
spedizione: l'eventuale scambio fra i loro lotti non cambia ordine o prodotto. Un gruppo con
alternative su ordini diversi o con cardinalità diversa resta **Da controllare**.

Questo permette di distinguere correttamente:

- più vaccini dello stesso paziente;
- più righe dello stesso ordine;
- omonimi;
- stesso paziente e medico con prodotti o allergeni diversi.

Riferimenti identici presenti più volte:

- dati identici → una sola proposta, le altre occorrenze sono **Già registrate nel gruppo**;
- dati diversi → conflitto da risolvere;
- riferimento già salvato sulla stessa riga → **Già registrato**;
- riferimento già salvato su un'altra riga → conflitto bloccante;
- riferimento appartenente a una riga già spedita → escluso come **Già spedito**.

## 5. Esperienza utente

### 5.1 Accessi

Nella vista **Spedizioni → Da spedire**, il pulsante **Bollettazione automatica** compare accanto
a **Crea spedizione**.

- Con premium attivo apre il selettore multiplo `.xlsx`.
- Senza premium resta visibile e usa il paywall già esistente.
- Quando le azioni si sganciano durante lo scroll, nella pill sticky rimane soltanto
  **Crea spedizione**.

Non viene cambiato il componente `Pagina` né il comportamento dell'animazione sticky: il pulsante
secondario viene escluso dalla sola presentazione agganciata tramite uno stile circoscritto alla
pagina Spedizioni.

Spotlight espone **Bollettazione automatica** soltanto quando il premium è caricato e attivo.
Il comando porta alla vista **Da spedire** e avvia il selettore dalla finestra principale.

### 5.2 Revisione

Dopo la lettura dei file si apre un modale coerente con quelli esistenti: corpo scrollabile,
footer fermo, controlli Mantine condivisi e nessun dialogo nativo oltre al file-picker.

La testata mostra quattro gruppi semplici:

- **Pronti**: associazione sicura e nessun conflitto;
- **Da controllare**: alternativa vicina, quantità anomala o campo differente;
- **Non trovati**: nessuna riga ordine compatibile;
- **Già registrati**: riferimento già presente o duplicato.

Ogni elemento mostra soltanto le informazioni necessarie:

- riferimento;
- paziente;
- medico;
- trattamento;
- ordine e riga proposti;
- motivo sintetico dell'abbinamento o del problema.

Per **Da controllare** e **Non trovati** sono disponibili:

- le migliori alternative con ordine, paziente, medico e prodotto;
- una ricerca fra le righe Immunoterapia ancora spedibili;
- **Associa**;
- **Salta questa riga**.

Non è possibile proseguire finché ogni riga incerta non è stata associata o saltata
esplicitamente. Le righe già registrate restano informative e non vengono applicate di nuovo.

### 5.3 Date

La data proposta è quella odierna:

- **Data arrivo** nel modale di revisione;
- **Data spedizione** nel modale esistente di creazione.

Entrambe restano modificabili. Le date contenute nei file non modificano automaticamente questi
valori.

## 6. Esiti

### 6.1 Segna come arrivati

L'azione:

1. salva lotto, prodotto e dettagli di trattamento confermati;
2. imposta `stato_produzione = arrivato_it` sulle righe;
3. registra `data_arrivo_it` secondo le regole esistenti;
4. ricalcola lo stato dell'ordine dalla situazione di tutte le sue righe.

Se arriva solo una parte dell'ordine, questo resta **In produzione**. Quando tutte le righe sono
arrivate diventa **Arrivato IT**.

Al termine viene mostrato un riepilogo con righe aggiornate, saltate, non trovate e già
registrate.

### 6.2 Prepara spedizione

L'azione non salva immediatamente. Apre **Crea spedizione** con:

- soli ordini contenenti righe abbinate;
- sole righe importate già selezionate;
- altre righe dello stesso ordine escluse per impostazione iniziale;
- numeri lotto già compilati;
- prodotto e trattamento confermati conservati nella precompilazione;
- data odierna proposta;
- normali valori di destinatario, corriere, colli, preavviso, pagamento e note.

Le unioni di più ordini dello stesso cliente continuano a funzionare come oggi.

Arrivo, dettagli dei vaccini e spedizioni vengono registrati soltanto premendo
**Crea spedizione**. Chiudere il modale annulla l'intera preparazione senza modificare dati.

Dopo il salvataggio restano invariati:

- eventi di aggiornamento;
- passaggio alla vista **Effettuate**;
- apertura e lampeggio del nuovo gruppo;
- offerta della distinta;
- animazione **Spedito!**;
- ricalcolo di stato ordine, scadenze e chiusura automatica.

## 7. Contratti applicativi

Non vengono aggiunte entità o colonne al modello dati.

### 7.1 Analisi

Nuovo comando premium, senza mutazioni:

```text
bollettazione_analizza(paths: string[]) -> {
  files
  rows[] {
    source
    reference
    rawReference?
    referenceWarning?
    source_data
    normalized_treatment
    status
    selected_match?
    alternatives[]
    proposed_fields
    conflicts[]
    expected_order_revision?
    expected_row_revision?
  }
  totals
}
```

Il comando:

- verifica il premium prima di leggere i file;
- usa il parser Excel Rust già disponibile;
- legge la proiezione locale per candidati e riferimenti esistenti;
- non emette eventi;
- non conserva percorsi o contenuti dopo la risposta;
- non inserisce nomi dei pazienti nei log tecnici.

### 7.2 Conferma

Un solo comando premium applica l'esito scelto:

```text
bollettazione_conferma {
  mode: arrivato_it | spedizione
  data_arrivo
  rows[] {
    source_reference
    row_id
    order_id
    expected_row_revision
    expected_order_revision
    accepted_fields
  }
  shipments[]? {
    data
    corriere_id
    colli
    peso
    servizi
    preavviso
    mezzo
    contrassegno
    note
    row_ids
  }
}
```

Prima di scrivere, il backend ricontrolla:

- premium;
- revisioni di ordine e riga;
- esistenza e stato degli ordini;
- riga non già spedita;
- numero lotto non assegnato altrove;
- un solo uso per riga;
- validità del corriere e dei dati di spedizione;
- un lotto per ogni unità quando la quantità è maggiore di uno.

Il batch è tutto-o-niente: un conflitto concorrente richiede di ricaricare l'analisi e non lascia
spedizioni parziali. Il comando riusa le stesse regole del dominio Spedizioni, invece di
duplicarle.

`Referencia` è la chiave di idempotenza operativa: reimportare lo stesso file non crea una seconda
spedizione e non assegna lo stesso numero a un'altra riga.

### 7.3 Integrazione del modale

`CreaSpedizioneModal` riceve una precompilazione opzionale della bollettazione. Nel flusso normale
continua a usare `spedizione_crea` senza cambiamenti visibili; nel flusso automatico prepara
l'intero payload per `bollettazione_conferma`.

La pagina usa lo stesso callback `onDone` attuale, così il riconoscimento del nuovo lotto di
spedizione e la fioritura restano governati dal codice esistente.

## 8. Matrice premium

| Superficie | Premium attivo | Premium non attivo |
|---|---|---|
| Pulsante accanto a Crea spedizione | Funzionante | Visibile, apre il paywall |
| Pulsante nella pill sticky | Nascosto | Nascosto |
| Comando Spotlight | Visibile | Nascosto |
| Analisi Excel | Consentita | Rifiutata |
| Conferma arrivo/spedizione | Consentita | Rifiutata |

La UI non è una barriera di sicurezza: entrambi i comandi verificano il gate premium.

## 9. Fette di implementazione

### 13A — Contratto Excel

- parser dei due tracciati;
- selezione multipla;
- righe speciali e file non validi;
- conservazione dei riferimenti testuali.

### 13B — Trattamenti

- famiglie e numero di fiale;
- formulazione e posologia;
- allergeni, ceppi e alias;
- confronto con dati già compilati.

### 13C — Matching

- normalizzazione dei nomi;
- ranking spiegabile;
- assegnazione globale uno-a-uno;
- duplicati, conflitti e riferimenti già registrati.

### 13D — Revisione

- modale con i quattro gruppi;
- alternative e ricerca manuale;
- scelta dei conflitti;
- riepilogo dei file e delle righe saltate.

### 13E — Applicazione

- modalità **Segna come arrivati**;
- precompilazione di **Crea spedizione**;
- conferma atomica;
- revisioni concorrenti e idempotenza.

### 13F — Premium e integrazione

- paywall nella pagina;
- esclusione dalla pill sticky;
- comando Spotlight solo premium;
- conservazione del flusso e delle animazioni esistenti.

### 13G — Hardening

- test frontend e Rust;
- accessibilità, responsive e motion ridotta;
- file grandi e più file insieme;
- privacy dei dati sanitari;
- documentazione funzionale dopo l'implementazione.

## 10. Verifiche

### 10.1 Parser

- i tre campioni producono rispettivamente 40, 14 e 108 righe valide;
- entrambi i tracciati vengono riconosciuti;
- `Total`, filtri e righe vuote sono ignorati;
- riferimenti numerici correggibili vengono normalizzati conservando originale e avviso;
- un file guasto non elimina i risultati degli altri file;
- i file sorgente non vengono modificati o copiati.

I test automatici usano fixture sintetiche e anonime: i file reali e i nomi dei pazienti non
entrano nel repository.

### 10.2 Conversioni

- BELTAVAC, BELTAORAL e VEB scelgono la famiglia corretta;
- `PRO2` cerca rispettivamente `Polimerizzato PRO` o `Sublinguale PRO`, con fallback standard
  soltanto da verificare;
- VEB `Sottocutanea` produce la formulazione `VEB sottocute`;
- `Vials` sceglie il prodotto senza cambiare `qta`;
- `2,2`, `2,2,2` e `1,2,3,3` diventano posologie con `+`;
- `PRO2`, `PRO3`, ml e numero di fiale non diventano posologie;
- percentuali e suffissi vengono rimossi dagli allergeni;
- allergeni e ceppi mancanti non impediscono l'associazione;
- alias noti vengono normalizzati e termini nuovi restano tag liberi;
- un valore esistente diverso genera un conflitto e non viene sovrascritto.

### 10.3 Matching

- nome esatto, nome invertito, accenti e refusi di vocale/consonante;
- paziente simile confermato da medico e prodotto;
- medico discordante;
- omonimi;
- più vaccini dello stesso paziente;
- prodotti e allergeni differenti nello stesso ordine;
- cliente o ordine non trovato;
- quantità multipla senza abbastanza riferimenti;
- assegnazione uno-a-uno sull'intero import;
- gruppi equivalenti con cardinalità verificata e conflitti fra ordini lasciati alla revisione.

### 10.4 Dominio

- reimportazione idempotente;
- riferimento duplicato sulla stessa riga e su righe diverse;
- riga già spedita non riutilizzabile;
- modifica concorrente fra analisi e conferma;
- arrivo parziale e completo;
- annullamento del modale senza scritture;
- conferma multi-collo senza risultati parziali;
- normali ricalcoli di stato, scadenze e chiusura.

### 10.5 UI

- pulsante affiancato a **Crea spedizione**;
- paywall senza premium;
- assenza del pulsante nella pill sticky;
- comando Spotlight soltanto con premium;
- tastiera e focus nel modale;
- layout compatto e responsive;
- motion ridotta;
- animazione sticky, distinta e **Spedito!** invariate.

## 11. Criteri di completamento

La fase è completa quando:

- più file possono essere analizzati insieme senza modificare i sorgenti;
- ogni riga è chiaramente classificata come pronta, da controllare, non trovata o già
  registrata;
- gli abbinamenti automatici sono univoci e quelli dubbi richiedono una scelta;
- nessun cliente, ordine o prodotto viene creato implicitamente;
- lotto, prodotto, formulazione, posologia e allergeni compilano soltanto campi esistenti;
- **Segna come arrivati** aggiorna correttamente righe e ordini;
- **Prepara spedizione** apre il modale esistente con righe e lotti già predisposti;
- annullare prima della conferma non salva nulla;
- reimportazioni e modifiche concorrenti non producono duplicati o spedizioni parziali;
- premium, Spotlight e pill sticky rispettano la matrice prevista;
- la fioritura **Spedito!** e le animazioni esistenti non cambiano;
- test Rust, test frontend, build, formattazione e lint risultano verdi;
- nessun file reale o dato sanitario viene inserito nei log o nel repository.
