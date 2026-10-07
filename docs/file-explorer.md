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

## Group By and folders-first

FileExplorer grouping is a **Server-ordered range contract**, not a renderer-side regroup of whichever VirtualCollection pages happen to be retained.

Canonical shared state is per tab:

- `groupBy=none|type|modified|size`
- `foldersFirst=true|false`
- default: `none + foldersFirst=true`, preserving the existing Explorer order.

Directory and Search range requests serialize this as `group` and `folders_first`. Cursor pagination, exact-name lookup, typed-path traversal, and the navigation-tree cursor remain ungrouped compatibility paths.

### Group index

When grouping is active, the authoritative `offset=0` range additionally returns:

```text
groups[] = { key, item_count, start_index }
```

The index is generated from the same authorized/filtered Server query and the same group ordering as the item range. It covers the complete logical collection; clients must not infer group boundaries from retained pages.

Canonical group keys:

- **type**: `folder`, `other`, or `ext:<lowercase-extension>`;
- **modified**: `month:YYYY-MM` in UTC, with `unknown` available for missing timestamps;
- **size**: `folder / empty / tiny / small / medium / large`, where file thresholds are 1 MiB, 100 MiB, and 1 GiB.

For date grouping, folders-first applies **inside the month group** rather than creating a fake folder/date cross-group. For type/size grouping, the folder group is first or last according to `foldersFirst`.

The first counted directory range owns both `total_count` and `groups`. Later `include_count=false` ranges reuse both generation metadata values and therefore skip both the window count and group aggregation. Search range generation similarly carries grouping identity; changing grouping fences stale query/filter/sort responses.

### Grouped VirtualCollection geometry

Group headers are part of the real scroll geometry. Shared layout code maps `start_index/item_count` into deterministic header/item offsets for Details and Grid, translates the viewport back into logical sparse indexes, and keeps keyboard focus, marquee selection, Quick Look, and logical selection on the same index space.

Do not insert group headers into the item array, do not renumber filesystem items, and do not make one pseudo-item per header. The logical item indexes remain Server indexes; group headers are presentation geometry only.

## Tabs and native tab workflows

FileExplorer tabs are shared Web/Desktop navigation workspaces, not app-local visual tabs. Each tab owns its committed history, current history index, sort, grouping, and view mode. Search state is keyed by the shared tab workspace id.

Native tab workflows use the same shared navigation state machine:

- middle-clicking a folder opens it in a new tab through the existing shared `openItemInNewTab` path;
- middle-clicking a tab closes that tab when more than one tab is open;
- dragging a tab reorders the shared tab array and does **not** issue a directory reload;
- duplicating a tab clones its complete committed history/sort/grouping/view state, inserts the copy beside the source, loads the source directory, and activates the duplicate only after that load wins the navigation generation fence;
- **Close other tabs** and **Close tabs to the right** preserve the target workspace and push closed tabs into a bounded in-memory recently-closed stack;
- restoring a closed tab reopens the latest snapshot at its previous index when possible and activates it only after its directory load succeeds;
- `Ctrl/Cmd+Shift+T` restores the most recently closed tab;
- asynchronous duplicate/restore/bulk-close loads participate in the same navigation-generation arbitration as ordinary folder navigation and tab activation. A stale completion must never change the current directory, active tab, address path, or tab labels.

The recently-closed stack is intentionally in-memory. Desktop's existing reconnect snapshot preserves committed open navigation state across a transient Agent disconnect, but this feature does not yet persist tabs/recently-closed state across a full renderer/app restart. Full session restore remains a separate optional persistence feature.

## File favorites and Quick Access

FileExplorer keeps **folder pinning** and **file favorites** as separate concepts:

- **Quick Access** pins non-root folders only. It is navigation-oriented and is backed by `xd_file_quick_access`.
- **Favorites** stars files only. It is backed by the independent owner-scoped `xd_file_favorites` relation and must not be stored in Quick Access.
- FileExplorer favorites are also independent from Gallery / Photo Intelligence `PhotoMetadata.favorite`; starring a document or arbitrary file must not require media indexing.
- Both relations use stable Node identity. Rename/move resolves live path and breadcrumbs on read; a trashed node is hidden while the relation remains so restore can surface it again.
- Web and Desktop share the favorite state/controller and navigation UI. Platform code remains transport-only (Web REST versus Desktop Agent IPC).
- Favorite activation is owned by the mounted FileExplorer lifecycle. Unmounting the Explorer invalidates pending favorite lookups and mutations before they can run user-visible activation callbacks (for example Desktop `openLocalNode`) after an Agent reconnect.
- The navigation pane renders Quick Access and Favorites as distinct sections. File context menus expose `添加到收藏 / 取消收藏`; folders continue to expose `固定到快速访问 / 从快速访问取消固定`.

## Real-time directory invalidation

FileExplorer directory freshness is driven by the Server node-change journal, not by renderer-side guesses and not by repeatedly reloading every visible directory.

The canonical flow is:

```text
xd_nodes INSERT / UPDATE / DELETE
        ↓
xd_node_changes durable cursor journal
        ↓
Web REST / Desktop Agent IPC change page
        ↓
shared CloudFiles controller
        ↓
affected current parent?
        ↓
debounced loadDirectory(current id, latest crumbs, latest sort, latest grouping)
        ↓
new VirtualCollection generation + viewport range refill
```

### Parent-aware journal contract

Every journal row records both the current parent and previous parent when available. The change API coalesces repeated writes for one node inside a cursor window but unions every parent touched by those rows into:

```text
affected_parent_ids[]
```

This is required for correctness. For example, if a file moves from directory A to B and is renamed in B before a client polls again, the coalesced change must still invalidate both A and B. A delete must retain the deleted node's old parent even though the active node can no longer be materialized.

The journal remains owner-scoped and durable. `next_cursor / latest_cursor / has_more / reset_required` remain the synchronization boundary; Web/Desktop must not synthesize cursors locally.

### Client refresh behavior

- Web and Desktop use the same shared change-feed controller.
- The initial feed handshake snapshots `latest_cursor` and then refreshes the current directory once, closing the race between the initial directory range and cursor acquisition.
- Idle polling is incremental and bounded; when `has_more` is true the controller catches up consecutive pages before returning to the normal interval.
- Multiple relevant changes are debounced into one current-directory refresh.
- Only a change whose `affected_parent_ids` contains the currently active directory triggers the directory refresh. Unrelated directories do not cause work.
- The refresh uses the **latest** breadcrumbs, sort, and grouping. A late event/request from a directory that the user has already left must never navigate or refresh the new directory.
- A reset-required page conservatively refreshes the current directory and adopts the Server's latest cursor.
- Agent disconnect/reconnect resets the local cursor handshake. Desktop keeps its existing preserved directory/sort/grouping state and reacquires the feed after reconnect.
- A transient Desktop Agent disconnect may remove the FileExplorer surface from the render tree, but it must not reset committed navigation state. The Desktop App owns an in-memory, current-user-scoped navigation snapshot containing tabs, tab history, active tab, per-tab sort/grouping and view mode, and restores it when FileExplorer remounts. Pending/uncommitted navigation is never snapshotted.
- This reconnect snapshot is intentionally transient. It does not create browser/app session restore across a full renderer restart and must not be persisted as a substitute for the separate optional tab session-restore feature.
- The change feed is an invalidation signal only. It never patches sparse item pages directly. Authoritative items, count, group indexes, permissions, and ordering are reacquired through the normal Server range API.

Current-directory invalidation does not turn the navigation tree into a globally live replicated tree. Tree nodes continue to load through their existing paged contract; tree-specific invalidation should be added only when its own correctness contract is defined.

## Archive download data plane and progress side channel

Web archive preparation may create a process-local `transfer_id` so Transfer Center can show per-entry progress, but that identifier is **not** part of archive authorization or payload correctness.

- The requested node IDs, signed-in owner, current namespace, and rebuilt archive manifest remain authoritative for every payload request.
- A load-balanced payload request may land on a different Server instance from the prepare request. If that instance has no local progress record for the supplied `transfer_id`, it must continue the authenticated archive download without progress tracking; sticky sessions are not a correctness requirement.
- When progress state is unavailable, the Server clears the local progress correlation before writing any entry so a coincident or another owner's transfer ID can never mutate unrelated process-local state.
- If a matching local progress record exists but its prepared IDs or manifest no longer match the payload request, the Server returns a conflict instead of silently reusing stale progress state.
- Progress polling may therefore become unavailable while the archive payload still succeeds. Web treats the progress channel as best-effort and the archive response as the data-plane result.

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
- Directory/search/tab/sort/grouping generation changes invalidate in-flight interaction resolution so stale results cannot change current selection or Quick Look state.

These are correctness requirements, not a FileExplorer performance specialization. Performance work remains governed separately by `docs/file-explorer-performance.md`.

## Async scope rule

Do not use Folder Properties work as a reason to retrofit cancellation across unrelated async subsystems. Transfers, thumbnails, analysis previews, media indexing, Photo Intelligence, archive preparation, and maintenance are reviewed for cancellation when their own subsystem is being changed or when a specific correctness issue requires it.

Existing cancellation/control behavior already implemented for those subsystems remains in place.

### Archive prepare lifecycle

Folder/multi-selection ZIP preparation is a durable owner-scoped background task, while the final ZIP HTTP
stream remains request-scoped:

- POST `/download/archive/prepare` persists the selected node ids and returns a durable transfer id immediately;
- preparation builds and persists one immutable manifest (paths, storage keys, sizes, timestamps and filename);
- queued/running preparation survives Server process loss through reconciliation and may be adopted by another Server;
- one PostgreSQL advisory lease per prepare id prevents duplicate cross-Server manifest construction;
- Task Center exposes `archive.prepare` to the owner/admin and supports durable cancellation before completion;
- Web and Desktop/Go wait on GET `/download/archive/prepare/:id`, then send the durable transfer id with the
  archive payload request;
- the payload Server consumes the persisted manifest instead of rescanning the tree, so load balancing does not
  require sticky sessions;
- per-entry streaming progress remains an optional process-local side channel; losing that side channel never
  invalidates an authorized payload;
- a broken ZIP connection is not resumable. Retrying the payload may reuse the still-valid prepared manifest.

## Tests

### Basic lifecycle regression

FileExplorer's foundational user workflow must retain at least one real Server + storage + Go client integration chain rather than relying only on renderer wiring assertions or isolated endpoint tests. The chain must exercise the same contracts consumed by Web/Desktop:

- range-backed directory listing with an authoritative first-range count;
- directory creation and file upload;
- single-file download with byte-for-byte validation;
- folder/archive download including empty-directory preservation;
- durable Copy and Move operations with final namespace/content validation;
- durable Delete to Trash followed by Restore;
- a second client observing create/upload/copy/move/delete/restore through the owner-scoped node-change feed, including both previous and current parent IDs for a move.

Dedicated upload, archive, FileOperation, sync, and race suites remain authoritative for subsystem-specific edge cases. The basic lifecycle test exists to catch integration regressions where those individually correct subsystems stop composing into a usable FileExplorer workflow.

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

## Shared thumbnails and Trash workspace

FileExplorer item visuals use one shared MUI thumbnail pipeline:

- Details/list, Grid, properties, Quick Access, Recent and Trash consume the same thumbnail provider/cache/scheduler.
- Platform code only supplies the thumbnail transport adapter; it does not implement separate thumbnail UI, cache, visibility admission or object-URL lifecycle.
- Thumbnail-eligible image media uses the same path across every FileExplorer surface. Formats without a Server thumbnail contract, including video posters today, fall back to the shared file-kind icon rather than pretending thumbnail support exists.
- The thumbnail scheduler remains viewport-aware, concurrency-bounded and cancellable before work starts.

Trash is a special FileExplorer directory, not a dialog:

- its navigation entry sits above Quick Access;
- it uses the normal Details/Grid surface and shared thumbnails;
- normal upload/copy/cut/paste/move/rename/delete/grouping commands are disabled while Trash is active;
- its item context menu exposes only Trash-specific actions (Restore and Permanent Delete) plus the standard Properties entry;
- Web/Desktop keep their transport adapters local but share the Trash controller and presentation.
- The thumbnail endpoint may read an authenticated owner's deleted file node specifically for Trash thumbnails; other media/gallery/preview APIs remain active-node-only.
