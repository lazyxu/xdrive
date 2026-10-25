# Gallery Viewer → Places Map: signed range return (2026-10-25)

## Confirmed gap

`XDriveMediaGalleryViewer.onOpenDynamicMap` calls the Page's existing
`showMapFromCurrentGallery`. A Viewer opened from a signed BD-09
`baidu-cell` or `baidu-viewport` Gallery virtual wall is not an
ordinary `all` or `album` collection. The previous entry guard rejected
it, preventing the expected iOS-style Viewer → Map return.

## Minimal shared fix

Web and Mobile Web use the same `XDriveMediaGalleryPage` controller. For
the two authenticated map wall target kinds only, the Viewer map action now
calls the already present `leaveBaiduCellWall()`. This cancels the old
Owner Cell operation, clears its Viewer/viewport return hints, drops the
virtual wall and returns to the existing Places map. That map performs a
fresh signed `/cells` Owner/Consent check; it cannot reuse stale photos
or turn a private Cell into the unrestricted Gallery.

Ordinary Gallery/Album map entry still uses the original
`xDriveGalleryMapEntryScope` fail-closed filter checks and
one-use map return scope. Desktop Electron's `file:` renderer continues
its independently authenticated HTTPS map-window path, not a new in-file
Baidu SDK mount. No media API, SDK Host, photo identity, permission or
third-party network changes.

## Evidence and limits

Source regression checks verify ordering, the original Viewer action,
the map return's Abort/clear/virtual reset, unchanged Album guard and
Desktop boundary. No iOS 27 device screenshot/VoiceOver or genuinely
mounted Chromium Viewer action was run for this incremental commit yet.
When integrated with both SDK Hosts, additionally check signed Wall →
Viewer Info → Map → fresh Cell selection/Viewer → Back and revoked Owner
failure (never fallback to ordinary Gallery) on 375/390 and wide Web.

Production-only inaccessible security acceptance is **按用户决定跳过（未验收）**.
Code Owner/Consent/Origin/CSP and controlled CI remain mandatory.
