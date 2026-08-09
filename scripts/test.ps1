#requires -Version 5.1
<#
.SYNOPSIS
  Controlli/test del progetto: typecheck+build frontend e test Rust.
.PARAMETER SkipFrontend  Salta i controlli frontend.
.PARAMETER SkipRust      Salta i test Rust.
.PARAMETER NoPause       Non mettere in pausa a fine script (uso da terminale/automazione).
.NOTES
  Funziona anche con "Esegui con PowerShell" (tasto destro): la finestra resta aperta.
#>
param(
    [switch]$SkipFrontend,
    [switch]$SkipRust,
    [switch]$NoPause
)
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
$failed = $false

Write-Host "== Coerenza versioni ==" -ForegroundColor Cyan
$packageVersion = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$lockRaw = Get-Content (Join-Path $root 'package-lock.json') -Raw
$lockVersions = [regex]::Matches($lockRaw, '"version"\s*:\s*"([^"]+)"')
if ($lockVersions.Count -lt 2) { throw "Versioni radice non trovate in package-lock.json" }
$lockVersion = $lockVersions[0].Groups[1].Value
$lockRootVersion = $lockVersions[1].Groups[1].Value
$tauriVersion = (Get-Content (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version
if ($packageVersion -ne $lockVersion -or $packageVersion -ne $lockRootVersion -or $packageVersion -ne $tauriVersion) {
    $failed = $true
    Write-Warning "Versioni non allineate: package=$packageVersion, lock=$lockVersion, lock-root=$lockRootVersion, tauri=$tauriVersion"
}

if (-not $SkipFrontend) {
    Write-Host "== Frontend: test ==" -ForegroundColor Cyan
    if (-not (Test-Path (Join-Path $root 'node_modules'))) { npm install }
    npm test
    if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Warning "Frontend test: FALLITO" }

    Write-Host "== Frontend: typecheck + build (tsc && vite) ==" -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Warning "Frontend: FALLITO" }
}

if (-not $SkipRust) {
    if (Test-Cmd cargo) {
        Write-Host "== Rust: cargo test ==" -ForegroundColor Cyan
        Push-Location (Join-Path $root 'src-tauri')
        try {
            cargo test -- --test-threads=1
            if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Warning "cargo test: FALLITO" }

            if (Test-Cmd cargo-clippy) {
                Write-Host "== Rust: clippy ==" -ForegroundColor Cyan
                cargo clippy -- -D warnings
                if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Warning "clippy: FALLITO" }
            }
        } finally { Pop-Location }
    } else {
        Write-Warning "Cargo non trovato: salto i test Rust (installa Rust per eseguirli)."
    }
}

if ($failed) {
    Write-Host "Alcuni controlli sono FALLITI." -ForegroundColor Red
    Invoke-Pause 'Premi Invio per chiudere'
    exit 1
}
Write-Host "Tutti i controlli OK." -ForegroundColor Green
Invoke-Pause "`nPremi Invio per chiudere"
