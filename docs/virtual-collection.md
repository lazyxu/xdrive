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
- bounded residency around the current viewport; loaded and in-flight pages outside the retention window are evicted/cancelled
- read-only loaded-index exposure so consumers can build raw-node lookup maps without duplicating transport state

## Consumers

FileExplorer is the first consumer. Directory and search APIs will migrate from cursor-only append semantics to a range contract that returns `total_count`; the Explorer scrollbar will then be sized from the full logical item count and request only viewport-proximate ranges.

Gallery must reuse the same controller. Its query key additionally includes media filters such as album, favorite, person, place, media kind, and timeline sort. Thumbnail loading remains a separate viewport-proximate pipeline and must not eagerly fetch thumbnails for every metadata item in a loaded range.

## Non-goals

This foundation does not force FileExplorer and Gallery to share layout code. Details rows, icon grids, gallery timeline sections, Live Photo affordances, and media semantic overlays remain surface-specific.

Cursor pagination may remain for compatibility while range APIs are introduced, but new system-style virtual scrolling must not be built by repeatedly appending cursor pages and growing the scroll height.

## FileExplorer directory range transport

The children endpoint supports an explicit range mode when `offset` is present. Range responses return `items`, `total_count`, the requested `offset` and `limit`, plus the stable server sort. The requested limit remains the logical page width even on the final partial page so cache keys do not change after `total_count` becomes known. Cursor and exact-name lookup contracts remain available for existing clients and typed-path resolution.


## FileExplorer range transport

The range contract is explicit end-to-end rather than overloaded onto cursor pagination. Web uses the children endpoint with `offset/limit`; Desktop exposes a dedicated Agent range action backed by Go client `ListRange`. The shared Cloud Files port exposes `getRange(parentID, offset, limit, sort)` while retaining `getPage` for cursor pagination and exact-name path traversal.
