# LP-P001 — Native LocalPush 100k 真实物理文件：两代 Inventory Journal 和增量候选性能

**状态：Accepted original CURRENT n=3/3 — 当前生产Go实现符合原版冻结预算，BEFORE=CURRENT，AFTER=N/A，产品不改。原始证据已永久存档；准确归档新HEAD的专项及完整CI/Final Gate仍待复验。**。2026-10-16，GitHub `lazyxu/xdrive`，冻结 master `d997552608de7ed406803bc9163e2546c23caa56`，唯一分支 `perf/localpush-native-physical-100k-inventory-20261016`，恰好一个 opt-in 测试工作提交。不改任何生产行为、Race、权限、同步所有权或 Blob/CAS 结构。

## 历史负载去重和为什么要新测试

已验收的 [P021 原生 change feed 100k](sync-performance.md) 只测 `/api/v1/changes` 的 Node/文件后缀元数据；[CAS-A01 100k File+100k FileVersion](performance-test-registry.md) 只使用**一个**实体 Blob；[P046/P047](file-explorer-performance.md) 是服务器生产Local CAS unlink/授权永久删除而非本机文件扫描；[P038/P049/P050](file-explorer-performance.md) 是 FileExplorer虚拟视口渲染而非设备本机源扫描。用户要求的 **100k 个独立本机实体 inode + 字节、Linux Go生产InventoryScanner→InventoryJournal→StreamInventoryGenerationDelta** 目前无同一工作负载有效 n3。按 [AGENTS.md](../AGENTS.md) 先测原版，达预算便保持生产原版不优化；CI只测本项，拒绝混入Race测试修复。

## 冻结数据、平台与请求/物理真实性

- 由 **3 个独立 Linux Go test 进程**分别创建100个目录 ×1,000独立文件 = **100,000个真正普通文件**。每个源文件1024字节，使用不同SHA-256身份构造可重复但不同内容，3组根源SHA互异；**文件后缀 .bin，不冒充可解码JPEG、H264、Live/RAW**。独立实测全部100k Lstat真实 `st_blocks×512` 分配（逻辑102,400,000B、文件占盘≥102,400,000B）、首尾/中间多个独立真实字节回读。目录 100 个，Root由生产 `PrepareRootGrant`颁发并重复真实 `VerifyRootGrant`。物理源生成耗时独立计量并排除Scan/Delta耗时；持久Journal在与Source Root分离的私有配置目录。
- 每次实际调用生产 `ScanInventoryToJournal`：500条有界批次、真实 native inode 身份、`CURRENT.json`与SHA-256完整持久NDJSON；随后实际调用生产 `VerifyInventoryJournal`完成签名摘要复验。
- 产生第二个实际文件系统代际：**原位修改1,000个1KiB文件使大小+32B**、移除1,000个旧文件、真正写入1,000个新物理文件，整个Root仍有100,000个实体文件+100目录。一个目录 mtime独立确认为已变更；生产 `ScanInventoryToJournal`持久化新CURRENT及历史PREVIOUS、两代均实际 `VerifyPreviousInventoryJournal`/当前完整SHA。
- 实测 `StreamInventoryGenerationDelta` 的两份独立有界磁盘spool、每批≤500。严格验证 **added=1,000，changed=1,001（1,000内容元数据变更+目录），metadata_stable=98,099，absent_candidate=1,000，emit=101,100**；必须 `MissingInferenceSafe=false`，绝不能将`absent_candidate`当删除或证明字节未改变，也不得启动真实Push、SourceCommit、Mirror删除或自动备份任务。三轮输出阶段壁钟ms、user/system CPU、`/proc/self/io write_bytes`、Linux MaxRSS、真实源/Journal字节与SHA、独立强身份数量及批次上限。

## 先冻结预算、再取真实 CURRENT

**三独立样本，各自完全重新建物理文件系统和两代Journal。** 生产原版每次扫描+持久化≤180,000ms、单次Journal SHA验证≤120,000ms、两代Delta比较≤180,000ms、独立物理种子≤300,000ms、Go进程MaxRSS≤512MiB。两代正确性、初始100k独立物理块、源身份/Root授权、添加/变更/缺失候选与500批次正确性是硬预算。此预算是为首轮原版验收冻结的**粗保守可运行上限**，不是用户硬盘/网络或设备PWA性能SLA。真实初轮若没有产品性能RED且数值达标，**接受 CURRENT 并保持所有生产代码不变**（AFTER=N/A、speedup=N/A）；如果超预算，先保存首轮RED、判断缺陷是数据种子/CI/harness还是应用真实性能，再用同一工作负载交替 n≥3 做最小候选 A/B；若收益不显著或真实资源/字节回归，恢复生产原版并记录Rejected。绝不作Race专项。

**复现**：Linux `XD_LOCALPUSH_NATIVE_100K_PHYSICAL_PERF=1 XD_LOCALPUSH_NATIVE_100K_SAMPLE=sample-1 go test -mod=readonly ./internal/localpush -run '^TestLocalPushNativeReal100KPhysicalInventoryAndDeltaPerformance$' -timeout=25m -count=1 -v`；[专用 CI](../.github/workflows/localpush-native-physical-100k-performance.yml) 先编译、1000真物理文件smoke，再三组各100k真实文件，仅该工作分支触发昂贵专项。CI第一次真实n3后，将逐样本JSON、Resource、Go stdout、source exact SHA/CI、summary永久存到 `docs/performance-evidence/localpush-native-physical-100k/`，与本规范、[统一登记簿](performance-test-registry.md)、[六平台矩阵](performance-platform-coverage.md)、[Blob架构审计](blob-cas-dedup-architecture-audit.md)在**同一个唯一工作提交**更新，追加后再重跑准确HEAD专属n3和完整CI/Final Gate双绿才能Ready/Rebase合并。

## 明确未覆盖的六端与未来测试

**本项 Native Linux Go源文件系统，不是完整Desktop Electron→Agent IPC UI，不是真实Web/Mobile Web，也不是任何OS-installed PWA**。六端完整Device Backup Push授权扫描/持久任务、100k原始CAS网络上传/下载、多源Pull、云端GC、GUI永久删除/Undo、RAW/HEVC/Live decode和真机弱网分别Not measured。不能因为100k文件创建和Journal成功就声称真实Push已经实现、服务器持久任务已完成、跨账户存储去重最佳。真正短期虚拟化浏览请求通过AbortSignal / Agent→Go Request.Context取消，不得在窗口切换时隐式中止耐久用户上传、下载、同步和删除。


## 2026-10-16 · 原版真实100k本机物理文件完整 n3（有效样本，与smoke独立）

**首先保留无效历史：** 初次工作HEAD `0467b80d257cde5b3dade46793b74e985c5842a7` 的[专项CI #38911400657](https://github.com/lazyxu/xdrive/actions/runs/38911400657)因新增测试文件不满足 `gofmt -l` 在编译前失败，**valid n=0 / Invalid harness**，没有实际100k产品性能RED。已修复为Go原样格式、生产源码不动；在中间诊断HEAD `d0ed8b730eac02e80e8ccec719381920a970dcce` 的[真正原版专项CI #38911723111](https://github.com/lazyxu/xdrive/actions/runs/38911723111)中 `gofmt` 的格式化结果随后按完全相同字节成为本次工作源码。小样本1000个物理文件预检通过，不计入下表真实n3。

真实三独立Linux Go进程、三组不同内容SHA的100,000个独立普通文件，均为1KiB且Linux实际 `st_blocks` 分配**409,600,000B**（源内容逻辑102,400,000B，所测物理源每个小文件受4KiB块粒度影响）；100个源目录。无浏览器、无SQL、无上传/下载和Codec伪装。完整两代持久NDJSON约**26.81 MiB/代**，独立两代SHA校验成功。第2代改变1,000个文件各新增32B、写入1,000个新文件、移除1,000个原文件，验证Delta 1,000 added /1,001 changed (包含目录)/98,099 metadata stable /1,000 absent candidates、203批、最大500记录、共101,100 output，且 `MissingInferenceSafe=false`，没有触发任何远端删除或Push持久任务。

| 三组真实物理数据集 | 物理种子wall（排除阶段测量） | Gen1 Scan+Journal | Gen2 Scan+Journal | Gen1 完整SHA复核 | 双代完整SHA复核 | Delta两代有界比较 | 进程峰值RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sample-1 | 4,168.123 ms | 912.402 ms | 903.975 ms | 19.535 ms | 38.766 ms | 2,377.210 ms | 24,084 KiB |
| sample-2 | 4,112.604 ms | 905.039 ms | 932.402 ms | 19.432 ms | 39.607 ms | 2,427.720 ms | 24,036 KiB |
| sample-3 | 4,170.091 ms | 928.632 ms | 928.290 ms | 19.493 ms | 38.987 ms | 2,418.643 ms | 24,076 KiB |
| **n3 P50 / 峰值** | **4,168.123 ms** | **912.402 ms** | **928.290 ms** | **19.493 ms** | **38.987 ms** | **2,418.643 ms** | **24,084 KiB** |

**资源/字节真实性：** 100k初始源生成阶段每组Linux `write_bytes` 实际409,600,000B；每代Journal持久写盘约26.8MB，Delta两代private spool真实内核写盘77,119,488B/组；文件源生成、修改、扫描+Journal、完整验证、Delta的单独user/system CPU和内核I/O以及三组`/usr/bin/time -v`原始资源文件全部存档，不从进程编译种子开销推断操作CPU。三个Seed摘要互异，生成Root和后续临时Journal不会被冒充服务器Blob。

**达标决策：Accepted unchanged CURRENT（无生产优化）。** Gen1/Gen2各约0.9秒≪冻结180秒、Delta约2.4秒≪180秒、全量Journal核验≪120秒、Go MaxRSS 24,084KiB≪512MiB，所有身份证据与统计预算通过。无需优化生产扫描/Journal/Delta：**BEFORE=CURRENT，AFTER=N/A，speedup=N/A**。这不是Windows Desktop Electron→Agent UI性能、Go真实上传队列或者任何6端PWA测试，所有客户端维度仍Not measured。

**原始机器级证据与新HEAD门槛：** [11个Git原样机器文件合并确定性tar.gz永久归档](performance-evidence/localpush-native-physical-100k/README.md)，来源[首次有效专项CI #38911723111](https://github.com/lazyxu/xdrive/actions/runs/38911723111)，原始[GitHub Artifact #12050941398](https://github.com/lazyxu/xdrive/actions/runs/38911723111/artifacts/12050941398) ZIP SHA256 `6b4942e3bb0bdfda98aabb140c3e2e16c0c810598dd8f4dadb2536d5834e48f2`，不可变 tar.gz SHA256 `c4c53661674321af204d2393f94c4ce0f4f05c5deeeb2e62a56bad722d448b2b`，Git Blob `1db959a9f42f49118a5d826da8688d49381e3425`。归档新HEAD专项 CI 将**在再次建100k真实源之前**逐字节核验原始11文件清单和SHA、源码当前五个Go文件SHA、三组原始JSON及P50；新HEAD全仓完整CI/final-gate双绿前不可Ready/merge。归档首轮和无效格式失败均保留。
