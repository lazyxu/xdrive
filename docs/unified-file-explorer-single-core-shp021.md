# SH-P021 · One FileExplorer Core for Share folders (real 100k physical gate)

> **当前统一架构合同（2026-10-22）：** [Owner/Share 共用 FileExplorer Core](unified-file-explorer-core.md)。它列明已合并的 Core/七项 Go grant、Owner 稀疏 Range/Share 游标页、临时 HTTP 与 durable Task 取消边界，以及仍未完成的 Share 单文件外层、全子树 Search/Sort 与真正 preview-only。以下原有段落保留历史阶段证据，不应当作新的当前状态。

## Why this slice

There is already one common capability contract (SH-P020), but
`XDrivePublicShareReadOnlyExplorer` still used its own independent
Grid/Details renderer. Merely forwarding `readOnly=true` would duplicate
presentation, virtualized media lifecycle and future bug fixes.

This scoped production change makes an **authorized Share directory** mount
the existing `XDriveFileExplorer` component that renders authenticated Owner
Grid/Details, selection, thumbnail admission, preview and properties.
`PublicShareReadOnlyExplorer` remains a Share-aware *facade* so the existing
share password, expiry, quota, single-file link and durable ZIP UX are not
silently removed. For an opened directory it returns the unified Core, not
the legacy directory rows. This is an incremental migration, not yet removal
of the old facade/single-file display source.

## Source boundaries and capability rules

- Account source continues to call Owner JWT/ACL APIs; no Share token enters an
  authenticated Owner API, column Agent IPC or FileOperation transport.
- Share source still calls only `createPublicShareFileExplorerAdapter` →
  `api.publicShareChildren` (server-bound 100-row cursor), Share-scoped signed
  derivative/preview/download/ZIP operations. `XDriveFileExplorer` itself
  imports no authorization credential.
- At most 100 authorized entries are mapped for the current page. The shared
  Core receives only this window, never 100k cached objects. Existing Share
  previous/next cursor history and root-limited server browsing are unchanged.
  Current-page filter and sorting are **not** advertised as server subtree
  search or global ordering.
- The seven neutral UI capabilities stay independent. Default read-only
  grants include original download + ZIP. No Share write/delete/move/rename
  callbacks exist; browser flags are *not* server authorization. Future
  preview-only/no-original download requires Go-side signed URL, ZIP, Range,
  revocation/expiry checks first, not just a hidden button.
- Grid/Details use the Owner Core's thumbnail admission, bounded six-in-flight
  queue, scroll idle delay and provider cache. Existing Share `loadThumbnail`
  continues to propagate its AbortSignal to Share-only signed GET; obsolete
  thumbnails cancel **synchronously at navigation** via P018's
  `activeThumbnailRequests`. User-initiated downloads, ZIP preparation,
  sync/upload/delete jobs are *never* canceled by viewport unmount.
- File and folder right-click download only resolves an entry from the
  *currently accepted bounded page*. Multi-selection downloads remain
  explicitly disabled until a complete server authorization and batch task
  model exists. Share folder ZIP still uses the server durable task and
  explicit Cancel.

## Accepted BEFORE/current performance

- Source-exact SH-P018 100k physically different JPEG matched real Go
  cancellation, n9 per width/arm on the same runner:
  1440px P50 **127.940 → 55.371ms (-56.7%)**;
  390px P50 **113.940 → 49.701ms (-56.4%)**;
  CPU/RSS no material regression, 0 abandoned bytes.
  Source `fb2b96b8fa714a61e631bad53a32c4e759520684`,
  [CI #39610524239](https://github.com/lazyxu/xdrive/actions/runs/39610524239).
  The real six-case Go Context.Done suite
  [#39610524684](https://github.com/lazyxu/xdrive/actions/runs/39610524684)
  is also green, max 64.063ms.
- Prior SH-P020 source-exact public Share real 100k JPEG,
  `11acc180accd66552ac84029a1897a323f1ad71d`:
  first page maximum **384.662ms**, next page max **267.723ms**,
  signed original SHA download max **173.868ms**, n3 Web1440+n3 CDP390,
  [#39610665325](https://github.com/lazyxu/xdrive/actions/runs/39610665325).
  This is a historical regression baseline, **not a matched comparison** to
  the new unified mount.
- Existing Owner 100k logical / 115k physical JPEG/H264/Live Grid/Details
  and true 4 GiB Web/Desktop upload/download P50 are independent prior
  workloads. P021 does not edit CAS/Go/Agent/upload/download worker hot paths.
  Re-run when the exact merged Core commit is established; no guessed speedup.

## Current AFTER/acceptance requirements

At initial PR creation P021 **AFTER=N/A**. An exact HEAD opt-in
`sh-p021-unified-share-physical-100k.yml` job must verify genuine
Postgres17/Gin/LocalCAS 100,000 distinct physical JPEG originals; six actual
Chromium Web1440/CDP390 sessions; every authorized page exactly 100 bounded
rows; actual common Core DOM; original SHA/filename/bytes of 12 browser-native
downloads; no stale rows, no horizontal overflow, original 2s page and 5s
download budgets unchanged. Do not count generated fixture pixels as 100k
simultaneously decoded thumbnails. The new production Core must stay within
frozen budgets; diagnose real failures, never relax assertions.

P021 is a **functional consolidation**, not an approved throughput
optimization. To claim speedup, measure original and candidate on the SAME
runner, same data, same visible positions, n>=3 with real CPU/RSS and network
bytes; only retain material improvement without resources/integrity/auth
regression. Stop at Draft on failing exact-head specialty or full CI/Final Gate.

## Follow-ups not claimed complete

1. Remove legacy single-file Share renderer after its preview/ticket/password
   tests can use the same Core without regressing native-browser downloads.
2. Give both sources a server-returned capabilities schema with genuine
   Share root-scope, authorized preview-only denial across direct original,
   signed ticket, Range and ZIP APIs; tests for revoke/expiry/password/Owner.
3. Add Share-limited **Go/SQL full-subtree** search and sorting with real 100k
   E2E. A 100-row local filter is not that feature.
4. Complete separate genuine desktop/web mixed 100k video/Live poster/viewer,
   4 GiB high-entropy transfers and cancel, 100k sync/delete baseline suites.
   Existing performance-only work does not change Race sources.
5. Production-only inaccessible security acceptance is
   **按用户决定跳过（未验收）**, never a blocker to code tests, CI or PR
   merges; source Owner/Share isolation and revocation remain mandatory.

Dependencies: SH-P018 #2275 → SH-P020 #2290 → this SH-P021 stacked PR.

## Original full exact-head 100k physical browser and Go-cancel evidence

Actual prior original common-Core HEAD `6fb2595063edf9faba8758580862b8fe8e6beebc` passed [full 77+ CI/Final Gate #39634898054](https://github.com/lazyxu/xdrive/actions/runs/39634898054), [real 100k physical-JPEG six Chromium sessions #39634901280](https://github.com/lazyxu/xdrive/actions/runs/39634901280), and [real signed cached thumbnail→Go Context.Done six scenarios #39634900703](https://github.com/lazyxu/xdrive/actions/runs/39634900703).

The real 100000 distinct physical JPEG Share fixture, one bounded authorized 100-item page and actual common Owner Core DOM yielded **395.878ms first-page worst / 66.357ms next-page worst / 294.762ms original download worst** across the reported sessions. These are **MAXIMUMs, not P50s**. All 12 downloaded originals passed SHA and native filename, and frozen <=2000ms first-page / <=5000ms download gates held.

Go Context.Done/HTTP Handler cancellation genuinely fired **6/6** (1440px and 390px, actual scroll-out/pagehide/bounded-next-page) with maximum **46.474ms**, 0 discarded body bytes; bounded signed derivatives were only 16 cached real images, not 100000 simultaneously decoded thumbnails. This is a genuine real Go/CAS/Chromium source-exact regression measurement, not a same-runner throughput optimization BEFORE/AFTER. It does not establish all Live/video codecs or arbitrary window switches.

**Accurate-head discipline:** this later one-work branch has been restacked on newer complete master with only the original ten scoped implementation/test/workflow/doc files; historic successful earlier SHA does NOT grant this new SHA permission to merge. Require new exact-head both 100k opt-in jobs and full CI/Final Gate and fresh clean mergeability. No Race, Go worker, durable Transfer/ZIP, or unauthorized Share endpoint changes. Current single-file legacy Share facade, global full-subtree search/sort and configurable server no-original preview grants remain UNIMPLEMENTED; #2312 follows this PR. Inaccessible production-only acceptance: **按用户决定跳过（未验收）**.
