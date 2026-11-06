# iOS unified Gallery

Implementation in [PR #4005](https://github.com/lazyxu/xdrive/pull/4005). This describes the native implementation; PR builds and required checks remain separate evidence.

## Timeline and sources

The Gallery opens a merged local/remote timeline ordered by capture date. A uniquely confirmed pair occupies its local photo's position and opens the local original first. Unknown dates appear last. Source chips select all, both, local-only, cloud-only or unverified; each tile also identifies video/Live media. Source details explain the evidence and offer retry or the existing photo backup entry.

Each visible window owns at most 48 reconciled rows and scans at most 192 raw candidates per read. Empty filtered windows advance automatically. Historical windows keep only source cursor metadata and measured heights; disappearing views explicitly release rows, thumbnails and requests. A changed source count, anchor revision, PhotoKit generation or window checkpoint requires a refresh. No full-library array of media is retained.

One native viewer follows this same mixed sequence, including across windows. Swipes, adjacent buttons and the current window's filmstrip share that sequence. The existing still/video/held-Live renderers and actions remain the actual media viewers. If a matched local original becomes unreadable, the viewer revalidates the exact cloud asset/Node/revision before switching to it. Failure keeps a retryable local view. Returning restores the selected row's window and anchor.

## Search and filtering

One query combines filename substring, media type and an inclusive calendar-day range with the source filter. Both filenames of a matched row participate, even when its cloud reference was on another source window. Capture-date criteria apply to the canonical row; an unknown date cannot satisfy a date interval. Queries advance bounded source windows and cancel when the query, Owner or navigation changes. Search does not claim OCR/semantic matching.

## Pairing and recovery

The read-only exact-match API is authenticated and Owner scoped. It accepts at most eight full original probes or current asset/Node/revision references. Images/video require the complete SHA-256 and byte length; Live requires both originals. No names, dates, partial hashes, cross-Owner CAS existence or approximate matching establish a relationship. Multiple matching local/server candidates remain separate and unverified.

The protected per-Owner SQLite index survives paging and relaunch. PhotoKit persistent changes invalidate affected IDs; missing change history invalidates the whole index. Reading hashes never starts an iCloud download. A completed scan records unavailable originals separately by media kind, so an unreadable video does not block absence evidence for still images. An unreadable item of the same kind continues to prevent an unproven cloud-only label. Retry reuses valid fingerprints and rechecks unavailable originals. Limited Photos permission never proves absence outside the authorized subset.

Server indexing supports the existing atomic iOS `xdrive-live-originals` ZIP plus LIVP. The iOS format requires exactly two stored media entries and its matching format/version/role/path/size/CRC manifest. Both member streams are hashed completely and their CRC checked. The parent archive digest continues to bind revision and byte ranges; member digests separately identify originals. Old descriptors without member hashes are refreshed by the versioned index. The original container remains the only CAS file/Node.

## Cache and isolation

The Gallery and My screens expose the shared thumbnail cache: count, size, previews, selected deletion and clear. It stores regenerable thumbnails, bounded to 512 MiB/4,096 entries. Origin/Server instance/Owner/Root, Node revision and thumbnail version isolate keys. Clearing fences earlier in-flight writes. It never deletes local Photos, cloud originals, backup receipts or the durable pairing index.

Owner changes and app backgrounding cancel old work and close the viewer. Local and cloud native subviews remain available through their existing source menu. Thumbnail cache, backup and existing native viewer actions are reused; no WebView or second upload protocol is introduced.

## Automated validation

- Native iOS source/security contracts, plus executable Swift tests for SQLite persistence/100k reverse lookups and 100k cursor/filter behavior in the IPA workflow.
- Actual PostgreSQL tests for Owner isolation, stale revisions, ambiguity and a real iOS archive → index → PhotoAsset → bidirectional exact-match chain.
- Media parser tests reject malformed manifests, paths, duplicated members, wrong CRC, corruption and conflicting embedded Live identifiers; ordinary Gallery/preview and PhotoAsset reconstruction regression tests remain active.

Physical iPhone acceptance: **跳过（未验收）**.
