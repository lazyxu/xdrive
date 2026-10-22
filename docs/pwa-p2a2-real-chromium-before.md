# PWA P2-A2 · 真实跨 Chromium OS 进程 100k CURRENT/BEFORE

日期 2026-10-22。先更新的权威路线：docs/pwa-five-stage-execution-20261022.md（文档 Draft PR #2334）；原任务 [Issue #2329](https://github.com/lazyxu/xdrive/issues/2329)。本 PR 只新增测试脚本、源码契约、CI 工作流和本说明，不更改产品 App/SW/Go、缩略图存储或 AGENTS.md。

## 真实现状

已合入 P2-A #2325 的 GO/PG17/CAS/390px Chromium 同进程测试（n=3×3）实测：首次四张可见缩略图+两帧 p50/p95 为 1528.098/1701.340ms；同进程重访为 1498.226/1594.896ms，新增 HTTP 请求 0、响应体字节 0。这是 BEFORE，不是持久缓存的性能收益。

## 实验

1. 启用真实 TestGalleryRealWebColdFixture100K，同一 PostgreSQL17/LocalCAS/Owner/Gin Server 下 100k 逻辑媒体及 115k 物理资源、临时 loopback；不能替换成 HTTP mock。
2. 每独立样本一个新磁盘 Profile。真实 Chromium launchPersistentContext A → 关闭 context 并等待 OS PID 消失 → Chromium launchPersistentContext B，仍使用同一磁盘 Profile/Origin/Owner。Linux /proc cmdline 只匹配该 Profile 主浏览器进程，不把 renderer/zygote/新 BrowserWindow 冒充跨进程。
3. 两进程分别在虚拟列表 0%、50%、95% 读取同样四张可见 decoded blob 图像 index，强制 decode() + 两帧 rAF，任何 index 缺失都失败。
4. 每个进程整体采集 Go physical-thumbnail-stats 的 started 与 response_bytes 差值；后者仅是服务端 HTTP response body，绝不声称总 TCP wire bytes。单位置期间的后台可见范围预取不可误归因到具体缩略图。
5. 三组独立 Go 种子×三个位置＝九对。保存精确 HEAD、浏览器进程 PID 不同的证明、可见四图耗时 p50/p95、HTTP 请求/响应体、Go RSS 不超过 256MiB、Go 缩略图并发≤6；公开 CacheStorage 必须排除 API、原件和票据。
6. 只测真实桌面 Chromium 390px 模拟，不是 iOS Home Screen、系统安装、真实 WAN、视频 Motion 播放、全量 100k 解码或 P2 私有缓存 AFTER；缺测、错误、超时一律 RED。

## 合并门槛和后续决定

准确 HEAD 原生 Chrome/真实 Go+PostgreSQL17/CAS 专项、全 Web/Desktop/Go Linux/Windows/PostgreSQL API Race/Final Gate 与 GitHub fresh clean 成功方可合并。之后根据跨进程流量与显示延迟决定是否实施 P2-B。候选 32MiB/128 张/每张 256KiB 均尚非已测最佳值。不能因为同进程 0 HTTP 还假定加磁盘缓存会加速。

生产安全验收按用户决定跳过（未验收）；源码级 Owner/ACL/撤销/Origin/CSP 和 CI 不跳过；保持 Web/Mobile 52px App Frame、Go 取消与持久任务独立。


## 2026-10-22 · 准确 HEAD 验证及实际合并结论（覆盖上方早期“待跑”说明）

- 真原生 Chromium 两独立 OS 进程、同一磁盘 Profile/Origin/JWT Owner 与 Go/Gin/PostgreSQL17/LocalCAS 100k/115k 混合图片，n=3×3=9 对。第一进程的 PID 必须已结束才启动第二进程；**已通过真实专项** [#39712342797](https://github.com/lazyxu/xdrive/actions/runs/39712342797)，准确工作 HEAD `22c932a2a981806b6cf9e6d3316966809a0f8d3f`。
- 真实 Go response body：FIRST 三次进程总计 110 次缩略图 HTTP 请求/77,175 bytes，重新启动进程 114 次请求/80,730 bytes。由此确认同进程缓存不能防止真实进程重启后的重复读取；该数据不是整条网络 wire bytes，也未将请求耗时与渲染/React 编排耗时分开。
- FIRST 四张可见 Blob JPEG/Live still 图像解码加两帧显示 p50/p95 **2417.266/2698.226 ms**，B RESTART **2451.434/2626.517 ms**。没有 P2-B 私人 IndexedDB 实施，没有任何匹配的缓存优化 AFTER；不因 p50/p95 差异宣称加速或退化。
- 准确 HEAD [全 CI #39712342546](https://github.com/lazyxu/xdrive/actions/runs/39712342546) **SUCCESS**，77 项 25 success/52 conditional skipped、Final Gate success；PR [#2337](https://github.com/lazyxu/xdrive/pull/2337) 已 Ready/Rebase Merge 到 `master@1cf0df6b82158f45c61a93d5ac4c7facd4f45400`，其临时分支已清理。
- 数据驱动决策：**P2-B 暂缓而非已完成**。需要未来同配置控制 RTT/带宽、网络性能归因及明确离线保留产品需求后才可考虑有界 Owner Blob Store。此阶段仍保持 App/SW/Go/媒体业务源码不变，物理 iOS/Android `NOT RUN`，不可访问生产安全验收「按用户决定跳过（未验收）」、源码权限安全测试必须保留。
