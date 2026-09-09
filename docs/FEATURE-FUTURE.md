# Feature future — pila "possibili feature 🤑"

Idee e direzioni emerse durante lo sviluppo. Le FASI 11, 12, 13 e 14 sono ora realizzate; le voci
effettivamente future restano indicate come tali. Quando una funzione non ancora pronta viene
cliccata nella UI, si mostra il modale gag `gagNonDisponibile()` ("Questa funzione non è
disponibile :) 🤑🫰💰").

## Roadmap strutturata — Preventivi e comunicazioni

Le evoluzioni commerciali e operative sono raccolte in quattro piani interni locali:

1. **FASE 11 — Comunicazioni e automazioni multicanale (completata)**:
   configurazione e-mail Aruba e WhatsApp, coda affidabile, modelli, cronologia, invii singoli e
   multipli, solleciti e avvisi di spedizione.
2. **FASE 12 — Preventivi, scheda cliente e documenti intelligenti (completata)**:
   nuova sezione Preventivi fra Giornaliero e Produzione, prezzario condiviso, compilazione da
   testo libero, PDF/immagine in una pagina, scheda cliente, monitoraggio di ultima modifica e
   ultimo invio, invio e sollecito. Ogni preventivo nasce obbligatoriamente da un ordine `Nuovo`
   già registrato nel Giornaliero e non modifica automaticamente lo stato dell'ordine. Il piano
   realizzata è documentata in [`FASE-12.md`](FASE-12.md).
3. **FASE 13 — Bollettazione automatica dai file del laboratorio (completata)**:
   importazione locale e guidata dei file `.xlsx`, normalizzazione dei trattamenti, matching
   globale uno-a-uno con le righe ordine, revisione esplicita dei conflitti e conferma atomica
   dell'arrivo o delle spedizioni. Il piano realizzato è documentato in
   [`FASE-13.md`](FASE-13.md).
4. **FASE 14 — Suggerimenti intelligenti e azionabili (completata)**:
   motore derivato e compatto che ordina azioni utili, evita ripetizioni, collabora fra
   postazioni, apre le schermate corrette e scompare quando il dato sorgente non esiste più.
   Comprende anche rimborsi aperti, distinte di contrassegni/assegni, provvigioni maturate, lotti
   pronti per la produzione, comunicazioni di spedizione e possibili duplicati anagrafici. Il
   piano realizzato è documentato in [`FASE-14.md`](FASE-14.md).

La FASE 11 fornisce il motore comune usato dalla FASE 12; la FASE 13 riusa invece i domini
Produzione e Spedizioni. La FASE 14 usa i dati e le azioni delle fasi precedenti, mantenendo
derivati ranking e ciclo di vita e riusando la deduplicazione già esistente. Le funzioni già
realizzate restano dietro il gate premium locale e sono utilizzabili soltanto sui PC in cui sono
state attivate esplicitamente con `scripts/premium.ps1`.

Decisioni già confermate per la progettazione:

- i prezzi del gestionale sono **IVA inclusa**; i preventivi scorporeranno imponibile e IVA al 10%
  senza aumentare il totale;
- il numero WhatsApp resterà nell'app **WhatsApp per Windows**; non è prevista la migrazione a una
  soluzione Business ufficiale;
- il preventivo è facoltativo, è disponibile per tutte le linee e non possiede stati commerciali
  di accettazione/rifiuto: mostra soltanto l'ultima modifica e l'ultimo invio riuscito;
- prodotti, quantità e prezzi modificati dal preventivo aggiornano anche l'ordine sorgente con un
  unico salvataggio protetto; la fotografia dell'ultimo documento inviato resta immutabile;
- PDF e immagini vengono generati localmente quando servono e non sono salvati nella cartella dati
  condivisa.

> [!IMPORTANT]
> [!NOTE]
> Il gestionale possiede scadenziario, indicatori e notifiche interne per i pagamenti. Le campagne
> multicanale e i solleciti preventivi usano il motore FASE 11: richiedono sempre revisione e
> conferma dell'operatore, senza invii invisibili.

## Ordini / Giornaliero
- **Stati ordine automatici** (nessun intervento manuale): es. registrato l'acconto → *In
  produzione*; passaggio a *Spedito* derivato dall'evasione, ecc. Richiede contabilità (FASE 3) e
  spedizioni (FASE 4).
- **Rateizzi mostrati "carini"**: dato il residuo, chiedere il numero di rate e mostrare in modo
  estetico quante rate pagherà il cliente al saldo (FASE 3).
- **Scadenziario automatico**: generato in base al passaggio dell'ordine allo stato *Spedito*
  (date rate calcolate da lì). (FASE 3)
- **Cronologia solleciti automatica**: invece del vecchio checkbox "Sollecito", una cronologia che
  registra i solleciti e scrive un messaggio nella **cronologia/storico dell'ordine**. Oggi è solo
  la voce "Solleciti" nel menu ⋯ che apre il gag.
- **Cronologia/storico per record** con undo di una singola modifica (capability del motore già
  presente; manca la UI completa — vedi anche 1G-d).

## Provvigioni / Contabilità
- **Maturazione al saldo reale** (FASE 3): oggi la provvigione matura sullo **stato** dell'ordine
  (per-agente: alla spedizione o a ordine chiuso). Quando ci sarà il tracciamento dei pagamenti
  si potrà far maturare alla **riscossione effettiva del saldo** (come da piano FASE-2 originale).
- **Rimborso che storna la provvigione (clawback)** (FASE 3, richiesta utente): quando si registra
  un **rimborso** legato a un ordine la cui provvigione era già maturata/messa in conto:
  - se la provvigione **non è ancora stata liquidata** all'agente → si **adegua in automatico**
    (lo storno entra nella base di calcolo, il report si ricalcola da solo, essendo derivato);
  - se la provvigione è **già stata liquidata/emessa** (servirà uno **stato liquidazione** sulle
    provvigioni, es. "liquidata il …") → **avviso** + **promemoria sull'agente** per recuperare/
    dedurre alla prossima liquidazione. Il promemoria "vero" con notifica dipende dal sistema
    promemoria (**FASE 6**); in FASE 3 si lascia almeno un flag/avviso visibile su rimborso e agente.
  - **Tutto con modali in-app** (servizio `dialog`/`Modal`), mai dialoghi nativi di Windows.
- **Regola modali**: ogni conferma/avviso/form usa il nostro sistema `dialog`/`Modal`. I dialoghi
  **nativi** restano confinati ai soli **file-picker** (`open`/`save` per cartelle/file su disco),
  dove il selettore di sistema è obbligatorio. Garantito anche dalle capabilities (niente
  `dialog:allow-confirm/-message/-ask`).
- **Tab Pagamenti e Rimborsi** dell'hub Contabilità: oggi segnaposto, arrivano in FASE 3.
- **Export provvigioni con anteprima/stampa** (UI-SPEC §14.2): oggi l'export `.xlsx` è diretto
  (save-dialog); l'anteprima con stampa diretta arriverà con gli export dedicati.

## Giornaliero unificato per linea (FASI 4–5)
- **Una sola vista Giornaliero per tutte le linee** (Immunoterapia / Diagnostica / Keriba): le
  "linee" Diagnostica (FASE 4) e Keriba (FASE 5) **non** sono sezioni separate ma confluiscono nel
  **Giornaliero**, con un **filtro per linea multi-selezione** (tutto, oppure 2, oppure 1). I
  campi/processi specifici di ogni linea (Diagnostica: cassetta/prick test/valore prod-vendita;
  Keriba: preventivo/esito) restano nelle rispettive fasi, ma il **browsing è unificato**.

## Spedizioni & stato ordine (FASE 4) — da studiare bene (utenti non esperti)
- **Raggruppamento colli + numerazione CORRIERE_B/CORRIERE_A**: studiare `File GENERALE 2025.xlsm`
  (foglio giornaliero) per capire come funziona il raggruppamento dei colli e la numerazione per
  CORRIERE_B e CORRIERE_A **al momento dell'aggiunta in bulk**, e replicarla fedelmente. Per questo i campi
  corriere/colli/peso sono stati tolti dall'inserimento ordine: si impostano dopo, in spedizione.
- **UX guidata e a prova di errore**: chi userà il programma non è esperto. Il flusso di
  spedizione e la **gestione/aggiornamento dello stato ordine quando ci sono intoppi** (merce non
  arrivata, parziali, resi, problemi) vanno studiati col cliente e resi **guidati a step**, con
  azione successiva suggerita, stati chiari, conferme e undo.

## CRM / note (TAGLIATO da FASE 6, → futuro)
- **Note / conversazioni a thread** per entità (ordine/medico/cliente/agente): thread cronologico,
  risposte annidate, categorie. **TAGLIATO da FASE 6** (giugno 2026, scelta utente): al loro posto
  i **promemoria collegabili** alle anagrafiche/ordini. Da valutare in futuro se serviranno davvero.
- **Allegati** (immagini/file) sulle note/entità in `PharmaTek-Data/allegati/`: rimandati anche per
  non appesantire la sync OneDrive coi binari (servirà un limite dimensione/tipi).
- **@menzioni** come sistema dedicato (autocompletamento + notifica al citato). In FASE 6E si può
  comunque **indirizzare un messaggio** a un utente; le menzioni "vere" dentro un testo → futuro.
- **Cronologia / storico incident** (problemi nel tempo): TAGLIATA da FASE 6. In FASE 6 resta lo
  **storico "cose fatte"** (attività derivata dal log con operatore + compattazione), non un
  registro di incident.

## Sistema, notifiche & animazioni (FASI 6–7)
- **Integrazione sistema — FATTA in FASE 6A** (giugno 2026, non committata): **istanza singola**,
  **traybar** (menu Apri/Esci + click→primo piano + `tray_badge`), **avvio automatico** (toggle
  Impostazioni, flag `--minimized`), **X→traybar** quando l'autostart è attivo (avviso la prima
  volta), **hotkey globale** (`Alt+P` default, configurabile, fallback se in conflitto; in app
  resta `Ctrl+K`). Da verificare dal vivo.
- **Notifiche custom overlay (→ FASE 7)**: overlay **sempre in primo piano**, **animate** e con
  **suono**, urgenti (rimborsi/solleciti) con pulsazione. **Spostate alla FASE 7** (giugno 2026):
  in FASE 6 le notifiche stanno nel **pop-over campanella + balloon dalla tray**; l'overlay "fico"
  è lo stesso framework di animazione della FASE 7.
- **Animazioni (FASE 7)**: set ricco ed estetico di micro-interazioni e set-pieces
  (impacchettamento con nome corriere, notifiche rimborso, transizioni di stato, saldo, ecc.),
  performanti e disattivabili.

## Snapshot e log eventi (vedi `COMPATTAZIONE.md`)
- **FATTO**: snapshot per dispositivo con segnalibri (offset), fusi per campo al bootstrap;
  retention di 3 snapshot per dispositivo.
- **Scelta di affidabilità**: i log operativi restano completi e append-only. I lettori robusti
  allo shrink e la ricostruzione da snapshot restano disponibili soltanto per dataset legacy.
- **FATTO**: `applied_events` è una cache locale potata; l'idempotenza persistente deriva dai
  clock HLC per campo e dalle tombstone terminali.

## Backup (rifiniture)
- **Backup automatico — FATTO**: check all'avvio (`Shell`), se l'ultimo backup è più vecchio
  della soglia esegue un backup (con snapshot e log completi). Configurabile in
  Impostazioni→Backup (Mai / Giornaliero / Settimanale, pref `backupAuto`, default settimanale).
- **Scelta cartella — FATTO**: "Salva copia…" usa il file-picker nativo.
- **Promemoria** "non fai un backup da N giorni" (banner/toast discreto) — *ancora da fare*
  (oggi, se attivo l'auto-backup, il problema non si pone; utile se l'utente lo tiene su "Mai").
- **Pulizia manuale** snapshot/backup dalla UI e retention configurabile in Impostazioni —
  *ancora da fare* (oggi la retention è automatica: snapshot 3, backup 10 per dispositivo).

## Inserimento dati guidato (FASE 9)
- **Modalità guidata** per non esperti: scegli **persona** → scegli **azione** (nuovo ordine,
  nuova spedizione, rimborso, pagamento, stato spedizione, nuova informazione/conversazione) →
  form giusto pre-compilato. **Super animata** (l'icona-azione corre verso un sobbalzo, si
  ingrandisce, si trasforma nel form), riusando form/logica già esistenti. Richiamabile da
  "+ Registra" e dalla ricerca globale (Ctrl+K / Alt+P).

## Anagrafiche smart (FASE 8)
- **Calcolo automatico del Codice Fiscale** (persone fisiche) da nome/cognome/nascita/comune,
  con validazione del CF incollato. Dataset comuni (Belfiore) **offline**. Deve essere **super
  estetico e funzionale**, senza rompere la coerenza visiva; sempre sovrascrivibile a mano.
- **Auto-compilazione CAP ↔ città / provincia / regione** (offline): riempie quando la
  corrispondenza è univoca, **suggerisce** quando il CAP è ambiguo. Anche il viceversa.

## Altro
- Apertura **diretta** del singolo record dalla palette Ctrl+K (deep-link in Giornaliero/Anagrafiche),
  invece di portare solo alla sezione.
- Pre-scaldare la finestra ordine (o pool) per renderla istantanea, se la modale non basta.
