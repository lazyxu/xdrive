# P116 · Local Storage late feedback without page jumps (2026-10-20)

## Source-confirmed defect
In shared `ui/shared/src/mui/LocalStoragePage.tsx`, a loaded page still rendered `error` and `notice` as conditional ordinary-flow `XDriveStatusAlert sx={{mb:2}}` siblings above the original cache metric grid, Desktop storage stats and folder policy tree. Every background refresh failure, failed change, or successful cleanup receipt shifted the entire accepted page despite no new destination. This affects Web, Mobile Web and Desktop sharing that component.

## Minimal repair
- First-ever unverified Owner read keeps its existing silent 180px slot; real cold failure stays in the identically-sized first-read error slot, with no fake empty stats.
- Once the accepted snapshot is present, errors and real cache-operation success feedback live in one bounded `position:fixed` overlay with safe-area offset and no layout footprint, `role=alert` or `role=status` as appropriate. It is pointer-transparent because it has no interactive controls; the original Refresh/Confirm/Cancel/Policy controls remain unchanged and accessible.
- Preserve snapshot, sidebar app frame, original Server/Agent transport and auth, all cache operation effects, semantics, and real progress on actionable operations. No new timed spinner or request.

## Original mounted regression
`desktop/tests/local-storage-feedback-no-reflow-p116.cjs` mounts the actual shared `XDriveLocalStoragePage` with the original page controller: after a genuine accepted read, trigger a rejected refresh then successful cache clearance and assert the exact same original MetricCard TestInstance is retained, both receipts are visible but zero-flow, and refresh errors never masquerade as first-read failure. Also assert cold terminal failure retains minHeight 180. Preserve existing `workspace-storage-quiet-loading.cjs`, `local-storage-management.cjs`, Desktop/Web/Agent tests.

## Gate and limits
One work commit; require new exact-head full CI (genuine PostgreSQL API Go Race, Linux/Windows, Web/Desktop, Rootless/images/installers and Final Gate), fresh mergeability. Physical mobile Safari/Android/PWA/WAN/100k CLS/FPS NOT RUN; source+mounted tests alone cannot prove actual device no-jitter.
