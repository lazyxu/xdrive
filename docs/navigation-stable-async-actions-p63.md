# P63 · Stable async action labels in Gallery Cleanup and Device Backup

Date: 2026-10-18. Frozen source parent `c86af745a5b48ae2cc506c5c4e125712b3815c10`. Scoped follow-up to merged P62 #2028.

## Confirmed sources of short layout shifts

- Shared `MediaGalleryCleanupIndexStatus.tsx` showed `检查中…`
  immediately when an index-status request began, replacing the much longer
  `查看索引状态`/`刷新索引状态` caption. On 320–390px Mobile Web this can
  resize the action and move adjacent header text even if the Server GET
  completes almost immediately. Wide Gallery already solved the equivalent
  index-action problem with a fixed progress slot in P54.
- Shared `DeviceBackupPage.tsx` changed its device folder-continuation
  button to `正在读取文件夹…` during each paged Server/Agent request. This
  changes an active card's button width during a navigation-like operation;
  it is not a network thumbnail that requires a visible placeholder.

## Scoped correction

- Keep the Gallery Cleanup index-action label unchanged for a pending read;
  use disabled plus immediate `aria-busy`, a non-hit-testing fixed 16px
  feedback slot, and the existing visual-only 300ms deferred hook. Actual
  Server query, error, accepted coverage numbers and retry are untouched.
- Keep the Device Backup folder-continuation action's previously accepted
  label, action target, and button dimensions unchanged while its original
  paginated read runs. Disable and set `aria-busy` immediately; only a
  completed accepted page may change `核对并加载` to `加载更多`.
  No Backend, Agent, cursor, account isolation, local backup controls or
  task cancellation code changes.
- Add a mounted-original Gallery Cleanup button timing regression (first
  paint, 35ms, 375ms, accepted result) and a Device Backup source guard.
  Keep P62 Files/Gallery first Range, 52px global App Frame, Web/Mobile
  shared MUI and thumbnail/poster progress untouched.

## Required release checks

One work commit, new full exact-head CI including Web, Desktop/Windows,
Go PostgreSQL API Race, Rootless, single-commit and Final Gate and current
GitHub clean mergeability before Ready/Rebase. Native physical iOS,
Android, installed PWA, real WAN/100k CLS/FPS remain NOT RUN and cannot
be inferred from synthetic or compiled-Chromium regressions.

## Continued source audit: actual Device Backup history collapse

The same device page also had a stronger transient-state defect: while loading
a new per-folder history page it unmounted **all previously accepted run rows**
and replaced them with `读取历史中…`. This causes a full accordion height
collapse and expansion on Mobile Web, Web and Desktop. It also immediately
changed the pager's displayed page number to the unaccepted target, and
rendered a false `暂无历史记录` before an initial authenticated read.

P63 extends its narrow Device Backup fix: retain the last accepted `items`,
`page`, `hasMore` and `verified` while pending; stage the newly requested
page until the winning Owner/Agent response; on failure preserve the old
history and show the pre-existing real retryable error. A first unknown history
uses one quiet minimum 72px `aria-busy` slot, a verified empty page remains
visible through refresh, and only an accepted empty response may claim
`暂无历史记录`. Preserve the existing request sequence and source isolation.
Also keep the bottom `加载更多设备` button label unchanged and use
`aria-busy` instead of its instant width-changing `正在加载更多设备…`.
No new transport or Source/Agent capability is added.

These extra real source findings are in scope of the original P63 page-stability
PR and share its new exact-head full-CI/clean-merge gate. Synthetic/source tests
do not establish physical 320–390px iOS Safari measured CLS.

## First CI: reject a faulty source-text selection, preserve product code

The original expanded-scope P63 work HEAD `b82623e3beb9670e1856a1b644b3902fb0afeaef` launched
[CI #39097644263](https://github.com/lazyxu/xdrive/actions/runs/39097644263).
`desktop-tests` reported **3,110 total, 3,108 pass, 1 fail,
1 expected skip**. The failing NEW P63 source oracle started its
string slice at the `data-xdrive-device-backup-more-devices` attribute,
which appears *after* `aria-busy={pageLoading || undefined}` in the real
Button. Consequently it falsely reported that the real attribute was
absent. This is a test-only range bug, not a measured app regression.

Keep both P63 production file blobs, original mounted Gallery Cleanup
timing test, the actual history pagination staging/owner fencing, and
all other tests unchanged byte-for-byte. Fix only the oracle to take
`lastIndexOf('<Button', marker)`, verifying the exact real MUI Button
from its opening tag through closing tag, without loosening any real
behavior requirement. Rebuild exactly ONE work commit on the same
frozen parent `c86af745a5b48ae2cc506c5c4e125712b3815c10`, lease-replace only this P63 work ref and
obtain an entirely NEW full exact-head CI including PostgreSQL API Race,
Web/Desktop/Windows/Rootless/single-commit/Final Gate plus clean
mergeability before Ready/Rebase. Old failed CI is not authorization.
