#requires -Version 5.1
# Optional current-user login task for the original xdrive-agent. No new worker.
[CmdletBinding()]
param(
    [ValidateSet('Install', 'Status', 'Uninstall')]
    [string]$Action = 'Status'
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows only.' }
Import-Module ScheduledTasks -ErrorAction Stop

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.IsSystem) { throw 'Run as the owning xDrive user, never SYSTEM.' }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$agent = [System.IO.Path]::GetFullPath((Join-Path $root 'xdrive-agent.exe'))
$cli = [System.IO.Path]::GetFullPath((Join-Path $root 'xd.exe'))
$taskName = 'xDrive Backup-only Agent'
$taskPath = '\'

# Never overwrite or remove an arbitrary preexisting task with this name.
function Test-OurBackupTask($task) {
    if ($null -eq $task) { return $false }
    $actions = @($task.Actions)
    $triggers = @($task.Triggers)
    if ($actions.Count -ne 1 -or $triggers.Count -ne 1) { return $false }
    $a = $actions[0]
    $t = $triggers[0]
    $validUser = @($identity.Name, $identity.User.Value) -contains $task.Principal.UserId
    $validTriggerUser = @($identity.Name, $identity.User.Value) -contains $t.UserId
    $actualExe = [string]$a.Execute
    $actualDir = [string]$a.WorkingDirectory
    return (
        $validUser -and $validTriggerUser -and
        $task.Principal.LogonType -eq 'Interactive' -and
        $task.Principal.RunLevel -eq 'Limited' -and
        $t.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' -and
        [string]::Equals($actualExe.Trim('"'), $agent, [System.StringComparison]::OrdinalIgnoreCase) -and
        [string]::Equals($actualDir, $root, [System.StringComparison]::OrdinalIgnoreCase) -and
        ([string]$a.Arguments).Trim() -eq '--backup-only'
    )
}

$existing = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
if ($null -ne $existing -and -not (Test-OurBackupTask $existing)) {
    throw "Task '$taskName' exists but is not this exact current-user Backup-only task. No changes made."
}

switch ($Action) {
    'Status' {
        if ($null -eq $existing) {
            Write-Output "Not installed: $taskName"
        } else {
            Write-Output "Installed for $($identity.Name): $taskName"
            Get-ScheduledTaskInfo -InputObject $existing |
                Select-Object LastRunTime, LastTaskResult, NextRunTime
        }
    }
    'Install' {
        if (-not (Test-Path -LiteralPath $agent -PathType Leaf) -or
            -not (Test-Path -LiteralPath $cli -PathType Leaf)) {
            throw 'Place this script next to matching original xd.exe and xdrive-agent.exe.'
        }
        if ($null -ne $existing) {
            Write-Output 'Already installed; task unchanged.'
            break
        }
        $taskAction = New-ScheduledTaskAction -Execute $agent -Argument '--backup-only' -WorkingDirectory $root
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
        $principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -ErrorAction Stop | Out-Null
        Write-Output "Installed current-user login task: $taskName"
        Write-Output 'It starts at the next sign-in. No SYSTEM service, stored password or elevation.'
    }
    'Uninstall' {
        if ($null -eq $existing) {
            Write-Output 'Task not installed; no changes made.'
            break
        }
        Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false -ErrorAction Stop
        Write-Output 'Login task removed. A running Agent is NOT stopped or cancelled.'
    }
}
