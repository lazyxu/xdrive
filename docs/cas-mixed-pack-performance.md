# CAS-A07 · 100k 混合物理大小原片：完整 Local CAS 与独立离线 Pack/Index 空间、读写、GC 对照

**状态：原版CURRENT n3已实测／Accepted unchanged，离线Pack节省真实容量但分层读变慢19.48%，因此Rejected unconditional all-size production Pack；生产 AFTER=N/A，speedup=N/A。原始11文件已永久归档，准确证据HEAD双CI FinalGate待验收。** 2026-10-17。固定 `lazyxu/xdrive` master `a7fe0163e6d21b8059787dd785328173e8d90e2f`，唯一分支 `perf/cas-a07-mixed-100k-pack-crossover-20261017`。只增加 Linux 原生 Go opt-in 性能测试/专用 CI/文档；不改生产 `Local.Put/Open/Delete`、ContentBlob/Owner引用、版本、GC、上传下载/PWA、Race 或用户持久任务。

## 为什么新测：避免对1 KiB 单一分布过度优化

已合入[CAS-A05：100k 不同1 KiB物理 CAS→离线 Pack/95k GC](cas-small-pack-performance.md)原版占409,600,000B，离线Pack+Index占107,208,704B，显著节省73.826%，热2000读取Local/Pack P50 39.789/10.299ms；[CAS-A06：同样物理分布的 FADV_DONTNEED 提示冷缓存](cas-small-pack-cold-performance.md) n3冷读取 P95 Local/Pack 193/149μs，内核读字节实际相同；均只是**离线候选研究**。原版P046/P047已测100k物理CAS的生产GC/HTTP永久删除，没有 Pack。CAS-A01仅一份实体 Blob 搭配200002逻辑版本引用。新 CAS-A07改变的是**同一100k原片中对象字节大小的真实分布，且固定源与阶段**，不是把旧1KiB数字跑一遍。研究目的：确认 Pack是否仍值得在大量16KiB～1MiB资源中使用、是否要将未来小Blob打包限制在某个文件大小以下。读[全局登记簿](performance-test-registry.md)、[六平台矩阵](performance-platform-coverage.md)、[Blob/CAS架构审计](blob-cas-dedup-architecture-audit.md)后执行，不重复已接受的Gallery/FileExplorer 100k缩略图或4GiB吞吐。

## 事先冻结真实数据形状/层级

每组独立Linux Go测试进程和新存储根，3个不同确定性SHA-256/AES-CTR内容数据源；100,000份原片都是各自唯一SHA，完全真实字节，**不是仅元数据、稀疏或可压缩同零文件**，没有虚构JPEG/H264/Live/RAW解码。分布及逻辑内容如下：

| 大小 | 数量 | 总逻辑内容 | 采用原因 |
| --- | ---: | ---: | --- |
| 1 KiB | 95,000 | 97,280,000 B | 单文件4KiB分配块碎片显著 |
| 16 KiB | 4,000 | 65,536,000 B | 小照片sidecar/元数据量级的非媒体原片 |
| 128 KiB | 900 | 117,964,800 B | 中小对象，pack需要衡量索引额外开销 |
| 1 MiB | 100 | 104,857,600 B | 大于小对象的边界，读时真实hash成本 |
| **全部** | **100,000** | **385,638,400 B** | 总体采用强混合但小字节先验分布 |

真实**Baseline CURRENT**严格调用原生产`Local.Put(ctx, ContentAddressedKey(SHA256), reader)`产生100k独立原始CAS、fsync/原子发布，记录Linux`st_blocks×512`、`/proc/self/io write_bytes`、Go CPU/RSS和wall。基线完整实体应**≥677,478,400B**（由各个对象的典型4KiB分配块总数推出，仅作为有效数据预算，仍须Linux实际审计）；随机采用2,000个原始索引，**1 KiB层1700、16KiB层100、128KiB层100、1MiB层100**，每个对象真实`Local.Open`全SHA及第二次`ReadAt`取256B校验。然后`Local.Delete`删95,000个非keeper原片，遍历并校验5,000个Keeper所有完整字节与SHA，最后删除所有幸存对象并证明原片物理0B。

离线**Candidate**针对完全同源原片保存一个独立不可变Pack（按源序拼入）、48B/原片定长二进制offset/size/SHA索引、经过fsync/rename的HEAD，并且在计时后验证实际Pack Index连续、唯一SHA和原片大小；读同样2,000个原始对象的完整SHA与额外256B `ReadAt`，生成第二份只包含5,000 Keepers的Pack+Index并先fsync/提交HEAD，然后再删除旧代。**真实记录Pack1+Pack2并存的瞬态峰值**；GC后再次验证完整5,000幸存字节、故意翻转一字节必须SHA拒绝、恢复原始字节，最后两代清空物理0。候选只是**独立测试模型**，不挂入生产PostgreSQL、Owner/Version/CfAPI/云对象后端；不能对运行时吞吐作线上加速声明。

## 冻结预算与指标解释

各n3独立真实混合原片、Baseline≥100k物理inode且实体≥677,478,400B；Pack合并前后物理占用**均≤相同Source原版的75%**（不是前CAS-A05 1KiB候选35%的旧预算）；Pack GC新旧同时存在峰值要单列而不能只展示最终Pack2；所有初始/随机读取/GC/幸存SHA校验阶段wall≤900s、Go MaxRSS≤512MiB，所有真实内容 SHA/Range/索引完整性、95k删除/5k保留及损坏拒绝严格通过。内核write_bytes与Go User/System CPU必须逐阶段报告。原版达标→保留产品不改；即使候选空间节省、但读/CPU/RSS有显著退化，也不能推荐生产迁移，只记离线实验证据。不得拿同源两种不同磁盘布局的`fsync`次数差异直接宣传用户上传快了多少倍。

**复现**：`XD_CAS_A07_REAL_MIXED_100K_PERF=1 XD_CAS_A07_SAMPLE=sample-1 go test -mod=readonly ./internal/storage -run '^TestCASA07Real100KMixedSizeImmutableCASVersusOfflinePack$' -count=1 -timeout=36m -v`；[仅分支专属 CI](../.github/workflows/cas-a07-mixed-physical-pack-crossover.yml)先1000真实物理smoke，再3组100k物理Local/Candidate同源A/B，保留三份完整原始机器JSON、三份Go stdout、三份`/usr/bin/time -v`与`source.txt`源码SHA、`summary.json`共11份。若首次发现 Go格式/harness异常则归档为Invalid，不计真实样本；首次有效n3后把原始11文件永久存到`docs/performance-evidence/cas-a07-mixed-100k-pack/`、在**同一唯一工作提交**更新本规范/登记簿/六平台矩阵/审计文档，再严格重新运行准确证据HEAD n3和完整仓库CI `single-commit` / `final-gate` 全绿才Ready/Rebase合并。

**跨平台：** 这是Server本地Linux Storage层，没有真实Native Desktop Electron、Wide Web、Mobile Web、Desktop installed PWA、Android installed PWA、iOS installed PWA App运行，全列Not measured。本项不代替既有100k真实JPEG/视频/Live缩略图、4GiB大文件真实上传/下载或用户拥有的同步/删除任务；视口AbortSignal→Go Context.Done专项保持独立，用户发起的持久任务不得因滚动或关闭窗口隐式停止。


## CAS-A07 同源混合尺寸原片三组有效A/B（2026-10-17）

来源准确 `af27711466ab47dc796cc5604ced6f47d06d58e2` [原始专项CI #38941750589](https://github.com/lazyxu/xdrive/actions/runs/38941750589) SUCCESS。各组原版生产`Local.Put/Open/Delete`与隔离Pack引用完全相同的100,000独立SHA/385,638,400B混合真原片；源SHA、Linux`st_blocks`、2k跨层`ReadAt`+全SHA、95k释放5k完整幸存、独立物理0B、故意腐坏拒绝及Go CPU/RSS全部通过。按原版/Pack轮流先执行；原版SHA对象键在**计时前统一预计算**，没有首轮测试不公平的Hash CPU。

| 实际三组同源 n3 P50 / 最大 | 原版完整Local CAS | 离线Pack +48B索引 | 解释 |
| --- | ---: | ---: | --- |
| 初始实物`st_blocks` | 677,478,400 B | 390,447,104 B | 候选节省**42.3676%**；低于CAS-A05纯1KiB的73.826% |
| 释放95k后`st_blocks` | 33,873,920 B | 19,529,728 B | 候选节省**42.3458%** |
| 初始写入 Wall | 48,606.482 ms | 1,567.547 ms | 100k次fsync与1包fsync协议不同，**仅离线格式成本** |
| 2000次分层对象全SHA + 独立256B ReadAt | **242.708 ms** | **289.994 ms** | 候选**慢约19.48%**，不得以单纯容量收益掩盖 |
| 95k对象删除/离线Pack新代compact | 10,439.591 ms | 103.597 ms | pack重写/原版unlink字节流程不同，无SQL/Owner验收 |
| Pack1+Pack2 GC阶段最大实体 | N/A | 409,972,736 B | 旧/新两代共存，不能只报GC后20MB |
| 最大Go RSS（所有阶段） | 同一Go进程 | **61,548 KiB** | 预算≤512MiB，不是生产服务器RSS |

**结论：** 原生产Local在冻结每阶段≤900s、RSS≤512MiB、完整SHA/Range/GC预算内；不应为了纯容量目标修改生产完整SHA-256 CAS。真实混合尺寸Pack节省42.4%实体磁盘但2000次覆盖各尺寸的分层随机读反而慢19.5%，故**接受离线容量研究、拒绝“所有尺寸统一Pack”为在线默认架构**。可继续独立测试`≤4KiB`与`16KiB`等阈值对CPU、p95/p99、索引维护、过期引用GC和Crash恢复的收益，尚无经验证的最优阈值。CAS-A05纯1KiB数据不能直接推广到大对象。

**原始机器证据：** [11件永久归档](performance-evidence/cas-a07-mixed-100k-pack/README.md)，tar.gz SHA256 `0037302a6abfcd29a3e5198cbc13cb3d165b910831d20e1d47fee4d94b808812`，原ZIP Artifact #12064001424 `65c3890783e4ee1d7d6e79617115148507b40f5634846fa935fec4ae0c97fa3e`；早期[#38941430856](https://github.com/lazyxu/xdrive/actions/runs/38941430856)的物理数可参考但原版读取计时受到SHA生成干扰，标Superseded并[单独登记](performance-evidence/cas-a07-mixed-100k-pack/ci-run-38941430856-superseded.json)。归档新HEAD专用n3和完整CI FinalGate需**再次全部成功**方可合入；**生产 AFTER=N/A**，所有客户端/已安装PWA该精确Storage层负载仍Not measured。


**2026-10-17 交付核查（更正旧阶段遗留‘待验收’措辞）：** 准确原版归档HEAD `66728a5fe1bf8fa90ef52921bb84f9e1d0397a75` [CAS-A07专用 #38943388762](https://github.com/lazyxu/xdrive/actions/runs/38943388762) 与[全CI #38943388760](https://github.com/lazyxu/xdrive/actions/runs/38943388760) 76 jobs含single-commit/final-gate全绿，[#1893](https://github.com/lazyxu/xdrive/pull/1893)已Ready/rebase合入 `master@07d2e0b4de3334884f3a26a81e3dda5d4cfb8f6b` 且相关分支已清理。上文‘归档新HEAD待复验’仅是历史实验阶段，现完整交付；生产未改/AFTER=N/A，离线Pack读延迟+19.48%仍拒绝普遍生产上线。
