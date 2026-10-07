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
- the first press-and-hold starts one motion request; if the user keeps holding, playback
  begins as soon as the motion resource is ready; releasing during the request prevents
  autoplay but does not start a second duplicate request on the next hold;
- when the transport exposes a positive total byte count, render a determinate circular
  download indicator from actual received bytes; otherwise render indeterminate progress
  and never fabricate a percentage;
- Web and Desktop progress reporting must observe the existing continuous byte stream.
  It must not introduce range fan-out or smaller network chunks solely for UI progress,
  and renderer/IPC progress notifications must be throttled;
- press-and-hold on mouse or touch starts motion in the same frame once ready;
- releasing, cancelling, leaving the pressed surface, or losing focus stops playback
  and returns to the still image;
- keyboard Enter/Space provides the same hold/release behavior;
- ordinary video controls are not shown;
- audio capability is preserved instead of forcing the motion resource muted;
- the still image remains visible when motion loading or decoding fails.

Do not migrate inferred/grouped Live Photo semantics into FileExplorer.

A validated `.livp` is the deliberate exception because the still/motion relation is
self-contained and cryptographically tied to one original file/container. FileExplorer
may classify that one file as `live_photo`, use the existing media thumbnail for its
still frame, and render the existing `XDriveLivePhotoSurface` with the existing
owner-scoped motion endpoint. This is file-format presentation, not Gallery grouping.
Do not infer standalone JPG/HEIC + MOV relationships inside FileExplorer.

Desktop Live Photo motion transport must remain binary end-to-end. xdrive-agent may
buffer the bounded motion payload for the local Desktop IPC limit, but it must return
raw bytes; Electron transports those bytes as `ArrayBuffer`, and renderer surfaces create
a Blob URL. Do not base64-encode motion payloads in Agent IPC or renderer adapters.
Desktop may relay throttled byte-progress events while reading that same response stream;
those events are observational only and must not change the motion payload or request shape.

## FileExplorer boundary

FileExplorer Inspector owns file-management context such as file identity, path,
timestamps, size, operations, and properties.

It may embed `FilePreviewSurface`, but must not acquire Gallery-only media semantics
to make preview work.

### Open Preview dialog

Ordinary file opening in Web/Desktop FileExplorer and ordinary image/video opening in Gallery
must use the shared `XDriveOpenPreviewDialog` presentation shell.

The shell owns common preview chrome and navigation only. Its content must remain:

- `FilePreviewSurface` for ordinary text/PDF/image/video/audio preview;
- `FilePreviewSurface` + `LivePhotoSurface` for a validated single-file `.livp`;
- `LivePhotoSurface` wrapping a `FilePreviewSurface` still image for Gallery Live Photo.

Explicit Download remains a separate file-management action. Web/Desktop FileExplorer must
not treat double-click/Enter/open as an implicit download. Desktop may additionally expose
an explicit system-shell Open action, but it must not replace the shared preview semantics.

Gallery keeps media information, EXIF/GPS, Favorite/Tags/People/albums, and Live Photo
motion semantics outside the ordinary Preview Engine. Double-clicking a Gallery media
tile opens the media preview; opening MediaDetails remains a separate interaction.

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
