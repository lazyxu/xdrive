# xd Backup-only CLI (same owning Agent as Desktop)

Supported: Linux and Windows on the device whose existing local-folder **Backup** Source and approved native Root are registered. This is a CLI surface over the **same Agent**, not a separate uploader, scanner, durable task queue or cloud writer.

## Commands

~~~sh
# Find Sources that pass this Agent's private owning-device schedule check.
xd backup list

# One explicit, incremental scan/upload of an existing Source, and wait for its
# per-file result. Ctrl-C detaches observation only: the Agent owns the work.
xd backup once --source 42

# Persist Agent-only scheduled incrementals (default six hours).
# IMPORTANT: run once AFTER setting/changing the schedule. This modifies the
# Source revision, and automatic admission requires a fresh verified checkpoint.
xd backup auto --source 42 --every 6h
xd backup once --source 42

# Alternatives (choose one): five-field cron with IANA timezone, 1h/24h,
# or explicit manual-only policy.
xd backup auto --source 42 --cron '0 2 * * *' --timezone Asia/Tokyo
xd backup auto --source 42 --every 24h
xd backup schedule --source 42 --manual

xd backup status --source 42
xd backup history --source 42
xd backup pause --source 42
xd backup cancel --source 42

# Optional: foreground Agent process under a user service manager.
xd backup agent
~~~

`xd backup auto --source 42` uses the Desktop's existing six-hour default.
The Agent is auto-started in the background when needed; `XD_AGENT_PATH` can
explicitly point at the installed `xdrive-agent` binary. The local Agent must
remain running for scheduled backups; configure a user-level login/boot service
for unattended operation after reboot, or use the Desktop's existing start-at-login
setting. **The CLI does not install a privileged service.** For a service manager,
`xd backup agent` keeps the existing Agent in the foreground; if an Agent is
already running, it reports this rather than creating a second writer.

## Boundary and results

- The Source must already be configured for **Backup-only**, paused Local Push
  and bound to this same approved device/Root (normally established by Desktop
  provisioning). The CLI accepts only an existing positive numeric Source ID.
  It never grants a new Root, requests a path to upload, creates a foreign
  device Source, or silently enrolls a device.
- The shared private loopback client reads `desktop-ipc.json` from the current
  account's protected xDrive config directory, validates permissions, localhost
  host/port, bearer format, live Agent PID/protocol/platform/capabilities.
  Failed identity/protocol checks are terminal; only an unavailable Agent can
  trigger startup. No IPC token or local Root path is printed.
- One-shot work uses the Agent's `CloudStartLocalBoundBackupCommonBatch` and
  `CloudLocalBoundBackupCommonBatchStatus`. Automatic scheduling uses
  `CloudSetLocalBoundBackupSchedule` and the already-existing Agent watcher
  + interval/cron scheduler; both reuse the exact same persistent per-file
  original SQL Operation and ordinary `UploadSession/chunks/Finalize`.
- Files with symlinks/unsafe kinds are not traversed and appear as unsupported.
  A CLI exit status of zero for `once` means only an examined per-file run
  with no unsupported/uncertain file counts. **It is not**
  `backup_complete`, `retirement_safe`, or `current_cas_verified`.
  Otherwise `once` exits nonzero, and `status/history` show the reason.
- Cancel/pause are **next-file-boundary scheduling controls only**; no
  assertion of physical remote cancellation. A signed original receipt is
  required for per-file COMMIT. Unexpected/uncertain outcomes are not silently
  retried with new Operations. Automatic runs do not arm after an uncertain,
  cancelled or paused checkpoint.
- A stopped Agent or sleeping/offline device cannot execute a scheduled run
  on time; when running again, the existing guarded scheduler reconciles
  eligible Sources. Legacy Stage migration, Mirror, NAS, remote Desktop writes,
  current CAS physical proof and automatic uncertain-operation recovery are
  not part of Backup-only.
- Production-only acceptance that cannot be observed is **按用户决定跳过（未验收）**,
  without weakening code-level Owner/Device/Root, native, IPC and SQL/CAS checks.
