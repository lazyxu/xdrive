# P057 · 真实 100k 物理 CAS 原片的 FileOperation DELETE→Undo 性能契约

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



## 与已测试负载的明确差异

先查 [统一测试登记簿](performance-test-registry.md)、[六平台矩阵](performance-platform-coverage.md)、[Blob/CAS审计](blob-cas-dedup-architecture-audit.md)、[P047永久删除](file-explorer-performance.md)、[P055物理Restore](performance-evidence/p055-real-100k-physical-restore/README.md)及[P056物理Copy/Undo](performance-evidence/p056-real-100k-physical-copy-undo/README.md)。P057 **新增**：“100k个内容互不相同且真实落盘的CAS”×“Owner HTTP提交FileOperation delete/undo持久队列”×“同一物理字节在Trash/Undo全过程不变”联合合同。此前`file_operation_queued_delete_100k_performance_integration_test.go`是100k**模拟StorageKey元数据**；P055是直接 `POST /trash/id/restore`，P056是Copy→Undo（Undo复制反而应保留Trash对Blob的引用），P047是授权**永久**删除和真实 unlink。不能把某一项目成功当成本项目的原版测量。

每个独立样本源码不变的Server/Gin/PG17/LocalCAS和FileOperation生产Worker、真实1KiB×100k不同SHA SHA-256原片 + 1个额外受保护真实CAS，原片实际inode/st_blocks、原始全SHA和100k File/ContentBlob RefCount1；使用HTTP Bearer和非Owner 404认证，DELETE排队完成/元数据软删除(100k deleted_at)、Redo/Undo持久任务恢复100k (revision+2)；**无任何文件原片物理CAS重写**，完整遍历100001实际原片读回逐字节校验。

## 测量门槛（首次测量前冻结）

| 项目 | 既有独立业务样本（仅背景，不能直接比较） | P057 原版 CURRENT 接受门槛 |
| --- | --- | --- |
| 物理真实性 | P047/P055/P056 已有不同形状的真物理100k CAS | 100000 个互不相同SHA，100001个真实inode，4KiB真实allocated每对象 |
| HTTP Bearer FileOperation DELETE enqueue | 已有模拟Key队列删除100k，不是100k物理CAS HTTP | **≤30s**，HTTP202返回Queued且Owner隔离 |
| 持久Worker DELETE（软删除） | P047 **永久** CAS删除P50 155.241s，与软删不等价 | **≤900s**、删除100k元数据全部正确、Blob物理不变 |
| HTTP Undo enqueue | P056是Copy Undo，不是Delete Undo | **≤30s**、HTTP202 |
| 持久Worker Undo | P055恢复HTTP而非Worker | **≤900s**、全部100k子节点恢复及真实原片完全正确 |
| Go资源和磁盘写入 | P056曾在100k Copy暴露PG锁耗尽/Undo 65535占位上限，现已修复 | 25ms增量RSS≤512MiB，Go进程物理write_bytes≤512MiB，CPU tick>=0、CAS st_blocks前后**不变** |

**执行规则**：先验证 opt-out 编译与source gofmt、1k smoke，再三份独立真实100k高唯一源样本，取P50/最慢、每段耗时/CPU/RSS/st_blocks/写入和SHA校验结果。完整 [CI workflow](../.github/workflows/p057-real-100k-physical-cas-delete-undo.yml)分支限定，真实数值/4份原始日志与本合同一并归档在 [P057永久证据](performance-evidence/p057-physical-100k-delete-undo/README.md)。未产生有效三样本前状态 **Not measured**，不能凭推断宣称优化或生产RED。任一失败必须分类为Invalid environment/harness、real product RED或待定位，不能把Go fake/mocked metadata当真实落盘成功。

原版全部达标=生产保持不变，AFTER=N/A；真正超预算需比较同平台/相同数据/相同版本+防回归n3，只有重复且显著提速、资源不退化才保留。用户Own的长期delete/restore/transfer/sync不因窗口跳转自动取消，只有虚拟列表/缩略图短请求允许Go `ctx.cancel`。**本PR不实现实际浏览器GUI验收**，Desktop / Web / Mobile Web / Desktop installed PWA / Android installed PWA / iOS installed PWA 六端必须在矩阵明确 Not measured。真实GUI后续独立用真实 Server+CAS fixture 做 E2E，不能用这里的 Go Worker 时延推导UI时延。
