'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p), 'utf8')
test('P048 real 390px shared Mobile Gallery Go Handler cancellation has no mocks', () => {
  const source = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  const go = read('internal/api/gallery_real_web_scroll_cancel_support_test.go')
  for (const token of [
    'TestGalleryRealWebColdFixture100K',
    'width: 390, height: 844',
    'document.documentElement.clientWidth',
    'max-width:899.95px',
    'data-xdrive-media-gallery-virtual-grid',
    'scrollActualGalleryViewport',
    '/__perf/viewport-cancel-stats',
    '/__perf/viewport-cancel-mark',
    'newIndependentRange(fixture)',
    'worstContextNotificationMs',
    'row.go.contextDone === row.streamCount',
    'row.go.stillActiveAt160ms === 0',
    'row.go.wastedBytesAfterScroll === 0',
    'nativeProcessStats',
    'actualFixtureGoPID',
    'spawn(goBinary',
    'XD_GALLERY_MOBILE_NATIVE_GO_BINARY',
    "executable.endsWith('/api.test')",
    'cssWindowWidth:390',
    '128 * 1024 * 1024',
  ]) assert.ok(source.includes(token), 'missing source-exact performance contract: ' + token)
  assert.ok(go.includes('ctx.Done()') && go.includes('p.contextDone.Add(1)'),
    'production-routed Go handler must observe true HTTP request context cancellation')
})
test('P048 does not mutate prior accepted wide-screen P016 semantics or claim device results', () => {
  const source = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  const wide = read('desktop/scripts/gallery-real-web-scroll-cancel-100k-main.cjs')
  assert.ok(wide.includes('width: 1440, height: 900'))
  assert.ok(source.includes('NOT real iOS/Android/PWA'))
  assert.ok(source.includes('streamCount >= 4 && streamCount <= 6'))
  assert.ok(source.includes('100k logical assets/115k metadata Nodes'))
})
