$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Resolver = Join-Path $Root "scripts\ci\resolve-windows-uninstaller.ps1"
$TestRoot = Join-Path $env:TEMP ("xdrive-uninstaller-resolver-" + $PID + "-" + [Guid]::NewGuid().ToString("N"))
$TestKey = "HKCU:\Software\xDrive\CI\UninstallerResolver-" + $PID + "-" + [Guid]::NewGuid().ToString("N")

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

    Write-Host "Windows uninstaller resolver test passed."
} finally {
    Remove-Item -LiteralPath $TestKey -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
}
