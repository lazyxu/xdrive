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


## FileExplorer directory activation

Cloud Files directory browsing now uses the range contract from the first read. The first `offset=0` response is primed into VirtualCollection so `total_count` establishes the stable scrollbar immediately and page zero is not fetched twice. Directory viewport changes request aligned ranges through the bounded cache; Search deliberately remains on its existing dense cursor contract until its separate range migration. FileExplorer interaction indexes are built only from retained metadata, so selection, context menus, rename/delete/copy, and raw-node lookup do not materialize the logical directory.


## FileExplorer Search activation

FileExplorer Search now uses the same sparse VirtualCollection model as directory browsing. A submitted query and server sort define the active Search generation; the first `offset=0` range primes `total_count`, and viewport movement requests bounded Search ranges rather than appending cursor pages. Each workspace tab retains its editable Search value and submitted query, while only the active tab owns the live VirtualCollection. Switching tabs, changing the submitted query, clearing Search, or changing sort invalidates the active Search generation so a late response from an older target cannot overwrite the current surface.

Search result metadata remains sparse and carries its semantic `path` and breadcrumbs. Projection indexes only retained Search ranges for item operations, and the shared FileExplorer surface derives scrollbar geometry from the full Search `total_count`. Legacy cursor Search remains available at the transport/server compatibility layer, but the FileExplorer UI no longer uses cursor load-more after this migration.


## Measured Search retention workload

The FileExplorer Search migration has a deterministic metadata-retention performance test using the real VirtualCollection range and retention helpers.

Workload:
- logical Search result count: **10,000**
- page size: **200**
- retention overscan: **2 pages**
- final viewport: logical indexes **5000..5039**

Measured contract:
- before, dense cursor append retained **10,000 metadata items**
- after, sparse VirtualCollection retains **1,000 metadata items**
- retained Search metadata: **10,000 → 1,000 (-90%)**

This is an allocation/residency metric rather than a wall-clock microbenchmark, so it is deterministic in CI and directly guards the growth behavior that the migration is intended to remove.


### Search load-more cleanup

After Search moved to VirtualCollection, the FileExplorer frontend no longer carries cursor, loading-more, append/merge, or Search pagination-dispatch state. Search viewport loading is exclusively range-driven through VirtualCollection. The server, Go client, Agent, and Web transport may continue to expose cursor Search for compatibility, but the FileExplorer UI does not consume it.


## Gallery range contract

Gallery item collections expose an additive range response when the caller sets `range=true`. The legacy array response remains unchanged when the flag is absent.

The range contract is shared by:
- all media items
- album items
- durable-person items
- suggested-person items

Each range response contains `items`, `total_count`, `offset`, and `limit`. Count and item reads are built from the same media base query so filters, smart-album membership, people/place filters, and collection membership cannot drift. The count uses distinct media node IDs to remain stable if future joins introduce multiplicity.

Gallery VirtualCollection consumers must use this range contract from the first request so scrollbar geometry is based on the complete logical collection instead of the number of items loaded so far.
