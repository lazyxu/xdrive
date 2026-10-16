# CAS-A03 / S001-d：真实 4GiB 文件仅修改中间 1MiB 的全文件 CAS 版本空间基准

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
