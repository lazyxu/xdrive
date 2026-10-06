# Virtual collection architecture

## Goal

FileExplorer and Gallery must expose system-style scrolling over the complete logical collection rather than Web-style append-at-the-bottom pagination. The user-facing scrollbar represents the full result set from the first stable count, while transport pagination remains an internal implementation detail.

## Shared contract

`ui/shared/src/virtual-collection.ts` owns the framework-neutral range model:

- stable `totalCount`
- `offset + limit` ranges
- page-aligned viewport planning
- bounded overscan
- sparse index-to-item storage
- monotonic request generations
- stale-page rejection

`ui/shared/src/mui/VirtualCollectionController.ts` owns React request orchestration:

- per-generation in-flight range deduplication
- AbortController cancellation on query-generation changes
- loaded-range reuse
- stale response suppression
- request ownership checks so an old request cannot clear a newer in-flight lock that reused the same range key

## Consumers

FileExplorer is the first consumer. Directory and search APIs will migrate from cursor-only append semantics to a range contract that returns `total_count`; the Explorer scrollbar will then be sized from the full logical item count and request only viewport-proximate ranges.

Gallery must reuse the same controller. Its query key additionally includes media filters such as album, favorite, person, place, media kind, and timeline sort. Thumbnail loading remains a separate viewport-proximate pipeline and must not eagerly fetch thumbnails for every metadata item in a loaded range.

## Non-goals

This foundation does not force FileExplorer and Gallery to share layout code. Details rows, icon grids, gallery timeline sections, Live Photo affordances, and media semantic overlays remain surface-specific.

Cursor pagination may remain for compatibility while range APIs are introduced, but new system-style virtual scrolling must not be built by repeatedly appending cursor pages and growing the scroll height.
