#requires -Version 5.1
<#
.SYNOPSIS
  Apre l'editor grafico del changelog (pagina web locale).
.DESCRIPTION
  Avvia un piccolo server Node (scripts/changelog-editor.mjs) e apre il browser
  sull'editor. Lì puoi aggiungere versioni, sintesi e voci per categoria (Novità /
  Correzioni / Altro) e salvare: scrive src/features/changelog/changelog.json e
  rigenera docs/CHANGELOG.md. Quel file alimenta il pannello «Novità» in-app, lo
  storico nella finestra Info e le note mostrate dall'updater.
  Chiudi questa finestra (o Ctrl+C) per fermare l'editor.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
trap {
    Write-Host "`nERRORE: $($_.Exception.Message)" -ForegroundColor Red
    if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Premi Invio per chiudere' | Out-Null }
    exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Manca 'node' (Node.js). Installalo da https://nodejs.org"
}
Set-Location $root
Write-Host "Apro l'editor del changelog nel browser..." -ForegroundColor Cyan
node (Join-Path $PSScriptRoot 'changelog-editor.mjs')
