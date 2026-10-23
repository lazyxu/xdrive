# iOS27 Places P0-06B · filtered Cell click remains the same Owner Range

**Source candidate:** parent #2452 filtered /cells, followed by this patch.
The original signed BD09 `/cell-items` endpoint now accepts the reviewed
filter subset: favorite, capture dates, image/video, IANA time zone, album
and sorting, plus its original signed Cell representative and sparse paging
fields. Unknown, repeated, empty and unrecognized parameters, WGS84 geometry,
Owner selection, AK, fold-duplicates and arbitrary queries fail closed.

At a Cell click, BEFORE producing a photo Range, the Server re-fetches the
current filtered 8x8 Owner summary using `mediaItemsBaseQuery` AND the
unchanged signed BD09 Consent/source-revision predicate. The clicked Cell
must still have its exact representative Asset, primary Node, Node revision
and actual filtered PhotoAsset count. Original sparse Gallery Range/Timeline
and Viewer then use the same Album + filters; the summary is regenerated
after the Range before the signed Owner/session/epoch/release recheck.
Neither stale Camera nor stale Consent may authorize a new collection.
All work is bounded by Go request cancellation and query timeout.

The shared TS URL serializer builds Cell Range parameters from the SAME
validated filter serializer as map /cells. It never strips unknown filters
and silently switches back to unfiltered Gallery; invalid sort conflicts,
alternate coordinate spaces, unknown album keys and bad anchors reject.

This patch is a **transport/query contract**, not a filter-control UI.
The map must subsequently pass a frozen, accepted filter/album generation
into both Cells and their click/viewport Viewer context, refresh in place
without remounting the HTTPS Child, and restore only the matching Camera.
Do not consider P0-06 or iOS27 1:1 complete until that UI wiring, the
Owner/Album source-level adversarial regression and a real mixed 10k/100k
database + browser E2E are verified.

No provider Child receives raw Owner IDs, original WGS84, media URLs or
Bearer credentials. No coordinate conversion, new opt-in or background
task is started. Unavailable production-only security acceptance remains
**按用户决定跳过（未验收）**; code-level Owner/Consent/revoke/CSP CI required.
