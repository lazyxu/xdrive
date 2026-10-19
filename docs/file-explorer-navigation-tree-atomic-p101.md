# P101 · Verified FileExplorer tree disclosure without height interpolation

## Source defect

The original shared Web/Desktop FileExplorer navigation tree used `<Collapse in={expanded} timeout="auto" unmountOnExit>` around lazy children. Clicking an uncached directory expanded an empty 0px tree and began the real Server/Agent read. A second height change occurred when the first paginated children arrived; the auto-duration animation could visually shift the sidebar twice.

## Scoped correction

Keep the original disclosure treeitem mounted, truthfully aria-busy and cancellable while its real paginated GET starts immediately. Stage a cold expansion ticket scoped to the Owner lifecycle, loader generation and current activation; only accepted first page allows one child group to mount. No CSS height animation, fake Loading row or replacement chevron spinner. A second activation cancels the pending **visual** ticket, not the real network request; stale/error replies cannot resurrect it. Cached accepted groups toggle synchronously and use no new GET. Auto paging/cursors for 100k, error propagation, drag/drop, thumbnail and real transfer feedback all remain.

## Regression and release constraints

Mounted ORIGINAL shared NavigationPane tests cover >370ms held first GET, one verified group commit, cached disclosure, genuine page-2 pagination, cancellation of a visual ticket, failure/retry, and shared Web/Desktop transports. Existing P71 sidebar/real race tests stay active. Rebased as a single work commit on complete master `9987a4c6b7bf7e978b4268469041bfa54d5f7993` after merged P100; this version corrects the real stale source guard assertion and supplies useLayoutEffect to the existing account-lifecycle test harness, without weakening its checked behavior. Complete exact-head 77+ CI (genuine PostgreSQL Go API Race, Web/Desktop Windows/Linux, Rootless/packages/one-work-commit Final Gate) plus fresh GitHub clean mergeability required before Ready/Merge. Native iOS Safari/Android/PWA, WAN, physical 100k CLS/FPS are NOT RUN here; no universal zero-jitter claim.

## Verified zero-leaf evidence

A current first page with no children and no next cursor is an authenticated leaf: keep its treeitem and remove its disclosure affordance, but do not mount an empty role=group. The original mounted P101 suite verifies zero-child, cancellation and paginated nonzero separately.

## Rapid repeated disclosure on one in-flight first GET

A second tap can cancel only the pending **visual** expansion, then a third tap can request it again while the Server/Agent GET remains active. The original loader correctly coalesces duplicate requests but returns early; a Promise completion callback on that second caller is not a valid Range receipt. P101 therefore observes the authenticated current page and loader busy state in a pre-paint layout effect, commits only the most recent pending visual ticket, and keeps the genuine one-request network semantics. Added original mounted >370ms triple-click regression.
