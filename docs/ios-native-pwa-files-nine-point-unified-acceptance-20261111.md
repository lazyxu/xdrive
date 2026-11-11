# xDrive iOS Native Files ↔ iOS Web/PWA: unified nine-point acceptance

Date: 2026-11-11. One master-target candidate: PR #4298. This document distinguishes **implemented code**, **real CI**, and **unverified hardware acceptance**. Never infer physical iPhone 60/120-Hz FPS, Owner end-to-end, 100k responsiveness or paired screenshot equality from source assertions or low-rate simulator PNGs.

## Already present in master before this PR

- #4260: bounded verified Gallery/Files tab return, Viewer pending-first-frame path, and 70 real native UI journeys; #4290: Native/PWA Viewer and H264/SPA follow-up.
- The Native Files Recent/Browse/Favorites 44pt rail already supports pushed folders and Owner-scoped section restore. This candidate **moves the existing rail ABOVE Files content** (not an extra bottom bar); it stays mounted but disabled during selection to avoid vertical layout jumps.
- Owner/Node/revision fences, a 64-row ranged read / bounded retained window, and native PDFKit/AVPlayer/Share Sheet are existing implementations, not claims newly fixed here.

## Additions in this unified candidate

1. Preserve #4298's six real cross-route XCUITest journeys and frame watcher registration (76 total distinct tests). No fake Server login or static asserts substituted for Xcode.
2. Add a visible folder-upload menu action in verified native cloud folders. It invokes **the existing** `XDriveIOSNativeFilesManagementPanel` and its existing `.folder` system importer / single upload writer / read-back receipts. The entry is disabled without a verified directory/Owner, during mutation or selection, and during whole-library search. The menu explicitly says 512 MiB; the destination screen spells out **128 files, 64 directories, 512 MiB, depth 8** plus resume limits.
3. Normalize Native list/grid secondary labels with PWA semantics: authoritative search location first; local-calendar modified date, then decimal file size for ordinary files; relative today/yesterday/day-before for folders. Keep native SF Symbols and SwiftUI components. The selected list control now exposes an explicit selected/unselected accessibility value. Thumbnail `scaledToFill` stays unchanged; matched output still needs inspection.
4. Extend executable Node source contracts (not hardware measurements) for upload, metadata, and retained Owner/Viewer safety.

## Required acceptance matrix

| Priority | User requirement | Code/test basis | Real acceptance still required |
| --- | --- | --- | --- |
| P0 | No visible Files flash across Recent/Browse/Favorites/Search/folder/Viewer | 76 native UI journeys and tap-adjacent frame recorder, existing bounded lifecycle | Genuine iPhone 60/120-Hz frame capture, identify blank/old-owner/old-node intermediate frames, inspect screenshots and crash logs |
| P0 | Viewer image/video/PDF/audio consecutive correctness | Synchronous retire/pending state, exact Node/Owner guarded neighbor admission, PDFKit/AVPlayer, tests | Actual authorized original per type; rapid next/previous and return; independent video presented-frame inspection |
| P0 | Owner login/logout/switch/revoke/weak network | Existing verified Owner fences, synthetic no-token fail-closed Simulator journeys | Authorized production-like Owner A/B, actual revoke, 401/403, slow/aborted responses, no wrong pixels or stale file after return |
| P0 | #4298 six new real Simulator tests | XCUITest source, frame watcher, required candidate Gallery/Files gate | Full exact-HEAD macOS Xcode run 76/76 + Navigation + No-Session + B9 + no-crash audit + CI/Final Gate |
| P1 | Native/PWA same-data eight screenshot states | Shared file metadata rules, Native screenshot capture and existing 390px PWA browser harness | Capture paired Browse/List/Grid/Menu/Selection/Empty/Dark/Viewer, same iOS device/Owner/directory/data/locale/scale; review image-by-image |
| P1 | 100k iPhone performance | Existing bounded Native Range/anchor and Browser 100k logical/115k physical fixtures | Actual signed iPhone with 100k authorized files: long scroll, sort, group, Viewer return; P50/P95 response, FPS, peak RSS/CPU, hardware details |
| P1 | Native recent/browse/favorites quick access | Existing `native-ios-files-quick-rail` moved above Files list, 44pt and disabled during selection | Real user touch, forced focus, landscape, VoiceOver; must not add a second app-wide tab bar |
| P1 | Folder-upload direct menu | This PR routes new button to existing Owner-scoped picker; full limits displayed | Xcode compilation and signed iPhone picker test: good folder, 129 files, 65 dirs, >512MiB, depth 9, revoke mid-import |
| P2 | Visual system alignment | One Native metadata projection for list/grid, unchanged existing thumbnail crop, VoiceOver selection state | Same-data screenshots/dark mode/Dynamic Type and actual accessibility checks; do not demand pixel equality from system controls |

## Evidence protocol — do not mark unexecuted gates passed

Each hardware pair: attach the two raw images, timestamp, iPhone model, iOS version, viewport pixel size and scale, theme/Dynamic Type, anonymized Owner scope and verified folder/fixture ID. Collect **independent** hardware frame capture at 60/120 Hz for transitions; screenshot sampling/XCUITest settled screenshots are not hardware FPS. For real 100k performance record measurement source and raw logs, with P50/P95 and memory units.

No credentials/Owner identifiers, signed URLs, private filenames or media bytes in logs. Use two genuine, separately authorized test Owners and captured 401/403/abort traces. Cancelled/unknown-ACK mutation outcomes are never silently retried.

Do not mark **DONE** or merge merely because static Node checks pass. This candidate should remain **Draft** until exact-HEAD full CI, unsigned IPA, real candidate Simulator journeys and Final Gate succeed. Real iPhone signoff requires external physical hardware with a signed app and actual Owner data; if unavailable, explicitly keep it **NOT VERIFIED**, even after code merge.
