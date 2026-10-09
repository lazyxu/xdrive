# xDrive Preview Engine

## Status

This document is the normative architecture contract for ordinary file preview across
xDrive Web and Desktop.

The Preview Engine is shared by FileExplorer and Gallery. Platform code may adapt
authentication and transport, but must not create a second ordinary-media preview
pipeline.

## Gallery capture-date timezone

Gallery, FileExplorer media Properties and standalone Viewer must format
canonical `captured_at` through one shared IANA timezone preference; never
substitute Node creation time for an absent captured date. The Server date
timeline, date filter UTC boundaries and Memories must use the same selected
zone (including 23/25-hour DST days). This date presentation contract does
not add a second media player or alter downloaded original bytes. The
timezone delivery is pending independent CI/real-device verification.

## Gallery experience and Properties follow-up

[Gallery product roadmap](gallery-product-roadmap.md) owns Gallery product behavior.
The [dated iOS Photos / KFS audit](gallery-ios-kfs-audit.md) distinguishes implemented
capabilities, in-progress work, proposed extensions, and device acceptance.
Do not use an older double-click/Info description to undo the accepted direct-open
and common **属性** contract. Extending media Properties must reuse the shared
media content and platform adapters; ordinary file/folder Properties and FileExplorer
selection remain separate. See the audit for implementation status.

## Architecture

```text
                    xDrive Preview Engine
                           |
             +-------------+-------------+
             |             |             |
          classify       source        renderer
             |             |             |
         file-preview   preview-ticket  FilePreviewSurface
             |             |             |
             +-------------+-------------+
                           |
             +-------------+-------------+
             |                           |
      FileExplorer Inspector       Gallery MediaDetails
             |                           |
        file-management data          media semantics
                                     EXIF / GPS
                                     Favorite / Tags
                                     Live Photo / Albums
```

The three Preview Engine responsibilities are deliberately separate:

- **classify** decides whether a file is text, image, video, audio, PDF, or unsupported.
- **source** obtains safe preview bytes/URLs without exposing long-lived credentials.
- **renderer** displays the classified file through one shared React/MUI surface.

## Canonical shared implementation

### Classification

Framework-neutral preview classification lives in:

- `ui/shared/src/file-preview.ts`

The canonical model is `XDriveFilePreviewKind` and the canonical classifier is
`xDriveClassifyFilePreview`.

Web and Desktop must not maintain separate extension or MIME classification tables.

### Renderer

The canonical renderer is:

- `ui/shared/src/mui/FilePreviewSurface.tsx`

It owns the ordinary renderers for:

- text
- PDF
- video
- audio
- image

FileExplorer and Gallery must consume this surface rather than implementing parallel
ordinary-file renderers.

### Consumers

- FileExplorer uses the Preview Engine from its Inspector.
- Gallery `MediaDetails` uses the same Preview Engine for ordinary images and videos.
- Gallery keeps media-domain controls and metadata outside the Preview Engine.

## Source contracts

### Text preview

Text preview is intentionally bounded and authenticated:

```text
GET /api/v1/files/:id/preview/text
```

It returns inert text data and is not a raw arbitrary-file stream. The renderer must
never inject returned text as active HTML.

### Binary preview

PDF, video, audio, and image preview have exactly one Server source path:

```text
POST /api/v1/files/:id/preview-ticket
        |
        v
signed preview ticket
        |
        v
GET/HEAD /api/v1/file-preview/:id?ticket=...
        |
        v
HTTP Range / 206 stream
```

Do not add another authenticated direct file-preview stream or a media-specific
playback API.

The old media playback pipeline and direct
`GET/HEAD /api/v1/files/:id/preview` path were intentionally removed after the
Preview Engine migration.

### Desktop transport

Desktop uses the same Server preview ticket contract.

Electron main hides the upstream signed URL behind a random loopback-only preview URL.
The renderer must not receive the xDrive Server access token or the Agent bearer token.

Desktop CSP may allow only the required loopback preview origins. Do not widen preview
CSP to arbitrary remote hosts.

### Thumbnail fallback

Thumbnails are not a second ordinary-file preview architecture.

They remain valid for:

- Gallery/list/grid thumbnails and posters.
- fast low-resolution display.
- image fallback when the runtime cannot decode the original file.

Original image preview should be attempted first in details/Inspector surfaces when the
format is supported by the Preview Engine.

### Persistent preview/cache storage accounting

Server-side preview/derivative storage is governed by `docs/storage-inventory.md`.

The current Preview Engine does **not** persist an ordinary Image/PDF/Video/Audio preview cache: ordinary preview streams the canonical file through the signed preview contract. The storage inventory therefore reports the reserved ordinary-preview path as zero / not enabled until such a derivative pipeline actually exists.

If video transcoding/proxy generation or a persistent poster/preview cache is added later, that change must register its physical path, accounting semantics, regeneration contract, and cleanup safety in the storage inventory in the same change. Do not create an unreported `.xdrive-media` subtree.

## Security contract

Preview tickets must remain narrowly scoped.

The current signed preview ticket is bound to:

- user
- session version
- node
- node revision
- preview kind
- expiration

The binary stream must continue to enforce:

- a strict preview allowlist
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Cache-Control: private, no-store`
- inline disposition
- revision invalidation
- session invalidation
- HTTP Range / 206 behavior

Active document formats such as HTML and SVG must not be added to the binary preview
allowlist merely because a browser can display them.

If a new format needs special sanitization or conversion, add a safe derived-preview
resource instead of weakening the raw-preview allowlist.


### RAW compatibility preview (1280px, embedded JPEG only)

Status: **In progress / CI pending**. The normal Viewer and FileExplorer use the
*existing authenticated* `GET /api/v1/media/items/:id/analysis-preview`
derivative for locally supported embedded-JPEG RAW extensions
(`.dng`, `.nef`, `.arw`, `.cr3`). This is a JPEG compatibility
rendering, **not Bayer/RAW demosaicing or an original RAW image stream**.
The source resource remains the original unchanged RAW Node, and ordinary
download continues to return the canonical RAW file. RAW originals do not
enter the `/files/:id/preview-ticket` original-image allowlist.

Only the shared Preview Engine renders the image: its thumbnail role still
fetches the 512px cache, and its high-resolution role receives the 1280px
revision/SHA/version-scoped analysis derivative (Web URLs also key by the
current Node revision so the browser cannot serve cached bytes across overwrite). The existing decode-gated
handoff, 2-source bound and failure behavior remain unchanged. When a RAW
has no safe embedded JPEG or generation fails, no fabricated high-resolution
preview is shown; the validated 512px thumbnail may remain visible if present.
FileExplorer/Quick Look, Gallery Viewer/Properties and standalone Web Viewer
reuse platform adapters and the shared decoder. An abandoned image source
request carries a viewport AbortSignal to Web fetch or Desktop IPC/Agent GET.

The original signed ticket, user/session scope, `nosniff`, Server ownership,
2048px creative preview, and physical derivative storage classes are unchanged.
The existing `analysis_preview` storage class includes this 1280px output;
no new cache subtree is created. CI and physical sample tests must distinguish
pre-existing thumbnails from 1280px derivatives, image orientation and
image-only JPEG output. Real-device end-to-end before/after latency and bytes
are **not measured by this structural integration**. HEIC's native original
decode still uses existing thumbnail fallback; separate HEIC HD compatibility
routing, no-preview RAW formats and full RAW processing remain follow-up work.

## Renderer behavior

### Image

The image renderer prefers the original signed preview URL.

Image preview loading is keyed by stable source identity, not React object/function identity.
Equivalent parent rerenders for the same node id, node revision, and preview kind must not
clear the current image, show the loading spinner again, or request the same preview source
again merely because the caller recreated a target object or inline loader callback. A real
node/revision/preview-kind change starts a new preview generation and keeps the existing
stale-completion fencing and blob URL cleanup rules.

Image source readiness and image presentation readiness are separate. The shared
`FilePreviewImage` renderer starts the existing original and thumbnail loaders independently;
a slow original ticket or byte stream must not block the first thumbnail. Each image stays
in a hidden layer until that very DOM image element has loaded and `decode()` has resolved
(or a successful load with valid intrinsic dimensions on runtimes without `decode()`).
The decoded thumbnail remains mounted and visible until the original is ready. The handoff
changes visibility in one React commit, without a timer, fade, detached original preloader,
second original request, or unmount/remount of the displayed thumbnail. A thumbnail arriving
after the original cannot downgrade the displayed image.

Source acquisition also observes whether a loader is available. If Web metadata supplies
the thumbnail loader after the same target has mounted, that previously unavailable role
starts once without restarting the original. Recreated callback functions do not reload
either role, and a completed failure does not become an implicit retry.

The renderer retains at most two image sources for the current target. A real node,
revision, or preview-kind change starts a fresh surface; it never labels another file's old
image as the new target. With no decoded frame available, loading remains visible until
the first usable frame. Original failure may keep the decoded thumbnail; failure of both
sources preserves the consumer's failure content (or an explicit image-preview failure).
This does not change list/grid thumbnail error behavior or replace failed thumbnails with
generic icons. Closing/replacing the surface fences late source/decode completions and
releases its owned blob URLs, including URLs returned after close. The existing string
loader contract does not propagate AbortSignal to ticket/thumbnail requests; this is not
a claim that every outstanding transport request is aborted.

Edited image presentation draws from the same decoded DOM image, before paint, through
`FilePreviewTransformedMedia`. It must not fetch the original again for the canvas, or
redraw canvas pixels for viewport-only zoom/pan while the decoded source and recipe
reference are unchanged. A new decoded source or an edit recipe change still redraws
the canvas; semantic memoization of recreated recipe objects remains separate work.

Validated single-file LIVP stills use the same handoff. Its internal Live Photo wrapper
stays mounted and receives explicit still readiness: the glyph and hold action become
available only after a real still is decoded. Gallery-owned wrappers for paired files
retain their media-semantic composition and consume the same current-still readiness.
Neither wrapper may acquire motion while its still is loading or failed; replacing
the source revision resets readiness before another hold can acquire motion.

If the browser/Electron runtime cannot decode the original image, it may fall back to
the existing thumbnail loader. This is particularly important for formats with uneven
native runtime support.

### Video

Video uses the shared HTML media renderer and the generic preview URL.

A decode/playback error must fall back to the consumer-provided fallback state rather
than creating a video-specific transport path.

If a format eventually requires transcoding, expose a derived preview resource through
the Preview Engine source model; do not recreate a Gallery-only playback API.

### Audio

Audio uses the shared HTML media renderer and the generic preview URL.

Unsupported-codec behavior follows the same rule as video: improve the Preview Engine
or provide a derived resource instead of adding a parallel transport.

### PDF

PDF uses the shared PDF renderer over the generic signed preview URL.

Desktop PDF access remains restricted to the loopback preview proxy.

## Gallery boundary

The Preview Engine owns ordinary file presentation, not photo-library semantics.

The following remain Gallery responsibilities:

- Live Photo relation and motion playback for paired standalone still/video files
- EXIF
- GPS/location semantics
- Favorite
- Tags
- People
- Albums/collections
- media descriptions and other media-domain metadata

Live Photo motion is intentionally separate from ordinary video preview because it is a
semantic resource associated with a logical photo asset.

### Live Photo interaction

Gallery should present a Live Photo as one visual surface rather than a still image plus
a second standalone video player.

The interaction contract is:

- show the still image by default;
- do not request the motion resource merely because the preview surface mounted;
- the first press-and-hold resolves one motion source; if the user keeps holding, playback
  begins as soon as the video element has buffered enough data rather than waiting for the
  complete motion payload; releasing before playback prevents autoplay and reuses the
  already-resolved source while the preview remains open;
- when the transport exposes a positive total byte count, render a determinate circular
  download indicator from actual received bytes; otherwise render indeterminate progress
  and never fabricate a percentage;
- Web resolves a short-lived signed motion URL and gives that URL directly to the native
  `<video>` element. The browser owns Range/buffering and may start playback as soon as
  enough data is available; Web must not materialize the complete motion as Blob/ArrayBuffer.
  Browser media fetches do not expose reliable received-byte totals to page JavaScript, so
  Web renders indeterminate loading unless a future transport can report real bytes. Desktop
  progress remains derived from the existing protected loopback Range proxy; overlapping
  ranges count unique covered bytes only. Neither platform may introduce extra Range fan-out
  or smaller network chunks solely for UI progress, and renderer/IPC notifications must be
  throttled;
- press-and-hold on mouse or touch starts motion in the same frame once ready;
- releasing, cancelling, leaving the pressed surface, or losing focus stops playback
  and returns to the still image;
- keyboard Enter/Space provides the same hold/release behavior;
- ordinary video controls are not shown;
- audio capability is preserved instead of forcing the motion resource muted;
- the still image remains visible when motion loading or decoding fails;
- presentation follows the native Live Photo model: the still is the primary surface,
  a subtle Live Photo glyph marks the capability, press-and-hold anywhere on the still
  plays motion, and releasing returns immediately to the still.
  The glyph is the canonical SF Symbols `livephoto` geometry rendered by the shared
  `XDriveLivePhotoGlyph`; FileExplorer thumbnails use the same geometry at the compact
  10px glyph / 14px badge scale instead of drawing a separate approximation.
- FileExplorer thumbnail blob URLs are leased while rendered. LRU eviction may retire a
  cached URL, but must not revoke it until the final mounted consumer releases the lease;
  otherwise a successfully generated thumbnail can turn into a browser broken-image.
  Genuine decode/transport failures keep the existing failure semantics and are not hidden
  behind a new `img onError` fallback. Do not present a generic
  play button or a persistent instructional pill over an idle Live Photo.

Do not migrate inferred/grouped Live Photo semantics into FileExplorer.

A structurally validated `.livp` is the deliberate exception because the single
container itself is reliable still/motion pairing evidence. Its embedded Apple content
identifier is supplemental integrity evidence: when both members provide identifiers
they must match, but a missing identifier does not invalidate an otherwise valid LIVP.
Provider comments, filenames, and timestamps must not be used to infer a relation between
separate filesystem nodes.

FileExplorer may classify that one file as `live_photo`. Open/Quick Look/Inspector first
request a short-lived, revision-fenced signed URL for the embedded still byte range and feed
that URL to the same image renderer used by the Preview Engine. If the runtime cannot decode
the embedded format (for example HEIC in a browser without HEIC support), the existing 512px
derived thumbnail is the fallback; list/grid/Recent/Favorites continue to use the bounded
thumbnail scheduler rather than loading original still bytes.

The signed LIVP still source uses the same safety model as motion: owner/session/node revision
plus a resource fingerprint containing parent SHA and validated byte offset/size, with
GET/HEAD + Range support. Desktop hides the upstream still ticket behind the existing
loopback-only preview proxy; Web uses the signed same-origin URL directly.

The existing `XDriveLivePhotoSurface` overlays motion on that still. The static Live Photo
badge is shown only after a real still image is available; a generic fallback icon must never
be decorated as though motion preview were ready. This is file-format
presentation, not Gallery grouping. Do not infer standalone JPG/HEIC + MOV relationships
inside FileExplorer.

Gallery consumes the same `live_still` source for a single-file `.livp`, so FileExplorer
and Gallery do not diverge in still quality or decode fallback. Reliably paired standalone
JPG/HEIC + MOV Live Photos keep their Gallery relation semantics and use the ordinary still
image Preview Engine source plus the paired motion resource.


The LIVP derived-resource contract is versioned. Parser-contract changes must bump that
version so already-indexed unsupported/error LIVP rows are automatically re-indexed; users
must not have to re-upload the original file after a compatibility fix.

Web and Desktop both use the signed Live Photo motion ticket. Web passes the same-origin
signed URL directly to the browser media element so HTTP Range and buffering remain native;
it never converts the complete motion response into a renderer Blob. Desktop uses the same
protected loopback stream architecture as ordinary video preview. xdrive-agent obtains only
a signed motion ticket; it does not read or buffer the motion payload. Electron main hides the signed upstream URL behind the
existing loopback-only preview proxy, forwards GET/HEAD and Range headers, and streams the
upstream 200/206 response directly to the video element. The renderer receives only the
local URL, never a complete motion `ArrayBuffer` or base64 payload.

The signed motion ticket is revision-fenced twice: it binds the still node revision and a
motion-resource fingerprint. Embedded `.livp` fingerprints include the parent SHA and
validated byte offset/size; standalone Live Photo fingerprints include the paired motion
node id, revision, and SHA. A changed container range, overwritten motion file, or changed
pair therefore makes the old ticket stale.

The loopback proxy may report throttled progress from bytes it actually forwards. Because
media elements can issue overlapping Range requests, progress must be based on the union of
covered byte intervals rather than the sum of response lengths. Closing/replacing the
preview disposes the local motion URL, removes the progress listener, invalidates the local
proxy token, and aborts any in-flight Range request.

## FileExplorer boundary

FileExplorer Inspector owns file-management context such as file identity, path,
timestamps, size, operations, and properties.

It may embed `FilePreviewSurface`, but must not acquire Gallery-only media semantics
to make preview work.

### Open Preview dialog

The Preview Engine owns rendering, not the platform meaning of ordinary **Open**.

- Web FileExplorer ordinary Open dispatches through the **Web App Resolver**. Images/video/Live Photo open `media-viewer`, text/source/config opens `text-viewer`, PDF opens `pdf-viewer`, and audio opens `audio-player`.
- Desktop FileExplorer ordinary file Open uses the **OS default application**. Directories remain inside xDrive FileExplorer. `Open With…` stays a separate native action.
- Web `preview` and Desktop Quick Look are explicit preview surfaces and continue to reuse the shared Preview Engine.
- Gallery media viewing continues to reuse the shared Preview Engine while keeping Gallery-only semantics outside it.

`XDriveOpenPreviewDialog` remains the shared overlay shell where an overlay presentation is appropriate. Route-level Web viewer apps may provide their own app chrome, but their content still reuses:

- `FilePreviewSurface` for ordinary text/PDF/image/video/audio preview;
- `FilePreviewSurface` + `LivePhotoSurface` for a validated single-file `.livp`;
- `LivePhotoSurface` wrapping a `FilePreviewSurface` still image for Gallery Live Photo.

The ordinary image renderer may opt into shared zoom/pan interaction. Zoom/pan is
presentation state only: it does not change preview identity, request another source
contract, or persist an edited image.

Explicit Download remains a separate file-management action. Web Open must not silently
download an unsupported file, and Desktop Open must not download before handing the managed
path to the OS default application.

Gallery keeps media information, EXIF/GPS, Favorite/Tags/People/albums, and Live Photo
motion semantics outside the ordinary Preview Engine. The accepted Gallery contract
opens active, permitted media on an ordinary single click/tap; explicit selection mode
and modifier keys continue selecting. Trash remains Properties-only and must not open
Viewer or fetch original/Live motion resources. The existing Info icon is labeled
**属性**, and opening Properties must retain the Viewer without mounting another media
player. [PR #1071](https://github.com/lazyxu/xdrive/pull/1071), merged on 2026-10-09,
delivers desktop single-click and in-Viewer Properties after the audit's fixed baseline;
touch single-tap was already delivered. FileExplorer media Properties integration is
a separate follow-up. These Gallery activation rules do not replace FileExplorer's
normal file selection/open behavior. Viewer actions such as Favorite, Properties,
Download, Share, Delete, and its bounded filmstrip therefore live in the shared
Gallery layer, even though Viewer
embeds the generic preview shell and renderer.

Double-clicking a Gallery media
tile opens the media preview through the first permitted click; the second click is
ignored so it does not reopen Viewer or show Properties. The active-media and Trash
boundaries above still apply.

### Quick Look

FileExplorer may expose a Finder-style Quick Look overlay, but the overlay is only
another presentation of the shared Preview Engine. It must reuse `FilePreviewSurface`
and the same text/thumbnail/signed-preview loaders already used by Inspector.

The shared interaction contract is:

- `Space` opens Quick Look for the active file and `Space` or `Escape` closes the overlay;
- when Quick Look opens from a multi-selection, it freezes the selected **file** IDs in current
  result order and `Left` / `Right` browse only that frozen session; navigation must not
  collapse or rewrite the user's selection;
- a single-file Quick Look keeps Finder-style result browsing: `Left` / `Right` move between
  file entries in the current result set and may advance the active single selection;
- the shared image renderer enables zoom/pan in Quick Look; this is transient presentation state
  and never writes an edit recipe;
- Quick Look exposes the shared preview shell's fullscreen mode. Fullscreen uses immersive
  auto-hiding chrome, and `Escape` exits fullscreen before it closes Quick Look;
- fullscreen Quick Look may run a lightweight slideshow over the same current Quick Look session;
  the slideshow advances through the existing Previous/Next contract and stops at the end rather
  than materializing a second media collection;
- Quick Look actions stay deliberately small: platform-provided system-open when available,
  Download/Save As, Share, and Tags. Destructive actions and media editing controls are excluded;
- `Ctrl/Cmd + Space` preserves the existing keyboard selection-toggle behavior;
- directories keep Space selection behavior rather than acquiring a fake media preview;
- a focused Live Photo owns `Space`/Enter press-and-hold and stops those keys from bubbling to
  the Quick Look close handler.

Quick Look must not add a second preview endpoint, app-local renderer, inferred Gallery
pairing semantics, or provider-specific media behavior. Validated `.livp` Quick Look
reuses the same thumbnail + motion sources and shared `LivePhotoSurface` as Open/Inspector.
Markup, PDF signing, image editing, and audio/video trimming remain outside FileExplorer Quick Look.

## Format-extension rule

When adding a new ordinary preview format:

1. Extend the shared classifier only if the file should semantically be previewable.
2. Decide whether the original bytes are safe and useful for browser/Electron decode.
3. If yes, extend the Server preview allowlist with a fixed MIME contract.
4. If no, use a safe derived thumbnail/transcode resource.
5. Reuse `FilePreviewSurface`; do not add an app-local renderer.
6. Add Web/Desktop and security regression coverage.

A file being recognized as image/video/audio metadata does not automatically mean its
raw original must be browser-previewable.

The shared classifier must therefore use the same safe extension allowlist as the
Server ticket issuer for binary preview. MIME metadata may refine presentation, but it
must not make an otherwise non-allowlisted original previewable. In particular,
`image/svg+xml` must not turn an SVG file into an ordinary Image Preview.

## Non-destructive media edit transforms

Gallery basic editing is a presentation layer over the ordinary Preview Engine, not a
second preview backend.

The durable recipe belongs to Gallery/PhotoAsset semantics. The ordinary preview
source remains the same signed original/allowed binary stream:

- `FilePreviewSurface` accepts an optional generic media-transform presentation;
- image transforms are rendered by the shared canvas renderer from the existing image
  preview source;
- video trim/rotate/flip uses the existing Range-capable video preview source;
- Web and Desktop must use the same transform renderer from `ui/shared`;
- FileExplorer is not required to expose Gallery edit controls, but it must not gain a
  separate edited-media renderer.

A recipe must be bound to current source identity (node id/revision/SHA-256) and must
not apply after source replacement. Saving/resetting the recipe must not modify the
original File, CAS content, SourceItem, PhotoResource identity, EXIF/GPS, Favorite,
Tags, People, Description, or album membership.

The first editing phase does not create edited binary caches or a second download
contract. Explicit Download remains the original file. Any future edited export must
consume the same recipe behind a derivative-renderer boundary; video export must not
make FFmpeg a dependency of the main CGO-free/distroless Server.

## Non-goals

The Preview Engine does not own:

- file download
- public-share download
- media indexing
- EXIF extraction
- Live Photo pairing
- album membership
- Source synchronization
- arbitrary document execution or active-content rendering

## Regression requirements

Changes to Preview Engine behavior should preserve tests covering:

- shared classification
- shared renderer ownership
- signed ticket issuance
- Range/206
- stale revision rejection
- unsafe-format rejection
- Web and Desktop adapters
- Desktop loopback proxy credential isolation
- Gallery ordinary-media use of `FilePreviewSurface`
- absence of legacy media-specific playback paths


## Web Preview App 边界

Web 的 `preview`、`media-viewer`、`pdf-viewer`、`audio-player` 都是 Preview Engine 的程序级入口，**不是新的渲染引擎**。它们继续复用 `FilePreviewSurface`、Live Photo surface、preview ticket、thumbnail 与媒体 transform 能力。

- Web `preview` 对应 Quick Look 语义：Space/Esc 返回、←/→ 在启动 context 中切换，多选 context 保持冻结顺序，全屏可播放 5 秒幻灯片。
- `media-viewer` 只处理图片、视频与 Live Photo；来自 Gallery 的 context 可以追加 Favorite / Info / Albums 等图库语义。
- `text-viewer` 第一版使用只读 textarea；共享文本预览上限为 **1 MiB**，超过时明确显示 truncated 提示。
- PDF/Audio Viewer 继续使用 Server signed preview ticket，不创建第二套下载/stream transport。
- Viewer 只把 canonical node ID 和短 context session ID 放到 URL；目录/Search/Gallery 大集合通过 range contract 与 sessionStorage 恢复。
- Viewer 作为覆盖层保持调用方 workspace 挂载，因此关闭/浏览器 Back 后应恢复原 Files/Gallery 状态。

路由和 App Registry 的规范见 `docs/web-app-runtime.md`。


### Touch image gestures

交互式图片预览在 coarse pointer 设备上使用原生触屏手势：双指 pinch 在 1×–6× 范围缩放，双击在 1× / 2× 间切换，放大后单指 pan；仅在约 1× 时，水平位移至少 56 CSS px 且明显大于垂直位移才触发可选的上一项/下一项 swipe。触屏时不显示桌面缩放按钮，鼠标滚轮、双击和拖动 pan 契约保持不变。

视频、音频、PDF 和 Live Photo 不进入这套图片 swipe 状态机。特别是 Live Photo 仍由按住/松开控制 motion，避免与横向浏览手势争抢。


### Viewer navigation scope

Viewer navigation is capability-scoped rather than a property of every file viewer.

- **Quick Look / Preview** may move across the current file browsing context because its purpose is rapid sequential inspection.
- **Media Viewer** may move across the current image/video/Live Photo browsing context and may expose swipe, previous/next controls, position, filmstrip, or slideshow semantics.
- **Text Viewer, PDF Viewer, and Audio Player** are standalone file programs. They do not inherit directory/gallery browse context and do not show previous/next navigation merely because the file was opened from a list.
- Previous/next controls appear only when at least one direction is available. A standalone viewer must not render an otherwise disabled arrow pair; the same rule applies to the shared overlay shell, Web frame, and mobile action rail.
- A viewer must not fetch neighboring ranges unless it actually exposes navigation.

### Shared media viewer content

Web and Desktop/Gallery media viewing share `XDriveMediaViewerContent`. That layer owns the semantic composition of an opened `MediaItem`: confirmed Live Photo pairing, thumbnail/original preview loaders, saved edit recipes, media fallback, and image swipe hooks. Platform shells may provide different chrome and adapters, but they must not fork media interpretation.


### Media readiness and lifecycle

For video, audio, and PDF, obtaining a signed preview URL is not the same as presenting usable content.

- Video remains busy until the browser has decoded initial media data; later `waiting` transitions are busy again until `canplay` / `playing`.
- Audio remains busy until metadata is available and re-enters busy while buffering.
- PDF remains busy until the iframe load event. URL-ticket and iframe failures use the same shared fallback contract.
- Media elements are keyed by node identity, revision, and preview URL so stale readiness events cannot promote a newer target.
- Live Photo motion ownership is keyed by media identity/revision. Re-rendering the same media with a new loader callback must not discard an already acquired motion source; identity changes and unmounts must dispose owned sources, including late arrivals.


### Mounted Web Viewer metadata session

`useViewerNode` scopes displayed/preloaded candidates to the mounted Viewer,
API/account instance, Gallery source, and browse-context identity. Each active item
gets a fresh `createXDriveWebViewerSession` reader: current/previous/next share pending
and resolved 128-item pages within that step. Retain at most **three pages (384
items)**; selection/fallback Node and MediaItem maps each retain at most **32 entries**.
Rejected reads are evicted for retry. Navigation reuses the selected candidate for
immediate presentation while refreshing the new active range; range pages never
carry across active-item steps. Closing/replacing the session releases the caches.
URL sessionStorage remains browse-context state, not a media cache.

A matching Gallery candidate supplies both its Node and MediaItem. A direct media
link uses the authoritative Node within `api.mediaItem`, avoiding an extra Node
request. Selection and ordinary file contexts use their existing Node contracts.
Current metadata must match the requested node ID and any known revision/SHA;
route/session replacement must immediately hide prior content and ignore late
prior-session completion. The current page supplies total count even without neighbors.
Unresolved neighbor scans are distinct from a completed end-of-context result.

Mutation patches use the captured item's source identity and merge only the changed
Favorite/Tags/People/Description/edit-recipe fields into the latest matching item.
Independent successful patches must preserve one another. A late older-revision or
conflicting same-revision source must not replace current metadata. Explicit
invalidation drops affected metadata and re-reads it; no whole-collection cache is added.

The canonical workload, acceptance thresholds and measured request-replay evidence
are in [Gallery performance](gallery-performance.md#viewer-context-metadata-reuse--2026-10-09).
Those controlled-delay numbers are not real Server/browser end-to-end timings.

### Shared presentation and slideshow dwell

`onPresentationStateChange` reports **loading / ready / failed** for the current
source. Source replacement starts loading and stale callbacks cannot promote the new
source. Images become ready only after usable original or fallback-thumbnail pixels
are decoded; an original still loading must not hide an already usable thumbnail.
Video/audio/PDF use the renderer readiness and failure events described above.
Unsupported or exhausted sources report failed and retain the shared fallback.
Live Photo still readiness does not eagerly acquire motion; hold/release and source
cleanup keep their existing contract.

Desktop fullscreen Quick Look and Web Preview use the same slideshow controller.
Each new source receives **five seconds of effective dwell**, counted only while
presentation is ready and the document is visible. Loading/buffering, a hidden page,
or an unresolved Web neighbor scan suspends the timer and preserves remaining dwell.
Once the same source is ready/visible again, resume that remainder; a new source gets
a full interval. User pause ends that play session. Failure or a confirmed end of
context stops playback. Callback recreation and ordinary parent rerenders must not
restart the interval. A completed dwell dispatches Next once; visibility or buffering
changes must not dispatch it again while asynchronous navigation is pending.
This does not add a persistent queue/resume feature or a new
Gallery collection.

### Capture-time labeling and bounded image interaction

Web Media Viewer and shared Gallery Viewer format the same canonical
`metadata.captured_at` value as **拍摄时间**. Missing or invalid capture time shows
**拍摄时间：未记录**; file modification/import timestamps must not impersonate capture
time.

Interactive image zoom keeps the image point under the wheel cursor or double-click/
double-tap position anchored while scale changes. Pinch preserves its image anchor
under the moving two-finger midpoint. Zoom remains **1×–6×**. Pan clamps against the
fitted, decoded visible image dimensions, including crop/rotation output, rather than
the letterboxed element rectangle. An axis whose scaled content fits the viewport
stays centered. Fit/reset returns to 1× with zero offset; decoded dimensions and
viewport resize/orientation changes re-clamp the current viewport. These are shared
presentation transforms and do not change preview source identity or durable recipes.

### Standalone text and compact Viewer chrome

All Mobile Web programs own the entire available dynamic viewport, with no global
AppBar/bottom-navigation reservation. A Viewer must keep that full-screen frame and
Return action during metadata loading and error/unsupported states, not render an
unframed status message under the inert caller. Compact immersive Web headers/actions
overlay media; hiding chrome cannot retain blank header height. Text/PDF/Audio may
reserve space for their own reading controls inside the full-screen app. Follow the
normative [Mobile Web contract](mobile-web.md); app/main bounds must be checked
against the full viewport, not the space remaining between global bars.

Text line/column jumps clamp to the requested line and exclude the CR in CRLF text;
they must not select characters from the next line. Text/PDF/Audio remain standalone
programs with their own loading/error states and no directory/Gallery neighbor reads.
On compact coarse-pointer Web layouts, their available actions use the same bottom
rail as media Viewer with **44 CSS px** targets and safe-area padding. Text remains
read-only and uses **16 CSS px** on compact touch layouts; desktop keeps its existing
text size. Compact Viewer sizing follows the dynamic viewport without replacing the
mounted caller workspace. Native phone/browser acceptance remains a separate gate.
