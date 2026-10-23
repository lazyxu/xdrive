# PWA P1-02 · Shared Web/Mobile route-level dynamic bundles (2026-10-23)

Candidate only: preserve a SINGLE Web App and identical REST/Owner ACL/Range/
VirtualGrid/controller logic, while deferring the costly Files, Gallery, Viewer
and selected administrator presentation modules until navigation. The Viewer
route classifier is MOVED without logic changes to a small shared helper.
`useXDriveWebAppRuntime` uses `startTransition` for route state updates so
React may retain the previously committed view while the new chunk loads.
Initial deep links reserve a full-size silent slot, with no artificial spinner.
The same 52px mobile header, local upload tasks and Viewer return identity remain.

This is NOT automatically a performance improvement. Before merging, run
normal exact-source production bundle with real native Chromium SAME Runner
BEFORE=parent master and AFTER=this PR (390/430/899/900/1280 x n3),
and full original 390px Files↔Gallery real navigation and Go Owner ACL negatives.
Do not keep the candidate if first visible or warm app navigation regresses,
the initial compressed App Shell has no meaningful reduction, or files/gallery
first navigation, upload/Viewer, cancellation and permission checks fail.
Private media and signed APIs remain network only; SW public precache never
automatically deletes historical hashed chunks.

No physical iOS/Android installation was run. Inaccessible production-only
security acceptance is SKIPPED (UNVERIFIED) by owner decision and never a
source/CI gate. Real code-level Owner/security and exact HEAD CI are required.

The exact-source contract also checks that the unchanged public Service Worker
has no forced activation and that the public shell builder excludes optional
Vite dynamic imports. Neither a smaller initial bundle nor a successful native
Chrome UI simulation authorizes caching private media or deleting old chunks.

Initial native CI on the first source-exact candidate failed Vite module resolution:
`ui/shared/src/mui/MediaGallery.tsx` imported by a filesystem-relative dynamic
import could not resolve workspace `@mui/icons-material`. The candidate now
uses the explicit `@xdrive/ui/mui/gallery-page` package export to keep the
existing workspace package resolution and its peer dependencies. This changes
no Gallery rendering/controller code; a fresh build and same-Runner test are
mandatory, prior RED remains historical evidence.
