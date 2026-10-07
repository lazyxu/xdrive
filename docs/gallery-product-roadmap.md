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
| 7 | Map Places | Planned |
| 8 | Smart Search: object/scene + OCR, then semantic search | Planned |
| 9 | Memories / Recent Days / Trips / On This Day | Planned |
| 10 | Duplicates + Burst Best Shot + storage cleanup | Planned |
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
- **回忆** is present in the navigation model but disabled until Phase 9 has real local
  Memories data. No placeholder data or fake generated memories are allowed.

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
