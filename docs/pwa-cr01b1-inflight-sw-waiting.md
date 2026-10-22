# xDrive PWA CR-01b1 · 真实 HTTP PUT 在途期间双窗口 Service Worker waiting

日期：2026-10-22。关联未完成 [#2347](https://github.com/lazyxu/xdrive/issues/2347)。复用已合入的 [CR-01a #2344](https://github.com/lazyxu/xdrive/pull/2344)，只增加新的隔离测试驱动、Shell、GitHub Actions 与文档，**不修改任何正式 Web、Go、Caddy、Service Worker、CAS、数据库迁移、AGENTS.md**。

## 真实联合测试

1. 使用固定旧发布版本 A 与本 PR 源码准确 HEAD 版本 B，分别构建真正的 Vite Web 和 `cmd/server`。Docker Caddy 2.10.2、单独的 PostgreSQL 17 和 LocalCAS、合成 Owner/JWT，通过真实 Chrome 390px 两旧受控窗口运行 17 MiB 分块上传。
2. 首块 chunk0 8MiB 通过正式 HTTP PUT 真提交并在 DB 读取验证，独立测试控制器 SIGKILL 正式 Go A，真实 Caddy reload 代理到 Go B，复用原 Session/JWT/Root。
3. **不同于 CR-01a 的“块与块之间活跃 Session”**：第一旧窗口以真正 `fetch` + `ReadableStream` + `duplex:'half'` 发起第二块 8MiB PUT，先发出 512KiB，余下字节由测试 Promise 阻塞。不依赖 CDP 请求发起事件作为读入证明。Node 读取仅本次隔离 Go LocalCAS 根目录，发现生产 `Store.Put` 写入 `.xdrive-upload-*` 的非零临时字节（至少 256KiB、尚不足 8MiB），这是 **Go 已消费 Request.Body 的物理旁证**。缺少旁证或 PUT 先完成一律失败。
4. PUT **尚未结束**时原子发布真新版 index + SW，两个旧 Chrome 窗口保持相同 Controller/DOM、无 controllerchange，真实新 Worker 稳定处于 waiting 至少 600ms。此时再核验 PUT 未结束和 Go 仍写着部分文件。绝不使用 `route.fulfill`、`skipWaiting` 或自动刷新。
5. 释放第二块余下字节，真实 Go B 必须返回 201、准确长度及完整 chunk SHA。只发送第三块 chunk2、Finalize；保留旧页面和 JWT/原 Upload ID/未重传 chunk0 的断言。独立另一 Go 测试进程重新读取 17MiB 物理 LocalCAS 全部字节、FileVersion、节点及 Blob RefCount，验证不会错误出现两份逻辑文件。两个旧窗口关闭后新 SW 才能接管，私有 API 响应永远不在公共 CacheStorage。

## 严格范围边界

本增量只可声称**真正单 HTTP PUT 在途**与双旧窗口新版 SW waiting、真实 Go A→B 和物理字节校验组合通过。不能把该结果扩展为：独立第二窗口也在上传、真实 Server Durable Task 同时运行、B→A 与 DB schema 兼容回滚、Files UI 文件选择器、实体 iOS/Android 或任何生产网络验收。它们仍由 #2347 后续测试；本轮旧版生产 Go A 已 SIGKILL，不能假装完成 B→A 真实回滚。测试 Go临时文件大小不是 TCP wire bytes。

准确 HEAD 的真实 Chrome+Caddy+Go+PG17+CAS 专项、完整 77-job Web/Desktop/Linux/Windows/API Race/Final Gate 与 GitHub clean 才允许 Ready/Rebase Merge。失败时仅调整证据驱动，不降低检查或无依据修改生产缓存。生产不可触达的安全验收按用户决定跳过（未验收）；源级 Owner/ACL/负例/CI 均须执行。


## 2026-10-22 · 首次准确 HEAD 浏览器 RED 与测试入口修正

最初工作 HEAD `6b7fbe15` 的真 Chrome+Go/Caddy/PG17/CAS [专项 #39741575746](https://github.com/lazyxu/xdrive/actions/runs/39741575746) **FAILED**：受控 8 MiB chunk1 PUT 已从原浏览器启动，但 30 秒内测试 Go LocalCAS 从未观测到至少 256 KiB 的真实 Request.Body 消费，固定失败阶段 `open-authentic-Go-B-streaming-PUT`、源码行 64。不能报告 HTTP 在途重叠或真实后端读取已通过。

原因是旧 CR-01a 的测试 Caddy 只开启明文 HTTP/1.1，而 Chromium `fetch(ReadableStream, duplex:'half')` 请求正文流必须在 HTTPS + HTTP/2 或 HTTP/3 链路上发送（见 [Chrome 官方限制说明](https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests)）。**仅在隔离的本机自动化 Caddy 夹具**改用 `localhost` 内部临时 Local CA 的 HTTPS/H2，Playwright 本地测试 Context 允许夹具自签发证书，且检查导航 `nextHopProtocol==='h2'`；不能把测试证书视为生产 TLS 信任。生产 Caddy/Go/Web/Owner API 保持不变，原真实 LocalCAS 部分字节与双旧 Worker/DOM waiting、物理全 SHA 强断言均保留。旧 SHA 的 RED 和 CI 不能授权新 HEAD 合并。

## 2026-10-22 · 真实 TLS/H2 专项等待可审计化

进一步检查修订后测试驱动发现，原 `navigator.serviceWorker.ready` 在 Primary/Peer 原生页面内均是无限等待；一旦受控自签发测试 Local CA 导致 SW 无法安装，就可能直到整个 95 分钟 Job Timeout 才报错。测试新版本**仅**将这两个等待改为 Playwright 对真实 `ServiceWorkerRegistration.active` 的 30 秒定界轮询（首先等待原页面正式 `load` 事件，绝不手工补装 SW），并为隔离 Chrome 明确允许**受控本机 Caddy 内部临时 CA**，不影响产品证书、AK、Host Apply 或正式 Caddyfile。

原 Go Body 部分落盘、真实 HTTP 在途、stable waiting、双 Controller/DOM 未变、17MiB physical CAS 后验门禁均不放宽。新增匿名全测试上限 WATCHDOG，仅输出固定 `safePhase` 不包含 URL/JWT/上传 ID/CAS 路径；此前曾成功的旧 HEAD 或仍在运行的旧 Job 不能视为新 SHA 验收。测试脚本一旦不能真实注册生产 SW 就保持 RED。

