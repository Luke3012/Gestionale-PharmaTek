# Modello dati

Riferimento per le entità del gestionale. I tipi sono indicativi; gli importi monetari sono
sempre **interi in centesimi** (EUR), gli ID sono **ULID**.

## Utenti / Identità

Registro condiviso degli utenti come entità `user` nel log eventi, distinto dai dispositivi
(`device`). Non esistono `meta/users.json` o `meta/devices.json` riscritti in comune: in `meta/`
restano solo file operativi/binari, come `avatars/` e `locks/`.

### Utente
`id, nome, avatar { tipo: preset | custom | iniziali, valore }, creato_ts`
- `preset` → id di un avatar **bundlato** con l'app (offline-safe).
- `custom` → immagine caricata (PNG/JPG, crop ~256×256) salvata in `meta/avatars/<userId>.png`
  così l'avatar è visibile agli altri PC nella panoramica sync e nei messaggi.
- `iniziali` → iniziali su colore generato dal nome (fallback).

Un nome utente già presente non viene duplicato: in onboarding si sceglie se **usarlo**,
**riconfigurarlo** o **crearne uno nuovo**.

### Dispositivo
`id, nome, user_id, registrato_ts`
- `id` = `deviceId` persistente locale in `%APPDATA%`.
- `user_id` collega quel PC al profilo utente scelto nell'onboarding.

### Reset nascosto e ritiro PC

Il modale nascosto di reset espone sempre quattro azioni operative:

- **Riconfigura questo PC**: reset leggero. Mantiene lo stesso `deviceId` e lo stesso
  `events/<deviceId>.ndjson`; rimuove `user`, stati e avatar soltanto se il profilo non è condiviso
  con un'altra postazione attiva, svuota sempre `device.user_id`, elimina l'intera `app_data_dir`
  locale e torna direttamente all'onboarding. I dati di lavoro non vengono toccati e il device
  resta nascosto dalle liste operative finché il nuovo onboarding non collega un utente valido;
  continua invece a comparire nella lista amministrativa dei PC ritirabili.
- **Ritira un PC**: sceglie un dispositivo da lista scrollabile, incluso quello corrente, e lo
  chiude definitivamente. Il backend emette `device_retired`, cancella il record `device` e,
  soltanto se nessun altro device attivo usa il profilo, anche `user`, stati utente e avatar;
  salva snapshot e backup `ritiro-pc`, poi rimuove
  `events/<deviceId>.ndjson`, eventuali conflicted copy e `snapshots/<deviceId>-*.json`.
- **Ottimizza database**: dopo coordinamento e backup completo crea un anchor con record, clock e
  watermark correnti; rimuove da quell'anchor tutte le tombstone `purged`, azzera offset/applied e
  pubblica cutoff generazionali prima di cancellare i log storici. I record soft-deleted restano
  ripristinabili, mentre eventi vecchi o conflicted copy non possono superare la barriera.
- **Reset completo**: cancella dati applicativi condivisi e `app_data_dir`, poi riparte con
  configurazione vergine senza mostrare una falsa sessione invalida. Subito dopo il wipe crea un
  dataset minimo contenente soltanto `device_retired` per tutti i device pre-reset, con relativo
  log/snapshot di barriera.

Un PC ritirato non può tornare con lo stesso `deviceId`: se è online, al marker di rebuild vede il
proprio id in `device_retired`, azzera la configurazione locale, genera un nuovo `deviceId` e torna
all'onboarding. Il sync ignora gli eventi tardivi dei dispositivi ritirati. Lo storico completo resta
nel backup; lo stato operativo resta nello snapshot aggiornato. Vedi anche `COMPATTAZIONE.md`.
La barriera viene verificata nuovamente durante l'apertura cartella e alla conferma dell'onboarding,
così un ritiro sincronizzato in quel preciso intervallo non può registrare la nuova sessione nel log
del vecchio dispositivo.

Le API usate dalle liste operative espongono soltanto utenti collegati ad almeno un device attivo;
profili orfani o risorti senza postazione non tornano quindi in onboarding, destinatari e bacheche.

Il profilo `user` è condiviso e può essere associato a più record `device` tramite onboarding
**Usa questo utente**. Il ritiro di un device conserva il profilo finché almeno un'altra postazione
attiva usa lo stesso `user_id`; viene eliminato soltanto con il ritiro dell'ultima postazione.

La distinzione di bootstrap non è un dato di dominio:

- cartella non leggibile → `data_dir_status = missing_or_empty`, configurazione conservata;
- identità assente in dati leggibili o device ritirato → `reconnect_required`, pulizia locale;
- primo avvio/reset volontario → onboarding diretto.

La panoramica sincronizzazione elenca esclusivamente record `device` attivi. I watermark HLC
servono solo a calcolare l'ultima attività: un autore orfano proveniente da un vecchio log non può
diventare una postazione con nome tecnico/ULID.

## Anagrafiche

### Agenti
`id, nome, regola_provvigione { tipo: fisso | percentuale, valore }, acconto_default?, conto_saldo_id?`
La provvigione si calcola sull'**importo (totale) dell'ordine** (vedi FASE 2). `acconto_default`
(per prodotto) e `conto_saldo_id` fanno da **fallback** quando il medico non li specifica.

### Medici
`id, nome, agente_id, conto_saldo_id?, rate_saldo_default?`
Ogni medico ha un **agente fisso**: scelto il medico su un ordine, l'agente si auto-compila.
`rate_saldo_default` è il numero di rate con cui nasce il saldo degli ordini di Immunoterapia
(default effettivo `1`). Vale soltanto quando viene creato un nuovo piano standard: rateizzazioni
manuali, incassi e piani già presenti non vengono sostituiti.

> **Conto di saldo preferito (agente/medico)** — decisione utente, giugno 2026. `conto_saldo_id`
> opzionale su agente e su medico: quando si registra/salda un pagamento, il conto si
> **auto-compila** con priorità *medico → agente → `predefinito_acconti` (per gli acconti) →
> `predefinito_incassi`* (fallback globale → primo conto bancario). Resta sempre modificabile. È una
> preferenza universale (campo del record), non per-utente. Vedi `contoPreferito.ts`.

### Clienti
`id, nome, indirizzo, citta, prov, cap, regione, telefono, email, cf, aruba_esportato_il?, aruba_cf_esportato?, aruba_ricandidato_il?`
È il destinatario/paziente finale (l'Excel lo chiama CLIENTE, distinto dal MEDICO).
`aruba_esportato_il` e' un timestamp ISO opzionale e sincronizzato: viene impostato solo dopo un
export Excel Aruba riuscito. Se manca, il cliente resta nella coda Aruba; quindi un cliente prima
escluso per CF mancante torna esportabile quando il CF viene compilato.
Quando un CF viene inserito o cambia davvero, `aruba_esportato_il` viene azzerato e
`aruba_ricandidato_il` registra la ricandidatura. Quest'ultimo evita che la migrazione del vecchio
cutoff locale scambi per gia' esportato un cliente aggiornato poco prima della prima apertura Aruba;
dopo l'export riuscito viene svuotato.
`aruba_cf_esportato` conserva il CF reale usato nel file (vuoto per un CF provvisorio): un marcatore
di export concorrente o arrivato in ritardo vale soltanto se questo snapshot coincide ancora col CF
corrente. I marker legacy senza snapshot restano validi per compatibilita'.

### Prodotti (listino)
`id, nome, categoria, prezzo_base_default`
Categoria ∈ { Immunoterapia, Diagnostica, Keriba, … } (la categoria "principale", ex
"Standard", si chiama **Immunoterapia**). La categoria incide su prezzo, produzione e spedizione.
Il catalogo Immunoterapia contiene solo le preparazioni valide (7 voci). I vecchi allergeni
builtin vengono purgati mantenendo il loro nome come testo libero nelle righe storiche.
`Sublinguale 1 fiala`, rimosso dal catalogo, viene migrato insieme alle relative regole e righe
verso il prodotto esistente `Sublinguale 2 fiale`.

### Conti
`id, nome, banca, iban, tipo: banca | contrassegno | assegno, builtin: bool,
predefinito_incassi: bool, predefinito_acconti: bool, predefinito_accrediti: bool` — configurabili.
- I conti **reali** (`tipo = banca`) sono liberamente gestibili. Default importati dal File
  GENERALE: `1243, POSTE 2163, BANCA DEMO, 8376-CRE, 9438-MIX`.
- Due **conti speciali built-in non eliminabili** (`builtin = true`): **Contrassegno**
  (`tipo = contrassegno`) e **Assegno** (`tipo = assegno`). Sono conti **di transito**: un
  pagamento riscosso in contrassegno (dal corriere) o con assegno ci entra e resta
  `in_attesa_accredito` finché il corriere non versa il cumulativo (→ **DistinteCorriere**,
  FASE 3C) o l'assegno non è effettivamente incassato. Vengono creati automaticamente con id
  fissi (`__contrassegno__`, `__assegno__`) → conflict-free fra dispositivi.
- `predefinito_acconti`: conto proposto per gli **acconti** (se medico/agente non ne hanno uno);
  se vuoto ricade su `predefinito_incassi`. Si imposta da **⚙️ Preferenze conti**.
- `predefinito_incassi`: conto proposto di default quando si salda un pagamento (tipicamente `8376`);
  uno solo lo porta. `predefinito_accrediti`: conto su cui si registrano i bonifici cumulativi
  dei corrieri (FASE 3C). Si impostano dalla rotella **⚙️ "Preferenze conti"** nell'anagrafica
  Conti. **Sono universali** (salvati come campi del record `conto`, condivisi nel DB), **non**
  preferenze per-utente (quelle stanno in Impostazioni).

### Corrieri
`id, nome, conto_incasso_id?` — es. CORRIERE_B, CORRIERE_A. Configurabili.
- `conto_incasso_id`: conto su cui il corriere versa i bonifici cumulativi dei contrassegni
  (proposto di default quando si registra una **DistintaCorriere** di quel corriere; se vuoto si
  ricade su `predefinito_accrediti`). Vedi FASE 3C.
- **Stabilità storica del conto** (decisione utente, giugno 2026): cambiare `conto_incasso_id`
  vale **solo per le distinte future**. Le distinte/accrediti già registrati conservano il conto
  con cui sono stati accreditati, perché `DistintaCorriere.conto_id` è una **fotografia** del conto
  al momento dell'accredito, non un riferimento vivo all'anagrafica. Nessun ordine già accreditato
  viene "spostato" sul nuovo conto.

## Listino / motore prezzi

### RegolePrezzo
`id, prodotto_id?, categoria?, agente_id?, medico_id?, prezzo`
Risoluzione **"più specifica vince"**:
`medico+prodotto → agente+prodotto → categoria → prodotto.default → manuale`.
Il prezzo risolto è un **suggerimento sempre modificabile** sull'ordine.

## Ordini (testata + righe)

### Ordini (testata)
`id, numero, numero_provvisorio: bool, data, medico_id, agente_id (derivato), cliente_id,
stato, stato_pagamento? (override, "" = automatico), acconto (= acconto previsto, cent),
numero_fattura? (registrazione opzionale), sollecito: bool, note, dati_fatturazione?,
totale (derivato dalle righe), incassato/residuo (derivati dai Pagamenti)`

`acconto` qui è l'**acconto previsto/concordato** (auto dal medico, editabile, `0` ammesso): è un
*piano*, **non** un incasso. Gli incassi reali sono nel registro **Pagamenti**; `residuo = totale −
incassato`. `stato_pagamento` è l'**override** manuale dello stato pagamento (vedi sopra).

`dati_fatturazione?` (opzionale): `ragione_sociale, indirizzo, citta, prov, cap, piva/cf` —
si compila **solo se diversi** da chi ha effettuato l'ordine. **Se vuoto, in fatturazione/export
si usano automaticamente i dati del cliente** dell'ordine. Per non appesantire la UI è una
sezione **a comparsa** ("Dati di fatturazione diversi?"), nascosta di default, non auto-compilata
dall'indirizzo di spedizione e riaperta automaticamente solo sugli ordini che hanno già dati
fattura salvati.

Stati: `Nuovo → Confermato (acconto) → In produzione → Arrivato IT → Spedito → Saldato →
Chiuso`, più `Rifiutato`. (Nessuno stato/flag "preventivo inviato" — rinviato a sviluppo futuro;
il valore dell'ordine è il `totale` derivato dalle righe, base delle provvigioni.)

**Automazioni di stato** (decise giugno 2026):
- registrato **un pagamento** (tipicamente l'acconto) su un ordine *Nuovo* → passa a *Confermato*
  (FASE 3A);
- **"saldato" NON è uno stato dell'ordine** (rimosso): "incassato tutto" si riflette nello **stato
  pagamento** (`saldato`), non nello stato testata;
- un ordine diventa **Chiuso** automaticamente quando è **Spedito + saldato + sono passati ≥ 20
  giorni** (la data da cui contare i 20 gg si fissa con la FASE 4 spedizioni; automazione in FASE
  3E). Le altre transizioni restano manuali.

`numero`: progressivo **per anno** (es. `2026-0001`). L'ID reale resta l'**ULID** (assegnato
subito, offline-safe). Il numero leggibile è **assegnato in modo deterministico dal fold**
(eventi `order.created` ordinati per HLC → tutti i PC calcolano gli stessi numeri).
Finché il PC è offline il numero è **provvisorio** (`numero_provvisorio = true`) e può
cambiare alla prima sincronizzazione: in caso di collisione vince l'HLC più basso, l'altro
ordine slitta al numero libero successivo. Gli ordini già sincronizzati non si rinumerano.
Vedi `ARCHITETTURA.md`.

Fatturazione: un ordine viene **fatturato solo quando è saldato completamente**, quindi la
fattura è una conseguenza della contabilità, non un dato da inserire a mano sull'ordine. La
**registrazione del numero fattura è opzionale e prevista come funzione futura** (campo
aggiungibile in seguito); il gestionale non genera fatture fiscali.

### RigheOrdine
`id, ordine_id, prodotto_id, qta, prezzo (auto+override), paziente?, dati_produzione?,
stato_riga: da_spedire | spedita, spedizione_id?`
UI a **1 riga di default**; lo schema supporta più prodotti/pazienti per ordine.
**Evasione a livello di riga**: si spedisce **ciò che è disponibile**; le righe ordinate ma **non
arrivate** restano `da_spedire` (per una spedizione successiva, o mai). Un ordine può quindi essere
**parzialmente spedito**: lo stato della testata è derivato — diventa `Spedito` **solo quando tutte**
le righe sono spedite; con una spedizione **parziale** lo stato **non cambia** (resta es. *Arrivato
IT*) — non esiste più uno stato "Parzialmente spedito" (rimosso in FASE 5B: non serviva). Non c'è uno
step separato di "arrivi": i prodotti che arrivano sono semplicemente quelli ordinati.

## Spedizioni & evasione

### Spedizioni (raggruppano righe di uno o più ordini)
`Spedizioni(id, data, corriere_id, numero_spedizione, colli, peso, servizi, note,
dati_dest? (override destinatario/indirizzo/contatti), preavviso, mezzo, contrassegno)`
`SpedizioniRighe(spedizione_id, riga_id)` — le righe spedite insieme.
- Una **spedizione effettuata** = un gruppo di righe (anche di ordini diversi) spedite con un
  corriere in una data. Una riga sta in **una** spedizione (`riga.spedizione_id`).
- I dati destinatario della spedizione possono essere corretti **sul collo già effettuato** tramite
  campi `dest_*` (`dest_cliente`, `dest_indirizzo`, `dest_cap`, `dest_citta`, `dest_prov`,
  `dest_regione`, `dest_telefono`, `dest_email`). Sono override della spedizione: non modificano
  né ordine né anagrafica cliente/medico. Se assenti, il DTO ricade sui dati dell'ordine.
- Il numero/lotto del vaccino resta su `riga_ordine.numero`, anche quando lo si corregge dalle
  spedizioni effettuate: se il collo viene annullato, la riga torna in "Da spedire" con il lotto
  corretto.
- Vista **"Spedizioni effettuate"**: elenco delle spedizioni con il **raggruppamento** delle
  righe/ordini inclusi (vedi UI-SPEC §7.7).
- **Aggiunta rapida riga mancante**: se un prodotto ordinato non era stato inserito nel
  giornaliero, lo si aggiunge al volo qui. Al momento dell'aggiunta si **chiede ogni volta** se la
  riga **incide sul totale** (con prezzo → aggiorna totale/provvigioni/residuo) **oppure no**
  (logistica soltanto, prezzo 0/incluso).

## Pagamenti & contabilità

### Pagamenti (registro unico tipizzato, con stato atteso/saldato)
`id, ordine_id, tipo: acconto | saldo | rata, importo, saldato: bool, scadenza (data prevista),
conto_id, data (data incasso), verificato: bool, distinta_id?, spedizione_id?, note?`
- **Un solo concetto** (refactor giugno 2026): acconto, saldo e rate sono tutti **pagamenti**. Ogni
  pagamento è **atteso** (`saldato = false`, con una `scadenza`) oppure **incassato** (`saldato =
  true`, con `data`/`conto`). **"Salda"** = passare da atteso a incassato. Niente più entità
  `piano_rate`/`rata`: una rata è semplicemente un pagamento `tipo = rata` atteso.
- Il **tipo conta più della posizione**: un primo pagamento riscosso alla consegna è un `saldo`.
  Un **acconto non può essere in contrassegno**: l'assegnazione di un conto di transito (contrassegno
  o assegno) a una voce acconto la converte automaticamente in `saldo` con scadenza alla consegna
  (`scad_da_spedizione = true`, +30gg) e azzera il campo testata `acconto` dell'ordine/preventivo.
- `scadenza` = data prevista dell'incasso (per attesi/solleciti). `data` = data di incasso reale.
- `verificato` = spunta di **prima nota** (solo per i saldati): verde chiaro → verde scuro.
- `distinta_id?` = valorizzato quando un contrassegno/assegno è coperto da una **DistintaCorriere**
  (FASE 3C): a quel punto è "accreditato" sul conto reale.
- `spedizione_id?` = valorizzato quando il pagamento è associato a una specifica spedizione (collo).
  Permette la sincronizzazione bidirezionale 1-a-1: se un ordine ha più colli con contrassegno,
  modificare una rata aggiorna unicamente la spedizione legata, e modificare il contrassegno dal collo
  aggiorna solo la rata collegata senza cancellare o alterare le altre rate dello scadenzario.
  Inoltre, ciascuna rata associata calcola la propria scadenza (+30gg) a partire dalla data di partenza
  della **propria spedizione**, preservando le scadenze dei colli inviati in date differenti.
- **`incassato = Σ pagamenti saldati`**; **`residuo = totale − incassato`** (gli attesi NON incidono).
- **Pagamento pieno (anche con soldi extra)**: quando `incassato ≥ totale` l'ordine è **saldato**
  (per-ordine; il `residuo` può risultare negativo) e i pagamenti **attesi residui vengono rimossi**
  (non restano come crediti fittizi). Vale solo per ordini con totale > 0.
- **Scadenzario automatico e riconciliato**: al primo salvataggio con prodotti si materializzano
  `acconto` (atteso, o saldato se spuntato «già incassato») + `saldo` (atteso, = totale −
  acconto). Se i prodotti/prezzi cambiano in seguito, gli incassi restano intatti e il piano
  aperto conserva tipi, conti, scadenze e proporzioni; viene ridimensionato al nuovo residuo.
  Se manca del tutto una parte aperta, viene creato soltanto il saldo necessario. Un ordine
  salvato senza prodotti resta invece a totale zero e senza crediti finché non viene completato.
  Il campo **acconto previsto** dell'ordine alimenta l'importo dell'acconto atteso, senza
  riscrivere un acconto già incassato.
- **Associazione contrassegno alla spedizione**: se l'ordine contiene più rate (es. 225 € su banca e
  225 € su contrassegno per totale 450 €), la modale di creazione spedizione propone la cifra della
  singola rata a contrassegno (225 €) anziché l'intero totale ordine. Le altre rate aperte rimangono
  intatte nello scadenzario.
- **Rateizza**: divide il `saldo` atteso in N rate attese (parti uguali, l'ultima quadra i centesimi;
  scadenze a cadenza mensile/ogni N giorni). Acconto e pagamenti già saldati restano intatti.
- **Modale pagamento unica**: crea (atteso/incassato), modifica, **Salda**, annulla. Richiamabile da
  Giornaliero, editor ordine e tab Crediti.

### Vista Crediti (Contabilità → Crediti)
Tabella **unica** di tutti i pagamenti (attesi + saldati) con N° ordine/cliente/agente/tipo/importo/
scadenza/incasso/stato/verifica. Filtri agente, conto, periodo, stato (atteso | saldato |
da_verificare). Colonne ordinabili e configurabili (riordino + mostra/nascondi) come il Giornaliero.

### Stato pagamento (dai colori della Legenda Excel) — DERIVATO + override
`da_saldare` (rosso) · `saldato` (verde scuro) · `saldato_da_verificare` (verde chiaro,
da verificare in prima nota) · `da_controllare` (arancione) · `omaggio_sostituzione`
(azzurro Napoli) · `in_attesa_accredito` (azzurrino).

Lo stato **effettivo** = override manuale se impostato, altrimenti **derivato** dai pagamenti:
- `omaggio` sull'ordine → `omaggio_sostituzione`;
- `incassato ≤ 0` oppure parziale (`0 < incassato < totale`) → `da_saldare`;
- `incassato ≥ totale` ma esiste un pagamento su un conto **di transito** (contrassegno/assegno)
  **non ancora accreditato** (`distinta_id` vuoto) → `in_attesa_accredito`;
- `incassato ≥ totale`, non tutti i pagamenti `verificato` → `saldato_da_verificare`;
- `incassato ≥ totale`, tutti verificati → `saldato`.

L'**override** è un campo `stato_pagamento` sull'ordine (`""` = automatico) per forzare in
particolare `da_controllare` o gli stati che la derivazione non può dedurre.

### Rimborsi
`id, data_richiesta, importo, ragione_sociale, motivo, iban, conto_id?, data_rimborso, note,
ordine_id?, origine: manuale | extra`
- `stato` derivato: **richiesto** (manca `data_rimborso`) → **effettuato** (valorizzata).
- **Soldi extra (overpayment)** — decisione utente, giugno 2026. Un ordine può essere pagato in
  eccesso (`incassato > totale` → `residuo` negativo). In quel caso si può generare un rimborso
  **dall'ordine** (`origine = extra`, `ordine_id` valorizzato): l'importo si **pre-compila con
  l'eccesso** (`incassato − totale`) e `ragione_sociale`/`iban` dal cliente dell'ordine. È un
  **flusso in uscita separato**: non altera i pagamenti già registrati né i totali dei Crediti (che
  restano la somma reale incassata). Quando il rimborso è **effettuato**, l'eccesso è "risolto".
  Vedi `IMPLEMENTAZIONE.md` (pulizia attesi + residuo negativo).

**Realizzato (FASE 3D, giugno 2026)** — vedi `IMPLEMENTAZIONE.md`:
- Entità `rimborso` con i campi sopra; `stato` **derivato** (richiesto se `data_rimborso` vuota,
  effettuato altrimenti). **Niente stato "annullato"**: un rimborso non valido si elimina → Cestino.
- `origine` ∈ { manuale, extra }. Il caso **extra** si pre-compila da un ordine in eccesso
  (`rimborso_extra_precompila`) ed è agganciato da Giornaliero, editor ordine, tab Crediti (al posto
  di "Salda" sulle righe di ordini in eccesso) e tab Rimborsi (collegando un ordine).
- Comandi: `rimborsi_lista`, `rimborso_salva`, `rimborso_segna_effettuato`, `rimborso_extra_precompila`.

## Saldo corriere (contrassegno)

### DistinteCorriere
`id, corriere_id?, data_distinta, data_accredito, importo, conto_id`
Il corriere incassa il contrassegno e invia un **bonifico cumulativo**: si registra la
distinta/accredito e si **spuntano** i pagamenti coperti → gli ordini passano a `saldato`.

**Realizzato (FASE 3C, giugno 2026)** — vedi `IMPLEMENTAZIONE.md`:
- `corriere_id` è **opzionale** (vuoto = versamento assegni): una distinta copre pagamenti su
  conto di transito **contrassegno *o* assegno**.
- **Niente entità `DistinteRighe`**: il legame distinta↔pagamenti è il campo **`distinta_id`** sul
  pagamento (le righe di una distinta = i pagamenti con quel `distinta_id`).
- **`importo` = somma dei pagamenti spuntati** (auto, nessuna trattenuta), snapshot alla creazione.
- **Doppia prospettiva**: il pagamento **mantiene** `conto_id` = mezzo (Contrassegno/Assegno);
  il **conto reale** è la fotografia `DistintaCorriere.conto_id` e si deriva al volo via
  `distinta_id` (esposto come `conto_accredito_nome`). Così restano calcolabili sia "incassato in
  contrassegno per agente" (sul mezzo) sia "entrato su un conto reale" (sulla distinta).
- **L'accredito marca i pagamenti `verificato`** (il bonifico è il riscontro di prima nota) →
  ordine `saldato`; eliminando la distinta tornano scollegati e non verificati (`in_attesa_accredito`).

## CRM / comunicazione

### Comunicazioni multicanale (FASE 11, fondazione 11B)

`comunicazione(id deterministico, idempotency_hash, payload: { fingerprint, canale,
destinatario_entita, destinatario_id, recapito normalizzato, oggetto, corpo, modello_id,
modello_versione_id, modello_versione, origine_entita?, origine_id?, origine_fingerprint?,
origine_snapshot?, tipo_modello?, campagna_id?, reinvio_di?, allegati[] }, proprietario:
{ utenteId, utenteNome, dispositivoId, dispositivoNome }, stato,
tentativi, ultimo_errore, esito_ambiguo, inviata_ms, riferimento_esterno, copia_posta_inviata,
origine_allineata, creata_ms, stato_aggiornato_ms)`

- L'intera entità vive nel registro eventi locale
  `%APPDATA%/it.pharmatek.gestionale/communication-outbox/` con proiezione
  `communication-outbox.sqlite`. Il registro comprende coda, esiti e tutta la cronologia. Non
  entra in `PharmaTek-Data/events`, snapshot, anchor, backup condivisi o
  sincronizzazione OneDrive.
- Stati: `bozza | da_revisionare | in_coda | sospeso | in_invio | invio_azionato |
  consegna_verificata | fallito | annullato`.
- `invio_azionato` e `consegna_verificata` sono distinti: WhatsApp Windows normalmente può
  provare soltanto il primo.
- La stessa intenzione usa una chiave di idempotenza stabile, memorizzata soltanto come SHA-256.
  Se la chiave ricompare con un payload diverso il comando fallisce; un reinvio intenzionale usa
  una chiave nuova e `reinvioDi`.
- Il payload risolto è un solo campo LWW immutabile: due finestre della stessa postazione non
  possono fondere oggetto, corpo e destinatario appartenenti a due messaggi diversi.
- Il recapito viene normalizzato prima della fingerprint (`email` minuscola; telefono E.164).
- Il destinatario e l'eventuale origine devono riferirsi a record vivi del gestionale.
- Il PC che crea la bozza ne diventa proprietario e conserva localmente coda ed esito; nessun altro
  PC vede o può eseguire quella comunicazione. Non esistono lease né subentri automatici.
- Prima del tentativo il PC proprietario rilegge il log aziendale condiviso per rivalidare
  destinatario e origine. Dopo l'accettazione SMTP registra autore, data, riferimento e stato
  soltanto in locale. Un errore esterno potenzialmente ambiguo blocca il retry della stessa
  comunicazione: il reinvio richiede una nuova chiave e il collegamento `reinvioDi`.
- Per mantenere coerente la logica aziendale, un esito positivo può aggiornare sull'entità sorgente
  soltanto indicatori compatti (`ultimo_invio_ms`, canale, fingerprint, ultimo sollecito e canali
  preventivo usati). Corpo, recapito, allegati, ricevuta, errore e id del singolo messaggio non
  vengono sincronizzati.
- Un errore certo precedente al tentativo resta riaccodabile sullo stesso record. La UI lo
  distingue dall'esito ambiguo e offre rispettivamente **Riprova** oppure un reinvio esplicito
  confermato.
- `allegati` contiene soltanto metadati verificabili (`nome, mime, dimensione, riferimento,
  sha256`), mai il binario. I metadati restano nella cronologia locale; i file temporanei del
  preventivo vengono eliminati dopo l'esito positivo quando non servono ad altri invii attivi.
- Tutte le entità della FASE 11 sono protette dal gate premium e non sono modificabili tramite il
  CRUD generico neppure su un PC abilitato: passano soltanto dai comandi di dominio. Transizioni
  della coda e invio passano da comandi distinti.
- Gli invii multipli riusano la stessa entità `comunicazione` e lo stesso `campagna_id` locale; ogni
  destinatario/canale conserva la propria chiave di idempotenza, il proprio stato e il PC
  d'origine. La lista di revisione è virtualizzata nel frontend e rende visibili i destinatari
  esclusi prima della conferma.
- Pausa, ripresa e interruzione producono un solo batch di mutazioni sugli elementi ancora
  pendenti della campagna. Gli elementi già azionati non vengono alterati; lo stato `sospeso`
  impedisce al worker locale di selezionare il messaggio.
- Il fallimento di un elemento non sospende la campagna: il worker continua con i destinatari
  successivi. Soltanto a primo giro terminato il retry di campagna riporta a `in_coda` i record
  `fallito` non ambigui appartenenti al PC d'origine; positivi ed esiti ambigui restano invariati.
- Una proroga collegata a un sollecito scrive sul pagamento la nuova `scadenza` e
  `comunicazione_proroga_id`. Tutte le rate selezionate vengono validate e aggiornate nello stesso
  batch; ripetere la stessa campagna è un no-op, mentre una campagna diversa non può riapplicare
  la proroga usando una revisione obsoleta.
- Per WhatsApp Windows il worker apre la conversazione e passa a `in_invio` prima dell'effetto
  esterno; il deep-link seleziona il numero e Windows UI Automation sostituisce l'eventuale bozza
  col testo esatto prima di azionare il pulsante associato. Un retry non può quindi appendere il
  corpo a quello preparato dal tentativo precedente. La verifica non assume che il nome del
  cliente coincida col nome del contatto salvato in WhatsApp. Il successo produce
  `invio_azionato`, non `consegna_verificata`. Se il processo termina in `in_invio`, al riavvio
  l'elemento diventa `fallito` con `esito_ambiguo`, non viene ritentato automaticamente e non
  blocca gli altri destinatari.

`modello_comunicazione/{id}(corrente: ModelloPayload)`

`modello_comunicazione_versione/{versione_id}(payload: ModelloPayload immutabile)`

- Sono inizializzati quattro modelli base: preventivo, sollecito preventivo, sollecito pagamento
  e preavviso spedizione. Il corpo è unico per e-mail e WhatsApp; l'oggetto si applica soltanto
  alle e-mail.
- Gli utenti possono creare e rimuovere modelli personalizzati. I quattro modelli base possono
  essere modificati o disattivati, ma non eliminati.
- Il payload corrente è atomico LWW; ogni modifica sostanziale crea anche una versione immutabile.
  Un salvataggio identico non incrementa la versione.
- Le variabili `{{nome_variabile}}` vengono validate contro il catalogo specifico del tipo.
- `istruzioni_pagamento` viene composto dai conti correnti e distingue banca/IBAN,
  contrassegno e assegno; `dettaglio_rate` conserva scadenze e importi delle singole rate.
- Una comunicazione conserva `modello_versione_id` per poter ricostruire il testo esatto usato.

`configurazione_canale/email(config: { nomeMittente, indirizzoMittente, smtpHost, smtpPort,
smtpSicurezza, smtpUsername, replyToAbilitato, replyTo, firma, salvaPostaInviata, imapHost,
imapPort, imapSicurezza, destinatarioProva }, aggiornata_ms, ultima_prova?)`

- `config` è un solo campo LWW: una modifica concorrente non può combinare server, porta, utente e
  mittente appartenenti a due configurazioni diverse.
- `ultima_prova` conserva soltanto destinatario, data, accettazione SMTP, esito della copia IMAP e
  un eventuale avviso leggibile. Non contiene il corpo completo né la password.
- La password non è un campo del modello dati. Ogni PC mittente la conserva nel Gestore
  credenziali di Windows e il DTO espone soltanto se una credenziale compatibile è presente
  localmente.
- Il Reply-To può essere precompilato ma resta inattivo finché `replyToAbilitato` è falso.

### Preventivi e scheda cliente (FASE 12)

`preventivo/{ordine_id}(ordine_id, numero_preventivo, validita_giorni,
condizioni_pagamento, introduzione, note, fingerprint_corrente, ultima_modifica_ms,
ultima_modifica_utente, ultima_modifica_dispositivo, ultimo_invio_ms?, ultimo_invio_canale?,
ultimo_invio_fingerprint?, ultimo_sollecito_ms?, preventivo_email_inviato?,
preventivo_whatsapp_inviato?, creato_ms)`

- L'identità è deterministica: esiste al massimo un preventivo corrente per ordine.
- Il preventivo può nascere soltanto da un ordine `Nuovo`; se l'ordine cambia stato resta
  consultabile e inviabile, ma non più modificabile.
- Righe, quantità e prezzi appartengono all'ordine. Il comando specializzato
  `preventivo_salva` valida le revisioni di preventivo, ordine, righe e pagamenti e aggiorna
  preventivo, ordine e scadenzario aperto in un unico batch.
- `fingerprint_corrente` rappresenta il contenuto semantico stampabile. L'indicazione
  `mai_inviato | inviato | modificato` è derivata dal confronto con l'ultimo fingerprint inviato:
  non è uno stato commerciale e non modifica lo stato dell'ordine.
- Gli indicatori dell'ultimo invio vengono registrati soltanto dopo un esito positivo. Sono un
  riepilogo minimo condiviso necessario a stato “inviato/modificato” e solleciti; la fotografia
  esatta di ciò che è stato inviato resta nel payload della comunicazione locale.

`scheda_cliente/{ordine_id}(ordine_id, data_ricezione, pazienti, info_spedizione, contatti,
intestatario_fattura, importo_totale, importo_acconto, data_contabile_valuta, modalita_saldo,
note, preventivo_whatsapp, preventivo_email, mantenimento, npp, paziente_nuovo, aggiornata_ms)`

- La scheda cliente è separata dal preventivo e usa la stessa identità deterministica per ordine.
- La prima apertura precompila una fotografia da ordine, anagrafiche, righe, pagamenti e indicatori
  compatti di invio del preventivo. Le correzioni restano override della scheda e non riscrivono
  implicitamente le anagrafiche principali.

`alias_preventivo/{alias_normalizzato}(alias, prodotto_id, aggiornato_ms)`

- Un alias viene salvato soltanto dopo la scelta esplicita dell'operatore.
- Il parser locale lo usa come corrispondenza esatta prima del ranking per refuso e trigrammi.

`configurazione_documenti/impostazioni(campi, aggiornata_ms, aggiornato_da)`

- `campi` è un payload LWW atomico e revisionato con denominazione, indirizzo, località, telefono,
  e-mail, sito, validità e condizioni predefinite.
- Logo, geometria e versione grafica sono incorporati nel renderer e non vengono duplicati nei
  record.

Le quattro entità FASE 12 sono protette dal CRUD generico, anche su un PC abilitato: passano dai
rispettivi flussi di dominio. I comandi di dominio dei preventivi e della scheda cliente per
lettura, creazione, modifica, eliminazione, ripristino e salvataggio condiviso sono gratuiti;
lettura della configurazione documenti e lista alias sono gratuite, mentre le rispettive scritture
restano Premium. Il salvataggio PDF/PNG del preventivo su file usa un comando dedicato che verifica
il gate prima di scrivere.

Gli allegati generati localmente usano riferimenti `pt-cache://<sha256>.<ext>` nella
comunicazione. Firma, hash, estensione e dimensione vengono verificati prima dell'effetto esterno;
percorsi assoluti e byte non entrano negli eventi condivisi, negli snapshot, nei backup o nella
cartella OneDrive. I soli metadati entrano nel registro eventi locale della comunicazione. Il file
viene rimosso quando nessuna comunicazione attiva lo referenzia e un cleanup TTL recupera i
residui dopo arresti anomali.

## Suggerimenti azionabili (FASE 14)

Le card operative sono una proiezione derivata e non introducono un'entità `suggerimento`.
Rimborsi, distinte, provvigioni, produzione e spedizioni restano governati
dai rispettivi record e comandi di dominio.

`suggerimento_stato/{hash}(suggerimento_id, nascosto, ts, utente_id, dispositivo_id)`

- `suggerimento_id` include tipo e fingerprint ordinato della fotografia minima delle sorgenti;
- il record esiste soltanto dopo **Nascondi fino al prossimo cambiamento** ed è sincronizzato;
- una nuova fotografia genera un nuovo id e non viene occultata dallo stato precedente;
- titolo, conteggio, priorità e deep-link non sono duplicati nel log condiviso.

Categorie abilitate, notifiche e giorni di attesa sono preferenze locali del PC in
`localStorage`; non esiste più un record condiviso `impostazioni/__suggerimenti__`. Le notifiche
usano il normale `notifica_letta` per utente e una retention temporale dedicata agli id `s14:`.

Per gli avvisi, ogni `spedizione` può contenere `ultimo_avviso_ms`,
`ultimo_avviso_canale` e `ultimo_avviso_fingerprint`. Il fingerprint è calcolato con la stessa
funzione usata dal suggerimento e viene scritto soltanto dopo l'esito positivo della
comunicazione. Una comunicazione locale può avere `origini_correlate: [{ id, fingerprint }]`:
nel caso di più colli aggiorna il riepilogo condiviso di ogni spedizione, mentre coda e
cronologia dettagliata restano locali.

Per i preventivi e i relativi suggerimenti intelligenti, ogni `preventivo` traccia `ultimo_invio_ms`,
`ultimo_invio_canale` (es. `"email"`, `"whatsapp"` o `"manuale"` tramite PDF/PNG) e
`ultimo_invio_fingerprint`. Il comando `preventivo_marca_inviato_manuale` aggiorna tali campi
quando l'operatore conferma l'invio manuale dopo il salvataggio del file, convalidando la revisione.
La stampa non costituisce un invio e non aggiorna questi campi.
Il `PreventivoDto` include inoltre `ordine_marcatore` per consentire ai suggerimenti e ai solleciti
di escludere automaticamente gli ordini con marcatori attivi (urgente, anomalia, sollecito).

### Note (thread + categorie, polimorfiche)
`id, target_type?, target_id?, parent_id?, autore, testo, categoria, ts, da_ricordare: bool,
menzioni: [userId], allegati: [allegatoId]`
- Le note su una stessa entità formano una **conversazione a thread** (cronologica);
  `parent_id?` consente risposte annidate. Target opzionale (note libere).
- `categoria` ∈ { telefonata, problema, accordo, follow-up, generica } (lista configurabile).
- `da_ricordare = true` (pinned) → pannello **"Note da ricordare"** in Dashboard.
- `menzioni`: utenti citati con **@** → ricevono una notifica (le note normali invece **non** notificano).

### Allegati
`id, nome_file, tipo: immagine|file, dimensione, percorso`
- File binari salvati in **`PharmaTek-Data/allegati/<id>.<ext>`** (sincronizzati da OneDrive).
- Gli **eventi** referenziano solo l'**id** dell'allegato (il binario non entra nel log).
- Tipi: **immagini e file** (es. ricevute, screenshot WhatsApp, documenti).

### Promemoria (condivisi / bacheca team)
`id, testo, scadenza, creato_da, target_type?, target_id?, priorita: alta|media|bassa,
ricorrenza?: { tipo: settimanale|mensile|annuale, intervallo }, notifica_anticipata?: { quanto },
fatto: bool, fatto_da?, fatto_ts?`
- **Sempre condivisi**: visibili a tutti gli utenti (bacheca comune del team); notificati a tutti.
- **Ricorrenti**: alla chiusura/scadenza si genera l'occorrenza successiva.
- **Notifica anticipata**: avviso prima della scadenza (oltre a quello alla scadenza).
- **Priorità** con evidenza visiva; collegabili a un'entità (ordine/medico/cliente/agente).

### Notifiche (cosa le genera)
`solleciti pagamento` · `promemoria` (scadenza + anticipata) · `menzioni @utente`.
(Le note generiche **non** generano notifiche; vedi UI-SPEC §13 per toast/traybar.)
Le notifiche collegate a un ordine sono derivate solo se l'ordine è ancora vivo: il soft-delete
verso il Cestino rimuove subito solleciti, marcatori e promemoria collegati; il ripristino li rende
nuovamente derivabili.

## Gestione dati: cestino, storico, anni

- **Cancellazione = soft-delete**: eliminare un record emette un evento `*.deleted` (non rimuove
  nulla). Il record va nel **Cestino**, da cui è **ripristinabile**; lo svuotamento è un'azione
  esplicita e separata.
- **Storico per record**: dagli eventi si ricostruisce *"chi ha cambiato cosa e quando"*; nel
  dettaglio si può **annullare** una singola modifica (revert a un valore precedente).
- **Store unico continuo**: tutti gli anni in un solo archivio, con **filtri per anno/periodo**
  (niente file separati per anno). Il **numero ordine** resta per-anno (`2026-0001`). Possibile in
  futuro un'archiviazione opzionale degli anni vecchi per alleggerire le viste.

## Categorie speciali

- **Diagnostica**: per riga, `valore_produzione` vs `valore_vendita`, `cassetta`,
  prick test respiratori/alimenti, lancette, imenotteri.
- **Keriba**: pipeline preventivi (qta, importo, esito/motivazione).

I dettagli di questi campi vengono definiti nelle fasi 4/5.
