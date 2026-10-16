# xDrive Blob / CAS 去重全链路与性能审查（v1.0）

**审查时间：2026-10-16。状态：Source-audited / 测试缺口已冻结；不是现场机器性能认证或生产代码优化。**
**源码基线：** lazyxu/xdrive GitHub master 1eebb460cedda1f8f712d117e04e717ba21d9a88。本文只审查已读到的生产实现与测试，明确区分「有代码和测试」与「生产真实负载已测」。本审查不改任何产品行为，**不触碰 Race、用户所有的上传/同步/删除任务所有权**。

## 0. 先读的去重和性能证据

- [统一历史性能登记簿](performance-test-registry.md)，记录每一负载的物理 CAS 原片数、缓存/平台、CPU/RSS、原始 CI、接受/拒绝/无效来源。
- [六平台性能覆盖矩阵](performance-platform-coverage.md)：原生 Desktop、宽屏 Web、窄屏 Mobile Web、Desktop installed PWA、Android installed PWA、iOS installed PWA 必须分别报告，**任何窄屏 Chromium 测试都不等于手机真机**。
- [FileExplorer 性能规范](file-explorer-performance.md)、[图库规范](gallery-performance.md)、[同步规范](sync-performance.md)、[物理空间清单](storage-inventory.md)。
- 已合入的 P038、P049、P050 是三种独立客户端的 100k 逻辑/115k 不同物理 JPEG/H264/Live Grid/Details 负载；P044/P045/P051 各自为 4GiB 高熵原片上传/下载。P053 [#1739](https://github.com/lazyxu/xdrive/pull/1739) 原生 Desktop 3组100k SHA不同JPEG／54/54真正 Go Request.Context.Done，最终准确证据 HEAD 最慢69.986ms、旧 Handler0、额外字节0B，已合入；P054 [#1756](https://github.com/lazyxu/xdrive/pull/1756) 宽 Web 与100k实体JPEG取消属于不同新负载，当前原版 CURRENT 真实性能尚待专用 CI。独立 PWA 三种已安装设备目前 **Not measured**。
- [#1185](https://github.com/lazyxu/xdrive/pull/1185) Desktop 图库 IPC 最终累计字节进度为 Blocked Draft；不能以旧的成功头代替当前失败源的交付。

## 1. 既定不变量及真正的底层架构

数据所有权及关系必须区分：**Node/File/FileVersion 是逻辑身份**、[PhotoAsset/Resource/Collection](../internal/meta/photo.go) 是多资源与相册语义、[ContentBlob](../internal/meta/models.go) 是全局完整内容对象的元数据索引，而 [Local CAS](../internal/storage/storage.go) 保存共享物理原片。文件改名、移动、同内容多份、同一张图进入多个相册，都不应该复制原片。

核心键采用完整 SHA-256：.xdrive-blobs/sha256/前2位/完整64位hash；ContentBlob 以 SHA256 为主键并保存 Size、StorageKey、RefCount、ready/deleting State。**相同完整内容**共享物理 CAS；而内容仅差一字节的两个完整大文件目前为不同 CAS 对象，不能声称已做到 delta/chunk dedup。

主链路（代码事实，不代表所有步骤都已独立压测）：

1. Web/Desktop/Agent/外部 Pull 进入 resumable upload/session 或临时 source staging（[Server uploads](../internal/api/uploads.go)、[Source Pull executor](../internal/pullsync/executor.go)）。
2. 服务端验证原片真实 SHA256、长度与来源；规范化 CAS key（[immutable CAS](../internal/storage/cas_immutable.go)）。
3. ContentBlob 的 SQL 加锁、refcount+1、在引用达0时转 deleting，并在上传复用保护撤销后删除物理对象（[retain/release/GC](../internal/api/content_blobs.go)）。
4. File/FileVersion/PhotoResource/Collection 是索引与关系，不是另一个原始二进制存储（[meta models](../internal/meta/models.go)、[photo models](../internal/meta/photo.go)）。
5. 512px 缩略图、512px 视频 Poster、分析预览是独立**可再生成**缓存，优先以来源 SHA + 渲染版本 + 边长命名；它们并非第二份原片 CAS（[thumbnail](../internal/media/thumbnail.go)、[video poster](../internal/media/video_poster.go)）。

跨账户同字节原片共用单一 CAS，但「当前账户物理占用」按**该账户不同 StorageKey**计费，不允许把不同账户的容量简单求和当成整机使用量（[quota SQL](../internal/api/quota.go)；[cross-owner test](../internal/api/dedup_integration_test.go)）。内容哈希不可成为绕过 Owner 权限的下载、存在性探测或跨租户秒传接口。

## 2. 按层审查：正确性、效率、证据级别

| 层 / 源码 | 当前已确认的事实 | 性能与容量取舍 | 结论 / 下一证据 |
| --- | --- | --- | --- |
| **A1 物理内容身份** — [storage.go](../internal/storage/storage.go)、[cas_immutable.go](../internal/storage/cas_immutable.go) | SHA-256 全文件 CAS、写入流 hash、不可变 key；已有对象重用前真实读回 hash/size；Local Put 临时文件 fsync 与原子发布，CAS shard OS 锁保护 | 整文件去重很好；不代表跨版本差异分块复用；验旧CAS有哈希 I/O 成本，不可为性能擅自删除 | **功能实现 + 单测有证据**；4GiB重复写入 / hash CPU / FS write amplification 需分负载测 |
| **A2 Blob 元数据和引用** — [content_blobs.go](../internal/api/content_blobs.go)、[models.go](../internal/meta/models.go) | 按 hash 锁及行锁 + refcount；FileVersion 和复制引用使用同 CAS；释放按最多200条SQL分批；引用清零转 deleting | 正确维护一个原片多引用；引用数大和100k批删仍可能引入 DB/GC 尾延迟 | [dedup integration](../internal/api/dedup_integration_test.go) 证实4个不同账户/文件引用同CAS和最后删除；100k删除参考 P047 HTTP204/P50 155.241s（独立历史样本） |
| **A3 身份权限与秒传** — [instant_upload.go](../internal/api/instant_upload.go) | 仅 Owner 已持有相同 hash 当前文件或历史版本，才允许请求不传字节的秒传；跨 Owner 只在完整字节上传并校验后重用 Server 物理 CAS | 防止公有哈希存在性探测；跨账户不会节省首次网络传输是安全取舍，不应盲目改变 | [owner EXISTS SQL test](../internal/api/instant_upload_ownership_performance_integration_test.go) 与 [existing CAS finalize test](../internal/api/upload_finalize_existing_cas_performance_integration_test.go)；热点索引/真实100k Owner查询需继续画像 |
| **A4 分块上传、首次拼装** — [uploads.go](../internal/api/uploads.go) | 8MiB 默认分片（4–16MiB范围），真实分片完整 hash；若目标全内容 CAS 已存在，finalize 只流式扫描校验、不创建第二份 assembled temp；新内容通常分片暂存+组装完整 temp 再 CAS Promote | **新 4GiB 原片可能在某窗口占用分片约4GiB + 组装约4GiB**，属于源码推导的*潜在容量峰值*，不是现场已测数据；预留容量、写入IO、反复校验可能主导速度 | 先测 4GiB 新原片、跨账户已有CAS、同Owner秒传三种不同负载的 staging峰值/写放大/吞吐/耗时和真实性，再试硬链接、临时策略等备选 |
| **A5 外部同步 Pull 与本机 Push** — [pullsync/executor.go](../internal/pullsync/executor.go)、[staged CAS materialize](../internal/storage/localpush_new_cas_materialize.go) | Pull 走有 digest 的 resumable upload / overwrite；本机 Push 新CAS helper 有 bounded <=64MiB staged hash 校验+create-only hardlink，但代码明确称仅物理预备，不等于 SourceCommit/耐久 ref | 整文件 CAS 最后可复用，来源远端网络读/本机暂存仍可能重复；现在不能证明通用跨源免下载或后台任务断点性能最优 | **真实 100k 不同物理 Pull/Push、多来源相同哈希、断网/恢复尚未六平台测**；不可把物理存在预检查冒充 durable commit |
| **A6 文件与版本/复制** — [File and FileVersion](../internal/meta/models.go)、[batch copy](../internal/api/file_operation_copy_source.go) | 一个复制文件逻辑 Node 可继续指向原 StorageKey，版本用历史引用保留，而不是自动复制原始字节 | 同内容文件逻辑数量可为100k、物理CAS可以只有一个；版本若内容任何字节变化则完整SHA不同 | 需要单独核实 100k UI复制/版本/恢复与 RefCount，CPU/SQL/物理字节；不可将版本“零新增字节”泛化到不同原片 |
| **A7 图库/Live/相册** — [photo model](../internal/meta/photo.go)、[photoasset reconcile](../internal/photoasset/assets.go) | PhotoAsset→多 PhotoResource(Node 或 derived)，CollectionAsset 多对多不复制原片；Live still/motion/RAW sidecar 是不同资源 | 正确应保留逻辑身份、pair证据和原文件，按资源 SHA/Node 引用；照片“视觉重复”与真正逐字节相同不是一回事 | 100k图库混合渲染已测；RAW/HEVC/LIVP、Live Motion连续播放、图库与文件复用相同字节的峰值 I/O 仍 **Not measured** |
| **A8 缩略图/Poster/缓存** — [thumbnail.go](../internal/media/thumbnail.go)、[video_poster.go](../internal/media/video_poster.go)、[media_derivatives.go](../internal/api/media_derivatives.go) | 原始SHA存在时 key 优先 SHA+派生版本+尺寸，避免每个 Node 各写相同缩略图；无hash fallback Node/revision；派生缓存和 CAS 原片分类不同 | 内容相同的可再生成派生可重用；不能假定 100k 不同原片都命中热缓存，不能把 JPEG poster 帧当 Live Motion 视频播放 | 合并浏览器/Electron缓存与Server派生缓存命中率的读IO/生成任务、EXIF方向/尺寸/alpha结果正确性压测 |
| **A9 删除与 GC** — [content_blobs.go](../internal/api/content_blobs.go)、[cas health](../internal/maintenance/cas_health.go) | RefCount=0 后删除 guarded by reused upload parts, 128行/次 reaper；批量 refcount SQL 已按200 batch；文件删除不应误删被其他账户/版本引用的对象 | 大量不同CAS 删除通常需要海量inode/事务/FS操作；回收滞后真实存在且有“blocked_by_upload”指标 | 100k physical永久删除的Go HTTP层有已验收P047，**各端 UI/Push/Pull端到端100k删除/Undo和GC耗时未完整验证**；先做磁盘系统调用/SQL画像 |
| **A10 空间/配额与真实去重率** — [quota.go](../internal/api/quota.go)、[storage_history.go](../internal/api/storage_history.go) | Owner distinct key去重占用与全局真实CASPhysicalBytes分别计算；StorageSample有 CASDedupRatio、P50/P90/P99大小、legacy、pending GC、size bucket | 跨账户总“个人物理”不是主机物理总量；不能以照片数量或单一逻辑字节推断 SSD 占用 | 必须从真实部署的日快照抽样才判断 pack/CDC 价值；该用户现场数据 **未读取 / Not measured** |
| **A11 备份** — [server-backup.sh](../scripts/server-backup.sh) | 维护窗口校验 DB+CAS，数据库 pg_dump，自带文件数据时每次生成完整 blobs.tar 与 SHA256SUMS，提供 --skip-file-data | **主 CAS 整文件去重不自动让不同 blobs.tar 快照增量去重**，每次完整备份磁盘/CPU/时间/容量可能高 | 优先评估用 restic/Kopia/Borg 类增量内容仓库装载保留 DB一致性点、快照/回滚和按SHA验证；不要直接改已有备份恢复格式 |
| **A12 客户端本地缓存/安装态 PWA** — [Web transfers](../web/src/transfers.ts)、[Web API](../web/src/api.ts)、[Desktop Agent](../internal/client/client.go) | Browser OPFS/Cache Storage 与 Desktop Client/Agent本地缓存是不同存储域，服务端CAS refcount不自动约束设备私有缓存 | 多台设备缓存同内容可能重复实际本地盘占用；离线 pin、退出、Service Worker、权限域要独立 | 六平台必须单列；真 Desktop/Android/iOS installed PWA 当前 Not measured；不得把 390px Chromium作为OS后台能力证明 |
| **A13 遗留数据迁移与灾备** — [cas_health.go](../internal/maintenance/cas_health.go)、[verify.go](../internal/maintenance/verify.go) | 显式 legacy→CAS 修复、完整 hash 检查及 metadata drift 报警；CAS shard 锁用于多实例物理lease | 自动归档/重复全盘 hash 与备份读取昂贵；数据真实性不能只依靠同 size 的Stat | 校验修复及备份不得跳过真实 missing/hash mismatches；[#1748](https://github.com/lazyxu/xdrive/pull/1748) 正处理旧升级校验对持久CAS锁的误报，**本审查不宣称它已合入** |

**分级结论：** 对“不同逻辑文件引用同一份**完全相同原始内容**”已有明确正确性实现、集成测试；“任意大文件仅改少量字节仍节省空间”和“每次备份只写变化数据”尚不成立。就性能最优性而言，全链路未有足够同设备、同数据、原始 CURRENT 的现场CPU/RSS/FS实际写入与恢复数据；**不能证明所有层已最优，也不能证明引入CDC一定有益**。

## 3. 不应冒进的3个优化热点

### 3.1 新内容分块上传阶段的 I/O 和峰值空间

按已有代码推导：N个 resumable 上传分片先有 Staging，若目的 CAS 不存在，finalize 在全量校验同时组装完整 newKey，随后 Promote 到 CAS，分片仍在 finalize 后清理。**理论上的临时驻留可接近2份完整文件**，若另有 FS/page cache/业务快照可更高；这不是已测试的“2x”结论。必须测试真实4GiB、源实体分配字节、peak bytes、write bytes、fsync、Agent/Go CPU/RSS、finalize P50/P95、持久恢复与Quota预留是否正确。不要为节省空间切掉 hash/atomic sync、改写已有 CAS 或延迟所有权检查。

### 3.2 100k CAS 生命周期与 GC

P047真实10万物理CAS永久删除修复后 HTTP204，独立历史 P50 155.241s；此前 HTTP500 不能充当有效BEFORE成功延迟。当前 batch refcount SQL 和删除候选的事务/FS IO已有优化，但没有证据表明每次 100k UI删除/Undo/中断/多账户共享 GC是性能最佳。提议测试 100k unique SHA 与 100k refs指向1个CAS 两个极端，记录 SQL calls/锁等待、真实 inode unlink数量、DB commit P50/P95、磁盘增长/回收滞后、读者完整性，决策前不得实施无测量的 GC 批提交重构。

### 3.3 全量备份与小文件 Pack / 大文件 CDC

xDrive已有[storageDecision](../internal/api/storage_history.go)内可观测、未自动执行的信号：
- 过去窗口 small<64KiB 对象**数量占比≥50%** 或 small<256KiB **数量占比≥75%** → 候选 small_file_packing；
- size≥16MiB **字节占比≥60%**、small<64KiB数量占比<35%、平均 full-file dedup ratio<1.15 → 候选 cdc；
- 其他情况 observe（不贸然变更）。需要足够时间点，否则 confidence=low。

建议将 **备份层的增量去重 PoC** 优先于生产 CAS on-disk 格式替换：增量备份可独立在快照/恢复路径试验，保留现有 CAS 与统一 FileExplorer 下载/挂载逻辑；全局换成 Chunk/Manifest 将影响随机 Range 下载、视频 seek、CfAPI/FUSE、GC引用、数据迁移和服务器恢复，风险远大于一条备份管线。

## 4. 外部开源实现对照（参考，不复制其假设）

| 项目 / 官方资料 | 值得借鉴的部分 | xDrive 不应直接照搬的部分 |
| --- | --- | --- |
| [restic design](https://github.com/restic/restic/blob/master/doc/design.rst) | 内容寻址 Blob、可验证不可变数据、Pack、Rabin CDC、快照先写内容后发布索引/根，增量备份原片与版本 | restic是备份仓库，不等价在线NAS FileExplorer随机写/Viewer/跨账户授权 |
| [Kopia architecture](https://kopia.io/docs/advanced/architecture/) | 底层 BLOB → content-addressable block → object，多个小block进Pack、按需加密/缓存/快照；适合评估多快照备份 | Pack化会引入索引、维护与GC放大，未必适合低延迟单文件原片 GET |
| [Seafile data model](https://manual.seafile.com/14.0/develop/data_model/) | Repo/Commit/FS/File/Block，文件引用 Block List 与内容定义分块，可减小大文件局部更新的版本字节和同步流量 | 数据模型、全局块共享范围与xDrive多账户权限/图库多资源并不直接相同 |
| [Borg internals](https://borgbackup.readthedocs.io/en/latest/internals.html) | 备份多代/多机器的全局内容去重、Chunk index、压缩/封装与可维护性；比较备份全量tar的成本 | 不能把备份特有的chunk key/加密索引直接作为应用在线CAS主键 |
| [Immich CLI](https://docs.immich.app/features/command-line-interface/) / [FAQ](https://docs.immich.app/FAQ/) | 客户端预hash能减少重复上传，但hash也耗CPU；服务端仍hash兜底；图库逻辑资产与重复判断需区分 | Immich外部图库重复识别不是全局；“所有媒体自动语义合并”并非逐字节 Blob 安全去重 |

## 5. 基准计划：全部新指标先标 Not measured

**统一规则**：每项先从[性能登记簿](performance-test-registry.md)精确去重，至少独立 n≥3 数据来源与真实端到端路径，冻结原版预算；先记录CURRENT、CPU/RSS/真FS allocated bytes/IO/SQL/网络与SHA。原版预算内不改。真实RED才做最小性能优化、相同环境/数据进行交替 BEFORE/AFTER，只有收益明确且没有IO/CPU/RSS/正确性退化才保留，反之记录 Rejected 并回退。下表只是未来待测，不可误报已完成。

| 稳定ID | 首测 CURRENT 负载（精确区分物理原片） | 量测决策数据 | 目前状态 |
| --- | --- | --- | --- |
| CAS-A01 | 100k逻辑Node指向 **同1个**真实CAS vs 100k各自唯一CAS，分别单Owner/双Owner/有历史版本 | SQL数量和延迟、refcount、stat/open/unlink、真实CAS数量/总Allocated空间、quota/恢复正确性 | **Not measured**（已存在相关小样本功能测试） |
| CAS-A02 | 4GiB真实不稀疏高熵原片：新上传一次→同Owner预hash秒传→跨Owner完整上传→内容SHA重用 | 上传网络字节/秒传是否真0字节、stage与assemble峰值、go/renderer RSS、FS bytes written、CAS inode数、p50/p95 | **Not measured**（独立原版4GiB吞吐P044/P045/P051已测，**不重跑等同负载**） |
| CAS-A03 | 同一4GiB原片A及只改变中部1MiB的B，多版本/同步/备份；同条件 compare full-file vs offline CDC prototype | 实际物理字节和写IO节省、chunk边界、CPU、随机Range/seek代价、恢复SHA与GC正确性、压缩视频典型样本 | **Not measured**；先确认生产文件分布是否满足 CDC候选 |
| CAS-A04 | 完整一致性维护点下，两次真实包含文件数据的备份：不变/1%变化/100%变化各n3 | 每份blobs.tar实体占用、备份时间、源读取/写盘、校验/恢复耗时、被中断场景、增量repository同条件对照 | **Not measured**；PoC 独立于既有备份格式 |
| CAS-A05 | 100k不同CAS和100k逻辑重复引用分别做后端与Web/Desktop GUI delete/Undo/GC，并夹杂活跃UploadPart引用 | Handler/Task Center owner生命周期、Postgres锁/事务、实际unlink、GC滞后、重启恢复、CPU/RSS/IO | **Not measured**（P047后端100k单独Accepted，UI与全场景待测） |
| CAS-A06 | 100k JPEG/H264/Live不同物理原片多Node共享hash，冷/热缩略图512 / poster / Viewer真实seek，多用户并发 | 原片CAS reads、派生缓存命中、独立cache inode数、派生字节、浏览器存活DOM/HTTP取消、颜色/朝向/像素一致 | **Not measured**（P038/P049/P050已覆盖其特定渲染负载） |
| CAS-A07 | Yike/Synology/LocalPush 100k不同真实来源、多来源重复、网络断开/恢复、重复文件和版本修改 | 实际远端bytes/API rate、upload stage/CAS新增数、Owner commit/失败续跑、Go ctx只取消无人消费的短请求 | **Not measured**，不得混淆已有计划任务成功数与此负载 |
| CAS-A08 | 相同 A02/A05/A06 必须六端验收，额外 Slow WAN / WiFi丢包 / OS后台 | 分平台 source exact n≥3、硬件/OS/安装态、p50/p95、CPU/RSS、实体盘/OPFS、SHA、恢复与 owner 任务语义 | **Native Desktop / Wide Web / Mobile Web只在旧特定负载已测；3种OS-installed PWA Not measured** |

建议优先顺序：**P054现有PR正确交付** → CAS-A01 全局100k ref与真实unique控制组（重点确认不重复字节与100k能力） → CAS-A02 4GiB staging空间 + 数据完整性 → CAS-A04增量备份独立可回滚PoC → CAS-A05 100k GUI/GC → CAS-A03按真实数据分布决定是否试CDC。PWA设备数据同步单列，不能给出模拟成功。

## 6. 严格的验收和禁改边界

- **永远不因为页面滚动或窗口关闭取消用户拥有的持久Upload/Download/Sync/Delete**；浏览器视口、缩略图、预览等无消费者的只读请求才透传 AbortSignal→Go ctx。
- 任何CAS或备份重构前，冻结恢复数据、校验SHA256、引用计数不变、Owner授权、跨账户秒传不泄露存在性、版本/Live关系、replay/GC 可恢复点，先升级路径/回滚演练。不得用“压缩后体积更小”替代真实CPU/磁盘/读Range成本。
- 当前未实际连接服务器的CAS日快照或用户盘，**无法得知其CAS dedup比、容量分布或历史备份总量**。以状态 Not measured 记录，禁止虚构“最佳”选择。
- 这只是架构审查，没有新的实际 BEFORE/AFTER 秒数；因此不更新历史已测指标，也不修改[统一测试登记簿](performance-test-registry.md)为任何虚假的 Accepted 工作负载。CAS-A01..A08 初次真实测试时再把结果与本文件一起写回登记簿、六端矩阵和相应子系统规范。
