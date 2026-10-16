# LP-P002 · Desktop Agent Go IPC + 真实100k本机物理文件扫描/Journal/Delta

## 阶段及已验收基线（2026-10-16）

**Measured original CURRENT n3 passed / ACCEPTED — 产品原版预算内且未更改，AFTER=N/A，speedup=N/A；原始11机器文件永久归档后准确证据HEAD专项与全CI待验收。** 固定GitHub `lazyxu/xdrive` master `20f5a24b08e0c1cd8da922cae5cc4524fb6eb975`，唯一分支 `perf/localpush-desktop-agent-ipc-100k-physical-20261016`，仅 opt-in Go Linux测试/CI/文档。依据[统一性能登记簿](performance-test-registry.md)、[LP-P001 native Go baseline](localpush-native-physical-performance.md)、[跨平台矩阵](performance-platform-coverage.md)、[Blob/CAS审计](blob-cas-dedup-architecture-audit.md)，不重测已通过 LP-P001 的**直接Go函数扫描**负载，也不复测 P053/P054/P052 的图库或文件管理器100k缩略图取消、P044/45/51的4GiB上传。

**历史对照（非同条件A/B，禁止计算跨环境提速）：** LP-P001 `100,000真实不同1KiB .bin普通文件/100个目录` 的 Native Go直调 `ScanInventoryToJournal` gen1/2 P50 **912.402/928.290ms**，`StreamInventoryGenerationDelta` P50 **2,418.643ms**，Go峰RSS **24,084KiB**；[准确原始来源](performance-evidence/localpush-native-physical-100k/README.md)。原版预算内没有产品改动。

## 新增、且与 LP-P001 不同的真实层

本轮实际测试的链路为 **真实localhost TCP HTTP + Agent生产`newDesktopIPCHandler`鉴权、路由、序列化 → opt-in *仅测试* controller adapter → 生产`localpush.ScanInventoryToJournal/VerifyInventoryJournal/StreamInventoryGenerationDelta` → 本机真实inode和Journal**。IPC必须Bearer鉴权，匿名请求401、正向请求HTTP200、输出绝不携带OS路径、Root ID/fingerprint、device token、原始item paths。**Adapter 是测试替身**：它没有调用生产`agentController.CloudSaveLocalBoundBackupSnapshot/CloudLocalBoundBackupDelta`的真实Server Source授权/账号密钥/Source修订复验，不是完整拥有设备授权的生产Agent路径；也没执行Electron Renderer/Main/Preload或云端100k Push。不能把它写成已验收全Desktop/Windows、用户Device Backup、跨账户CAS或UI。

每个真实样本使用100个目录×1,000独立不可硬链接的fsynced? **测试源采用真实`os.WriteFile`、普通文件/独立(inode,device)/非稀疏st_blocks和独立SHA校验，不宣称逐文件fsync**：共100,000个不同SHA 1024B `.bin`，逻辑102,400,000B，Linux磁盘块分配≥409,600,000B；三独立Source SHA/根目录。每个样本先真实原生RootGrant批准，再HTTP POST明确保存第1代生产Journal、修改1000个文件+32B、移除1000、物理创建1000，再HTTP POST保存第2代；用生产Go私有有界SHA/Journals验证。最后从Go Agent真实IPCLoopback GET读取只含摘要的Delta：**added=1000/changed=1001(含目录)/metadata-stable=98099/absent-candidate=1000**，绝不authoritative/删除。HTTP序列化/反序列化开销纳入阶段 wall；源seed和mutation独立计时不算 IPC，真实过程CPU（Rusage User/System）、Linux进程write_bytes和RSS逐阶段记录。此工作负载不是可解码JPEG/H264/Live/RAW，不能冒充图库缩略图/真实视频解码。

## 冻结预算与结果决策

3个新根/独立测试进程，每个Gen1/Gen2真实IPC+Journal+完整SHA≤180,000ms，GET Delta IPC≤180,000ms，源码种子≤300,000ms，总Go MaxRSS≤512MiB；每次IPC响应≤4KiB、匿名401、隐私项0、实体inode严格100,000、实际分配≥409,600,000B、三组SHA互异/所有两代真实字节/分类安全。**首次实测原版 CURRENT 达标→原版照旧，AFTER=N/A、speedup=N/A；真实RED才隔离夹具错误后做相同原片/IPC场景最小生产性能优化与交替n≥3 BEFORE/AFTER，只有稳定显著收益且CPU/RSS/IO、权限和正确性无退化才保留**。无Race修改。IPC取消属于明确读取请求；不对窗口离开时隐式取消用户发起的耐久上传/下载/同步/删除。

可复现 Go 指令：
`XD_LP_P002_AGENT_IPC_PERF=1 XD_LP_P002_SAMPLE=sample-1 go test -mod=readonly ./cmd/xdrive-agent -run '^TestLP002DesktopAgentLoopbackIPCPhysical100KPerformance$' -count=1 -timeout=25m -v`

[分支专项工作流](../.github/workflows/lp-p002-agent-loopback-native-100k.yml)先编译真实Agent测试二进制、1000物理文件smoke，再三独立100k真正Native Root样本；每样本机器JSON、Go log、`/usr/bin/time -v`进程资料、原HEAD SHA/真实8个源码文件SHA、完整summary原件均上传GitHub Artifacts；不能把mock Controller叫做真全链路。CI第一次有效n3后在**本分支同一唯一工作提交**追加真实数字和永久原始文件 `docs/performance-evidence/lp-p002-agent-100k-ipc/`，更新本规范、登记簿、六端矩阵、Blob审查，重跑**准确最终证据HEAD**专项n3和完整CI/final-gate全绿才能 Ready/Rebase 合入。

## 平台/完整功能的未测项

本测试属于 **Linux原生Go Agent IPC HTTP子链路**。六平台产品层：Native Desktop Electron（真实Renderer→Main→Preload及真实持久账号Server proof/Windows设备）Not measured；Wide Web Not measured；Mobile Web Not measured；Desktop installed PWA Not measured；Android installed PWA Not measured；iOS installed PWA Not measured。实际100k物理远端Push/Pull、4GiB WAN断点、Server SHA CAS去重/Owner/GC、100k GUI删除/恢复与各种真实视频/Live Photo仍Not measured。


## LP-P002 源准确原版首轮真实 n3（2026-10-16）

原始固定源码 `d2fd14f8f1ecbdc5ed772aa2e1c00be08cfc56d4`，[专项CI #38917769347](https://github.com/lazyxu/xdrive/actions/runs/38917769347)成功：Go构建、1000个物理文件smoke及3个独立真实100k源实例；真实HTTP loopback Bearer认证/匿名401、无隐私路径泄露。原始机器[11份证据完整归档](performance-evidence/lp-p002-agent-100k-ipc/README.md)；真正原片各100,000×1024B、100个目录、100,000 unique inode、st_blocks409,600,000B，非Image/Video/Live编码。每次经过测试专用Controller Adapter进入生产LocalPush Scan/Journal和Delta，**没有覆盖正式owning-agent remote Source授权或Electron全IPC链**。

| 每样本真实 P002 源 | Source seed ms（排除） | Agent HTTP first snapshot ms | Agent HTTP second snapshot ms | Agent HTTP advisory Delta ms | Go进程MaxRSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| sample-1 | 4190.020 | 991.558 | 1029.784 | 2439.299 | 25,824 |
| sample-2 | 4189.337 | 985.176 | 997.674 | 2416.314 | 25,944 |
| sample-3 | 4171.416 | 975.711 | 984.614 | 2406.370 | 25,500 |
| **n3 P50 / 峰值** | **4189.337** | **985.176** | **997.674** | **2416.314** | **25,944** |

每组一次真实保存Source根私有Journal写入 `26,820,608B`、第二次 `26,832,896B`，Delta私人spool `77,119,488B` kernel `write_bytes`；源seed各 `409,600,000B`。后3次IPC响应各256/255/223B，无路径泄露、Anonymous不能调用。三组两代文件数100k、changed=1001（含目录）、added=1000、stable=98099、absent_candidate=1000、`Authoritative=false`、`MissingInferenceSafe=false`。原始JSON记录CPU User/System、MaxRSS等资源分阶段，完整原始进程`/usr/bin/time -v`没有被覆盖。

**决策：当前原版P002各项≤冻结预算，Accepted CURRENT；产品没有优化，生产AFTER=N/A、speedup=N/A。** LP-P001的0.9s/2.4s属于另一Runner/不同调用层的独立历史基线，不计算`985-912ms`为真实IPC开销或优化收益。候选测试Manager并不执行Server Owner proof、正式Agent版本隔离/PG/ContentBlob、Desktop Electron、6端PWA或真实网络Push，保持Not measured。

**Final Gate：** 原始来源、格式化版源码hash、完整11原始文件SHA256 [见证据](performance-evidence/lp-p002-agent-100k-ipc/README.md)；本次证据修订提交需**再跑专用真实n3 +完整CI含single-commit/final-gate**，新HEAD通过后才Ready/Rebase合并。首轮原始正确数据永久保留。
