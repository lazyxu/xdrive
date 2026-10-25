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

## Post-merge 390px touch and safe-area follow-up

The original #2596 exact-head P0-17 Chromium/Gin and full Final Gate completed
successfully before merge. This follow-up changes **presentation only**,
without altering Owner/Consent/revision checks, independent HTTPS Child
boundary or the original shared Gallery Viewer.

- At 390px the trusted photo sheet, photo strip and floating count respect
  bottom and left/right safe-area insets. The sheet uses left+right anchors
  rather than mixing asymmetric safe-area offsets with a fixed width.
- Only the grip captures a touch pointer with `touch-action: none`.
  Predominantly vertical gestures over 36px expand/collapse; cancellation and
  nonprimary pointers are ignored. The photo grid retains native horizontal
  strip scrolling and vertical expanded scrolling. Separate 44px expand/close
  controls remain accessible to keyboard, mouse and VoiceOver.
- New real Chromium 390×844 touch tests exercise both Hosts, actual touch
  grip gestures, a distinct Gin Owner Cell Range, shared Viewer and freshly
  reauthorized drawer after Back. These must pass at this exact branch SHA.

Chromium does not establish physical iOS 27 Safari, pixel-perfect or VoiceOver
acceptance. Production-only inaccessible acceptance: 按用户决定跳过（未验收）.

### Exact-head CI triage: 390px Viewer Back and hostile SDK CDP startup

The first 390px genuine Gin/PG Chromium run completed 126 checks but attempted
the desktop-only "关闭预览" control on the immersive mobile Viewer. The
shipped shared `XDriveOpenPreviewDialog` uses the touch-visible "返回图库`
action at 390px. The test now taps that real accessible control and wakes
auto-hidden chrome with a genuine touch if needed, preserving its second
Owner Range, CAS original decode and fresh Viewer-return assertions.

The independent malicious SDK job hit the Chrome debugger bootstrap's
hard-coded 15-second stderr-only timeout; it did not reach a CSP/Origin test
failure. Startup now uses Chrome's `DevToolsActivePort` file as an additional
readiness signal and a bounded 30-second limit, and distinguishes browser exit
from startup timeout without logging credentials. The same cross-Origin
hostile test remains required at this exact commit.

### 390px actual mobile touch regression triage

The new exact-head real Gin/PG browser run again passed **125 checks**, including
both Hosts' complete desktop CAS Viewer and reauthorized Back, and the new
390px safe-area + up/down touch grip checks. It then timed out waiting for
the mobile Viewer original. That result does **not** identify whether a touch
click was delivered, the second Owner /cell-items Range completed, the
Viewer opened, or the physical PNG failed to decode.

The browser test now independently gates these stages with bounded,
non-sensitive diagnostics: actual hit testing, a browser-generated click
counter, authenticated Range count, original Gallery Viewer entry count,
dialog/image phase and HTTP status codes of signed CAS preview responses.
It does not synthesize a click or skip security and binary-original assertions.
Both Host modes must complete the full 390px flow.

### Post-merge #2618 genuine 390px tap failure and native-scroll correction

Exact SHA `e467c3d` P0-17 mounted Gin/PG17 Chromium failed after 127 checks: the
390px photo drawer was visible, touch grip expanded and collapsed, and the tile
was hit-testable. However a Playwright real touch did **not** fire its tile
`click` (zero DOM click observations), so neither the second Owner Range nor
Viewer was invoked. This is not a success, and is not an Owner auth failure.

The photo list now defers touch action to the browser's native overflow scroller
(`touch-action: auto`), both horizontal and vertical. Only the dedicated grip
uses pointer capture and `touch-action: none`. The existing genuine touch
browser smoke also records a bounded, anonymized pointer/touch/click event trace
in failure diagnostics without synthetic user events or Owner data. Verify this
commit against the same real Gin/PG17, both inline and isolated SDK Hosts.


### 2026-10-25 · 原生触控点击合成专项继续修复

在准确 HEAD `605faecb` 的 [真实 Gin/PG17 浏览器专项](https://github.com/lazyxu/xdrive/actions/runs/40139977038) 中，127 项检查后仍重现 390px inline 缩略图 `pointerdown/touchstart/pointerup/touchend` 已发生但没有任何原生 `click`、没有第二次 Owner Range 或 Viewer 的问题。该专项 **FAIL**，原完整 CI 单独 SUCCESS 不等于触控通过。

本增量保留照片容器 `touch-action: auto` 和 grip 单独 `none`，只对实际照片 `button` 设置 `touch-action: manipulation`，在浏览器保留原生 pan/zoom 的同时禁用双击缩放对单击激活的潜在干扰。额外记录捕获阶段和冒泡阶段的 `defaultPrevented` 布尔值以区分浏览器抑制与事件处理器主动取消；无注入点击、没有放宽真实 `/cell-items` Range、CAS 解码、Viewer 返回或双 Host 权限断言。

这是待独立准确 HEAD P0-17 浏览器专项证明的候选修复，**尚不能称已解决**。真实 iOS 27 Safari/Home Screen 仍 `NOT RUN`；生产专属不可接触验收按用户决定跳过（未验收），代码级安全及真实 CI 不跳过。

### 2026-10-25 · Genuine native touch activation fix

Real Gin/PG Chromium at `347adaf5` confirmed a stationary touch reached the
photo button's `pointerdown/touchstart/pointerup/touchend` with
`defaultPrevented=false` but Chrome withheld compatibility `click`.
A CSS `touch-action: manipulation` change alone was insufficient.

The trusted **shared Parent** photo button now accepts a real short primary
touch `pointerup` (≤12px movement, ≤700ms, no `pointercancel`), calling the
existing `onOpenPhoto` and therefore the existing **second signed Owner
`/cell-items` validation**, never opening media in the Child. A subsequent
browser-generated compatibility click within 900ms is deduplicated; ordinary
mouse/keyboard clicks remain accessible. Scrolling tiles never capture the
pointer and the map Host is unchanged. The 390×844 genuine touch Chromium
assertion still requires a real unprevented pointer/touch event sequence,
exactly one Viewer opening, an additional Owner Range and actual CAS PNG
decode/Viewer Back. It explicitly records whether the browser provided a
native DOM click, rather than mistaking its absence for absent user input.

This is a code candidate until the new **exact HEAD** browser/CI pass. Real
iOS Safari and VoiceOver remain untested; production-only acceptance skipped
per user decision (unverified).
