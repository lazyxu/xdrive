## SH-P018 · Latest verified exact-source 100k matched performance (2026-10-21)

- Verified **source `87a6542f525c87ad642eb7a6f0ace2d6fb4f05bc`**: genuine same-runner alternating A-B/B-A/A-B [matched #39591682608](https://github.com/lazyxu/xdrive/actions/runs/39591682608) **SUCCESS** with per-arm/per-viewport n=9, three independently populated real 100k SHA-distinct physical JPEG sets, immutable Go/PG17/LocalCAS authorization and real Chromium Web 1440/CDP390.
- Web 1440 cancellation P50: **174.070 → 69.711 ms (59.95% lower)**; CDP390: **151.931 → 66.586 ms (56.17% lower)**. Median per-process RSS 229468→229608 KiB, CPU 56.010000000000005→55.9 s; within original resource ceilings. Real browser abort reached Go Request.Context.Done, no stale response body, no durable user task stopped.
- Same measured source [six independent real browser scenarios #39591684485](https://github.com/lazyxu/xdrive/actions/runs/39591684485) **SUCCESS**; real scroll-out, pagehide, next-page, six Go cancellations (max 73.464 ms), 0 orphan response bytes/handlers, real cached images decoded, 100 bounded item rows. [77-job full CI #39591685244](https://github.com/lazyxu/xdrive/actions/runs/39591685244) **SUCCESS** including Final Gate. [Original unrounded values](performance-evidence/sh-p018-public-cached-thumbnail-go-cancel/ci-run-39591682608-matched-and-physical.json).
- A later rebase or evidence commit changes source SHA; this historical matched result stays valid **for its exact tested source**, not automatically the new HEAD. New source-exact CI is required by current AGENTS gate. To reduce unrelated merge conflicts, this PR does **not** edit the already complete root `AGENTS.md`; retain that master history verbatim and keep SH-P018-specific numerical history here and in the registry/evidence instead. Production-only inaccessible acceptance **按用户决定跳过（未验收）**; Go ACL and cancellation tests remain mandatory. No Race changes.

---

## SH-P018 · 100k 真实物理 JPEG 翻页→Go 取消同 Runner A/B 验证合同（2026-10-21）

- 已归档真实不达标 BEFORE：原版 `a14f5138` [PG17/CAS 浏览器专项 #39570769600](https://github.com/lazyxu/xdrive/actions/runs/39570769600) 在 Web1440 翻页时观测到 Go Request.Context.Done **161.465ms > 冻结160ms**；不能删除样本、放宽预算或称 6/6 全通过。候选 `fd759d68` [独立真实 100k 专项 #39572509530](https://github.com/lazyxu/xdrive/actions/runs/39572509530) **六次均成功、最慢83.413ms、0废弃响应字节、0遗留 Handler**，但不同源码/CI Runner 的结果不能计算正式提速。
- 新专用 `.github/workflows/sh-p018-paired-next-page-100k.yml` 在**同一个 Runner**由 `HEAD^:web/src/PublicShare.tsx` 和 `HEAD:web/src/PublicShare.tsx` 分别构建真实 Web，Go 测试代码/资源库保持一致；3 对交替原版→候选 / 候选→原版 / 原版→候选，每臂 3 个独立 PG17+LocalCAS 真正 100k 不同 SHA 可解码 JPEG 物理源、16 个真实缓存衍生 JPEG，Web1440 与 390px 浏览器模拟各每臂 n=9 翻页取消。Go 测试 Server 逐事件记录 `Request.Context.Done`，避免累计最大值冒充单次数据。原版超预算样本**保留**而不误判测试夹具 Invalid；候选 160ms、零旧 Handler、零废弃字节、真实 Scope/JPEG/分页数据、原源字节及授权边界严格不放宽。
- 保留生产候选的条件：同条件每个视口取消耗时 P50 至少改善 20%，CPU/RSS 中位不退化超过 25%，Go Handler/HTTP 字节和 Scope 不退化；不成立则拒绝该优化、保留原始结果。不用不同 Runner 计算提升。当前真实配对 AFTER **未测（n=0）**，只能写原独立 CURRENT / 试验候选，须待准确新 HEAD 原六场景、配对实验及完整 77+ CI/Final Gate 全部成功，GitHub clean 后合并；绝不触及 Race。短时视口 JPEG GET 可立即 abort，用户主动的 durable ZIP/上传/下载/同步/删除只能显式 Task Cancel。真实 iOS/Android/PWA、WAN、完整 H264/Live Motion 未测试。生产安全专有验收**按用户决定跳过（未验收）**，代码级认证/范围/撤销及 CI 不跳过。

## SH-P018 · 新合入 Owner/Share 核心后的原版 160ms 请求取消 RED 与最小同步取消候选（2026-10-21）

- 源准确旧 HEAD `a14f513871a3b8552c813ebce16bd580bb6064db` [真实100k SHA不同物理 JPEG、16 个缓存派生图、Web1440/CDP390专项 #39570769600](https://github.com/lazyxu/xdrive/actions/runs/39570769600) **FAILED**，不是成功的六会话：Wide 第1次实际滚动 26.135ms、Wide 第2次 pagehide 26.135ms（累计最大值）；第3次 bounded-next-page 收到实际 Go `Request.Context.Done`，但原冻结最大 160ms 门槛得到 **161.465ms**（超 1.465ms）。不能剔除这次样本、放宽门槛或冒充新完整100k验收。完整 CI 结果和专项分开看。
- 代码级瓶颈候选：Web 分享 `loadFolder` 过去在等待下一次 `publicShareChildren` 结果后才经 React 页面接受/虚拟视口卸载撤销旧 JPEG GET。新候选仅在用户真正导航至不同目录/页游标时，先同步 AbortController.abort 现存未完成的 Share 缩略图消费者，再发有界下一页 HTTP；同页 Refresh 不取消，已有滚动/页面关闭行为不变，持久 ZIP/原文件下载/上传/同步/删除不取消。不触及 Go/CAS、Owner 访问范围、Race、其他媒体/任务。
- **当前候选 AFTER 尚未测量，n=0，提速 N/A**。保留旧 RED；新 HEAD 必须在真实100k CAS Chrome 六会话中满足全部 160ms / 2s / 缓存解码 / Go Handler/零丢弃字节，同时重新通过全 CI，才可继续考虑合并；旧 SHA 绿或其他 runner 比较不能算匹配 A/B。若不能证实收益，继续准确的同runner BEFORE/AFTER，不猜测优化。

## SH-P018 · 已实测原版 100k Public Share 缓存 JPEG 可视取消（2026-10-21）

- 原版 CURRENT 精确源码 1164d9e38535b5ad578554bf839d226f6964e99d；真实 [PG17/Gin/LocalCAS + Chromium 专项 #39549378966](https://github.com/lazyxu/xdrive/actions/runs/39549378966) **SUCCESS**。100000 个不同 SHA 的真实物理 JPEG Original，CAS 已分配 409604096 B；只有 16 个已缓存 JPEG 派生图，不是同时解码 100k 缩略图。Web1440 和 Chromium 模拟 Mobile390 各 n=3，均展示 100 条受限首屏行，实际解码缓存图 6/6/5 与 2/4/4。
- 首 100 项 P50：Web1440 **214.341ms**（226.722 / 214.341 / 200.504ms），Mobile390 **172.579ms**（174.948 / 172.579 / 164.699ms），低于原冻结 2000ms；不是 matched BEFORE/AFTER。
- 6/6 浏览器真实 scroll-out / pagehide / next bounded page 触发 AbortSignal 到 Go Request.Context().Done 和 Handler 退出；最慢 **84.061ms** < 冻结 **160ms**，+160ms 旧 Handler **0**、遗留 body 字节 **0**、横向溢出 **0**；六会话全 PASS。保持 Share-only 授权和零 Owner JWT/API，不因页面淘汰取消持久 ZIP/用户任务。
- 同一原版源码的 [77-job 完整 CI #39549378825](https://github.com/lazyxu/xdrive/actions/runs/39549378825) **SUCCESS**，含 PostgreSQL Go API、Windows/Linux、Desktop/Web、single-commit、Final Gate。原始日志结构化度量完整转录至 [真实 SH-P018 源数据](performance-evidence/sh-p018-public-cached-thumbnail-go-cancel/ci-run-39549378966.json)，另外保留 [原始专项 job log](https://github.com/lazyxu/xdrive/actions/runs/39549378966/job/119054827705) 和 Actions artifact。
- **决策：原版达标，不修改生产热路径；AFTER=N/A，speedup=N/A。** 新证据/最新 master 复基生成新 HEAD，旧 SHA 绿色不可代替新 HEAD 的真实 100k 专项与 77+ CI/Final Gate；本阶段仍 DRAFT，待源码自身重跑和 clean。真实 iOS/Android、安装 PWA、WAN、Desktop Native Share IPC、H264/Live Motion 此专项未覆盖；不触及 Race。生产专有安全验收按用户决定跳过（未验收），源码权限/撤销验证仍必做。

---
## 2026-10-21 · SH-P018 first source-gofmt CI RED, no valid 100k measurement

The first exact work source `541a6cd89de6d54626e64027fdeb529762337a00` [genuine specialized #39548818165](https://github.com/lazyxu/xdrive/actions/runs/39548818165) **FAILED at Go formatting** before invoking the production Web build, PostgreSQL fixture or real 100k cached-thumbnail client. [Full CI #39548818553](https://github.com/lazyxu/xdrive/actions/runs/39548818553) `go-linux` has the same initial format RED; other independent source jobs do not authorize this stage. GitHub log provided six exact gofmt hunks only in `internal/api/sh_p005_browser_physical_jpeg_share_100k_linux_test.go`. Apply those formatting hunks with unchanged test logic, thresholds, Share authentication, current product source and real data shape. This is **Invalid harness / valid baseline n=0**, NOT an actual 100k performance RED. Preserve first RED and rerun NEW exact-head original six-browser Pg17/CAS specialty + complete 77-job CI/Final Gate before any Ready/Merge. All real PageHide/Scroll/Next/160ms budgets remain frozen.

---

# SH-P018 — 100k physical Share cached JPEG viewport→Go cancellation baseline

**Status: Benchmarking / initial n=0 / production unchanged.** Workload owner: public Share read-only FileExplorer, using the already-merged cached-derivative feature [#2258](https://github.com/lazyxu/xdrive/pull/2258). Related [#2205](https://github.com/lazyxu/xdrive/issues/2205). This phase is performance TEST-ONLY and must not touch Account FileExplorer API, its Owner JWT, a real upload/download/delete/copy/sync/ZIP task, Gallery Race or production thumbnail algorithms.

## Baseline first / test identity

- Genuine PostgreSQL17/Gin/Local CAS: **one fresh 100000-individually-SHA-distinct physically stored, independently decodable JPEG-original corpus, +1 distinct unshared sentinel** (physical original CAS allocation checked). Physical original seed timing is excluded from UI/HTTP cancellation timing, and source hash is preserved.
- Precisely **16 separately generated, persisted and index-ready cached JPEG derivative candidates** among the 100000 physical JPEG files, eight on the first 100-item keyset page and eight on the next page. It is NOT 100000 generated thumbnails or a 100k decoded-media test.
- Real production built Web PublicShare UI inside Electron's Chromium Web view, genuine 1440px viewport and Chromium CDP390px mobile viewport, **three fresh BrowserWindow sessions per width**. The latter is mobile-size emulation, NOT a physical phone or OS-installed PWA.
- Each session loads the actual bounded first 100 items (same public read-only Presenter/Provider/IntersectionObserver), verifies at least two real decoded `blob:` cached image elements, and waits for the original Share-only ticket POST + short-lived signed JPEG GET to reach the live Gin streaming handler. No Owner authentication, no request fixture mocking, no original-image GET/32MiB preview, no new generation, no invisible 100k prefetch.
- To observe a genuine in-flight request instead of a GET completing before the consumer abort, a bounded **TEST-ONLY ResponseWriter blocks the JPEG body Write AFTER executing the actual production Go handler's full Owner/share/subtree/revision/SHA/cached-byte authorization** for exactly the first cached file. This holds only its signed thumbnail response; it does not bypass the production handler or insert fake Context cancellation. All other images use normal production HTTP streaming. Slow writer bytes are never emitted while held.
- In each width, browser sessions use three actual consumer lifecycle changes: (1) scroll the real Share virtual scroll owner to bottom, evict the first cached thumbnail; (2) navigate the Chromium window to `about:blank` (real `pagehide`); (3) next 100-item Share page (replaces the previous viewport). The original frontend must propagate `AbortSignal` through signed request → Go `Request.Context().Done` and exit. The client-side marker `/__perf/mark-thumbnail-eviction` is a TEST-ONLY fixture clock and does not cancel the request; actual cancellation must arrive from Chromium itself.

## Frozen performance and correctness budgets BEFORE first run

| Metric | Acceptance threshold |
|---|---|
| Original physical sources | 100000 SHA-distinct JPEG CAS plus one outside original |
| Browser sessions | 1440px n3 / Chromium mobile CDP390px n3 |
| Valid first list render | exactly 100 items, visible bound, page <=2000ms and no horizontal overflow |
| Actual cached thumbnails | at least 2 decoded cached JPEG elements per first page session; never original download |
| Signed media HTTP | >=6 real Share-only thumbnail POST and >=6 GET, six held in-production-handler streams |
| Cancellation | 6/6 Go `Request.Context().Done` and Handler completion, each <=160ms from independent fixture eviction clock |
| Waste at 160ms | 0 active held handlers, 0 stale cached JPEG body bytes |
| Lifecycle | per width scroll eviction, real window pagehide, bounded Share next-page all successful |
| Durable tasks | original download count 0, no generated ZIP/upload/delete or implicit user-owned task Cancel |
| Resource trace | native Chromium Main CPU/RSS sample, real network GET/POST counts and actual source original allocation; no inferred physical iOS metrics |

The **existing original source** before this special benchmark is already implemented and has source-level cancellation wiring, but this exact 100k cached-derivative browser-to-Go workload has no measured valid n3. Therefore **BEFORE/CURRENT = not measured, n=0; AFTER=N/A; improvement=N/A**. Merged [P052/P053/P054](file-explorer-performance.md) Go cancellation on *Owner* JWT JPEG ranges is not public Share proof. Historic [SH-P016](public-share-cached-thumbnail-shp016.md) real 100k JPEG file-page P50 and original SHA download is not cached image in-flight Go cancellation. Do not substitute these different workloads.

If the genuine CURRENT original passes all frozen budgets, leave product code **unchanged** and record Accepted Original. If the true original fails, preserve RED, verify instrumentation and source identity, then freeze original evidence and trial the smallest scoped production performance improvement with SAME runner/data/client/codec/viewport/hardware, alternating matched n>=3 BEFORE/AFTER. Keep only material repeatable improvement with no CPU/RSS/network/request/correctness regression; otherwise reject/revert. No changes to Race.

## Code, sources and artifacts

- Original fixture with opt-in flag: `internal/api/sh_p005_browser_physical_jpeg_share_100k_linux_test.go`. SH-P005 defaults remain byte-for-byte behavior when SH-P018 flag is absent.
- Actual Chromium browser: `desktop/scripts/sh-p005-browser-physical-jpeg-share-100k.cjs`, opt-in `XD_SH_P018_REAL_CACHED_THUMBNAIL=1`; original SH-P005 native-original-download mode unchanged without flag.
- Independent CI: [SH-P018 workflow](../.github/workflows/sh-p018-public-cached-thumbnail-cancel-100k.yml), mandatory exact work HEAD, Pg17+Go1.25+Node22, native Electron/Xvfb, six sessions, machine `summary.json`, raw main/Go logs, Go source identity and resource metrics; new [source regression](../desktop/tests/sh-p018-public-cached-thumbnail-source.cjs).
- Original machine data (including any first-red/invalid harness and runner info) must be copied from successful CI into `docs/performance-evidence/public-share-cached-thumbnail-cancel-shp018/`, plus canonical, central performance registry, six-platform matrix and full historical AGENTS; evidence modifies HEAD and requires **new accurate evidence-HEAD specialized six real sessions and full 77+ CI/Final Gate** before Ready/Rebase Merge. Never mark success from a queued job.
- Real iOS/Android installed PWA, native Desktop Agent Share consumer, true WAN/slow network, HEVC/RAW/LIVP and real Live Motion playback, **independently encoded 100k videos** are NOT measured here. Production environment-only safety acceptance **按用户决定跳过（未验收）**; existing source security/Owner/Share revision/expiry/negative tests and CI stay mandatory.
