# 设备备份（Push）与远程拉取（Pull）独立应用 — 2026-10-10 决议

## Status and scope

**Design approved; implementation NOT complete.** This is the normative UI, ownership and acceptance contract for ordinary `local_folder` client Push, existing Server-managed Pull, and a **待支持** NAS Push placeholder. Existing `Source/SourceItem/SyncRun`, Node IDs, file revisions, CAS, PhotoAsset and Task Center data remain authoritative and must not be migrated solely for navigation. Treat the existing `synology_photos` NAS CLI Push and its history as legacy compatible data; do not develop NAS Push management in this round.

The `AGENTS.md` continuation report must distinguish code drafted, local tests, exact-head green PR CI and actually merged delivery, and must prioritize related branches/PRs before new work.

## 1. Navigation and routes

Two **independent first-level applications** replace the old mixed `同步文件夹` navigation item; no parent group and no Push/Pull tabs:

| App label | Proposed route ID | Primary use |
| --- | --- | --- |
| 设备备份 | `device-backup` | Devices > local folders > read-only progress/run histories, with own-device Desktop controls |
| 远程拉取 | `remote-pull` | Yike/Synology Photos/File Station Pull create/configure/run from Web and Desktop |

Continue to use the term **同步文件夹** for the underlying Source objects inside those apps. Preserve xDrive's full-screen App Frame and 52px global header, shared MUI primitives, accessibility and mobile viewport navigation. Do not fork Server business models or REST/Agent transport.

Legacy `#/app/sync-folders?source=ID`: resolve that Source server-side by stable ID and persisted `direction`; redirect Push to `device-backup` (if authorized to view) and Pull to `remote-pull`. No source ID: route to the remote-pull landing page. An unavailable/foreign ID yields a safe not-found/permission state, not a guessed mode or generated Source. Synology Photos supports **both** directions: classify by `(kind, direction)`, never by `kind` alone.

## 2. Exact ownership/capability matrix

| Action | Owning device Desktop | Other device Desktop (same account included) | Web/Mobile Web |
| --- | --- | --- | --- |
| View device name/platform, last trusted seen/status | Yes | Yes | Yes |
| View folder display name, **server-resolved** target, Backup/Mirror | Yes | Yes | Yes |
| View real progress, aggregate counts and paginated run summaries/history | Yes | Yes | Yes |
| Read original local OS path, local file list, raw device secret/root fingerprint | Only authorized owning Desktop/Agent | Never | Never |
| Create/bind/change Root, edit target/ignore rules/schedule/policy | Own local folder only | Never | Never |
| Start/preview/pause/cancel/retry/remove Source | Own local folder only | Never | Never |
| Control background scheduled runs | Local approved Agent only | Never | Never |
| Revoke lost-device login authorization | Separate account-security page | Separate account-security page | Separate account-security page |

The final row is **not** a backup-control loophole: owner-scoped revocation only invalidates device credentials/sessions and is audited. It grants no remote create/trigger/cancel/alter capability. Device heartbeat and revocation must not be conflated with an immediate forced termination of a running upload unless separate token fencing proves that guarantee.

For Pull, owner-scoped Web/Desktop creation, configuration, credential reveal, test, scan, cancellation and history remain unchanged. The local-device restrictions apply only to Push. Generic Src mutation handlers must dispatch authorization by source family and trust proof, not frontend/UI surface strings.

## 3. Device list presentation

Show separate `本机` vs `其他设备` groupings in Desktop; Web/Mobile Web are entirely observer layouts. Group each known device by trusted `ClientDevice.ID`; each may have several `local_folder` Source bindings. Do not group by host name, IP, folder name or another caller-supplied identity.

Read-only view **B** contains folder title, device name/platform, safe target path, backup mode, trustworthy phase/progress, synced/scanned/failed counts, actual bytes/speed where supplied, and paginated run summary including timing, status and *sanitized* reason categories. Do **not** return local paths even indirectly via `active_transfer_path`, item failure list, freeform `last_error` or other `ExternalSourceOverview` fields. Introduce an owner-scoped **redacted read projection**, rather than leaking the full existing mutation DTO and hiding buttons.

Online state requires an authenticated heartbeat and a documented age threshold: before it exists or for a legacy Agent, show **未知** and most recent activity if available. Device name/version alone or successful prior sync cannot prove online. Missing/expired heartbeat is not a deletion signal.

NAS section: non-interactive placeholder **NAS 备份 · 待支持** in the new App. Existing Synology Push Source IDs and histories must not be deleted or rewritten; a legacy NAS Source may be presented read-only with accurate 'legacy/unknown device' wording, never fake enrollment or online status. This round does not add NAS enrollment, pairing, CLI changes, remote control or a new universal NAS source model.

## 4. Mutations, security and execution

Only the owning xdrive-agent may access a locally approved Root and exercise `local_folder` writes. Desktop renderer never sends arbitrary foreign paths or a forged device ID to gain authority. Server must verify owner, authenticated device token, approved local Root/Source binding, current Source revision, live/not-revoked status and operation capability at **every** mutating boundary. `User-Agent`, browser-vs-Electron origin, identical account credentials, network location or device display name are insufficient.

Audit existing routes `POST /sources`, `PATCH/DELETE /sources/:id`, `POST /sources/:id/trigger`, `DELETE /sources/:id/local-binding`, `POST /sources/:id/runs/:runID/cancel`, run lifecycle mutations and device registration/revocation. The current `local_folder` Source activation/BeginRun hard-denial stays active until an end-to-end verified executor exists. A safe read-only UI alone does **not** mean the API enforcement task is finished.

Only the locally configured Agent may automatically run already-authorized scheduled sync in the background. Closing/switching Desktop should not cancel a durable transfer; explicit own-device cancellation should propagate through IPC/HTTP and Go `context.CancelFunc`. A scoped draft preview is read-only and must not advance SourceItem/checkpoint or Mirror deletion evidence.

Backup remains default. Mirror requires explicit opt-in, two complete reliable missing scans, 24h and trash-only semantics. An unreadable/unmounted Root, revoked device, incomplete scan or missing heartbeat must never infer remote deletion.

## 5. Delivery scope and suggested PR order

| Phase | Concrete delivery | Evidence / status |
| --- | --- | --- |
| L01 | source type, device credentials, Root approval & binding | merged #1204/#1208/#1214/#1216/#1219/#1223 |
| L02 | Windows/Linux bounded metadata scan, native identity, crash-safe journal | merged #1227/#1235/#1240 |
| L03-A/B/C/D1 | verified journal reader, bounded SHA256 preflight, candidates, CURRENT/PREVIOUS retention | merged #1244/#1246/#1250/#1258 |
| Policy P0 | AGENTS + UI ownership, redaction & legacy compatibility contract | merged #1259 |
| UI P0-A | two first-level routes/sidebar, legacy URL resolver, Pull-only scoped Manager and safe Push placeholder | P0-A1 proposed; full Push read UI and controller separation still pending |
| Security P0-B | device-local authorization for Source mutations, safe redacted device/folder read endpoints, spoof tests | read API merged #1270; device mutation guards and spoof tests pending |
| UI P0-C | Desktop owning-device wizard/controls, other-device/Web viewer, NAS placeholder | Web/Mobile Web redacted B-scope viewer proposed in P0-C1; Desktop Agent safe read IPC, local controls pending |
| L03-D2–G | multi-generation reconciliation, durable aliases, Planner/resumable/CAS/commit/recovery | not implemented |
| L05/L06 | watcher, local schedule, offline recovery; own-device preview/cancel and read-only status | not implemented |
| L07 | 1k/10k/100k, >=4 GiB, corrupt/revoke/cancel/Root replacement, Web/Desktop/Pull E2E | not implemented |

Do not block unrelated Race/Gallery/FileExplorer PRs for this UI task. Related PR branches remain exactly one work commit per fixed base; merge only after their exact-head CI, then clean branches via `.github/workflows/cleanup-merged-branches.yml`.


## P0-B1 progress: owner-scoped safe backup read API (merged #1270)

This phase introduces two **read-only** endpoints, `GET /api/v1/device-backups` and `GET /api/v1/device-backups/:sourceID/runs`. Both scope records to the logged-in owner and bind only actual `local_folder` Push Source records to registered devices; NAS is still a placeholder. The response is a narrow allowlist with safe folder names, Server-resolved cloud target, numeric real progress and paginated history. It never serializes Root fingerprints, Agent tokens, filesystem paths, Source ignore rules/checkpoints, or unrestricted failure details; legacy registered devices without an authenticated heartbeat report `connection_state=unknown` rather than a fictitious online status. It is the data foundation for Web and other-Desktop read-only scope B, **not** proof that the UI exists or that Source mutation endpoints are locked down. Requires PostgreSQL/SQLite-backed CI, owner isolation, pagination/redaction and Pull regression gates before merge.


## UI P0-A1 progress: separate applications (pending full PR CI)

Shared navigation now has two *top-level* destinations, `设备备份` and `远程拉取`; the old `sync-folders` Web hash is retained only as a compatibility route, resolving persisted Source `direction` by ID. Pull UI filters to `direction=pull`, including creation presets, without disabling existing Yike/DSM credential and scan controls. The Push app is deliberately a **non-operational placeholder** for local folder execution and NAS `待支持` while the server's read-only projection is wired into Web/Desktop adapters in the next phase. This stage does not let a foreign device (or a browser) configure, start or cancel a Push. It does **not** satisfy the complete B-scope viewer nor Server mutation fencing yet.

## UI P0-C1 progress: Web and Mobile Web read-only B-scope (pending CI)

Web now consumes **only** the allowlisted `GET /device-backups` and `GET /device-backups/:sourceID/runs` responses for device/folder names, trusted-safe cloud target, aggregate progress and paginated summary history. No local path or uncontrolled Source DTO enters this presentation, and it contains no mutation controls. The signed-in owner remains scope of both Server endpoints; online status is explicitly unknown until a separate trusted heartbeat feature is complete. For Desktop, the owning Agent does not yet have a safe read IPC; the UI remains a truthful unsupported placeholder until that port is added. NAS Push remains `待支持`. Source mutation protections and true local executor are separate deliverables.

## UI P0-C2 progress: Desktop read-only Agent IPC (proposed; CI pending)

Desktop reads the same narrow owner-scoped Device Backup DTO as Web/Mobile Web, but through an explicitly authenticated loopback Agent IPC (`device-backup-read` capability). This path passes through Electron Main/Preload, with strict Source ID and run-page bounds. Generic Source/SourceItem/run-failure endpoints are **not** a fallback. The shared presenter isolates overview, history and late responses by account/server datasource identity. Until the configured Agent advertises this read capability, Desktop remains a truthful, non-operational placeholder. This phase adds **no** Root picker/run controls, server mutation authority, heartbeat or uploader; Desktop own-device vs foreign-device action splitting remains future work.

## 6. Acceptance matrix (release-blocking for the new features)

1. With the same owner account, Desktop A edits and runs its locally authorized A-folder; Desktop B can see A's aggregate status/history but **cannot** create, edit, trigger, cancel, delete or unbind A. Raw HTTP requests from B and Web return forbidden even with spoofed device headers.
2. Owner Web/Mobile Web can see devices/folder names, resolved cloud targets, real progress/history; no local path, raw filename, Root fingerprint, tokens or unsanitized failure text leaks in JSON, errors, logs or browser caching.
3. Account-security revoke from Web/other Desktop invalidates device credential for later operations and does not enqueue/cancel any backup task or grant remote control. Cross-account revocation and reads are denied; audit reliably records revocations.
4. One Desktop can bind multiple independent Roots; two devices with same folder names remain distinct; rename keeps Node ID only with reliable proof; weak/hard-link identities do not silently authorize moves.
5. NAS placeholder does not expose setup/run buttons; existing NAS CLI/Source/run data stay valid and do not masquerade as generic ClientDevice. Existing NAS remote endpoint security gaps remain tracked and are not claimed fixed by UI.
6. Server Pull remains fully usable from Web/Desktop with unchanged Cookie/DSM masked-reveal, plan, Run, history and error flow; `synology_photos` Push/Pull are never mixed.
7. Legacy `sync-folders?source=...` deep links open the matching new App; missing ID and no permission are handled safely; content, Source/Node IDs, aliases, audit and job histories are not re-imported or migrated.
8. Real tests measure first 100k scan, 100 changed in 100k, agent RSS/CPU/DB calls, >=4GiB resumable transfer and cancellation, crash/restart, Source Commit idempotence, Root swaps and network loss. Document baseline and matched after results if optimizations are attempted.
