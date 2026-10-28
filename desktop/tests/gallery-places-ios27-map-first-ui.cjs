'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const places = 'ui/shared/src/mui/MediaGalleryPlacesMap.tsx'
const photoMap = 'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'

test('map-first UI stays valid TSX for Web and Mobile shared Gallery', () => {
  for (const filename of [places, photoMap]) {
    const compiled = ts.transpileModule(read(filename), {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    const errors = (compiled.diagnostics || [])
      .filter(item => item.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')),
      [], filename)
  }
})

test('normal Places screen prioritizes one map while preserving advanced UI', () => {
  const source = read(places)
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.equal(gallery.split('<Typography variant="subtitle1" fontWeight={700}>地点</Typography>').length - 1, 1,
    'only the compact map/list switch retains an extra Places label')
  const toolbar = source.indexOf('data-xdrive-places-map-toolbar')
  const filterMenu = source.indexOf('component="details" data-xdrive-places-map-filter-menu')
  const moreMenu = source.indexOf('component="details" data-xdrive-places-map-more-menu')
  const mapHost = source.indexOf('<XDriveMediaGalleryBaiduIsolatedPhotoSurface')
  assert.ok(toolbar > 0 && toolbar < filterMenu && filterMenu < moreMenu)
  assert.ok(moreMenu < mapHost, 'menus float above instead of preceding the map')
  assert.match(source, /data-xdrive-places-map-filter-panel/)
  assert.match(source, /data-xdrive-places-map-more-panel/)
  assert.match(source, /hasMapActiveFilters \? '筛选中' : '筛选'/)
  assert.equal((source.match(/data-xdrive-map-mode-prototype/g) || []).length, 1)
  assert.equal((source.match(/data-xdrive-map-mode-isolated/g) || []).length, 1)
  assert.equal((source.match(/<XDriveMediaGalleryMapGPSCoverage/g) || []).length, 1)
  assert.equal((source.match(/<XDriveMediaGalleryBaiduIsolatedPhotoSurface/g) || []).length, 1)
  assert.match(source, /onMapModeHandoff/)
  assert.match(source, /xDriveNormalizeBaiduMapPhotoScope/)
})

test('compact iOS map hides technical label but preserves explicit SDK boundary in More', () => {
  const source = read(places)
  const toolbar = source.indexOf('data-xdrive-places-map-toolbar')
  const disclosure = source.indexOf('data-xdrive-places-map-runtime-boundary')
  const more = source.indexOf('data-xdrive-places-map-more-menu')
  assert.ok(toolbar >= 0 && disclosure > toolbar && more > disclosure,
    'runtime boundary must be visible without opening More')
  assert.equal((source.match(/data-xdrive-places-map-runtime-boundary/g) || []).length, 1)
  assert.match(source, /display:compact \? 'none' : 'block'/)
  assert.match(source, /data-xdrive-places-map-more-panel/)
  assert.match(source, /同页地图与安全隔离版使用同一份当前 Owner/)
  assert.match(source, /mapMode === 'prototype' \? '同页 · 未隔离' : '安全隔离'/)
  assert.match(source, /第三方脚本不具备独立 Origin 隔离/)
  assert.match(source, /独立 HTTPS Origin 隔离运行/)
})

test('trusted photo covers wait for real Owner camera and reject stale SDK projections', () => {
  const source=read(photoMap)
  assert.match(source,/const coverPins = scopeIsCurrent && acceptedViewport &&\s*projected\?\.width/)
  assert.match(source,/xDriveSelectVisibleMapPhotoCovers\(/)
  assert.match(source,/\.filter\(candidate => hasAcceptedCell\(candidate\.selection\)\)/)
  assert.doesNotMatch(source,/photoStrip|xDriveCurrentMapPhotoCollections/)
  assert.match(source,/if\(!lifetime\.signal\.aborted && latestAcceptedViewport\.current &&/)
  assert.match(source,/xDrivePlacesDrawerValidRange\(cell,range\)/)
})

test('shared iOS photo map pins show only verified blue counts above singleton photos', () => {
  const source = read(photoMap)
  const start = source.indexOf('data-xdrive-places-trusted-photo-cover-pins')
  const end = source.indexOf('{!activeDrawer && trustedSummary ? (', start)
  assert.ok(start >= 0 && end > start)
  const pins = source.slice(start, end)
  assert.ok(pins.includes('aria-label={`查看该区域 ${pin.count} 张照片`}'))
  assert.match(pins, /onClick=\{\(\) => openVerifiedCell\(pin.selection\)\}/)
  assert.match(pins, /\{pin.count > 1 \? \(/)
  assert.match(pins, /data-xdrive-places-photo-count-badge/)
  assert.match(pins, /aria-hidden="true"/)
  assert.match(pins, /top:-8,right:-8,minWidth:24/)
  assert.match(pins, /theme.palette.mode === 'dark' \? '#0A84FF' : '#007AFF'/)
  assert.match(pins, /\{pin.count.toLocaleString\('zh-CN'\)\}/)
  assert.doesNotMatch(pins, /\{pin.count.toLocaleString\('zh-CN'\)\}张/)
  assert.match(pins, /ownerCover\(pin\.selection/)
  assert.match(source, /revision=\{selection\.node_revision\}/)
})

test('photo thumbnails, real Owner camera count and wall action remain on map', () => {
  const source = read(photoMap)
  const mapStart = source.indexOf('data-xdrive-places-cluster-overview')
  const summary = source.indexOf('data-xdrive-places-map-photo-summary')
  const wall = source.indexOf('data-xdrive-places-full-camera-wall')
  const mapEnd = source.indexOf("      {phase==='unavailable' ? (")
  assert.ok(mapStart > 0 && mapStart < summary && summary < wall && wall < mapEnd)
  assert.match(source, /xs:'max\(520px, calc\(100dvh - 148px\)\)'/)
  assert.match(source, /sm:'max\(640px, calc\(100dvh - 165px\)\)'/)
  // Apple Photos must not inherit the desktop minimum when the iPhone is
  // rotated to 844×390 or 900×390. Real Chromium verifies actual geometry.
  assert.match(source, /@media \(orientation: landscape\) and \(max-height: 600px\)/)
  assert.match(source, /: 'max\(200px, calc\(100dvh - 165px\)\)'/)
  assert.match(source, /data-xdrive-places-ios-map-canvas/)
  assert.match(source, /max\(460px, calc\(100dvh - 124px\)\)/)
  assert.match(source, /max\(192px, calc\(100dvh - 124px\)\)/)
  assert.doesNotMatch(source, /data-xdrive-places-map-photo-strip-shell/)
  assert.match(source, /data-xdrive-places-map-photo-summary/)
  assert.match(source, /width:\{xs:64,sm:72\}/)
  assert.doesNotMatch(source, /edgeToEdge \? '0 0 54px' : '0 0 76px'/)
  assert.match(source, /data-xdrive-places-trusted-photo-cover-pins/)
  assert.match(source, /ownerCover\(pin\.selection/)
  assert.match(source, /revision=\{selection\.node_revision\}/)
  assert.match(source, /onClick=\{\(\) => openVerifiedCell\(pin.selection\)\}/)
  assert.match(source, /approved.key===filterRef.current.key/)
  assert.match(source, /xDriveMountBaiduIsolatedFrame/)
  assert.match(source, /xDriveMountBaiduInlineMap/)
})

test('immersive Places uses its own shared controls instead of duplicate Gallery chrome', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const chrome = read('ui/shared/src/mui/MobileGalleryChrome.tsx')
  assert.match(gallery, /mapImmersive=\{showPlacesIndex && placesPanels\.map\}/)
  assert.match(chrome, /mapImmersive\?: boolean/)
  assert.match(chrome, /!mapImmersive \? \(/)
  assert.match(chrome, /!mapImmersive && !selectionMode \? \(/)
  assert.match(chrome, /!mapImmersive && !selectionMode && primaryTab/)
  assert.match(chrome, /setSearchOpen\(false\)/)
  assert.match(chrome, /setMoreOpen\(false\)/)
  assert.match(gallery, /data-xdrive-places-mobile-switch/)
  assert.match(gallery, /onCloseMap=\{onBack && onSectionChange/)
})

test('real Chromium layout measures only painted map controls but still enforces 44px', () => {
  const driver=read('desktop/scripts/gallery-places-dual-host-chromium.cjs')
  assert.match(driver,/\.filter\(el=>el\.checkVisibility\(\)\)/)
  assert.match(driver,/actual\.hits\.every\(b=>b\.width>=44&&b\.height>=44\)/)
  assert.match(driver,/actual\.footer\.bottom<=actual\.map\.bottom/)
  assert.match(driver,/actual\.pins>0/)
  assert.match(driver,/actual\.pinButtons\.length===actual\.pins/)
  assert.doesNotMatch(driver,/actual\.pins\.length>0/)
  assert.match(driver,/actual\.pinButtons\.every\(b=>b\.width>=44&&b\.height>=44\)/)
})

test('compact map rotation uses fresh owner camera before evaluating photo pins',()=>{
  const source=read('desktop/scripts/gallery-places-dual-host-chromium.cjs')
  assert.match(source,/beforeResizeQueries=await page\.evaluate/)
  assert.match(source,/window\.__mapProbe\.queries\.length>before/)
  assert.match(source,/await page\.waitForFunction\(before=>/)
  assert.match(source,/pointToPixel\(\)\{[\s\S]*?this\.canvas\?\.clientWidth/)
  assert.match(source,/await page\.locator\('\[data-xdrive-places-trusted-photo-cover\]'\)/)
  // Do not accept an old fixed-pixel test marker which can conceal a stale
  // projected 390px camera after viewport rotation.
  assert.doesNotMatch(source,/pointToPixel\(\)\{return \{x:180,y:180\}\}/)
})

test('camera resize requires fresh Owner Cell before reopening actual photo drawer',()=>{
  const driver=read('desktop/scripts/gallery-places-dual-host-chromium.cjs')
  for(const fragment of [
    "rotation revokes prior camera-scoped photo drawer",
    "portrait resize revokes short-landscape Cell scope",
    "beforeLandscape=await page.evaluate",
    "beforePortrait=await page.evaluate",
    "expanded drawer fits inside 844x390 map and safe area",
  ]) assert.ok(driver.includes(fragment),fragment)
  assert.match(driver,/sheetGeometry\.top>=sheetGeometry\.mapTop\+8/)
  assert.match(driver,/sheetGeometry\.bottom<=sheetGeometry\.mapBottom-8/)
  assert.match(driver,/sheetGeometry\.bottom<=sheetGeometry\.screen-8/)
  assert.match(driver,/window\.__mapProbe\.queries\.length>before/)
  assert.match(driver,/const openFreshCameraCell=async\(\)=>/)
  assert.match(driver,/data-xdrive-places-cluster-list/)
  assert.match(driver,/await openFreshCameraCell\(\)/)
  assert.match(driver,/await list\.locator\('button'\)\.first\(\)\.click\(\)/)
  assert.doesNotMatch(driver,/await page\.setViewportSize\(\{width:844,height:390\}\)\s*const sheetGeometry/,
    'stale pre-rotation drawer must not be reused')
})

test('responsive keyboard appearance waits for new Owner camera and bounded map fallback',()=>{
  const driver=read('desktop/scripts/gallery-places-dual-host-chromium.cjs')
  assert.match(driver,/beforeCamera=await page\.evaluate/)
  assert.match(driver,/await page\.waitForFunction\(before=>window\.__mapProbe\.queries\.length>before/)
  assert.match(driver,/bounds\.map\.height<226/)
  assert.match(driver,/bounds\.accessibleCount>=1/)
  assert.match(driver,/bounds\.accessibleLabel\.includes\('9'\)/)
  assert.match(driver,/visibleCover\|\|truthfulFallback/)
  assert.match(driver,/beforeReturnCamera=await page\.evaluate/)
  assert.match(driver,/await cover\.waitFor\(\{state:'visible'\}\)/)
  assert.match(driver,/bounds\.cover\.width>=44&&bounds\.cover\.height>=44/)
})
