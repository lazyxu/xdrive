# xDrive Preview Engine

## Status

This document is the normative architecture contract for ordinary file preview across
xDrive Web and Desktop.

The Preview Engine is shared by FileExplorer and Gallery. Platform code may adapt
authentication and transport, but must not create a second ordinary-media preview
pipeline.

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

## Renderer behavior

### Image

The image renderer prefers the original signed preview URL.

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
- Web progress reporting observes its authenticated response stream. Desktop progress is
  derived from the existing video Range requests at the protected loopback proxy; overlapping
  ranges count unique covered bytes only. Neither platform may introduce extra range fan-out
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
  plays motion, and releasing returns immediately to the still. Do not present a generic
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

Desktop Live Photo motion uses the same protected loopback stream architecture as
ordinary video preview. xdrive-agent obtains only a signed motion ticket; it does not read
or buffer the motion payload. Electron main hides the signed upstream URL behind the
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

Ordinary file opening in Web/Desktop FileExplorer and ordinary image/video opening in Gallery
must use the shared `XDriveOpenPreviewDialog` presentation shell.

The shell owns common preview chrome and navigation only. It may optionally expose
fullscreen, immersive chrome auto-hide, and caller-provided action/footer slots, but
those slots do not transfer domain ownership into the Preview Engine. Its content must
remain:

- `FilePreviewSurface` for ordinary text/PDF/image/video/audio preview;
- `FilePreviewSurface` + `LivePhotoSurface` for a validated single-file `.livp`;
- `LivePhotoSurface` wrapping a `FilePreviewSurface` still image for Gallery Live Photo.

The ordinary image renderer may opt into shared zoom/pan interaction. Zoom/pan is
presentation state only: it does not change preview identity, request another source
contract, or persist an edited image. Gallery Viewer enables this mode; Inspector and
ordinary FileExplorer preview are unchanged unless they explicitly opt in.

Explicit Download remains a separate file-management action. Web/Desktop FileExplorer must
not treat double-click/Enter/open as an implicit download. Desktop may additionally expose
an explicit system-shell Open action, but it must not replace the shared preview semantics.

Gallery keeps media information, EXIF/GPS, Favorite/Tags/People/albums, and Live Photo
motion semantics outside the ordinary Preview Engine. Double-clicking a Gallery media
tile opens the media preview; opening media information remains a separate Gallery
interaction. Viewer actions such as Favorite, Info, Download, Share, Delete, and its
bounded filmstrip therefore live in the shared Gallery layer, even though Viewer
embeds the generic preview shell and renderer.

### Quick Look

FileExplorer may expose a Finder-style Quick Look overlay, but the overlay is only
another presentation of the shared Preview Engine. It must reuse `FilePreviewSurface`
and the same text/thumbnail/signed-preview loaders already used by Inspector.

The shared interaction contract is:

- `Space` opens Quick Look for the active file;
- `Space` or `Escape` closes the overlay;
- `Left` / `Right` move between file entries in the current result set;
- `Ctrl/Cmd + Space` preserves the existing keyboard selection-toggle behavior;
- directories keep Space selection behavior rather than acquiring a fake media preview.

Quick Look must not add a second preview endpoint, app-local renderer, inferred Gallery
pairing semantics, or provider-specific media behavior. Validated `.livp` Quick Look
reuses the same thumbnail + motion sources and shared `LivePhotoSurface` as Open/Inspector.

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
