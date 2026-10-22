# xDrive PWA P4-A · 真实 100k/115k Chrome 阶段归因 BEFORE（只新增测量）

日期：2026-10-22。根据根 `AGENTS.md` 与 [PWA 五阶段台账](pwa-five-stage-execution-20261022.md)，第四步必须 **先测量真实现有慢点，才决定是否修改生产**。此前 [P2-A2 #2337](https://github.com/lazyxu/xdrive/pull/2337) 已用真实两次不同 Chromium OS PID、同一磁盘 Profile/Origin、三个物理 Go/PG17/CAS 夹具证明跨进程缩略图重新下载；但它**没有分离**网络等待、VirtualGrid/JS、浏览器布局或图片解码阶段。本增量只为诊断提供更细颗粒的观测工具，不交付任何性能优化或持久私有 Blob 缓存。

## 固定实验与源码边界

只新增 `desktop/scripts/pwa-p4a-100k-phase-attribution.cjs`、source contract、PR 分支专用 CI 和本说明。**不修改** `ui/shared`、`web/src`、`internal/api` 产品函数、Service Worker、Go 媒体路径、Caddy、数据库 Schema、旧发布器、`AGENTS.md` 或其他人开发中的分支。

原真实物理夹具 `TestGalleryRealWebColdFixture100K` 不变：Go 1.25 + PostgreSQL 17 + LocalCAS，**100,000 逻辑、115,000 实际物理媒体节点**、真实 390px 移动宽度的原生 Chromium，三次独立夹具、每个夹具视口 0%/50%/95%，共 9 对可见四张照片。Chrome A 完全退出 OS 进程，B 使用同一个 Profile/Origin；绝不把页面 reload 或 Electron 新窗口冒充新 OS 进程。新请求与 HTTP 响应体字节仍来自真实 Go Probe，Go RSS 增长和 handler 并发限制仍按 P2-A2 原样断言。

## 新增可观测指标（严格不混同）

- 真实 Chrome DevTools Protocol 的 `Performance.getMetrics`：每个视口前后 `ScriptDuration`、`LayoutDuration`、`RecalcStyleDuration`、`TaskDuration` 的累计 CPU 时间差，以及读取时刻 `JSHeapUsedSize` 估计值；这些 CPU 分类**会重叠，不可直接加和成总可见耗时**，也不代替 Go 端耗时。
- 可见四张原图经 Chromium 实际 `img.decode()` Promise 的**可见后剩余等待**和随后两个 `requestAnimationFrame` 的调度等待，分项记录 `lateDecodeAwaitMs` / `postDecodeTwoRafMs`。它们不是完整的解码耗时、不构成真实 GPU raster/paint 归因，不能拿来证明图片解码不是慢点。
- `performance.getEntriesByType('resource')` 观察同源 `/api/` 已暴露的请求数与起止窗口，但 Service Worker、ResourceTiming buffer、浏览器缓存和已完成请求可能导致不完整；**不能从 ResourceTiming 误算 TCP wire bytes 或网络占比**。真正的 Go HTTP started/response bytes 另列。
- 固定 3×3 的可见四张 + decode + 双 rAF 的 p50/p95、OS PID、虚拟 Grid DOM 数量（必须远小于 1,000）、Go 真实 HTTP/RSS/并发及公共 CacheStorage 私有内容防护。

本次 `AFTER=null`、`optimizationImplemented=false`、`privatePersistentCache=false` 固定不可变；增加观测本身可能带来 CDP 测量开销，所以**不直接与旧 P2-A2 运行数字比较并称为提速/退化**。若将来发现超预算，需冻结当前生产 `master` 和浏览器/PG/CAS Fixture，候选变更用**同 Runner、同数据、每组 n≥3、匹配之前/之后**，记录 p50/p95、Go CPU/RSS/I/O、HTTP 字节、首屏/媒体首帧、取消后资源释放和 Owner/权限负例。优化没有明显收益或引入额外隐私/性能代价则回退。

## CI 与未验收边界

准确 HEAD 独立真实 Go/PG17/CAS + 原生 Chrome 100k/115k 三夹具专项必须成功，并且完整 77-job/Final Gate 与 GitHub clean 才可合并这个纯测量工具；不允许使用模拟媒体图替代 LocalCAS 真实字节。CI 上传只含计时数字/聚合统计和已存在的原 P2-A2 数值类匿名 summary，不上传浏览器 Profile、真实 JWT、媒体像素、原始照片、文件路径、GPS 或私人日志。真实 iOS/Android `NOT RUN`；生产专属不可达安全验收 **按用户决定跳过（未验收）**，代码级 Owner/ACL/源级安全与 CI 不跳过。第五步旧 hashed `/assets` 保持 append-only、无自动 GC。
