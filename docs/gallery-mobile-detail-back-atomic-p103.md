# P103 · Mobile Gallery detail Back atomicity

## Source defect
The shared MediaGallery owner already stages compact **entry** into Albums, People/Pets, Media Type and Place photo walls. The original `leaveCollection` had asymmetry on **Back**: Pet called `setCurrentPet(null)` immediately, while Media Type and generic Album/Person/Place Back changed view filters / collection index before calling non-staged `loadFirstPage`. That non-staged call resets the 100k sparse `virtualCollection` before its network first Range, producing a transient wrong/empty frame, shifting scroll and possibly restoring the Viewer anchor twice.

## Scoped correction
Mobile Web Pet Back passes a current first-Range `onCommitted` callback and clears Pet only after it succeeds. Generic compact detail Back similarly commits active media type, filter/query, and Collections return **after** the real Server/Agent bounded Range0 authorizes the target. Previous visible tiles/title/scroll persist through fast, >350ms held, failure, retry, cancel and supersession. Real verified zero commits; no fake Loading/skeleton and no delayed network request. Legacy wide Web/Desktop eager behavior is unchanged. No duplicate backend API, no second virtualizer, no thumbnail/poster/Live or upload/download change. Already staged Cleanup, Memories and nested Sync Folder Back remain their original owners.

## Acceptance
Run original React-mounted callback+navigation harness with held >365ms, failure/retry, latest-only result, verified zero/nonzero and Wide parity. Source-check the original `leaveCollection` entrypoint, shared `loadFirstPage` authenticated gate, source/transport equivalence, and presence of P103 AGENTS policy. Full accurate-head CI including desktop-tests, real Go API PostgreSQL/Race, Windows/Linux Web/Desktop, Rootless/packages and Final Gate plus fresh clean mergeability is required before merge.

Built browser Mobile 375/390/899px, native Safari/Android, installed PWA, real WAN, 100k physical CLS/FPS are NOT RUN unless executed and recorded. No claim that all platform jitter has been eliminated.
