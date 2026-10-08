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
  future edit recipes) is durable intent; automatic analysis remains rebuildable.
- Features that are not implemented must not be presented as working controls.

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
| 11 | Pets / people groups / suggestion review | Planned |
| 12 | Basic non-destructive photo/video editing | Planned |
| 13 | Optional AI erase / cutout / automatic movies / advanced creation | Planned |

## Phase 1 — shared Gallery information architecture

Phase 1 changes Gallery from one vertically stacked management page into a photo-first
workspace with explicit internal destinations:

- **图库** owns the main photo collection.
- **人物** owns durable people and automatic suggestions.
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

## Next phase

Phase 2 must build Year / Month / Day semantic navigation on the existing range-based
VirtualCollection contract. It must keep stable scrollbar geometry and bounded
metadata/thumbnail retention, and must not implement semantic zoom by materializing
the entire Gallery.


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

Viewer **Info** continues to exit the immersive Viewer and opens this Inspector/Drawer.
There is no Web/Desktop details fork: both clients consume the same shared content and
responsive container, while Preview transport remains platform-specific through the
existing adapters.

Gallery Trash keeps its Phase-4 capability boundary in the new Inspector. Deleted media
may show thumbnails and indexed metadata, but Favorite/tag/people/description/album
mutations and original Preview remain unavailable.

Phase 7 should build Places on the existing local GPS/GeoNames projection and keep map
presentation in the shared Gallery layer.


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
