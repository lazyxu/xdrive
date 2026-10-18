# P64 · Quiet Source-detail navigation, collections and historical lists

**Date:** 2026-10-18. Frozen `master@da0ee01766626163a261b218f74d5aa3099baf53`.
Follow-up to merged P62 #2028 and P63 #2033. Scoped to the shared
`XDriveSourceManager` + `XDriveSourceDetailsDialog` used by Web, Mobile
Web/PWA, and Desktop. This is not a generic loading-state suppression.

## Confirmed pre-change defects

1. Opening Source details triggers authenticated reads for albums/collections,
   history and per-file failures. The existing `collectionsLoading` branch
   mounts an immediate in-flow `正在加载相册/集合` panel **instead of any
   accepted collection cards**, even during a refresh. That changes the
   dialog's content height for a presentation-only intermediate state.
2. Opening an album/collection inserts an immediate `正在加载集合成员` panel
   before a real page arrives; expanding a run similarly mounts two transient
   spinners for failure and skipped-item pages. Nested accordions can thus
   change vertical geometry twice before the data arrives.
3. History's first unknown `[]` uses `正在加载运行历史`, then can briefly
   claim `尚无运行记录` even if the Server rejected a first read. The
   `正在检查逐文件失败记录…` caption inserts an additional short-lived row.
4. Existing `loadRunHistory`, `loadCollections`,
   `loadCollectionItems` and `openDetails` promises could publish a late
   previous Source's results into the newly opened dialog. A polling history
   response could also supersede a newer manually requested page.

## Scoped implementation contract

- Render a stable first-frame **180px** Collections index slot, **160px**
  History slot, **120px** Collection Members slot, and **96px** run
  failure/skip slots. Their real request state is available immediately via
  `aria-busy`. Preserve the SAME minimum height for each verified empty result;
  otherwise quiet first-read would still shrink when a valid empty result
  commits. Do not mount a decorative loading label or spinner at 0ms/300ms.
- Preserve already accepted cards, member pages and history rows during
  refresh/pagination. An accepted canonical zero remains visible; a
  first-unverified/error response cannot be mislabeled as an accepted empty.
  Errors provide real retry actions for the first Collection/History reads.
- Reuse the exact existing Source adapter operations and pagination sizes.
  Scope-check Source detail promises on open/close with an identity epoch,
  history polling/pagination with a latest-request sequence, and Collection
  items per collection with a request sequence. Old success/error/finally must
  not replace newer state. Preserve the existing error notifications, run
  cancel buttons, selection, credential/authorization rules and all media
  thumbnails/posters.
- Keep the previous accepted file-failure summary hidden during pending
  recheck without inserting a transient caption; communicate network busy
  semantics on a layout-neutral container.

## Regression and release gates

The dedicated Desktop Node test mounts the **original** shared Details
Dialog, not a clone: first paint and a sustained 350ms wait, accepted zero,
authentic error/retry UI, retained previously accepted Collection/History
cards, initial/pending/accepted member range, and failure/skip first-read
slots. A separate controller source contract protects request scope and
original transport. The browser and Desktop continue to import the single
shared source manager, not divergent front ends.

Exactly one scoped work commit; require **new accurate-head full 76-job CI**
including Web, Desktop and Windows, PostgreSQL Go API Race, Rootless, build
artifacts, single-commit/Final Gate and current clean mergeability before
Ready/Rebase. No live iOS Safari/Android/installed PWA/WAN or physical
100k CLS/FPS measurement was performed by these source and mounted tests;
do **not** claim universal physical acceptance.

## First exact-head CI: correct obsolete Web GUI button-count test

The first source-exact P64 HEAD `e8de04bccbde06d4fae72616c9e4b9586f3ac897` triggered
[CI #39100071324](https://github.com/lazyxu/xdrive/actions/runs/39100071324).
The Web job failed in `web/scripts/check-gui-chinese.mjs`, not in the
Source/Agent runtime: its historic static assertion required **exactly six**
`<MuiButton` occurrences across the shared Source modules. P64 adds
two real, separately authorized first-read retry buttons for collections
and history, making eight. The old numeric oracle therefore rejected a
deliberate user-facing action and does not indicate visual regression.

Keep both original P64 production blobs and the mounted regression test
SHA-identical. Update only the strict Web source oracle to **exactly eight**
and assert the two concrete handler/text contracts so no other missing
button can be masked, plus this documentation. Rebuild exactly ONE work
commit on frozen `master@da0ee01766626163a261b218f74d5aa3099baf53`,
lease-replace only P64's branch head, and require an entirely NEW accurate
head 76-job CI incl Web, Desktop, Windows, real PostgreSQL Go API Race,
Rootless, single-commit and Final Gate plus clean current mergeability.
Failed, partial, cancelled or stale CI must not authorize merge.
