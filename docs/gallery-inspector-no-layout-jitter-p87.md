## P87 · second exact-head CI failed on double-escaped legacy matcher (2026-10-19)

- Rebuilt P87 HEAD `0ff729a755394cf1c406a267b978d948ca9fc179` [CI #39201042722](https://github.com/lazyxu/xdrive/actions/runs/39201042722) failed Desktop original `file-explorer-media-properties-shared.cjs` because a replacement regex was **double-escaped** and searched for backslashes instead of the literal JSX. The real original Inspector contains the expected `aria-busy={!item || undefined}`; correct ONLY the matcher to `inspector.includes('aria-busy={!item || undefined}')`. All original cancellation/revision guards and P87 mounted 160px evidence remain unchanged.
- This prior RED cannot authorize merge. Rebuild exactly ONE source-accurate work commit on full current master and require entirely NEW 77+ CI including actual original Desktop tests and Final Gate, plus fresh clean GitHub mergeability and browser/physical evidence before release claims.

## P87 CI diagnosis and original test reconciliation (2026-10-19)

- First source-exact P87 CI [#39194022712](https://github.com/lazyxu/xdrive/actions/runs/39194022712) is **RED**: of 3,225 Desktop test results, exactly one original assertion in `desktop/tests/file-explorer-media-properties-shared.cjs` requires the **removed** `正在加载媒体属性` caption. The new original mounted `media-gallery-inspector-quiet-first-read-p87.cjs` proves the actual Inspector's 160px silent pending pane and current data/error transitions; the stale text assertion contradicts the permanent P78 rule. Replace ONLY that outdated expectation with authentic quiet-pane/aria-busy/no-transient-label assertions; retain the original abort/revision/stale Owner guards and all other tests intact.
- Freeze full independent current master@01d525a0bb5b5757250cdf8829e0a1460af49750; preserve the original THREE real source/test implementation files and mounted test SHA-identically, prepend this note to original P87 doc, include the **existing** legacy regression file as the sixth P87 path. Exactly ONE rebuilt work commit. Demand an entirely NEW 77+ exact-head GitHub CI and clean mergeability; old failed HEAD cannot certify this rebuilt commit. Keep P83 #2106 and all other branches independent.

# P87 — Gallery Inspector avoids virtual-grid layout animation (2026-10-19)

## Confirmed source defect

The original Web/Desktop shared `ui/shared/src/mui/MediaGallery.tsx` has one root Stack (`id="xdrive-mobile-gallery-main"`). It conditionally reserves a `380px` right gutter on the `lg` breakpoint when an Inspector is open. A redundant `transition: 'padding-right 160ms ease'` animates that **layout property** on every Inspector open/close. During this interval, the actual Gallery wall's available width changes repeatedly, potentially re-evaluating columns, virtual offsets, item sizing and the visible scroll anchor. A responsive panel opening may have one intended geometry update, but it must not introduce a 160ms series of intermediate layouts.

## Bounded correction

- Remove ONLY the Gallery root's `padding-right` transition and leave `pr: { lg: selected && !previewItem ? '380px' : 0 }` intact. The chosen Inspector width is applied as one style/geometry change rather than 10+ animated layouts.
- Keep Mobile's existing bottom dock reservation (`pb`), root identity, single Gallery virtualized grid/timeline and the same REST/Agent/Viewer/scroll owner. No source, API, thumbnail queue, video poster, Live Photo still/motion, image decode or Go cancellation change.
- Add regression directly in original `desktop/tests/media-gallery.cjs`: isolate the real JSX root style and reject height/width/padding/margin/top/left CSS transitions/animations, while requiring 380px Inspector and the actual thumbnail progress path. Reuse all original Gallery mounted/browser tests without disabling them.

## Evidence and acceptance

Source identified the redundant 160ms layout transition. This edit should prevent intermediate *CSS layout animation*; it does NOT prove physical zero CLS/FPS. Require a brand NEW full source-exact 77-job GitHub CI including genuine PostgreSQL API Race, Web and Desktop Windows/Linux, Rootless, installer artifacts, single work commit and Final Gate plus current clean mergeability before Ready/Rebase/merge. Actual built-browser visual-frame/scroll measurements at desktop `lg` open/close, 375/390/899 Mobile Web, 100k+ mixed media, native iOS Safari/Android/installed PWA and weak WAN are **NOT RUN**, and must not be reported as passed from this static source check alone.

The mandatory canonical P78 permanent no-jitter rule already exists in `AGENTS.md`; no new `AGENTS.md` conflict is introduced while the independent P83 Source/Task/Transfer rule and full current master reconciliation await merge. P87 reinforces P78's explicit ban on animated layout properties and will be referenced by the permanent contract at the next nonconflicting policy update.

## P87 follow-up: metadata first-read text flicker in the same Inspector

A second source-confirmed issue in the original shared `MediaGalleryInspector.tsx`: when `open=true` with `item=null` during a genuine Server/Agent metadata read, the already-mounted property Drawer or wide side pane momentarily showed `正在加载媒体属性…`, then removed the text. On short metadata reads this creates a new transient visual state even though the outer Inspector already exists. Preserve the same Inspector title, dimensions, side/bottom presentation, and `XDriveMediaDetailsContent` network thumbnail/metadata UI; replace the decorative line with a **silent stable 160px min-height region** and truthful `aria-busy`. This region remains the same while held >370ms, and the verified item replaces its content without remounting the pane. Failure/retry belongs to the owning Server/Viewer, not a fabricated Inspector empty state.

NEW original mounted React regression: `desktop/tests/media-gallery-inspector-quiet-first-read-p87.cjs` transpiles the authentic Inspector component, mocks only host MUI portal/styling while preserving genuine render/prop lifecycles, checks narrow Drawer and wide side pane, >370ms pending, verified photo, re-entered pending, close and that real media content still mounts. It does not simulate actual network transport or establish native/browser CLS. Fresh accurate-head full CI required; previous P87 head tests do not certify this new head.
