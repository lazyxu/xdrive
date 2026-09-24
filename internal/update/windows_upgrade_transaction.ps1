param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$TargetVersion,
    [string]$CurrentVersion = "",
    [Parameter(Mandatory = $true)][string]$LegacyCleanupScript,
    [Parameter(Mandatory = $true)][string]$StatusPath,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [ValidateRange(30, 1800)][int]$InstallerTimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Ensure-Parent([string]$Path) {
    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
}

function Write-Log([string]$Message) {
    Ensure-Parent $LogPath
    $line = "{0:o} {1}" -f (Get-Date), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Write-Status([string]$State, [string]$Message, [bool]$RolledBack = $false) {
    Ensure-Parent $StatusPath
    [ordered]@{
        state = $State
        current_version = $CurrentVersion
        target_version = $TargetVersion
        message = $Message
        rolled_back = $RolledBack
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
}

function Get-XDriveAppDir {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\xd.exe"
    if (Test-Path $key) {
        $value = (Get-Item -LiteralPath $key).GetValue("")
        if ($value) {
            return Split-Path -Parent ([System.IO.Path]::GetFullPath([string]$value))
        }
    }
    return (Join-Path $env:LOCALAPPDATA "Programs\xDrive")
}

function Stop-XDriveProcesses {
    Get-Process -Name "xdrive-desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -Name "xdrive-agent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $discovery = Join-Path $env:APPDATA "xdrive\desktop-ipc.json"
    Remove-Item -LiteralPath $discovery -Force -ErrorAction SilentlyContinue
}

function Mirror-Directory([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source)) {
        return
    }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    & robocopy.exe $Source $Destination /MIR /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    $code = $LASTEXITCODE
    if ($code -gt 7) {
        throw "robocopy failed with exit code $code"
    }
}

function Get-RegistryCurrentUserSubKey([string]$Key) {
    if ($Key.StartsWith("HKCU\", [System.StringComparison]::OrdinalIgnoreCase)) {
        return $Key.Substring(5)
    }
    throw "unsupported registry root in $Key"
}

function Test-RegistryKeyExists([string]$Key) {
    $subKey = Get-RegistryCurrentUserSubKey $Key
    $handle = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subKey, $false)
    if ($null -eq $handle) {
        return $false
    }
    $handle.Dispose()
    return $true
}

function Remove-RegistryKeyIfPresent([string]$Key) {
    $subKey = Get-RegistryCurrentUserSubKey $Key
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($subKey, $false)
}

function Invoke-RegExe([string[]]$Arguments, [string]$Description) {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 can surface native stderr as ErrorRecord objects.
        # reg.exe may emit a success message on that stream, so use the process exit
        # code as the authoritative result instead of $ErrorActionPreference.
        $ErrorActionPreference = "Continue"
        & reg.exe @Arguments *> $null
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($code -ne 0) {
        throw "$Description failed with exit code $code"
    }
}

function Backup-RegistryState([string]$Root) {
    $registryDir = Join-Path $Root "registry"
    Remove-Item -LiteralPath $registryDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $registryDir | Out-Null

    $keys = @(
        "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{9D7470E7-8FD9-4AE9-B9A1-1C8D860F43F1}_is1",
        "HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\xd.exe",
        "HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\xdrive-desktop.exe"
    )
    $manifest = @()
    for ($i = 0; $i -lt $keys.Count; $i++) {
        $key = $keys[$i]
        $exists = Test-RegistryKeyExists $key
        $backup = Join-Path $registryDir ("key-{0}.reg" -f $i)
        if ($exists) {
            Invoke-RegExe @("export", $key, $backup, "/y") "export registry key $key"
            if (-not (Test-Path -LiteralPath $backup)) {
                throw "registry export did not create backup for $key"
            }
        }
        $manifest += [ordered]@{
            key = $key
            existed = $exists
            backup = $backup
        }
    }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $registryDir "manifest.json") -Encoding UTF8
}

function Restore-RegistryState([string]$Root) {
    $registryDir = Join-Path $Root "registry"
    $manifestPath = Join-Path $registryDir "manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        return
    }
    $parsedManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest = if ($parsedManifest -is [System.Array]) { $parsedManifest } else { @($parsedManifest) }
    foreach ($entry in $manifest) {
        $key = [string]$entry.key
        Remove-RegistryKeyIfPresent $key
        if ([bool]$entry.existed) {
            if (-not (Test-Path -LiteralPath ([string]$entry.backup))) {
                throw "registry backup is missing for $key"
            }
            Invoke-RegExe @("import", ([string]$entry.backup)) "restore registry key $key"
        }
        $existsNow = Test-RegistryKeyExists $key
        if ([bool]$entry.existed -ne $existsNow) {
            throw "registry rollback verification failed for $key"
        }
    }
}

function Find-LegacyDesktopExe([string]$UnifiedAppDir) {
    $root = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
    if (Test-Path $root) {
        foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
            if ([string]$key.GetValue("DisplayName") -ne "xDrive Desktop") {
                continue
            }
            $location = [string]$key.GetValue("InstallLocation")
            if ($location) {
                $candidate = Join-Path $location "xdrive-desktop.exe"
                if ((Test-Path -LiteralPath $candidate) -and
                    ([System.IO.Path]::GetFullPath($location).TrimEnd('\') -ne [System.IO.Path]::GetFullPath($UnifiedAppDir).TrimEnd('\'))) {
                    return $candidate
                }
            }
        }
    }
    $fallback = Join-Path $env:LOCALAPPDATA "Programs\xDrive Desktop\xdrive-desktop.exe"
    if (Test-Path -LiteralPath $fallback) {
        return $fallback
    }
    return ""
}

function Start-Desktop([string]$AppDir) {
    $desktop = Join-Path $AppDir "desktop\xdrive-desktop.exe"
    if (Test-Path -LiteralPath $desktop) {
        Start-Process -FilePath $desktop -ArgumentList "--background" | Out-Null
        return
    }
    $legacy = Find-LegacyDesktopExe $AppDir
    if ($legacy) {
        Start-Process -FilePath $legacy -ArgumentList "--background" | Out-Null
    }
}

function Start-DesktopAndVerify([string]$AppDir) {
    $desktop = Join-Path $AppDir "desktop\xdrive-desktop.exe"
    if (-not (Test-Path -LiteralPath $desktop)) {
        throw "installed Electron Desktop is missing: $desktop"
    }

    Start-Process -FilePath $desktop -ArgumentList "--background" | Out-Null
    $deadline = (Get-Date).AddSeconds(12)
    $want = [System.IO.Path]::GetFullPath($desktop)

    while ((Get-Date) -lt $deadline) {
        foreach ($process in (Get-Process -Name "xdrive-desktop" -ErrorAction SilentlyContinue)) {
            try {
                $got = [System.IO.Path]::GetFullPath([string]$process.Path)
                if ([string]::Equals($got, $want, [System.StringComparison]::OrdinalIgnoreCase)) {
                    return
                }
            } catch {
                # Process may exit while we inspect it; keep polling until timeout.
            }
        }
        Start-Sleep -Milliseconds 300
    }
    throw "Electron Desktop post-install health check failed: process did not stay running"
}

function Start-AgentAndVerify([string]$AppDir) {
    $agent = Join-Path $AppDir "xdrive-agent.exe"
    if (-not (Test-Path -LiteralPath $agent)) {
        throw "installed Agent is missing: $agent"
    }
    Start-Process -FilePath $agent -WindowStyle Hidden | Out-Null

    $discovery = Join-Path $env:APPDATA "xdrive\desktop-ipc.json"
    $deadline = (Get-Date).AddSeconds(15)
    $lastError = "Desktop IPC discovery did not appear"
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $discovery) {
            try {
                $info = Get-Content -LiteralPath $discovery -Raw | ConvertFrom-Json
                if ($info.version -ne 1 -or -not $info.base_url -or -not $info.token) {
                    throw "invalid Desktop IPC discovery"
                }
                $headers = @{ Authorization = "Bearer $($info.token)" }
                $hello = Invoke-RestMethod -Method Get -Uri "$($info.base_url)/v1/hello" -Headers $headers -TimeoutSec 3
                if ([string]$hello.agent_version -ne $TargetVersion) {
                    throw "Agent version $($hello.agent_version) does not match target $TargetVersion"
                }
                if ([int]$hello.protocol_min -gt 1 -or [int]$hello.protocol_max -lt 1) {
                    throw "Agent Desktop IPC protocol is incompatible"
                }
                return
            } catch {
                $lastError = $_.Exception.Message
            }
        }
        Start-Sleep -Milliseconds 300
    }
    throw "Agent post-install health check failed: $lastError"
}

function Restore-LastKnownGood([string]$AppDir, [string]$BackupDir, [string]$StateRoot, [string]$StartMenuBackup) {
    Stop-XDriveProcesses
    if (-not (Test-Path -LiteralPath $BackupDir)) {
        return $false
    }
    Remove-Item -LiteralPath $AppDir -Recurse -Force -ErrorAction SilentlyContinue
    Mirror-Directory $BackupDir $AppDir
    Restore-RegistryState $StateRoot

    $startMenuGroup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\xDrive"
    Remove-Item -LiteralPath $startMenuGroup -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $StartMenuBackup) {
        Mirror-Directory $StartMenuBackup $startMenuGroup
    }

    $oldAgent = Join-Path $AppDir "xdrive-agent.exe"
    if (Test-Path -LiteralPath $oldAgent) {
        Start-Process -FilePath $oldAgent -WindowStyle Hidden | Out-Null
    }
    Start-Desktop $AppDir
    return $true
}

Start-Sleep -Seconds 2
$appDir = Get-XDriveAppDir
$transactionRoot = Split-Path -Parent $StatusPath
$backupDir = Join-Path $transactionRoot "last-known-good"
$startMenuBackup = Join-Path $transactionRoot "last-known-good-startmenu"
$startMenuGroup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\xDrive"

try {
    Write-Log "begin update $CurrentVersion -> $TargetVersion"
    Write-Status "preparing" "Creating last-known-good client backup."

    Stop-XDriveProcesses
    Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $startMenuBackup -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $appDir) {
        Mirror-Directory $appDir $backupDir
    }
    if (Test-Path -LiteralPath $startMenuGroup) {
        Mirror-Directory $startMenuGroup $startMenuBackup
    }
    Backup-RegistryState $transactionRoot

    Write-Status "installing" "Installing verified unified client package."
    $installerArgs = @(
        "/VERYSILENT",
        "/SUPPRESSMSGBOXES",
        "/NORESTART",
        "/SP-",
        "/NOSTARTAGENT",
        "/NOSTARTDESKTOP",
        "/DEFERLEGACYCLEANUP"
    )
    $process = Start-Process -FilePath $Installer -ArgumentList $installerArgs -PassThru
    if (-not $process.WaitForExit($InstallerTimeoutSeconds * 1000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "installer timed out after $InstallerTimeoutSeconds seconds"
    }
    $process.Refresh()
    if ($process.ExitCode -ne 0) {
        throw "installer exited with code $($process.ExitCode)"
    }

    $xd = Join-Path $appDir "xd.exe"
    $desktop = Join-Path $appDir "desktop\xdrive-desktop.exe"
    if (-not (Test-Path -LiteralPath $xd)) {
        throw "post-install health check failed: xd.exe is missing"
    }
    if (-not (Test-Path -LiteralPath $desktop)) {
        throw "post-install health check failed: Electron Desktop is missing"
    }
    $installedVersion = (& $xd version | Out-String).Trim()
    if ($installedVersion -ne $TargetVersion) {
        throw "post-install health check failed: xd version=$installedVersion target=$TargetVersion"
    }

    Write-Status "verifying" "Verifying Agent IPC, Electron Desktop, and unified client version."
    Start-AgentAndVerify $appDir
    Start-DesktopAndVerify $appDir

    $cleanupWarning = ""
    try {
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $LegacyCleanupScript -UnifiedAppDir $appDir
        if ($LASTEXITCODE -ne 0) {
            $cleanupWarning = "legacy Desktop cleanup exited with code $LASTEXITCODE"
        }
    } catch {
        $cleanupWarning = "legacy Desktop cleanup failed: $($_.Exception.Message)"
    }
    if ($cleanupWarning) {
        Write-Log "warning: $cleanupWarning"
    }

    Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $startMenuBackup -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $transactionRoot "registry") -Recurse -Force -ErrorAction SilentlyContinue
    if ($cleanupWarning) {
        Write-Status "success" "Unified client upgrade verified and committed; legacy cleanup needs attention."
    } else {
        Write-Status "success" "Unified client upgrade verified and committed."
    }
    Write-Log "upgrade committed successfully"
    exit 0
} catch {
    $message = $_.Exception.Message
    Write-Log "upgrade failed: $message"
    $rolledBack = $false
    try {
        $rolledBack = Restore-LastKnownGood $appDir $backupDir $transactionRoot $startMenuBackup
    } catch {
        Write-Log "rollback failed: $($_.Exception.Message)"
        $rolledBack = $false
    }
    if ($rolledBack) {
        Write-Status "rolled_back" $message $true
        Write-Log "rollback restored last-known-good client"
    } else {
        Write-Status "failed" $message $false
    }
    exit 1
}
