param(
    [string]$Version = "0.0.0-dev",
    [string]$OutputDir = "dist",
    [string]$SigningPfxPath = $env:XD_WINDOWS_SIGN_PFX_PATH,
    [string]$SigningPassword = $env:XD_WINDOWS_SIGN_PFX_PASSWORD,
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Output = [System.IO.Path]::GetFullPath((Join-Path $Root $OutputDir))
$Source = Join-Path $Output "windows-build"
New-Item -ItemType Directory -Force $Source | Out-Null
New-Item -ItemType Directory -Force $Output | Out-Null

function Find-SignTool {
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $roots = @()
    if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin") }
    if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles "Windows Kits\10\bin") }
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $candidate = Get-ChildItem $root -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\signtool\.exe
try {
    $env:CGO_ENABLED = "0"
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    $VersionFlag = "-X github.com/lazyxu/xdrive/internal/version.Version=$Version"

    go build -trimpath -ldflags="-s -w $VersionFlag" -o (Join-Path $Source "xd.exe") ./cmd/xd
    if ($LASTEXITCODE -ne 0) { throw "building xd.exe failed" }

    go build -trimpath -ldflags="-s -w -H=windowsgui $VersionFlag" -o (Join-Path $Source "xdrive-agent.exe") ./cmd/xdrive-agent
    if ($LASTEXITCODE -ne 0) { throw "building xdrive-agent.exe failed" }

    Sign-Artifact (Join-Path $Source "xd.exe")
    Sign-Artifact (Join-Path $Source "xdrive-agent.exe")
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
 } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($candidate) { return $candidate.FullName }
    }
    return $null
}

$SigningEnabled = -not [string]::IsNullOrWhiteSpace($SigningPfxPath)
$SignTool = $null
if ($SigningEnabled) {
    if (-not (Test-Path $SigningPfxPath)) { throw "signing certificate not found: $SigningPfxPath" }
    if ([string]::IsNullOrWhiteSpace($SigningPassword)) { throw "SigningPassword is required when SigningPfxPath is set" }
    $SignTool = Find-SignTool
    if (-not $SignTool) { throw "signtool.exe was not found" }
}

function Sign-Artifact([string]$Path) {
    if (-not $SigningEnabled) { return }
    & $SignTool sign /fd SHA256 /td SHA256 /tr $TimestampUrl /f $SigningPfxPath /p $SigningPassword $Path
    if ($LASTEXITCODE -ne 0) { throw "signing failed: $Path" }
    & $SignTool verify /pa /all $Path
    if ($LASTEXITCODE -ne 0) { throw "signature verification failed: $Path" }
}

Push-Location $Root
try {
    $env:CGO_ENABLED = "0"
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    $VersionFlag = "-X github.com/lazyxu/xdrive/internal/version.Version=$Version"

    go build -trimpath -ldflags="-s -w $VersionFlag" -o (Join-Path $Source "xd.exe") ./cmd/xd
    if ($LASTEXITCODE -ne 0) { throw "building xd.exe failed" }

    go build -trimpath -ldflags="-s -w -H=windowsgui $VersionFlag" -o (Join-Path $Source "xdrive-agent.exe") ./cmd/xdrive-agent
    if ($LASTEXITCODE -ne 0) { throw "building xdrive-agent.exe failed" }

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
Write-Output $Installer
