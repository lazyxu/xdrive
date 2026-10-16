# CAS-A05 · 100k不同SHA小原片（1 KiB）物理 CAS vs 离线 Pack/Index/95k GC 同源 A/B

**阶段：Accepted OFFLINE A/B n3（原生产Local CURRENT已实测，候选离线Pack容量/IO明显改善），生产AFTER=N/A、线上speedup=N/A，生产代码未改；最终证据HEAD专项与全仓FinalGate尚待完成。** 2026-10-17，GitHub `lazyxu/xdrive` 冻结 master `4f1d4bc9cf6fa5ca84c945fa1e14fc375b3f79b8`，唯一短期分支 `perf/cas-a05-physical-100k-small-blob-pack-ab-20261017`，**生产Blob、metadata/ContentBlob、SQL、StorageKey、跨账户配额、FUSE、Web/Desktop/PWA、race均零修改**。首轮有效n3后同一单工作提交更新文档和原始证据，再精确最终HEAD专用n3和完整CI/final-gate。

## 为什么不是重复100k测试

[性能中央登记簿](performance-test-registry.md) 已验收CAS-A01（200002逻辑引用仅1个1KiB物理对象，最后引用释放安全GC）；P046（100k个不同SHA、95k实际物理CAS删除，原版P50 **120,493.622ms**）和P047（授权HTTP永久删+SQL/物理CAS P50 **155,241ms**）、LP-P001（原生100k本机文件与Journal）与LP-P002（Agent HTTP Loopback，测试Adapter/本机扫描）。本**CAS-A05**是新而不同的**同字节集、不同物理格式 A/B**：100k SHA各异原片，生产Local.Put物理文件 vs 测试私有连续Pack+定长二进制Index；删除95k后只保留5k。用户关注Blob最底层多小文件真实4KiB块浪费和GC、随机读；历史各项不能提供Pack candidate的实际分配、IO/CPU/延迟或GC可靠性。**不存在任何线上Pack实现**，不要用离线结果承诺部署收益。

## 物理负载与严格安全边界

- 三组独立sample-1..3，各由独立Linux Go进程/独立根生成**同一轮100,000份彼此SHA256不同的真正1,024B源数据**；每份标准库 SHA-256伪随机内容、可读原片（不是稀疏/重复/虚构JPEG/H264/HEVC/Live）。每个sample对Baseline和Pack的**内容完全相同**、偶数样本候选先执行、奇数样本原版先执行、真实source aggregate SHA可审计。test进程同时记录总CPU User/System、kernel `/proc/self/io write_bytes`、每阶段wall、peak RSS和Linux `st_blocks×512`，**不把不同Runner历史P046当作本轮原版BEFORE**。
- **真实Baseline：** 实际生产 `storage.Local.Put(ctx, ContentAddressedKey(sha), bytes.Reader)` 执行100,000次，各文件完整SHA不可变校验、实际atomic rename/fsync和CAS shard OS写锁；统计100k**独立原片文件inode**真实`st_blocks`、真实2,000个混合位置小原片Open/校验SHA/256B Range子区间；对95,000个SHA调用`Local.Delete`物理回收、再用`Local.Open`逐一验证全部5000个幸存SHA，最后删5000个并证明物理数据0。
- **Candidate（仅离线）：** 100,000个相同原片写入一个fsync真实独立Pack文件、一个固定48字节/对象 binary Index（8 byte offset +4 size +32 digest +4 reserved）与独立fsync/rename的HEAD元信息；**不硬链接Baseline对象**，真实st_blocks计全部Pack/Index/HEAD；读取已持久Index校验其SHA与偏移/大小/唯一hash，再执行相同2000个小原片 SHA/256B Range；删除95k仅通过写入包含完整5k SHA验证幸存bytes的新Pack+Index并先提交新HEAD/再删除旧代对象，真实记录compaction期间物理峰值和最终GC占用；逐个校验所有5k内容，故意破坏1字节后必须SHA拒绝、恢复前字节再校验，最后删除所有Pack+Index+HEAD并证明0。**没有多租户权限、加密、online GC锁/原子DB共识、引用持久SQL或跨平台文件系统锁**，即使量测容量优势也绝不能替换生产CAS。
- frozen **correctness+budget**：真实100,000不同SHA/基线真实100,000分配inode、物理baseline≥409,600,000B（原版小对象每份4KiB块）；物理baseline GC剩5000文件≥20,480,000B，候选Pack full及GC后各最多baseline实体的35%，候选GC原子提交期间峰值>其原代实体数据，Pack完整source/file read+SHA/随机Range及故意损坏拒绝，最后两组都0；每个实际Put/pack/95k Delete/compaction/2000读/5k幸存验证wall≤900秒，进程MaxRSS≤512MiB。RSS和采样环境以同一 CI机器进程资源为准，wall跨Runner不能计算加速比。
- 如真实同源 original和candidate都通过冻结correctness与performance预算，保留独立离线容量实验并如实归档各阶段资源、风险和后续验证；**生产 CURRENT 仍只为已经实测的Local，AFTER=N/A，没有线上存储空间节省或GC加速**。如超预算先保留原始数据，区分 Invalid harness/候选Rejected/真实生产RED，不能容忍SHA、Owner、GC错误换取性能。GC压缩期间暂时占用旧Pack+新Pack，这必须在预算表中独立标注，不能只报最终体积。

## 复现与性能记录

Linux `XD_CAS_A05_REAL_100K_PACK_PERF=1 XD_CAS_A05_SAMPLE=sample-1 go test -mod=readonly ./internal/storage -run '^TestCASA05Real100KPhysicalLocalCASVersusOfflinePackGC$' -timeout=36m -count=1 -v`。CI先1k真实物理smoke，再3独立100k实际样本，采集summary/三原始JSON/三stdout/三`/usr/bin/time -v`/source SHA。使用[分支专用CI](../.github/workflows/cas-a05-real-100k-physical-pack-gc.yml)；有效首轮后把**全部11个机器文件**以source-accurate SHA/可复查Archive长期归档 `docs/performance-evidence/cas-a05-physical-100k-pack/`，连同本规范、[中央登记簿](performance-test-registry.md)、[跨平台矩阵](performance-platform-coverage.md)、[Blob审查](blob-cas-dedup-architecture-audit.md)在**同一唯一工作提交**更新，再跑新HEAD专项和完整CI/FinalGate才能Ready/Rebase合并。

### 开源参考与取舍

- [Kopia架构](https://kopia.io/docs/advanced/architecture/) 分开content-addressable data与pack/index/manifest：避免把“物理小原片Pack”误称与逻辑 CAS身份冲突，但需要原子可恢复Index、packs生命周期和GC读写隔离。
- [restic设计](https://github.com/restic/restic/blob/master/doc/design.rst) 基于 pack/data/index与快照提交顺序，Pack去重由对象hash维持引用身份；需要真实时延/尾延迟与操作可取消性评估。
- [Borg internals](https://borgbackup.readthedocs.io/en/stable/internals.html) 的chunk存储及垃圾回收值得参考，但内容级分块和本轮**小对象打包**是不同维度。采纳设计前先在 xDrive现有 SHA-256、ContentBlob RefCount、Owner鉴权/权限隔离、备份/恢复和 CfAPI/FUSE 的原有读语义上证明正确性。

**六端状态（本精确负载）：** Native Desktop Electron真实用户操作Not measured，wide Web Not measured，Mobile Web Not measured，Desktop installed PWA Not measured，Android installed PWA Not measured，iOS installed PWA Not measured。仅 Linux本机实际Local CAS与独立离线Pack单层被测。真正100k物理原片到Server的Push/Pull、真实上传下载/同步/Undo、用户任务取消、Android/iOS后台仍另列Not measured；不能把视口AbortSignal ctx取消扩展到耐久任务。


## CAS-A05 首轮真实100k原片物理 Pack A/B n3结果（2026-10-16）

准确源码 `5f6e65be454ff9b4e44b134dbf5037d21e298ad8` 的[专项原始CI #38923178061](https://github.com/lazyxu/xdrive/actions/runs/38923178061) SUCCESS，Linux真实生产`Local.Put/Open/Delete`每组100,000个不同SHA1KiB原片、新文件真实40万KB块分配；相同内容不同顺序运行仅离线连续Pack+48B/物理对象Index+HEAD。三独立同Runner源、每组真实2000次SHA/256B Range、95,000真实原片回收和5000保留完整SHA及模拟损坏拒绝、两个方案最终0B**全部通过**。

| 同一CI/同源 n3 P50（物理文件系统） | 生产原版 Local CAS | 独立离线Pack/Index |
| --- | ---: | ---: |
| 完整100k实体 st_blocks | **409,600,000B** | **107,208,704B** |
| 回收95k后5000实体 st_blocks | **20,480,000B** | **5,365,760B** |
| 初始100k写入 wall | **39,876.635ms** | **1,746.064ms** |
| 2000次完整SHA/256B Range wall | **39.789ms** | **10.299ms** |
| 释放95k物理对象 /离线compact wall | **15,224.772ms** | **67.932ms** |
| 净创建源物理写入 kernel `write_bytes` | **409,600,000B** | **107,204,608B** |
| 处理95k移除阶段 kernel `write_bytes` | **0B**（unlink,不含设备元数据journal） | **5,365,760B**（重新compact写） |
| 旧包与新包并存时物理峰值 | 不涉及pack，删除未产生新原片 | **112,570,368B** |
| 进程最大RSS | — | **40,412KiB**（整个测试进程） |

样本真实数据、user/system CPU、`/proc/self/io`和`st_blocks`详见[11份完整原始机器证据长期归档](performance-evidence/cas-a05-physical-100k-pack/README.md)，不是从 4KiB 存储块理论估算结果。完整时候选/原版空间比P50 **0.26174**，**空间减少73.826%**；GC后比值0.262（减少73.8%）。测试中 Pack1+Pack2 暂存峰值超过最终Pack1的容量约5.36MB，这笔峰值不能隐藏。三组基线和候选过程分别以同一payload身份执行，样本2 Pack优先、1/3原版优先；不与历史不同runner P046最后释放120s相减。

**判定：保留离线候选实验（Accepted Offline），生产默认`Local`和`ContentBlob`零修改。** 1.746s vs 39.877s 主要包含100k个逐原片fsync/加锁对比一个Pack顺序写的格式差异，GC 67.932ms是本地无数据库的文件重写，不包含线上RefCount和Owner事务/多进程读写栅栏，故**不能**称“生产上传提速22倍/回收提速224倍”或保证远端/Windows低延迟。随机读样本来自Linux热缓存，非HTTP Range/视频Seek。生产AFTER=N/A，线上空间收益=N/A，拒绝未经过完整安全审计直接替换Storage接口。

**运行完整性证据：** 原始CI artifact [#12056230755](https://github.com/lazyxu/xdrive/actions/runs/38923178061/artifacts/12056230755)，原始ZIP SHA256 `01f1c297f42aadafec23c7f937f6f79d639f9d9ea909589784222c74fe8129ce`；Git中原样11机器文件确定性tar.gz SHA256 `8e4ce0493ac50f478b425f504fb5286ccb8702648f6e196e90554322e0b87040`，Git blob `e5f8cbb960270192146ca0db220a44f7fde624b4`；源文件以CI中`gofmt`规范化后的确切SHA对应，已在本修订作为同一测试源码保存。新证据HEAD在**执行100k数据前**必须逐字节核验完整tar/原始11件/四个源文件当前SHA/3样本P50，再完成新HEAD真实n3及全仓FinalGate双绿才允许Ready/Rebase合入。仍须今后单独测试Pack中坏Index修复、Crash断点/跨进程GC与SQL引用事务、远端大对象+多Owner、随机读尾延迟/冷缓存和被剪枝原片保留窗口。
