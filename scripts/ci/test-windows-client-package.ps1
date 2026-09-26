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
    & ./scripts/ci/gitlab-windows-native.ps1 -Action ValidateScripts
    & ./scripts/ci/test-windows-uninstaller-resolver.ps1

    if ($ExpectSigned) {
        $signature = Get-AuthenticodeSignature $Installer
        if ($null -eq $signature.SignerCertificate -or $signature.Status -eq "NotSigned") {
            throw "exact Windows installer is missing its Authenticode signature"
        }
    }

    & ./scripts/test-windows-client-upgrade.ps1 -Installer $Installer -TargetVersion $TargetVersion
    if ($LASTEXITCODE -ne 0) {
        throw "Windows upgrade/rollback test failed with exit code $LASTEXITCODE"
    }

    Write-Host "Windows exact release package passed artifact tests: $Installer"
} finally {
    Pop-Location
}
