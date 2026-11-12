# iOS Native page performance parity — 2026-11-11

## Measured contract

Web/PWA already uses real Chromium, Go/PostgreSQL/CAS and up to 100k mixed
media/file performance workloads. Those timings do NOT apply to native SwiftUI.

This stage adds a real macOS iPhone Simulator XCUITest arm,
candidate-performance, with native tap or cold launch to actual AX-ready page.
Every registered route is required to output three distinct trials, p50/p95,
max and per-trial records. Missing data fails CI and remains marked unmeasured.
The test uses actual native view hierarchy, NOT a duplicate mock screen.
Synthetic Owner screens deliberately have no valid Session, so cloud access
is refused, never fabricated.

These are XCUITest + AX-idling wall times, NOT first composited frame, FPS,
CPU, peak RSS, actual Server Range, network throughput or a real signed
iPhone run. An earlier candidate attempt completed 14/19 routes; after fixing Launcher
visibility, the original PR commit `810014b4a4dd92daebee77edba8ad9bd4333a79e` passed the dedicated
[Simulator candidate-performance job](https://github.com/lazyxu/xdrive/actions/runs/43047764998/job/130637852644)
with **19/19 native AX-ready routes and 57/57 genuine UI samples** (6 XCTest
methods, 0 failures; strict complete). Its actual per-trial numbers are
[archived here](performance-evidence/ios-native-page-navigation-43047764998.json).
This follow-up adds six further native routes (albums, cloud media wall,
Files saved searches, operation history, Files search editor and Mine cache):
**25 routes × 3 = 75 samples are required, but not yet validated on the
new HEAD**. No native first-frame or FPS measurements are implied, and no
performance speedup is claimed. The original full PR CI failed in unrelated
Server Validation, rootless image identity, and one Files no-session test;
its successful performance shard does not make the overall PR green.

## Pages measured by the dedicated Simulator gate

| Surface | Required route keys (3 trials per key) | Native readiness |
| --- | --- | --- |
| Launch | app.gallery (cold) | Actual default Gallery after a new process launch |
| Main navigation | tab.files, tab.gallery, tab.mine, tab.launcher | Native tab and owning page |
| Files | files.recent, files.favorites, files.browse | Actual selected rail section |
| Gallery sources | gallery.originals, gallery.unified, gallery.local | Native Originals, unified Gallery and PhotoKit timeline |
| Gallery children | gallery.filters, gallery.people | True editor sheet and People page |
| Other Gallery sources | gallery.albums, gallery.cloud | Actual native albums page and cloud search toolbar; no signed media |
| Protected Files children | files.cloud-denied, files.trash-denied | Actual signed-out fail-closed recovery screens |
| Files tools | files.saved-searches, files.operation-history, files.search-input | Native child sheets and search editor, not indexed Owner search |
| Dynamic tools | tool.notes, tool.clipboard, tool.backup, tool.transfers | Native notes editor list, clipboard, backup overview, transfers |
| Mine child | mine.thumbnail-cache | Real native cache page under synthetic no-Session Owner |

The workflow captures xcodebuild.log, xcresult, screenshots and the structured
navigation-latency/page-performance JSON artifact. The registered route list
and completeness gate are in ios/scripts/summarize-navigation-latency.py.

## Outstanding Web-to-Native parity requirements

| Existing Web performance | iOS equivalent required | Evidence status |
| --- | --- | --- |
| First/next loaded page, 100k grid/list scroll | Real Owner-verified 100k File Nodes, first/next 100, long scroll, anchor, item type and network events | Not measured |
| Gallery 100k JPEG/H264/Live mixed viewports | Real PhotoKit and signed Cloud Owner 10k/100k pages, first visible thumbnail, media decode | Not measured |
| Viewer return/cancel and first H264 displayed frame | Signed actual H264/Live and AVPlayerLayer first displayed video frame, Viewer return anchor, cancellation | Marker exists, not measured with signed content |
| Places map and exact members | Real MapKit marker count, 64/65+ places, actual PhotoKit/Owner members, first Wall, Viewer roundtrip | Existing real two-GPS-photo journey; timing not measured |
| Native PhotoKit 10k/100k scanning | Real library scan, queue/incremental changes, RSS, cancellation and restore | Existing synthetic map 100k computation, not real 100k UI |
| Full cancellation Go Context.Done | Real native URLSession from scroll, tab, Owner, abort and recovery; Go handler exit | Not measured |
| 1/4 GiB upload and download | Native UploadSession chunks, resume, SHA, files and videos on repeatable network n>=3 | Not measured |
| CPU/RSS/frame pacing and visual jitter | Instruments, signposts, dropped/slow frames 60/120Hz, peak RSS, CPU and energy per route | Not measured |
| Server admin/sync/storage/device/diagnostic pages | Native page performance after a supported native capability exists | Native implementation unavailable; do not measure placeholder |
| Auth/permission/network Owner switches | Real current Owner, active network loss/retry, refused old response, recovery | Functional contracts exist; performance incomplete |

## Protocol for future populated native workloads

Keep exact commit SHA, model/OS/refresh rate, Xcode and Runner, cold/warm cache
state, 0/1/100/10000/100000 fixture identities, Owner scope, transport state
and per-trial raw latency/resource/frame trace. Compare baseline and candidate
using the same Runner and dataset with at least 3 trials. The first actual
visible pixel and compositor frames must be measured independently from AX
availability. No synthetic/no-Session results can validate private 100k
content, media decoding or real throughput.

Signed physical iPhone / real Owner 10k/100k / WAN / 60-120 Hz Instruments:
跳过（未验收）.
