'use strict'
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('P0-C2b1 uses real mounted Gallery page leave and a genuine Go observer', () => {
  const runner = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  const go = read('internal/api/gallery_real_web_scroll_cancel_support_test.go')
  const fixture = read('internal/api/gallery_real_web_cold_performance_integration_test.go')
  for (const marker of [
    "process.env.XD_PWA_P0C2_PAGELEAVE_BEFORE === '1'",
    "p0c2PageLeaveMode ?",
    "let leaveNavigation = null",
    "win.webContents.executeJavaScript(",
    "data-xdrive-media-gallery-virtual-grid",
    "leaveNavigation = win.loadURL(",
    "scroll.galleryUnmounted = true",
    "await sleep(160)",
    "await readStats(fixture.config.url)",
    "row.go.contextDone === row.streamCount",
    "row.go.wastedBytesAfterScroll === 0",
    "newIndependentRange(fixture)",
    "actualFixtureGoPID",
    "nativeProcessStats",
    "sampleCount: rows.length",
    "worstGoContextMaxMs: worst[2]",
    "row.scroll.galleryUnmounted === true",
    "pwa-p0c2-pageleave-go-results",
  ]) assert(runner.includes(marker), 'missing real path: ' + marker)
  assert(go.includes('ctx.Done()') && go.includes('context.Canceled'))
  assert(go.includes('p.contextDone.Add(1)'))
  assert(fixture.includes('TestGalleryRealWebColdFixture100K'))
})

test('P0-C2b1 preserves the prior scroll benchmark and does not claim iOS or SPA routes', () => {
  const runner = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  for (const marker of [
    "scroll = await win.webContents.executeJavaScript(",
    "scrollActualGalleryViewport.toString()",
    "NOT Files/Gallery SPA route",
    "NOT 100k physical originals",
    "NOT real iOS/Android/PWA",
    "pageLeaveMode:p0c2PageLeaveMode",
    "wastedBytesAfterAction",
    "row.pageLeaveMode === true",
    "row.scroll.mountedGalleryBefore === true",
  ]) assert(runner.includes(marker), marker)
})

test('P0-C2b1 CI must run actual PG17, compiled Web, Chromium and Go', () => {
  const yml = read('.github/workflows/pwa-p0c2b1-gallery-pageleave-go-before.yml')
  for (const marker of [
    'postgres:17-alpine', 'go test -c', 'xvfb-run', '/api.test',
    'VITE_XDRIVE_GALLERY_REAL_COLD_PERF=1',
    "XD_PWA_P0C2_PAGELEAVE_BEFORE: '1'",
    'github.event.pull_request.head.sha',
    'node --check desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs',
    's.worstGoContextMaxMs>160',
    's.sampleCount!==3', 'source.txt',
  ]) assert(yml.includes(marker), 'weak real-Go CI: ' + marker)
})
