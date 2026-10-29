# iOS Photos: bounded album window selection (stacked on #3097)

The initial foreground Files backup scans only the newest 256 authorized PhotoKit
items per run. Rerunning that fixed range can never reach older photos in a
large library. This increment adds explicit window selection without
creating a second uploader, background task or unbounded photo-ID cache.

## Contract

- On first explicit run, use the latest 256 authorized items. The existing
  PhotoKit lazy snapshot returns its accessible item count.
- After that count is known, the user may choose window 1, 2, etc. (0-based
  offsets 0, 256, 512...), covering older library areas without retaining
  identifiers or scanning all 100k items into a Swift array.
- Each selected window reads at most 256 currently authorized metadata
  candidates through the 64-item PhotoKit page iterator. The limit stays
  20 new ordinary still originals per deliberate foreground run.
- The scanner retains its PhotoKit generation and Full/Limited authorization
  checks. A library change mid-scan aborts the run.
- A window past the newly authorized count is empty and visibly reported as
  such, never silently redirected to the first window.
- Counters and progress denominator refer to the selected window. Confirmed
  means an existing authenticated Owner Node SHA/revision receipt was checked,
  never merely that a window was selected.
- PhotoKit local identifiers, GPS, image inventories, credentials, WebView
  cookies and access tokens are not persisted by pagination.

Index windows are transient and are NOT durable photo identities. Adding,
removing or granting photos between runs may shift creation-date offsets.
Revisit affected windows. A window finished message does not prove full
library backup. The encrypted per-resource intent and Server receipt remain
the only per-file durable evidence.

## Acceptance

1. With 600 visible photos, the first scan yields three selectable windows
   of capacity 256, 256 and 88, with distinct original candidates.
2. A run uploads no more than 20 new stills; reruns verify existing receipts,
   and an uncertain ACK pauses further uploads, even in another window.
3. Limited access counts only allowed items; permission/library changes
   abort current snapshots and do not silently reset a selected range.
4. When an earlier count becomes stale, an out-of-range window must not
   unexpectedly restart at the newest photos.
5. Build exact-head iOS 16+ device IPA with macOS Xcode; exercise VoiceOver
   Stepper and cancellation upon app background on a real iPhone.

Real device/SideStore, iCloud-original, interrupted ACK, video/Live pairing and
100k-duration acceptance: 跳过（未验收） pending actual evidence.
This patch does not implement automatic full syncing, SourceRun or background
uploads. It is a stacked PR on #3097 so the already queued parent CI is
unchanged.
