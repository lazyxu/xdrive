param(
    [string]$StopNamesCsv = ""
)

$ErrorActionPreference = "Stop"

function Get-XDriveProcessesInSession {
    param(
        [Parameter(Mandatory = $true)][string[]]$Names,
        [int]$SessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    )

    foreach ($name in $Names) {
        foreach ($process in (Get-Process -Name $name -ErrorAction SilentlyContinue)) {
            try {
                if ([int]$process.SessionId -eq $SessionId) {
                    $process
                }
            } catch {
                # Ignore races with processes that exit while their session is inspected.
            }
        }
    }
}

function Stop-XDriveProcessesInSession {
    param(
        [Parameter(Mandatory = $true)][string[]]$Names,
        [int]$SessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    )

    Get-XDriveProcessesInSession -Names $Names -SessionId $SessionId |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

if ($StopNamesCsv.Trim()) {
    Stop-XDriveProcessesInSession -Names @($StopNamesCsv.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
