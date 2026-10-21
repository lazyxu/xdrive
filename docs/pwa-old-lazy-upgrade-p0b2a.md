# xDrive · PWA P0-B2a：旧按需 JS 跨升级与回滚浏览器验证

日期：2026-10-21。前置 P0-A #2246 和 P0-B1 #2252 已合入 master。P0-B1 建立 Caddy 公开哈希文件持久目录、旧资源导出、不可变追加。本阶段增加真实浏览器验证及可复核的边界，不引入私人持久缓存、不改 Files/Gallery/Viewer、52px App Frame 或上传下载流程。

## 真实执行路径

- 根据准确 HEAD 的 Vite 生产构建得到正式 SW 与 .vite/manifest.json。自动从真实 manifest 选取一个 dynamic entry，确认其没有进入启动 Shell 预缓存，并在升级后以 HTTP 返回 JS MIME、原始字节长度和 200。
- POSIX 真实执行 deploy/pwa-archive-assets.sh，先归档原版公开 assets 与独立旧哈希 lazy ESM，然后归档另一版本的公开 assets 与新增哈希 ESM。旧版本 lazy 文件第一次请求发生在“更新归档”完成后。
- 通过 Chromium 的 import() 真实执行旧/新 ESM，不用 Node require 或拦截器模拟模块加载。
- 真实 SW 注册、update()、waiting、原页面关闭后新版激活，以及模拟回滚后的旧版恢复。没有 skipWaiting、强制重载、转储用户数据。
- 对 /assets/* 应答 immutable；缺失文件必须返回 404 和非 HTML MIME。匿名 /api/* 必须 401，且不能进入公共 CacheStorage；按需模块也不进入公共 SW 缓存。
- Desktop Chromium 与 390px Mobile Emulation 各重复一次。保留不含敏感内容的 summary.json。真实浏览器测试不等于 iOS 真机。

## 范围与重要限制

**真实 Chromium 与生产 Vite 构建执行，不等于两套独立真实版本的完整上线升级。** 两个测试用 Web 版本标记仅由单次真实生产编译中添加的公开哈希 ESM 和不改变产品路由的 SW message probe 构成；没有对旧版与新版 Go Server 在真实版本偏斜条件下进行兼容证明。也没有证明 OS-installed iOS 27 PWA 已通过、提升了启动速度或消除了 100k 列表的抖动。

后续 P0-B2b：分别构建两个准确 SHA 的 Web + Server 兼容版本，对不同 API 版本、回滚和用户操作严格验证；P0-B2c：定义旧资源的容量统计、活跃客户端寿命、人工清理与必要回滚保留策略。上述完成以前 **不自动 GC**，不能用破坏升级可靠性的清理方式换取空间。

后续 P0-C：iOS 冷/热启动、断网 Shell、Files/Gallery 切换、100k 媒体、在旧版上传时发布新版，必须先做同条件 BEFORE 基线，随后选择明显收益的优化，提供 AFTER 数据；不足收益则回退。Safari Home Screen FCP/p50/p95/CLS、真实设备配额和跨平台行为均为 **未验证**，不得用 Chromium emulation 冒充。

生产专属安全验收按所有者决定 **跳过（未验收）**，不要求生产权限或真实生产 HAR，也不作为 CI 或合并门槛；源码安全和隐私测试必须保留。

## P0-B2a · 真实浏览器就绪门槛修正（2026-10-21）

首次重建后的 Chromium [#39527418983](https://github.com/lazyxu/xdrive/actions/runs/39527418983) 两次尝试均在 `page.goto(..., waitUntil:'load')` 等待整个窗口资源完成时超时；真实 Vite 构建/SW 修订号两次均相同，不能以「偶发 CI」标记通过。只修改测试夹具：导航和 reload 等待 `domcontentloaded`，分别验证 HTTP 200 和实际生产登录入口 `[data-xdrive-pwa-login-entry]` 已可见，随后仍真实等待 SW ready/controller、waiting、旧 lazy 跨升级读取和回滚。未延长超时、跳过 Chromium、修改产品 SW 或缩减任何资源/鉴权/回滚断言。**新准确 HEAD 必须重新跑真实 Chromium 和完整 77-job CI/Final Gate。** 此测试仍非实体 iOS 主屏 PWA。
