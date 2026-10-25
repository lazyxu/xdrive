# Owner-scoped camera Nearby: shared Photo Map UX (2026-10-25)

Apple iOS 27 map guidance includes “Show Nearby Photos” after photo location
selection: https://support.apple.com/en-nz/guide/iphone/iph390138909/27/ios/27

## Scope

This increment adds the contextual action in the already verified trusted
Parent `XDriveMediaGalleryPlacesPhotoDrawer`. It **does not** invent a
radius, use unsigned WGS84/BD-09 coordinates, call the old nearby query or
create another media reader. It reuses the existing **current camera viewport**
action (`onOpenViewport`) and the same Owner/Consent/filter/album
and Server signed `/viewport-items` Range as “查看此地图的全部照片”.

The label's accessible description explicitly states the scope is the
**current map view**. This is a viewport-relative nearby action, not a
fixed-distance circular search and not a replacement for the dedicated
WGS84 proximity API. For an unverified worldwide bootstrap, missing camera,
stale filter, lost Owner Scope or unavailable viewport opener, the callback
does nothing and the sheet button is absent. There is no fallback to
unscoped Gallery or the legacy `nearby` filter.

## Reuse and CI

Both inline and independent HTTPS Child use the same single trusted Parent
`XDriveMediaGalleryBaiduIsolatedPhotoSurface` and Drawer. Only the SDK
mount differs. The Child receives no Owner IDs, original GPS, JWT,
thumbnails, photos, Preview URL or Range responses.

The Node contract checks that the two visible camera entry points share a
single fail-closed handler. The mounted full Gallery Page Chromium smoke
exercises Drawer → Nearby → signed Camera Range → virtual Wall → Back
in both SDK Hosts, including true Gin/PostgreSQL17 when enabled.
No new Server contract or authorization surface.

## Out of scope

Pixel-identical Apple Maps tiles are not possible with Baidu; 390px screenshot,
actual iOS Safari/VoiceOver gesture, HEIC/Live/Poster and 10k/100k weak
network tests remain independent evidence gaps. Production-only inaccessible
acceptance: 按用户决定跳过（未验收）. Code-level Owner/Consent/Origin/CSP
and CI are mandatory.
