# P77 · Shared wide FileExplorer quiet first Trash read

Date: 2026-10-18. Frozen source baseline: `master@bec658cfefde9c424d3f5b4b3d7d2215a3edbb32`.

## Current progress and actual defect

P69–P74 are closed/merged. P75 #2074 is a separate Mobile Web
cold-folder before-first-Range correction. P76 #2076 has merged its
Web legacy Sync Folders redirect. This P77 is deliberately **not** a
duplicate of either: it fixes the original shared wide Web/Desktop
FileExplorer first-visit Trash reader and does not edit MobileFiles.

The original `FileExplorer.tsx` already distinguished current-Owner
`emptyReadState=unverified|ready|error` from accepted empty. The
existing 180px unverified slot nevertheless inserted a decorative
`XDriveStatePanel loading message="正在读取回收站…"` after 300ms,
creating an avoidable intermediate visual state. Worse, the
unverified pre-request frame had `loading=false` so its `aria-busy`
became undefined even though the Server had not certified the index.

The same display timer ran even when `logicalItemCount===0`;
only the populated-list 2px status genuinely needs delayed feedback.
The timer could otherwise schedule an unnecessary React render at
300ms during a cold first Range or Trash read.

## Exact scoped correction

1. The shared unverified Trash first-read Box remains one fixed,
   **180px**, noninteractive silent region for the whole current
   Owner GET. `aria-busy` is true for unverified state even before
   `loading` starts and during pending retry. It no longer mounts
   any "正在读取回收站…" label or spinner after 300ms.
2. Schedule the original 300ms decorative timer **only when**
   `loading && logicalItemCount > 0`. The original 2px overlaid
   `正在刷新文件` remains for a prolonged genuine refresh with
   existing content, and disappears on completion. No global timer
   or transition disable.
3. Preserve the original Trash `unverified|ready|error` receipt and
   validated Owner query keys, accepted-zero message, real 44px
   error/retry and `XDriveStatePanel` for permanent empty display.
   Keep original sparse virtual ranges/200-item pages, cancel,
   thumbnail, Live Photo, video poster, uploads/downloads and transfer
   controls. Web/Desktop adapters and Server/Agent APIs stay unchanged.

## Source-exact validation and release

Update original `desktop/tests/file-explorer-wide-trash-quiet-first-read.cjs`.
Add `desktop/tests/file-explorer-wide-trash-quiet-navigation-p77.cjs`
using the TypeScript TSX parser on the **original shared component**
to verify an actual self-closing unverified Box, matching fixed geometry,
busy semantics, no intermediate child status and no zero-item timer.
The regression also verifies actual Web/Desktop adapters and the
original Trash controller, preserves error/retry, thumbnails and the
real populated-list refresh progress.

These are original-source/AST validations, **not** measured physical
360px iOS Safari frame-time/CLS data. P75 retains its independent
mounted original MobileFiles tests. The entire P77 work must remain
a single scope-only commit on frozen master with fresh accurate-HEAD
77-job CI: PostgreSQL Go API Race, Web/Desktop, Linux/Windows,
rootless Caddy, images/artifacts, single commit, Final Gate plus GitHub
`mergeable_state=clean` before Ready/Rebase. Do not reuse earlier CI
or overwrite P75, A3 map, LocalPush, Host, Perf/Race work.

## Follow-up physical acceptance not yet performed

Real mobile iOS Safari/Android Chrome/PWA, 100k mixed photos/Live Photo/
files/video, weak WAN, retained scroll-anchor, CLS and FPS screen capture,
VoiceOver/TalkBack and actual-device transfer cancellation are NOT RUN.
A green source/CI gate is not proof that all UI shaking is eliminated.
