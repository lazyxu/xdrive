# Places Map — photo-first UI convergence (2026-10-25)

## Why

The previous xDrive Places screenshot showed a narrow map buried beneath a desktop-style status
panel: permanent SDK-mode choices, GPS audit text, separate nearby controls and a full filter
row. That is not the iOS Photos map's photo-first interaction model. This pass changes the
**shared presentation**, not the Owner Range, Baidu provider, authorization, or isolation model.

Reference: Apple iPhone user guide, iOS 27, “Browse photos and videos by location on iPhone”.
The expected flow is **open map → pan/zoom → tap a photo thumbnail → inspect photos at that
location → Viewer → return to the same camera/selection**. Only media carrying GPS belongs
on the map.

## Shared UI decisions

| Surface | Before | This phase | Remaining |
| --- | --- | --- | --- |
| First screen | Instructions, mode buttons, diagnostics, six filters before map | One 52px compact toolbar; photo map is first large content surface | Desktop duplicate Places heading removed; compare pixel geometry |
| Runtime choice | Permanent "same-page prototype / safe isolated" buttons | Existing controls under More, **always-visible compact “同页 · 未隔离” / “安全隔离” status next to title**; no invisible downgrade | Choose long-term safe default after parity verification |
| Filters | Always visible, displacing map | Native keyboard-operable collapsible overlay; active filter label | Dismiss-on-outside and screen-reader/pointer focus acceptance |
| GPS/nearby | Audit and location form inline | Existing controls retained inside More, audit remains opt-in | Contextual "Nearby photos" action on selected location |
| Map viewport | Constrained map surrounded by admin UI | Responsive viewport-driven larger map, up to 1400px | Responsive screenshot/landscape/safe-area tuning |
| Photo clusters | 60px Parent-rendered cover on top of anonymous SDK numbers | 64/72px authenticated photo covers with more spacing | Investigate missing/unloaded covers and ensure fallback never looks like a generic map pin |
| Current camera | Count and "all photos" button outside map | Floating count and view-camera-wall action inside map | Browser geometry and accessible focus checks |
| Selected cell photo preview | Clicking a region left the map immediately | Trusted Parent photo sheet reads up to 12 current Owner Cell members, can expand/collapse and view all | Real-browser interaction and image decode checks |
| Viewer from selected photo | Map cluster had no per-photo Viewer action | Thumbnail revalidates Node ID/revision through a **second fresh** Owner `/cell-items` Range before Viewer | Real multi-photo Viewer/Back/restore smoke |
| Viewer map return | No selected-cell drawer hint | One-shot account-local return hint, including bounded expansion and scroll offsets; applied only after a fresh matching Owner `/cells` and `/cell-items` result | Actual iOS gestures, camera resizing and browser recreation |
| Photo strip | Existing Parent-owned horizontal 10-cover strip | Wider, retained same Owner cell identity and revision | Selection highlight, swipe expansion, time grouping and smooth Viewer/back restoration |

## Do not duplicate

- **Two SDK Hosts** remain an implementation detail. Both continue to render the same
  `XDriveMediaGalleryBaiduIsolatedPhotoSurface` and `XDriveMediaGalleryPlacesMap`.
  The Host selection changes SDK location only, not the gallery controller.
- Existing signed release/Owner/camera/BD-09 consent fences remain intact.
- The HTTPS Child never receives JWT, album filters, precise original WGS84, thumbnails or
  photo IDs. All photo covers stay in the trusted React Parent.
- Photo wall, pagination, Viewer, thumbnail transport, and cancellation remain the existing
  Gallery contract; no new Map-specific media reader.
- Desktop `file:` renderer still opens the existing HTTPS window for dynamic map rather
  than directly injecting provider scripts.

## Remaining ordered work (do not label as completed)

1. **P0 camera/photo cover fidelity**: verify projected-cover callbacks and actual thumbnail
   availability. Render meaningful photo tiles and count badges across zoom levels without
   crowding; provide a privacy-safe fallback when thumbnails cannot load.
2. **P0 map-to-photo drawer browser acceptance**: the shared trusted sheet now displays up
   to twelve Server-verified thumbnails in either SDK Host, supports expanding, closing and
   opening the complete existing Cell wall. Verify touch/keyboard behavior and no stale
   cover after revoke, rapid drag, filter changes or provider session refresh. It deliberately
   does NOT manufacture client-side album membership or paginate full photo libraries.
3. **P0 Viewer and return evidence**: a chosen preview is re-fetched by the original Gallery
   Page's Owner `/cell-items` route (including Node revision and exact count) before opening
   the existing Viewer. The return hint is one-shot, ten minutes, bounded and accepted only
   after a new matching authenticated `/cells` response and photo Range. Expansion and
   integer-clamped scroll coordinates (0–10,000 px) remain in memory only; the drawer
   restores them after new verified photo items render. The existing dual-Host Chromium
   harness now exercises actual React drawer selection, a second Owner Range, and Viewer
   return/remount for both map Hosts. The genuine physical CAS Gallery Viewer fixture,
   newly merged on master, remains intact and is exercised separately in that harness.
   Real iOS gestures, scrolled visual pixel evidence and device/100k performance remain pending.
4. **P0 both hosts identical**: same surface and response for inline/isolated, except the
   provider execution boundary; e2e tests must exercise both.
5. **P1 mobile/desktop polish**: iOS 27 safe areas, 44px touch targets, map-overlaid minimal
   controls, dark/light maps, landscape, reduced motion, keyboard and VoiceOver.
6. **P1 scale**: 10k/100k owner-limited Count, sparse thumbnail/Abort cancellation,
   no raw full-library map points or provider SDK media access.

## Evidence and limits

This branch now includes a shared Parent-only drawer, a current-Owner bounded preview,
a second authorized Viewer entry Range, one-shot restored drawer intent and a targeted
TypeScript/Node contract test (`desktop/tests/gallery-places-ios27-photo-drawer.cjs`).
The UI is a **code candidate**, not a verified browser or iOS 27 behavior claim.
Runtime Chromium, real dynamic maps, iOS 27 pixel comparisons, screen reader and
10k/100k perf still require independent evidence. The existing #2587 dual Host Browser
PR is separate; do not report its pending results as passing this new drawer path.

Production-only acceptance not accessible to the assistant: **按用户决定跳过（未验收）**.
This does not waive code-level Owner/Consent/revision/CSP/HTTPS isolation tests and
does not block further development.
