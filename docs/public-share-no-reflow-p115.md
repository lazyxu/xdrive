# P115 · Public Share FileExplorer async-status geometry and same-page identity (2026-10-20)

## Confirmed source hazards

- `web/src/PublicShare.tsx` added mutable `folderError` directly after the mounted shared Explorer inside `Stack spacing={2.25}`, and expanded a `minHeight:24` ZIP status row with variable-length `zipError` or `zipNotice`. Network completion/failure could shift the page despite an unchanged folder and accepted Server page. An exhausted/download notice also inserted or removed a regular-flow status row ahead of the Explorer.
- `ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx` cleared its `pageFilter` and selected ID when the `items` array **reference** changed, including a refresh of the exact same accepted 100-item page. Because the old reset used `useEffect`, a real different page could also momentarily paint with the previous page's filter before resetting, showing an unnecessary intermediate result set.

## Minimal correction

- Keep the original metadata-first-read 180px quiet slot and actionable initial metadata error when no Explorer exists.
- One permanently mounted, bounded, safe-area-aware `position:fixed` status owner is a **direct child of the existing unspaced read slot**, outside the MUI spaced share Stack; folder GET errors, ZIP successes/failures, download notices/errors and exhausted eligibility stay visible, truthful and without pointer capture. No generic folder spinner; actual durable ZIP preparation retains its explicit 24px one-line slot, real loading button and cancel.
- A bounded `useMemo` accepted-page identity based on parent directory and at most 100 authenticated item IDs avoids resetting local selection/filter merely because the Server returns a new array containing the same page. `useLayoutEffect` performs an actual folder/keyset-page reset before the browser paints the new content. Preserve cancellation, 100-item page bound, share-only capability and all APIs.
- Original mounted `desktop/tests/web-public-share-form.cjs` checks same-page filter+selection preservation, real nested navigation, failed GET and failed ZIP feedback outside the Explorer stack, no change in mounted Explorer DOM. New source contract `desktop/tests/public-share-no-reflow-p115.cjs` verifies JSX owner ordering and canonical API/AbortSignal.

## Gates

Exactly one work commit; fresh full exact-head 77+ CI with Go PostgreSQL API Race, Web/Desktop Linux/Windows, Rootless/artifacts/Final Gate; `mergeable_state=clean` before rebase merge. Original P90 and public share safety/non-owner-permission tests stay unchanged. No claim of physical iOS Safari/Android/WAN or 100k CLS/FPS without real measurement. P78/P112 AGENTS permanent rules already prohibit these in-flow statuses and stale visible states.
