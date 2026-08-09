param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Notes = '',
    [switch]$Draft
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tag = "v$Version"
$repo = 'Luke3012/Gestionale-PharmaTek'

if ((& git -C $root status --porcelain).Trim()) {
    throw 'Il worktree deve essere pulito prima del rilascio.'
}
if (-not (Test-Path "$HOME\.tauri\pharmatek-public.key")) {
    throw 'Chiave pubblica di release non trovata nella cartella .tauri.'
}

& (Join-Path $PSScriptRoot 'build.ps1') -Version $Version -NoPause
if ($LASTEXITCODE -ne 0) { throw 'Build di rilascio fallita.' }

$bundle = Join-Path $root 'src-tauri\target\release\bundle\nsis'
$setup = Get-ChildItem -LiteralPath $bundle -Filter '*-setup.exe' -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw 'Installer NSIS non trovato.' }
$sigPath = "$($setup.FullName).sig"
if (-not (Test-Path -LiteralPath $sigPath)) { throw 'Firma updater non trovata.' }

$assetName = "PharmaTek_Demo_${Version}_x64-setup.exe"
$stage = Join-Path ([IO.Path]::GetTempPath()) $assetName
Copy-Item -LiteralPath $setup.FullName -Destination $stage -Force
$signature = (Get-Content -LiteralPath $sigPath -Raw).Trim()
$downloadUrl = "https://github.com/$repo/releases/download/$tag/$assetName"
$manifest = [ordered]@{
    version = $Version
    notes = $Notes
    pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = [ordered]@{
        'windows-x86_64' = [ordered]@{ signature = $signature; url = $downloadUrl }
    }
}
$manifestPath = Join-Path ([IO.Path]::GetTempPath()) 'latest.json'
$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), $utf8NoBom)

$args = @('release', 'create', $tag, $stage, $manifestPath, '--repo', $repo, '--title', $tag)
if ($Notes) { $args += @('--notes', $Notes) } else { $args += '--generate-notes' }
if ($Draft) { $args += '--draft' }
& gh @args
if ($LASTEXITCODE -ne 0) { throw 'Creazione release GitHub fallita.' }

Remove-Item -LiteralPath $stage, $manifestPath -Force -ErrorAction SilentlyContinue
Write-Host "Release pubblica $tag creata." -ForegroundColor Green
