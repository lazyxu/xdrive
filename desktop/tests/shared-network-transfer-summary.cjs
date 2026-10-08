const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.join(__dirname, '..', '..', 'ui', 'shared', 'src', 'transfers.ts')
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const loaded = { exports: {} }
new Function('exports', 'require', 'module', output)(loaded.exports, require, loaded)
const transfers = loaded.exports
const now = Date.parse('2026-10-08T12:00:00.000Z')

function task(id, overrides = {}) {
  return {
    id,
    file_name: `${id}.bin`,
    kind: 'download',
    direction: 'download',
    state: 'running',
    phase: 'transferring',
    bytes_done: 1024,
    bytes_total: 10240,
    percent: 10,
    instant_bytes_per_second: 100,
    average_bytes_per_second: 999,
    elapsed_ms: 1000,
    retry_count: 0,
    retryable: false,
    started_at: new Date(now - 10000).toISOString(),
    updated_at: new Date(now - 100).toISOString(),
    ...overrides,
  }
}

function summarize(items, at = now) {
  return transfers.xDriveNetworkTransferSummary?.(items, at)
}

test('network summary includes uploads, downloads and hydration while excluding local dehydration', () => {
  const summary = summarize([
    task('upload', { direction: 'upload', kind: 'upload', instant_bytes_per_second: 1024 }),
    task('download', { instant_bytes_per_second: 4096 }),
    task('hydrate', { kind: 'hydration', instant_bytes_per_second: 2048 }),
    task('dehydrate', { kind: 'dehydration', direction: 'local', instant_bytes_per_second: 999999 }),
  ])
  assert.deepEqual(summary, {
    upload: { bytesPerSecond: 1024, clientBytesPerSecond: 1024, serverBytesPerSecond: 0, serverReported: false, activeCount: 1 },
    download: { bytesPerSecond: 6144, clientBytesPerSecond: 6144, serverBytesPerSecond: 0, serverReported: false, activeCount: 2 },
    activeCount: 3,
    historyCount: 0,
  })
})

test('folder summary uses child network samples once without falling back to retained parent speed', () => {
  const group = task('folder', { scope: 'group', instant_bytes_per_second: 10000 })
  const children = [
    task('a', { parent_id: 'folder', root_id: 'folder', instant_bytes_per_second: 120 }),
    task('b', { parent_id: 'folder', root_id: 'folder', instant_bytes_per_second: 280 }),
    task('queued', { parent_id: 'folder', root_id: 'folder', state: 'queued', instant_bytes_per_second: 900 }),
    task('done', { parent_id: 'folder', root_id: 'folder', state: 'completed', instant_bytes_per_second: 800 }),
  ]
  assert.equal(summarize([group, ...children])?.download.bytesPerSecond, 400)
  assert.equal(summarize([group, ...children])?.activeCount, 1)
  assert.equal(summarize([group, ...children], now + 3000)?.download.bytesPerSecond, 0)
})

test('missing parents preserve child speeds and count their shared root once', () => {
  const summary = summarize([
    task('a', { parent_id: 'missing', root_id: 'missing', instant_bytes_per_second: 125 }),
    task('b', { parent_id: 'missing', root_id: 'missing', instant_bytes_per_second: 375 }),
    task('done', { parent_id: 'missing', root_id: 'missing', state: 'completed' }),
  ])
  assert.equal(summary?.download.bytesPerSecond, 500)
  assert.equal(summary?.activeCount, 1)
  assert.equal(summary?.historyCount, 0)
})

test('a group with its own server sample measures the archive response rather than its logical children', () => {
  const group = task('archive', { scope: 'group', speed_source: 'server', instant_bytes_per_second: 800 })
  const children = [task('file', { parent_id: 'archive', root_id: 'archive', instant_bytes_per_second: 6000 })]
  assert.deepEqual(summarize([group, ...children])?.download, {
    bytesPerSecond: 800, clientBytesPerSecond: 0, serverBytesPerSecond: 800, serverReported: true, activeCount: 1,
  })
  assert.equal(summarize([{ ...group, instant_bytes_per_second: 0 }, ...children])?.download.bytesPerSecond, 0)
  assert.equal(summarize([{ ...group, speed_updated_at: new Date(now - 4000).toISOString() }, ...children])?.download.bytesPerSecond, 0)
})

test('a group without children can report its own fresh transfer sample', () => {
  assert.equal(summarize([task('folder', { scope: 'group', instant_bytes_per_second: 2048 })])?.download.bytesPerSecond, 2048)
})

test('fresh retry bytes count while queued, empty retries, finalizing and stale samples report zero', () => {
  const cases = [
    { state: 'retrying', bytes_done: 0 },
    { state: 'queued' },
    { phase: 'queued' },
    { phase: 'finalizing' },
    { updated_at: new Date(now - 3000).toISOString() },
    { updated_at: 'not-a-date' },
    { updated_at: new Date(now + 60000).toISOString() },
    { speed_updated_at: new Date(now - 3000).toISOString() },
    { instant_bytes_per_second: 0, average_bytes_per_second: 10000 },
    { instant_bytes_per_second: Infinity },
    { instant_bytes_per_second: -100 },
  ]
  for (const overrides of cases) {
    assert.equal(summarize([task('inactive-rate', overrides)])?.download.bytesPerSecond, 0, JSON.stringify(overrides))
  }
  assert.equal(summarize([task('retry', { state: 'retrying' })])?.download.bytesPerSecond, 100)
  assert.equal(summarize([task('cancel', { state: 'cancelling' })])?.download.bytesPerSecond, 100)
})

test('all terminal states are history with zero speed even when a child or average retains progress', () => {
  const summary = summarize([
    ...['completed', 'partial', 'failed', 'cancelled'].map((state) => task(state, { state, scope: 'group' })),
    task('local-history', { direction: 'local', kind: 'dehydration', state: 'completed' }),
  ])
  assert.equal(summary?.download.bytesPerSecond, 0)
  assert.equal(summary?.activeCount, 0)
  assert.equal(summary?.historyCount, 4)
})

test('active descendants keep their root active without reviving a terminal parent rate', () => {
  const summary = summarize([
    task('folder', { scope: 'group', state: 'completed', instant_bytes_per_second: 99999 }),
    task('child', { parent_id: 'folder', root_id: 'folder', instant_bytes_per_second: 125 }),
  ])
  assert.equal(summary?.download.bytesPerSecond, 125)
  assert.equal(summary?.activeCount, 1)
  assert.equal(summary?.historyCount, 0)
})

test('server and client network samples remain distinguishable when sharing one direction', () => {
  const summary = summarize([
    task('native', { speed_source: 'server', instant_bytes_per_second: 700 }),
    task('streamed', { speed_source: 'client', instant_bytes_per_second: 300 }),
  ])
  assert.deepEqual(summary?.download, {
    bytesPerSecond: 1000, clientBytesPerSecond: 300, serverBytesPerSecond: 700, serverReported: true, activeCount: 2,
  })
})

test('an explicit fresh wire sample can report bytes before resumable logical progress advances', () => {
  const summary = summarize([task('chunk', {
    direction: 'upload', kind: 'upload', bytes_done: 0,
    speed_source: 'client', speed_updated_at: new Date(now - 100).toISOString(),
    instant_bytes_per_second: 1024,
  })])
  assert.equal(summary?.upload.bytesPerSecond, 1024)
})

test('a retry accepts a fresh wire sample only from its current attempt', () => {
  const retry = task('retry', {
    state: 'retrying', bytes_done: 0, speed_source: 'client',
    started_at: new Date(now - 500).toISOString(),
  })
  assert.equal(summarize([{ ...retry, speed_updated_at: new Date(now - 1000).toISOString() }])?.download.bytesPerSecond, 0)
  assert.equal(summarize([{ ...retry, speed_updated_at: new Date(now - 100).toISOString() }])?.download.bytesPerSecond, 100)
})

test('a native download handed to the browser is retained as history without claiming live progress', () => {
  const item = task('untracked-native', { state: 'handed_off' })
  assert.equal(transfers.xDriveTransferTerminal(item), true)
  assert.equal(transfers.xDriveTransferStateLabel(item.state), '由浏览器下载')
  assert.equal(summarize([item])?.activeCount, 0)
  assert.equal(summarize([item])?.historyCount, 1)
  assert.equal(summarize([item])?.download.bytesPerSecond, 0)
})
