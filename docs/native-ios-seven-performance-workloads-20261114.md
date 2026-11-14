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
- The existing 25-page root suite on master, and this PR's 36-child route
  candidate (new Clipboard/Mine interaction routes require a fresh real Simulator
  pass), establish the native measurement backbone, **not** complete Web
  parity. This PR remains Draft until required current-HEAD CI and Final Gate
  pass and the promised workload metrics are actually gathered.
- Exact authorized Owner, full media/100k and signed physical iPhone capture
  unavailable in the current shared CI must stay **跳过（未验收）**. No fabricated
  acceptance or fake session is permitted.
