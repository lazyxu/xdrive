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


### FileExplorer user-visible load-more cleanup

The main FileExplorer directory surface is now range-only end to end. The shared Cloud Files controller no longer manufactures cursor `pageState`, `loadingMore`, or a no-op `loadMoreDirectory` callback after the range migration, and the Web/Desktop FileExplorer adapters no longer pass `hasMore/onLoadMore` compatibility props into the shared surface.

Small hierarchical browsers still keep cursor pagination where it is the correct transport primitive, but pagination is no longer exposed as a button. The FileExplorer navigation tree and the Synology File Station root picker use an IntersectionObserver sentinel to request the next bounded page when it approaches the viewport. They do not eagerly drain every page; cursor validation and stale-request protection remain in their existing controllers.

## Gallery range contract

Gallery item collections expose an additive range response when the caller sets `range=true`. The legacy array response remains unchanged when the flag is absent.

The range contract is shared by:
- all media items
- album items
- durable-person items
- suggested-person items

Each range response contains `items`, `total_count`, `offset`, and `limit`. The `offset=0` response additionally carries `timeline_groups[]`, where each entry is `{ key, item_count, start_index }`. The group index is computed from the same filtered media query as the count and item range; canonical month keys use UTC `YYYY-MM`, and items without `captured_at` form one trailing `unknown` group. Count and item reads use distinct media node IDs so filters, smart-album membership, people/place filters, and collection membership cannot drift.

Gallery VirtualCollection consumers must use this range contract from the first request so scrollbar geometry is based on the complete logical collection instead of the number of items loaded so far.


### Gallery range transport

Web and Desktop now expose the same explicit Gallery range transport for all media, album items, durable-person items, and suggested-person items. The shared transport shape is `MediaItemRange { items, total_count, offset, limit }`. Legacy array methods remain available during migration, while Gallery VirtualCollection consumers use only the range methods so the UI can establish stable scrollbar geometry from the first response.


## Gallery VirtualCollection activation

Gallery Grid now consumes the same shared VirtualCollection controller as FileExplorer. The first range response for all media, an album, a durable person, or a suggested person primes `total_count`; the media grid then occupies the complete logical height inside the existing workspace scroll host while rendering only viewport rows plus bounded overscan. Scrolling requests aligned media ranges and the VirtualCollection retention window evicts metadata outside the active area.

Gallery mutations such as favorite, tags, people, and description patch only retained loaded metadata and never expand the sparse cache. Preview navigation uses logical indexes; if the adjacent asset is not retained, Gallery requests that logical range before opening it.

Gallery Timeline now uses the same sparse VirtualCollection as Grid. The first range response supplies the month/group index without materializing the media rows. The Timeline layout maps each group to a logical start index, item count, deterministic header height, row count, and full scroll height; the viewport then converts visible group rows back into one bounded logical item range. Only visible rows plus bounded overscan are rendered, and unloaded slots remain placeholders until their VirtualCollection ranges arrive.

The user-facing Timeline no longer exposes `loadMore`. The old dense month grouper remains only as a standalone compatibility fallback when a caller renders `XDriveMediaGallery` without the virtual collection contract; the normal Web/Desktop Gallery path is range-driven for both Grid and Timeline.


## Gallery thumbnail scheduler

Gallery Grid thumbnail work is scheduled independently from metadata range loading. The shared scheduler owns one bounded queue across the active virtual Grid:

- visible tiles use the highest priority
- the Grid's two overscan rows are lower-priority prefetch work
- concurrency is capped at 6 thumbnail loads
- requests for the same media node share one queued/in-flight promise
- leaving the VirtualCollection retention window cancels queued work and logically cancels stale in-flight work; stale blob results are revoked instead of entering cache
- completed thumbnail URLs are retained in a 512-entry LRU cache so scrolling back reuses decoded/downloaded thumbnails
- blob URL lifetime is owned by the scheduler; virtual tile unmount does not revoke scheduler-cached URLs

Both virtual Grid and virtual Timeline feed viewport/overscan priorities into the same thumbnail scheduler, so changing Gallery view mode does not introduce an unbounded thumbnail pipeline. Details, preview, and person-cover surfaces retain their existing direct loaders. Video poster capture remains its own bounded pipeline because it consumes preview URLs and browser video decoding rather than thumbnail resources.
