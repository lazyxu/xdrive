# Sidebar 管理员功能等价：Web / Desktop

> 2026-10-12 · 用户已明确要求全功能等价，不允许把 Desktop 管理功能缺失作为平台差异。

| 管理入口 | Web 当前能力 | Desktop 之前 | 工作阶段 |
| --- | --- | --- | --- |
| 用户管理 | 列表、创建、角色、启停、配额、重置密码、撤销会话、删除 | 原无页面、无 Agent IPC | **C1：PR #1506 已合入，准确头 final-gate 通过** |
| 全局后台任务 | 多用户和系统后台任务控制 | 已等价 | 保持 |
| 审计日志 | 过滤、分页虚拟列表、快照、详情 | 原无入口与读取接口 | **C2：#1510 已合入，同一 MUI 页/快照查询，准确头 CI 与 final-gate 通过** |
| 全局存储 | 全局空间、健康、历史、诊断、清理、任务 | 原无管理员页面 | **C3：共享 MUI 完整页面及固定10类权限受限 Agent操作（本 PR 待 CI）** |
| 系统依赖 | 服务概览、配置、验证、历史 | 已等价 | 保持 |
| 系统维护 | 服务端更新及进度 | 已等价 | 保持 |

C1 应迁移完整原 Web 用户管理 MUI UI 到 `ui/shared/src/mui`，Web 保留兼容模块。Desktop 通过同一页面的强类型 Port 和 Agent IPC 调用相同 Server `/api/v1/admin/users` 管理接口；服务端独立执行管理员鉴权、防止修改/删除自己和移除最后一名管理员的约束、密码重置后的会话撤销。不能直接在 Desktop Renderer 携带 bearer Token 或增加自由路径转发器。

验收区分：C1/C2/C3 各自 **代码已提交、CI 通过、已合入**；仅有 C1/C2 不得宣称全部 Sidebar 管理功能已等价。C3 通过后继续 C4 任务 UI 统一，全部验收后再返回性能主线，先查 `docs/performance-test-registry.md` 和 `AGENTS.md`，避免重复 100k 测试。

## C2 · 审计日志 Web/Desktop 全功能等价（2026-10-12）

- **本次范围：** 原 Web 审计完整 MUI 页面迁至 `ui/shared`；Web 仅保留兼容导出，Desktop 显示同一个筛选、固定快照、分页虚拟列表、详情对话框。Sidebar 放在「全局后台任务」后。
- **安全和请求所有权：** 只开放一个强类型、严格输入校验的 `admin-audit/range` Agent 读取接口；Desktop Main 限制页长 1–200、offset、快照及筛选，并复用 sender-scoped AbortSignal / `viewportRequests`；Agent 限制管理员会话，Server `requireAdmin` 再认证并把 HTTP context 交给 GORM。旧 Agent 显示明确不可用，不导出 Renderer bearer Token、不使用任意 URL 代理、不修改数据。
- **状态：** C2 已以单工作提交合入 #1510，准确头完整 GitHub CI/final-gate 通过；真实 Windows 桌面设备上的手工验收与 CI 区分。C3 全局存储与 C4 任务视觉统一仍待完成。

## C3 · 全局存储 Web/Desktop 完整能力对齐（2026-10-12）

- **Status: C3 PR #1514 submitted, authoritative single-commit CI still required; not merged.** Web原有存储统计、健康、历史、异常、CAS诊断、staging及缓存清理、全局任务入口移至同一个 `ui/shared/src/mui/GlobalStorageStatsPage.tsx`；Desktop 复用页面与 MUI，Web 保留兼容导出。Desktop 管理员 Sidebar 新增「全局存储」。
- Renderer 仅提交固定操作枚举，Main与Go Agent校验页长、游标、窗口、清理类型和管理员身份，Go Client 内部 `switch` 固定匹配既有Server `/api/v1/admin/storage/*`，**无任意路径/URL**。Server 独立 `requireAdmin`。两项清理沿用真实用户确认，未添加后台一扫描替代。
- 服务端存储检查/修复使用现有全局后台任务 `system-maintenance:storage_verify|storage_repair` 并显式进入全局后台任务界面，不应在页面销毁时取消持久任务。
- 验收区分代码完成/Go与Node测试通过/PR最终准确头CI绿色/合入/实体Desktop验收。C3 合入后继续 C4 任务卡片和表格视觉统一，性能专项仍暂停到 Sidebar 全部完成。
