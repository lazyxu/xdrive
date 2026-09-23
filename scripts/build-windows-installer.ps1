param(
    [string]$Version = "0.0.0-dev",
    [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Output = [System.IO.Path]::GetFullPath((Join-Path $Root $OutputDir))
$Source = Join-Path $Output "windows-build"
New-Item -ItemType Directory -Force $Source | Out-Null
New-Item -ItemType Directory -Force $Output | Out-Null

Push-Location $Root
try {
    $env:CGO_ENABLED = "0"
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    go build -trimpath -ldflags="-s -w" -o (Join-Path $Source "xd.exe") ./cmd/xd
    if ($LASTEXITCODE -ne 0) { throw "building xd.exe failed" }

    go build -trimpath -ldflags="-s -w -H=windowsgui" -o (Join-Path $Source "xdrive-agent.exe") ./cmd/xdrive-agent
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
