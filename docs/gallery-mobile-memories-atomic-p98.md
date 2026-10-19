# P98 · Mobile Web Gallery Memories verified first-list commit (2026-10-19)

## Source-confirmed navigation jitter

The original `loadMemories()` unmounted the currently authenticated Gallery photo wall, cleared its sparse virtual range, and reset the active Memory before the asynchronous real `source.listMemories` index fetch had succeeded. Compact toolbar/Collections navigation also showed the Memories section and hid Collections immediately, so slow/failed requests could expose a transient false-empty screen.

## Corrected source boundary

Reuse the original Gallery `loadMemories(onCommitted)` with a staged commit: send the normal Owner list GET immediately, preserve accepted photo/index/scroll geometry while pending, and only after the current request succeeds (including a verified empty []) atomically clear the obsolete virtual range, replace the Memories index, commit its section and route and dismiss Collections. Failed/superseded reads cannot commit. Mobile verified-index Refresh and Back from a Memory photo wall also defer the clear; wide Web/Desktop keep their existing immediate behavior. No duplicate API, no loading timer, no changes to thumbnail/poster/Live Photo/real upload/download/sync feedback.

## Regression and remaining evidence

New `desktop/tests/gallery-mobile-memories-atomic-p98.cjs` mounts real shared Gallery Navigation with actual source-extracted React callbacks; covers >365ms, failure/retry, stale generation, true zero, Wide parity, plus source exact refresh/return guards. Preserve prior P78/P93/P95/P96 tests. Run entire exact-HEAD 77+ CI with true PostgreSQL Go API Race, Web/Desktop Windows/Linux, Rootless/packages/single-commit Final Gate; require fresh clean PR before merge. Real built Chromium 375/390/899px, native iOS Safari/Android/installed PWA, weak WAN and physical 100k CLS/FPS NOT RUN here. Do not claim universal zero layout jitter.
