$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('xdrive-artifact-preconditions-' + [guid]::NewGuid().ToString('N'))
$originalLocalAppData = $env:LOCALAPPDATA
$ownedMutex = $null
$probe = $null

try {
    New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
    $env:LOCALAPPDATA = Join-Path $testRoot 'Local App Data'
    New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA | Out-Null
    $installer = Join-Path $testRoot 'setup.exe'
    Set-Content -LiteralPath $installer -Value 'installer boundary fixture'

    # Exercise the real baseline invocation, replacing only OS process boundaries.
    # Never run an installer or stop a user's xDrive processes in this regression.
    $captured = & {
        $boundary = @{ Arguments = @() }
        function Get-Process { param($Name, $ErrorAction) return @() }
        function Start-Process {
            param($FilePath, $ArgumentList, [switch]$PassThru, $WindowStyle)
            $boundary.Arguments = @($ArgumentList)
            throw 'fixture: baseline installer boundary reached'
        }
        try {
            & (Join-Path $Root 'scripts\test-windows-client-upgrade.ps1') `
                -Installer $installer -TargetVersion 'fixture-version' -Scenario rollback
            throw 'baseline installer boundary was not reached'
        } catch {
            if ($_.Exception.Message -ne 'fixture: baseline installer boundary reached') { throw }
        }
        return $boundary.Arguments
    }
    $expectedDir = '/DIR="' + (Join-Path $env:LOCALAPPDATA 'Programs\xDrive') + '"'
    if ($captured -notcontains $expectedDir) {
        throw 'baseline installer must receive the explicit, quoted app directory used by its assertions'
    }
    $expectedLog = '/LOG="' + (Join-Path $env:LOCALAPPDATA 'xdrive\updates\transaction\baseline-install.log') + '"'
    if ($captured -notcontains $expectedLog) {
        throw 'baseline installer must preserve its setup log beside the transaction diagnostics'
    }

    $guard = Join-Path $PSScriptRoot 'assert-windows-artifact-session.ps1'
    & $guard
    $created = $false
    $ownedMutex = New-Object System.Threading.Mutex($false, 'Local\xDriveAgent', [ref]$created)
    if (-not $created) { throw 'refusing to borrow an existing Agent mutex in the regression' }
    $rejected = $false
    try { & $guard } catch { $rejected = $_.Exception.Message -like '*Local\xDriveAgent*' }
    if (-not $rejected) { throw 'artifact guard must reject a live same-session Agent singleton' }

    # A portable archive cannot isolate the Agent mutex by changing APPDATA.
    # Fail before extracting or running any archive member, with a useful cause.
    $archive = Join-Path $testRoot 'not-extracted.zip'
    Set-Content -LiteralPath $archive -Value 'must not be opened while the session is occupied'
    $rejected = $false
    try {
        & (Join-Path $PSScriptRoot 'test-backup-cli-windows.ps1') -Archive $archive -ExpectedVersion fixture
    } catch { $rejected = $_.Exception.Message -like '*Local\xDriveAgent*' }
    if (-not $rejected) { throw 'backup artifact smoke must reject a shared Agent session before extracting its archive' }

    $ownedMutex.Dispose()
    $ownedMutex = $null
    & $guard

    # Detect a Desktop even if it has no Agent mutex, and leave it untouched.
    $probeExe = Join-Path $testRoot 'xdrive-desktop.exe'
    Copy-Item -LiteralPath (Join-Path $env:WINDIR 'System32\ping.exe') -Destination $probeExe
    $probe = Start-Process -FilePath $probeExe -ArgumentList @('-n', '60', '127.0.0.1') -WindowStyle Hidden -PassThru
    $rejected = $false
    try { & $guard } catch { $rejected = $_.Exception.Message -like ('*xdrive-desktop pid=' + $probe.Id + '*') }
    if (-not $rejected) { throw 'artifact guard must identify a same-session Desktop process' }
    $probe.Refresh()
    if ($probe.HasExited) { throw 'artifact guard must leave existing processes untouched' }
    Stop-Process -Id $probe.Id -Force
    if (-not $probe.WaitForExit(5000)) { throw 'owned Desktop probe did not exit' }
    $probe.Dispose()
    $probe = $null
    & $guard
    Write-Host 'Windows artifact preconditions test passed (explicit directory, setup log and session singleton).'
} finally {
    if ($null -ne $probe) {
        try {
            $probe.Refresh()
            if (-not $probe.HasExited) {
                Stop-Process -Id $probe.Id -Force
                $null = $probe.WaitForExit(5000)
            }
        } finally { $probe.Dispose() }
    }
    if ($null -ne $ownedMutex) { $ownedMutex.Dispose() }
    $env:LOCALAPPDATA = $originalLocalAppData
    $full = [System.IO.Path]::GetFullPath($testRoot)
    $parent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $full.StartsWith($parent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "refusing to clean a regression directory outside its temporary parent: $full"
    }
    if (Test-Path -LiteralPath $full) {
        if ((Get-Item -LiteralPath $full).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw "refusing to clean a reparse point: $full"
        }
        Remove-Item -LiteralPath $full -Recurse -Force
    }
}
