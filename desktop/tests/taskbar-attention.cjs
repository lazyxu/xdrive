const test = require('node:test')
const assert = require('node:assert/strict')

const { taskbarOverlayKind, taskbarOverlayPNG } = require('../dist/main/taskbar_attention.cjs')

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

test('taskbar overlay only represents actionable problem states', () => {
  assert.equal(taskbarOverlayKind(false), 'offline')
  assert.equal(taskbarOverlayKind(true, status({ has_conflict: true, conflict_count: 1 })), 'conflict')
  assert.equal(taskbarOverlayKind(true, status({ last_error: 'network failed' })), 'offline')
  assert.equal(taskbarOverlayKind(true, status({ auth_status: '登录已过期' })), 'offline')
  assert.equal(taskbarOverlayKind(true, status({ paused: true })), null)
  assert.equal(taskbarOverlayKind(true, status({ sync_status: '正在同步' })), null)
  assert.equal(taskbarOverlayKind(true, status()), null)
})

test('taskbar overlays use Electron-compatible PNG badges', () => {
  for (const kind of ['conflict', 'offline']) {
    const png = taskbarOverlayPNG(kind)
    assert.ok(Buffer.isBuffer(png), `${kind}: badge should be a Buffer`)
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${kind}: badge should be a PNG`)
    assert.equal(png.readUInt32BE(16), 32, `${kind}: badge width should be 32px`)
    assert.equal(png.readUInt32BE(20), 32, `${kind}: badge height should be 32px`)
  }
})
