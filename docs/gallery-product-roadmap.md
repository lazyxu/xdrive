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
adapter remains a separate follow-up; do not mark it complete from the Gallery change.
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

Gallery Trash keeps its Phase-4 capability boundary in the new Inspector. Deleted media
may show thumbnails and indexed metadata, but Favorite/tag/people/description/album
mutations and original Preview remain unavailable.

Places is already implemented on the local GPS/GeoNames projection as described in
Phase 7 below. Further map usability and scale work is a follow-up, not a new Places
implementation.


## Phase 7 — privacy-safe Map Places

Places now has one shared Web/Desktop map surface over the existing local GPS/GeoNames
facet projection. Entering **地点** expands only the compact place-facet query from the
normal 24-card preview to at most 1000 facets; it does not fetch or materialize photo
rows. The card list remains capped to the first 24 entries for a compact, accessible
list alongside the spatial view.

Map interaction and clustering live entirely in `ui/shared`:

- longitude wrapping and fit-to-data handle collections around the ±180° dateline;
- zoom-level grid clustering operates on compact `MediaPlaceFacet` values;
- pointer drag, wheel/button zoom, reset-to-fit, keyboard cluster activation, and
  direct opening of a single Place reuse the existing Place filter contract;
- clicking a multi-place cluster zooms the map instead of issuing a media query.

The initial basemap is an embedded simplified geographic layer with graticules. It does
not request Google Maps, Mapbox, OpenStreetMap, or another online tile service, so
opening a user's GPS photo library does not disclose the viewed photo locations to an
external map provider. A future self-hosted/local tile provider may be added behind a
shared provider adapter without changing Gallery Place identity or platform adapters.

Server and Desktop Agent accept up to 1000 compact Place facets for this surface while
keeping the ordinary default at 24. Web/Desktop transport code remains otherwise
unchanged.


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


## Phase 10 — duplicate review, Burst Best Shot, and safe cleanup

Phase 10 is a local review workflow, not a destructive background cleaner. It adds no
second relationship database and no automatic permanent-delete path.

### Exact duplicates

- Duplicate groups are a rebuildable Server-side projection over active, ready logical
  Gallery assets whose primary original `File.sha256` values are exactly equal.
- No fuzzy filename/time similarity is used for exact duplicates.
- The recommended copy to keep preserves user intent first: Favorite, manual-album
  membership, description/tags/people metadata, then the earlier imported Node.
- xDrive CAS already stores identical SHA256 content once. Therefore exact duplicate
  cards report **logical duplicate bytes** separately from **physical reclaimable
  bytes**; while one copy is kept, physical reclaimable bytes are intentionally 0.

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

- The Cleanup Review root lives in `ui/shared` and is shared by Web/Desktop.
- Opening a duplicate or Burst group creates a sparse read-only review collection;
  Viewer, Inspector, thumbnail scheduling and Selection Toolbar are reused.
- Recommended items receive a visible **建议保留** marker. xDrive never auto-selects or
  auto-deletes the other frames.
- User cleanup continues through the existing durable Gallery/FileOperation delete
  action, which moves items to trash first. No new cleanup mutation endpoint bypasses
  trash or CAS reference accounting.
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
