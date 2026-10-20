# P105 · Verified zero directory must not blank during an unrelated FileOperation

## Source-backed defect

P104 (merged #2177) ensured that ordinary Mobile Files Home, row, Quick Access and typed-path **navigation** uses the real CloudFiles `directoryLoading`, not the composite `loading`. However the original `MobileFiles` zero-state code still used the composite value for `acceptedEmptyDirectoryRef`, `zeroStatePending` and `coldDirectoryFirstRead`. With a current authenticated first Range returning `total_count=0`, `directoryLoading=false` and `loading=true` (a durable Copy/Upload/Delete still active), the initial empty response could yield an entirely blank content area rather than the truthful `此文件夹为空`; the message appeared only when the unrelated task completed.

## Scoped original production change

Compute ordinary Browse empty/cold pending from the same Owner-scoped CloudFiles first GET as navigation itself. Mark accepted zero once current counted virtual Range is present and **owner** loading is false, even when composite operation busy remains true. Preserve 180px empty/cold/error geometry, truthful `aria-busy` for actual directory refresh, and the already accepted empty message across held refresh, failure and later independent task completion. Search/Trash continue to use their own composite/network feedback when appropriate. No fake folder spinner, no delay to network requests, no change to Web/Desktop shared API, cancellation, 100k virtualization, thumbnails/video posters/Live Photo or transfer progress.

## Acceptance matrix

Original mounted `MobileFiles` test: cold first GET silent; exact counted-zero `virtualCollection` arrives while `directoryLoading=false,loading=true` and must immediately show empty with one scroll host; actual refresh `directoryLoading=true` over 355ms retains accepted message/geometry; task completion causes no second flash. Source-exact guards verify owner-bound blank/empty decisions and Search/Trash exceptions. Retain P61/P62/P75/P78/P88/P104 suites and full exact-head CI. Native iOS Safari/Android, installed PWA, slow WAN and real 100k CLS/FPS NOT RUN absent execution evidence; no universal zero-jitter claim.
