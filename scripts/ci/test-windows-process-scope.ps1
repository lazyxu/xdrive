$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ProcessScopeScript = Join-Path $Root "internal\update\windows_process_scope.ps1"
. $ProcessScopeScript

$installerScript = Get-Content -Raw (Join-Path $Root "packaging\windows\xdrive.iss")
if ($installerScript -match '(?i)taskkill\s+/IM\s+xdrive-(desktop|agent)\.exe') {
    throw "Windows installer still stops xDrive processes globally by image name"
}

$probeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("xdrive-process-scope-" + [Guid]::NewGuid().ToString("N"))
$probeExe = Join-Path $probeRoot "xdrive-scope-probe.exe"
$probe = $null

try {
    New-Item -ItemType Directory -Force $probeRoot | Out-Null
    Copy-Item (Join-Path $env:WINDIR "System32\ping.exe") $probeExe
    $probe = Start-Process -FilePath $probeExe -ArgumentList "-n", "60", "127.0.0.1" -WindowStyle Hidden -PassThru
    Start-Sleep -Milliseconds 300

    $currentSession = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    Stop-XDriveProcessesInSession -Names @("xdrive-scope-probe") -SessionId ($currentSession + 1000)
    $probe.Refresh()
    if ($probe.HasExited) {
        throw "process from another session scope was terminated"
    }

    & $ProcessScopeScript -StopNamesCsv "xdrive-scope-probe"
    if (-not $probe.WaitForExit(5000)) {
        throw "process in the selected session scope was not terminated"
    }

    Write-Host "Windows xDrive process-session isolation test passed"
} finally {
    if ($null -ne $probe -and -not $probe.HasExited) {
        Stop-Process -Id $probe.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $probeRoot -Recurse -Force -ErrorAction SilentlyContinue
}
