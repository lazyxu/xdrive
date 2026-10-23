# P1E · Diagnostic source-exact route transition T→S→S→T (2026-10-23)

## Question

The merged shared Files/Gallery/Viewer lazy routing (#2408) saves 13.093%
of public initial gzip, but authenticated 100k/115k metadata Go Request.Context
cancellation has a repeatable descriptive **~42 ms** B−A delay in the
balanced A–B–B–A trial (#2426). It remains unclear how much of the delay
comes from the React route transition boundary versus module-load/OS jitter.

## Controlled experiment

Freeze the SAME exact #2408 production source release
`7515c421412666893e4b0519e4b5869d988bf8e1` twice. The second
copy is a disposable CI worktree, modified only by removing its
two `startTransition(() => setRoute(next))` wrappers and now-unused
import in `web/src/webAppRuntime.ts`, verified by original Git blob SHA
and new file SHA-256. This does not modify master or propose a patch.

Build both genuine Web apps with the same Go/PG17/CAS kernel, and measure
T→S→S→T, each n=3 real owning Chromium/Electron 390px 100k logical
/115k metadata. Original benchmark bytes and Go fixture must remain
identical. Require 4–6 in-flight JPEG responses, genuine Go Context.Done,
<=160ms, zero discarded-after-cancel bytes, plus Go/Renderer CPU/RSS.
Report both S−T directions and their balanced descriptive gap. Perform
native Files↔Gallery GUI return and 52px header checks for the test variant.

## Boundaries

Even a reduced Go cancellation P50 would not authorize adopting the
synchronous route update: it might cause initial unloaded Gallery/Viewer
flicker, lose accepted-anchor stability, or increase decode/JS/network
contention. Production optimization remains **NOT IMPLEMENTED** and
causal attribution **NOT ESTABLISHED** until independent repeated evidence,
real Owner ACL/Viewer return, P78 no-jitter, and matched 100k first-visible
media measurements support one exact minimal patch. This experiment does
not prove complete 100k/115k distinct physical originals or physical iOS/
Android installed OS lifecycle. All artifacts contain anonymous metrics only.

Production-only inaccessible safety acceptance: 按用户决定跳过（未验收）.
Code-level Owner/ACL/privacy/cancel and exact-HEAD full CI remain mandatory.


## 2026-10-23 · Source-exact initial CI failure and isolated retry

Original HEAD `94652369` successfully executed the actual T→S→S→T
authenticated 100k benchmark and produced its anonymous report. The
subsequent **separate Mobile Web route geometry step** failed *before
launching a browser*, because `mobile-web-app-browser.cjs` requires
Playwright and the workflow provided neither `playwright` nor the
`XDRIVE_PLAYWRIGHT_MODULE` binding. This was a **test-driver setup
failure**, not evidence of a product route failure or a passing Viewer
regression. This revision installs only `playwright-core` in an isolated
CI directory and supplies the real OS Chrome executable, retaining the
unchanged original navigation assertions. All actual benchmark and
navigation gates must rerun on the new accurate HEAD.

## 2026-10-23 · Native navigation test-gate correction

The accurate prior HEAD `598b8515` **successfully completed** real Owner 100k
T→S→S→T measurements (S−T cancellation difference around −51.511 ms) but
its follow-up Chromium navigation step exited 1 **after** the single-session
`gallery-ios27-chrome` script reported 58 checks passed. The dedicated
`p0c2-summary.json` represents three independent OS browser sessions only
when `XD_PWA_P0C2_NAV_BEFORE=1` is explicitly set; previously the workflow
incorrectly asserted that shape without enabling its producer. This is a
*test-oracle configuration failure*, not proof that Viewer navigation regressed
or that the product optimization is safe.

The new test-only workflow requests the exact three-session P0C2 navigation
producer with its original source HEAD, checks 3 sessions and 18 transitions,
and runs `gallery-ios27-viewer` separately on the same temporary synchronous
route variant. Both now must really execute and succeed on the new HEAD before
merge. The original production Web, SW and Go source remain unchanged; no
measured speedup or causality is claimed from historical RED or partial PASS.
