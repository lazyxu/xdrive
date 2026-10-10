const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')

const repo = path.resolve(__dirname, '../..')
function compile(relative, deps) {
  const filename = path.join(repo, relative)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', code)(mod.exports, name => {
    assert.ok(Object.hasOwn(deps, name), 'unexpected module: ' + name)
    return deps[name]
  }, mod)
  return mod.exports
}
const shared = compile('ui/shared/src/transfers.ts', {})
const display = compile('ui/shared/src/mui/TransferSpeedDisplay.ts', {
  'react': React,
  '../transfers': shared,
})
const start = Date.parse('2026-10-10T05:00:00.000Z')
function task(id = 'a', overrides = {}) {
  return {
    id, file_name: id+'.bin', kind:'upload', direction:'upload',
    state: 'running', phase:'transferring',
    bytes_done: 1024, bytes_total: 8096, percent: 12,
    instant_bytes_per_second: 1024, average_bytes_per_second: 900,
    elapsed_ms: 1000, retry_count: 0, retryable: false,
    started_at: new Date(start-1000).toISOString(),
    updated_at: new Date(start).toISOString(),
    speed_source: 'client', speed_updated_at: new Date(start).toISOString(),
    ...overrides,
  }
}

test('rate display samples only once per presentation tick while byte progress remains live', () => {
  const initial = [task()]
  const captured = display.xDriveCaptureTransferRateSamples(initial)
  const changed = [task('a', {
    bytes_done: 6096, percent: 75,
    instant_bytes_per_second: 98000,
    updated_at: new Date(start+100).toISOString(),
    speed_updated_at: new Date(start+100).toISOString(),
  })]
  const ui = display.xDriveApplyTransferRateSamples(changed, captured)[0]
  assert.equal(ui.bytes_done, 6096, 'byte progress must never be delayed')
  assert.equal(ui.percent, 75)
  assert.equal(ui.instant_bytes_per_second, 1024, 'speed text must not twitch per byte callback')
  assert.equal(shared.xDriveTransferCurrentBytesPerSecond(ui, start+120), 1024)
  const afterTick = display.xDriveApplyTransferRateSamples(changed, display.xDriveCaptureTransferRateSamples(changed))[0]
  assert.equal(afterTick.instant_bytes_per_second, 98000)
})

test('stalled network sample expires even if unrelated progress updates keep rerendering', () => {
  const captured = display.xDriveCaptureTransferRateSamples([task()])
  const stale = task('a', {
    updated_at: new Date(start+8000).toISOString(),
    bytes_done: 7024,
    instant_bytes_per_second: 1024,
  })
  const ui = display.xDriveApplyTransferRateSamples([stale], captured)[0]
  assert.equal(ui.updated_at, new Date(start).toISOString(),
    'late progress must not renew old network sample timestamp')
  assert.equal(shared.xDriveTransferCurrentBytesPerSecond(ui, start+3500), 0,
    'stale header or Task Center rate must fall to zero')
  assert.equal(shared.xDriveTransferEtaMs({ ...ui, average_bytes_per_second: 0, instant_bytes_per_second: 0 }), undefined)
})

test('terminal children have zero current speed and preserve saved history average', () => {
  const captured = display.xDriveCaptureTransferRateSamples([task()])
  const result = display.xDriveApplyTransferRateSamples([
    task('a', {state:'completed',phase:'finalizing',average_bytes_per_second:850}),
  ], captured)[0]
  assert.equal(result.instant_bytes_per_second,0)
  assert.equal(result.average_bytes_per_second,850)
  assert.equal(shared.xDriveTransferCurrentBytesPerSecond(result,start+100),0)
})

test('new active transfers never borrow another transfer identifier rate', () => {
  const captured=display.xDriveCaptureTransferRateSamples([task('old')])
  const newest=display.xDriveApplyTransferRateSamples([task('new', {
    instant_bytes_per_second:123456
  })],captured)[0]
  assert.equal(newest.instant_bytes_per_second,0)
  assert.equal(shared.xDriveTransferCurrentBytesPerSecond(newest,start+100),0)
  assert.equal(display.XDRIVE_TRANSFER_SPEED_DISPLAY_MS,2000)
})
