# Aggiornamenti automatici dell'app

Obiettivo: l'app **cerca gli aggiornamenti**, **scarica** il pacchetto, lo **installa in
silenzio** e si **riavvia**, senza intervento dell'utente.

## Come funziona (updater Tauri 2)

Si usa l'**updater integrato di Tauri** (plugin ufficiale). Il meccanismo:

1. All'avvio (e/o periodicamente) l'app legge un **manifest** `latest.json` da un **URL** (endpoint).
2. Confronta la versione nel manifest con quella installata.
3. Se è più recente, **scarica** l'installer indicato, **verifica la firma** (chiave pubblica
   inclusa nell'app), lo **installa silenziosamente** e **riavvia** l'app.

La firma è obbligatoria: gli aggiornamenti sono firmati con una **chiave privata** (che resta solo
sulla tua macchina di build) e verificati con la **chiave pubblica** dentro l'app. Questo impedisce
aggiornamenti malevoli.

### Esempio di `latest.json`
```json
{
  "version": "0.2.0",
  "notes": "Correzioni e migliorie",
  "pub_date": "2026-06-08T10:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contenuto del file .sig generato dalla build>",
      "url": "https://.../PharmaTek_0.2.0_x64-setup.exe"
    }
  }
}
```

## Host scelto: **GitHub Releases** (repo **PRIVATO** → con token)

Il repo `Luke3012/Gestionale-PharmaTek` è **privato**. Gli URL pubblici di GitHub
(`releases/latest/download/...`) su un repo privato rispondono **404 in anonimo** → l'updater
falliva con *«Could not fetch a valid release JSON from the remote»*. Quindi serve **autenticare**
le richieste con un token, e ospitare manifest+installer su URL che il token sa raggiungere:

Tutto passa da **`api.github.com`** (gli unici endpoint dove un token *fine-grained* è garantito):

- **Manifest** `latest.json`: pubblicato come **file nel repo** in `.updater/latest.json` (lo fa
  `release.ps1` via API) e letto dall'updater dalla **Contents API**
  `https://api.github.com/repos/Luke3012/Gestionale-PharmaTek/contents/.updater/latest.json` con header
  `Accept: application/vnd.github.raw` (restituisce il file grezzo).
- **Installer**: resta un **asset della release**, ma in `latest.json` l'`url` è l'**URL API**
  dell'asset (`https://api.github.com/repos/.../releases/assets/<id>`), scaricabile col token
  inviando `Accept: application/octet-stream`.

I due `Accept` sono **incompatibili in un'unica richiesta** (un header combinato fa restituire
all'asset i metadati JSON invece dei byte), ma `check()` (manifest) e `downloadAndInstall()`
(installer) sono **due chiamate distinte**: l'app passa a ciascuna il proprio set di header, con
`Authorization: token <PAT>`. Il token è iniettato a build-time in `VITE_DEMO_UPDATER_DISABLED` e finisce
**dentro il bundle**.

> ⚠️ **Sicurezza:** un token nel bundle è **estraibile** da chi ha l'eseguibile. Usa un PAT con
> **privilegi minimi** (sola lettura del **solo** repo delle release) e tienilo
> **scaduto/ruotabile**. Se l'app un domani non dovesse più essere segreta, l'alternativa più
> sicura è rendere **pubblico** un repo dedicato alle sole release (niente token).

### Token updater (una volta)

1. Crea un **fine-grained PAT** su GitHub → *Settings ▸ Developer settings ▸ Personal access
   tokens ▸ Fine-grained* → **Resource owner** = il tuo account, **Only select repositories** =
   `PharmaTek`, **Permissions ▸ Contents = Read-only**. (In alternativa un classico PAT con scope
   `repo`, più ampio.)
2. Salvalo in `~/.tauri/pharmatek-updater-token.txt` (una sola riga). `build.ps1`/`release.ps1` lo
   caricano da lì in `VITE_DEMO_UPDATER_DISABLED`. Il file **non** va versionato.
3. Ricorda la **scadenza**: quando il token scade, va rigenerato e l'app **ricompilata/ripubblicata**
   (le installazioni esistenti continueranno a fallire l'update finché non installano una build con
   token valido).

## Quando controlla (deciso, FASE 7B)

- **All'avvio** dell'app e poi **ogni ~6 ore**, in modo non bloccante. Se l'app è in uso il
  controllo mostra una notifica persistente; se è realmente inattiva nella tray può applicare
  l'aggiornamento in background come descritto sotto.
- **Supporto al Background e Notifiche Custom**: Poiché WebView2 sospende il codice JS delle finestre nascoste nella tray (avvio `--minimized`), se l'utente ha abilitato i pop-up (`balloonAttivo` in Impostazioni):
  - Il controllo periodico viene eseguito dalla finestra trasparente **`OverlayWindow`** (che resta sempre attiva in background).
  - L'avviso viene mostrato come **notifica custom persistente** (card nell'overlay) ed esclude la notifica toast nella finestra principale per evitare doppioni.
  - Se le notifiche custom sono disabilitate, il controllo ricade su **`useAggiornamenti.ts`** che mostra un toast in-app solo quando la finestra principale è visibile.
- Se l'app è nascosta nella tray, senza finestre utente aperte e inattiva da almeno 30 minuti,
  l'aggiornamento può essere installato e riavviato in modo completamente silenzioso. Questo
  vale anche quando l'avvio automatico con Windows è disabilitato: l'autostart decide come parte
  l'app, non se un processo già aperto può aggiornarsi.
  L'idoneità all'installazione silenziosa viene rivalutata ogni 15 minuti, mentre il normale
  avviso di disponibilità mantiene il controllo periodico a 6 ore.
- **Deduplica dell'avviso**: toast main e overlay condividono `pt.aggiornamentoAvvisato` con la
  versione trovata e una breve finestra temporale; la prima finestra che prenota l'avviso lo
  mostra, l'altra si ferma. Questo evita race condition e doppi inviti quando l'app passa fra tray,
  main visibile e overlay, senza zittire per sempre una versione non ancora installata.
- **Gate nativo di sicurezza**: `localStorage` evita i doppi click, ma la garanzia autorevole è
  nel backend Rust. Prima di preparare il riavvio l'updater blocca atomicamente l'avvio di nuovi
  invii email/WhatsApp, backup e manutenzioni; se una di queste attività è già in corso,
  l'aggiornamento viene rinviato e ritentato senza interromperla.
- **Pulsante manuale** «Controlla aggiornamenti» nella **finestra Info** (menu utente → Info):
  mostra subito lo stato di controllo e, se c'è una versione nuova, installa con riavvio.

## Controllo remoto del gestionale

Oltre al manifest degli aggiornamenti, l'app legge un piccolo manifest di controllo remoto:

- `.updater/control.json`
- `.updater/control.json.sig`

Il file vive nello stesso repo GitHub privato ed è letto via Contents API con lo stesso token
updater. La sicurezza non dipende dal token (estraibile dal bundle), ma dalla firma: `control.json`
è accettato solo se `control.json.sig` è valido con la stessa chiave pubblica Tauri già incorporata
nell'app per verificare gli aggiornamenti.

Formato del manifest:

```json
{
  "schema": 1,
  "app": "pharmatek",
  "disabled": false,
  "message": "",
  "updatedAt": "2026-07-03T00:00:00Z"
}
```

Comportamento dei client:

- se il manifest remoto è valido, viene applicato e salvato in cache locale;
- se GitHub o internet non sono disponibili, viene usata l'ultima cache valida;
- se non esiste ancora una cache valida, il gestionale è considerato **attivo**;
- il controllo avviene all'avvio dentro le schermate/animazioni già esistenti, senza testo
  dedicato, e poi con la stessa cadenza degli aggiornamenti (circa ogni 6 ore);
- il pulsante manuale **«Controlla aggiornamenti»** esegue prima questo controllo: se il manifest
  remoto disattiva l'app, il controllo aggiornamenti non prosegue; se il controllo remoto fallisce
  per rete/GitHub, l'errore viene ignorato e il controllo aggiornamenti continua normalmente;
- quando un webview rileva un cambio di stato remoto, emette un evento Tauri locale
  `pt:controllo-remoto-cambiato` per avvisare le altre finestre già aperte. Questo evento serve a
  propagare il **blocco**; non sblocca automaticamente il gestionale;
- se `disabled` è `true`, resta visibile solo la finestra principale (`main`) con il blocco remoto;
  tutte le finestre esterne/secondarie vengono distrutte, incluse finestre ordine, riepiloghi,
  pagamenti, promemoria, Info, Notifiche, Cestino, Spotlight e overlay notifiche;
- dopo la riattivazione remota l'utente deve premere **Riprova** nella finestra principale. Il
  pulsante ricontrolla il manifest, rifà il bootstrap se necessario, ricrea l'overlay tecnico delle
  notifiche e rimonta la Shell. Le finestre utente chiuse dal blocco non vengono riaperte da sole.

Gestione da `release.ps1`:

```powershell
./scripts/release.ps1 -RemoteDisable -RemoteMessage "Gestionale temporaneamente non disponibile."
./scripts/release.ps1 -RemoteEnable
./scripts/release.ps1 -RemoteStatus
```

Avviando `./scripts/release.ps1` senza parametri, lo script mostra anche un menu interno per
pubblicare una release, disattivare/riattivare il gestionale, leggere lo stato remoto o uscire.
Le azioni remote non avviano build, non cambiano
versione e non modificano `.updater/latest.json`: preservano i campi esistenti, firmano con
`~/.tauri/pharmatek.key` e pubblicano JSON+firma nello stesso commit GitHub atomico.

> Limite importante: il blocco remoto funziona solo sulle installazioni che hanno già ricevuto una
> versione dell'app con questo controllo integrato.

## Accesso premium locale

Il gate premium è separato dal controllo remoto globale. La scelta vive esclusivamente in:

`%APPDATA%\it.pharmatek.gestionale\premium.json`

Si gestisce con lo script autonomo:

```powershell
./scripts/premium.ps1
./scripts/premium.ps1 -Enable
./scripts/premium.ps1 -Disable
./scripts/premium.ps1 -Status
```

`premium.ps1` non usa Git, GitHub, rete, firma o altri script e non accetta percorsi o dispositivi
alternativi. In assenza di `premium.json`, oppure se il file non è valido, il premium resta
bloccato. Il backend legge il file locale a ogni controllo e applica lo stesso gate anche ai
futuri comandi e processi automatici; il manifesto remoto continua a governare soltanto il blocco
globale dell'app.

## Configurazione (già cablata ✓)

- `package.json`: `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`.
- `src-tauri/Cargo.toml`: `tauri-plugin-updater` + `tauri-plugin-process`.
- `src-tauri/src/lib.rs`: plugin registrati (`updater` + `process`).
- `src-tauri/tauri.conf.json`: `bundle.createUpdaterArtifacts = true` e
  ```json
  "plugins": {
    "updater": {
      "endpoints": ["https://api.github.com/repos/Luke3012/Gestionale-PharmaTek/contents/.updater/latest.json"],
      "pubkey": "<inserita la chiave pubblica generata>",
      "windows": { "installMode": "quiet" }
    }
  }
  ```
- `src-tauri/capabilities/default.json`: permessi `updater:default`, `process:allow-restart`.
- Frontend (`src/updater.ts` + `src/App.tsx`): all'avvio `check()` → se c'è aggiornamento,
  `downloadAndInstall()` → `relaunch()`; **silenzioso** (installMode `quiet`), non bloccante,
  fallisce in silenzio se offline. Pulsante "Cerca aggiornamenti" per il controllo manuale.
- Chiavi di firma generate in `~/.tauri/pharmatek.key` (senza password), **gitignorate**.

## Generazione delle chiavi di firma (una volta)

```powershell
npx tauri signer generate -w $HOME\.tauri\pharmatek.key
```
Produce la **chiave privata** (`pharmatek.key`, da **non** versionare né condividere) e la
**chiave pubblica** (da incollare in `tauri.conf.json` → `plugins.updater.pubkey`).

## Pubblicare un aggiornamento (flusso automatico, FASE 7B)

Dopo aver allineato la versione in `tauri.conf.json`, `package.json` e `package-lock.json`,
**committa e pubblica il commit sul branch predefinito**. Da quel commit un solo comando esegue
test, build firmata, `latest.json` e release GitHub:

```powershell
./scripts/release.ps1 -Version 0.2.0 -Notes "Cosa cambia in questa versione"
```

Lo script:
1. richiede worktree pulito, versioni allineate e `HEAD` identico al branch remoto predefinito;
2. esegue **tutti i test** e la build firmata (riusa `build.ps1`, carica la chiave da `~/.tauri/pharmatek.key` e il
   token updater da `~/.tauri/pharmatek-updater-token.txt`);
3. crea la **release GitHub** `v0.2.0` sul commit esatto già testato, col solo installer allegato;
4. ricava l'**URL API** dell'asset installer e **compone `latest.json`** (firma + URL autenticato);
5. **pubblica `latest.json`** nel repo come `.updater/latest.json` (via API `gh`), così la Contents
   API lo serve all'updater.

I client si aggiornano da soli al controllo successivo (avvio o ogni ~6 h), oppure col pulsante
manuale. Prerequisiti: `gh` CLI autenticata (`gh auth login`), la chiave di firma e il **token
updater** presenti.

- `-Draft` crea la release come **bozza** (per provare il flusso senza distribuire: i client la
  ignorano finché non la pubblichi a mano su GitHub).
I test non sono saltabili da `release.ps1`: una release deve sempre partire dallo stesso commit
pulito e verificato che viene associato al tag.

> Nota sul nome file: l'asset viene caricato come `PharmaTek_<versione>_x64-setup.exe` (senza spazi)
> così l'URL in `latest.json` è prevedibile (GitHub sostituirebbe gli spazi con punti).

### Solo build (senza pubblicare)

```powershell
./scripts/build.ps1 -Version 0.2.0    # imposta la versione e builda l'installer firmato
```

Al termine, `build.ps1` apre automaticamente Explorer selezionando l'installer generato
più recente, così è immediato trovarlo o provarlo.

## Changelog e novità in-app (FASE 7C)

Sorgente unica: **`src/features/changelog/changelog.json`** (una sezione per versione, dalla
più recente alla prima). Ogni voce ha `versione`, `data`, `sintesi` (riga mostrata nella
notifica di aggiornamento) e `voci` (elenco per categoria: `novita` / `correzioni` / `altro`).
Una versione con la **sola sintesi** (nessuna voce) **non** apre il pannello «Novità»: resta
solo nello storico e nel toast.

Lo stesso file alimenta:
- **Pannello «Novità»** all'avvio, dopo un aggiornamento, **prima** della dashboard (e della sua
  intro animata). Compare **una sola volta per versione** (localStorage `pt.changelogVisto`); i
  nuovi utenti non lo vedono. Implementazione: `src/features/changelog/NovitaPanel.tsx`, gate in
  `src/App.tsx` (`AvvioConNovita`).
- **Storico** nella finestra Info (pulsante «Novità e changelog»): timeline dalla versione più
  recente alla prima (`src/features/changelog/StoricoChangelog.tsx`).
- **Note dell'updater**: `release.ps1` legge `changelog.json` e usa la `sintesi` come `notes` del
  manifest (→ toast «Aggiornamento disponibile») e il corpo per-categoria come note della release
  GitHub. Un `-Notes` esplicito ha la precedenza.

### Gestire il changelog (editor grafico)

```powershell
./scripts/changelog.ps1     # apre una pagina web locale per aggiungere versioni/voci e salvare
```
Salvando si aggiorna `changelog.json` e si rigenera `docs/CHANGELOG.md`. Aggiungi la voce della
**nuova versione PRIMA** di lanciare `release.ps1`, così le note partono da sole.

## Stato — ATTIVO ✓

Auto-update completamente cablato e verificato. Per distribuire un aggiornamento:
`./scripts/release.ps1 -Version X.Y.Z -Notes "…"`.

> Promemoria: **non perdere** `~/.tauri/pharmatek.key`, altrimenti non potrai più firmare
> aggiornamenti compatibili con le versioni già installate.

## 29 Giugno 2026
- **Fase 10 Completata**: Implementata l'importazione intelligente e sicura (con validazione dei file Excel e sanitizzazione email) delle anagrafiche clienti dai vecchi file storici (Generale, Giornalieri, Report).
- **Esportazione Aruba**: Implementata l'esportazione ottimizzata per Aruba con generazione opzionale e volatile di Codici Fiscali provvisori.
- **Ottimizzazioni UI**: Risolti i conflitti dei tasti ESC nei modali annidati e migliorate le performance di re-rendering condizionale nei modali (es. form registrazione). Ridisegnato e ripulito esteticamente il modale di Importazione Anagrafiche.
- **Transizioni di Uscita ed Animazioni**: Abilitate le transizioni di uscita complete (con `framer-motion` `exit="exit"`) anche per le sezioni Giornaliero, Produzione, Spedizioni e Contabilità.
- **Correzione Spedizioni Demo**: Aggiornato il generatore demo per popolare spedizioni con colli multipli e pesi coerenti.
- **Esportazione Distinte Corriere**: Perfezionata la distinta corrieri. Le esportazioni CORRIERE_B ed CORRIERE_C raggruppano i lotti in un'unica riga con formato compresso (es. `508213/34`), mentre Corriere A genera una riga separata per ciascun lotto. In entrambi i casi, colli e peso sono forzati a 1 per soddisfare i requisiti logistici.
- **Spedizioni Effettuate Modificabili**: Aggiunto il popover "Modifica dati spedizione" sui colli già effettuati. Permette di correggere destinatario, indirizzo, contatti, colli/peso, preavviso telefonico e numeri/lotti senza modificare l'ordine o l'anagrafica; i lotti restano sulle righe prodotto, così sopravvivono all'annullo del collo.
- **Spedizioni: parziali e distinte allineate**: il popover dati spedizione ora scrolla internamente, include autocomplete CAP/città e salva il singolo collo senza refresh pieno della vista. La distinta Corriere A genera sempre una riga per prodotto anche senza numero/lotto, mentre CORRIERE_B/CORRIERE_C restano compattate. Il COD/saldo logistico delle spedizioni parziali è calcolato sui soli prodotti spediti meno quota proporzionale dell'acconto ordine; la contabilità dell'ordine resta separata.
- **Modali pesanti più rapidi**: Paga provvigioni, Storico provvigioni e Nuova/Dettaglio distinta mantengono le tabelle compatte con altezza contenuto/max e scroll verticale solo quando serve. Crea spedizione e Invio in produzione montano solo le card vicine allo scroll visibile. Le distinte corriere e la creazione spedizione bloccano il salvataggio se i dati selezionati sono cambiati da un altro client.
