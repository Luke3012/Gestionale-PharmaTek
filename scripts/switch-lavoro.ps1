#requires -Version 5.1
<#
.SYNOPSIS
  Selettore locale per due configurazioni/lavori indipendenti di PharmaTek.
.DESCRIPTION
  Avviare con "Esegui con PowerShell". Il primo profilo conserva la
  configurazione attuale; il secondo parte vuoto e si configura una volta
  dall'onboarding di PharmaTek.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:AppId = 'it.pharmatek.gestionale'
$script:ProcessNames = @('pharmatek-gestionale', 'Gestionale PharmaTek')
$script:AppDirectoryOverride = $null
$script:ProfileLabels = @('Lavoro 1', 'Lavoro 2')

function Get-AppDirectory {
    if (-not [string]::IsNullOrWhiteSpace($script:AppDirectoryOverride)) {
        return $script:AppDirectoryOverride
    }
    $appData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
    if ([string]::IsNullOrWhiteSpace($appData)) {
        throw "Impossibile individuare la cartella AppData dell'utente."
    }
    Join-Path $appData $script:AppId
}

function Get-ProfileRoot {
    Join-Path (Get-AppDirectory) 'work-profiles'
}

function Get-ProfileDirectory {
    param([Parameter(Mandatory)][ValidateSet(1, 2)][int]$Number)
    Join-Path (Get-ProfileRoot) ("Lavoro-{0}" -f $Number)
}

function Get-ProfileStatePath {
    Join-Path (Get-ProfileRoot) 'state.json'
}

function Read-ProfileState {
    $path = Get-ProfileStatePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try {
        $state = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($state.version -ne 1 -or $state.activeProfile -notin @(1, 2)) {
            throw 'Formato o profilo attivo non valido.'
        }
        if ($state.PSObject.Properties['pendingProfile'] -and $state.pendingProfile -notin @(1, 2)) {
            throw 'Profilo di ripristino non valido.'
        }
        return $state
    }
    catch {
        throw "Il file dei profili è danneggiato: $path`n$($_.Exception.Message)"
    }
}

function Write-ProfileState {
    param(
        [Parameter(Mandatory)][ValidateSet(1, 2)][int]$ActiveProfile,
        [AllowNull()][Nullable[int]]$PendingProfile = $null
    )
    $root = Get-ProfileRoot
    [void](New-Item -ItemType Directory -Path $root -Force)
    $state = [ordered]@{ version = 1; activeProfile = $ActiveProfile }
    if ($null -ne $PendingProfile) { $state.pendingProfile = [int]$PendingProfile }
    $temp = Join-Path $root 'state.json.tmp'
    $destination = Get-ProfileStatePath
    $json = $state | ConvertTo-Json
    [System.IO.File]::WriteAllText($temp, $json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $destination -Force
}

function Get-ProfilePaths {
    param(
        [Parameter(Mandatory)][ValidateSet(1, 2)][int]$Number,
        [string]$RootOverride = ''
    )
    $profile = if ([string]::IsNullOrWhiteSpace($RootOverride)) { Get-ProfileDirectory -Number $Number } else { $RootOverride }
    [pscustomobject]@{
        Root = $profile
        Config = Join-Path $profile 'config.json'
        Projection = Join-Path $profile 'projection.sqlite'
        CommunicationDatabase = Join-Path $profile 'communication-outbox.sqlite'
        CommunicationDirectory = Join-Path $profile 'communication-outbox'
        DocumentCache = Join-Path $profile 'document-cache'
        PreparationCache = Join-Path $profile 'production-preparation'
        RestoreMarkers = Join-Path $profile 'restore-markers'
    }
}

function Copy-FileIfPresent {
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination)
    if (Test-Path -LiteralPath $Source -PathType Leaf) {
        [void](New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force)
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
    }
}

function Copy-DirectoryIfPresent {
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination)
    if (Test-Path -LiteralPath $Source -PathType Container) {
        [void](New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force)
        Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
    }
}

function Remove-FileFamily {
    param([Parameter(Mandatory)][string]$Path)
    foreach ($candidate in @($Path, "$Path-wal", "$Path-shm")) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            Remove-Item -LiteralPath $candidate -Force
        }
    }
}

function Save-ActiveProfile {
    param([Parameter(Mandatory)][ValidateSet(1, 2)][int]$Number)
    $app = Get-AppDirectory
    $parent = Get-ProfileRoot
    $staging = Join-Path $parent ('.Lavoro-{0}.capture-{1}' -f $Number, [Guid]::NewGuid().ToString('N'))
    $paths = Get-ProfilePaths -Number $Number -RootOverride $staging
    [void](New-Item -ItemType Directory -Path $paths.Root -Force)

    try {
        foreach ($directory in @(
            @{ Live = (Join-Path $app 'communication-outbox'); Saved = $paths.CommunicationDirectory },
            @{ Live = (Join-Path $app 'document-cache'); Saved = $paths.DocumentCache },
            @{ Live = (Join-Path $app 'production-preparation'); Saved = $paths.PreparationCache }
        )) {
            Copy-DirectoryIfPresent -Source $directory.Live -Destination $directory.Saved | Out-Null
        }

        Copy-FileIfPresent -Source (Join-Path $app 'config.json') -Destination $paths.Config | Out-Null
        foreach ($stem in @('projection.sqlite', 'communication-outbox.sqlite')) {
            $live = Join-Path $app $stem
            $saved = Join-Path $paths.Root $stem
            foreach ($suffix in @('', '-wal', '-shm')) {
                Copy-FileIfPresent -Source "$live$suffix" -Destination "$saved$suffix" | Out-Null
            }
        }

        # Il marker di restore è per deviceId; si conservano tutti quelli presenti.
        [void](New-Item -ItemType Directory -Path $paths.RestoreMarkers -Force)
        Get-ChildItem -LiteralPath $app -Filter 'restore-handled-*.json' -File -ErrorAction SilentlyContinue |
            Copy-Item -Destination $paths.RestoreMarkers -Force | Out-Null

        $destination = Get-ProfileDirectory -Number $Number
        $backup = Join-Path $parent ('.Lavoro-{0}.previous-{1}' -f $Number, [Guid]::NewGuid().ToString('N'))
        if (Test-Path -LiteralPath $destination) { Move-Item -LiteralPath $destination -Destination $backup }
        try {
            Move-Item -LiteralPath $paths.Root -Destination $destination
            if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
        }
        catch {
            if (-not (Test-Path -LiteralPath $destination) -and (Test-Path -LiteralPath $backup)) {
                Move-Item -LiteralPath $backup -Destination $destination
            }
            throw
        }
    }
    finally {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    }
}

function Restore-Profile {
    param([Parameter(Mandatory)][ValidateSet(1, 2)][int]$Number)
    $app = Get-AppDirectory
    $paths = Get-ProfilePaths -Number $Number
    [void](New-Item -ItemType Directory -Path $app -Force)

    Remove-FileFamily -Path (Join-Path $app 'projection.sqlite')
    Remove-FileFamily -Path (Join-Path $app 'communication-outbox.sqlite')
    foreach ($name in @('config.json', 'communication-outbox', 'document-cache', 'production-preparation')) {
        $live = Join-Path $app $name
        if (Test-Path -LiteralPath $live) { Remove-Item -LiteralPath $live -Recurse -Force }
    }
    Get-ChildItem -LiteralPath $app -Filter 'restore-handled-*.json' -File -ErrorAction SilentlyContinue |
        Remove-Item -Force

    Copy-FileIfPresent -Source $paths.Config -Destination (Join-Path $app 'config.json') | Out-Null
    foreach ($stem in @('projection.sqlite', 'communication-outbox.sqlite')) {
        $saved = Join-Path $paths.Root $stem
        $live = Join-Path $app $stem
        foreach ($suffix in @('', '-wal', '-shm')) {
            Copy-FileIfPresent -Source "$saved$suffix" -Destination "$live$suffix" | Out-Null
        }
    }
    Copy-DirectoryIfPresent -Source $paths.CommunicationDirectory -Destination (Join-Path $app 'communication-outbox') | Out-Null
    Copy-DirectoryIfPresent -Source $paths.DocumentCache -Destination (Join-Path $app 'document-cache') | Out-Null
    Copy-DirectoryIfPresent -Source $paths.PreparationCache -Destination (Join-Path $app 'production-preparation') | Out-Null
    if (Test-Path -LiteralPath $paths.RestoreMarkers -PathType Container) {
        Get-ChildItem -LiteralPath $paths.RestoreMarkers -Filter 'restore-handled-*.json' -File |
            Copy-Item -Destination $app -Force | Out-Null
    }
}

function New-EmptyProfile {
    param([Parameter(Mandatory)][ValidateSet(1, 2)][int]$Number)
    $paths = Get-ProfilePaths -Number $Number
    [void](New-Item -ItemType Directory -Path $paths.Root -Force)
    if (-not (Test-Path -LiteralPath $paths.Config -PathType Leaf)) {
        $freshConfig = [ordered]@{
            device_id = ''
            data_dir = $null
            user_id = $null
            prescriptions_dir = $null
            onboarding_state = 'fresh'
        }
        $json = $freshConfig | ConvertTo-Json
        [System.IO.File]::WriteAllText($paths.Config, $json, [System.Text.UTF8Encoding]::new($false))
    }
}

function Test-ProfileNeedsOnboarding {
    param([Parameter(Mandatory)][ValidateSet(1, 2)][int]$Number)
    $configPath = (Get-ProfilePaths -Number $Number).Config
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return $true }
    try {
        $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        return ([string]::IsNullOrWhiteSpace([string]$config.data_dir) -or
            [string]::IsNullOrWhiteSpace([string]$config.user_id))
    }
    catch { return $true }
}

function Stop-PharmaTek {
    $processes = @(
        foreach ($name in $script:ProcessNames) {
            Get-Process -Name $name -ErrorAction SilentlyContinue
        }
    )
    $processes = @($processes | Sort-Object -Property Id -Unique)
    if ($processes.Count -eq 0) { return }

    $statusY = [Math]::Max(0, [Console]::WindowHeight - 2)
    Write-CenteredLine -Text 'Sto chiudendo PharmaTek...' -Y $statusY -Foreground Yellow
    $processes | Stop-Process -Force -ErrorAction SilentlyContinue
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 150
        $remaining = @(
            foreach ($name in $script:ProcessNames) {
                Get-Process -Name $name -ErrorAction SilentlyContinue
            }
        )
        $remaining = @($remaining | Sort-Object -Property Id -Unique)
    } while ($remaining.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
    if ($remaining.Count -gt 0) {
        throw 'PharmaTek non si è chiuso. Nessun file del profilo è stato modificato.'
    }
}

function Set-ConsoleTheme {
    try {
        [Console]::ForegroundColor = [ConsoleColor]::Yellow
        [Console]::BackgroundColor = [ConsoleColor]::Black
        [Console]::Clear()
    }
    catch { }
}

function Write-ConsoleAt {
    param(
        [Parameter(Mandatory)][int]$X,
        [Parameter(Mandatory)][int]$Y,
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][ConsoleColor]$Foreground,
        [Parameter(Mandatory)][ConsoleColor]$Background
    )
    if ($X -lt 0 -or $Y -lt 0 -or $Y -ge [Console]::WindowHeight) { return }
    try {
        [Console]::SetCursorPosition($X, $Y)
        [Console]::ForegroundColor = $Foreground
        [Console]::BackgroundColor = $Background
        [Console]::Write($Text)
    }
    catch { }
}

function Get-SelectorGeometry {
    $innerWidth = 28
    $cardWidth = $innerWidth + 2
    $gap = 8
    $totalWidth = ($cardWidth * 2) + $gap
    $left = [Math]::Max(0, [int](([Console]::WindowWidth - $totalWidth) / 2))
    [pscustomobject]@{ InnerWidth = $innerWidth; CardWidth = $cardWidth; Gap = $gap; Left = $left; Top = 5 }
}

function Center-Text {
    param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][int]$Width)
    if ($Text.Length -gt $Width) { $Text = $Text.Substring(0, $Width) }
    $leftPadding = [Math]::Max(0, [int](($Width - $Text.Length) / 2))
    (' ' * $leftPadding) + $Text
}

function Get-ProfileIcon {
    param([Parameter(Mandatory)][ValidateSet(1, 2)][int]$Number)
    if ($Number -eq 1) {
        return @(
            '          ________',
            '         / ______ \',
            '        | |      | |',
            '    ____| |  01  | |____',
            '   /    | |      | |    \',
            '  |     | |______| |     |',
            '  |_____|__________|_____|',
            '       /____________\'
        )
    }
    return @(
        '        ______________',
        '    ___/____________/|',
        '   /  /            / |',
        '  /__/____________/  |',
        '  |  |            |  |',
        '  |  |     02     |  |',
        '  |  |____________| /',
        '  |_______________|/'
    )
}

function Write-CenteredLine {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][int]$Y,
        [ConsoleColor]$Foreground = [ConsoleColor]::Yellow,
        [ConsoleColor]$Background = [ConsoleColor]::Black
    )
    $width = [Console]::WindowWidth
    if ($width -le 0) { return }
    if ($Text.Length -gt $width) { $Text = $Text.Substring(0, $width) }
    $x = [Math]::Max(0, [int](($width - $Text.Length) / 2))
    Write-ConsoleAt -X $x -Y $Y -Text $Text -Foreground $Foreground -Background $Background
}

function Write-CenteredParagraph {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][int]$Y,
        [Parameter(Mandatory)][ConsoleColor]$Foreground,
        [int]$MaxWidth = 68
    )
    $limit = [Math]::Max(12, [Math]::Min($MaxWidth, [Console]::WindowWidth - 4))
    $line = ''
    foreach ($word in ($Text -split '\s+')) {
        if ([string]::IsNullOrWhiteSpace($word)) { continue }
        $candidate = if ($line.Length -eq 0) { $word } else { "$line $word" }
        if ($candidate.Length -gt $limit -and $line.Length -gt 0) {
            Write-CenteredLine -Text $line -Y $Y -Foreground $Foreground
            $Y++
            $line = $word
        }
        else { $line = $candidate }
    }
    if ($line.Length -gt 0) {
        Write-CenteredLine -Text $line -Y $Y -Foreground $Foreground
        $Y++
    }
    return $Y
}

function Write-ProfileCard {
    param(
        [Parameter(Mandatory)][int]$Number,
        [Parameter(Mandatory)][int]$Selection,
        [Parameter(Mandatory)][AllowNull()][Nullable[int]]$ActiveProfile,
        [Parameter(Mandatory)][bool]$Initialized,
        [Parameter(Mandatory)]$Geometry
    )
    $x = $Geometry.Left + (($Number - 1) * ($Geometry.CardWidth + $Geometry.Gap))
    $top = $Geometry.Top
    $selected = $Number -eq $Selection
    $foreground = if ($selected) { [ConsoleColor]::Black } else { [ConsoleColor]::DarkYellow }
    $background = if ($selected) { [ConsoleColor]::Yellow } else { [ConsoleColor]::Black }
    $border = '+' + ('-' * $Geometry.InnerWidth) + '+'
    Write-ConsoleAt -X $x -Y $top -Text $border -Foreground $foreground -Background $background

    $status = if ($ActiveProfile -eq $Number) { 'ATTIVO' }
        elseif ($Number -eq 2 -and -not $Initialized) { 'NUOVO' }
        else { '' }
    $heading = ('[{0}]  LAVORO {0}  {1}' -f $Number, $status).TrimEnd()
    $row = '|' + (Center-Text -Text $heading -Width $Geometry.InnerWidth).PadRight($Geometry.InnerWidth) + '|'
    Write-ConsoleAt -X $x -Y ($top + 1) -Text $row -Foreground $foreground -Background $background
    Write-ConsoleAt -X $x -Y ($top + 2) -Text ('|' + (' ' * $Geometry.InnerWidth) + '|') -Foreground $foreground -Background $background
    Write-ConsoleAt -X $x -Y ($top + 3) -Text ('|' + (' ' * $Geometry.InnerWidth) + '|') -Foreground $foreground -Background $background

    $art = Get-ProfileIcon -Number $Number
    for ($i = 0; $i -lt $art.Count; $i++) {
        $content = '|' + (Center-Text -Text $art[$i] -Width $Geometry.InnerWidth).PadRight($Geometry.InnerWidth) + '|'
        Write-ConsoleAt -X $x -Y ($top + 4 + $i) -Text $content -Foreground $foreground -Background $background
    }
    Write-ConsoleAt -X $x -Y ($top + 12) -Text $border -Foreground $foreground -Background $background
}

function Write-SelectorScreen {
    param(
        [Parameter(Mandatory)][int]$Selection,
        [Parameter(Mandatory)][AllowNull()][Nullable[int]]$ActiveProfile,
        [Parameter(Mandatory)][bool]$Initialized
    )
    Set-ConsoleTheme
    $geometry = Get-SelectorGeometry
    $width = [Console]::WindowWidth
    $title = 'PHARMATEK  /  SELETTORE DEI LAVORI'
    $titleX = [Math]::Max(0, [int](($width - $title.Length) / 2))
    Write-ConsoleAt -X $titleX -Y 1 -Text $title -Foreground Yellow -Background Black
    Write-ConsoleAt -X $titleX -Y 2 -Text ('=' * $title.Length) -Foreground DarkYellow -Background Black
    $prompt = 'SCEGLI IL LAVORO DA APRIRE'
    Write-ConsoleAt -X ([Math]::Max(0, [int](($width - $prompt.Length) / 2))) -Y 3 -Text $prompt -Foreground Gray -Background Black

    Write-ProfileCard -Number 1 -Selection $Selection -ActiveProfile $ActiveProfile -Initialized $Initialized -Geometry $geometry
    Write-ProfileCard -Number 2 -Selection $Selection -ActiveProfile $ActiveProfile -Initialized $Initialized -Geometry $geometry

    $helpY = $geometry.Top + 14
    $help = '< / FRECCIA SINISTRA      INVIO CONFERMA      FRECCIA DESTRA / >'
    Write-ConsoleAt -X ([Math]::Max(0, [int](($width - $help.Length) / 2))) -Y $helpY -Text $help -Foreground Yellow -Background Black
    $shortcuts = 'oppure premi 1 / 2     Q o ESC per uscire senza modifiche'
    Write-ConsoleAt -X ([Math]::Max(0, [int](($width - $shortcuts.Length) / 2))) -Y ($helpY + 1) -Text $shortcuts -Foreground DarkYellow -Background Black
}

function Invoke-ProfileTransition {
    param([Parameter(Mandatory)][ValidateSet(1, 2)][int]$Number)
    $geometry = Get-SelectorGeometry
    $art = Get-ProfileIcon -Number $Number
    $iconWidth = ($art | Measure-Object -Property Length -Maximum).Maximum
    $cardX = $geometry.Left + (($Number - 1) * ($geometry.CardWidth + $geometry.Gap))
    $startX = $cardX + 1 + [int](($geometry.InnerWidth - $iconWidth) / 2)
    $lastX = [Math]::Max(0, [Console]::WindowWidth - $iconWidth)
    $startX = [Math]::Max(0, [Math]::Min($startX, $lastX))
    $targetX = [Math]::Max(0, [int](([Console]::WindowWidth - $iconWidth) / 2))
    $iconY = [Math]::Min($geometry.Top + 4, [Math]::Max(1, [Console]::WindowHeight - $art.Count - 5))
    $captionY = [Math]::Min([Console]::WindowHeight - 2, $iconY + $art.Count + 1)
    $steps = 16

    for ($step = 0; $step -le $steps; $step++) {
        $progress = $step / [double]$steps
        $eased = ($progress * $progress) * (3 - (2 * $progress))
        $x = [int][Math]::Round($startX + (($targetX - $startX) * $eased))
        $foreground = if ($progress -lt 0.5) { [ConsoleColor]::DarkYellow } else { [ConsoleColor]::Yellow }

        Set-ConsoleTheme
        Write-CenteredLine -Text 'PHARMATEK' -Y 1 -Foreground Yellow
        $ruleWidth = [Math]::Min(48, [Math]::Max(10, [Console]::WindowWidth - 8))
        Write-CenteredLine -Text ('=' * $ruleWidth) -Y 2 -Foreground DarkYellow
        Write-CenteredLine -Text 'CAMBIO PROFILO' -Y 3 -Foreground Yellow
        $direction = if ($Number -eq 1) { 'LAVORO 1  --->  CENTRO' } else { 'CENTRO  <---  LAVORO 2' }
        Write-CenteredLine -Text $direction -Y 5 -Foreground DarkYellow

        for ($i = 0; $i -lt $art.Count; $i++) {
            Write-ConsoleAt -X $x -Y ($iconY + $i) -Text $art[$i] -Foreground $foreground -Background Black
        }
        Write-CenteredLine -Text 'Sto preparando il tuo ambiente...' -Y $captionY -Foreground Yellow
        if ($step -lt $steps) { Start-Sleep -Milliseconds 34 }
    }
    Start-Sleep -Milliseconds 180
}

function Show-ResultScreen {
    param(
        [Parameter(Mandatory)][string]$Title,
        [string[]]$Lines = @(),
        [int]$ProfileNumber = 0,
        [switch]$IsError,
        [switch]$WaitForKey,
        [int]$Duration = 1700
    )
    Set-ConsoleTheme
    $ruleWidth = [Math]::Min(56, [Math]::Max(10, [Console]::WindowWidth - 8))
    Write-CenteredLine -Text 'PHARMATEK  /  I TUOI LAVORI' -Y 1 -Foreground Yellow
    Write-CenteredLine -Text ('=' * $ruleWidth) -Y 2 -Foreground DarkYellow
    Write-CenteredLine -Text $Title -Y 4 -Foreground Yellow
    Write-CenteredLine -Text ('-' * $ruleWidth) -Y 5 -Foreground DarkYellow

    $lineY = 7
    if ($ProfileNumber -in @(1, 2)) {
        $art = Get-ProfileIcon -Number $ProfileNumber
        foreach ($artLine in $art) {
            Write-CenteredLine -Text $artLine -Y $lineY -Foreground Yellow
            $lineY++
        }
        $lineY++
    }

    $messageColor = if ($IsError) { [ConsoleColor]::Yellow } else { [ConsoleColor]::Gray }
    foreach ($line in $Lines) {
        $lineY = Write-CenteredParagraph -Text $line -Y $lineY -Foreground $messageColor
        $lineY++
    }
    $footerY = [Math]::Max($lineY + 1, [Console]::WindowHeight - 2)
    Write-CenteredLine -Text ('=' * $ruleWidth) -Y ($footerY - 1) -Foreground DarkYellow
    if ($WaitForKey) {
        Write-CenteredLine -Text 'Premi un tasto per chiudere' -Y $footerY -Foreground Yellow
        [void][Console]::ReadKey($true)
    }
    else {
        Write-CenteredLine -Text 'Puoi chiudere questa finestra' -Y $footerY -Foreground DarkYellow
        Start-Sleep -Milliseconds $Duration
    }
}

function Read-ProfileSelection {
    param(
        [Parameter(Mandatory)][AllowNull()][Nullable[int]]$ActiveProfile,
        [Parameter(Mandatory)][bool]$Initialized
    )
    $selection = if ($null -ne $ActiveProfile) { [int]$ActiveProfile } else { 1 }
    Write-SelectorScreen -Selection $selection -ActiveProfile $ActiveProfile -Initialized $Initialized

    while ($true) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            switch ($key.Key) {
                'LeftArrow' { $selection = 1; Write-SelectorScreen -Selection $selection -ActiveProfile $ActiveProfile -Initialized $Initialized }
                'RightArrow' { $selection = 2; Write-SelectorScreen -Selection $selection -ActiveProfile $ActiveProfile -Initialized $Initialized }
                'D1' { return 1 }
                'NumPad1' { return 1 }
                'D2' { return 2 }
                'NumPad2' { return 2 }
                'Enter' { return $selection }
                'Escape' { return $null }
                default { if ($key.KeyChar -in @('q', 'Q')) { return $null } }
            }
        }
        Start-Sleep -Milliseconds 35
    }
}

function Invoke-ProfileSwitch {
    $app = Get-AppDirectory
    $root = Get-ProfileRoot
    $state = Read-ProfileState
    $initialized = $null -ne $state
    $active = if ($state) { [int]$state.activeProfile } else { $null }

    if ($state -and $state.PSObject.Properties['pendingProfile']) {
        Stop-PharmaTek
        $pending = [int]$state.pendingProfile
        Restore-Profile -Number $pending
        Write-ProfileState -ActiveProfile $pending
        Show-ResultScreen -Title 'RIPRISTINO COMPLETATO' -Lines @(
            "$($script:ProfileLabels[$pending - 1]) è stato ripristinato.",
            'PharmaTek è rimasto chiuso.'
        ) -ProfileNumber $pending
        return
    }

    $displayActive = if ($null -ne $active) { $active } else { 1 }
    $target = Read-ProfileSelection -ActiveProfile $displayActive -Initialized $initialized
    if ($null -eq $target) { return }

    if (-not $state) {
        # Prima installazione dello switcher: ciò che PharmaTek sta usando ora
        # diventa Lavoro 1. La copia si farà solo al primo vero cambio, dopo stop.
        [void](New-Item -ItemType Directory -Path $root -Force)
        New-EmptyProfile -Number 2
        Write-ProfileState -ActiveProfile 1
        $active = 1
    }

    if ($target -eq $active) {
        Show-ResultScreen -Title 'NESSUN CAMBIO NECESSARIO' -Lines @(
            "$($script:ProfileLabels[$target - 1]) è già selezionato.",
            'Le tue impostazioni sono al sicuro.'
        ) -ProfileNumber $target -Duration 1300
        return
    }

    Stop-PharmaTek
    Invoke-ProfileTransition -Number $target

    # Cattura il profilo corrente prima di cambiare qualunque file attivo.
    Save-ActiveProfile -Number $active
    New-EmptyProfile -Number $target
    $needsOnboarding = Test-ProfileNeedsOnboarding -Number $target
    Write-ProfileState -ActiveProfile $active -PendingProfile $target
    Restore-Profile -Number $target
    Write-ProfileState -ActiveProfile $target

    $resultLines = @("$($script:ProfileLabels[$target - 1]) è pronto.")
    if ($needsOnboarding) {
        $resultLines += "Al primo avvio, completa l'onboarding di questo lavoro."
    }
    $resultLines += 'PharmaTek è rimasto chiuso: puoi avviarlo quando vuoi.'
    Show-ResultScreen -Title 'CAMBIO COMPLETATO' -Lines $resultLines -ProfileNumber $target
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Invoke-ProfileSwitch
    }
    catch {
        try {
            Show-ResultScreen -Title 'SI È VERIFICATO UN PROBLEMA' -Lines @($_.Exception.Message) -IsError -WaitForKey
        }
        catch { Write-Error $_ }
        exit 1
    }
}
