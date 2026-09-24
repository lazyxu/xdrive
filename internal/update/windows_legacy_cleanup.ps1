param(
    [Parameter(Mandatory = $true)][string]$UnifiedAppDir
)

$ErrorActionPreference = "Stop"
$unified = [System.IO.Path]::GetFullPath($UnifiedAppDir).TrimEnd('\')
$uninstallRoot = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"

function Is-UnifiedPath([string]$Path) {
    if (-not $Path) {
        return $false
    }
    try {
        $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
        return $full -eq $unified -or $full.StartsWith($unified + "\", [System.StringComparison]::OrdinalIgnoreCase)
    } catch {
        return $false
    }
}

foreach ($process in (Get-Process -Name "xdrive-desktop" -ErrorAction SilentlyContinue)) {
    try {
        $processPath = [string]$process.Path
        if ($processPath -and -not (Is-UnifiedPath $processPath)) {
            $process | Stop-Process -Force -ErrorAction SilentlyContinue
        }
    } catch {
        # Ignore races with processes that exit while migration inspects them.
    }
}

if (Test-Path -LiteralPath $uninstallRoot) {
    foreach ($key in Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue) {
        if ([string]$key.GetValue("DisplayName") -ne "xDrive Desktop") {
            continue
        }

        $locations = New-Object System.Collections.Generic.List[string]
        $installLocation = [string]$key.GetValue("InstallLocation")
        if ($installLocation) {
            $locations.Add($installLocation)
        }

        $uninstallString = [string]$key.GetValue("UninstallString")
        if ($uninstallString -match '^\s*"([^"]+)"') {
            $locations.Add((Split-Path -Parent $matches[1]))
        } elseif ($uninstallString -match '^\s*([^\s]+\.exe)') {
            $locations.Add((Split-Path -Parent $matches[1]))
        }

        foreach ($location in ($locations | Select-Object -Unique)) {
            if ($location -and -not (Is-UnifiedPath $location) -and (Test-Path -LiteralPath $location)) {
                Remove-Item -LiteralPath $location -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        Remove-Item -LiteralPath $key.PSPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
if (Test-Path -LiteralPath $runKey) {
    $item = Get-Item -LiteralPath $runKey
    foreach ($name in $item.GetValueNames()) {
        $value = [string]$item.GetValue($name)
        if ($value -match '(?i)xdrive-desktop\.exe' -and $value -notmatch [regex]::Escape((Join-Path $unified "desktop\xdrive-desktop.exe"))) {
            Remove-ItemProperty -LiteralPath $runKey -Name $name -Force -ErrorAction SilentlyContinue
        }
    }
}

$programs = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
foreach ($path in @(
    (Join-Path $programs "xDrive Desktop.lnk"),
    (Join-Path $programs "xDrive Desktop")
)) {
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
}

$legacyDefault = Join-Path $env:LOCALAPPDATA "Programs\xDrive Desktop"
if ((Test-Path -LiteralPath $legacyDefault) -and -not (Is-UnifiedPath $legacyDefault)) {
    Remove-Item -LiteralPath $legacyDefault -Recurse -Force -ErrorAction SilentlyContinue
}
