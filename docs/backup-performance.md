# Server 多代备份性能专项：CAS-A04（S001-c）

**状态：CAS-A04a Benchmarking；完整 CAS-A04 尚未测试。** 冻结 GitHub `master@21227c5094ad6c2ec32d69b18bbe19f094c7edd0`。本次只新增可重复运行的物理 CAS 文件数据备份阶段基准、CI 和记录，不改 Server、CAS、权限、恢复协议、持久任务或 Race。完成条件为同一单提交的真实 CI n=3、raw evidence 归档、精确证据 HEAD 完整 CI/final-gate 成功。

## 已有测试去重

入口：[统一登记簿](performance-test-registry.md) / [Blob审查](blob-cas-dedup-architecture-audit.md) / [六平台矩阵](performance-platform-coverage.md)。CAS-A02 已测到全新4GiB上传临时空间与 Go 磁盘写入均约2倍；CAS-A01 已验证10万逻辑文件+10万历史版本共享单 CAS 的授权删除和 last-owner GC。P044/P045/P051 不同平台4GiB传输、P047物理10万CAS删除均已独立实测，不能再次拿来作为本负载 A/B。

## 新负载 CAS-A04a：原版全量 tar 的两代物理空间

源码 [scripts/server-backup.sh](../scripts/server-backup.sh) 的实际文件数据阶段执行 `cd /data && tar -cf - .`，并为 blobs.tar 生成 SHA256SUMS；[server-restore.sh](../scripts/server-restore.sh) 解出完整 tar。**本轮程序只复现这一文件数据子阶段，不运行 Docker、PostgreSQL、API、维护锁、数据库快照或完整恢复**。

[可重现测试脚本](../scripts/bench-cas-a04-backup-generations.py) 与 [独立专项 CI](../.github/workflows/cas-a04-two-generation-backup-tar.yml)：每个样本生成100个 SHA-256 各不相同、真实 fsync 的不可压缩4MiB Blob，合计400MiB，按当前 `.xdrive-blobs/sha256/<2字节前缀>/<完整hash>` 布局。第1代全量tar，之后独立做三种第2代：不变化、新增1个历史Blob（初始规模的1%）、新增100个历史Blob（初始规模的100%）；旧Blob均保留。三种场景各n=3独立实体文件系统，总9组。每组记录两份tar的字节与 st_blocks、wall/子进程CPU/RSS高水位、tar SHA256，真实解包至两个隔离恢复目录，逐CAS哈希核验原始与最新两代100/101/200个完整文件。种子时间、tar时间、checksum时间、restore时间严格分离。冻结原版单代tar预算≤180秒；只在超预算或出现真实容量红项且具备安全候选时做相同环境交替 A/B，生产无变化则 AFTER=N/A。

复现：`python3 scripts/bench-cas-a04-backup-generations.py --results-dir /tmp/cas-a04a-results --samples 3 --object-bytes 4194304 --tar-budget-seconds 180`。精确HEAD CI负责收集9个原始JSON、summary、CPU/RSS、source.txt、真实sha256和runner数据；成功后把可追溯的实际数字、原始证据和CI写回本页、登记簿及平台矩阵，在**原固定父提交上的一个工作提交** amend 后重新跑正式专项及完整 final gate，未运行不可称 Passed。

## 本轮本地隔离探索（不是源码准确 GitHub CI）

2026-10-16，本地 Linux / Python3.13.5 / GNU tar 1.35，等价文件数据tar操作，3组/场景均完成双归档实际提取与逐文件 SHA 正确性验证。100×4MiB 初始物理原片；两代tar合计：不变 **839,065,600 B**；新增1% **843,264,000 B**；新增100% **1,258,577,920 B**。第2代tar P50：**520.219 / 541.929 / 1,269.893 ms**；提取 P50：**1,466.306 / 1,228.049 / 2,378.424 ms**。这是**本地探索证据**，并非新PR准确HEAD或完整 Server 备份、生产磁盘/网络/容量实测；本PR内 CI 独立源实现可能存在常数开销差异，不能拿两者作优化提速A/B。主问题是0%变化仍生成完整第2份归档（空间重复），而不是这一台机器的tar时间。

## 下一步与技术边界

CAS-A04b 针对 [restic](https://github.com/restic/restic)、[Kopia](https://kopia.io/docs/advanced/architecture/) 和 [Borg](https://borgbackup.readthedocs.io/en/latest/internals.html) 做**离线候选备份仓库**同数据/同磁盘/同压缩+校验策略 n≥3，量测0/1/100%变化、真实源读+内核磁盘写、CPU/RSS、空间以及任一代完整恢复/中断损坏/GC/回滚；正式迁移需证明 DB+CAS 在一个维护时点一致，不改变已发布的backup格式或假定实时在线CAS自动chunk化。CAS-A03则另用同一个真正4GiB高熵Blob中部**只改1MiB**的新完整 SHA 两代，比较整文件与离线CDC PoC对实际上传流量、存储字节、Range seek、恢复hash、版本引用和GC的收益/风险。**完整 CAS-A04和 CAS-A03仍Not measured**。

此后还需真实Desktop/Wide Web/Mobile Web以及Desktop/Android/iOS OS-installed PWA独立结果；本例只有共享服务端tar阶段，不能填六个平台的真实 UI / transfer / cancellation 性能。视口AbortSignal→Go ctx.cancel仅作用于无消费者的短请求，不应终止用户拥有的备份/上传/下载/同步/删除。


### 2026-10-16 · CAS-A04a 首次真实 GitHub 原版 CURRENT n3（正确，不等于完整Server备份）

冻结原始提交 `16bd2bd417a42ab291fe001702828619f6189b5d` 的[分支专项CI #38863629669](https://github.com/lazyxu/xdrive/actions/runs/38863629669) **SUCCESS**，3种变化率各3组独立400MiB物理原片、2代全量tar/恢复 SHA 核验全部通过，冻结单代tar≤180秒没有真实性能RED，因此没有修改生产备份格式或在线CAS。原始9样本与资源明细已经[归档](performance-evidence/cas-a04-two-generation-tar/README.md)，原始Github artifact #12029704954；还需要本次证据归档修订之后**精确新HEAD**专项+完整CI/final-gate通过才可视为最终交付。

| 初始版本变化率（保留旧CAS） | 两份归档占用 P50 B | 第2代tar P50 ms | 第2代文件数据提取 P50 ms | 最终CAS原片实际分配 B |
| --- | ---: | ---: | ---: | ---: |
| 0% 新增 | 839,065,600 | 2,714.525 | 273.968 | 419,430,400 |
| +1% 新增 | 843,253,760 | 2,525.749 | 270.277 | 423,624,704 |
| +100% 新增 | 1,258,567,680 | 4,963.380 | 528.633 | 838,860,800 |

注意：上述真实CI runner数据不同于先前本地Linux隔离探索 520/542/1270ms，这是**不同环境的CURRENT vs CURRENT**，不可跨环境计算“优化提速”。全程只量测Server文件数据tar的文件系统部分，不含数据库维护快照及服务恢复。记录形式：BEFORE=CURRENT；AFTER=N/A；speedup=N/A；无需改动生产；下一实验CAS-A04b(restic/Kopia/Borg)或CAS-A03(真正4GiB中改1MiB)另立数据基线。

### 2026-10-16 · 首轮归档头 Invalid harness 与校验恢复（非生产性能红项）

[#1795](https://github.com/lazyxu/xdrive/pull/1795) 证据首轮归档头 `469651023e6a64b2f54adcf0c56631b23dcd0c0b` 的[专项 CI #38864841379](https://github.com/lazyxu/xdrive/actions/runs/38864841379) 在第二套物理n3原片 tar/restore 全部成功之后，由于把 `ci-evidence.tar.gz` 输出写在正在 `tar` 的目录内，报 `tar: .: file changed as we read it` 并失败；不是生产tar性能退化，不能作为交付绿CI。第二套实际测量也不能作为生产AFTER，因为根本没有产品优化。现将输出改为 `$RUNNER_TEMP` 后再复制，验证已永久保存首次Artifact原始13文件的完整SHA和源准确HEAD；首次有效原版数值和失败历史保留。准确修正HEAD的分支专项和完整final-gate仍是强制交付门槛。


## CAS-A04b/S001-c2 — 两代全量 tar 对比离线 Blob Manifest 增量备份（2026-10-16）

**CAS-A04b原版和离线候选真实同源n3×3已测；候选空间/写盘符合门槛，但完整恢复显著变慢，生产AFTER=N/A；最终永久全样本证据归档和新HEAD CI未完成。** 冻结GitHub master@f463d45a8445c9941f39bbc488ca4dbbe65d600b，在同一工作提交上增加离线benchmark与源准确分支CI（绝不改动生产 Server backup/restore、Blob/ContentBlob、PG或Race）。上游CAS-A04a #1795已验收历史单独原版n3，0/1/100新CAS两代tar物理占用分别是839,065,600 / 843,253,760 / 1,258,567,680B；CAS-A03-d2 #1816真实离线4GiB Chunk复用已合入。本次测试**新增真实同一机器同源A/B**，不可直接把历史A04a不同Runner数字当BEFORE。

- **负载身份**：初始100个独立SHA-256原片，每个真fsync、实体分配4MiB，共400MiB；第二代新增0/1/100个相同大小的不同SHA原片；每场景三独立数据源n3，总9组。A/B均取自完全相同的物理源；原版调用既有`scripts/bench-cas-a04-backup-generations.py`的`snapshot`、`restore_and_verify`（真实 GNU tar文件数据阶段）；候选创建**全独立拷贝**不可变hash对象+两个持久Manifest（非源硬链接、不依赖源设备），同源按样本顺序交替。
- **验证**：记录每阶段真实`st_blocks×512`、`/proc/self/io write_bytes`、wall、CPU、Go无关Python RSS；创建完备份后**删除全部源数据**，两代原始tar与候选均逐原片SHA独立恢复；拒绝缺失对象或哈希污染，不发布坏的第3代；删除第2代仅回收其新增对象，第一代可完整恢复；最后删除第一代、对象归零。
- **冻结预算**：相同Runner候选二代实体空间/内核写字节两项各≤原版两份tar的55%（0/1%变化）；100%变化各≤80%；单个新建备份阶段wall≤180秒，进程RSS≤512MiB，2×全量恢复SHA/缺失与损坏拒绝/代际GC无一错误；超过预算先判断夹具Invalid还是性能RED，只有同源真实改进且安全恢复无回归才能接受候选。此阶段不改变产品，所以生产BEFORE=CURRENT、AFTER=N/A，不宣称线上提速。
- **执行**：`python3 scripts/bench-cas-a04b-offline-incremental-ab.py --results-dir /tmp/cas-a04b-results --samples 3 --source-count 100 --object-bytes 4194304 --stage-budget-seconds 180`，[分支专属CI](../.github/workflows/cas-a04b-offline-two-generation-ab.yml)。初轮n3后将9份JSON、summary、资源、source SHA与stdout永久存入`docs/performance-evidence/cas-a04b-offline-two-generation-ab/`，在**同一个唯一工作提交**更新登记簿、六平台矩阵、此文档和Blob架构审查，随后新HEAD专项+完整CI final-gate才可Ready/Rebase合并。
- **开源设计参考**：[restic](https://github.com/restic/restic/blob/master/doc/design.rst)备份先写数据/索引后发布快照以及内容定义块；[Kopia](https://kopia.io/docs/advanced/architecture/)Blob/CABS/CAOS/Manifest分层；[Borg](https://borgbackup.readthedocs.io/en/stable/internals.html)跨代chunk复用。但本测试是**自建只读离线实验**，没有直接运行这些项目CLI，也没有Pack/CDC/加密或跨用户备份。不能据此迁移现行`blobs.tar`格式，仍须独立证明PostgreSQL+CAS同一维护时点的一致性、正式安全恢复、迁移回滚及多代GC。六端GUI Desktop/Web/Mobile Web/Desktop installed PWA/Android installed PWA/iOS installed PWA此负载全部Not measured；视口Go ctx取消和耐久任务所有权原样保留。


### CAS-A04b · 首轮真实9样本源准确数据（2026-10-16）
[专项 CI #38899731578](https://github.com/lazyxu/xdrive/actions/runs/38899731578) SUCCESS，原始源码SHA `af6605037ee58b32d2048454c30c4bae6cfa0309`；完整[Artifact #12045612018](https://github.com/lazyxu/xdrive/actions/runs/38899731578/artifacts/12045612018) ZIP SHA256 `d9cabfa1fd440e69c954dde4a05528d44089beaaf6b570164988277f058992df`。机器Summary与9个原始stdout数据行、完整Native CI日志和源文件哈希见[本仓库性能证据目录](performance-evidence/cas-a04b-offline-two-generation-ab/README.md)。每场景100个实体fsync、不同SHA的4MiB原片，第二代增加0/1/100个真实新对象，n3×3全部通过，源物理删除后两代全量SHA成功，缺失/腐坏拒绝及剪枝GC保留旧代正确。资源`/usr/bin/time -v` Linux整组RSS峰值28,780KiB，用户CPU49.63s/内核CPU39.69s。

| 第二代新原片 | tar两代实体P50 B | 离线仓库两代实体P50 B | Candidate/Original 实体与write_bytes | tar第二代创建P50 ms | 候选第二代创建P50 ms | tar完整第二代恢复P50 ms | 候选完整第二代恢复P50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 839065600 | 419463168 | 0.499917 | 2825.242 | 667.743 | 571.735 | 2495.642 |
| +1 | 843264000 | 423657472 | 0.502402 | 2871.743 | 691.506 | 575.683 | 2526.463 |
| +100 | 1258573824 | 838909952 | 0.666556 | 5657.082 | 3187.011 | 1134.933 | 5034.011 |

**决策：实验离线空间节省50.0083%/49.7598%/33.3444%，实写IO同数量级显著下降，但候选完整恢复约4.4倍较慢；因此可保留为离线容量设计证据，**生产上线NO-GO**，不改原tar/restore协议。不可将备份文件子阶段实验推广为真实PG一致性/Restic-Kopia-Borg二进制、在线CDC或六端客户端。首轮完整9份源JSON仍在原Artifact中：后续新HEAD将向日志输出源字节证据再永久归档；按AGENTS.md准确最后HEAD双CI/final-gate成功前PR须保留Draft。

### CAS-A04b 第二次源准确真实n3完整JSON已归档（2026-10-16）

继第一次[专项CI #38899731578](https://github.com/lazyxu/xdrive/actions/runs/38899731578)后，同一生产原版/离线候选代码在上一证据工作HEAD `fa217484641d679cfe8e8de8da67b8f9e9d87d29` 再做三独立源×3变化率，准确[专项CI #38901666869](https://github.com/lazyxu/xdrive/actions/runs/38901666869)成功。**已将9个原始sample JSON、summary、source、实际进程资源日志按CI原文件输出永久写入[证据目录](performance-evidence/cas-a04b-offline-two-generation-ab/README.md)**；`source.txt`记录来源工作SHA及被测脚本SHA256。两代原版/离线持久字节与候选write_bytes P50比例：0变更 `839065600/419463168B, 0.499917`；+1对象 `843264000/423657472B, 0.502402`；+100对象 `1258582016/838909952B, 0.666552`。CPU/RSS和每阶段wall见逐样本原JSON。

| Gen2变化 | tar创建P50 ms | 候选创建P50 ms | tar恢复P50 ms | 候选恢复P50 ms |
| --- | ---: | ---: | ---: | ---: |
| +0 | 1337.463 | 592.920 | 651.307 | 1056.847 |
| +1 | 1364.959 | 603.113 | 658.059 | 1088.042 |
| +100 | 2962.507 | 1504.934 | 1294.193 | 2394.714 |

**两轮不同GitHub runner的wall差异不能当优化；** 固定空间结论可复现，候选恢复仍比tar慢约1.6–1.9倍（第一次runner约4.4倍），不应把离线容量节省当生产端到端加速。原版恢复正确、源删后两代全SHA、corrupt/missing拒绝/GC均pass，**只接受为离线可行性证据，生产备份格式/协议不变**。此归档的新提交还需再次验证准确HEAD专项CI+完整CI/final-gate才可Ready/Rebase合入；客户端六平台此次均Not measured。
