# Unified Push/Pull — platform implementation audit

> **2026-11-06 superseding product decision:** the standalone DSM Synology
> Photos **Push** connector has been retired in favor of the original DSM
> `local_folder` Backup-only Agent. Synology Photos/Files **Pull** are now
> temporarily disabled, with implementations and all historical data retained.
> The 2026-11-05 implementation notes below are historical audit evidence,
> **not active implementation guidance**.

**Audit date:** 2026-11-05  
**Authority:** [Unified Push/Pull Source Management Architecture](./push-pull-source-management.md)  
**Scope:** new-source MVP only. Old target paths and old data migration are explicitly excluded.

This is a source-code audit, not a deployment or physical-device acceptance report. A merged PR proves merged code, not that a real device, NAS or production account has been exercised.

## 1. Cross-platform implementation matrix

| Mode | Already implemented in master | Missing for unified MVP |
|---|---|---|
| Local Folder Push | #3757 provisions a device-bound paused local_folder Source and managed target. Owning Agent has Root binding, durable Operations, shared CAS uploader and automatic scheduling. | New target prefix must be Push/; generalize Source Device binding name; expose the same Source lifecycle/history in the unified manager. |
| Desktop Push | Desktop owns the local Agent and native Root UI. | All create/configure/run actions must operate on the same Source ID; remove any parallel Desktop-only source state. |
| xd Push | CLI is a thin client of the same owning Agent; CLI-only package and bootstrap exist (#2585). This change removes `--target-id` from new setup and validates the Server-returned managed target before local Root binding. | Keep Desktop and xd on one Agent/Device/Source and Runner; no separate CLI target picker or cloud directory creator. |
| DSM Photos Push (retired) | Dedicated `xdrive-source-agent` removed. Existing Photos originals are protected through the DSM local-folder Push Agent; historical Source/Node/CAS data are preserved. | Do not recreate the retired connector. Synology Photos Pull remains separate. |
| iOS Photos Push | #3830 provides ios_photos Source, registered identity, managed target, foreground/BG managed UploadSession routes, destination-bound cursors and encrypted original receipts. | New target prefix must be Push/; unify Source status/history projection and management entry; real iPhone validation remains outstanding. |
| Android Photos Push | MediaStore staging, encrypted intent/receipt ledger, identity-only enrollment, WorkManager opt-in, bounded upload and exact read-only ACK lookup exist. | No android_photos Source/managed target; upload and receipt lookup remain Owner-root scoped; add Device-bound Source, exact Target upload/finalize/receipt, Source-bound cursor and unified history. |
| Yike Photos Pull | Server Worker, encrypted Cookie, scan/sync, incremental planner, SourceItems/collections, streaming resumable upload and per-account limits. | Target uses a Yike-specific path, not Pull/Yike Photos/SourceName; provision new targets under Pull/ and show in the same manager. |
| Synology Photos Pull | Shared Server Worker, encrypted DSM credentials, Personal/Shared spaces, scan/sync, metadata and resumable transfer. | Target uses 远程拉取/Synology Photos; provision new targets under Pull/ and enforce the same Source lifecycle/UI. |
| Synology Files Pull | File Station connector and shared Pull execution exist. | Target uses the old 远程拉取 namespace; provision new targets under Pull/ and verify the same per-Source status/history behavior. |
| Shared management | Desktop/DSM use shared XDriveApp pages; Web/PWA has Source Manager and remote Pull. | Verify every Push kind is listed and manageable through the same Source model. Native iOS/Android need Source-backed status/config adapters. |

## 2. Important cross-check findings

### Push identity is not yet universal

- Desktop Local Folder Push already has a registered ClientDevice, device-bound Source creation, Root binding and a server-managed target.
- iOS has a separate identity-only Device credential and dedicated managed destination/upload/background routes. It must remain unable to use generic Desktop Agent or Root APIs.
- Android can register an identity-only Device, but the existing native backup writer still verifies and writes under Owner Root. There is no Android Source binding or managed target yet.
- DSM source-agent now enrolls an identity-only Synology ClientDevice, stores its independent token in the secret store, and creates a server-managed Push Source. The Server persists the aggregate Personal/Shared Root ID and fingerprint and rechecks Device, Source revision, Root binding and Target on execution and upload/finalize. Real DSM NAS acceptance remains unverified.
- Desktop and xd already share one owning Agent. Do not add a second xd device registration or runner.

### Pull worker foundation is already shared

The Server worker dispatcher registers Yike, Synology Photos and Synology Files handlers in one internal/pullworker Runner. It already provides per-Source jobs, bounded global concurrency, manual/retry/scheduled priority, run control and provider-account concurrency keys.

The work is therefore **not** to create three new worker services. The remaining work is to make new destination provisioning and management behavior uniform, then verify each connector remains isolated at Source/run level.

### Destination namespace is currently inconsistent

| Source | Current new-source target layout | Required new-source layout |
|---|---|---|
| Local Folder / iOS Push | 同步文件夹/设备备份/<device>/<source> | 同步文件夹/Push/<device>/<source> |
| Synology Pull | 同步文件夹/远程拉取/<connector>/<source> | 同步文件夹/Pull/<connector>/<source> |
| Yike Pull | 同步文件夹/一刻相册/<account identity> | 同步文件夹/Pull/Yike Photos/<source> |
| DSM Photos Push (retired) | Existing historical paths stay in place | No new target is created |
| Android Photos Push | Owner root | 同步文件夹/Push/<Android device>/<source> |

These are changes to **new provisioning only**. Do not move or rename old targets, old Nodes, old receipts or old Source records in this project.

## 3. Minimum MVP gap list

### P0 — shared Server contract

1. Introduce one server-side managed target provisioner for Push and Pull. It creates the canonical root/group/connector/leaf and Source atomically, sets TargetManaged, returns the actual path and stable TargetNodeID, and rejects conflicts/overlap.
2. Generalize the Push Source Device binding. Current LocalCreatorDeviceID is local-folder-specific by name; new Push types must have one connector-neutral DeviceID binding.
3. Keep platform capability separate from Device identity. A valid Device token alone must not grant local Root, PhotoKit, MediaStore or arbitrary Files access.
4. Ensure managed-subtree write guards apply equally to every new Push/Pull target and every upload route.

### Historical DSM Photos Push work — retired 2026-11-06

This section records the former design. It is **not** a current MVP gap;
the dedicated DSM Photos Push agent and Server upload routes are retired.
Do not restart a historical Source, provision a new Photos Push target or
migrate existing backups. The DSM folder backup Agent is the current Push path.

### P0 — DSM Photos Push (S02–S04 implemented in PR #3923)

Device enrollment/token storage/revocation, server-managed Push target provisioning, persisted Personal/Shared Root-set fingerprint binding, and per-run/per-upload Device–Source–Root–Target authorization are implemented and covered by PostgreSQL integration tests. The remaining acceptance item is a real DSM NAS run; it must remain **跳过（未验收）** until physically exercised.

### P0 — Android Photos Push

1. Add android_photos Push Source provisioning and the canonical Device/Source target.
2. Replace Owner-root upload parent with exact Source.TargetNodeID in original UploadSession creation, finalize and receipt verification.
3. Scope read-only unknown-ACK lookup to Owner + Device + Source + Target + exact resume key/name/size/SHA.
4. Bind encrypted ledger/checkpoint identity to SourceID + TargetNodeID as well as Server/Owner/Device; target change must restart scanning safely without clearing uncertain receipts.
5. Expose Source status/history and lifecycle from the native Gallery backup UI.

### P1 — existing Push convergence

1. Move Local Folder and iOS **new** managed targets to the Push/ prefix.
2. Keep Desktop and xd on one Agent/Device/Source; verify new CLI initialization omits target_node_id and accepts only the Server-returned managed target.
3. Make iOS destination setup and BG grants use the same generic Source/Device/Target contract while preserving its restricted PhotoKit route.
4. Add a common Source status/history projection over existing per-file journals and SyncRun records. Do not discard native journals or invent Source completion.

### P1 — Pull convergence

1. Provision new Yike targets under Pull/Yike Photos/<SourceName>.
2. Provision new Synology Photos and Synology Files targets under Pull/<connector>/<SourceName>.
3. Confirm all Pull connectors use the same Source Manager actions, run-now, pause, retry, archive/restore and history semantics.
4. Keep credentials encrypted on Server, and ensure one Source's failure/backoff/account lock cannot block unrelated Sources.

### P1 — management and verification

1. Ensure Web/PWA, Desktop and DSM show all Push and Pull Source kinds in the same Source Manager model. Device Backup may remain a shortcut, not a second catalogue.
2. Add native iOS/Android Source-backed status/configuration while retaining native screens.
3. Add contract tests across all platform adapters: wrong Owner, wrong Device, revoked Device, wrong Source, wrong Target, stale revision, archived Source, credential expiry and uncertain ACK.
4. Run exact-head Go/PostgreSQL, Web/Desktop, DSM package/CGI, iOS IPA and Android Gradle/Compose CI as applicable. Real iPhone, Android and DSM device acceptance must be reported separately as **跳过（未验收）** unless actually run.

## 4. Recommended implementation sequence

1. Shared Server provisioner + canonical Push/Pull target prefixes, with PostgreSQL integration tests.
2. ~~DSM ClientDevice enrollment and exact Source/Target binding~~ — completed with S02–S04 in PR #3923.
3. Android managed Source/Target and Source-scoped upload/receipt path.
4. New-target path alignment for existing Local Folder, iOS, Yike and Synology Pull.
5. Unified Source Manager/status/history adapters and cross-platform contract tests.

Do not start parallel changes that modify the same Server provisioning or authorization files. Existing active PRs #3891 and #3898 are Source archive/restore work; preserve their tested HEADs and integrate their final behavior by normal merge/rebase rules rather than editing them as part of this audit.

## 5. Source Manager / Host gaps confirmed in current master

The shared TypeScript Source Manager is not yet a complete cross-platform catalogue:

1. Its current create-option set covers Local Folder Push, Synology Photos Push/Pull, Synology Files Pull and Yike Photos Pull. It does not include native iOS Photos or Android Photos Sources.
2. The current external-source kind/profile model does not expose ios_photos or android_photos as read-only rows. Their native backup pages therefore remain separate management surfaces, and a user cannot see every Push Source in one catalogue.
3. The generic Source DTO does not expose a connector-neutral DeviceID. LocalCreatorDeviceID is intentionally redacted, so the manager cannot display the verified owning Device or distinguish a device-bound Source from an ordinary Owner-created Source.
4. Synology Photos Push creation still exposes a user-selected cloud target_node_id. The generic Server createSource path accepts that target and does not require a Synology ClientDevice proof. This must be replaced by DSM enrollment + server-owned Push provisioning; a UI-only restriction is insufficient.
5. Local Folder Push's create-option description still says its uploader is not enabled, although the owning-Agent incremental Push path exists. This stale copy must be corrected.
6. Yike's Source Manager target-label helper still recognizes the old 一刻相册 path. After new Yike provisioning moves to Pull/Yike Photos, the label/help copy must display the real Server-returned target path and not reconstruct a legacy path.
7. iOS and Android maintain platform-specific durable per-file journals and exact receipt recovery, but those states are not yet projected as generic Source SyncRun history. A shared manager must show real per-Source status/history without replacing or weakening those journals.
8. DSM's shared XDriveApp/Host capability surface must expose the same Source Manager operations only when backed by real authenticated Server/Agent ports. The standalone DSM source-agent Task Scheduler remains an execution mechanism, not a separate Source catalogue.

Minimum management acceptance: all Source kinds appear in one Owner-scoped list; Push rows display a verified Device label/ID and are read-only from foreign devices; Pull rows display connector/credential status and Server Worker status; actions are enabled only when the Host has the required capability; iOS/Android rows show native-ledger/receipt-derived status without offering remote Run Now.

## 6. DSM Push S02–S04 implementation

PR #3923 completes the DSM Device, Root and upload authorization closure:

- Register `synology` as an identity-only ClientDevice platform. Its credential is explicitly excluded from the generic Desktop Agent credential gate.
- Store the independent DSM Device token in the source-agent secret store; config.json contains only DeviceID and the opaque credential reference.
- New Synology Photos Push creation requires registered Device proof, rejects caller-selected target Nodes, and creates `同步文件夹/Push/<device>/<source>` transactionally.
- Source stores the generic `DeviceID`, exact managed `TargetNodeID`, and `TargetManaged` provenance.
- The server persists the aggregate Personal/Shared Root-set ID and fingerprint in the Source binding. The source-agent independently verifies the local filesystem roots before scanning.
- Every Source mutation/run and every upload admission, chunk write and Finalize rechecks Owner, Device platform/token/revocation, Source ID/revision, Root ID/fingerprint and the exact managed Target/descendant.
- Device revocation pauses bound Synology Push Sources and requests cancellation of active runs.
- Existing Sources with no DeviceID remain on their exact old target and are not migrated or silently rebound.

**Remaining DSM acceptance:** a real DSM NAS run has not been performed and must be reported as **跳过（未验收）**. The standalone source-agent CI currently builds Linux amd64 and arm64 binaries. The legacy ARMv7 SPK remains the separate `xd` / `xdrive-agent` package and does not include `xdrive-source-agent`; ARMv7 source-agent distribution is not yet provided.

## 2026-11-06 Synology MVP scope reduction (later Owner decision)

The 2026-11-05 audit above records the prior desired architecture and is
preserved as historical design context. The later Owner decision temporarily
disables **Synology Photos Pull** and **Synology Files Pull** while prioritizing
one **DSM `local_folder` folder Push** route using `xdrive-agent` and the
canonical Server UploadSession/CAS writer. The standalone DSM Synology Photos
Push path is still retired. Connector code remains available for later
reactivation; existing Source, target, Node, FileVersion, SourceItem,
SourceCredential, SyncRun and CAS history are not migrated or deleted.

An active historical Synology Pull is *not* an enabled worker: creation,
configuration, trigger, SyncRun and write authorization are disabled. Owner
history reads, archival and credential revocation remain available. Yike Pull
is not disabled by the Synology-specific reduction. No real NAS deployment is
implied by a committed branch or a passing unit test.
