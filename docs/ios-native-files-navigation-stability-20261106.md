# iOS Native Files: Navigation stability, clipboard and regression matrix (2026-11-06)

Base: master@2847597d3794951c9926f75a6a84ce4121065997.

This PR is **the first batch**, not all ten parity gaps. Native SwiftUI remains authoritative. Existing Server Writer, Owner identity, Node revision and CAS continue to own every mutation.

## Implementation

1. Fixed the navigation teardown hazard: the previous onDisappear invalidated the entire List while a row-owned NavigationLink was pushing its child. Navigation now cancels in-flight directory/range I/O without deleting the already verified source rows. Owner change and explicit refresh still invalidate.
2. On re-entry, only reuse the previous directory if Owner, folder ID, search query/filters and sorting all match the verified Server scope. Pop navigation does not unconditionally fetch the same 64 rows again.
3. Reuse ephemeral, cookie-free, cache-free URLSession transports for directory ranges and thumbnail reads; keep reject-redirect policy and per-request bearer.
4. Keep a bounded tile's decoded thumbnail while navigating, but render it only when Owner, root, server, Node and revision still match.
5. Coalesce only simultaneous verifiedAuthorization requests within one login generation; retain the real HTTPS Server Owner/root verification and cancellation/generation fences. There is no timed authorization cache.
6. Defer irrelevant Source/Tag search-option reads until an explicit advanced filter action.
7. Remove duplicate management-sheet refresh.
8. Add Owner-scoped, in-memory Native Files Cut/Copy/Paste using the existing atomic batch destination writer, with explicit user confirmation and no uncertain-write retry.
9. Connect batch tag selection to the existing Owner-scoped native tag editor and Server tag API.

## Automated checks

- Executable pure Swift resume policy: verified/unverified, loading, Owner mismatch, folder mismatch, search/filter/sort mismatch.
- Node contract tests: source NavigationLink persists during push, Owner change clears rows, returned pages reuse verified state, thumbnails maintain Owner/revision identity, network sessions reject redirects and cache, clipboard limits and mutation receipt reuse, coalesced verification preserves Owner/root checks.
- Existing native page/range, Tags, BatchTarget, Thumbnail and IPA build contracts remain required.

## Manual device acceptance (NOT YET VERIFIED)

| Test | Required result |
| --- | --- |
| Browse > Cloud > A > B > back to A | B opens, A anchor/rows remain; no source-row deletion |
| Rapid A/B open/back, network slow/403, tab-switch | Correct folder/Owner, no ghost rows, no blink loops |
| 100k directory scroll >256 rows, nested folder, return | Bounded memory, valid anchor, no unintended first-page jump |
| 20 JPEG / video posters, Viewer open/close | No repeated cold images on each navigation; canceled stale reads |
| Copy 1/200 items from A to B, Cut A to B | Exact Owner/Node/revision receipt; unknown result never retried |
| Paste in same directory, to ancestor, Owner changed | Invalid moves disabled, Server rejects cycles, no old-owner writes |
| Batch tag 200 items, disconnect, switch Owner | Bounded IDs and confirmed authenticated writes |
| Real iPhone portrait/landscape, VoiceOver, Dynamic Type | Readable menus, return, focus, no inaccessible action |

Device-level tests and paired latency/memory measurements are **跳过（未验收）** until run on a real iPhone. No performance-speedup percentages are claimed without at least three paired measurements on the same dataset and runner.

## Still outstanding (separate scope)

Native Smart Folder CRUD, Browse home group/order editing, cross-window selected-ID retention and authoritative selection snapshots, inline folder disclosure, server grouping, generic operation Undo/Redo, direct path entry, and full device screenshot/accessibility parity.

Never merge before the exact PR HEAD's applicable Xcode Swift build, CI and Final Gate pass. Queued jobs are not success.
