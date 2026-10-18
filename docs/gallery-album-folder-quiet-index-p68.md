# P68 · Quiet Album folder-index navigation beyond 300ms

Date: 2026-10-18. Frozen parent
`master@4256c79cfda68439b870e517b48f24983c8d25e5`.

## Residual source-confirmed intermediary

The single shared Gallery album-folder organizer (Web, Mobile Web/PWA,
Desktop) already has P58's one-row, scrollable 44px breadcrumb and a
stable minimum 88px album-folder navigation region. It reads the Server/
Agent folder hierarchy once per account/Port and then performs nested
folder navigation entirely on the authenticated accepted hierarchy.

Yet after an actual folder-list read was pending for >300ms the
organizer still mounted an absolute floating `加载相册文件夹…` spinner
over that navigation region. It no longer pushed rows down, but it
was an unnecessary intermediate visual state on a navigation-only
surface; a warm nested folder change never needed the spinner.

## Small change

- Keep the existing 88px folder navigation footprint and prepaint
  single-row horizontal breadcrumb. Mark the folder section
  `aria-busy` immediately while the genuine folder list request is
  pending. Remove only the decorative delayed `showDelayedFolderLoading`
  timer/use and its floating text/spinner overlay.
- Preserve verified current Owner/account/Port folder list before
  showing any authoritative empty folder count. Keep genuine failed
  folder-list error text, custom retry/write actions, current scope
  generations and FolderID guards. Do not issue extra requests or
  change album/media thumbnails, Live Photo/poster progress, People/
  Place index reads, virtual Gallery photo wall or Server/Agent APIs.
- Update existing P49/P50/P58 and album-folder quiet navigation
  regressions. P58's original mounted shared organizer now includes
  a **genuine pending folder-list Promise** held longer than 300ms:
  no spinner/status overlay, 88px stable minHeight, immediate busy
  semantics, only verified empty after response and exactly one list call.

## Release contract

One source-scoped work commit on a frozen master; require entirely NEW
accurate-head full 76-job CI (Web, Desktop/Windows, Go with real
PostgreSQL API Race, Rootless, images/artifacts, one-commit Final Gate)
and current clean GitHub mergeability before Ready/Rebase.

These are actual original shared component tests, but physical iOS
Safari, Android Chrome, installed PWA, weak WAN, 100k CLS/FPS and
literal iOS27 Photos 1:1 parity remain separately unverified.
