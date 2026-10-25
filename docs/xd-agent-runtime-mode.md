# xd / xdrive-agent / Desktop runtime-mode contract (2026-10-25)

**Decision:** keep the existing two Go binaries (`xd`, `xdrive-agent`), with Desktop as an optional Electron UI. There is exactly one owning Agent process per OS user and one original scanner/UploadSession/SQL-CAS Runner. CLI-only distributions package the *same* Go binaries as Desktop, never a separate backup worker.

## Modes and IPC

- `full` (normal `xdrive-agent`): owns the normal mount/cache reconciliation, Push worker and update service. Desktop can connect through its same-user authenticated loopback IPC.
- `backup_only` (`xdrive-agent --backup-only`): runs owning-device heartbeat and Push manual/scheduled worker **without** FUSE/CfAPI mount reconciliation, Explorer registration or client updater. The Agent still answers authenticated status and owning Backup IPC.
- `GET /v1/hello` reports `runtime_mode` and conservative, mode-scoped `capabilities`; the backup-only mode never advertises `sync-control` or `client-update`. Authenticated Backup-only IPC accepts only the exact 37 route+method status/auth/owning-device backup allowlist (including the existing CLI bootstrap and original per-file Runner) and returns `409 agent_backup_only` for other routes, including unknown future full-only endpoints, **before** invoking their controllers. The unauthenticated request remains `401` (no mode leaks).
- Backup-only also rejects the legacy Desktop IPC `POST /v1/lifecycle/shutdown`: even a previously installed Desktop cannot stop active CLI backup Operations through a generic restart button. Explicit shutdown remains the responsibility of the owning user-level service manager.
- Desktop requires a verified `full` mode before accepting its normal Agent lifecycle. If an existing Agent is `backup_only`, Desktop **does not silently shut it down or start another Agent**. A missing/unknown mode from an older IPC service fails closed until compatible binaries are installed.
- `xd backup` may attach to either mode, as long as same-user loopback, PID/protocol/platform, private capabilities and current Owner/Device/Root checks pass. It never requests a second Agent when an existing valid one is found.

This small fix deliberately does **not** add live mode promotion. Explicit later conversion must first prove that no original durable Source Operation would be interrupted; no kill/restart should be inferred from a timeout. Live mounted state remains Agent-only; a separate follow-up should migrate the legacy direct `xd mount` process to Agent IPC without inventing another writer or breaking FUSE/CfAPI.

## Required regression coverage

- Mode `full` advertises its existing capability list unchanged; mode `backup_only` preserves original Backup CLI and status capabilities, but not mount/updater capabilities.
- Authorized full-only and unknown future IPC routes are rejected in `backup_only`, while existing CLI bootstrap, per-file status, scheduling and receipt/recovery-read paths remain accessible; invalid token is rejected before mode disclosure.
- Desktop `ensureRunning` and explicit `restart` do not spawn, stop or overwrite a live Backup-only Agent; missing runtime mode is also not treated as full.
- Linux/Windows Go tests, Desktop Main contract tests and exact HEAD Final Gate; inaccessible production installation/safety acceptance remains **按用户决定跳过（未验收）**.

## Agent-owned `xd mount` (dependent follow-up)

- On a matched new client pair, `xd mount [ABS_OR_RELATIVE_PATH]` connects through exactly the same protected discovery, PID/protocol and same-OS-user loopback bearer path as `xd backup`. It requires verified `runtime_mode=full`, `settings` and `sync-control` capabilities. When absent, xd starts the same installed Agent **without** `--backup-only`; single-instance ownership remains in that Agent. It never replaces a live Backup-only Agent or falls back to a direct FUSE/CfAPI runner.
- With a local PATH, CLI converts to a canonical absolute path and uses the **existing** authenticated `PATCH /v1/settings` with exactly `mount_path`; Agent persists settings and wakes its existing reconciliation loop, which already handles start/stop/cache and mount paths. Without PATH, xd uses `GET /v1/settings`. The response path must be explicit and match any requested PATH; unknown, stale or conflicting replies fail closed, without blind retry.
- `xd mount` now exits after the Agent **accepts the configuration**, not when FUSE/CfAPI has fully mounted. Ctrl-C or process exit must not terminate the shared Agent, active transfers or ongoing backups. Users should inspect Agent diagnostics/logs for a platform mount error.
- `xd cleanup` remains an explicit maintenance operation, but refuses while a live Agent can be reached; if discovery is malformed, unsafe, unreadable or still present after an endpoint timeout, refuse to unregister Windows CfAPI rather than guessing that the mount is inactive.
- The separate `xd backup agent` user-level service and Desktop both use the same original Agent binary; no new Agent daemon, local state format, CAS writer, backup worker or remote device-write authority is introduced.

This follow-up must be merged **after** the runtime-mode PR and its source-exact CI checks. Native Windows CfAPI and Linux FUSE test coverage must establish that CLI and Desktop never execute a second mount owner for one user; unavailable production-only safety acceptance remains **按用户决定跳过（未验收）**.
