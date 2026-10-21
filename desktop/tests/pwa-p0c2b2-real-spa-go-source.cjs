'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p), 'utf8')

test('P0-C2b2 navigates the ACTUAL signed App Files↔Gallery on the SAME document with native Chromium inputs', () => {
  const runner = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  const originalApp = read('web/src/App.tsx')
  const originalMain = read('web/src/main.tsx')
  for (const marker of [
    "process.env.XD_PWA_P0C2_SPA_BEFORE === '1'",
    "assert(!(p0c2PageLeaveMode && p0c2SPAMode)",
    'bootOriginalAuthenticatedApp',
    "base + '/#/app/files'",
    "localStorage.setItem('xdrive.access_token'",
    "localStorage.setItem('xdrive.username'",
    "localStorage.setItem('xdrive.access_expires_at'",
    "switchActualApp(win, '图库', 'gallery')",
    "prepareAppDestination(win, '文件')",
    "win.webContents.sendInputEvent",
    "button[data-xdrive-mobile-app-navigation-trigger]",
    "'[role=\"dialog\"] button,[role=\"dialog\"] [role=\"button\"]'",
    "document.querySelectorAll(selector)",
    "if (candidates.length !== 1)",
    "REAL_P0C2_SPA_FILES_MOUNT_REJECTED",
    "P0C2_REAL_UI_ROUTE_REJECTED",
    "document.elementFromPoint(x, y)",
    "await sleep(430)",
    "safeSPARouteState(win, target)",
    "drawerDialogPresent:",
    "sendActualPointer(win, opener)",
    "win.webContents.focus()",
    "hasStoredSession:",
    "ownerResponse.status, 200",
    "xdriveP0C2OwnerBootstrap=1#/app/files",
    "data-xdrive-mobile-app-header",
    "data-xdrive-mobile-app-frame",
    "data-xdrive-media-gallery-virtual-grid",
    "window.__pwaC2SPAMain",
    "window.__pwaC2SPADocument",
    "preClick.active, streamCount",
    "preClick.context_done, started.context_done",
    "row.scroll.kind === 'same-document-app-route'",
    "row.scroll.sameMainAfter === true",
    "row.scroll.sameDocumentAfter === true",
    "row.go.contextDone === row.streamCount",
    "row.go.stillActiveAt160ms === 0",
    "row.go.wastedBytesAfterScroll === 0",
    "pwa-p0c2-spa-go-results",
  ]) assert(runner.includes(marker), 'missing genuine original App-to-Go contract '+marker)
  for (const marker of [
    'useXDriveWebAppRuntime',
    'XDriveMobileAppHeader',
    'XDriveWorkspaceSidebar',
    'onCompactOpenChange={setCompactNavigationOpen}',
    "appView === 'files'",
    "appView === 'gallery'",
    'XDriveMediaGalleryPage',
    'WebFileExplorer',
  ]) assert(originalApp.includes(marker), 'not using original App route '+marker)
  const fixture = read('internal/api/gallery_real_web_cold_performance_integration_test.go')
  for (const marker of [
    'p0c2SPAMode := os.Getenv("XD_PWA_P0C2_SPA_BEFORE") == "1"',
    'if desktopFileExplorerMixed || p0c2SPAMode',
    'InitialPosition: "latest", TimeZone: "UTC"',
    'tail.Offset != mediaGalleryFirstOpenLogicalCount-100',
    'viewport = tail.Items',
    'earliest, firstErr := server.queryMediaItemRange(',
    'UnknownFirst: true, TimeZone: "UTC"',
    'earliest.Offset != 0 || len(earliest.Items) != 100',
    'headImages, headVideos, headLive := galleryFirstVisibleSeedObjects(',
    't, db, countingStore, earliest.Items,',
    'P0C2_SPA_MEDIA_RANGE',
    'P0C2_SPA_UNWATCHED_FIXTURE_THUMBNAIL',
    't, db, countingStore, viewport,',
    '&meta.PhotoPerson{},',
    '&meta.FileRecentAccess{},',
  ]) assert(fixture.includes(marker), 'missing real signed App / Mobile tail fixture: '+marker)
  assert(originalMain.includes('<App appearance={appearance} onAppearanceChange={changeAppearance} />'))
  assert(!runner.includes('location.hash ='), 'direct synthetic URL mutation not a UI click')
})

test('P0-C2b2 maintains P048 viewport and merged P0-C2b1 page leave cases', () => {
  const runner = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  for (const marker of [
    'scrollActualGalleryViewport.toString()',
    "process.env.XD_PWA_P0C2_PAGELEAVE_BEFORE === '1'",
    "leaveNavigation = win.loadURL(",
    'row.scroll.galleryUnmounted === true',
    'newIndependentRange(fixture)',
    'actualFixtureGoPID',
    'nativeProcessStats',
    'ctx.Done()',
  ]) {
    if (marker === 'ctx.Done()') {
      assert(read('internal/api/gallery_real_web_scroll_cancel_support_test.go').includes(marker))
    } else assert(runner.includes(marker), 'must retain merged benchmark '+marker)
  }
  assert(runner.includes('const out = path.join'))
  assert(runner.includes('spaMode:p0c2SPAMode'))
  assert(runner.includes('sampleCount: rows.length'))
})

test('P0-C2b2 CI is source-accurate Go/PG17/CAS/browser and rejects fake missing samples', () => {
  const yaml = read('.github/workflows/pwa-p0c2b2-real-spa-go-before.yml')
  for (const marker of [
    'postgres:17-alpine',
    'go test -c',
    'VITE_XDRIVE_GALLERY_REAL_COLD_PERF=1',
    'xvfb-run',
    "XD_PWA_P0C2_SPA_BEFORE: '1'",
    'github.event.pull_request.head.sha',
    'desktop/tests/pwa-p0c2b2-real-spa-go-source.cjs',
    's.spaMode',
    's.sampleCount!==3',
    's.worstGoContextMaxMs>160',
    'source.txt',
    'pwa-p0c2-spa-go-results',
  ]) assert(yaml.includes(marker), 'weak real SPA Go CI contract '+marker)
})
