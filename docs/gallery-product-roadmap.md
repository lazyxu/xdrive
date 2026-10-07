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
| 3 | Multi-select + shared Selection Toolbar | Planned |
| 4 | Gallery Trash + Favorites + media-type smart collections | Planned |
| 5 | Viewer 2.0: fullscreen, zoom/pan, filmstrip, chrome hide, actions | Planned |
| 6 | Desktop Inspector / responsive Drawer replacing the large details dialog | Planned |
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
