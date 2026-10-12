# xDrive 系统维护 — 管理员专用工作区

> 2026-10-12 · P1 Sidebar 管理边界修复。复用既有持久服务端更新协议，不新增宿主机命令。

## 归属与入口

- 实例级服务端更新只在 **管理 → 系统维护** 显示。Web 使用 `admin-maintenance` App ID 和 `#/app/admin-maintenance`，Desktop 使用同名 view key；移动端 App 切换抽屉复用管理员权限过滤。普通用户隐藏入口，管理员身份撤销后退出管理员页面；真正权限始终由 Server `/admin/update` 的 `requireAdmin()` 判定。
- 个人「设置」仅包含外观、构建信息及 Desktop 本地客户端更新/同步/缓存项目。实例服务端升级不混入个人 Settings，也不混入「系统依赖」的 11 服务懒加载。
- Web 使用既有 REST GET/POST `/api/v1/admin/update`，Desktop 使用认证 Main→Agent IPC；共享 `XDriveSystemMaintenancePage` 复用 `XDriveServerUpdateCard`、`useXDriveServerUpdateController`、受控确认摘要，保留来源、通道、可选文件数据备份、实际状态和字节进度。旧 Agent 能力缺失时显示不可用/禁用，而非虚假成功。
- 更新由服务端宿主机持久执行；离开页面、关闭窗口或切换 App **不会发出取消更新请求**。仅在页面可见时轮询状态，重开后从既有 REST/IPC 恢复观察。用户同步文件夹、文件/图库、任务中心、52px App Frame 与其权限语义保持原状。
- 不向 Renderer 添加任意宿主路径、Docker socket、自由命令或新凭据接口。不变更现有 Host Manager/installer 事务、备份、失败恢复和权限逻辑。

## 验收边界

- 验证普通用户/管理员菜单和视图、Web 类型化路由与 899/900px compact 导航、Desktop 管理员角色降级、个人设置剥离、共享确认及错误/不可用反馈、Web REST 与 Desktop Agent 传输独立。
- 精确工作提交完整 CI 成功后才可合入。无真实宿主机升级、WAN 断线、升级回滚物理验证结果，不得声称通过。

参考 [Web App Runtime](web-app-runtime.md)、[系统依赖](service-dependencies.md)、[AGENTS.md](../AGENTS.md)。
