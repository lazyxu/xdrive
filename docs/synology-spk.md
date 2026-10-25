# Synology DSM 7 Backup-only SPK (armada38x / DS218j)

## Scope and code reuse

Use the original `cmd/xd`, `cmd/xdrive-agent`, `internal/localpush*`, Client,
local authenticated Backup IPC, and the existing Server CAS/SQL writer. The
package only adds DSM 7 package metadata, lifecycle, a dedicated package user,
and ARMv7 cross compilation. There is **no** Electron, Docker, secondary
Runner, NAS-local Server/PostgreSQL, FUSE mount, or remote Device control.

The DS218j has a 32-bit ARMv7 `armada38x` CPU and 512 MiB RAM. The present
package only targets `armada38x` and DSM 7.0 build 40759 or newer,
which is required for its persistent package `home` directory. The DSM 7 INFO metadata uses `ctl_stop=yes` (not the deprecated `startable` field),
and `conf/privilege` retains the package-user-only execution model.
The package is a **candidate**
until real arm32 cross-compilation, Package Center installation, permission
assignment, native file backup and crash/restart regressions pass. Inaccessible
production-only acceptance is **按用户决定跳过（未验收）**; controllable code-level
security checks remain required.

## Build and inspect

```sh
# Linux Go 1.25+ (and Python 3 for inspecting package contents).
bash scripts/build-synology-spk.sh 0.1.0-1 release/synology
python3 scripts/ci/test-synology-spk.py \
  release/synology/xdrivenas-armada38x-0.1.0-1.spk \
  release/synology/core 0.1.0-1
bash scripts/ci/test-synology-lifecycle.sh
# Optional ARM32 userspace execution test (Linux runner with qemu-user installed).
bash scripts/ci/test-synology-armv7-qemu.sh release/synology/core 0.1.0-1
```

Build uses `CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7` on **the original Go
entry points**, with shared xDrive version ldflags when supplied. If CI has
already built the exact ARMv7 binaries, pass their directory as a third argument
and the packager will copy them **byte for byte** without recompilation.
Generated SPK icons derive from the existing PWA PNG. The outer `.spk` is tar;
`package.tgz` contains only `bin/xd` and `bin/xdrive-agent`.

Release snapshots and stable SPKs require separately wiring these artefacts into
the publish/verification gates. Do not label the candidate generally released
until the build is present in those gates. Do not publish the test fixture
binaries or claim physical DS218j results from an x86 runner.

## DSM installation and runtime

Open DSM **Package Center → Manual Install** with the
`xdrivenas-armada38x-*.spk` from a trusted build. DSM manages the `xdrivenas`
package user and group via `conf/privilege` (`run-as=package`). Use **Control
Panel → Shared Folder → Edit → Permissions → System internal user** to grant
read-only access only to the shares you plan to back up; absence of access must
fail closed and display the Agent's error. Do not run the Agent as root and do
not elevate its package account to bypass ACLs.

DSM Package Center controls `start/stop/status` through `scripts/start-stop-status`.
The service runs the **same** `xdrive-agent --backup-only` and respects a
single-instance lock. It runs with:

```text
HOME=/var/packages/xdrivenas/home
XDG_CONFIG_HOME=$HOME/.config
XDG_CACHE_HOME=/var/packages/xdrivenas/var/cache
XD_DISABLE_SECRET_SERVICE=1
GOMAXPROCS=1
GOMEMLIMIT=128MiB
```

The exact DSM FHS targets may be symlinks into `/volume*/@apphome` and
`/volume*/@appdata`. The script accepts those DSM-owned symlinks, creates
private subdirectories with restrictive permissions and keeps PID/logs under
`var/run` and `var/log`. It never writes sessions or journals inside `target`.
An SPK upgrade replaces `target` but preserves DSM's `home`/`var` directories.
Never treat an unknown per-file Operation as canceled on restart, and never
signal a PID if its live executable/arguments do not match the owned Agent.

The initial headless setup runs the same `xd` under the **DSM package
user**. Desktop is not required. From a local administrator SSH shell using
Bash, the following helper invokes `xd` as the restricted `xdrivenas` user,
with the same persistent HOME/XDG paths as the background service:

```bash
xd_nas() {
  sudo -u xdrivenas env \
    HOME=/var/packages/xdrivenas/home \
    XDG_CONFIG_HOME=/var/packages/xdrivenas/home/.config \
    XDG_CACHE_HOME=/var/packages/xdrivenas/var/cache \
    XD_DISABLE_SECRET_SERVICE=1 \
    /var/packages/xdrivenas/target/bin/xd "$@"
}
read -rsp 'xDrive password: ' xd_once_password; echo
printf '%s\n' "$xd_once_password" | xd_nas login \
  --server https://drive.example.com --username YOUR_XDRIVE_USER --password-stdin
unset xd_once_password
xd_nas backup targets
xd_nas backup init --name NAS-Photos --path /volume1/photo --target-id 123 --every 6h
# Use the actual Source ID returned by init:
xd_nas backup once --source 42
xd_nas backup status --source 42
```

Do not copy the example cloud target or Source ID verbatim. Before `init`,
grant the `xdrivenas` system-internal DSM user read access to that share.
`--password-stdin` reads one bounded line rather than accepting credentials
in argv or exporting them to the package process environment. The service
may need restarting after initial login so its in-memory session view refreshes.
Only a verified first manual run arms saved automatic schedules. Subsequent
`status`, `history`, `pause`, and `cancel` commands use the same helper.
See [standalone CLI contract](xd-backup-only-cli.md).

This is a transitional local provisioning path, **not** a remote DSM/Web
administration shell. Do not run `xd` as root or the administrator's normal
OS user. The future DSM shared-MUI page must retain authenticated local
Root authorization and must not expose the private Agent IPC listener.

## Boundaries / follow-up

- P0: run the original ARMv7 CLI and Agent under QEMU Cortex-A9 and prove
  signed int64 sparse file seek/read/write above 4 GiB; this validates userspace
  offset handling but not a full large-file backup or physical DS218j result.
- P0: ensure actual `GOARCH=arm GOARM=7` build and no 32-bit offset/integer
  overflow when hashing/transmitting files above 4 GiB. Measure memory and
  throughput on representative workloads before tuning concurrency.
- P0: source-exact `xd` login/init, native ACL, mount/symlink replacement,
  genuine Server SQL/CAS file upload, unchanged incremental run and Agent
  restart/replay tests. The CI here covers SPK structure and lifecycle only.
- P0: test DSM package manager install/upgrade/uninstall before marking ready.
  Uninstall must not silently delete retained backups or cloud data.
- P1: expose the existing shared `@xdrive/ui/mui` Backup page in DSM through
  a **DSM-authenticated, CSRF-protected, owner-scoped local adapter**, not the
  unauthenticated private Agent IPC port. Do not bundle Electron.
- P2: add other Synology CPU architectures and optionally integrate the
  existing `xdrive-source-agent` Photos metadata path, without duplicate
  backup uploads or Source/Runners.
