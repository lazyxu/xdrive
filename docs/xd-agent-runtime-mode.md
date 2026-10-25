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
