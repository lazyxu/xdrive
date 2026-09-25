param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$TargetVersion
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TransactionScript = Join-Path $Root "internal\update\windows_upgrade_transaction.ps1"
$LegacyCleanupScript = Join-Path $Root "internal\update\windows_legacy_cleanup.ps1"
$UninstallerResolver = Join-Path $Root "scripts\ci\resolve-windows-uninstaller.ps1"
$AppDir = Join-Path $env:LOCALAPPDATA "Programs\xDrive"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$TransactionRoot = Join-Path $env:LOCALAPPDATA "xdrive\updates\transaction"
$StatusPath = Join-Path $TransactionRoot "last-transaction.json"
$LogPath = Join-Path $TransactionRoot "last-transaction.log"
$Installer = (Resolve-Path $Installer).Path

function Stop-XDriveProcesses {
    Get-Process -Name "xdrive-desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -Name "xdrive-agent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

function Invoke-Transaction([string]$ExpectedVersion) {
    Remove-Item -LiteralPath $StatusPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $LogPath -Force -ErrorAction SilentlyContinue
    $args = @(
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", $TransactionScript,
        "-Installer", $Installer,
        "-TargetVersion", $ExpectedVersion,
        "-CurrentVersion", $TargetVersion,
        "-LegacyCleanupScript", $LegacyCleanupScript,
        "-StatusPath", $StatusPath,
        "-LogPath", $LogPath,
        "-InstallerTimeoutSeconds", "180"
    )
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $args -PassThru
    if (-not $process.WaitForExit(240000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        Stop-XDriveProcesses
        throw "update transaction timed out after 240 seconds"
    }
    $process.Refresh()
    return $process
}

function Read-Status {
    if (-not (Test-Path -LiteralPath $StatusPath)) {
        throw "transaction status file missing: $StatusPath"
    }
    return Get-Content -LiteralPath $StatusPath -Raw | ConvertFrom-Json
}

Remove-Item -LiteralPath $TransactionRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $TransactionRoot | Out-Null
Stop-XDriveProcesses

$installArgs = @(
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/SP-",
    "/NOSTARTAGENT",
    "/NOSTARTDESKTOP"
)
$install = Start-Process -FilePath $Installer -ArgumentList $installArgs -PassThru
if (-not $install.WaitForExit(180000)) {
    Stop-Process -Id $install.Id -Force -ErrorAction SilentlyContinue
    throw "baseline installer timed out after 180 seconds"
}
$install.Refresh()
if ($install.ExitCode -ne 0) {
    throw "baseline installer exited with code $($install.ExitCode)"
}

$Xd = Join-Path $AppDir "xd.exe"
if (-not (Test-Path -LiteralPath $Xd)) {
    throw "baseline xd.exe missing"
}
$baselineVersion = (& $Xd version | Out-String).Trim()
if ($baselineVersion -ne $TargetVersion) {
    throw "baseline version mismatch: $baselineVersion != $TargetVersion"
}

$marker = Join-Path $AppDir "rollback-marker.txt"
Set-Content -LiteralPath $marker -Value "last-known-good"

# Simulate a pre-unified client state where the Electron App Paths entry and
# Start-menu group did not yet exist. The failed transaction creates them;
# rollback must remove them again.
$desktopAppPathKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\xdrive-desktop.exe"
Remove-Item -LiteralPath $desktopAppPathKey -Recurse -Force -ErrorAction SilentlyContinue
$startMenuGroup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\xDrive"
Remove-Item -LiteralPath $startMenuGroup -Recurse -Force -ErrorAction SilentlyContinue

$failed = Invoke-Transaction "snapshot-deadbeefdead"
if ($failed.ExitCode -eq 0) {
    throw "fault-injection transaction unexpectedly succeeded"
}
$failedStatus = Read-Status
if ($failedStatus.state -ne "rolled_back" -or -not [bool]$failedStatus.rolled_back) {
    $tail = if (Test-Path $LogPath) { Get-Content $LogPath -Tail 120 | Out-String } else { "" }
    throw ("fault-injection transaction did not roll back: {0}{1}{2}" -f ($failedStatus | ConvertTo-Json -Compress), [Environment]::NewLine, $tail)
}
if (-not (Test-Path -LiteralPath $marker)) {
    throw "rollback did not restore the last-known-good marker"
}
if (Test-Path -LiteralPath $desktopAppPathKey) {
    throw "rollback left the new xdrive-desktop App Paths registration behind"
}
if (Test-Path -LiteralPath $startMenuGroup) {
    throw "rollback left the new xDrive Start-menu group behind"
}
$restoredVersion = (& $Xd version | Out-String).Trim()
if ($restoredVersion -ne $TargetVersion) {
    throw "rollback restored wrong version: $restoredVersion"
}
Stop-XDriveProcesses

$legacyDir = Join-Path $env:LOCALAPPDATA "Programs\xDrive Desktop Legacy Transaction CI"
New-Item -ItemType Directory -Force $legacyDir | Out-Null
Set-Content -LiteralPath (Join-Path $legacyDir "xdrive-desktop.exe") -Value "legacy"
$legacyKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\xdrive-desktop-transaction-ci"
New-Item -Path $legacyKey -Force | Out-Null
Set-ItemProperty -Path $legacyKey -Name DisplayName -Value "xDrive Desktop"
Set-ItemProperty -Path $legacyKey -Name InstallLocation -Value $legacyDir
New-Item -Path $RunKey -Force | Out-Null
Set-ItemProperty -Path $RunKey -Name "xDrive Desktop Transaction CI" -Value ('"' + (Join-Path $legacyDir "xdrive-desktop.exe") + '" --background')

$success = Invoke-Transaction $TargetVersion
if ($success.ExitCode -ne 0) {
    $tail = if (Test-Path $LogPath) { Get-Content $LogPath -Tail 80 | Out-String } else { "" }
    throw ("successful transaction exited with code {0}{1}{2}" -f $success.ExitCode, [Environment]::NewLine, $tail)
}
$successStatus = Read-Status
if ($successStatus.state -ne "success" -or [bool]$successStatus.rolled_back) {
    throw "successful transaction reported unexpected state: $($successStatus | ConvertTo-Json -Compress)"
}
if (Test-Path -LiteralPath $legacyDir) {
    throw "legacy standalone Desktop directory remains after committed transaction"
}
if (Test-Path -LiteralPath $legacyKey) {
    throw "legacy standalone Desktop uninstall registration remains after committed transaction"
}
$legacyRun = Get-ItemProperty -Path $RunKey -Name "xDrive Desktop Transaction CI" -ErrorAction SilentlyContinue
if ($null -ne $legacyRun) {
    throw "legacy standalone Desktop login item remains after committed transaction"
}

$statusText = & $Xd update --status | Out-String
if ($LASTEXITCODE -ne 0) {
    throw "xd update --status failed"
}
if ($statusText -notmatch "(?m)^state:\s+success\s*$") {
    throw "xd update --status did not report success: $statusText"
}
if ($statusText -notmatch [regex]::Escape("to: $TargetVersion")) {
    throw "xd update --status did not report target version: $statusText"
}
if ($statusText -notmatch "(?m)^rolled back:\s+false\s*$") {
    throw "xd update --status reported rollback after success: $statusText"
}

$agent = Get-Process -Name "xdrive-agent" -ErrorAction SilentlyContinue
if ($null -eq $agent) {
    throw "committed transaction did not restart xdrive-agent"
}
$desktop = Get-Process -Name "xdrive-desktop" -ErrorAction SilentlyContinue
if ($null -eq $desktop) {
    throw "committed transaction did not restart xDrive Desktop"
}
$unifiedDesktop = [System.IO.Path]::GetFullPath((Join-Path $AppDir "desktop\xdrive-desktop.exe"))
$matchedDesktop = $desktop | Where-Object {
    try {
        [System.IO.Path]::GetFullPath([string]$_.Path) -eq $unifiedDesktop
    } catch {
        $false
    }
} | Select-Object -First 1
if ($null -eq $matchedDesktop) {
    throw "committed transaction did not start the unified Electron Desktop"
}

Stop-XDriveProcesses

$uninstaller = (& $UninstallerResolver -AppDir $AppDir | Out-String).Trim()
if ([string]::IsNullOrWhiteSpace($uninstaller)) {
    throw "uninstaller resolver returned an empty path after transaction test"
}
Write-Host "transaction test uninstalling via $uninstaller"
$uninstall = Start-Process -FilePath $uninstaller -ArgumentList $installArgs -PassThru
if (-not $uninstall.WaitForExit(120000)) {
    Stop-Process -Id $uninstall.Id -Force -ErrorAction SilentlyContinue
    throw "uninstaller timed out after 120 seconds"
}
$uninstall.Refresh()
if ($uninstall.ExitCode -ne 0) {
    throw "uninstaller exited with code $($uninstall.ExitCode)"
}
if (Test-Path -LiteralPath (Join-Path $AppDir "xd.exe")) {
    throw "xd.exe remains after transaction test uninstall"
}

Remove-Item -LiteralPath $TransactionRoot -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Windows client upgrade transaction test passed."
