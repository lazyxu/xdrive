# Local folder push — staged delivery contract

## Objective and status

An ordinary **local folder** selected by the user on Windows or Linux should push original files to an owner-authorized xDrive Source target. Existing xDrive CfAPI/FUSE two-way mount synchronization, Synology NAS Push, and Pull connectors are separate products and remain unchanged.

The local-folder **enrollment and authorization flow is in master** (L01-A/B, Desktop native picker and shared Source Manager). L02-A/B/C have delivered bounded Windows/Linux metadata scans, native identity hints and a crash-safe local journal. L03-A/B/C add verified reading, original-file digest checking and conservative planning candidates; L03-D1 stages retention of two generations for a future read-only reconciler. None of these phases enables SourceRun, upload, deletion inference or automatic sync. The Server still rejects local-folder activation and run execution. Source/CAS/upload protocols remain shared rather than duplicated.

| Phase | Deliverable | Status |
| --- | --- | --- |
| L01-A | local_folder push/paused activation gate; integration regression; AGENTS progress rule | merged #1204 |
| L01-B | Device registration, Root binding, runtime proof and revocation fencing, native Desktop Root grant | merged #1208, #1214, #1216, #1219, #1223 |
| L02-A | Windows/Linux bounded read-only scanner with cancellation | merged #1227 |
| L02-B | Root-scoped native file identities and hard-link-safe hints | merged #1235 |
| L02-C | Crash-safe Root-scoped local inventory journal with optional 100k stress test | merged #1240; native 100k execution still pending |
| L03 | Verified journal/candidates, two complete generations, candidate delta, then durable identities/Planner/resumable bytes | L03-A #1244, B #1246, C #1250, D1 #1258 merged; L03-D2a read-only delta merged #1351; L03-D2b1 native rename hints merged #1385 (76-job exact-head CI green); L03-D2b2a advisory generation fence merged #1397; no durable SourceItem alias index, Planner or uploader |
| L04 | Desktop native root selection and shared Source Manager UI | entry/grant flow merged #1223 and #1226; actual sync experience still incomplete |
| L05 | watcher, scheduled reconciliation, mount/unplug fail-closed behavior | not implemented |
| L06 | Desktop-only local Push preview/run/cancel; Web/other Desktop owner-scoped device/folder read-only summaries | own read-only metadata preview merged #1391; manual local snapshot P0-C4c2 merged #1400; P0-C4c3 local delta merged #1411 (76-job exact-head CI green); executor, run/cancel, offline queue not implemented |
| L07 | 1k/10k/100k and >=4 GiB E2E, cancel propagation and CI evidence | not implemented |

## P0-B2b2 native creating-device claim (merged #1323)

Staged local-folder creation is initiated via the Desktop Agent and requires
its OS-protected enrolled device secret. The Server validates and locks that
device record while saving the new paused Source's private creating-device
claim; the first Root binding must be performed by the same device. Old
already-bound Source IDs keep their existing identity and can replay their
binding, but orphan legacy **unbound** Sources are not adopted without
verifiable prior ownership. The device secret never leaves the Agent for
Renderer/Web; the Root still requires native picker authorization. This
does not enable local Push execution, scheduling, Mirror deletion or 4 GiB
uploads. The owner-JWT device-registration bootstrap is not a physical-device
attestation and remains a separate trust consideration; unbound **legacy** reclaim remains a separate explicit ownership workflow.

## P0-B2b3 native empty-draft cleanup (merged #1325)

A newly created paused `local_folder` with an authenticated creator claim
may be discarded via a dedicated owning-Agent-only endpoint, before any
Root binding or Source data exists. The Server transaction locks device
first, rechecks its unrevoked credential, Source revision and absence of
binding, run, item, collection and credential history, then deletes only
that Source record. No cloud Node, CAS bytes, local directory or Root grant
is deleted. A native-picker cancellation after initial creation attempts
this narrowly fenced cleanup; a failure leaves a visible paused draft for
later local recovery. Existing bound records, orphan legacy records and
revoked device records cannot be reclaimed with owner JWT alone. No
automatic periodic orphan deletion is performed. Actual local Push
execution remains completely disabled.

## P0-C4b1 device-local draft recovery (merged #1332)

Only the owning Agent (same owner session plus OS-held, unrevoked
installation token) may list its own paused, never-bound Source
drafts. A bounded ID-cursor read projection does not expose local
Root paths, Root IDs, credentials or detailed Source configuration.
Desktop presents retry-native-pick and confirm-empty-draft-delete
controls; creator-only P0-B2b3 fencing remains authoritative.
Same-account other desktops, Web and legacy unclaimed Sources do not
get draft controls. Device revocation recovery and existing bound
Source edit/removal remain separate unimplemented phases; this change
does not lift the local Push execution/activation block.

## P0-C4b2 own Desktop bound Source settings (partial)

P0-C4b2a **merged #1342**, after full exact-head CI, permits only a
device/Root/revision-protected change of a paused Source's name. P0-C4b2b
merged #1348 as a separate change of the Server's cloud target directory using
the same private Agent credential and validated bound Root. A target change
never relocates or deletes previously stored cloud data. The Server verifies
directory ownership and resets Mirror missing evidence as applicable.
No local Push executor, automatic upload, cancellation UI, actual
filesystem-to-CAS sync or physical-scale benchmark is enabled by either edit.

## P0-C4b2c own-Desktop safe bound Source removal (merged #1356)

Only an owning Desktop may remove an already bound, paused and
**history-free** local Push configuration. Agent requires the OS-stored
device secret, validates its native Root grant, and sends the exact
device/Root/revision proof to the existing Server DELETE. Transactional
Server checks reject revoked or foreign devices, stale revisions,
active Sources and any run/item/failure/collection/credential history.
An existing historically used Source and its stable identity are retained
until a future archival contract exists. The operation never deletes
original local files or cloud Node/CAS bytes. The private Root-grant
record is cleaned only after confirmed Server success; ambiguous HTTP
responses retain it. Web/other Desktop remain read-only.

## P0-C4b2d own-Desktop saved Backup/Mirror policy (merged #1366; full 76-job CI green)

Only a verified owning Desktop can update the **saved** Backup/Mirror policy
on its existing, bound and paused Source. A capability-gated Agent IPC loads
the OS-stored device credential and validates the native Root grant, session,
Source revision and exact registered binding before calling the existing
Server PATCH with device/Root proof and If-Match. The renderer receives only
the minimal private configuration DTO, never OS paths or credentials.
Web/Mobile and another Desktop remain strictly read-only.

Backup is the default. Selecting Mirror requires separate explicit
confirmation. A policy change clears old Mirror deletion evidence in the
same Server transaction. Future Mirror execution still requires two
complete trustworthy missing scans, 24 hours of grace and trash-only
actions; an unmounted/unreadable Root must never cause deletion.
No activation, upload, watcher, scheduler, run/cancel, Root rebind or NAS
Push is enabled. Real Windows/Linux, 100k and >=4GiB acceptance remain open.

## P0-C4b2e1 local-only ignore rules (merged #1372; full 76-job CI green)

The generic Source API's `ignore_rules` redaction continues
unchanged. The dedicated owning-Agent private GET verifies the signed-in
owner, bound device credential, authorized native Root ID/fingerprint
and current Source revision again within a DB transaction. Only the
private local Source ID/revision/rules projection is returned to the
verified owning Desktop, never a remote or Web observer; Cache-Control
is private no-store. Revoked/missing/wrong device and unknown/changed Root
fail closed, with no generic Source read fallback.

The own-Desktop editor accepts at most 64KiB / 4096 lines using the
existing ignore matcher grammar. A save sends *only* `ignore_rules`
with the Agent's OS-private proof and If-Match through the existing
PATCH. Transactional Server validation enforces the revision and resets
Mirror missing evidence on change. Save does not run a scan, scheduler,
upload, or cloud deletion and does not claim actual backup is ready.
Separate P0-C4b2e2 schedule configuration and L03-D2b–G/L05–L07
execution, watcher, recovery and real-device tests remain pending.

## P0-C4b2e2 saved local schedule only (merged #1378; 76-job exact-head CI green)

A verified owning Desktop may read and save a manual, interval or cron
plan only for its own **paused**, bound local Push Source. Normal
owner-JWT Source reads redact local schedule type/expression/timezone,
and other devices/Web receive only B-scope progress/history without an
operation port. A dedicated private Server GET verifies exact device
credential and Root plus Source revision under transaction locks.
Native Agent IPC requires a current native Root grant, private token
and consistent session. Server PATCH is limited to the three
`schedule_*` fields, reuses the transaction-fenced Source
revision, and validates through `sourceschedule.Normalize`.
Malformed duration, timezone or cron never commits.

Manual cancels the saved *configuration preference* only; it does not
cancel a running task. Interval duration is 1 minute through 365 days;
cron is five fields and an IANA timezone. The private returned DTO is
verified with a second authenticated read because generic Source PATCH
responses stay schedule-redacted. The UI explicitly says **saved, not
executing**; no next-run time, online status or effective background
schedule may be fabricated. Existing local-folder activation/run denial
stays enforced. L05 native Agent scheduling and recovery, L03-D2b–G
durable uploader, L06 local preview/explicit cancel and L07 physical
tests remain unimplemented.

## Agreed Push/Pull product and security boundary (2026-10-10)

The canonical Web/Desktop navigation, local-vs-other Desktop capabilities, read-only projection and compatibility acceptance matrix are in [sync-folder-apps.md](./sync-folder-apps.md). These are approved requirements, **not proof of currently implemented Server/UI restrictions**.

- **设备备份** (Push) and **远程拉取** (Pull) are separate **first-level** applications. A shared `Source` backend is not a reason to share a single mixed configuration page.
- Only the *owning machine's* Desktop + xdrive-agent may authorize/configure/start/pause/cancel/retry/remove that machine's `local_folder` Sources. Another Desktop—even signed into the same user account—can only inspect the safe folder name, server-resolved target, policy, progress, aggregate counts and run summaries; it cannot read absolute OS paths or initiate operations.
- Web/Mobile Web sees the same owner-scoped read-only device/folder summary, including real progress and paginated history; it cannot make offline execution requests or run read-only previews against a foreign device.
- **Account-security exception:** owner-scoped lost-device token revocation is allowed in a *separate account security page*. It must not be exposed as a backup task operation or a means of remote control.
- NAS Push remains locally administered and executed by the NAS. No new NAS Push agent/management feature is delivered in this round: show a non-interactive **待支持** entry; retain existing NAS Source/Run data and the legacy local NAS CLI without incorrectly advertising a unified device/heartbeat integration. Existing generic owner-JWT NAS mutation routes are a transitional API-security gap, not compliance with the target model.
- All Pull Sources remain operable from Web/Desktop. Preserve existing `synology_photos` Pull and Push differentiation by `kind+direction`, target Node identities, aliases, task and media history, and the original CfAPI/FUSE mount product.
- Current `local_folder` activation and SourceRun remain fail-closed. Do not claim that the existing generic owner-authenticated create/update/delete/trigger/cancel API already enforces this stricter device-local policy. Before enabling execution, require server-side device token/Root proof, revocation fencing and all cross-device negative tests.

## L01-B2-B transaction-scoped device revocation fencing (non-operational)

Source Run mutating handlers revalidate the bound device token, Root and Source revision under the same database transaction as their writes. Device rows are locked before the Source and binding, consistent with device revoke. A write must commit before revoke or observe revoke and fail, never silently continue afterward. Existing run source revisions are also checked. This is not an OS-local Root grant and **does not lift L01-A's hard activation/run denial**; native Agent approval, scoped uploads and E2E verification remain outstanding.

## L01-B2-A Source Run executor-proof preflight (non-operational)

For the seven Source Run **mutating** endpoints (begin, observe, commit, failures, progress, heartbeat, finish), local-folder Sources require a verified owner-scoped device enrollment token and the exact bound Device ID, Root UUID and fingerprint. The owner's JWT alone is insufficient. All existing non-local-folder Source executors are unchanged. Today the generic Source Run cancel endpoint is owner-authenticated. Before a local-folder executor is enabled, add own-device authorization to local Push cancellation. Keep existing Pull semantics, and do not use the owner JWT alone as proof of ownership of a local source.

This phase is a **preflight only**, not final transactional revocation fencing: the subsequent Agent/Server implementation must validate the device and binding within every corresponding write transaction, bound to the run's accepted device/root/config revision, to avoid revoke-versus-commit TOCTOU races. Existing regular file upload APIs remain owner-authenticated rather than device- or Source-scoped; they must not be treated as an authorized local Source commit. The L01-A activation and BeginSourceRun hard-deny is preserved until all these end-to-end checks are in place.

## L01-B identity/binding staging (non-operational)

The Server maintains `xd_client_devices` with an owner-scoped installation identity and a SHA-256 hash of a random credential. The raw credential is only returned on initial `POST /api/v1/devices` enrollment and must be saved to the Agent's OS credential store; it is not returned by `GET /api/v1/devices`. A client can be revoked without revoking the owner's other sessions. Revocation also pauses linked local-folder Sources and resets pending Mirror evidence.

An owner can bind one paused `local_folder` Source to a device + UUID local Root ID + opaque SHA-256 Root fingerprint via `POST /api/v1/sources/:id/local-binding`, passing its device credential in `X-XDrive-Device-Token`. The binding is version-checked and owner scoped; a different binding requires explicit unbind first. Neither the binding nor the device DTO contains an absolute OS path, and a remote Web request alone cannot authorize a local path.

**L01-B is not yet an executable local-folder sync feature.** A later native Agent must verify the user-selected Root on the host and safely hold its path permission. Source activation and BeginSourceRun remain deliberately denied by L01-A. The next bounded deliverable adds Agent native root approval plus proof checks on all run mutation stages before lifting those gates.

## L01-B5 shared Source Manager local-folder entry (non-operational)

The shared MUI Source Manager adds a `local_push` preset, but only when the adapter exposes Desktop-native Root authorization capability. Web/Mobile Web cannot create a local Source or choose OS paths through a browser. New Sources stay paused; after creation, Desktop MAIN opens the native picker and asks the Agent to bind the selected directory. On picker cancellation or authorization errors, keep the paused Source and explain how to retry from Details. Existing Synology/Yike options and Web behavior remain unchanged.

The local-folder form intentionally hides Mirror, formal scan-mode and automatic scheduling controls until the native executor and safe-preview contract exist. SourceRun trigger remains unavailable and must not indicate upload success.

## L01-B4 Desktop to Agent Root approval path (still no synchronization)

Electron MAIN will ask the OS native directory picker, then send only that picker-selected path directly to the Agent loopback IPC. The Renderer supplies only an owner Source ID; it cannot supply a path for the new authorization action. The Agent checks logged-in account/server scope, paused `local_folder` Source type and status, source binding absence, native Root identity and exclusion of xDrive's mounted and private credential trees. It reuses one enrolled device per Server/account, stores its token only through OS secretstore and binds the Root to the Server using revision/credential proof.

The new IPC path is restricted by existing loopback/discovery-token authentication and platform capability negotiation; it never starts a SourceRun or lifts the L01-A activation block. First UI task is to add a visible picker action in the shared Source Manager only when this Agent capability is present.

## L01-B3 native Root identity, credential persistence and Go Client transport (non-operational)

`internal/localpush` prepares a local-only RootGrant after a user-initiated native directory choice. It rejects non-absolute paths, non-directories and symlinked root/parent components. The grant holds a per-root UUID and a fingerprint based on Linux device/inode (+ birth time when supported), or Windows volume/file index and creation time. At load/scan entry, the Agent must recheck the fingerprint; a replaced, missing or reparse-point root is not treated as an empty directory. Weak Linux identity (`strong_identity=false`) is not sufficient for Mirror delete inference.

The local JSON registry stores paths under a per-Server/account hash with user-only filesystem permissions, never device tokens. Enrollment tokens are saved separately using the existing `internal/secretstore` facility (Windows DPAPI; Linux Secret Service or 0600 fallback) with a distinct credential namespace. Device register/list/revoke and bound Root read/bind/unbind have typed Go Client transports. The raw token is never returned to the Renderer or stored in the Root JSON.

**Still non-operational:** this library does not itself know that an Electron picker was clicked, does not expose an Agent RPC to grant a path, and does not lift the Server fail-closed source run gate. Subsequent work must authenticate the local picker-to-Agent IPC boundary and prove its Root grant before a permitted upload. No `local_folder` UI preset until the full loop passes E2E.

## L02-A read-only bounded local inventory (no Source writes)

`internal/localpush.InventoryScanner` accepts an already authorized RootGrant, an optional compiled `Source` ignore configuration and a synchronous bounded-batch callback. It enumerates original file/directory metadata without hashing contents, uploading bytes, creating SourceItems or changing SourceRun checkpoints. The scanner validates root identity before and after enumeration, propagates Go context cancellation and callback failures, and does not follow symlinks or nonregular files. Ignored items are still included in batches to support honest preview counts and potential negation rules. Directory reads are capped at 256 entries and callback batches to at most 500; no 100k-sized item array is accumulated.

A completed metadata enumeration is NOT yet authority to infer deletions: `missing_inference_safe=false` until reliable per-item identities, complete-inventory reconciliation and agent/run protocol are implemented. No Mirror, scan-only formal SourceRun or cloud file mutation is enabled. Tests cover 1043 files with batched delivery, ignored files, cancellation, Root replacement and symlink skipping; a dedicated 10k/100k process-level performance baseline still needs native execution.

## L02-B native per-entry filesystem identity (candidate metadata only)

Opt-in `InventoryScanner.IncludeNativeIdentity` now emits a **root-scoped, opaque SHA-256 key** for each eligible file or directory, plus `strong`, `link_count` and `rename_candidate`. It does not hash file contents. Linux derives native identity from device/inode and birth time (where exposed by `statx`); absence of birth time deliberately yields a weak key. Windows derives identity from volume serial, file index and creation time, refusing reparse points. Root UUID is part of the hash scope, so identities from different authorized Sources never accidentally collide.

**Important:** Native object identity does **not** equal logical SourceItem identity. Hard links share the same key while representing separate paths; a link count over one makes file rename candidates unsafe. Even strong single-link candidates are only evidence for the future journal/reconciliation layer, not authority for move, overwrite or deletion. The caller must revalidate Root and file identity around real byte reads in L03, reject ambiguous reuse and preserve the original file's logical identity if safe. The default scanner keeps native identity disabled for existing read-only previews and their original IO budget.

Tests verify rename stability, hard-link ambiguity, per-Root scoping, opt-in behavior and cancelled inventories. This phase does **not** add an on-disk index or enable a SourceRun. `missing_inference_safe` remains false; Mirror and all upload operations remain disabled.

## L02-C atomic Root-scoped local inventory journal (non-operational)

`ScanInventoryToJournal` streams batches of L02-B native-identity observations into a private local NDJSON file. It retains constant-size buffers rather than loading an entire 100k inventory into the renderer or a process-wide JSON array. Every completed snapshot is flushed, `fsync`ed and renamed to an immutable local file; only then is the small `CURRENT.json` manifest atomically replaced. Old snapshots are deleted only after the new manifest is committed. An interrupted/failed/cancelled scan leaves the last complete generation selected. Restart verifies the authorized Root and streams the snapshot through SHA-256 before use; tampering, mismatched Root/Server/Source, and replaced drives fail closed.

A gated native 100k filesystem test is included; it executes only when `XD_LOCALPUSH_STRESS_100K=1` is supplied. Merely providing this test is **not** a claimed measured 100k performance result. Record actual wall time, RSS and IO on real Windows/Linux devices before performance decisions.

This is **strictly Agent-local state**; it is not a SourceRun checkpoint, stable SourceItem identity, automatic upload, or evidence for missing/deleted remote files. `MissingInferenceSafe` remains false. The next phase must implement the reconciler between consecutive snapshots and the remote Source, including hard-link-safe moves and crash idempotence, before enabling any transfer or Mirror.

## L03-A read-only verified inventory reader (pending execution protocol)

`StreamVerifiedInventoryJournal` validates a complete local Root-scoped journal with SHA-256 **before** returning any bounded batches, then checks each path, type, native identity, hard-link ambiguity, totals, checksum and Root identity during/after the stream. A cancelled, replaced or corrupt local inventory never returns a successful completed snapshot. The reader is intentionally callback-based and bounded to 500 observations; it does not buffer the 100k inventory in the frontend or create cloud SourceItems.

Callbacks remain **read-only**: they can be invoked before the final recheck completes, so downstream planners must not mutate remote state based on a partial or failed reader call. This prepares future reconciliation and resume logic but is not an upload, Source Run checkpoint or Mirror deletion evidence. Full end-to-end operation and cancellation/revocation acceptance are still L03 follow-up work.

## L03-B safe local file content preflight (non-operational)

After a complete verified L03-A journal, `HashVerifiedInventoryFile` can stream one non-ignored regular file through SHA-256 with fixed 256 KiB buffering and Go context cancellation. The operation validates the Source Root, canonical relative path, expected size/mtime/native item key and open handle before returning a digest; modifications or replaced roots reject the result. Linux uses `openat2` with beneath/no-symlink resolution (fails closed on unsupported kernels); Windows rejects observed reparse-point directories and leaf handles. No content bytes or credential paths are returned to Web.

The digest is **advisory preflight evidence, not a stable SourceItem ID or upload authorization**. A future uploader must preserve the verified file handle or reopen and validate equivalent native constraints and must match the Server/CAS-received SHA before committing a SourceItem. The current feature neither publishes plans nor mutates remote files, runs or deletion evidence. Tests cover original bytes, cancellation, content changes, path traversal, symlinks and Root replacement. A 4 GiB Windows/Desktop resumable upload E2E still needs actual execution in a later phase.

## L03-C bounded local planning candidates (non-operational)

The L03-C `StreamInventoryCandidates` projection consumes only a completed SHA-256-verified L03-A journal, emitting synchronous batches no larger than 500 records. Each candidate carries two deliberately separate forms of evidence: a **Root- and path-scoped path key** that distinguishes hard-link paths, and a **native object key** for conservative rename hints only where the filesystem reports a strong and uniquely linked identity. Ignored files never request content hashing.

**Neither key is yet a persistent Server SourceItem ExternalID.** Hard links share a native key, weak inode identities cannot authorize moves, and changing link counts can invalidate a rename hint. A later durable path/alias reconciliation index must resolve these facts against Server revision and existing SourceItems before planning remote creates/moves; no remote deletion inference is implied by any candidate. Cancellation and callback errors return no completed projection. This remains read-only Agent code, not a SourceRun or upload path.

## L03-D1 two-generation Root inventory retention (read-only)

A complete Root journal now retains `CURRENT.json` and the immediate `PREVIOUS.json` manifest. On successful inventory commit, PREVIOUS is atomically written before CURRENT; a crash between writes may leave both referring to the same last valid generation, **never evidence of remote deletion**. The oldest third generation is removed only after the new CURRENT has been published. Existing installations with only CURRENT remain valid. `VerifyPreviousInventoryJournal` independently checks grant/Root identity and SHA-256 before exposing the predecessor. Cancelling or failing a scan does not publish an incomplete CURRENT.

Both manifests are Agent-local read-only evidence, not SourceItem identities or SourceRun checkpoints. No candidate delta, upload, Mirror deletion inference, watcher or automatic scheduling is enabled. The later reconciler must validate two **different** complete generations, preserve logical aliases and reject ambiguous hard links or weak identities. The 100k real-device scan/diff performance baseline is still outstanding.

## L03-D2a bounded read-only two-generation candidate delta (PR verification)

An owning Agent may compare two independently SHA-256-verified, different
CURRENT/PREVIOUS snapshots for the same authorized local Root, without
loading the entire 100k-entry tree into RAM. A private, 0700 temporary
directory partitions relative-path metadata into 64 hash buckets, 0600 files,
and caps each generation's in-memory bucket at 8192 candidates. Streaming
output batches are at most 500. On corruption, duplicate inventory paths,
missing generations, swapped Root, concurrent manifest replacement, skewed
bucket overflow or cancellation, the operation fails closed; staging files
are discarded. The callback must not mutate remote state.

Path-relative metadata yields only added/changed/metadata-stable or
absent-**candidate** records. Even metadata-stable does not prove identical
file bytes. Rename/hardlink hints are not stable SourceItem identity and
are **not matched** here; a rename is conservatively added+absent candidates.
Nothing changes Source/SourceItem/SyncRun, journal heads, CAS or Mirror
evidence. `MissingInferenceSafe=false` is unconditional. This is a
preparatory local library only, not a Desktop command, scheduled sync,
distributed cursor or upload. CI unit tests are not native 100k RSS/time
measurements; 100k/4GiB device acceptance remains outstanding.

## Non-negotiable invariants

- The Device binds one explicitly authorized local Root to one Source ID for a specific Server and owner. Never let Web specify arbitrary paths to read on the client.
- Preserve Node identity on provable rename/move; never infer same-file identity from name and timestamp alone; handle hard links as distinct paths.
- A local-folder Source must never become active before authenticated binding and execution capabilities are available. Stale manually altered data must not be executable.
- The Agent executes in a separate lifecycle from the Desktop window. Persistent sync is cancelled only by explicit user control; viewer/browser aborts cannot cancel it.
- Full inventory is required for missing inference. Unmounted drives, unreadable directories, cancelled runs, partial scans and lost watcher events must not count as deletions.
- Backup never deletes xDrive content when local files disappear. Mirror only uses the existing 2 complete scans + 24-hour grace + trash-only policy.
- Use existing `Source / SourceItem / SyncRun`, `internal/client` resumable upload, CAS and Task Center; no parallel media parser, transport or business store.
- Draft rule preview is not a formal `run_mode=scan`: the formal mode mutates synchronization records. Implement a separate no-business-writes *Desktop-local* preview in L06; do not add Web or foreign-Desktop preview for a local Root.
- Server identity, owner authorization, revisions and target Node binding are authoritative. No cross-account source access or data leakage.
- Before performance work, record baseline, optimize only where necessary, rerun identical 1k/10k/100k and large-file workloads, keep only meaningful improvements.

## Release and verification gates

L01-A: reject pull; create push paused; reject premature activation and trigger; refuse run even if a database row is incorrectly set to active; keep Synology/Yike behavior unchanged. Requires PostgreSQL integration tests.

L01-B/L03: prove device credential possession for the *entire* source run lifecycle, not only initial enrollment; owner-bound binding with a locally approved Root; reject stale device/root/config versions, revoked devices and replay.

L02/L05: prove at least 100k inventory without loading the entire tree into the renderer, successful rename/modify/identity preservation, filesystem-event overflow fallback, root replacement safety, restart resume and no false mirror deletions.

L04/L06: two first-level Push/Pull apps; own Desktop native Root picker and safe Agent preview/run/cancel; foreign Desktop/Web read-only redacted device/folder state with truthful heartbeat (unknown until proven), counts, real progress and paginated run summaries. No remote Push execution queues, all other-device mutation endpoints fail closed, and Pull remains fully manageable.

L07: measurable SQL P50/P95, Agent RSS/CPU, bytes transferred vs CAS reuse, 4 GiB stream/resume, explicit cancel propagation and power/network interruption tests. Native-device and simulated tests have separate verdicts.

Related GitHub PR/branch cleanup must be evidence-based and scoped to this work; never disturb unrelated active work.


## L03-D2b1: conservative private native-identity rename hints (merged #1385; 76-job exact-head CI green)

An owning Agent can compare **two independently verified, complete Root snapshots** and extract advisory rename hints for **regular files only** when each generation has exactly one observation of the same strong, root-scoped native identity, both have link_count=1, and the canonical relative paths differ. It examines unchanged as well as changed paths to prevent reuse/duplicate/hard-link identities from being paired. Directories, weak/ambiguous identities, mismatched kinds and duplicated observations are never paired.

This is an **Agent-private library**, not a Desktop operation or remote read endpoint. Native keys and relative paths are never returned to Web/other Desktop. It reuses L03-D2a verified delta, spools records in 0700/0600 temporary files and processes 64 hashed buckets with an 8192-record bound; callback batches are <=500. Cancellation, invalid generations, Root replacement, identity skew and corruption fail closed; staging files are removed. All delta staging completes before a hint callback, but callers must still treat late callback failures as invalidating the advisory result.

**No durable SourceItem ID/alias index**, server reconciliation, CAS bytes, SourceRun checkpoint, upload, Mirror missing evidence, automatic schedule, background watcher or local preview is introduced. `MissingInferenceSafe=false` remains mandatory. A future durable alias/index protocol must bind hints to the Server's authoritative Source revision and item identities, verify content when needed and handle crashes/replay before any remote rename/commit. Native Windows/Linux 100k/4GiB E2E remains outstanding.


## P0-C4c1 owning Desktop read-only local inventory preview (merged #1391; 76-job exact-head CI green)

The verified owning Windows/Linux Desktop may explicitly preview an **already-bound, paused** local Push Source's native filesystem metadata using a capability-gated, authenticated loopback Agent IPC. It first checks owning-device credential, Source revision and native Root grant; then reads actual private ignore rules through the bound-Agent-only GET (never a redacted generic Source response), scans with the existing bounded-memory `InventoryScanner`, and rechecks Source revision, rules, Root and login identity before displaying results.

Only file count, directory count, scanned/ignored bytes, ignored-item count, skipped unsafe-entry count and completion status reach Renderer. No raw local path, per-file listing, credential, Root ID/fingerprint, raw filesystem errors or per-item failures enter the preview DTO or Web/other-Desktop B-scope reads. The scan is deliberately **not** a formal SourceRun, saved journal or cloud operation. A canceled, timed-out, changed-device/Source/Root or partial scan reports no successful result.

Dialog unmount, account/server change or explicit close calls Electron Main's preview AbortController keyed to the invoking webContents and a fresh request ID; the AgentIPCClient propagates its AbortSignal to HTTP and Go's `Request.Context()` aborts scanning. The Agent has a 35-second hard scan deadline and the Desktop HTTP client 40 seconds. This is request-scoped work, not a durable Task Center job. No `local_folder` activation, upload, CAS commit, Mirror missing/deletion evidence, saved-schedule execution, watcher or NAS integration is enabled; `MissingInferenceSafe=false` remains mandatory. Actual Windows/Linux 1k/10k/100k and >=4GiB physical acceptance remains open.


## L03-D2b2a: Source-revision-fenced local advisory generation manifest (merged #1397)

An authorized native Agent may **prepare** an advisory reconciliation generation from two independently verified complete `CURRENT/PREVIOUS` filesystem inventories. `PublishLocalReconcileEvidence` checks the Root grant, consumes the existing bounded disk-spooled `StreamInventoryGenerationDelta`, verifies both snapshots again, and publishes a compact, sealed `ADVISORY.json` summary under `localpush/journals/<scoped-key>/reconcile-evidence-v1`. This directory is **Agent-private local configuration state, not Server storage**. It is created with 0700 permissions and contains a 0600 file; no raw Root path, account name, file lists, content bytes, credentials or Server SourceItem IDs are written. The manifest contains only the immutable generation names and SHA-256, private Root/device/scope fingerprints, Source revision, bounded aggregate counts, and checksum.

Publish uses a 0700 exclusive directory lock to reject concurrent writers, fsyncs the temporary manifest and uses atomic rename, with directory fsync on Linux. A crash before the rename leaves only a discarded/ignored temporary file and cannot turn incomplete data into a committed generation. A crash leaving the exclusive lock fails **future publishing closed** until operator-verified cleanup; already published read-only evidence remains readable. Same revision+same generations is idempotent; stale or decreasing Source revisions, a changed Root, tampered/truncated JSON, changed/corrupt snapshots or incomplete/cancelled scans fail closed. `LoadLocalReconcileEvidence` separately revalidates Root, input Source revision, both snapshots and the manifest seal on every read.

**Security boundary:** the revision is a caller-provided *fence input*, not a Server-authenticated ownership proof. The checksum detects accidental corruption but is not a keyed device signature or remote authorization. The persisted counts are **not** a SourceItem-to-PathKey mapping, `SourceItemAlias`, a confirmed rename, planner checkpoint, missing-file proof, or a `SyncRun`. `Authoritative=false` and `MissingInferenceSafe=false` are enforced on read/write. No Agent IPC, Web/Mobile read contract, CAS bytes, upload, Source activation, scheduler, watcher, Mirror delete or NAS Push is added. Next L03-D2b2b must bind immutable path/identity candidates to Server-authoritative SourceItem IDs and Source revisions through an owning-device authenticated protocol with conflict/replay fencing before L03-E–G execution.


## P0-C4c2 own-Desktop explicit local inventory snapshot (implementation pending PR acceptance)

The verified owning Desktop can now explicitly request a **local-only**
metadata snapshot with native file-identity observations via the private,
authenticated Agent `POST /v1/device-backups/local-snapshot`. It verifies the
bound paused local Push Source, exact local Root grant and OS-held device
credential, Source revision and **private** saved ignore rules before scanning.
It repeats protected rule/revision/account validation before committing the
existing crash-safe 0700/0600 CURRENT/PREVIOUS journal, and checks the saved
CURRENT SHA-256 afterwards. Cancel, partial scan, missing/changed Root and
failed validation never intentionally advance a partial journal. Closing or
switching the Desktop view aborts Electron HTTP and the Go request context.

Only completed aggregate counts and a boolean indicating whether an older
generation verified reach the owning Renderer; no path, item listing, Root
identity or credential is returned. The snapshot persists **locally**, may
still exist when a revocation happens immediately after its atomic local
commit, and confers **zero** Server SourceRun, SourceItem, Node, alias, CAS,
backup execution or Mirror deletion authority. It is a prerequisite for
later generation evidence, not a claim of upload success. Existing
source/Run activation denial and NAS/Pull behavior are unchanged.

Full exact-head CI, Windows/Linux physical 100k scaling, >=4GiB and GitLab
validation are separate and **not yet claimed** for this stage.

## P0-C4c3 owning Desktop local two-generation delta (merged #1411; 76-job exact-head CI green)

The verified owning Windows/Linux Desktop can explicitly compare its two
previously saved and independently verified complete CURRENT/PREVIOUS local
Root inventories. A distinct authenticated loopback
`GET /v1/device-backups/local-delta?source_id=` requires the OS-held enrolled
device credential, exact paused local Push Source and revision, saved private
rules, matching native Root grant and unchanged account/Server session. The
existing 64-bucket bounded delta reader verifies both generations and does
not publish persistent evidence. The Agent rechecks authority after reading.

The Renderer receives only allowlisted Source ID/revision and aggregate counts:
`previous_items`, `current_items`, `added`, `changed`, `metadata_stable`,
`absent_candidates`. No filenames, paths, native identities, Root credentials,
fingerprints, raw errors, or candidate arrays are available through Renderer,
Web/Mobile Web or foreign Desktop. Electron Main registers an isolated
per-webContents AbortController before Agent startup; cancellation propagates
to Go's request Context. Missing, changed or corrupt generations fail closed.

`authoritative=false` and `missing_inference_safe=false` are mandatory.
An absent candidate is **not** cloud deletion evidence, stable metadata is
**not** content equality, and this view is not a backup, confirmed rename or
SourceItem/alias mapping. It never triggers upload, CAS/Node writes, SourceRun,
saved schedules, watchers, NAS controls or Mirror deletion. Physical 100k/4GiB
acceptance and GitLab validation are not claimed for this PR.


## L03-D2b2b1 · Owning-Agent-only bounded SourceItem identity lookup (merged #1417; 76-job CI green)

The Server exposes `POST /api/v1/sources/:id/local-identity/lookup` to the
**authenticated, registered, unrevoked bound owning Agent**, not to Web,
Mobile Web, foreign Desktop or generic Source clients. It requires the JWT,
OS-held device credential, exact Root ID/fingerprint and `If-Match` Source
revision. The device → Source → binding proof is verified under a DB
transaction, with the Source paused and limited to `local_folder` Push.

The request contains only 1–128 already normalized opaque external identity
keys and is capped at 80 KiB. The response contains only the Source ID,
revision, request count and indexed **existing SourceItem IDs**; it never
echoes identities, file paths, native filesystem keys, Node paths, secrets or
raw failure records. Canonical IDs and same-Source `external_id` aliases are
resolved, while conflicting canonical/alias claims, stale revisions, revoked
credentials, wrong Root and cross-owner lookups fail closed. It does not
invent an identity for an unknown key. Results are point-in-time only and
are expressly `authoritative=false` for any mutation and
`missing_inference_safe=false`. Future reconciliation MUST verify every
identity again inside the write transaction before assigning or promoting
any alias.

This stage does not persist candidate-to-SourceItem links, source aliases,
run checkpoints or content observations; it does not activate local Push,
perform CAS uploads, move/delete cloud Nodes, infer Mirror deletion, register
an Agent IPC method, or expose a Renderer control. The existing Push denial
remains. Tests cover bounded validation, owner/device/Root/revoke/revision
fencing, alias collisions, and no Source/Run/alias writes. Actual real-device
100k and ≥4GiB E2E, auto schedules and GitLab validation are not claimed.

## L03-D2b2b2a · Persist private advisory SourceItem reconciliation evidence (PR verification)

The owning Agent may stage a **single conservative regular-file native-rename
candidate** against one previously synced and still live SourceItem. Its POST
`/api/v1/sources/:id/local-identity/evidence` requires the same owner JWT,
unrevoked OS-held installation credential, exact bound Root ID/fingerprint and
If-Match Source revision as other protected local Source mutations. The Server
repeats device -> Source -> binding locks in the same PostgreSQL transaction,
requires the Source to remain paused and the existing SourceItem to be synced
with an owned, undeleted, revision-matched file Node.

A valid 8 KiB-bounded request contains SourceItem ID; independently identified
PREVIOUS/CURRENT inventory SHA-256; old/new Root- and path-scoped SHA-256
keys; matching native identity keys; both strong-identity flags; and link
count=1 in both generations. The Server **recomputes the old path key** from
its existing SourceItem path and authenticated Root ID. No unverified or
arbitrary old path key may claim a different remote item. Canonical and alias
namespace collisions fail closed.

A separate private `xd_local_source_item_evidence` table records the
Source/device/Root/revision, snapshot digests and candidate keys. Unique
generation+item and generation+destination constraints permit exact idempotent
replay while denying two destinations for one item or two items sharing a
destination in the same generation. No raw local paths are stored in this
table or echoed in the response. The response contains only Source/item/
evidence IDs, revision, created/replayed metadata and explicit
`authoritative=false`, `missing_inference_safe=false`.

**Critical safety distinction:** the Server does not possess or independently
attest the Agent's private journals. Strong native-key flags and generation
SHA-256 values are caller assertions until an owning Agent replays its
independently verified complete local generations. This record is advisory
staging only; it is **not** a `SourceItemAlias`, canonical identity promotion,
successful upload, content-equality proof, SourceRun, Node move or deletion
evidence. Existing Planner and SourceItem identity resolution NEVER consult
the staging table. A separate, transactionally authorized promotion must
re-verify live Root/source generations, SourceItem/Node revisions and alias
conflicts before any actual identity mutation. No Web, Mobile Web, Desktop
renderer or Agent IPC control is added in this stage. Local Push activation
and all Mirror remote deletion remain denied. Real 100k/4GiB device tests,
auto scheduling and GitLab validation are not claimed.


## L03-D2b2b2b · Owning-Agent provisional native-rename evidence staging (merged #1429, CI green)

The owning Windows/Linux Agent has a private, **non-IPC** preparation
primitive for two complete local inventory generations: it first checks the
paused Source, exact OS-held device secret, live Root grant, private ignore
rules, Source revision and account session. It publishes/loads the existing
sealed advisory generation, dry-runs *all* native rename hints, and only then
looks up old/new Root-scoped file path keys in bounded 64-hint/128-key batches.
Ignored files, weak identities, hard links, collisions and unmatched paths
are never submitted as established renames. Existing synced SourceItems may
receive **only** private provisional evidence via the bound-device endpoint,
which transactionally rechecks ownership/revision and Node identity. Local
heads and saved rules are rechecked after staging. A late failure can leave
some advisory rows; exact replay is safe and *no* SourceItem or alias is
mutated.

This helper is intentionally **not yet wired to an executable job, scheduler,
Desktop button, Web route or public Agent HTTP operation**. The evidence is
not attestation of remote file content or a cryptographic proof of physical
machine identity. SourceRun activation, CAS transfer, authoritative alias
promotion, cloud rename, Mirror deletion, trusted heartbeat and native 100k/
4GiB acceptance remain blocked until later separate work. CI/merge/GitLab
status must be recorded independently.


## P0-C4c4: manual owning Desktop advisory rename evidence (merged #1435, 76-job CI green)

After two independently verified complete local inventory generations, an
explicitly confirmed, credential-verified owning Windows/Linux Desktop may
invoke one capability-gated authenticated local Agent POST. The renderer
supplies only a positive Source ID and a random one-shot request ID.
The Agent loads the OS-enrolled device token, exact Root approval, private
saved ignore rules and current Source revision itself and checks them before
and after the advisory staging operation. Neither a browser nor the other
Desktop logged into the same account receives this private capability.

The shared page only shows a button for the verified local non-revoked
device; Web/Mobile Web remain strictly owner-readable observers.
The Agent IPC returns only Source ID/revision, advisory hints, existing
SourceItem matches, unmatched hints, newly stored/replayed evidence counts,
and explicit complete=true, authoritative=false and
missing_inference_safe=false flags. No raw local paths, device tokens,
native keys, Root fingerprints, individual SourceItem IDs, error detail or
arbitrary original filesystem metadata enter renderer/foreign-device DTOs.

Opening the dialog does NOT make an outbound write. Explicit manual
confirmation starts one cancellable request with a per-webContents request ID;
closing the dialog or switching datasource aborts the Electron request,
Agent HTTP and Go Request.Context. Partial failure may leave only inert
Server-side evidence in its already private, idempotent staging table;
there is never an accepted alias or cloud operation.

This does NOT make local Push executable: SourceRun activation, CAS upload,
Node commit/rename, authoritative alias promotion, background scheduling,
Mirror deletion, NAS Push, physical 100k/4GiB and GitLab delivery are
separately pending. CI and physical acceptance must not be conflated.


## P0-C4c5a · Native owning-Agent recovery of persisted advisory evidence (merged #1437; 76-job full CI green)

After an explicitly staged, complete two-generation local inventory, a future
owning Agent can safely inspect only the number of provisional server evidence
rows that match its current private CURRENT/PREVIOUS digest pair. The Server
read-only POST is limited to 512 request bytes and requires owner JWT plus
enrolled, unrevoked device secret, exact bound Root identity, current Source
revision and paused status, all rechecked in one DB transaction. It counts
only rows matching source/revision/device/Root/fingerprint and both generation
digests. The response has only Source ID, revision, nonnegative row count,
authoritative=false and missing_inference_safe=false. The Server does not
independently attest local journals: the Agent verifies its own Root, saved
ignore rules, sealed generation and session before and after the read. Count
zero is never proof of deletion or an empty Root. No path, SourceItem ID,
native key, Root, secret or raw failure is returned.

This bounded phase has **no new Desktop IPC/Preload/Renderer/Web exposure**.
In particular, the existing Device Backup owner-read DTO and foreign-device
permissions do not change. The new private Agent helper is groundwork for a
future separately tested local readback UI and execution recovery, not an
uploader. It cannot activate a SourceRun, promote an alias, commit CAS/Nodes,
infer Mirror deletion or run a watcher/saved schedule. Full exact-head CI,
native 100k/4 GiB acceptance and GitLab delivery are independent gates.


## P0-C4c5b · Own Desktop private evidence recovery view (merged #1441)

The existing Agent-private, generation-fenced count readback (#1437) is now
exposed through a **separate authenticated owning-Agent GET**
`/v1/device-backups/local-evidence-summary?source_id=N` with a strict
single positive Source ID parameter and no request body. The Agent loads its
own OS-held registration credential and current native Root grant; the
renderer cannot supply credentials, Root, fingerprints, snapshot digests or
file lists. The Agent checks protected ignore rules, paused Source/revision,
complete immutable local journal generations, and current account session
before and after the Server-side bounded count. The Server repeats the
device→Source→Root authorization inside the count transaction and returns
only Source ID, Source revision and nonnegative advisory record count.
Cancellation propagates Electron request ID → HTTP AbortSignal → Agent
Go Context; no durable background run is aborted by closing the dialog.

Desktop Main/Preload and the shared MUI page offer this **read-only** action
only for the credential-verified, unrevoked owning device. Other Desktop
installs under the same account and Web/Mobile remain B-scope observers;
their DTOs do not gain source_item_id, paths, device tokens, native identity,
Root grants or any mutation action. Dialog close, account/server change or
source deselection aborts the pending read and never displays late counts
from a previous datasource. A zero count is **not** a proof of an empty
Root, lost backup, missing remote files, or a Mirror deletion condition.
The UI must explicitly say advisory count, not upload/rename success.

No SourceRun activation, upload, CAS/Node mutation, alias promotion, watcher,
scheduled execution, NAS Push or Mirror remote deletion is introduced.
Native Windows/Linux 100k and >=4 GiB physical acceptance and GitLab
delivery remain separate gates.

## P0-B3 · Authenticated Agent presence heartbeat (merged #1445; 76-job CI green)

This phase adds only **device-credential-observed presence** for an already
enrolled Windows/Linux Agent. The Agent sends a bounded, no-body POST
`/api/v1/devices/self/heartbeat` at startup and every 60 seconds while its
current account/Server session remains valid. It reads the installation ID
and secret from local OS-protected enrollment; viewing a device or running an
old Agent never enrolls or repairs a device. There is no Web/Renderer IPC for
sending this heartbeat.

The Server demands the current owner JWT, the exact enrolled device UUID and
secret, then rechecks unrevoked credential possession under the device row's
transactional UPDATE lock. It changes only `heartbeat_at`, `last_seen_at` and
`updated_at`; it does not bind a Root, touch any Source/SyncRun, trigger a
backup, authorize cancellation, or activate the scheduler. The endpoint has
no input body or query and returns only HTTP 204 with `private, no-store`.

The existing owner-scoped, redacted GET `/device-backups` derives
`connection_state` from **only** the new Server-observed `heartbeat_at`: fresh
within 150 seconds = `online`, previously observed but expired = `offline`,
missing/legacy/future-skewed/revoked = `unknown`. A stale `LastSeenAt`,
registration, past sync, display name or open Desktop window cannot establish
presence. Web, Mobile Web and foreign Desktop may observe the same state,
but do not gain a local Root, secret, or backup operation. The shared MUI page
renders these states without guessing from activity timestamps; a refresh
retrieves the current server observation.

This proves use of the existing enrolled secret, **not cryptographic
attestation of physical hardware**, a live authenticated filesystem Root,
successful backup execution, durable scheduling, or transport readiness.
Revocation fences subsequent heartbeats but cannot alone guarantee immediate
termination of in-flight uploads (none are enabled in this phase).
Source activation, real CAS upload/commit, identity promotion, Mirror delete,
automatic schedule, NAS Push, 100k/4GiB physical acceptance and GitLab
delivery remain separately blocked. PR #1445 passed the full 76-job exact-head CI and is merged; the related
work branch was automatically removed. This is presence only, not Push execution.

## L03-D2b2c1 · Owning-Agent private paginated advisory reconciliation readback (merged #1451; 76-job CI green)

After #1422/#1429 persisted candidate evidence and #1437/#1441 added an
own-device **count-only** recovery view, the owning native Agent needs a
bounded way to replay individual candidates when a later executor resumes.
This phase adds a dedicated read-only POST at
`/api/v1/sources/:id/local-identity/evidence-page` (POST because the
private generation digests must not enter a URL). It is not a general Source
or Web read contract.

The Server requires the owner JWT, registered and unrevoked owning Agent
credential, exact bound Root ID/fingerprint and current `If-Match` Source
revision. The authenticated device -> Source -> Root proof is rechecked
inside the same transaction as the query; only a **paused** local-folder
Push Source is eligible. A strict <=512-byte body specifies two distinct
lowercase SHA-256 generation digests, 1–64 rows and `after_evidence_id`.
The SQL keyset is ordered by immutable evidence ID with `LIMIT + 1`, and
is restricted to the exact source, revision, device, Root, fingerprint,
PREVIOUS and CURRENT generation. Replies are no-store, bounded, and contain
only existing evidence IDs, SourceItem IDs and hashed previous/current
path/native-identity keys for the **owning Agent**. No raw local file names,
absolute paths, Root IDs, tokens, freeform errors or credential material.

The dedicated Go Client validates the request, bounded reply size, exact
Source/revision, strictly increasing cursor, SHA-256 key syntax, duplicate
SourceItem claims and both permanently false safety flags. The native
Agent-private helper loads its OS credential, current bound Root grant,
saved rules and two sealed inventory generations before the read and
rechecks the generation, rules and account session afterward. It is
**not registered as Electron/Preload/Desktop IPC or exposed to Web,
Mobile Web or any foreign Desktop**. PostgreSQL tests exercise owner/other
account, same-account foreign device, forged credentials and Root,
revocation, stale Source revision, generation isolation, malformed/oversized
bodies, keyset exhaustion and absence of SourceRun or evidence writes.

Every returned row is still **advisory**, even after local generation
verification. The Server does not independently attest native files, and
staged evidence is not a commit token or content-equality proof. A later
explicit transaction must re-verify canonical SourceItem and Node revision,
alias collisions, live Root/source, and actual content before promoting
identity. No `SourceItemAlias` or SourceItem move, upload, CAS/Node
mutation, SourceRun activation, scheduled execution, Mirror deletion or
NAS Push is enabled here. The 100k and >=4GiB physical tests are still L07.

## L03-D2b2c2a · Owning-Agent server-side advisory candidate preflight (merged #1456; 76-job CI green)

The previous L03-D2b2c1 stage (#1451, merged after its own 76-job exact-head
CI) delivered encrypted-channel, bounded, owner/device/Root/generation-scoped
**private candidate pagination**. This step checks the canonical Server
identity currently associated with those records before any future mutation.

The owning Agent may send a strictly bounded POST to
`/api/v1/sources/:id/local-identity/evidence-preflight` with the two
opaque generation SHA-256 checksums and 1–64 strictly increasing existing
evidence IDs (body <= 2 KiB). The current account JWT, OS-enrolled
non-revoked device token, bound Root ID/fingerprint and `If-Match` Source
revision are mandatory. Authorization is repeated transactionally in the
device -> Source -> Root order; only **paused** `local_folder/push` is
eligible. Every requested row must still belong to exactly that Source,
revision, device, Root and generation; unknown, conflicting or stale
candidate IDs fail the entire batch closed.

Within that same **read-only** transaction, the Server locks existing
SourceItem, canonical/alias identity references and live owned file Nodes.
Each candidate's previous opaque path key must still be the canonical
external ID rederived from the saved normalized SourceItem relative path
and authenticated Root; its SourceItem must remain synced and bound to
an existing file Node at the exact saved Node revision. A proposed new
path key must not resolve to a different SourceItem or ambiguous alias.
Any old/new identity collision, foreign/dangling alias, missing/deleted Node,
stale revision or altered SourceItem prevents even a positive preflight.

The Server returns only source_id, revision, checked count and
`server_consistent=true` after checking *all* candidates, with
`content_verified=false`, `commit_supported=false`,
`authoritative=false` and `missing_inference_safe=false` fixed.
The private Go Client bounds/strictly validates requests and responses.
An **Agent-private, non-IPC helper** verifies native Root authorization,
private rules and sealed CURRENT/PREVIOUS snapshots before and after it
reads a <=64-item page and asks the Server to preflight those exact IDs.
No SourceItem IDs, hashed native keys, filesystem paths, Root fingerprints,
credentials or actions are exposed to Web/Mobile Web/other Desktop.

**This is only a point-in-time Server DB consistency observation.** It
neither independently checks current local file bytes nor proves uploaded
CAS content; even an eligible result MUST NOT be reused as commit authority
or persisted as a SourceRun checkpoint. A future write transaction must
repeat the complete proof and validate content afresh. In this phase
there is **no** alias promotion, Node/SourceItem/CAS/SourceRun write, local
Push activation, resumed uploads, Mirror delete, watcher, auto-schedule,
remote control or new NAS agent. Real 100k/4GiB native-device acceptance
remains unmeasured. Exact-head full GitHub CI, actual merge and branch
cleanup are separate required gates.

## L03-D2b2c2b1 · Owning-Agent live original file hashing against both sealed generations (GitHub PR verification)

The preceding stages are merged: #1451 supports credential/Root/revision-
fenced private advisory pagination; #1456 supplies server-side SourceItem,
Node and alias consistency preflight. Neither alone proves that the file
still on the local disk matches the recorded native identity or its bytes.

This phase adds an **owning native Agent-only** bounded `HashCurrentLocalEvidenceBatch`
primitive (1–64 claims). Each candidate has only the opaque PREVIOUS/CURRENT
path SHA-256 keys and a root-scoped native identity key; it never accepts a
caller-supplied absolute local path or a Web/Renderer file selection. The
Agent authenticates the OS-held device credential, bound Root and Source
revision, reloads private saved ignore rules and a sealed two-generation
advisory manifest, reads a <=64-item Server candidate page, and checks the
entire page with the already implemented Server consistency preflight.

The local verifier streams both complete, SHA-256-checked private journals
in <=500-item callbacks. Every claimed strong native identity must match
**exactly one nonignored, unique-single-link regular file in each generation**
at the two expected Root-scoped hashed paths. No directory, symlink,
hard-link ambiguity, missing current file or unrelated native ID can be
accepted. Only after both generations completely validate does the Agent
hash each current original using the existing secure Root-scoped file-open
primitive and 256-KiB bounded reads. The existing hasher checks file type,
size, mtime, native identity and OS file handle before/after, detects Root
swap, and propagates Go context cancellation. The entire batch fails closed
on any error; no partially verified result or cache is returned. After
hashing, the Agent repeats the Server preflight and reloads the local
manifest and saved rules/session so revocation, Source/Node/alias changes,
snapshot rotation or account changes invalidate the response.

The per-file SHA256 digests exist only ephemerally in the owning Agent.
The private returned summary contains counts and summed hashed bytes,
never local filenames, hashed path keys, SourceItem/Node IDs, original
file contents, native credentials or per-file hashes. It is NOT wired to
the renderer, Electron Preload, Web/Mobile Web, foreign Desktop or a
background executor.

**Crucial safety limit:** `LocallyHashedFiles` and `LocallyHashedBytes`
mean only that the on-disk current file bytes were read and SHA256-hashed
under the current native Root grant. The values are **NOT compared with
the already committed Server File/FileVersion/CAS digest or physical
cloud blob**. `CloudContentVerified`, `ContentVerified`,
`CommitSupported`, `Authoritative` and `MissingInferenceSafe` must
therefore all remain **false**. A later phase must cryptographically
compare current local bytes against the trusted stored cloud content
metadata and recheck version/revocation/root proof within an eventual
write transaction. No SourceRun activation, SourceItem alias promotion,
Node/CAS modification, upload, Mirror deletion, watcher, schedule or
NAS Push is enabled here. Native physical 100k/>=4GiB tests and GitLab
delivery are not claimed.
