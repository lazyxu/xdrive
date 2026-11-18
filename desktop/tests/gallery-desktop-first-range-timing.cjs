'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..', '..')
const modulePath = path.join(root, 'desktop/src/main/gallery_first_range_timing.cts')
const moduleSource = fs.readFileSync(modulePath, 'utf8')
const javascript = ts.transpileModule(moduleSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: modulePath,
}).outputText
const moduleInstance = { exports: {} }
new Function('module', 'exports', javascript)(moduleInstance, moduleInstance.exports)
const { createDesktopGalleryFirstRangeTiming } = moduleInstance.exports

test('Gallery cold first Range distinguishes Agent readiness from real HTTP wait', () => {
  let clock = 100
  const trace = createDesktopGalleryFirstRangeTiming(() => clock)
  clock = 400
  trace.markAgentReady()
  clock = 420
  trace.markHttpStarted()
  clock = 1920
  const row = trace.finish('ok')
  assert.deepEqual(row, {
    result: 'ok', total_ms: 1820, agent_ready_ms: 300,
    pre_http_ms: 20, http_ms: 1500,
  })
  assert.equal(trace.finish('ok'), null, 'one request must produce only one timing record')
  assert.deepEqual(Object.keys(row).sort(), [
    'agent_ready_ms', 'http_ms', 'pre_http_ms', 'result', 'total_ms',
  ], 'no account, media identity, token, query, URL or request ID belongs in logs')
})

test('failure before Agent readiness remains honest and does not fabricate HTTP duration', () => {
  let clock = 50
  const trace = createDesktopGalleryFirstRangeTiming(() => clock)
  clock = 75
  assert.deepEqual(trace.finish('error'), {
    result: 'error', total_ms: 25, agent_ready_ms: null,
    pre_http_ms: null, http_ms: null,
  })
  trace.markAgentReady()
  trace.markHttpStarted()
  assert.equal(trace.finish('ok'), null)
})

test('cancelled cold Range retains its timings and clamps clock anomalies', () => {
  let clock = 1000
  const trace = createDesktopGalleryFirstRangeTiming(() => clock)
  clock = 1050
  trace.markAgentReady()
  clock = 1030
  trace.markHttpStarted()
  clock = 1020
  assert.deepEqual(trace.finish('cancelled'), {
    result: 'cancelled', total_ms: 20, agent_ready_ms: 50,
    pre_http_ms: 0, http_ms: 0,
  })
})

test('production Main traces actual offset-zero viewport Range without changing ownership', () => {
  const source = fs.readFileSync(path.join(root, 'desktop/src/main/index.cts'), 'utf8')
  const handler = source.slice(
    source.indexOf("ipcMain.handle('agent:get-media-item-range'"),
    source.indexOf("ipcMain.handle('agent:get-media-facets'"),
  )
  for (const key of [
    'createDesktopGalleryFirstRangeTiming()',
    'rangeTrace.markAgentReady()',
    'rangeTrace.markHttpStarted()',
    "lifecycleLog?.record('gallery_first_range_timing', timing)",
    'viewportRequests.run(event.sender, requestID',
    'requireAgentLifecycle().ensureRunning()',
    'requireAgentClient().mediaItemRange(',
    "rangeOutcome = signal.aborted ? 'cancelled' : 'ok'",
    'throw error',
  ]) assert.ok(handler.includes(key), 'missing actual owner-safe Gallery trace: ' + key)
  assert.ok(handler.includes('if (offset === 0)'), 'ignore non-first-page gallery range logs')
  assert.ok(handler.indexOf('rangeTrace.markHttpStarted()') <
    handler.indexOf('requireAgentClient().mediaItemRange('),
  'timing starts before real Agent HTTP, not after response')
  assert.ok(handler.includes('rangeTrace.finish(rangeOutcome)'), 'timing finalizes on error/cancel')
})
