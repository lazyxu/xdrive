# iOS Native Files ↔ iPhone Web/PWA: six UI workstreams

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
