$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Resolver = Join-Path $Root "scripts\ci\resolve-windows-uninstaller.ps1"
$PathNormalizer = Join-Path $Root "scripts\ci\windows-path-normalization.ps1"
. $PathNormalizer
$TestRoot = Join-Path $env:TEMP ("xdrive-uninstaller-resolver-" + $PID + "-" + [Guid]::NewGuid().ToString("N"))
$TestKey = "HKCU:\Software\xDrive\CI\UninstallerResolver-" + $PID + "-" + [Guid]::NewGuid().ToString("N")

# Exercise the alias logic on every Windows runner, independent of the
# architecture of the current PowerShell process.
$syntheticWindows = "C:\Windows"
$syntheticSystem32 = "C:\Windows\System32\config\systemprofile\AppData\Local\Programs\xDrive"
$syntheticSysWOW64 = "C:\Windows\SysWOW64\config\systemprofile\AppData\Local\Programs\xDrive"
$syntheticSysnative = "C:\Windows\Sysnative\config\systemprofile\AppData\Local\Programs\xDrive"

$wowSystem32 = Get-XDriveComparablePath -Path $syntheticSystem32 -WindowsDirectory $syntheticWindows -Wow64Process $true
$wowSysWOW64 = Get-XDriveComparablePath -Path $syntheticSysWOW64 -WindowsDirectory $syntheticWindows -Wow64Process $true
if (-not [string]::Equals($wowSystem32, $wowSysWOW64, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "WOW64 comparison must normalize System32 and SysWOW64 system-profile aliases"
}

$nativeSystem32 = Get-XDriveComparablePath -Path $syntheticSystem32 -WindowsDirectory $syntheticWindows -Wow64Process $false
$nativeSysWOW64 = Get-XDriveComparablePath -Path $syntheticSysWOW64 -WindowsDirectory $syntheticWindows -Wow64Process $false
if ([string]::Equals($nativeSystem32, $nativeSysWOW64, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "64-bit comparison must keep System32 and SysWOW64 distinct"
}

$wowSysnative = Get-XDriveComparablePath -Path $syntheticSysnative -WindowsDirectory $syntheticWindows -Wow64Process $true
if ([string]::Equals($wowSystem32, $wowSysnative, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Sysnative must not be normalized as a SysWOW64 alias"
}

try {
    New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
    $candidate = Join-Path $TestRoot "unins001.exe"
    Set-Content -LiteralPath $candidate -Value "test uninstaller"

    New-Item -Path $TestKey -Force | Out-Null
    Set-ItemProperty -Path $TestKey -Name UninstallString -Value ('"' + $candidate + '" /VERYSILENT')

    $resolved = (& $Resolver -AppDir $TestRoot -UninstallKey $TestKey | Out-String).Trim()
    $want = [System.IO.Path]::GetFullPath($candidate)
    if (-not [string]::Equals($resolved, $want, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "resolver returned wrong uninstaller: $resolved != $want"
    }

    $outside = Join-Path ([System.IO.Path]::GetTempPath()) ("unins002-" + [Guid]::NewGuid().ToString("N") + ".exe")
    Set-Content -LiteralPath $outside -Value "outside"
    Set-ItemProperty -Path $TestKey -Name UninstallString -Value ('"' + $outside + '"')
    $rejected = $false
    try {
        & $Resolver -AppDir $TestRoot -UninstallKey $TestKey | Out-Null
    } catch {
        $rejected = $_.Exception.Message -like "*outside the unified app directory*"
    } finally {
        Remove-Item -LiteralPath $outside -Force -ErrorAction SilentlyContinue
    }
    if (-not $rejected) {
        throw "resolver must reject uninstallers outside the unified app directory"
    }

    # Regression: persistent SYSTEM runners can report LOCALAPPDATA through
    # System32 while 32-bit Inno Setup registers the same directory through
    # SysWOW64 (or vice versa). The resolver must treat only that well-known
    # system-profile alias as equivalent.
    $localAppData = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA)
    $system32Profile = [System.IO.Path]::GetFullPath((Join-Path $env:WINDIR "System32\config\systemprofile"))
    $syswow64Profile = [System.IO.Path]::GetFullPath((Join-Path $env:WINDIR "SysWOW64\config\systemprofile"))
    $aliasSource = $null
    $aliasTarget = $null
    if ($localAppData.StartsWith($system32Profile + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        $aliasSource = $system32Profile
        $aliasTarget = $syswow64Profile
    } elseif ($localAppData.StartsWith($syswow64Profile + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        $aliasSource = $syswow64Profile
        $aliasTarget = $system32Profile
    }

    if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess -and $null -ne $aliasSource) {
        $wowRoot = Join-Path $localAppData ("xdrive-wow64-resolver-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Force -Path $wowRoot | Out-Null
        try {
            $wowCandidate = Join-Path $wowRoot "unins003.exe"
            Set-Content -LiteralPath $wowCandidate -Value "test wow64 uninstaller"

            $wowAltRoot = $aliasTarget + $wowRoot.Substring($aliasSource.Length)
            $wowAltCandidate = Join-Path $wowAltRoot "unins003.exe"
            if (Test-Path -LiteralPath $wowAltCandidate) {
                Set-ItemProperty -Path $TestKey -Name UninstallString -Value ('"' + $wowAltCandidate + '"')
                $wowResolved = (& $Resolver -AppDir $wowRoot -UninstallKey $TestKey | Out-String).Trim()
                if (-not [string]::Equals($wowResolved, [System.IO.Path]::GetFullPath($wowAltCandidate), [System.StringComparison]::OrdinalIgnoreCase)) {
                    throw "resolver returned wrong WOW64-alias uninstaller: $wowResolved != $wowAltCandidate"
                }
            } else {
                Write-Host "WOW64 system-profile alias is not materialized on this runner; alias regression execution skipped."
            }
        } finally {
            Remove-Item -LiteralPath $wowRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "Runner is not a WOW64 process using the Windows system profile; WOW64 alias regression execution skipped."
    }

    Write-Host "Windows uninstaller resolver test passed."
} finally {
    Remove-Item -LiteralPath $TestKey -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
}
