# OBS-P001 · 全局存储读写性能观测 v1.0（2026-10-17）

## 进度与目标

**状态：新增非侵入式管理员性能看板的候选实现；源准确CI及实机开销测量前不得写成已验收/已提速。** 唯一入口仍是 [性能测试登记簿](performance-test-registry.md)、[六平台矩阵](performance-platform-coverage.md)及[Blob/CAS审计](blob-cas-dedup-architecture-audit.md)。已有真物理100k和4GiB证据不重复测，场景OBS-P001是**运维观测**而非再测图库/FileExplorer渲染与全大文件性能。

已有生产事实：`serverObservability.observeRequest` 在所有Gin请求结束时已经记录**路由模板、HTTP状态、请求计数和总wall秒数**（同时导出 /metrics）；`storageSampleInterval=24h` 的Server后台维护任务自动保留CAS大小、对象、GC和容量快照180天。`GET /api/v1/admin/storage` 只读最新持久快照并读磁盘容量，而不会因为管理员打开页面重新全盘扫描。无需为了展示平均请求耗时重新注入每次请求的计时器/锁/IO。

本次最小交付方案：从**现有** `httpRequests` 聚合中的固定允许类别生成匿名性能行，增加到同一个**仅管理员**`/api/v1/admin/storage` JSON响应里的 `performance` 字段。Web和Desktop使用相同 `ui/shared` 页面与现有StorageStats模型，原`刷新`操作即手动重新读取，**不新增每秒轮询/后台额外全盘枚举**。与每天自动持久化的**容量/GC**快照并排显示，明确操作延迟尚无每日落库数据；不从Server重启前补造或拼接数据。


## OBS-P001 首轮真实专用 CI 结果（2026-10-17）

[源准确CI #39009569013](https://github.com/lazyxu/xdrive/actions/runs/39009569013) 确认原 ​`observeRequest` 热路径**未经本 PR 修改**，n=3性能基准 43.28/43.61/42.67 ns/op，P50 **43.28ns/op、0B/op、0 allocs/op**；新增管理员只读固定9类汇总 n3 为211.0/216.8/213.7 ns/op，P50 **213.7ns/op、464B/op、2 allocs/op**。使用 Go1.25.14 Linux 真实内部方法，不是实际浏览器UI、已安装PWA、100k真实物理CAS数据或4GiB端到端网络传输。单次新增汇总通过冻结预算≤2ms/op、≤64KiB/op，但两种操作不可作为配对HTTP BEFORE/AFTER 提速。新的只读管理员能力 BEFORE=N/A、AFTER=测得候选汇总耗时；用户HTTP延迟本次不做误导性提速声称。

完整原始四文件机器归档、精确测量源码及 SHA256 见 [OBS-P001永久原始证据](performance-evidence/obs-p001-global-storage/README.md)，原始 [Actions artifact #12092306378](https://github.com/lazyxu/xdrive/actions/runs/39009569013/artifacts/12092306378) 亦可核查。Git仓库证据提交形成新的 HEAD，仍需要准确最终HEAD重新跑n3及完整CI/final-gate。

## 观测指标和固定边界

| key | 请求路线类别（固定模板，非请求实际URL） | 含义限制 |
| --- | --- | --- |
| files_list | GET nodes/:id/children、children/position | 列表和定位请求，非完整可见像素渲染 |
| gallery_list | GET media/items、media/facets、media/places/viewport | 图库索引请求，非视频解码 |
| preview | GET media/items/:id/thumbnail、file-preview/:id | 包含合法404冷缓存，不代表所有缩略图已生成 |
| download | GET files/:id/content、file-download、file-version-download、archive-download等 | 可能包含客户端下载/流式传送等待 |
| upload_chunk | PUT uploads/:id/chunks/:index | 不代表完整Task Center上传任务 |
| upload_finalize | POST uploads/:id/finalize | 包含原文件哈希/提交，非流式全部传输 |
| operation_enqueue | POST file-operations | 排队入库时延，**不是**Copy/Undo/Delete Worker执行时间 |
| delete_request | DELETE nodes/:id、trash/:id 与 POST nodes/batch/delete | 仅HTTP请求，后台持久执行另列 |
| changefeed | GET changes | 请求式同步变更分页，不是源Pull/Push总吞吐 |

每行只包含 `requests`、`server_errors`（HTTP >=500）和`average_ms`（已记录总秒数/请求数）。操作未采样时显示“—”，不得用0ms伪造速度；403/404/499/429是其他状态，不能直接定性为服务器故障。全局性能窗口有 `started_at` 和 `captured_at`，明确**仅当前Server进程内存累计**，进程重启归零、多个Server副本不合并，过往/区间p95/99、网络真实传输字节、CPU/RSS、磁盘写入、慢URL、用户或文件级瓶颈均**不能**从这组现有累加器推算。不要向客户端返回任何文件路径、Node ID、账户、URL、SHA、IP或每请求详情；不提供普通用户接口。

固定路由白名单由服务端控制，生成表最多9行；后台存储采样、文件上传下载、图库缩略图和虚拟列表滚动的热路径原逻辑**字节级未修改**（仍只有既有observeRequest调用）。新read-only聚合仅在管理员请求全局存储时获取现有互斥锁读取计数。不得注入同步SQL、目录Walk、文件Hash、定时每秒扫描、独立worker或新跨进程锁。对高频数据应优先复用Prometheus/OTel既有聚合导出能力而非给每个文件记录一条事件。

## 验收门槛与性能数据口径

- **CURRENT基线：** 生产现有observer在HTTP热路径已经累计`httpRequests`；本次不更改其请求时序/计数代码，因此不存在可比较的“线上请求 AFTER 提速”。`OBS-P001`专用管理员页面聚合读取操作为新增能力，其部署前有效延迟`N/A`。预期最多9行，不做100k数据库或物理扫描。
- **代码测试：** 固定白名单、有界行数、10ms/30ms两次均值20ms与5xx归类、合法缩略图404不误标故障、未知路径/用户身份不反射到JSON、空观测值正确；`BenchmarkStoragePerformanceReadOnlySnapshot`记录单次进程内快照耗时与分配，并在CI提供数字。基准应至少有三次本地/CI可比有效样本；没有数值以前`BEFORE=N/A AFTER=Not measured`，不得写“零开销/提升N%”。结构上只有**零新增每请求探针**，并不意味着已有obs完全无成本。
- **端到端：** PostgreSQL17/Gin管理员与普通用户边界不变，只有`admin/storage`返回新增字段；`me/storage`绝不带全局性能；刷新才显示新的进程计数，Server重启后读数从零开始；Web/Desktop共享UI组件且Mobile Web/PWA的全局页面按权限显示，不能因为共享源码宣称已在六个平台实测。
- **维护：** 老HTTP平均受大文件流式连接寿命影响，不代表CPU慢。需要真正p95/窗口吞吐量时，再单独在**固定允许类别**上评估常数大小Histogram/环形桶和每天入库汇总，先同Runner BEFORE/AFTER测量新增CPU/RSS/互斥锁争用。每日用户业务操作不应产生每日100k/4GiB破坏性测压；完整性校验等长任务继续交给Task Center。
- **PR**：必须与`AGENTS.md`、登记簿、全局存储规范、UI与Go测试处于唯一工作提交；准确最终HEAD完整CI/FinalGate与测试通过后才Ready/Rebase合并，失败保留证据、不动Race/持久任务生命周期。

## 已有 vs 后续

当前已经有**每日容量/GC持久化快照**、上传staging/孤儿明细、Blob物理/逻辑去重倍率和Prometheus指标。新面板只解决“管理员不接Prometheus也能看到运行中Server哪些请求类别积累延迟/5xx”的第一层可观察性。

下一阶段（没有生产测量前为**Not measured**）：1-5分钟固定桶p95/p99、请求/上传下载字节、客户端首屏真实像素、后台Job用时、CAS GC实际unlink时延、慢盘CPU/iowait及新旧磁盘写入放大；手动可开启的**有预算、不删除真实数据**的短时主动诊断；每日只落已聚合指标且含Server实例/重启序号，不全量文件扫描。对照[restic](https://github.com/restic/restic)和[Kopia](https://kopia.io/docs/advanced/architecture/)分离内容存储与快照的经验，但不要把备份指标误认为交互延迟证明。
