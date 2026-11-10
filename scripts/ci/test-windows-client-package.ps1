param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$TargetVersion,
    [ValidateSet("all", "rollback", "upgrade")][string]$Scenario = "all",
    [switch]$ExpectSigned
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Installer = (Resolve-Path $Installer).Path

Push-Location $Root
try {
    & ./scripts/ci/gitlab-windows-native.ps1 -Action ValidateScripts
    & ./scripts/ci/test-windows-uninstaller-resolver.ps1
    & ./scripts/ci/test-windows-process-scope.ps1
    & ./scripts/ci/test-windows-artifact-preconditions.ps1

    $signature = Get-AuthenticodeSignature -LiteralPath $Installer
    if ($signature.Status -eq "HashMismatch") {
        throw "exact Windows installer has a damaged Authenticode signature"
    }
    if ($ExpectSigned -and ($null -eq $signature.SignerCertificate -or $signature.Status -eq "NotSigned")) {
        throw "exact Windows installer is missing its Authenticode signature"
    }

    if ($null -eq $signature.SignerCertificate) {
        # Master snapshots without production signing credentials are intentionally
        # unsigned. They cannot execute the signed updater's rollback/upgrade
        # transaction. Verify the real detached updater rejects the EXACT
        # published package instead of falsely expecting a post-install rollback.
        & ./scripts/ci/test-windows-unsigned-upgrade-admission.ps1 -Installer $Installer -TargetVersion $TargetVersion
        Write-Host "Unsigned Windows Snapshot: verified fail-closed admission; signed $Scenario transaction not validated."
        return
    }

    if ($Scenario -eq "rollback") {
        # Also exercise the unsigned negative path on signed PR builds, since
        # master Snapshot and PR signing policies intentionally differ.
        $fixture = Join-Path $env:TEMP ("xdrive-unsigned-admission-" + [guid]::NewGuid().ToString("N") + ".exe")
        try {
            [IO.File]::WriteAllBytes($fixture, [Text.Encoding]::UTF8.GetBytes("unsigned Windows installer negative fixture"))
            & ./scripts/ci/test-windows-unsigned-upgrade-admission.ps1 -Installer $fixture -TargetVersion $TargetVersion
        } finally {
            Remove-Item -LiteralPath $fixture -Force -ErrorAction SilentlyContinue
        }
    }

    & ./scripts/test-windows-client-upgrade.ps1 -Installer $Installer -TargetVersion $TargetVersion -Scenario $Scenario
    if ($LASTEXITCODE -ne 0) {
        throw "Windows upgrade/rollback test failed with exit code $LASTEXITCODE"
    }

    Write-Host "Windows exact release package passed $Scenario transaction test: $Installer"
} finally {
    Pop-Location
}
