# CAS-A03 / S001-d：真实 4GiB 文件仅修改中间 1MiB 的全文件 CAS 版本空间基准


## CAS-A03-d4：4GiB 原片前部真实插入1MiB，块边界偏移的独立性能合同（2026-10-17）

**与 d1/d2/d3 不同：** 这次不是8MiB分片内 **覆盖修改** 1MiB，而是在4GiB原始高熵数据 offset=1MiB 处 **插入** 1MiB，从而改变所有后续固定分块偏移。两个实测方案都属于离线原型：8MiB固定块和64KiB原子、2–16MiB限制的内容锚点。后者不是真正任意字节位置的Rabin CDC。现有生产全文件SHA256 CAS不变，不能将离线 fixed-vs-anchor 视作生产 BEFORE/AFTER。

**首轮本地Linux真实n3/3：** 每轮独立4,294,967,296B non-sparse os.urandom fsync真源、额外随机插入1,048,576B，同源交替测试顺序；全两版SHA、20个4KiB真正的首/尾/中部/跨界Range、块SHA，物理B释放保留A和最终全GC均真通过。脚本完全来源SHA256 **0bcf68395b49ed62d0e923a88772794d01d9551895766ff2087b9bad8d2f4378**，Git Blob **300dc80eb0e0b428ac4b098c69528c769a451b47**；首轮仅是**本地实验**而非CI。Linux内核IO通过/proc/self/io，物理实体st_blocks×512；CPU/wall按阶段，整组三次 /usr/bin/time 最大RSS **172004KiB**。

| n3每轮值 / P50 | 固定8MiB | 64KiB锚点 |
| --- | ---: | ---: |
| B新增实体字节sample1 / 2 / 3 | 4,296,015,872 / 4,296,015,872 / 4,296,015,872 | 10,682,368 / 11,337,728 / 7,471,104 |
| B wall ms sample1 / 2 / 3 | 6279.327 / 6051.561 / 5708.023 | 16164.825 / 14766.122 / 14330.814 |
| B CPU ms sample1 / 2 / 3 | 4488.791 / 4286.420 / 3978.633 | 16077.914 / 14697.758 / 14272.109 |
| B新物理字节P50 | **4,296,015,872** | **10,682,368** |
| B写盘Linux kernel P50 | **4,296,429,568** | **10,682,368** |
| B wall P50 | **6,051.561ms** | **14,766.122ms** |
| B CPU P50 | **4,286.420ms** | **14,697.758ms** |
| B复用块P50 | 0 | 472 |
| 两代实体空间P50 | 8,590,983,168 | 4,305,649,664 |

锚点离线新字节节省**99.7513%**，但wall增加2.44x、CPU增加3.43x；即使离线节省空间也**不建议立即用于生产默认完整CAS**。原始n3不可变8件及SHA256SUMS： [证据README](performance-evidence/cas-a03-d4-offline-insertion/README.md)，[压缩包](performance-evidence/cas-a03-d4-offline-insertion/n3-local-20261017.tar.gz) SHA256 **1c5a9ab43a10c384a6fecaec07ead52b2f0043e61ea28f8ff2a5c93d1dc63bbb**，Git Blob 88b67f0ac56ea2de4921869cf800e9da0e1f660d。

**交付门禁：** 完全准确的**最终PR HEAD**在GitHub Actions重新执行3个4GiB和完整76-job CI/final-gate并保存源SHA/原始CI Artifact；在此之前仅Local n3，不能宣称CI绿或master已更新。对实际生产 INSERT: CURRENT **Not measured**、AFTER=N/A；全部六客户端均 Not measured。[中央去重登记](performance-test-registry.md)、[六端矩阵](performance-platform-coverage.md)。后续真实源、未对齐按字节insert/delete、冷热Range/视频seek/CfAPI/FUSE、真实PG Owner/RefCount/GC、崩溃回滚、备份还原与六端全链路必须另行冻结同条件工作负载；本PR不改产品或Race。


**阶段：Accepted original CURRENT n=3（精确归档新HEAD双CI/final-gate待复验）；BEFORE=CURRENT，AFTER=N/A，生产代码不变。** 固定 `lazyxu/xdrive master@7c71a028066c88a00b7aae0376066a3b1bd398d8`，分支 `perf/cas-a03-4gib-small-edit-version-20261016`，采用一个工作提交。

## 历史去重与现有观测

先查 `docs/performance-test-registry.md`、`docs/blob-cas-dedup-architecture-audit.md`、`docs/performance-platform-coverage.md`。P044/P045/P051 是 Web/Desktop/窄屏Web 的 4GiB 新原片上传+完整下载；CAS-A02 已验证首次全新4GiB上传物理stage/assemble峰值2.000000954×、Go写量2.000000×；CAS-A01已验证200002条逻辑引用共用一个原始 Blob 与跨Owner最终GC；CAS-A04a两代tar原版400MiB独立n3已测。本项独立检验的是**同一个逻辑文件的 A 版本和只修改1MiB的 B 版本的实际Local.Put两份物理CAS**，不重新运行上述上传/渲染测试。未测准确4GiB之前，不能声称实现了块增量。

## 真实原始负载 S001-d1，六端共享服务端存储层

- 只在 Linux 单独 opt-in CI 中启动生产 `internal/storage.Local.Put`（带SHA256身份、完整字节校验、临时文件fsync/原子发布及全局/分片生命周期锁）。每个样本两个 4,294,967,296 B 非稀疏高熵AES-CTR内容，第二份**只对中间连续1,048,576 B执行 XOR 0xA5**；实际 SHA256 必须不同，其他所有字节一致。n3 不同AES密钥、独立根目录和进程，每组先独立预hash得完整身份，再真实Put A与Put B、重复读出**全部8GiB**验证两份完整SHA与精确1MiB差异。测预hash耗时、每版本Put wall time、Linux allocated st_blocks、CPU/MaxRSS和 `/proc/self/io`，并单独核验先删 B 后 A 的基本物理原片生命周期。
- 对**这两个真实原片**同时计算固定 8MiB 边界的512块SHA；一个位于单个块内部的1MiB替换应使**511块完全相同**、1块不同。**8MiB仅是离线 chunk-reuse 理论参照，不是已有的 CDC/Chunk/Manifest/Block API，也不是实际 xDrive 新版本磁盘字节。** 不对大文件中途插入、跨块改变或视频重压缩泛化；这些单独构成未来测试。
- 预先冻结门槛：三组原始来源各有两条SHA不同真实CAS，实际新版本内容=4GiB、两版本分配总字节≥8GiB、任何文件不得稀疏，保留两代恢复SHA完全正确；每次 Local.Put ≤360s、进程最大RSS≤256MiB、总内核物理写量≥8GiB、严格1MiB变化、511/512块复用理论比例。测试挂起/磁盘不足/源码格式错误均标 **Invalid harness**，不当作优化失败；存储层与浏览器HTTP4GiB的速度不能横向做A/B。
- 原版符合冻结预算则**保留生产不改，AFTER=N/A**；若出现真实红项，记录 CPU/RSS/write_bytes，最小候选在**同源、同介质、n≥3交替前后**复测。任何未来 CDC/Pack 候选必须另测Random Range视频Seek、CfAPI/FUSE、历史版本restore、跨Owner配额、Source/备份引用、GC/掉电一致性，并不允许靠省空间预测吞吐改善。

## 尚未测的边界和平台

本测试**是 Local storage 单层**，没有 Gin/Auth/PostgreSQL `FileVersion` 行/实际 Web 上传/下载/传输任务，不能替代服务端上传两段stage与assemble成本、跨Owner安全、跨设备同步；原来的CAS-A02是不同负载。原生 Desktop、宽 Web、Mobile Web、桌面 installed PWA、Android installed PWA、iOS installed PWA 均为 **Not measured**（本条不填任何客户端新耗时）。PWA真机只能用真实设备安装后独立记录，不能以390px模拟替代。取消专题只有视口消费型HTTP AbortSignal→Go ctx.cancel；永久任务由Server任务所有权控制，不能因窗口切换而取消。

## 参考方案（尚未被xDrive采用）

- restic 的内容定义块与Pack/快照提交顺序（https://github.com/restic/restic/blob/master/doc/design.rst）适合作为**离线增量备份先行**参考。
- Kopia 分离 BLOB/CABS/CAOS/Manifest（https://kopia.io/docs/advanced/architecture/）可作为多代备份和故障恢复模型参考。
- Seafile 的Seafile object指向 block IDs、可变大小分块（https://manual.seafile.com/14.0/develop/data_model/）适合后续在线版本空间评估；但 xDrive 多Owner权限、视频Range/挂载和原始SHA完整性需原样保护。

## CI与存档

独立 `.github/workflows/cas-a03-physical-4gib-local-version.yml` 只允许 `perf/cas-a03-4gib-small-edit-version-20261016` 分支。Go测试 `internal/storage/cas_a03_real_4gib_version_performance_linux_test.go` 必须通过单独env opt-in，其他Go Linux/API、Windows正式CI不运行该重负载。第一次有效准确源码 HEAD 运行后，完整保存三轮 machine JSON、Go stdout/stderr、单进程`/usr/bin/time`、source exact SHA、压缩归档/原始Artifact以及任何 Invalid harness 原因；同步中央注册表/本规范/六平台矩阵/AGENTS.md/Blob审查到**同一个原固定父工作提交**，再跑更新准确HEAD专属和全量CI/FinalGate，最后Ready/Rebase合并及验证分支清理。


## 工作阶段交接（2026-10-16）

在固定master上已经检查相关分支与PR：A04a #1795已通过准确HEAD全CI/Final Gate合入；旧Desktop图库进度 #1185为失败Draft，与本次物理存储版本无同一路径修复，不随意关闭/重建；CAS-A03无存活PR/分支，独立建立本次基准。只有源准确 Linux opt-in CI 首次真实执行后才能填CURRENT耗时/物理字节，保留 Invalid harness 状态并修正同一工作提交。不修改生产代码，绝不混入Race或客户端PWA功能。


## 2026-10-16 第一套真实物理CURRENT n3完整结果与归档



### CAS-A03 / S001-d1 首次真实4GiB原片双版本 Linux Local CAS n3（2026-10-16）

源准确首轮提交 `114fd414fd104b4952cd9b7d1e23c3c9d1827bb8` 的[专用CI #38870252470](https://github.com/lazyxu/xdrive/actions/runs/38870252470) **SUCCESS**，3组独立实际生产 `storage.Local.Put` 每组写入并验证两个SHA不同、完全实际分配的4GiB AES-CTR原片，第二版本仅中部**1,048,576B**异或变更；对完整8GiB读回进行两个全文件 SHA 验证及逐字节差异计数。**CURRENT原版 n=3/3 合格**：每组两版本物理 `st_blocks` 合计 **8,589,942,784B**，Go `/proc/self/io write_bytes` **8,589,934,592B**，新版本物理增加 **4,294,971,392B**，Original `Local.Put` P50 **22,924.494ms**，Changed `Local.Put` P50 **22,594.151ms**，全量两版恢复hash/diff P50 **10,281.371ms**，Go峰值RSS **32,736KiB**。源随机性为3个独立AES密钥；离线512个8MiB块中511相同，只作理论分块前景，不是已实施CDC；`read_bytes=0`来自Linux page-cache路径，并不表示没有读取8GiB逻辑字节。冻结 <=360s/每次Put、<=256MiB、物理8GiB、实际SHA/1MiB条件均通过；生产无更改，**BEFORE=CURRENT，AFTER=N/A，提升百分比=N/A**。

原始[11个不可变机器样本/CPU/RSS/日志/source](performance-evidence/cas-a03-real-4gib-local-versions/README.md)与[GitHub Artifact #12033511367](https://github.com/lazyxu/xdrive/actions/runs/38870252470/artifacts/12033511367)精确一致；永久 `tar.gz` SHA256 `4b9306d2de3f281108092117dfcf578f8a10e93bb29ea88818ffc81db4eb1322` Git Blob `1e9e9162e248c1f467bea8da3faebd1b9fa06716`。**首轮源码 CI 成功不代表归档后最终证据提交验收**；仍须归档准确最终HEAD专用n3+全仓final-gate通过后才可合并。独立CAS-A03原版Local storage测试不得冒充生产 FileVersion SQL、Web/Desktop/Mobile upload 或三类installed PWA。


此处的原始CPU进程计时由3个独立`/usr/bin/time -v`资源文件提供，含全进程源预hash、2×Local.Put、两版8GiB恢复SHA、最终删除；用户 CPU=20.52/20.64/21.09s，系统 CPU=3.51/3.21/3.00s，全进程最大RSS=32,864/32,808/33,064KiB。窗口/网络性能**没有**新增样本。已接受的原版当下存储层写入时延与内存预算达标，因而不优化生产，空间放大列为离线 Chunk/CDC 候选未测问题。


**CAS-A03首次归档HEAD Invalid harness（2026-10-16）：** 首个原始n3专项 #38870252470 已有效通过，本次归档修订生成的旧HEAD `64e071097da87699125664ae57d48d3c834b1582` 由于文档自动化的字符串替换把workflow末尾重复插入，造成 `cas-a03-physical-4gib-local-version.yml` 结构不合法；无新准确HEAD物理样本，**不是生产存储/性能RED**。现从首次成功的原工作流逐字节恢复，使用非解释型替换仅增加原始归档SHA与11条成员核验，再跑新的精准HEAD CI。原始n3结果、数据规模、预算和生产路径不变。


## CAS-A03/S001-d2 — 4GiB局部修改离线固定8MiB真实块仓库 A/B（2026-10-16）

**原版CURRENT与离线PoC同源n=3实测通过；生产代码未修改，生产AFTER=N/A、线上加速=N/A；最终归档新HEAD复验仍待完成。** 本项已先[验收原版CAS-A03-d1 PR #1809](https://github.com/lazyxu/xdrive/pull/1809)：精确最终HEAD [专用CI #38871484922](https://github.com/lazyxu/xdrive/actions/runs/38871484922)和[完整CI #38871484899](https://github.com/lazyxu/xdrive/actions/runs/38871484899)（25成功/51跳过、FinalGate成功），Rebase合入 `069f7e836ca20b8ca668e12b3fd3c9019f51a0be`；原分支已自动清理。原版缓存/Runner导致写入P50从22.594s到11.800s，不能称生产提速。生产源码零更改。

新的生产 CURRENT vs 独立离线 PoC 同条件 A/B：

- 每轮分别对**相同的两个实体4GiB内容**执行原版 `storage.Local.Put(A)`+`Local.Put(B)` 与隔离目录的**固定8MiB SHA-256块仓库**，B只有居中1MiB改变。三轮各自新的确定性AES-CTR密钥、独立临时Root与Go进程，按 sample奇偶交替测试次序，复用CAS-A03-d1原始三对full SHA。原版不重复独立首传P044/A02负载；仅新同条件A/B归因局部改版存储形状。
- 离线 PoC 每个原片512个真实非稀疏物理8MiB对象；预期B应新增**1个块**而非重写511块；真实创建/fsync hash命名实体，两个不可变manifest明确两版本引用。统计文件 `stat.blocks×512`、原版/候选写盘内核 `/proc/self/io write_bytes`，每轮原版/候选 A与B写入wall、CPU User和Go RSS。候选本身不提供远端传输优化，B本次仍流式消费完整4GiB源才计算块哈希。
- 逐一读取各512块验证块SHA，再验证两个**完整4GiB版本SHA**；对每版20次**64KiB随机Range**（共40次）使用独立AES-CTR随机偏移oracle做内容校验，包含首尾、跨8MiB边界及1MiB修改区；B额外**实体重建4GiB文件并fsync再完整读回SHA**，明确将这个临时写盘与长期版本物理占用分开统计。
- 删除B引用后离线mark/sweep必须只回收新增的1个实体块，旧版A全量SHA不变；删除A后全局块及manifest实体为0。**这个局部引用表不等于PostgreSQL FileVersion/跨Owner全局CAS refcount或生产GC，不能声称完成GC生产改造。**
- 冻结正确性：A/B SHA完全和d1一致，512/512数据块有效、511共享、真实物理初始A不少于4GiB、B实体增量必须**多于8MiB且至多10MiB（含manifest）**；候选两版总磁盘和实写IO <= 原版的60%；3组n3源准确、40个Range/组、全量恢复SHA正确、全部引用清除后physical0。单次Put<=360s，候选实体重建及校验<=180s，进程RSS<=512MiB。阈值失败首先核对测试工具、磁盘/runner与数据真实性；真实 RED才调查性能，不能从不同Linux runner计时推断线上提速。
- 新实验 [Linux opt-in专项CI](../.github/workflows/cas-a03-d2-offline-fixed-block-ab.yml) 对三组测试生成原始JSON、Go日志、`/usr/bin/time -v`与源准确SHA；成功后必须把原始档持久存入 `docs/performance-evidence/cas-a03-d2-offline-block-ab/`，同一工作提交更新登记簿、六平台矩阵、此规范与架构审查并重跑准确HEAD专项及完整CI/FinalGate方可合并。本地缩小版32MiB只用于预检Go编译、SHA/Range/GC夹具，**不是4GiB有效样本**。

**拒绝将离线 PoC 直接当成产品优化**：纯固定块并非CDC（中间插入/删除导致块移动尚未测）；没有网络断点、HTTP Range、视频Seek/CfAPI/FUSE、身份/配额、PG文件引用、跨账户GC、冷缓存/慢盘、iOS/Android或任何OS安装PWA的真实结果。即便空间达标也只能记作 **Candidate / offline accepted evidence**，需要独立最小化可回滚备份版本分块方案及完整生产正确性+同源A/B才考虑变更。

### CAS-A03-d2 · 首轮有效真实4 GiB 同源 n3 A/B（2026-10-16；原版生产未改）

**Accepted offline experiment / NOT production optimization.** 准确源码 `f3086920d226f7cb600650b7fee33770b6ad0f44` 的[独立专项 CI #38875620877](https://github.com/lazyxu/xdrive/actions/runs/38875620877)和[完整 CI #38875620937](https://github.com/lazyxu/xdrive/actions/runs/38875620937)均 **SUCCESS**。三组独立Go进程、三个匹配CAS-A03-d1的真实非稀疏高熵4,294,967,296B源，B只修改1,048,576B，交替生产Local.Put与单机**离线固定8MiB块仓库**；每组两版完整 SHA、40次64KiB随机Range oracle、实体B重建及 SHA、移除B保留A和最终全回收全部通过。**BEFORE=同一CI真实生产原版 CURRENT；OFFLINE CANDIDATE=已测；生产 AFTER=N/A，线上 speedup=N/A。**

| 同源真实采样指标 | 原生产 Local.Put P50 | 离线固定8MiB PoC P50 | 正确解释 |
| --- | ---: | ---: | --- |
| B新增持久实体字节（含manifest/分配块） | 4,294,971,392 B | 8,425,472 B | 原型B新增空间减少 **99.803829%**，**仅离线** |
| A+B持久实体空间 | 8,589,942,784 B | 4,303,429,632 B | 原型节省 **49.901533%** |
| A+B阶段Linux内核write_bytes | 8,589,934,592 B | 4,303,429,632 B | 原型节省 **49.901485%**；**不含另行B实体重建** |
| B写入 wall | 22,404.654 ms | 3,394.406 ms | 同源P50，但并非在线上传/整文件恢复收益 |
| A原片写入 wall | 22,256.039 ms | 22,594.785 ms | 新原片没证据显示更快 |
| 40次真实64KiB随机Range总 wall | 2.335 ms | 2.174 ms | 本地热缓存/Go内oracle，不是远程视频Range |
| A+B完整读取与SHA验证 | 11,370.374 ms | 11,086.970 ms | 双方SHA均通过 |
| B额外物理物化+SHA复验 | 无该额外步骤 | 26,370.862 ms | 临时4GiB重建额外IO/延迟，禁止忽略 |
| 进程最高RSS | — | 38,812 KiB | 三样本整体最大值，预算≤512MiB |

**真实块状态：** 每轮512块A加1块B=513个真实物理8MiB hash块、511个复用；B引用清理后A SHA有效、最终清空实体0B。上述百分比来自**同轮持久数据及写入阶段**；额外materialize写盘和网络传输不在该write_bytes对照里。P50为三样本中位，各源原版与原型执行顺序交替；不要与d1跨Runner的22.594s/11.800s当成优化A/B。

**可审计来源：** [原始11文件逐字节归档](performance-evidence/cas-a03-d2-offline-block-ab/README.md) 内保存第一次专项CI的**原始11文件**（`sample-1/2/3.json`、原Go日志、3份`/usr/bin/time -v`、`summary.json`、`source.txt`），零修改压缩进确定性 `tar.gz`，SHA256 `9a55362cd66ea725cd49ce79de1dcc3f81b1f654210bac3b0e28c68fd1cc4772`；原始GitHub Artifact [#12035880698](https://github.com/lazyxu/xdrive/actions/runs/38875620877/artifacts/12035880698)，原ZIP SHA256 `f948c1ff03de5ac9693c07f0a86d5fdccf261e76c0651d990047cbcdb8bb4fc1`。当前归档修订需在**新HEAD**重跑原生专项n3+全仓CI Final Gate成功方可Ready/Rebase合入；早期GREEN不能替代新HEAD验收。这个压缩归档保留原始机器字节，不把新HEAD复验当生产改善。

**决策：** 仅保留可审计离线PoC，**不改变生产 Local.Put、SHA-256根身份、PostgreSQL FileVersion/ContentBlob、Owner权限配额、在线GC、备份格式、Range、下载或持久任务**。固定边界块对中间**插入/删除、视频重编码、跨块变更**尚不能提供CDC收益；离线本地热cache的Range也未覆盖Source/Pull、真实CfAPI/FUSE、WAN断点恢复、损坏回滚。下一新负载可按CAS-A04b完整恢复/备份一致性先验证在线迁移可行性，另测真设备六平台。


## CAS-A03-d3 / S001-d3 · 4GiB 小改动经过真实 HTTP/PG 分片复用与版本 GC（2026-10-17）

**阶段：Benchmarking；新负载原版 CURRENT/BEFORE 尚未实测，AFTER=N/A。** 这是在已有 CAS-A03-d1 原 Local.Put 双4GiB原片和 d2 离线固定8MiB块对照之后，独立验证真实生产 Gin/PG17 版本上传：不是重复 P044/P045/P051 首次4GiB吞吐测试，也不是新分块架构的产品改动。

**真实链路及负载：** 三组独立 PostgreSQL17 schema / 真实本地 CAS 根，各自 4,294,967,296B 真高熵 AES-CTR A 原片（512×8MiB真实 authenticated HTTP PUT）→ Node Rev1；B只修改中部单一8MiB块内部的连续1,048,576B，与原版有不同完整SHA，携带完整512个分片 SHA，要求真实初始化扫描旧CAS并预填 **511/512 Reused UploadPart**，只传 **8MiB单块**。随后仍经过生产 finalize 汇总 SHA/独立持久完整新CAS、历史 FileVersion Revision1 与当前 File Revision2（各1个ContentBlob RefCount），完整读回两份4GiB SHA；经真实Owner HTTP trash删除/永久删除归零 FileVersion/ContentBlob和全部物理CAS。存档 B init旧CAS重哈希毫秒、B PUT毫秒、B finalize毫秒、postseed Go CPU ticks/RSS、/proc/self/io write_bytes、持久物理 st_blocks、GC毫秒与种子/全量恢复分离时间。

**前置冻结预算：** n=3各独立4GiB，两版内容仅1MiB异或，原版512新PUT、B只1 PUT、511实际复用、历史+当前两完整 Blob 各>=4GiB物理实分配、零泄漏与全SHA正确；初次原版上传<=360s、B init<=180s、B 8MiB PUT<=120s、B finalize<=360s、GC<=180s，Go postseed RSS增长<=512MiB且 CPU/write_bytes 非负真实可读。原版若符合预算则保持不变；实测超预算并排除无效工具/环境后，才另做最小生产候选及同环境三轮 BEFORE/AFTER，要求显著且稳定提升而 CPU/RSS/IO/权限/恢复/HTTP Range 不退化。

**准确证据规则：** [独立Linux PostgreSQL17 n3 CI](../.github/workflows/cas-a03-d3-real-http-4gib-version.yml)包含64MiB smoke（仅功能预检）与三个完整4GiB不同源；每份source SHA+Go stdout/time资源、机器 sample-1/2/3.json+summary。先取得真实有效n3，保留任何 Invalid harness/RED，再把原始11文件与完整源码/Run SHA永久归档到 `docs/performance-evidence/cas-a03-d3-real-http-4gib-version/`，在本单工作提交上重建HEAD并跑全CI/final-gate、专用测试双绿，方可Ready/rebase合入。**没有证据时禁止填写任何实测 AFTER/百分比。**

**清晰边界：** 共享Server Gin/PG/Local CAS是真实 HTTP，但本工作没有真实 Desktop Renderer/Main/Agent、Wide Web XDriveApi、Mobile Web、桌面实际 installed PWA、Android installed PWA、iOS installed PWA客户端路径，故**六端此精确工作负载全部 Not measured**，不替代任何已测100k图库/文件浏览器虚拟滚动/缩略图/Go取消；不更改Race或耐久传输的独立任务所有权。后续评估生产分块 Manifest、备份恢复、视频 Range、CfAPI/FUSE 与跨 Owner GC 前可参考 restic/Kopia/Seafile，但不能把离线设计称作已经实现。


### CAS-A03-d3 首轮证据门槛诊断（2026-10-17）

**两次初始准确源码预检失败（Invalid harness）：** 首轮 CI #38949708358 在代码格式门槛失败，第二轮 CI #38949952695 专门打印实际 gofmt -d，定位到拼接表达式及 JSON map 对齐等测试源码格式问题；在进入真实64MiB PG17 smoke / 4GiB n3之前终止，真实性能有效n=0，不得当产品性能RED。现按差异在同一固定父提交上修复并重跑准确HEAD CI。

**CAS-A03-d3 CI Invalid harness #38950237635（2026-10-17）**：在准确 `ee4b0eabca51e5430e436dc1e496f63338f379dd` HEAD 上源格式预检已通过，但预检无 `XD_CAS_A03_D3_SAMPLE` 时仍携带整个作业的 opt-in 性能开关，`go test` 于样本合法性检查退出。真实64MiB smoke与4GiB n3均未启动、有效n=0；不是Server性能RED。只更正preflight使用 `env -u XD_CAS_A03_D3_REAL_HTTP` 实际编译测试，保留smoke/n3显式开启；仍在原冻结父上保留唯一工作提交，重新要求准确HEAD专项与全仓CI。

**CAS-A03-d3 Invalid workflow evidence #38951369083（2026-10-17）**：对先前 HEAD 的工作流字符串替换误展开 `$'` 语义，令 YAML 片段重复/截断，GitHub 在 push 时立即报告无Job的工作流解析 failure（不是Go代码、PG或物理性能RED）。从先前合法 Git blob 完全恢复 YAML，按单次字面预检行的安全回调替换，校验只有一个64MiB smoke、一个4GiB n3、一个artifact上传，全部性能样本仍n=0；新HEAD必须重新通过真实smoke/n3和全CI。


### CAS-A03-d3 首次有效真实 4GiB PostgreSQL/Gin/CAS n3（2026-10-17）

**状态：Valid original CURRENT n=3/3 / 测试专用改进后的最终 HEAD 还必须复验；生产 BEFORE=CURRENT、AFTER=N/A、产品未更改。** 准确首次源码 `877054f3bcb60b2247ac7ae3092fc8570c4a6f61` 的[专用完整4GiB专项CI #38951921025](https://github.com/lazyxu/xdrive/actions/runs/38951921025) **SUCCESS**（64MiB真实PostgreSQL smoke 与随后三次独立4GiB完全通过）；同 HEAD 的[完整CI #38951920350](https://github.com/lazyxu/xdrive/actions/runs/38951920350) **SUCCESS**。三组每组实际生产 Gin 认证上传原始高熵 A 4,294,967,296B（512×8MiB PUT），B 只改变同块内1,048,576B，服务端读取旧完整 CAS 的512个块并复用511个，只通过一个真实 8MiB PUT；上传Finalize仍写入新的完整4GiB独立ContentBlob。3/3样本的原始A和历史/当前B全量 SHA（每轮8GiB读回）、两代真实物理分配、FileVersion 和 RefCount=1+1、最终Owner HTTP Trash清理到实体0/SQL0全部通过。

| 同一源真实 n3 指标 | 原版生产 CURRENT P50（非优化） |
| --- | ---: |
| Source两版预hash（计时独立） | 8,994.060 ms |
| 初始A全部512分片HTTP上传+提交 | 50,157.046 ms |
| B初始化 / 旧CAS 512块重哈希 | **2,310.343 ms** |
| B更改的单个8MiB上传PUT | **46.204 ms** |
| B按完整4GiB生成新CAS的Finalize | **25,075.655 ms** |
| B初始化至Finalize实际Go Linux写盘 | **4,303,355,904 B** = 4GiB最终新CAS + 8MiB阶段 |
| 旧历史A + 当前B总物理st_blocks | **8,589,942,784 B**，各一份完整4GiB |
| 两版真实完整SHA恢复核验 | 4,472.074 ms |
| 最后两个Blob Owner HTTP永久删除GC | **408.452 ms** |
| B的Go进程CPU（原始 /proc/self/stat ticks） | **1,211 ticks** |
| B测试开始/结束时RSS净增长 | 0 B（**仅两端点快照，绝不冒充峰值**） |

**精确意义：** 在原生8MiB固定分片边界内修改1MiB，B内容体的HTTP请求仅有一个8MiB（相对4GiB完整文件请求体减小99.8047%），但B持久磁盘增加仍约4GiB；**不是产品优化的新 AFTER，也不是已实现在线块级去重**。完整Linux新版本传输/浏览器/Electron/设备性能不从Server单层外推。以上计时为同一有效原版 n3，其值不与 P044/P045 跨环境横向换算代码提速。

**永久真实数值证据：** [首次原样8文件（sample1-3.json、3份资源、summary、source）的确定性原始字节归档](performance-evidence/cas-a03-d3-real-http-4gib-version/ci-run-38951921025-numeric.tar.gz) 及该原始Artifact完整11文件SHA manifest [README](performance-evidence/cas-a03-d3-real-http-4gib-version/README.md)；Git SHA256 archive `c032c767cbf5b452f14d45b3de551c2032a35b4e13ee5cb57316a8d6d5ad2337`，不可变 Git Blob `68015cf60d7eab3b6126a6dc32f0e721d8ad3f48`。完整原始11文件[GitHub Artifact](https://github.com/lazyxu/xdrive/actions/runs/38951921025/artifacts/12067754796) ZIP SHA256 `d2f3988d46aa81a16bfb6c1f82d27a9dd5566d3420c0bab1b335c1134f59c7e2`，其中3份大Go原日志**未拷入永久数字子集**、不得声称完整11件都永久归档。ZIP短期保留；归档README记录全部11件文件的SHA以利审计。为严格履行资源峰值门槛，下一同父唯一工作提交在B短阶段增加25ms Go峰值RSS采样与Gin入口真实PUT次数/ContentLength观测，再新HEAD真实smoke+n3和全CI/FinalGate双绿；原有效源码数据不因这个测试诊断增强被宣称是生产提速。

### CAS-A03-d3 复验：真实 HTTP PUT 计数与 25ms RSS 峰值（2026-10-17）

**原版 CURRENT 再测 n=3/3 / 原仓库产品代码未修改 / 生产 AFTER=N/A。** 测量源码 HEAD `2b57dfc029a794ab20db1b7effebe7765cbd7453` 的[真实 n3 专项 CI #38953556661](https://github.com/lazyxu/xdrive/actions/runs/38953556661)成功：PostgreSQL17、Gin认证HTTP、真实不可压缩高熵4GiB原片 A（512×8MiB PUT），B仅中部1MiB改变，511分片Server复用，一次8MiB PUT，FileVersion/ContentBlob两份完整SHA原片，全部实际Owner删除及GC归零。与前次HEAD不同的是**只新增测试源观测**，于HTTP Router入口计量`ContentLength`并对B阶段每25ms采样进程RSS峰值，不是产品加速。

| 数据（同源 n3） | 第二套有效测量 P50 |
| --- | ---: |
| 初次 A 真 HTTP 上传/提交 | 29,670.283 ms |
| B 初始化旧整文件块匹配 | 3,117.744 ms |
| B 新分片真实请求 PUT | 28.165 ms |
| B 全量 4GiB CAS Finalize | 16,756.892 ms |
| B 实际 HTTP 请求数/请求体 | 1 次 / 8,388,608 B |
| B 阶段实际 /proc/self/io write_bytes | 4,303,355,904 B |
| A+B 真 st_blocks ×512 物理量 | 8,589,942,784 B |
| 两版完整SHA恢复P50 | 6,185.666 ms |
| 最终真实HTTP永久删除与GC | 429.078 ms |
| B 阶段 RSS 峰值增加 P50 / 三组最高 | 126,976 B / 573,440 B |
| B Go 用户+系统 CPU tick P50 | 1,666 ticks |

**数据解释：** 本次和前次的wall、Go CPU不同，是独立CI跑次与诊断仪表环境波动，**不可**把 25.076s → 16.757s 写成 33% 性能优化。两个真实n3都在事先冻结预算内，仍保持原生产完整SHA-256 CAS；完整CAS B 增量4GiB成本没有消失，离线分块原型虽然更省空间，但在线权限/备份/Range/CfAPI/FUSE/GC没有产品级验收。

**不重复试验的永久证据：** 已将本次原始3份sample JSON +3份资源日志、`summary.json` 和 `source.txt` 逐字节保留，附 `README.txt` 与全部原始11文件的SHA256/长度`MANIFEST.json`，归档至[真实数字证据](performance-evidence/cas-a03-d3-real-http-4gib-version/ci-run-38953556661-verified-numeric.tar.gz)，deterministic tar.gz SHA256 `401e75c553a3f33ab1bda37ff13795d1a40fdae910a9fd99e6f88dcd2b4f0305`，Git Blob `4ee066f1bbf2501da7c225e788a46cb4e7c9c375`。原始11文件完整[GitHub Artifact](https://github.com/lazyxu/xdrive/actions/runs/38953556661/artifacts/12069796643) ZIP SHA256 `87826d6b5e6ac20e54157adea8154f992e72289abfd01264d04980a24303e813`；3份冗长 Go stdout 只在短期Artifact中，**并非永久入库**。该归档HEAD仍需新的完整专项+全仓CI/final-gate验证才可 Ready/Rebase。六端 Web/Desktop/Mobile Web/三个OS已安装PWA的此精确版本上传工作负载均为 Not measured。
