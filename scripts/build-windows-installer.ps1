param(
    [string]$Version = "0.0.0-dev",
    [string]$OutputDir = "dist",
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

function Get-DesktopVersion([string]$ClientVersion) {
    if ($ClientVersion -match '^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$') {
        return $Matches[1]
    }
    if ($ClientVersion -match '^snapshot-([0-9A-Fa-f]{7,40})$') {
        $sha = $Matches[1]
        if ($sha.Length -gt 12) { $sha = $sha.Substring(0, 12) }
        return "0.0.0-snapshot.$sha"
    }
    if ($ClientVersion -match '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
        return $ClientVersion
    }
    $suffix = ($ClientVersion -replace '[^0-9A-Za-z.-]', '.').Trim('.')
    if ([string]::IsNullOrWhiteSpace($suffix)) { $suffix = "dev" }
    return "0.0.0-$suffix"
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

    $DesktopRoot = Join-Path $Root "desktop"
    $DesktopPackage = Join-Path $DesktopRoot "package.json"
    $OriginalDesktopPackage = Get-Content -Raw $DesktopPackage
    try {
        Push-Location $DesktopRoot
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "installing Electron desktop dependencies failed"
        }
        $DesktopVersion = Get-DesktopVersion $Version
        node scripts/set-version.mjs $DesktopVersion
        if ($LASTEXITCODE -ne 0) {
            throw "setting Electron desktop version failed"
        }
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "building Electron desktop failed"
        }
        npx electron-builder --win dir --x64
        if ($LASTEXITCODE -ne 0) {
            throw "assembling Electron desktop runtime failed"
        }
    } finally {
        Pop-Location
        Set-Content -Path $DesktopPackage -Value $OriginalDesktopPackage -NoNewline
    }

    $DesktopUnpacked = Join-Path $DesktopRoot "release\win-unpacked"
    if (-not (Test-Path (Join-Path $DesktopUnpacked "xdrive-desktop.exe"))) {
        throw "Electron desktop executable was not created: $DesktopUnpacked"
    }
    $DesktopTarget = Join-Path $Source "desktop"
    Copy-Item -Recurse -Force $DesktopUnpacked $DesktopTarget
    Sign-Artifact (Join-Path $DesktopTarget "xdrive-desktop.exe")

    $IconSource = Join-Path $Root "packaging\windows\icons\tray-normal.ico"
    $IconTarget = Join-Path $Source "icons"
    if (-not (Test-Path $IconSource)) {
        throw "Windows installer icon is missing: $IconSource"
    }
    New-Item -ItemType Directory -Force $IconTarget | Out-Null
    Copy-Item $IconSource (Join-Path $IconTarget "tray-normal.ico")

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
