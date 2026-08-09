# Script di automazione (PowerShell)

Eseguibili dalla root del progetto (anche da una sottocartella: usano percorsi assoluti).

| Script | Cosa fa |
|---|---|
| `scripts/dev.ps1` | Avvia l'app in sviluppo (`tauri dev`); installa le dipendenze se mancano. |
| `scripts/test.ps1` | Typecheck + build frontend e `cargo test` (+ clippy se presente). |
| `scripts/build.ps1` | Pulisce le build Tauri precedenti, poi crea l'installer Windows. `-Version X.Y.Z` allinea `tauri.conf.json`, `package.json` e `package-lock.json` prima di buildare. |

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

```

Funzionano anche con **tasto destro → "Esegui con PowerShell"**: la finestra resta aperta a
fine esecuzione (e in caso di errore) così puoi leggere l'output. Da terminale/automazione usa
`-NoPause` per non fermarti alla fine.

> Se l'esecuzione degli script è bloccata dalla policy:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

La variante pubblica non include script capaci di creare o pubblicare GitHub Releases.
