param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$TargetVersion
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Installer = (Resolve-Path -LiteralPath $Installer).Path

# Negative security gate, not a completed personal upgrade. Ordinary channel
# automatic updates reject unsigned installers. A separately confirmed private
# Windows Snapshot must also reject mismatched Commit, target or digest before
# stopping any process; signed PR/stable installs keep full rollback tests.
$signature = Get-AuthenticodeSignature -LiteralPath $Installer
if ($null -ne $signature.SignerCertificate) {
    throw "unsigned admission fixture unexpectedly has an Authenticode signer"
}

$transaction = Join-Path $Root "internal\update\windows_upgrade_transaction.ps1"
$cleanup = Join-Path $Root "internal\update\windows_legacy_cleanup.ps1"
$tempBase = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
    [System.IO.Path]::GetTempPath()
} else {
    $env:RUNNER_TEMP
}
$tempRoot = Join-Path $tempBase ("xdrive-unsigned-admission-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$statusPath = Join-Path $tempRoot "transaction.json"
$logPath = Join-Path $tempRoot "transaction.log"

# Observe the existing user installation. Signature admission must reject
# before process shutdown, backup, registry writes or installer execution.
$existingXd = Join-Path $env:LOCALAPPDATA "Programs\xDrive\xd.exe"
$hadXd = Test-Path -LiteralPath $existingXd -PathType Leaf
$priorHash = if ($hadXd) { (Get-FileHash -LiteralPath $existingXd -Algorithm SHA256).Hash } else { "" }
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$priorRun = [string](Get-ItemProperty -Path $runKey -Name "xDriveAgent" -ErrorAction SilentlyContinue).xDriveAgent

# Stop-XDriveProcesses also removes this discovery marker. Its preservation
# detects an unwanted shutdown/rollback triggered by rejected unsigned input.
$discoveryPath = Join-Path $env:APPDATA "xdrive\desktop-ipc.json"
$hadDiscovery = Test-Path -LiteralPath $discoveryPath -PathType Leaf
if (-not $hadDiscovery) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $discoveryPath) | Out-Null
    [IO.File]::WriteAllText($discoveryPath, "unsigned-admission-negative-fixture")
}
$discoveryHash = (Get-FileHash -LiteralPath $discoveryPath -Algorithm SHA256).Hash

try {
    # The installed Windows PowerShell 5.1 interpreter is the real detached
    # updater's entry point. Do not mock Assert-VerifiedInstaller or bypass
    # the Authenticode check in production code.
    $args = @(
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", ('"' + $transaction + '"'),
        "-Installer", ('"' + $Installer + '"'),
        "-TargetVersion", ($TargetVersion + "-unsigned-rejected"),
        "-CurrentVersion", $TargetVersion,
        "-LegacyCleanupScript", ('"' + $cleanup + '"'),
        "-StatusPath", ('"' + $statusPath + '"'),
        "-LogPath", ('"' + $logPath + '"')
    )
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $args -PassThru -Wait -NoNewWindow
    $process.Refresh()
    if ($process.ExitCode -eq 0) {
        throw "unsigned installer unexpectedly passed detached Windows updater admission"
    }
    if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) {
        throw "unsigned rejection did not record its transaction status"
    }

    $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    if ($status.state -ne "failed" -or [bool]$status.rolled_back -or
        $status.message -ne "installer Authenticode signature missing or damaged") {
        throw ("unsigned rejection reported unexpected status: {0}" -f ($status | ConvertTo-Json -Compress))
    }
    $log = Get-Content -LiteralPath $logPath -Raw
    if (-not $log.Contains("upgrade failed: installer Authenticode signature missing or damaged") -or
        $log.Contains("upgrade committed successfully")) {
        throw "unsigned rejection did not fail in the signature preflight"
    }

    # Even when the private unsigned opt-in switch is supplied, it is NOT a
    # generic "ignore Authenticode" bypass. The separate user-confirmed path
    # requires a pinned full Commit and the exact master Snapshot target.
    # Intentionally keep this fixture's target version invalid and verify
    # refusal before any installed program or discovery state is disturbed.
    $fixtureDigest = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
    $fixtureSize = [string]((Get-Item -LiteralPath $Installer).Length)
    $badPersonalArgs = @($args) + @(
        "-ExpectedCommit", ("a" * 40),
        "-ExpectedSHA256", $fixtureDigest,
        "-ExpectedSize", $fixtureSize,
        "-PersonalUnsigned"
    )
    Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
    $personalProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $badPersonalArgs -PassThru -Wait -NoNewWindow
    $personalProcess.Refresh()
    if ($personalProcess.ExitCode -eq 0) {
        throw "personal unsigned switch bypassed full source/channel admission"
    }
    $personalStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    if ($personalStatus.state -ne "failed" -or [bool]$personalStatus.rolled_back -or
        $personalStatus.message -notlike "personal unsigned installer requires exact Windows Snapshot*") {
        throw ("invalid personal unsigned admission was not refused before mutation: {0}" -f ($personalStatus | ConvertTo-Json -Compress))
    }

    $hasXd = Test-Path -LiteralPath $existingXd -PathType Leaf
    if ($hasXd -ne $hadXd) {
        throw "unsigned rejection modified installed xd.exe presence"
    }
    if ($hadXd -and (Get-FileHash -LiteralPath $existingXd -Algorithm SHA256).Hash -ne $priorHash) {
        throw "unsigned rejection modified installed xd.exe bytes"
    }
    $afterRun = [string](Get-ItemProperty -Path $runKey -Name "xDriveAgent" -ErrorAction SilentlyContinue).xDriveAgent
    if ($afterRun -ne $priorRun) {
        throw "unsigned rejection modified xDriveAgent autorun state"
    }
    if (-not (Test-Path -LiteralPath $discoveryPath -PathType Leaf) -or
        (Get-FileHash -LiteralPath $discoveryPath -Algorithm SHA256).Hash -ne $discoveryHash) {
        throw "unsigned rejection unexpectedly stopped the active Desktop discovery session"
    }

    Write-Host "Windows detached updater correctly rejected unsigned installer before installation (no rollback claimed)."
} finally {
    if (-not $hadDiscovery) {
        Remove-Item -LiteralPath $discoveryPath -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
