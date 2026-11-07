# Unified Push/Pull Source Management Architecture

> **2026-11-06 / 2026-11-07 integration decision:** DSM's separate
> `xdrive-source-agent` and the dedicated Synology Photos Push connector
> are retired. Only the owning DSM `local_folder` Push agent is enabled.
> Synology Photos Pull and Synology Files Pull are temporarily dormant; their
> source, credential, run, target, UploadSession and CAS history is retained.
> Yike Pull and device-scoped Desktop, iOS and Android Push remain enabled.
> These rules supersede older DSM Source Agent descriptions below.
> Native Local Push archive/paused restore requires the owning Device and
> verified Root proof, never an Owner session alone.
> New Push targets are grouped `同步文件夹/Push/<DeviceName>_<DeviceID>/<SourceName>`, and legacy
> target directories are not migrated.


**Decision:** 2026-11-05  
**Scope:** new Push/Pull Sources and new destinations. Old directories, file contents and receipts are not migrated. S01 allows only a verified Owner/platform-matched Source.DeviceID metadata backfill; it does not move targets or rebind unrelated devices.

This is the canonical cross-platform contract. Platform guides describe adapters and current as-built status; they must not define different Source lifecycles, destination namespaces, device identity rules, or Pull execution models.

## 1. Product decision

xDrive has **one Source management model** and two execution directions:

- **Push:** a registered device initiates transfer from a local filesystem or native media library to an xDrive-managed destination. Every Push Source is bound to one Owner, one registered Device, and one server-created Target Node.
- **Pull:** xDrive Server initiates transfer from a remote connector to an xDrive-managed destination. Every Pull Source is bound to one Owner, one connector configuration/credential set, and one server-created Target Node. Each Source run executes in an isolated Server-side Source worker.

The same Source API, Source Manager semantics, target provenance, run/history vocabulary, pause/archive lifecycle, and resumable UploadSession/CAS writer apply across providers. Scanning and native permission acquisition remain platform adapters.

Desktop UI, xd CLI, DSM UI/Task Scheduler, iOS and Android are entry points or executors, not separate backup products. Desktop Push and xd Push on the same machine use the same owning xdrive-agent, Device identity, Source, Root grant, journal and uploader. They must not create duplicate devices or runners.

## 2. Canonical destination namespace

All newly provisioned Source targets live below one root:

~~~text
我的文件/
└── 同步文件夹/
    ├── Push/
    │   └── <DeviceName>_<DeviceID>/
    │       ├── <SourceName>/
    │       └── <SourceName>/
    └── Pull/
        ├── Yike Photos/<SourceName>/
        ├── Synology Photos/<SourceName>/
        └── Synology Files/<SourceName>/
~~~

Rules:

1. 同步文件夹/Push and 同步文件夹/Pull are the only roots for new Push/Pull destinations.
2. The Server creates and pins one device-group Node per verified Device ID; its display-name portion is sanitized, never an authorization key. The editable leaf is the Source name. No ordinary same-named device folder can be adopted.
3. Pull connector directory names are fixed product identifiers. Synology Pull suggests its remote NAS name; Yike Pull suggests the remote account nickname. Only the final leaf can be edited.
4. The Source leaf is the validated Source name. All Push kinds of one Owner share a unique, case-insensitive name namespace; all Pull connectors share a second namespace. Archived Sources still reserve their names. Source and Node renames are one revision-checked Server transaction.
5. Server creates the final path and leaf in the Source provisioning transaction, including a new Yike Source before credentials are attached. Clients cannot submit a target_node_id, cloud parent ID or absolute cloud path.
6. Source.TargetNodeID is the stable target identity; paths are display-only and never authorization.
7. TargetManaged is set only after successful Server provisioning. Existing managed-subtree write guards remain mandatory.
8. Occupied leaves, unverified ancestors, duplicate bindings and overlapping Source subtrees fail closed. Never adopt an ordinary same-name folder.

Current master contains older layouts such as 同步文件夹/设备备份, 同步文件夹/远程拉取 and Yike-specific 同步文件夹/一刻相册. These are as-built gaps, not the target contract. New-source provisioning must use Push/Pull. No old-directory migration is requested.

## 3. Source types and entry points

| Mode | Source kind | Direction | Executor |
|---|---|---|---|
| Local Folder Push | local_folder | push | owning xdrive-agent |
| Desktop Push | local_folder | push | same owning xdrive-agent |
| xd Push / xd backup | local_folder | push | same owning xdrive-agent |
| iOS Photos Push | ios_photos | push | native PhotoKit runner |
| Android Photos Push | android_photos (to add) | push | native MediaStore / WorkManager runner |
| DSM Photos Push | synology_photos | push | DSM xdrive-source-agent |
| Yike Photos Pull | yike_photos | pull | Server Pull Worker |
| Synology Photos Pull | synology_photos | pull | Server Pull Worker |
| Synology Files Pull | synology_files | pull | Server Pull Worker |

Kind and direction together identify the connector. Synology Photos legitimately uses the same kind for Push and Pull; never infer direction from kind alone. Desktop Push and xd Push are not separate Source kinds or upload implementations.

## 4. Unified Push device identity and binding

Every Push executor has an Owner-scoped ClientDevice:

- Server issues a stable Device UUID and high-entropy token once; it stores only a credential digest.
- Raw token stays in the platform's protected credential store.
- Device identity is separate from Owner login and local Root / Photo Library permission.
- Revocation blocks Source mutation, upload admission, background grant renewal and run execution.
- A Device may own multiple Push Sources, each with its own Source ID and target leaf.

| Platform | Identity | Allowed Push authority |
|---|---|---|
| Windows / Linux / macOS Desktop | registered Device + protected Agent token | owning Agent + verified local Root |
| xd CLI | reuses Desktop's Device and Agent | no separate credential or Runner |
| Synology DSM | registered Synology Device + protected source-agent token | source-agent + verified Personal/Shared roots |
| iOS | registered identity-only Device | dedicated PhotoKit managed-upload / BG grant routes only |
| Android | registered identity-only Device | dedicated MediaStore managed-upload / BG routes only |

iOS/Android identity-only credentials must never become Desktop Agent credentials, generic local-folder Root grants or arbitrary Files-write permissions. Synology must be a distinct platform identity, not disguised as generic Linux Desktop.

### Provisioning flow

1. Owner logs in to the current Server.
2. Platform enrolls or verifies its registered Device.
3. Client submits Source kind, direction=push, validated Source name and Device proof. It does not choose a cloud destination.
4. Server validates Owner, Device platform/token/revocation, supported kind and uniqueness.
5. In one SQL transaction, Server creates a paused Source, pinned Device-group Node, Source leaf, TargetNodeID, TargetManaged and Source-to-Device binding.
6. Platform obtains local capability: verified filesystem Root for Desktop/xd/DSM, PhotoKit permission for iOS, MediaStore permission for Android.
7. Platform binds/proves that capability to the exact Source. Missing or stale permission never falls back to Owner root.
8. Each upload admission and finalize rechecks Owner, Device, Source, TargetNodeID, provenance, platform-specific permission proof, revision and receipt constraints.

`Source.DeviceID` is the canonical Push ownership authority. New Local Folder, iOS and DSM Sources populate it; `LocalCreatorDeviceID` is historical metadata, not a write-authorization fallback. A narrowly scoped startup backfill resolves only existing same-Owner, platform-matched device registrations; unverified claims remain unbound. No file or target is moved. Root and Photo Library permissions remain separate from device identity, and iOS/Android/Synology credentials never grant Desktop Agent access.

### One writer per device/source

- Desktop and xd share one owning xdrive-agent and durable per-file Operation journal.
- DSM MVP uses the owning xdrive-agent local_folder Push and the same Server Source, Device, target, run and CAS receipt contracts.
- iOS and Android keep native encrypted intent ledgers and OS permission checks, but reuse the Go UploadSession/chunks/finalize/CAS writer through narrow authorization routes.
- No second CAS writer, blind retry after uncertain ACK, or whole-Source completion claim from one batch.

## 5. Unified Pull Server Worker

Pull is always Server-executed. Desktop, browser, phones and DSM do not execute remote Pull and need not stay online.

- One long-lived Server Pull Worker service hosts the connector dispatcher.
- Each eligible Source receives an isolated worker execution context, cancellation context, run lease, checkpoint, retry state and progress. This is logical per-Source isolation, not one OS process/container per Source.
- Yike Photos, Synology Photos and Synology Files are adapters in the same dispatcher; they do not own separate schedulers or upload pipelines.
- Each Source stores its own encrypted credential/configuration, schedule, checkpoint, SourceItems and SyncRun history.
- Shared scheduling provides bounded global concurrency and per-upstream-account serialization. One Source's timeout, expired credential, 429 or bad item cannot block unrelated Sources.
- Manual trigger, scheduled run and retry use the same Source worker path; manual work has priority.
- Pull writes only to its exact TargetNodeID and reuses the shared planner, SourceItem identity, resumable UploadSession, CAS finalize and execution-commit protocol.
- Synology Pull credentials are Server-side encrypted and are never reused by the DSM Push agent.

The existing internal/pullworker Runner already provides shared dispatch, per-Source jobs, bounded concurrency, manual/retry/scheduled ordering and account concurrency keys. Keep it; repair connector registration and target provisioning rather than creating another worker framework.

## 6. Source lifecycle and management

Equivalent semantics are required on every platform, even when native UI differs:

- **Create:** paused draft, validated device/provider, one managed target.
- **Configure:** Source name, schedule, ignore rules and connector config with optimistic revision checks. Credentials are write-only and encrypted.
- **Run now:** owning device Agent for Push; Server worker for Pull. Never start a second runner.
- **Pause / Resume:** stop new admissions and preserve unresolved operations/checkpoints. Resume requires current device/credential/local permission proof.
- **Status:** distinguish configured, eligible, queued, running, partial, failed, paused, needs-auth, needs-permission and archived. A saved schedule is not proof of an armed run or exact next-run time.
- **History:** per-Source real scanned/transferred/verified counts, unsupported items, failures and uncertain ACKs. Never infer whole-library completion from a bounded batch.
- **Remove:** archive configured/used Sources by default. Restore is explicit and leaves the Source paused. Cloud cleanup is a separate confirmed Trash workflow.

MVP uses backup semantics only. Source-side disappearance must not delete xDrive files. Mirror deletion, remote mutation and automated cloud cleanup are not MVP prerequisites.

### Management surfaces

- Web/PWA, Desktop and DSM converge on shared Source Manager / XDriveApp semantics for list, configure, run-now, pause, history and archive/restore. Unsupported Host actions are explicit.
- Device Backup cards may remain convenient entry points, but operate on the same Push Source records; they must not maintain a parallel catalogue.
- iOS and Android use native SwiftUI / Compose screens over the same Source/target contract, not a second source database.
- A foreign device's Push Source is read-only elsewhere. Other devices may see redacted status/history but cannot acquire its Root or start a remote scan.

## 7. Shared data contract

| Object / field | Contract |
|---|---|
| Source.ID / OwnerID | unique Source and one owning account |
| Source.Kind + Direction | connector and direction; check both |
| Source.DeviceID | generic Push creator/executor Device binding |
| Source.TargetNodeID | exact stable managed destination |
| Source.TargetManaged | Server-provisioned target provenance |
| Source.Revision / Status | stale-write fence and active/paused/archived lifecycle |
| Source.Schedule* | interval / cron / manual |
| SourceConnectorConfig | non-secret connector configuration |
| SourceCredential | encrypted, versioned Pull credential |
| SourceItem | stable external identity and current xDrive Node |
| SyncRun | durable Source history, counts, trigger, checkpoint and terminal state |

Push may retain private per-file journals for exact local identity and crash/ACK recovery. Source/SyncRun must still provide one Owner-visible status/history projection. Never expose raw local paths, tokens, PhotoKit IDs, MediaStore URIs or original bytes in generic Source DTOs.

See [the platform implementation audit](./push-pull-platform-audit.md) for the current gaps and delivery order.

## iOS Photos Push：统一 Source 状态与运行历史

iOS Photos 使用统一的 `Source(kind=ios_photos, direction=push, sync_mode=backup)` 和服务端创建的受管 Target Node。它与 Desktop 本机目录 Push 一样属于 Push，但执行端是已注册 iPhone，而不是 Server Worker 或 Desktop Agent。

- PhotoKit 枚举、原件导出、加密账本、上传与 Node 收据核验始终由 iPhone 执行。
- 前台手动、前台计划和集中备份通过现有 `POST /sources/:id/runs`、`POST /sources/:id/runs/:runID/progress` 和 `POST /sources/:id/runs/:runID/finish` 写入统一 `xd_sync_runs`；Owner JWT 与设备 Token 必须同时有效。
- iOS `BGProcessingTask` 不持有 Web bearer，使用独立的 `/ios/photos/background-managed/sources/:id/runs` 路由，通过已批准的 Photo Background Grant、注册设备 Token 和同一 Source/Target 绑定写入同一运行历史。每次事务重新检查 Grant 撤销、有效期、Owner Session、Server 实例、设备和目标目录；Grant 撤销后立即拒绝后续进度写入。
- 前台与后台接口都在每次写入事务内重新校验设备、Source revision 和受管 Target Node；后台路径额外重新核验 Grant 撤销状态、有效期、Owner Session 与 Server 实例，避免只依赖请求进入时的中间件检查。
- iOS Photos Source 在 Server 侧保持 paused，避免通用 Server 调度器或通用 Push 入口误执行。只有上述 iPhone 设备证明可以开始、更新和结束该 Source 的运行记录。Source Manager 的状态由最新 SyncRun 和 Source 的最近运行/成功时间派生，不把 paused 错显示为用户关闭了手机备份。
- 每条 SyncRun 表示一次有界的手动、前台自动、集中备份或系统 BGProcessing 批次；`complete_inventory=false`，不得把一个扫描窗口声明为整库完成。
- 只上传聚合计数：扫描、确认新增、云端原件已核验、待处理/不可用。PhotoKit localIdentifier、文件名、位置、原始媒体字节和逐项私有账本不进入 SourceItem 或 SyncRun。
- Source Manager 展示统一目标目录、最近运行状态和分页运行历史；不提供 Server 端 Run Now、通用来源设置、虚构的相册集合或逐文件错误快照。继续备份、权限和自动计划仍在绑定的 iPhone 上管理。


## S10–S18 accepted destination policy (2026-11-06)

- Push: `同步文件夹/Push/<DeviceName>_<DeviceID>/<name>`, with a stable Server-pinned device group. Pull: `同步文件夹/Pull/<connector>/<name>`, with only the leaf editable.
- The one Server-managed provisioner creates Source and Node together, refuses occupied ordinary leaves and overlapping Source subtrees, and returns an immutable TargetNodeID.
- PostgreSQL enforces Owner + Direction + case-insensitive Source name uniqueness across connector kinds, including archived Sources. Push and Pull may use the same leaf name.
- Registered Push device names, remote Synology NAS names and Yike account nicknames are defaults, not authorization proofs. User edits override suggestions.
- New Yike Pull creates its target at Source creation. Remote account identity is privately stored apart from its display name; refreshing credentials preserves the same target Node.
- Running/queued SourceRuns, active UploadSessions and unsettled local Push operations block rename. Otherwise Source/Node names and revisions commit atomically; child IDs and CAS receipts remain unchanged.
- Old Sources, old directories, and old receipts are not migrated or silently adopted.
