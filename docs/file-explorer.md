# FileExplorer design

This document is the canonical **non-performance** FileExplorer design contract for Web and Desktop. Performance-specific constraints and benchmarks live in `docs/file-explorer-performance.md`.

## Shared architecture

- Web and Desktop use the shared FileExplorer interaction/model layer and shared MUI surface under `ui/shared`.
- Platform-specific transport remains local: Web REST/fetch stays in Web; Desktop Electron/Agent IPC and native-shell integration stay in Desktop.
- Server is authoritative for filesystem semantics that require the full namespace. Clients must not reconstruct recursive filesystem state by paginating/traversing the tree in the renderer.
- New FileExplorer features should preserve Web/Desktop behavior parity unless the feature is inherently platform-specific.

## Structured Search and filters

FileExplorer Search is a Server-side logical collection. Web/Desktop must never implement a structured filter by filtering only the currently retained VirtualCollection pages.

### Canonical filters

The shared Search contract supports these Server-owned filters:

- **类型**: folder, all files, image, video, audio, PDF, document, spreadsheet, presentation, archive, code, text, and other files. File-category classification follows the same extension families as the shared FileExplorer presentation classifier.
- **修改时间**: inclusive `modified_from` and exclusive `modified_to` RFC3339 bounds on `xd_nodes.updated_at`.
- **大小**: `min_size` / `max_size` byte bounds. Once a size bound is present, directories do not match.
- **同步文件夹**: `source_id`, resolved by owner-scoped `SourceItem -> Source` identity. The filter is provenance only; connector-specific media semantics must not leak into FileExplorer Search.

A text query is optional when at least one structured filter is active. A non-empty text query still requires at least two Unicode characters.

Structured filters are part of the Search generation/cursor identity. Changing any filter invalidates in-flight range work exactly like changing the query, tab, or sort. A stale result from an older filter set must never mutate the active logical collection.

Web REST, Desktop renderer, Electron/Agent IPC, Go client, and Server carry one shared filter contract. Platform adapters serialize/validate transport only; they do not apply result filtering locally.

### Availability filter boundary

File availability is **device-scoped state**, not Server namespace state. Windows CfAPI pin/online-only/syncing information can differ between two Desktop devices and has no meaningful Server-global value for Web.

Therefore the availability chip must not be implemented as renderer-side filtering over retained Search pages, and the Server must not invent a global availability field. Its implementation belongs to the Desktop Agent query boundary, backed by an Agent-local availability index/query contract capable of filtering before pagination. Until that dedicated contract exists, Web omits availability and Desktop continues to show availability as item metadata rather than pretending it is a Server filter.

### Search filter UI

Web and Desktop reuse the shared MUI filter-chip surface. Type, modified time, size, and synchronization-folder chips mutate shared Search-controller state. Filter-only Search is valid. Clearing the last filter with an empty query exits Search and returns to the current directory.

## Navigation tree drag and drop

The shared left folder tree is a first-class drop target, not navigation-only chrome.

- Internal FileExplorer drags carry a small shared DataTransfer payload containing the logical selected item IDs.
- Dropping onto any folder-tree node delegates to the existing FileOperation drop-to-parent path. The tree does not implement separate Copy/Move semantics, conflict handling, replace/merge rules, or task tracking.
- Move is the default internal operation; Ctrl on Windows/Linux or Command on macOS requests Copy, matching the main FileExplorer surface.
- Local files dropped onto a tree node reuse the existing external-file upload adapter for that target directory.
- Local folders dropped onto a tree node reuse the existing hierarchical folder-upload adapter when that platform/capability supports folder upload.
- A tree node shows the same primary-accent drop-target outline used by the main FileExplorer surface.
- The drop target must not navigate into the directory as a side effect. Refresh/navigation behavior remains owned by the existing operation/upload controllers.
- Web and Desktop consume the same shared navigation-pane DnD contract; only their transport/upload adapters remain platform-local.

## Folder Properties

Folder Properties must report real recursive statistics rather than displaying `—` for directories.

### Statistics contract

The Server computes statistics from the selected node snapshot and returns enough data for both a single folder and mixed multi-selection:

- total byte size of all counted files;
- recursive file count;
- recursive folder count;
- selected/top-level item count as needed for presentation;
- no double counting when a selected node is already contained by another selected folder.

The Server must:

- authorize every selected node against the signed-in owner;
- operate only on active nodes unless the calling surface is explicitly a Trash surface;
- reduce overlapping selections to effective top-level roots before recursive aggregation;
- use a recursive database query/CTE (or an equivalent Server-side set operation);
- never require Web/Desktop to load every descendant;
- keep recursive statistics out of normal directory-list payloads so opening/listing a directory remains cheap.

For a single file, existing direct metadata may be rendered immediately. If recursive/mixed statistics are requested, the dialog may show `正在计算…` until the Server result arrives.

### Request-scoped automatic cancellation

Folder Properties statistics are **request-scoped**, not a durable background job. They do not create a Task Center row.

Cancellation is automatic:

1. opening Properties starts a request for the current immutable selection snapshot;
2. closing the dialog aborts the request;
3. opening/replacing Properties for a different selection aborts the previous request before starting the next;
4. unmounting FileExplorer aborts any outstanding Properties request;
5. a late completion from an older request is ignored even if transport cancellation races with completion.

There is no separate user-visible Cancel button for this operation; closing the dialog is the cancellation action.

Transport requirements:

- **Web:** pass an `AbortSignal` through the API request to `fetch`;
- **Desktop:** use a request identifier/cancellation path that propagates renderer cancellation through Electron main and xdrive-agent to the Go client request context;
- **Server:** the handler and recursive database query use the HTTP request context so client cancellation interrupts database work.

An intentional abort is not a failure and must not produce an error toast.

## VirtualCollection interaction semantics

Virtualization must not weaken ordinary FileExplorer interaction semantics. The logical collection is authoritative; the retained render pages are only a cache.

Required behavior:

- `Ctrl/Cmd+A` selects the entire logical collection, not only currently loaded pages.
- Shift-click and Shift+keyboard selection load missing logical indexes before committing the range. Results from an older selection intent must never overwrite a newer selection.
- Type-to-select remains available in virtual collections. It scans bounded logical ranges on demand and stops at the first matching item; it must not require preloading the entire collection.
- Quick Look previous/next follows logical collection order, loads missing ranges on demand, and skips folders.
- File operations from a virtual selection must retain enough node metadata for every selected item even if its render page is later evicted.
- Logical range resolution must stay bounded. Never fan out every page of a 100k-item selection concurrently; load small page groups and allow ordinary viewport retention to evict old render metadata after interaction metadata has been captured.
- Directory/search/tab/sort generation changes invalidate in-flight interaction resolution so stale results cannot change current selection or Quick Look state.

These are correctness requirements, not a FileExplorer performance specialization. Performance work remains governed separately by `docs/file-explorer-performance.md`.

## Async scope rule

Do not use Folder Properties work as a reason to retrofit cancellation across unrelated async subsystems. Transfers, thumbnails, analysis previews, media indexing, Photo Intelligence, archive preparation, and maintenance are reviewed for cancellation when their own subsystem is being changed or when a specific correctness issue requires it.

Existing cancellation/control behavior already implemented for those subsystems remains in place.

## Tests

Folder Properties coverage must include:

- recursive size and file/folder counts;
- nested-folder aggregation;
- mixed file/folder multi-selection;
- ancestor/descendant selection without double counting;
- owner isolation and stale/missing nodes;
- Web automatic abort when Properties closes or is replaced;
- Desktop automatic abort propagation through IPC/Agent;
- Server request-context cancellation;
- stale completion cannot overwrite a newer Properties request;
- intentional abort does not surface as an error.

