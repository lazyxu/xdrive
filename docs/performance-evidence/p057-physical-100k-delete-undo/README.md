# P057 · 真实 100k SHA 不同 CAS · 带 Owner 授权的 FileOperation DELETE→Undo

> **2026-10-18 P057 current-master reconciliation (not a new speed result):** The immutable original 100k physically distinct SHA/Owner/Gin/PostgreSQL17/LocalCAS DELETE→Undo [n3 #39028684342](https://github.com/lazyxu/xdrive/actions/runs/39028684342) accepted genuine DELETE Worker P50 **1610.082ms**, Undo Worker **1459.302ms**, actual physical CAS 409604096B and every original SHA/Refcount preserved. Old [CI #39029596381](https://github.com/lazyxu/xdrive/actions/runs/39029596381) was RED only in a different existing API test due PostgreSQL pool exhaustion ([#1997](https://github.com/lazyxu/xdrive/issues/1997)); do not claim it tested P057 speed RED. Original historical immutable 14-file archive and all six Go benchmark source blobs remain unchanged; this one-work-commit latest-master reconciliation requires its **OWN NEW accurate-head 3×100k physical CI and complete Go/PG API, Windows/Web/Desktop, Rootless, artifacts and FinalGate** before ready/rebase. The six actual GUI/installed PWA modes remain Not measured. AFTER/speedup N/A, no changes to production or Race/durable cancellation.

### 首次真实物理100k有效原版 CURRENT n=3（2026-10-17）

**已通过准确测试源码** `22e0c8d1f5f6ecb4e4f6d8f6ac93f2c679e43ae6` 的 [P057真实专项CI #39028684342](https://github.com/lazyxu/xdrive/actions/runs/39028684342)，而非首次gofmt Invalid Head。每轮独立真实PostgreSQL17/Gin/Bearer/LocalCAS，实际生产 `store.Put` 落盘**100000个独立SHA不同原片+1受保护原片**，100001物理对象`st_blocks×512=409604096 B`。HTTP POST FileOperation DELETE→Worker进Trash→POST Undo→Undo Worker完整恢复，100000元数据身份与100001原片逐字节SHA核验成功，外部Node不变、所有CAS RefCount1、任何阶段磁盘实际分配字节不变，Go进程物理写入0B。1000烟测通过但不计n3。

| 原版真实物理工作项 | sample-1 | sample-2 | sample-3 | P50 |
| --- | ---: | ---: | ---: | ---: |
| DELETE HTTP 入队 ms | 124.736 | 125.329 | 125.814 | **125.329** |
| 100k DELETE Worker ms | 1635.070 | 1610.082 | 1604.429 | **1610.082** |
| Undo HTTP 入队 ms | 3.294 | 3.858 | 3.248 | **3.294** |
| 100k Undo Worker ms | 1435.244 | 1459.302 | 1462.495 | **1459.302** |
| 全量原始CAS物理读回校验 ms | 2888.657 | 2826.072 | 2902.347 | **2888.657** |
| 真实CAS+元数据种子 ms，**排除业务延迟** | 63198.789 | 60923.256 | 58521.425 | **60923.256** |
| Go 25ms采样RSS增长 B | 51392512 | 50491392 | 49348608 | **50491392** |
| Go内核write_bytes B | 0 | 0 | 0 | **0** |
| Go Process CPU ticks（两Worker阶段） | 212 | 212 | 217 | **212** |

**结论：原版 ACCEPTED CURRENT n=3/3，所有真实业务与安全预算内；生产代码未改，AFTER=N/A，speedup=N/A。** 无可用于同负载 BEFORE→AFTER 比值的数据。本次是Go Server层 HTTP→持久Worker的 **软删除/Undo**；不要和P047真实CAS永久unlink 155.241秒或P056 Copy Worker 277.678秒直接比较。Web/Desktop真实浏览器/Native Agent文件管理器实际点按、PWA设备真实安装态仍全部 **Not measured**。原始机器完整JSON、各sample日志/CPU/RSS/disk/source SHA均无损长期归档 [P057 原始 14 文件 tar.gz](performance-evidence/p057-physical-100k-delete-undo/ci-run-39028684342-original-full.tar.gz)：SHA256 **`de4c37dbafa10240a426d82e9435618e59414056dcb6d5b36d851a98015782ee`**，Git Blob **`93fbcedcfd2d26bea38389e0cb61d6480f9e67a9`**。源CI原ZIP SHA256 `5f7a0a4c8fc8885f69137bc47999fadf9c97927136eb61c75198fed146bdf8ba`，原始 [Actions Artifact #12099737025](https://github.com/lazyxu/xdrive/actions/runs/39028684342/artifacts/12099737025)。当前证据归档更新会改变Git HEAD；**新准确提交专项n3及全量CI/final-gate必须重新通过**后方能Ready/Rebase Merge。



**P057 首个源码头 Invalid harness（2026-10-17）：** [专项CI #39028464691](https://github.com/lazyxu/xdrive/actions/runs/39028464691) 在提交 `e44d7dcbcb99cd5af12e898342da9e803cae4fbb` 上因唯一新增的 Go 测试文件 `map[string]any` 对齐差异被 `gofmt -l` 门禁拒绝。真实PG17 1k smoke、100k物理原片种子和所有HTTP/Worker性能测量均未执行；**有效n=0、不是生产软件性能RED**。已按该CI打印的25行精确 `gofmt -d` 修复，性能阈值、生产源码和数据模型全部未变；准确新HEAD必须先完整通过smoke，再独立n=3真实100k测试，并保留原失败证据。

**状态：候选原版（valid n=0）。** 新负载 P057 与 P056/047/055 不重复。合入前需在准确HEAD上先做1000个物理原片Smoke，再三份独立100,000个 LocalCAS 原片新种子各跑一次，冻结三轮原始数字（含 full SHA/Range、RSS、CPU、st_blocks/write_bytes、SQL与HTTP状态）。首次机器原始文件与最终HEAD原始文件必须永久归档至此目录，更新SHA256SUMS，并重新运行准确最终HEAD的专项CI及完整仓库CI/FinalGate。**不得把P056真实100k Copy/Undo或P055 100k Trash HTTP Restore旧数值复用为P057 CURRENT。**

原生产实现新路径：Owner 授权 `POST /api/v1/file-operations` 提交根目录 `delete`，生产持久Worker `processNextFileOperation` 完成真实CAS原片的**软删除进Trash**，其 `ContentBlob.RefCount` 继续保持1；同一Owner通过 `POST /api/v1/file-operations/:id/undo` 排入新的持久Undo Worker，恢复100k子树而不重新下载/写入、GC或复制原片。不同Owner GET Job必须404、另一个未选中原片始终保留；原片与Protected CAS全数真实 `store.Open` 逐字节SHA验证，物理inode/已分配字节各阶段不变。不做用户Owned传输的视图驱动取消，也不触碰Race代码。

真实原片种子：100,000个独立Node+File/ContentBlob每个大小1024B，有唯一SHA256，生产Local.Put实体写入；另一个不同SHA/Owner之外的未选中保护哨兵（同Owner不同目录），应总100001实体CAS inode、Linux实际已分配块≥(100001 ×4096B)，另一个Owner的读取不可越权。每个样本的SHA `aggregate` 均不同；1000只是 Smoke，不是100k。

原版CURRENT冻结：DELETE HTTP enqueue ≤30s，DELETE Worker ≤900s，Undo HTTP enqueue ≤30s，Undo Worker ≤900s；两个Worker期间采样Go RSS增长≤512MiB、`/proc/self/io`物理写入≤512MiB、CPU tick非负，100k所有源文件真实逐字节与SHA完全相同，原片实体CAS分配及RefCount =1，未选中的Node未改。若接受原版CURRENT，则生产代码不修改、AFTER=N/A、speedup=N/A。原版若真实性能RED先判环境/夹具有效性，再做同runner matched n≥3 BEFORE/AFTER，仅实证显著提升才保留。

测试范围仅原始**Go API / Gin / PostgreSQL 17 / LocalCAS / 持久队列Worker**，**并非**Desktop Electron GUI、Wide/Mobile Web GUI、三个已安装PWA真机的端到端100k性能，也不是永久删除/物理GC/请求级取消。上述六平台新场景在[矩阵](../../performance-platform-coverage.md)均 **Not measured**。
