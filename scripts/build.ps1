#requires -Version 5.1
<#
.SYNOPSIS
  Build di produzione dell'app (installer Windows via Tauri).
.DESCRIPTION
  Esegue: controllo toolchain -> npm install -> scelta test -> pulizia build precedenti -> tauri build.
  Carica automaticamente la chiave di firma da ~/.tauri/pharmatek.key (se presente),
  così l'installer viene firmato per l'auto-aggiornamento (vedi docs/AGGIORNAMENTI.md).
.PARAMETER Version    Imposta la versione (X.Y.Z) di app e installer prima di buildare
                      (aggiorna src-tauri/tauri.conf.json, package.json e package-lock.json).
                      Se omesso usa la versione gia' presente nei file.
.PARAMETER SkipTests  Non eseguire i test prima della build.
.PARAMETER NoPause    Non mettere in pausa a fine script (uso da terminale/automazione).
.NOTES
  Funziona anche con "Esegui con PowerShell" (tasto destro): la finestra resta aperta.
#>
param(
    [string]$Version,
    [switch]$SkipTests,
    [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# Aggiorna il campo "version" (prima occorrenza) di un file JSON senza riformattarlo.
function Set-JsonVersion($path, $version, $occurrences = 1) {
    $raw = [System.IO.File]::ReadAllText($path)
    $rx = [regex]'"version"\s*:\s*"[^"]*"'
    if (-not $rx.IsMatch($raw)) { throw "Campo version non trovato in $path" }
    $new = $rx.Replace($raw, "`"version`": `"$version`"", $occurrences)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $new, $utf8NoBom)
}

function Invoke-Pause($msg) {
    if (-not $NoPause -and $Host.Name -eq 'ConsoleHost') { Read-Host $msg | Out-Null }
}
trap {
    Write-Host "`nERRORE: $($_.Exception.Message)" -ForegroundColor Red
    Invoke-Pause 'Premi Invio per chiudere'
    exit 1
}

if (-not $Version -and -not $NoPause -and $Host.Name -eq 'ConsoleHost') {
    Write-Host "=== Configurazione Build PharmaTek ===" -ForegroundColor Cyan
    $inputVersion = Read-Host "Inserisci la versione da impostare (premi Invio per mantenere quella attuale)"
    if ($inputVersion) {
        $Version = $inputVersion
    }
}

Set-Location $root
function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Require-Cmd($name, $hint) {
    if (-not (Test-Cmd $name)) { throw "Manca '$name'. $hint" }
}

Require-Cmd node  "Installa Node.js da https://nodejs.org"
Require-Cmd npm   "Incluso in Node.js"
Require-Cmd cargo "Installa Rust: winget install Rustlang.Rustup (poi riapri il terminale). Serve anche il C++ Build Tools."

# Imposta la versione richiesta in app + installer.
if ($Version) {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Versione '$Version' non valida: usa il formato X.Y.Z" }
    Write-Host "Imposto la versione $Version (tauri.conf.json + package.json + package-lock.json)..." -ForegroundColor Cyan
    Set-JsonVersion (Join-Path $root 'src-tauri/tauri.conf.json') $Version
    Set-JsonVersion (Join-Path $root 'package.json') $Version
    # npm duplica la versione del progetto al livello radice e in packages[""].
    Set-JsonVersion (Join-Path $root 'package-lock.json') $Version 2
}

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host "Installo le dipendenze..." -ForegroundColor Cyan
    npm install
}

if (-not $SkipTests -and -not $NoPause -and $Host.Name -eq 'ConsoleHost') {
    $testChoice = Read-Host "Vuoi eseguire i test prima della build? (S/n)"
    if ($testChoice -eq 'n' -or $testChoice -eq 'N') {
        $SkipTests = $true
    }
}

if (-not $SkipTests) {
    Write-Host "Eseguo i controlli/test..." -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot 'test.ps1') -NoPause
    if ($LASTEXITCODE -ne 0) { throw "Test falliti: build interrotta." }
} else {
    Write-Host "Test saltati." -ForegroundColor Yellow
}

# Carica automaticamente la chiave di firma dal percorso predefinito, se non gia' impostata
$defaultKey = Join-Path $HOME '.tauri\pharmatek.key'
$firmaManualePasswordVuota = $false
if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and (Test-Path $defaultKey)) {
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $defaultKey -Raw
    Write-Host "Chiave di firma caricata da $defaultKey" -ForegroundColor Green
}
if ($env:TAURI_SIGNING_PRIVATE_KEY) {
    # Windows elimina le variabili d'ambiente impostate a stringa vuota. Il CLI
    # Tauri interpreta quindi una chiave senza password come richiesta interattiva
    # e può restare in attesa dopo aver creato l'EXE. In quel caso costruiamo senza
    # firma automatica e firmiamo esplicitamente l'installer con `--password=` più sotto.
    $firmaManualePasswordVuota = [string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)
    Write-Host "Firma updater: ATTIVA (il pacchetto sara' firmato)." -ForegroundColor Green
} else {
    if ($env:PHARMATEK_REQUIRE_UPDATER_CREDENTIALS -eq '1') {
        throw "Nessuna chiave di firma: build di rilascio interrotta."
    }
    Write-Warning "Nessuna chiave di firma trovata: il pacchetto NON sara' firmato (auto-update non funzionera')."
    Write-Warning "Genera le chiavi: npx tauri signer generate -w `"$HOME\.tauri\pharmatek.key`" --ci"
}

# Token updater per repo PRIVATO: viene iniettato in VITE_DEMO_UPDATER_DISABLED e finisce nel bundle,
# cosi' l'app autenticata puo' scaricare manifest+installer (vedi src/updater.ts). Caricato dal
# percorso predefinito se non gia' impostato. Usa un token a SOLA LETTURA del solo repo release.
$defaultToken = Join-Path $HOME '.tauri\pharmatek-updater-token.txt'
if (-not $env:VITE_DEMO_UPDATER_DISABLED -and (Test-Path $defaultToken)) {
    $env:VITE_DEMO_UPDATER_DISABLED = (Get-Content $defaultToken -Raw).Trim()
    Write-Host "Token updater caricato da $defaultToken" -ForegroundColor Green
}
if ($env:VITE_DEMO_UPDATER_DISABLED) {
    Write-Host "Token updater: PRESENTE (auto-update da repo privato abilitato)." -ForegroundColor Green
} else {
    if ($env:PHARMATEK_REQUIRE_UPDATER_CREDENTIALS -eq '1') {
        throw "Nessun token updater: build di rilascio interrotta. Salva il token read-only in $defaultToken"
    }
    Write-Warning "Nessun token updater: su repo privato l'auto-update NON potra' scaricare gli aggiornamenti."
    Write-Warning "Crea un token (Contents: read-only sul repo release) e salvalo in $defaultToken"
}

# Chiude eventuali istanze del gestionale in esecuzione dalla cartella target per evitare blocchi file
Get-Process -Name "pharmatek-gestionale" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "*\src-tauri\target\*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Pulisco le build Tauri precedenti..." -ForegroundColor Cyan
npm run clean:tauri
if ($LASTEXITCODE -ne 0) { throw "Pulizia delle build Tauri precedenti fallita." }

Write-Host "Build di produzione Tauri..." -ForegroundColor Cyan
if ($firmaManualePasswordVuota -or -not $env:TAURI_SIGNING_PRIVATE_KEY) {
    # `createUpdaterArtifacts=false` evita sia il prompt senza password sia una
    # richiesta di firma quando si sta producendo intenzionalmente un bundle locale
    # non firmato. La firma manuale sotto ricrea il `.sig` quando la chiave esiste.
    $configBuildLocale = Join-Path $PSScriptRoot 'tauri-build-no-updater.json'
    & npx tauri build --config $configBuildLocale
} else {
    # La pulizia e' gia' stata eseguita sopra; evita di ripeterla tramite app:build.
    & npx tauri build
}
if ($LASTEXITCODE -ne 0) { throw "Build fallita." }

$bundle = Join-Path $root 'src-tauri/target/release/bundle'
Write-Host "`nBuild completata. Artefatti in:" -ForegroundColor Green
Write-Host "  $bundle"
if (Test-Path $bundle) {
    $artifacts = Get-ChildItem -Recurse -File $bundle -Include *.exe, *.msi, *.sig, latest.json -ErrorAction SilentlyContinue
    $artifacts |
        ForEach-Object { Write-Host "  - $($_.FullName)" }
    $installer = $artifacts |
        Where-Object { $_.Extension -in '.exe', '.msi' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($firmaManualePasswordVuota) {
        if (-not $installer) { throw "Installer non trovato: firma updater impossibile." }
        Write-Host "Firma esplicita dell'installer (chiave senza password)..." -ForegroundColor Cyan
        & npx tauri signer sign '--password=' ($installer.FullName)
        if ($LASTEXITCODE -ne 0) { throw "Firma updater fallita." }
        $firma = Get-Item -LiteralPath "$($installer.FullName).sig" -ErrorAction SilentlyContinue
        if (-not $firma) { throw "Firma updater non prodotta." }
        Write-Host "  - $($firma.FullName)" -ForegroundColor Green
    }
    if (-not $NoPause) {
        if ($installer) {
            Write-Host "Apro la cartella della build generata..." -ForegroundColor Cyan
            Start-Process explorer.exe -ArgumentList "/select,`"$($installer.FullName)`""
        } else {
            Start-Process explorer.exe -ArgumentList "`"$bundle`""
        }
    }
}
Invoke-Pause "`nPremi Invio per chiudere"
