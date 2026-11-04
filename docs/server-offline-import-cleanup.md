# 离线更新暂存包：显式保留期清理（3C / C10）

此功能仅管理 Server 的受控 `update-imports` 暂存目录，不升级 Server、不验证发布信任、不读取普通文件库、CAS 或备份仓库。

- `GET /api/v1/admin/update/offline/cleanup`：管理员只读预览。仅列出**连续 30 天未活动**、仅包含白名单普通文件的固定 32 位导入 ID；活动时间取目录与所有普通文件的最新 mtime，而不是仅看目录创建时间。返回每个候选的近似占用字节数，不代表文件系统实际释放空间（可能存在硬链接）。
- `POST /api/v1/admin/update/offline/cleanup`，请求 `{"confirm":true}`：确认后再次检查每个候选的最近活动时间、成员类型和总大小，再逐个移除。请求不接受任意路径、清理天数或外部 URL；没有确认不会删除。若 Host 报告更新处于 queued/running，直接拒绝。
- 有未知成员、符号链接、嵌套目录、非白名单文件或尚未过期的目录，**一律保留**；发生 I/O 错误会停止并返回失败。清理按单个目录进行，已完成的清理无需重复执行，失败可以重新调用。
- 暂**不启用后台自动过期删除**，也不会在创建上传会话时静默回收数据；管理员应先检查 GET 清单，再人工确认。这个设计避免误删通过 SSH/SFTP 预先放置的离线发布包。
- 传输完成（`ready_to_verify`）仍不意味着可信发布。真正安装必须交由 Host 完成 Sigstore 或独立双 SHA 验证、备份、安装及失败回滚。

验收：`go test ./internal/api -run '^TestAdminOfflineImportCleanup'`，适用的 PR CI 和 Final Gate；生产环境磁盘回收效果仍需实测。
