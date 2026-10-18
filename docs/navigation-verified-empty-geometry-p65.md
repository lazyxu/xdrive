# P65 · Verified empty/error must preserve the first-read content geometry

Date: 2026-10-18. Scoped baseline
`master@bfd35624d425408ee39baf6e30124a847b36a602`.
Complements merged P62 #2028 and P63 #2033. Independent of Source
Detail P64 #2040 and of ongoing Places, admin, race, performance and backup PRs.

## Source-confirmed residual layout shift

- Shared Web/Desktop FileExplorer renders a silent **180px** cold Directory
  Range slot but replaces it with an unwrapped `XDriveStatePanel` on
  a verified zero. The latter has only its own padding/line-height, not
  the original minimum height, so an authenticated empty folder can make
  the content region collapse vertically even though P62 removed the
  intermediate loading spinner. This also affects genuine empty search
  results; Mobile Web already retains the same 180px wrapper (P61).
- Shared Gallery first photo Range owns a silent **220px** slot, but
  a real empty response switches to an **180px** Paper and a terminal
  load failure to a **200px** Paper. This makes the photo wall shrink by
  up to 40px/20px (subject to actual content height) just when a true
  Server reply arrives. A layout mismatch is not a thumbnail progress
  signal and is not addressed by a 300ms spinner delay.

## Narrow correction

- Keep the FileExplorer terminal `XDriveStatePanel` and its message
  unchanged inside a new explicitly identifiable 180px verified-empty
  content slot. All 180px cold, Trash-error and accepted-zero branches
  now have the same geometry floor. Do not claim an unverified read as
  empty, change sparse Range, mutate navigation state or add network calls.
- Set Gallery real empty and initial failure panels to the same
  **220px** minimum as the cold slot. Preserve the actual empty/error
  text and buttons, authenticated Owner and collection key, virtual
  thumbnails/posters, Live Photo/video and Viewer anchor semantics.
- Add P65 source contracts matching the *original shared components*
  and confirming Web/Desktop share them, Mobile Files remains unchanged,
  no artificial first-Range progress is reintroduced.

## Acceptance limits

Require one scope-only commit and NEW entire 76-job accurate-head CI:
Web TypeScript/lint/build, Desktop tests/Windows, real Go/PostgreSQL
API Race, Rootless, images/artifacts, single-commit/Final Gate, plus
GitHub current clean mergeability before Ready/Rebase.

Identical `minHeight` rules prevent a known authored
CSS geometry discontinuity but do NOT prove physical iOS Safari,
Android, installed PWA or 100k/WAN CLS/FPS acceptance; natural
content taller than the reserved slot still changes to the size of
the actual content. Those physical scenarios remain NOT RUN.
