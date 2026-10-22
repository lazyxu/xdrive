# PWA CR-02 ·真实 Chrome 公共 SW 与 P1 目录+相册的离线重启、重连、跨窗口撤销组合

2026-10-22。依附五阶段计划第三步 CR-02；与并行 CR-01a 真 Go 上传/SW waiting PR 完全独立，不改产品代码。真实 iOS Home Screen、生产账号/网络和生产专属安全验收**按用户决定跳过（未验收）**，但源码鉴权、权限撤销和测试门禁不跳过。

## 不重复原项目的历史单项验收

- P1-B2 已合入的 `desktop/scripts/pwa-p1b2-real-offline-shell.cjs` 经原真实 Chrome 测试证明，公开 App Shell 在跨浏览器进程后以历史目录只读模式离线显示，默认不是已登录/授权。
- P1-C1 已独立通过 100k 相册候选最多保存 24 条、不会存储任何缩略图/原件/EXIF/JWT。
- 新 CR-02 **在同一 Origin/Profile、同一 IDB Owner 记录中组合上述两种真实 P1 快照**，另加服务断网→恢复、无登录时拒绝自动升权、第二实际 Chrome 窗口切账号/实例负例与显式跨标签撤销广播、重启新 Chrome 进程后缓存绝不可复活。

## 实际组合测试

1. Native Chromium 390px 以生产 Vite 构建的 `sw.js` 注册受控公开 Shell。测试源页面显式 opt-in，100k 合成目录采样最多保存前 20 个匿名项，100k 合成相册列表保存前 24 个经投影元数据；禁止任何个人 URL/凭据/图片原件、无全库预取。
2. 关闭 Chrome 进程 A、停止隔离 HTTP 测试服务器响应，再从**同一持久硬盘 Profile** 真 Chrome 进程 B 的 `/#/offline/files` 启动：真实公共 SW 负责静态离线壳；只读历史 UI 必须同时显示 20 个目录文件摘要、24 条相册摘要，验证按钮不可用，原 App FileExplorer 不出现。公开 CacheStorage 精确白名单，无任何私有 `/api/*`。
3. 恢复网络并触发浏览器 online 事件，因无有效登录 JWT，不得自动将历史摘要升级成在线授权目录，验证按钮仍不可用；历史警告和 52px App Header 不消失。
4. 再打开同 Origin 第二个真实 Chrome 标签页，直接调用现有受控 IDB 投影 API 校验异 Owner ID/username/Server UUID 无法读取两种缓存，再调用真实 `xDrivePwaClearOfflineMetadata()`；BroadcastChannel 要求第一窗口已经挂载的 P1 历史目录与相册同时清空，而不是仅改变底层数据库。
5. 关闭浏览器进程 B，测试网络离线后从磁盘 Profile 启动第三个 Chrome 进程 C，**被撤销的任何历史目录/相册条目均不得恢复**，但公开 SW Shell 仍能启动。所有结论保存源精确 SHA 与脱敏布尔 JSON；遗漏/拒绝/超时一律真实 RED。

## 边界与后续

本测试复用正式共享 React PWA Browser、P1 IDB 模块与正式公开 SW，HTTP fixture 的私有 API 返回 **合成 401**，**不证明真实 Go /me/Owner ACL 端到端撤销**。后者必须通过 CR-02 后续独立真实 Go/PG17 鉴权+账号撤销集成 E2E 补齐，不能在本模拟夹具中冒称已通过。也不测试磁盘 Blob 图片缓存、iOS 安装、自动更新、后台长期传输；CR-01a 负责真实上传时 SW waiting。

必须源准确 HEAD 真 Chromium 独立专项与 77-job Web/Desktop/Go/Windows/Linux/真实 PostgreSQL API Race/Final Gate 均通过且 PR fresh clean 才能合并；仅一 scoped test commit，保留完整 master/AGENTS，绝不改生产代码。
