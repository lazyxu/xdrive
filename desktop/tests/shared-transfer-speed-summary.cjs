const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const filename = path.join(repo, 'ui', 'shared', 'src', 'transfers.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
vm.runInNewContext(`(function(exports,module){${compiled}\n})(exports,module)`, {
  exports: mod.exports,
  module: mod,
  Date,
  Math,
  Set,
  Map,
})
const {
  xDriveTransferSpeedSummary,
  xDriveTransferIsNetwork,
} = mod.exports

function task(overrides) {
  return {
    id: overrides.id,
    root_id: overrides.root_id ?? overrides.id,
    parent_id: overrides.parent_id,
    scope: overrides.scope ?? 'item',
    phase: 'transferring',
    scan_complete: true,
    file_name: overrides.id,
    kind: overrides.kind ?? 'download',
    direction: overrides.direction ?? overrides.kind ?? 'download',
    state: overrides.state ?? 'running',
    bytes_done: 1,
    bytes_total: 10,
    percent: 10,
    items_total: 1,
    items_completed: 0,
    items_failed: 0,
    items_running: 1,
    items_queued: 0,
    instant_bytes_per_second: overrides.speed ?? 0,
    average_bytes_per_second: overrides.speed ?? 0,
    elapsed_ms: 1000,
    retry_count: 0,
    retryable: false,
    started_at: new Date(9000).toISOString(),
    updated_at: new Date(overrides.updatedAt ?? 10000).toISOString(),
  }
}

test('network speed summary counts active leaves instead of duplicating group speed', () => {
  const now = 10000
  const items = [
    task({ id: 'upload-group', scope: 'group', kind: 'upload', direction: 'upload', speed: 999, updatedAt: now }),
    task({ id: 'upload-child', parent_id: 'upload-group', root_id: 'upload-group', kind: 'upload', direction: 'upload', speed: 100, updatedAt: now }),
    task({ id: 'download', kind: 'download', direction: 'download', speed: 200, updatedAt: now }),
    task({ id: 'hydrate', kind: 'hydration', direction: 'local', speed: 50, updatedAt: now }),
    task({ id: 'dehydrate', kind: 'dehydration', direction: 'local', speed: 1000, updatedAt: now }),
  ]
  const summary = xDriveTransferSpeedSummary(items, now)
  assert.equal(summary.uploadBytesPerSecond, 100)
  assert.equal(summary.downloadBytesPerSecond, 250)
  assert.equal(summary.activeUploads, 1)
  assert.equal(summary.activeDownloads, 2)
  assert.equal(summary.activeTotal, 3)
  assert.equal(xDriveTransferIsNetwork(items[3]), true)
  assert.equal(xDriveTransferIsNetwork(items[4]), false)
})

test('stale active samples decay to zero without dropping the active count', () => {
  const now = 10000
  const summary = xDriveTransferSpeedSummary([
    task({ id: 'download', speed: 400, updatedAt: now - 4000 }),
  ], now, 3000)
  assert.equal(summary.downloadBytesPerSecond, 0)
  assert.equal(summary.activeDownloads, 1)
})
