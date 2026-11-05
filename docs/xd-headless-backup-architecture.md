# Headless Backup CLI architecture decision (2026-10-25)

## Decision: B internally, C-like experience externally

**Accepted direction:** keep the existing `xd` command-line client and
`xdrive-agent` as two executables/processes for now (the Docker Engine
CLI + daemon pattern). Deliver them together as a **CLI-only installation**,
without Electron, a browser, FUSE/CfAPI mounts, or any GUI prerequisite.
The user should only need to learn one entry point: `xd backup ...`.

**Long-term UX target:** a Syncthing/Kopia-like command surface:
`xd backup init`, `once`, `auto`, `status`, `history`,
`pause`, `cancel`, and `agent` (foreground daemon for a service manager).
One binary is **not** a current release requirement; extracting the existing
Agent into the CLI process is optional and must not fork another Runner.

`xdrive-agent` exclusively owns the device credential, native Root grant,
verified scanner, original per-file durable Operation, upload/SQL/CAS receipt
replay, Source lease, and automatic scheduler. `xd` only parses local-user
instructions and talks to its **same-user, authenticated loopback IPC**.
Desktop is a **separate optional UI** over the same Agent capabilities.
Web/other Desktop clients stay read-only for foreign device backups.

## Standalone first-run contract (merged source and released CLI-only archives)

1. Install CLI-only `xd` and matching `xdrive-agent` under the same
   user. No desktop runtime or system-wide privileged service is required.
2. `xd login` authenticates without asking for or creating a mount.
3. `xd backup init --name NAME --path ABS_LOCAL_DIR`
   requires only the local Source name and an explicit local OS path. The
   owning Agent registers/reuses **its own** device and asks the Server to
   create the paused Source plus its exclusive managed target atomically. The
   Server returns the exact TargetNodeID/path; the Agent then locally
   verifies/binds the Root with the current device credential and returns the
   Source ID. The canonical `同步文件夹/Push` prefix is a separate
   Server-side provisioning change tracked in PR #3902. A first-run error
   must not silently adopt a foreign or legacy Source.
4. `xd backup once --source ID` uses the existing exact worker. Saving
   a new `interval` / `cron` schedule changes Source revision; one verified
   run on that revision is needed to arm scheduled admissions. The optional
   explicit `--run-now` on `init` / `auto` starts that same first run after
   the Agent confirms configuration, without introducing a second Runner.
5. The optional `xd backup agent` service process runs in **backup-only
   mode**: no automatic FUSE/CfAPI mount, Explorer shell hook, Desktop, or
   implicit access to a remote native path. The same persistent operations
   survive CLI exit, service restart, or IPC disconnect.
6. Package and verify CLI-only Linux/Windows artifacts independently from
   Desktop, with all required binaries, version identity and system service
   guidance. Source files are shared; never ship a separate CAS writer.

New Push creation does not accept a client-selected target ID or parent
directory. The Server is the sole authority for creating and binding the
managed cloud destination; `xd backup targets` is optional read-only browsing
and is not part of the creation flow.

## Invariants and failure rules

- Never send device tokens, root fingerprints, local file contents, original
  Operation IDs, or absolute native paths to Web/foreign Desktop. The owning
  Agent alone verifies actual native OS Root identities on every attempt.
- CLI explicit `--path` is a local-user authorization, not remote Server
  control. Validate absolute path, symlinks/reparse points, mount/config
  overlaps, device/root identity, current Owner session and Source revision.
- Reuse original `UploadSession/chunks/finalize`, SQL/CAS receipts, bounded
  inventory and Source/run locks. Do not create a second task broker.
- On initial setup failures, preserve only safe paused drafts; report the
  Source ID so the user can inspect/recover explicitly. Never overwrite or
  bind a Source created by another device.
- Uncertain old Operations fail closed; pause/cancel only stop admission at
  file boundaries. Never infer physical remote cancellation, current-CAS
  bytes, whole-Source `backup_complete`, or `retirement_safe`.
- `xd backup agent` and Desktop must never both own independent Runners for
  the same device/Source; use existing single-instance and Source lease.
- Credentials stay in existing OS-protected Agent storage. No `--token`,
  local path selection from a remote request, broad privileged system daemon,
  or implicit root/SYSTEM execution.

## Scope and verification

The Desktop Backup-only Runner and existing `xd backup once/auto/status`
commands are already merged. **Merged PR #2585 delivers standalone
bootstrap, no-mount runtime and CLI-only Linux/Windows archives**; the
CLI-only Snapshot assets have also been published. Production installation
acceptance remains separately marked as skipped (unverified).

Ship a small vertical slice and measure source-exact CI: fresh user/device
→ create/bind Root → file upload → unchanged incremental scan → scheduled
catch-up → service restart/replay. Include Linux/Windows build, invalid
path/device/Owner/Root and cross-device negatives, local IPC isolation, no
mount/shell-registration checks, package contents and rollback, and actual
PostgreSQL/SQL/CAS tests. Do not require inaccessible production accounts,
credentials, HAR or operator attestation: **按用户决定跳过（未验收）**.

Do **not** expand this project to Mirror, NAS Push, automatic uncertain
Operation recovery, legacy Stage retirement, new CAS writers, or complete
100k/>4GiB performance certification.

## Unified Push Source contract (2026-11-05)

Desktop and `xd backup` are two control surfaces for the same owning Agent, Device identity, local_folder Source, Root grant, durable Operation journal and CAS writer. New `xd backup init` accepts only the local Source name and absolute local path; it no longer accepts `--target-id`. The owning Agent sends no cloud target selection, and the Server creates the managed Push destination atomically with the paused Source, returning the exact TargetNodeID and display path before local Root binding continues. The optional `xd backup targets` command remains read-only and is not part of creation. Existing Sources and target directories are unchanged; no migration is performed. See [the canonical architecture](./architecture/push-pull-source-management.md) and [platform audit](./architecture/push-pull-platform-audit.md).
