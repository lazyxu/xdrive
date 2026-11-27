# Native iOS seven-family performance acceptance, one general PR

Canonical ongoing general performance PR: https://github.com/lazyxu/xdrive/pull/4328.
Original Web/PWA workload suite defines the comparison workload but **not** iOS measurements.
The machine-audited inventory lives in ios/performance/native-seven-workloads.json.

## P0 acceptance

1. Gallery and Files: include each implemented root and child route, and both
   directions of each screen transition. Collect 1 warmup plus n>=3 actual
   app-targeted AX-ready/CPU/RSS measurements; separately capture the first
   **visibly composed** frame, screen transition timestamps and actual hitch
   evidence. Post-AX screenshots are diagnostic and must never be called first
   pixels or native FPS.
2. Files: authenticated search, sort, grouping, Viewer next/previous/back and
   scroll-anchor persistence, including 10k/100k where available. Verify no
   stale Owner results and no duplicate/old callbacks; record latency and
   RSS rather than source-only test registrations.
3. Gallery/MapKit/Places: real PhotoKit source count, actual thumbnail-ready,
   map pan/zoom, clusters and places wall scroll, FPS, frame-interval P95,
   64/65 geolocations and 10k/100k cardinalities. Maintain Map P0 Owner,
   permission and GPS fixture checks; #4344 depends on #4305 and is not safe
   to absorb while unmerged and already running CI.

## P1 acceptance

4. Notes, Clipboard, Transfers, Settings: every implemented child page enter,
   back and scroll with app CPU/RSS/AX and populated session data. Missing
   native Settings subpages are not mock-implemented for a benchmark.
5. 10k/100k: use real persisted Files nodes and genuine PhotoKit assets.
   Cold/warm app restart, first/next bounded page, far scroll, cache recovery,
   memory peak and frame pacing. Never copy Web logical rows to a native data
   claim, or call 100k synthetic IDs 100k real photos.
6. Viewers: real authorized JPEG/HEIC/H264/Live/PDF media. Record actual first
   visible pixels/AVPlayerLayer isReadyForDisplay, next/previous, cache and
   URLSession cancel to Go Context.Done. An AX-ready control and an AVPlayer
   status.readyToPlay are not rendered video frames.
7. Large uploads/downloads: 1GiB and 4GiB native UploadSession/CAS bytes,
   end-to-end SHA-256, cancellation/resume, throughput and peak CPU/RSS.
   Unknown receipt must never automatically retry; do not weaken current
   Owner/session or ACL checks for test convenience.

## Evidence contract

- All seven workstreams must be present and audit machine checks each entry.
- A measured row requires the exact 40-char source SHA, real fixture 64-char
  SHA-256, device, OS, network conditions, raw native xcresult URL and >=3
  genuine samples of **every** listed metric. Raw traces and failed runs
  are preserved; no zero padding, selected samples, or Web values.
- A pending row remains pending with explicit missing evidence. Green workflow
  registration only asserts that nobody falsely marked the incomplete
  work as measured.
- The current candidate binds **25 native root-page resource routes** and **50
  genuinely native child / interaction paths** into one exact-HEAD iOS Simulator
  `xcodebuild test` invocation. Each route has one warmup and 3 retained trials:
  100 root and 200 child invocations, including 150 forward and 150 return
  AX-ready child timings. App-targeted CPU time and peak physical memory are
  audited independently for both suites, and child screenshots are retained
  after AX-ready and after return. The job fails unless **both** original
  `.xcresult` audits agree on the checked-out 40-character source SHA.
  Reusing a prior successful run or counting source registration as completion
  is forbidden. Parent-stage timing includes XCTest preparation/idling, not a
  first composited frame; neither screenshots nor iOS 18 signpost duration
  establish actual 60/120-Hz frame cadence. This PR remains Draft until the
  exact-HEAD macOS Simulator run passes alongside CI/IPA/navigation gates.
- Exact authorized Owner, full media/100k and signed physical iPhone capture
  unavailable in the current shared CI must stay **跳过（未验收）**. No fabricated
  acceptance or fake session is permitted.

## Explicit Web workflow → iOS Native coverage ledger (2026-11-15)

The companion `ios/performance/native-web-workflow-parity.json` indexes selected
**page, media, transfer and interaction-oriented** existing Web/PWA benchmark
workflows (including Files, Gallery, Places, Viewer, 100k and 1/4 GiB).
`audit_native_web_workflow_parity.py` compares this registry with the
current repository `.github/workflows` tree and fails on an omitted, duplicate,
mislabeled or deleted in-scope Web workflow. This is a **crosswalk**, not
completion evidence: every workflow is `not_verified` until the matching
native workload runs with actual source-bound measurements. Backend-only
performance, unrelated offline/security tests and native-only Notes/Settings
are tracked outside this Web UI workflow selector; do not describe this set
as the whole GitHub workflow directory.

The 50-route candidate also conditionally requests Apple's real
`XCTHitchMetric(application: app)` on **Xcode 26 and iOS 26**; the existing
Xcode 16.4/iOS 18.5 runner uses navigation/scroll signpost **durations**
instead. Neither route register nor signpost fallback establishes a physical
60/120 Hz FPS or a composited first displayed pixel. A real current-HEAD
XCTest log/`.xcresult` remains required, and the seven workload families
remain unverified.

## 2026-11-15 Web performance baseline audit

The explicit Web→native workflow ledger now tracks **68 selected UI/media/transfer
performance workflows**. Five previously omitted real-browser baselines are
registered and checked as native-unverified: P071 mobile 390px and wide 1440px
mixed 100k Gallery, P071 genuine H264 poster 100k Gallery, real Web 1 GiB
PostgreSQL/CAS transfer, and full-byte Web OPFS readback (1/4 GiB).
These are genuine Web tests, but none supplies iOS measurements. The native
45-route AX/CPU/RSS work, media first-frame, source-verifiable 100k workload
and 1/4 GiB URLSession test remain separate requirements. Missing/deleted or
incorrectly classified Web workflow now fails the parity audit. This does not
claim to include backend-only, agent-only or unrelated safety workflows.

## 2026-11-18 — unified original 75-route diagnostics

The macOS native subpage workflow writes `perf-triage.json` and `perf-triage.csv`
from the **same exact commit** and original audited 25 root + 50 child
XCTest data, with 1 warmup and n=3 retained observations. It separates
parent stage, child AX entry, AX return, app CPU, peak RSS and app cold start.
Missing fields remain `not_measured`. The JSON ranks slowest native AX
routes and marks >=30s anomalies for investigation, without weakening CI
or falsely claiming composed first pixels, real 60/120 Hz FPS, or Web parity.
The 68 selected Web/PWA benchmarks are still `not_verified` natively.
On source 5e573c5, Gallery wall density entry AX had [5236, 66766, 65133]ms,
Files kind filter entry AX [75098, 13728, 10227]ms, and Gallery framing
return AX [5180, 5485, 65237]ms: these include XCTest animation/idling
and are **not proof of real UI stalls**.

## 2026-11-18 — measured XCTest animation-idle attribution

The exact-HEAD iOS 18.5 Simulator run at `9452711f7bffb969b61f359933d162c5a5c022c2`
passed **25 root + 50 child original XCTest measurements and the combined 75-route
report**. The full CI and root CPU/RSS were green, while independent navigation
and IPA gates must always be checked for their own exact commit.

The original xcodebuild log had **6 emitted** `App animations complete
notification not received` events **inside the 150 measured child AX-entry
trials**: 2 date-filter, 2 kind-filter, 1 size-filter and 1 Gallery-wall-density.
These are observed XCTest animation-idle timeout signals, not app first-pixel,
Core Animation frame timing, or proof of UI freeze. The combined triage now
cross-checks each original `IOS_NATIVE_SUBPAGE_ITERATION` and
`IOS_NATIVE_SUBPAGE_PERF_MS` trial against the independently audited n=3 values
before attributing actual Xcode waits, marks the affected routes in the same
75-route CSV/JSON and rejects missing/duplicated/mismatched raw trials. No
existing CPU/RSS/AX or Web-equivalence gate is relaxed. More native instrumentation
is still needed for real frame cadence, first media present and signed Owner.

## 2026-11-19 — native Gallery-to-Files actual tab navigation regression

The iOS 18.5 candidate-gallery-files run on prior source `9452711f` executed
94 real native XCTest methods (93 PASS, 1 FAIL); `testGallerySourceFilterAndOriginalsRepeatedFilesReturn`
failed on `kAXErrorCannotComplete` from `AXScrollToVisibleAction` for the
**real visible** bottom Files tab frame at x≈231.9, y≈764.5. The app did not
show a verified crash in this failure. The test helper now validates the actual
Files/Gallery AX identifier, existing host window, nonempty on-screen tab frame
and bottom-bar geometry before tapping the actual physical frame midpoint via
XCTest coordinates. It still requires the real destination and screenshot
assertions after the tap; other controls retain normal `XCUIElement.tap()`.
This is an XCUITest navigation fix, NOT a bypass of app functionality, nor
proof that UIKit/SwiftUI physical 60/120Hz frame performance has passed.
Retain MapKit basemap AX failure until the real floating control in #4362
is validated; do not waive that independent functional gate.
