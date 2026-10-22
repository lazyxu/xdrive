# PWA CR-03a：真实 Chromium IndexedDB 过期、异常记录与驱逐回归

2026-10-22。第三阶段 P0/P1 组合可靠性测试的一个独立测试增量。P0 公共 SW、P1 授权目录/相册历史及独立的真实 Gin/PG17 Owner ACL #2349 已合入。当前新增正式构建浏览器测试、源契约及专用 CI；**无生产 Web/Go/SW/IndexedDB/Caddy 改动**。

## 本 PR 范围

用准确 HEAD 构建正式 PWA `web/dist`、SW 和 offline.html，在 Chrome 原生进程 A 的独立磁盘 Profile/Loopback Origin 上加载生产公开 Shell 并由公开 SW 控制。合成无凭据 Owner 明确授权后保存一个有界目录及相册摘要。完全退出 Chrome A，关闭测试 HTTP 服务后，独立 Chrome 进程 B 以同一磁盘 Profile 进入真实离线 Shell，确认它只能显示历史摘要，不能成为在线 Owner FileExplorer。

在真正的 Chromium IndexedDB ObjectStore 中，把目录和相册的 `capturedAt` 改为超出 7 日 TTL；调用现有 `xDrivePwaReadOfflineDirectories` 和 `xDrivePwaReadAlbumSummaries` 必须返回 `revalidated=false`、不显示过期数据。接着注入不受信的错误 schema 版本和扩展字段，拒绝伪造历史/Owner hint。最后执行原产品撤销、原生 `indexedDB.deleteDatabase` 驱逐，第三个真实 Chrome 进程同 Profile 离线不得复活目录或相册。期间公开 SW CacheStorage 不得有 API、原件、缩略图或私有票据。

GitHub 仅保存脱敏布尔 JSON、准确 HEAD，不含 Browser Profile、用户 JWT 或私有文件内容。真实 iOS/Android 不冒称通过。

## 未完成及安全边界

这是 **CR-03a**，不包括真实 QuotaExceeded、阻塞的 IDB open、写事务 abort 或任意磁盘损坏、HTTP 429/503、Go Request.Context.Done、跨账号并发撤销。那些独立场景由 [#2348](https://github.com/lazyxu/xdrive/issues/2348) 跟踪，不因本增量关闭。独立 [#2349](https://github.com/lazyxu/xdrive/pull/2349) 才是受控真实 Go Owner ACL，CR-03a 只用本地合成 Owner，不能把它冒充真实权限验收。当前不增加 P2-B 持久图片缓存，不输出性能 AFTER，不自动删除历史公有资源。生产不可访问安全验收按用户决定跳过（未验收），源码 ACL/隐私/CI 照常执行。

准确 HEAD 专项 Chrome CI、完整 77-job CI 和 Final Gate、GitHub fresh clean 均通过后才可合并。
