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
| L03 | Verified local reader/digest/candidates, two-generation history, then Planner, resumable upload, commit and recovery | L03-A #1244, L03-B #1246, L03-C #1250 and L03-D1 #1258 merged; reconciler/upload/runtime not implemented |
| L04 | Desktop native root selection and shared Source Manager UI | entry/grant flow merged #1223 and #1226; actual sync experience still incomplete |
| L05 | watcher, scheduled reconciliation, mount/unplug fail-closed behavior | not implemented |
| L06 | Desktop-only local Push preview/run/cancel; Web/other Desktop owner-scoped device/folder read-only summaries | not implemented; no cross-device trigger, offline queue or Web preview |
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
is a separate PR-stage change of the Server's cloud target directory using
the same private Agent credential and validated bound Root. A target change
never relocates or deletes previously stored cloud data. The Server verifies
directory ownership and resets Mirror missing evidence as applicable.
No local Push executor, automatic upload, cancellation UI, actual
filesystem-to-CAS sync or physical-scale benchmark is enabled by either edit.

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
