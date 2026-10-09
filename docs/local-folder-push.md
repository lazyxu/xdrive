# Local folder push — staged delivery contract

## Objective and status

An ordinary **local folder** selected by the user on Windows or Linux should push original files to an owner-authorized xDrive Source target. Existing xDrive CfAPI/FUSE two-way mount synchronization, Synology NAS Push, and Pull connectors are separate products and remain unchanged.

The currently implemented L01-A is **Server-only, fail-closed**: the kind `local_folder` is recognized only in the push direction; a new Source always starts paused; activation and starting any run are denied until future device-bound authorization and native executor support exist. No user-facing operational preset is exposed. Source/CAS/upload code is not duplicated.

| Phase | Deliverable | Status |
| --- | --- | --- |
| L01-A | local_folder push/paused activation gate; integration regression; AGENTS progress rule | implemented in this change; CI/merge separate |
| L01-B | Authenticated client device registration, Root approval/binding, and Source Run authorization | registration/binding and Source Run proof preflight staged; native approval, transaction-bound enforcement and execution remain incomplete |
| L02 | Windows/Linux streaming scan, stable local identity, per-root journal/state | not implemented |
| L03 | Planner + resumable upload + SourceItem commit, crash/idempotency recovery | not implemented |
| L04 | Desktop native root selection and shared Source Manager UI | not implemented |
| L05 | watcher, scheduled reconciliation, mount/unplug fail-closed behavior | not implemented |
| L06 | Web remote execution request, Agent pickup, read-only draft preview | not implemented |
| L07 | 1k/10k/100k and >=4 GiB E2E, cancel propagation and CI evidence | not implemented |

## L01-B2-B transaction-scoped device revocation fencing (non-operational)

Source Run mutating handlers revalidate the bound device token, Root and Source revision under the same database transaction as their writes. Device rows are locked before the Source and binding, consistent with device revoke. A write must commit before revoke or observe revoke and fail, never silently continue afterward. Existing run source revisions are also checked. This is not an OS-local Root grant and **does not lift L01-A's hard activation/run denial**; native Agent approval, scoped uploads and E2E verification remain outstanding.

## L01-B2-A Source Run executor-proof preflight (non-operational)

For the seven Source Run **mutating** endpoints (begin, observe, commit, failures, progress, heartbeat, finish), local-folder Sources require a verified owner-scoped device enrollment token and the exact bound Device ID, Root UUID and fingerprint. The owner's JWT alone is insufficient. All existing non-local-folder Source executors are unchanged. Source Run cancel remains a signed-in owner's control operation and does not require the executing device's secret.

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

## Non-negotiable invariants

- The Device binds one explicitly authorized local Root to one Source ID for a specific Server and owner. Never let Web specify arbitrary paths to read on the client.
- Preserve Node identity on provable rename/move; never infer same-file identity from name and timestamp alone; handle hard links as distinct paths.
- A local-folder Source must never become active before authenticated binding and execution capabilities are available. Stale manually altered data must not be executable.
- The Agent executes in a separate lifecycle from the Desktop window. Persistent sync is cancelled only by explicit user control; viewer/browser aborts cannot cancel it.
- Full inventory is required for missing inference. Unmounted drives, unreadable directories, cancelled runs, partial scans and lost watcher events must not count as deletions.
- Backup never deletes xDrive content when local files disappear. Mirror only uses the existing 2 complete scans + 24-hour grace + trash-only policy.
- Use existing `Source / SourceItem / SyncRun`, `internal/client` resumable upload, CAS and Task Center; no parallel media parser, transport or business store.
- Draft rule preview is not a formal `run_mode=scan`: the formal mode mutates synchronization records. Implement a separate no-business-writes preview in L06.
- Server identity, owner authorization, revisions and target Node binding are authoritative. No cross-account source access or data leakage.
- Before performance work, record baseline, optimize only where necessary, rerun identical 1k/10k/100k and large-file workloads, keep only meaningful improvements.

## Release and verification gates

L01-A: reject pull; create push paused; reject premature activation and trigger; refuse run even if a database row is incorrectly set to active; keep Synology/Yike behavior unchanged. Requires PostgreSQL integration tests.

L01-B/L03: prove device credential possession for the *entire* source run lifecycle, not only initial enrollment; owner-bound binding with a locally approved Root; reject stale device/root/config versions, revoked devices and replay.

L02/L05: prove at least 100k inventory without loading the entire tree into the renderer, successful rename/modify/identity preservation, filesystem-event overflow fallback, root replacement safety, restart resume and no false mirror deletions.

L04/L06: shared MUI Source Manager, Desktop native folder picker, honest online/offline/queued/claimed states, agent-version capability gating, no remote arbitrary path execution.

L07: measurable SQL P50/P95, Agent RSS/CPU, bytes transferred vs CAS reuse, 4 GiB stream/resume, explicit cancel propagation and power/network interruption tests. Native-device and simulated tests have separate verdicts.

Related GitHub PR/branch cleanup must be evidence-based and scoped to this work; never disturb unrelated active work.
