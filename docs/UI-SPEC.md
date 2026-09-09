# Specifica interfaccia (dettagliata)

Documento di riferimento per realizzare la UI "per filo e per segno". Complementa
[`UI.md`](UI.md) (palette/principi). UI in **italiano**, libreria **Mantine**, tema
**sidebar scura + contenuto chiaro**, stile **arioso**, **vincolo 1366×768**.

---

## 1. Vincolo schermo & griglia

- **Baseline 1366×768**. Tutto deve essere usabile a questa risoluzione senza scroll
  "fuori controllo". Altezza utile contenuto ≈ **680px** (tolti titlebar Tauri ~32px + topbar 52px).
- **Breakpoint larghezza**:
  - `< 1280px` → sidebar **auto-compressa** a sole icone (60px).
  - `≥ 1280px` → sidebar estesa (220px), comprimibile a mano.
- **Spacing scale** (px): `4 · 8 · 12 · 16 · 20 · 24 · 32`. Padding contenuto: 20px.
- **Raggi**: controlli/card `8px`, badge `999px` (pill).
- **Ombre**: `sm` per card, `md` per popover/menu, `lg` per modali/finestre.
- **Z-index**: contenuto 0 · sidebar 100 · topbar 100 · dropdown 300 · modale 400 · toast 500.

## 2. Tipografia

- Font: **Inter** (fallback `Segoe UI`, system-ui). Numeri **tabular** in tabelle/importi.
- Scala: corpo `14px` (base), small `12px`, h3 `16px/600`, h2 `20px/700`, h1 `24px/700`.
- Riga: 1.5 nel testo, 1.2 nei titoli.

## 3. Design tokens — colori

Brand e semantici già in `UI.md`. Neutrali e stati aggiuntivi:

| Token | Hex | Uso |
|---|---|---|
| `dark` | `#1A1A1A` | sidebar/header |
| `dark-2` | `#242424` | hover sidebar |
| `dark-3` | `#2A2A2A` | voce attiva sidebar |
| `accent` | `#F4C20D` | azioni primarie (testo su accent = `#1A1A1A`) |
| `accent-hover` | `#E0B00C` | hover primario |
| `bg` | `#F5F7FA` | sfondo contenuto |
| `surface` | `#FFFFFF` | card, tabelle, modali |
| `border` | `#E3E8EF` | bordi/divider |
| `text` | `#1D2733` | testo principale |
| `text-muted` | `#5B6B7C` | testo secondario |
| Stati pagamento | vedi `UI.md` | badge contabilità |
| `danger` `#E03131` · `success` `#2F9E44` · `warning` `#F08C00` · `info` `#1971C2` | | feedback |

## 4. Shell applicativa (finestra principale)

```
┌───────────────────────────────────────────────────────────────┐
│ TOPBAR  (h 52)  [logo? no]  titolo vista | ricerca | sync | utente│
├──────────┬────────────────────────────────────────────────────┤
│ SIDEBAR  │  AREA CONTENUTO (bg #F5F7FA, padding 20)            │
│ (220/60) │                                                     │
│  logo    │   [intestazione vista + azioni]                     │
│  nav…    │   [contenuto: tabella / form / dashboard]           │
│  ───     │                                                     │
│  utente  │                                                     │
└──────────┴────────────────────────────────────────────────────┘
```

**Sidebar (scura `#1A1A1A`) — 3 stati**
- **Estesa** (220px): icone + testo.
- **Solo icone** (60px): solo icone, label in **tooltip** al passaggio.
- **Nascosta** (0px): completamente collassata per dare tutto lo spazio al contenuto.
- **Controlli**: bottone `«/»` in cima alla sidebar (estesa ↔ solo icone) e **bottone ☰
  nella topbar** che mostra/nasconde la sidebar (e la riapre quando è nascosta). Scorciatoia `Ctrl+B`.
- Lo stato scelto **viene ricordato** tra le sessioni. L'auto-collapse a "solo icone" sotto la
  soglia di larghezza (vedi §11.3) resta valido, ma l'utente può sempre forzare manualmente uno dei 3 stati.
- In alto: logo PharmaTek (versione chiara) + bottone collapse `«/»`.
- **Menu a 6 voci**: **Dashboard · Giornaliero · Contabilità · Evasione ordini ·
  Anagrafiche ▸ · Impostazioni**. (Promemoria/Notifiche **non** sono una voce: stanno nella
  campanella in topbar + nella Dashboard.)
  - **Contabilità** raggruppa a tab: **Pagamenti · Provvigioni · Rimborsi** (+ Saldo corriere).
  - **Evasione ordini** raggruppa a tab: **Produzione · Spedizioni · Spedizioni effettuate**.
  - **Anagrafiche** = **gruppo espandibile** (Agenti, Medici, Clienti, Prodotti/Listino, Conti,
    Corrieri) **e** la pagina ha uno **switcher interno** (tab/segmented in alto) per cambiare
    registro **senza tornare al menu**. Le due strade restano sincronizzate (apri "Clienti" dal
    menu o dallo switcher → stessa vista).
- Voce attiva: sfondo `#2A2A2A`, **barra gialla** a sinistra (3px), testo bianco.
  Hover: `#242424`. Inattiva: testo `#C9CDD2`.
- In basso: avatar/nome utente corrente + stato (online/offline).

**Topbar (h 52, fondo bianco, bordo inferiore)**
- Sinistra: **bottone ☰** (mostra/nasconde la sidebar) + titolo della vista corrente.
  - *Nota responsività*: Il contenitore del titolo sfrutta le **CSS Container Queries** (`containerType: "inline-size"`) per nascondere dinamicamente il testo se lo spazio a disposizione si riduce troppo (es. <130px), prevenendo la collisione visiva o troncature brusche contro la barra di ricerca.
- Centro/destra: **ricerca globale / comandi** (campo, scorciatoia `Ctrl+K`) → vedi §7.10.
- **Stato sincronizzazione**: pill con icona — `Online · sync ok` (verde),
  `Offline` (grigio), `Sincronizzazione…` (giallo, spinner); **click apre la
  Panoramica sincronizzazione** (§7.11). La **freschezza** ("aggiornato 2 min fa") compare
  **solo nel tooltip al passaggio del mouse**, non sempre a schermo.
- **Notifiche**: campanella con badge numerico (apre la finestra Promemoria/Notifiche).
- Utente: menu (cambia utente, impostazioni, info).

## 5. Modello finestre (ibrido)

**Finestra principale**: shell + tutte le viste a sidebar.

**Finestre separate** (Tauri webview multiple), apribili più volte/affiancabili:

| Finestra | Quando | Dimensione (min) | Note |
|---|---|---|---|
| **Ordine** (nuovo/modifica) | "Nuovo ordine", doppio-click su riga | 1040×700 (900×600) | Si possono aprire più ordini affiancati; salvataggio esplicito e sync sugli eventi reali |
| **Anteprima stampa/export** | genera export corrieri/Laboratorio/provvigioni | 820×720 (700×600) | Anteprima + **Esporta file** (Excel/PDF) **e Stampa diretta** |
| **Promemoria & Notifiche** | campanella / all'avvio se ce ne sono | 440×620 (380×500) | Lista solleciti + promemoria; sempre richiamabile |
| **Distinta corriere** (saldo) | Contabilità → nuova distinta | 900×640 | Spunta fatture coperte dal bonifico |

Regole comuni finestre separate: titolo descrittivo (`Ordine 2026-0007 — Rossi`), salvataggio
esplicito + avviso se chiusura con modifiche non salvate, ridimensionabili, ricordano
posizione/size. Tutte rispettano min 900×600 (o meno per quelle piccole) per stare in 1366×768.

## 6. Componenti (stati ed estetica)

### Pulsanti (altezze: sm 30 · **md 36** · lg 42; raggio 8)
| Variante | Aspetto | Uso |
|---|---|---|
| **Primario** | fondo `#F4C20D`, testo `#1A1A1A`, hover `#E0B00C` | azione principale (Salva, Nuovo) |
| **Secondario** | bianco, bordo `#E3E8EF`, testo `#1D2733`, hover bg `#F5F7FA` | azioni neutre (Annulla) |
| **Ghost/subtle** | trasparente, testo, hover bg leggera | azioni in tabella/toolbar |
| **Pericolo** | fondo `#E03131`, testo bianco | elimina/azioni distruttive (con conferma) |
| **Icona** | quadrato 36×36, solo icona + tooltip | azioni compatte |
- Stati: hover, active (leggero scale/ombra), **disabled** (opacità 0.5, cursor not-allowed),
  **loading** (spinner + testo invariato, non ridimensiona). Focus visibile (anello accent).
- Posizione: azione primaria **in basso a destra** in form/modali; toolbar azioni in alto a destra nelle liste.

### Campi (input, select, date, number, textarea)
- Altezza 36, bordo `#E3E8EF`, focus bordo accent + anello. Label sopra (12px, muted).
- Errore: bordo `danger` + messaggio inline sotto (12px). Helper text opzionale.
- Number/importi: allineati a destra, suffisso `€`, separatori migliaia, 2 decimali.
- Select con ricerca per anagrafiche (medico, cliente, prodotto…). Date in formato `gg/mm/aaaa`.

### Tabella (componente chiave del gestionale)
- Header **sticky**, riga **44px** (toggle "compatta" 36px), zebra leggera, hover riga.
- **Barra strumenti** sopra: ricerca, filtri (chip), selettore **colonne visibili**, "compatta",
  bottone azione primaria (es. "Nuovo ordine"), export.
- Molte colonne → **scroll orizzontale** interno con prima colonna (es. n° ordine) **sticky**.
- Ordinamento per colonna; **paginazione** (50/100) o scroll virtualizzato per liste lunghe.
- Riga: doppio-click = apre dettaglio (finestra Ordine); menu `⋯` per azioni (modifica, stato, elimina).
- Celle stato: **badge** colorati (vedi stati pagamento). Importi residui in **rosso** se dovuti.
- **Colonne implicite/derivabili nascoste di default** (es. *Agente* = derivato dal medico,
  *Regione* = da Provincia, CAP, contatti), riattivabili dal selettore colonne → meno rumore,
  più leggibilità. Si mostra solo ciò che serve davvero a colpo d'occhio.
- Vuoto: empty-state centrato (icona + testo + bottone "Crea il primo…").
- Il riadattamento colonne usa una breve sfumatura solo per cambi strutturali visibili (resize della
  finestra, sidebar, reset/larghezze colonne). Il primo caricamento asincrono è sempre immediato e
  senza opacità; anche l'espansione/chiusura delle righe in **Spedizioni effettuate** ridistribuisce
  le colonne senza sfumatura. **Riduci animazioni** disabilita ogni transizione residua.
- Nelle celle cliente/medico/agente abilitate, il nome è un link visivamente neutro che si sottolinea
  solo su hover/focus e ferma la propagazione del clic alla riga.

### Altri
- **Badge/pill** stati (pagamento, ordine, provvisorio). "Provvisorio" = pill gialla.
- **Tabs** per sezioni dentro una vista/dettaglio (es. Ordine: Dati · Righe · Pagamenti · Note).
- **Modale**: header + corpo (scroll interno) + footer azioni. Larghezze sm 420 · md 600 · lg 820;
  **max-height 88vh**. Usata per conferme e form brevi; i form lunghi (ordine) vanno in finestra.
- **Toast/notifiche** (in basso a destra): success/errore/info, auto-dismiss 4s.
- **Conferma distruttiva**: modale con testo chiaro + bottone Pericolo. L'eliminazione è
  **soft-delete** → il record va nel **Cestino** (ripristinabile), non sparisce davvero.
- **Storico record**: nel dettaglio, pannello "Storico" (chi/cosa/quando) con possibilità di
  **annullare** una singola modifica (revert). Il **Cestino** (in Impostazioni) elenca gli
  elementi eliminati con **Ripristina** / **Elimina definitivamente** / **Svuota**.
- **Card** KPI (dashboard): titolo muted + valore grande + variazione.
- **Skeleton/loading** per liste; **stato offline** banner discreto.
- **Note / Conversazione** (componente riutilizzabile su ordine/medico/cliente/agente):
  - **thread cronologico** dei messaggi (avatar autore, data, testo), con **risposte** annidate;
  - **categoria** per nota (chip colorato: telefonata, problema, accordo, follow-up, generica) +
    filtro per categoria;
  - **allegati** immagini/file (drag&drop o pulsante; anteprima miniatura, lightbox per immagini);
  - **@menzioni** con autocompletamento utenti (la menzione notifica il citato);
  - **pin "da ricordare"** (compare in Dashboard); editing/cancellazione (accesso pieno, con storico);
  - composer in basso (testo + allegato + invia), animazioni d'ingresso dei nuovi messaggi (§12).

## 7. Schermate (una per una)

### 7.1 Onboarding (primo avvio)
Finestra centrata, a passi con transizioni animate (fade+slide). Niente sidebar finché non completato.

**Passo 1 — Cartella dati**
- Selezione cartella **`PharmaTek-Data`** (file picker).
- `open_data_dir` apre una proiezione locale ricostruibile, importa snapshot/log e restituisce gli
  utenti attivi presenti nel registro condiviso.

**Passo 2 — Utente**
- Campo **nome utente**. Mentre digiti, controllo nelle entità condivise `user`:
  - se il nome **esiste già** → avviso *"Esiste già l'utente «Mario»"* con 3 scelte:
    **Usa questo utente** (collega questo PC all'utente esistente), **Riconfiguralo**
    (modifica nome/avatar dell'utente esistente), **Crea nuovo** (nome diverso).
  - se è nuovo → si prosegue creandolo.

**Passo 3 — Avatar / foto profilo**
- **Griglia di avatar predefiniti** (set bundlato con l'app, quindi **offline-safe**; non
  scaricati a runtime per non rompere l'uso offline).
- Opzione **"Carica una foto"**: scegli un **PNG/JPG** dal disco → **crop circolare** +
  ridimensionamento automatico (es. 256×256) per tenerla leggera.
- Fallback: **iniziali su colore** generato dal nome (se non scegli nulla).
- Anteprima live dell'avatar.

**Passo 4 — Riepilogo** e conferma. Genera/persiste il `deviceId`; salva l'utente (nome +
avatar) nel registro condiviso così **l'avatar compare nella panoramica sync e nei messaggi**.

Durante i quattro passi gli eventi tecnici di ricostruzione non cambiano schermata. Terminata la
configurazione, i controlli di cartella/sessione vengono riabilitati normalmente.

> L'utente può poi cambiare nome/avatar in qualsiasi momento da **Impostazioni → Profilo**.

### 7.2 Dashboard (home operativa)
**Niente filtro periodo globale**: il periodo è **per-componente**, solo dove ha senso (ogni
card che lo prevede ha un proprio mini-selettore `Giorno · Settimana · Mese`).

**Card KPI** (riga in alto):
- **Ordini** (numero + valore) — *con* mini-filtro periodo.
- **Da saldare**, suddiviso **spediti / non spediti** (es. "€X spediti · €Y non spediti") —
  valore corrente (evidenzia il rischio cassa sulla merce già partita ma non incassata).
- **In produzione / in arrivo** — stato corrente (niente periodo).
- (secondaria) **Provvigioni maturate** — *con* mini-filtro periodo.
- Click su una card → apre la lista filtrata corrispondente (es. "Da saldare → non spediti").

**Pannello "Promemoria in scadenza" (bacheca condivisa, gestione inline)** — centrale e prominente:
- Promemoria del **team** (condivisi) ordinati per scadenza; **scaduti** in rosso, **oggi** in
  giallo; **priorità** con evidenza visiva e badge **ricorrente**.
- Azioni per riga: **✓ fatto**, **posticipa** (snooze: +1g/+1sett/data), **modifica**, apri entità.
- Click sul corpo della riga: espansione inline esclusiva e animata con priorità, scadenza, anticipo,
  ricorrenza, autore, collegato e CTA **Modifica**. Le azioni chiudono prima l'espansione; gli eventi
  remoti aggiornano la riga e la chiudono se il record sparisce. Durata zero con **Riduci animazioni**.
- Bottone **+ Nuovo promemoria** (testo, scadenza, **priorità**, **ricorrenza**, **notifica
  anticipata**, entità collegata opzionale).

**Pannello "Note da ricordare"**:
- Note marcate **"da ricordare"** (pinned) sulle entità (ordine/medico/cliente/agente) o note
  libere; click apre la nota/entità. Bottone **+ Nota rapida**.

Sotto/accanto: **Ultimi ordini** e **solleciti** scaduti. Layout in ~680px: 1 riga di card KPI;
sotto due colonne **Promemoria | Note da ricordare**; ultimi ordini in coda. Scroll solo se serve.

**Grafici (animati)** — sezione dedicata, con animazioni d'ingresso, tooltip e mini-filtro
periodo dove ha senso (libreria **Mantine Charts / Recharts**, animate di default):
- **Andamento ordini & incassi** (area/line) per giorno/settimana/mese.
- **Ordini per stato** (ciambella/torta): nuovi, in produzione, spediti, saldati, rifiutati…
- **Da saldare: spediti vs non spediti** (torta) — rischio cassa a colpo d'occhio.
- **Top agenti** (barre) per valore ordini / provvigioni.
- **Ordini per regione** (barre).
Set **configurabile** in futuro; ogni grafico riflowa secondo §11.

### 7.3 Giornaliero (lista ordini)
Tabella ordini, colonne di **default** (essenziali): `N° · Data · Medico · Cliente · Città ·
Importo · Saldo (residuo) · Stato · Sollecito · ⋯`.
Colonne **implicite/nascoste** attivabili dal selettore: *Agente* (derivato dal medico),
*Regione* (da Provincia), *Acconto*, *CAP*, contatti.
Barra: ricerca, filtri (stato, agente, periodo, "da saldare"), colonne, densità,
**Nuovo ordine** (primario). Doppio-click → finestra Ordine. Filtro/vista **Ordini rifiutati**.

### 7.3.1 Inserimento rapido ordine (assistito)
Pensato per **quando arriva un ordine**: si inizia a digitare e l'app fa il resto, senza
conferme inutili.
- **Riconoscimento cliente**: digitando nome / telefono / CF, l'app cerca tra i clienti
  esistenti. Su **match sicuro** **auto-compila tutti i campi** (indirizzo, contatti,
  medico → agente) **senza chiedere conferma** — zero click nel caso comune.
- **Fallback "persona diversa"**: se poi modifichi un campo identificativo (nome/CF/indirizzo)
  rendendolo diverso dal cliente trovato, l'app **non sovrascrive** quello esistente: al
  salvataggio **crea un nuovo cliente** con i dati digitati. Un hint discreto lo segnala
  (*"verrà creato come nuovo cliente"*) con link opzionale *"aggiorna invece l'esistente"*.
- Stesso assistente per **medico** (→ agente auto) e **prodotto** (→ prezzo suggerito).
- Tutto **inline**, nessuna modale bloccante; l'ordine si salva con un solo gesto.

### 7.4 Finestra Ordine (nuovo/modifica) — *finestra separata*
Tabs: **Dati** · **Righe** · **Pagamenti** · **Note**.

**Tab Dati** — data, medico→agente auto, cliente con indirizzo, stato, sollecito. In fondo una
sezione **a comparsa** "Dati di fatturazione diversi?" (nascosta di default, per non appesantire):
non si auto-compila dall'indirizzo di spedizione; se compilata si usa per fatturazione/export e
si riapre automaticamente quando si torna sull'ordine, **altrimenti si usano i dati del cliente**.

**Tab Righe** — prodotto → prezzo suggerito modificabile, qta, paziente; 1 riga default,
"+ aggiungi riga". Ogni riga mostra il **stato spedizione** (**da spedire** / **spedita**, con
n° spedizione) con badge, così si vede a colpo d'occhio cosa manca da spedire. Per le righe
Immunoterapia i dati produzione facoltativi includono formulazione, posologia, allergeni/ceppi e
**numero lotto**: formulazione/posologia possono riprendere mantenimenti storici dello stesso
cliente+prodotto, il numero lotto resta sempre manuale.

**Tab Pagamenti** — acconto/saldo (importo, conto, data, verificato), **residuo** calcolato.
Bottone **"Rateizza"** → apre un dialog: inserisci il **numero di rate** (e il totale, default =
residuo, cadenza mensile/personalizzata, data prima rata) → l'app **calcola in automatico le
rate** (importi uguali, ultima rata aggiusta i centesimi) e mostra l'**anteprima tabella rate**
(importi/scadenze **modificabili a mano**); conferma = crea il **piano rate**. La tab mostra poi
le rate con stato (da pagare / pagata / **scaduta** in rosso), e per ognuna **"Segna pagata"**
(con conto e data).
Header: `Ordine 2026-0007` + badge stato. Footer: **Salva** (primario) / Annulla.
Numero **provvisorio** evidenziato finché offline.

### 7.4.1 Preventivi e scheda cliente (premium)

**Preventivi** è una pagina lazy collocata fra Giornaliero e Produzione e nascosta quando il
premium non è attivo. Usa la shell `Pagina`, la toolbar adattiva, `FiltriPopover`, `Tabella` e i
menu ⋯ già adottati nelle viste operative.

- La toolbar contiene ricerca, filtri multi-linea e indicazione
  `Mai inviato / Inviato / Modificato dopo l'invio`, ordinamento e **Nuovo preventivo**.
- La creazione propone soltanto ordini `Nuovo` senza preventivo; l'editor mantiene numero ordine,
  cliente e riga sorgente sempre riconoscibili.
- Il testo libero viene interpretato offline. Ogni proposta mostra prodotto, quantità, prezzo,
  paziente, confidenza, motivazione e alternative; una corrispondenza incerta richiede revisione
  esplicita e può restare testo libero.
- Il footer dell'editor resta fermo. **Salva e visualizza** aggiorna in un'unica operazione
  preventivo, righe ordine e scadenzario; **Salva e invia** completa lo stesso salvataggio, avvia
  l'invio rapido e mostra comunque l'anteprima. Una revisione superata blocca l'intero
  salvataggio e invita a ricaricare.
- Il menu ⋯ offre Apri/modifica, Anteprima, Stampa, Salva PDF, Salva immagine, Invia, Sollecita e
  Stampa scheda cliente. **Invia** è automatico, mentre **Sollecita** apre il compositore. Le
  azioni non modificano mai automaticamente lo stato dell'ordine.
- Anteprima, PDF, PNG e stampa derivano dallo stesso albero vettoriale A4. Se il contenuto non
  entra nella pagina, il modale elenca ciò che va ridotto e disabilita le azioni finali.

La **Scheda cliente** è un modale separato con corpo scrollabile, footer fermo, form precompilato
e anteprima A4 che replica la struttura del modulo cartaceo di riferimento. Righe e celle restano
bianche e scrivibili a penna quando il valore manca. Si apre dal menu ⋯ o contestuale del
Giornaliero, dall'editor ordine e dal menu del preventivo. Nel nuovo ordine, **Salva e stampa** è
mostrato soltanto col premium; negli ordini esistenti **Stampa** resta visibile senza premium ma
apre il paywall senza leggere dati protetti.

L'invio rapido riusa modelli, allegati e coda FASE 11: accoda e-mail e WhatsApp quando entrambi i
recapiti sono validi, oppure il solo canale disponibile. La campanella separa **Da inviare**
(mai inviati o modificati) e **Da sollecitare** (inviati, invariati e oltre soglia su ordini
`Nuovo`); ogni gruppo apre una propria revisione di campagna. La soglia iniziale di 7 giorni è
configurabile in Impostazioni. Nessuno scheduler invia messaggi senza intervento dell'operatore.
Coda, campagne e cronologia comunicazioni sono locali alla postazione e non raggiungono
OneDrive; le altre postazioni ricevono soltanto gli eventuali indicatori compatti aggiornati sul
preventivo condiviso.

### 7.5 Anagrafiche (hub con switcher + pattern lista/dettaglio)
Registri: Agenti, Medici, Clienti, Prodotti/Listino, Conti, Corrieri. In cima alla pagina uno
**switcher interno** (tab/segmented) per passare da un registro all'altro **senza tornare al
menu**; lo stesso registro è raggiungibile anche dal gruppo "Anagrafiche" nella sidebar (le due
vie sono sincronizzate). Layout: tabella a sinistra + **pannello dettaglio** a destra (o modale
su schermi stretti). 
- **Agenti**: dati + `regola_provvigione` (fisso/%) + (in scheda) **prezzi per i suoi medici**.
- **Medici**: nome + agente fisso.
- **Clienti**: anagrafica completa + storico ordini.
- **Prodotti/Listino**: nome, categoria, prezzo base; **Regole prezzo** (tabella regole).
- **Conti** / **Corrieri**: liste semplici editabili.

### 7.6 Contabilità (hub a tab: Pagamenti · Provvigioni · Rimborsi)
**Tab Pagamenti** — Tabella pagamenti/ordini, colonne di default: `N° · Cliente · Importo · Saldo (residuo) ·
Conto · Stato · Verificato · Note · ⋯`. Le colonne **per-conto** dell'Excel (1243, BANCA DEMO…)
diventano il **campo "Conto"** del pagamento, non colonne separate (meno rumore).
**Badge stato** (colori Legenda). Azioni: registra acconto/saldo (con conto), segna
**verificato**, **rateizza** (vedi finestra Ordine → Pagamenti). **Saldo corriere** apre la
finestra Distinta → spunta fatture coperte dal bonifico.
**Filtri contabili** (combinabili): per **stato pagamento**, **conto**, **periodo**, **agente**,
**cliente**, **spediti / non spediti**, **rate scadute**, **da verificare**, + ricerca note
(scorciatoie stile Excel: "! crediti", "? anomalie", "ok saldi").
**Vista "Rate in scadenza/scadute"**: elenco rate ordinate per scadenza, scadute in rosso, con
"Segna pagata". **Esporta** (Excel/CSV/PDF) della vista filtrata (estratto crediti, scadenzario).

**Tab Provvigioni** — Filtri agente + periodo. Tabella per agente: ordini maturati, base
(importo ordine), provvigione, totale. Bottone **Esporta** (apre Anteprima export).
- Le colonne Stato e Maturato adottano il pattern di compattazione automatica (compatte con sola icona se manca spazio, estese con testo se c'è spazio sufficiente).

**Tab Rimborsi** — lista rimborsi + form (importo, ragione sociale, motivo, conto/IBAN,
date). Stato richiesto/effettuato.

### 7.7 Evasione ordini (hub a tab: Produzione · Spedizioni · Spedizioni effettuate)
L'evasione lavora **a livello di riga/prodotto** (un ordine può essere **parzialmente spedito**).
Non c'è uno step "arrivi": i prodotti che arrivano sono quelli ordinati; si spedisce ciò che è
disponibile e le righe non arrivate restano `da spedire`.

**Tab Produzione** — Righe in produzione + dati allergeni/posologie → **Genera Excel Laboratorio**
(Anteprima export).

**Tab Spedizioni (prepara spedizione)** — elenco delle righe **da spedire** (di tutti gli ordini),
con ricerca/filtri per ordine/cliente/medico/corriere e numeri lotto. Seleziona le righe da spedire — anche di
**più ordini/clienti** insieme — con **"seleziona tutto"** + selezione puntuale → imposta corriere,
colli, peso, servizi, n° spedizione → crea la **Spedizione** e **Genera file** CORRIERE_B/CORRIERE_A
(Anteprima export). Le righe selezionate passano a `spedita`; le righe non arrivate restano
`da spedire` per una spedizione successiva (**spedizione parziale**).
- **+ Aggiungi riga mancante** (prodotto ordinato non inserito nel giornaliero): rapido e intuitivo;
  un dialog **chiede ogni volta** se la riga **incide sul totale** (con prezzo) **o no** (logistica/incluso).

**Tab Spedizioni effettuate** — elenco delle spedizioni con **raggruppamento** delle righe/ordini
inclusi (espandi una spedizione → vedi tutti gli ordini/righe, cliente, corriere, data,
n° spedizione). Filtri per corriere/periodo/cliente; ri-stampa/ri-esporta il file della spedizione.
Nel dettaglio di ogni collo c'è un popover **Modifica dati spedizione**: corregge destinatario,
indirizzo, contatti, colli/peso, preavviso telefonico e numeri/lotti dei prodotti. Le correzioni
di destinatario restano sulla spedizione (`dest_*`), mentre i lotti restano sulle righe prodotto
così sopravvivono all'eventuale annullo del collo.

### 7.8 Promemoria & Notifiche (campanella, non è voce di menu)
Finestra/pannello aperto dalla **campanella** in topbar (badge col numero di notifiche) e
richiamato dai pannelli Dashboard. Tre sezioni:
- **Notifiche**: solleciti pagamento, promemoria (alla scadenza e **in anticipo**), **menzioni
  @utente**. Click → apre l'entità collegata; un sollecito pagamento apre l'ordine e porta in
  evidenza il box **Pagamento** della scheda.
- **Promemoria (bacheca condivisa del team)**: lista ordinata per scadenza (scaduti in rosso,
  oggi in giallo), con **priorità** (alta/media/bassa, evidenza visiva) e badge **ricorrente**.
  Azioni per riga: **✓ fatto**, **posticipa** (snooze), **modifica**, apri entità.
  **+ Nuovo promemoria**: testo, scadenza, priorità, **ricorrenza** (settimanale/mensile/annuale),
  **notifica anticipata** (es. 1g prima), entità collegata opzionale.
- Accesso rapido alle **note "da ricordare"**.

### 7.8.1 Note / Conversazione (componente riutilizzabile)
Presente nelle entità (tab **Note** dell'Ordine, schede Medico/Cliente/Agente) — vedi §6.

### 7.9 Impostazioni
Sezioni: **Profilo** (nome utente + **avatar/foto profilo**: cambia preset o carica PNG/JPG),
**Sincronizzazione** (percorso cartella, stato, forza sync → apre §7.11), **Backup** (vedi sotto),
**Avvio automatico** con Windows (toggle), **Notifiche** (soglia giorni solleciti, anticipo
promemoria di default, attiva/disattiva menzioni), **Categorie note** (modifica elenco),
**Cestino** (ripristina/elimina definitivamente/svuota), **Conti/Corrieri** (scorciatoia),
**Sistema** (avvio con Windows, scorciatoia globale della ricerca, scorciatoia desktop per la
ricerca), **Aspetto** (densità compatta on/off · **Riduci animazioni** on/off), **Info/versione**.
- **Aggiornamenti**: vivono nella finestra **Info** (menu utente → Info, oppure comando Spotlight
  «Controlla aggiornamenti»). Installazione **silenziosa con riavvio**; fonte GitHub Releases
  (vedi `AGGIORNAMENTI.md`).
- **Backup**: frequenza (manuale/giornaliero/settimanale), **posizione** (cartella fuori da
  OneDrive), **retention** (ultimi N), bottoni **Backup ora** / **Ripristina** + data ultimo backup.
  Prima del ripristino l'app può mostrare una conferma coordinata con conteggio delle postazioni che
  hanno ricevuto il prepare; le postazioni avvisate chiudono le finestre operative e mostrano una
  schermata bloccante “Ripristino in corso…”. Dopo il marker finale, ogni postazione attende che
  combaci il manifest dei file ripristinati e mostra “Importo i dati più recenti...” durante la
  ricostruzione locale; se era offline, lo stesso controllo avviene al bootstrap. Polling, ritorno
  dalla tray e controllo periodico della preparazione rileggono lo stesso stato persistente, quindi
  un evento perso non lascia la schermata bloccata. Se il payload non diventa valido entro due
  minuti, il loader lascia posto a un errore con **Riprova**, senza riaprire automaticamente il loop.
  **Promemoria backup**: se non se ne fa uno da N giorni, avviso gentile (banner/toast discreto).
- **Reset nascosto**: da Impostazioni, un clic sul cestino animato nel box **Pulizia dati** oppure
  cinque pressioni di `Canc` entro 1,5 s (sequenze indipendenti) → view bloccante **Centro di ripristino** senza toast di
  avanzamento. Il cestino anima coperchio e reazioni successive, senza trasformazioni quando è
  attivo **Riduci animazioni**. Scelta, conferme e stato di lavoro sono step animati nella stessa
  view, senza modali sovrapposti; `Esc` torna indietro/chiude e l'esecuzione blocca la chiusura.
  La view offre quattro opzioni: **Riconfigura questo PC**, **Ritira un PC**,
  **Ottimizza database**, **Reset completo**. L'ottimizzazione usa l'accent giallo, mostra lo stato
  di ack di ogni postazione e abilita normalmente l'esecuzione quando sono tutte pronte; con ack
  mancanti offre **Forza comunque**, protetto da un avviso sulla possibile perdita di modifiche non
  sincronizzate. I PC offline si riallineano dall'anchor al collegamento successivo. Il riepilogo
  finale espone backup e statistiche della compattazione. Il ritiro mostra una
  lista scrollabile di dispositivi con ultima attività, include anche il PC corrente con badge
  "questo PC" e richiede conferma distruttiva. La rimozione non tocca ordini/anagrafiche e avviene
  solo dopo snapshot + backup. Reset leggero e completo entrano direttamente nell'onboarding.
  Dopo il reset completo la lista dispositivi resta vuota: gli eventuali autori orfani presenti nei
  watermark non vengono mostrati. Una barriera `device_retired` invisibile impedisce inoltre ai log
  pre-reset risincronizzati in ritardo di far ricomparire postazioni.

**Schermate di recupero (mutuamente esclusive)**

- **Cartella dati non disponibile**: cartella assente, vuota, illeggibile o non raggiungibile;
  azioni **Riprova** e **Reset configurazione**.
- **Sessione non più disponibile**: dati leggibili, ma profilo cancellato o device ritirato da un
  altro PC; unica azione **Ricollega**.
- Un reset scelto dall'utente non mostra la seconda schermata. Durante Ricollega/onboarding nessuna
  delle due interrompe i passaggi.
- Con sessione invalida tutte le finestre secondarie vengono distrutte, il notificatore viene
  azzerato e Spotlight invalidato. Dopo l'onboarding lo stato `pronto` ricrea overlay e Spotlight.

### 7.10 Ricerca globale & comandi (Ctrl+K / scorciatoia globale)
Palette stile "command bar" che si apre con `Ctrl+K` dentro l'app, dal campo in topbar o dalla
scorciatoia globale configurabile (default `Alt+P`). La ricerca è una finestra dedicata
`spotlight`, trasparente e senza bordi: può comparire sopra altre app senza riportare in primo
piano la finestra principale. Dalle Impostazioni si può anche creare/rimuovere una scorciatoia
desktop che apre direttamente la ricerca.
- **Cerca** trasversale (fuzzy): ordini (n°/cliente/medico/importo/note/numeri lotto), spedizioni
  (corriere/cliente/data/numeri lotto), clienti, medici, agenti, prodotti, note, promemoria.
  Risultati **raggruppati per tipo**, navigabili da tastiera; `Enter`
  apre l'elemento (ordine → finestra Ordine, cliente → scheda, spedizione → tab Effettuate con
  il gruppo espanso e il collo evidenziato).
- **Anno di lavoro**: ordini, distinte e spedizioni storiche rispettano l'anno selezionato; i
  crediti ancora da saldare restano invece sempre cercabili, perché sono attività aperte.
- **Comandi rapidi**: "Nuovo ordine", "Nuovo rimborso", "Nuova distinta corriere", "Nuovo
  promemoria", "Messaggio", "Visualizza notifiche", "Apri il Cestino", "Controlla aggiornamenti",
  "Novità di questa versione", "Gioca a Flappy Livio", "Importa clienti storici", "Esporta clienti
  Aruba", "Mostra Pulizia dati", filtri smart per **pagamenti**, **spedizioni**, **distinte**,
  **provvigioni**, **rimborsi** e **Laboratorio**. Alcuni comandi completano il testo della ricerca
  (es. `pagamenti `, `spedizioni `, `distinte `) per guidare filtri più specifici.
- **Recenti** in cima quando il campo è vuoto. Veloce anche con molti dati: i testi cercabili sono
  indicizzati al caricamento e la lista risultati viene aggiornata in modo differito mentre si digita.
- Se il controllo remoto disattiva il gestionale, la finestra Spotlight viene distrutta come tutte
  le finestre secondarie: resta solo la finestra principale col messaggio di blocco.
- Spotlight non si apre se il bootstrap non ha un'identità valida o richiede ricollegamento; viene
  ricreato e reindicizzato automaticamente dopo l'onboarding.

### 7.11 Panoramica sincronizzazione (semplice)
Piccolo pannello aperto dalla pill sync in topbar — **solo una panoramica**, niente monitoraggio:
- **Stato**: online/offline + **"aggiornato … fa"** (timestamp dell'ultimo evento ricevuto).
- **Dispositivi/utenti**: elenco con **ultima attività** (derivata dagli eventi, **nessun polling**).
- **Azioni**: **Forza sincronizzazione**, **Apri cartella dati**, **Backup ora**.
- Avviso **solo** se la cartella dati non è raggiungibile (controllo on-demand all'apertura).

## 8. Stati & feedback globali
- **Loading**: skeleton nelle liste, spinner nei bottoni.
- **Vuoto**: empty-state con azione.
- **Errore**: toast + messaggio inline; mai stack trace all'utente.
- **Offline**: pill in topbar + **banner non invasivo** che appare **solo** quando il PC è offline
  ("le modifiche verranno sincronizzate al ritorno online") e **sparisce da solo** al rientro.
- **Promemoria backup**: avviso gentile se non se ne fa uno da N giorni (vedi §7.9 Backup).
- **Provvisorio**: badge giallo su numero ordine non ancora sincronizzato.
- **Conflitto/merge**: storico modifiche consultabile nel dettaglio (chi/quando).

## 9. Scorciatoie & accessibilità
- `Ctrl+K` ricerca · `Ctrl+N` nuovo ordine · `Ctrl+B` mostra/nascondi sidebar · `Esc` chiude modale/finestra · `Ctrl+S` salva.
- Focus visibile ovunque; navigazione da tastiera nei form; contrasto AA (testo scuro su giallo).
- Click target ≥ 32px; tooltip su icone.

## 10. Iconografia
Set coerente (es. **Tabler Icons**, incluso in Mantine): outline, 18–20px, colore ereditato.

## 11. Comportamento al ridimensionamento (resize coerente)

Requisito: **rimpicciolendo o allargando la finestra tutto resta coerente e usabile**, a
qualunque dimensione. Un **unico sistema responsive** governa l'intera app — nessuna schermata
con regole proprie.

### 11.1 Principi (validi ovunque)
- **Layout fluido**: niente larghezze fisse "magiche". Si usano `flex`/CSS `grid` con
  `minmax()`, percentuali e unità relative; mai px fissi per i contenitori principali.
- **Una sola fonte di breakpoint** (token condivisi), applicata da tutti i componenti.
- **Nessun overflow orizzontale della pagina**: solo aree designate (tabelle, corpi modali)
  hanno scroll proprio. Il resto rifluisce.
- **Testi lunghi**: troncamento con ellissi + **tooltip** (mai testo che "spinge" il layout).
- **Scaling Windows**: progettato per reggere display scaling **125%/150%** (comune sui
  portatili 1366×768 → risoluzione logica fino a ~1093×614). Le soglie sotto sono in px logici.

### 11.2 Finestre: minimi e massimi
- **Finestra principale**: min **900×600**. Sotto al minimo non si comprime: appare scroll,
  niente contenuti tagliati. (Configurato in `tauri.conf.json` → `minWidth/minHeight`.)
- **Finestre separate**: ognuna col proprio minimo (vedi §5); contenuto responsive identico
  alla finestra principale (la finestra Ordine rifluisce campi/tab quando viene ristretta).
- **Snap Windows** (mezza schermo ≈ 683px su 1366): l'app resta usabile in modalità "stretta".

### 11.3 Breakpoint di larghezza (px logici)
| Largh. | Sidebar | Card KPI / griglie | Form a colonne | Pannelli dashboard |
|---|---|---|---|---|
| `< 1100` | solo icone (60), auto | 2 per riga | 1 colonna | impilati (1 col) |
| `1100–1366` | comprimibile | 3 per riga | 2 colonne | 2 colonne |
| `1366–1600` | estesa (220) | 4 per riga | 2–3 colonne | 2 colonne |
| `> 1600` | estesa | 4–5 per riga | 2–3 colonne | 2–3 colonne |
- Allargando oltre **~1600px** il contenuto **non si stira all'infinito**: i form hanno
  `max-width` e restano leggibili; crescono semmai le tabelle e i gutter, non la larghezza dei campi.
- Le **griglie di card** usano `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))`:
  il numero di colonne si adatta da solo, senza breakpoint manuali.

### 11.4 Altezza (verticale)
- **Topbar e sidebar fissi**; l'**area contenuto** è `flex:1` con **scroll interno proprio**
  (la pagina non scrolla "tutta").
- **Tabelle e contenitori principali**: header (e toolbar) **sticky** in alto, corpo scrollabile → si riempie l'altezza disponibile tramite Flexbox (`flex: 1`, `minHeight: 0`, `overflow: auto`).
- **Form/modali/finestre**: **footer azioni sticky** in basso (Salva/Annulla sempre visibili);
  il corpo scrolla. Sotto altezze ridotte le **modali** diventano quasi full-height con scroll.
- **Validazione form in modali/finestre**: premendo Salva/Conferma con campi obbligatori mancanti,
  il primo campo problematico viene focalizzato, portato al centro dello scroll interno e richiamato
  con una pulsazione rosso chiarissimo sull'intero contenuto del campo, senza contorni rossi invasivi;
  non deve mai scrollare la view principale sotto l'overlay.
- Niente elementi che escono sotto i 600px di altezza: tutto ciò che eccede va in scroll dell'area, non della finestra.

### 11.5 Comportamenti per componente
- **Sidebar**: 3 stati (estesa ↔ solo icone ↔ nascosta), transizione fluida; toggle dalla
  sidebar (`«/»`) e dalla topbar (☰), scorciatoia `Ctrl+B`; **auto-collapse** a "solo icone"
  sotto soglia; ricorda la preferenza manuale dell'utente. Quando è nascosta, la ☰ in topbar la riapre.
- **Tabelle e viste pesanti**: implementata la **Cluster Virtualization** sia a livello di singola `Tabella` che per le liste lunghe (es. `ProvvigioniView`). Tramite `useIntersection` e `ResizeObserver` (+ `startTransition`), i contenuti fuori dallo schermo vengono smontati e sostituiti da segnaposto dell'altezza esatta, liberando memoria e azzerando i lag pur mantenendo fluidissimo lo scorrimento orizzontale/verticale. Le colonne hanno **priorità**; se manca spazio subentra lo **scroll orizzontale** (mai schiacciate).
  - L'adattamento della larghezza delle colonne su ridimensionamento (finestra o sidebar) è **debouncato a 200ms** per evitare layout-thrashing continuo.
  - Per nascondere gli scatti fisici durante il resize o l'animazione della sidebar, la tabella si sbiadisce (opacità `0.45`) all'istante all'avvio dell'azione e ritorna visibile (dissolvenza a `1` in `250ms`) a lavoro terminato (se l'impostazione "Riduci animazioni" è disattivata).
  - Le modifiche agli stili avvengono solo se i valori calcolati differiscono da quelli correnti, minimizzando i cicli di reflow del browser.
- **Dettaglio/Ordine a tab**: i tab restano sempre accessibili (eventualmente scrollabili);
  solo il contenuto del tab scrolla.
- **Toolbar/filtri**: i filtri in eccesso confluiscono in un menu "Altri filtri" quando manca larghezza.
- **Dashboard**: card e pannelli riflowano secondo §11.3; i mini-filtri periodo restano nelle card.

### 11.6 Verifica
- Ridimensionare **con continuità** da 900×600 fino a >1920×1080: nessun clipping, nessun
  overflow orizzontale di pagina, sticky (header tabella, footer form) sempre corretti.
- Provare **snap a metà schermo** e **zoom UI** 100/125/150%: layout coerente, scroll nelle aree giuste.
- Aprire più **finestre Ordine** affiancate e ridimensionarle singolarmente; lo stesso ordine, se
  già aperto sul PC, viene riportato in primo piano invece di duplicarsi.

## 12. Motion & animazioni (estetica "wow", ma coerente)

Obiettivo: app che sembra **viva e curata** — fade, zoom, slide, micro-interazioni e
caricamenti animati **ovunque**, ma sempre rapidi, fluidi e con uno scopo (feedback/orientamento),
mai invadenti o lenti.

### 12.1 Libreria & principi
- **Framer Motion** per le transizioni espressive (entrate/uscite, layout, gesture) + transizioni
  native Mantine per i casi semplici.
- **Solo proprietà GPU-friendly** (`transform`, `opacity`) → nessun jank su 1366×768 / PC modesti.
- Animazioni **brevi** e **interrompibili**; mai bloccare l'interazione.
- **Coerenza**: stessi token di durata/easing per tutta l'app.

### 12.2 Token motion
| Token | Valore | Uso |
|---|---|---|
| `dur-xfast` | 120ms | hover, press, micro-feedback |
| `dur-fast` | 160ms | toggle, tab, tooltip |
| `dur-base` | 220ms | modali, cambio vista, card |
| `dur-slow` | 320ms | finestre, overlay grandi |
| `ease-out` | `cubic-bezier(.2,.8,.2,1)` | entrate (default) |
| `ease-inout` | `cubic-bezier(.4,0,.2,1)` | movimenti/layout |
| `spring` | smorzato, soft | hover lift, drag, badge |

### 12.3 Dove (catalogo)
- **Cambio vista (route)**: crossfade + leggero slide/zoom (`opacity` + `translateY 8px` /
  `scale .98→1`), `dur-base`.
- **Modali**: backdrop fade + pannello `scale .96→1` + fade; uscita inversa.
- **Finestre separate**: contenuto entra con fade+zoom soft all'apertura.
- **Sidebar**: width animata estesa↔icone↔nascosta + **fade/stagger delle label**; tooltip in fade.
- **Liste/tabelle**: righe in **stagger fade-in** (sottile, ~20ms/riga, max ~10 righe poi istantaneo);
  riordino/aggiunta con **layout animation** (le righe scivolano al posto giusto).
- **Card dashboard**: entrata fade+zoom; **hover lift** (`translateY -2px` + ombra, spring).
- **Pulsanti**: hover (colore/ombra) `dur-xfast`; **press scale .98**; primario con micro **glow giallo**.
- **Caricamenti animati**: **skeleton shimmer** nelle liste; **spinner brandizzato** (giallo/nero);
  **progress bar** per export; loader "carino" a schermo intero con **logo PharmaTek che pulsa**.
- **Toast/notifiche**: slide-in da destra + fade; uscita in fade.
- **Badge**: numero **provvisorio** e stato **sync** con **pulse** soft; cambio **stato pagamento**
  in **cross-fade** del colore.
- **Promemoria scaduti**: leggero **attention pulse**.
- **Empty states**: piccola illustrazione con micro-animazione (loop lento).
- **Input/validazione**: errore con **shake** brevissimo + fade del messaggio.
- **Hover righe tabella / voci menu**: highlight morbido `dur-xfast`.
- **Numeri/importi che cambiano** (KPI dashboard): **count-up** animato.
- **Checkbox/spunta saldo, "fatto" promemoria**: animazione di **check** soddisfacente.

### 12.4 Accessibilità & controllo
- Rispetto di **`prefers-reduced-motion`**: riduce/azzera le animazioni non essenziali.
- Toggle **Impostazioni → Aspetto → "Riduci animazioni"** (override manuale).
- Le animazioni non devono mai ritardare un'azione: il contenuto è utilizzabile anche a metà transizione.

### 12.5 Verifica
- Su 1366×768 (anche scaling 125/150%) le animazioni restano **fluide (~60fps)**, nessun lag percepibile.
- Con "Riduci animazioni" / `prefers-reduced-motion` attivi: transizioni minime, app pienamente usabile.

## 13. Sistema avvisi unificato (modali & notifiche)

Un **unico servizio** per tutti i messaggi dell'app — niente `alert()` sparsi, comportamento
e stile coerenti ovunque. Due famiglie: **Dialog** (modali, bloccanti) e **Toast** (notifiche
in alto a destra, non bloccanti). Entrambe **sempre animate**.

### 13.1 Tipi (colore + icona coerenti)
`info` (blu) · `success` (verde) · `warning` (arancione) · `error` (rosso) · `question/conferma`
(accent). Ogni tipo ha icona e colore dedicati (vedi tokens §3).

### 13.2 Dialog / Modali (servizio `dialog`)
- API unica promise-based, es. `dialog.open({ tipo, titolo, contenuto, bottoni })`.
- **Bottoni configurabili** (array): ognuno con `label`, `variante` (primario/secondario/
  pericolo/ghost), `azione`, eventuale `autofocus`/`chiudiSu`. Supporta **più di due bottoni**.
- Scorciatoie: `Esc` = annulla, `Enter` = bottone primario.
- Varianti pronte: `confirm` (Conferma/Annulla), `confirmDanger` (azione distruttiva, primario
  rosso), `prompt` (con input), `alert` (un solo bottone). Contenuto può essere testo o **custom** (componente).
- Animazione: backdrop fade + pannello `scale .96→1` (§12).

### 13.3 Toast / Notifiche (servizio `toast`)
- Posizione **alto a destra**, a **mazzo**: una sola toast visibile/interattiva, le altre
  restano dietro con badge `+N`. Timer e `×` chiudono quella davanti e mostrano la successiva;
  niente ricalcolo verticale o flicker. Le card dietro sono solo accenni decorativi, non pannelli
  pieni che possono sovrapporsi alla card attiva.
- Contenuto: icona del tipo, titolo, messaggio, **azioni opzionali** (es. "Annulla", "Apri").
- **Auto-dismiss con countdown**: una **barra di avanzamento in basso** che si **riduce**
  man mano (durata default 4s, configurabile; gli `error` possono restare finché chiusi).
- **Hover = pausa**: passando il mouse sopra, il timer si **ferma** e la toast **resta**; al
  `mouseleave` il countdown **riprende**. Pulsante **× chiudi** sempre presente.
- Tipi: `info/success/warning/error`; opzione `loading` che poi si trasforma in success/error
  (es. "Esportazione…" → "Esportato").

### 13.4 Regole d'uso
- **Conferme/decisioni** e azioni distruttive → **Dialog**. **Esiti/feedback** rapidi → **Toast**.
- Linguaggio semplice in italiano; mai messaggi tecnici grezzi all'utente.
- Coda e de-duplica: messaggi identici ravvicinati non si accavallano.
- Le modifiche concorrenti dello stesso campo seguono Last-Write-Wins e non generano banner
  persistenti nel form. Le precondizioni di dominio non più valide (record eliminato, rata già
  saldata, riga già spedita) usano un toast sopra la modale; se il record non esiste più, il
  dettaglio si chiude. Le finestre separate possono usare un dialog centrale prima della chiusura.
  I record consultabili ma non modificabili, come un pagamento già incluso in distinta, mostrano
  campi disabilitati e un badge esplicativo nel footer sempre visibile.

## 14. Esportazioni

L'export è una **capability di prima classe**, presente ovunque, sempre con anteprima.

### 14.1 Export "di vista" (ogni tabella)
- Bottone **Esporta** nella barra strumenti di ogni tabella → esporta **la vista corrente già
  filtrata/ordinata** in **Excel (.xlsx) · CSV · PDF**. Disponibile su Giornaliero, Contabilità
  (estratto crediti/scadenzario), Anagrafiche, Provvigioni, ecc.

### 14.2 Export dedicati (finestra Anteprima stampa/export)
- **Corrieri**: file **CORRIERE_B / CORRIERE_A** dal template (vedi FASE 4).
- **Produzione**: **Excel Laboratorio** allergeni/posologie (FASE 5).
- **Provvigioni**: riepilogo per agente/periodo (FASE 2).
- **Contabilità**: estratto crediti / scadenzario rate.
- Ogni anteprima offre **Esporta file (Excel/PDF) + Stampa diretta** (vedi §5).

### 14.3 Regole
- L'export rispetta filtri, colonne visibili e ordinamento correnti.
- Importi in formato italiano (€, 2 decimali); intestazioni leggibili; data/ora di generazione.
- Operazione **non bloccante** con toast di avanzamento ("Esportazione…" → "Esportato").

---

### Deciso
- **Dashboard**: niente filtro periodo globale (solo mini-filtri per-card dove serve); KPI
  Ordini, Da saldare (spediti/non spediti), In produzione/in arrivo, (sec.) Provvigioni;
  pannelli **Promemoria in scadenza (con gestione inline)** e **Note da ricordare**.
- **Export**: anteprima con **export file (Excel/PDF) + stampa diretta**.
- **Onboarding**: avatar predefiniti (bundlati, offline) o **foto da PNG/JPG** con crop; gestione
  utente già esistente (usa / riconfigura / crea nuovo); modifica poi da Impostazioni → Profilo.
- **Motion**: sistema animazioni (Framer Motion) con token durata/easing, fade/zoom/slide,
  caricamenti animati, micro-interazioni — disattivabile ("Riduci animazioni" / reduced-motion).
- **Dashboard grafici**: andamento ordini&incassi, ordini per stato (torta), spediti/non spediti
  (torta), top agenti, per regione — animati e configurabili.
- **Colonne**: nascoste di default quelle implicite/derivabili (Agente, Regione, CAP, contatti…).
- **Inserimento rapido ordine**: auto-compilazione da cliente esistente senza conferme, con
  fallback non distruttivo "nuovo cliente" se i dati divergono (§7.3.1).
- **Avvisi unificati** (§13): servizio `dialog` (modali multi-bottone tipizzate) + `toast` (alto
  a destra, animate, con barra countdown che si riduce e **pausa all'hover**).
- **Rateizzi** (§7.4 Pagamenti, FASE 3): dialog "Rateizza" con **calcolo automatico delle rate**
  dal numero di rate (ultima rata aggiusta i centesimi), anteprima modificabile, rate con stato
  e scadute evidenziate.
- **Filtri contabili** ricchi (stato/conto/periodo/agente/cliente/spediti-non/rate scadute) e
  **Esportazioni** di prima classe (§14): export "di vista" Excel/CSV/PDF + export dedicati con stampa.
- **Note**: thread + categorie, **allegati immagini/file** (in `allegati/`), **@menzioni** (notificano),
  pin "da ricordare". **Promemoria condivisi** (bacheca team) con priorità, ricorrenza, notifica anticipata.
  **Notifiche** = solleciti + promemoria (scadenza/anticipo) + menzioni (le note normali non notificano).
- **Sicurezza dati**: eliminazioni = **soft-delete → Cestino** (ripristinabile); **storico** per
  record + **undo** di una modifica.
- **Anni**: **store unico continuo** con filtri per anno/periodo (numero ordine per-anno).
- **Stato ordine**: nessuno stato "preventivo inviato"; il preventivo espone separatamente ultima
  modifica e ultimo invio riuscito. Il valore della colonna economica resta **Importo** (totale
  righe).
  **Automazioni**: acconto → in produzione · saldo completo → saldato/fatturabile.
- **Salute sync & dispositivi** (§7.11): chi è online, ultima sync, PC fermo, OneDrive in pausa.
- **Backup** automatico/manuale + ripristino (fuori da OneDrive, retention).
- **Ricerca globale & comandi** `Ctrl+K` (§7.10) trasversale + azioni rapide.
- **Panoramica sync semplice**: nessun heartbeat/polling; ultima attività per dispositivo
  **derivata dagli eventi** on-demand; forza sync + apri cartella + backup ora. Freschezza
  ("aggiornato 2 min fa") **solo nel tooltip al hover**. **Banner offline** non invasivo +
  **promemoria backup** se non fatto da N giorni.
- **Evasione a livello di riga** (`da_spedire`/`spedita`, niente step "arrivi"): **Spedizioni
  parziali** (seleziona tutto/puntuale, più ordini) + **aggiunta rapida riga mancante** (chiede
  ogni volta se incide sul totale); **"Spedizioni effettuate"** raggruppate.
- **Dati di fatturazione** opzionali sull'ordine (sezione a comparsa); se vuoti → si usano quelli del cliente.

- **Menu a 6 voci**: Dashboard · Giornaliero · Contabilità (tab Pagamenti/Provvigioni/Rimborsi) ·
  Evasione ordini (tab Produzione/Spedizioni) · Anagrafiche (gruppo + switcher interno) ·
  Impostazioni. Promemoria/Notifiche nella campanella + Dashboard.

### Cosa manca da decidere insieme
- Eventuali campi extra specifici del vostro flusso (tabelle/dettaglio).
