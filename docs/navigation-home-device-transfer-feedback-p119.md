# P119 · Stable Home, Device Backup, Transfer Popover feedback

Date: 2026-10-20. Original shared UI Source scope, not a new Server/API behavior.

**Home:** status notices formerly entered a conditional Stack above MetricCards, changing dashboard geometry after unrelated async work. Move the exact real title/tone/message into one fixed bounded safe-area-aware overlay outside the ordinary metric Stack. Keep pointer access to actionable content.

**Device Backup:** a local Desktop result, failed overview or failed further device read formerly inserted ordinary-flow alert rows. Move these to one fixed bounded owner outside the accepted device overview. Per-device folder read failures are absolutely positioned as the final child of its existing scoped relative action Stack. History errors are placed inside the original mounted 72px relative history list owner. All verified first read, own-device push permission, agent authority and real refresh progress remain.

**Transfer Popover:** suppress the temporary visible `正在加载传输记录…` status and spinner. Use a 64px silent `aria-busy` first-read slot; verified empty has the same floor and truthful message. Do not suppress actual transfer speed, bytes, errors or cancellation.

**Regression:** original mounted Home P80 warning arrival/dismissal keeps identical MetricCard TestInstance, and original Device JSX ancestry plus Transfer first-read test P119. Require full new source-exact CI and Final Gate. Native Safari/iOS/Android/PWA, WAN and real 100k CLS/FPS: NOT RUN.

## Exact original P119 first-red (legacy source contract, corrected)

Initial source-exact Desktop [CI #39407239442](https://github.com/lazyxu/xdrive/actions/runs/39407239442) ran **3,399 tests** (3,396 passed, 2 failed, 1 skipped). Its two failures were original source-only tests expecting the superseded literal `sx={{ minHeight: 72 }}` (history owner now *also* needs `position:'relative'`) and `alerts.length > 0` (Home status is now in one always-mounted fixed owner). All other original tests including the new P119 mounted Home and JSX ancestry gates passed. Updated the **original** P63 and shared Home assertions to require both unchanged 72px/error semantics and the actual floating notice mapping/title/tone/pointer interaction. No original assertion removed, no Home/Device/Transfer production source changed. The old RED workflow cannot authorize merge; run NEW exact-head full CI.
