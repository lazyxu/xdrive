# Sidebar 管理员功能等价：Web / Desktop

> 2026-10-12 · 用户已明确要求全功能等价，不允许把 Desktop 管理功能缺失作为平台差异。

| 管理入口 | Web 当前能力 | Desktop 之前 | 工作阶段 |
| --- | --- | --- | --- |
| 用户管理 | 列表、创建、角色、启停、配额、重置密码、撤销会话、删除 | 原无页面、无 Agent IPC | **C1：PR #1506 已合入，准确头 final-gate 通过** |
| 全局后台任务 | 多用户和系统后台任务控制 | 与 Web 共用共享 Task Center 和 Server 后台任务卡片 | **C4：PR #1518 已合入，准确头 CI / final-gate 通过** |
| 审计日志 | 过滤、分页虚拟列表、快照、详情 | 原无入口与读取接口 | **C2：#1510 已合入，同一 MUI 页/快照查询，准确头 CI 与 final-gate 通过** |
| 全局存储 | 全局空间、健康、历史、诊断、清理、任务 | 原无管理员页面 | **C3：PR #1514 已合入，完整 CI 与 final-gate 通过** |
| 系统依赖 | 服务概览、配置、验证、历史 | 已等价 | 保持 |
| 系统维护 | 服务端更新及进度 | 已等价 | 保持 |

C1 应迁移完整原 Web 用户管理 MUI UI 到 `ui/shared/src/mui`，Web 保留兼容模块。Desktop 通过同一页面的强类型 Port 和 Agent IPC 调用相同 Server `/api/v1/admin/users` 管理接口；服务端独立执行管理员鉴权、防止修改/删除自己和移除最后一名管理员的约束、密码重置后的会话撤销。不能直接在 Desktop Renderer 携带 bearer Token 或增加自由路径转发器。

验收区分：C1/C2/C3 各自 **代码已提交、CI 通过、已合入**；仅有 C1/C2 不得宣称全部 Sidebar 管理功能已等价。C3、C4 均已合入并通过准确头完整 CI；可恢复按 `AGENTS.md` 与 [`docs/performance-test-registry.md`](performance-test-registry.md) 去重的性能主线。实体 Windows Desktop、iOS/Android 设备手工验收仍独立于 CI，不能冒充已完成。

## C2 · 审计日志 Web/Desktop 全功能等价（2026-10-12）

- **本次范围：** 原 Web 审计完整 MUI 页面迁至 `ui/shared`；Web 仅保留兼容导出，Desktop 显示同一个筛选、固定快照、分页虚拟列表、详情对话框。Sidebar 放在「全局后台任务」后。
- **安全和请求所有权：** 只开放一个强类型、严格输入校验的 `admin-audit/range` Agent 读取接口；Desktop Main 限制页长 1–200、offset、快照及筛选，并复用 sender-scoped AbortSignal / `viewportRequests`；Agent 限制管理员会话，Server `requireAdmin` 再认证并把 HTTP context 交给 GORM。旧 Agent 显示明确不可用，不导出 Renderer bearer Token、不使用任意 URL 代理、不修改数据。
- **状态：** C2 已以单工作提交合入 #1510，准确头完整 GitHub CI/final-gate 通过；真实 Windows 桌面设备上的手工验收与 CI 区分。C3 全局存储已合入，C4 任务视觉统一仍待完成。

## C3 · 全局存储 Web/Desktop 完整能力对齐（2026-10-12）

- **Status: C3 PR #1514 merged, exact-head CI #38221915234/final-gate passed.** Web原有存储统计、健康、历史、异常、CAS诊断、staging及缓存清理、全局任务入口移至同一个 `ui/shared/src/mui/GlobalStorageStatsPage.tsx`；Desktop 复用页面与 MUI，Web 保留兼容导出。Desktop 管理员 Sidebar 新增「全局存储」。
- Renderer 仅提交固定操作枚举，Main与Go Agent校验页长、游标、窗口、清理类型和管理员身份，Go Client 内部 `switch` 固定匹配既有Server `/api/v1/admin/storage/*`，**无任意路径/URL**。Server 独立 `requireAdmin`。两项清理沿用真实用户确认，未添加后台一扫描替代。
- 服务端存储检查/修复使用现有全局后台任务 `system-maintenance:storage_verify|storage_repair` 并显式进入全局后台任务界面，不应在页面销毁时取消持久任务。
- 验收区分代码完成/Go与Node测试通过/PR最终准确头CI绿色/合入/实体Desktop验收。C3、C4 代码与准确头 CI 均已合入/通过；性能专项不再因 Sidebar C4 代码阻塞。

## C4 · 个人任务与全局后台任务同形态展示（2026-10-12）

- **目标：** 当前用户任务与管理员全局后台任务保持严格不同的业务权限/所有权，但同一 Server 后台任务的卡片、状态、百分比、时间和操作按钮采用相同共享 MUI 子组件。管理员额外展示所有者，并可选宽屏表格密集查看。
- **范围：** 仅更新共享 `TaskCenterPage`、`BackgroundTaskCenter` 和自动化回归，不更改任务执行/`control_actions`、轮询间隔、持久上传下载或窗口退出取消逻辑。
- **状态：** [PR #1518](https://github.com/lazyxu/xdrive/pull/1518) 2026-10-12 已合入；单工作提交 `86dfbc648aba0a236b413c11c9cb1e4f05860148`，准确头完整 [GitHub CI #38223643407](https://github.com/lazyxu/xdrive/actions/runs/38223643407) **success（包含 final-gate）**。生产任务控制/Server 权限契约未变。真机 Web/Desktop/Mobile Web 手工验收另计，不能把CI等同于实体设备测试。

## C4 合入后：为什么两个任务入口的内容仍有差别

- **相同 Server 后台任务必须相同 UI**：个人「任务」中的来源同步/后台处理与管理员「全局后台任务」的同类 Server 记录都由共享 `XDriveBackgroundTaskList → BackgroundTaskItem` 绘制；默认是同一 MUI 卡片、进度、状态、耗时及服务端允许的操作。全局多显示所属用户/系统，管理员宽屏可主动切换密集表格（默认仍为卡片；窄屏退回卡片）。
- **任务类型/权限边界不能强行同化**：个人「任务」额外展示 `FileOperationCenter`（复制/移动/删除、Undo/Redo、冲突处理）、可选媒体任务与 Desktop 本机缓存工作；这些既不是跨用户管理员任务，也不具有全局管理权限。上传/下载即时网速和传输历史主要在右上角传输浮层。个人分区更多并不说明同类后台任务卡片不同。
- **已核对源代码**：Web `web/src/App.tsx` 和 Desktop `desktop/src/renderer/App.tsx` 均按「用户管理 → 全局后台任务 → 审计日志 → 全局存储 → 系统依赖 → 系统维护」排列管理员菜单，任务页均挂载共享 `XDriveTaskCenterPage`，所用卡片来自 `ui/shared/src/mui/BackgroundTaskCenter.tsx`。管理员身份仍由 Server `requireAdmin` 独立校验。现有 `desktop/tests/sidebar-background-task-presentation-parity.cjs` 和 `task-transfer-navigation.cjs` 已随 C4 准确头 CI 通过。
- **仍需实机检查**：按同一有权限的 Server 任务 ID 对照 Web 与 Desktop、宽/窄移动布局的状态/按钮/焦点；旧 Agent 缺能力时必须明确提示不可用，不得伪装成功。未经实际设备运行不能宣称真实视觉 1:1 已验证。

## C5 · Task Center 页面与卡片视觉统一（2026-10-12）

- **状态：** C5 改造复用 #1541 的现有单提交工作分支；需以最终源码准确头 CI/final-gate 判断是否可合入。原 C1–C4 已合入且 C4 完整 CI #38223643407 成功，不重新实现 Server 后台任务业务。
- **相同框架：** `XDriveTaskCenterPage` 为个人和管理员页面统一提供「任务查看范围」导航、作用域说明及 `XDriveTaskCenterSection` 分区。个人 FileOperation、本机传输及 Server 后台任务共用 `XDriveTaskCardSurface` 边框/背景/焦点视觉；媒体批量任务保持原来的独立控制、轮询和呈现组件，在同一个个人任务页内。已加载数量只是已分页返回记录数，不能称全部任务总数。
- **管理员导航可真正切换：** 「我的任务 / 全局后台任务」由 Web `tasks?scope=mine|global` 与 Desktop `transfers|global-tasks` 的现有 workspace 路由驱动；不是仅切换前端标签并复用错误查询。普通用户无全局入口；`requireAdmin` 及任务控制 `control_actions` 沿用原服务端权限。
- **不可用不伪装：** 工作区是否为全局由已授权的管理员角色与当前路由确定，独立的 `globalTasksAvailable` 判断 Agent/Server 查询能力。旧 Agent 若无能力，明确显示不可用提示；绝不回退展示个人任务、也不把缺数据伪装为“全局 0 项”。
- **窄屏触达：** 查看范围切换最小 44px；管理员密集表格切换仅宽屏展示，移动端继续使用卡片。个人文件撤销/重做/冲突、本机缓存工作仅个人页；全局仅 Server 多用户及系统任务，不把右上角上传/下载传输浮层合并进全局。
- **不触碰持久执行：** 任务状态、授权、分页、轮询、下载/上传、同步、取消语义及各平台 Server/Agent 传输边界不变，窗口/任务页切换不取消持久任务。自动测试仅证明组件与行为契约；物理 Web/Desktop/iOS/Android 的像素及可达性验收单独记录。

- **C5 初轮 CI 归因（2026-10-12）：** [#38238014658](https://github.com/lazyxu/xdrive/actions/runs/38238014658) 的 Web/Desktop Linux/Desktop Windows 构建已通过；`desktop-tests` 两个媒体任务夹具在加载阶段因未 mock 新引入的 `./TaskPresentation` 等纯展示依赖而失败（测试入口未运行到产品断言）。仅给既有测试装配等价的 Card/Button/Badge 简单 DOM shim，保留原 Cancel/Retry/账号隔离断言。首轮红 CI 不用于证明 C5 已验收；修订后必须以最新单工作提交完整 CI/final-gate 为准。

- **C5 CI 卡住隔离（2026-10-12）：** 修正旧媒体测试的纯展示 mock 后，准确头 [CI #38238459727](https://github.com/lazyxu/xdrive/actions/runs/38238459727) 的其余 23 项作业成功，但 `desktop-tests` 在 `npm run test:main` 阶段长时间未完成；这**不能归因断言失败或宣称新 UI bug**。与其它 PR 同类 Node 检测约 2 分钟完成作对照，先从 C5 撤去跨媒体任务轮询/控制组件的 UI 改写，并还原两个原有媒体测试夹具，用更小范围准确头 CI 验证是否由此导致。旧 Run 应保留作诊断，严禁用其 23 个绿项宣称 final-gate 完成。
