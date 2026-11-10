param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$TargetVersion,
    [string]$CurrentVersion = "",
    [Parameter(Mandatory = $true)][string]$LegacyCleanupScript,
    [Parameter(Mandatory = $true)][string]$StatusPath,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [string]$ExpectedSHA256 = "",
    [long]$ExpectedSize = 0,
    [string]$ExpectedCommit = "",
    [switch]$PersonalUnsigned,
    [ValidateRange(30, 1800)][int]$InstallerTimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"

# The detached Windows PowerShell 5.1 process may be a grandchild of pwsh 7
# (CI: pwsh -> Start-Process -> powershell.exe). It then inherits the pwsh
# PSModulePath and autoloads incompatible 7.x Security/Utility modules first.
# Prepend THIS interpreter's trusted, built-in WindowsPowerShell modules.
# Failure to locate them is fail-closed: never skip signature/hash admission.
$windowsPowerShellModules = [System.IO.Path]::Combine($PSHOME, "Modules")
if (-not [System.IO.Directory]::Exists($windowsPowerShellModules)) {
    throw "Windows PowerShell built-in security modules are unavailable"
}
$env:PSModulePath = $windowsPowerShellModules + ";" + $env:PSModulePath

. (Join-Path $PSScriptRoot "windows_process_scope.ps1")

function Get-XDriveStartMenuProgramPaths {
    $paths = @()
    $knownPrograms = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
    if (-not [string]::IsNullOrWhiteSpace($knownPrograms)) { $paths += $knownPrograms }
    if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
        $appDataPrograms = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
        if ([Environment]::Is64BitOperatingSystem -and $appDataPrograms -match '(?i)\\System32\\config\\systemprofile\\') {
            $paths += ($appDataPrograms -replace '(?i)\\System32\\config\\systemprofile\\', '\SysWOW64\config\systemprofile\')
        } elseif ([Environment]::Is64BitOperatingSystem -and $appDataPrograms -match '(?i)\\SysWOW64\\config\\systemprofile\\') {
            $paths += ($appDataPrograms -replace '(?i)\\SysWOW64\\config\\systemprofile\\', '\System32\config\systemprofile\')
        }
        $paths += $appDataPrograms
    }
    $commonPrograms = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonPrograms)
    if (-not [string]::IsNullOrWhiteSpace($commonPrograms)) { $paths += $commonPrograms }
    return $paths | Select-Object -Unique
}

function Get-XDriveStartMenuGroup {
    $groups = @(Get-XDriveStartMenuProgramPaths | ForEach-Object { Join-Path $_ "xDrive" })
    $existing = $groups | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($null -ne $existing) { return $existing }
    if ($groups.Count -eq 0) { throw "Windows Start Menu Programs folder could not be resolved" }
    return $groups[0]
}
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

# The detached Windows installer revalidates the download identity and
# Authenticode publisher rather than trusting a no-longer-running Go Agent.
# Normal automatic updates never execute unsigned or foreign-publisher EXEs.
# Only the separately user-confirmed, source-verified personal Snapshot path
# may accept a truly unsigned installer with pinned size, SHA-256 and Commit.
function Assert-VerifiedInstaller([string]$PackagePath, [string]$InstalledDir) {
    $package = Get-Item -LiteralPath $PackagePath -ErrorAction Stop
    if (-not ($package -is [System.IO.FileInfo])) {
        throw "installer path is not a regular file"
    }
    if (($package.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "installer cannot be a symlink/reparse point"
    }
    if ($ExpectedSize -gt 0 -and $package.Length -ne $ExpectedSize) {
        throw "installer size changed after download"
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedSHA256)) {
        if ($ExpectedSHA256 -notmatch '^[0-9a-fA-F]{64}$') {
            throw "expected installer SHA-256 is invalid"
        }
        $actualHash = (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash
        if (-not [string]::Equals($actualHash, $ExpectedSHA256,
            [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "installer SHA-256 changed after verified download"
        }
    }
    if ($ExpectedCommit -ne "" -and $ExpectedCommit -cnotmatch '^[0-9a-f]{40}$') {
        throw "expected source Commit must be 40 lowercase hexadecimal characters"
    }
    $candidate = Get-AuthenticodeSignature -LiteralPath $PackagePath
    if ($PersonalUnsigned) {
        # Explicit current-Server consent is enforced by authenticated Agent
        # IPC; the Agent independently checked the public exact-Commit Bundle.
        # Recheck downloaded bytes and admission before any process shutdown.
        if ($TargetVersion -ne "snapshot" -or $ExpectedCommit -cnotmatch '^[0-9a-f]{40}$' -or
            $package.Name -cne "xDriveSetup-amd64.exe" -or $ExpectedSize -le 0 -or
            $ExpectedSHA256 -notmatch '^[0-9a-fA-F]{64}$') {
            throw "personal unsigned installer requires exact Windows Snapshot, Commit, SHA-256 and size"
        }
        if ($candidate.Status -ne "NotSigned" -or $null -ne $candidate.SignerCertificate) {
            throw "personal unsigned mode refuses signed or damaged installer; use normal publisher admission"
        }
        return
    }
    if ($null -eq $candidate.SignerCertificate -or $candidate.Status -eq 'NotSigned' -or
        $candidate.Status -eq 'HashMismatch') {
        throw "installer Authenticode signature missing or damaged"
    }
    $installedBinary = Join-Path $InstalledDir "xd.exe"
    if (Test-Path -LiteralPath $installedBinary -PathType Leaf) {
        $existing = Get-AuthenticodeSignature -LiteralPath $installedBinary
        if ($null -eq $existing.SignerCertificate) {
            throw "current client is unsigned; automatic publisher trust is unavailable"
        }
        if (-not [string]::Equals($candidate.SignerCertificate.Thumbprint,
            $existing.SignerCertificate.Thumbprint,
            [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "installer publisher differs from the trusted installed xDrive client"
        }
    } elseif ($candidate.Status -ne 'Valid') {
        # Without an installed signer to pin, Windows OS trust is required.
        throw "installer publisher has no trusted signing chain"
    }
}

function Stop-XDriveProcesses {
    Stop-XDriveProcessesInSession -Names @("xdrive-desktop", "xdrive-agent")
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

function Test-DesktopStartupCommit([int]$DesktopPID) {
    if ($ExpectedCommit -eq "") { return $true }
    # The marker pins the live Electron main PID; its lifecycle start record
    # contains the actual packaged Desktop Commit, never just its version.
    $directory = Join-Path $env:LOCALAPPDATA "xDrive"
    $marker = Join-Path $directory "desktop-running.json"
    $log = Join-Path $directory "desktop.log"
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf) -or
        -not (Test-Path -LiteralPath $log -PathType Leaf)) { return $false }
    try {
        $active = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
        if ([int]$active.pid -ne $DesktopPID -or [string]$active.version -ne $TargetVersion) { return $false }
        foreach ($line in @(Get-Content -LiteralPath $log -Tail 200 -ErrorAction Stop)) {
            try {
                $event = $line | ConvertFrom-Json
                if ($event.event -eq "start" -and [int]$event.pid -eq $DesktopPID -and
                    [string]$event.version -eq $TargetVersion -and
                    [string]$event.commit -ceq $ExpectedCommit) { return $true }
            } catch { }
        }
    } catch { return $false }
    return $false
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
        foreach ($process in (Get-XDriveProcessesInSession -Names @("xdrive-desktop"))) {
            try {
                $got = [System.IO.Path]::GetFullPath([string]$process.Path)
                if ([string]::Equals($got, $want, [System.StringComparison]::OrdinalIgnoreCase) -and
                    (Test-DesktopStartupCommit ([int]$process.Id))) {
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
                if ($ExpectedCommit -ne "" -and [string]$hello.agent_commit -cne $ExpectedCommit) {
                    throw "Agent source Commit $($hello.agent_commit) does not match target $ExpectedCommit"
                }
                if ([int]$hello.protocol_min -gt 2 -or [int]$hello.protocol_max -lt 2) {
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

    $startMenuGroup = Get-XDriveStartMenuGroup
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
$startMenuGroup = Get-XDriveStartMenuGroup

# Do not stop the existing client or touch a stale backup when installer
# admission fails. Rollback is only valid once this transaction has begun
# changing the running client state.
$transactionStarted = $false
try {
    Write-Log "begin update $CurrentVersion -> $TargetVersion"
    Write-Status "preparing" "Verifying downloaded installer and publisher."
    Assert-VerifiedInstaller $Installer $appDir
    Write-Status "preparing" "Creating last-known-good client backup."

    $transactionStarted = $true
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
    # Reverify just before launching the detached executable.
    Assert-VerifiedInstaller $Installer $appDir
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
    if ($ExpectedCommit -ne "") {
        $buildJSON = (& $xd version --json | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "post-install health check failed: xd version --json exited with $LASTEXITCODE"
        }
        $build = $buildJSON | ConvertFrom-Json
        if ([string]$build.commit -cne $ExpectedCommit) {
            throw "post-install health check failed: xd source Commit=$($build.commit) target=$ExpectedCommit"
        }
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
    if ($transactionStarted) {
        try {
            $rolledBack = Restore-LastKnownGood $appDir $backupDir $transactionRoot $startMenuBackup
        } catch {
            Write-Log "rollback failed: $($_.Exception.Message)"
            $rolledBack = $false
        }
    }
    if ($rolledBack) {
        Write-Status "rolled_back" $message $true
        Write-Log "rollback restored last-known-good client"
    } else {
        Write-Status "failed" $message $false
    }
    exit 1
}
