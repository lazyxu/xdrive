# FileExplorer design

This document is the canonical **non-performance** FileExplorer design contract for Web and Desktop. Performance-specific constraints and benchmarks live in `docs/file-explorer-performance.md`.

## Shared architecture

- Web and Desktop use the shared FileExplorer interaction/model layer and shared MUI surface under `ui/shared`.
- Platform-specific transport remains local: Web REST/fetch stays in Web; Desktop Electron/Agent IPC and native-shell integration stay in Desktop.
- Server is authoritative for filesystem semantics that require the full namespace. Clients must not reconstruct recursive filesystem state by paginating/traversing the tree in the renderer.
- New FileExplorer features should preserve Web/Desktop behavior parity unless the feature is inherently platform-specific.

## Item icons and availability badges

FileExplorer uses one shared visual grammar across Details, Grid, Quick Access, Favorites, Recent, the folder tree, and Desktop Home recent/favorite rows:

- The **primary icon describes object type only**. The canonical visual families are folder, generic file, image, video, audio, PDF, document/text, spreadsheet, presentation, archive, and code.
- A real thumbnail replaces the file primary icon when one is available. Availability never creates a second cloud/local copy of the primary icon.
- Device state is a separate **Availability Badge**: local, always-local, online-only, cloud, mixed, syncing, or error. Folder and file badges use the same semantic mapping.
- Syncing may render a determinate progress ring when a bounded percentage is already available; otherwise it uses the ordinary syncing glyph. Badge rendering must not start a transfer or extra scan just to obtain progress.
- On Desktop Windows, active CfAPI hydration reuses the existing Agent Transfer event stream as the percentage source. The renderer path-matches the active hydration task to the already-batched availability snapshot and projects its real `bytes_done / bytes_total` ratio into the shared badge. FileExplorer must not add a second transfer poll or increase availability polling frequency merely to animate the ring; when the hydration task ends it performs one availability refresh so the final local/pinned state is authoritative.
- **Mixed** means a directory currently has only part of its content available locally. On Windows the Agent derives this from CfAPI's directory placeholder state (`PARTIALLY_ON_DISK`); the renderer must never recursively walk descendants just to decide which badge to paint.
- "Keep on this device" policy and current materialization state are distinct concepts. A directory that is still only partly materialized remains mixed/in-progress until the OS reports the corresponding current state.
- Exact child counts may be shown later only when the sync/runtime layer already owns a bounded aggregate snapshot. UI code must not add recursive scans to calculate counts for a badge.

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

The implemented availability filter therefore lives at the Desktop Agent query boundary:

- Web omits the availability chip because it has no authoritative local-device state.
- Desktop exposes `local / always-local / online-only / cloud / mixed / syncing` only when Windows CfAPI availability is supported.
- Server Search still owns authorization, text/type/time/size/synchronization-folder filtering, sort, grouping, and the candidate namespace. It does **not** persist or invent a global availability field.
- When availability is active, the Agent evaluates the Server-ordered candidate collection against the current device before logical pagination, builds a short-lived filtered offset/group snapshot, and returns authoritative `offset / limit / total_count / groups` for that device-scoped collection.
- Availability-only Search uses the range-only Server `include_all=true` candidate enumeration. That flag does not define availability semantics; it only lets the authenticated Agent enumerate the owner's namespace so the device-local predicate can be applied before pagination.
- The first candidate range is counted and carries group indexes. Later 200-item candidate ranges send `include_count=false`, so the Agent does not make Server Search repeat `COUNT(*) OVER()` or group aggregation for every scan page.
- The renderer never filters retained pages. Changing availability remains part of Search generation identity, so stale ranges cannot mutate a newer filter set.

The Agent snapshot is intentionally short-lived and is invalidated when local availability is changed or the sync engine changes state.

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

The recently-closed stack is intentionally in-memory and is never persisted across a full restart.

Open-tab session restore is an optional shared navigation capability used by both Web and Desktop:

- only committed open-tab state is persisted: tab order, committed history/index, sort, grouping, view mode, and active tab;
- Search drafts/results, pending navigation, in-flight directory loads, selections, rename state, clipboard state, and the recently-closed stack are not persisted;
- persisted history is bounded to 64 entries per tab and the normal 12-tab workspace cap;
- Web scopes the storage key by signed-in username within the current Server origin; Desktop scopes it by Server + username so accounts cannot inherit each other's paths;
- Desktop's explicit in-memory reconnect snapshot takes precedence over persisted restart state;
- after a full restart, the persisted active tab is reloaded through the same navigation generation and `onLoadDirectory` path as normal navigation, including its saved sort/grouping;
- if the saved target no longer exists, the active tab falls back to the already-loaded current directory/default ordering rather than leaving tab/address/directory state inconsistent;
- if the user performs a newer navigation while startup restore is pending, the startup request becomes stale and may not reclaim the visible directory.
- across an account/Server navigation-session key change, incoming directory breadcrumbs may still belong to the previous session until the new root arrives. The shared controller must not seed the new default tab from that stale root or use it as a failed-session-restore fallback; it may seed from a newly observed root, and a failed saved-session target otherwise falls back only to its same-session saved root. Completion after a later navigation/lifecycle change remains generation-fenced.

Session persistence is best-effort UI state. Storage/quota/privacy failures must not break FileExplorer navigation.

## Native keyboard profiles

FileExplorer resolves keyboard behavior through one shared profile-aware command layer. Web/Desktop must not fork keyboard semantics in app-local handlers.

Current native-alignment rules include:

- **Windows:** `Ctrl+Tab / Ctrl+Shift+Tab` switch tabs; `Ctrl+1…9` activates the corresponding FileExplorer tab; `Ctrl+Insert` copies; `Shift+Insert` pastes; `Ctrl+D` moves the selected item to Trash. Existing `Alt+D`, `Alt+Left/Right/Up`, `Alt+Enter`, `F2/F3/F4/F5`, `Shift+F10`, and `Ctrl+Shift+N` bindings remain shared.
- **macOS:** tab cycling uses `Control+Tab / Control+Shift+Tab`. FileExplorer must not intercept `Command+Tab`, which belongs to the system app switcher. `Command+Y` opens the same shared Quick Look surface as Space. Existing Finder-like `Command+[/]`, `Command+Up/Down`, `Command+I`, `Command+Delete`, `Shift+Command+G`, `Shift+Command+N`, and `Shift+Command+P` behavior remains shared.
- **Web:** browser-reserved shortcuts such as `Ctrl+D` and `Ctrl+number` are intentionally not captured by FileExplorer.

Do not add a `Shift+Delete` permanent-delete shortcut merely for Windows parity. Permanent deletion remains an explicit Trash action with its existing confirmation semantics.

Finder-style **Move Item Here** is supported through `Option+Command+V` on macOS. It reuses the current shared clipboard snapshot but overrides only that paste operation to `move`; a successful move clears the clipboard, while ordinary `Command+V` after `Command+C` remains copy. The move uses the same durable FileOperation, conflict handling, lifecycle fencing, and same-parent no-op filtering as existing Cut/Paste. Web/Desktop do not implement separate move-paste logic outside the shared clipboard/operation controllers.

## Details columns

The shared Details view separates **display columns** from **Server sort keys**.

Default visible columns remain unchanged:

- 名称
- 修改时间
- 类型
- 大小

Optional columns are available from the shared **列** menu and are hidden by default so upgrades do not widen existing layouts:

- **创建时间** — projected from the existing Node `created_at` field;
- **状态** — device/runtime status when the platform has an authoritative local state source;
- **可用性** — device-local availability such as 仅联机 / 本地可用 / 始终保留在此设备上 / 混合.

The persisted Details layout stores visible columns, complete column order, and widths. Normalization must preserve an older saved visible set while appending newly introduced columns to the saved order with default widths.

Only columns backed by the existing Server range ordering contract are sortable today: `name / updated / type / size`. Creating a display column must not silently broaden the Server sort contract.

Desktop Windows derives 状态 and 可用性 from the existing batched CfAPI availability snapshot. It must not issue per-row IPC or a second batch solely for columns. Web has no device-local availability truth and therefore renders those optional columns as `—` rather than inventing Server-global state.

Media-specific columns are now available but remain hidden by default:

- **尺寸** — existing indexed media width × height, for files whose current revision already has ready media metadata;
- **时长** — existing indexed duration using the same `m:ss / h:mm:ss` formatter as Gallery.

These two columns use an explicit bounded projection rather than widening ordinary directory/search payloads. Shared FileExplorer requests media details only while Details view is active and either media column is visible. It batches at most **200** `id + revision` refs per Server request and keeps a bounded **512-entry** client cache keyed by `id:revision`. The Server authorizes active file nodes against the signed-in owner and returns metadata only when `xd_media_metadata.node_revision` matches the requested current Node revision and the metadata row is ready.

The media-details projection is read-only. It does **not** trigger media indexing and it is never joined into the normal children/search range SQL. Files without already-indexed current metadata render `—`. **尺寸 / 时长** are display-only and do not broaden the Server sort contract.

## File favorites and Quick Access

FileExplorer keeps **folder pinning** and **file favorites** as separate concepts:

- **Quick Access** pins non-root folders only. It is navigation-oriented and is backed by `xd_file_quick_access`.
- **Favorites** stars files only. It is backed by the independent owner-scoped `xd_file_favorites` relation and must not be stored in Quick Access.
- FileExplorer favorites are also independent from Gallery / Photo Intelligence `PhotoMetadata.favorite`; starring a document or arbitrary file must not require media indexing.
- Both relations use stable Node identity. Rename/move resolves live path and breadcrumbs on read; a trashed node is hidden while the relation remains so restore can surface it again.
- Web and Desktop share the favorite state/controller and navigation UI. Platform code remains transport-only (Web REST versus Desktop Agent IPC).
- An optimistic Quick Access reorder owns ordering only. If it fails, restore the previous order and positions of surviving pin relations while preserving their current names/paths and any newer successful pin/unpin results. A folder unpinned and then re-pinned has a new `pinned_at` and retains its new Server position. Do not replace the current list with the entire pre-reorder snapshot; a newer reorder or lifecycle still supersedes the old failure.
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

FileExplorer Properties uses the shared dialog and one request-scoped metadata/statistics contract. The dialog is divided into three explicit sections:

- **常规** — type, created/modified timestamps, location, and device-local availability when authoritative;
- **内容** — file size or recursive folder/multi-selection size and item counts; a single media file also shows indexed dimensions and duration when current-revision media metadata is already available through the shared media-details projection;
- **技术详情** — SHA-256 for files, revision, stable node ID, and source binding.

The right-side Inspector uses the same section semantics for metadata already present in the loaded node projection and may render media dimensions/duration only when the shared media-details cache already contains them. It must not trigger an additional Server request merely to populate source binding or media content details.

Opening Properties for one file may request the existing bounded media-details projection for that immutable `id + revision` snapshot. This reuses the same 512-entry shared cache as the optional Details columns and the same Web/Desktop transport adapters; it does not add a Properties-specific endpoint or widen directory/search payloads. Closing or replacing the Properties selection aborts the request, and a late result from an older Properties request must not update the dialog.

SHA-256 is projected from the existing Node field and does not require an additional lookup. Source binding is intentionally request-scoped: when Properties is opened for one node, the existing `/nodes/properties/stats` request also resolves owner-scoped `SourceItem(NodeID) -> Source` bindings. Multiple SourceItem rows for the same Source are de-duplicated. Sources owned by another user must never be returned.

Do **not** join Source/SourceItem into ordinary directory or search range payloads just to show technical Properties metadata. Normal FileExplorer pagination must remain cheap.

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

1. opening Properties starts a request for the current immutable selection snapshot when it is a single file or includes a folder; a pure multi-file selection stays local because source binding is intentionally single-node metadata;
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

## Hover and shortcut discoverability

FileExplorer should expose already-supported behavior without turning every control into permanent helper text.

- Navigation controls show platform-appropriate shortcut hints in hover text.
- Address and search controls expose their focus shortcuts.
- Command-bar actions such as New Folder, Cut/Copy/Paste, Delete, Undo/Redo and Inspector expose the existing keyboard binding.
- View, Columns, Sort and Group controls use Chinese hover text that explains what the control changes.
- Truncated file/folder names expose the complete name on hover. File items also mention Enter/double-click Open and Space Quick Look; directories may mention middle-click new-tab when that action is available.
- Details headers explain click-to-sort, and resize handles explain drag-to-resize plus double-click auto-fit.
- Context menus show the shortcut in a right-aligned secondary column for commands that already have a keyboard binding.
- Tab chrome exposes New/Close/Switch/middle-click behavior without adding always-visible shortcut labels.
- Do not advertise a shortcut that the active keyboard profile does not actually implement.

These are discoverability affordances only. They must not introduce a second command model or platform-specific action implementation outside the shared keyboard contract.

FileExplorer file thumbnails use square image frames with no corner radius in Details, Grid, Favorites, and Recent. Rounded containers remain appropriate for buttons, cards, status badges, and other chrome, but must not clip file thumbnail pixels into rounded rectangles.

## Desktop shell integration

Desktop shell actions remain behind the protected Agent managed-path boundary. Renderer code passes only a relative xDrive path; both Electron main and Agent reject unsafe/absolute paths before the platform shell receives an absolute path.

Current behavior:

- **System open** uses the platform default application for a locally available file.
- **Reveal** opens Windows Explorer with the item selected; macOS uses `open -R` so Finder reveals the exact item; Linux opens the parent directory.
- **Open With** is advertised only when the Agent reports the `open-with` capability. On Windows it invokes the native `SHOpenWithDialog` for files after the same managed-path/local-readiness checks. Non-Windows clients do not show a fake Open With action.
- If the synchronized local copy is not ready, the Agent requests sync and returns the existing retry-later message rather than exposing an arbitrary temporary path.

Do not bypass this boundary with renderer-side absolute paths or generic shell execution.

### Native drag-out boundary

FileExplorer already owns HTML5 drag/drop for internal file operations. Electron native `webContents.startDrag()` competes with that same `dragstart` lifecycle, so ordinary row/card dragging remains the xDrive internal move/copy source.

Desktop Windows/macOS additionally expose a distinct native drag-out handle on loaded FileExplorer items:

- dragging the normal row/card continues to target FileExplorer folders and breadcrumb drop zones;
- dragging the dedicated system-drag handle stops the HTML5 drag event and asks Electron main to start one OS drag;
- renderer/preload pass only the relative xDrive path and never receive the resolved absolute local path;
- Electron main resolves the path against the latest Agent `mount_path`, canonicalizes both root and candidate, rejects absolute/traversal/out-of-root paths, and permits only files/directories;
- Windows Explorer and macOS Finder can therefore receive a native filesystem drag without weakening the protected shell-path boundary;
- Trash does not expose native drag-out because trashed nodes are not represented by their ordinary mounted namespace path;
- Linux keeps internal FileExplorer drag/drop only until a native desktop drag contract is explicitly supported.

Do not replace the internal drag lifecycle with native drag-out and do not expose mount-root absolute paths to renderer code.

## Windows-style shared chrome

The Web/Desktop FileExplorer shell intentionally keeps one shared Windows-like interaction hierarchy:

- the address bar remains breadcrumb-first, enters a raw editable path on focus/shortcut, and keeps compact square-ish segments instead of rounded app-navigation pills;
- Search is contextual to the current folder and receives more horizontal space than secondary command controls;
- structured Search filters stay Server-backed but are collapsed behind one **筛选** trigger; active filter count remains visible without keeping four chips permanently on the command bar;
- **视图** is the single layout/density control; do not add a second Details/Grid toggle beside it;
- **排序与分组** is one menu containing Server-backed sort, Server-backed group mode, and **文件夹优先**;
- the folder tree is manually expanded by the user and does not auto-expand or highlight itself merely because navigation changed elsewhere;
- Trash, Quick Access, Favorites, and Recent item icons reserve the same left disclosure-slot width as the root folder row, so their visual icon column lines up with **我的文件**;
- Grid item visual boxes are square at every density and file/folder fallback icons use the same size token within each density.
- the left navigation pane is resizable from **176–320px**, can be hidden/restored from shared FileExplorer chrome, and persists its local width/visibility through the existing view-preference state;
- the Details/Inspector pane is resizable from **260–480px** and persists its local width while retaining the existing explicit show/hide control;
- Quick Access, Favorites, Recent, and the folder tree are independently collapsible and persist local section state;
- standard Details rows are single-line at **36px normal / 28px compact**; secondary labels do not create a second line in the normal file list;
- active tabs use neutral surface hierarchy plus a one-pixel divider edge rather than a strong primary-color underline;
- native Desktop drag-out affordances are invisible until the owning row/tile is hovered or keyboard-focused; Grid keeps the affordance as a top-right overlay and Details does not reserve permanent name-column width for it;
- Grid icon density uses **five** shared steps (`tiny / small / medium / large / huge`), and the View menu plus Ctrl/Cmd-wheel both use the same ordered size model.
- the Command Bar keeps stable action slots when selection changes; selection enables/disables file actions instead of replacing the toolbar, while selection count/bytes live in the Status Bar;
- the Command Bar observes its available width and moves lower-priority built-in actions into one shared **更多** overflow menu rather than wrapping or horizontally scrolling;
- the Status Bar always shows authoritative item count, selection count/selected file bytes when applicable, and the current Details/Grid density label; adapter-provided status text remains visible alongside it;
- navigation sections use compact vertical spacing rather than repeated Divider rows;
- the Inspector uses a flat pane surface: sticky compact header, square preview, section borders/spacing, and no nested preview-card treatment;
- Details headers keep sort state neutral, right-align size/dimensions/duration columns with tabular numeric text, and use a neutral resize affordance rather than primary blue;
- Grid tiles use one centered cell geometry at every density: full track width up to the density max, centered tile, fixed visual box, and a stable two-line name area.

These are presentation contracts only. Search/filter/group ordering, range identity, navigation generations, and Server/Agent ownership remain unchanged.

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
- Thumbnail-eligible image and video media uses the same path across every FileExplorer surface. Images use the Server's 512px derivative directly. Videos first request the revision-fenced Server poster cache; on a cache miss Web/Desktop decode one frame through the existing authenticated preview stream, render a bounded 512px JPEG, and best-effort backfill that same Server cache. Unsupported/undecodable formats fall back to the shared file-kind icon.
- Video poster backfill must never require a Server ffmpeg runtime or a second full-file download path. The Server remains distroless, validates JPEG size/dimensions plus `If-Match` revision, and stores posters as regenerable cache data under `.xdrive-media/posters/`.
- The thumbnail scheduler remains viewport-aware, concurrency-bounded and cancellable before work starts.

Trash is a special FileExplorer directory, not a dialog:

- its navigation entry sits above Quick Access;
- it uses the normal Details/Grid surface and shared thumbnails;
- normal upload/copy/cut/paste/move/rename/delete/grouping commands are disabled while Trash is active;
- its item context menu exposes only Trash-specific actions (Restore and Permanent Delete) plus the standard Properties entry;
- Web/Desktop keep their transport adapters local but share the Trash controller and presentation.
- The thumbnail endpoint may read an authenticated owner's deleted file node specifically for Trash thumbnails; other media/gallery/preview APIs remain active-node-only.


## Finder-inspired organization and browsing contract

FileExplorer keeps one cross-platform Web/Desktop implementation. The following Finder-inspired capabilities are shared product features rather than macOS-only presentation forks.

### File Tags

- Tags are owner-scoped Server entities and can be attached many-to-many to both files and folders without moving or copying nodes.
- A tag has a stable id, user-visible name and optional color. Name is semantic; color is only a visual aid.
- The shared Tag dialog supports create, rename/color edit, delete, single-item assignment and multi-selection assignment.
- Tag assignment must be queryable in bounded batches and must not widen ordinary directory-range payloads.
- Structured Search accepts `tag_id` and applies it Server-side. Sidebar tag activation is the same Search contract, not a client-side filter over loaded rows.
- Tag deletion removes its node associations. Owner isolation applies to tag definitions, assignments and Search.

### Smart Folder / saved Search

- A Smart Folder is a persisted owner-scoped Search definition: display name + query + Server-backed structured filters.
- Saved filters persist portable Server predicates such as kind, modified time, size, synchronization folder and tag. Device-local availability is intentionally not persisted.
- Smart Folders appear as a first-class Sidebar section and support activate, rename, replace with the current Search, delete and drag reorder.
- Activating a Smart Folder calls the existing shared Search controller (`applySearch`) and keeps range loading, sort/group identity and stale-request fencing unchanged.
- Smart Folders never copy nodes and never materialize a directory tree.

### Column View

- `columns` is the third shared FileExplorer view mode beside `details` and `grid`; it is persisted in the same tab/session view-mode contract.
- Compact touch presentation (below 900 CSS px with a coarse primary pointer) projects a saved `columns` preference into the shared touch Details list. This gives inherited or restored tabs the same single-tap open, explicit multi-select, 52 px rows and per-item More actions as other mobile lists.
- This responsive projection must not call `onViewModeChange` or rewrite the saved tab/session preference. Returning to a wide viewport restores Column View; mouse-only narrow windows retain their existing desktop view semantics.
- Every visible column is one paged directory request. Columns must never fetch an entire large directory only to render Finder-style hierarchy.
- Web propagates `AbortSignal` to the paged REST request. Desktop may not be able to cancel an already-issued Agent request, so the shared view still fences every completion with per-column generation state and discards stale responses.
- When breadcrumbs shrink or switch, inactive column requests are aborted and inactive column state is pruned.
- Additional pages use the shared automatic load sentinel rather than a manual Load More row.
- Column items reuse the normal selection/open/context-menu contracts. Column View must not run Details/Grid marquee or virtual-grid geometry against its surface.

### Sidebar sorting and customization

- Sidebar section visibility is a local presentation preference and is persisted separately from collapse state.
- Quick Access supports two modes: manually ordered and name-sorted. Manual ordering is persisted Server-side with each pinned folder's position so Web/Desktop and devices agree.
- Smart Folder order is also persisted Server-side.
- Users may hide/show Quick Access, Smart Folders, Tags, Favorites, Recent and the folder tree. System Trash remains a fixed special entry and is not reordered into arbitrary sections.
- Section customization must not reintroduce repeated divider chrome between navigation sections.

### Lightweight Quick Actions

- Inspector Quick Actions are intentionally small and contextual.
- They reuse existing safe FileExplorer actions plus Tags and show at most four actions.
- Destructive operations and structural commands such as Delete, Rename, Cut/Copy/Move, Properties and Version History are not promoted into the Quick Actions row.
- Do not copy Finder's Markup, Create PDF, media trimming or other editor workflows into FileExplorer unless a separate product requirement explicitly adds them.

These five capabilities are the complete scope of this Finder-alignment phase. They must not be used as justification to introduce Gallery View, Alias semantics, free-form toolbar customization, device syncing or other Finder-specific features.


## Quick Look

FileExplorer Quick Look is a shared Web/Desktop browsing surface over the Preview Engine.

- Space opens the active file; Space/Escape closes it.
- Opening from a multi-selection freezes the selected file set in current result order. Previous/
  Next stays inside that set and never collapses or rewrites the original multi-selection.
- Opening from a single file browses the current result set, including VirtualCollection-backed
  Search and large directories without materializing the whole collection.
- Images use the shared interactive zoom/pan renderer.
- Fullscreen uses the shared immersive preview chrome; Escape exits fullscreen before closing.
- Fullscreen can play a bounded 5-second slideshow over the current Quick Look session and stops
  when there is no next item.
- Header actions are limited to safe contextual actions already supplied by FileExplorer:
  system-open when the platform has it, Download/Save As, Share, and Tags.
- Live Photo owns Space/Enter while its press-and-hold surface is focused so motion playback
  cannot accidentally close Quick Look.
- Markup, PDF signing, and image/audio/video editing are intentionally not Quick Look features.


## Web App Runtime / 打开语义

Web 与 Desktop 的普通“打开”语义不同，但 FileExplorer 本体仍保持共享：

- **Desktop 文件**：普通打开直接交给系统默认程序；“打开方式…”调用 OS chooser；Space 保留 xDrive Quick Look。
- **Desktop 文件夹**：继续在 xDrive FileExplorer 内导航。
- **Web 文件**：由统一 Web Open Resolver 根据共享 Preview classifier 启动 `media-viewer / text-viewer / pdf-viewer / audio-player`；未知格式不自动下载。
- **Web 文件夹**：启动/定位 `files` App。
- **Web Space**：启动路由级 `preview` App；Web FileExplorer 不再拥有独立的普通打开 Preview Dialog。
- FileExplorer 的内部 Tabs、目录 Back/Forward、Search 与 selection state 仍由现有 workspace controller 维护；浏览器 history 只负责 App 级跳转。
- 文件的 Ctrl/Cmd+Click 继续是多选，不能被浏览器新标签语义抢占。Web 文件右键另有“在新浏览器标签页打开”；文件夹还保留 FileExplorer 自己的“在新文件标签页中打开”。

完整 Registry、typed launch contract、Hash Route、return-state 和 browse-context 规则见 `docs/web-app-runtime.md`。
