# iOS Native + iOS Web/PWA Files: one consolidated P0–P2 acceptance PR

Decision: 2026-11-11. One master-target PR, not parallel independent changes.
Source: integrated native draft #4260 and PWA/H264 draft #4272 by exact Git blobs,
on top of live master. No predecessor CI result substitutes for the final head.

## Eight user-requested workstreams and signoff

| Priority | Workstream | Implemented/covered in candidate | Required evidence before DONE |
| --- | --- | --- | --- |
| P0 | Native Recent/Browse/Favorites/folder/Search/Viewer no-flicker | Native retained/verified row and thumbnail work; XCUITest navigation, late-tap frame tracing and sparse-vs-blank audit | Exact-head full native Simulator matrix and real 60/120 Hz captured frames on signed iPhone; no content/chrome misclassification |
| P0 | Image/video/PDF/audio Viewer first frame and adjacent next/prev | Native pending-frame state is synchronous; existing PDFKit/AVPlayer and bounded verified-neighbor flows; PWA signed H264 benchmark | Correct displayed media, not mere loaded URL/AVPlayer ready; actual local and real Owner playback with back/forward + return |
| P0 | #4260 complete gate | All exact #4260 source blobs retained in combined tree | Re-run CI/Final Gate/IPA/4 native Simulator jobs on combined head |
| P0 | Real Owner/login/logout/switch/revocation/slow network | Existing Owner identity fences and independent fails-closed native UI tests; signed-owner Gin/PG/CAS PWA fixture | Real authorized, populated Server Owner and true revocation/weak-link/unknown-ACK tests; simulated no-token Owner is not authorization proof |
| P1 | Same-source native/PWA screenshots | Native tap-adjacent screenshot audit plus Web 390px routed SPA and app dock source | Screenshot pairs from matched iPhone width, same Owner+folder/data+locale/contrast/dynamic-type/theme; 8 states: Browse, List, Grid, menu, select, empty, dark, Viewer |
| P1 | 100k files and responsiveness | Native 64-item bounded window with anchors; PWA genuine 100k logical/115k physical metadata signed Owner Chrome fixture | Native real Owner 100k file long-scroll/range/group/sort/Viewer return with RSS/CPU/FPS and p50/p95; no invented native benchmark |
| P1 | #4272 real signed H264 | Whole predecessor Viewer, HTTPS Range, n3/n3 comparison and genuine DOM hit fixture kept | Both genuine first-frame samples, route back, same document and Files tap; inspect logged errors, no false success |
| P2 | Native/PWA visual consistency | Keep native SwiftUI sheets/menus and PWA MUI mobile dock; same real file actions | Compare title/row/icon/menu/action feedback at matching states; no faux platform controls |

## Reproduced PWA regression and fix

Workflow [42948794224](https://github.com/lazyxu/xdrive/actions/runs/42948794224)
on #4272: the signed Owner/100k logical Gallery H264 test actually reported
3 presented first-frame samples and 3 real same-document Files->Gallery->Files
sample checks, then a subsequent real Files tap was obstructed by a MUI
Snackbar child at z-index 1400 (`blockerKind=snackbar`,
`withinViewport=1`, `unobscured=0`).
The failure was a genuine hit-test, NOT an H264 decoding failure and NOT an iOS
app crash. Preserve the error and the genuine `elementFromPoint` gate.

The shared `XDriveFeedbackSnackbar` was already placed above the 56px
mobile dock with a noninteractive root, but incorrectly restored
`pointerEvents: auto` on its *entire alert child*. A tall/positioned toast
could therefore occlude a navigation button even where the root was meant to
pass through touches. Change the child to noninteractive and grant pointer
events only to explicit clickable buttons/links. Do not hide toast text,
remove close actions, weaken click-testing, synthesize the route, change
auth or add a test-only bypass.

The source regression test now requires both passive alert and live explicit
actions. The exact combined-head real Electron/H264 workflow remains the
authority; if this regression persists, use its anonymous obstruction
telemetry rather than claiming fixed from source alone.

## Verification rules

* Exact final commit: not predecessor green results.
* New source/CI/manual states: `not run`, `running`, `pass`, `fail`,
  `not available on runner`. Never infer real device pass from source checks.
* Real screenshots: include image dimensions, device/OS, matched Owner/path,
  capture timestamp, frame validity and raw images. A non-solid PNG alone is
  not a 60/120 FPS or zero-flicker measurement.
* H264: measure a physically presented decoded frame via
  `requestVideoFrameCallback`; compare n3/n3 on same runner, retain baseline
  and candidate SHAs and complete errors. Baseline navigation defects cannot
  be silently waived.
* Signoff: all applicable exact-head required checks pass; no silent skips,
  no repeated writes on unknown ACK; keep Draft while real Owner/phone/device
  gates have no evidence.

## Historical change preservation

* Original native P0 fixes and 70 real native UI journeys: #4260.
* Original PWA Viewer and real H264 baseline/candidate code: #4272.
* Successful earlier PR checks are historical only. The new tree is a
  semantic union of the exact source blobs and latest master; predecessor
  branches are not force-pushed or rewritten.
