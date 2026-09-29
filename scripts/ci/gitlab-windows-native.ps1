param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("ValidateScripts", "PrepareSigning", "BuildInstaller", "VerifySignatures", "SmokeInstall")]
    [string]$Action,
    [string]$PfxPath = "",
    [string]$Password = "xdrive-ci-signing",
    [string]$Version = "0.0.0-ci",
    [string]$CoreSourceDir = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $Root "scripts\ci\windows-path-normalization.ps1")

Push-Location $Root
try {
    switch ($Action) {
        "ValidateScripts" {
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/windows-e2e.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/build-windows-installer.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/test-windows-client-upgrade.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./internal/update/windows_upgrade_transaction.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./internal/update/windows_legacy_cleanup.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./internal/update/windows_process_scope.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/ci/gitlab-windows-native.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/ci/resolve-windows-uninstaller.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/ci/test-windows-uninstaller-resolver.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/ci/test-windows-client-package.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/ci/test-windows-process-scope.ps1))
            $null = [scriptblock]::Create((Get-Content -Raw ./scripts/ci/test-windows-smoke-package.ps1))
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
            if ($env:CI_PIPELINE_SOURCE -eq "merge_request_event") {
                & ./scripts/build-windows-installer.ps1 -Version $Version -OutputDir release -DesktopSourceDir desktop/release/win-unpacked -CoreSourceDir $CoreSourceDir -TimestampUrl "" -SkipSignatureTrustCheck
            } else {
                & ./scripts/build-windows-installer.ps1 -Version $Version -OutputDir release -DesktopSourceDir desktop/release/win-unpacked -CoreSourceDir $CoreSourceDir
            }
            if ($LASTEXITCODE -ne 0) { throw "Windows unified installer build failed with exit code $LASTEXITCODE" }
        }

        "VerifySignatures" {
            $targets = @(
                "./release/windows-build/xd.exe",
                "./release/windows-build/xdrive-agent.exe",
                "./release/windows-build/desktop/xdrive-desktop.exe",
                "./release/xDriveSetup-amd64.exe"
            )
            foreach ($target in $targets) {
                $signature = Get-AuthenticodeSignature $target
                if ($null -eq $signature.SignerCertificate -or $signature.Status -eq "NotSigned") { throw "missing Authenticode signature for $target" }
                if ($signature.SignerCertificate.Subject -ne "CN=xDrive CI Test") { throw "unexpected signer for $($target): $($signature.SignerCertificate.Subject)" }
            }
        }

        "SmokeInstall" {
            $installer = (Resolve-Path ./release/xDriveSetup-amd64.exe).Path
            $args = @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/NOSTARTAGENT", "/NOSTARTDESKTOP")
            $p = Start-Process -FilePath $installer -ArgumentList $args -Wait -PassThru
            if ($p.ExitCode -ne 0) { throw "installer exit code $($p.ExitCode)" }

            $app = Join-Path $env:LOCALAPPDATA "Programs\xDrive"
            $desktopDir = Join-Path $app "desktop"
            $desktopExe = Join-Path $desktopDir "xdrive-desktop.exe"
            if (-not (Test-Path (Join-Path $app "xd.exe"))) { throw "installed xd.exe missing" }
            if (-not (Test-Path (Join-Path $app "xdrive-agent.exe"))) { throw "installed agent missing" }
            if (-not (Test-Path $desktopExe)) { throw "installed Electron desktop missing" }
            if (Test-Path (Join-Path $app "icons")) { throw "runtime tray icons must not be installed" }

            $requiredDesktopResources = @(
                "resources\app.asar",
                "resources\app-icon.png",
                "resources\tray-icons\tray-normal.png",
                "resources\tray-icons\tray-syncing.png",
                "resources\tray-icons\tray-paused.png",
                "resources\tray-icons\tray-conflict.png",
                "resources\tray-icons\tray-offline.png"
            )
            foreach ($relative in $requiredDesktopResources) {
                $resource = Join-Path $desktopDir $relative
                if (-not (Test-Path $resource -PathType Leaf)) {
                    throw "installed Desktop resource missing: $relative"
                }
            }
            foreach ($relative in $requiredDesktopResources | Where-Object { $_ -like "*.png" }) {
                $resource = Join-Path $desktopDir $relative
                $bytes = [System.IO.File]::ReadAllBytes($resource)
                $pngSignature = [byte[]](137, 80, 78, 71, 13, 10, 26, 10)
                if ($bytes.Length -lt 24) { throw "installed Desktop PNG is truncated: $relative" }
                for ($i = 0; $i -lt $pngSignature.Length; $i++) {
                    if ($bytes[$i] -ne $pngSignature[$i]) { throw "installed Desktop resource is not a PNG: $relative" }
                }
                $width = [System.Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($bytes, 16))
                $height = [System.Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($bytes, 20))
                if ($width -le 0 -or $height -le 0) { throw "installed Desktop PNG has invalid dimensions: $relative" }
            }

            $shortcutRoots = @(Get-XDriveStartMenuProgramPaths)
            $shortcut = $shortcutRoots | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Filter "xDrive.lnk" -Recurse -ErrorAction SilentlyContinue } | Select-Object -First 1
            if ($null -eq $shortcut) { throw "unified client must install the xDrive Desktop shortcut (searched: $($shortcutRoots -join ', '))" }

            $reported = & (Join-Path $app "xd.exe") version
            if ($LASTEXITCODE -ne 0) { throw "installed xd.exe version command failed" }
            if ($reported.Trim() -ne $Version) { throw "embedded version mismatch: $reported" }

            $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
            $runValue = (Get-ItemProperty -Path $runKey -Name "xDriveAgent" -ErrorAction Stop).xDriveAgent
            if ($runValue -notlike "*xdrive-agent.exe*") { throw "xDriveAgent autorun registration missing" }

            # The installer smoke test must prove that the exact packaged Electron runtime
            # can really start, render a top-level window, and stay alive. Merely checking
            # that xdrive-desktop.exe exists would not catch packaged startup regressions.
            $runnerSession = (Get-Process -Id $PID).SessionId
            $agentPidsBefore = @(
                Get-Process -Name "xdrive-agent" -ErrorAction SilentlyContinue |
                    Where-Object { $_.SessionId -eq $runnerSession } |
                    ForEach-Object { $_.Id }
            )
            $desktopLogDir = Join-Path $env:LOCALAPPDATA "xDrive"
            $desktopLog = Join-Path $desktopLogDir "desktop.log"
            $desktopMarker = Join-Path $desktopLogDir "desktop-running.json"
            Remove-Item $desktopLog, $desktopMarker -Force -ErrorAction SilentlyContinue

            $desktop = $null
            try {
                $desktop = Start-Process -FilePath $desktopExe -PassThru
                $deadline = [DateTime]::UtcNow.AddSeconds(20)
                $windowReady = $false
                while ([DateTime]::UtcNow -lt $deadline) {
                    Start-Sleep -Milliseconds 250
                    $desktop.Refresh()
                    if ($desktop.HasExited) {
                        throw "installed Desktop exited during startup with code $($desktop.ExitCode)"
                    }
                    if ($desktop.MainWindowHandle -ne 0) {
                        $windowReady = $true
                        break
                    }
                }
                if (-not $windowReady) {
                    throw "installed Desktop did not create a main window within 20 seconds"
                }

                Start-Sleep -Seconds 2
                $desktop.Refresh()
                if ($desktop.HasExited) {
                    throw "installed Desktop exited immediately after showing its main window with code $($desktop.ExitCode)"
                }
                if (-not (Test-Path $desktopLog -PathType Leaf)) {
                    throw "installed Desktop did not create its lifecycle log"
                }
                $desktopLifecycle = Get-Content -Raw $desktopLog
                if ($desktopLifecycle -notmatch '"event":"start"') {
                    throw "installed Desktop lifecycle log is missing the start event"
                }
                if ($desktopLifecycle -match '"event":"startup_failed"') {
                    throw "installed Desktop reported startup_failed: $desktopLifecycle"
                }
                if ($desktopLifecycle -match '"event":"render_process_gone"') {
                    throw "installed Desktop renderer crashed during startup: $desktopLifecycle"
                }
            } finally {
                if ($null -ne $desktop) {
                    try {
                        $desktop.Refresh()
                        if (-not $desktop.HasExited) {
                            & taskkill.exe /PID $desktop.Id /T /F | Out-Null
                        }
                    } catch {
                        Write-Warning "failed to stop Desktop smoke-test process tree: $($_.Exception.Message)"
                    }
                }

                # Desktop may launch the installed Agent independently. Stop only Agent
                # processes newly created in this runner session; never touch another session.
                $agentPidsAfter = @(
                    Get-Process -Name "xdrive-agent" -ErrorAction SilentlyContinue |
                        Where-Object { $_.SessionId -eq $runnerSession } |
                        ForEach-Object { $_.Id }
                )
                foreach ($agentPid in $agentPidsAfter) {
                    if ($agentPidsBefore -notcontains $agentPid) {
                        Stop-Process -Id $agentPid -Force -ErrorAction SilentlyContinue
                    }
                }
            }

            $shellCleanup = Start-Process -FilePath (Join-Path $app "xdrive-agent.exe") -ArgumentList @("--shell-action", "unregister") -Wait -PassThru
            if ($shellCleanup.ExitCode -ne 0) { throw "installed agent Explorer shell-action mode failed" }

            $uninstaller = (& ./scripts/ci/resolve-windows-uninstaller.ps1 -AppDir $app | Out-String).Trim()
            if ([string]::IsNullOrWhiteSpace($uninstaller)) { throw "uninstaller resolver returned an empty path" }
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
