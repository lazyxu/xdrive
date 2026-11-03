# Windows 同步活动、通知与历史记录设计（2026-11-03）

状态：设计定稿，分阶段实施。适用范围：xDrive Windows Desktop + 本机 xdrive-agent 的 Mount 同步；复用既有 Source Run / Transfer / Task Center，不改 Server 备份协议。本文中“目标”不代表已经实现。

## 1. 问题与现状（master 基线）

- `desktop/src/main/index.cts::notifyAgentTransition` 将 `正在同步 → 同步正常` 转换为“同步已完成。”，没有关联 run ID，也没有统计。
- `showDesktopNotification(..., 'transfers')` 仅向 Renderer 发旧的字符串导航，`desktop/src/renderer/App.tsx` 的 `transfers` 跳转只打开传输浮层，无法定位本次同步。
- `internal/mount/events.go` 目前只有 sync started/completed/failed/conflict 等状态，无批次编号或文件级结果。状态转换不能推出上传/下载/移动/删除数量，更不能证明全部变更已提交。
- `cmd/xdrive-agent/transfer_history_storage.go` 已对本机按 Server+Username 隔离，原子保存结束态传输（JSON v1，最多 10,000 条，64 MiB 文件限制）；传输历史不是完整的同步历史，原记录需保持兼容。
- `internal/meta/external_sources.go` / Source Details 已有服务端 Source Run、失败和跳过快照；不要再复制一份到 Desktop 本机数据库。
- 任务中心具有“本机任务”“同步文件夹”“文件操作”等分区；目标是一个统一入口，不是新建重复的顶级通知中心。

## 2. 产品原则与范围

1. **通知=摘要；批次=事实；明细=证据。** 点击一次通知必须精确定位其代表的运行记录，若过期/账号不符则明确说明。
2. **区分扫描、变更和传输。** 记录 scanned、created、updated、moved、renamed、deleted、skipped、failed、conflicted、uploaded、downloaded 和实际传输 bytes。未知字段显示“未提供”，不得显示为 0。
3. “同步正常”仅代表 Agent 的汇总状态，不能单独写入一条“有 N 个文件成功”的历史。
4. 既有 Server Source Run 和本机 Transfer 原始证据不迁移；统一展示时引用来源 `engine` + `source_id` + `run_id`，不伪造其缺失的文件结果。
5. 正常扫描无变化默认不触发 Windows 系统通知，但在同步活动中保留有界的检查历史；失败、冲突和部分完成必须显式提醒。
6. Windows Desktop/DSM 保持 canonical `XDriveApp`/MUI 交互；本机同步历史仅 Windows 本机 Agent 读写，DSM 只呈现权限允许的数据。
7. 本次不做跨设备集中审计，不改变同步引擎的冲突解决、上传提交、文件版本或重试语义。

## 3. 交互设计

### 3.1 通知

成功且有变更：`xDrive · 文件同步完成`；正文如 `新增 12 · 更新 5 · 下载 3 · 实际传输 1.2 GiB`。仅列已真实确认的项目；方向和动作不能直接相加后当作唯一文件总数。

失败/冲突：`xDrive · 同步需要处理`，正文包含明确的失败/冲突数量以及“查看本次同步”；没有可靠数量时使用 `本次同步有未解决的问题`，不使用虚构的零。

无变更：只更新托盘状态与活动历史；仅在用户主动请求扫描报告时显示摘要。

通知点击内容为有类型的 `DesktopNavigationIntent`：`{ target:'sync-run', scope:'mount'|'source', runID, sourceID?, accountEpoch? }`。不要把任意 OS 通知内容当成任意 URI/文件路径；Desktop 主进程发给 Renderer 的只应是类型化、经过身份和参数校验的意图。保留旧字符串导航兼容其他托盘入口。

### 3.2 同步中心

复用“任务”入口，添加“同步活动”：`当前状态 | 历史记录 | 需要处理`，并支持来源、状态、时间、变更类型筛选。列表一次不超过 50 条，游标分页。历史按最近时间降序；失败优先在“需要处理”页展示，不重复创建任务数据。

批次详情至少展示开始/完成时间、来源/目标、触发方式、总状态、各分类计数、实际传输流量、同步文件列表。文件明细包括操作、方向、当时路径（移动同时显示 old/new path）、结果及失败原因。对于无法从旧版历史恢复的明细展示“此历史版本未记录逐项结果”，绝不显示“没有变化”。

`打开文件`/`打开位置` 必须由 Agent 用持有的 Owner 身份和可信项目 ID/原始任务 ID 验证并执行；过期/文件删除/路径不存在时给出具体反馈。重试创建新的 attempt，与原记录通过 `retry_of` 关联，不篡改已完成的历史。

### 3.3 导航与生命周期

- 从通知进入时先恢复/显示窗口，再等待 Renderer ready，派发一次不可丢失的意图；若当前账号与通知创建时的账号不符，显示“这条通知属于其他账号”，禁止进入其他账号历史。
- Renderer 导航到任务中心并选中 `run_id`，不能只是打开“传输”浮层。浮层可提供“查看完整历史”入口。
- 通知重复点击、Electron 多次重建、过期意图均应幂等；旧的 `'transfers'` / `'sources'` / `'settings-update'` 字符串行为保持兼容。

## 4. 权威数据与状态机

### 4.1 批次

`SyncRun`: `run_id UUID`、`engine_kind`、`account_scope`、`device_id`、`source_id?`、`trigger`、`started_at`、`finished_at?`、`status`、`outcome`、`detail_complete`、`schema_version`，及分类统计。

状态：`running → completed | partial | failed | cancelled | interrupted`。已终结状态不可退回 running。Agent 崩溃/主动中止后无法证明成功的批次必须标记 `interrupted`，随后恢复/重试开启新 attempt。终态持久化在发通知之前完成；写盘失败时通知不得声称可查看完整历史。

无变化不是 error 或空记录，应表示 `status=completed, outcome=no_change`；用户取消或扫描部分未知时不称“无变化”。

### 4.2 文件变更事件

`SyncItem`: `run_id`、`item_id`（稳定且幂等）、`operation_id`、`action`（create/update/delete/move/rename/skip/conflict）、`direction`（upload/download/local/none）、`old_path?`、`new_path?`、`bytes_logical?`、`bytes_transferred?`、`status`、`error_code?`、`error_message?`、`transfer_id?`、`committed_at?`、`retry_of?`。

只在真实文件/元数据变更 commit 或明确失败/跳过时形成最终项；开始、进度和完成事件可以多次重放，不得造成重复计数。扫描“未变化”默认只计数，不保存海量明细。对未知操作类型采用“不支持的变更”而非错误地记成上传成功。

`SyncRun` 及项目快照不可通过事后扫描目录推导：目录当前内容与某次历史操作不同。

### 4.3 非等价操作

- `created/updated/moved/deleted` 是**结果分类**；`uploaded/downloaded` 是**传输方向**，两者可重叠。
- `bytes_logical` 是被处理文件的逻辑大小；`bytes_transferred` 是传输层真实报告的网络字节，不能用扫描总大小替代。
- 接口为不支持的数值返回 `null` 或不提供字段，不要把零当作“未采集”。
- Source Run 采用已有 Server summary/failure/skip 作为事实来源；当前缺少成功逐项明细时显式标为 `detail_complete=false`。

## 5. 存储、API、迁移与保留

最终采用 **Windows Agent 本机 SQLite（WAL + 索引 + 批量事务）** 持久化 Mount `sync_runs` 和 `sync_items`。每个 Server+Owner 有独立身份作用域，持久化记录必须绑定已登录身份，客户端 Renderer 不得直接访问数据库文件。避免引入新的服务端双写。

建议查询 API（经现有 127.0.0.1 Agent IPC 转发）：

- `GET /v1/sync/runs?cursor=&limit=50&status=&source_id=`
- `GET /v1/sync/runs/{run_id}`
- `GET /v1/sync/runs/{run_id}/items?cursor=&limit=50&action=&status=`

这些是**目标契约**，尚非已存在的端点。Agent 必须验证当前 Owner，并按稳定键排序分页；请求取消立即释放资源。只返回当前身份记录，拒绝伪造 `account_scope`。

建议默认：摘要 180 天、文件明细 30 天、失败/冲突明细 90 天；摘要最多 5,000 条、明细最多 200,000 条、数据库目标 256 MiB，优先清理过期成功明细。上述均为**建议值**，容量上限不是允许破坏正在执行的批次或丢弃尚未处理的错误。UI 显示 `details_expired`/明细未采集，不误判为零变化；支持清空当前身份的非活动历史。错误代码保留，消息应限制长度并隐藏凭据/token。

既有 `transfer-history-v1-*.json` 原样保留并继续读取，先通过引用 `transfer_id` 建立关联，不做未经验证的历史归属回填。服务端 `xd_sync_runs` 不迁移。SQLite 依赖、写入锁、schema migration 和 Windows installer 回滚须单独验证后交付，不允许只定义表就宣称已实现完整历史。

## 6. 交付切片（当前 PR 与后续）

- **P0：导航与可信事实**：修复 `transfers` 通知点击仅打开浮层的缺陷；为已存在的 Source Run 采用含 `sourceID+runID` 的定向跳转；Mount 状态缺少真实变更数量时不得冒称“已同步 N 个文件”。通知可明确提示“已完成检查；点击查看现有任务记录（可能不含逐项明细）”。
- **P1：Mount 本机同步流水**：在同步执行点引入稳定 run/item ID，正确处理扫描、提交、删除、冲突、重试；新增 WAL 持久化、Agent API 和历史列表/详情；只有本阶段验收后才能显示完整的 Mount “本次同步明细”。
- **P2：统一检索/筛选/导出/失败重试/文件定位**。
- **P3：跨设备历史与集中审计，在明确 Owner 访问边界之后单独设计。**

每一切片独立 PR 验证；不能把 P0 的导航/通知测试当成 SQLite/P1 已完成。

## 7. 验收清单

1. mount/no-change：状态正常但无文件变化时不误报实际传输；旧 Engine 无明细时显示未知。
2. mount/change：真实上传/下载、重命名、移动、删除、零字节文件产生准确分类；数量和方向不可误加。
3. fail/partial/conflict：错误保持、前后状态明确，重试产生关联新记录；无误报全部成功。
4. source：点击 Windows Source Run 通知定位具体 source/run，含失败与跳过快照，未收录成功项时明确告知。
5. restart：Electron / Agent 重启后可正确读取历史或显示记录过期；旧版本 JSON 与新版本并存，迁移与故障回滚安全。
6. identity：退出、切换 Server/Owner、注销，旧账号通知/请求不得读取新账号不属于自己的历史。
7. notification：Windows 通知中心旧通知、最小化/托盘、Renderer 未就绪、连续点击、陈旧导航意图都可控。
8. scalability：10 万+ 项采用真实分页、取消、受限空间与可测吞吐；禁止一次向 Electron 发送全量历史。
9. CI：更新单元、集成和 Windows 打包验证；以准确 HEAD 的 required checks/Final Gate 为准。物理 Windows 系统通知体验必须标注“跳过（未验收）”直至真机验证。
