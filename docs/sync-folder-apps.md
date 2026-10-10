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
| Policy P0 | AGENTS + UI ownership, redaction & legacy compatibility contract | this documentation PR; not merged until CI |
| UI P0-A | two app routes/sidebar, Push/Pull controllers, migrate deep links and Pull parity | not implemented |
| Security P0-B | device-local authorization for Source mutations, safe redacted device/folder read endpoints, spoof tests | not implemented |
| UI P0-C | Desktop owning-device wizard/controls, other-device/Web viewer, NAS placeholder | partial prior picker; rest not implemented |
| L03-D2–G | multi-generation reconciliation, durable aliases, Planner/resumable/CAS/commit/recovery | not implemented |
| L05/L06 | watcher, local schedule, offline recovery; own-device preview/cancel and read-only status | not implemented |
| L07 | 1k/10k/100k, >=4 GiB, corrupt/revoke/cancel/Root replacement, Web/Desktop/Pull E2E | not implemented |

Do not block unrelated Race/Gallery/FileExplorer PRs for this UI task. Related PR branches remain exactly one work commit per fixed base; merge only after their exact-head CI, then clean branches via `.github/workflows/cleanup-merged-branches.yml`.

## 6. Acceptance matrix (release-blocking for the new features)

1. With the same owner account, Desktop A edits and runs its locally authorized A-folder; Desktop B can see A's aggregate status/history but **cannot** create, edit, trigger, cancel, delete or unbind A. Raw HTTP requests from B and Web return forbidden even with spoofed device headers.
2. Owner Web/Mobile Web can see devices/folder names, resolved cloud targets, real progress/history; no local path, raw filename, Root fingerprint, tokens or unsanitized failure text leaks in JSON, errors, logs or browser caching.
3. Account-security revoke from Web/other Desktop invalidates device credential for later operations and does not enqueue/cancel any backup task or grant remote control. Cross-account revocation and reads are denied; audit reliably records revocations.
4. One Desktop can bind multiple independent Roots; two devices with same folder names remain distinct; rename keeps Node ID only with reliable proof; weak/hard-link identities do not silently authorize moves.
5. NAS placeholder does not expose setup/run buttons; existing NAS CLI/Source/run data stay valid and do not masquerade as generic ClientDevice. Existing NAS remote endpoint security gaps remain tracked and are not claimed fixed by UI.
6. Server Pull remains fully usable from Web/Desktop with unchanged Cookie/DSM masked-reveal, plan, Run, history and error flow; `synology_photos` Push/Pull are never mixed.
7. Legacy `sync-folders?source=...` deep links open the matching new App; missing ID and no permission are handled safely; content, Source/Node IDs, aliases, audit and job histories are not re-imported or migrated.
8. Real tests measure first 100k scan, 100 changed in 100k, agent RSS/CPU/DB calls, >=4GiB resumable transfer and cancellation, crash/restart, Source Commit idempotence, Root swaps and network loss. Document baseline and matched after results if optimizations are attempted.
