# Gallery product roadmap

This document is the product/UI roadmap for the shared xDrive Gallery. It complements
`docs/photo-source-v2-roadmap.md`, `docs/photo-intelligence.md`, and
`docs/preview-engine.md`. Connector ingestion must remain independent from Gallery
presentation and product intelligence.

## Product boundary

- Web and Desktop Gallery product components, controllers, viewers, inspectors,
  selection surfaces, timeline/collection UI, and filters belong in `ui/shared`.
- Web/Desktop adapters only serialize platform transport differences.
- Photo semantics are local and connector-neutral. Gallery must not depend on Yike,
  Synology Photos, or FileStation semantic APIs.
- Large collections continue to use VirtualCollection plus viewport-proximate
  thumbnail scheduling. New UI must not regress to append-only dense materialization.
- User-authored state (favorites, tags, descriptions, albums, durable people and
  edit recipes) is durable intent; automatic analysis remains rebuildable.
- Features that are not implemented must not be presented as working controls.

## Status discipline and follow-up work

The Phase 1-13 table below records delivered foundations; it is not a claim of complete
iOS Photos parity or of completed physical-device acceptance. The dated
[Gallery experience audit: iOS Photos and KFS](gallery-ios-kfs-audit.md) records the verified
baseline, related PR delivery status, remaining gaps, priorities, and acceptance boundaries.

Before changing Gallery, recheck the selected master commit, the actual shared code
and both adapters, and only materially related PRs. Keep **Verified baseline**,
**In progress**, **Proposed**, and **Validation pending** distinct. Update the affected
contract and the audit's follow-up status in the same feature delivery; a component
name, a roadmap heading, or an unmerged PR is not completion evidence.

Do not rebuild the existing time scales/density memory, camera/format facets,
synchronization-folder browsing, selection toolbar, Viewer, Inspector hierarchy,
Places, Search, Memories, Cleanup, People/Pets, editing, or creative tools as new
features. Extend the concrete gap recorded in the audit. Proposed enhancements in
that audit are recommendations, not an instruction to implement the whole backlog.

## Chronological sort follow-up (G03, 2026-10-09)

The current implementation track extends the existing Server-owned sparse Gallery query
with sort_by=captured|added and sort_dir=asc|desc (capture-descending remains
the default). It does **not** perform client-side reordering of the retained viewport
or add another renderer. Timeline group-index order must match item-range ordering;
missing capture dates sort last. A semantic search remains relevance-ranked.

**Original photo anchoring on resort** uses a transient optional
`anchor_node_id` in the first Server range query. The Server computes the
logical index from the same owner/album/filter conditions and stable timestamp
plus Node ID tie breakers; it never loads the complete media set to locate the
photo. Shared Web/Desktop virtual Grid/Timeline controllers then restore that
logical index through their existing layout anchors. It is not a new pagination
service or a permanent smart-album/Viewer query field. Missing, deleted or
newly filtered-away originals fall back to the new collection beginning.

**G03 timezone stage is under CI validation.** Use the selected, validated
`time_zone` identifier for the Server's Year/Month/Day grouping, Memory day
IDs/queries and historical-day matching, capture-date filter UTC boundaries,
and Gallery/Viewer/Properties labels. This is a named IANA zone, not a fixed
offset; midnight in New York can be separated by 23 or 25 hours across DST.
Unknown capture time stays unknown, not import time. A legacy client omitting
`time_zone` keeps the existing UTC Server behavior. Older Desktop Agents must
report an unsupported zone capability rather than silently return UTC groups.
The same-item anchor remains a transient request-only field. Account/device
and 10k/100k sparse-range acceptance stay separate from source-contract checks.
Mark G03 complete only after this timezone stage's full CI and integration
tests pass; record missing physical-device testing separately. See the
[Gallery audit](gallery-ios-kfs-audit.md).

## G04 shared album presentation (2026-10-09)

The proposed first subdelivery (pending PR CI) adds a shared Web/Desktop
**album index organizer**, not a new album content model: client-side name
filtering of the bounded album index, name/recent/count/custom sort,
individually pinned albums and accessible up/down ordering. Pins/custom
order are stored under account-scoped localStorage keys, do not copy media
or mutate provider data, and are not synchronized across devices.

A later G04 stage must use the actual owner-scoped Server collection API
for manual album cover selection and real nested album-folder metadata,
with revision checks, migrations, Web/Desktop adapters and tests. Do not
present locally pinned UI rows as durable server-side folders. An optional
ratio-preserving photo-wall display must keep bounded virtual range and
thumbnail scheduling, including Live/video posters; its separate
acceptance is pending.

## G04 album-folder interface and durable hierarchy (in progress, 2026-10-09)

The owner-scoped album-folder hierarchy is **implemented on Server** by
[#1102](https://github.com/lazyxu/xdrive/pull/1102). The pending shared
Web/Desktop organizer uses `MediaAlbumFolder` (id/parent_id/revision) and
`MediaAlbum.album_folder_id` to show direct child folders, breadcrumbs and
local manual/smart album membership. Folder create/rename/move/delete and
album reassignment travel through authenticated REST/Agent with the Server's
revision-fenced `If-Match` mutations. Nonempty folder deletion, sibling
name conflicts, cycles and cross-owner destinations must never be
silently accepted, and no operation creates a new asset or changes the
filesystem's **同步文件夹** tree. Folder placement is cross-device Server data;
pinned/custom album order remains account-scoped per-device preference.
Cross-folder searching must be explicit and preserve the existing Gallery
navigation/Viewer context. Until PR CI and real device/browser acceptance,
the **shared UI integration remains under validation**; a square contain
image mode is not variable-height masonry.

## G04 virtual-wall thumbnail aspect modes (candidate, 2026-10-09)

The shared Gallery supports **方形裁切** by default and an opt-in
**原比例完整显示** presentation: each decoded still/Live/video-poster
thumbnail uses CSS object-fit: contain inside its existing square tile.
The media geometry is never inferred from filenames or capture-date
guesswork. The selected mode persists alongside the per-time-scale
thumbnail density values. Both modes use the same fixed row height,
logical index, VirtualGrid/Timeline range and thumbnail scheduler.
This prevents a 100k-photo scroll from materializing all images.

**Scope:** This is a no-crop tile mode, not a variable-height Masonry
or Apple's irregular justified grid. True variable-ratio mosaics need
separate bounded row-layout and scroll-anchor performance acceptance,
so G04's broader album-folder/true full-aspect wall work remains open.
No extra original-file reads or new renderer are permitted here.

## G04 manual album cover persistence (2026-10-09)

Phase 1 was delivered through [#1095](https://github.com/lazyxu/xdrive/pull/1095).
The separate phase 2 candidate adds `preferred_cover_node_id` to the
canonical `PhotoCollection` record (automatic migration); the effective
`cover_node_id` is only the preference when the target is still a visible
member of the owner-scoped manual album, and otherwise retains the existing
automatic cover. Explicit reset uses `node_id: 0`.

Every cover mutation requires `If-Match` revision fencing. The preferred
cover is a *logical member*, not copied bytes, and is selected through the
existing Gallery thumbnail/API/Agent transport. Gallery Viewer/Properties
remain single-presentation. Source/imported and smart collections must not
silently become editable via this manual-album endpoint.

**This phase is pending CI.** Persisted nested album folders and full-aspect
thumbnail wall remain separate acceptance and must not be marked complete
by implementing covers or device-local pins.

## G04 authoritative album folders (Server contract candidate)

Album folders are a **separate logical organization entity**, not file
system directories or imported synchronization-folder metadata. The owner-
scoped `PhotoAlbumFolder` hierarchy has a parent identifier, normalized
sibling-name uniqueness, an optimistic revision, ancestor/cycle checks,
and a bounded list API. Existing `PhotoCollection` manual/smart albums
point to the desired folder through `album_folder_id`, defaulting to root
(0) on upgrade. Imported/source albums remain fixed in their source scope.

Folder CRUD and album moves use authenticated APIs with If-Match; deletion
of nonempty folders returns a conflict and never recursively deletes
media or albums. The backend stage alone is **not** Gallery UI delivery:
the Web/Desktop shared Gallery must still show folder breadcrumbs, create/
rename/move/delete actions, and display actual Server folder assignments.
Neither device-local pinned albums nor saved searches should masquerade as
durable synchronized album-folder membership.

## G05 search and filter feedback (staged, 2026-10-09)

**Current delivery candidate:** The shared Gallery labels the applied Server query
separately from editable draft controls. Applied chips, exact owner/collection
scope, and the sparse range's `total_count` follow the same collection generation.
Clearing one chip creates a new Server query rather than locally filtering a
partially loaded 100k timeline; locked navigation filters remain read-only.
The search order reflects the Server's `search_order=relevance` when present,
or labels basic matching otherwise. Local recent search suggestions are bounded
and per-account; unavailable storage must never block browsing.

**On-demand index coverage (separate candidate):** Authenticated
`GET /media/index-status` aggregates only **already known, active logical
PhotoAssets** for the selected owner and their primary media index metadata,
with ready/error/unsupported/missing/other counts and checked timestamp.
It is *not* a claim that every file has been scanned: unseen items have no
PhotoAsset record and must not be included in the denominator.
Search's Server `total_count` remains scoped to the submitted query, whereas
the optional status is global to that owner's known assets. A zero search
match must never mean a completely indexed library. The button explicitly
starts the status request; first-image fetch and camera/format facets remain
independent. The implementation requires full CI and PostgreSQL owner,
trash and missing-metadata integration verification before G05 can be
marked complete. Keep the Server-owned sort/ranges and Viewer context.

## Authoritative location/provenance contract (G06)

The phase-1 source-of-truth is the owner-scoped live xDrive Node tree:
`GET /api/v1/nodes/:id/location` reports current full path, parent
directory, ID-based breadcrumbs, matching synchronization-folder root
membership, and separate original connector provenance from SourceItem.
An old remote `SourceItem.Path` is not an xDrive current file path;
a matching source target ancestor is not proof that the connector created
that individual Node. A moved file retains its original source evidence
but its current folder path and container membership change.

The endpoint is read-only and lazily requested. The Gallery's 100k sparse
list should never pay per-node ancestry or source provenance queries.
The next G06 steps are shared Properties UI, Web/Desktop FileExplorer
"显示所在位置" using owner-authorized parent IDs, and a clearly labeled
current-folder versus descendant scope. Do not mark G06 complete until
all of those and device tests are actually verified.

### G06 phase 2a — shared on-demand media location, Web candidate (2026-10-09)

**In progress / PR CI pending:** Shared media Properties now accepts the G06
NodeLocation loader without adding a new player or changing 100k sparse Gallery
ranges. Its Location section distinguishes current xDrive ancestry, current
synchronization-folder target containment, and historical SourceItem provenance.
The request begins only when Properties mounts, is AbortSignal-scoped to the
selected Node/revision, and offers explicit error/retry and Show in Folder by
authoritative parent ID. Ordinary Gallery, FileExplorer media Properties and the
routed Web media Viewer use the same content. Neither Viewer playback nor the
underlying file bytes are reloaded just to show this location section.

Web transport and router accept owner-authorized Node IDs and navigate using
the returned directory IDs, not an inferred connector path. The Server phase 1
endpoint is a dependency and must pass its own CI before this Web layer merges.
Desktop Agent capability/IPC/Main/Preload parity and physical device acceptance
remain separate follow-ups; this Web candidate **does not complete G06**.
The dedicated Node component test reproduces stale location completion across
node switches, AbortSignal cleanup, and verified source/location display.

## Fixed implementation order

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Gallery IA/UI: Library / Memories / People / Places / Albums / Favorites / Media Types; advanced filters in popover | **Current foundation** |
| 2 | Year / Month / Day semantic timeline + thumbnail density | **Current** |
| 3 | Multi-select + shared Selection Toolbar | **Current** |
| 4 | Gallery Trash + Favorites + media-type smart collections | **Current** |
| 5 | Viewer 2.0: fullscreen, zoom/pan, filmstrip, chrome hide, actions | **Current** |
| 6 | Desktop Inspector / responsive Drawer replacing the large details dialog | **Current** |
| 7 | Map Places | **Current** |
| 8 | Smart Search: object/scene + OCR, then semantic search | **Current — lexical + semantic relevance** |
| 9 | Memories / Recent Days / Trips / On This Day | **Current** |
| 10 | Duplicates + Burst Best Shot + storage cleanup | **Current** |
| 11 | Pets / people groups / suggestion review | **Current** |
| 12 | Basic non-destructive photo/video editing | **Current** |
| 13 | Optional AI erase / cutout / automatic movies / advanced creation | **Current — Cutout Refine + Smart Erase + Auto Movie Templates/Music + Collage** |

## Phase 1 — shared Gallery information architecture

Phase 1 changes Gallery from one vertically stacked management page into a photo-first
workspace with explicit internal destinations:

- **图库** owns the main photo collection.
- **人物与宠物** owns durable people, automatic person review, and local pet-type collections.
- **地点** owns local-GPS place browsing.
- **相册** owns manual, smart, and imported albums.
- **收藏** reuses the existing Server-side favorite query.
- **媒体类型** provides a product entry point over existing asset-kind queries.
- **回忆** owns local, deterministic Recent Days / Trips / On This Day projections.
  No placeholder data, provider-supplied memories, or fake generated memories are allowed.

Opening a person, place, album, or media type keeps that section as the navigation
context, and Back returns to the section index instead of dumping the user into the
old all-in-one page.

The root surface keeps a compact search field plus one **筛选** action. Date, location,
favorite, tag, manual-person, durable-person, and asset-kind controls live inside a
popover instead of permanently consuming the first screen. Favorites and active
media-type collection constraints are visibly locked in that popover so advanced
filters cannot silently violate the selected Gallery destination.

The existing Server-side query contract remains authoritative. Phase 1 intentionally
does not add a second Gallery endpoint or duplicate media state.

### Phase 1 workspace polish

The Gallery page renders exactly one visible page title. The shared workspace surface may
suppress its generic page header when Gallery owns the title and collection controls
itself; Web and Desktop must not add another platform-local heading.

The first screen uses a compact two-tier shared workspace header: title/current
collection summary plus search/filter/actions, then Gallery destinations plus
selection/time-scale/thumbnail-density controls. The root Library does not render a
second "all photos" heading above the grid. The sparse range total is the authoritative
result count shown in the Library summary.

Collection-range failures are distinct from successful empty collections. A failed
initial range shows a blocking **图库加载失败** state with retry and must not
simultaneously claim that the Gallery is empty. Auxiliary facet or mutation failures
may remain non-blocking alerts when collection content is still valid. Successful empty
results distinguish Trash, Favorites, media-type collections and active search/filter
conditions; an empty filtered Library offers **清除筛选**.

## Follow-up after the delivered foundation

Year / Month / Day navigation and density are already implemented below. Follow-up
work is tracked in the [dated experience audit](gallery-ios-kfs-audit.md), beginning
with the shared FileExplorer media Properties adapter built on merged #1071.
All browsing extensions retain stable scrollbar geometry and
bounded metadata/thumbnail retention; semantic zoom must not materialize the entire
Gallery.


## Phase 2 — semantic time scale and thumbnail density

The Gallery collection surface now exposes **年 / 月 / 日 / 所有照片** as shared
Web/Desktop time-scale controls. The first sparse range response carries compact
`year`, `month`, and `day` group indexes. Server computes one day-level aggregate
over the already-filtered collection and derives month/year indexes from those counts;
it does not materialize media rows and changing the time scale does not re-fetch the
whole collection.

`所有照片` uses the ordinary sparse virtual grid. Year/month/day views use the same
logical item indexes with different group headers, so preview navigation and viewport
range requests remain stable.

Thumbnail density is presentation-only shared state. The size slider changes the
minimum tile width used by Grid and Timeline layout calculations; it does not change
the query key, reset VirtualCollection, or issue a new Server request. Viewport
retention and the bounded thumbnail scheduler therefore continue to control memory and
network work independently from tile size.

The shared view preference now remembers the selected time scale plus an independent
tile density for Year / Month / Day / All Photos. Defaults intentionally make Year the
densest scan (96 px), Month medium (144 px), Day larger (192 px), and All Photos medium
(144 px). The preference is stored locally by the shared Gallery surface, so Web and
Desktop renderer sessions keep the same behavior without adding a Server preference
contract. Changing time scale or density restores the first visible logical media index;
the sparse collection key and range query remain unchanged. Timeline date headers are
sticky, and a bounded year/month jump control uses the compact timeline group indexes to
move directly to a group start without materializing the full Gallery.


### Photo-wall presentation

Grid and Timeline use one compact **4px** gutter and square, zero-radius media tiles.
Ordinary still images do not carry a permanent “图片” badge; persistent badges are
reserved for media semantics that help scanning the wall, including video duration,
Live Photo, RAW, burst, GIF, panorama, sidecar/edit relations and cleanup recommendations.
Multiple badges share one stacked top-right lane so they never overlap.

Desktop keeps the file name and an unselected Favorite control visually quiet until
hover/focus, while existing favorites remain visible. Compact touch keeps the dedicated
Info/Favorite/selection controls at 44 CSS px and places Favorite after the selection
target without overlap. Thumbnail requests keep the existing bounded scheduler; pending
thumbnail pixels use a non-animated rectangular skeleton rather than one progress spinner
per visible tile.


### Structured camera / format facet contract

Gallery camera and primary-media-format filtering is Server-side and supports multi-select
OR within one facet group and AND across different filter groups. Camera keys are
canonical lowercase make+model strings; format keys are canonical lowercase MIME types.
Smart albums persist these same query fields.

Facet counts are loaded through a dedicated endpoint **only when the advanced filter UI
asks for them**; ordinary first-page/range loads must not run facet GROUP BY work. Each
facet count removes its own current selection while preserving the remaining query,
collection/album scope, and semantic-search result set, so available choices stay useful
without changing the result semantics.

Web and Desktop expose the same shared multi-select controls for **拍摄设备** and
**文件格式**. Opening the advanced filter popover lazily loads facet counts; selected
values become ordinary Server-side Gallery query fields and therefore also survive
smart-album create/update. A smart album requests facets from its saved query without
also applying the smart-album collection a second time, so self-excluding facet counts
remain correct. Opening the advanced Popover performs one facet request; opening either
Autocomplete does not issue a duplicate aggregation. Changing a camera or format
selection refreshes the cross-facet counts with the immediate draft, and stale facet
requests are ignored after a newer request or page unmount.



### Synchronization-folder / directory browsing contract

Gallery directory browsing borrows KFS's strongest navigation idea: **the current path is
first-class state**. The implementation does not copy KFS's old visual shell and does not
import provider directory semantics.

- A Gallery **同步文件夹** root is derived only from an owned xDrive `Source.TargetNodeID`.
- Directory navigation is derived only from the local `xd_nodes` parent tree.
- Media scope is direct-directory scope: `folder_id=<node id>` means photos whose local
  primary Node is directly inside that directory. Nested directories stay navigable
  rather than being silently flattened into the parent photo wall.
- Folder cards expose direct media count, direct child-folder count, and an optional
  locally indexed cover. They do not run recursive subtree aggregation on ordinary
  Gallery first-load paths.
- Breadcrumbs are bounded to the selected synchronization-folder root. A folder outside
  that root, another user's folder, or a non-directory target is rejected.
- Camera/format/search/date/favorite/person/place filters compose with `folder_id`, and
  facet counts preserve the folder scope.
- The contract is local-only: Yike/Synology provider albums, provider thumbnails, provider
  EXIF, and provider directory metadata are not required for Gallery folder browsing.

The Server exposes synchronization-folder roots and one-directory-at-a-time navigation
through dedicated Gallery endpoints. Web and Desktop consume the same shared browser:
entering **相册** lazily loads synchronization-folder roots, opening one folder loads only
that directory's children, breadcrumbs stay bounded to the selected root, and the normal
Gallery VirtualCollection renders only the current directory's direct media. Search,
camera/format, date, favorite, person and place filters continue to compose with the
transient `folder_id` scope. The initial Gallery first-visible path never loads folder
roots or recursive subtree statistics. Directory scope is intentionally not persisted
inside smart-album rules.


## Phase 3 — multi-select and shared Selection Toolbar

Gallery selection is owned entirely by the shared Web/Desktop surface. Users can enter
selection mode explicitly with **选择**, use Ctrl/Cmd to toggle items, and use Shift for
a bounded range over the currently retained sparse window. Shift selection deliberately
does not materialize an arbitrarily large logical range: the shared controller caps the
range walk at 1000 logical indexes and only selects media metadata already present in
VirtualCollection.

The shared Selection Toolbar supports:

- batch favorite / unfavorite;
- add selected media to an existing manual album using the existing multi-node album contract;
- append tags to selected media without replacing existing tags;
- download one selected item directly or multiple items through durable Archive prepare;
- delete through the existing durable FileOperation delete contract, so the task remains
  visible/cancellable in Task Center.

Favorite and tag mutations have owner-scoped batch APIs limited to 1000 unique primary
media nodes per request. Favorite uses one set-based metadata update. Batch tag updates
run transactionally and merge normalized tags with each asset's existing local tags.

Selection state is collection-generation local. Changing Gallery section/person/place/
album/media-type clears the selection, and Escape exits selection mode. Grid and Timeline
share the same selection state and toolbar; platform adapters only bind the existing
download/delete transports.


## Phase 4 — Trash, Favorites and reliable media collections

Favorites remain a first-class Gallery destination backed by the existing durable
`PhotoMetadata.favorite` state.

Media Types now distinguishes collections that can be derived from deterministic local
evidence:

- **视频** from canonical media kind;
- **实况照片** from reliable Live Photo relation/LIVP evidence;
- **RAW 组合** and **连拍** from the existing local PhotoAsset relation model;
- **GIF / 动图** from the actual indexed `image/gif` MIME type;
- **全景** only when embedded GPano/XMP explicitly confirms panorama semantics.

xDrive does **not** infer **截图 / 自拍 / 录屏** from filenames, directory names,
aspect ratios, dimensions, or timestamps. Those destinations stay absent until the
local parser/classifier has a deterministic evidence contract. Provider-specific
labels must not become canonical Gallery truth.

### Gallery Trash

Gallery Trash is a dedicated sparse collection over deleted media projections. It
reuses the shared Gallery grid and thumbnail scheduler, and each media item carries
its generic Trash root so restore/permanent-delete actions preserve the existing
FileExplorer subtree semantics. Shared code deduplicates selected media by Trash root before invoking platform
transports. The Selection Toolbar surfaces that root count and warns explicitly when
a selected photo belongs to a deleted folder, because restore/permanent-delete acts on
the whole Trash root subtree rather than one descendant photo.

Soft deletion preserves the existing `PhotoAsset` and user-authored
`PhotoMetadata` snapshot (favorites, tags, people labels, descriptions and manual
album membership). Active Gallery and album counts still exclude deleted nodes. The
snapshot is reconciled normally after restore and is removed only when the underlying
Node is permanently deleted and FK cascade applies.

Deleted media intentionally has a narrower capability surface:

- thumbnail and indexed metadata are readable;
- restore and permanent delete are available;
- favorite/tag/album edits are disabled;
- original file Preview, Live Photo motion, and analysis preview remain unavailable.

This preserves the existing active-node authorization boundary: Gallery Trash does
not widen the generic file-preview ticket or analysis-preview contracts.


## Phase 5 — Viewer 2.0

Gallery Viewer 2.0 is a shared Web/Desktop product surface built on the existing Preview
Engine rather than a second media renderer.

The boundary is deliberate:

- `XDriveOpenPreviewDialog` owns only generic preview chrome, previous/next navigation,
  optional fullscreen, optional immersive chrome auto-hide, and action/footer slots.
- `FilePreviewSurface` owns ordinary media rendering. Its image renderer has an
  **explicit opt-in** interactive mode for wheel/button zoom, double-click zoom,
  pointer-drag pan, and fit/reset. Inspector and ordinary FileExplorer preview keep
  their existing non-interactive behavior unless they opt in.
- `XDriveMediaGalleryViewer` owns Gallery-only semantics: Favorite, media Info,
  Download, Share, Delete, filmstrip, and Live Photo presentation.
- Share reuses the existing `XDriveShareDialog` and the existing Web/Desktop share
  adapters. Viewer does not create shares or invent default share policy.
- Delete reuses the durable FileOperation path from Phase 3; Download reuses the
  existing single-file/archive transports.
- Live Photo keeps Phase 4/preview-engine lazy motion behavior: mounting Viewer does
  not fetch motion bytes. First hold requests motion and keeps byte-progress reporting.

Filmstrip metadata remains bounded. When Viewer opens, Gallery asks VirtualCollection
for only the current logical index plus a small neighborhood (currently ±6), and the
filmstrip renders only already available entries around the active item (currently
±5). Viewer must never allocate or fetch the whole logical Gallery to build a filmstrip.

No new preview endpoint, media token, Gallery-only raw stream, or persistent preview
cache is introduced by Viewer 2.0.

### Viewer action/session concurrency (2026-10-10; PR #1212)

Web and Desktop share Viewer action ownership for Favorite, Download, complete
Live Photo export, and Delete. The action lane claims its current media-session
owner **synchronously**, not only through React's next Busy render, so same-tick
clicks cannot submit duplicate mutations/transfers or start Download and Live
export together. Selection of another Node/revision and close/reopen of the
same media create a new action scope without aborting prior durable Server tasks.
Older completions, failures, and finally handlers cannot release the current
item's Busy state; a stale Delete completion cannot close a new Viewer.
A stale confirmation handler never starts a mutation. A successful current
Delete still closes the initiating Viewer normally.

Deterministic first-red: GitHub Actions run 37979553061, `desktop-tests`,
original production Viewer hooks and actual JSX handlers, **8 failing assertions
out of 10 tests** (duplicates, A→B Busy and stale Delete closure; two unchanged
normal flows passed). The same executable source-backed regressions and
additional A→B→A, stale confirm, and rejection-path cases are in
`desktop/tests/shared-gallery-viewer-action-async-race.cjs`.
Acceptance requires the original schedules to become green, the related
Viewer tests, Web/Desktop builds, Go race, and exact-head CI final gate.
Physical mobile/device acceptance remains separate.



## Phase 6 — responsive media Inspector

Media details no longer own a modal Dialog. Shared Gallery presentation is split into
two responsibilities:

- `XDriveMediaDetailsContent` owns the reusable photo/media information and editing
  surface: Preview Engine presentation, Favorite, tags, manual people labels,
  description, album membership, EXIF/GPS/video fields, and logical asset resources.
- `XDriveMediaDetailsInspector` owns responsive presentation only. At `lg` and
  wider it is a non-modal 360 px right-side Inspector; Gallery reserves horizontal
  space so the photo collection remains usable while information is open. Narrower
  layouts use a bottom MUI Drawer with the same content and business semantics.

The accepted interaction target uses the Info icon with the product label **属性**.
Opening Properties from Viewer must retain the Viewer and its active media, and the
Properties surface must not mount a second player or fetch Live Photo motion again.
Active, permitted Gallery media opens Viewer on ordinary single click/tap, while
explicit selection and modifier-key selection keep selecting. Trash remains restricted
to Properties; it does not open Viewer or fetch original/Live motion resources.
Right-click exposes **属性**. FileExplorer media
Properties must consume the same content through a Node/MediaItem adapter, without
changing ordinary file/folder selection or Properties semantics.

[PR #1071](https://github.com/lazyxu/xdrive/pull/1071) merged on 2026-10-09 as
[27fe038ec87c2b2b8ca200f86977e6e8938925da](https://github.com/lazyxu/xdrive/commit/27fe038ec87c2b2b8ca200f86977e6e8938925da),
delivering desktop direct-open and in-Viewer Properties after the audit's fixed
baseline. The audit records this delivered update. The FileExplorer media Properties
adapter subsequently shipped in #1076; its lazy Node/MediaItem lookup and retained
file context are now part of the canonical shared contract below. M09 accepts those
existing boundaries across Files, Gallery and the routed Web Media Viewer.
There is no Web/Desktop details fork: both clients consume the same shared content and
responsive container, while Preview transport remains platform-specific through the
existing adapters.

### Shared Inspector information hierarchy

The same read-only data and permitted editing actions are grouped consistently for
Web, Desktop and the mobile bottom Drawer, borrowing KFS's useful separation between
media metadata and file resources without copying KFS's separate property windows:

1. **照片信息** comes immediately after the preview: logical media type, canonical
   capture time (never file modification/import fallback), dimensions/orientation,
   video technical parameters, camera/lens and available GPS/altitude. Invalid or
   absent capture time explicitly says **未记录**. Media index errors stay alongside
   these technical fields.
2. **整理** owns Favorite, tags, manually maintained people labels, description and
   manual-album membership. When capabilities are absent (notably Trash), render
   existing Favorite/tags/people/description as read-only facts; never expose a
   disabled mutation as though it were permitted.
3. **文件与资源** owns the true Node filename/size, MIME, generated thumbnail
   details and existing logical-asset resource membership. A precise path, source
   label, or jump-to-Explorer link is not inferred from Node parent IDs: it requires
   an authoritative owner-scoped path/navigation contract and is deliberately
   outside this UI-only slice.

Sections do not issue their own metadata requests, eagerly enumerate directories,
or introduce a second Preview Engine. The same data source, edit callbacks and
responsive Inspector container remain unchanged.

Gallery Edit Dialog lifecycle race verification (PR #1206, 2026-10-10):
the shared Web/Desktop edit-recipe Save/Reset callbacks must not apply a late
result, error, or Busy-finalizer from another selected asset, recipe revision,
or closed/reopened edit session. An A→B→A return is still a new session.
Synchronous in-flight ownership prevents same-render duplicate Save/Reset
requests while preserving the existing durable Server mutation, edit recipe,
and Preview Engine behavior. The original component function and Reset JSX
handler were executed with controlled Promise ordering; the eight deterministic
first-red failures are recorded in GitHub Actions run 37976170606
(`desktop-tests`, test numbers 489–496). The same eight interleavings plus
six current-owner/ABA/revision/same-tick regression checks live in
`desktop/tests/media-gallery-edit-async-race.cjs`; PR exact-head CI is the
merge gate, distinct from native Web/Desktop device acceptance.

M09 acceptance preserves this shared contract. Tags/people/description editors keep
local save completion, errors and busy state owned by the initiating selected Node,
so A's late response cannot replace B's draft. A byte revision alone does not create
a different annotation target: legitimate same-Node normalized saves remain accepted.
Compact Inspector Close has a44px target, and routed Viewer retains visible chrome
and native return focus throughout Properties reading without recreating its player.
The same raw still/video/Live fixtures produce identical ordered information/file/resource
rows across Files, Gallery and the routed Viewer; exact evidence is in
[the M09 ledger](validation/mobile-shared-properties-2026-10-09.json).

Gallery Trash keeps its Phase-4 capability boundary in the new Inspector. Deleted media
may show thumbnails and indexed metadata, but Favorite/tag/people/description/album
mutations and original Preview remain unavailable.

Places metadata (GPS faceting and optional GeoNames location labels) remains local and is separate from **map rendering**. The map provider is exclusively Baidu Server API. See `docs/baidu-map-server-api.md` for operational and failure contracts.

## Phase 7 — Map Places: Baidu Server API only (2026-10-10 decision)

Gallery Places on Web/Desktop/Mobile Web uses one shared map component backed solely by Baidu's static map Server API, proxied by the authenticated xDrive Server. There is **no** local SVG world outline/graticule renderer, fallback tile service, or automatic fallback on network errors. With no valid Server AK, disabled provider, old Agent, upstream failure or quota exhaustion, the map region explicitly reports unavailability; the nearby plain-text location list and existing photo filtering remain usable.

- A Places visit expands only the compact facet query from the normal 24-card preview to at most 1000 facets; it does not fetch every photo row. The separate location-card list remains limited to 24.
- A searchable MUI location selector chooses a single latitude/longitude and loads one Baidu server-side static image; zoom and refresh are bounded user actions. View-location-photos opens the existing Place filter.
- Original EXIF GPS remains WGS84; the server proxy sends `coordtype=wgs84ll` and supplies a secret Server AK. No token or Baidu upstream URL is sent into Web/Desktop.
- **No offline map rendering:** the former `MediaGalleryPlacesMapModel` local projection/cluster helpers and SVG basemap are retired. Do not reintroduce them as a failure path, or swap to other map providers.
- GeoNames is optional for place *names only*, not a map renderer. It cannot substitute for a failed Baidu map call.
- Baidu Static Map supports snapshots and button zoom, not true interactive tiled drag/tilt; further map interaction requires official Baidu API design and separate acceptance.


## Phase 8 — Smart Search: visual labels + OCR foundation

The first Smart Search slice keeps the existing shared Gallery search box and existing
Server-side `q` query. Web/Desktop do not gain a second search controller or client-side
index. Instead, the optional local Photo Intelligence worker produces two rebuildable
asset-scoped projections:

- `visual_label`: bounded MobileNetV2/ImageNet object and broad scene labels with
  confidence;
- `ocr_text`: bounded scene text from PP-OCRv3 detection plus the Chinese CRNN
  recognizer, whose pinned charset also covers Latin letters and digits.

Both analyses consume only the canonical xDrive 1280px analysis preview. They run in
the existing `ml_cpu` background resource class through the same distributed owner
lease, durable reanalyze, cancellation, and Task Center contracts as other Photo
Intelligence work. The reference analyzer remains opt-in and has no runtime Internet
access; model hashes, licenses, label vocabulary, and OCR charset are pinned in the
image build.

Gallery `q` now searches local filename/camera/description plus user tags, manual
people labels, durable person names, ready place labels, ready visual labels, and ready
OCR text. Stale/failed analysis rows are deliberately excluded from search, so a model
upgrade never exposes a mixed-generation intelligence index.

The search UI remains entirely under `ui/shared`; platform adapters continue to pass
the same `MediaGalleryQuery.search` value.

### Semantic retrieval

The second Phase-8 slice adds multilingual image/text semantic retrieval without
introducing a second Gallery search surface:

- `semantic_embedding` is a rebuildable Photo Intelligence analysis kind generated
  from the same canonical 1280px analysis preview.
- The optional local analyzer uses pinned SigLIP2 image/text towers. Image vectors are
  produced asynchronously; query text is embedded on demand.
- Embeddings are L2-normalized and persisted as compact signed-int8 `i8norm-v1`
  bytes with analyzer version and dimensions. Model generations never mix.
- PostgreSQL remains the durable source of truth. xDrive does not require pgvector or
  a second database for this phase.
- Server keeps a bounded owner-scoped in-memory exact-cosine index/cache rebuilt from
  current `ready` rows. The initial exact implementation is intentionally simple and
  deterministic; an approximate HNSW backend may replace it later if named large-library
  benchmarks show a real bottleneck, without changing the Gallery/API contract.
- Existing lexical evidence receives a strong relevance boost, so exact filename,
  tag, OCR, person and place hits remain ahead of merely similar images.
- If the semantic analyzer or current-version index is unavailable, `q` degrades to
  the lexical Smart Search behavior instead of failing Gallery search.
- Relevance results use the ordinary shared virtual photo grid. Year/Month/Day controls
  are hidden while a search term is active because timeline order would contradict
  relevance order; clearing search restores the previous time-scale UI.

Web/Desktop continue to share the same Gallery controller and `MediaGalleryQuery.search`
contract in `ui/shared`; platform code still only transports requests.


## Phase 9 — local Memories projections

Memories is now a real shared Gallery destination. It deliberately does **not** add a
second photo database, copy album memberships, or persist automatically generated
memory membership.

The Server derives three deterministic card types from canonical local media state:

- **近期回忆 / Recent Days**: capture-date days from the most recent 14-day window
  with at least two visible media assets;
- **往年今日 / On This Day**: media captured on the same month/day in years before
  the card's anchor year;
- **行程 / Trips**: GPS-bearing capture days are reduced to a dominant city-scale
  grid cell. The historically most frequent cell is treated as the owner's local
  baseline; consecutive non-local capture days, allowing one empty day between
  captures, become a trip only when they span at least two capture days and at least
  four GPS-bearing assets. Once a trip date range is selected, the card count and detail
  collection both use all ready visible media in that range, including camera media
  without GPS.

These are **read projections**, not PhotoCollection rows. Card IDs encode only the
deterministic rule inputs (`recent:<date>`, `on-this-day:<anchor-year>:<MM-DD>`,
`trip:v1:<start>:<end>`); opening a card recomputes its detail membership from current
canonical media data. Deleting, restoring, reindexing, or changing local metadata
therefore naturally changes Memories without reconciliation jobs.

The initial date boundary follows the same UTC capture-date semantics as the existing
Gallery Year/Month/Day timeline. A future Gallery-wide user-timezone contract should
move Timeline and Memories together rather than giving Memories a private date model.

Web/Desktop transport remains thin:

- Server: `GET /media/memories` plus range-backed
  `GET /media/memories/:memoryID/items`;
- Go client / Desktop Agent IPC / Web API only serialize memory id, anchor date and
  range window;
- `ui/shared` owns `MediaMemory`, the Memories card surface, section state, and the
  memory collection target.

The Memories root does not start a media VirtualCollection. Only opening one card
creates a sparse `kind='memory'` range collection; Viewer 2.0, Selection Toolbar,
Inspector, thumbnail scheduling, Favorite/Download/Delete, and preview behavior are
then the same shared components used by every other Gallery collection.

Trips use only xDrive-local GPS and optional local place labels. They do not consume
provider trip/albums/person semantics, online location services, or AI inference.


### G11 Cleanup deletion completion reconciliation (2026-10-10)

**Implementation candidate / PR CI pending.** Both Web and Desktop now forward
their actual durable file-operation receipt through the shared Gallery adapter.
Gallery triggers an immediate read through the **existing Task Center file
operation lifecycle**, which already polls active tasks; only the full Server
operation is retained in Task Center, while Gallery tracks its ID. No second media poll
or unrelated Gallery-wide invalidation is introduced. When deleting inside
a Burst cleanup review, the UI tracks the exact returned operation ID and
**does not** treat accepted submission as deletion completion.

Only a matching Task Center `completed`, `failed`, or `cancelled` status
triggers a new authoritative Cleanup group query. `queued`, `running`,
`cancel_requested`, missing IDs and unrelated task completions do not
trigger cleanup refresh or imply saved bytes. A task that is already terminal
when submitted takes the immediate refresh path. Reopening Cleanup after
navigating elsewhere uses the existing first-page query; pending results
must not navigate the user back from an unrelated Gallery section or a different
open Burst review. Account changes invalidate any pending task association.
Failed or
cancelled atomic batches are still reflected in Task Center rather than
being reported as successful deletion; no partial-success amount is
fabricated. Older/mock adapters without valid receipts keep their legacy
immediate refresh but do not claim task-final consistency.

A shared-model+actual-TSX callback/effect regression test covers task receipts,
queued/running/cancel-requested vs terminal states, unrelated task IDs,
failed/cancelled outcomes, duplicate terminal snapshots, scope navigation,
and Web/Desktop wiring. This only improves **post-task Cleanup refresh**;
it is not a destructive full-asset SHA merge, nor a guarantee that an
externally delayed media re-index or remote provider inventory has converged.
Physical-device/live-PostgreSQL checks remain a separate validation gate.

### G11 Cleanup Burst review deletion refresh scope (2026-10-09)

**In progress / PR validation pending.** The shared Web/Desktop Gallery deletion
callback must depend on both the currently opened Burst cleanup review and its
Cleanup reload function. When the user opens or leaves a review without changing
other Gallery query state, the callback must not retain a stale closure from
the previous surface. A successfully submitted delete from the Burst review
refreshes the Cleanup overview route; a normal Gallery delete refreshes the
active sparse collection, and a rejected submission does not refresh either.
A regression test executes the actual extracted TSX callback with React-style
memoized dependency comparison across these scope transitions.

**Important boundary:** The shared deletion adapter currently submits a durable
file-operation task and returns on acceptance, not terminal completion.
This is a narrow stale-closure/refresh-routing correction, not a guarantee
that eventual cleanup group counts or members have converged after a queued
job finishes. Final completion-driven refresh requires separate Task Center
terminal-state wiring and actual Web/Desktop plus PostgreSQL verification.
Nothing here implements automatic SHA duplicate deletion, changes Live/RAW
resource boundaries, or weakens the source Mirror keeper safety guard.

### G11 P4 phase 8 — protect annotations from a Mirror-managed keeper (2026-10-09)

**Merged #1181 — CI verified.** Previous native
PostgreSQL #1176 verifies that Mirror's completed full inventory can move
*only* its bound source duplicate to Trash after the existing two-scan/24h
grace, leaving an unrelated independent annotated keeper unchanged.
It also identified the reverse risk: when a user chooses the **Mirror-owned**
copy as keeper, collected annotations can cease to appear in active Gallery
if the provider later removes that particular Node.

The non-destructive G11 organize **plan** must fail closed for that choice,
using the verified per-resource `PhotoResource(Node) → SourceItem → Source`
links already audited in #1157: a selected keeper with **any currently
linked Mirror SourceItem**, including a motion/RAW/sidecar resource, is marked
not ready and receives a clear Mirror-loss warning. Its verified complete
asset comparison remains factual; *identical* means content is identical,
not that the chosen keeper is durable. The serializable `/apply` endpoint
must refuse this volatile keeper even with `confirm:true` and a fresh
revision token. Web/Desktop must show the risk and omit the confirmation
action. A real PostgreSQL/Gin Mirror fixture checks rejection and verifies
that no original annotations change, then the already-accepted independent
keeper union and two-pass Trash behavior still succeed.

Do not infer origin from a folder path or claim that an absent SourceItem
link means no Mirror ownership. The guard deliberately does **not**
suppress the source's normal Trash policy, delete files, alter CAS/quota,
rewrite albums, or protect historical annotation merges already committed
to a Mirror-linked keeper. Full resource-group Trash, original description
and edit-version history retention, audited Undo and actual provider
replay remain explicit release gates before destructive consolidation.

**2026-10-09 motion-only / RAW-resource Mirror regression:** the PostgreSQL
owner-scoped two-copy media fixture now additionally tests a keeper whose
**primary still/rendered Node has no SourceItem**, but whose secondary Live
motion or RAW original Node is linked to Mirror. The plan remains factually
complete-asset `identical` while reporting `ready_for_manual_review=false`;
confirmed `/apply` must fail with a stale-safe conflict even with a fresh
plan digest, for both synced and missing source-item states. Reclassifying
the verified pair as RAW in the fixture exercises the resource-role rule,
not filename/extension pairing. The independent Backup-linked keeper remains
eligible. This is an integration **test**, not physical remote-provider replay,
whole-asset Trash, or a new production capability. No original Node, edit,
SourceItem or CAS reference is changed by a rejected merge.

### G11 P4 phase 7 — preserve distinct descriptions by explicit keeper choice (2026-10-09)

**In progress / CI pending.** The existing non-destructive annotation-only
confirmation remains the only write operation. If multiple original files have
different nonempty descriptions, the Server now accepts an optional, explicitly
reviewed `selected_description` with the existing 64-character
`expected_plan_revision` and `confirm:true`.

- No selection means **409 Conflict**; a description not present verbatim in
  the reviewed plan, a missing keeper, a different edit/resource identity or
  a stale plan revision also fails closed.
- If the selected keeper already has nonempty description text, **only that
  exact original text may be chosen**. To select another description, choose
  the original file bearing that text as keeper and review again. An empty
  keeper may explicitly adopt one reviewed original description. Do not
  silently replace or lose keeper text.
- Other descriptions remain on their **independent original assets**; selected
  keeper's favorite, tags, people notes, manual albums and durable people are
  still merged using the existing serializable transaction. Source albums,
  original resource relationships and all PhotoEditRecipes are untouched.
- Web/Desktop share the MUI description selection, reset user confirmation
  on any choice or keeper change, and transport the exact string through
  REST / Agent IPC. The audit records only that an explicit choice was made,
  **not any description text**.
- This is **not** a durable multi-description archive: physical duplicate
  deletion remains prohibited until description history, edit-version history,
  Trash/undo and Source reimport rules are implemented and tested. It yields
  **zero physical reclaim**. Older Server/Agent clients fail closed.

Native PostgreSQL integration verifies two independent descriptions, rejecting
missing/unreviewed/keeper-overwriting choices, accepting an exact keeper-own
choice, preserving other original text and metadata, and excluding sensitive
text from audits. Test and product CI are authoritative; do not claim this
stage merged before full gate success.

### G11 P4 phase 2 — shared metadata organization review UI (2026-10-09)

**Implementation pending CI:** after the successful backend dry-run #1139, the
shared Web/Desktop Gallery verified-duplicate fold dialog exposes an **explicit
`查看保全计划`** control for **2–32 selected real primary Nodes**. The user
selects the intended keeper; the UI forwards that exact bounded member set
through Web REST or Desktop Renderer → Main capability gate → Agent IPC →
Go Client to the authoritative, owner-scoped read-only endpoint.

The response is **not** automatically fetched on Gallery first paint or
during folding: clicking the control is required. It shows independent
per-copy favorites, tags, people labels, descriptions, manual/source/folder
collection memberships, persistent person identities, original resource
SHA/role and edit-recipe presence. Distinct descriptions and different/
unverified full assets are visible, not silently combined. A stale or
unexpected member response is rejected, with no client-side inference of
ownership or CAS savings. The control is omitted on groups above 32 members
with an explicit reason; Viewer still opens the genuine selected Node.

No mutation is implemented in this step. The existing no-zero-benefit-Cleanup
rule remains, all original Nodes/resources/edit recipes/source identities stay
independent, and `ready_for_manual_review` **does not** mean eligible for
automated deletion. Subsequent transactional consolidation and safe undo
need separate native PostgreSQL correctness gates including concurrent sync
and reimport. This stage is not a full metadata merge.

### G11 P4 phase 6 — CAS owner quota / Trash / global reference integrity (2026-10-09)

**Test-only regression in progress, authoritative PostgreSQL CI pending.**
Extend the native `TestGlobalContentDedupQuotaAndLastReferenceDeletion`
through the actual HTTP upload, soft-delete, Trash permanent-delete and
re-upload routes:

- **Three identical original files for owner A plus one for owner B** share
  exactly one globally content-addressed blob. Each owner's logical files
  remain separately counted, and its **physical quota is unique per
  storage key within that owner**, not the global `ref_count`.
- After trashing one A copy, A's logical bytes move to Trash but physical
  quota and global CAS references are unchanged. After permanently deleting
  **two of A's three copies**, global CAS references fall from four to two,
  but **A's physical used bytes remain one original-file size** because A
  retains its keeper, and B's physical used bytes remain unchanged.
- Only permanently deleting **A's last reference** frees the storage
  quota of A; B's quota and the globally shared blob remain intact. A
  subsequent identical upload uses a *new Node ID* and reacquires the
  existing CAS object, and removing it again does not affect B. Only
  removing B's final durable reference permits the physical object and
  `ContentBlob` record to disappear.
- The test must also validate real blob bytes, status and remaining reference
  count throughout. This is a correctness gate for **existing deletion
  behavior**, not a new duplicate clean-up or automatic merge API.

**Crucial distinction:** this fixture tests a later **ordinary re-upload**,
not a real remote-source `SourceItem` synchronization run. Source-cursor
reimport and Backup/Mirror replay after delete still need dedicated,
provider-scoped tests. The annotation-only P4 apply endpoint must continue
to report **zero physical bytes reclaimed** and must not touch any Node,
CAS ref, source link, Live/RAW resource or edit history. Do not enable
destructive consolidation from this test alone.

### G11 P4 phase 5 — provenance-aware duplicate preservation (2026-10-09)

**Merged as #1157 after complete GitHub CI.** Extend the already merged metadata-only
preservation plan and the shared Web/Desktop review with a bounded, verified
projection of existing **SourceItem → Source → PhotoResource(Node)** links.
For every one of the selected 2–32 complete-asset-verified copies, report
each linked 同步文件夹 name/kind, direction (Pull/Push), Backup/Mirror mode,
active/paused status, SourceItem ID/path/state, and the actual linked
**resource Node ID**. Crucially, a Live motion, RAW component or sidecar
can carry source provenance separately from the primary still; a query
restricted to the primary Node would miss that evidence. Limit the total
source links to 1,024 and fail closed rather than silently omitting sources.

Report how many selected PhotoAssets have currently linked source records,
and how many have existing Pull source records that **may re-import** after
deletion. A paused Pull source can resume; missing/ignored items are not
currently flagged as re-import candidates, but that does *not* authorize
deletion. An item with no current SourceItem link is **not proof** of
no remote copy: this is an owner-scoped, local database view, not an inventory
scan or suppression policy. Do not copy or rewrite SourceItem identity,
source collections, real files or CAS references. The source-link snapshot
is included in the existing SHA-256 plan-revision computation so a path/state
change after preview invalidates a stale confirmation.

Native PostgreSQL tests must include three same-SHA but independent
annotations/sync folders, owner isolation (including inconsistent cross-owner
links), 2-byte-equivalent Live assets with separate **motion-only**
source links, stale provenance plan rejection and source identities remaining
unchanged after annotation-only apply. A shared UI contract checks that the
per-resource source warnings are accessible on Web/Desktop and no deletion
API has been introduced.

**Still missing for destructive consolidation:** durable multi-edit/description
resolution, explicit consent for each candidate and complete resources,
owner/CAS-refcount/quota invariant tests, conflict-aware background Trash +
undo, actual Source re-import/suppression policy and regression testing after
a completed sync run. The current metadata-only union does not count as
source-safe permanent duplicate cleanup.

### G11 P4 phase 4 — explicit Web/Desktop annotation confirmation (2026-10-09)

**Merged in #1154 after full CI.** Continue the existing
verified Gallery fold-expansion UI and its G11 read-only preservation plan.
The user must first select the real keeper, explicitly request
`查看保全计划`, and then check **“只合并标注、保留全部原文件”**
before the `确认保全标注` action becomes accessible. Web/Desktop share
one UI and strict `MediaDuplicateOrganizeApplyInput` DTO. The request
sends the exact Server-issued SHA-256 `expected_plan_revision` with
`confirm: true`; it never derives equivalence from the client or reuses an
old token after a conflict. Missing Agent capability returns an explicit
unsupported response, never silently performs another action.

When `asset_comparison != identical`, `ready_for_manual_review`
is false, descriptions conflict, the group has more than 32 members,
or the token is missing/stale, **the write control is disabled**. The
Server remains the authority under a serializable transaction, rechecking
every resource and source Node revision before copying only user annotations
(favorite, tags, people labels, safe single description, manual albums,
persistent people) onto the designated keeper. The dialog reports the exact
applied counters with an explicit refresh control. A rejected/stale apply
clears the prior confirmation and requires the user to load a new plan.
No mutation request is dispatched on Gallery first paint, merely opening
the fold group or selecting a keeper.

The confirmed action is deliberately **non-destructive**. Every original
file, original resource role, independent PhotoEditRecipe, source-managed
album membership and cross-account CAS reference stays untouched.
`physical_bytes_reclaimed = 0` and no account quota savings are claimed.
Repeated sync can add original files again; it is not a background
auto-consolidation. **Still missing before *deleting* duplicate files:**
revision-safe undo/trash, a lossless way to preserve multiple different
descriptions/edit versions, explicit manual conflict decisions, source
re-import/idempotence gates and same-account/cross-account CAS+quota
integration tests. This phase must never be presented as whole P4 completion.

### G11 P4 phase 3 — confirmed, non-destructive annotation consolidation (2026-10-09)

**Implemented in merged #1151:** new authenticated `POST /api/v1/media/duplicate-organize/apply`
accepts a selected keeper, **2–32** unique primary Node IDs, a SHA-256
`expected_plan_revision` returned by the G11 read-only preservation plan,
and explicit `confirm: true`. The Server rechecks the complete resource/edit
equivalence, owner isolation, primary and every backing Node-resource's
SHA/size/revision/ready index state, collection and persistent-person
membership inside a serializable PostgreSQL transaction. Changed/stale
plan revisions or conflicting descriptions return 409, never a partial write.

Only user-owned annotations on the keeper are combined: **Favorite OR**, valid
case-insensitively deduplicated **tags and people labels**, at most one
non-empty **description**, membership in additional **manual albums** (each
album revision advances), and durable **person assignments**. If a union
would exceed existing tag/person limits or ownership/revision evidence
cannot be verified, all changes roll back. The transaction writes an
auditable, non-sensitive operation record with the selected real Node IDs.

The operation **never deletes or trashes a file**, does not detach
`PhotoResource`, remove/rewrite `PhotoEditRecipe`, decrement CAS Blob
reference counts, modify quota, change source-identity aliases, or move
provider/folder/source-managed albums. Every original's annotations remain
individually intact. Source re-sync can continue to update those original
source identities; a new duplicate is **not** automatically merged. Report
`physical_bytes_reclaimed=0` and never present this stage as storage cleanup
or completed deletion-based duplicate consolidation.

This is the reversible-by-source, audit-backed *annotation aggregation* stage.
**Still pending for complete user-approved consolidation:** UI confirmation
and result handling, description selection/history when texts differ,
explainable per-copy resource/history choices, optional trash and undo,
durable reconcile after a source is reimported, and same-owner/cross-owner
CAS+quota deletion regression. These are separate gated changes.

### G11 P4 phase 1 — read-only metadata preservation plan (2026-10-09)

**In progress / CI pending:** authenticated owner-scoped
`GET /api/v1/media/duplicate-organize/plan?keeper_id=...&node_id=...&node_id=...`
provides an explicit, bounded **2–32**-asset dry run before any consolidation.
The server verifies ready media revisions, owner of every active primary Node,
full PhotoAsset original-resource equivalence and current edit recipe evidence;
if any selected item is unavailable, stale or belongs to another account, no
cross-owner data is disclosed and the request fails closed.

The plan preserves the separate rows for **each** source copy: favorite,
descriptions, tags, people labels, manual/source/folder album memberships,
persistent person identities, current edit-recipe presence and original Node
identities. It also returns the possible union, counts, unverified/different
status and explicit description conflicts. Multiple distinct non-empty
descriptions remain visible **as alternatives**, never silently overwritten;
current edit/resource mismatches block safe review. The endpoint is strictly
read-only: `no_mutation=true`, `physical_reclaimable_bytes=0`,
`requires_manual_confirmation=true`. It does **not** merge metadata, delete,
trash, detach resources, migrate source identities, change CAS reference counts
or assume user quota will fall. It does not create a new cleanup recommendation
entry for zero-reclaimable duplicates.

**Remaining before any write path:** human review UI; transactionally safe
manual-album/durable-person union; explicit behavior for conflicting free-text
descriptions and edit history; possible rollback/audit and folder/source
collection provenance retention; index freshness and revision checks under
concurrent sync; durable deletion / undo; repeat-import idempotence; same-owner
and cross-account blob isolation. A source-managed duplicate may reappear on
the next synchronization, so deleting a source copy does not count as
permanent merge. Never treat this P4 phase 1 as completed metadata merging.

## Phase 10 — duplicate review, Burst Best Shot, and safe cleanup

Phase 10 is a local review workflow, not a destructive background cleaner. It adds no
second relationship database and no automatic permanent-delete path.

### Exact duplicates

- Duplicate groups are a rebuildable Server-side projection over active, ready logical
  Gallery assets whose primary original `File.sha256` values are exactly equal.
- No fuzzy filename/time similarity is used for exact duplicates.
- The recommended copy to keep preserves user intent first: Favorite, manual-album
  membership, description/tags/people metadata, then the earlier imported Node.
- xDrive CAS already stores identical SHA256 content once. Original-hash duplicate
  groups with zero reclaimable bytes are **not** shown in Cleanup, its badges or
  entry points. Their read-only backend endpoints remain available for later
  verified Gallery display folding, never for automatic deletion.
- **2026-10-09, G11 incremental safety contract:** an equal primary SHA-256 is
  only an original-file candidate, not proof that full PhotoAsset resources or
  active edit recipes match. The read-only cleanup card now labels each shown
  group `identical` (same asset kind, complete mandatory Live/RAW resource roles,
  matching resource digests/ordinals/bytes/offsets,
  same active recipe), `different` (a proven mismatch), or `unverified` (missing
  resource/digest/stale edit or oversized group). Comparison is bounded to 512
  assets per landing-page request; incomplete groups fail closed. These labels
  do **not** authorize automatic merging or deletion. A recommended keeper is
  emitted and highlighted only for fully verified `identical` assets; otherwise
  it is zero, and the review UI omits the recommendation (also for old Agents
  that do not return comparison status). Existing deletion still
  moves only explicitly selected Node IDs to Trash; it does not automatically
  collect other Live/RAW resources or merge favorite, album, tag, person and edit
  intent. Verified display-only folding is now an opt-in Gallery view over complete
  resource/recipe identities; it does not consolidate metadata or mutate files.
  Older clients missing the new field show an
  unverified, conservative message rather than asserting full equivalence.

### Burst Best Shot

- Burst review reuses existing connector-neutral `MediaGroupKindBurst` generated only
  from deterministic local Apple BurstUUID evidence. It does not split or rewrite the
  logical Burst `PhotoAsset`.
- Review details expose the original Burst member Nodes in their stored ordinal order.
- The initial Best Shot recommendation is deliberately explainable, not AI quality
  scoring: prefer the frame with the largest valid pixel area, then the frame closest
  to the center of the Burst, then stable ordinal/Node ID tie-breakers.
- The recommendation is read-only. A future blur/closed-eyes/expression scorer may
  replace the scoring policy without changing the group or Gallery transport contract.

### Cleanup/storage semantics

- The Cleanup Review root lives in `ui/shared` and is shared by Web/Desktop. Its landing page shows Burst review only; it does not query or render zero-benefit original-file duplicate groups.
- **G11, 2026-10-09 — Cleanup index visibility:** the shared cleanup surface
  reuses the existing opt-in owner-scoped `MediaGalleryIndexStatus` query from
  G05. It exposes ready, failed, unsupported and missing-metadata counts
  plus the server check timestamp even when there are no Burst suggestions.
  The status card is rendered without any automatic status request on first
  Gallery/Cleanup open; a user must explicitly select `查看索引状态` or
  `刷新索引状态`. Only **known active PhotoAssets** are counted. Never-present
  files, unsynchronized remote entries and any files not yet reconciled to
  a PhotoAsset are outside this denominator, so 100% known-asset readiness
  does **not** certify a duplicate-free complete library. Scope and errors
  are kept explicit on Web and Desktop. This adds no synchronous PostgreSQL
  work to the Gallery first-paint or Cleanup group-list routes.
- Opening a duplicate or Burst group creates a sparse read-only review collection;
  Viewer, Inspector, thumbnail scheduling and Selection Toolbar are reused.
- Recommended items receive a visible **建议保留** marker. xDrive never auto-selects or
  auto-deletes the other frames.
- User cleanup continues through the existing durable Gallery/FileOperation delete
  action, which moves items to trash first. No new cleanup mutation endpoint bypasses
  trash or CAS reference accounting.
- **2026-10-09 — group pagination (G11 phase 2a):** the cleanup overview
  fetches 48 stable-sorted group cards at a time. Both duplicate groups and
  Burst reviews accept a bounded optional `offset` (legacy omitted offset is
  zero) and return `offset`/`has_more` with unchanged full-library
  `total_groups` and logical/physical totals. Web/Desktop use the same
  explicit “加载更多” actions; old Agents which ignore an offset are rejected
  rather than silently repeating page one. Group IDs are deduplicated,
  and a changed total or overlap triggers a fresh first-page query to avoid
  stale offset windows following concurrent imports or deletions. Since
  FileOperation delete is durable/asynchronous, do not claim task completion
  on submission: show an explicit refresh action after Task Center finishes.
  This is read/navigation pagination, not a new deletion or auto-merge API.
- **Still pending in G11:** an authoritative indexing-coverage/status signal;
  until available, the empty state must explicitly say it only covers currently
  ready media index records, not declare the complete library duplicate-free.
- Burst `potential_cleanup_bytes` is the logical size of non-recommended frames.
  `physical_reclaimable_bytes` is conservative and counts a blob only when all of its
  current CAS references would be removed by the reviewed non-recommended members;
  the bytes are only actually reclaimable after permanent trash deletion/GC.

Transport remains thin and symmetric:

- Server: duplicate-group list/items and Burst-review list/items read endpoints;
- Go client / Desktop Agent IPC / Electron / Web only serialize IDs, limits and ranges;
- `ui/shared` owns Cleanup Review cards, state, recommended markers and review flow.


## Phase 11 — People review and Pets

Phase 11 matures the existing local People foundation instead of replacing it.

### Suggestion review

Automatic `PhotoPersonCluster` rows remain rebuildable derived suggestions. User review
intent is stored separately in owner-scoped `PhotoPersonSuggestionReview` rows keyed by
the current cluster snapshot key:

- no review row means **待确认**;
- `dismissed` means **暂不处理** for that exact cluster snapshot;
- `accepted` records that the snapshot was explicitly adopted into a new durable
  person or added to an existing durable person.

The default Suggested People API omits reviewed snapshots. Review mode can include them
so the shared Gallery can show dismissed suggestions and restore them. A cluster whose
membership changes receives a new cluster key and therefore becomes a new reviewable
suggestion; automatic clustering never rewrites durable person membership.

The shared People UI now distinguishes **已确认人物** from **待确认建议**. Pending
suggestions support **保存为人物 / 添加到已有人物 / 暂不处理**; dismissed suggestions
can be restored. Existing rename, hide/unhide, cover, merge, split, durable person
filters, and smart albums remain unchanged.

### Pets

Pets is a local **type collection**, not pet identity recognition. The existing pinned
MobileNetV2 visual-label pipeline now persists the ImageNet label index in
`PhotoVisualLabel`. Current pet facets use only ready visual-label evidence:

- ImageNet dog classes 151–268 → **狗**;
- ImageNet cat classes 281–285 → **猫**.

Opening a pet facet creates the same sparse shared Gallery collection used by other
destinations. Web/Desktop share `MediaPetFacet`, controller state, card UI, Viewer,
Selection Toolbar, Inspector, and range loading through `ui/shared`.

xDrive does **not** infer that two cat/dog photos show the same individual animal, does
not write pet names into `PhotoPerson` or `PeopleJSON`, and does not consume provider
pet/person APIs. Named individual-pet identities require a future pet-specific
crop/embedding/identity contract and are intentionally outside this phase.


## Phase 12 — basic non-destructive photo/video editing

The first editing phase is deliberately **recipe-first and non-destructive**. xDrive
never rewrites the original Node/File bytes and does not introduce FFmpeg,
ImageMagick, CGO, or another media-service dependency into the main Server.

### Durable edit intent

Plain image/video PhotoAssets may own one `PhotoEditRecipe`:

- the recipe is owner scoped, revisioned, and updated with optimistic concurrency;
- it is bound to the current primary Node id + Node revision + SHA-256;
- replacing the source bytes makes the old recipe stale, so it is not applied to a
  different file accidentally;
- a new save with revision 0 may rebuild a stale recipe against the new source,
  while revision 0 may never overwrite a current concurrent edit.

The initial image recipe supports:

- 90-degree rotation;
- horizontal / vertical flip;
- normalized crop;
- exposure (-2…+2 EV);
- contrast and saturation (-1…+1).

The initial video recipe supports:

- trim start/end;
- 90-degree rotation;
- horizontal / vertical flip.

Live Photo, RAW pair, Burst and other grouped assets are intentionally excluded from
the first editing contract rather than applying only part of a logical asset.

### Shared presentation

`MediaItem.edit_recipe` is returned only while the recipe source fingerprint still
matches current canonical media. Web/Desktop use the same `ui/shared`
`MediaGalleryEditDialog` and the same Preview Engine media-transform contract.

Edited images are redrawn in the shared Preview Engine canvas with crop,
rotate/flip and color adjustments. Edited videos keep the existing original Range
stream and apply trim-window plus rotate/flip presentation in the shared video
renderer. Viewer and Inspector therefore show the same saved recipe.

The Gallery grid keeps the existing thumbnail pipeline and marks current edited
assets with an **已编辑** badge. Thumbnail regeneration is not a second editing
implementation.

### Original/export boundary

The existing **Download** action remains an explicit original-file download in this
phase. The edit dialog states this directly. Saving a recipe does not create a hidden
copy, mutate CAS, or alter synchronization-folder content.

A future edited-export renderer may consume the same recipe. In particular, edited
video export/transcoding belongs behind an optional derivative renderer rather than
adding FFmpeg to the main xDrive Server.

Reset deletes only the saved recipe. The original file and all ordinary Gallery
metadata remain unchanged.


## Phase 13 — local Creative Tools

Phase 13 is intentionally optional and stays behind the local Photo Intelligence
sidecar. The main xDrive Server remains CGO-free and does not load segmentation or
inpainting models.

### Current: Cutout + Smart Erase

The durable creative-generation foundation is now surfaced as one shared Viewer
**创作** action for Web and Desktop:

- **AI 抠图 / Cutout** accepts normalized foreground/background point prompts;
- **智能消除 / Smart Erase** accepts normalized brush strokes and radius;
- both use the existing local 2048px creative working preview;
- generation is a durable, cancellable Task Center job;
- the dialog polls the persisted generation until completed/failed/cancelled;
- completed output is committed as a **new canonical file in the source folder**;
- the original file, edit recipe, favorite/tags/people/albums and source binding are
  never overwritten by a creative generation.

The shared `MediaGalleryCreativeDialog` owns prompt drawing, task progress, cancel,
result preview and retry. `MediaGalleryViewer` owns only the single Creative entry.
Web/Desktop platform adapters expose the same `create/get/cancel` generation
contract; neither platform runs image models or implements creative logic.

Creative Tools deliberately operate on the original image bytes rather than silently
baking a saved non-destructive edit recipe. The dialog states this when a recipe is
present. Exporting an edited recipe into Creative Tools can be added later as an
explicit operation rather than changing the current source-fingerprint contract.

Only ordinary ready image assets are enabled in the first UI. Live Photo, RAW pairs,
Burst logical assets and video remain excluded until each has an explicit whole-asset
creative contract.

### Current: Cutout refinement

Cutout keeps the same EfficientSAM model and durable `media.creative.cutout` task, but
the shared Web/Desktop dialog now exposes the refinement controls needed for practical
object selection:

- existing foreground/background prompt points can be dragged after placement instead
  of deleting and recreating a point to make a small correction;
- `cutout_expand` adjusts the mask by up to ±3% of the shorter image edge using a
  deterministic elliptical dilate/erode step; the shared UI intentionally exposes the
  tighter ±2% everyday range;
- `cutout_feather` applies deterministic alpha feathering up to 3% of the shorter
  image edge; the shared UI exposes 0–2%;
- zero-valued refinement preserves the previous Cutout output contract exactly;
- non-zero refinement requires the optional `cutout_refine` sidecar capability, so an
  older Cutout-capable sidecar never silently ignores the requested edge settings;
- refinement parameters remain part of the same persisted creative recipe and output
  is still committed as a new canonical PNG beside the source image.

No additional segmentation model, browser-side image processing or platform-specific
implementation is introduced.

### Current: Automatic Movie

The same durable creative-generation pipeline now also supports multi-image local
slideshow movies:

- select **2–30 ordinary ready image assets** in the shared Gallery Selection Toolbar;
- the shared Movie dialog preserves and can reorder the selected frame order;
- per-frame duration is 1–5 seconds and optional fade transition is 0–1 second;
- the shared dialog explicitly selects one of three local templates: **Classic Fit**,
  **Full Bleed**, or **Ken Burns**; old recipes without a template remain Classic Fit;
- the complete ordered source asset/node/revision/SHA list is persisted in the durable
  recipe and revalidated both before generation and inside the output commit transaction;
- any changed/deleted source fails the generation rather than mixing source revisions;
- the optional Photo Intelligence sidecar uses local FFmpeg to produce 1920×1080,
  H.264/yuv420p MP4 without automatic music;
- FFmpeg remains outside the CGO-free xDrive Server;
- the task is the same cancellable/retryable `media.creative.movie` Task Center job;
- completed output is committed through the same CAS/quota/canonical-node path as
  Cutout and Smart Erase and previews through the shared video Preview Engine.

Older creative sidecars that advertise only Cutout + Erase remain valid for those two
tools. Classic automatic movies require only the `movie` capability. Non-classic
templates additionally require `movie_templates`, and background music requires
`movie_music`; unsupported sidecars fail the generation instead of silently falling
back to a different result.

### Current: Collage templates

Multi-selection creative output also supports deterministic local photo collages:

- select **2–9 ordinary ready image assets** from the shared Gallery Selection Toolbar;
- choose one of four fixed layouts: balanced grid, featured-first, columns or rows;
- the selected order is durable; the first image is the emphasized image for the
  featured-first layout;
- the complete ordered source asset/node/revision/SHA list is persisted and revalidated
  exactly like Automatic Movie, including a second validation inside the output commit
  transaction;
- the local Photo Intelligence sidecar center-crops into a 2048×2048 canvas and encodes
  a high-quality JPEG; there is no browser-side renderer and no freeform canvas state;
- generation is the same cancellable/retryable `media.creative.collage` Task Center
  job and output uses the same CAS/quota/canonical-node commit path.

Older sidecars remain valid for Cutout, Erase and Movie. Collage capability is required
only when a collage generation runs.

### Current: explicit Automatic Movie music

Automatic Movie can optionally mix one canonical xDrive audio file into the generated
movie:

- the shared Movie dialog opens a shared FileExplorer-based picker that shows folders
  plus AAC/FLAC/M4A/MP3/OGG/WAV/WMA files; Web uses the existing node REST transport and
  Desktop uses the existing Agent cloud-file transport;
- the request contains only the selected xDrive `music_node_id`; local filesystem paths
  are never sent to Server or Photo Intelligence;
- the durable recipe stores the music node id, node revision and SHA-256 and revalidates
  them both before generation and inside the final output transaction;
- Photo Intelligence receives a short-lived same-origin signed `/file-preview` URL
  bound to that node revision and verifies the allowed path, audio MIME, size cap,
  `file-preview-<sha256>` ETag **and the SHA-256 of the received audio bytes** before
  accepting the track;
- FFmpeg loops the selected track to the movie duration, mixes it at a fixed background
  level and encodes AAC audio into the existing H.264 MP4 output;
- removing/changing the source audio after queueing fails safely instead of silently
  substituting a new revision.

The music picker and movie dialog remain shared Web/Desktop MUI. The main xDrive Server
continues to be CGO-free and never decodes or mixes the audio itself.

### Phase 13 baseline complete

The planned local Creative Tools baseline is complete with Cutout refinement, Smart
Erase, Collage, Automatic Movie templates and canonical xDrive music. Additional local
creative models remain optional future expansion rather than a prerequisite for the
Gallery product baseline. Any such expansion must continue to reuse the same durable
generation / Task Center / canonical output architecture instead of introducing a
second creative execution path.


### Direct-open Gallery and common property actions

Ordinary media tile single click opens Viewer immediately. Explicit selection mode and modifier-based selection still select, Space selects keyboard-focused media, and Enter opens Viewer. Duplicate click events from a double-click do not relaunch Viewer. One delegated MUI context menu at the shared Gallery root exposes Open/Properties, with only Properties available in Trash. Compact touch keeps an accessible Properties action.

Both Gallery and standalone Web media Viewer label the existing Info icon as **属性** and retain the canonical shared Inspector content. In Gallery, opening Properties does not destroy the Viewer. A modal right Drawer owns Desktop focus/Escape above the Viewer; mobile continues using the bottom Drawer. When Properties is opened from Viewer, the Inspector omits its redundant media preview so one media player/Live Photo loader remains mounted. Current properties follow Viewer next/previous navigation.

Completed by #1076: FileExplorer's image/video/Live Photo Properties now load the same MediaItem and reuse the shared Inspector fields. Ordinary file/folder Properties remain separate; the selected Node size is distinct from grouped Live Photo resource sizes. FileExplorer-specific Node ID, source and custom property fields remain visible within the shared Inspector.

The Trash section cannot open a normal media Viewer, so a tile activation there falls back to Properties; it must not silently do nothing.


### One media Properties surface across Gallery and FileExplorer

Gallery, its Viewer, the standalone Web media Viewer and FileExplorer use the shared `XDriveMediaDetailsInspector` / `XDriveMediaDetailsContent` for single media items. FileExplorer obtains the canonical `MediaItem` lazily by Node ID (Web REST or Desktop Agent IPC) and adds only local file-context rows; unrelated file/folder properties remain unchanged. Loading is cancellable and version/session-fenced. A media lookup failure retains ordinary file information and clearly exposes the lookup error. No 10k/100k Gallery or FileExplorer list path is allowed to fetch full per-item properties for every row.


## Gallery Live Photo Properties parity (2026-10-09)

**Merged as `747f7d39`:** A standalone `.livp` asset in direct Gallery Properties delegates still+motion to the same native `XDriveFilePreviewSurface` used by Viewer, admits the `live_photo` signed still resource, and avoids nesting another Live Photo player. For a semantic still+MOV pair, the existing outer `XDriveLivePhotoSurface` remains but only admits first-hold after the still's presentation readiness callback. Viewer-opened Properties still suppresses the redundant preview. No media transport changes or measured performance claim.


## Media poster consistency follow-up (2026-10-09)

**In progress / dependent PR validation pending:** Ordinary Gallery video tiles switch from unconditional original-video frame capture to persisted-first Server poster lookup, with bounded fallback capture and revision-checked poster backfill through shared Web/Desktop adapters. Existing filmstrip thumbnail selection accepts a persisted video poster even when the thumbnail metadata flag is absent. The existing Server poster file class is reused; this does not introduce a new video encoding service or enable automatic Live Photo motion requests. The Home, FileExplorer, secondary Gallery cover and Viewer surface contracts must remain consistent; any remaining cold-fallback or cancellation differences require explicit validation. Existing PR #1088 owns the separate measured poster-queue transport-cancellation follow-up; this poster-reuse PR intentionally leaves the old queue scheduler unchanged. The canonical evidence and outstanding end-to-end measurements are in `docs/gallery-performance.md`.


## Full original Live Photo export (2026-10-09)

**Candidate / CI pending:** add an explicit **导出完整实况** action, without changing the ordinary "下载" or editor recipe/export semantics, to the shared Gallery Viewer/context menu and standalone Web media Viewer. A validated `.livp` downloads its one canonical original container, containing both embedded still and motion byte ranges. A separately stored still+MOV asset uses the exact locally projected `PhotoResource` node-role pair (one original `still`, one original `motion`) and existing authenticated archive download, never filename/time proximity. Missing, ambiguous, derived-only, or stale-looking relations fail closed instead of silently exporting only the still. Server archive/download continues to enforce owner, node validity, and canonical content. Web/Desktop use one pure shared resource selector and thin platform adapters.

Validation includes behavioral pure-function tests with valid `.livp`, valid exact pairs, missing, duplicate, wrong-kind, and derived resource cases; source contracts guard distinct UI affordances on both clients and normal original download behavior. The export itself is not transcoding, not edited-output export, and does not mutate existing logical album membership. Physical Web/Desktop download/ZIP inspection and updates during export require separate acceptance; do not claim media-revision atomic snapshot beyond existing Server archive semantics.

## M15–M16：人物与地点流程补充（2026-10-09）

现有人物身份和猫／狗类型集合保留。人物确认、命名、合并、拆分使用窄屏44px和短横屏可滚动弹窗；只有新建或归入已有的人物成功且原建议卡退出时，焦点交接到持续挂载的当前标题。相同40项17/23→40/0、同70项68/2→70/0；拒绝、同参数重试和完整ID／revision均保留。

地点复用共享拖动工具，延后捕获以保留单击／点按；真实主题色保证聚合数量可读，缩放／重置／返回窄屏44px。现有图库状态只保存三数地图视角；地点加载、失败和成功空GPS不混用。Web／Desktop取数上限与现有1000契约一致，概览仍为24。同38项27/11→38/0，整合返回按钮同32项30/2→32/0；最终人物70／地点40／实际构建App相册40全部通过，完整Desktop1622/0/1既有skip，typecheck/lint/build0。完整新PR CI/线性合并仍为交付门禁，M17继续按序实现。

基线为已交付M12–M14合并0e90a0fd；保留后续已存在的范围取消、NodeLocation和只读副本整理计划。全部证据见[人物与地点验证](validation/mobile-gallery-people-places-2026-10-09.json)。M49.V13–V14仍将物理设备、安装模式、OS键盘／安全区和VoiceOver／TalkBack记为not-run。

## M12–M14：相册、日期与属性补充（2026-10-09）

M10/M11已由PR1125完整CI37914259268合并3ad7e73a并清理。以此为固定父版本，补齐相册选择器短屏滚动与成功焦点、实际年月选择框44px，以及描述/标签/人物的保存反馈和未记录的视频旋转。复用现有选择ID/版本、日期索引、编辑目标守卫与共享属性，不改Server或算法。相册同14项12/2→14/0、实际同40项39/1→40/0；日期同45项41/4→45/0；属性同21项11/10→21/0、旋转5项3/2→5/0。整合c55d5ad1上的实际App40/37、属性28均通过，完整Desktop1613/0/1既有skip，typecheck/lint/build通过。已由PR #1143完整CI37917029455合并0e90a0fd并清理；真机、键盘、读屏仍not-run。详见[整合证据](validation/mobile-gallery-selection-timeline-properties-2026-10-09.json)。

## M11 compact panels — renderer acceptance (2026-10-09)

Reused merged PR #1122's shared VisualViewport observer and in-app filter Drawer. A measured 844×200/200% text case exposed only23px of a63px first field beneath sticky actions; removing only compact sticky positioning makes the field and existing actions reachable through one scroller while fixed44px Close remains. Gallery navigation is at least44px below900CSSpx independent of pointer type. Existing draft/applied query, on-demand index status, album selection, IANA boundaries and adapters remain intact.

The same57-check first-red is52pass/5fail; final57 and actual built-Web panels37 all pass after preserving merged M12bd96. FullDesktop1594pass/0fail/1existing skip, typecheck/lint/build pass. Exact scope and hashes are in [M11 evidence](validation/mobile-panels-short-viewport-2026-10-09.json). Updated PR1125 CI/merge are pending; physical keyboards, installed modes and screen readers are not-run. This does not certify later Gallery follow-up items.

### Verified Gallery duplicate folding — opt-in (2026-10-09)

- When enabled in the shared Gallery toolbar, the Server constructs owner-scoped verified equivalence groups using the exact complete PhotoResource identities and current PhotoEditRecipe checks that power Cleanup's conservative classifications. Different/unverified Live Photo motion, RAW, Sidecar, burst resources, edits or stale recipe sources **never fold**; groups too large to verify safely remain separate.
- Filtering, album membership and search choose their visible representative **after** Server filters, preserving the correct sort, sparse virtual item range, authoritative count, timeline, anchor and Viewer target. Semantic search ranks eligible matches before collapsing identical results. Ordinary FileExplorer and Gallery without the opt-in retain their original Node/page counts, including at 100k scale.
- Clicking a verified fold badge expands an on-demand, bounded exact-Node dialog. Each copy keeps its filename, Node ID, ownership, original file path, favorite, album membership, tag, person, edit recipe and CAS references. The secondary Viewer target carries an explicit member list; no copy is removed and no user metadata is merged.
- Album cards describe **underlying asset counts**, whereas a folded collection count describes **visible cards**; these numbers are not interchangeable. Web and Desktop accept manual/smart/source/folder album IDs for both item-range and Viewer queries; the representative always belongs to the active album scope. Group badges may include copies outside the currently filtered album/search scope; expansion clearly lists all verified files. Fold view is opt-in to avoid imposing duplicate-equivalence scans on 100k gallery defaults.

### G06 phase 2b — Desktop Agent/IPC transport candidate (2026-10-09)

**In progress / CI pending:** Desktop reuses the shared Location section in
Gallery and FileExplorer media Properties, gated by Agent `node-location`.
A per-request AbortSignal is passed Renderer → Electron Main → Agent IPC HTTP →
Go client → Server, without thumbnail, preview, original read or indexer work.
"显示所在位置" navigates by the authoritative parent Node ID and breadcrumbs;
recorded SourceItem paths remain distinct from current xDrive ancestry.
Older Agents explicitly report the missing capability. This work is stacked
on G06 Web phase 2a and requires its own complete PR CI before merge.

### G06 phase 2c — explicit current folder vs descendants (candidate, 2026-10-09)

- **Direct-only is the compatibility default.** Gallery synchronization-folder browsing presents a "包含子目录" toggle with a visible "仅当前目录"/"包含子目录" scope label; the selected Server query is propagated across search, sort, timezone, facets, counts, virtual pages and Viewer target.
- Recursive filtering uses an **owner-scoped PostgreSQL recursive CTE** constrained to live directory Nodes, with cycle prevention and a depth limit. It does not hydrate all folder media IDs in Web, Desktop or Go.
- `folder_id` and `include_descendants=true` travel together from shared MUI `MediaGalleryQuery` through Web HTTP or Desktop Agent/Main/Go client to the same query builder. Recursive requests without a folder ID are rejected. Older Desktop Agents without `media-folder-recursive` fail visibly rather than silently reducing scope.
- Exact PostgreSQL fixture expectations: current folder `child.jpg`; recursive child `child.jpg` and `grand.mov`; recursive source `root.jpg`, `child.jpg`, `grand.mov`; another owner cannot enumerate the source. Facet values and regular counts must match the visible range. Go Client serialization and React/UI source contracts are separately tested.
- This is an **unmerged candidate** stacked after G06 Phase 2b. Physical iOS/Android/Desktop interaction, the full CI run, PostgreSQL 10k/100k recursive-folder benchmark, and scope-preserving Viewer return behavior require separate acceptance evidence. G06 is not yet signed off.

### G07 phase 1 — explicit selection review, Web/Desktop candidate (2026-10-09)

**In progress / CI pending.** Shared Gallery Selection Toolbar exposes
**查看已选项** to inspect the *explicitly selected* media without starting
a second Viewer or loading additional original/thumbnail bytes.
The selected-items drawer/dialog uses a bounded 100-row page, name filter,
precise live count, per-item **移除**, and explicit **清空选择**. It reuses the
existing selection Map, so removing from the selection is not a deletion or
file metadata operation. While a batch action is busy, removal, clear and
closing are disabled. Scope changes invalidate the selection and close review.

The bounded UI does **not** implement selecting all unloaded query results
or a whole 100k day. Those require a Server-owned snapshot/selection token,
owner and ACL rechecks, exclusions, bounded job processing, progress and
partial-failure/undo semantics before the relevant buttons may be enabled.
Do not materialize 100k MediaItem objects in Web/Desktop or pretend 100
review rows represent every search hit. On-device and 100k verification
are independent acceptance gates.

### G07 phase 2a — owner-scoped 100k query selection snapshot (candidate, 2026-10-09)

**Backend-only / full CI pending.** A deliberate `POST /api/v1/media/selection-snapshots`
freezes up to **100,000** owner-visible **known indexed PhotoAsset primary Node
IDs and revisions** in one bounded SQL read, not 100k hydrated MediaItem
objects or thumbnails. A query with more than 100k matching rows is rejected
rather than silently selecting only its first page. Ordinary gallery first-paint
paths do not build snapshots. The optional `day=YYYY-MM-DD` uses the selected
capture/added time axis and a validated IANA time zone; day boundaries respect
23/25-hour DST transitions. It reuses server-side folder scope, filters,
collection authorization, and excludes ambiguous duplicate-fold mode.

Snapshots are **ephemeral**, owner-bound, versioned, at most one active per
owner, and expire after 15 minutes; server restart/reconnect requires explicit
reselection. The API pages at most 200 minimal Node identities, marks stale
versions/deleted Nodes, and supports optimistic-version exclusion/unexclude
without editing the underlying file. Clients must not claim durable selection
or execute destructive/batch operations from this token yet. The next phases
must wire Web/Desktop clients to this backend, then add bounded durable Task
Center batch operations with per-file authorization/revision rechecks, progress,
cancel, retry, partial failure details, and 10k/100k DB/physical-device tests.

This phase does **not** complete G07. PostgreSQL tenant-isolation/day filtering,
DST, optimistic concurrency, exclusions, and 100k bounded-page contracts are
covered by tests, but full CI and actual runtime metrics are still pending.

### G07 phase 2b — Web query-wide and day selection (stacked candidate, 2026-10-09)

**Candidate / requires Phase 2a merge, CI and real-device review.** Web now
uses the optional shared Gallery snapshot port to explicitly freeze the current
owner-authorized server query (including sort, timezone, folder and album scope)
or one IANA calendar day, without loading unloaded MediaItem objects. An
accessible, paged 100-row inspector shows the exact selected/excluded count,
stale revision hints, and explicit exclude/restore. Scope changes and closing
release the ephemeral token. An over-100k result surfaces the Server's 413
rather than selecting a truncated subset. Duplicate-fold mode is not eligible.

**Boundary:** the snapshot is intentionally read-only: existing Gallery
favorites/album/tag/download/delete handlers still receive only explicitly
loaded items. Do not pass a snapshot token to them. Desktop cannot show this
control until the authorized Agent/IPC transport is implemented. Phase 3
remains durable, bounded Task Center operations with per-item fresh ACL and
revision validation, progress, cancellation, retries and partial-failure audit.
Live Web/desktop and physical device evidence is still pending.

### G07 phase 2c — Desktop Agent/IPC query selection transport (candidate, 2026-10-09)

**Stacked on Phase 2b; full CI not yet verified.** Desktop Gallery now uses
exactly the same shared read-only selection/review UI via authenticated
Go Client, Desktop Agent's versioned loopback IPC, Electron Main/Preload,
and the shared adapter. Agent advertises `media-selection-snapshot`;
older Agents are rejected explicitly. Requests validate album, calendar day,
token, page size, Node ID, exclusion Boolean, optimistic version, and
query scope. No direct Desktop renderer authentication or duplicate player
was introduced. This does not enable durable query-wide batch edits.
Go/Windows, Desktop, 10k/100k and real-device tests remain acceptance gates.

### G07 Phase 3a — durable query-selection favorites (candidate, 2026-10-09)

The first **real** query-wide write is deliberately restricted to reversible
favorite/unfavorite. A confirmed, version-matched owner snapshot is atomically
promoted to normalized PostgreSQL job/item tables in batches of 100 (not a
100k-element JSON blob); the 15-minute token is consumed only after commit.
The server worker locks and rechecks owner, live Node revision, PhotoAsset and
PhotoMetadata before mutating each bounded batch transaction. Outcomes and
counters commit in the same transaction and survive process restart. An owner
can list jobs, page failures, request cancellation, or retry only failed/
cancelled immutable revisions. Revision mismatches never auto-rebase. A
partial result remains **partial**, not complete. These server endpoints do
not enable all-query delete/download/album/tag until matching Task Center
UI, cancellation and 10k/100k verification land. No physical device claim.

### G07 Phase 3b — Web favorite job submission and inspection (candidate)

The shared Gallery snapshot inspector now supports an explicit separate
confirmation before submitting `favorite` / `unfavorite`, using its exact
frozen token and optimistic version. It never calls legacy client
`MediaItem[]` batch mutations for query-wide selection. The consumed token
is not released twice. Inline progress polls only the one job ID; users can
cancel, retry frozen failed/unprocessed items, and page failure codes without
loading 100k MediaItems. Closing the view does not cancel a durable job.
A persistent Task Center listing and Desktop Agent job protocol are further
delivery stages; this branch alone does not claim those capabilities.

### G07 async request ownership / duplicate-submit race (2026-10-10; PR #1218)

Shared Web/Desktop query-wide selection must synchronously own exactly one
in-flight UI request across snapshot Create, page reads, exclusion/revision
updates, durable Favorite submission, job cancellation/retry and bounded
failure-page reads. React Busy state is presentation, not the same-tick
single-flight barrier. Closing a review while an operation is pending must
not release a token being consumed by a durable Server job; once the operation
finishes, ordinary closing still releases an unconsumed snapshot. No existing
durable Server job is cancelled when the component unmounts, and query-wide
selection must not hydrate a 100k client-side MediaItem array.

Deterministic first-red is recorded in GitHub Actions run 37982739358,
`desktop-tests` assertions 539–543: actual shared React component and
original MUI handlers yielded **five product failures** (2 instead of 1
snapshot Create, durable Favorite submission, Exclude and page requests, plus
premature release from a stale close callback). The exact source-backed
tests in `desktop/tests/media-gallery-query-selection-async-race.cjs`
are retained for post-fix validation alongside the existing G07 query,
transport, owner-scope, Task Center and ordinary Gallery regressions.
Require exact-head CI, Go race and the final gate before merging; physical
Web/Desktop/device acceptance remains separate.

### G07 durable-job poll overtaking race (2026-10-10; PR #1221)

The one active durable media-selection job may be polled by two overlapping
1.7-second requests. Only the **most recently issued** poll response, for
the still-mounted same job/status scope, may apply status/counters or report
errors; an older in-flight request cannot rewind current running progress,
nor report an obsolete failure after a newer successful read. This stays
separate from G07's snapshot/job submission single-flight lane, does not
increase polling frequency, cancel a durable server job, fetch all 100k media
items, or alter Server/Agent request semantics. Poll effects continue to
clean up on job/status change, close and unmount.

Actual first-red: GitHub Actions run 37984715216, Desktop assertions
487–488: newer 30/230 was visibly overwritten by old 5/230; after newer
48/230 was displayed, an older rejected poll published a stale error.
The unchanged single-poll control (test 489) passed. These **same
source-backed React component/controlled timer-Promise regressions**
remain in `desktop/tests/media-gallery-durable-job-poll-order-race.cjs`
for exact-head post-fix acceptance alongside all original G07 tests,
Web/Desktop builds, Go race and final PR CI gate. Do not claim native
physical-device acceptance from these controlled tests.

### G07 Task Center request ownership and owner-scope isolation (2026-10-10, PR #1230)

The shared `MediaSelectionJobCenter` task list is scoped to the current
authenticated Web/Desktop job Port. Changing that Port hides the previous
account's jobs, failure details and errors immediately, without waiting for
the new asynchronous list response. A request started in an older Port
scope must never restore those records after the new Port becomes current.

Cancel, retry, and failure-page actions claim one synchronous in-flight
owner; React Busy presentation alone must not permit duplicate same-render
mutations, particularly retries of immutable failed revisions. Starting an
action invalidates earlier Task Center poll snapshots; polling pauses while
an action owns the list. After an action resolves, the current Port's
authoritative list is rendered without a superseded poll overwriting it.
The existing 2500ms poll cadence, server-owned durable task lifecycle,
cancel semantics, bounded 100-row failure pages, and 100k first-paint
constraints are unchanged.

First-red evidence: GitHub Actions `desktop-tests` run 38013745891,
tests 661–664 (four actual failures): duplicate Cancel, duplicate Retry,
old in-flight poll restoring `running` after successful Cancel, and
old account A Cancel completion overwriting new account B's jobs.
The unchanged single-Cancel control passed (test 665). The same executable
real React component tests in
`desktop/tests/media-selection-job-center-request-race.cjs` are preserved
and extended with first-frame account isolation, same-tick failure paging,
and stale failure error checks. Require the same test cases to turn green,
the existing G07 Task Center/QuerySelection tests, exact-head Web/Desktop
builds, Go race and the full GitHub final CI gate before merging.
Native browser/device validation is separate from these controlled tests.

### G07 Phase 3c — Web Task Center persistence visibility (candidate)

Web Task Center now loads the authenticated durable media-selection job
history only when that page is mounted. It displays the server's true
processed/total/succeeded/failed/cancelled counters and bounded failure pages,
supports explicit cancel and immutable-revision retry, and does not poll or
hydrate 100k MediaItems on Gallery first paint. The shared component uses an
optional Port; Desktop needs the Agent job-protocol extension before showing
the same section. Physical device and end-to-end timing remain outstanding.

### G07 Phase 3d — Desktop durable favorite job transport and Task Center (candidate, 2026-10-09)

Extends merged Phase 3a and Web Phase 3b/3c with the **same shared
query-wide favorite task UX** on Desktop, through Go Client, Agent loopback
HTTP IPC, Electron Main/Preload, and shared Gallery/Task Center adapters.
A dedicated Agent capability guards the six authenticated durable-job endpoints.
Old Agents do not expose these operations. Job list/failure paging are fetched
only while the Tasks page is visible; Gallery does not hydrate 100k MediaItem
objects. Both platforms show authoritative counts, partial failures, cancel
and immutable-revision retry. New Go HTTP/IPC and Desktop transport contracts
exercise confirmation/version validation, malformed identifiers, paging and
legacy capability fallback. This is **not G07 final acceptance**: all-query
deletion/download/album/tag operations, PostgreSQL 10k/100k runtime metrics,
physical iOS/Android acceptance, and full CI remain separate gates.
