# Desktop 系统更新：管理员离线导入 Agent 桥接

设计：1A / 2A / 3C / 4B / 5A；Go 优先；xdrive-server CLI 与 UI 共用 Host Control 事务。此 PR 仅补 Desktop 端受限传输能力。

## 受信数据流

1. Desktop 共享管理「系统更新」页是入口；普通用户「客户端更新」仍是独立的本机更新。
2. Renderer 只能通过固定的 window.xdriveDesktop.agent.offlineImport* 方法传导入 ID、许可文件名、分块二进制和 SHA；不得触及 API Token、Docker Socket、任意 Host 路径或安装命令。
3. Electron Main 检查主窗口 mainFrame、管理员角色及 Agent server-offline-update 能力，检验 32 位导入 ID、许可文件名与 8 MiB 上传限额。
4. Go Agent 在 localhost 只公布固定的 /v1/server-offline-imports 命名路由；Go Client 用原有认证会话向同一 Server 管理 API 转发受限输入；Go Server 仍核对管理员权限、逐块和整文件 SHA。
5. 最终激活只传导入 ID、从独立可信渠道获取的 Manifest SHA 和 Go ELF SHA、是否额外备份文件。Go Host Control / CLI 是唯一安装权威，负责镜像身份、备份、更新与回滚。

## 前置条件及状态

- Go Core #3751 与管理 UI #3744 已通过 CI 合入 master。
- Go Host #3758、Server 上传暂存 #3763、签名发行 #3760、Web 共享离线更新面板 #3765 有各自的验证门禁。
- 此 PR 不向 Desktop Renderer 显示尚未合入的离线包面板；需在 #3765 合入后给已有共享 Port 配上 Desktop Agent 方法，不能直接使用 Renderer Token。
- 本 PR 必须通过 Linux/Windows Go、Electron TypeScript、Agent IPC 和适用 Final Gate 才能合入。Gen10 实机离线升级尚未验收。
