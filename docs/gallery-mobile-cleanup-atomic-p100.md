# P100 · Mobile Gallery Cleanup uses one verified first-list commit

## Confirmed jitter in original shared Gallery

After P95–P99, compact direct Cleanup navigation still changed section/query/route before the asynchronous first BurstReview list was accepted, whereas the Collections card already staged this fetch. The old path could reveal an empty or unrelated photo wall during a slow/failed request. Refresh of a verified Cleanup index, Back from Cleanup detail and post-delete refresh also called eager loadCleanup and reset the sparse virtual list before verification.

## Scoped correction

Move the existing openCleanupFromCollections helper before selectSection and reuse it for compact direct navigation, Refresh, detail Back and post-delete updates. The real source.listBurstReviews(48,0) starts immediately; only a matching request response (including verified zero) commits Cleanup section/query/route and resets the old sparse range. Mark routeSectionAppliedRef before the route callback to prevent echo requests. Keep Collections mounted for pending external Cleanup routes. Wide Web/Desktop behavior, network APIs, thumbnail/video/Live Photo, transfer progress and 100k virtual paging remain unchanged.

## Test and delivery gate

Original Gallery Navigation is React-mounted and production callback declarations are executed directly in desktop/tests/gallery-mobile-cleanup-atomic-p100.cjs. Held >365ms, failed/retry, stale, verified zero and Wide parity are covered, with source-exact Back/Refresh/route guards. Full 77+ accurate-head CI with true PostgreSQL API Go Race, Web/Desktop Windows/Linux, Rootless/packages, one-commit Final Gate and fresh GitHub clean mergeability are mandatory. Physical Safari/Android/installed PWA, real WAN and physical 100k CLS/FPS are NOT RUN; no universal device-level no-jitter claim.

## First CI regression diagnosis (2026-10-19)

The first exact P100 head ran full CI #39276084812. The only Desktop failure among 3,306 tests was the pre-existing original G11 standalone callback harness, which extracted the completion useEffect without a value for the newly referenced mobileGalleryViewport, and would similarly lack the compact owner-first-list callback. Correct this original harness by explicitly supplying Wide/Desktop scope false and the compact callback dependency, then check the new compact terminal state selects that staged callback. Preserve all original G11 terminal/cancel/duplicate/other-section assertions and the original P100 production/navigation-test blobs. New HEAD requires its own full CI; previous red run does not authorize merge.
