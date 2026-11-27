# iOS Files Unified Presentation — same-iPhone Native ↔ PWA acceptance

Status (2026-11-27): **source refactor + XCTest capture implementation; physical device parity NOT YET TESTED**.
This is an executable acceptance protocol, not a claim that the latest unsigned IPA is signed,
that synthetic screenshots contain cloud data, or that two platforms render pixel-identically.

## Single source of truth / intended product

- **Native** iOS Files stays SwiftUI; no WKWebView/PWA embed or duplicate data model.
- **Browse, Recent, Favorites** must share native row, grid tile, spacing, thumbnails,
  metadata and view-mode picker from `NativeFilesUIStyle.swift`.
- Home retains native `List/Section` navigation and xDrive's global five-slot bar.
  The Files-only Recent/Browse/Favorites selector is physically separate from it.
- The same authenticated Server Owner/Node/Revision rules control both presentations;
  a screenshot/layout refactor must never change a request or relax access checks.
- File Viewer continues using the same `NativeFilesViewer.swift` from all three entry
  surfaces. Error/unauthorized/empty states must be represented explicitly.

## Evidence classes (do not promote one to another)

1. **Source contract**: shared components and UI actions exist in the actual commit.
2. **Unsigned Simulator XCTest**: actual tap/return/screenshots from one Simulator session,
   saved as eight `XCTAttachment` images. Synthetic Owner has **no bearer** and cannot
   verify real file rows, thumbnails or usable media.
3. **Signed physical iPhone**: same phone, same Server fixture, authenticated Native and
   iOS Safari PWA. Screenshots and 60/120-Hz recordings are required.
4. **Performance**: report real p50/p95, frame gaps, peak RSS and usable first video
   frame with samples. `0 samples` is unmeasured, not a pass.

## Mandatory same-device prerequisites

- Record **exact native commit**, signed IPA identity, **exact PWA commit**, iOS version,
  iPhone model, display zoom, dynamic type, light/dark mode, display refresh capability,
  network path, cache cold/warm state, time and test fixture identity.
- Provision one disposable Owner A with real HTTPS session in BOTH the native app and
  iOS Safari PWA on the **same iPhone**; use the same cloud root/folder/Node IDs.
  Never put account credentials, access tokens or signed download URLs in artifacts.
- Populate one folder with a nested folder, PDF, image/HEIC, video MP4/MOV, audio,
  UTF-8 text, long Unicode/RTL name, and enough items for scrolling. Make sure
  a designated real fixture **file** is in the first verified cloud-root range.
- Capture native screens, then repeat *the same interactions* in the PWA on that
  iPhone. Keep brightness, language, orientation and UI settings fixed. Take
  full-screen screenshots and continuous screen recordings (not stitched mockups).
  Attach an OS .ips process-crash report only when an actual app crash occurred.

## One-phone paired capture order

| ID | Native and PWA action (in the same authenticated fixture) | Evidence / failure gate |
|---|---|---|
| 01 | Files → Browse Home | Search, title, sections, global + Files rails and safe areas |
| 02 | Browse → Recent | Real list rows, icon/metadata and transition frames |
| 03 | Recent → Favorites | Same row geometry and actions; never a stale previous-Owner row |
| 04 | Favorites → Browse, open cloud root | Correct breadcrumbs and one verified count/Range |
| 05 | Browse list: scroll, long name, thumbnail, inline folder expand | Same file ID, tap targets, row spacing, only one metadata line |
| 06 | More → Display/Sort → grid, then back to list | Same Node at viewport, grid icon/title/meta and no blank frame |
| 07 | More / long-press file / select multiple / dismiss | Same menu groups, destructive warnings and no toolbar overlap |
| 08 | Open same image/PDF/video in Viewer, next/previous | First usable media frame, toolbar, bounds and previous/next behavior |
| 09 | Viewer → Back → change Files section twice → return | Exact Node + relative scroll position and mode; no old file flash |
| 10 | Background/foreground, light/dark, landscape, large text | No white/black dead page, blocked controls or unsafe inset |

For every ID, capture paired names:
`NN-native-<route>-<device>-<commit>.png` and
`NN-pwa-<route>-<device>-<commit>.png`, plus a continuous `.mov` or `.mp4`
for the whole chain. PWA and native screenshots are **separate real images**.

Review typography, relative icon scale, spacing, separators, alignment,
keyboard/menu dismissal and visible action density side by side. **Native iOS
style is authoritative for system controls**: PWA is a reference for information
hierarchy and usability, not a mandate for pixel-identical Web UI.

## CI / signed device execution

- The `candidate-gallery-files` native navigation job executes
  `XDriveIOSGalleryFilesSixSubpageUITests.testFilesUnifiedNativePresentationCapturesOneContinuousSequence`.
  It exports **eight actual, unmodified XCTest screenshot attachments** to
  `diagnostics/files-unified-screenshots/` and verifies that all eight exist.
  These are **synthetic no-Session navigation** snapshots only.
- To capture authenticated *real* file cells and Viewer on a provisioned
  **signed physical device**, set the UI-test runner environment variables:
  `XDRIVE_FILES_SIGNED_DEVICE_CAPTURE=1` and
  `XDRIVE_FILES_FIXTURE_FILE_NODE_ID=<real-root-file-node-id>`. Run
  `XDriveIOSGalleryFilesSixSubpageUITests.testFilesSignedDevicePopulatedListGridAndViewerSnapshots`
  on the iPhone, NOT a Simulator. This is opt-in and requires the iPhone to have
  an existing genuine, authorized Owner session. The test must FAIL on missing
  real fixtures; it must never silently substitute synthetic data.
- Capture the paired iOS Safari/PWA screenshots manually on that **same iPhone**
  using the same fixtures and route order. The native XCUITest alone does not
  automate PWA screenshots or assert visual parity.
- If a test skips or the screenshot export fails, mark it **NOT VERIFIED**;
  a green source/build-only CI does not prove photo/video first frame, FPS,
  live cloud permissions or visual parity.

## Release blocking checks

- **P0**: no process exit, white/black full child viewport, old-Owner content,
  unverified empty-as-success, double bottom-navigation overlap or unreachable
  file actions across 30 consecutive transitions.
- **P0**: list/grid/Recent/Favorites/Viewer must preserve exact Owner and Node.
  Viewer Back restores the original list/grid content and scroll anchor where
  the returned Node remains valid; expired/changed Node must fail closed.
- **P0**: video prev/next stay usable before and after displayed first frame.
  No replacement of real video-frame gates by metadata/ticket readiness.
- **P1**: same 44pt minimum touch targets, dynamic type, content hierarchy,
  meaningful disabled reasons and consistent native rows/tiles across routes.
- **P1**: real 100k directory and 1/4 GiB transfer tests must be measured
  separately; bounded 64-range/256-retained Node data cannot be treated as
  proof of loaded 100k visual FPS.
- **P2**: different iPhone widths, text scaling, rotation, accessibility and
  motion-reduced controls remain readable.
- **Owner isolation**: repeat after switching A→B, revoking an account (401/403),
  losing network, and returning from Viewer while the session changes. No
  old-Owner thumbnail/menu/back pointer is allowed.

**Acceptance ledger** (fill from actual test output, not from code review):

| Gate | Exact device/commit | Actual evidence path | Result |
|---|---|---|---|
| Shared source + compile | | GitHub exact SHA + Xcode logs | Pending |
| Native Simulator 8 frames | | CI screenshot artifact + xcresult/H.264 | Pending |
| Authenticated native signed-device list/grid/Viewer | | XCUI screenshots + device model | Not verified |
| Same-iPhone Safari PWA matching frames | | Native/PWA PNG pairs + recording | Not verified |
| Physical performance / first frame | | p50/p95, RSS, real-frame events, .ips | Not verified |
| Owner A/B, revoke, long name, light/dark | | Recorded fixture and replay | Not verified |
