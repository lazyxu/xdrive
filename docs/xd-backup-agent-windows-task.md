# Windows Backup-only Agent: optional login startup

The standalone Windows ZIP contains the original `xd.exe` and `xdrive-agent.exe`.
The optional helper installs a **current-user login trigger** under Windows Task Scheduler.
It does not install a SYSTEM service, elevate privileges, save a password or create a second backup worker.

Run these commands in PowerShell from the verified extracted archive folder:

```powershell
.\install-backup-agent-task.ps1 -Action Status
.\install-backup-agent-task.ps1 -Action Install
.\install-backup-agent-task.ps1 -Action Status
```

After the next **sign-in**, the task starts `xdrive-agent.exe --backup-only` using
that user's existing xDrive local credentials and the original durable SQL/CAS Runner.
Keep `xd.exe`, `xdrive-agent.exe` and this helper together at the same path.
The helper refuses to replace an unrelated task. If you move the binaries,
remove the old task manually in Task Scheduler before installing a new one.

To stop future login launches, without stopping or cancelling a running backup:

```powershell
.\install-backup-agent-task.ps1 -Action Uninstall
```

This is a login-only task, **not** a privileged boot-time service. It cannot
run when the owner is logged out and does not wake a sleeping computer.
The Agent must stay running for automatic interval/cron incrementals.
The existing single-instance lock prevents an additional Agent writer.

Use the helper only from a verified xDrive release directory with trusted
filesystem permissions. Follow the OS's usual PowerShell script-trust
policies; do not disable security globally. A running full Desktop Agent
must not be forcibly replaced by Backup-only mode, or vice versa.
