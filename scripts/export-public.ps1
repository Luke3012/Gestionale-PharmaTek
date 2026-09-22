#requires -Version 5.1
<#
.SYNOPSIS
  Esporta una copia sanitizzata del repository nel repository demo pubblico.
.DESCRIPTION
  Crea lo staging esclusivamente dal commit HEAD, rimuove dati e riferimenti
  operativi, esegue un audit e sincronizza il risultato nel repository pubblico.
  Con -Publish esegue anche test frontend/backend, commit e push del repository pubblico.
.PARAMETER Destination
  Cartella del repository pubblico. Deve terminare con Gestionale-PharmaTek.
.PARAMETER Publish
  Dopo l'esportazione verifica, committa e pubblica il repository demo senza generare l'installer.
.PARAMETER NoPause
  Non attende Invio al termine. Utile per terminale, CI e altri script.
#>
param(
    [string]$Destination = 'C:\Users\lucat\Linux\Gestionale-PharmaTek',
    [switch]$Publish,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

function Invoke-Pause([string]$Message) {
    if (-not $NoPause -and $Host.Name -eq 'ConsoleHost') {
        Read-Host $Message | Out-Null
    }
}

# Con "Esegui con PowerShell" la console si chiude appena termina lo script.
# Il trap rende leggibile l'errore e mantiene aperta la finestra fino a Invio.
trap {
    Write-Host "`nERRORE: $($_.Exception.Message)" -ForegroundColor Red
    Invoke-Pause 'Premi Invio per chiudere'
    exit 1
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$destinationParent = Split-Path -Parent $Destination
if ((Split-Path -Leaf $Destination) -ne 'Gestionale-PharmaTek') {
    throw 'La destinazione deve terminare con Gestionale-PharmaTek.'
}
if (-not (Test-Path -LiteralPath $destinationParent)) {
    throw "Directory padre non trovata: $destinationParent"
}
$privateStatus = (& git -C $root status --porcelain | Out-String).Trim()
if ($privateStatus) {
    throw "Il repository privato contiene modifiche non committate. Esegui 'git status', quindi committale o mettile da parte prima dell'export."
}

$stage = Join-Path ([IO.Path]::GetTempPath()) ("pharmatek-public-" + [guid]::NewGuid())
$archive = "$stage.zip"
try {
    & git -C $root archive --format=zip --output=$archive HEAD
    New-Item -ItemType Directory -Path $stage | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $stage
    & node (Join-Path $stage 'scripts/sanitize-public.mjs') $stage
    if ($LASTEXITCODE -ne 0) { throw 'Sanitizzazione fallita.' }

    # I README della demo vengono mantenuti direttamente nel repository
    # pubblico: descrivono il dataset sanitizzato e non devono essere
    # rimpiazzati dalle varianti operative durante gli export successivi.
    $publicMaintainedFiles = @('README.md', 'README.it.md')
    if (Test-Path -LiteralPath (Join-Path $Destination '.git')) {
        $publicStatus = (& git -C $Destination status --porcelain | Out-String).Trim()
        if ($publicStatus) {
            throw 'Il repository pubblico deve essere pulito prima dell export.'
        }
        foreach ($relativePath in $publicMaintainedFiles) {
            $publicFile = Join-Path $Destination $relativePath
            if (Test-Path -LiteralPath $publicFile -PathType Leaf) {
                Copy-Item -LiteralPath $publicFile -Destination (Join-Path $stage $relativePath) -Force
            }
        }
    }

    $profile = Join-Path $root 'config\operational-profile.local.json'
    $audit = Join-Path $root 'scripts\audit-public.mjs'
    if (Test-Path -LiteralPath $profile) {
        & node $audit $stage $profile
    } else {
        & node $audit $stage
    }
    if ($LASTEXITCODE -ne 0) { throw 'Audit dello staging pubblico fallito.' }

    if (-not (Test-Path -LiteralPath $Destination)) {
        New-Item -ItemType Directory -Path $Destination | Out-Null
        & git -C $Destination init -b main
    }
    $resolvedDestination = (Resolve-Path -LiteralPath $Destination).Path
    if (-not $resolvedDestination.StartsWith((Resolve-Path $destinationParent).Path + [IO.Path]::DirectorySeparatorChar)) {
        throw 'Destinazione non valida.'
    }
    & robocopy $stage $Destination /MIR /XD .git node_modules target dist /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Copia pubblica fallita: robocopy $LASTEXITCODE" }

    & git -C $Destination config user.name 'Public Demo'
    & git -C $Destination config user.email 'public-demo'
    if (-not (& git -C $Destination remote)) {
        & git -C $Destination remote add origin 'https://github.com/Luke3012/Gestionale-PharmaTek.git'
    }
    if ($Publish) {
        & node (Join-Path $Destination 'scripts\audit-public.mjs') $Destination
        if ($LASTEXITCODE -ne 0) { throw 'Audit del repository pubblico fallito.' }
        & npm --prefix $Destination ci
        if ($LASTEXITCODE -ne 0) { throw 'Installazione dipendenze pubbliche fallita.' }
        & npm --prefix $Destination test -- --run
        if ($LASTEXITCODE -ne 0) { throw 'Test frontend pubblici falliti.' }
        & npm --prefix $Destination run build
        if ($LASTEXITCODE -ne 0) { throw 'Build Vite pubblica fallita.' }
        & cargo test --manifest-path (Join-Path $Destination 'src-tauri\Cargo.toml') -- --test-threads=1
        if ($LASTEXITCODE -ne 0) { throw 'Test Rust pubblici falliti.' }
        & git -C $Destination add --all
        & git -C $Destination commit -m 'Pubblica la variante demo sanitizzata'
        if ($LASTEXITCODE -ne 0) { throw 'Commit pubblico fallito.' }
        & git -C $Destination push -u origin main
        if ($LASTEXITCODE -ne 0) { throw 'Push pubblico fallito.' }
    }

    Write-Host "`nExport pubblico completato in: $Destination" -ForegroundColor Green
    if (-not $Publish) {
        Write-Host "La copia locale e' aggiornata; non sono stati eseguiti commit o push." -ForegroundColor DarkGray
        Write-Host "Per pubblicarla usa: .\scripts\export-public.ps1 -Publish" -ForegroundColor DarkGray
    }
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}

Invoke-Pause 'Premi Invio per chiudere'
