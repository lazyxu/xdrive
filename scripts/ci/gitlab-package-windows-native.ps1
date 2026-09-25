param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("DecodeSigningCertificate", "VerifyReleaseSignatures")]
    [string]$Action,
    [string]$PfxPath = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

Push-Location $Root
try {
    switch ($Action) {
        "DecodeSigningCertificate" {
            if ([string]::IsNullOrWhiteSpace($PfxPath)) { throw "PfxPath is required" }
            if ([string]::IsNullOrWhiteSpace($env:XD_WINDOWS_SIGN_PFX_B64)) { throw "XD_WINDOWS_SIGN_PFX_B64 is required" }
            $parent = Split-Path -Parent $PfxPath
            if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
            [IO.File]::WriteAllBytes($PfxPath, [Convert]::FromBase64String($env:XD_WINDOWS_SIGN_PFX_B64.Trim()))
            if (-not (Test-Path $PfxPath)) { throw "failed to create release signing certificate: $PfxPath" }
        }

        "VerifyReleaseSignatures" {
            $targets = @(
                "./release/windows-build/xd.exe",
                "./release/windows-build/xdrive-agent.exe",
                "./release/windows-build/desktop/xdrive-desktop.exe",
                "./release/xDriveSetup-amd64.exe"
            )
            foreach ($target in $targets) {
                if (-not (Test-Path $target)) { throw "signed release target missing: $target" }
                $signature = Get-AuthenticodeSignature $target
                if ($signature.Status -ne "Valid") {
                    throw ("invalid Authenticode signature for {0}: {1}" -f $target, $signature.Status)
                }
            }
        }
    }
} finally {
    Pop-Location
}
