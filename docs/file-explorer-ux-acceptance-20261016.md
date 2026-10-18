# xDrive Files UX acceptance audit · 2026-10-16

## 2026-10-18 · 43 项续查、实际合并与自动化证据边界

**本节是最新的只读复核，不是新一轮设备/大文件测试，也不是代码修复。** 历史阶段的“候选/待合入”仅保留当时事实；本节后的 2026-10-17 表仍按其原始日期理解。冻结源为 `master@04303869ebbe899111aed165e06cd8a040b65bdd`（[#2003](https://github.com/lazyxu/xdrive/pull/2003) P56 已实际 Rebase 合入；GitHub [完整 76-job CI #39084053558](https://github.com/lazyxu/xdrive/actions/runs/39084053558)：25 success / 51 条件跳过 / 0 failure，包含 Web、Desktop、Go、Rootless、single-commit、Final Gate）。该流水线不意味着专项真实 100k 或 OS 安装测试执行，不能把条件跳过当 PASS。

- **已再次核对真实合并状态与源码契约**：F02 [#1766](https://github.com/lazyxu/xdrive/pull/1766) 已 merged，当前 `FileExplorerVirtualSurface.ts` 的 `xDriveFileExplorerAriaTableRowCount`、逻辑项/组 `aria-rowindex` 与 `FileExplorer.tsx` 的 `aria-rowcount/colcount` 接线、`file-explorer-virtual-aria.cjs` 原有回归均存在。F03 [#1769](https://github.com/lazyxu/xdrive/pull/1769)、[#1784](https://github.com/lazyxu/xdrive/pull/1784)、[#1969](https://github.com/lazyxu/xdrive/pull/1969) 均 merged；当前共享 `FileExplorerMenuReasons.ts` 用权威 `disabledReason`，宽屏菜单与 Mobile 长按均有原因文字/无障碍标签，旧 Agent/操作 busy 有独立说明。F04 #1769 已 merged，`FileExplorer.tsx` 及 `FileExplorerPaneKeyboardResize.ts` 保留放大的不可见 pointer 命中区、键盘调整及原视觉分隔条；既有 `file-explorer-splitter-hitbox.cjs` 测试仍在。**这三项无需重复写一套新组件。**
- **逐项 P1 合并核对**：U01 #1789/#1876/#1973、U02 #1791/#1819/#1827、U03 #1784、U04 #1869/#1880、U05 #1802、U06 #1811、U08 #1803/#1949，均经 GitHub 状态证实 merged；M02 #1864、M03 #1838、M04 #1864/#1953、D01 #1969 均 merged。M07 原 #1808 之后，[#1988](https://github.com/lazyxu/xdrive/pull/1988) 又已合入全局 Search 返回 Recent/Favorites；[#1996](https://github.com/lazyxu/xdrive/pull/1996) 已合入空请求假进度消除；P56 #2003 合入全局搜索瞬态计数防跳变。这些更新晚于上一个快照，不能反复当作未修复的代码问题。
- **逐项 P2 合并核对**：U09 #1944/#1950、U10 #1777、U11 #1940、U12 #1953、U13 #1863、M08 #1965 均 merged。U07/U14、M01/M05/M06/M09/M10、D02–D07、P01–P09 的原有实现/自动化边界仍按下表，未凭静态检查升级为真实系统验收通过。部分 P1 真实场景（如 899↔900 连软键盘、403/409 后的实机焦点、跨账号实际 SW CacheStorage）和所有要求物理硬件的检查仍缺独立证据。
- **PR 与分支整理**：本次 GitHub open-PR 查询发现 10 个开放 PR，分别属于 Gallery/性能/Public Share/系统依赖/LocalPush/Race 等**独立**专题，未发现直接相关开放 Files UX PR；检索 `file-explorer`、`mobile-files`、`files`、`fileexplorer` 命名分支均无匹配。已合入 Files PR 均为 GitHub `closed+merged`。不关闭、不删除、不修改独立专题或其分支；没有依据删除任何现有分支。
- **仍待独立验收（不是无证据的“修复完成”）**：F02 NVDA/VoiceOver/TalkBack 真读屏；F03 权限/大选择/禁用焦点实机；F04 高 DPI 鼠标与焦点；U01–U06 慢网/403/409/取消/返回/软键盘；M01–M10 iOS 27 1:1、Safari 地址栏/系统返回/横屏 200%/真实 Touch/分享；D01–D07 Windows CfAPI、旧 Agent、系统 Shell、真 DPI/拖放/会话重连；P01–P09 iOS/Android 系统安装、1–4GiB 系统落盘 SHA-256、后台回收、真实 SW 缓存隔离。具体单项待办仍以紧随其后的完整 43 项表为准。
- **唯一物理发布结论**：[`docs/pwa-s5-acceptance.md`](pwa-s5-acceptance.md) 的七平台实际设备矩阵仍全部 `NOT RUN`、Release `NO-GO`。Linux Chromium、Node/Go 单测、模拟 UA 或 GitHub 完整常规 CI 不得冒充真实安装/屏幕录制/读屏/操作系统文件保存。此轮仅更新验收账本，不变更 52px 全屏 App Frame、900px 分界、Server 权限/排序/Range、Web/Mobile/PWA 共用模型、Desktop Agent 或 SW 安全策略。

---

## 最新验收核查快照：2026-10-17（43 项）

**核查边界**：本快照是合并状态、已有自动化与源码契约的复核，不是本轮重新执行所有测试。已合入不等于实机或发布验收通过。下方历史候选/待合入表述以原日期为准，不再代表最新状态。

- **冻结源基线**：master@42b00133e09bc6b22999d963bcc825840fcf87f3。Mobile Browse Home → Cloud root P46 [#1973](https://github.com/lazyxu/xdrive/pull/1973) 已在 2026-10-17 09:53 UTC 合入；工作分支已查无。其准确 HEAD 2b13fa5309c73571a785c4a7cfd33dbc9003178c 的 [76-job CI #39010324687](https://github.com/lazyxu/xdrive/actions/runs/39010324687) 已完成 25 success/51 conditional skipped，包括 single-commit 与 final-gate。条件跳过不等于物理测试通过。
- **PR 整理**：直接相关未合入文件管理 PR 已查无。其他开放 PR 是独立网络、图库、设备备份、Race、性能等专题，未碰触。此次只更新本文件台账；不修改 Web/Desktop/Server/PWA、900px 分界、52px 全局 App Frame、真实操作与 SW 安全边界。
- **唯一发布基准**：[PWA S5 七平台验收矩阵](pwa-s5-acceptance.md) 仍为 NOT RUN / NO-GO。iOS 27、Android Installed、Windows CfAPI、真实 1–4 GiB OS 下载、读屏和系统分享必须由脱敏真机记录签收；不能拿 Chrome UA 模拟或源码测试代替。

| ID | 优先级 | 当前代码/自动化证据 | 尚缺的独立验收 |
| --- | --- | --- | --- |
| F02 | P1 | #1766 merged；100k 虚拟 ARIA 逻辑行 | NVDA、VoiceOver、TalkBack 真机 |
| F03 | P1 | #1769、#1784、#1969 merged；Web/Mobile/Desktop 禁用原因 | 真实权限/大选择/键盘/长按 |
| F04 | P2 | #1769 merged；宽命中区、键盘 Resize | 真鼠标/高 DPI/读屏焦点 |
| U01 | P1 | #1789、#1876、#1973 merged；首批 Range 确认才提交页面 | 403/超时/Abort/Back/Forward/物理 CLS |
| U02 | P1 | #1791、#1819、#1827 merged；899↔900 选择/草稿/焦点 | 真实软键盘、滚动、搜索与弹窗 |
| U03 | P1 | #1784 merged；200/500/1000 阈值与原因 | 100k 实际选中和聚合反馈 |
| U04 | P1 | #1869、#1880 merged；真实 PostgreSQL Worker 队列/取消测试 | 多端 UI 与最终持久任务收据 |
| U05 | P1 | #1802 merged；403/409/Revision 及草稿测试 | 实际 Server 权限和中文 255 UTF-8 字节 |
| U06 | P1 | #1811 merged；Search → 所在目录 → Back/Forward Chromium 测试 | 真 100k、Server 排序、物理浏览器 |
| U07 | P2 | 完整名称与 Unicode/RTL 截断隔离测试存在 | CJK/emoji/RTL 原生呈现 |
| U08 | P2 | #1803、#1949 merged；未确认/真正空/失败分离 | 离线/403/超时/PWA 实机 |
| U09 | P2 | #1944、#1950 merged；真实 Server 索引回锚 | 大量文件各视图滚动/焦点 |
| U10 | P2 | #1777 merged；缩略图失败/生成/不支持提示 | RAW/Live/视频/100k 网络 |
| U11 | P2 | #1940 merged；属性优先级和无障碍分组 | 真读屏/共享 Inspector |
| U12 | P2 | #1953 merged；短高 200% Chrome 深路径/403 | 原生短横屏/目标选择器可见性 |
| U13 | P2 | #1863 merged；仅授权后重试/撤销/查看任务 | 真持久任务重连/关闭提示 |
| U14 | P2 | Cmd/Ctrl/F2/Delete/Space/IME 229 测试存在 | 中日文 IME、外设混合操作 |
| M01 | P1 | iOS 27 Files 页面适配与 52px App Frame 已存在 | iOS 27 1:1 视觉/动画/明暗对比 |
| M02 | P1 | #1864 merged；动态 viewport 约束 | Safari/Chrome 地址栏/软件键盘 |
| M03 | P1 | #1838 merged；长按/拖放/滚动手势自动化 | 第二指针/OS 返回/实机触摸 |
| M04 | P1 | #1864、#1953 merged；短窗弹窗与目标选择器 | 200% 字体/短横屏全部菜单和批量栏 |
| M05 | P1 | Files 内上一层/浏览器历史/Viewer 返回各有处理 | 浏览器、Installed PWA 与 OS 返回矩阵 |
| M06 | P2 | 单标题与祖先菜单存在 | 深层目录/长路径/快速祖先返回 |
| M07 | P2 | #1808 merged；Browse/Recent/Favorites 独立滚动 | 各集合选择/搜索恢复尚需验收 |
| M08 | P2 | #1965 merged；层级上传及空目录限制说明 | iOS/Android picker 空目录、取消 |
| M09 | P2 | 真字节分享与 16MiB 上限存在 | 接收 App/内存/取消/下载回退 |
| M10 | P2 | 共享键盘/鼠标/触摸处理存在 | iPad 组合输入/鼠标右键/拖放 |
| D01 | P1 | #1969 merged；busy 禁用原因与 Agent capability gate | 旧 Agent 不可用/升级/失败表达 |
| D02 | P1 | CfAPI 文件可用性 Adapter 存在 | Windows 各设备在线/固定/同步状态 |
| D03 | P1 | 双击系统打开、Space Quick Look 测试存在 | 系统 Shell 失败与焦点恢复 |
| D04 | P2 | Finder/Explorer drag-in/out 代码及测试存在 | 未水合文件/跨窗口/取消 |
| D05 | P2 | 共享 Tabs 与恢复/历史模型存在 | Electron 真窗口/键盘/拖动排序 |
| D06 | P2 | 可持久化分隔条及尺寸边界存在 | Windows 125/150/200% DPI |
| D07 | P2 | Agent session/reconnect/transfer 测试存在 | 真实 Agent 断线后提交字节 |
| P01 | P1 | PWA 安装/深链接已有自动化 | iOS27 OS 图标启动 NOT RUN |
| P02 | P1 | Chrome tab/standalone 检测存在 | Android Installed 真实系统 NOT RUN |
| P03 | P1 | 分块上传/重选续传存在 | 系统回收/锁屏/重选 SHA-256 NOT RUN |
| P04 | P1 | OPFS/浏览器/Gin 下载自动化存在 | 1–4GiB 最终系统落盘 SHA-256 NOT RUN |
| P05 | P1 | SW 等待更新/Chromium 多窗口测试存在 | 真安装模式上传/Viewer/编辑保护 NOT RUN |
| P06 | P1 | 公开离线/私有 CacheStorage 排除契约存在 | 跨账号真实 SW 缓存审计 NOT RUN |
| P07 | P2 | 白名单 GET 有界重试逻辑存在 | 真断网/TLS/401/403/429/503 NOT RUN |
| P08 | P2 | 系统分享入口与回退存在 | iOS/Android 系统分享真实接收 NOT RUN |
| P09 | P2 | 持久任务与文件入口已有代码 | Installed 图标冷启恢复 NOT RUN |

**继续顺序**：先 P1 真实 403/409/取消/任务生命周期、899/900 与短横屏、物理 OS 启动/键盘/文件分享；再 P2 大目录、长文件名、跨设备 DPI/拖放与外接输入。M07 选中/搜索集合级恢复尚无实机闭环，不应为恢复滚动而误复活跨 Owner 或旧 Revision 的选择。每个平台需记录构建 SHA、OS/浏览器/模式、可复现步骤、真实字节数/SHA-256（适用时）、脱敏证据与 PASS/FAIL/NOT_RUN；缺失保持 NOT RUN。

---



## U11 · shared file Properties information hierarchy and accessible section headings (2026-10-17)

- **Source-confirmed pre-fix gap:** Shared Web/Desktop FileExplorer listed type and timestamps before the actual path and stored size, placed bytes under Content and current Node Revision under Technical. Its shared `XDriveFilePropertiesDialog` rendered visual caption-only section titles with no heading/group link, and a generic fixed `aria-label="文件属性"` instead of the current file-specific visible dialog title. This is an actionable U11 presentation/a11y improvement, not evidence of an OS screen-reader bug.
- **Frozen GitHub baseline:** `master@8b61f6f26390389cf65ac09b1c990ad287f335ad`, one scoped work commit on `fix/files-u11-properties-hierarchy-20261017`. No directly related active Files PR/branch was found in the open PR/branch queries; unrelated Gallery/LocalPush/System Dependencies/Performance/Race/PWA work is untouched.
- **Scoped candidate:** For single files and folders, place true canonical path, size (existing recursive Server stats for directories), timestamps and existing Revision first in General. Keep file type/availability, media dimensions/duration, SHA-256, Node ID and Owner-scoped source bindings; do not change IDs, ordering of FileExplorer itself, range/session scope, or stat requests. The existing full media `XDriveMediaDetailsInspector` remains the sole dedicated media Inspector. Label the shared Dialog using its current title, expose populated General/Content/Technical sections through actual heading and accessible group IDs, and retain the current two-column responsive grid and compact full-screen dialog behavior.
- **Verification boundary:** New `desktop/tests/file-explorer-properties-hierarchy-u11.cjs` checks source-real canonical priority, no duplicate revision, recursive stats/content, media Inspector reuse and section/title wiring. These are Node **source-contract tests**, not an executed browser DOM, NVDA/VoiceOver/TalkBack announcement, real folder-size network test, iOS 27 pixel comparison, or PWA physical install acceptance. This remains a **candidate, not merged**, until one-work-commit exact-head full GitHub CI/Final Gate succeeds and mergeability is confirmed. Preserve seven-platform S5 `NOT RUN` / Release NO-GO.

### Legacy source-contract migration (same U11 work commit)

The existing `desktop/tests/shared-file-explorer.cjs` historically asserts the now-intentionally-replaced fixed `aria-label="文件属性"`. Preserve the entire original shared Explorer coverage, but update **only** the stale fixed-name expectation to the new `aria-labelledby={titleId}` + `titleId={titleId}` + semantic section heading contract. The first candidate CI is **not valid authority** for this revised tree. Rebuild exactly one work commit on the same fixed parent and require NEW complete exact-HEAD CI; keep Draft until all jobs and final gate pass.

## Current verified follow-up snapshot · 2026-10-16 (post U09-C merge)

**Evidence boundary:** This section reconciles the historical first-red/candidate notes below with
GitHub's actual merged state and exact-work-HEAD CI. The older audit's master and
"pending" prose are preserved as historical observations, **not** the current status.
Originally audited `master@ca30918595da86f8616c5afa4e9eb91911b46de3`; rebuilt without unrelated changes on `master@d997552608de7ed406803bc9163e2546c23caa56`. This follow-up
changes **only this acceptance ledger**, not FileExplorer source, REST, Agent, Server,
virtualization, PWA cache or workflow gates. The current phase is **U09-C merged /
remaining real-server, native-device and AT acceptance**; U09-D is not implemented.

| Scope | Verified GitHub merge and exact-work-HEAD CI | Remaining independent acceptance |
| --- | --- | --- |
| F02 | [#1766](https://github.com/lazyxu/xdrive/pull/1766) merged; [CI #38844280786](https://github.com/lazyxu/xdrive/actions/runs/38844280786) success | Live NVDA/VoiceOver/TalkBack and true sparse 100k collection |
| F03/F04 + U03 | [#1769](https://github.com/lazyxu/xdrive/pull/1769) merged; [CI #38846951712](https://github.com/lazyxu/xdrive/actions/runs/38846951712) success; [#1784](https://github.com/lazyxu/xdrive/pull/1784) merged | Real permission/selected-count feedback, keyboard/long press, high DPI |
| U01 | [#1789](https://github.com/lazyxu/xdrive/pull/1789) merged; [CI #38860447917](https://github.com/lazyxu/xdrive/actions/runs/38860447917) success | Actual 403/timeout/abort-wire/Back/Forward and visible layout |
| U02-A/B/C | [#1791](https://github.com/lazyxu/xdrive/pull/1791), [#1819](https://github.com/lazyxu/xdrive/pull/1819), [#1827](https://github.com/lazyxu/xdrive/pull/1827) merged; exact-head CI [#38866722027](https://github.com/lazyxu/xdrive/actions/runs/38866722027), [#38878240691](https://github.com/lazyxu/xdrive/actions/runs/38878240691), [#38889121074](https://github.com/lazyxu/xdrive/actions/runs/38889121074) successful | OS keyboard, IME, dialog/focus and anchored scrolling on real 899↔900 devices |
| U05/U06/U08 | [#1802](https://github.com/lazyxu/xdrive/pull/1802), [#1811](https://github.com/lazyxu/xdrive/pull/1811), [#1803](https://github.com/lazyxu/xdrive/pull/1803) merged; CI [#38867559110](https://github.com/lazyxu/xdrive/actions/runs/38867559110), [#38872176304](https://github.com/lazyxu/xdrive/actions/runs/38872176304), [#38868671774](https://github.com/lazyxu/xdrive/actions/runs/38868671774) successful | Authenticated Server 403/409/revision/timeout and device focus/return |
| U09-A/B/C | [#1842](https://github.com/lazyxu/xdrive/pull/1842), [#1846](https://github.com/lazyxu/xdrive/pull/1846), [#1852](https://github.com/lazyxu/xdrive/pull/1852) merged; CI [#38896207409](https://github.com/lazyxu/xdrive/actions/runs/38896207409), [#38902503868](https://github.com/lazyxu/xdrive/actions/runs/38902503868), [#38905127667](https://github.com/lazyxu/xdrive/actions/runs/38905127667) successful | Same Node's *new* ordinal after sort needs authoritative identity lookup; real 100k Server, Columns, physical FPS/CLS |
| U10/M03/M07 | [#1777](https://github.com/lazyxu/xdrive/pull/1777), [#1838](https://github.com/lazyxu/xdrive/pull/1838), [#1808](https://github.com/lazyxu/xdrive/pull/1808) merged; CI [#38851816532](https://github.com/lazyxu/xdrive/actions/runs/38851816532), [#38891421189](https://github.com/lazyxu/xdrive/actions/runs/38891421189), [#38870644944](https://github.com/lazyxu/xdrive/actions/runs/38870644944) successful | RAW/Live media, OS gesture/swipe, physical section restoration |

**Full-suite verification:** U09-C [CI #38905127667](https://github.com/lazyxu/xdrive/actions/runs/38905127667)
and U02-C [CI #38889121074](https://github.com/lazyxu/xdrive/actions/runs/38889121074)
each returned 76 jobs (25 success, 51 conditional skips, 0 failures),
including `single-commit` and `final-gate` success. Skipped conditional workloads
and simulation cannot be reported as completed real 100k / hardware tests.
Related previously merged Files PRs were closed at this snapshot; targeted
branch searches found no matching old F02/F03/F04/U01/U09-C/M03 branches.
No branch was deleted in this review, and unrelated open PRs were not touched.

**Acceptance classification by supplied ID (do not conflate these levels):**

- **Merged implementation and selected automated tests, not device sign-off:**
  F02–F04; U01–U03, U05–U10, U14; M03, M07.
  U07 is covered by the existing Unicode/RTL fix;
  U14 by shared IME guards. The ledger rows below retain their additional edge cases.
- **Existing source contract inspected; required live/visual scenario still open:**
  U04 (durable queue vs terminal Server receipt), U11 (Inspector screen-reader hierarchy),
  U12 (deep/short-height destination picker), U13 (retry/undo/durable-task behavior),
  M01–M02, M04–M06, M08–M10 and D01–D07.
  Do not claim these fail simply because native hardware is unavailable.
- **P01–P09:** browser/Node/Chromium test infrastructure exists, but actual iOS 27,
  Android Installed and desktop installed PWA launch, 1–4 GiB *OS-saved* SHA-256,
  foreground/background upload recovery, private SW storage inspection and update
  protection remain **NOT RUN** on real installations. Preserve the seven-platform
  S5 matrix and **NO-GO** in [PWA S5 acceptance](pwa-s5-acceptance.md).
- **U09-D remaining functional design:** preserve exact original selected Node
  through a *changed* authoritative Server sort/group requires a stable ID-to-new-index
  lookup; do not guess the new ordinal from the previous offset, scan the entire
  100k collection client-side, or rewrite Server ordering. Existing U09-C
  correctly prevents attaching a selected ID to a replacement ordinal.

**Next bounded work (not yet delivered):** independently exercise real
authorization/revision and task lifecycle (U01/U04/U05/U06/U12/U13),
then same-identity reindex with an authoritative Server capability (U09-D),
then physical 899/900, iOS 27 Files 1:1, NVDA/VoiceOver, Windows CfAPI and
all seven S5 installed/browser platforms. Preserve the 52px App Frame,
900px breakpoint, separate Files Back vs browser/Viewer Back,
Web/Mobile shared REST/controller/ranges and Desktop native default Open.
Do not replace an unavailable native check with Android user-agent emulation.

## Evidence level and scope

Provider: GitHub `lazyxu/xdrive`. Fixed audited baseline:
`master@e3bdbcd9317ec82e54a7cb3bc75ae6680c2f90ea`; this follow-up
is isolated to `fix/files-batch-disabled-reasons-f03-u03-20261016`.
The checked working PRs at audit time (#1783, #1782, #1781, #1780,
#1748, #1685, #1589, #1185) concern other subjects. None is closed by this
audit. Do not delete those branches.

**The table is not a claim of completed physical-device testing.**
Code-path present means the corresponding implementation and/or test
was inspected; full functional acceptance additionally needs the named
scenario and its evidence. For test-execution and CI status use the exact
HEAD of this PR, not success from unrelated commits. Mobile Web/PWA use
the same Web business API; Desktop invokes Agent where applicable.
Keep the independent 52px global App Frame and the 900px breakpoint.

| ID | Code evidence / inspection outcome | Remaining acceptance |
| --- | --- | --- |
| F02 P1 | Shared Details ARIA full rowcount/group row index and Grid setsize/posinset; `desktop/tests/file-explorer-virtual-aria.cjs` covers 100k logical items | NVDA, VoiceOver, TalkBack and sparse live DOM |
| F03 P1 | Shared and mobile context menus use `FileExplorerMenuReasons`; **this PR patches previously missing selected-items More explanation** | Real permission responses and keyboard/long-hold screen reader |
| F04 P2 | Shared 6/8px separators retain geometry, widen invisible targets and support arrows/Home/End; `file-explorer-splitter-hitbox.cjs` | Real pointer, keyboard focus and high DPI |
| U01 P1 | Shared navigation/controller stages first counted range before committing; new mounted-hook regressions cover delayed 403/timeout and superseded 403/success without replacing prior rows | Browser Back/Forward, real permissions, aborted HTTP wire, focus and anchor |
| U02 P1 | Real compiled Chrome first-red in CI #38882962206 confirmed unsubmitted Search text and route survive 899→900→899 but focus is lost and caret [2,5] resets to end [10,10] at both responsive boundaries; Web common-owner focus handoff is proposed | Repaired exact-head browser RED→GREEN/full CI pending; actual Safari/Android, other dialog/scroll/scope cases remain |
| U03 P1 | Server-backed selection limits 200 mutation / 500 tags / 1000 download; mounted 257/1001 tests extended by this PR | Real 100k selection, disabled aggregate feedback and full action matrix |
| U04 P1 | `FileExplorerActionFeedback` and `FileOperationLifecycle` distinguish queued/running/cancel-requested/completed/failed | Correlate actual Server durable task receipt and terminal outcome |
| U05 P1 | Shared `FileNameDialog`, Web rename adapter and real Chrome intercepted 403→409→200 scenario | Real Server 403/409, stale Revision and UTF-8 boundary with retained focus |
| U06 P1 | Shared Search/Navigation and real MUI renderer fixture exist; U06-specific native Chromium Web CI gate added (outcome pending) | Verify synthetic 4096-item sparse Search → enclosing folder → Back/Forward, conditions/sort/group/selection/anchor; real authenticated Server and physical platform scenarios remain |
| U07 P2 | Existing `dir=auto` and isolated full item names; Unicode-specific source regression | RTL/CJK/emoji native rendering and accessibility |
| U08 P2 | Shared StatePanel remains the only component; Mobile zero-count now distinguishes pending Search, Search error, zero Search, true empty folder and Trash | Real offline/403/timeout and physical installed PWA need authoritative browser evidence |
| U09 P2 | Shared `FileExplorerVirtualSurface`, grouping and view snapshot/restoration | Anchor/selection across Grid/Details/Columns/Groups at 100k |
| U10 P2 | `FileExplorerThumbnailVisualState` distinguishes eligible failed loading without extra original request | Real RAW/video/Live failure and 100k viewport pressure |
| U11 P2 | `FilePropertiesDialog` plus media inspector adapter | Screen-reader ordering and hierarchy across ordinary/media files |
| U12 P2 | Shared `FileExplorerDestinationDialog` and destination-action tests | Short/landscape window, deep path and permission denial |
| U13 P2 | Shared feedback + task-view callback and dismiss-independent tests | Server retry, undo capability and durable-task continuity |
| U14 P2 | Shared keyboard resolver and real Web/Desktop/Mobile row handlers now fence composing key events and legacy 229; direct Node tests cover three profiles and pane keys | Actual Chinese/Japanese IME, Cmd/Ctrl, keyboard right-click and mixed external input on physical hardware |
| M01 P1 | iOS27 Mobile Files dedicated presentation/document contract | Side-by-side real iOS27 Files light/dark screenshots and gestures; not run |
| M02 P1 | `useMobilePanelViewport` and Mobile ResizeObserver exist | Safari/Chrome URL bar, software keyboard, focus and post-keyboard anchor |
| M03 P1 | Shared mobile gesture and pointer-drag code, touch-drag tests | Multi-pointer, OS swipe-back, long-hold then scroll, actual touch hardware |
| M04 P1 | Safe-area and 44px menu target rules exist | Short landscape and 200% text zoom, no clipped destructive actions |
| M05 P1 | Shared workspace navigation and explicit Viewer/Files paths | Real browser/PWA/OS Back semantic matrix |
| M06 P2 | Single folder title and on-demand ancestors; iOS27-10D tests | Deep CJK path and rapid ancestor navigation |
| M07 P2 | Recent/Favorites/Browse sections now preserve separate bounded virtual scroll anchors in account-scoped v1 state; existing Browse folder scroll stays independent | Per-section selection/search history, physical iPad/iOS/Android return still need verification |
| M08 P2 | Directory upload controller and picker support exist | iOS/Android relative path, empty folder, multilevel cancellation limitations |
| M09 P2 | `nativeFileShare` existing byte-sharing and 16MiB gate | System receiving apps, cancellation, fallback and device memory |
| M10 P2 | Keyboard/pointer handlers are shared where supported | iPad mouse/keyboard/drag/touch simultaneous input |
| D01 P1 | Desktop Agent capability gates and reconnect tests exist | Real legacy Agent missing capabilities, offline and upgrade-required messaging |
| D02 P1 | File availability indicator and CfAPI-related Desktop integration exist | Actual per-device CfAPI local/online/pinned/sync/error state |
| D03 P1 | Native open and Quick Look tests distinguish double click and Space | Open failure, missing shell program and focus restoration |
| D04 P2 | Native drag-out and drop tests exist | Finder/Explorer, unhydrated local file and cross-window cancel |
| D05 P2 | Shared navigation tabs and persisted session/history code exists | OS-native keyboard tab and restoration end-to-end |
| D06 P2 | Shared splitter width bounds/persistence and CSS responsive layout exist | Windows 125/150/200% DPI and short-height native Electron windows |
| D07 P2 | Agent session/reconnect and transfer tests exist | Actual Agent restart, stale progress rejection, committed bytes |
| P01 P1 | PWA install/auth/deeplink routes and Chrome test contracts exist | OS-icon launch from physical iOS27 Home Screen, not run |
| P02 P1 | Chrome tab/standalone modes are distinguished by runtime probes | Actual Android Chrome Installed vs tab behavior, not run |
| P03 P1 | `pwaUploadResume` and Server 8MiB chunk resume exist | Actual app swap/lock/kill/reselect on iOS/Android, not run |
| P04 P1 | Browser download/OPFS and real Gin/Chrome tests exist | Physical 1–4GiB final filesystem length and SHA256, not run |
| P05 P1 | `pwaUpdates` and real Chromium dual-window waiting-worker test exists | Actual iOS/Android installed uploads/Viewer/editor/multi-window |
| P06 P1 | Public SW offline asset boundary and private API exclusion are documented/tested | Installed cross-account private CacheStorage audit on actual deployments |
| P07 P2 | `pwaSafeReadRetry` bounded safe-GET retry and cancellation tests exist | Real network/401/403/429/503/certificate/timeout matrix |
| P08 P2 | `nativeFileShare` exists; no new background share pipeline | Physical system share sheet target/cancel/permission/fallback |
| P09 P2 | Foreground durable-task reconciliation and transfer entry exist | Cold installed icon launch returning to files and task state |

## Ordered handoff

1. F02/F04, U07/U10: baseline implementation found; do not duplicate. Mark **source inspected**, not physical passed.
2. F03/U03: finish this one-commit limited Mobile selected-items reason repair and mounted 257/1001 regressions. Demand exact-head CI.
3. U01/U02/U05/U06 and M02/M03/M05: execute original-browser transition and history tests using the existing shared workspace; repair only a reproducible first-red.
4. D01/D02/D03/D07: require native Electron/Agent session and file-locality fixture or physical Windows.
5. P01–P09: keep the S5 physical installation matrix **NOT RUN/NO-GO** until real signed-off device evidence. `docs/pwa-s5-acceptance.md` remains the release gate; never infer OS behavior from Android UA emulation.

Do not alter unrelated PRs, the 900px breakpoint, Server sort/group index,
permission limits, real download bytes, PWA private SW cache rules, Desktop
system-open semantics, or the shared 52px global title bar.

## U01 follow-up · committed-first-page regression (2026-10-16)

New deterministic hooked-controller tests mount the **original** `useXDriveCloudFilesController`
implementation. They intentionally hold a real first-page `port.getRange` Promise
behind a responsive Files navigation, reject with 403/timeout, and race stale 403/
success after a newer authorized folder commits. Assertions require the old
folder's *real items and crumbs* during pending/error, no stale false error,
no pending overwrite, and a settled loading indicator. No implementation,
Server contract, scroll host or navigation redesign is added. This is not
a screenshot/frame metric, end-to-end auth decision or actual HTTP cancellation:
those gates remain open. Exact-HEAD Desktop CI and full final-gate are required
before this test is credited as passed.

## U02 · Genuine selection-loss browser regression and scoped candidate

- Original source: CI [#38861059007](https://github.com/lazyxu/xdrive/actions/runs/38861059007)
  observed Mobile 899px selected Node 102 with `aria-pressed=true` and one
  bulk toolbar, then a 899px remount with no selected Node and no toolbar.
  No unknown API, console error or route change; wide Details DOM position
  originally lacked a row mount so this part of that first check alone does
  not prove selection loss.
- The original-browser script was corrected **only** to make the same real
  Node visible in existing wide Details via the real View menu before reading
  `aria-selected`. Its exact regression source Blob must remain unchanged
  through production repair; browser fixture responses stay unchanged.
- The candidate retains validated selected identities and their original
  item snapshots in the shared Web workspace through a responsive component
  remount. Mobile's first mount may consume the restored state, while a
  subsequent scope change invalidates it. Wide FileExplorer uses its existing
  controlled selectedIDs/onSelectionChange contract; Desktop stays untouched.
- No second HTTP controller or full folder materialization, permission
  escalation, PWA cache mutation, 900px breakpoint or 52px App Frame change.
  The 100k logical selection memory budget, cross-width editing dialog,
  search and focus/anchor cases remain separate acceptance gates. CI/red→green
  and PR merge must be verified on the exact submitted head.

## U02 nested Inline List selection · 899↔900 (2026-10-16)

The shared `WebFileExplorer` Mobile inline child range store must reset at
the 899/900 presentation boundary, but selected Node provenance must **not**.
The previous `selectedMobileScopeRef` compared the breakpoint-bearing
`inlineScopeKey`, clearing the selected child Node/revision/ancestor path when
Wide first mounted. A new actual-source `file-explorer-inline-store.cjs`
regression exercises a selected item in a **sparse 100k-child branch**,
tears down Mobile's inline child page at 900px, checks the original Node
Revision and containing path still resolve via the existing shared controller,
returns to 899px, and independently checks the account-B privacy reset.
The production repair changes only this bounded selection provenance scope
to existing `responsiveSelectionScope`; the inline store still resets
per presentation and never preloads the 100k directory. This is a deterministic
source-mounted test, not physical iOS or fully authenticated Server evidence.
Require the own exact-head full CI/Final Gate for the candidate.

## U06 · Shared production-renderer Chromium search return gate (2026-10-16)

The existing `desktop/scripts/file-explorer-search-return-browser.cjs` and
`file-explorer-search-return-browser.tsx` already mount the actual shared MUI
FileExplorer, Workspace, Navigation, Search filters and sparse VirtualCollection,
using a synthetic 4,096-result Server-range boundary. Previously the acceptance
ledger showed their source presence without a U06-specific exact-head browser
execution result.

This test-only change wires the existing runner into the **Web** CI job for
`test/files-search-return-chromium-u06-` branches, running native runner
Chrome/Chromium with a pinned Playwright-core module and verified PR-source
commit. It covers grouped deep Details/Grid return, Search→containing folder
→Back/Forward, query/filter/sort/group stability, selected IDs, scroll and
logical anchor restoration, responsive Grid, failed count/deep-window retry,
superseded scroll/new query, and changed result identities. Synthetic test
screenshots and the result JSON are retained as CI artifacts without private
user data. The ordinary CI final-gate still requires the Web job and other
required build/integration jobs to pass.

**At creation: NOT RUN / no passing evidence yet.** A first-red must be
classified as test harness failure or an actual original-product regression
before a production repair. This synthetic 4,096-item test does not prove real
authenticated Server 403/409/timeout, actual 100k files, hardware Web/Mobile
Web/Desktop or iOS/Android installed PWA navigation. The latter remain
explicitly unaccepted, and no file navigation, Server, REST/IPC, 900px breakpoint
or 52px App Frame production behavior changes in this test-only PR.

## U08 · Distinguish empty directory from zero Search and request failures (2026-10-16)

A `totalCount=0` in dedicated Mobile Files previously used a single
`这里还没有文件` text for an empty directory, empty Trash and a Search that
had zero results or whose first count failed. Reuse the existing exported
shared `XDriveStatePanel` with a single zero-state owner. For Search,
distinguish `resultCount=null` still pending, a genuine error (retaining
the existing Server error/Retry control), and authoritative zero results.
A root with a real empty first page uses `此文件夹为空`; Trash has its own
`最近删除为空`. Preserve the existing loading refresh overlay when older
nonempty content is committed; do not replace old rows with an empty spinner.
This is **presentation-only**: no permission inference from an unknown
state, REST, Server sort/groups, virtual range, SW CacheStorage or uploads.
Actual offline/403/network timeout and physical iOS/Android PWA remain
separate real browser/device gates. Require exact-head CI and Final Gate
before Ready/merge.

## M07 · Recent/Favorites independent virtual scroll anchors (2026-10-16)

Source inspection established a concrete bug: `changeSection` restored the
single Browse folder scroll but unconditionally set the next Recent or
Favorites scroll offset to **zero**. This discards each collection's logical
virtual row every time the user switches between rail tabs.

Reuse the EXISTING Mobile Files per-account v1 localStorage record, adding
only optional, bounded `recentScrollTop` and `favoritesScrollTop`
presentation offsets. Older records keep their exact default decode.
The single existing 200ms scroll-flush timer also writes rail offsets,
so no extra listener/interval or 240/100k item materialization appears.
Changing a section flushes the prior offset before changing the one shared
scroll host. Browse `folderID/scrollTop` and its authenticated navigation
remain independent, and the new account's storage key does not restore
another account's offsets. Mounted source tests cover 240 virtual items,
Recent→Favorites→Recent→Favorites restoration, Browse state isolation,
old state compatibility and bounded invalid offsets. No Server API,
selector limit or 900px breakpoint changes. Per-section selected-item
and Search states remain separate, unaccepted M07 subcases; real installed
PWA/iOS27/Android physical navigation remains NOT RUN.

## U14 · Shared FileExplorer IME composition keyboard isolation (2026-10-16)

Original-source inspection found the shared shortcut resolver still mapped
composing Enter/Space/F2/Backspace to File Open/Quick Look/Rename/Back.
Direct wide Web/Desktop and Mobile item rows, inline Rename, path editor and
focusable splitters did not consistently guard composing keys; type-to-select
and Mobile root native-isComposing checks were insufficient.

This bounded fix adds ONE exported shared typed composition guard for
native/synthetic isComposing and legacy keyCode=229; the original shared
shortcut/numbered-tab and MUI row/root/inline/path/splitter and compact
Mobile Files row/root handlers invoke it before file actions. Non-composing
shortcuts, native Desktop system double-click, Space Quick Look, existing
permissions, 900px responsive boundary, 52px App Frame and 100k virtual
collection are unchanged. Existing Desktop tests inspect actual handlers,
transpile the real keyboard helper and exercise Windows/macOS/Web profiles.

**Exact-HEAD CI: NOT YET RUN at PR creation.** Physical Chinese/Japanese IME,
actual assistive technology, iOS27/Android installed PWA and external keyboard
validation remain NOT RUN until independent authentic device evidence.

## U02-B · Pending Mobile Rename draft across 899↔900 (2026-10-16)

The real Web adapter renders compact <MobileFiles> or wide <XDriveFileExplorer>
mutually exclusively at the existing 900px boundary. Source audit finds compact
Rename ownership in MobileFiles local renaming state and the corresponding
FileNameDialog beneath that conditional component, while shared WebFileExplorer
owns the actual authenticated rename request and current Node/revision.

This **first-red/test-only** phase adds a bounded native Chromium regression
to the existing original **built-Web** Files iOS27 runner (no copied presenter
or added API). It opens the genuine context-menu Rename dialog for original
Server-fixture Node 101 at 899px, types a draft **without submitting**, crosses
900px, returns to 899px, and requires the exact draft/dialog to survive, while
making zero PATCH requests and retaining one FileExplorer scroll owner. It runs
only for the focused U02-rename PR branch, in addition to the current base
375/390/899/900 Files runtime, selection and navigation cases. Evidence
includes the test-only original source SHA, 3 viewport screenshots and the
synthetic-result JSON.

**At test-only PR creation:** first-red NOT RUN. Do not claim a production bug
solely from component source. If original compiled Chrome confirms RED, preserve
the test unchanged and make the narrowest parent-owned rename-state repair
in this same fixed-parent single-work-commit branch, then require entirely
new exact-head complete CI. No changes to iOS 27 visual, 52px App Frame,
900px threshold, Server permissions, Web/Desktop shared backend or 100k
virtualization. This does NOT prove real Safari/Android, physical IME, actual
403/409 after a viewport transition or Desktop/OS-specific hardware.

### Original built-Web first-red evidence and repair scope

- **Exact original test-only HEAD:** `10acd3a98694e51e0878ded0ecd73fd278e3edca`, [full CI #38877483489](https://github.com/lazyxu/xdrive/actions/runs/38877483489), Web job 116895930346, real Chrome built from original Web App. Original 899px had precisely one renamedraft `待提交-跨断点重命名.txt`, route `#/app/files?dir=1`, single scroll host and zero PATCH. At 900px original dialog count=0/name=null, and returning to 899px was still missing. Precisely **two** new U02-B assertions failed; the original selection/navigation/403/409 cases passed, with zero unknown requests/page errors. This is a genuine presentation-lifecycle bug, not a fixture or Server error.
- **Immutable original first-red browser runner blob:** `4bafb3d19af125f41c28647234ddae1b3be7ed48`; unmodified focused Node test blob `b94fdaa84714c5afe181abd428f51c3ea68cf855`. Neither assertion or runner changes in the repair.
- **Minimal repair:** one common WebFileExplorer owner holds only the pending Mobile rename item/scope and renders the EXISTING shared XDriveFileNameDialog outside the 899px/900px conditional. MobileFiles delegates the actual Web rename-dialog opening through one optional presentation callback, while retaining its existing local fallback for independent consumers/tests. The original Web renameItem, Server ACL, canonical Node/revision, dialog validation/error/focus, 200-item mutation limit and transport are unchanged. Scope fences the draft to authenticated account, directory, Search/Trash and exact virtual collection; owner/scope change closes it rather than storing private content.
- **Delivery:** Repair candidate must pass entirely new exact-head 76-job CI/Final Gate, including the frozen original U02-B browser assertion from RED→GREEN. Real iOS27/Android/installed PWA and physical 403/409 or IME across resize remain NOT RUN.

## U02-C · Unsubmitted Search focus/caret on 899↔900 (2026-10-16)

- **Related work reconciled:** #1791 original selection and #1819 pending Rename draft were exact-head CI green and Ready/Rebase-merged, with their old branches gone. #1822 P26 nonessential loading-status suppression was exact-head CI green and merged/cleaned before this new branch. Preserve one underlying Web search state/API; keep unchanged 900px breakpoint, 52px App Frame, Server sort/group indices and shared VirtualCollection.
- **Source-supported unverified hypothesis:** WebFileExplorer alternates real MobileFiles and XDriveFileExplorer components on breakpoint. Search draft value lives in the shared Web workspace, but the focused DOM input and selected caret range are presentation-local. Switching width while editing may drop focus and caret without losing the value.
- **Immutable first-red plan:** add only one new branch-gated case to the *original compiled-Web* Chromium Files iOS27 script. On authorized existing Server fixture root, focus Mobile Search input, type a non-submitted draft, select a specific UTF-16 character range, then cross 899→900→899, checking the draft, true document.activeElement, caret range, one virtual scroll owner, unchanged route and **zero new Search API requests**. Preserve all existing original 375/390/899/900, U02 selected-node/rename, P9/P10, dialog and navigation regression cases. Record real screen snapshots and source hashes.
- **At test-only PR creation:** CI NOT RUN; do not infer a defect merely from React remount. If actual first-red reproduces focus/caret loss, preserve this exact browser script + test blob unchanged, and amend one frozen-parent work commit with the narrowest shared Web focus handoff (not a second Search controller, cache or retained hidden renderer). Require fresh exact-head complete GitHub CI/Final Gate and RED→GREEN. Physical iOS27/Android Installed PWA, OS keyboard, VoiceOver/TalkBack and genuine 100k are separate NOT RUN.

### U02-C first CI was an invalid oracle, not product RED

- Test-only HEAD `984e96a66433b53be508f9aa9973bd482ace83e4`, [CI #38882211736](https://github.com/lazyxu/xdrive/actions/runs/38882211736), Web Chrome step failed **before the first focus assertion**. Its `locator.waitFor` erroneously expected literal `input[aria-label="搜索全部文件"]`; the actual MUI input has a correctly exposed accessibility-tree `textbox "搜索全部文件"` but its label is not necessarily a literal input DOM attribute. No new Search or external API requests, page errors or production exception; cannot classify this result as focus loss.
- Rebuild exactly one test-only work commit on the SAME frozen parent with only the browser test selector corrected to the real existing `data-mobile-files-search-region input` and wide `input[placeholder="搜索全部文件"]` DOM anchors. Keep all draft, selected range, true `document.activeElement`, request-count and route assertions unchanged, preserve Node source-contract Git Blob `0241129ab116b612df3e3efe6c90cf8a0d8477f2` byte-for-byte. Require a NEW exact-head Chromium run before concluding RED or modifying production. Do not use the invalid run for merge.

### U02-C exact original production Chromium First-red and minimal correction

- **Corrected test-only HEAD** `dcc1b1929583de421bacd613006eae9ee782bcc2`, [CI #38882962206](https://github.com/lazyxu/xdrive/actions/runs/38882962206), original compiled Web Chrome job 116914278902: **exactly two first-red checks**. At 899px the original Mobile Search textbox had focused value `跨断点未提交搜索草稿` and character range [2,5]. At 900px original wide Search had the same value and current route `#/app/files?dir=1` with one scroll owner, but **focus=false, selection [10,10]**; 899px return also focus=false, selection [10,10]. No new `GET /api/v1/search` (`initialSearchCount=0, actual=0`), unknown request, app page error or console error. Original selection/rename and layout/navigation cases passed. This is a measured original-source focus-lifecycle defect, not a Search/Server data error.
- **Freeze unchanged first-red tests:** original Chrome runner blob `b880a30538a410f76f5027de5c1355b12d75bbfa`, original Desktop source regression blob `0241129ab116b612df3e3efe6c90cf8a0d8477f2`. Neither assertions nor actual Server fixtures are modified during the production repair.
- **Scoped fix candidate:** only `web/src/WebFileExplorer.tsx` long-lived Web workspace tracks ephemeral `document.activeElement` and native input caret selection while the real Search field is focused; on the true 899/900 mode transition it focuses the newly mounted corresponding real input with `useLayoutEffect` before paint and restores the precise caret range. Ordinary focus moving to other controls clears pending handoff. The root-scoped native select listener is cleaned up, and the focus state is guarded by the same existing responsive account/folder/Search/virtual collection scope. No new Search controller/REST, persistent private draft, hidden renderer, extra server request, injected keyboard event, animation delay, virtual collection or 900px/52px shell change.
- **At repair commit creation:** accurate-head repaired full CI is NOT YET RUN. Need the immutable original built-Web RED→GREEN, Desktop/Go Linux/API/Windows/full final-gate and one-work-commit before Ready/Rebase Merge. Native iOS27/Android/installed PWA, actual OS keyboard, NVDA/VoiceOver and 100k physical remain NOT RUN.

### First scoped production candidate rejected; next candidate uses native focus events

- First repaired head `2c11d723313a96ae18abc2f14afdb025072525fc`, [CI #38884039840](https://github.com/lazyxu/xdrive/actions/runs/38884039840), real built-Web job 116917550221 **failed**, and is NOT valid acceptance. The candidate transferred focus across both widths but changed original Search controlled input behavior: at 899px immediately after typing the test's text snapshot was an empty draft, selection [0,0], and the same empty state followed at 900px and 899px. Existing server request count stayed zero, with one scroll owner and no page errors. Therefore it is a product regression introduced by this candidate, not a passing red→green; do not merge or reuse its CI status.
- Rebuild the same ONE work commit on original frozen base and keep the original valid first-red runner blob `b880a30538a410f76f5027de5c1355b12d75bbfa` and Node contract blob `0241129ab116b612df3e3efe6c90cf8a0d8477f2` unchanged. Remove `onFocusCapture`/`onSelectCapture`/`onBlurCapture` from the shared React Box: these were the only newly introduced event hooks on the React search-input tree. Use only root-scoped native `focusin`, `select` and `focusout` listeners to sample actual active Search input and caret without participating in React synthetic input event propagation; unbind every listener on cleanup. Retain pre-paint `useLayoutEffect` handoff, existing authenticated scope and no new Search controller/REST/cache.
- **Second candidate status at creation:** exact-head full CI/browser RED→GREEN NOT RUN. If the original Search draft is again changed or focus/caret is not retained, mark this candidate failed, diagnose the original useEffect/input lifecycle before another source revision. Keep focus test immutable, 900px breakpoint unchanged, and all physical mobile/PWA/VoiceOver tests NOT RUN.

### Second production candidate rejected; passive breakpoint observation replaces input listeners

- Second production candidate `0c3318a44441baabcdf74a71fdadb9256e030426`, [CI #38884806258](https://github.com/lazyxu/xdrive/actions/runs/38884806258), exact-head original built-Web job 116920264488, also FAILED: the native `focusin`/`select`/`focusout` input listeners retained focus through both widths but the controlled draft was empty even at initial 899px, caret [0,0], and three original Search assertions red. Real Server Search requests remained zero and prior unrelated Files checks remained intact. This is a rejected candidate, NOT release evidence. Both attempted input-focus event hooks proved intrusive; do not repeat them.
- Third bounded candidate observes **only the existing media-query breakpoint's `change` event in capture phase**, so it reads actual input focus and UTF-16 caret once while the old presenter remains visible and never attaches events to React-controlled Search input elements. After React commits the actual new 899/900 presenter, the shared Web layout effect transfers focus and caret before paint; it is scoped to current account/folder/Search/virtual-collection, has no background polling or Search submit, and removes the media-query listener on cleanup. Preserve original Chrome test runner Blob `b880a30538a410f76f5027de5c1355b12d75bbfa` and original Desktop test Blob `0241129ab116b612df3e3efe6c90cf8a0d8477f2` BYTE-FOR-BYTE, along with frozen source parent.
- **Third candidate exact-head CI has not run at this point**. Do not infer success from lint/build or earlier failed runs. Require original corrected 899px draft=true/focus=true/caret=[2,5], both new widths with same data and zero Search GET, then all full GitHub CI/final-gate before Ready/Rebase Merge. If this candidate fails, leave PR Draft and record the failure rather than weaken the immutable first-red assertion.

### Third candidate genuine browser failure and fourth bounded lifecycle handoff

- Third candidate `275f11e5bf4fb7a12ff1de5529e1db835eb00911`, [CI #38886138439](https://github.com/lazyxu/xdrive/actions/runs/38886138439), original built-Web Chrome job 116924222848: the initial accepted 899px Search draft and focus/selection [2,5] were restored compared to rejected input-event candidates, but the original two breakpoint focus/caret assertions remained RED at 900px and 899px return. The draft, route, one scroll owner and zero Search GET all stayed correct. The media-query-only capture did not produce a usable focus handoff. **Do not merge or claim pass.**
- Fourth narrowly scoped candidate keeps unchanged `WebFileExplorer` shared Web Search state and immutable original browser/Node test Blobs. It adds a `useLayoutEffect` cleanup on the outgoing old responsive view to capture `document.activeElement` and the Search UTF-16 selection before React replaces the real input. The new layout effect consumes that temporary snapshot and focuses/sets selection on the newly mounted corresponding real input, before paint. The earlier capture-phase breakpoint listener remains as a fallback only. Neither old nor new Search input has synthetic/native focus/select handlers, avoiding the proven draft reset; no additional REST, virtual list, private localStorage or document scrolling.
- **Fourth candidate acceptance still pending exact-head CI:** unchanged original 899px draft focus selected [2,5] AND both 900/899 handoffs must pass with no Search GET; complete 76-job CI, Web/Go/Windows/Desktop, single commit and final-gate required before Ready. A further failure must be recorded as blocked without weakening the original regression, with physical iOS/Android/Safari/PWA and screen-reader cases explicitly NOT RUN.

### Fourth production candidate rejected; outgoing presenter cleanup snapshot

- Fourth candidate exact-head `d04ac5f3fd5ea9cdab9272a7757ff94ff2159bc8`, [CI #38886862414](https://github.com/lazyxu/xdrive/actions/runs/38886862414), genuine Chrome job 116927110407: the 899px typed draft was preserved and focused with caret [2,5], but both 900px and returning 899px remained focus=false, caret [10,10]. This is another **genuine failed focus-handoff candidate** (not product first-red and not merge approval). The parent layout effect cleanup / matchMedia change listeners did not snapshot the old focused Search element before React unmounted it. No unknown requests, no new Search GET, no route or scroll-owner change.
- Fifth candidate keeps both first-red test files byte-for-byte unchanged. The outgoing **actual MobileFiles or shared MUI FileExplorer component** snapshots its own native Search input in its own `useLayoutEffect` unmount cleanup (before its native host node is detached); an optional callback passes only focused UTF-16 caret coordinates to the one existing Web parent. On new presenter mount the common Web `useLayoutEffect` consumes the snapshot and restores focus/caret synchronously. No react/native input event listeners, no always-on matchMedia listener, duplicate Search instance, Server API/cancellation changes, extra virtual scroll host, persistent private text, or 900px/52px shell changes. Desktop callers omit the optional callback and retain behavior.
- **Fifth candidate status at creation:** exact HEAD Chrome/76-job CI NOT RUN. Require unchanged original 899px draft/focus/selected range and accurate-head 900px and return 899px GREEN with zero unintended Search/Server requests, then complete 76-job final-gate. If still red, retain Draft and evidence rather than weakening the browser oracle. Physical iOS/Android, VoiceOver/TalkBack, actual 100k and system keyboards NOT RUN.

### Fifth candidate rejected; document selectionchange-only handoff

- Fifth candidate `83aa551263d1c164c407ed4c8fdc23f7eaa9f687`, [CI #38887987412](https://github.com/lazyxu/xdrive/actions/runs/38887987412), native original Chrome job 116930457652, **FAILED**: 899px Search draft was empty and caret [0,0] immediately after the standard fill/selection, and both 900px and returning 899px were likewise empty even though focus=true. No Search GET or route/virtual-scroll regression. Like the earlier input-event-hook candidates, adding cleanup handlers inside React-controlled input presenters is not acceptable; discard it, not production-approved.
- Sixth candidate uses only the **existing long-lived WebFileExplorer**, restoring the original child `web/src/MobileFiles.tsx` and shared `ui/shared/src/mui/FileExplorer.tsx` byte-for-byte from frozen base. It observes only the browser's `document.selectionchange` event, with a passive read of the current focused Search input/caret into an in-memory ref. This avoids new handler props or React input focus/select/change events. During a genuine compact/wide presenter swap, the common Web layout effect restores the last selected character range, unless another surviving dialog/control owns focus. No duplicate Search data model, background polling, Server calls, private persistence or scroll owner. The two original Search focus first-red browser/source test blobs remain unchanged.
- **Sixth candidate at construction: NOT RUN.** Existing untouched first-red Chrome must first show the initial 899px nonempty draft/focus/[2,5], then both 900px and 899px GREEN, no Search GET and full exact-head 76-job CI/final-gate. Do not merge merely on lint/build; if any candidate fails leave Draft and preserve evidence. Real iOS/Android/PWA, assistive technology, genuine Server 403/409 and physical 100k remain NOT RUN.

### Sixth candidate pre-CI review — nonbubbling input selectionchange

- Initial sixth candidate `6ac900dc591d90d1b041a343505842f69e009414`, CI #38888864204, remained **pending with 0 allocated jobs** during review, so it had no browser result and was **not** an accepted test. Review identified that native `selectionchange` on input elements need not bubble to `document`; `document.addEventListener('selectionchange', handler)` (default bubbling mode) may never see the input's selection event.
- Correct only this listener to capture phase (`addEventListener('selectionchange', handler, true)` and matching cleanup). The listener still executes at DOCUMENT root rather than attaching to the React-controlled input, and it only reads `document.activeElement` and the caret range. No new React props, no DOM mutation or extra Search requests. Recreate the ONE frozen-parent work commit, cancel/replace the unstarted CI through GitHub's existing concurrency policy, and require the new accurate-head unchanged genuine Chrome RED→GREEN plus complete final-gate before merge. Previous failures and true native device gaps remain documented.

## M03 · second-pointer native gesture ownership (2026-10-16)

- Source audit found `useXDrivePointerDrag` already cancels its own pending/active
  file drag on an additional pointer but also called `preventDefault()` and
  `stopPropagation()` on that *second contact's* `pointerdown`. This could
  block the browser's native multi-touch gesture before it handles the contact.
- The narrow shared-hook change retains xDrive cancellation, original-contact
  click suppression and no-drop behavior but leaves the second contact's
  browser event/default action untouched. No Web/Desktop business API, File
  selection, Server mutation, gesture threshold, navigation, 52px header or
  900px breakpoint changes.
- `desktop/tests/file-explorer-pointer-drag.cjs` adds mounted hook assertions
  for *both pending and dragging* contacts: second contact not prevented or
  propagation-stopped, exactly one own-session cancellation, no drop, original
  compatibility click suppressed, second pointer click unblocked and listeners
  cleaned. The assertions would fail on the original source's second contact.
- **Delivery level:** code+regression candidate; exact-work-HEAD GitHub full
  CI/Final Gate and merge are required before calling it delivered. Native
  iOS 27/Android, system back swipe, pinch, mixed input and real long-hold
  gesture acceptance are **NOT RUN** and remain on M03's release checklist.

## U09-A · Mobile 100k List/Grid position mapping (2026-10-16)

- **Frozen original source:** master `69ffd8b69b57ef74e2f7689ca7b884bb77ff529e`. U09 had no open related PR/branch. M03 #1838 previously passed full CI and merged; old M03 branch independently gone. Unrelated projects/branches remain untouched.
- **Real original-code mounted first-red:** immutable test-only PR HEAD `e04009486c23fe478080d1fab230b4c3268e0497`, genuine Desktop Node transpiled/mounted React job in [CI #38895515632](https://github.com/lazyxu/xdrive/actions/runs/38895515632), 100k synthetic logical collection. At saved List scroll anchored to logical Node 54,321, the real row is mounted; clicking actual More → Grid switches to row zero, fails "same logical Node must stay in the Grid virtual viewport." Source `chooseMobileView` unconditionally reset Browse scroll and persisted position to zero. This is a genuine red, not a broken initial fixture. **The source test Git Blob `c4177110342e04fca77ef953b56388eab9cbdcc6` is byte-identical in repair.** The original deliberately failed CI is NOT a release pass.
- **Scoped implementation candidate:** use pure sparse geometry helpers in `mobileFilesState.ts` to capture the current first visible logical row + fractional offset and translate to target 68px List/150px Grid, 2–5 responsive columns and already-authorized group section/header geometry. Reads only stored group layout and O(log groups) lookup; never enumerates itemAt() or materializes all 100k. The view and target logical scroll commit in one React event; a pre-paint layout effect sets actual DOM scrollTop, with bounded browser clamping reconciliation. Preserve account/folder/scope, actual selection, Recent/Favorites rail offsets, one shared Server search/range/controller, 900px and 52px constraints. Expanded inline List children resolve to nearest root index on exit to Grid, rather than reusing child flat index as root.
- One previously valid *old reset-to-zero source contract* in `desktop/tests/mobile-files-ios.cjs` is updated because resetting to zero is the identified defect, not a requirement. No tests added outside Mobile-specific existing suites or Server/Agent/API changes. Exact repaired HEAD full 76-job CI, single-commit, Final Gate and mergeability MUST pass before Ready/Rebase Merge and independent branch deletion.
- Remaining distinct U09 gates: real mounted wide Web/Desktop Details/Grid/Columns, async sort/group re-index with Server item identity, 100k genuine Server/browser FPS/CLS, responsive 899/900 and native iOS27/Android installed-PWA. Never mark these as passed from the synthetic 100k mounted test.

## U09-B · Wide 100k Details ↔ Grid visual anchor first-red gate (2026-10-16)

- Related U09-A [#1842](https://github.com/lazyxu/xdrive/pull/1842) exact-head [CI #38896207409](https://github.com/lazyxu/xdrive/actions/runs/38896207409) passed 76 jobs (25 success/51 skipped including final-gate), rebase-merged `master@f67507bd049019a0e61c8abd1372aa78f4a5d6f8`; its branch independently verified absent. M03 [#1838](https://github.com/lazyxu/xdrive/pull/1838) also merged/cleaned. No open directly related Files PR/branch; unrelated Gallery/Local Push/Perf branches preserved.
- Fixed original production `master@f67507bd049019a0e61c8abd1372aa78f4a5d6f8`. Source observation only: shared `FileExplorer.tsx` resets scrollTop=0 in an effect after `viewMode` changes, even within the same committed Server-authorized sparse folder/Search. Existing U06 history-return tests do NOT exercise same-directory Details→Grid→Details.
- Add to the existing **real browser fixture** a branch-opt-in genuine compiled React/MUI/Workspace/VirtualCollection 900px Chromium case with 100,000 sparse logical results, authoritative four Server group ranges, a deep rendered file, exact selected Node identity, Details→Grid→Details, viewport row visibility and range-request bounds. Existing 4096-item U06 tests remain unchanged. The Browser runner is invoked by the already-established branch-gated U06 CI step; no GitHub/GitLab workflow contract change.
- In this **test-only first-red phase**, shared FileExplorer, Web/Desktop consumers, Server sort/group, API and Agent are byte-identical to master. If and only if the original compiled browser produces a valid deep-row first-red, freeze the browser test Blobs and fix the smallest shared view-switch geometry/scroll behavior under the existing 52px App Frame, 900px breakpoint and single sparse backend; require entirely NEW repaired exact-head 76-job CI and final-gate. Invalid fixture/selectors are NOT product failures.
- Physical Windows CfAPI, 100k live Server, PWA/iOS27/Android, 4GiB and actual FPS/CLS/VoiceOver/NVDA are NOT RUN. Columns and sort/group reordering remain separate U09-C gates because their authoritative logical position changes are not equivalent to simple view geometry.

### U09-B first browser run was an invalid precondition, not product first-red
- Corrected declaration-order head `93808f8d73814111fa20e449f6e7b0bf25fe6e72`, [CI #38898698385](https://github.com/lazyxu/xdrive/actions/runs/38898698385), original compiled Chromium runner: **104 inherited checks passed**, no page/browser errors; U09 test failed *before view switching* while asserting a name from the first nested MUI `[title]`, which need not be the real file name. This is an invalid locator/probe, NOT a FileExplorer failure. Do not credit this as RED.
- Keep original 100k grouped sparse fixture, actual row interaction and all view-switch assertions untouched. Change ONLY the setup name-reading step to extract the visible `结果-\\d{6}\\.txt` token from the genuine rendered row text, and record sanitized initial preconditions in the results. Recreate one fixed-parent test-only commit and require new original-production browser run before any source fix.

### U09-B authentic 100k preconditions verified; wide menu fixture corrected
- Genuine original Source Chromium [CI #38899546483](https://github.com/lazyxu/xdrive/actions/runs/38899546483) provided 106 passing checks, no browser/page errors. The new case **successfully reached** 100,000 logical items, authoritative `modified` grouping, deeply loaded sparse window (~index 56,000), scrollTop 2,016,095, actual selected Node ID 53999 / `结果-043999.txt`, and an unmodified shared FileExplorer DOM. It then stopped **before view change** because the test clicked `menuitem: 网格`, which is available only in compact UI; at 900px wide the real command is `中图标`. This is invalid test UI action, NOT product RED.
- Only switch the U09 branch test to the correct real wide `中图标` option; keep all source+group fixture data, real selection/first-visible preconditions and subsequent deep item, range, one-scroll-host and return-to-Details assertions unchanged. The existing compact `网格` test remains byte-for-byte intact. Recreate one commit on the same frozen master; require new exact-head genuine Chromium first-red before production repair.

### U09-B · verified original browser RED and scoped repair
- **Genuine first-red:** original production shared FileExplorer was unchanged in test-only head `f11ce53e1a3d8779a23a656a47fa0dc372a70e61`, [native Chromium CI #38900243080](https://github.com/lazyxu/xdrive/actions/runs/38900243080), Web job `116971022246`. With 100k sparse real mounted results and four Server-authored `modified` groups, deep selected ID `53999` / `结果-043999.txt`, 109 existing assertions green and zero JS errors, **three U09 assertions RED**: grouped Grid lost the visible logical Node, Grid requested prefix offsets `0`/`200`, and returning to Details still lost the deep Node. Authenticated range/selection data did not fail. This RED is genuine and authorizes a narrow shared presentation fix.
- **Frozen browser oracle:** the exact original compiled-browser runner/fixture blobs of `f11ce53e1a3d8779a23a656a47fa0dc372a70e61` remain BYTE-IDENTICAL in the repair. Rebuild exactly ONE work commit on original frozen parent `f67507bd049019a0e61c8abd1372aa78f4a5d6f8`; previous red CI is not merge acceptance.
- **Fix:** shared Web/Desktop MUI FileExplorer captures one user-visible logical index and pixel offset (prefers focused item only if actually on screen) before Details/Grid view-only change. A scoped pre-paint `useLayoutEffect` maps it into the NEW group/column/row geometry, updates the single actual scroll host and sparse virtual state, and suppresses wrong-layout range requests/snapshot writes during handoff. Normal folder, sort and group changes still reset as before; Columns maintains its distinct top-of-pane policy; long-lived selected Node IDs/Revision, Search, session/tab state, API, Server group index and 900px/52px App Frame remain unchanged.
- New source guard tests join existing Desktop suite. Require **new repaired exact-head Chromium original 100k RED→GREEN**, Web/Desktop/Go/Windows/image, single-commit and final-gate before Ready/Rebase Merge and branch cleanup. Native physical iOS27/Android/Windows CfAPI, 100k real Server and FPS/CLS still **NOT RUN**.

### U09-B first repair: genuine Chromium green; Desktop extracted-Effect isolation follow-up
- Repaired head `173f875e74ca9b9dfeb747002583cada74a65739` [CI #38901934807](https://github.com/lazyxu/xdrive/actions/runs/38901934807) ran the BYTE-IDENTICAL original 100k Chromium browser oracle: **112 passed, 0 failed, 0 browser errors**, including the previous three real RED checks (deep selected Grid, no prefix Search Range and return-to-Details). Web lint/build passed.
- One unrelated existing Desktop extracted-Effect unit test `desktop/tests/shared-file-explorer-properties-scope-race.cjs` failed with `ReferenceError: pendingViewModeAnchorRef is not defined` because it compiles the legacy account-scope cleanup effect as a standalone closure. Remove only the redundant `pendingViewModeAnchorRef.current = null` line from that extracted effect; the already-implemented scoped `useLayoutEffect` cancels stale view anchors when `interactionScopeKey` or `returnStateKey` changes, and the source range guard already refuses cross-scope work. This preserves production logic and avoids widening the legacy isolated-effect test harness.
- The original first-red browser runner/fixture Blobs and shared U09 Node assertions remain unchanged. Rebuild **ONE** fixed-parent work commit and require entirely NEW exact-head full CI/Final Gate before merging. Old green Chromium check alone does not authorize merge.

## U09-C · 100k Server sort/group reindex and selection identity gate (2026-10-16)

- Previous U09-B [PR #1846](https://github.com/lazyxu/xdrive/pull/1846) passed **exact-head 76-job** [CI #38902503868](https://github.com/lazyxu/xdrive/actions/runs/38902503868): 25 success/51 conditional skipped, Final Gate successful; real compiled Web 112/112 browser checks, Desktop 2873/2873 tests. Rebase merged as `master@a54d0ec730fcd307fa9615a655dd3802d57407a0`; its exact work branch was independently confirmed absent after successful cleanup. Other Gallery, Push and Perf PRs are outside scope.
- Frozen new master parent `37115c7d1d3cfb767c305fe8993b4834bb6b2139`; no open related Files PR or U09 work branch. This is a **test-only** audit and verification for U09-C. Do not silently invent Server ordinal lookups: re-sorting/regrouping changes the authority for ordinal indices and must not attach a stale selected ID or focus to a new item at the old index. Existing product resets to newly authorized position zero rather than pretending to know where the old selected item moved.
- Use unchanged compiled real React/MUI FileExplorer + Web Workspace/Search/VirtualCollection Chromium browser fixture; opt in only for `test/files-search-return-chromium-u06-u09-sort-group-*` under existing branch-gated Web CI (no GitHub/GitLab workflow change). Start 900px Details at genuine deep sparse 100k row, select a real ID, change Server sort `updated desc → name desc`, verify auth group and query stay intact, selected stale old ID is not mapped to new ordinal, only bounded new order first-range requests. Then change Server grouping `modified → type`, verify full count and ARIA 100005 rows, Server-owned group signature, bounded requests and real new-row selection. Preserve single scroll host and 52px App Frame, 900px divider, 100k sparse memory.
- A passing synthetic-genuine browser test proves only the tested UI/Server-contract adapter behavior; it does NOT prove preserving the exact old selected item after Server reindex (needs authoritative Node-ID-to-new-ordinal API), physical iOS/Android/Desktop CfAPI, real 100k Server load/FPS, VoiceOver/NVDA, permissions, slow 429/503 or offline PWA. If an original component/contract assertion legitimately fails, repair only proven issue and require NEW full exact-head CI. Fixture errors are NOT product RED.

### U09-C first submitted test-only HEAD had no workflow allocation
- Initial test-only work commit `63880c79034bc4357fe29d427828ff6dca124db7` opened [PR #1852](https://github.com/lazyxu/xdrive/pull/1852), but GitHub Actions head-SHA query returned **zero workflow runs**, not a failure or passing CI. No browser/Server evidence is claimed. Recreate exactly one test-only work commit on unchanged frozen parent `37115c7d1d3cfb767c305fe8993b4834bb6b2139` to request a fresh PR synchronize event; keep the full 100k original browser test Blob `e53aec0cf591bef94f6801dc8e1ad1b86cc074be` byte-for-byte unchanged, only append this delivery evidence note. Do not merge or reuse unrelated green CI if a new run is still not allocated.


## U04-A · real Gin/Client/PostgreSQL queued vs committed receipt (2026-10-16)

- **Phase / provider:** GitHub `lazyxu/xdrive`, current master frozen for one test-only commit; prior U13 [#1863](https://github.com/lazyxu/xdrive/pull/1863) and mobile dialog [#1864](https://github.com/lazyxu/xdrive/pull/1864) have full exact-head 76-job CI and were merged/closed. Related F02–F04/U01/U09 files PRs are merged; remote merged U13 branch is still visible because the connected GitHub integration does not expose Delete Ref. Other Gallery/Caddy/LocalPush/Race/Perf PRs are untouched.
- **Source-observed gap:** Existing real PostgreSQL FileExplorer basic lifecycle already executes Web-equivalent Go Client → authenticated Gin → Local CAS/DB copy, move, delete and verifies the terminal effects, but it does not assert that a **202 Accepted / queued** response and Task Center GET/list carry **zero committed progress** and leave the namespace unchanged **before** the authoritative worker runs.
- **Bounded original-product regression:** Extend the one existing isolated PostgreSQL test (no production changes or new fixtures/routes) with one real owner-scoped queued copy cancelled via existing public Client/Server endpoint: its POST/GET/list queued state has 0 processed items/bytes/percent, no start/finish; other Owner GET and cancel must return 404; cancellation returns terminal cancelled without dispatch or mutating target. For copy, move and delete separately, compare the accepted POST/GET/list status and corresponding unchanged pre-worker source/target, then let the already existing real worker commit and check the existing terminal + NodeChange/bytes/Trash assertions. The test cannot be satisfied by frontend queue wording alone.
- **Evidence boundary:** This is real PostgreSQL17/Gin/Go Client/Local storage but only a deterministic integration scenario. It does NOT exercise real Web/Mobile Web/Desktop renderers, OS-assisted downloads, 100k, permission revocation/403/409, unstable WAN/HTTP Abort, cancel-requested while genuinely running or native iOS27/Android/Windows. The status of those independent U01/U04/U05/U06/D07/P01–P09 acceptance cells is unchanged.
- **Gate:** require new exact-HEAD Go Linux API/PostgreSQL race test, Web, Desktop, Windows, image/artifact, single work commit and Final Gate on the complete GitHub CI, then only a verified mergeable Ready/Rebase merge and branch cleanup when available. If the first run is red, diagnose whether the test oracle is invalid or original product is actually wrong; do not weaken legitimate assertions or report an unrun test as passed.


## U01-A1 · Real authenticated HTTP first-page abort, without UI redesign (2026-10-16)

**Phase:** U01-A1 original-code network contract, GitHub `lazyxu/xdrive`. Previous U04-A [#1869](https://github.com/lazyxu/xdrive/pull/1869) was exact-head full CI green and merged, and the old related branch was independently absent; no directly related open Files PR/branch at this baseline. The current one-work-commit change adds only this ledger and the existing real Gin/Client/PostgreSQL FileExplorer basic integration test. Do not touch independent Gallery/Caddy/LocalPush/Perf/Race PRs.

**Before / untested edge:** The prior production-code mounted React U01 tests demonstrate old rows survive pending, failed and superseded first range. The original real Server lifecycle test already verifies PostgreSQL-backed, authenticated counted ranges and durable work outcomes. Neither proves that an *actual already-authorized* Gin directory first-page HTTP request can be cancelled before response bytes reach the client while another authorized directory remains readable and a new request can succeed. User-facing UI and API source behavior are intentionally unchanged.

**New precise oracle:** A second disposable `httptest.Server` wraps the same real Gin Router and database; ONLY a request with a fixed test-only header gets its already-produced Gin response held in memory. The handler executes the actual Owner JWT authorization, SQL counted range and renders the real 200 **before** signaling the hold. No synthetic API success or Client-side mock, no production middleware/headers/routes or actual device connection. While the fresh destination is held: independently fetch the previously committed root range through real Gin (same IDs/count), prove foreign Owner's real Server response is 404, cancel the pending HTTP request using the actual Go request context and require BOTH a client-side `context.Canceled` error and observation of `r.Context().Done()` in the live HTTP handler. A new unblocked authenticated request must return the original destination's entire counted page; no filesystem mutation or new task is permitted. All existing copy/move/delete/Trash checks remain intact.

**Evidence classification:** If own GitHub `go-linux-api` PostgreSQL race logs show this unchanged original Go test passing, credit **U01-A1 real HTTP transport/authorization cancellation**, not the full U01. It does **not** prove a mounted Web/Mobile Web/PWA/Desktop scroll-host retaining old pixels, Chrome's actual `AbortController` signal reaching Go, real request latency/timeout, 100k benchmark, physical iOS27 Files parity, VoiceOver/TalkBack/NVDA, or real 403/cert/429/503 and OS history. Existing synthetic browser/mounted React tests remain independent. Following steps: browser+real Gin actual navigation and abort/Back anchors, U04-B running cancel, U05 real stale Revision and U06 authenticated Search.

**Delivery rules:** Draft until entirely NEW exact-head full 76-job CI (Go API/PostgreSQL race, Web/Desktop, Windows, image/artifact, single-work-commit, final-gate) passes and the head remains clean/mergeable. Only then Ready→Rebase merge and verify obsolete related branch deletion. An initial test or harness failure is NOT a product regression without a valid original-code failed assertion. All PWA S5 physical matrix cells remain NOT RUN / NO-GO.


## U01-B · Abort superseded counted-first-page requests in the shared controller (2026-10-17)

**Provider / phase:** GitHub `lazyxu/xdrive`. Related U01-A1 [#1871](https://github.com/lazyxu/xdrive/pull/1871) passed exact-head [CI #38923011252](https://github.com/lazyxu/xdrive/actions/runs/38923011252), 76 jobs / 25 successful / 51 conditional skips / final-gate green, and merged as `master@2686b47513c7fc8054e5666a3cb83543478f0c5b`; its PR is closed. The old remote branch was still present at postmerge inspection; the connected GitHub tool does not provide Delete Ref. No other directly related open Files UX PR; preserve unrelated PRs/branches.

**Observed genuine source gap:** `ui/shared/src/mui/CloudFilesController.ts` already prevents stale first-page responses from committing by comparing `directoryRequestRef`, but both `loadDirectory` and `loadInitial` call `port.getRange` WITHOUT a signal. That discards stale UI results yet lets authenticated HTTP/Agent work continue after the user navigates, changes account or disables the view. Independently, `loadVirtualRange` already passes the VirtualCollection-owned signal. U01-A1 verified actual authenticated Gin first-page HTTP `r.Context().Done()` when the request is cancelled; that test did not prove the **UI controller** issues that cancellation.

**Bounded product repair:** One first-page-only `AbortController` is owned by the existing shared Cloud Files hook; starting any newer initial counted page aborts the previous one *synchronously*. Pass `signal` as the existing optional final argument to both counted `port.getRange` calls; abort during true lifecycle/account replacement, disable and unmount. Fence request generation AND `signal.aborted` before publishing items, crumbs, quota or VirtualCollection; deliberately aborted requests never emit an error. Clear the owned reference only if it still belongs to that request, so a stale `finally` cannot detach the newest request. **Do not abort** a still-required secondary VirtualCollection range or task/thumbnail/media transfer. Preserve Web `api.listRange` REST and Desktop existing `xDriveDesktopViewportRequest`→Agent cancel transport, 900px boundary, full-screen 52px App Frame, Search/back history, original logical item IDs, Server sort/groups and all current account authorization.

**Source-executed regression:** Extend existing actual transpiled `desktop/tests/shared-cloud-files-controller-race.cjs` with a mounted hook test that retains old authorized rows through a held B first-page request, immediately asserts B's real `AbortSignal` is aborted upon navigating to C, B's pending promise rejects and is suppressed, and only verified C commits. Independently, hold A's initial counted page and change authenticated account identity; the outgoing signal must abort and B's same-numbered Node cannot inherit A's rows. Existing pending 403/timeout and superseded success/error tests remain byte-identical. This is deterministic original production hook behavior, not a physical network trace/OS browser. Actual real Gin HTTP context was separately proven by U01-A1.

**Delivery gate:** Exactly one frozen-parent work commit, scoped shared hook + two source regression tests + this ledger. Draft until the **new exact-head** full 76-job CI (Desktop mounted tests, Web build, Go Linux/API/PostgreSQL, Windows, images/artifacts, single-commit and Final Gate) passes, then Ready/Rebase merge and independently inspect related branch. Do not claim physical iOS27 Safari/Android installed PWA, 100k real FPS/CLS, offline/403/429/503, screen reader or Windows CfAPI merely from mounted tests. U01 later still needs genuine built-Web/GIN delayed navigation including Back/Forward, error focus and scroll anchor; U04-B, U05, U06 and U09-D remain separate gates.


### U01-B first CI: obsolete textual source guard, not production behavioral failure

- Candidate `3b56589286a9e8f236d49724fdbcaea0fce65062` [CI #38924819424](https://github.com/lazyxu/xdrive/actions/runs/38924819424), Desktop job `117053562867`: **both newly added original-production mounted U01-B signal-cancellation regressions PASS** (cases 1608 and 1609). One older `desktop/tests/file-explorer-performance.cjs` assertion failed because it literally required `if (requestID !== directoryRequestRef.current) return`, while source intentionally strengthens the condition to `signal.aborted || requestID !== directoryRequestRef.current`. The failure occurred in a textual source guard, not a navigation/Agent/Go runtime assertion; initial candidate's full CI is **RED**, not merge evidence.
- Preserve original production shared hook Git Blob `fc16d70397135ebe58562e9a6d2d841c677e1629` and both new mounted-hook tests Git Blob `1d19858cf7f70bdf06a6f907a3908b387bdc8b52` **byte for byte**. Update ONLY the inherited guard to require explicit aborted-or-stale fences in **both** loadInitial and loadDirectory, rather than deleting its stale generation assertion. Keep all Web/Desktop request semantics/900px/52px and test-only scope otherwise unchanged; rebuild exactly ONE commit from a conflict-free frozen current master and require brand-new exact-HEAD 76-job CI/Final Gate before Ready or merge.


## U04-B · Real running Worker cancellation through authenticated HTTP (2026-10-17)

**Strict phase boundary:** This is an independent U04-B test-only **stacked one-work-commit** follow-up on U01-B PR #1876's exact source HEAD while its new CI is still running, as permitted by AGENTS.md dependent-branch rules. This does NOT assert #1876 has merged. After its verified merge, rebase/reconstruct only the ONE U04-B work commit onto merged master and require NEW exact-head full CI. The current `file_operations_integration_test.go` includes a simulated `cancel_requested` worker hook and a manually installed cancellation cause, while U04-A [#1869](https://github.com/lazyxu/xdrive/pull/1869) verifies genuine 202 queued/terminal cancellation before Worker claim. Neither independently demonstrates the **real Gin/Go Client POST cancel** against a claimed, executing Worker with a blocked PostgreSQL statement.

**New bounded actual PostgreSQL oracle:** Reuse the isolated real Gin + PostgreSQL + Client + Worker/Local CAS FileExplorer basic lifecycle test. Enqueue a distinct owner-scoped copy into an empty destination. Only AFTER genuine enqueue, acquire a separate PostgreSQL `SELECT ... FOR UPDATE` source-node row lock; invoke the production `processNextFileOperation` in a goroutine. Require the real queued→running transition, verify the Worker cancellation function was registered, and require `pg_stat_activity` to observe a PostgreSQL **Lock wait in the real Worker SELECT ... FOR UPDATE**. While still holding that source lock, call the **actual authenticated** `cli.CancelFileOperation` REST endpoint; only a `cancel_requested` or already-terminal `cancelled` response with timestamp is truthful, never `completed`. Require the real Worker to terminate successfully **before releasing the SQL lock**; then verify durable terminal cancelled status, zero items/bytes/progress, cancellation/finish timestamps and no copied Nodes. Real Worker rollback is checked; no invented work completion, frontend mock, production route, API or Agent IPC change. Bounded timeouts prevent hanging forever, and all existing copy/move/delete/Trash tests remain.

**Evidence boundary and gate:** The test is a deliberately controlled PostgreSQL row-lock/Worker scenario on the genuine Server and does not measure CPU/latency/throughput or real user's upload/download cancel. It is not physical iOS27 Safari, Android Installed, Windows CfAPI, real WAN 429/503, Web UI during cancel or a PWA release sign-off. Preserve U04 status semantics and PWA S5 NO-GO. Require one work commit above the immediate tested dependency head, then one reconstructed work commit on the merged master, with its **own** exact-head complete 76-job CI including Go API PostgreSQL race (not merely a test stub), Desktop, Web, Windows and Final Gate, before Ready/Rebase merge; investigate any real red without weakening the acceptance oracle.


## U01-C · built Web / real Gin / PostgreSQL first-range navigation and browser Back (2026-10-17)

**Evidence/phase:** GitHub `lazyxu/xdrive`, after [#1876 U01-B](https://github.com/lazyxu/xdrive/pull/1876) exact-head [CI #38927474176](https://github.com/lazyxu/xdrive/actions/runs/38927474176), 76 jobs / 25 successful / 51 skipped / final-gate green, and Ready/Rebase merge `80bd33628cb43d945aa238d7d486dfe5df2cd313`. U04-B [#1880](https://github.com/lazyxu/xdrive/pull/1880) independently passed exact-head full 76-job CI [#38929657437](https://github.com/lazyxu/xdrive/actions/runs/38929657437), merged as `01d10c84296edb8ad4bbf72931ff4f087d9b294a`. At this check #1880 closed; its remote branch still visible and GitHub plugin does not provide Delete Ref. No other open Files UX PR. Leave unrelated LocalPush, Gallery, Admin, Perf and Race work alone.

**Precisely missing runtime evidence:** #1871 U01-A1 proved that a Go Client cancellation closes a real authorized Gin/PostgreSQL first-range HTTP request; #1876 U01-B proved by original shared React hook tests that rapid navigation/account switch emits an `AbortSignal` and retains previous visible rows until new first-range commit. Neither exercised those together in a **production-built Web page with an actual browser history/navigation event**. The earlier mobile navigation browser checks used bounded HTTP fixtures and must not be mistaken for genuine backend results.

**This one bounded original-product test extension:** Reuse the established `TestIOS27FilesLiveGoFixture` with unchanged **real Production Gin, isolated PostgreSQL17 and physical Local CAS**, plus its already-built Web and native Chromium. Add exactly two Owner-created folders with actual leaf file bytes. A private fixture-only arm/state endpoint holds only the first `GET /api/v1/nodes/:id/children?offset=0` for the slow folder **after** executing real Gin JWT authorization, Owner scoping, SQL query and HTTP 200 in `httptest.ResponseRecorder`. Do not manufacture any `/api/v1` response, never leak JWTs, and never add any production route or Server hook. The browser tests at 390px Mobile and 900px Wide each:
- establish a real authorized root folder, its visible row and original scroll-host geometry;
- navigate to slow folder via native same-document browser hash route while an authorized range is withheld; verify old root rows remain, one scroll host stays mounted, and its y/height do not shift;
- navigate to a different real authorized fast folder; verify its real PostgreSQL/CAS-backed leaf appears, slow leaf cannot replace it, and the Go HTTP handler observes the slow request's actual `r.Context().Done()` before responding;
- use real `page.goBack()` to slow folder and again to root; verify each full authorized page and route restore rather than conflating browser history with Files internal Up/Viewer return. Require exactly two successful independent arm→entered→cancelled generations and keep the existing complete real UI copy/move/delete/rename/undo/redo flows untouched.

**Scoped evidence boundary:** This proves Linux native headless Chromium and real Server/PG/Local CAS/one virtualized scroll owner **for the tested widths**. It is **not** real iOS 27 Files 1:1, Android Installed, macOS Finder/Windows CfAPI, 100k latency/FPS, slow 3G TLS, inaccessible permission-revocation toast, independent browser PWA cold-start, or PWA S5 acceptance (still **NO-GO**). U01 further true authenticated failed destination/retry, Files internal vs OS Back, task/live Viewer return/anchoring and native font/gesture remain separate.

**Gate:** exactly ONE test/doc-only work commit on frozen current master; update real Go fixture and real built-Chromium runner, plus this ledger, only. CI must execute native Chromium→Gin/PG, real Go API race, Web, Desktop, Windows, images/artifacts, single commit and final-gate for **this HEAD**, then Ready/Rebase merge if clean. Initial failures require diagnosis of the original production browser/Go source or a test setup fault, not weakening acceptance. Do not add broader network retries, change 52px frame/900px breakpoint, duplicate Web/Mobile backend, or alter actual business features.


### First U01-C CI discovery: browser runtime was conditionally SKIPPED (not evidence)

- First candidate `07b47bc5835702d948406344175659c71ed55ff8` [CI #38932482939](https://github.com/lazyxu/xdrive/actions/runs/38932482939) ran standard Go API race/Desktop/Web jobs, but `go-linux-api` returned **skipped** for all native `Actual Chromium Files 375/390/899/900 to Gin and PostgreSQL17` and its Web build/artifact setup steps. They were gated by GitHub `startsWith(github.head_ref, 'test/mobile-files-ios27-live-go-')` and **did not match** this PR's exact `test/files-u01c-chromium-real-gin-nav-20261017` branch. No assertion was executed for newly authored U01-C browser navigation; green Go API alone is **not** U01-C acceptance. Do not merge on the first run.
- Keep the new original Gin fixture Blob `17fddbacad0249391d561d9c81bb84934cf5c2df` and original browser runner Blob `e98c6c494a8754f1567dd328cb776957de900a02` byte-identical. Add the narrow `test/files-u01c-` alternate branch-prefix only to the existing four real Files test workflow gates (Node setup, built Web, Chromium live Gin acceptance, artifact), retaining the original `test/mobile-files-ios27-live-go-` branch support and all other jobs unchanged. Reconstruct ONE work commit on a conflict-free new master; require entirely NEW exact-head full CI where those steps report **success** (not skipped), and actual `u01RealNavigations=2` in output, before Ready/Rebase merge. Investigate any genuine failure rather than reporting a skipped test as green.


### U01-C enabled real Chromium gate: first original run identified isolated fixture schema drift

- Exact source HEAD `bec2bd9996fba8ec345e1a39a8ebe6b43bb9454d`, full [CI #38934742586](https://github.com/lazyxu/xdrive/actions/runs/38934742586), actually entered the previously skipped `Actual Chromium Files 375/390/899/900 to Gin and PostgreSQL17` step. Go runtime aborted inside the test-owned `TestIOS27FilesLiveGoFixture` **before opening a browser**, in `uploadTestFile` on first Owner file. Its real Gin upload returned HTTP 500 `metadata write failed`; raw PostgreSQL SQL error was `42P01: relation "xd_local_push_quota_holds" does not exist` from production `internal/api/quota.go` quota computation. This is not an assertion that U01-C browser navigation failed; the browser and its real range cancellation were **NOT RUN** in this attempt. The original full run is RED and cannot approve a merge.
- Root cause confirmed in the **test-only** private-schema migration: `files_ios27_live_go_browser_integration_test.go` AutoMigrate creates UploadSession and UploadPart but omitted the already-production-required `meta.LocalPushQuotaHold` table; other real FileExplorer basic tests already migrate it. Add exactly `&meta.LocalPushQuotaHold{}` to this disposable fixture AutoMigrate, never weaken Upload/Quota handling, create a fake `/api/v1` response, alter Server production migrations or bypass the physical CAS bytes. Keep the original Chromium runner and actual Gin U01-C hold/cancel assertion unchanged. Reconstruct ONE source work commit from a conflict-free newest master, rerun **new exact-head full 76-job CI** with mandatory native Chromium→Gin/PG step **success**, `u01RealNavigations=2` and final gate before Ready/Rebase. If it fails again, distinguish the next fixture issue from genuine original-product behavioral failure.


### U01-C second real-browser execution: cancellation and history passed, legacy off-window test locator failed

- First schema-complete exact HEAD `5d3507ccdd3a5fbddac86fd87399de6e8ea2476f` [CI #38936342498](https://github.com/lazyxu/xdrive/actions/runs/38936342498) executed real PostgreSQL Gin + production Web Chromium. Its genuine browser result recorded `u01RealNavigations=2`, `widths=4`, `patches=4`; the **U01-C 390px Mobile and 900px Wide authorized held first-range / superseding browser abort / two real browser Back checks passed**, as did preexisting real 409/200 rename checks. It subsequently failed the **unrelated legacy F09I-B UI Copy setup**: `queueCopyFromUI` waited for `wide-accepted.txt` to already be mounted in the *initial* Mobile virtual viewport, timing out after 12 seconds before posting any Copy. Adding two real folders moves this valid Node farther down the bounded list; an off-window DOM row cannot be assumed mounted. The overall CI was **RED**, not merge evidence, and the remaining Copy/Move/Delete/Undo/Redo tests were NOT RUN in that attempt.
- Preserve the actual Gin U01-C fixture Blob `4f34eb006e638f94d86c8d6ab09af2bf64e07850`, CI four Files branch gates, exact U01 navigation assertions, real operation POST/Server receipt checks and 52px/900px design unchanged. Change ONLY `queueCopyFromUI` initial row targeting to invoke the already-used `findBatchRow(mobile, host, 'wide-accepted.txt')` (bounded virtual scroll, existing exact row identity) after current scroll host mounts. Do not materialize an unbounded list or weaken the Copy assertion. Reconstruct exactly ONE work commit on the newest conflict-free master and demand NEW real browser step `success` with `u01RealNavigations=2` AND completed Copy/Move/Delete and Final Gate.


## U05-A · genuine expired Revision after concurrent authorized Server rename (2026-10-17)

**Provider/phase:** GitHub `lazyxu/xdrive`; after U01-C [#1885](https://github.com/lazyxu/xdrive/pull/1885) passed complete accurate-head 76-job [CI #38938502909](https://github.com/lazyxu/xdrive/actions/runs/38938502909) (25 success / 51 conditional skips, Final Gate green) and Ready/Rebase merged at `master@a5e24af3363b43818eb2e4bc8157d61781c1cc15`; PR closed and directly related old Files branch independently absent. F02–F04, U02, U09-A/B/C, U13, U04-A/B, U01-A1/B/C retain their recorded merge and test evidence. Other Gallery/LocalPush/Caddy/Perf/Race PRs are not touched.

**Source-proven remaining U05 issue:** Existing `FileNameDialog` mounted tests prove 403→409 focus/draft retention and 255 UTF-8 byte rejection with an injected adapter failure. Existing native Chromium + real Gin/PostgreSQL proves duplicate-name 409 and subsequent successful Rename 200 on both Mobile Web/Wide Web, but those 409s use a CURRENT revision. They do **not** prove the truly independent Server revision advance between opening an editor and pressing Save, followed by genuine `If-Match` stale 409, preserved user draft and keyboard focus.

**Bounded genuine U05-A browser oracle:** Reuse the original U01-C fixture's existing physical-CAS-backed, Owner-scoped `u01FastLeaf` in its subfolder (no extra root nodes, API, fixture migrations, auth bypass or fake response). AFTER the existing U01-C real navigation/Copy/Move/Delete/batch/folder test steps, use the unchanged production built Web UI to open the normal Mobile 390px Rename Dialog and then Wide 900px inline Rename. Each test enters a draft, executes a *separate legitimate authenticated Server PATCH* with the current `If-Match` to advance the actual PostgreSQL revision, and immediately submits the original UI's now-stale draft. Require original UI PATCH `If-Match` to remain stale, actual Gin HTTP **409 `revision_conflict`**, exact draft still present, original textbox focused, and a real Owner GET proving the concurrent Server name+revision remains authoritative. On each failure, close editor without accidentally overwriting or deleting the persisted data. Expected original Server revisions 1→2→3, two independently verified UI rejects, no client-side guessed revision.

**CI scope:** Only original production-built Chromium test runner gains `u05StaleRenames` cases and count `u05RealStaleRenames=2`; source Gin/PostgreSQL/Local CAS fixture, Web/Desktop/shared UI/Go client, Server API remain byte-for-byte unchanged. Four existing Files native test YAML branch guards add exactly `test/files-u05-` alongside historical scopes so the native Chrome step **actually executes** and its artifact is emitted. All prior real U01-C, 4x rename 409/200, Copy=2, Move/Delete=4, BatchDelete=2, BatchDestination=4, FolderCreate=2, Undo/Redo=4 must still pass unchanged. Keep exactly ONE frozen-parent scoped commit; Draft until full **new exact-head 76-job CI** incl. real PostgreSQL race, native browser, Desktop/Windows, images, single-commit and Final Gate returns green. A first RED must be classified before any behavior changes.

**Limits:** This is real Linux Chrome Desktop with Mobile viewport simulation, NOT iOS27 Safari/TalkBack/VoiceOver, Android Installed, true Windows CfAPI/Agent errors, 200% native font or offline WAN. A valid Owner-concurrent stale revision 409 is not a 403 permission change; U05-B real permission-revocation draft/focus and device keyboard remain independent. Physical PWA S5 matrix remains `NOT RUN` / release `NO-GO`.

## U06-A · real Owner-authenticated Search → Node Location → folder Range → Search (2026-10-17)

**Provider/phase:** GitHub `lazyxu/xdrive`. Prior directly related U05-A [#1892](https://github.com/lazyxu/xdrive/pull/1892) exact-work-head [CI #38941407620](https://github.com/lazyxu/xdrive/actions/runs/38941407620) completed **76 jobs / 25 successes / 51 conditional skips / final-gate success**, then Ready/Rebase merged as `master@3c1ec148187f57cd40b76787a135e0e3a153bd19`; PR closed. The old U05 branch remained visible in a targeted search because the GitHub connection does not expose Delete Ref. U04-B [#1880](https://github.com/lazyxu/xdrive/pull/1880) and U01-C [#1885](https://github.com/lazyxu/xdrive/pull/1885) are also already merged. No directly related open Files PR at this snapshot; unrelated Gallery, performance, LocalPush, Caddy and Race PRs untouched.

**Narrow remaining Server acceptance:** Existing shared MUI source and production-built Chromium synthetic fixtures already cover Search → containing folder → browser navigation history/viewport restoration. Existing real PostgreSQL Search integration tests separately cover Owner-scoped Search with sort, count, groups, pagination and isolation; Node Location has a separate unit/integration test. None currently verifies that the **same real authenticated original endpoints** preserve a specific search result's Node ID through *Search (counted, grouped, offset) → GET /nodes/:id/location → GET /nodes/:parent/children (counted range) → repeat exact Search*, without accidentally using the destination directory's unrelated ordinal.

**Scoped original-code Go test:** Extend the existing isolated real Gin/PostgreSQL Search test only. Migrate the existing `SourceItemMetadata` model already referenced by the original Node Location query; use existing Owner A/B tokens and existing Beta Report Node, no new route or production-code change. Assert original Search `q=report&type=file&offset=1&limit=1&sort=name&order=asc&group=size` finds exact stable Beta ID; request original Node Location and verify parent/ancestors `Projects/Reports`; other Owner cannot fetch location or parent range (both 404); first counted children range contains Alpha and Beta IDs in actual Server order; retrying original exact Search returns the same ID, count, sort/group and offset. Preserve all existing Search type/isolation/group/cursor tests intact.

**Evidence boundary:** Real PostgreSQL+Gin endpoints and authorization are covered. This Go request sequence is **not** a mounted browser's Back/Forward click, Search input value/focus/scroll restoration, PWA Installed, Desktop Agent transport, actual 100k FPS/CLS, OS VoiceOver/TalkBack or 403/429/503. Those independent U06-B and M/D/P physical acceptance cases remain open; do not equate explicit repeat Search parameters with client state retention.

**Gate:** exactly ONE frozen-parent, two-file test/documentation commit. Require exact HEAD full GitHub 76-job CI incl. Go API PostgreSQL race, Web/Desktop/Windows/images/artifacts, single-commit and Final Gate; only then Ready/Rebase merge, check obsolete related branches, no unrelated cleanup. Any red must be classified as a genuine original-code failed assertion vs test setup and corrected without weakening valid authorization rules.


### U06-A first CI failure and offset grouping contract repair (2026-10-17)

The original draft `aa31a229787fe924526b97e9e3b272697660a90b` in [CI #38943333415](https://github.com/lazyxu/xdrive/actions/runs/38943333415) failed the real Go API Race test at the NEW offset=1 assertion, **before** reaching Node Location. Gin returned the correct single Beta Node, total_count=3, sort and order, but `groups=[]`. The original `search.go` intentionally computes `Groups` **only when `include_count && offset == 0 && grouping.Group != "none"`**. A nonzero page must not claim aggregate groups, and the existing offset=0 `groupedReports` test separately verifies the full group size=3. This is a **test-oracle error, not proven production drift**. Correct only the offset=1 expectation (`Groups` empty) while preserving the real stable ID, owner isolation, location/ancestor, folder range, repeat-Search and existing original 0-offset group checks. Recreate exactly one work commit on frozen master `07d2e0b4de3334884f3a26a81e3dda5d4cfb8f6b` and require entirely NEW exact-HEAD 76-job CI and final gate before Ready/Rebase merge. Old failed CI is not acceptance; device PWA/iOS/Android/Windows checks remain NOT RUN.

## U06-B · authenticated search → containing folder → Files Back (2026-10-17)

**Starting evidence and repo boundary:** GitHub `lazyxu/xdrive`, currently audited `master@3c1ec148187f57cd40b76787a135e0e3a153bd19`. Previously merged and accurate-head full-CI green: #1876 U01-B cancellation, #1880 U04-B genuine worker cancel, #1885 U01-C built Chromium/Gin first-page cancellation and browser history, and #1892 U05-A real stale Revision 409/retained draft and focus. Related merged Files branches and active Files PR search were empty. Unrelated Gallery/LocalPush/Admin/Perf/Race PRs are not part of this scope.

**Precisely missing original runtime evidence:** Existing shared-Workspace/browser U06 tests exercise a synthetic 4096/100k search collection and the actual React selection/virtualization, and real Gin `search_integration_test.go` already validates Owner isolation, Node breadcrumbs, sorting and pagination. Neither combines the built **original Web/Mobile Web UI** with **real authenticated Gin/PostgreSQL Search**, a real search result's authoritative breadcrumbs, then the **Files-internal Back** returning to its original search query and viewport. Browser history and Files-internal history must not be conflated.

**Scoped U06-A genuine browser test:** Reuse already-live, fully migrated `TestIOS27FilesLiveGoFixture` and its existing actual CAS-backed fast-folder leaf `u01-fast-authorized.txt`, without adding a fixture Node, new backend method, API interception, permission change or production UI. In the same unmodified built Web Chromium, run independently at **390px Mobile Web** and **900px Wide Web** *before U05's later legitimate rename alters this leaf*. Enter global search through the real native Files textbox, require genuine Owner-authenticated `GET /api/v1/search?q=u01-fast-authorized&offset=0` with HTTP 200 and `total_count=1`, exactly the existing leaf Node ID and ancestor chain root→fast folder; do not accept synthetic REST bodies. Open its existing context-menu **显示所在文件夹**, await real Gin counted child GET and verified folder breadcrumb/title. Use Mobile's explicit `后退（浏览历史）` menu or Wide's existing `后退` control, never OS/browser `page.goBack()`; require original Search query, exact result row, logical-zero scrollTop and one unchanged virtualized scroll host. Record `u06RealSearchReturns=2` in actual native Chromium result and independent screenshots. Preserve all existing U01/U05/Copy/Move/Delete/Undo/Redo cases and original counts.

**Workflow/contract:** The four already opt-in Files real-Gin Chromium CI step gates in `.github/workflows/ci.yml` add exactly the narrow `test/files-u06-` prefix alongside prior `test/mobile-files-ios27-live-go-`, `test/files-u01c-` and `test/files-u05-`. Require actual test Step **success** (never conditional skip), exactly two real U06 results, and accurate-work-HEAD full 76-job CI including PostgreSQL API race, Desktop/Web/Windows/images/artifacts, single work commit and final-gate before Ready/Rebase. First failures must be classified as genuine original product failure vs setup/locator, not accepted on partial progress. Only original test runner, four CI guards and this ledger change; **no** production code or new synthetic HTTP response.

**Explicit remaining limitations:** This establishes real Linux native Chrome at the tested Mobile/Wide viewports, **not** real iOS27 Safari, Android Installed/PWA, Windows CfAPI, VoiceOver/NVDA, 100k physical scroll FPS, a deep logical search anchor, stale/unauthorized Search after session revocation, network outage/503 or true certificate failure. Full U06 and M05/OS navigation acceptance remain open. PWA S5 physical matrix stays **NOT RUN / NO-GO**.


### U06-A test review: require an actual returned Search state, not an identical file row

The initial draft test can see the same real CAS-backed file row in BOTH the Search result and its containing folder. Merely awaiting its filename after clicking Files Back is insufficient evidence that the Search entry was restored: the old folder row might still be mounted during an asynchronous history transition. Preserve the original real authenticated Gin Search query, breadcrumbs, containing-folder GET, Files Back action, scroll-host and query assertions, but additionally require the **actual Search presentation state** before evaluating the returned row: Mobile 390px must render compact heading `搜索结果`; Wide 900px must render the original `data-xdrive-file-explorer-search-summary`. This is an acceptance-oracle tightening, not a runtime bug fix or invented backend behavior. Retain exactly one work commit from an uncontended master, and use a **new** exact-head full CI with the real browser step successful; the older submitted SHA's CI cannot approve the changed test.



### U06-B first-red classification and narrow navigation correction (2026-10-17)

Exact old HEAD `1a6af6c33735ac464f37605d9007f122f59f6594` [CI #38944891764](https://github.com/lazyxu/xdrive/actions/runs/38944891764) first failed at a *preexisting* 900px U01 browser history waiter, with U06 not reached. Its failed-job retry **cleared U01 at both 390px and 900px** (actual counted HTTP/cancellation and OS browser Back). It then entered the **new real U06 scenario** and got Owner-authenticated Search 200, exact result Node and breadcrumbs, real containing-folder children 200, and an enabled Files-internal Back. After Back at 390px it timed out for the original `data-mobile-files-compact-title` displaying `搜索结果` (zero U06 results). No 5xx or JS page errors. This cannot be marked green or disguised by testing only the same filename (it also exists in the folder).

**Audited failure mechanism:** `web/src/App.tsx` mirrors a successful Files-internal folder change to `?dir=<NodeID>` by `launchWebApp(...,{replace:true})`. `WebFileExplorer.tsx` deep-link resolver currently treats *any* changed `initialDirectoryID` as a fresh external navigation and calls `navigateTo(chain,true,...)`, appending a redundant history entry after the internal `navigateTo` already committed the same folder. A single Files Back can therefore land in the duplicated folder instead of the Search-state history entry, although U01's separate **browser** history still passes. This is a **production UI navigation correctness** defect, not merely a text-locator test error.

**Scoped correction and required revalidation:** Only `WebFileExplorer.tsx` is changed in production, tracking the account-scoped directory ID emitted through `onDirectoryChange` *after an authorized internal load*, and acknowledging the next matching App `?dir=` update without a second `navigateTo`. External deep links, account changes and pending/cancelled navigation still use original validation/authorization. Keep the previously failing original browser runner **byte-identical**; its two exact U06 results and unchanged U01/U05/Copy/Move/Delete counts are the red-to-green proof. The CI YAML retains only the `test/files-u06-` opt-in. Rebuild one work commit on the now-merged U06 Server baseline `master@467d0c12608d7395f80577659bcf55cef3ad35aa` with the original #1894 integration and its ledger intact. Run a *new* complete exact-head 76-job CI and final gate; do not reuse either old red. True iOS 27/Android Installed/Windows physical S5 validation remains `NOT RUN` / NO-GO.


## F02-M · Mobile Web/PWA virtual button position descriptions (2026-10-17)

After #1901 passed exact-head 76-job CI #38955345527 (25 success, 51 conditional
skips, final-gate green) and rebase-merged at `master@3d9c228ca4524f6dabe1a5691f0b28a377e76cd2`,
review of the dedicated Mobile Files renderer identified a distinct F02
gap: its virtual List/Grid file controls are interactive `role=button`,
not the shared wide-Web/Desktop Details `role=table`. Do **not** put
`aria-rowindex` or `aria-posinset` on the button, reparent the controls,
change 68px row geometry, replace the iOS27 layout or fabricate a Server total.

For **each mounted** directory/Search/Trash file button, provide a
presentation-only `aria-description` with its **flattened logical index**
and complete `displayedCount`, including grouped and expanded inline entries.
The callback's separate source index remains unchanged. Recent and Favorites
virtual controls receive their actual collection index and entire
`sectionItems.length`; Browse Home shortcuts receive no fabricated position.
The existing accessible **name** (file name and selection), role, focus,
keyboard/touch/long-press, scrolling, REST, Server and virtualization are
unchanged. The pure helper rejects invalid positions. This is accessible
position **description**, **not** native table/list structural ARIA; wide F02
rowcount and rowindex remain as before.

One bounded work commit updates this ledger, `mobileFilesState.ts`, the
original Mobile presenter and its actual Node regression source/test.
Its exact-head full CI/final-gate must pass before Ready/Rebase Merge.
A Node test and compiled Web can verify the projected values and wiring, but
actual NVDA/VoiceOver/TalkBack announcement order and iOS27/Android Installed
behavior remain **NOT RUN**, as does the PWA S5 physical release gate.


## U05-B · genuine Owner visibility loss during open rename editor (2026-10-17)

**Frozen baseline:** after merged F02-M [#1911](https://github.com/lazyxu/xdrive/pull/1911),
the subsequent unrelated Admin/LocalPush merge advanced GitHub `master`.
Freeze `master@e5ff852e8a4fa6175d667b9d4daa55ddbd95e1e4` for exactly ONE U05-B test+ledger work commit on
`test/files-u05-visibility-loss-live-go-20261017`. The existing four native
Files browser workflow gates already include the `test/files-u05-` prefix,
so the actual PostgreSQL17/Gin/Chromium execution must be **success**, not
conditionally skipped. Preserve unrelated AGENTS/Admin/Gallery/Performance/
LocalPush/Race/PWA changes and #1901 quiet navigation.

**Exact semantics found in production:** authentic FileExplorer `PATCH /nodes/:id`
returns owner-scoped **404** if a Node is no longer visible, an actionable **409**
for stale `If-Match` or duplicate names, while the authenticated middleware's
**403 account_disabled** also revokes that user's session. A disabled or switched
account must not keep a prior user's interactive rename draft on screen merely to
satisfy a synthetic 403 presentation test. Cross-Owner attempts intentionally
return 404, not a fake 403. The existing U05-A already proves independent
genuine PostgreSQL 409 / retained draft and focus at 390 and 900 CSS px.

**New independent U05-B regression, no production change unless a real RED:**
the *same* built production Web/Chrome and isolated real Gin/PostgreSQL/Local CAS
fixture opens the actual Mobile 390px dialog and Wide 900px inline rename editor
on separate previously-authorized physical-CAS-backed folder leaves. While
each editor retains a draft, a second authenticated Owner connection sends
the exact legitimate `DELETE /api/v1/nodes/:id` with original revision and
receives **204**. Submit the still-open original editor: assert actual UI PATCH
retains original `If-Match` and exact draft, genuine Gin responds
**404 `node not found`**, the original textbox draft and keyboard focus
remain, and authenticated Owner GET confirms 404. No fake `/api/v1`
response, no adapter stub, no changed Server/Agent/Node permissions, and no
deletion of original worker/undo fixtures. Both independent cases must emit
`u05RealVisibilityLossRenames=2`; preserve all prior U01/U05-A/U06,
Copy/Move/Delete/Undo/Redo real API assertions unchanged.

**Acceptance boundary:** this is legitimate Owner visibility loss (404),
not a file ACL grant/revoke feature or an account-disabled 403 UI persistence
promise. It is native Linux Chromium with Mobile viewport simulation and
real Gin/PostgreSQL/CAS, not Safari iOS27, Android Installed, Windows CfAPI,
VoiceOver/TalkBack, or a real external administrator disabling an account.
Keep PWA S5 `NO-GO`. Full exact-head 76-job CI, real browser step,
single-commit/final-gate green and clean Rebase Merge are required.

### U05-B first exact-head CI: browser green, test-only Trash leakage (2026-10-17)

First work HEAD `b22418bf41e6cbc82e18a4ea82ee88a1f93276cf`, exact [CI #38961811175](https://github.com/lazyxu/xdrive/actions/runs/38961811175) was **RED**:
the original production built Chromium→real Gin/PostgreSQL17 script emitted
`IOS27_FILES_REAL_GO_RESULT {"passed":true,...,"u05RealVisibilityLossRenames":2,
"u05RealStaleRenames":2,"u01RealNavigations":2,"u06RealSearchReturns":2,
"errors":[]}`. Both new genuine 204→404→draft+focus UI cases passed, as did all
original browser-side Copy/Move/Delete/Undo/Redo cases. However the underlying
Go fixture's unchanged **D4 final Trash-empty oracle** correctly failed at
`files_ios27_live_go_browser_integration_test.go:709`: the two U05-B test
leaves had been deliberately soft-deleted in the negative scenario and
were still present in Trash. This is **new test state pollution**, not
evidence of a product rename, Undo/Redo, real PostgreSQL or virtualizer bug.

Keep the original Go D4 oracle entirely unchanged. After each completed
authentic Gin 404, browser editor draft/focus check and Owner GET 404,
close the original editor and use the genuine authenticated production
`POST /api/v1/trash/:id/restore` with exact post-delete `If-Match`.
Require HTTP 200, the same Node ID, current restored Revision and Owner
GET 200. Only then allow the other original Go test's Trash-empty invariant
to run. The restoration CANNOT run before the negative 404 evidence.

Reconstruct exactly **ONE** corrected U05-B work commit on the same frozen
parent `e5ff852e8a4fa6175d667b9d4daa55ddbd95e1e4`; previous CI is diagnostic ONLY. Require NEW complete
source-exact 76-job CI with actually executed real Gin Chromium and
unchanged D3/D4/Undo/Redo, then Ready/Rebase merge. No Server/Agent/Web UI,
permission rule, REST implementation or production test oracle is weakened.


## U09-D2c2 · Mobile Web/PWA native List/Grid owner reanchor after Server sort/group (2026-10-17)

- **Fixed baseline:** U09-D2c1 [PR #1944](https://github.com/lazyxu/xdrive/pull/1944) passed exact-HEAD full [76-job CI #38998513627](https://github.com/lazyxu/xdrive/actions/runs/38998513627), Ready/Rebase merged as `master@11e1c1579df5256a039b444268d5dd9481135f56`; its related old work branch was automatically removed. #1943 separately owns the shared Column View loading state, and is not modified by this Mobile work. Exactly one independent scoped commit is required on the fixed base.
- **Gap and scoped candidate:** Mobile Web / installed PWA use the dedicated iOS-style `MobileFiles` mounted List/Grid presenter and browser scroll owner, not the wide MUI Details renderer. Stage one selected current-directory Node or a mounted first-visible root before sort/group. Await a strict `true` from the existing shared Navigation only after the new first counted Range is committed. On a distinct authorized current-directory virtual interaction key use the **same** Web Server `childPosition` + shared `xDriveFileExplorerVerifiedChildReanchor` (one real bounded `collectRange(index,index)` validates original Node and Revision). Only then restore scroll via existing `mobileFilesViewportTop` + Server group headers, and a single selection when unchanged. Lock to account, directory, Browse section, sort/group, current generation, user scroll gesture and request-scope AbortSignal; never restart a cancelled stale task. Reuse same Web REST/virtual collection across Mobile Web/PWA, no duplicated file API or full 100k scan.
- **Hard boundary:** A selected child in an **expanded inline nested directory**, many selected IDs, global Search and Trash do **not** use the direct-child ordinal; leave their prior presentation unchanged until a distinct safe owner-specific phase. Never invent a Search index or remap an arbitrary root row to an inline child. No changes to iOS27 52px global App Frame, 900px breakpoint, native gesture/long-press dispatch, server sorting, trusted permissions, original bytes, thumbnail fetches or public PWA Service Worker cache.
- **Evidence:** extend original `desktop/tests/mobile-files-ios-runtime.cjs` mounted real presenter tests to assert actual accepted (not just requested) current-directory first page, 100k far-index authoritative lookup, one real viewport scroll change, persistent authorized Browse anchor, denied and stale-revision cases. Require exact HEAD full GitHub 76-job CI (real PostgreSQL Go API Race, Web TypeScript, Desktop Windows/Linux, single-work-commit/Final Gate) before Ready/Rebase. The fixture is mounted React and simulated DOM scroll, not a live mobile Safari/iOS27 screenshot, physical Android PWA OS install, or measured true 100k CAS latency. S5 seven-platform physical matrix remains `NOT RUN` / release NO-GO.

## U09-D2c1 · Wide Web/Desktop authorized current-directory reanchor (2026-10-17)

- **Baseline:** related U11 [PR #1940](https://github.com/lazyxu/xdrive/pull/1940) passed exact-HEAD [76-job CI #38996775414](https://github.com/lazyxu/xdrive/actions/runs/38996775414) and Rebase-merged as `master@c70f09f86242cb2a3716489f8c61d2111aef92b7`. U09 related PR/branch search empty; old U11 merged branch awaits cleanup workflow.
- **Source gap:** shared Wide Files resets scroll and selection after newly committed Server sort/group. D1/D2a/D2b supplied real signed Owner direct-child ordinal but no visual consumer.
- **Scoped candidate:** stage one selected Node or loaded visible anchor before a sort/group; accept an explicit success receipt only *after* the authoritative directory first Range commits. On new distinct virtual scope, use existing cancelable Web Server `childPosition` or Desktop capability-fenced Main→Agent→Go→Server relay, confirm the same Parent/Node/Revision/Sort/Group and true total, fetch just `collectRange(index,index)`, then validate the Node and Revision again before updating focus/selection/scroll with the existing real group offsets. Cancel superseded consumer with AbortController. No 100k scan, Search ordinal, Server ordering rewrite, additional original/thumbnail API, SW cache change or duplicate virtualizer.
- **Boundary:** D2c1 covers **wide Web/Desktop** only. Dedicated iOS27 Mobile Web/PWA List/Grid/inline presentation, multi-selection, Search ordering, real 100k physical CAS and OS/AT must receive independent D2c2+ tests. Keep PWA S5 seven-platform `NOT RUN`/Release NO-GO and 52px App Frame/900px breakpoint.
- **Evidence:** pure compiled Node helper tests verify one authoritative 100k ordinal, 1 bounded Range, invalid revision/Node/order and actual abort, plus original source-contract wiring. Must pass **NEW exact-head full CI** including Web/Windows/Desktop/Go PostgreSQL Race, single-work-commit/final-gate and mergeability before Ready/Rebase. No physical-device or real-browser frame measurement claimed.

## U09-D1 · Authenticated current Server child ordinal by stable Node ID (2026-10-17)

- After directly related #1912 U05-B passed [exact-head CI #38963394699](https://github.com/lazyxu/xdrive/actions/runs/38963394699), 76 jobs (25 success, 51 conditional skips, real browser PostgreSQL/Gin including U05 404/restore and original Undo/Redo), merged via Rebase as `master@39fa0af916810c480f48c85f78bbd5a388d06494`; its branch was independently absent. Freeze this master once for ONE bounded U09-D1 work commit; unrelated Admin/Gallery/LocalPush/Performance/PWA/Race branches stay untouched.
- Existing U09-A/B/C maintain viewport geometry and prevent a stale index falsely selecting a different Node, but DO NOT locate the original Node after a changed Server sort/group. Introduce a distinct authenticated `GET /api/v1/nodes/:id/children/position?node_id=...` API, optional whitelisted `sort/order/group/folders_first`, current Owner/session and active parent+child SQL scope. Compute zero-based `ROW_NUMBER` on the exact Server child-Range `ORDER BY`, with current Node revision. Response one neutral ID/revision/index/order tuple, `Cache-Control: no-store`; foreign, wrong parent, trashed or absent returns 404, malformed 400. No client 100k scan, fake group header or stale inferred offset. Refactor only the shared Server range ORDER BY and one sort expression into reusable functions so the two paths cannot diverge.
- Extend the existing genuine PostgreSQL children range integration with seven ordering/grouping configurations × eight Node identities, moved original c.pdf index, cross-account, bad input and delete/requery. No change to previous REST range wire contract or root/52px frame/900px/mobile gestures/CfAPI/PWA caches.
- **Delivery / strict boundary:** Server endpoint and authoritative correctness foundation only. U09-D2 separately wires typed Go Client/Desktop Agent and Web/Mobile shared adapters + generation-fenced reanchor after confirmed first Range; Search identities require independent Search-order query work. This phase is NOT actual 100k physical Node latency, automatic UI selection relocation, Windows/iOS/Android/VoiceOver, or PWA S5 physical signoff. Require single-work-commit, full exact-head Go PostgreSQL Race, Web/Desktop/Linux/Windows/images/artifact CI, Final Gate, Ready/Rebase and branch cleanup before follow-on.


## U09-D2a · Typed current-directory position transport (2026-10-17)

**Current progress:** U09-D1 [#1923](https://github.com/lazyxu/xdrive/pull/1923) passed its exact-work-HEAD full [CI #38968019612](https://github.com/lazyxu/xdrive/actions/runs/38968019612) (25 success / 51 conditional skips, Go API real PostgreSQL Range/position verification and Final Gate), Ready/Rebase merged as `master@617fea5400c10d25e63b1019c87550fa0ec1ad8b`, old related branch subsequently absent. Freeze newer unrelated Admin/LocalPush master `6bede4cc12a93b875814fcc2e966f24a4ea0facb` for this **one** independent D2a transport commit.

Add one shared Web/Mobile `XDriveCloudFilesPosition` DTO and pure exact identity/order validator; a signal-cancelable `XDriveApi.childPosition` Web transport; and matching `Client.LocateChildPosition(ctx,...)` Go REST transport. Require same Server `sort/order/group/folders_first` as range, valid Node ID/Revision, safe nonnegative logical index. Go rejects unsupported values and signed-bigint-overflow IDs before HTTP; Web rejects unsafe JS integer IDs and rejects a stale or mismatched result. No 100k enumeration, new Server route, mutation, duplicate business API, renderer-only Desktop HTTP, or extra thumbnail/original request. New Node source/validator and Go `httptest` regressions cover Bearer, request parameters, mismatched authority, malformed inputs and context cancellation.

**Evidence boundary:** transport/API foundations only. This does **not** automatically move selected rows or focus. U09-D2b must still wire Desktop Agent/Main/preload, generation-fence in shared Web/Mobile and Desktop workspace, cancel obsolete lookups, fetch bounded destination Range and verify exact Node ID and Revision before reanchoring. Search ordinal belongs to distinct Server search order and cannot use the immediate-child API. Real physical iOS27/Android/Windows CfAPI/VoiceOver/TalkBack and installed-PWA S5 remain NOT RUN/NO-GO.

Require exactly one fixed-parent scoped work commit, its own full exact-head CI including Web/Desktop/Go/Windows/single-commit/final-gate, Ready/Rebase merge and independently verify branch removal. Unrelated Gallery/LocalPush/Storage/Performance/Race/Admin branches remain untouched.

## U09-D2b · Desktop current-directory position relay (2026-10-17)

- **Fixed master after D2a:** #1925 passed full exact-work-HEAD [CI #38970644706](https://github.com/lazyxu/xdrive/actions/runs/38970644706) (76 jobs, 25 success/51 conditional skipped, final-gate and one-work-commit green), Ready/Rebase merged as `master@f21e551c5c132e269b0d95da2d79bda86ac68e3c`; old Files branch confirmed absent. This is one independent scoped D2b commit above that parent; unrelated PRs unchanged.
- **Transport only:** add exact capability `cloud-child-position` and authenticated Agent GET `/v1/cloud/children/position`, which forwards current Owner/session via `CloudLocateChildPosition` → Go `Client.LocateChildPosition(ctx,...)` → the existing Server direct-child Node identity endpoint. Reject extra/duplicate/unbounded parameters and mismatched Node/revision/order/group; no generic URL proxy or secret reaches the renderer. Electron Main validates strictly typed numeric and grouping arguments, refuses old Agent capabilities and untrusted response identity; Preload exposes one checked invocation, Renderer types reuse the shared position model. `viewportRequests` cancellation tears down the Electron Main → Agent HTTP → Go Server context on consumer abort. No Desktop Renderer bypass, 100k materialization, Server list sort rewrite or separate Gallery endpoint.
- **Tests/evidence:** Go token-authenticated loopback tests confirm one correct identity and canonical grouped position, deny anonymous/extra/duplicate/invalid IDs or ordering, reject mismatched returned Node/group. Desktop source-contract checks route/Go/Agent/Main/preload/renderer type and cancellation wiring. Require NEW exact-head CI with Go PostgreSQL API/Race, Web/Desktop, Windows, single-commit/final-gate before Ready/Rebase merge; static tests do not imply physical device accessibility.
- **Still not done / U09-D2c:** trigger lookup only for preserved selected/scroll identity when Server sort/group changes; fence session/navigation/generation, cancel superseded requests, fetch one bounded authoritative target Range, check exact ID+Revision and full group offsets before moving focus/selection/scroll, and test 100k sparse with real Server. Search needs its own authorized Search order lookup; this child endpoint must never be reused. Physical iOS27/Android, NVDA/VoiceOver/TalkBack, Windows CfAPI and S5 installed PWA remain NOT RUN/NO-GO.

## M08 · Browser folder chooser must not silently flatten absent relative paths (2026-10-17)

- **Source-level gap:** Web/Mobile Web/PWA share `web/src/WebFileExplorer.tsx`'s native `webkitdirectory` file input and `web/src/App.tsx`'s group uploader. Previously picker `FileList` entries used `file.webkitRelativePath || file.name`; when a browser omits relative paths this silently flattens nested directories into the destination. A picker also supplies no reliable manifest of purely empty directories, and a zero-length FileList cannot distinguish cancellation from selecting only an empty folder. This is source evidence, not a claim about which physical iOS/Android versions supply the property.
- **Bounded M08 behavior:** Before folder-picker upload begins, show one nonblocking truthful empty-directory limitation notice per mounted Files workspace. If any selected file lacks a usable relative-path separator, refuse that whole picker submission with a clear no-upload warning rather than silently flatten files. When all names have valid nested paths, reuse the same shared upload-group/Server permission pipeline, exact relative paths and existing current-directory refresh. After an actual non-cancelled, nonfailed group with uploaded/skipped items, explain that files were processed but purely empty directories may not have been created. No success message on cancelled/failed/idle work; selection with no files remains a silent ambiguous no-op. Ordinary single-file upload and drag-and-drop directory-entry manifests are unchanged.
- **Verification:** Existing Web original picker test asserts captured parent scope and the one-time caveat; a new Desktop Node source-executed test compiles the actual `App.tsx` folder handler to exercise missing path, nested paths, canceled/empty/failed/idle receipts, exact unchanged group call and truthful output. Exact-head full CI (Web TS/lint/build, Desktop, Go PostgreSQL API Race, Windows, single work commit, Final Gate) and clean mergeability are required before Ready/Rebase. Physical iOS27 Safari/Android picker, multiple nested empty directories, system cancel behavior and installed PWA S5 remain **NOT RUN** and must not be upgraded based on this code-only safeguard.

### M08 accurate-head first CI finding — inherited unsafe fallback oracle (2026-10-17)

- Initial exact work HEAD `0d3bc0cacba6564f7e9681b66da31af3563a2fea` executed [CI #39007569213](https://github.com/lazyxu/xdrive/actions/runs/39007569213). New M08 original-production App handler tests (no-mutate absent relative path, valid hierarchical entry, cancelled/failed/idle truth) passed; Web build and original Desktop source suites other than one old assertion passed. `desktop/tests/web-file-explorer.cjs` historically asserted literal `relativePath: file.webkitRelativePath || file.name`, the unsafe flattening fallback intentionally removed in M08. This is an obsolete test oracle, not proof the new source failed to preserve valid hierarchy; the first exact-head CI is RED and cannot authorize merge.
- Correct ONLY that inherited oracle to require `relativePath: file.webkitRelativePath`, assert no fallback to flat filename and preserve all original Web upload picker/Server tree/create/Group/parent checks; keep original App/Web source blobs and new actual-handler tests unchanged. Recreate exactly one work commit on the SAME frozen parent `7046550f672a7ff7c9349f5e7a2a948dd7b37de9` and rerun a completely new accurate-head full 76-job CI incl. Desktop/Web/Windows/Go PostgreSQL API Race/single-commit/final-gate before Ready/Rebase; other Files P43/P44 branches untouched. Physical iOS/Android/PWA folder picker remains NOT RUN.
