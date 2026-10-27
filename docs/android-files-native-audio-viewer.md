# Android Files native audio Viewer (2026-10-27)

## Source candidate
- Open one current authenticated Files Browse/Recent/Favorites/Search audio row in a full-screen, read-only Jetpack Compose audio Viewer with Media3 play/pause, seek and actual buffered playback time. Return restores the original loaded Files rows and scroll state.
- Revalidate the current Owner's complete Node ID, parent, filename, size, revision and type via `GET /api/v1/nodes/{id}` before creating a playback session.
- Reuse the same scoped, pinned OkHttp Media3 progressive Range session as Gallery video: exact URL, Bearer token, `If-Match` revision, strict 206 `Content-Range`/ETag; no remote redirects, public URL, second server writer or persistent media bytes.
- A new UI viewer epoch, per-attempt retry epoch and the existing Controller generation prevent overlapping noncooperative requests for the same media from replacing the latest session, and prevent late results from surviving exit, logout, connection switch or a new Files request. Dispose captures the **exact** active stream so retry/nulling the Compose state cannot leak an old Owner client; it releases Media3 first, then the session. The player pauses when the host Activity stops, without inventing durable background playback.
- Media3 setup failure shows real error + retry rather than a permanently disabled player; a partially allocated ExoPlayer is explicitly released. Real duration/seek/time and error-retry UI never claim bytes/sec or seek support when the native decoder cannot establish duration. Unsupported, unrevisioned or zero-byte files retain Files details. Gallery image/video/Live Photo and PDF paths are unchanged.
- Source-level Core MockWebServer tests exercise the real authenticated audio HTTP transport, revision mismatch and Range headers; Controller JVM and API35 Compose cover current Owner read-only playback, cancellation, file-row restoration and resource close.

## Verification
Draft candidate: Android Core/JVM, lint, Debug APK, API35 Compose, repository CI/final gate still required. Physical device codecs/OEM and iOS PWA pixel parity: **跳过（未验收）**, not passed. Do not lower Owner/TLS/source test checks.
