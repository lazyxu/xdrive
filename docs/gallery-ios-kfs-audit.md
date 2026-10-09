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

### Mobile full-viewport delivery

The merged implementation in [PR #1078](https://github.com/lazyxu/xdrive/pull/1078) gives
every registered Mobile Web App the entire browser-available dynamic viewport below
900 CSS px. Global header/footer, permanent bottom navigation and desktop outer page
padding reserve no app space; app switching, account/settings and transfers remain
reachable through the shared on-demand overlay. Gallery's stacked title uses content
height, immersive media chrome overlays the full content area, and Viewer loading/error
states retain their frame and Return. This is the current layout contract; do not
reintroduce the earlier middle-only content area while polishing Gallery controls.

The precise before/after geometry, renderer matrix, caller continuity, last-row touch
target checks and device limitations live in [Mobile Web](mobile-web.md). Its PR CI
passed before merge. The remaining G02 work is app-specific control polish and whole-task
device acceptance, not rebuilding the viewport Shell. The separate
[Mobile Web iOS inventory](mobile-web-ios-comparison.md) covers Files, dedicated
viewers, transfers and platform/accessibility work and references this audit for
Gallery-specific follow-up; its proposals do not authorize implementation.

The current delivery rows and log take precedence over earlier execution-order wording
for completed G01/G02 scopes: preserve their shipped foundations while validating
complete tasks. Future Gallery deliveries maintain their own status and evidence.

The chronological sorting foundation is separately delivered by
[#1082](https://github.com/lazyxu/xdrive/pull/1082) at
`3f4d27db0b9e83579bee42e9904f3cd200572737`: capture/added ordering, query propagation
and time-axis grouping are implemented. G03 still includes IANA timezone consistency
and same-photo anchoring across re-sorts; do not label that whole item complete.

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
| G01 | P0 / #1071 + #1076 merged; complete (2026-10-09) | Build on #1071 so FileExplorer uses the same media Properties as Gallery and Viewer; real path/origin can build on G06 | Same asset fields/actions from all entries; one mounted player; Properties follows Viewer target; normal file/folder behavior preserved |
| G02 | P0 / #1078 merged; physical iOS/Android acceptance pending | Use the full available mobile workspace; compact Gallery navigation/actions; short landscape and safe areas; touch/keyboard/screen-reader access | Whole-App Gallery -> Viewer -> Properties -> return at narrow/wide/landscape, real iOS/Android recorded separately; no stacked duplicate chrome |
| G03 | P1 / Sorting, original-item anchor and IANA timezone merged; shared Memories forwarding corrected; device and 100k acceptance pending | Capture-date/added-date sort, ascending/descending where useful; shared timeline/Memory/filter timezone; preserve an item anchor and collection context | Stable Server order plus tie-breaker, consistent range/Viewer order, midnight/DST/missing-zone cases, no full-collection load |
| G04 | P1 / #1095 organizer, #1097 covers, #1099 uncropped wall and #1102 folder Server APIs merged; shared Web/Desktop folder navigation/mutations under PR; variable-height mosaic pending | Pin/reorder useful collections; album search, manual-album order/cover/folder organization; optional aspect-ratio wall and grid pinch density | Account-scoped preferences, return-position consistency, no copied media or second Gallery navigation model |
| G05 | P1 / Applied-feedback stage in #1115; explicit index coverage substage in this dependent PR, integration/device verification pending | Applied filter chips, recent/suggested searches, exact scope, counts and index-readiness feedback; search within album/person/folder | Count/list/facet agreement; preserve own-filter exclusion; lexical fallback visible; no mandatory facet work on first image |
| G06 | P1 / owner-scoped Node location/provenance backend candidate; Gallery/FileExplorer UI and recursive scope pending | Authoritative file path, synchronization-folder provenance and Open in folder; optional explicit include-descendants scope; save reusable scope only after contract design | Owner-scoped path API; direct versus recursive counts explicit; scope composes with filters; no provider metadata dependency |
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

Current Shift selection permits an index distance of at most 1000, walks both endpoints
(at most 1001 logical indexes), and selects metadata retained
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

### G11 phase 4 — confirmed annotation transfer is not duplicate deletion (2026-10-09)

The shared Gallery expands only verified full-asset-equivalent copies;
a separate review panel can examine 2–32 independent originals and their
user edits, albums, descriptions, people and tags. The next confirmed
operation uses the Server's exact SHA-256 plan token, an explicit checkbox
and capability-checked Web/Desktop/Agent POST. It may union only verified
non-conflicting user annotations onto a designated keeper. The UI must
disable confirmation for ambiguous resources, different edit recipes or
descriptions, and require a **new plan** following any 409 conflict.
No source-managed album migration, Node delete, CAS decrement or automatic
deduplicating cleanup is permitted. The physical byte saving is zero by
design, and user quota does not decrease. The actual file-removal/undo and
sync-reimport contract remains separately unimplemented.

### G11/G12: organization, deletion and privacy are different contracts

Current exact duplicates are equal primary SHA-256 originals. Near-duplicates and Burst
quality are separate evidence classes. As of 2026-10-09, the cleanup index
must support more than 48 groups via bounded group-level pagination shared
by Web/Desktop, with an explicit older-Agent fallback. A zero-card empty state
still only covers indexed, ready media; complete indexing coverage is a
separate pending status feature, not an implied guarantee. Combining records must preserve favorites,
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

- 2026-10-09: G06 phase 2a Web shared Properties candidate (not yet merged):
  one lazily mounted Location section shows the current owner-authorized xDrive
  Node path and parent, separately from recorded synchronization provenance and
  current sync-root containment. Web Gallery, Files media Properties and the
  routed Viewer use the same section; navigation uses parent Node ID and preserves
  the existing media player. AbortSignal cleanup/revision fencing and an explicit
  retry prevent stale location responses. CI pending; native iOS/Android and
  Desktop transport are **not** verified by this phase.

- 2026-10-09: G06 phase 1 backend candidate (not yet merged) adds
  authenticated `GET /api/v1/nodes/:id/location` with owner-scoped
  current xDrive Node path, directory breadcrumbs, parent ID and path.
  Connector provenance comes only from SourceItem->Source (including
  original path when recorded), while current synchronization-folder
  containment comes independently from ancestor target-node IDs.
  Moving an xDrive file does not rewrite its SourceItem evidence.
  This route is **on-demand**, not part of 100k Gallery range hydration,
  and does not trigger MediaIndexer. PostgreSQL tenant-isolation and
  move/delete tests accompany it. Web/Desktop/Viewer Properties wiring,
  Show in Folder navigation, explicit direct/recursive scope, and
  full CI/device acceptance remain distinct G06 follow-ups.

- 2026-10-09 G05 on-demand index coverage follow-up (dependent on #1115): add an owner-scoped, read-only `GET /media/index-status`, querying active known PhotoAssets and their primary node's media-index state, not physical files, raw upload bytes or unscanned content. Web/Desktop share `getIndexStatus`; Desktop uses a distinct Agent capability and legacy Agent refusal, never a silent fake ready state. The toolbar checks this status only when explicitly requested and distinguishes ready, failed, unsupported, missing metadata, and other unready assets. The status is labeled **known_photo_assets**, not "whole library scanned". New PostgreSQL integration verifies owner separation, incomplete index evidence and trash exclusion. This candidate remains CI-pending: do not treat a green source contract as a full 100k performance, active-index scheduler or real-device acceptance.

- 2026-10-09 G05 applied-feedback candidate: UI distinguishes submitted Server query from an uncommitted filter draft. The compact shared Web/Desktop bar states the current collection/folder scope and Server total_count, displays applied filter chips with independent removal, notes pending draft changes, and labels relevance versus basic matching from the actual search_order response. Bounded recent search suggestions are scoped by authenticated account preference key; no history is stored with an empty account key. Existing facet requests remain lazy and Server own-facet exclusion is preserved. No server index coverage endpoint or actual unfinished/index-failure count is added here; the UI says coverage has **not been verified**, and this work cannot be marked G05-complete before that status is implemented and tested. PR CI is the gate.

- 2026-10-09: G04 verified master after [#1095](https://github.com/lazyxu/xdrive/pull/1095), [#1097](https://github.com/lazyxu/xdrive/pull/1097), [#1099](https://github.com/lazyxu/xdrive/pull/1099) and [#1102](https://github.com/lazyxu/xdrive/pull/1102) merged. Their shared album organizer, durable manual covers, optional uncropped fixed-square tiles and nested folder Server API are foundations, not new tasks to duplicate. The separate pending Web/Desktop delivery connects that Server folder tree to a shared album UI: browse direct children with breadcrumbs, create/rename/move/delete empty folders, and move only manual/smart albums using revision-fenced mutation. Search can span album folders; pin/order preference stays device-local, folder placement Server-owned. The UI cannot claim true variable-height/masonry wall or real device validation. Do not mark this staged UI complete before its own CI and device checks.


- 2026-10-09: G03 follow-up: the shared `MediaGalleryAdapter` omitted the IANA timezone argument when delegating `listMemories` and `listMemoryItemRange` to Web/Desktop transport ports. As a result, correctly selected non-UTC zones could revert to UTC specifically for Memories despite the merged Server/IPC implementation. Correct the typed shared port signature and forward `timeZone` on both paths; add permanent Web/Desktop contract checks. This is a verified integration gap, not a new feature. Full PR CI and physical-device acceptance remain separate.


- 2026-10-09: G04 Server album-folder contract candidate (stacked after optional uncropped wall): introduces a separate owner-scoped `PhotoAlbumFolder` model with parent ID, sibling-name identity, revision and cycle checks, plus a `PhotoCollection.album_folder_id` metadata link for **manual/smart albums only**. Folder CRUD and album move are `If-Match` fenced; nonempty folder deletion is rejected, without moving/deleting/copying PhotoAssets or Source-provided albums. Route manifest, PostgreSQL owner-isolation/membership integration test and Go/TypeScript data types are included. This is **backend only** until Web/Desktop folder navigation and mutation UI are delivered; both this PR and UI need CI before marking G04 folders done.

- 2026-10-09: G04 additional candidate (separate stacked PR) allows **square crop** or **original media aspect, fully visible within the same square cell**. The second mode uses CSS object-fit contain for still/Live/video poster images, not irregular masonry/justified physical row heights; this deliberately preserves the existing 100k sparse VirtualGrid/Timeline geometry, thumbnail worker admission and sort/scroll anchor. It reuses existing density-by-timescale preferences, records chosen display mode in the same device-local preference, and never downloads an original just to display a tile. **This does not implement real nested album folders or a variable-height justified/masonry wall.** Validation pending authoritative branch CI.

- 2026-10-09: G04 album organization phase 1 merged as [#1095](https://github.com/lazyxu/xdrive/pull/1095), commit `9ffee355ea7dff486866adb4e9831409f04ad6ec`: shared Web/Desktop album-name search, device-local per-account pinned albums, custom reordering and name/recent/count sorting; Server membership stays unchanged.
- 2026-10-09: G04 album cover phase 2 is **under independent PR validation**. Manual-album cover preference is nullable, owner-scoped and revision-fenced, and only a visible asset already belonging to that manual album can become the cover; removing/deleting the chosen asset falls back to an existing member without stale or private preview access. Automatic cover restoration uses node_id=0. Source/provider albums and smart albums remain read-only for manual cover preferences. This phase must pass PostgreSQL integration and Web/Desktop transports before it can be marked delivered.

- 2026-10-09: G04 first slice (under PR CI): Web/Desktop reuse a single album organizer supporting album-name search, pinning frequently used albums, manual up/down organization and name/recent/count sorting. Preferences are scoped to the active account and stored only in that device's localStorage; they do **not** change Server album ordering or create virtual copies. Account/server switch must not leak organization state. Manual album covers, real album folders and a ratio-aware photo wall remain separate G04 work. The existing shared density slider and bounded 100k virtual wall are retained, not replaced.

- 2026-10-09: G03 chronological capture/added sorting merged by [#1082](https://github.com/lazyxu/xdrive/pull/1082), and same-photo anchor restoration merged by [#1085](https://github.com/lazyxu/xdrive/pull/1085) at `66f9f2c88a83af203251200e2e2c217d1039f30d`. Both have authoritative passing PR gates. G03 timezone integration is a distinct in-progress delivery, not a verified device acceptance.
- 2026-10-09: G03 timezone change extends the existing Gallery range/Memory queries with validated `time_zone` (IANA name, UTC default for old callers), computes timeline dates and Memory day memberships using that zone, and converts local capture filter boundaries to UTC with DST-aware midnight resolution. Web/Desktop use one persisted timezone preference; the shared Properties/Viewer capture-time formatter reads the same preference. The change is **pending CI and integration verification**: do not describe it as merged until full tests pass. Changes must not guess capture time from import or file mtime, use fixed offsets, or load full 100k collections to group by date.

- 2026-10-09: G03's next slice adds optional `anchor_node_id` to the existing
  owner-scoped, filter-scoped Gallery range contract. Only the first sparse page
  computes its new logical index by a bounded SQL rank/count, then the shared
  Grid/Timeline restores that index using its existing virtual layout. It must
  not materialize all media in Web/Desktop, add a second media endpoint, or
  persist the transient anchor in Viewer browsing context or smart-album rules.
  Deleted/filtered-away anchors safely fall back to the sorted beginning.
  This is implementation-scope evidence, not a 10k/100k latency benchmark or
  native-device pass. Unified IANA timezone and DST/midnight consistency
  remain to be delivered before G03 can be marked fully complete.

- 2026-10-09: G01 delivered by [#1076](https://github.com/lazyxu/xdrive/pull/1076), merge commit b70ad74bc8eb3435ed3f5001b28c8de0a4a1fc68; FileExplorer, Gallery and Viewer now reuse media Properties. G06 still owns precise file origin and navigation.
- 2026-10-09: G02 mobile Web viewport/overlay work delivered by [#1078](https://github.com/lazyxu/xdrive/pull/1078), merge commit 1541d78cc4facafc535bb59cd1bdc7fd3045d3d8. Full-app Chromium checks passed; actual iOS Safari/Android Chrome hardware acceptance remains outstanding.
- 2026-10-09: G03 implementation staged: explicit Server-backed sort_by=captured|added and sort_dir=asc|desc, matching sparse-range timeline group ordering, and Web/Desktop query/UI. Semantic search retains relevance ranking. This does not establish user-zone consistency or stable same-photo anchoring after a re-sort. UTC grouping, Memories, timezone-selectable date bounds, and original-item anchor restoration remain pending until additional implementation/verification.

- 2026-10-09: related PR #1071 was verified merged as 27fe038ec87c2b2b8ca200f86977e6e8938925da
  before documentation delivery. Direct-open and in-Viewer Properties are delivered;
  the shared FileExplorer media Properties adapter remains a separate follow-up.
- 2026-10-09: source comparison and follow-up backlog recorded; stale Phase-2/Phase-7
  future wording and conflicting Gallery click/Info guidance reconciled in related
  documents. This entry records documentation work only; all product proposals above
  retain their explicit status.

### G11 Cleanup index coverage — shared visibility (2026-10-09)

The Cleanup root remains Burst-review only while zero-reclaimable original-hash
duplicate cards remain hidden (the read-only duplicate backend remains for
future Gallery folding). The existing G05 known-asset index-status DTO is now
shown directly on that root via an explicit user action, including errors
and a check timestamp. An empty Burst list says only that *ready indexed media*
currently yields no suggested cleanup. Known PhotoAssets do not cover
undiscovered/unindexed files or unsynchronized provider items; this must not
be treated as complete inventory certification. UI display does not add a
new first-open SQL scan or a new mutation path.

### RAW compatible high-resolution preview — implementation follow-up (2026-10-09)

**In progress / CI pending:** connect existing 1280px analysis JPEG derivative
to shared FileExplorer/Gallery/Viewer for DNG/NEF/ARW/CR3 with embedded JPEG.
These files are not original-image preview ticket formats; raw download remains
unchanged. Web/Desktop use the same classifier/Preview Engine, and missing RAW
embedded JPEG remains an explicit compatibility limitation. Final resolution,
resource use and real Safari/Electron decode must be measured with identical
fixtures before claiming high-resolution parity.

- 2026-10-09: G06 phase 2b Desktop transport candidate (not yet merged):
  Agent/Electron capability `node-location`, per-request cancellation,
  Go client and shared Web/Desktop Gallery/FileExplorer media Properties
  feeding parent-ID folder navigation. UI does not invent provider paths or
  create a second player. Full CI and real device acceptance remain pending.

## M15–M16：人物与地点流程补充（2026-10-09）

现有人物身份和猫／狗类型集合保留。人物确认、命名、合并、拆分使用窄屏44px和短横屏可滚动弹窗；只有新建或归入已有的人物成功且原建议卡退出时，焦点交接到持续挂载的当前标题。相同40项17/23→40/0、同70项68/2→70/0；拒绝、同参数重试和完整ID／revision均保留。

地点复用共享拖动工具，延后捕获以保留单击／点按；真实主题色保证聚合数量可读，缩放／重置／返回窄屏44px。现有图库状态只保存三数地图视角；地点加载、失败和成功空GPS不混用。Web／Desktop取数上限与现有1000契约一致，概览仍为24。同38项27/11→38/0，整合返回按钮同32项30/2→32/0；最终人物70／地点40／实际构建App相册40全部通过，完整Desktop1622/0/1既有skip，typecheck/lint/build0。完整新PR CI/线性合并仍为交付门禁，M17继续按序实现。

基线为已交付M12–M14合并0e90a0fd；保留后续已存在的范围取消、NodeLocation和只读副本整理计划。全部证据见[人物与地点验证](validation/mobile-gallery-people-places-2026-10-09.json)。M49.V13–V14仍将物理设备、安装模式、OS键盘／安全区和VoiceOver／TalkBack记为not-run。

## M12–M14：相册、日期与属性补充（2026-10-09）

M10/M11已由PR1125完整CI37914259268合并3ad7e73a并清理。以此为固定父版本，补齐相册选择器短屏滚动与成功焦点、实际年月选择框44px，以及描述/标签/人物的保存反馈和未记录的视频旋转。复用现有选择ID/版本、日期索引、编辑目标守卫与共享属性，不改Server或算法。相册同14项12/2→14/0、实际同40项39/1→40/0；日期同45项41/4→45/0；属性同21项11/10→21/0、旋转5项3/2→5/0。整合c55d5ad1上的实际App40/37、属性28均通过，完整Desktop1613/0/1既有skip，typecheck/lint/build通过。已由PR #1143完整CI37917029455合并0e90a0fd并清理；真机、键盘、读屏仍not-run。详见[整合证据](validation/mobile-gallery-selection-timeline-properties-2026-10-09.json)。

## M11 compact panels — renderer acceptance (2026-10-09)

Reused merged PR #1122's shared VisualViewport observer and in-app filter Drawer. A measured 844×200/200% text case exposed only23px of a63px first field beneath sticky actions; removing only compact sticky positioning makes the field and existing actions reachable through one scroller while fixed44px Close remains. Gallery navigation is at least44px below900CSSpx independent of pointer type. Existing draft/applied query, on-demand index status, album selection, IANA boundaries and adapters remain intact.

The same57-check first-red is52pass/5fail; final57 and actual built-Web panels37 all pass after preserving merged M12bd96. FullDesktop1594pass/0fail/1existing skip, typecheck/lint/build pass. Exact scope and hashes are in [M11 evidence](validation/mobile-panels-short-viewport-2026-10-09.json). Updated PR1125 CI/merge are pending; physical keyboards, installed modes and screen readers are not-run. This does not certify later Gallery follow-up items.

- 2026-10-09: G06 phase 2c candidate (unmerged): add explicit "仅当前目录"/"包含子目录" Gallery scope, using Server-side owner-scoped recursive Node ancestry, not client-side flattening; query composition carries it through actual Gallery ranges/facets/sort/filter and Web/Desktop Agent. Include-descendants without a folder is rejected; old Agent refusal is explicit. PostgreSQL owner/isolation, Go URL serialization and shared React source regressions included. Physical iOS/Android, Desktop, 100k recursive-folder benchmark and full CI not yet verified.

- 2026-10-09: G07 phase-1 review candidate (unmerged): the real shared
  Selection Toolbar gains **查看已选项**, listing the exact live selection
  Map with bounded 100-row pages and search/removal, preserving all current
  batch action paths and Viewer context. No thumbnail/media re-fetch or
  silent all-query expansion. Query-wide frozen snapshots/exclusions, date
  selection beyond loaded pages, partial batch failures, and 100k physical
  acceptance are **not yet implemented**; do not mark G07 finished.

- 2026-10-09: G07 phase 2a owner-scoped snapshot candidate (backend-only,
  unmerged): explicit selection operation freezes up to 100k matching known
  media Node IDs/revisions; no first-open scan, 100k client hydration or
  implied original-byte fetch. A bounded response plus server exclusions,
  session version, expiry, tenant guard and DST-correct selected day are
  deliberately distinct from the G07 phase-1 review of explicitly loaded
  items. Query-wide mutations, Task Center progress, partial failures and
  iOS/Android/device QA are NOT implemented by this stage.

- 2026-10-09: G07 phase 2b Web-only candidate (stacked after Phase 2a).
  Gallery exposes explicit server-frozen whole-query / IANA-day selection and
  bounded 100-row read-only review with excludes, restores and honest totals.
  The token is released on close and scope teardown; filtered/folded and
  expired snapshots are never converted into MediaItem[] batch operations.
  This does not claim Desktop support, durable jobs or final 100k/real-device
  acceptance. Existing explicit multi-selection behavior is preserved.

- 2026-10-09: G07 phase 2c Desktop transport candidate. Routed the same
  read-only query selection and date-selection contract through Go Client,
  Agent loopback IPC, Electron Main/Preload and shared Gallery. Agent
  capability and boundary validation are explicit; bulk mutations remain
  disabled. Full CI and real Windows/macOS/Android/iOS evidence pending.
