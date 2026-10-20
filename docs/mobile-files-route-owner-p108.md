# P108 · Mobile Files URL and verified visual directory have one Owner

## Scope and defect

P107 already prevents an unverified saved-directory resume from painting the bootstrap root's rows or false-ready title. In the original shared Web adapter, however, a separate `onDirectoryChange` effect could still mirror the provisional CloudFiles root into `?dir=root` before the persisted different saved directory's first counted Range had been accepted. That fabricated URL then looked like a fresh external directory intent and could reset scroll or supersede the real restore.

Conversely, after the user abandoned an unverified saved restore by switching to Recent, Favorites, Browse Home or Search, the old authenticated CloudFiles GET might still finish and commit its previously requested directory. The Mobile UI correctly retained the chosen rail, but the Web outer route could mirror the stale folder ID and open Browse again. Neither problem is solved by simply hiding a 300ms spinner.

## Scoped behavior

1. On an unparameterized compact Files launch, read the existing per-account saved last-folder ID. A current `savedResumeRouteGuardRef` distinguishes a different provisional bootstrap root from a genuinely accepted directory. Do not mirror that provisional root to the App URL. On accepted, rejected or superseded restore the guard is released; an explicit cloud-root tap releases it immediately. Existing direct deep links and wide Web behavior retain their routing authority.
2. While the original `CloudFiles.loading` is true, do not mirror the still-displayed *previous* directory into the URL. Only the matching current authenticated first Range qualifies as a new directory receipt.
3. Mobile Files calls the original Web navigation Owner when a user expressly abandons a cold saved-folder restore to change rail, go Home or search. The owner advances its existing navigation-intent fence without creating a new CloudFiles GET. If the old saved GET later commits, suppress only that outdated folder ID while the abandonment generation remains current; a later genuine directory request supersedes the fence.
4. Keep P107's one-time `?dir=saved-folder` acknowledgement. A URL written by App after the already-accepted saved folder is NOT a fresh user request to scroll to zero. Do not change the real Server `totalCount`, virtualizer, sparse Range, thumbnails/video/Live Photo, upload/download/sync, Search/Trash or the single existing Mobile scroll host.

## Focused original tests

- The existing actual `desktop/tests/mobile-files-ios-runtime.cjs` mounted MobileFiles suite must report exactly one owner-abandon callback when a pending saved resume switches to Recent and ensure an older accepted or denied Promise cannot restore Browse, erase the saved folder ID or strand the next Browse Home.
- Extract and execute the **original Web route predicates** from `web/src/WebFileExplorer.tsx` across pending bootstrap root, accepted saved folder, explicit `?dir` deep link, wide layout, current abandoned intent, superseded old intent and unrelated directory. Verify the genuine `CloudFiles.loading` guard and Web callback wiring.
- P78–P107 original mounted and source-contract tests remain active; do not remove a failed test, hide a real failure or substitute a copied reducer for original component behavior.

## CI / platform evidence

The P107 source-exact [77-job CI #39365262418](https://github.com/lazyxu/xdrive/actions/runs/39365262418) passed (25 success, 52 conditional skip) before P108. It is **not** P108 approval. Require a fresh full exact-P108-HEAD CI, real PostgreSQL API Go Race, Linux/Windows Web/Desktop, Rootless/images/installers, one-commit and Final Gate, plus current GitHub clean mergeability before release.

Native iOS Safari/Android, installed PWA, arbitrary WAN latency and true physical 100k CLS/FPS have not been exercised by this change; report **NOT RUN** until measured. This is a narrow route/presentation fix, not a universal claim that all xDrive pages are physically jitter-free.
