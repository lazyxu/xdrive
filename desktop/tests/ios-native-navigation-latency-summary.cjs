'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const summaryScript = path.resolve(__dirname, '../../ios/scripts/summarize-navigation-latency.py')
const python = [
  'import importlib.util, json, sys',
  'spec = importlib.util.spec_from_file_location("nav_latency", sys.argv[1])',
  'module = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(module)',
  'print(json.dumps(module.summarize(sys.stdin.read())))'
].join('\n')

function summarize(log) {
  const out = spawnSync('python3', ['-c', python, summaryScript], {
    input: log, encoding: 'utf8', timeout: 12000
  })
  assert.equal(out.status, 0, out.stderr || 'Python navigation summarizer failed')
  return JSON.parse(out.stdout)
}

test('route readiness P50/P95 is grouped by actual Gallery/Files destination', () => {
  const log = [
    'IOS_NATIVE_NAVIGATION_READY_MS route=native-ios-tab-gallery page=gallery value=120',
    'IOS_NATIVE_NAVIGATION_READY_MS route=native-ios-tab-gallery page=gallery value=200',
    'IOS_NATIVE_NAVIGATION_READY_MS route=native-ios-tab-gallery page=gallery value=999',
    'IOS_NATIVE_NAVIGATION_READY_MS route=native-ios-tab-files page=files value=80',
    'IOS_NATIVE_NAVIGATION_READY_MS route=native-ios-tab-gallery page=gallery value=400001',
    'not a real navigation timing'
  ].join('\n')
  const result = summarize(log)
  assert.equal(result.total_samples, 4, 'over-range and unrelated lines are not valid samples')
  const gallery = result.routes.find(x => x.page === 'gallery')
  assert.equal(gallery.samples, 3)
  assert.equal(gallery.p50_ms, 200)
  assert.equal(gallery.p95_ms, 999)
  assert.equal(gallery.max_ms, 999)
  const files = result.routes.find(x => x.page === 'files')
  assert.equal(files.p50_ms, 80)
})

test('local PhotoKit tab-return samples remain separate from fresh PhotoKit scans', () => {
  const log = [
    'IOS_NATIVE_LOCAL_PHOTO_PAGE_READY_MS mode=mounted value=7',
    'IOS_NATIVE_LOCAL_PHOTO_PAGE_READY_MS mode=tab-return value=12',
    'IOS_NATIVE_LOCAL_PHOTO_PAGE_READY_MS mode=tab-return value=18',
    'IOS_NATIVE_LOCAL_PHOTO_PAGE_READY_MS mode=photokit value=490',
    'IOS_NATIVE_LOCAL_PHOTO_PAGE_READY_MS mode=photokit value=1400',
    'IOS_NATIVE_LOCAL_PHOTO_PAGE_READY_MS mode=unverified value=3'
  ].join('\n')
  const result = summarize(log)
  assert.equal(result.total_samples, 0)
  assert.equal(result.local_photo_page_samples, 5)
  const byMode = Object.fromEntries(result.local_photo_page_modes.map(x => [x.mode, x]))
  assert.equal(byMode.mounted.p50_ms, 7)
  assert.equal(byMode['tab-return'].p50_ms, 15)
  assert.equal(byMode['tab-return'].p95_ms, 18)
  assert.equal(byMode.photokit.p50_ms, 945)
  assert.equal(byMode.photokit.p95_ms, 1400)
})

test('a missing Simulator log is not misreported as zero flicker or successful FPS', () => {
  const result = summarize('')
  assert.deepEqual(result.routes, [])
  assert.deepEqual(result.local_photo_page_modes, [])
  assert.equal(result.total_samples, 0)
  assert.equal(result.local_photo_page_samples, 0)
  assert.equal(result.is_physical_device_fps, false)
  assert.equal(result.proves_zero_transient_flicker, false)
})
