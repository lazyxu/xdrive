# Native iOS per-page CPU, Memory and Hitch instrumentation (2026-11-12)

The primary #4307 XCUITest page performance matrix had 25 accessible native
routes and real 75/75 tap/launch-to-AX-ready samples at earlier commit
a32cac115854da414fc9787aaf56465add275f54. Its updated 55d7867 HEAD
has newly triggered CI and must not be rewritten merely for consolidation.

This stacked follow-up records actual application-targeted XCTCPUMetric and
XCTMemoryMetric across the 24 warm native routes. Xcode 26 with iOS 26+
also measures XCTHitchMetric. The repository's macOS-15/Xcode 16.4/iOS 18.5
Simulator cannot compile XCTHitchMetric (introduced in Xcode 26), so that
toolchain records XCTest scrolling/deceleration and navigation-transition
signpost durations instead. Those signpost timings are NOT Hitch Time Ratio,
dropped-frame counts or hardware refresh-rate evidence. The
25th, app.gallery, uses the independent XCTApplicationLaunchMetric because
the app is not running at measurement start. One unmeasured warmup plus three
retained metrics per route are collected in Apple's original xcresult format,
exported both as metrics.json and CSV. All 25 routes must be real XCTest
UI methods, not mocks, duplicate metrics or generated numeric fixtures.

The original native page and auth/source logic is unchanged. Synthetic
Owner only permits real native protected/denied views to mount; it does NOT
provide a valid Server Session and cannot benchmark authorized media.
Preparatory native scrolls and returns occur outside startMeasuring/
stopMeasuring, preserving page-action costs separately from UI discovery.
The audit rejects missing/duplicate route methods, trials and missing
xcresult metrics, and requires both compiler-gated hitch instrumentation and
the legacy-toolchain signpost fallback. It does not invent hitch ratios, FPS,
baseline percentages or P95. The exact-HEAD Xcode 16.4 build and xcresult
export remain mandatory acceptance gates.

Scope not yet measured against real content: signed Owner Files 100k
first/next 100, long scroll and return, Gallery 10k/100k PhotoKit/cloud
media, MapKit GPS members and Places, JPEG/H264/Live/PDF/audio real Viewer
frames, 1/4GiB full SHA transfers and resume, network/Owner revoke and
URLSession-to-Go request cancellation. Real physical signed iPhone 60/120Hz
and owner-backed datasets: 跳过（未验收）.

The dedicated workflow must prove Xcode compile, 25 real resource tests,
3 retained samples per test and metrics export on its own exact HEAD, then
full required CI/Final Gate before any merge to master. This is instrumentation
only, with no claimed production optimization or matched A/B speedup.
