param(
    [Parameter(Mandatory = $true)]
    [string]$Server,
    [string]$InstallerPath = "",
    [string]$Username = "",
    [string]$Password = "",
    [int]$TimeoutSeconds = 60,
    [int]$TokenRefreshWaitSeconds = 0,
    [switch]$KeepArtifacts
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Server = $Server.TrimEnd("/")
$runId = [Guid]::NewGuid().ToString("N").Substring(0, 10)
$root = Join-Path $env:TEMP "xdrive-e2e-$runId"
$work = Join-Path $env:TEMP "xdrive-e2e-work-$runId"
$installedByScript = $false
$mountProcess = $null

function Fail([string]$Message) {
    throw "xDrive Windows E2E: $Message"
}

function Wait-Until([scriptblock]$Condition, [string]$Label, [int]$Seconds = $TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 250
    }
    Fail "timed out waiting for $Label"
}

function Curl-Json([string[]]$Arguments) {
    $out = & curl.exe -sS --fail-with-body @Arguments
    if ($LASTEXITCODE -ne 0) {
        Fail ("curl failed ({0}): {1} {2}" -f $LASTEXITCODE, ($Arguments -join " "), ($out -join [Environment]::NewLine))
    }
    if (-not $out) { return $null }
    return ($out -join [Environment]::NewLine) | ConvertFrom-Json
}

function Api-Login {
    $body = @{ username = $script:Username; password = $script:Password } | ConvertTo-Json -Compress
    return Invoke-RestMethod -Method Post -Uri "$Server/api/v1/auth/login" -ContentType "application/json" -Body $body
}

function Api-Root {
    return Invoke-RestMethod -Method Get -Uri "$Server/api/v1/nodes/root" -Headers @{ Authorization = "Bearer $script:AccessToken" }
}

function Api-Children([UInt64]$ParentId) {
    $result = Invoke-RestMethod -Method Get -Uri "$Server/api/v1/nodes/$ParentId/children" -Headers @{ Authorization = "Bearer $script:AccessToken" }
    return @($result)
}

function Api-NodeByName([UInt64]$ParentId, [string]$Name) {
    return @(Api-Children $ParentId) | Where-Object { $_.name -eq $Name } | Select-Object -First 1
}

function Api-Upload([UInt64]$ParentId, [string]$Path, [string]$Name) {
    $args = @("-H", "Authorization: Bearer $script:AccessToken", "-F", "file=@$Path;filename=$Name", "$Server/api/v1/nodes/$ParentId/files")
    return Curl-Json $args
}

function Api-PutContent([UInt64]$NodeId, [UInt64]$Revision, [string]$Path) {
    $ifMatch = 'If-Match: "' + $Revision + '"'
    $args = @(
        "-X", "PUT",
        "-H", "Authorization: Bearer $script:AccessToken",
        "-H", $ifMatch,
        "-H", "Content-Type: application/octet-stream",
        "--data-binary", "@$Path",
        "$Server/api/v1/files/$NodeId/content"
    )
    return Curl-Json $args
}

function Api-Delete([UInt64]$NodeId, [UInt64]$Revision) {
    $ifMatch = 'If-Match: "' + $Revision + '"'
    $args = @(
        "-sS", "--fail-with-body",
        "-X", "DELETE",
        "-H", "Authorization: Bearer $script:AccessToken",
        "-H", $ifMatch,
        "$Server/api/v1/nodes/$NodeId"
    )
    & curl.exe @args | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "remote delete failed for node $NodeId" }
}

function Api-Content([UInt64]$NodeId) {
    $tmp = Join-Path $work "download-$NodeId-$([Guid]::NewGuid().ToString('N')).bin"
    & curl.exe -sS --fail-with-body -H "Authorization: Bearer $script:AccessToken" -o $tmp "$Server/api/v1/files/$NodeId/content"
    if ($LASTEXITCODE -ne 0) { Fail "remote download failed for node $NodeId" }
    try { return [IO.File]::ReadAllText($tmp) } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

try {
    New-Item -ItemType Directory -Force $root, $work | Out-Null

    if ($InstallerPath) {
        $installer = (Resolve-Path $InstallerPath).Path
        Write-Host "Installing $installer"
        $p = Start-Process -FilePath $installer -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/NOSTARTAGENT") -Wait -PassThru
        if ($p.ExitCode -ne 0) { Fail "installer exit code $($p.ExitCode)" }
        $installedByScript = $true
    }

    $app = Join-Path $env:LOCALAPPDATA "Programs\xDrive"
    $xd = Join-Path $app "xd.exe"
    if (-not (Test-Path $xd)) {
        $candidate = Get-Command xd.exe -ErrorAction SilentlyContinue
        if ($candidate) { $xd = $candidate.Source }
    }
    if (-not (Test-Path $xd)) { Fail "xd.exe not installed; pass -InstallerPath or install xDrive first" }

    Get-Process xdrive-agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    if (-not $Username) {
        $Username = "e2e-$runId"
        if (-not $Password) { $Password = "Xdrive-E2E-$runId!" }
        Write-Host "Registering temporary account $Username"
        & $xd register --server $Server --username $Username --password $Password
        if ($LASTEXITCODE -ne 0) { Fail "xd register failed" }
    } else {
        if (-not $Password) { Fail "-Password is required when -Username is provided" }
        Write-Host "Logging in as $Username"
        & $xd login --server $Server --username $Username --password $Password
        if ($LASTEXITCODE -ne 0) { Fail "xd login failed" }
    }

    & $xd config --mount $root
    if ($LASTEXITCODE -ne 0) { Fail "xd config failed" }

    $auth = Api-Login
    $AccessToken = if ($auth.access_token) { $auth.access_token } else { $auth.token }
    if (-not $AccessToken) { Fail "server login returned no access token" }
    $rootNode = Api-Root

    Write-Host "Starting CfAPI provider at $root"
    $mountArgs = 'mount "{0}"' -f $root
    $mountProcess = Start-Process -FilePath $xd -ArgumentList $mountArgs -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 1
    if ($mountProcess.HasExited) { Fail "xd mount exited early with $($mountProcess.ExitCode)" }

    $seed = Join-Path $work "remote-seed.txt"
    [IO.File]::WriteAllText($seed, "remote-v1")
    $remoteNode = Api-Upload $rootNode.id $seed "remote.txt"
    $remotePath = Join-Path $root "remote.txt"
    Wait-Until { Test-Path $remotePath } "remote placeholder"
    $length = (Get-Item $remotePath).Length
    if ($length -ne 9) { Fail "placeholder length=$length expected 9" }
    if ([IO.File]::ReadAllText($remotePath) -ne "remote-v1") { Fail "hydrated content mismatch" }
    Write-Host "PASS remote placeholder + hydration"

    $localPath = Join-Path $root "local.txt"
    [IO.File]::WriteAllText($localPath, "local-v1")
    Wait-Until {
        $n = Api-NodeByName $rootNode.id "local.txt"
        if (-not $n) { return $false }
        return (Api-Content $n.id) -eq "local-v1"
    } "local upload"
    Write-Host "PASS local create -> server"

    [IO.File]::WriteAllText($remotePath, "local-v2")
    Wait-Until {
        $n = Api-NodeByName $rootNode.id "remote.txt"
        if (-not $n -or $n.revision -lt 2) { return $false }
        return (Api-Content $n.id) -eq "local-v2"
    } "local overwrite"
    Write-Host "PASS local modification -> server"

    $tickPath = Join-Path $root "tick.txt"
    [IO.File]::WriteAllText($tickPath, "tick")
    Wait-Until { $null -ne (Api-NodeByName $rootNode.id "tick.txt") } "reconcile tick"

    $remoteNode = Api-NodeByName $rootNode.id "remote.txt"
    [IO.File]::WriteAllText($remotePath, "local-conflict")
    $serverWin = Join-Path $work "server-wins.txt"
    [IO.File]::WriteAllText($serverWin, "server-wins")
    $remoteNode = Api-PutContent $remoteNode.id $remoteNode.revision $serverWin

    Wait-Until {
        $children = @(Api-Children $rootNode.id)
        $conflict = $children | Where-Object { $_.name -like "remote (conflict *" } | Select-Object -First 1
        if (-not $conflict) { return $false }
        return (Api-Content $conflict.id) -eq "local-conflict"
    } "conflict copy" 90

    $currentRemote = Api-NodeByName $rootNode.id "remote.txt"
    if ((Api-Content $currentRemote.id) -ne "server-wins") { Fail "server winner was overwritten" }
    Wait-Until { (Test-Path $remotePath) -and ([IO.File]::ReadAllText($remotePath) -eq "server-wins") } "restored server winner" 90
    $localConflict = Get-ChildItem $root -Filter "remote (conflict *.txt" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $localConflict) { Fail "local conflict copy was not created" }
    Write-Host "PASS stale-write conflict preserves both versions"

    $renamedPath = Join-Path $root "local-renamed.txt"
    Move-Item $localPath $renamedPath
    Wait-Until {
        $new = Api-NodeByName $rootNode.id "local-renamed.txt"
        $old = Api-NodeByName $rootNode.id "local.txt"
        return $null -ne $new -and $null -eq $old
    } "local rename"
    Write-Host "PASS local rename"

    Remove-Item $renamedPath -Force
    Wait-Until { $null -eq (Api-NodeByName $rootNode.id "local-renamed.txt") } "local delete"
    Write-Host "PASS local delete"

    $deleteSeed = Join-Path $work "delete-me.txt"
    [IO.File]::WriteAllText($deleteSeed, "delete-me")
    $deleteNode = Api-Upload $rootNode.id $deleteSeed "delete-me.txt"
    $deletePath = Join-Path $root "delete-me.txt"
    Wait-Until { Test-Path $deletePath } "remote-created local placeholder"
    Api-Delete $deleteNode.id $deleteNode.revision
    Wait-Until { -not (Test-Path $deletePath) } "remote delete propagation"
    Write-Host "PASS remote delete -> local"

    if ($TokenRefreshWaitSeconds -gt 0) {
        Write-Host "Waiting $TokenRefreshWaitSeconds seconds to validate client session refresh..."
        Start-Sleep -Seconds $TokenRefreshWaitSeconds
        & $xd status
        if ($LASTEXITCODE -ne 0) { Fail "xd status failed after token-refresh wait" }
        Write-Host "PASS token refresh wait"
    }

    Write-Host ""
    Write-Host "xDrive Windows E2E PASSED" -ForegroundColor Green
    Write-Host "Server: $Server"
    Write-Host "Sync root: $root"
}
finally {
    if ($mountProcess -and -not $mountProcess.HasExited) {
        Stop-Process -Id $mountProcess.Id -Force -ErrorAction SilentlyContinue
        try { $mountProcess.WaitForExit(5000) | Out-Null } catch {}
    }

    $app = Join-Path $env:LOCALAPPDATA "Programs\xDrive"
    $xdCleanup = Join-Path $app "xd.exe"
    if (Test-Path $xdCleanup) {
        & $xdCleanup cleanup 2>$null | Out-Null
    }

    if (-not $KeepArtifacts) {
        Remove-Item $root, $work -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "Keeping E2E artifacts: $root ; $work"
    }

    if ($installedByScript) {
        $uninstaller = Join-Path $app "unins000.exe"
        if (Test-Path $uninstaller) {
            Start-Process -FilePath $uninstaller -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-") -Wait | Out-Null
        }
    }
}
