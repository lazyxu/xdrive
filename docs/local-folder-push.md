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

## L03-D2b2c2b1 · Owning-Agent live original file hashing against both sealed generations (merged #1460; 76-job CI green)

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

## L03-D2b2c2b2a · Strict owning-Agent File / FileVersion / CAS metadata cross-check (merged #1471; exact-head CI green)

After L03-D2b2c2a (#1456) verified SourceItem, Node and aliases and
L03-D2b2c2b1 (#1460, merged following 76-job exact-head full CI)
independently streamed SHA256 of the actual current file on an OS-approved
Root, the owning Agent can perform a narrowly scoped **read-only,
point-in-time cloud DATABASE metadata** equality check. This is not a
claim about actual physical object bytes.

A dedicated private POST
`/api/v1/sources/:id/local-identity/evidence-cloud-metadata` accepts
only the sealed CURRENT/PREVIOUS generation digests, strictly increasing
evidence IDs (1–64), current local-file SHA256 digests and sizes. The
request is <=16 KiB, with no OS path, Node/SourceItem ID or cloud storage
key. Owner JWT alone does NOT suffice: the Server demands the owning
device's unrevoked OS-stored token, current bound Root and fingerprint
plus the exact If-Match Source revision. Only a **paused**
`local_folder/push` Source is admitted.

Within a single read-only PostgreSQL transaction, the Server repeats
the device->Source->Root proof under transactional locks and matches
**every** evidence ID against its source/revision/device/Root/both
generations. It rechecks stable synced SourceItem and old/new canonical
and alias identity conflicts (including the saved normalized original
path digest and live owner-scoped Node revision). A bounded single JOIN
of current `Node`, `File`, **exact-revision FileVersion**, and
`ContentBlob` must locate exactly one row per claim. SourceItem/File/
FileVersion/ContentBlob sizes and SHA256 must all exactly match the
newly claimed local digest. The File, version and blob must all refer
to the canonical SHA256-addressed object-storage key, with
`ContentBlob.state=ready` and positive refcount. Legacy files with
missing/unverified hashes or versions, deleted/stale Node, changed
content/version, bad CAS state/key/refcount, identity collision and
revoked or other-device claims fail the entire batch closed.

The reply is narrow, no-store and ETagged: only Source ID/revision,
checked count and `cloud_metadata_matched=true`; permanently
`cloud_bytes_verified=false`, `content_verified=false`,
`commit_supported=false`, `authoritative=false`,
`missing_inference_safe=false`. No Node ID, relative/absolute path,
per-file hash, raw fingerprint, storage key or secret is serialized.
A strict Go Client validates the entire response, including rejecting
any falsely claimed physical-byte or commit authority. The Agent
privately calls this after it hashes the current files, then performs
another independent Source/Node/alias preflight and rechecks its sealed
inventory generations, saved local rules and account/device session.
Only aggregate matched counts are retained inside Agent memory.
No new Desktop/Preload/Renderer/Web/Mobile Web/foreign-device API.

**Safety and next delivery:** this check compares an Agent-supplied
current SHA256 with xDrive's *existing verified/canonical database
metadata*. The Server does NOT open or rehash the physical remote CAS
object; a local-client digest is not hardware attestation. Positive
metadata equality cannot be used as a commit token, permission to
rename, proof of physical durability, Mirror missing inference, or
SourceRun checkpoint. Actual cloud storage object streaming/verification
and transaction-bound identity advancement remain subsequent stages.
No local Push activation, uploads, CAS/Node/SourceItem/alias writes,
watcher, schedule execution, NAS Push or deletion is enabled.
The 1k/10k/100k and >=4GiB native-machine E2E and GitLab delivery
remain independently unverified.

## L03-D2b2c2b2b · Bounded actual CAS byte observation (merged #1475; full 97-check CI green)

The preceding cloud **metadata** equality stage (#1471) is merged after
its own 96-check exact-head CI (25 success, 71 conditional skips, zero
failures). The next deliberately bounded read-only substage adds an
owning-Agent-only `POST /api/v1/sources/:id/local-identity/evidence-cloud-bytes`.
This is **not** an upload API or a general file-integrity scanner.

- Accept only one previously persisted, ordered evidence ID, both sealed
  inventory digests and the Agent's freshly hashed local SHA256/size. The
  request uses the same <=16KiB strict JSON schema and existing authenticated
  owner JWT, unrevoked device credential, verified bound Root/fingerprint,
  `If-Match` revision and *paused* local_folder/Push gate as #1471. No
  renderer-supplied storage key, file path, SourceItem ID, Node ID or URL.
- The Server first repeats the complete transaction-scoped SourceItem/Node/
  File/exact FileVersion/ready CAS metadata and identity-alias checks from
  #1471, obtains the *Server-derived canonical* CAS key and closes all DB
  locks. Only then does it open one real object through the existing Store
  interface. Read size <=64MiB, SHA256 using a <=256KiB buffer, compare full
  physical bytes, fail on missing, corrupt/truncated/oversized/nonregular
  objects, and honor Go context cancellation with a 90-second deadline.
  Do not hold a transaction open across filesystem I/O.
- After the physical read, redo the **entire** device->Source->Root and
  SourceItem/Node/File/FileVersion/CAS proof transaction. Any revocation,
  stale revision, swapped object metadata, alias conflict or incomplete read
  fails closed. This is only a point-in-time object observation: even a
  successful repeat is **not** durable object storage attestation, protection
  against later object replacement, or an eventual write-transaction proof.
- Reply is private/no-store, revision-ETag, with
  `cloud_metadata_matched=true`, `physical_cas_matched=true` and a checked
  count of ONE. **All authority flags remain false**, including
  `cloud_bytes_verified`, `content_verified`, `commit_supported`,
  `authoritative`, and `missing_inference_safe`. Never serialize path,
  CAS key, stored SHA, token, Root fingerprint or per-file identity.
- The native Agent preflight uses this private Go Client to sample at most
  its first candidate when size <=64MiB, only after the real local hash and
  metadata match; remaining candidates and all large objects remain
  physically **unverified**. The Agent tracks a private observed sample
  count, never a verified complete page or commit token. There is NO new
  Desktop IPC, Preload, Renderer, Web or foreign-device capability.
- Unit and PostgreSQL integration tests must include real Store.Put/Open,
  valid bytes, same-size corruption, missing/truncated/oversized files,
  wrong or foreign device, wrong revision, account isolation, unexpected
  response authority, no path leakage and cancellation. Authoritative
  acceptance requires the new exact-head PR CI including final-gate.

**Remaining:** a complete, load-budgeted multi-object verification protocol,
>=4GiB and 1k/10k/100k physical scaling, crash/replay fencing of physical
bytes across an eventual write transaction, durable identity advancement,
resumable upload, SourceRun executor, watcher/scheduler/offline recovery and
Mirror two-scan/24h/trash-only deletion safety. Push activation stays denied.
No GitLab delivery or native-device physical throughput measurement is
claimed by this substage.

## L03-D2b2c2b2c · Atomic bounded multi-object physical CAS observation (merged #1480; 97-check CI green)

The prior L03-D2b2c2b2b (#1475) is merged after full exact-head CI:
97 checks, 25 success / 72 conditional skips / zero failures, including the
final-gate; its remote work branch was removed by the successful cleanup
workflow #38198963997. This continuation **extends the same private
Server/Agent protocol** without enabling physical Push uploads.

The owner JWT plus currently enrolled unrevoked native Agent credential,
exact Root and fingerprint, paused local_folder/Push Source, and If-Match
Source revision are mandatory. The request accepts ONLY 1–4 strictly
ascending existing private evidence IDs, sealed PREVIOUS/CURRENT SHA256
generation values, and newly computed *local* SHA256 plus size per item.
No filesystem path, Node/SourceItem ID, object key, URL or credential
may be chosen or returned by Renderer or Web.

The Server caps the **sum of all submitted object sizes** at 64MiB, not
just the largest object; four 64MiB objects are explicitly rejected.
It runs the existing full device→Source→Root→SourceItem→Node→
File/Version/CAS/alias transaction proof once for the entire batch, releases
all database locks, opens each Server-derived canonical CAS object
**sequentially** through the existing Store, and hashes every physical
object with a <=256KiB buffer. A single 90-second request deadline and
Go context cancellation bound total work. Missing, changed, corrupt,
truncated or oversized physical bytes fail the whole operation; no
per-item or partial-success response is emitted. A second complete
transactional proof must pass for *every* object after the I/O, with the
identical ordered Server-derived object metadata. No Store read takes place
inside a database transaction, and there are no SourceItem/Node/CAS/Run writes.

Existing single-item Go Client calls remain valid. The new strict batch
method rejects empty, unordered, duplicate, too-many, oversized or
over-budget requests locally and validates the entire private response.
The owning Agent may select up to four eligible ordered candidates
within the cumulative 64MiB budget from a previously hashed and
metadata-checked evidence page; objects excluded by the budget and other
pages remain **not physically verified**. A successful result exposes
only private aggregate sampled file/byte counts inside Agent memory,
not a file listing, hash list or completion proof. No new IPC,
Electron Preload, Renderer, Web/Mobile or foreign Desktop capability.

The no-store reply has source_id, revision, checked count and
`cloud_metadata_matched=true`, `physical_cas_matched=true`; all
`cloud_bytes_verified`, `content_verified`, `commit_supported`,
`authoritative`, `missing_inference_safe` remain **false**.
Tests include valid two-object Store reads, corruption of the second
object (whole batch fails), one-item legacy compatibility, invalid
5-object/over-64MiB batches, unauthorized device/Root, account scope,
stale version and strict client response validation. CI and native
device tests are independent gates, not assumed.

**Still NOT done:** verifying all 64 page items or the whole 100k library,
4GiB streaming, durable proof across subsequent writes, SourceItem alias
promotion, Planner, upload/resume/commit, SourceRun activation, watcher,
background schedule or offline recovery; Mirror still requires two full
safe scans/24h/trash-only, and NAS Push remains a placeholder.
Full GitHub exact-head CI is required before merging this phase.
No GitLab delivery or physical 1k/10k/100k benchmark is claimed.

## L03-D2b2c2b2d · Bounded multi-batch Agent-private physical page window (merged #1484; 97-check CI green)

The prerequisite physical-object **Server** batch extension (#1480,
L03-D2b2c2b2c) is merged following exact-head [Actions #38199969661](https://github.com/lazyxu/xdrive/actions/runs/38199969661):
97 checks, 25 successes, 72 conditional skips, zero failures and a green
`final-gate`. Its redundant branch was removed by cleanup
[#38200716701](https://github.com/lazyxu/xdrive/actions/runs/38200716701).
No new Server route, CAS write path, Web API or Desktop IPC is introduced here.

This stage removes the owning native Agent's hard stop after the first
4-object sample, while keeping the **existing** Server 1–4-object /
64MiB / 90-second / device-and-Root-fenced read API unchanged.
For one *already locally SHA256-verified* and current metadata-checked
<=64-candidate advisory evidence page, the Agent deterministically plans
up to **four sequential Server calls**, each for <=4 ordered items and
<=64MiB, with a total **16 sampled items and 256MiB** upper bound.
All other items, including each item >64MiB, explicitly remain
UNOBSERVED. A zero-byte object counts toward the 16-item ceiling.
Claims are never reordered or manufactured; malformed/nonascending IDs
or negative sizes fail closed. No state is cached between requests.

Before the first physical read, the Agent validates the **complete**
four-call plan, including cross-batch increasing evidence IDs,
per-batch and aggregate bytes, and item limits. A malformed later batch
can never cause an earlier physical request. Batches execute
**sequentially** through the same authenticated owning-Agent Go Client
under the existing 300-second overall private preflight context.
Every request repeats the Server's transaction-scoped
device->Source->Root->SourceItem/alias->Node/File/FileVersion/ready CAS
proof before AND after Store.Open/SHA256 reads. A failed, revoked,
stale, partially checked, canceled, mismatched or authority-elevating
later response fails the **entire** local page observation, returning
ZERO counts, never an earlier batch's partial success.

After all physical reads, the Agent repeats the original full-page
SourceItem/Node/alias Server preflight AND the full-page current
File/FileVersion/CAS metadata equality check, followed by local sealed
inventory, ignore-rule and account/Root/session revalidation.
The only additional Agent-private values are bounded aggregate
`PhysicalCASObservedFiles`, `PhysicalCASObservedBytes`,
`PhysicalCASUnobservedFiles` and `PhysicalCASBatchRequests`.
They never enter Electron IPC, Preload, Web/Mobile Web or foreign
Desktop. No per-file digests/paths/object keys leave the owning Agent's
private protocol; the Server response remains no-store, count-only,
and `cloud_bytes_verified=false`, `content_verified=false`,
`commit_supported=false`, `authoritative=false`,
`missing_inference_safe=false`.

Go tests cover 4x4 objects/256MiB, zero-sized 64-item page, oversized
local file skip, split batches by 64MiB, ordered IDs, malformed late
work before any read, second-batch corruption/authority escalation,
and cancellation after a successful earlier batch. The original
single-batch/physical Store/PostgreSQL CI is retained, along with
Desktop no-leak contracts and exact-head final gate.

**This is still a point-in-time, partial page SAMPLE, not an
entire-folder verification, reliable durability/commit token, or
permission to start Push.** The 64MiB per-object limit, 16/256MiB
per-page window and lack of a cross-page cursor/checkpoint leave
100k complete scans and >=4GiB originals unverified. Durable write
fencing, SourceItem aliases, Planner, resumable upload/CAS commit,
SourceRun, auto scheduler/watcher, offline recovery and safe Mirror
deletion remain separate L03-E–G/L05–L07 work. No GitLab delivery or
physical-device performance numbers are claimed.

## P0-C4c5d · Owning Desktop manual aggregate content preflight (merged #1493; CI success)

Prerequisite #1484 (L03-D2b2c2b2d) is **merged** after exact-head full
97-check CI (25 successful, 72 conditionally skipped, 0 failed,
`final-gate=success`), rebase merge commit
`b53dc5832c906592a528c04aa186c1a0d67410e5`.
Merged branch cleanup #38203813847 completed successfully.
The complete native SHA256 + File/FileVersion/ready CAS metadata + bounded
physical CAS observation currently exists only in the owning Agent.

This stage makes that genuine **read-only aggregate preflight** usable on the
owning Windows/Linux Desktop, as an explicit "本机内容一致性预检（不上传）"
action beside the advisory local evidence counts. It is NOT a general
user-facing cloud-object verification endpoint and is NOT available to
Web/Mobile Web or foreign Desktop. The 52px global App titlebar, full-screen
App Frame, two independent Push/Pull applications and shared backend
contracts remain intact.

- The Agent advertises `device-backup-local-evidence-preflight` only on
  supported native operating systems; a dedicated Desktop IPC **GET**
  `/v1/device-backups/local-evidence-preflight` accepts ONLY one numeric
  `source_id` and an optional numeric `after_evidence_id` within
  JavaScript safe integer bounds. It rejects body/unknown query inputs,
  unauthenticated callers and non-owning controller capability; the Agent
  itself enforces the enrolled unrevoked OS credential, exact local Root,
  Source revision, two sealed journal generations, local live original
  SHA256, whole-page Server identity/CAS metadata and per-object physical
  samples before returning success. No browser-supplied path, token,
  SourceItem ID, SHA256 or cloud key is accepted.
- An explicit **projection layer**, separate from the Agent-private
  `localEvidencePreflightSummary`, exports **only** Source ID/revision,
  checked/local-hashed/current-CAS-metadata counts, aggregate hashed and
  sampled bytes, physically sampled/unsampled counts, bounded HTTP batch
  count, advisory `has_more`/numeric next-page cursor, and false authority
  flags. Rejects impossible counts, mismatched Source, oversized or
  non-safe integer results, unexpected commit/content/deletion authority,
  invalid cursor and partial failure; never serializes source paths,
  native identities, per-file SHA256 or Root/device credentials.
- Electron main owns each request's AbortController, keyed by its renderer
  sender and UUID request ID. Closing the dialog, unmounting or account/
  server scope replacement aborts the Electron request and Go Context;
  a stale completion cannot repopulate a new datasource. Preload exposes
  only aggregate read/cancel, not the Agent-private cloud-bytes API.
- The shared MUI page renders the manual action **only if** current
  `verifiedLocalDeviceID` matches an active owner device containing this
  Source, and only if the native-only capability is present. The popup
  makes one 64-candidate advisory page request at a time, with an optional
  explicit **next page**, displays the 16-object/256MiB physical sampling
  ceiling and unobserved count, hides raw errors, and repeatedly states
  that neither a complete backup nor upload/rename/deletion permission
  has been established. Web/Mobile and foreign Desktop continue seeing
  owner-scoped, redacted **read-only** device information.
- Tests cover private GET/query scope, absent native capability, negative
  projection and unauthorized read, cancel reaching Go Context, and
  static Electron/Preload/shared UI boundary tests including account
  changes, no private byte/hash bridge and no Web operation.

**Scope of completion:** a manually useful per-page owning-Desktop
read-only consistency diagnostic, not an actual backup run. At most
16 existing stored CAS objects and 256MiB may be physically sampled
per 64-evidence candidate page; unobserved items and subsequent pages
remain unverified until separately checked. The UI cannot infer full
100k-folder verification or represent >64MiB individual originals
as physically checked. There is NO durable identity promotion, no
SourceItem/Node/CAS/alias writes, no real Push upload/recovery, no
SourceRun activation, no watcher, no automatic schedule, no NAS Push
manager, and no Mirror deletion. L03-E durable transactional identity
commit and L03-F/G uploads are separate future stages with independent
authorization, physical correctness and crash/replay tests. No GitLab
push, >=4GiB native transfer or 100k real-device benchmark is claimed.


## P0-C4c5e · Desktop manual preflight page/session consistency (PR verification)

After merged #1493 (owning-Desktop-only redacted manual preflight), this
read-only UI follow-up pins the first successful Source revision for an open
session. Later pages/retries of another revision are rejected, with a fresh
manual session required. Results are cursor-bound, preventing the previously
visible page from appearing under a newly selected page number. Switching
the authenticated Agent/server source drops prior counts and cancels
in-flight work.

The UI accumulates only validated aggregate page counters; retrying one
page replaces rather than doubles its count. It reports the number of
manually checked candidate pages and locally hashed / physically sampled /
UNOBSERVED files and bytes. Since each page is checked at a different
time, the sum is expressly NOT an atomic snapshot, complete cloud
verification, durable commit token or a 100k-folder acceptance claim.
Per-page 16-object/256MiB physical sampling and 64MiB individual-object
caps remain unchanged.

No Server/Agent transport, Root or device permissions, SourceItem/Node/CAS
write, local Source activation, uploader, watcher/schedule, Mirror delete
or NAS Push is added. Web/Mobile and foreign Desktop remain read-only.
Focused static regression is added; native real-device E2E remains
unmeasured. Exact-head GitHub PR CI is the merge gate; no GitLab delivery
is claimed for this phase.


## L03-E0 · Owning-Agent quarantined identity commit intents (merged #1502; exact-head 76-job CI green)

This is the **first deliberately non-authoritative durable write** on the path
toward L03-E identity commit. It stores at most 16 existing, ordered advisory
evidence IDs in \`xd_local_source_commit_intents\` as \`quarantined\`, with
Source ID, exact revision, owning device/Root/fingerprint, both sealed
generation digests, SourceItem ID, old/new root-scoped path keys and native
identity digest. The table is **not** a planner input, alias registry, commit
token, runnable queue, checkpoint or permission to delete remote files.

Only the registered/unrevoked owning Agent may use the private
\`POST /api/v1/sources/:id/local-identity/commit-intents\` endpoint. An owner
JWT alone, Web/Mobile Web and foreign Desktop (including same-account
Desktop B) cannot use it. The request has an exact If-Match Source revision,
bounded JSON with only two generation digests and 1–16 ordered evidence IDs.
The transaction rechecks device-first authorization, exact native Root,
paused local Push Source, persisted source/revision/device/generation evidence,
stable existing synced SourceItems, canonical old path digests, collision-free
alias namespace and live Node revisions. Only after validating the *entire*
batch does it insert idempotent quarantined rows. Same evidence replay yields
a count-only response, and a divergent replay or configuration/revoke/path
collision fails closed. A unique database index fences concurrent duplicate
evidence, SourceItem and destination claims.

All responses expose only Source ID/revision and quarantined/replayed counts,
with \`commit_supported=false\`, \`authoritative=false\`,
\`missing_inference_safe=false\`; private paths, root/device tokens, native
identities, digest/key material and item IDs remain undisclosed.

**No physical bytes are checked in this write.** Prior sample observations
are NOT transformed into durable content verification. This stage changes
*only* the quarantined intent table; SourceItem, SourceItemAlias, Node, CAS,
SourceRun, Mirror history and cloud objects are unchanged. The Server still
denies local-folder SourceRun activation. No Desktop/Web UI action or new
native Agent IPC/client call exists yet. A later owning-Agent private
transport plus independent L03-E1 transaction-bound verification is needed
before any alias promotion. L03-F/G uploader/resume/recovery, L05 scheduler
and L07 100k/≥4GiB physical E2E remain unimplemented.

Dedicated PostgreSQL integration tests assert owner A/foreign device B,
missing/forged/revoked proof, Root and revision mismatch, malformed bounded
requests, collision/replay, exact quarantine unique indexes and the absence
of canonical writes. GitHub exact-head complete CI with \`final-gate\` is
required before marking this phase merged; no GitLab pipeline or native
physical benchmark has been performed through this environment.


## L03-E0b · Owning-Agent private quarantine transport and local pre-write fencing (merged #1513; exact-head CI green)

**Prerequisite:** #1502 (L03-E0) passed exact-head GitHub CI [#38216448750](https://github.com/lazyxu/xdrive/actions/runs/38216448750), 76 jobs complete: 25 successful, 51 conditionally skipped, zero failures, final-gate success. The rebase-merge commit is \`a2d2836cb94fb9a61f0ece8549291db0dfa1fbfa\`; the related work branch was verified absent. L03-E0 is a separate private \`quarantined\` database relation, never a canonical alias/Node/CAS/Run update.

**E0b contract and scope:**
- Add a dedicated **Go Client** native-Agent-only \`QuarantineLocalSourceCommitIntents\` transport. The only payload is the two verified generation digests plus 1–16 strictly ascending persisted evidence IDs. Require nonempty local device/Root credential proof and exact Source If-Match revision; do not accept local paths, Root IDs from Renderer, arbitrary SourceItem IDs, SHA256 of cloud bytes, storage keys or names as request input. Only HTTP 201 (new and replayed) or HTTP 200 (all replayed), exact revision ETag and private/no-store are allowed; bounded strictly decoded replies must include explicitly false \`commit_supported\`, \`authoritative\` and \`missing_inference_safe\` and coherent counts. Reject missing flags, mismatched count, unknown fields, trailing JSON, oversized payload, revoked/stale proof response and cancellation.
- Add an **unexported owning native Agent method**, NOT an Electron/Agent loopback IPC route or a background task yet. Lock the local Root grant operation; resolve OS-stored enrollment and device secret plus Source/Root revision via the existing owning Agent path. Revalidate current private ignore rules and both complete sealed journals; read one bounded 16-record private Server evidence page; check SourceItem/Node/alias preflight, unique native identity and local original SHA256, compare it with current File/FileVersion/READY CAS **metadata**, then repeat Server identity preflight.
- Immediately **before** contacting the quarantine endpoint, re-load and verify the same physical Root grant, generation integrity, rules and login/session identity. The Server performs a new independent transaction-bound device-first proof check. Immediately **after** the call, recheck local grant/journals/rules/account and reject reporting a successful session that changed. A timeout may have committed the **quarantined rows**, so an exact idempotent retry is the only safe recovery. Never infer a canonical commit, complete cloud verification or any deletion from the response. A no-candidate page causes no write.
- Add Go Client httptest coverage for forged/missing proof, ordered bounds, HTTP status, 201 vs 200 replay counts, ETag/no-store, strict false authority flags, malformed/oversized responses and request cancellation. Agent helper tests cover wrong source/revision/cursor, duplicate local identities, candidate ordering, cancellation, partial/privileged replies and zero calls for invalid input. Cross-layer test checks that no Web/Renderer/Preload/Electron or general device-backup Agent HTTP route publishes this method.

**Not done:** No Desktop button or runnable Agent job is added. No SourceItem/SourceItemAlias/Node/CAS/File/SyncRun mutation, true L03-E1 identity promotion, uploader/resume, watcher/schedule, Mirror deletion or NAS Push. The CAS check is **metadata-only** and a historical point-in-time read, not physical object durability. Server Source activation remains denied; this private method is not scheduled and cannot be triggered remotely. Full 1k/10k/100k and >=4GiB native E2E and GitLab delivery remain unverified. #1513 passed its own exact-head GitHub CI and final-gate before merger; native physical tests and GitLab delivery remain separate.

**Delivery correction (2026-10-12):** L03-E0b was accepted and merged as [#1513](https://github.com/lazyxu/xdrive/pull/1513), `c5888f38c788dda3b59cd51c739d5f0205132d09`. The native quarantine helper remains unexposed to Renderer/IPC/Web and does not enable SourceRun, upload, canonical alias promotion or Mirror deletion. A follow-up validates lowercase ASCII hexadecimal evidence digests at the Agent boundary before preflight/write; this is defense in depth, not L03-E1 identity commitment.

## L03-E0c · Owning-Agent private quarantined-intent recovery readback (merged #1526; full CI green)

After L03-E0/#1502 and L03-E0b/#1513 merged, a successful POST may be ambiguous
to its native Agent if the connection drops after the Server transaction.
This bounded **read-only recovery prerequisite** reports which persisted
`quarantined` evidence IDs exist for an exact owning Source/device/Root,
Source revision and pair of sealed inventory generation digests.

- Only credential-verified owning Agent callers may POST
  `/api/v1/sources/:id/local-identity/commit-intents/page`. The revision is
  mandatory in `If-Match`; the two 64-digit lowercase hex generation digests,
  numeric `after_evidence_id` and 1–16 page size are accepted in a strictly
  bounded request body, not URL query parameters. Transactional read repeats
  device-first revocation, Source and bound Root proofs, paused local-Push
  state and revision fencing, then reads **only** quarantined rows in ascending
  evidence-ID order using limit+1 keyset pagination. Old revisions, different
  devices/Roots and other generation pairs cannot access each other's rows.
- The private response contains only Source ID, revision, ordered opaque
  evidence IDs, cursor/has-more and three explicit hard-false authority flags.
  It does **not** return paths, device credentials, Root identity, SourceItem IDs,
  file hashes, CAS keys, freeform errors or any operation capability.
  `private, no-store` and the exact revision ETag are required.
- Dedicated Go Client transport validates response status, ETag, cache policy,
  non-null/strictly increasing bounded IDs, coherent cursor and explicit
  false `commit_supported`, `authoritative`, `missing_inference_safe`
  flags. Browser, Renderer, Electron and Agent loopback IPC do not expose it.
  This transport is **not** a scheduled/runnable background Agent recovery
  loop yet; that requires a later local Root/journal revalidation call site.
- Server integration and client negative tests cover owner JWT alone,
  foreign same-account device, different account, Root mismatch, stale revision,
  revoked credential, invalid inputs, cursor termination and missing or forged
  success fields. Readback must not mutate SourceItem, alias, Node, CAS or runs.

A readback ID confirms *only a previously stored quarantine proposal*.
It is **never** evidence that live native bytes still match, physical CAS
objects are durable, the proposal is eligible to commit, a file was uploaded,
or missing files may be deleted. Any retry must independently re-run E0b's
local checks and the Server's write transaction; actual L03-E1 promotion
requires a separate transactional content-proven writer, while L03-F/G upload
and crash recovery, L05 scheduled Agent work and L07 real-device benchmarks
remain unimplemented. GitHub exact-head complete CI and final-gate are
required before merging this stage; no GitLab pipeline or native 100k/4GiB
acceptance is claimed.

## L03-E0d · Owning-Agent private quarantine recovery page (merged #1530; 76-job exact-head CI green)

L03-E0c was accepted and merged as [#1526](https://github.com/lazyxu/xdrive/pull/1526),
commit `1f2c1b39652e28f158d3056f5c66ba1f3815f22d`, after an exact-head
76-job GitHub CI (25 success, 51 conditional skips, final-gate success).
The new Server readback is a *quarantined evidence query*, never canonical
SourceItem/alias authority or a completed backup.

E0d wires its Go Client readback into a **native, unexported owning-Agent**
method taking only the existing Source ID and an evidence-ID cursor. It first
locks local Root-grant operations, resolves the authenticated owning Agent's
OS-encrypted device token and bound paused Source, re-reads private ignore
rules, loads and re-verifies the native approved Root and BOTH sealed journal
generations, then requests one 16-ID page with the exact revision and
generation pair. A second local validation rejects mismatched IDs, partial
has-more pages, incoherent cursors and any commit, authoritative or deletion
flag. It rechecks the native Root, sealed journal integrity, private rules,
session/server/account and current bound device token/Source revision after
the network response; any cancellation, changed scope or revoked device
returns a sanitized failure rather than old IDs.

The method never crosses Desktop IPC, Electron Main/Preload, Renderer, Web or
Mobile Web. There is **no background runner, automatic startup traversal,
scheduled replay or remote operation**. E0d does not re-quarantine, commit,
upload, mutate SourceItem/alias/Node/CAS/SyncRun, grant Mirror deletion or
change the existing fail-closed local Push activation gate. An E0c recovery
read is not a replacement for E0b's live native hashing and Server's
transaction-fenced write checks. A later, separately authorized native
recovery driver and independent L03-E1 physical CAS durability/identity
commit, L03-F/G uploader/restart protocol, L05 watcher/scheduler and L07
1k/10k/100k >=4GiB physical E2E are still required. No GitLab push,
Windows/Linux physical-device run or complete backup result is claimed.

## L03-E0e · Private owning-Agent exact quarantine replay (PR validation)

L03-E0d's native-only authenticated readback and post-read Root/rules/session/
device revalidation merged as [#1530](https://github.com/lazyxu/xdrive/pull/1530),
commit `5b6783c6eaaa07ae756f32dca09558d43c86b2e2`, after 76-job
exact-head GitHub CI (25 success, 51 conditional skips, final-gate success).
The one-work-commit branch was automatically removed after the rebase merge.

**This follow-on implements only a bounded Agent-private idempotent replay
of previously persisted quarantined proposals.** A new unexported method first
uses E0d's credential-verified, revision-fenced and native Root/journal/rules/
account-checked recovery read to obtain up to 16 sorted persisted evidence
IDs. If none exist it makes no Server write. Otherwise it re-runs E0b's
complete independent owning-device/Root/source verification, live original
hashing, current File/FileVersion/CAS metadata and SourceItem/alias/Node
preflight, plus server-side transaction-guarded idempotent quarantine POST.
The E0b implementation now **compares the entire freshly read candidate page
against the exact recovery IDs BEFORE hashing or sending any write** and
rejects changed Source revision or a broader/different page. If the Server
response is anything other than a zero-created, exact-count replay with all
authority flags false, no success is reported. Final owning-device credential,
Source revision, Root, journal and rules checks are repeated.

An earlier successful E0c read MUST NOT allow E0b to include newly discovered
or previously unquarantined candidates after an interruption. When quarantined
IDs do not align with an entire current bounded advisory evidence page
(for example, interleaved non-quarantined candidates), replay **fails
closed**; it does not skip or secretly quarantine unrelated records. No
general restart scheduler/driver, Cursor persistence across process restarts
or UI/IPC endpoint is introduced; this remains an unexported private
callable. A lost HTTP acknowledgment after an actual Server quarantine write
may still be ambiguous and should be reconciled by another exact verified
read, never counted as a completed backup.

Neither a readback nor a replay gives a durable physical CAS proof or changes
canonical SourceItem/SourceItemAlias, Node, File, CAS or SourceRun. The Server
still denies ordinary local-folder SourceRun activation. No actual upload,
Mirror deletion, automatic watcher, NAS Push, Web/Desktop remote writes or
1k/10k/100k >=4GiB physical device acceptance is claimed. L03-E1
transaction-bound durable identity commit, L03-F/G upload/recovery, L05/L06
execution and L07 native E2E remain separate phases. GitHub exact-head full
CI including final-gate is the merge requirement; no GitLab delivery claimed.


## L03-E1a · Owning-Agent quarantined-content physical preflight (merged #1543; 75-job exact-head CI green)

Prerequisite: L03-E0e [#1532](https://github.com/lazyxu/xdrive/pull/1532)
passed its exact-head 76-job PR CI (25 passed, 51 conditional skips, zero
failures, final-gate passed) and was rebase-merged to GitHub master as
`711695292977503ee4b41635689b226d603e5f66`. Its merged work branch
was removed by the PR-triggered cleanup job.

**This is a restricted READ-ONLY E1 prerequisite, not E1 identity commit.**
The Server adds an owning-native-Agent-only, device/Root/revision-fenced
`POST /api/v1/sources/:id/local-identity/commit-intents/content-preflight`
endpoint that accepts the exact two SHA256 generation digests and 1–4 ordered
already-quarantined evidence IDs plus bounded original-byte SHA256/size claims.
The same-account foreign Desktop or Web with owner JWT only cannot use it.
Request JSON is strictly decoded and limited; physical verification is capped
at 4 CAS objects / 64 MiB total with request context cancellation and a
90-second deadline. It uses the existing SHA256 streaming verifier (256 KiB
buffer), not unbounded object buffering or a path supplied by the client.

The read first transactionally proves the current, unrevoked owning device,
Root binding, paused Source and exact revision, and that every ID still refers
to the **identical persisted quarantined intent AND its original advisory
record**. An independent existing canonical SourceItem/alias/Node and
File/FileVersion/READY-CAS metadata preflight derives the only allowed storage
keys. After actual CAS object hashing, both the quarantine/evidence
transaction and the canonical metadata preflight are executed again;
mismatches, disappeared rows, replaced objects, revoked devices, changed
generations, new Source revision or cancellation fail closed. Requests
containing unquarantined IDs do not silently quarantine them.

A successful response is only a **momentary physical read** with
`quarantine_matched=true` and `physical_cas_matched=true`, while
`cloud_bytes_verified=false`, `content_verified=false`,
`commit_supported=false`, `authoritative=false`, and
`missing_inference_safe=false` remain strictly false. It neither pins remote
bytes until a write nor cryptographically attests future local disk state.
No response contains path, credential, identity key, SourceItem ID, CAS key
or per-file digest. No canonical SourceItem/SourceItemAlias/Node/File/CAS/
SyncRun write, Source activation, transfer, Mirror deletion, background
Agent job, desktop/web control, upload or durable restart checkpoint is added.

Unit and PostgreSQL integration regressions cover exact immutable scope,
device A vs device B, owner JWT only, invalid Root, revoked token, changed
Source revision, bad JSON, unquarantined IDs, physical corruption, changed
quarantine state, no extra canonical writes, and false authority flags.
Exact-head GitHub CI [#38238286009](https://github.com/lazyxu/xdrive/actions/runs/38238286009) passed (25 success, 50 conditional skips, zero failures and final-gate success), and [#1543](https://github.com/lazyxu/xdrive/pull/1543) was rebase-merged as `178e4b12540b1b16763c155bb10818f7bf5c4992`. Real
Windows/Linux physical backup tests, GitLab push, native Agent transport and
true E1b transactional physical-proof-and-identity writer are NOT claimed.
The writer must independently verify remote content durability and currently
authorized native file bytes at its own commit boundary; E1a read success
is **never** a commit token.


## L03-E1a2 · Native owning-Agent client transport for private content preflight (merged #1547; 76-job exact-head CI green)

Prerequisite L03-E1a is the strict read-only Server-side preflight in
[#1543](https://github.com/lazyxu/xdrive/pull/1543). This follow-on implements
**only the Go Client transport** for the owning native Agent, without a
call site, background driver, Electron/Agent loopback IPC method, Desktop
button or browser API.

`PreflightLocalQuarantinedPhysicalContentBatch` accepts an authenticated
device/Root proof, exact Source and If-Match revision, two distinct
lowercase SHA256 sealed-generation digests and a sorted unique batch of
1–4 local evidence IDs with fresh original-file SHA256/size claims. It
rejects malformed, negative, duplicate, out-of-order or >64MiB combined
claims **before** any HTTP request; it never sends arbitrary paths, CAS
storage keys, SourceItem/Node IDs or User-Agent/device-header inference.

For a 200 response it requires the exact Source/revision/count, revision
ETag, private no-store semantics and strictly decoded size-bounded JSON.
The booleans `quarantine_matched` and `physical_cas_matched` must both
be present and true. The five flags `cloud_bytes_verified`,
`content_verified`, `commit_supported`, `authoritative` and
`missing_inference_safe` must be present and false. Unknown fields,
trailing data, unexpectedly successful status codes, stale ETag,
wrong counts, missing flags, forged/privileged flags and cancellation
fail closed. The normalized return value retains all privilege flags false.

Client httptest exercises the exact wire contract and rejection matrix;
a cross-layer Node regression asserts no UI/IPC exposure. These tests do
not attest production CAS durability or complete a backup. E1a2 only
prepares an internal Agent caller to independently recheck current local
Root and live native file bytes in a later phase. No canonical
SourceItem/SourceItemAlias, Node, File, CAS or SyncRun mutation; no
Source activation, upload, Mirror deletion, NAS Push or Web/Desktop
remote control. The E1b authoritative writer still requires separate
physical durability, transaction/fencing, idempotence and real native
device acceptance; L03-F/G, L05/L06 and L07 remain outstanding.


L03-E1a2 [#1547](https://github.com/lazyxu/xdrive/pull/1547) passed its full exact-head [76-job GitHub CI](https://github.com/lazyxu/xdrive/actions/runs/38240326126) (25 successful, 51 conditional skips, zero failed, final-gate success) and was rebase-merged as `c8c5e18725b76f17d9fd70eb685cadf3c954152a`; the related work branch is subject to cleanup automation.

## L03-E1a3 · Owning-Agent exact quarantined physical page (merged #1553; 76-job exact-head CI green)

This follows the private bounded Server content preflight (L03-E1a,
merged #1543) and its independent Agent-private Go Client
(L03-E1a2, #1547). No new execution permissions are introduced.

The native owning Agent now has an **unexported, uncalled, read-only**
`preflightLocalBoundBackupQuarantinedPhysicalPage` method. It acquires
the private Root-grant operation lock, resolves the OS-stored device
credential and the current paused local Push Source, loads the exact
private ignore rules and revalidates both sealed inventory generations.
It reads one bounded 1–4 ID page from the **persisted quarantined**
Server relation, then an independently authenticated advisory page.
Every ordered evidence ID and its SourceItem/native/destination key
must match the same complete advisory page: missing, new/interleaved,
duplicated, foreign, reordered or changed evidence **fails closed**.
The returned cursor always belongs to the quarantined relation.

For a nonempty eligible page, the Agent independently preflights
current Server SourceItem/Node/alias evidence, rehashes the actual
currently authorized native originals using the existing
`HashCurrentLocalEvidenceBatch`, and strictly validates the
1–4-record/64MiB aggregate bound **before any physical Server call**.
Files too large for the bounded inspection cannot be counted as
physically observed. It rechecks current File/FileVersion/CAS metadata,
invokes the private #1547 CAS byte preflight, then rereads the same
quarantined/advisory pages, identity and metadata. Before any return,
it repeats the native Root, journal seals, private rules, login/session
and owning-device Source revision proof. Cancellation or changed
scope returns a sanitized error and **no partial success**. An empty
quarantine page causes no content Server request and never claims
content verification.

Even the best-case summary is **point-in-time only**: the returned
`cloud_bytes_verified`, `content_verified`, `commit_supported`,
`authoritative` and `missing_inference_safe` flags remain false.
There is no upload, canonical SourceItem/Alias/Node/CAS/File/SyncRun
mutation, Source activation, Mirror deletion, recovery cursor journal,
automatic scheduling, NAS Push, Loopback Agent API, Electron/Preload,
Renderer, Web/Mobile Web or foreign Desktop operation.

Go unit negative tests cover exact mapping, extra/interleaved/missing/
duplicate IDs and keys, wrong Source/revision/cursor, flags, invalid
hash/byte budget and no fabricated empty success. A cross-layer Node
regression confirms the method remains private. Full exact-head PR CI
and final-gate are mandatory before merging. Windows/Linux real-device
runs, GitLab delivery, 100k/4GiB E2E and an actual E1b transaction-bound
physical-durability identity writer remain future work.


## L03-E1b0 · Atomic quarantine and CAS metadata snapshot (PR validation)

The preceding L03-E1a3 owning-Agent read-only physical preflight
[#1553](https://github.com/lazyxu/xdrive/pull/1553) passed its exact-head
[76-job CI](https://github.com/lazyxu/xdrive/actions/runs/38242524837)
(25 successful, 51 conditional skips, 0 failures, `final-gate` successful)
and was rebase-merged as `10486b5a5f9d58ff5f7491980c4a05620016a466`.
The former task branch is closed/merged; branch cleanup remains an
independent workflow verification.

**This E1b0 stage is a transaction-composability prerequisite, NOT the
authority-granting E1b writer.** The existing quarantined-intent/evidence
scope guard and independently verified SourceItem/alias/Node/File/
FileVersion/READY CAS metadata guard are refactored to accept the **same
caller-supplied GORM PostgreSQL transaction**. Both still independently
repeat owning-device, Root, exact Source revision, paused local Push Source
and current non-authoritative generation/identity/collision checks. A new
private `checkLocalQuarantinedCloudSnapshot` composes the two guards in
one device-first transaction, returning only an ephemeral exact metadata
snapshot, not a durable proof or write token.

The E1a Server preflight now takes **one shared SQL transaction before**
streaming bounded actual CAS bytes and **a second shared transaction
after** the read, comparing exact Source revision and derived CAS objects.
Crucially **all physical storage I/O remains outside SQL transactions**;
no long-held DB locks, writer tokens or CAS lease is invented. The two
separate time points do NOT prove that the object remains durably pinned,
that a future local file still matches, or that a canonical mutation is
safe; the upcoming E1b writer must acquire its own enforceable CAS
lifecycle pin/lease, independently verify native bytes and perform
transaction-bound alias/SourceItem writes and idempotent recovery.

The existing public/foreign-Desktop APIs and owning-Agent preflight wire
contract are unchanged. No new endpoint, CAS blob, SourceItem/alias, Node,
File/Version, SyncRun, Source revision or Mirror deletion mutation occurs.
The local SourceRun activation gate stays closed. Added regression checks
cover absent/foreign device proof at the reusable SQL-transaction guards,
stale FileVersion digest or CAS ref_count, failure without canonical writes,
private no-IPC exposure, and exact two-sided SQL snapshot invocation.
These tests remain subject to this new PR's complete exact-head CI and
`final-gate`; Go/PostgreSQL CI and true physical 100k/≥4GiB benchmarks
are distinct. No GitLab or native device acceptance is claimed.


## L03-E1b1a · Local CAS cross-process read/write/delete lifetime fence (PR verification)

L03-E1b0 [#1558](https://github.com/lazyxu/xdrive/pull/1558)
passed its own exact-head [76-job GitHub PR CI](https://github.com/lazyxu/xdrive/actions/runs/38248327064)
(25 success, 51 conditional skips, zero failures, final-gate success)
and was rebase-merged as `b320c51f9eac3ac5d48b31745a6542f26b2edff8`.
Its merged task branch was automatically removed. The next phase is
L03-E1b1a, which is **storage cooperation for CAS byte observations only**,
not the authoritative E1b SourceItem/alias writer.

The Local storage backend adds a bounded 256-shard operating-system CAS
lifecycle lock group under `.xdrive-cas-lifecycle-locks/`. Shards are
selected only from the first byte of a **canonical** SHA-256 CAS key,
not from a caller-selected arbitrary path. Locks are permanent zero-byte
coordination metadata; do not unlink, cache-evict or rename them while any
Server instance could be using the same storage root. A pinned CAS reader
acquires a **shared** shard lock before opening the object and retains it
until Close (including failure paths). The existing Local.Put, Local.Promote
and Local.Delete take an **exclusive** shard lock for their canonical
CAS target. Different shards can run concurrently, minimizing unnecessary
serialization. Waiting is context-cancellable and the existing
cross-process Unix/Windows OS file-lock implementation is reused.

Existing bounded owning-Agent Server physical preflight now prefers
`storage.CASReadLeaseProvider.OpenPinnedCAS` when available. For a
backend not implementing that optional interface, the old plain read
remains an *ephemeral* observation; no unsupported persistent pin is
invented. A Local pinned read excludes cooperating Local CAS writers
and deleters **only while the read handle is open**. This does not make
an object immutable across later reads or commits, does not prevent an
uncooperative OS process from modifying disk bytes, and does not prove
replica durability or historical native file consistency.

Full negative regression tests cover two different Local Store instances
sharing a filesystem: a held pinned reader must prevent same-shard
Put/Delete/Promote, the lock wait must be cancellable, Close releases the
lock, and different shards may progress independently. Malformed keys,
unavailable CAS objects and canceled reads fail closed; admin cache/aged
temporary cleanup must never classify lock files as disposable content.
Cross-layer regression ensures no Agent IPC, Renderer or Web access.
No SourceItem/alias, Node/File/CAS refcount, SyncRun, SourceRun activation,
Push upload, Mirror deletion or schedule mutation is introduced.

**L03-E1b is still incomplete.** A future authoritative writer must
separately enforce physical object immutability, source content
reverification, transactional CAS reference retention and idempotent
identity promotion, with E1b1a compatible lifetime fencing. This PR
requires its own exact-head GitHub full CI and final-gate before merge.
GitLab delivery, actual backup uploads, Windows/Linux physical device
runs and 100k/at-least-4GiB E2E are not claimed.


## L03-E1b1b0 · Immutable canonical CAS write admission (GitHub PR pending)

L03-E1b1a [#1567](https://github.com/lazyxu/xdrive/pull/1567)
passed full exact-head GitHub PR CI and was merged into `master` as
`5160679f6fc5818263513a18ac2f0ec2d6579f2b`. Its lifetime locks
protect cooperating Local Store CAS readers only while their handles are open.

This bounded follow-up makes Local.Put and Local.Promote accept a **canonical**
`sha256` CAS target only when its *actual streamed bytes* match the target
digest. Under the existing cross-process per-shard exclusive lease, an
already-present canonical target must also be a regular file with the exact
size and SHA-256 digest. A correct existing object is reused without a
replacement rename. A mismatched, corrupt, missing staging source, symlink
target or canceled read fails closed; it never overwrites an existing
canonical CAS object as an implicit repair. Legacy noncanonical and temporary
keys preserve their existing write behavior. These extra checks are
bounded-memory but are NOT a zero-cost bulk-upload performance claim.

This prevents **cooperating Local Store Put/Promote** from silently
overwriting a canonical CAS digest with different content. It does not
protect against out-of-band filesystem writers, create immutable replicas,
prove fsync/replica durability or couple CAS reference retention to an SQL
identity transaction. It adds no Server endpoint, Agent IPC, Web/Desktop
operation, SourceItem/alias/Node/File/CAS-refcount/SyncRun write, Source
activation, upload, schedule, Mirror deletion or NAS Push. The final
L03-E1b writer still needs transaction-coupled CAS retention, independent
owning-Agent native rechecks, idempotent promotion and crash recovery
before L03-F/G, L05/L06 and L07 native 100k/at-least-4GiB acceptance.
GitLab delivery and real native benchmarks are not claimed.


### L03-E1b1b0 exact-head test recovery, 2026-10-12

The earlier E1b1b0 branch's [CI #38264555138](https://github.com/lazyxu/xdrive/actions/runs/38264555138) completed red: its `go-linux-api` PostgreSQL race shard had two residual fixtures that attempted to insert mismatched SHA-256 bytes via normal `Local.Put`. That is precisely the production behavior this change must reject; never loosen canonical CAS admission to make those fixtures pass. Preserve the owning-Agent quarantine read failure by *explicitly simulating an out-of-band physical overwrite* in the test. For the unrelated storage-intelligence orphan listing, use the actual content SHA-256 for the unreferenced physical blob, while preserving its zero refcount, deleting state and the separate missing-object metadata. All changes are replaced into the same one-work-commit branch on its original frozen parent; the updated exact-head full CI and `final-gate` are the only merge evidence. Do not claim a real native device upload, CAS transactional retention or an authoritative identity commit.


### L03-E1b1b0 static Desktop contract synchronization, 2026-10-12

[CI #38271069314](https://github.com/lazyxu/xdrive/actions/runs/38271069314) found that `desktop/tests/device-backup-private-quarantine-content-preflight.cjs` still required the obsolete fixture literal `putOriginal("xyz")` even though production `Local.Put` must reject it. The cross-layer private-route, no-IPC, device-proof and no-canonical-write assertions remain intact. Require the explicit out-of-band tamper fixture and verify the obsolete normal-write bypass is absent. This is a **test-contract update**, not a change to Source authority, upload behavior, Run cancellation or NAS management. Require fresh exact-head full GitHub CI including final-gate before merge.


## L03-E1b1b1a · Transaction-scoped canonical CAS GC-hash fence (CI pending)

After L03-E1b1b0 [#1572](https://github.com/lazyxu/xdrive/pull/1572)
passed full exact-head 76-job GitHub CI and merged into master as
`61eca20c32f979e1c2e6c79621b75a77ede00724`, the next
bounded prerequisite is a **private, read-only SQL retention guard**.

`checkLocalQuarantinedCASRetentionTx` takes a caller-owned PostgreSQL
transaction, a currently authenticated owning-device/Root/revision proof,
and at most 4 exact quarantined evidence IDs / 64 MiB in total. It
first independently rechecks current device revocation, Root binding,
paused Source revision and exact persisted quarantine. It then takes
`pg_advisory_xact_lock(hashtextextended(sha256,0))` for the **sorted,
distinct canonical** content hashes before any cloud CAS row `FOR SHARE`
join; this matches existing refcount release/GC's hash-before-row order.
The existing SourceItem/alias/Node/File/FileVersion/READY ContentBlob
consistency check then runs in the very same transaction, and all
returned objects must match the exact claims. The hash locks remain
held **until that caller transaction commits or rolls back**, blocking
cooperating GC/release of these existing ready objects during a future
canonical mutation. No physical bytes are read while holding SQL locks.

This does NOT increment or persist references, insert an alias, write a
SourceItem, authorize a commit, or protect the bytes across separate
transactions. Untrusted device hashes cannot become authoritative.
The guard is unexported and deliberately has no HTTP/Agent IPC/Desktop
button/scheduler entrypoint; ordinary `local_folder` activation remains
denied. Tests cover ordering, duplicate hashes, bounds, owner vs foreign
device, wrong credential, exact refcount immutability, and no forged
success. The future authoritative L03-E1b1b1b/E1b2 writer must couple
*actual durable reference accounting and idempotent SourceItem/alias
promotion* in that same transaction and independently recheck physical
remote CAS and owning-device native bytes immediately before commit.
L03-F/G, L05/L06, L07 native 1k/10k/100k and >=4GiB acceptance,
and GitLab delivery remain future work.

## L03-E1b1b1b0 · Two-transaction CAS retention lock regression (PR verification)

Before implementing the L03-E1b1b1b authoritative identity writer, a real
PostgreSQL integration regression exercises the *already-merged*
`checkLocalQuarantinedCASRetentionTx` with two independent transactions.
While an authenticated owning-Agent guard holds its caller-owned transaction,
a competing transaction's `pg_try_advisory_xact_lock(hashtextextended(sha256,0))`
must return false. After the owning transaction is deliberately rolled back,
a new peer transaction must acquire that same lock. Both attempts are
nonblocking; no sleeps, polling, or timer-dependent interleavings are used.

This is a **test-only** strengthening of the GC/reference lock ordering
contract. It does not increment any `ContentBlob.ref_count`, create aliases,
promote quarantined intents, authorize a write, perform CAS/native-file I/O,
activate local Push, add Desktop/Web controls, or enable scheduled work. The
separate L03-E1b1b1b writer still needs a physically verified, atomic and
idempotent identity + reference-accounting transaction. GitHub exact-head
CI (including real PostgreSQL integration) is the acceptance gate; GitLab,
native Windows/Linux devices and 100k/4GiB benchmarks are not claimed.

## L03-E1b1b1b1 · Agent-private CURRENT relative path witness (stacked PR)

The next authoritative local Push identity writer cannot derive a canonical
`SourceItem.Path` from its 64-character `CurrentPathKey`: hashes are
non-invertible and path guessing is forbidden. The owning Agent already scans
both complete, sealed journal generations and rehashes actual native file
handles via `HashCurrentLocalEvidenceBatch`. This bounded continuation
preserves the *same* CURRENT generation's verified relative path in its
**private, transient** `LocalEvidenceContentDigest.CurrentRelativePath`
result, with `json:"-"` to fail closed on accidental serialization.
The path is paired by input index with the candidate's exact current path
hash, unique strong native identity and current live-byte hash. Linux/Windows
native test fixtures check that binding and explicit JSON path redaction.

This is not a Server write, new API/IPC capability, durable path grant,
cryptographic file attestation, `SourceItem/alias` promotion, CAS reference
count mutation, Source activation, upload, scheduler, Mirror deletion or NAS
Push management. A later **owning-Agent-only** writer must recheck the Root,
sealed generations, native bytes and current relative path immediately before
its authenticated Server commit; the Server must bind and normalize the
relative path, verify its Root-scoped `CurrentPathKey`, protect current
CAS metadata/physical bytes, and atomically couple any true new CAS reference
to a canonical Node/File/SourceItem mutation. Metadata-only rename must not
increment CAS references. No path enters Web/foreign Desktop read DTOs.
This phase is Draft until its *own* exact-head full CI/final-gate and
rebuild onto merged upstream master; GitLab/native 100k/4GiB tests are not
claimed.

## L03-E1b1b1b2 · Owning-Agent CURRENT path transaction guard (PR validation)

The native owning Agent's independently verified CURRENT relative path is
not a Server authorization token. The new unexported
checkLocalQuarantinedCurrentPathsTx first takes the existing
transaction-scoped owning-device/Root/Source revision, quarantine,
SourceItem/alias/Node/File/FileVersion/READY CAS and hash-before-GC lock
guard, then compares strictly normalized current relative paths from
matching ordered private evidence IDs to the persisted quarantine's
Root-scoped CurrentPathKey under the same caller-owned transaction.
Noncanonical/unsafe paths, drive letters, traversal, duplicate/missing
IDs, stale evidence and mismatched path keys fail closed without echoing
local paths. Another-device or owner-JWT-only callers cannot bypass proof.

This is a reusable READ-ONLY internal Server transaction helper only.
No public route, Agent transport, Desktop IPC, Web/Mobile Web field,
SourceItem/alias/Node/Run/CAS reference write, physical file/CAS read,
upload, scheduler, Mirror inference, or NAS Push is enabled. The future
writer must recheck current Agent-native bytes and Root immediately before
the signed owning-device request; independently prove remote CAS bytes and
perform idempotent canonical identity/alias transitions within the same
guarded transaction. Metadata-only rename must not add CAS references.
Require exact-head Linux/Windows, PostgreSQL integration, Desktop/Web,
full final-gate CI; GitLab and real 100k/4GiB tests remain separate.

## L03-E1b1b1b3 · Cloud target ancestry and sibling-collision precommit (PR verification)

Prerequisites #1600 and #1605 merged after separate 76-job exact-head GitHub CI. Their private current relative path and quarantine/CAS transaction guards do NOT by themselves prove that the existing cloud Node still occupies its original SourceItem path under this Source target. A stale/moved cloud Node must never obtain a newly trusted local identity.

The next bounded PRIVATE READ-ONLY Server guard, checkLocalQuarantinedSameDirectoryTargetTx, composes the existing owning-device, Root, Source revision, quarantine, SourceItem/alias and canonical File/FileVersion/READY CAS checks inside the same caller-owned PostgreSQL transaction. It locks the authoritative Source target and at most 256 active ancestor Nodes with shared row locks, demands the live cloud Node relative path exactly match the saved SourceItem.Path and permits precommit inspection only for a SAME-DIRECTORY file basename change. The destination leaf must follow the existing Windows-compatible name contract and have no currently visible case-insensitive active sibling conflict.

Missing/moved ancestors, deleted/replaced target, stale SourceItem/Node paths, path cycles, cross-directory moves, name collisions, revoked/other-device credentials, stale revisions and CAS metadata mismatch all fail closed. The sibling-absence read is NOT a durable reservation or future write token. A future authoritative writer MUST separately exclude concurrent creations/moves through parent/name locks, independently verify live native and physical CAS bytes, resolve Node/FileVersion revision and CAS refcount accounting, then update Node, SourceItem and aliases in one crash-idempotent transaction. A metadata-only rename must not increment CAS references.

This stage adds NO new HTTP/Agent IPC/Renderer/Web operation, no actual rename/alias promotion, no CAS/Node/SourceItem/Run write, no upload, scheduler, Mirror deletion, or NAS Push. PostgreSQL integration must verify valid same-parent, stale cloud rename, moved-outside-target, case-insensitive sibling collision, cross-directory proposal, forged/revoked device, and unchanged authoritative references. Exact-head Go Linux/Windows, PostgreSQL API race, Web/Desktop and final-gate CI required before merge. GitLab and physical Windows/Linux 100k / >=4GiB acceptance are independent.

## L03-E1b1b1b4 · SQL-only same-parent canonical identity transaction prototype

After #1611's 76-job exact-head final-gate green merge, the remaining issue was the actual canonical metadata transition, not another cosmetic read. This bounded implementation adds an **unexported, uncalled-by-production** SQL-only identity writer prototype, guarded by a deliberately private native+CAS witness type for which there is NO runtime minting or transport path yet. These booleans are NOT cryptographic proof; they may be supplied only by the isolated integration fixture. The helper MUST NOT be wired into HTTP, owning Agent, Desktop IPC, Web, scheduler or any SourceRun until a true live-native and physical-CAS proof and crash-safe executor exist.

Within one caller-owned PostgreSQL transaction, an authenticated owning device bound to a paused local_folder Source and exact Root/revision/quarantined generation passes the existing CAS hash GC lock, complete File/Version/Blob metadata, SourceItem/alias, Source target, same-parent path and sibling-conflict checks. The prototype then performs an optimistic compare-and-swap on the active Node name and metadata revision, promotes the exact CURRENT SourceItem external identity, preserves the old canonical identity as an alias, updates the SourceItem path/node revision, and changes ONLY the private intent state to `applied`. PostgreSQL's existing partial unique idx_xd_nodes_parent_name is the atomic arbiter against competing case-insensitive sibling writes; a stale revision or conflicting alias must rollback the entire transaction.

An identity-only rename increases the Node's *metadata* revision but does not modify File bytes, create a new FileVersion or increase any canonical CAS references. Existing file-manager Node metadata moves have the same content-version separation. The quarantined cloud metadata reader now chooses the last FileVersion at or before the current Node revision using a bounded index-backed LATERAL select, still demanding exact File/FileVersion/READY CAS size/digest/key consistency and current SourceItem NodeRevision. A stale SourceItem/Node revision is still rejected; neither historical content version nor content refcount is duplicated.

The private `applied` intent supports an exact owning-device/revision/Root/claimed-path replay with readback of the current Node, SourceItem and old-path alias but no second mutation. PostgreSQL integration covers successful one-file same-parent commit, durable metadata revision change, old alias retention, unchanged FileVersion and CAS refcount, repeat transaction idempotence, destination collision and denied unverified/forged credentials. It is explicitly NOT an upload, offline recovery protocol, authoritative native byte attestation, physical CAS lease, remote operation, NAS Push management, or Mirror deletion capability. No Agent/Desktop/Web UI control is enabled.

Do not treat this private helper as a complete L03-E1 product release. Next work must cryptographically/physically ground a fresh owning Agent native file digest, same-generation path, exact cloud CAS object bytes and durable content lifetime before permitting any runtime call; then implement recovery after ambiguous network outcomes, atomic source-run state, actual transfer, cancellation and scheduling. Full exact-head GitHub Go Linux/Windows/PostgreSQL17 race, Desktop/Web, packaged artifacts and final-gate are required before merging this internal prototype. GitLab and real Windows/Linux 100k / >=4 GiB acceptance are NOT claimed.


## L03-E1b2a · Native owning-Agent one-candidate exact precommit recheck (non-operational)

The L03-E1b1b1b4 SQL-only identity rename prototype is merged as [#1616](https://github.com/lazyxu/xdrive/pull/1616) with exact-head CI success. This next narrow prerequisite adds `localpush.RecheckLocalIdentityNativeCandidate`: the native installation must still have the *persisted* exact account/Server/Source/Root grant; a caller-supplied RootGrant alone fails. It accepts one bounded strong native-identity candidate, the exact two sealed journal generation SHA256 values, positive Source revision and a *comparison* content hash/size of at most 64 MiB. Both inventory generations must remain complete and match before and after rehashing the actual Root-scoped original file handle. Wrong candidate/path key, current bytes, CAS-expected SHA/size, missing/replaced Root, removed grant, rotated generation and cancellation all fail closed with an empty result. The private result serializes as `{}` under JSON; in particular, relative local paths, device/Root identifiers and content digest are not exposed by this contract.

This native preflight is **point-in-time evidence, not a reusable attestation or Server authorization**. The expected content hash and Source revision are caller-supplied and must later be independently checked against authenticated Server and actual pinned CAS; this helper does not prove their authority. It is NOT wired to a runnable Agent job, HTTP/Go Client, Electron IPC, Renderer, Web or PWA. It cannot mint the SQL prototype's test-only witness or activate a `local_folder` Source. It creates no SourceItem/alias/Node/FileVersion/CAS/SyncRun mutation, no upload, watcher, scheduler, Mirror deletion or NAS manager. A separate L03-E1b2b+ stage must keep physical CAS bytes valid across a real content/metadata commit, bind short-lived native evidence to a credential-verified owning-Agent request, then handle ambiguous outcomes and durable transfer accounting before enabling a production writer. L05–L07 physical Windows/Linux, 100k and >=4 GiB and GitLab delivery remain unverified.



## L03-E1b2b1 · Local CAS pinned physical observation window (non-operational)

After L03-E1b2a [#1623](https://github.com/lazyxu/xdrive/pull/1623) passed its own 76-job exact-head CI and merged, the next bounded Server-only prerequisite adds the unexported withLocalIdentityPinnedCASWindow. For an exact canonical localEvidenceCloudObject of at most 64 MiB and a 90-second context, it accepts only the concrete *storage.Local backend with its cross-process shared CAS-shard lease; an unsupported generic Store's normal Open fails closed. The same pinned regular-file handle is fully SHA-256 checked in bounded 256-KiB chunks before and after a narrowly scoped read-only observer, with file identity, size, and mtime rechecked. Local Put/Promote/Delete use the corresponding exclusive shard lease, so cooperating Server instances cannot replace or garbage-collect that canonical CAS file while the observer runs. Callback error, cancelled request, mismatched bytes, changed identity, unsupported storage and invalid input are failures, and the lease is released.

**This is NOT an authoritative identity writer or Server/Agent proof.** The observer must not run SQL or content writes: safe SQL advisory-lock ordering, owning-device/revocation/revision binding and short-lived native evidence must be designed and tested together before connecting the SQL-only applyLocalQuarantinedSameParentRenameTx. A shared Local Store shard lease fences only cooperating CAS operations, not direct out-of-band filesystem corruption or remote/non-Local storage. The second physical hash rejects an observed same-size out-of-band overwrite; it does not magically prevent arbitrary malicious changes. No HTTP, Go Client, Agent IPC, Web/Mobile Web/Desktop button, scheduler, SourceRun, canonical SourceItem/alias/Node/CAS write, upload, Mirror deletion, NAS Push or reusable witness is introduced. Full GitHub exact-head CI (including real Linux/Windows and test lanes) is required before merge; physical devices, 100k/4GiB and GitLab remain unverified.


## L03-E1b2b2 · Nonblocking canonical CAS pin admission (non-operational)

After the previous L03-E1b2b1 pinned physical observation prerequisite, the owning Server will eventually have to combine PostgreSQL transaction-scoped GC/hash guards with filesystem CAS lifetime locks. Acquiring a blocking OS lock *while holding a SQL hash lock* risks lock-order inversion if another cooperative upload/GC actor has already acquired the OS lock and requires SQL; a second lifetime mode must therefore **try once and fail closed on contention**, never wait for the OS lock with SQL locks held.

This bounded primitive refactors the existing concrete Local CAS lifetime helper without modifying its blocking Put/Promote/Delete/OpenPinnedCAS paths, adding only `(*storage.Local).TryOpenPinnedCAS(ctx,key)`. It admits exact canonical CAS keys and uses the same cross-process shard-lock file with a nonblocking shared acquisition. Contention yields `(nil,false,nil)` so a future caller can rollback and retry in a new bounded transaction; malformed/missing/cancelled keys are errors and never grant a handle. Successful reads hold the shared lease through the same close-once PinnedCASFile as normal reads. Linux/Windows tests use two Local instances, one held exclusive shard lease, release/retry, contended Delete while pinned, wrong key, missing file, and cancel. No HTTP, Agent IPC, Renderer/Web control, token, SQL mutation, local-folder activation, real upload or durable writer is introduced. The future proof-composition transaction must separately determine ordering (device -> Source -> Root -> SQL hash -> try OS -> current canonical bytes), verify fresh owning-native evidence and use a real ephemeral authenticated request; this helper alone is NOT content/identity commit authority.


## L03-E1b2b3 · Real PostgreSQL and Local CAS cross-lock regression (CI verification)

This bounded **test-only** prerequisite validates the actual PostgreSQL transaction-scoped CAS hash lock together with xDrive's cross-process Local Store shared/exclusive shard lock using XD_TEST_DATABASE_URL. A cooperating Local writer holds the exclusive OS CAS lock; a separate DB transaction acquires the same canonical SHA256's PostgreSQL advisory hash lock; a second independent SQL connection cannot acquire the held SQL hash lock. Inside the owning transaction, TryOpenPinnedCAS must report contention promptly (750 ms bound), return no file, and force a rollback; the independent SQL connection must then acquire the released hash lock. After the writer releases the OS lease, a new SQL transaction can try/acquire/close a shared pinned CAS handle, and the writer can delete the fixture afterward without a lease leak.

No sleeps, manual unlock of PostgreSQL transaction locks, Source/SourceItem/Node/FileVersion/CAS metadata mutation, claimed device authority or uploader is added. The test uses unique CAS fixture bytes, checks actual SQL connection separation, closes all handles and fails closed on missing data or timeouts. The normal Go Linux PostgreSQL17 CI lane executes the test; without XD_TEST_DATABASE_URL it explicitly skips. It intentionally reads only file metadata while the SQL hash lock is held, not full physical bytes, and it does not prove that multi-step native file + CAS + Source/Root authorization can be composed safely. The pre-existing production entrypoints and local_folder SourceRun activation gate remain unchanged. Actual native Windows/Linux backup, 100k files, 4GiB and GitLab delivery require separate execution evidence.



## L03-F0 · Owning native verified original to private staging byte stream (PR verification)

This bounded **native Linux/Windows-only**, unconnected transport precursor extends the existing HashVerifiedInventoryFile path to share one exact secure Root-scoped file-handle reader and stream into an Agent-private discardable io.Writer. StreamCurrentInventoryFileToStaging requires an existing persisted exact Root grant, a fully verified CURRENT immutable inventory generation and exactly one matching, strong, single-link, nonignored file record from that journal; the caller cannot fabricate an arbitrary InventoryItem or swap local Roots. It copies in <=256-KiB buffers while hashing the same bytes, checks expected content SHA256/size and native handle identity, revalidates the persisted Root and immutable CURRENT journal after the copy, and honors context cancellation, sink write errors and progress callbacks.

**Staging bytes can be partial or invalid on ANY returned error (including digest mismatch after copy), and the caller MUST discard them.** This helper does not use a cloud CAS key, finalize Server content, mark an upload complete or commit File/Node/SourceItem/SourceRun. No HTTP/Agent IPC/Web/Desktop control invokes it; future transport must use a cancellable bounded staging writer with rollback, a batched/journal-indexed 100k-item lookup, owning Agent credential/Source revision and server-authorized CAS content admission. It deliberately relies on one fully verified CURRENT journal so first-generation new-file backup can be supported; two complete generations remain required for rename/missing/Mirror safety. A successful local byte copy is not an upload. Real >=4GiB native and remote resumable transport, schedule and Mirror deletion remain separate.


## L03-F1a · Bound owning-Agent temporary Server staging with actual HTTP bytes

After the L03-F0 secure native CURRENT original reader was merged as #1643, F1a introduces a **dedicated, bounded and noncanonical** Agent-to-Server binary staging protocol. This is the first Server-side actual-byte receiver; it does **not** finalize a cloud upload. New routes live only under `/api/v1/sources/:id/local-staging` (POST reservation, GET status, PUT `/:stageID/content`, DELETE cancel) with `requireLocalSourceExecutor`. They never reuse owner-JWT-only `/uploads` sessions or expose generic File/Node mutation APIs.

An authenticated owning Agent with exact token, Source ID/revision, Root ID/fingerprint and owner may reserve one 0–64MiB temporary record per Source, containing only hashes of the private CURRENT journal and relative path plus expected original SHA256/size. The Server independently rechecks the *actual current paused local_folder Push Source*, nondeleted target directory, credential/revocation and bound Root within the same transaction at **every** reservation, status read, upload admission, post-byte commit-to-STAGING-state and cancel. It never trusts arbitrary caller-provided target directories or local absolute paths. Reservation is idempotent for the exact live immutable tuple. A new attempt may replace an expired/failed/canceled record; stage IDs are random UUIDs and storage keys are Server-derived under the existing upload temporary namespace. Failed/short/oversize/hash-mismatching/cancelled PUTs are rejected, the temporary object is deleted best-effort, and state is marked failed. Staged status and exact bytes can be queried only using the credential-verified, stage-ID/revision-fenced owning-Agent route. The staging TTL is **30 minutes**; the existing orphan-staging janitor treats unreferenced temporary content as eligible after its one-hour grace period, even if the old stage row remains. A deleted/canceled stage may be reserved anew.

**All staging responses explicitly include hard-false `content_verified`, `commit_supported`, `authoritative`, `missing_inference_safe` flags.** Staged means only temporary bytes were received with the claimed digest, NOT physical CAS durability, native original provenance, Run success, cloud-file visibility, FileVersion or SourceItem. The new Go Client transport repeats credential headers and If-Match, rejects cacheable/ill-formed/cross-Source replies, and is not called from Web, Renderer or any automatic Agent Run. PostgreSQL17/Gin integration verifies device A vs same-account device B, JWT-only, wrong owner, revoked device, duplicate reservation, exact temporary bytes, wrong digest, private status read, cancellation and unchanged canonical models.

This bounded F1a does NOT implement chunked/resumable session persistence after client restart, cross-Source global disk reservations or atomic per-account quota charge, CAS physical re-verification, 100k indexed inventory staging, 4GiB streaming, actual SourceRun/Node/File/SourceItem write, Mirror deletion or a runnable local executor. The next F1b/F2 must bind a VERIFIED native request to the staged object and independently revalidate both bytes and owning-device/Source/Root permissions before canonical commit; generic `/uploads/:id/finalize` must never act on this distinct staging record. Native devices/GitLab and real large-file acceptance are separate.


## L03-F1b · Native Agent CURRENT original → bounded HTTP staging (private prototype)

This dependent stage composes the merged L03-F0 native Linux/Windows file reader with F1a's **device-credential/Root/Source revision-bound temporary Server upload** from PR #1648. `internal/localpushstage.StageVerifiedNativeOriginalBytes` remains explicitly Agent-private and **has no IPC, Renderer, Web, scheduler or production controller call site**. A caller must pass the OS-registered owning device token, exact Root grant, configuration directory, paused Source revision and expected relative original/content digest. The helper verifies one COMPLETE CURRENT journal, unique strong/single-link nonignored member and <=64MiB size **before** contacting Server. It re-opens and re-hashes the real file to `io.Discard` before reserving a matching temporary server stage. It then opens the native original AGAIN and streams through a cancellable, backpressured `io.Pipe` directly into the dedicated `PutLocalPushStagingBytes` transport, with no whole-file memory buffer. The native producer only closes successfully after rehashing and rechecking the native Root/CURRENT journal. The owning Agent then rechecks current native manifest and persisted Root and authenticates an exact Server staging status readback; any failure attempts an independent timeout-bounded temporary-stage cancellation. The result remains JSON-redacted and cannot authorize canonical storage, FileVersion, SourceItem, SourceRun, cancellation of another device, Mirror deletion or ordinary web upload.

A network error can leave temporary bytes pending until Server stage expiry/janitor; it is never a successful backup. Reservation replay returning `staged` currently fails closed rather than claiming resumable recovery. Tests use real Windows/Linux native journal fixtures and an authenticated HTTP test server that checks owner JWT, device token, Root ID/fingerprint, Source revision, SHA256/path-key and exact wire bytes; invalid file/path/digest, canceled context and missing local Root must not initiate any Server request. The temporary transport is still unconnected to a runnable Agent job, requires future durable chunked transport, account-level quotas, true 100k journal indexing, >=4GiB, canonical CAS/SQL commit, recovery and device-scoped task control. Its parent PR #1648 must pass exact-head complete CI and merge before the stacked one-work-commit branch is reconstructed onto master and accepted independently. GitLab and physical endpoints remain unverified.


## L03-F2a · Owning-Agent ephemeral physical Server staging recheck (not a commit)

After L03-F1b #1656 passed full exact-head CI and merged, the next **noncanonical F2 gate** adds a dedicated owning-Agent-only GET `/api/v1/sources/:id/local-staging/:stageID/content-preflight`. The existing bound device token, Root ID/fingerprint, current Source revision, paused local_folder Push identity, live cloud target, stage ID, expiry and `staged` status must be checked in a PostgreSQL transaction **before and after** physical disk I/O. No Web/Mobile Web, foreign Desktop or owner-JWT-only route may access this private check.

This independent Server-side read uses only the configured concrete Local Store and a Server-derived random UUID key under the noncanonical temp namespace. It requires a non-symlink regular file, matches inode identity, size and mtime on the path and the open handle, hashes ALL exact bytes (capped at 64MiB + 1 byte via <=256KiB reusable buffer) and compares to the recorded SHA256. Missing/truncated/oversized, same-size overwritten, symlinked, expired, canceled, revoked or replaced stages fail closed. Full physical I/O is outside the database transactions, with the same bound-credential + stage-row checks repeated afterward. A server admin's test-only direct overwrite is expected to cause HTTP 409 even when the DB still says `staged`. Go Client strictly validates the exact stage/source/revision/size, no-store/ETag, `physical_staging_matched=true`, and **explicit false** content_verified, commit_supported, authoritative and missing_inference_safe fields. No general Source/UploadSession or public UI uses it.

**Crucial limitation:** the read is an EPHEMERAL observation, not a durable CAS lease. Temporary stages do not have canonical shard pin protection. Server/Agent original provenance, CAS promotion under a deadlock-safe OS/SQL lock order, account quota, File/FileVersion/Node/SourceItem mutation, SourceRun execution and idempotent crash recovery are still absent. The eventual authoritative writer must recheck physical content with its own lifetime fencing and all Source/Root/Device locks in the same commit protocol; it must not reuse this positive preflight as a bearer token. It does not permit Mirror missing inference or remote delete. CI Linux, Windows, PostgreSQL, Desktop/Web and final-gate are required; 100k and >=4GiB native acceptance/GitLab are unverified.


## L03-F2b · Agent-private post-staging physical-byte confirmation (PR verification)

After merged #1662 (F2a), the existing private native StageVerifiedNativeOriginalBytes path
must not return its temporary noncanonical receipt merely because PUT succeeded and
a staged-status readback matched. Following its own native Root/CURRENT rechecks,
the owning Agent now also invokes the authenticated F2a physical Server stage preflight
using the same exact Source, revision, Root/device proof, stage UUID and byte size.
The Go Client rejects mismatched identities, absent/false physical match, cacheable
responses, or any true canonical-authority flag. On denial, mismatch or cancellation
the native method returns an empty receipt and attempts bounded private stage cancel
using an independent cleanup context; Server expiry/janitor remains fallback.

A passing physical preflight is a point-in-time temporary-file SHA256 observation,
not a held CAS lease or original-file attestation at commit time. The return type
remains JSON-redacted, no new Desktop/Renderer/Web/IPC/SourceRun entrypoint exists,
and local_folder activation, permanent File/Node/SourceItem/ContentBlob mutation,
upload finalize, Mirror deletion, scheduler and remote control remain forbidden.
Real Windows/Linux devices, 100k and >=4GiB acceptance and GitLab remain unverified.


## L03-F2c1 · Real native Agent → authenticated Gin → physical stage integration (stacked PR validation)

After L03-F2b, an additional Linux/Windows native PostgreSQL integration
test runs the previously separate F1b native producer and F2a Server physical
preflight as one actual HTTP chain. A freshly persisted native Root grant,
complete CURRENT journal and real original file produce an Agent-only temporary
stream received by Gin with JWT plus bound device token/Root/revision. Server
writes real temporary bytes and independently rehashes them; the Agent requires
the strict noncanonical physical reply before returning its JSON-redacted
temporary receipt. An out-of-band same-length overwrite just before F2a must
fail, trigger best-effort owning-Agent cancellation and remove the temporary
file. Both cases verify no SourceItem, SyncRun, FileVersion, ContentBlob,
generic UploadSession or local-folder activation was created.

This is a test-only prerequisite, not a CAS promotion, permanent storage
transaction, owner JWT upload grant, Desktop IPC operation, scheduler or
remote execution feature. Production APIs and security flags remain unchanged.
Go Linux/Windows native plus PostgreSQL17 exact-head CI/final-gate are required;
real physical devices, 100k inventory, >=4GiB, long-lived recheck and GitLab
remain unverified. F2c2+ must design immutable CAS/SQL lock ordering and
atomic idempotent authoritative writes before any real Push execution.


## L03-F2c2 · Exact already-staged temporary recovery (PR verification)

After #1674's real native-to-Gin test was merged, an ambiguous HTTP
acknowledgment may leave a completed Server temporary stage despite the
owning Agent not receiving confirmation. Agent-private
StageVerifiedNativeOriginalBytes now distinguishes newly reserved records
(which still stream bytes normally) from an EXACT existing staged record.
For a staged replay, the Agent reopens and rehashes the current native
original under its persisted Root/CURRENT journal a second time without
sending another PUT. Both cases repeat CURRENT generation, persisted Root
grant, owning-device authenticated status and a separate physical
Server SHA256 preflight before returning only a JSON-redacted,
NONCANONICAL Agent-private temporary receipt.

Server exact reservation scope binds Source/revision, device/Root, CURRENT
generation, relative path key, content hash and size. Stale, missing,
writing, failed, canceled or expired stages fail closed. A previously
valid stage corrupted before replay must be rejected and best-effort
canceled, without an additional PUT or canonical file mutation. The real
Gin/PostgreSQL/native integration tests exercise exact replay reuse,
single-PUT accounting, corruption rejection and physical file cleanup.

This does NOT provide partial chunk resume, 4GiB transfer, durable
SourceRun accounting, permanent CAS/File/Node/SourceItem mutation, or
local-folder activation. No new Desktop/Web IPC or remote control,
schedule, NAS Push, Mirror deletion or per-file read DTO is added.
Canonical CAS/SQL lifetime locking, quotas and crash-idempotent writes
remain future F2d+ milestones. Full exact-head GitHub Go Linux/Windows,
PostgreSQL, Desktop/Web and final-gate CI is required; real physical
devices, 100k originals, >=4GiB and GitLab remain unverified.


## L03-F2d1 · Cooperative temporary stage physical lifetime fence (PR verification)

Following exact-stage Agent recovery (F2c2), the physical temporary stage
read now holds a dedicated, bounded persistent OS-shard shared lease from
the concrete Local Store. The private stage key is an exact Server-owned
UUID under the fixed localpush temporary namespace; alternate path spellings,
unsafe/nonregular/symlinked records and canceled pins fail closed. The
same stage-shard exclusive counterpart fences Local.Put, Local.Delete,
Local.DeleteStaging (including global temp-cleanup janitor), and
Local.Promote before any physical rename/delete, across separate Local
instances sharing the same filesystem. Per-shard lock files are persistent
storage control state, NEVER reclaimable temporary data. Existing canonical
CAS locks remain separate; global temporary janitor lease precedes Put's
stage lease, and Promote takes target CAS before source-stage lease.

The owning-Agent physical preflight still performs its original bounded
SHA256/size/inode/mtime checks, with the stage reader held across hashing.
It releases the shared stage lease before its second device/Root/Source
PostgreSQL proof transaction. Real Linux/Windows cross-instance tests demand
timeout failures for competing Put/Delete/DeleteStaging/Promote while the
stage is pinned, successful promotion after Close, cancellation and symlink
rejection. Outside-process actors bypassing xDrive storage locks are not
blocked, so the digest and inode checks remain mandatory.

This lock protects ONLY cooperative temporary-byte observation. It is
NOT canonical CAS refcount retention, immutable cloud content, a distributed
SQL+OS commit protocol, native-file attestation at commit time, SourceRun,
permanent File/Node/SourceItem write, 4GiB resume, Mirror deletion or an
Agent/Desktop/Web runnable action. F2d2+ must independently prove durable
CAS bytes, exact owning device and Root/revision at commit and idempotent
database mutation. Require full exact-head GitHub Linux/Windows/PostgreSQL,
Web/Desktop, artifacts and final-gate; real 100k/4GiB/physical device
and GitLab evidence are separate.


## L03-F2d2 · Nonblocking stage pin admission under SQL CAS hash locks (PR verification)

After the owning-Agent F2d1 physical stage lifetime fence, a future
authoritative writer must not wait for the TEMPORARY stage's OS shard while
holding a PostgreSQL CAS hash advisory lock. A competing stage Store writer
may already hold that OS lock and subsequently need SQL, so blocking
SQL→OS acquisition could invert the lock order. The private Local Store
now exposes TryOpenPinnedLocalPushStage: it accepts only an exact private
UUID stage path and attempts the identical shared OS stage lock once.
Contention is (nil,false,nil), requiring a future caller to abandon its
SQL transaction and retry separately; canceled, missing, nonregular,
symlinked or noncanonical paths fail closed. The successful handle owns
the stage lock until Close, and the shared inode admission checks are
identical to ordinary OpenPinnedLocalPushStage.

Native Linux/Windows tests verify a busy exclusive stage lock returns
promptly without blocking or disclosing a handle; after release the shared
pin blocks stage cleanup until Close. A PostgreSQL17 integration regression
models real CAS hash xact advisory locks on two database connections:
under one held transaction, an OS-busy stage read must be nonblocking and
the whole transaction rolled back; the independent connection must then
reacquire the SQL hash lock. When stage OS contention is removed, a fresh
transaction can try-pin and inspect ONLY regular-file metadata, close, and
complete without leaked DB/OS locks. No sleeps or timing-based interleaving
is used for SQL ordering. An environment without XD_TEST_DATABASE_URL
explicitly skips only the SQL integration regression.

Neither a try-pin nor this test provides durable bytes, a CAS reference,
canonical File/Node/SourceItem, an authenticated executable SourceRun or an
Agent-origin integrity proof at COMMIT time. There is no new REST, Go Client,
Desktop IPC, Web, scheduler, NAS Push or Mirror delete. The local_folder
activation/Run hard gate stays in place. A future transactional writer
must repeat owning-device/Root/revision proof, hash the pinned temporary
and canonical content at the actual commit boundary, apply account quotas,
and preserve crash-idempotent CAS/SQL reference accounting. Full exact-head
Go Linux/Windows/PostgreSQL, Web/Desktop, artifacts and final-gate CI
are mandatory; real 100k/4GiB, physical devices and GitLab are not claimed.


## L03-F2d3 · Paired temporary-stage and canonical-CAS nonblocking pins (PR validation)

The preceding F2d1/F2d2 and E1b2 stages separately fenced cooperative
staging and canonical CAS lifetimes. F2d3 combines those *existing* Local
Store read paths in one internal, **non-authoritative** admission:
`TryOpenPinnedLocalPushStageAndCAS(ctx,stageKey,casKey)` accepts only a
Server-owned canonical private UUID stage key and a canonical SHA256 CAS key.
The canonical CAS shard is tried first, then the temporary stage shard,
matching the order of existing `Local.Promote`. BOTH acquisitions are
nonblocking, including when the caller already holds a PostgreSQL CAS
hash advisory lock. A busy OS lock returns (nil,false,nil), so a future
transaction MUST roll back and retry outside that transaction; a missing,
malformed, canceled, nonregular or symlinked file fails closed.

On second-stage contention/failure, the first acquired CAS handle is closed
before returning. A successful pair holds BOTH cooperative reader leases
until an idempotent pair Close, releasing stage before CAS. The narrow
StageReader/CASReader and regular inode Stat accessors are internal only:
they cannot become a Server token or a UI capability. Cross-Local
Linux/Windows tests exercise simultaneous Put/Delete protection, both
contention directions, partial pin cleanup, path rejection, cancellation
and symlinked canonical CAS. A PostgreSQL17 test uses independent SQL
connections and the real advisory hash lock to prove CAS-busy and
stage-busy cases each roll back, do not wait for either OS lock and release
both SQL/OS leases before subsequent operations; the free path inspects
ONLY inode metadata. Without XD_TEST_DATABASE_URL the DB test skips.

This is **not** a durable pinned verification or an authorized commit:
it performs NO Source/device/Root/revision recheck, stage-to-CAS promotion,
full SHA256 comparison at COMMIT, quota charge, File/FileVersion/Node/
SourceItem/ContentBlob or SyncRun mutation, uploader, scheduler, Desktop
button, Web operation, NAS Push or Mirror deletion. Existing
`local_folder` activation denial stays active. A canonical CAS object
must already exist for this paired read; absent canonical content is
NOT created. Outside-process filesystem actors are not fenced, so the
actual final writer needs independent physical hashes, atomic retention
and idempotent recovery under precise credential and transaction locks.
GitHub exact-head full Go Linux/Windows/PostgreSQL/Web/Desktop/artifact
and final-gate CI are required; GitLab, real physical 100k and >=4GiB
backup acceptance remain unverified.


## L03-F2d4 · Independent bounded physical SHA256 observation for paired Stage/CAS (PR verification)

After merged F2d3 #1696, the existing internal Local Store paired nonblocking
CAS-first → private-Stage-second read lease can now be used by
`ObserveMatchingLocalPushStageAndCAS(ctx,stageKey,casKey,expectedSize)` for
**one ephemeral, non-authoritative physical observation**. The caller supplies
ONLY an exact canonical private staging UUID key, an exact canonical SHA256 CAS
key and a 0–64MiB expected size. An already present canonical CAS object is
required; the observer cannot create/promote one. Both opened files are
independently hashed to the canonical CAS SHA256 using the existing bounded
context-aware copier with a maximum of expectedSize+1 bytes per handle,
rejecting short/extra bytes and same-length corruption of EITHER file. Before
and after both hashes, the observer checks regular-file inode identity, opened
handle vs canonical filesystem path, size and mtime. Changes, missing paths,
symlink/nonregular targets, bad digests or cancellation fail closed. It closes
BOTH OS leases on success and failure, and a close error cannot return
success. Busy OS pin admission stays (false,nil), never blocking while a
future SQL advisory-lock transaction may be held.

Tests exercise a valid byte-for-byte Stage/CAS pair, independent same-size
out-of-band modifications of either file, incorrect/missing keys, expected
size bounds, extra/short reads, mid-copy cancellation, mtime drift and
released cross-process writer locks after all outcomes. Go Linux/Windows,
PostgreSQL17-backed regression (F2d3), Web/Desktop, artifacts and final-gate
CI must pass for this exact single-work-commit PR. Physical-device
100k/≥4GiB and GitLab remain separate.

**This is not an authorized backup commit.** The returned Boolean proves
only that two handles matched a digest during one bounded observation; it
is NOT a durable CAS reference, device credential, Root/Source revision
proof, SQL transaction fence, account quota charge, File/FileVersion/Node/
SourceItem update, SourceRun, resume ticket, Mirror deletion or authority
to activate local_folder. It deliberately creates NO REST/Go Client/Agent
IPC/Renderer/Web control or scheduler. Cooperative OS pins cannot prevent
malicious out-of-band writes after their release, nor prove an immutable
distributed snapshot. The future authoritative writer must independently
revalidate exact owning Agent/Root/Source/revision, perform the appropriate
physical hash and SQL/OS lock protocol at commit time, atomically charge
quota/retain CAS references and recover interrupted commits idempotently.


## L03-F2d5 · Owning-device-scoped existing-CAS physical reuse precommit (PR validation)

After #1701 (F2d4), the Server now has a strictly **internal, read-only**
`observeBoundLocalPushExistingCAS` prerequisite for the **already-existing
canonical CAS deduplication** case. It is deliberately **not an HTTP route,
Go Client transport, Agent IPC, Renderer/Web button or runnable upload**.
A caller must already have the authenticated owning-Agent proof in the
trusted Gin context; an owner JWT, second Desktop on the SAME account,
forged device credential, missing Root binding or outdated Source revision
is insufficient. Only a paused `local_folder` Push Source and a live,
exactly scoped `staged` record may be observed. The canonical key comes
ONLY from the currently persisted stage SHA256; no caller-provided key/path,
arbitrary Stage, Source target or media input is accepted.

A FIRST short PostgreSQL transaction verifies the unrevoked owner device,
Root binding/fingerprint, Source revision/cloud target and exact Stage row.
It obtains the canonical SHA256's transaction-scoped advisory hash lock
BEFORE reading its ContentBlob metadata under a row SHARE lock. The
ContentBlob MUST be an existing `ready` object with positive RefCount,
exact canonical storage key and size equal to the persisted Stage. Both
SQL locks are **released** at the end of the transaction. Outside SQL,
the F2d4 Local-Store-only `ObserveMatchingLocalPushStageAndCAS` independently
hashes both actual files under cooperative nonblocking CAS-first/Stage-second
OS shared pins (0–64 MiB, context bounded). Busy OS lock returns
`(false,nil)`, never a positive observation or a blocking wait with SQL
locks held. Any absent/corrupt physical bytes fail closed. A SECOND short
transaction repeats the entire owning-device/Stage/CAS metadata scope.
A revoked or swapped device, modified Source revision, canceled/replaced
Stage, changed CAS ready/refcount/size/key or expired request MUST NOT
produce a positive result. No observation result is persisted or exported.

Real PostgreSQL17 plus native Local Store regression cases include a
valid paired read without canonical SourceItem/Run mutation, independent
same-size Stage and CAS corruption, same-account foreign device, forged
token, reserved/failed/canceled/expired Stage, non-ready/unreferenced
ContentBlob, midflight revocation, Source-revision drift, canceled Stage,
refcount drift and context/lock contention. Require one GitHub work commit,
the exact-head full Go Linux/Windows, Web/Desktop, Rootless, artifact and
final-gate CI before merge. Missing local PostgreSQL/native/GitLab/physical
device acceptance must not be represented as complete.

**Crucial limit:** these are TWO independent, momentary database snapshots
around physical I/O, not one durable atomic commit. The CAS hash advisory
lock is **not held** while disk hashing runs, and local filesystem OS pins
are released before the second SQL check. Another actor can change state
immediately afterward, and this helper does not establish native original
provenance or a persistent refcount lease. In particular, it does **not**
create/promote CAS bytes, increment/retain CAS references, charge quota,
create File/FileVersion/Node/SourceItem, accept a rename, start SourceRun,
schedule backups, delete Mirror files or enable `local_folder` execution.
The initial-new-CAS upload path is also unimplemented. Future F2d6+
must design the **actual single writer transaction**, OS/SQL lock order,
device/Root/revision fencing, durable quota/refcount and crash-idempotent
recovery rather than treating this ephemeral check as a bearer ticket.


## L03-F2d6 · First physical canonical CAS materialization from private Stage (PR verification)

Following merged F2d5 #1705, the only newly added primitive is
`(*storage.Local).MaterializeLocalPushStageCAS(ctx, stageKey, casKey, expectedSize)`.
This is a **storage-only**, currently **unconnected** prerequisite for the
missing **new-content** branch; it does NOT create a valid backup. It requires
an exact Server-owned lowercase canonical UUID private stage key, an exact
lowercase canonical SHA256 CAS key and a bounded 0–64 MiB original size.
It derives the CAS digest from the canonical key, never from an arbitrary
pathname or a browser/renderer-supplied body. The original Stage always
remains in place and no Source/Run model is touched.

The Local Store acquires **nonblocking** locks in existing global order:
canonical CAS shard **exclusive** first, shared managed-temp lifecycle
second (to fence administrative cleanup of in-progress atomic temp files),
and private Stage shard **shared** third. Contention at ANY stage returns
`(created=false, admitted=false, err=nil)`, with all earlier locks released
before return; a canceled or invalid request returns an error. This function
does not acquire SQL locks and MUST NOT be invoked inside an SQL hash or
Source transaction. Under the Stage pin, it validates the exact regular
inode/path/mtime and streams no more than expectedSize+1 bytes with bounded
128-KiB buffering into a private same-directory CAS temporary file while
computing SHA256. Short, long, corrupt, canceled or replaced input fails;
temporary bytes are removed and neither existing CAS nor the Stage changes.
The temp bytes are fsynced and closed prior to any publication.

Existing canonical content is independently rehashed under the exclusive
CAS lock; if valid and matching, it is reused without replacement. If
absent, a **create-only hard link** from the verified same-directory temp
atomically publishes the physical canonical inode, without rename-overwrite;
unsupported hard links fail closed. Pre-existing corrupt, nonregular or
symlinked targets are NEVER repaired or overwritten, and CAS directory
ancestors are checked as real directories. A bounded post-publication inode
check and cancellation handling fail closed. A valid result distinguishes
`(new=true, admitted=true)` vs `(new=false, admitted=true)`: these indicate
ONLY physical materialization/reuse. On crash, published bytes can remain
**orphaned and unreferenced**, and a filesystem sync alone does not promise
cross-platform durable directory-entry or SQL atomicity.

Linux/Windows cross-Local Store tests verify new exact physical content,
stage retention, repeat reuse preserving the same inode, corrupted stage
rejection, corrupt existing CAS refusal, CAS / stage / cleanup lock busy
fail-fast and release, invalid keys/size/cancel, symlink refusal, no leftover
working temp files, and zero-byte inputs. Previous PostgreSQL17 OS/SQL
lock-order tests stay authoritative separately. Require one GitHub work
commit, full exact-head Go Linux/Windows, PostgreSQL, Web/Desktop, artifacts,
Rootless and final-gate CI; real physical 100k/4GiB and GitLab remain
separate unverified gates.

**NOT a backup commit or a new capability:** no owning-Agent credential,
Root/Source revision or persisted Stage status is verified by this storage
primitive. It creates NO ContentBlob/SourceItem/File/FileVersion/Node/SyncRun
row, quota charge, CAS refcount, upload finalization, Agent transport,
authenticated Server route, Web/Mobile Web/Desktop button, scheduler, NAS
Push or Mirror deletion. The existing `local_folder` activation hard denial
remains in force. F2d7+ must bind a live owning-device/Root/stage proof,
safe temporary-CAS physical materialization, refcount and quota admission
and **one crash-idempotent authoritative SQL writer** before any real
device-local Push may execute. Existing unreferenced CAS cleanup and
out-of-band filesystem changes require independent fencing; this primitive
does NOT hand out a durable commit/witness token.


## L03-F2d7 · Owning-Server new-CAS physical preparation precommit (Draft PR validation)

After merged F2d6 #1711 (GitHub `master@13c15d4596405410df102ac29659e908b1736412` is the selected fixed work base), `prepareBoundLocalPushNewCAS` connects the INTERNAL storage-only `MaterializeLocalPushStageCAS` prerequisite to **two separate short Server authorization/metadata snapshots**. It is unexported and has NO registered REST, Go Client, Agent IPC, Renderer or Web caller. It requires the trusted owning-Agent proof in Gin context, current owner and unrevoked OS-held device token, exact bound Root and Source revision/target, a paused `local_folder` Push Source, matching `staged` record, valid SHA256, 0–64 MiB size and unexpired Stage. A signed-in owner's JWT or an enrolled second Desktop (even same account) is never enough.

Before and after storage I/O, each PostgreSQL transaction locks Device → Source → Root/Stage in the existing revocation-safe order, takes the canonical CAS transaction-scoped hash advisory lock, then confirms **no ContentBlob row exists** for that digest. An existing ready, failed or reserved ContentBlob is never modified or hijacked by this new-object path: use the existing-CAS logic separately. The transactions end before starting/after finishing the physical materializer, avoiding SQL/OS lock inversion. Only a canonical CAS key derived from the persisted Stage digest and a Server-owned private UUID Stage path reach the storage primitive. OS shard contention is a non-success, not a durable permit. Midflight revoke, Source revision/target drift, canceled/replaced/expired Stage, new ContentBlob row or request cancellation must reject the observation on recheck. A physically created inode may remain orphaned if the second check fails and must be handled by future safe GC/recovery; no rollback of a concurrent valid CAS user is attempted.

A positive return is **only an ephemeral, internal physical preparation observation**. The two SQL snapshots and OS pins do NOT overlap and do not prove an atomic writer. No ContentBlob or quota/refcount, File/FileVersion/Node/SourceItem/SyncRun, alias, mirror delete, active local_folder Source, background schedule, actual upload result or external control is created. Out-of-band filesystem mutation and crash-idempotent authoritative SQL commit remain unresolved. Existing `local_folder` execution hard-denial, remote Desktop/Web read-only visibility and NAS placeholder remain unchanged.

Regression tests cover a real owning PostgreSQL device/Root/Stage + Local Store first physical CAS and exact replay without DB writes, existing ContentBlob denial before bytes, foreign context and forged token, invalid Stage, revocation/Stage cancel/Source revision drift between snapshots, OS-busy non-admission and request cancellation. This Draft requires **its own** complete exact-head Go Linux/Windows/PostgreSQL, Web/Desktop, Rootless, images/artifacts and final-gate CI before merge. Local full repository Go1.25/physical Windows/Linux 100k/≥4GiB and GitLab are NOT claimed in the container lacking github.com clone access. Next stages must supply durable transaction/references/quota, recovery and actual owning-Agent run execution before enabling real Push.

## L03-F2d8a · Private new-CAS prepare quarantine, no commit authority (2026-10-15)

Following **merged #1717** (L03-F2d7, full 76-job exact-head GitHub CI success and linear merge), the Server gains a *private and non-operational* durable `LocalPushCASPrepareIntent` record, schema migrated explicitly as `xd_local_push_cas_prepare_intents`. `quarantineBoundLocalPushCASPrepareIntent` is an unexported Server-only method with NO HTTP route, Go Client, Desktop Agent IPC, Renderer/Web/Mobile Web control or scheduler. It writes one `quarantined` row per exact Stage UUID and allows exact immutable replay, nothing more.

Under one PostgreSQL transaction, check the signed-in Owner's *unrevoked OS-held owning-device credential*, exact bound native Root ID/fingerprint, paused local-folder Push Source revision and cloud target, valid not-expired `staged` row, its sealed CURRENT snapshot/path digest, expected SHA256 and 0–64 MiB size. Follow Device → Source → Root → Stage lock ordering; take the canonical SHA256 advisory hash lock before inspecting `ContentBlob`. Any existing `ContentBlob` row (ready, deleting or inconsistent) rejects new-content quarantine. A repeated Stage UUID with any changed Source/Owner/device/Root/target/revision/snapshot/path/hash/size/expiry or altered state is denied; exact same record is not rewritten. Wrong, forged, same-account foreign or revoked device; stale Source, changed Stage, expired time, DB error or canceled context all fail closed. This metadata may outlive the live Stage and MUST NEVER be used as authority without fresh proof.

**Critical limit:** `quarantined` is not evidence of actual original bytes, a physically published CAS inode, durability after restart, a retained reference or a successful backup. This stage neither calls F2d7 physical preparation nor changes ContentBlob, quota/refcount, File/FileVersion/Node/SourceItem/SyncRun/alias, Mirror missing/deletion, Source activation, auto schedules or NAS. Later phases need a fenced retention/quota/authoritative SQL writer, verified physical bytes at commit, exact idempotent crash recovery, bounded stale-record retention/GC, owning-Agent execution and real Windows/Linux 100k/≥4GiB validation before any Push Run can be enabled. No purported hardware attestation or future positive recovery certificate is introduced.

Regression tests exercise PostgreSQL migration and owner-only durable record creation, exact replay, no canonical mutations or physical publication, same-account second Device, invalid/forged/revoked credential, ContentBlob collision, tampered/canceled/expired Stage, stale Source revision and aborted transaction; require this exact work commit's full Linux/Windows/PostgreSQL/Desktop/Web/image/artifact/final-gate CI. No local Go1.25/PostgreSQL E2E, GitLab delivery or native-device physical acceptance is claimed.


## L03-F2d8b1 · Private quarantine-fenced physical new CAS precommit (2026-10-16)

After merged L03-F2d8a #1723 (full 76-job exact-head CI, 25 succeeded, 51 conditional skips, final-gate success, linear merge), add one **internal Server-only physical prerequisite** that requires the **same durable F2d8a quarantined Stage UUID intent** in both PostgreSQL scope transactions around actual F2d6 Local Store CAS preparation. It is `prepareQuarantinedBoundLocalPushNewCAS` and has NO REST, Go Client, Desktop Agent IPC, Web/Mobile Web/Renderer, queue, watcher or scheduler entry point.

The new scoped form of F2d7 preserves its old unquarantined helper and tests for backwards internal compatibility. The scoped form first verifies owning unrevoked credential, exact Root/fingerprint, paused Push Source revision/target, valid Stage digest/size/status/expiry, and **absent** ContentBlob row, then checks the private intent is `quarantined` and exactly matches Stage owner, Root, Source, target, sealed CURRENT snapshot, path hash, original content SHA256, size, expiration and creation/update timestamps. It repeats every check in a second independent PostgreSQL transaction after physical bytes are prepared. Missing, altered, deleted/re-created or expired quarantine, Stage/source changes, device revocation, a concurrently inserted ContentBlob, cancellation, physical errors, and busy nonblocking OS shards never produce positive observation. All first/second SQL locks end before/after physical I/O; lock order remains Device → Source → Root → Stage → CAS hash → ContentBlob → private intent. Physical OS preparation retains CAS exclusive → managed temp shared → private Stage shared lock order. No SQL/OS lock spans both halves, and an orphan physical CAS inode may survive a later negative result. Never delete canonical CAS bytes as a speculative rollback.

Native Local Store/PostgreSQL fixture regressions cover missing/altered/deleted/touched quarantine before/after the physical boundary, live owning-Agent positive case and exact idempotent physical replay, Stage expiry/cancel, Source revision drift, device revoke/same-account foreign credential, newly appearing CAS metadata, cancellation and OS-busy denial, and prove no `ContentBlob`, quota/refcount, `SourceItem`, `FileVersion`, `Node`, `SyncRun` or real backup activation is created. The durable quarantine remains in its original unmodified `quarantined` state and must NEVER become an upload-success or commit authorization token.

**This is NOT L03-F2d8b final authorization or a completed backup.** No OS/SQL atomic CAS lifetime or crash-consistent durable inode/reference, quota charge/reservation, authoritative file/version/node/item transaction, scheduler, Mirror deletion or NAS Push. Out-of-band disk mutation, intermediate changes despite observational checks and full crash recovery remain unsolved. The next bounded stage must design a shared fenced **single-writer** quota/ContentBlob reference transaction and recovery; only after true File/Node/SourceItem/SourceRun lifecycle and native Windows/Linux >=4GiB/100k acceptance may Desktop Push be enabled. Require exact-head full GitHub CI/final-gate, one work commit and linear merge; do not claim unavailable local Go1.25/native/GitLab validation.
