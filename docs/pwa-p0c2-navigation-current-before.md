# PWA P0-C2a — Mobile Web Files ↔ Gallery navigation CURRENT/BEFORE

Date: 2026-10-21. This benchmark reuses the original compiled Web React/MUI components and original browser app-navigation interactions. It does not change the 52px App Frame, Server API, Service Worker, thumbnails, or upload implementation.

## Real-browser measurement contract

Opt-in environment flag XD_PWA_P0C2_NAV_BEFORE=1 calls the original desktop/scripts/mobile-web-app-browser.cjs with scenario gallery-ios27-chrome. Three independent Chromium processes each execute three Files→Gallery→Files cycles through the visible user navigation controls, for exactly n=9 per direction. Every measurement starts just before initiating the real UI action and ends after the destination's actual visible File row or Gallery media tile and two animation frames.

Metrics: route-to-visible latency p50/p95/min/max; raw layout-shift values INCLUDING recent input; Web Vitals-compatible shift values excluding recent input; intercepted fixture API request count; 52px App Header geometry; and reused main DOM count. Never report missing/NaN FCP, CLS, route or content as zero or pass. The dedicated workflow exports only numerical p0c2-summary.json, exact source SHA and actual browser version, not user paths, private URL queries, cookies, JWTs or fixture API bodies. Node contract tests also reject missing/duplicate samples and misleading success.

## Explicit limitations and follow-on

The original runner has a strict local bounded API fixture. It does NOT connect to real Go/Gin/PostgreSQL17; n=9 transitions use 3 browser processes, not 9 different machines. It is not a physical iPhone/Safari/installed PWA, not 100k media and not true server Request.Context().Done cancellation. API counts refer to fixture intercepts, not wire requests. Reusing existing browser source means the measured React components and on-screen controls are genuine. P0-C2b must independently measure actual 100k Go/CAS navigation, abandon/cancel to Go Context.Done, HTTP time/CPU/RSS and browser memory, then use same-machine BEFORE/AFTER only if an optimization is implemented. P0-C1 100k decoding timings, P0-C0 first/warm/offline App Shell and this P0-C2a scenario measure DIFFERENT work and must not be subtracted.

No all-gallery preload, no speculative media caching. P1 explicit-opt-in readonly account+instance IndexedDB and P2 bounded thumbnail cache remain deferred. Production-only safety acceptance: 按用户决定跳过（未验收）. Code privacy/permission tests remain mandatory.

Keep Draft until source-exact native Chrome workflow, complete Web/Desktop/Go PostgreSQL API Race/Windows/Linux installers and Final Gate plus fresh clean mergeability succeed. Do not use old SHA green checks.

## 已实测 P0-C2a CURRENT/BEFORE（原始准确 HEAD 322e0c4，2026-10-21）

已从原始 [真实 Chromium n9 专项 #39573729521](https://github.com/lazyxu/xdrive/actions/runs/39573729521) 验证，源提交 `322e0c432c3de8e96ea5f35cd23cf8b0c46270ff`；对应 [全 CI #39573730899](https://github.com/lazyxu/xdrive/actions/runs/39573730899) 已通过。三个独立 Chromium 155 进程，各做三轮完整真实 UI Files→Gallery→Files 操作，合计每个方向 n=9。

| 用户实际导航方向 | 完成可见内容 + 两帧 p50/p95 | Web Vitals-style CLS p50/p95 | 原始 LayoutShift p50（包含用户输入） | 原测试 Fixture API 调用 p50 |
|---|---:|---:|---:|---:|
| Files → Gallery | **733.9 / 894.96 ms** | **0 / 0** | **0.774** | **35** |
| Gallery → Files | **712.5 / 750.74 ms** | **0 / 0** | **0.062** | **11** |

52px App Header 与 main DOM 身份在每个方向 9/9 均得到确认。所有同源可复核的**匿名数值**存入 `docs/performance-evidence/pwa-p0c2-navigation/ci-run-39573729521.json`，并在单一 `docs/performance-test-registry.md` 登记。原始 LayoutShift 包含用户主动切换整屏布局造成的位移；Web Vitals CLS 排除最近用户输入位移，不能把两者混称“意外页面抖动”。这些调用均是**严格 Fixture API 拦截次数**，不是 TCP HTTP 网络请求或真实 Go `Request.Context().Done` 取消证据。

**当前文档所含旧提交的成功记录只是历史 CURRENT/BEFORE**。新 PR HEAD 在后续主线整合后仍必须重新运行 Chromium 和完整 CI/Final Gate，不能根据数字的绝对差异虚构产品提速或回退。P0-C2b 下一阶段单独测真实 100k Physical CAS/Go 请求取消时延及内存/CPU，必要时再对有问题的产品代码实施同条件 BEFORE/AFTER 优化；不得基于此项直接预缓存原图、Live/视频或进入 P1/P2。
