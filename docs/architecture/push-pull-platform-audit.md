# Unified Push/Pull — post-merge platform audit

**Snapshot:** 2026-11-08; master merge [#4082](https://github.com/lazyxu/xdrive/pull/4082), commit **1761b8fc3c2669c82bf6fa8c36e8a38749d4def9**.
**Authority:** [push-pull-source-management.md](./push-pull-source-management.md) and AGENTS.md.
**Scope:** new Source provisioning, platform-managed Push/Pull authority, Source life cycle, common transfer and history. This audit replaces the 2026-11-05 pre-integration status. Historical decisions remain in Git history.

The #4082 exact HEAD passed 13 applicable GitHub Actions workflows, including complete CI, Go/API/PostgreSQL, Android Gradle, Desktop/Web, Synology ARMv7/SPK, release contracts and Final Gate. The iOS unsigned-IPA workflow is path-filtered and did **not** run on that HEAD because this integration did not change ios/ files; the already-merged iOS compatibility work in #4080 had its own IPA result. These are distinct claims. No production or physical-device acceptance is implied.

## 1. Current implementation — do not reimplement

| Platform/source | Enabled execution | Source/Target contract | Owner-visible management |
| --- | --- | --- | --- |
| Desktop local folder Push | Owning xdrive-agent | Owner + Device + verified Root + Source/Revision + managed Target | Shared Source Manager and local authorization |
| xd CLI local folder Push | Same owning xdrive-agent, not a second runner | Same Source and Root binding | CLI/Agent and shared Server history |
| DSM local folder Push | Owning DSM xdrive-agent | Same local-folder Source, Root, UploadSession/CAS writer | Shared XDriveApp/DSM Host capability boundary |
| iOS Photos Push | Native PhotoKit foreground/BG route with scoped grant | Identity-only Device, ios_photos Source, managed Target and exact original receipts | Source/SyncRun overview; actual backup controls remain on iPhone |
| Android Photos Push | Native MediaStore foreground/Worker with scoped grants | Identity-only Device, android_photos Source, managed UploadSession/Target, persistent cursors and receipts | Source/SyncRun overview; actual backup controls remain on Android |
| Yike Photos Pull | Server Pull Worker | Encrypted credentials, per-Source run, managed Pull target | Shared Source Manager |
| Synology Photos/Files Pull | **Temporarily disabled** | Existing credentials, Source history, Node/CAS and connector code retained | Historical read-only view; new runs fail closed |
| Legacy Synology Photos Push | **Retired** | Standalone xdrive-source-agent, routes and build removed; existing stored data retained | Historical read-only view only |

All new device Push targets use **同步文件夹/Push/<SourceName>**. All newly provisioned enabled Pull targets use **同步文件夹/Pull/<Connector>/<SourceName>**. There is no device-name ancestor. Source.DeviceID is the canonical Push identity, not a display path; mobile identity credentials do not confer Agent/Root rights. Native iOS/Android generic Source PATCH/DELETE/Trigger/Archive/Restore and Owner-only active Run cancellation are denied by the integrated Server authorization checks.

The Server remains the only durable cloud writer: **UploadSession → chunks → finalize → CAS/Node receipt**. Source data, versions, credentials and original Node/CAS are retained on archive. The old target directory, SourceID, Node, CAS, Share and receipts remain in place; **no historical directory migration or silent adoption** is in scope.

## 2. Confirmed executable follow-up gaps

| Priority | Gap / action | Acceptance evidence to add |
| --- | --- | --- |
| P0 | Shared Source Manager incorrectly describes local-folder Push as having no executor. Explain that the owning Agent performs execution and that Server/foreign devices cannot remotely start local filesystem scans. | Shared TS view and details dialog assertions, no remote Run-Now regression |
| P0 | The Server exposes the verified canonical Push Source.DeviceID, but the shared TypeScript Source DTO and details do not display that binding. Show the verified DeviceID only for Push, with no secret token or legacy identity fallback. | Source DTO display tests for valid, missing, and Pull-only device claims; server SourceDeviceID contract remains authoritative |
| P1 | Native iOS/Android backup screens and shared Source Manager represent the same Source/Target/Run yet have different status/configuration affordances. Audit bounded-batch counts, partial/error/unknown-ACK displays, Owner switch, background cancellation, and foreign-device read-only behavior; extend **specific missing** executable contracts, not a parallel backup engine. | Swift/SQLite, Android/JVM/instrumentation, Go/PostgreSQL and shared adapter regressions where coverage is absent |
| P1 | Source lifecycle across Web/PWA, Desktop and DSM Host adapters still requires a feature-by-feature capability audit: create, configure, resume, pause, archive, restore, history and errors must never advertise an unavailable native action. | One shared capability/negative-action contract per concrete Host; no fake permission state |
| P1 | The canonical Source progress vocabulary is not a whole-device-backup completion guarantee. Keep each iOS/Android SourceRun as a bounded batch and reject inferred full-library success from scanned, confirmed or old local receipts. | Native SourceRun state and UI tests for partial/unknown/archived cases |
| P2 | Optional **cloud-only cleanup** of a retained Source has no standalone preview + explicit confirmation + reversible Trash implementation. It is separate from normal Source archive/remove, and is **not** required for the current backup MVP. | Future dedicated Source/Node/Share/CAS integrity and rollback PR, only if this capability is prioritized |

The first two P0 display gaps are addressed in the same post-merge UI/documentation PR as this audit. The remaining work must be checked against accepted master and open PRs before changing code; tests already present in #4082 are not unfinished features.

## 3. Source/security regressions to maintain for subsequent changes

These are acceptance invariants, **not** an instruction to rewrite the completed #4082 implementation:

1. A wrong Owner, revoked/wrong Device, stale SourceRevision or wrong Target must never create an UploadSession, mutate a Node/CAS receipt or convert an uncertain ACK to confirmed.
2. Local Folder Push requires the owning Agent and verified Root. A Web/Owner session alone may view history but cannot start or archive another device's Source.
3. Native mobile credentials have PhotoKit/MediaStore-limited rights; never grant ordinary Files upload, generic Agent authority, or Owner-root fallback.
4. One Source's retry, backoff or cancellation must not mutate another Source/Target; Yike Pull remains independently scheduled, and dormant Synology Pull must still reject new execution.
5. Source delete/archive/restore must preserve historical SourceItems, SyncRuns, Node/FileVersion/CAS; no Source-side delete propagates into cloud data under backup semantics.
6. Newly created targets must be Server-provisioned, exclusive and revision-checked; rename must preserve the same TargetNodeID, Share identity and existing versions.

Relevant already-integrated automated coverage includes source_managed_flat_contract_integration_test.go, managed_upload_authority_bridge_integration_test.go, android_photo_managed_uploads_integration_test.go, ios_photo_managed_uploads_integration_test.go, local_source_archive_integration_test.go and synology_pull_disabled_integration_test.go. Re-run affected tests only for actual changed inputs and never replace them with regex-only authorization checks.

## 4. Explicitly excluded or suspended — not backlog items

- **No historical target migration**. Old Yike/mixed-root/nested 1A–5B migrations are tracked separately under historical Issue #3774, not this new-source MVP.
- **No standalone DSM Synology Photos Push**; do not restore xdrive-source-agent, its upload routes or a parallel CAS writer.
- **No re-enabling Synology Photos/Files Pull** until a separate Owner decision. Keep existing data/history readable and execution disabled.
- **No remote device backup trigger from Web/Desktop/DSM** for PhotoKit/MediaStore or an unowned local Root.
- **No full-library success claim** from a bounded iOS/Android batch or a guessed storage count.

Physical/production acceptance remains **跳过（未验收）** and is not part of this actionable repository-task list.
