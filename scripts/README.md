# Script di automazione (PowerShell)

Eseguibili dalla root del progetto (anche da una sottocartella: usano percorsi assoluti).

| Script | Cosa fa |
|---|---|
| `scripts/dev.ps1` | Avvia l'app in sviluppo (`tauri dev`); installa le dipendenze se mancano. |
| `scripts/test.ps1` | Typecheck + build frontend e `cargo test` (+ clippy se presente). |
| `scripts/build.ps1` | Pulisce le build Tauri precedenti, poi crea l'installer Windows; firma per auto-update se configurata. `-Version X.Y.Z` allinea `tauri.conf.json`, `package.json` e `package-lock.json` prima di buildare. |
| `scripts/release.ps1` | Rilascio completo e controllo remoto globale: versione → build firmata → `latest.json` → release GitHub `vX.Y.Z` e blocco/riattivazione dell'app (richiede `gh`). |
| `scripts/premium.ps1` | Menu autonomo per attivare, disattivare o controllare il premium esclusivamente sul PC corrente; non usa Git, rete o altri script. |

## Uso

```powershell
# Sviluppo
./scripts/dev.ps1

# Test / controlli
./scripts/test.ps1
./scripts/test.ps1 -SkipRust        # solo frontend

# Build di produzione (esegue prima i test)
./scripts/build.ps1
./scripts/build.ps1 -SkipTests      # build veloce senza test
./scripts/build.ps1 -Version 0.2.0  # imposta la versione e builda

# Pulizia manuale degli artefatti Rust/Tauri (equivale a cargo clean)
npm run clean:tauri

# Rilascio completo (versione → build firmata → latest.json → release GitHub)
./scripts/release.ps1 -Version 0.2.0 -Notes "Cosa cambia"
./scripts/release.ps1 -Version 0.2.0 -Draft   # bozza, per provare il flusso

# Solo gestione premium (menu dedicato)
./scripts/premium.ps1
./scripts/premium.ps1 -Enable                 # attiva localmente su questo PC
./scripts/premium.ps1 -Disable                # disattiva localmente su questo PC
./scripts/premium.ps1 -Status                 # mostra soltanto lo stato locale
```

Funzionano anche con **tasto destro → "Esegui con PowerShell"**: la finestra resta aperta a
fine esecuzione (e in caso di errore) così puoi leggere l'output. Da terminale/automazione usa
`-NoPause` per non fermarti alla fine.

> Se l'esecuzione degli script è bloccata dalla policy:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

## Firma per l'auto-aggiornamento

Per produrre pacchetti firmati (necessari all'updater), impostare prima della build:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.tauri\pharmatek.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "la-tua-password"
./scripts/build.ps1
```

Dettagli completi (generazione chiavi, pubblicazione, host) in
[`docs/AGGIORNAMENTI.md`](../docs/AGGIORNAMENTI.md).
