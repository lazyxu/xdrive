'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const source = read('desktop/scripts/gallery-web-physical-mixed-100k-viewports.cjs')
const flow = read('.github/workflows/gallery-web-physical-mobile-100k-viewports.yml')
test('P036 reuses authenticated 115k real physical Gallery fixture with a distinct 390px Mobile Web consumer', () => {
  for (const phrase of [
    "XD_GALLERY_WEB_PHYSICAL_MOBILE_100K_PERF === '1'",
    "mobileMode ? 390 : 1440", "mobileMode ? 844 : 900",
    "window.matchMedia", "viewport.narrow", "viewport.width>=360",
    "data-xdrive-media-gallery-virtual-grid",
    "startsWith('blob:')", "fresh.length>=6", "fresh.length>=4", "decodeAndPaint(window,freshIDs,requiredFresh)",
    "visibleTileCount:state.visibleTiles",
    "x.decode()", "requestAnimationFrame", "mobileViewport:mobileMode",
    "samples.every(s=>s.mobileViewport", "maxFirstSixMs = 20000",
    "v.http.max_active<=6", "v.mountedTiles<1000",
    "maxRSSGrowth = 256 * 1024 * 1024",
  ]) assert.ok(source.includes(phrase), 'P036 source contract missing: '+phrase)
  assert.ok(source.includes('mobileFirstViewportDiagnostics'))
  assert.ok(source.includes('GALLERY_MOBILE_PHYSICAL_100K_DIAGNOSTIC'))
  assert.ok(source.includes('requiredFresh=mobileMode?4:6'))
  assert.ok(!source.includes("mobileMode ? 'physical iPhone'"), 'do not conflate browser with hardware')
})
test('P036 mobile-only branch and source-exact scoped workflow preserve full n3 validation', () => {
  for (const phrase of [
    "perf/gallery-mobile-physical-mixed-100k-p036-20261012",
    "XD_GALLERY_WEB_PHYSICAL_MOBILE_100K_PERF: '1'",
    "node --test desktop/tests/gallery-web-physical-100k-source.cjs desktop/tests/gallery-mobile-web-physical-100k-source.cjs",
    "ref: \u0024{{ github.event.pull_request.head.sha }}",
    "postgres:17-alpine", "xvfb-run", "go test -c -o",
    "summary.json", "x.mobileMode", "x.cssViewportWidth!==390",
    "sample-*.json", "wc -l",
  ]) assert.ok(flow.includes(phrase), 'P036 workflow missing: '+phrase)
})
