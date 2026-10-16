# CAS-A06 · 100k 不同SHA物理小Blob冷／热缓存随机读取：生产 Local CAS vs 离线 Pack

**阶段：Accepted OFFLINE 真实n=3 Advisory Cold/Warm A/B（原版Production Local CAS CURRENT已测；生产 AFTER=N/A，speedup=N/A，生产代码零修改）；准确最终证据HEAD专项及完整CI FinalGate复验仍待完成。** 2026-10-17，冻结 `lazyxu/xdrive@3b2439332c117b9519b2fcd0f111d0f36bbeb789`，独立分支 `perf/cas-a06-physical-100k-cold-read-20261017`，只有opt-in测试及性能规范变更；**不变更生产Blob、Owner/CAS引用、GC、同步/上传/下载、Race和任务所有权**。

## 先核对已有工作，禁止重复测已验收负载

- [统一性能登记](performance-test-registry.md)、[CAS-A05 小对象空间/GC](cas-small-pack-performance.md)、[Blob审查](blob-cas-dedup-architecture-audit.md)、[六平台矩阵](performance-platform-coverage.md)。
- CAS-A05 [PR #1872](https://github.com/lazyxu/xdrive/pull/1872)已源准确专项+完整CI/FinalGate通过并合入：100k不同 SHA 的1KiB实际生产 Local CAS物理409,600,000B、离线Pack+Index107,208,704B、95k释放后20,480,000B vs5,365,760B；2000真实SHA读取原版P50 39.789ms、离线候选10.299ms。但这些随机读取是**Linux热缓存**，不能直接推出未命中本地/远端磁盘时的吞吐和P99尾延迟。CAS-A06才新增**原文件同源Linux FADV_DONTNEED advisory cold** vs 热命中。
- P053/P054/P052实际100k不同JPEG/Go Request.Context取消、P038/P049/P050的115k实际JPEG/H264/Live Web/Desktop/Mobile Web、P044/P045/P051实际4GiB Web/Desktop/Mobile Browser上传/下载，均是其他负载；本项不重测任何UI、上传/下载、源文件扫描或GC。
- `perf/localpush-single-stage-100k-journal-io-20261017` 是另一未产生工作提交的LocalPush相关分支，不在本项范围；不覆盖与正在开发的真实Owner Source Agent feature PR。

## 冻结物理负载、真实读取与缓存不确定性

在**同一Linux Runner**，每个独立源样本（n=3）原有 `casA05ActualPayload(sample,index)` 创建100,000个不同SHA的真实1KiB CAS原片；生产Baseline经100k次真实 `Local.Put`（fsync/校验/immutable key），物理分配需≥409,600,000B。离线候选用相同字节构建**独立路径**真实 `gen1.pack` + 48B二进制Index/对象 +已fsync `HEAD.json`（不是硬链接，也不在SQL引用）。完整数据真实性来自已验收CAS-A05生成器源与本次三组SHA。

同源每组生成2000个**互不重复**的伪随机物理对象下标，两个方案执行完全相同的2000次原始字节/完整SHA和256B Range校验：
1. Baseline 在正式随机读取**计时前**打开这2000个真Local文件，逐一调用Linux `unix.Fadvise(fd,0,0,FADV_DONTNEED)`后关闭，每次成功才计一次驱逐提示。
2. Candidate 在正式随机读取**计时前**对已fsync的整包FD执行同样 `FADV_DONTNEED`，完整Index已载入；随机 `ReadAt`相应偏移，每个SHA/RANGE与原内容比对。
3. 对同一列表，**不再次驱逐**，马上重读2000次作为温缓存组。各个读阶段独立记录wall、user/system CPU、`/proc/self/io read_bytes/rchar`、Minor/Major Page Faults、每请求μs P50/P95/P99/Worst、RSS；数据源/Pack初始创建耗时与这些读取计时严格分离，按奇偶sample交换Baseline/Candidate运行顺序。
4. `FADV_DONTNEED`只是**Advisory**：并不能保证真实用户HDD、NVMe、远端对象Store或物理机器缓存一定被驱逐。因此每一组要求Linux `read_bytes>0` 为有可见存储IO的最低有效证据；如果原版/Pack读计时阶段任一方=0，标为**Invalid environment**而不是认为它“0磁盘IO最好”。即使>0也不能宣称所有页完全冷，必须保留原始真实bytes和温热层次供判断。

## 冻结性能与安全门槛

- **三组有效n3**，一组100k独立原片、两条物理格式隔离、每组2000唯一读取；完整SHA/RANGE**全部正确**，Linux fadvise调用全部成功，两个Cold阶段`read_bytes>0`。任何失败必须归档 Invalid/RED，不能单靠st_blocks推断。
- Baseline物理≥409,600,000B；候选Pack总st_blocks≤0.35×原版（此处是已验收CAS-A05静态正确性核对，不算新空间优化）。单组初始原版造数据≤300s、Pack写入≤180s，任一冷／热读2000次≤180s，进程RSS≤512MiB。
- **候选进入后续设计讨论的软验收标准（不是强行提高CI成功率的阈值）：** 按三组中位数，Pack advisory cold **P95不超过原版P95的1.20倍**、pack的`read_bytes`不超过原版的1.20倍，并且没有CPU/RSS或P99明显退化；如违反只能得`Rejected for cold IO`，即使先前CAS-A05容量优势已实测也不能冒称读性能最优。热缓存结果单独报告，不以热缓存快速抵消冷尾延迟。真I/O偏差/Runner平台影响只报告原始证据，不做不可靠线上加速推断。
- 达标但仅离线：**生产 AFTER=N/A**，不能接入现有`ContentBlob`、跨租户Owner、FileVersion、GC安全、故障后Index恢复、视频/Live的Seek、FUSE/CfAPI。短期请求的AbortSignal→Go`Context.Done()`已在其他 P053/P054等实测，此次不触碰耐久上传/下载/同步/删除的显式取消。

## 运行、归档与六平台

Linux `XD_CAS_A06_COLD_READ_100K_PERF=1 XD_CAS_A06_SAMPLE=sample-1 go test ./internal/storage -run '^TestCASA06Physical100KOriginalCASVersusOfflinePackAdvisoryColdReads$' -timeout=40m -count=1 -v`。分支[独立CI](../.github/workflows/cas-a06-real-100k-physical-cold-pack.yml)先真实1k/200次smoke，再3独立100k物理数据2000×Cold+Warm样本，保留每组完整机器JSON、Go stdout、`/usr/bin/time -v`、source SHA和summary。测试源码已保留原版CAS-A05的独立源hash、Pack读取校验，不修改其原始结果。

有效首轮结果后，归档原始11文件到 `docs/performance-evidence/cas-a06-physical-cold-pack/`，同一**唯一工作提交**更新本规范、中央台账、跨平台矩阵、Blob审查；修订过的准确HEAD再次独立三轮真实CI +完整CI`single-commit`/`final-gate`全绿才能Ready/Rebase合入。有效n3若环境不能提供kernel read_bytes，应记录Invalid/harness而非绕过判定。

**六平台真实应用：** 本场景只是Server Linux物理Local CAS与隔离Pack；Native Desktop Electron、Wide Web、Mobile Web、Desktop installed PWA、Android installed PWA、iOS installed PWA**全部Not measured**；真实100k JPEG/视频/Live缩略图及4GiB WAN用户上传下载也是独立历史负载，不能用此回答它们的场景延迟。


## CAS-A06 首轮真实100k冷／热读 n3 结果（2026-10-16 UTC / 2026-10-17 JST）

准确源码 `c0a0951d577676755f82196ea58ac1da02ac0c52` 的[专项原始CI #38932992440](https://github.com/lazyxu/xdrive/actions/runs/38932992440) SUCCESS：Go编译、1k实体smoke与独立3×100k不同SHA Local.Put真实原片（400? **确切 409,600,000 B分配**）、原字节一致的test-only Pack（107,204,608 B）均通过。对每个真实物理数据源逐一调用Linux `FADV_DONTNEED` (Baseline每2,000个独立原始FD，Pack单FD全包)，随后执行同样2,000次原片SHA+256B Range，**双方每轮真实Linux内核read_bytes>0**，再对相同2,000个访问直接执行热读。样本1/3 Baseline先、样本2 Pack先，未修改生产`Local.Open`。

| 真实原片源 | Local CAS Cold 2k wall | Pack Cold 2k wall | Local Cold P95/P99 | Pack Cold P95/P99 | Cold内核读取 (Local / Pack) | Local/Pack Warm wall | 进程峰RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sample-1 | 322.421 ms | 247.882 ms | 205/338 μs | 149/215 μs | 8,192,000/8,192,000 B | 61.187/17.015 ms | 34,428 KiB |
| sample-2 | 315.122 ms | 248.592 ms | 193/268 μs | 149/209 μs | 8,192,000/8,192,000 B | 63.948/17.068 ms | 38,060 KiB |
| sample-3 | 309.441 ms | 247.861 ms | 183/236 μs | 149/197 μs | 8,192,000/8,204,288 B | 60.375/16.860 ms | 34,244 KiB |
| **n3 P50/峰** | **315.122 ms** | **247.882 ms** | **193/268 μs** | **149/209 μs** | **8,192,000/8,192,000 B** | **61.187/17.015 ms** | **38,060 KiB** |

冷读总耗时降低 **21.34%**，单请求冷读P95降低 **22.80%**，P99降低 **22.01%**；实际内核磁盘读取B的n3中位数**相同**，不能声称磁盘I/O节省。热读总wall单独下降约72.19%，仅属于测试环境缓存行为。每组单独`/proc/self/io`的rchar/read_bytes、Linux Major/Minor faults、阶段user/system CPU和实际随机响应P50/P95/P99/Worst均在完整原始机器JSON及`time -v`中，**不是仅靠理论Block大小得出数据**。原版/候选完整SHA、2000个真Range和Linux进程资源/真实原片分配严格正确。

**离线判定：Accepted advisory-cold research candidate。** 冷P95 Pack149μs≤原版193μs×1.20、pack read_bytes中位等于原版，不见冷P99与进程RSS明显退化；但没有保证全部真实磁盘缓存被清空（POSIX_FADV仅建议），没有机械盘、对象Storage、用户Web/Desktop及真实WAN证据，不能推导线上性能。之前CAS-A05初始Pack节省73.826%容量只是另一项结果，不能将其+冷读直接当成生产上线理由。**生产 AFTER=N/A**。

**无效夹具来源仍保留：** 初次 `0cc9c5ea83396e6670946e93b21c410a1f891526` [CI #38932274121](https://github.com/lazyxu/xdrive/actions/runs/38932274121) 新Go测试未`gofmt`，实际真实原片n0；第二次 `ed417dcbd0e7d6eeae758768a2d14051d541d70e` [CI #38932483756](https://github.com/lazyxu/xdrive/actions/runs/38932483756) Go编译报`int64 * untyped float`，同样n0；只调整测试文件格式与等价整数比值比较、**不改冻结容量/冷读目标**。这些都是Invalid harness、不是生产性能RED。第三次 `c0a095...` 合法测试才属于valid n3。

**原始机器证据：** 11份不改写的原始 `sample-{1,2,3}.json/.log/.resources.txt`、`summary.json`、`source.txt` 以确定性tar.gz永久归档于 [CAS-A06证据目录](performance-evidence/cas-a06-physical-cold-pack/README.md)，SHA256 `4207d853cbed2f3c1311b08aee19be3ac2e3d332e72923fb6e237333982cfc47`，原GitHub artifact [#12059453194](https://github.com/lazyxu/xdrive/actions/runs/38932992440/artifacts/12059453194) ZIP SHA256 `1c414e5716a5dfab9df8cd7a7a01e56bee6867056d822e085ad19f372a96e861`。本证据修订HEAD在**再次进行三轮100k前**校验原始归档整体SHA、11个文件、4份Go源码确切SHA、样本P50；新HEAD完整CI`single-commit`/`final-gate`双绿后才Ready/Rebase合并。


### 2026-10-17 · 源准确证据HEAD归档校验异常（Invalid harness，非性能RED）

[专项 CI #38934142527](https://github.com/lazyxu/xdrive/actions/runs/38934142527) 在编译和100k物理测试前，原始归档的预登记 SHA256 不匹配而失败（有效新100k n=0）；完整CI #38934142327已成功，但不能据此合并。首轮 n3 原始CI #38932992440 数据未改变。针对同一Git Blob `54f63cc56c726f9a3804dd1f9230f7e6f605785b` 先单独打印仓库实际gzip SHA256并验11原始成员/源身份，若损坏必须恢复原始字节且重新严格pin SHA，不能放松质量门槛或用旧成功HEAD代替。诊断HEAD不是合并候选，产品不改。


**进一步确认 Invalid evidence archive（2026-10-17）：** Git blob `54f63c...`不是最初合法包：#38936913161中的实际SHA `84ace7a2a3fde658cfa95b83f701e47c7ccd9d1ee0bdae0dedeaec8aa4d15fd2`，gzip CRC mismatch，且未生成新性能样本。恢复为经过原Artifact逐一字节比对的11件确定性tar.gz（SHA256 `4207d853cbed2f3c1311b08aee19be3ac2e3d332e72923fb6e237333982cfc47`、真实Git Blob `cb7686e0d5bcc2eae53c2ccfdfbc63b355a4d63c`）。最终新HEAD必须同时通过严格原包源SHA/11成员检查、三组100k专项及完整CI，且仍是**仅离线Pack读取实验**，生产AFTER=N/A。
