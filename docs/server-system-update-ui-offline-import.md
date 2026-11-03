# 系统更新离线包 UI：3C / 4B 分阶段

> 2026-11-03 Owner 方案：1A 2A 3C 4B 5A；当前 PR 只实现 Web 管理端离线导入界面/传输适配，依赖前置 UI 路由 PR #3744、Go API 暂存 PR #3763、Go Host 执行器 PR #3758、Go 签名发行 PR #3760。不能把独立 PR 中未合并的实现视作已交付。

## 同一个管理入口

「管理 → 系统更新」保留当前在线 GitHub/GitLab/xDrive Share Server 更新、完整 BuildInfo、进度/失败回滚的既有 Host 状态。其下增加离线 Go 五组件管理面板。Web/ Desktop 共享 `XDriveOfflineSystemUpdatePanel` 和 `XDriveOfflineImportPort`，不同宿主只提供真实授权传输适配器；目前 Web 已接入 Server 管理员 API，Desktop Agent 传输适配器需按同一 Port 后续实现。普通用户 Desktop 本机更新仍在独立的「客户端更新」入口。

## 浏览器上传

- 从管理员后端获取随机 32 位导入 ID，目录是固定受控根 `$XDRIVE_HOME/state/update-imports/<id>`。允许在 Web 中选择同一个历史 ID 续传，也允许宿主机通过 SSH/SFTP 在同一目录预先放入不可变发布文件，不能填写任意路径。
- 允许 Manifest、`xdrive-offline-linux-amd64`、Go delivery 元数据、五组件内容寻址 `.tar.gz`，单个组件不超过 8 GiB。浏览器一次仅处理 8 MiB 的 `File.slice`，WebCrypto 每块 SHA；Server 对完整文件流式 SHA 并在原子无覆盖提交后显示传输完成。重复上传已接收块会对比其内容且不会追加两次。
- 关闭或切换页会 abort 当前传输，不会取消 Host 更新任务；可再次选同一文件重新对比/补发已完成分块。显示候选包传输进度但不把上传哈希当成发布信任证明。
- 离线激活必须输入**独立可信渠道取得**的 64 位 Manifest SHA 与 Go ELF SHA，通过相同的 `POST /api/v1/admin/update`、`source=offline` 和 Host Control 事务确认。数据库备份/健康检查/回滚仍是原升级链路。UI 不具有 Docker Socket 或执行任意脚本能力。

## 待上线依赖

4B 的 Go ELF Sigstore 自动可信验证尚未实现，本轮 UI 仅允许手工双 SHA 安全路径。必须等 #3760 的受信 Go 发布、#3758 Host 执行器、#3763 上传 mount，以及后续签名 Host 接口全部通过适用 CI 后才可声称「浏览器直接离线升级」已完成。DSM 复用相同 UI 但不能绕过其 Host capability；Gen10 真实断网升级和失败回滚均需独立实机验收。
