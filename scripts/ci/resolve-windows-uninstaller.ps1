param(
    [Parameter(Mandatory = $true)][string]$AppDir,
    [string]$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{9D7470E7-8FD9-4AE9-B9A1-1C8D860F43F1}_is1"
)

$ErrorActionPreference = "Stop"

$appFull = [System.IO.Path]::GetFullPath($AppDir).TrimEnd('\')
if (-not (Test-Path -LiteralPath $UninstallKey)) {
    $candidates = @()
    if (Test-Path -LiteralPath $appFull) {
        $candidates = @(Get-ChildItem -LiteralPath $appFull -Filter "unins*.exe" -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    }
    $candidateText = if ($candidates.Count -gt 0) { $candidates -join ", " } else { "<none>" }
    throw "xDrive uninstall registration missing: $UninstallKey; uninstaller candidates in ${appFull}: $candidateText"
}

$props = Get-ItemProperty -LiteralPath $UninstallKey -ErrorAction Stop
$raw = [Environment]::ExpandEnvironmentVariables([string]$props.UninstallString).Trim()
if ([string]::IsNullOrWhiteSpace($raw)) {
    throw "xDrive uninstall registration has no UninstallString: $UninstallKey"
}

$uninstaller = ""
if ($raw -match '^\s*"([^"]+)"') {
    $uninstaller = $matches[1]
} elseif ($raw -match '^\s*(.+?\.exe)(?:\s|$)') {
    $uninstaller = $matches[1].Trim()
} else {
    throw "could not parse xDrive UninstallString: $raw"
}

$full = [System.IO.Path]::GetFullPath($uninstaller)
$parent = [System.IO.Path]::GetFullPath((Split-Path -Parent $full)).TrimEnd('\')
if (-not [string]::Equals($parent, $appFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "xDrive uninstaller is outside the unified app directory: $full (expected under $appFull)"
}

$name = [System.IO.Path]::GetFileName($full)
if ($name -notmatch '^unins\d+\.exe$') {
    throw "unexpected xDrive uninstaller filename: $name"
}
if (-not (Test-Path -LiteralPath $full)) {
    throw "registered xDrive uninstaller is missing: $full"
}

Write-Output $full
