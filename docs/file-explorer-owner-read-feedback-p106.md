# P106 · Wide Web/Desktop shared FileExplorer read loading vs durable operations

## Defect
The original Web and Desktop adapters pass a composite busy Boolean (directory GET OR Search GET OR durable Copy/Upload/Delete/Agent action) to `XDriveFileExplorer.loading`. The shared component interprets this value as an active list GET: populated folders schedule a deferred 2px “正在刷新文件” indicator, and unconfirmed/empty ones may receive an unnecessary silent cold slot. This is not an authoritative content-read state. It is especially misleading when an unrelated long-running operation coexists with a verified file list.

## Corrected boundaries
The unchanged shared `XDriveFileExplorer` renderer continues to consume one **read-only** loading Boolean. Both Web/Desktop adapters now select exactly the current visual data Owner: Trash `trash.loading`, active Search `searchLoading`, or ordinary CloudFiles `loading`. Their independent `fileOperationBusy` / `explorerActionBusy` action guards remain untouched and keep genuine mutation/transfer progress, while the stale 2px file-refresh bar and cold empty blink cannot arise from background-only work. Preserve Mobile Web's deliberate composite action control plus P104/P105 Owner visual gating.

## Evidence
`desktop/tests/file-explorer-owner-read-feedback-p106.cjs` transpiles/evaluates the original Wide JSX loading expressions and original shared FileExplorer deferred-bar predicate with realistic state tuples; checks Web/Desktop equality, empty and populated backgrounds, current Directory/Search/Trash, action guard preservation, virtual surface markers, thumbnail loading and additive AGENTS policy. All P60/P77/P78/P91 existing gates stay active. Native iOS Safari/Android/installed PWA, weak WAN, physical 100k/CLS/FPS are NOT RUN here. Exact-head complete CI/Final Gate plus clean mergeability is required before release.
