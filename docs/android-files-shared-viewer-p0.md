# Android Files → native Gallery Viewer → Files · P0 (2026-10-27)

This scoped source increment reuses the **existing Android native GalleryPhotoViewer / Media3 GalleryVideoPlayer / Live Photo motion pipeline**, not a WebView or second media transport.

Current Owner Files Browse/Recent/Favorites/Search media items are first verified through authenticated `GET /api/v1/media/items/{nodeId}`. Exact ID, parent, name, type, revision and size must still match the opened Files node. Media kind, thumbnail status and Live flag are server authoritative. Unknown/non-media files keep the existing Files details/text preview.

A single current, validated media item is mounted as a transient Gallery Viewer presentation; **this does not represent or fetch a Gallery search result or a synthetic full Gallery Range**, and no adjacent Gallery photographs are fabricated. Viewer Back closes its media resources and returns directly to the original Files section, loaded rows and saveable list/grid scroll state without another folder GET. Logout/route/Owner changes fence in-flight detail responses via the existing generation mechanism. No token or private media content is persisted in a new cache.

Tests added: real bounded Core MockWebServer Bearer/detail revision and kind rejection, Controller JVM image/Media3/back/late logout, and API35 Compose Files → Viewer → Files.

**Validation pending.** Android Core/JVM, Lint, APK, API35 Compose and actual repository CI protections must pass on the exact PR source before merge. Physical hardware/OEM and iOS PWA pixel match = **跳过（未验收）**, not falsely passed. PDF/audio, Files context actions and true Gallery Range swipes remain independent work.
