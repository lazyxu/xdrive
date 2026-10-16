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
