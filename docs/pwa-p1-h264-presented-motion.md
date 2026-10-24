# PWA P1-B · Real 100k authenticated H264 Viewer presented motion

This is a **stacked, opt-in, test-only** follow-up to P1-A [#2582](https://github.com/lazyxu/xdrive/pull/2582), not a replacement for #2582 or #2567.

Reuse the SAME already-mounted, real-Owner 390px Mobile Web Gallery,
Gin/PostgreSQL17/Local CAS fixture, 100k logical PhotoAssets, 115k metadata
Nodes, three independent samples, JPEG Viewer return and 4–6 authentic
Go Context.Done thumbnail cancellation tests.

After P1-A JPEG original decode/Back succeeds, identify a genuine visible
H264 movie tile in the bounded deep chronological Gallery. Click through
the actual shared Viewer by native Chromium pointer, verify its signed original
MP4 is loaded into a real HTMLVideoElement, explicitly call the browser's
native play() media pipeline, and require TWO separate
requestVideoFrameCallback calls with strictly advancing mediaTime and
presentedFrames. Observe actual video dimensions, stop playback, then click
the real Viewer Back button and verify the same document, route, mounted Gallery
grid and original scroll position.

A video poster, canplay/loadeddata, play() resolution, one static frame,
ordinary rAF or fabricated media event never counts as passing.
Do not override Chrome autoplay policies and do not mock private /api/v1
responses. Capture numeric frame counts/time deltas only, not signed URLs,
tokens, response bodies or private media.

This first genuine H264 dynamic stage does NOT establish physical iOS Safari /
Home Screen Installed behavior, Live Photo hold/release, original video Range
Go Context.Done cancellation, 115k physically distinct CAS originals or a
paired BEFORE/AFTER performance improvement.

Production-only inaccessible security acceptance: 按用户决定跳过（未验收）.
Actual code Owner/ACL/Abort/privacy gates remain mandatory. Once #2582 lands,
rebase this single-work-commit diff directly onto complete master and rerun
specialized and full CI before Ready/Merge.

This verified-workflow revision also requires the **actual HTMLVideoElement source**
to be a same-origin signed `/api/v1/file-preview/<node>` stream with a ticket.
Checks inspect only URL origin/path/ticket *presence* inside the browser; no
secret query value or original URL is persisted in CI output.
