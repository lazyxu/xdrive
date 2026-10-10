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
| UI P0-A | two first-level routes/sidebar, legacy URL resolver, Pull-only scoped Manager and safe Push placeholder | P0-A1 merged #1276; full Push execution/controller separation still pending |
| Security P0-B | device-local authorization for Source mutations, safe redacted device/folder read endpoints, spoof tests | read API merged #1270; P0-B2a cancellation merged #1301; P0-B2b1 bound writes merged #1308; P0-B2c1 generic read redaction merged #1313; P0-B2b2 creator claim merged #1323; P0-B2b3 safe unbound draft cleanup merged #1325; P0-C4a own-Desktop create/bind merged #1328; P0-C4b1 own draft resume merged #1332; P0-C4b2a owning Desktop bound rename merged #1342 (75-job CI green); P0-C4b2b own target change in PR |
| UI P0-C | Desktop owning-device wizard/controls, other-device/Web viewer, NAS placeholder | Web/Mobile Web B-scope viewer merged #1277; Desktop read IPC merged #1290; verified local identity merged #1296; owning-device controls pending |
| L03-D2–G | multi-generation reconciliation, durable aliases, Planner/resumable/CAS/commit/recovery | not implemented |
| L05/L06 | watcher, local schedule, offline recovery; own-device preview/cancel and read-only status | not implemented |
| L07 | 1k/10k/100k, >=4 GiB, corrupt/revoke/cancel/Root replacement, Web/Desktop/Pull E2E | not implemented |

Do not block unrelated Race/Gallery/FileExplorer PRs for this UI task. Related PR branches remain exactly one work commit per fixed base; merge only after their exact-head CI, then clean branches via `.github/workflows/cleanup-merged-branches.yml`.


## P0-B1 progress: owner-scoped safe backup read API (merged #1270)

This phase introduces two **read-only** endpoints, `GET /api/v1/device-backups` and `GET /api/v1/device-backups/:sourceID/runs`. Both scope records to the logged-in owner and bind only actual `local_folder` Push Source records to registered devices; NAS is still a placeholder. The response is a narrow allowlist with safe folder names, Server-resolved cloud target, numeric real progress and paginated history. It never serializes Root fingerprints, Agent tokens, filesystem paths, Source ignore rules/checkpoints, or unrestricted failure details; legacy registered devices without an authenticated heartbeat report `connection_state=unknown` rather than a fictitious online status. It is the data foundation for Web and other-Desktop read-only scope B, **not** proof that the UI exists or that Source mutation endpoints are locked down. Requires PostgreSQL/SQLite-backed CI, owner isolation, pagination/redaction and Pull regression gates before merge.


## UI P0-A1 progress: separate applications (merged #1276)

Shared navigation now has two *top-level* destinations, `设备备份` and `远程拉取`; the old `sync-folders` Web hash is retained only as a compatibility route, resolving persisted Source `direction` by ID. Pull UI filters to `direction=pull`, including creation presets, without disabling existing Yike/DSM credential and scan controls. The Push app is deliberately a **non-operational placeholder** for local folder execution and NAS `待支持` while the server's read-only projection is wired into Web/Desktop adapters in the next phase. This stage does not let a foreign device (or a browser) configure, start or cancel a Push. It does **not** satisfy the complete B-scope viewer nor Server mutation fencing yet.

## UI P0-C1 progress: Web and Mobile Web read-only B-scope (merged #1277)

Web now consumes **only** the allowlisted `GET /device-backups` and `GET /device-backups/:sourceID/runs` responses for device/folder names, trusted-safe cloud target, aggregate progress and paginated summary history. No local path or uncontrolled Source DTO enters this presentation, and it contains no mutation controls. The signed-in owner remains scope of both Server endpoints; online status is explicitly unknown until a separate trusted heartbeat feature is complete. Desktop now uses the same redacted DTO through its separately delivered safe Agent IPC (#1290); this P0-C1 stage alone did not implement Desktop support. NAS Push remains `待支持`. Source mutation protections and true local executor are separate deliverables.

## UI P0-C2 progress: Desktop read-only Agent IPC (merged #1290)

Desktop reads the same narrow owner-scoped Device Backup DTO as Web/Mobile Web, but through an explicitly authenticated loopback Agent IPC (`device-backup-read` capability). This path passes through Electron Main/Preload, with strict Source ID and run-page bounds. Generic Source/SourceItem/run-failure endpoints are **not** a fallback. The shared presenter isolates overview, history and late responses by account/server datasource identity. Until the configured Agent advertises this read capability, Desktop remains a truthful, non-operational placeholder. This phase adds **no** Root picker/run controls, server mutation authority, heartbeat or uploader; Desktop own-device vs foreign-device action splitting remains future work.

## UI P0-C3 progress: credential-verified own-device identity (merged #1296; full PR CI green)

Desktop uses the owning Agent's per-Server/account OS-stored device registration and secret, never a caller-supplied renderer device ID. An owner-scoped Server `GET /devices/self` verifies the device's exact ID and enrollment secret, including revocation; it returns only `device_id` and disables caching. No enrollment occurs merely by opening a read-only page. The identity check is separate from the device backup B-scope read API, and does not grant access to a local Root or authorize any Source mutation.

The shared presenter groups "本机" and "其他设备" **only after verified identity matches an owner-scoped device row**. On unavailable Agent capability, missing registration, revoked credentials, failed verification, or account/Server transition, it remains neutral/fully read-only rather than trusting a stale label. The Agent credential, local path, Root ID/fingerprint and per-file details never enter the renderer or Web. Pull and NAS behavior are unchanged. Local-only mutation guards, own-device actions, upload executor, trusted heartbeat, full pagination and real 100k/4GiB E2E are still pending.

## P0-B2a: local-folder Source Run cancellation fencing (merged #1301; exact-head CI green)

A local-folder Push run's `POST /sources/:id/runs/:runID/cancel` now uses the same device credential, Root ID/fingerprint, owner, Source revision and unrevoked binding admission as the already-protected execution stages. The handler repeats authorization **inside the cancellation write transaction**, acquiring the device lock before Source/Root/run locks to fence a concurrent device revoke or Source revision change. An owner JWT alone, forged device headers, wrong Root, revoked device or stale run revision cannot set `cancel_requested_at` on an active local Push run. Internal cancellation without local proof also fails closed. The existing `local_folder` execution/activation hard-denial remains; **this does not enable any uploader or UI button**.

Server-managed Pull and legacy NAS Source Run cancellation retain their pre-existing owner-scoped behavior. This is **only the cancellation boundary** of P0-B2. Generic local-folder Source creation/update/delete/trigger/unbind and binding-management permissions remain separate unimplemented gaps, and Agent-native explicit cancel with context propagation remains future work.

## P0-B2b1: bound local-folder configuration mutation fencing (merged #1308)

The Server now requires a registered, unrevoked owning device credential plus the exact Root ID/fingerprint and current Source revision for **already-bound** `local_folder` PATCH, DELETE, trigger and unbind operations. A shared read-only owner JWT or another Desktop using the same account is insufficient. Preflight uses the existing Source execution guard, then every write transaction rechecks the proof while locking device before Source/binding so revocation and revision changes fail closed. Paused Sources may be edited/removed by their authorized owning device; no generic unbound Source mutation is permitted yet. A synthetically forced active local Source also cannot be triggered before a proven native executor exists. Pull and legacy NAS behavior is unchanged.

**Remaining:** Creating an unbound `local_folder` still lacks a durable creating-device claim; the existing create/bind staging flow is not proof of owning device creation. Device-native configuration IPC must attach Root proof and provide safe cleanup/rebind rules for unbound/revoked legacy Sources. Do not claim those flows complete, and do not activate any local run/upload/schedule. The existing generic source read DTO still requires path/error redaction work.

## P0-B2c1: prevent generic local-folder read bypass (merged #1313)

The legacy owner-JWT Source and Run overview/detail APIs are shared with Pull/NAS.
They must not disclose local Push ignore rules, checkpoints, raw errors or active
filesystem paths to a second Desktop using the same account. The narrow
Device Backup DTO remains the intended remote summary. Generic local-folder
SourceItem, collection/item and run-failure detail reads fail closed until a
separate authenticated owning-Agent detail route exists; all Pull and legacy
NAS detail routes remain available.

The binding-presence GET remains owner-readable for the staged native picker,
but the Root UUID is omitted without the bound Agent's unrevoked credential.
The Agent performs token-authenticated recovery after an uncertain bind
response; it must not discard an already-committed Root on a timeout.
This hardening does **not** authorize local-folder creation, expose write
controls, add heartbeat, run an uploader, infer deletions, or complete the
1k/10k/100k and >=4GiB physical acceptance tests.

## P0-B2b2: authenticated local Source creation and creator-device claim (merged #1323)

A new paused `local_folder/push` Source requires the registered unrevoked
Agent credential and creator device ID in addition to the user session.
The Server locks the device row before atomically inserting the Source with
internal `LocalCreatorDeviceID`. The creator claim is omitted from generic
Source JSON. An initially unbound Source may only acquire a local Root binding
from that same creating device. Existing bound legacy Sources remain
idempotently recoverable; legacy unbound Sources without a reliable creator
claim remain fail-closed, not automatically adopted by the next logged-in
Desktop.

Desktop's existing Source creation IPC performs first enrollment inside the
Agent and presents the credential only to the Server transport. Neither the
Renderer nor Web/Mobile Web is given a token or local Root fingerprint.
**Limitation:** an enrollment token alone is not cryptographic remote
attestation of a physical machine or its filesystem. The owner-authenticated
device registration bootstrap remains a separate trust boundary; enrolling
an identity cannot itself authorize an existing Root or execute a backup.
The native picker and server-side Root/Source revision fences continue to
gate the initial bind and all later writes.

This phase creates Source identity/ownership only: it does NOT enable a
SourceRun, upload, scheduling, preview, cancel or Mirror delete. Recovering
legacy unbound Sources and securely removing orphan unbound Sources will
require an explicit owning-Agent flow; do not silently reclaim or delete them.

## P0-B2b3: owning-Agent cleanup for empty unbound drafts (merged #1325)

An authenticated `DELETE /api/v1/sources/:id/local-draft` requires the
unrevoked **creating** Agent enrollment token, matching owner and Source
revision, and an empty paused local-folder Push Source. The Server locks the
device row **before** the Source in one transaction to fence revocation and
first Root binding. Binding, any run/item/failure/collection/credential
history, scheduled work, changed revision or active state rejects cleanup;
the endpoint never deletes cloud Nodes/CAS bytes or an authorized Root.
Existing bound, revoked-device and legacy unclaimed Sources remain protected.
There is no owner-JWT-only orphan sweep or remote reclamation.

The Agent's existing Source deletion IPC selects this private cleanup path
only for local Push; ordinary Pull/NAS delete retains its previous behavior.
The shared create flow attempts safe cleanup **only** when the native picker
is explicitly cancelled for a just-created draft, reporting any cleanup
failure without falsely claiming deletion. This does not make the main Device
Backup page a writable Web/foreign-Desktop surface: the full own-device
wizard and bound-source edit/remove operations remain P0-C4.

Revoked-device recovery requires an explicit separate reclaim contract; it
is NOT implemented by bypassing creator identity. Local activation/SourceRun,
upload, automatic scheduling, and Mirror deletion remain blocked.

## UI P0-C4a: owning Desktop local-backup creation (merged #1328)

The first-level `设备备份` page accepts optional own-device-only
creation capability and a cloud directory browser. The Desktop supplies
them only while its Agent advertises both authenticated Source IPC and
native Root grants; Web/Mobile Web do not supply either. The user enters a
folder display name, chooses a Server-authorized cloud target directory,
then the Agent creates a paused Source with its device credential and Main
opens the OS-native directory picker. The Renderer never supplies a local
path, device token or Root fingerprint.

If the picker is cancelled for a newly created empty draft, the owning
Agent attempts P0-B2b3's fenced cleanup. Failed/timed-out authorization
retains a draft reference with explicit retry/cleanup controls; the Server
rejects cleanup of already-bound or historically used Sources. Account
changes replace the safe read datasource and dismiss the creation dialog.
This is **only the create/bind slice** of P0-C4: own-device bound Source
edit/remove/rebind, legacy orphan discovery/recovery, local preview and
run controls require subsequent stages. No actual upload or schedule is
enabled; B-scope history remains read-only for all devices.

## UI P0-C4b1: discover/recover own never-bound drafts (merged #1332)

The owner Desktop can now re-open a paused, never-bound `local_folder`
draft left by a dismissed picker, Agent restart or lost response. The
`GET /api/v1/device-backups/local-drafts` endpoint requires **both** an
authenticated owner session and the exact unrevoked creating-device
enrollment credential; an owner JWT, same-account Desktop B or forged
device ID cannot list A's drafts. The bounded cursor page returns only
Source ID, display name, revision and creation time. It excludes
previously bound, revised, historical, non-local and legacy-unclaimed
Sources, and exposes no OS Root identifiers/paths or unrestricted Source
configuration. The Agent loads its credential from OS storage without
auto-enrolling merely for a read; Electron Main/Preload add a private,
validated `device-backup-local-drafts` capability.

Only a **credential-verified local device** with Agent support receives
the recovery panel and its actions. A user can retry the existing native
Root picker (without creating a new Source), or request the P0-B2b3
empty-draft cleanup with confirmation; Server continues to fence binding,
history, revision and concurrent revocation. Listing uses bounded
`limit` and `after_id` cursor with `has_more`; account/server
changes discard old local draft state and late responses.

Web/Mobile Web and another Desktop keep their B-scope read-only
experience. No activation, SourceRun, watcher, uploading, Mirror deletion,
bound-Source editing/rebinding or revoked-device recovery is enabled.
These are distinct follow-on stages P0-C4b2 and L03-D2–G.

## UI P0-C4b2a: owning Desktop bound local Source rename (merged #1342; full 75-job CI green)

The owning Agent resolves an OS-protected enrollment secret, retrieves the
Server's device-verified binding, verifies the native Root grant against the
current filesystem, and sends four device/Root headers and If-Match revision
for the preexisting Server PATCH. The Server enforces device, Root, owner,
revocation and revision again inside the write transaction. Missing/replaced
Root, foreign or revoked device and stale revision fail closed. New Agent
loopback GET/PATCH capabilities reveal only Source ID/name/revision.

The shared B-scope presenter offers renaming only on credential-verified
own-Desktop rows. Web/Mobile Web and other Desktop remain read-only. A
server/account change closes the action and ignores late UI completions.
This stage does not activate local Push, permit run controls, Root rebind,
target/ignore-rule edits, upload, schedule or Mirror deletion; NAS Push stays
a placeholder. Exact-head CI and native-device verification are required
before claiming completion. L03-D2-G/L05-L07 remain future work.

## UI P0-C4b2b: own Desktop cloud target revision change (PR verification)

This bounded follow-up adds only changing the **Server cloud target directory** of
an already-bound, paused local Push Source. The existing `PATCH /sources/:id`
authenticates the exact owning Agent's device token, current Root UUID/fingerprint
and Source revision *inside the write transaction*, validates the new target
as a live directory owned by that user, and resets prior Mirror evidence when
the target changes. The Agent reloads its OS-stored credential, verifies the
exact bound RootGrant and source state, then passes only a target Node ID. No
alternate generic JWT-only mutator or arbitrary local path is exposed.

Desktop Main/Preload add a validated, platform-advertised
`device-backup-local-target` capability. A shared MUI cloud-directory chooser
is supplied only for the credential-verified local device row; Web/Mobile Web
and Desktop on another installation remain B-scope redacted observers.
The settings DTO contains only Source ID/name/revision and the Server-resolved
cloud target ID/path (not a local absolute path). No cloud bytes are moved or
deleted, and existing Source IDs/history/CAS remain untouched. Backups remain
paused: no Source Run, upload, background schedule, Root rebind, Mirror deletion
or NAS Push UI is enabled. Real Windows/Linux device acceptance, 100k and 4 GiB
execution remain L07 and are not claimed by source-only tests.

## 6. Acceptance matrix (release-blocking for the new features)

1. With the same owner account, Desktop A edits and runs its locally authorized A-folder; Desktop B can see A's aggregate status/history but **cannot** create, edit, trigger, cancel, delete or unbind A. Raw HTTP requests from B and Web return forbidden even with spoofed device headers.
2. Owner Web/Mobile Web can see devices/folder names, resolved cloud targets, real progress/history; no local path, raw filename, Root fingerprint, tokens or unsanitized failure text leaks in JSON, errors, logs or browser caching.
3. Account-security revoke from Web/other Desktop invalidates device credential for later operations and does not enqueue/cancel any backup task or grant remote control. Cross-account revocation and reads are denied; audit reliably records revocations.
4. One Desktop can bind multiple independent Roots; two devices with same folder names remain distinct; rename keeps Node ID only with reliable proof; weak/hard-link identities do not silently authorize moves.
5. NAS placeholder does not expose setup/run buttons; existing NAS CLI/Source/run data stay valid and do not masquerade as generic ClientDevice. Existing NAS remote endpoint security gaps remain tracked and are not claimed fixed by UI.
6. Server Pull remains fully usable from Web/Desktop with unchanged Cookie/DSM masked-reveal, plan, Run, history and error flow; `synology_photos` Push/Pull are never mixed.
7. Legacy `sync-folders?source=...` deep links open the matching new App; missing ID and no permission are handled safely; content, Source/Node IDs, aliases, audit and job histories are not re-imported or migrated.
8. Real tests measure first 100k scan, 100 changed in 100k, agent RSS/CPU/DB calls, >=4GiB resumable transfer and cancellation, crash/restart, Source Commit idempotence, Root swaps and network loss. Document baseline and matched after results if optimizations are attempted.
