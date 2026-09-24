param(
    [string]$Version = "0.0.0-dev",
    [string]$OutputDir = "dist",
    [string]$DesktopSourceDir = "",
    [string]$SigningPfxPath = $env:XD_WINDOWS_SIGN_PFX_PATH,
    [string]$SigningPassword = $env:XD_WINDOWS_SIGN_PFX_PASSWORD,
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [switch]$SkipSignatureTrustCheck
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Output = [System.IO.Path]::GetFullPath((Join-Path $Root $OutputDir))
$Source = Join-Path $Output "windows-build"
if (Test-Path $Source) {
    Remove-Item -Recurse -Force $Source
}
New-Item -ItemType Directory -Force $Source | Out-Null
New-Item -ItemType Directory -Force $Output | Out-Null

if ([string]::IsNullOrWhiteSpace($DesktopSourceDir)) {
    $DesktopSourceDir = Join-Path $Root "desktop\release\win-unpacked"
} elseif (-not [System.IO.Path]::IsPathRooted($DesktopSourceDir)) {
    $DesktopSourceDir = Join-Path $Root $DesktopSourceDir
}
$DesktopSourceDir = [System.IO.Path]::GetFullPath($DesktopSourceDir)
$DesktopExe = Join-Path $DesktopSourceDir "xdrive-desktop.exe"
if (-not (Test-Path $DesktopExe)) {
    throw "Electron desktop runtime is missing: $DesktopExe. Build desktop/release/win-unpacked first."
}

function Find-SignTool {
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $roots = @()
    if (${env:ProgramFiles(x86)}) {
        $roots += (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin")
    }
    if ($env:ProgramFiles) {
        $roots += (Join-Path $env:ProgramFiles "Windows Kits\10\bin")
    }

    foreach ($root in $roots) {
        if (-not (Test-Path $root)) {
            continue
        }
        $candidate = Get-ChildItem $root -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -like '*\x64\signtool.exe' } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($candidate) {
            return $candidate.FullName
        }
    }
    return $null
}

$SigningEnabled = -not [string]::IsNullOrWhiteSpace($SigningPfxPath)
$SignTool = $null
if ($SigningEnabled) {
    if (-not (Test-Path $SigningPfxPath)) {
        throw "signing certificate not found: $SigningPfxPath"
    }
    if ([string]::IsNullOrWhiteSpace($SigningPassword)) {
        throw "SigningPassword is required when SigningPfxPath is set"
    }
    $SignTool = Find-SignTool
    if (-not $SignTool) {
        throw "signtool.exe was not found"
    }
}

function Sign-Artifact([string]$Path) {
    if (-not $SigningEnabled) {
        return
    }

    $SignArgs = @("sign", "/fd", "SHA256", "/f", $SigningPfxPath, "/p", $SigningPassword)
    if (-not [string]::IsNullOrWhiteSpace($TimestampUrl)) {
        $SignArgs += @("/td", "SHA256", "/tr", $TimestampUrl)
    }
    $SignArgs += $Path
    & $SignTool @SignArgs
    if ($LASTEXITCODE -ne 0) {
        throw "signing failed: $Path"
    }

    if ($SkipSignatureTrustCheck) {
        $signature = Get-AuthenticodeSignature $Path
        if ($null -eq $signature.SignerCertificate -or $signature.Status -eq "NotSigned") {
            throw "Authenticode signature was not embedded: $Path"
        }
    } else {
        & $SignTool verify /pa /all $Path
        if ($LASTEXITCODE -ne 0) {
            throw "signature verification failed: $Path"
        }
    }
}

Push-Location $Root
try {
    $env:CGO_ENABLED = "0"
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    $VersionFlag = "-X github.com/lazyxu/xdrive/internal/version.Version=$Version"

    go build -trimpath -ldflags="-s -w $VersionFlag" -o (Join-Path $Source "xd.exe") ./cmd/xd
    if ($LASTEXITCODE -ne 0) {
        throw "building xd.exe failed"
    }

    go build -trimpath -ldflags="-s -w -H=windowsgui $VersionFlag" -o (Join-Path $Source "xdrive-agent.exe") ./cmd/xdrive-agent
    if ($LASTEXITCODE -ne 0) {
        throw "building xdrive-agent.exe failed"
    }

    Sign-Artifact (Join-Path $Source "xd.exe")
    Sign-Artifact (Join-Path $Source "xdrive-agent.exe")

    $IconSource = Join-Path $Root "packaging\windows\icons\tray-normal.ico"
    $IconTarget = Join-Path $Source "icons"
    if (-not (Test-Path $IconSource)) {
        throw "Windows installer icon is missing: $IconSource"
    }
    New-Item -ItemType Directory -Force $IconTarget | Out-Null
    Copy-Item $IconSource (Join-Path $IconTarget "tray-normal.ico")

    $LegacyCleanupSource = Join-Path $Root "internal\update\windows_legacy_cleanup.ps1"
    if (-not (Test-Path $LegacyCleanupSource)) {
        throw "Windows legacy Desktop cleanup script is missing: $LegacyCleanupSource"
    }
    Copy-Item $LegacyCleanupSource (Join-Path $Source "windows-legacy-cleanup.ps1")

    $DesktopTarget = Join-Path $Source "desktop"
    New-Item -ItemType Directory -Force $DesktopTarget | Out-Null
    Copy-Item (Join-Path $DesktopSourceDir "*") $DesktopTarget -Recurse -Force

    if (-not (Test-Path (Join-Path $DesktopTarget "xdrive-desktop.exe"))) {
        throw "copying Electron desktop runtime failed"
    }

    Copy-Item README.md, LICENSE $Source
} finally {
    Pop-Location
}

$Command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($Command) {
    $ISCC = $Command.Source
} else {
    $Candidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )
    $ISCC = $Candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $ISCC) {
    throw "Inno Setup 6 compiler (ISCC.exe) was not found"
}

$Iss = Join-Path $Root "packaging\windows\xdrive.iss"
& $ISCC "/DMyAppVersion=$Version" "/DSourceDir=$Source" "/DOutputDir=$Output" $Iss
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup failed with exit code $LASTEXITCODE"
}

$Installer = Join-Path $Output "xDriveSetup-amd64.exe"
if (-not (Test-Path $Installer)) {
    throw "installer was not created: $Installer"
}

Sign-Artifact $Installer
Write-Output $Installer
