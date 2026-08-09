#requires -Version 5.1
<#
.SYNOPSIS
  Avvia l'app in sviluppo (Tauri dev). Installa le dipendenze se mancano.
.NOTES
  Funziona anche con "Esegui con PowerShell" (tasto destro): la finestra resta aperta.
#>
param([switch]$NoPause)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Pause($msg) {
    if (-not $NoPause -and $Host.Name -eq 'ConsoleHost') { Read-Host $msg | Out-Null }
}
trap {
    Write-Host "`nERRORE: $($_.Exception.Message)" -ForegroundColor Red
    Invoke-Pause 'Premi Invio per chiudere'
    exit 1
}

Set-Location $root
function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

if (-not (Test-Cmd node)) { throw "Manca Node.js. Installalo da https://nodejs.org" }
if (-not (Test-Cmd npm))  { throw "Manca npm (incluso in Node.js)" }

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host "Installo le dipendenze frontend..." -ForegroundColor Cyan
    npm install
}

if (-not (Test-Cmd cargo)) {
    Write-Warning "Rust/Cargo non trovato: 'tauri dev' fallira'."
    Write-Warning "Installa con: winget install Rustlang.Rustup  (poi riapri il terminale)"
}

Write-Host "Avvio app in sviluppo (npm run app:dev)..." -ForegroundColor Green
npm run app:dev
Invoke-Pause "`nApp chiusa. Premi Invio per chiudere"
