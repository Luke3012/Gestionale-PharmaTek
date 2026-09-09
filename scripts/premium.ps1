#requires -Version 5.1
<#
.SYNOPSIS
  Attiva, disattiva o mostra le funzionalità premium su questo PC.
.DESCRIPTION
  Modifica esclusivamente il file locale:
  %APPDATA%\it.pharmatek.gestionale\premium.json

  Non usa Git, GitHub, la rete, release.ps1 o altri script.
  Non consente di indicare un altro PC o un altro percorso.
.PARAMETER Enable
  Attiva localmente le funzionalità premium.
.PARAMETER Disable
  Disattiva localmente le funzionalità premium.
.PARAMETER Status
  Mostra esclusivamente lo stato premium locale.
.PARAMETER NoPause
  Non attende la pressione di Invio al termine.
.EXAMPLE
  ./scripts/premium.ps1
.EXAMPLE
  ./scripts/premium.ps1 -Enable
.EXAMPLE
  ./scripts/premium.ps1 -Disable
.EXAMPLE
  ./scripts/premium.ps1 -Status -NoPause
#>
param(
    [Alias('Sblocca')]
    [switch]$Enable,
    [Alias('Blocca')]
    [switch]$Disable,
    [Alias('Stato')]
    [switch]$Status,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$appDirectory = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'it.pharmatek.gestionale'
$configPath = Join-Path $appDirectory 'config.json'
$premiumPath = Join-Path $appDirectory 'premium.json'

function Invoke-Pause([string]$Message) {
    if (-not $NoPause -and $Host.Name -eq 'ConsoleHost') {
        Read-Host $Message | Out-Null
    }
}

trap {
    Write-Host "`nERRORE: $($_.Exception.Message)" -ForegroundColor Red
    Invoke-Pause 'Premi Invio per chiudere'
    exit 1
}

function Assert-LocalInstallation {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "Configurazione locale non trovata: $configPath. Avvia prima PharmaTek su questo PC."
    }
    try {
        $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "Configurazione locale non leggibile: $($_.Exception.Message)"
    }
    if (-not ([string]$config.device_id).Trim()) {
        throw 'La configurazione locale non contiene un device_id valido.'
    }
}

function Get-LocalPremiumEnabled {
    Assert-LocalInstallation
    if (-not (Test-Path -LiteralPath $premiumPath -PathType Leaf)) {
        return $false
    }
    try {
        $state = Get-Content -LiteralPath $premiumPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        return $false
    }
    if ($state.PSObject.Properties.Name -notcontains 'enabled' -or $state.enabled -isnot [bool]) {
        return $false
    }
    return [bool]$state.enabled
}

function Set-LocalPremiumEnabled([bool]$Enabled) {
    Assert-LocalInstallation
    $temporary = Join-Path $appDirectory "premium-$([guid]::NewGuid()).tmp"
    $backup = Join-Path $appDirectory "premium-$([guid]::NewGuid()).bak"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $json = [ordered]@{
        schema = 1
        enabled = $Enabled
        updatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    } | ConvertTo-Json

    try {
        [System.IO.File]::WriteAllText($temporary, $json, $utf8NoBom)
        if (Test-Path -LiteralPath $premiumPath -PathType Leaf) {
            # Sostituzione sullo stesso volume: il programma non vede mai un JSON parziale.
            [System.IO.File]::Replace($temporary, $premiumPath, $backup, $true)
        } else {
            [System.IO.File]::Move($temporary, $premiumPath)
        }
    } finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    }

    if ($Enabled) {
        Write-Host 'Funzionalità premium attivate su questo PC.' -ForegroundColor Green
    } else {
        Write-Host 'Funzionalità premium disattivate su questo PC.' -ForegroundColor Yellow
    }
    Write-Host "La modifica viene recepita al prossimo controllo dell'app o al riavvio." -ForegroundColor DarkGray
}

function Show-LocalPremiumStatus {
    $enabled = Get-LocalPremiumEnabled
    $label = if ($enabled) { 'ATTIVE' } else { 'DISATTIVATE' }
    $color = if ($enabled) { 'Green' } else { 'Yellow' }
    Write-Host "Funzionalità premium locali: $label" -ForegroundColor $color
    Write-Host "Stato locale: $premiumPath" -ForegroundColor DarkGray
}

function Show-ArrowMenu([string[]]$Items) {
    $selected = 0
    while ($true) {
        Clear-Host
        Write-Host ''
        Write-Host '  PharmaTek' -ForegroundColor Yellow
        Write-Host '  Funzionalità premium locali' -ForegroundColor DarkYellow
        Write-Host '  ────────────────────────────' -ForegroundColor DarkYellow
        Write-Host ''

        for ($index = 0; $index -lt $Items.Count; $index++) {
            if ($index -eq $selected) {
                Write-Host "  > $($Items[$index])" -ForegroundColor Black -BackgroundColor Yellow
            } else {
                Write-Host "    $($Items[$index])" -ForegroundColor Yellow
            }
        }

        Write-Host ''
        Write-Host '  Usa ↑/↓ e premi Invio' -ForegroundColor DarkGray
        $key = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        switch ($key.VirtualKeyCode) {
            38 { $selected = ($selected - 1 + $Items.Count) % $Items.Count }
            40 { $selected = ($selected + 1) % $Items.Count }
            13 { return $selected }
            27 { return ($Items.Count - 1) }
        }
    }
}

$selectedActions = @(@($Enable, $Disable, $Status) | Where-Object { [bool]$_ }).Count
if ($selectedActions -gt 1) {
    throw 'Usa una sola opzione fra -Enable, -Disable e -Status.'
}

if ($Enable) {
    Set-LocalPremiumEnabled $true
    Invoke-Pause 'Premi Invio per chiudere'
    exit 0
}

if ($Disable) {
    Set-LocalPremiumEnabled $false
    Invoke-Pause 'Premi Invio per chiudere'
    exit 0
}

if ($Status) {
    Show-LocalPremiumStatus
    Invoke-Pause 'Premi Invio per chiudere'
    exit 0
}

if ($NoPause -or $Host.Name -ne 'ConsoleHost') {
    throw 'Specifica -Enable, -Disable oppure -Status.'
}

$menuItems = @(
    'Attiva premium su questo PC'
    'Disattiva premium su questo PC'
    'Mostra stato locale'
    'Esci'
)

while ($true) {
    $choice = Show-ArrowMenu $menuItems
    Clear-Host
    switch ($choice) {
        0 {
            Set-LocalPremiumEnabled $true
            Invoke-Pause "`nPremi Invio per tornare al menu"
        }
        1 {
            Set-LocalPremiumEnabled $false
            Invoke-Pause "`nPremi Invio per tornare al menu"
        }
        2 {
            Show-LocalPremiumStatus
            Invoke-Pause "`nPremi Invio per tornare al menu"
        }
        3 { exit 0 }
    }
}
