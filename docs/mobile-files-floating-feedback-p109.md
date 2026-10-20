# P109 · Transient Mobile Files feedback must not resize its only virtual scroll host

## First-red root cause · 2026-10-20

The original `MobileFiles` component rendered four feedback classes directly between its flex-grow virtual scroll host and the footer navigation: durable action feedback (`actionFeedback`), 100k Select All progress (`selectionLoad`), selection warnings (`selectionFeedback`) and bulk-action capability limits. Each conditional row used `flexShrink:0`, so showing or removing it shrank/expanded the scroll viewport, invalidating visible range geometry and producing a scroll jump. This is distinct from genuine network thumbnail or folder GET loading. P78 had already prohibited transient in-flow rows but this path remained.

## Narrow scoped production correction

One existing `web/src/MobileFiles.tsx` subtree now keeps all four real feedback classes in a single position-absolute overlay relative to the already-mounted Mobile Files frame. It is anchored above the iOS-like footer using `env(safe-area-inset-bottom)` and has bounded viewport height. The overlay never participates in flex sizing, so a new action receipt or a Select All progress tick cannot move the header, scroll owner or bottom footer.

The overlay itself ignores pointer events, while its real action feedback child accepts them so any existing controls remain usable. Real 100k Select All counts, selection cancel, warning/limits, errors, global Search/Trash, user-visible transfer progress, file/media thumbnails, Live Photo and the original Server/Agent routes are not removed or delayed. No new timer, virtualizer, endpoint, query, transport or business state.

## Source/original React regression

`desktop/tests/mobile-files-ios-runtime.cjs` extends the genuine 100k Select All in-flight/cancel test to assert the progress node is inside the absolute overlay. It retains the original request-range and AbortSignal assertions. The original mutation-limit test now asserts its reason is inside the same overlay, not an in-flow sibling. An additional mounted test toggles actual `actionFeedback` on/off and checks that the same scroll-host TestInstance survives both commits, the feedback stays readable, and interactive controls retain pointer-events. A source-exact P109 test verifies that every transient feedback type is inside the single absolute owner and that `flexShrink:0` cannot reappear in the feedback subtree. It checks the original one scroll host, thumbnail provider and Search/Trash feedback are intact, and that `AGENTS.md` contains the rule once.

## Acceptance

Require a new full exact-head CI (original Desktop/Web tests, real PostgreSQL Go API Race, Linux/Windows builds, Rootless/installer/packages, single-work and Final Gate) and fresh clean mergeability before Ready/Rebase merge. These original React tests do not prove real iOS Safari/Android/PWA/slow WAN or physical 100k/CLS/FPS; report those environments **NOT RUN** rather than invent measurements. Do not conflate this scoped feedback-surface fix with independent Gallery Map/Sharing/LocalPush/Performance branches.
