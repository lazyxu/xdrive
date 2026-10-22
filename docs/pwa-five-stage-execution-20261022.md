# xDrive PWA · 五阶段剩余工作与验收台账（2026-10-22）

> 当前执行依据：`lazyxu/xdrive`、根 `AGENTS.md` 及现有 PR/Issues。本文记录**源码事实、准确 HEAD CI、是否合入、浏览器实测、性能 BEFORE/AFTER**；旧的 `docs/pwa-delivery.md` 2026-10-12 表格是历史快照，不能将其“待做”直接当成当前事实。此文仅记录、验收，不代表步骤 1–5 已完成。

## 0. 已验收、不重复开发

| 范围 | 当前源码/PR 事实 | 自动化边界 |
|---|---|---|
| P0 App Shell 公开静态预缓存 | #2246 已合入，hashed Vite Shell/App Header 52px、SW 公共白名单 | 不缓存任何私人 /api、照片、原件、Range、JWT/票据 |
| P0 旧 Chunk 持久与双版本 | #2252/#2256/#2262/#2268/#2271/#2273 已合入 | 旧 lazy JS 与真实 Web/Go/Caddy A/B、17 MiB CAS Go 切换测试存在；不可误记为待开发 |
| P0 公开资源只读容量审计 | #2276 已合入 | **没有自动删除历史 /assets**，无活跃旧客户端安全引用闭环 |
| P0 浏览器 CURRENT | #2277/#2282/#2286/#2294/#2296/#2301 已合入 | Chromium n3/n9 与真实 PG17/Go CAS；不等于实体 iPhone 或配对优化 AFTER |
| P1 只读目录快照 | #2303/#2305/#2306/#2314 已合入 | 默认不授权、每账号最多 10×20/200 项，7 日 TTL、192 KiB，实例/Owner 隔离，单目录线上重验证 |
| P1 有界图库相册摘要 | #2317 已合入（CI #39701670020 77-job PASS/Final Gate） | 最多 24 条已授权相册元数据，不保存封面/EXIF/原件/凭据 |
| P2-A 同进程真实 100k 基线 | #2325 已合入（专用 CI #39704278344、全 CI #39704280120 成功） | 100k 逻辑/115k 物理、390px Chromium n3×3；**同进程**重访 HTTP 0、响应体 0 字节 |

**P2-A 当前真实测值**：首次四张可见照片 decode + 两帧 p50/p95 `1528.098 / 1701.340ms`；同进程相同可见节点重访 `1498.226 / 1594.896ms`；九次重访新增请求 `0`，Go 响应体 `0 bytes`。Go 响应体不等于 TCP 全链路 wire bytes。该结果**不能推导**跨进程、持久缓存或手机设备的提速。

## 1. 第一优先：P2-A2 真正跨 Chromium 进程 CURRENT/BEFORE

**Issue [#2329](https://github.com/lazyxu/xdrive/issues/2329)；未实现、未测。**

- 按 `AGENTS.md` 先冻结当前完整 master、核对既有分支/PR；未合并优先继续旧 PR，已合入的临时分支不再新建重复 PR。
- 在**同一**真实 Go/Gin + PostgreSQL17 + LocalCAS fixture（100k logical/115k physical）、同一 Owner token、同一 Origin、同一 user-data-dir 下，启动独立原生 Chromium 进程 A，滚动 0/50/95%，每处记录四张**真实可见相同 ID** Blob 缩略图 decode 与两次 rAF、Server started/response_bytes。
- 完整关闭并等待 A 的 OS 进程结束，然后启动独立 Chromium 进程 B，复用磁盘 profile/Origin/Owner，在三个位置解码相同 ID；分开记录启动/首次可见/重访时间、p50/p95、Go HTTP 请求与已发送体字节、响应/失败、浏览器/Go RSS、缓存配额、是否为原生浏览器进程。
- n≥3 独立 Go 夹具×3 配对位置，严格源码准确 SHA，缺失指标直接 RED；不得把新 BrowserContext、新窗口或刷新称为跨进程。公用 SW 只缓存公开 Shell，测试不能引入 P2 私有 Blob 缓存。安全隔离、Owner/ACL 源码负例仍必测。
- **验收门禁**：准确 HEAD 真 Chrome+Go+PG17+CAS 专项 + Web/Desktop/Windows/Linux/Go API Race/Final Gate、GitHub fresh clean 后才 Ready/Rebase Merge。没有测量数据就不算完成。

## 2. 第二优先：P2-B 是否值得实现的决定

**必须在 P2-A2 AFTER 有可复核的 CURRENT 前，不改生产缩略图存储代码。**

- 若跨进程仍命中、额外请求和字节≈0，或主要开销为虚拟列表/JS 绘制，则优先定位绘制、不要为提速引入 IndexedDB。
- 若跨进程重新下载真实缩略图且构成显著重复耗时/流量，再考虑 **默认关闭、单 Owner 明确 opt-in、只缓存已经授权且可见缩略图** 的有限 Blob store。32 MiB/128 张/单张 256 KiB 是待验证假设，不是已批准的优化参数或实测最优。
- 若实施，需真实逐字节容量、7 日以内 TTL、LRU、Origin/实例 UUID/Owner/revision 绑定，登出/撤销/切账户/实例清除、缓存失效/QuotaExceeded/IndexedDB 损坏安全降级、跨标签一致；禁止保存密码、JWT/签名 URL、GPS/EXIF、完整照片/视频/Live，禁止私人响应进入 SW CacheStorage。
- 必须有同一数据集/Runner/网络 n≥3 BEFORE/AFTER，改善清晰且 CPU/RSS/首启、请求取消不退化才保留；否则回退或明确记“决定不开发”。

## 3. 第三优先：P0/P1 组合可靠性（先测试、不盲目改产品）

- **CR-01** 已上传首块 17 MiB/更大浏览器前台任务→旧 SW waiting→多窗口仍忙→Go A/B Caddy 升级/回滚→内容 SHA 及传输历史一致；跨窗口和当前 Viewer/编辑不得发生自动 skipWaiting/强制 reload，Server durable 任务不可被前台浏览器取消误伤。既有分别通过的套件不能冒称这个组合已验。
- **CR-02** 同一磁盘 profile，在真实 Chrome 新进程与断网/弱网重连下，P1 Owner/instance 隔离、显式撤销、跨标签/切账号和旧快照清退；在线重验证失败不得将历史目录/相册升级为真实 ACL。
- **CR-03** 同一新版 SW Shell + P1 IndexedDB 存储故障组合：QuotaExceeded/事务 abort/过期/本地缓存被驱逐、401/403/404、Cancel/页面切换；不出现私有 CacheStorage，不触碰真实上传和持久任务。所有测试只使用隔离 fixture。

## 4. 第四优先：先基线→选择性能热点→同条件 AFTER

- 分离首屏 FCP、完整交互、网络请求/实际 Server 字节、Files↔Gallery p50/p95/CLS、真实 Go `ctx.cancel`、Renderer/Go RSS，包含 100k 图片/视频/Live **已存在的各自准确负载**。
- CURRENT 不是 AFTER。标注 runner、Chrome/Go 版本、准确源码、数据量、样本、缓存冷热及限速；优化在同配置至少 n≥3 配对，收益显著且无功能、安全、取消、成本回退才能保留。
- 不在已有 0 缩略图请求的同进程重访场景空泛宣称 IndexedDB 加速；若主要剩余是 1–1.6s 绘制，应对 VirtualGrid/decode/rAF 分析，避免增加预缓存。

## 5. 第五优先：历史静态资源与文档收尾

- 现有 P0-B1 公开 hash assets 归档是只追加，不自动 GC；只读审计已交付。下一步定义旧 SW/HTML/动态 Chunk 活跃版本引用、回滚窗口、保留容量软阈值、操作员人工预览/不可逆删除防护。
- **在有活跃客户端安全证明以前，不实现自动清除旧静态资源**。缺失/冲突/软链仍 fail closed，旧 Chunk 缺失应真 404 而非 index.html。
- 更新 `docs/pwa-delivery.md` 的权威附注，历史叙述保留以供复核；#2260/#2269 已合入部分不再报进行中。只关闭确实**全部完成**的 Issue，混合 Issue 保留未完成子项，不删除其他 Owner 正在开发的分支/PR。

## 恒定约束与真实边界

- Web/Mobile Web 仍共用 Files/Gallery/Viewer、Go Owner/ACL/Range 和虚拟列表；Mobile 全屏 Header **52px**，不重新做双后端/全图库预缓存；取消时 Go `Request.Context()` 应终止短生命周期请求，而不是取消 Durable Server Task。
- **真实 iOS/Android 安装/系统设备验收**单独保持 `NOT RUN`，不把原生桌面 Chromium 伪装成物理设备。ChatGPT 无法触达的生产环境安全验收长期统一 **「按用户决定跳过（未验收）」**，绝不索要 AK/JWT/Cookie/HAR/生产权限、也不阻塞源码/CI/PR；但代码级 Owner/Consent/撤销/Origin/CSP/跨账号/恶意输入负例必须完成。
- 必须先报告当前阶段、完成/未完成及准确 CI 证据；同一阶段优先原相关 PR/分支，已合入/废弃分支确认后清理；保证完整 `AGENTS.md` 与别的 Owner 的所有主线代码无损，唯一范围明确的工作提交通过准确 HEAD CI 才合并。
