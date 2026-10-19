# P85 — silent target-folder navigation in FileExplorer move/copy picker

## Existing defect

The original shared `XDriveFileExplorerDestinationDialog` correctly retained its last authorized breadcrumbs/rows and a **fixed 4px** status strip during target directory navigation, but rendered a `LinearProgress aria-label="正在加载文件夹"` after a decorative 300ms timer for ordinary folder reads. This violates the [P78 permanent no-jitter/no-ephemeral-frame contract](../AGENTS.md) even though the strip was positionally reserved. A slow Server request is not the same as a real user-invoked transfer.

## Fix and acceptance

- Remove only the decorative 300ms timer, its loading generation and visual progress, keeping the existing stable **4px** slot `data-xdrive-destination-quiet-loading` and truthful `aria-busy` while the current request is pending.
- Keep last accepted destination path, folder rows, current page/cursors and dialog identity until a current Server response commits the target. Pending folder reads still disable target submission.
- Preserve actual load errors, retry of the intended pending target, cancellation/close session fences, Owner session, 44px touch controls and real **task submission progress**. No Server/Go/IPC/request-count/virtualizer changes.
- Extend the **original** mounted shared React dialog suite `desktop/tests/shared-file-explorer-destination-dialog.cjs`: hold the child folder GET >365ms, assert one identical 4px slot with semantic busy, zero delayed loading bar, unchanged rows, terminal error and successful retry, then `aria-busy` reset. Existing paged cursor, stale response and operation tests remain.
- Source-exact full CI, Web/Desktop Linux/Windows, real PostgreSQL API Race and Final Gate are required for merge. Genuine built-Chromium 375/390/899px target picker, native iOS Safari/Android, PWA and physical weak-WAN/100k CLS/FPS are **NOT RUN**.

This is a narrow independent follow-on to [P84 routed Viewer first reads](https://github.com/lazyxu/xdrive/pull/2107); no other owner's Gallery/Files/LocalPush/performance/race PR is modified. The evergreen [P78 navigation contract](../AGENTS.md) already forbids this exact transient loader, so this PR intentionally changes only original source, original mounted tests and documentation instead of creating an overlapping `AGENTS.md` conflict with ongoing P84/P83.

## First exact-head CI failure and corrected mounted assertion

[P85 original 77-job CI #39186370927](https://github.com/lazyxu/xdrive/actions/runs/39186370927) (head `cc7bbcbcca56dc98ce33116a40d60bb5a7593c9b`) completed with 23 success, 2 fail (`desktop-tests`, consequential `final-gate`), 52 conditional skips. The **only direct failed test** was the new P85 mounted check reading `slot.props.sx.height`: MUI consumes `sx` and generates CSS classes, so the real DOM host does not expose `props.sx` and threw `Cannot read properties of undefined (reading 'height')`. Original FileExplorer destination navigation/request/Retry assertions were not shown to fail. Keep the actual fixed DOM slot presence/identity and >365ms silent GET checks; assert the canonical source `sx={{ height: 4, flexShrink: 0 }}` independently instead of assuming runtime DOM `sx`. This corrects the invalid test oracle without modifying the production renderer. Prior CI stays RED, requiring an entirely NEW source-exact full CI before Ready/Rebase.
