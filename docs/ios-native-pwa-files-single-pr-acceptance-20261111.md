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

## 2026-11-11 follow-up: real Owner/PG baseline schema root cause

[#4290 failing paired H264 run 42952629973](https://github.com/lazyxu/xdrive/actions/runs/42952629973)
shows 3/3 real signed-H264 candidate first-frame runs and real 100k logical
Gallery/Viewer return, then the frozen baseline's genuine Files navigation
cannot be tapped: `blockerKind=snackbar`, within viewport but unobscured=0.
The same job's PostgreSQL log repeatedly reports
`relation "xd_file_recent_folder_access" does not exist`.
This is independently actionable in the **test fixture**, not an actual
video decoding failure.

The isolated `TestGalleryRealWebColdFixture100K` previously migrated
`meta.FileRecentAccess` but not the separate `meta.FileRecentFolderAccess`
while mounting the real Files app. It now migrates both production models
only in the opt-in full-SPA fixture, then performs the real authenticated
`GET /api/v1/file-recent-folders?limit=8` against Gin/PostgreSQL, requiring
HTTP 200 before the browser. The paired workflow is triggered by changes to
this fixture. No production migration or Owner permissions are changed and
no baseline test, actual click or n3 comparison is bypassed.

This follows a separate same-PR verified-edge real pointer diagnostic on
the historical baseline. Both controls keep real `elementFromPoint` and
native Electron pointer dispatch; test pass must be established on the
new exact candidate HEAD, not inferred from source contracts.

## 2026-11-11 additional real H264 paired baseline diagnostic

On [real run 42972976049](https://github.com/lazyxu/xdrive/actions/runs/42972976049),
candidate passed genuine n3/3 H264 compositor first-frame motion and exact
JPEG/H264 Viewer return. Baseline's Files button finally received a genuine
`elementFromPoint`-verified tap. The baseline then failed after a *real JPEG*
Viewer Back: same document/route/host/grid, real decoded original and bounded
19 mounted tiles, but a 57px historical scroll-anchor drift instead of <=2px.
The test aborted before measuring any baseline H264 frames. This must NOT
be described as baseline H264 decode failure or a successful viewer return.

The paired H264 runner now permits a **strictly labeled historical baseline
return audit**, opt-in only for the before-build in signed H264 pairing.
It accepts at most 96px *measured* same-Owner/route/host/grid drift solely
to continue to a real H264 first-frame sample; the underlying returned
`passed` remains **false** and all measured drift is retained in the
report. The candidate and all independent JPEG/H264 Viewer stability
tests still require <=2px and cannot use this mode. Wrong Owner/route,
missing grid, unresolved Viewer, blank decoded media, excessive drift
and missing actual H264 frame still fail closed.

The H264 comparison now separately reports `baselineViewerReturnPassed`,
`candidateViewerReturnPassed` and baseline per-sample JPEG/H264 drift,
and never claims that a recorded baseline defect passed the UX gate.
This keeps historical control evidence visible without falsely blaming
candidate video performance for a baseline-only scroll regression.

Status: implemented in the integrated PR; new exact-head real
Electron/PG/CAS H264 n3/n3 run still required. Real iOS physical
performance and screenshot pairing are not proved by Chromium.

## 2026-11-11 real paired-H264 n3 serialization regression

[Exact head paired workflow 42983942883](https://github.com/lazyxu/xdrive/actions/runs/42983942883)
ran authentic signed Go/PG/CAS Viewer frames on **both** candidates:
candidate signed H264 first frame 3/3, baseline signed H264 first frame
3/3. The historical baseline JPEG return drift was 57px in all 3 samples,
honestly `passed:false`; baseline H264 returned with 0px drift, while
candidate returned with 0px drift. Both per-sample workload reports exist.

The final `viewer-first-frame-compare.cjs` then failed
`baseline: real H264 n3 gate missing` because the main benchmark summary
contained `sampleCount:3` and p50 aggregate fields but **omitted
`samples`**. The strict comparator correctly refused to infer samples
from an aggregate. This is a serialization/test fixture defect, not
a genuine decode or route failure.

Fix: write the original three Owner-signed frame measurements as a
**sanitized numeric projection** into `summary.json` only for
`XD_VIEWER_FIRST_FRAME_BENCH`, preserving actual timing, frame dimensions,
verified playback and return-drift fields without copying raw rows or identities.
Add a regression that rejects aggregate-only fake n3 input. Baseline
return drift remains explicitly failed, candidate strict <=2px remains,
and no signed video, navigation or security gate is waived. Final n3/n3
comparison on the new SHA must still execute to be accepted.
