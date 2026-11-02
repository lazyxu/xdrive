$ErrorActionPreference = 'Stop'

# Installer transactions and the portable Backup-only Agent share the Windows
# session singleton, even when their APPDATA/LOCALAPPDATA directories differ.
# CI must serialize them; a local invocation must never stop a user's instance.
$sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
$existing = @(Get-Process -Name 'xdrive-agent', 'xdrive-desktop' -ErrorAction SilentlyContinue |
    Where-Object { $_.SessionId -eq $sessionId })
if ($existing.Count -gt 0) {
    $identities = @($existing | ForEach-Object { '{0} pid={1}' -f $_.ProcessName, $_.Id })
    throw "Windows artifact test requires an idle session $sessionId; existing xDrive processes: $($identities -join ', '). Serialize Windows artifact jobs with the same resource_group; no existing process was stopped."
}

$instance = $null
try {
    $instance = [System.Threading.Mutex]::OpenExisting('Local\xDriveAgent')
} catch [System.Threading.WaitHandleCannotBeOpenedException] {
    # No Agent has registered the singleton in this session.
} catch {
    throw "Cannot verify Windows artifact session singleton Local\xDriveAgent: $($_.Exception.Message)"
}
if ($null -ne $instance) {
    $instance.Dispose()
    throw "Windows artifact test requires an idle session $sessionId; Local\xDriveAgent already exists. APPDATA isolation does not isolate this singleton. Serialize Windows artifact jobs with the same resource_group; no existing process was stopped."
}
