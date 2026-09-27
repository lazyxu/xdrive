const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { trayStatusKind, trayStatusIconFile } = require('../dist/main/tray_status.cjs')

function status(overrides = {}) {
  return {
    revision: 1,
    configured: true,
    auth_status: '已登录',
    sync_status: '同步正常',
    paused: false,
    must_change_password: false,
    has_conflict: false,
    conflict_count: 0,
    version: '1.0.0',
    ...overrides,
  }
}

const emptyTransfers = { revision: 0, transfers: [] }

test('tray status prioritizes actionable states', () => {
  assert.equal(trayStatusKind(false, undefined, emptyTransfers, null), 'offline')
  assert.equal(trayStatusKind(true, status({ has_conflict: true, conflict_count: 2 }), emptyTransfers, null), 'conflict')
  assert.equal(trayStatusKind(true, status({ paused: true }), emptyTransfers, null), 'paused')
  assert.equal(trayStatusKind(true, status({ last_error: 'network failed' }), emptyTransfers, null), 'offline')
})

test('tray status shows syncing for transfers, sync engine, and update work', () => {
  const transfer = {
    id: '1',
    file_name: 'a.bin',
    kind: 'download',
    direction: 'download',
    state: 'running',
    bytes_done: 1,
    bytes_total: 2,
    percent: 50,
    instant_bytes_per_second: 1,
    average_bytes_per_second: 1,
    elapsed_ms: 1,
    retry_count: 0,
    retryable: true,
    started_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }
  assert.equal(trayStatusKind(true, status(), { revision: 1, transfers: [transfer] }, null), 'syncing')
  assert.equal(trayStatusKind(true, status({ sync_status: '正在同步' }), emptyTransfers, null), 'syncing')
  assert.equal(trayStatusKind(true, status(), emptyTransfers, {
    mode: 'download',
    status: 'downloading',
    current_version: '1.0.0',
    update_available: true,
    downloaded: false,
    install_supported: true,
  }), 'syncing')
  assert.equal(trayStatusKind(true, status(), emptyTransfers, null), 'normal')
})

test('every tray state resolves to one canonical 16px PNG asset', () => {
  const repoRoot = path.join(__dirname, '..', '..')
  for (const kind of ['normal', 'syncing', 'paused', 'conflict', 'offline']) {
    const filename = trayStatusIconFile(kind)
    assert.equal(filename, `tray-${kind}.png`)
    const bytes = fs.readFileSync(path.join(repoRoot, 'assets', 'icon', 'tray', filename))
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], kind)
    assert.equal(bytes.readUInt32BE(16), 16, `${kind} width`)
    assert.equal(bytes.readUInt32BE(20), 16, `${kind} height`)
  }
})

test('tray status source no longer embeds duplicate base64 artwork', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'tray_status.cts'), 'utf8')
  assert.equal(source.includes('iVBORw0KGgo'), false)
  assert.equal(source.includes('trayStatusIconBase64'), false)
})
