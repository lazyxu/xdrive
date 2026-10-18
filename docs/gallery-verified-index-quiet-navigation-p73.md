# P73 · Verified Gallery index navigation, silent People/Places cold reads

Date: 2026-10-18. Initial frozen source baseline `master@48c97eeedaf787771c231bf701f3350e3b5c320f`.

## Audited current state

The earlier P58–P72 shared Web/Mobile Web/Desktop stabilization series
already removed ordinary folder and album navigation-loading captions,
stabilized cold virtual photo/file wall geometry, and added authorized
readState on the Files sidebar. The existing Gallery controller still had
two verified-content gaps:

- The Memories child received `memories=[]` plus `loading=false` on
  the first rendered frame, before the root's actual asynchronous
  `listMemories` call started. It immediately advertised the permanent
  "还没有可生成的回忆" state and then erased it when `loading=true`,
  creating the user-visible false-empty bounce. Warm Mobile Collections
  previews are not a canonical 48-item Memories index.
- Cleanup similarly received `bursts=null, loading=false` before its
  first `listBurstReviews` call, briefly displaying "结果尚未确认，请重新检查"
  as if an error had already happened, before the actual request began.
- People and Places first-index roots already had fixed 160px panes and
  actual errors/verified empty guards. However after 300ms their
  first-read panes added ornamental "正在读取人物…" / "正在加载地点…"
  circular indicators. This was an unnecessary intermediate visual
  transition unrelated to thumbnail, poster or transfer progress.

## Correctness and UX contract

1. Memories and Cleanup receive a **current user + exact DataSource**
   read receipt: unverified / ready / error. The first screen is always
   a quiet 180px region until a successful authoritative GET; `[]` or
   `null` alone NEVER prove zero. Failed first GET preserves actionable
   original retry/errors; a later real accepted zero shows the empty text.
2. Only the current `requestID` may mark an accepted receipt. Late,
   superseded results are ignored. The parent gates child entries on the
   current Owner/source receipt **before painting** so old-user cache
   cannot appear during a scope change.
3. A same-account successful empty index is content: keep it visible
   during a refresh rather than reverting to a spinner/blank interim.
   A failed refresh may retain previously verified entries and surface
   a real error. The mobile Cleanup-from-Collections bounded 48-item
   first GET must mark its receipt at the same atomic section commit;
   it does not add another request or reset the sparse Library.
4. People and Places first-index renders keep their existing 160px
   panes, busy semantics and real errors but never mount delayed
   decorative progress/text. Places **pagination** keeps its existing
   fixed 18px delayed progress slot; actual network thumbnails, videos,
   Live Photo, uploads/downloads and transfer progress remain untouched.

## Scope, tests, and release

Edit only the original shared `MediaGallery.tsx`, Memories/Cleanup
children, prior P49/P50/P70 source contracts, prior P70 mounted first
read and new P73 original-component mounted/source regression. Do not
touch map JSAPI/permissions/BD09 semantics, A3 branches, Go/Agent REST,
the App Frame (52px), virtual list, Gallery Viewer or Files P72.

P73 regression holds unrequested states with `loading=false` and a
sustained 365ms real pending window, then verifies error/retry, actual
accepted zero and retained verified empty during refresh. It also
asserts current owner+source receipt gates in the original controller,
and that People/Places initial ring/text are absent while real Places
pagination feedback survives.

Exactly ONE scoped work commit on a frozen master, wholly NEW 76+
accurate-HEAD GitHub CI (PostgreSQL Go API Race, Web/Desktop/Windows,
Rootless, images/artifacts, single-commit/Final Gate) and fresh
mergeable_state=clean before Ready/Rebase. Physical iOS27 Safari,
Android, installed PWA, slow WAN, real 100k/CLS/FPS and OS preview
behavior remain NOT MEASURED. This work does not by itself prove
literal iOS27 Photos 1:1 parity or universal zero layout shift.
