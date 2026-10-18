# P58 · Gallery album-folder path navigation geometry (2026-10-18)

## Progress and confirmed original-source defect
The shared `XDriveMediaGalleryAlbumOrganizer` placed the changing album-folder breadcrumb and the "新建相册文件夹" action in a `<Stack direction="row" flexWrap="wrap" useFlexGap>`. Nested path labels can exceed a 320–390px Mobile Web viewport; the toolbar therefore wraps into additional lines and pushes the folder grid/photo album cards down even when the existing accepted folder index is already in memory and **no loading/network status is warranted**. Desktop/wide Gallery uses this same shared MUI surface.

## Narrow shared visual repair
- Keep album folders and photo albums, cached `folderActions.list`, mutations/revision guards, search, thumbnails, Owner/Port scope and shared Web/Desktop transport **unchanged**.
- Use one always-stable minimum 44px navigation row with a `minWidth:0` horizontally scrollable breadcrumb viewport, MUI Breadcrumbs OL `flexWrap:'nowrap'`, nonshrinking crumb buttons, long-name ellipsis/full title, and a separate nonshrinking 44px "新建相册文件夹" button.
- On a genuine committed nested-folder change, a pre-paint `useLayoutEffect` advances only **the breadcrumb's horizontal scroll**, never the Gallery's independent vertical photo/albums scroll host. Return-to-root restores breadcrumb origin; `aria-current="page"` identifies exactly one committed crumb.
- Existing 300ms delayed progress on a real first folder index load, real failed/error Retry and **all cover/thumbnail/Live Photo/video network loading remain unchanged**. No new API, fake empty, global transition disable or extra virtualizer; retain full-screen App Frame / 52px app header.

## Validation and release gate
- Add a dedicated Desktop **mounted original shared Organizer** React regression with deep, long folder names, fixed nav style and row, original folder callbacks, accessible active crumb, original cached Server list (one call), pre-paint horizontal reveal, root return, original thumbnail wiring and no second Web/Desktop UI. Source/mounted tests are not a real 320px browser box-layout proof.
- Require NEW exact-head full 76-job CI: Web TS/lint/build, Desktop mounted/Windows, Go real PostgreSQL API Race, rootless, single commit/Final Gate; check clean mergeability, then Ready/Rebase merge and clean work branch.
- Actual physical iOS27 Safari/Android Chrome/installed PWA, weak WAN, 100k real-device FPS/CLS/INP and side-by-side pixel recording **not run**. Do not claim a 1:1 physical iOS acceptance. Independent open Gallery Live Photo fold still recovery #1589 is not modified; no unrelated page or AGENTS file touched.
