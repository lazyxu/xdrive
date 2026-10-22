# P073 · Real mounted hidden 100k Share cursor page request → Go Context.Done

Source: current complete `master@ecaaae7243568705732d31d5870db320f062a944`. CURRENT/BEFORE for this **new dimension** is **Not yet measured, n=0**. Product AFTER/speedup N/A. Exact physical corpus and source/CAS/Go negative checks are unchanged from merged SH-P021; this work is test-only.

## Why
P072 [#2326](https://github.com/lazyxu/xdrive/pull/2326) proved real mounted-hidden **thumbnail signed GET** cancellation 6/6, max **28.080ms**, 0 abandoned bytes. Previous Files↔Gallery SPA and Share pagehide/scroll tests likewise already merged. None proves a **still-in-flight Share directory cursor metadata HTTP POST** is canceled while original 100-row `XDriveFileExplorer` remains mounted and the window is simply hidden.

## Unique authentic test

1. Same actual authenticated Gin/PostgreSQL17/LocalCAS production Share route with 100000 different physically allocated SHA-256 JPEG originals and 1 protected outside Share scope sentinel. No fake Share token, no synthetic list, no arbitrary 100k DOM mount.
2. Web1440 and CDP390 each n=3 independent Chromium sessions. Open one authorized bounded 100-row first Share page, retain its real common FileExplorer DOM. Arm exactly **one** test-only body gate, then click actual 下一页; `router.ServeHTTP` still performs Go token/password/revoke/root/cursor/Owner authorization before test-only Write blocks on its real `Request.Context().Done`. One-shot gate avoids catching next browser's first page.
3. Confirm actual second cursor POST already entered original Gin response body (non-zero held Handler), then actual `BrowserWindow.hide()`; require real `document.hidden`/visibilitychange, **same URL/document/connected virtual scroll host and old accepted first-page pixels/rows**, no pagehide/beforeunload or synthetic events.
4. Require **six Go Context.Done** + Handler exit in <=160ms each, **zero** extra stale response bytes and held Handlers; no original user download started; original first page <=2s and bounded 100 items; preserve Owner API isolation and signed/expiry/root negative tests. Track max Go time, HTTP calls, exact source SHA, CPU/RSS artifacts.
5. Frozen tests run on exact HEAD plus full Web/Desktop/Windows/Linux/Go real PostgreSQL API and Final Gate. Do not accept a failed new test or relax the 160ms/100k source. If real product latency exceeds budget, diagnose before changing performance code; use paired same-runner n>=3 before/after and retain only material benefit without integrity/RSS/CPU/security regressions. Race code stays untouched.

Only the _browser-list request_ is ephemeral. A user-started durable ZIP, original download, SyncRun or delete is a distinct task and this test does not claim its complete physical long-running survival. Physical iOS, WAN, 15k independent MP4 scenes and all 100k simultaneous thumbnails are not represented.

Production-only safety acceptance unavailable to ChatGPT: **按用户决定跳过（未验收）**. Source-level Owner/Share authorization and true CI remain required. Already-merged AGENTS.md contains matched baseline/optimization retention rule; no duplicate policy edit required.

**Draft until actual accurate HEAD real 100k native n3, full cross-platform CI and fresh GitHub clean.**

## Accurate initial RED and formatting-only correction (2026-10-22)

Exact original P073 HEAD `12785299f3afa86c321d5de6bfd56a32b9334c07` [native specialty run #39709118299](https://github.com/lazyxu/xdrive/actions/runs/39709118299) **FAILED before real physical source/Go/browser execution**: the unchanged strict `gofmt -l` check rejected only the six new `list_* ` statistics fields' alignment spaces. CI `gofmt -d` emitted the exact six-line alignment patch. This is an invalid-to-benchmark source-format RED, **valid 100k native samples n=0**, not a successful or failed original list cancel. Preserve it.

Correct only those six lines from the exact runner gofmt diff, retain the original unchanged Go authorization, 100k distinct physical JPEG fixture, test-only one-shot response-body gate, 160ms Go cancellation and zero late-body-byte budgets. All five test/workflow/doc source files are rebased on complete newer master as a SINGLE work commit; no production Web/API/Go Worker/SQL/Race or user's durable task actions are modified. New exact-head six real Chromium/Go 100k and full CI/Final Gate must independently PASS before Ready/merge. Production-only inaccessible acceptance: 按用户决定跳过（未验收）.

## Exact original P073 real physical 100k CURRENT measured (2026-10-22)

Successful original exact-source native [#39709412080](https://github.com/lazyxu/xdrive/actions/runs/39709412080), SHA `9fe9abbe034adbfbe005638e3e0f8fdb3074d6b8`, **6/6** independent Chromium sessions (Web 1440×3 and emulated Mobile 390×3). Real authenticated Share **next cursor POST** response was already entered and held in original Gin Handler with the first 100-row unified Explorer still mounted, then actual `BrowserWindow.hide()` emitted exactly one visibilitychange per session, **zero** pagehide/beforeunload, same URL/document/scroll host and accepted previous page.

- **True Go Request.Context().Done:** 6/6; measured per-event delay for 1440px **10.599 / 30.476 / 28.819 ms**, 390px **2.201 / 2.172 / 1.741 ms**. **Worst 30.476 ms**, below frozen **160 ms**. (The `go_cancel_max_ms` field in each row is a *cumulative* worst-so-far; do not treat it as the per-session event time.)
- **Discarded HTTP response bytes 0**, **stuck Go handlers 0**, **original user downloads 0**, authenticated Share first+next pages **12 POSTs** total, **100,000 distinct physically allocated JPEG originals** (not all thumbnails simultaneously decoded).
- Source-exact first bounded Page worst: 1440px **360.405 ms**, 390px **275.524 ms**, both under frozen 2s. The actual source seeded **100000 different SHA-256 physical JPEG CAS originals + one private sentinel**.
- Original anonymous machine JSON and six raw sessions preserved in [P073 native evidence](performance-evidence/p073-share-hidden-list-go/ci-run-39709412080.json); source's original [Actions log](https://github.com/lazyxu/xdrive/actions/runs/39709412080) remains an independent reference. This is **CURRENT/BEFORE**, no product Go/UI/SQL transport patch; matched AFTER/speedup **N/A**.

**Accurate-head rule:** Adding this permanent evidence and index produces a new single-work HEAD; original previous-head n3 green does *not* authorize the new HEAD. Repeat this PR's real 100k Go/Chromium specialty, full 77+ CI/Final Gate and fresh clean mergeability on final archive HEAD before Ready/merge. No Race, original/share security changes or user durable cancel changes.
