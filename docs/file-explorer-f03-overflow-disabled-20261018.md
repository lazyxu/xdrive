# F03 follow-up · FileExplorer wide command overflow disabled reasons

**2026-10-18 · scoped candidate, not a physical or CI acceptance claim.**

## Confirmed before-change gap

F03's shared file context menu already used `disabledReason` with visible text and keyboard-accessible disabled entries (#1769/#1784/#1969 merged), but the separately mounted, **shared Wide Web/Desktop FileExplorer command-bar overflow** still emitted bare disabled MenuItem elements for Undo, Redo, Paste and Refresh. Those buttons did not offer a visible explanation and did not opt their Menu's disabled entries into keyboard focus. This is a distinct presentation gap, not a Server permission or Agent capability regression.

## Minimum repair

The same original `canUndo`, `canRedo`, `canPaste`, `loading` booleans still decide availability. Four scoped neutral, current-state messages are passed to the already-shared `xDriveFileExplorerMenuReasonLabel`, rendered as visible MUI `ListItemText.secondary`, exposed via `aria-label` and `title`, with `disabledItemsFocusable=true` on this Menu. All four original action callbacks, original menu visibility, 900px responsive breakpoint, virtual list, Server ACL and permission flows remain byte-identical. The messages **do not infer an ACL denial** when the business layer supplied only a disabled boolean.

The preexisting `desktop/tests/file-explorer-disabled-menu-reasons.cjs` tests retain F03 authorization and Mobile/Desktop source invariants, plus a new scoped contract checking all four original predicates, real callbacks, visible/ARIA reason and keyboard focus. No additional REST/IPC, state/store, Task Center write, polling or format work.

## Verification and release boundary

Require exactly one work commit from a frozen master, NEW accurate-head full 76-job GitHub CI (Web TypeScript, Desktop/Windows, Go PostgreSQL API Race, Rootless, single commit, Final Gate) and clean mergeability before Ready/Rebase. Static Node test plus desktop CI are **not** a true NVDA/VoiceOver/TalkBack/Android/iOS or 200%-font screen-reader acceptance. Seven-platform Installed PWA matrix remains NOT RUN / NO-GO. The parallel Mobile Files P57 PR is independently owned and untouched.
