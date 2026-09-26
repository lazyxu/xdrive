param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$TargetVersion,
    [switch]$ExpectSigned
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Installer = (Resolve-Path $Installer).Path

Push-Location $Root
try {
    if ($ExpectSigned) {
        $signature = Get-AuthenticodeSignature $Installer
        if ($null -eq $signature.SignerCertificate -or $signature.Status -eq "NotSigned") {
            throw "exact Windows installer is missing its Authenticode signature"
        }
    }

    $releaseInstaller = [System.IO.Path]::GetFullPath((Join-Path $Root "release\xDriveSetup-amd64.exe"))
    if (-not [string]::Equals($Installer, $releaseInstaller, [System.StringComparison]::OrdinalIgnoreCase)) {
        New-Item -ItemType Directory -Force (Split-Path -Parent $releaseInstaller) | Out-Null
        Copy-Item $Installer $releaseInstaller -Force
    }

    & ./scripts/ci/gitlab-windows-native.ps1 -Action SmokeInstall -Version $TargetVersion
    if ($LASTEXITCODE -ne 0) {
        throw "Windows exact-package smoke install/uninstall failed with exit code $LASTEXITCODE"
    }

    Write-Host "Windows exact release package passed smoke install/uninstall: $Installer"
} finally {
    Pop-Location
}
