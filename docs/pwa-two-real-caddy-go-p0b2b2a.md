# xDrive · P0-B2b2a：真实 Caddy + 两代 Go/Gin 的 Web/API 交叉兼容（首个增量）

日期：2026-10-21。依赖 B2b1 [#2262](https://github.com/lazyxu/xdrive/pull/2262) 的真实独立 Web A/B 构建与旧懒加载校验，先从 B2b1 分支创建**独立叠放 Draft PR**；待 B2b1 真实专项、准确 HEAD 完整 CI/Final Gate 合并后，本 PR 再重新基于完整 master 自身验收。这个文档不是生产环境安全验收，也不是 iOS 真机验收。

## 背景与本阶段真正补上的证明

B2b1 的 HTTP server 是本地 Node fixture，匿名 API 固定返回 401，不能证明真实 Caddy 代理到两个真正独立的 Go/Gin 版本，更不能证明不同发布版本的 Web 可实际登录读取 Owner Files/Gallery。因此 B2b2a 先以历史真实 `e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4` 为 A、PR 的**准确 HEAD** 为 B，两次分别独立 `npm ci + Vite build` 和 `go test -c ./internal/api`，生成实际可执行的历史 Go A/current Go B 测试服务器二进制。

重用既有 opt-in `TestPWAS2B3RealGinAuthFixture`：真实 Gin Router、真实 PostgreSQL17 的隔离 Schema、真实 Local CAS、两名真实测试用户的密码哈希/JWT/权限、目录和 2×2 PNG 对象/PhotoAsset/PhotoResource。执行 **Web A → Gin B**、**Web B → Gin A** 两个方向，各在 Chrome 桌面 1280px 与 390px 移动*模拟*两种视口运行，不把 Chromium 模拟称为 Safari/iOS 27。

## 真实 Caddy 配置如何验证

- 使用官方 `caddy:2.10.2-alpine` 的**真实二进制**、`caddy validate` 和 `caddy run`，非 Node HTTP 语义模拟。测试从当前仓库 `deploy/Caddyfile.common` 加载原 `xdrive_app` block；仅在**临时本地文件**把 `server:8080` 替换成真实隔离 Gin 的 `127.0.0.1:<随机分配的 fixture 端口>`（它是测试容器与 Go 进程通信地址，不写入产品配置）。
- 两个真正独立的 dist 的 `assets` 都执行原 `deploy/pwa-archive-assets.sh`，公开不可变归档由 Caddy file_server 提供。证实双版本真实 Vite 懒模块均返回 JS 200/immutable/字节 SHA256，未知 hashed JS 必须真实 404 而非 SPA HTML；`index.html` 与 SW 必须 no-cache。
- `/api/*` 必须由真正的 Caddy reverse_proxy 请求真实 Go/Gin，未经登录 401，完成登录后由持有者读取 Node、Root、Gallery Range、媒体元数据和版本均返回 200，跨 Owner 路径返回 404。
- **仅测试环境**允许 `/__test/pwa-s2b3/finish` 送到原 Gin fixture，促使 Go 测试端再作数据库/CAS/Owner 最终核验。这个路径永不进入生产 Caddyfile 或 Go Router。
- Chrome 使用实际登录 UI、PWA SW ready/controller、浏览器 CacheStorage 清单审计，不允许任意私有 API/JWT/文件或媒体进入公开 SW 缓存；Node fixture 不拦截 API。真实 Chrome 页面行为和 Go 测试验收两端都成功才通过。

## 安全、范围与未实现部分

- **不触碰产品代码**：不改用户可见 52px Mobile App Frame、Files/Gallery/Viewer、Vite 打包、SW、Go Server 正式逻辑、Agent 或 Caddy 正式配置；保持旧版 waiting，不调用 skipWaiting、不强制 reload、不取消服务器 Durable Task。
- CI 只上传不含个人数据的 `summary.json`，包含确切源 Commit、公开真假声明、4 组合布尔结果；不上传真实密码/JWT/Cookie、Gin 日志、私有就绪文件、浏览器 profile、私有 CAS 字节或 HAR。所有测试数据库只使用 CI 自建的 PostgreSQL17。
- **本次不能宣称**：旧 Web 已登录过程中将 Go A 热切换为 Go B 的同一共享数据库 SessionVersion 兼容、用户真实上传 17 MiB/1 GiB 正在进行时无中断、后台 Durable Task 持续、Caddy Docker Compose/公网 HTTPS 及实际 iOS Home Screen 安装。上面是 B2b2 后续单独的共享 DB 与真实传输验证；不能用两套独立 Gin Fixture 的静态交叉组合取代同会话热升级。
- P0-B2c 归档空间只读统计/手工清理制度、P0-C iOS/Files/Gallery 性能 BEFORE/AFTER，以及 P1 IndexedDB/P2 缩略图缓存仍按顺序待办。这里没有测量 iOS FCP、p50/p95 或 100k 缓存改善，不能声称加速。

## 合并门槛

本阶段先在 B2b1 上游分支**单工作提交**、Draft 叠放核查；待上游合入后保留自身独立内容并重建到完整最新 master（严格保留 AGENTS.md 历史）。必须准确 HEAD 真实 Caddy+Chromium+两个 Go 编译版本的 CI 专项通过，以及完整 Web/Desktop/Go Linux/Windows/真实 PostgreSQL API Race/Rootless/Final Gate 与 GitHub fresh clean；红灯不降低断言、不取消场景。按用户长期决定，**生产环境专属安全验收跳过（未验收）**，不索要生产 AK/Cookie/JWT/HAR/权限，但源代码鉴权、隐私负例和 CI 始终必做。
