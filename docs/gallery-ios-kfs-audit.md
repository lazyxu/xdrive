# Gallery experience audit: iOS Photos and KFS

## Scope and evidence baseline

**Audit date: 2026-10-09 (Asia/Shanghai).** This document records a code/documentation
comparison and a proposed follow-up backlog. It does not claim that new product
behavior, performance improvements, or native-device acceptance were delivered by
this documentation change.

| Reference | Fixed evidence |
| --- | --- |
| xDrive | [master @ a7eb62a023180c0bc51aa7d6ff0ad402ab36bcb3](https://github.com/lazyxu/xdrive/commit/a7eb62a023180c0bc51aa7d6ff0ad402ab36bcb3), committed 2026-10-09 02:19:06 UTC |
| Related delivered update | [PR #1071](https://github.com/lazyxu/xdrive/pull/1071), merged 2026-10-09 02:40:28 UTC as [27fe038ec87c2b2b8ca200f86977e6e8938925da](https://github.com/lazyxu/xdrive/commit/27fe038ec87c2b2b8ca200f86977e6e8938925da); its relevant patch and merged state were checked before documentation delivery |
| KFS | [develop @ 306cc635b2da5163b0495c28bc0d478453e94d55](https://github.com/lazyxu/kfs/commit/306cc635b2da5163b0495c28bc0d478453e94d55); develop is its default branch |
| iOS Photos | Apple official iPhone user-guide pages retrieved on the audit date; feature availability can vary by device, language, region and OS version |

xDrive's [product roadmap](gallery-product-roadmap.md), [Preview Engine](preview-engine.md),
[Mobile Web](mobile-web.md), [Gallery performance](gallery-performance.md), and
[Photo Source v2 roadmap](photo-source-v2-roadmap.md) retain ownership of their contracts.
This audit connects their current boundaries to external references; it does not create
a competing renderer, media database, task scheduler, or performance record.

### Status and maintenance rules

- **Verified baseline** means the capability was found in the fixed main-branch code
  and its relevant adapter wiring; it is not a claim of full runtime/device acceptance.
- **In progress** means an existing related PR contains unmerged work at the latest
  recorded check. Related merges after the fixed baseline are identified separately
  with their actual delivery evidence.
- **Proposed** means a recommendation for a concrete extension, not approval to
  implement every item in this document.
- **Validation pending** means the implementation or contract exists but the named
  environment/use case still needs evidence.

Before beginning an item, recheck current master and related PRs. Preserve this dated
baseline; add a dated delivery entry or update a follow-up row with the actual PR,
commit, acceptance evidence and remaining limits. Superseded/closed PRs do not imply a
missing capability if another PR delivered it. A name in a navigation menu, disabled
button, API field, README goal, or stale roadmap heading is not proof of a usable feature.

## Verified xDrive foundations: do not reimplement as new features

The evidence is the shared [Gallery controller/surface](../ui/shared/src/mui/MediaGallery.tsx),
[filters](../ui/shared/src/mui/MediaGalleryFilters.tsx),
[Viewer](../ui/shared/src/mui/MediaGalleryViewer.tsx),
[Inspector](../ui/shared/src/mui/MediaGalleryInspector.tsx), and
[Web](../web/src/mediaGalleryAdapter.ts) /
[Desktop](../desktop/src/renderer/mediaGalleryAdapter.ts) adapter wiring at the baseline.
The phase descriptions in the product roadmap state the detailed contracts.

| Foundation already present | Current extent and boundary | Delivery evidence |
| --- | --- | --- |
| Gallery information architecture | Library, Memories, People/Pets, Places, Albums, Favorites, Media Types, Cleanup and Trash; advanced filters in a Popover | [#817](https://github.com/lazyxu/xdrive/pull/817), [#1027](https://github.com/lazyxu/xdrive/pull/1027) |
| Time browsing and photo wall | Year/Month/Day/All, per-scale density memory, logical index anchoring when density/scale changes, sticky date headers, year/month jump; square zero-radius tiles and 4 px gutters | [#821](https://github.com/lazyxu/xdrive/pull/821), [#1031](https://github.com/lazyxu/xdrive/pull/1031), [#1066](https://github.com/lazyxu/xdrive/pull/1066) |
| Camera/format facets | Server-side multi-select with counts, OR within a group and AND across groups; lazy self-excluding facet queries; smart-album persistence | [#1036](https://github.com/lazyxu/xdrive/pull/1036), [#1044](https://github.com/lazyxu/xdrive/pull/1044) |
| Synchronization-folder browsing | Album-root cards, local child directories and root-bounded breadcrumbs; folder filters compose with other filters; current directory only | [#1052](https://github.com/lazyxu/xdrive/pull/1052), [#1059](https://github.com/lazyxu/xdrive/pull/1059) |
| Batch organization | Selection mode, Ctrl/Cmd and bounded Shift selection, batch favorites/tags/albums/download/delete; Shift sees retained sparse metadata, not every unloaded item | [#826](https://github.com/lazyxu/xdrive/pull/826) |
| Viewer and mobile media interaction | Fullscreen, immersive chrome, bounded filmstrip, lazy Live Photo motion, common media content, zoom/pan/swipe and readiness; touch tap already opens Viewer | [#846](https://github.com/lazyxu/xdrive/pull/846), [#1013](https://github.com/lazyxu/xdrive/pull/1013), [#1043](https://github.com/lazyxu/xdrive/pull/1043), [#1065](https://github.com/lazyxu/xdrive/pull/1065) |
| Shared media Inspector | Desktop side panel / narrow bottom Drawer; Photo information -> Organization -> Files and resources; canonical capture-time display | [#851](https://github.com/lazyxu/xdrive/pull/851), [#1069](https://github.com/lazyxu/xdrive/pull/1069) |
| Local search | Filename/camera/description/tags/people/place/visual-label/OCR lexical search plus optional multilingual semantic retrieval and lexical fallback | [#869](https://github.com/lazyxu/xdrive/pull/869), [#881](https://github.com/lazyxu/xdrive/pull/881) |
| Places and Memories | Local simplified map and clustering; Recent Days, On This Day and Trips projections; date grouping currently follows UTC | [#856](https://github.com/lazyxu/xdrive/pull/856), [#887](https://github.com/lazyxu/xdrive/pull/887) |
| People, Pets and media types | Durable people and suggestion review; cats/dogs as type collections; video/Live/RAW/Burst/GIF and evidence-backed panorama | [#913](https://github.com/lazyxu/xdrive/pull/913), [#840](https://github.com/lazyxu/xdrive/pull/840) |
| Cleanup and Trash | SHA-256 exact duplicates, explainable Burst recommendation, shared restore/delete flow, logical versus physical space accounting | [#899](https://github.com/lazyxu/xdrive/pull/899), [#840](https://github.com/lazyxu/xdrive/pull/840) |
| Non-destructive editing | Durable image/video recipes, original bytes preserved, Viewer/Inspector apply edits; download remains original; Live/RAW/Burst excluded from basic edit recipe | [#927](https://github.com/lazyxu/xdrive/pull/927) |
| Creative tools | Local cutout, refinement, erase, collage, movie templates and explicit music, using durable generation/tasks | [#957](https://github.com/lazyxu/xdrive/pull/957), [#1003](https://github.com/lazyxu/xdrive/pull/1003), [#983](https://github.com/lazyxu/xdrive/pull/983), [#990](https://github.com/lazyxu/xdrive/pull/990), [#995](https://github.com/lazyxu/xdrive/pull/995) |
| Mobile Web foundation | Shared adaptive shell and touch surfaces; existing Chromium acceptance is recorded separately from pending native iOS/Android work | [Mobile delivery and acceptance records](mobile-web.md) |

### Existing direct-open and Properties work

The fixed baseline predates [PR #1071](https://github.com/lazyxu/xdrive/pull/1071).
Before documentation delivery, its merged state was verified: **merged** on 2026-10-09
02:40:28 UTC as [27fe038ec87c2b2b8ca200f86977e6e8938925da](https://github.com/lazyxu/xdrive/commit/27fe038ec87c2b2b8ca200f86977e6e8938925da).
It delivers ordinary mouse single click to Viewer for active, permitted media, a shared
Open/Properties context menu, the **属性** label, and Properties that keeps Viewer mounted.
Touch single-tap was already delivered. Trash keeps its restricted Properties behavior.

The dependent [PR #1076](https://github.com/lazyxu/xdrive/pull/1076) was subsequently
merged on 2026-10-09 at 03:09:26 UTC as
[b70ad74bc8eb3435ed3f5001b28c8de0a4a1fc68](https://github.com/lazyxu/xdrive/commit/b70ad74bc8eb3435ed3f5001b28c8de0a4a1fc68).
It provides the FileExplorer image/video/Live Photo MediaItem adapter and reuses
the same Gallery Inspector on Web/Desktop, with version/session fencing and
cancellable Desktop lookup. The shared media fields and implementation are
verified by CI; physical-device acceptance is still a separate requirement.
FileExplorer-specific Node ID, provenance and custom attributes are preserved
as additional rows rather than duplicating the Gallery media-field formatter.

[#1061](https://github.com/lazyxu/xdrive/pull/1061) was superseded by merged #1059;
[#1062](https://github.com/lazyxu/xdrive/pull/1062) was covered by merged #1065.
Do not reopen those completed capability scopes from their closed/unmerged state.

## What to borrow from KFS

All KFS links below are pinned to the audited develop SHA. These are code observations,
not performance measurements or end-to-end runtime certification.

| Useful reference | xDrive application and limits | KFS evidence |
| --- | --- | --- |
| Device/format counts and compound selection | Already adopted; extend discoverability and applied-filter feedback, not a second filtering engine | [Dcim](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/packages/mui/pages/Dcim/index.jsx#L108-L159) |
| Separate media totals and filter result totals | Explain how many logical photos/videos match and which scope is active; never call sparse retained rows the whole library | [Dcim totals](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/packages/mui/pages/Dcim/index.jsx#L154-L159) |
| Different density by date scale | Already adopted as per-scale tile sizes; retain xDrive's sparse data and stable anchor | [Dcim time scales](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/packages/mui/pages/Dcim/index.jsx#L156-L159) |
| Directory-aware media entry | Already adopted for synchronization folders; next connect authoritative media origin/path and Explorer navigation | [Files path](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/packages/mui/pages/Files/AbsolutePath.jsx#L8-L35) |
| Viewport-aware thumbnail requests | Preserve xDrive scheduler, skeletons and cancellation; investigate new work only with measured evidence | [Cancelable image](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/packages/common/components/ImgCancelable/index.jsx#L16-L62) |
| Explicit original/digitized/modified time fields | Add provenance and correction tools without relabeling file modification/import time as capture time | [Mobile metadata](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/packages/common/components/File/DCIMAttributeRN.jsx#L66-L75) |
| Visible analysis progress/error/remaining state | Surface a compact Gallery indexing summary linked to existing Task Center; avoid another scheduler or permanent management dashboard above the wall | [MetadataManager](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/packages/mui/pages/Windows/MetadataManager/index.jsx#L85-L156) |

### KFS behavior that must not be copied or claimed as complete

- Many mobile intelligent-collection entries, including Live, panorama, screenshots,
  screen recordings, animations and duplicates, are explicitly disabled:
  [Albums](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/mobile/pages/Albums/index.jsx#L38-L89).
  Their presence is not evidence of implemented classification.
- The legacy Live pairing query joins directory and filename prefix:
  [old Live pairing](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/db/dbBase/live_photo.go#L8-L44).
  Keep xDrive's reliable identifier / validated container relationship; never guess
  Live membership from filenames or nearby timestamps.
- The Web grid maps the full loaded metadata list to elements:
  [ThumbnailList](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/packages/common/components/ThumbnailList/ThumbnailList.jsx#L51-L58).
  SSE and in-view image requests do not establish 100k DOM scalability.
- KFS mobile currently imports [ImageVideoViewer/New](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/mobile/App.js#L20-L27),
  so old Viewer code is not evidence of active gesture support. The Web
  [ImageViewer](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/packages/mui/pages/Windows/ImageViewer.jsx#L27-L54)
  comments out download-name initialization and keeps its download button disabled.
  Source-album cards and backend Live fields do not establish a complete Viewer,
  map, export or smart-album workflow.
- No comparative latency, memory, decoding or thumbnail throughput claim was measured
  in this audit. xDrive performance changes remain governed by gallery-performance.md.

## What to borrow from iOS Photos

Use Apple's documented interactions as product references. Do not copy an obsolete
version's overall layout or assume a native OS capability is available to a Web App.

| Reference behavior | Useful xDrive extension | Official source |
| --- | --- | --- |
| Capture-date versus added-date ordering | Explicit chronology and import views, with one documented timezone contract | [Sort/filter](https://support.apple.com/guide/iphone/iph2e66e2f2c/ios) |
| Grid zoom and square/original-aspect appearance | Photo-wall pinch density and optional uncropped presentation; preserve logical anchors | [Browse library](https://support.apple.com/guide/iphone/iph7d24753a5/ios) |
| Pinned collections, reordering and compact/collapsed sections | User-selected shortcuts for albums, people and synchronization folders | [Browse collections](https://support.apple.com/guide/iphone/iph4f36c4148/ios) |
| Scoped search and suggestions | Visible query tokens, scope, suggestions and clear lexical/semantic readiness | [Search](https://support.apple.com/guide/iphone/iph392d77d5f/ios) |
| Editable date/time/location and contextual information | Durable local corrections and reversible provenance-aware metadata | [Information](https://support.apple.com/guide/iphone/iph0edb9c18f/ios) |
| Copy/paste selected edits | Batch recipe application with source binding, progress and per-item failures | [Edit](https://support.apple.com/guide/iphone/iphb08064d57/ios) |
| Hidden collection and protected recovery access | Deliberate cross-surface visibility and authorization policy | [Hide/delete](https://support.apple.com/guide/iphone/iphb4defbde9/ios) |
| Live key frame, mute, trim, effects and video output | Whole-asset Live editing and explicit compatible export | [Live edits](https://support.apple.com/guide/iphone/iphd8dbb3291/ios) |
| Original export distinct from sharing choices | Explicit original/edited/compatible output with metadata choices | [Original export](https://support.apple.com/guide/iphone/iph480caa1f3/ios), [Share](https://support.apple.com/guide/iphone/iphf28f17237/ios) |
| Continuous selection and duplicate review | Large-result selection and metadata-preserving review, with xDrive CAS accounting | [Delete/select/duplicates](https://support.apple.com/en-us/104967) |
| Album organization and identity-aware collections | Album ordering/folders, individual pet review and control of unwanted memories | [Albums](https://support.apple.com/guide/iphone/iphc0fc668ab/ios), [People/Pets](https://support.apple.com/guide/iphone/iph9c7ee918c/ios), [Memory controls](https://support.apple.com/guide/iphone/iph10a9dd2a1/ios) |

Apple Intelligence-dependent search/edit features are conditional on supported devices,
languages, regions and OS versions. Apple's documented feature availability is not a
promise that xDrive can call those models or reproduce their results. Native biometric
unlock, AirDrop, background photo access and sharing integrations require separate
platform capability design; their labels are not portable Web implementations.

## Consolidated follow-up backlog

These priorities are recommendations for the next selection of work. Only the existing
direct-open/common Properties direction and existing mobile/preview contracts are
already accepted requirements. **P0** closes an existing interaction/integration gap;
**P1** improves common browsing and organization; **P2** is a larger capability expansion.

| ID | Priority / status at audit | Concrete next delta | Completion evidence |
| --- | --- | --- | --- |
| G01 | P0 / #1071 merged; adapter follow-up remains | Build on #1071 so FileExplorer uses the same media Properties as Gallery and Viewer; real path/origin can build on G06 | Same asset fields/actions from all entries; one mounted player; Properties follows Viewer target; normal file/folder behavior preserved |
| G02 | P0 / Validation pending + Proposed polish | Use the full available mobile workspace; compact Gallery navigation/actions; short landscape and safe areas; touch/keyboard/screen-reader access | Whole-App Gallery -> Viewer -> Properties -> return at narrow/wide/landscape, real iOS/Android recorded separately; no stacked duplicate chrome |
| G03 | P1 / Proposed | Capture-date/added-date sort, ascending/descending where useful; shared timeline/Memory/filter timezone; preserve an item anchor and collection context | Stable Server order plus tie-breaker, consistent range/Viewer order, midnight/DST/missing-zone cases, no full-collection load |
| G04 | P1 / Proposed | Pin/reorder useful collections; album search, manual-album order/cover/folder organization; optional aspect-ratio wall and grid pinch density | Account-scoped preferences, return-position consistency, no copied media or second Gallery navigation model |
| G05 | P1 / Proposed on existing search | Applied filter chips, recent/suggested searches, exact scope, counts and index-readiness feedback; search within album/person/folder | Count/list/facet agreement; preserve own-filter exclusion; lexical fallback visible; no mandatory facet work on first image |
| G06 | P1 / Proposed on existing folder browser | Authoritative file path, synchronization-folder provenance and Open in folder; optional explicit include-descendants scope; save reusable scope only after contract design | Owner-scoped path API; direct versus recursive counts explicit; scope composes with filters; no provider metadata dependency |
| G07 | P1 / Proposed on existing selection | Drag selection, select day/month, review selected set, select all query results with exclusions; batch undo/progress where meaningful | Define frozen versus live result semantics; Server/query-backed large selections, permission checks and bounded client state; partial failures visible |
| G08 | P1 / Proposed | Single/batch capture-time and location correction, timezone/provenance details, reversible adjustments | Original metadata retained; user override survives reindex/upgrade; Gallery/Viewer/Memories agree; unknown capture time stays unknown |
| G09 | P1 / Proposed on existing recipes | Edited thumbnails, before/after and undo/redo, chosen-adjustment copy/paste; explicit edited export and compatible output | Export pixel/trim/orientation matches saved recipe; original remains byte-identical; recipe/version keys invalidate derivatives; cancellable task for expensive renders |
| G10 | P1-P2 / Proposed | Live key frame/mute/trim/still or video output, later loop/bounce/exposure; inspect RAW/JPEG resources and choose Burst cover | Whole logical asset semantics, reliable pair evidence, audio/poster/trim consistency and source-preserving export; no partial grouped edit |
| G11 | P1-P2 / Proposed on current cleanup | Metadata-preserving exact-duplicate merge; near-duplicate review and real blur/closed-eye quality signals as separate evidence | User intent/resource/album references preserved, human confirmation, rollback/trash, truthful logical and physical byte accounting |
| G12 | P1 / Proposed | Asset-level Hidden collection and sharing metadata choices; precise recovery scope, optional protected access | Hidden media excluded from all intended Gallery/search/map/memory views and thumbnails; direct APIs/Explorer/shared links follow an explicit policy; no CSS-only lock |
| G13 | P2 / Proposed on existing intelligence | Individual pet identities, better people review, hide unwanted memories, richer local map and bounded region search | Separate derived suggestions from durable user decisions; privacy-preserving map provider; no claim that cat/dog type equals named pet |
| G14 | P2 / Proposed | Shared-album membership/collaboration, offline pinned collections, incoming share targets, later video-moment search and creative refinements | Capabilities and permissions are explicit; same core media/task contracts; no promise of native background photo sync from an ordinary Web page |

### G01: the accepted interaction and Properties contract

- Gallery ordinary click/tap opens Viewer only for active, permitted media. Trash
  remains Properties-only and must not open Viewer or fetch original/Live motion.
  Explicit selection mode, Ctrl/Cmd and Shift continue selecting; keyboard
  opening/selection is documented and accessible.
- Keep the Info icon but name the action and surface **属性**. Right-click provides
  Properties. Touch has an accessible action; it must not depend on hover.
- Viewer Properties preserves current playback/zoom and the caller's collection. Only
  the media Viewer remains the player; Properties can omit its redundant preview.
- The same shared media information content serves Gallery, Viewer and FileExplorer
  images/videos/Live Photos. File/folder-specific facts and capabilities are composed
  through adapters, not replaced by a second media dialog.
- Distinguish the clicked file's bytes from the logical asset's resource total.
  Missing/indexing/failed metadata has an honest state and retry behavior.
- Obtain path/source from an owner-scoped authoritative API. A parent ID alone is not
  a path, and one asset must not be assumed to have exactly one source or album.

### G03/G05/G06: browsing queries stay coherent

The current query exposes camera/format/date/favorite/person/place/folder/search
constraints but no user-selectable sort contract. Sorting is a Server contract and
must be applied consistently to ranges, counts, timeline groups and Viewer neighbors.

Timeline and Memories currently use UTC day boundaries. A new user-zone contract must
cover date-filter boundaries and displayed dates together, including missing original
offsets and daylight-saving transitions. Do not silently treat import/modification time
as capture time or hardcode +08:00 because one user is in China.

Current folder scope is direct children, loaded one directory at a time. Adding an
include-descendants option is a new query/aggregation contract, not a relabeling of
current counts. Smart albums currently do not persist transient folder scope.
A proposed reusable source/folder rule must define identity, move/deletion behavior,
authorization and efficient queries before that boundary changes.

Show capture device and synchronization folder as separate dimensions. Counts refer to
logical assets in the selected scope; they are not physical resource counts or counts
of retained sparse rows. Do not run every facet/count aggregation before the first image.

### G07: selection scale must match what the UI promises

Current Shift selection walks at most 1000 logical indexes and selects metadata retained
in the sparse collection. This is not select-all-results. Do not silently describe a
partial window as a whole day, album, or search result.

Large selections need a query/snapshot or equivalent bounded Server contract plus
explicit exclusions and mutation-time ownership checks. Define how concurrent imports,
deletes, sort changes and filter changes affect the selected set. Reuse existing
cancellable durable tasks; report partial success and retain a way to retry failures.

### G08/G09/G10: separate original, intent, preview and export

Capture-time/location corrections are durable user intent over original metadata.
Basic edit recipes already preserve original bytes; do not rebuild that foundation.

The current image/video recipe is displayed by Viewer/Inspector; the grid marks edited
assets and ordinary Download returns originals. New edited thumbnails/exports must
consume the same recipe and original fingerprint. Do not change Download silently.
Expose output choices only when the corresponding renderer actually exists.

Creation outputs and editable sources remain distinct. Do not assume automatic movies
already bake saved recipes, or that simple image/video recipes cover Live/RAW/Burst.
Optional video/Live derivatives belong behind the existing renderer/task boundaries;
persistent derivatives need storage-inventory categories and safe cleanup semantics.

### G11/G12: organization, deletion and privacy are different contracts

Current exact duplicates are equal primary SHA-256 originals. Near-duplicates and Burst
quality are separate evidence classes. Combining records must preserve favorites,
descriptions, tags, people, album membership and resource relationships; comparing
primary hashes alone must not discard a richer logical asset.

CAS may already share identical bytes. Keeping one reference can mean zero immediately
reclaimable physical bytes. Removal from an album only removes membership; moving an
item to Trash differs from permanent deletion. Gallery Trash may act on a folder Trash
root and must communicate that scope instead of promising single-descendant recovery.

Hidden media is a proposed asset-level feature, not the existing hidden-person flag.
Before adding protected collections, define behavior in Gallery, Explorer, direct
preview/download tickets, shared links, caches and search-derived views. Browser UI
hiding alone cannot provide access protection. Preserve remote read-only defaults;
local organization or cleanup must not become deletion from synchronization providers.

### G13/G14: build on existing intelligence, not another product stack

Current Pets distinguishes cat/dog types, not individual animal identities. People,
Places, OCR/semantic search, Memories, cutout/erase, collage and movies already exist.
Proposals should name the additional identity, ranking, interaction or export behavior.

Improve the usefulness and explainability of existing capabilities before adding more
models. A richer map needs bounded queries and a local/self-hosted provider choice.
Offline and collaborative albums require explicit storage, permission and consistency
contracts; a manifest or a file-share link alone does not supply them.

## Suggested execution order and verification

1. Build on merged #1071 to complete the shared FileExplorer media Properties adapter
   (G01). Preserve the delivered Gallery and Viewer behavior.
2. Finish full mobile Gallery/Viewer/Properties acceptance and targeted compact
   presentation improvements (G02), coordinated with the existing Mobile Web track.
3. Add explicit sort/timezone semantics and preserve browsing context (G03); improve
   source navigation and filter clarity on existing APIs (G05/G06).
4. Close the editing-to-output workflow (G08/G09) and improve advanced selection and
   useful pinned collections (G07/G04).
5. Add deliberate hidden/shared/export policies and safer cleanup depth (G12/G11).
6. Extend Live/grouped media, individual pets, maps, memories and collaboration/offline
   after their specific contracts are selected (G10/G13/G14).

These are separate deliveries, not one large PR. For a chosen feature, update the
relevant product/preview/mobile contract and add a dated status record here in the
same change. Do not make every proposal a global blocking test requirement.

Verification must match the changed scope: relevant UI/adapter/Server behavior, unknown
and failed metadata, mixed still/video/Live/RAW data, account/scope isolation, state
restoration and real-device limitations. For 10k/100k performance work, use the named
workloads and measurement gates in [Gallery performance](gallery-performance.md) and
AGENTS.md. Measure before changing behavior and retain optimizations only after a
repeatable material improvement with the same workload. This audit reports no new
timing, memory, FPS or throughput result.

## Delivery log

- 2026-10-09: related PR #1071 was verified merged as 27fe038ec87c2b2b8ca200f86977e6e8938925da
  before documentation delivery. Direct-open and in-Viewer Properties are delivered;
  the shared FileExplorer media Properties adapter remains a separate follow-up.
- 2026-10-09: source comparison and follow-up backlog recorded; stale Phase-2/Phase-7
  future wording and conflicting Gallery click/Info guidance reconciled in related
  documents. This entry records documentation work only; all product proposals above
  retain their explicit status.
