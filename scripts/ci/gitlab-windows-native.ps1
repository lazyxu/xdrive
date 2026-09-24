param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("ValidateScripts", "PrepareSigning", "BuildInstaller", "VerifySignatures", "SmokeInstall")]
    [string]$Action,
    [string]$PfxPath = "",
    [string]$Password = "xdrive-ci-signing"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

Push-Location $Root
try {
    switch ($Action) {
        "ValidateScripts" {
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/windows-e2e.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/build-windows-installer.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/ci/gitlab-windows-native.ps1))
        }

        "PrepareSigning" {
            if ([string]::IsNullOrWhiteSpace($PfxPath)) { throw "PfxPath is required" }
            $parent = Split-Path -Parent $PfxPath
            if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
            $secure = ConvertTo-SecureString $Password -AsPlainText -Force
            $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=xDrive CI Test" -CertStoreLocation "Cert:\CurrentUser\My" -KeyExportPolicy Exportable
            Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $secure | Out-Null
            if (-not (Test-Path $PfxPath)) { throw "failed to create CI signing certificate: $PfxPath" }
        }

        "BuildInstaller" {
            & ./scripts/build-windows-installer.ps1 -Version 0.0.0-ci -OutputDir dist -DesktopSourceDir desktop/release/win-unpacked -TimestampUrl "" -SkipSignatureTrustCheck
            if ($LASTEXITCODE -ne 0) { throw "Windows unified installer build failed with exit code $LASTEXITCODE" }
        }

        "VerifySignatures" {
            $targets = @(
                "./dist/windows-build/xd.exe",
                "./dist/windows-build/xdrive-agent.exe",
                "./dist/windows-build/desktop/xdrive-desktop.exe",
                "./dist/xDriveSetup-amd64.exe"
            )
            foreach ($target in $targets) {
                $signature = Get-AuthenticodeSignature $target
                if ($null -eq $signature.SignerCertificate -or $signature.Status -eq "NotSigned") { throw "missing Authenticode signature for $target" }
                if ($signature.SignerCertificate.Subject -ne "CN=xDrive CI Test") { throw "unexpected signer for $($target): $($signature.SignerCertificate.Subject)" }
            }
        }

        "SmokeInstall" {
            $installer = (Resolve-Path ./dist/xDriveSetup-amd64.exe).Path
            $args = @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/NOSTARTAGENT", "/NOSTARTDESKTOP")
            $p = Start-Process -FilePath $installer -ArgumentList $args -Wait -PassThru
            if ($p.ExitCode -ne 0) { throw "installer exit code $($p.ExitCode)" }

            $app = Join-Path $env:LOCALAPPDATA "Programs\xDrive"
            if (-not (Test-Path (Join-Path $app "xd.exe"))) { throw "installed xd.exe missing" }
            if (-not (Test-Path (Join-Path $app "xdrive-agent.exe"))) { throw "installed agent missing" }
            if (-not (Test-Path (Join-Path $app "desktop\xdrive-desktop.exe"))) { throw "installed Electron desktop missing" }
            if (Test-Path (Join-Path $app "icons")) { throw "runtime tray icons must not be installed" }

            $shortcutRoots = @((Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"), (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs"))
            $shortcut = $shortcutRoots | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Filter "xDrive.lnk" -Recurse -ErrorAction SilentlyContinue } | Select-Object -First 1
            if ($null -eq $shortcut) { throw "unified client must install the xDrive Desktop shortcut" }

            $reported = & (Join-Path $app "xd.exe") version
            if ($LASTEXITCODE -ne 0) { throw "installed xd.exe version command failed" }
            if ($reported.Trim() -ne "0.0.0-ci") { throw "embedded version mismatch: $reported" }

            $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
            $runValue = (Get-ItemProperty -Path $runKey -Name "xDriveAgent" -ErrorAction Stop).xDriveAgent
            if ($runValue -notlike "*xdrive-agent.exe*") { throw "xDriveAgent autorun registration missing" }

            $uninstaller = Join-Path $app "unins000.exe"
            if (-not (Test-Path $uninstaller)) { throw "uninstaller missing" }
            $u = Start-Process -FilePath $uninstaller -ArgumentList $args -Wait -PassThru
            if ($u.ExitCode -ne 0) { throw "uninstaller exit code $($u.ExitCode)" }

            if (Test-Path (Join-Path $app "xd.exe")) { throw "xd.exe remains after uninstall" }
            $left = Get-ItemProperty -Path $runKey -Name "xDriveAgent" -ErrorAction SilentlyContinue
            if ($null -ne $left) { throw "xDriveAgent autorun remains after uninstall" }
        }
    }
} finally {
    Pop-Location
}
