'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const script = fs.readFileSync(path.join(__dirname, '../scripts/gallery-desktop-real-cold-electron-main.cjs'), 'utf8')
const begin = script.indexOf('function activateGalleryAndMeasure() {')
const end = script.indexOf('// Opt-in benchmark only.', begin)
if (begin < 0 || end < 0) throw new Error('production Desktop Gallery observation harness source missing')
const extracted = script.slice(begin, end)

test('100 rapid unrelated document mutations cause only one bounded Gallery observer scan', async () => {
  let observer = null
  let galleryClicked = 0
  let images = []
  let clock = 0
  const frames = []
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; observer = this }
    observe(_target, options) { this.options = options }
    disconnect() { this.disconnected = true }
  }
  const fakeNav = { querySelectorAll: () => [{
    textContent: '图库', click() { galleryClicked++ },
  }] }
  const fakeGrid = {
    querySelector: selector => selector === '[role="button"]' ? {} : null,
    querySelectorAll: selector => selector === 'img[src]' ? images : [],
  }
  const body = {}
  const context = {
    window: { xdriveDesktop: { agent: {} } },
    document: {
      body,
      querySelector: selector =>
        selector === 'nav[aria-label="桌面版功能区"]' ? fakeNav
          : selector === '[data-xdrive-media-gallery-virtual-grid]' ? fakeGrid : null,
    },
    performance: { now: () => ++clock },
    innerWidth: 1440,
    innerHeight: 900,
    MutationObserver: FakeMutationObserver,
    PerformanceObserver: class FakePerformanceObserver {
      static supportedEntryTypes = []
    },
    requestAnimationFrame(callback) { frames.push(callback) },
    Set, WeakMap, Array, Math, Promise,
  }
  vm.runInNewContext(extracted + '\nthis.startMeasure = activateGalleryAndMeasure', context)
  const armed = context.startMeasure()
  assert.equal(armed.started, true)
  assert.equal(galleryClicked, 1)
  assert.equal(observer.options.subtree, true)
  assert.deepEqual(Array.from(observer.options.attributeFilter), ['src', 'srcset'])
  const data = context.window.__xdriveDesktopRealColdProbe
  assert.equal(data.gridScanCount, 1, 'one immediate scan on navigation')

  images = Array.from({ length: 12 }, (_, i) => ({
    src: 'blob:mock-' + i, currentSrc: '', isConnected: true,
    decode: () => Promise.resolve(),
  }))
  for (let n = 0; n < 100; n++) observer.callback([])
  assert.equal(data.mutationNotifications, 100)
  assert.equal(data.gridScanCount, 1, 'no eager repeated full-grid scanning during one frame')
  assert.equal(frames.length, 1, 'only one rAF scheduled for 100 mutations')

  for (let frame = 0; frame < 12; frame++) {
    const ready = frames.splice(0)
    for (const callback of ready) callback()
    for (let n = 0; n < 5; n++) await Promise.resolve()
  }
  assert.equal(data.coalescedScanFrames, 1)
  assert.equal(data.gridScanCount, 2)
  assert.equal(data.decodedImages, 12)
  assert.ok(data.gridScanCpuMs >= 0)
  assert.ok(data.maxGridScanCpuMs >= 0)
  assert.ok(context.window.__xdriveDesktopRealColdResult)
  assert.equal(context.window.__xdriveDesktopRealColdResult.mountedTiles, 0,
    'synthetic DOM has no real tile list; real Electron test separately proves 42')
  assert.equal(observer.disconnected, true)
  for (let i = 0; i < 10; i++) observer.callback([])
  assert.equal(frames.length, 0, 'completion cannot schedule new scanning')
})

test('production sources remain unchanged by the observer-only experiment', () => {
  assert.match(script, /observer = new MutationObserver\(scheduleScan\)/)
  assert.match(script, /attributeFilter: \['src', 'srcset'\]/)
  assert.match(script, /data\.coalescedScanFrames\+\+/)
  assert.match(script, /data\.gridScanCpuMs \+= cpu/)
  // The real Desktop benchmark may import contentTracing for opt-in
  // diagnostics while the production Electron Main entry stays unchanged.
  assert.match(script, /const \{ app(?:, contentTracing)? \} = require\('electron'\)/)
  assert.match(script, /require\('\.\.\/dist\/main\/index\.cjs'\)/)
})
