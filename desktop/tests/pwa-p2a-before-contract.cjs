'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
const run = read('desktop/scripts/pwa-p2a-100k-thumbnail-before.cjs')
const flow = read('.github/workflows/pwa-p2a-100k-thumbnail-before.yml')
const prod = read('desktop/scripts/gallery-web-physical-mixed-100k-viewports.cjs')

test('P2-A is an opt-in BEFORE measurement on the genuine existing 100k/115k CAS Gallery, not a cache implementation', () => {
  for (const phrase of [
    "XD_PWA_P2A_CURRENT_BEFORE",
    "XD_GALLERY_WEB_PHYSICAL_MOBILE_100K_PERF === '1'",
    "physical-thumbnail-stats",
  ]) {
    assert.ok(run.includes(phrase), 'missing original real fixture boundary ' + phrase)
  }
  for (const phrase of [
    "logical_assets,100000",
    "physical_nodes,115000",
    "physical_sources,115000",
    "physical_bytes,149285128",
    "max_active<=6",
    "mounted>=1000",
    "x.decode()",
    "requestAnimationFrame",
    "startsWith('blob:')"
  ]) assert.ok(run.includes(phrase), 'original 100k authenticated decoder/Go safety contract missing: ' + phrase)
  assert.ok(run.includes('same process') || run.includes('same-node') || run.includes('Same-process'))
  assert.ok(!run.includes('indexedDB.open'), 'P2-A must not write an IndexedDB thumbnail cache')
  assert.ok(!run.includes('caches.open'), 'P2-A must not add private SW CacheStorage')
  assert.ok(!run.includes('skipWaiting()'), 'P2-A must never force a Service Worker update')
  assert.ok(!run.includes('backgroundDownload'), 'P2-A must not download bulk originals')
  assert.equal((run.match(/new BrowserWindow\(/g)||[]).length, 1)
  assert.ok(prod.includes('const fractions = [0, 0.25, 0.5, 0.75, 0.95]'))
})

test('P2-A measures exact same previously decoded first-four indices and true server body delta', () => {
  for (const phrase of [
    'for(const first of [views[0],views[2],views[4]])',
    'const indices=first.freshDecodedIndices',
    'indices.every(id=>view.decoded.some(node=>node.index===id))',
    'decodeAndPaint(window,indices,indices.length)',
    'httpAfter.started-httpBefore.started',
    'httpAfter.response_bytes-httpBefore.response_bytes',
    'firstVisitHTTP.responseBodyBytes',
    'revisitDecodedAndTwoFramesMs',
    'firstVisitP50Ms',
    'firstVisitP95Ms',
    'revisitP50Ms',
    'revisitP95Ms',
    'revisitHTTPRequests',
    'originStorage',
    'matchedPairedWindows:9',
    'afterOptimization:null',
  ]) assert.ok(run.includes(phrase), 'P2-A exact-CURRENT sample or negative control missing: '+phrase)
})

test('P2-A workflow uses source-exact real Go/PostgreSQL17/CAS and native Chromium, not mock bytes', () => {
  for (const phrase of [
    'postgres:17-alpine',
    'go test -c -o desktop/gallery-physical-web-go/api.test',
    'VITE_XDRIVE_GALLERY_REAL_COLD_PERF=1',
    'xvfb-run',
    'pwa-p2a-100k-thumbnail-before.cjs',
    "XD_PWA_P2A_CURRENT_BEFORE: '1'",
    'desktop/tests/pwa-p2a-before-contract.cjs',
    'test "$XD_PR_HEAD"',
    "x.matchedPairedWindows!==9",
    'afterOptimization',
    'actions/upload-artifact@v4',
  ]) assert.ok(flow.includes(phrase), 'P2-A evidence workflow missing: '+phrase)
  assert.ok(!flow.includes('continue-on-error:'), 'do not hide real benchmark failure')
  assert.ok(!flow.includes('workflow_dispatch:'), 'do not run over unrelated production accounts')
})
