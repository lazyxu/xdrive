# xDrive Places Map — dual Host / iOS 27 MVP audit (2026-10-25)

## Target and necessary differences

The iOS 27 Photos Map reference is Apple's iPhone User Guide:
https://support.apple.com/en-ie/guide/iphone/iph390138909/27/ios/27
It documents Library → Sort and Filter → Show Map, collection → More → Show
Map, pinch/drag, GPS-only photos, tap thumbnail → location photos and
photo Info → Map → nearby photos.

Baidu map tiles, attribution and location data are a **provider exception** to
1:1 Apple pixels. Keep xDrive's agreed 52px Mobile Web app header.

## One product and one trusted Parent, with two SDK environments

Both inline and isolated HTTPS Child must use the same
`XDriveMediaGalleryPlacesMap`, `XDriveMediaGalleryBaiduIsolatedPhotoSurface`,
`XDriveMediaGalleryPlacesPhotoDrawer` and existing virtual Gallery Wall/Viewer.
`commonMapOptions`, signed BD-09 Owner `/cells` and `/cell-items`, selected
Cell, camera, Count, thumbnail, filter and return logic are shared.
Only the SDK mount changes: `xDriveMountBaiduInlineMap` vs
`xDriveMountBaiduIsolatedFrame`. The Child must never receive JWT,
original WGS84, album filters, photo identifiers, thumbnails or media URLs.

## Outstanding matrix

| Priority | Gap | Status / concrete next action |
| --- | --- | --- |
| P0 | Revoke, new Owner Count, Viewer hard reload & SPA History | #2616 Draft, exact-head CI still to verify; fail closed without unscoped fallback |
| P0 | Inline/isolated Gallery Page → selected Cell → drawer → Viewer → Back | Baseline merged #2587/#2596; add more failure/gesture/browser state combinations |
| P0 | Real cover loading, badge/collision placement, stale projection after pan/filter | Source-level safeguards; decoded imagery and pixel evidence still missing |
| P0 | Shared Filter/More menus: Parent click-away, isolated Child focus/camera, Escape, mutual exclusion | Implemented in this PR with mounted dual-Host regression; CI pending |
| P0 | Photo sheet: pointer drag, avoid duplicate click, keyboard/mouse activation | Implemented with dual-Host browser click/Enter; real iOS gesture evidence pending |
| P0 | Library/collection/Trips/Recent Days/photo Info entrances and exact Back | Partial map/show-map entry exists; full route matrix not verified |
| P0 | Selected-location nearby photos retaining signed Owner/album scope | Legacy nearby controls under More; contextual scoped action not yet added |
| P0 | Offline, no GPS, missing AK/ticket, CSP denied, revoked thumbnail failures | Partial fallback; exercise all explicit reason/retry states |
| P1 | iOS 375/390/899/900, safe area, landscape, light/dark, type scaling | No real iOS 27 screenshot/pixel acceptance evidence |
| P1 | Full-bleed controls, sheets, badge geometry, animation and reduced motion | UI partially iOS-like, not 1:1 verified |
| P1 | VoiceOver/keyboard focus and accessible map list, touch ≥44px | Some code checks; full acceptance missing |
| P1 | JPEG/HEIC/Live/video poster and metadata orientation | Physical media regression matrix not complete |
| P1 | Real controlled 10k/100k, first paint, P50/P95, memory, Abort→Go ctx.Done | No comparable measured BEFORE/AFTER results |
| P2 | Provider light/dark themes and tile typography | Provider-specific exception to Apple Maps visual identity |
| P2 | Physical iOS 27/Android/PWA/Desktop verification | No physical evidence claimed |

Never claim device-pixel 1:1 without matched genuine screenshots and interactive
tests. Production-only acceptance unavailable to the assistant remains:
**按用户决定跳过（未验收）**; source-level Owner/Consent/Origin/CSP,
revocation and CI are **not** skipped.

## Sequence

1. Finish #2616 and gate its current HEAD separately from this shared UI PR.
2. Run Web TS/Lint, desktop contracts and complete exact-commit CI for this PR.
3. Expand the existing genuine Chromium both-Host flow for shared menu dismissal,
   pointer drag, image decode, revoked/slow Owner reads and Photo Viewer return.
4. Compare real iOS27 375/390/899/900 screenshots/gestures and only fix shared
   Parent differences; quantify before optimizing 10k/100k performance.

## Unified 390px touch and safe-area continuation

The iOS 390px safe-area, touch grip, and physical Gin/PG Viewer proof from #2618 are now consolidated into the **same** trusted Parent map/drawer and dual-host Chromium runner as #2628. The older independent #2618 branch should not be merged over this combined component. Real short touch may be activated from pointerup when a browser omits a compatibility click; a subsequent compatibility click must not duplicate the second Owner Range. Real iOS Safari pixel/VoiceOver remain unverified.


## 2026-10-25 · P0 mobile invalid-contact compatibility-click fence

The real Chromium/Gin/PostgreSQL17 P0-17 at prior combined HEAD `bdb2cd96`
passed its shared Parent / inline and isolated HTTPS Child specialty. It proves
a true short touch opens one authorized Owner Cell Range and original Gallery
Viewer, not that native long-hold or cancelled contacts are safe.

This increment consumes the bounded follow-on compatibility click after
**any recognized touch termination** (including >700ms hold, >12px movement,
pointercancel or interrupted multi-touch) before it can reach `onOpenPhoto`.
Only a short, unmoved primary touch activates from pointerup. A fresh mouse
pointerdown clears the stale touch marker and keyboard detail=0 clicks retain
their existing activation. No synthetic DOM click, no new Owner/SDK API, no
private media/Location data in the Child.

The existing real 390×844 Chromium+Gin P0-17 browser flow now runs native
CDP long-hold, horizontal scroll/drag, and touchCancel negative cases on
**both** SDK Hosts before the successful short tap; each invalid gesture
must leave the authorized Owner Cell Range and Viewer open counters unchanged.
This is NOT real iOS Safari or VoiceOver acceptance. The former green specialty
does not validate the newly changed exact SHA: rerun real P0-17 and full
CI / Final Gate before Ready/Rebase Merge. Production-only unreachable safety
acceptance: **按用户决定跳过（未验收）**. Source-level Owner/Consent/Origin/CSP/
revocation isolation remains mandatory.

## 2026-10-27 · latest mainline gap classification (supersedes the dated status table above)

This is a **source audit and work sequence**, not a screenshot/physical-device acceptance claim. The earlier Oct 25 entries saying #2616 is draft, selected nearby is absent or 390px short-touch handling is not implemented are dated and no longer a trustworthy description of latest `master`.

| Priority | Current source reality | Still to complete / accept |
| --- | --- | --- |
| P0 | Inline and isolated HTTPS Child already mount the **same** `MediaGalleryBaiduIsolatedPhotoSurface`, signed Owner /cells /cell-items, thumbnail cover, photo drawer, virtual wall/Viewer, scoped filter + one-shot map-mode handoff. | #2762's filter-prepaint old-marker invalidation must pass CI and merge; real browser transitions under slow/failing/revoked Owner results; no duplicate Host implementation. |
| P0 | Per-photo Consent grant/revoke and production operator account-proof are **not runtime eligibility gates**. Automatic Owner GPS backlog planner/consumer and real Server-AK Geoconv are implemented. | Real newly indexed and legacy GPS conversion completion, missing BD-09 retry/backoff, quota/failure UI, all indexed photos correctly counted. No artificial account review or per-photo consent reintroduction. |
| P0 | Current shared Parent has map-first toolbar, cover clusters, camera Count, selected-location photo sheet and contextual `显示附近照片`, one-shot Owner range Viewer and return history. Mobile short-touch pointerup + compatibility-click dedup is coded. | Apple Photos Library / Collection / Trips / Recents / Info → Show Map entry/Back matrix, changing Owner/Album during Viewer/reload, decoded HEIC/Live/video covers, native iOS Safari gesture screenshot proof. |
| P1 | One 52px xDrive Mobile Header, safe-area-aware shared drawer, keyboard/Escape/click-away and 44px control implementations exist. | iOS 27 actual 375/390/899/900/landscape safe-area, pan/pinch/selection behavior, light/dark, reduced-motion, VoiceOver parity; avoid claiming pixel 1:1 before comparison. |
| P1 | Existing Owner bounds/cell-range/cancel hooks and specialized dual-Host Chromium P0-17 suite exist. | Controlled mixed real Postgres 10k/100k matched BEFORE/AFTER: first paint, actual decoded cover latency, SQL P50/P95, CPU/RSS, viewport Abort→Go ctx.Done, cross-platform coverage. |

**Rule:** The server should only attempt real Provider operations when configured and technically possible; the product must not add a separate human-verification flag. Ordinary Owner login, source revision, signed bounded Scope, Browser AK/SDK HTTPS Origin/CSP and real Provider failures remain mandatory execution checks. Production account evidence and inaccessible device security acceptance are permanently skipped as nonblocking **未验收**, not represented as passed.
