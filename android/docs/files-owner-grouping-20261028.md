# Android Files grouping · Go Owner full-index parity (2026-10-28)

Native Compose Files reuses Go's existing grouped `/nodes/:id/children`
range and `/children/position` contracts. It deliberately does not sort
or group only the locally loaded 100 entries. The iOS PWA source of truth for
group keys and labels is `ui/shared/src/file-explorer-grouping.ts`.

## User behavior and invariants

- `排序与分组` offers `none`, `type`, `modified`, and `size`
  alongside the previously implemented four sort keys, direction and
  `folders_first`. Folder and file row order follows the Go Server's
  SQL ordering; no independent Android grouping or file-type lookup.
- First grouped Range returns `groups[]` with true Owner-wide
  `key/item_count/start_index`. The Android parser checks a contiguous,
  nonoverlapping exact partition matching `total_count`, legal group
  keys, unique IDs and bounded cardinality. A malformed/missing nonempty
  index fails closed. Go legitimately omits empty groups for empty folders.
- Only loaded visible-window segments become native list/grid headers.
  A window anchored at item 89,995 can render its actual indexed group
  without loading earlier files. The underlying LazyColumn and LazyGrid
  remain virtual; header rows span the full grid width and have stable
  keys distinct from original Node IDs.
- Next/previous 100-item pages keep the original complete group index.
  A deep `Show in Folder` uses the authenticated single-Node position
  to fetch the exact offset page and, if necessary, **one** offset-zero
  page to retrieve the same Owner group index. No O(100k) sibling scan.
- Changing grouping commits only after a verified new first Range;
  failed GET retains the old arrangement, list and anchor. Existing
  cancel-generation, revision/Owner identity and no-write-replay rules
  are unchanged. Active SAF uploads/downloads and unresolved writes
  never become discardable GETs merely because grouping is enabled.
- No new backend endpoints, stores, account metadata, MediaStore
  permissions, Caddy access, proxy or writer are introduced.

## Tests and evidence

- Core MockWebServer: full Go grouped response, position query parity,
  empty-folder omitempty, malformed/double/group-gap and canonical key
  validation; Owner authorization never moves to query parameters.
- Controller JVM: grouped paging and position 155 using the real
  metadata source, one extra group-index fetch and no incorrect
  local grouping after missing metadata.
- Pure JVM: mixed/group-boundary and deep-offset heading projection,
  stable file keys and iOS PWA canonical Chinese labels.
- API35 Compose: native `排序与分组` dialog, genuine Server response
  and same group headers in list/grid.

This is a stacked Android-only change building on Files Server sorting
PR #2920. It must not be merged before #2920 is integrated and its own
**exact HEAD** Android JVM/Core/lint/APK/API35 checks pass. Physical
OEM/iOS screenshot 1:1, real 100k timings and production Owner CA are
**跳过（未验收）**; this document does not present them as green evidence.

## Stacked PR CI routing

PR #2924 is explicitly dependent on #2920. During Android verification the
Draft PR may temporarily target `master` so GitHub's master-filtered
`pull_request` CI actually runs the combined sort+group source. This does
**not** authorize merging the dependent PR first. When #2920 is integrated,
its previously verified sort code must be removed from the #2924 diff by
reparenting the grouping change to current master. The post-reparent exact
HEAD needs a fresh GitHub status check before release.
