# Same native Windows CLI-only release artifact contract for GitHub and GitLab.
# Never installs Desktop, selects a production Root or starts a privileged service.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Archive,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'
$archivePath = (Resolve-Path -LiteralPath $Archive -ErrorAction Stop).Path
$isolated = Join-Path ([System.IO.Path]::GetTempPath()) ("xdrive-backup-only-smoke-" + [guid]::NewGuid().ToString("N"))
$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
$originalUserProfile = $env:USERPROFILE
$agent = $null
try {
    New-Item -ItemType Directory -Force -Path $isolated | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $isolated -Force
    $root = Join-Path $isolated 'xdrive-backup'
    $xd = Join-Path $root 'xd.exe'
    $agentBin = Join-Path $root 'xdrive-agent.exe'
    $members = @(Get-ChildItem -LiteralPath $root -File | ForEach-Object { $_.Name } | Sort-Object)
    $expected = @('README.md', 'WINDOWS_TASK.md', 'install-backup-agent-task.ps1', 'xd.exe', 'xdrive-agent.exe')
    if (@(Compare-Object -ReferenceObject $expected -DifferenceObject $members).Count -ne 0) {
        throw "unexpected CLI-only archive members: $members"
    }
    # Inspect the shipped helper without registering a task in CI.
    $helper = Join-Path $root 'install-backup-agent-task.ps1'
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $helper, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($null -ne $parseErrors -and $parseErrors.Count -gt 0) {
        throw "Windows login helper parse errors: $parseErrors"
    }
    $taskSource = Get-Content -LiteralPath $helper -Raw
    foreach ($required in @('-LogonType Interactive', '-RunLevel Limited',
                            '--backup-only', '-MultipleInstances IgnoreNew',
                            'Test-OurBackupTask', "'Uninstall'")) {
        if (-not $taskSource.Contains($required)) {
            throw "Windows user-task helper missing contract: $required"
        }
    }
    foreach ($forbidden in @('-RunLevel Highest', '-LogonType Password',
                             '-LogonType ServiceAccount', 'New-Service')) {
        if ($taskSource.Contains($forbidden)) {
            throw "Windows user-task helper has forbidden privilege mode: $forbidden"
        }
    }
    $version = (& $xd version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -ne $ExpectedVersion) {
        throw "CLI archive version mismatch: actual=$version expected=$ExpectedVersion"
    }
    $helpText = (& $xd backup help | Out-String)
    if ($LASTEXITCODE -ne 0 -or -not $helpText.Contains('xd backup init') -or
        -not $helpText.Contains('xd backup agent')) {
        throw 'independent Backup-only command entrypoints are missing'
    }

    # A portable CLI-only archive must never install Desktop or replace its
    # Agent without a verified two-binary stop/restart/rollback transaction.
    $desktopUpdate = Start-Process -FilePath $xd -Wait -PassThru -NoNewWindow `
        -ArgumentList @('update', '--install', '--channel', 'master')
    if ($desktopUpdate.ExitCode -ne 1) {
        throw "standalone xd accepted Desktop update: exit=$($desktopUpdate.ExitCode)"
    }
    $cliUpdate = Start-Process -FilePath $xd -Wait -PassThru -NoNewWindow `
        -ArgumentList @('update', '--cli-only', '--install')
    if ($cliUpdate.ExitCode -ne 1) {
        throw "standalone xd accepted unfinished CLI-only install: exit=$($cliUpdate.ExitCode)"
    }

    # Invalid absolute-path and mixed runtime arguments must fail before
    # touching any real Server or registering any OS directory.
    $rejected = Start-Process -FilePath $xd -Wait -PassThru -NoNewWindow `
        -ArgumentList @('backup', 'init', '--name', 'Smoke', '--path', 'relative', '--target-id', '1')
    if ($rejected.ExitCode -ne 1) { throw "relative Root accepted: exit=$($rejected.ExitCode)" }
    $invalid = Start-Process -FilePath $agentBin -Wait -PassThru `
        -ArgumentList @('--backup-only', '--mount')
    if ($invalid.ExitCode -ne 2) { throw "Agent accepted mixed mount mode: exit=$($invalid.ExitCode)" }

    $env:APPDATA = Join-Path $isolated 'roaming'
    $env:LOCALAPPDATA = Join-Path $isolated 'local'
    $env:USERPROFILE = Join-Path $isolated 'home'
    New-Item -ItemType Directory -Force -Path $env:APPDATA, $env:LOCALAPPDATA, $env:USERPROFILE | Out-Null
    $agent = Start-Process -FilePath $agentBin -ArgumentList @('--backup-only') `
        -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 3
    $agent.Refresh()
    if ($agent.HasExited) {
        throw "Windows no-mount Agent exited without Desktop: exit=$($agent.ExitCode)"
    }
    Write-Host 'Windows standalone Backup-only ZIP starts xd and owning Agent without Electron or a mount.'
}
finally {
    if ($null -ne $agent) {
        try {
            $agent.Refresh()
            if (-not $agent.HasExited) {
                Stop-Process -Id $agent.Id -Force -ErrorAction Stop
                $null = $agent.WaitForExit(5000)
            }
        }
        catch {
            Write-Warning "Failed stopping isolated smoke Agent PID $($agent.Id): $($_.Exception.Message)"
        }
    }
    $env:APPDATA = $originalAppData
    $env:LOCALAPPDATA = $originalLocalAppData
    $env:USERPROFILE = $originalUserProfile
    Remove-Item -LiteralPath $isolated -Recurse -Force -ErrorAction SilentlyContinue
}
