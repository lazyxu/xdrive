# iOS Native Files ↔ iPhone Web/PWA: eight P0–P2 workstreams (one PR)

Scope: one SwiftUI Files UI on existing verified Owner/Node APIs, no WebView,
second File Provider, duplicate Server writer or synthetic authorization.

| Track | Changed source | Verification |
| --- | --- | --- |
| F1 Home hierarchy | NativeCloudFilesBrowser.swift | Browse overview, existing location and organizer shortcuts, secondary Tag disclosure |
| F2 Selection dock | NativeCloudFilesBrowser.swift; NativeFilesUIStyle.swift | One safe-area row for Copy/Move/Download/Delete/More; no second app-wide tab bar |
| F3 List/Grid stability | NativeFilesViewModePolicy.swift; Browser + Collections | Preserve verified Node anchor, cancel stale generation, reject Owner/Range changes; executable pure Swift checks |
| F4 Viewer | NativeFilesViewer.swift | Explicit revision-bound export and ShareLink even after success; retain AVPlayer, PDFKit and neighboring files |
| F5 Real transition recording | files_ui_transition_video.py; candidate-gallery-files CI | Genuine simctl H264 clips, at least four unique tap-marked routes and decoded 10Hz frames; suspect white frames rejected |
| F6 Visual parity | NativeFilesUIStyle.swift; Browse, Collections, Viewer | Shared names, metadata, action sizes and minimum hit areas |

## Evidence boundaries

- The Simulator 10 Hz video sampling **does not** establish measured 60/120 Hz
  frame rate or guarantee absence of flashes between 100 ms samples.
- Pure Swift/Node/Python source checks are not proof of compiled iOS UI.
  Merge only after exact HEAD unsigned IPA, full relevant CI/Final Gate and
  native candidate-gallery-files XCUITest/video audit results pass.
- Pixel-perfect Native/PWA matching and authorized Owner with real media, 10k/100k
  responsiveness or physical iPhone acceptance are not yet verified.
- Private content is never read under a synthetic Owner. Originals are not
  downloaded until an explicit user action, and old Owner/Node checks remain.
- #4298 navigation/crash and #4328 performance remain distinct, already-running
  PRs; do not replace their in-flight SHA checks or borrow historical passes.


## Expanded P0–P2 UI scope (2026-11-14)

The existing six-workstream document and PR number remain canonical; this
continuation extends the same Draft PR rather than opening competing native
Files changes.

| Priority | Requested area | Product change and proof boundary |
| --- | --- | --- |
| P0 | Home | Smart folders remain directly visible; Tags/Classification uses one disclosure; Home editing moves beneath More management while operation history stays directly reachable. Existing accessibility targets remain. |
| P0 | Rename + attributes | Direct revision-checked context rename remains. Browse and Recent/Favorites add an Owner-fenced read-only attributes sheet; full management remains a separate explicit action. |
| P0 | Viewer | Existing AVPlayerLayer-ready first displayed frame timestamp, Previous/Next and verified return anchors remain; the PR adds explicit revision-bound export and Simulator video audit. Zero first-frame samples mean NOT MEASURED. |
| P0 | Child switching | Existing simulator taps cover Browse, Recent, Favorites, Trash denial, Gallery/Files and navigation; recorded H.264 provenance and decoded 10Hz frames are separately audited. |
| P1 | Icons + metadata | Extension-aware SF Symbols and type badges for common formats are shared by Browse/Recent/Favorites. They are visual hints only, never MIME proof or Server authorization. |
| P1 | Search + path | First-position Search all files and Go to path actions call the original native Searchable and exact-name Server resolver. |
| P1 | List/Grid | Verified Node, current Owner, presentation mode and visible-route guards protect position; type badges are shared across list and grid. |
| P2 | Visual polish | Shared dynamic type, minimum interactive targets and native colors remain. Same-device pixel/RTL/large Dynamic Type comparisons still require real iPhones. |

### Verification and release limits

- Static source contracts for the expanded UI are in desktop/tests/ios-native-files-ui-six-parity-20261114.cjs; they are not proof of iOS rendering.
- The read-only attributes sheet is based on one verified Node snapshot and must hide content after Owner switch. Writes continue to revalidate current Node/revision.
- Exact HEAD Xcode/IPA build, full CI/Final Gate, candidate-gallery-files XCUITest/H.264 audit, signed iPhone 60/120 Hz and real media/10k/100k folders remain independent gates. Missing video samples are NOT MEASURED, never a pass.
