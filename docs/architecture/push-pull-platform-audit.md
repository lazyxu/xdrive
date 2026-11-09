# Unified Push/Pull — post-merge platform audit

**Snapshot:** 2026-11-09; [#4082](https://github.com/lazyxu/xdrive/pull/4082) merged as **1761b8fc3c2669c82bf6fa8c36e8a38749d4def9**; [#4093](https://github.com/lazyxu/xdrive/pull/4093) merged as **e38ff7ed9aaf32b01e034a5a4e344f65d584320d**.
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

## 2. Accepted #4093 closure and remaining actionable safety work

[#4093](https://github.com/lazyxu/xdrive/pull/4093) is **merged**, not a queued candidate. Its exact HEAD `e5b8401e20b6b53abf5e75d2a8b8bd5646a9f6c3` completed the applicable GitHub CI successfully before the accepted merge. Do not reopen its nine already delivered P0/P1/P2 workstreams:

- iOS and Android bounded Source/Target/SourceRun/receipt consistency tests, including native-source generic-operation denials;
- Web/Desktop/DSM Source Manager capability checks, verified DeviceID, accurate local Agent guidance and partial/failed/cancelled histories;
- Source archive/restore versus unsettled uploads and Files jobs, Yike Pull failure isolation and Source state regressions;
- archived Yike Pull-only cloud cleanup via a separately confirmed preview, reversible Trash and preserved Source/Node/CAS history.

The follow-up security review found two concrete server-only gaps in the **new cloud-cleanup endpoint**, not in the already verified one-writer Push/Pull upload protocol:

| Priority | Actionable change | Evidence |
| --- | --- | --- |
| P0 | Inspect all live descendants of an archived Yike target **without Owner filtering** before trashing it. Historical cross-Owner parent edges must fail closed rather than being skipped by the ordinary Owner-scoped subtree query. | Isolated PostgreSQL foreign direct-file and nested-directory regressions: preview and previously issued confirmation both reject, with all Nodes preserved. |
| P0 | Block all foreign-Owner Source targets and active Share claims into the same tree, and apply the archived **Yike Pull-only** eligibility check on the server API, not only the Web UI. | PostgreSQL cross-Owner Source/Share negatives, plus valid canonical Push and dormant Synology Pull target paths forbidden. |
| P1 | Ensure this document and the canonical architecture state the merged #4093 result accurately; keep the new security patch a separate PR until its exact HEAD CI/Final Gate passes. | No claim that unverified branch work is accepted master. |

These follow-ups are on `fix/sync-cleanup-cross-owner-fence-20261109` until reviewed and merged. They do **not** broaden cleanup beyond archived Yike Pull, move historical directories, change native backup execution or create a second CAS writer.

## 3. Source/security regressions to maintain for subsequent changes

These are acceptance invariants, **not** an instruction to rewrite the completed #4082 implementation:

1. A wrong Owner, revoked/wrong Device, stale SourceRevision or wrong Target must never create an UploadSession, mutate a Node/CAS receipt or convert an uncertain ACK to confirmed.
2. Local Folder Push requires the owning Agent and verified Root. A Web/Owner session alone may view history but cannot start or archive another device's Source.
3. Native mobile credentials have PhotoKit/MediaStore-limited rights; never grant ordinary Files upload, generic Agent authority, or Owner-root fallback.
4. One Source's retry, backoff or cancellation must not mutate another Source/Target; Yike Pull remains independently scheduled, and dormant Synology Pull must still reject new execution.
5. Source delete/archive/restore must preserve historical SourceItems, SyncRuns, Node/FileVersion/CAS; no Source-side delete propagates into cloud data under backup semantics.
6. Newly created targets must be Server-provisioned, exclusive and revision-checked; rename must preserve the same TargetNodeID, Share identity and existing versions.
7. Cloud-only cleanup remains archived Yike Pull-only, must reject cross-Owner Nodes, Source claims and Shares, and must preserve all live Nodes when any proof is ambiguous.

Relevant already-integrated automated coverage includes source_managed_flat_contract_integration_test.go, managed_upload_authority_bridge_integration_test.go, android_photo_managed_uploads_integration_test.go, ios_photo_managed_uploads_integration_test.go, local_source_archive_integration_test.go and synology_pull_disabled_integration_test.go. Re-run affected tests only for actual changed inputs and never replace them with regex-only authorization checks.

## 4. Explicitly excluded or suspended — not backlog items

- **No historical target migration**. Per the 2026-11-09 no-production-data decision, the old Yike reparenting/splitters, read-only migration-preview API and uid_* target adoption have been removed; no new migration work is tracked. Cloud cleanup remains a separate confirmed reversible Trash action, not migration.
- **No standalone DSM Synology Photos Push**; do not restore xdrive-source-agent, its upload routes or a parallel CAS writer.
- **No re-enabling Synology Photos/Files Pull** until a separate Owner decision. Keep existing data/history readable and execution disabled.
- **No remote device backup trigger from Web/Desktop/DSM** for PhotoKit/MediaStore or an unowned local Root.
- **No full-library success claim** from a bounded iOS/Android batch or a guessed storage count.

Physical/production acceptance remains **跳过（未验收）** and is not part of this actionable repository-task list.
