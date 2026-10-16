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
| CAS-A01 | 100k逻辑Node/File + 100k FileVersion 指向 **同1个**真实CAS，另2个跨Owner Keeper；100k不同SHA原片另由P047完成 | 三独立原版HTTP删 P50 **5.711080s**；末次跨OwnerGC P50 **32.263ms**，200002→2→0 RefCount、两个Owner各1024B物理配额、实体CAS最终回收；Go RSS增量峰 **94,650,368B**，CPU tick原始n3可追溯 | **Accepted original CURRENT n3（源码证据HEAD复验待完成）**，原版达标不优化；所有六端真实GUI仍Not measured |
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

### CAS-A02a 第一项实测实施（2026-10-16）

**Accepted original CURRENT n3（证据HEAD复验待完成），BEFORE=CURRENT，AFTER=N/A，增益N/A。** 先从已有P044验证的Web 4GiB不可压缩真实上传+下载链路补上源准确的**Linux实体CAS空间及Server写IO证据**。独立[n3 scoped CI](../.github/workflows/cas-a02-4gib-first-upload-space-io.yml)对每份新文件记录 `.xdrive-uploads/` 分片、拼装临时、canonical CAS（`st_blocks×512`），Go PID `/proc/<pid>/io` `write_bytes/read_bytes`；采用每250ms物理采样而不是仅以文件逻辑长度或事后 `du` 推断峰值。三份源必须各4GiB、非Sparse实际源SHA及全程下载OPFS相同；分别记录源+CAS真实字节、CPU、RSS、PUT/GET次数、n3、P50。冻结原版物理peak≤2.35×、Go写字节≤2.50×（对固有分片+组装预计两份驻留给出安全余量），final staging 0B；超出有独立有效原版RED才归因/最低风险优化。所有数字**尚未测出**；P044历史48.509s上传P50不可替代新的物理监控。

下一阶段 CAS-A01：100k逻辑共享一个CAS与100k真实不同CAS分组测refcount/SQL/GC；CAS-A04：两代不变与少量变化备份（原脚本生成完整blobs.tar vs独立增量backup PoC）；CAS-A03：4GiB仅修改中部1MiB版本与可选CDC离线对照。三项当前均 **Not measured**。整个过程仅性能，不更改上传完整性、RefCount、权限、备份事务、Race或用户持久任务所有权。

**CAS-A02 首轮有效 4GiB 原版 CURRENT n3（2026-10-16）：** 固定源 `e9eaddc6844ca5f35752556d229f8e790cc9425a` 的[真实专项CI #38846688152](https://github.com/lazyxu/xdrive/actions/runs/38846688152)与[完整 CI #38846687994](https://github.com/lazyxu/xdrive/actions/runs/38846687994)（25 success/51 skip/Final Gate成功）。三个独立PG17/Gin/Local CAS+1440px Wide Web，每组真实不可压缩、已实体分配的 **4,294,967,296B** 高熵不同SHA原片；**512×8MiB PUT**、正式CAS提交和单GET完整4GiB OPFS逐字节SHA验证通过。每250ms Linux st_blocks 实采真实物理文件（每组358–525次）：分片总占 **4,294,967,296B** + 同时存在的组装临时文件 **4,294,971,392B**，**峰值物理8,589,938,688B = 2.000000954×**；Go Server真实 `/proc/PID/io`内核write_bytes **8,589,934,592B = 2.000000×**，三组完全相同。Finalize完成后每组仅有**一个CAS物理文件4,294,971,392B，staging=0B**。上传耗时 90.9393/83.1656/70.3989 秒，**P50 83.1656s**；下载14.7187/14.3847/13.9866秒，**P50 14.3847s**；CPU/RSS、下载源校验、真实物理源、真实Put/GET和磁盘内核读写逐样本存储在 [CAS-A02原始summary/3样本/source](performance-evidence/cas-a02-real-web-4gib-staging-io/ci-run-38846688152/README.md)及原始[Artifact #12023618125](https://github.com/lazyxu/xdrive/actions/runs/38846688152/artifacts/12023618125)，原始ZIP SHA256 `e9c14e2e5b2fae273218ad9a9df3e1babcd0ffa3bec84373510a929d90d4c8b9`。每份机读JSON及source Git blob SHA和CI ZIP源码逐字节相同，未舍入。**原版符合先前冻结的物理峰值≤2.35×、Go写盘≤2.50×、零staging、真实CAS与SHA预算，因此接受原版、不改生产：BEFORE=CURRENT，AFTER=N/A，speedup=N/A。** 2.00×真实写盘是有意义的空间写放大事实，但不能凭结构偏好绕过已接受预算重新设计上传协议；未来如需优化，必须冻结新budget并做同源AB且无断点/完整性退化。证据修订后的**新HEAD准确专项CI+完整CI Final Gate待重跑**，不宣称其他五端此次实体写盘已测。CAS-A01 100k引用/GC、CAS-A04多代备份、CAS-A03局部变更保持 Not measured。

### CAS-A01b · 100k相同CAS的真实持久引用 / 双账户 GC（2026-10-16）

**Accepted original CURRENT n3（证据HEAD专项及完整FinalGate复验待完成）；BEFORE=CURRENT，AFTER=N/A，speedup=N/A。** P047已测“100k个不同物理1KiB Blob 的认证HTTP204及100k实体unlink”；新的CAS-A01b设计是**100k逻辑File + 100k FileVersion共用一个实际物理Blob**、另有两个Owner Keeper；DB ContentBlob初始RefCount精确200002。测试唯一 `Local.Put` 生成真SHA物理inode，Owner A/B各自物理配额仅1024B；真实Owner HTTP永久删除选中100k后RefCount2且物理数据不变，删除Owner A keeper后RefCount1且物理仍在，最后Owner B keeper删除后CAS物理0。这一形状不能从P047已合入的155.241秒推断加速。需3组独立真实PG17/Gin/Local CAS、CPU/RSS/前后配额、HTTP权限404/409、最后GC及物理文件数源准确样本。冻结原版100k HTTP≤1200s、最后两条Keeper GC≤120s、Go RSS增长≤512MiB，数据真实性和授权为硬门槛；原版达标不优化。新[CAS-A01分支专属CI](../.github/workflows/cas-a01-100k-shared-blob-ref-gc.yml)必须在数据有效后持久归档并重跑证据HEAD。Web/Desktop/Mobile Web的GUI与三种安装态PWA均Not measured。其他CAS-A04多代备份及CAS-A03修改1MiB版本仍Not measured。

**CAS-A01 首轮 Invalid harness（2026-10-16）**：冻结初始工作头 `09b50501abb106a4fa1827f31386887ebdb9dd0a` 的 [原生专项 CI #38853465577](https://github.com/lazyxu/xdrive/actions/runs/38853465577) 与完整CI #38853465503 的 `go-linux` 因源测试const组两行未按 `gofmt` 列对齐，在真实Go编译/PG17/100k真实SQL及Local.Put**之前**失败（精确 diff：`casA01NodeCount   =` → `casA01NodeCount     =`、`casA01BlobSize   =` → `casA01BlobSize      =`）。**valid n=0、未产生100k物理/共享引用性能样本，不是产品性能 RED。** 只修改测试文件格式及其精确源码字符串断言，永久存档[Invalid harness 原始成因](performance-evidence/cas-a01-shared-blob-100k-ref-gc/ci-run-38853465577-invalid.json)。原冻结真实单CAS/200002引用、三独立n3、所有Owner隔离、1200s/120s和512MiB预算完全不变；仍先测原版 CURRENT。

**CAS-A01 首轮真实有效原版CURRENT n3（2026-10-16）**：初始格式 Invalid harness #38853465577 已单独存档，改正测试常量列对齐后固定工作头 `fa97a9d48105a0c7c95c6eb51af1ff6430f573c9` [真实专项CI #38854311221](https://github.com/lazyxu/xdrive/actions/runs/38854311221) **SUCCESS**。三组独立PostgreSQL17/Gin/Local CAS真实单个1KiB SHA-256原片、100,000独立Node+File及100,000条历史FileVersion，加两个不同账户外部keeper，初始**200,002条真实DB引用只对应1个物理CAS文件**。两Owner配额均为**1,024B**，真实跨Owner非法404与过期Revision 409正确；通过认证Owner DELETE /trash/:id 均HTTP204，选中200k引用释放后Blob.RefCount=2、物理CAS始终为1、保护原片/其他账户没有被误删；最后仅在第二个Keeper被删除时实际物理CAS=0且Blob元数据=0。100k真实共享引用永久删除耗时三轮**5.585206/5.725223/5.711080秒、P50 5.711080秒**；两个Keeper最后GC **32.263/43.372/28.115ms，P50 32.263ms**；Go RSS增量峰值**94650368B**，源种入独立计时，真实Go CPU ticks每组76/79/78，Owner配额扫描P50为495.800ms，符合原版冻结≤1,200,000ms HTTP、≤120,000ms末次GC、≤512MiB RSS与所有物理/权限/计费门槛。**接受生产原版，BEFORE=CURRENT，AFTER=N/A，speedup=N/A**，既有P047 100k不同物理CAS HTTP204/P50 155.241s是完全不同负载、不得计算对比优化收益。原始Git blob SHA逐字节校验无改写的[3组机器JSON、summary、source及进程资源证据](performance-evidence/cas-a01-shared-blob-100k-ref-gc/ci-run-38854311221/README.md)与原始[完整GitHub Actions Artifact #12027180215](https://github.com/lazyxu/xdrive/actions/runs/38854311221/artifacts/12027180215) ZIP SHA256 `c2d22037dd2ba80cac3edae4b836f73c6e8f3680cc518e08ce9ea66edb99ad1e` 一一对应。归档后新HEAD必须重新执行准确专项n3与完整CI含Final Gate后才可Ready/合并。真实Web/Desktop/Mobile Web/OS-installed PWA六平台的GUI删除未在本专题执行，CAS-A04多代备份与CAS-A03 4GiB局部变更仍 **Not measured**。


## CAS-A04a（2026-10-16）新的多代备份文件数据阶段基准

见 [Server备份性能规范](backup-performance.md)。新增独立真实物理 CAS 400MiB、0/1/100%新历史版本保留的两代完整tar与逐SHA恢复n3×3测试，原版生产脚本仍使用 `cd /data && tar -cf - .`。本地探索0变化的两代归档合计839065600B，1%为843264000B，100%为1258577920B；原版时间预算通过但全量备份跨代空间不能去重。这不是完整Docker/PostgreSQL/一致性Server备份；新PR准确源码CI验收仍待执行，生产CAS/备份/恢复格式均未改。后续再评估restic/Kopia离线增量仓库和CAS-A03真正4GiB中部只改1MiB的版本成本，且先冻结真实恢复、配额/GC/性能边界。


**CAS-A04a 首轮真实 Linux GitHub runner基线（2026-10-16）：** 原始`16bd2bd417a42ab291fe001702828619f6189b5d` 专项[CI #38863629669](https://github.com/lazyxu/xdrive/actions/runs/38863629669)成功，n=3×零变化/+1%/+100%新历史原片，保留旧SHA物理CAS，两份tar实际占用P50 839065600 / 843253760 / 1258567680B，第二代tar P50 2714.525 / 2525.749 / 4963.380ms，真实解包P50 273.968 / 270.277 / 528.633ms。所有归档来源、完整恢复 SHA、CPU/RSS [归档在备份专项](performance-evidence/cas-a04-two-generation-tar/README.md)，原版≤180秒/代门槛通过。**不改变在线CAS或完整备份格式**，证据修订最终HEAD CI尚未完成，不能将单纯tar测量称PostgreSQL/Server应用一致性备份、多端上传或功能优化。下步同源增量仓库PoC和CAS-A03真4GiB仅改1MiB需另行实测。


**CAS-A04a归档头质量门槛（2026-10-16）：** 首次有效物理n3测试不等于归档修订HEAD最终通过；后续[CI #38864841379](https://github.com/lazyxu/xdrive/actions/runs/38864841379)的真实tar/恢复仍成功但最后证据文件放在源目录内部导致GNU tar报`file changed as we read it`，失败仅在测试工具。原始[逐字节不变13文件归档](performance-evidence/cas-a04-two-generation-tar/README.md)纠正为SHA256 `366bea2816b245255cc0ff6495b8ff1b479000fc18f56922595e9dcee676dab8`，追加分支CI对永久原始证据的强校验及生成输出临时目录隔离。要求新提交的专用+完整CI/FinalGate全绿后才允许合入，不能从runner变化声称增量性能优化。


## CAS-A03 / S001-d1：4GiB局部编辑版本原版实测启动（2026-10-16）

[专项计划](cas-version-performance.md) 冻结真正的生产`storage.Local.Put`双CAS路径：每个独立样本持久化2个4GiB、SHA不同的高熵原片，B只在中间XOR修改连续1MiB；全量8GiB读取验证两代SHA与精确变更，独立对比固定8MiB块的**理论**511/512复用潜力。第一次完整本地层真实n3还没有有效 GitHub CI；当前 **Benchmarking / BEFORE=Not measured / AFTER=N/A**，不应根据理论1块变化声称xDrive已经节省4GiB或已经上线CDC。

原版必保留全文件不可变SHA、FS持久化、跨账户权限/引用的生产现状。若要实做分块/CDC，先在离线备份PoC同源n3检测写IO、Hash成本、随机Range/视频Seek、CfAPI/FUSE、版本恢复和GC；真实移动端和installed PWA测试与此基准分列，且视口取消不得杀死持久上传/同步/删除。


### CAS-A03/S001-d1 已测原版存储层版本放大（2026-10-16）

[源准确专项 CI #38870252470](https://github.com/lazyxu/xdrive/actions/runs/38870252470) 实际执行三组生产 Local.Put 两个4GiB高熵 SHA-distinct原片、B中间准确修改1MiB、全量8GiB恢复SHA+512个8MiB块SHA，**3/3真实CURRENT通过**。每个样本两份CAS实体分配8,589,942,784B，新增版本分配4,294,971,392B，两次真实内核写入8,589,934,592B；新增B的 `Local.Put` P50 22,594.151ms / 进程Go RSS上限32,736KiB。固定8MiB块中仅1块变化/511块不变，仅意味着离线理想复用版本可能新增8MiB而不是现生产4GiB；**并未实现CDC，不能把512倍理论空间机会写为实际生产节省、吞吐提速或优化AFTER**。

完整SHA、原本跨账户隔离、不变CAS语义已通过本负载，但完整Server SQL FileVersion、跨账户秒传防泄露、视频Range/CfAPI/FUSE、多版本GC与6端还缺相互独立的安全/性能证据。原始完整[11个机器文件](performance-evidence/cas-a03-real-4gib-local-versions/README.md)永久归档；后续A03-d2离线分块PoC需要匹配同一内容的实际 block store bytes/read IO/CPU/RSS/Range及恢复n3，再考虑是否替代任何在线路径，符合先做备份离线PoC的低风险顺序。


## CAS-A03/S001-d2 — 实体8MiB固定块作为**备份先行**的离线空间A/B（2026-10-16）

真实[d1](cas-version-performance.md)已证明生产full-file SHA不可变CAS：只修改1MiB仍为整份4GiB新Blob。下一阶段仅新增 `internal/storage/cas_a03_offline_chunk_poc_linux_test.go` 的**opt-in离线单账户测试实现**；候选两份manifest合计指向**513个实际物理块（512旧版+1个新块）**，511个复用索引。与同轮生产 `storage.Local.Put` A/B比较实际分配字节和内核写盘，做完整恢复SHA、64KiB随机Range、实体materialize与参考块独立清理。没有集成到生产内容Blob、备份格式、DB FileVersion或上传/下发协议；真正CDC中部插入/移动边界、局部视频加密和CfAPI/FUSE Range/Seek要另测。[详细冻结规格](cas-version-performance.md)。首轮4GiB同源真实n3已在[专项 #38875620877](https://github.com/lazyxu/xdrive/actions/runs/38875620877)成功：离线持久B增量8,425,472B，实际生产Local.Put B为4,294,971,392B；本地40次Range与全SHA、离线引用清理通过。详见[原始11文件可复核归档](performance-evidence/cas-a03-d2-offline-block-ab/README.md)和[同条件完整指标](cas-version-performance.md)。**只承认离线候选的-99.8038% B增量空间，不是生产在线性能/CDC收益；完整B物化还需P50 26,370.862ms**。归档新HEAD双CI/FinalGate仍待重验。


## CAS-A04b：文件数据tar与离线跨代原始Blob引用的成本边界（2026-10-16）

历史A04a已确认不变的第二代`blobs.tar`仍复制完整数据；CAS-A03-d2固定8MiB实验仅离线。新CAS-A04b在**独立备份目标**存储按完整SHA指向原始Blob并为每一代独立持久化Manifest，专门测量**物理CAS内容完全不变**时跨代重用与恢复/GC。若4GiB原片只改1MiB，根SHA变化导致整份4GiB仍为新Blob，此模型**不具备CDC局部差异复用**；若想支持需后续独立Chunk/Pack、文件版引用/Owner隔离、视频Range、索引故障恢复、数据库+CAS快照一致性及部署方案。源删除后双代完整SHA复原、无效/腐坏拒绝、剪枝GC是候选硬门槛；同源n3×3初轮已测，证据归档及准确新HEAD CI待完成，**绝不可宣称减少生产备份空间**。详见[CAS-A04b规范](backup-performance.md)，不改变当前正式全量备份恢复协议或Race、用户持久任务。

### CAS-A04b实测回填：存储可去重但恢复读取成本显著（2026-10-16）

[同源专项CI #38899731578](https://github.com/lazyxu/xdrive/actions/runs/38899731578)成功n3×3；0%/1%/100%新增时两代独立离线hash仓库物理分配分别为419463168/423657472/838909952B，现行同源完整tar为839065600/843264000/1258573824B。真实`/proc/self/io write_bytes`比例与物理比例一致。但实验原型逐原片hash/fync恢复速度约为原版tar的1/4.4，故不能将「减少备份空间」等同全面性能最优；应在独立pack/并行Restore/完整PG一致性证据后再评估。完整内容原片微改依旧生成全4GiB SHA新物理Blob，另见CAS-A03-d2。

### CAS-A04b second n3：原版备份子阶段SHA正确，在线与PG仍不覆盖

同源真实[CI #38901666869](https://github.com/lazyxu/xdrive/actions/runs/38901666869)和[永久真实完整9样本](performance-evidence/cas-a04b-offline-two-generation-ab/README.md)再次确认隔离备份目标只保存不同完整SHA Blob可使不变/小幅变更跨代占用与写盘降约50%，两代恢复原SHA正确、损坏拒绝、未引用GC正确。然而每次完整恢复更慢，单文件内容变化仍全Blob空间，无在线CDC/分片版本、正式Server PostgreSQL一致性与客户PWA测试；因此只保留离线参考设计，不动生产备份或上传。



## CAS-A02b 首传2x staging和离线chunk直接提交机会（2026-10-16）

已验收原CAS-A02a真实Gin / SHA-256不可变CAS 4GiB上传物理峰值2.000000954×、写盘2.000000×。新的[CAS-A02b](cas-upload-staging-performance.md)仅测试同一Linux FS中512真实stage文件，在原版flat assemble（第二份4GiB）与离线hash chunk原子rename+Manifest（候选不额外复制原片）之间的同源A/B。**当前同源候选真实n3尚未运行，不能宣称收益**。强制补充物化完整文件的额外4GiB写盘以及随机Range和SHA；该候选不是已经实现的服务器ContentBlob/FileVersion/Owner/GC/云端/Agent新格式，不能替代实际HTTP分片续传，默认生产保持完整SHA不可变CAS。
\n\n## CAS-A02b首轮实测归档补记 · 2026-10-16\n\n[专项CI #38905016820](https://github.com/lazyxu/xdrive/actions/runs/38905016820) 在原HEAD 84fc5684a556b4a895deddbb91c758f42c509a3e 成功：3×真实4GiB SHAKE-256源、512个8MiB不同物理stage分片，原版布局模型st_blocks峰值8,589,938,688B vs候选4,295,004,160B；kernel stage+final写入8,589,934,592B vs4,295,004,160B，P50 finalize16,305.935ms vs8,229.359ms，平面兼容物化另外写4GiB、P50 15,422.271ms；原版和候选的全SHA/40次64KiB随机Range验证全通过，最大RSS37,796KiB。**Accepted only OFFLINE experiment；生产 AFTER=N/A，真实6客户端未测。** 仓库内[原始数字+source exact+原JSON SHA](performance-evidence/cas-a02b-first-upload-staging/README.md)为永久可查证索引；完整11文件原GitHub Artifact #12047453131只有有限保留期，不能冒称已经永久归档其全部字节。归档修订新HEAD源码及全仓FinalGate仍需执行。


## LP-P001 · 100k真正设备本机文件入口的性能边界（2026-10-16）

新[LP-P001 本机原版性能](localpush-native-physical-performance.md)只在独立Linux Root测试真实100k个独立字节/文件系统inode（不是100k ContentBlob）。现有LocalPush本机扫描/强native身份、原始两代Journal及delta均是只读本机数据与候选，未形成Server内容源上传、全SHA Blob引用或自动删减权限；真实100k物理设备扫描数据形状区别于CAS-A01的100k SQL File/Version只共享一个Blob，也区别于P047的100k CAS实际Server HTTP删除。所有Stage/SourceCommit/跨Owner去重/真实CAS写放大/长传输/PWA六端真实性能仍未由该场景覆盖，不能凭原生扫描改动生产网络/完整Blob格式。仅测原版 CURRENT 并保存实际CPU/RSS/st_blocks及写入，上限符合即不优化。


### LP-P001 Linux本机真实100k物理文件原版测量（2026-10-16）

[专用 original n3 #38911723111](https://github.com/lazyxu/xdrive/actions/runs/38911723111) 完成100k独立实际本机普通inode/409600000B已分配块的Root强身份→扫描→2代持久Journal→100k Delta路径，生产原版P50 Scan1=912.402ms、Scan2=928.290ms、Delta=2418.643ms、Go峰RSS≈23.52MiB；真实写Journal每代约26.8MB，两个代际变更准确，缺失候选严格非Delete。由于预算满足，生产`localpush`不改。此工作负载并没有调用上传协议、SourceCommit、`ContentBlob`引用、Owner跨账户PG、真实网络，因而不能据此称100k独立CAS物理去重性能最优、移动PWA上传已经完成或LocalPush安全状态授权改变。原始样本完整资源文件在[永久归档](performance-evidence/localpush-native-physical-100k/README.md)，还需准确证据HEAD专用CI/完整FinalGate验收。


### LP-P002：本机真实IPC与底层原片CAS职责的分离（2026-10-16）

[LP-P002新Agent Loopback IPC原版100k物理扫描](localpush-desktop-agent-ipc-100k-performance.md)仅用真实100,000个独立本机常规小文件测试Agent HTTP鉴权及摘要响应/生产LocalPush私有Reader/Journal/Delta本机路径。它不会执行实际远端SourceCommit、内容分块传输、ContentBlob/RefCount、Owner权限、云端GC；且测试Controller Adapter明确不是`agentController`真实远端授权路径，也不是Electron Main/Renderer。真实源码CURRENT尚未测，不能用另一LP-P001 n3的本地库延迟推算或宣称Blob减少物理副本。等到真实Owner授权+Agent上云10万物理SHA数据明确存在并有权限安全依据后才能单独制定下一步全路径n3和相同runner A/B，不能提前优化生产。


### LP-P002 100k Linux Agent IPC Go子链路 original CURRENT n3验证（2026-10-16）

[LP-P002真实原始CI #38917769347](https://github.com/lazyxu/xdrive/actions/runs/38917769347)通过实际http localhost +真实生产Agent路由+测试只读manager adapter到正式LocalPush Scanner/两代Journal+advisory Delta，100k独立inode、真源409600000B分配，保存两代及增量≤2.44秒、进程RSS≤25,944KiB；并验证无本机OS路径泄露。数据表明**已实现的IPC+本机Journal摘要层原版达标，不需生产优化**。这是不产生ContentBlob且不写Server任何Node/File的测试；不提供原始内容SHA→云端CAS/FullFile dedup/历史Version/CfAPI、真实Push网络带宽/全链路恢复，也没有生产owning Agent Credential和Renderer路径。六应用平台Not measured，[完整原始数据](performance-evidence/lp-p002-agent-100k-ipc/README.md)，准确证据HEAD CI待验收。
