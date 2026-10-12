# Sidebar 容量条：个人云端用量与服务器磁盘口径

> 2026-10-12 · P2。更正展示含义，不改 Server quota、磁盘容量、CAS 算法或用户配额。

## 真实数据来源

- `/api/v1/me/quota` 的 `physical_used_bytes` 来自当前用户的 `xd_files` 与 `xd_file_versions` 引用，按 `owner_id, storage_key` 去重计费（`internal/api/quota.go` 的 `physical_usage` 查询）。它不是操作系统磁盘占用统计，也不是实例真实 CAS 独占空间分摊结果。同一内容可能被多个用户引用；压缩/文件系统/其他目录也不在这一字段中。
- `quota_bytes > 0` 是当前账号的配额，Sidebar 标题为「我的云端存储」，显示个人已使用/个人总配额和个人百分比；用户/管理员浏览其他页面也不应改变该意义。
- `quota_bytes == 0` 表示当前账号**无容量限制**。为了满足无上限时仍显示可用磁盘空间的要求，Server 在本场景额外返回真实 storage-capacity `disk_total_bytes`、`disk_available_bytes`。Sidebar 明确把它标为「服务器存储磁盘（非个人配额）」，可显示磁盘总占用百分比及剩余容量；这个百分比不能冒充账号配额比例。
- **严禁**计算 `otherDiskUsedBytes = (disk_total_bytes - disk_available_bytes) - physical_used_bytes` 并把差额当作“其他占用”，也不能将当前用户去重计费字节标成服务器磁盘某个颜色分区。二者不同口径，来源不支持这一归因。无限配额时仅使用一个服务器磁盘占用进度条，不显示个人/其他的伪堆叠。
- 无可信 `disk_total_bytes` 时，即使有 `disk_available_bytes`，也只显示可用空间，不推算不存在的百分比。无任一数据时不显示磁盘进度。
- 如磁盘可用为零而用户配额无限，磁盘进度可以为红色 100%，但不得显示“账号已超额”；两类风险必须分开。

## 实现与验收

- Web/Desktop 共用 `XDriveWorkspaceSidebar`、`XDriveSidebarStorageSummary` 和 `xDriveWorkspaceStorageSummary`。保留 Sidebar 常驻布局、条高、深浅色及 52px 全屏 App Frame；没有全局管理员任务/用户操作混进容量条。
- 新增真实组件输入输出级 Node/TypeScript 测试，覆盖配额 25%、无配额但磁盘 70%、磁盘 100%、未知磁盘总量、用户超配额等口径和色彩。旧“其他占用”静态断言改为明确禁止伪归因。
- 只变更呈现层、测试及规范；不修改 SQL、磁盘获取、用户计费、清理任务或上传/下载/同步。未经真实部署测试，不宣称磁盘实际物理改善。

参考 [AGENTS.md](../AGENTS.md)、[存储清单](storage-inventory.md)、[本地存储范围](local-storage-scope.md)。
