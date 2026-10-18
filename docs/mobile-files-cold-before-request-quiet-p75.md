# P75 · Mobile Web Files cold directory before request stays silent

Date: 2026-10-18. Initial frozen master: `a5cdefe73d7b65d22af0110185f5f2d7e96cc9da`.

## Status and source finding

P58–P74 Files/Gallery navigation-flicker work is CLOSED+MERGED after
source-exact full CI and remote branch cleanup. The actual original Mobile
Files component nevertheless treated **any** cold directory without a
counted `virtualCollection` and `loading=false` as a **terminal
unverified error**, immediately showing:
"文件夹内容尚未确认，请刷新页面后重试。"

This includes a valid initial frame before the current Owner's first
directory Range has been dispatched by the parent effect or before
a responsive route has established the first request. The short-lived
error is erased as soon as `loading=true`, visibly moving content.
Earlier P59 mounted tests covered loading=true → false (a real failed
read), but did not cover **false → true** at cold bootstrap.

## Narrow implementation

- Preserve the original 180px `data-mobile-files-cold-read-slot` and
  ONE actual FileExplorer scroll host at all times, without timers or
  spinner/status captions. Initial no virtualized Count and not-yet
  started `loading=false` is **unverified**, not a failure: it is
  a silent, truthful `aria-busy` region.
- Recognize a genuinely failed cold first Range only after this same
  component has observed a real `loading=true` cycle for the exact
  Owner/session, directory and arrangement (sort/group). If that
  attempt ends with `loading=false` and still no verified counted
  Range, show the existing terminal recovery message, not a fake
  empty directory.
- Fence the observed pending attempt when account, folder, sort or
  grouping changes. Do not reuse a previous directory's terminal
  state or scroll. A verified current counted zero still displays
  "此文件夹为空" (a content state), and a valid nonzero Range still
  displays real files.
- Preserve P69 single prepaint folder/crumb commit, all shared Web
  Controller/Go Server requests, AbortControllers, network thumbnails,
  media/video/Live Photo, legitimate Search/Trash wait/error states,
  actual transfer progress and the 52px App Frame. There is no new
  server call, no caching, no synthetic empty list and no time delay.

## Regressions and release guard

Extend the original mounted `desktop/tests/mobile-files-ios-runtime.cjs`:
unrequested loading=false first frame; held network-start delay >350ms
with same 180px quiet slot and no error; true loading→false failed
Range with actual guidance; sort-scope change discards prior error;
accepted counted-zero shows "此文件夹为空"; scroll host stays single.

Retain all prior P59 loading=true → false terminal-error tests.
Add source-contract assertions in the original P62 quiet-navigation
regression. Run entirely NEW accurate-head 76+ job CI including
PostgreSQL Go API Race, Web, Desktop Windows/Linux, Rootless,
artifacts, single-commit, Final Gate; require current GitHub
`mergeable_state=clean` before Ready/Rebase. Real iOS Safari,
Android Chrome, PWA, hardware 100k and weak-WAN CLS/FPS are
NOT RUN; source/mounted checks do not prove zero physical movement.


## P75 · composite busy is not a directory first-Range receipt

The real `web/src/WebFileExplorer.tsx` Mobile adapter passes a composite
`loading` Boolean containing **CloudFiles directory GET OR Search OR
FileOperation busy**. A background operation during an unrequested cold
directory could otherwise masquerade as a directory GET and then trigger
the original terminal-error copy when that unrelated task ended.

The adapter now additionally forwards only its original CloudFiles
controller `loading` as `directoryLoading`. The MobileFiles pending-
attempt receipt is authorized exclusively by this directory-specific
Boolean (with `?? props.loading` backwards-compatible fallback for
original callers/tests). The composite loading stays unchanged for
existing controls, Search, Trash and file-operation progress. The
original mounted P75 React regression now explicitly simulates an
unrelated Operation pending cycle and asserts it cannot trigger a
directory failure, before a real directory GET does so correctly.
