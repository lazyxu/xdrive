# xDrive PWA CR01b6 · 真正 Files 文件选择器与 SW waiting 组合

日期：2026-10-22。目标：[#2347](https://github.com/lazyxu/xdrive/issues/2347) P0-08，复用已合入的 CR01b3 #2372、不同 Owner CR01b5 #2383 的真实 Chromium/Caddy/TLS-H2/Go/PG17/LocalCAS 测试框架，不新建文件协议、不修改生产 Service Worker。

**实际执行过程：**同一测试 Origin 先完成原有两个旧窗口、两条独立进行中的真实 HTTP PUT、两份不同的 Go 临时 CAS 文件和新版 public SW B stable waiting。然后，在原先受旧 Worker 控制的 390px Mobile Web Files 页面，通过真实的「文件操作菜单 → 上传文件」操作触发浏览器原生 FileChooser，以用户交互选择一个 1 MiB 的、测试专用的确定性二进制文件。不能直接发第三条合成上传 HTTP 请求，也不能以伪造 JS File/Blob 代替系统选择器。

选择文件后，必须由已构建的生产 Web 上传链路执行真实 Go UploadSession/Chunk/Finalize，得到 200 finalized、正确 SHA-256 与 Owner Node。两条原先被控制的 HTTP PUT 必须仍保持 in-flight、原旧 Worker Controller/DOM 不能变化，不能调用 `skipWaiting()`、强制刷新或把私人响应放入 Service Worker CacheStorage。

上传完成后，继续释放两条原始上传流并验证已有 17 MiB + 6 MiB SQL/CAS 后验。第三个文件另由独立的原始 Go 集成测试直接从 PostgreSQL、LocalCAS 读取，要求唯一原件、UploadSession finalized、ContentBlob Ready/引用及全字节 SHA-256 一致。三份数据不得混同。

该任务**不表示** OS 安装 iOS/Android 系统选择器已验收，也不覆盖不同 Owner 同一个 BrowserContext（这不是有效的登录隔离场景）。真正生产安全环境不可触及项继续记「按用户决定跳过（未验收）」，代码级 Owner、权限、公开 SW 缓存、完整性与 CI 必须保留。旧 public hashed assets 继续 append-only，禁止自动 GC。

合并门槛：准确 HEAD 的真实 Chrome/Caddy/Go/PG17/LocalCAS 专项成功 + 完整跨平台 CI/Final Gate 成功 + GitHub fresh clean，再 Ready→Rebase Merge；任何 RED 不放宽原有断言。
