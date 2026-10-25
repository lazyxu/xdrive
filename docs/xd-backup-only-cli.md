# xd Backup-only CLI (same owning Agent as Desktop)

> **Architecture decision (2026-10-25):** [CLI-only Backup architecture](./xd-headless-backup-architecture.md) — B internally (`xd` + same-user `xdrive-agent`), C-like unified `xd backup` experience. Desktop is optional for the target headless deployment. **Current status:** standalone `xd backup init` and no-mount Agent packaging merged via [#2585](https://github.com/lazyxu/xdrive/pull/2585); the two CLI-only Snapshot archives are published. This documents merged source, not production installation acceptance. CLI-only update checks/downloads are available; in-place installation and rollback are deliberately not supported.

**Architecture:** The `xd` CLI controls the **same owning Agent** as Desktop; it does not implement another scanner, durable queue, uploader or cloud CAS writer. Linux/Windows Desktop UI is optional. In the headless distribution, `xd` auto-starts `xdrive-agent --backup-only`, without mounting a filesystem or requiring Electron.

## Headless / Desktop-free setup (merged PR #2585)

Install the CLI-only Linux tarball or Windows ZIP containing both `xd` and `xdrive-agent`. Run both as the **same OS user** who owns the local files and their protected credential store. The remote xDrive Server must already be reachable and the account must exist.

~~~sh
# Example for a Unix shell: do not place the password in shell arguments.
read -rsp 'xDrive password: ' XD_PASSWORD; echo
export XD_PASSWORD
xd login --server https://drive.example.com --username USER
unset XD_PASSWORD

# Read-only existing xDrive folder IDs, including the root and nested folders.
xd backup targets
xd backup targets --parent 123

# Single Agent-driven setup: read-only native preflight, device enrollment,
# paused Source creation, native Root binding, optional schedule.
xd backup init --name Photos --path /data/photos --target-id 123 --every 6h --run-now

# The explicit --run-now uses the same Agent runner and arms the schedule
# after a verified first file-level run. Use 'once' separately if you omit it.
# xd backup once --source 42
xd backup status --source 42
xd backup history --source 42

# If a network failure created an unbound paused Source:
xd backup drafts
xd backup bind --source 42 --path /data/photos
~~~

`--target-id` is an **existing cloud directory Node ID**, not a local path.
`--path` is a canonical absolute directory on the current machine and is
validated by the owning Agent. No remote Web request can authorize the Root,
and no CLI argument can select a foreign Device. An ambiguous Source creation
is not blindly repeated: inspect the list of same-device paused drafts first.
A failed Root bind leaves its Source paused for an explicit `bind` command.

By default, `init` **does not silently start** an upload. Pass explicit
`--run-now` to start one run using the existing owning Agent immediately after
Source creation, Root binding and optional schedule save are confirmed.
Without this flag, run `xd backup once --source ID` separately; after saving
or changing a schedule, a verified run arms automatic incremental admissions.
If the first run fails, the Source and original durable outcome are preserved
for `status` / `history`; no replacement Operation is created.

For backups with weak Linux inode identity, use the same fail-closed file/Root
preconditions as the Desktop Backup-only Runner;
strong identity is only additionally mandatory for dangerous deletion modes,
which the CLI deliberately does not support.

### Independently installing the background Agent

Linux standalone portable archive includes `xdrive-backup-agent.service`,
which assumes you copy `xd` and `xdrive-agent` to `~/.local/bin` and
the service unit to `~/.config/systemd/user`. Run
`systemctl --user daemon-reload` then
`systemctl --user enable --now xdrive-backup-agent`. If you need unattended
backups **after logout**, configure your user's login manager/systemd linger
explicitly; do not run xDrive as root just to keep it alive.

For Windows, place `xd.exe` and `xdrive-agent.exe` together in a user
directory and configure a **current-user, login-triggered** scheduled task
running `xdrive-agent.exe --backup-only`. Do not run it as SYSTEM or
silently elevate privileges. Both platforms can instead use
`xd backup agent` to foreground the matching Agent under any suitable
user-level service manager. Existing Desktop Agent detection prevents a
second concurrent writer.

CLI-only packages are separate from the existing Desktop installers. GitHub
and GitLab CI package the exact same original client-core binaries and verify
the byte-identical Linux/Windows archives. A shared PowerShell smoke test
executes the Windows ZIP on native Windows runners without Electron. GitLab's
checksum-verified release also publishes these two archives as named assets;
a missing or mismatched archive blocks publication. Linux smoke tests cover
no-mount Agent SIGTERM, restart and cooperative foreground-wrapper shutdown.
These checks do not substitute for authenticated PostgreSQL/CAS end-to-end
backup and incremental/scheduler regression tests. The unified Desktop installer
and CLI-only archives are separate distribution targets. On a CLI-only install,
`xd update --cli-only` checks the published Linux/Windows two-binary package,
and `--download` verifies its release SHA-256, Go binary identity and strict
archive allowlist before saving it to a user cache:

```sh
xd update --cli-only --source github --channel master
xd update --cli-only --download --source github --channel master
```

**Downloaded does not mean installed.** CLI-only `xd update --install`
is deliberately rejected until a safe atomic pair replacement, Agent restart
and rollback protocol is implemented. It never falls back to Electron/Desktop.
To apply an archive meanwhile, coordinate a same-user service stop and replace
both matching binaries together. Preserve the local operation journal and
Source/Root identity; never infer that uncertain Operations were resolved.

### Using an already configured Source

Supported: Linux and Windows on the device whose existing local-folder
**Backup** Source and approved native Root are registered.

## Commands

~~~sh
# Find Sources that pass this Agent's private owning-device schedule check.
xd backup list

# One explicit, incremental scan/upload of an existing Source, and wait for its
# per-file result. Ctrl-C detaches observation only: the Agent owns the work.
xd backup once --source 42

# Persist Agent-only scheduled incrementals (default six hours).
# The explicit --run-now performs the first verified run on the new Source
# revision; otherwise invoke 'xd backup once --source 42' separately.
xd backup auto --source 42 --every 6h --run-now
# Without --run-now, use: xd backup once --source 42

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
The Agent is auto-started in Backup-only mode in the background when needed; `XD_AGENT_PATH` can
explicitly point at the installed `xdrive-agent` binary. The local Agent must
remain running for scheduled backups; configure a user-level login/boot service
for unattended operation after reboot, or use the Desktop's existing start-at-login
setting. **The CLI does not install a privileged service.** For a service manager,
`xd backup agent` keeps the existing Agent in the foreground; if an Agent is
already running, it reports this rather than creating a second writer.
On Linux, both direct `xdrive-agent --backup-only` and the foreground
`xd backup agent` wrapper handle service-manager SIGTERM through the
Agent's cooperative cancellation path rather than an immediate forced kill.
The wrapper has a bounded 5-second termination grace period. 

## Boundary and results

- Except for the explicit, local-user `init`/`bind` bootstrap, all run,
  control and scheduling operations require an **already bound** Backup-only
  paused Local Push Source ID for this exact device/Root. Bootstrap delegates
  registration and native authorization to the original Agent methods; it
  cannot grant a Root from a remote device or browse private OS files remotely.
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
  A CLI exit status of zero for `once` or an explicit `--run-now` means only an examined per-file run
  with no unsupported/uncertain file counts. **It is not**
  `backup_complete`, `retirement_safe`, or `current_cas_verified`.
  Otherwise the explicit run exits nonzero, and `status/history` show the reason.
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
