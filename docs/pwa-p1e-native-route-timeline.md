# PWA P1E · Real Owner 100k browser route click-to-unmount timeline

## 2026-10-23 · Accurate-head native A-B-B-A evidence

At source HEAD `7630c056b39b8e7f2d108bce74641ae7a1c8bb40`,
the [genuine native specialty #39909942776](https://github.com/lazyxu/xdrive/actions/runs/39909942776)
and [full cross-platform CI #39909944350](https://github.com/lazyxu/xdrive/actions/runs/39909944350)
both returned **SUCCESS**. Four ordered A→B→B→A batches had n=3 each,
same native Go/PG17/CAS fixture, 100k logical and 115k physical metadata,
6 genuine in-flight JPEG streams, Go Context.Done <160ms, zero active reads
after cancellation and zero wasted post-cancel response bytes.

Observed 390px click→Gallery unmount P50 (ms) by batch:
A1≈29.1, B1≈88.6, B2≈88.2, A2≈29.0.
The source-specific balanced unmount difference is **+59.35ms**,
versus Go cancellation **+46.809ms**. These are independent
duration measures from each clock, never directly subtracted across clocks.
The association suggests route intent→React committed unmount is a
leading *candidate*, **not an established unique cause**.
The P1E disposable synchronous transition test [#2430](https://github.com/lazyxu/xdrive/pull/2430)
must independently pass its native UI and exact-head gates before any
production `startTransition` modification is even considered.
This is not a 100k first-paint or all-original-media AFTER.

P1D #2426 measured a ~42ms larger Go Context.Done notification duration
for split Web B in four true n3 Owner Go/PG17/CAS A-B-B-A batches, but
did not establish a unique root cause.

This test-only PR uses the same immutable frozen A
`84ef0076506b958001369bb173f221418bf4833a` and B
`7515c421412666893e4b0519e4b5869d988bf8e1`,
the same compiled Go binary and 100k logical/115k metadata physical
fixture. A single identical test runner copied into both trees uses
a capture-phase click listener and real DOM MutationObserver to measure
click-to-Gallery-unmount and click-to-Files-mount timing on the original
390px Mobile Web actual Files navigation. No production source, SDK,
cache, router, Owner ACL, or Service Worker changes.

Four batches A→B→B→A, 3 independent browser processes each. Preserve
original Go Context.Done <=160ms, 4–6 actual in-flight JPEG responses,
no wasted response bytes, same document and 52px App Frame. All metrics
must be finite. Browser `performance.now()` and Go monotonic clocks
are **not** synchronized: compare durations per clock, never subtract
timestamps from different clocks. `causalConclusion=NOT_ESTABLISHED`
until independent source evidence; do not fabricate a 100k speedup or
treat these 4–6 physical streams as 100k distinct media.

The inaccessible production-only safety acceptance is skipped
(unverified) per owner, not a code/CI/merge gate. Native iOS/Android
installation remains NOT RUN. Old public hashed assets remain append-only.
